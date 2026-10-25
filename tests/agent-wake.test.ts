// The operations agent is woken through its webhook when a problem is first told to the owner, so it
// starts on it at once. Ways it can go wrong:
// - a new reader-facing or owner-facing problem is not handed over, or the worker going down is not;
// - hourly reminders, recoveries or follow-ups wake it again and again (each wake is a paid agent run);
// - an agent that is unreachable or refuses stops the owner's alert, or makes the next check send it again;
// - the request lacks the key, or carries it anywhere but the Authorization header;
// - it is woken where no webhook is configured, or where outward actions are off (FEISHU_INTERNAL_ENABLED, as
//   for the owner's alerts: development and rehearsal may hold production credentials);
// - a check that fails half way and is retried wakes it again for a problem it already woke it for.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { installModules, type ServerModule } from "@aihot/backend/modules";
import type { Finding } from "@aihot/backend/notify/feishu";
import { claimAgentWake } from "@aihot/backend/notify/agent";
import { invalidateModelCache } from "@aihot/backend/editorial/models";
import { checkAlerts } from "@aihot/backend/operations/alerts";
import { checkWorkerHeartbeat } from "@aihot/backend/operations/watch";

const T = tag();
const KEY = `test-agent-key-${T}`;
let found: Finding[] = [];
const fake: ServerModule = { name: "fake", alerts: async () => found };
installModules([fake]);
process.env.COLLECT_ENABLED = "false";
process.env.MODEL_CALLS_ENABLED = "false";

const wakes: Array<{ path: string; auth: string | undefined; body: Record<string, unknown> }> = [];
let status = 200;
const agent = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    wakes.push({ path: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    res.writeHead(status, { "content-type": "application/json" });
    res.end("{}");
  });
});

before(async () => {
  await getBoss(); // collectFindings reads the job tables
  await new Promise<void>((resolve) => agent.listen(0, "127.0.0.1", () => resolve()));
});
beforeEach(async () => {
  found = [];
  wakes.length = 0;
  status = 200;
  const { port } = agent.address() as { port: number };
  process.env.AGENT_WEBHOOK_URL = `http://127.0.0.1:${port}/automations/webhook/${T}`;
  process.env.AGENT_WEBHOOK_KEY = KEY;
  process.env.FEISHU_INTERNAL_ENABLED = "true"; // no alert chat is set, so no Feishu message goes out
  await sql`DELETE FROM settings WHERE key IN ('alerts.state', 'heartbeat.worker', 'watchdog.worker') OR key LIKE 'agent.wake.%'`;
});
after(async () => {
  delete process.env.AGENT_WEBHOOK_URL;
  delete process.env.AGENT_WEBHOOK_KEY;
  delete process.env.FEISHU_INTERNAL_ENABLED;
  await new Promise<void>((resolve) => agent.close(() => resolve()));
  await stopBoss();
  await closeDb();
});

const MIN = 60_000;
const down: Finding = { key: "content.collect", level: "now", title: "网站停止收录新文章", impact: "读者看不到新文章", detail: "近 2 小时 0 篇" };
const balance: Finding = { key: "balance.deepseek", level: "today", title: "DeepSeek 余额不足" };
const quiet: Finding = { key: "sources.unstable.x", level: "later", title: "信源反复抓取失败" };
const woken = () => wakes.map((w) => w.body.key);

test("a new problem wakes the agent once; reminders, recoveries and follow-ups do not", async () => {
  const t0 = Date.now();
  found = [down, balance, quiet];
  await checkAlerts(t0);
  assert.deepEqual(woken().sort(), ["balance.deepseek", "content.collect"], "each newly told problem, follow-ups excluded");
  const w = wakes.find((x) => x.body.key === "content.collect")!;
  assert.equal(w.auth, `Bearer ${KEY}`);
  assert.equal(w.path, `/automations/webhook/${T}`, "the key is not put in the address");
  assert.ok(!JSON.stringify(w.body).includes(KEY), "nor in the body");
  assert.deepEqual([w.body.level, w.body.title, w.body.detail], ["now", down.title, down.detail], "what it needs to start on the problem");

  await checkAlerts(t0 + 61 * MIN);
  assert.equal(wakes.length, 2, "the hourly reminder does not wake it again");
  found = [balance, quiet];
  await checkAlerts(t0 + 70 * MIN);
  assert.equal(wakes.length, 2, "nor does the recovery");
  found = [down, balance, quiet];
  await checkAlerts(t0 + 80 * MIN);
  assert.deepEqual(woken().slice(2), ["content.collect"], "a problem that comes back is new again");
});

test("an agent that refuses or cannot be reached does not hold up or repeat the owner's alert", async () => {
  const t0 = Date.now();
  status = 500;
  found = [down];
  const r = await checkAlerts(t0);
  assert.deepEqual(r.sent, ["content.collect"], "the owner's alert is recorded as sent");
  assert.equal(wakes.length, 1);
  assert.deepEqual((await checkAlerts(t0 + 10 * MIN)).sent, [], "nothing is sent again at the next check");

  await sql`DELETE FROM settings WHERE key = 'alerts.state'`;
  process.env.AGENT_WEBHOOK_URL = "http://127.0.0.1:9/automations/webhook/unreachable";
  assert.deepEqual((await checkAlerts(t0 + 20 * MIN)).sent, ["content.collect"]);
});

test("nothing is woken where no webhook is configured or outward actions are off", async () => {
  found = [down];
  process.env.FEISHU_INTERNAL_ENABLED = "false";
  await checkAlerts(Date.now());
  await sql`DELETE FROM settings WHERE key = 'alerts.state'`;
  process.env.FEISHU_INTERNAL_ENABLED = "true";
  delete process.env.AGENT_WEBHOOK_URL;
  await checkAlerts(Date.now());
  assert.equal(wakes.length, 0);
});

test("a check that fails after telling a problem wakes the agent only once the problem is recorded as told", async () => {
  // Feishu takes the first alert and refuses the second; the check is retried, as the job queue does.
  let messages = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://open.feishu.cn/")) return realFetch(input, init);
    if (url.includes("tenant_access_token")) return Response.json({ code: 0, tenant_access_token: "fictional", expire: 7200 });
    messages += 1;
    return Response.json(messages === 2 ? { code: 99, msg: "synthetic send failure" } : { code: 0, data: { message_id: `m${messages}` } });
  }) as typeof fetch;
  Object.assign(process.env, { FEISHU_APP_ID: "test-app", FEISHU_APP_SECRET: "test-secret", FEISHU_ALERT_CHAT_ID: `oc_test_${T}` });
  try {
    const t0 = Date.now();
    found = [down, balance];
    await assert.rejects(checkAlerts(t0), /synthetic send failure/);
    assert.equal(wakes.length, 0, "nothing woken before the told state is saved");
    await checkAlerts(t0 + MIN);
    await checkAlerts(t0 + 2 * MIN);
    assert.deepEqual(woken().sort(), ["balance.deepseek", "content.collect"], "each woken once, after the retry saved them");
  } finally {
    globalThis.fetch = realFetch;
    for (const k of ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_ALERT_CHAT_ID"]) delete process.env[k];
  }
});

test("the worker going down wakes the agent once, its recovery does not", async () => {
  const beat = (stale: boolean) => sql`INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('heartbeat.worker', '{}', 'test', ${new Date(Date.now() - (stale ? 61 * MIN : 0))})
    ON CONFLICT (key) DO UPDATE SET updated_at = EXCLUDED.updated_at`;
  await beat(false);
  await checkWorkerHeartbeat();
  await beat(true);
  await checkWorkerHeartbeat();
  await checkWorkerHeartbeat();
  assert.deepEqual(woken(), ["worker"]);
  await beat(false);
  await checkWorkerHeartbeat();
  assert.deepEqual(woken(), ["worker"]);
});


test("a definite refusal remains visible and can be resumed without repeating the owner's alert", async () => {
  const t0 = Date.now();
  found = [down]; status = 401;
  await checkAlerts(t0);
  const [row] = await sql`SELECT value FROM settings WHERE key='agent.wake.content.collect'`;
  assert.equal(row?.value.status, "refused");
  assert.ok(row?.value.eventId);
  await checkAlerts(t0+10*MIN);
  assert.equal(wakes.length, 2, "a definite refusal is resumed by the existing ten-minute check");
  await claimAgentWake(row!.value.eventId, "test-run", "test");
  const [claimed] = await sql`SELECT value FROM settings WHERE key='agent.wake.content.collect'`;
  assert.equal(claimed?.value.status, "claimed", "the running agent explicitly records ownership");
});

test("an unknown HTTP outcome is durable and never blindly creates a second paid run", async () => {
  const t0 = Date.now();
  found = [down]; status = 500;
  await checkAlerts(t0);
  await checkAlerts(t0+10*MIN);
  const [row] = await sql`SELECT value FROM settings WHERE key='agent.wake.content.collect'`;
  assert.equal(row?.value.status, "unknown");
  assert.equal(wakes.length, 1);
});

test("a recorded alert resumes its missing handoff after a process interruption", async () => {
  const t0 = Date.now();
  found = [down];
  await sql`INSERT INTO settings(key,value) VALUES('alerts.state',${sql.json({[down.key]:{title:down.title,since:new Date(t0).toISOString(),sentAt:new Date(t0).toISOString(),handoff:true}})})`;
  assert.deepEqual((await checkAlerts(t0+10*MIN)).sent, []);
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0]!.body.eventId, `${down.key}:${new Date(t0).toISOString()}`);
});


test("an open incident from the old version is reconciled instead of waking a possible existing run twice", async () => {
  const t0=Date.now();found=[down];
  await sql`INSERT INTO settings(key,value) VALUES('alerts.state',${sql.json({[down.key]:{title:down.title,since:new Date(t0).toISOString(),sentAt:new Date(t0).toISOString()}})})`;
  await checkAlerts(t0+10*MIN);
  assert.equal(wakes.length,0);
  const [row]=await sql`SELECT value FROM settings WHERE key='agent.wake.content.collect'`;
  assert.equal(row?.value.status,"unknown");
});

// A new model's account refusal must not reuse the switched-away model's paid handoff.
// An upgrade also has to preserve an already accepted legacy service-level event.
for (const legacy of [false, true]) test(`a new model refusal wakes separately while preserving the ${legacy ? "legacy service" : "model"} incident`, async () => {
  const now = Date.now();
  const before = process.env.PREFILTER_MODEL;
  const oldKey = legacy ? "provider.refused.dashscope" : "provider.refused.dashscope:qwen3.7-flash";
  const newKey = "provider.refused.dashscope:qwen3.8-flash";
  const [r] = await sql<{ id: number }[]>`INSERT INTO receipts(logical_key,service,purpose,status)
    VALUES(${`wake-model-${legacy}`},'dashscope','prefilter_article','failed') RETURNING id`;
  try {
    process.env.PREFILTER_MODEL = "qwen3.7-flash";
    invalidateModelCache();
    await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,model,status,error,started_at)
      VALUES(${r!.id},1,'dashscope','qwen3.7-flash','failed','dashscope HTTP 429: {"code":"BudgetLimitExceeded"}',${new Date(now-MIN)})`;
    if (legacy) {
      const since = new Date(now).toISOString();
      await sql`INSERT INTO settings(key,value) VALUES('alerts.state',${sql.json({ [oldKey]: { title: "old model refused", since, sentAt: since, handoff: true } })})`;
      await sql`INSERT INTO settings(key,value) VALUES(${`agent.wake.${oldKey}`},${sql.json({ eventId: `${oldKey}:${since}`, title: "old model refused", since, attemptedAt: since, status: "received" })})`;
    }
    await checkAlerts(now+MIN);
    assert.deepEqual(woken(), legacy ? [] : [oldKey]);
    process.env.PREFILTER_MODEL = "qwen3.8-flash";
    invalidateModelCache();
    await checkAlerts(now+2*MIN);
    await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,model,status,error,started_at)
      VALUES(${r!.id},2,'dashscope','qwen3.8-flash','failed','dashscope HTTP 429: {"code":"BudgetLimitExceeded"}',${new Date(now+3*MIN)})`;
    const result = await checkAlerts(now+4*MIN);
    assert.ok(result.sent.includes(newKey), "the current model's new refusal is announced inside the old event's daily interval");
    assert.deepEqual(woken(), legacy ? [newKey] : [oldKey, newKey]);
    assert.ok(result.open.includes(oldKey), "an unrelated failure is not recovery of the old model");
    assert.ok(!result.sent.includes(`${oldKey}:recovered`));
    const [handoff] = await sql`SELECT value FROM settings WHERE key=${`agent.wake.${oldKey}`}`;
    assert.equal(handoff?.value.status, "received", "the old accepted handoff is kept without a duplicate run");
  } finally {
    if (before===undefined) delete process.env.PREFILTER_MODEL; else process.env.PREFILTER_MODEL=before;
    invalidateModelCache();
    await sql`DELETE FROM receipts WHERE id=${r!.id}`;
  }
});

test("a switched-away limit becomes a first alert if its model is selected again", async () => {
  const now = Date.now();
  const f: Finding = { key: "provider.refused.dashscope:qwen3.7-flash", title: "old limit", level: "later" };
  found = [f];
  assert.deepEqual((await checkAlerts(now)).sent, []);
  assert.equal(wakes.length, 0);
  found = [{ ...f, level: "today" }];
  assert.deepEqual((await checkAlerts(now+MIN)).sent, [f.key]);
  assert.deepEqual(woken(), [f.key]);
  await checkAlerts(now+2*MIN);
  assert.equal(wakes.length, 1);
});

// Old versions combined later model failures into the same service event. Its first timestamp
// cannot prove which models were already handed over; preserve that unresolved scope on upgrade.
for (const age of [10*MIN, 120*MIN]) test(`upgrade keeps a later model already covered by a legacy incident (${age/MIN} minutes old)`, async () => {
  const now = Date.now();
  const key = "provider.refused.dashscope";
  const since = new Date(now-180*MIN).toISOString();
  const [r] = await sql<{ id: number }[]>`INSERT INTO receipts(logical_key,service,purpose,status)
    VALUES(${`legacy-later-model-${age}`},'dashscope','prefilter_article','failed') RETURNING id`;
  try {
    await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,model,status,error,started_at)
      VALUES(${r!.id},1,'dashscope','qwen3.7-flash','failed','dashscope HTTP 429: {"code":"BudgetLimitExceeded"}',${new Date(now-240*MIN)}),
      (${r!.id},2,'dashscope','qwen3.7-flash','received',null,${new Date(now-150*MIN)}),
      (${r!.id},3,'dashscope','qwen3.8-flash','failed','dashscope HTTP 429: {"code":"BudgetLimitExceeded"}',${new Date(now-age)})`;
    await sql`INSERT INTO settings(key,value) VALUES('alerts.state',${sql.json({ [key]: { title: "old provider refusal", since, sentAt: since, handoff: true } })})`;
    await sql`INSERT INTO settings(key,value) VALUES(${`agent.wake.${key}`},${sql.json({ eventId: `${key}:${since}`, title: "old provider refusal", since, attemptedAt: since, status: "received" })})`;
    const result = await checkAlerts(now);
    assert.ok(result.open.includes(key), "a model already covered by the old service incident still has no success");
    assert.deepEqual(result.sent, []);
    assert.equal(wakes.length, 0, "keep the accepted handoff; do not purchase it again");
    await checkAlerts(now+120*MIN);
    assert.equal(wakes.length, 0);
    await sql`INSERT INTO receipt_attempts(receipt_id,attempt,service,model,status,started_at)
      VALUES(${r!.id},4,'dashscope','qwen3.8-flash','received',${new Date(now+121*MIN)})`;
    assert.ok((await checkAlerts(now+122*MIN)).sent.includes(`${key}:recovered`), "only the remaining model's success ends the legacy incident");
  } finally {
    await sql`DELETE FROM receipts WHERE id=${r!.id}`;
  }
});
