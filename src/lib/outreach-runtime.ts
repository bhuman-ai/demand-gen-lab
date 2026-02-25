import {
  defaultExperimentRunPolicy,
  getBrandById,
  getCampaignById,
  updateCampaign,
  type CampaignRecord,
  type Experiment,
  type Hypothesis,
} from "@/lib/factory-data";
import type { ConversationFlowGraph, ConversationFlowNode, ReplyThread } from "@/lib/factory-types";
import {
  createConversationEvent,
  createConversationSession,
  getConversationSessionByLead,
  getPublishedConversationMapForExperiment,
  listConversationSessionsByRun,
  updateConversationSession,
} from "@/lib/conversation-flow-data";
import { getExperimentRecordByRuntimeRef } from "@/lib/experiment-data";
import {
  conversationPromptModeEnabled,
  generateConversationPromptMessage,
  type ConversationPromptRenderContext,
} from "@/lib/conversation-prompt-render";
import {
  createOutreachEvent,
  createOutreachRun,
  createReplyDraft,
  createReplyMessage,
  createReplyThread,
  createRunAnomaly,
  createRunMessages,
  enqueueOutreachJob,
  getBrandOutreachAssignment,
  getOutreachAccount,
  getOutreachAccountSecrets,
  getOutreachRun,
  getReplyDraft,
  getReplyThread,
  listCampaignRuns,
  listDueOutreachJobs,
  listExperimentRuns,
  listReplyThreadsByBrand,
  listRunEvents,
  listRunLeads,
  listRunMessages,
  updateOutreachJob,
  updateOutreachRun,
  updateReplyDraft,
  updateReplyThread,
  updateRunLead,
  updateRunMessage,
  upsertRunLeads,
  type OutreachJob,
} from "@/lib/outreach-data";
import {
  getLeadEmailSuppressionReason,
  sendOutreachMessage,
  sendReplyDraftAsEvent,
  fetchPlatformEmailDiscoveryResults,
  leadsFromEmailDiscoveryRows,
  pollPlatformEmailDiscovery,
  getPlatformEmailDiscoveryActorCandidates,
  runPlatformLeadDomainSearch,
  startPlatformEmailDiscovery,
  sourceLeadsFromApify,
  type ApifyLead,
} from "@/lib/outreach-providers";

const DEFAULT_TIMEZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const CONVERSATION_TICK_MINUTES = 15;

function nowIso() {
  return new Date().toISOString();
}

function toDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0);
  }
  return parsed;
}

function findHypothesis(campaign: CampaignRecord, hypothesisId: string) {
  return campaign.hypotheses.find((item) => item.id === hypothesisId) ?? null;
}

function findExperiment(campaign: CampaignRecord, experimentId: string) {
  return campaign.experiments.find((item) => item.id === experimentId) ?? null;
}

function effectiveSourceConfig(hypothesis: Hypothesis) {
  return {
    actorId: hypothesis.sourceConfig?.actorId?.trim() || "",
    actorInput: hypothesis.sourceConfig?.actorInput ?? {},
    maxLeads: Number(hypothesis.sourceConfig?.maxLeads ?? 100),
  };
}

function platformSourcingToken() {
  return (
    String(process.env.APIFY_TOKEN ?? "").trim() ||
    String(process.env.APIFY_API_TOKEN ?? "").trim() ||
    String(process.env.APIFY_API_KEY ?? "").trim()
  );
}

type ResolvedAccount = NonNullable<Awaited<ReturnType<typeof getOutreachAccount>>>;
type ResolvedSecrets = NonNullable<Awaited<ReturnType<typeof getOutreachAccountSecrets>>>;

function effectiveCustomerIoApiKey(secrets: ResolvedSecrets) {
  return (
    secrets.customerIoApiKey.trim() ||
    secrets.customerIoTrackApiKey.trim() ||
    secrets.customerIoAppApiKey.trim()
  );
}

function effectiveSourcingToken(secrets: ResolvedSecrets) {
  return secrets.apifyToken.trim() || platformSourcingToken();
}

type PlatformActorStats = {
  actorId: string;
  attempts: number;
  successfulRuns: number;
  failedRuns: number;
  sourcedLeads: number;
};

type PlatformActorSelection = {
  ok: boolean;
  actorId: string;
  reason: string;
  candidates: string[];
  stats: PlatformActorStats[];
};

function emptyPlatformActorStats(actorId: string): PlatformActorStats {
  return {
    actorId,
    attempts: 0,
    successfulRuns: 0,
    failedRuns: 0,
    sourcedLeads: 0,
  };
}

function actorStatsFromMap(candidates: string[], map: Map<string, PlatformActorStats>) {
  return candidates.map((actorId) => map.get(actorId) ?? emptyPlatformActorStats(actorId));
}

function pickBestActorFromStats(stats: PlatformActorStats[]): PlatformActorStats | null {
  if (!stats.length) return null;
  const ranked = [...stats].sort((a, b) => {
    const aSuccessRate = a.attempts > 0 ? a.successfulRuns / a.attempts : 0;
    const bSuccessRate = b.attempts > 0 ? b.successfulRuns / b.attempts : 0;
    if (bSuccessRate !== aSuccessRate) return bSuccessRate - aSuccessRate;

    const aAvgSourced = a.successfulRuns > 0 ? a.sourcedLeads / a.successfulRuns : 0;
    const bAvgSourced = b.successfulRuns > 0 ? b.sourcedLeads / b.successfulRuns : 0;
    if (bAvgSourced !== aAvgSourced) return bAvgSourced - aAvgSourced;

    if (a.failedRuns !== b.failedRuns) return a.failedRuns - b.failedRuns;
    if (a.attempts !== b.attempts) return a.attempts - b.attempts;
    return a.actorId.localeCompare(b.actorId);
  });
  return ranked[0] ?? null;
}

async function choosePlatformDiscoveryActor(input: {
  run: { id: string; brandId: string; campaignId: string; experimentId: string };
  candidates: string[];
  preselectedActorId?: string;
}) {
  const candidates = input.candidates.map((item) => item.trim()).filter(Boolean);
  if (!candidates.length) {
    return {
      ok: false,
      actorId: "",
      reason: "No platform discovery actors configured (set PLATFORM_EMAIL_DISCOVERY_ACTOR_ID)",
      candidates: [],
      stats: [],
    } satisfies PlatformActorSelection;
  }

  const preselected = input.preselectedActorId?.trim() ?? "";
  if (preselected) {
    const selected =
      candidates.find((actorId) => actorId.toLowerCase() === preselected.toLowerCase()) ?? preselected;
    return {
      ok: true,
      actorId: selected,
      reason: "selected_from_job_payload",
      candidates,
      stats: candidates.map((actorId) => emptyPlatformActorStats(actorId)),
    } satisfies PlatformActorSelection;
  }

  const statsMap = new Map<string, PlatformActorStats>();
  for (const actorId of candidates) {
    statsMap.set(actorId, emptyPlatformActorStats(actorId));
  }

  const recentRuns = (await listCampaignRuns(input.run.brandId, input.run.campaignId))
    .filter((item) => item.id !== input.run.id && item.experimentId === input.run.experimentId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 20);

  for (const priorRun of recentRuns) {
    const events = await listRunEvents(priorRun.id);
    const actorEvent = events.find((event) => {
      if (event.eventType !== "lead_sourcing_actor_selected") return false;
      const actorId = String((event.payload?.actorId ?? "") as string).trim();
      return Boolean(actorId);
    });
    if (!actorEvent) continue;

    const selectedActorId = String((actorEvent.payload?.actorId ?? "") as string).trim();
    const stats = statsMap.get(selectedActorId);
    if (!stats) continue;
    stats.attempts += 1;

    const sourcedEvent = events.find((event) => event.eventType === "lead_sourced_apify");
    if (sourcedEvent) {
      stats.successfulRuns += 1;
      const count = Math.max(0, Number((sourcedEvent.payload?.count ?? 0) as number) || 0);
      stats.sourcedLeads += count;
      continue;
    }

    const failedEvent = events.find((event) => event.eventType === "lead_sourcing_failed");
    if (failedEvent) {
      stats.failedRuns += 1;
    }
  }

  const stats = actorStatsFromMap(candidates, statsMap);
  const untested = stats.find((item) => item.attempts === 0);
  if (untested) {
    return {
      ok: true,
      actorId: untested.actorId,
      reason: "explore_untested_actor",
      candidates,
      stats,
    } satisfies PlatformActorSelection;
  }

  const best = pickBestActorFromStats(stats);
  if (!best) {
    return {
      ok: true,
      actorId: candidates[0],
      reason: "fallback_first_candidate",
      candidates,
      stats,
    } satisfies PlatformActorSelection;
  }

  return {
    ok: true,
    actorId: best.actorId,
    reason: "exploit_best_historical_actor",
    candidates,
    stats,
  } satisfies PlatformActorSelection;
}

function supportsDelivery(account: ResolvedAccount) {
  return account.accountType !== "mailbox";
}

function supportsMailbox(account: ResolvedAccount) {
  return account.accountType !== "delivery";
}

function preflightReason(input: {
  deliveryAccount: ResolvedAccount;
  deliverySecrets: ResolvedSecrets;
  mailboxAccount: ResolvedAccount;
  mailboxSecrets: ResolvedSecrets;
  hypothesis: Hypothesis;
}) {
  if (!supportsDelivery(input.deliveryAccount)) {
    return "Assigned delivery account does not support outreach sending";
  }
  if (!input.hypothesis.actorQuery.trim()) {
    return "Target Audience is required for lead sourcing";
  }
  if (!effectiveSourcingToken(input.deliverySecrets)) {
    return "Lead sourcing credentials are missing";
  }
  if (
    !input.deliveryAccount.config.customerIo.siteId.trim()
  ) {
    return "Customer.io site config is required";
  }
  if (!effectiveCustomerIoApiKey(input.deliverySecrets)) {
    return "Customer.io API key missing";
  }
  if (!input.deliveryAccount.config.customerIo.fromEmail.trim()) {
    return "Customer.io From Email is required";
  }
  if (!supportsMailbox(input.mailboxAccount)) {
    return "Assigned mailbox account does not support mailbox reply handling";
  }
  if (
    input.mailboxAccount.config.mailbox.status !== "connected" ||
    !input.mailboxAccount.config.mailbox.email.trim()
  ) {
    return "Mailbox must be connected for automated reply triage";
  }
  if (
    !input.mailboxSecrets.mailboxAccessToken.trim() &&
    !input.mailboxSecrets.mailboxPassword.trim()
  ) {
    return "Mailbox credentials missing";
  }
  return "";
}

function preflightDiagnostic(input: {
  reason: string;
  hypothesis: Hypothesis;
  deliverySecrets: ResolvedSecrets;
}) {
  const sourceConfig = effectiveSourceConfig(input.hypothesis);

  const debug = {
    reason: input.reason,
    hypothesisId: input.hypothesis.id,
    hypothesisHasLeadSourceOverride: Boolean(input.hypothesis.sourceConfig?.actorId?.trim()),
    hasResolvedLeadSource: Boolean(sourceConfig.actorId),
    hasLeadSourcingToken: Boolean(effectiveSourcingToken(input.deliverySecrets)),
  } as const;

  if (input.reason === "Lead sourcing credentials are missing") {
    return {
      hint: "Platform lead sourcing credentials are missing in this deployment. This is platform-managed (not per-user).",
      debug,
    };
  }
  return { hint: "", debug };
}

function classifySentiment(body: string): ReplyThread["sentiment"] {
  const normalized = body.toLowerCase();
  if (/(not interested|stop|unsubscribe|remove me|no thanks)/.test(normalized)) {
    return "negative";
  }
  if (/(interested|sounds good|let's talk|book|yes)/.test(normalized)) {
    return "positive";
  }
  return "neutral";
}

function classifyIntent(body: string): ReplyThread["intent"] {
  const normalized = body.toLowerCase();
  if (/(unsubscribe|remove me|stop emailing)/.test(normalized)) {
    return "unsubscribe";
  }
  if (/(price|how much|details|question|what does)/.test(normalized)) {
    return "question";
  }
  if (/(interested|book|call|chat|learn more)/.test(normalized)) {
    return "interest";
  }
  if (/(already|not now|budget|timing|no need)/.test(normalized)) {
    return "objection";
  }
  return "other";
}

function classifyIntentConfidence(body: string): { intent: ReplyThread["intent"]; confidence: number } {
  const intent = classifyIntent(body);
  if (intent === "unsubscribe") return { intent, confidence: 0.95 };
  if (intent === "interest") return { intent, confidence: 0.85 };
  if (intent === "question") return { intent, confidence: 0.82 };
  if (intent === "objection") return { intent, confidence: 0.8 };
  return { intent, confidence: 0.55 };
}

function addMinutes(dateIso: string, minutes: number) {
  const date = new Date(dateIso);
  return new Date(date.getTime() + Math.max(0, minutes) * 60 * 1000).toISOString();
}

function conversationNodeById(graph: ConversationFlowGraph, nodeId: string): ConversationFlowNode | null {
  return graph.nodes.find((node) => node.id === nodeId) ?? null;
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

function renderConversationTemplate(
  template: string,
  vars: {
    firstName: string;
    company: string;
    leadTitle: string;
    brandName: string;
    campaignGoal: string;
    variantName: string;
    replyPreview: string;
    shortAnswer: string;
  }
) {
  return template
    .replaceAll("{{firstName}}", vars.firstName)
    .replaceAll("{{company}}", vars.company)
    .replaceAll("{{leadTitle}}", vars.leadTitle)
    .replaceAll("{{brandName}}", vars.brandName)
    .replaceAll("{{campaignGoal}}", vars.campaignGoal)
    .replaceAll("{{variantName}}", vars.variantName)
    .replaceAll("{{replyPreview}}", vars.replyPreview)
    .replaceAll("{{shortAnswer}}", vars.shortAnswer);
}

function hasUnresolvedTemplateToken(text: string) {
  return /{{\s*[^}]+\s*}}/.test(text);
}

function normalizeWhitespace(text: string) {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\?/g, "?")
    .replace(/\s+\./g, ".")
    .trim();
}

function firstNameFromLead(leadName: string) {
  const token = leadName.trim().split(/\s+/)[0] ?? "";
  return token || "there";
}

function effectiveCampaignGoal(goal: string, variantName: string) {
  const trimmedGoal = goal.trim();
  if (trimmedGoal) return trimmedGoal;
  const trimmedVariant = variantName.trim();
  if (trimmedVariant) return trimmedVariant;
  return "outbound pipeline performance";
}

function clampConfidenceValue(value: unknown, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function renderConversationNode(input: {
  node: ConversationFlowNode;
  leadName: string;
  leadCompany?: string;
  leadTitle?: string;
  brandName: string;
  campaignGoal: string;
  variantName: string;
  replyPreview?: string;
}) {
  const subjectTemplate = input.node.subject.trim();
  const bodyTemplate = input.node.body.trim();
  if (!subjectTemplate) {
    return {
      ok: false as const,
      reason: "Conversation node subject is empty",
      subject: "",
      body: "",
    };
  }
  if (!bodyTemplate) {
    return {
      ok: false as const,
      reason: "Conversation node body is empty",
      subject: "",
      body: "",
    };
  }

  const firstName = firstNameFromLead(input.leadName);
  const company = input.leadCompany?.trim() || "your team";
  const leadTitle = input.leadTitle?.trim() || "your role";
  const replyPreview = input.replyPreview?.trim() ?? "";
  const shortAnswer = replyPreview.split(/\n+/)[0]?.slice(0, 180) || "happy to share the exact details";
  const vars = {
    firstName,
    company,
    leadTitle,
    brandName: input.brandName.trim(),
    campaignGoal: effectiveCampaignGoal(input.campaignGoal, input.variantName),
    variantName: input.variantName.trim(),
    replyPreview,
    shortAnswer,
  };

  const subject = normalizeWhitespace(renderConversationTemplate(subjectTemplate, vars));
  const body = normalizeWhitespace(renderConversationTemplate(bodyTemplate, vars));
  if (!subject) {
    return {
      ok: false as const,
      reason: "Conversation node subject rendered empty",
      subject: "",
      body: "",
    };
  }
  if (!body) {
    return {
      ok: false as const,
      reason: "Conversation node body rendered empty",
      subject: "",
      body: "",
    };
  }
  if (hasUnresolvedTemplateToken(subject) || hasUnresolvedTemplateToken(body)) {
    return {
      ok: false as const,
      reason: "Conversation node contains unresolved template tokens",
      subject: "",
      body: "",
    };
  }

  return {
    ok: true as const,
    reason: "",
    subject,
    body,
  };
}

function parseOfferAndCta(rawOffer: string) {
  const text = String(rawOffer ?? "").trim();
  if (!text) return { offer: "", cta: "" };
  const ctaMatch = text.match(/\bCTA\s*:\s*([^\n]+)/i);
  const cta = ctaMatch ? ctaMatch[1].trim() : "";
  const offer = text.replace(/\bCTA\s*:\s*[^\n]+/gi, "").replace(/\s{2,}/g, " ").trim();
  return { offer, cta };
}

function buildConversationPromptContext(input: {
  run: {
    id: string;
    brandId: string;
    campaignId: string;
    dailyCap: number;
    hourlyCap: number;
    minSpacingMinutes: number;
    timezone: string;
  };
  lead: { id: string; email: string; name: string; status: string; company?: string; title?: string; domain?: string };
  sessionId: string;
  nodeId: string;
  parentMessageId?: string;
  brandName: string;
  brandWebsite?: string;
  brandTone?: string;
  brandNotes?: string;
  campaignName?: string;
  campaignGoal: string;
  campaignConstraints?: string;
  variantId?: string;
  variantName: string;
  experimentOffer?: string;
  experimentCta?: string;
  experimentAudience?: string;
  experimentNotes?: string;
  latestInboundSubject?: string;
  latestInboundBody?: string;
  intent?: ReplyThread["intent"] | "";
  intentConfidence?: number;
  priorNodePath?: string[];
  maxDepth?: number;
}): ConversationPromptRenderContext {
  return {
    brand: {
      id: input.run.brandId,
      name: input.brandName.trim(),
      website: String(input.brandWebsite ?? "").trim(),
      tone: String(input.brandTone ?? "").trim(),
      notes: String(input.brandNotes ?? "").trim(),
    },
    campaign: {
      id: input.run.campaignId,
      name: String(input.campaignName ?? "").trim(),
      objectiveGoal: effectiveCampaignGoal(input.campaignGoal, input.variantName),
      objectiveConstraints: String(input.campaignConstraints ?? "").trim(),
    },
    experiment: {
      id: String(input.variantId ?? "").trim(),
      name: input.variantName.trim(),
      offer: String(input.experimentOffer ?? "").trim(),
      cta: String(input.experimentCta ?? "").trim(),
      audience: String(input.experimentAudience ?? "").trim(),
      notes: String(input.experimentNotes ?? "").trim(),
    },
    lead: {
      id: input.lead.id,
      email: input.lead.email.trim(),
      name: input.lead.name.trim(),
      company: String(input.lead.company ?? "").trim(),
      title: String(input.lead.title ?? "").trim(),
      domain: String(input.lead.domain ?? input.lead.email.split("@")[1] ?? "").trim().toLowerCase(),
      status: input.lead.status,
    },
    thread: {
      sessionId: input.sessionId,
      nodeId: input.nodeId,
      parentMessageId: String(input.parentMessageId ?? "").trim(),
      latestInboundSubject: String(input.latestInboundSubject ?? "").trim(),
      latestInboundBody: String(input.latestInboundBody ?? "").trim(),
      intent: input.intent ?? "",
      confidence: clampConfidenceValue(input.intentConfidence ?? 0, 0),
      priorNodePath: Array.isArray(input.priorNodePath)
        ? input.priorNodePath.map((value) => String(value ?? "").trim()).filter(Boolean)
        : [],
    },
    safety: {
      maxDepth: Math.max(1, Math.min(12, Number(input.maxDepth ?? 5) || 5)),
      dailyCap: Math.max(1, Number(input.run.dailyCap || 30)),
      hourlyCap: Math.max(1, Number(input.run.hourlyCap || 6)),
      minSpacingMinutes: Math.max(1, Number(input.run.minSpacingMinutes || 8)),
      timezone: input.run.timezone || DEFAULT_TIMEZONE,
    },
  };
}

async function generateConversationNodeContent(input: {
  node: ConversationFlowNode;
  run: {
    id: string;
    brandId: string;
    campaignId: string;
    dailyCap: number;
    hourlyCap: number;
    minSpacingMinutes: number;
    timezone: string;
  };
  lead: { id: string; email: string; name: string; status: string; company?: string; title?: string; domain?: string };
  sessionId: string;
  parentMessageId?: string;
  brandName: string;
  brandWebsite?: string;
  brandTone?: string;
  brandNotes?: string;
  campaignName?: string;
  campaignGoal: string;
  campaignConstraints?: string;
  variantId?: string;
  variantName: string;
  experimentOffer?: string;
  experimentCta?: string;
  experimentAudience?: string;
  experimentNotes?: string;
  latestInboundSubject?: string;
  latestInboundBody?: string;
  intent?: ReplyThread["intent"] | "";
  intentConfidence?: number;
  priorNodePath?: string[];
  maxDepth?: number;
}): Promise<
  | { ok: true; subject: string; body: string; trace: Record<string, unknown> }
  | { ok: false; reason: string; trace: Record<string, unknown> }
> {
  if (conversationPromptModeEnabled()) {
    if (input.node.copyMode !== "prompt_v1") {
      return {
        ok: false,
        reason: "Conversation node must use prompt mode",
        trace: {
          mode: "prompt_v1",
          validation: { passed: false, reason: "node_copy_mode_invalid" },
        },
      };
    }

    const promptContext = buildConversationPromptContext({
      run: input.run,
      lead: input.lead,
      sessionId: input.sessionId,
      nodeId: input.node.id,
      parentMessageId: input.parentMessageId,
      brandName: input.brandName,
      brandWebsite: input.brandWebsite,
      brandTone: input.brandTone,
      brandNotes: input.brandNotes,
      campaignName: input.campaignName,
      campaignGoal: input.campaignGoal,
      campaignConstraints: input.campaignConstraints,
      variantId: input.variantId,
      variantName: input.variantName,
      experimentOffer: input.experimentOffer,
      experimentCta: input.experimentCta,
      experimentAudience: input.experimentAudience,
      experimentNotes: input.experimentNotes,
      latestInboundSubject: input.latestInboundSubject,
      latestInboundBody: input.latestInboundBody,
      intent: input.intent,
      intentConfidence: input.intentConfidence,
      priorNodePath: input.priorNodePath,
      maxDepth: input.maxDepth,
    });

    const generated = await generateConversationPromptMessage({
      node: input.node,
      context: promptContext,
    });
    if (!generated.ok) {
      return {
        ok: false,
        reason: generated.reason,
        trace: generated.trace,
      };
    }
    return {
      ok: true,
      subject: generated.subject,
      body: generated.body,
      trace: generated.trace,
    };
  }

  const rendered = renderConversationNode({
    node: input.node,
    leadName: input.lead.name,
    leadCompany: input.lead.company ?? "",
    leadTitle: input.lead.title ?? "",
    brandName: input.brandName,
    campaignGoal: input.campaignGoal,
    variantName: input.variantName,
    replyPreview: input.latestInboundBody,
  });
  if (!rendered.ok) {
    return {
      ok: false,
      reason: rendered.reason,
      trace: {
        mode: "legacy_template",
        validation: { passed: false, reason: rendered.reason },
      },
    };
  }
  return {
    ok: true,
    subject: rendered.subject,
    body: rendered.body,
    trace: {
      mode: "legacy_template",
      validation: { passed: true, reason: "" },
    },
  };
}

function addHours(dateIso: string, hours: number) {
  const date = new Date(dateIso);
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

async function failRunWithDiagnostics(input: {
  run: { id: string; brandId: string; campaignId: string; experimentId: string };
  reason: string;
  eventType?: string;
  payload?: Record<string, unknown>;
}) {
  await updateOutreachRun(input.run.id, { status: "failed", lastError: input.reason });
  await markExperimentExecutionStatus(input.run.brandId, input.run.campaignId, input.run.experimentId, "failed");
  await createOutreachEvent({
    runId: input.run.id,
    eventType: input.eventType ?? "run_failed",
    payload: {
      reason: input.reason,
      ...(input.payload ?? {}),
    },
  });
}

function calculateRunMetricsFromMessages(
  runId: string,
  messages: Awaited<ReturnType<typeof listRunMessages>>,
  threads: ReplyThread[]
) {
  const runMessages = messages.filter((item) => item.runId === runId);
  const sentMessages = runMessages.filter((item) => item.status === "sent").length;
  const bouncedMessages = runMessages.filter((item) => item.status === "bounced").length;
  const failedMessages = runMessages.filter((item) => item.status === "failed").length;
  const replies = threads.filter((item) => item.runId === runId).length;
  const positiveReplies = threads.filter(
    (item) => item.runId === runId && item.sentiment === "positive"
  ).length;
  const negativeReplies = threads.filter(
    (item) => item.runId === runId && item.sentiment === "negative"
  ).length;

  return {
    sentMessages,
    bouncedMessages,
    failedMessages,
    replies,
    positiveReplies,
    negativeReplies,
  };
}

async function scheduleConversationNodeMessage(input: {
  run: {
    id: string;
    brandId: string;
    campaignId: string;
    dailyCap: number;
    hourlyCap: number;
    minSpacingMinutes: number;
    timezone: string;
  };
  lead: { id: string; email: string; name: string; status: string; company?: string; title?: string; domain?: string };
  sessionId: string;
  node: ConversationFlowNode;
  step: number;
  parentMessageId?: string;
  brandName: string;
  brandWebsite?: string;
  brandTone?: string;
  brandNotes?: string;
  campaignName?: string;
  campaignGoal: string;
  campaignConstraints?: string;
  variantId?: string;
  variantName: string;
  experimentOffer?: string;
  experimentCta?: string;
  experimentAudience?: string;
  experimentNotes?: string;
  intent?: ReplyThread["intent"] | "";
  intentConfidence?: number;
  priorNodePath?: string[];
  maxDepth?: number;
  waitMinutes?: number;
  latestInboundSubject?: string;
  latestInboundBody?: string;
  existingMessages: Awaited<ReturnType<typeof listRunMessages>>;
}): Promise<{ ok: boolean; reason: string; messageId: string }> {
  if (input.node.kind !== "message") {
    return { ok: false, reason: "Node is not a valid message node", messageId: "" };
  }
  if (!input.lead.email.trim()) {
    return { ok: false, reason: "Lead email is empty", messageId: "" };
  }
  if (["unsubscribed", "bounced", "suppressed"].includes(input.lead.status)) {
    return { ok: false, reason: "Lead is suppressed for outreach", messageId: "" };
  }

  const alreadyExists = input.existingMessages.some(
    (message) =>
      message.sessionId === input.sessionId &&
      message.nodeId === input.node.id &&
      ["scheduled", "sent"].includes(message.status)
  );
  if (alreadyExists) {
    return { ok: false, reason: "Message already scheduled for this node", messageId: "" };
  }

  const composed = await generateConversationNodeContent({
    node: input.node,
    run: input.run,
    lead: input.lead,
    sessionId: input.sessionId,
    parentMessageId: input.parentMessageId,
    brandName: input.brandName,
    brandWebsite: input.brandWebsite,
    brandTone: input.brandTone,
    brandNotes: input.brandNotes,
    campaignName: input.campaignName,
    campaignGoal: input.campaignGoal,
    campaignConstraints: input.campaignConstraints,
    variantId: input.variantId,
    variantName: input.variantName,
    experimentOffer: input.experimentOffer,
    experimentCta: input.experimentCta,
    experimentAudience: input.experimentAudience,
    experimentNotes: input.experimentNotes,
    latestInboundSubject: input.latestInboundSubject,
    latestInboundBody: input.latestInboundBody,
    intent: input.intent,
    intentConfidence: input.intentConfidence,
    priorNodePath: input.priorNodePath,
    maxDepth: input.maxDepth,
  });
  if (!composed.ok) {
    const failedRows = await createRunMessages([
      {
        runId: input.run.id,
        brandId: input.run.brandId,
        campaignId: input.run.campaignId,
        leadId: input.lead.id,
        step: Math.max(1, input.step),
        subject: "",
        body: "",
        status: "failed",
        scheduledAt: nowIso(),
        sourceType: "conversation",
        sessionId: input.sessionId,
        nodeId: input.node.id,
        parentMessageId: input.parentMessageId ?? "",
        lastError: composed.reason,
        generationMeta: composed.trace,
      },
    ]);
    const failedMessageId = failedRows[0]?.id ?? "";
    if (failedRows[0]) {
      input.existingMessages.push(failedRows[0]);
    }
    await createConversationEvent({
      sessionId: input.sessionId,
      runId: input.run.id,
      eventType: "conversation_prompt_rejected",
      payload: {
        nodeId: input.node.id,
        reason: composed.reason,
        messageId: failedMessageId,
        trace: composed.trace,
      },
    });
    await createOutreachEvent({
      runId: input.run.id,
      eventType: "conversation_prompt_rejected",
      payload: {
        nodeId: input.node.id,
        reason: composed.reason,
        messageId: failedMessageId,
      },
    });
    await createOutreachEvent({
      runId: input.run.id,
      eventType: "conversation_prompt_failed",
      payload: {
        nodeId: input.node.id,
        reason: composed.reason,
        messageId: failedMessageId,
      },
    });
    return { ok: false, reason: composed.reason, messageId: failedMessageId };
  }

  const totalDelay = Math.max(0, input.node.delayMinutes + (input.waitMinutes ?? 0));
  const created = await createRunMessages([
    {
      runId: input.run.id,
      brandId: input.run.brandId,
      campaignId: input.run.campaignId,
      leadId: input.lead.id,
      step: Math.max(1, input.step),
      subject: composed.subject,
      body: composed.body,
      status: "scheduled",
      scheduledAt: addMinutes(nowIso(), totalDelay),
      sourceType: "conversation",
      sessionId: input.sessionId,
      nodeId: input.node.id,
      parentMessageId: input.parentMessageId ?? "",
      generationMeta: composed.trace,
    },
  ]);
  if (!created.length) {
    return { ok: false, reason: "Failed to persist scheduled message", messageId: "" };
  }

  input.existingMessages.push(created[0]);
  await updateRunLead(input.lead.id, { status: "scheduled" });
  await createConversationEvent({
    sessionId: input.sessionId,
    runId: input.run.id,
    eventType: "conversation_prompt_generated",
    payload: {
      nodeId: input.node.id,
      messageId: created[0].id,
      trace: composed.trace,
    },
  });
  await createOutreachEvent({
    runId: input.run.id,
    eventType: "conversation_prompt_generated",
    payload: {
      nodeId: input.node.id,
      messageId: created[0].id,
    },
  });
  return { ok: true, reason: "", messageId: created[0].id };
}

async function ensureBrandAccount(brandId: string): Promise<{
  ok: boolean;
  reason: string;
  accountId: string;
  mailboxAccountId?: string;
  deliveryAccount?: ResolvedAccount;
  deliverySecrets?: ResolvedSecrets;
  mailboxAccount?: ResolvedAccount;
  mailboxSecrets?: ResolvedSecrets;
}> {
  const assignment = await getBrandOutreachAssignment(brandId);
  if (!assignment || !assignment.accountId.trim()) {
    return { ok: false, reason: "No outreach delivery account assigned to brand", accountId: "" };
  }

  const deliveryAccount = await getOutreachAccount(assignment.accountId);
  if (!deliveryAccount || deliveryAccount.status !== "active") {
    return {
      ok: false,
      reason: "Assigned outreach delivery account is missing or inactive",
      accountId: assignment.accountId,
    };
  }

  const deliverySecrets = await getOutreachAccountSecrets(deliveryAccount.id);
  if (!deliverySecrets) {
    return {
      ok: false,
      reason: "Assigned delivery account credentials are missing",
      accountId: assignment.accountId,
    };
  }

  const mailboxAccountId = assignment.mailboxAccountId || assignment.accountId;
  const mailboxAccount =
    mailboxAccountId === deliveryAccount.id
      ? deliveryAccount
      : await getOutreachAccount(mailboxAccountId);
  if (!mailboxAccount || mailboxAccount.status !== "active") {
    return {
      ok: false,
      reason: "Assigned mailbox account is missing or inactive",
      accountId: assignment.accountId,
    };
  }

  const mailboxSecrets =
    mailboxAccount.id === deliveryAccount.id
      ? deliverySecrets
      : await getOutreachAccountSecrets(mailboxAccount.id);
  if (!mailboxSecrets) {
    return {
      ok: false,
      reason: "Assigned mailbox account credentials are missing",
      accountId: assignment.accountId,
    };
  }

  return {
    ok: true,
    reason: "",
    accountId: assignment.accountId,
    mailboxAccountId,
    deliveryAccount,
    deliverySecrets,
    mailboxAccount,
    mailboxSecrets,
  };
}

async function resolveMailboxAccountForRun(run: { brandId: string; accountId: string }) {
  const assignment = await getBrandOutreachAssignment(run.brandId);
  const mailboxAccountId = assignment?.mailboxAccountId || assignment?.accountId || run.accountId;
  const account = await getOutreachAccount(mailboxAccountId);
  if (!account || account.status !== "active" || !supportsMailbox(account)) {
    return null;
  }
  const secrets = await getOutreachAccountSecrets(mailboxAccountId);
  if (!secrets) {
    return null;
  }
  return { account, secrets };
}

async function markExperimentExecutionStatus(
  brandId: string,
  campaignId: string,
  experimentId: string,
  executionStatus: Experiment["executionStatus"]
) {
  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) return;
  const nextExperiments = campaign.experiments.map((experiment) =>
    experiment.id === experimentId ? { ...experiment, executionStatus } : experiment
  );
  await updateCampaign(brandId, campaignId, { experiments: nextExperiments });
}

async function createDefaultExperimentForHypothesis(
  brandId: string,
  campaignId: string,
  hypothesis: Hypothesis
): Promise<Experiment | null> {
  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) return null;

  const experiment: Experiment = {
    id: `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    hypothesisId: hypothesis.id,
    name: `${hypothesis.title} / Autopilot`,
    status: "testing",
    notes: "Auto-created from approved hypothesis for outreach autopilot.",
    runPolicy: defaultExperimentRunPolicy(),
    executionStatus: "idle",
  };

  await updateCampaign(brandId, campaignId, {
    experiments: [experiment, ...campaign.experiments],
  });

  return experiment;
}

export async function launchExperimentRun(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
  trigger: "manual" | "hypothesis_approved";
  ownerType?: "experiment" | "campaign";
  ownerId?: string;
}): Promise<{
  ok: boolean;
  runId: string;
  reason: string;
  hint?: string;
  debug?: Record<string, unknown>;
}> {
  const campaign = await getCampaignById(input.brandId, input.campaignId);
  if (!campaign) {
    return { ok: false, runId: "", reason: "Campaign not found" };
  }

  const experiment = findExperiment(campaign, input.experimentId);
  if (!experiment) {
    return { ok: false, runId: "", reason: "Experiment not found" };
  }

  const hypothesis = findHypothesis(campaign, experiment.hypothesisId);
  if (!hypothesis) {
    return { ok: false, runId: "", reason: "Linked hypothesis not found" };
  }

  if (hypothesis.status !== "approved" && input.trigger !== "manual") {
    return { ok: false, runId: "", reason: "Hypothesis must be approved before auto-run" };
  }

  const activeRuns = await listExperimentRuns(input.brandId, input.campaignId, experiment.id);
  const openRun =
    activeRuns.find((run) => ["queued", "sourcing", "scheduled", "sending", "monitoring", "paused"].includes(run.status)) ??
    null;
  if (openRun) {
    return {
      ok: false,
      runId: openRun.id,
      reason: "Experiment already has an active run",
      hint: `Active run ${openRun.id.slice(-6)} is ${openRun.status}. Pause/cancel it to restart.`,
    };
  }

  const brandAccount = await ensureBrandAccount(input.brandId);
  if (
    !brandAccount.ok ||
    !brandAccount.deliveryAccount ||
    !brandAccount.deliverySecrets ||
    !brandAccount.mailboxAccount ||
    !brandAccount.mailboxSecrets
  ) {
    const failed = await createOutreachRun({
      brandId: input.brandId,
      campaignId: input.campaignId,
      experimentId: experiment.id,
      hypothesisId: hypothesis.id,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      accountId: brandAccount.accountId || "",
      status: "preflight_failed",
      dailyCap: experiment.runPolicy?.dailyCap ?? 30,
      hourlyCap: experiment.runPolicy?.hourlyCap ?? 6,
      timezone: experiment.runPolicy?.timezone || DEFAULT_TIMEZONE,
      minSpacingMinutes: experiment.runPolicy?.minSpacingMinutes ?? 8,
      lastError: brandAccount.reason,
    });
    await markExperimentExecutionStatus(input.brandId, input.campaignId, experiment.id, "failed");
    await createOutreachEvent({
      runId: failed.id,
      eventType: "hypothesis_approved_auto_run_queued",
      payload: { trigger: input.trigger, outcome: "preflight_failed", reason: brandAccount.reason },
    });
    return { ok: false, runId: failed.id, reason: brandAccount.reason };
  }

  const reason = preflightReason({
    deliveryAccount: brandAccount.deliveryAccount,
    deliverySecrets: brandAccount.deliverySecrets,
    mailboxAccount: brandAccount.mailboxAccount,
    mailboxSecrets: brandAccount.mailboxSecrets,
    hypothesis,
  });
  if (reason) {
    const diagnostic = preflightDiagnostic({
      reason,
      hypothesis,
      deliverySecrets: brandAccount.deliverySecrets,
    });
    const failed = await createOutreachRun({
      brandId: input.brandId,
      campaignId: input.campaignId,
      experimentId: experiment.id,
      hypothesisId: hypothesis.id,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      accountId: brandAccount.deliveryAccount.id,
      status: "preflight_failed",
      dailyCap: experiment.runPolicy?.dailyCap ?? 30,
      hourlyCap: experiment.runPolicy?.hourlyCap ?? 6,
      timezone: experiment.runPolicy?.timezone || DEFAULT_TIMEZONE,
      minSpacingMinutes: experiment.runPolicy?.minSpacingMinutes ?? 8,
      lastError: reason,
    });
    await markExperimentExecutionStatus(input.brandId, input.campaignId, experiment.id, "failed");
    await createOutreachEvent({
      runId: failed.id,
      eventType: "hypothesis_approved_auto_run_queued",
      payload: { trigger: input.trigger, outcome: "preflight_failed", reason },
    });
    return {
      ok: false,
      runId: failed.id,
      reason,
      hint: diagnostic.hint,
      debug: diagnostic.debug,
    };
  }

  const publishedFlowMap = await getPublishedConversationMapForExperiment(
    input.brandId,
    input.campaignId,
    experiment.id
  );
  const flowStartNode = publishedFlowMap
    ? conversationNodeById(publishedFlowMap.publishedGraph, publishedFlowMap.publishedGraph.startNodeId)
    : null;
  const conversationPreflightReason =
    !publishedFlowMap || !publishedFlowMap.publishedRevision
      ? "No published conversation map for this variant"
      : !flowStartNode
        ? "Conversation map start node is invalid"
        : flowStartNode.kind !== "message"
          ? "Conversation map start node must be a message"
          : !flowStartNode.autoSend
            ? "Conversation map start node must auto-send to start outreach"
            : !flowStartNode.promptTemplate.trim()
              ? "Conversation map start prompt is empty"
              : "";

  if (conversationPreflightReason) {
    const failed = await createOutreachRun({
      brandId: input.brandId,
      campaignId: input.campaignId,
      experimentId: experiment.id,
      hypothesisId: hypothesis.id,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      accountId: brandAccount.deliveryAccount.id,
      status: "preflight_failed",
      dailyCap: experiment.runPolicy?.dailyCap ?? 30,
      hourlyCap: experiment.runPolicy?.hourlyCap ?? 6,
      timezone: experiment.runPolicy?.timezone || DEFAULT_TIMEZONE,
      minSpacingMinutes: experiment.runPolicy?.minSpacingMinutes ?? 8,
      lastError: conversationPreflightReason,
    });
    await markExperimentExecutionStatus(input.brandId, input.campaignId, experiment.id, "failed");
    await createOutreachEvent({
      runId: failed.id,
      eventType: "hypothesis_approved_auto_run_queued",
      payload: {
        trigger: input.trigger,
        outcome: "preflight_failed",
        reason: conversationPreflightReason,
        hasPublishedConversationMap: Boolean(publishedFlowMap?.publishedRevision),
      },
    });
    return {
      ok: false,
      runId: failed.id,
      reason: conversationPreflightReason,
      hint: "Open Build > Conversation Map, publish a valid start message, then relaunch.",
      debug: {
        hasPublishedConversationMap: Boolean(publishedFlowMap?.publishedRevision),
        hasStartNode: Boolean(flowStartNode),
        startNodeKind: flowStartNode?.kind ?? "",
        startNodeAutoSend: Boolean(flowStartNode?.autoSend),
        startNodeHasPrompt: Boolean(flowStartNode?.promptTemplate?.trim()),
      },
    };
  }

  const run = await createOutreachRun({
    brandId: input.brandId,
    campaignId: input.campaignId,
    experimentId: experiment.id,
    hypothesisId: hypothesis.id,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    accountId: brandAccount.deliveryAccount.id,
    status: "queued",
    dailyCap: experiment.runPolicy?.dailyCap ?? 30,
    hourlyCap: experiment.runPolicy?.hourlyCap ?? 6,
    timezone: experiment.runPolicy?.timezone || DEFAULT_TIMEZONE,
    minSpacingMinutes: experiment.runPolicy?.minSpacingMinutes ?? 8,
  });

  await enqueueOutreachJob({
    runId: run.id,
    jobType: "source_leads",
    executeAfter: nowIso(),
  });
  await markExperimentExecutionStatus(input.brandId, input.campaignId, experiment.id, "queued");
  await createOutreachEvent({
    runId: run.id,
    eventType: "hypothesis_approved_auto_run_queued",
    payload: { trigger: input.trigger },
  });

  return { ok: true, runId: run.id, reason: "Run queued" };
}

export async function autoQueueApprovedHypothesisRuns(input: {
  brandId: string;
  campaignId: string;
  previous: CampaignRecord;
  next: CampaignRecord;
}): Promise<void> {
  const transitions = input.next.hypotheses.filter((nextHypothesis) => {
    if (nextHypothesis.status !== "approved") return false;
    const previousHypothesis = input.previous.hypotheses.find((item) => item.id === nextHypothesis.id);
    return previousHypothesis?.status !== "approved";
  });

  if (!transitions.length) return;

  for (const hypothesis of transitions) {
    let campaign = await getCampaignById(input.brandId, input.campaignId);
    if (!campaign) continue;

    let relatedExperiments = campaign.experiments.filter((experiment) => experiment.hypothesisId === hypothesis.id);
    if (!relatedExperiments.length) {
      const created = await createDefaultExperimentForHypothesis(input.brandId, input.campaignId, hypothesis);
      if (created) {
        relatedExperiments = [created];
      }
    }

    campaign = await getCampaignById(input.brandId, input.campaignId);
    if (!campaign) continue;
    relatedExperiments = campaign.experiments.filter((experiment) => experiment.hypothesisId === hypothesis.id);

    for (const experiment of relatedExperiments) {
      await launchExperimentRun({
        brandId: input.brandId,
        campaignId: input.campaignId,
        experimentId: experiment.id,
        trigger: "hypothesis_approved",
      });
    }
  }
}

async function processSourceLeadsJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (!["queued", "sourcing"].includes(run.status)) {
    return;
  }

  const existingLeads = await listRunLeads(run.id);
  if (existingLeads.length) {
    await updateOutreachRun(run.id, {
      status: run.status === "queued" || run.status === "sourcing" ? "scheduled" : run.status,
      lastError: "",
      metrics: {
        ...run.metrics,
        sourcedLeads: existingLeads.length,
      },
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_skipped",
      payload: { reason: "leads_already_present", count: existingLeads.length },
    });
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "schedule_messages",
      executeAfter: nowIso(),
    });
    return;
  }

  const campaign = await getCampaignById(run.brandId, run.campaignId);
  if (!campaign) {
    await failRunWithDiagnostics({
      run,
      reason: "Campaign not found",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  const hypothesis = findHypothesis(campaign, run.hypothesisId);
  const experiment = findExperiment(campaign, run.experimentId);
  if (!hypothesis || !experiment) {
    await failRunWithDiagnostics({
      run,
      reason: "Hypothesis or experiment missing",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  const account = await getOutreachAccount(run.accountId);
  const secrets = await getOutreachAccountSecrets(run.accountId);
  if (!account || !secrets) {
    await failRunWithDiagnostics({
      run,
      reason: "Outreach account missing",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) ? job.payload : {};
  const stage = String((payload as Record<string, unknown>).stage ?? "").trim();
  const selectedActorIdFromPayload = String((payload as Record<string, unknown>).selectedActorId ?? "").trim();

  const sourceConfig = effectiveSourceConfig(hypothesis);
  const sourcingToken = effectiveSourcingToken(secrets);
  const maxLeads = Math.max(1, Math.min(500, Number(sourceConfig.maxLeads ?? 100)));
  const targetAudience = hypothesis.actorQuery.trim();
  const platformActorCandidates = getPlatformEmailDiscoveryActorCandidates();

  const brand = await getBrandById(run.brandId);
  const excludeDomains: string[] = [];
  if (brand?.website) {
    try {
      excludeDomains.push(new URL(brand.website).hostname.replace(/^www\./, "").toLowerCase());
    } catch {
      // ignore invalid
    }
  }

  if (run.status === "queued") {
    await updateOutreachRun(run.id, { status: "sourcing", lastError: "" });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "sourcing");
    await createOutreachEvent({ runId: run.id, eventType: "run_started", payload: {} });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_requested",
      payload: {
        strategy: sourceConfig.actorId ? "custom_actor" : "platform_search_then_email_discovery",
        maxLeads,
        actorCandidates: sourceConfig.actorId ? [sourceConfig.actorId] : platformActorCandidates,
      },
    });
  }

  // Custom override: for backward compatibility (not exposed in UI).
  if (sourceConfig.actorId.trim()) {
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_actor_selected",
      payload: {
        actorId: sourceConfig.actorId,
        reason: "hypothesis_override",
      },
    });

    const sourced = await sourceLeadsFromApify({
      actorId: sourceConfig.actorId,
      actorInput: sourceConfig.actorInput,
      maxLeads,
      token: sourcingToken,
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_completed",
      payload: {
        sourcedCount: sourced.length,
        strategy: "custom_actor",
        actorId: sourceConfig.actorId,
      },
    });

    if (!sourced.length) {
      await failRunWithDiagnostics({
        run,
        reason: "No leads sourced",
        eventType: "lead_sourcing_failed",
        payload: {
          sourcedCount: 0,
          maxLeads,
        },
      });
      return;
    }

    await finishSourcingWithLeads(run, sourced);
    return;
  }

  if (!targetAudience) {
    await failRunWithDiagnostics({
      run,
      reason: "Target Audience is empty for this hypothesis",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  const searchQuery =
    String((payload as Record<string, unknown>).searchQuery ?? "").trim() ||
    `${targetAudience} company website contact -site:linkedin.com -site:twitter.com -site:x.com -site:facebook.com -site:instagram.com -site:medium.com -site:quora.com -site:saastr.com -site:reddit.com -site:glassdoor.com -site:indeed.com -site:wikipedia.org -site:crunchbase.com`;

  const domainsRaw = (payload as Record<string, unknown>).domains;
  const domains = Array.isArray(domainsRaw)
    ? domainsRaw.map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean)
    : [];
  const cursor = Math.max(0, Number((payload as Record<string, unknown>).cursor ?? 0) || 0);
  const chunkSize = Math.max(2, Math.min(6, Number((payload as Record<string, unknown>).chunkSize ?? 3) || 3));

  if (!stage) {
    const search = await runPlatformLeadDomainSearch({
      token: sourcingToken,
      query: searchQuery,
      maxResults: 30,
      excludeDomains,
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_search_completed",
      payload: {
        ok: search.ok,
        query: search.query,
        rawResultCount: search.rawResultCount,
        domainsFound: search.domains.length,
        filteredCount: search.filteredCount,
        error: search.error,
      },
    });

    if (!search.ok || !search.domains.length) {
      await failRunWithDiagnostics({
        run,
        reason: search.ok ? "No candidate domains found from lead search" : `Lead search failed: ${search.error}`,
        eventType: "lead_sourcing_failed",
        payload: {
          query: search.query,
          rawResultCount: search.rawResultCount,
        },
      });
      return;
    }

    const actorSelection = await choosePlatformDiscoveryActor({
      run: {
        id: run.id,
        brandId: run.brandId,
        campaignId: run.campaignId,
        experimentId: run.experimentId,
      },
      candidates: platformActorCandidates,
      preselectedActorId: selectedActorIdFromPayload,
    });
    if (!actorSelection.ok || !actorSelection.actorId) {
      await failRunWithDiagnostics({
        run,
        reason: actorSelection.reason || "No platform discovery actor selected",
        eventType: "lead_sourcing_failed",
        payload: {
          candidates: actorSelection.candidates,
          stats: actorSelection.stats,
        },
      });
      return;
    }

    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_actor_selected",
      payload: {
        actorId: actorSelection.actorId,
        reason: actorSelection.reason,
        candidates: actorSelection.candidates,
        stats: actorSelection.stats,
      },
    });

    await enqueueOutreachJob({
      runId: run.id,
      jobType: "source_leads",
      executeAfter: nowIso(),
      payload: {
        stage: "start_email_discovery",
        searchQuery: search.query,
        domains: search.domains,
        cursor: 0,
        chunkSize,
        maxLeads,
        selectedActorId: actorSelection.actorId,
      },
    });
    return;
  }

  if (stage === "start_email_discovery") {
    const selectedActorId = selectedActorIdFromPayload;
    if (!selectedActorId) {
      await failRunWithDiagnostics({
        run,
        reason: "No selected discovery actor for this run",
        eventType: "lead_sourcing_failed",
      });
      return;
    }

    if (!domains.length) {
      await failRunWithDiagnostics({
        run,
        reason: "No domains available for email discovery",
        eventType: "lead_sourcing_failed",
      });
      return;
    }

    const chunk = domains.slice(cursor, cursor + chunkSize);
    if (!chunk.length) {
      await failRunWithDiagnostics({
        run,
        reason: "No leads sourced (exhausted discovered domains)",
        eventType: "lead_sourcing_failed",
        payload: { domains: domains.length },
      });
      return;
    }

    // Keep discovery conservative: this is platform-managed and must not run up costs.
    const maxRequestsPerCrawl = Math.max(15, Math.min(40, chunk.length * 8));
    const started = await startPlatformEmailDiscovery({
      token: sourcingToken,
      domains: chunk,
      maxRequestsPerCrawl,
      actorId: selectedActorId,
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_email_discovery_started",
      payload: {
        actorId: selectedActorId,
        ok: started.ok,
        cursor,
        chunkSize: chunk.length,
        maxRequestsPerCrawl,
        error: started.error,
      },
    });

    if (!started.ok) {
      await failRunWithDiagnostics({
        run,
        reason: `Email discovery failed to start: ${started.error}`,
        eventType: "lead_sourcing_failed",
      });
      return;
    }

    await updateOutreachRun(run.id, { externalRef: started.runId });

    await enqueueOutreachJob({
      runId: run.id,
      jobType: "source_leads",
      executeAfter: new Date(Date.now() + 30_000).toISOString(),
      payload: {
        stage: "poll_email_discovery",
        searchQuery,
        domains,
        cursor,
        nextCursor: cursor + chunk.length,
        chunkSize,
        maxLeads,
        selectedActorId,
        emailDiscoveryRunId: started.runId,
        emailDiscoveryDatasetId: started.datasetId,
      },
    });
    return;
  }

  if (stage === "poll_email_discovery") {
    const selectedActorId = selectedActorIdFromPayload;
    const runId = String((payload as Record<string, unknown>).emailDiscoveryRunId ?? "").trim();
    const datasetId = String((payload as Record<string, unknown>).emailDiscoveryDatasetId ?? "").trim();
    const nextCursor = Math.max(0, Number((payload as Record<string, unknown>).nextCursor ?? cursor) || 0);

    const poll = await pollPlatformEmailDiscovery({ token: sourcingToken, runId });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_email_discovery_polled",
      payload: {
        actorId: selectedActorId,
        ok: poll.ok,
        status: poll.status,
        error: poll.error,
      },
    });

    if (poll.ok && (poll.status === "ready" || poll.status === "running")) {
      await enqueueOutreachJob({
        runId: run.id,
        jobType: "source_leads",
        executeAfter: new Date(Date.now() + 30_000).toISOString(),
        payload: {
          ...payload,
          stage: "poll_email_discovery",
          emailDiscoveryDatasetId: poll.datasetId || datasetId,
          cursor,
          nextCursor,
          selectedActorId,
        },
      });
      return;
    }

    const resolvedDatasetId = poll.datasetId || datasetId;
    if (!resolvedDatasetId) {
      await failRunWithDiagnostics({
        run,
        reason: poll.ok ? "Email discovery finished, but no dataset id was returned" : `Email discovery failed: ${poll.error}`,
        eventType: "lead_sourcing_failed",
      });
      return;
    }

    const fetched = await fetchPlatformEmailDiscoveryResults({
      token: sourcingToken,
      datasetId: resolvedDatasetId,
      limit: 200,
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_email_discovery_completed",
      payload: {
        actorId: selectedActorId,
        ok: fetched.ok,
        providerStatus: poll.status,
        providerOk: poll.ok,
        datasetRows: fetched.rows.length,
        error: fetched.error,
      },
    });

    if (!fetched.ok) {
      await failRunWithDiagnostics({
        run,
        reason: `Email discovery results fetch failed: ${fetched.error}`,
        eventType: "lead_sourcing_failed",
      });
      return;
    }

    const discovered = leadsFromEmailDiscoveryRows(fetched.rows, maxLeads);
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_completed",
      payload: {
        sourcedCount: discovered.length,
        strategy: "platform_search_then_email_discovery",
        actorId: selectedActorId,
      },
    });

    if (!discovered.length && !poll.ok) {
      await failRunWithDiagnostics({
        run,
        reason: `Email discovery failed: ${poll.error}`,
        eventType: "lead_sourcing_failed",
      });
      return;
    }

    if (!discovered.length) {
      await enqueueOutreachJob({
        runId: run.id,
        jobType: "source_leads",
        executeAfter: nowIso(),
        payload: {
          stage: "start_email_discovery",
          searchQuery,
          domains,
          cursor: nextCursor,
          chunkSize,
          maxLeads,
          selectedActorId,
        },
      });
      return;
    }

    await finishSourcingWithLeads(run, discovered);
    return;
  }

  await failRunWithDiagnostics({
    run,
    reason: `Unknown lead sourcing stage: ${stage}`,
    eventType: "lead_sourcing_failed",
  });
  return;
}

async function finishSourcingWithLeads(run: NonNullable<Awaited<ReturnType<typeof getOutreachRun>>>, leads: ApifyLead[]) {
  const recentRuns = (await listCampaignRuns(run.brandId, run.campaignId)).filter((item) => {
    if (item.id === run.id) return false;
    const ageMs = Date.now() - new Date(item.createdAt).getTime();
    return ageMs <= 14 * DAY_MS;
  });
  const blockedEmails = new Set<string>();
  for (const recent of recentRuns) {
    const recentLeads = await listRunLeads(recent.id);
    for (const lead of recentLeads) {
      if (["scheduled", "sent", "replied", "bounced", "unsubscribed"].includes(lead.status)) {
        blockedEmails.add(lead.email.toLowerCase());
      }
    }
  }

  const suppressionCounts: Record<string, number> = {
    duplicate_14_day: 0,
    invalid_email: 0,
    placeholder_domain: 0,
    role_account: 0,
  };

  const filteredLeads: ApifyLead[] = [];
  for (const lead of leads) {
    const normalizedEmail = lead.email.toLowerCase();
    const suppressionReason = getLeadEmailSuppressionReason(normalizedEmail);
    if (suppressionReason) {
      suppressionCounts[suppressionReason] = (suppressionCounts[suppressionReason] ?? 0) + 1;
      continue;
    }
    if (blockedEmails.has(normalizedEmail)) {
      suppressionCounts.duplicate_14_day += 1;
      continue;
    }
    filteredLeads.push(lead);
  }

  if (!filteredLeads.length) {
    await failRunWithDiagnostics({
      run,
      reason: "All sourced leads were suppressed by quality/duplicate rules",
      eventType: "lead_sourcing_failed",
      payload: {
        sourcedCount: leads.length,
        blockedCount: leads.length,
        suppressionCounts,
      },
    });
    return;
  }

  const upserted = await upsertRunLeads(
    run.id,
    run.brandId,
    run.campaignId,
    filteredLeads.map((lead) => ({
      email: lead.email,
      name: lead.name,
      company: lead.company,
      title: lead.title,
      domain: lead.domain,
      sourceUrl: lead.sourceUrl,
    }))
  );

  if (!upserted.length) {
    await failRunWithDiagnostics({
      run,
      reason: "Lead persistence failed (0 leads stored)",
      eventType: "lead_sourcing_failed",
      payload: {
        attempted: filteredLeads.length,
      },
    });
    return;
  }

  await updateOutreachRun(run.id, {
    status: "scheduled",
    lastError: "",
    metrics: {
      ...run.metrics,
      sourcedLeads: upserted.length,
    },
  });
  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourced_apify",
    payload: {
      count: upserted.length,
      blockedCount: Math.max(0, leads.length - filteredLeads.length),
      suppressionCounts,
    },
  });

  await enqueueOutreachJob({
    runId: run.id,
    jobType: "schedule_messages",
    executeAfter: nowIso(),
  });
}

async function processScheduleMessagesJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["paused", "completed", "canceled", "failed", "preflight_failed"].includes(run.status)) return;

  const existingMessages = await listRunMessages(run.id);
  if (existingMessages.length) {
    await updateOutreachRun(run.id, {
      lastError: "",
      metrics: {
        ...run.metrics,
        scheduledMessages: Math.max(run.metrics.scheduledMessages, existingMessages.length),
      },
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "message_scheduling_skipped",
      payload: { reason: "messages_already_exist", count: existingMessages.length },
    });
    return;
  }

  const campaign = await getCampaignById(run.brandId, run.campaignId);
  if (!campaign) {
    await failRunWithDiagnostics({
      run,
      reason: "Campaign not found",
      eventType: "schedule_failed",
    });
    return;
  }

  const brand = await getBrandById(run.brandId);
  const hypothesis = findHypothesis(campaign, run.hypothesisId);
  const experiment = findExperiment(campaign, run.experimentId);
  if (!hypothesis || !experiment) {
    await failRunWithDiagnostics({
      run,
      reason: "Hypothesis or experiment missing",
      eventType: "schedule_failed",
    });
    return;
  }
  const runtimeExperiment = await getExperimentRecordByRuntimeRef(run.brandId, run.campaignId, run.experimentId);
  const parsedOffer = parseOfferAndCta(runtimeExperiment?.offer ?? "");
  const experimentOffer = parsedOffer.offer || runtimeExperiment?.offer || "";
  const experimentCta = parsedOffer.cta;
  const experimentAudience = runtimeExperiment?.audience || hypothesis.actorQuery;

  const leads = await listRunLeads(run.id);
  if (!leads.length) {
    await failRunWithDiagnostics({
      run,
      reason: "No leads sourced",
      eventType: "schedule_failed",
      payload: { sourcedLeads: run.metrics.sourcedLeads },
    });
    return;
  }

  const flowMap = await getPublishedConversationMapForExperiment(run.brandId, run.campaignId, run.experimentId);
  const hasConversationMap = Boolean(flowMap?.publishedRevision);
  let scheduledMessagesCount = 0;

  if (hasConversationMap && flowMap) {
    const graph = flowMap.publishedGraph;
    const startNode = conversationNodeById(graph, graph.startNodeId);
    if (!startNode) {
      await failRunWithDiagnostics({
        run,
        reason: "Conversation flow start node is invalid",
        eventType: "schedule_failed",
      });
      return;
    }

    const existingConversationMessages = await listRunMessages(run.id);
    const campaignGoal = campaign.objective.goal.trim();
    const brandName = brand?.name ?? "";

    let firstScheduleFailureReason = "";
    for (const [index, lead] of leads.entries()) {
      let session = await getConversationSessionByLead({ runId: run.id, leadId: lead.id });
      if (!session) {
        session = await createConversationSession({
          runId: run.id,
          brandId: run.brandId,
          campaignId: run.campaignId,
          leadId: lead.id,
          mapId: flowMap.id,
          mapRevision: flowMap.publishedRevision,
          startNodeId: graph.startNodeId,
        });
        await createConversationEvent({
          sessionId: session.id,
          runId: run.id,
          eventType: "session_started",
          payload: {
            nodeId: graph.startNodeId,
            mapRevision: flowMap.publishedRevision,
          },
        });
      }

      if (session.state === "completed" || session.state === "failed") continue;
      if (startNode.kind === "terminal") {
        await updateConversationSession(session.id, {
          state: "completed",
          endedReason: "start_node_terminal",
          currentNodeId: startNode.id,
          turnCount: Math.max(session.turnCount, 1),
          lastNodeEnteredAt: nowIso(),
        });
        await createConversationEvent({
          sessionId: session.id,
          runId: run.id,
          eventType: "session_completed",
          payload: {
            reason: "start_node_terminal",
          },
        });
        continue;
      }

      if (!startNode.autoSend) {
        await updateConversationSession(session.id, {
          state: "waiting_manual",
          currentNodeId: startNode.id,
          turnCount: Math.max(session.turnCount, 1),
          lastNodeEnteredAt: nowIso(),
        });
        await createConversationEvent({
          sessionId: session.id,
          runId: run.id,
          eventType: "manual_node_required",
          payload: {
            nodeId: startNode.id,
            reason: "start_node_auto_send_disabled",
          },
        });
        continue;
      }

      const scheduled = await scheduleConversationNodeMessage({
        run,
        lead,
        sessionId: session.id,
        node: startNode,
        step: 1,
        brandName,
        brandWebsite: brand?.website ?? "",
        brandTone: brand?.tone ?? "",
        brandNotes: brand?.notes ?? "",
        campaignName: campaign.name,
        campaignGoal,
        campaignConstraints: campaign.objective.constraints ?? "",
        variantId: experiment.id,
        variantName: experiment.name,
        experimentOffer,
        experimentCta,
        experimentAudience,
        experimentNotes: experiment.notes ?? "",
        maxDepth: graph.maxDepth,
        waitMinutes: index * run.minSpacingMinutes,
        existingMessages: existingConversationMessages,
      });
      if (scheduled.ok) {
        scheduledMessagesCount += 1;
        await updateConversationSession(session.id, {
          state: "active",
          currentNodeId: startNode.id,
          turnCount: Math.max(session.turnCount, 1),
          lastNodeEnteredAt: nowIso(),
        });
        await createConversationEvent({
          sessionId: session.id,
          runId: run.id,
          eventType: "node_message_scheduled",
          payload: {
            nodeId: startNode.id,
            autoSend: true,
          },
        });
      } else if (!firstScheduleFailureReason) {
        firstScheduleFailureReason = scheduled.reason;
      }
    }

    if (scheduledMessagesCount === 0) {
      await failRunWithDiagnostics({
        run,
        reason:
          firstScheduleFailureReason ||
          "No valid messages were scheduled from the published Conversation Map",
        eventType: "schedule_failed",
      });
      return;
    }

    await createOutreachEvent({
      runId: run.id,
      eventType: "message_scheduled",
      payload: {
        count: scheduledMessagesCount,
        mode: "conversation_map",
      },
    });
  } else {
    await failRunWithDiagnostics({
      run,
      reason:
        "No published conversation map for this variant. Build and publish a Conversation Map before launching.",
      eventType: "schedule_failed",
      payload: {
        hasConversationMap: false,
        experimentId: run.experimentId,
      },
    });
    return;
  }

  await updateOutreachRun(run.id, {
    status: "scheduled",
    metrics: {
      ...run.metrics,
      scheduledMessages: Math.max(run.metrics.scheduledMessages, scheduledMessagesCount),
    },
  });
  await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "scheduled");
  await enqueueOutreachJob({ runId: run.id, jobType: "dispatch_messages", executeAfter: nowIso() });
  if (hasConversationMap) {
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "conversation_tick",
      executeAfter: addMinutes(nowIso(), CONVERSATION_TICK_MINUTES),
    });
  }
  await enqueueOutreachJob({ runId: run.id, jobType: "analyze_run", executeAfter: addHours(nowIso(), 1) });
  await enqueueOutreachJob({ runId: run.id, jobType: "sync_replies", executeAfter: addHours(nowIso(), 1) });
}

function nextDispatchTime(messages: Awaited<ReturnType<typeof listRunMessages>>) {
  const pending = messages
    .filter((item) => item.status === "scheduled")
    .sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1));
  return pending[0]?.scheduledAt ?? "";
}

async function processDispatchMessagesJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["paused", "completed", "canceled", "failed", "preflight_failed"].includes(run.status)) {
    return;
  }

  const account = await getOutreachAccount(run.accountId);
  const secrets = await getOutreachAccountSecrets(run.accountId);
  if (!account || !secrets) {
    await failRunWithDiagnostics({
      run,
      reason: "Account credentials missing",
      eventType: "dispatch_failed",
    });
    return;
  }

  const assignment = await getBrandOutreachAssignment(run.brandId);
  const mailboxAccountId = String(assignment?.mailboxAccountId ?? "").trim();
  if (!mailboxAccountId) {
    await failRunWithDiagnostics({
      run,
      reason: "Reply mailbox assignment is required for sending",
      eventType: "dispatch_failed",
    });
    return;
  }
  const mailboxAccount =
    mailboxAccountId === account.id ? account : await getOutreachAccount(mailboxAccountId);
  if (!mailboxAccount || mailboxAccount.status !== "active") {
    await failRunWithDiagnostics({
      run,
      reason: "Assigned reply mailbox account is missing or inactive",
      eventType: "dispatch_failed",
    });
    return;
  }
  const replyToEmail = mailboxAccount.config.mailbox.email.trim();
  if (!replyToEmail) {
    await failRunWithDiagnostics({
      run,
      reason: "Assigned reply mailbox email is empty",
      eventType: "dispatch_failed",
    });
    return;
  }
  if (!account.config.customerIo.fromEmail.trim()) {
    await failRunWithDiagnostics({
      run,
      reason: "Customer.io From Email is empty",
      eventType: "dispatch_failed",
    });
    return;
  }

  await updateOutreachRun(run.id, { status: "sending" });
  await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "sending");

  const messages = await listRunMessages(run.id);
  const leads = await listRunLeads(run.id);
  const due = messages.filter(
    (message) => message.status === "scheduled" && toDate(message.scheduledAt).getTime() <= Date.now()
  );
  if (!due.length) {
    const nextAt = nextDispatchTime(messages);
    if (nextAt) {
      await enqueueOutreachJob({ runId: run.id, jobType: "dispatch_messages", executeAfter: nextAt });
      return;
    }

    await updateOutreachRun(run.id, {
      status: "monitoring",
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "monitoring");
    await enqueueOutreachJob({ runId: run.id, jobType: "analyze_run", executeAfter: addHours(nowIso(), 1) });
    return;
  }

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const hourlySent = messages.filter(
    (message) => message.status === "sent" && message.sentAt && toDate(message.sentAt).getTime() >= oneHourAgo
  ).length;
  const dailySent = messages.filter(
    (message) => message.status === "sent" && message.sentAt && toDate(message.sentAt).getTime() >= startOfDay.getTime()
  ).length;

  const hourlySlots = Math.max(0, run.hourlyCap - hourlySent);
  const dailySlots = Math.max(0, run.dailyCap - dailySent);
  const available = Math.max(0, Math.min(hourlySlots, dailySlots));

  if (available <= 0) {
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "dispatch_messages",
      executeAfter: addHours(nowIso(), 1),
    });
    return;
  }

  for (const message of due.slice(0, available)) {
    const lead = leads.find((item) => item.id === message.leadId);
    if (!lead || !lead.email) {
      await updateRunMessage(message.id, {
        status: "failed",
        lastError: "Lead email missing",
      });
      continue;
    }
    const suppressionReason = getLeadEmailSuppressionReason(lead.email);
    if (suppressionReason) {
      const reasonText =
        suppressionReason === "role_account"
          ? "Lead blocked: role-based inbox"
          : suppressionReason === "placeholder_domain"
            ? "Lead blocked: placeholder/test domain"
            : "Lead blocked: invalid email";
      await updateRunMessage(message.id, {
        status: "canceled",
        lastError: reasonText,
      });
      await updateRunLead(lead.id, { status: "suppressed" });
      await createOutreachEvent({
        runId: run.id,
        eventType: "lead_suppressed_before_send",
        payload: {
          reason: reasonText,
          suppressionReason,
          email: lead.email,
          messageId: message.id,
        },
      });
      continue;
    }
    if (["unsubscribed", "bounced", "suppressed"].includes(lead.status)) {
      await updateRunMessage(message.id, {
        status: "canceled",
        lastError: `Lead blocked by suppression status: ${lead.status}`,
      });
      continue;
    }

    const send = await sendOutreachMessage({
      message,
      account,
      secrets,
      replyToEmail,
      recipient: lead.email,
      runId: run.id,
      experimentId: run.experimentId,
    });

    if (send.ok) {
      await updateRunMessage(message.id, {
        status: "sent",
        providerMessageId: send.providerMessageId,
        sentAt: nowIso(),
        lastError: "",
      });
      await updateRunLead(lead.id, { status: "sent" });
      await createOutreachEvent({
        runId: run.id,
        eventType: "message_sent",
        payload: {
          messageId: message.id,
          sourceType: message.sourceType,
          nodeId: message.nodeId,
          sessionId: message.sessionId,
        },
      });
    } else {
      await updateRunMessage(message.id, {
        status: "failed",
        lastError: send.error,
      });
      await createOutreachEvent({
        runId: run.id,
        eventType: "dispatch_failed",
        payload: {
          messageId: message.id,
          sourceType: message.sourceType,
          nodeId: message.nodeId,
          sessionId: message.sessionId,
          error: send.error,
        },
      });
    }
  }

  const refreshedMessages = await listRunMessages(run.id);
  const { threads } = await listReplyThreadsByBrand(run.brandId);
  const metrics = calculateRunMetricsFromMessages(run.id, refreshedMessages, threads);

  await updateOutreachRun(run.id, {
    status: "sending",
    metrics: {
      ...run.metrics,
      sentMessages: metrics.sentMessages,
      bouncedMessages: metrics.bouncedMessages,
      failedMessages: metrics.failedMessages,
      replies: metrics.replies,
      positiveReplies: metrics.positiveReplies,
      negativeReplies: metrics.negativeReplies,
    },
  });

  const nextAt = nextDispatchTime(refreshedMessages);
  if (nextAt) {
    await enqueueOutreachJob({ runId: run.id, jobType: "dispatch_messages", executeAfter: nextAt });
  } else {
    await updateOutreachRun(run.id, {
      status: "monitoring",
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "monitoring");
    await enqueueOutreachJob({ runId: run.id, jobType: "analyze_run", executeAfter: addHours(nowIso(), 1) });
  }
}

async function processSyncRepliesJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["completed", "canceled", "failed", "preflight_failed"].includes(run.status)) return;

  await createOutreachEvent({
    runId: run.id,
    eventType: "reply_sync_tick",
    payload: {
      note: "Mailbox sync should post replies via webhook endpoint",
    },
  });

  await enqueueOutreachJob({
    runId: run.id,
    jobType: "sync_replies",
    executeAfter: addHours(nowIso(), 1),
  });
}

async function processConversationTickJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["paused", "completed", "canceled", "failed", "preflight_failed"].includes(run.status)) return;

  const map = await getPublishedConversationMapForExperiment(run.brandId, run.campaignId, run.experimentId);
  if (!map?.publishedRevision) return;

  const graph = map.publishedGraph;
  const sessions = await listConversationSessionsByRun(run.id);
  if (!sessions.length) return;

  const leads = await listRunLeads(run.id);
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const messages = await listRunMessages(run.id);
  const [brand, campaign] = await Promise.all([
    getBrandById(run.brandId),
    getCampaignById(run.brandId, run.campaignId),
  ]);
  const brandName = brand?.name ?? "";
  const campaignGoal = campaign?.objective.goal ?? "";
  const variant = campaign?.experiments.find((item) => item.id === run.experimentId) ?? null;
  const variantName = variant?.name ?? "";
  const hypothesis = variant
    ? campaign?.hypotheses.find((item) => item.id === variant.hypothesisId) ?? null
    : null;
  const runtimeExperiment = await getExperimentRecordByRuntimeRef(run.brandId, run.campaignId, run.experimentId);
  const parsedOffer = parseOfferAndCta(runtimeExperiment?.offer ?? "");
  const experimentOffer = parsedOffer.offer || runtimeExperiment?.offer || "";
  const experimentCta = parsedOffer.cta;
  const experimentAudience = runtimeExperiment?.audience || hypothesis?.actorQuery || "";

  let scheduledCount = 0;
  let completedCount = 0;
  let failedCount = 0;

  for (const session of sessions) {
    if (session.state !== "active") continue;

    const currentNode = conversationNodeById(graph, session.currentNodeId);
    if (!currentNode) {
      await updateConversationSession(session.id, {
        state: "failed",
        endedReason: "current_node_missing",
      });
      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "session_failed",
        payload: {
          reason: "current_node_missing",
          nodeId: session.currentNodeId,
        },
      });
      failedCount += 1;
      continue;
    }

    const timerEdge = pickDueTimerEdge({
      graph,
      currentNodeId: currentNode.id,
      lastNodeEnteredAt: session.lastNodeEnteredAt,
    });
    if (!timerEdge) continue;

    const nextNode = conversationNodeById(graph, timerEdge.toNodeId);
    if (!nextNode) {
      await updateConversationSession(session.id, {
        state: "failed",
        endedReason: "timer_target_missing",
      });
      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "session_failed",
        payload: {
          reason: "timer_target_missing",
          edgeId: timerEdge.id,
        },
      });
      failedCount += 1;
      continue;
    }

    const nextTurn = session.turnCount + 1;
    const maxDepthReached = nextTurn >= graph.maxDepth;

    if (nextNode.kind === "terminal" || maxDepthReached) {
      await updateConversationSession(session.id, {
        state: "completed",
        currentNodeId: nextNode.id,
        turnCount: nextTurn,
        lastNodeEnteredAt: nowIso(),
        endedReason: maxDepthReached ? "max_depth_reached" : "terminal_node",
      });
      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "session_completed",
        payload: {
          reason: maxDepthReached ? "max_depth_reached" : "terminal_node",
          nodeId: nextNode.id,
        },
      });
      completedCount += 1;
      continue;
    }

    const nextState = nextNode.autoSend ? "active" : "waiting_manual";
    await updateConversationSession(session.id, {
      state: nextState,
      currentNodeId: nextNode.id,
      turnCount: nextTurn,
      lastNodeEnteredAt: nowIso(),
      endedReason: "",
    });
    await createConversationEvent({
      sessionId: session.id,
      runId: run.id,
      eventType: "session_transition",
      payload: {
        trigger: "timer",
        fromNodeId: currentNode.id,
        toNodeId: nextNode.id,
        edgeId: timerEdge.id,
      },
    });

    if (!nextNode.autoSend) {
      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "manual_node_required",
        payload: {
          nodeId: nextNode.id,
          reason: "auto_send_disabled",
        },
      });
      continue;
    }

    const lead = leadsById.get(session.leadId);
    if (!lead) continue;

    const scheduled = await scheduleConversationNodeMessage({
      run,
      lead,
      sessionId: session.id,
      node: nextNode,
      step: nextTurn,
      brandName,
      brandWebsite: brand?.website ?? "",
      brandTone: brand?.tone ?? "",
      brandNotes: brand?.notes ?? "",
      campaignName: campaign?.name ?? "",
      campaignGoal,
      campaignConstraints: campaign?.objective.constraints ?? "",
      variantId: variant?.id ?? "",
      variantName,
      experimentOffer,
      experimentCta,
      experimentAudience,
      experimentNotes: variant?.notes ?? "",
      maxDepth: graph.maxDepth,
      waitMinutes: 0,
      existingMessages: messages,
    });
    if (scheduled.ok) {
      scheduledCount += 1;
      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "node_message_scheduled",
        payload: {
          nodeId: nextNode.id,
          trigger: "timer",
        },
      });
    } else {
      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "node_schedule_failed",
        payload: {
          nodeId: nextNode.id,
          trigger: "timer",
          reason: scheduled.reason,
        },
      });
    }
  }

  if (scheduledCount > 0) {
    await updateOutreachRun(run.id, {
      metrics: {
        ...run.metrics,
        scheduledMessages: Math.max(run.metrics.scheduledMessages, messages.length),
      },
    });
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "dispatch_messages",
      executeAfter: nowIso(),
    });
  }

  const refreshedSessions = await listConversationSessionsByRun(run.id);
  const shouldContinue = refreshedSessions.some((session) => session.state === "active");
  if (shouldContinue) {
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "conversation_tick",
      executeAfter: addMinutes(nowIso(), CONVERSATION_TICK_MINUTES),
    });
  }

  await createOutreachEvent({
    runId: run.id,
    eventType: "conversation_tick_processed",
    payload: {
      sessions: refreshedSessions.length,
      scheduledCount,
      completedCount,
      failedCount,
      continuing: shouldContinue,
    },
  });
}

async function processAnalyzeRunJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["canceled", "completed", "failed", "preflight_failed"].includes(run.status)) return;

  const messages = await listRunMessages(run.id);
  const { threads } = await listReplyThreadsByBrand(run.brandId);
  const metrics = calculateRunMetricsFromMessages(run.id, messages, threads);

  const delivered = Math.max(1, metrics.sentMessages + metrics.bouncedMessages);
  const attempted = Math.max(1, metrics.sentMessages + metrics.failedMessages + metrics.bouncedMessages);
  const replyCount = Math.max(1, metrics.replies);

  const bounceRate = metrics.bouncedMessages / delivered;
  const providerErrorRate = metrics.failedMessages / attempted;
  const negativeReplyRate = metrics.negativeReplies / replyCount;

  let paused = false;

  if (metrics.bouncedMessages >= 5 && bounceRate > 0.05) {
    paused = true;
    await createRunAnomaly({
      runId: run.id,
      type: "hard_bounce_rate",
      severity: "critical",
      threshold: 0.05,
      observed: bounceRate,
      details: "Hard bounce rate exceeded 5%.",
    });
  }

  if (!paused && providerErrorRate > 0.2) {
    paused = true;
    await createRunAnomaly({
      runId: run.id,
      type: "provider_error_rate",
      severity: "critical",
      threshold: 0.2,
      observed: providerErrorRate,
      details: "Provider error rate exceeded 20%.",
    });
  }

  if (!paused && metrics.replies >= 4 && negativeReplyRate > 0.25) {
    paused = true;
    await createRunAnomaly({
      runId: run.id,
      type: "negative_reply_rate_spike",
      severity: "warning",
      threshold: 0.25,
      observed: negativeReplyRate,
      details: "Negative reply rate spike above 25%.",
    });
  }

  if (paused) {
    await updateOutreachRun(run.id, {
      status: "paused",
      pauseReason: "Auto-paused due to anomaly",
      metrics: {
        ...run.metrics,
        sentMessages: metrics.sentMessages,
        bouncedMessages: metrics.bouncedMessages,
        failedMessages: metrics.failedMessages,
        replies: metrics.replies,
        positiveReplies: metrics.positiveReplies,
        negativeReplies: metrics.negativeReplies,
      },
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "paused");
    await createOutreachEvent({
      runId: run.id,
      eventType: "run_paused_auto",
      payload: { bounceRate, providerErrorRate, negativeReplyRate },
    });
    return;
  }

  const pendingScheduled = messages.some((message) => message.status === "scheduled");
  if (!pendingScheduled) {
    await updateOutreachRun(run.id, {
      status: "completed",
      completedAt: nowIso(),
      metrics: {
        ...run.metrics,
        sentMessages: metrics.sentMessages,
        bouncedMessages: metrics.bouncedMessages,
        failedMessages: metrics.failedMessages,
        replies: metrics.replies,
        positiveReplies: metrics.positiveReplies,
        negativeReplies: metrics.negativeReplies,
      },
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "completed");
    return;
  }

  await updateOutreachRun(run.id, {
    status: "monitoring",
    metrics: {
      ...run.metrics,
      sentMessages: metrics.sentMessages,
      bouncedMessages: metrics.bouncedMessages,
      failedMessages: metrics.failedMessages,
      replies: metrics.replies,
      positiveReplies: metrics.positiveReplies,
      negativeReplies: metrics.negativeReplies,
    },
  });
  await enqueueOutreachJob({
    runId: run.id,
    jobType: "analyze_run",
    executeAfter: addHours(nowIso(), 1),
  });
}

async function processOutreachJob(job: OutreachJob) {
  if (job.jobType === "source_leads") {
    await processSourceLeadsJob(job);
    return;
  }
  if (job.jobType === "schedule_messages") {
    await processScheduleMessagesJob(job);
    return;
  }
  if (job.jobType === "dispatch_messages") {
    await processDispatchMessagesJob(job);
    return;
  }
  if (job.jobType === "sync_replies") {
    await processSyncRepliesJob(job);
    return;
  }
  if (job.jobType === "conversation_tick") {
    await processConversationTickJob(job);
    return;
  }
  await processAnalyzeRunJob(job);
}

export async function runOutreachTick(limit = 20): Promise<{
  processed: number;
  completed: number;
  failed: number;
}> {
  const jobs = await listDueOutreachJobs(limit);

  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    const attempts = job.attempts + 1;
    await updateOutreachJob(job.id, { status: "running", attempts });
    await createOutreachEvent({
      runId: job.runId,
      eventType: "job_started",
      payload: {
        jobId: job.id,
        jobType: job.jobType,
        attempt: attempts,
        maxAttempts: job.maxAttempts,
      },
    });

    try {
      await processOutreachJob(job);
      await updateOutreachJob(job.id, {
        status: "completed",
        lastError: "",
      });
      await createOutreachEvent({
        runId: job.runId,
        eventType: "job_completed",
        payload: {
          jobId: job.id,
          jobType: job.jobType,
          attempt: attempts,
        },
      });
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Job failed";
      if (attempts >= job.maxAttempts) {
        await updateOutreachJob(job.id, {
          status: "failed",
          lastError: message,
        });
      } else {
        const delayMinutes = Math.min(60, attempts * 5);
        const next = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
        await updateOutreachJob(job.id, {
          status: "queued",
          executeAfter: next,
          lastError: message,
        });
      }
      await createOutreachEvent({
        runId: job.runId,
        eventType: "job_failed",
        payload: {
          jobId: job.id,
          jobType: job.jobType,
          attempt: attempts,
          maxAttempts: job.maxAttempts,
          error: message,
          willRetry: attempts < job.maxAttempts,
        },
      });
      failed += 1;
    }
  }

  return {
    processed: jobs.length,
    completed,
    failed,
  };
}

export async function updateRunControl(input: {
  brandId: string;
  campaignId: string;
  runId: string;
  action: "pause" | "resume" | "cancel";
  reason?: string;
}): Promise<{ ok: boolean; reason: string }> {
  const run = await getOutreachRun(input.runId);
  if (!run || run.brandId !== input.brandId || run.campaignId !== input.campaignId) {
    return { ok: false, reason: "Run not found" };
  }

  if (input.action === "pause") {
    await updateOutreachRun(run.id, {
      status: "paused",
      pauseReason: input.reason?.trim() || "Paused by user",
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "paused");
    return { ok: true, reason: "Run paused" };
  }

  if (input.action === "resume") {
    if (run.status !== "paused") {
      return { ok: false, reason: "Run is not paused" };
    }
    await updateOutreachRun(run.id, {
      status: "sending",
      pauseReason: "",
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "sending");
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "dispatch_messages",
      executeAfter: nowIso(),
    });
    const map = await getPublishedConversationMapForExperiment(run.brandId, run.campaignId, run.experimentId);
    if (map?.publishedRevision) {
      await enqueueOutreachJob({
        runId: run.id,
        jobType: "conversation_tick",
        executeAfter: addMinutes(nowIso(), CONVERSATION_TICK_MINUTES),
      });
    }
    await createOutreachEvent({ runId: run.id, eventType: "run_resumed_manual", payload: {} });
    return { ok: true, reason: "Run resumed" };
  }

  await updateOutreachRun(run.id, {
    status: "canceled",
    completedAt: nowIso(),
    pauseReason: input.reason?.trim() || "Canceled by user",
  });
  await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "failed");
  return { ok: true, reason: "Run canceled" };
}

export async function ingestInboundReply(input: {
  brandId?: string;
  campaignId?: string;
  runId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  providerMessageId?: string;
}): Promise<{ ok: boolean; threadId: string; draftId: string; reason: string }> {
  const run = await getOutreachRun(input.runId);
  if (!run) {
    return { ok: false, threadId: "", draftId: "", reason: "Run not found" };
  }
  const brandId = input.brandId?.trim() ?? run.brandId;
  const campaignId = input.campaignId?.trim() ?? run.campaignId;
  if (run.brandId !== brandId || run.campaignId !== campaignId) {
    return { ok: false, threadId: "", draftId: "", reason: "Run/brand/campaign mismatch" };
  }

  const leads = await listRunLeads(run.id);
  const lead = leads.find((item) => item.email.toLowerCase() === input.from.toLowerCase()) ?? null;
  if (!lead) {
    return { ok: false, threadId: "", draftId: "", reason: "No lead matched for reply" };
  }

  const sentiment = classifySentiment(input.body);
  const { intent, confidence } = classifyIntentConfidence(input.body);

  const { threads } = await listReplyThreadsByBrand(brandId);
  let thread = threads.find(
    (item) =>
      item.runId === run.id &&
      item.leadId === lead.id &&
      item.subject.trim().toLowerCase() === input.subject.trim().toLowerCase()
  );

  if (!thread) {
    thread = await createReplyThread({
      brandId: run.brandId,
      campaignId: run.campaignId,
      runId: run.id,
      leadId: lead.id,
      subject: input.subject,
      sentiment,
      intent,
      status: "new",
    });
  } else {
    const updated = await updateReplyThread(thread.id, {
      sentiment,
      intent,
      status: "open",
      lastMessageAt: nowIso(),
    });
    if (updated) {
      thread = updated;
    }
  }

  const inboundMessage = await createReplyMessage({
    threadId: thread.id,
    runId: run.id,
    direction: "inbound",
    from: input.from,
    to: input.to,
    subject: input.subject,
    body: input.body,
    providerMessageId: input.providerMessageId ?? "",
  });

  let draftId = "";
  let autoBranchScheduled: { ok: boolean; reason: string; messageId: string } = {
    ok: false,
    reason: "",
    messageId: "",
  };
  const [brand, campaign] = await Promise.all([
    getBrandById(run.brandId),
    getCampaignById(run.brandId, run.campaignId),
  ]);
  const variant = campaign?.experiments.find((item) => item.id === run.experimentId) ?? null;
  const hypothesis = variant
    ? campaign?.hypotheses.find((item) => item.id === variant.hypothesisId) ?? null
    : null;
  const runtimeExperiment = await getExperimentRecordByRuntimeRef(run.brandId, run.campaignId, run.experimentId);
  const parsedOffer = parseOfferAndCta(runtimeExperiment?.offer ?? "");
  const experimentOffer = parsedOffer.offer || runtimeExperiment?.offer || "";
  const experimentCta = parsedOffer.cta;
  const experimentAudience = runtimeExperiment?.audience || hypothesis?.actorQuery || "";

  const flowMap = await getPublishedConversationMapForExperiment(run.brandId, run.campaignId, run.experimentId);
  const session = flowMap ? await getConversationSessionByLead({ runId: run.id, leadId: lead.id }) : null;

  if (flowMap?.publishedRevision && session && session.state !== "completed" && session.state !== "failed") {
    const graph = flowMap.publishedGraph;
    const currentNode = conversationNodeById(graph, session.currentNodeId);
    if (currentNode) {
      const intentEdge = pickIntentEdge({
        graph,
        currentNodeId: currentNode.id,
        intent,
        confidence,
      });
      const fallbackEdge = pickFallbackEdge(graph, currentNode.id);
      const selectedEdge = intentEdge ?? fallbackEdge;

      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "reply_classified",
        payload: {
          intent,
          confidence,
          fromNodeId: currentNode.id,
          selectedEdgeId: selectedEdge?.id ?? "",
        },
      });

      if (selectedEdge) {
        const nextNode = conversationNodeById(graph, selectedEdge.toNodeId);
        if (nextNode) {
          const nextTurn = session.turnCount + 1;
          const maxDepthReached = nextTurn >= graph.maxDepth;
          const shouldComplete =
            intent === "unsubscribe" || nextNode.kind === "terminal" || maxDepthReached;

          if (shouldComplete) {
            await updateConversationSession(session.id, {
              state: "completed",
              currentNodeId: nextNode.id,
              turnCount: nextTurn,
              lastIntent: intent,
              lastConfidence: confidence,
              lastNodeEnteredAt: nowIso(),
              endedReason:
                intent === "unsubscribe"
                  ? "unsubscribe"
                  : maxDepthReached
                    ? "max_depth_reached"
                    : "terminal_node",
            });
            await createConversationEvent({
              sessionId: session.id,
              runId: run.id,
              eventType: "session_completed",
              payload: {
                reason:
                  intent === "unsubscribe"
                    ? "unsubscribe"
                    : maxDepthReached
                      ? "max_depth_reached"
                      : "terminal_node",
                nodeId: nextNode.id,
              },
            });
          } else {
            const nextState = nextNode.autoSend ? "active" : "waiting_manual";
            await updateConversationSession(session.id, {
              state: nextState,
              currentNodeId: nextNode.id,
              turnCount: nextTurn,
              lastIntent: intent,
              lastConfidence: confidence,
              lastNodeEnteredAt: nowIso(),
              endedReason: "",
            });
            await createConversationEvent({
              sessionId: session.id,
              runId: run.id,
              eventType: "session_transition",
              payload: {
                trigger: selectedEdge.trigger,
                fromNodeId: currentNode.id,
                toNodeId: nextNode.id,
                edgeId: selectedEdge.id,
              },
            });

            if (nextNode.autoSend) {
              const messages = await listRunMessages(run.id);
              autoBranchScheduled = await scheduleConversationNodeMessage({
                run,
                lead,
                sessionId: session.id,
                node: nextNode,
                step: nextTurn,
                parentMessageId: inboundMessage.id,
                brandName: brand?.name ?? "",
                brandWebsite: brand?.website ?? "",
                brandTone: brand?.tone ?? "",
                brandNotes: brand?.notes ?? "",
                campaignName: campaign?.name ?? "",
                campaignGoal: campaign?.objective.goal ?? "",
                campaignConstraints: campaign?.objective.constraints ?? "",
                variantId: variant?.id ?? "",
                variantName: variant?.name ?? "",
                experimentOffer,
                experimentCta,
                experimentAudience,
                experimentNotes: variant?.notes ?? "",
                intent,
                intentConfidence: confidence,
                priorNodePath: [session.currentNodeId, nextNode.id],
                maxDepth: graph.maxDepth,
                waitMinutes: selectedEdge.waitMinutes,
                latestInboundSubject: input.subject,
                latestInboundBody: input.body,
                existingMessages: messages,
              });
              if (autoBranchScheduled.ok) {
                await enqueueOutreachJob({
                  runId: run.id,
                  jobType: "dispatch_messages",
                  executeAfter: nowIso(),
                });
                await createConversationEvent({
                  sessionId: session.id,
                  runId: run.id,
                  eventType: "node_message_scheduled",
                  payload: {
                    nodeId: nextNode.id,
                    trigger: selectedEdge.trigger,
                  },
                });
                await createOutreachEvent({
                  runId: run.id,
                  eventType: "message_scheduled",
                  payload: {
                    count: 1,
                    mode: "conversation_branch",
                  },
                });
              } else {
                await createConversationEvent({
                  sessionId: session.id,
                  runId: run.id,
                  eventType: "node_schedule_failed",
                  payload: {
                    nodeId: nextNode.id,
                    trigger: selectedEdge.trigger,
                    reason: autoBranchScheduled.reason,
                  },
                });
              }
            } else {
              const composed = await generateConversationNodeContent({
                node: nextNode,
                run,
                lead,
                sessionId: session.id,
                parentMessageId: inboundMessage.id,
                brandName: brand?.name ?? "",
                brandWebsite: brand?.website ?? "",
                brandTone: brand?.tone ?? "",
                brandNotes: brand?.notes ?? "",
                campaignName: campaign?.name ?? "",
                campaignGoal: campaign?.objective.goal ?? "",
                campaignConstraints: campaign?.objective.constraints ?? "",
                variantId: variant?.id ?? "",
                variantName: variant?.name ?? "",
                experimentOffer,
                experimentCta,
                experimentAudience,
                experimentNotes: variant?.notes ?? "",
                latestInboundSubject: input.subject,
                latestInboundBody: input.body,
                intent,
                intentConfidence: confidence,
                priorNodePath: [session.currentNodeId, nextNode.id],
                maxDepth: graph.maxDepth,
              });
              if (!composed.ok) {
                await createConversationEvent({
                  sessionId: session.id,
                  runId: run.id,
                  eventType: "manual_node_invalid",
                  payload: {
                    nodeId: nextNode.id,
                    reason: composed.reason,
                    trace: composed.trace,
                  },
                });
                await createConversationEvent({
                  sessionId: session.id,
                  runId: run.id,
                  eventType: "conversation_prompt_rejected",
                  payload: {
                    nodeId: nextNode.id,
                    reason: composed.reason,
                    trace: composed.trace,
                  },
                });
                await createOutreachEvent({
                  runId: run.id,
                  eventType: "conversation_prompt_rejected",
                  payload: {
                    nodeId: nextNode.id,
                    reason: composed.reason,
                  },
                });
                await createOutreachEvent({
                  runId: run.id,
                  eventType: "conversation_prompt_failed",
                  payload: {
                    nodeId: nextNode.id,
                    reason: composed.reason,
                  },
                });
              } else {
                const draft = await createReplyDraft({
                  threadId: thread.id,
                  brandId: run.brandId,
                  runId: run.id,
                  subject: composed.subject,
                  body: composed.body,
                  reason: `Manual branch: ${nextNode.title}`,
                });
                draftId = draft.id;
                await createConversationEvent({
                  sessionId: session.id,
                  runId: run.id,
                  eventType: "conversation_prompt_generated",
                  payload: {
                    nodeId: nextNode.id,
                    draftId,
                    trace: composed.trace,
                  },
                });
                await createOutreachEvent({
                  runId: run.id,
                  eventType: "conversation_prompt_generated",
                  payload: {
                    nodeId: nextNode.id,
                    draftId,
                  },
                });
                await createConversationEvent({
                  sessionId: session.id,
                  runId: run.id,
                  eventType: "manual_node_required",
                  payload: {
                    nodeId: nextNode.id,
                    reason: "auto_send_disabled",
                  },
                });
              }
            }
          }
        }
      }
    }
  }

  if (!draftId && !autoBranchScheduled.ok) {
    await createOutreachEvent({
      runId: run.id,
      eventType: "reply_draft_skipped",
      payload: {
        reason: "No valid conversation branch produced a reply draft",
        intent,
      },
    });
  }

  await updateRunLead(lead.id, { status: intent === "unsubscribe" ? "unsubscribed" : "replied" });

  const messages = await listRunMessages(run.id);
  const { threads: refreshedThreads } = await listReplyThreadsByBrand(run.brandId);
  const metrics = calculateRunMetricsFromMessages(run.id, messages, refreshedThreads);

  await updateOutreachRun(run.id, {
    metrics: {
      ...run.metrics,
      replies: metrics.replies,
      positiveReplies: metrics.positiveReplies,
      negativeReplies: metrics.negativeReplies,
      sentMessages: metrics.sentMessages,
      bouncedMessages: metrics.bouncedMessages,
      failedMessages: metrics.failedMessages,
    },
  });

  await createOutreachEvent({
    runId: run.id,
    eventType: "reply_ingested",
    payload: {
      threadId: thread.id,
      intent,
      confidence,
    },
  });
  if (draftId) {
    await createOutreachEvent({ runId: run.id, eventType: "reply_draft_created", payload: { draftId } });
  }

  return {
    ok: true,
    threadId: thread.id,
    draftId,
    reason: "Reply ingested",
  };
}

export async function approveReplyDraftAndSend(input: {
  brandId: string;
  draftId: string;
}): Promise<{ ok: boolean; reason: string }> {
  const draft = await getReplyDraft(input.draftId);
  if (!draft || draft.brandId !== input.brandId) {
    return { ok: false, reason: "Draft not found" };
  }
  if (draft.status !== "draft") {
    return { ok: false, reason: "Draft already sent or dismissed" };
  }

  const thread = await getReplyThread(draft.threadId);
  if (!thread) {
    return { ok: false, reason: "Reply thread not found" };
  }

  const run = await getOutreachRun(draft.runId);
  if (!run) {
    return { ok: false, reason: "Run not found" };
  }

  const mailbox = await resolveMailboxAccountForRun(run);
  if (!mailbox) {
    return { ok: false, reason: "Reply mailbox account missing or invalid" };
  }

  const leads = await listRunLeads(run.id);
  const lead = leads.find((item) => item.id === thread.leadId);
  if (!lead) {
    return { ok: false, reason: "Lead not found for thread" };
  }

  const send = await sendReplyDraftAsEvent({
    draft,
    account: mailbox.account,
    secrets: mailbox.secrets,
    recipient: lead.email,
  });

  if (!send.ok) {
    return { ok: false, reason: send.error };
  }

  await updateReplyDraft(draft.id, {
    status: "sent",
    sentAt: nowIso(),
  });

  await updateReplyThread(thread.id, {
    status: "open",
    lastMessageAt: nowIso(),
  });

  await createReplyMessage({
    threadId: thread.id,
    runId: run.id,
    direction: "outbound",
    from: mailbox.account.config.mailbox.email,
    to: lead.email,
    subject: draft.subject,
    body: draft.body,
    providerMessageId: `reply_${Date.now().toString(36)}`,
  });

  await createOutreachEvent({
    runId: run.id,
    eventType: "reply_draft_sent",
    payload: { draftId: draft.id },
  });

  return { ok: true, reason: "Reply sent" };
}

export async function ingestApifyRunComplete(input: {
  runId: string;
  leads: ApifyLead[];
}): Promise<{ ok: boolean; reason: string }> {
  const run = await getOutreachRun(input.runId);
  if (!run) {
    return { ok: false, reason: "Run not found" };
  }

  await upsertRunLeads(
    run.id,
    run.brandId,
    run.campaignId,
    input.leads.map((lead) => ({
      email: lead.email,
      name: lead.name,
      company: lead.company,
      title: lead.title,
      domain: lead.domain,
      sourceUrl: lead.sourceUrl,
    }))
  );

  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourced_apify",
    payload: { count: input.leads.length, source: "webhook" },
  });

  await enqueueOutreachJob({
    runId: run.id,
    jobType: "schedule_messages",
    executeAfter: nowIso(),
  });

  return { ok: true, reason: "Apify leads ingested" };
}
