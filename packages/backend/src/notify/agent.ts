// Webhook acceptance and the agent taking ownership are separate facts. Persist the event before sending:
// without a documented receiver idempotency contract, a timeout or a crashed sender cannot be retried safely.
import { credential } from "../config.ts";
import { audit } from "../audit.ts";
import { sql } from "../db.ts";
import { feishuInternalEnabled, type Finding } from "./feishu.ts";

type Handoff = { eventId: string; title: string; since: string; status: "unknown" | "received" | "refused" | "claimed" | "pending";
  attemptedAt?: string; response?: number; run?: string };
const stateKey = (key: string) => `agent.wake.${key}`;

export async function wakeAgent(f: Finding, now = Date.now(), knownUnsent = true): Promise<void> {
  const url = credential("integrations", "AGENT_WEBHOOK_URL");
  const token = credential("integrations", "AGENT_WEBHOOK_KEY");
  if (!url || !token || !feishuInternalEnabled()) return;
  const since = f.since!.toISOString();
  const eventId = `${f.key}:${since}`;
  const key = stateKey(f.key);
  const attempt = await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const [prior] = await tx<{ value: Handoff }[]>`SELECT value FROM settings WHERE key=${key}`;
    if (prior?.value.eventId === eventId && prior.value.status !== "pending"
      && !(prior.value.status === "refused" && now-Date.parse(prior.value.attemptedAt!) >= 10*60_000)) return false;
    const value: Handoff = { eventId, title: f.title, since, status: "unknown", attemptedAt: new Date(now).toISOString() };
    await tx`INSERT INTO settings(key,value,updated_by) VALUES(${key},${tx.json(value)},'alerts')
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`;
    return knownUnsent || prior?.value.eventId === eventId;
  });
  if (!attempt) return;
  let status: Handoff["status"] = "unknown";
  let response: number | undefined;
  try {
    const res = await fetch(url, {
      method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ key: f.key, eventId, level: f.level, title: f.title, impact: f.impact, detail: f.detail, since }),
      signal: AbortSignal.timeout(15_000),
    });
    response = res.status;
    status = res.ok ? "received" : res.status >= 400 && res.status < 500 ? "refused" : "unknown";
  } catch {
    // No response can mean that the paid run already started. Keep it visible for reconciliation.
  }
  await sql`UPDATE settings SET value=value || ${sql.json({ status, ...(response === undefined ? {} : { response }) })},updated_at=now()
    WHERE key=${key} AND value->>'eventId'=${eventId} AND value->>'status'='unknown'`;
}

/** The agent calls this on entry with its actual run/task reference, including after an unknown response. */
export async function claimAgentWake(eventId: string, run: string, actor: string) {
  if (!eventId || !run.trim()) throw new Error("eventId and run are required");
  await sql.begin(async tx => {
    const changed = await tx`UPDATE settings SET value=value || ${tx.json({ status: "claimed", run })},updated_by=${actor},updated_at=now()
      WHERE key LIKE 'agent.wake.%' AND value->>'eventId'=${eventId} RETURNING key`;
    if (!changed.count) throw new Error("handoff event is no longer current");
    await audit(actor,"agent.claim",eventId,`接手运行 ${run}`,null,{ status: "claimed", run },{ db: tx });
  });
}

/** Only after checking the remote task list: a missing/failed task can be dispatched again on the next check. */
export async function retryAgentWake(eventId: string, reason: string, actor: string) {
  if (!reason.trim()) throw new Error("reason is required");
  await sql.begin(async tx => {
    const changed = await tx`UPDATE settings SET value=value || '{"status":"pending"}'::jsonb,updated_by=${actor},updated_at=now()
      WHERE key LIKE 'agent.wake.%' AND value->>'eventId'=${eventId} RETURNING key`;
    if (!changed.count) throw new Error("handoff event is no longer current");
    await audit(actor,"agent.retry",eventId,reason,null,{ status: "pending" },{ db: tx });
  });
}

export async function closeAgentWake(key: string) {
  await sql`DELETE FROM settings WHERE key=${stateKey(key)}`;
}

/** Missing ownership stays on the existing follow-up list; do not wake another agent about this wake. */
export async function agentHandoffs(now: number): Promise<Finding[]> {
  const rows = await sql<{ value: Handoff }[]>`SELECT value FROM settings WHERE key LIKE 'agent.wake.%' AND value->>'status'<>'claimed'`;
  return rows.filter(({value: v}) => v.status === "refused" || now-Date.parse(v.attemptedAt ?? v.since) > 30*60_000).map(({value: v}) => ({
    key: `agent.handoff.${v.eventId}`, level: "later", title: `运维尚未确认接手：${v.title}`,
    detail: `${v.eventId}；${v.status === "received" ? "Webhook 已接收，尚无接手回执" : v.status === "refused" ? `Webhook 拒绝（HTTP ${v.response}）` : "Webhook 结果未知或等待核对重投"}；核对任务记录后接手，确认没有运行才重投`,
  }));
}
