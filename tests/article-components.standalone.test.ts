// Failure cases: a prompt's header-actions class makes Readability discard its text; a bar chart's
// CSS disappears and leaves unrelated labels/values; normalization exposes hidden content or scripts.
// The widgets are the source's to declare (config.detail.preserve), and a rule it cannot run is refused
// instead of silently changing nothing; the engine knows no site's classes.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as cheerio from "cheerio";
import { readable } from "@aihot/backend/content/extract";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { bodyToMarkdown } from "@aihot/backend/content/markdown";
import { shield, unshield } from "@aihot/backend/editorial/translate";

const prose = "The article explains how to maintain software, with practical examples and measurements. ".repeat(6);
const page = (content: string) => `<html><head><title>Maintenance</title></head><body><article><h1>Maintenance</h1><p>${prose}</p>${content}<p>${prose}</p></article></body></html>`;
const preserve = [
  { selector: ".not-prose:has(.prompt-scroll__content)", as: "pre" as const, code: ".prompt-scroll__content", caption: "[data-prompt-model]" },
  { selector: "figure .comparison-panels", as: "table" as const },
];
const extract = (content: string) => {
  const body = readable(page(content), "https://publisher.example/article", { preserve });
  assert.ok(body);
  return body;
};
const prompt = (attributes = "") => `<div class="not-prose" ${attributes}><div><div class="prompt-scroll-frame"><div class="prompt-scroll prompt-scroll--header-actions"><div class="prompt-scroll__content whitespace-pre-wrap">Review &lt;files&gt; &amp; preserve spelling.\n  Keep this indentation.</div></div></div><div class="prompt-actions"><span data-prompt-model="true">Model A</span><button>Copy prompt</button><script>untrusted()</script></div></div></div>`;

test("custom prompt blocks survive extraction and translation verbatim, without their controls", () => {
  const body = extract(prompt());
  const $ = cheerio.load(body.html);
  assert.equal($("pre code").text(), "Review <files> & preserve spelling.\n  Keep this indentation.");
  assert.ok(body.text.includes("Model A"));
  assert.doesNotMatch(body.html, /Copy prompt|untrusted|<script|<files>/);
  const protectedBody = shield(body.html);
  assert.equal(unshield(protectedBody.html, protectedBody), body.html);
  assert.match(bodyToMarkdown(body.html), /```[\s\S]*Review <files> & preserve spelling\.\n  Keep this indentation\.[\s\S]*```/);
});

test("hidden prompt components remain hidden", () => {
  for (const attributes of ['hidden', 'aria-hidden="true"', 'style="DISPLAY:NONE !important"']) {
    assert.doesNotMatch(extract(prompt(attributes)).html, /Review &lt;files&gt;/);
  }
});

test("comparison panels keep metric headings, model/value relationships and the source note", () => {
  const panel = (metric: string, values: string[]) => `<section class="comparison-panel"><p class="metric-label">${metric}</p><dl class="comparison-rows">${values.map((value, i) => `<div class="comparison-row"><dt>Model ${i + 1}</dt><dd><span aria-hidden="true">DECORATION</span><span class="result-value">${value}</span></dd></div>`).join("")}</dl><div class="axis" aria-hidden="true">AXIS</div></section>`;
  const body = extract(`<figure><figcaption>Cleanup comparison</figcaption><div class="comparison-panels">${panel("API cost", ["$109.06", "$15.12", "$5.27"])}${panel("Findings", ["142", "131", "86"])}</div><p>Costs include follow-up turns.</p></figure>`);
  const $ = cheerio.load(body.html);
  assert.deepEqual($("thead th").map((_, el) => $(el).text()).get(), ["", "API cost", "Findings"]);
  assert.deepEqual($("tbody tr").toArray().map(el => $(el).children().map((_, cell) => $(cell).text()).get()), [
    ["Model 1", "$109.06", "142"], ["Model 2", "$15.12", "131"], ["Model 3", "$5.27", "86"],
  ]);
  assert.match(body.html, /Cleanup comparison/);
  assert.match(body.html, /Costs include follow-up turns/);
  assert.doesNotMatch(body.html, /DECORATION|AXIS/);
  assert.match(bodyToMarkdown(body.html), /\| Model 1 \| \$109.06 \| 142 \|/);
  assert.equal(cheerio.load(extract('<dl><dt>Term</dt><dd>Ordinary definition</dd></dl>').html)("dl").length, 1);
});

test("a source declares only widget rules extraction can run", () => {
  assert.deepEqual(unsupportedConfig("web_list", { detail: { preserve } }), []);
  for (const rule of [{ as: "pre" }, { selector: " ", as: "pre" }, { selector: "figure", as: "chart" }, { selector: "figure", as: "table", code: "pre" },
    { selector: "div", as: "pre", caption: 3 }, { selector: "div", as: "pre", label: "span" }, "div"]) {
    assert.deepEqual(unsupportedConfig("web_list", { detail: { preserve: [rule] } }), ["detail.preserve"], JSON.stringify(rule));
  }
  assert.deepEqual(unsupportedConfig("rss", { detail: { preserve: { selector: "div", as: "pre" } } }), ["detail.preserve"]);
});
