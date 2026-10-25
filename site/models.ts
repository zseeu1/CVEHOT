// 这个站用哪些模型。框架自带一个 `default`：环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 指定的模型。
// 这里再列出具名的模型（每个用自己的地址和密钥环境变量），以及每一步默认用哪个；没写的步骤用 default。
// 部署时还可以用环境变量（PREFILTER_MODEL、SCORE_MODEL……）或后台的“模型与评测”页逐步改选。

import type { ModelPreset } from "@aihot/contracts/site-config";
export type { ModelPreset } from "@aihot/contracts/site-config";

/** 具名的模型示例（每个要配自己的密钥）。用不上可以删掉。 */
export const PRESETS: Record<string, ModelPreset> = {
  // GLM 5.3 Flash always reasons; the lowest effort keeps short structured tasks fast.
  "glm-5.3-flash": {
    service: "zhipu", model: "glm-5.3-flash", baseUrlEnv: "ZHIPU_BASE_URL", apiKeyEnv: "ZHIPU_API_KEY",
    extra: { thinking: { type: "enabled" }, reasoning_effort: "low" }, jsonMode: true, vision: true,
  },
  // The scorer's parameters for glm-5.3-flash: temperature 1 with high reasoning, up to 180 s per call.
  "glm-5.3-flash-selection": {
    service: "zhipu", model: "glm-5.3-flash", baseUrlEnv: "ZHIPU_BASE_URL", apiKeyEnv: "ZHIPU_API_KEY",
    extra: { thinking: { type: "enabled", clear_thinking: false }, reasoning_effort: "high", top_p: 0.95 }, jsonMode: true, vision: true,
    scoreCall: { temperature: 1, maxTokens: 65_536, timeoutMs: 180_000 },
  },
  // DeepSeek Flash reasons by default; structured tasks switch it off. deepseek-flash-think keeps it on,
  // with room in the output for the reasoning.
  "deepseek-flash": {
    service: "deepseek", model: "deepseek-flash", baseUrlEnv: "DEEPSEEK_BASE_URL", apiKeyEnv: "DEEPSEEK_API_KEY",
    extra: { thinking: { type: "disabled" } }, jsonMode: true,
  },
  "deepseek-flash-think": {
    service: "deepseek", model: "deepseek-flash", baseUrlEnv: "DEEPSEEK_BASE_URL", apiKeyEnv: "DEEPSEEK_API_KEY", reasoningTokens: 4000, jsonMode: true,
  },
  "qwen3.7-flash": {
    service: "dashscope", model: "qwen3.7-flash", baseUrlEnv: "DASHSCOPE_BASE_URL", apiKeyEnv: "DASHSCOPE_API_KEY",
    extra: { enable_thinking: false }, jsonMode: true,
  },
  "qwen3.8-flash": {
    service: "dashscope", model: "qwen3.8-flash", baseUrlEnv: "DASHSCOPE_BASE_URL", apiKeyEnv: "DASHSCOPE_API_KEY",
    extra: { enable_thinking: false }, jsonMode: true,
  },
  "mimo-v2.6-flash": {
    service: "mimo", model: "mimo-v2.6-flash", baseUrlEnv: "XIAOMI_MIMO_BASE_URL", apiKeyEnv: "XIAOMI_MIMO_API_KEY",
    extra: { thinking: { type: "disabled" } }, jsonMode: true,
  },
  "qwen3-vl-flash": {
    service: "dashscope", model: "qwen3-vl-flash", baseUrlEnv: "DASHSCOPE_BASE_URL", apiKeyEnv: "DASHSCOPE_API_KEY",
    extra: { enable_thinking: false }, jsonMode: false, vision: true,
  },
  // Jev 是 TypeSafe 的 System One 模型：输入 state 加一组类型化问题，返回类型化答案和概率，不生成文本，
  // 也没有 JSON 需要解析。只接文本，不支持图片。每一步问什么写在 backend 的 editorial/jev.ts。
  // JEV_BASE_URL 填地址本身、不带 /v1（请求发到 <base>/v1/systemone），密钥要和地址同一家：
  //   官方   JEV_BASE_URL=https://api.typesafe.ai     JEV_API_KEY=TypeSafe 的密钥
  //   中转   JEV_BASE_URL=https://openrouter.ai/api   JEV_API_KEY=OpenRouter 的密钥
  // 换地址不用改代码；差别只在回执：中转会在响应里带上这次调用的实际费用（usage.cost），后台成本页
  // 据此显示真实金额；官方不返回这个字段，成本退回按 service_prices 表估算（要自己填一行单价）。
  // 注意模型调用不走 EGRESS_PROXY_URL（那是采集和图片用的），连不通只能在机器层面解决。
  "jev": {
    service: "typesafe", model: "jev-1.13", baseUrlEnv: "JEV_BASE_URL", apiKeyEnv: "JEV_API_KEY",
    jsonMode: false, typed: true,
  },
};

/**
 * 每一步默认用的模型（步骤见后台“模型与评测”页），值是上面的名字或 default。没写的步骤用 default。
 * 例：{ score: "glm-5.3-flash-selection", groupReview: "mimo-v2.6-flash" }
 */
export const DEFAULTS: Record<string, string> = {};
