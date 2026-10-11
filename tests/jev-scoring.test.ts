// The scoring standard on a System One model (Jev): the same six judgements the prompt asks for are
// sent as typed questions, and the attention score is computed here instead of being printed by the
// model. Also covers the fallback: a step pointed at Jev without its key keeps its default model.
import { pointModels, stub, tag } from "./setup.ts";
import { analysisStep } from "./analysis-steps.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { analyzeArticle } from "@aihot/backend/editorial/analyze";
import { modelFor } from "@aihot/backend/editorial/models";
import { stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const SOURCE = `test-jev-scoring-${T}`;

interface Ask {
  state: Record<string, string>;
  questions: Record<string, { type: string }>;
}

/** Every System One request the stub saw, in order. */
const asked: Ask[] = [];

const provider = await stub((_hit, req) => {
  if (req.url.endsWith("/v1/systemone")) {
    const body = JSON.parse(req.body) as Ask;
    asked.push(body);
    const answers: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(body.questions)) {
      answers[id] = question.type === "choice"
        ? { type: "choice", choice: "exploited_vuln", probabilities: { exploited_vuln: 0.9, poc_release: 0.1 }, confidence: 0.85 }
        : { type: "score", score: 4, legend: { "0": "低", "5": "高" }, probabilities: { "2": 0.9, "3": 0.1 }, confidence: 0.9 };
    }
    return {
      id: `gen-dec-${asked.length}`, model: "typesafe/jev-1.13-20260917", provider: "TypeSafe", answers,
      usage: { input_tokens: 10, output_tokens: 5, cost: 0.000012 },
    };
  }
  const step = analysisStep(req.body);
  const content =
    step === "prefilter" ? { label: "PASS", reason: "测试" }
    : step === "understand" ? { itemType: "poc_release", authorRole: "principal", tags: ["PoC/复现"], editorialJudgment: "理由", titleZh: "一个漏洞的标题", summaryZh: "一个摘要。第二句。" }
    : step === "structure" ? { category: "poc", tags: ["PoC/复现"], subjects: [], fact: null }
    : { attentionScore: 0 };
  return { id: `chat-${step}`, choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
});

// The other steps of the analysis keep the site's own presets: point those at the same stub.
pointModels(provider.url);

Object.assign(process.env, {
  LLM_BASE_URL: `${provider.url}/v1`, LLM_API_KEY: "test-key", LLM_MODEL: "one-model",
  // A System One base URL carries no /v1 of its own: the route appends /v1/systemone, which is the
  // shape OpenRouter serves (https://openrouter.ai/api/v1/systemone).
  JEV_BASE_URL: provider.url, JEV_API_KEY: "test-key", SCORE_MODEL: "jev",
  MODEL_CALLS_ENABLED: "true",
});

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${SOURCE}, 'Test jev scoring', 'rss', 'T1', 'editorial', '2100-01-01')`;
});
after(async () => {
  await provider.close();
  await stopBoss();
  await closeDb();
});

test("the score standard is asked as typed questions and weighted here", async () => {
  const { articleId } = await upsertMaterial({
    sourceId: SOURCE, url: `https://example.com/${T}`, title: `An exploited vulnerability ${T}`,
    bodyText: `A remote attacker can exploit this without authentication; a patch is available. ${T} `.repeat(6),
    bodyStatus: "ok", via: "fetch", publishedAt: new Date(),
  } as never);

  const res = await analyzeArticle(articleId);

  // One call per independent score, each asking the content type and the five axes against one state.
  assert.equal(asked.length, 2, "two independent score calls");
  assert.deepEqual(Object.keys(asked[0]!.questions).sort(), ["act", "content_type", "cred", "nov", "reson", "sig"]);
  assert.deepEqual(Object.keys(asked[0]!.state).sort(), ["body", "published_at", "title"]);

  // Every axis answered 4 of 5 levels, which is 8 of 10 points; the exploited_vuln row weights them
  // 3+1+2+2+2 = 10, so the weighted total is 80 — and both calls agree, so the mean is the same.
  assert.equal(res!.output!.score, 80);
  assert.equal(res!.output!.selected, true, "80 clears the T1 threshold of 58");

  const services = await sql<{ service: string }[]>`SELECT DISTINCT service FROM receipts WHERE subject LIKE ${`article:${articleId}%`}`;
  assert.ok(services.some((s) => s.service === "typesafe"), "the score calls are billed to the System One service");

  // The gateway reports what the run cost; the receipt keeps it as the actual amount, not an estimate.
  const attempts = await sql<{ cost: string | null; cost_basis: string | null }[]>`
    SELECT a.cost, a.cost_basis FROM receipt_attempts a JOIN receipts r ON r.id = a.receipt_id WHERE r.service = 'typesafe'`;
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every((a) => a.cost_basis === "actual"), "cost comes from the response, not a price table");
  assert.ok(attempts.every((a) => Number(a.cost) > 0));
});

test("a step pointed at Jev without its key keeps the model it would have used", async () => {
  const saved = { base: process.env.JEV_BASE_URL, key: process.env.JEV_API_KEY };
  delete process.env.JEV_BASE_URL;
  delete process.env.JEV_API_KEY;
  try {
    assert.equal(await modelFor("score"), "default", "not configured: the step is not pointed at Jev at all");
  } finally {
    Object.assign(process.env, { JEV_BASE_URL: saved.base, JEV_API_KEY: saved.key });
  }
});
