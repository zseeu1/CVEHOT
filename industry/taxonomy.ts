// 这个行业的分类体系：类别、标签词表、厂商与组件名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉模型怎么归类。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 */
export const CATEGORIES = [
  { key: "exploited", label: "在野利用", section: "在野利用与紧急处置", guide: "已确认被在野利用、已列入 CISA KEV、或已被大规模扫描攻击的漏洞与攻击活动" },
  { key: "poc", label: "PoC/复现", section: "已公开 PoC 与复现", guide: "公开了 PoC、EXP、复现步骤或完整利用细节的漏洞" },
  { key: "advisory", label: "漏洞通告", section: "漏洞通告与补丁", guide: "厂商、CERT、GitHub 安全公告库等发布的漏洞通告、补丁与影响版本说明" },
  { key: "supply-chain", label: "供应链", section: "供应链与依赖风险", guide: "开源仓库投毒、恶意包、依赖混淆、构建与发布凭证被滥用的风险与事件" },
  { key: "incident", label: "攻击事件", section: "攻击事件与应急", guide: "已发生的真实攻击、勒索、数据泄露，以及应急响应与处置复盘" },
  { key: "industry", label: "行业与政策", section: "行业与政策", guide: "漏洞治理政策与监管、行业标准、赏金与漏洞市场、生态趋势" },
] as const;

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["exploited_vuln", "poc_release", "vendor_advisory", "supply_chain", "exploit_technique", "incident_report", "industry_policy"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "在野利用", "PoC/复现", "漏洞通告", "补丁/修复", "供应链", "攻击事件", "利用技术", "行业/政策", "其他",
] as const;

/** 可选的主题标签。 */
export const TOPIC_TAGS = [
  "RCE", "提权", "认证绕过", "反序列化", "注入", "文件读写", "SSRF", "内存破坏", "逻辑缺陷", "免认证", "无需交互",
  "Linux", "Windows", "macOS", "浏览器", "Java", "PHP", "Python", "Node.js", "容器/K8s", "网络设备", "VPN/网关", "中间件", "数据库", "云服务", "AI/大模型",
] as const;

/** 可选的实体标签（厂商、组件与机构）。 */
export const ENTITY_TAGS = [
  "Microsoft", "Google", "Apple", "Apache", "Cisco", "Fortinet", "Ivanti", "VMware", "Atlassian", "Oracle",
  "WordPress", "Jenkins", "Kubernetes", "Linux 内核", "GitHub", "CISA",
] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  远程代码执行: "RCE", 任意代码执行: "RCE", 代码执行: "RCE", 命令执行: "RCE", 命令注入: "注入", rce: "RCE", "remote code execution": "RCE",
  权限提升: "提权", 本地提权: "提权", 提权漏洞: "提权", "privilege escalation": "提权", lpe: "提权",
  授权绕过: "认证绕过", 鉴权绕过: "认证绕过", 身份验证绕过: "认证绕过", 认证缺陷: "认证绕过", "auth bypass": "认证绕过", "authentication bypass": "认证绕过", "authorization bypass": "认证绕过",
  反序列化漏洞: "反序列化", 反序列: "反序列化", deserialization: "反序列化",
  sql注入: "注入", "sql injection": "注入", sqli: "注入", 注入漏洞: "注入", 模板注入: "注入",
  任意文件读取: "文件读写", 任意文件写入: "文件读写", 任意文件上传: "文件读写", 文件上传: "文件读写", 路径穿越: "文件读写", 目录穿越: "文件读写", 路径遍历: "文件读写", "path traversal": "文件读写", "file upload": "文件读写",
  服务端请求伪造: "SSRF", "server-side request forgery": "SSRF",
  缓冲区溢出: "内存破坏", 堆溢出: "内存破坏", 栈溢出: "内存破坏", 越界写: "内存破坏", 越界读: "内存破坏", "use-after-free": "内存破坏", uaf: "内存破坏", "type confusion": "内存破坏", "out-of-bounds": "内存破坏",
  未授权访问: "免认证", 未授权: "免认证", 无需认证: "免认证", 前台利用: "免认证", "pre-auth": "免认证", preauth: "免认证",
  零点击: "无需交互", 无交互: "无需交互", "no user interaction": "无需交互",
  微软: "Microsoft", msrc: "Microsoft",
  谷歌: "Google", chrome: "浏览器", chromium: "浏览器", firefox: "浏览器", safari: "浏览器",
  苹果: "Apple", ios: "Apple", macos: "macOS",
  "apache 软件基金会": "Apache", "apache software foundation": "Apache", tomcat: "Apache", struts: "Apache", log4j: "Apache", shiro: "Apache",
  思科: "Cisco", "ios xe": "Cisco",
  飞塔: "Fortinet", fortigate: "Fortinet", fortios: "Fortinet",
  脉冲安全: "Ivanti", "pulse secure": "Ivanti", "connect secure": "Ivanti",
  vcenter: "VMware", esxi: "VMware", 博通: "VMware",
  confluence: "Atlassian", jira: "Atlassian",
  weblogic: "Oracle", "java se": "Oracle",
  博客系统: "WordPress", woocommerce: "WordPress",
  kubernetes: "容器/K8s", k8s: "容器/K8s", docker: "容器/K8s", containerd: "容器/K8s", 容器逃逸: "容器/K8s",
  路由器: "网络设备", 路由器固件: "网络设备", 防火墙: "网络设备", 网关: "VPN/网关", vpn: "VPN/网关",
  中间件漏洞: "中间件", 数据库漏洞: "数据库", 云安全: "云服务",
  大模型: "AI/大模型", 提示注入: "AI/大模型", "prompt injection": "AI/大模型", llm: "AI/大模型", agent: "AI/大模型",
};

/** 模型漏了分类标签时，按内容类型补一个。 */
export const CATEGORY_BY_ITEM_TYPE: Readonly<Record<string, string>> = {
  exploited_vuln: "在野利用", poc_release: "PoC/复现", vendor_advisory: "漏洞通告", supply_chain: "供应链",
  exploit_technique: "利用技术", incident_report: "攻击事件", industry_policy: "行业/政策",
};

// ── 厂商与组件 ──────────────────────────────────────────────────────────────────────────

/** 厂商与组件主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  microsoft: { name: "Microsoft", displayTag: "Microsoft", aliases: ["Microsoft", "微软", "Windows", "MSRC", "Exchange", "SharePoint", "Office", "Hyper-V"] },
  google: { name: "Google", displayTag: "Google", aliases: ["Google", "谷歌", "Chrome", "Chromium", "Android"] },
  apple: { name: "Apple", displayTag: "Apple", aliases: ["Apple", "苹果", "macOS", "iOS", "Safari", "WebKit"] },
  apache: { name: "Apache", displayTag: "Apache", aliases: ["Apache", "Tomcat", "Struts", "Log4j", "Shiro", "HTTP Server", "OFBiz"] },
  cisco: { name: "Cisco", displayTag: "Cisco", aliases: ["Cisco", "思科", "IOS XE", "ASA", "Webex", "NX-OS"] },
  fortinet: { name: "Fortinet", displayTag: "Fortinet", aliases: ["Fortinet", "飞塔", "FortiGate", "FortiOS", "FortiManager", "FortiWeb"] },
  ivanti: { name: "Ivanti", displayTag: "Ivanti", aliases: ["Ivanti", "Pulse Secure", "Connect Secure", "Policy Secure", "CSA"] },
  vmware: { name: "VMware", displayTag: "VMware", aliases: ["VMware", "vCenter", "ESXi", "vSphere", "Broadcom"] },
  atlassian: { name: "Atlassian", displayTag: "Atlassian", aliases: ["Atlassian", "Confluence", "Jira", "Bitbucket", "Bamboo"] },
  oracle: { name: "Oracle", displayTag: "Oracle", aliases: ["Oracle", "WebLogic", "MySQL", "Java SE", "PeopleSoft"] },
  wordpress: { name: "WordPress", displayTag: "WordPress", aliases: ["WordPress", "WooCommerce", "插件漏洞"] },
  jenkins: { name: "Jenkins", displayTag: "Jenkins", aliases: ["Jenkins", "CloudBees"] },
  kubernetes: { name: "Kubernetes", displayTag: "Kubernetes", aliases: ["Kubernetes", "K8s", "containerd", "Docker", "Helm", "Ingress-NGINX"] },
  "linux-kernel": { name: "Linux 内核", displayTag: "Linux 内核", aliases: ["Linux kernel", "Linux 内核", "netfilter", "eBPF", "io_uring"] },
  github: { name: "GitHub", displayTag: null, aliases: ["GitHub", "GHSA", "Advisory Database", "Dependabot"] },
  cisa: { name: "CISA", displayTag: null, aliases: ["CISA", "KEV", "Known Exploited Vulnerabilities"] },
};

/**
 * 身份词典：摘要和标题里出现的厂商，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "microsoft", name: "Microsoft", patterns: [/microsoft|微软|\bmsrc\b|\bwindows\b|\bexchange\b|\bsharepoint\b/i] },
  { id: "google", name: "Google", patterns: [/google|谷歌|\bchrome\b|chromium|\bandroid\b/i] },
  { id: "apple", name: "Apple", patterns: [/\bapple\b|苹果|\bmacos\b|\bios\b|\bsafari\b|webkit/i] },
  { id: "apache", name: "Apache", patterns: [/\bapache\b|\btomcat\b|\bstruts\b|log4j|\bshiro\b/i] },
  { id: "cisco", name: "Cisco", patterns: [/\bcisco\b|思科|\bios xe\b|\bnx-os\b|\bwebex\b/i] },
  { id: "fortinet", name: "Fortinet", patterns: [/fortinet|飞塔|fortigate|fortios|fortiweb|fortimanager/i] },
  { id: "ivanti", name: "Ivanti", patterns: [/ivanti|pulse secure|connect secure|policy secure/i] },
  { id: "vmware", name: "VMware", patterns: [/vmware|vcenter|\besxi\b|vsphere/i] },
  { id: "atlassian", name: "Atlassian", patterns: [/atlassian|confluence|\bjira\b|bitbucket/i] },
  { id: "oracle", name: "Oracle", patterns: [/\boracle\b|weblogic|\bmysql\b/i] },
  { id: "wordpress", name: "WordPress", patterns: [/wordpress|woocommerce/i] },
  { id: "jenkins", name: "Jenkins", patterns: [/\bjenkins\b/i] },
  { id: "kubernetes", name: "Kubernetes", patterns: [/kubernetes|\bk8s\b|containerd|\bdocker\b|\bhelm\b/i] },
  { id: "linux-kernel", name: "Linux 内核", patterns: [/linux kernel|linux 内核|netfilter|\bebpf\b|io_uring/i] },
];

/** 这些域名上的文章，发布方就是对应的厂商（托管平台如 GitHub、NVD 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "microsoft", domains: ["msrc.microsoft.com", "microsoft.com"] },
  { entityId: "google", domains: ["chromereleases.googleblog.com", "security.googleblog.com"] },
  { entityId: "apple", domains: ["support.apple.com"] },
  { entityId: "apache", domains: ["apache.org", "tomcat.apache.org"] },
  { entityId: "cisco", domains: ["sec.cloudapps.cisco.com", "tools.cisco.com"] },
  { entityId: "fortinet", domains: ["fortiguard.com"] },
  { entityId: "ivanti", domains: ["forums.ivanti.com", "ivanti.com"] },
  { entityId: "vmware", domains: ["vmware.com", "broadcom.com"] },
  { entityId: "atlassian", domains: ["confluence.atlassian.com", "atlassian.com"] },
  { entityId: "oracle", domains: ["oracle.com"] },
  { entityId: "wordpress", domains: ["wordpress.org"] },
  { entityId: "jenkins", domains: ["jenkins.io"] },
  { entityId: "kubernetes", domains: ["kubernetes.io", "discuss.kubernetes.io"] },
  { entityId: "linux-kernel", domains: ["kernel.org"] },
  { entityId: "cisa", domains: ["cisa.gov"] },
];

/** 原文里的这些写法也算提到了对应厂商。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "microsoft", pattern: /@MSFTSecurity\b/i },
  { entityId: "github", pattern: /@github\b/i },
];

/**
 * 这个行业最受关注的一类进展（AI 行业是新模型）：日报报头的「N 个新模型」按它数。
 * 漏洞行业没有这种「发布物」，设成 null；报头的「条在野利用」由 reports/compose.ts 的 exploited 指标单独产出。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = null;

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = [
  "cve", "cnvd", "cvss", "kev", "poc", "exp", "0day", "rce", "lfi", "rfi",
  "xss", "csrf", "ssrf", "sqli", "dos", "ddos", "apt", "edr", "waf", "c2", "ioc", "ttp",
];
