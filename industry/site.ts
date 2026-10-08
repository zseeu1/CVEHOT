// 站点身份和读者看得到的文案。换成你的行业时，先改这个文件。
// 网页和后端都读它；改完重新构建（docker compose up --build）即可生效。
// 域名不在这里：部署时用环境变量 SITE_URL 设置。

export const SITE = {
  /** 站名：导航、页面标题、分享图、RSS、MCP、后台都用它。 */
  name: "CVEHOT",
  /**
   * 行业词：拼进默认说法里，比如“漏洞日报”“漏洞动态”。
   * 中文词不加空格，英文词会自动加空格（见文件末尾的 withSubject）。
   */
  subject: "漏洞",
  /** 首页的完整标题（浏览器标签、搜索结果）。 */
  homeTitle: "CVEHOT — 漏洞情报 · 每日精选与日报",
  /** 一句话介绍：搜索引擎、分享卡片、RSS、llms.txt 会用。 */
  description: "自动盯住 GitHub 安全公告、CVE 官方记录、PoC 仓库与在野利用清单，用模型打分精选，把同一个漏洞的多条来源聚成一条，每天早上出一份日报。",
  /** 首页左上角和侧边栏下面的一行小字。 */
  tagline: "今天该关注哪些漏洞",
  /** 界面语言（HTML lang、og:locale）。 */
  locale: "zh-CN",
  /** 默认域名，只在没设置 SITE_URL 时使用。 */
  defaultUrl: "http://localhost:3000",
  /**
   * MCP 工具名的前缀（小写字母、数字、下划线），工具会叫 cvehot_get_latest、cvehot_search……
   * 已经有人接入后就不要再改。
   */
  mcpPrefix: "cvehot",
  /** 对外联系邮箱（选填）：使用规则、llms.txt、响应头里会写。 */
  contactEmail: null as string | null,
  /** 页脚的一行小字（选填）。 */
  footerNote: "由 AIHOT 开源框架驱动",
  /** 中国大陆网站的 ICP 备案号（选填），填了就显示在页脚并链接到工信部备案系统。 */
  icp: null as string | null,
  /** 结构化数据里的网站运营者（搜索引擎用）。 */
  organization: {
    name: "CVEHOT",
    /** 创始人（选填）：{ name, url, description }。 */
    founder: null as null | { name: string; url?: string; description?: string },
  },
  /** 抓取信源时报上的名字（User-Agent 里用），不要冒用别的站。 */
  crawlerName: "CVEHOTBot",
} as const;

/** 关于页的文案。数字（信源数、收录数、精选数、日报期数）来自站内实时统计，不用写在这里。 */
export const ABOUT = {
  kicker: `关于 ${SITE.name}`,
  /** 大标题：第一行正常颜色，第二行强调色。 */
  headline: ["每天新增的漏洞很多，", "需要连夜处理的只有几个。"] as [string, string],
  /** 标题下面的一段话。{sources} 会换成实时的信源数。 */
  lead: `${SITE.name} 替你盯着 {sources} 个信源：抓取、归并、打分、精选，每天早上 8 点出一份日报。免费，不用注册。`,
  /** 信源河动画下面的四个环节。 */
  steps: {
    collect: "GitHub 安全公告库、CVE 官方记录、PoC 仓库、开源供应链投毒库和 CISA 在野利用清单都在看；产出多的源 15 分钟看一次。",
    store: "同一条漏洞的官方公告、PoC 仓库和媒体报道归成一个事件；热度按独立来源数算，同一家发十篇也只算一次。",
    select: "模型先判断这条资料讲的是不是一个具体漏洞或攻击事件，再按在野利用、影响面、利用条件和复现状态打分，写中文标题和摘要；厂商营销和只有标题的传闻进不来。",
    publish: "每天 08:00 出日报，周一出周报，每月 1 日出月报；最精选的几条可以推到飞书群。",
  },
  /**
   * 作者块（选填），null 就不显示。
   * avatarSourceId：一个 X 账号信源的 id，头像取它的（选填）。
   * 二维码在后台“设置”里上传，或者放进 industry/brand/contact/；没有二维码就不显示那张卡片。
   */
  maker: null as null | {
    name: string;
    greeting: string[];
    avatarSourceId?: string | null;
    wechat?: { title: string; note: string };
    feishu?: { title: string; note: string };
  },
  /** 页面底部的版权与下架说明（结尾会接“反馈页”的链接）。 */
  copyright: `${SITE.name} 是聚合摘要和阅读索引，原文版权归各来源所有。如果你是来源方，希望更正、下架或调整展示方式，可以通过`,
} as const;

/** “漏洞日报”这类说法：行业词和名词之间，英文词加空格，中文词不加。 */
export function withSubject(noun: string): string {
  return /[A-Za-z0-9]$/.test(SITE.subject) ? `${SITE.subject} ${noun}` : `${SITE.subject}${noun}`;
}
