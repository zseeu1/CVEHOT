// Decoded NUL in user filters must be rejected before PostgreSQL, while literal escapes and
// ordinary Unicode searches keep working through the site, public API, Agent and MCP.
import './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { closeDb } from '@aihot/backend/db';
import { mcpToolName } from '@aihot/contracts/mcp';
import { buildApp } from '../apps/api/src/app.ts';

const app = await buildApp();
after(async () => { await app.close(); await closeDb(); });

for (const url of [
  '/api/site/timeline?tag=AI%00',
  '/api/site/pool?q=AI%00',
  '/api/v1/items?q=AI%00',
  '/api/v1/agent/search?q=AI%00',
]) test(`invalid NUL input is a request error: ${url}`, async () => {
  const response = await app.inject(url);
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().code, 'invalid_request');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['retry-after'], undefined);
});

async function tool(name: string, args: Record<string, unknown>) {
  const response = await app.inject({ method: 'POST', url: '/api/mcp', headers: {
    host: 'localhost', 'content-type': 'application/json', accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': mcpToolName(name),
  }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
    name: mcpToolName(name), arguments: args,
    _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} },
  } } });
  assert.equal(response.statusCode, 200, response.body);
  return response.headers['content-type']?.startsWith('text/event-stream')
    ? JSON.parse(response.body.split('\n').find(line => line.startsWith('data: '))!.slice(6))
    : response.json();
}

test('MCP rejects NUL searches as invalid input', async () => {
  const body = await tool('search', { q: 'AI\0' });
  assert.equal(body.result.isError, true);
  assert.equal(body.result.structuredContent.error.code, 'invalid_request');
});

test('ordinary Unicode and literal escape text remain searchable', async () => {
  for (const query of ['AI模型', 'AI\\u0000', 'AI%00']) {
    for (const path of ['/api/site/pool', '/api/v1/items', '/api/v1/agent/search']) {
      const response = await app.inject(`${path}?q=${encodeURIComponent(query)}`);
      assert.equal(response.statusCode, 200, `${path}: ${response.body}`);
    }
    const body = await tool('search', { q: query });
    assert.notEqual(body.result.isError, true);
  }
});
