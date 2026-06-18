import { getBrandById, listBrands } from "@/lib/factory-data";
import type {
  BrandOutreachAssignment,
  BrandRecord,
  ConversationFlowGraph,
  ScaleCampaignRecord,
} from "@/lib/factory-types";
import {
  getConversationMapByExperiment,
  getPublishedConversationMapForExperiment,
  publishConversationMap,
  upsertConversationMapDraft,
} from "@/lib/conversation-flow-data";
import {
  buildBrandWarmupPoolProspectTableConfigs,
  buildCampaignProspectTableConfig,
  ensureEnrichAnythingProspectTable,
  getEnrichAnythingProspectTableState,
  summarizeProspectTableStates,
} from "@/lib/enrichanything-live-table";
import {
  createExperimentRecord,
  createScaleCampaignRecordFromExperiment,
  ensureRuntimeForExperiment,
  ensureSenderOwnedScaleCampaignSourceExperiment,
  getExperimentRecordById,
  listScaleCampaignRecords,
  resolveScaleCampaignLane,
  updateExperimentRecord,
  updateScaleCampaignRecord,
} from "@/lib/experiment-data";
import { EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS } from "@/lib/experiment-policy";
import { countScaleCampaignSendableLeadContacts } from "@/lib/scale-campaign-prospect-import";
import {
  getBrandOutreachAssignment,
  getOutreachAccount,
  hasActiveRunJob,
  listOutreachAccounts,
  listRunMessages,
  listOwnerRuns,
  setBrandOutreachAssignment,
} from "@/lib/outreach-data";
import {
  getOutreachAccountFromEmail,
  isOutreachGmailUiLoginReady,
  supportsAnyDelivery,
} from "@/lib/outreach-account-helpers";
import { enrichBrandWithSenderHealth } from "@/lib/sender-health";
import {
  buildSenderRoutingSignalFromDomainRow,
  rankSenderRoutingSignals,
  summarizeSenderRoutingScore,
} from "@/lib/sender-routing";
import { syncCanonicalSenderFromProvisionedAccount } from "@/lib/senders";
import {
  MAX_WARMUP_CAMPAIGN_DAILY_CAP,
  laneHourlyCapForDailyCap,
  laneMinSpacingMinutesForDailyCap,
  warmupCampaignDailyCapForDay,
  warmupCampaignHourlyCapForDay,
  warmupCampaignMinSpacingMinutesForDay,
} from "@/lib/sender-capacity";
import { buildWarmupIntentPack, type WarmupIntentPack } from "@/lib/warmup-sourcing";

const DEFAULT_WARMUP_TIMEZONE = "America/Los_Angeles";
const WARMUP_PROSPECT_TABLE_ENSURE_TIMEOUT_MS = 5_000;

export type BrandSenderWarmupCampaignsResult = {
  brandId: string;
  brandName: string;
  assignedAccountIds: string[];
  removedAccountIds: string[];
  ensuredCampaignIds: string[];
  pausedCampaignIds: string[];
  reassignedCampaignIds: string[];
};

export type SenderWarmupBackfillSummary = {
  brandsChecked: number;
  brandsWithAssignments: number;
  sendersChecked: number;
  assignmentsCleaned: number;
  campaignsEnsured: number;
  campaignsPaused: number;
  campaignsReassigned: number;
  results: BrandSenderWarmupCampaignsResult[];
  errors: Array<{ brandId: string; brandName: string; error: string }>;
};

export type SenderCampaignSmokeLaneReport = {
  lane: "warmup" | "outbound";
  state: "ready" | "needs_sourcing" | "dependency_misconfigured" | "blocked";
  primaryBlockedReason: string;
  campaignId: string;
  campaignName: string;
  status: string;
  sourceExperimentId: string;
  sendableLeadCount: number;
  sendableLeadTarget: number;
  sendableRunsChecked: number;
  hasPublishedConversationMap: boolean;
  tableId: string;
  tableEnabled: boolean;
  tableRowCount: number;
  tableLastStatus: string;
  tableLastError: string;
  tableLastRunAt: string;
  tableError: string;
  latestRunId: string;
  latestRunStatus: string;
  latestRunPauseReason: string;
  latestRunError: string;
  activeExecutionRunId: string;
  activeExecutionRunStatus: string;
  activeExecutionRunPauseReason: string;
  activeExecutionRunError: string;
  activeExecutionScheduledMessages: number;
  activeExecutionSentMessages: number;
  activeExecutionHasActiveDispatch: boolean;
  blockers: string[];
};

export type SenderSmokeReport = {
  accountId: string;
  fromEmail: string;
  selectedBrandId: string;
  selectedBrandName: string;
  assignmentAccountIds: string[];
  readyToSend: boolean;
  transportState: "ready" | "blocked";
  transportBlockedReason: string;
  warmupCampaignCount: number;
  outboundCampaignCount: number;
  warmup: SenderCampaignSmokeLaneReport | null;
  outbound: SenderCampaignSmokeLaneReport | null;
  issues: string[];
};

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isUsableWarmupSenderAccount(account: Awaited<ReturnType<typeof listOutreachAccounts>>[number] | null | undefined) {
  const hasUsableReplyMailbox =
    account?.config.mailbox.deliveryMethod === "gmail_ui"
      ? isOutreachGmailUiLoginReady(account)
      : account?.config.mailbox.status === "connected";
  const customerIoProvisioningComplete =
    account?.provider !== "customerio" ||
    Boolean(account.config.customerIo.siteId.trim() && account.config.customerIo.workspaceId.trim());
  return Boolean(
    account &&
      account.status === "active" &&
      account.accountType !== "mailbox" &&
      account.config.mailpool.status !== "deleted" &&
      account.config.mailbox.status !== "disconnected" &&
      hasUsableReplyMailbox &&
      customerIoProvisioningComplete &&
      supportsAnyDelivery(account)
  );
}

function warmupAutoRepairLimit() {
  const parsed = Number(process.env.WARMUP_ASSIGNMENT_AUTO_REPAIR_LIMIT ?? 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(5, Math.round(parsed)));
}

function selectHealthyWarmupSenderAccountIds(input: {
  brand: BrandRecord;
  accountById: Map<string, Awaited<ReturnType<typeof listOutreachAccounts>>[number]>;
}) {
  const rankedSignals = rankSenderRoutingSignals(
    input.brand.domains
      .map((row) => buildSenderRoutingSignalFromDomainRow(row))
      .filter((row): row is NonNullable<ReturnType<typeof buildSenderRoutingSignalFromDomainRow>> => Boolean(row))
  );

  const selected: string[] = [];
  const seen = new Set<string>();
  for (const signal of rankedSignals) {
    const account = input.accountById.get(signal.senderAccountId);
    if (!isUsableWarmupSenderAccount(account)) continue;
    const score = summarizeSenderRoutingScore(signal);
    if (signal.automationStatus === "attention" || score.level === "weak") continue;
    const fromEmail = account ? getOutreachAccountFromEmail(account).trim().toLowerCase() : "";
    const dedupeKey = fromEmail || signal.senderAccountId;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    selected.push(signal.senderAccountId);
  }
  return selected;
}

function sameStringList(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

async function repairDedicatedCampaignSenderPolicies(input: {
  brandId: string;
  campaigns: ScaleCampaignRecord[];
  healthyAccountIds: string[];
}) {
  const preferredAccountId = normalizeText(input.healthyAccountIds[0]);
  if (!preferredAccountId) return [] as string[];

  const healthyAccountIdSet = new Set(input.healthyAccountIds.map((accountId) => normalizeText(accountId)).filter(Boolean));
  const repairedCampaignIds: string[] = [];

  for (const campaign of input.campaigns) {
    if (campaign.status === "archived") continue;
    const dedicatedAccountId = normalizeText(campaign.scalePolicy.accountId);
    const dedicatedMailboxAccountId = normalizeText(campaign.scalePolicy.mailboxAccountId);
    const pinnedAccountId = dedicatedAccountId || dedicatedMailboxAccountId;
    if (!pinnedAccountId || healthyAccountIdSet.has(pinnedAccountId)) continue;

    await updateScaleCampaignRecord(input.brandId, campaign.id, {
      scalePolicy: {
        ...campaign.scalePolicy,
        accountId: preferredAccountId,
        mailboxAccountId: preferredAccountId,
      },
    });
    repairedCampaignIds.push(campaign.id);
  }

  return repairedCampaignIds;
}

function dedupeWarmupSenderAccountIds(
  accountIds: string[],
  accountById: Map<string, Awaited<ReturnType<typeof listOutreachAccounts>>[number]>
) {
  const seenEmails = new Set<string>();
  const deduped: string[] = [];
  for (const accountId of accountIds) {
    const account = accountById.get(accountId);
    const fromEmail = account ? getOutreachAccountFromEmail(account).trim().toLowerCase() : "";
    const dedupeKey = fromEmail || accountId;
    if (seenEmails.has(dedupeKey)) {
      continue;
    }
    seenEmails.add(dedupeKey);
    deduped.push(accountId);
  }
  return deduped;
}

function trimText(value: unknown, maxLength: number) {
  return normalizeText(value).slice(0, maxLength).trim();
}

function firstNonEmpty(values: Array<unknown>) {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) return normalized;
  }
  return "";
}

function normalizedLowerText(value: unknown) {
  return normalizeText(value).toLowerCase();
}

function isOpenRunStatus(status: string) {
  return ["queued", "sourcing", "scheduled", "sending", "monitoring", "paused"].includes(
    normalizeText(status).toLowerCase()
  );
}

function isDependencyMisconfiguredMessage(value: unknown) {
  const normalized = normalizedLowerText(value);
  if (!normalized) return false;
  return (
    normalized.includes("enrichanything prospect tables are disabled platform-wide") ||
    normalized.includes("enrichanything_app_url is not configured") ||
    normalized.includes("failed to reach enrichanything") ||
    normalized.includes("failed to load enrichanything prospect table") ||
    normalized.includes("failed to create enrichanything live table") ||
    normalized.includes("failed to update enrichanything prospect table") ||
    normalized.includes("failed to run enrichanything prospect table") ||
    normalized.includes("missing exa api key") ||
    normalized.includes("auth required") ||
    normalized.includes("unauthorized") ||
    normalized.includes("live table not found")
  );
}

function isNeedsSourcingMessage(value: unknown) {
  const normalized = normalizedLowerText(value);
  if (!normalized) return false;
  return (
    normalized.includes("no strong matches were returned for that prompt") ||
    normalized.includes("prospect table has no rows yet") ||
    normalized.includes("no sendable leads are available yet") ||
    normalized.includes("no sendable leads are available for this launch") ||
    normalized.includes("no enrichanything-backed sendable leads are available") ||
    normalized.includes("no reusable campaign leads are available")
  );
}

function isMailboxBackingMismatchMessage(value: unknown) {
  return normalizedLowerText(value).includes("is not backed by the assigned mailbox");
}

function isResolvedWarmupMailboxMismatch(input: {
  campaign: ScaleCampaignRecord;
  sendableLeadCount: number;
  latestRunStatus: string;
  latestRunError: string;
  activeExecutionRunId: string;
}) {
  if (resolveScaleCampaignLane(input.campaign) !== "warmup") {
    return false;
  }
  if (input.sendableLeadCount <= 0) {
    return false;
  }
  if (normalizeText(input.activeExecutionRunId)) {
    return false;
  }
  if (normalizedLowerText(input.latestRunStatus) !== "preflight_failed") {
    return false;
  }
  if (!isMailboxBackingMismatchMessage(input.latestRunError)) {
    return false;
  }
  const accountId = normalizeText(input.campaign.scalePolicy.accountId);
  const mailboxAccountId = normalizeText(input.campaign.scalePolicy.mailboxAccountId);
  return Boolean(accountId && mailboxAccountId && accountId === mailboxAccountId);
}

function classifySenderCampaignLaneState(input: {
  campaignStatus: string;
  sourceExperimentPresent: boolean;
  runtimeConfigured: boolean;
  hasPublishedConversationMap: boolean;
  requiresProspectTable: boolean;
  tableError: string;
  tableEnabled: boolean;
  tableRowCount: number;
  tableLastStatus: string;
  tableLastError: string;
  sendableLeadCount: number;
  latestRunStatus: string;
  latestRunPauseReason: string;
  latestRunError: string;
}) {
  const hasStaleNeedsSourcingTableFailure =
    input.tableRowCount > 0 && isNeedsSourcingMessage(input.tableLastError);
  const latestRunMessage = firstNonEmpty([input.latestRunError, input.latestRunPauseReason]);
  const tableFailureMessage =
    input.tableLastStatus === "failed" && !hasStaleNeedsSourcingTableFailure
      ? input.tableLastError
      : "";

  if (input.campaignStatus !== "active") {
    return {
      state: "blocked" as const,
      primaryBlockedReason: `Campaign is ${input.campaignStatus}, not active.`,
    };
  }
  if (!input.sourceExperimentPresent) {
    return {
      state: "blocked" as const,
      primaryBlockedReason: "Source experiment is missing.",
    };
  }
  if (!input.runtimeConfigured) {
    return {
      state: "blocked" as const,
      primaryBlockedReason: "Source experiment runtime is missing.",
    };
  }
  if (!input.hasPublishedConversationMap) {
    return {
      state: "blocked" as const,
      primaryBlockedReason: "No published conversation map is attached to the source experiment.",
    };
  }
  if (input.sendableLeadCount > 0) {
    return {
      state: "ready" as const,
      primaryBlockedReason: "",
    };
  }
  if (input.requiresProspectTable) {
    if (input.tableError) {
      return {
        state: isDependencyMisconfiguredMessage(input.tableError)
          ? ("dependency_misconfigured" as const)
          : ("blocked" as const),
        primaryBlockedReason: input.tableError,
      };
    }
    if (!input.tableEnabled) {
      return {
        state: "dependency_misconfigured" as const,
        primaryBlockedReason: "Prospect table is disabled.",
      };
    }
    if (tableFailureMessage) {
      return {
        state: isDependencyMisconfiguredMessage(tableFailureMessage)
          ? ("dependency_misconfigured" as const)
          : isNeedsSourcingMessage(tableFailureMessage)
            ? ("needs_sourcing" as const)
            : ("blocked" as const),
        primaryBlockedReason: tableFailureMessage,
      };
    }
  }
  if (latestRunMessage && ["failed", "preflight_failed", "paused"].includes(input.latestRunStatus)) {
    return {
      state: isDependencyMisconfiguredMessage(latestRunMessage)
        ? ("dependency_misconfigured" as const)
        : isNeedsSourcingMessage(latestRunMessage)
          ? ("needs_sourcing" as const)
          : ("blocked" as const),
      primaryBlockedReason: latestRunMessage,
    };
  }
  if (input.requiresProspectTable && input.tableRowCount <= 0) {
    return {
      state: "needs_sourcing" as const,
      primaryBlockedReason: "Prospect table has no rows yet.",
    };
  }
  return {
    state: "needs_sourcing" as const,
    primaryBlockedReason: "No sendable leads are available yet.",
  };
}

function buildWarmupCampaignName(senderLabel: string) {
  return `Warmup - ${senderLabel || "Sender"}`;
}

function safeWarmupCampaignDailyCap(currentValue: unknown) {
  const current = Math.round(Number(currentValue));
  if (Number.isFinite(current) && current > 0) {
    return Math.min(current, MAX_WARMUP_CAMPAIGN_DAILY_CAP);
  }
  return warmupCampaignDailyCapForDay(1);
}

async function resolveWarmupIntentPack(
  brand: BrandRecord,
  existingCampaigns: ScaleCampaignRecord[]
): Promise<WarmupIntentPack> {
  const outboundSignals = existingCampaigns
    .filter(
      (campaign) =>
        resolveScaleCampaignLane(campaign) === "outbound" &&
        campaign.status !== "archived" &&
        (normalizeText(campaign.snapshot.offer) || normalizeText(campaign.snapshot.audience))
    )
    .sort((left, right) => {
      const byStatus = statusRank(right.status) - statusRank(left.status);
      if (byStatus !== 0) return byStatus;
      return left.updatedAt < right.updatedAt ? 1 : -1;
    })
    .slice(0, 6)
    .map((campaign) => ({
      name: campaign.name,
      offer: campaign.snapshot.offer,
      audience: campaign.snapshot.audience,
    }));

  return buildWarmupIntentPack({
    brand,
    outboundSignals,
  });
}

function buildWarmupBrandSummary(brand: BrandRecord) {
  const product = trimText(brand.product, 120);
  const market = trimText(brand.targetMarkets?.[0], 72);
  const profile = trimText(brand.idealCustomerProfiles?.[0], 96);
  const feature = trimText(brand.keyFeatures?.[0], 90);
  const benefit = trimText(brand.keyBenefits?.[0], 90);
  const notes = trimText(
    String(brand.notes ?? "").replace(/current outreach offer:[^.]+\.?/gi, " "),
    160
  );

  return (
    firstNonEmpty([
      product && market ? `${product} for ${market}` : "",
      product && profile ? `${product} for ${profile}` : "",
      product && benefit ? `${product}; ${benefit}` : "",
      product,
      feature,
      benefit,
      notes,
    ]) || trimText(brand.name, 80)
  );
}

function inferWarmupSenderPerspective(brand: BrandRecord) {
  const haystack = normalizedLowerText([
    brand.name,
    brand.product,
    brand.notes,
    ...(brand.targetMarkets ?? []),
    ...(brand.idealCustomerProfiles ?? []),
    ...(brand.keyFeatures ?? []),
  ]);
  if (haystack.includes("paint") || haystack.includes("artist") || haystack.includes("art")) {
    return "an artist or studio owner";
  }
  if (haystack.includes("founder") || haystack.includes("self-funded") || haystack.includes("operator")) {
    return "a founder or operator";
  }
  if (haystack.includes("agency")) {
    return "someone close to client work";
  }
  return "someone close to the day-to-day work";
}

function buildWarmupStartPromptTemplate(brand: BrandRecord, intentPack: WarmupIntentPack) {
  const keywordHint = intentPack.keywordHints.slice(0, 8).join(", ");
  const brandSummary = buildWarmupBrandSummary(brand);
  const senderPerspective = inferWarmupSenderPerspective(brand);
  const toneHint = trimText(brand.tone, 80);
  return [
    'Write first-touch reply-acquisition email copy for node "Warmup opener".',
    "Primary goal: earn a real reply from a legitimate business contact for a reason that would still make sense if a human sent it manually.",
    "This is reply acquisition and inbox trust building, not a fake warmup loop. Do not mention warmup.",
    brandSummary ? `Sender brand reality: {{brandName}} = ${brandSummary}.` : "",
    `Write as ${senderPerspective} from {{brandName}}, not as a generic outbound operator or copywriter.`,
    toneHint ? `Match this sender tone when it fits: ${toneHint}.` : "",
    "Treat {{company}} as the recipient company and {{leadTitle}} as the best available short description of what that company actually does.",
    "First decide why a busy, self-interested person at {{company}} might answer. If there is no credible reason, write a simple vendor, support, pricing, partnership, availability, or right-person inquiry instead of pretending deep fit.",
    "Make the reason for reaching out fit both sides and keep the intent honest. It is acceptable for the sender to ask as a buyer, operator, partner, user, or researcher only when the brand context supports that role.",
    keywordHint
      ? `You may borrow relevant brand vocabulary when it genuinely fits the situation: ${keywordHint}. Use it sparingly.`
      : "",
    "Do not force any category vocabulary into the email unless it is genuinely relevant to both sides.",
    "Do not sound like a synthetic warmup script, fake evaluation flow, category-keyword exercise, or AI-written cold pitch.",
    "Only use research, publishing, advisor, or partner framing when that is genuinely part of {{brandName}} and it fits this specific company.",
    "Never invent a random use case that clashes with {{brandName}}'s actual work.",
    "Never invent statistics, customer stories, completed work, client questions, referrals, or proof points that are not in the provided context.",
    "If the fit is indirect, ask from an internal/admin/personal-work angle instead of pretending a customer or client asked.",
    "Subject rule: use the actual content of the email as a short inquiry phrase.",
    "Never write subjects like Quick question, Quick question for {{company}}, Question for {{company}}, or anything company-name-only.",
    "Never use the word question/questions in the subject. Use inquiry, advice, fit, setup, or the concrete topic instead.",
    "Keep it short and human. No hype, fake urgency, calendar link, or unresolved placeholders.",
    "Use variables only when available: {{firstName}}, {{company}}, {{leadTitle}}, {{brandName}}, {{campaignGoal}}.",
    "Ignore generic campaign-goal wording if it conflicts with the real sender-brand and recipient-company context.",
    "Never output unresolved placeholders.",
    "End with one low-friction question.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildWarmupConversationGraph(
  brand: BrandRecord,
  intentPack: WarmupIntentPack
): ConversationFlowGraph {
  const startId = "warmup_open";
  const endId = "warmup_end";

  return {
    version: 1,
    maxDepth: 2,
    startNodeId: startId,
    nodes: [
      {
        id: startId,
        kind: "message",
        title: "Warmup opener",
        copyMode: "prompt_v1",
        promptTemplate: buildWarmupStartPromptTemplate(brand, intentPack),
        promptVersion: 3,
        promptPolicy: {
          subjectMaxWords: 8,
          bodyMaxWords: 90,
          exactlyOneCta: true,
        },
        subject: "{{leadTitle}} inquiry",
        body:
          "Hi {{firstName}},\n\nI was looking at {{company}} and the work you do around {{leadTitle}}. I had a question from the {{brandName}} side.\n\nDo you usually work with people in situations like mine, or is there someone better to ask?\n\nThanks,",
        autoSend: true,
        delayMinutes: 0,
        x: 60,
        y: 220,
      },
      {
        id: endId,
        kind: "terminal",
        title: "End",
        copyMode: "prompt_v1",
        promptTemplate: "",
        promptVersion: 1,
        promptPolicy: {
          subjectMaxWords: 0,
          bodyMaxWords: 0,
          exactlyOneCta: false,
        },
        subject: "",
        body: "",
        autoSend: false,
        delayMinutes: 0,
        x: 420,
        y: 220,
      },
    ],
    edges: [
      {
        id: "warmup_edge_interest",
        fromNodeId: startId,
        toNodeId: endId,
        trigger: "intent",
        intent: "interest",
        waitMinutes: 0,
        confidenceThreshold: 0.65,
        priority: 1,
      },
      {
        id: "warmup_edge_question",
        fromNodeId: startId,
        toNodeId: endId,
        trigger: "intent",
        intent: "question",
        waitMinutes: 0,
        confidenceThreshold: 0.6,
        priority: 2,
      },
      {
        id: "warmup_edge_objection",
        fromNodeId: startId,
        toNodeId: endId,
        trigger: "intent",
        intent: "objection",
        waitMinutes: 0,
        confidenceThreshold: 0.55,
        priority: 3,
      },
      {
        id: "warmup_edge_unsubscribe",
        fromNodeId: startId,
        toNodeId: endId,
        trigger: "intent",
        intent: "unsubscribe",
        waitMinutes: 0,
        confidenceThreshold: 0.8,
        priority: 4,
      },
      {
        id: "warmup_edge_fallback",
        fromNodeId: startId,
        toNodeId: endId,
        trigger: "fallback",
        intent: "",
        waitMinutes: 0,
        confidenceThreshold: 0,
        priority: 5,
      },
    ],
    previewLeads: [],
    previewLeadId: "",
    replyTiming: {
      minimumDelayMinutes: 40,
      randomAdditionalDelayMinutes: 20,
    },
  };
}

function senderIdForWarmupCampaign(campaign: Pick<ScaleCampaignRecord, "scalePolicy">) {
  return normalizeText(campaign.scalePolicy.accountId || campaign.scalePolicy.mailboxAccountId);
}

function isSenderOwnedCampaignForAccount(
  campaign: Pick<ScaleCampaignRecord, "scalePolicy">,
  accountId: string
) {
  return senderIdForWarmupCampaign(campaign) === normalizeText(accountId);
}

function scaleCampaignVerifiedEmailLeadTarget(campaign: Pick<ScaleCampaignRecord, "scalePolicy">) {
  const dailyCap = Math.max(1, Number(campaign.scalePolicy.dailyCap ?? 0) || 0);
  return Math.max(EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS, Math.min(500, dailyCap * 3));
}

function statusRank(status: string) {
  switch (status) {
    case "active":
      return 4;
    case "paused":
      return 3;
    case "draft":
      return 2;
    case "completed":
      return 1;
    default:
      return 0;
  }
}

function pickPreferredCampaign(campaigns: ScaleCampaignRecord[]) {
  return campaigns
    .slice()
    .sort((left, right) => {
      const byStatus = statusRank(right.status) - statusRank(left.status);
      if (byStatus !== 0) return byStatus;
      return left.updatedAt < right.updatedAt ? 1 : -1;
    })[0] ?? null;
}

async function mapSerial<T, R>(items: T[], iteratee: (item: T, index: number) => Promise<R>) {
  const results: R[] = [];
  for (const [index, item] of items.entries()) {
    results.push(await iteratee(item, index));
  }
  return results;
}

async function ensurePublishedWarmupConversationMap(input: {
  brandId: string;
  experimentId: string;
  brand: BrandRecord;
  intentPack: WarmupIntentPack;
}) {
  const sourceExperiment = await getExperimentRecordById(input.brandId, input.experimentId);
  if (!sourceExperiment) {
    throw new Error("source experiment not found");
  }

  const runtimeExperiment = await ensureRuntimeForExperiment(sourceExperiment);
  const runtime = runtimeExperiment.runtime;
  if (!runtime.campaignId || !runtime.experimentId) {
    throw new Error("warmup runtime is not configured");
  }

  const desiredGraph = buildWarmupConversationGraph(input.brand, input.intentPack);
  const existingMap = await getConversationMapByExperiment(
    input.brandId,
    runtime.campaignId,
    runtime.experimentId
  );
  const desiredSignature = JSON.stringify(desiredGraph);
  const draftMatches = existingMap ? JSON.stringify(existingMap.draftGraph) === desiredSignature : false;
  const publishedMatches = existingMap
    ? JSON.stringify(existingMap.publishedGraph) === desiredSignature
    : false;
  if (existingMap?.publishedRevision && draftMatches && publishedMatches) {
    return runtimeExperiment;
  }

  await upsertConversationMapDraft({
    brandId: input.brandId,
    campaignId: runtime.campaignId,
    experimentId: runtime.experimentId,
    name: "Sender Warmup Flow",
    draftGraph: desiredGraph,
  });

  await publishConversationMap({
    brandId: input.brandId,
    campaignId: runtime.campaignId,
    experimentId: runtime.experimentId,
  });

  return (await getExperimentRecordById(input.brandId, runtimeExperiment.id)) ?? runtimeExperiment;
}

async function ensureWarmupProspectTable(campaign: ScaleCampaignRecord) {
  try {
    const configs = buildBrandWarmupPoolProspectTableConfigs(campaign);
    await Promise.all(
      configs.map((config) =>
        ensureEnrichAnythingProspectTable(config, {
          timeoutMs: WARMUP_PROSPECT_TABLE_ENSURE_TIMEOUT_MS,
        }).catch(() => null)
      )
    );
  } catch {
    // Best effort only. Background prep will retry when tables are available.
  }
}

async function archiveWarmupCampaignDuplicates(input: {
  brandId: string;
  preservedCampaignId: string;
  duplicateCampaigns: ScaleCampaignRecord[];
}) {
  for (const duplicate of input.duplicateCampaigns) {
    if (duplicate.id === input.preservedCampaignId || duplicate.status === "archived") {
      continue;
    }
    await updateScaleCampaignRecord(input.brandId, duplicate.id, { status: "archived" });
  }
}

async function ensureSingleSenderWarmupCampaign(input: {
  brand: BrandRecord;
  accountId: string;
  existingCampaigns: ScaleCampaignRecord[];
}) {
  const account = await getOutreachAccount(input.accountId);
  if (!account) {
    throw new Error(`warmup sender account not found: ${input.accountId}`);
  }

  const fromEmail = normalizeText(getOutreachAccountFromEmail(account)).toLowerCase();
  const senderLabel = fromEmail || normalizeText(account.name) || input.accountId;
  const campaignName = buildWarmupCampaignName(senderLabel);
  const warmupIntent = await resolveWarmupIntentPack(input.brand, input.existingCampaigns);
  const defaultOffer = warmupIntent.offerText;
  const defaultAudience = warmupIntent.audienceText;
  // Warmup has to send from and receive into the same inbox, otherwise the
  // sender account never accumulates the real reply history the lane is meant
  // to build.
  const mailboxAccountId = input.accountId;

  const matchingCampaigns = input.existingCampaigns
    .filter(
      (campaign) =>
        resolveScaleCampaignLane(campaign) === "warmup" &&
        senderIdForWarmupCampaign(campaign) === input.accountId &&
        campaign.status !== "archived"
    )
    .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
  const existingCampaign =
    matchingCampaigns[0] ??
    null;
  const duplicateCampaigns = matchingCampaigns.slice(1);

  if (existingCampaign) {
    let campaign = existingCampaign;
    let sourceExperiment = await getExperimentRecordById(input.brand.id, existingCampaign.sourceExperimentId);

    try {
      const isolated = await ensureSenderOwnedScaleCampaignSourceExperiment({
        brandId: input.brand.id,
        campaignId: existingCampaign.id,
      });
      campaign = isolated.campaign;
      sourceExperiment = isolated.sourceExperiment;
    } catch {
      // Fall through to fresh provisioning below if the legacy warmup campaign is broken.
    }

    if (sourceExperiment) {
      const experimentPatch: {
        name?: string;
        offer?: string;
        audience?: string;
      } = {};
      if (normalizeText(sourceExperiment.name) !== normalizeText(campaignName)) {
        experimentPatch.name = campaignName;
      }
      if (normalizeText(sourceExperiment.offer) !== normalizeText(defaultOffer)) {
        experimentPatch.offer = defaultOffer;
      }
      if (normalizeText(sourceExperiment.audience) !== normalizeText(defaultAudience)) {
        experimentPatch.audience = defaultAudience;
      }
      if (Object.keys(experimentPatch).length) {
        sourceExperiment =
          (await updateExperimentRecord(input.brand.id, sourceExperiment.id, experimentPatch)) ??
          sourceExperiment;
      }

      await ensurePublishedWarmupConversationMap({
        brandId: input.brand.id,
        experimentId: sourceExperiment.id,
        brand: input.brand,
        intentPack: warmupIntent,
      });

      const safeDailyCap = safeWarmupCampaignDailyCap(campaign.scalePolicy.dailyCap);
      const safeBusinessHours = 8;
      const nextCampaign =
        (await updateScaleCampaignRecord(input.brand.id, campaign.id, {
          name: campaignName,
          status: "active",
          snapshot: {
            offer: sourceExperiment.offer,
            audience: sourceExperiment.audience,
            mapId: sourceExperiment.messageFlow.mapId,
            publishedRevision: sourceExperiment.messageFlow.publishedRevision,
          },
          scalePolicy: {
            ...campaign.scalePolicy,
            dailyCap: safeDailyCap,
            hourlyCap: laneHourlyCapForDailyCap(safeDailyCap, safeBusinessHours),
            minSpacingMinutes: laneMinSpacingMinutesForDailyCap(safeDailyCap, safeBusinessHours),
            accountId: input.accountId,
            mailboxAccountId,
            lane: "warmup",
          },
        })) ?? campaign;

      await ensureWarmupProspectTable(nextCampaign);
      await archiveWarmupCampaignDuplicates({
        brandId: input.brand.id,
        preservedCampaignId: nextCampaign.id,
        duplicateCampaigns,
      });
      return nextCampaign;
    }
  }

  const createdExperiment = await createExperimentRecord({
    brandId: input.brand.id,
    name: campaignName,
    offer: defaultOffer,
    audience: defaultAudience,
  });
  await ensurePublishedWarmupConversationMap({
    brandId: input.brand.id,
    experimentId: createdExperiment.id,
    brand: input.brand,
    intentPack: warmupIntent,
  });

  const hydratedExperiment =
    (await getExperimentRecordById(input.brand.id, createdExperiment.id)) ?? createdExperiment;
  const campaign = await createScaleCampaignRecordFromExperiment({
    brandId: input.brand.id,
    experimentId: hydratedExperiment.id,
    campaignName,
    status: "active",
    lane: "warmup",
    scalePolicy: {
      dailyCap: warmupCampaignDailyCapForDay(1),
      hourlyCap: warmupCampaignHourlyCapForDay(1, 8),
      timezone: DEFAULT_WARMUP_TIMEZONE,
      minSpacingMinutes: warmupCampaignMinSpacingMinutesForDay(1, 8),
      accountId: input.accountId,
      mailboxAccountId,
      lane: "warmup",
      safetyMode: "strict",
    },
  });

  await ensureWarmupProspectTable(campaign);
  await archiveWarmupCampaignDuplicates({
    brandId: input.brand.id,
    preservedCampaignId: campaign.id,
    duplicateCampaigns: matchingCampaigns,
  });
  return campaign;
}

export async function ensureBrandSenderWarmupCampaigns(input: {
  brandId: string;
  accountIds: string[];
}) {
  const brand = await getBrandById(input.brandId);
  if (!brand) {
    throw new Error("brand not found");
  }

  const accountIds = Array.from(
    new Set(input.accountIds.map((entry) => normalizeText(entry)).filter(Boolean))
  );
  const existingCampaigns = await listScaleCampaignRecords(input.brandId);
  const activeSenderIds = new Set(accountIds);
  const pausedCampaignIds: string[] = [];
  for (const campaign of existingCampaigns) {
    const senderId = senderIdForWarmupCampaign(campaign);
    if (resolveScaleCampaignLane(campaign) !== "warmup" || !senderId || activeSenderIds.has(senderId)) {
      continue;
    }
    if (campaign.status === "active" || campaign.status === "draft") {
      await updateScaleCampaignRecord(input.brandId, campaign.id, { status: "paused" });
      pausedCampaignIds.push(campaign.id);
    }
  }

  const ensured: ScaleCampaignRecord[] = [];
  for (const accountId of accountIds) {
    ensured.push(
      await ensureSingleSenderWarmupCampaign({
        brand,
        accountId,
        existingCampaigns,
      })
    );
  }
  return {
    brandId: brand.id,
    brandName: brand.name,
    assignedAccountIds: accountIds,
    removedAccountIds: [],
    ensuredCampaignIds: ensured.map((campaign) => campaign.id),
    pausedCampaignIds,
    reassignedCampaignIds: [],
  } satisfies BrandSenderWarmupCampaignsResult;
}

export async function setBrandOutreachAssignmentWithWarmup(
  brandId: string,
  input: { accountId?: string; accountIds?: string[]; mailboxAccountId?: string } | string
): Promise<BrandOutreachAssignment | null> {
  const normalizedInput =
    typeof input === "string"
      ? { accountId: input, accountIds: [input] }
      : Array.isArray(input.accountIds)
        ? input
        : input.accountId
          ? { ...input, accountIds: [input.accountId] }
          : input;
  const assignment = await setBrandOutreachAssignment(brandId, normalizedInput);
  if (!assignment) {
    return null;
  }

  await Promise.all(
    assignment.accountIds.map((accountId) =>
      syncCanonicalSenderFromProvisionedAccount({
        brandId,
        accountId,
        mailboxAccountId: assignment.mailboxAccountId || accountId,
      }).catch(() => null)
    )
  );

  await ensureBrandSenderWarmupCampaigns({
    brandId,
    accountIds: assignment.accountIds,
  });

  return assignment;
}

export async function reconcileAssignedSenderWarmupCampaigns(input: {
  brandId?: string;
} = {}): Promise<SenderWarmupBackfillSummary> {
  const brands = input.brandId
    ? [await getBrandById(input.brandId, { includeEmbedded: true })].filter(
        (brand): brand is BrandRecord => Boolean(brand)
      )
    : await listBrands();
  const accounts = await listOutreachAccounts();
  const accountById = new Map(accounts.map((account) => [account.id, account] as const));
  const results: BrandSenderWarmupCampaignsResult[] = [];
  const errors: Array<{ brandId: string; brandName: string; error: string }> = [];
  let assignmentsCleaned = 0;

  for (const brand of brands) {
    try {
      const assignment = await getBrandOutreachAssignment(brand.id);
      const healthEnrichedBrand = await enrichBrandWithSenderHealth(brand).catch(() => brand);
      const healthyWarmupAccountIds = selectHealthyWarmupSenderAccountIds({
        brand: healthEnrichedBrand,
        accountById,
      });
      const healthyWarmupAccountIdSet = new Set(healthyWarmupAccountIds);
      const assignedAccountIds = Array.from(
        new Set(
          [
            assignment?.accountId ?? "",
            ...(assignment?.accountIds ?? []),
          ]
            .map((entry) => normalizeText(entry))
            .filter(Boolean)
        )
      );
      const healthyAssignedAccountIds = assignedAccountIds.filter((accountId) =>
        healthyWarmupAccountIdSet.has(accountId)
      );
      const repairFallbackAccountIds = healthyWarmupAccountIds.slice(0, warmupAutoRepairLimit());
      const usableExistingAssignedAccountIds = assignedAccountIds.filter((accountId) =>
        isUsableWarmupSenderAccount(accountById.get(accountId))
      );
      const preferredAccountIds =
        healthyAssignedAccountIds.length > 0
          ? healthyAssignedAccountIds
          : usableExistingAssignedAccountIds.length > 0
            ? usableExistingAssignedAccountIds
            : repairFallbackAccountIds;
      const usableAssignedAccountIds = dedupeWarmupSenderAccountIds(
        preferredAccountIds.filter((accountId) => isUsableWarmupSenderAccount(accountById.get(accountId))),
        accountById
      );
      const removedAccountIds = assignedAccountIds.filter((accountId) => !usableAssignedAccountIds.includes(accountId));
      const existingCampaigns = await listScaleCampaignRecords(brand.id);

      if (assignedAccountIds.length > 0 && !sameStringList(assignedAccountIds, usableAssignedAccountIds)) {
        const preservedMailboxAccountId = normalizeText(assignment?.mailboxAccountId);
        await setBrandOutreachAssignment(brand.id, {
          accountId: usableAssignedAccountIds[0] ?? "",
          accountIds: usableAssignedAccountIds,
          mailboxAccountId: usableAssignedAccountIds.includes(preservedMailboxAccountId)
            ? preservedMailboxAccountId
            : usableAssignedAccountIds[0] ?? "",
        });
        assignmentsCleaned += 1;
      }

      const reassignedCampaignIds = await repairDedicatedCampaignSenderPolicies({
        brandId: brand.id,
        campaigns: existingCampaigns,
        healthyAccountIds: usableAssignedAccountIds,
      });

      const ensured = await ensureBrandSenderWarmupCampaigns({
        brandId: brand.id,
        accountIds: usableAssignedAccountIds,
      });
      results.push({
        ...ensured,
        removedAccountIds,
        reassignedCampaignIds,
      });
    } catch (error) {
      errors.push({
        brandId: brand.id,
        brandName: brand.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    brandsChecked: brands.length,
    brandsWithAssignments: results.filter((result) => result.assignedAccountIds.length > 0).length,
    sendersChecked: results.reduce((sum, result) => sum + result.assignedAccountIds.length, 0),
    assignmentsCleaned,
    campaignsEnsured: results.reduce((sum, result) => sum + result.ensuredCampaignIds.length, 0),
    campaignsPaused: results.reduce((sum, result) => sum + result.pausedCampaignIds.length, 0),
    campaignsReassigned: results.reduce((sum, result) => sum + result.reassignedCampaignIds.length, 0),
    results,
    errors,
  };
}

async function buildSenderCampaignSmokeLaneReport(input: {
  brandId: string;
  lane: "warmup" | "outbound";
  campaign: ScaleCampaignRecord;
}): Promise<SenderCampaignSmokeLaneReport> {
  const sendableSummary = await countScaleCampaignSendableLeadContacts(
    input.brandId,
    input.campaign.id
  );
  const sourceExperiment = await getExperimentRecordById(
    input.brandId,
    input.campaign.sourceExperimentId
  );
  const runtimeCampaignId = normalizeText(sourceExperiment?.runtime.campaignId);
  const runtimeExperimentId = normalizeText(sourceExperiment?.runtime.experimentId);

  let hasPublishedConversationMap = false;
  if (runtimeCampaignId && runtimeExperimentId) {
    try {
      const publishedMap = await getPublishedConversationMapForExperiment(
        input.brandId,
        runtimeCampaignId,
        runtimeExperimentId
      );
      hasPublishedConversationMap = Boolean(publishedMap?.publishedRevision);
    } catch {
      hasPublishedConversationMap = false;
    }
  }

  const configs =
    input.lane === "warmup"
      ? buildBrandWarmupPoolProspectTableConfigs(input.campaign)
      : [buildCampaignProspectTableConfig(input.campaign)];
  const requiresProspectTable = configs.length > 0;
  let tableEnabled = false;
  let tableRowCount = 0;
  let tableLastStatus = "";
  let tableLastError = "";
  let tableLastRunAt = "";
  let tableError = "";
  let tableId = "";
  try {
    if (configs.length) {
      const tableStates = await Promise.all(
        configs.map((config) => getEnrichAnythingProspectTableState(config))
      );
      const summary = summarizeProspectTableStates(tableStates);
      tableId = summary.tableIds.join(",");
      tableEnabled = summary.enabled;
      tableRowCount = summary.rowCount;
      tableLastStatus = summary.lastStatus;
      tableLastError = summary.lastError;
      tableLastRunAt = summary.lastRunAt;
    }
  } catch (error) {
    tableError = error instanceof Error ? error.message : String(error);
  }

  const runs = await listOwnerRuns(input.brandId, "campaign", input.campaign.id);
  const latestRun = runs[0] ?? null;
  const activeExecutionRun = runs.find((run) => isOpenRunStatus(run.status)) ?? null;
  let activeExecutionScheduledMessages = 0;
  let activeExecutionHasActiveDispatch = false;
  if (activeExecutionRun) {
    const [messages, hasActiveDispatchJob] = await Promise.all([
      listRunMessages(activeExecutionRun.id),
      hasActiveRunJob({
        runId: activeExecutionRun.id,
        jobType: "dispatch_messages",
      }),
    ]);
    activeExecutionScheduledMessages = messages.filter((message) => message.status === "scheduled").length;
    activeExecutionHasActiveDispatch = hasActiveDispatchJob;
  }

  const blockers: string[] = [];
  const latestRunError = latestRun?.lastError ?? "";
  const ignoreHistoricalMailboxMismatch = isResolvedWarmupMailboxMismatch({
    campaign: input.campaign,
    sendableLeadCount: sendableSummary.sendableLeadCount,
    latestRunStatus: latestRun?.status ?? "",
    latestRunError,
    activeExecutionRunId: activeExecutionRun?.id ?? "",
  });
  if (input.campaign.status !== "active") {
    blockers.push(`Campaign is ${input.campaign.status}, not active.`);
  }
  if (!sourceExperiment) {
    blockers.push("Source experiment is missing.");
  }
  if (!runtimeCampaignId || !runtimeExperimentId) {
    blockers.push("Source experiment runtime is missing.");
  }
  if (!hasPublishedConversationMap) {
    blockers.push("No published conversation map is attached to the source experiment.");
  }
  if (requiresProspectTable) {
    if (tableError) {
      blockers.push(tableError);
    } else {
      if (!tableEnabled) {
        blockers.push("Prospect table is disabled.");
      }
      if (tableRowCount <= 0) {
        blockers.push("Prospect table has no rows yet.");
      }
    }
  }
  if (sendableSummary.sendableLeadCount <= 0) {
    blockers.push("No sendable leads are available yet.");
  }
  if (
    latestRun &&
    ["failed", "preflight_failed", "paused"].includes(latestRun.status) &&
    !ignoreHistoricalMailboxMismatch
  ) {
    blockers.push(
      latestRunError.trim() ||
        latestRun.pauseReason.trim() ||
        `Latest run is ${latestRun.status}.`
    );
  }
  const activeExecutionBlockedReason =
    activeExecutionRun?.status === "paused"
      ? activeExecutionRun.lastError.trim() ||
        activeExecutionRun.pauseReason.trim() ||
        "Active send run is paused."
      : activeExecutionRun &&
          activeExecutionScheduledMessages > 0 &&
          !activeExecutionHasActiveDispatch &&
          ["scheduled", "sending", "monitoring"].includes(activeExecutionRun.status)
        ? "Active send run has scheduled messages but no dispatch job."
        : "";
  if (activeExecutionBlockedReason) {
    blockers.push(activeExecutionBlockedReason);
  }
  if (
    requiresProspectTable &&
    !(tableRowCount > 0 && isNeedsSourcingMessage(tableLastError)) &&
    tableLastStatus === "failed" &&
    tableLastError
  ) {
    blockers.push(tableLastError);
  }

  const classification = classifySenderCampaignLaneState({
    campaignStatus: input.campaign.status,
    sourceExperimentPresent: Boolean(sourceExperiment),
    runtimeConfigured: Boolean(runtimeCampaignId && runtimeExperimentId),
    hasPublishedConversationMap,
    requiresProspectTable,
    tableError,
    tableEnabled,
    tableRowCount,
    tableLastStatus,
    tableLastError,
    sendableLeadCount: sendableSummary.sendableLeadCount,
    latestRunStatus: latestRun?.status ?? "",
    latestRunPauseReason: latestRun?.pauseReason ?? "",
    latestRunError: latestRun?.lastError ?? "",
  });

  const laneState =
    activeExecutionBlockedReason && classification.state === "ready" ? "blocked" : classification.state;
  const primaryBlockedReason = classification.primaryBlockedReason || activeExecutionBlockedReason;

  return {
    lane: input.lane,
    state: laneState,
    primaryBlockedReason,
    campaignId: input.campaign.id,
    campaignName: input.campaign.name,
    status: input.campaign.status,
    sourceExperimentId: input.campaign.sourceExperimentId,
    sendableLeadCount: sendableSummary.sendableLeadCount,
    sendableLeadTarget: scaleCampaignVerifiedEmailLeadTarget(input.campaign),
    sendableRunsChecked: sendableSummary.runsChecked,
    hasPublishedConversationMap,
    tableId,
    tableEnabled,
    tableRowCount,
    tableLastStatus,
    tableLastError,
    tableLastRunAt,
    tableError,
    latestRunId: latestRun?.id ?? "",
    latestRunStatus: latestRun?.status ?? "",
    latestRunPauseReason: latestRun?.pauseReason ?? "",
    latestRunError: latestRun?.lastError ?? "",
    activeExecutionRunId: activeExecutionRun?.id ?? "",
    activeExecutionRunStatus: activeExecutionRun?.status ?? "",
    activeExecutionRunPauseReason: activeExecutionRun?.pauseReason ?? "",
    activeExecutionRunError: activeExecutionRun?.lastError ?? "",
    activeExecutionScheduledMessages,
    activeExecutionSentMessages: activeExecutionRun?.metrics.sentMessages ?? 0,
    activeExecutionHasActiveDispatch,
    blockers,
  };
}

export async function getSenderSmokeReport(input: {
  accountId?: string;
  brandId?: string;
} = {}): Promise<SenderSmokeReport> {
  const brands = input.brandId
    ? [await getBrandById(input.brandId, { includeEmbedded: true })].filter(
        (brand): brand is BrandRecord => Boolean(brand)
      )
    : await listBrands();

  let selectedBrand: BrandRecord | null = null;
  let selectedAssignment: Awaited<ReturnType<typeof getBrandOutreachAssignment>> = null;
  let selectedAccountId = normalizeText(input.accountId);

  for (const brand of brands) {
    const assignment = await getBrandOutreachAssignment(brand.id);
    const assignmentIds = Array.from(
      new Set(
        [
          assignment?.accountId ?? "",
          ...(assignment?.accountIds ?? []),
        ]
          .map((entry) => normalizeText(entry))
          .filter(Boolean)
      )
    );
    if (!assignmentIds.length) {
      continue;
    }
    if (selectedAccountId) {
      if (!assignmentIds.includes(selectedAccountId)) {
        continue;
      }
    } else {
      selectedAccountId = assignmentIds[0] ?? "";
    }
    selectedBrand = brand;
    selectedAssignment = assignment;
    break;
  }

  if (!selectedBrand || !selectedAccountId) {
    throw new Error(
      input.accountId
        ? `No brand assignment found for sender ${input.accountId}.`
        : "No assigned sender found to smoke test."
    );
  }

  const account = await getOutreachAccount(selectedAccountId);
  if (!account) {
    throw new Error(`Sender account not found: ${selectedAccountId}`);
  }

  const campaigns = await listScaleCampaignRecords(selectedBrand.id);
  const senderCampaigns = campaigns.filter(
    (campaign) =>
      campaign.status !== "archived" &&
      isSenderOwnedCampaignForAccount(campaign, selectedAccountId)
  );
  const warmupCampaigns = senderCampaigns.filter((campaign) => resolveScaleCampaignLane(campaign) === "warmup");
  const outboundCampaigns = senderCampaigns.filter((campaign) => resolveScaleCampaignLane(campaign) === "outbound");
  const warmupCampaign = pickPreferredCampaign(warmupCampaigns);
  const outboundCampaign = pickPreferredCampaign(outboundCampaigns);
  const warmup = warmupCampaign
    ? await buildSenderCampaignSmokeLaneReport({
        brandId: selectedBrand.id,
        lane: "warmup",
        campaign: warmupCampaign,
      })
    : null;
  const outbound = outboundCampaign
    ? await buildSenderCampaignSmokeLaneReport({
        brandId: selectedBrand.id,
        lane: "outbound",
        campaign: outboundCampaign,
      })
    : null;

  const issues: string[] = [];
  const fromEmail = normalizeText(getOutreachAccountFromEmail(account)).toLowerCase();
  const readyToSend = Boolean(
    account.status === "active" &&
      (account.config.mailbox.gmailUiUserDataDir.trim() ||
        (account.config.mailbox.smtpHost.trim() && account.config.mailbox.smtpUsername.trim()))
  );
  const transportBlockedReason = readyToSend ? "" : "Sender transport is not ready to send yet.";
  if (!readyToSend) {
    issues.push(transportBlockedReason);
  }
  if (!warmup) {
    issues.push("No sender-owned warmup campaign is attached to this sender.");
  } else {
    if (warmup.primaryBlockedReason) {
      issues.push(warmup.primaryBlockedReason);
    }
    issues.push(...warmup.blockers);
  }
  if (!outbound) {
    issues.push("No sender-owned outbound campaign is attached to this sender yet.");
  } else {
    if (outbound.primaryBlockedReason) {
      issues.push(outbound.primaryBlockedReason);
    }
    issues.push(...outbound.blockers);
  }

  const dedupedIssues = Array.from(new Set(issues.filter(Boolean)));
  return {
    accountId: selectedAccountId,
    fromEmail,
    selectedBrandId: selectedBrand.id,
    selectedBrandName: selectedBrand.name,
    assignmentAccountIds: selectedAssignment?.accountIds ?? [selectedAccountId],
    readyToSend,
    transportState: readyToSend ? "ready" : "blocked",
    transportBlockedReason,
    warmupCampaignCount: warmupCampaigns.length,
    outboundCampaignCount: outboundCampaigns.length,
    warmup,
    outbound,
    issues: dedupedIssues,
  };
}
