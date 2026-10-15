# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

以下是 AGENTS.md 没写、但在这个仓库里干活要知道的事。

## 这是哪个站

CVEHOT：基于上游 AIHOT（`upstream` 远端，<https://github.com/KKKKhazix/AIHOT>）改成的漏洞情报站。引擎基本没动，改的是 `industry/`、`site/` 和两个模块。行业包改了什么、为什么改，记录在 `docs/cve-pack.md`，动分类、信源、提示词前先读它。

- 引擎代码里的本地补丁（`git merge upstream/main` 后逐个核对，上游改名或重写时会被静默覆盖）：
  - `packages/contracts/src/taxonomy.ts` 的 `CHANNEL_LABELS.firstParty`、`ReportPaper.tsx`、`routes/story.tsx`：「一手」→「权威源」，只改显示名，判定仍是 `tier = 'T1'`
  - `packages/backend/src/reports/compose.ts` 的 `dailyMetrics()` 加了 `exploited`，配套 `apps/web/app/features/report/format.ts` 的 `METRICS` 和 `site/site.ts` 的 `metricUnits.exploited`
  - `apps/web/app/components/ui/Score.tsx`、`routes/item.tsx`：「AI 评分」→「模型评分」（上游没有配置钩子）
  - `site/brand/nameplates/*.svg` 报头字曾被上游的改名合并覆盖过一次
- `industry/prompts/structure.md` 等提示词曾是「上游 AI 原文 + 末尾追加 CVE 规则」，残留 AI 口径会让模型拿到自相矛盾的说明。改提示词时整段检查，不要只在末尾追加。
- 预筛、评分、归组、归组复核可以配成 Jev（`site/models.ts` 里 `typed: true`）。Jev 不读提示词，问题集在 `packages/backend/src/editorial/jev.ts`；改这四步的判断口径时两边一起改。
- 改了分类、标签或内容类型后跑 `node scripts/check-cve-pack.ts`（只读自检，指出哪个文件哪一项对不上）。

## 模块

- `modules/cve-repo-index/`：一个模块两件事。① **新 PoC 推送源**：每小时扫 GitHub 新建的 CVE 仓库推进站里，排程任务名 `sources.gh-poc-scan`（2026-10-12 前这是个独立模块 `modules/gh-poc-scan/`，已并入，任务名保留以接上 `job_runs` 历史；它取代了已停用的 `json-gh-new-cve-repos` 信源），命令行薄壳 `scripts/gh-poc-scan.ts`。② **历史索引**：自己的表 `cve_repos`，按编号统计 PoC 仓库数，不进精选/归组/日报，零模型调用。⚠️ 索引**没有独立的定时任务**了 —— 并入时把原「每天 05:20 增量」（`cve.repo-index`）去掉了，因为每小时那次扫的是同一批仓库、也全部收进索引；要加深历史只能手动 `--backfill`。它的迁移历史上放在 `database/migrations/0900_cve_repos.sql`（已发布，不挪），模块以后新增的表放 `modules/<名字>/migrations/`。命令行在 `scripts/cve-repo-index.ts`（`--lookup <编号> [--live]`、`--stats`、`--backfill`）。
- 模块只在 `site/modules/{index,server,web}.ts` 三份清单里登记，框架代码不导入模块。新模块还要加到 `site/package.json` 的依赖和 `Dockerfile` 的 `COPY`。

## 命令补充

- 开发热更新：`npm run dev:api`、`npm run dev:worker`、`npm run dev:web`（web 在 3000）。`.env` 里 `DEV_AUTH_ROLE=admin` 可免登录进后台。
- 迁移：`npm run db:migrate`。新迁移的在线安全检查：`node scripts/check-migrations.ts --base <基线提交>`（CI 会跑）。
- 跑单个后端测试文件（仍需测试库，preload 负责复制模板库）：
  ```bash
  DATABASE_URL=postgres://127.0.0.1:5432/cvehot_test node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test tests/events.test.ts
  ```
- 不需要数据库的测试是 `*.standalone.test.ts`：`npm run test:standalone`。
- 网页测试用 Playwright（chromium、webkit），先 `npx playwright install chromium webkit`，且要先 build web。
- MCP 检查：站点跑起来后 `node scripts/mcp-check.ts http://127.0.0.1:3000/api/mcp`。
- `tests/architecture.test.ts` 检查模块边界，调整边界时同时改它。
- `tests/` 和 `apps/web/tests/` 的夹具里还残留 AI 行业的值（`模型发布`、`model_release` 等），typecheck 不报；测试失败时先看是不是这类夹具。
