import { randomUUID } from "crypto";
import { resolveLlmModel, type LlmTask } from "@/lib/llm-router";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type LlmJsonFormat =
  | { type: "json_object" }
  | { type: "json_schema"; name: string; schema: Record<string, unknown> };

export type LlmJsonResult = {
  text: string;
  model: string;
  provider: "openai" | "openrouter";
  usage?: LlmTokenUsage;
};

type LlmProvider = LlmJsonResult["provider"];

type LlmTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  source: "api" | "estimate";
};

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function extractOpenAiOutputText(payload: unknown) {
  const row = asRecord(payload);
  if (typeof row.output_text === "string") return row.output_text;
  const output = Array.isArray(row.output) ? row.output : [];
  for (const item of output) {
    const itemRecord = asRecord(item);
    const content = Array.isArray(itemRecord.content) ? itemRecord.content : [];
    for (const contentItem of content) {
      const contentRecord = asRecord(contentItem);
      if (typeof contentRecord.text === "string") return contentRecord.text;
    }
  }
  return "";
}

function extractOpenRouterOutputText(payload: unknown) {
  const row = asRecord(payload);
  const choices = Array.isArray(row.choices) ? row.choices : [];
  for (const choice of choices) {
    const message = asRecord(asRecord(choice).message);
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content
        .map((part) => asString(asRecord(part).text ?? asRecord(part).content))
        .filter(Boolean)
        .join("\n")
        .trim();
      if (text) return text;
    }
  }
  return "";
}

function normalizeApiUsage(input: {
  promptTokens: unknown;
  completionTokens: unknown;
  totalTokens: unknown;
}): LlmTokenUsage | undefined {
  const promptTokens = Math.max(0, Math.round(asNumber(input.promptTokens, 0)));
  const completionTokens = Math.max(0, Math.round(asNumber(input.completionTokens, 0)));
  const explicitTotal = Math.max(0, Math.round(asNumber(input.totalTokens, 0)));
  const totalTokens = explicitTotal || promptTokens + completionTokens;
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) return undefined;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    source: "api",
  };
}

function extractOpenAiUsage(payload: unknown) {
  const usage = asRecord(asRecord(payload).usage);
  return normalizeApiUsage({
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
  });
}

function extractOpenRouterUsage(payload: unknown) {
  const usage = asRecord(asRecord(payload).usage);
  return normalizeApiUsage({
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  });
}

function estimateTokens(text: string) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function usageWithEstimates(input: {
  prompt: string;
  completion: string;
  usage?: LlmTokenUsage;
}): LlmTokenUsage {
  const promptTokens = input.usage?.promptTokens || estimateTokens(input.prompt);
  const completionTokens = input.usage?.completionTokens || estimateTokens(input.completion);
  return {
    promptTokens,
    completionTokens,
    totalTokens: input.usage?.totalTokens || promptTokens + completionTokens,
    source: input.usage?.source || "estimate",
  };
}

function openAiTextFormat(format: LlmJsonFormat) {
  if (format.type === "json_object") {
    return { type: "json_object" as const };
  }
  return {
    type: "json_schema" as const,
    name: format.name,
    schema: format.schema,
  };
}

function openRouterResponseFormat(format: LlmJsonFormat) {
  if (format.type === "json_object") {
    return { type: "json_object" as const };
  }
  return {
    type: "json_schema" as const,
    json_schema: {
      name: format.name,
      strict: true,
      schema: format.schema,
    },
  };
}

function openRouterTaskEnvKey(task: LlmTask) {
  return `OPENROUTER_MODEL_TASK_${task.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

function canUseHighIntelligenceModel(task: LlmTask) {
  return task === "mission_operator" || task === "mission_plan_generation" || task === "operator_chat";
}

function routineOpenRouterModel() {
  return asString(process.env.OPENROUTER_MODEL_ROUTINE) || "google/gemini-3.5-flash";
}

function isGpt55Model(model: string) {
  return /^openai\/gpt-5\.5(?:$|-)|^gpt-5\.5(?:$|-)/i.test(model.trim());
}

function allowExpensiveOpenRouterModel() {
  return asString(process.env.ALLOW_EXPENSIVE_OPENROUTER).toLowerCase() === "true";
}

function resolveOpenRouterModel(task: LlmTask, overrideModel?: string) {
  const explicitOverride = asString(overrideModel);
  if (explicitOverride) {
    return isGpt55Model(explicitOverride) && !allowExpensiveOpenRouterModel()
      ? routineOpenRouterModel()
      : explicitOverride;
  }

  const configured =
    asString(process.env[openRouterTaskEnvKey(task)]) ||
    (canUseHighIntelligenceModel(task) ? asString(process.env.OPENROUTER_MODEL_MISSION_OPERATOR) : "") ||
    asString(process.env.OPENROUTER_MODEL_DEFAULT) ||
    asString(process.env.OPENROUTER_MODEL);

  if (configured) {
    return isGpt55Model(configured) && !allowExpensiveOpenRouterModel() ? routineOpenRouterModel() : configured;
  }

  return routineOpenRouterModel();
}

async function recordLlmJsonCall(input: {
  task: LlmTask;
  provider: LlmProvider;
  model: string;
  status: "completed" | "failed";
  prompt: string;
  completion: string;
  usage?: LlmTokenUsage;
  format: LlmJsonFormat;
  maxOutputTokens: number;
  reasoningEffort: string;
  durationMs: number;
  error: string;
  metadata: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const usage = usageWithEstimates({
    prompt: input.prompt,
    completion: input.completion,
    usage: input.usage,
  });

  try {
    const { error } = await supabase.from("demanddev_llm_json_calls").insert({
      id: randomUUID(),
      task: input.task,
      provider: input.provider,
      model: input.model,
      status: input.status,
      format_type: input.format.type,
      prompt_chars: input.prompt.length,
      completion_chars: input.completion.length,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      token_source: usage.source,
      max_output_tokens: input.maxOutputTokens,
      reasoning_effort: input.reasoningEffort,
      duration_ms: input.durationMs,
      error: input.error,
      metadata: input.metadata,
    });
    if (error) return;
  } catch {
    // Telemetry must never block an operator turn.
  }
}

async function callAndRecordLlmJson(input: {
  task: LlmTask;
  provider: LlmProvider;
  expectedModel: string;
  prompt: string;
  format: LlmJsonFormat;
  maxOutputTokens: number;
  reasoningEffort: string;
  providerMode: string;
  attempt: string;
  execute: () => Promise<LlmJsonResult>;
}) {
  const startedAt = Date.now();
  try {
    const result = await input.execute();
    await recordLlmJsonCall({
      task: input.task,
      provider: result.provider,
      model: result.model || input.expectedModel,
      status: "completed",
      prompt: input.prompt,
      completion: result.text,
      usage: result.usage,
      format: input.format,
      maxOutputTokens: input.maxOutputTokens,
      reasoningEffort: input.reasoningEffort,
      durationMs: Date.now() - startedAt,
      error: "",
      metadata: {
        providerMode: input.providerMode,
        attempt: input.attempt,
      },
    });
    return result;
  } catch (error) {
    await recordLlmJsonCall({
      task: input.task,
      provider: input.provider,
      model: input.expectedModel,
      status: "failed",
      prompt: input.prompt,
      completion: "",
      format: input.format,
      maxOutputTokens: input.maxOutputTokens,
      reasoningEffort: input.reasoningEffort,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message.slice(0, 1200) : asString(error).slice(0, 1200),
      metadata: {
        providerMode: input.providerMode,
        attempt: input.attempt,
      },
    });
    throw error;
  }
}

async function callOpenAiResponses(input: {
  task: LlmTask;
  prompt: string;
  format: LlmJsonFormat;
  maxOutputTokens: number;
  reasoningEffort: string;
  overrideModel?: string;
}) {
  const apiKey = asString(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  const model = resolveLlmModel(input.task, {
    prompt: input.prompt,
    overrideModel: input.overrideModel,
  });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: input.prompt,
      reasoning: { effort: input.reasoningEffort },
      text: { format: openAiTextFormat(input.format) },
      max_output_tokens: input.maxOutputTokens,
      store: false,
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}: ${raw.slice(0, 800)}`);
  }
  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  return {
    text: extractOpenAiOutputText(payload),
    model,
    provider: "openai" as const,
    usage: extractOpenAiUsage(payload),
  };
}

async function callOpenRouterChat(input: {
  task: LlmTask;
  prompt: string;
  format: LlmJsonFormat;
  maxOutputTokens: number;
  overrideModel?: string;
}) {
  const apiKey = asString(process.env.OPENROUTER_API_KEY);
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }
  const model = resolveOpenRouterModel(input.task, input.overrideModel);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": asString(process.env.NEXT_PUBLIC_APP_URL) || "https://www.lastb2b.com",
      "X-OpenRouter-Title": "LastB2B",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: input.prompt }],
      response_format: openRouterResponseFormat(input.format),
      max_tokens: input.maxOutputTokens,
      provider: { require_parameters: true },
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter request failed with ${response.status}: ${raw.slice(0, 800)}`);
  }
  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  return {
    text: extractOpenRouterOutputText(payload),
    model,
    provider: "openrouter" as const,
    usage: extractOpenRouterUsage(payload),
  };
}

export async function generateJsonWithLlm(input: {
  task: LlmTask;
  prompt: string;
  format: LlmJsonFormat;
  maxOutputTokens: number;
  reasoningEffort?: string;
  openAiOverrideModel?: string;
  openRouterOverrideModel?: string;
}): Promise<LlmJsonResult> {
  const provider = asString(process.env.LLM_JSON_PROVIDER).toLowerCase();
  const reasoningEffort = input.reasoningEffort || "high";
  if (provider === "openrouter") {
    return callAndRecordLlmJson({
      task: input.task,
      provider: "openrouter",
      expectedModel: resolveOpenRouterModel(input.task, input.openRouterOverrideModel),
      prompt: input.prompt,
      format: input.format,
      maxOutputTokens: input.maxOutputTokens,
      reasoningEffort,
      providerMode: provider,
      attempt: "primary",
      execute: () =>
        callOpenRouterChat({
          task: input.task,
          prompt: input.prompt,
          format: input.format,
          maxOutputTokens: input.maxOutputTokens,
          overrideModel: input.openRouterOverrideModel,
        }),
    });
  }
  if (provider === "openai") {
    return callAndRecordLlmJson({
      task: input.task,
      provider: "openai",
      expectedModel: resolveLlmModel(input.task, {
        prompt: input.prompt,
        overrideModel: input.openAiOverrideModel,
      }),
      prompt: input.prompt,
      format: input.format,
      maxOutputTokens: input.maxOutputTokens,
      reasoningEffort,
      providerMode: provider,
      attempt: "primary",
      execute: () =>
        callOpenAiResponses({
          task: input.task,
          prompt: input.prompt,
          format: input.format,
          maxOutputTokens: input.maxOutputTokens,
          reasoningEffort,
          overrideModel: input.openAiOverrideModel,
        }),
    });
  }

  try {
    return await callAndRecordLlmJson({
      task: input.task,
      provider: "openai",
      expectedModel: resolveLlmModel(input.task, {
        prompt: input.prompt,
        overrideModel: input.openAiOverrideModel,
      }),
      prompt: input.prompt,
      format: input.format,
      maxOutputTokens: input.maxOutputTokens,
      reasoningEffort,
      providerMode: provider || "auto",
      attempt: "auto_openai",
      execute: () =>
        callOpenAiResponses({
          task: input.task,
          prompt: input.prompt,
          format: input.format,
          maxOutputTokens: input.maxOutputTokens,
          reasoningEffort,
          overrideModel: input.openAiOverrideModel,
        }),
    });
  } catch (openAiError) {
    if (!asString(process.env.OPENROUTER_API_KEY)) {
      throw openAiError;
    }
    return callAndRecordLlmJson({
      task: input.task,
      provider: "openrouter",
      expectedModel: resolveOpenRouterModel(input.task, input.openRouterOverrideModel),
      prompt: input.prompt,
      format: input.format,
      maxOutputTokens: input.maxOutputTokens,
      reasoningEffort,
      providerMode: provider || "auto",
      attempt: "fallback_openrouter",
      execute: () =>
        callOpenRouterChat({
          task: input.task,
          prompt: input.prompt,
          format: input.format,
          maxOutputTokens: input.maxOutputTokens,
          overrideModel: input.openRouterOverrideModel,
        }),
    });
  }
}
