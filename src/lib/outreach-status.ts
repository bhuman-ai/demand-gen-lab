import { getBrandById, listBrands } from "@/lib/factory-data";
import type {
  BrandOutreachAssignment,
  BrandRecord,
  CampaignPrepTask,
  CanonicalSender,
  DomainRow,
  ExperimentRecord,
  OutreachAccount,
  OutreachMessage,
  OutreachRun,
  RunAnomaly,
  ScaleCampaignRecord,
} from "@/lib/factory-types";
import {
  getBrandOutreachAssignment,
  getCampaignPrepTask,
  listDeliverabilityProbeRuns,
  listOutreachAccounts,
  listOwnerRuns,
  listRunAnomalies,
  listRunJobs,
  listRunMessages,
  type OutreachJob,
} from "@/lib/outreach-data";
import {
  listExperimentRecords,
  listScaleCampaignRecords,
  resolveScaleCampaignLane,
} from "@/lib/experiment-data";
import { countExperimentSendableLeadContacts } from "@/lib/experiment-prospect-import";
import {
  buildSenderCapacitySnapshots,
  buildSenderUsageMap,
  isWarmupCampaignName,
  type SenderCapacitySnapshot,
} from "@/lib/sender-capacity";
import { countScaleCampaignSendableLeadContacts } from "@/lib/scale-campaign-prospect-import";
import {
  classifyScaleCampaignInventoryHealth,
  type ScaleCampaignInventoryHealth,
} from "@/lib/outreach-prep-policy";
import {
  evaluateSenderReadiness,
  type SenderReadiness,
  type SenderReadinessIssue,
  type SenderReadinessIssueCode,
} from "@/lib/send-readiness";
import { getCanonicalSenderPoolForBrand } from "@/lib/senders";
import { buildSenderDeliverabilityScorecards } from "@/lib/outreach-deliverability";
import {
  getDomainDeliveryAccountId,
  getOutreachAccountFromEmail,
  getOutreachAccountReplyToEmail,
  getOutreachMailboxEmail,
} from "@/lib/outreach-account-helpers";

export type OutreachStatusSourceMode = "live_assembly";

export type OutreachBlockerDomain =
  | "sender"
  | "inventory"
  | "capacity"
  | "execution"
  | "provider"
  | "experiment"
  | "none";

export type OutreachNonSenderBlockerCode =
  | "none"
  | "inventory_empty"
  | "campaign_not_ready"
  | "no_sendable_contacts"
  | "campaign_prep_queued"
  | "campaign_prep_running"
  | "campaign_prep_failed"
  | "needs_sourcing"
  | "dependency_misconfigured"
  | "invalid_inventory"
  | "blocked"
  | "sender_throttled"
  | "daily_cap_reached"
  | "hourly_cap_reached"
  | "domain_sender_limit"
  | "deliverability_auto_paused"
  | "duplicate_open_runs"
  | "no_dispatch_job_for_due_mail"
  | "paused_active_outbound_run"
  | "stale_terminal_artifacts"
  | "provider_error_rate"
  | "deliverability_inbox_placement_failure"
  | "mailbox_disconnected"
  | "mailbox_error"
  | "no_promotable_winner"
  | "no_active_outbound_campaign"
  | "unknown";

export type OutreachBlockerCode = SenderReadinessIssueCode | OutreachNonSenderBlockerCode;

export type OutreachStatusFreshness = {
  mode: "live_assembly";
  generatedAt: string;
  sourceVersion: "phase1-v1";
  stale: false;
};

export type OutreachStatusFilters = {
  brandId: string;
  includeWarmup: boolean;
  limitBrands: number;
};

export type OutreachStatusSummary = {
  brandCount: number;
  healthyBrandCount: number;
  sendingTodayBrandCount: number;
  blockedBrandCount: number;
  dispatchableBrandCount: number;
  dueMessageCount: number;
};

export type OutreachBrandSenderSummary = {
  assignedSenderCount: number;
  readySenderCount: number;
  warmingSenderCount: number;
  restrictedSenderCount: number;
  blockedSenderCount: number;
  provisioningSenderCount: number;
  retiredSenderCount: number;
  primarySenderId: string;
  primarySenderEmail: string;
  primarySenderState: string;
};

export type OutreachBrandCampaignSummary = {
  activeOutboundCampaignCount: number;
  pausedOutboundCampaignCount: number;
  activeWarmupCampaignCount: number;
  readyOutboundCampaignCount: number;
  blockedOutboundCampaignCount: number;
  activeOutboundCampaignId: string;
  activeOutboundCampaignName: string;
};

export type OutreachBrandExperimentSummary = {
  totalExperimentCount: number;
  runningExperimentCount: number;
  readyExperimentCount: number;
  promotedExperimentCount: number;
  activeExperimentRunCount: number;
  promotionReadyCount: number;
  promotionBlocker: string;
};

export type OutreachBrandCapacitySummary = {
  dispatchableNow: boolean;
  effectiveDailyCap: number;
  effectiveHourlyCap: number;
  capacityLimiter: string;
};

export type OutreachInventorySourceKind = "campaign" | "experiment" | "warmup" | "none";

export type OutreachInventoryOwnerType = "campaign" | "experiment" | "none";

export type OutreachInventoryBlockerCode =
  | "none"
  | "inventory_empty"
  | "campaign_not_ready"
  | "no_sendable_contacts"
  | "campaign_prep_queued"
  | "campaign_prep_running"
  | "campaign_prep_failed"
  | "needs_sourcing"
  | "dependency_misconfigured"
  | "invalid_inventory"
  | "blocked"
  | "unknown";

export type OutreachInventoryPrepStatus = CampaignPrepTask["status"] | "none";
export type OutreachInventoryHealth = ScaleCampaignInventoryHealth;

export type OutreachBrandInventorySummary = {
  inventorySourceKind: OutreachInventorySourceKind;
  inventoryOwnerType: OutreachInventoryOwnerType;
  inventoryOwnerId: string;
  inventoryBridgeActive: boolean;
  inventoryHealth: OutreachInventoryHealth;
  inventoryDispatchable: boolean;
  inventoryBlockerCode: OutreachInventoryBlockerCode;
  inventoryBlockerSummary: string;
  prepTaskStatus: OutreachInventoryPrepStatus;
  prepTaskAttempt: number;
  prepTaskExecuteAfter: string;
  prepTaskUpdatedAt: string;
  prepTaskBlockerCode: CampaignPrepTask["blockerCode"] | "none";
  prepTaskSummary: string;
  prepTaskLastError: string;
  campaignOwnedSendableLeadCount: number;
  campaignOwnedRunsChecked: number;
  experimentOwnedSendableLeadCount: number;
  experimentOwnedRunsChecked: number;
};

export type OutreachBrandExecutionSummary = {
  activeOutboundRunId: string;
  activeOutboundRunStatus: string;
  openOutboundRunCount: number;
  duplicateOpenRunCount: number;
  dueMessageCount: number;
  scheduledNext24hCount: number;
  activeDispatchJobCount: number;
  activeCriticalOutboundAnomalyCount: number;
};

export type OutreachBrandStatus = {
  brandId: string;
  brandName: string;
  healthy: boolean;
  sendingToday: boolean;
  primaryBlockerDomain: OutreachBlockerDomain;
  primaryBlockerCode: OutreachBlockerCode;
  primaryBlockerSummary: string;
  recommendedNextAction: string;
  automaticAction: string;
  lastSendAt: string;
  freshness: OutreachStatusFreshness;
  senderSummary: OutreachBrandSenderSummary;
  campaignSummary: OutreachBrandCampaignSummary;
  experimentSummary: OutreachBrandExperimentSummary;
  inventorySummary: OutreachBrandInventorySummary;
  capacitySummary: OutreachBrandCapacitySummary;
  executionSummary: OutreachBrandExecutionSummary;
};

export type OutreachStatusResponse = {
  ok: true;
  generatedAt: string;
  sourceMode: "live_assembly";
  sourceVersion: "phase1-v1";
  filters: OutreachStatusFilters;
  summary: OutreachStatusSummary;
  brands: OutreachBrandStatus[];
};

type SenderStatusInfo = {
  sender: CanonicalSender;
  deliveryAccount: OutreachAccount | null;
  mailboxAccount: OutreachAccount | null;
  readiness: SenderReadiness;
  capacity: SenderCapacitySnapshot | null;
  scorecard: ReturnType<typeof buildSenderDeliverabilityScorecards>[number] | null;
};

type BrandAssemblyContext = {
  generatedAt: string;
  now: Date;
  allAccounts: OutreachAccount[];
  accountById: Map<string, OutreachAccount>;
};

const SOURCE_VERSION = "phase1-v1" as const;
const DEFAULT_LIMIT_BRANDS = 50;
const MAX_LIMIT_BRANDS = 200;
const DEFAULT_TIMEZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIONABLE_PAUSED_RUN_WINDOW_MS = DAY_MS;
const OPEN_RUN_STATUSES = new Set<OutreachRun["status"]>([
  "queued",
  "sourcing",
  "scheduled",
  "sending",
  "monitoring",
  "paused",
]);
const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

function asDate(value: string) {
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

function isOpenRunStatus(status: OutreachRun["status"]) {
  return OPEN_RUN_STATUSES.has(status);
}

function isTerminalRunStatus(status: OutreachRun["status"]) {
  return !isOpenRunStatus(status);
}

function runFreshnessMs(run: OutreachRun) {
  return Math.max(asDate(run.updatedAt || "").getTime(), asDate(run.createdAt).getTime());
}

function isActionableOpenRun(run: OutreachRun, now: Date) {
  if (!isOpenRunStatus(run.status)) return false;
  if (run.status !== "paused") return true;
  return runFreshnessMs(run) >= now.getTime() - ACTIONABLE_PAUSED_RUN_WINDOW_MS;
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function normalizeEmail(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeDomain(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function senderDomainFromEmail(value: string) {
  return normalizeEmail(value).split("@")[1] ?? "";
}

function findSenderDomainRow(
  senderRows: DomainRow[],
  input: { deliveryAccountId?: string; fromEmail?: string }
) {
  const normalizedFromEmail = normalizeEmail(input.fromEmail ?? "");
  if (normalizedFromEmail) {
    const byEmail =
      senderRows.find((row) => normalizeEmail(String(row.fromEmail ?? "")) === normalizedFromEmail) ??
      null;
    if (byEmail) return byEmail;
  }

  const deliveryAccountId = String(input.deliveryAccountId ?? "").trim();
  if (!deliveryAccountId) return null;
  return senderRows.find((row) => getDomainDeliveryAccountId(row) === deliveryAccountId) ?? null;
}

function clampLimitBrands(value: unknown) {
  const parsed = Math.round(Number(value) || DEFAULT_LIMIT_BRANDS);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT_BRANDS;
  return Math.max(1, Math.min(MAX_LIMIT_BRANDS, parsed));
}

function usesDedicatedCampaignSender(
  campaign: Pick<ScaleCampaignRecord, "scalePolicy"> | null | undefined
) {
  return Boolean(
    String(campaign?.scalePolicy.accountId ?? "").trim() ||
      String(campaign?.scalePolicy.mailboxAccountId ?? "").trim()
  );
}

function emptySendableLeadSummary() {
  return {
    sendableLeadCount: 0,
    runsChecked: 0,
  };
}

function senderStateRank(state: CanonicalSender["state"]) {
  if (state === "ready") return 6;
  if (state === "warming") return 5;
  if (state === "restricted") return 4;
  if (state === "blocked") return 3;
  if (state === "provisioning") return 2;
  return 1;
}

function senderSelectionScore(info: SenderStatusInfo) {
  const canSendNow = info.readiness.canSendNow ? 1000 : 0;
  const state = senderStateRank(info.sender.state) * 100;
  const capacity = Math.max(0, Number(info.capacity?.dailyCap ?? info.sender.dailyCap) || 0);
  return canSendNow + state + capacity;
}

function pickPrimarySender(input: {
  senderInfos: SenderStatusInfo[];
  activeRun: OutreachRun | null;
  activeCampaign: ScaleCampaignRecord | null;
  assignment: BrandOutreachAssignment | null;
}) {
  const byDeliveryAccountId = new Map(
    input.senderInfos
      .map((info) => [String(info.deliveryAccount?.id ?? info.sender.deliveryAccountId).trim(), info] as const)
      .filter(([accountId]) => Boolean(accountId))
  );
  const assignedAccountIds = unique(
    [
      input.assignment?.accountId ?? "",
      ...(input.assignment?.accountIds ?? []),
    ]
      .map((accountId) => accountId.trim())
      .filter(Boolean)
  );
  const assignedAccountIdSet = new Set(assignedAccountIds);

  if (input.activeRun?.accountId) {
    const runSender = byDeliveryAccountId.get(input.activeRun.accountId.trim()) ?? null;
    if (runSender && (!assignedAccountIdSet.size || assignedAccountIdSet.has(input.activeRun.accountId.trim()))) {
      return runSender;
    }
  }

  const assignedPrimaryAccountId = String(input.assignment?.accountId ?? "").trim();
  if (assignedPrimaryAccountId) {
    const assignmentSender = byDeliveryAccountId.get(assignedPrimaryAccountId) ?? null;
    if (assignmentSender) return assignmentSender;
  }

  const preferredCampaignAccountId = String(input.activeCampaign?.scalePolicy.accountId ?? "").trim();
  if (preferredCampaignAccountId) {
    const campaignSender = byDeliveryAccountId.get(preferredCampaignAccountId) ?? null;
    if (campaignSender && (!assignedAccountIdSet.size || assignedAccountIdSet.has(preferredCampaignAccountId))) {
      return campaignSender;
    }
  }

  return (
    [...input.senderInfos].sort((left, right) => {
      const scoreDiff = senderSelectionScore(right) - senderSelectionScore(left);
      if (scoreDiff !== 0) return scoreDiff;
      return left.sender.fromEmail.localeCompare(right.sender.fromEmail);
    })[0] ?? null
  );
}

function freshness(generatedAt: string): OutreachStatusFreshness {
  return {
    mode: "live_assembly",
    generatedAt,
    sourceVersion: SOURCE_VERSION,
    stale: false,
  };
}

function brandSummaryFromState(state: CanonicalSender["state"]) {
  return {
    ready: state === "ready" ? 1 : 0,
    warming: state === "warming" ? 1 : 0,
    restricted: state === "restricted" ? 1 : 0,
    blocked: state === "blocked" ? 1 : 0,
    provisioning: state === "provisioning" ? 1 : 0,
    retired: state === "retired" ? 1 : 0,
  };
}

function structuralSenderIssue(readiness: SenderReadiness | null) {
  if (!readiness) return null;
  return readiness.blockingIssues.find((issue) => issue.kind !== "capacity") ?? null;
}

function capacitySenderIssue(readiness: SenderReadiness | null) {
  if (!readiness) return null;
  return readiness.blockingIssues.find((issue) => issue.kind === "capacity") ?? null;
}

function mapCapacityIssueToCode(issue: SenderReadinessIssue | null) {
  if (!issue) return "sender_throttled" as const;
  if (issue.code === "daily_cap_reached") return "daily_cap_reached" as const;
  if (issue.code === "hourly_cap_reached") return "hourly_cap_reached" as const;
  if (issue.code === "domain_limit") return "domain_sender_limit" as const;
  return "sender_throttled" as const;
}

function mapProviderAnomalyToCode(anomaly: RunAnomaly | null) {
  if (!anomaly) return "unknown" as const;
  if (anomaly.type === "provider_error_rate") return "provider_error_rate" as const;
  if (anomaly.type === "deliverability_inbox_placement") {
    return "deliverability_inbox_placement_failure" as const;
  }
  return "unknown" as const;
}

function mapPrepTaskBlockerToInventoryCode(
  task: CampaignPrepTask | null
): OutreachInventoryBlockerCode {
  if (!task) return "unknown";
  if (task.status === "queued") return "campaign_prep_queued";
  if (task.status === "running") return "campaign_prep_running";
  if (task.status === "failed") return "campaign_prep_failed";
  if (task.blockerCode === "needs_sourcing") return "needs_sourcing";
  if (task.blockerCode === "dependency_misconfigured") return "dependency_misconfigured";
  if (task.blockerCode === "invalid_inventory") return "invalid_inventory";
  if (task.blockerCode === "blocked") return "blocked";
  return "unknown";
}

function asProgressRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function deriveInventoryHealth(input: {
  lane: "warmup" | "outbound";
  sendableLeadCount: number;
  targetCount?: number;
  prepProgress?: Record<string, unknown> | null;
}) {
  const progressHealth = String(input.prepProgress?.inventoryHealth ?? "").trim();
  if (
    progressHealth === "empty" ||
    progressHealth === "usable" ||
    progressHealth === "healthy" ||
    progressHealth === "surplus" ||
    progressHealth === "stale" ||
    progressHealth === "insufficient" ||
    progressHealth === "ready"
  ) {
    return progressHealth as OutreachInventoryHealth;
  }

  return classifyScaleCampaignInventoryHealth({
    lane: input.lane,
    targetCount: Math.max(1, Number(input.targetCount ?? 0) || 1),
    sendableLeadCount: input.sendableLeadCount,
  });
}

function defaultActions(domain: OutreachBlockerDomain, code: OutreachBlockerCode) {
  if (domain === "sender") {
    if (code === "gmail_ui_login_required") {
      return {
        recommendedNextAction: "Open the sender worker and complete Gmail UI login.",
        automaticAction: "Sending stays blocked until this sender session is repaired.",
      };
    }
    if (code === "mailpool_error") {
      return {
        recommendedNextAction: "Recreate or replace the deleted Mailpool sender, then reassign it to the brand.",
        automaticAction: "Status will refresh as soon as a working sender replaces the deleted one.",
      };
    }
    if (code === "inactive_delivery_account" || code === "missing_delivery_account") {
      return {
        recommendedNextAction: "Provision or assign a live sender before relaunching outbound.",
        automaticAction: "Status will refresh as soon as a working sender is assigned.",
      };
    }
    return {
      recommendedNextAction: "Repair the blocked sender configuration before relaunching outbound.",
      automaticAction: "Status will refresh as soon as sender readiness changes.",
    };
  }
  if (domain === "inventory") {
    return {
      recommendedNextAction: "Prepare fresh sendable contacts for the active outbound campaign.",
      automaticAction: "Prep and launch loops will retry when the campaign becomes eligible.",
    };
  }
  if (domain === "capacity") {
    return {
      recommendedNextAction: "Wait for the next capacity window or add another ready sender.",
      automaticAction: "Dispatch resumes automatically when sender capacity resets.",
    };
  }
  if (domain === "provider") {
    return {
      recommendedNextAction: "Repair provider and deliverability faults before pushing more mail.",
      automaticAction: "Ops loops will keep monitoring provider health and anomalies.",
    };
  }
  if (domain === "execution") {
    return {
      recommendedNextAction: "Repair the run and job path for the active outbound queue.",
      automaticAction: "Ops and dispatch loops will retry queue coverage on the next tick.",
    };
  }
  if (domain === "experiment") {
    if (code === "no_active_outbound_campaign") {
      return {
        recommendedNextAction: "Activate or create a real outbound campaign for a ready experiment.",
        automaticAction: "Status will clear as soon as an outbound campaign becomes active.",
      };
    }
    return {
      recommendedNextAction: "Prepare a viable outbound experiment before relaunching.",
      automaticAction: "Experiment readiness is recalculated from live campaign and run state.",
    };
  }
  return {
    recommendedNextAction: "No manual action required.",
    automaticAction: "Dispatch and ops loops will continue normal processing.",
  };
}

function ownerDuplicateCount(runs: OutreachRun[], now: Date) {
  const openByOwner = new Map<string, number>();
  for (const run of runs) {
    if (!isActionableOpenRun(run, now)) continue;
    const key = `${run.ownerType}:${run.ownerId}`;
    openByOwner.set(key, (openByOwner.get(key) ?? 0) + 1);
  }
  let duplicates = 0;
  for (const count of openByOwner.values()) {
    if (count > 1) duplicates += count - 1;
  }
  return duplicates;
}

function pickActiveRun(runs: OutreachRun[]) {
  const ranked = [...runs].sort((left, right) => {
    const leftRank =
      left.status === "sending"
        ? 6
        : left.status === "scheduled"
          ? 5
          : left.status === "queued"
            ? 4
            : left.status === "monitoring"
              ? 3
              : left.status === "sourcing"
                ? 2
                : left.status === "paused"
                  ? 1
                  : 0;
    const rightRank =
      right.status === "sending"
        ? 6
        : right.status === "scheduled"
          ? 5
          : right.status === "queued"
            ? 4
            : right.status === "monitoring"
              ? 3
              : right.status === "sourcing"
                ? 2
                : right.status === "paused"
                  ? 1
                  : 0;
    if (leftRank !== rightRank) return rightRank - leftRank;
    return left.createdAt < right.createdAt ? 1 : -1;
  });
  return ranked[0] ?? null;
}

function pickRecentRunsForInspection(runs: OutreachRun[], now: Date) {
  const cutoffMs = now.getTime() - 14 * DAY_MS;
  return [...runs]
    .filter((run) => {
      if (isOpenRunStatus(run.status)) return true;
      if ((run.metrics.scheduledMessages ?? 0) > 0) return true;
      if ((run.metrics.sentMessages ?? 0) > 0) {
        return asDate(run.updatedAt || run.createdAt).getTime() >= cutoffMs;
      }
      return asDate(run.createdAt).getTime() >= cutoffMs;
    })
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
    .slice(0, 40);
}

function businessHoursPerDay(activeCampaign: ScaleCampaignRecord | null, experiments: ExperimentRecord[]) {
  const sourceExperiment =
    activeCampaign?.sourceExperimentId
      ? experiments.find((experiment) => experiment.id === activeCampaign.sourceExperimentId) ?? null
      : null;
  if (!sourceExperiment?.testEnvelope.businessHoursEnabled) return 24;
  const start = Math.max(0, Number(sourceExperiment.testEnvelope.businessHoursStartHour ?? 9) || 9);
  const end = Math.max(start + 1, Number(sourceExperiment.testEnvelope.businessHoursEndHour ?? 17) || 17);
  return Math.max(1, Math.min(24, end - start));
}

function preferredTimeZone(activeCampaign: ScaleCampaignRecord | null, experiments: ExperimentRecord[]) {
  const campaignTimeZone = String(activeCampaign?.scalePolicy.timezone ?? "").trim();
  if (campaignTimeZone) return campaignTimeZone;
  const experimentTimeZone =
    experiments.find((experiment) => String(experiment.testEnvelope.timezone ?? "").trim())?.testEnvelope.timezone ??
    "";
  return String(experimentTimeZone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
}

function synthesizeEphemeralSender(
  brandId: string,
  account: OutreachAccount,
  mailboxAccount: OutreachAccount | null
): CanonicalSender {
  const fromEmail = normalizeEmail(getOutreachAccountFromEmail(account));
  return {
    id: `ephemeral_sender_${account.id}`,
    brandId,
    fromEmail,
    replyToEmail: normalizeEmail(getOutreachAccountReplyToEmail(mailboxAccount ?? account)),
    domain: normalizeDomain(senderDomainFromEmail(fromEmail)),
    deliveryAccountId: account.id,
    mailboxAccountId: mailboxAccount?.id ?? account.id,
    state: account.status === "active" ? "ready" : "blocked",
    readinessScore: account.status === "active" ? 80 : 10,
    dailyCap: 0,
    hourlyCap: 0,
    blockedReason: account.status === "active" ? "" : "Delivery account is inactive.",
    lastTestStatus: account.lastTestStatus,
    lastSendAt: "",
    lastReplyAt: "",
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function primarySenderFallbackIssue(activeOutboundCampaignCount: number) {
  if (activeOutboundCampaignCount <= 0) return null;
  return {
    code: "missing_delivery_account" as const,
    summary: "No delivery sender is assigned to the active outbound path.",
    detail: "Assign a real sending inbox before this brand can send.",
  };
}

function isOutboundPromotionEligibleExperiment(input: {
  experiment: ExperimentRecord;
  campaignBySourceExperimentId: Map<string, ScaleCampaignRecord>;
}) {
  const linkedCampaign = input.campaignBySourceExperimentId.get(input.experiment.id) ?? null;
  if (linkedCampaign) {
    if (resolveScaleCampaignLane(linkedCampaign) === "outbound") {
      return true;
    }
    return !isWarmupCampaignName(input.experiment.name) && !isWarmupCampaignName(linkedCampaign.name);
  }
  return !isWarmupCampaignName(input.experiment.name);
}

function summarizeSenderBlocker(input: {
  summary: string;
  totalSenderCount: number;
  retiredSenderCount: number;
}) {
  if (input.totalSenderCount > 0 && input.retiredSenderCount === input.totalSenderCount) {
    return `Nothing is sending because all available senders are retired (${input.retiredSenderCount} sender${input.retiredSenderCount === 1 ? "" : "s"}).`;
  }

  const trimmed = input.summary.trim().replace(/\.+$/, "");
  if (!trimmed) {
    return "Nothing is sending because the sender path is blocked.";
  }
  const normalized =
    trimmed.startsWith("No ") || trimmed.startsWith("Delivery ")
      ? `${trimmed[0].toLowerCase()}${trimmed.slice(1)}`
      : trimmed;
  return `Nothing is sending because ${normalized}.`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function summarizeCampaignStatuses(
  campaigns: Array<Pick<ScaleCampaignRecord, "status">>
) {
  const counts = campaigns.reduce(
    (acc, campaign) => {
      const key = String(campaign.status ?? "").trim().toLowerCase();
      if (!key) return acc;
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    },
    new Map<string, number>()
  );

  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([status, count]) => `${pluralize(count, status)}.`)
    .join(" ");
}

function buildNoActiveOutboundCampaignSummary(input: {
  outboundCampaigns: ScaleCampaignRecord[];
  pausedOutboundCampaigns: ScaleCampaignRecord[];
  activeWarmupCampaigns: ScaleCampaignRecord[];
  assignedSenderCount: number;
  retiredSenderCount: number;
}) {
  const retiredClause =
    input.assignedSenderCount > 0 && input.retiredSenderCount === input.assignedSenderCount
      ? ` All assigned senders are retired (${pluralize(input.retiredSenderCount, "sender")}).`
      : "";

  if (
    input.outboundCampaigns.length > 0 &&
    input.pausedOutboundCampaigns.length === input.outboundCampaigns.length
  ) {
    return `Nothing is sending because all outbound campaigns are paused (${pluralize(
      input.pausedOutboundCampaigns.length,
      "campaign"
    )}).${retiredClause}`;
  }

  if (input.outboundCampaigns.length === 0 && input.activeWarmupCampaigns.length > 0) {
    return `Nothing is sending because only warmup campaigns are active (${pluralize(
      input.activeWarmupCampaigns.length,
      "campaign"
    )}); there is no active outbound campaign.${retiredClause}`;
  }

  if (input.outboundCampaigns.length === 0) {
    return `Nothing is sending because no outbound campaign exists for the ready experiment path.${retiredClause}`;
  }

  return `Nothing is sending because no outbound campaign is active. Existing outbound campaigns are ${summarizeCampaignStatuses(
    input.outboundCampaigns
  )}${retiredClause}`;
}

async function assembleBrandStatus(
  brand: BrandRecord,
  filters: OutreachStatusFilters,
  context: BrandAssemblyContext
): Promise<OutreachBrandStatus> {
  const [assignment, canonicalPool, campaigns, experiments, probeRuns] = await Promise.all([
    getBrandOutreachAssignment(brand.id),
    getCanonicalSenderPoolForBrand(brand.id),
    listScaleCampaignRecords(brand.id),
    listExperimentRecords(brand.id),
    listDeliverabilityProbeRuns({ brandId: brand.id, limit: 300 }),
  ]);

  const campaignBySourceExperimentId = new Map(
    campaigns.map((campaign) => [campaign.sourceExperimentId, campaign] as const)
  );
  const outboundCampaigns = campaigns.filter((campaign) => resolveScaleCampaignLane(campaign) === "outbound");
  const activeOutboundCampaigns = outboundCampaigns.filter((campaign) => campaign.status === "active");
  const pausedOutboundCampaigns = outboundCampaigns.filter((campaign) => campaign.status === "paused");
  const activeWarmupCampaigns = campaigns.filter(
    (campaign) => resolveScaleCampaignLane(campaign) === "warmup" && campaign.status === "active"
  );
  const inspectedCampaigns = filters.includeWarmup ? campaigns : outboundCampaigns;

  const senderRows = brand.domains.filter((row) => row.role !== "brand");
  const assignedMailboxAccount = assignment?.mailboxAccountId
    ? context.accountById.get(assignment.mailboxAccountId) ?? null
    : null;

  const knownSenderAccountIds = new Set(
    canonicalPool.senders.map((sender) => sender.deliveryAccountId).filter(Boolean)
  );
  const extraCampaignAccountIds = unique(
    activeOutboundCampaigns
      .flatMap((campaign) => [
        String(campaign.scalePolicy.accountId ?? "").trim(),
        String(campaign.scalePolicy.mailboxAccountId ?? "").trim(),
      ])
      .filter(Boolean)
  );
  const extraSenders = extraCampaignAccountIds
    .filter((accountId) => !knownSenderAccountIds.has(accountId))
    .map((accountId) => context.accountById.get(accountId) ?? null)
    .filter((account): account is OutreachAccount => Boolean(account))
    .map((account) => synthesizeEphemeralSender(brand.id, account, assignedMailboxAccount));
  const canonicalSenders = [...canonicalPool.senders, ...extraSenders];

  const experimentRunEntries = await Promise.all(
    experiments.map(async (experiment) => [experiment.id, await listOwnerRuns(brand.id, "experiment", experiment.id)] as const)
  );
  const campaignRunEntries = await Promise.all(
    inspectedCampaigns.map(async (campaign) => [campaign.id, await listOwnerRuns(brand.id, "campaign", campaign.id)] as const)
  );
  const experimentRunsByOwnerId = new Map(experimentRunEntries);
  const campaignRunsByOwnerId = new Map(campaignRunEntries);

  const outboundExperimentRuns = experiments
    .filter((experiment) => {
      if (filters.includeWarmup) return true;
      const linkedCampaign = campaignBySourceExperimentId.get(experiment.id) ?? null;
      return resolveScaleCampaignLane(linkedCampaign) === "outbound";
    })
    .flatMap((experiment) => experimentRunsByOwnerId.get(experiment.id) ?? []);
  const outboundCampaignRuns = outboundCampaigns.flatMap((campaign) => campaignRunsByOwnerId.get(campaign.id) ?? []);
  const allOutboundRuns = unique([...outboundCampaignRuns, ...outboundExperimentRuns].map((run) => run.id))
    .map((runId) => [...outboundCampaignRuns, ...outboundExperimentRuns].find((run) => run.id === runId) ?? null)
    .filter((run): run is OutreachRun => Boolean(run))
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
  const openOutboundRuns = allOutboundRuns.filter((run) => isActionableOpenRun(run, context.now));
  const activeOutboundRun = pickActiveRun(openOutboundRuns);
  const activeOutboundCampaign =
    activeOutboundCampaigns.find((campaign) => {
      const runs = campaignRunsByOwnerId.get(campaign.id) ?? [];
      return runs.some((run) => isActionableOpenRun(run, context.now));
    }) ??
    activeOutboundCampaigns[0] ??
    null;
  const activeWarmupCampaign =
    activeWarmupCampaigns.find((campaign) => {
      const runs = campaignRunsByOwnerId.get(campaign.id) ?? [];
      return runs.some((run) => isActionableOpenRun(run, context.now));
    }) ??
    activeWarmupCampaigns[0] ??
    null;
  const runsForInspection = pickRecentRunsForInspection(allOutboundRuns, context.now);
  const messagesByRunId = new Map(
    await Promise.all(
      runsForInspection.map(async (run) => [run.id, await listRunMessages(run.id)] as const)
    )
  );
  const jobsByRunId = new Map(
    await Promise.all(
      openOutboundRuns.map(async (run) => [run.id, await listRunJobs(run.id, 100)] as const)
    )
  );
  const anomaliesByRunId = new Map(
    await Promise.all(
      openOutboundRuns.map(async (run) => [run.id, await listRunAnomalies(run.id)] as const)
    )
  );

  const timeZone = preferredTimeZone(activeOutboundCampaign, experiments);
  const senderAccounts = canonicalSenders
    .map((sender) => context.accountById.get(sender.deliveryAccountId) ?? null)
    .filter((account): account is OutreachAccount => Boolean(account));
  const scorecards = buildSenderDeliverabilityScorecards({
    probeRuns,
    senderAccounts,
    now: context.now,
  });
  const scorecardByAccountId = new Map(
    scorecards
      .filter((scorecard) => scorecard.senderAccountId)
      .map((scorecard) => [scorecard.senderAccountId, scorecard] as const)
  );
  const usage = buildSenderUsageMap({
    entries: runsForInspection.map((run) => ({
      run,
      messages: messagesByRunId.get(run.id) ?? [],
    })),
    timeZone,
    now: context.now,
  });
  const senderCapacitySubjects: Array<{
    account: OutreachAccount;
    row: DomainRow | null;
    scorecard: ReturnType<typeof buildSenderDeliverabilityScorecards>[number] | null;
  }> = canonicalSenders
    .map((sender) => {
      const account = context.accountById.get(sender.deliveryAccountId) ?? null;
      if (!account) return null;
      return {
        account,
        row: findSenderDomainRow(senderRows, {
          deliveryAccountId: sender.deliveryAccountId,
          fromEmail: sender.fromEmail,
        }),
        scorecard: scorecardByAccountId.get(account.id) ?? null,
      };
    })
    .filter(
      (
        entry
      ): entry is {
        account: OutreachAccount;
        row: DomainRow | null;
        scorecard: ReturnType<typeof buildSenderDeliverabilityScorecards>[number] | null;
      } => Boolean(entry)
    );
  const capacityByAccountId = new Map(
    buildSenderCapacitySnapshots({
      senders: senderCapacitySubjects,
      timeZone,
      businessHoursPerDay: businessHoursPerDay(activeOutboundCampaign, experiments),
      usage,
      now: context.now,
    }).map((snapshot) => [snapshot.senderAccountId, snapshot] as const)
  );

  const senderInfos = canonicalSenders.map((sender) => {
    const deliveryAccount = context.accountById.get(sender.deliveryAccountId) ?? null;
    const mailboxAccount =
      (sender.mailboxAccountId
        ? context.accountById.get(sender.mailboxAccountId) ?? null
        : null) ??
      (deliveryAccount &&
      normalizeEmail(getOutreachMailboxEmail(deliveryAccount)) === normalizeEmail(sender.fromEmail)
        ? deliveryAccount
        : assignedMailboxAccount);
    const row = findSenderDomainRow(senderRows, {
      deliveryAccountId: deliveryAccount?.id ?? sender.deliveryAccountId,
      fromEmail: sender.fromEmail,
    });
    return {
      sender,
      deliveryAccount,
      mailboxAccount,
      readiness: evaluateSenderReadiness({
        account: deliveryAccount,
        mailboxAccount,
        hasDeliveryCredentials: deliveryAccount?.hasCredentials ?? false,
        hasMailboxCredentials: mailboxAccount?.hasCredentials ?? false,
        row,
        capacity: deliveryAccount ? capacityByAccountId.get(deliveryAccount.id) ?? null : null,
      }),
      capacity: deliveryAccount ? capacityByAccountId.get(deliveryAccount.id) ?? null : null,
      scorecard: deliveryAccount ? scorecardByAccountId.get(deliveryAccount.id) ?? null : null,
    } satisfies SenderStatusInfo;
  });
  const primarySender = pickPrimarySender({
    senderInfos,
    activeRun: activeOutboundRun,
    activeCampaign: activeOutboundCampaign,
    assignment,
  });

  const senderCounts = senderInfos.reduce(
    (acc, info) => {
      const counts = brandSummaryFromState(info.sender.state);
      acc.ready += counts.ready;
      acc.warming += counts.warming;
      acc.restricted += counts.restricted;
      acc.blocked += counts.blocked;
      acc.provisioning += counts.provisioning;
      acc.retired += counts.retired;
      return acc;
    },
    {
      ready: 0,
      warming: 0,
      restricted: 0,
      blocked: 0,
      provisioning: 0,
      retired: 0,
    }
  );

  const readyOutboundCampaignCount = activeOutboundCampaigns.filter((campaign) => {
    const preferredAccountId = String(campaign.scalePolicy.accountId ?? "").trim();
    if (preferredAccountId) {
      const senderInfo =
        senderInfos.find((info) => String(info.deliveryAccount?.id ?? "").trim() === preferredAccountId) ??
        null;
      const issue = structuralSenderIssue(senderInfo?.readiness ?? null);
      return Boolean(senderInfo && !issue);
    }
    return senderInfos.some((info) => !structuralSenderIssue(info.readiness));
  }).length;
  const blockedOutboundCampaignCount = Math.max(0, activeOutboundCampaigns.length - readyOutboundCampaignCount);

  const allInspectedMessages = [...messagesByRunId.values()].flat();
  const openOutboundRunIds = new Set(openOutboundRuns.map((run) => run.id));
  const openOutboundMessages = allInspectedMessages.filter((message) => openOutboundRunIds.has(message.runId));
  const allOpenRunJobs = [...jobsByRunId.values()].flat();
  const allOpenRunAnomalies = [...anomaliesByRunId.values()].flat();
  const dueMessageCount = openOutboundMessages.filter((message) => {
    return message.status === "scheduled" && asDate(message.scheduledAt).getTime() <= context.now.getTime();
  }).length;
  const scheduledNext24hCount = openOutboundMessages.filter((message) => {
    if (message.status !== "scheduled") return false;
    const scheduledAt = asDate(message.scheduledAt).getTime();
    return scheduledAt > context.now.getTime() && scheduledAt <= context.now.getTime() + DAY_MS;
  }).length;
  const activeDispatchJobCount = allOpenRunJobs.filter(
    (job) => job.jobType === "dispatch_messages" && ACTIVE_JOB_STATUSES.has(job.status)
  ).length;
  const activeCriticalOutboundAnomalyCount = allOpenRunAnomalies.filter(
    (anomaly) => anomaly.status === "active" && anomaly.severity === "critical"
  ).length;
  const duplicateOpenRunCount = ownerDuplicateCount(allOutboundRuns, context.now);
  const staleTerminalArtifacts = runsForInspection.some((run) => {
    if (!isTerminalRunStatus(run.status)) return false;
    return (messagesByRunId.get(run.id) ?? []).some((message) => message.status === "scheduled");
  });
  const sentMessages = allInspectedMessages.filter((message) => message.status === "sent" && Boolean(message.sentAt));
  const lastSendAt = sentMessages
    .map((message) => message.sentAt)
    .filter(Boolean)
    .sort((left, right) => (left < right ? 1 : -1))[0] ?? "";
  const sendingToday = sentMessages.some(
    (message) =>
      message.sentAt &&
      timeZoneDateKey(asDate(message.sentAt), timeZone) === timeZoneDateKey(context.now, timeZone)
  );
  const hasOpenOutboundQueue = openOutboundRuns.length > 0;

  const activeInventoryCampaign =
    activeOutboundCampaign ?? (filters.includeWarmup ? activeWarmupCampaign : null);
  const activeInventoryLane = activeInventoryCampaign
    ? resolveScaleCampaignLane(activeInventoryCampaign)
    : null;
  const activeInventorySourceExperiment =
    activeInventoryCampaign?.sourceExperimentId
      ? experiments.find((experiment) => experiment.id === activeInventoryCampaign.sourceExperimentId) ?? null
      : null;
  const [campaignInventorySendable, experimentInventorySendable, activeInventoryPrepTask] = await Promise.all([
    activeInventoryCampaign
      ? countScaleCampaignSendableLeadContacts(brand.id, activeInventoryCampaign.id)
      : Promise.resolve(emptySendableLeadSummary()),
    activeInventorySourceExperiment
      ? countExperimentSendableLeadContacts(brand.id, activeInventorySourceExperiment.id)
      : Promise.resolve(emptySendableLeadSummary()),
    activeInventoryCampaign
      ? getCampaignPrepTask(brand.id, activeInventoryCampaign.id, { allowMissingTable: true })
      : Promise.resolve(null),
  ]);
  const activeInventoryRuns = activeInventoryCampaign
    ? campaignRunsByOwnerId.get(activeInventoryCampaign.id) ?? []
    : [];
  const activeInventoryPrepProgress = asProgressRecord(activeInventoryPrepTask?.progress);
  const inventoryQueueAvailable =
    activeInventoryLane === "outbound"
      ? dueMessageCount > 0 || scheduledNext24hCount > 0 || hasOpenOutboundQueue
      : activeInventoryRuns.some((run) => isActionableOpenRun(run, context.now));
  const campaignOwnedSendableLeadCount = campaignInventorySendable.sendableLeadCount;
  const experimentOwnedSendableLeadCount = experimentInventorySendable.sendableLeadCount;
  const inventoryBridgeEligible = Boolean(
    activeInventoryCampaign &&
      activeInventoryLane === "outbound" &&
      !usesDedicatedCampaignSender(activeInventoryCampaign) &&
      activeInventorySourceExperiment?.id
  );

  let inventorySourceKind: OutreachInventorySourceKind = "none";
  let inventoryOwnerType: OutreachInventoryOwnerType = "none";
  let inventoryOwnerId = "";
  let inventoryBridgeActive = false;

  if (activeInventoryCampaign) {
    if (activeInventoryLane === "warmup") {
      inventorySourceKind = "warmup";
      inventoryOwnerType = "campaign";
      inventoryOwnerId = activeInventoryCampaign.id;
      inventoryBridgeActive = false;
    } else if (usesDedicatedCampaignSender(activeInventoryCampaign)) {
      inventorySourceKind = "campaign";
      inventoryOwnerType = "campaign";
      inventoryOwnerId = activeInventoryCampaign.id;
      inventoryBridgeActive = false;
    } else if (campaignOwnedSendableLeadCount > 0) {
      inventorySourceKind = "campaign";
      inventoryOwnerType = "campaign";
      inventoryOwnerId = activeInventoryCampaign.id;
      inventoryBridgeActive = inventoryBridgeEligible;
    } else if (activeInventorySourceExperiment) {
      inventorySourceKind = "experiment";
      inventoryOwnerType = "experiment";
      inventoryOwnerId = activeInventorySourceExperiment.id;
      inventoryBridgeActive = true;
    } else {
      inventorySourceKind = "campaign";
      inventoryOwnerType = "campaign";
      inventoryOwnerId = activeInventoryCampaign.id;
      inventoryBridgeActive = false;
    }
  }

  const inventoryAvailable =
    inventoryQueueAvailable ||
    campaignOwnedSendableLeadCount > 0 ||
    (inventoryBridgeEligible && experimentOwnedSendableLeadCount > 0) ||
    (inventorySourceKind === "experiment" && experimentOwnedSendableLeadCount > 0);
  const inventoryHealth = deriveInventoryHealth({
    lane: activeInventoryLane === "warmup" ? "warmup" : "outbound",
    sendableLeadCount:
      activeInventoryLane === "warmup"
        ? campaignOwnedSendableLeadCount
        : inventorySourceKind === "experiment"
          ? experimentOwnedSendableLeadCount
          : campaignOwnedSendableLeadCount,
    targetCount: Number(activeInventoryPrepProgress?.targetCount ?? 0) || undefined,
    prepProgress: activeInventoryPrepProgress,
  });
  const inventoryDispatchable =
    inventoryAvailable ||
    (activeInventoryLane === "warmup" && campaignOwnedSendableLeadCount > 0);

  let inventoryBlockerCode: OutreachInventoryBlockerCode = "none";
  let inventoryBlockerSummary = "";

  if (activeInventoryCampaign && !inventoryAvailable) {
    if (activeInventoryPrepTask && activeInventoryPrepTask.status !== "ready") {
      inventoryBlockerCode = mapPrepTaskBlockerToInventoryCode(activeInventoryPrepTask);
      inventoryBlockerSummary =
        activeInventoryPrepTask.summary ||
        activeInventoryPrepTask.lastError ||
        "Campaign prep is not ready yet.";
    } else if (activeInventoryLane === "warmup") {
      inventoryBlockerCode = "inventory_empty";
      inventoryBlockerSummary =
        "Warmup campaign has no sender warmup inventory or open warmup queue.";
    } else if (usesDedicatedCampaignSender(activeInventoryCampaign)) {
      inventoryBlockerCode = "inventory_empty";
      inventoryBlockerSummary =
        experimentOwnedSendableLeadCount > 0
          ? "Dedicated outbound campaign has no campaign-owned sendable leads or queued mail. Experiment-owned leads exist, but this launch path does not borrow them."
          : "Dedicated outbound campaign has no campaign-owned sendable leads or queued mail.";
    } else if (experimentOwnedSendableLeadCount > 0) {
      inventoryBlockerCode = "unknown";
      inventoryBlockerSummary =
        "Shared outbound path can still bridge to experiment-owned inventory, but no live queue is active yet.";
    } else {
      inventoryBlockerCode = "no_sendable_contacts";
      inventoryBlockerSummary =
        campaignOwnedSendableLeadCount > 0
          ? "Campaign-owned sendable leads exist, but no live outbound queue was created from them."
          : "Neither campaign-owned nor experiment-owned sendable leads are available for this outbound path.";
    }
  }

  const inventorySummary: OutreachBrandInventorySummary = {
    inventorySourceKind,
    inventoryOwnerType,
    inventoryOwnerId,
    inventoryBridgeActive,
    inventoryHealth,
    inventoryDispatchable,
    inventoryBlockerCode,
    inventoryBlockerSummary,
    prepTaskStatus: activeInventoryPrepTask?.status ?? "none",
    prepTaskAttempt: activeInventoryPrepTask?.attempt ?? 0,
    prepTaskExecuteAfter: activeInventoryPrepTask?.executeAfter ?? "",
    prepTaskUpdatedAt: activeInventoryPrepTask?.updatedAt ?? "",
    prepTaskBlockerCode: activeInventoryPrepTask?.blockerCode ?? "none",
    prepTaskSummary: activeInventoryPrepTask?.summary ?? "",
    prepTaskLastError: activeInventoryPrepTask?.lastError ?? "",
    campaignOwnedSendableLeadCount,
    campaignOwnedRunsChecked: campaignInventorySendable.runsChecked,
    experimentOwnedSendableLeadCount,
    experimentOwnedRunsChecked: experimentInventorySendable.runsChecked,
  };

  const providerAnomaly =
    allOpenRunAnomalies.find(
      (anomaly) =>
        anomaly.status === "active" &&
        anomaly.severity === "critical" &&
        (anomaly.type === "provider_error_rate" || anomaly.type === "deliverability_inbox_placement")
    ) ?? null;
  const senderIssue = structuralSenderIssue(primarySender?.readiness ?? null);
  const capacityIssue = capacitySenderIssue(primarySender?.readiness ?? null);
  const missingSenderIssue = !primarySender
    ? primarySenderFallbackIssue(activeOutboundCampaigns.length)
    : null;
  const promotionReadyExperiments = experiments.filter((experiment) => {
    if (experiment.status !== "ready" && experiment.status !== "promoted") {
      return false;
    }
    return isOutboundPromotionEligibleExperiment({
      experiment,
      campaignBySourceExperimentId,
    });
  });
  const promotionReadyCount = promotionReadyExperiments.length;
  const experimentBlocker =
    activeOutboundCampaigns.length === 0 && experiments.length > 0
      ? promotionReadyCount > 0
        ? {
            domain: "experiment" as const,
            code: "no_active_outbound_campaign" as const,
            summary: buildNoActiveOutboundCampaignSummary({
              outboundCampaigns,
              pausedOutboundCampaigns,
              activeWarmupCampaigns,
              assignedSenderCount: canonicalSenders.length,
              retiredSenderCount: senderCounts.retired,
            }),
          }
        : {
            domain: "experiment" as const,
            code: "no_promotable_winner" as const,
            summary: "Nothing is sending because no experiment is ready for an outbound campaign yet.",
          }
      : null;
  const inventoryBlocker =
    activeOutboundCampaigns.length > 0 && inventorySummary.inventoryBlockerCode !== "none"
      ? {
          domain: "inventory" as const,
          code: inventorySummary.inventoryBlockerCode,
          summary: inventorySummary.inventoryBlockerSummary,
        }
      : null;
  const capacityBlocker =
    primarySender?.scorecard?.autoPaused
      ? {
          domain: "capacity" as const,
          code: "deliverability_auto_paused" as const,
          summary:
            primarySender.scorecard.autoPauseReason ||
            "Deliverability automation has paused this sender.",
        }
      : capacityIssue
        ? {
            domain: "capacity" as const,
            code: mapCapacityIssueToCode(capacityIssue),
            summary: capacityIssue.detail,
          }
        : null;
  const providerBlocker = providerAnomaly
    ? {
        domain: "provider" as const,
        code: mapProviderAnomalyToCode(providerAnomaly),
        summary: providerAnomaly.details || "Provider health is blocking reliable outbound delivery.",
      }
    : null;
  const executionBlocker =
    duplicateOpenRunCount > 0
      ? {
          domain: "execution" as const,
          code: "duplicate_open_runs" as const,
          summary: "Multiple open runs exist for the same owner path.",
        }
      : activeOutboundRun?.status === "paused"
        ? {
            domain: "execution" as const,
            code: "paused_active_outbound_run" as const,
            summary: "The active outbound run is paused.",
          }
        : dueMessageCount > 0 && activeDispatchJobCount === 0
          ? {
              domain: "execution" as const,
              code: "no_dispatch_job_for_due_mail" as const,
              summary: "Due scheduled mail exists, but there is no active dispatch job for it.",
            }
          : staleTerminalArtifacts
            ? {
                domain: "execution" as const,
                code: "stale_terminal_artifacts" as const,
                summary: "Scheduled mail still exists on terminal runs.",
              }
            : null;

  let primaryBlockerDomain: OutreachBlockerDomain = "none";
  let primaryBlockerCode: OutreachBlockerCode = "none";
  let primaryBlockerSummary = "No active blocker.";
  const preferSenderBlocker =
    experimentBlocker?.code === "no_active_outbound_campaign" && (senderIssue || missingSenderIssue);

  if (senderIssue || missingSenderIssue) {
    if (!preferSenderBlocker && experimentBlocker && experimentBlocker.code !== "no_active_outbound_campaign") {
      primaryBlockerDomain = experimentBlocker.domain;
      primaryBlockerCode = experimentBlocker.code;
      primaryBlockerSummary = experimentBlocker.summary;
    } else {
      primaryBlockerDomain = "sender";
      primaryBlockerCode = (senderIssue?.code ?? missingSenderIssue?.code ?? "missing_delivery_account") as OutreachBlockerCode;
      primaryBlockerSummary = summarizeSenderBlocker(
        {
          summary:
            senderIssue?.summary ??
            missingSenderIssue?.summary ??
            "The sender path is blocked",
          totalSenderCount: senderInfos.length,
          retiredSenderCount: senderCounts.retired,
        }
      );
    }
  } else if (experimentBlocker) {
    primaryBlockerDomain = experimentBlocker.domain;
    primaryBlockerCode = experimentBlocker.code;
    primaryBlockerSummary = experimentBlocker.summary;
  } else if (inventoryBlocker) {
    primaryBlockerDomain = inventoryBlocker.domain;
    primaryBlockerCode = inventoryBlocker.code;
    primaryBlockerSummary = inventoryBlocker.summary;
  } else if (capacityBlocker) {
    primaryBlockerDomain = capacityBlocker.domain;
    primaryBlockerCode = capacityBlocker.code;
    primaryBlockerSummary = capacityBlocker.summary;
  } else if (providerBlocker) {
    primaryBlockerDomain = providerBlocker.domain;
    primaryBlockerCode = providerBlocker.code;
    primaryBlockerSummary = providerBlocker.summary;
  } else if (executionBlocker) {
    primaryBlockerDomain = executionBlocker.domain;
    primaryBlockerCode = executionBlocker.code;
    primaryBlockerSummary = executionBlocker.summary;
  }

  const actions = defaultActions(primaryBlockerDomain, primaryBlockerCode);
  const dispatchableNow =
    primaryBlockerDomain === "none" &&
    Boolean(primarySender?.readiness.canSendNow) &&
    activeOutboundCampaigns.length > 0 &&
    (hasOpenOutboundQueue || scheduledNext24hCount > 0 || dueMessageCount > 0);

  const experimentSummary: OutreachBrandExperimentSummary = {
    totalExperimentCount: experiments.length,
    runningExperimentCount: experiments.filter((experiment) => experiment.status === "running").length,
    readyExperimentCount: experiments.filter((experiment) => experiment.status === "ready").length,
    promotedExperimentCount: experiments.filter((experiment) => experiment.status === "promoted").length,
    activeExperimentRunCount: outboundExperimentRuns.filter((run) => isActionableOpenRun(run, context.now))
      .length,
    promotionReadyCount,
    promotionBlocker: experimentBlocker?.summary ?? "",
  };

  return {
    brandId: brand.id,
    brandName: brand.name,
    healthy: primaryBlockerDomain === "none",
    sendingToday,
    primaryBlockerDomain,
    primaryBlockerCode,
    primaryBlockerSummary,
    recommendedNextAction: actions.recommendedNextAction,
    automaticAction: actions.automaticAction,
    lastSendAt,
    freshness: freshness(context.generatedAt),
    senderSummary: {
      assignedSenderCount: senderInfos.length,
      readySenderCount: senderCounts.ready,
      warmingSenderCount: senderCounts.warming,
      restrictedSenderCount: senderCounts.restricted,
      blockedSenderCount: senderCounts.blocked,
      provisioningSenderCount: senderCounts.provisioning,
      retiredSenderCount: senderCounts.retired,
      primarySenderId: primarySender?.sender.id ?? "",
      primarySenderEmail: primarySender?.sender.fromEmail ?? "",
      primarySenderState: primarySender?.sender.state ?? "",
    },
    campaignSummary: {
      activeOutboundCampaignCount: activeOutboundCampaigns.length,
      pausedOutboundCampaignCount: pausedOutboundCampaigns.length,
      activeWarmupCampaignCount: activeWarmupCampaigns.length,
      readyOutboundCampaignCount,
      blockedOutboundCampaignCount,
      activeOutboundCampaignId: activeOutboundCampaign?.id ?? "",
      activeOutboundCampaignName: activeOutboundCampaign?.name ?? "",
    },
    experimentSummary,
    inventorySummary,
    capacitySummary: {
      dispatchableNow,
      effectiveDailyCap: Math.max(0, Number(primarySender?.capacity?.dailyCap ?? primarySender?.sender.dailyCap ?? 0) || 0),
      effectiveHourlyCap: Math.max(0, Number(primarySender?.capacity?.hourlyCap ?? primarySender?.sender.hourlyCap ?? 0) || 0),
      capacityLimiter:
        primaryBlockerDomain === "capacity"
          ? primaryBlockerSummary
          : primarySender?.capacity?.summary ?? "",
    },
    executionSummary: {
      activeOutboundRunId: activeOutboundRun?.id ?? "",
      activeOutboundRunStatus: activeOutboundRun?.status ?? "",
      openOutboundRunCount: openOutboundRuns.length,
      duplicateOpenRunCount,
      dueMessageCount,
      scheduledNext24hCount,
      activeDispatchJobCount,
      activeCriticalOutboundAnomalyCount,
    },
  };
}

function buildFailedBrandStatus(
  brand: BrandRecord,
  generatedAt: string,
  error: unknown
): OutreachBrandStatus {
  const message = error instanceof Error ? error.message : "Failed to assemble live status.";
  return {
    brandId: brand.id,
    brandName: brand.name,
    healthy: false,
    sendingToday: false,
    primaryBlockerDomain: "execution",
    primaryBlockerCode: "unknown",
    primaryBlockerSummary: message,
    recommendedNextAction: "Inspect malformed brand state and repair the failing status inputs.",
    automaticAction: "The route will retry live assembly on the next request.",
    lastSendAt: "",
    freshness: freshness(generatedAt),
    senderSummary: {
      assignedSenderCount: 0,
      readySenderCount: 0,
      warmingSenderCount: 0,
      restrictedSenderCount: 0,
      blockedSenderCount: 0,
      provisioningSenderCount: 0,
      retiredSenderCount: 0,
      primarySenderId: "",
      primarySenderEmail: "",
      primarySenderState: "",
    },
    campaignSummary: {
      activeOutboundCampaignCount: 0,
      pausedOutboundCampaignCount: 0,
      activeWarmupCampaignCount: 0,
      readyOutboundCampaignCount: 0,
      blockedOutboundCampaignCount: 0,
      activeOutboundCampaignId: "",
      activeOutboundCampaignName: "",
    },
    experimentSummary: {
      totalExperimentCount: 0,
      runningExperimentCount: 0,
      readyExperimentCount: 0,
      promotedExperimentCount: 0,
      activeExperimentRunCount: 0,
      promotionReadyCount: 0,
      promotionBlocker: "",
    },
    inventorySummary: {
      inventorySourceKind: "none",
      inventoryOwnerType: "none",
      inventoryOwnerId: "",
      inventoryBridgeActive: false,
      inventoryHealth: "empty",
      inventoryDispatchable: false,
      inventoryBlockerCode: "unknown",
      inventoryBlockerSummary: message,
      prepTaskStatus: "none",
      prepTaskAttempt: 0,
      prepTaskExecuteAfter: "",
      prepTaskUpdatedAt: "",
      prepTaskBlockerCode: "none",
      prepTaskSummary: "",
      prepTaskLastError: "",
      campaignOwnedSendableLeadCount: 0,
      campaignOwnedRunsChecked: 0,
      experimentOwnedSendableLeadCount: 0,
      experimentOwnedRunsChecked: 0,
    },
    capacitySummary: {
      dispatchableNow: false,
      effectiveDailyCap: 0,
      effectiveHourlyCap: 0,
      capacityLimiter: "",
    },
    executionSummary: {
      activeOutboundRunId: "",
      activeOutboundRunStatus: "",
      openOutboundRunCount: 0,
      duplicateOpenRunCount: 0,
      dueMessageCount: 0,
      scheduledNext24hCount: 0,
      activeDispatchJobCount: 0,
      activeCriticalOutboundAnomalyCount: 0,
    },
  };
}

export function normalizeOutreachStatusFilters(input: {
  brandId?: string | null;
  includeWarmup?: boolean | string | number | null;
  limitBrands?: string | number | null;
}): OutreachStatusFilters {
  const includeWarmupRaw = String(input.includeWarmup ?? "").trim().toLowerCase();
  return {
    brandId: String(input.brandId ?? "").trim(),
    includeWarmup:
      input.includeWarmup === true ||
      input.includeWarmup === 1 ||
      includeWarmupRaw === "1" ||
      includeWarmupRaw === "true",
    limitBrands: clampLimitBrands(input.limitBrands),
  };
}

export async function buildOutreachStatusResponse(
  rawFilters: Partial<OutreachStatusFilters>
): Promise<OutreachStatusResponse> {
  const filters = normalizeOutreachStatusFilters(rawFilters);
  const generatedAt = new Date().toISOString();
  const now = new Date(generatedAt);
  const [allAccounts, brands] = await Promise.all([
    listOutreachAccounts(),
    filters.brandId
      ? Promise.all([getBrandById(filters.brandId)]).then(([brand]) => (brand ? [brand] : []))
      : listBrands(),
  ]);
  const accountById = new Map(allAccounts.map((account) => [account.id, account] as const));
  const selectedBrands = brands.slice(0, filters.limitBrands);
  const context: BrandAssemblyContext = {
    generatedAt,
    now,
    allAccounts,
    accountById,
  };

  const brandStatuses = await Promise.all(
    selectedBrands.map(async (brand) => {
      try {
        return await assembleBrandStatus(brand, filters, context);
      } catch (error) {
        return buildFailedBrandStatus(brand, generatedAt, error);
      }
    })
  );

  return {
    ok: true,
    generatedAt,
    sourceMode: "live_assembly",
    sourceVersion: SOURCE_VERSION,
    filters,
    summary: {
      brandCount: brandStatuses.length,
      healthyBrandCount: brandStatuses.filter((brand) => brand.healthy).length,
      sendingTodayBrandCount: brandStatuses.filter((brand) => brand.sendingToday).length,
      blockedBrandCount: brandStatuses.filter((brand) => brand.primaryBlockerDomain !== "none").length,
      dispatchableBrandCount: brandStatuses.filter((brand) => brand.capacitySummary.dispatchableNow).length,
      dueMessageCount: brandStatuses.reduce(
        (sum, brand) => sum + brand.executionSummary.dueMessageCount,
        0
      ),
    },
    brands: brandStatuses,
  };
}
