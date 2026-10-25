// A rendered listing can repeat an article: a hero's "Read more" link appears before its titled
// card. The first occurrence must not permanently mask the useful headline later in the page.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fromMarkdown } from "@aihot/backend/sources/web-list";

const source = { config: { url: "https://publisher.example/blog", allowUrlPrefixes: ["https://publisher.example/blog/"] } } as never;
const read = (labels: string[]) => fromMarkdown(labels.map(label => `[${label}](https://publisher.example/blog/new-release)`).join("\n\n"), "https://publisher.example", source);

test("a repeated article takes its actual headline after an earlier call to action", () => {
  assert.deepEqual(read(["Read more", "A new model release", "Read more"]), [{ url: "https://publisher.example/blog/new-release", title: "A new model release" }]);
});

test("a clean headline replaces a repeated card label that swallowed its whole summary", () => {
  assert.equal(read(["An overlong card label with article description. ".repeat(4), "A concise actual headline"])[0]!.title, "A concise actual headline");
});

test("the first clean headline stays stable and a lone call to action can still be enriched from its detail page", () => {
  assert.equal(read(["A clean actual headline", "Another title for the same story", "Read more"])[0]!.title, "A clean actual headline");
  assert.equal(read(["Read more"])[0]!.title, "Read more");
});

test("parentheses in card image URLs cannot enter the headline or make it change with an asset deployment", () => {
  const headline = "Hallo, Deutschland! Mistral Opens German Hub in Munich";
  const card = (deployment: string) => `[![Image 5](https://publisher.example/_astro/Linkedin_Mistral02%20(1)_3Uubi.webp?dpl=${deployment}) ![Image 6](https://publisher.example/_astro/Linkedin_Mistral02%20(1)_3Uubi.webp?dpl=${deployment}) Company ## ${headline} September 28, 2026 By Mistral](https://publisher.example/blog/new-release)`;
  const expected = [{ url: "https://publisher.example/blog/new-release", title: `Company ${headline} September 28, 2026 By Mistral` }];
  for (const deployment of ["first", "second"]) assert.deepEqual(fromMarkdown(card(deployment), "https://publisher.example", source), expected);
  assert.deepEqual(fromMarkdown(`[![Image](https://publisher.example/a_(b_(c)).webp)](https://publisher.example/blog/image-only)\n${card("third")}`, "https://publisher.example", source), expected);
});
