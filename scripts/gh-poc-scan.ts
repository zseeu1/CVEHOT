// 命令行薄壳：逻辑全在 modules/gh-poc-scan/backend/index.ts。
//
// 日常不用手动跑——worker 里有个定时任务 sources.gh-poc-scan 每 30 分钟自己扫一次
// （modules/gh-poc-scan/server.ts），结果记进 job_runs，后台「运行」页可见。
// 这个入口是给试跑、放宽天数、看过滤效果用的。
//
// 用法（在容器里跑；脚本是烤进镜像的，改完要 docker compose up -d --build）：
//   docker compose exec -T worker node scripts/gh-poc-scan.ts --dry-run
//   docker compose exec -T worker node scripts/gh-poc-scan.ts --days 7 --min-stars 3
//
// 在外面手动跑要带推送地址（容器里由 API_BASE_URL 提供）：
//   AIHOT_BASE_URL=http://localhost:3000 node --env-file-if-exists=.env scripts/gh-poc-scan.ts --dry-run

import { main } from "@aihot/gh-poc-scan/backend";

await main();
