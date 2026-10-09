<p align="center">
  <img src="site/brand/icon.png" width="88" alt="CVEHOT">
</p>

<h1 align="center">CVEHOT</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-176b75?style=flat-square" alt="MIT License"></a>
  <a href="https://github.com/KKKKhazix/AIHOT"><img src="https://img.shields.io/badge/based%20on-AIHOT-f0a93b?style=flat-square" alt="Based on AIHOT"></a>
  <img src="https://img.shields.io/badge/Node.js-24-176b75?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 24">
  <img src="https://img.shields.io/badge/PostgreSQL-17-176b75?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 17">
  <img src="https://img.shields.io/badge/Docker-Compose-176b75?style=flat-square&logo=docker&logoColor=white" alt="Docker Compose">
</p>

<p align="center">
  盯住每天新出现的漏洞，把同一条漏洞的各家来源归到一个事件，出一份能读的简报。
</p>

<p align="center">
  <b>简体中文</b> · <a href="README.en.md">English</a>
</p>

<br>

## 这是什么

信源是 GitHub 安全公告库、CVE 官方记录、PoC 仓库、开源供应链投毒库和 CISA 在野利用清单。新出现的漏洞和攻击事件被挑出来，写成标题和摘要，按漏洞编号归到一个事件下，再算热度、出日报。

它基于 [AIHOT](https://github.com/KKKKhazix/AIHOT) 修改。AIHOT 是数字生命卡兹克（[@KKKKhazix](https://github.com/KKKKhazix)）写的开源框架，一套自己找热点、自己写日报的引擎，换掉行业就能跑成另一个站。引擎是那套，行业从 AI 换成了漏洞情报。

- 上游仓库：<https://github.com/KKKKhazix/AIHOT>
- 上游线上站：<https://aihot.news>
- 许可证：MIT，版权归原作者「数字生命卡兹克」，见 [LICENSE](LICENSE)
- 品牌：上游 [NOTICE](NOTICE) 写明 AIHOT 的名字和 Logo 不在 MIT 许可范围内，所以这里用了自己的名字和图标

这个站不做资产比对，也不做秒级告警。要告警得另配 OSV-Scanner、Dependabot 这类工具。

## 看一眼

<img src="docs/assets/shot-home.png" alt="精选：漏洞通告、PoC 复现、在野利用、供应链分开展示" width="100%">

<p align="center"><sub>精选：把漏洞通告、PoC 复现、在野利用、供应链分开摆，同一条漏洞的多方来源归在一个事件下。</sub></p>

<img src="docs/assets/shot-daily.png" alt="漏洞日报：头条、今日看点与当天指标" width="100%">

<p align="center"><sub>漏洞日报：每天一条头条加几条看点，报眼是当天的事数量、来源数和一手发布数。</sub></p>

<img src="docs/assets/shot-hot.png" alt="漏洞热点榜：按独立来源数排的热度与 24 小时趋势" width="100%">

<p align="center"><sub>热点榜：按独立来源数算热度，配 24 小时趋势。同一家媒体发十篇也只算一次。</sub></p>

## 改了什么

只动行业部分，引擎没改。

- `industry/sources.json` 换成 8 个漏洞信源，另有自建推送源 `gh-poc-scan`
- `industry/taxonomy.ts` 分类换成漏洞视角，在野利用、公开 PoC，还有厂商通告和供应链投毒
- `industry/topics.json` 主题换成厂商、组件和漏洞类型
- `industry/prompts/` 评分和事实抽取按漏洞视角重写，加了「不得由『高危』推断『在野利用』」这类硬规则
- `industry/selection.ts` 入选门槛按漏洞情报的分布重设
- `site/site.ts` 站名、行业词、首页和关于页文案，报眼多了一项「条在野利用」
- `site/brand/` 换成自己的图标
- `modules/cve-repo-index/` 新增，查某个编号到现在有多少个 PoC 仓库
- `modules/gh-poc-scan/` 新增，定时扫 GitHub 上新出现的 CVE 仓库，推给站里

## 借鉴

`modules/cve-repo-index/` 参考 [unSafe.sh 的 CVE 页](https://unsafe.sh/cve)：它把 GitHub 上提到 CVE 的仓库整批收下来，能回答「某个编号到现在一共有多少个 PoC」。

这个项目原有的两个机制都只看最近几天**新出现**的仓库（`gh-poc-scan` 和 `json-gh-new-cve-repos` 信源），没有历史纵深。索引补的是这一块：结果进自己的表 `cve_repos`，按编号查得到一个明确数字，不进精选、归组和日报，零模型调用。

GitHub 搜索单查询最多返回 1000 条，按月切片在繁忙月份一样会截断。所以除了时间切片，还提供 `--lookup <编号> --live`，直接问 GitHub 要单个编号的权威数量。

命令都在容器里跑。

```bash
# 查索引，并实时问 GitHub 拿权威数量
docker compose exec -T worker node scripts/cve-repo-index.ts --lookup CVE-2026-21589 --live

# 只查本地索引：首次出现日期和 star 数（不联网）
docker compose exec -T worker node scripts/cve-repo-index.ts --lookup CVE-2026-21589

# 看覆盖了多少
docker compose exec -T worker node scripts/cve-repo-index.ts --stats

# 背填历史，按月切片逐月查
docker compose exec -T worker node scripts/cve-repo-index.ts --backfill --from-year 2024 --pages 3
```

每日增量不用管，框架的排程已经挂好了（每天 05:20，见 `modules/cve-repo-index/server.ts`）。

## 跑起来

需要 Docker 和 Node.js 24（跑 init-env 要用），另外要有一个 OpenAI 兼容的模型 API Key。

```bash
git clone https://github.com/zseeu1/CVEHOT.git
cd CVEHOT
node scripts/init-env.ts --llm-key <你的模型 API Key>
docker compose up -d --build
```

打开 <http://localhost:3000>，后台在 `/admin`，密码在 `.env` 的 `ADMIN_PASSWORD` 里。

### 配 GITHUB_TOKEN

信源里有几个走 GitHub 的接口（安全公告库、新出现的 CVE 仓库）。搜索接口未认证时每分钟只给 10 次请求，配个 token 会稳很多，背填 CVE 索引也快。

1. 打开 <https://github.com/settings/tokens/new>
2. Note 随便填，Expiration 选个期限，勾 **`public_repo`**（只需要读公开仓库）
3. 拉到底点 **Generate token**，复制 `ghp_` 开头的那一串
4. 打开项目里的 `.env`，加一行 `GITHUB_TOKEN=ghp_这里贴你复制的那串`
5. 重启：`docker compose up -d`

部署到服务器、配域名和 HTTPS 看 [docs/deploy.md](docs/deploy.md)。

## 文档

引擎的完整文档在上游仓库。这个仓库只留几个用得到的。

| 文档 | 内容 |
|---|---|
| [docs/cve-pack.md](docs/cve-pack.md) | 这个行业包改了什么、信源清单、验证记录 |
| [docs/deploy.md](docs/deploy.md) | Docker、域名和 HTTPS、更新、备份 |
| [docs/selection.md](docs/selection.md) | 一条资料怎么变成精选，门槛怎么校准 |
| [docs/architecture.md](docs/architecture.md) | 三个进程、目录、模块、数据库迁移 |

## 上游

引擎来自 [AIHOT](https://github.com/KKKKhazix/AIHOT)，作者 [@KKKKhazix](https://github.com/KKKKhazix)。引擎本身的问题请提到上游，这个仓库的行业改造由我负责。

同步上游更新，`upstream` 加一次就够。

```bash
git remote add upstream https://github.com/KKKKhazix/AIHOT.git
git fetch upstream && git merge upstream/main
```

## 许可

代码是 [MIT](LICENSE)，版权归原作者「数字生命卡兹克」。这个仓库在上游基础上做了改动，同样是 MIT。

AIHOT 的名字和 Logo 不在许可范围内，见 [NOTICE](NOTICE)。`assets/og-fonts/` 里的字体有自己的许可，也写在 NOTICE 里。
