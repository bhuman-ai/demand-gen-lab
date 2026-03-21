import type { ExperimentRecord, ScaleCampaignRecord } from "@/lib/factory-types";
import { resolveEnrichAnythingAppUrl } from "@/lib/enrichanything-app-url";

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
};

type ProspectTableDiscoveryMeta = {
  promptSource?: "default" | "lookalike_seed";
  lookalikeSeed?: {
    sourceCount: number;
    analyzedCount: number;
    summaryTags: string[];
    mode: "openai" | "heuristic";
    savedAt: string;
  } | null;
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

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

  const promptSource =
    String(meta.promptSource ?? "").trim() === "lookalike_seed" ? "lookalike_seed" : "default";
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
    discoveryMeta?.promptSource === "lookalike_seed" &&
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
    },
    savedAt: new Date().toISOString(),
  };
}

function isHostManagedProspectTable(config: ProspectTableConfig) {
  return config.workspaceId.startsWith("lastb2b_");
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
  return {
    workspaceId: `lastb2b_brand_${experiment.brandId}`,
    tableId: `lastb2b_experiment_${experiment.id}`,
    tableTitle: `${normalizeText(experiment.name) || "Experiment"} prospects`,
    discoveryPrompt: buildDiscoveryPrompt(experiment.audience, experiment.offer, experiment.name),
    enabled: Boolean(options.enabled),
    entityType: "person",
    entityColumn: "person_name",
    cadence: "daily",
    dailyRowTarget: 24,
    maxRowsPerRun: 24,
    overlapHours: 48,
  };
}

export function buildCampaignProspectTableConfig(campaign: ScaleCampaignRecord): ProspectTableConfig {
  return {
    workspaceId: `lastb2b_brand_${campaign.brandId}`,
    tableId: `lastb2b_campaign_${campaign.id}`,
    tableTitle: `${normalizeText(campaign.name) || "Campaign"} prospects`,
    discoveryPrompt: buildDiscoveryPrompt(
      campaign.snapshot.audience,
      campaign.snapshot.offer,
      campaign.name
    ),
    enabled: true,
    entityType: "person",
    entityColumn: "person_name",
    cadence: "daily",
    dailyRowTarget: Math.max(24, Number(campaign.scalePolicy.dailyCap || 24)),
    maxRowsPerRun: Math.min(64, Math.max(12, Number(campaign.scalePolicy.dailyCap || 24))),
    overlapHours: 48,
  };
}

export async function ensureEnrichAnythingProspectTable(config: ProspectTableConfig): Promise<ProspectTableState> {
  const appUrl = resolveEnrichAnythingAppUrl();
  if (!appUrl) {
    throw new Error("ENRICHANYTHING_APP_URL is not configured.");
  }

  let existingTable = await readExistingTable(appUrl, config.tableId);

  if (existingTable) {
    const effectiveConfig = resolveEffectiveConfig(config, existingTable);
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
      workspaceId: config.workspaceId,
      tableId: config.tableId,
      snapshot: createSnapshot(config),
      enabled: config.enabled,
      cadence: config.cadence,
      dailyRowTarget: config.dailyRowTarget,
      maxRowsPerRun: config.maxRowsPerRun,
      overlapHours: config.overlapHours,
    }),
    cache: "no-store",
  });
  if (!createResponse.ok) {
    const createPayload = await readJsonSafe(createResponse);
    throw new Error(String(createPayload.error ?? "Failed to create EnrichAnything live table."));
  }

  return {
    ...buildProspectTableState(appUrl, config, null),
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

  return buildProspectTableState(appUrl, config, existingTable);
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

  const nextPrompt = normalizeText(input.discoveryPrompt) || config.discoveryPrompt;
  const nextConfig = {
    ...config,
    discoveryPrompt: nextPrompt,
  };
  const nextSnapshot = mergeSnapshot(nextConfig, existingTable.snapshot) as Record<string, unknown>;
  nextSnapshot.discoveryMeta = input.discoveryMeta ?? null;

  const patchResponse = await fetch(`${appUrl}/api/live`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tableId: config.tableId,
      enabled: config.enabled,
      snapshot: nextSnapshot,
      title: config.tableTitle,
    }),
    cache: "no-store",
  });
  if (!patchResponse.ok) {
    const patchPayload = await readJsonSafe(patchResponse);
    throw new Error(String(patchPayload.error ?? "Failed to update EnrichAnything prospect table."));
  }

  const refreshed = await readExistingTable(appUrl, config.tableId);
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

  return {
    ...buildProspectTableState(appUrl, config, table),
    runId: String(run?.id ?? "").trim(),
  };
}
