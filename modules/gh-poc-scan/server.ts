// 这个模块接进后端的插口：每小时扫一次 GitHub 上新出现的 CVE 仓库并推给站里。
//
// 频率取每小时：新 PoC 仓库是小时级现象，晚一小时发现不影响处置；而每次跑都要打一次
// GitHub 搜索接口、处理 100 条结果，多数是已有条目（按 URL 判重丢弃），跑太勤只是白烧请求和日志。
// 与站内信源的 60 分钟档（industry/sources.json 的 interval_minutes）对齐。站内原先还有一条同类
// 信源 `json-gh-new-cve-repos`（60 分钟档），2026-10-11 已并入本模块并停用：它做的事这里都在做，
// 唯一缺的是星数门槛，所以那次把 minStars 补上了。
//
// 走框架自己的排程（不是宿主机 cron）：时间按 Asia/Shanghai 读，执行结果记进 job_runs，
// 后台「运行」页能看到每次拉到了几个、推了几条；missed: "once" 表示 worker 停机错过时点后补跑一次。
import type { ServerModule } from "@aihot/backend/modules";
import { scan } from "./backend/index.ts";

const hasIngestToken = () => (process.env.INGEST_TOKEN ?? "").trim().length >= 16;

const module: ServerModule = {
  name: "gh-poc-scan",
  schedules: [
    {
      name: "sources.gh-poc-scan",
      cron: "0 * * * *",
      missed: "once",
      // minStars: 1 —— 零星仓库多是个人学习项目或占位仓库，收进站里只会变成「无类别」的噪音。
      // 站内信源 `json-gh-new-cve-repos` 原本卡的就是这个门槛（⭐≥1），合并后由这里接着卡。
      run: () => scan({ days: 2, minStars: 1 }),
      // 没有 INGEST_TOKEN 就不挂这个任务：否则每小时往 job_runs 里堆一条失败记录，把真正的问题淹掉。
      // 配上 token 后重启 worker 即可生效（排程在 worker 启动时装配）。
      when: hasIngestToken,
    },
  ],
};

export default module;
