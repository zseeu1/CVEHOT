# log.md — CVEHOT 工作日志（AIHOT → CVE 监控站）

> 给下一个接手的人或 agent。**最后更新：2026-10-08 15:55 (+08:00)**
> 详细说明在 [docs/cve-pack.md](docs/cve-pack.md)，本文是进度、现状与踩过的坑。

## 0. 一句话现状

站点**已经在跑**：`/Users/star/notes/AIHOT`，Docker 本机 http://localhost:3000（后台 `/admin`）。
9 个信源全部抓取正常，库里 148 条资料 / 113 条已分析 / 19 条精选。行业包已从「AI 新闻」改成「漏洞情报」。

**2026-10-08：仓库已升到上游 4.0.0（69 个提交）。** 代码侧 `npm run typecheck`（七个工程）与行业包自检全过。
⚠️ **容器还是 4 天前的旧镜像，尚未重启** —— 重启与数据库迁移步骤见 §8，动手前先看 §7 第 1、2 条。

## 1. 目标与边界

- 上游：`KKKKhazix/AIHOT`（AI 热点站框架，MIT）。链路是：多信源采集 → LLM 预筛 + 独立两次打分 → 中文标题摘要 → 同事件聚簇 → 热度榜 → 每日 08:00 日报，对外有 RSS / 公开 API / MCP / 飞书推送。
- 本次目标：把它改成盯 **GitHub 上出现的 CVE 与漏洞情报**的站。
- **不是**漏洞扫描器：不做资产比对、不做秒级告警。定位是「每天一份可读的漏洞要点」。要告警请另配 OSV-Scanner / Dependabot，两者互补。

## 2. 环境现状（2026-10-03 实测，2026-10-08 更新）

| 项 | 状态 |
|---|---|
| 仓库 | `/Users/star/notes/AIHOT`，`main` = `9dd3b0b`（2026-10-08 合并上游 4.0.0 后），**完整历史**。回退点：升级前基线 `5ff86e1`、更早的 `c3ba0ca` |
| Node | v24.19.0；`node_modules` 已装（**只给 typecheck 等开发操作用**，容器内自带依赖） |
| `.env` | 已生成。已设置：`ADMIN_PASSWORD`、`POSTGRES_PASSWORD`、`LLM_API_KEY`（DeepSeek）、`INGEST_TOKEN`(64 字符)。**`GITHUB_TOKEN` 未设置**（可选，见下） |
| 模型 | `LLM_BASE_URL=https://api.deepseek.com/v1`，`LLM_MODEL=deepseek-flash` |
| 容器 | `db` healthy、`api`/`worker`/`web` 均在跑（`setup` 跑完即退出，正常）。⚠️ 跑的是 **4 天前的旧镜像**，磁盘上已是 4.0.0 代码，待重建重启 |
| 信源 | 9 个：8 个预置 + `gh-poc-scan`，全部 `editorial` + `enabled` + `health=ok` |
| 数据 | articles 148 / analyses 113 / selected 19 / public 113 |
| 未做 | `npm test`（需独立测试库）、精选门槛校准、公众号接入 |

`GITHUB_TOKEN` 不配也够用：8 个预置信源里只有 `json-ghsa-api`、`json-gh-new-cve-repos` 走 GitHub API，合计约 72 次/天，未认证额度（核心 60 次/小时、搜索 10 次/分钟，按 IP 算）够。服务器在共享 IP 后面、或要加更多 GitHub 信源时再配。

## 3. 已完成

### a. CVE 行业包（`industry/` + `site/`，2026-10-08 上游拆分后）

| 文件 | 改了什么 |
|---|---|
| `site.ts` → **现在在 `site/site.ts`** | 站名 `CVEHOT`、行业词「漏洞」、`mcpPrefix=cvehot`、关于页文案（2026-10-08 上游把「站点自己的文件」从 `industry/` 搬到 `site/`） |
| `taxonomy.ts` | 6 个分类（在野利用/PoC·复现/漏洞通告/供应链/攻击事件/行业与政策）、7 个内容类型、9+26+16 个标签、107 条近义词、16 个厂商实体 |
| `topics.json` | 29 个主题页（厂商组件 13 / 漏洞类型 10 / 情报形态 6），related 无悬空 |
| `sources.json` | 8 个信源（见 §4） |
| `prompts/` | 27 份提示词，重点改了 `selection-score.md`（五轴改成漏洞口径 + 7 类权重表）、`prefilter.md`、`content-understanding.md`、`rules-domain.md`（编号/CVSS 向量/版本号/状态词固定译法）、`group-definitions.md`（**同一编号即同一事件**）等 10 份 |
| `selection.ts` | 门槛 T1 58 / T1_5 62 / T2 72，`understandFloor` 45（**起手值，未校准**） |
| ~~`features.ts`~~ | **已随上游 4.0.0 删除**（模型榜与 Codex 重置监控整体移出框架） |
| `brand/nameplates/*.svg` → **现在在 `site/brand/nameplates/`** | 用新行业词重新生成（现在显示「漏洞日报」）。⚠️ 2026-10-08 合并时**被上游版本静默覆盖过一次**，已恢复，见 §9 |

### b. GitHub PoC 扫描（模块 `modules/gh-poc-scan/`）

按 `CVE- in:name,description created:>=N天前` 搜仓库，过滤 fork/归档/0 星和 `cve-list`/`awesome-cve`/`poc-in-github` 这类聚合仓库，并要求名字或描述里真的有 `CVE-YYYY-NNNN`。推送走 `POST /api/ingest/items`，50 条一批、7 秒间隔（接口限每分钟 10 次）。

**已从「靠宿主机 cron 的脚本」改成模块 + 框架内置排程**：`sources.gh-poc-scan`，每 30 分钟（`*/30 * * * *`，Asia/Shanghai）由 worker 自己触发，结果进 `job_runs`、后台「运行」页可见。**不再需要任何宿主机计划任务。**
`when: hasIngestToken` —— 没配 `INGEST_TOKEN` 时干脆不挂这个任务，免得每半小时往 `job_runs` 里堆一条失败记录。
`scripts/gh-poc-scan.ts` 只剩薄壳（逻辑在 `modules/gh-poc-scan/backend/index.ts`），留给试跑用。

实测（2026-10-08，容器内）：近 2 天命中 198 个仓库 → 本页 100 个 → 过滤后 39 个 → 推送后新建 35 条。
**不做过滤会灌进大量噪声**（`cvent`、`collectors-no-cve-xxx`）。

### c. 框架里写死的 AI 文案（已被上游配置化，本表作废）

> ⚠️ **2026-10-08 起本表整体作废。** 上游 4.0.0 已把这些写死的文案**全部改成从 `site/site.ts` 读取**：`REPORTS.motto` / `REPORTS.descriptions` / `REPORTS.entry` / `REPORTS.metricUnits` / `REPORTS.quiet`、`ITEM_COPY.showScore`、`EDITION_TIMES` / `EDITION_WHEN`、`subjectAfter()`。下面这些手改已被上游版本覆盖，**不要再照本表改代码**；现在换行业只需动 `site/site.ts` 一个文件。唯一仍要改代码的是 `AI 评分` → `模型评分`（上游把它硬编码在 `components/ui/Score.tsx` 与 `routes/item.tsx`，没有配置钩子）。

| 文件 | 改动 |
|---|---|
| `apps/web/app/features/report/format.ts` | 报头箴言、`N 件 AI 大事`→`N 件漏洞大事`、指标 `modelsReleased`→`exploited`（条在野利用） |
| `apps/web/app/features/report/ReportPaper.tsx` | 报头与往期列表的「AI 日报」→ `withSubject("日报")` |
| `apps/web/app/routes/report-latest.tsx` | 页面标题里的「AI 日报」 |
| `apps/web/app/routes/hot.tsx` | 「AI 圈讨论最多的」 |
| `apps/web/app/components/ui/Score.tsx`、`routes/item.tsx` | 「AI 评分」→「模型评分」 |
| `packages/backend/src/reports/compose.ts` | 指标 `modelsReleased` → `exploited`，取「在野利用与紧急处置」节的数量 |
| `packages/backend/src/publication/items.ts`、`apps/api/src/routes/v1.ts` | 删掉旧分类 `tip`/`opinion` 特判（**不改会编译报错**），v1 分类 fallback 改成第一个类别 |

### d. 新增：GitHub CVE 仓库索引（学自 buaq.net/cve）

**已做成模块**：`modules/cve-repo-index/`（`module.ts` / `server.ts` / `backend/index.ts`），在 `site/modules/{index,server}.ts` 三份清单里登记，表 `cve_repos`（`database/migrations/0900_cve_repos.sql`，编号取 0900 远离上游序列防撞号）。
`scripts/cve-repo-index.ts` 只剩一个薄壳（逻辑在模块里）。

**日常维护是自动的**——模块用**框架内置的排程**注册了 `cve.repo-index`，每天 05:20（Asia/Shanghai）由 worker 自己拉增量，
**不需要宿主机 cron / launchd**，也不需要手动跑。执行结果记进 `job_runs`，后台「运行」页可见；`missed: "once"` 保证停机错过时点后补跑。

```sql
-- 看排程挂上没有（应有一行 cron.cve.repo-index）
SELECT name, cron, timezone FROM pgboss.schedule WHERE name LIKE '%cve%';
```

补的是**历史纵深**：`gh-poc-scan.ts` 和 `json-gh-new-cve-repos` 都只看最近几天新出现的仓库，回答不了
「CVE-2026-21589 到现在一共有多少个 PoC」。这个旁路把 GitHub 搜索语料收进自己的表，
按编号查得到一个明确数字；**不进任何流水线、零模型调用**。

```bash
# 只在这三种场合手动跑（日常增量已经自动）
docker compose exec -T worker node scripts/cve-repo-index.ts --lookup CVE-2026-21589 --live  # 实时权威数量
docker compose exec -T worker node scripts/cve-repo-index.ts --lookup CVE-2026-21589        # 查索引（不联网）
docker compose exec -T worker node scripts/cve-repo-index.ts --stats                          # 看覆盖情况
docker compose exec -T worker node scripts/cve-repo-index.ts --backfill --from-year 2020 --pages 5  # 想加深历史才跑
```

实测：`--lookup CVE-2026-21589 --live` → `total_count = 9`（Atlassian DC 越权读，2026-10-07 起陆续出现）。

⚠️ **两个坑**：① **GitHub 搜索单查询上限 1000 条**，按月切片后繁忙月份仍会超（2026-05 有 2295 条），
所以索引是「抽到的最新一批」不是全量普查，要准确数量用 `--live`；② **背填占的是站点信源同一个未认证额度**
（搜索 10 次/分钟），背填前先配 `GITHUB_TOKEN`，否则慢且可能挤掉信源。

### d2. 新增文档与脚本

- [`docs/cve-pack.md`](docs/cve-pack.md)：信源表、评分口径、校准方法、代码改动清单、已知缺口
- [`scripts/check-cve-pack.ts`](scripts/check-cve-pack.ts)：行业包自检（配置项白名单、词表一致性、权重表和、提示词引用）

## 4. 信源清单与实测结论

| id | 内容 | kind | tier | 间隔 | 实测 |
|---|---|---|---|---|---|
| `rss-ghsa-db` | GitHub Advisory Database 提交流 | rss | T1 | 30m | 200 ✓ |
| `rss-cvelistv5` | CVE Program 官方记录 | rss | T1 | 30m | 200 ✓ |
| `rss-ossf-malicious-packages` | OpenSSF 供应链恶意包库 | rss | T1 | 120m | 200 ✓ |
| `rss-poc-in-github` | 每天新出现的 CVE PoC 汇总 | rss | T2 | 60m | 200 ✓ |
| `rss-trickest-cve` | 带 PoC/细节的 CVE 索引 | rss | T2 | 120m | 200 ✓ |
| `json-ghsa-api` | GitHub 安全公告 REST API | json_list | T1 | 30m | 200 ✓（自动带 `GITHUB_TOKEN`，若配置） |
| `json-cisa-kev` | CISA 已知被利用清单 | json_list | T1 | 120m | 200 ✓（1733 条，48h 规则只放行新条目） |
| `json-gh-new-cve-repos` | GitHub 新建的 CVE 仓库 | json_list | T2 | 60m | 200 ✓ |
| `gh-poc-scan` | 外部推送（脚本 b） | external | T2 | — | 已推 40 条 |

### 试过但**不要用**的地址（别重复踩）

| 地址 | 结果 |
|---|---|
| `https://github.com/advisories.atom` | **406**（部分网络/IP 被拒），所以用 advisory-database 的 commits 流替代 |
| `https://cert.360.cn/` | **TLS 证书已过期**，连不上 |
| `https://ti.qianxin.com/advisory/` | 能开，但是 **2020 年就停更**的旧漏洞库 |
| `https://services.nvd.nist.gov/rest/json/cves/2.0` | 本机**连不通**；NVD 也早已没有官方 RSS |
| `https://wechat.doonsec.com/rss/<biz>.xml` | 200 但**零条目**（全站 `/rss.xml` 才可用） |

### 公众号（已决定暂不接入）

奇安信 CERT = `gh_64040028303e`，360漏洞研究院 = `gh_9dfd76b8e0c2`（来源：doonsec 的公众号档案页，它把「微信号/Biz」列出来了）。要走极致了（Dajiala）按次付费；`mp_account` 类型的 config **只接受 `wxid`/`ghid`/`nickname` 三个键**，写 `_aihot` 会被拒。免费替代：wechat2rss 公开实例覆盖 395 个号，**但没有这两个**，有绿盟科技CERT、微步在线研究响应中心、奇安信威胁情报中心、360漏洞云等（feed URL 见 `docs/cve-pack.md`），注意这些 feed 是 4MB 级、带全文，首包必须限 `_aihot.initialBackfillLimit`。

## 5. 验证记录

- ✅ `npm run typecheck` 通过（contracts / backend / api / worker / tests / web 六个工程）
- ✅ `node scripts/check-cve-pack.ts` 全部通过
- ✅ `node scripts/gh-poc-scan.ts --days 3 --dry-run` 通过
- ✅ **在容器里**验证过文档中的两条命令：`docker compose exec -T -e AIHOT_BASE_URL=http://web:3000 api node scripts/gh-poc-scan.ts --days 1 --dry-run`（近 1 天命中 115 个仓库、过滤后 41 个）、`docker compose exec -T worker node scripts/enqueue-analysis.ts --limit 0`（输出 `enqueued 0`，说明模块和数据库连接都正常）
- ✅ 端到端跑通：8 个预置信源 `fetch_runs` 全 `ok`，条目入库 → 分析 → 精选 → 公开（数字见 §2）
- ❌ **`npm test` 没跑**：需要 `docker compose` 里那个 Postgres 之外的独立测试库，且 `tests/` 夹具仍有 AI 行业词，见 §7

**2026-10-08（升级到上游 4.0.0 后重跑）**

- ✅ `npm run typecheck` 通过：contracts / backend / api / worker / tests / **modules**（上游新增）/ web 七个工程
- ✅ `node --experimental-strip-types scripts/check-cve-pack.ts` 全部通过（8 信源 / 6 类目 / 29 主题 / 28 份提示词 / 权重表和）
- ✅ 18 个合并冲突全部解决，工作区干净
- ✅ 全量核对：`Dockerfile` / `package.json` / `docker-compose.yml` / `.env.example` 与上游**无差异**；workspaces 已含 `modules/*`
- ❌ 容器未重启、迁移未跑、**数据库未备份**（见 §8）
- ❌ `npm test` 仍未跑

## 6. 改东西前必读的机制

- **要挂定时任务别用宿主机 cron**：框架自带排程（pg-boss，Asia/Shanghai）。做成模块，在它的 `server.ts` 里写 `schedules: [{ name, cron, run, missed, when }]`，在 `site/modules/server.ts` 登记，worker 启动时自动装上；结果进 `job_runs`、后台「运行」页可见。参考 `modules/cve-repo-index/`（每天 05:20 拉索引增量）和 `modules/gh-poc-scan/`（每 30 分钟扫新 PoC，带 `when` 条件开关）。
- **2026-10-08 起分两个文件夹**：`industry/` 只放**行业知识**（`taxonomy.ts` / `topics.json` / `sources.json` / `prompts/` / `selection.ts`），`site/` 放**站点自己的东西**（`site.ts` / `models.ts` / `brand/` / `pages/` / `public/` / `changelog.json` / `modules/` 清单）。改信源、提示词、门槛、分类、站名、文案都不用动代码。提示词里的 `{{siteName}}`、`{{> 文件名}}` 是占位符。导入路径：`@aihot/industry/site` → **`@aihot/site`**。
- **改 `industry/` 后必须 `docker compose up -d --build`**：代码和提示词是烤进镜像的，没有 bind mount，重启不生效。只改 `.env` 用 `docker compose up -d` 即可（compose 会自己重建容器）。
- **分类 key 会进 URL**（`/all?category=…`、`/feed/category/<key>.xml`），上线后别改。
- **`scripts/seed.ts` 只在信源不存在时插入**，后台改过的不会被覆盖。
- **参与方式**：`editorial`=精选 / `hot_signal`=氛围（只作热度证据）/ `isolated`=隔离（不进公开页面）。
- **隔离源进来的条目只记录、不分析**（`settleNonEditorial` 标记 skipped）。把源改成 `editorial` 后，后台会自动排 `republishSource` 重算可见性，但**那批老条目没有中文标题摘要，仍然进不了「全部动态」**——必须补跑 `node scripts/enqueue-analysis.ts`（默认只挑 editorial 源里还没分析过的）。
- **48 小时规则**：首次发现时原文已发布超过 48 小时的不进「今天」、不推送（防首次导入刷屏）。
- **抓取频率**：短的 15 分钟，免费源最长 60 分钟，付费源 120–180 分钟。
- **判重按规范化 URL**；热点按「独立来源数」算，同一家发十篇也只算一次。

## 7. 待办

1. **【最要紧】重启容器 + 跑迁移**。代码已是 4.0.0，容器还是旧镜像。⚠️ **迁移 `0053` 会 DROP 掉 `lb_*` / `monitor_*` / `fx_rates` 三张表**（上游 4.0.0 移除模型榜与 Codex 监控），而且 **`.env` 里没配 `DB_BACKUP_STORE_*`，自动备份是关的**，所以必须先手动 dump。完整顺序见 §8「升级 / 重启到 4.0.0」。
2. **`npm test` 未跑**。类型错误已清（`ai-models`→`advisory`、`ai-products`→`poc`，40 处 / 28 文件；`category-corrections.test.ts` 里断言 `modelsReleased` 的用例已改写为断言 `exploited`），但 `tests/` 与 `apps/web/tests/` 里**还有 AI 行业的文案值**（`模型发布`、`itemType: "model_release"`、`"tip"`、`"drop"`、`"model"` 等）—— 它们不是类型错误，所以 typecheck 不报，**只有连上数据库跑一遍才知道哪些会失败**。按 `docs/customize.md`：把例子换成漏洞行业的对应项即可，规则本身不用改。跑测试需要一个库名以 `_test` 或 `_ci` 结尾的独立数据库。
3. **门槛未校准**：T1 58 / T1_5 62 / T2 72 是起手值。做法：挑 100–200 条自己标「该选/不该选」写成 `.data/gold.jsonl`（格式见 `industry/gold.example.jsonl`）→ `node --env-file=.env scripts/eval-selection.ts --gold .data/gold.jsonl` → 看后台 SelectBench 逐条复盘。判错重灾区通常是「厂商营销混在通告里」和「没有影响版本的传闻」。
4. **待你决定的文案**：`routes/story.tsx` 与 `routes/item.tsx` 里的「AI 导读」「AI 综述」没改 —— 这两处说的是「模型生成的内容」，语义上是对的，要不要跟着变成「模型导读 / 模型综述」由你定。
5. **CVE 仓库索引想加深历史**：现在是 2024 起、每月页数少（5716 行 / 3055 个编号）。要更全可跑 `--backfill --from-year 2020 --pages 5`（配了 `GITHUB_TOKEN` 才快）。
7. 可选：接入中文厂商通告信源；把索引做到网页上（现在只有 CLI，见 `docs/cve-pack.md`）。

## 8. 常用命令

```bash
cd /Users/star/notes/AIHOT

# 起站 / 重建（改了 industry/ 或 site/ 必须 --build）
docker compose up -d --build
docker compose ps
docker compose logs -f worker

# 开发侧校验
npm run typecheck
node scripts/check-cve-pack.ts

# 推送 GitHub 上的新 CVE 仓库（容器里跑，注意 base URL 是 web:3000）
docker compose exec -T -e AIHOT_BASE_URL=http://web:3000 api node scripts/gh-poc-scan.ts --days 1 --dry-run

# CVE 仓库索引（详见 §3d）
docker compose exec -T worker node scripts/cve-repo-index.ts --lookup CVE-2026-21589 --live
docker compose exec -T worker node scripts/cve-repo-index.ts --days 3
docker compose exec -T worker node scripts/cve-repo-index.ts --stats

# 给某个源补分析（例如刚把 isolated 改成 editorial）
docker compose exec -T worker node scripts/enqueue-analysis.ts --limit 500

# 看它还活着吗
docker compose exec -T db psql -U aihot -d aihot -c \
  "SELECT (SELECT count(*) FROM articles) AS articles, (SELECT count(*) FROM analyses) AS analyses, (SELECT count(*) FROM publications WHERE selected) AS selected;"
docker compose exec -T db psql -U aihot -d aihot -c \
  "SELECT source_id, status, new_count, started_at FROM fetch_runs ORDER BY id DESC LIMIT 10;"
```

### 升级 / 重启到 4.0.0（还没做，顺序别改）

```bash
cd /Users/star/notes/AIHOT

# 0. 构建新镜像（旧容器继续跑，线上不受影响）
docker compose build

# 1. 【必做】备份数据库 —— .env 里没配 DB_BACKUP_STORE_*，自动备份是关的
docker compose exec -T db pg_dump -U aihot aihot | gzip > ~/cvehot-$(date +%F).sql.gz
ls -lh ~/cvehot-*.sql.gz          # 确认有内容再往下

# 2. 停旧服务（worker 有 stop_grace_period: 210s，会自己等够，别手动 kill）
docker compose stop api worker web

# 3. 跑迁移 + 启动（迁移 0053 会 DROP lb_* / monitor_* / fx_rates）
docker compose run --rm setup && docker compose up -d

# 4. 看日志确认
docker compose logs -f --tail 100 api worker web
```

**回退**（出问题的话）：`git reset --hard 5ff86e1` 回到升级前，或从
`~/notes/AIHOT-升级前备份-20261008.bundle` 重新 clone。数据库用第 1 步的 `.sql.gz` 恢复。

## 9. 给下一个 agent 的提醒

- **别打印 `.env` 的内容**，里面有 `LLM_API_KEY`、`ADMIN_PASSWORD`、`INGEST_TOKEN`。要报告状态时只说「已设置 / 空」。
- 判断 GitHub 可达性别用 `curl` 直连：本机 `raw.githubusercontent.com` 会超时（`cdn.jsdelivr.net` 正常），但仓库的 RSS/Atom 是通的，别据此判定「网络不通」。
- `advisories.atom` 返回 406 不是配置错，是这个地址在当前网络被拒。
- 改 `ITEM_TYPES` 要**同时**改 `prompts/content-understanding.md` 和 `prompts/selection-score.md` 的权重表，否则 `z.enum` 与权重表会对不上——`check-cve-pack.ts` 会替你查出来。
- 改 `CATEGORIES` 会让分节相关的地方失效。上游 4.0.0 已把 `SECTION_OF.<key>` 换成 `sectionOf()` + `SECTION_ORDER`，并按 `e.category` 计数；本包的报眼指标「条在野利用」就是 `packages/backend/src/reports/compose.ts` 的 `dailyMetrics()` 里 `main.filter((e) => e.category === "exploited").length` —— **改 `exploited` 这个 key 要同时改这里**。
- ⚠️ **升级时别只看「冲突列表」**。2026-10-08 踩过：上游把 `industry/brand/nameplates/*.svg` **改名**到 `site/brand/`、内容一字未改，而我们改过这几个文件 → **git 的改名识别直接取了上游版本，没报冲突，CVEHOT 报头字被静默覆盖**。以后升级务必再跑一遍**逐文件三版本哈希比对**（基线 / 自己的提交 / `origin/main` vs 合并后的实际文件），不能只看 `git diff --diff-filter=U`。
- 重新生成日报报头字需要 `opentype.js`（devDependency，**生产镜像里被 prune 掉了**），只能在本地跑：`npm pack @fontsource/noto-sans-sc@5.3.0 && tar xzf fontsource-noto-sans-sc-5.3.0.tgz && node scripts/nameplates.ts package`。

## 10. 时间线

- **2026-09-30**：克隆仓库；通读 `industry/` 与采集器源码；实测一批 CVE 信源可达性；写出 CVE 行业包（信源/分类/主题/提示词/门槛）、PoC 扫描脚本、修掉框架里写死的 AI 文案；重新生成报头字；`npm run typecheck` 通过。
- **2026-10-03**：`init-env` 生成 `.env`；`docker compose up -d --build` 起站；建 `gh-poc-scan` 源（editorial）并首次推送；端到端验证通过（9 个信源全 ok，148 条资料 / 113 条分析 / 19 条精选）；自检脚本落进仓库、补写本文档。
- **2026-10-08**：先把 31 个未提交改动收成基线提交 `5ff86e1`（并设了仓库级 git 身份，原来是空的）；`git fetch --unshallow` 拿到完整历史；合并上游 69 个提交（`6e67a9d9`），18 个冲突全部解决；**发现并恢复被静默覆盖的 CVEHOT 报头字**；把站点身份全部搬到 `site/site.ts`；把报眼指标「条在野利用」在 4.0.0 新架构里接回；提示词按「上游新版 + 追加 CVE 规则」合；tests 夹具类目改 40 处。`main` = `9dd3b0b`。`npm run typecheck` 七工程全过、行业包自检全过。**容器尚未重启，迁移与数据库备份待做**（见 §7 第 1 条、§8）。
- **2026-10-08（傍晚）**：他重启容器到 4.0.0，验证通过——57 个迁移全部应用、`lb_*`/`monitor_*`/`fx_rates` 已删、站点 200、数据 958 条。随后按 buaq.net/cve 的思路做出 **CVE 仓库索引旁路**（`scripts/cve-repo-index.ts` + 迁移 `0900_cve_repos.sql`，`--live` 实测返回 `total_count = 9`）。他把 `GITHUB_TOKEN` 配好并自己跑完背填（5716 行 / 5165 仓库 / 3055 编号，覆盖 2024-01~2026-10）。**随后把索引做成模块 `modules/cve-repo-index/`**，用框架内置排程注册 `cve.repo-index`（每天 05:20 Asia/Shanghai）——日常维护不再需要宿主机 cron。`pgboss.schedule` 已见 `cron.cve.repo-index`，typecheck 七工程全过。
- **2026-10-08（晚）**：把 `gh-poc-scan` 也搬成模块 `modules/gh-poc-scan/`，排程 `sources.gh-poc-scan`（每 30 分钟，`when` 看 `INGEST_TOKEN`）。**至此两个原先要靠宿主机 cron 的活儿都进了框架排程。** 实测容器内推送：39 条提交 / 35 条新建；`pgboss.schedule` 已见 `cron.sources.gh-poc-scan | */30 * * * *`。
