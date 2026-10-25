// The account an X source reads, and which posts are that account's own.
import { sql } from "../db.ts";
import type { SourceRow } from "./types.ts";

/** The account an X source reads: the first `from:` of its query (names may show it differently, or not at all). */
export const X_HANDLE = /from:([A-Za-z0-9_]{1,15})/i;
export const xHandle = (config: SourceRow["config"]): string | null => X_HANDLE.exec(String(config.query ?? ""))?.[1] ?? null;

/** In SQL: a post is the source's own only when its author is the account the source reads (handles ignore case). */
export function sourceOwnsPost(config: ReturnType<typeof sql>, handle: ReturnType<typeof sql>) {
  return sql`lower((regexp_match(${config}->>'query', ${X_HANDLE.source}, 'i'))[1]) = lower(nullif(${handle}, ''))`;
}
