// Event-relation evaluation cases (two reports and the human relation between them, one per line) and
// their metrics. Whether a pair ties two stories is the site's own rule (events/relate.ts firmlyTied).
import { z } from "zod";
import { RELATIONS, STORY_REVIEW_MIN_CONFIDENCE, TIE_MIN_CONFIDENCE, TIE_RELATIONS, firmlyTied, type Relation, type ReportView } from "@aihot/backend/events/relate";
import { binaryMetrics, nonEmpty, nullableString, parseCasesJsonl, round, SamplingContext } from "./eval-tools.ts";

const GoldReport = z.object({
  title: nonEmpty,
  source: nonEmpty,
  firstParty: z.boolean().optional().transform((value) => value === true),
  publishedAt: nullableString.refine((value) => value === null || !Number.isNaN(new Date(value).getTime()), "publishedAt is not a valid date"),
  summary: nullableString,
  frame: z.object({ subject: nullableString, action: nullableString, object: nullableString, occurredAt: nullableString })
    .nullish().transform((value) => value ?? null),
});
export type RelationGoldReport = z.infer<typeof GoldReport>;

const GoldRow = z.object({
  caseId: nonEmpty,
  a: GoldReport,
  b: GoldReport,
  samplingContext: SamplingContext.optional(),
  gold: z.object({ relation: z.enum(RELATIONS) }),
});
export type RelationGoldRow = z.infer<typeof GoldRow>;

export const parseRelationGoldJsonl = (text: string): RelationGoldRow[] => parseCasesJsonl(text, GoldRow);

export interface RelationPrediction {
  caseId: string;
  gold: Relation;
  relation: Relation;
  confidence: number;
  stratum?: string | null;
}

/** Production thresholds worth reporting by default; explicit --thresholds still overrides them. */
export const DEFAULT_RELATION_THRESHOLDS = [...new Set([STORY_REVIEW_MIN_CONFIDENCE, TIE_MIN_CONFIDENCE])];

export function toReportView(report: RelationGoldReport): ReportView {
  return {
    title: report.title,
    source: report.source,
    firstParty: report.firstParty,
    at: report.publishedAt ? new Date(report.publishedAt) : null,
    summary: report.summary,
    frame: report.frame,
  };
}

export function relationMetrics(predictions: RelationPrediction[], totalCases = predictions.length) {
  const confusionMatrix = Object.fromEntries(
    RELATIONS.map((gold) => [gold, Object.fromEntries(RELATIONS.map((predicted) => [predicted, 0]))]),
  ) as Record<Relation, Record<Relation, number>>;
  for (const prediction of predictions) confusionMatrix[prediction.gold][prediction.relation]++;
  const perClass = Object.fromEntries(
    RELATIONS.map((relation) => {
      const m = binaryMetrics(predictions.map((p) => ({ gold: p.gold === relation, predicted: p.relation === relation })));
      return [relation, { precision: m.precision, recall: m.recall, f1: m.f1, support: m.tp + m.fn }];
    }),
  ) as Record<Relation, { precision: number; recall: number; f1: number; support: number }>;
  const correct = RELATIONS.reduce((sum, relation) => sum + confusionMatrix[relation][relation], 0);
  const macroF1 = RELATIONS.reduce((sum, relation) => sum + perClass[relation].f1, 0) / RELATIONS.length;
  const evaluated = predictions.length;
  return {
    sampleSize: totalCases,
    evaluated,
    errors: Math.max(0, totalCases - evaluated),
    coverage: round(evaluated / Math.max(1, totalCases)),
    // accuracy and macroF1 describe the answers that parsed successfully; completeAccuracy also charges failures.
    accuracy: round(correct / Math.max(1, evaluated)),
    completeAccuracy: round(correct / Math.max(1, totalCases)),
    macroF1: round(macroF1),
    confusionMatrix,
    perClass,
  };
}

/** Pairs the site would count as tying two stories, at `threshold`, against the gold relations that do. */
export function storyTieMetrics(predictions: RelationPrediction[], threshold: number, totalCases = predictions.length) {
  const m = binaryMetrics(predictions.map((p) => ({
    gold: TIE_RELATIONS.includes(p.gold),
    predicted: firmlyTied(p.relation, p.confidence, threshold),
  })), totalCases);
  return {
    threshold,
    sampleSize: totalCases,
    evaluated: m.answered,
    errors: m.errors,
    coverage: m.coverage,
    tp: m.tp,
    fp: m.fp,
    fn: m.fn,
    tn: m.tn,
    precision: m.precision,
    recall: m.recall,
    f1: m.f1,
    accuracy: m.accuracy,
    completeAccuracy: m.completeAccuracy,
  };
}
