import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { importSelectBenchRun, selectBenchRun } from "@aihot/backend/admin/selectbench";
import { registerAdmin } from "../apps/api/src/routes/admin.ts";

const app = Fastify({ logger: false });
config.devAdmin = { displayName: "SelectBench consistency test" };
config.environmentName = "development";
registerAdmin(app);
after(async () => { await app.close(); await closeDb(); });

const item = { caseId: "shared-case", title: "A report", gold: "select", decision: "select" };
const counts = async () => (await sql`SELECT (SELECT count(*)::int FROM selectbench_runs) AS runs,
  (SELECT count(*)::int FROM selectbench_results) AS cases, (SELECT count(*)::int FROM audit_log) AS audits`)[0];

test("conflicting gold for a shared case returns 400 before any report writes", async (t) => {
  for (const gold of ["reject", "either"]) {
    await t.test(gold, async () => {
      const before = await counts();
      const response = await app.inject({ method: "POST", url: "/api/admin/selectbench/import",
        headers: { "x-csrf-token": "dev" }, payload: { label: "Conflicting gold", report: { models: {
          first: { summary: { n: 1 }, cases: [item] },
          second: { summary: { n: 1 }, cases: [{ ...item, gold, decision: "reject" }] },
        } } } });
      assert.equal(response.statusCode, 400, response.body);
      assert.match(response.json().detail, /second.*shared-case.*conflicting gold/);
      assert.deepEqual(await counts(), before);
    });
  }
});

test("every invalid report returns 400 before any report writes", async (t) => {
  const reports: Record<string, unknown> = {
    "no summaries": { models: { first: { cases: [item] } } },
    "cases not an array": { models: { first: { summary: {}, cases: {} } } },
    "blank caseId": { models: { first: { summary: {}, cases: [{ ...item, caseId: " " }] } } },
    "duplicate caseId": { models: { first: { summary: {}, cases: [item, item] } } },
    "invalid gold": { models: { first: { summary: {}, cases: [{ ...item, gold: "SELECT" }] } } },
  };
  for (const [name, report] of Object.entries(reports)) {
    await t.test(name, async () => {
      const before = await counts();
      const response = await app.inject({ method: "POST", url: "/api/admin/selectbench/import",
        headers: { "x-csrf-token": "dev" }, payload: { label: name, report } });
      assert.equal(response.statusCode, 400, response.body);
      assert.deepEqual(await counts(), before);
    });
  }
});

test("shared gold keeps model disagreements and correct outcome filters comparable", async () => {
  const { id } = await importSelectBenchRun({ models: {
    first: { summary: {}, cases: [item, { ...item, caseId: "first-only", gold: "reject", decision: "reject" }] },
    second: { summary: {}, cases: [{ ...item, decision: "reject" }] },
    summaryOnly: { summary: {} },
  } }, "Compare", "test");
  const disagree = await selectBenchRun(id, { disagree: true });
  assert.equal(disagree!.rows.length, 1);
  assert.equal(disagree!.rows[0]!.gold, "select");
  assert.equal(disagree!.rows[0]!.by_model.first!.decision, "select");
  assert.equal(disagree!.rows[0]!.by_model.second!.decision, "reject");
  assert.deepEqual((await selectBenchRun(id, { model: "first", outcome: "tp" }))!.rows.map(r => r.case_id), ["shared-case"]);
  assert.deepEqual((await selectBenchRun(id, { model: "second", outcome: "fn" }))!.rows.map(r => r.case_id), ["shared-case"]);
  assert.equal((await selectBenchRun(id, {}))!.rows.length, 2);
});
