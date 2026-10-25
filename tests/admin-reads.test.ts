// The source list shows each source's health and why it fails, failing sources first.
import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { listSources } from "@aihot/backend/admin/sources";

after(closeDb);

test("the source list shows health and the failure reason, failing sources first", async () => {
  await sql`INSERT INTO sources (id, name, kind, health, fail_count, last_error) VALUES
    ('list-ok', 'List A', 'rss', 'ok', 0, NULL), ('list-failing', 'List B', 'rss', 'failing', 6, 'HTTP 503')`;
  const { rows, totals } = await listSources({ q: "List" });
  assert.deepEqual(rows.map(({ id, health, fail_count, last_error }) => ({ id, health, fail_count, last_error })), [
    { id: "list-failing", health: "failing", fail_count: 6, last_error: "HTTP 503" },
    { id: "list-ok", health: "ok", fail_count: 0, last_error: null },
  ]);
  assert.equal(totals.failing, 1);
});
