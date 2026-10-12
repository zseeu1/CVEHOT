// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import cveRepoIndex from "@aihot/cve-repo-index/server";

export const SERVER_MODULES: readonly ServerModule[] = [
  // 每小时扫一次 GitHub 上新出现的 CVE 仓库：收进 CVE 仓库索引，带星的推给站里（cron 在 modules/cve-repo-index/server.ts）。
  cveRepoIndex,
];
