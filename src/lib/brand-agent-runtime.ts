import { generateJsonWithLlm } from "@/lib/llm-json";
import type {
  OperatorChatAssistantReply,
  OperatorChatRequest,
  OperatorRequestedAction,
  OperatorToolName,
  OperatorToolResult,
  OperatorToolSpec,
} from "@/lib/operator-types";

export type BrandAgentTraceEntry = {
  step: number;
  objectType?: string;
  toolName: string;
  riskLevel: string;
  input: Record<string, unknown>;
  summary: string;
  result: Record<string, unknown>;
  error: string;
  rationale?: string;
  goal?: string;
  hypothesis?: string;
  stopReason?: string;
  missingCapability?: string;
  evidenceNeeded?: string[];
  avoidedWrongPaths?: string[];
};

export type BrandAgentRecentMessage = {
  role: string;
  kind: string;
  text: string;
};

export type BrandAgentTurnResult = {
  assistant: OperatorChatAssistantReply;
  requestedAction: OperatorRequestedAction | null;
  model: string;
  trace: BrandAgentTraceEntry[];
  evidenceCheck: BrandAgentEvidenceCheck | null;
};

export type BrandAgentEvidenceStatus = "verified" | "inconclusive" | "insufficient";

export type BrandAgentEvidenceCheck = {
  status: BrandAgentEvidenceStatus;
  summary: string;
  gaps: string[];
};

type AgentStep = {
  message: string;
  done: boolean;
  objectType: string;
  toolName: string;
  toolInputJson: string;
  rationale: string;
  goal: string;
  hypothesis: string;
  stopReason: string;
  missingCapability: string;
  evidenceStatus: BrandAgentEvidenceStatus | "";
  evidenceSummary: string;
  evidenceGaps: string[];
  evidenceNeeded: string[];
  avoidedWrongPaths: string[];
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

function maybeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}... [truncated]` : value;
}

function redactSensitiveKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactSensitiveKeys(entry));
  if (!value || typeof value !== "object") return value;
  const clean: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/(api[_-]?key|password|secret|token|authorization|credential|authcode|refresh[_-]?token|access[_-]?token)/i.test(key)) {
      clean[key] = "[redacted]";
      continue;
    }
    clean[key] = redactSensitiveKeys(entry);
  }
  return clean;
}

function compactForPrompt(value: unknown, maxLength: number) {
  const redacted = redactSensitiveKeys(value);
  const json = maybeJson(redacted);
  if (!json) return redacted;
  if (json.length <= maxLength) return redacted;
  return {
    truncated: true,
    excerpt: truncateText(json, maxLength),
  };
}

function normalizeAssistantReply(value: unknown, fallback: OperatorChatAssistantReply): OperatorChatAssistantReply {
  const row = asRecord(value);
  const summary = asString(row.message) || asString(row.summary) || fallback.summary;
  return {
    summary,
    findings: [],
    recommendations: [],
  };
}

function normalizeEvidenceStatus(value: unknown): BrandAgentEvidenceStatus | "" {
  const normalized = asString(value).toLowerCase();
  if (normalized === "verified" || normalized === "inconclusive" || normalized === "insufficient") {
    return normalized;
  }
  return "";
}

function normalizeEvidenceCheck(step: AgentStep, trace: BrandAgentTraceEntry[]): BrandAgentEvidenceCheck | null {
  const status = step.evidenceStatus || (trace.length ? "inconclusive" : "");
  const summary = step.evidenceSummary || (trace.length ? "Tool observations were gathered, but the agent did not label what they prove." : "");
  if (!status && !summary && !step.evidenceGaps.length) return null;
  return {
    status: status || "insufficient",
    summary: summary || "No evidence self-check was provided.",
    gaps: step.evidenceGaps,
  };
}

function parseAgentStep(rawText: string): AgentStep | null {
  if (!rawText) return null;
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(rawText);
  } catch {
    console.error("Brand agent JSON parse failed", rawText.slice(0, 800));
    return null;
  }
  const row = asRecord(parsed);
  return {
    message: asString(row.message),
    done: row.done === true,
    objectType: asString(row.objectType),
    toolName: asString(row.toolName),
    toolInputJson: asString(row.toolInputJson) || "{}",
    rationale: asString(row.rationale),
    goal: asString(row.goal),
    hypothesis: asString(row.hypothesis),
    stopReason: asString(row.stopReason),
    missingCapability: asString(row.missingCapability),
    evidenceStatus: normalizeEvidenceStatus(row.evidenceStatus),
    evidenceSummary: asString(row.evidenceSummary),
    evidenceGaps: Array.isArray(row.evidenceGaps)
      ? row.evidenceGaps.map((entry) => asString(entry)).filter(Boolean).slice(0, 6)
      : [],
    evidenceNeeded: Array.isArray(row.evidenceNeeded)
      ? row.evidenceNeeded.map((entry) => asString(entry)).filter(Boolean).slice(0, 8)
      : [],
    avoidedWrongPaths: Array.isArray(row.avoidedWrongPaths)
      ? row.avoidedWrongPaths.map((entry) => asString(entry)).filter(Boolean).slice(0, 8)
      : [],
  };
}

function parseToolInput(value: string) {
  try {
    return asRecord(JSON.parse(value || "{}"));
  } catch {
    return {};
  }
}

function buildToolCatalog(tools: OperatorToolSpec[]) {
  return tools.map((tool) => ({
    name: tool.name,
    riskLevel: tool.riskLevel,
    approvalMode: tool.approvalMode,
    description: tool.description,
    autonomyHint: tool.autonomyHint ?? "",
  }));
}

function buildAgentPrompt(input: {
  brandId: string;
  message: string;
  mode: OperatorChatRequest["mode"];
  recentMessages: BrandAgentRecentMessage[];
  compactContext: Record<string, unknown>;
  memory: Record<string, unknown> | null;
  tools: OperatorToolSpec[];
  trace: BrandAgentTraceEntry[];
  stepNumber: number;
  maxSteps: number;
}) {
  const finalStep = input.stepNumber >= input.maxSteps;
  const promptParts = [
    "You are Brand GPT, an autonomous LastB2B growth operator running inside a Codex-style harness.",
    "You are the reasoning engine. The host app only gives you scoped tools, permissions, tenant isolation, budgets, and audit logging.",
    "Do not behave like a scripted support chatbot. You own the workflow: form a goal, inspect evidence, choose the most useful tool, observe results, recover from failures, and continue until the objective is advanced or a real blocker is proven.",
    "Respond with JSON only.",
    'Return: {"message": string, "done": boolean, "goal": string, "hypothesis": string, "objectType": string, "toolName": string, "toolInputJson": string, "rationale": string, "stopReason": string, "missingCapability": string, "evidenceNeeded": string[], "avoidedWrongPaths": string[], "evidenceStatus": "verified"|"inconclusive"|"insufficient", "evidenceSummary": string, "evidenceGaps": string[]}.',
    'Use toolName "" and toolInputJson "{}" when you are not calling a tool.',
    "Call at most one tool per step.",
    "Classify the object only to orient yourself. Use stable objectType values such as sender_delivery, sender, inbox, reply_thread, campaign, experiment, lead, brand, transport, provider, leadr, gmail_ui, capability_gap, or unknown.",
    "The tool catalog is your action space. Choose tools by their descriptions and autonomy hints, not by a fixed path. If a better tool exists, use it even if it was not named in the prompt.",
    "Before selecting a tool, check whether the tool's object matches the goal. If it does not, choose a broader read tool or a better object-specific tool instead.",
    "Read tools are your senses. Use them freely when the compact context is insufficient, stale, ambiguous, or lacks raw evidence. Prefer broad investigation over guessing.",
    "If the user asks for actual content, causes, live account state, replies, drafts, campaign copy, deliverability evidence, leads, runs, or what changed, inspect with tools before answering from memory.",
    "If you are unsure which read tool fits, call investigate_brand_data with brandId, query, and any known IDs. If the question is about real outbound not moving, inspect the full blocker chain rather than one local status.",
    "Write tools are your hands. If a write/send/launch/delete/provision/buy action is the right next move, choose the matching write tool and stop; the host will execute or request confirmation according to risk.",
    "After a tool failure, do not simply summarize the failure. Either try a materially different available tool, inspect the cause with a read tool, or prove that the remaining blocker is missing credentials, missing permissions, budget/risk approval, or a missing platform capability.",
    "When no existing tool can move the objective, call record_capability_gap with the missing capability and the tool contract the platform should add. This is better than asking the user to manually push a workflow forward.",
    "Do not invent IDs, email bodies, replies, leads, sender state, domains, accounts, or metrics.",
    "Do not expose credentials or internal API secrets.",
    "Before every final answer, run an evidence self-check in the JSON fields. evidenceStatus=verified only when the observations directly prove the claim. Use inconclusive when evidence partially supports the answer but a key exact proof is missing. Use insufficient when you have not inspected enough live evidence.",
    "For Gmail/send questions: broad Gmail searches such as in:sent prove only that matching mailbox rows exist. They do not prove a specific message was sent to a specific recipient. A specific sent-email claim needs gmail_ui_verify_sent with the exact recipient plus subject and/or body. If that exact verification is not present, say what broad search showed and mark the specific claim inconclusive.",
    "Use the active brand as the default scope.",
    "For tool inputs, include brandId when the tool is brand-scoped. Use IDs from context or previous tool results when available.",
    "For broad investigations, useful inputs are brandId, query, threadId, runId, leadId, campaignId, experimentId, maxThreads, maxMessages, and maxRuns.",
    "If mode is recommendation_only, do not choose safe_write or guarded_write tools.",
    "Final answer voice and formatting:",
    "- Write like a sharp human operator explaining the account to a founder.",
    "- Start with the bottom line in plain English. The first sentence should answer the user's question directly.",
    "- Prefer short paragraphs and bullets over dense status dumps.",
    "- Use simple Markdown only: **bold labels**, bullets, and `inline code` for exact emails/domains/IDs when needed. Do not use tables or # headings.",
    "- Use labels like **Bottom line:**, **Why:**, and **Next:** when they make the answer easier to scan.",
    "- Translate internal statuses into what they mean. Avoid raw operational jargon unless it is necessary, and explain it briefly when used.",
    "- Do not lead with model names, run IDs, tool names, route scores, or database counts unless the user specifically asks for them.",
    "- Keep routine status answers short. Aim for 3-6 bullets or 2-4 short paragraphs unless the user asks for a detailed report.",
    "- Put tool/evidence detail in the evidence fields, not in the main message, unless the evidence is the answer.",
    finalStep
      ? "This is the final planning step. If you do not already have enough evidence for another safe read, answer with the best supported statement and no tool call."
      : "If another read is useful, call it now instead of guessing.",
    `Mode: ${input.mode === "recommendation_only" ? "recommendation_only" : "default"}`,
    `Active brandId: ${input.brandId || "(none)"}`,
    `Planning step: ${input.stepNumber} of ${input.maxSteps}`,
    `Tool catalog JSON: ${JSON.stringify(buildToolCatalog(input.tools))}`,
    `Recent conversation JSON: ${JSON.stringify(compactForPrompt(input.recentMessages, 6000))}`,
    `Compact brand context JSON: ${JSON.stringify(compactForPrompt(input.compactContext, 12000))}`,
    `Brand memory JSON: ${JSON.stringify(compactForPrompt(input.memory, 5000))}`,
    `Tool observations so far JSON: ${JSON.stringify(
      input.trace.map((entry) => ({
        ...entry,
        result: compactForPrompt(entry.result, 7000),
      }))
    )}`,
    `Latest user message: ${input.message}`,
  ];
  return promptParts.join("\n\n");
}

export async function runBrandAgentTurn(input: {
  brandId: string;
  message: string;
  mode: OperatorChatRequest["mode"];
  recentMessages: BrandAgentRecentMessage[];
  compactContext: Record<string, unknown>;
  memory: Record<string, unknown> | null;
  fallbackAssistant: OperatorChatAssistantReply;
  tools: OperatorToolSpec[];
  maxSteps: number;
  reasoningEffort: string;
  openAiOverrideModel?: string;
  openRouterOverrideModel?: string;
  normalizeToolCall: (call: OperatorRequestedAction) => OperatorRequestedAction | null;
}): Promise<BrandAgentTurnResult | null> {
  const trace: BrandAgentTraceEntry[] = [];
  const toolByName = new Map(input.tools.map((tool) => [tool.name, tool]));
  let assistant = input.fallbackAssistant;
  let model = "brand-agent";

  try {
    for (let stepNumber = 1; stepNumber <= input.maxSteps; stepNumber += 1) {
      const result = await generateJsonWithLlm({
        task: "operator_chat",
        prompt: buildAgentPrompt({
          brandId: input.brandId,
          message: input.message,
          mode: input.mode,
          recentMessages: input.recentMessages,
          compactContext: input.compactContext,
          memory: input.memory,
          tools: input.tools,
          trace,
          stepNumber,
          maxSteps: input.maxSteps,
        }),
        reasoningEffort: input.reasoningEffort,
        openAiOverrideModel: input.openAiOverrideModel,
        openRouterOverrideModel: input.openRouterOverrideModel,
        maxOutputTokens: 1600,
        format: {
          type: "json_schema",
          name: "brand_agent_step",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              message: { type: "string" },
              done: { type: "boolean" },
              goal: { type: "string" },
              hypothesis: { type: "string" },
              objectType: { type: "string" },
              toolName: { type: "string" },
              toolInputJson: { type: "string" },
              rationale: { type: "string" },
              stopReason: { type: "string" },
              missingCapability: { type: "string" },
              evidenceNeeded: { type: "array", items: { type: "string" } },
              avoidedWrongPaths: { type: "array", items: { type: "string" } },
              evidenceStatus: { type: "string", enum: ["verified", "inconclusive", "insufficient"] },
              evidenceSummary: { type: "string" },
              evidenceGaps: { type: "array", items: { type: "string" } },
            },
            required: [
              "message",
              "done",
              "goal",
              "hypothesis",
              "objectType",
              "toolName",
              "toolInputJson",
              "rationale",
              "stopReason",
              "missingCapability",
              "evidenceNeeded",
              "avoidedWrongPaths",
              "evidenceStatus",
              "evidenceSummary",
              "evidenceGaps",
            ],
          },
        },
      });
      model = `${result.provider}:${result.model}`;
      const step = parseAgentStep(result.text);
      if (!step) return null;

      assistant = normalizeAssistantReply(step, input.fallbackAssistant);
      let rawToolName = step.toolName as OperatorToolName;
      let rawToolInput = parseToolInput(step.toolInputJson);
      const traceMeta = {
        objectType: step.objectType || "unknown",
        goal: step.goal,
        hypothesis: step.hypothesis,
        stopReason: step.stopReason,
        missingCapability: step.missingCapability,
        evidenceNeeded: step.evidenceNeeded,
        avoidedWrongPaths: step.avoidedWrongPaths,
      };
      if (!rawToolName && step.missingCapability && input.mode !== "recommendation_only") {
        rawToolName = "record_capability_gap";
        rawToolInput = {
          brandId: input.brandId,
          capability: step.missingCapability,
          whyNeeded: step.rationale || step.message || step.goal,
          blocker: step.stopReason,
          attemptedTools: trace.map((entry) => entry.toolName).filter(Boolean),
          suggestedToolContract: step.hypothesis,
        };
      }
      if (!rawToolName) {
        if (
          step.done &&
          step.evidenceStatus !== "verified" &&
          trace.length === 0 &&
          input.brandId &&
          stepNumber < input.maxSteps
        ) {
          trace.push({
            step: stepNumber,
            ...traceMeta,
            toolName: "agent_answer_without_evidence",
            riskLevel: "unknown",
            input: {},
            summary: "",
            result: {},
            error:
              "The agent tried to finish without live evidence. Continuing so it must inspect state or explicitly record a blocker.",
            rationale: step.rationale || step.goal || step.hypothesis,
          });
          continue;
        }
        if (!step.done && stepNumber < input.maxSteps) {
          trace.push({
            step: stepNumber,
            ...traceMeta,
            toolName: "agent_no_tool_selected",
            riskLevel: "unknown",
            input: {},
            summary: "",
            result: {},
            error:
              "The agent said the objective is not done but did not select a tool. Continuing so it must either use a tool or prove a real blocker.",
            rationale: step.rationale || step.goal || step.hypothesis,
          });
          continue;
        }
        return {
          assistant,
          requestedAction: null,
          model,
          trace,
          evidenceCheck: normalizeEvidenceCheck(step, trace),
        };
      }

      const tool = toolByName.get(rawToolName);
      if (!tool) {
        trace.push({
          step: stepNumber,
          ...traceMeta,
          toolName: step.toolName,
          riskLevel: "unknown",
          input: rawToolInput,
          summary: "",
          result: {},
          error: "The requested tool is not registered in this brand agent session.",
          rationale: step.rationale,
        });
        continue;
      }

      if (input.mode === "recommendation_only" && tool.riskLevel !== "read") {
        trace.push({
          step: stepNumber,
          ...traceMeta,
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          input: rawToolInput,
          summary: "",
          result: {},
          error: "The session is recommendation_only, so write tools are disabled.",
          rationale: step.rationale,
        });
        continue;
      }

      const normalizedAction = input.normalizeToolCall({
        toolName: tool.name,
        input: rawToolInput,
      });
      if (!normalizedAction) {
        trace.push({
          step: stepNumber,
          ...traceMeta,
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          input: rawToolInput,
          summary: "",
          result: {},
          error: "The tool call could not be resolved against the current brand context.",
          rationale: step.rationale,
        });
        continue;
      }

      if (tool.riskLevel !== "read") {
        return {
          assistant,
          requestedAction: normalizedAction,
          model,
          trace,
          evidenceCheck: normalizeEvidenceCheck(step, trace),
        };
      }

      try {
        const toolResult: OperatorToolResult = await tool.run(normalizedAction.input);
        trace.push({
          step: stepNumber,
          ...traceMeta,
          toolName: normalizedAction.toolName,
          riskLevel: tool.riskLevel,
          input: normalizedAction.input,
          summary: toolResult.summary,
          result: asRecord(toolResult.result),
          error: "",
          rationale: step.rationale,
        });
      } catch (error) {
        trace.push({
          step: stepNumber,
          ...traceMeta,
          toolName: normalizedAction.toolName,
          riskLevel: tool.riskLevel,
          input: normalizedAction.input,
          summary: "",
          result: {},
          error: error instanceof Error ? error.message : "Brand agent tool call failed",
          rationale: step.rationale,
        });
      }
    }

    return {
      assistant:
        trace.length > 0
          ? {
              summary:
                assistant.summary ||
                trace[trace.length - 1]?.error ||
                trace[trace.length - 1]?.summary ||
                input.fallbackAssistant.summary,
              findings: [],
              recommendations: [],
            }
          : input.fallbackAssistant,
      requestedAction: null,
      model,
      trace,
      evidenceCheck: {
        status: trace.some((entry) => entry.error) ? "inconclusive" : "insufficient",
        summary:
          trace.length > 0
            ? "The agent reached the step limit after gathering evidence. Treat the answer as bounded by the visible observations."
            : "The agent reached the step limit without gathering live evidence.",
        gaps: trace.some((entry) => entry.error)
          ? ["One or more tool calls failed before the final answer."]
          : [],
      },
    };
  } catch (error) {
    console.error("Brand agent turn failed", error);
    return null;
  }
}
