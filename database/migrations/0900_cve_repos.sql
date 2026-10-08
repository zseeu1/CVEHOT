-- 漏洞行业包自用表：GitHub 上提到某个 CVE 的仓库索引（由 scripts/cve-repo-index.ts 维护）。
--
-- 一行 = 一个「仓库 × 它名字或描述里提到的某个 CVE」。复合主键天然带 (cve_id, full_name) 索引，
-- 所以按 CVE 查询不需要额外建索引；表很小（量级 = 仓库数 × 每条平均提到的编号数），不必再优化。
--
-- 与上游功能无关，是本站自己加的旁路：不进采集 / 评分 / 归组 / 日报任何流水线，零模型调用。
-- 编号取 0900 是为了远离上游的迁移序列（上游仍在 005x 递增），以后升级不会撞号。
CREATE TABLE IF NOT EXISTS cve_repos (
  cve_id          text        NOT NULL,
  full_name       text        NOT NULL,
  html_url        text        NOT NULL,
  description     text,
  stars           integer     NOT NULL DEFAULT 0,
  repo_created_at timestamptz,
  repo_pushed_at  timestamptz,
  first_seen      timestamptz NOT NULL DEFAULT now(),
  last_seen       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cve_id, full_name)
);
