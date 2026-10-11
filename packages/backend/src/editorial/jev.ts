// The question sets a System One model (Jev) is asked, per step.
//
// The scoring prompt (industry/prompts/selection-score.md) already computes an attention score from
// one content type plus five axes, each graded 0-10, combined with a per-type weight table. On the
// chat route the model does that arithmetic in its head and prints one number. Here the same standard
// is asked as separate typed questions — one choice for the content type, one score per axis — and
// the weighting is done in code, where every axis stays inspectable and the answers carry the
// distribution they came from. Keep the two in step: editing the prompt without editing this file
// (or the reverse) makes the two routes score differently.
import type { Relation } from "../events/relate.ts";
import type { SystemOneAnswer, SystemOneQuestion } from "../providers/llm.ts";

/** The seven content types of the scoring standard, most severe first. */
export const CONTENT_TYPES = [
  "exploited_vuln",
  "poc_release",
  "vendor_advisory",
  "supply_chain",
  "exploit_technique",
  "incident_report",
  "industry_policy",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/** The five grading axes; the answer to each is a number of points, 0-10. */
const AXES = ["sig", "nov", "cred", "reson", "act"] as const;

type Axis = (typeof AXES)[number];

/**
 * What each axis is worth per content type. Every row sums to 10, so the weighted total of five
 * 0-10 axes lands on 0-100 (the table in industry/prompts/selection-score.md).
 */
const TYPE_WEIGHTS: Record<ContentType, Record<Axis, number>> = {
  exploited_vuln: { sig: 3, nov: 1, cred: 2, reson: 2, act: 2 },
  poc_release: { sig: 2, nov: 2, cred: 2, reson: 1, act: 3 },
  vendor_advisory: { sig: 2, nov: 1, cred: 3, reson: 2, act: 2 },
  supply_chain: { sig: 3, nov: 2, cred: 1, reson: 2, act: 2 },
  exploit_technique: { sig: 2, nov: 3, cred: 1, reson: 1, act: 3 },
  incident_report: { sig: 3, nov: 2, cred: 2, reson: 3, act: 0 },
  industry_policy: { sig: 2, nov: 2, cred: 2, reson: 3, act: 1 },
};

/**
 * A score question is answered across its ordered levels, so the levels are anchored every two
 * points (0-10 in six steps) and the answer is the probability-weighted value between them, 0-5.
 * Six anchors keep every level describable; the value itself is continuous, not a choice of level.
 */
const POINTS_PER_LEVEL = 2;
const SCORE_LEVELS = 6;

const CONTENT_TYPE_CRITERIA = {
  exploited_vuln: "已确认在野利用、已列入 CISA KEV 或被大规模扫描攻击的漏洞",
  poc_release: "公开了 PoC、EXP 或复现步骤的漏洞",
  vendor_advisory: "厂商、CERT 或安全公告库发布的漏洞通告、补丁与影响版本说明",
  supply_chain: "开源仓库投毒、恶意包、依赖混淆、构建与发布凭证滥用",
  exploit_technique: "利用技术、绕过手法、利用链分析、检测与缓解方法",
  incident_report: "已发生的真实攻击、勒索、数据泄露与事后复盘",
  industry_policy: "漏洞治理政策、监管与标准、赏金与漏洞市场、生态趋势",
};

/** 0-2-4-6-8-10: how much the event matters for "do I have to act today". */
const SIG_LEVELS = [
  "与漏洞无关的当天脚注：安全培训、课程、招聘、活动与会议报名",
  "厂商营销；没有编号的模糊传闻；自报自赏、没有复现细节的赏金报告",
  "例行月度补丁汇总、多个编号打包的通告；需要本地高权限、非默认配置且无公开利用的理论漏洞",
  "常规通告，组件与影响范围清楚，但利用条件苛刻或影响面有限",
  "影响范围广、利用条件不苛刻；边界设备、网关、主流中间件与框架这类广泛使用组件的高危漏洞与补丁",
  "节点级：官方确认已在野利用或已列入 CISA KEV；无需认证、远程可利用、默认配置即可中招，直接导致接管或数据泄露",
];

/** 0-2-4-6-8-10: how much this material adds to what was already known. */
const NOV_LEVELS = [
  "原样复述已知状态，没有任何新事实",
  "换一种说法再讲一遍已知的洞",
  "给已知事件补充细节，但没有改变它处在哪个阶段",
  "首次披露一个有编号、有组件、有影响范围的漏洞",
  "状态升级：从已发布通告到出现公开 PoC，或从有 PoC 到确认在野利用",
  "状态升级到最高阶段且证据齐全：确认在野利用，同时给出补丁与完整影响版本",
];

/** 0-2-4-6-8-10: how strongly the material itself supports what it claims. */
const CRED_LEVELS = [
  "没有编号、没有组件名、没有版本的「某软件存在高危漏洞」式消息",
  "只有标题或编号，没有影响版本、利用条件与修复信息",
  "有编号但细节残缺，或来源不明的转述",
  "来源清楚、编号齐全，足以证明「发布过通告」这类动作",
  "编号齐全的官方通告或公告库记录，带影响版本与补丁说明",
  "厂商一手通告或 CISA KEV 收录，且给出复现细节或可直接验证的证据",
];

/** 0-2-4-6-8-10: how many readers this reaches through components they actually run. */
const RESON_LEVELS = [
  "几乎没有读者在用的小众产品",
  "需要特殊配置才能触发，或只在罕见部署形态下存在",
  "特定行业或特定技术栈才会用到的组件",
  "某类岗位普遍会用到的组件",
  "广泛使用的中间件、框架或操作系统组件",
  "边界设备、网关、Windows、Exchange、Chrome、Confluence 这类几乎人人都在用的目标",
];

/** 0-2-4-6-8-10: what a reader can do about it today. */
const ACT_LEVELS = [
  "今天做不了任何事：纯复盘、政策与趋势",
  "知道有风险，但既没有补丁也没有缓解办法",
  "有缓解思路，但要自行排查自己是否受影响",
  "有明确的升级版本或缓解配置可以照做",
  "补丁、检测规则、暴露面排查方法都有，今天就能动手",
  "已在野利用且补丁可用：今天必须完成处置",
];

function scoreQuestion(instructions: string, levels: string[]): SystemOneQuestion {
  return { type: "score", instructions, criteria: levels };
}

/**
 * The scoring step's questions: the content type, then one grade per axis. Every question is about
 * the same state, so they are answered together in one call and the total is computed in code —
 * that is what keeps the type weights and the axis grades the same on every run.
 */
export function scoreQuestions(): Record<string, SystemOneQuestion> {
  return {
    content_type: {
      type: "choice",
      instructions: "这条材料所代表的漏洞事件，最贴近下面哪一类？先确认是哪个组件、什么编号、处在什么阶段，再选类型。",
      criteria: CONTENT_TYPE_CRITERIA,
    },
    sig: scoreQuestion("这段材料所代表的事件，在「今天要不要动手」这件事上是节点还是脚注？影响范围广、默认配置即可中招、直接导致接管或数据泄露的，份量高。只评事件本身的份量，不评这篇稿件写得好不好。", SIG_LEVELS),
    nov: scoreQuestion("这段材料带来了多少明确的新认知？首次披露、状态升级（通告→有公开 PoC→确认在野利用→补丁发布）都算增量，重复转述不算。", NOV_LEVELS),
    cred: scoreQuestion("材料内部对核心事实提供了多强的支持？看的是证据本身，不是来源名气。材料没说「在野利用」就不算在野利用；标题与正文冲突时以正文为准。", CRED_LEVELS),
    reson: scoreQuestion("多少本站读者会因为自己或客户在用这个组件而受影响？组件被使用的广度可以用稳定的世界知识判断，漏洞本身的信息只能以材料为准。", RESON_LEVELS),
    act: scoreQuestion("读者今天能马上做什么？看有没有补丁、缓解措施、检测规则、需要升到哪个版本、要不要立即排查暴露面。纯复盘与政策类分数低是正常的。", ACT_LEVELS),
  };
}

/** The prefilter's question: whether the material belongs to this industry at all. Wide recall. */
export function prefilterQuestions(): Record<string, SystemOneQuestion> {
  return {
    label: {
      type: "choice",
      instructions: "这段材料讲的是本站行业的事吗？宽进：只有明显无关的才判 BLOCK。材料不足以判断时答 UNKNOWN，不要猜。",
      criteria: {
        PASS: "与本站行业有关的漏洞、组件、攻击、补丁、治理消息",
        BLOCK: "明显无关：与漏洞和安全无关的新闻、广告、招聘、课程、纯娱乐内容",
        UNKNOWN: "材料残缺或信息不足，无法确认是否属于本站行业",
      },
    },
  };
}

function answerOf(answers: Record<string, SystemOneAnswer>, id: string): SystemOneAnswer {
  const answer = answers[id];
  // A missing answer is a failed call, never a silent default: the receipt is rejected and retried.
  if (!answer) throw new Error(`no answer for question: ${id}`);
  return answer;
}

function readChoice(answers: Record<string, SystemOneAnswer>, id: string): string {
  const answer = answerOf(answers, id);
  if (answer.type !== "choice") throw new Error(`question ${id} answered as ${answer.type}, expected choice`);
  return answer.choice;
}

function readPoints(answers: Record<string, SystemOneAnswer>, id: string): number {
  const answer = answerOf(answers, id);
  if (answer.type !== "score") throw new Error(`question ${id} answered as ${answer.type}, expected score`);
  if (!Number.isFinite(answer.score) || answer.score < 0 || answer.score > SCORE_LEVELS - 1) {
    throw new Error(`question ${id} answered outside its levels: ${answer.score}`);
  }
  return answer.score * POINTS_PER_LEVEL;
}

/** The content type the model chose; a type the site does not define falls back to the plainest row. */
export function contentTypeOf(answers: Record<string, SystemOneAnswer>): ContentType {
  const chosen = readChoice(answers, "content_type");
  return (CONTENT_TYPES as readonly string[]).includes(chosen) ? (chosen as ContentType) : "vendor_advisory";
}

/**
 * The attention score the chat route used to print: the five axis grades weighted by the content
 * type's row. Rounded to an integer because the score is displayed and compared as one, and the
 * mean of two calls is what the threshold is held against.
 */
export function attentionScore(answers: Record<string, SystemOneAnswer>): number {
  const weights = TYPE_WEIGHTS[contentTypeOf(answers)];
  const total = AXES.reduce((sum, axis) => sum + readPoints(answers, axis) * weights[axis], 0);
  return Math.max(0, Math.min(100, Math.round(total)));
}

/** The prefilter verdict, in the labels the rest of the engine uses. */
export function prefilterLabel(answers: Record<string, SystemOneAnswer>): "PASS" | "BLOCK" | "UNKNOWN" {
  const chosen = readChoice(answers, "label");
  return chosen === "PASS" || chosen === "BLOCK" ? chosen : "UNKNOWN";
}

// Grouping
//
// The relation questions are asked one per candidate fact, all against the same state, in a single
// call. The chat route asks for the same four relations in prose and takes the answer's confidence
// as reported; a choice answer carries the confidence its probability distribution implies, which is
// what the merge thresholds are held against.

/**
 * The four relations, in the site's own terms (industry/prompts/group-definitions.md).
 * The same four label the answer keys, so they must stay the strings the engine compares against.
 */
const RELATION_CRITERIA: Record<Relation, string> = {
  SAME_OCCURRENCE:
    "同一次发生：同一主体在同一时间对同一个具体对象做的同一件事。同一漏洞编号（CVE / GHSA / CNVD 等）就是同一次发生——厂商通告、安全公告库收录、不同媒体与中英文转述、细节多寡不同，都算同一次发生；同一份通告里一并说明的多个受影响版本与产品、补丁与缓解措施，也算。同一次攻击事件、同一份事件复盘、同一份政策文件的报道同理。",
  SAME_STORY:
    "同一事件的不同进展：不是同一次发生，但围绕同一个具体漏洞或发生有直接的先后关系。同一编号的漏洞，从厂商通告到随后出现的 PoC、从有 PoC 到随后确认在野利用、从披露到厂商回应或追加补丁，都算；预告与正式发布、发布与之后在第三方平台上架或出现评测，也算。",
  UNRELATED:
    "不同的事：不同编号的漏洞，即使出在同一个产品里，也是不同的事；同一厂商同一天发布的两个漏洞通告也一样。只是提到同一个组件或厂商、针对某漏洞的教程、用法分享、个人观点或营销帖，除非明确复现或评测候选那一次具体发生，都是无关。",
  ROUNDUP:
    "其中一方汇集多个独立发生，把对方的事件当成多个条目之一：多话题盘点、月度补丁汇总、日报周报、多个独立产品的总览。综合稿与其中某个单事件报道不能是同一次发生或同一事件的进展；它同时提到两个独立事件，也不代表那两个事件可以合并。",
};

function relationQuestion(id: string, subject: string): SystemOneQuestion {
  return {
    type: "choice",
    instructions: `候选 ${id} 是一次已经归好的发生（附代表报道）。这段${subject}与它是同一次发生、同一事件的进展、无关的事，还是多话题汇总？先分别确认各自是哪个发生的哪一步，再判断。`,
    criteria: RELATION_CRITERIA,
  };
}

/** One relation question per candidate fact of a report, all answered against the same state. */
export function relationQuestions(candidateIds: string[]): Record<string, SystemOneQuestion> {
  const out: Record<string, SystemOneQuestion> = {};
  for (const id of candidateIds) out[id] = relationQuestion(id, "新报道");
  return out;
}

/** The same, for a discussion post that reports or reacts rather than reports the fact itself. */
export function signalQuestions(candidateIds: string[]): Record<string, SystemOneQuestion> {
  const out: Record<string, SystemOneQuestion> = {};
  for (const id of candidateIds) out[id] = relationQuestion(id, "帖子");
  return out;
}

/** One pair question: the review before a merge, and the direct comparison of two story roots. */
export function pairQuestion(): SystemOneQuestion {
  return {
    type: "choice",
    instructions: "报道 A 和报道 B 是什么关系？先分别确认各自是哪个发生的哪一步，再判断。",
    criteria: RELATION_CRITERIA,
  };
}

/**
 * The batch step's second question, separate from identity: whether the report says anything the
 * reader has not already seen in 精选. Knowing the identity of two reports does not settle it.
 */
export function selectionQuestion(): SystemOneQuestion {
  return {
    type: "noul",
    instructions:
      "这条新报道相对标着【已公开精选】和【已公开精选阅读背景】的内容，有没有值得单独让读者看见的具体新增信息？对照阅读背景里已披露过的具体事实，短摘要没写出来不代表原报道没披露。没有已公开精选的候选、也没有阅读背景时，算有新增。",
    criteria: {
      true: "带来尚未披露过的具体事实：利用状态升级（通告→出现公开 PoC→确认在野利用）、新的影响范围、具体修复或缓解、新的评测结果、明确可迁移的方法；同一件事已有精选代表时，其他来源或更完整的代表报道也算",
      false: "只是再次介绍已披露的能力、换宣传措辞、没有新增使用条件的平台上架、重复已选要点的总览；官方来源本身不构成新增信息",
    },
  };
}

/** One candidate's relation, with the confidence its distribution carries. */
export function relationOf(answers: Record<string, SystemOneAnswer>, id: string): { relation: Relation; confidence: number } {
  const answer = answerOf(answers, id);
  if (answer.type !== "choice") throw new Error(`question ${id} answered as ${answer.type}, expected choice`);
  if (!(answer.choice in RELATION_CRITERIA)) throw new Error(`question ${id} answered ${answer.choice}, which is not one of the four relations`);
  return { relation: answer.choice as Relation, confidence: answer.confidence };
}

/** The pair answer in the shape both pair steps read. `a`, `b` and `difference` are prose only. */
export function pairData(answers: Record<string, SystemOneAnswer>) {
  const { relation, confidence } = relationOf(answers, "relation");
  return { a: "", b: "", relation, difference: "", confidence };
}

/**
 * Whether the report adds something readers have not seen, in the shape the batch schema requires.
 * A System One model writes no prose, so the probability stands in for the reason: it is the number
 * the decision was actually made from, and the reader of 内容诊断 can see how firm it was.
 */
export function selectionData(answers: Record<string, SystemOneAnswer>): { addsValue: boolean; reason: string } {
  const answer = answerOf(answers, "adds_value");
  if (answer.type !== "noul") throw new Error(`question adds_value answered as ${answer.type}, expected noul`);
  const addsValue = answer.noul >= 0.5;
  return { addsValue, reason: `Jev：${addsValue ? "有" : "没有"}新增价值（概率 ${answer.noul.toFixed(2)}）` };
}
