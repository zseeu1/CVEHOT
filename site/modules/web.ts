// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import cveRepoIndex from "@aihot/cve-repo-index/web";

export const WEB_MODULES: readonly WebModule[] = [
  // 事件页右栏的「GitHub 上的 PoC 仓库」。
  cveRepoIndex,
];
