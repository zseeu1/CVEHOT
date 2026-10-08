// 扫 GitHub 上「刚出现」的 CVE 仓库，推给站里的 /api/ingest/items（docs/sources.md 的外部推送接口）。
//
// 为什么进模块：它原先靠宿主机 cron 每 30 分钟跑一次，而框架自带排程（pg-boss，Asia/Shanghai）。
// 现在由 worker 自己按点触发，结果记进 job_runs、后台「运行」页可见，不用再管宿主机计划任务。
//
// 走的是**原来的 HTTP 推送口**，语义完全不变：外部信源在站里仍然是 `gh-poc-scan`（external），
// 判重按规范化 URL、「原文发布超过 48 小时」按历史归档、参与方式（isolated / editorial）照旧。
// 地址取 AIHOT_BASE_URL → API_BASE_URL（容器里是 http://api:3001）→ http://localhost:3000。
//
// 环境变量：
//   INGEST_TOKEN     必填（至少 16 位），和站里 .env 的 INGEST_TOKEN 一致。没配就不挂定时任务（server.ts 的 when）。
//   GITHUB_TOKEN     选填，只影响额度：每次运行只发 1 次搜索请求，未认证 10 次/分钟通常够用；配了 30 次/分钟。
//   AIHOT_BASE_URL   选填，覆盖推送地址。
//
// 第一次推送会自动建一个 external 信源 gh-poc-scan，默认是 isolated（不进公开页面）。
// 到后台「信源」页把它的参与方式改成 editorial，精选和日报才会收它。

const CVE_ID = /CVE-\d{4}-\d{4,7}/gi;
/** 这些仓库是「CVE 大全」类聚合仓库，不是新出现的 PoC；同类信息走 RSS 信源更省事。 */
const AGGREGATOR = /(cve-?(list|lists|database|dbs?|search|trends?|scores?|aggregat\w*|awesome)|awesome-cve|poc-?in-?github|trickest)/i;

export const SOURCE_ID = "gh-poc-scan";
export const SOURCE_NAME = "GitHub PoC 扫描";

export interface Repo {
  full_name: string;
  html_url: string;
  description: string | null;
  created_at: string;
  pushed_at: string;
  stargazers_count: number;
  fork: boolean;
  archived: boolean;
  disabled?: boolean;
  owner: { login: string } | null;
}

export interface ScanOptions {
  /** 只看这个天数内新建的仓库。 */
  days?: number;
  minStars?: number;
  perPage?: number;
  /** 只打印不推送。 */
  dryRun?: boolean;
  /** 推送地址；不给就按 AIHOT_BASE_URL → API_BASE_URL → localhost:3000 找。 */
  baseUrl?: string;
  /** 推送凭据；不给就读 INGEST_TOKEN。 */
  ingestToken?: string;
  onProgress?: (message: string) => void;
}

export interface ScanResult {
  total: number;
  seen: number;
  picked: number;
  pushed: number;
  created: number;
  query: string;
}

function resolveBase(explicit?: string): string {
  const base = explicit?.trim() || process.env.AIHOT_BASE_URL?.trim() || process.env.API_BASE_URL?.trim() || "http://localhost:3000";
  return base.replace(/\/$/, "");
}

export function cveIds(repo: Repo): string[] {
  const text = `${repo.full_name} ${repo.description ?? ""}`;
  return [...new Set((text.match(CVE_ID) ?? []).map((s) => s.toUpperCase()))];
}

function wanted(repo: Repo, minStars: number): boolean {
  if (repo.fork || repo.archived || repo.disabled) return false;
  if (repo.stargazers_count < minStars) return false;
  if (AGGREGATOR.test(repo.full_name)) return false;
  // 必须真的带 CVE 编号：搜索 "CVE-" 会捞到 cvent、collectors-no-cve 这类噪声。
  return cveIds(repo).length > 0;
}

export function toItem(repo: Repo, query: string) {
  const ids = cveIds(repo).join(" ");
  const desc = (repo.description ?? "").replace(/\s+/g, " ").trim();
  const title = (desc ? `${repo.full_name}：${desc}` : `${repo.full_name}（${ids}）`).slice(0, 300);
  return {
    title,
    url: repo.html_url,
    publishedAt: repo.created_at,
    author: repo.owner?.login ?? null,
    raw: { _aihot: { scan: { cve: ids, stars: repo.stargazers_count, query } } },
  };
}

async function search(query: string, perPage: number): Promise<{ total: number; items: Repo[] }> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${perPage}`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "CVEHOTBot/1.0 (+https://github.com/KKKKhazix/AIHOT)",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const reset = res.headers.get("x-ratelimit-reset");
    const at = reset ? new Date(Number(reset) * 1000).toISOString() : "未知";
    const hint = res.status === 403 || res.status === 429 ? `（限额用尽，重置时间 ${at}；配 GITHUB_TOKEN 可提高限额）` : "";
    throw new Error(`GitHub 搜索失败：HTTP ${res.status} ${hint}\n${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { total_count: number; items: Repo[] };
  return { total: data.total_count, items: data.items ?? [] };
}

async function push(base: string, token: string, batch: unknown[]): Promise<number> {
  const res = await fetch(`${base}/api/ingest/items`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ sourceId: SOURCE_ID, sourceName: SOURCE_NAME, items: batch }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`推送失败：HTTP ${res.status} ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { created?: number }).created ?? 0;
}

/** 定时任务调这个。 */
export async function scan(options: ScanOptions = {}): Promise<ScanResult> {
  const { days = 2, minStars = 0, perPage = 100, dryRun = false, baseUrl, ingestToken, onProgress } = options;
  const token = (ingestToken ?? process.env.INGEST_TOKEN ?? "").trim();
  const base = resolveBase(baseUrl);
  if (!dryRun && (!token || token.length < 16)) {
    throw new Error("缺 INGEST_TOKEN（至少 16 位）。在 .env 里配上再重启 worker，或者加 --dry-run 先看看会推什么。");
  }

  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const query = `CVE- in:name,description created:>=${since}`;
  onProgress?.(`查询：${query}（近 ${days} 天）${process.env.GITHUB_TOKEN ? "" : "｜没有 GITHUB_TOKEN，限额很低"}`);

  const { total, items } = await search(query, Math.min(perPage, 100));
  const picked = items.filter((repo) => wanted(repo, minStars));
  onProgress?.(`搜索命中 ${total} 个仓库，本页 ${items.length} 个，过滤后保留 ${picked.length} 个`);
  if (!picked.length) return { total, seen: items.length, picked: 0, pushed: 0, created: 0, query };

  const payload = picked.map((repo) => toItem(repo, query));
  if (dryRun) {
    for (const it of payload) console.log(`- ${it.title}\n  ${it.url}  ${it.publishedAt}`);
    return { total, seen: items.length, picked: picked.length, pushed: 0, created: 0, query };
  }

  let created = 0;
  for (let i = 0; i < payload.length; i += 50) {
    created += await push(base, token, payload.slice(i, i + 50));
    if (i + 50 < payload.length) await new Promise((r) => setTimeout(r, 6500)); // 接口限每分钟 10 次
  }
  return { total, seen: items.length, picked: picked.length, pushed: payload.length, created, query };
}

// ── 下面只有命令行用（scripts/gh-poc-scan.ts 是它的薄壳）──────────────────────────────────

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export async function main(): Promise<void> {
  const result = await scan({
    days: arg("days", 2),
    minStars: arg("min-stars", 0),
    perPage: arg("per-page", 100),
    dryRun: process.argv.includes("--dry-run"),
    onProgress: (m) => console.log(m),
  });
  if (result.pushed) console.log(`推送完成：提交 ${result.pushed} 条，新建 ${result.created} 条（其余是已有条目，站内按 URL 判重）。`);
}
