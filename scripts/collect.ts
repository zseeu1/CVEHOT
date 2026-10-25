// Runs collection for given sources now (development / operations helper).
// node --env-file=.env scripts/collect.ts rss-openai-news rss-hugging-face ...
import { closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { collectSource } from "@aihot/backend/sources/collect";

for (const id of process.argv.slice(2)) {
  const started = performance.now();
  const r = await collectSource(id, { force: true });
  console.log(JSON.stringify({ ...r, ms: Math.round(performance.now() - started) }));
}
await stopBoss();
await closeDb();
