import { mkdir, readFile, writeFile } from "fs/promises";
import { createId } from "@/lib/factory-data";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  ConversationEvent,
  ConversationDemoLead,
  ConversationFlowEdge,
  ConversationFlowGraph,
  ConversationFlowNode,
  ConversationPromptPolicy,
  ConversationReplyTimingPolicy,
  ConversationMap,
  ConversationSession,
} from "@/lib/factory-types";

const isVercel = Boolean(process.env.VERCEL);
const STORE_PATH = isVercel
  ? "/tmp/factory_conversation_flow.v1.json"
  : `${process.cwd()}/data/conversation-flow.v1.json`;

const TABLE_MAP = "demanddev_conversation_maps";
const TABLE_SESSION = "demanddev_conversation_sessions";
const TABLE_EVENT = "demanddev_conversation_events";

const nowIso = () => new Date().toISOString();

export class ConversationFlowDataError extends Error {
  status: number;
  hint: string;
  debug: Record<string, unknown>;

  constructor(
    message: string,
    options: { status?: number; hint?: string; debug?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = "ConversationFlowDataError";
    this.status = options.status ?? 500;
    this.hint = options.hint ?? "";
    this.debug = options.debug ?? {};
  }
}

type LocalStore = {
  maps: ConversationMap[];
  sessions: ConversationSession[];
  events: ConversationEvent[];
};

type ConversationSeedContext = {
  offer?: string;
  cta?: string;
  audience?: string;
  campaignGoal?: string;
};

type ConversationPlaybook = "selffunded_aws" | "bhuman_private_drop" | "generic";

const DEFAULT_PROMPT_POLICY: ConversationPromptPolicy = {
  subjectMaxWords: 0,
  bodyMaxWords: 0,
  exactlyOneCta: false,
};

const DEFAULT_REPLY_TIMING: ConversationReplyTimingPolicy = {
  minimumDelayMinutes: 40,
  randomAdditionalDelayMinutes: 20,
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function clampConfidence(value: unknown, fallback = 0.7) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function clampWords(value: unknown, fallback: number, min: number, max: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function normalizePromptPolicy(value: unknown): ConversationPromptPolicy {
  const row = asRecord(value);
  return {
    subjectMaxWords: clampWords(row.subjectMaxWords, DEFAULT_PROMPT_POLICY.subjectMaxWords, 0, 24),
    bodyMaxWords: clampWords(row.bodyMaxWords, DEFAULT_PROMPT_POLICY.bodyMaxWords, 0, 320),
    exactlyOneCta: row.exactlyOneCta === true,
  };
}

function buildNodePromptTemplate(input: {
  title: string;
  hint?: string;
}) {
  const title = oneLine(input.title) || "Message";
  const hint = truncate(oneLine(String(input.hint ?? "")), 180);

  return [
    `Write outbound email copy for node "${title}".`,
    "Primary goal: earn a simple positive reply and continue the thread.",
    "Use campaign, experiment, and lead context dynamically; do not invent unavailable facts.",
    "Keep it short and concrete: plain language, no hype, no fluff.",
    "Use variables only when available: {{firstName}}, {{company}}, {{leadTitle}}, {{brandName}}, {{campaignGoal}}, {{variantName}}, {{replyPreview}}, {{shortAnswer}}.",
    "Never output unresolved placeholders.",
    "End with one low-friction CTA sentence (yes/no is preferred).",
    hint ? `Node angle hint: ${hint}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeReplyTiming(value: unknown): ConversationReplyTimingPolicy {
  const row = asRecord(value);
  return {
    minimumDelayMinutes: Math.max(
      0,
      Math.min(10080, Math.round(Number(row.minimumDelayMinutes ?? row.minimum_delay_minutes ?? DEFAULT_REPLY_TIMING.minimumDelayMinutes) || DEFAULT_REPLY_TIMING.minimumDelayMinutes))
    ),
    randomAdditionalDelayMinutes: Math.max(
      0,
      Math.min(
        1440,
        Math.round(
          Number(
            row.randomAdditionalDelayMinutes ??
              row.random_additional_delay_minutes ??
              DEFAULT_REPLY_TIMING.randomAdditionalDelayMinutes
          ) || DEFAULT_REPLY_TIMING.randomAdditionalDelayMinutes
        )
      )
    ),
  };
}

function defaultNode(position: { x: number; y: number }): ConversationFlowNode {
  const subject = "Question for {{company}}";
  const body = "Hi {{firstName}},\n\nSaw {{company}} and wanted to ask about {{campaignGoal}}.";
  return {
    id: createId("node"),
    kind: "message",
    title: "Message",
    copyMode: "prompt_v1",
    promptTemplate: buildNodePromptTemplate({
      title: "Message",
      hint: body,
    }),
    promptVersion: 1,
    promptPolicy: { ...DEFAULT_PROMPT_POLICY },
    subject,
    body,
    autoSend: true,
    delayMinutes: 0,
    x: position.x,
    y: position.y,
  };
}

function defaultTerminalNode(position: { x: number; y: number }): ConversationFlowNode {
  return {
    id: createId("node"),
    kind: "terminal",
    title: "End",
    copyMode: "prompt_v1",
    promptTemplate: "",
    promptVersion: 1,
    promptPolicy: { ...DEFAULT_PROMPT_POLICY },
    subject: "",
    body: "",
    autoSend: false,
    delayMinutes: 0,
    x: position.x,
    y: position.y,
  };
}

function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = 180) {
  const text = oneLine(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function domainFromEmail(email: string) {
  const domain = email.split("@")[1] ?? "";
  return domain.trim().toLowerCase();
}

function normalizeDemoLead(value: unknown, index: number): ConversationDemoLead | null {
  const row = asRecord(value);
  const emailRaw = String(row.email ?? "").trim().toLowerCase();
  const name = String(row.name ?? "").trim();
  const company = String(row.company ?? "").trim();
  const title = String(row.title ?? "").trim();
  const domainRaw = String(row.domain ?? "").trim().toLowerCase();
  const domain = domainRaw || (emailRaw ? domainFromEmail(emailRaw) : "");
  const local = emailRaw.split("@")[0] ?? "";
  const safeEmail = emailRaw || (local && domain ? `${local}@${domain}` : "");
  if (!safeEmail || !domain) return null;

  const sourceRaw = String(row.source ?? "").trim();
  const source: ConversationDemoLead["source"] =
    sourceRaw === "manual" || sourceRaw === "sourced" ? sourceRaw : "seeded";
  return {
    id: String(row.id ?? "").trim() || createId("demo"),
    name: name || `Lead ${index + 1}`,
    email: safeEmail,
    company: company || "Unknown company",
    title: title || "Unknown title",
    domain,
    source,
  };
}

function normalizePreviewLeads(graphRow: Record<string, unknown>) {
  const normalized = asArray(graphRow.previewLeads ?? graphRow.preview_leads)
    .map((row, index) => normalizeDemoLead(row, index))
    .filter((item): item is ConversationDemoLead => Boolean(item))
    .slice(0, 12);

  const previewLeads = normalized;
  const previewLeadIdRaw = String(graphRow.previewLeadId ?? graphRow.preview_lead_id ?? "").trim();
  const previewLeadId = previewLeads.some((lead) => lead.id === previewLeadIdRaw)
    ? previewLeadIdRaw
    : previewLeads[0]?.id ?? "";
  return { previewLeads, previewLeadId };
}

function extractInlineCta(value: string) {
  const match = value.match(/\bCTA\s*:\s*([^\n]+)/i);
  return match ? oneLine(match[1]) : "";
}

function normalizeMessageNodePromptTemplate(node: ConversationFlowNode): ConversationFlowNode {
  if (node.kind !== "message") return node;
  const currentPromptTemplate = String(node.promptTemplate ?? "").trim();
  const hasDeprecatedPromptScaffold =
    !currentPromptTemplate ||
    /subject intent:|body intent:|legacy subject example|legacy body example|write this node message for/i.test(
      currentPromptTemplate
    );

  return {
    ...node,
    copyMode: "prompt_v1",
    promptTemplate: hasDeprecatedPromptScaffold
      ? buildNodePromptTemplate({
        title: node.title,
        hint: node.body || node.subject,
      })
      : currentPromptTemplate,
    promptVersion: Math.max(1, Number(node.promptVersion || 1)),
    promptPolicy: normalizePromptPolicy(node.promptPolicy),
  };
}

function detectConversationPlaybook(context: ConversationSeedContext): ConversationPlaybook {
  const haystack = [context.offer ?? "", context.cta ?? "", context.audience ?? "", context.campaignGoal ?? ""]
    .join("\n")
    .toLowerCase();

  if (haystack.includes("aws") && (haystack.includes("self-funded") || haystack.includes("bootstrapped"))) {
    return "selffunded_aws";
  }
  if (haystack.includes("bhuman")) {
    return "bhuman_private_drop";
  }
  return "generic";
}

function configureMessageNode(
  node: ConversationFlowNode,
  input: {
    title: string;
    subject: string;
    body: string;
    autoSend?: boolean;
    delayMinutes?: number;
  }
) {
  node.title = input.title;
  node.subject = input.subject;
  node.body = input.body;
  node.autoSend = input.autoSend ?? node.autoSend;
  node.delayMinutes = input.delayMinutes ?? node.delayMinutes;
  node.promptTemplate = buildNodePromptTemplate({
    title: node.title,
    hint: node.body,
  });
  return node;
}

function buildSelffundedAwsGraph(): ConversationFlowGraph {
  const start = configureMessageNode(defaultNode({ x: 60, y: 220 }), {
    title: "Ask if they qualify",
    subject: "AWS credits for self-funded founders",
    body:
      "Hi {{firstName}},\n\nWe finalized a partnership with AWS to distribute cloud credits to self-funded founders.\n\nI didn't see anything on Crunchbase, but wanted to confirm: are you entirely self-funded at this point? Angels or friends/family are fine, just no institutional VC.\n\nIf you qualify, I'm happy to send the application link.",
    autoSend: true,
  });

  const application = configureMessageNode(defaultNode({ x: 460, y: 60 }), {
    title: "Send AWS application link",
    subject: "AWS application link",
    body:
      "Hi {{firstName}},\n\nThanks for confirming you're fully self-funded.\n\nHere's the application link for the AWS credits program:\nhttps://www.selffunded.dev/aws-credits/apply\n\nOnce you submit, AWS handles final vetting and approval on their side. If anything is unclear as you go through it, feel free to send it over.",
    autoSend: true,
    delayMinutes: 40,
  });

  const question = configureMessageNode(defaultNode({ x: 460, y: 250 }), {
    title: "Answer AWS question",
    subject: "Answer on AWS credits",
    body:
      "Hi {{firstName}},\n\nAnswer the question directly and keep it grounded in the actual AWS credits program details.\n\nIf the question is really about eligibility or the next step, it is fine to include the application link.\n\nDo not promise timing, approvals, or deadlines.",
    autoSend: false,
  });

  const relevant = configureMessageNode(defaultNode({ x: 460, y: 440 }), {
    title: "Keep relationship warm",
    subject: "Noted",
    body:
      "Hi {{firstName}},\n\nAcknowledge that AWS may not be the fit right now.\n\nIf they already joined the platform, do not pitch joining again. If they mention AI, LLM, devtool, or infra deals, say those are categories we are prioritizing.\n\nKeep the relationship warm without pushing AWS again.",
    autoSend: false,
  });

  const fiveDay = configureMessageNode(defaultNode({ x: 900, y: 60 }), {
    title: "5-day application check-in",
    subject: "Still interested in AWS credits?",
    body:
      "Hi {{firstName}},\n\nLeaving this here in case the AWS credits application got buried.\n\nIf you're still fully self-funded and want me to resend the link, I can do that.",
    autoSend: true,
  });

  const end = defaultTerminalNode({ x: 1160, y: 250 });

  return {
    version: 1,
    maxDepth: 6,
    startNodeId: start.id,
    nodes: [start, application, question, relevant, fiveDay, end],
    edges: [
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: application.id,
        trigger: "intent",
        intent: "interest",
        waitMinutes: 0,
        confidenceThreshold: 0.65,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: question.id,
        trigger: "intent",
        intent: "question",
        waitMinutes: 0,
        confidenceThreshold: 0.6,
        priority: 2,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: relevant.id,
        trigger: "intent",
        intent: "objection",
        waitMinutes: 0,
        confidenceThreshold: 0.6,
        priority: 3,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: relevant.id,
        trigger: "intent",
        intent: "other",
        waitMinutes: 0,
        confidenceThreshold: 0.55,
        priority: 4,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: end.id,
        trigger: "intent",
        intent: "unsubscribe",
        waitMinutes: 0,
        confidenceThreshold: 0.8,
        priority: 5,
      },
      {
        id: createId("edge"),
        fromNodeId: application.id,
        toNodeId: fiveDay.id,
        trigger: "timer",
        intent: "",
        waitMinutes: 7200,
        confidenceThreshold: 0,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: application.id,
        toNodeId: question.id,
        trigger: "intent",
        intent: "question",
        waitMinutes: 0,
        confidenceThreshold: 0.6,
        priority: 2,
      },
      {
        id: createId("edge"),
        fromNodeId: application.id,
        toNodeId: relevant.id,
        trigger: "intent",
        intent: "objection",
        waitMinutes: 0,
        confidenceThreshold: 0.6,
        priority: 3,
      },
      {
        id: createId("edge"),
        fromNodeId: application.id,
        toNodeId: end.id,
        trigger: "intent",
        intent: "unsubscribe",
        waitMinutes: 0,
        confidenceThreshold: 0.8,
        priority: 4,
      },
      {
        id: createId("edge"),
        fromNodeId: fiveDay.id,
        toNodeId: question.id,
        trigger: "intent",
        intent: "question",
        waitMinutes: 0,
        confidenceThreshold: 0.6,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: fiveDay.id,
        toNodeId: application.id,
        trigger: "intent",
        intent: "interest",
        waitMinutes: 0,
        confidenceThreshold: 0.65,
        priority: 2,
      },
      {
        id: createId("edge"),
        fromNodeId: fiveDay.id,
        toNodeId: end.id,
        trigger: "fallback",
        intent: "",
        waitMinutes: 0,
        confidenceThreshold: 0,
        priority: 3,
      },
      {
        id: createId("edge"),
        fromNodeId: question.id,
        toNodeId: end.id,
        trigger: "fallback",
        intent: "",
        waitMinutes: 0,
        confidenceThreshold: 0,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: relevant.id,
        toNodeId: end.id,
        trigger: "fallback",
        intent: "",
        waitMinutes: 0,
        confidenceThreshold: 0,
        priority: 1,
      },
    ],
    previewLeads: [],
    previewLeadId: "",
    replyTiming: { ...DEFAULT_REPLY_TIMING },
  };
}

function buildBhumanPrivateDropGraph(): ConversationFlowGraph {
  const start = configureMessageNode(defaultNode({ x: 60, y: 220 }), {
    title: "Private BHuman drop",
    subject: "Private BHuman availability",
    body:
      "Hi {{firstName}},\n\nWe have a private BHuman drop with 25 one-month licenses only.\n\nIt includes Speakeasy for full AI videos from a prompt and Personalized Video from one base video with CSV or API personalization.\n\nIf this is relevant for your team, just reply and I'll see if there is still availability.",
    autoSend: true,
  });

  const interest = configureMessageNode(defaultNode({ x: 460, y: 120 }), {
    title: "Check availability manually",
    subject: "BHuman availability",
    body:
      "Hi {{firstName}},\n\nHandle this manually because the BHuman drop is allocated by hand and there are only 25 spots.\n\nIf they take a deal, remind them feedback afterward is required to stay eligible for future drops.",
    autoSend: false,
  });

  const question = configureMessageNode(defaultNode({ x: 460, y: 320 }), {
    title: "Answer BHuman question",
    subject: "Answer on BHuman",
    body:
      "Hi {{firstName}},\n\nAnswer the question clearly and naturally.\n\nKeep the private-drop framing, avoid scripted CTA language, and mention the feedback requirement when it matters.",
    autoSend: false,
  });

  const end = defaultTerminalNode({ x: 860, y: 220 });

  return {
    version: 1,
    maxDepth: 5,
    startNodeId: start.id,
    nodes: [start, interest, question, end],
    edges: [
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: interest.id,
        trigger: "intent",
        intent: "interest",
        waitMinutes: 0,
        confidenceThreshold: 0.65,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: question.id,
        trigger: "intent",
        intent: "question",
        waitMinutes: 0,
        confidenceThreshold: 0.6,
        priority: 2,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: end.id,
        trigger: "intent",
        intent: "unsubscribe",
        waitMinutes: 0,
        confidenceThreshold: 0.8,
        priority: 3,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: end.id,
        trigger: "fallback",
        intent: "",
        waitMinutes: 0,
        confidenceThreshold: 0,
        priority: 4,
      },
      {
        id: createId("edge"),
        fromNodeId: interest.id,
        toNodeId: end.id,
        trigger: "fallback",
        intent: "",
        waitMinutes: 0,
        confidenceThreshold: 0,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: question.id,
        toNodeId: end.id,
        trigger: "fallback",
        intent: "",
        waitMinutes: 0,
        confidenceThreshold: 0,
        priority: 1,
      },
    ],
    previewLeads: [],
    previewLeadId: "",
    replyTiming: { ...DEFAULT_REPLY_TIMING },
  };
}

export function defaultConversationGraph(context: ConversationSeedContext = {}): ConversationFlowGraph {
  const playbook = detectConversationPlaybook(context);
  if (playbook === "selffunded_aws") {
    return buildSelffundedAwsGraph();
  }
  if (playbook === "bhuman_private_drop") {
    return buildBhumanPrivateDropGraph();
  }

  const offerFromContext = oneLine(context.offer ?? "");
  const inferredCta = oneLine(context.cta ?? "") || extractInlineCta(offerFromContext);
  const cleanOffer = truncate(offerFromContext.replace(/\bCTA\s*:\s*[^\n]+/gi, "").trim(), 220);
  const campaignGoal = truncate(
    oneLine(context.campaignGoal ?? "") || cleanOffer || "outbound pipeline performance",
    140
  );
  const audienceHint = oneLine(context.audience ?? "");

  const start = defaultNode({ x: 60, y: 220 });
  start.title = "Start question";
  start.subject = cleanOffer
    ? `Idea: ${truncate(cleanOffer, 58)}`
    : "Question on {{campaignGoal}}";
  start.body = cleanOffer
    ? `Hi {{firstName}},\n\nIdea for {{company}}: ${cleanOffer}\n\n${
        inferredCta || "If this is relevant, open to a short walkthrough?"
      }`
    : "Hi {{firstName}},\n\nNoticed {{company}} and wanted to ask: are you actively working on {{campaignGoal}} right now?\n\nIf yes, I can share a short example from similar teams.";
  start.promptTemplate = buildNodePromptTemplate({
    title: start.title,
    hint: start.body,
  });

  const interest = defaultNode({ x: 420, y: 80 });
  interest.title = "Interest follow-up";
  interest.subject = inferredCta
    ? truncate(inferredCta.replace(/\?+$/g, ""), 58)
    : "Worth a 10-minute walkthrough?";
  interest.body =
    `Great to hear, {{firstName}}.\n\nI can show how this would work for ${audienceHint || "{{company}}"} and tie it directly to ${campaignGoal}.\n\n${
      inferredCta || "Would Tuesday or Wednesday be better for 10 minutes?"
    }`;
  interest.autoSend = true;
  interest.delayMinutes = 0;
  interest.promptTemplate = buildNodePromptTemplate({
    title: interest.title,
    hint: interest.body,
  });

  const question = defaultNode({ x: 420, y: 220 });
  question.title = "Question answer";
  question.subject = "Short answer";
  question.body =
    "Thanks for asking, {{firstName}}.\n\nShort answer: {{shortAnswer}}\n\nIf useful, I can send one concrete example using your use case for {{company}}.";
  question.autoSend = false;
  question.promptTemplate = buildNodePromptTemplate({
    title: question.title,
    hint: question.body,
  });

  const objection = defaultNode({ x: 420, y: 360 });
  objection.title = "Objection handling";
  objection.subject = "Makes sense";
  objection.body =
    `Makes sense. If timing is the blocker, I can send a concise one-pager on ${campaignGoal} and you can review async.\n\nWould that be more useful?`;
  objection.autoSend = false;
  objection.promptTemplate = buildNodePromptTemplate({
    title: objection.title,
    hint: objection.body,
  });

  const noReply = defaultNode({ x: 780, y: 220 });
  noReply.title = "No-reply nudge";
  noReply.subject = "Should I leave this here?";
  noReply.body =
    `I can leave this here for now, {{firstName}}.\n\nIf someone else at {{company}} owns ${campaignGoal}, feel free to point me in the right direction.`;
  noReply.autoSend = true;
  noReply.delayMinutes = 1440;
  noReply.promptTemplate = buildNodePromptTemplate({
    title: noReply.title,
    hint: noReply.body,
  });

  const end = defaultTerminalNode({ x: 1120, y: 220 });

  return {
    version: 1,
    maxDepth: 5,
    startNodeId: start.id,
    nodes: [start, interest, question, objection, noReply, end],
    edges: [
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: interest.id,
        trigger: "intent",
        intent: "interest",
        waitMinutes: 0,
        confidenceThreshold: 0.65,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: question.id,
        trigger: "intent",
        intent: "question",
        waitMinutes: 0,
        confidenceThreshold: 0.65,
        priority: 2,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: objection.id,
        trigger: "intent",
        intent: "objection",
        waitMinutes: 0,
        confidenceThreshold: 0.7,
        priority: 3,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: end.id,
        trigger: "intent",
        intent: "unsubscribe",
        waitMinutes: 0,
        confidenceThreshold: 0.5,
        priority: 4,
      },
      {
        id: createId("edge"),
        fromNodeId: start.id,
        toNodeId: noReply.id,
        trigger: "timer",
        intent: "",
        waitMinutes: 1440,
        confidenceThreshold: 0,
        priority: 5,
      },
      {
        id: createId("edge"),
        fromNodeId: noReply.id,
        toNodeId: end.id,
        trigger: "timer",
        intent: "",
        waitMinutes: 2880,
        confidenceThreshold: 0,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: interest.id,
        toNodeId: end.id,
        trigger: "fallback",
        intent: "",
        waitMinutes: 0,
        confidenceThreshold: 0,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: question.id,
        toNodeId: end.id,
        trigger: "fallback",
        intent: "",
        waitMinutes: 0,
        confidenceThreshold: 0,
        priority: 1,
      },
      {
        id: createId("edge"),
        fromNodeId: objection.id,
        toNodeId: end.id,
        trigger: "fallback",
        intent: "",
        waitMinutes: 0,
        confidenceThreshold: 0,
        priority: 1,
      },
    ],
    previewLeads: [],
    previewLeadId: "",
    replyTiming: { ...DEFAULT_REPLY_TIMING },
  };
}

function normalizeNode(value: unknown): ConversationFlowNode | null {
  const row = asRecord(value);
  const id = String(row.id ?? "").trim() || createId("node");
  const kind = String(row.kind ?? "message") === "terminal" ? "terminal" : "message";
  const title = String(row.title ?? "").trim() || (kind === "terminal" ? "End" : "Message");
  const copyMode = String(row.copyMode ?? row.copy_mode ?? "").trim() === "legacy_template" ? "legacy_template" : "prompt_v1";
  const promptTemplateRaw = String(row.promptTemplate ?? row.prompt_template ?? "").trim();
  const promptVersion = Math.max(1, Number(row.promptVersion ?? row.prompt_version ?? 1) || 1);
  const promptPolicy = normalizePromptPolicy(row.promptPolicy ?? row.prompt_policy);
  const subject = String(row.subject ?? "").trim();
  const body = String(row.body ?? "").trim();
  const autoSend = Boolean(row.autoSend ?? true);
  const delayMinutes = Math.max(0, Math.min(10080, Number(row.delayMinutes ?? 0) || 0));
  const x = Number(row.x);
  const y = Number(row.y);

  let node: ConversationFlowNode = {
    id,
    kind,
    title,
    copyMode,
    promptTemplate: promptTemplateRaw,
    promptVersion,
    promptPolicy,
    subject,
    body,
    autoSend,
    delayMinutes,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
  node = normalizeMessageNodePromptTemplate(node);
  if (node.kind === "message" && !node.promptTemplate.trim()) {
    node = {
      ...node,
      promptTemplate: buildNodePromptTemplate({
        title: node.title,
        hint: node.body || node.subject,
      }),
    };
  }
  if (node.kind === "message" && !node.promptTemplate.trim()) return null;
  return node;
}

function normalizeEdge(value: unknown): ConversationFlowEdge | null {
  const row = asRecord(value);
  const id = String(row.id ?? "").trim() || createId("edge");
  const fromNodeId = String(row.fromNodeId ?? row.from_node_id ?? "").trim();
  const toNodeId = String(row.toNodeId ?? row.to_node_id ?? "").trim();
  const triggerRaw = String(row.trigger ?? "fallback").trim();
  const trigger = ["intent", "timer", "fallback"].includes(triggerRaw)
    ? (triggerRaw as ConversationFlowEdge["trigger"])
    : "fallback";
  const intentRaw = String(row.intent ?? "").trim();
  const intent = ["question", "interest", "objection", "unsubscribe", "other"].includes(intentRaw)
    ? (intentRaw as ConversationFlowEdge["intent"])
    : "";
  const waitMinutes = Math.max(0, Math.min(10080, Number(row.waitMinutes ?? 0) || 0));
  const confidenceThreshold = clampConfidence(row.confidenceThreshold, 0.7);
  const priority = Math.max(1, Math.min(100, Number(row.priority ?? 1) || 1));

  if (!fromNodeId || !toNodeId) return null;

  return {
    id,
    fromNodeId,
    toNodeId,
    trigger,
    intent,
    waitMinutes,
    confidenceThreshold,
    priority,
  };
}

export function normalizeConversationGraph(
  value: unknown,
  options: { strict?: boolean } = {}
): ConversationFlowGraph {
  const row = asRecord(value);
  const nodes = asArray(row.nodes).map(normalizeNode).filter((item): item is ConversationFlowNode => Boolean(item));
  const nodeIds = new Set(nodes.map((item) => item.id));
  const edges = asArray(row.edges)
    .map(normalizeEdge)
    .filter((item): item is ConversationFlowEdge => Boolean(item))
    .filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId));

  const fallback = defaultConversationGraph();
  const strict = options.strict === true;
  const startNodeIdCandidate = String(row.startNodeId ?? row.start_node_id ?? "").trim();
  const startNodeId = nodeIds.has(startNodeIdCandidate)
    ? startNodeIdCandidate
    : nodes[0]?.id || fallback.startNodeId;
  const maxDepth = Math.max(1, Math.min(5, Number(row.maxDepth ?? fallback.maxDepth) || fallback.maxDepth));
  const { previewLeads, previewLeadId } = normalizePreviewLeads(row);
  const replyTiming = normalizeReplyTiming(row.replyTiming ?? row.reply_timing);

  if (!nodes.length) {
    if (strict) {
      throw new Error("Conversation graph has no valid message nodes");
    }
    return fallback;
  }

  return {
    version: 1,
    maxDepth,
    startNodeId,
    nodes,
    edges,
    previewLeads,
    previewLeadId,
    replyTiming,
  };
}

function mapMapRow(value: unknown): ConversationMap {
  const row = asRecord(value);
  const fallback = defaultConversationGraph();
  return {
    id: String(row.id ?? createId("flow")),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    campaignId: String(row.campaign_id ?? row.campaignId ?? ""),
    experimentId: String(row.experiment_id ?? row.experimentId ?? ""),
    name: String(row.name ?? "Variant Conversation Flow"),
    status: ["draft", "published", "archived"].includes(String(row.status))
      ? (String(row.status) as ConversationMap["status"])
      : "draft",
    draftGraph: row.draft_graph || row.draftGraph ? normalizeConversationGraph(row.draft_graph ?? row.draftGraph) : fallback,
    publishedGraph: row.published_graph || row.publishedGraph ? normalizeConversationGraph(row.published_graph ?? row.publishedGraph) : fallback,
    publishedRevision: Math.max(0, Number(row.published_revision ?? row.publishedRevision ?? 0) || 0),
    publishedAt: String(row.published_at ?? row.publishedAt ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function graphNeedsPromptUpgrade(graphRaw: unknown): boolean {
  const graph = asRecord(graphRaw);
  const nodes = asArray(graph.nodes);
  if (!nodes.length) return false;

  return nodes.some((item) => {
    const row = asRecord(item);
    const kind = String(row.kind ?? "message") === "terminal" ? "terminal" : "message";
    if (kind !== "message") return false;
    const copyMode = String(row.copyMode ?? row.copy_mode ?? "").trim();
    const promptTemplate = String(row.promptTemplate ?? row.prompt_template ?? "").trim();
    const promptPolicy = asRecord(row.promptPolicy ?? row.prompt_policy);
    return (
      copyMode !== "prompt_v1" ||
      !promptTemplate ||
      !Number.isFinite(Number(row.promptVersion ?? row.prompt_version ?? 0)) ||
      !Number.isFinite(Number(promptPolicy.subjectMaxWords ?? NaN)) ||
      !Number.isFinite(Number(promptPolicy.bodyMaxWords ?? NaN))
    );
  });
}

function mapSessionRow(value: unknown): ConversationSession {
  const row = asRecord(value);
  return {
    id: String(row.id ?? createId("session")),
    runId: String(row.run_id ?? row.runId ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    campaignId: String(row.campaign_id ?? row.campaignId ?? ""),
    leadId: String(row.lead_id ?? row.leadId ?? ""),
    mapId: String(row.map_id ?? row.mapId ?? ""),
    mapRevision: Math.max(0, Number(row.map_revision ?? row.mapRevision ?? 0) || 0),
    state: ["active", "waiting_manual", "completed", "failed"].includes(String(row.state))
      ? (String(row.state) as ConversationSession["state"])
      : "active",
    currentNodeId: String(row.current_node_id ?? row.currentNodeId ?? ""),
    turnCount: Math.max(0, Number(row.turn_count ?? row.turnCount ?? 0) || 0),
    lastIntent: ["question", "interest", "objection", "unsubscribe", "other"].includes(String(row.last_intent))
      ? (String(row.last_intent) as ConversationSession["lastIntent"])
      : ["question", "interest", "objection", "unsubscribe", "other"].includes(String(row.lastIntent))
        ? (String(row.lastIntent) as ConversationSession["lastIntent"])
        : "",
    lastConfidence: clampConfidence(row.last_confidence ?? row.lastConfidence, 0),
    lastNodeEnteredAt: String(row.last_node_entered_at ?? row.lastNodeEnteredAt ?? nowIso()),
    endedReason: String(row.ended_reason ?? row.endedReason ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapEventRow(value: unknown): ConversationEvent {
  const row = asRecord(value);
  return {
    id: String(row.id ?? createId("flowevt")),
    sessionId: String(row.session_id ?? row.sessionId ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    eventType: String(row.event_type ?? row.eventType ?? ""),
    payload: asRecord(row.payload),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
  };
}

function defaultStore(): LocalStore {
  return {
    maps: [],
    sessions: [],
    events: [],
  };
}

async function readStore(): Promise<LocalStore> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const row = asRecord(parsed);
    return {
      maps: asArray(row.maps).map((item) => mapMapRow(item)),
      sessions: asArray(row.sessions).map((item) => mapSessionRow(item)),
      events: asArray(row.events).map((item) => mapEventRow(item)),
    };
  } catch {
    return defaultStore();
  }
}

async function writeStore(store: LocalStore) {
  if (!isVercel) {
    await mkdir(`${process.cwd()}/data`, { recursive: true });
  }
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2));
}

function supabaseConfigured() {
  return Boolean(
    process.env.SUPABASE_URL &&
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY)
  );
}

function mapHintForSupabaseError(error: unknown) {
  const row = asRecord(error);
  const message = String(row.message ?? "").toLowerCase();
  if (message.includes("relation") && message.includes("does not exist")) {
    return "Conversation flow tables are missing. Apply the latest supabase/migrations and redeploy.";
  }
  return "Supabase request failed for conversation flow storage.";
}

export async function getConversationMapByExperiment(
  brandId: string,
  campaignId: string,
  experimentId: string
): Promise<ConversationMap | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MAP)
      .select("*")
      .eq("brand_id", brandId)
      .eq("campaign_id", campaignId)
      .eq("experiment_id", experimentId)
      .maybeSingle();

    if (error && isVercel) {
      throw new ConversationFlowDataError("Failed to load conversation map from Supabase.", {
        status: 500,
        hint: mapHintForSupabaseError(error),
        debug: {
          operation: "getConversationMapByExperiment",
          supabaseConfigured: supabaseConfigured(),
          supabaseError: asRecord(error),
        },
      });
    }

    if (!error && data) {
      let mapped = mapMapRow(data);
      const needsDraftUpgrade = graphNeedsPromptUpgrade(data.draft_graph ?? data.draftGraph);
      const needsPublishedUpgrade = graphNeedsPromptUpgrade(data.published_graph ?? data.publishedGraph);
      if (needsDraftUpgrade || needsPublishedUpgrade) {
        const { data: upgraded, error: upgradeError } = await supabase
          .from(TABLE_MAP)
          .update({
            draft_graph: mapped.draftGraph,
            published_graph: mapped.publishedGraph,
            updated_at: nowIso(),
          })
          .eq("id", mapped.id)
          .select("*")
          .maybeSingle();
        if (!upgradeError && upgraded) {
          mapped = mapMapRow(upgraded);
        }
      }
      return mapped;
    }
  }

  const store = await readStore();
  return (
    store.maps.find(
      (item) => item.brandId === brandId && item.campaignId === campaignId && item.experimentId === experimentId
    ) ?? null
  );
}

export async function upsertConversationMapDraft(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
  name?: string;
  draftGraph: unknown;
}): Promise<ConversationMap> {
  const now = nowIso();
  const normalized = normalizeConversationGraph(input.draftGraph);
  const existing = await getConversationMapByExperiment(input.brandId, input.campaignId, input.experimentId);

  const row: ConversationMap = {
    id: existing?.id ?? createId("flow"),
    brandId: input.brandId,
    campaignId: input.campaignId,
    experimentId: input.experimentId,
    name: String(input.name ?? existing?.name ?? "Variant Conversation Flow").trim() || "Variant Conversation Flow",
    status: existing?.status ?? "draft",
    draftGraph: normalized,
    publishedGraph: existing?.publishedGraph ?? normalized,
    publishedRevision: existing?.publishedRevision ?? 0,
    publishedAt: existing?.publishedAt ?? "",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const payload = {
      id: row.id,
      brand_id: row.brandId,
      campaign_id: row.campaignId,
      experiment_id: row.experimentId,
      name: row.name,
      status: row.status,
      draft_graph: row.draftGraph,
      published_graph: row.publishedGraph,
      published_revision: row.publishedRevision,
      published_at: row.publishedAt || null,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };

    const { data, error } = await supabase
      .from(TABLE_MAP)
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .single();

    if (error && isVercel) {
      throw new ConversationFlowDataError("Failed to save conversation map draft to Supabase.", {
        status: 500,
        hint: mapHintForSupabaseError(error),
        debug: {
          operation: "upsertConversationMapDraft",
          supabaseConfigured: supabaseConfigured(),
          supabaseError: asRecord(error),
        },
      });
    }

    if (!error && data) return mapMapRow(data);
  }

  const store = await readStore();
  const idx = store.maps.findIndex((item) => item.id === row.id);
  if (idx >= 0) {
    store.maps[idx] = row;
  } else {
    store.maps.unshift(row);
  }
  await writeStore(store);
  return row;
}

export async function publishConversationMap(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
}): Promise<ConversationMap | null> {
  const existing = await getConversationMapByExperiment(input.brandId, input.campaignId, input.experimentId);
  if (!existing) return null;

  const now = nowIso();
  const next: ConversationMap = {
    ...existing,
    status: "published",
    publishedGraph: existing.draftGraph,
    publishedRevision: existing.publishedRevision + 1,
    publishedAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MAP)
      .update({
        status: next.status,
        published_graph: next.publishedGraph,
        published_revision: next.publishedRevision,
        published_at: next.publishedAt,
        updated_at: next.updatedAt,
      })
      .eq("id", next.id)
      .select("*")
      .single();

    if (error && isVercel) {
      throw new ConversationFlowDataError("Failed to publish conversation map.", {
        status: 500,
        hint: mapHintForSupabaseError(error),
        debug: {
          operation: "publishConversationMap",
          supabaseConfigured: supabaseConfigured(),
          supabaseError: asRecord(error),
        },
      });
    }

    if (!error && data) return mapMapRow(data);
  }

  const store = await readStore();
  const idx = store.maps.findIndex((item) => item.id === next.id);
  if (idx < 0) return null;
  store.maps[idx] = next;
  await writeStore(store);
  return next;
}

export async function getPublishedConversationMapForExperiment(
  brandId: string,
  campaignId: string,
  experimentId: string
): Promise<ConversationMap | null> {
  const row = await getConversationMapByExperiment(brandId, campaignId, experimentId);
  if (!row) return null;
  if (row.status !== "published" || row.publishedRevision <= 0) return null;
  return row;
}

export async function listConversationSessionsByRun(runId: string): Promise<ConversationSession[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SESSION)
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    if (!error) {
      return (data ?? []).map((item: unknown) => mapSessionRow(item));
    }
  }

  const store = await readStore();
  return store.sessions.filter((item) => item.runId === runId);
}

export async function getConversationSessionByLead(input: {
  runId: string;
  leadId: string;
}): Promise<ConversationSession | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SESSION)
      .select("*")
      .eq("run_id", input.runId)
      .eq("lead_id", input.leadId)
      .maybeSingle();
    if (!error && data) {
      return mapSessionRow(data);
    }
  }

  const store = await readStore();
  return store.sessions.find((item) => item.runId === input.runId && item.leadId === input.leadId) ?? null;
}

export async function createConversationSession(input: {
  runId: string;
  brandId: string;
  campaignId: string;
  leadId: string;
  mapId: string;
  mapRevision: number;
  startNodeId: string;
}): Promise<ConversationSession> {
  const now = nowIso();
  const session: ConversationSession = {
    id: createId("session"),
    runId: input.runId,
    brandId: input.brandId,
    campaignId: input.campaignId,
    leadId: input.leadId,
    mapId: input.mapId,
    mapRevision: Math.max(1, Number(input.mapRevision || 1)),
    state: "active",
    currentNodeId: input.startNodeId,
    turnCount: 0,
    lastIntent: "",
    lastConfidence: 0,
    lastNodeEnteredAt: now,
    endedReason: "",
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SESSION)
      .insert({
        id: session.id,
        run_id: session.runId,
        brand_id: session.brandId,
        campaign_id: session.campaignId,
        lead_id: session.leadId,
        map_id: session.mapId,
        map_revision: session.mapRevision,
        state: session.state,
        current_node_id: session.currentNodeId,
        turn_count: session.turnCount,
        last_intent: session.lastIntent,
        last_confidence: session.lastConfidence,
        last_node_entered_at: session.lastNodeEnteredAt,
        ended_reason: session.endedReason,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      })
      .select("*")
      .single();
    if (!error && data) return mapSessionRow(data);
  }

  const store = await readStore();
  store.sessions.push(session);
  await writeStore(store);
  return session;
}

export async function updateConversationSession(
  sessionId: string,
  patch: Partial<
    Pick<
      ConversationSession,
      "state" | "currentNodeId" | "turnCount" | "lastIntent" | "lastConfidence" | "lastNodeEnteredAt" | "endedReason"
    >
  >
): Promise<ConversationSession | null> {
  const now = nowIso();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.state !== undefined) update.state = patch.state;
    if (patch.currentNodeId !== undefined) update.current_node_id = patch.currentNodeId;
    if (patch.turnCount !== undefined) update.turn_count = patch.turnCount;
    if (patch.lastIntent !== undefined) update.last_intent = patch.lastIntent;
    if (patch.lastConfidence !== undefined) update.last_confidence = patch.lastConfidence;
    if (patch.lastNodeEnteredAt !== undefined) update.last_node_entered_at = patch.lastNodeEnteredAt;
    if (patch.endedReason !== undefined) update.ended_reason = patch.endedReason;

    const { data, error } = await supabase
      .from(TABLE_SESSION)
      .update(update)
      .eq("id", sessionId)
      .select("*")
      .maybeSingle();
    if (!error && data) return mapSessionRow(data);
  }

  const store = await readStore();
  const idx = store.sessions.findIndex((item) => item.id === sessionId);
  if (idx < 0) return null;
  store.sessions[idx] = {
    ...store.sessions[idx],
    ...patch,
    updatedAt: now,
  };
  await writeStore(store);
  return store.sessions[idx];
}

export async function createConversationEvent(input: {
  sessionId: string;
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<ConversationEvent> {
  const now = nowIso();
  const event: ConversationEvent = {
    id: createId("flowevt"),
    sessionId: input.sessionId,
    runId: input.runId,
    eventType: input.eventType,
    payload: input.payload,
    createdAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { error } = await supabase.from(TABLE_EVENT).insert({
      id: event.id,
      session_id: event.sessionId,
      run_id: event.runId,
      event_type: event.eventType,
      payload: event.payload,
      created_at: event.createdAt,
    });
    if (!error) {
      return event;
    }
  }

  const store = await readStore();
  store.events.unshift(event);
  await writeStore(store);
  return event;
}

export async function listConversationEventsByRun(runId: string, limit = 200): Promise<ConversationEvent[]> {
  const capped = Math.max(1, Math.min(1000, Number(limit || 200)));
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_EVENT)
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(capped);
    if (!error) {
      return (data ?? []).map((item: unknown) => mapEventRow(item));
    }
  }

  const store = await readStore();
  return store.events.filter((item) => item.runId === runId).slice(0, capped);
}
