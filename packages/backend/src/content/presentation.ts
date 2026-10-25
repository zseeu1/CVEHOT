// Reuse translated wording when only the source's layout, media or link destinations change.
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { collapseWhitespace } from "../lib/text.ts";

const BLOCK = "p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,dt,dd,caption";
const MEDIA = "picture,video,img";

export class PresentationMismatch extends Error {}

export function presentationCounts(html: string | null): { images: number; links: number } {
  const $ = cheerio.load(html ?? "", null, false);
  return { images: $("img").length, links: $("a[href]").length };
}

function textBlocks($: cheerio.CheerioAPI) {
  return $(BLOCK).toArray().filter(el => !$(el).find(BLOCK).length && !!$(el).text().trim());
}

/** Preserve wording only where each old source block still has the same inline text structure. */
export function rebaseTranslation(previous: string, next: string, translated: string): string {
  const old = cheerio.load(previous, null, false);
  const current = cheerio.load(next, null, false);
  const zh = cheerio.load(translated, null, false);
  const oldBlocks = textBlocks(old), newBlocks = textBlocks(current), translatedBlocks = textBlocks(zh);
  if (oldBlocks.length !== newBlocks.length || oldBlocks.length !== translatedBlocks.length) {
    throw new PresentationMismatch("正文段落结构已变化，需要正常重翻，不能只刷新展示");
  }
  const shell = (html: string) => {
    const $ = cheerio.load(html, null, false);
    $("a").each((i, el) => { (el as Element).attribs = { id: String(i) }; });
    $(MEDIA).each((_i, el) => { if (!$(el).parents(MEDIA).length) $(el).replaceWith("⟦media⟧"); });
    return collapseWhitespace($.html());
  };
  oldBlocks.forEach((block, i) => {
    const fresh = newBlocks[i]!;
    if (shell(old(block).html() ?? "") !== shell(current(fresh).html() ?? "")) {
      throw new PresentationMismatch(`第 ${i + 1} 段的文字或内联结构已变化，需要正常重翻，不能只刷新展示`);
    }
    const rendered = cheerio.load(zh(translatedBlocks[i]!).html() ?? "", null, false);
    const links = current(fresh).find("a").toArray();
    const oldLinks = old(block).find("a").toArray();
    const zhLinks = rendered("a").toArray();
    const media = current(fresh).find(MEDIA).toArray().filter(el => !current(el).parentsUntil(fresh, MEDIA).length);
    const oldMedia = old(block).find(MEDIA).toArray().filter(el => !old(el).parentsUntil(block, MEDIA).length);
    const zhMedia = rendered(MEDIA).toArray().filter(el => !rendered(el).parents(MEDIA).length);
    if (links.length !== zhLinks.length || media.length !== zhMedia.length || oldLinks.some((link, k) => link.attribs.href !== zhLinks[k]?.attribs.href)) {
      throw new PresentationMismatch(`第 ${i + 1} 段的译文链接或图片无法对应，需要正常重翻`);
    }
    zhLinks.forEach((link, k) => { link.attribs = { ...links[k]!.attribs }; });
    // The model may move media tokens within a sentence. Match the original token, never its
    // position in the translated wording; repeated identical tokens must have the same replacement.
    const replacements = new Map<string, string[]>();
    oldMedia.forEach((el, k) => {
      const key = old.html(el), replacement = current.html(media[k]!);
      const matches = replacements.get(key) ?? [];
      if (matches.some(value => value !== replacement)) throw new PresentationMismatch(`第 ${i + 1} 段的重复图片无法唯一对应，需要正常重翻`);
      matches.push(replacement);
      replacements.set(key, matches);
    });
    zhMedia.forEach(el => {
      const replacement = replacements.get(rendered.html(el))?.shift();
      if (replacement === undefined) throw new PresentationMismatch(`第 ${i + 1} 段的译文图片无法对应，需要正常重翻`);
      rendered(el).replaceWith(replacement);
    });
    current(fresh).html(rendered.html());
  });
  return current.html();
}
