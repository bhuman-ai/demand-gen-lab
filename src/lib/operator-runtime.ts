import {
  createOperatorAction,
  createOperatorApproval,
  createOperatorMessage,
  createOperatorRun,
  createOperatorThread,
  getOperatorAction,
  getOperatorRun,
  getOperatorThread,
  listOperatorActionsByThread,
  listOperatorMessages,
  updateOperatorAction,
  updateOperatorRun,
  updateOperatorThread,
} from "@/lib/operator-data";
import { getOperatorBrandContext } from "@/lib/operator-context";
import { getOperatorToolSpec, listOperatorToolSpecs } from "@/lib/operator-tools";
import type {
  OperatorAction,
  OperatorActionSummary,
  OperatorChatAssistantReply,
  OperatorChatRequest,
  OperatorChatResponse,
  OperatorMessage,
  OperatorRequestedAction,
  OperatorThreadDetail,
  OperatorToolName,
  OperatorToolSpec,
} from "@/lib/operator-types";

const DEFAULT_OPERATOR_MODEL = String(process.env.OPENAI_MODEL_OPERATOR ?? "").trim() || "gpt-5.4";
const DEFAULT_OPERATOR_REASONING = (() => {
  const value = String(process.env.OPENAI_OPERATOR_REASONING_EFFORT ?? "").trim().toLowerCase();
  return ["minimal", "low", "medium", "high", "xhigh"].includes(value) ? value : "low";
})();

type OperatorPlannerResult = {
  assistant: OperatorChatAssistantReply;
  requestedAction: OperatorRequestedAction | null;
  model: string;
};

function nowIso() {
  return new Date().toISOString();
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isCasualGreeting(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return /^(hi|hey|hello|yo|sup|what'?s up|hiya|howdy)[!.?]*$/.test(normalized);
}

function isExplicitActionRequest(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized || isCasualGreeting(normalized)) return false;
  if (
    /\b(can you|could you|please|go ahead and|i want you to|take care of|handle|do this)\b/.test(normalized)
  ) {
    return true;
  }
  return /^(add|create|buy|register|provision|refresh|sync|check|run|pause|resume|summarize|show|inspect|diagnose|draft|send|use)\b/.test(
    normalized
  );
}

function buildGreetingAssistant(brandName?: string): OperatorChatAssistantReply {
  return {
    summary: brandName
      ? `Hi. I'm Operator for ${brandName}. Tell me what you want to do, or ask me anything about the account.`
      : "Hi. I'm Operator. Tell me what you want to do, or ask me anything about the account.",
    findings: [],
    recommendations: [],
  };
}

function looksLikeStatusSummary(summary: string) {
  return /\bhas \d+\b|\bconfigured senders\b|\bcampaigns\b|\binbox thread\b|\brouting\b/i.test(summary);
}

function buildDefaultAssistantReply(input: {
  brandName?: string;
  issues: string[];
  nextActions: string[];
  sendersTotal?: number;
  readySenders?: number;
  campaignsTotal?: number;
  inboxThreads?: number;
}): OperatorChatAssistantReply {
  const brandLabel = input.brandName || "this brand";
  const primaryIssue = input.issues[0] ?? "";
  const primaryNextAction = input.nextActions[0] ?? "";
  let summary = `${brandLabel} is loaded and I'm ready to help.`;
  if (primaryIssue && primaryNextAction) {
    summary = `${primaryIssue} The next move is to ${primaryNextAction.charAt(0).toLowerCase()}${primaryNextAction.slice(1)}`;
  } else if (primaryIssue) {
    summary = primaryIssue;
  } else if (primaryNextAction) {
    summary = `Things look stable right now. The next move is to ${primaryNextAction.charAt(0).toLowerCase()}${primaryNextAction.slice(1)}`;
  }
  return {
    summary,
    findings: [],
    recommendations: [],
  };
}

function buildToolPreview(tool: OperatorToolSpec, input: Record<string, unknown>) {
  return tool.buildPreview?.(input) ?? {
    title: tool.previewTitle,
    summary: tool.description,
  };
}

function titleFromMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return "Operator";
  return trimmed.length > 64 ? `${trimmed.slice(0, 61)}...` : trimmed;
}

function extractEmailParts(message: string) {
  const match = message
    .toLowerCase()
    .match(/\b([a-z0-9._%+-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/);
  if (!match) return null;
  return {
    fromLocalPart: match[1] ?? "",
    domain: match[2] ?? "",
  };
}

function extractDomain(message: string) {
  const match = message
    .toLowerCase()
    .match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/);
  return match?.[1] ?? "";
}

function extractQuotedText(message: string) {
  const match = message.match(/["“”'`](.+?)["“”'`]/);
  return match?.[1]?.trim() ?? "";
}

function normalizeMatchText(value: string) {
  return value.toLowerCase().replace(/[`"'“”’]/g, "").replace(/\s+/g, " ").trim();
}

function findNamedItem<T extends { id: string; name?: string; subject?: string; status?: string }>(
  items: T[],
  input: {
    explicitId?: string;
    explicitName?: string;
    message: string;
    statusHints?: string[];
  }
) {
  if (input.explicitId) {
    return items.find((item) => item.id === input.explicitId) ?? null;
  }

  const messageText = normalizeMatchText(input.message);
  const explicitName = normalizeMatchText(input.explicitName ?? "");
  const candidates = items.filter((item) => {
    if (!input.statusHints?.length) return true;
    return input.statusHints.some((status) => normalizeMatchText(item.status ?? "") === normalizeMatchText(status));
  });

  if (explicitName) {
    const exact = candidates.find((item) => {
      const label = normalizeMatchText(String(item.name ?? item.subject ?? ""));
      return label === explicitName;
    });
    if (exact) return exact;
  }

  const matched =
    candidates.find((item) => {
      const label = normalizeMatchText(String(item.name ?? item.subject ?? ""));
      return label.length > 0 && messageText.includes(label);
    }) ?? null;
  if (matched) return matched;

  if (candidates.length === 1) {
    return candidates[0] ?? null;
  }

  return null;
}

function summarizeActionPreview(action: OperatorAction): OperatorChatAssistantReply {
  const previewSummary = asString(action.preview.summary) || "Operator prepared an action preview.";
  return {
    summary: `I can do that. ${previewSummary} Confirm it when you're ready.`,
    findings: [],
    recommendations: [],
  };
}

function extractResponseText(payload: unknown) {
  const row = asRecord(payload);
  const output = Array.isArray(row.output) ? row.output : [];
  const outputTextFromItems = output
    .map((item) => asRecord(item))
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((entry) => asRecord(entry))
    .find((entry) => typeof entry.text === "string");
  return (
    asString(row.output_text) ||
    asString(outputTextFromItems?.text)
  );
}

function summarizePromptMessages(messages: OperatorMessage[]) {
  return messages.slice(-12).map((message) => ({
    role: message.role,
    kind: message.kind,
    text: asString(message.content.text) || JSON.stringify(message.content).slice(0, 400),
  }));
}

function summarizePromptContext(
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>,
  options: { includeCampaigns?: boolean } = {}
) {
  if (!context) return { brand: null };
  return {
    brand: context.brand,
    assignment: context.assignment,
    provisioning: context.provisioning,
    senders: {
      total: context.senders.total,
      ready: context.senders.ready,
      pending: context.senders.pending,
      blocked: context.senders.blocked,
      snapshots: context.senders.snapshots.map((snapshot) => ({
        accountId: snapshot.accountId,
        accountName: snapshot.accountName,
        provider: snapshot.provider,
        status: snapshot.status,
        fromEmail: snapshot.fromEmail,
        replyToEmail: snapshot.replyToEmail,
        domain: snapshot.domain,
        automationStatus: snapshot.automationStatus,
        automationSummary: snapshot.automationSummary,
        routeScore: snapshot.routeScore,
        routeLabel: snapshot.routeLabel,
        mailpoolStatus: snapshot.mailpoolStatus,
        dnsStatus: snapshot.dnsStatus,
      })),
    },
    routing: context.routing,
    campaigns: options.includeCampaigns
      ? {
          ...context.campaigns,
          items: context.campaigns.items.slice(0, 10),
        }
      : undefined,
    experiments: {
      ...context.experiments,
      items: context.experiments.items.slice(0, 10),
    },
    leads: {
      ...context.leads,
      items: context.leads.items.slice(0, 20),
    },
    inbox: {
      threads: context.inbox.threads,
      newThreads: context.inbox.newThreads,
      openThreads: context.inbox.openThreads,
      closedThreads: context.inbox.closedThreads,
      threadItems: context.inbox.threadItems.slice(0, 10),
      draftItems: context.inbox.draftItems.slice(0, 10),
    },
    issues: context.issues,
    nextActions: context.nextActions,
  };
}

function normalizeAssistantReply(
  value: unknown,
  fallback: OperatorChatAssistantReply,
  options: { plainGreeting?: boolean } = {}
): OperatorChatAssistantReply {
  const row = asRecord(value);
  const rawSummary = asString(row.message) || asString(row.summary) || fallback.summary;
  const summary =
    options.plainGreeting && looksLikeStatusSummary(rawSummary) ? fallback.summary : rawSummary;
  return {
    summary,
    findings: [],
    recommendations: [],
  };
}

function resolveSenderAccountId(
  rawInput: Record<string, unknown>,
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>
) {
  const explicit = asString(rawInput.accountId);
  if (explicit) return explicit;

  const fromEmail = asString(rawInput.fromEmail).toLowerCase();
  if (fromEmail) {
    const matched = context?.senders.snapshots.find((snapshot) => snapshot.fromEmail === fromEmail);
    if (matched?.accountId) return matched.accountId;
  }

  const fromLocalPart = asString(rawInput.fromLocalPart).toLowerCase();
  const domain = asString(rawInput.domain).toLowerCase();
  if (fromLocalPart && domain) {
    const matched = context?.senders.snapshots.find((snapshot) => snapshot.fromEmail === `${fromLocalPart}@${domain}`);
    if (matched?.accountId) return matched.accountId;
  }

  const pendingMailpool =
    context?.senders.snapshots.find((snapshot) => snapshot.provider === "mailpool" && snapshot.mailpoolStatus === "pending") ??
    null;
  if (pendingMailpool?.accountId) return pendingMailpool.accountId;

  if (context?.senders.snapshots.length === 1) {
    return context.senders.snapshots[0]?.accountId ?? "";
  }

  return "";
}

const TOOLS_WITH_BRAND_CONTEXT = new Set<OperatorToolName>([
  "get_brand_snapshot",
  "summarize_campaign_status",
  "get_campaign_snapshot",
  "summarize_experiments",
  "get_experiment_snapshot",
  "summarize_leads",
  "summarize_inbox",
  "provision_mailpool_sender",
  "update_brand",
  "delete_brand",
  "add_brand_lead",
  "update_brand_lead",
  "create_experiment",
  "update_experiment",
  "delete_experiment",
  "launch_experiment_run",
  "control_experiment_run",
  "promote_experiment_to_campaign",
  "update_campaign",
  "delete_campaign",
  "launch_campaign_run",
  "control_campaign_run",
  "send_reply_draft",
  "dismiss_reply_draft",
]);

function resolveExperimentId(
  rawInput: Record<string, unknown>,
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>,
  message: string
) {
  const matched = findNamedItem(context?.experiments.items ?? [], {
    explicitId: asString(rawInput.experimentId),
    explicitName:
      asString(rawInput.experimentName) ||
      (asString(rawInput.name) && !asString(rawInput.brandId) ? asString(rawInput.name) : "") ||
      extractQuotedText(message),
    message,
    statusHints:
      /\brunning\b/.test(message.toLowerCase())
        ? ["Running", "Sourcing"]
        : /\bdraft\b/.test(message.toLowerCase())
          ? ["Draft"]
          : /\bcompleted\b/.test(message.toLowerCase())
            ? ["Completed"]
            : undefined,
  });
  return matched?.id ?? "";
}

function resolveCampaignId(
  rawInput: Record<string, unknown>,
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>,
  message: string
) {
  const matched = findNamedItem(context?.campaigns.items ?? [], {
    explicitId: asString(rawInput.campaignId),
    explicitName: asString(rawInput.campaignName) || extractQuotedText(message),
    message,
    statusHints:
      /\bactive\b/.test(message.toLowerCase())
        ? ["active"]
        : /\bdraft\b/.test(message.toLowerCase())
          ? ["draft"]
          : /\bpaused\b/.test(message.toLowerCase())
            ? ["paused"]
            : undefined,
  });
  return matched?.id ?? "";
}

function resolveLeadId(
  rawInput: Record<string, unknown>,
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>,
  message: string
) {
  const matched = findNamedItem(context?.leads.items ?? [], {
    explicitId: asString(rawInput.leadId),
    explicitName: asString(rawInput.leadName) || asString(rawInput.name) || extractQuotedText(message),
    message,
    statusHints:
      /\bqualified\b/.test(message.toLowerCase())
        ? ["qualified"]
        : /\bcontacted\b/.test(message.toLowerCase())
          ? ["contacted"]
          : /\bclosed\b/.test(message.toLowerCase())
            ? ["closed"]
            : /\bnew\b/.test(message.toLowerCase())
              ? ["new"]
              : undefined,
  });
  return matched?.id ?? "";
}

function resolveDraftId(
  rawInput: Record<string, unknown>,
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>,
  message: string
) {
  const matched = findNamedItem(
    (context?.inbox.draftItems ?? []).map((draft) => ({
      ...draft,
      name: draft.subject,
    })),
    {
      explicitId: asString(rawInput.draftId),
      explicitName: asString(rawInput.draftSubject) || extractQuotedText(message),
      message,
      statusHints: /\bdraft\b/.test(message.toLowerCase()) ? ["draft"] : undefined,
    }
  );
  return matched?.id ?? "";
}

function normalizeRequestedAction(input: {
  raw: unknown;
  brandId: string;
  mode: OperatorChatRequest["mode"];
  message: string;
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>;
}): OperatorRequestedAction | null {
  if (input.mode === "recommendation_only") return null;
  const row = asRecord(input.raw);
  const toolName = asString(row.toolName) as OperatorToolName;
  if (!toolName || !listOperatorToolSpecs().some((tool) => tool.name === toolName)) {
    return null;
  }

  const toolInput = { ...asRecord(row.input) };
  if (input.brandId && TOOLS_WITH_BRAND_CONTEXT.has(toolName) && !asString(toolInput.brandId)) {
    toolInput.brandId = input.brandId;
  }

  if (toolName === "provision_mailpool_sender") {
    toolInput.provider = "mailpool";
    if (!asString(toolInput.domainMode)) {
      const message = input.message.toLowerCase();
      toolInput.domainMode =
        message.includes("buy") || message.includes("register") || message.includes("new domain")
          ? "register"
          : "existing";
    }
  }

  if (toolName === "refresh_mailpool_sender" || toolName === "get_sender_snapshot") {
    const accountId = resolveSenderAccountId(toolInput, input.context);
    if (!accountId) return null;
    toolInput.accountId = accountId;
  }

  if (
    [
      "get_experiment_snapshot",
      "update_experiment",
      "delete_experiment",
      "launch_experiment_run",
      "control_experiment_run",
      "promote_experiment_to_campaign",
    ].includes(toolName)
  ) {
    const experimentId = resolveExperimentId(toolInput, input.context, input.message);
    if (!experimentId) return null;
    toolInput.experimentId = experimentId;
    if (!asString(toolInput.experimentName)) {
      toolInput.experimentName =
        input.context?.experiments.items.find((item) => item.id === experimentId)?.name ?? "";
    }
  }

  if (
    ["get_campaign_snapshot", "update_campaign", "delete_campaign", "launch_campaign_run", "control_campaign_run"].includes(
      toolName
    )
  ) {
    const campaignId = resolveCampaignId(toolInput, input.context, input.message);
    if (!campaignId) return null;
    toolInput.campaignId = campaignId;
    if (!asString(toolInput.campaignName)) {
      toolInput.campaignName =
        input.context?.campaigns.items.find((item) => item.id === campaignId)?.name ?? "";
    }
  }

  if (toolName === "update_brand_lead") {
    const leadId = resolveLeadId(toolInput, input.context, input.message);
    if (!leadId) return null;
    toolInput.leadId = leadId;
    if (!asString(toolInput.leadName)) {
      toolInput.leadName =
        input.context?.leads.items.find((item) => item.id === leadId)?.name ?? "";
    }
  }

  if (toolName === "send_reply_draft" || toolName === "dismiss_reply_draft") {
    const draftId = resolveDraftId(toolInput, input.context, input.message);
    if (!draftId) return null;
    toolInput.draftId = draftId;
    if (!asString(toolInput.draftSubject)) {
      toolInput.draftSubject =
        input.context?.inbox.draftItems.find((item) => item.id === draftId)?.subject ?? "";
    }
  }

  if (toolName === "control_campaign_run" && asString(toolInput.action).toLowerCase() === "resume_sender_deliverability") {
    toolInput.senderAccountId =
      asString(toolInput.senderAccountId) || input.context?.routing.preferredSenderAccountId || "";
  }

  if (toolName === "delete_brand" && !asString(toolInput.brandName)) {
    toolInput.brandName = input.context?.brand.name ?? "";
  }

  return {
    toolName,
    input: toolInput,
  };
}

function filterRequestedActionForMessage(
  requestedAction: OperatorRequestedAction | null,
  message: string
) {
  if (!requestedAction) return null;
  const tool = getOperatorToolSpec(requestedAction.toolName);
  if (!tool) return null;
  if (tool.riskLevel === "read") return requestedAction;
  return isExplicitActionRequest(message) ? requestedAction : null;
}

function buildOperatorPrompt(input: {
  message: string;
  mode: OperatorChatRequest["mode"];
  messages: OperatorMessage[];
  brandId: string;
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>;
}) {
  const includeCampaigns = /\bcampaigns?\b/i.test(input.message);
  const toolCatalog = listOperatorToolSpecs().map((tool) => ({
    name: tool.name,
    riskLevel: tool.riskLevel,
    approvalMode: tool.approvalMode,
    description: tool.description,
  }));

  return [
    "You are Operator, the LastB2B account assistant.",
    "Respond with JSON only.",
    'The JSON object must contain: message (string) and requestedAction (null or { toolName: string, input: object }).',
    "Ground every statement in the supplied account context and recent thread messages.",
    "Talk like a sharp human teammate, not a dashboard, support bot, or structured report.",
    "Reply in plain conversational language.",
    "Do not use headings, bullets, or sections like 'What I found' or 'What I recommend'.",
    "Only mention operational status when it is relevant to the user's message.",
    "When experiment data is present, prefer talking about experiments instead of campaigns unless the user specifically asks about campaigns.",
    "If the context shows a usable preferred sender but it is still in testing or warming, explain that distinction instead of saying no sender is ready.",
    "Do not merge experiments and campaigns into one count or one status line.",
    "If experiments.running or experiments.sourcing is greater than 0, explicitly acknowledge that there is live experiment work.",
    "Do not say everything is draft unless the context actually shows no running, sourcing, ready, completed, paused, or promoted experiments.",
    "Do not contradict the numeric counts or statuses in the supplied context.",
    "Only propose requestedAction when the user explicitly asks you to do something, or explicitly asks you to inspect or summarize something.",
    "Do not trigger safe_write or guarded_write actions just because they might be helpful.",
    "If mode is recommendation_only, requestedAction must be null.",
    "If the latest user message is only a casual greeting like hi, hey, or hello, reply like a normal human assistant in 1 or 2 short sentences.",
    "For a casual greeting, do not dump account status and do not propose an action.",
    "Only use requestedAction.toolName values from the provided tool catalog.",
    "Never invent IDs, emails, or domains that are not in the provided context or the latest user message.",
    "If the user asks to create, update, launch, pause, resume, cancel, send, dismiss, or delete something and there is a matching tool, use it.",
    "When matching experiments, campaigns, leads, or reply drafts, prefer the IDs and names in the provided context items.",
    "If there is exactly one obvious running, draft, active, or pending object that matches the user's words, it is okay to target it.",
    "For refresh_mailpool_sender and get_sender_snapshot, prefer using accountId from the context.",
    "For provision_mailpool_sender, include any known fields such as brandId, domain, fromLocalPart, domainMode, and registrant fields.",
    `Mode: ${input.mode === "recommendation_only" ? "recommendation_only" : "default"}`,
    `Resolved brandId: ${input.brandId || "(none)"}`,
    `Tool catalog JSON: ${JSON.stringify(toolCatalog)}`,
    `Recent thread messages JSON: ${JSON.stringify(summarizePromptMessages(input.messages))}`,
    `Current brand context JSON: ${JSON.stringify(summarizePromptContext(input.context, { includeCampaigns }))}`,
    `Latest user message: ${input.message}`,
  ].join("\n\n");
}

async function planOperatorReplyWithLlm(input: {
  brandId: string;
  message: string;
  mode: OperatorChatRequest["mode"];
  messages: OperatorMessage[];
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>;
  fallbackAssistant: OperatorChatAssistantReply;
}): Promise<OperatorPlannerResult | null> {
  const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;

  const model = DEFAULT_OPERATOR_MODEL;
  const prompt = buildOperatorPrompt(input);
  const greetingOnly = isCasualGreeting(input.message);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        reasoning: { effort: DEFAULT_OPERATOR_REASONING },
        text: { format: { type: "json_object" } },
        max_output_tokens: 900,
        store: false,
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      console.error("Operator OpenAI request failed", raw.slice(0, 800));
      return null;
    }

    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }

    const outputText = extractResponseText(payload);
    if (!outputText) return null;

    let parsed: unknown = {};
    try {
      parsed = JSON.parse(outputText);
    } catch {
      console.error("Operator OpenAI JSON parse failed", outputText.slice(0, 800));
      return null;
    }

    const row = asRecord(parsed);
    return {
      assistant: normalizeAssistantReply(row, input.fallbackAssistant, { plainGreeting: greetingOnly }),
      requestedAction: normalizeRequestedAction({
        raw: row.requestedAction,
        brandId: input.brandId,
        mode: input.mode,
        message: input.message,
        context: input.context,
      }),
      model,
    };
  } catch (error) {
    console.error("Operator OpenAI planning threw", error);
    return null;
  }
}

function inferActionFromMessage(
  input: OperatorChatRequest,
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>
): OperatorRequestedAction | null {
  if (input.structuredAction) return input.structuredAction;
  const message = input.message.trim().toLowerCase();
  if (!message) return null;
  const quoted = extractQuotedText(input.message);
  const experimentId = resolveExperimentId({}, context, input.message);
  const campaignId = resolveCampaignId({}, context, input.message);
  const draftId = resolveDraftId({}, context, input.message);
  const leadId = resolveLeadId({}, context, input.message);

  if (context?.brand.id && message.includes("inbox")) {
    return {
      toolName: "summarize_inbox",
      input: { brandId: context.brand.id },
    };
  }

  if (context?.brand.id && /\bleads?\b/.test(message)) {
    if ((message.includes("add") || message.includes("create")) && quoted) {
      return {
        toolName: "add_brand_lead",
        input: { brandId: context.brand.id, name: quoted },
      };
    }
    if ((message.includes("update") || message.includes("mark")) && leadId) {
      return {
        toolName: "update_brand_lead",
        input: {
          brandId: context.brand.id,
          leadId,
          status: message.includes("qualified")
            ? "qualified"
            : message.includes("contacted")
              ? "contacted"
              : message.includes("closed")
                ? "closed"
                : message.includes("new")
                  ? "new"
                  : "",
        },
      };
    }
    return {
      toolName: "summarize_leads",
      input: { brandId: context.brand.id },
    };
  }

  if (context?.brand.id && /\bdrafts?\b/.test(message) && message.includes("send") && draftId) {
    return {
      toolName: "send_reply_draft",
      input: { brandId: context.brand.id, draftId },
    };
  }

  if (context?.brand.id && /\bdrafts?\b/.test(message) && (message.includes("dismiss") || message.includes("skip")) && draftId) {
    return {
      toolName: "dismiss_reply_draft",
      input: { brandId: context.brand.id, draftId },
    };
  }

  if (context?.brand.id && /\bcampaigns?\b/.test(message)) {
    if ((message.includes("launch") || message.includes("start")) && campaignId) {
      return {
        toolName: "launch_campaign_run",
        input: { brandId: context.brand.id, campaignId },
      };
    }
    if ((message.includes("pause") || message.includes("resume") || message.includes("cancel")) && campaignId) {
      return {
        toolName: "control_campaign_run",
        input: {
          brandId: context.brand.id,
          campaignId,
          action: message.includes("pause") ? "pause" : message.includes("resume") ? "resume" : "cancel",
        },
      };
    }
    if (message.includes("probe") && campaignId) {
      return {
        toolName: "control_campaign_run",
        input: { brandId: context.brand.id, campaignId, action: "probe_deliverability" },
      };
    }
    if ((message.includes("delete") || message.includes("remove")) && campaignId) {
      return {
        toolName: "delete_campaign",
        input: { brandId: context.brand.id, campaignId },
      };
    }
    if (campaignId) {
      return {
        toolName: "get_campaign_snapshot",
        input: { brandId: context.brand.id, campaignId },
      };
    }
    return {
      toolName: "summarize_campaign_status",
      input: { brandId: context.brand.id },
    };
  }

  if (context?.brand.id && /\bexperiments?\b/.test(message)) {
    if ((message.includes("create") || message.includes("add")) && quoted) {
      return {
        toolName: "create_experiment",
        input: { brandId: context.brand.id, name: quoted },
      };
    }
    if ((message.includes("launch") || message.includes("start")) && experimentId) {
      return {
        toolName: "launch_experiment_run",
        input: { brandId: context.brand.id, experimentId },
      };
    }
    if ((message.includes("pause") || message.includes("resume") || message.includes("cancel")) && experimentId) {
      return {
        toolName: "control_experiment_run",
        input: {
          brandId: context.brand.id,
          experimentId,
          action: message.includes("pause") ? "pause" : message.includes("resume") ? "resume" : "cancel",
        },
      };
    }
    if ((message.includes("promote") || message.includes("make campaign")) && experimentId) {
      return {
        toolName: "promote_experiment_to_campaign",
        input: { brandId: context.brand.id, experimentId },
      };
    }
    if ((message.includes("delete") || message.includes("remove")) && experimentId) {
      return {
        toolName: "delete_experiment",
        input: { brandId: context.brand.id, experimentId },
      };
    }
    if (experimentId) {
      return {
        toolName: "get_experiment_snapshot",
        input: { brandId: context.brand.id, experimentId },
      };
    }
    return {
      toolName: "summarize_experiments",
      input: { brandId: context.brand.id },
    };
  }

  if (context?.brand.id && (message.includes("add sender") || message.includes("buy domain") || message.includes("provision sender"))) {
    const emailParts = extractEmailParts(message);
    const parsedDomain = emailParts?.domain || extractDomain(message);
    return {
      toolName: "provision_mailpool_sender",
      input: {
        brandId: context.brand.id,
        provider: "mailpool",
        domain: parsedDomain,
        fromLocalPart: emailParts?.fromLocalPart ?? "",
        domainMode:
          message.includes("buy") || message.includes("register") || message.includes("new domain")
            ? "register"
            : "existing",
      },
    };
  }

  if (message.includes("refresh") || message.includes("sync")) {
    const emailParts = extractEmailParts(message);
    const matchingSender =
      context?.senders.snapshots.find((snapshot) => snapshot.fromEmail === `${emailParts?.fromLocalPart ?? ""}@${emailParts?.domain ?? ""}`) ??
      context?.senders.snapshots.find((snapshot) => snapshot.mailpoolStatus === "pending") ??
      (context?.senders.snapshots.length === 1 ? context.senders.snapshots[0] : null);
    if (matchingSender?.provider === "mailpool") {
      return {
        toolName: "refresh_mailpool_sender",
        input: { accountId: matchingSender.accountId },
      };
    }
  }

  if (context?.brand.id && message.includes("brand")) {
    return {
      toolName: "get_brand_snapshot",
      input: { brandId: context.brand.id },
    };
  }

  if (
    context?.senders.snapshots.length === 1 &&
    context.senders.snapshots[0]?.provider === "mailpool" &&
    message.includes("sender")
  ) {
    return {
      toolName: "get_sender_snapshot",
      input: { accountId: context.senders.snapshots[0].accountId },
    };
  }

  if (context?.brand.id && (message.includes("sender") || message.includes("routing"))) {
    return {
      toolName: "get_brand_snapshot",
      input: { brandId: context.brand.id },
    };
  }

  return null;
}

function snapshotContext(context: Awaited<ReturnType<typeof getOperatorBrandContext>>): Record<string, unknown> {
  if (!context) return {};
  return {
    brand: context.brand,
    provisioning: context.provisioning,
    senders: {
      total: context.senders.total,
      ready: context.senders.ready,
      pending: context.senders.pending,
      blocked: context.senders.blocked,
    },
    campaigns: context.campaigns,
    experiments: context.experiments,
    leads: context.leads,
    inbox: context.inbox,
    issues: context.issues,
    nextActions: context.nextActions,
  };
}

function toActionSummary(action: OperatorAction): OperatorActionSummary {
  return {
    id: action.id,
    toolName: action.toolName,
    riskLevel: action.riskLevel,
    approvalMode: action.approvalMode,
    status: action.status,
    preview: action.preview,
  };
}

async function createAssistantMessage(
  threadId: string,
  assistant: OperatorChatAssistantReply
) {
  return createOperatorMessage({
    threadId,
    role: "assistant",
    kind: "message",
    content: {
      text: assistant.summary,
      assistant,
    },
  });
}

async function executeToolAction(input: {
  threadId: string;
  actionId: string;
  tool: OperatorToolSpec;
  toolInput: Record<string, unknown>;
}) {
  await createOperatorMessage({
    threadId: input.threadId,
    role: "tool",
    kind: "tool_call",
    content: {
      toolName: input.tool.name,
      input: input.toolInput,
    },
  });
  const result = await input.tool.run(input.toolInput);
  const updatedAction =
    (await updateOperatorAction(input.actionId, {
      status: "completed",
      result: result.result,
    })) ?? (await getOperatorAction(input.actionId));
  await createOperatorMessage({
    threadId: input.threadId,
    role: "tool",
    kind: "tool_result",
    content: {
      toolName: input.tool.name,
      summary: result.summary,
      result: result.result,
    },
  });
  if (result.receipt) {
    await createOperatorMessage({
      threadId: input.threadId,
      role: "assistant",
      kind: "receipt",
      content: result.receipt,
    });
  }
  return { result, updatedAction };
}

export async function runOperatorChatTurn(input: OperatorChatRequest): Promise<OperatorChatResponse> {
  let runId = "";
  let thread =
    input.threadId?.trim() ? await getOperatorThread(input.threadId.trim()) : null;
  if (!thread) {
    thread = await createOperatorThread({
      userId: input.userId,
      brandId: input.brandId,
      title: titleFromMessage(input.message),
    });
  } else if (!thread.title.trim()) {
    thread = (await updateOperatorThread(thread.id, { title: titleFromMessage(input.message) })) ?? thread;
  }

  const resolvedBrandId = asString(input.brandId) || thread.brandId;
  await createOperatorMessage({
    threadId: thread.id,
    role: "user",
    kind: "message",
    content: { text: input.message },
  });

  const brandContext = resolvedBrandId ? await getOperatorBrandContext(resolvedBrandId) : null;
  const greetingOnly = isCasualGreeting(input.message);
  const fallbackAssistant = greetingOnly
    ? buildGreetingAssistant(brandContext?.brand.name)
    : brandContext
      ? buildDefaultAssistantReply({
          brandName: brandContext.brand.name,
          issues: brandContext.issues,
          nextActions: brandContext.nextActions,
          sendersTotal: brandContext.senders.total,
          readySenders: brandContext.senders.ready,
          campaignsTotal: brandContext.campaigns.total,
          inboxThreads: brandContext.inbox.threads,
        })
      : {
          summary: "I can help, but there isn't an active brand attached to this chat yet. Open a brand and try again.",
          findings: [],
          recommendations: [],
        };
  const messageHistory = await listOperatorMessages(thread.id);
  const llmPlan = input.structuredAction
    ? null
    : await planOperatorReplyWithLlm({
        brandId: resolvedBrandId,
        message: input.message,
        mode: input.mode,
        messages: messageHistory,
        context: brandContext,
        fallbackAssistant,
      });
  const requestedAction = filterRequestedActionForMessage(
    input.structuredAction ?? llmPlan?.requestedAction ?? inferActionFromMessage(input, brandContext),
    input.message
  );
  const run = await createOperatorRun({
    threadId: thread.id,
    brandId: resolvedBrandId,
    model: llmPlan?.model ?? (input.structuredAction ? "operator-structured-action" : "operator-v1"),
    contextSnapshot: snapshotContext(brandContext),
    plan: requestedAction
      ? [{ step: requestedAction.toolName, status: "in_progress" }]
      : [],
  });
  runId = run.id;

  try {
    let assistant: OperatorChatAssistantReply;
    const actions: OperatorAction[] = [];

    if (requestedAction) {
      const tool = getOperatorToolSpec(requestedAction.toolName);
      if (!tool) {
        assistant = {
          summary: `I understand what you're asking for, but I can't run that yet because the tool \`${requestedAction.toolName}\` is not registered.`,
          findings: [],
          recommendations: [],
        };
      } else if (
        tool.name === "provision_mailpool_sender" &&
        (!asString(requestedAction.input.domain) || !asString(requestedAction.input.fromLocalPart))
      ) {
        const hasInventory = (brandContext?.provisioning.mailpoolDomainInventoryCount ?? 0) > 0;
        assistant = {
          summary: hasInventory
            ? `I can add the sender. Tell me the exact sender email you want, for example \`marco@getselffunded.com\`, and whether I should use an existing Mailpool domain or buy a new one.`
            : "I can add the sender. Tell me the exact sender email you want, for example `marco@getselffunded.com`. If this needs a new domain, say `buy` or `register` and I'll prepare that flow.",
          findings: [],
          recommendations: [],
        };
      } else if (
        tool.name === "provision_mailpool_sender" &&
        asString(requestedAction.input.domainMode) === "register"
      ) {
        const registrant = asRecord(requestedAction.input.registrant);
        const hasRegistrant =
          Boolean(asString(registrant.firstName)) &&
          Boolean(asString(registrant.lastName)) &&
          Boolean(asString(registrant.emailAddress)) &&
          Boolean(asString(registrant.address1)) &&
          Boolean(asString(registrant.city)) &&
          Boolean(asString(registrant.postalCode)) &&
          Boolean(asString(registrant.country));
        if (!hasRegistrant) {
          assistant = {
            summary: "I can buy and provision that sender, but I still need the registrant details first: first name, last name, company, email, street address, city, postal code, and country. If you want to skip that, tell me to use an existing Mailpool domain instead.",
            findings: [],
            recommendations: [],
          };
        } else if (tool.approvalMode === "confirm") {
          const action = await createOperatorAction({
            runId: run.id,
            toolName: tool.name,
            riskLevel: tool.riskLevel,
            approvalMode: tool.approvalMode,
            input: requestedAction.input,
            preview: buildToolPreview(tool, requestedAction.input),
          });
          actions.push(action);
          await createOperatorMessage({
            threadId: thread.id,
            role: "assistant",
            kind: "approval_request",
            content: {
              actionId: action.id,
              preview: action.preview,
              toolName: action.toolName,
            },
          });
          assistant = summarizeActionPreview(action);
        } else {
          const action = await createOperatorAction({
            runId: run.id,
            toolName: tool.name,
            riskLevel: tool.riskLevel,
            approvalMode: tool.approvalMode,
            status: "running",
            input: requestedAction.input,
            preview: buildToolPreview(tool, requestedAction.input),
          });
          const executed = await executeToolAction({
            threadId: thread.id,
            actionId: action.id,
            tool,
            toolInput: requestedAction.input,
          });
          actions.push(executed.updatedAction ?? action);
          assistant = {
            summary: executed.result.summary,
            findings: [],
            recommendations: [],
          };
        }
      } else if (tool.approvalMode === "confirm") {
        const action = await createOperatorAction({
          runId: run.id,
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          approvalMode: tool.approvalMode,
          input: requestedAction.input,
          preview: buildToolPreview(tool, requestedAction.input),
        });
        actions.push(action);
        await createOperatorMessage({
          threadId: thread.id,
          role: "assistant",
          kind: "approval_request",
          content: {
            actionId: action.id,
            preview: action.preview,
            toolName: action.toolName,
          },
        });
        assistant = summarizeActionPreview(action);
      } else {
        const action = await createOperatorAction({
          runId: run.id,
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          approvalMode: tool.approvalMode,
          status: "running",
          input: requestedAction.input,
          preview: buildToolPreview(tool, requestedAction.input),
        });
        const executed = await executeToolAction({
          threadId: thread.id,
          actionId: action.id,
          tool,
          toolInput: requestedAction.input,
        });
        actions.push(executed.updatedAction ?? action);
        assistant = {
          summary: executed.result.summary,
          findings: [],
          recommendations: [],
        };
      }
    } else {
      assistant = llmPlan?.assistant ?? fallbackAssistant;
    }

    const assistantMessage = await createAssistantMessage(thread.id, assistant);
    const updatedThread =
      (await updateOperatorThread(thread.id, {
        lastSummary: assistant.summary,
      })) ?? thread;
    await updateOperatorRun(run.id, {
      status: "completed",
      contextSnapshot: snapshotContext(brandContext),
      completedAt: nowIso(),
    });

    return {
      thread: updatedThread,
      run: {
        id: run.id,
        status: "completed",
        model: run.model,
      },
      assistant,
      actions: actions.map(toActionSummary),
      messages: [assistantMessage],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operator chat failed";
    await updateOperatorRun(runId, {
      status: "failed",
      errorText: message,
      completedAt: nowIso(),
    });
    throw error;
  }
}

export async function confirmOperatorAction(input: {
  actionId: string;
  userId?: string;
  note?: string;
}) {
  const action = await getOperatorAction(input.actionId);
  if (!action) {
    const error = new Error("Operator action not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  const run = await getOperatorRun(action.runId);
  if (!run) {
    const error = new Error("Operator run not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  const thread = await getOperatorThread(run.threadId);
  if (!thread) {
    const error = new Error("Operator thread not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  if (action.approvalMode !== "confirm") {
    return {
      action,
      receipt: {
        title: "No confirmation needed",
        summary: "This action does not require explicit confirmation.",
        details: [],
      },
    };
  }

  await createOperatorApproval({
    actionId: action.id,
    requestedByUserId: input.userId,
    decidedByUserId: input.userId,
    decision: "approved",
    note: input.note,
  });

  const tool = getOperatorToolSpec(action.toolName);
  if (!tool) {
    const error = new Error("Operator tool not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  await updateOperatorAction(action.id, { status: "running" });

  try {
    const executed = await executeToolAction({
      threadId: thread.id,
      actionId: action.id,
      tool,
      toolInput: action.input,
    });
    const receipt =
      executed.result.receipt ??
      ({
        title: "Action completed",
        summary: executed.result.summary,
        details: [],
      } as const);
    await updateOperatorThread(thread.id, {
      lastSummary: receipt.summary,
    });
    return {
      action: executed.updatedAction ?? action,
      receipt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operator action failed";
    const failedAction = await updateOperatorAction(action.id, {
      status: "failed",
      errorText: message,
    });
    await createOperatorMessage({
      threadId: thread.id,
      role: "assistant",
      kind: "system_note",
      content: {
        title: "Action failed",
        summary: message,
      },
    });
    throw Object.assign(new Error(message), {
      status: 500,
      action: failedAction ?? action,
    });
  }
}

export async function cancelOperatorAction(input: {
  actionId: string;
  userId?: string;
  note?: string;
}) {
  const action = await getOperatorAction(input.actionId);
  if (!action) {
    const error = new Error("Operator action not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  const run = await getOperatorRun(action.runId);
  if (!run) {
    const error = new Error("Operator run not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  const thread = await getOperatorThread(run.threadId);
  if (!thread) {
    const error = new Error("Operator thread not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  if (action.approvalMode === "confirm") {
    await createOperatorApproval({
      actionId: action.id,
      requestedByUserId: input.userId,
      decidedByUserId: input.userId,
      decision: "rejected",
      note: input.note,
    });
  }
  const canceledAction = await updateOperatorAction(action.id, {
    status: "canceled",
    errorText: "",
  });
  await createOperatorMessage({
    threadId: thread.id,
    role: "assistant",
    kind: "system_note",
    content: {
      title: "Action canceled",
      summary: input.note?.trim() || "The requested action was canceled.",
    },
  });
  await updateOperatorThread(thread.id, {
    lastSummary: input.note?.trim() || "Action canceled",
  });

  return {
    action: canceledAction ?? action,
  };
}

export async function getOperatorThreadDetail(threadId: string): Promise<OperatorThreadDetail | null> {
  const thread = await getOperatorThread(threadId);
  if (!thread) return null;
  const [messages, actions] = await Promise.all([
    listOperatorMessages(threadId),
    listOperatorActionsByThread(threadId),
  ]);
  return {
    thread,
    messages,
    actions,
  };
}
