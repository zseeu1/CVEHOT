// Failure cases: an inline style hides a block in a way Readability's literal check misses (property or
// keyword in another case, "!important", an important declaration followed by a plain one), so text a
// reader never sees enters the body; or the reverse, a block a later declaration shows again is dropped;
// or settling the styles removes the hidden placeholder a noscript image is restored beside; or a figure's
// drawing, hidden from screen readers only, leaves its figure with nothing but the caption.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as cheerio from "cheerio";
import { readable } from "@aihot/backend/content/extract";
import { bodyToMarkdown } from "@aihot/backend/content/markdown";
import { sanitizeBody } from "@aihot/backend/content/sanitize";

const prose = "The article explains the research methods, results and limitations, with original evidence for its conclusions. ".repeat(6);
const marker = "SECONDARY_MARKER: this block sits inside the article. ".repeat(6);
const page = (block: string) =>
  `<html><head><title>Research article</title></head><body><article><h1>Research article</h1><p>${prose}</p>${block}<p>${prose}</p></article></body></html>`;
const bodyWith = (style: string) => {
  const body = readable(page(`<div style="${style}"><p>${marker}</p></div>`), "https://example.com/article");
  assert.ok(body?.text.includes("research methods"), style);
  return body!.text.includes("SECONDARY_MARKER");
};

test("whatever a browser hides by inline style stays out of the body", () => {
  for (const style of [
    "display:none", "DISPLAY:NONE", "Display: None", "display:none !important", "display:none!important", "display: none ! IMPORTANT",
    "visibility:hidden", "VISIBILITY:HIDDEN", "visibility:hidden !important",
    "DISPLAY:none !important; display:block", "color:red; display:block; Display:none", "background:url(a;b.png); display:none",
  ]) assert.equal(bodyWith(style), false, style);
});

test("whatever a browser shows stays in the body", () => {
  for (const style of [
    "", "color:red", "display:block", "display:none; display:block", "display:none; DISPLAY:block", "visibility:hidden; visibility:visible",
    "display:none; display:block !important", "background:url(a;b.png)",
  ]) assert.equal(bodyWith(style), true, style);
});

test("a hidden placeholder still lets its noscript image through", () => {
  const body = readable(page(`<figure><img hidden src="/blank.gif"><noscript><img src="/real.jpg"></noscript><figcaption>Evidence chart</figcaption></figure>`), "https://example.com/article");
  assert.deepEqual(body?.images.map((image) => image.url), ["https://example.com/real.jpg"]);
});

// Inline SVG drawings in figures (KKKKhazix/AIHOT#208): the page marks them aria-hidden for screen
// readers, so they never reached the body and a figure was left with only its caption. The drawing's
// own text alternative stands in for it; the drawing itself is not kept.
const description = "Six layers stacked from top to bottom: verification, required CI, AI review and human approval.";
const drawing = (cls: string) =>
  `<svg class="${cls}" aria-hidden="true" focusable="false" viewBox="0 0 651 369"><style>#d text{font-family:'Brand Sans'}</style>` +
  `<rect x="0" y="0" width="10" height="10" fill="var(--layer)"/><text>DRAWING_LABEL</text></svg>`;
const occurrences = (text: string, part: string) => text.split(part).length - 1;

test("a figure's inline drawing becomes its own description, once for its wide and narrow versions", () => {
  const body = readable(page(
    `<figure class="art-fig"><div class="fig-head"><div class="fig-title">Layers, not one gate</div><button type="button" aria-label="Download chart as PNG">png</button></div>` +
    `<div class="fig-draw" role="img" aria-label="${description}">${drawing("wide")}${drawing("narrow")}</div>` +
    `<figcaption><b>FIG B</b><span>Each layer catches what the one above misses</span></figcaption></figure>`,
  ), "https://example.com/article");
  assert.ok(body);
  const $ = cheerio.load(body.html);
  assert.equal(occurrences(body.text, description), 1, body.html);
  assert.equal($("figure").text().includes(description), true);
  assert.match($("figcaption").text(), /Each layer catches/);
  assert.equal($("svg").length, 0);
  assert.doesNotMatch(body.html + body.text, /DRAWING_LABEL|Brand Sans|var\(--layer/);
  assert.equal(occurrences(bodyToMarkdown(body.html, "https://example.com/article"), description), 1, "the Markdown export carries it too");
});

test("a drawing's title and description, or the text it is labelled by, stand in for it", () => {
  const titled = readable(page(
    `<figure><svg role="img"><title>Latency by release</title><desc>Median latency falls by 40% over three releases.</desc><path d="M0 0L9 9"/></svg></figure>`,
  ), "https://example.com/article");
  assert.match(titled!.text, /Latency by release\s+Median latency falls by 40% over three releases\./);
  const labelled = readable(page(
    `<figure><svg aria-labelledby="chart-name chart-note"><title id="chart-name">Adoption</title><path d="M0 0L9 9"/></svg></figure>` +
    `<span id="chart-note" hidden>Weekly users doubled after launch.</span>`,
  ), "https://example.com/article");
  assert.equal(occurrences(labelled!.text, "Weekly users doubled after launch."), 1, labelled!.text);
  assert.match(labelled!.text, /Adoption\s+Weekly users doubled after launch\./);
  const captioned = readable(page(
    `<figure><svg aria-labelledby="cap"><path d="M0 0L9 9"/></svg><figcaption id="cap">Revenue by quarter</figcaption></figure>` +
    `<figure><div role="img" aria-label="Costs: by quarter.">${drawing("only")}</div><figcaption>Costs by quarter</figcaption></figure>`,
  ), "https://example.com/article");
  assert.equal(occurrences(captioned!.text, "Revenue by quarter"), 1, "text the figure already shows is not repeated");
  assert.doesNotMatch(captioned!.text, /Costs: by quarter/, "nor the same words punctuated differently");
});

test("a hidden version of a drawing does not hide the description of the version that is shown", () => {
  const body = readable(page(
    `<figure><div role="img" aria-label="${description}" hidden>${drawing("narrow")}</div>` +
    `<div role="img" aria-label="${description}">${drawing("wide")}</div><figcaption>Layers</figcaption></figure>` +
    `<figure><div role="img" aria-label="ONLY_HIDDEN_DRAWING" style="display:none">${drawing("x")}</div><figcaption>Hidden</figcaption></figure>`,
  ), "https://example.com/article");
  assert.equal(occurrences(body!.text, description), 1, body!.html);
  assert.doesNotMatch(body!.text, /ONLY_HIDDEN_DRAWING/);
});

test("a drawing's holder keeps its other images and text, and hidden words do not count as shown", () => {
  const held = readable(page(
    `<figure><div role="img" aria-label="HOLDER_LABEL">${drawing("x")}<img src="/chart.png" alt="Chart"><p>KEPT_PARAGRAPH of the figure.</p></div><figcaption>Chart</figcaption></figure>`,
  ), "https://example.com/article");
  assert.deepEqual(held!.images.map((image) => image.url), ["https://example.com/chart.png"], held!.html);
  assert.match(held!.text, /KEPT_PARAGRAPH of the figure\./);
  assert.equal(occurrences(held!.text, "HOLDER_LABEL"), 1, "the holder's description stands in for its svg");
  assert.doesNotMatch(held!.html, /<svg/);
  const repeated = readable(page(
    `<figure><div role="img"><svg><title>Quarterly revenue</title><path d="M0 0L9 9"/></svg><p>Quarterly revenue</p></div><figcaption>Cap</figcaption></figure>`,
  ), "https://example.com/article");
  assert.equal(occurrences(repeated!.text, "Quarterly revenue"), 1, "words the holder keeps count as shown");
  const dropped = readable(page(
    `<figure><div role="img" aria-hidden="true"><svg><path d="M0 0L9 9"/></svg><p>Quarterly costs</p></div><svg aria-label="Quarterly costs"><path d="M0 0L9 9"/></svg><figcaption>Cap</figcaption></figure>`,
  ), "https://example.com/article");
  assert.equal(occurrences(dropped!.text, "Quarterly costs"), 1, "words the extraction drops (aria-hidden) do not count as shown");
  const noted = readable(page(
    `<figure><svg aria-labelledby="note"><path d="M0 0L9 9"/></svg><span id="note" hidden>HIDDEN_NOTE explains the chart.</span><figcaption>Cap</figcaption></figure>`,
  ), "https://example.com/article");
  assert.equal(occurrences(noted!.text, "HIDDEN_NOTE explains the chart."), 1, noted!.html);
});

test("drawings without a description, and drawings outside figures, are still left out", () => {
  const body = readable(page(
    `<figure><svg aria-hidden="true"><path d="M0 0L9 9"/><text>ICON_LABEL</text></svg><img src="/chart.png" alt="Chart"><figcaption>Real chart</figcaption></figure>` +
    `<p>A paragraph <svg role="img" aria-label="OUTSIDE_FIGURE"><path d="M0 0L9 9"/></svg> with an icon.</p>`,
  ), "https://example.com/article");
  assert.ok(body);
  assert.doesNotMatch(body.html + body.text, /ICON_LABEL|OUTSIDE_FIGURE|<svg/);
  assert.deepEqual(body.images.map((image) => image.url), ["https://example.com/chart.png"]);
  assert.match(body.text, /Real chart/);
});

test("a description is text, never markup", () => {
  const body = readable(page(
    `<figure><div role="img" aria-label="&lt;img src=x onerror=alert(1)&gt; &lt;b&gt;bold&lt;/b&gt;">${drawing("x")}</div></figure>`,
  ), "https://example.com/article");
  assert.ok(body);
  assert.doesNotMatch(body.html, /<img|<b>|onerror="/);
  assert.match(body.html, /&lt;img src=x onerror=alert\(1\)&gt; &lt;b&gt;bold&lt;\/b&gt;/);
  assert.equal(sanitizeBody(body.html, "https://example.com/article"), body.html, "cleaning it again changes nothing");
});
