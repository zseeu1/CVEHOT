import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { resizeImage } from "@aihot/backend/media/images";

const png = await sharp({ create: { width: 128, height: 128, channels: 4, background: "#176b75" } }).png().toBuffer();

for (const type of ["image/x-icon", "image/vnd.microsoft.icon"]) {
  test(`PNG bytes served as ${type} produce a readable avatar`, async () => {
    const image = await resizeImage(png, type, "avatar");
    assert.equal(image.type, "image/webp");
    const meta = await sharp(image.body).metadata();
    assert.deepEqual([meta.width, meta.height], [96, 96]);
  });

  test(`an HTML error served as ${type} remains a failure`, async () => {
    await assert.rejects(resizeImage(Buffer.from("<html>Not an icon</html>"), type, "avatar"));
  });
}
