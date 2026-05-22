import { resolveLlmModel, type LlmTask } from "@/lib/llm-router";

export type LlmJsonFormat =
  | { type: "json_object" }
  | { type: "json_schema"; name: string; schema: Record<string, unknown> };

export type LlmJsonResult = {
  text: string;
  model: string;
  provider: "openai" | "openrouter";
};

function asString(value: unknown) {
  return String(value ?? "").trim();
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

function resolveOpenRouterModel(task: LlmTask, overrideModel?: string) {
  return (
    asString(overrideModel) ||
    asString(process.env[openRouterTaskEnvKey(task)]) ||
    asString(process.env.OPENROUTER_MODEL_MISSION_OPERATOR) ||
    asString(process.env.OPENROUTER_MODEL_DEFAULT) ||
    asString(process.env.OPENROUTER_MODEL) ||
    "openai/gpt-5.5"
  );
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
    return callOpenRouterChat({
      task: input.task,
      prompt: input.prompt,
      format: input.format,
      maxOutputTokens: input.maxOutputTokens,
      overrideModel: input.openRouterOverrideModel,
    });
  }
  if (provider === "openai") {
    return callOpenAiResponses({
      task: input.task,
      prompt: input.prompt,
      format: input.format,
      maxOutputTokens: input.maxOutputTokens,
      reasoningEffort,
      overrideModel: input.openAiOverrideModel,
    });
  }

  try {
    return await callOpenAiResponses({
      task: input.task,
      prompt: input.prompt,
      format: input.format,
      maxOutputTokens: input.maxOutputTokens,
      reasoningEffort,
      overrideModel: input.openAiOverrideModel,
    });
  } catch (openAiError) {
    if (!asString(process.env.OPENROUTER_API_KEY)) {
      throw openAiError;
    }
    return callOpenRouterChat({
      task: input.task,
      prompt: input.prompt,
      format: input.format,
      maxOutputTokens: input.maxOutputTokens,
      overrideModel: input.openRouterOverrideModel,
    });
  }
}
