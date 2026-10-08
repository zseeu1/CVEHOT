// The modules this site runs (modules/<name>/, see docs/architecture.md). A module has a line in each list
// it has an entry for: here for its addresses (module.ts), in server.ts for its backend, in web.ts for its
// pages' parts. Each list keeps the order its entries appear in on the site.
import type { ModuleDeclaration } from "@aihot/contracts/modules";
import cveRepoIndex from "@aihot/cve-repo-index/module";
import ghPocScan from "@aihot/gh-poc-scan/module";

export const MODULES: readonly ModuleDeclaration[] = [
  // 这两个都没有自己的地址，只在后端挂了定时任务（site/modules/server.ts）。
  cveRepoIndex,
  ghPocScan,
];
