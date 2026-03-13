import {
  conversationPromptModeEnabled,
  generateConversationPromptMessage,
  type ConversationPromptRenderContext,
} from "@/lib/conversation-prompt-render";
import { resolveLlmModel } from "@/lib/llm-router";
import type {
  ConversationFlowEdge,
  ConversationFlowGraph,
  ConversationFlowNode,
  ConversationReplyTimingPolicy,
  ConversationPreviewLead,
  ConversationProbeResult,
  ConversationProbeScenarioResult,
  ConversationProbeStep,
  ConversationWorkingHoursPolicy,
  ReplyThread,
} from "@/lib/factory-types";

const DEFAULT_TIMEZONE = "America/Los_Angeles";
const SELFFUNDED_AWS_APPLICATION_URL = "https://www.selffunded.dev/aws-credits/apply";
const MAX_PROBE_TURNS = 4;
const DEFAULT_REPLY_TIMING: ConversationReplyTimingPolicy = {
  minimumDelayMinutes: 40,
  randomAdditionalDelayMinutes: 20,
};
const DEFAULT_WORKING_HOURS: ConversationWorkingHoursPolicy = {
  timezone: DEFAULT_TIMEZONE,
  businessHoursEnabled: true,
  businessHoursStartHour: 9,
  businessHoursEndHour: 17,
  businessDays: [1, 2, 3, 4, 5],
};

type ReplyPolicyAction = "reply" | "no_reply" | "manual_review";
type ReplyPlaybook = "selffunded_aws" | "bhuman_private_drop" | "generic";

type ReplyPolicyInput = {
  brandName: string;
  brandWebsite: string;
  campaignName: string;
  experimentName: string;
  experimentOffer: string;
  experimentAudience: string;
  experimentNotes: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  leadName: string;
  leadEmail: string;
  leadCompany: string;
};

type ReplyPolicyResult = {
  action: ReplyPolicyAction;
  intent: ReplyThread["intent"];
  sentiment: ReplyThread["sentiment"];
  confidence: number;
  route: string;
  reason: string;
  playbook: ReplyPlaybook;
  closeThread: boolean;
  autoSendAllowed: boolean;
  guidance: string[];
  prohibited: string[];
};

type ProbeScenario = {
  id: string;
  title: string;
  description: string;
  mode: "reply" | "no_reply";
  personaPrompt: string;
  cannedReplies: string[];
};

type ProbeHistoryItem = {
  direction: "inbound" | "outbound";
  subject: string;
  body: string;
  at: string;
  nodeId?: string;
  messageId?: string;
};

type ProbeContext = {
  brand: {
    id: string;
    name: string;
    website: string;
    tone: string;
    notes: string;
  };
  campaign: {
    id: string;
    name: string;
    objectiveGoal: string;
    objectiveConstraints: string;
  };
  experiment: {
    id: string;
    name: string;
    offer: string;
    cta: string;
    audience: string;
    notes: string;
  };
  runPolicy: {
    dailyCap: number;
    hourlyCap: number;
    minSpacingMinutes: number;
    timezone: string;
  };
  workingHours: ConversationWorkingHoursPolicy;
  graph: ConversationFlowGraph;
  lead: ConversationPreviewLead;
  startNodeId: string;
};

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(dateIso: string, minutes: number) {
  const date = new Date(dateIso);
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

function toDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date(0);
  return parsed;
}

function localHourInTimeZone(input: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone.trim() || DEFAULT_TIMEZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(input);
    const hourPart = parts.find((part) => part.type === "hour")?.value ?? "0";
    const parsed = Number(hourPart);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return input.getUTCHours();
  }
}

function localWeekdayInTimeZone(input: Date, timeZone: string) {
  try {
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone.trim() || DEFAULT_TIMEZONE,
      weekday: "short",
    })
      .format(input)
      .toLowerCase()
      .slice(0, 3);
    return { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }[day] ?? 1;
  } catch {
    return input.getUTCDay();
  }
}

function isInsideWorkingHours(input: Date, policy: ConversationWorkingHoursPolicy) {
  if (policy.businessHoursEnabled === false) return true;
  const weekday = localWeekdayInTimeZone(input, policy.timezone || DEFAULT_TIMEZONE);
  if (!policy.businessDays.includes(weekday)) return false;
  const hour = localHourInTimeZone(input, policy.timezone || DEFAULT_TIMEZONE);
  if (policy.businessHoursStartHour === policy.businessHoursEndHour) return true;
  if (policy.businessHoursStartHour < policy.businessHoursEndHour) {
    return hour >= policy.businessHoursStartHour && hour < policy.businessHoursEndHour;
  }
  return hour >= policy.businessHoursStartHour || hour < policy.businessHoursEndHour;
}

function normalizeReplyTiming(graph: ConversationFlowGraph) {
  return {
    minimumDelayMinutes: Math.max(
      0,
      Math.min(
        10080,
        Math.round(
          Number(graph.replyTiming?.minimumDelayMinutes ?? DEFAULT_REPLY_TIMING.minimumDelayMinutes) ||
            DEFAULT_REPLY_TIMING.minimumDelayMinutes
        )
      )
    ),
    randomAdditionalDelayMinutes: Math.max(
      0,
      Math.min(
        1440,
        Math.round(
          Number(
            graph.replyTiming?.randomAdditionalDelayMinutes ??
              DEFAULT_REPLY_TIMING.randomAdditionalDelayMinutes
          ) || DEFAULT_REPLY_TIMING.randomAdditionalDelayMinutes
        )
      )
    ),
  };
}

function formatDelayRange(minimumDelayMinutes: number, randomAdditionalDelayMinutes: number) {
  const min = Math.max(0, Math.round(Number(minimumDelayMinutes) || 0));
  const extra = Math.max(0, Math.round(Number(randomAdditionalDelayMinutes) || 0));
  if (extra <= 0) {
    return `${min} minute${min === 1 ? "" : "s"}`;
  }
  const max = min + extra;
  return `${min}-${max} minutes`;
}

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

function parseLooseJsonObject(rawText: string): unknown {
  const raw = String(rawText ?? "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return {};
      }
    }
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

function normalizeText(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function trimText(value: unknown, max: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, Math.max(0, max));
}

function detectReplyPlaybook(input: {
  brandName: string;
  brandWebsite: string;
  experimentOffer: string;
  experimentAudience: string;
  experimentNotes: string;
}) {
  const haystack = [
    input.brandName,
    input.brandWebsite,
    input.experimentOffer,
    input.experimentAudience,
    input.experimentNotes,
  ]
    .join("\n")
    .toLowerCase();

  if (haystack.includes("aws") && (haystack.includes("self-funded") || haystack.includes("bootstrapped"))) {
    return "selffunded_aws" as const;
  }
  if (haystack.includes("bhuman")) {
    return "bhuman_private_drop" as const;
  }
  return "generic" as const;
}

function classifySentimentFallback(body: string): ReplyThread["sentiment"] {
  const normalized = body.toLowerCase();
  if (/(not interested|stop|unsubscribe|remove me|no thanks|pass|leave me alone)/.test(normalized)) {
    return "negative";
  }
  if (
    /(interested|sounds good|let's talk|yes|we qualify|we are self-funded|self-funded here|bootstrapped here|all done)/.test(
      normalized
    )
  ) {
    return "positive";
  }
  return "neutral";
}

function classifyIntentFallback(body: string): ReplyThread["intent"] {
  const normalized = body.toLowerCase();
  if (/(unsubscribe|remove me|stop emailing|do not contact)/.test(normalized)) {
    return "unsubscribe";
  }
  if (
    /(\?|price|how much|details|what does|what is|how do(es)?|can you|could you|would you|where do i|why )/.test(
      normalized
    )
  ) {
    return "question";
  }
  if (/(interested|qualify|we are self-funded|bootstrapped|send (me )?the link|apply|would love|sounds good)/.test(normalized)) {
    return "interest";
  }
  if (/(already|not now|budget|timing|no need|not a fit|not relevant|not for us|not self-funded)/.test(normalized)) {
    return "objection";
  }
  return "other";
}

function classifyIntentConfidenceFallback(body: string): { intent: ReplyThread["intent"]; confidence: number } {
  const intent = classifyIntentFallback(body);
  if (intent === "unsubscribe") return { intent, confidence: 0.96 };
  if (intent === "interest") return { intent, confidence: 0.86 };
  if (intent === "question") return { intent, confidence: 0.83 };
  if (intent === "objection") return { intent, confidence: 0.8 };
  return { intent, confidence: 0.56 };
}

function detectAutomatedReply(input: { from: string; subject: string; body: string }) {
  const from = String(input.from ?? "").toLowerCase();
  const subject = String(input.subject ?? "").toLowerCase();
  const body = String(input.body ?? "").toLowerCase();
  const combined = `${subject}\n${body}`;

  if (
    /\b(mailer-daemon|postmaster|mail delivery subsystem)\b/.test(from) ||
    /\b(delivery status notification|undeliverable|delivery has failed|returned mail|failure notice)\b/.test(
      combined
    )
  ) {
    return { skip: true, kind: "delivery_status", reason: "Automated delivery-status reply" };
  }

  if (
    /\b(out of office|automatic reply|autoreply|auto reply|vacation|away from the office|ooo)\b/.test(
      combined
    )
  ) {
    return { skip: true, kind: "out_of_office", reason: "Out-of-office auto reply" };
  }

  if (
    /\b(verify you are human|challenge[- ]response|approve sender|whitelist this sender|click the link below to complete delivery)\b/.test(
      combined
    )
  ) {
    return { skip: true, kind: "anti_spam_challenge", reason: "Automated anti-spam challenge" };
  }

  return { skip: false, kind: "", reason: "" };
}

function isAcknowledgementOnlyReply(body: string) {
  const normalized = normalizeText(body.toLowerCase());
  if (!normalized) return false;
  if (normalized.includes("?")) return false;
  if (
    /\b(not interested|unsubscribe|remove me|stop|question|how|why|what|when|where|qualify|self-funded|bootstrapped|aws)\b/.test(
      normalized
    )
  ) {
    return false;
  }
  if (normalized.split(/\s+/).length > 12) return false;
  return /^(thanks!?|thank you!?|sounds good!?|all done!?|appreciate it!?|this is terrific!?|got it!?|perfect!?|done!?|looks good!?|amazing!?)(\s|$)/.test(
    normalized
  );
}

function isStrategicManualReviewReply(body: string) {
  const normalized = body.toLowerCase();
  return /\b(partnership|partner with|distribution|referral|refer|intro|introduce|affiliate|channel|audience|portfolio|co-marketing|investor network|community)\b/.test(
    normalized
  );
}

function replyPolicyProhibitedPhrases(playbook: ReplyPlaybook) {
  const base = [
    "quick note",
    "quick one",
    "just circling back",
    "wanted to follow up",
    "hope you are well",
  ];
  if (playbook === "bhuman_private_drop") {
    base.push('Reply with "I want a BHuman spot"');
  }
  return base;
}

function buildReplyPolicyGuidance(
  input: ReplyPolicyInput,
  result: Pick<ReplyPolicyResult, "action" | "route" | "playbook">
) {
  const guidance = [
    "Preserve real blank lines between short paragraphs.",
    "Keep the reply warm, selective, and human.",
  ];

  if (result.playbook === "selffunded_aws") {
    guidance.push("You are replying as Marco from SelfFunded.dev.");
    guidance.push(
      `If the sender is clearly interested and self-funded, include this exact application URL: ${SELFFUNDED_AWS_APPLICATION_URL}`
    );
    guidance.push("If you include the application link, say AWS handles final vetting and approval on their side.");
    guidance.push("Do not invent approval odds, timing guarantees, deadlines, or promises from AWS.");
    guidance.push("If AWS is not a fit, do not keep selling AWS.");
    guidance.push("If they already joined the platform, do not ask them to join again.");
    guidance.push("If they mention AI, LLM, devtool, or infra deals, acknowledge those categories are a priority.");
    guidance.push("Sign the reply exactly as:\nBest,\nMarco\n\nMarco Rosetti\nSelfFunded.dev");

    if (result.route === "aws_application_link") {
      guidance.push("This reply should provide the application link and keep the next step simple.");
    }
    if (result.route === "aws_not_fit_but_relevant") {
      guidance.push("Acknowledge AWS may not be the fit right now and keep the relationship warm without re-pitching.");
    }
    if (result.route === "aws_question") {
      guidance.push("Answer the question directly and stay grounded in facts already in context.");
    }
  } else if (result.playbook === "bhuman_private_drop") {
    guidance.push("This is a private BHuman drop handled manually over email.");
    guidance.push("There are only 25 one-month licenses and the allocation is manual.");
    guidance.push("If they want one, let them reply naturally and avoid scripted language.");
    guidance.push("Mention that accepted deals require feedback afterward to stay eligible for future drops.");
  } else {
    guidance.push("Use a plainspoken founder-to-founder tone.");
  }

  if (result.action === "manual_review") {
    guidance.push("This draft should feel thoughtful and tailored enough for a human to review before sending.");
  }

  return guidance;
}

function buildFallbackReplyPolicy(input: ReplyPolicyInput): ReplyPolicyResult {
  const playbook = detectReplyPlaybook(input);
  const normalizedBody = input.body.toLowerCase();
  const sentiment = classifySentimentFallback(input.body);
  const { intent, confidence } = classifyIntentConfidenceFallback(input.body);

  let action: ReplyPolicyAction = "manual_review";
  let route = "general_review";
  let reason = "Fallback review path";

  if (intent === "unsubscribe") {
    action = "no_reply";
    route = "unsubscribe_request";
    reason = "Respect unsubscribe without replying";
  } else if (isAcknowledgementOnlyReply(input.body)) {
    action = "no_reply";
    route = "ack_only";
    reason = "Acknowledgement-only reply should stay silent";
  } else if (isStrategicManualReviewReply(input.body)) {
    action = "manual_review";
    route = playbook === "selffunded_aws" ? "aws_strategic_review" : "strategic_review";
    reason = "Strategic or partnership-style message needs human judgment";
  } else if (playbook === "selffunded_aws") {
    const mentionsSelfFunded = /\b(self-funded|bootstrapped|friends\/family|friends and family|angel)\b/.test(
      normalizedBody
    );
    const asksForLink = /\b(link|apply|application|send it over|send over|interested|sounds good|yes)\b/.test(
      normalizedBody
    );
    const mentionsOtherDealInterest = /\b(ai|llm|devtool|dev tool|infra|infrastructure|coding agent|tooling)\b/.test(
      normalizedBody
    );
    const saysAwsNotFit = /\b(not a fit|not relevant|not for us|aws isn't a fit|aws is not a fit)\b/.test(
      normalizedBody
    );
    const saysJoined = /\b(joined|already joined|signed up|on the platform)\b/.test(normalizedBody);

    if (mentionsSelfFunded && asksForLink) {
      action = "reply";
      route = "aws_application_link";
      reason = "Qualified and interested in the AWS credits next step";
    } else if (intent === "question") {
      action = "reply";
      route = "aws_question";
      reason = "Asked a real question that deserves a direct answer";
    } else if ((saysAwsNotFit || intent === "objection") && (mentionsOtherDealInterest || saysJoined)) {
      action = "reply";
      route = "aws_not_fit_but_relevant";
      reason = "AWS is not the fit, but the relationship is still relevant";
    } else if (saysAwsNotFit || /\b(not interested|pass|no thanks)\b/.test(normalizedBody)) {
      action = "no_reply";
      route = "aws_not_interested";
      reason = "No meaningful next step on AWS";
    }
  } else if (playbook === "bhuman_private_drop") {
    if (intent === "interest") {
      action = "reply";
      route = "bhuman_interest";
      reason = "Interested in the private BHuman allocation";
    } else if (intent === "question") {
      action = "manual_review";
      route = "bhuman_question_review";
      reason = "BHuman details are limited and should be handled carefully";
    }
  } else if (intent === "interest" || intent === "question") {
    action = "reply";
    route = intent === "interest" ? "general_interest" : "general_question";
    reason = "There is a meaningful next step to provide";
  }

  return {
    action,
    intent,
    sentiment,
    confidence,
    route,
    reason,
    playbook,
    closeThread: action === "no_reply" || intent === "unsubscribe",
    autoSendAllowed: action === "reply",
    guidance: buildReplyPolicyGuidance(input, { action, route, playbook }),
    prohibited: replyPolicyProhibitedPhrases(playbook),
  };
}

async function evaluateReplyPolicy(input: ReplyPolicyInput): Promise<ReplyPolicyResult> {
  const fallback = buildFallbackReplyPolicy(input);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  const playbookRules =
    fallback.playbook === "selffunded_aws"
      ? [
          "Offer context: AWS credits for self-funded founders; angels or friends/family are fine, institutional VC is not.",
          `If qualified and interested, include this exact application URL: ${SELFFUNDED_AWS_APPLICATION_URL}`,
          "Mention AWS handles final vetting/approval on their side.",
          "Do not promise timing, approvals, or deadlines.",
          "Do not keep selling AWS if they say AWS is not a fit.",
          "If they already joined the platform, do not pitch joining again.",
          "Thoughtful questions about partnerships, distribution, referrals, intros, or audience fit should usually be manual_review.",
        ]
      : fallback.playbook === "bhuman_private_drop"
        ? [
            "Offer context: private BHuman drop with only 25 one-month licenses.",
            "Allocation is manual and not visible in the dashboard.",
            "If relevant, let them reply naturally; never use scripted CTA wording.",
            "Accepted deals require feedback afterward to remain eligible for future drops.",
          ]
        : ["Reply only when there is a real next step or a meaningful human response to give."];

  const prompt = [
    "You triage inbound founder-style outreach replies.",
    "Decide whether the system should reply, stay silent, or require manual review.",
    "Selective silence is important: do not reply to simple acknowledgements.",
    "Return strict JSON only with this shape:",
    '{"action":"reply|no_reply|manual_review","intent":"question|interest|objection|unsubscribe|other","sentiment":"positive|neutral|negative","confidence":0-1,"route":"short_snake_case_label","reason":"one short sentence"}',
    "",
    "Core rules:",
    "- Use reply when there is a real next step, a real question, or meaningful context worth acknowledging.",
    "- Use no_reply for thanks-only acknowledgements, completion confirmations, or messages where replying would feel robotic.",
    "- Use manual_review for nuanced, strategic, partnership, distribution, referral, intro, or high-value messages.",
    "- Unsubscribe/remove-me requests should be no_reply with intent=unsubscribe.",
    ...playbookRules.map((rule) => `- ${rule}`),
    "",
    `Context JSON:\n${JSON.stringify(input)}`,
  ].join("\n");

  try {
    const model = resolveLlmModel("reply_policy_evaluation", { input });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        text: { format: { type: "json_object" } },
        max_output_tokens: 800,
      }),
    });
    const raw = await response.text();
    if (!response.ok) return fallback;

    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    const parsed = asRecord(parseLooseJsonObject(extractOutputText(payload)));
    const actionRaw = String(parsed.action ?? "").trim();
    const intentRaw = String(parsed.intent ?? "").trim();
    const sentimentRaw = String(parsed.sentiment ?? "").trim();
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? fallback.confidence) || fallback.confidence));
    const action =
      actionRaw === "reply" || actionRaw === "no_reply" || actionRaw === "manual_review"
        ? (actionRaw as ReplyPolicyAction)
        : fallback.action;
    const intent =
      intentRaw === "question" ||
      intentRaw === "interest" ||
      intentRaw === "objection" ||
      intentRaw === "unsubscribe" ||
      intentRaw === "other"
        ? (intentRaw as ReplyThread["intent"])
        : fallback.intent;
    const sentiment =
      sentimentRaw === "positive" || sentimentRaw === "neutral" || sentimentRaw === "negative"
        ? (sentimentRaw as ReplyThread["sentiment"])
        : fallback.sentiment;
    const route = trimText(parsed.route, 80) || fallback.route;
    const reason = trimText(parsed.reason, 220) || fallback.reason;

    return {
      action,
      intent,
      sentiment,
      confidence,
      route,
      reason,
      playbook: fallback.playbook,
      closeThread: action === "no_reply" || intent === "unsubscribe",
      autoSendAllowed: action === "reply",
      guidance: buildReplyPolicyGuidance(input, { action, route, playbook: fallback.playbook }),
      prohibited: replyPolicyProhibitedPhrases(fallback.playbook),
    };
  } catch {
    return fallback;
  }
}

function pickIntentEdge(input: {
  graph: ConversationFlowGraph;
  currentNodeId: string;
  intent: ReplyThread["intent"];
  confidence: number;
}) {
  const candidates = input.graph.edges
    .filter(
      (edge) =>
        edge.fromNodeId === input.currentNodeId &&
        edge.trigger === "intent" &&
        edge.intent === input.intent &&
        input.confidence >= edge.confidenceThreshold
    )
    .sort((a, b) => a.priority - b.priority);
  return candidates[0] ?? null;
}

function pickFallbackEdge(graph: ConversationFlowGraph, currentNodeId: string) {
  return (
    graph.edges
      .filter((edge) => edge.fromNodeId === currentNodeId && edge.trigger === "fallback")
      .sort((a, b) => a.priority - b.priority)[0] ?? null
  );
}

function pickDueTimerEdge(input: {
  graph: ConversationFlowGraph;
  currentNodeId: string;
  lastNodeEnteredAt: string;
}) {
  const elapsedMs = Math.max(0, Date.now() - toDate(input.lastNodeEnteredAt).getTime());
  return (
    input.graph.edges
      .filter((edge) => edge.fromNodeId === input.currentNodeId && edge.trigger === "timer")
      .sort((a, b) => a.priority - b.priority)
      .find((edge) => elapsedMs >= edge.waitMinutes * 60 * 1000) ?? null
  );
}

function edgeLabel(edge: ConversationFlowEdge) {
  if (edge.trigger === "intent") {
    switch (edge.intent) {
      case "question":
        return "Asked for more info";
      case "interest":
        return "Interested";
      case "objection":
        return "Not now";
      case "unsubscribe":
        return "Negative response";
      case "other":
        return "Other reply";
      default:
        return "Reply";
    }
  }
  if (edge.trigger === "timer") {
    return edge.waitMinutes > 0 ? `No reply after ${edge.waitMinutes} minutes` : "No reply timer";
  }
  return "Fallback";
}

function nodeById(graph: ConversationFlowGraph, nodeId: string) {
  return graph.nodes.find((node) => node.id === nodeId) ?? null;
}

function replyTriggeredAutoSendDelayWindow(
  graph: ConversationFlowGraph,
  node: ConversationFlowNode,
  edgeWaitMinutes: number
) {
  const nodeDelayMinutes = Math.max(0, Number(node.delayMinutes ?? 0) || 0);
  const currentEdgeWait = Math.max(0, Number(edgeWaitMinutes ?? 0) || 0);
  const currentTotal = nodeDelayMinutes + currentEdgeWait;
  if (!node.autoSend) {
    return {
      minimumDelayMinutes: currentTotal,
      maximumDelayMinutes: currentTotal,
      representativeDelayMinutes: currentTotal,
    };
  }
  const replyTiming = normalizeReplyTiming(graph);
  const minimumDelayMinutes = Math.max(currentTotal, replyTiming.minimumDelayMinutes);
  const maximumDelayMinutes = minimumDelayMinutes + replyTiming.randomAdditionalDelayMinutes;
  return {
    minimumDelayMinutes,
    maximumDelayMinutes,
    representativeDelayMinutes:
      replyTiming.randomAdditionalDelayMinutes > 0
        ? minimumDelayMinutes + Math.round(replyTiming.randomAdditionalDelayMinutes / 2)
        : minimumDelayMinutes,
  };
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce(
    (value, [key, replacement]) => value.replaceAll(`{{${key}}}`, replacement),
    template
  );
}

function fallbackFirstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

async function renderNodeMessage(input: {
  context: ProbeContext;
  scenarioId: string;
  node: ConversationFlowNode;
  latestInboundSubject?: string;
  latestInboundBody?: string;
  intent?: ReplyThread["intent"] | "";
  confidence?: number;
  priorNodePath?: string[];
  history?: ProbeHistoryItem[];
  replyPolicy?: {
    action: "reply" | "no_reply" | "manual_review" | "";
    route: string;
    reason: string;
    guidance: string[];
    prohibited: string[];
  };
}) {
  if (input.node.kind !== "message") {
    return { ok: false as const, reason: "Node is not a message node", subject: "", body: "", trace: {} };
  }

  const promptContext: ConversationPromptRenderContext = {
    brand: {
      id: input.context.brand.id,
      name: input.context.brand.name,
      website: input.context.brand.website,
      tone: input.context.brand.tone,
      notes: input.context.brand.notes,
    },
    campaign: {
      id: input.context.campaign.id,
      name: input.context.campaign.name,
      objectiveGoal: input.context.campaign.objectiveGoal,
      objectiveConstraints: input.context.campaign.objectiveConstraints,
    },
    experiment: {
      id: input.context.experiment.id,
      name: input.context.experiment.name,
      offer: input.context.experiment.offer,
      cta: input.context.experiment.cta,
      audience: input.context.experiment.audience,
      notes: input.context.experiment.notes,
    },
    lead: {
      id: input.context.lead.id,
      email: input.context.lead.email,
      name: input.context.lead.name,
      company: input.context.lead.company,
      title: input.context.lead.title,
      domain: input.context.lead.domain,
      status: "new",
    },
    thread: {
      sessionId: `probe_${input.scenarioId}`,
      nodeId: input.node.id,
      parentMessageId: "",
      latestInboundSubject: String(input.latestInboundSubject ?? "").trim(),
      latestInboundBody: String(input.latestInboundBody ?? "").trim(),
      intent: input.intent ?? "",
      confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0) || 0)),
      priorNodePath: Array.isArray(input.priorNodePath) ? input.priorNodePath.filter(Boolean) : [],
      history: Array.isArray(input.history)
        ? input.history.map((item) => ({
            direction: item.direction,
            subject: item.subject,
            body: item.body,
            at: item.at,
            nodeId: item.nodeId ?? "",
            messageId: item.messageId ?? "",
          }))
        : [],
    },
    safety: {
      maxDepth: Math.max(1, input.context.graph.maxDepth || 5),
      dailyCap: Math.max(1, input.context.runPolicy.dailyCap || 30),
      hourlyCap: Math.max(1, input.context.runPolicy.hourlyCap || 6),
      minSpacingMinutes: Math.max(1, input.context.runPolicy.minSpacingMinutes || 8),
      timezone: input.context.runPolicy.timezone || DEFAULT_TIMEZONE,
    },
    replyPolicy: input.replyPolicy,
  };

  if (conversationPromptModeEnabled()) {
    const generated = await generateConversationPromptMessage({
      node: input.node,
      context: promptContext,
    });
    if (!generated.ok) {
      return { ok: false as const, reason: generated.reason, subject: "", body: "", trace: generated.trace };
    }
    return {
      ok: true as const,
      reason: "",
      subject: generated.subject,
      body: generated.body,
      trace: generated.trace,
    };
  }

  const subject = normalizeWhitespace(
    renderTemplate(input.node.subject, {
      firstName: fallbackFirstName(input.context.lead.name),
      company: input.context.lead.company || "your team",
      leadTitle: input.context.lead.title || "your role",
      brandName: input.context.brand.name,
      campaignGoal: input.context.campaign.objectiveGoal || input.context.experiment.name,
      variantName: input.context.experiment.name,
      replyPreview: String(input.latestInboundBody ?? "").trim(),
      shortAnswer: String(input.latestInboundBody ?? "").trim().split(/\n+/)[0] || "happy to share details",
    })
  );
  const body = normalizeWhitespace(
    renderTemplate(input.node.body, {
      firstName: fallbackFirstName(input.context.lead.name),
      company: input.context.lead.company || "your team",
      leadTitle: input.context.lead.title || "your role",
      brandName: input.context.brand.name,
      campaignGoal: input.context.campaign.objectiveGoal || input.context.experiment.name,
      variantName: input.context.experiment.name,
      replyPreview: String(input.latestInboundBody ?? "").trim(),
      shortAnswer: String(input.latestInboundBody ?? "").trim().split(/\n+/)[0] || "happy to share details",
    })
  );
  if (!subject || !body) {
    return { ok: false as const, reason: "Node rendered empty", subject: "", body: "", trace: {} };
  }
  return { ok: true as const, reason: "", subject, body, trace: { mode: "legacy_template" } };
}

function defaultScenarios(playbook: ReplyPlaybook): ProbeScenario[] {
  if (playbook === "selffunded_aws") {
    return [
      {
        id: "qualified_interest",
        title: "Qualified and Interested",
        description: "A self-funded founder wants the next step.",
        mode: "reply",
        personaPrompt:
          "You are a self-funded founder. The offer sounds relevant. Reply briefly and naturally if the next step seems worthwhile.",
        cannedReplies: [
          "Hey Marco,\n\nWe're fully bootstrapped and this sounds relevant. Please send over the application link.\n\nBest,\nJohn",
          "Perfect, I just submitted it.\n\nBest,\nJohn",
        ],
      },
      {
        id: "skeptical_question",
        title: "Skeptical Question",
        description: "A founder is interested but asks a concrete qualifying question first.",
        mode: "reply",
        personaPrompt:
          "You are a self-funded founder who asks concrete questions before committing. Keep replies short and pragmatic.",
        cannedReplies: [
          "Hey Marco,\n\nWe're self-funded. Can the credits be used on an existing AWS account or only a new one?\n\nBest,\nJohn",
          "Helpful, thanks. If that's the case, send over the application.\n\nBest,\nJohn",
        ],
      },
      {
        id: "not_fit_but_relevant",
        title: "Not AWS, Still Relevant",
        description: "AWS is not the fit, but the founder is already on the platform and interested in other deal categories.",
        mode: "reply",
        personaPrompt:
          "You are a self-funded founder. AWS is not especially relevant right now, but you are interested in AI, LLM, devtool, or infra deals.",
        cannedReplies: [
          "Hey Marco,\n\nWe're self-funded and already joined, but AWS isn't really the bottleneck for us. I'd definitely be interested in AI or infra deals if you have those coming through.\n\nBest,\nJohn",
        ],
      },
      {
        id: "thanks_only",
        title: "Thanks Only",
        description: "A low-effort acknowledgement that should stay silent.",
        mode: "reply",
        personaPrompt:
          "You are busy and polite. Reply with a very short acknowledgement and no question.",
        cannedReplies: ["Thanks, appreciate it."],
      },
      {
        id: "silent",
        title: "No Reply",
        description: "The recipient stays silent so the probe can test timer branches.",
        mode: "no_reply",
        personaPrompt: "",
        cannedReplies: [],
      },
      {
        id: "strategic_review",
        title: "Strategic Relationship",
        description: "A valuable operator asks about partnership or distribution.",
        mode: "reply",
        personaPrompt:
          "You run a founder community and see a potential partnership angle. Ask a thoughtful question about distribution or referrals.",
        cannedReplies: [
          "Hey Marco,\n\nInteresting. We run a fairly concentrated founder community and there may be a partner angle here if the fit is right. Are you open to comparing notes on distribution or referrals?\n\nBest,\nJohn",
        ],
      },
    ];
  }

  if (playbook === "bhuman_private_drop") {
    return [
      {
        id: "interested",
        title: "Interested Team",
        description: "A team wants a spot in the manual BHuman drop.",
        mode: "reply",
        personaPrompt:
          "You are interested in trying BHuman for your team. Reply naturally without sounding scripted.",
        cannedReplies: [
          "Hey,\n\nThis could be relevant for us. If there are still spots left, I'd be interested in seeing whether we qualify.\n\nBest,\nJohn",
        ],
      },
      {
        id: "question",
        title: "Careful Question",
        description: "A thoughtful question that likely deserves manual handling.",
        mode: "reply",
        personaPrompt:
          "You are interested but ask a careful question about fit, constraints, or how the manual drop works.",
        cannedReplies: [
          "Hey,\n\nPotentially relevant. Before we go further, how are you deciding who gets one of the 25 spots?\n\nBest,\nJohn",
        ],
      },
      {
        id: "thanks_only",
        title: "Thanks Only",
        description: "A simple acknowledgement that should not trigger a reply.",
        mode: "reply",
        personaPrompt:
          "You are busy and simply acknowledge the message.",
        cannedReplies: ["Thanks, sounds good."],
      },
      {
        id: "strategic_review",
        title: "Strategic Relationship",
        description: "A strategically valuable recipient opens a relationship thread.",
        mode: "reply",
        personaPrompt:
          "You are strategically valuable and ask about a broader partnership or distribution angle.",
        cannedReplies: [
          "Hey,\n\nInteresting angle. We may have a fit across our portfolio if the product lands. Would be open to comparing notes if that is useful.\n\nBest,\nJohn",
        ],
      },
      {
        id: "silent",
        title: "No Reply",
        description: "No reply, to test reminder/timer branches.",
        mode: "no_reply",
        personaPrompt: "",
        cannedReplies: [],
      },
    ];
  }

  return [
    {
      id: "interested",
      title: "Interested",
      description: "Positive signal and asks for the next step.",
      mode: "reply",
      personaPrompt:
        "You are interested if the message seems useful. Reply briefly and ask for the next step.",
      cannedReplies: [
        "Hey,\n\nThis looks relevant. What's the best next step from here?\n\nBest,\nJohn",
      ],
    },
    {
      id: "question",
      title: "Question",
      description: "Asks a real question before deciding.",
      mode: "reply",
      personaPrompt:
        "You are curious but cautious. Ask one concrete question.",
      cannedReplies: [
        "Hey,\n\nCan you share one concrete example of how this would work for a team like ours?\n\nBest,\nJohn",
      ],
    },
    {
      id: "objection",
      title: "Not a Fit Right Now",
      description: "Polite objection with no immediate next step.",
      mode: "reply",
      personaPrompt:
        "You are polite but this is not the right fit right now. Keep it short.",
      cannedReplies: [
        "Hey,\n\nAppreciate the note, but I don't think this is a fit for us right now.\n\nBest,\nJohn",
      ],
    },
    {
      id: "thanks_only",
      title: "Thanks Only",
      description: "Simple acknowledgement.",
      mode: "reply",
      personaPrompt:
        "Reply with a brief acknowledgement only and no question.",
      cannedReplies: ["Thanks, appreciate it."],
    },
    {
      id: "silent",
      title: "No Reply",
      description: "Silent recipient for timer testing.",
      mode: "no_reply",
      personaPrompt: "",
      cannedReplies: [],
    },
  ];
}

async function simulatePersonaReply(input: {
  context: ProbeContext;
  scenario: ProbeScenario;
  turnIndex: number;
  latestOutbound: { subject: string; body: string };
  history: ProbeHistoryItem[];
}) {
  if (input.scenario.mode === "no_reply") {
    return { mode: "no_reply" as const, subject: "", body: "", trace: { source: "scenario" } };
  }

  const canned = input.scenario.cannedReplies[input.turnIndex] ?? input.scenario.cannedReplies[input.scenario.cannedReplies.length - 1] ?? "";
  const llmEnabled = /^(1|true|yes)$/i.test(String(process.env.CONVERSATION_PROBE_USE_LLM ?? "").trim());
  const apiKey = process.env.OPENAI_API_KEY;
  if (!llmEnabled || !apiKey) {
    return {
      mode: "reply" as const,
      subject: `Re: ${input.latestOutbound.subject}`.trim(),
      body: canned,
      trace: { source: "canned_roleplay" },
    };
  }

  const prompt = [
    "You are roleplaying a recipient replying to an outbound email.",
    "You have no hidden context beyond the visible thread below.",
    "Do not assume knowledge that was not stated in the email chain.",
    "Reply like a real founder/operator, not a bot.",
    "Return strict JSON only with this shape:",
    '{"mode":"reply|no_reply","subject":"...","body":"...","reason":"one sentence"}',
    "",
    `Persona:\n${input.scenario.personaPrompt}`,
    "",
    `Recipient context JSON:\n${JSON.stringify({
      name: input.context.lead.name,
      email: input.context.lead.email,
      title: input.context.lead.title,
      company: input.context.lead.company,
      domain: input.context.lead.domain,
    })}`,
    "",
    `Visible thread JSON:\n${JSON.stringify(input.history)}`,
    "",
    "Rules:",
    "- Only write what the recipient would naturally send next.",
    "- If the recipient would ignore this message, return mode=no_reply with empty subject/body.",
    "- Keep it concise and natural.",
    canned ? `- Style target example: ${canned}` : "",
  ].join("\n");

  try {
    const model = resolveLlmModel("conversation_flow_roleplay", { input: prompt });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        text: { format: { type: "json_object" } },
        max_output_tokens: 700,
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(raw.slice(0, 200));
    }
    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    const parsed = asRecord(parseLooseJsonObject(extractOutputText(payload)));
    const mode = String(parsed.mode ?? "").trim() === "no_reply" ? "no_reply" : "reply";
    if (mode === "no_reply") {
      return { mode, subject: "", body: "", trace: { source: "llm", reason: trimText(parsed.reason, 140) } };
    }
    const subject = normalizeWhitespace(String(parsed.subject ?? `Re: ${input.latestOutbound.subject}`));
    const body = normalizeWhitespace(String(parsed.body ?? canned));
    if (!body) {
      return { mode: "no_reply" as const, subject: "", body: "", trace: { source: "llm_empty" } };
    }
    return {
      mode: "reply" as const,
      subject: subject || `Re: ${input.latestOutbound.subject}`.trim(),
      body,
      trace: { source: "llm", reason: trimText(parsed.reason, 140) },
    };
  } catch {
    return {
      mode: "reply" as const,
      subject: `Re: ${input.latestOutbound.subject}`.trim(),
      body: canned,
      trace: { source: "fallback_canned" },
    };
  }
}

function makeStep(input: Partial<ConversationProbeStep> & Pick<ConversationProbeStep, "id" | "kind" | "label">): ConversationProbeStep {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    nodeId: input.nodeId ?? "",
    nodeTitle: input.nodeTitle ?? "",
    edgeId: input.edgeId ?? "",
    edgeLabel: input.edgeLabel ?? "",
    subject: input.subject ?? "",
    body: input.body ?? "",
    waitMinutes: Math.max(0, Number(input.waitMinutes ?? 0) || 0),
    intent: input.intent ?? "",
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0) || 0)),
    action: input.action ?? "",
    route: input.route ?? "",
    reason: input.reason ?? "",
  };
}

async function runScenario(input: {
  context: ProbeContext;
  scenario: ProbeScenario;
}): Promise<ConversationProbeScenarioResult> {
  const { context, scenario } = input;
  const startNode = nodeById(context.graph, context.startNodeId);
  if (!startNode || startNode.kind !== "message") {
    return {
      id: scenario.id,
      title: scenario.title,
      description: scenario.description,
      outcome: "stalled",
      summary: "Start node is missing or not a message node.",
      path: [],
      steps: [],
    };
  }

  const steps: ConversationProbeStep[] = [];
  const history: ProbeHistoryItem[] = [];
  const path = [startNode.title || "Start"];
  let currentNode = startNode;
  let turnCount = 1;
  let scenarioMode: ProbeScenario["mode"] = scenario.mode;
  let summary = "";
  let outcome: ConversationProbeScenarioResult["outcome"] = "stalled";

  const firstOutbound = await renderNodeMessage({
    context,
    scenarioId: scenario.id,
    node: currentNode,
    priorNodePath: [currentNode.id],
  });
  if (!firstOutbound.ok) {
    return {
      id: scenario.id,
      title: scenario.title,
      description: scenario.description,
      outcome: "stalled",
      summary: firstOutbound.reason,
      path,
      steps: [
        makeStep({
          id: `${scenario.id}_outbound_1`,
          kind: "status",
          label: "Draft failed",
          nodeId: currentNode.id,
          nodeTitle: currentNode.title,
          reason: firstOutbound.reason,
        }),
      ],
    };
  }

  steps.push(
    makeStep({
      id: `${scenario.id}_outbound_1`,
      kind: "outbound",
      label: "Outbound draft",
      nodeId: currentNode.id,
      nodeTitle: currentNode.title,
      subject: firstOutbound.subject,
      body: firstOutbound.body,
      reason: currentNode.autoSend ? "Auto send node" : "Manual review node",
    })
  );
  history.push({
    direction: "outbound",
    subject: firstOutbound.subject,
    body: firstOutbound.body,
    at: nowIso(),
    nodeId: currentNode.id,
  });

  while (turnCount < Math.max(1, Math.min(MAX_PROBE_TURNS, context.graph.maxDepth || MAX_PROBE_TURNS))) {
    if (scenarioMode === "no_reply") {
      const timerEdge = pickDueTimerEdge({
        graph: context.graph,
        currentNodeId: currentNode.id,
        lastNodeEnteredAt: addMinutes(nowIso(), -10080),
      });
      if (!timerEdge) {
        outcome = "stalled";
        summary = "No timer branch is configured from this node.";
        steps.push(
          makeStep({
            id: `${scenario.id}_status_silent_${turnCount}`,
            kind: "status",
            label: "No reply",
            nodeId: currentNode.id,
            nodeTitle: currentNode.title,
            reason: "Recipient stayed silent and no timer path was available.",
          })
        );
        break;
      }

      const nextNode = nodeById(context.graph, timerEdge.toNodeId);
      steps.push(
        makeStep({
          id: `${scenario.id}_timer_${turnCount}`,
          kind: "timer",
          label: "Timer fired",
          nodeId: currentNode.id,
          nodeTitle: currentNode.title,
          edgeId: timerEdge.id,
          edgeLabel: edgeLabel(timerEdge),
          waitMinutes: timerEdge.waitMinutes,
          reason: `No reply for ${timerEdge.waitMinutes} minutes.`,
        })
      );

      if (!nextNode) {
        outcome = "stalled";
        summary = "Timer edge points to a missing node.";
        break;
      }

      path.push(nextNode.title || "Next");
      if (nextNode.kind === "terminal" || turnCount + 1 >= context.graph.maxDepth) {
        outcome = "completed";
        summary =
          nextNode.kind === "terminal"
            ? `Timer branch ends at ${nextNode.title || "terminal node"}.`
            : "Probe reached max depth on a timer branch.";
        steps.push(
          makeStep({
            id: `${scenario.id}_status_terminal_${turnCount}`,
            kind: "status",
            label: "Flow completed",
            nodeId: nextNode.id,
            nodeTitle: nextNode.title,
            reason: summary,
          })
        );
        break;
      }

      const timerOutbound = await renderNodeMessage({
        context,
        scenarioId: scenario.id,
        node: nextNode,
        priorNodePath: [currentNode.id, nextNode.id],
        history,
      });
      if (!timerOutbound.ok) {
        outcome = "stalled";
        summary = timerOutbound.reason;
        break;
      }
      steps.push(
        makeStep({
          id: `${scenario.id}_outbound_timer_${turnCount}`,
          kind: "outbound",
          label: "Timer follow-up draft",
          nodeId: nextNode.id,
          nodeTitle: nextNode.title,
          subject: timerOutbound.subject,
          body: timerOutbound.body,
          reason: nextNode.autoSend ? "Auto timer follow-up" : "Manual timer follow-up",
        })
      );
      history.push({
        direction: "outbound",
        subject: timerOutbound.subject,
        body: timerOutbound.body,
        at: nowIso(),
        nodeId: nextNode.id,
      });
      currentNode = nextNode;
      turnCount += 1;
      outcome = "timer_follow_up";
      summary = `Silence routes to ${nextNode.title || "the next node"} after ${timerEdge.waitMinutes} minutes.`;
      if (!nextNode.autoSend) {
        steps.push(
          makeStep({
            id: `${scenario.id}_manual_timer_${turnCount}`,
            kind: "status",
            label: "Manual review",
            nodeId: nextNode.id,
            nodeTitle: nextNode.title,
            reason: "Timer branch lands on a manual-review node.",
          })
        );
        break;
      }
      break;
    }

    const latestOutbound = history[history.length - 1];
    const simulated = await simulatePersonaReply({
      context,
      scenario,
      turnIndex: turnCount - 1,
      latestOutbound: {
        subject: latestOutbound?.subject ?? "",
        body: latestOutbound?.body ?? "",
      },
      history,
    });

    if (simulated.mode === "no_reply") {
      scenarioMode = "no_reply";
      continue;
    }

    steps.push(
      makeStep({
        id: `${scenario.id}_inbound_${turnCount}`,
        kind: "inbound",
        label: "Roleplay reply",
        nodeId: currentNode.id,
        nodeTitle: currentNode.title,
        subject: simulated.subject,
        body: simulated.body,
      })
    );
    history.push({
      direction: "inbound",
      subject: simulated.subject,
      body: simulated.body,
      at: nowIso(),
    });

    const automated = detectAutomatedReply({
      from: context.lead.email,
      subject: simulated.subject,
      body: simulated.body,
    });
    if (automated.skip) {
      outcome = "stalled";
      summary = automated.reason;
      steps.push(
        makeStep({
          id: `${scenario.id}_status_auto_${turnCount}`,
          kind: "status",
          label: "Skipped automated reply",
          nodeId: currentNode.id,
          nodeTitle: currentNode.title,
          reason: automated.reason,
        })
      );
      break;
    }

    const replyPolicy = await evaluateReplyPolicy({
      brandName: context.brand.name,
      brandWebsite: context.brand.website,
      campaignName: context.campaign.name,
      experimentName: context.experiment.name,
      experimentOffer: context.experiment.offer,
      experimentAudience: context.experiment.audience,
      experimentNotes: context.experiment.notes,
      from: context.lead.email,
      to: "",
      subject: simulated.subject,
      body: simulated.body,
      leadName: context.lead.name,
      leadEmail: context.lead.email,
      leadCompany: context.lead.company,
    });

    steps.push(
      makeStep({
        id: `${scenario.id}_route_${turnCount}`,
        kind: "route",
        label: "Reply policy",
        nodeId: currentNode.id,
        nodeTitle: currentNode.title,
        intent: replyPolicy.intent,
        confidence: replyPolicy.confidence,
        action: replyPolicy.action,
        route: replyPolicy.route,
        reason: replyPolicy.reason,
      })
    );

    if (replyPolicy.action === "no_reply") {
      outcome = "no_reply";
      summary = replyPolicy.reason;
      steps.push(
        makeStep({
          id: `${scenario.id}_status_no_reply_${turnCount}`,
          kind: "status",
          label: "Selective silence",
          nodeId: currentNode.id,
          nodeTitle: currentNode.title,
          intent: replyPolicy.intent,
          action: replyPolicy.action,
          route: replyPolicy.route,
          reason: replyPolicy.reason,
        })
      );
      break;
    }

    const selectedEdge =
      pickIntentEdge({
        graph: context.graph,
        currentNodeId: currentNode.id,
        intent: replyPolicy.intent,
        confidence: replyPolicy.confidence,
      }) ?? pickFallbackEdge(context.graph, currentNode.id);

    if (!selectedEdge) {
      outcome = "stalled";
      summary = `No branch matches ${replyPolicy.intent || "this reply"}.`;
      steps.push(
        makeStep({
          id: `${scenario.id}_status_no_edge_${turnCount}`,
          kind: "status",
          label: "No matching edge",
          nodeId: currentNode.id,
          nodeTitle: currentNode.title,
          reason: summary,
          intent: replyPolicy.intent,
          action: replyPolicy.action,
        })
      );
      break;
    }

    const nextNode = nodeById(context.graph, selectedEdge.toNodeId);
    steps.push(
      makeStep({
        id: `${scenario.id}_edge_${turnCount}`,
        kind: "route",
        label: "Branch selected",
        nodeId: currentNode.id,
        nodeTitle: currentNode.title,
        edgeId: selectedEdge.id,
        edgeLabel: edgeLabel(selectedEdge),
        intent: replyPolicy.intent,
        confidence: replyPolicy.confidence,
        action: replyPolicy.action,
        route: replyPolicy.route,
        reason: replyPolicy.reason,
      })
    );

    if (!nextNode) {
      outcome = "stalled";
      summary = "Selected edge points to a missing node.";
      break;
    }

    path.push(nextNode.title || "Next");
    if (nextNode.kind === "terminal" || turnCount + 1 >= context.graph.maxDepth) {
      outcome = "completed";
      summary =
        nextNode.kind === "terminal"
          ? `Flow reaches ${nextNode.title || "the terminal node"}.`
          : "Probe reached max depth.";
      steps.push(
        makeStep({
          id: `${scenario.id}_status_complete_${turnCount}`,
          kind: "status",
          label: "Flow completed",
          nodeId: nextNode.id,
          nodeTitle: nextNode.title,
          reason: summary,
        })
      );
      break;
    }

    const nextOutbound = await renderNodeMessage({
      context,
      scenarioId: scenario.id,
      node: nextNode,
      latestInboundSubject: simulated.subject,
      latestInboundBody: simulated.body,
      intent: replyPolicy.intent,
      confidence: replyPolicy.confidence,
      priorNodePath: [currentNode.id, nextNode.id],
      history,
      replyPolicy: {
        action: replyPolicy.action,
        route: replyPolicy.route,
        reason: replyPolicy.reason,
        guidance: replyPolicy.guidance,
        prohibited: replyPolicy.prohibited,
      },
    });
    if (!nextOutbound.ok) {
      outcome = "stalled";
      summary = nextOutbound.reason;
      break;
    }

    const autoReplyDelay = replyTriggeredAutoSendDelayWindow(
      context.graph,
      nextNode,
      selectedEdge.waitMinutes
    );
    const outsideWorkingHours = !isInsideWorkingHours(new Date(), context.workingHours || DEFAULT_WORKING_HOURS);
    const autoReplyTimingLabel = formatDelayRange(
      autoReplyDelay.minimumDelayMinutes,
      autoReplyDelay.maximumDelayMinutes - autoReplyDelay.minimumDelayMinutes
    );

    steps.push(
      makeStep({
        id: `${scenario.id}_outbound_${turnCount + 1}`,
        kind: "outbound",
        label: replyPolicy.action === "manual_review" || !nextNode.autoSend ? "Manual draft" : "Auto reply draft",
        nodeId: nextNode.id,
        nodeTitle: nextNode.title,
        subject: nextOutbound.subject,
        body: nextOutbound.body,
        action: replyPolicy.action,
        route: replyPolicy.route,
        reason:
          replyPolicy.action === "manual_review" || !nextNode.autoSend
            ? replyPolicy.reason
            : `${replyPolicy.reason} Delay window: ${autoReplyTimingLabel}.${
                outsideWorkingHours ? ` Sends wait for working hours in ${context.workingHours.timezone}.` : ""
              }`,
        waitMinutes:
          replyPolicy.action === "manual_review" || !nextNode.autoSend
            ? 0
            : autoReplyDelay.representativeDelayMinutes,
      })
    );
    history.push({
      direction: "outbound",
      subject: nextOutbound.subject,
      body: nextOutbound.body,
      at: nowIso(),
      nodeId: nextNode.id,
    });

    currentNode = nextNode;
    turnCount += 1;

    if (replyPolicy.action === "manual_review" || !nextNode.autoSend) {
      outcome = "manual_review";
      summary = `Reply routes to ${nextNode.title || "the next node"}, but it should be reviewed by a human before sending.`;
      steps.push(
        makeStep({
          id: `${scenario.id}_status_manual_${turnCount}`,
          kind: "status",
          label: "Manual review",
          nodeId: nextNode.id,
          nodeTitle: nextNode.title,
          action: replyPolicy.action,
          route: replyPolicy.route,
          reason: summary,
        })
      );
      break;
    }

    outcome = "auto_reply";
    summary = `Reply flows into ${nextNode.title || "the next node"} automatically after ${autoReplyTimingLabel}${
      context.workingHours.businessHoursEnabled === false
        ? "."
        : `, inside ${context.workingHours.timezone} working hours.`
    }`;
    break;
  }

  if (!summary) {
    summary = "Probe ended without a matching completion state.";
  }

  return {
    id: scenario.id,
    title: scenario.title,
    description: scenario.description,
    outcome,
    summary,
    path,
    steps,
  };
}

export async function runConversationMapProbe(input: ProbeContext): Promise<ConversationProbeResult> {
  const context: ProbeContext = {
    ...input,
    workingHours: input.workingHours ?? DEFAULT_WORKING_HOURS,
    graph: {
      ...input.graph,
      replyTiming: normalizeReplyTiming(input.graph),
    },
  };
  const playbook = detectReplyPlaybook({
    brandName: context.brand.name,
    brandWebsite: context.brand.website,
    experimentOffer: context.experiment.offer,
    experimentAudience: context.experiment.audience,
    experimentNotes: context.experiment.notes,
  });
  const scenarios = defaultScenarios(playbook);
  const startNode = nodeById(context.graph, context.startNodeId);
  const results = await Promise.all(
    scenarios.map((scenario) => runScenario({ context, scenario: { ...scenario } }))
  );

  return {
    startNodeId: context.startNodeId,
    startNodeTitle: startNode?.title || "Start",
    lead: context.lead,
    generatedAt: nowIso(),
    scenarios: results,
  };
}
