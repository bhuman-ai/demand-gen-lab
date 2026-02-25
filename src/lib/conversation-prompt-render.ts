import { createHash } from "crypto";
import { sanitizeAiText } from "@/lib/ai-sanitize";
import type { ConversationFlowNode, ConversationPromptPolicy } from "@/lib/factory-types";
import { resolveLlmModel } from "@/lib/llm-router";

export type ConversationPromptIntent =
  | "question"
  | "interest"
  | "objection"
  | "unsubscribe"
  | "other"
  | "";

export type ConversationPromptRenderContext = {
  brand: {
    id?: string;
    name: string;
    website: string;
    tone: string;
    notes: string;
  };
  campaign: {
    id?: string;
    name: string;
    objectiveGoal: string;
    objectiveConstraints: string;
  };
  experiment: {
    id?: string;
    name: string;
    offer: string;
    cta: string;
    audience: string;
    notes: string;
  };
  lead: {
    id?: string;
    email: string;
    name: string;
    company: string;
    title: string;
    domain: string;
    status: string;
  };
  thread: {
    sessionId: string;
    nodeId: string;
    parentMessageId: string;
    latestInboundSubject: string;
    latestInboundBody: string;
    intent: ConversationPromptIntent;
    confidence: number;
    priorNodePath: string[];
  };
  safety: {
    maxDepth: number;
    dailyCap: number;
    hourlyCap: number;
    minSpacingMinutes: number;
    timezone: string;
  };
};

export type ConversationPromptTrace = {
  mode: "prompt_v1";
  model: string;
  promptVersion: number;
  promptHash: string;
  policy: ConversationPromptPolicy;
  validation: {
    passed: boolean;
    reason: string;
    subjectWords: number;
    bodyWords: number;
    ctaOccurrences: number;
    unresolvedTemplateTokens: boolean;
    bannedPhrase: string;
  };
  quality: {
    clarity: number;
    specificity: number;
    risk: number;
  };
};

export type ConversationPromptRenderResult =
  | {
      ok: true;
      subject: string;
      body: string;
      cta: string;
      trace: ConversationPromptTrace;
    }
  | {
      ok: false;
      reason: string;
      trace: ConversationPromptTrace;
    };

const DEFAULT_POLICY: ConversationPromptPolicy = {
  subjectMaxWords: 8,
  bodyMaxWords: 120,
  exactlyOneCta: true,
};

const BANNED_VAGUE_PHRASES = [
  "quick question",
  "just checking",
  "circle back",
  "touching base",
  "game-changing",
  "best-in-class",
  "cutting-edge",
  "revolutionary",
  "synergy",
];

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function extractOutputText(payloadRaw: unknown) {
  const payload = asRecord(payloadRaw);
  const output = Array.isArray(payload.output) ? payload.output : [];
  const firstOutput = asRecord(output[0]);
  const content = Array.isArray(firstOutput.content) ? firstOutput.content : [];
  return (
    String(payload.output_text ?? "") ||
    String(
      content
        .map((item) => asRecord(item))
        .find((item) => typeof item.text === "string")?.text ?? ""
    ) ||
    "{}"
  );
}

function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function wordCount(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function clampQuality(value: unknown, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, Number(num.toFixed(3))));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unresolvedTemplateTokens(text: string) {
  return /{{\s*[^}]+\s*}}/.test(text);
}

function findBannedPhrase(subject: string, body: string) {
  const combined = `${subject}\n${body}`.toLowerCase();
  for (const phrase of BANNED_VAGUE_PHRASES) {
    if (combined.includes(phrase)) return phrase;
  }
  return "";
}

function resolvePolicy(node: ConversationFlowNode): ConversationPromptPolicy {
  const row = node.promptPolicy ?? DEFAULT_POLICY;
  return {
    subjectMaxWords: clampInt(row.subjectMaxWords, DEFAULT_POLICY.subjectMaxWords, 3, 20),
    bodyMaxWords: clampInt(row.bodyMaxWords, DEFAULT_POLICY.bodyMaxWords, 40, 260),
    exactlyOneCta: row.exactlyOneCta !== false,
  };
}

function defaultTrace(node: ConversationFlowNode, model: string): ConversationPromptTrace {
  const policy = resolvePolicy(node);
  return {
    mode: "prompt_v1",
    model,
    promptVersion: Math.max(1, Number(node.promptVersion || 1)),
    promptHash: "",
    policy,
    validation: {
      passed: false,
      reason: "",
      subjectWords: 0,
      bodyWords: 0,
      ctaOccurrences: 0,
      unresolvedTemplateTokens: false,
      bannedPhrase: "",
    },
    quality: {
      clarity: 0,
      specificity: 0,
      risk: 1,
    },
  };
}

function buildPrompt(input: {
  node: ConversationFlowNode;
  policy: ConversationPromptPolicy;
  context: ConversationPromptRenderContext;
}) {
  const nodePrompt = input.node.promptTemplate.trim();
  return [
    "You are an outbound email copywriter for managed B2B outreach automation.",
    "Write ONE outbound email for the given node.",
    "Return JSON only with this exact shape:",
    '{"subject":"...","body":"...","cta":"...","quality":{"clarity":0-1,"specificity":0-1,"risk":0-1}}',
    "",
    "Hard constraints:",
    `- Subject must be <= ${input.policy.subjectMaxWords} words.`,
    `- Body must be <= ${input.policy.bodyMaxWords} words.`,
    "- Body must be specific, concrete, and easy to understand.",
    "- No buzzwords, no placeholder tokens, no unresolved variables.",
    "- If context includes prior inbound message, respond to that context.",
    input.policy.exactlyOneCta
      ? "- Include exactly one explicit CTA sentence in the body, and make the same CTA text available in the cta field."
      : "- Include a clear CTA in the body.",
    "",
    `Node title: ${input.node.title}`,
    `Node kind: ${input.node.kind}`,
    `Node prompt template:\n${nodePrompt}`,
    "",
    `Execution context JSON:\n${JSON.stringify(input.context)}`,
  ].join("\n");
}

async function openAiJsonCall(input: { prompt: string; model: string }): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      input: input.prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: 1200,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI message generation failed (HTTP ${response.status}): ${raw.slice(0, 300)}`);
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }

  const outputText = extractOutputText(payload);
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error(`Model output was not valid JSON: ${outputText.slice(0, 220)}`);
  }

  return asRecord(parsed);
}

function validateOutput(input: {
  subject: string;
  body: string;
  cta: string;
  policy: ConversationPromptPolicy;
}) {
  const subjectWords = wordCount(input.subject);
  const bodyWords = wordCount(input.body);
  const unresolved = unresolvedTemplateTokens(input.subject) || unresolvedTemplateTokens(input.body);
  const bannedPhrase = findBannedPhrase(input.subject, input.body);

  let ctaOccurrences = 0;
  const cta = oneLine(input.cta);
  if (cta) {
    const expr = new RegExp(escapeRegExp(cta), "gi");
    const matches = input.body.match(expr);
    ctaOccurrences = matches?.length ?? 0;
  }

  if (!input.subject.trim()) {
    return { ok: false as const, reason: "Generated subject is empty", subjectWords, bodyWords, ctaOccurrences, unresolved, bannedPhrase };
  }
  if (!input.body.trim()) {
    return { ok: false as const, reason: "Generated body is empty", subjectWords, bodyWords, ctaOccurrences, unresolved, bannedPhrase };
  }
  if (subjectWords > input.policy.subjectMaxWords) {
    return {
      ok: false as const,
      reason: `Subject exceeds max words (${subjectWords}/${input.policy.subjectMaxWords})`,
      subjectWords,
      bodyWords,
      ctaOccurrences,
      unresolved,
      bannedPhrase,
    };
  }
  if (bodyWords > input.policy.bodyMaxWords) {
    return {
      ok: false as const,
      reason: `Body exceeds max words (${bodyWords}/${input.policy.bodyMaxWords})`,
      subjectWords,
      bodyWords,
      ctaOccurrences,
      unresolved,
      bannedPhrase,
    };
  }
  if (unresolved) {
    return {
      ok: false as const,
      reason: "Generated output contains unresolved template tokens",
      subjectWords,
      bodyWords,
      ctaOccurrences,
      unresolved,
      bannedPhrase,
    };
  }
  if (bannedPhrase) {
    return {
      ok: false as const,
      reason: `Generated output contains banned vague phrase: ${bannedPhrase}`,
      subjectWords,
      bodyWords,
      ctaOccurrences,
      unresolved,
      bannedPhrase,
    };
  }
  if (input.policy.exactlyOneCta) {
    if (!cta) {
      return {
        ok: false as const,
        reason: "Generated output is missing CTA text",
        subjectWords,
        bodyWords,
        ctaOccurrences,
        unresolved,
        bannedPhrase,
      };
    }
    if (ctaOccurrences !== 1) {
      return {
        ok: false as const,
        reason: `Generated output must include exactly one CTA occurrence (found ${ctaOccurrences})`,
        subjectWords,
        bodyWords,
        ctaOccurrences,
        unresolved,
        bannedPhrase,
      };
    }
  }

  return { ok: true as const, subjectWords, bodyWords, ctaOccurrences, unresolved, bannedPhrase };
}

export function conversationPromptModeEnabled() {
  const raw = String(process.env.CONVERSATION_PROMPT_MODE_ENABLED ?? "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

export async function generateConversationPromptMessage(input: {
  node: ConversationFlowNode;
  context: ConversationPromptRenderContext;
  model?: string;
}): Promise<ConversationPromptRenderResult> {
  const model = resolveLlmModel("conversation_prompt_render", {
    overrideModel: input.model,
    legacyModelEnv: process.env.CONVERSATION_PROMPT_MODEL,
  });
  const trace = defaultTrace(input.node, model);

  if (input.node.kind !== "message") {
    return { ok: false, reason: "Node is not a message node", trace };
  }

  const promptTemplate = String(input.node.promptTemplate ?? "").trim();
  if (!promptTemplate) {
    return { ok: false, reason: "Node prompt template is empty", trace };
  }

  const policy = resolvePolicy(input.node);
  const prompt = buildPrompt({ node: input.node, policy, context: input.context });
  trace.policy = policy;
  trace.promptHash = createHash("sha256").update(prompt).digest("hex").slice(0, 24);

  try {
    const parsed = await openAiJsonCall({ prompt, model });
    const qualityRaw = asRecord(parsed.quality);
    trace.quality = {
      clarity: clampQuality(qualityRaw.clarity, 0),
      specificity: clampQuality(qualityRaw.specificity, 0),
      risk: clampQuality(qualityRaw.risk, 1),
    };

    const subject = sanitizeAiText(normalizeWhitespace(String(parsed.subject ?? "")));
    const body = sanitizeAiText(normalizeWhitespace(String(parsed.body ?? "")));
    const cta = sanitizeAiText(oneLine(String(parsed.cta ?? "")));
    const validation = validateOutput({ subject, body, cta, policy });

    trace.validation = {
      passed: validation.ok,
      reason: validation.ok ? "" : validation.reason,
      subjectWords: validation.subjectWords,
      bodyWords: validation.bodyWords,
      ctaOccurrences: validation.ctaOccurrences,
      unresolvedTemplateTokens: validation.unresolved,
      bannedPhrase: validation.bannedPhrase,
    };

    if (!validation.ok) {
      return { ok: false, reason: validation.reason, trace };
    }

    return {
      ok: true,
      subject,
      body,
      cta,
      trace,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Conversation prompt generation failed";
    trace.validation = {
      ...trace.validation,
      passed: false,
      reason: message,
    };
    return {
      ok: false,
      reason: message,
      trace,
    };
  }
}
