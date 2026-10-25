// Metadata recovery must not replace an already confirmed article body with another rendering of
// the page; the same free detail response can still supply a body when none was confirmed before.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial, updatePresentation } from "@aihot/backend/content/materials";
import { extractArticleBody } from "@aihot/backend/content/extract";
import { collectSource } from "@aihot/backend/sources/collect";
import { collectFindings } from "@aihot/backend/operations/alerts";
import { stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const original = "The publisher already supplied this confirmed body, which must remain unchanged. ".repeat(6).trim();
const alternate = "A later page rendering supplies different readable text while exposing its publication metadata. ".repeat(6).trim();
const publishedAt = new Date(Date.now() - 3600000);
let presentationNames = ["blocked", "later"];
let presentationMarkup = "<p>The <b>model</b> is available.</p>";
const server = http.createServer((req, res) => {
  if (req.url === "/presentation-feed") {
    res.setHeader("content-type", "application/rss+xml");
    return res.end(`<rss version="2.0"><channel><title>Fixture</title>${presentationNames.map(name => `<item><title>${name}</title><link>${base}/${name}</link><pubDate>${publishedAt.toUTCString()}</pubDate><content:encoded><![CDATA[${name === "blocked" ? presentationMarkup : "<p>A second article can still be collected.</p>"} ]]></content:encoded></item>`).join("")}</channel></rss>`);
  }
  res.setHeader("content-type", "text/html");
  if (req.url === "/presentation-extract") return res.end(`<html><head><title>Extract recovery</title></head><body><article><p>${original}</p><img src="https://example.com/restored.png"></article></body></html>`);
  if (req.url === "/listing") return res.end(`<ul><li><a href="/complete">Complete article</a></li><li><a href="/pending">Pending article</a></li></ul>`);
  const title = req.url === "/complete" ? "Complete article" : "Pending article";
  res.end(`<html><head><title>${title}</title><meta property="article:published_time" content="${publishedAt.toISOString()}"></head><body><article><h1>${title}</h1><p>${alternate}</p></article></body></html>`);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
config.allowPrivateNetworkFetch = true;
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await stopBoss(); await closeDb(); });

test("publication metadata recovery keeps a confirmed body and only fills an unconfirmed body", async () => {
  const sourceId = `body-preservation-${T}`;
  await sql`INSERT INTO sources(id,name,kind,config,tier,participation_mode,cursor) VALUES (${sourceId},'Body preservation','web_list',${sql.json({ url: base + "/listing", itemSelector: "li", titleSelector: "a", detail: { maxFetches: 10 } })},'T1','editorial',${sql.json({ initializedAt: new Date().toISOString() })})`;
  const complete = await upsertMaterial({ sourceId, url: base + "/complete", title: "Complete article", bodyText: original, bodyHtml: `<p>${original}</p>`, bodyStatus: "ok", via: "fetch" });
  const pending = await upsertMaterial({ sourceId, url: base + "/pending", title: "Pending article", bodyStatus: "pending", via: "fetch" });
  assert.equal((await collectSource(sourceId)).status, "ok");
  const [confirmed] = await sql`SELECT body_text,body_html,body_status,published_at FROM articles WHERE id=${complete.articleId}`;
  assert.equal(confirmed!.body_text, original);
  assert.equal(confirmed!.body_html, `<p>${original}</p>`);
  assert.equal(confirmed!.body_status, "ok");
  assert.equal(confirmed!.published_at.toISOString(), publishedAt.toISOString());
  const [filled] = await sql`SELECT body_text,body_status,published_at FROM articles WHERE id=${pending.articleId}`;
  assert.ok(filled!.body_text.includes(alternate));
  assert.equal(filled!.body_status, "ok");
  assert.equal(filled!.published_at.toISOString(), publishedAt.toISOString());
});


test("an unmatchable translated layout stays intact, records a visible follow-up and does not stop its feed", async () => {
  const sourceId = `presentation-blocked-${T}`;
  await sql`INSERT INTO sources(id,name,kind,config,tier,participation_mode,cursor) VALUES (${sourceId},'Presentation blocked','rss',${sql.json({ feedUrl: base + "/presentation-feed", summaryIsBody: true })},'T1','editorial',${sql.json({ initializedAt: new Date().toISOString() })})`;
  const input = { sourceId, url: base + "/blocked", title: "blocked", bodyText: "The model is available.", bodyHtml: "<p>The model is available.</p>", bodyStatus: "ok" as const, via: "fetch" as const, publishedAt };
  const { articleId } = await upsertMaterial(input);
  await sql`INSERT INTO translations(article_id,lang,revision,body_html,body_text,complete,origin)
    VALUES (${articleId},'zh',1,'<p>模型已开放。</p>','模型已开放。',true,'model')`;
  await sql`UPDATE articles SET processing_state='analyzed',grouping_status='complete' WHERE id=${articleId}`;
  const result = await collectSource(sourceId);
  assert.equal(result.status, "ok");
  assert.equal(result.created, 1, "the article behind the failed refresh is still collected");
  const [row] = await sql`SELECT a.body_html,a.revision,a.processing_state,a.processing_error,t.body_html AS translated FROM articles a JOIN translations t ON t.article_id=a.id WHERE a.id=${articleId}`;
  assert.deepEqual({ ...row }, { body_html: input.bodyHtml, revision: 1, processing_state: 'analyzed', processing_error: null, translated: '<p>模型已开放。</p>' });
  const [run] = await sql`SELECT detail FROM fetch_runs WHERE source_id=${sourceId} ORDER BY id DESC LIMIT 1`;
  assert.equal(run!.detail.presentationFailures[0].url, input.url);
  assert.match(run!.detail.presentationFailures[0].error, /正常重翻/);
  const followups = (await collectFindings()).filter(f => f.key === `sources.presentation.${sourceId}`);
  assert.equal(followups.length, 1);
  assert.match(followups[0]!.detail!, new RegExp(input.url));
  await sql`UPDATE fetch_runs SET started_at=now()-interval '8 days' WHERE source_id=${sourceId}`;
  assert.equal((await collectFindings()).some(f => f.key === `sources.presentation.${sourceId}`), true, "aging out of weekly statistics is not recovery");
  await sql`INSERT INTO fetch_runs(source_id,status,found_count,detail) VALUES (${sourceId},'ok',0,'{"notModified":true,"httpStatus":304}')`;
  assert.equal((await collectFindings()).some(f => f.key === `sources.presentation.${sourceId}`), true, "304 does not hide an unresolved presentation failure");
  await sql`INSERT INTO fetch_runs(source_id,status,found_count) VALUES (${sourceId},'ok',1)`;
  assert.equal((await collectFindings()).some(f => f.key === `sources.presentation.${sourceId}`), true, "a nonempty run says nothing about the failed article");
  presentationNames = ["later"];
  assert.equal((await collectSource(sourceId)).status, "ok");
  assert.equal((await collectFindings()).some(f => f.key === `sources.presentation.${sourceId}`), true, "the failed article leaving a rolling feed cannot make it recover");
  presentationNames = ["blocked", "later"];
  presentationMarkup = '<p>The model is available.</p><figure><img src="https://example.com/restored.png"></figure>';
  // A failed evidence write rolls the body back; a later batch failure keeps both committed.
  await sql`CREATE FUNCTION fail_presentation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='content.presentation.updated' THEN RAISE EXCEPTION 'recovery write failed'; END IF; RETURN NEW; END $$`;
  await sql`CREATE TRIGGER fail_presentation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_presentation_audit()`;
  try {
    assert.equal((await collectSource(sourceId)).status, "failed");
    assert.equal((await sql`SELECT body_html FROM articles WHERE id=${articleId}`)[0]!.body_html, input.bodyHtml);
    assert.equal((await collectFindings()).some(f => f.key === `sources.presentation.${sourceId}`), true, "a rolled-back repair is still pending");
  } finally {
    await sql`DROP TRIGGER fail_presentation_audit ON audit_log`;
    await sql`DROP FUNCTION fail_presentation_audit()`;
  }
  await sql`CREATE FUNCTION fail_completed_fetch() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status='ok' THEN RAISE EXCEPTION 'failure after material commit'; END IF; RETURN NEW; END $$`;
  await sql`CREATE TRIGGER fail_completed_fetch BEFORE UPDATE ON fetch_runs FOR EACH ROW EXECUTE FUNCTION fail_completed_fetch()`;
  try {
    assert.equal((await collectSource(sourceId)).status, "failed");
    assert.match((await sql`SELECT body_html FROM articles WHERE id=${articleId}`)[0]!.body_html, /restored.png/);
    assert.equal((await collectFindings()).some(f => f.key === `sources.presentation.${sourceId}`), false, "recovery commits with the body even when the batch fails later");
  } finally {
    await sql`DROP TRIGGER fail_completed_fetch ON fetch_runs`;
    await sql`DROP FUNCTION fail_completed_fetch()`;
  }
  assert.equal((await collectSource(sourceId)).status, "ok", "replay sees the already repaired body");
  assert.equal((await collectFindings()).some(f => f.key === `sources.presentation.${sourceId}`), false, "the same article actually refreshed successfully");
  presentationMarkup = '<p>The <b>model</b> is available.</p>';
  await collectSource(sourceId);
  assert.equal((await collectFindings()).some(f => f.key === `sources.presentation.${sourceId}`), true, "a new failure after recovery is visible again");
  await sql`INSERT INTO audit_log(actor,action,subject,after) VALUES ('test','content.rerun.presentation',${`content:${articleId}`},'{"result":{"applied":true}}')`;
  assert.equal((await collectFindings()).some(f => f.key === `sources.presentation.${sourceId}`), true, "an apply command alone is not proof that the body changed successfully");
});

test("normal extraction resolves a failed presentation only when the same article's HTML actually changes", async () => {
  const sourceId = `presentation-extract-${T}`;
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode) VALUES (${sourceId},'Extract recovery','rss','T1','editorial')`;
  const { articleId } = await upsertMaterial({ sourceId, url: base + '/presentation-extract', title: 'Extract recovery', bodyText: original, bodyHtml: `<p>${original}</p>`, bodyStatus: 'ok', publishedAt, via: 'fetch' });
  await sql`INSERT INTO translations(article_id,lang,revision,body_html,body_text,complete,origin)
    VALUES (${articleId},'zh',1,'<p>现有译文。</p>','现有译文。',true,'model')`;
  const [article] = await sql`SELECT identity_key FROM articles WHERE id=${articleId}`;
  await sql`INSERT INTO fetch_runs(source_id,status,detail) VALUES (${sourceId},'ok',${sql.json({presentationFailures:[{identityKey:article!.identity_key,url:base+'/presentation-extract',error:'needs retranslation'}]})})`;
  await sql.begin(tx => updatePresentation(tx, articleId, {media:[{kind:'image',url:'https://example.com/cover.png'}]}));
  assert.equal((await collectFindings()).some(f => f.key === `sources.presentation.${sourceId}`), true, 'cover changes alone cannot resolve a failed HTML mapping');
  await sql`UPDATE articles SET body_status='pending' WHERE id=${articleId}`;
  assert.equal(await extractArticleBody(articleId), 'ok');
  assert.equal((await sql`SELECT revision FROM articles WHERE id=${articleId}`)[0]!.revision, 1);
  assert.equal((await collectFindings()).some(f => f.key === `sources.presentation.${sourceId}`), false, 'normal extraction uses the same committed success evidence');
  await sql`INSERT INTO fetch_runs(source_id,status,detail) VALUES (${sourceId},'ok',${sql.json({presentationFailures:[{identityKey:article!.identity_key,url:base+'/presentation-extract',error:'a newer incompatible layout'}]})})`;
  await sql`UPDATE articles SET body_status='pending' WHERE id=${articleId}`;
  assert.equal(await extractArticleBody(articleId), 'ok');
  assert.equal((await collectFindings()).some(f => f.key === `sources.presentation.${sourceId}`), true, 'a successful extraction with unchanged HTML is not recovery');
});
