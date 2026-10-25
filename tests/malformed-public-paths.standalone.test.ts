// Observed nonexistent share-card names and decoded controls must not become server errors.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import Fastify from 'fastify';
import { closeDb } from '@aihot/backend/db';
import { registerOg } from '../apps/api/src/routes/og.ts';
import { startWebServer, type WebServer } from '../apps/web/tests/web-server.ts';

const app = Fastify();
registerOg(app);
let web: WebServer;
const api = createServer((_req, res) => {
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 'not_found' }));
});
before(async () => { web = await startWebServer(api); });
after(async () => { await app.close(); await closeDb(); await web?.stop(); });

test('inherited object names are nonexistent share cards', async () => {
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '__defineGetter__', 'missing']) {
    const response = await app.inject(`/og/pages/${name}.png`);
    assert.equal(response.statusCode, 404, `${name}: ${response.body}`);
  }
});

test('ordinary share cards keep their PNG and conditional cache responses', async () => {
  const response = await app.inject('/og/pages/topics.png');
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['content-type'], 'image/png');
  assert.deepEqual([...response.rawPayload.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  const cached = await app.inject({ url: '/og/pages/topics.png', headers: { 'if-none-match': response.headers.etag! } });
  assert.equal(cached.statusCode, 304);
});

test('decoded controls in topic paths return 404 without injecting response headers', async () => {
  for (const slug of ['abc%0D%0AX-Evil:1', 'abc%0A', 'abc%0D', 'abc%0A%09X-Evil:1', '%0AX-Evil:1']) {
    for (const suffix of ['', '/page/1', '/page/2']) {
      const response = await fetch(`${web.origin}/topics/${slug}${suffix}`, { redirect: 'manual' });
      assert.equal(response.status, 404, `${slug}${suffix}: ${web.logs()}`);
      assert.equal(response.headers.get('x-evil'), null);
      assert.equal(response.headers.get('location'), null);
    }
  }
});

test('ordinary first topic page keeps its permanent redirect', async () => {
  const response = await fetch(`${web.origin}/topics/openai/page/1`, { redirect: 'manual' });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), '/topics/openai');
});
