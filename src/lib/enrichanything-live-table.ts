import type { ExperimentRecord, ScaleCampaignRecord } from "@/lib/factory-types";
import { clampExperimentSampleSize } from "@/lib/experiment-policy";
import { listExperimentRecords, listScaleCampaignRecords } from "@/lib/experiment-data";
import { resolveEnrichAnythingAppUrl } from "@/lib/enrichanything-app-url";
import { getBrandOutreachAssignment, getOutreachAccount } from "@/lib/outreach-data";
import { calculateSenderCapacityPolicy } from "@/lib/sender-capacity";

type ProspectTableConfig = {
  workspaceId: string;
  tableId: string;
  tableTitle: string;
  discoveryPrompt: string;
  enabled: boolean;
  entityType: "person";
  entityColumn: "person_name";
  cadence: "daily";
  dailyRowTarget: number;
  maxRowsPerRun: number;
  overlapHours: number;
  creditBudget: number | null;
};

type ProspectTableDiscoveryMeta = {
  promptSource?: "default" | "lookalike_seed" | "custom";
  lookalikeSeed?: {
    sourceCount: number;
    analyzedCount: number;
    summaryTags: string[];
    mode: "openai" | "heuristic";
    savedAt: string;
  } | null;
  reportLabel?: string;
  reportUrl?: string;
  topic?: string;
  audience?: string;
  qualityProfile?: string;
  questions?: string[];
} | null;

type ProspectTableState = ProspectTableConfig & {
  appUrl: string;
  rowCount: number;
  lastRunAt: string;
  lastStatus: string;
  lastRowsFound: number;
  lastRowsAppended: number;
  discoveryMeta: ProspectTableDiscoveryMeta;
};

type ProspectTableRunResult = ProspectTableState & {
  runId: string;
};

const DEFAULT_EXPERIMENT_PROSPECT_DAILY_ROW_TARGET = 100;
const DEFAULT_CAMPAIGN_PROSPECT_DAILY_ROW_TARGET = 100;
const MAX_PROSPECT_DAILY_ROW_TARGET = 20_000;
const DISCOVERY_ROWS_PER_SENDABLE_CONTACT = 3;
const DEFAULT_FALLBACK_SENDER_DAILY_CAP = 30;
const DEFAULT_CAMPAIGN_BACKLOG_DAYS = 14;
const DEFAULT_BUSINESS_HOURS_PER_DAY = 8;
const BILLING_STATUS_TIMEOUT_MS = 3_500;

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clampProspectDailyRowTarget(value: unknown, fallback: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_PROSPECT_DAILY_ROW_TARGET, parsed));
}

function resolveExperimentProspectDailyRowTarget(experiment: ExperimentRecord) {
  const sampleSize = clampExperimentSampleSize(experiment.testEnvelope.sampleSize);
  return clampProspectDailyRowTarget(
    Math.max(DEFAULT_EXPERIMENT_PROSPECT_DAILY_ROW_TARGET, sampleSize * 5),
    DEFAULT_EXPERIMENT_PROSPECT_DAILY_ROW_TARGET
  );
}

function resolveCampaignProspectDailyRowTarget(campaign: ScaleCampaignRecord) {
  const dailyCap = Math.max(1, Number(campaign.scalePolicy.dailyCap || 30) || 30);
  return clampProspectDailyRowTarget(
    Math.max(DEFAULT_CAMPAIGN_PROSPECT_DAILY_ROW_TARGET, dailyCap * 4),
    DEFAULT_CAMPAIGN_PROSPECT_DAILY_ROW_TARGET
  );
}

function resolveProspectMaxRowsPerRun(dailyRowTarget: number) {
  return clampProspectDailyRowTarget(dailyRowTarget, 1);
}

function shouldKeepExperimentProspectTableEnabled(experiment: ExperimentRecord) {
  return (
    Boolean(normalizeText(experiment.offer)) &&
    Boolean(normalizeText(experiment.audience)) &&
    experiment.status !== "archived" &&
    experiment.status !== "promoted"
  );
}

function buildDiscoveryPrompt(audience: string, offer: string, fallbackName: string) {
  const normalizedAudience = normalizeText(audience);
  const normalizedOffer = normalizeText(offer);
  const normalizedName = normalizeText(fallbackName) || "this experiment";

  if (normalizedAudience) {
    return normalizedAudience;
  }

  if (normalizedOffer) {
    return normalizedOffer;
  }

  return normalizedName;
}

function createSnapshot(config: ProspectTableConfig) {
  return {
    workspaceId: config.workspaceId,
    currentListId: config.tableId,
    activeTab: "search",
    discoveryPrompt: config.discoveryPrompt,
    discoveryMeta: null,
    entityColumn: config.entityColumn,
    entityType: config.entityType,
    tableTitle: config.tableTitle,
    csvText: "",
    rows: [],
    columns: [],
    result: null,
    liveTable: {
      tableId: config.tableId,
      workspaceId: config.workspaceId,
      enabled: config.enabled,
      cadence: config.cadence,
      dailyRowTarget: config.dailyRowTarget,
      maxRowsPerRun: config.maxRowsPerRun,
      overlapHours: config.overlapHours,
      creditBudget: config.creditBudget,
    },
    selectedRowIndex: 0,
    savedAt: new Date().toISOString(),
  };
}

function asObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeDiscoveryMeta(value: unknown): ProspectTableDiscoveryMeta {
  const meta = asObject(value);
  if (!Object.keys(meta).length) {
    return null;
  }

  const rawPromptSource = String(meta.promptSource ?? "").trim();
  const promptSource =
    rawPromptSource === "lookalike_seed"
      ? "lookalike_seed"
      : rawPromptSource === "custom"
        ? "custom"
        : "default";
  const lookalikeSeed = asObject(meta.lookalikeSeed);

  return {
    promptSource,
    lookalikeSeed: Object.keys(lookalikeSeed).length
      ? {
          sourceCount: Math.max(0, Number(lookalikeSeed.sourceCount ?? 0) || 0),
          analyzedCount: Math.max(0, Number(lookalikeSeed.analyzedCount ?? 0) || 0),
          summaryTags: Array.isArray(lookalikeSeed.summaryTags)
            ? lookalikeSeed.summaryTags
                .map((entry) => String(entry ?? "").trim())
                .filter(Boolean)
                .slice(0, 5)
            : [],
          mode: String(lookalikeSeed.mode ?? "").trim() === "openai" ? "openai" : "heuristic",
          savedAt: String(lookalikeSeed.savedAt ?? "").trim(),
        }
      : null,
    reportLabel: normalizeText(meta.reportLabel),
    reportUrl: normalizeText(meta.reportUrl),
    topic: normalizeText(meta.topic),
    audience: normalizeText(meta.audience),
    qualityProfile: normalizeText(meta.qualityProfile),
    questions: Array.isArray(meta.questions)
      ? meta.questions.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 6)
      : [],
  };
}

function resolveEffectiveConfig(config: ProspectTableConfig, existingTable: Record<string, unknown> | null) {
  if (!existingTable) {
    return config;
  }

  const snapshot = asObject(existingTable.snapshot);
  const discoveryMeta = normalizeDiscoveryMeta(snapshot.discoveryMeta);
  const snapshotPrompt = String(snapshot.discoveryPrompt ?? "").trim();

  if (
    (discoveryMeta?.promptSource === "lookalike_seed" ||
      discoveryMeta?.promptSource === "custom") &&
    snapshotPrompt
  ) {
    return {
      ...config,
      discoveryPrompt: snapshotPrompt,
    };
  }

  return config;
}

function countSnapshotRows(snapshot: unknown) {
  const value = asObject(snapshot);
  const rows = Array.isArray(value.rows) ? value.rows : [];
  return rows.filter((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return false;
    }
    return Object.values(row as Record<string, unknown>).some((cell) => String(cell ?? "").trim());
  }).length;
}

function mergeSnapshot(config: ProspectTableConfig, existingSnapshot: unknown = null) {
  const snapshot = asObject(existingSnapshot);
  const liveTable = asObject(snapshot.liveTable);

  return {
    ...createSnapshot(config),
    ...snapshot,
    workspaceId: config.workspaceId,
    currentListId: config.tableId,
    discoveryPrompt: config.discoveryPrompt,
    entityColumn: config.entityColumn,
    entityType: config.entityType,
    tableTitle: config.tableTitle,
    liveTable: {
      ...liveTable,
      tableId: config.tableId,
      workspaceId: config.workspaceId,
      enabled: config.enabled,
      cadence: config.cadence,
      dailyRowTarget: config.dailyRowTarget,
      maxRowsPerRun: config.maxRowsPerRun,
      overlapHours: config.overlapHours,
      creditBudget: config.creditBudget,
    },
    savedAt: new Date().toISOString(),
  };
}

function isHostManagedProspectTable(config: ProspectTableConfig) {
  return config.workspaceId.startsWith("lastb2b_brand_");
}

function hasQuotaPauseMessage(value: unknown) {
  const normalized = String(value ?? "").toLowerCase();
  return (
    normalized.includes("not enough credits remain") ||
    normalized.includes("upgrade to resume automatic runs") ||
    normalized.includes("free trial") ||
    normalized.includes("credit limit reached")
  );
}

function parseBrandIdFromWorkspaceId(workspaceId: string) {
  const normalized = workspaceId.trim();
  return normalized.startsWith("lastb2b_brand_")
    ? normalized.slice("lastb2b_brand_".length)
    : "";
}

function shouldKeepCampaignProspectTableEnabled(campaign: ScaleCampaignRecord) {
  return (
    Boolean(normalizeText(campaign.snapshot.offer)) &&
    Boolean(normalizeText(campaign.snapshot.audience)) &&
    campaign.status !== "archived"
  );
}

function resolveExperimentDemandWeight(experiment: ExperimentRecord) {
  return Math.max(
    1,
    clampExperimentSampleSize(experiment.testEnvelope.sampleSize),
    Math.max(1, Number(experiment.testEnvelope.dailyCap || 0) || 0) *
      Math.max(1, Number(experiment.testEnvelope.durationDays || 0) || 0)
  );
}

function resolveCampaignDemandWeight(campaign: ScaleCampaignRecord) {
  return Math.max(
    1,
    Math.max(1, Number(campaign.scalePolicy.dailyCap || 0) || 0) * DEFAULT_CAMPAIGN_BACKLOG_DAYS
  );
}

function resolveExperimentBusinessHoursPerDay(experiment: ExperimentRecord) {
  if (experiment.testEnvelope.businessHoursEnabled === false) {
    return 24;
  }

  const startHour = Math.max(
    0,
    Math.min(23, Number(experiment.testEnvelope.businessHoursStartHour ?? 9) || 9)
  );
  const endHour = Math.max(
    1,
    Math.min(24, Number(experiment.testEnvelope.businessHoursEndHour ?? 17) || 17)
  );
  if (startHour === endHour) return 24;
  if (startHour < endHour) {
    return Math.max(1, endHour - startHour);
  }
  return Math.max(1, 24 - startHour + endHour);
}

function readTableCreditsSpent(existingTable: Record<string, unknown> | null) {
  if (!existingTable) return 0;
  const snapshot = asObject(existingTable.snapshot);
  const liveTable = asObject(snapshot.liveTable);
  return Math.max(0, Math.round(Number(existingTable.creditsSpent ?? liveTable.creditsSpent ?? 0) || 0));
}

function readBillingRemainingCredits(payload: Record<string, unknown> | null) {
  const entitlements = asObject(payload?.entitlements);
  const remaining = asObject(entitlements.remaining);
  const value = remaining.credits;
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

async function readManagedBillingStatus(
  appUrl: string,
  workspaceId: string
): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(
      `${appUrl}/api/billing/status?workspaceId=${encodeURIComponent(workspaceId)}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(BILLING_STATUS_TIMEOUT_MS),
      }
    );
    if (!response.ok) {
      return null;
    }
    return await readJsonSafe(response);
  } catch {
    return null;
  }
}

async function resolveBrandSenderDailyCapacity(input: {
  accountIds: string[];
  timeZone: string;
  businessHoursPerDay: number;
  fallbackDailyCap: number;
}) {
  const uniqueAccountIds = Array.from(new Set(input.accountIds.map((value) => value.trim()).filter(Boolean)));
  if (!uniqueAccountIds.length) {
    return Math.max(1, input.fallbackDailyCap);
  }

  const accounts = await Promise.all(uniqueAccountIds.map((accountId) => getOutreachAccount(accountId)));
  const totalCapacity = accounts.reduce((sum, account) => {
    if (!account || account.status !== "active") {
      return sum;
    }
    const policy = calculateSenderCapacityPolicy({
      account,
      timeZone: input.timeZone,
      businessHoursPerDay: input.businessHoursPerDay,
    });
    return sum + Math.max(0, policy.dailyCap);
  }, 0);

  return totalCapacity > 0 ? totalCapacity : Math.max(1, input.fallbackDailyCap);
}

async function resolveManagedProspectTableConfig(
  config: ProspectTableConfig,
  appUrl: string,
  existingTable: Record<string, unknown> | null
): Promise<ProspectTableConfig> {
  if (!isHostManagedProspectTable(config)) {
    return config;
  }

  const brandId = parseBrandIdFromWorkspaceId(config.workspaceId);
  if (!brandId) {
    return config;
  }

  const [experiments, campaigns, assignment, billingStatus] = await Promise.all([
    listExperimentRecords(brandId),
    listScaleCampaignRecords(brandId),
    getBrandOutreachAssignment(brandId),
    readManagedBillingStatus(appUrl, config.workspaceId),
  ]);

  const currentExperiment =
    config.tableId.startsWith("lastb2b_experiment_")
      ? experiments.find((experiment) => `lastb2b_experiment_${experiment.id}` === config.tableId) ?? null
      : null;
  const currentCampaign =
    config.tableId.startsWith("lastb2b_campaign_")
      ? campaigns.find((campaign) => `lastb2b_campaign_${campaign.id}` === config.tableId) ?? null
      : null;

  const activeDemands = [
    ...experiments
      .filter((experiment) => shouldKeepExperimentProspectTableEnabled(experiment))
      .map((experiment) => ({
        tableId: `lastb2b_experiment_${experiment.id}`,
        weight: resolveExperimentDemandWeight(experiment),
      })),
    ...campaigns
      .filter((campaign) => shouldKeepCampaignProspectTableEnabled(campaign))
      .map((campaign) => ({
        tableId: `lastb2b_campaign_${campaign.id}`,
        weight: resolveCampaignDemandWeight(campaign),
      })),
  ];

  if (!activeDemands.some((entry) => entry.tableId === config.tableId)) {
    activeDemands.push({
      tableId: config.tableId,
      weight:
        currentExperiment
          ? resolveExperimentDemandWeight(currentExperiment)
          : currentCampaign
            ? resolveCampaignDemandWeight(currentCampaign)
            : Math.max(1, config.dailyRowTarget),
    });
  }

  const currentDemand =
    activeDemands.find((entry) => entry.tableId === config.tableId) ??
    ({ tableId: config.tableId, weight: 1 } as const);
  const totalDemandWeight = activeDemands.reduce((sum, entry) => sum + Math.max(1, entry.weight), 0);
  const share = totalDemandWeight > 0 ? currentDemand.weight / totalDemandWeight : 1;

  const businessHoursPerDay = currentExperiment
    ? resolveExperimentBusinessHoursPerDay(currentExperiment)
    : DEFAULT_BUSINESS_HOURS_PER_DAY;
  const timeZone =
    currentExperiment?.testEnvelope.timezone ||
    currentCampaign?.scalePolicy.timezone ||
    "America/Los_Angeles";
  const fallbackDailyCap = currentExperiment
    ? Math.max(
        1,
        Number(currentExperiment.testEnvelope.dailyCap || DEFAULT_FALLBACK_SENDER_DAILY_CAP) ||
          DEFAULT_FALLBACK_SENDER_DAILY_CAP
      )
    : currentCampaign
      ? Math.max(
          1,
          Number(currentCampaign.scalePolicy.dailyCap || DEFAULT_FALLBACK_SENDER_DAILY_CAP) ||
            DEFAULT_FALLBACK_SENDER_DAILY_CAP
        )
      : DEFAULT_FALLBACK_SENDER_DAILY_CAP;

  const candidateAccountIds = new Set<string>([
    assignment?.accountId ?? "",
    ...(assignment?.accountIds ?? []),
    currentCampaign?.scalePolicy.accountId ?? "",
    currentCampaign?.scalePolicy.mailboxAccountId ?? "",
    ...campaigns.flatMap((campaign) => [
      campaign.scalePolicy.accountId,
      campaign.scalePolicy.mailboxAccountId,
    ]),
  ]);
  const senderDailyCapacity = await resolveBrandSenderDailyCapacity({
    accountIds: [...candidateAccountIds],
    timeZone,
    businessHoursPerDay,
    fallbackDailyCap,
  });

  const sendableLeadSharePerDay = Math.max(1, Math.round(senderDailyCapacity * share));
  const dailyRowTarget = clampProspectDailyRowTarget(
    Math.ceil(sendableLeadSharePerDay * DISCOVERY_ROWS_PER_SENDABLE_CONTACT),
    1
  );
  const maxRowsPerRun = resolveProspectMaxRowsPerRun(dailyRowTarget);

  const remainingCredits = readBillingRemainingCredits(billingStatus);
  const currentCreditsSpent = readTableCreditsSpent(existingTable);
  const sharedRemainingCredits =
    remainingCredits == null ? null : Math.max(0, Math.floor(remainingCredits * share));
  const creditBudget =
    sharedRemainingCredits == null ? null : currentCreditsSpent + sharedRemainingCredits;

  return {
    ...config,
    dailyRowTarget,
    maxRowsPerRun,
    creditBudget,
  };
}

async function readJsonSafe(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function readExistingTable(
  appUrl: string,
  tableId: string
): Promise<Record<string, unknown> | null> {
  const existingResponse = await fetch(
    `${appUrl}/api/live?tableId=${encodeURIComponent(tableId)}`,
    { cache: "no-store" }
  );
  const existingPayload = await readJsonSafe(existingResponse);
  return existingResponse.ok && existingPayload.table && typeof existingPayload.table === "object"
    ? (existingPayload.table as Record<string, unknown>)
    : null;
}

function extractSnapshotRows(snapshot: unknown) {
  const value = asObject(snapshot);
  return Array.isArray(value.rows) ? value.rows : [];
}

function buildProspectTableState(
  appUrl: string,
  config: ProspectTableConfig,
  existingTable: Record<string, unknown> | null
): ProspectTableState {
  const effectiveConfig = resolveEffectiveConfig(config, existingTable);
  const snapshot = asObject(existingTable?.snapshot);

  return {
    appUrl,
    ...effectiveConfig,
    rowCount: existingTable ? countSnapshotRows(existingTable.snapshot) : 0,
    lastRunAt: String(existingTable?.lastRunAt ?? "").trim(),
    lastStatus: String(existingTable?.lastStatus ?? "").trim(),
    lastRowsFound: Math.max(0, Number(existingTable?.lastRowsFound ?? 0) || 0),
    lastRowsAppended: Math.max(0, Number(existingTable?.lastRowsAppended ?? 0) || 0),
    discoveryMeta: normalizeDiscoveryMeta(snapshot.discoveryMeta),
  };
}

export function buildExperimentProspectTableConfig(
  experiment: ExperimentRecord,
  options: { enabled?: boolean } = {}
): ProspectTableConfig {
  const dailyRowTarget = resolveExperimentProspectDailyRowTarget(experiment);
  return {
    workspaceId: `lastb2b_brand_${experiment.brandId}`,
    tableId: `lastb2b_experiment_${experiment.id}`,
    tableTitle: `${normalizeText(experiment.name) || "Experiment"} prospects`,
    discoveryPrompt: buildDiscoveryPrompt(experiment.audience, experiment.offer, experiment.name),
    enabled: options.enabled ?? shouldKeepExperimentProspectTableEnabled(experiment),
    entityType: "person",
    entityColumn: "person_name",
    cadence: "daily",
    dailyRowTarget,
    maxRowsPerRun: resolveProspectMaxRowsPerRun(dailyRowTarget),
    overlapHours: 48,
    creditBudget: null,
  };
}

export function buildCampaignProspectTableConfig(campaign: ScaleCampaignRecord): ProspectTableConfig {
  const dailyRowTarget = resolveCampaignProspectDailyRowTarget(campaign);
  return {
    workspaceId: `lastb2b_brand_${campaign.brandId}`,
    tableId: `lastb2b_campaign_${campaign.id}`,
    tableTitle: `${normalizeText(campaign.name) || "Campaign"} prospects`,
    discoveryPrompt: buildDiscoveryPrompt(
      campaign.snapshot.audience,
      campaign.snapshot.offer,
      campaign.name
    ),
    enabled: shouldKeepCampaignProspectTableEnabled(campaign),
    entityType: "person",
    entityColumn: "person_name",
    cadence: "daily",
    dailyRowTarget,
    maxRowsPerRun: resolveProspectMaxRowsPerRun(dailyRowTarget),
    overlapHours: 48,
    creditBudget: null,
  };
}

export async function ensureEnrichAnythingProspectTable(config: ProspectTableConfig): Promise<ProspectTableState> {
  const appUrl = resolveEnrichAnythingAppUrl();
  if (!appUrl) {
    throw new Error("ENRICHANYTHING_APP_URL is not configured.");
  }

  let existingTable = await readExistingTable(appUrl, config.tableId);
  const managedConfig = await resolveManagedProspectTableConfig(config, appUrl, existingTable);

  if (existingTable) {
    const effectiveConfig = resolveEffectiveConfig(managedConfig, existingTable);
    const snapshot = asObject(existingTable.snapshot);
    const liveTable = asObject(snapshot.liveTable);
    const staleQuotaPause =
      isHostManagedProspectTable(effectiveConfig) &&
      (hasQuotaPauseMessage(existingTable.lastError) ||
        hasQuotaPauseMessage(liveTable.lastError) ||
        (String(existingTable.lastStatus ?? "").trim().toLowerCase() === "paused" &&
          hasQuotaPauseMessage(existingTable.lastError || liveTable.lastError)));
    const needsPatch =
      existingTable.enabled !== effectiveConfig.enabled ||
      String(snapshot.discoveryPrompt ?? "").trim() !== effectiveConfig.discoveryPrompt ||
      String(snapshot.tableTitle ?? "").trim() !== effectiveConfig.tableTitle ||
      String(snapshot.entityColumn ?? "").trim() !== effectiveConfig.entityColumn ||
      String(snapshot.entityType ?? "").trim() !== effectiveConfig.entityType ||
      liveTable.enabled !== effectiveConfig.enabled ||
      String(liveTable.cadence ?? "").trim() !== effectiveConfig.cadence ||
      Number(liveTable.dailyRowTarget ?? 0) !== effectiveConfig.dailyRowTarget ||
      Number(liveTable.maxRowsPerRun ?? 0) !== effectiveConfig.maxRowsPerRun ||
      Number(liveTable.overlapHours ?? 0) !== effectiveConfig.overlapHours ||
      Number(existingTable.maxRowsPerRun ?? liveTable.maxRowsPerRun ?? 0) !==
        effectiveConfig.maxRowsPerRun ||
      Number(existingTable.creditBudget ?? liveTable.creditBudget ?? 0) !==
        Number(effectiveConfig.creditBudget ?? 0) ||
      staleQuotaPause;

    if (needsPatch) {
      const nextSnapshot = mergeSnapshot(effectiveConfig, existingTable.snapshot);
      if (staleQuotaPause) {
        const nextSnapshotRecord = nextSnapshot as Record<string, unknown>;
        const nextLiveTable = asObject(nextSnapshotRecord.liveTable);
        nextSnapshotRecord.liveTable = {
          ...nextLiveTable,
          enabled: effectiveConfig.enabled,
          lastStatus: "idle",
          lastError: "",
          nextRunAt:
            effectiveConfig.enabled
              ? String(nextLiveTable.nextRunAt ?? "").trim() || new Date().toISOString()
              : null,
        };
      }
      const patchResponse = await fetch(`${appUrl}/api/live`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: effectiveConfig.tableId,
          enabled: effectiveConfig.enabled,
          snapshot: nextSnapshot,
          title: effectiveConfig.tableTitle,
          cadence: effectiveConfig.cadence,
          dailyRowTarget: effectiveConfig.dailyRowTarget,
          maxRowsPerRun: effectiveConfig.maxRowsPerRun,
          overlapHours: effectiveConfig.overlapHours,
          creditBudget: effectiveConfig.creditBudget,
        }),
        cache: "no-store",
      });
      if (!patchResponse.ok) {
        const patchPayload = await readJsonSafe(patchResponse);
        throw new Error(String(patchPayload.error ?? "Failed to update EnrichAnything prospect table."));
      }
      existingTable = await readExistingTable(appUrl, effectiveConfig.tableId);
    }

    return {
      ...buildProspectTableState(appUrl, effectiveConfig, existingTable),
    };
  }

  const createResponse = await fetch(`${appUrl}/api/live`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: managedConfig.workspaceId,
      tableId: managedConfig.tableId,
      snapshot: createSnapshot(managedConfig),
      enabled: managedConfig.enabled,
      cadence: managedConfig.cadence,
      dailyRowTarget: managedConfig.dailyRowTarget,
      maxRowsPerRun: managedConfig.maxRowsPerRun,
      overlapHours: managedConfig.overlapHours,
      creditBudget: managedConfig.creditBudget,
    }),
    cache: "no-store",
  });
  if (!createResponse.ok) {
    const createPayload = await readJsonSafe(createResponse);
    throw new Error(String(createPayload.error ?? "Failed to create EnrichAnything live table."));
  }

  return {
    ...buildProspectTableState(appUrl, managedConfig, null),
  };
}

export async function getEnrichAnythingProspectTableState(
  config: ProspectTableConfig
): Promise<ProspectTableState> {
  const appUrl = resolveEnrichAnythingAppUrl();
  if (!appUrl) {
    throw new Error("ENRICHANYTHING_APP_URL is not configured.");
  }

  const existingTable = await readExistingTable(appUrl, config.tableId);
  const managedConfig = await resolveManagedProspectTableConfig(config, appUrl, existingTable);

  return buildProspectTableState(appUrl, managedConfig, existingTable);
}

export async function updateEnrichAnythingProspectTableDiscovery(
  config: ProspectTableConfig,
  input: {
    discoveryPrompt: string;
    discoveryMeta?: ProspectTableDiscoveryMeta;
  }
): Promise<ProspectTableState> {
  const appUrl = resolveEnrichAnythingAppUrl();
  if (!appUrl) {
    throw new Error("ENRICHANYTHING_APP_URL is not configured.");
  }

  await ensureEnrichAnythingProspectTable(config);
  const existingTable = await readExistingTable(appUrl, config.tableId);
  if (!existingTable) {
    throw new Error("Failed to load EnrichAnything prospect table.");
  }
  const managedConfig = await resolveManagedProspectTableConfig(config, appUrl, existingTable);

  const nextPrompt = normalizeText(input.discoveryPrompt) || managedConfig.discoveryPrompt;
  const nextConfig = {
    ...managedConfig,
    discoveryPrompt: nextPrompt,
  };
  const nextSnapshot = mergeSnapshot(nextConfig, existingTable.snapshot) as Record<string, unknown>;
  const rawMeta = asObject(input.discoveryMeta);
  const existingMeta = asObject(nextSnapshot.discoveryMeta);
  const explicitPromptSource = String(rawMeta.promptSource ?? "").trim();
  const promptSource =
    explicitPromptSource ||
    (nextPrompt && nextPrompt !== managedConfig.discoveryPrompt
      ? "custom"
      : String(existingMeta.promptSource ?? "").trim() || "default");
  nextSnapshot.discoveryMeta = {
    ...existingMeta,
    ...rawMeta,
    promptSource:
      promptSource === "lookalike_seed" || promptSource === "custom" ? promptSource : "default",
  };

  const patchResponse = await fetch(`${appUrl}/api/live`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tableId: nextConfig.tableId,
      enabled: nextConfig.enabled,
      snapshot: nextSnapshot,
      title: nextConfig.tableTitle,
      cadence: nextConfig.cadence,
      dailyRowTarget: nextConfig.dailyRowTarget,
      maxRowsPerRun: nextConfig.maxRowsPerRun,
      overlapHours: nextConfig.overlapHours,
      creditBudget: nextConfig.creditBudget,
    }),
    cache: "no-store",
  });
  if (!patchResponse.ok) {
    const patchPayload = await readJsonSafe(patchResponse);
    throw new Error(String(patchPayload.error ?? "Failed to update EnrichAnything prospect table."));
  }

  const refreshed = await readExistingTable(appUrl, nextConfig.tableId);
  return buildProspectTableState(appUrl, nextConfig, refreshed);
}

export async function getEnrichAnythingProspectTableRows(
  config: ProspectTableConfig
): Promise<unknown[]> {
  const appUrl = resolveEnrichAnythingAppUrl();
  if (!appUrl) {
    throw new Error("ENRICHANYTHING_APP_URL is not configured.");
  }

  const existingTable = await readExistingTable(appUrl, config.tableId);
  if (!existingTable) {
    return [];
  }

  return extractSnapshotRows(asObject(existingTable).snapshot);
}

export async function runEnrichAnythingProspectTable(
  config: ProspectTableConfig
): Promise<ProspectTableRunResult> {
  const appUrl = resolveEnrichAnythingAppUrl();
  if (!appUrl) {
    throw new Error("ENRICHANYTHING_APP_URL is not configured.");
  }

  const response = await fetch(`${appUrl}/api/live/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tableId: config.tableId }),
    cache: "no-store",
  });

  const payload = await readJsonSafe(response);
  if (!response.ok) {
    throw new Error(String(payload.error ?? "Failed to run EnrichAnything prospect table."));
  }

  const table =
    payload.table && typeof payload.table === "object" && !Array.isArray(payload.table)
      ? (payload.table as Record<string, unknown>)
      : null;
  const run = payload.run && typeof payload.run === "object" && !Array.isArray(payload.run)
    ? (payload.run as Record<string, unknown>)
    : null;
  const managedConfig = await resolveManagedProspectTableConfig(config, appUrl, table);

  return {
    ...buildProspectTableState(appUrl, managedConfig, table),
    runId: String(run?.id ?? "").trim(),
  };
}
