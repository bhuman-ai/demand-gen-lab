import { createHash } from "crypto";
import {
  defaultExperimentRunPolicy,
  getBrandById,
  getCampaignById,
  listBrands,
  updateCampaign,
  type CampaignRecord,
  type Experiment,
  type Hypothesis,
} from "@/lib/factory-data";
import type {
  ConversationFlowEdge,
  ActorCapabilityProfile,
  ConversationFlowGraph,
  ConversationFlowNode,
  DomainRow,
  LeadAcceptanceDecision,
  LeadQualityPolicy,
  OutreachMessage,
  OutreachRun,
  ReplyThread,
  ReplyThreadStateDecision,
  SourcingActorMemory,
  SourcingChainDecision,
  SourcingChainStep,
  SourcingTraceSummary,
} from "@/lib/factory-types";
import {
  createConversationEvent,
  createConversationSession,
  getConversationSessionByLead,
  getPublishedConversationMapForExperiment,
  listConversationSessionsByRun,
  updateConversationSession,
} from "@/lib/conversation-flow-data";
import {
  ensureRuntimeForExperiment,
  getExperimentRecordById,
  getExperimentRecordByRuntimeRef,
  getScaleCampaignRecordById,
  listScaleCampaignRecords,
  updateExperimentRecord,
  updateScaleCampaignRecord,
} from "@/lib/experiment-data";
import { isReportCommentExperiment } from "@/lib/experiment-policy";
import {
  conversationPromptModeEnabled,
  generateConversationPromptMessage,
  type ConversationPromptRenderContext,
} from "@/lib/conversation-prompt-render";
import { generateReplyThreadDraft, syncReplyThreadState } from "@/lib/reply-thread-state";
import {
  createOutreachEvent,
  createOutreachRun,
  createDeliverabilityProbeRun,
  createDeliverabilitySeedReservations,
  createReplyDraft,
  createReplyMessage,
  createReplyThread,
  createSourcingChainDecision,
  createSourcingProbeResults,
  createRunAnomaly,
  createRunMessages,
  enqueueOutreachJob,
  claimQueuedOutreachJob,
  getBrandOutreachAssignment,
  findDeliverabilityProbeRun,
  findReplyMessageByProviderMessageId,
  getDeliverabilityProbeRun,
  getInboxSyncState,
  getOutreachAccount,
  getOutreachAccountSecrets,
  getOutreachRun,
  loadHistoricalCompanyDomains,
  getReplyDraft,
  getReplyThread,
  getSourcingActorMemory,
  listCampaignRuns,
  listBrandRuns,
  listDueOutreachJobs,
  listExperimentRuns,
  listOutreachAccounts,
  listDeliverabilitySeedReservations,
  listDeliverabilityProbeRuns,
  listReplyThreadsByBrand,
  listReplyMessagesByRun,
  listRunEvents,
  listRunJobs,
  reclaimStaleRunningOutreachJobs,
  listRunLeads,
  listRunMessages,
  listOwnerRuns,
  setBrandOutreachAssignment,
  updateOutreachJob,
  updateOutreachAccount,
  updateOutreachRun,
  updateDeliverabilityProbeRun,
  updateDeliverabilitySeedReservations,
  updateReplyDraft,
  updateReplyThread,
  updateSourcingChainDecision,
  updateRunLead,
  updateRunMessage,
  upsertInboxSyncState,
  upsertSourcingActorMemory,
  upsertSourcingActorProfiles,
  upsertRunLeads,
  type OutreachJob,
} from "@/lib/outreach-data";
import { assessReportCommentLeadQuality } from "@/lib/report-comment-lead-quality";
import {
  enrichLeadsWithEmailFinderBatch,
  evaluateActorCompatibility,
  evaluateLeadAgainstQualityPolicy,
  extractFirstEmailAddress,
  fetchApifyActorDatasetItems,
  fetchApifyActorSchemaProfile,
  getLeadEmailSuppressionReason,
  pollApifyActorRun,
  runApifyActorSyncGetDatasetItems,
  leadsFromApifyRows,
  resolveEmailFinderApiBaseUrl,
  sendMonitoringProbeMessage,
  sendOutreachMessage,
  sendReplyDraftAsEvent,
  searchApifyStoreActors,
  startApifyActorRun,
  type ApifyStoreActor,
  type ApifyLead,
} from "@/lib/outreach-providers";
import {
  DEFAULT_MAILPOOL_INBOX_PROVIDERS,
  getDomainDeliveryAccountId,
  getDomainDeliveryAccountName,
  getOutreachAccountFromEmail,
  getOutreachAccountReplyToEmail,
  getOutreachSenderBackingIssue,
  supportsCustomerIoDelivery,
  supportsMailpoolDelivery,
} from "@/lib/outreach-account-helpers";
import { admitCustomerIoProfileForSend } from "@/lib/outreach-customerio-budget";
import { resolveLlmModel } from "@/lib/llm-router";
import { inspectMailboxPlacement, listInboxMessages, type MailboxPlacementVerdict } from "@/lib/mailbox-imap";
import {
  getOutreachProvisioningSettings,
  getOutreachProvisioningSettingsSecrets,
  updateOutreachProvisioningSettings,
} from "@/lib/outreach-provider-settings";
import {
  createMailpoolInboxPlacement,
  createMailpoolSpamCheck,
  getMailpoolInboxPlacement,
  getMailpoolSpamCheck,
  runMailpoolInboxPlacement,
} from "@/lib/mailpool-client";
import {
  buildSenderDeliverabilityScorecards,
  fetchGooglePostmasterHealth,
  SENDER_DELIVERABILITY_COOLDOWN_HOURS,
  SENDER_DELIVERABILITY_MIN_MONITORS,
  type SenderDeliverabilityScorecard,
} from "@/lib/outreach-deliverability";
import {
  enrichBrandWithSenderHealth,
  evaluateSenderHealthGate,
  type SenderHealthDimension,
  type SenderHealthGateIssue,
} from "@/lib/sender-health";
import {
  scoreSenderRoutingSignal,
  type SenderRoutingSignals,
} from "@/lib/sender-routing";

const DEFAULT_TIMEZONE = "America/Los_Angeles";
const DEFAULT_REPLY_AUTOSEND_MIN_DELAY_MINUTES = 40;
const DEFAULT_REPLY_AUTOSEND_RANDOM_ADDITIONAL_DELAY_MINUTES = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const CONVERSATION_TICK_MINUTES = 15;
const DEFAULT_EXPERIMENT_RUN_LEAD_TARGET = 500;
const DELIVERABILITY_PROBE_POLL_DELAY_MINUTES = 3;
const DELIVERABILITY_PROBE_REPEAT_HOURS = 24 * 7;
const DELIVERABILITY_INTELLIGENCE_REFRESH_HOURS = 6;
const SELFFUNDED_AWS_APPLICATION_URL = "https://www.selffunded.dev/aws-credits/apply";

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

function replyPolicyDecisionHint(policy: ReplyPolicyResult): Partial<ReplyThreadStateDecision> {
  const recommendedMove =
    policy.intent === "unsubscribe"
      ? "respect_opt_out"
      : policy.action === "manual_review"
        ? "handoff_to_human"
        : policy.action === "no_reply"
          ? "stay_silent"
          : policy.intent === "question"
            ? "answer_question"
            : policy.intent === "interest"
              ? "advance_next_step"
              : policy.intent === "objection"
                ? "reframe_objection"
                : "ask_qualifying_question";

  const objectiveForThisTurn =
    recommendedMove === "respect_opt_out"
      ? "Stop outreach and close the thread cleanly."
      : recommendedMove === "handoff_to_human"
        ? "Escalate the thread for human judgment before responding."
        : recommendedMove === "stay_silent"
          ? "Avoid a robotic reply when there is no meaningful next move."
          : recommendedMove === "answer_question"
            ? "Answer the lead directly and keep the conversation moving."
            : recommendedMove === "advance_next_step"
              ? "Make the next step easy to accept."
              : recommendedMove === "reframe_objection"
                ? "Address the objection without overselling."
                : "Move the thread forward with one useful, low-friction response.";

  return {
    recommendedMove,
    objectiveForThisTurn,
    rationale: policy.reason,
    confidence: policy.confidence,
    autopilotOk: policy.action === "reply" && policy.autoSendAllowed,
    manualReviewReason: policy.action === "manual_review" ? policy.reason : "",
  };
}

function normalizeReplyThreadSubject(value: string) {
  return value.replace(/^\s*((re|fw|fwd)\s*:\s*)+/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function findMatchingReplyThread(input: {
  threads: ReplyThread[];
  subject: string;
  sourceType: ReplyThread["sourceType"];
  runId?: string;
  leadId?: string;
  mailboxAccountId?: string;
  contactEmail?: string;
}) {
  const normalizedSubject = normalizeReplyThreadSubject(input.subject);
  return (
    input.threads.find((thread) => {
      if (thread.sourceType !== input.sourceType) return false;
      if (normalizeReplyThreadSubject(thread.subject) !== normalizedSubject) return false;
      if (input.sourceType === "outreach") {
        return thread.runId === (input.runId ?? "") && thread.leadId === (input.leadId ?? "");
      }
      return (
        thread.contactEmail.trim().toLowerCase() === String(input.contactEmail ?? "").trim().toLowerCase() &&
        (!thread.mailboxAccountId ||
          !(input.mailboxAccountId ?? "").trim() ||
          thread.mailboxAccountId === (input.mailboxAccountId ?? ""))
      );
    }) ?? null
  );
}

type DeliverabilityProbeStage = "send" | "poll";
type DeliverabilityProbeVariant = "baseline" | "production";

type DeliverabilityMonitorTarget = {
  account: ResolvedAccount;
  secrets: ResolvedSecrets;
  brandId: string;
};

type DeliverabilityProbeTarget = {
  reservationId?: string;
  accountId: string;
  email: string;
  providerMessageId?: string;
};

type DeliverabilityProbeMonitorResult = {
  accountId: string;
  email: string;
  placement: MailboxPlacementVerdict;
  matchedMailbox: string;
  matchedUid: number;
  ok: boolean;
  error: string;
};

type DeliverabilityProbeReferenceMessage = {
  id: string;
  leadId: string;
  status: OutreachMessage["status"];
  sourceType: OutreachMessage["sourceType"];
  nodeId: string;
  subject: string;
  body: string;
  contentHash: string;
  senderAccountId: string;
  senderAccountName: string;
  senderFromEmail: string;
};

type SenderHealthGateSnapshot = {
  senderAccountId: string;
  senderAccountName: string;
  fromEmail: string;
  blockers: SenderHealthGateIssue[];
  pending: SenderHealthGateIssue[];
};

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

function timeZoneDateKey(input: Date, timeZone: string) {
  const zone = timeZone.trim() || DEFAULT_TIMEZONE;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(input);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(input);
  }
}

type BusinessWindowPolicy = {
  enabled: boolean;
  startHour: number;
  endHour: number;
  days: number[];
};

type SenderWarmupPolicy = {
  dailyCap: number;
  hourlyCap: number;
  warmupDay: number;
};

type SenderDispatchSlot = {
  account: ResolvedAccount;
  secrets: ResolvedSecrets;
  policy: SenderWarmupPolicy;
};

type SenderUsageMap = Record<string, { dailySent: number; hourlySent: number }>;

const DEFAULT_BUSINESS_WINDOW: BusinessWindowPolicy = {
  enabled: true,
  startHour: 9,
  endHour: 17,
  days: [1, 2, 3, 4, 5],
};

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function clampBusinessHour(value: unknown, fallback: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(23, parsed));
}

function clampBusinessEndHour(value: unknown, fallback: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(24, parsed));
}

function normalizeBusinessDays(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_BUSINESS_WINDOW.days;
  const days = value
    .map((entry) => Math.round(Number(entry)))
    .filter((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 6);
  const unique = Array.from(new Set(days)).sort((a, b) => a - b);
  return unique.length ? unique : DEFAULT_BUSINESS_WINDOW.days;
}

function businessWindowFromExperimentEnvelope(testEnvelope: unknown): BusinessWindowPolicy {
  const row = asRecord(testEnvelope);
  return {
    enabled: row.businessHoursEnabled !== false,
    startHour: clampBusinessHour(row.businessHoursStartHour, DEFAULT_BUSINESS_WINDOW.startHour),
    endHour: clampBusinessEndHour(row.businessHoursEndHour, DEFAULT_BUSINESS_WINDOW.endHour),
    days: normalizeBusinessDays(row.businessDays),
  };
}

function businessWindowHours(policy: BusinessWindowPolicy) {
  if (!policy.enabled) return 24;
  if (policy.startHour === policy.endHour) return 24;
  if (policy.startHour < policy.endHour) {
    return Math.max(1, policy.endHour - policy.startHour);
  }
  return Math.max(1, 24 - policy.startHour + policy.endHour);
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
    return WEEKDAY_INDEX[day] ?? 1;
  } catch {
    return input.getUTCDay();
  }
}

function isInsideBusinessWindow(input: Date, timeZone: string, policy: BusinessWindowPolicy) {
  if (!policy.enabled) return true;
  const weekday = localWeekdayInTimeZone(input, timeZone);
  if (!policy.days.includes(weekday)) return false;
  const hour = localHourInTimeZone(input, timeZone);
  if (policy.startHour === policy.endHour) return true;
  if (policy.startHour < policy.endHour) {
    return hour >= policy.startHour && hour < policy.endHour;
  }
  return hour >= policy.startHour || hour < policy.endHour;
}

function nextBusinessWindowCheckIso(input: Date, timeZone: string, policy: BusinessWindowPolicy) {
  if (!policy.enabled) return nowIso();
  if (isInsideBusinessWindow(input, timeZone, policy)) {
    return nowIso();
  }
  let probe = new Date(input.getTime() + 60 * 60 * 1000);
  for (let steps = 0; steps < 24 * 14; steps += 1) {
    if (isInsideBusinessWindow(probe, timeZone, policy)) {
      return probe.toISOString();
    }
    probe = new Date(probe.getTime() + 60 * 60 * 1000);
  }
  return addHours(nowIso(), 1);
}

function senderWarmupDayNumber(createdAt: string, now: Date, timeZone: string) {
  const created = toDate(createdAt);
  const createdKey = timeZoneDateKey(created, timeZone || DEFAULT_TIMEZONE);
  const nowKey = timeZoneDateKey(now, timeZone || DEFAULT_TIMEZONE);
  const createdDay = Date.parse(`${createdKey}T00:00:00Z`);
  const nowDay = Date.parse(`${nowKey}T00:00:00Z`);
  if (!Number.isFinite(createdDay) || !Number.isFinite(nowDay)) return 1;
  return Math.max(1, Math.floor((nowDay - createdDay) / DAY_MS) + 1);
}

function senderWarmupPolicy(input: {
  account: ResolvedAccount;
  now: Date;
  timeZone: string;
  businessWindow: BusinessWindowPolicy;
}): SenderWarmupPolicy {
  const warmupDay = senderWarmupDayNumber(input.account.createdAt, input.now, input.timeZone);
  const dailyCap = Math.max(15, Math.min(120, warmupDay * 15));
  const hourlyCap = Math.max(1, Math.ceil(dailyCap / businessWindowHours(input.businessWindow)));
  return {
    dailyCap,
    hourlyCap,
    warmupDay,
  };
}

function alignToBusinessWindow(dateIso: string, timeZone: string, policy: BusinessWindowPolicy) {
  if (!policy.enabled) return dateIso;
  const scheduled = toDate(dateIso);
  if (isInsideBusinessWindow(scheduled, timeZone, policy)) {
    return scheduled.toISOString();
  }
  let probe = new Date(scheduled.getTime());
  for (let steps = 0; steps < 24 * 14 * 4; steps += 1) {
    probe = new Date(probe.getTime() + 15 * 60 * 1000);
    if (isInsideBusinessWindow(probe, timeZone, policy)) {
      return probe.toISOString();
    }
  }
  return addHours(scheduled.toISOString(), 1);
}

function normalizeReplyTimingPolicy(graph?: ConversationFlowGraph | null) {
  return {
    minimumDelayMinutes: Math.max(
      0,
      Math.min(
        10080,
        Math.round(
          Number(graph?.replyTiming?.minimumDelayMinutes ?? DEFAULT_REPLY_AUTOSEND_MIN_DELAY_MINUTES) ||
            DEFAULT_REPLY_AUTOSEND_MIN_DELAY_MINUTES
        )
      )
    ),
    randomAdditionalDelayMinutes: Math.max(
      0,
      Math.min(
        1440,
        Math.round(
          Number(
            graph?.replyTiming?.randomAdditionalDelayMinutes ??
              DEFAULT_REPLY_AUTOSEND_RANDOM_ADDITIONAL_DELAY_MINUTES
          ) || DEFAULT_REPLY_AUTOSEND_RANDOM_ADDITIONAL_DELAY_MINUTES
        )
      )
    ),
  };
}

function randomDelayMinutes(maxAdditionalDelayMinutes: number) {
  const max = Math.max(0, Math.round(Number(maxAdditionalDelayMinutes) || 0));
  if (max <= 0) return 0;
  return Math.floor(Math.random() * (max + 1));
}

function isRunOpen(status: string) {
  return ["queued", "sourcing", "scheduled", "sending", "monitoring", "paused"].includes(status);
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

function platformExaApiKey() {
  return (
    String(process.env.EXA_API_KEY ?? "").trim() ||
    String(process.env.EXA_API_TOKEN ?? "").trim()
  );
}

type DataForSeoCredentials = {
  login: string;
  password: string;
};

function platformDataForSeoCredentials(): DataForSeoCredentials | null {
  const login = (
    String(process.env.DATAFORSEO_LOGIN ?? "").trim() ||
    String(process.env.DATAFORSEO_USERNAME ?? "").trim() ||
    String(process.env.DATAFORSEO_EMAIL ?? "").trim()
  );
  const password = (
    String(process.env.DATAFORSEO_PASSWORD ?? "").trim() ||
    String(process.env.DATAFORSEO_API_PASSWORD ?? "").trim()
  );
  return login && password ? { login, password } : null;
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

type LeadChainStepStage = "prospect_discovery" | "website_enrichment" | "email_discovery";

type LeadSourcingChainStep = {
  id: string;
  stage: LeadChainStepStage;
  purpose: string;
  actorId: string;
  queryHint: string;
};

type LeadSourcingChainPlan = {
  id: string;
  strategy: string;
  rationale: string;
  steps: LeadSourcingChainStep[];
};

type ProbedSourcingPlan = {
  plan: LeadSourcingChainPlan;
  probeResults: Array<{
    stepIndex: number;
    actorId: string;
    stage: LeadChainStepStage;
    outcome: "pass" | "fail";
    probeInputHash: string;
    qualityMetrics: Record<string, unknown>;
    costEstimateUsd: number;
    details: Record<string, unknown>;
  }>;
  acceptedLeads: ApifyLead[];
  rejectedLeads: LeadAcceptanceDecision[];
  acceptedCount: number;
  rejectedCount: number;
  score: number;
  budgetUsedUsd: number;
  reason: string;
};

type LeadSourcingChainData = {
  queries: string[];
  companies: string[];
  websites: string[];
  domains: string[];
  profileUrls: string[];
  emails: string[];
  phones: string[];
};

type SourcingAudienceContext = {
  rawAudience: string;
  targetAudience: string;
  triggerContext: string;
};

type ResolvedSourcingAudienceContext = SourcingAudienceContext & {
  resolutionMode: "direct" | "inferred";
  confidence: number;
  rationale: string;
};

type SemanticSignal =
  | "query"
  | "company_list"
  | "domain_list"
  | "website_list"
  | "profile_url_list"
  | "email_list"
  | "phone_list"
  | "sales_nav_url"
  | "auth_token"
  | "file_upload";

type SourcingStartState = {
  availableSignals: SemanticSignal[];
  inferredSeeds: {
    domainCount: number;
    websiteCount: number;
    emailCount: number;
    phoneCount: number;
  };
};

type ActorSemanticContract = {
  actorId: string;
  requiredInputs: SemanticSignal[];
  producedOutputs: SemanticSignal[];
  requiresAuth: boolean;
  requiresFileInput: boolean;
  confidence: number;
  rationale: string;
};

type CandidateFeasibilityStep = {
  stepIndex: number;
  actorId: string;
  stage: LeadChainStepStage;
  feasible: boolean;
  unresolved: string[];
  requiredInputs: SemanticSignal[];
  producedOutputs: SemanticSignal[];
  reason: string;
};

type CandidateFeasibility = {
  candidateId: string;
  feasible: boolean;
  score: number;
  reason: string;
  steps: CandidateFeasibilityStep[];
};

type CandidateSchemaPreflightStep = {
  stepIndex: number;
  actorId: string;
  stage: LeadChainStepStage;
  ok: boolean;
  reason: string;
  missingRequired: string[];
  requiredKeys: string[];
  inputKeys: string[];
  normalizedInputAdjustments: Array<Record<string, unknown>>;
};

type CandidateSchemaPreflight = {
  candidateId: string;
  feasible: boolean;
  reason: string;
  steps: CandidateSchemaPreflightStep[];
};

type SourcingBootstrapAttempt = {
  actorId: string;
  stage: LeadChainStepStage;
  outcome: "pass" | "fail";
  probeInputHash: string;
  reason: string;
  costEstimateUsd: number;
  rowCount: number;
  details: Record<string, unknown>;
};

type SourcingBootstrapResult = {
  chainData: LeadSourcingChainData;
  startState: SourcingStartState;
  attempts: SourcingBootstrapAttempt[];
  selectedActorIds: string[];
  budgetUsedUsd: number;
  reason: string;
};

const APIFY_CHAIN_MAX_STEPS = 3;
const APIFY_CHAIN_MAX_CANDIDATES = 6;
const APIFY_CHAIN_MAX_ITEMS_PER_STEP = 200;
const APIFY_CHAIN_EXEC_MAX_CHARGE_USD = Math.max(
  0.25,
  Math.min(5, Number(process.env.PLATFORM_APIFY_CHAIN_EXEC_MAX_CHARGE_USD ?? 1.2) || 1.2)
);
const APIFY_PROBE_STEP_COST_ESTIMATE_USD = Math.max(
  0.05,
  Math.min(1, Number(process.env.PLATFORM_APIFY_PROBE_STEP_COST_ESTIMATE_USD ?? 0.25) || 0.25)
);
const APIFY_DISCOVERY_TOTAL_BUDGET_USD = Math.max(
  APIFY_PROBE_STEP_COST_ESTIMATE_USD,
  Math.min(
    8,
    Number(process.env.PLATFORM_APIFY_DISCOVERY_TOTAL_BUDGET_USD ?? process.env.PLATFORM_APIFY_PROBE_BUDGET_USD ?? 2) ||
      2
  )
);
const APIFY_BOOTSTRAP_PROBE_BUDGET_USD = Math.max(
  APIFY_PROBE_STEP_COST_ESTIMATE_USD,
  Math.min(
    Math.max(APIFY_PROBE_STEP_COST_ESTIMATE_USD, APIFY_DISCOVERY_TOTAL_BUDGET_USD - APIFY_PROBE_STEP_COST_ESTIMATE_USD),
    Number(process.env.PLATFORM_APIFY_BOOTSTRAP_PROBE_BUDGET_USD ?? 0.75) || 0.75
  )
);
const APIFY_BOOTSTRAP_MAX_STEPS = Math.max(
  1,
  Math.min(4, Number(process.env.PLATFORM_APIFY_BOOTSTRAP_MAX_STEPS ?? 3) || 3)
);
const APIFY_PROBE_MAX_LEADS = Math.max(
  5,
  Math.min(40, Number(process.env.PLATFORM_APIFY_PROBE_MAX_LEADS ?? 15) || 15)
);
const PROBE_ICP_ALIGNMENT_MIN_SCORE = Math.max(
  0.35,
  Math.min(0.9, Number(process.env.PLATFORM_PROBE_ICP_ALIGNMENT_MIN_SCORE ?? 0.56) || 0.56)
);
const PROBE_ICP_ALIGNMENT_SAMPLE_SIZE = Math.max(
  6,
  Math.min(20, Number(process.env.PLATFORM_PROBE_ICP_ALIGNMENT_SAMPLE_SIZE ?? 12) || 12)
);

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseDeferredSourcingState(value: unknown): DeferredSourcingState | null {
  const row = asRecord(value);
  if (row.phase !== "waiting_dataforseo") return null;
  const pendingDataForSeoTasks = Array.isArray(row.pendingDataForSeoTasks)
    ? row.pendingDataForSeoTasks
        .map((entry) => asRecord(entry))
        .map(
          (entry) =>
            ({
              company: trimText(entry.company, 180),
              taskId: trimText(entry.taskId, 120),
              query: trimText(entry.query, 220),
              examples: Array.isArray(entry.examples)
                ? entry.examples
                    .map((example) => asRecord(example))
                    .map(
                      (example) =>
                        ({
                          name: trimText(example.name, 120),
                          title: trimText(example.title, 140),
                          sourceUrl: trimText(example.sourceUrl, 260),
                          company: trimText(example.company, 180),
                        }) satisfies CompanyLookupExample
                    )
                    .filter((example) => example.company)
                : [],
              pollAttempts: Math.max(0, Number(entry.pollAttempts ?? 0) || 0),
              submittedAt: trimText(entry.submittedAt, 60) || nowIso(),
            }) satisfies DataForSeoPendingTask
        )
        .filter((entry) => entry.company && entry.taskId)
    : [];
  return {
    version: 1,
    phase: "waiting_dataforseo",
    queryPlan: (row.queryPlan as ExaPeopleQueryPlan) ?? ({
      rationale: "",
      mode: "people_first",
      fallbackReason: "",
      searchSpec: {
        rationale: "",
        regions: [],
        roleTitles: [],
        companyKeywords: [],
        eventSignals: [],
        companySizeHint: "",
        includeIndustries: [],
        excludeIndustries: [],
      },
      companyRequests: [],
      peopleRequests: [],
      directPeopleRequests: [],
      companyQueries: [],
      peopleQueries: [],
      directPeopleQueries: [],
      qualifiedCompanyNames: [],
      probeMetrics: {
        candidateCount: 0,
        resolvedDomainCount: 0,
        resolvedDomainRate: 0,
        enrichmentEligibleCount: 0,
        enrichmentEligibleRate: 0,
        existingEmailCount: 0,
        uniqueCompanyCount: 0,
        icpAlignmentScore: 0,
        titleMatchRate: 0,
        companyKeywordMatchRate: 0,
        excludedKeywordHitRate: 0,
      },
    } satisfies ExaPeopleQueryPlan),
    rawLeads: Array.isArray(row.rawLeads) ? (row.rawLeads as ExaLeadCandidate[]) : [],
    diagnostics: Array.isArray(row.diagnostics) ? (row.diagnostics as ExaQueryDiagnostic[]) : [],
    companyDomainEntries: Array.isArray(row.companyDomainEntries)
      ? (row.companyDomainEntries as Array<[string, string]>)
      : [],
    pendingDataForSeoTasks,
    observedExaCostUsd: Number(row.observedExaCostUsd ?? 0) || 0,
    observedDataForSeoCostUsd: Number(row.observedDataForSeoCostUsd ?? 0) || 0,
    officialWebsiteQueryLimit: Math.max(0, Number(row.officialWebsiteQueryLimit ?? 0) || 0),
  };
}

function uniqueTrimmed(values: string[], max = 200) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function trimText(value: unknown, max = 180) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function splitAudienceAndTrigger(raw: string): Pick<SourcingAudienceContext, "targetAudience" | "triggerContext"> {
  const normalized = normalizeText(raw);
  if (!normalized) {
    return { targetAudience: "", triggerContext: "" };
  }

  const marker = normalized.match(/^(.*?)(?:\btrigger\b\s*[:\-]\s*|\btrigger\b\s+)(.+)$/i);
  if (marker) {
    const targetAudience = normalizeText(marker[1] ?? "");
    const triggerContext = normalizeText(marker[2] ?? "");
    return {
      targetAudience: targetAudience || normalized,
      triggerContext,
    };
  }

  return {
    targetAudience: normalized,
    triggerContext: "",
  };
}

function buildSourcingAudienceContext(input: {
  runtimeAudience?: string;
  hypothesisAudience?: string;
  experimentNotes?: string;
}) {
  const rawAudience = normalizeText(
    input.runtimeAudience?.trim() || input.hypothesisAudience?.trim() || input.experimentNotes?.trim() || ""
  );
  const split = splitAudienceAndTrigger(rawAudience);
  return {
    rawAudience,
    targetAudience: split.targetAudience,
    triggerContext: split.triggerContext,
  } satisfies SourcingAudienceContext;
}

function hasRoleCompanyIcpSignal(text: string) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return false;
  const roleSignals =
    /\b(cro|cmo|ceo|coo|founder|owner|head|vp|director|manager|leader|revenue|sales|marketing|growth|demand gen|revops|operations)\b/.test(
      normalized
    );
  const companySignals =
    /\b(company|companies|team|teams|organization|b2b|saas|software|enterprise|mid[- ]?market|startup|business|businesses)\b/.test(
      normalized
    );
  return roleSignals && companySignals;
}

function likelyTriggerOnlyAudience(text: string) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return false;
  return (
    /\b(trigger|demo request|abandoned demo|trial signup|sign[- ]?up|webinar attendee|event attendee|downloaded|visited)\b/.test(
      normalized
    ) &&
    !hasRoleCompanyIcpSignal(normalized)
  );
}

async function resolveSourcingAudienceContext(input: {
  base: SourcingAudienceContext;
  brandName: string;
  brandWebsite: string;
  experimentName: string;
  offer: string;
  notes: string;
}) {
  const baseTarget = normalizeText(input.base.targetAudience);
  if (baseTarget && hasRoleCompanyIcpSignal(baseTarget) && !likelyTriggerOnlyAudience(baseTarget)) {
    return {
      ...input.base,
      resolutionMode: "direct",
      confidence: 0.95,
      rationale: "existing_audience_has_icp_signal",
    } satisfies ResolvedSourcingAudienceContext;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ...input.base,
      resolutionMode: "direct",
      confidence: 0.2,
      rationale: "openai_api_key_missing_for_audience_inference",
    } satisfies ResolvedSourcingAudienceContext;
  }

  const prompt = [
    "Infer outreach ICP audience and trigger context for B2B lead sourcing.",
    "Return concise, concrete audience text suitable for actor discovery.",
    "Audience must be role/company ICP style (who at what type of companies).",
    "If a provided audience looks like a behavioral trigger (e.g. demo signup), move that to triggerContext and derive ICP from offer/brand context.",
    "No placeholders. No buzzwords. Keep audience under 20 words.",
    "Return strict JSON only:",
    '{ "targetAudience": string, "triggerContext": string, "confidence": number, "rationale": string }',
    `Context: ${JSON.stringify({
      rawAudience: input.base.rawAudience,
      targetAudience: input.base.targetAudience,
      triggerContext: input.base.triggerContext,
      brandName: input.brandName,
      brandWebsite: input.brandWebsite,
      experimentName: input.experimentName,
      offer: input.offer,
      notes: input.notes,
    })}`,
  ].join("\n");

  try {
    const model = resolveLlmModel("lead_actor_query_planning", { prompt });
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
    if (!response.ok) {
      return {
        ...input.base,
        resolutionMode: "direct",
        confidence: 0.2,
        rationale: `audience_inference_http_${response.status}`,
      } satisfies ResolvedSourcingAudienceContext;
    }
    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    const parsed = parseLooseJsonObject(extractOutputText(payload));
    const row = asRecord(parsed);
    const targetAudience = normalizeText(String(row.targetAudience ?? ""));
    const triggerContext = normalizeText(String(row.triggerContext ?? input.base.triggerContext));
    const confidence = Math.max(0, Math.min(1, Number(row.confidence ?? 0) || 0));
    const rationale = trimText(row.rationale, 220) || "llm_inferred_audience";

    if (!targetAudience || !hasRoleCompanyIcpSignal(targetAudience)) {
      return {
        ...input.base,
        resolutionMode: "direct",
        confidence: 0.25,
        rationale: "llm_audience_not_role_company_icp",
      } satisfies ResolvedSourcingAudienceContext;
    }

    return {
      rawAudience: input.base.rawAudience,
      targetAudience,
      triggerContext,
      resolutionMode: "inferred",
      confidence: confidence || 0.7,
      rationale,
    } satisfies ResolvedSourcingAudienceContext;
  } catch {
    return {
      ...input.base,
      resolutionMode: "direct",
      confidence: 0.2,
      rationale: "audience_inference_failed",
    } satisfies ResolvedSourcingAudienceContext;
  }
}

function extractOutputText(payloadRaw: unknown) {
  const payload = asRecord(payloadRaw);
  const output = Array.isArray(payload.output) ? payload.output : [];
  const contentTexts = output
    .map((item) => asRecord(item))
    .flatMap((item) => {
      const content = Array.isArray(item.content) ? item.content : [];
      return content
        .map((entry) => asRecord(entry))
        .map((entry) => String(entry.text ?? ""))
        .filter(Boolean);
    });
  return (
    String(payload.output_text ?? "") ||
    String(contentTexts[0] ?? "") ||
    "{}"
  );
}

function parseLooseJsonObject(rawText: string): unknown {
  const direct = rawText.trim();
  if (!direct) return {};
  try {
    return JSON.parse(direct);
  } catch {
    // continue
  }

  const noFence = direct.replace(/```json/gi, "```").replace(/```/g, "").trim();
  if (noFence !== direct) {
    try {
      return JSON.parse(noFence);
    } catch {
      // continue
    }
  }

  const firstBrace = noFence.indexOf("{");
  const lastBrace = noFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = noFence.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  throw new Error("Model returned non-JSON output");
}

type ExaSearchHit = {
  title: string;
  url: string;
  author: string;
  entities: Array<Record<string, unknown>>;
  highlights: string[];
  summary: string;
};

type ExaSearchResponse = {
  hits: ExaSearchHit[];
  output: unknown;
  costUsd: number;
};

type ExaSearchSpec = {
  rationale: string;
  regions: string[];
  roleTitles: string[];
  companyKeywords: string[];
  eventSignals: string[];
  companySizeHint: string;
  includeIndustries: string[];
  excludeIndustries: string[];
};

type ExaCompiledRequest = {
  stage: "company" | "people";
  category: "company" | "people";
  query: string;
  numResults: number;
  userLocation?: string;
  additionalQueries?: string[];
};

type QualifiedCompany = {
  name: string;
  domain: string;
  entityId: string;
  sourceUrl: string;
  userLocation: string;
  score: number;
  evidence: string[];
};

type ExaPeopleQueryPlan = {
  rationale: string;
  mode: "people_first" | "people_then_company";
  fallbackReason: string;
  searchSpec: ExaSearchSpec;
  companyRequests: ExaCompiledRequest[];
  peopleRequests: ExaCompiledRequest[];
  directPeopleRequests: ExaCompiledRequest[];
  companyQueries: string[];
  peopleQueries: string[];
  directPeopleQueries: string[];
  qualifiedCompanyNames: string[];
  probeMetrics: {
    candidateCount: number;
    resolvedDomainCount: number;
    resolvedDomainRate: number;
    enrichmentEligibleCount: number;
    enrichmentEligibleRate: number;
    existingEmailCount: number;
    uniqueCompanyCount: number;
    icpAlignmentScore: number;
    titleMatchRate: number;
    companyKeywordMatchRate: number;
    excludedKeywordHitRate: number;
  };
};

const NON_COMPANY_PROFILE_DOMAIN_ROOTS = new Set([
  "linkedin.com",
  "linkedin.co",
  "facebook.com",
  "x.com",
  "twitter.com",
  "instagram.com",
  "malt.com",
  "malt.fr",
  "malt.uk",
  "freelancermap.de",
  "freelancermap.com",
  "theorg.com",
  "twine.net",
]);

type ExaPeopleSourcingResult = {
  queryPlan: ExaPeopleQueryPlan;
  acceptedLeads: ApifyLead[];
  rejectedLeads: LeadAcceptanceDecision[];
  diagnostics: ExaQueryDiagnostic[];
  emailEnrichment: {
    attempted: number;
    matched: number;
    failed: number;
    provider: string;
    error: string;
    failureSummary: Array<{ reason: string; count: number }>;
    failedSamples: Array<{
      id: string;
      name: string;
      domain: string;
      reason: string;
      error: string;
      topAttemptEmail: string;
      topAttemptVerdict: string;
      topAttemptConfidence: string;
      topAttemptReason: string;
    }>;
  };
  budgetUsedUsd: number;
  exaSpendUsd: number;
  dataForSeoSpendUsd: number;
  pendingDataForSeo?: DeferredSourcingState | null;
};

type ExaLeadCandidate = ApifyLead & {
  companyEntityId?: string;
};

type CompanyLookupExample = {
  name: string;
  title: string;
  sourceUrl: string;
  company: string;
};

type UnresolvedCompanyGroup = {
  company: string;
  key: string;
  count: number;
  examples: CompanyLookupExample[];
};

type ExaQueryDiagnostic = {
  stage: "company" | "people" | "email_enrichment";
  provider: "exa" | "clearout" | "dataforseo";
  query: string;
  count: number;
  includeDomainsCount: number;
  structuredCount?: number;
  userLocation?: string;
  costUsd?: number;
  lookupCompany?: string;
  lookupExamples?: CompanyLookupExample[];
  resolvedDomain?: string;
  resolutionSource?:
    | "historical_memory"
    | "clearout"
    | "dataforseo_organic"
    | "exa_official_website";
  error?: string;
};

type ClearoutCompanyCandidate = {
  name: string;
  domain: string;
  confidenceScore: number;
  matchScore: number;
};

type DataForSeoOrganicCandidate = {
  title: string;
  url: string;
  domain: string;
  description: string;
  breadcrumb: string;
  rankAbsolute: number;
  matchScore: number;
};

type DataForSeoCompanyDecision = {
  matchFound: boolean;
  candidateIndex: number;
  domain: string;
  confidenceScore: number;
  reasoning: string;
};

type DataForSeoPendingTask = {
  company: string;
  taskId: string;
  query: string;
  examples: CompanyLookupExample[];
  pollAttempts: number;
  submittedAt: string;
};

type DeferredSourcingState = {
  version: 1;
  phase: "waiting_dataforseo";
  queryPlan: ExaPeopleQueryPlan;
  rawLeads: ExaLeadCandidate[];
  diagnostics: ExaQueryDiagnostic[];
  companyDomainEntries: Array<[string, string]>;
  pendingDataForSeoTasks: DataForSeoPendingTask[];
  observedExaCostUsd: number;
  observedDataForSeoCostUsd: number;
  officialWebsiteQueryLimit: number;
};

const DATAFORSEO_AGGREGATOR_DOMAIN_ROOTS = new Set([
  "linkedin.com",
  "bloomberg.com",
  "crunchbase.com",
  "zoominfo.com",
  "rocketreach.co",
  "theorg.com",
  "pitchbook.com",
  "craft.co",
  "owler.com",
  "glassdoor.com",
  "apollo.io",
  "lead411.com",
  "signalhire.com",
  "contactout.com",
]);
const DATAFORSEO_ASYNC_REQUEUE_SECONDS = Math.max(
  15,
  Math.min(300, Number(process.env.DATAFORSEO_ASYNC_REQUEUE_SECONDS ?? 30) || 30)
);
const DATAFORSEO_ASYNC_MAX_POLLS = Math.max(
  3,
  Math.min(60, Number(process.env.DATAFORSEO_ASYNC_MAX_POLLS ?? 12) || 12)
);

const REGION_ALIASES = new Map<string, string>([
  ["united states", "us"],
  ["u.s.", "us"],
  ["u.s", "us"],
  ["usa", "us"],
  ["us", "us"],
  ["canada", "ca"],
  ["ca", "ca"],
  ["united kingdom", "gb"],
  ["uk", "gb"],
  ["great britain", "gb"],
  ["britain", "gb"],
  ["england", "gb"],
  ["gb", "gb"],
  ["ireland", "ie"],
  ["ie", "ie"],
  ["germany", "de"],
  ["de", "de"],
  ["france", "fr"],
  ["fr", "fr"],
  ["netherlands", "nl"],
  ["holland", "nl"],
  ["nl", "nl"],
  ["spain", "es"],
  ["es", "es"],
  ["italy", "it"],
  ["it", "it"],
  ["australia", "au"],
  ["au", "au"],
  ["new zealand", "nz"],
  ["nz", "nz"],
]);

const DEFAULT_EXA_COMPANY_KEYWORDS = ["B2B software", "SaaS", "cloud platform"];
const DEFAULT_EXA_ROLE_TITLES = ["Demand Generation Manager", "Growth Marketing Manager"];
const MAX_COMPANY_NAMES_PER_PEOPLE_QUERY = 4;
const EXA_QUERY_BROADENING_ENABLED = false;
const TITLE_HINT_TOKENS = new Set([
  "manager",
  "director",
  "head",
  "lead",
  "vp",
  "chief",
  "specialist",
  "executive",
  "coordinator",
  "owner",
  "founder",
  "president",
]);

function humanList(values: string[], limit: number, conjunction: "and" | "or" = "and") {
  const items = uniqueTrimmed(
    values
      .map((value) => normalizeText(value))
      .filter(Boolean),
    limit
  );
  if (!items.length) return "";
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}

function isLikelyTitlePhrase(value: string) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return false;
  return Array.from(TITLE_HINT_TOKENS).some((token) => normalized.includes(token));
}

function extractAudienceCompanyDescriptorSegment(targetAudience: string) {
  const normalized = normalizeText(targetAudience);
  if (!normalized) return "";
  const afterAt = normalized.split(/\bat\b/i).slice(1).join(" at ").trim();
  if (!afterAt) return "";
  const cut = afterAt
    .split(/\b(?:who|that|which|running|run|using|with|where|active|actively|focused|focus)\b/i)[0]
    ?.trim() ?? "";
  return normalizeText(
    cut
      .replace(/\([^)]*employees[^)]*\)/gi, " ")
      .replace(/\b\d[\d,\s-–to]{1,20}\s+employees\b/gi, " ")
      .replace(/\b(company|companies|team|teams|organization|organizations|business|businesses)\b/gi, " ")
      .replace(/\s+/g, " ")
  );
}

function deriveAudienceCompanyDescriptors(targetAudience: string, limit = 6) {
  const segment = extractAudienceCompanyDescriptorSegment(targetAudience);
  if (!segment) return [] as string[];
  const rawParts = segment
    .split(/\s*,\s*|\s+\bor\b\s+|\s+\band\b\s+/i)
    .map((part) =>
      normalizeText(
        part
          .replace(/^[^a-z0-9]+/i, "")
          .replace(/\b(company|companies|team|teams|organization|organizations|business|businesses)\b/gi, " ")
          .replace(/\s+/g, " ")
      )
    )
    .filter(Boolean)
    .filter((part) => !AUDIENCE_COMPANY_KEYWORD_STOPWORDS.has(part.toLowerCase()))
    .filter((part) => part.length >= 3)
    .filter((part) => !["b2b", "tech", "technology"].includes(part.toLowerCase()));

  const descriptors = uniqueTrimmed(rawParts, limit);
  if (descriptors.length) return descriptors;
  const fallback = normalizeText(segment);
  return fallback ? [trimText(fallback, 48)] : [];
}

function deriveExplicitRegionCodes(...parts: Array<string | undefined>) {
  const text = parts
    .map((value) => normalizeText(value ?? ""))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!text) return [] as string[];
  const seen = new Set<string>();
  for (const [alias, code] of REGION_ALIASES.entries()) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `\\b(?:in|across|within|throughout|from|based in|located in|covering|serving)\\s+${escaped}\\b`,
      "i"
    );
    if (!pattern.test(text)) continue;
    seen.add(code);
    if (seen.size >= 3) break;
  }
  return Array.from(seen);
}

function sanitizeSearchSpec(input: {
  spec: ExaSearchSpec;
  targetAudience: string;
  triggerContext: string;
}) {
  const combined = `${input.targetAudience} ${input.triggerContext}`.toLowerCase();
  const wantsB2BSoftware =
    combined.includes("b2b software") ||
    combined.includes("b2b saas") ||
    combined.includes("saas") ||
    combined.includes("software");
  const includesWebinars =
    combined.includes("webinar") ||
    combined.includes("virtual event") ||
    combined.includes("on-demand webinar") ||
    combined.includes("webinars");

  const cleanedCompanyKeywords = uniqueTrimmed(
    input.spec.companyKeywords
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .map((item) => {
        const lowered = item.toLowerCase();
        if (wantsB2BSoftware && (lowered === "b2b tech" || lowered === "tech" || lowered === "technology")) {
          return "B2B software";
        }
        return item;
      })
      .filter((item) => !["tech", "technology"].includes(item.toLowerCase())),
    6
  );

  let companyKeywords = cleanedCompanyKeywords;
  if (!companyKeywords.length) {
    const derived = deriveAudienceCompanyDescriptors(input.targetAudience, 6);
    companyKeywords = derived.length ? derived : DEFAULT_EXA_COMPANY_KEYWORDS;
  }

  let eventSignals = [...input.spec.eventSignals];
  if (includesWebinars && !eventSignals.some((item) => item.toLowerCase().includes("webinar"))) {
    eventSignals = uniqueTrimmed([...eventSignals, "webinars"], 6);
  }

  return {
    ...input.spec,
    companyKeywords,
    includeIndustries: companyKeywords.length ? companyKeywords : input.spec.includeIndustries,
    eventSignals,
  } satisfies ExaSearchSpec;
}

function buildPeopleSearchAdditionalQueries(input: {
  spec: ExaSearchSpec;
  roleTitles: string[];
  companyNames?: string[];
  includeCompanySentence?: boolean;
}) {
  const roles = humanList(input.roleTitles, 4, "or");
  const companyProfile = humanList(input.spec.companyKeywords.length ? input.spec.companyKeywords : input.spec.includeIndustries, 3, "or");
  const companyNames = humanList(input.companyNames ?? [], MAX_COMPANY_NAMES_PER_PEOPLE_QUERY, "or");
  const target = input.includeCompanySentence && companyNames
    ? `at ${companyNames}`
    : companyProfile
      ? `at ${companyProfile} companies`
      : "at companies";
  const variants = uniqueTrimmed(
    [
      [roles || "Demand Generation Manager", target].filter(Boolean).join(" "),
      [roles || "Demand Generation Manager", target, input.spec.companySizeHint || ""].filter(Boolean).join(" "),
      ...input.spec.eventSignals.slice(0, 2).map((signal) =>
        [roles || "Demand Generation Manager", target, signal].filter(Boolean).join(" ")
      ),
    ],
    4
  );
  const primary = variants[0] ?? "";
  return variants.filter((query) => query && query !== primary).map((query) => trimText(query, 320));
}

function buildHumanCompanySearchQuery(spec: ExaSearchSpec) {
  const companyProfile = humanList(
    spec.companyKeywords.length ? spec.companyKeywords : spec.includeIndustries,
    4,
    "or"
  );
  const eventSignals = humanList(spec.eventSignals, 3, "or");
  const excludedIndustries = humanList(spec.excludeIndustries, 3, "or");
  const parts = [
    companyProfile ? `${companyProfile} companies` : "companies",
    eventSignals ? `running ${eventSignals}` : "",
    spec.companySizeHint || "",
    excludedIndustries ? `excluding ${excludedIndustries}` : "",
    "official websites",
  ];
  return trimText(parts.filter(Boolean).join(" "), 460);
}

function buildHumanPeopleSearchQuery(input: {
  spec: ExaSearchSpec;
  roleTitles: string[];
  companyNames?: string[];
  includeCompanySentence?: boolean;
  includeMotionSignals?: boolean;
  includeExclusions?: boolean;
}) {
  const roles = humanList(input.roleTitles, 4, "or");
  const eventSignals = input.includeMotionSignals ? humanList(input.spec.eventSignals, 3, "or") : "";
  const industries = humanList(
    input.spec.companyKeywords.length ? input.spec.companyKeywords : input.spec.includeIndustries,
    3,
    "or"
  );
  const companyNames = humanList(input.companyNames ?? [], MAX_COMPANY_NAMES_PER_PEOPLE_QUERY, "or");
  const excludedIndustries = input.includeExclusions ? humanList(input.spec.excludeIndustries, 3, "or") : "";
  const target = input.includeCompanySentence && companyNames
    ? `at ${companyNames}`
    : industries
      ? `at ${industries} companies`
      : "at companies";
  const parts = [
    roles || "marketing leaders",
    target,
    eventSignals ? `running ${eventSignals}` : "",
    input.spec.companySizeHint || "",
    excludedIndustries ? `excluding ${excludedIndustries}` : "",
  ];
  return trimText(parts.filter(Boolean).join(" "), 520);
}

function normalizeRegionCode(value: string) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return "";
  if (REGION_ALIASES.has(normalized)) return REGION_ALIASES.get(normalized) ?? "";
  if (/^[a-z]{2}$/.test(normalized)) return normalized;
  return "";
}

function inferRegionCodes(text: string, limit: number) {
  const haystack = normalizeText(text).toLowerCase();
  const seen = new Set<string>();
  for (const [alias, code] of REGION_ALIASES.entries()) {
    if (!haystack.includes(alias)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    if (seen.size >= limit) break;
  }
  return Array.from(seen);
}

function extractCompanySizeHint(text: string) {
  const normalized = normalizeText(text);
  const rangeMatch = normalized.match(/\b(\d{2,3}(?:,\d{3})?)\s*[–-]\s*(\d{2,3}(?:,\d{3})?)\b/);
  if (rangeMatch) {
    return `${rangeMatch[1]}-${rangeMatch[2]} employees`;
  }
  const employeesMatch = normalized.match(/\b\d{2,3}(?:,\d{3})?\s*(?:to|–|-)\s*\d{2,3}(?:,\d{3})?\s+employees\b/i);
  if (employeesMatch) {
    return trimText(employeesMatch[0], 48);
  }
  return "";
}

function fallbackRoleTitles(targetAudience: string, qualityPolicy?: LeadQualityPolicy) {
  const roleFromAudience = trimText(targetAudience.split(/\s+at\s+/i)[0] ?? "", 80);
  const titles = roleFromAudience && isLikelyTitlePhrase(roleFromAudience) ? [roleFromAudience] : [];
  if (qualityPolicy?.requiredTitleKeywords?.length) {
    for (const keyword of qualityPolicy.requiredTitleKeywords) {
      const normalized = normalizeText(keyword);
      if (!normalized) continue;
       if (!isLikelyTitlePhrase(normalized)) continue;
      titles.push(normalized);
    }
  }
  const uniqueTitles = uniqueTrimmed(titles, 6);
  return uniqueTitles.length ? uniqueTitles : DEFAULT_EXA_ROLE_TITLES;
}

function deriveExplicitEventSignals(input: { targetAudience: string; triggerContext: string }) {
  const combined = normalizeText(`${input.targetAudience} ${input.triggerContext}`).toLowerCase();
  if (!combined) return [] as string[];
  return uniqueTrimmed(
    [
      /\bwebinars?\b/.test(combined) ? "webinars" : "",
      /\bvirtual events?\b/.test(combined) ? "virtual events" : "",
      /\bon-demand webinars?\b/.test(combined) ? "on-demand webinars" : "",
      /\bevent marketing\b/.test(combined) ? "event marketing" : "",
      combined.includes("recording") ? "recordings" : "",
      combined.includes("deck") ? "decks" : "",
    ].filter(Boolean),
    6
  );
}

function buildFallbackExaSearchSpec(input: {
  targetAudience: string;
  triggerContext: string;
  qualityPolicy?: LeadQualityPolicy;
}) {
  const combined = `${input.targetAudience} ${input.triggerContext}`.trim();
  const regions = deriveExplicitRegionCodes(input.targetAudience, input.triggerContext);
  const roleTitles = fallbackRoleTitles(input.targetAudience, input.qualityPolicy);
  const audienceCompanyDescriptors = deriveAudienceCompanyDescriptors(input.targetAudience, 6);
  const companyKeywords = audienceCompanyDescriptors.length
    ? audienceCompanyDescriptors
    : uniqueTrimmed(
        [
          ...(input.qualityPolicy?.requiredCompanyKeywords ?? []).filter((keyword) => keyword.split(/\s+/).length > 1),
          ...DEFAULT_EXA_COMPANY_KEYWORDS,
        ],
        6
      );
  const eventSignals = deriveExplicitEventSignals({
    targetAudience: input.targetAudience,
    triggerContext: input.triggerContext,
  });
  const excludeIndustries = uniqueTrimmed(input.qualityPolicy?.excludedCompanyKeywords ?? [], 8);
  const spec = {
    rationale: "deterministic_search_spec",
    regions,
    roleTitles: roleTitles.length ? roleTitles : DEFAULT_EXA_ROLE_TITLES,
    companyKeywords: companyKeywords.length ? companyKeywords : DEFAULT_EXA_COMPANY_KEYWORDS,
    eventSignals,
    companySizeHint: extractCompanySizeHint(combined),
    includeIndustries: companyKeywords.length ? companyKeywords : DEFAULT_EXA_COMPANY_KEYWORDS,
    excludeIndustries,
  } satisfies ExaSearchSpec;
  return sanitizeSearchSpec({
    spec,
    targetAudience: input.targetAudience,
    triggerContext: input.triggerContext,
  });
}

function buildExaSearchSpecFromModel(
  root: Record<string, unknown>,
  input: { targetAudience: string; triggerContext: string; qualityPolicy?: LeadQualityPolicy }
) {
  const fallback = buildFallbackExaSearchSpec(input);
  const regions = uniqueTrimmed(
    (Array.isArray(root.regions) ? root.regions : [])
      .map((item) => normalizeRegionCode(String(item ?? "")))
      .filter(Boolean),
    3
  );
  const roleTitles = uniqueTrimmed(
    (Array.isArray(root.roleTitles) ? root.roleTitles : [])
      .map((item) => normalizeText(String(item ?? "")))
      .filter(Boolean),
    6
  );
  const companyKeywords = uniqueTrimmed(
    (Array.isArray(root.companyKeywords) ? root.companyKeywords : [])
      .map((item) => normalizeText(String(item ?? "")))
      .filter(Boolean),
    6
  );
  const eventSignals = uniqueTrimmed(
    (Array.isArray(root.eventSignals) ? root.eventSignals : [])
      .map((item) => normalizeText(String(item ?? "")))
      .filter(Boolean),
    6
  );
  const includeIndustries = uniqueTrimmed(
    (Array.isArray(root.includeIndustries) ? root.includeIndustries : [])
      .map((item) => normalizeText(String(item ?? "")))
      .filter(Boolean),
    6
  );
  const excludeIndustries = uniqueTrimmed(
    (Array.isArray(root.excludeIndustries) ? root.excludeIndustries : [])
      .map((item) => normalizeText(String(item ?? "")))
      .filter(Boolean),
    8
  );
  const companySizeHint =
    trimText(normalizeText(String(root.companySizeHint ?? "")), 48) || fallback.companySizeHint;

  const spec = {
    rationale: trimText(normalizeText(String(root.rationale ?? "")), 240) || fallback.rationale,
    regions: regions.length ? regions : fallback.regions,
    roleTitles: roleTitles.length ? roleTitles : fallback.roleTitles,
    companyKeywords: companyKeywords.length ? companyKeywords : fallback.companyKeywords,
    eventSignals: eventSignals.length ? eventSignals : fallback.eventSignals,
    companySizeHint,
    includeIndustries: includeIndustries.length ? includeIndustries : fallback.includeIndustries,
    excludeIndustries: excludeIndustries.length ? excludeIndustries : fallback.excludeIndustries,
  } satisfies ExaSearchSpec;
  return sanitizeSearchSpec({
    spec,
    targetAudience: input.targetAudience,
    triggerContext: input.triggerContext,
  });
}

function buildCompanySearchRequests(input: {
  spec: ExaSearchSpec;
  maxRequests: number;
  numResults: number;
}) {
  const regions = input.spec.regions.length ? input.spec.regions : [""];
  const requests: ExaCompiledRequest[] = [];
  for (const region of regions.slice(0, Math.max(1, input.maxRequests))) {
    requests.push({
      stage: "company",
      category: "company",
      query: buildHumanCompanySearchQuery(input.spec),
      numResults: input.numResults,
      userLocation: region || undefined,
    });
  }
  return requests;
}

function matchesAnyPhrase(haystack: string, phrases: string[]) {
  const lowered = haystack.toLowerCase();
  return phrases.filter((phrase) => {
    const normalized = normalizeText(phrase).toLowerCase();
    return normalized && lowered.includes(normalized);
  });
}

function scoreQualifiedCompany(input: {
  hit: ExaSearchHit;
  userLocation: string;
  spec: ExaSearchSpec;
  qualityPolicy: LeadQualityPolicy;
}) {
  const companyEntity =
    input.hit.entities.find((entry) => String(entry.type ?? "").toLowerCase() === "company") ?? {};
  const companyEntityRecord = asRecord(companyEntity);
  const companyEntityProps = asRecord(companyEntityRecord.properties);
  const entityName = normalizeText(String(companyEntityProps.name ?? ""));
  const entityId = String(companyEntityRecord.id ?? "").trim();
  const domain = registrableDomainFromUrl(input.hit.url);
  const name = entityName || normalizeText(input.hit.title.split(/[-|–—]/)[0] ?? "") || normalizeText(input.hit.title);
  const haystack = [
    input.hit.title,
    input.hit.url,
    entityName,
    ...input.hit.highlights,
    input.hit.summary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;
  const evidence: string[] = [];
  if (!domain || isNonCompanyProfileDomain(domain) || !name) {
    return { company: null, score: 0, evidence } as const;
  }

  score += 0.2;
  evidence.push(`domain:${domain}`);
  if (entityId) {
    score += 0.08;
    evidence.push("entity-id");
  }

  const companyMatches = matchesAnyPhrase(haystack, input.spec.companyKeywords);
  if (companyMatches.length) {
    score += Math.min(0.22, companyMatches.length * 0.08);
    evidence.push(`company:${companyMatches.slice(0, 2).join(",")}`);
  }

  const eventMatches = matchesAnyPhrase(haystack, input.spec.eventSignals);
  if (eventMatches.length) {
    score += Math.min(0.22, eventMatches.length * 0.1);
    evidence.push(`events:${eventMatches.slice(0, 2).join(",")}`);
  }

  const requiredMatches = matchesAnyPhrase(haystack, input.qualityPolicy.requiredCompanyKeywords ?? []);
  if (requiredMatches.length) {
    score += Math.min(0.18, requiredMatches.length * 0.06);
    evidence.push(`policy:${requiredMatches.slice(0, 2).join(",")}`);
  }

  const excludedMatches = matchesAnyPhrase(haystack, input.qualityPolicy.excludedCompanyKeywords ?? []);
  if (excludedMatches.length) {
    score -= Math.min(0.4, excludedMatches.length * 0.16);
    evidence.push(`excluded:${excludedMatches.slice(0, 2).join(",")}`);
  }

  const companyKey = normalizeCompanyKey(name);
  const root = domainRoot(domain);
  if (companyKey && root) {
    const compact = companyTokens(companyKey).join("");
    if (compact && (root === compact || root.startsWith(compact) || compact.startsWith(root))) {
      score += 0.1;
      evidence.push("name-domain-aligned");
    }
  }

  const normalizedScore = Math.max(0, Math.min(1, Number(score.toFixed(3))));
  return {
    company: {
      name: trimText(name, 140),
      domain,
      entityId,
      sourceUrl: input.hit.url,
      userLocation: input.userLocation,
      score: normalizedScore,
      evidence,
    } satisfies QualifiedCompany,
    score: normalizedScore,
    evidence,
  } as const;
}

function qualifyCompanyHits(input: {
  hits: Array<{ hit: ExaSearchHit; userLocation: string }>;
  spec: ExaSearchSpec;
  qualityPolicy: LeadQualityPolicy;
  limit: number;
}) {
  const ranked = new Map<string, QualifiedCompany>();
  for (const row of input.hits) {
    const scored = scoreQualifiedCompany({
      hit: row.hit,
      userLocation: row.userLocation,
      spec: input.spec,
      qualityPolicy: input.qualityPolicy,
    });
    if (!scored.company || scored.score < 0.24) continue;
    const dedupeKey = scored.company.entityId || `${normalizeCompanyKey(scored.company.name)}|${scored.company.domain}`;
    const existing = ranked.get(dedupeKey);
    if (!existing || scored.company.score > existing.score) {
      ranked.set(dedupeKey, scored.company);
    }
  }
  return Array.from(ranked.values())
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, Math.max(4, input.limit));
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildPeopleSearchRequests(input: {
  spec: ExaSearchSpec;
  qualifiedCompanies: QualifiedCompany[];
  maxRequests: number;
  numResults: number;
}) {
  const requests: ExaCompiledRequest[] = [];
  const grouped = new Map<string, QualifiedCompany[]>();
  for (const company of input.qualifiedCompanies) {
    const key = company.userLocation || "";
    const bucket = grouped.get(key) ?? [];
    bucket.push(company);
    grouped.set(key, bucket);
  }

  for (const [userLocation, companies] of grouped.entries()) {
    const sorted = [...companies].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
    const chunks = chunkArray(sorted.slice(0, input.maxRequests * MAX_COMPANY_NAMES_PER_PEOPLE_QUERY), MAX_COMPANY_NAMES_PER_PEOPLE_QUERY);
    for (const companyChunk of chunks) {
      if (requests.length >= input.maxRequests) break;
      requests.push({
        stage: "people",
        category: "people",
        query: buildHumanPeopleSearchQuery({
          spec: input.spec,
          roleTitles: input.spec.roleTitles,
          companyNames: companyChunk.map((company) => company.name),
          includeCompanySentence: true,
          includeMotionSignals: true,
          includeExclusions: false,
        }),
        numResults: input.numResults,
        userLocation: userLocation || undefined,
        additionalQueries: buildPeopleSearchAdditionalQueries({
          spec: input.spec,
          roleTitles: input.spec.roleTitles,
          companyNames: companyChunk.map((company) => company.name),
          includeCompanySentence: true,
        }),
      });
    }
  }

  if (requests.length) return requests.slice(0, input.maxRequests);

  const fallbackRegions = input.spec.regions.length ? input.spec.regions : [""];
  for (const userLocation of fallbackRegions.slice(0, Math.max(1, input.maxRequests))) {
    requests.push({
      stage: "people",
      category: "people",
      query: buildHumanPeopleSearchQuery({
        spec: input.spec,
        roleTitles: input.spec.roleTitles,
        includeMotionSignals: true,
        includeExclusions: false,
      }),
      numResults: input.numResults,
      userLocation: userLocation || undefined,
      additionalQueries: buildPeopleSearchAdditionalQueries({
        spec: input.spec,
        roleTitles: input.spec.roleTitles,
      }),
    });
  }
  return requests;
}

function buildDirectPeopleSearchRequests(input: {
  spec: ExaSearchSpec;
  maxRequests: number;
  numResults: number;
}) {
  const requests: ExaCompiledRequest[] = [];
  const fallbackRegions = input.spec.regions.length ? input.spec.regions : [""];
  const roleChunks = chunkArray(
    uniqueTrimmed(input.spec.roleTitles, Math.max(4, input.maxRequests * 4)),
    4
  );

  for (const userLocation of fallbackRegions.slice(0, Math.max(1, input.maxRequests))) {
    for (const roleChunk of roleChunks) {
      if (requests.length >= input.maxRequests) break;
      requests.push({
        stage: "people",
        category: "people",
        query: buildHumanPeopleSearchQuery({
          spec: input.spec,
          roleTitles: roleChunk.length ? roleChunk : input.spec.roleTitles,
          includeMotionSignals: true,
          includeExclusions: false,
        }),
        numResults: input.numResults,
        userLocation: userLocation || undefined,
        additionalQueries: buildPeopleSearchAdditionalQueries({
          spec: input.spec,
          roleTitles: roleChunk.length ? roleChunk : input.spec.roleTitles,
        }),
      });
    }
  }

  return requests.slice(0, Math.max(1, input.maxRequests));
}

function registrableDomainFromUrl(rawUrl: string) {
  const trimmed = String(rawUrl ?? "").trim();
  if (!trimmed) return "";
  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(normalized).hostname.toLowerCase();
    if (!host) return "";
    if (host.endsWith(".")) return "";
    const pieces = host.split(".").filter(Boolean);
    if (pieces.length <= 2) {
      const domain = pieces.join(".");
      return isBarePublicSuffix(domain) ? "" : domain;
    }
    const suffix = `${pieces[pieces.length - 2]}.${pieces[pieces.length - 1]}`;
    if (MULTI_LEVEL_TLDS.has(suffix) && pieces.length >= 3) {
      const domain = pieces.slice(-3).join(".");
      return isBarePublicSuffix(domain) ? "" : domain;
    }
    const domain = pieces.slice(-2).join(".");
    return isBarePublicSuffix(domain) ? "" : domain;
  } catch {
    return "";
  }
}

const MULTI_LEVEL_TLDS = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.in",
  "co.jp",
  "co.kr",
  "com.br",
  "com.mx",
  "com.ar",
  "com.tr",
  "com.sg",
  "com.cn",
  "com.hk",
  "com.tw",
  "com.sa",
]);

const SINGLE_LEVEL_TLDS = new Set([
  "com",
  "net",
  "org",
  "gov",
  "edu",
  "ac",
  "co",
]);

function isBarePublicSuffix(domain: string) {
  const normalized = String(domain ?? "").trim().toLowerCase().replace(/^www\./, "");
  if (!normalized) return false;
  if (MULTI_LEVEL_TLDS.has(normalized)) return true;
  if (SINGLE_LEVEL_TLDS.has(normalized)) return true;
  return false;
}

function inferDomainFromCompanyString(companyName: string) {
  const raw = normalizeText(companyName)
    .trim()
    .replace(/^@+/, "")
    .replace(/[)\],;:!?]+$/g, "");
  if (!raw) return "";

  const candidates = new Set<string>([raw]);
  for (const token of raw.split(/\s+/)) {
    if (token.includes(".")) candidates.add(token);
  }

  for (const candidate of candidates) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(candidate)) continue;
    const domain = registrableDomainFromUrl(candidate);
    if (!domain || isNonCompanyProfileDomain(domain)) continue;
    const root = domainRoot(domain);
    if (!root || root.length < 2) continue;
    return domain;
  }

  return "";
}

function isUsableCompanyDomain(domain: string) {
  const normalized = String(domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  return Boolean(
    normalized &&
      normalized.includes(".") &&
      !isNonCompanyProfileDomain(normalized) &&
      !isBarePublicSuffix(normalized)
  );
}

function isNonCompanyProfileDomain(domain: string) {
  const normalized = String(domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.+$/, "");
  if (!normalized) return false;
  for (const root of NON_COMPANY_PROFILE_DOMAIN_ROOTS) {
    if (normalized === root || normalized.endsWith(`.${root}`)) return true;
  }
  return false;
}

function exaHitsFromPayload(payloadRaw: unknown): ExaSearchHit[] {
  const payload = asRecord(payloadRaw);
  const results = Array.isArray(payload.results) ? payload.results : [];
  const hits: ExaSearchHit[] = [];
  for (const row of results) {
    const item = asRecord(row);
    const title = trimText(item.title, 220);
    const url = String(item.url ?? "").trim();
    if (!url) continue;
    const author = trimText(item.author, 120);
    const entities = Array.isArray(item.entities) ? item.entities.map((entry) => asRecord(entry)) : [];
    const highlights = Array.isArray(item.highlights)
      ? item.highlights.map((entry) => trimText(String(entry ?? ""), 320)).filter(Boolean)
      : [];
    const summary = trimText(String(item.summary ?? ""), 600);
    hits.push({ title, url, author, entities, highlights, summary });
  }
  return hits;
}

async function exaSearch(input: {
  apiKey: string;
  query: string;
  category: "people" | "company";
  numResults: number;
  includeDomains?: string[];
  userLocation?: string;
  livecrawl?: "always" | "fallback" | "never";
  searchType?: "auto" | "deep" | "deep-reasoning";
  outputSchema?: Record<string, unknown>;
  additionalQueries?: string[];
}): Promise<ExaSearchResponse> {
  const payload: Record<string, unknown> = {
    query: input.query,
    type: input.searchType ?? "auto",
    category: input.category,
    numResults: input.numResults,
    livecrawl: input.livecrawl ?? "never",
    contents: {
      highlights: {
        maxCharacters: 1200,
      },
    },
  };
  if (input.userLocation) {
    payload.userLocation = input.userLocation;
  }
  if (Array.isArray(input.includeDomains) && input.includeDomains.length) {
    payload.includeDomains = uniqueTrimmed(input.includeDomains, 100);
  }
  if (Array.isArray(input.additionalQueries) && input.additionalQueries.length) {
    payload.additionalQueries = uniqueTrimmed(input.additionalQueries, 8);
  }
  if (input.outputSchema && typeof input.outputSchema === "object" && !Array.isArray(input.outputSchema)) {
    payload.outputSchema = input.outputSchema;
  }

  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": input.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Exa search failed (${response.status}): ${trimText(raw, 240)}`);
  }
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  const payloadRecord = asRecord(parsed);
  const costRecord = asRecord(payloadRecord.costDollars);
  const costUsd = Number(costRecord.total ?? costRecord.search ?? 0) || 0;
  const output = payloadRecord.output ?? null;
  return {
    hits: exaHitsFromPayload(parsed),
    output,
    costUsd,
  };
}

function exaDirectPeopleOutputSchema() {
  return {
    type: "object",
    description: "Structured people leads with company and domain data for outbound prospecting.",
    properties: {
      leads: {
        type: "array",
        description: "List of matching people leads.",
        items: {
          type: "object",
          properties: {
            first_name: { type: "string", description: "Lead first name." },
            last_name: { type: "string", description: "Lead last name." },
            title: { type: "string", description: "Current job title." },
            company_name: { type: "string", description: "Current employer name." },
            company_domain: { type: "string", description: "Official employer website domain." },
            source_url: { type: "string", description: "Source page URL supporting this lead." },
          },
        },
      },
    },
  } as Record<string, unknown>;
}

function parseExaStructuredLeads(output: unknown) {
  const outputRecord = asRecord(output);
  let content: unknown = outputRecord.content ?? outputRecord;
  if (typeof content === "string") {
    try {
      content = JSON.parse(content);
    } catch {
      content = {};
    }
  }

  const contentRecord = asRecord(content);
  const nestedContentRecord = asRecord(contentRecord.content);
  const leads = Array.isArray(contentRecord.leads)
    ? contentRecord.leads
    : Array.isArray(nestedContentRecord.leads)
      ? nestedContentRecord.leads
      : [];
  return leads
    .map((entry) => asRecord(entry))
    .map((entry) => {
      const firstName = normalizeText(String(entry.first_name ?? ""));
      const lastName = normalizeText(String(entry.last_name ?? ""));
      const title = normalizeText(String(entry.title ?? ""));
      const companyName = normalizeText(String(entry.company_name ?? ""));
      const companyDomain = registrableDomainFromUrl(String(entry.company_domain ?? ""));
      const sourceUrl = String(entry.source_url ?? "").trim();
      const name = normalizeText(`${firstName} ${lastName}`.trim());
      return {
        name,
        firstName,
        lastName,
        title,
        companyName,
        companyDomain,
        sourceUrl,
      };
    })
    .filter(
      (entry) =>
        entry.name &&
        entry.companyName &&
        entry.companyDomain &&
        !isNonCompanyProfileDomain(entry.companyDomain)
    );
}

async function planExaPeopleQueries(input: {
  targetAudience: string;
  triggerContext: string;
  offer: string;
  maxCompanyQueries: number;
  maxPeopleQueries: number;
  companyResultsPerQuery: number;
  peopleResultsPerQuery: number;
  qualityPolicy: LeadQualityPolicy;
}): Promise<ExaPeopleQueryPlan> {
  const apiKey = process.env.OPENAI_API_KEY;
  const fallbackSpec = buildFallbackExaSearchSpec({
    targetAudience: input.targetAudience,
    triggerContext: input.triggerContext,
    qualityPolicy: input.qualityPolicy,
  });
  const deterministicOnly =
    hasRoleCompanyIcpSignal(input.targetAudience) && !likelyTriggerOnlyAudience(input.targetAudience);
  if (!apiKey || deterministicOnly) {
    const companyRequests = buildCompanySearchRequests({
      spec: fallbackSpec,
      maxRequests: input.maxCompanyQueries,
      numResults: input.companyResultsPerQuery,
    });
    return {
      rationale: fallbackSpec.rationale,
      mode: "people_first",
      fallbackReason: "",
      searchSpec: fallbackSpec,
      companyRequests,
      peopleRequests: [] as ExaCompiledRequest[],
      directPeopleRequests: [] as ExaCompiledRequest[],
      companyQueries: [] as string[],
      peopleQueries: [] as string[],
      directPeopleQueries: [] as string[],
      qualifiedCompanyNames: [] as string[],
      probeMetrics: {
        candidateCount: 0,
        resolvedDomainCount: 0,
        resolvedDomainRate: 0,
        enrichmentEligibleCount: 0,
        enrichmentEligibleRate: 0,
        existingEmailCount: 0,
        uniqueCompanyCount: 0,
        icpAlignmentScore: 0,
        titleMatchRate: 0,
        companyKeywordMatchRate: 0,
        excludedKeywordHitRate: 0,
      },
    } satisfies ExaPeopleQueryPlan;
  }
  const prompt = [
    "You design structured Exa sourcing specs for B2B outreach.",
    "Goal: find real decision-makers matching targetAudience at ICP companies.",
    "Rules:",
    "- Return structured fields only. Do not write final search strings.",
    "- regions must be ISO 3166-1 alpha-2 country codes, e.g. us, ca, gb.",
    "- roleTitles should be real job titles, not generic role fragments.",
    "- companyKeywords should describe the ICP company type only.",
    "- eventSignals should describe observable webinar/virtual-event evidence.",
    "- companySizeHint should be a compact phrase like '100-1000 employees' when relevant.",
    "- includeIndustries should be B2B company descriptors.",
    "- excludeIndustries should be major false-positive sectors to avoid.",
    "- Default to the fewest regions needed.",
    "- Never output generic broad phrases like 'technology companies' unless the context is truly broad.",
    "Return JSON only:",
    '{ "rationale": string, "regions": string[], "roleTitles": string[], "companyKeywords": string[], "eventSignals": string[], "companySizeHint": string, "includeIndustries": string[], "excludeIndustries": string[] }',
    `Context: ${JSON.stringify({
      targetAudience: input.targetAudience,
      triggerContext: input.triggerContext,
      offer: input.offer,
      maxCompanyQueries: input.maxCompanyQueries,
      maxPeopleQueries: input.maxPeopleQueries,
      qualityPolicy: input.qualityPolicy,
    })}`,
  ].join("\n");
  let searchSpec = fallbackSpec;
  try {
    const model = resolveLlmModel("lead_actor_query_planning", { prompt });
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
      throw new Error(`LLM query planner failed (${response.status}): ${trimText(raw, 220)}`);
    }
    const payload = JSON.parse(raw) as unknown;
    const parsed = parseLooseJsonObject(extractOutputText(payload));
    searchSpec = buildExaSearchSpecFromModel(asRecord(parsed), {
      targetAudience: input.targetAudience,
      triggerContext: input.triggerContext,
      qualityPolicy: input.qualityPolicy,
    });
  } catch {
    searchSpec = fallbackSpec;
  }

  const companyRequests = buildCompanySearchRequests({
    spec: searchSpec,
    maxRequests: input.maxCompanyQueries,
    numResults: input.companyResultsPerQuery,
  });

  return {
    rationale: searchSpec.rationale || "structured_exa_search_spec",
    mode: "people_first",
    fallbackReason: "",
    searchSpec,
    companyRequests,
    peopleRequests: [] as ExaCompiledRequest[],
    directPeopleRequests: [] as ExaCompiledRequest[],
    companyQueries: [] as string[],
    peopleQueries: [] as string[],
    directPeopleQueries: [] as string[],
    qualifiedCompanyNames: [] as string[],
    probeMetrics: {
      candidateCount: 0,
      resolvedDomainCount: 0,
      resolvedDomainRate: 0,
      enrichmentEligibleCount: 0,
      enrichmentEligibleRate: 0,
      existingEmailCount: 0,
      uniqueCompanyCount: 0,
      icpAlignmentScore: 0,
      titleMatchRate: 0,
      companyKeywordMatchRate: 0,
      excludedKeywordHitRate: 0,
    },
  } satisfies ExaPeopleQueryPlan;
}

function normalizeCompanyKey(value: string) {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ");
  const withoutParentheticals = normalized.replace(/\([^)]*\)/g, " ");
  const firstSegment = withoutParentheticals.split(/\s+[|–—-]\s+/)[0] ?? withoutParentheticals;
  const beforeComma = firstSegment.split(",")[0] ?? firstSegment;
  const tokens = beforeComma
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  while (tokens.length > 1 && GENERIC_COMPANY_TOKENS.has(tokens[tokens.length - 1] ?? "")) {
    tokens.pop();
  }

  return tokens.join(" ").trim();
}

const GENERIC_COMPANY_TOKENS = new Set([
  "saas",
  "software",
  "tech",
  "technology",
  "cloud",
  "b2b",
  "inc",
  "llc",
  "ltd",
  "co",
  "company",
  "group",
  "solutions",
  "services",
  "systems",
]);

function companyTokens(value: string) {
  return normalizeCompanyKey(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !GENERIC_COMPANY_TOKENS.has(token));
}

function companyAliasKeys(value: string) {
  const raw = normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ");
  if (!raw) return [] as string[];

  const variants = new Set<string>([
    raw,
    normalizeCompanyKey(raw),
    raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim(),
  ]);
  const noParentheticals = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

  if (noParentheticals.includes("/")) {
    for (const part of noParentheticals.split("/")) variants.add(part.trim());
  }
  for (const separator of ["|", " - ", " – ", " — ", ","]) {
    if (noParentheticals.includes(separator)) {
      variants.add((noParentheticals.split(separator)[0] ?? "").trim());
    }
  }
  for (const match of raw.matchAll(/\(([^)]+)\)/g)) {
    const alias = normalizeText(match[1] ?? "")
      .toLowerCase()
      .replace(/[^\w\s/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!alias) continue;
    variants.add(alias);
    if (alias.includes("/")) {
      for (const part of alias.split("/")) variants.add(part.trim());
    }
  }

  const keys = new Set<string>();
  for (const variant of variants) {
    const normalized = normalizeText(variant)
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) continue;
    const tokens = normalized
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean);
    while (tokens.length > 1 && GENERIC_COMPANY_TOKENS.has(tokens[tokens.length - 1] ?? "")) {
      tokens.pop();
    }
    const tokenKey = tokens.join(" ").trim();
    if (!tokenKey) continue;
    keys.add(tokenKey);
    const compact = tokens.join("");
    if (compact && compact !== tokenKey) keys.add(compact);
  }

  return [...keys];
}

function setCompanyDomainMappings(
  companyName: string,
  domain: string,
  companyDomainByName: Map<string, string>
) {
  const normalizedDomain = String(domain ?? "").trim().toLowerCase();
  if (!normalizedDomain || isNonCompanyProfileDomain(normalizedDomain)) return;
  for (const key of companyAliasKeys(companyName)) {
    companyDomainByName.set(key, normalizedDomain);
  }
}

function resolveCompanyDomainByName(
  companyName: string,
  companyDomainByName: Map<string, string>
) {
  const inferredFromCompanyString = inferDomainFromCompanyString(companyName);
  if (inferredFromCompanyString) return inferredFromCompanyString;
  const aliasKeys = companyAliasKeys(companyName);
  for (const key of aliasKeys) {
    const exact = companyDomainByName.get(key);
    if (exact) return exact;
  }
  const keyTokens = uniqueTrimmed(aliasKeys.flatMap((key) => companyTokens(key)), 30);
  if (!keyTokens.length) return "";
  for (const [candidate, domain] of companyDomainByName.entries()) {
    const candidateTokens = companyTokens(candidate);
    if (!candidateTokens.length) continue;
    const overlap = keyTokens.filter((token) => candidateTokens.includes(token)).length;
    if (overlap >= 2) {
      return domain;
    }
    if (overlap === 1 && keyTokens.length === 1 && candidateTokens.length === 1) {
      return domain;
    }
  }
  return "";
}

function domainRoot(domain: string) {
  const normalized = String(domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!normalized) return "";
  return normalized.split(".", 1)[0] ?? "";
}

function scoreCompanyNameMatch(companyName: string, candidateName: string, candidateDomain: string) {
  const queryKey = normalizeCompanyKey(companyName);
  const candidateKey = normalizeCompanyKey(candidateName);
  if (!queryKey || !candidateKey) return 0;
  if (queryKey === candidateKey) return 1;
  const queryAliases = companyAliasKeys(companyName);
  const candidateAliases = companyAliasKeys(candidateName);
  if (queryAliases.some((alias) => candidateAliases.includes(alias))) {
    return 0.98;
  }

  const queryTokens = companyTokens(queryKey);
  const candidateTokens = companyTokens(candidateKey);
  if (!queryTokens.length || !candidateTokens.length) {
    return 0;
  }

  const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;
  const recall = overlap / queryTokens.length;
  const precision = overlap / candidateTokens.length;
  let score = 0.65 * recall + 0.35 * precision;

  if (queryTokens.length >= 2 && queryTokens.every((token) => candidateTokens.includes(token))) {
    score += 0.15;
  }

  const queryCompact = queryTokens.join("");
  const candidateRoot = domainRoot(candidateDomain);
  if (candidateRoot && queryCompact && (candidateRoot === queryCompact || candidateRoot.startsWith(queryCompact))) {
    score += 0.1;
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

async function resolveCompanyDomainWithClearout(companyName: string) {
  const query = normalizeCompanyKey(companyName) || normalizeText(companyName);
  if (!query) return null;

  const response = await fetch(
    `https://api.clearout.io/public/companies/autocomplete?query=${encodeURIComponent(query)}`
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Clearout autocomplete failed (${response.status}): ${trimText(raw, 220)}`);
  }

  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  const root = asRecord(payload);
  const data = Array.isArray(root.data) ? root.data : [];
  const candidates = data
    .map((entry) => asRecord(entry))
    .map((entry) => {
      const name = normalizeText(String(entry.name ?? ""));
      const domain = registrableDomainFromUrl(String(entry.domain ?? ""));
      const confidenceScore = Number(entry.confidence_score ?? 0) || 0;
      const matchScore = scoreCompanyNameMatch(query, name, domain);
      return {
        name,
        domain,
        confidenceScore,
        matchScore,
      } satisfies ClearoutCompanyCandidate;
    })
    .filter((entry) => entry.name && entry.domain && !isNonCompanyProfileDomain(entry.domain))
    .sort((left, right) => {
      const combinedLeft = left.matchScore * 100 + left.confidenceScore;
      const combinedRight = right.matchScore * 100 + right.confidenceScore;
      return combinedRight - combinedLeft;
    });

  const top = candidates[0] ?? null;
  if (!top) return null;
  if (top.matchScore < 0.85) return null;
  return top;
}

function dataForSeoTaskCostUsd() {
  return Math.max(
    0,
    Math.min(1, Number(process.env.DATAFORSEO_STANDARD_QUEUE_TASK_COST_USD ?? 0.00465) || 0.00465)
  );
}

async function submitDataForSeoStandardTask(companyName: string, credentials: DataForSeoCredentials) {
  const query = normalizeCompanyKey(companyName) || normalizeText(companyName);
  if (!query) return null;

  const postPayload = [
    {
      keyword: `${query} official website`,
      location_name: "United States",
      language_name: "English",
      device: "desktop",
      os: "windows",
      depth: 10,
    },
  ];
  const postResponse = await dataForSeoRequest({
    credentials,
    path: "/v3/serp/google/organic/task_post",
    method: "POST",
    body: postPayload,
  });
  const task = asRecord((Array.isArray(postResponse.tasks) ? postResponse.tasks : [])[0]);
  const taskId = String(task.id ?? "").trim();
  if (!taskId) {
    throw new Error(`DataForSEO task_post returned no task id for ${trimText(companyName, 80)}`);
  }
  return {
    taskId,
    query: `${query} official website`,
  };
}

function dataForSeoAuthorizationHeader(credentials: DataForSeoCredentials) {
  return `Basic ${Buffer.from(`${credentials.login}:${credentials.password}`).toString("base64")}`;
}

async function dataForSeoRequest(input: {
  credentials: DataForSeoCredentials;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
}) {
  const response = await fetch(`https://api.dataforseo.com${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Authorization: dataForSeoAuthorizationHeader(input.credentials),
      "Content-Type": "application/json",
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`DataForSEO request failed (${response.status}): ${trimText(raw, 220)}`);
  }
  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }
  return asRecord(payload);
}

function parseDataForSeoOrganicCandidates(companyName: string, payload: Record<string, unknown>) {
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const task = asRecord(tasks[0]);
  const results = Array.isArray(task.result) ? task.result : [];
  const candidates: DataForSeoOrganicCandidate[] = [];

  for (const result of results) {
    const resultRecord = asRecord(result);
    const items = Array.isArray(resultRecord.items) ? resultRecord.items : [];
    for (const itemRaw of items) {
      const item = asRecord(itemRaw);
      const type = String(item.type ?? "").trim().toLowerCase();
      if (type && type !== "organic") continue;
      const url = String(item.url ?? "").trim();
      const domain = registrableDomainFromUrl(String(item.domain ?? "") || url);
      if (!domain || isNonCompanyProfileDomain(domain)) continue;
      const title = normalizeText(String(item.title ?? ""));
      const description = trimText(item.description, 260);
      const breadcrumb = trimText(item.breadcrumb, 180);
      const rankAbsolute = Number(item.rank_absolute ?? item.rank_group ?? 999) || 999;
      const matchScore = scoreCompanyNameMatch(companyName, title || domain, domain);
      candidates.push({
        title,
        url,
        domain,
        description,
        breadcrumb,
        rankAbsolute,
        matchScore,
      });
    }
  }

  return candidates.sort((left, right) => {
    if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
    return left.rankAbsolute - right.rankAbsolute;
  });
}

async function openAiJsonObjectCall(input: { prompt: string; model: string; maxOutputTokens?: number }) {
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
      reasoning: { effort: "minimal" },
      max_output_tokens: input.maxOutputTokens ?? 700,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI JSON call failed (HTTP ${response.status}): ${trimText(raw, 260)}`);
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  return asRecord(parseLooseJsonObject(extractOutputText(payload)));
}

function isAggregatorSerpDomain(domain: string) {
  const normalized = String(domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!normalized) return false;
  for (const root of DATAFORSEO_AGGREGATOR_DOMAIN_ROOTS) {
    if (normalized === root || normalized.endsWith(`.${root}`)) return true;
  }
  return false;
}

async function selectCompanyDomainFromSerpWithLlm(input: {
  companyName: string;
  candidates: DataForSeoOrganicCandidate[];
}): Promise<DataForSeoOrganicCandidate | null> {
  const filtered = input.candidates
    .filter((candidate) => !isAggregatorSerpDomain(candidate.domain))
    .slice(0, 5);
  const candidates = filtered.length ? filtered : input.candidates.slice(0, 5);
  if (!candidates.length) return null;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const top = candidates[0] ?? null;
    return top && top.matchScore >= 0.82 ? top : null;
  }

  const prompt = [
    "Decide whether one SERP result is the official website for the target company.",
    "Use only the provided company name and SERP results.",
    "Do not guess a domain that is not present in the candidates.",
    "Treat aggregators, investor pages, directories, news coverage, LinkedIn, Crunchbase, and Wikipedia as non-matches unless the target company itself uses that domain.",
    "Return strict JSON only.",
    '{ "match_found": boolean, "candidate_index": number, "domain": string, "confidence_score": number, "reasoning": string }',
    `Target company: ${input.companyName}`,
    `Candidates: ${JSON.stringify(
      candidates.map((candidate, index) => ({
        candidate_index: index,
        domain: candidate.domain,
        title: candidate.title,
        snippet: candidate.description,
        breadcrumb: candidate.breadcrumb,
        rank_absolute: candidate.rankAbsolute,
      }))
    )}`,
  ].join("\n");

  try {
    const model = resolveLlmModel("company_domain_matcher", {
      prompt,
      legacyModelEnv: process.env.OPENAI_MODEL_COMPANY_DOMAIN_MATCHER || "gpt-5-nano",
    });
    const row = await openAiJsonObjectCall({ prompt, model, maxOutputTokens: 700 });
    const rawConfidence = Number(row.confidence_score ?? 0) || 0;
    const normalizedConfidence =
      rawConfidence > 0 && rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence;
    const decision: DataForSeoCompanyDecision = {
      matchFound: row.match_found === true,
      candidateIndex: Math.round(Number(row.candidate_index ?? -1)),
      domain: registrableDomainFromUrl(String(row.domain ?? "")),
      confidenceScore: Math.max(0, Math.min(100, normalizedConfidence)),
      reasoning: trimText(row.reasoning, 260),
    };
    if (!decision.matchFound) return null;
    if (!Number.isFinite(decision.candidateIndex) || decision.candidateIndex < 0) return null;
    const selected = candidates[decision.candidateIndex] ?? null;
    if (!selected) return null;
    if (!decision.domain || decision.domain !== selected.domain) return null;
    if (decision.confidenceScore < 70) return null;
    return selected;
  } catch {
    const top = candidates[0] ?? null;
    return top && top.matchScore >= 0.82 ? top : null;
  }
}

async function pollDataForSeoStandardTask(input: {
  companyName: string;
  taskId: string;
  credentials: DataForSeoCredentials;
}) {
  const taskPayload = await dataForSeoRequest({
    credentials: input.credentials,
    path: `/v3/serp/google/organic/task_get/regular/${encodeURIComponent(input.taskId)}`,
  });
  const taskRow = asRecord((Array.isArray(taskPayload.tasks) ? taskPayload.tasks : [])[0]);
  const taskCostUsd = Number(taskRow.cost ?? 0) || dataForSeoTaskCostUsd();
  const statusCode = Number(taskRow.status_code ?? taskPayload.status_code ?? 0) || 0;
  const statusMessage = trimText(String(taskRow.status_message ?? taskPayload.status_message ?? ""), 160);
  const isPendingQueueStatus = statusCode === 40601 || statusCode === 40602;
  if (statusCode >= 40000 && !isPendingQueueStatus) {
    throw new Error(`DataForSEO task_get failed (${statusCode}): ${statusMessage || "unknown"}`);
  }
  const candidates = parseDataForSeoOrganicCandidates(input.companyName, taskPayload);
  if (isPendingQueueStatus) {
    return {
      status: "pending" as const,
      costUsd: taskCostUsd,
      statusCode,
      statusMessage,
    };
  }
  if (!candidates.length) {
    return {
      status: "completed" as const,
      costUsd: taskCostUsd,
      match: null,
    };
  }
  const top = await selectCompanyDomainFromSerpWithLlm({
    companyName: input.companyName,
    candidates,
  });
  return {
    status: "completed" as const,
    costUsd: taskCostUsd,
    match: top
      ? {
          ...top,
          costUsd: taskCostUsd,
          taskId: input.taskId,
        }
      : null,
  };
}

function pickCurrentCompanyFromEntity(entity: Record<string, unknown>) {
  const props = asRecord(entity.properties);
  const workHistory = Array.isArray(props.workHistory) ? props.workHistory : [];
  for (const entry of workHistory) {
    const row = asRecord(entry);
    const dates = asRecord(row.dates);
    const to = String(dates.to ?? "").trim();
    const company = asRecord(row.company);
    const companyName = normalizeText(String(company.name ?? ""));
    const companyEntityId = String(company.id ?? "").trim();
    const title = normalizeText(String(row.title ?? ""));
    if (companyName && !to) {
      return { companyName, companyEntityId, title };
    }
  }
  const first = asRecord(workHistory[0]);
  if (Object.keys(first).length) {
    const company = asRecord(first.company);
    return {
      companyName: normalizeText(String(company.name ?? "")),
      companyEntityId: String(company.id ?? "").trim(),
      title: normalizeText(String(first.title ?? "")),
    };
  }
  return { companyName: "", companyEntityId: "", title: "" };
}

function backfillLeadDomains(input: {
  rawLeads: ExaLeadCandidate[];
  companyDomainByEntityId: Map<string, string>;
  companyDomainByName: Map<string, string>;
}) {
  for (const lead of input.rawLeads) {
    if (lead.domain) continue;
    const resolved =
      (lead.companyEntityId ? input.companyDomainByEntityId.get(lead.companyEntityId) ?? "" : "") ||
      resolveCompanyDomainByName(lead.company, input.companyDomainByName);
    if (!resolved || isNonCompanyProfileDomain(resolved)) continue;
    lead.domain = resolved;
  }
}

function appendPeopleHitsToLeadPool(input: {
  hits: ExaSearchHit[];
  rawLeads: ExaLeadCandidate[];
  seen: Set<string>;
  maxRaw: number;
  companyDomains: Set<string>;
  companyDomainByName: Map<string, string>;
  companyDomainByEntityId: Map<string, string>;
  qualifiedCompanyKeySet?: Set<string>;
  qualifiedCompanyEntityIdSet?: Set<string>;
}) {
  for (const hit of input.hits) {
    if (input.rawLeads.length >= input.maxRaw) break;
    const personEntity =
      hit.entities.find((entry) => String(entry.type ?? "").toLowerCase() === "person") ?? {};
    const person = asRecord(asRecord(personEntity).properties);
    const name = normalizeText(
      String(person.name ?? "") || String(hit.author ?? "") || String(hit.title ?? "")
    );
    const { companyName, companyEntityId, title } = pickCurrentCompanyFromEntity(asRecord(personEntity));
    const email = extractFirstEmailAddress(String(person.email ?? ""));
    const company = companyName || normalizeText(String(person.currentCompany ?? ""));
    if (!name || !company) continue;

    const emailDomain = email.includes("@") ? (email.split("@")[1] || "").trim().toLowerCase() : "";
    if (emailDomain && !isNonCompanyProfileDomain(emailDomain)) {
      input.companyDomains.add(emailDomain);
      if (companyEntityId) input.companyDomainByEntityId.set(companyEntityId, emailDomain);
      setCompanyDomainMappings(company, emailDomain, input.companyDomainByName);
    }
    const companyStringDomain = inferDomainFromCompanyString(company);
    if (companyStringDomain) {
      input.companyDomains.add(companyStringDomain);
      if (companyEntityId) input.companyDomainByEntityId.set(companyEntityId, companyStringDomain);
      setCompanyDomainMappings(company, companyStringDomain, input.companyDomainByName);
    }

    const inferredDomain =
      (companyEntityId ? input.companyDomainByEntityId.get(companyEntityId) ?? "" : "") ||
      resolveCompanyDomainByName(company, input.companyDomainByName) ||
      "";
    const companyKeys = companyAliasKeys(company);
    const restrictToQualifiedCompanies =
      Boolean(input.qualifiedCompanyKeySet?.size) || Boolean(input.qualifiedCompanyEntityIdSet?.size);
    const matchedQualifiedCompany =
      (companyEntityId && input.qualifiedCompanyEntityIdSet?.has(companyEntityId)) ||
      companyKeys.some((key) => input.qualifiedCompanyKeySet?.has(key)) ||
      Boolean(inferredDomain);
    if (restrictToQualifiedCompanies && !matchedQualifiedCompany) continue;

    const dedupeKey = `${name.toLowerCase()}|${company.toLowerCase()}`;
    if (input.seen.has(dedupeKey)) continue;
    input.seen.add(dedupeKey);

    input.rawLeads.push({
      email,
      name: trimText(name, 120),
      company: trimText(company, 140),
      title: trimText(title, 140),
      domain: emailDomain || inferredDomain,
      sourceUrl: hit.url,
      companyEntityId,
    });
  }
}

function buildUnresolvedCompanyGroups(input: {
  rawLeads: ExaLeadCandidate[];
  companyDomainByName: Map<string, string>;
}) {
  const groups = new Map<string, UnresolvedCompanyGroup>();
  for (const lead of input.rawLeads) {
    if (lead.domain || !lead.company) continue;
    if (resolveCompanyDomainByName(lead.company, input.companyDomainByName)) continue;
    const key = normalizeCompanyKey(lead.company);
    if (!key) continue;
    const current =
      groups.get(key) ??
      ({
        company: lead.company,
        key,
        count: 0,
        examples: [],
      } satisfies UnresolvedCompanyGroup);
    current.count += 1;
    if (
      current.examples.length < 3 &&
      !current.examples.some(
        (entry) =>
          entry.name === lead.name &&
          entry.title === lead.title &&
          entry.sourceUrl === lead.sourceUrl
      )
    ) {
      current.examples.push({
        name: lead.name,
        title: lead.title,
        sourceUrl: lead.sourceUrl,
        company: lead.company,
      });
    }
    groups.set(key, current);
  }

  return [...groups.values()].sort(
    (left, right) => right.count - left.count || left.company.localeCompare(right.company)
  );
}

function companyDomainEntriesFromMap(companyDomainByName: Map<string, string>) {
  return [...companyDomainByName.entries()]
    .map(([companyKey, domain]) => [String(companyKey ?? ""), String(domain ?? "")] as [string, string])
    .filter(([companyKey, domain]) => Boolean(companyKey) && Boolean(domain));
}

function companyDomainMapFromEntries(entries: Array<[string, string]>) {
  const map = new Map<string, string>();
  for (const [companyKey, domain] of entries) {
    const normalizedDomain = registrableDomainFromUrl(domain);
    if (!companyKey || !normalizedDomain || isNonCompanyProfileDomain(normalizedDomain)) continue;
    map.set(companyKey, normalizedDomain);
  }
  return map;
}

async function resolveCompanyDomainsWithHistoricalAndClearout(input: {
  rawLeads: ExaLeadCandidate[];
  companyDomainByName: Map<string, string>;
  diagnostics: ExaQueryDiagnostic[];
}) {
  const initialGroups = buildUnresolvedCompanyGroups({
    rawLeads: input.rawLeads,
    companyDomainByName: input.companyDomainByName,
  });

  if (initialGroups.length) {
    const historicalMatches = await loadHistoricalCompanyDomains(
      uniqueTrimmed(
        initialGroups.flatMap((group) => companyAliasKeys(group.company)),
        Math.max(initialGroups.length * 8, 100)
      )
    );
    for (const row of historicalMatches) {
      const resolvedDomain = registrableDomainFromUrl(row.domain);
      if (!resolvedDomain || isNonCompanyProfileDomain(resolvedDomain)) continue;
      setCompanyDomainMappings(row.company, resolvedDomain, input.companyDomainByName);
    }
    if (historicalMatches.length) {
      backfillLeadDomains({
        rawLeads: input.rawLeads,
        companyDomainByEntityId: new Map<string, string>(),
        companyDomainByName: input.companyDomainByName,
      });
    }
  }

  const unresolvedGroups = buildUnresolvedCompanyGroups({
    rawLeads: input.rawLeads,
    companyDomainByName: input.companyDomainByName,
  });
  const unresolvedAfterClearout: UnresolvedCompanyGroup[] = [];

  for (const batch of chunkArray(unresolvedGroups, 8)) {
    const results = await Promise.all(
      batch.map(async (group) => {
        try {
          const clearoutMatch = await resolveCompanyDomainWithClearout(group.company);
          return { group, clearoutMatch } as const;
        } catch {
          return { group, clearoutMatch: null } as const;
        }
      })
    );

    for (const result of results) {
      const clearoutQuery = `Clearout autocomplete: ${result.group.company}`;
      if (result.clearoutMatch?.domain) {
        setCompanyDomainMappings(result.group.company, result.clearoutMatch.domain, input.companyDomainByName);
        input.diagnostics.push({
          stage: "company",
          provider: "clearout",
          query: clearoutQuery,
          count: 1,
          includeDomainsCount: 0,
          lookupCompany: result.group.company,
          lookupExamples: result.group.examples,
          resolvedDomain: result.clearoutMatch.domain,
          resolutionSource: "clearout",
        });
        continue;
      }

      input.diagnostics.push({
        stage: "company",
        provider: "clearout",
        query: clearoutQuery,
        count: 0,
        includeDomainsCount: 0,
        lookupCompany: result.group.company,
        lookupExamples: result.group.examples,
      });
      unresolvedAfterClearout.push(result.group);
    }
  }

  return unresolvedAfterClearout;
}

async function submitPendingDataForSeoTasks(input: {
  unresolvedGroups: UnresolvedCompanyGroup[];
  credentials: DataForSeoCredentials | null;
  diagnostics: ExaQueryDiagnostic[];
}) {
  if (!input.credentials) return [] as DataForSeoPendingTask[];
  const pendingTasks: DataForSeoPendingTask[] = [];

  for (const batch of chunkArray(input.unresolvedGroups, 6)) {
    const results = await Promise.all(
      batch.map(async (group) => {
        try {
          const submitted = await submitDataForSeoStandardTask(group.company, input.credentials as DataForSeoCredentials);
          return { group, submitted, error: "" } as const;
        } catch (error) {
          return {
            group,
            submitted: null,
            error:
              error instanceof Error
                ? trimText(error.message, 260)
                : trimText(String(error ?? ""), 260),
          } as const;
        }
      })
    );

    for (const result of results) {
      const query = `DataForSEO standard queue: ${result.group.company} official website`;
      if (result.submitted?.taskId) {
        pendingTasks.push({
          company: result.group.company,
          taskId: result.submitted.taskId,
          query,
          examples: result.group.examples,
          pollAttempts: 0,
          submittedAt: nowIso(),
        });
        continue;
      }

      input.diagnostics.push({
        stage: "company",
        provider: "dataforseo",
        query,
        count: 0,
        includeDomainsCount: 0,
        costUsd: 0,
        lookupCompany: result.group.company,
        lookupExamples: result.group.examples,
        error: result.error || undefined,
      });
    }
  }

  return pendingTasks;
}

async function pollPendingDataForSeoTasks(input: {
  pendingTasks: DataForSeoPendingTask[];
  credentials: DataForSeoCredentials;
  companyDomainByName: Map<string, string>;
  diagnostics: ExaQueryDiagnostic[];
  onDataForSeoCost?: (costUsd: number) => void;
}) {
  const stillPending: DataForSeoPendingTask[] = [];
  const terminalUnresolvedCompanies = new Set<string>();

  for (const batch of chunkArray(input.pendingTasks, 6)) {
    const results = await Promise.all(
      batch.map(async (pending) => {
        try {
          const polled = await pollDataForSeoStandardTask({
            companyName: pending.company,
            taskId: pending.taskId,
            credentials: input.credentials,
          });
          return { pending, polled, error: "" } as const;
        } catch (error) {
          return {
            pending,
            polled: null,
            error:
              error instanceof Error
                ? trimText(error.message, 260)
                : trimText(String(error ?? ""), 260),
          } as const;
        }
      })
    );

    for (const result of results) {
      const query = result.pending.query;
      if (result.error) {
        input.diagnostics.push({
          stage: "company",
          provider: "dataforseo",
          query,
          count: 0,
          includeDomainsCount: 0,
          costUsd: 0,
          lookupCompany: result.pending.company,
          lookupExamples: result.pending.examples,
          error: result.error,
        });
        terminalUnresolvedCompanies.add(result.pending.company);
        continue;
      }

      if (!result.polled) {
        terminalUnresolvedCompanies.add(result.pending.company);
        continue;
      }

      if (result.polled.status === "pending") {
        const nextPollAttempts = result.pending.pollAttempts + 1;
        if (nextPollAttempts >= DATAFORSEO_ASYNC_MAX_POLLS) {
          input.diagnostics.push({
            stage: "company",
            provider: "dataforseo",
            query,
            count: 0,
            includeDomainsCount: 0,
            costUsd: 0,
            lookupCompany: result.pending.company,
            lookupExamples: result.pending.examples,
            error: `task_pending_timeout:${result.polled.statusCode}`,
          });
          terminalUnresolvedCompanies.add(result.pending.company);
          continue;
        }
        stillPending.push({
          ...result.pending,
          pollAttempts: nextPollAttempts,
        });
        continue;
      }

      input.onDataForSeoCost?.(result.polled.costUsd);
      if (result.polled.match?.domain) {
        setCompanyDomainMappings(result.pending.company, result.polled.match.domain, input.companyDomainByName);
        input.diagnostics.push({
          stage: "company",
          provider: "dataforseo",
          query,
          count: 1,
          includeDomainsCount: 0,
          costUsd: result.polled.costUsd,
          lookupCompany: result.pending.company,
          lookupExamples: result.pending.examples,
          resolvedDomain: result.polled.match.domain,
          resolutionSource: "dataforseo_organic",
        });
        continue;
      }

      input.diagnostics.push({
        stage: "company",
        provider: "dataforseo",
        query,
        count: 0,
        includeDomainsCount: 0,
        costUsd: result.polled.costUsd,
        lookupCompany: result.pending.company,
        lookupExamples: result.pending.examples,
      });
      terminalUnresolvedCompanies.add(result.pending.company);
    }
  }

  return {
    stillPending,
    terminalUnresolvedCompanies,
  };
}

async function runExaFallbackCompanyResolution(input: {
  unresolvedGroups: UnresolvedCompanyGroup[];
  exaApiKey: string;
  companyDomainByName: Map<string, string>;
  diagnostics: ExaQueryDiagnostic[];
  exaFallbackLimit: number;
  onExaCost?: (costUsd: number) => void;
}) {
  if (input.exaFallbackLimit <= 0) return;
  for (const group of input.unresolvedGroups.slice(0, input.exaFallbackLimit)) {
    try {
      const query = `${group.company} official website`;
      const response = await exaSearch({
        apiKey: input.exaApiKey,
        query,
        category: "company",
        numResults: 1,
      });
      input.onExaCost?.(response.costUsd);
      const resolvedDomain = registrableDomainFromUrl(response.hits[0]?.url ?? "");
      if (resolvedDomain && !isNonCompanyProfileDomain(resolvedDomain)) {
        setCompanyDomainMappings(group.company, resolvedDomain, input.companyDomainByName);
      }
      input.diagnostics.push({
        stage: "company",
        provider: "exa",
        query,
        count: response.hits.length,
        includeDomainsCount: 0,
        costUsd: response.costUsd,
        lookupCompany: group.company,
        lookupExamples: group.examples,
        resolvedDomain: resolvedDomain || undefined,
        resolutionSource: resolvedDomain ? "exa_official_website" : undefined,
      });
    } catch {
      input.diagnostics.push({
        stage: "company",
        provider: "exa",
        query: `${group.company} official website`,
        count: 0,
        includeDomainsCount: 0,
        lookupCompany: group.company,
        lookupExamples: group.examples,
      });
    }
  }
}

async function sourceLeadsFromExa(input: {
  exaApiKey: string;
  dataForSeoCredentials: DataForSeoCredentials | null;
  targetAudience: string;
  triggerContext: string;
  offer: string;
  qualityPolicy: LeadQualityPolicy;
  maxLeads: number;
  allowMissingEmail: boolean;
  emailFinderApiBaseUrl?: string;
  emailFinderVerificationMode?: "validatedmails";
  emailFinderValidatedMailsApiKey?: string;
  resumeState?: DeferredSourcingState | null;
}) {
  const companyQueryLimit = Math.max(1, Math.min(2, input.maxLeads <= 50 ? 1 : 2));
  const peopleQueryLimit = Math.max(1, Math.min(2, input.maxLeads <= 50 ? 1 : 2));
  const directPeopleProbeLimit = 1;
  const companyResultsPerQuery = input.maxLeads <= 50 ? 15 : 20;
  const peopleResultsPerQuery = input.maxLeads <= 50 ? 60 : 100;
  const officialWebsiteQueryLimit =
    input.resumeState?.officialWebsiteQueryLimit ??
    (input.maxLeads <= 50 ? 3 : input.maxLeads <= 150 ? 4 : 5);

  let queryPlan: ExaPeopleQueryPlan;
  let diagnostics: ExaQueryDiagnostic[];
  let rawLeads: ExaLeadCandidate[];
  const companyDomainByName = input.resumeState
    ? companyDomainMapFromEntries(input.resumeState.companyDomainEntries)
    : new Map<string, string>();
  const companyDomainByEntityId = new Map<string, string>();
  let observedExaCostUsd = Number(input.resumeState?.observedExaCostUsd ?? 0) || 0;
  let observedDataForSeoCostUsd = Number(input.resumeState?.observedDataForSeoCostUsd ?? 0) || 0;

  if (input.resumeState?.phase === "waiting_dataforseo") {
    queryPlan = input.resumeState.queryPlan;
    diagnostics = [...input.resumeState.diagnostics];
    rawLeads = input.resumeState.rawLeads.map((lead) => ({ ...lead }));
    backfillLeadDomains({ rawLeads, companyDomainByEntityId, companyDomainByName });

    const pendingDataForSeoTasks = input.resumeState.pendingDataForSeoTasks ?? [];
    if (input.dataForSeoCredentials && pendingDataForSeoTasks.length) {
      const polled = await pollPendingDataForSeoTasks({
        pendingTasks: pendingDataForSeoTasks,
        credentials: input.dataForSeoCredentials,
        companyDomainByName,
        diagnostics,
        onDataForSeoCost: (costUsd) => {
          observedDataForSeoCostUsd += costUsd;
        },
      });
      backfillLeadDomains({ rawLeads, companyDomainByEntityId, companyDomainByName });
      if (polled.stillPending.length) {
        return {
          queryPlan,
          acceptedLeads: [],
          rejectedLeads: [],
          diagnostics,
          emailEnrichment: {
            attempted: 0,
            matched: 0,
            failed: 0,
            provider: "emailfinder.batch",
            error: "",
            failureSummary: [],
            failedSamples: [],
          },
          budgetUsedUsd: Number((observedExaCostUsd + observedDataForSeoCostUsd).toFixed(3)),
          exaSpendUsd: Number(observedExaCostUsd.toFixed(3)),
          dataForSeoSpendUsd: Number(observedDataForSeoCostUsd.toFixed(3)),
          pendingDataForSeo: {
            version: 1,
            phase: "waiting_dataforseo",
            queryPlan,
            rawLeads,
            diagnostics,
            companyDomainEntries: companyDomainEntriesFromMap(companyDomainByName),
            pendingDataForSeoTasks: polled.stillPending,
            observedExaCostUsd,
            observedDataForSeoCostUsd,
            officialWebsiteQueryLimit,
          },
        } satisfies ExaPeopleSourcingResult;
      }
    }

    const unresolvedAfterDataForSeo = buildUnresolvedCompanyGroups({
      rawLeads,
      companyDomainByName,
    });
    await runExaFallbackCompanyResolution({
      unresolvedGroups: unresolvedAfterDataForSeo,
      exaApiKey: input.exaApiKey,
      companyDomainByName,
      diagnostics,
      exaFallbackLimit: officialWebsiteQueryLimit,
      onExaCost: (costUsd) => {
        observedExaCostUsd += costUsd;
      },
    });
    backfillLeadDomains({ rawLeads, companyDomainByEntityId, companyDomainByName });
  } else {
    queryPlan = await planExaPeopleQueries({
      targetAudience: input.targetAudience,
      triggerContext: input.triggerContext,
      offer: input.offer,
      maxCompanyQueries: companyQueryLimit,
      maxPeopleQueries: peopleQueryLimit,
      companyResultsPerQuery,
      peopleResultsPerQuery,
      qualityPolicy: input.qualityPolicy,
    });

    diagnostics = [];
    rawLeads = [];
    const seen = new Set<string>();
    const maxRaw = Number.POSITIVE_INFINITY;
    const companyDomains = new Set<string>();
    const plannedCompanyRequests = [...queryPlan.companyRequests];
    queryPlan.companyRequests = [] as ExaCompiledRequest[];
    queryPlan.companyQueries = [] as string[];

    const directPeopleRequests = buildDirectPeopleSearchRequests({
      spec: queryPlan.searchSpec,
      maxRequests: directPeopleProbeLimit,
      numResults: peopleResultsPerQuery,
    });
    queryPlan.directPeopleRequests = directPeopleRequests;
    queryPlan.directPeopleQueries = directPeopleRequests.map((request) => request.query);
    queryPlan.peopleRequests = [...directPeopleRequests];
    queryPlan.peopleQueries = [...queryPlan.directPeopleQueries];

    for (const request of directPeopleRequests) {
      if (rawLeads.length >= maxRaw) break;
      const response = await exaSearch({
        apiKey: input.exaApiKey,
        query: request.query,
        category: request.category,
        numResults: 100,
        userLocation: request.userLocation,
        searchType: "deep-reasoning",
        outputSchema: exaDirectPeopleOutputSchema(),
        additionalQueries: request.additionalQueries,
      });
      observedExaCostUsd += response.costUsd;
      const structuredLeads = parseExaStructuredLeads(response.output);
      for (const lead of structuredLeads) {
        if (rawLeads.length >= maxRaw) break;
        const dedupeKey = `${lead.name.toLowerCase()}|${lead.companyName.toLowerCase()}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        companyDomains.add(lead.companyDomain);
        setCompanyDomainMappings(lead.companyName, lead.companyDomain, companyDomainByName);
        rawLeads.push({
          email: "",
          name: trimText(lead.name, 120),
          company: trimText(lead.companyName, 140),
          title: trimText(lead.title, 140),
          domain: lead.companyDomain,
          sourceUrl: lead.sourceUrl,
          companyEntityId: "",
        });
      }
      appendPeopleHitsToLeadPool({
        hits: response.hits,
        rawLeads,
        seen,
        maxRaw,
        companyDomains,
        companyDomainByName,
        companyDomainByEntityId,
      });
      diagnostics.push({
        stage: "people",
        provider: "exa",
        query: request.query,
        count: response.hits.length || structuredLeads.length,
        includeDomainsCount: structuredLeads.filter((lead) => Boolean(lead.companyDomain)).length,
        structuredCount: structuredLeads.length,
        userLocation: request.userLocation,
        costUsd: response.costUsd,
      });
    }

    await resolveCompanyDomainsWithHistoricalAndClearout({
      rawLeads,
      companyDomainByName,
      diagnostics,
    });
    backfillLeadDomains({ rawLeads, companyDomainByEntityId, companyDomainByName });

    const directProbeAlignment = deterministicProbeIcpAlignment({
      leads: rawLeads,
      qualityPolicy: input.qualityPolicy,
    });
    const directResolvedDomainCount = rawLeads.filter((lead) => isUsableCompanyDomain(String(lead.domain ?? ""))).length;
    const directResolvedDomainRate = rawLeads.length
      ? Number((directResolvedDomainCount / rawLeads.length).toFixed(3))
      : 0;
    const directExistingEmailCount = rawLeads.filter((lead) => Boolean(extractFirstEmailAddress(lead.email))).length;
    const directEnrichmentEligibleCount = rawLeads.filter((lead) => {
      if (extractFirstEmailAddress(lead.email)) return false;
      return Boolean(String(lead.name ?? "").trim()) && isUsableCompanyDomain(String(lead.domain ?? ""));
    }).length;
    const directEnrichmentEligibleRate = rawLeads.length
      ? Number((directEnrichmentEligibleCount / rawLeads.length).toFixed(3))
      : 0;
    const directUniqueCompanyCount = new Set(
      rawLeads.map((lead) => normalizeCompanyKey(lead.company)).filter(Boolean)
    ).size;
    queryPlan.probeMetrics = {
      candidateCount: rawLeads.length,
      resolvedDomainCount: directResolvedDomainCount,
      resolvedDomainRate: directResolvedDomainRate,
      enrichmentEligibleCount: directEnrichmentEligibleCount,
      enrichmentEligibleRate: directEnrichmentEligibleRate,
      existingEmailCount: directExistingEmailCount,
      uniqueCompanyCount: directUniqueCompanyCount,
      icpAlignmentScore: Number(directProbeAlignment.score.toFixed(3)),
      titleMatchRate: Number(directProbeAlignment.titleMatchRate.toFixed(3)),
      companyKeywordMatchRate: Number(directProbeAlignment.companyKeywordMatchRate.toFixed(3)),
      excludedKeywordHitRate: Number(directProbeAlignment.excludedKeywordHitRate.toFixed(3)),
    };

    const directCandidateFloor = input.maxLeads <= 50 ? 4 : input.maxLeads <= 150 ? 6 : 8;
    const directResolvedDomainFloor = input.maxLeads <= 50 ? 0.45 : 0.55;
    const fallbackReasons: string[] = [];
    if (rawLeads.length < directCandidateFloor) {
      fallbackReasons.push(`candidate_floor_miss:${rawLeads.length}/${directCandidateFloor}`);
    }
    if (directResolvedDomainRate < directResolvedDomainFloor) {
      fallbackReasons.push(`domain_resolution_low:${directResolvedDomainRate}`);
    }
    if (directProbeAlignment.score < PROBE_ICP_ALIGNMENT_MIN_SCORE) {
      fallbackReasons.push(`icp_alignment_low:${Number(directProbeAlignment.score.toFixed(3))}`);
    }

    if (fallbackReasons.length && EXA_QUERY_BROADENING_ENABLED) {
      queryPlan.mode = "people_then_company";
      queryPlan.fallbackReason = fallbackReasons.join("; ");

      const companySearchHits: Array<{ hit: ExaSearchHit; userLocation: string }> = [];
      queryPlan.companyRequests = plannedCompanyRequests;
      queryPlan.companyQueries = plannedCompanyRequests.map((request) => request.query);

      for (const request of plannedCompanyRequests) {
        const response = await exaSearch({
          apiKey: input.exaApiKey,
          query: request.query,
          category: request.category,
          numResults: request.numResults,
          userLocation: request.userLocation,
          additionalQueries: request.additionalQueries,
        });
        observedExaCostUsd += response.costUsd;
        diagnostics.push({
          stage: "company",
          provider: "exa",
          query: request.query,
          count: response.hits.length,
          includeDomainsCount: 0,
          userLocation: request.userLocation,
          costUsd: response.costUsd,
        });

        for (const hit of response.hits) {
          companySearchHits.push({ hit, userLocation: request.userLocation || "" });
        }
      }

      const qualifiedCompanies = qualifyCompanyHits({
        hits: companySearchHits,
        spec: queryPlan.searchSpec,
        qualityPolicy: input.qualityPolicy,
        limit: Math.max(peopleQueryLimit * MAX_COMPANY_NAMES_PER_PEOPLE_QUERY, 12),
      });
      const qualifiedCompanyKeySet = new Set(
        qualifiedCompanies.flatMap((company) => companyAliasKeys(company.name)).filter(Boolean)
      );
      const qualifiedCompanyEntityIdSet = new Set(
        qualifiedCompanies.map((company) => company.entityId).filter(Boolean)
      );

      for (const company of qualifiedCompanies) {
        if (!company.domain || isNonCompanyProfileDomain(company.domain)) continue;
        companyDomains.add(company.domain);
        if (company.entityId) companyDomainByEntityId.set(company.entityId, company.domain);
        setCompanyDomainMappings(company.name, company.domain, companyDomainByName);
      }

      queryPlan.qualifiedCompanyNames = qualifiedCompanies.map((company) => company.name);
      const companyPeopleRequests = buildPeopleSearchRequests({
        spec: queryPlan.searchSpec,
        qualifiedCompanies,
        maxRequests: peopleQueryLimit,
        numResults: peopleResultsPerQuery,
      });
      queryPlan.peopleRequests = [...directPeopleRequests, ...companyPeopleRequests];
      queryPlan.peopleQueries = queryPlan.peopleRequests.map((request) => request.query);

      for (const request of companyPeopleRequests) {
        if (rawLeads.length >= maxRaw) break;
        const response = await exaSearch({
          apiKey: input.exaApiKey,
          query: request.query,
          category: request.category,
          numResults: request.numResults,
          userLocation: request.userLocation,
        });
        observedExaCostUsd += response.costUsd;
        diagnostics.push({
          stage: "people",
          provider: "exa",
          query: request.query,
          count: response.hits.length,
          includeDomainsCount: qualifiedCompanies.length,
          userLocation: request.userLocation,
          costUsd: response.costUsd,
        });
        appendPeopleHitsToLeadPool({
          hits: response.hits,
          rawLeads,
          seen,
          maxRaw,
          companyDomains,
          companyDomainByName,
          companyDomainByEntityId,
          qualifiedCompanyKeySet,
          qualifiedCompanyEntityIdSet,
        });
      }

      await resolveCompanyDomainsWithHistoricalAndClearout({
        rawLeads,
        companyDomainByName,
        diagnostics,
      });
      backfillLeadDomains({ rawLeads, companyDomainByEntityId, companyDomainByName });
    } else {
      queryPlan.mode = "people_first";
      queryPlan.fallbackReason = fallbackReasons.join("; ");
      queryPlan.qualifiedCompanyNames = uniqueTrimmed(
        rawLeads.map((lead) => normalizeText(lead.company)).filter(Boolean),
        12
      );
    }

    if (input.dataForSeoCredentials) {
      const unresolvedAfterClearout = buildUnresolvedCompanyGroups({
        rawLeads,
        companyDomainByName,
      });
      const pendingTasks = await submitPendingDataForSeoTasks({
        unresolvedGroups: unresolvedAfterClearout,
        credentials: input.dataForSeoCredentials,
        diagnostics,
      });
      if (pendingTasks.length) {
        return {
          queryPlan,
          acceptedLeads: [],
          rejectedLeads: [],
          diagnostics,
          emailEnrichment: {
            attempted: 0,
            matched: 0,
            failed: 0,
            provider: "emailfinder.batch",
            error: "",
            failureSummary: [],
            failedSamples: [],
          },
          budgetUsedUsd: Number((observedExaCostUsd + observedDataForSeoCostUsd).toFixed(3)),
          exaSpendUsd: Number(observedExaCostUsd.toFixed(3)),
          dataForSeoSpendUsd: Number(observedDataForSeoCostUsd.toFixed(3)),
          pendingDataForSeo: {
            version: 1,
            phase: "waiting_dataforseo",
            queryPlan,
            rawLeads,
            diagnostics,
            companyDomainEntries: companyDomainEntriesFromMap(companyDomainByName),
            pendingDataForSeoTasks: pendingTasks,
            observedExaCostUsd,
            observedDataForSeoCostUsd,
            officialWebsiteQueryLimit,
          },
        } satisfies ExaPeopleSourcingResult;
      }
    }

    const unresolvedAfterDataForSeo = buildUnresolvedCompanyGroups({
      rawLeads,
      companyDomainByName,
    });
    await runExaFallbackCompanyResolution({
      unresolvedGroups: unresolvedAfterDataForSeo,
      exaApiKey: input.exaApiKey,
      companyDomainByName,
      diagnostics,
      exaFallbackLimit: officialWebsiteQueryLimit,
      onExaCost: (costUsd) => {
        observedExaCostUsd += costUsd;
      },
    });
    backfillLeadDomains({ rawLeads, companyDomainByEntityId, companyDomainByName });
  }

  const emailEnrichment = {
    attempted: 0,
    matched: 0,
    failed: 0,
    provider: "emailfinder.batch",
    error: "",
    failureSummary: [] as Array<{ reason: string; count: number }>,
    failedSamples: [] as Array<{
      id: string;
      name: string;
      domain: string;
      reason: string;
      error: string;
      topAttemptEmail: string;
      topAttemptVerdict: string;
      topAttemptConfidence: string;
      topAttemptReason: string;
    }>,
  };
  const emailFinderApiBaseUrl = resolveEmailFinderApiBaseUrl(input.emailFinderApiBaseUrl);
  const leadsNeedingEmailEnrichment = rawLeads.filter((lead) => !extractFirstEmailAddress(lead.email)).length;
  const enrichmentEligibleLeads = rawLeads.filter((lead) => {
    if (extractFirstEmailAddress(lead.email)) return false;
    return Boolean(String(lead.name ?? "").trim()) && isUsableCompanyDomain(String(lead.domain ?? ""));
  });
  diagnostics.push({
    stage: "email_enrichment",
    provider: "exa",
    query: `EmailFinder preflight: eligible ${enrichmentEligibleLeads.length}/${rawLeads.length}, existing_email ${rawLeads.length - leadsNeedingEmailEnrichment}, usable_domain ${rawLeads.filter((lead) => isUsableCompanyDomain(String(lead.domain ?? ""))).length}`,
    count: enrichmentEligibleLeads.length,
    includeDomainsCount: rawLeads.length,
  });
  if (leadsNeedingEmailEnrichment > 0 && !emailFinderApiBaseUrl) {
    emailEnrichment.error = "EMAIL_FINDER_API_BASE_URL is missing";
      diagnostics.push({
        stage: "email_enrichment",
        provider: "exa",
        query: `EmailFinder batch skipped: ${emailEnrichment.error}`,
        count: 0,
        includeDomainsCount: leadsNeedingEmailEnrichment,
    });
  }
  if (emailFinderApiBaseUrl) {
    const enrichment = await enrichLeadsWithEmailFinderBatch({
      leads: rawLeads,
      apiBaseUrl: emailFinderApiBaseUrl,
      verificationMode: input.emailFinderVerificationMode,
      validatedMailsApiKey: input.emailFinderValidatedMailsApiKey,
      maxCandidates: 12,
      maxCredits: 7,
      concurrency: 4,
      timeoutMs: Math.max(
        20_000,
        Math.min(180_000, Number(process.env.EMAIL_FINDER_TIMEOUT_MS ?? 90_000) || 90_000)
      ),
    });
    emailEnrichment.attempted = enrichment.attempted;
    emailEnrichment.matched = enrichment.matched;
    emailEnrichment.failed = enrichment.failed;
    emailEnrichment.provider = enrichment.provider;
    emailEnrichment.error = enrichment.error;
    emailEnrichment.failureSummary = enrichment.failureSummary;
    emailEnrichment.failedSamples = enrichment.failedSamples;
    rawLeads.splice(0, rawLeads.length, ...enrichment.leads);
    if (enrichment.attempted > 0 || enrichment.error) {
      diagnostics.push({
        stage: "email_enrichment",
        provider: "exa",
        query: enrichment.ok
          ? `EmailFinder batch matched ${enrichment.matched}/${enrichment.attempted}`
          : `EmailFinder batch failed: ${trimText(enrichment.error, 180)}`,
        count: enrichment.matched,
        includeDomainsCount: enrichment.attempted,
      });
    }
  }

  const acceptedLeads: ApifyLead[] = [];
  const rejectedLeads: LeadAcceptanceDecision[] = [];
  for (const lead of rawLeads) {
    if (acceptedLeads.length >= input.maxLeads) break;
    const domain =
      (lead.email.includes("@") ? lead.email.split("@")[1] || "" : "") ||
      resolveCompanyDomainByName(lead.company, companyDomainByName) ||
      (isNonCompanyProfileDomain(lead.domain) ? "" : String(lead.domain ?? "").trim().toLowerCase()) ||
      "";
    const candidate: ApifyLead = {
      ...lead,
      domain,
    };
    const decision = evaluateLeadAgainstQualityPolicy({
      lead: candidate,
      policy: input.qualityPolicy,
      allowMissingEmail: input.allowMissingEmail,
    });
    if (decision.accepted) {
      acceptedLeads.push(candidate);
    } else {
      rejectedLeads.push(decision);
    }
  }

  const exaQueryCount = diagnostics.filter(
    (row) => row.provider === "exa" && row.stage !== "email_enrichment"
  ).length;
  const exaQueryCostUsd = Math.max(
    0,
    Math.min(0.05, Number(process.env.EXA_QUERY_COST_USD ?? 0.001) || 0.001)
  );
  const emailFinderLookupCostUsd = Math.max(
    0,
    Math.min(0.1, Number(process.env.EMAIL_FINDER_LOOKUP_COST_USD ?? 0) || 0)
  );
  const budgetUsedUsd = Number(
    (
      (observedExaCostUsd > 0 ? observedExaCostUsd : exaQueryCount * exaQueryCostUsd) +
      observedDataForSeoCostUsd +
      emailEnrichment.attempted * emailFinderLookupCostUsd
    ).toFixed(3)
  );
  const exaSpendUsd = Number(
    (observedExaCostUsd > 0 ? observedExaCostUsd : exaQueryCount * exaQueryCostUsd).toFixed(3)
  );
  const dataForSeoSpendUsd = Number(observedDataForSeoCostUsd.toFixed(3));

  return {
    queryPlan,
    acceptedLeads,
    rejectedLeads,
    diagnostics,
    emailEnrichment,
    budgetUsedUsd,
    exaSpendUsd,
    dataForSeoSpendUsd,
    pendingDataForSeo: null,
  } satisfies ExaPeopleSourcingResult;
}

function stageFromValue(value: string): LeadChainStepStage | null {
  if (value === "prospect_discovery") return "prospect_discovery";
  if (value === "website_enrichment") return "website_enrichment";
  if (value === "email_discovery") return "email_discovery";
  return null;
}

function validateLeadChainStageOrder(stageOrder: LeadChainStepStage[]) {
  if (!stageOrder.length) {
    return "Apify chain returned zero stages";
  }
  if (stageOrder.length > APIFY_CHAIN_MAX_STEPS) {
    return `Apify chain returned ${stageOrder.length} steps; max is ${APIFY_CHAIN_MAX_STEPS}`;
  }
  if (stageOrder[stageOrder.length - 1] !== "email_discovery") {
    return "Apify chain must end with email_discovery";
  }
  if (stageOrder.length === 1) {
    return stageOrder[0] === "email_discovery" || stageOrder[0] === "website_enrichment"
      ? ""
      : "Single-step chain must use email_discovery or website_enrichment";
  }
  if (stageOrder[0] !== "prospect_discovery" && stageOrder[0] !== "website_enrichment") {
    return "Multi-step chain must start with prospect_discovery or website_enrichment";
  }
  for (let i = 1; i < stageOrder.length; i += 1) {
    const prev = stageOrder[i - 1];
    const current = stageOrder[i];
    if (prev === "email_discovery") {
      return "Invalid chain order after email_discovery";
    }
    if (prev === "website_enrichment" && current === "prospect_discovery") {
      return "Invalid chain order: website_enrichment -> prospect_discovery";
    }
    if (prev === current) {
      return `Duplicate stage not allowed: ${current}`;
    }
  }
  return "";
}

function isLikelyUrl(value: string) {
  const lower = value.trim().toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("www.");
}

function parseDomainFromUrl(input: string) {
  try {
    const withProto = input.startsWith("http://") || input.startsWith("https://") ? input : `https://${input}`;
    const hostname = new URL(withProto).hostname.replace(/^www\./, "").toLowerCase();
    return hostname;
  } catch {
    return "";
  }
}

function isLikelyDomain(value: string) {
  const v = value.trim().toLowerCase();
  if (!v || v.includes("@") || v.includes(" ")) return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v);
}

function collectSignalsFromUnknown(
  value: unknown,
  sink: {
    emails: Set<string>;
    phones: Set<string>;
    domains: Set<string>;
    websites: Set<string>;
    profileUrls: Set<string>;
    companies: Set<string>;
    queries: Set<string>;
  },
  contextKey = "",
  depth = 0
) {
  if (depth > 4) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return;

    const emailMatches = text.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
    for (const email of emailMatches) {
      if (!getLeadEmailSuppressionReason(email)) sink.emails.add(email);
      const domain = parseDomainFromUrl(email.split("@")[1] ?? "");
      if (domain) sink.domains.add(domain);
    }
    const phoneMatches = text.match(/\+?[0-9][0-9()\-\s]{7,}[0-9]/g) ?? [];
    for (const phoneRaw of phoneMatches) {
      const normalizedPhone = phoneRaw.replace(/[^0-9+]/g, "");
      if (normalizedPhone.length >= 8) {
        sink.phones.add(normalizedPhone);
      }
    }

    if (isLikelyUrl(text)) {
      const normalized = text.startsWith("http://") || text.startsWith("https://") ? text : `https://${text}`;
      sink.websites.add(normalized);
      const domain = parseDomainFromUrl(normalized);
      if (domain) sink.domains.add(domain);
      if (/linkedin\.com\//i.test(normalized) || /(profile|person)/i.test(contextKey)) {
        sink.profileUrls.add(normalized);
      }
    } else if (isLikelyDomain(text)) {
      sink.domains.add(text.toLowerCase());
      sink.websites.add(`https://${text.toLowerCase()}`);
    }

    if (contextKey && /(company|organization|org|brand|seller|store|business|name)/i.test(contextKey)) {
      sink.companies.add(text.slice(0, 140));
      sink.queries.add(text.slice(0, 140));
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectSignalsFromUnknown(item, sink, contextKey, depth + 1);
    return;
  }

  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    for (const [key, entry] of Object.entries(row)) {
      collectSignalsFromUnknown(entry, sink, key, depth + 1);
    }
  }
}

function mergeChainData(base: LeadSourcingChainData, rows: unknown[]): LeadSourcingChainData {
  const sink = {
    emails: new Set(base.emails.map((item) => item.toLowerCase())),
    phones: new Set(base.phones),
    domains: new Set(base.domains.map((item) => item.toLowerCase())),
    websites: new Set(base.websites),
    profileUrls: new Set(base.profileUrls),
    companies: new Set(base.companies),
    queries: new Set(base.queries),
  };

  for (const row of rows) {
    collectSignalsFromUnknown(row, sink);
  }

  return {
    queries: uniqueTrimmed(Array.from(sink.queries), 120),
    companies: uniqueTrimmed(Array.from(sink.companies), 120),
    websites: uniqueTrimmed(Array.from(sink.websites), 200),
    domains: uniqueTrimmed(Array.from(sink.domains), 200).map((item) => item.toLowerCase()),
    profileUrls: uniqueTrimmed(Array.from(sink.profileUrls), 300),
    emails: uniqueTrimmed(Array.from(sink.emails), 400).map((item) => item.toLowerCase()),
    phones: uniqueTrimmed(Array.from(sink.phones), 250),
  };
}

function preflightSeedChainDataFromStartState(input: {
  targetAudience: string;
  startState: SourcingStartState;
}): LeadSourcingChainData {
  const query = trimText(input.targetAudience, 140) || "b2b software revenue teams";
  // Real-only preflight: never synthesize seed entities (domains/emails/phones/profiles).
  return {
    queries: uniqueTrimmed([query], 120),
    companies: [],
    websites: [],
    domains: [],
    profileUrls: [],
    emails: [],
    phones: [],
  };
}

async function preflightSourcingPlanCandidate(input: {
  candidate: LeadSourcingChainPlan;
  targetAudience: string;
  startState: SourcingStartState;
  token: string;
  actorSchemaCache: ActorSchemaProfileCache;
  contractsByActorId: Map<string, ActorSemanticContract>;
}): Promise<CandidateSchemaPreflight> {
  let chainData = preflightSeedChainDataFromStartState({
    targetAudience: input.targetAudience,
    startState: input.startState,
  });
  const steps: CandidateSchemaPreflightStep[] = [];

  for (let stepIndex = 0; stepIndex < input.candidate.steps.length; stepIndex += 1) {
    const step = input.candidate.steps[stepIndex];
    const profile = await getActorSchemaProfileCached({
      cache: input.actorSchemaCache,
      actorId: step.actorId,
      token: input.token,
    });
    if (!profile.ok || !profile.profile) {
      steps.push({
        stepIndex,
        actorId: step.actorId,
        stage: step.stage,
        ok: false,
        reason: "actor_profile_unavailable",
        missingRequired: [],
        requiredKeys: [],
        inputKeys: [],
        normalizedInputAdjustments: [],
      });
      return {
        candidateId: input.candidate.id,
        feasible: false,
        reason: `schema_preflight_actor_profile_unavailable:${step.actorId}`,
        steps,
      };
    }

    const actorInput = buildChainStepInput({
      step,
      chainData,
      targetAudience: input.targetAudience,
      maxLeads: APIFY_PROBE_MAX_LEADS,
      probeMode: true,
    });
    const normalizedInput = normalizeActorInputForSchema({
      actorProfile: profile.profile,
      actorInput,
      stage: step.stage,
    });
    const compatibility = evaluateActorCompatibility({
      actorProfile: profile.profile,
      actorInput: normalizedInput.input,
      stage: step.stage,
    });

    const requiredKeys = profile.profile.requiredKeys;
    const inputKeys = Object.keys(normalizedInput.input);
    if (!compatibility.ok) {
      steps.push({
        stepIndex,
        actorId: step.actorId,
        stage: step.stage,
        ok: false,
        reason: compatibility.reason,
        missingRequired: compatibility.missingRequired,
        requiredKeys,
        inputKeys,
        normalizedInputAdjustments: normalizedInput.adjustments,
      });
      return {
        candidateId: input.candidate.id,
        feasible: false,
        reason: `schema_preflight_incompatible:${step.actorId}:${trimText(compatibility.reason, 220)}`,
        steps,
      };
    }

    steps.push({
      stepIndex,
      actorId: step.actorId,
      stage: step.stage,
      ok: true,
      reason: "ok",
      missingRequired: [],
      requiredKeys,
      inputKeys,
      normalizedInputAdjustments: normalizedInput.adjustments,
    });

    const contract = input.contractsByActorId.get(step.actorId);
    const producedSignals = contract?.producedOutputs?.length ? contract.producedOutputs : defaultStageOutputs(step.stage);
    if (producedSignals.includes("query")) {
      chainData = mergeChainData(chainData, [{ query: step.queryHint || input.targetAudience }]);
    }
  }

  return {
    candidateId: input.candidate.id,
    feasible: true,
    reason: "schema_preflight_pass",
    steps,
  };
}

function stageFromActor(actor: ApifyStoreActor): LeadChainStepStage {
  const blob = `${actor.title} ${actor.description} ${actor.categories.join(" ")}`.toLowerCase();
  if (/(email|mailbox|contact\s+email|email\s+finder|hunter)/.test(blob)) return "email_discovery";
  if (/(website|domain|company\s+site|url|crawler|crawl|web\s+scrap)/.test(blob)) return "website_enrichment";
  return "prospect_discovery";
}

function schemaSummaryKeys(summary: Record<string, unknown> | undefined) {
  if (!summary) {
    return { requiredKeys: [] as string[], knownKeys: [] as string[] };
  }
  const requiredKeys = Array.isArray(summary.requiredKeys)
    ? summary.requiredKeys.map((value) => trimText(value, 80)).filter(Boolean)
    : [];
  const knownKeys = Array.isArray(summary.knownKeys)
    ? summary.knownKeys.map((value) => trimText(value, 80)).filter(Boolean)
    : [];
  return { requiredKeys, knownKeys };
}

function normalizeSchemaKeyToken(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const RUNTIME_AUTH_KEY_HINTS = [
  "apikey",
  "apitoken",
  "token",
  "secret",
  "password",
  "cookie",
  "session",
  "bearer",
  "authorization",
  "auth",
  "clientid",
  "clientsecret",
  "proxy",
  "username",
  "login",
  "captcha",
  "recaptcha",
];

const RUNTIME_FILE_INPUT_KEY_HINTS = [
  "file",
  "filepath",
  "upload",
  "csv",
  "excel",
  "xlsx",
  "jsonl",
];

function isRuntimeUnsafeRequiredKey(token: string) {
  if (!token) return false;
  if (RUNTIME_AUTH_KEY_HINTS.some((hint) => token.includes(hint))) return true;
  if (RUNTIME_FILE_INPUT_KEY_HINTS.some((hint) => token.includes(hint))) return true;
  if (token.includes("datasetid") || token.includes("runid")) return true;
  return false;
}

function looksLikeProviderSecretRequirementInMetadata(actor: ApifyStoreActor, metadataBlob: string) {
  const actorId = actor.actorId.toLowerCase();
  const providerNamedActor =
    /(^|~)(tomba|hunter|snov|clearbit|rocketreach|dropcontact|apollo|crunchbase|zoominfo|lusha)(~|$)/.test(
      actorId
    ) || /(sales\s*navigator|salesnav)/.test(metadataBlob);
  const authPhrase =
    /(api\s*key|apikey|access\s*token|token required|client secret|oauth|credentials|session cookie|cookie|login)/.test(
      metadataBlob
    );
  return providerNamedActor || authPhrase;
}

function looksLikeProviderSecretRequiredError(text: unknown) {
  const normalized = String(text ?? "").toLowerCase();
  if (!normalized) return false;
  return (
    /input\.[a-z0-9_]*(apikey|api_key|token|clientsecret|client_secret|password|cookie|session)[a-z0-9_]*\s+is\s+required/.test(
      normalized
    ) ||
    normalized.includes("api key is required") ||
    normalized.includes("access token is required") ||
    normalized.includes("token is required") ||
    normalized.includes("client secret is required") ||
    normalized.includes("credentials are required") ||
    normalized.includes("authentication required") ||
    normalized.includes("requires auth") ||
    normalized.includes("requires authentication") ||
    normalized.includes("session cookie") ||
    normalized.includes("login required")
  );
}

function canRuntimePopulateRequiredKey(stage: LeadChainStepStage, token: string) {
  if (!token) return false;
  if (
    token.includes("query") ||
    token.includes("search") ||
    token.includes("keyword") ||
    token.includes("phrase") ||
    token.includes("term") ||
    token.includes("limit") ||
    token.includes("maxitem") ||
    token.includes("maxresult") ||
    token.includes("maxrequest") ||
    token.includes("maxdepth") ||
    token.includes("maxconcurrency") ||
    token.includes("page") ||
    token.includes("country") ||
    token.includes("location") ||
    token.includes("language")
  ) {
    return true;
  }
  if (token.includes("domain") || token.includes("website") || token.includes("site") || token.includes("starturl")) {
    return stage !== "prospect_discovery";
  }
  if (token.includes("email") || token.includes("mailbox")) {
    return stage === "email_discovery";
  }
  if (token.includes("phone") || token.includes("mobile") || token.includes("whatsapp")) {
    return stage !== "email_discovery";
  }
  if (token.includes("company") || token.includes("organization") || token.includes("org")) {
    return stage !== "prospect_discovery";
  }
  if (token.includes("url")) {
    return stage !== "prospect_discovery";
  }
  return false;
}

function stageKeywordScore(stage: LeadChainStepStage, blob: string) {
  if (stage === "email_discovery") {
    return /(email|mailbox|contact|enrich|finder|verify)/.test(blob) ? 0.25 : 0;
  }
  if (stage === "website_enrichment") {
    return /(website|domain|crawl|scrap|url|company)/.test(blob) ? 0.2 : 0;
  }
  return /(lead|prospect|people|linkedin|company)/.test(blob) ? 0.18 : 0;
}

function estimateActorStageViability(input: {
  stage: LeadChainStepStage;
  actor: ApifyStoreActor;
  actorProfile?: ActorCapabilityProfile;
}) {
  const schemaKeys = schemaSummaryKeys(input.actorProfile?.schemaSummary);
  const requiredTokens = uniqueTrimmed(schemaKeys.requiredKeys, 80).map(normalizeSchemaKeyToken);
  const knownTokens = uniqueTrimmed(schemaKeys.knownKeys, 200).map(normalizeSchemaKeyToken);
  const metadataBlob = `${input.actor.title} ${input.actor.description} ${input.actor.categories.join(" ")}`.toLowerCase();
  const keySet = new Set<string>(requiredTokens.length ? requiredTokens : knownTokens.slice(0, 24));
  const providerSecretLike = looksLikeProviderSecretRequirementInMetadata(input.actor, metadataBlob);

  if (!keySet.size) {
    return 0.45 + stageKeywordScore(input.stage, metadataBlob);
  }

  let supported = 0;
  let unknown = 0;
  let unsafe = 0;
  for (const token of keySet) {
    if (!token) continue;
    if (isRuntimeUnsafeRequiredKey(token)) {
      unsafe += 1;
      continue;
    }
    if (canRuntimePopulateRequiredKey(input.stage, token)) {
      supported += 1;
    } else {
      unknown += 1;
    }
  }

  const total = keySet.size || 1;
  const supportRatio = supported / total;
  const unknownPenalty = (unknown / total) * 0.22;
  const unsafePenalty = (unsafe / total) * 0.65;
  const providerPenalty = providerSecretLike ? 0.45 : 0;
  const keywordBonus = stageKeywordScore(input.stage, metadataBlob);
  return Math.max(
    0,
    Math.min(1, 0.5 + supportRatio * 0.45 + keywordBonus - unknownPenalty - unsafePenalty - providerPenalty)
  );
}

function filterPlanningPoolBySchemaViability(input: {
  actors: ApifyStoreActor[];
  actorProfiles: Map<string, ActorCapabilityProfile>;
  actorMemoryById: Map<string, SourcingActorMemory>;
}) {
  const rows = input.actors.map((actor) => {
    const profile = input.actorProfiles.get(actor.actorId);
    const schemaKeys = schemaSummaryKeys(profile?.schemaSummary);
    const hasSchemaSurface = schemaKeys.requiredKeys.length > 0 || schemaKeys.knownKeys.length > 0;
    const metadataBlob = `${actor.title} ${actor.description} ${actor.categories.join(" ")}`.toLowerCase();
    const providerSecretLike = looksLikeProviderSecretRequirementInMetadata(actor, metadataBlob);
    const hintStage = stageFromActor(actor);
    const stageScores = {
      prospect_discovery: estimateActorStageViability({ stage: "prospect_discovery", actor, actorProfile: profile }),
      website_enrichment: estimateActorStageViability({ stage: "website_enrichment", actor, actorProfile: profile }),
      email_discovery: estimateActorStageViability({ stage: "email_discovery", actor, actorProfile: profile }),
    };
    const memory = input.actorMemoryById.get(actor.actorId.toLowerCase());
    const hasProvenSuccess = Boolean(memory && memory.successCount > 0);
    const repeatedHardFailure = Boolean(
      memory &&
        memory.successCount === 0 &&
        (memory.failCount >= 3 || memory.compatibilityFailCount >= 2)
    );
    const reliabilityPenalty = memory ? Math.min(0.35, memory.compatibilityFailCount * 0.05 + memory.failCount * 0.02) : 0;
    const missingSchemaPenalty = !hasSchemaSurface && !hasProvenSuccess ? 0.42 : !hasSchemaSurface ? 0.2 : 0;
    const bestStage = (Object.keys(stageScores) as LeadChainStepStage[]).sort(
      (a, b) => stageScores[b] - stageScores[a]
    )[0];
    const bestScore = stageScores[bestStage];
    const hintedScore = stageScores[hintStage];
    const viability =
      Math.max(bestScore, hintedScore) -
      reliabilityPenalty -
      missingSchemaPenalty -
      (providerSecretLike && !hasProvenSuccess ? 0.35 : 0) -
      (repeatedHardFailure ? 0.5 : 0);
    return {
      actor,
      viability,
      bestStage,
      hintStage,
      hasSchemaSurface,
      hasProvenSuccess,
      repeatedHardFailure,
      providerSecretLike,
    };
  });

  const filteredRows = rows
    .filter((row) => row.viability >= 0.34)
    .sort((a, b) => b.viability - a.viability);
  if (filteredRows.length) {
    const targetCount = Math.min(28, Math.max(12, Math.floor(rows.length * 0.2)));
    const selected = [...filteredRows];
    if (selected.length < targetCount) {
      const seen = new Set(selected.map((row) => row.actor.actorId.toLowerCase()));
      const extras = rows
        .filter((row) => !seen.has(row.actor.actorId.toLowerCase()))
        .filter((row) => !row.repeatedHardFailure)
        .filter((row) => !row.providerSecretLike || row.hasProvenSuccess)
        .sort((a, b) => b.viability - a.viability)
        .slice(0, targetCount - selected.length);
      selected.push(...extras);
    }
    return selected.map((row) => row.actor);
  }

  const provenNoSchema = rows
    .filter((row) => row.hasProvenSuccess)
    .sort((a, b) => b.viability - a.viability)
    .map((row) => row.actor);
  if (provenNoSchema.length) return provenNoSchema;

  return rows
    .filter((row) => row.hasSchemaSurface)
    .sort((a, b) => b.viability - a.viability)
    .map((row) => row.actor);
}

const SEMANTIC_SIGNAL_VALUES: SemanticSignal[] = [
  "query",
  "company_list",
  "domain_list",
  "website_list",
  "profile_url_list",
  "email_list",
  "phone_list",
  "sales_nav_url",
  "auth_token",
  "file_upload",
];

function normalizeSemanticSignal(value: unknown): SemanticSignal | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  if (!raw) return null;
  const aliases: Record<string, SemanticSignal> = {
    query: "query",
    search_query: "query",
    keyword_query: "query",
    companies: "company_list",
    company_list: "company_list",
    company_names: "company_list",
    domains: "domain_list",
    domain_list: "domain_list",
    websites: "website_list",
    website_list: "website_list",
    urls: "website_list",
    profile_urls: "profile_url_list",
    linkedin_profile_urls: "profile_url_list",
    profile_url_list: "profile_url_list",
    emails: "email_list",
    email_list: "email_list",
    phone: "phone_list",
    phones: "phone_list",
    phonenumber: "phone_list",
    phone_numbers: "phone_list",
    phone_list: "phone_list",
    mobile: "phone_list",
    mobile_number: "phone_list",
    salesnav_url: "sales_nav_url",
    sales_nav_url: "sales_nav_url",
    salesnavigator_url: "sales_nav_url",
    auth: "auth_token",
    auth_token: "auth_token",
    api_key: "auth_token",
    token: "auth_token",
    file: "file_upload",
    file_upload: "file_upload",
    csv_file: "file_upload",
  };
  const direct = aliases[raw];
  if (direct) return direct;
  return SEMANTIC_SIGNAL_VALUES.includes(raw as SemanticSignal) ? (raw as SemanticSignal) : null;
}

function semanticSignalsFromSchemaTokens(tokens: string[]): SemanticSignal[] {
  const out = new Set<SemanticSignal>();
  for (const token of tokens) {
    const normalized = normalizeSchemaKeyToken(token);
    if (!normalized) continue;
    if (
      normalized.includes("query") ||
      normalized.includes("search") ||
      normalized.includes("keyword") ||
      normalized.includes("phrase")
    ) {
      out.add("query");
      continue;
    }
    if (normalized.includes("salesnav") || normalized.includes("salesnavigator")) {
      out.add("sales_nav_url");
      continue;
    }
    if (normalized.includes("linkedin") && normalized.includes("url")) {
      out.add("profile_url_list");
      continue;
    }
    if (normalized.includes("company") || normalized.includes("organization")) {
      out.add("company_list");
      continue;
    }
    if (normalized.includes("domain")) {
      out.add("domain_list");
      continue;
    }
    if (
      normalized.includes("website") ||
      normalized.includes("url") ||
      normalized.includes("starturl") ||
      normalized.includes("site")
    ) {
      out.add("website_list");
      continue;
    }
    if (normalized.includes("email") || normalized.includes("mailbox")) {
      out.add("email_list");
      continue;
    }
    if (normalized.includes("phone") || normalized.includes("mobile") || normalized.includes("whatsapp")) {
      out.add("phone_list");
      continue;
    }
    if (
      normalized.includes("file") ||
      normalized.includes("upload") ||
      normalized.includes("csv") ||
      normalized.includes("xlsx")
    ) {
      out.add("file_upload");
      continue;
    }
    if (isRuntimeUnsafeRequiredKey(normalized)) {
      out.add("auth_token");
    }
  }
  return Array.from(out);
}

function defaultStageOutputs(stage: LeadChainStepStage): SemanticSignal[] {
  if (stage === "prospect_discovery") {
    return ["company_list", "website_list", "profile_url_list", "phone_list"];
  }
  if (stage === "website_enrichment") {
    return ["company_list", "website_list", "domain_list"];
  }
  return ["email_list"];
}

function availableSignalsFromChainData(chainData: LeadSourcingChainData) {
  const available = new Set<SemanticSignal>(["query"]);
  if (chainData.companies.length) available.add("company_list");
  if (chainData.domains.length) available.add("domain_list");
  if (chainData.websites.length) available.add("website_list");
  if (chainData.profileUrls.length) available.add("profile_url_list");
  if (chainData.emails.length) available.add("email_list");
  if (chainData.phones.length) available.add("phone_list");
  return available;
}

function deriveSourcingStartState(input: {
  targetAudience: string;
  triggerContext?: string;
  offer: string;
}): SourcingStartState {
  const sink = {
    emails: new Set<string>(),
    phones: new Set<string>(),
    domains: new Set<string>(),
    websites: new Set<string>(),
    profileUrls: new Set<string>(),
    companies: new Set<string>(),
    queries: new Set<string>(),
  };
  collectSignalsFromUnknown(
    {
      targetAudience: input.targetAudience,
      triggerContext: input.triggerContext ?? "",
      offer: input.offer,
    },
    sink
  );
  const signals = new Set<SemanticSignal>(["query"]);
  if (sink.domains.size) signals.add("domain_list");
  if (sink.websites.size) signals.add("website_list");
  if (sink.profileUrls.size) signals.add("profile_url_list");
  if (sink.emails.size) signals.add("email_list");
  if (sink.phones.size) signals.add("phone_list");
  if (sink.companies.size) signals.add("company_list");
  return {
    availableSignals: Array.from(signals),
    inferredSeeds: {
      domainCount: sink.domains.size,
      websiteCount: sink.websites.size,
      emailCount: sink.emails.size,
      phoneCount: sink.phones.size,
    },
  };
}

function buildInitialChainData(input: {
  targetAudience: string;
  triggerContext?: string;
  offer?: string;
}): LeadSourcingChainData {
  const peopleQuery = derivePeopleDiscoveryQuery(input.targetAudience);
  const companyQuery = deriveCompanyDiscoveryQuery(input.targetAudience);
  const sanitizedOffer = sanitizeLeadDiscoveryQuery(input.offer ?? "");
  return {
    queries: uniqueTrimmed(
      [peopleQuery, companyQuery, sanitizedOffer]
        .filter(Boolean)
        .map((item) => trimText(item, 180)),
      120
    ),
    companies: [],
    websites: [],
    domains: [],
    profileUrls: [],
    emails: [],
    phones: [],
  };
}

function mergeStartStateWithChainData(input: {
  startState: SourcingStartState;
  chainData: LeadSourcingChainData;
}) {
  const availableSignals = new Set<SemanticSignal>(input.startState.availableSignals);
  for (const signal of availableSignalsFromChainData(input.chainData)) {
    availableSignals.add(signal);
  }

  return {
    availableSignals: Array.from(availableSignals),
    inferredSeeds: {
      domainCount: Math.max(input.startState.inferredSeeds.domainCount, input.chainData.domains.length),
      websiteCount: Math.max(input.startState.inferredSeeds.websiteCount, input.chainData.websites.length),
      emailCount: Math.max(input.startState.inferredSeeds.emailCount, input.chainData.emails.length),
      phoneCount: Math.max(input.startState.inferredSeeds.phoneCount, input.chainData.phones.length),
    },
  } satisfies SourcingStartState;
}

function hasBootstrapCoverage(chainData: LeadSourcingChainData) {
  return (
    chainData.companies.length >= 3 &&
    (chainData.domains.length >= 2 || chainData.websites.length >= 2 || chainData.profileUrls.length >= 2)
  );
}

function buildHeuristicSemanticContract(input: {
  actor: ApifyStoreActor;
  profile?: ActorCapabilityProfile;
  stage: LeadChainStepStage;
}): ActorSemanticContract {
  const schemaKeys = schemaSummaryKeys(input.profile?.schemaSummary);
  const requiredInputs = semanticSignalsFromSchemaTokens(schemaKeys.requiredKeys);
  const metadataBlob = `${input.actor.title} ${input.actor.description} ${input.actor.categories.join(" ")}`.toLowerCase();
  const producedOutputs = new Set<SemanticSignal>(defaultStageOutputs(input.stage));
  if (/(email|mail|contact|finder|verify|enrich)/.test(metadataBlob)) producedOutputs.add("email_list");
  if (/(phone|mobile|whatsapp|contact number|telephone)/.test(metadataBlob)) producedOutputs.add("phone_list");
  if (/(linkedin|profile)/.test(metadataBlob)) producedOutputs.add("profile_url_list");
  if (/(domain|website|site|crawl|scrap)/.test(metadataBlob)) {
    producedOutputs.add("website_list");
    producedOutputs.add("domain_list");
  }
  if (/(company|organization|org)/.test(metadataBlob)) producedOutputs.add("company_list");

  const mergedRequired = new Set<SemanticSignal>(requiredInputs);

  // Tighten contract inference when actor metadata implies hidden prerequisites.
  const salesNavLike = /(sales\s*navigator|salesnav)/.test(metadataBlob);
  const authLike = /(cookie|session|login|credential|authenticated|auth)/.test(metadataBlob);
  const providerSecretLike = looksLikeProviderSecretRequirementInMetadata(input.actor, metadataBlob);
  const profileUrlSeedLike =
    /(linkedin[^a-z0-9]*to[^a-z0-9]*email|bulk[^a-z0-9]*linkedin[^a-z0-9]*email|profile[^a-z0-9]*url|from[^a-z0-9]*linkedin[^a-z0-9]*url)/.test(
      metadataBlob
    );
  const domainSeedLike = /(name[^a-z0-9]*and[^a-z0-9]*domain|domain[^a-z0-9]*finder|email[^a-z0-9]*by[^a-z0-9]*domain)/.test(
    metadataBlob
  );

  if (salesNavLike) {
    mergedRequired.add("auth_token");
    if (/(url|lead\s*search|saved\s*search)/.test(metadataBlob)) {
      mergedRequired.add("sales_nav_url");
    }
  }
  if (profileUrlSeedLike && input.stage === "email_discovery") {
    mergedRequired.add("profile_url_list");
  }
  if (domainSeedLike && input.stage === "email_discovery") {
    mergedRequired.add("domain_list");
  }
  if (providerSecretLike) {
    mergedRequired.add("auth_token");
  }

  const mergedRequiredList = Array.from(mergedRequired);
  const requiresAuth = mergedRequiredList.includes("auth_token") || authLike;
  const requiresFileInput = mergedRequiredList.includes("file_upload");
  return {
    actorId: input.actor.actorId,
    requiredInputs: mergedRequiredList,
    producedOutputs: Array.from(producedOutputs),
    requiresAuth,
    requiresFileInput,
    confidence: 0.45,
    rationale: "heuristic_contract",
  };
}

function parseStoredSemanticContract(profile?: ActorCapabilityProfile): ActorSemanticContract | null {
  const stored = asRecord(profile?.schemaSummary).semanticContract;
  const row = asRecord(stored);
  const actorId = String(row.actorId ?? profile?.actorId ?? "").trim();
  if (!actorId) return null;
  const requiredInputs = Array.isArray(row.requiredInputs)
    ? row.requiredInputs.map((value) => normalizeSemanticSignal(value)).filter((value): value is SemanticSignal => Boolean(value))
    : [];
  const producedOutputs = Array.isArray(row.producedOutputs)
    ? row.producedOutputs.map((value) => normalizeSemanticSignal(value)).filter((value): value is SemanticSignal => Boolean(value))
    : [];
  return {
    actorId,
    requiredInputs,
    producedOutputs,
    requiresAuth: Boolean(row.requiresAuth),
    requiresFileInput: Boolean(row.requiresFileInput),
    confidence: Math.max(0, Math.min(1, Number(row.confidence ?? 0) || 0)),
    rationale: trimText(row.rationale, 220),
  };
}

async function inferActorSemanticContracts(input: {
  actors: ApifyStoreActor[];
  actorProfilesById: Map<string, ActorCapabilityProfile>;
  targetAudience: string;
  triggerContext?: string;
  offer: string;
}) {
  const existing = new Map<string, ActorSemanticContract>();
  const pending: Array<{ actor: ApifyStoreActor; profile?: ActorCapabilityProfile }> = [];
  for (const actor of input.actors) {
    const profile = input.actorProfilesById.get(actor.actorId);
    const stored = parseStoredSemanticContract(profile);
    const storedUsable =
      stored &&
      stored.actorId === actor.actorId &&
      (stored.confidence >= 0.6 ||
        stored.requiresAuth ||
        stored.requiresFileInput ||
        stored.requiredInputs.length > 0 ||
        stored.producedOutputs.length > 0);
    if (storedUsable && stored) {
      existing.set(actor.actorId, stored);
    } else {
      pending.push({ actor, profile });
    }
  }

  const output = new Map(existing);
  if (!pending.length) return output;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    for (const row of pending) {
      output.set(
        row.actor.actorId,
        buildHeuristicSemanticContract({
          actor: row.actor,
          profile: row.profile,
          stage: stageFromActor(row.actor),
        })
      );
    }
    return output;
  }

  const shortlist = pending.slice(0, 48).map((row) => {
    const schemaKeys = schemaSummaryKeys(row.profile?.schemaSummary);
    return {
      actorId: row.actor.actorId,
      title: trimText(row.actor.title, 120),
      description: trimText(row.actor.description, 220),
      categories: row.actor.categories.slice(0, 8),
      stageHint: stageFromActor(row.actor),
      requiredKeys: schemaKeys.requiredKeys.slice(0, 30),
      knownKeys: schemaKeys.knownKeys.slice(0, 80),
      metadata: row.profile?.lastSeenMetadata ?? {},
    };
  });

  const prompt = [
    "Classify runtime semantic input/output contracts for Apify actors used in B2B lead sourcing.",
    "Goal: prevent expensive probe runs by identifying hidden unsatisfied prerequisites before execution.",
    "Return JSON only.",
    "Rules:",
    "- Use only these semantic signals:",
    `  ${SEMANTIC_SIGNAL_VALUES.join(", ")}`,
    "- requiredInputs should represent what must exist before actor run (not optional knobs).",
    "- producedOutputs should represent likely output signals this actor emits on success.",
    "- requiresAuth=true for actors needing non-platform user credentials, cookies, or interactive sessions.",
    "- requiresFileInput=true for actors requiring uploaded files or pre-built CSVs.",
    "- sales_nav_url should be required when actor needs Sales Navigator URL.",
    "- Keep results conservative: if uncertain, mark confidence low and include rationale.",
    "Response shape:",
    '{ "contracts": [{ "actorId": string, "requiredInputs": string[], "producedOutputs": string[], "requiresAuth": boolean, "requiresFileInput": boolean, "confidence": number, "rationale": string }] }',
    `Context: ${JSON.stringify({
      targetAudience: input.targetAudience,
      triggerContext: input.triggerContext ?? "",
      offer: input.offer,
    })}`,
    `actors: ${JSON.stringify(shortlist)}`,
  ].join("\n");

  const model = resolveLlmModel("lead_chain_planning", { prompt });
  let parsed: unknown = {};
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
        text: { format: { type: "json_object" } },
        max_output_tokens: 3200,
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${raw.slice(0, 220)}`);
    }
    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    parsed = parseLooseJsonObject(extractOutputText(payload));
  } catch {
    parsed = {};
  }

  const root = asRecord(parsed);
  const contractsRaw = Array.isArray(root.contracts) ? root.contracts : [];
  const byActorId = new Map<string, ActorSemanticContract>();
  for (const rowRaw of contractsRaw) {
    const row = asRecord(rowRaw);
    const actorId = String(row.actorId ?? "").trim();
    if (!actorId) continue;
    const requiredInputs = Array.isArray(row.requiredInputs)
      ? row.requiredInputs
          .map((value) => normalizeSemanticSignal(value))
          .filter((value): value is SemanticSignal => Boolean(value))
      : [];
    const producedOutputs = Array.isArray(row.producedOutputs)
      ? row.producedOutputs
          .map((value) => normalizeSemanticSignal(value))
          .filter((value): value is SemanticSignal => Boolean(value))
      : [];
    byActorId.set(actorId, {
      actorId,
      requiredInputs,
      producedOutputs,
      requiresAuth: Boolean(row.requiresAuth),
      requiresFileInput: Boolean(row.requiresFileInput),
      confidence: Math.max(0, Math.min(1, Number(row.confidence ?? 0) || 0)),
      rationale: trimText(row.rationale, 240),
    });
  }

  const upsertRows: Array<{
    actorId: string;
    stageHints: Array<"prospect_discovery" | "website_enrichment" | "email_discovery">;
    schemaSummary: Record<string, unknown>;
    compatibilityScore: number;
    lastSeenMetadata: Record<string, unknown>;
  }> = [];

  for (const row of pending) {
    const heuristic = buildHeuristicSemanticContract({
      actor: row.actor,
      profile: row.profile,
      stage: stageFromActor(row.actor),
    });
    const fromModel = byActorId.get(row.actor.actorId);
    const inferred = fromModel
      ? {
          actorId: row.actor.actorId,
          requiredInputs: fromModel.requiredInputs.length ? fromModel.requiredInputs : heuristic.requiredInputs,
          producedOutputs: fromModel.producedOutputs.length ? fromModel.producedOutputs : heuristic.producedOutputs,
          requiresAuth: fromModel.requiresAuth || heuristic.requiresAuth,
          requiresFileInput: fromModel.requiresFileInput || heuristic.requiresFileInput,
          confidence: fromModel.confidence > 0 ? fromModel.confidence : heuristic.confidence,
          rationale: fromModel.rationale || heuristic.rationale,
        }
      : heuristic;
    output.set(row.actor.actorId, inferred);
    upsertRows.push({
      actorId: row.actor.actorId,
      stageHints: row.profile?.stageHints?.length
        ? row.profile.stageHints
        : [stageFromActor(row.actor)],
      schemaSummary: {
        ...asRecord(row.profile?.schemaSummary),
        semanticContract: inferred,
      },
      compatibilityScore: Number(row.profile?.compatibilityScore ?? 0) || 0,
      lastSeenMetadata: {
        ...asRecord(row.profile?.lastSeenMetadata),
        title: row.actor.title,
        description: row.actor.description,
      },
    });
  }

  if (upsertRows.length) {
    await upsertSourcingActorProfiles(upsertRows);
  }

  return output;
}

function evaluateCandidateFeasibility(input: {
  candidate: LeadSourcingChainPlan;
  contractsByActorId: Map<string, ActorSemanticContract>;
  startState: SourcingStartState;
}): CandidateFeasibility {
  const available = new Set<SemanticSignal>(
    input.startState.availableSignals.length ? input.startState.availableSignals : ["query"]
  );
  const steps: CandidateFeasibilityStep[] = [];
  let score = 1;

  for (let stepIndex = 0; stepIndex < input.candidate.steps.length; stepIndex += 1) {
    const step = input.candidate.steps[stepIndex];
    const contract = input.contractsByActorId.get(step.actorId);
    const fallbackContract: ActorSemanticContract = contract ?? {
      actorId: step.actorId,
      requiredInputs: [],
      producedOutputs: defaultStageOutputs(step.stage),
      requiresAuth: false,
      requiresFileInput: false,
      confidence: 0.35,
      rationale: "missing_contract_fallback",
    };

    const unresolved = new Set<string>();
    if (fallbackContract.requiresAuth) unresolved.add("auth_token");
    if (fallbackContract.requiresFileInput) unresolved.add("file_upload");
    for (const req of fallbackContract.requiredInputs) {
      if (!available.has(req)) unresolved.add(req);
    }
    const unresolvedList = Array.from(unresolved);
    const feasible = unresolvedList.length === 0;
    if (!feasible) score -= 0.45 + unresolvedList.length * 0.08;
    score -= Math.max(0, 0.55 - fallbackContract.confidence) * 0.2;

    steps.push({
      stepIndex,
      actorId: step.actorId,
      stage: step.stage,
      feasible,
      unresolved: unresolvedList,
      requiredInputs: fallbackContract.requiredInputs,
      producedOutputs: fallbackContract.producedOutputs,
      reason: feasible ? "ok" : `missing:${unresolvedList.join(",")}`,
    });

    if (!feasible) {
      return {
        candidateId: input.candidate.id,
        feasible: false,
        score: Math.max(0, Number(score.toFixed(4))),
        reason: `step_${stepIndex + 1}_${step.actorId}_unresolved_${unresolvedList.join("_")}`,
        steps,
      };
    }

    for (const produced of fallbackContract.producedOutputs) {
      available.add(produced);
    }
  }

  const feasible = steps.length > 0 && steps.every((step) => step.feasible);
  return {
    candidateId: input.candidate.id,
    feasible,
    score: Math.max(0, Number(score.toFixed(4))),
    reason: feasible ? "feasible" : "failed",
    steps,
  };
}

function filterPlanningActorsByStartStatePrereqs(input: {
  actors: ApifyStoreActor[];
  contractsByActorId: Map<string, ActorSemanticContract>;
  startState: SourcingStartState;
}) {
  const availableSignals = new Set<SemanticSignal>(
    input.startState.availableSignals.length ? input.startState.availableSignals : ["query"]
  );
  const allowed: ApifyStoreActor[] = [];
  const rejected: Array<{ actorId: string; reason: string }> = [];

  for (const actor of input.actors) {
    const contract = input.contractsByActorId.get(actor.actorId);
    if (!contract) {
      allowed.push(actor);
      continue;
    }
    const missing: string[] = [];
    if (contract.requiresAuth && !availableSignals.has("auth_token")) {
      missing.push("auth_token");
    }
    if (contract.requiresFileInput && !availableSignals.has("file_upload")) {
      missing.push("file_upload");
    }
    if (missing.length) {
      rejected.push({
        actorId: actor.actorId,
        reason: `missing_start_state:${missing.join(",")}`,
      });
      continue;
    }
    allowed.push(actor);
  }

  return { allowed, rejected };
}

function hasHardPreflightBlock(reason: string) {
  const normalized = String(reason ?? "").toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("sales nav") ||
    normalized.includes("salesnav") ||
    normalized.includes("auth") ||
    normalized.includes("cookie") ||
    normalized.includes("credential") ||
    normalized.includes("file upload") ||
    normalized.includes("file") ||
    normalized.includes("missing required") ||
    normalized.includes("unsatisfied prerequisite") ||
    normalized.includes("not possible")
  );
}

function isRoleCompanyIcpAudience(targetAudience: string) {
  const normalized = String(targetAudience ?? "").toLowerCase();
  if (!normalized) return false;
  const roleSignals = /(manager|director|head|vp|chief|owner|founder|revenue|marketing|sales|growth|demand gen)/.test(normalized);
  const orgSignals = /(company|companies|team|organization|org|employee|employees|b2b|saas|software|enterprise|mid[- ]?market)/.test(
    normalized
  );
  return roleSignals && orgSignals;
}

function actorSurfaceSignals(actor: ApifyStoreActor) {
  const blob = `${actor.title} ${actor.description} ${actor.categories.join(" ")}`.toLowerCase();
  return {
    localSurface: /(google maps|places|yelp|gmb|google business profile|store listing|local business)/.test(blob),
    bootstrapSearchSurface:
      /(google search scraper|serp scraper|search results scraper|search engine results|bing search scraper|duckduckgo scraper)/.test(
        blob
      ),
    eventSurface: /(event exhibitor|conference exhibitor|trade show|tradeshow|attendee list|event sponsor)/.test(blob),
    directorySurface: /(europages|yellow pages|pages jaunes|thomasnet|business directory|vendor directory|clutch|g2|appsumo|capterra)/.test(
      blob
    ),
    legalSurface: /(lawyer|attorney|law firm|legal services|justia|avvo|bar association|legal directory)/.test(blob),
    realEstateSurface: /(real estate|realtor|brokerage|property listing|zillow|domain\.com\.au|mls)/.test(blob),
    classifiedSurface: /(gumtree|craigslist|classified|for sale|buy and sell|marketplace listing|listing ads)/.test(blob),
    consumerSurface:
      /(meta ads|facebook|instagram|tiktok|twitter|x\/twitter|reddit|youtube|influencer|shopify|amazon|etsy|aliexpress|social media)/.test(
        blob
      ),
    seoSurface: /(backlink|seo audit|seo prospecting|link building)/.test(blob),
    jobsSurface: /(job scraper|jobs scraper|job board|job listing|hiring scraper|career scraper|vacancy|career site)/.test(blob),
    pluginSurface: /(wordpress plugin|plugin scraper|theme scraper|chrome extension scraper)/.test(blob),
    researchSurface: /(research organization registry|ror scraper|academic|university|scholar|lab directory)/.test(blob),
    toolingSurface:
      /(campaign creator|lead formatter|formatter|qualifier|validator|verification|bounce checker|email campaign|template generator)/.test(
        blob
      ),
    regionalMismatchedSurface:
      /(german|deutsch|impressum|siret|immobilienscout|immonet|propertyfinder|yandex maps|fmcsa|texas state|kleinanzeigen|dot crawler)/.test(
        blob
      ),
    coreLeadSurface: /(lead|contact|prospect|company|email|linkedin|business|domain|enrich|finder|decision maker|crm)/.test(
      blob
    ),
    emailValidationOnly: /(email validator|verify email|bounce checker|deliverability checker)/.test(blob),
  };
}

function audienceSurfaceMismatchReasonForActor(targetAudience: string, actor: ApifyStoreActor) {
  const normalizedAudience = String(targetAudience ?? "").toLowerCase();
  if (!isRoleCompanyIcpAudience(normalizedAudience)) return "";
  const audienceWantsLocal = /(local|near me|nearby|by city|by state|by country|geo[- ]?target|regional|territory)/.test(
    normalizedAudience
  );
  const audienceWantsRegional = /(german|deutsch|dach|france|french|uk|united kingdom|europe|emea|latam|apac)/.test(
    normalizedAudience
  );
  const audienceWantsEvents = /(event|conference|webinar|summit|exhibitor|trade show|tradeshow)/.test(normalizedAudience);
  const audienceWantsDirectory = /(directory|marketplace|vendor list|listing|catalog)/.test(normalizedAudience);
  const audienceWantsResearch = /(research|university|academic|lab|institute|scholar)/.test(normalizedAudience);
  const audienceWantsLegal = /(legal|law|attorney|law firm|compliance counsel)/.test(normalizedAudience);
  const audienceWantsRealEstate = /(real estate|realtor|brokerage|property|mortgage broker)/.test(normalizedAudience);
  const surface = actorSurfaceSignals(actor);
  if (surface.emailValidationOnly) return "validator_not_source";
  if (surface.bootstrapSearchSurface) return "";
  if (surface.localSurface && !audienceWantsLocal) return "local_business_surface_for_nonlocal_icp";
  if (surface.eventSurface && !audienceWantsEvents) return "event_surface_without_event_icp";
  if (surface.directorySurface && !audienceWantsDirectory) return "directory_surface_without_directory_icp";
  if (surface.legalSurface && !audienceWantsLegal) return "legal_surface_without_legal_icp";
  if (surface.realEstateSurface && !audienceWantsRealEstate) return "real_estate_surface_without_real_estate_icp";
  if (surface.classifiedSurface) return "classified_surface";
  if (surface.toolingSurface) return "tooling_not_data_source";
  if (surface.researchSurface && !audienceWantsResearch) return "research_surface_without_research_icp";
  if (surface.regionalMismatchedSurface && !audienceWantsRegional) return "regional_surface_without_matching_geo_icp";
  if (surface.seoSurface) return "seo_backlink_surface";
  if (surface.jobsSurface) return "jobs_surface";
  if (surface.pluginSurface) return "plugin_surface";
  if (surface.consumerSurface) return "consumer_or_local_surface";
  if (!surface.coreLeadSurface) return "generic_non_lead_surface";
  return "";
}

function firstStepAudienceMismatchReason(input: {
  targetAudience: string;
  candidate: LeadSourcingChainPlan;
  actorById: Map<string, ApifyStoreActor>;
}) {
  const firstStep = input.candidate.steps[0];
  if (!firstStep) return "";
  const actor = input.actorById.get(firstStep.actorId);
  if (!actor) return "";
  const mismatchReason = audienceSurfaceMismatchReasonForActor(input.targetAudience, actor);
  return mismatchReason ? `audience_actor_mismatch:${firstStep.actorId}:${mismatchReason}` : "";
}

async function critiqueCandidateFeasibilityWithLlm(input: {
  candidates: LeadSourcingChainPlan[];
  deterministic: CandidateFeasibility[];
  contractsByActorId: Map<string, ActorSemanticContract>;
  actorHintsById: Map<string, { title: string; description: string; categories: string[] }>;
  targetAudience: string;
  triggerContext?: string;
  offer: string;
  startState: SourcingStartState;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !input.candidates.length) return new Map<string, { feasible: boolean; score: number; reason: string }>();

  const prompt = [
    "Critique lead-sourcing chain feasibility before paid probes.",
    "Goal: reject chains that are likely to fail due to unsatisfied prerequisites or wrong dataflow.",
    "Treat this as strict preflight. No optimism.",
    "Hard reject chains whose first step is clearly mismatched to targetAudience intent.",
    "Examples of mismatch unless explicitly requested by targetAudience: local business/maps scraping, social ad lead scraping, e-commerce seller scraping, generic app-store scraping.",
    "If targetAudience is role/company ICP driven (e.g. B2B/SaaS role titles), prioritize company/person lead sources and reject consumer/local-business actor paths.",
    "Return JSON only with this shape:",
    '{ "candidates": [{ "id": string, "feasible": boolean, "score": number, "reason": string }] }',
    "Scoring: 0..1 where >=0.55 is acceptable.",
    `Context: ${JSON.stringify({
      targetAudience: input.targetAudience,
      triggerContext: input.triggerContext ?? "",
      offer: input.offer,
      startState: input.startState,
    })}`,
    `deterministic: ${JSON.stringify(input.deterministic)}`,
    `contracts: ${JSON.stringify(
      Array.from(input.contractsByActorId.values()).map((row) => ({
        actorId: row.actorId,
        requiredInputs: row.requiredInputs,
        producedOutputs: row.producedOutputs,
        requiresAuth: row.requiresAuth,
        requiresFileInput: row.requiresFileInput,
        confidence: row.confidence,
      }))
    )}`,
    `actorHints: ${JSON.stringify(
      Array.from(
        new Set(input.candidates.flatMap((candidate) => candidate.steps.map((step) => step.actorId)))
      ).map((actorId) => {
        const hint = input.actorHintsById.get(actorId);
        return {
          actorId,
          title: hint?.title ?? "",
          description: hint?.description ?? "",
          categories: hint?.categories ?? [],
        };
      })
    )}`,
    `candidates: ${JSON.stringify(input.candidates)}`,
  ].join("\n");

  const model = resolveLlmModel("lead_chain_selection", { prompt });
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
        text: { format: { type: "json_object" } },
        max_output_tokens: 1800,
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      return new Map();
    }
    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    const parsed = parseLooseJsonObject(extractOutputText(payload));
    const root = asRecord(parsed);
    const rows = Array.isArray(root.candidates) ? root.candidates : [];
    const result = new Map<string, { feasible: boolean; score: number; reason: string }>();
    for (const rowRaw of rows) {
      const row = asRecord(rowRaw);
      const id = String(row.id ?? "").trim();
      if (!id) continue;
      result.set(id, {
        feasible: Boolean(row.feasible),
        score: Math.max(0, Math.min(1, Number(row.score ?? 0) || 0)),
        reason: trimText(row.reason, 260),
      });
    }
    return result;
  } catch {
    return new Map<string, { feasible: boolean; score: number; reason: string }>();
  }
}

function actorScore(actor: ApifyStoreActor) {
  return actor.users30Days * 1.2 + actor.rating * 40;
}

type ActorDiscoveryQueryPlan = {
  prospectQueries: string[];
  websiteQueries: string[];
  emailQueries: string[];
};

type ActorQueryPlanMode = "openai";

const APIFY_STORE_SEARCH_LIMIT = 40;
const APIFY_STORE_MAX_QUERIES_PER_STAGE = 8;
const APIFY_STORE_MAX_RESULTS = 160;

function queryHasIcpAnchor(text: string) {
  return hasRoleCompanyIcpSignal(text);
}

function compactAudienceAnchor(targetAudience: string) {
  const normalized = normalizeText(targetAudience).toLowerCase();
  const roleMatch = normalized.match(
    /\b(cro|cmo|ceo|coo|founder|owner|head|vp|director|manager|leader|revenue|sales|marketing|growth|demand gen|revops)\b/
  );
  const companyBits = [
    /\bb2b\b/.test(normalized) ? "b2b" : "",
    /\bsaas\b/.test(normalized) ? "saas" : "",
    /\bsoftware\b/.test(normalized) ? "software" : "",
    /\benterprise\b/.test(normalized) ? "enterprise" : "",
    /\bmid[- ]?market\b/.test(normalized) ? "mid-market" : "",
  ].filter(Boolean);
  const tokens = [roleMatch?.[1] ?? "", ...companyBits].filter(Boolean);
  return trimText(tokens.join(" "), 36);
}

const ROLE_KEYWORD_PATTERN =
  /\b(cro|cmo|ceo|coo|founder|owner|head|vp|director|manager|leader|revenue|sales|marketing|growth|demand gen|revops|operations)\b/gi;

const TRIGGER_LIKE_TEST_PATTERN =
  /\b(demo request|requested demo|book(ed)? demo|started demo|abandoned demo|trial signup|signed up|no show|did not book|not book(ed)?|within 24 hours|within 48 hours)\b/i;
const TRIGGER_LIKE_REPLACE_PATTERN =
  /\b(demo request|requested demo|book(ed)? demo|started demo|abandoned demo|trial signup|signed up|no show|did not book|not book(ed)?|within 24 hours|within 48 hours)\b/gi;

function sanitizeLeadDiscoveryQuery(raw: string) {
  if (!raw) return "";
  let text = normalizeText(raw);
  text = text.replace(/\btrigger\b\s*[:\-].*$/i, "").trim();
  if (!text) return "";
  if (TRIGGER_LIKE_TEST_PATTERN.test(text) && !hasRoleCompanyIcpSignal(text)) {
    return "";
  }
  text = text.replace(TRIGGER_LIKE_REPLACE_PATTERN, " ").replace(/\s+/g, " ").trim();
  return trimText(text, 140);
}

function deriveCompanyDiscoveryQuery(targetAudience: string) {
  const normalized = sanitizeLeadDiscoveryQuery(targetAudience);
  if (!normalized) return "";
  let companyFocus = normalized.replace(ROLE_KEYWORD_PATTERN, " ").replace(/\s+/g, " ").trim();
  if (!companyFocus) {
    companyFocus = normalized;
  }
  if (!/\b(compan(y|ies)|team|teams|organization|organizations|business|businesses|saas|software|enterprise|startup|startups)\b/i.test(companyFocus)) {
    companyFocus = `${companyFocus} companies`;
  }
  return trimText(companyFocus, 140);
}

function derivePeopleDiscoveryQuery(targetAudience: string) {
  const normalized = sanitizeLeadDiscoveryQuery(targetAudience);
  return normalized || trimText(targetAudience, 140);
}

function anchorQueriesToAudience(queries: string[], targetAudience: string, stage: LeadChainStepStage) {
  const audience = trimText(targetAudience, 80);
  const compactAnchor = compactAudienceAnchor(targetAudience) || "b2b saas";
  const suffix =
    stage === "email_discovery"
      ? `${compactAnchor} work email`
      : stage === "website_enrichment"
        ? `${compactAnchor} company website`
        : compactAnchor;
  const expanded: string[] = [];
  for (const query of queries) {
    const normalized = sanitizeLeadDiscoveryQuery(query) || normalizeText(query);
    if (!normalized) continue;
    expanded.push(normalized);
    if (queryHasIcpAnchor(normalized)) continue;
    expanded.push(trimText(`${normalized} ${suffix}`, 96));
    if (audience) {
      expanded.push(trimText(`${normalized} ${audience}`, 110));
    }
  }
  return uniqueTrimmed(expanded, APIFY_STORE_MAX_QUERIES_PER_STAGE);
}

function addCoverageQueries(input: {
  queries: string[];
  targetAudience: string;
  stage: LeadChainStepStage;
}) {
  const anchor = compactAudienceAnchor(input.targetAudience) || "b2b saas";
  const roleCue = anchor.includes("manager") || anchor.includes("director") || anchor.includes("vp") ? anchor : `${anchor} manager`;
  const companyQuery = deriveCompanyDiscoveryQuery(input.targetAudience);
  const peopleQuery = derivePeopleDiscoveryQuery(input.targetAudience);
  const coverage =
    input.stage === "prospect_discovery"
      ? [
          peopleQuery,
          companyQuery,
          `linkedin leads scraper ${roleCue}`,
          `b2b decision maker leads ${anchor}`,
          `company employee scraper ${anchor}`,
          `google search results scraper ${anchor}`,
        ]
      : input.stage === "website_enrichment"
        ? [
          `company domain enrichment ${anchor}`,
          `company website finder ${anchor}`,
          `domain from company name ${anchor}`,
          `serp scraper company websites ${anchor}`,
        ]
      : [
            peopleQuery,
            companyQuery,
            `linkedin to work email ${anchor}`,
            `business email finder ${anchor}`,
            `email from domain and name ${anchor}`,
          ];
  return uniqueTrimmed(
    [...input.queries.map((query) => sanitizeLeadDiscoveryQuery(query) || query), ...coverage],
    APIFY_STORE_MAX_QUERIES_PER_STAGE
  );
}

async function planActorDiscoveryQueries(input: {
  targetAudience: string;
  triggerContext?: string;
  offer: string;
  brandName: string;
  brandWebsite: string;
  experimentName: string;
  startState: SourcingStartState;
}): Promise<{ mode: ActorQueryPlanMode; plan: ActorDiscoveryQueryPlan }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing for actor discovery planning");
  }

  const prompt = [
    "You plan discovery queries to search the Apify Actor Store for lead-sourcing pipelines.",
    "Goal: high recall + high relevance across all potential actors (single-step or multi-step chains).",
    "Targeting rule: prioritize role/company ICP fit from targetAudience.",
    "Treat triggerContext as secondary ranking context. Do not anchor store searches on trigger phrases unless they are required to find the ICP.",
    "For broad audiences, split retrieval into two families: company-discovery queries first, then people-discovery queries constrained by company context.",
    "Use geo/segment partitions when needed to keep each query focused (for example city/region/sub-vertical slices).",
    "Initial runtime inputs at step 0 are limited to startState.availableSignals.",
    "If startState has only query (and no profile/domain/email seeds), avoid searches biased toward actors that require pre-existing LinkedIn URLs, Sales Navigator URLs, uploaded files, or user auth cookies.",
    "Return distinct searches for three stages: prospect_discovery, website_enrichment, email_discovery.",
    "Use concrete query terms a human would search in a marketplace.",
    "Include keyword variants that can surface actors tied to data sources (for example LinkedIn, Crunchbase, Apollo, websites, domains, email finding), when relevant.",
    "No placeholders. No generic buzzwords.",
    "",
    "Return strict JSON only:",
    '{ "prospectQueries": string[], "websiteQueries": string[], "emailQueries": string[] }',
    `Context: ${JSON.stringify({
      targetAudience: input.targetAudience,
      triggerContext: input.triggerContext ?? "",
      offer: input.offer,
      brandName: input.brandName,
      brandWebsite: input.brandWebsite,
      experimentName: input.experimentName,
      startState: input.startState,
    })}`,
  ].join("\n");

  const model = resolveLlmModel("lead_actor_query_planning", { prompt });
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
      max_output_tokens: 1800,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Actor discovery query planning failed: HTTP ${response.status} ${raw.slice(0, 240)}`);
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }

  const parsed = parseLooseJsonObject(extractOutputText(payload));

  const row = asRecord(parsed);
  const queriesRoot = asRecord(row.queries);
  const strictQueryList = (value: unknown, label: string) => {
    const fromValue = Array.isArray(value)
      ? value.map((entry) => trimText(entry, 120))
      : typeof value === "string"
        ? value
            .split("\n")
            .map((entry) => trimText(entry, 120))
        : [];
    const cleaned = uniqueTrimmed(fromValue, APIFY_STORE_MAX_QUERIES_PER_STAGE);
    if (!cleaned.length) {
      throw new Error(`Actor discovery planning returned no ${label} queries`);
    }
    return cleaned;
  };
  const plan: ActorDiscoveryQueryPlan = {
    prospectQueries: strictQueryList(
      row.prospectQueries ?? queriesRoot.prospectQueries ?? queriesRoot.prospect,
      "prospect"
    ),
    websiteQueries: strictQueryList(
      row.websiteQueries ?? queriesRoot.websiteQueries ?? queriesRoot.website,
      "website"
    ),
    emailQueries: strictQueryList(
      row.emailQueries ?? queriesRoot.emailQueries ?? queriesRoot.email,
      "email"
    ),
  };

  plan.prospectQueries = anchorQueriesToAudience(plan.prospectQueries, input.targetAudience, "prospect_discovery");
  plan.websiteQueries = anchorQueriesToAudience(plan.websiteQueries, input.targetAudience, "website_enrichment");
  plan.emailQueries = anchorQueriesToAudience(plan.emailQueries, input.targetAudience, "email_discovery");
  plan.prospectQueries = addCoverageQueries({
    queries: plan.prospectQueries,
    targetAudience: input.targetAudience,
    stage: "prospect_discovery",
  });
  plan.websiteQueries = addCoverageQueries({
    queries: plan.websiteQueries,
    targetAudience: input.targetAudience,
    stage: "website_enrichment",
  });
  plan.emailQueries = addCoverageQueries({
    queries: plan.emailQueries,
    targetAudience: input.targetAudience,
    stage: "email_discovery",
  });

  return { mode: "openai", plan };
}

function actorCandidateScore(input: {
  actor: ApifyStoreActor;
  matchedQueries: number;
  requestedStages: number;
  targetAudience: string;
}) {
  const stageHint = stageFromActor(input.actor);
  const stageBoost = stageHint === "email_discovery" ? 22 : stageHint === "prospect_discovery" ? 14 : 10;
  const pricingModel = String(input.actor.pricingModel ?? "").toUpperCase();
  const monthlyPenalty =
    pricingModel.includes("FLAT_PRICE_PER_MONTH") || pricingModel.includes("SUBSCRIPTION") ? 60 : 0;
  const expensiveRunPenalty = input.actor.pricePerUnitUsd > 2 ? Math.min(40, input.actor.pricePerUnitUsd * 6) : 0;
  const freeTrialBoost = input.actor.trialMinutes > 0 ? 8 : 0;
  const icpRoleCompany = isRoleCompanyIcpAudience(input.targetAudience);
  const surface = actorSurfaceSignals(input.actor);
  const mismatchReason = audienceSurfaceMismatchReasonForActor(input.targetAudience, input.actor);
  const leadSurfaceBoost = icpRoleCompany && surface.coreLeadSurface ? 26 : 0;
  const offSurfacePenalty = icpRoleCompany && !surface.coreLeadSurface ? 36 : 0;
  const mismatchPenalty = icpRoleCompany && mismatchReason ? 220 : 0;
  return (
    actorScore(input.actor) +
    input.matchedQueries * 6 +
    input.requestedStages * 15 +
    stageBoost +
    freeTrialBoost -
    monthlyPenalty -
    expensiveRunPenalty +
    leadSurfaceBoost -
    offSurfacePenalty -
    mismatchPenalty
  );
}

async function buildApifyActorPool(input: {
  targetAudience: string;
  triggerContext?: string;
  offer: string;
  brandName: string;
  brandWebsite: string;
  experimentName: string;
  startState: SourcingStartState;
}) {
  const queryPlanResult = await planActorDiscoveryQueries({
    targetAudience: input.targetAudience,
    triggerContext: input.triggerContext ?? "",
    offer: input.offer,
    brandName: input.brandName,
    brandWebsite: input.brandWebsite,
    experimentName: input.experimentName,
    startState: input.startState,
  });
  const stageQueries: Array<{ stage: LeadChainStepStage; queries: string[] }> = [
    { stage: "prospect_discovery", queries: queryPlanResult.plan.prospectQueries },
    { stage: "website_enrichment", queries: queryPlanResult.plan.websiteQueries },
    { stage: "email_discovery", queries: queryPlanResult.plan.emailQueries },
  ];

  const pooled = new Map<
    string,
    {
      actor: ApifyStoreActor;
      matchedQueryKeys: Set<string>;
      requestedStages: Set<LeadChainStepStage>;
    }
  >();
  const searchDiagnostics: Array<Record<string, unknown>> = [];

  for (const stageQuerySet of stageQueries) {
    const queries = stageQuerySet.queries.slice(0, APIFY_STORE_MAX_QUERIES_PER_STAGE);
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
      const query = queries[queryIndex];
      const offsets = [0];
      if (queryIndex < 3) {
        offsets.push(APIFY_STORE_SEARCH_LIMIT);
      }

      for (const offset of offsets) {
        const search = await searchApifyStoreActors({
          query,
          limit: APIFY_STORE_SEARCH_LIMIT,
          offset,
        });
        searchDiagnostics.push({
          stage: stageQuerySet.stage,
          query,
          offset,
          ok: search.ok,
          total: search.total,
          count: search.actors.length,
          error: search.error,
        });
        if (!search.ok) break;

        for (const actor of search.actors) {
          if (!actor.actorId) continue;
          const existing = pooled.get(actor.actorId);
          if (!existing) {
            pooled.set(actor.actorId, {
              actor,
              matchedQueryKeys: new Set([`${stageQuerySet.stage}:${query.toLowerCase()}`]),
              requestedStages: new Set([stageQuerySet.stage]),
            });
            continue;
          }
          if (actorScore(actor) > actorScore(existing.actor)) {
            existing.actor = actor;
          }
          existing.matchedQueryKeys.add(`${stageQuerySet.stage}:${query.toLowerCase()}`);
          existing.requestedStages.add(stageQuerySet.stage);
        }

        if (search.actors.length < APIFY_STORE_SEARCH_LIMIT) {
          break;
        }
      }
    }
  }

  const ranked = Array.from(pooled.values())
    .map((entry) => ({
      actor: entry.actor,
      stageHint: stageFromActor(entry.actor),
      score: actorCandidateScore({
        actor: entry.actor,
        matchedQueries: entry.matchedQueryKeys.size,
        requestedStages: entry.requestedStages.size,
        targetAudience: input.targetAudience,
      }),
    }))
    .sort((a, b) => b.score - a.score);

  const pricingSafeRanked = ranked.filter((row) => {
    const pricingModel = String(row.actor.pricingModel ?? "").toUpperCase();
    return !pricingModel.includes("FLAT_PRICE_PER_MONTH") && !pricingModel.includes("SUBSCRIPTION");
  });
  const rankingPoolBase = pricingSafeRanked.length ? pricingSafeRanked : ranked;
  const roleCompanyIcp = isRoleCompanyIcpAudience(input.targetAudience);
  const audienceScopedPool = roleCompanyIcp
    ? rankingPoolBase.filter((row) => !audienceSurfaceMismatchReasonForActor(input.targetAudience, row.actor))
    : rankingPoolBase;
  const rankingPool = audienceScopedPool;

  const selected = new Set<string>();
  for (const stage of ["prospect_discovery", "website_enrichment", "email_discovery"] as const) {
    const stageTop = rankingPool.filter((row) => row.stageHint === stage).slice(0, 22);
    for (const row of stageTop) {
      selected.add(row.actor.actorId);
      if (selected.size >= APIFY_STORE_MAX_RESULTS) break;
    }
    if (selected.size >= APIFY_STORE_MAX_RESULTS) break;
  }
  for (const row of rankingPool) {
    if (selected.size >= APIFY_STORE_MAX_RESULTS) break;
    selected.add(row.actor.actorId);
  }

  const actors = rankingPool
    .filter((row) => selected.has(row.actor.actorId))
    .map((row) => row.actor)
    .slice(0, APIFY_STORE_MAX_RESULTS);

  return {
    actors,
    searchDiagnostics,
    queryPlanMode: queryPlanResult.mode,
    queryPlan: queryPlanResult.plan,
    audienceScopedActorCount: audienceScopedPool.length,
    audienceScopedRejectedCount: rankingPoolBase.length - audienceScopedPool.length,
  };
}

async function selectPlanningActorsWithLlm(input: {
  actors: ApifyStoreActor[];
  targetAudience: string;
  triggerContext?: string;
  offer: string;
  brandName: string;
  brandWebsite: string;
  experimentName: string;
  startState: SourcingStartState;
  actorProfilesById: Map<string, ActorCapabilityProfile>;
  actorMemoryById: Map<string, SourcingActorMemory>;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !input.actors.length) return [] as string[];
  try {
    const shortlist = input.actors.slice(0, 110).map((actor) => ({
      ...(() => {
        const profile = input.actorProfilesById.get(actor.actorId);
        const schemaKeys = schemaSummaryKeys(profile?.schemaSummary);
        const memory = input.actorMemoryById.get(actor.actorId.toLowerCase());
        const requiredTokens = schemaKeys.requiredKeys.map(normalizeSchemaKeyToken).filter(Boolean);
        const runtimeUnsafeRequired = requiredTokens.some((token) => isRuntimeUnsafeRequiredKey(token));
        return {
          requiredKeys: schemaKeys.requiredKeys.slice(0, 12),
          knownKeyCount: schemaKeys.knownKeys.length,
          runtimeUnsafeRequired,
          memory: memory
            ? {
                successCount: memory.successCount,
                failCount: memory.failCount,
                compatibilityFailCount: memory.compatibilityFailCount,
                avgQuality: memory.avgQuality,
              }
            : null,
        };
      })(),
      actorId: actor.actorId,
      stageHint: stageFromActor(actor),
      title: trimText(actor.title, 120),
      description: trimText(actor.description, 180),
      categories: actor.categories.slice(0, 5),
      users30Days: actor.users30Days,
      rating: actor.rating,
      pricingModel: actor.pricingModel,
      pricePerUnitUsd: actor.pricePerUnitUsd,
      trialMinutes: actor.trialMinutes,
    }));

    const prompt = [
      "Select Apify actors for B2B outreach lead sourcing chain planning.",
      "Goal: maximize real people + business-email lead yield with high run compatibility.",
      "Targeting rule: prioritize actor relevance to role/company ICP in targetAudience.",
      "Treat triggerContext as secondary context; do not over-weight behavior/event phrases during actor selection.",
      "Assume only startState.availableSignals exist at step 0; if profile/sales-nav/file/auth signals are absent, deprioritize actors that likely require them.",
      "Prefer people-source and professional contact data actors (e.g. LinkedIn/Sales Navigator/company DB/email finder) over generic social, jobs-only, or broad website contact scrapers.",
      "Penalize actors that primarily scrape consumer/social feeds unless they clearly return B2B person+company+email records.",
      "Use only provided actorIds. Return JSON only.",
      "Prioritize actors that can run with public inputs and produce lead/company/email signals.",
      "Avoid actors requiring runtime auth/cookies/files, and deprioritize actors with high compatibility failures in memory.",
      "Avoid actors likely unrelated to B2B lead sourcing for this experiment.",
      "Return at most 45 actorIds with stage diversity.",
      '{ "selectedActorIds": string[] }',
      `Context: ${JSON.stringify({
        targetAudience: input.targetAudience,
        triggerContext: input.triggerContext ?? "",
        offer: input.offer,
        brandName: input.brandName,
        brandWebsite: input.brandWebsite,
        experimentName: input.experimentName,
        startState: input.startState,
      })}`,
      `actorPool: ${JSON.stringify(shortlist)}`,
    ].join("\n");

    const model = resolveLlmModel("lead_chain_planning", { prompt });
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
        max_output_tokens: 1800,
      }),
    });
    const raw = await response.text();
    if (!response.ok) return [] as string[];

    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    const parsed = parseLooseJsonObject(extractOutputText(payload));
    const row = asRecord(parsed);
    const selectedIds = Array.isArray(row.selectedActorIds)
      ? row.selectedActorIds.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const allowed = new Set(input.actors.map((actor) => actor.actorId.toLowerCase()));
    return uniqueTrimmed(selectedIds, 45).filter((actorId) => allowed.has(actorId.toLowerCase()));
  } catch {
    return [] as string[];
  }
}

async function scoreFirstStepActorsWithLlm(input: {
  actors: ApifyStoreActor[];
  targetAudience: string;
  triggerContext?: string;
  offer: string;
  startState: SourcingStartState;
  contractsByActorId: Map<string, ActorSemanticContract>;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !input.actors.length) {
    return new Map<string, { suitable: boolean; score: number; reason: string }>();
  }

  try {
    const shortlist = input.actors.slice(0, 120).map((actor) => {
      const contract = input.contractsByActorId.get(actor.actorId);
      return {
        actorId: actor.actorId,
        stageHint: stageFromActor(actor),
        title: trimText(actor.title, 120),
        description: trimText(actor.description, 220),
        categories: actor.categories.slice(0, 6),
        requiredInputs: contract?.requiredInputs ?? [],
        producedOutputs: contract?.producedOutputs ?? [],
        requiresAuth: Boolean(contract?.requiresAuth),
        requiresFileInput: Boolean(contract?.requiresFileInput),
      };
    });

    const prompt = [
      "Score whether each actor is suitable as STEP 1 for B2B lead sourcing.",
      "Goal: avoid expensive probes on actors that cannot start from current inputs or are irrelevant to ICP.",
      "Targeting rule: targetAudience role/company ICP is primary; triggerContext is secondary.",
      "First-step actor should discover target people/companies for outreach (not generic local/business directories, jobs boards, or unrelated data surfaces).",
      "If actor requires missing startState signals (auth/file/profile/sales nav) mark unsuitable.",
      "Return strict JSON only.",
      '{ "actors": [{ "actorId": string, "suitable": boolean, "score": number, "reason": string }] }',
      `Context: ${JSON.stringify({
        targetAudience: input.targetAudience,
        triggerContext: input.triggerContext ?? "",
        offer: input.offer,
        startState: input.startState,
      })}`,
      `actorPool: ${JSON.stringify(shortlist)}`,
    ].join("\n");

    const model = resolveLlmModel("lead_chain_selection", { prompt });
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
        max_output_tokens: 2200,
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      return new Map<string, { suitable: boolean; score: number; reason: string }>();
    }

    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    const parsed = parseLooseJsonObject(extractOutputText(payload));
    const root = asRecord(parsed);
    const rows = Array.isArray(root.actors) ? root.actors : [];
    const decisions = new Map<string, { suitable: boolean; score: number; reason: string }>();
    for (const rowRaw of rows) {
      const row = asRecord(rowRaw);
      const actorId = String(row.actorId ?? "").trim();
      if (!actorId) continue;
      decisions.set(actorId.toLowerCase(), {
        suitable: Boolean(row.suitable),
        score: Math.max(0, Math.min(1, Number(row.score ?? 0) || 0)),
        reason: trimText(row.reason, 220),
      });
    }
    return decisions;
  } catch {
    return new Map<string, { suitable: boolean; score: number; reason: string }>();
  }
}

function bootstrapCandidateScore(input: {
  actor: ApifyStoreActor;
  stage: LeadChainStepStage;
  contract?: ActorSemanticContract;
}) {
  const outputSignals = new Set(input.contract?.producedOutputs ?? defaultStageOutputs(input.stage));
  const signalScore =
    (outputSignals.has("company_list") ? 16 : 0) +
    (outputSignals.has("domain_list") ? 14 : 0) +
    (outputSignals.has("website_list") ? 12 : 0) +
    (outputSignals.has("profile_url_list") ? 8 : 0) +
    (outputSignals.has("email_list") ? 4 : 0);
  const stageScore = input.stage === "prospect_discovery" ? 24 : input.stage === "website_enrichment" ? 18 : 8;
  return actorScore(input.actor) + signalScore + stageScore;
}

async function selectBootstrapActorsWithLlm(input: {
  actors: ApifyStoreActor[];
  contractsByActorId: Map<string, ActorSemanticContract>;
  startState: SourcingStartState;
  targetAudience: string;
  triggerContext?: string;
  offer: string;
}) {
  const eligibleRows = input.actors
    .map((actor) => {
      const contract = input.contractsByActorId.get(actor.actorId);
      const stage = stageFromActor(actor);
      const missingStep0Signals = missingSignalsAtStepZero({
        contract,
        startState: input.startState,
      });
      const mismatchReason = audienceSurfaceMismatchReasonForActor(input.targetAudience, actor);
      const outputSignals = contract?.producedOutputs?.length
        ? contract.producedOutputs
        : defaultStageOutputs(stage);
      const outputSignalSet = new Set(outputSignals);
      const providesBootstrapSignals =
        outputSignalSet.has("company_list") ||
        outputSignalSet.has("domain_list") ||
        outputSignalSet.has("website_list") ||
        outputSignalSet.has("profile_url_list");
      return {
        actor,
        contract,
        stage,
        missingStep0Signals,
        mismatchReason,
        providesBootstrapSignals,
      };
    })
    .filter((row) => !row.missingStep0Signals.length)
    .filter((row) => !row.contract?.requiresAuth && !row.contract?.requiresFileInput)
    .sort((a, b) => {
      const aScore =
        bootstrapCandidateScore({ actor: a.actor, stage: a.stage, contract: a.contract }) -
        (a.mismatchReason ? 80 : 0) +
        (a.providesBootstrapSignals ? 18 : 0);
      const bScore =
        bootstrapCandidateScore({ actor: b.actor, stage: b.stage, contract: b.contract }) -
        (b.mismatchReason ? 80 : 0) +
        (b.providesBootstrapSignals ? 18 : 0);
      return bScore - aScore;
    });

  const pickDiverse = (
    rows: Array<{
      actor: ApifyStoreActor;
      stage: LeadChainStepStage;
      mismatchReason: string;
      providesBootstrapSignals: boolean;
    }>,
    max: number
  ) => {
    const out: string[] = [];
    const stageCaps: Record<LeadChainStepStage, number> = {
      prospect_discovery: 5,
      website_enrichment: 5,
      email_discovery: 3,
    };
    const stageCounts: Record<LeadChainStepStage, number> = {
      prospect_discovery: 0,
      website_enrichment: 0,
      email_discovery: 0,
    };
    for (const row of rows) {
      if (out.length >= max) break;
      if (stageCounts[row.stage] >= stageCaps[row.stage]) continue;
      if (row.stage === "email_discovery" && !row.providesBootstrapSignals && out.length < 5) continue;
      stageCounts[row.stage] += 1;
      out.push(row.actor.actorId);
    }
    return uniqueTrimmed(out, max);
  };

  let fallback = pickDiverse(eligibleRows, 12);
  if (fallback.length < 3) {
    const relaxedRows = input.actors
      .map((actor) => {
        const contract = input.contractsByActorId.get(actor.actorId);
        const stage = stageFromActor(actor);
        const missingStep0Signals = missingSignalsAtStepZero({
          contract,
          startState: input.startState,
        });
        return {
          actor,
          contract,
          stage,
          missingStep0Signals,
          mismatchReason: audienceSurfaceMismatchReasonForActor(input.targetAudience, actor),
          providesBootstrapSignals: new Set(contract?.producedOutputs ?? defaultStageOutputs(stage)).has("company_list"),
        };
      })
      .filter((row) => !row.missingStep0Signals.length)
      .filter((row) => !row.contract?.requiresAuth && !row.contract?.requiresFileInput)
      .sort(
        (a, b) =>
          bootstrapCandidateScore({ actor: b.actor, stage: b.stage, contract: b.contract }) -
          bootstrapCandidateScore({ actor: a.actor, stage: a.stage, contract: a.contract })
      );
    fallback = pickDiverse(relaxedRows, 12);
  }
  if (!eligibleRows.length) {
    return fallback;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return fallback;
  }

  const shortlist = eligibleRows.slice(0, 40).map((row) => ({
    actorId: row.actor.actorId,
    stage: row.stage,
    title: trimText(row.actor.title, 120),
    description: trimText(row.actor.description, 180),
    categories: row.actor.categories.slice(0, 6),
    producedOutputs: row.contract?.producedOutputs ?? defaultStageOutputs(row.stage),
    requiredInputs: row.contract?.requiredInputs ?? [],
    users30Days: row.actor.users30Days,
    rating: row.actor.rating,
    trialMinutes: row.actor.trialMinutes,
  }));

  try {
    const prompt = [
      "Select bootstrap Apify actors to generate real seed signals for chain planning.",
      "Goal: from query-first context, quickly produce company/domain/website/person signals for downstream enrichment actors.",
      "Choose actors that can run immediately from startState without auth/file/profile-url prerequisites.",
      "Prefer actors that return company/domain/website signals using broad search + ICP context.",
      "Prefer geographically compatible actors when geography is implied by targetAudience; avoid country-locked actors that mismatch the ICP market.",
      "Avoid tools/validators and any actor that does not source raw lead/company data.",
      "Return strict JSON only.",
      '{ "selectedActorIds": string[] }',
      `Context: ${JSON.stringify({
        targetAudience: input.targetAudience,
        triggerContext: input.triggerContext ?? "",
        offer: input.offer,
        startState: input.startState,
      })}`,
      `actorPool: ${JSON.stringify(shortlist)}`,
    ].join("\n");
    const model = resolveLlmModel("lead_chain_selection", { prompt });
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
        max_output_tokens: 900,
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      return fallback;
    }
    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    const parsed = parseLooseJsonObject(extractOutputText(payload));
    const row = asRecord(parsed);
    const selected = Array.isArray(row.selectedActorIds)
      ? row.selectedActorIds.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const allowed = new Set(fallback.map((actorId) => actorId.toLowerCase()));
    const picked = uniqueTrimmed(selected, 12).filter((actorId) => allowed.has(actorId.toLowerCase()));
    return picked.length ? picked : fallback;
  } catch {
    return fallback;
  }
}

async function runBootstrapSourcingSignals(input: {
  targetAudience: string;
  triggerContext?: string;
  offer: string;
  startState: SourcingStartState;
  actorPool: ApifyStoreActor[];
  contractsByActorId: Map<string, ActorSemanticContract>;
  token: string;
  actorSchemaCache: ActorSchemaProfileCache;
}) {
  let chainData = buildInitialChainData({
    targetAudience: input.targetAudience,
    triggerContext: input.triggerContext ?? "",
    offer: input.offer,
  });
  let currentStartState = input.startState;
  let budgetUsedUsd = 0;
  const attempts: SourcingBootstrapAttempt[] = [];
  let reason = "";

  const selectedActorIds = await selectBootstrapActorsWithLlm({
    actors: input.actorPool,
    contractsByActorId: input.contractsByActorId,
    startState: currentStartState,
    targetAudience: input.targetAudience,
    triggerContext: input.triggerContext,
    offer: input.offer,
  });

  if (!selectedActorIds.length) {
    return {
      chainData,
      startState: currentStartState,
      attempts,
      selectedActorIds: [],
      budgetUsedUsd,
      reason: "no_bootstrap_actors_selected",
    } satisfies SourcingBootstrapResult;
  }

  for (const actorId of selectedActorIds) {
    if (attempts.length >= APIFY_BOOTSTRAP_MAX_STEPS) break;
    if (budgetUsedUsd + APIFY_PROBE_STEP_COST_ESTIMATE_USD > APIFY_BOOTSTRAP_PROBE_BUDGET_USD) {
      reason = "bootstrap_budget_exhausted";
      break;
    }
    const actor = input.actorPool.find((item) => item.actorId.toLowerCase() === actorId.toLowerCase());
    if (!actor) continue;
    const stage = stageFromActor(actor);
    const step: LeadSourcingChainStep = {
      id: `bootstrap_${attempts.length + 1}`,
      stage,
      actorId: actor.actorId,
      purpose: "Bootstrap real seed signals for dynamic chain planning.",
      queryHint: trimText([input.targetAudience, input.triggerContext ?? "", input.offer].filter(Boolean).join(" | "), 180),
    };
    const actorInput = buildChainStepInput({
      step,
      chainData,
      targetAudience: input.targetAudience,
      maxLeads: APIFY_PROBE_MAX_LEADS,
      probeMode: true,
    });
    const profile = await getActorSchemaProfileCached({
      cache: input.actorSchemaCache,
      actorId: actor.actorId,
      token: input.token,
    });
    if (!profile.ok || !profile.profile) {
      attempts.push({
        actorId: actor.actorId,
        stage,
        outcome: "fail",
        probeInputHash: "",
        reason: "actor_profile_unavailable",
        costEstimateUsd: 0,
        rowCount: 0,
        details: { error: profile.error },
      });
      continue;
    }

    const normalizedInput = normalizeActorInputForSchema({
      actorProfile: profile.profile,
      actorInput,
      stage,
    });
    let actorInputForRun = { ...normalizedInput.input };
    let probeInputHash = hashProbeInput(actorInputForRun);
    const compatibility = evaluateActorCompatibility({
      actorProfile: profile.profile,
      actorInput: actorInputForRun,
      stage,
    });
    if (!compatibility.ok) {
      attempts.push({
        actorId: actor.actorId,
        stage,
        outcome: "fail",
        probeInputHash,
        reason: "actor_input_incompatible",
        costEstimateUsd: 0,
        rowCount: 0,
        details: {
          compatibilityReason: compatibility.reason,
          missingRequired: compatibility.missingRequired,
          normalizedInputAdjustments: normalizedInput.adjustments,
        },
      });
      continue;
    }

    let repairReason = "";
    let run = await runApifyActorSyncGetDatasetItems({
      actorId: actor.actorId,
      actorInput: actorInputForRun,
      token: input.token,
      timeoutSeconds: 35,
    });
    for (let repairAttempt = 0; repairAttempt < 8 && !run.ok; repairAttempt += 1) {
      const repaired = repairActorInputFromProviderError({
        actorInput: actorInputForRun,
        errorText: run.error,
        stage,
      });
      if (!repaired.repaired) break;
      const beforeHash = hashProbeInput(actorInputForRun);
      const afterHash = hashProbeInput(repaired.actorInput);
      if (beforeHash === afterHash) break;
      actorInputForRun = repaired.actorInput;
      probeInputHash = afterHash;
      repairReason = repairReason ? `${repairReason};${repaired.reason}` : repaired.reason;
      run = await runApifyActorSyncGetDatasetItems({
        actorId: actor.actorId,
        actorInput: actorInputForRun,
        token: input.token,
        timeoutSeconds: 35,
      });
    }
    budgetUsedUsd += APIFY_PROBE_STEP_COST_ESTIMATE_USD;

    if (!run.ok) {
      attempts.push({
        actorId: actor.actorId,
        stage,
        outcome: "fail",
        probeInputHash,
        reason: "bootstrap_run_failed",
        costEstimateUsd: APIFY_PROBE_STEP_COST_ESTIMATE_USD,
        rowCount: 0,
        details: {
          error: run.error,
          normalizedInputAdjustments: normalizedInput.adjustments,
          repairReason,
        },
      });
      continue;
    }

    const beforeSignals = {
      companies: chainData.companies.length,
      websites: chainData.websites.length,
      domains: chainData.domains.length,
      profileUrls: chainData.profileUrls.length,
      emails: chainData.emails.length,
      phones: chainData.phones.length,
    };
    chainData = mergeChainData(chainData, run.rows);
    currentStartState = mergeStartStateWithChainData({
      startState: currentStartState,
      chainData,
    });

    attempts.push({
      actorId: actor.actorId,
      stage,
      outcome: "pass",
      probeInputHash,
      reason: "",
      costEstimateUsd: APIFY_PROBE_STEP_COST_ESTIMATE_USD,
      rowCount: run.rows.length,
      details: {
        signalDelta: {
          companies: chainData.companies.length - beforeSignals.companies,
          websites: chainData.websites.length - beforeSignals.websites,
          domains: chainData.domains.length - beforeSignals.domains,
          profileUrls: chainData.profileUrls.length - beforeSignals.profileUrls,
          emails: chainData.emails.length - beforeSignals.emails,
          phones: chainData.phones.length - beforeSignals.phones,
        },
        normalizedInputAdjustments: normalizedInput.adjustments,
        repairReason,
      },
    });

    if (hasBootstrapCoverage(chainData)) {
      reason = "bootstrap_signal_coverage_reached";
      break;
    }
  }

  if (!reason) {
    reason = hasBootstrapCoverage(chainData) ? "bootstrap_signal_coverage_reached" : "bootstrap_completed_partial";
  }

  return {
    chainData,
    startState: currentStartState,
    attempts,
    selectedActorIds,
    budgetUsedUsd,
    reason,
  } satisfies SourcingBootstrapResult;
}

function parseLeadChainPlanCandidate(input: {
  raw: unknown;
  allowedActorIds: Set<string>;
  fallbackId: string;
}) {
  const row = asRecord(input.raw);
  const strategy = trimText(row.strategy, 200) || "actor_chain";
  const rationale = trimText(row.rationale, 360);
  const stepsRaw = Array.isArray(row.steps) ? row.steps : [];
  const steps: LeadSourcingChainStep[] = [];
  const seenIds = new Set<string>();

  for (let index = 0; index < stepsRaw.length; index += 1) {
    const stepRow = asRecord(stepsRaw[index]);
    const stage = stageFromValue(String(stepRow.stage ?? "").trim().toLowerCase());
    if (!stage) continue;
    const actorId = String(stepRow.actorId ?? "").trim();
    if (!actorId || !input.allowedActorIds.has(actorId.toLowerCase())) continue;
    const id = trimText(stepRow.id || `${stage}_${index + 1}`, 60).replace(/\s+/g, "_");
    if (!id || seenIds.has(id.toLowerCase())) continue;
    seenIds.add(id.toLowerCase());
    steps.push({
      id,
      stage,
      purpose: trimText(stepRow.purpose, 180),
      actorId,
      queryHint: trimText(stepRow.queryHint, 200),
    });
  }

  const stageOrder = steps.map((step) => step.stage);
  const stageOrderError = validateLeadChainStageOrder(stageOrder);
  if (stageOrderError) return null;
  if (!steps.length) return null;

  return {
    id: trimText(row.id || input.fallbackId, 80).replace(/\s+/g, "_"),
    strategy,
    rationale,
    steps: steps.slice(0, APIFY_CHAIN_MAX_STEPS),
  } satisfies LeadSourcingChainPlan;
}

function sourcingCandidateKey(steps: Array<{ stage: LeadChainStepStage; actorId: string }>) {
  return steps.map((step) => `${step.stage}:${step.actorId.toLowerCase()}`).join("->");
}

function missingSignalsAtStepZero(input: {
  contract: ActorSemanticContract | undefined;
  startState: SourcingStartState;
}) {
  if (!input.contract) return [];
  const availableSignals = new Set<SemanticSignal>(
    input.startState.availableSignals.length ? input.startState.availableSignals : ["query"]
  );
  const missing = new Set<SemanticSignal>();
  if (input.contract.requiresAuth && !availableSignals.has("auth_token")) {
    missing.add("auth_token");
  }
  if (input.contract.requiresFileInput && !availableSignals.has("file_upload")) {
    missing.add("file_upload");
  }
  for (const signal of input.contract.requiredInputs) {
    if (!availableSignals.has(signal)) {
      missing.add(signal);
    }
  }
  return Array.from(missing);
}

const QUERY_COMPATIBLE_REQUIRED_SIGNALS = new Set<SemanticSignal>([
  "company_list",
  "domain_list",
  "website_list",
  "profile_url_list",
  "email_list",
  "phone_list",
]);

const QUERY_INPUT_KEY_HINTS = [
  "query",
  "search",
  "keyword",
  "keywords",
  "title",
  "jobtitle",
  "role",
  "company",
  "industry",
  "segment",
  "location",
];

function actorHasQueryInputCapability(profile: ActorCapabilityProfile | undefined) {
  const schemaKeys = schemaSummaryKeys(profile?.schemaSummary);
  const tokens = [...schemaKeys.requiredKeys, ...schemaKeys.knownKeys]
    .map(normalizeSchemaKeyToken)
    .filter(Boolean);
  return tokens.some((token) => QUERY_INPUT_KEY_HINTS.some((hint) => token.includes(hint)));
}

async function planApifyLeadChainCandidates(input: {
  targetAudience: string;
  triggerContext?: string;
  brandName: string;
  brandWebsite: string;
  experimentName: string;
  offer: string;
  startState: SourcingStartState;
  actorPool: ApifyStoreActor[];
  actorProfilesById: Map<string, ActorCapabilityProfile>;
  contractsByActorId: Map<string, ActorSemanticContract>;
  actorMemoryRows: SourcingActorMemory[];
  maxCandidates?: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }
  if (!input.actorPool.length) {
    throw new Error("No actor candidates available from Apify Store");
  }

  let planningPool = (() => {
    const selected: ApifyStoreActor[] = [];
    const seen = new Set<string>();
    const push = (actor: ApifyStoreActor) => {
      const key = actor.actorId.toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      selected.push(actor);
    };

    const stageCaps: Record<LeadChainStepStage, number> = {
      prospect_discovery: 26,
      website_enrichment: 22,
      email_discovery: 32,
    };
    for (const stage of ["prospect_discovery", "website_enrichment", "email_discovery"] as const) {
      let count = 0;
      for (const actor of input.actorPool) {
        if (stageFromActor(actor) !== stage) continue;
        push(actor);
        count += 1;
        if (count >= stageCaps[stage]) break;
      }
    }
    for (const actor of input.actorPool) {
      if (selected.length >= 90) break;
      push(actor);
    }
    return selected.slice(0, 90);
  })();

  const llmSelectedActorIds = await selectPlanningActorsWithLlm({
    actors: planningPool,
    targetAudience: input.targetAudience,
    triggerContext: input.triggerContext ?? "",
    offer: input.offer,
    brandName: input.brandName,
    brandWebsite: input.brandWebsite,
    experimentName: input.experimentName,
    startState: input.startState,
    actorProfilesById: input.actorProfilesById,
    actorMemoryById: new Map(input.actorMemoryRows.map((row) => [row.actorId.toLowerCase(), row])),
  });
  if (llmSelectedActorIds.length >= 12) {
    const picked = new Set(llmSelectedActorIds.map((id) => id.toLowerCase()));
    const llmFiltered = planningPool.filter((actor) => picked.has(actor.actorId.toLowerCase()));
    if (llmFiltered.length >= 12) {
      const stageDiversity = new Set(llmFiltered.map((actor) => stageFromActor(actor))).size;
      const mismatchCount = llmFiltered.filter((actor) =>
        Boolean(audienceSurfaceMismatchReasonForActor(input.targetAudience, actor))
      ).length;
      const leadSurfaceCount = llmFiltered.filter((actor) => actorSurfaceSignals(actor).coreLeadSurface).length;
      const mismatchRatio = mismatchCount / Math.max(1, llmFiltered.length);
      const leadSurfaceRatio = leadSurfaceCount / Math.max(1, llmFiltered.length);
      if (stageDiversity >= 2 && mismatchRatio <= 0.35 && leadSurfaceRatio >= 0.6) {
        planningPool = llmFiltered;
      }
    }
  }

  const firstStepSuitability = await scoreFirstStepActorsWithLlm({
    actors: planningPool,
    targetAudience: input.targetAudience,
    triggerContext: input.triggerContext ?? "",
    offer: input.offer,
    startState: input.startState,
    contractsByActorId: input.contractsByActorId,
  });

  const firstStepBlockedActors: Array<{ actorId: string; reason: string }> = [];
  const actorRows = planningPool.map((actor) => {
    const stageHint = stageFromActor(actor);
    const contract = input.contractsByActorId.get(actor.actorId);
    const profile = input.actorProfilesById.get(actor.actorId);
    const mismatchReason = audienceSurfaceMismatchReasonForActor(input.targetAudience, actor);
    const rawMissingAtStepZero = missingSignalsAtStepZero({ contract, startState: input.startState });
    const queryAvailableAtStepZero = (input.startState.availableSignals.length
      ? input.startState.availableSignals
      : ["query"]
    ).includes("query");
    const canStartFromQuery =
      queryAvailableAtStepZero &&
      actorHasQueryInputCapability(profile) &&
      rawMissingAtStepZero.length > 0 &&
      rawMissingAtStepZero.every((signal) => QUERY_COMPATIBLE_REQUIRED_SIGNALS.has(signal));
    const missingAtStepZero = canStartFromQuery ? [] : rawMissingAtStepZero;
    const llmSuitability = firstStepSuitability.get(actor.actorId.toLowerCase());
    const blockedReason = mismatchReason
      ? `audience_mismatch:${mismatchReason}`
      : missingAtStepZero.length
        ? `missing_step0_signals:${missingAtStepZero.join(",")}`
        : "";
    if (blockedReason) {
      firstStepBlockedActors.push({
        actorId: actor.actorId,
        reason: blockedReason,
      });
    }
    return {
      actorId: actor.actorId,
      title: actor.title,
      description: actor.description,
      categories: actor.categories,
      users30Days: actor.users30Days,
      rating: actor.rating,
      stageHint,
      requiredInputs: contract?.requiredInputs ?? [],
      producedOutputs: contract?.producedOutputs ?? [],
      mismatchReason,
      step0MissingSignals: missingAtStepZero,
      step0RelaxedFromQuery: canStartFromQuery,
      step0EligibleForFirstStep: blockedReason === "",
      firstStepSuitabilityScore: llmSuitability?.score ?? null,
      firstStepSuitabilityReason: llmSuitability?.reason ?? "",
    };
  });
  const synthesizeDeterministicCandidates = (limit: number): LeadSourcingChainPlan[] => {
    const baseQuery = trimText(
      [input.targetAudience, input.triggerContext, input.offer].filter(Boolean).join(" | "),
      180
    );
    const actorScore = (row: (typeof actorRows)[number]) => {
      const suitability = typeof row.firstStepSuitabilityScore === "number" ? row.firstStepSuitabilityScore : 0.45;
      const usage = Math.log10(Math.max(1, Number(row.users30Days ?? 0)));
      const rating = Number.isFinite(Number(row.rating)) ? Number(row.rating) : 0;
      return suitability * 0.6 + usage * 0.28 + rating * 0.12;
    };
    const minSuitability = 0.58;
    const minRelaxedSuitability = 0.35;
    const isEligible = (row: (typeof actorRows)[number], threshold: number) =>
      row.step0EligibleForFirstStep &&
      !row.mismatchReason &&
      (typeof row.firstStepSuitabilityScore !== "number" || row.firstStepSuitabilityScore >= threshold);

    const pickTop = (rows: (typeof actorRows), max: number) =>
      rows
        .slice()
        .sort((a, b) => actorScore(b) - actorScore(a))
        .slice(0, max);

    const selectStageActors = (stage: LeadChainStepStage) => {
      const strict = pickTop(actorRows.filter((row) => row.stageHint === stage && isEligible(row, minSuitability)), 12);
      if (strict.length) return strict;
      const relaxed = pickTop(
        actorRows.filter((row) => row.stageHint === stage && isEligible(row, minRelaxedSuitability)),
        12
      );
      if (relaxed.length) return relaxed;
      return pickTop(actorRows.filter((row) => row.stageHint === stage && row.step0EligibleForFirstStep && !row.mismatchReason), 12);
    };

    const eligibleEmailFirstStep = selectStageActors("email_discovery");
    const eligibleProspectFirstStep = selectStageActors("prospect_discovery");
    const websiteMiddle = pickTop(
      actorRows.filter(
        (row) =>
          row.stageHint === "website_enrichment" &&
          (typeof row.firstStepSuitabilityScore !== "number" || row.firstStepSuitabilityScore >= 0.45)
      ),
      8
    );
    const emailFinal = pickTop(
      actorRows.filter(
        (row) =>
          row.stageHint === "email_discovery" &&
          (typeof row.firstStepSuitabilityScore !== "number" || row.firstStepSuitabilityScore >= 0.45)
      ),
      12
    );

    const out: LeadSourcingChainPlan[] = [];
    const pushCandidate = (candidate: LeadSourcingChainPlan) => {
      if (out.length >= limit) return;
      out.push(candidate);
    };

    for (const row of eligibleEmailFirstStep.slice(0, Math.max(2, Math.floor(limit / 3)))) {
      pushCandidate({
        id: `det_single_${row.actorId.replace(/[^a-z0-9]+/gi, "_").slice(0, 40)}`,
        strategy: "Deterministic single-step email discovery",
        rationale: "Auto-synthesized from top step-0 eligible email-discovery actors.",
        steps: [
          {
            id: "s1_email_discovery",
            stage: "email_discovery",
            actorId: row.actorId,
            purpose: "Find business emails for ICP-matching contacts in one step.",
            queryHint: baseQuery,
          },
        ],
      });
    }

    for (const first of websiteMiddle) {
      if (out.length >= limit) break;
      const final = emailFinal.find((row) => row.actorId.toLowerCase() !== first.actorId.toLowerCase());
      if (!final) continue;
      pushCandidate({
        id: `det_web_email_${first.actorId.replace(/[^a-z0-9]+/gi, "_").slice(0, 20)}_${final.actorId
          .replace(/[^a-z0-9]+/gi, "_")
          .slice(0, 20)}`,
        strategy: "Deterministic website -> email chain",
        rationale: "Auto-synthesized website-first path for query-only starts when direct prospect actors are weak.",
        steps: [
          {
            id: "s1_website_enrichment",
            stage: "website_enrichment",
            actorId: first.actorId,
            purpose: "Discover company websites/domains from query-driven ICP search.",
            queryHint: trimText(`${input.targetAudience} company websites`, 180),
          },
          {
            id: "s2_email_discovery",
            stage: "email_discovery",
            actorId: final.actorId,
            purpose: "Enrich website/domain outputs into business emails.",
            queryHint: trimText(`${input.targetAudience} business email`, 180),
          },
        ],
      });
    }

    for (const first of eligibleProspectFirstStep) {
      if (out.length >= limit) break;
      const final = emailFinal.find((row) => row.actorId.toLowerCase() !== first.actorId.toLowerCase());
      if (!final) continue;
      pushCandidate({
        id: `det_two_${first.actorId.replace(/[^a-z0-9]+/gi, "_").slice(0, 20)}_${final.actorId
          .replace(/[^a-z0-9]+/gi, "_")
          .slice(0, 20)}`,
        strategy: "Deterministic prospect -> email chain",
        rationale: "Auto-synthesized to preserve deterministic stage flow and seed compatibility.",
        steps: [
          {
            id: "s1_prospect_discovery",
            stage: "prospect_discovery",
            actorId: first.actorId,
            purpose: "Discover ICP-aligned people or companies from query-driven sources.",
            queryHint: trimText(input.targetAudience, 180),
          },
          {
            id: "s2_email_discovery",
            stage: "email_discovery",
            actorId: final.actorId,
            purpose: "Enrich discovered prospects/companies into business emails.",
            queryHint: trimText(`${input.targetAudience} work email`, 180),
          },
        ],
      });
    }

    for (const first of eligibleProspectFirstStep) {
      if (out.length >= limit) break;
      const middle = websiteMiddle.find((row) => row.actorId.toLowerCase() !== first.actorId.toLowerCase());
      const final = emailFinal.find(
        (row) =>
          row.actorId.toLowerCase() !== first.actorId.toLowerCase() &&
          row.actorId.toLowerCase() !== middle?.actorId.toLowerCase()
      );
      if (!middle || !final) continue;
      pushCandidate({
        id: `det_three_${first.actorId.replace(/[^a-z0-9]+/gi, "_").slice(0, 16)}_${middle.actorId
          .replace(/[^a-z0-9]+/gi, "_")
          .slice(0, 16)}_${final.actorId.replace(/[^a-z0-9]+/gi, "_").slice(0, 16)}`,
        strategy: "Deterministic prospect -> website -> email chain",
        rationale: "Auto-synthesized multi-step chain to increase schema-compatible enrichment paths.",
        steps: [
          {
            id: "s1_prospect_discovery",
            stage: "prospect_discovery",
            actorId: first.actorId,
            purpose: "Discover ICP companies/contacts from queryable sources.",
            queryHint: trimText(input.targetAudience, 180),
          },
          {
            id: "s2_website_enrichment",
            stage: "website_enrichment",
            actorId: middle.actorId,
            purpose: "Resolve websites/domains for discovered entities.",
            queryHint: trimText(`${input.targetAudience} company website`, 180),
          },
          {
            id: "s3_email_discovery",
            stage: "email_discovery",
            actorId: final.actorId,
            purpose: "Extract business emails from enriched entities.",
            queryHint: trimText(`${input.targetAudience} business email`, 180),
          },
        ],
      });
    }

    if (!out.length) {
      const emergencyFirst =
        pickTop(actorRows.filter((row) => !row.mismatchReason), 1)[0] ??
        pickTop(actorRows, 1)[0];
      const emergencyEmail = emailFinal[0] ?? pickTop(actorRows.filter((row) => row.stageHint === "email_discovery"), 1)[0];
      if (emergencyFirst) {
        if (emergencyFirst.stageHint === "email_discovery" || !emergencyEmail) {
          pushCandidate({
            id: `det_emergency_single_${emergencyFirst.actorId.replace(/[^a-z0-9]+/gi, "_").slice(0, 30)}`,
            strategy: "Deterministic emergency single-step",
            rationale: "Emergency fallback when no higher-confidence chains can be synthesized.",
            steps: [
              {
                id: "s1_email_discovery",
                stage: "email_discovery",
                actorId: emergencyFirst.actorId,
                purpose: "Attempt query-driven lead discovery in one step.",
                queryHint: trimText(input.targetAudience, 180),
              },
            ],
          });
        } else if (emergencyFirst.stageHint === "website_enrichment") {
          pushCandidate({
            id: `det_emergency_web_email_${emergencyFirst.actorId.replace(/[^a-z0-9]+/gi, "_").slice(0, 16)}_${emergencyEmail.actorId
              .replace(/[^a-z0-9]+/gi, "_")
              .slice(0, 16)}`,
            strategy: "Deterministic emergency website -> email",
            rationale: "Emergency fallback when no higher-confidence chains can be synthesized.",
            steps: [
              {
                id: "s1_website_enrichment",
                stage: "website_enrichment",
                actorId: emergencyFirst.actorId,
                purpose: "Find websites/domains from query context.",
                queryHint: trimText(`${input.targetAudience} company website`, 180),
              },
              {
                id: "s2_email_discovery",
                stage: "email_discovery",
                actorId: emergencyEmail.actorId,
                purpose: "Extract business emails from enriched sites/domains.",
                queryHint: trimText(`${input.targetAudience} business email`, 180),
              },
            ],
          });
        } else {
          pushCandidate({
            id: `det_emergency_prospect_email_${emergencyFirst.actorId.replace(/[^a-z0-9]+/gi, "_").slice(0, 16)}_${emergencyEmail.actorId
              .replace(/[^a-z0-9]+/gi, "_")
              .slice(0, 16)}`,
            strategy: "Deterministic emergency prospect -> email",
            rationale: "Emergency fallback when no higher-confidence chains can be synthesized.",
            steps: [
              {
                id: "s1_prospect_discovery",
                stage: "prospect_discovery",
                actorId: emergencyFirst.actorId,
                purpose: "Discover candidate companies/contacts from query context.",
                queryHint: trimText(input.targetAudience, 180),
              },
              {
                id: "s2_email_discovery",
                stage: "email_discovery",
                actorId: emergencyEmail.actorId,
                purpose: "Enrich discovered entities into business emails.",
                queryHint: trimText(`${input.targetAudience} work email`, 180),
              },
            ],
          });
        }
      }
    }
    return out.slice(0, limit);
  };

  const maxCandidates = Math.max(2, Math.min(APIFY_CHAIN_MAX_CANDIDATES, Number(input.maxCandidates ?? 4) || 4));
  const prompt = [
    "You plan an Apify actor chain for B2B outreach lead sourcing.",
    "Goal: produce multiple high-quality 1-3 step chains that can source real people + business emails for the provided target audience.",
    "Step-0 runtime inputs are constrained by startState.availableSignals.",
    "Do not propose a first step that needs profile URLs, Sales Navigator URLs, uploaded files, or auth if startState does not include those signals.",
    "Each actor has step0EligibleForFirstStep and step0MissingSignals metadata. Never use a first-step actor where step0EligibleForFirstStep=false.",
    "Targeting rule: use role/company ICP in targetAudience as the primary retrieval constraint.",
    "Use triggerContext only as a secondary prioritization signal and not as the core retrieval keyword set.",
    "Avoid literal trigger-only query hints (for example: pure \"demo request\" keyword mining) unless paired with strong role/company filters.",
    "Prefer chains where step 1 starts from person/company discovery in B2B data sources, not generic social/activity scraping.",
    "Avoid jobs-only and generic website contact scrapers unless they are strictly supporting enrichment for a strong people-source first step.",
    "Rules:",
    "- Use only actorIds from actorPool.",
    "- Valid stage orders are:",
    "  1) email_discovery (single-step actor that already returns people + emails),",
    "  2) website_enrichment -> email_discovery,",
    "  3) prospect_discovery -> email_discovery,",
    "  4) prospect_discovery -> website_enrichment -> email_discovery.",
    "- Final step must be email_discovery.",
    "- Do NOT include backup actors.",
    `- Return ${maxCandidates} distinct chain candidates with varied strategy.`,
    "- queryHint must be concrete and directly relevant to the experiment.",
    "- No placeholders or generic buzzword text.",
    "",
    "Return JSON only:",
    '{ "candidates": [{ "id": string, "strategy": string, "rationale": string, "steps": [{ "id": string, "stage": "prospect_discovery"|"website_enrichment"|"email_discovery", "purpose": string, "actorId": string, "queryHint": string }] }] }',
    `Context: ${JSON.stringify({
      targetAudience: input.targetAudience,
      triggerContext: input.triggerContext ?? "",
      brandName: input.brandName,
      brandWebsite: input.brandWebsite,
      experimentName: input.experimentName,
      offer: input.offer,
      startState: input.startState,
      firstStepBlockedActors: firstStepBlockedActors.slice(0, 40),
    })}`,
    `actorPool: ${JSON.stringify(actorRows)}`,
  ].join("\n");

  const model = resolveLlmModel("lead_chain_planning", { prompt });
  let parsed: unknown = {};
  let planningError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const promptWithRetryNote =
      attempt === 0
        ? prompt
        : `${prompt}\n\nRetry instruction: previous response was not valid JSON. Return only a valid JSON object.`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: promptWithRetryNote,
        text: { format: { type: "json_object" } },
        max_output_tokens: 2600,
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Apify chain planning failed: HTTP ${response.status} ${raw.slice(0, 240)}`);
    }

    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    const outputText = extractOutputText(payload);
    try {
      parsed = parseLooseJsonObject(outputText);
      planningError = "";
      break;
    } catch (error) {
      planningError = error instanceof Error ? error.message : "invalid_json";
    }
  }
  if (planningError) {
    throw new Error(`Apify chain planning returned non-JSON output: ${planningError}`);
  }

  const root = asRecord(parsed);
  const candidatesRaw =
    Array.isArray(root.candidates) && root.candidates.length
      ? root.candidates
      : Array.isArray(root.chains)
        ? root.chains
        : [];
  const allowedActorIds = new Set(planningPool.map((actor) => actor.actorId.toLowerCase()));
  let parsedCandidates = candidatesRaw
    .map((row, index) =>
      parseLeadChainPlanCandidate({
        raw: row,
        allowedActorIds,
        fallbackId: `candidate_${index + 1}`,
      })
    )
    .filter((row): row is LeadSourcingChainPlan => Boolean(row));

  if (!parsedCandidates.length) {
    const deterministicCandidates = synthesizeDeterministicCandidates(maxCandidates * 2);
    if (deterministicCandidates.length) {
      parsedCandidates = deterministicCandidates;
    } else {
      throw new Error("Chain planning produced no valid candidates");
    }
  }

  const deduped = [] as LeadSourcingChainPlan[];
  const seenKeys = new Set<string>();
  for (const candidate of parsedCandidates) {
    const key = sourcingCandidateKey(candidate.steps);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(candidate);
    if (deduped.length >= APIFY_CHAIN_MAX_CANDIDATES) break;
  }

  if (!deduped.length) {
    throw new Error("Chain planning candidates were duplicates/invalid");
  }
  if (deduped.length < maxCandidates) {
    const deterministicCandidates = synthesizeDeterministicCandidates(maxCandidates * 2);
    const existingKeys = new Set(deduped.map((candidate) => sourcingCandidateKey(candidate.steps)));
    for (const candidate of deterministicCandidates) {
      if (deduped.length >= APIFY_CHAIN_MAX_CANDIDATES) break;
      const key = sourcingCandidateKey(candidate.steps);
      if (!key || existingKeys.has(key)) continue;
      existingKeys.add(key);
      deduped.push(candidate);
    }
  }
  const firstStepBlockedReasonByActorId = new Map(firstStepBlockedActors.map((row) => [row.actorId.toLowerCase(), row.reason]));
  const firstStepFiltered = deduped.filter((candidate) => {
    const firstStep = candidate.steps[0];
    if (!firstStep) return false;
    return !firstStepBlockedReasonByActorId.has(firstStep.actorId.toLowerCase());
  });
  if (!firstStepFiltered.length) {
    const topReasons = firstStepBlockedActors
      .slice(0, 6)
      .map((row) => `${row.actorId}:${row.reason}`)
      .join(" | ");
    throw new Error(`All planned candidates used blocked first-step actors (${topReasons || "none"})`);
  }
  return firstStepFiltered;
}

function buildChainStepInput(input: {
  step: LeadSourcingChainStep;
  chainData: LeadSourcingChainData;
  targetAudience: string;
  maxLeads: number;
  probeMode?: boolean;
}) {
  const normalizedAudience = input.targetAudience.toLowerCase();
  const locationHint = /europe|emea|eu\b/.test(normalizedAudience)
    ? "Europe"
    : /united kingdom|\buk\b|britain|england/.test(normalizedAudience)
      ? "United Kingdom"
      : /canada/.test(normalizedAudience)
        ? "Canada"
        : /australia|anz/.test(normalizedAudience)
          ? "Australia"
          : "United States";
  const countryCodeHint =
    locationHint === "Europe"
      ? "EU"
      : locationHint === "United Kingdom"
        ? "GB"
        : locationHint === "Canada"
          ? "CA"
          : locationHint === "Australia"
            ? "AU"
            : "US";
  const peopleQuery = derivePeopleDiscoveryQuery(input.targetAudience);
  const companyQuery = deriveCompanyDiscoveryQuery(input.targetAudience);
  const querySeed = uniqueTrimmed(
    [
      peopleQuery,
      companyQuery,
      sanitizeLeadDiscoveryQuery(input.step.queryHint),
      ...input.chainData.queries.map((query) => sanitizeLeadDiscoveryQuery(query) || query),
      ...input.chainData.companies,
      sanitizeLeadDiscoveryQuery(input.targetAudience),
    ].filter(Boolean),
    30
  );
  const domains = uniqueTrimmed(input.chainData.domains, 100).map((item) => item.toLowerCase());
  const phones = uniqueTrimmed(input.chainData.phones, 120);
  const profileUrls = uniqueTrimmed(input.chainData.profileUrls, 200);
  const websites = uniqueTrimmed(
    [
      ...input.chainData.websites,
      ...profileUrls,
      ...domains.map((domain) => `https://${domain}`),
    ],
    120
  );

  const itemCap = input.probeMode
    ? Math.max(1, Math.min(6, input.maxLeads))
    : Math.max(20, Math.min(APIFY_CHAIN_MAX_ITEMS_PER_STEP, input.maxLeads));
  const base = {
    maxItems: itemCap,
    limit: itemCap,
    maxResults: itemCap,
    maxRequestsPerCrawl: input.probeMode ? 8 : 60,
    maxConcurrency: input.probeMode ? 2 : 8,
    maxDepth: input.probeMode ? 1 : 2,
    includeSubdomains: false,
    location: locationHint,
    country: locationHint,
    countryCode: countryCodeHint,
    region: locationHint,
    locale: countryCodeHint === "US" ? "en-US" : "en",
    language: "en",
    languageCode: "en",
  };

  if (input.step.stage === "prospect_discovery") {
    return {
      ...base,
      query: querySeed[0] ?? input.targetAudience,
      queries: querySeed,
      search: querySeed[0] ?? input.targetAudience,
      searchTerms: querySeed,
      searchStringsArray: querySeed,
      keyword: querySeed[0] ?? input.targetAudience,
      keywords: querySeed,
      phrases: querySeed,
      companies: input.chainData.companies.slice(0, 80),
      companyNames: input.chainData.companies.slice(0, 80),
      domains,
      domainNames: domains,
      startUrls: websites
        .slice(0, 20)
        .map((url) => ({ url }))
        .concat(
          websites.length
            ? []
            : [{ url: `https://www.google.com/search?q=${encodeURIComponent(querySeed[0] ?? input.targetAudience)}` }]
        ),
      phoneNumbers: phones.slice(0, 80),
      phones: phones.slice(0, 80),
      profileUrls: profileUrls.slice(0, 120),
      linkedinProfileUrls: profileUrls.slice(0, 120),
    } satisfies Record<string, unknown>;
  }

  if (input.step.stage === "website_enrichment") {
    return {
      ...base,
      query: querySeed[0] ?? input.targetAudience,
      queries: querySeed,
      companies: input.chainData.companies.slice(0, 80),
      companyNames: input.chainData.companies.slice(0, 80),
      websites,
      urls: websites,
      domains,
      domainNames: domains,
      startUrls: websites.slice(0, 60).map((url) => ({ url })),
      phoneNumbers: phones.slice(0, 80),
      phones: phones.slice(0, 80),
      profileUrls: profileUrls.slice(0, 120),
      linkedinProfileUrls: profileUrls.slice(0, 120),
    } satisfies Record<string, unknown>;
  }

  return {
    ...base,
    query: querySeed[0] ?? input.targetAudience,
    queries: querySeed,
    websites,
    urls: websites,
    domains,
    domainNames: domains,
    startUrls: websites.slice(0, 80).map((url) => ({ url })),
    emails: input.chainData.emails.slice(0, 150),
    phoneNumbers: phones.slice(0, 120),
    phones: phones.slice(0, 120),
    profileUrls: profileUrls.slice(0, 160),
    linkedinProfileUrls: profileUrls.slice(0, 160),
  } satisfies Record<string, unknown>;
}

function getSchemaProperties(schema: Record<string, unknown>) {
  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    return schema.properties as Record<string, unknown>;
  }
  return {};
}

function getSchemaTypes(propertySchema: Record<string, unknown>) {
  const raw = propertySchema.type;
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return [raw.trim().toLowerCase()];
  }
  return [];
}

function firstString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = firstString(item);
      if (resolved) return resolved;
    }
    return "";
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (typeof row.url === "string" && row.url.trim()) return row.url.trim();
    if (typeof row.value === "string" && row.value.trim()) return row.value.trim();
    return "";
  }
  return "";
}

function toStringArray(value: unknown) {
  const out: string[] = [];
  const push = (entry: unknown) => {
    const resolved = firstString(entry);
    if (resolved) out.push(resolved);
  };
  if (Array.isArray(value)) {
    for (const item of value) push(item);
  } else {
    push(value);
  }
  return uniqueTrimmed(out, 200);
}

function fallbackValueForSchemaKey(input: {
  key: string;
  actorInput: Record<string, unknown>;
  stage: LeadChainStepStage;
}) {
  const keyLower = input.key.toLowerCase();
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      if (input.actorInput[key] !== undefined) return input.actorInput[key];
    }
    return undefined;
  };
  const pickLinkedinUrl = () => {
    const sources = [
      ...toStringArray(pick("profileUrls")),
      ...toStringArray(pick("linkedinProfileUrls")),
      ...toStringArray(pick("urls")),
      ...toStringArray(pick("websites")),
      ...toStringArray(pick("startUrls")),
    ];
    const matched = sources.find((value) => value.toLowerCase().includes("linkedin.com"));
    return matched || undefined;
  };

  if (keyLower.includes("query") || keyLower.includes("search") || keyLower.includes("keyword")) {
    return pick("query", "queries", "search", "searchTerms", "searchStringsArray", "keyword", "keywords", "phrases");
  }
  if (keyLower.includes("profile") || (keyLower.includes("linkedin") && !keyLower.includes("url"))) {
    return pick("profileUrls", "linkedinProfileUrls", "urls", "websites");
  }
  if (keyLower.includes("name") && !keyLower.includes("domain")) {
    return pick("names", "companies", "companyNames", "queries", "query", "keywords", "keyword");
  }
  if (
    keyLower.includes("location") ||
    keyLower.includes("country") ||
    keyLower.includes("region") ||
    keyLower.includes("city") ||
    keyLower.includes("state")
  ) {
    return pick("location", "country", "countryCode", "region", "locale");
  }
  if (keyLower.includes("language") || keyLower.includes("locale")) {
    return pick("languageCode", "language", "locale", "countryCode");
  }
  if (keyLower.includes("linkedin") && keyLower.includes("url")) {
    return pickLinkedinUrl();
  }
  if (keyLower.includes("domain")) {
    return pick("domains", "domainNames");
  }
  if (keyLower.includes("url") || keyLower.includes("site") || keyLower.includes("web")) {
    return pick("startUrls", "urls", "websites");
  }
  if (keyLower.includes("email") || keyLower.includes("mail")) {
    return pick("emails");
  }
  if (keyLower.includes("phone") || keyLower.includes("mobile") || keyLower.includes("whatsapp")) {
    return pick("phoneNumbers", "phones");
  }
  if (keyLower.includes("compan")) {
    return pick("companies", "companyNames");
  }
  return undefined;
}

function normalizeActorInputForSchema(input: {
  actorProfile: { inputSchema: Record<string, unknown>; requiredKeys: string[]; knownKeys: string[] };
  actorInput: Record<string, unknown>;
  stage: LeadChainStepStage;
}) {
  const schema = input.actorProfile.inputSchema;
  const properties = getSchemaProperties(schema);
  const knownKeys = input.actorProfile.knownKeys;
  const requiredKeys = input.actorProfile.requiredKeys;
  // Prefer strict known-key input when schema keys are available; this avoids
  // "Property input.X is not allowed" failures on actors that enforce closed schemas.
  const restrictUnknown = knownKeys.length > 0;
  const keysToProcess = new Set<string>([
    ...Object.keys(input.actorInput),
    ...knownKeys,
    ...requiredKeys,
  ]);
  const normalized: Record<string, unknown> = {};
  const adjustments: Array<Record<string, unknown>> = [];

  for (const key of keysToProcess) {
    if (!key) continue;
    if (restrictUnknown && !knownKeys.some((known) => known.toLowerCase() === key.toLowerCase())) {
      continue;
    }

    const propertySchema =
      properties[key] && typeof properties[key] === "object" && !Array.isArray(properties[key])
        ? (properties[key] as Record<string, unknown>)
        : {};
    const types = getSchemaTypes(propertySchema);
    const hadRaw = Object.prototype.hasOwnProperty.call(input.actorInput, key);
    const rawValue =
      hadRaw ? input.actorInput[key] : fallbackValueForSchemaKey({ key, actorInput: input.actorInput, stage: input.stage });
    if (rawValue === undefined || rawValue === null) continue;

    let nextValue: unknown = rawValue;
    if (types.includes("string")) {
      nextValue = firstString(rawValue);
      if (Array.isArray(propertySchema.enum) && propertySchema.enum.length) {
        const enumValues = propertySchema.enum.map((value) => String(value ?? "").trim());
        if (!enumValues.includes(String(nextValue))) {
          nextValue = enumValues[0] ?? nextValue;
        }
      }
    } else if (types.includes("array")) {
      const values = toStringArray(rawValue);
      const itemsSchema =
        propertySchema.items && typeof propertySchema.items === "object" && !Array.isArray(propertySchema.items)
          ? (propertySchema.items as Record<string, unknown>)
          : {};
      const itemTypes = getSchemaTypes(itemsSchema);
      if (itemTypes.includes("object") || key.toLowerCase().includes("starturl")) {
        nextValue = values.map((value) => ({ url: value }));
      } else {
        nextValue = values;
      }
    } else if (types.includes("number") || types.includes("integer")) {
      const numeric = Number(firstString(rawValue));
      if (Number.isFinite(numeric)) {
        const min = Number(propertySchema.minimum);
        const max = Number(propertySchema.maximum);
        let normalizedNumeric = types.includes("integer") ? Math.round(numeric) : numeric;
        if (Number.isFinite(min)) normalizedNumeric = Math.max(normalizedNumeric, min);
        if (Number.isFinite(max)) normalizedNumeric = Math.min(normalizedNumeric, max);
        nextValue = normalizedNumeric;
      } else {
        continue;
      }
    } else if (types.includes("boolean")) {
      const value = firstString(rawValue).toLowerCase();
      nextValue = ["1", "true", "yes", "on"].includes(value);
    } else if (types.includes("object")) {
      if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
        nextValue = rawValue;
      } else {
        const asString = firstString(rawValue);
        if (!asString) continue;
        nextValue = { value: asString };
      }
    }

    if (typeof nextValue === "string" && !nextValue.trim()) continue;
    if (Array.isArray(nextValue) && !nextValue.length) continue;
    normalized[key] = nextValue;

    if (nextValue !== rawValue || !hadRaw) {
      adjustments.push({
        key,
        fromFallback: !hadRaw,
        fromType: Array.isArray(rawValue) ? "array" : typeof rawValue,
        toType: Array.isArray(nextValue) ? "array" : typeof nextValue,
      });
    }
  }

  return {
    input: normalized,
    adjustments,
  };
}

function parseApifyInputFieldError(errorText: string) {
  const normalized = String(errorText ?? "");
  const numericBoundMatch = normalized.match(
    /Field input\.([a-zA-Z0-9_.]+)\s+must be\s*(>=|<=|>|<)\s*([0-9]+(?:\.[0-9]+)?)/i
  );
  if (numericBoundMatch) {
    const fieldPath = String(numericBoundMatch[1] ?? "").trim();
    const key = fieldPath.split(".")[0]?.trim() ?? "";
    if (!key) return null;
    const operator = String(numericBoundMatch[2] ?? "").trim();
    const value = Number(numericBoundMatch[3] ?? "");
    return {
      key,
      fieldPath,
      predicate: "numeric_bound",
      expectedType: "number",
      boundOperator: operator,
      boundValue: Number.isFinite(value) ? value : undefined,
    };
  }

  const fieldMatch = normalized.match(
    /Field input\.([a-zA-Z0-9_.]+)\s+(must be|is required|required)(?:\s+([a-zA-Z_]+))?/i
  );
  if (fieldMatch) {
    const fieldPath = String(fieldMatch[1] ?? "").trim();
    const predicate = String(fieldMatch[2] ?? "").trim().toLowerCase();
    const expectedType = String(fieldMatch[3] ?? "").trim().toLowerCase();
    const key = fieldPath.split(".")[0]?.trim() ?? "";
    if (!key) return null;
    return { key, fieldPath, predicate, expectedType };
  }

  const notAllowedMatch = normalized.match(/Property input\.([a-zA-Z0-9_.]+)\s+is not allowed/i);
  if (notAllowedMatch) {
    const fieldPath = String(notAllowedMatch[1] ?? "").trim();
    const key = fieldPath.split(".")[0]?.trim() ?? "";
    if (!key) return null;
    return {
      key,
      fieldPath,
      predicate: "not_allowed",
      expectedType: "",
    };
  }

  return null;
}

function coerceValueToExpectedType(input: { value: unknown; expectedType: string; key: string }) {
  const type = input.expectedType.toLowerCase();
  if (type === "string") return firstString(input.value);
  if (type === "array") return toStringArray(input.value);
  if (type === "number") {
    const value = Number(firstString(input.value));
    return Number.isFinite(value) ? value : undefined;
  }
  if (type === "integer") {
    const value = Number(firstString(input.value));
    return Number.isFinite(value) ? Math.round(value) : undefined;
  }
  if (type === "boolean") {
    return ["1", "true", "yes", "on"].includes(firstString(input.value).toLowerCase());
  }
  if (type === "object") {
    if (input.value && typeof input.value === "object" && !Array.isArray(input.value)) return input.value;
    const str = firstString(input.value);
    if (!str) return undefined;
    if (input.key.toLowerCase().includes("url")) return { url: str };
    return { value: str };
  }
  return input.value;
}

function repairActorInputFromProviderError(input: {
  actorInput: Record<string, unknown>;
  errorText: string;
  stage: LeadChainStepStage;
}) {
  const parsed = parseApifyInputFieldError(input.errorText);
  if (!parsed) return { repaired: false, actorInput: input.actorInput, reason: "unparsed_error" };

  const next = { ...input.actorInput };
  if (parsed.predicate === "not_allowed") {
    if (!Object.prototype.hasOwnProperty.call(next, parsed.key)) {
      return { repaired: false, actorInput: input.actorInput, reason: `not_allowed_missing_key:${parsed.key}` };
    }
    delete next[parsed.key];
    return { repaired: true, actorInput: next, reason: `removed_not_allowed:${parsed.key}` };
  }

  const currentValue = next[parsed.key];
  const fallbackValue = fallbackValueForSchemaKey({
    key: parsed.key,
    actorInput: input.actorInput,
    stage: input.stage,
  });
  const sourceValue = currentValue ?? fallbackValue;

  if (parsed.predicate.includes("required")) {
    if (sourceValue === undefined || sourceValue === null || (typeof sourceValue === "string" && !sourceValue.trim())) {
      return { repaired: false, actorInput: input.actorInput, reason: `missing_required:${parsed.key}` };
    }
    if (Array.isArray(sourceValue) && !sourceValue.length) {
      return { repaired: false, actorInput: input.actorInput, reason: `missing_required:${parsed.key}` };
    }
    let requiredValue: unknown = sourceValue;
    if (parsed.expectedType) {
      const coerced = coerceValueToExpectedType({
        value: sourceValue,
        expectedType: parsed.expectedType,
        key: parsed.key,
      });
      if (coerced !== undefined && coerced !== null && (!(typeof coerced === "string") || coerced.trim())) {
        requiredValue = coerced;
      }
    } else if (Array.isArray(sourceValue) && !/s$/i.test(parsed.key)) {
      const first = firstString(sourceValue);
      if (!first) {
        return { repaired: false, actorInput: input.actorInput, reason: `required_no_scalar:${parsed.key}` };
      }
      requiredValue = first;
    }

    next[parsed.key] = requiredValue;
    return { repaired: true, actorInput: next, reason: `filled_required:${parsed.key}` };
  }

  if (parsed.predicate.includes("must be")) {
    const coerced = coerceValueToExpectedType({
      value: sourceValue,
      expectedType: parsed.expectedType,
      key: parsed.key,
    });
    if (coerced === undefined || coerced === null) {
      return {
        repaired: false,
        actorInput: input.actorInput,
        reason: `coercion_failed:${parsed.key}:${parsed.expectedType || "unknown"}`,
      };
    }
    if (typeof coerced === "string" && !coerced.trim()) {
      return {
        repaired: false,
        actorInput: input.actorInput,
        reason: `coercion_empty_string:${parsed.key}`,
      };
    }
    if (Array.isArray(coerced) && !coerced.length) {
      return {
        repaired: false,
        actorInput: input.actorInput,
        reason: `coercion_empty_array:${parsed.key}`,
      };
    }
    next[parsed.key] = coerced;
    return {
      repaired: true,
      actorInput: next,
      reason: `coerced:${parsed.key}:${parsed.expectedType || "unknown"}`,
    };
  }

  if (parsed.predicate === "numeric_bound") {
    const sourceValue = next[parsed.key] ?? fallbackValueForSchemaKey({
      key: parsed.key,
      actorInput: input.actorInput,
      stage: input.stage,
    });
    let numeric = Number(firstString(sourceValue));
    const bound = Number((parsed as { boundValue?: number }).boundValue);
    if (!Number.isFinite(numeric)) numeric = Number.isFinite(bound) ? bound : 1;
    const operator = String((parsed as { boundOperator?: string }).boundOperator ?? "");
    if (Number.isFinite(bound)) {
      if (operator === ">=") numeric = Math.max(numeric, bound);
      if (operator === ">") numeric = Math.max(numeric, bound + 1);
      if (operator === "<=") numeric = Math.min(numeric, bound);
      if (operator === "<") numeric = Math.min(numeric, bound - 1);
    }
    if (!Number.isFinite(numeric)) {
      return {
        repaired: false,
        actorInput: input.actorInput,
        reason: `numeric_bound_coercion_failed:${parsed.key}`,
      };
    }
    next[parsed.key] = numeric;
    return {
      repaired: true,
      actorInput: next,
      reason: `coerced_numeric_bound:${parsed.key}:${operator}${Number.isFinite(bound) ? bound : ""}`,
    };
  }

  return { repaired: false, actorInput: input.actorInput, reason: "unsupported_predicate" };
}

function isApifyQuotaExceededErrorText(text: unknown) {
  const normalized = String(text ?? "").toLowerCase();
  return (
    normalized.includes("platform-feature-disabled") ||
    normalized.includes("monthly usage hard limit exceeded") ||
    normalized.includes("usage hard limit exceeded")
  );
}

function hashProbeInput(input: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function summarizeTopReasons(rejected: LeadAcceptanceDecision[], max = 5) {
  const counts = new Map<string, number>();
  for (const row of rejected) {
    const key = row.reason || "rejected";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([reason, count]) => ({ reason, count }));
}

function looksLikeActorInputCompatibilityError(text: unknown) {
  const normalized = String(text ?? "").toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("field input.") ||
    normalized.includes("property input.") ||
    normalized.includes("required property") ||
    normalized.includes("is required") ||
    normalized.includes("must be") ||
    normalized.includes("invalid input") ||
    normalized.includes("input validation") ||
    normalized.includes("not allowed")
  );
}

function buildProbeMemoryUpdates(candidates: ProbedSourcingPlan[]) {
  const bucket = new Map<
    string,
    { actorId: string; successDelta: number; failDelta: number; compatibilityFailDelta: number; qualitySamples: number[] }
  >();

  for (const candidate of candidates) {
    const denominator = candidate.acceptedCount + candidate.rejectedCount;
    const candidateQuality = denominator > 0 ? candidate.acceptedCount / denominator : 0;
    for (const probe of candidate.probeResults) {
      const actorId = probe.actorId;
      if (!actorId) continue;
      const current =
        bucket.get(actorId.toLowerCase()) ??
        {
          actorId,
          successDelta: 0,
          failDelta: 0,
          compatibilityFailDelta: 0,
          qualitySamples: [],
        };
      if (probe.outcome === "pass") current.successDelta += 1;
      else current.failDelta += 1;

      const reasonBlob = JSON.stringify({
        candidateReason: candidate.reason,
        probeDetails: probe.details ?? {},
      }).toLowerCase();
      if (
        reasonBlob.includes("incompatible_actor_input") ||
        reasonBlob.includes("missing required input keys") ||
        looksLikeActorInputCompatibilityError(reasonBlob)
      ) {
        current.compatibilityFailDelta += 1;
      }
      if (probe.stage === "email_discovery" && probe.outcome === "pass" && denominator > 0) {
        current.qualitySamples.push(candidateQuality);
      }
      bucket.set(actorId.toLowerCase(), current);
    }
  }

  return Array.from(bucket.values()).map((row) => ({
    actorId: row.actorId,
    successDelta: row.successDelta,
    failDelta: row.failDelta,
    compatibilityFailDelta: row.compatibilityFailDelta,
    qualitySample:
      row.qualitySamples.length > 0
        ? row.qualitySamples.reduce((sum, value) => sum + value, 0) / row.qualitySamples.length
        : 0,
  }));
}

function isLikelyB2BOutreachContext(input: {
  brandWebsite: string;
  targetAudience: string;
  offer: string;
  experimentName: string;
}) {
  const blob = [
    input.brandWebsite,
    input.targetAudience,
    input.offer,
    input.experimentName,
  ]
    .join(" ")
    .toLowerCase();
  if (!blob) return false;
  const b2bSignals = [
    "b2b",
    "sdr",
    "revops",
    "revenue",
    "pipeline",
    "demo",
    "booked meeting",
    "book meeting",
    "vp ",
    "director",
    "head of",
    "founder",
    "ceo",
    "cro",
    "cmo",
    "buyer",
    "account executive",
    "sales leader",
    "software company",
    "saas",
    "enterprise",
    "mid-market",
    "abm",
    "gtm",
    "outbound",
    "inbound signup",
    ".io",
    ".ai",
    ".com",
  ];
  return b2bSignals.some((signal) => blob.includes(signal));
}

const AUDIENCE_COMPANY_KEYWORD_STOPWORDS = new Set([
  "at",
  "for",
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "with",
  "without",
  "who",
  "that",
  "which",
  "their",
  "company",
  "companies",
  "team",
  "teams",
  "employee",
  "employees",
  "people",
  "running",
  "run",
  "using",
  "focused",
  "focus",
  "active",
  "actively",
  "virtual",
  "event",
  "events",
  "webinar",
  "webinars",
  "upcoming",
  "manager",
  "managers",
  "director",
  "directors",
  "head",
  "vp",
  "lead",
  "specialist",
]);

function deriveTargetCompanyKeywords(...parts: Array<string | undefined>) {
  const text = parts
    .map((value) => normalizeText(value ?? ""))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!text) return [] as string[];

  const source = text.includes(" at ")
    ? normalizeText(text.split(/\bat\b/i).slice(1).join(" at "))
    : text;
  const tokens = source
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\w\s/-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .filter((token) => !AUDIENCE_COMPANY_KEYWORD_STOPWORDS.has(token))
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => token.length >= 3 || token === "b2b")
    .filter((token) => !/^\d+[kmb]?(-\d+[kmb]?)?$/.test(token));

  return uniqueTrimmed(tokens, 8);
}

function deriveExplicitAudienceExclusions(...parts: Array<string | undefined>) {
  const text = parts
    .map((value) => normalizeText(value ?? ""))
    .filter(Boolean)
    .join(" ");
  if (!text) return [] as string[];

  const exclusions: string[] = [];
  const patterns = [
    /\bexcluding\s+([^.;:]+)/gi,
    /\bexclude\s+([^.;:]+)/gi,
    /\bexcept\s+([^.;:]+)/gi,
    /\bavoid\s+([^.;:]+)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = normalizeText(match[1] ?? "")
        .toLowerCase()
        .replace(/[()]/g, " ");
      if (!raw) continue;
      for (const part of raw.split(/,|\/|\bor\b|\band\b/)) {
        const value = normalizeText(part)
          .toLowerCase()
          .replace(/[^\w\s-]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (!value || value.split(" ").length > 4) continue;
        exclusions.push(value);
      }
    }
  }

  return uniqueTrimmed(exclusions, 12);
}

async function generateAdaptiveLeadQualityPolicy(input: {
  brandName: string;
  brandWebsite: string;
  targetAudience: string;
  offer: string;
  experimentName: string;
}): Promise<LeadQualityPolicy> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing for adaptive lead quality policy");
  }

  const prompt = [
    "Generate a strict B2B lead quality policy for outbound outreach.",
    "Optimize for quality over quantity, but keep policy feasible for real-world actor outputs.",
    "Return JSON only.",
    "Policy fields:",
    "- allowFreeDomains (boolean)",
    "- allowRoleInboxes (boolean)",
    "- requirePersonName (boolean)",
    "- requireCompany (boolean)",
    "- requireTitle (boolean)",
    "- requiredTitleKeywords (string[])",
    "- requiredCompanyKeywords (string[])",
    "- excludedCompanyKeywords (string[])",
    "- minConfidenceScore (number 0..1)",
    "Rules:",
    "- default to rejecting low-signal generic emails when unsure.",
    "- if targetAudience references a specific role/persona (e.g. manager/director/head/vp/chief), requireTitle should be true and requiredTitleKeywords should capture that role intent.",
    "- requiredCompanyKeywords should only be used when explicitly supported by targetAudience or offer; otherwise return [].",
    "- excludedCompanyKeywords should only contain exclusions explicitly stated or directly implied by the original targetAudience/offer context. Do not invent sector exclusions.",
    "- minConfidenceScore should usually be between 0.52 and 0.68.",
    `Context: ${JSON.stringify(input)}`,
  ].join("\n");

  const model = resolveLlmModel("lead_quality_policy", { prompt });
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
      max_output_tokens: 900,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Lead quality policy generation failed: HTTP ${response.status} ${raw.slice(0, 240)}`);
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  const parsed = parseLooseJsonObject(extractOutputText(payload));

  const row = asRecord(parsed);
  const likelyB2B = isLikelyB2BOutreachContext({
    brandWebsite: input.brandWebsite,
    targetAudience: input.targetAudience,
    offer: input.offer,
    experimentName: input.experimentName,
  });
  const requestedAllowFreeDomains = Boolean(row.allowFreeDomains ?? false);
  const requestedAllowRoleInboxes = Boolean(row.allowRoleInboxes ?? false);
  const requestedRequirePersonName = Boolean(row.requirePersonName ?? true);
  const requestedRequireCompany = Boolean(row.requireCompany ?? true);
  const requestedRequireTitle = Boolean(row.requireTitle ?? false);
  const requestedMinConfidence = Number(row.minConfidenceScore ?? 0.6) || 0.6;
  const requestedTitleKeywords = Array.isArray(row.requiredTitleKeywords)
    ? row.requiredTitleKeywords.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  const requestedCompanyKeywords = Array.isArray(row.requiredCompanyKeywords)
    ? row.requiredCompanyKeywords.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  const requestedExcludedCompanyKeywords = Array.isArray(row.excludedCompanyKeywords)
    ? row.excludedCompanyKeywords.map((item) => normalizeText(item)).filter(Boolean)
    : [];

  const rolePersonaCue = /\b(manager|director|head|vp|chief|owner|founder|lead|specialist)\b/i.test(
    input.targetAudience
  );
  const audienceBeforeAt = normalizeText(input.targetAudience.split(/\bat\b/i)[0] ?? "");
  const fallbackRoleHint = audienceBeforeAt
    .replace(/\b(manager|director|head|vp|chief|owner|founder|lead|specialist)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const fallbackRoleTokens = fallbackRoleHint.split(" ").filter(Boolean);
  const fallbackRolePhrase =
    fallbackRoleTokens.length > 4
      ? fallbackRoleTokens.slice(0, 3).join(" ")
      : fallbackRoleHint;
  const fallbackTitleKeywords = fallbackRolePhrase ? [trimText(fallbackRolePhrase, 32)] : [];
  const requiredTitleKeywords = Array.from(
    new Set([...(requestedTitleKeywords.length ? requestedTitleKeywords : fallbackTitleKeywords)].map((item) => item.toLowerCase()))
  ).slice(0, 6);

  const minFloor = likelyB2B ? 0.58 : 0.5;
  const maxCap = likelyB2B ? 0.78 : 0.68;
  const defaultConfidence = likelyB2B ? 0.62 : 0.6;
  const normalizedCompanyKeywords = Array.from(
    new Set(
      [
        ...requestedCompanyKeywords.map((item) => item.toLowerCase()),
        ...deriveTargetCompanyKeywords(input.targetAudience),
      ].filter(Boolean)
    )
  ).slice(0, 8);
  const companyKeywordPolicy = normalizedCompanyKeywords;
  const explicitExcludedKeywords = Array.from(
    new Set(
      [
        ...requestedExcludedCompanyKeywords.map((item) => item.toLowerCase()),
        ...deriveExplicitAudienceExclusions(input.targetAudience, input.offer, input.experimentName),
      ].filter(Boolean)
    )
  ).slice(0, 16);

  const policy: LeadQualityPolicy = {
    allowFreeDomains: likelyB2B ? false : requestedAllowFreeDomains,
    allowRoleInboxes: likelyB2B ? false : requestedAllowRoleInboxes,
    requirePersonName: likelyB2B ? true : requestedRequirePersonName,
    requireCompany: likelyB2B ? true : requestedRequireCompany,
    requireTitle: likelyB2B ? rolePersonaCue || requestedRequireTitle || requiredTitleKeywords.length > 0 : requestedRequireTitle,
    requiredTitleKeywords: requiredTitleKeywords.slice(0, 4),
    requiredCompanyKeywords: companyKeywordPolicy,
    excludedCompanyKeywords: explicitExcludedKeywords,
    minConfidenceScore: Math.max(minFloor, Math.min(maxCap, requestedMinConfidence || defaultConfidence)),
  };
  return policy;
}

function buildFallbackLeadQualityPolicy(input: {
  brandWebsite: string;
  targetAudience: string;
  offer: string;
  experimentName: string;
}): LeadQualityPolicy {
  const likelyB2B = isLikelyB2BOutreachContext({
    brandWebsite: input.brandWebsite,
    targetAudience: input.targetAudience,
    offer: input.offer,
    experimentName: input.experimentName,
  });
  const rolePersonaCue = /\b(manager|director|head|vp|chief|owner|founder|lead|specialist)\b/i.test(
    input.targetAudience
  );
  const audienceBeforeAt = normalizeText(input.targetAudience.split(/\bat\b/i)[0] ?? "");
  const roleHint = audienceBeforeAt
    .replace(/\b(manager|director|head|vp|chief|owner|founder|lead|specialist)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const roleTokens = roleHint.split(" ").filter(Boolean);
  const rolePhrase = roleTokens.length > 4 ? roleTokens.slice(0, 3).join(" ") : roleHint;
  const requiredTitleKeywords = rolePhrase ? [trimText(rolePhrase, 32)] : [];

  return {
    allowFreeDomains: false,
    allowRoleInboxes: false,
    requirePersonName: true,
    requireCompany: true,
    requireTitle: rolePersonaCue || requiredTitleKeywords.length > 0,
    requiredTitleKeywords: requiredTitleKeywords.slice(0, 4),
    requiredCompanyKeywords: deriveTargetCompanyKeywords(input.targetAudience),
    excludedCompanyKeywords: deriveExplicitAudienceExclusions(
      input.targetAudience,
      input.offer,
      input.experimentName
    ),
    minConfidenceScore: likelyB2B ? 0.62 : 0.58,
  };
}

function normalizeSourcingChainSteps(steps: LeadSourcingChainStep[]): SourcingChainStep[] {
  return steps.map((step) => ({
    id: step.id,
    stage: step.stage,
    actorId: step.actorId,
    purpose: step.purpose,
    queryHint: step.queryHint,
  }));
}

async function selectBestProbedChain(input: {
  targetAudience: string;
  offer: string;
  candidates: ProbedSourcingPlan[];
}): Promise<{ selectedPlanId: string; rationale: string }> {
  const viable = input.candidates.filter((row) => row.acceptedCount > 0 && row.reason === "");
  if (!viable.length) {
    throw new Error("No viable probed chain candidates with accepted leads");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const fallback = viable
      .slice()
      .sort((a, b) => {
        const aRatio = a.acceptedCount + a.rejectedCount > 0 ? a.acceptedCount / (a.acceptedCount + a.rejectedCount) : 0;
        const bRatio = b.acceptedCount + b.rejectedCount > 0 ? b.acceptedCount / (b.acceptedCount + b.rejectedCount) : 0;
        return b.acceptedCount - a.acceptedCount || bRatio - aRatio || b.score - a.score;
      })[0];
    return {
      selectedPlanId: fallback.plan.id,
      rationale: `Deterministic selection (OPENAI_API_KEY missing): accepted=${fallback.acceptedCount}, rejected=${fallback.rejectedCount}, score=${fallback.score}`,
    };
  }

  const prompt = [
    "Choose the best lead-sourcing chain candidate for launch.",
    "Optimize for lead quality first, then deliverability safety, then volume.",
    "Return strict JSON only: { selectedPlanId: string, rationale: string }",
    `Context: ${JSON.stringify({
      targetAudience: input.targetAudience,
      offer: input.offer,
      candidates: viable.map((row) => ({
        planId: row.plan.id,
        strategy: row.plan.strategy,
        rationale: row.plan.rationale,
        steps: row.plan.steps,
        acceptedCount: row.acceptedCount,
        rejectedCount: row.rejectedCount,
        score: row.score,
        reason: row.reason,
      })),
    })}`,
  ].join("\n");

  const model = resolveLlmModel("lead_chain_selection", { prompt });
  const deterministic = viable
    .slice()
    .sort((a, b) => {
      const aRatio = a.acceptedCount + a.rejectedCount > 0 ? a.acceptedCount / (a.acceptedCount + a.rejectedCount) : 0;
      const bRatio = b.acceptedCount + b.rejectedCount > 0 ? b.acceptedCount / (b.acceptedCount + b.rejectedCount) : 0;
      return b.acceptedCount - a.acceptedCount || bRatio - aRatio || b.score - a.score;
    })[0];

  let lastSelectionError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: attempt === 0 ? prompt : `${prompt}\nRetry: previous attempt failed. Return strict JSON only.`,
        text: { format: { type: "json_object" } },
        max_output_tokens: 800,
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      lastSelectionError = `HTTP ${response.status} ${raw.slice(0, 220)}`;
      continue;
    }
    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    try {
      const parsed = parseLooseJsonObject(extractOutputText(payload));
      const row = asRecord(parsed);
      const selectedPlanId = String(row.selectedPlanId ?? "").trim();
      const rationale = trimText(row.rationale, 400);
      if (!selectedPlanId) {
        lastSelectionError = "empty_selected_plan_id";
        continue;
      }
      if (!viable.some((candidate) => candidate.plan.id === selectedPlanId)) {
        lastSelectionError = "unknown_selected_plan_id";
        continue;
      }
      return { selectedPlanId, rationale };
    } catch (error) {
      lastSelectionError = error instanceof Error ? error.message : "invalid_selection_json";
    }
  }

  return {
    selectedPlanId: deterministic.plan.id,
    rationale: `Deterministic selection after selector failure (${trimText(lastSelectionError, 180)}): accepted=${deterministic.acceptedCount}, rejected=${deterministic.rejectedCount}, score=${deterministic.score}`,
  };
}

async function fetchActorProfiles(
  actorIds: string[],
  token: string
): Promise<Map<string, ActorCapabilityProfile>> {
  const uniqueActorIds = uniqueTrimmed(actorIds, 300);
  if (!uniqueActorIds.length) return new Map();

  const rows: ActorCapabilityProfile[] = [];
  for (const actorId of uniqueActorIds) {
    const detail = await fetchApifyActorSchemaProfile({ actorId, token });
    if (!detail.ok || !detail.profile) continue;
    const profile: ActorCapabilityProfile = {
      actorId: detail.profile.actorId,
      stageHints: [],
      schemaSummary: {
        requiredKeys: detail.profile.requiredKeys,
        knownKeys: detail.profile.knownKeys,
      },
      compatibilityScore: 0,
      lastSeenMetadata: {
        title: detail.profile.title,
        description: detail.profile.description,
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    rows.push(profile);
  }

  if (rows.length) {
    await upsertSourcingActorProfiles(rows);
  }
  return new Map(rows.map((row) => [row.actorId, row]));
}

type ActorSchemaProfileCache = Map<string, Awaited<ReturnType<typeof fetchApifyActorSchemaProfile>>>;

async function getActorSchemaProfileCached(input: {
  cache: ActorSchemaProfileCache;
  actorId: string;
  token: string;
}) {
  const key = input.actorId.toLowerCase();
  const existing = input.cache.get(key);
  if (existing) return existing;
  const fetched = await fetchApifyActorSchemaProfile({ actorId: input.actorId, token: input.token });
  input.cache.set(key, fetched);
  return fetched;
}

function rankActorPoolWithMemory(input: {
  actors: ApifyStoreActor[];
  memoryRows: Awaited<ReturnType<typeof getSourcingActorMemory>>;
}) {
  const memoryById = new Map(input.memoryRows.map((row) => [row.actorId.toLowerCase(), row]));
  const blockedByCompatibility: string[] = [];
  const blockedHardFailure: string[] = [];
  const softSuppressedLowQuality: string[] = [];
  const eligible: ApifyStoreActor[] = [];
  const fallbackLowQuality: ApifyStoreActor[] = [];

  for (const actor of input.actors) {
    const memory = memoryById.get(actor.actorId.toLowerCase());
    if (!memory) {
      eligible.push(actor);
      continue;
    }
    const compatibilityBlocked = memory.compatibilityFailCount >= 2 && memory.successCount === 0;
    const hardFailing = memory.failCount >= 3 && memory.successCount === 0;
    const veryLowQuality = memory.avgQuality <= 0.05 && memory.leadsAccepted === 0 && memory.failCount >= 2;
    if (compatibilityBlocked) {
      blockedByCompatibility.push(actor.actorId);
      continue;
    }
    if (hardFailing) {
      blockedHardFailure.push(actor.actorId);
      continue;
    }
    if (veryLowQuality) {
      softSuppressedLowQuality.push(actor.actorId);
      fallbackLowQuality.push(actor);
      continue;
    }
    eligible.push(actor);
  }

  const rankingPool = eligible.length ? eligible : fallbackLowQuality;
  const rankedActors = [...rankingPool].sort((a, b) => {
    const scoreA = actorScore(a);
    const scoreB = actorScore(b);
    const memoryA = memoryById.get(a.actorId.toLowerCase());
    const memoryB = memoryById.get(b.actorId.toLowerCase());
    const adjustedA =
      scoreA +
      (memoryA
        ? memoryA.successCount * 5 +
          memoryA.avgQuality * 30 -
          memoryA.failCount * 8 -
          memoryA.compatibilityFailCount * 12
        : 0);
    const adjustedB =
      scoreB +
      (memoryB
        ? memoryB.successCount * 5 +
          memoryB.avgQuality * 30 -
          memoryB.failCount * 8 -
          memoryB.compatibilityFailCount * 12
        : 0);
    return adjustedB - adjustedA;
  });

  return {
    rankedActors,
    diagnostics: {
      discoveredCount: input.actors.length,
      eligibleCount: eligible.length,
      fallbackLowQualityCount: fallbackLowQuality.length,
      blockedByCompatibility,
      blockedHardFailure,
      softSuppressedLowQuality,
    },
  };
}

type ProbeIcpAlignmentAssessment = {
  pass: boolean;
  threshold: number;
  finalScore: number;
  deterministicScore: number;
  llmScore: number;
  llmVerdict: "strong_match" | "partial_match" | "mismatch" | "not_evaluated";
  rationale: string;
  sampleSize: number;
  titleMatchRate: number;
  companyKeywordMatchRate: number;
  excludedKeywordHitRate: number;
};

function deterministicProbeIcpAlignment(input: {
  leads: ApifyLead[];
  qualityPolicy: LeadQualityPolicy;
}) {
  const sample = input.leads.slice(0, PROBE_ICP_ALIGNMENT_SAMPLE_SIZE);
  if (!sample.length) {
    return {
      score: 0,
      sampleSize: 0,
      titleMatchRate: 0,
      companyKeywordMatchRate: 0,
      excludedKeywordHitRate: 0,
    };
  }

  const requiredTitleKeywords = Array.isArray(input.qualityPolicy.requiredTitleKeywords)
    ? input.qualityPolicy.requiredTitleKeywords.map((value) => normalizeText(String(value ?? "")).toLowerCase()).filter(Boolean)
    : [];
  const requiredCompanyKeywords = Array.isArray(input.qualityPolicy.requiredCompanyKeywords)
    ? input.qualityPolicy.requiredCompanyKeywords.map((value) => normalizeText(String(value ?? "")).toLowerCase()).filter(Boolean)
    : [];
  const excludedCompanyKeywords = Array.isArray(input.qualityPolicy.excludedCompanyKeywords)
    ? input.qualityPolicy.excludedCompanyKeywords.map((value) => normalizeText(String(value ?? "")).toLowerCase()).filter(Boolean)
    : [];

  let titleMatches = 0;
  let companyMatches = 0;
  let excludedHits = 0;
  for (const lead of sample) {
    const title = normalizeText(lead.title ?? "").toLowerCase();
    const companyContext = normalizeText(`${lead.company ?? ""} ${lead.domain ?? ""}`).toLowerCase();
    const titleOk = requiredTitleKeywords.length
      ? requiredTitleKeywords.some((keyword) => title.includes(keyword))
      : input.qualityPolicy.requireTitle
        ? Boolean(title)
        : true;
    if (titleOk) titleMatches += 1;

    const companyOk = requiredCompanyKeywords.length
      ? requiredCompanyKeywords.some((keyword) => companyContext.includes(keyword))
      : true;
    if (companyOk) companyMatches += 1;

    const excludedHit = excludedCompanyKeywords.some((keyword) => companyContext.includes(keyword));
    if (excludedHit) excludedHits += 1;
  }

  const sampleSize = sample.length;
  const titleMatchRate = titleMatches / sampleSize;
  const companyKeywordMatchRate = companyMatches / sampleSize;
  const excludedKeywordHitRate = excludedHits / sampleSize;
  const score = clampConfidenceValue(
    titleMatchRate * 0.45 + companyKeywordMatchRate * 0.35 + (1 - excludedKeywordHitRate) * 0.2,
    0
  );

  return {
    score,
    sampleSize,
    titleMatchRate,
    companyKeywordMatchRate,
    excludedKeywordHitRate,
  };
}

async function assessProbeIcpAlignment(input: {
  targetAudience: string;
  triggerContext: string;
  offer: string;
  step: LeadSourcingChainStep;
  leads: ApifyLead[];
  qualityPolicy: LeadQualityPolicy;
}): Promise<ProbeIcpAlignmentAssessment> {
  const deterministic = deterministicProbeIcpAlignment({
    leads: input.leads,
    qualityPolicy: input.qualityPolicy,
  });
  const threshold = input.qualityPolicy.requireTitle
    ? Math.max(PROBE_ICP_ALIGNMENT_MIN_SCORE, 0.58)
    : PROBE_ICP_ALIGNMENT_MIN_SCORE;
  if (!deterministic.sampleSize) {
    return {
      pass: false,
      threshold,
      finalScore: 0,
      deterministicScore: 0,
      llmScore: 0,
      llmVerdict: "not_evaluated",
      rationale: "No probe leads available for ICP relevance assessment.",
      sampleSize: 0,
      titleMatchRate: 0,
      companyKeywordMatchRate: 0,
      excludedKeywordHitRate: 0,
    };
  }

  const sampleLeads = input.leads.slice(0, PROBE_ICP_ALIGNMENT_SAMPLE_SIZE).map((lead) => ({
    name: trimText(lead.name, 80),
    title: trimText(lead.title, 120),
    company: trimText(lead.company, 120),
    domain: trimText(lead.domain, 120),
    email: trimText(lead.email, 140),
  }));

  let llmScore = deterministic.score;
  let llmVerdict: ProbeIcpAlignmentAssessment["llmVerdict"] = "not_evaluated";
  let llmRationale = "";
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    const prompt = [
      "Score whether these probe leads match the intended outreach ICP.",
      "Return strict JSON only: { score: number, verdict: \"strong_match\"|\"partial_match\"|\"mismatch\", rationale: string }",
      "Rules:",
      "- score must be between 0 and 1",
      "- strong_match means clearly aligned to ICP",
      "- partial_match means mixed quality",
      "- mismatch means mostly wrong audience/industry/role",
      `Context: ${JSON.stringify({
        targetAudience: input.targetAudience,
        triggerContext: input.triggerContext,
        offer: input.offer,
        stage: input.step.stage,
        actorId: input.step.actorId,
        queryHint: input.step.queryHint,
        qualityPolicy: input.qualityPolicy,
        leads: sampleLeads,
      })}`,
    ].join("\n");

    try {
      const model = resolveLlmModel("lead_chain_selection", { prompt });
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
          max_output_tokens: 500,
        }),
      });
      const raw = await response.text();
      if (response.ok) {
        const payload: unknown = JSON.parse(raw);
        const parsed = parseLooseJsonObject(extractOutputText(payload));
        const row = asRecord(parsed);
        llmScore = clampConfidenceValue(row.score, deterministic.score);
        const verdictRaw = String(row.verdict ?? "").trim().toLowerCase();
        if (verdictRaw === "strong_match" || verdictRaw === "partial_match" || verdictRaw === "mismatch") {
          llmVerdict = verdictRaw;
        } else {
          llmVerdict = llmScore >= 0.72 ? "strong_match" : llmScore >= 0.5 ? "partial_match" : "mismatch";
        }
        llmRationale = trimText(row.rationale, 240);
      } else {
        llmRationale = `llm_probe_icp_eval_failed:${response.status}`;
      }
    } catch (error) {
      llmRationale = `llm_probe_icp_eval_failed:${error instanceof Error ? trimText(error.message, 120) : "unknown"}`;
    }
  }

  const finalScore = clampConfidenceValue(deterministic.score * 0.6 + llmScore * 0.4, deterministic.score);
  const pass = finalScore >= threshold && llmVerdict !== "mismatch";
  const rationale = pass
    ? llmRationale || "Probe leads align with ICP constraints."
    : llmRationale || "Probe leads do not align strongly enough with ICP constraints.";

  return {
    pass,
    threshold,
    finalScore,
    deterministicScore: deterministic.score,
    llmScore,
    llmVerdict,
    rationale,
    sampleSize: deterministic.sampleSize,
    titleMatchRate: deterministic.titleMatchRate,
    companyKeywordMatchRate: deterministic.companyKeywordMatchRate,
    excludedKeywordHitRate: deterministic.excludedKeywordHitRate,
  };
}

async function probeSourcingPlanCandidate(input: {
  plan: LeadSourcingChainPlan;
  targetAudience: string;
  triggerContext?: string;
  offer?: string;
  token: string;
  qualityPolicy: LeadQualityPolicy;
  allowMissingEmail?: boolean;
  remainingBudgetUsd: number;
  actorSchemaCache: ActorSchemaProfileCache;
  contractsByActorId: Map<string, ActorSemanticContract>;
  initialChainData?: LeadSourcingChainData;
}): Promise<ProbedSourcingPlan> {
  let budgetUsedUsd = 0;
  let chainData: LeadSourcingChainData = input.initialChainData
    ? {
        queries: [...input.initialChainData.queries],
        companies: [...input.initialChainData.companies],
        websites: [...input.initialChainData.websites],
        domains: [...input.initialChainData.domains],
        profileUrls: [...input.initialChainData.profileUrls],
        emails: [...input.initialChainData.emails],
        phones: [...input.initialChainData.phones],
      }
    : buildInitialChainData({
        targetAudience: input.targetAudience,
        triggerContext: input.triggerContext ?? "",
        offer: input.offer ?? "",
      });
  const acceptedLeads: ApifyLead[] = [];
  const rejectedLeads: LeadAcceptanceDecision[] = [];
  const probeResults: ProbedSourcingPlan["probeResults"] = [];
  let reason = "";

  for (let stepIndex = 0; stepIndex < input.plan.steps.length; stepIndex += 1) {
    const step = input.plan.steps[stepIndex];
    if (budgetUsedUsd + APIFY_PROBE_STEP_COST_ESTIMATE_USD > input.remainingBudgetUsd) {
      reason = "probe_budget_exhausted";
      probeResults.push({
        stepIndex,
        actorId: step.actorId,
        stage: step.stage,
        outcome: "fail",
        probeInputHash: "",
        qualityMetrics: {},
        costEstimateUsd: 0,
        details: { reason },
      });
      break;
    }

    const actorInput = buildChainStepInput({
      step,
      chainData,
      targetAudience: input.targetAudience,
      maxLeads: APIFY_PROBE_MAX_LEADS,
      probeMode: true,
    });
    const initialProbeInputHash = hashProbeInput(actorInput);

    const profile = await getActorSchemaProfileCached({
      cache: input.actorSchemaCache,
      actorId: step.actorId,
      token: input.token,
    });
    if (!profile.ok || !profile.profile) {
      reason = `actor_profile_unavailable:${step.actorId}`;
      probeResults.push({
        stepIndex,
        actorId: step.actorId,
        stage: step.stage,
        outcome: "fail",
        probeInputHash: initialProbeInputHash,
        qualityMetrics: {},
        costEstimateUsd: 0,
        details: { reason, error: profile.error },
      });
      break;
    }

    const normalizedInput = normalizeActorInputForSchema({
      actorProfile: profile.profile,
      actorInput,
      stage: step.stage,
    });
    let probeInputHash = hashProbeInput(normalizedInput.input);

    const compatibility = evaluateActorCompatibility({
      actorProfile: profile.profile,
      actorInput: normalizedInput.input,
      stage: step.stage,
    });
    if (!compatibility.ok) {
      reason = `incompatible_actor_input:${step.actorId}`;
      probeResults.push({
        stepIndex,
        actorId: step.actorId,
        stage: step.stage,
        outcome: "fail",
        probeInputHash,
        qualityMetrics: { compatibilityScore: compatibility.score },
        costEstimateUsd: 0,
        details: {
          reason: compatibility.reason,
          missingRequired: compatibility.missingRequired,
          normalizedInputAdjustments: normalizedInput.adjustments,
        },
      });
      break;
    }

    let actorInputForRun = { ...normalizedInput.input };
    let repairReason = "";
    let run = await runApifyActorSyncGetDatasetItems({
      actorId: step.actorId,
      actorInput: actorInputForRun,
      token: input.token,
      timeoutSeconds: 35,
    });
    for (let repairAttempt = 0; repairAttempt < 8 && !run.ok; repairAttempt += 1) {
      const repaired = repairActorInputFromProviderError({
        actorInput: actorInputForRun,
        errorText: run.error,
        stage: step.stage,
      });
      if (!repaired.repaired) break;

      const beforeHash = hashProbeInput(actorInputForRun);
      const afterHash = hashProbeInput(repaired.actorInput);
      if (beforeHash === afterHash) break;

      actorInputForRun = repaired.actorInput;
      probeInputHash = hashProbeInput(actorInputForRun);
      repairReason = repairReason ? `${repairReason};${repaired.reason}` : repaired.reason;
      run = await runApifyActorSyncGetDatasetItems({
        actorId: step.actorId,
        actorInput: actorInputForRun,
        token: input.token,
        timeoutSeconds: 35,
      });
    }
    budgetUsedUsd += APIFY_PROBE_STEP_COST_ESTIMATE_USD;
    if (!run.ok) {
      reason = `probe_run_failed:${step.actorId}`;
      probeResults.push({
        stepIndex,
        actorId: step.actorId,
        stage: step.stage,
        outcome: "fail",
        probeInputHash,
        qualityMetrics: { compatibilityScore: compatibility.score },
        costEstimateUsd: APIFY_PROBE_STEP_COST_ESTIMATE_USD,
        details: {
          reason,
          error: run.error,
          normalizedInputAdjustments: normalizedInput.adjustments,
          repairReason,
        },
      });
      break;
    }

    chainData = mergeChainData(chainData, run.rows);
    const qualityMetrics: Record<string, unknown> = {
      rowCount: run.rows.length,
      compatibilityScore: compatibility.score,
        signals: {
          queries: chainData.queries.length,
          companies: chainData.companies.length,
          websites: chainData.websites.length,
          domains: chainData.domains.length,
          profileUrls: chainData.profileUrls.length,
          emails: chainData.emails.length,
          phones: chainData.phones.length,
        },
      };

    if (stepIndex === input.plan.steps.length - 1) {
      const leads = leadsFromApifyRows(run.rows, APIFY_PROBE_MAX_LEADS);
      for (const lead of leads) {
        const decision = evaluateLeadAgainstQualityPolicy({
          lead,
          policy: input.qualityPolicy,
          allowMissingEmail: input.allowMissingEmail === true,
        });
        if (decision.accepted) {
          acceptedLeads.push(lead);
        } else {
          rejectedLeads.push(decision);
        }
      }
      qualityMetrics.acceptedLeads = acceptedLeads.length;
      qualityMetrics.rejectedLeads = rejectedLeads.length;
      qualityMetrics.topRejections = summarizeTopReasons(rejectedLeads, 4);
      const icpAlignment = await assessProbeIcpAlignment({
        targetAudience: input.targetAudience,
        triggerContext: input.triggerContext ?? "",
        offer: input.offer ?? "",
        step,
        leads: acceptedLeads.length ? acceptedLeads : leads,
        qualityPolicy: input.qualityPolicy,
      });
      qualityMetrics.icpAlignment = {
        pass: icpAlignment.pass,
        threshold: icpAlignment.threshold,
        finalScore: icpAlignment.finalScore,
        deterministicScore: icpAlignment.deterministicScore,
        llmScore: icpAlignment.llmScore,
        llmVerdict: icpAlignment.llmVerdict,
        rationale: icpAlignment.rationale,
        sampleSize: icpAlignment.sampleSize,
        titleMatchRate: icpAlignment.titleMatchRate,
        companyKeywordMatchRate: icpAlignment.companyKeywordMatchRate,
        excludedKeywordHitRate: icpAlignment.excludedKeywordHitRate,
      };
      if (!acceptedLeads.length) {
        reason = "probe_no_accepted_leads";
      } else if (!icpAlignment.pass) {
        reason = `probe_icp_mismatch:${step.actorId}`;
      }
    } else {
      const nextStep = input.plan.steps[stepIndex + 1];
      const nextContract = input.contractsByActorId.get(nextStep.actorId);
      const requiredNextSignals = new Set<SemanticSignal>(nextContract?.requiredInputs ?? []);
      if (nextContract?.requiresAuth) requiredNextSignals.add("auth_token");
      if (nextContract?.requiresFileInput) requiredNextSignals.add("file_upload");
      const availableSignals = availableSignalsFromChainData(chainData);
      const unresolvedSignals = Array.from(requiredNextSignals).filter((signal) => !availableSignals.has(signal));
      qualityMetrics.availableSignalsAfterStep = Array.from(availableSignals);
      qualityMetrics.nextStepRequiredSignals = Array.from(requiredNextSignals);
      if (requiredNextSignals.size > 0 && unresolvedSignals.length > 0) {
        reason = `probe_missing_next_step_inputs:${nextStep.actorId}`;
        probeResults.push({
          stepIndex: stepIndex + 1,
          actorId: nextStep.actorId,
          stage: nextStep.stage,
          outcome: "fail",
          probeInputHash: "",
          qualityMetrics: {
            availableSignals: Array.from(availableSignals),
            requiredSignals: Array.from(requiredNextSignals),
          },
          costEstimateUsd: 0,
          details: {
            reason,
            missingRequiredSignals: unresolvedSignals,
            blockingStepActorId: step.actorId,
          },
        });
      }
    }

    const stepOutcome =
      reason && (!reason.startsWith("probe_missing_next_step_inputs:") || stepIndex === input.plan.steps.length - 1)
        ? "fail"
        : "pass";
    probeResults.push({
      stepIndex,
      actorId: step.actorId,
      stage: step.stage,
      outcome: stepOutcome,
      probeInputHash,
      qualityMetrics,
      costEstimateUsd: APIFY_PROBE_STEP_COST_ESTIMATE_USD,
      details: {
        stage: step.stage,
        rowCount: run.rows.length,
        normalizedInputAdjustments: normalizedInput.adjustments,
        repairReason,
      },
    });

    if (reason) break;
  }

  const acceptedRatio =
    acceptedLeads.length + rejectedLeads.length > 0
      ? acceptedLeads.length / (acceptedLeads.length + rejectedLeads.length)
      : 0;
  const score = Number(
    (
      acceptedLeads.length * 4 +
      acceptedRatio * 35 +
      Math.max(0, 12 - budgetUsedUsd * 10) -
      (reason ? 14 : 0)
    ).toFixed(4)
  );

  return {
    plan: input.plan,
    probeResults,
    acceptedLeads,
    rejectedLeads,
    acceptedCount: acceptedLeads.length,
    rejectedCount: rejectedLeads.length,
    score,
    budgetUsedUsd,
    reason,
  };
}

async function executeSourcingPlan(input: {
  plan: LeadSourcingChainPlan;
  targetAudience: string;
  triggerContext?: string;
  offer?: string;
  token: string;
  maxLeads: number;
  qualityPolicy: LeadQualityPolicy;
  allowMissingEmail?: boolean;
  actorSchemaCache: ActorSchemaProfileCache;
  initialChainData?: LeadSourcingChainData;
}): Promise<{
  ok: boolean;
  reason: string;
  leads: ApifyLead[];
  rejectedLeads: LeadAcceptanceDecision[];
  stepDiagnostics: Array<Record<string, unknown>>;
  lastActorInputError: string;
}> {
  let chainData: LeadSourcingChainData = input.initialChainData
    ? {
        queries: [...input.initialChainData.queries],
        companies: [...input.initialChainData.companies],
        websites: [...input.initialChainData.websites],
        domains: [...input.initialChainData.domains],
        profileUrls: [...input.initialChainData.profileUrls],
        emails: [...input.initialChainData.emails],
        phones: [...input.initialChainData.phones],
      }
    : buildInitialChainData({
        targetAudience: input.targetAudience,
        triggerContext: input.triggerContext ?? "",
        offer: input.offer ?? "",
      });
  const stepDiagnostics: Array<Record<string, unknown>> = [];
  let lastActorInputError = "";

  for (let stepIndex = 0; stepIndex < input.plan.steps.length; stepIndex += 1) {
    const step = input.plan.steps[stepIndex];
    const actorInput = buildChainStepInput({
      step,
      chainData,
      targetAudience: input.targetAudience,
      maxLeads: input.maxLeads,
    });

    const profile = await getActorSchemaProfileCached({
      cache: input.actorSchemaCache,
      actorId: step.actorId,
      token: input.token,
    });
    if (!profile.ok || !profile.profile) {
      lastActorInputError = profile.error || "actor_profile_unavailable";
      stepDiagnostics.push({
        stepIndex,
        stage: step.stage,
        actorId: step.actorId,
        ok: false,
        reason: "actor_profile_unavailable",
        error: profile.error,
      });
      return {
        ok: false,
        reason: `Actor profile unavailable for ${step.actorId}`,
        leads: [],
        rejectedLeads: [],
        stepDiagnostics,
        lastActorInputError,
      };
    }

    const normalizedInput = normalizeActorInputForSchema({
      actorProfile: profile.profile,
      actorInput,
      stage: step.stage,
    });

    const compatibility = evaluateActorCompatibility({
      actorProfile: profile.profile,
      actorInput: normalizedInput.input,
      stage: step.stage,
    });
    if (!compatibility.ok) {
      lastActorInputError = compatibility.reason;
      stepDiagnostics.push({
        stepIndex,
        stage: step.stage,
        actorId: step.actorId,
        ok: false,
        reason: "actor_input_incompatible",
        missingRequired: compatibility.missingRequired,
        normalizedInputAdjustments: normalizedInput.adjustments,
      });
      return {
        ok: false,
        reason: `Actor input incompatible for ${step.actorId}: ${compatibility.reason}`,
        leads: [],
        rejectedLeads: [],
        stepDiagnostics,
        lastActorInputError,
      };
    }

    const run = await startApifyActorRun({
      token: input.token,
      actorId: step.actorId,
      actorInput: normalizedInput.input,
      maxTotalChargeUsd: APIFY_CHAIN_EXEC_MAX_CHARGE_USD,
    });
    let runResult = run;
    let repairReason = "";
    let actorInputForRun = normalizedInput.input;
    for (let repairAttempt = 0; repairAttempt < 8 && (!runResult.ok || !runResult.runId); repairAttempt += 1) {
      const repaired = repairActorInputFromProviderError({
        actorInput: actorInputForRun,
        errorText: runResult.error,
        stage: step.stage,
      });
      if (!repaired.repaired) break;

      if (JSON.stringify(repaired.actorInput) === JSON.stringify(actorInputForRun)) break;
      actorInputForRun = repaired.actorInput;
      repairReason = repairReason ? `${repairReason};${repaired.reason}` : repaired.reason;
      runResult = await startApifyActorRun({
        token: input.token,
        actorId: step.actorId,
        actorInput: actorInputForRun,
        maxTotalChargeUsd: APIFY_CHAIN_EXEC_MAX_CHARGE_USD,
      });
    }
    if (!runResult.ok || !runResult.runId) {
      lastActorInputError = runResult.error;
      stepDiagnostics.push({
        stepIndex,
        stage: step.stage,
        actorId: step.actorId,
        ok: false,
        reason: "actor_run_start_failed",
        error: runResult.error,
        normalizedInputAdjustments: normalizedInput.adjustments,
        repairReason,
      });
      return {
        ok: false,
        reason: `Failed to start actor ${step.actorId}: ${runResult.error}`,
        leads: [],
        rejectedLeads: [],
        stepDiagnostics,
        lastActorInputError,
      };
    }

    let pollStatus = "ready";
    let datasetId = runResult.datasetId;
    for (let pollAttempt = 0; pollAttempt < 30; pollAttempt += 1) {
      const poll = await pollApifyActorRun({
        token: input.token,
        runId: runResult.runId,
      });
      if (!poll.ok) {
        lastActorInputError = poll.error;
        stepDiagnostics.push({
          stepIndex,
          stage: step.stage,
        actorId: step.actorId,
        ok: false,
        reason: "actor_poll_failed",
        error: poll.error,
        normalizedInputAdjustments: normalizedInput.adjustments,
      });
        return {
          ok: false,
          reason: `Actor ${step.actorId} failed while polling: ${poll.error}`,
          leads: [],
          rejectedLeads: [],
          stepDiagnostics,
          lastActorInputError,
        };
      }
      pollStatus = poll.status;
      datasetId = poll.datasetId || datasetId;
      if (poll.status === "succeeded") break;
      if (poll.status === "ready" || poll.status === "running") {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
    }

    if (pollStatus !== "succeeded") {
      return {
        ok: false,
        reason: `Actor ${step.actorId} did not finish successfully`,
        leads: [],
        rejectedLeads: [],
        stepDiagnostics,
        lastActorInputError,
      };
    }
    if (!datasetId) {
      return {
        ok: false,
        reason: `Actor ${step.actorId} completed without dataset`,
        leads: [],
        rejectedLeads: [],
        stepDiagnostics,
        lastActorInputError,
      };
    }

    const fetched = await fetchApifyActorDatasetItems({
      token: input.token,
      datasetId,
      limit: Math.max(20, Math.min(APIFY_CHAIN_MAX_ITEMS_PER_STEP, input.maxLeads)),
    });
    if (!fetched.ok) {
      lastActorInputError = fetched.error;
      stepDiagnostics.push({
        stepIndex,
        stage: step.stage,
        actorId: step.actorId,
        ok: false,
        reason: "dataset_fetch_failed",
        error: fetched.error,
        normalizedInputAdjustments: normalizedInput.adjustments,
      });
      return {
        ok: false,
        reason: `Dataset fetch failed for ${step.actorId}: ${fetched.error}`,
        leads: [],
        rejectedLeads: [],
        stepDiagnostics,
        lastActorInputError,
      };
    }

    chainData = mergeChainData(chainData, fetched.rows);
    stepDiagnostics.push({
      stepIndex,
      stage: step.stage,
      actorId: step.actorId,
      ok: true,
      rowCount: fetched.rows.length,
      normalizedInputAdjustments: normalizedInput.adjustments,
      signals: {
        queries: chainData.queries.length,
        companies: chainData.companies.length,
        websites: chainData.websites.length,
        domains: chainData.domains.length,
        profileUrls: chainData.profileUrls.length,
        emails: chainData.emails.length,
        phones: chainData.phones.length,
      },
    });

    if (stepIndex === input.plan.steps.length - 1) {
      const rawLeads = leadsFromApifyRows(fetched.rows, input.maxLeads);
      const accepted: ApifyLead[] = [];
      const rejected: LeadAcceptanceDecision[] = [];
      for (const lead of rawLeads) {
        const decision = evaluateLeadAgainstQualityPolicy({
          lead,
          policy: input.qualityPolicy,
          allowMissingEmail: input.allowMissingEmail === true,
        });
        if (decision.accepted) accepted.push(lead);
        else rejected.push(decision);
      }

      if (!accepted.length) {
        return {
          ok: false,
          reason: "No leads passed adaptive quality policy",
          leads: [],
          rejectedLeads: rejected,
          stepDiagnostics,
          lastActorInputError,
        };
      }

      return {
        ok: true,
        reason: "",
        leads: accepted,
        rejectedLeads: rejected,
        stepDiagnostics,
        lastActorInputError,
      };
    }
  }

  return {
    ok: false,
    reason: "Sourcing chain returned no final lead-producing step",
    leads: [],
    rejectedLeads: [],
    stepDiagnostics,
    lastActorInputError,
  };
}

function supportsDelivery(account: ResolvedAccount) {
  return account.accountType !== "mailbox";
}

function supportsMailbox(account: ResolvedAccount) {
  return account.accountType !== "delivery";
}

function supportsAutomaticInboxSync(account: ResolvedAccount) {
  return (
    supportsMailbox(account) &&
    account.status === "active" &&
    account.config.mailbox.status === "connected" &&
    Boolean(account.config.mailbox.email.trim()) &&
    Boolean(account.config.mailbox.host.trim())
  );
}

function isDedicatedDeliverabilityMonitor(account: ResolvedAccount) {
  const label = account.name.trim().toLowerCase();
  return label.startsWith("deliverability ");
}

function preflightReason(input: {
  deliveryAccount: ResolvedAccount;
  deliverySecrets: ResolvedSecrets;
  mailboxAccount: ResolvedAccount;
  mailboxSecrets: ResolvedSecrets;
  targetAudience: string;
  hasPlatformExaKey: boolean;
}) {
  if (!supportsDelivery(input.deliveryAccount)) {
    return "Assigned delivery account does not support outreach sending";
  }
  if (!input.targetAudience.trim()) {
    return "Target Audience is required for lead sourcing";
  }
  if (!input.hasPlatformExaKey) {
    return "Platform lead sourcing is not configured (EXA_API_KEY missing)";
  }
  if (
    !supportsCustomerIoDelivery(input.deliveryAccount) &&
    !supportsMailpoolDelivery(input.deliveryAccount, input.deliverySecrets)
  ) {
    return "Delivery account is missing provider credentials";
  }
  if (input.deliveryAccount.provider === "customerio" && !effectiveCustomerIoApiKey(input.deliverySecrets)) {
    return "Customer.io API key missing";
  }
  if (!getOutreachAccountFromEmail(input.deliveryAccount).trim()) {
    return `${input.deliveryAccount.provider === "mailpool" ? "Mailpool" : "Customer.io"} From Email is required`;
  }
  const senderBackingIssue = getOutreachSenderBackingIssue(
    input.deliveryAccount,
    input.mailboxAccount
  );
  if (senderBackingIssue) {
    return senderBackingIssue;
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
  hasPlatformExaKey: boolean;
}) {
  const sourceConfig = effectiveSourceConfig(input.hypothesis);

  const debug = {
    reason: input.reason,
    hypothesisId: input.hypothesis.id,
    hypothesisHasLeadSourceOverride: Boolean(input.hypothesis.sourceConfig?.actorId?.trim()),
    hasResolvedLeadSource: Boolean(sourceConfig.actorId),
    hasPlatformExaKey: input.hasPlatformExaKey,
  } as const;

  if (input.reason === "Platform lead sourcing is not configured (EXA_API_KEY missing)") {
    return {
      hint: "Platform lead sourcing is not configured in this deployment. Set EXA_API_KEY in project environment variables.",
      debug,
    };
  }
  return { hint: "", debug };
}

function extractMailboxDisplayName(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const angle = raw.match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
  const candidate = angle ? angle[1] : raw.includes("@") ? "" : raw;
  return candidate.replace(/^"+|"+$/g, "").replace(/\s+/g, " ").trim();
}

function looksHumanDisplayName(value: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return false;
  if (normalized.includes("@")) return false;
  if (!/[a-z]/i.test(normalized)) return false;
  if (/\b(mailer-daemon|postmaster|auto(?:matic)? reply|out of office|vacation|no[- ]?reply)\b/i.test(normalized)) {
    return false;
  }
  if (/[0-9]{3,}/.test(normalized)) return false;
  return true;
}

function inferFallbackNameFromEmail(email: string) {
  const local = extractFirstEmailAddress(email).split("@")[0] ?? "";
  if (!local) return "";
  const compact = local.replace(/[._+-]/g, "");
  if (!compact || /\d{3,}/.test(compact)) return "";
  if (/^(info|hello|hi|team|support|contact|sales|admin|billing|ops|operations|noreply|noreply)$/.test(compact)) {
    return "";
  }
  return local
    .split(/[._+-]+/)
    .map((token) => token.trim())
    .filter((token) => token && !/\d{3,}/.test(token))
    .slice(0, 2)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function resolveReplyLeadName(input: { leadName: string; inboundFrom: string; leadEmail: string }) {
  const stored = normalizeText(String(input.leadName ?? ""));
  if (looksHumanDisplayName(stored)) return stored;
  const display = extractMailboxDisplayName(input.inboundFrom);
  if (looksHumanDisplayName(display)) return display;
  return inferFallbackNameFromEmail(input.leadEmail);
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
  if (!apiKey) {
    return fallback;
  }

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
    `Context JSON:\n${JSON.stringify({
      brandName: input.brandName,
      brandWebsite: input.brandWebsite,
      campaignName: input.campaignName,
      experimentName: input.experimentName,
      experimentOffer: input.experimentOffer,
      experimentAudience: input.experimentAudience,
      experimentNotes: input.experimentNotes,
      from: input.from,
      to: input.to,
      subject: input.subject,
      body: input.body,
      leadName: input.leadName,
      leadEmail: input.leadEmail,
      leadCompany: input.leadCompany,
    })}`,
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
    if (!response.ok) {
      return fallback;
    }
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

function timerEdgeWaitMinutes(graph: ConversationFlowGraph, edge: ConversationFlowEdge) {
  const explicitWait = Math.max(0, Number(edge.waitMinutes ?? 0) || 0);
  if (explicitWait > 0) return explicitWait;
  return normalizeReplyTimingPolicy(graph).minimumDelayMinutes;
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
      .find((edge) => elapsedMs >= timerEdgeWaitMinutes(input.graph, edge) * 60 * 1000) ?? null
  );
}

function replyTriggeredAutoSendWaitMinutes(
  graph: ConversationFlowGraph,
  node: ConversationFlowNode,
  edgeWaitMinutes: number
) {
  const nodeDelayMinutes = Math.max(0, Number(node.delayMinutes ?? 0) || 0);
  const currentEdgeWait = Math.max(0, Number(edgeWaitMinutes ?? 0) || 0);
  const currentTotal = nodeDelayMinutes + currentEdgeWait;
  if (!node.autoSend) {
    return currentEdgeWait;
  }
  const replyTiming = normalizeReplyTimingPolicy(graph);
  const randomizedTotal =
    Math.max(currentTotal, replyTiming.minimumDelayMinutes) +
    randomDelayMinutes(replyTiming.randomAdditionalDelayMinutes);
  return Math.max(currentEdgeWait, randomizedTotal - nodeDelayMinutes);
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

type ConversationThreadHistoryItem = {
  direction: "inbound" | "outbound";
  subject: string;
  body: string;
  at: string;
  nodeId?: string;
  messageId?: string;
};

async function buildConversationThreadHistory(input: {
  runId: string;
  leadId: string;
  leadEmail: string;
  sessionId: string;
  threadId?: string;
  runMessages?: Awaited<ReturnType<typeof listRunMessages>>;
  replyMessages?: Awaited<ReturnType<typeof listReplyMessagesByRun>>;
}): Promise<ConversationThreadHistoryItem[]> {
  const runMessages = input.runMessages ?? (await listRunMessages(input.runId));
  const replyMessages = input.replyMessages ?? (await listReplyMessagesByRun(input.runId));

  const outboundHistory = runMessages
    .filter(
      (message) =>
        message.leadId === input.leadId &&
        message.sessionId === input.sessionId &&
        message.sourceType === "conversation" &&
        (message.status === "sent" || message.status === "replied")
    )
    .map((message) => ({
      direction: "outbound" as const,
      subject: String(message.subject ?? "").trim(),
      body: String(message.body ?? "").trim(),
      at: String(message.sentAt || message.scheduledAt || message.createdAt || "").trim(),
      nodeId: String(message.nodeId ?? "").trim(),
      messageId: String(message.id ?? "").trim(),
    }));

  const leadEmailLower = input.leadEmail.trim().toLowerCase();
  const inboundHistory = replyMessages
    .filter((message) => {
      if (message.direction !== "inbound") return false;
      if (input.threadId) return message.threadId === input.threadId;
      return String(message.from ?? "").trim().toLowerCase() === leadEmailLower;
    })
    .map((message) => ({
      direction: "inbound" as const,
      subject: String(message.subject ?? "").trim(),
      body: String(message.body ?? "").trim(),
      at: String(message.receivedAt || message.createdAt || "").trim(),
      messageId: String(message.id ?? "").trim(),
    }));

  return [...outboundHistory, ...inboundHistory]
    .filter((row) => row.body || row.subject)
    .sort((a, b) => (toDate(a.at).getTime() > toDate(b.at).getTime() ? 1 : -1));
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
  threadHistory?: ConversationThreadHistoryItem[];
  maxDepth?: number;
  replyPolicy?: ConversationPromptRenderContext["replyPolicy"];
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
      history: Array.isArray(input.threadHistory)
        ? input.threadHistory
            .map((row) => ({
              direction: (row.direction === "inbound" ? "inbound" : "outbound") as
                | "inbound"
                | "outbound",
              subject: String(row.subject ?? "").trim(),
              body: String(row.body ?? "").trim(),
              at: String(row.at ?? "").trim(),
              nodeId: String(row.nodeId ?? "").trim(),
              messageId: String(row.messageId ?? "").trim(),
            }))
            .filter((row) => row.subject || row.body)
        : [],
    },
    safety: {
      maxDepth: Math.max(1, Math.min(12, Number(input.maxDepth ?? 5) || 5)),
      dailyCap: Math.max(1, Number(input.run.dailyCap || 30)),
      hourlyCap: Math.max(1, Number(input.run.hourlyCap || 6)),
      minSpacingMinutes: Math.max(1, Number(input.run.minSpacingMinutes || 8)),
      timezone: input.run.timezone || DEFAULT_TIMEZONE,
    },
    replyPolicy: input.replyPolicy,
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
  threadHistory?: ConversationThreadHistoryItem[];
  maxDepth?: number;
  replyPolicy?: ConversationPromptRenderContext["replyPolicy"];
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
      threadHistory: input.threadHistory,
      maxDepth: input.maxDepth,
      replyPolicy: input.replyPolicy,
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

function senderHealthDimensionLabel(dimension: SenderHealthDimension) {
  if (dimension === "transport") return "transport";
  if (dimension === "message") return "message";
  return dimension;
}

function describeSenderHealthIssues(issues: SenderHealthGateIssue[]) {
  return issues
    .map((issue) => `${senderHealthDimensionLabel(issue.dimension)} ${issue.status}`)
    .join(", ");
}

function buildSenderHealthLaunchFailure(input: {
  senderLabel: string;
  blockers: SenderHealthGateIssue[];
  pending: SenderHealthGateIssue[];
}) {
  if (input.blockers.length) {
    return `Sender launch blocked for ${input.senderLabel}: ${describeSenderHealthIssues(input.blockers)}.`;
  }
  if (input.pending.length) {
    return `Sender launch blocked for ${input.senderLabel}: sender health checks are still settling (${describeSenderHealthIssues(
      input.pending
    )}).`;
  }
  return `Sender launch blocked for ${input.senderLabel}.`;
}

function formatSenderHealthIssues(issues: SenderHealthGateIssue[]) {
  return issues.map((issue) => ({
    dimension: issue.dimension,
    status: issue.status,
    summary: issue.summary,
  }));
}

function summarizeSenderHealthPoolPause(input: {
  healthBlocked: SenderHealthGateSnapshot[];
  spamBlockedCount: number;
}) {
  if (input.healthBlocked.length && input.spamBlockedCount) {
    return {
      reason: "sender_pool_blocked",
      summary: "Auto-paused: every sender in the brand pool is currently blocked by sender health or spam risk.",
    };
  }
  if (input.healthBlocked.length) {
    const hasRisk = input.healthBlocked.some((entry) => entry.blockers.length > 0);
    return hasRisk
      ? {
          reason: "sender_health_gate",
          summary: "Auto-paused: every sender in the brand pool is currently blocked by sender health.",
        }
      : {
          reason: "sender_health_pending",
          summary: "Auto-paused: every sender in the brand pool is still settling sender health checks.",
        };
  }
  return {
    reason: "deliverability_sender_pool_guard",
    summary: "Auto-paused: every sender in the brand pool is currently flagged for spam risk.",
  };
}

async function resolveBrandSenderHealth(input: {
  brandId: string;
  accountId: string;
  fromEmail?: string;
  requireInfrastructureReady?: boolean;
  requireMessageReady?: boolean;
}) {
  const brand = await getBrandById(input.brandId);
  if (!brand) {
    return null;
  }
  const enrichedBrand = await enrichBrandWithSenderHealth(brand);
  const gate = evaluateSenderHealthGate({
    domains: enrichedBrand.domains,
    accountId: input.accountId,
    fromEmail: input.fromEmail,
    requireInfrastructureReady: input.requireInfrastructureReady,
    requireMessageReady: input.requireMessageReady,
  });
  return {
    brand: enrichedBrand,
    gate,
  };
}

function buildSenderRoutingSignals(input: {
  domains?: DomainRow[];
  scorecards?: SenderDeliverabilityScorecard[];
}) {
  const bySenderId = new Map<string, SenderRoutingSignals>();
  const domains = input.domains ?? [];
  const scorecards = input.scorecards ?? [];
  const scorecardBySenderId = new Map(
    scorecards
      .filter((scorecard) => scorecard.senderAccountId)
      .map((scorecard) => [scorecard.senderAccountId, scorecard] as const)
  );

  for (const row of domains) {
    if (row.role === "brand") continue;
    const accountId = getDomainDeliveryAccountId(row);
    if (!accountId) continue;
    const scorecard = scorecardBySenderId.get(accountId);
    bySenderId.set(accountId, {
      domainStatus: row.domainHealth ?? "unknown",
      emailStatus: row.emailHealth ?? "unknown",
      transportStatus: row.ipHealth ?? "unknown",
      messageStatus: row.messagingHealth ?? "unknown",
      automationStatus: row.automationStatus ?? "queued",
      automationSummary: row.automationSummary ?? "",
      senderAccountId: accountId,
      senderAccountName: getDomainDeliveryAccountName(row) || row.fromEmail || row.domain,
      domain: row.domain,
      fromEmail: row.fromEmail ?? "",
      inboxRate: scorecard?.inboxRate ?? 0,
      spamRate: scorecard?.spamRate ?? 0,
      checkedAt: scorecard?.checkedAt ?? row.lastHealthCheckAt ?? "",
    });
  }

  for (const scorecard of scorecards) {
    if (!scorecard.senderAccountId || bySenderId.has(scorecard.senderAccountId)) continue;
    bySenderId.set(scorecard.senderAccountId, {
      domainStatus: "unknown",
      emailStatus: "unknown",
      transportStatus: "unknown",
      messageStatus: "unknown",
      automationStatus: "queued",
      automationSummary: scorecard.summaryText,
      senderAccountId: scorecard.senderAccountId,
      senderAccountName: scorecard.senderAccountName,
      domain: scorecard.fromEmail.split("@")[1] ?? "",
      fromEmail: scorecard.fromEmail,
      inboxRate: scorecard.inboxRate,
      spamRate: scorecard.spamRate,
      checkedAt: scorecard.checkedAt,
    });
  }

  return bySenderId;
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

function calculateScheduledRunMessages(
  runId: string,
  messages: Awaited<ReturnType<typeof listRunMessages>>
) {
  return messages.filter((item) => item.runId === runId && ["scheduled", "sent"].includes(item.status)).length;
}

function buildLiveRunMetrics(input: {
  run: Pick<OutreachRun, "id" | "metrics">;
  messages: Awaited<ReturnType<typeof listRunMessages>>;
  threads: ReplyThread[];
  sourcedLeads?: number;
}) {
  const liveMetrics = calculateRunMetricsFromMessages(input.run.id, input.messages, input.threads);
  return {
    ...input.run.metrics,
    sourcedLeads: Math.max(input.run.metrics.sourcedLeads, input.sourcedLeads ?? input.run.metrics.sourcedLeads),
    scheduledMessages: Math.max(
      input.run.metrics.scheduledMessages,
      calculateScheduledRunMessages(input.run.id, input.messages)
    ),
    sentMessages: liveMetrics.sentMessages,
    bouncedMessages: liveMetrics.bouncedMessages,
    failedMessages: liveMetrics.failedMessages,
    replies: liveMetrics.replies,
    positiveReplies: liveMetrics.positiveReplies,
    negativeReplies: liveMetrics.negativeReplies,
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
  threadHistory?: ConversationThreadHistoryItem[];
  maxDepth?: number;
  waitMinutes?: number;
  businessWindow?: BusinessWindowPolicy;
  latestInboundSubject?: string;
  latestInboundBody?: string;
  replyPolicy?: ConversationPromptRenderContext["replyPolicy"];
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
    threadHistory: input.threadHistory,
    maxDepth: input.maxDepth,
    replyPolicy: input.replyPolicy,
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
  const scheduledAt = alignToBusinessWindow(
    addMinutes(nowIso(), totalDelay),
    input.run.timezone || DEFAULT_TIMEZONE,
    input.businessWindow ?? DEFAULT_BUSINESS_WINDOW
  );
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
      scheduledAt,
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
  const candidateAccountIds = Array.from(
    new Set([assignment?.accountId ?? "", ...(assignment?.accountIds ?? [])].map((value) => value.trim()).filter(Boolean))
  );
  if (!assignment || !candidateAccountIds.length) {
    return { ok: false, reason: "No outreach delivery account assigned to brand", accountId: "" };
  }

  let resolvedAccountId = "";
  let deliveryAccount: ResolvedAccount | null = null;
  for (const candidateAccountId of candidateAccountIds) {
    const candidate = await getOutreachAccount(candidateAccountId);
    if (candidate && candidate.status === "active") {
      resolvedAccountId = candidateAccountId;
      deliveryAccount = candidate;
      break;
    }
  }

  if (!deliveryAccount || !resolvedAccountId) {
    return {
      ok: false,
      reason: "Assigned outreach delivery account is missing or inactive",
      accountId: candidateAccountIds[0] ?? "",
    };
  }

  const deliverySecrets = await getOutreachAccountSecrets(deliveryAccount.id);
  if (!deliverySecrets) {
    return {
      ok: false,
      reason: "Assigned delivery account credentials are missing",
      accountId: resolvedAccountId,
    };
  }

  const mailboxAccountId = assignment.mailboxAccountId || resolvedAccountId;
  const mailboxAccount =
    mailboxAccountId === deliveryAccount.id
      ? deliveryAccount
      : await getOutreachAccount(mailboxAccountId);
  if (!mailboxAccount || mailboxAccount.status !== "active") {
    return {
      ok: false,
      reason: "Assigned mailbox account is missing or inactive",
      accountId: resolvedAccountId,
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
      accountId: resolvedAccountId,
    };
  }

  const senderBackingIssue = getOutreachSenderBackingIssue(deliveryAccount, mailboxAccount);
  if (senderBackingIssue) {
    return {
      ok: false,
      reason: senderBackingIssue,
      accountId: resolvedAccountId,
    };
  }

  return {
    ok: true,
    reason: "",
    accountId: resolvedAccountId,
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

async function resolveMailboxAccountForBrand(input: {
  brandId: string;
  preferredMailboxAccountId?: string;
}) {
  const assignment = await getBrandOutreachAssignment(input.brandId);
  const mailboxAccountId =
    input.preferredMailboxAccountId?.trim() ||
    assignment?.mailboxAccountId ||
    assignment?.accountId ||
    "";
  if (!mailboxAccountId) return null;
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
  sampleOnly?: boolean;
  maxLeadsOverride?: number;
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
  const runtimeExperiment = await getExperimentRecordByRuntimeRef(input.brandId, input.campaignId, experiment.id);
  const audienceContext = buildSourcingAudienceContext({
    runtimeAudience: runtimeExperiment?.audience ?? "",
    hypothesisAudience: hypothesis.actorQuery,
    experimentNotes: experiment.notes,
  });

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
    targetAudience: audienceContext.targetAudience,
    hasPlatformExaKey: Boolean(platformExaApiKey()),
  });
  if (reason) {
    const diagnostic = preflightDiagnostic({
      reason,
      hypothesis,
      hasPlatformExaKey: Boolean(platformExaApiKey()),
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
  const conversationPreflightReason = input.sampleOnly
    ? ""
    : !publishedFlowMap || !publishedFlowMap.publishedRevision
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

  const senderFromEmail = getOutreachAccountFromEmail(brandAccount.deliveryAccount).trim().toLowerCase();
  const requireReady = input.ownerType === "campaign";
  const senderHealthState = await resolveBrandSenderHealth({
    brandId: input.brandId,
    accountId: brandAccount.deliveryAccount.id,
    fromEmail: senderFromEmail,
    requireInfrastructureReady: requireReady,
    requireMessageReady: requireReady,
  });
  const senderHealthGate = senderHealthState?.gate ?? { row: null, blockers: [], pending: [] };
  if (senderHealthGate.blockers.length || senderHealthGate.pending.length) {
    const senderLabel =
      senderHealthGate.row?.fromEmail?.trim() ||
      senderFromEmail ||
      brandAccount.deliveryAccount.name.trim() ||
      "sender";
    const reason = buildSenderHealthLaunchFailure({
      senderLabel,
      blockers: senderHealthGate.blockers,
      pending: senderHealthGate.pending,
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
      payload: {
        trigger: input.trigger,
        outcome: "preflight_failed",
        reason,
        senderAccountId: brandAccount.deliveryAccount.id,
        fromEmail: senderLabel,
        blockers: formatSenderHealthIssues(senderHealthGate.blockers),
        pending: formatSenderHealthIssues(senderHealthGate.pending),
      },
    });
    return {
      ok: false,
      runId: failed.id,
      reason,
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
    payload: {
      sampleOnly: input.sampleOnly === true,
      maxLeadsOverride:
        input.maxLeadsOverride !== undefined
          ? Math.max(1, Math.min(500, Number(input.maxLeadsOverride) || 0))
          : undefined,
    },
  });
  await markExperimentExecutionStatus(input.brandId, input.campaignId, experiment.id, "queued");
  await createOutreachEvent({
    runId: run.id,
    eventType: "hypothesis_approved_auto_run_queued",
    payload: { trigger: input.trigger, sampleOnly: input.sampleOnly === true },
  });

  return { ok: true, runId: run.id, reason: "Run queued" };
}

export async function launchScaleCampaignRun(input: {
  brandId: string;
  scaleCampaignId: string;
  trigger?: "manual" | "auto_hopper";
}): Promise<{
  ok: boolean;
  runId: string;
  reason: string;
  hint?: string;
  debug?: Record<string, unknown>;
}> {
  const scaleCampaign = await getScaleCampaignRecordById(input.brandId, input.scaleCampaignId);
  if (!scaleCampaign) {
    return { ok: false, runId: "", reason: "campaign not found" };
  }

  const sourceExperiment = await getExperimentRecordById(input.brandId, scaleCampaign.sourceExperimentId);
  if (!sourceExperiment) {
    return { ok: false, runId: "", reason: "source experiment not found" };
  }

  const experiment = await ensureRuntimeForExperiment(sourceExperiment);
  if (!experiment.runtime.campaignId || !experiment.runtime.experimentId) {
    return { ok: false, runId: "", reason: "experiment runtime is not configured" };
  }

  if (scaleCampaign.scalePolicy.accountId) {
    await setBrandOutreachAssignment(input.brandId, {
      accountId: scaleCampaign.scalePolicy.accountId,
      mailboxAccountId:
        scaleCampaign.scalePolicy.mailboxAccountId || scaleCampaign.scalePolicy.accountId,
    });
  }

  const runtimeCampaign = await getCampaignById(input.brandId, experiment.runtime.campaignId);
  if (!runtimeCampaign) {
    return { ok: false, runId: "", reason: "runtime campaign not found" };
  }

  const runtimeVariant = runtimeCampaign.experiments.find(
    (item) => item.id === experiment.runtime.experimentId
  );
  if (!runtimeVariant) {
    return { ok: false, runId: "", reason: "runtime variant mapping is invalid" };
  }

  await updateCampaign(input.brandId, runtimeCampaign.id, {
    experiments: runtimeCampaign.experiments.map((variant) =>
      variant.id === runtimeVariant.id
        ? {
            ...variant,
            runPolicy: {
              ...variant.runPolicy,
              dailyCap: scaleCampaign.scalePolicy.dailyCap,
              hourlyCap: scaleCampaign.scalePolicy.hourlyCap,
              timezone: scaleCampaign.scalePolicy.timezone,
              minSpacingMinutes: scaleCampaign.scalePolicy.minSpacingMinutes,
            },
          }
        : variant
    ),
  });

  const result = await launchExperimentRun({
    brandId: input.brandId,
    campaignId: runtimeCampaign.id,
    experimentId: runtimeVariant.id,
    trigger: "manual",
    ownerType: "campaign",
    ownerId: scaleCampaign.id,
  });

  if (!result.ok) {
    return result;
  }

  await Promise.all([
    updateScaleCampaignRecord(input.brandId, scaleCampaign.id, { status: "active" }),
    updateExperimentRecord(input.brandId, experiment.id, { status: "promoted" }),
  ]);

  return result;
}

async function countOwnerSentUsage(input: {
  brandId: string;
  ownerType: "experiment" | "campaign";
  ownerId: string;
  timezone: string;
  currentRunId?: string;
  currentRunMessages?: Awaited<ReturnType<typeof listRunMessages>>;
}) {
  const ownerRuns = await listOwnerRuns(input.brandId, input.ownerType, input.ownerId);
  const recentRuns = ownerRuns.filter((run) => {
    if (isRunOpen(run.status)) return true;
    return Date.now() - toDate(run.createdAt).getTime() <= 3 * DAY_MS;
  });
  const messagesByRun = await Promise.all(
    recentRuns.map((run) =>
      run.id === input.currentRunId && input.currentRunMessages
        ? Promise.resolve(input.currentRunMessages)
        : listRunMessages(run.id)
    )
  );
  const allMessages = messagesByRun.flat();
  const sentMessages = allMessages.filter((message) => message.status === "sent" && Boolean(message.sentAt));
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const todayKey = timeZoneDateKey(new Date(), input.timezone || DEFAULT_TIMEZONE);
  const hourlySent = sentMessages.filter(
    (message) => message.sentAt && toDate(message.sentAt).getTime() >= oneHourAgo
  ).length;
  const dailySent = sentMessages.filter(
    (message) =>
      message.sentAt &&
      timeZoneDateKey(toDate(message.sentAt), input.timezone || DEFAULT_TIMEZONE) === todayKey
  ).length;

  return {
    ownerRuns,
    hourlySent,
    dailySent,
  };
}

async function countBrandSenderUsage(input: {
  brandId: string;
  timezone: string;
  currentRunId?: string;
  currentRunMessages?: Awaited<ReturnType<typeof listRunMessages>>;
}) {
  const brandRuns = await listBrandRuns(input.brandId);
  const recentRuns = brandRuns.filter((run) => {
    if (isRunOpen(run.status)) return true;
    return Date.now() - toDate(run.createdAt).getTime() <= 7 * DAY_MS;
  });
  const messagesByRun = await Promise.all(
    recentRuns.map(async (run) => ({
      run,
      messages:
        run.id === input.currentRunId && input.currentRunMessages
          ? input.currentRunMessages
          : await listRunMessages(run.id),
    }))
  );
  const usage: SenderUsageMap = {};
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const todayKey = timeZoneDateKey(new Date(), input.timezone || DEFAULT_TIMEZONE);

  for (const entry of messagesByRun) {
    for (const message of entry.messages) {
      if (message.status !== "sent" || !message.sentAt) continue;
      const senderAccountId =
        String(message.generationMeta?.senderAccountId ?? "").trim() || entry.run.accountId.trim();
      if (!senderAccountId) continue;
      const bucket = usage[senderAccountId] ?? { dailySent: 0, hourlySent: 0 };
      if (timeZoneDateKey(toDate(message.sentAt), input.timezone || DEFAULT_TIMEZONE) === todayKey) {
        bucket.dailySent += 1;
      }
      if (toDate(message.sentAt).getTime() >= oneHourAgo) {
        bucket.hourlySent += 1;
      }
      usage[senderAccountId] = bucket;
    }
  }

  return usage;
}

async function resolveSenderPoolForBrand(input: {
  brandId: string;
  preferredAccountId: string;
  timeZone: string;
  businessWindow: BusinessWindowPolicy;
}) {
  const assignment = await getBrandOutreachAssignment(input.brandId);
  const candidateAccountIds = Array.from(
    new Set(
      [input.preferredAccountId, assignment?.accountId ?? "", ...(assignment?.accountIds ?? [])]
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
  const now = new Date();
  const pool: SenderDispatchSlot[] = [];

  for (const accountId of candidateAccountIds) {
    const account = await getOutreachAccount(accountId);
    if (!account || account.status !== "active") continue;
    const fromEmail = getOutreachAccountFromEmail(account).trim();
    if (!fromEmail) continue;
    const secrets = await getOutreachAccountSecrets(account.id);
    if (!secrets) continue;
    pool.push({
      account,
      secrets,
      policy: senderWarmupPolicy({
        account,
        now,
        timeZone: input.timeZone,
        businessWindow: input.businessWindow,
      }),
    });
  }

  return {
    assignment,
    pool,
  };
}

function pickSenderForMessage(input: {
  pool: SenderDispatchSlot[];
  usage: SenderUsageMap;
  preferredAccountId: string;
  routingSignalsBySenderId?: Map<string, SenderRoutingSignals>;
}) {
  const ranked = input.pool
    .map((slot) => {
      const usage = input.usage[slot.account.id] ?? { dailySent: 0, hourlySent: 0 };
      const dailyRemaining = Math.max(0, slot.policy.dailyCap - usage.dailySent);
      const hourlyRemaining = Math.max(0, slot.policy.hourlyCap - usage.hourlySent);
      const availability = Math.min(dailyRemaining, hourlyRemaining);
      const dailyRatio = slot.policy.dailyCap > 0 ? usage.dailySent / slot.policy.dailyCap : 1;
      const hourlyRatio = slot.policy.hourlyCap > 0 ? usage.hourlySent / slot.policy.hourlyCap : 1;
      const routing =
        input.routingSignalsBySenderId?.get(slot.account.id) ?? {
          senderAccountId: slot.account.id,
          senderAccountName: slot.account.name,
          domain: getOutreachAccountFromEmail(slot.account).trim().split("@")[1] ?? "",
          fromEmail: getOutreachAccountFromEmail(slot.account).trim(),
          domainStatus: "unknown",
          emailStatus: "unknown",
          transportStatus: "unknown",
          messageStatus: "unknown",
          automationStatus: "queued",
          automationSummary: "",
          inboxRate: 0,
          spamRate: 0,
          checkedAt: "",
        };
      const { healthScore, routingScore: baseRoutingScore } = scoreSenderRoutingSignal(routing);
      const routingScore =
        baseRoutingScore +
        availability / Math.max(1, Math.min(slot.policy.dailyCap, slot.policy.hourlyCap)) +
        (routing.checkedAt ? 0.5 : 0);
      return {
        slot,
        usage,
        dailyRemaining,
        hourlyRemaining,
        availability,
        dailyRatio,
        hourlyRatio,
        routing,
        healthScore,
        routingScore,
      };
    })
    .filter((row) => row.availability > 0)
    .sort((left, right) => {
      if (left.routingScore !== right.routingScore) return right.routingScore - left.routingScore;
      if (left.dailyRatio !== right.dailyRatio) return left.dailyRatio - right.dailyRatio;
      if (left.hourlyRatio !== right.hourlyRatio) return left.hourlyRatio - right.hourlyRatio;
      if (left.healthScore !== right.healthScore) return right.healthScore - left.healthScore;
      if (left.usage.dailySent !== right.usage.dailySent) return left.usage.dailySent - right.usage.dailySent;
      if (left.slot.account.id === input.preferredAccountId) return -1;
      if (right.slot.account.id === input.preferredAccountId) return 1;
      return left.slot.account.name.localeCompare(right.slot.account.name);
    });

  return ranked[0] ?? null;
}

function deliverabilityPlacementScore(placement: MailboxPlacementVerdict) {
  if (placement === "inbox") return 1;
  if (placement === "all_mail_only") return 0.5;
  return 0;
}

async function listCampaignDeliverabilityEvents(input: { brandId: string; campaignId: string }) {
  const campaignRuns = await listCampaignRuns(input.brandId, input.campaignId);
  const recentRuns = campaignRuns.filter((run) => {
    if (isRunOpen(run.status)) return true;
    return Date.now() - toDate(run.createdAt).getTime() <= 14 * DAY_MS;
  });
  const eventRows = await Promise.all(recentRuns.map((run) => listRunEvents(run.id)));
  return eventRows.flat();
}

function generateDeliverabilityProbeToken() {
  return `probe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function listBlockedMonitorEmailsForSender(input: {
  brandId: string;
  senderAccountId: string;
  fromEmail: string;
}) {
  const reservations = await listDeliverabilitySeedReservations({
    brandId: input.brandId,
    senderAccountId: input.senderAccountId,
    fromEmail: input.fromEmail,
    statuses: ["reserved", "consumed"],
  });
  const senderAccountId = input.senderAccountId.trim();
  const fromEmail = input.fromEmail.trim().toLowerCase();
  const blocked = new Set<string>();
  for (const reservation of reservations) {
    const reservationSenderAccountId = reservation.senderAccountId.trim();
    const reservationFromEmail = reservation.fromEmail.trim().toLowerCase();
    const matchesSender =
      (senderAccountId && reservationSenderAccountId === senderAccountId) ||
      (fromEmail && reservationFromEmail === fromEmail);
    if (!matchesSender) continue;
    blocked.add(reservation.monitorEmail.trim().toLowerCase());
  }
  return blocked;
}

async function scoreSenderPoolDeliverability(input: {
  brandId: string;
  campaignId: string;
  pool: SenderDispatchSlot[];
}) {
  const [events, probeRuns] = await Promise.all([
    listCampaignDeliverabilityEvents({
      brandId: input.brandId,
      campaignId: input.campaignId,
    }),
    listDeliverabilityProbeRuns({
      brandId: input.brandId,
      campaignId: input.campaignId,
      statuses: ["completed"],
      limit: 200,
    }),
  ]);
  return buildSenderDeliverabilityScorecards({
    events,
    probeRuns,
    senderAccounts: input.pool.map((slot) => slot.account),
  });
}

async function maybeRefreshDeliverabilityIntelligence(run: {
  id: string;
  brandId: string;
  campaignId: string;
  experimentId: string;
}) {
  const [settings, secrets] = await Promise.all([
    getOutreachProvisioningSettings(),
    getOutreachProvisioningSettingsSecrets(),
  ]);
  const deliverabilitySettings = settings.deliverability;
  const provider = String(deliverabilitySettings?.provider ?? "none").trim();
  const monitoredDomains = Array.isArray(deliverabilitySettings?.monitoredDomains)
    ? deliverabilitySettings.monitoredDomains.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];

  if (provider !== "google_postmaster") return null;
  if (!monitoredDomains.length) return null;
  if (
    !secrets.deliverabilityGoogleClientId.trim() ||
    !secrets.deliverabilityGoogleClientSecret.trim() ||
    !secrets.deliverabilityGoogleRefreshToken.trim()
  ) {
    return null;
  }

  const lastChecked = String(deliverabilitySettings?.lastCheckedAt ?? "").trim();
  if (lastChecked) {
    const elapsed = Date.now() - toDate(lastChecked).getTime();
    if (elapsed < DELIVERABILITY_INTELLIGENCE_REFRESH_HOURS * 60 * 60 * 1000) {
      return null;
    }
  }

  try {
    const snapshot = await fetchGooglePostmasterHealth({
      clientId: secrets.deliverabilityGoogleClientId,
      clientSecret: secrets.deliverabilityGoogleClientSecret,
      refreshToken: secrets.deliverabilityGoogleRefreshToken,
      domains: monitoredDomains,
    });

    await updateOutreachProvisioningSettings({
      deliverability: {
        lastCheckedAt: snapshot.checkedAt,
        lastHealthStatus: snapshot.overallStatus,
        lastHealthScore: snapshot.overallScore,
        lastHealthSummary: snapshot.summary,
        lastDomainSnapshots: snapshot.domains,
      },
    });

    await createOutreachEvent({
      runId: run.id,
      eventType: "deliverability_intelligence_updated",
      payload: {
        provider: snapshot.provider,
        checkedAt: snapshot.checkedAt,
        overallStatus: snapshot.overallStatus,
        overallScore: snapshot.overallScore,
        summary: snapshot.summary,
        domains: snapshot.domains,
      },
    });

    return snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Deliverability intelligence refresh failed";
    await updateOutreachProvisioningSettings({
      deliverability: {
        lastCheckedAt: nowIso(),
        lastHealthStatus: "unknown",
        lastHealthSummary: message,
      },
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "deliverability_intelligence_failed",
      payload: {
        provider,
        error: message,
      },
    });
    return null;
  }
}

async function resolveDeliverabilityMonitorTargets(input: {
  runBrandId: string;
  excludeAccountIds: string[];
  excludeEmails: string[];
}): Promise<DeliverabilityMonitorTarget[]> {
  const [accounts, brands] = await Promise.all([listOutreachAccounts(), listBrands()]);
  const assignments = await Promise.all(
    brands.map(async (brand) => ({
      brandId: brand.id,
      assignment: await getBrandOutreachAssignment(brand.id),
    }))
  );
  const mailboxBrandByAccountId = new Map(
    assignments
      .filter((row) => row.assignment?.mailboxAccountId)
      .map((row) => [String(row.assignment?.mailboxAccountId ?? "").trim(), row.brandId] as const)
  );
  const excludedAccountIds = new Set(input.excludeAccountIds.map((value) => value.trim()).filter(Boolean));
  const excludedEmails = new Set(input.excludeEmails.map((value) => value.trim().toLowerCase()).filter(Boolean));

  const candidates: DeliverabilityMonitorTarget[] = [];
  for (const account of accounts) {
    if (account.status !== "active" || !supportsMailbox(account)) continue;
    const mailboxEmail = account.config.mailbox.email.trim().toLowerCase();
    if (!mailboxEmail || account.config.mailbox.status !== "connected") continue;
    if (excludedAccountIds.has(account.id) || excludedEmails.has(mailboxEmail)) continue;
    const secrets = await getOutreachAccountSecrets(account.id);
    if (!secrets || !secrets.mailboxPassword.trim()) continue;
    candidates.push({
      account,
      secrets,
      brandId: mailboxBrandByAccountId.get(account.id) ?? "",
    });
  }

  const dedicated = candidates.filter((candidate) => isDedicatedDeliverabilityMonitor(candidate.account));
  const pool = dedicated.length ? dedicated : candidates;

  return pool.sort((left, right) => {
    const leftDedicated = isDedicatedDeliverabilityMonitor(left.account) ? 0 : 1;
    const rightDedicated = isDedicatedDeliverabilityMonitor(right.account) ? 0 : 1;
    if (leftDedicated !== rightDedicated) return leftDedicated - rightDedicated;

    const leftCrossBrand = left.brandId && left.brandId !== input.runBrandId ? 0 : 1;
    const rightCrossBrand = right.brandId && right.brandId !== input.runBrandId ? 0 : 1;
    if (leftCrossBrand !== rightCrossBrand) return leftCrossBrand - rightCrossBrand;

    return left.account.name.localeCompare(right.account.name);
  });
}

function readDeliverabilityProbeTargets(value: unknown): DeliverabilityProbeTarget[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      reservationId: String(entry.reservationId ?? entry.reservation_id ?? "").trim() || undefined,
      accountId: String(entry.accountId ?? "").trim(),
      email: String(entry.email ?? "").trim().toLowerCase(),
      providerMessageId: String(entry.providerMessageId ?? entry.provider_message_id ?? "").trim() || undefined,
    }))
    .filter((entry) => entry.accountId && entry.email);
}

function readDeliverabilityProbeResults(value: unknown): DeliverabilityProbeMonitorResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      accountId: String(entry.accountId ?? "").trim(),
      email: String(entry.email ?? "").trim().toLowerCase(),
      placement:
        ["inbox", "spam", "all_mail_only", "not_found", "error"].includes(String(entry.placement ?? ""))
          ? (String(entry.placement ?? "") as MailboxPlacementVerdict)
          : "error",
      matchedMailbox: String(entry.matchedMailbox ?? "").trim(),
      matchedUid: Math.max(0, Number(entry.matchedUid ?? 0) || 0),
      ok: entry.ok !== false,
      error: String(entry.error ?? "").trim(),
    }))
    .filter((entry) => entry.accountId && entry.email);
}

function readDeliverabilityProbeVariant(value: unknown): DeliverabilityProbeVariant {
  return String(value ?? "").trim().toLowerCase() === "baseline" ? "baseline" : "production";
}

function hashDeliverabilityProbeContent(subject: string, body: string) {
  return createHash("sha256").update(subject).update("\n\n").update(body).digest("hex");
}

function senderDomainFromEmail(value: string) {
  return String(value ?? "").trim().toLowerCase().split("@")[1] ?? "";
}

function buildDeliverabilityBaselineProbe(input: {
  brandName: string;
  senderDomain: string;
  probeToken: string;
}) {
  const brandName = input.brandName.trim() || input.senderDomain.trim() || "sender";
  const subjectBase = `Quick note from ${brandName}`;
  const body = [
    "Hi there,",
    "",
    "This is a neutral deliverability control used to measure sender infrastructure before production content is judged.",
    "",
    "No reply is needed.",
  ].join("\n");
  return {
    subject: `${subjectBase} ${input.probeToken.slice(-6)}`.trim(),
    body,
    contentHash: hashDeliverabilityProbeContent(subjectBase, body),
  };
}

function buildDeliverabilityProbeReferenceMessage(
  message: OutreachMessage
): DeliverabilityProbeReferenceMessage {
  const generationMeta = asRecord(message.generationMeta);
  const subject = message.subject;
  const body = message.body;
  return {
    id: message.id,
    leadId: message.leadId,
    status: message.status,
    sourceType: message.sourceType,
    nodeId: message.nodeId.trim(),
    subject,
    body,
    contentHash: hashDeliverabilityProbeContent(subject, body),
    senderAccountId: String(generationMeta.senderAccountId ?? "").trim(),
    senderAccountName: String(generationMeta.senderAccountName ?? "").trim(),
    senderFromEmail: String(generationMeta.senderFromEmail ?? "").trim(),
  };
}

async function resolveDeliverabilityProbeReferenceMessage(input: {
  runId: string;
  sourceMessageId?: string;
  preferScheduled?: boolean;
}): Promise<DeliverabilityProbeReferenceMessage | null> {
  const sourceMessageId = String(input.sourceMessageId ?? "").trim();
  const messages = (await listRunMessages(input.runId)).filter(
    (message) => message.subject.trim() && message.body.trim()
  );
  if (!messages.length) return null;

  if (sourceMessageId) {
    const exact = messages.find((message) => message.id === sourceMessageId);
    return exact ? buildDeliverabilityProbeReferenceMessage(exact) : null;
  }

  const scheduled = [...messages]
    .filter((message) => message.status === "scheduled")
    .sort((left, right) => toDate(left.scheduledAt || left.createdAt).getTime() - toDate(right.scheduledAt || right.createdAt).getTime());
  const sent = [...messages]
    .filter((message) => message.status === "sent")
    .sort((left, right) => toDate(right.sentAt || right.updatedAt || right.createdAt).getTime() - toDate(left.sentAt || left.updatedAt || left.createdAt).getTime());

  const chosen =
    input.preferScheduled
      ? scheduled[0] ?? sent[0] ?? null
      : sent[0] ?? scheduled[0] ?? null;

  return chosen ? buildDeliverabilityProbeReferenceMessage(chosen) : null;
}

function summarizeDeliverabilityProbeResults(results: DeliverabilityProbeMonitorResult[]) {
  const counts = {
    inbox: 0,
    spam: 0,
    all_mail_only: 0,
    not_found: 0,
    error: 0,
  };
  for (const result of results) {
    counts[result.placement] += 1;
  }

  const total = results.length;
  const placement: MailboxPlacementVerdict =
    counts.spam > 0
      ? "spam"
      : counts.all_mail_only > 0
        ? "all_mail_only"
        : counts.not_found > 0
          ? "not_found"
          : counts.error > 0
            ? "error"
            : counts.inbox > 0
              ? "inbox"
              : "not_found";

  const summaryParts: string[] = [];
  if (counts.inbox) summaryParts.push(`${counts.inbox} inbox`);
  if (counts.spam) summaryParts.push(`${counts.spam} spam`);
  if (counts.all_mail_only) summaryParts.push(`${counts.all_mail_only} all mail`);
  if (counts.not_found) summaryParts.push(`${counts.not_found} missing`);
  if (counts.error) summaryParts.push(`${counts.error} error`);

  return {
    placement,
    total,
    counts,
    summaryText: summaryParts.join(" · ") || "No monitor results",
  };
}

function mailpoolPlacementToMonitorPlacement(value: string): DeliverabilityProbeMonitorResult["placement"] {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "inbox") return "inbox";
  if (normalized === "promotion") return "all_mail_only";
  if (normalized === "spam") return "spam";
  if (normalized === "unreceived") return "not_found";
  return "error";
}

function isMailpoolCreditExhaustedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.trim().toLowerCase();
  return normalized.includes("mailpool") && normalized.includes("enough credits");
}

async function waitForMailpoolDeliverabilitySpamCheck(apiKey: string, spamCheckId: string) {
  let current = await getMailpoolSpamCheck(apiKey, spamCheckId);
  for (let attempt = 0; attempt < 4 && current.state !== "completed"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    current = await getMailpoolSpamCheck(apiKey, spamCheckId);
  }
  return current;
}

async function waitForMailpoolDeliverabilityInboxPlacement(apiKey: string, inboxPlacementId: string) {
  let current = await getMailpoolInboxPlacement(apiKey, inboxPlacementId);
  for (let attempt = 0; attempt < 6 && current.state !== "completed"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    current = await getMailpoolInboxPlacement(apiKey, inboxPlacementId);
  }
  return current;
}

async function refreshMailpoolSpamCheckFallback(senderAccount: SenderDispatchSlot["account"]) {
  const mailboxId = senderAccount.config.mailpool.mailboxId.trim();
  if (!mailboxId) return null;

  const secrets = await getOutreachProvisioningSettingsSecrets();
  const apiKey = String(secrets.mailpoolApiKey ?? "").trim();
  if (!apiKey) return null;

  const spamCheck = await createMailpoolSpamCheck({ apiKey, mailboxId });
  const resolvedSpamCheck = await waitForMailpoolDeliverabilitySpamCheck(apiKey, String(spamCheck.id));
  const score = Math.max(0, Math.min(100, Number(resolvedSpamCheck.result?.score ?? 0) || 0));
  const summary =
    resolvedSpamCheck.state === "completed" ? `Spam score ${score}/100` : "Spam check pending";

  await updateOutreachAccount(senderAccount.id, {
    config: {
      mailpool: {
        spamCheckId: String(resolvedSpamCheck.id).trim(),
        status: resolvedSpamCheck.state === "completed" ? "active" : senderAccount.config.mailpool.status,
        lastSpamCheckAt:
          resolvedSpamCheck.state === "completed"
            ? resolvedSpamCheck.createdAt
            : senderAccount.config.mailpool.lastSpamCheckAt,
        lastSpamCheckScore:
          resolvedSpamCheck.state === "completed"
            ? score
            : senderAccount.config.mailpool.lastSpamCheckScore,
        lastSpamCheckSummary: summary,
      },
    },
  });

  return {
    spamCheckId: String(resolvedSpamCheck.id).trim(),
    spamCheckStatus: resolvedSpamCheck.state,
    spamCheckScore: score,
    spamCheckSummary: summary,
    checkedAt:
      resolvedSpamCheck.state === "completed"
        ? resolvedSpamCheck.createdAt
        : senderAccount.config.mailpool.lastSpamCheckAt,
  };
}

async function queueDeliverabilityProbe(input: {
  runId: string;
  executeAfter?: string;
  payload?: Record<string, unknown>;
  force?: boolean;
}) {
  const jobs = await listRunJobs(input.runId, 50);
  if (!input.force) {
    const requestedPayload = asRecord(input.payload);
    const requestedSourceMessageId = String(requestedPayload.sourceMessageId ?? "").trim();
    const requestedContentHash = String(requestedPayload.contentHash ?? "").trim();
    const requestedVariant = readDeliverabilityProbeVariant(requestedPayload.probeVariant);
    const requestedSenderAccountId = String(requestedPayload.senderAccountId ?? "").trim();
    const requestedFromEmail = String(requestedPayload.fromEmail ?? "").trim().toLowerCase();
    const activeProbes = jobs.filter(
      (job) => job.jobType === "monitor_deliverability" && ["queued", "running"].includes(job.status)
    );
    const matchingActiveProbe = activeProbes.find((job) => {
      const jobPayload = asRecord(job.payload);
      const activeSourceMessageId = String(jobPayload.sourceMessageId ?? "").trim();
      const activeContentHash = String(jobPayload.contentHash ?? "").trim();
      const activeVariant = readDeliverabilityProbeVariant(jobPayload.probeVariant);
      const activeSenderAccountId = String(jobPayload.senderAccountId ?? "").trim();
      const activeFromEmail = String(jobPayload.fromEmail ?? "").trim().toLowerCase();
      if (requestedVariant !== activeVariant) {
        return false;
      }
      if (requestedSenderAccountId && activeSenderAccountId && requestedSenderAccountId !== activeSenderAccountId) {
        return false;
      }
      if (requestedFromEmail && activeFromEmail && requestedFromEmail !== activeFromEmail) {
        return false;
      }
      if (requestedSourceMessageId && activeSourceMessageId === requestedSourceMessageId) {
        return true;
      }
      if (requestedContentHash && activeContentHash === requestedContentHash) {
        return true;
      }
      return !requestedSourceMessageId && !requestedContentHash;
    });
    if (matchingActiveProbe) {
      return matchingActiveProbe;
    }
  }
  return enqueueOutreachJob({
    runId: input.runId,
    jobType: "monitor_deliverability",
    executeAfter: input.executeAfter ?? nowIso(),
    payload: input.payload ?? {},
  });
}

async function processMailpoolDeliverabilityJob(input: {
  run: OutreachRun;
  probeRun: Awaited<ReturnType<typeof getDeliverabilityProbeRun>> | null;
  probeVariant: DeliverabilityProbeVariant;
  probeToken: string;
  referenceMessage: {
    id: string;
    status: string;
    sourceType: string;
    nodeId: string;
    leadId: string;
    subject: string;
    body: string;
    contentHash: string;
  };
  senderChoice: SenderDispatchSlot;
}) {
  const senderAccount = input.senderChoice.account;
  const mailboxId = senderAccount.config.mailpool.mailboxId.trim();
  const fromEmail = getOutreachAccountFromEmail(senderAccount).trim();
  const replyToEmail = getOutreachAccountReplyToEmail(senderAccount).trim() || fromEmail;
  const failProbe = async (reason: string) => {
    const failedProbe =
      input.probeRun ??
      (await createDeliverabilityProbeRun({
        runId: input.run.id,
        brandId: input.run.brandId,
        campaignId: input.run.campaignId,
        experimentId: input.run.experimentId,
        probeToken: input.probeToken,
        probeVariant: input.probeVariant,
        status: "failed",
        stage: "poll",
        sourceMessageId: input.referenceMessage.id,
        sourceMessageStatus: input.referenceMessage.status,
        sourceType: input.referenceMessage.sourceType,
        sourceNodeId: input.referenceMessage.nodeId,
        sourceLeadId: input.referenceMessage.leadId,
        senderAccountId: senderAccount.id,
        senderAccountName: senderAccount.name,
        fromEmail,
        replyToEmail,
        subject: input.referenceMessage.subject,
        contentHash: input.referenceMessage.contentHash,
        lastError: reason,
        completedAt: nowIso(),
      }));
    if (input.probeRun) {
      await updateDeliverabilityProbeRun(input.probeRun.id, {
        status: "failed",
        stage: "poll",
        lastError: reason,
        completedAt: nowIso(),
      });
    }
    await createOutreachEvent({
      runId: input.run.id,
      eventType: "deliverability_probe_failed",
      payload: {
        reason,
        probeRunId: failedProbe.id,
        probeToken: input.probeToken,
        probeVariant: input.probeVariant,
        senderAccountId: senderAccount.id,
        fromEmail,
      },
    });
  };
  const settings = await getOutreachProvisioningSettings();
  const secrets = await getOutreachProvisioningSettingsSecrets();
  const apiKey = String(secrets.mailpoolApiKey ?? "").trim();

  if (!mailboxId || !apiKey) {
    await failProbe("Mailpool mailbox is missing or Mailpool credentials are not configured");
    return;
  }

  try {
    const spamCheck = await createMailpoolSpamCheck({ apiKey, mailboxId });
    const resolvedSpamCheck = await waitForMailpoolDeliverabilitySpamCheck(apiKey, String(spamCheck.id));

    const providers =
      settings.deliverability.mailpoolInboxProviders.length
        ? settings.deliverability.mailpoolInboxProviders
        : [...DEFAULT_MAILPOOL_INBOX_PROVIDERS];
    let inboxPlacementId = senderAccount.config.mailpool.inboxPlacementId.trim();
    if (!inboxPlacementId) {
      const created = await createMailpoolInboxPlacement({
        apiKey,
        mailboxId,
        providers,
      });
      inboxPlacementId = String(created.id).trim();
    }

    await runMailpoolInboxPlacement(apiKey, inboxPlacementId);
    const resolvedPlacement = await waitForMailpoolDeliverabilityInboxPlacement(apiKey, inboxPlacementId);

    await updateOutreachAccount(senderAccount.id, {
      config: {
        mailpool: {
          spamCheckId: String(resolvedSpamCheck.id).trim(),
          inboxPlacementId,
          status: resolvedPlacement.state === "completed" ? "active" : "pending",
          lastSpamCheckAt: resolvedSpamCheck.createdAt,
          lastSpamCheckScore: Number(resolvedSpamCheck.result?.score ?? 0) || 0,
          lastSpamCheckSummary:
            resolvedSpamCheck.state === "completed"
              ? `Spam score ${Number(resolvedSpamCheck.result?.score ?? 0) || 0}/100`
              : "Spam check pending",
        },
      },
    });

    const finalResults =
      resolvedPlacement.result?.checks?.length
        ? resolvedPlacement.result.checks.map((check) => ({
            accountId: String(check.mailboxId ?? check.provider ?? "mailpool").trim(),
            email: String(check.email ?? check.provider ?? "mailpool").trim().toLowerCase(),
            placement: mailpoolPlacementToMonitorPlacement(String(check.placement ?? "")),
            matchedMailbox: String(check.email ?? "").trim().toLowerCase(),
            matchedUid: 0,
            ok: Boolean(check.placement),
            error: "",
          }))
        : [
            {
              accountId: "mailpool",
              email: "mailpool",
              placement: resolvedPlacement.state === "completed" ? "error" : "not_found",
              matchedMailbox: "",
              matchedUid: 0,
              ok: false,
              error:
                resolvedPlacement.state === "completed"
                  ? "Mailpool inbox placement returned no provider checks"
                  : "Mailpool inbox placement is still pending",
            } satisfies DeliverabilityProbeMonitorResult,
          ];
    const aggregate = summarizeDeliverabilityProbeResults(finalResults);

    const nextProbe =
      input.probeRun
        ? await updateDeliverabilityProbeRun(input.probeRun.id, {
            status: resolvedPlacement.state === "completed" ? "completed" : "failed",
            stage: "poll",
            monitorTargets: finalResults.map((result) => ({
              accountId: result.accountId,
              email: result.email,
            })),
            results: finalResults,
            pollAttempt: 1,
            placement: aggregate.placement,
            totalMonitors: aggregate.total,
            counts: aggregate.counts,
            summaryText: aggregate.summaryText,
            lastError: resolvedPlacement.state === "completed" ? "" : "Mailpool inbox placement is still pending",
            completedAt: nowIso(),
          })
        : await createDeliverabilityProbeRun({
            runId: input.run.id,
            brandId: input.run.brandId,
            campaignId: input.run.campaignId,
            experimentId: input.run.experimentId,
            probeToken: input.probeToken,
            probeVariant: input.probeVariant,
            status: resolvedPlacement.state === "completed" ? "completed" : "failed",
            stage: "poll",
            sourceMessageId: input.referenceMessage.id,
            sourceMessageStatus: input.referenceMessage.status,
            sourceType: input.referenceMessage.sourceType,
            sourceNodeId: input.referenceMessage.nodeId,
            sourceLeadId: input.referenceMessage.leadId,
            senderAccountId: senderAccount.id,
            senderAccountName: senderAccount.name,
            fromEmail,
            replyToEmail,
            subject: input.referenceMessage.subject,
            contentHash: input.referenceMessage.contentHash,
            monitorTargets: finalResults.map((result) => ({
              accountId: result.accountId,
              email: result.email,
            })),
            results: finalResults,
            pollAttempt: 1,
            placement: aggregate.placement,
            totalMonitors: aggregate.total,
            counts: aggregate.counts,
            summaryText: aggregate.summaryText,
            lastError: resolvedPlacement.state === "completed" ? "" : "Mailpool inbox placement is still pending",
            completedAt: nowIso(),
          });

    await createOutreachEvent({
      runId: input.run.id,
      eventType: "deliverability_probe_result",
      payload: {
        probeToken: input.probeToken,
        probeRunId: nextProbe?.id ?? "",
        probeVariant: input.probeVariant,
        subject: input.referenceMessage.subject,
        sourceMessageId: input.referenceMessage.id,
        sourceMessageStatus: input.referenceMessage.status,
        sourceType: input.referenceMessage.sourceType,
        nodeId: input.referenceMessage.nodeId,
        leadId: input.referenceMessage.leadId,
        contentHash: input.referenceMessage.contentHash,
        senderAccountId: senderAccount.id,
        senderAccountName: senderAccount.name,
        fromEmail,
        placement: aggregate.placement,
        totalMonitors: aggregate.total,
        counts: aggregate.counts,
        summaryText: aggregate.summaryText,
        spamCheckScore: Number(resolvedSpamCheck.result?.score ?? 0) || 0,
        monitorResults: finalResults,
      },
    });

    const senderScorecard = buildSenderDeliverabilityScorecards({
      probeRuns: nextProbe ? [nextProbe] : [],
      senderAccounts: [senderAccount],
    })[0];

    if (
      senderScorecard?.autoPaused &&
      senderScorecard.totalMonitors >= SENDER_DELIVERABILITY_MIN_MONITORS
    ) {
      await createOutreachEvent({
        runId: input.run.id,
        eventType: "sender_deliverability_paused_auto",
        payload: {
          senderAccountId: senderScorecard.senderAccountId,
          senderAccountName: senderScorecard.senderAccountName,
          fromEmail: senderScorecard.fromEmail,
          spamRate: senderScorecard.spamRate,
          inboxRate: senderScorecard.inboxRate,
          totalMonitors: senderScorecard.totalMonitors,
          summaryText: senderScorecard.summaryText,
          autoPauseUntil: senderScorecard.autoPauseUntil,
          reason: senderScorecard.autoPauseReason,
        },
      });
    }
  } catch (error) {
    if (isMailpoolCreditExhaustedError(error)) {
      await failProbe(error instanceof Error ? error.message : "Mailpool credits are exhausted");
      return;
    }
    throw error;
  }
}

async function findRecentDeliverabilityProbeForSender(input: {
  runId: string;
  senderAccountId: string;
  fromEmail: string;
  probeVariant: DeliverabilityProbeVariant;
  contentHash: string;
  sourceMessageId: string;
}) {
  const probeRuns = await listDeliverabilityProbeRuns({
    runId: input.runId,
    senderAccountId: input.senderAccountId,
    fromEmail: input.fromEmail,
    probeVariant: input.probeVariant,
    statuses: ["queued", "sent", "waiting", "completed", "failed"],
    limit: 25,
  });
  return (
    probeRuns.find((probeRun) => {
      if (
        probeRun.status === "failed" &&
        !probeRun.reservationIds.length &&
        !probeRun.monitorTargets.length &&
        !probeRun.results.length
      ) {
        return false;
      }
      if (probeRun.contentHash && input.contentHash && probeRun.contentHash === input.contentHash) {
        return true;
      }
      if (probeRun.sourceMessageId && input.sourceMessageId && probeRun.sourceMessageId === input.sourceMessageId) {
        return true;
      }
      return false;
    }) ?? null
  );
}

async function maybeQueueAutomaticDeliverabilityProbeSet(
  run: {
    id: string;
    brandId: string;
    campaignId: string;
    experimentId: string;
  },
  input: {
    referenceMessage: DeliverabilityProbeReferenceMessage;
    senderAccountId: string;
    senderAccountName: string;
    senderFromEmail: string;
    triggerStage: "schedule" | "send" | "failover";
  }
) {
  const senderAccountId = input.senderAccountId.trim();
  const senderFromEmail = input.senderFromEmail.trim().toLowerCase();
  if (!senderAccountId || !senderFromEmail) return;

  const baselineContentHash = buildDeliverabilityBaselineProbe({
    brandName: "",
    senderDomain: senderDomainFromEmail(senderFromEmail),
    probeToken: "control",
  }).contentHash;

  const queueVariant = async (variant: DeliverabilityProbeVariant, contentHash: string) => {
    const recentProbe = await findRecentDeliverabilityProbeForSender({
      runId: run.id,
      senderAccountId,
      fromEmail: senderFromEmail,
      probeVariant: variant,
      contentHash,
      sourceMessageId: input.referenceMessage.id,
    });
    if (recentProbe) {
      const referenceTimestamp =
        recentProbe.completedAt || recentProbe.updatedAt || recentProbe.createdAt;
      const elapsed = Date.now() - toDate(referenceTimestamp).getTime();
      if (elapsed < DELIVERABILITY_PROBE_REPEAT_HOURS * 60 * 60 * 1000) {
        return null;
      }
    }
    return queueDeliverabilityProbe({
      runId: run.id,
      payload: {
        stage: "send",
        triggerStage: input.triggerStage,
        probeToken: generateDeliverabilityProbeToken(),
        probeVariant: variant,
        sourceMessageId: input.referenceMessage.id,
        contentHash,
        senderAccountId,
        senderAccountName: input.senderAccountName,
        fromEmail: senderFromEmail,
      },
    });
  };

  await queueVariant("production", input.referenceMessage.contentHash);
  return queueVariant("baseline", baselineContentHash);
}

async function maybeQueueAutomaticDeliverabilityProbe(run: {
  id: string;
  brandId: string;
  campaignId: string;
  experimentId: string;
}, input: {
  message: OutreachMessage;
  senderAccountId: string;
  senderAccountName: string;
  senderFromEmail: string;
}) {
  const referenceMessage = buildDeliverabilityProbeReferenceMessage(input.message);
  return maybeQueueAutomaticDeliverabilityProbeSet(run, {
    referenceMessage,
    senderAccountId: input.senderAccountId,
    senderAccountName: input.senderAccountName,
    senderFromEmail: input.senderFromEmail,
    triggerStage: "send",
  });
}

async function maybeQueueScheduledDeliverabilityProbe(run: OutreachRun) {
  const referenceMessage = await resolveDeliverabilityProbeReferenceMessage({
    runId: run.id,
    preferScheduled: true,
  });
  if (!referenceMessage) return null;

  const routingContext = await buildRunSenderRoutingContext(run, {
    preferredAccountId: run.accountId,
  });
  const senderSlot =
    routingContext.primarySender ??
    routingContext.senderPoolState.pool.find((slot) => slot.account.id === run.accountId) ??
    null;
  if (!senderSlot) return null;

  return maybeQueueAutomaticDeliverabilityProbeSet(run, {
    referenceMessage,
    senderAccountId: senderSlot.account.id,
    senderAccountName: senderSlot.account.name,
    senderFromEmail: getOutreachAccountFromEmail(senderSlot.account).trim(),
    triggerStage: "schedule",
  });
}

async function buildRunSenderRoutingContext(run: OutreachRun, input?: { preferredAccountId?: string }) {
  const preferredAccountId = String(input?.preferredAccountId ?? run.accountId).trim();
  const runtimeExperiment = await getExperimentRecordByRuntimeRef(run.brandId, run.campaignId, run.experimentId);
  const businessWindow = businessWindowFromExperimentEnvelope(runtimeExperiment?.testEnvelope);
  const senderPoolState = await resolveSenderPoolForBrand({
    brandId: run.brandId,
    preferredAccountId: preferredAccountId || run.accountId,
    timeZone: run.timezone || DEFAULT_TIMEZONE,
    businessWindow,
  });
  const requireReady = run.ownerType === "campaign";
  const senderHealthState =
    senderPoolState.pool.length > 0
      ? await resolveBrandSenderHealth({
          brandId: run.brandId,
          accountId: preferredAccountId || run.accountId,
          requireInfrastructureReady: requireReady,
          requireMessageReady: requireReady,
        })
      : null;
  const healthBlockedBySenderId = new Map<string, SenderHealthGateSnapshot>();
  if (senderHealthState?.brand) {
    for (const slot of senderPoolState.pool) {
      const fromEmail = getOutreachAccountFromEmail(slot.account).trim().toLowerCase();
      const gate = evaluateSenderHealthGate({
        domains: senderHealthState.brand.domains,
        accountId: slot.account.id,
        fromEmail,
        requireInfrastructureReady: requireReady,
        requireMessageReady: requireReady,
      });
      if (!gate.blockers.length && !gate.pending.length) continue;
      healthBlockedBySenderId.set(slot.account.id, {
        senderAccountId: slot.account.id,
        senderAccountName: slot.account.name,
        fromEmail,
        blockers: gate.blockers,
        pending: gate.pending,
      });
    }
  }

  const senderScorecards = senderPoolState.pool.length
    ? await scoreSenderPoolDeliverability({
        brandId: run.brandId,
        campaignId: run.campaignId,
        pool: senderPoolState.pool,
      })
    : [];
  const autoPausedBySenderId = new Map(
    senderScorecards
      .filter((scorecard) => scorecard.autoPaused && scorecard.senderAccountId)
      .map((scorecard) => [scorecard.senderAccountId, scorecard] as const)
  );
  const routingSignalsBySenderId = buildSenderRoutingSignals({
    domains: senderHealthState?.brand?.domains,
    scorecards: senderScorecards,
  });
  const dispatchPool = senderPoolState.pool.filter(
    (slot) => !autoPausedBySenderId.has(slot.account.id) && !healthBlockedBySenderId.has(slot.account.id)
  );
  const senderUsage =
    senderPoolState.pool.length > 0
      ? await countBrandSenderUsage({
          brandId: run.brandId,
          timezone: run.timezone || DEFAULT_TIMEZONE,
        })
      : {};
  const primarySender =
    dispatchPool.length > 0
      ? pickSenderForMessage({
          pool: dispatchPool,
          usage: senderUsage,
          preferredAccountId: preferredAccountId || run.accountId,
          routingSignalsBySenderId,
        })?.slot ??
        dispatchPool.find((slot) => slot.account.id === (preferredAccountId || run.accountId)) ??
        dispatchPool[0]
      : null;

  return {
    businessWindow,
    senderPoolState,
    senderHealthState,
    healthBlockedBySenderId,
    senderScorecards,
    autoPausedBySenderId,
    routingSignalsBySenderId,
    dispatchPool,
    senderUsage,
    primarySender,
  };
}

async function autoFailoverRunSender(input: {
  run: OutreachRun;
  reason: string;
  summary: string;
  currentAccountId?: string;
  excludeCurrent?: boolean;
}) {
  const currentAccountId = String(input.currentAccountId ?? input.run.accountId).trim();
  const routingContext = await buildRunSenderRoutingContext(input.run, {
    preferredAccountId: currentAccountId || input.run.accountId,
  });
  const eligiblePool = input.excludeCurrent
    ? routingContext.dispatchPool.filter((slot) => slot.account.id !== currentAccountId)
    : routingContext.dispatchPool;
  const nextSender =
    eligiblePool.length > 0
      ? pickSenderForMessage({
          pool: eligiblePool,
          usage: routingContext.senderUsage,
          preferredAccountId: currentAccountId || input.run.accountId,
          routingSignalsBySenderId: routingContext.routingSignalsBySenderId,
        })?.slot ??
        eligiblePool[0]
      : null;
  if (!nextSender || !currentAccountId || nextSender.account.id === currentAccountId) {
    return {
      switched: false,
      nextSender: null,
      routingContext,
    };
  }

  const previousAccount = await getOutreachAccount(currentAccountId);
  await updateOutreachRun(input.run.id, {
    accountId: nextSender.account.id,
    pauseReason: "",
    lastError: "",
  });
  await createOutreachEvent({
    runId: input.run.id,
    eventType: "sender_route_changed_auto",
    payload: {
      reason: input.reason,
      summary: input.summary,
      fromAccountId: currentAccountId,
      fromAccountName: previousAccount?.name ?? "",
      fromEmail: previousAccount ? getOutreachAccountFromEmail(previousAccount).trim() : "",
      toAccountId: nextSender.account.id,
      toAccountName: nextSender.account.name,
      toEmail: getOutreachAccountFromEmail(nextSender.account).trim(),
      standbyCount: Math.max(0, routingContext.dispatchPool.length - 1),
      blockedCount: routingContext.autoPausedBySenderId.size + routingContext.healthBlockedBySenderId.size,
    },
  });

  const referenceMessage = await resolveDeliverabilityProbeReferenceMessage({
    runId: input.run.id,
    preferScheduled: true,
  });
  if (referenceMessage) {
    await maybeQueueAutomaticDeliverabilityProbeSet(input.run, {
      referenceMessage,
      senderAccountId: nextSender.account.id,
      senderAccountName: nextSender.account.name,
      senderFromEmail: getOutreachAccountFromEmail(nextSender.account).trim(),
      triggerStage: "failover",
    });
  }

  return {
    switched: true,
    nextSender,
    routingContext,
  };
}

async function processMonitorDeliverabilityJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["canceled", "failed", "preflight_failed"].includes(run.status)) return;

  const payload =
    job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? (job.payload as Record<string, unknown>)
      : {};
  const stageRaw = String(payload.stage ?? "send").trim().toLowerCase();
  const stage: DeliverabilityProbeStage = stageRaw === "poll" ? "poll" : "send";
  const probeVariant = readDeliverabilityProbeVariant(payload.probeVariant);
  const probeToken = String(payload.probeToken ?? generateDeliverabilityProbeToken()).trim();
  const requestedProbeRunId = String(payload.probeRunId ?? "").trim();
  let probeRun =
    (requestedProbeRunId ? await getDeliverabilityProbeRun(requestedProbeRunId) : null) ||
    (probeToken ? await findDeliverabilityProbeRun({ runId: run.id, probeToken, probeVariant }) : null);
  const sourceMessageId = String(payload.sourceMessageId ?? "").trim();
  const referenceMessage = await resolveDeliverabilityProbeReferenceMessage({
    runId: run.id,
    sourceMessageId,
    preferScheduled: stage === "send" && payload.manual === true,
  });
  if (!referenceMessage) {
    await createOutreachEvent({
      runId: run.id,
      eventType: "deliverability_probe_failed",
      payload: {
        reason: "No real scheduled or sent message is available for deliverability probing",
        requestedSourceMessageId: sourceMessageId,
        stage,
        probeVariant,
      },
    });
    return;
  }
  const preferredSenderAccountId =
    String(payload.senderAccountId ?? "").trim() ||
    referenceMessage.senderAccountId ||
    run.accountId;
  const runtimeExperiment = await getExperimentRecordByRuntimeRef(run.brandId, run.campaignId, run.experimentId);
  const businessWindow = businessWindowFromExperimentEnvelope(runtimeExperiment?.testEnvelope);
  const senderPoolState = await resolveSenderPoolForBrand({
    brandId: run.brandId,
    preferredAccountId: preferredSenderAccountId,
    timeZone: run.timezone || DEFAULT_TIMEZONE,
    businessWindow,
  });
  if (!senderPoolState.pool.length) {
    await createOutreachEvent({
      runId: run.id,
      eventType: "deliverability_probe_failed",
      payload: { reason: "No active sender accounts assigned to this brand", probeVariant },
    });
    return;
  }

  const senderUsage = await countBrandSenderUsage({
    brandId: run.brandId,
    timezone: run.timezone || DEFAULT_TIMEZONE,
  });
  const strictSenderAccountId =
    String(payload.senderAccountId ?? "").trim() || referenceMessage.senderAccountId;
  const strictSenderSlot = strictSenderAccountId
    ? senderPoolState.pool.find((slot) => slot.account.id === strictSenderAccountId) ?? null
    : null;
  const senderChoice =
    strictSenderSlot
      ? { slot: strictSenderSlot }
      : pickSenderForMessage({
          pool: senderPoolState.pool,
          usage: senderUsage,
          preferredAccountId: preferredSenderAccountId,
        }) ??
        senderPoolState.pool.find((slot) => slot.account.id === preferredSenderAccountId) ??
        senderPoolState.pool[0];
  if (strictSenderAccountId && !strictSenderSlot) {
    await createOutreachEvent({
      runId: run.id,
      eventType: "deliverability_probe_failed",
      payload: {
        reason: "Exact sender account for the source message is not available for probing",
        sourceMessageId: referenceMessage.id,
        senderAccountId: strictSenderAccountId,
        probeVariant,
      },
    });
    return;
  }
  if (!senderChoice) {
    await createOutreachEvent({
      runId: run.id,
      eventType: "deliverability_probe_failed",
      payload: { reason: "No sender slot available for deliverability monitoring", probeVariant },
    });
    return;
  }

  if (senderChoice.slot.account.provider === "mailpool") {
    await processMailpoolDeliverabilityJob({
      run,
      probeRun,
      probeVariant,
      probeToken,
      referenceMessage,
      senderChoice: senderChoice.slot,
    });
    return;
  }

  const senderFromEmail = getOutreachAccountFromEmail(senderChoice.slot.account).trim();
  const assignment = await getBrandOutreachAssignment(run.brandId);
  const replyMailbox =
    assignment?.mailboxAccountId ? await getOutreachAccount(assignment.mailboxAccountId) : null;
  const replyToEmail = replyMailbox?.config.mailbox.email.trim() || senderFromEmail;
  const brand = await getBrandById(run.brandId);
  const baselineProbe = buildDeliverabilityBaselineProbe({
    brandName: brand?.name || "",
    senderDomain:
      senderDomainFromEmail(referenceMessage.senderFromEmail) ||
      senderDomainFromEmail(senderFromEmail),
    probeToken,
  });
  const queuedSubject = typeof payload.subject === "string" ? payload.subject : "";
  const subject =
    probeVariant === "baseline"
      ? queuedSubject.trim() || baselineProbe.subject
      : queuedSubject.trim() || referenceMessage.subject;
  const body = probeVariant === "baseline" ? baselineProbe.body : referenceMessage.body;
  const contentHash =
    String(payload.contentHash ?? "").trim() ||
    (probeVariant === "baseline" ? baselineProbe.contentHash : referenceMessage.contentHash);
  const requestedMonitorTargets = readDeliverabilityProbeTargets(
    payload.monitorTargets ?? payload.monitorAccountIds
  );
  const resolvedRequestedTargets: DeliverabilityMonitorTarget[] = [];
  for (const requestedTarget of requestedMonitorTargets) {
    const account = await getOutreachAccount(requestedTarget.accountId);
    const secrets = account ? await getOutreachAccountSecrets(account.id) : null;
    if (
      account &&
      secrets &&
      account.status === "active" &&
      supportsMailbox(account) &&
      account.config.mailbox.status === "connected" &&
      secrets.mailboxPassword.trim() &&
      account.config.mailbox.email.trim().toLowerCase() === requestedTarget.email
    ) {
      resolvedRequestedTargets.push({
        account,
        secrets,
        brandId: "",
      });
    }
  }
  const candidateMonitorTargets =
    resolvedRequestedTargets.length
      ? resolvedRequestedTargets
      : await resolveDeliverabilityMonitorTargets({
          runBrandId: run.brandId,
          excludeAccountIds: [run.accountId, assignment?.mailboxAccountId ?? ""],
          excludeEmails: [replyToEmail, senderFromEmail],
        });
  const blockedMonitorEmails = await listBlockedMonitorEmailsForSender({
    brandId: run.brandId,
    senderAccountId: senderChoice.slot.account.id,
    fromEmail: senderFromEmail,
  });
  const monitorTargets = candidateMonitorTargets.filter((target) => {
    const monitorEmail = target.account.config.mailbox.email.trim().toLowerCase();
    return !blockedMonitorEmails.has(monitorEmail);
  });

  if (!monitorTargets.length) {
    const monitorUnavailableReason = candidateMonitorTargets.length
      ? "No unused deliverability monitor mailbox remains for this sender"
      : "No dedicated deliverability monitor group is connected";
    let spamCheckFallback:
      | {
          spamCheckId: string;
          spamCheckStatus: "pending" | "completed";
          spamCheckScore: number;
          spamCheckSummary: string;
          checkedAt: string;
        }
      | null = null;
    let spamCheckFallbackError = "";

    try {
      spamCheckFallback = await refreshMailpoolSpamCheckFallback(senderChoice.slot.account);
    } catch (error) {
      if (isMailpoolCreditExhaustedError(error)) {
        spamCheckFallbackError = error instanceof Error ? error.message : "Mailpool credits are exhausted";
      } else {
        throw error;
      }
    }

    if (!probeRun) {
      probeRun = await createDeliverabilityProbeRun({
        runId: run.id,
        brandId: run.brandId,
        campaignId: run.campaignId,
        experimentId: run.experimentId,
        probeToken,
        probeVariant,
        status: "failed",
        stage,
        sourceMessageId: referenceMessage.id,
        sourceMessageStatus: referenceMessage.status,
        sourceType: referenceMessage.sourceType,
        sourceNodeId: referenceMessage.nodeId,
        sourceLeadId: referenceMessage.leadId,
        senderAccountId: senderChoice.slot.account.id,
        senderAccountName: senderChoice.slot.account.name,
        fromEmail: senderFromEmail,
        replyToEmail,
        subject,
        contentHash,
        lastError: monitorUnavailableReason,
      });
    } else {
      probeRun = await updateDeliverabilityProbeRun(probeRun.id, {
        status: "failed",
        stage,
        senderAccountId: senderChoice.slot.account.id,
        senderAccountName: senderChoice.slot.account.name,
        fromEmail: senderFromEmail,
        replyToEmail,
        subject,
        contentHash,
        lastError: monitorUnavailableReason,
      });
    }
    await createOutreachEvent({
      runId: run.id,
      eventType: "deliverability_probe_failed",
      payload: {
        reason: monitorUnavailableReason,
        probeVariant,
        probeToken,
        probeRunId: probeRun?.id ?? "",
        senderAccountId: senderChoice.slot.account.id,
        fromEmail: senderFromEmail,
        taintedMonitorCount: blockedMonitorEmails.size,
        mailpoolSpamCheckFallback:
          spamCheckFallback
            ? {
                spamCheckId: spamCheckFallback.spamCheckId,
                status: spamCheckFallback.spamCheckStatus,
                score: spamCheckFallback.spamCheckScore,
                summary: spamCheckFallback.spamCheckSummary,
                checkedAt: spamCheckFallback.checkedAt,
              }
            : null,
        mailpoolSpamCheckFallbackError: spamCheckFallbackError,
      },
    });
    return;
  }

  if (stage === "send") {
    if (!probeRun) {
      probeRun = await createDeliverabilityProbeRun({
        runId: run.id,
        brandId: run.brandId,
        campaignId: run.campaignId,
        experimentId: run.experimentId,
        probeToken,
        probeVariant,
        status: "queued",
        stage,
        sourceMessageId: referenceMessage.id,
        sourceMessageStatus: referenceMessage.status,
        sourceType: referenceMessage.sourceType,
        sourceNodeId: referenceMessage.nodeId,
        sourceLeadId: referenceMessage.leadId,
        senderAccountId: senderChoice.slot.account.id,
        senderAccountName: senderChoice.slot.account.name,
        fromEmail: senderFromEmail,
        replyToEmail,
        subject,
        contentHash,
      });
    }
    const reservations = await createDeliverabilitySeedReservations({
      probeRunId: probeRun.id,
      runId: run.id,
      brandId: run.brandId,
      senderAccountId: senderChoice.slot.account.id,
      fromEmail: senderFromEmail,
      probeVariant,
      contentHash,
      probeToken,
      targets: monitorTargets.map((target) => ({
        accountId: target.account.id,
        email: target.account.config.mailbox.email.trim().toLowerCase(),
      })),
    });
    const reservationByMonitorKey = new Map(
      reservations.map((reservation) => [
        `${reservation.monitorAccountId}:${reservation.monitorEmail}`,
        reservation,
      ] as const)
    );
    const reservedMonitorTargets = monitorTargets
      .map((target) => {
        const email = target.account.config.mailbox.email.trim().toLowerCase();
        const reservation = reservationByMonitorKey.get(`${target.account.id}:${email}`) ?? null;
        if (!reservation) return null;
        return {
          reservation,
          target,
        };
      })
      .filter((entry): entry is { reservation: Awaited<typeof reservations>[number]; target: DeliverabilityMonitorTarget } =>
        Boolean(entry)
      );
    const reservedTargets = reservedMonitorTargets.map(({ reservation }) => ({
      reservationId: reservation.id,
      accountId: reservation.monitorAccountId,
      email: reservation.monitorEmail,
    }));
    probeRun = await updateDeliverabilityProbeRun(probeRun.id, {
      reservationIds: reservations.map((reservation) => reservation.id),
      monitorTargets: reservedTargets,
      stage: "send",
      status: "queued",
      lastError: "",
    });

    const sentTargets: Array<DeliverabilityProbeTarget & { providerMessageId: string }> = [];
    const initialResults: DeliverabilityProbeMonitorResult[] = [];

    for (const { reservation, target: monitorTarget } of reservedMonitorTargets) {
      const monitorEmail = monitorTarget.account.config.mailbox.email.trim();
      const send = await sendMonitoringProbeMessage({
        account: senderChoice.slot.account,
        secrets: senderChoice.slot.secrets,
        replyToEmail,
        recipient: monitorEmail,
        runId: run.id,
        experimentId: run.experimentId,
        subject,
        body,
        probeVariant,
        probeToken,
        monitorAccountId: monitorTarget.account.id,
        monitorEmail,
        sourceMessageId: referenceMessage.id,
        sourceMessageStatus: referenceMessage.status,
        sourceType: referenceMessage.sourceType,
        sourceNodeId: referenceMessage.nodeId,
        sourceLeadId: referenceMessage.leadId,
        contentHash,
      });
      if (send.ok) {
        sentTargets.push({
          reservationId: reservation.id,
          accountId: monitorTarget.account.id,
          email: monitorEmail.toLowerCase(),
          providerMessageId: send.providerMessageId,
        });
        continue;
      }
      initialResults.push({
        accountId: monitorTarget.account.id,
        email: monitorEmail.toLowerCase(),
        placement: "error",
        matchedMailbox: "",
        matchedUid: 0,
        ok: false,
        error: send.error || "Monitoring probe send failed",
      });
    }

    for (const sentTarget of sentTargets) {
      if (!sentTarget.reservationId) continue;
      await updateDeliverabilitySeedReservations([sentTarget.reservationId], {
        status: "consumed",
        providerMessageId: sentTarget.providerMessageId,
        consumedAt: nowIso(),
        releasedAt: "",
        releasedReason: "",
      });
    }
    const failedReservationIds = reservedTargets
      .filter(
        (target) =>
          !sentTargets.some(
            (sentTarget) => sentTarget.accountId === target.accountId && sentTarget.email === target.email
          )
      )
      .map((target) => target.reservationId ?? "")
      .filter(Boolean);
    if (failedReservationIds.length) {
      await updateDeliverabilitySeedReservations(failedReservationIds, {
        status: "released",
        releasedAt: nowIso(),
        releasedReason: "probe_send_failed",
      });
    }

    if (!sentTargets.length) {
      if (probeRun) {
        await updateDeliverabilityProbeRun(probeRun.id, {
          status: "failed",
          stage: "send",
          results: initialResults,
          totalMonitors: initialResults.length,
          lastError: "Monitoring probe send failed for every seed mailbox",
        });
      }
      await createOutreachEvent({
        runId: run.id,
        eventType: "deliverability_probe_failed",
        payload: {
          reason: "Monitoring probe send failed for every seed mailbox",
          probeToken,
          probeRunId: probeRun?.id ?? "",
          probeVariant,
          monitorCount: monitorTargets.length,
          initialResults,
        },
      });
      return;
    }

    if (probeRun) {
      probeRun = await updateDeliverabilityProbeRun(probeRun.id, {
        status: "sent",
        stage: "send",
        monitorTargets: sentTargets.map(({ reservationId, accountId, email, providerMessageId }) => ({
          reservationId,
          accountId,
          email,
          providerMessageId,
        })),
        results: initialResults,
        totalMonitors: sentTargets.length,
        lastError: "",
      });
    }

    await createOutreachEvent({
      runId: run.id,
      eventType: "deliverability_probe_sent",
      payload: {
        probeToken,
        probeRunId: probeRun?.id ?? "",
        probeVariant,
        senderAccountId: senderChoice.slot.account.id,
        senderAccountName: senderChoice.slot.account.name,
        providerMessageIds: sentTargets.map((target) => target.providerMessageId),
        sourceMessageId: referenceMessage.id,
        sourceMessageStatus: referenceMessage.status,
        sourceType: referenceMessage.sourceType,
        nodeId: referenceMessage.nodeId,
        leadId: referenceMessage.leadId,
        contentHash,
        subject,
        fromEmail: senderFromEmail,
        replyToEmail,
        monitorCount: sentTargets.length,
        monitorEmails: sentTargets.map((target) => target.email),
        failedMonitorCount: initialResults.length,
      },
    });
    await queueDeliverabilityProbe({
      runId: run.id,
      executeAfter: addMinutes(nowIso(), DELIVERABILITY_PROBE_POLL_DELAY_MINUTES),
      force: true,
      payload: {
        stage: "poll",
        probeRunId: probeRun?.id ?? "",
        probeVariant,
        probeToken,
        subject,
        sourceMessageId: referenceMessage.id,
        sourceMessageStatus: referenceMessage.status,
        sourceType: referenceMessage.sourceType,
        nodeId: referenceMessage.nodeId,
        leadId: referenceMessage.leadId,
        contentHash,
        senderAccountId: senderChoice.slot.account.id,
        senderAccountName: senderChoice.slot.account.name,
        fromEmail: senderFromEmail,
        monitorTargets: sentTargets.map(({ reservationId, accountId, email, providerMessageId }) => ({
          reservationId,
          accountId,
          email,
          providerMessageId,
        })),
        previousResults: initialResults,
        pollAttempt: 1,
      },
    });
    return;
  }

  const pollAttempt = Math.max(1, Number(payload.pollAttempt ?? 1) || 1);
  const fromEmail = String(payload.fromEmail ?? senderFromEmail).trim();
  const previousResults = readDeliverabilityProbeResults(payload.previousResults);
  const monitorTargetsForPoll = readDeliverabilityProbeTargets(payload.monitorTargets);
  const pendingTargets: DeliverabilityProbeTarget[] = [];
  const pollResults: DeliverabilityProbeMonitorResult[] = [];

  for (const target of monitorTargetsForPoll) {
    const account = await getOutreachAccount(target.accountId);
    const secrets = account ? await getOutreachAccountSecrets(account.id) : null;
    if (
      !account ||
      !secrets ||
      account.status !== "active" ||
      !supportsMailbox(account) ||
      !secrets.mailboxPassword.trim()
    ) {
      pollResults.push({
        accountId: target.accountId,
        email: target.email,
        placement: "error",
        matchedMailbox: "",
        matchedUid: 0,
        ok: false,
        error: "Monitoring mailbox is missing, inactive, or no longer has credentials",
      });
      continue;
    }

    const placement = await inspectMailboxPlacement({
      mailbox: {
        host: account.config.mailbox.host.trim(),
        port: Number(account.config.mailbox.port ?? 993) || 993,
        secure: account.config.mailbox.secure !== false,
        email: account.config.mailbox.email.trim(),
        password: secrets.mailboxPassword.trim(),
      },
      fromEmail,
      subject,
      since: new Date(Date.now() - DAY_MS),
    });

    if (placement.ok && placement.placement === "not_found" && pollAttempt < 3) {
      pendingTargets.push({
        accountId: target.accountId,
        email: target.email,
      });
      continue;
    }

    pollResults.push({
      accountId: target.accountId,
      email: target.email,
      placement: placement.placement,
      matchedMailbox: placement.matchedMailbox,
      matchedUid: placement.matchedUid,
      ok: placement.ok,
      error: placement.error,
    });
  }

  if (pendingTargets.length && pollAttempt < 3) {
    if (probeRun) {
      probeRun = await updateDeliverabilityProbeRun(probeRun.id, {
        status: "waiting",
        stage: "poll",
        monitorTargets: monitorTargetsForPoll,
        results: [...previousResults, ...pollResults],
        pollAttempt,
        lastError: "",
      });
    }
    await createOutreachEvent({
      runId: run.id,
      eventType: "deliverability_probe_waiting",
      payload: {
        probeToken,
        probeRunId: probeRun?.id ?? "",
        probeVariant,
        subject,
        sourceMessageId: referenceMessage.id,
        sourceMessageStatus: referenceMessage.status,
        sourceType: referenceMessage.sourceType,
        nodeId: referenceMessage.nodeId,
        leadId: referenceMessage.leadId,
        contentHash,
        senderAccountId: String(payload.senderAccountId ?? "").trim(),
        senderAccountName: String(payload.senderAccountName ?? "").trim(),
        fromEmail,
        pendingMonitorCount: pendingTargets.length,
        pendingMonitorEmails: pendingTargets.map((target) => target.email),
        pollAttempt,
      },
    });
    await queueDeliverabilityProbe({
      runId: run.id,
      executeAfter: addMinutes(nowIso(), DELIVERABILITY_PROBE_POLL_DELAY_MINUTES),
      force: true,
      payload: {
        stage: "poll",
        probeRunId: probeRun?.id ?? "",
        probeVariant,
        probeToken,
        subject,
        sourceMessageId: referenceMessage.id,
        sourceMessageStatus: referenceMessage.status,
        sourceType: referenceMessage.sourceType,
        nodeId: referenceMessage.nodeId,
        leadId: referenceMessage.leadId,
        contentHash,
        senderAccountId: String(payload.senderAccountId ?? "").trim(),
        senderAccountName: String(payload.senderAccountName ?? "").trim(),
        fromEmail,
        monitorTargets: pendingTargets,
        previousResults: [...previousResults, ...pollResults],
        pollAttempt: pollAttempt + 1,
      },
    });
    return;
  }

  const finalResults = [...previousResults, ...pollResults];
  const aggregate = summarizeDeliverabilityProbeResults(finalResults);

  if (probeRun) {
    probeRun = await updateDeliverabilityProbeRun(probeRun.id, {
      status: "completed",
      stage: "poll",
      monitorTargets: monitorTargetsForPoll,
      results: finalResults,
      pollAttempt,
      placement: aggregate.placement,
      totalMonitors: aggregate.total,
      counts: aggregate.counts,
      summaryText: aggregate.summaryText,
      lastError: "",
      completedAt: nowIso(),
    });
  }

  await createOutreachEvent({
    runId: run.id,
    eventType: "deliverability_probe_result",
    payload: {
      probeToken,
      probeRunId: probeRun?.id ?? "",
      probeVariant,
      subject,
      sourceMessageId: referenceMessage.id,
      sourceMessageStatus: referenceMessage.status,
      sourceType: referenceMessage.sourceType,
      nodeId: referenceMessage.nodeId,
      leadId: referenceMessage.leadId,
      contentHash,
      senderAccountId: String(payload.senderAccountId ?? "").trim(),
      senderAccountName: String(payload.senderAccountName ?? "").trim(),
      fromEmail,
      placement: aggregate.placement,
      totalMonitors: aggregate.total,
      counts: aggregate.counts,
      summaryText: aggregate.summaryText,
      monitorResults: finalResults,
    },
  });

  const senderScorecard = buildSenderDeliverabilityScorecards({
    probeRuns: probeRun
      ? [
          {
            ...probeRun,
            placement: aggregate.placement,
            totalMonitors: aggregate.total,
            counts: aggregate.counts,
            summaryText: aggregate.summaryText,
            status: "completed",
            completedAt: probeRun.completedAt || nowIso(),
          },
        ]
      : [],
    senderAccounts: [senderChoice.slot.account],
  })[0];

  if (
    senderScorecard?.autoPaused &&
    senderScorecard.totalMonitors >= SENDER_DELIVERABILITY_MIN_MONITORS
  ) {
    await createOutreachEvent({
      runId: run.id,
      eventType: "sender_deliverability_paused_auto",
      payload: {
        senderAccountId: senderScorecard.senderAccountId,
        senderAccountName: senderScorecard.senderAccountName,
        fromEmail: senderScorecard.fromEmail,
        spamRate: senderScorecard.spamRate,
        inboxRate: senderScorecard.inboxRate,
        totalMonitors: senderScorecard.totalMonitors,
        summaryText: senderScorecard.summaryText,
        autoPauseUntil: senderScorecard.autoPauseUntil,
        reason: senderScorecard.autoPauseReason,
      },
    });
  }

  if (
    aggregate.placement === "spam" ||
    aggregate.placement === "all_mail_only" ||
    aggregate.placement === "not_found"
  ) {
    await createRunAnomaly({
      runId: run.id,
      type: "deliverability_inbox_placement",
      severity: aggregate.placement === "spam" ? "critical" : "warning",
      threshold: 1,
      observed: deliverabilityPlacementScore(aggregate.placement),
      details:
        aggregate.placement === "spam"
          ? `Seed group hit spam. ${aggregate.summaryText}.`
          : aggregate.placement === "all_mail_only"
            ? `Seed group missed Inbox and only reached archive-like mailboxes. ${aggregate.summaryText}.`
            : `Seed group was not found after polling. ${aggregate.summaryText}.`,
    });
  }

  if (aggregate.counts.spam > 0 && aggregate.counts.inbox === 0) {
    const autoPauseUntil = addHours(nowIso(), SENDER_DELIVERABILITY_COOLDOWN_HOURS);
    await createOutreachEvent({
      runId: run.id,
      eventType: "sender_deliverability_cooled_auto",
      payload: {
        senderAccountId: senderChoice.slot.account.id,
        senderAccountName: senderChoice.slot.account.name,
        fromEmail: senderFromEmail,
        autoPauseUntil,
        reason: `Seed placement failed (${aggregate.summaryText})`,
        placement: aggregate.placement,
        counts: aggregate.counts,
        summaryText: aggregate.summaryText,
      },
    });
    const failover = await autoFailoverRunSender({
      run,
      currentAccountId: senderChoice.slot.account.id,
      reason: "deliverability_probe_spam",
      summary: "Seed placement failed for the active sender and the system attempted to switch to the healthiest standby sender.",
      excludeCurrent: true,
    });
    if (failover.switched) {
      await enqueueOutreachJob({
        runId: run.id,
        jobType: "dispatch_messages",
        executeAfter: nowIso(),
      });
      return;
    }
    const reason = `Auto-paused: seed monitor group saw no inbox placement (${aggregate.summaryText})`;
    await updateOutreachRun(run.id, {
      status: "paused",
      pauseReason: reason,
      lastError: reason,
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "paused");
    await createOutreachEvent({
      runId: run.id,
      eventType: "run_paused_auto",
      payload: {
        reason: "deliverability_probe_spam",
        placement: aggregate.placement,
        counts: aggregate.counts,
        summaryText: aggregate.summaryText,
      },
    });
    return;
  }

  if (["queued", "sourcing", "scheduled", "sending", "monitoring", "paused"].includes(run.status)) {
    await queueDeliverabilityProbe({
      runId: run.id,
      executeAfter: addHours(nowIso(), DELIVERABILITY_PROBE_REPEAT_HOURS),
      payload: {
        stage: "send",
        probeVariant,
        sourceMessageId: referenceMessage.id,
        contentHash,
        senderAccountId: String(payload.senderAccountId ?? "").trim() || referenceMessage.senderAccountId,
        senderAccountName:
          String(payload.senderAccountName ?? "").trim() || referenceMessage.senderAccountName,
        fromEmail: fromEmail || referenceMessage.senderFromEmail,
      },
    });
  }
}

async function ensureActiveCampaignHoppers() {
  const brands = await listBrands();
  let campaignsEvaluated = 0;
  let campaignsLaunched = 0;
  let campaignsBlocked = 0;

  for (const brand of brands) {
    const campaigns = await listScaleCampaignRecords(brand.id);
    for (const campaign of campaigns) {
      if (campaign.status !== "active") continue;
      campaignsEvaluated += 1;

      const usage = await countOwnerSentUsage({
        brandId: brand.id,
        ownerType: "campaign",
        ownerId: campaign.id,
        timezone: campaign.scalePolicy.timezone || DEFAULT_TIMEZONE,
      });
      const openRun = usage.ownerRuns.find((run) => isRunOpen(run.status)) ?? null;
      if (openRun) {
        continue;
      }

      const latestRun = usage.ownerRuns[0] ?? null;
      if (latestRun && ["failed", "preflight_failed", "paused"].includes(latestRun.status)) {
        campaignsBlocked += 1;
        continue;
      }

      const dailyTarget = Math.max(1, Number(campaign.scalePolicy.dailyCap || 30));
      if (usage.dailySent >= dailyTarget) {
        continue;
      }

      if (latestRun && latestRun.status === "completed" && latestRun.metrics.sentMessages === 0) {
        const cooloffMs = Date.now() - toDate(latestRun.updatedAt).getTime();
        if (cooloffMs < 30 * 60 * 1000) {
          campaignsBlocked += 1;
          continue;
        }
      }

      const launch = await launchScaleCampaignRun({
        brandId: brand.id,
        scaleCampaignId: campaign.id,
        trigger: "auto_hopper",
      });

      if (launch.ok) {
        campaignsLaunched += 1;
      } else {
        campaignsBlocked += 1;
      }
    }
  }

  return {
    campaignsEvaluated,
    campaignsLaunched,
    campaignsBlocked,
  };
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
  if (!["queued", "sourcing", "scheduled", "sending", "monitoring"].includes(run.status)) {
    return;
  }

  let existingLeads = await listRunLeads(run.id);
  if (!existingLeads.length) {
    const ownerRuns = await listOwnerRuns(run.brandId, run.ownerType, run.ownerId);
    const donorRuns = ownerRuns.filter((candidate) => candidate.id !== run.id);
    if (donorRuns.length) {
      const donorLeadLists = await Promise.all(donorRuns.map((candidate) => listRunLeads(candidate.id)));
      const donorLeads = donorLeadLists.flat();
      if (donorLeads.length) {
        existingLeads = await upsertRunLeads(
          run.id,
          run.brandId,
          run.campaignId,
          donorLeads.map((lead) => ({
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
          eventType: "lead_sourcing_seeded_from_owner",
          payload: {
            donorRunIds: donorRuns.map((candidate) => candidate.id),
            count: existingLeads.length,
          },
        });
      }
    }
  }
  const payload =
    job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? (job.payload as Record<string, unknown>)
      : {};
  const sampleOnly = payload.sampleOnly === true;
  const resumeState = parseDeferredSourcingState(payload.resumeState);

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
  const activeExperiment = experiment;

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

  const sourceConfig = effectiveSourceConfig(hypothesis);
  const exaApiKey = platformExaApiKey();
  const dataForSeoCredentials = platformDataForSeoCredentials();
  const maxLeads = Math.max(
    1,
    Math.min(
      500,
      Number(payload.maxLeadsOverride ?? sourceConfig.maxLeads ?? (sampleOnly ? APIFY_PROBE_MAX_LEADS : 100)) || 100
    )
  );
  if (existingLeads.length) {
    const existingRunMessages = await listRunMessages(run.id);
    const { threads } = await listReplyThreadsByBrand(run.brandId);
    await updateOutreachRun(run.id, {
      status:
        existingLeads.length >= maxLeads && (run.status === "queued" || run.status === "sourcing")
          ? sampleOnly
            ? "completed"
            : "scheduled"
          : run.status,
      lastError: "",
      completedAt: sampleOnly && existingLeads.length >= maxLeads ? nowIso() : "",
      metrics: buildLiveRunMetrics({
        run,
        messages: existingRunMessages,
        threads,
        sourcedLeads: existingLeads.length,
      }),
    });
    await createOutreachEvent({
      runId: run.id,
      eventType:
        existingLeads.length >= maxLeads ? "lead_sourcing_skipped" : "lead_sourcing_top_up_requested",
      payload: {
        reason: existingLeads.length >= maxLeads ? "leads_already_present" : "top_up_after_seed",
        count: existingLeads.length,
        targetLeadCount: maxLeads,
        sampleOnly,
      },
    });
    if (!sampleOnly) {
      await enqueueOutreachJob({
        runId: run.id,
        jobType: "schedule_messages",
        executeAfter: nowIso(),
      });
    }
    if (existingLeads.length >= maxLeads) {
      return;
    }
  }
  const runtimeExperiment = await getExperimentRecordByRuntimeRef(run.brandId, run.campaignId, run.experimentId);
  if (
    existingLeads.length > 0 &&
    runtimeExperiment &&
    isReportCommentExperiment(runtimeExperiment)
  ) {
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_seeded_owner_preserved",
      payload: {
        count: existingLeads.length,
        reason: "report_comment_seeded_owner_leads",
      },
    });
    return;
  }
  const baseAudienceContext = buildSourcingAudienceContext({
    runtimeAudience: runtimeExperiment?.audience ?? "",
    hypothesisAudience: hypothesis.actorQuery,
    experimentNotes: activeExperiment.notes,
  });
  const brand = await getBrandById(run.brandId);
  const offerContext = runtimeExperiment?.offer?.trim() || activeExperiment.notes || hypothesis.rationale || "";
  const audienceContext = await resolveSourcingAudienceContext({
    base: baseAudienceContext,
    brandName: brand?.name ?? "",
    brandWebsite: brand?.website ?? "",
    experimentName: runtimeExperiment?.name?.trim() || activeExperiment.name,
    offer: offerContext,
    notes: [activeExperiment.notes, hypothesis.rationale, runtimeExperiment?.audience ?? ""].filter(Boolean).join(" | "),
  });
  const targetAudience = audienceContext.targetAudience;
  const triggerContext = audienceContext.triggerContext;
  const baseStartState = deriveSourcingStartState({
    targetAudience,
    triggerContext,
    offer: offerContext,
  });
  const traceBase = run.sourcingTraceSummary;
  let traceSummary: SourcingTraceSummary = {
    phase: "plan_sourcing",
    selectedActorIds: [],
    lastActorInputError: "",
    failureStep: "",
    budgetUsedUsd: 0,
  };

  const setTrace = async (patch: Partial<typeof traceSummary>) => {
    traceSummary = { ...traceSummary, ...patch };
    await updateOutreachRun(run.id, {
      sourcingTraceSummary: traceSummary,
    });
  };

  if (run.status === "queued") {
    await updateOutreachRun(run.id, { status: "sourcing", lastError: "" });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "sourcing");
    await createOutreachEvent({ runId: run.id, eventType: "run_started", payload: {} });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_requested",
      payload: {
        strategy: "exa_people_dynamic_queries",
        maxLeads,
        sampleOnly,
        startState: baseStartState,
        audienceContext,
      },
    });
    await setTrace({
      phase: "plan_sourcing",
      selectedActorIds: [],
      lastActorInputError: "",
      failureStep: "",
      budgetUsedUsd: 0,
    });
  } else if (traceBase) {
    traceSummary = {
      phase: traceBase.phase,
      selectedActorIds: [...traceBase.selectedActorIds],
      lastActorInputError: traceBase.lastActorInputError,
      failureStep: traceBase.failureStep,
      budgetUsedUsd: traceBase.budgetUsedUsd,
    };
  }

  if (!targetAudience) {
    await setTrace({ phase: "failed", failureStep: "plan_sourcing" });
    await failRunWithDiagnostics({
      run,
      reason: "Target Audience is empty for this hypothesis",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  if (!exaApiKey) {
    await setTrace({
      phase: "failed",
      failureStep: "plan_sourcing",
      lastActorInputError: "EXA_API_KEY is missing",
    });
    await failRunWithDiagnostics({
      run,
      reason: "Exa API key is missing. Set EXA_API_KEY in the deployment environment.",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  let qualityPolicy: LeadQualityPolicy;
  try {
    qualityPolicy = await generateAdaptiveLeadQualityPolicy({
      brandName: brand?.name ?? "",
      brandWebsite: brand?.website ?? "",
      targetAudience,
      offer: offerContext,
      experimentName: activeExperiment.name ?? "",
    });
  } catch (error) {
    const fallbackReason = error instanceof Error ? error.message : "quality_policy_failed";
    qualityPolicy = buildFallbackLeadQualityPolicy({
      brandWebsite: brand?.website ?? "",
      targetAudience,
      offer: offerContext,
      experimentName: activeExperiment.name ?? "",
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_quality_policy_fallback",
      payload: {
        reason: fallbackReason,
        fallbackPolicy: qualityPolicy,
      },
    });
    await setTrace({
      phase: "plan_sourcing",
      failureStep: "",
      lastActorInputError: `quality_policy_fallback:${trimText(fallbackReason, 160)}`,
    });
  }

  await setTrace({
    phase: "probe_chain",
    budgetUsedUsd: 0,
  });

  let exaSourcing: ExaPeopleSourcingResult;
  try {
    exaSourcing = await sourceLeadsFromExa({
      exaApiKey,
      dataForSeoCredentials,
      targetAudience,
      triggerContext,
      offer: offerContext,
      qualityPolicy,
      maxLeads,
      allowMissingEmail: sampleOnly,
      emailFinderApiBaseUrl: resolveEmailFinderApiBaseUrl(),
      emailFinderVerificationMode: "validatedmails",
      emailFinderValidatedMailsApiKey: String(
        process.env.EMAIL_FINDER_VALIDATEDMAILS_API_KEY ??
          process.env.ENRICHANYTHING_VALIDATEDMAILS_API_KEY ??
          process.env.VALIDATEDMAILS_API_KEY ??
          ""
      ).trim(),
      resumeState,
    });
  } catch (error) {
    await setTrace({
      phase: "failed",
      failureStep: "probe_chain",
      lastActorInputError: error instanceof Error ? error.message : "exa_sourcing_failed",
      budgetUsedUsd: 0,
    });
    await failRunWithDiagnostics({
      run,
      reason: `Exa sourcing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      eventType: "lead_sourcing_failed",
      payload: {
        targetAudience,
        triggerContext,
      },
    });
    return;
  }

  if (exaSourcing.pendingDataForSeo?.pendingDataForSeoTasks?.length) {
    const pendingCount = exaSourcing.pendingDataForSeo.pendingDataForSeoTasks.length;
    await setTrace({
      phase: "probe_chain",
      failureStep: "",
      lastActorInputError: `waiting_dataforseo:${pendingCount}`,
      budgetUsedUsd: exaSourcing.budgetUsedUsd,
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_waiting_dataforseo",
      payload: {
        pendingCount,
        nextPollSeconds: DATAFORSEO_ASYNC_REQUEUE_SECONDS,
        maxPolls: DATAFORSEO_ASYNC_MAX_POLLS,
      },
    });
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "source_leads",
      executeAfter: new Date(Date.now() + DATAFORSEO_ASYNC_REQUEUE_SECONDS * 1000).toISOString(),
      payload: {
        ...payload,
        resumeState: exaSourcing.pendingDataForSeo,
      },
    });
    await updateOutreachRun(run.id, {
      status: "sourcing",
      lastError: "",
    });
    return;
  }

  const fallbackPeopleQueries = exaSourcing.queryPlan.peopleQueries.slice(
    exaSourcing.queryPlan.directPeopleQueries.length
  );
  const firstClearoutQuery = exaSourcing.diagnostics.find((row) => row.provider === "clearout")?.query ?? "";
  const firstDataForSeoQuery = exaSourcing.diagnostics.find((row) => row.provider === "dataforseo")?.query ?? "";
  const exaSelectedChain: SourcingChainStep[] = [
    ...(exaSourcing.queryPlan.directPeopleQueries.length
      ? [
          {
            id: "exa_people_probe",
            stage: "prospect_discovery",
            actorId: "exa.people.search",
            purpose: "Probe ICP people directly from role + trigger signals",
            queryHint: exaSourcing.queryPlan.directPeopleQueries[0] ?? targetAudience,
          } satisfies SourcingChainStep,
        ]
      : []),
    ...(firstClearoutQuery
      ? [
          {
            id: "clearout_company_autocomplete",
            stage: "website_enrichment",
            actorId: "clearout.company.autocomplete",
            purpose: "Resolve company domains for candidate people",
            queryHint: firstClearoutQuery,
          } satisfies SourcingChainStep,
        ]
      : []),
    ...(firstDataForSeoQuery
      ? [
          {
            id: "dataforseo_google_organic",
            stage: "website_enrichment",
            actorId: "dataforseo.google.organic",
            purpose: "Fallback: resolve official company websites from search results",
            queryHint: firstDataForSeoQuery,
          } satisfies SourcingChainStep,
        ]
      : []),
    ...(exaSourcing.queryPlan.mode === "people_then_company" && exaSourcing.queryPlan.companyQueries.length
      ? [
          {
            id: "exa_company_search",
            stage: "prospect_discovery",
            actorId: "exa.company.search",
            purpose: "Fallback: find qualified companies to tighten people search",
            queryHint: exaSourcing.queryPlan.companyQueries[0] ?? targetAudience,
          } satisfies SourcingChainStep,
        ]
      : []),
    ...(fallbackPeopleQueries.length
      ? [
          {
            id: "exa_people_search_fallback",
            stage: "prospect_discovery",
            actorId: "exa.people.search",
            purpose: "Find ICP people at qualified fallback companies",
            queryHint: fallbackPeopleQueries[0] ?? targetAudience,
          } satisfies SourcingChainStep,
        ]
      : exaSourcing.queryPlan.mode === "people_first" &&
          exaSourcing.queryPlan.peopleQueries.length &&
          !exaSourcing.queryPlan.directPeopleQueries.length
        ? [
            {
              id: "exa_people_search",
              stage: "prospect_discovery",
              actorId: "exa.people.search",
              purpose: "Find ICP people directly from role + trigger signals",
              queryHint: exaSourcing.queryPlan.peopleQueries[0] ?? targetAudience,
            } satisfies SourcingChainStep,
          ]
        : []),
    ...(exaSourcing.emailEnrichment.attempted > 0
      ? [
          {
            id: "emailfinder_batch",
            stage: "email_discovery",
            actorId: "emailfinder.batch",
            purpose: "Resolve work emails from person name + company domain",
            queryHint: "emailfinder batch enrichment",
          } satisfies SourcingChainStep,
        ]
      : []),
  ];

  const exaDecision = await createSourcingChainDecision({
    brandId: run.brandId,
    experimentOwnerId: run.ownerId,
    runtimeCampaignId: run.campaignId,
    runtimeExperimentId: run.experimentId,
    runId: run.id,
    strategy: "exa_people_dynamic_queries",
    rationale: exaSourcing.queryPlan.rationale || "Dynamic Exa people query planning",
    budgetUsedUsd: exaSourcing.budgetUsedUsd,
    qualityPolicy,
    selectedChain: exaSelectedChain,
    probeSummary: {
      candidateCount:
        exaSourcing.queryPlan.companyQueries.length + exaSourcing.queryPlan.peopleQueries.length,
      probedCount: exaSourcing.diagnostics.length,
      budgetCapUsd: APIFY_DISCOVERY_TOTAL_BUDGET_USD,
      selectedPlanId: "exa_dynamic_people_v1",
      selectionStatus: "selected",
      mode: exaSourcing.queryPlan.mode,
      fallbackReason: exaSourcing.queryPlan.fallbackReason,
      directPeopleQueries: exaSourcing.queryPlan.directPeopleQueries,
      companyQueries: exaSourcing.queryPlan.companyQueries,
      peopleQueries: exaSourcing.queryPlan.peopleQueries,
      qualifiedCompanyNames: exaSourcing.queryPlan.qualifiedCompanyNames,
      probeMetrics: exaSourcing.queryPlan.probeMetrics,
      queryDiagnostics: exaSourcing.diagnostics,
    },
  });

  if (exaSourcing.diagnostics.length) {
    await createSourcingProbeResults(
      exaSourcing.diagnostics.map((row, index) => ({
        decisionId: exaDecision.id,
        brandId: run.brandId,
        experimentOwnerId: run.ownerId,
        runId: run.id,
        stepIndex: index,
        actorId:
          row.stage === "company"
            ? row.provider === "clearout"
              ? "clearout.company.autocomplete"
              : row.provider === "dataforseo"
                ? "dataforseo.google.organic"
              : "exa.company.search"
            : row.stage === "people"
              ? "exa.people.search"
              : "emailfinder.batch",
        stage:
          row.stage === "company"
            ? "prospect_discovery"
            : row.stage === "people"
              ? "prospect_discovery"
              : "email_discovery",
        probeInputHash: hashProbeInput({ query: row.query }),
        outcome: row.count > 0 ? "pass" : "fail",
        qualityMetrics: {
          query: row.query,
          hitCount: row.count,
          stage: row.stage,
          provider: row.provider,
          includeDomainsCount: row.includeDomainsCount,
          ...(row.lookupCompany ? { lookupCompany: row.lookupCompany } : {}),
          ...(typeof row.structuredCount === "number" ? { structuredCount: row.structuredCount } : {}),
          ...(row.userLocation ? { userLocation: row.userLocation } : {}),
        },
        costEstimateUsd:
          row.provider === "clearout"
            ? 0
            : Math.max(
                0,
                Number(row.costUsd ?? 0) ||
                  (row.provider === "dataforseo" ? dataForSeoTaskCostUsd() : 0.001)
              ),
        details: {
          strategy: "exa_people_dynamic_queries",
          query: row.query,
          hits: row.count,
          stage: row.stage,
          provider: row.provider,
          includeDomainsCount: row.includeDomainsCount,
          ...(row.lookupCompany ? { lookupCompany: row.lookupCompany } : {}),
          ...(row.lookupExamples?.length ? { lookupExamples: row.lookupExamples } : {}),
          ...(row.resolvedDomain ? { resolvedDomain: row.resolvedDomain } : {}),
          ...(row.resolutionSource ? { resolutionSource: row.resolutionSource } : {}),
          ...(typeof row.structuredCount === "number" ? { structuredCount: row.structuredCount } : {}),
          ...(typeof row.costUsd === "number" ? { costUsd: row.costUsd } : {}),
          ...(row.userLocation ? { userLocation: row.userLocation } : {}),
        },
      }))
    );
  }

  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourcing_actor_pool_built",
    payload: {
      provider: "exa",
      queryPlan: exaSourcing.queryPlan,
      diagnostics: exaSourcing.diagnostics,
      emailEnrichment: exaSourcing.emailEnrichment,
      costBreakdown: {
        totalUsd: exaSourcing.budgetUsedUsd,
        exaSpendUsd: exaSourcing.exaSpendUsd,
        exaQueryCount: exaSourcing.diagnostics.filter(
          (row) => row.provider === "exa" && row.stage !== "email_enrichment"
        ).length,
        clearoutLookupCount: exaSourcing.diagnostics.filter((row) => row.provider === "clearout").length,
        dataForSeoSpendUsd: exaSourcing.dataForSeoSpendUsd,
        dataForSeoLookupCount: exaSourcing.diagnostics.filter((row) => row.provider === "dataforseo").length,
        emailFinderAttempted: exaSourcing.emailEnrichment.attempted,
        emailFinderCostPerLookupUsd: Math.max(
          0,
          Math.min(0.1, Number(process.env.EMAIL_FINDER_LOOKUP_COST_USD ?? 0) || 0)
        ),
      },
      actorCount: exaSelectedChain.length,
      qualityPolicy,
      audienceContext,
    },
  });

  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourcing_chain_selected",
    payload: {
      decisionId: exaDecision.id,
      selectedPlanId: "exa_dynamic_people_v1",
      selectedRationale: exaSourcing.queryPlan.rationale,
      selectedChain: exaSelectedChain,
      budgetUsedUsd: exaSourcing.budgetUsedUsd,
      emailEnrichment: exaSourcing.emailEnrichment,
    },
  });

  if (!exaSourcing.acceptedLeads.length) {
    await setTrace({
      phase: "failed",
      failureStep: "execute_chain",
      lastActorInputError: "No quality leads accepted from Exa queries",
      budgetUsedUsd: exaSourcing.budgetUsedUsd,
    });
    await failRunWithDiagnostics({
      run,
      reason: "No quality leads accepted from Exa queries",
      eventType: "lead_sourcing_failed",
      payload: {
        decisionId: exaDecision.id,
        queryDiagnostics: exaSourcing.diagnostics,
        emailEnrichment: exaSourcing.emailEnrichment,
        topRejections: summarizeTopReasons(exaSourcing.rejectedLeads),
      },
    });
    return;
  }

  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourcing_completed",
    payload: {
      decisionId: exaDecision.id,
      strategy: "exa_people_dynamic_queries",
      selectedChain: exaSelectedChain,
      sourcedCount: exaSourcing.acceptedLeads.length,
      rejectedCount: exaSourcing.rejectedLeads.length,
      topRejections: summarizeTopReasons(exaSourcing.rejectedLeads),
      queryDiagnostics: exaSourcing.diagnostics,
      emailEnrichment: exaSourcing.emailEnrichment,
    },
  });

  await setTrace({
    phase: "completed",
    selectedActorIds: exaSelectedChain.map((step) => step.actorId),
    budgetUsedUsd: exaSourcing.budgetUsedUsd,
    failureStep: "",
    lastActorInputError: "",
  });

  await finishSourcingWithLeads(run, exaSourcing.acceptedLeads, {
    sampleOnly,
    allowMissingEmail: sampleOnly,
    qualityPolicy,
    rejectedDecisions: exaSourcing.rejectedLeads,
    decision: exaDecision,
    emailEnrichment: exaSourcing.emailEnrichment,
  });
  return;

  // Apify chain execution removed. Sourcing is Exa-first and fail-fast above.
}

async function finishSourcingWithLeads(
  run: NonNullable<Awaited<ReturnType<typeof getOutreachRun>>>,
  leads: ApifyLead[],
  options: {
    sampleOnly?: boolean;
    allowMissingEmail?: boolean;
    qualityPolicy?: LeadQualityPolicy;
    rejectedDecisions?: LeadAcceptanceDecision[];
    decision?: SourcingChainDecision | null;
    emailEnrichment?: ExaPeopleSourcingResult["emailEnrichment"] | null;
  } = {}
) {
  const runtimeExperiment = await getExperimentRecordByRuntimeRef(
    run.brandId,
    run.campaignId,
    run.experimentId
  );
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
    policy_rejected: 0,
    report_comment_rejected: 0,
    verification_unavailable: 0,
  };

  const filteredLeads: ApifyLead[] = [];
  const policyRejections = options.rejectedDecisions ?? [];
  const allowMissingEmail = options.allowMissingEmail === true;
  const emailEnrichmentError = String(options.emailEnrichment?.error ?? "").trim();
  const verificationUnavailable =
    Boolean(emailEnrichmentError) &&
    Number(options.emailEnrichment?.attempted ?? 0) > 0 &&
    Number(options.emailEnrichment?.matched ?? 0) === 0;
  for (const lead of leads) {
    const normalizedDomain = String(lead.domain ?? "").trim().toLowerCase();
    const normalizedRealEmail = extractFirstEmailAddress(lead.email);
    const persistenceEmail = normalizedRealEmail;
    if (!persistenceEmail) {
      if (verificationUnavailable) {
        suppressionCounts.verification_unavailable = (suppressionCounts.verification_unavailable ?? 0) + 1;
        policyRejections.push({
          email: "",
          accepted: false,
          confidence: 0,
          reason: "verification_unavailable",
          details: {
            hasName: Boolean(String(lead.name ?? "").trim()),
            hasDomain: Boolean(normalizedDomain),
            emailEnrichmentError,
          },
        });
      } else {
        suppressionCounts.invalid_email = (suppressionCounts.invalid_email ?? 0) + 1;
        policyRejections.push({
          email: "",
          accepted: false,
          confidence: 0,
          reason: "missing_email_or_domain",
          details: {
            hasName: Boolean(String(lead.name ?? "").trim()),
            hasDomain: Boolean(normalizedDomain),
          },
        });
      }
      continue;
    }
    if (normalizedRealEmail) {
      const suppressionReason = getLeadEmailSuppressionReason(normalizedRealEmail);
      if (suppressionReason) {
        suppressionCounts[suppressionReason] = (suppressionCounts[suppressionReason] ?? 0) + 1;
        continue;
      }
    }
    if (blockedEmails.has(persistenceEmail.toLowerCase())) {
      suppressionCounts.duplicate_14_day += 1;
      continue;
    }
    if (options.qualityPolicy) {
      const decision = evaluateLeadAgainstQualityPolicy({
        lead,
        policy: options.qualityPolicy,
        allowMissingEmail,
      });
      if (!decision.accepted) {
        suppressionCounts.policy_rejected += 1;
        policyRejections.push(decision);
        continue;
      }
    }
    if (runtimeExperiment) {
      const quality = assessReportCommentLeadQuality(runtimeExperiment, {
        name: lead.name,
        company: lead.company,
        title: lead.title,
        domain: normalizedDomain,
        sourceUrl: lead.sourceUrl,
        email: persistenceEmail,
      });
      if (!quality.keep) {
        suppressionCounts.report_comment_rejected += 1;
        policyRejections.push({
          email: persistenceEmail,
          accepted: false,
          confidence: 1,
          reason: quality.reason,
          details: {
            qualityProfile: "report_comment_expert_fit",
          },
        });
        continue;
      }
    }
    filteredLeads.push({
      ...lead,
      email: persistenceEmail,
      domain: normalizedDomain,
    });
  }

  if (!filteredLeads.length) {
    await failRunWithDiagnostics({
      run,
      reason: verificationUnavailable
        ? "Email verification unavailable; no leads could be verified"
        : "All sourced leads were suppressed by quality/duplicate rules",
      eventType: "lead_sourcing_failed",
      payload: {
        sourcedCount: leads.length,
        blockedCount: leads.length,
        suppressionCounts,
        topPolicyRejections: summarizeTopReasons(policyRejections),
        decisionId: options.decision?.id ?? "",
        verificationUnavailable,
        emailEnrichmentError,
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
    status: options.sampleOnly ? "completed" : "scheduled",
    lastError: "",
    completedAt: options.sampleOnly ? nowIso() : "",
    metrics: buildLiveRunMetrics({
      run,
      messages: await listRunMessages(run.id),
      threads: (await listReplyThreadsByBrand(run.brandId)).threads,
      sourcedLeads: upserted.length,
    }),
  });
  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourced",
    payload: {
      count: upserted.length,
      blockedCount: Math.max(0, leads.length - filteredLeads.length),
      suppressionCounts,
      topPolicyRejections: summarizeTopReasons(policyRejections),
      sampleOnly: options.sampleOnly === true,
      decisionId: options.decision?.id ?? "",
      verificationUnavailable,
      emailEnrichmentError,
    },
  });

  if (!options.sampleOnly) {
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "schedule_messages",
      executeAfter: nowIso(),
    });
  } else {
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "completed");
  }
}

async function processScheduleMessagesJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["paused", "completed", "canceled", "failed", "preflight_failed"].includes(run.status)) return;

  const existingMessages = await listRunMessages(run.id);

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
  const businessWindow = businessWindowFromExperimentEnvelope(runtimeExperiment?.testEnvelope);
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

    const existingConversationMessages = existingMessages;
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
        businessWindow,
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

    const totalSchedulableMessages = existingConversationMessages.filter((message) =>
      ["scheduled", "sent"].includes(message.status)
    ).length;

    if (scheduledMessagesCount === 0 && totalSchedulableMessages === 0) {
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
      eventType: scheduledMessagesCount > 0 ? "message_scheduled" : "message_scheduling_skipped",
      payload:
        scheduledMessagesCount > 0
          ? {
              count: scheduledMessagesCount,
              totalCount: totalSchedulableMessages,
              mode: "conversation_map",
            }
          : {
              reason: "messages_already_exist",
              count: totalSchedulableMessages,
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

  const { threads } = await listReplyThreadsByBrand(run.brandId);
  await updateOutreachRun(run.id, {
    status: "scheduled",
    metrics: buildLiveRunMetrics({
      run,
      messages: existingMessages,
      threads,
      sourcedLeads: leads.length,
    }),
  });
  await maybeQueueScheduledDeliverabilityProbe(run);
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

  const routingContext = await buildRunSenderRoutingContext(run);
  const {
    businessWindow,
    senderPoolState,
    healthBlockedBySenderId,
    autoPausedBySenderId,
    routingSignalsBySenderId,
    dispatchPool,
    senderUsage,
  } = routingContext;
  if (!senderPoolState.pool.length) {
    await failRunWithDiagnostics({
      run,
      reason: "No active sender accounts with delivery credentials are assigned to this brand",
      eventType: "dispatch_failed",
    });
    return;
  }
  if (!dispatchPool.length) {
    const healthBlocked = Array.from(healthBlockedBySenderId.values());
    const pausedSenders = Array.from(autoPausedBySenderId.values()).map((scorecard) => ({
      senderAccountId: scorecard.senderAccountId,
      senderAccountName: scorecard.senderAccountName,
      fromEmail: scorecard.fromEmail,
      autoPauseUntil: scorecard.autoPauseUntil,
      reason: scorecard.autoPauseReason,
      summaryText: scorecard.summaryText,
    }));
    const senderHealthSenders = healthBlocked.map((entry) => ({
      senderAccountId: entry.senderAccountId,
      senderAccountName: entry.senderAccountName,
      fromEmail: entry.fromEmail,
      blockers: formatSenderHealthIssues(entry.blockers),
      pending: formatSenderHealthIssues(entry.pending),
    }));
    const pauseSummary = summarizeSenderHealthPoolPause({
      healthBlocked,
      spamBlockedCount: autoPausedBySenderId.size,
    });
    await updateOutreachRun(run.id, {
      status: "paused",
      pauseReason: pauseSummary.summary,
      lastError: pauseSummary.summary,
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "paused");
    await createOutreachEvent({
      runId: run.id,
      eventType: "run_paused_auto",
      payload: {
        reason: pauseSummary.reason,
        summary: pauseSummary.summary,
        pausedSenders,
        senderHealthSenders,
      },
    });
    return;
  }
  let primarySender =
    routingContext.primarySender ??
    dispatchPool.find((slot) => slot.account.id === run.accountId) ??
    dispatchPool[0];
  const currentHealthBlock = healthBlockedBySenderId.get(run.accountId) ?? null;
  const currentSpamBlock = autoPausedBySenderId.get(run.accountId) ?? null;
  if ((currentHealthBlock || currentSpamBlock) && primarySender.account.id !== run.accountId) {
    const failover = await autoFailoverRunSender({
      run,
      reason: currentHealthBlock ? "sender_health_gate" : "sender_spam_risk",
      summary: currentHealthBlock
        ? "Current sender failed health checks and was replaced by the healthiest standby sender."
        : "Current sender was removed from rotation for spam risk and replaced by the healthiest standby sender.",
    });
    if (failover.nextSender) {
      primarySender = failover.nextSender;
    }
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
    mailboxAccountId === primarySender.account.id
      ? primarySender.account
      : await getOutreachAccount(mailboxAccountId);
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

  await updateOutreachRun(run.id, { status: "sending" });
  await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "sending");

  const messages = await listRunMessages(run.id);
  const leads = await listRunLeads(run.id);
  if (!isInsideBusinessWindow(new Date(), run.timezone || DEFAULT_TIMEZONE, businessWindow)) {
    const resumeAt = nextBusinessWindowCheckIso(new Date(), run.timezone || DEFAULT_TIMEZONE, businessWindow);
    await createOutreachEvent({
      runId: run.id,
      eventType: "dispatch_waiting_business_hours",
      payload: {
        timezone: run.timezone || DEFAULT_TIMEZONE,
        businessHoursEnabled: businessWindow.enabled,
        businessHoursStartHour: businessWindow.startHour,
        businessHoursEndHour: businessWindow.endHour,
        businessDays: businessWindow.days,
        resumeAt,
      },
    });
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "dispatch_messages",
      executeAfter: resumeAt,
    });
    return;
  }
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

  const ownerUsage =
    run.ownerType === "campaign"
      ? await countOwnerSentUsage({
          brandId: run.brandId,
          ownerType: "campaign",
          ownerId: run.ownerId,
          timezone: run.timezone || DEFAULT_TIMEZONE,
          currentRunId: run.id,
          currentRunMessages: messages,
        })
      : null;
  const hourlySent =
    ownerUsage?.hourlySent ??
    messages.filter(
      (message) =>
        message.status === "sent" &&
        message.sentAt &&
        toDate(message.sentAt).getTime() >= Date.now() - 60 * 60 * 1000
    ).length;
  const runDayKey = timeZoneDateKey(new Date(), run.timezone || DEFAULT_TIMEZONE);
  const dailySent =
    ownerUsage?.dailySent ??
    messages.filter(
      (message) =>
        message.status === "sent" &&
        message.sentAt &&
        timeZoneDateKey(toDate(message.sentAt), run.timezone || DEFAULT_TIMEZONE) === runDayKey
    ).length;

  const senderHourlySlots = dispatchPool.reduce((total, slot) => {
    const usage = senderUsage[slot.account.id] ?? { dailySent: 0, hourlySent: 0 };
    return total + Math.max(0, slot.policy.hourlyCap - usage.hourlySent);
  }, 0);
  const senderDailySlots = dispatchPool.reduce((total, slot) => {
    const usage = senderUsage[slot.account.id] ?? { dailySent: 0, hourlySent: 0 };
    return total + Math.max(0, slot.policy.dailyCap - usage.dailySent);
  }, 0);
  const hourlySlots =
    run.ownerType === "campaign"
      ? Math.max(0, Math.min(run.hourlyCap - hourlySent, senderHourlySlots))
      : Math.max(0, senderHourlySlots);
  const dailySlots =
    run.ownerType === "campaign"
      ? Math.max(0, Math.min(run.dailyCap - dailySent, senderDailySlots))
      : Math.max(0, senderDailySlots);
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

    const senderChoice = pickSenderForMessage({
      pool: dispatchPool,
      usage: senderUsage,
      preferredAccountId: primarySender.account.id,
      routingSignalsBySenderId,
    });
    if (!senderChoice) {
      await enqueueOutreachJob({
        runId: run.id,
        jobType: "dispatch_messages",
        executeAfter: addHours(nowIso(), 1),
      });
      return;
    }
    let account = senderChoice.slot.account;
    const secrets = senderChoice.slot.secrets;
    if (account.provider === "customerio") {
      const budgetAdmission = await admitCustomerIoProfileForSend({
        account,
        secrets,
        profileIdentifier: lead.email,
        sourceRunId: run.id,
        sourceMessageId: message.id,
      });
      account = budgetAdmission.account;
      if (!budgetAdmission.ok) {
        const pauseReason = `${budgetAdmission.reason} Next reset: ${budgetAdmission.nextBillingPeriodStart}.`;
        await updateOutreachRun(run.id, {
          status: "paused",
          pauseReason,
          lastError: pauseReason,
        });
        await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "paused");
        await createOutreachEvent({
          runId: run.id,
          eventType: "run_paused_customerio_profile_budget",
          payload: {
            reason: budgetAdmission.reason,
            accountId: account.id,
            messageId: message.id,
            email: lead.email,
            billingPeriodStart: budgetAdmission.billingPeriodStart,
            nextBillingPeriodStart: budgetAdmission.nextBillingPeriodStart,
            admittedProfiles: budgetAdmission.currentCount,
            projectedProfiles: budgetAdmission.projectedProfiles,
            remainingProfiles: budgetAdmission.remainingProfiles,
          },
        });
        return;
      }
      account = budgetAdmission.account;
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
      const sentAt = nowIso();
      const nextGenerationMeta = {
        ...message.generationMeta,
        senderAccountId: account.id,
        senderAccountName: account.name,
        senderFromEmail: getOutreachAccountFromEmail(account).trim(),
        replyToEmail,
      };
      await updateRunMessage(message.id, {
        status: "sent",
        providerMessageId: send.providerMessageId,
        sentAt,
        lastError: "",
        generationMeta: nextGenerationMeta,
      });
      await updateRunLead(lead.id, { status: "sent" });
      const usage = senderUsage[account.id] ?? { dailySent: 0, hourlySent: 0 };
      usage.dailySent += 1;
      usage.hourlySent += 1;
      senderUsage[account.id] = usage;
      await createOutreachEvent({
        runId: run.id,
        eventType: "message_sent",
        payload: {
          accountId: account.id,
          fromEmail: getOutreachAccountFromEmail(account).trim(),
          messageId: message.id,
          sourceType: message.sourceType,
          nodeId: message.nodeId,
          sessionId: message.sessionId,
        },
      });
      await maybeQueueAutomaticDeliverabilityProbe(run, {
        message: {
          ...message,
          status: "sent",
          sentAt,
          generationMeta: nextGenerationMeta,
        },
        senderAccountId: account.id,
        senderAccountName: account.name,
        senderFromEmail: getOutreachAccountFromEmail(account).trim(),
      });
    } else {
      const nextGenerationMeta = {
        ...message.generationMeta,
        senderAccountId: account.id,
        senderAccountName: account.name,
        senderFromEmail: getOutreachAccountFromEmail(account).trim(),
        replyToEmail,
      };
      await updateRunMessage(message.id, {
        status: "failed",
        lastError: send.error,
        generationMeta: nextGenerationMeta,
      });
      await createOutreachEvent({
        runId: run.id,
        eventType: "dispatch_failed",
        payload: {
          accountId: account.id,
          fromEmail: getOutreachAccountFromEmail(account).trim(),
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

  await updateOutreachRun(run.id, {
    status: "sending",
    metrics: buildLiveRunMetrics({
      run,
      messages: refreshedMessages,
      threads,
      sourcedLeads: leads.length,
    }),
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
  const replyMessages = await listReplyMessagesByRun(run.id);
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
  const businessWindow = businessWindowFromExperimentEnvelope(runtimeExperiment?.testEnvelope);
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
    const threadHistory = await buildConversationThreadHistory({
      runId: run.id,
      leadId: lead.id,
      leadEmail: lead.email,
      sessionId: session.id,
      runMessages: messages,
      replyMessages,
    });

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
      threadHistory,
      maxDepth: graph.maxDepth,
      waitMinutes:
        Math.max(0, Number(timerEdge.waitMinutes ?? 0) || 0) > 0
          ? 0
          : randomDelayMinutes(normalizeReplyTimingPolicy(graph).randomAdditionalDelayMinutes),
      businessWindow,
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
    await maybeQueueScheduledDeliverabilityProbe(run);
    const { threads } = await listReplyThreadsByBrand(run.brandId);
    await updateOutreachRun(run.id, {
      metrics: buildLiveRunMetrics({
        run,
        messages,
        threads,
        sourcedLeads: leads.length,
      }),
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

function contextualizeJobError(operation: string, phase: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error ?? "Job failed");
  const next = new Error(`${operation}:${phase}: ${message}`);
  if (error instanceof Error && typeof error.stack === "string" && error.stack.trim()) {
    const stackLines = error.stack.split("\n");
    next.stack = [`${next.name}: ${next.message}`, ...stackLines.slice(1)].join("\n");
  }
  return next;
}

async function processAnalyzeRunJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["canceled", "completed", "failed", "preflight_failed"].includes(run.status)) return;

  let phase = "refresh_deliverability";
  try {
    await maybeRefreshDeliverabilityIntelligence(run);

    phase = "load_sender_account";
    const senderAccount = await getOutreachAccount(run.accountId);
    const senderFromEmail = String(senderAccount?.config?.customerIo?.fromEmail ?? "").trim().toLowerCase();

    phase = "resolve_sender_health";
    const senderHealthState =
      senderAccount && senderAccount.status === "active" && senderFromEmail
        ? await resolveBrandSenderHealth({
            brandId: run.brandId,
            accountId: senderAccount.id,
            fromEmail: senderFromEmail,
          })
        : null;
    const senderHealthGate = senderHealthState?.gate ?? { row: null, blockers: [], pending: [] };
    if (senderHealthGate.blockers.length) {
      phase = "pause_for_sender_health";
      const failover = await autoFailoverRunSender({
        run,
        reason: "sender_health_gate",
        summary: "Current sender failed health checks and the system attempted to switch to the healthiest standby sender.",
      });
      if (failover.switched) {
        await enqueueOutreachJob({
          runId: run.id,
          jobType: "dispatch_messages",
          executeAfter: nowIso(),
        });
        return;
      }
      const pauseReason = `Auto-paused due to sender health: ${describeSenderHealthIssues(senderHealthGate.blockers)}.`;
      await updateOutreachRun(run.id, {
        status: "paused",
        pauseReason,
        lastError: pauseReason,
      });
      await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "paused");
      await createOutreachEvent({
        runId: run.id,
        eventType: "run_paused_auto",
        payload: {
          reason: "sender_health_gate",
          summary: pauseReason,
          senderAccountId: senderAccount?.id ?? run.accountId,
          fromEmail: senderHealthGate.row?.fromEmail ?? senderAccount?.config?.customerIo?.fromEmail ?? "",
          blockers: formatSenderHealthIssues(senderHealthGate.blockers),
        },
      });
      return;
    }

    phase = "load_run_state";
    const messages = await listRunMessages(run.id);
    const leads = await listRunLeads(run.id);
    const jobs = await listRunJobs(run.id, 100);
    const { threads } = await listReplyThreadsByBrand(run.brandId);
    const metrics = calculateRunMetricsFromMessages(run.id, messages, threads);
    const targetLeadCount = run.ownerType === "experiment" ? DEFAULT_EXPERIMENT_RUN_LEAD_TARGET : 0;
    const hasOpenSourceJob = jobs.some(
      (queuedJob) =>
        queuedJob.jobType === "source_leads" && ["queued", "running"].includes(queuedJob.status)
    );
    const shouldTopUpLeads =
      targetLeadCount > 0 &&
      leads.length < targetLeadCount &&
      metrics.sentMessages < targetLeadCount &&
      !hasOpenSourceJob;

    if (shouldTopUpLeads) {
      phase = "request_lead_top_up";
      await enqueueOutreachJob({
        runId: run.id,
        jobType: "source_leads",
        executeAfter: nowIso(),
        payload: {
          maxLeadsOverride: targetLeadCount,
        },
      });
      await createOutreachEvent({
        runId: run.id,
        eventType: "lead_sourcing_top_up_requested",
        payload: {
          currentLeadCount: leads.length,
          sentMessages: metrics.sentMessages,
          targetLeadCount,
        },
      });
    }

    const delivered = Math.max(1, metrics.sentMessages + metrics.bouncedMessages);
    const attempted = Math.max(1, metrics.sentMessages + metrics.failedMessages + metrics.bouncedMessages);
    const replyCount = Math.max(1, metrics.replies);

    const bounceRate = metrics.bouncedMessages / delivered;
    const providerErrorRate = metrics.failedMessages / attempted;
    const negativeReplyRate = metrics.negativeReplies / replyCount;

    let paused = false;

    if (metrics.bouncedMessages >= 5 && bounceRate > 0.05) {
      phase = "record_hard_bounce_anomaly";
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
      phase = "record_provider_error_anomaly";
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
      phase = "record_negative_reply_anomaly";
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
      phase = "pause_for_anomaly";
      await updateOutreachRun(run.id, {
        status: "paused",
        pauseReason: "Auto-paused due to anomaly",
        metrics: buildLiveRunMetrics({
          run,
          messages,
          threads,
          sourcedLeads: leads.length,
        }),
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
      if (
        targetLeadCount > 0 &&
        metrics.sentMessages < targetLeadCount &&
        (leads.length < targetLeadCount || hasOpenSourceJob)
      ) {
        phase = "wait_for_top_up";
        await updateOutreachRun(run.id, {
          status: "monitoring",
          metrics: buildLiveRunMetrics({
            run,
            messages,
            threads,
            sourcedLeads: leads.length,
          }),
        });
        await enqueueOutreachJob({
          runId: run.id,
          jobType: "analyze_run",
          executeAfter: addMinutes(nowIso(), 10),
        });
        return;
      }
      phase = "complete_run";
      await updateOutreachRun(run.id, {
        status: "completed",
        completedAt: nowIso(),
        metrics: buildLiveRunMetrics({
          run,
          messages,
          threads,
          sourcedLeads: leads.length,
        }),
      });
      await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "completed");
      return;
    }

    phase = "reschedule_analysis";
    await updateOutreachRun(run.id, {
      status: "monitoring",
      metrics: buildLiveRunMetrics({
        run,
        messages,
        threads,
        sourcedLeads: leads.length,
      }),
    });
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "analyze_run",
      executeAfter: addHours(nowIso(), 1),
    });
  } catch (error) {
    throw contextualizeJobError("analyze_run", phase, error);
  }
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
  if (job.jobType === "monitor_deliverability") {
    await processMonitorDeliverabilityJob(job);
    return;
  }
  await processAnalyzeRunJob(job);
}

export async function runOutreachTick(
  limit = 20,
  options: { includeCampaignHopper?: boolean } = {}
): Promise<{
  processed: number;
  completed: number;
  failed: number;
  campaignsEvaluated: number;
  campaignsLaunched: number;
  campaignsBlocked: number;
}> {
  const reclaimed = await reclaimStaleRunningOutreachJobs({
    staleAfterMinutes: 6,
    limit,
  });
  for (const job of reclaimed) {
    await createOutreachEvent({
      runId: job.runId,
      eventType: "job_requeued_stale",
      payload: {
        jobId: job.id,
        jobType: job.jobType,
        reason: "stale_running_job",
      },
    });
  }

  const jobs = await listDueOutreachJobs(limit);

  let processed = 0;
  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    const attempts = job.attempts + 1;
    const claimedJob = await claimQueuedOutreachJob(job.id, attempts);
    if (!claimedJob) {
      continue;
    }
    processed += 1;
    await createOutreachEvent({
      runId: claimedJob.runId,
      eventType: "job_started",
      payload: {
        jobId: claimedJob.id,
        jobType: claimedJob.jobType,
        attempt: attempts,
        maxAttempts: claimedJob.maxAttempts,
      },
    });

    try {
      await processOutreachJob(claimedJob);
      await updateOutreachJob(claimedJob.id, {
        status: "completed",
        lastError: "",
      });
      await createOutreachEvent({
        runId: claimedJob.runId,
        eventType: "job_completed",
        payload: {
          jobId: claimedJob.id,
          jobType: claimedJob.jobType,
          attempt: attempts,
        },
      });
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Job failed";
      const stack =
        error instanceof Error && typeof error.stack === "string"
          ? error.stack
              .split("\n")
              .slice(0, 12)
              .join("\n")
          : "";
      if (attempts >= claimedJob.maxAttempts) {
        await updateOutreachJob(claimedJob.id, {
          status: "failed",
          lastError: message,
        });
      } else {
        const delayMinutes = Math.min(60, attempts * 5);
        const next = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
        await updateOutreachJob(claimedJob.id, {
          status: "queued",
          executeAfter: next,
          lastError: message,
        });
      }
      await createOutreachEvent({
        runId: claimedJob.runId,
        eventType: "job_failed",
        payload: {
          jobId: claimedJob.id,
          jobType: claimedJob.jobType,
          attempt: attempts,
          maxAttempts: claimedJob.maxAttempts,
          error: message,
          stack,
          willRetry: attempts < claimedJob.maxAttempts,
        },
      });
      failed += 1;
    }
  }

  const hopper =
    options.includeCampaignHopper === false
      ? { campaignsEvaluated: 0, campaignsLaunched: 0, campaignsBlocked: 0 }
      : await ensureActiveCampaignHoppers();

  return {
    processed,
    completed,
    failed,
    campaignsEvaluated: hopper.campaignsEvaluated,
    campaignsLaunched: hopper.campaignsLaunched,
    campaignsBlocked: hopper.campaignsBlocked,
  };
}

export async function runInboxSyncTick(limit = 12): Promise<{
  brandsChecked: number;
  eligibleBrands: number;
  mailboxesSynced: number;
  importedInboxMessages: number;
  duplicateMessages: number;
  skippedMessages: number;
  failed: number;
  errors: Array<{ brandId: string; mailboxAccountId: string; error: string }>;
}> {
  const [brands, accounts] = await Promise.all([listBrands(), listOutreachAccounts()]);
  const accountById = new Map(accounts.map((account) => [account.id, account] as const));

  const candidateRows = (
    await Promise.all(
      brands.map(async (brand) => {
        const assignment = await getBrandOutreachAssignment(brand.id);
        const mailboxAccountId = String(
          assignment?.mailboxAccountId ?? assignment?.accountId ?? ""
        ).trim();
        if (!mailboxAccountId) return null;
        const account = accountById.get(mailboxAccountId);
        if (!account || !supportsAutomaticInboxSync(account)) return null;
        const secrets = await getOutreachAccountSecrets(mailboxAccountId);
        if (!secrets?.mailboxPassword.trim()) return null;
        const syncState = await getInboxSyncState(brand.id, mailboxAccountId);
        const syncedAt = Date.parse(syncState?.lastSyncedAt || syncState?.updatedAt || "");
        return {
          brandId: brand.id,
          mailboxAccountId,
          lastSyncedAtMs: Number.isFinite(syncedAt) ? syncedAt : 0,
        };
      })
    )
  )
    .filter((row): row is { brandId: string; mailboxAccountId: string; lastSyncedAtMs: number } => Boolean(row))
    .sort((left, right) => {
      if (left.lastSyncedAtMs !== right.lastSyncedAtMs) {
        return left.lastSyncedAtMs - right.lastSyncedAtMs;
      }
      if (left.brandId !== right.brandId) {
        return left.brandId.localeCompare(right.brandId);
      }
      return left.mailboxAccountId.localeCompare(right.mailboxAccountId);
    })
    .slice(0, Math.max(1, Math.min(100, Math.round(Number(limit) || 12))));

  let mailboxesSynced = 0;
  let importedInboxMessages = 0;
  let duplicateMessages = 0;
  let skippedMessages = 0;
  let failed = 0;
  const errors: Array<{ brandId: string; mailboxAccountId: string; error: string }> = [];

  for (const candidate of candidateRows) {
    const result = await syncBrandInboxMailbox({
      brandId: candidate.brandId,
      mailboxAccountId: candidate.mailboxAccountId,
      maxMessages: 25,
    });
    if (result.ok) {
      mailboxesSynced += 1;
      importedInboxMessages += result.importedCount;
      duplicateMessages += result.duplicateCount;
      skippedMessages += result.skippedCount;
      continue;
    }

    failed += 1;
    errors.push({
      brandId: candidate.brandId,
      mailboxAccountId: candidate.mailboxAccountId,
      error: result.reason,
    });
  }

  return {
    brandsChecked: brands.length,
    eligibleBrands: candidateRows.length,
    mailboxesSynced,
    importedInboxMessages,
    duplicateMessages,
    skippedMessages,
    failed,
    errors,
  };
}

export async function updateRunControl(input: {
  brandId: string;
  campaignId: string;
  runId: string;
  action: "pause" | "resume" | "cancel" | "probe_deliverability" | "resume_sender_deliverability";
  reason?: string;
  senderAccountId?: string;
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

  if (input.action === "probe_deliverability") {
    const referenceMessage = await resolveDeliverabilityProbeReferenceMessage({
      runId: run.id,
      preferScheduled: true,
    });
    if (!referenceMessage) {
      return {
        ok: false,
        reason: "No real scheduled or sent message exists for deliverability probing yet",
      };
    }
    const baselineContentHash = referenceMessage.senderFromEmail
      ? buildDeliverabilityBaselineProbe({
          brandName: "",
          senderDomain: senderDomainFromEmail(referenceMessage.senderFromEmail),
          probeToken: "control",
        }).contentHash
      : "";
    await queueDeliverabilityProbe({
      runId: run.id,
      executeAfter: nowIso(),
      force: true,
      payload: {
        stage: "send",
        manual: true,
        probeToken: generateDeliverabilityProbeToken(),
        probeVariant: "production",
        sourceMessageId: referenceMessage.id,
        sourceMessageStatus: referenceMessage.status,
        sourceType: referenceMessage.sourceType,
        nodeId: referenceMessage.nodeId,
        leadId: referenceMessage.leadId,
        contentHash: referenceMessage.contentHash,
        senderAccountId: referenceMessage.senderAccountId,
        senderAccountName: referenceMessage.senderAccountName,
        fromEmail: referenceMessage.senderFromEmail,
      },
    });
    await queueDeliverabilityProbe({
      runId: run.id,
      executeAfter: nowIso(),
      force: true,
      payload: {
        stage: "send",
        manual: true,
        probeToken: generateDeliverabilityProbeToken(),
        probeVariant: "baseline",
        sourceMessageId: referenceMessage.id,
        sourceMessageStatus: referenceMessage.status,
        sourceType: referenceMessage.sourceType,
        nodeId: referenceMessage.nodeId,
        leadId: referenceMessage.leadId,
        contentHash: baselineContentHash,
        senderAccountId: referenceMessage.senderAccountId,
        senderAccountName: referenceMessage.senderAccountName,
        fromEmail: referenceMessage.senderFromEmail,
      },
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "deliverability_probe_requested",
      payload: {
        reason: input.reason?.trim() || "Requested by user",
        sourceMessageId: referenceMessage.id,
        sourceMessageStatus: referenceMessage.status,
        sourceType: referenceMessage.sourceType,
        nodeId: referenceMessage.nodeId,
        leadId: referenceMessage.leadId,
        contentHash: referenceMessage.contentHash,
        probeVariants: ["baseline", "production"],
      },
    });
    return { ok: true, reason: "Deliverability probes queued" };
  }

  if (input.action === "resume_sender_deliverability") {
    const senderAccountId = String(input.senderAccountId ?? "").trim();
    if (!senderAccountId) {
      return { ok: false, reason: "Sender account id is required" };
    }
    const account = await getOutreachAccount(senderAccountId);
    if (!account) {
      return { ok: false, reason: "Sender account not found" };
    }
    await createOutreachEvent({
      runId: run.id,
      eventType: "sender_deliverability_resumed_manual",
      payload: {
        senderAccountId: account.id,
        senderAccountName: account.name,
        fromEmail: getOutreachAccountFromEmail(account).trim(),
        reason: input.reason?.trim() || "Manually resumed by user",
      },
    });
    return { ok: true, reason: "Sender returned to rotation" };
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

  const normalizedFrom = extractFirstEmailAddress(input.from) || input.from.trim().toLowerCase();
  const normalizedTo = extractFirstEmailAddress(input.to) || input.to.trim().toLowerCase();
  const normalizedSubject = input.subject.trim();
  const normalizedBody = input.body.trim();

  const leads = await listRunLeads(run.id);
  const lead =
    leads.find((item) => extractFirstEmailAddress(item.email) === normalizedFrom) ??
    leads.find((item) => item.email.toLowerCase() === normalizedFrom) ??
    null;
  if (!lead) {
    return { ok: false, threadId: "", draftId: "", reason: "No lead matched for reply" };
  }

  const automated = detectAutomatedReply({
    from: input.from,
    subject: normalizedSubject,
    body: normalizedBody,
  });
  if (automated.skip) {
    await createOutreachEvent({
      runId: run.id,
      eventType: "reply_auto_skipped",
      payload: {
        kind: automated.kind,
        reason: automated.reason,
        from: normalizedFrom,
        subject: normalizedSubject,
      },
    });
    return {
      ok: true,
      threadId: "",
      draftId: "",
      reason: automated.reason,
    };
  }

  const [brand, campaign] = await Promise.all([
    getBrandById(run.brandId),
    getCampaignById(run.brandId, run.campaignId),
  ]);
  const variant = campaign?.experiments.find((item) => item.id === run.experimentId) ?? null;
  const hypothesis = variant
    ? campaign?.hypotheses.find((item) => item.id === variant.hypothesisId) ?? null
    : null;
  const runtimeExperiment = await getExperimentRecordByRuntimeRef(run.brandId, run.campaignId, run.experimentId);
  const businessWindow = businessWindowFromExperimentEnvelope(runtimeExperiment?.testEnvelope);
  const parsedOffer = parseOfferAndCta(runtimeExperiment?.offer ?? "");
  const experimentOffer = parsedOffer.offer || runtimeExperiment?.offer || "";
  const experimentCta = parsedOffer.cta;
  const experimentAudience = runtimeExperiment?.audience || hypothesis?.actorQuery || "";
  const resolvedLeadName = resolveReplyLeadName({
    leadName: lead.name,
    inboundFrom: input.from,
    leadEmail: lead.email,
  });
  const replyPolicy = await evaluateReplyPolicy({
    brandName: brand?.name ?? "",
    brandWebsite: brand?.website ?? "",
    campaignName: campaign?.name ?? "",
    experimentName: variant?.name ?? "",
    experimentOffer,
    experimentAudience,
    experimentNotes: variant?.notes ?? "",
    from: input.from,
    to: input.to,
    subject: normalizedSubject,
    body: normalizedBody,
    leadName: resolvedLeadName,
    leadEmail: lead.email,
    leadCompany: lead.company ?? "",
  });

  const { threads } = await listReplyThreadsByBrand(brandId);
  let thread = findMatchingReplyThread({
    threads,
    sourceType: "outreach",
    runId: run.id,
    leadId: lead.id,
    subject: normalizedSubject,
  });

  if (!thread) {
    thread = await createReplyThread({
      brandId: run.brandId,
      campaignId: run.campaignId,
      runId: run.id,
      leadId: lead.id,
      sourceType: "outreach",
      contactEmail: lead.email,
      contactName: resolvedLeadName || lead.name,
      contactCompany: lead.company ?? "",
      subject: normalizedSubject,
      sentiment: replyPolicy.sentiment,
      intent: replyPolicy.intent,
      status: replyPolicy.closeThread ? "closed" : "new",
    });
  } else {
    const updated = await updateReplyThread(thread.id, {
      sentiment: replyPolicy.sentiment,
      intent: replyPolicy.intent,
      status: replyPolicy.closeThread ? "closed" : "open",
      lastMessageAt: nowIso(),
      contactEmail: lead.email,
      contactName: resolvedLeadName || lead.name,
      contactCompany: lead.company ?? "",
    });
    if (updated) {
      thread = updated;
    }
  }

  const inboundMessage = await createReplyMessage({
    threadId: thread.id,
    runId: run.id,
    direction: "inbound",
    from: normalizedFrom || input.from.trim(),
    to: normalizedTo || input.to.trim(),
    subject: normalizedSubject,
    body: normalizedBody,
    providerMessageId: input.providerMessageId ?? "",
  });

  let draftId = "";
  let autoBranchScheduled: { ok: boolean; reason: string; messageId: string } = {
    ok: false,
    reason: "",
    messageId: "",
  };
  const flowMap = await getPublishedConversationMapForExperiment(run.brandId, run.campaignId, run.experimentId);
  const session = flowMap ? await getConversationSessionByLead({ runId: run.id, leadId: lead.id }) : null;

  if (flowMap?.publishedRevision && session && session.state !== "completed" && session.state !== "failed") {
    const graph = flowMap.publishedGraph;
    const currentNode = conversationNodeById(graph, session.currentNodeId);
    if (currentNode) {
      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "reply_classified",
        payload: {
          intent: replyPolicy.intent,
          confidence: replyPolicy.confidence,
          action: replyPolicy.action,
          route: replyPolicy.route,
          reason: replyPolicy.reason,
          fromNodeId: currentNode.id,
        },
      });

      if (replyPolicy.action === "no_reply") {
        await updateConversationSession(session.id, {
          state: "completed",
          currentNodeId: currentNode.id,
          turnCount: session.turnCount + 1,
          lastIntent: replyPolicy.intent,
          lastConfidence: replyPolicy.confidence,
          lastNodeEnteredAt: nowIso(),
          endedReason: replyPolicy.intent === "unsubscribe" ? "unsubscribe" : "no_reply_policy",
        });
        await createConversationEvent({
          sessionId: session.id,
          runId: run.id,
          eventType: "session_completed",
          payload: {
            reason: replyPolicy.intent === "unsubscribe" ? "unsubscribe" : "no_reply_policy",
            nodeId: currentNode.id,
            route: replyPolicy.route,
          },
        });
      } else {
        const intentEdge = pickIntentEdge({
          graph,
          currentNodeId: currentNode.id,
          intent: replyPolicy.intent,
          confidence: replyPolicy.confidence,
        });
        const fallbackEdge = pickFallbackEdge(graph, currentNode.id);
        const selectedEdge = intentEdge ?? fallbackEdge;

        if (selectedEdge) {
          await createConversationEvent({
            sessionId: session.id,
            runId: run.id,
            eventType: "reply_route_selected",
            payload: {
              selectedEdgeId: selectedEdge.id,
              intent: replyPolicy.intent,
              route: replyPolicy.route,
            },
          });
        }

        if (selectedEdge) {
          const nextNode = conversationNodeById(graph, selectedEdge.toNodeId);
          if (nextNode) {
            const nextTurn = session.turnCount + 1;
            const maxDepthReached = nextTurn >= graph.maxDepth;
            const manualReviewRequired = replyPolicy.action === "manual_review";
            const shouldComplete =
              replyPolicy.intent === "unsubscribe" || nextNode.kind === "terminal" || maxDepthReached;

            if (shouldComplete) {
              await updateConversationSession(session.id, {
                state: "completed",
                currentNodeId: nextNode.id,
                turnCount: nextTurn,
                lastIntent: replyPolicy.intent,
                lastConfidence: replyPolicy.confidence,
                lastNodeEnteredAt: nowIso(),
                endedReason:
                  replyPolicy.intent === "unsubscribe"
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
                    replyPolicy.intent === "unsubscribe"
                      ? "unsubscribe"
                      : maxDepthReached
                        ? "max_depth_reached"
                        : "terminal_node",
                  nodeId: nextNode.id,
                },
              });
            } else {
              const nextState =
                nextNode.autoSend && replyPolicy.autoSendAllowed ? "active" : "waiting_manual";
              await updateConversationSession(session.id, {
                state: nextState,
                currentNodeId: nextNode.id,
                turnCount: nextTurn,
                lastIntent: replyPolicy.intent,
                lastConfidence: replyPolicy.confidence,
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

              const runMessages = await listRunMessages(run.id);
              const replyMessages = await listReplyMessagesByRun(run.id);
              const threadHistory = await buildConversationThreadHistory({
                runId: run.id,
                leadId: lead.id,
                leadEmail: lead.email,
                sessionId: session.id,
                threadId: thread.id,
                runMessages,
                replyMessages,
              });

              if (nextNode.autoSend && replyPolicy.autoSendAllowed) {
                const replyTriggeredWaitMinutes = replyTriggeredAutoSendWaitMinutes(
                  graph,
                  nextNode,
                  selectedEdge.waitMinutes
                );
                autoBranchScheduled = await scheduleConversationNodeMessage({
                  run,
                  lead: { ...lead, name: resolvedLeadName || lead.name },
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
                  intent: replyPolicy.intent,
                  intentConfidence: replyPolicy.confidence,
                  priorNodePath: [session.currentNodeId, nextNode.id],
                  threadHistory,
                  maxDepth: graph.maxDepth,
                  waitMinutes: replyTriggeredWaitMinutes,
                  businessWindow,
                  latestInboundSubject: normalizedSubject,
                  latestInboundBody: normalizedBody,
                  replyPolicy: {
                    action: replyPolicy.action,
                    route: replyPolicy.route,
                    reason: replyPolicy.reason,
                    guidance: replyPolicy.guidance,
                    prohibited: replyPolicy.prohibited,
                  },
                  existingMessages: runMessages,
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
                  lead: { ...lead, name: resolvedLeadName || lead.name },
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
                  latestInboundSubject: normalizedSubject,
                  latestInboundBody: normalizedBody,
                  intent: replyPolicy.intent,
                  intentConfidence: replyPolicy.confidence,
                  priorNodePath: [session.currentNodeId, nextNode.id],
                  threadHistory,
                  maxDepth: graph.maxDepth,
                  replyPolicy: {
                    action: replyPolicy.action,
                    route: replyPolicy.route,
                    reason: replyPolicy.reason,
                    guidance: replyPolicy.guidance,
                    prohibited: replyPolicy.prohibited,
                  },
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
                    reason: manualReviewRequired
                      ? `Manual review: ${replyPolicy.route || nextNode.title}`
                      : `Manual branch: ${nextNode.title}`,
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
                      reason: manualReviewRequired ? "reply_policy_manual_review" : "auto_send_disabled",
                    },
                  });
                }
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
        reason:
          replyPolicy.action === "no_reply"
            ? `reply_policy:${replyPolicy.route || "no_reply"}`
            : "No valid conversation branch produced a reply draft",
        intent: replyPolicy.intent,
        action: replyPolicy.action,
        route: replyPolicy.route,
      },
    });
  }

  await updateRunLead(lead.id, {
    status: replyPolicy.intent === "unsubscribe" ? "unsubscribed" : "replied",
  });

  const messages = await listRunMessages(run.id);
  const { threads: refreshedThreads } = await listReplyThreadsByBrand(run.brandId);

  await updateOutreachRun(run.id, {
    metrics: buildLiveRunMetrics({
      run,
      messages,
      threads: refreshedThreads,
    }),
  });

  await createOutreachEvent({
    runId: run.id,
    eventType: "reply_ingested",
    payload: {
      threadId: thread.id,
      intent: replyPolicy.intent,
      confidence: replyPolicy.confidence,
      action: replyPolicy.action,
      route: replyPolicy.route,
    },
  });
  if (draftId) {
    await createOutreachEvent({ runId: run.id, eventType: "reply_draft_created", payload: { draftId } });
  }

  try {
    await syncReplyThreadState({
      threadId: thread.id,
      decisionHint: replyPolicyDecisionHint(replyPolicy),
    });
  } catch (error) {
    console.error("failed_to_sync_reply_thread_state", {
      threadId: thread.id,
      error: error instanceof Error ? error.message : String(error ?? "unknown_error"),
    });
  }

  return {
    ok: true,
    threadId: thread.id,
    draftId,
    reason: "Reply ingested",
  };
}

export async function ingestBrandInboxMessage(input: {
  brandId: string;
  mailboxAccountId?: string;
  threadId?: string;
  sourceType?: ReplyThread["sourceType"];
  from: string;
  to: string;
  subject: string;
  body: string;
  providerMessageId?: string;
  contactName?: string;
  contactCompany?: string;
}): Promise<{ ok: boolean; threadId: string; draftId: string; reason: string }> {
  const brand = await getBrandById(input.brandId);
  if (!brand) {
    return { ok: false, threadId: "", draftId: "", reason: "Brand not found" };
  }
  const assignment = await getBrandOutreachAssignment(brand.id);
  const assignedMailboxAccountId = String(
    assignment?.mailboxAccountId ?? assignment?.accountId ?? ""
  ).trim();
  const requestedMailboxAccountId = input.mailboxAccountId?.trim() || "";
  if (
    requestedMailboxAccountId &&
    assignedMailboxAccountId &&
    requestedMailboxAccountId !== assignedMailboxAccountId
  ) {
    return {
      ok: false,
      threadId: "",
      draftId: "",
      reason: "Mailbox account is not assigned to this brand",
    };
  }

  const normalizedFrom = extractFirstEmailAddress(input.from) || input.from.trim().toLowerCase();
  const normalizedTo = extractFirstEmailAddress(input.to) || input.to.trim().toLowerCase();
  const normalizedSubject = input.subject.trim();
  const normalizedBody = input.body.trim();
  const contactName = input.contactName?.trim() || normalizedFrom;
  const contactCompany = input.contactCompany?.trim() || "";
  const threadSourceType = input.sourceType === "eval" ? "eval" : "mailbox";

  const automated = detectAutomatedReply({
    from: input.from,
    subject: normalizedSubject,
    body: normalizedBody,
  });
  if (automated.skip) {
    return {
      ok: true,
      threadId: "",
      draftId: "",
      reason: automated.reason,
    };
  }

  const mailbox = await resolveMailboxAccountForBrand({
    brandId: brand.id,
    preferredMailboxAccountId: assignedMailboxAccountId || requestedMailboxAccountId,
  });
  const replyPolicy = await evaluateReplyPolicy({
    brandName: brand.name,
    brandWebsite: brand.website,
    campaignName: "",
    experimentName: "",
    experimentOffer: "",
    experimentAudience: "",
    experimentNotes: "",
    from: input.from,
    to: input.to,
    subject: normalizedSubject,
    body: normalizedBody,
    leadName: contactName,
    leadEmail: normalizedFrom,
    leadCompany: contactCompany,
  });

  const { threads } = await listReplyThreadsByBrand(brand.id);
  let thread = input.threadId?.trim() ? await getReplyThread(input.threadId.trim()) : null;
  if (thread && thread.brandId !== brand.id) {
    return { ok: false, threadId: "", draftId: "", reason: "Thread/brand mismatch" };
  }
  if (!thread) {
    thread = findMatchingReplyThread({
      threads,
      sourceType: threadSourceType,
      mailboxAccountId: mailbox?.account.id || input.mailboxAccountId || "",
      contactEmail: normalizedFrom,
      subject: normalizedSubject,
    });
  }

  if (!thread) {
    thread = await createReplyThread({
      brandId: brand.id,
      sourceType: threadSourceType,
      mailboxAccountId: mailbox?.account.id || input.mailboxAccountId || "",
      contactEmail: normalizedFrom,
      contactName,
      contactCompany,
      subject: normalizedSubject,
      sentiment: replyPolicy.sentiment,
      intent: replyPolicy.intent,
      status: replyPolicy.closeThread ? "closed" : "new",
    });
  } else {
    const updated = await updateReplyThread(thread.id, {
      sourceType: threadSourceType,
      mailboxAccountId: mailbox?.account.id || thread.mailboxAccountId,
      contactEmail: normalizedFrom || thread.contactEmail,
      contactName: contactName || thread.contactName,
      contactCompany: contactCompany || thread.contactCompany,
      sentiment: replyPolicy.sentiment,
      intent: replyPolicy.intent,
      status: replyPolicy.closeThread ? "closed" : "open",
      lastMessageAt: nowIso(),
    });
    if (updated) {
      thread = updated;
    }
  }

  await createReplyMessage({
    threadId: thread.id,
    runId: "",
    direction: "inbound",
    from: normalizedFrom || input.from.trim(),
    to: normalizedTo || input.to.trim(),
    subject: normalizedSubject,
    body: normalizedBody,
    providerMessageId: input.providerMessageId ?? "",
  });

  let syncedState = null;
  try {
    syncedState = await syncReplyThreadState({
      threadId: thread.id,
    });
  } catch (error) {
    console.error("failed_to_sync_reply_thread_state", {
      threadId: thread.id,
      error: error instanceof Error ? error.message : String(error ?? "unknown_error"),
    });
  }

  let draftId = "";
  const shouldDraft =
    syncedState
      ? !["stay_silent", "respect_opt_out"].includes(syncedState.latestDecision.recommendedMove)
      : replyPolicy.action !== "no_reply" && replyPolicy.intent !== "unsubscribe";
  if (shouldDraft) {
    const draft = await generateReplyThreadDraft({ threadId: thread.id });
    draftId = draft?.id ?? "";
  }

  return {
    ok: true,
    threadId: thread.id,
    draftId,
    reason: draftId ? "Inbox message ingested and drafted" : "Inbox message ingested",
  };
}

export async function syncBrandInboxMailbox(input: {
  brandId: string;
  mailboxAccountId?: string;
  maxMessages?: number;
}): Promise<{
  ok: boolean;
  reason: string;
  mailboxAccountId: string;
  mailboxName: string;
  importedCount: number;
  duplicateCount: number;
  skippedCount: number;
  lastInboxUid: number;
  threadIds: string[];
}> {
  const brand = await getBrandById(input.brandId);
  if (!brand) {
    return {
      ok: false,
      reason: "Brand not found",
      mailboxAccountId: "",
      mailboxName: "",
      importedCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
      lastInboxUid: 0,
      threadIds: [],
    };
  }
  const assignment = await getBrandOutreachAssignment(brand.id);
  const assignedMailboxAccountId = String(
    assignment?.mailboxAccountId ?? assignment?.accountId ?? ""
  ).trim();
  const requestedMailboxAccountId = input.mailboxAccountId?.trim() || "";
  if (
    requestedMailboxAccountId &&
    assignedMailboxAccountId &&
    requestedMailboxAccountId !== assignedMailboxAccountId
  ) {
    return {
      ok: false,
      reason: "Mailbox account is not assigned to this brand",
      mailboxAccountId: requestedMailboxAccountId,
      mailboxName: "",
      importedCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
      lastInboxUid: 0,
      threadIds: [],
    };
  }

  const mailbox = await resolveMailboxAccountForBrand({
    brandId: brand.id,
    preferredMailboxAccountId: assignedMailboxAccountId || requestedMailboxAccountId,
  });
  if (!mailbox) {
    return {
      ok: false,
      reason: "Brand reply mailbox account missing or invalid",
      mailboxAccountId: "",
      mailboxName: "",
      importedCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
      lastInboxUid: 0,
      threadIds: [],
    };
  }

  const mailboxPassword = mailbox.secrets.mailboxPassword.trim();
  const mailboxHost = mailbox.account.config.mailbox.host.trim();
  const mailboxEmail = mailbox.account.config.mailbox.email.trim();
  const mailboxName = "INBOX";
  const existingSyncState = await getInboxSyncState(brand.id, mailbox.account.id);

  if (!mailboxHost || !mailboxEmail || !mailboxPassword) {
    const reason = "Mailbox polling requires an IMAP host, mailbox email, and mailbox password";
    await upsertInboxSyncState({
      brandId: brand.id,
      mailboxAccountId: mailbox.account.id,
      mailboxName,
      lastInboxUid: existingSyncState?.lastInboxUid ?? 0,
      lastError: reason,
    });
    return {
      ok: false,
      reason,
      mailboxAccountId: mailbox.account.id,
      mailboxName,
      importedCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
      lastInboxUid: existingSyncState?.lastInboxUid ?? 0,
      threadIds: [],
    };
  }

  try {
    const fetchedMessages = await listInboxMessages({
      mailbox: {
        host: mailboxHost,
        port: Number(mailbox.account.config.mailbox.port ?? 993) || 993,
        secure: mailbox.account.config.mailbox.secure !== false,
        email: mailboxEmail,
        password: mailboxPassword,
      },
      afterUid: existingSyncState?.lastInboxUid ?? 0,
      maxMessages: Math.max(1, Math.min(100, Math.round(Number(input.maxMessages ?? 25) || 25))),
      maxBodyBytes: 16_000,
    });

    let importedCount = 0;
    let duplicateCount = 0;
    let skippedCount = 0;
    let lastInboxUid = existingSyncState?.lastInboxUid ?? 0;
    const threadIds = new Set<string>();

    for (const message of fetchedMessages) {
      lastInboxUid = Math.max(lastInboxUid, message.uid);

      const providerMessageId =
        message.messageId.trim() || `imap:${mailbox.account.id}:${message.mailboxName}:${message.uid}`;
      const existing = await findReplyMessageByProviderMessageId(providerMessageId);
      if (existing) {
        duplicateCount += 1;
        continue;
      }

      const fromEmail = extractFirstEmailAddress(message.from);
      if (!fromEmail || fromEmail === mailboxEmail.toLowerCase()) {
        skippedCount += 1;
        continue;
      }

      const result = await ingestBrandInboxMessage({
        brandId: brand.id,
        mailboxAccountId: mailbox.account.id,
        from: message.from || fromEmail,
        to: message.to || mailboxEmail,
        subject: message.subject.trim() || "(No subject)",
        body: message.body.trim() || "[empty message body]",
        providerMessageId,
        contactName: extractMailboxDisplayName(message.from),
      });

      if (result.ok) {
        importedCount += 1;
        if (result.threadId) {
          threadIds.add(result.threadId);
        }
      } else {
        skippedCount += 1;
      }
    }

    await upsertInboxSyncState({
      brandId: brand.id,
      mailboxAccountId: mailbox.account.id,
      mailboxName: fetchedMessages[0]?.mailboxName || mailboxName,
      lastInboxUid,
      lastError: "",
    });

    return {
      ok: true,
      reason: importedCount
        ? `Imported ${importedCount} inbox ${importedCount === 1 ? "message" : "messages"}`
        : duplicateCount
          ? "No new inbox messages found"
          : "Inbox synced",
      mailboxAccountId: mailbox.account.id,
      mailboxName: fetchedMessages[0]?.mailboxName || mailboxName,
      importedCount,
      duplicateCount,
      skippedCount,
      lastInboxUid,
      threadIds: Array.from(threadIds),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Mailbox sync failed";
    await upsertInboxSyncState({
      brandId: brand.id,
      mailboxAccountId: mailbox.account.id,
      mailboxName,
      lastInboxUid: existingSyncState?.lastInboxUid ?? 0,
      lastError: reason,
    });
    return {
      ok: false,
      reason,
      mailboxAccountId: mailbox.account.id,
      mailboxName,
      importedCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
      lastInboxUid: existingSyncState?.lastInboxUid ?? 0,
      threadIds: [],
    };
  }
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

  const run = draft.runId ? await getOutreachRun(draft.runId) : null;

  if (!run) {
    const mailbox = await resolveMailboxAccountForBrand({
      brandId: input.brandId,
      preferredMailboxAccountId: thread.mailboxAccountId,
    });
    if (!mailbox) {
      return { ok: false, reason: "Brand reply mailbox account missing or invalid" };
    }
    if (!thread.contactEmail) {
      return { ok: false, reason: "Thread contact email is missing" };
    }

    const send = await sendReplyDraftAsEvent({
      draft,
      account: mailbox.account,
      secrets: mailbox.secrets,
      recipient: thread.contactEmail,
      replyToEmail: mailbox.account.config.mailbox.email,
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
      runId: "",
      direction: "outbound",
      from: getOutreachAccountFromEmail(mailbox.account).trim() || mailbox.account.config.mailbox.email,
      to: thread.contactEmail,
      subject: draft.subject,
      body: draft.body,
      providerMessageId: send.providerMessageId || `reply_${Date.now().toString(36)}`,
    });

    try {
      await syncReplyThreadState({ threadId: thread.id });
    } catch (error) {
      console.error("failed_to_sync_reply_thread_state", {
        threadId: thread.id,
        error: error instanceof Error ? error.message : String(error ?? "unknown_error"),
      });
    }

    return { ok: true, reason: "Reply sent" };
  }

  const mailbox = await resolveMailboxAccountForRun(run);
  if (!mailbox) {
    return { ok: false, reason: "Reply mailbox account missing or invalid" };
  }

  const deliveryAccount = await getOutreachAccount(run.accountId);
  const deliverySecrets = deliveryAccount ? await getOutreachAccountSecrets(deliveryAccount.id) : null;
  const sendAccount =
    deliveryAccount &&
    deliveryAccount.status === "active" &&
    (supportsCustomerIoDelivery(deliveryAccount) || supportsMailpoolDelivery(deliveryAccount, deliverySecrets ?? undefined))
      ? deliveryAccount
      : mailbox.account;
  const sendSecrets = sendAccount.id === mailbox.account.id ? mailbox.secrets : deliverySecrets;
  if (!sendSecrets) {
    return { ok: false, reason: "Delivery account credentials are missing" };
  }

  const leads = await listRunLeads(run.id);
  const lead = leads.find((item) => item.id === thread.leadId);
  if (!lead) {
    return { ok: false, reason: "Lead not found for thread" };
  }

  const send = await sendReplyDraftAsEvent({
    draft,
    account: sendAccount,
    secrets: sendSecrets,
    recipient: lead.email,
    replyToEmail: mailbox.account.config.mailbox.email,
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
    from: getOutreachAccountFromEmail(sendAccount).trim() || mailbox.account.config.mailbox.email,
    to: lead.email,
    subject: draft.subject,
    body: draft.body,
    providerMessageId: send.providerMessageId || `reply_${Date.now().toString(36)}`,
  });

  await createOutreachEvent({
    runId: run.id,
    eventType: "reply_draft_sent",
    payload: { draftId: draft.id },
  });

  try {
    await syncReplyThreadState({ threadId: thread.id });
  } catch (error) {
    console.error("failed_to_sync_reply_thread_state", {
      threadId: thread.id,
      error: error instanceof Error ? error.message : String(error ?? "unknown_error"),
    });
  }

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
    eventType: "lead_sourced",
    payload: { count: input.leads.length, source: "webhook" },
  });

  await enqueueOutreachJob({
    runId: run.id,
    jobType: "schedule_messages",
    executeAfter: nowIso(),
  });

  return { ok: true, reason: "Apify leads ingested" };
}
