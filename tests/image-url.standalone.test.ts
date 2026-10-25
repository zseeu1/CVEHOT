import assert from "node:assert/strict";
import { test } from "node:test";
import { isNonArticleImage } from "../packages/backend/src/lib/image-url.ts";
import { sanitizeBody } from "../packages/backend/src/content/sanitize.ts";
import { proxiedImage, proxyBodyImages } from "../packages/backend/src/media/imgproxy.ts";

test("YouTube embed, /v/, and youtu.be pages are not article images", () => {
  assert.equal(isNonArticleImage("https://www.youtube.com/embed/dQw4w9WgXcQ"), true);
  assert.equal(isNonArticleImage("https://www.youtube.com/v/dQw4w9WgXcQ"), true);
  assert.equal(isNonArticleImage("https://youtu.be/dQw4w9WgXcQ"), true);
});

test("Vimeo watch and player pages are not article images", () => {
  assert.equal(isNonArticleImage("https://vimeo.com/123456789"), true);
  assert.equal(isNonArticleImage("https://player.vimeo.com/video/123456789"), true);
});

test("inline images retain image MIME types and reject documents across ingestion and reads", () => {
  const base = "https://example.org/article";
  for (const src of ["data:text/html,probe", "data:application/javascript,probe", "data:,probe", "data:image/png"]) {
    assert.equal(isNonArticleImage(src), true, src);
    assert.equal(proxiedImage(src, "full"), null, src);
    assert.equal(proxyBodyImages(`<p>Before<img src="${src}">After</p>`), "<p>BeforeAfter</p>");
    for (const attr of ["src", "data-src", "data-original"]) {
      const cleaned = sanitizeBody(`<p>Before</p><p><img ${attr}="${src}"></p><p>After</p>`, base);
      assert.equal(cleaned, "<p>Before</p><p>After</p>", `${attr}: ${src}`);
      assert.equal(sanitizeBody(cleaned, base), cleaned);
    }
  }
  for (const src of ["data:image/png;base64,AAAA", "data:image/jpeg;base64,AAAA", "data:image/svg+xml,%3Csvg%3E%3C/svg%3E", "https://example.org/image.png"]) {
    assert.equal(isNonArticleImage(src), false, src);
    const cleaned = sanitizeBody(`<p><img data-src="${src}" alt="Chart"></p>`, base);
    assert.ok(cleaned.includes(`src="${src}"`), src);
    assert.equal(sanitizeBody(cleaned, base), cleaned);
  }
});
