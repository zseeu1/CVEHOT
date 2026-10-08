
【漏洞领域翻译规则 — 本平台 100% 是漏洞与安全事件内容，严格遵守】

1. 编号与标识**一律保留英文原文**，不翻译、不改写、不省略：
   - 漏洞编号：CVE-2026-12345 / GHSA-m8vh-jmq9-5rjg / CNVD-2026-12345 / CWE-79 / CAPEC-123
   - 评分与向量：CVSS 3.1 / CVSS 4.0 / CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H 一字不改
   - 机构与体系：CISA / KEV / NVD / OSV / EPSS / MITRE
   - **规则**：任何形如 XXX-YYYY-NNNN 的编号一律照抄，绝不省略年份、绝不补零、绝不改写成中文

2. 安全缩写按安全语境理解，**保留英文**：
   - RCE / XSS / SSRF / CSRF / LFI / RFI / SQLi / XXE / DoS / UAF / OOB / PoC / EXP / IOC / TTP / C2 / EDR / WAF / RASP / 0day / 1day / Nday
   - 歧义默认值：PoC = 概念验证程序（不是“警察”）；EXP = 漏洞利用程序；exploit 作名词是“利用程序”、作动词是“利用”，绝不译成“开发”；patch 是补丁；bypass 是绕过

3. 组件与厂商名**保留英文原名**，不意译：
   - Windows / Exchange / SharePoint / Hyper-V / Chrome / Chromium / WebKit / Tomcat / Struts / Log4j / Confluence / Jira / WebLogic / vCenter / ESXi / FortiGate / Connect Secure / IOS XE / NGINX / Redis / MySQL / PostgreSQL / Kubernetes / containerd / Jenkins / WordPress
   - 版本号一字不改（3.5.1 / 2.4.49 / 9.8 这类），不要把 "3.5.1" 写成 "3.5.1 版本"、不要把 "V2" 写成 "第 2 版"
   - 中国厂商优先用官方中文名：奇安信 / 绿盟 / 深信服 / 安恒 / 微步 / 长亭 / 火绒 / 360 / 腾讯安全 / 阿里云安全

4. 状态词用**固定译法**，前后一致：
   - exploited in the wild = 已在野利用；proof of concept available = 已有公开 PoC
   - unauthenticated / pre-auth = 无需认证；remote = 远程；adjacent = 邻近网络；local = 本地
   - patch available = 已发布补丁；no fix yet = 暂无补丁；mitigation = 缓解措施；workaround = 规避方案
   - 只有原文明确写出时才用“已在野利用”“已复现”“可直接利用”“无需认证”，不得由“高危”“严重”推断出这些状态

5. 代码 / 命令 / payload / URL / 数字**一字不改**：
   - 反引号代码、`curl` 命令、payload、PoC 链接原样保留
   - CVSS 分数保留原值（9.8 不写成“接近满分”），影响版本区间保留原样（如 2.0.0 至 2.4.49）
   - 时间与数量单位照原文，不做中文数量词改写
