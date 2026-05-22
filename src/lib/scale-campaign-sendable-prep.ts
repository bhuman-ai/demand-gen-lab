import { listBrands } from "@/lib/factory-data";
import type { CampaignPrepTask, ScaleCampaignRecord } from "@/lib/factory-types";
import {
  ensureSenderOwnedScaleCampaignSourceExperiment,
  getScaleCampaignRecordById,
  listScaleCampaignRecords,
  resolveScaleCampaignLane,
} from "@/lib/experiment-data";
import {
  buildBrandWarmupPoolProspectTableConfigs,
  buildLegacyBrandWarmupPoolProspectTableConfig,
  buildCampaignProspectTableConfig,
  ensureEnrichAnythingProspectTable,
  refreshEnrichAnythingProspectTable,
  getEnrichAnythingProspectTableRows,
  getEnrichAnythingProspectTableState,
  summarizeProspectTableStates,
  runEnrichAnythingProspectTable,
} from "@/lib/enrichanything-live-table";
import {
  countScaleCampaignSendableLeadContacts,
  importScaleCampaignProspectRows,
  type ImportScaleCampaignProspectRowsResult,
} from "@/lib/scale-campaign-prospect-import";
import {
  emptyProspectLeadQualityPipeline,
  reverifyStoredOwnerLeads,
  WARMUP_IMPORT_LEAD_QUALITY_POLICY,
} from "@/lib/experiment-prospect-import";
import {
  claimOutreachLease,
  getCampaignPrepTask,
  releaseOutreachLease,
  upsertCampaignPrepTask,
} from "@/lib/outreach-data";
import {
  classifyScaleCampaignInventoryHealth,
  diagnoseScaleCampaignSendablePrep,
  isDependencyMisconfiguredMessage,
  isOperationalInventoryReady,
  minimumUsefulCampaignPrepRuntimeMs,
  minimumUnclippedCampaignPrepRuntimeMs,
  resolveEnrichAnythingPrepMaxRowsPerRun,
  resolveEnrichAnythingPrepRequestTimeoutMs,
  resolveScaleCampaignPrepLeadTargets,
  type ScaleCampaignInventoryHealth,
  shouldDeferHostManagedEnrichAnythingLiveTopUp,
} from "@/lib/outreach-prep-policy";
import { resolveEmailFinderApiBaseUrl } from "@/lib/outreach-providers";
import {
  allocateWarmupProspectRowsByReservoir,
  deriveWarmupTopicProfile,
} from "@/lib/warmup-sourcing";

const LIVE_TOP_UP_MIN_INTERVAL_MS = 20_000;
const WARMUP_LIVE_TOP_UP_ATTEMPT_SPACING_MS = 5_000;
const CAMPAIGN_PREP_LEASE_TTL_MS = 10 * 60 * 1000;
const CAMPAIGN_PREP_STALE_RUNNING_MS = 15 * 60 * 1000;
const CAMPAIGN_PREP_SOURCE_VERSION = "campaign-prep-v2";

function areEnrichAnythingTablesEnabled() {
  const raw = String(process.env.ENRICHANYTHING_TABLES_ENABLED ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

export type ScaleCampaignSendablePrepResult = {
  lane: "warmup" | "outbound";
  operationalTargetCount: number;
  targetCount: number;
  ready: boolean;
  dispatchable: boolean;
  inventoryHealth: ScaleCampaignInventoryHealth;
  blockingState:
    | "ready"
    | "needs_sourcing"
    | "dependency_misconfigured"
    | "invalid_inventory"
    | "blocked";
  blockingReason: string;
  blockingHint: string;
  hostManagedWorkspace: boolean;
  savedProspectCount: number;
  sendableLeadCount: number;
  sendableLeadRemaining: number;
  runsChecked: number;
  liveTopUpAttempted: boolean;
  liveTopUpAttempts: number;
  liveTopUpRunId: string;
  liveTopUpRowsAppended: number;
  liveTopUpStatus: string;
  liveTopUpError: string;
  queryExhausted: boolean;
} & ImportScaleCampaignProspectRowsResult;

export type ScaleCampaignSendablePrepTickResult = {
  brandsChecked: number;
  campaignsEligible: number;
  campaignsChecked: number;
  campaignsPrepared: number;
  campaignsReady: number;
  liveTopUpsAttempted: number;
  campaignsDeferred: number;
  budgetExhausted: boolean;
  errors: Array<{ brandId: string; campaignId: string; error: string }>;
};

type ScaleCampaignPrepCandidate = {
  brandId: string;
  campaignId: string;
  lane: "warmup" | "outbound";
  status: string;
  updatedAt: string;
  operationalTargetCount: number;
  targetCount: number;
};

function isHostManagedWorkspace(workspaceId: string) {
  return workspaceId.startsWith("lastb2b_");
}

function hasQuotaLikeTopUpError(message: string) {
  const normalized = String(message).toLowerCase();
  return (
    normalized.includes("credit") ||
    normalized.includes("quota") ||
    normalized.includes("free trial") ||
    normalized.includes("upgrade to resume automatic runs") ||
    normalized.includes("this managed workspace") ||
    normalized.includes("not enough credits remain") ||
    normalized.includes("too many requests") ||
    normalized.includes("rate limit")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function emptyImportResult(): ImportScaleCampaignProspectRowsResult {
  return {
    runId: "",
    status: "completed",
    attemptedCount: 0,
    importedCount: 0,
    storedLeadCount: 0,
    storedForVerificationCount: 0,
    skippedCount: 0,
    matchedCount: 0,
    dedupedCount: 0,
    parseErrorCount: 0,
    parseErrors: [],
    enrichmentError: "",
    failureSummary: [],
    autoLaunchAttempted: false,
    autoLaunchTriggered: false,
    autoLaunchBlocked: false,
    autoLaunchRunId: "",
    autoLaunchReason: "",
    qualityPipeline: emptyProspectLeadQualityPipeline(),
    qualityRejectionSummary: [],
    backgroundBatchCandidateCount: 0,
    backgroundBatchOffset: 0,
    backgroundBatchTotalCandidates: 0,
    backgroundBatchTruncated: false,
  };
}

function warmupReservoirSenderKey(campaign: {
  scalePolicy?: { accountId?: string; mailboxAccountId?: string } | null;
  sourceExperimentId?: string;
  id?: string;
}) {
  return (
    String(campaign.scalePolicy?.accountId ?? "").trim() ||
    String(campaign.scalePolicy?.mailboxAccountId ?? "").trim() ||
    String(campaign.sourceExperimentId ?? "").trim() ||
    String(campaign.id ?? "").trim() ||
    "default"
  );
}

function buildWarmupReservoirRowsForCampaign(
  campaign: {
    id?: string;
    name: string;
    sourceExperimentId?: string;
    snapshot: { audience: string; offer: string };
    scalePolicy: { lane?: string; accountId?: string; mailboxAccountId?: string } | null;
  },
  reservoirs: Array<{ tableId: string; rows: unknown[] }>
) {
  if (
    resolveScaleCampaignLane({
      name: campaign.name,
      scalePolicy: (campaign.scalePolicy ?? {}) as ScaleCampaignRecord["scalePolicy"],
    }) !== "warmup"
  ) {
    return reservoirs.flatMap((reservoir) => reservoir.rows);
  }

  const profile = deriveWarmupTopicProfile({
    audience: campaign.snapshot.audience,
    offer: campaign.snapshot.offer,
    fallbackName: campaign.name,
  });
  const laneIds = profile.laneIds;
  return allocateWarmupProspectRowsByReservoir({
    audience: campaign.snapshot.audience,
    offer: campaign.snapshot.offer,
    fallbackName: campaign.name,
    senderKey: warmupReservoirSenderKey(campaign),
    reservoirs: reservoirs.map((reservoir, index) => ({
      laneId: laneIds[index] ?? laneIds[laneIds.length - 1] ?? "outbound",
      rows: reservoir.rows,
    })),
  }).rows;
}

function canAttemptLiveTopUp(lastRunAt: string, attemptNumber: number) {
  const lastRunAtMs = lastRunAt ? Date.parse(lastRunAt) : Number.NaN;
  return (
    attemptNumber > 0 ||
    !Number.isFinite(lastRunAtMs) ||
    Date.now() - lastRunAtMs >= LIVE_TOP_UP_MIN_INTERVAL_MS
  );
}

function pickWarmupReservoirForLiveTopUp(
  states: Array<{ tableId: string; rowCount: number; order: number }>
) {
  return [...states].sort((left, right) => {
    if (left.rowCount !== right.rowCount) {
      return left.rowCount - right.rowCount;
    }
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.tableId.localeCompare(right.tableId);
  })[0] ?? null;
}

function resolveLiveTopUpPassLimit(input: {
  allowLiveTopUp?: boolean;
  deferLiveTopUp: boolean;
  lane: "warmup" | "outbound";
  requestedPasses?: number;
  reservoirCount: number;
}) {
  if (!input.allowLiveTopUp || input.deferLiveTopUp) {
    return 0;
  }

  const reservoirCount = Math.max(1, Math.trunc(input.reservoirCount) || 1);
  const defaultPasses = input.lane === "warmup" ? Math.min(8, reservoirCount) : 1;
  const requestedPasses = Math.trunc(Number(input.requestedPasses ?? defaultPasses) || defaultPasses);
  const maxPasses = input.lane === "warmup" ? Math.max(3, Math.min(8, reservoirCount * 2)) : 3;
  return Math.max(1, Math.min(maxPasses, requestedPasses));
}

function pickNextWarmupTopUpReservoir(input: {
  candidates: Array<{ tableId: string; rowCount: number; order: number }>;
  attemptedTableIds: Set<string>;
}) {
  if (!input.candidates.length) {
    return null;
  }

  const freshCandidates = input.candidates.filter((state) => !input.attemptedTableIds.has(state.tableId));
  if (freshCandidates.length) {
    return pickWarmupReservoirForLiveTopUp(freshCandidates);
  }

  input.attemptedTableIds.clear();
  return pickWarmupReservoirForLiveTopUp(input.candidates);
}

function pickWarmupReservoirForRecovery(
  states: Array<{ tableId: string; rowCount: number; order: number; lastStatus: string; lastError: string }>
) {
  return [...states].sort((left, right) => {
    const leftFailed = String(left.lastStatus ?? "").trim().toLowerCase() === "failed" ? 0 : 1;
    const rightFailed = String(right.lastStatus ?? "").trim().toLowerCase() === "failed" ? 0 : 1;
    if (leftFailed !== rightFailed) {
      return leftFailed - rightFailed;
    }
    const leftErrored = String(left.lastError ?? "").trim() ? 0 : 1;
    const rightErrored = String(right.lastError ?? "").trim() ? 0 : 1;
    if (leftErrored !== rightErrored) {
      return leftErrored - rightErrored;
    }
    if (left.rowCount !== right.rowCount) {
      return left.rowCount - right.rowCount;
    }
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.tableId.localeCompare(right.tableId);
  })[0] ?? null;
}

function shouldResetWarmupRecoveryRows(input: { rowCount: number; dailyRowTarget: number }) {
  return input.rowCount > 0 && input.rowCount <= Math.max(2, input.dailyRowTarget);
}

function isSenderOwnedScaleCampaign(input: {
  scalePolicy?: { accountId?: string; mailboxAccountId?: string } | null;
}) {
  return Boolean(
    String(input.scalePolicy?.accountId ?? "").trim() ||
      String(input.scalePolicy?.mailboxAccountId ?? "").trim()
  );
}

function shouldPrepareScaleCampaignInBackground(input: {
  status?: string;
  snapshot?: { offer?: string; audience?: string } | null;
  scalePolicy?: { accountId?: string; mailboxAccountId?: string } | null;
}) {
  if (!isSenderOwnedScaleCampaign(input)) {
    return false;
  }
  if (!String(input.snapshot?.offer ?? "").trim() || !String(input.snapshot?.audience ?? "").trim()) {
    return false;
  }
  return !["archived", "completed"].includes(String(input.status ?? "").trim().toLowerCase());
}

function resolvePrepTargets(campaign: {
  scalePolicy?: { dailyCap?: number } | null;
  name?: string;
}) {
  const lane = resolveScaleCampaignLane(campaign as Pick<ScaleCampaignRecord, "name" | "scalePolicy">);
  return {
    lane,
    ...resolveScaleCampaignPrepLeadTargets({
      lane,
      scalePolicy: campaign.scalePolicy,
    }),
  };
}

function compareScaleCampaignPrepCandidates(
  left: ScaleCampaignPrepCandidate,
  right: ScaleCampaignPrepCandidate
) {
  if (left.lane !== right.lane) {
    return left.lane === "outbound" ? -1 : 1;
  }

  const leftStatus = String(left.status ?? "").trim().toLowerCase();
  const rightStatus = String(right.status ?? "").trim().toLowerCase();
  const leftStatusRank = leftStatus === "active" ? 0 : leftStatus === "paused" ? 1 : 2;
  const rightStatusRank = rightStatus === "active" ? 0 : rightStatus === "paused" ? 1 : 2;
  if (leftStatusRank !== rightStatusRank) {
    return leftStatusRank - rightStatusRank;
  }

  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt < right.updatedAt ? -1 : 1;
  }

  return left.campaignId.localeCompare(right.campaignId);
}

function addMinutesIso(minutes: number, base = Date.now()) {
  return new Date(base + Math.max(0, minutes) * 60_000).toISOString();
}

function addMillisecondsIso(milliseconds: number, base = Date.now()) {
  return new Date(base + Math.max(0, milliseconds)).toISOString();
}

function parseTime(value: string) {
  const ms = Date.parse(String(value ?? "").trim());
  return Number.isFinite(ms) ? ms : 0;
}

function isStaleRunningPrepTask(task: CampaignPrepTask | null, nowMs: number) {
  if (!task || task.status !== "running") return false;
  const startedAtMs = parseTime(task.startedAt || task.updatedAt);
  if (!startedAtMs) return true;
  return nowMs - startedAtMs >= CAMPAIGN_PREP_STALE_RUNNING_MS;
}

function prepTaskRetryMinutes(blockerCode: CampaignPrepTask["blockerCode"], attempt: number) {
  if (blockerCode === "dependency_misconfigured") return 15;
  if (blockerCode === "needs_sourcing") return 30;
  if (blockerCode === "invalid_inventory") return 30;
  if (blockerCode === "blocked") return 20;
  return Math.min(60, Math.max(5, attempt * 5));
}

function mapPrepBlockingStateToTaskBlockerCode(
  blockingState: ScaleCampaignSendablePrepResult["blockingState"]
): CampaignPrepTask["blockerCode"] {
  if (blockingState === "needs_sourcing") return "needs_sourcing";
  if (blockingState === "dependency_misconfigured") return "dependency_misconfigured";
  if (blockingState === "invalid_inventory") return "invalid_inventory";
  if (blockingState === "blocked") return "blocked";
  if (blockingState === "ready") return "none";
  return "unknown";
}

function buildPrepTaskProgress(input: {
  lane: "warmup" | "outbound";
  operationalTargetCount: number;
  targetCount: number;
  sendableLeadCount: number;
  runsChecked: number;
  prep?: ScaleCampaignSendablePrepResult;
}) {
  const ready = isOperationalInventoryReady({
    lane: input.lane,
    sendableLeadCount: input.sendableLeadCount,
    readyThresholdCount: input.operationalTargetCount,
  });
  const inventoryHealth =
    input.prep?.inventoryHealth ??
    classifyScaleCampaignInventoryHealth({
      lane: input.lane,
      targetCount: input.targetCount,
      sendableLeadCount: input.sendableLeadCount,
    });
  return {
    lane: input.lane,
    operationalTargetCount: input.operationalTargetCount,
    targetCount: input.targetCount,
    ready,
    dispatchable: input.sendableLeadCount > 0,
    inventoryHealth,
    sendableLeadCount: input.sendableLeadCount,
    runsChecked: input.runsChecked,
    sendableLeadRemaining: Math.max(0, input.targetCount - input.sendableLeadCount),
    ...(input.prep
      ? {
          savedProspectCount: input.prep.savedProspectCount,
          hostManagedWorkspace: input.prep.hostManagedWorkspace,
          liveTopUpAttempted: input.prep.liveTopUpAttempted,
          liveTopUpAttempts: input.prep.liveTopUpAttempts,
          liveTopUpRunId: input.prep.liveTopUpRunId,
          liveTopUpRowsAppended: input.prep.liveTopUpRowsAppended,
          liveTopUpStatus: input.prep.liveTopUpStatus,
          liveTopUpError: input.prep.liveTopUpError,
          queryExhausted: input.prep.queryExhausted,
          attemptedCount: input.prep.attemptedCount,
          importedCount: input.prep.importedCount,
          skippedCount: input.prep.skippedCount,
          matchedCount: input.prep.matchedCount,
          dedupedCount: input.prep.dedupedCount,
          parseErrorCount: input.prep.parseErrorCount,
          enrichmentError: input.prep.enrichmentError,
          failureSummary: input.prep.failureSummary,
          qualityRejectionSummary: input.prep.qualityRejectionSummary,
        }
      : {}),
  };
}

function readyTaskSummary(input: {
  lane: "warmup" | "outbound";
  targetCount: number;
  sendableLeadCount: number;
  inventoryHealth?: ScaleCampaignInventoryHealth;
}) {
  const inventoryHealth =
    input.inventoryHealth ??
    classifyScaleCampaignInventoryHealth({
      lane: input.lane,
      targetCount: input.targetCount,
      sendableLeadCount: input.sendableLeadCount,
    });

  if (input.lane === "warmup") {
    if (inventoryHealth === "usable") {
      return `Warmup inventory is usable with ${input.sendableLeadCount} sendable contacts. Dispatch can run while the pool tops up toward ${input.targetCount}.`;
    }
    if (inventoryHealth === "surplus") {
      return `Warmup inventory is healthy with ${input.sendableLeadCount} sendable contacts, above the pool target of ${input.targetCount}.`;
    }
    return `Warmup inventory is ready with ${input.sendableLeadCount} sendable contacts.`;
  }

  return `Lead inventory is ready with ${input.sendableLeadCount}/${input.targetCount} sendable contacts.`;
}

function resolveBackgroundImportTimeoutMs(prepTimeoutMs?: number) {
  const totalBudgetMs = Math.trunc(Number(prepTimeoutMs ?? 0) || 0);
  if (!Number.isFinite(totalBudgetMs) || totalBudgetMs <= 0) {
    return undefined;
  }
  return Math.max(5_000, totalBudgetMs - 3_000);
}

async function withPrepTimeout<T>(task: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const normalizedTimeoutMs = Math.max(1_000, Math.trunc(timeoutMs));
  return Promise.race<T>([
    task(),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${normalizedTimeoutMs}ms`)), normalizedTimeoutMs);
    }),
  ]);
}

async function mapSerial<T, R>(items: T[], iteratee: (item: T, index: number) => Promise<R>) {
  const results: R[] = [];
  for (const [index, item] of items.entries()) {
    results.push(await iteratee(item, index));
  }
  return results;
}

export async function prepareScaleCampaignSendableContacts(input: {
  brandId: string;
  campaignId: string;
  requestOrigin?: string;
  emailFinderApiBaseUrl?: string;
  allowLiveTopUp?: boolean;
  backgroundMode?: boolean;
  prepAttempt?: number;
  prepTimeoutMs?: number;
  maxLiveTopUpPasses?: number;
  enrichAnythingRunTimeoutMs?: number;
}): Promise<ScaleCampaignSendablePrepResult> {
  let campaign = await getScaleCampaignRecordById(input.brandId, input.campaignId);
  if (!campaign) {
    throw new Error("campaign not found");
  }
  if (isSenderOwnedScaleCampaign(campaign)) {
    const isolated = await ensureSenderOwnedScaleCampaignSourceExperiment({
      brandId: input.brandId,
      campaignId: input.campaignId,
    });
    campaign = isolated.campaign;
  }

  const { lane, readyThresholdCount, targetCount: targetSendableContacts } = resolvePrepTargets(campaign);
  const isWarmupCampaign = lane === "warmup";
  const configs = isWarmupCampaign
    ? buildBrandWarmupPoolProspectTableConfigs(campaign)
    : [buildCampaignProspectTableConfig(campaign)];
  const primaryConfig = configs[0];
  if (!primaryConfig) {
    throw new Error("prospect table config is not available");
  }
  const hostManagedWorkspace = isHostManagedWorkspace(primaryConfig.workspaceId);
  const qualityPolicy = isWarmupCampaign ? WARMUP_IMPORT_LEAD_QUALITY_POLICY : undefined;
  const emailFinderApiBaseUrl = resolveEmailFinderApiBaseUrl(input.emailFinderApiBaseUrl);
  const liveRunTimeoutMs = resolveEnrichAnythingPrepRequestTimeoutMs(input.enrichAnythingRunTimeoutMs);
  const liveTopUpMaxRowsPerRun = resolveEnrichAnythingPrepMaxRowsPerRun();
  const backgroundImportTimeoutMs = input.backgroundMode
    ? resolveBackgroundImportTimeoutMs(input.prepTimeoutMs)
    : undefined;
  const existingSendableSummary = await countScaleCampaignSendableLeadContacts(
    input.brandId,
    input.campaignId
  );
  const existingInventoryHealth = classifyScaleCampaignInventoryHealth({
    lane,
    targetCount: targetSendableContacts,
    sendableLeadCount: existingSendableSummary.sendableLeadCount,
  });
  if (
    isOperationalInventoryReady({
      lane,
      sendableLeadCount: existingSendableSummary.sendableLeadCount,
      readyThresholdCount,
    })
  ) {
    return {
      lane,
      operationalTargetCount: readyThresholdCount,
      targetCount: targetSendableContacts,
      ready: true,
      dispatchable: existingSendableSummary.sendableLeadCount > 0,
      inventoryHealth: existingInventoryHealth,
      blockingState: "ready",
      blockingReason: readyTaskSummary({
        lane,
        targetCount: targetSendableContacts,
        sendableLeadCount: existingSendableSummary.sendableLeadCount,
        inventoryHealth: existingInventoryHealth,
      }),
      blockingHint: "",
      hostManagedWorkspace,
      savedProspectCount: existingSendableSummary.sendableLeadCount,
      sendableLeadCount: existingSendableSummary.sendableLeadCount,
      sendableLeadRemaining: 0,
      runsChecked: existingSendableSummary.runsChecked,
      liveTopUpAttempted: false,
      liveTopUpAttempts: 0,
      liveTopUpRunId: "",
      liveTopUpRowsAppended: 0,
      liveTopUpStatus: "",
      liveTopUpError: "",
      queryExhausted: false,
      ...emptyImportResult(),
    };
  }

  let legacyWarmupState = null as Awaited<ReturnType<typeof getEnrichAnythingProspectTableState>> | null;
  let legacyWarmupRows = [] as unknown[];
  const tableStates = await mapSerial(configs, (config) => ensureEnrichAnythingProspectTable(config));
  const tableRows = await mapSerial(
    tableStates,
    (state) => (state.rowCount > 0 ? getEnrichAnythingProspectTableRows(state) : Promise.resolve([] as unknown[]))
  );
  let tableSummary = summarizeProspectTableStates(tableStates);
  if (isWarmupCampaign && tableSummary.rowCount <= 0) {
    try {
      const legacyConfig = buildLegacyBrandWarmupPoolProspectTableConfig(campaign);
      legacyWarmupState = await getEnrichAnythingProspectTableState(legacyConfig);
      legacyWarmupRows =
        legacyWarmupState.rowCount > 0 ? await getEnrichAnythingProspectTableRows(legacyConfig) : [];
    } catch {
      legacyWarmupState = null;
      legacyWarmupRows = [];
    }
  }
  let rows = buildWarmupReservoirRowsForCampaign(
    campaign,
    tableSummary.rowCount > 0 || !legacyWarmupRows.length
      ? tableStates.map((state, index) => ({
          tableId: state.tableId,
          rows: tableRows[index] ?? [],
        }))
      : [
          {
            tableId: legacyWarmupState?.tableId ?? "legacy_warmup_pool",
            rows: legacyWarmupRows,
          },
        ]
  );
  let effectiveSavedProspectCount =
    tableSummary.rowCount > 0 ? tableSummary.rowCount : Math.max(0, legacyWarmupState?.rowCount ?? 0);
  let effectiveTableStatus =
    tableSummary.lastStatus || (tableSummary.rowCount <= 0 ? String(legacyWarmupState?.lastStatus ?? "") : "");
  let effectiveTableError =
    tableSummary.lastError || (tableSummary.rowCount <= 0 ? String(legacyWarmupState?.lastError ?? "") : "");
  const effectiveTableTitle = isWarmupCampaign
    ? tableSummary.tableIds.join(",") ||
      String(legacyWarmupState?.tableId ?? "").trim() ||
      "warmup reservoirs"
    : primaryConfig.tableTitle;
  const effectivePrompt = isWarmupCampaign
    ? tableStates.map((state) => state.discoveryPrompt).join(" | ")
    : primaryConfig.discoveryPrompt;

  let importResult =
    rows.length > 0
      ? await importScaleCampaignProspectRows({
          brandId: input.brandId,
          campaignId: input.campaignId,
          rows,
          requestOrigin: input.requestOrigin,
          emailFinderApiBaseUrl,
          tableTitle: effectiveTableTitle,
          prompt: effectivePrompt,
          entityType: primaryConfig.entityType,
          backgroundMode: input.backgroundMode,
          prepAttempt: input.prepAttempt,
          emailFinderTimeoutMs: backgroundImportTimeoutMs,
        })
      : emptyImportResult();

  await reverifyStoredOwnerLeads({
    brandId: input.brandId,
    ownerType: "campaign",
    ownerId: campaign.id,
    qualityPolicy,
    oneContactPerCompany: false,
  });

  let sendableSummary = await countScaleCampaignSendableLeadContacts(input.brandId, input.campaignId);
  let liveTopUpAttempted = false;
  let liveTopUpAttempts = 0;
  let liveTopUpRunId = "";
  let liveTopUpRowsAppended = 0;
  let liveTopUpStatus = "";
  let liveTopUpError = "";
  let queryExhausted = false;
  const deferHostManagedLiveTopUp = shouldDeferHostManagedEnrichAnythingLiveTopUp({
    allowLiveTopUp: input.allowLiveTopUp,
    backgroundMode: input.backgroundMode,
    hostManagedWorkspace,
    lane,
  });
  if (deferHostManagedLiveTopUp) {
    liveTopUpStatus = "deferred";
  }
  const maxLiveTopUpPasses = resolveLiveTopUpPassLimit({
    allowLiveTopUp: input.allowLiveTopUp,
    deferLiveTopUp: deferHostManagedLiveTopUp,
    lane,
    requestedPasses: input.maxLiveTopUpPasses,
    reservoirCount: configs.length,
  });
  const attemptedWarmupTopUpTableIds = new Set<string>();

  while (liveTopUpAttempts < maxLiveTopUpPasses && sendableSummary.sendableLeadCount < targetSendableContacts) {
    const topUpCandidates = tableStates
      .map((state, index) => ({
        tableId: state.tableId,
        rowCount: state.rowCount,
        order: index,
        lastRunAt: state.lastRunAt,
      }))
      .filter((state) => canAttemptLiveTopUp(state.lastRunAt, liveTopUpAttempts));
    const candidateTopUp =
      isWarmupCampaign
        ? pickNextWarmupTopUpReservoir({
            candidates: topUpCandidates,
            attemptedTableIds: attemptedWarmupTopUpTableIds,
          })
        : topUpCandidates[0] ?? null;
    const nextConfigIndex = candidateTopUp
      ? tableStates.findIndex((state) => state.tableId === candidateTopUp.tableId)
      : -1;
    if (nextConfigIndex < 0) {
      break;
    }
    const nextConfig = configs[nextConfigIndex] ?? null;
    const nextState = tableStates[nextConfigIndex] ?? null;
    if (!nextConfig || !nextState) {
      break;
    }

    liveTopUpAttempted = true;
    liveTopUpAttempts += 1;
    if (isWarmupCampaign) {
      attemptedWarmupTopUpTableIds.add(nextState.tableId);
    }
    try {
      if (isWarmupCampaign && liveTopUpAttempts > 1) {
        await sleep(WARMUP_LIVE_TOP_UP_ATTEMPT_SPACING_MS);
      }
      const previousSendableLeadCount = sendableSummary.sendableLeadCount;
      const previousReservoirRowCount = tableRows[nextConfigIndex]?.length ?? 0;
      const liveRun = await runEnrichAnythingProspectTable(nextConfig, {
        timeoutMs: liveRunTimeoutMs,
        maxRowsPerRun: liveTopUpMaxRowsPerRun,
      });
      liveTopUpRunId = liveRun.runId;
      liveTopUpRowsAppended = liveRun.lastRowsAppended;
      liveTopUpStatus = liveRun.runStatus === "completed" ? liveRun.lastStatus : liveRun.runStatus;
      tableStates[nextConfigIndex] = liveRun;
      tableSummary = summarizeProspectTableStates(tableStates);
      if (tableSummary.rowCount > 0) {
        effectiveSavedProspectCount = tableSummary.rowCount;
        effectiveTableStatus = tableSummary.lastStatus;
        effectiveTableError = tableSummary.lastError;
      }

      if (liveRun.runStatus !== "completed") {
        effectiveTableStatus = liveTopUpStatus;
        effectiveTableError = liveRun.lastError;
        if (
          isWarmupCampaign &&
          liveTopUpAttempts < maxLiveTopUpPasses &&
          sendableSummary.sendableLeadCount < targetSendableContacts
        ) {
          continue;
        }
        break;
      }

      if (liveTopUpRowsAppended > 0 || liveRun.rowCount > previousReservoirRowCount) {
        tableRows[nextConfigIndex] =
          liveRun.rowCount > 0 ? await getEnrichAnythingProspectTableRows(nextConfig) : [];
        rows = buildWarmupReservoirRowsForCampaign(
          campaign,
          tableStates.map((state, index) => ({
            tableId: state.tableId,
            rows: tableRows[index] ?? [],
          }))
        );
        importResult =
          rows.length > 0
            ? await importScaleCampaignProspectRows({
                brandId: input.brandId,
                campaignId: input.campaignId,
                rows,
                requestOrigin: input.requestOrigin,
                emailFinderApiBaseUrl,
                tableTitle: effectiveTableTitle,
                prompt: effectivePrompt,
                entityType: primaryConfig.entityType,
                backgroundMode: input.backgroundMode,
                prepAttempt: input.prepAttempt,
                emailFinderTimeoutMs: backgroundImportTimeoutMs,
              })
            : emptyImportResult();

        await reverifyStoredOwnerLeads({
          brandId: input.brandId,
          ownerType: "campaign",
          ownerId: campaign.id,
          qualityPolicy,
          oneContactPerCompany: false,
        });

        sendableSummary = await countScaleCampaignSendableLeadContacts(input.brandId, input.campaignId);
      } else {
        queryExhausted = !isWarmupCampaign && sendableSummary.sendableLeadCount < targetSendableContacts;
        if (!isWarmupCampaign || liveTopUpAttempts >= maxLiveTopUpPasses) {
          break;
        }
        continue;
      }

      const shouldRetryBecauseInventoryDidNotAdvance =
        sendableSummary.sendableLeadCount <= previousSendableLeadCount &&
        importResult.importedCount <= 0 &&
        liveTopUpAttempts < maxLiveTopUpPasses &&
        !queryExhausted &&
        !liveTopUpError &&
        (importResult.dedupedCount > 0 ||
          importResult.parseErrorCount > 0 ||
          importResult.qualityRejectionSummary.length > 0);

      if (
        isWarmupCampaign &&
        sendableSummary.sendableLeadCount < targetSendableContacts &&
        liveTopUpAttempts < maxLiveTopUpPasses
      ) {
        continue;
      }

      if (!shouldRetryBecauseInventoryDidNotAdvance) {
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Live prospect top-up failed.";
      if (hostManagedWorkspace && hasQuotaLikeTopUpError(message)) {
        liveTopUpStatus = "idle";
        liveTopUpError = "";
        tableStates[nextConfigIndex] = await ensureEnrichAnythingProspectTable(nextConfig);
        tableSummary = summarizeProspectTableStates(tableStates);
        if (tableSummary.rowCount > 0) {
          effectiveSavedProspectCount = tableSummary.rowCount;
          effectiveTableStatus = tableSummary.lastStatus;
          effectiveTableError = tableSummary.lastError;
        }
      } else {
        liveTopUpStatus = "failed";
        liveTopUpError = message;
        if (
          isWarmupCampaign &&
          liveTopUpAttempts < maxLiveTopUpPasses &&
          sendableSummary.sendableLeadCount < targetSendableContacts
        ) {
          continue;
        }
      }
      break;
    }
  }

  let inventoryHealth = classifyScaleCampaignInventoryHealth({
    lane,
    targetCount: targetSendableContacts,
    sendableLeadCount: sendableSummary.sendableLeadCount,
    savedProspectCount: effectiveSavedProspectCount,
    queryExhausted,
    tableLastStatus: effectiveTableStatus,
    tableLastError: effectiveTableError,
    parseErrorCount: importResult.parseErrorCount,
    qualityRejectionSummary: importResult.qualityRejectionSummary,
    failureSummary: importResult.failureSummary,
  });

  if (
    isWarmupCampaign &&
    inventoryHealth === "stale" &&
    maxLiveTopUpPasses > 0
  ) {
    const recoveryCandidate = pickWarmupReservoirForRecovery(
      tableStates.map((state, index) => ({
        tableId: state.tableId,
        rowCount: state.rowCount,
        order: index,
        lastStatus: state.lastStatus,
        lastError: state.lastError,
      }))
    );
    const recoveryConfigIndex = recoveryCandidate
      ? tableStates.findIndex((state) => state.tableId === recoveryCandidate.tableId)
      : -1;

    if (recoveryConfigIndex >= 0) {
      const recoveryConfig = configs[recoveryConfigIndex] ?? null;
      const recoveryState = tableStates[recoveryConfigIndex] ?? null;

      if (recoveryConfig && recoveryState) {
        try {
          tableStates[recoveryConfigIndex] = await refreshEnrichAnythingProspectTable(recoveryConfig, {
            resetRows: shouldResetWarmupRecoveryRows({
              rowCount: recoveryState.rowCount,
              dailyRowTarget: recoveryConfig.dailyRowTarget,
            }),
          });
          tableRows[recoveryConfigIndex] =
            tableStates[recoveryConfigIndex].rowCount > 0
              ? await getEnrichAnythingProspectTableRows(recoveryConfig)
              : [];
          tableSummary = summarizeProspectTableStates(tableStates);
          effectiveSavedProspectCount = tableSummary.rowCount;
          effectiveTableStatus = tableSummary.lastStatus;
          effectiveTableError = tableSummary.lastError;
          liveTopUpStatus = "recovered";
          liveTopUpError = "";

          liveTopUpAttempted = true;
          liveTopUpAttempts += 1;
          const recoveryRun = await runEnrichAnythingProspectTable(recoveryConfig, {
            timeoutMs: liveRunTimeoutMs,
            maxRowsPerRun: liveTopUpMaxRowsPerRun,
          });
          liveTopUpRunId = recoveryRun.runId;
          liveTopUpRowsAppended = recoveryRun.lastRowsAppended;
          liveTopUpStatus = recoveryRun.runStatus === "completed" ? recoveryRun.lastStatus : recoveryRun.runStatus;
          tableStates[recoveryConfigIndex] = recoveryRun;
          tableSummary = summarizeProspectTableStates(tableStates);
          effectiveSavedProspectCount = tableSummary.rowCount;
          effectiveTableStatus = tableSummary.lastStatus;
          effectiveTableError = tableSummary.lastError;

          if (recoveryRun.runStatus === "completed") {
            tableRows[recoveryConfigIndex] =
              recoveryRun.rowCount > 0 ? await getEnrichAnythingProspectTableRows(recoveryConfig) : [];
            rows = buildWarmupReservoirRowsForCampaign(
              campaign,
              tableStates.map((state, index) => ({
                tableId: state.tableId,
                rows: tableRows[index] ?? [],
              }))
            );
            importResult =
              rows.length > 0
                ? await importScaleCampaignProspectRows({
                    brandId: input.brandId,
                    campaignId: input.campaignId,
                    rows,
                    requestOrigin: input.requestOrigin,
                    emailFinderApiBaseUrl,
                    tableTitle: effectiveTableTitle,
                    prompt: effectivePrompt,
                    entityType: primaryConfig.entityType,
                    backgroundMode: input.backgroundMode,
                    prepAttempt: input.prepAttempt,
                    emailFinderTimeoutMs: backgroundImportTimeoutMs,
                  })
                : emptyImportResult();

            await reverifyStoredOwnerLeads({
              brandId: input.brandId,
              ownerType: "campaign",
              ownerId: campaign.id,
              qualityPolicy,
              oneContactPerCompany: false,
            });

            sendableSummary = await countScaleCampaignSendableLeadContacts(input.brandId, input.campaignId);
          } else {
            effectiveTableError = recoveryRun.lastError;
          }
        } catch (error) {
          liveTopUpStatus = "failed";
          liveTopUpError = error instanceof Error ? error.message : "Warmup stale recovery failed.";
        }
      }
    }

    inventoryHealth = classifyScaleCampaignInventoryHealth({
      lane,
      targetCount: targetSendableContacts,
      sendableLeadCount: sendableSummary.sendableLeadCount,
      savedProspectCount: effectiveSavedProspectCount,
      queryExhausted,
      tableLastStatus: effectiveTableStatus,
      tableLastError: effectiveTableError,
      parseErrorCount: importResult.parseErrorCount,
      qualityRejectionSummary: importResult.qualityRejectionSummary,
      failureSummary: importResult.failureSummary,
    });
  }

  const diagnosis = diagnoseScaleCampaignSendablePrep({
    lane,
    readyThresholdCount,
    targetCount: targetSendableContacts,
    tablesEnabled: tableSummary.enabled || effectiveSavedProspectCount > 0,
    savedProspectCount: effectiveSavedProspectCount,
    sendableLeadCount: sendableSummary.sendableLeadCount,
    queryExhausted,
    tableLastStatus: effectiveTableStatus,
    tableLastError: effectiveTableError,
    liveTopUpError,
    enrichmentError: importResult.enrichmentError,
    parseErrorCount: importResult.parseErrorCount,
    qualityRejectionSummary: importResult.qualityRejectionSummary,
    failureSummary: importResult.failureSummary,
    inventoryLabel: isWarmupCampaign ? "Warmup inventory" : "Campaign-owned inventory",
    sourcingLabel: isWarmupCampaign ? "warmup lane reservoirs" : "campaign prospect table",
  });

  const ready = isOperationalInventoryReady({
    lane,
    sendableLeadCount: sendableSummary.sendableLeadCount,
    readyThresholdCount,
  });

  return {
    lane,
    operationalTargetCount: readyThresholdCount,
    targetCount: targetSendableContacts,
    ready,
    dispatchable: sendableSummary.sendableLeadCount > 0,
    inventoryHealth: diagnosis.inventoryHealth,
    blockingState: diagnosis.blockingState,
    blockingReason:
      ready
        ? diagnosis.blockingReason ||
          readyTaskSummary({
            lane,
            targetCount: targetSendableContacts,
            sendableLeadCount: sendableSummary.sendableLeadCount,
            inventoryHealth: diagnosis.inventoryHealth,
          })
        : diagnosis.blockingReason,
    blockingHint: diagnosis.blockingHint,
    hostManagedWorkspace,
    savedProspectCount: effectiveSavedProspectCount,
    sendableLeadCount: sendableSummary.sendableLeadCount,
    sendableLeadRemaining: Math.max(0, targetSendableContacts - sendableSummary.sendableLeadCount),
    runsChecked: sendableSummary.runsChecked,
    liveTopUpAttempted,
    liveTopUpAttempts,
    liveTopUpRunId,
    liveTopUpRowsAppended,
    liveTopUpStatus,
    liveTopUpError,
    queryExhausted,
    ...importResult,
  };
}

export async function runScaleCampaignSendablePrepTick(
  limit = 12,
  options: {
    requestOrigin?: string;
    emailFinderApiBaseUrl?: string;
    maxRuntimeMs?: number;
    maxCampaignPrepMs?: number;
  } = {}
): Promise<ScaleCampaignSendablePrepTickResult> {
  if (!areEnrichAnythingTablesEnabled()) {
    return {
      brandsChecked: 0,
      campaignsEligible: 0,
      campaignsChecked: 0,
      campaignsPrepared: 0,
      campaignsReady: 0,
      liveTopUpsAttempted: 0,
      campaignsDeferred: 0,
      budgetExhausted: false,
      errors: [],
    };
  }
  const brands = await listBrands();
  const startedAtMs = Date.now();
  const maxRuntimeMs = Math.max(5_000, Math.min(55_000, Math.trunc(Number(options.maxRuntimeMs ?? 45_000) || 45_000)));
  const maxCampaignPrepMs = Math.max(
    5_000,
    Math.min(
      maxRuntimeMs,
      Math.trunc(Number(options.maxCampaignPrepMs ?? Math.min(40_000, maxRuntimeMs)) || Math.min(40_000, maxRuntimeMs))
    )
  );
  const results: ScaleCampaignSendablePrepTickResult = {
    brandsChecked: brands.length,
    campaignsEligible: 0,
    campaignsChecked: 0,
    campaignsPrepared: 0,
    campaignsReady: 0,
    liveTopUpsAttempted: 0,
    campaignsDeferred: 0,
    budgetExhausted: false,
    errors: [],
  };
  const preferredEnrichAnythingRunTimeoutMs = resolveEnrichAnythingPrepRequestTimeoutMs();
  const minimumUsefulCampaignPrepMs = minimumUsefulCampaignPrepRuntimeMs(maxCampaignPrepMs);
  const minimumUnclippedCampaignPrepMs = minimumUnclippedCampaignPrepRuntimeMs(maxCampaignPrepMs);

  const emailFinderApiBaseUrl =
    resolveEmailFinderApiBaseUrl(options.emailFinderApiBaseUrl) ||
    (options.requestOrigin
      ? `${options.requestOrigin.replace(/\/+$/, "")}/api/internal/email-finder`
      : "");

  const candidates: ScaleCampaignPrepCandidate[] = [];
  for (const brand of brands) {
    const campaigns = await listScaleCampaignRecords(brand.id);

    for (const campaign of campaigns) {
      if (!shouldPrepareScaleCampaignInBackground(campaign)) {
        continue;
      }

      results.campaignsEligible += 1;
      const prepTargets = resolvePrepTargets(campaign);
      candidates.push({
        brandId: brand.id,
        campaignId: campaign.id,
        lane: prepTargets.lane,
        status: campaign.status,
        updatedAt: campaign.updatedAt,
        operationalTargetCount: prepTargets.readyThresholdCount,
        targetCount: prepTargets.targetCount,
      });
    }
  }

  results.campaignsEligible = candidates.length;
  candidates.sort(compareScaleCampaignPrepCandidates);
  results.campaignsChecked = candidates.length;
  let deferredNeedsPrep = 0;
  const processable: Array<{
    candidate: ScaleCampaignPrepCandidate;
    task: CampaignPrepTask;
    sendableLeadCount: number;
    runsChecked: number;
  }> = [];

  for (const candidate of candidates) {
    const before = await countScaleCampaignSendableLeadContacts(candidate.brandId, candidate.campaignId);
    const existingTask = await getCampaignPrepTask(candidate.brandId, candidate.campaignId, {
      allowMissingTable: true,
    });

    if (
      isOperationalInventoryReady({
        lane: candidate.lane,
        sendableLeadCount: before.sendableLeadCount,
        readyThresholdCount: candidate.operationalTargetCount,
      })
    ) {
      results.campaignsReady += 1;
      await upsertCampaignPrepTask({
        id: existingTask?.id,
        brandId: candidate.brandId,
        campaignId: candidate.campaignId,
        lane: candidate.lane,
        status: "ready",
        attempt: existingTask?.attempt ?? 0,
        executeAfter: addMinutesIso(30),
        startedAt: existingTask?.startedAt ?? "",
        finishedAt: existingTask?.finishedAt || new Date().toISOString(),
        blockerCode: "none",
        summary: readyTaskSummary({
          lane: candidate.lane,
          targetCount: candidate.targetCount,
          sendableLeadCount: before.sendableLeadCount,
        }),
        lastError: "",
        progress: buildPrepTaskProgress({
          lane: candidate.lane,
          operationalTargetCount: candidate.operationalTargetCount,
          targetCount: candidate.targetCount,
          sendableLeadCount: before.sendableLeadCount,
          runsChecked: before.runsChecked,
        }),
        sourceVersion: CAMPAIGN_PREP_SOURCE_VERSION,
      });
      continue;
    }

    const nowMs = Date.now();
    const staleRunning = isStaleRunningPrepTask(existingTask, nowMs);
    const existingProgress =
      existingTask?.progress && typeof existingTask.progress === "object" ? existingTask.progress : {};
    const nextStatus: CampaignPrepTask["status"] =
      staleRunning || !existingTask || existingTask.status === "ready" ? "queued" : existingTask.status;
    const nextTask = await upsertCampaignPrepTask({
      id: existingTask?.id,
      brandId: candidate.brandId,
      campaignId: candidate.campaignId,
      lane: candidate.lane,
      status: nextStatus,
      attempt: existingTask?.attempt ?? 0,
      executeAfter:
        staleRunning || !existingTask || existingTask.status === "ready"
          ? new Date().toISOString()
          : existingTask.executeAfter,
      startedAt: nextStatus === "running" && !staleRunning ? existingTask?.startedAt ?? "" : "",
      finishedAt: nextStatus === "running" && !staleRunning ? "" : existingTask?.finishedAt ?? "",
      blockerCode:
        nextStatus === "blocked" || nextStatus === "failed"
          ? existingTask?.blockerCode ?? "unknown"
          : "unknown",
      summary:
        staleRunning
          ? "Requeued stale campaign prep task."
          : existingTask?.summary || "Campaign prep queued for campaign-owned inventory.",
      lastError:
        staleRunning
          ? existingTask?.lastError
            ? `${existingTask.lastError}; stale prep task requeued`
            : "stale prep task requeued"
          : existingTask?.lastError ?? "",
      progress: {
        ...existingProgress,
        ...buildPrepTaskProgress({
          lane: candidate.lane,
          operationalTargetCount: candidate.operationalTargetCount,
          targetCount: candidate.targetCount,
          sendableLeadCount: before.sendableLeadCount,
          runsChecked: before.runsChecked,
        }),
      },
      sourceVersion: CAMPAIGN_PREP_SOURCE_VERSION,
    });

    if (nextTask.status === "running" && !staleRunning) {
      deferredNeedsPrep += 1;
      continue;
    }
    if (parseTime(nextTask.executeAfter) > Date.now()) {
      deferredNeedsPrep += 1;
      continue;
    }

    processable.push({
      candidate,
      task: nextTask,
      sendableLeadCount: before.sendableLeadCount,
      runsChecked: before.runsChecked,
    });
  }

  processable.sort((left, right) => {
    const candidateOrder = compareScaleCampaignPrepCandidates(left.candidate, right.candidate);
    if (candidateOrder !== 0) return candidateOrder;
    if (left.task.executeAfter === right.task.executeAfter) {
      return left.candidate.campaignId.localeCompare(right.candidate.campaignId);
    }
    return left.task.executeAfter < right.task.executeAfter ? -1 : 1;
  });

  for (let index = 0; index < processable.length; index += 1) {
    const item = processable[index];

    if (results.campaignsPrepared >= limit) {
      deferredNeedsPrep += processable.length - index;
      break;
    }
    if (Date.now() - startedAtMs >= maxRuntimeMs) {
      results.budgetExhausted = true;
      deferredNeedsPrep += processable.length - index;
      break;
    }

    const remainingRuntimeMs = maxRuntimeMs - (Date.now() - startedAtMs);
    if (remainingRuntimeMs < minimumUsefulCampaignPrepMs) {
      results.budgetExhausted = true;
      deferredNeedsPrep += processable.length - index;
      break;
    }
    if (remainingRuntimeMs < minimumUnclippedCampaignPrepMs) {
      results.budgetExhausted = true;
      deferredNeedsPrep += processable.length - index;
      break;
    }
    const prepTimeoutMs = maxCampaignPrepMs;
    const enrichAnythingRunTimeoutMs = Math.max(
      4_000,
      Math.min(prepTimeoutMs - 1_000, preferredEnrichAnythingRunTimeoutMs)
    );
    const lease = await claimOutreachLease({
      leaseType: "campaign_prep",
      scopeType: "campaign",
      scopeId: item.candidate.campaignId,
      holder: `campaign-prep:${item.candidate.campaignId}:${startedAtMs}`,
      expiresAt: addMillisecondsIso(CAMPAIGN_PREP_LEASE_TTL_MS),
      metadata: {
        brandId: item.candidate.brandId,
        campaignId: item.candidate.campaignId,
        lane: item.candidate.lane,
        operationalTargetCount: item.candidate.operationalTargetCount,
        targetCount: item.candidate.targetCount,
      },
    });
    if (!lease) {
      deferredNeedsPrep += 1;
      continue;
    }

    const runStartedAt = new Date().toISOString();
    const attempt = Math.max(0, item.task.attempt) + 1;
    results.campaignsPrepared += 1;
    await upsertCampaignPrepTask({
      id: item.task.id,
      brandId: item.candidate.brandId,
      campaignId: item.candidate.campaignId,
      lane: item.candidate.lane,
      status: "running",
      attempt,
      executeAfter: runStartedAt,
      startedAt: runStartedAt,
      finishedAt: "",
      blockerCode: "unknown",
      summary: "Preparing campaign-owned sendable inventory.",
      lastError: "",
      progress: {
        phase: "running",
        ...buildPrepTaskProgress({
          lane: item.candidate.lane,
          operationalTargetCount: item.candidate.operationalTargetCount,
          targetCount: item.candidate.targetCount,
          sendableLeadCount: item.sendableLeadCount,
          runsChecked: item.runsChecked,
        }),
      },
      sourceVersion: CAMPAIGN_PREP_SOURCE_VERSION,
    });

    try {
      const prep = await withPrepTimeout(
        () =>
          prepareScaleCampaignSendableContacts({
            brandId: item.candidate.brandId,
            campaignId: item.candidate.campaignId,
            requestOrigin: options.requestOrigin,
            emailFinderApiBaseUrl,
            allowLiveTopUp: true,
            backgroundMode: true,
            prepAttempt: attempt,
            prepTimeoutMs,
            maxLiveTopUpPasses: 1,
            enrichAnythingRunTimeoutMs,
          }),
        prepTimeoutMs,
        `campaign ${item.candidate.campaignId} prep`
      );
      if (prep.liveTopUpAttempted) {
        results.liveTopUpsAttempted += 1;
      }
      if (prep.ready) {
        results.campaignsReady += 1;
      }

      const blockerCode = mapPrepBlockingStateToTaskBlockerCode(prep.blockingState);
      await upsertCampaignPrepTask({
        id: item.task.id,
        brandId: item.candidate.brandId,
        campaignId: item.candidate.campaignId,
        lane: item.candidate.lane,
        status: prep.ready ? "ready" : "blocked",
        attempt,
        executeAfter: prep.ready ? addMinutesIso(30) : addMinutesIso(prepTaskRetryMinutes(blockerCode, attempt)),
        startedAt: runStartedAt,
        finishedAt: new Date().toISOString(),
        blockerCode,
        summary: prep.ready
          ? readyTaskSummary({
              lane: prep.lane,
              targetCount: prep.targetCount,
              sendableLeadCount: prep.sendableLeadCount,
              inventoryHealth: prep.inventoryHealth,
            })
          : prep.blockingReason || prep.blockingHint || "Campaign prep is blocked.",
        lastError: prep.ready ? "" : prep.liveTopUpError || prep.enrichmentError || "",
        progress: {
          phase: prep.ready ? "ready" : "blocked",
          ...buildPrepTaskProgress({
            lane: prep.lane,
            operationalTargetCount: prep.operationalTargetCount,
            targetCount: prep.targetCount,
            sendableLeadCount: prep.sendableLeadCount,
            runsChecked: prep.runsChecked,
            prep,
          }),
        },
        sourceVersion: CAMPAIGN_PREP_SOURCE_VERSION,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to prepare campaign sendable contacts.";
      const blockerCode = isDependencyMisconfiguredMessage(message) ? "dependency_misconfigured" : "unknown";
      const taskStatus: CampaignPrepTask["status"] = blockerCode === "dependency_misconfigured" ? "blocked" : "failed";
      results.errors.push({
        brandId: item.candidate.brandId,
        campaignId: item.candidate.campaignId,
        error: message,
      });
      await upsertCampaignPrepTask({
        id: item.task.id,
        brandId: item.candidate.brandId,
        campaignId: item.candidate.campaignId,
        lane: item.candidate.lane,
        status: taskStatus,
        attempt,
        executeAfter: addMinutesIso(prepTaskRetryMinutes(blockerCode, attempt)),
        startedAt: runStartedAt,
        finishedAt: new Date().toISOString(),
        blockerCode,
        summary: message,
        lastError: message,
        progress: {
          phase:
            blockerCode === "dependency_misconfigured"
              ? "blocked"
              : message.toLowerCase().includes("timed out")
                ? "timeout"
                : "failed",
          timeoutMs: prepTimeoutMs,
          ...buildPrepTaskProgress({
            lane: item.candidate.lane,
            operationalTargetCount: item.candidate.operationalTargetCount,
            targetCount: item.candidate.targetCount,
            sendableLeadCount: item.sendableLeadCount,
            runsChecked: item.runsChecked,
          }),
        },
        sourceVersion: CAMPAIGN_PREP_SOURCE_VERSION,
      });
    } finally {
      await releaseOutreachLease(lease.id, "campaign prep attempt finished", {
        allowMissingTable: true,
      });
    }
  }

  results.campaignsDeferred = deferredNeedsPrep;

  return results;
}
