// The Monday source-health report for the ops chat. It goes through the same gated channel as the
// alerts (off unless FEISHU_INTERNAL_ENABLED).
import { sql } from "../db.ts";
import { sendAlert } from "../notify/feishu.ts";
import { serverModules } from "../modules.ts";
import { rhythmText, SOURCE_PROBLEMS, sourceHealth, sourceHealthList } from "../sources/health.ts";
import { dismissedFollowUps } from "./alerts.ts";

/** The change from b to a: "+12%", "—" without a b. Also the modules' reports. */
export const pct = (a: number, b: number) => (b ? `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(0)}%` : "—");
/** A count with thousands separators. */
export const n = (v: number) => v.toLocaleString("en-US");

/** Monday 09:00: how the sources did over the last seven days, quiet ones included (the daily follow-ups leave them out). */
export async function sourceHealthWeekly(now = Date.now()) {
  const since = new Date(now - 7 * 86400_000);
  const before = new Date(now - 14 * 86400_000);
  const [[counts], [items], groups, dismissed] = await Promise.all([
    sql<{ enabled: number; failing: number; degraded: number; added: number }[]>`
      SELECT count(*) FILTER (WHERE enabled)::int AS enabled,
             count(*) FILTER (WHERE enabled AND health = 'failing')::int AS failing,
             count(*) FILTER (WHERE enabled AND health = 'degraded')::int AS degraded,
             count(*) FILTER (WHERE created_at >= ${since})::int AS added
      FROM sources`,
    sql<{ week: number; prev: number; selected: number }[]>`
      SELECT count(*) FILTER (WHERE discovered_at >= ${since})::int AS week,
             count(*) FILTER (WHERE discovered_at >= ${before} AND discovered_at < ${since})::int AS prev,
             (SELECT count(*)::int FROM publications p WHERE p.selected AND p.visibility <> 'withdrawn' AND p.discovered_at >= ${since}) AS selected
      FROM articles WHERE discovered_at >= ${before}`,
    sourceHealth(now),
    dismissedFollowUps(),
  ]);
  const lines = [
    `本周收录 ${n(items!.week)} 条（上周 ${n(items!.prev)}，${pct(items!.week, items!.prev)}），其中精选 ${n(items!.selected)} 条`,
    `在用信源 ${counts!.enabled} 个，本周新增 ${counts!.added} 个；抓取失败 ${counts!.failing} 个，不太稳定 ${counts!.degraded} 个`,
  ];
  // The modules' own collectors, a line each.
  for (const m of serverModules()) if (m.sourceHealth) lines.push(...(await m.sourceHealth(now)));
  for (const group of groups) {
    lines.push("", `${group.name}：${group.sources.length} 个在用信源；本周归属条目 ${n(group.sources.reduce((sum, s) => sum + s.items, 0))} 条；连续失败 ${group.failing.length} 个、反复失败 ${group.unstable.length} 个、超出自身更新节奏 ${group.overdue.length} 个、7 天没有新内容 ${group.unknown.length} 个`);
    for (const p of SOURCE_PROBLEMS) {
      if (!group[p.problem].length) continue;
      lines.push(`${p.title}：${sourceHealthList(group[p.problem], s => {
        const dismissal = dismissed[`sources.${p.problem}.${s.id}`];
        return p.describe(s) + (dismissal ? `（已判定不修：${dismissal.reason}）` : "");
      })}`);
    }
    if (group.overdue.length) lines.push(`超出自身更新节奏（先对照原站，区分采集失效与它自己变慢）：${sourceHealthList(group.overdue, rhythmText)}`);
    if (group.unknown.length) lines.push(`7 天没有新内容（窗口内产出历史不足以判断节奏，或从未收到内容）：${sourceHealthList(group.unknown, rhythmText)}`);
  }
  const failing = counts!.failing;
  const overdue = groups.reduce((sum, g) => sum + g.overdue.length, 0);
  // Quiet sources still worth a look: past their own rhythm, or not judgeable.
  const silent = overdue + groups.reduce((sum, g) => sum + g.unknown.length, 0);
  const followUp = counts!.failing > 0 || silent > 0 || groups.some(g => g.failing.length || g.unstable.length || g.quality.length || g.details.length);
  lines.push("", followUp ? "需要处理的话，把这条转给 AI；详情在后台“信源”与“运行”页。" : "没有需要处理的信源。");
  await sendAlert("📊 信源周报", lines);
  return { failing, silent, overdue };
}
