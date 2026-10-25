// What the evaluation scripts (scripts/eval-*.ts) share: reading case files, the seeded sample, binary
// metrics, argument checks, the models to compare, bounded concurrency, what their paid attempts used,
// and safe report names.
import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { modelFor } from "@aihot/backend/editorial/models";
import { MODELS } from "@aihot/backend/providers/llm";

/**
 * The cases of a JSONL file, one per line (blank lines and lines starting with // are skipped), each
 * checked by `schema`. The whole file is checked before anything is sent; an error names its line.
 */
export function parseCasesJsonl<S extends z.ZodType<{ caseId: string }>>(text: string, schema: S): z.infer<S>[] {
  const rows: z.infer<S>[] = [];
  const ids = new Set<string>();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = index + 1;
    if (!raw.trim() || raw.trim().startsWith("//")) continue;
    let row: z.infer<S>;
    try {
      row = schema.parse(JSON.parse(raw));
    } catch (error) {
      throw new Error(`line ${line}: ${error instanceof z.ZodError ? z.prettifyError(error) : String(error)}`);
    }
    if (ids.has(row.caseId)) throw new Error(`line ${line}: duplicate caseId ${row.caseId}`);
    ids.add(row.caseId);
    rows.push(row);
  }
  return rows;
}

/** A string with more than whitespace in it, kept as written. */
export const nonEmpty = z.string().refine((value) => value.trim() !== "", "must be a non-empty string");
/** A string, or null when missing. */
export const nullableString = z.string().nullish().transform((value) => value ?? null);
/** Where a case was drawn from, for splitting and per-stratum reading. */
export const SamplingContext = z.object({
  benchmarkSplit: z.string().nullish().transform((value) => value ?? undefined),
  samplingStratum: z.string().nullish().transform((value) => value ?? undefined),
});

/**
 * The cases of one benchmark split ("all": every case) in a deterministic order drawn from `seed`, the
 * first `n` of them: the same seed draws the same sample in every run.
 */
export function sampleCases<T extends { samplingContext?: { benchmarkSplit?: string } }>(rows: T[], opts: { split: string; n: number; seed: number }): T[] {
  const pool = opts.split === "all" ? rows : rows.filter((row) => row.samplingContext?.benchmarkSplit === opts.split);
  if (!pool.length) throw new Error(`no gold cases for split ${opts.split}`);
  let state = opts.seed >>> 0;
  const next = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return pool.map((row) => ({ row, key: next() })).sort((a, b) => a.key - b.key).slice(0, Math.max(0, opts.n)).map(({ row }) => row);
}

export const round = (value: number) => +value.toFixed(3);

/**
 * Yes/no decisions against gold labels. `answered` are the cases that got a decision; the rest of
 * `total` failed, and count against coverage and completeAccuracy, while accuracy, precision, recall and
 * F1 describe the answers.
 */
export function binaryMetrics(answered: Array<{ gold: boolean; predicted: boolean }>, total = answered.length) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const c of answered) {
    if (c.predicted && c.gold) tp++;
    else if (c.predicted) fp++;
    else if (c.gold) fn++;
    else tn++;
  }
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
  const correct = tp + tn;
  return {
    total,
    answered: answered.length,
    errors: Math.max(0, total - answered.length),
    tp, fp, fn, tn,
    coverage: round(answered.length / Math.max(1, total)),
    accuracy: round(correct / Math.max(1, answered.length)),
    completeAccuracy: round(correct / Math.max(1, total)),
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
  };
}

export function positiveInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

/** --models as given (`default` or the site's presets), else the model the step uses now. */
export async function evalModels(list: string | undefined, step: string): Promise<string[]> {
  const models = list ? list.split(",").map((model) => model.trim()).filter(Boolean) : [await modelFor(step)];
  if (!models.length) throw new Error("--models did not name any models");
  for (const model of models) if (!MODELS[model]) throw new Error(`unknown model ${model}`);
  return models;
}

/** `fn` over `items`, at most `limit` at a time; results keep the items' order. */
export async function pmap<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]!);
    }
  }));
  return out;
}

/** Every attempt behind these receipts, each receipt once, unusable answers included. */
export async function usageFor(receiptIds: number[]) {
  const ids = [...new Set(receiptIds)];
  if (!ids.length) return { tokensIn: 0, tokensOut: 0, avgLatencyMs: 0 };
  const [usage] = await sql<{ tin: number; tout: number; latency: number }[]>`
    SELECT
      sum(coalesce((usage->>'prompt_tokens')::int, (usage->>'input_tokens')::int, 0)) AS tin,
      sum(coalesce((usage->>'completion_tokens')::int, (usage->>'output_tokens')::int, 0)) AS tout,
      avg(latency_ms) AS latency
    FROM receipt_attempts WHERE receipt_id IN ${sql(ids)}`;
  return {
    tokensIn: Number(usage?.tin ?? 0),
    tokensOut: Number(usage?.tout ?? 0),
    avgLatencyMs: Math.round(Number(usage?.latency ?? 0)),
  };
}

/** A user-supplied split may contain path separators; report names must stay inside .data/eval. */
export function safeReportNamePart(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return safe || "all";
}
