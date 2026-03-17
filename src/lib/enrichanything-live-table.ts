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

type ProspectTableState = ProspectTableConfig & {
  appUrl: string;
  rowCount: number;
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

  const existingTable = await readExistingTable(appUrl, config.tableId);

  if (existingTable) {
    const snapshot = asObject(existingTable.snapshot);
    const liveTable = asObject(snapshot.liveTable);
    const needsPatch =
      existingTable.enabled !== config.enabled ||
      String(snapshot.discoveryPrompt ?? "").trim() !== config.discoveryPrompt ||
      String(snapshot.tableTitle ?? "").trim() !== config.tableTitle ||
      String(snapshot.entityColumn ?? "").trim() !== config.entityColumn ||
      String(snapshot.entityType ?? "").trim() !== config.entityType ||
      liveTable.enabled !== config.enabled ||
      String(liveTable.cadence ?? "").trim() !== config.cadence ||
      Number(liveTable.dailyRowTarget ?? 0) !== config.dailyRowTarget ||
      Number(liveTable.maxRowsPerRun ?? 0) !== config.maxRowsPerRun ||
      Number(liveTable.overlapHours ?? 0) !== config.overlapHours;

    if (needsPatch) {
      const patchResponse = await fetch(`${appUrl}/api/live`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: config.tableId,
          enabled: config.enabled,
          snapshot: mergeSnapshot(config, existingTable.snapshot),
          title: config.tableTitle,
        }),
        cache: "no-store",
      });
      if (!patchResponse.ok) {
        const patchPayload = await readJsonSafe(patchResponse);
        throw new Error(String(patchPayload.error ?? "Failed to update EnrichAnything prospect table."));
      }
    }

    return {
      appUrl,
      ...config,
      rowCount: countSnapshotRows(existingTable.snapshot),
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
    appUrl,
    ...config,
    rowCount: 0,
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

  return {
    appUrl,
    ...config,
    rowCount: existingTable ? countSnapshotRows(existingTable.snapshot) : 0,
  };
}
