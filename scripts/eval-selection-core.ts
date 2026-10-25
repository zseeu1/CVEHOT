// Selection evaluation cases (one human gold decision per line) and their metrics. Whether a case is
// selected is the site's own rule (editorial/analyze.ts), never a copy of it.
import { z } from "zod";
import { scoresSelect, type AnalysisRun } from "@aihot/backend/editorial/analyze";
import { binaryMetrics, nonEmpty, nullableString, parseCasesJsonl, round, SamplingContext } from "./eval-tools.ts";

/** "either": both decisions are acceptable; such cases stay out of the decisive metrics. */
export const GOLD_DECISIONS = ["select", "reject", "either"] as const;
export type SelectionGoldDecision = (typeof GOLD_DECISIONS)[number];
export type SelectionDecision = Exclude<SelectionGoldDecision, "either">;

const GoldRow = z.object({
  caseId: nonEmpty,
  material: z.object({
    title: nonEmpty,
    sourceName: nonEmpty,
    originalTitle: nullableString,
    publishedAt: nullableString.refine((value) => value === null || !Number.isNaN(new Date(value).getTime()), "publishedAt is not a valid date"),
    bodyZh: nullableString,
    bodyOriginal: nullableString,
  }),
  sourceFacts: z.object({
    sourceKind: nonEmpty,
    sourceTier: nullableString.transform((value) => value ?? undefined),
    firstParty: z.boolean().optional(),
    language: nullableString,
  }),
  samplingContext: SamplingContext.optional(),
  gold: z.object({ decision: z.enum(GOLD_DECISIONS) }),
});
export type SelectionGoldRow = z.infer<typeof GoldRow>;

/** Validate the entire gold set before filtering or sending any model requests. */
export const parseSelectionGoldJsonl = (text: string): SelectionGoldRow[] => parseCasesJsonl(text, GoldRow);

export interface SelectionMetricCase {
  gold: SelectionGoldDecision;
  decision: SelectionDecision | null;
}

/**
 * Selection quality has two denominators:
 * - valid-output metrics describe decisions the pipeline actually returned;
 * - coverage / completeAccuracy charge failures against every decisive gold case.
 * Gold "either" cases are excluded from both denominators, but their failures remain observable.
 */
export function selectionMetrics(cases: SelectionMetricCase[]) {
  const decisive = cases.filter((row) => row.gold !== "either");
  const eitherErrors = cases.filter((row) => row.gold === "either" && row.decision === null).length;
  const m = binaryMetrics(decisive.flatMap((row) => (row.decision === null ? [] : [{ gold: row.gold === "select", predicted: row.decision === "select" }])), decisive.length);
  return {
    n: cases.length,
    decisiveGold: decisive.length,
    decisive: m.answered,
    either: cases.length - decisive.length,
    errors: m.errors + eitherErrors,
    decisiveErrors: m.errors,
    eitherErrors,
    tp: m.tp,
    fp: m.fp,
    fn: m.fn,
    tn: m.tn,
    coverage: m.coverage,
    accuracy: m.accuracy,
    completeAccuracy: m.completeAccuracy,
    precision: m.precision,
    recall: m.recall,
    f1: m.f1,
    selectedRate: round((m.tp + m.fp) / Math.max(1, m.answered)),
    // A property of the labelled decisive set, not of whichever cases a model happened to answer.
    goldSelectRate: round(decisive.filter((row) => row.gold === "select").length / Math.max(1, decisive.length)),
  };
}

/** A case's outcome: past the prefilter or not, and its scores; `available` false when it failed. */
export interface SelectionThresholdCase {
  gold: SelectionGoldDecision;
  available: boolean;
  passed: boolean;
  scores: AnalysisRun["scores"];
}

/** The decisions had every case been held against `threshold` instead of its source tier's. */
export function selectionThresholdMetrics(cases: SelectionThresholdCase[], threshold: number) {
  const metrics = selectionMetrics(cases.map((row) => ({
    gold: row.gold,
    decision: row.available ? (row.passed && scoresSelect(row.scores, threshold) ? "select" : "reject") : null,
  })));
  return {
    t: threshold,
    acc: metrics.accuracy,
    completeAcc: metrics.completeAccuracy,
    coverage: metrics.coverage,
    P: metrics.precision,
    R: metrics.recall,
    F1: metrics.f1,
    sel: metrics.selectedRate,
    decisive: metrics.decisive,
    decisiveGold: metrics.decisiveGold,
    decisiveErrors: metrics.decisiveErrors,
  };
}
