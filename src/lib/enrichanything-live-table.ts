import type { ExperimentRecord, ScaleCampaignRecord } from "@/lib/factory-types";
import { resolveEnrichAnythingAppUrl } from "@/lib/enrichanything-app-url";

type ProspectTableConfig = {
  workspaceId: string;
  tableId: string;
  tableTitle: string;
  discoveryPrompt: string;
  entityType: "person";
  entityColumn: "person_name";
  cadence: "daily";
  dailyRowTarget: number;
  maxRowsPerRun: number;
  overlapHours: number;
};

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function buildDiscoveryPrompt(audience: string, offer: string, fallbackName: string) {
  const normalizedAudience = normalizeText(audience);
  const normalizedOffer = normalizeText(offer);
  const normalizedName = normalizeText(fallbackName) || "this experiment";

  if (normalizedAudience && normalizedOffer) {
    return `Find real people who match this audience: ${normalizedAudience} They should be strong fits for this offer: ${normalizedOffer}`;
  }

  if (normalizedAudience) {
    return `Find real people who match this audience: ${normalizedAudience}`;
  }

  if (normalizedOffer) {
    return `Find real people who are likely to want this offer: ${normalizedOffer}`;
  }

  return `Find real prospects for ${normalizedName}`;
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
      enabled: true,
      cadence: config.cadence,
      dailyRowTarget: config.dailyRowTarget,
      maxRowsPerRun: config.maxRowsPerRun,
      overlapHours: config.overlapHours,
    },
    selectedRowIndex: 0,
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

export function buildExperimentProspectTableConfig(experiment: ExperimentRecord): ProspectTableConfig {
  return {
    workspaceId: `lastb2b_brand_${experiment.brandId}`,
    tableId: `lastb2b_experiment_${experiment.id}`,
    tableTitle: `${normalizeText(experiment.name) || "Experiment"} prospects`,
    discoveryPrompt: buildDiscoveryPrompt(experiment.audience, experiment.offer, experiment.name),
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
    entityType: "person",
    entityColumn: "person_name",
    cadence: "daily",
    dailyRowTarget: Math.max(24, Number(campaign.scalePolicy.dailyCap || 24)),
    maxRowsPerRun: Math.min(64, Math.max(12, Number(campaign.scalePolicy.dailyCap || 24))),
    overlapHours: 48,
  };
}

export async function ensureEnrichAnythingProspectTable(config: ProspectTableConfig) {
  const appUrl = resolveEnrichAnythingAppUrl();
  if (!appUrl) {
    throw new Error("ENRICHANYTHING_APP_URL is not configured.");
  }

  const existingResponse = await fetch(
    `${appUrl}/api/live?tableId=${encodeURIComponent(config.tableId)}`,
    { cache: "no-store" }
  );
  const existingPayload = await readJsonSafe(existingResponse);
  const existingTable =
    existingResponse.ok && existingPayload.table && typeof existingPayload.table === "object"
      ? (existingPayload.table as Record<string, unknown>)
      : null;

  if (existingTable) {
    if (existingTable.enabled !== true) {
      const enableResponse = await fetch(`${appUrl}/api/live`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: config.tableId,
          enabled: true,
          snapshot: existingTable.snapshot ?? createSnapshot(config),
          title: config.tableTitle,
        }),
        cache: "no-store",
      });
      if (!enableResponse.ok) {
        const enablePayload = await readJsonSafe(enableResponse);
        throw new Error(String(enablePayload.error ?? "Failed to enable EnrichAnything live table."));
      }
    }

    return {
      appUrl,
      ...config,
    };
  }

  const createResponse = await fetch(`${appUrl}/api/live`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: config.workspaceId,
      tableId: config.tableId,
      snapshot: createSnapshot(config),
      enabled: true,
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
  };
}
