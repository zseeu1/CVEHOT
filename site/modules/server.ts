// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import cveRepoIndex from "@aihot/cve-repo-index/server";
import ghPocScan from "@aihot/gh-poc-scan/server";

export const SERVER_MODULES: readonly ServerModule[] = [
  // 每天 05:20 给 GitHub CVE 仓库索引拉一次增量。
  cveRepoIndex,
  // 每 30 分钟扫一次 GitHub 上新出现的 CVE 仓库并推给站里。
  ghPocScan,
];
