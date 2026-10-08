// 扫 GitHub 上「刚出现」的 CVE 仓库，推给站里的 /api/ingest/items（docs/sources.md 的外部推送接口）。
//
// 用法：
//   node --env-file-if-exists=.env scripts/gh-poc-scan.ts                # 最近 2 天新建、名字或描述里带 CVE 编号的仓库
//   node --env-file-if-exists=.env scripts/gh-poc-scan.ts --days 7       # 放宽到 7 天
//   node --env-file-if-exists=.env scripts/gh-poc-scan.ts --dry-run      # 只打印将要推送的条目，不真的推
//   node --env-file-if-exists=.env scripts/gh-poc-scan.ts --min-stars 3  # 只收 3 星以上的仓库
//
// 环境变量：
//   GITHUB_TOKEN     选填，只影响额度：脚本每次运行只发 1 次搜索请求，未认证的 10 次/分钟通常够用；
//                    服务器在共享 IP 后面、或计划跑得很密时再配，配了是 30 次/分钟
//   INGEST_TOKEN     必填，和站里 .env 的 INGEST_TOKEN 一致（至少 16 位）
//   AIHOT_BASE_URL   选填，默认 http://localhost:3000
//
// 建议每 30–60 分钟跑一次（cron）。重复推送不会产生重复条目：站内按规范化后的 URL 判重，
// 而且「原文发布超过 48 小时」的条目按历史归档，不会进「今天」也不推送。
//
// 第一次推送会自动建一个 external 信源 gh-poc-scan，默认是 isolated（不进公开页面）。
// 到后台「信源」页把它的参与方式改成 editorial，精选和日报才会收它。

const CVE_ID = /CVE-\d{4}-\d{4,7}/gi;
/** 这些仓库是「CVE 大全」类聚合仓库，不是新出现的 PoC；同类信息走 RSS 信源更省事。 */
const AGGREGATOR = /(cve-?(list|lists|database|dbs?|search|trends?|scores?|aggregat\w*|awesome)|awesome-cve|poc-?in-?github|trickest)/i;

interface Repo {
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

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const DAYS = arg("days", 2);
const MIN_STARS = arg("min-stars", 0);
const PER_PAGE = Math.min(arg("per-page", 100), 100);
const DRY_RUN = process.argv.includes("--dry-run");

const TOKEN = process.env.GITHUB_TOKEN?.trim() ?? "";
const INGEST_TOKEN = process.env.INGEST_TOKEN?.trim() ?? "";
const BASE = (process.env.AIHOT_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");

const since = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);
const query = `CVE- in:name,description created:>=${since}`;
const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${PER_PAGE}`;

function cveIds(repo: Repo): string[] {
  const text = `${repo.full_name} ${repo.description ?? ""}`;
  return [...new Set((text.match(CVE_ID) ?? []).map((s) => s.toUpperCase()))];
}

function wanted(repo: Repo): boolean {
  if (repo.fork || repo.archived || repo.disabled) return false;
  if (repo.stargazers_count < MIN_STARS) return false;
  if (AGGREGATOR.test(repo.full_name)) return false;
  // 必须真的带 CVE 编号：搜索 "CVE-" 会捞到 cvent、collectors-no-cve 这类噪声。
  return cveIds(repo).length > 0;
}

function toItem(repo: Repo) {
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

async function search(): Promise<{ total: number; items: Repo[] }> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "CVEHOTBot/1.0 (+https://github.com/KKKKhazix/AIHOT)",
  };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(searchUrl, { headers });
  if (!res.ok) {
    const reset = res.headers.get("x-ratelimit-reset");
    const at = reset ? new Date(Number(reset) * 1000).toISOString() : "未知";
    const hint = res.status === 403 || res.status === 429 ? `（限额用尽，重置时间 ${at}；配 GITHUB_TOKEN 可提高限额）` : "";
    throw new Error(`GitHub 搜索失败：HTTP ${res.status} ${hint}\n${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { total_count: number; items: Repo[] };
  return { total: data.total_count, items: data.items ?? [] };
}

async function push(batch: unknown[]): Promise<number> {
  const res = await fetch(`${BASE}/api/ingest/items`, {
    method: "POST",
    headers: { authorization: `Bearer ${INGEST_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ sourceId: "gh-poc-scan", sourceName: "GitHub PoC 扫描", items: batch }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`推送失败：HTTP ${res.status} ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { created?: number }).created ?? 0;
}

async function main() {
  if (!DRY_RUN && (!INGEST_TOKEN || INGEST_TOKEN.length < 16)) {
    console.error("缺 INGEST_TOKEN（至少 16 位），或者加 --dry-run 先看看会推什么。");
    process.exit(1);
  }
  console.log(`查询：${query}（近 ${DAYS} 天）${TOKEN ? "" : "｜没有 GITHUB_TOKEN，限额很低"}`);
  const { total, items } = await search();
  const picked = items.filter(wanted);
  console.log(`搜索命中 ${total} 个仓库，本页 ${items.length} 个，过滤后保留 ${picked.length} 个`);

  if (!picked.length) return;
  const payload = picked.map(toItem);
  if (DRY_RUN) {
    for (const it of payload) console.log(`- ${it.title}\n  ${it.url}  ${it.publishedAt}`);
    return;
  }
  let created = 0;
  for (let i = 0; i < payload.length; i += 50) {
    const batch = payload.slice(i, i + 50);
    created += await push(batch);
    if (i + 50 < payload.length) await new Promise((r) => setTimeout(r, 6500)); // 接口限每分钟 10 次
  }
  console.log(`推送完成：提交 ${payload.length} 条，新建 ${created} 条（其余是已有条目，站内按 URL 判重）。`);
}

await main();
