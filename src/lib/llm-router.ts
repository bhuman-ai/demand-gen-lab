export type LlmTask =
  | "intake_prefill"
  | "experiment_setup_generate"
  | "objective_suggest"
  | "build_suggest"
  | "hypotheses_generate"
  | "hypotheses_suggest"
  | "experiments_generate"
  | "experiments_suggest"
  | "evolution_suggest"
  | "experiment_suggestions_generate"
  | "experiment_suggestions_roleplay"
  | "conversation_flow_generation"
  | "conversation_flow_roleplay"
  | "conversation_prompt_render"
  | "lead_chain_planning"
  | "lead_actor_query_planning"
  | "lead_quality_policy"
  | "lead_chain_selection"
  | "company_domain_matcher"
  | "reply_policy_evaluation"
  | "reply_thread_state_compile"
  | "reply_thread_draft_generate"
  | "social_search_planning"
  | "social_comment_planning"
  | "inbox_eval_roleplay"
  | "inbox_eval_score";

type ModelTier = "fast" | "default" | "high";

const DEFAULT_MODEL = "gpt-5.2";

const TASK_BASE_TIER: Record<LlmTask, ModelTier> = {
  intake_prefill: "default",
  experiment_setup_generate: "default",
  objective_suggest: "default",
  build_suggest: "default",
  hypotheses_generate: "default",
  hypotheses_suggest: "default",
  experiments_generate: "default",
  experiments_suggest: "default",
  evolution_suggest: "default",
  experiment_suggestions_generate: "default",
  experiment_suggestions_roleplay: "high",
  conversation_flow_generation: "high",
  conversation_flow_roleplay: "high",
  conversation_prompt_render: "high",
  lead_chain_planning: "high",
  lead_actor_query_planning: "high",
  lead_quality_policy: "high",
  lead_chain_selection: "high",
  company_domain_matcher: "fast",
  reply_policy_evaluation: "high",
  reply_thread_state_compile: "high",
  reply_thread_draft_generate: "high",
  social_search_planning: "default",
  social_comment_planning: "default",
  inbox_eval_roleplay: "high",
  inbox_eval_score: "high",
};

function normalizeModelName(value: unknown) {
  const model = String(value ?? "").trim();
  return model;
}

function taskEnvKey(task: LlmTask) {
  return `OPENAI_MODEL_TASK_${task.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function estimateTokensFromText(text: string) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function estimateTokens(input: unknown) {
  if (!input) return 0;
  if (typeof input === "string") return estimateTokensFromText(input);
  try {
    return estimateTokensFromText(JSON.stringify(input));
  } catch {
    return 0;
  }
}

function chooseTier(task: LlmTask, inputTokens: number): ModelTier {
  const baseTier = TASK_BASE_TIER[task];
  if (inputTokens > 10_000) return "high";
  if (inputTokens < 1_800 && baseTier === "default") return "fast";
  return baseTier;
}

export function resolveLlmModel(
  task: LlmTask,
  options: {
    prompt?: string;
    input?: unknown;
    overrideModel?: string;
    legacyModelEnv?: string;
  } = {}
) {
  const explicit = normalizeModelName(options.overrideModel);
  if (explicit) return explicit;

  const byTask = normalizeModelName(process.env[taskEnvKey(task)]);
  if (byTask) return byTask;

  const legacy = normalizeModelName(options.legacyModelEnv);
  if (legacy) return legacy;

  const defaultModel = normalizeModelName(process.env.OPENAI_MODEL_DEFAULT) || DEFAULT_MODEL;
  const fastModel = normalizeModelName(process.env.OPENAI_MODEL_FAST) || defaultModel;
  const highModel = normalizeModelName(process.env.OPENAI_MODEL_HIGH) || defaultModel;

  const inputTokens = Math.max(
    estimateTokens(options.prompt),
    estimateTokens(options.input)
  );
  const tier = chooseTier(task, inputTokens);

  if (tier === "fast") return fastModel;
  if (tier === "high") return highModel;
  return defaultModel;
}
