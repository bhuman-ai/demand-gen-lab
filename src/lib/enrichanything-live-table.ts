import type { ExperimentRecord, OutreachRunLead, ScaleCampaignRecord } from "@/lib/factory-types";
import { clampExperimentSampleSize } from "@/lib/experiment-policy";
import {
  getExperimentRecordById,
  getScaleCampaignRecordById,
  listExperimentRecords,
  listScaleCampaignRecords,
  resolveScaleCampaignLane,
} from "@/lib/experiment-data";
import { resolveEnrichAnythingAppUrl } from "@/lib/enrichanything-app-url";
import { companyKeyFromLead } from "@/lib/experiment-prospect-import";
import {
  buildEnrichAnythingRequestTimeoutMessage,
  resolveEnrichAnythingOperationTimeoutMs,
} from "@/lib/outreach-prep-policy";
import {
  getBrandOutreachAssignment,
  getOutreachAccount,
  listOwnerRuns,
  listRunLeads,
} from "@/lib/outreach-data";
import { buildSenderCapacitySnapshots } from "@/lib/sender-capacity";
import {
  buildWarmupDiscoveryPromptTemplate,
  deriveWarmupTopicLaneDescriptors,
} from "@/lib/warmup-sourcing";

export type ProspectTableConfig = {
  brandId: string;
  ownerType: "experiment" | "campaign";
  ownerId: string;
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

type ProspectTableHiddenExclusions = {
  version: 1;
  updatedAt: string;
  entityHints: string[];
  personCompanyKeys: string[];
  companyKeys: string[];
  urlKeys: string[];
} | null;

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

export type ProspectTableState = ProspectTableConfig & {
  appUrl: string;
  rowCount: number;
  lastRunAt: string;
  lastStatus: string;
  lastError: string;
  lastRowsFound: number;
  lastRowsAppended: number;
  discoveryMeta: ProspectTableDiscoveryMeta;
};

type ProspectTableRunResult = ProspectTableState & {
  runId: string;
  runStatus: "queued" | "running" | "completed";
};

type EnrichAnythingLiveJobStatus = "queued" | "running" | "completed" | "failed";

type EnrichAnythingLiveJob = {
  jobId: string;
  tableId: string;
  workspaceId: string;
  status: EnrichAnythingLiveJobStatus;
  errorMessage: string;
  claimedBy: string;
  attemptCount: number;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  maxRowsPerRun: number | null;
  trigger: "manual" | "scheduled";
  result: {
    runId: string;
    rowsAppended: number;
    rowsFound: number;
    status: string;
  } | null;
};

export type ProspectTableStateSummary = {
  tableIds: string[];
  enabled: boolean;
  rowCount: number;
  lastRunAt: string;
  lastStatus: string;
  lastError: string;
};

type EnrichAnythingFetchOptions = RequestInit & {
  timeoutMs?: number;
};

const DEFAULT_EXPERIMENT_PROSPECT_DAILY_ROW_TARGET = 100;
const DEFAULT_CAMPAIGN_PROSPECT_DAILY_ROW_TARGET = 100;
const DEFAULT_WARMUP_PROSPECT_DAILY_ROW_TARGET = 12;
const MAX_PROSPECT_DAILY_ROW_TARGET = 20_000;
const DISCOVERY_ROWS_PER_SENDABLE_CONTACT = 3;
const DEFAULT_FALLBACK_SENDER_DAILY_CAP = 30;
const DEFAULT_CAMPAIGN_BACKLOG_DAYS = 14;
const DEFAULT_BUSINESS_HOURS_PER_DAY = 8;
const BILLING_STATUS_TIMEOUT_MS = 3_500;
const ENRICHANYTHING_TABLES_DISABLED_REASON = "EnrichAnything prospect tables are disabled platform-wide.";
const SENDER_WARMUP_TABLE_PREFIX = "lastb2b_sender_warmup_";
const BRAND_WARMUP_POOL_TABLE_PREFIX = "lastb2b_brand_warmup_pool_";
const DEFAULT_ENRICHANYTHING_LIVE_JOB_POLL_INTERVAL_MS = 2_000;
const DEFAULT_WARMUP_SNAPSHOT_COLUMNS: ProspectEnrichmentColumn[] = [
  {
    key: "public_work_email",
    type: "email",
    instruction:
      "Find the best public work email for this person. Return null if not confidently supported.",
  },
];

type ProspectEnrichmentColumn = {
  key: string;
  type: string;
  instruction: string;
};

function buildDefaultProspectEnrichments(_entityType: ProspectTableConfig["entityType"]): ProspectEnrichmentColumn[] {
  return [
    {
      key: "company_name",
      type: "text",
      instruction: "Find the company this person currently works for.",
    },
    {
      key: "role_title",
      type: "text",
      instruction: "Find this person's current role title.",
    },
    {
      key: "linkedin_url",
      type: "url",
      instruction: "Find this person's LinkedIn profile URL when confidently available.",
    },
    {
      key: "public_work_email",
      type: "email",
      instruction:
        "Find the best public work email for this person. Return null if not confidently supported.",
    },
  ];
}

function areEnrichAnythingTablesEnabled() {
  const raw = String(process.env.ENRICHANYTHING_TABLES_ENABLED ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePersonIdentity(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrlKey(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return "";
  try {
    const url = new URL(raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`);
    url.hash = "";
    url.username = "";
    url.password = "";
    const normalizedPath = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.hostname.toLowerCase()}${normalizedPath}${url.search}`;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
}

function truncateSentence(value: string, maxLength: number) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  const cutoff = normalized.slice(0, maxLength);
  const sentenceBreak = Math.max(cutoff.lastIndexOf(". "), cutoff.lastIndexOf("; "), cutoff.lastIndexOf(": "));
  if (sentenceBreak >= Math.floor(maxLength * 0.6)) {
    return cutoff.slice(0, sentenceBreak + 1).trim();
  }
  const wordBreak = cutoff.lastIndexOf(" ");
  return `${(wordBreak > 40 ? cutoff.slice(0, wordBreak) : cutoff).trim()}...`;
}

function clampProspectDailyRowTarget(value: unknown, fallback: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(MAX_PROSPECT_DAILY_ROW_TARGET, parsed));
}

function isAbortLikeError(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

async function fetchEnrichAnything(
  appUrl: string,
  path: string,
  init: EnrichAnythingFetchOptions = {}
): Promise<Response> {
  const { timeoutMs: requestedTimeoutMs, ...requestInit } = init;
  const timeoutMs = resolveEnrichAnythingOperationTimeoutMs(requestedTimeoutMs);
  const targetUrl = `${appUrl}${path}`;
  try {
    return await fetch(targetUrl, {
      ...requestInit,
      cache: requestInit.cache ?? "no-store",
      signal: requestInit.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new Error(buildEnrichAnythingRequestTimeoutMessage(targetUrl, timeoutMs));
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to reach EnrichAnything at ${targetUrl}: ${message}`);
  }
}

function resolveExperimentProspectDailyRowTarget(experiment: ExperimentRecord) {
  const sampleSize = clampExperimentSampleSize(experiment.testEnvelope.sampleSize);
  return clampProspectDailyRowTarget(
    Math.max(DEFAULT_EXPERIMENT_PROSPECT_DAILY_ROW_TARGET, sampleSize * 5),
    DEFAULT_EXPERIMENT_PROSPECT_DAILY_ROW_TARGET
  );
}

function resolveCampaignProspectDailyRowTarget(campaign: ScaleCampaignRecord) {
  if (resolveScaleCampaignLane(campaign) === "warmup") {
    return clampProspectDailyRowTarget(
      DEFAULT_WARMUP_PROSPECT_DAILY_ROW_TARGET,
      DEFAULT_WARMUP_PROSPECT_DAILY_ROW_TARGET
    );
  }
  const dailyCap = Math.max(1, Number(campaign.scalePolicy.dailyCap || 30) || 30);
  return clampProspectDailyRowTarget(
    Math.max(DEFAULT_CAMPAIGN_PROSPECT_DAILY_ROW_TARGET, dailyCap * 4),
    DEFAULT_CAMPAIGN_PROSPECT_DAILY_ROW_TARGET
  );
}

function isSenderOwnedScaleCampaign(input: {
  scalePolicy?: { accountId?: string; mailboxAccountId?: string } | null;
}) {
  return Boolean(
    String(input.scalePolicy?.accountId ?? "").trim() ||
      String(input.scalePolicy?.mailboxAccountId ?? "").trim()
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
    experiment.status !== "completed"
  );
}

function campaignWarmupSenderId(campaign: ScaleCampaignRecord) {
  return String(campaign.scalePolicy.accountId || campaign.scalePolicy.mailboxAccountId || "").trim();
}

function brandWarmupPoolTableId(brandId: string) {
  return `${BRAND_WARMUP_POOL_TABLE_PREFIX}${brandId}`;
}

function brandWarmupPoolLaneTableId(brandId: string, laneId: string) {
  return `${BRAND_WARMUP_POOL_TABLE_PREFIX}${brandId}_${laneId}`;
}

function splitTargetAcrossReservoirs(totalTarget: number, reservoirCount: number) {
  const safeCount = Math.max(1, Math.trunc(reservoirCount) || 1);
  const safeTotal = Math.max(safeCount, Math.trunc(totalTarget) || safeCount);
  const baseTarget = Math.floor(safeTotal / safeCount);
  const remainder = safeTotal % safeCount;
  return Array.from({ length: safeCount }, (_, index) => baseTarget + (index < remainder ? 1 : 0));
}

function campaignProspectTableId(campaign: ScaleCampaignRecord) {
  const senderId = campaignWarmupSenderId(campaign);
  if (senderId && resolveScaleCampaignLane(campaign) === "warmup") {
    return `${SENDER_WARMUP_TABLE_PREFIX}${senderId}`;
  }
  return `lastb2b_campaign_${campaign.id}`;
}

function resolveCampaignDemandTableIds(campaign: ScaleCampaignRecord) {
  if (resolveScaleCampaignLane(campaign) === "warmup" && isSenderOwnedScaleCampaign(campaign)) {
    return buildBrandWarmupPoolProspectTableConfigs(campaign).map((config) => config.tableId);
  }
  return [campaignProspectTableId(campaign)];
}

function isWarmupProspectTableConfig(config: ProspectTableConfig) {
  return (
    config.tableId.startsWith(SENDER_WARMUP_TABLE_PREFIX) ||
    config.tableId.startsWith(BRAND_WARMUP_POOL_TABLE_PREFIX)
  );
}

function compactAudienceTerms(audience: string, fallbackName: string) {
  const normalizedAudience = normalizeText(audience)
    .replace(/\bwho\s+(sell|buy|need|use|work|are|want|manage|build)\b.*$/i, "")
    .replace(/\bworking on\b/gi, "")
    .replace(/\bB2B teams\b/gi, "")
    .replace(/\bcompanies\b/gi, "companies")
    .replace(/\s{2,}/g, " ")
    .replace(/[.;:]+$/g, "")
    .trim();
  const normalizedName = normalizeText(fallbackName).replace(/\b(prospects?|campaign|pilot|experiment)\b/gi, "").trim();
  const source = normalizedAudience || normalizedName || "relevant B2B companies";
  const terms = source
    .split(/\s*,\s*|\s+(?:and|or)\s+/i)
    .map((term) =>
      term
        .replace(/\bemail\/SMS retention agencies\b/gi, "retention agencies")
        .replace(/\bconsultants\b/gi, "consultancies")
        .replace(/\bmarket researchers\b/gi, "market research firms")
        .replace(/\bwho\s+.*$/i, "")
        .replace(/\bfor\s+.*$/i, "")
        .replace(/\s{2,}/g, " ")
        .trim()
        .replace(/[.;:]+$/g, "")
    )
    .filter((term) => term.length >= 3)
    .filter((term, index, all) => all.findIndex((item) => item.toLowerCase() === term.toLowerCase()) === index)
    .slice(0, 4);

  if (!terms.length) return truncateSentence(source, 130);
  const joined =
    terms.length === 1
      ? terms[0]
      : `${terms.slice(0, -1).join(", ")} and ${terms[terms.length - 1]}`;
  return truncateSentence(joined, 150);
}

function buildDiscoveryPrompt(audience: string, _offer: string, fallbackName: string) {
  const rawAudience = normalizeText(audience);
  const rolePhrases: string[] = [];
  const companyPhrases: string[] = [];
  const workflowPhrases: string[] = [];

  if (/\b(sales|outbound|sdr|bdr|linkedin|crm)\b/i.test(rawAudience)) {
    rolePhrases.push("heads of sales, SDR leaders, and revenue leaders");
    companyPhrases.push("B2B software companies and sales-led startups");
  }
  if (/\b(marketing|growth|nurture|campaign|ads?)\b/i.test(rawAudience)) {
    rolePhrases.push("marketing and growth leaders");
    companyPhrases.push("B2B marketing teams");
  }
  if (/\b(revops|revenue operations|operations)\b/i.test(rawAudience)) {
    rolePhrases.push("RevOps leaders");
  }
  if (/\b(agencies|agency|clients?)\b/i.test(rawAudience)) {
    rolePhrases.push("agency founders and client strategy leaders");
    companyPhrases.push("outbound, nurture, and demand generation agencies");
  }
  if (/\b(outbound|cold email|email)\b/i.test(rawAudience)) workflowPhrases.push("outbound email");
  if (/\blinkedin\b/i.test(rawAudience)) workflowPhrases.push("LinkedIn outreach");
  if (/\bcrm\b/i.test(rawAudience)) workflowPhrases.push("CRM workflows");
  if (/\b(video|personalized|personalised)\b/i.test(`${rawAudience} ${_offer}`)) workflowPhrases.push("personalized video");

  if (rolePhrases.length >= 2 || (rolePhrases.length && companyPhrases.length)) {
    const roles = Array.from(
      new Set([
        /\b(sales|outbound|sdr|bdr|linkedin|crm)\b/i.test(rawAudience) ? "sales" : "",
        /\b(marketing|growth|nurture|campaign|ads?)\b/i.test(rawAudience) ? "growth" : "",
        /\b(revops|revenue operations|operations)\b/i.test(rawAudience) ? "RevOps" : "",
        /\b(agencies|agency|clients?)\b/i.test(rawAudience) ? "agency" : "",
      ].filter(Boolean))
    ).join(", ");
    const companies = /\b(agencies|agency|clients?)\b/i.test(rawAudience)
      ? "B2B SaaS companies and demand generation agencies"
      : Array.from(new Set(companyPhrases)).join(", ") || "B2B companies";
    const workflows = Array.from(new Set(workflowPhrases)).join(", ");
    return truncateSentence(
      `US-based ${roles || "revenue"} leaders at ${companies}${workflows ? ` using ${workflows}` : ""}.`,
      220
    );
  }

  const target = compactAudienceTerms(audience, fallbackName);
  const hasPersonRole = /\b(founders?|owners?|heads?|directors?|vp|marketers?|contacts?)\b/i.test(target);
  const hasCompanyType = /\b(agencies|agency|consultancies|studios?|firms?|companies|operators?)\b/i.test(target);
  const rolePrefix = hasPersonRole && !hasCompanyType ? "" : "founders or operators at ";
  return `${rolePrefix}${target}.`;
}

function buildWarmupDiscoveryPrompt(audience: string, offer: string, fallbackName: string) {
  return buildWarmupDiscoveryPromptTemplate({
    audience,
    offer,
    fallbackName,
  });
}

function normalizeHiddenExclusions(value: unknown): ProspectTableHiddenExclusions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const entityHints = Array.isArray(record.entityHints)
    ? Array.from(new Set(record.entityHints.map((entry) => normalizeText(entry)).filter(Boolean))).slice(0, 500)
    : [];
  const personCompanyKeys = Array.isArray(record.personCompanyKeys)
    ? Array.from(new Set(record.personCompanyKeys.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean))).slice(0, 5000)
    : [];
  const companyKeys = Array.isArray(record.companyKeys)
    ? Array.from(new Set(record.companyKeys.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean))).slice(0, 5000)
    : [];
  const urlKeys = Array.isArray(record.urlKeys)
    ? Array.from(new Set(record.urlKeys.map((entry) => normalizeUrlKey(entry)).filter(Boolean))).slice(0, 5000)
    : [];
  if (!entityHints.length && !personCompanyKeys.length && !companyKeys.length && !urlKeys.length) {
    return null;
  }
  return {
    version: 1,
    updatedAt: normalizeText(record.updatedAt) || new Date().toISOString(),
    entityHints,
    personCompanyKeys,
    companyKeys,
    urlKeys,
  };
}

function hiddenExclusionsSignature(value: ProspectTableHiddenExclusions) {
  if (!value) return "";
  return JSON.stringify({
    entityHints: [...value.entityHints].sort(),
    personCompanyKeys: [...value.personCompanyKeys].sort(),
    companyKeys: [...value.companyKeys].sort(),
    urlKeys: [...value.urlKeys].sort(),
  });
}

function buildLeadExclusionHint(lead: Pick<OutreachRunLead, "name" | "company" | "domain" | "sourceUrl">) {
  const person = normalizeText(lead.name);
  const company = normalizeText(lead.company);
  const domain = normalizeText(lead.domain).toLowerCase();
  if (person && company) {
    return `${person} at ${company}`;
  }
  if (person && domain) {
    return `${person} at ${domain}`;
  }
  return person || company || domain || normalizeText(lead.sourceUrl);
}

function buildCampaignHistoricalExclusions(
  leads: OutreachRunLead[],
  options: { oneContactPerCompany: boolean }
): ProspectTableHiddenExclusions {
  const entityHints = new Set<string>();
  const personCompanyKeys = new Set<string>();
  const companyKeys = new Set<string>();
  const urlKeys = new Set<string>();

  for (const lead of leads) {
    const personKey = normalizePersonIdentity(lead.name);
    const companyKey = companyKeyFromLead(lead);
    const hint = buildLeadExclusionHint(lead);
    const sourceUrlKey = normalizeUrlKey(lead.sourceUrl);
    if (hint) {
      entityHints.add(hint);
    }
    if (personKey && companyKey) {
      personCompanyKeys.add(`${companyKey.toLowerCase()}|${personKey}`);
    }
    if (options.oneContactPerCompany && companyKey) {
      companyKeys.add(companyKey.toLowerCase());
    }
    if (sourceUrlKey) {
      urlKeys.add(sourceUrlKey);
    }
  }

  return normalizeHiddenExclusions({
    updatedAt: new Date().toISOString(),
    entityHints: [...entityHints],
    personCompanyKeys: [...personCompanyKeys],
    companyKeys: [...companyKeys],
    urlKeys: [...urlKeys],
  });
}

async function listSiblingSenderOwnedCampaignLeads(brandId: string, campaignId: string) {
  const campaigns = await listScaleCampaignRecords(brandId);
  const siblingCampaigns = campaigns.filter(
    (entry) =>
      entry.id !== campaignId &&
      entry.status !== "archived" &&
      isSenderOwnedScaleCampaign(entry)
  );
  if (!siblingCampaigns.length) {
    return [] as OutreachRunLead[];
  }
  const siblingRuns = await Promise.all(
    siblingCampaigns.map((entry) => listOwnerRuns(brandId, "campaign", entry.id))
  );
  const siblingLeadLists = await Promise.all(siblingRuns.flat().map((run) => listRunLeads(run.id)));
  return siblingLeadLists.flat();
}

async function resolveProspectTableHiddenExclusions(
  config: ProspectTableConfig
): Promise<ProspectTableHiddenExclusions> {
  if (config.ownerType !== "campaign") {
    return null;
  }
  const campaign = await getScaleCampaignRecordById(config.brandId, config.ownerId);
  if (!campaign) {
    return null;
  }

  const [sourceExperiment, existingRuns] = await Promise.all([
    campaign.sourceExperimentId ? getExperimentRecordById(config.brandId, campaign.sourceExperimentId) : Promise.resolve(null),
    listOwnerRuns(config.brandId, "campaign", campaign.id),
  ]);
  const existingLeadLists = await Promise.all(existingRuns.map((run) => listRunLeads(run.id)));
  const historicalLeads = existingLeadLists.flat();
  const siblingLeads = isSenderOwnedScaleCampaign(campaign)
    ? await listSiblingSenderOwnedCampaignLeads(config.brandId, campaign.id)
    : [];

  return buildCampaignHistoricalExclusions([...historicalLeads, ...siblingLeads], {
    oneContactPerCompany: sourceExperiment?.testEnvelope.oneContactPerCompany !== false,
  });
}

function defaultSnapshotColumns(config: ProspectTableConfig): ProspectEnrichmentColumn[] {
  if (isWarmupProspectTableConfig(config)) {
    return DEFAULT_WARMUP_SNAPSHOT_COLUMNS.map((column) => ({ ...column }));
  }
  return buildDefaultProspectEnrichments(config.entityType).map((column) => ({
    key: String(column.key ?? "").trim(),
    type: String(column.type ?? "").trim(),
    instruction: String(column.instruction ?? "").trim(),
  }));
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
    columns: defaultSnapshotColumns(config),
    result: null,
    hiddenExclusions: null,
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
  const isWarmupConfig =
    isWarmupProspectTableConfig(config) ||
    normalizeText(config.tableTitle).toLowerCase().startsWith("warmup");

  if (
    !isWarmupConfig &&
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
  const snapshotColumns = Array.isArray(snapshot.columns) ? snapshot.columns : [];
  const expectedColumns = defaultSnapshotColumns(config);
  const columns = isWarmupProspectTableConfig(config)
    ? expectedColumns
    : snapshotColumns.length
      ? snapshotColumns
      : expectedColumns;

  return {
    ...createSnapshot(config),
    ...snapshot,
    workspaceId: config.workspaceId,
    currentListId: config.tableId,
    discoveryPrompt: config.discoveryPrompt,
    entityColumn: config.entityColumn,
    entityType: config.entityType,
    tableTitle: config.tableTitle,
    columns,
    hiddenExclusions: normalizeHiddenExclusions(snapshot.hiddenExclusions),
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
  const totalCapacity = buildSenderCapacitySnapshots({
    senders: accounts
      .filter((account): account is NonNullable<typeof account> => Boolean(account && account.status === "active"))
      .map((account) => ({ account })),
    timeZone: input.timeZone,
    businessHoursPerDay: input.businessHoursPerDay,
  }).reduce((sum, snapshot) => sum + Math.max(0, snapshot.dailyCap), 0);

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
    campaigns.find((campaign) => resolveCampaignDemandTableIds(campaign).includes(config.tableId)) ??
    (config.ownerType === "campaign"
      ? campaigns.find((campaign) => campaign.id === config.ownerId) ?? null
      : null);

  const activeDemands = [
    ...experiments
      .filter((experiment) => shouldKeepExperimentProspectTableEnabled(experiment))
      .map((experiment) => ({
        tableId: `lastb2b_experiment_${experiment.id}`,
        weight: resolveExperimentDemandWeight(experiment),
      })),
    ...campaigns
      .filter((campaign) => shouldKeepCampaignProspectTableEnabled(campaign))
      .flatMap((campaign) => {
        const demandTableIds = resolveCampaignDemandTableIds(campaign);
        const laneWeight = Math.max(1, Math.ceil(resolveCampaignDemandWeight(campaign) / demandTableIds.length));
        return demandTableIds.map((tableId) => ({
          tableId,
          weight: laneWeight,
        }));
      }),
  ].reduce<Array<{ tableId: string; weight: number }>>((acc, entry) => {
    const existing = acc.find((candidate) => candidate.tableId === entry.tableId);
    if (existing) {
      existing.weight += Math.max(1, entry.weight);
      return acc;
    }
    acc.push({ ...entry });
    return acc;
  }, []);

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
  tableId: string,
  options: { timeoutMs?: number } = {}
): Promise<Record<string, unknown> | null> {
  const existingResponse = await fetchEnrichAnything(
    appUrl,
    `/api/live?tableId=${encodeURIComponent(tableId)}`,
    { timeoutMs: options.timeoutMs }
  );
  const existingPayload = await readJsonSafe(existingResponse);
  return existingResponse.ok && existingPayload.table && typeof existingPayload.table === "object"
    ? (existingPayload.table as Record<string, unknown>)
    : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeEnrichAnythingLiveJob(payload: unknown): EnrichAnythingLiveJob | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const status = String(record.status ?? "").trim().toLowerCase();
  const normalizedStatus: EnrichAnythingLiveJobStatus =
    status === "running" || status === "completed" || status === "failed" ? status : "queued";
  const result =
    record.result && typeof record.result === "object" && !Array.isArray(record.result)
      ? (record.result as Record<string, unknown>)
      : null;
  const jobId = String(record.jobId ?? "").trim();

  if (!jobId) {
    return null;
  }

  return {
    jobId,
    tableId: String(record.tableId ?? "").trim(),
    workspaceId: String(record.workspaceId ?? "").trim(),
    status: normalizedStatus,
    errorMessage: String(record.errorMessage ?? "").trim(),
    claimedBy: String(record.claimedBy ?? "").trim(),
    attemptCount: Math.max(0, Number(record.attemptCount ?? 0) || 0),
    queuedAt: typeof record.queuedAt === "string" ? record.queuedAt : null,
    startedAt: typeof record.startedAt === "string" ? record.startedAt : null,
    completedAt: typeof record.completedAt === "string" ? record.completedAt : null,
    maxRowsPerRun:
      record.maxRowsPerRun == null || record.maxRowsPerRun === ""
        ? null
        : Math.max(1, Number(record.maxRowsPerRun) || 0),
    trigger: String(record.trigger ?? "").trim().toLowerCase() === "scheduled" ? "scheduled" : "manual",
    result: result
      ? {
          runId: String(result.runId ?? "").trim(),
          rowsAppended: Math.max(0, Number(result.rowsAppended ?? 0) || 0),
          rowsFound: Math.max(0, Number(result.rowsFound ?? 0) || 0),
          status: String(result.status ?? "").trim(),
        }
      : null,
  };
}

async function readEnrichAnythingLiveJob(
  appUrl: string,
  jobId: string,
  timeoutMs?: number
): Promise<EnrichAnythingLiveJob> {
  const response = await fetchEnrichAnything(
    appUrl,
    `/api/live/jobs?jobId=${encodeURIComponent(jobId)}`,
    {
      timeoutMs: timeoutMs ? Math.max(2_000, Math.min(10_000, timeoutMs)) : undefined,
    }
  );
  const payload = await readJsonSafe(response);

  if (!response.ok) {
    throw new Error(String(payload.error ?? "Failed to read EnrichAnything live-table job."));
  }

  const job = normalizeEnrichAnythingLiveJob(payload.job);

  if (!job) {
    throw new Error("EnrichAnything live-table job payload was empty.");
  }

  return job;
}

async function waitForEnrichAnythingLiveJob(
  appUrl: string,
  jobId: string,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {}
): Promise<EnrichAnythingLiveJob> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(0, Number(options.timeoutMs ?? 0) || 0);
  const pollIntervalMs = Math.max(
    500,
    Number(options.pollIntervalMs ?? DEFAULT_ENRICHANYTHING_LIVE_JOB_POLL_INTERVAL_MS) || DEFAULT_ENRICHANYTHING_LIVE_JOB_POLL_INTERVAL_MS
  );

  let job = await readEnrichAnythingLiveJob(appUrl, jobId, timeoutMs || undefined);

  while (job.status === "queued" || job.status === "running") {
    if (!timeoutMs || Date.now() - startedAt >= timeoutMs) {
      return job;
    }

    const remainingMs = timeoutMs - (Date.now() - startedAt);
    await sleep(Math.min(pollIntervalMs, Math.max(200, remainingMs)));
    job = await readEnrichAnythingLiveJob(appUrl, jobId, remainingMs);
  }

  return job;
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
    lastError: String(existingTable?.lastError ?? "").trim(),
    lastRowsFound: Math.max(0, Number(existingTable?.lastRowsFound ?? 0) || 0),
    lastRowsAppended: Math.max(0, Number(existingTable?.lastRowsAppended ?? 0) || 0),
    discoveryMeta: normalizeDiscoveryMeta(snapshot.discoveryMeta),
  };
}

export function summarizeProspectTableStates(
  states: Array<Pick<ProspectTableState, "tableId" | "enabled" | "rowCount" | "lastRunAt" | "lastStatus" | "lastError">>
): ProspectTableStateSummary {
  const tableIds = states.map((state) => state.tableId).filter(Boolean);
  const rowCount = states.reduce((sum, state) => sum + Math.max(0, Number(state.rowCount ?? 0) || 0), 0);
  const lastRunAt = states
    .map((state) => String(state.lastRunAt ?? "").trim())
    .filter(Boolean)
    .sort()
    .at(-1) ?? "";
  const lastStatus = Array.from(
    new Set(states.map((state) => String(state.lastStatus ?? "").trim().toLowerCase()).filter(Boolean))
  ).join(",");
  const lastError = Array.from(
    new Set(states.map((state) => String(state.lastError ?? "").trim()).filter(Boolean))
  ).join(" | ");

  return {
    tableIds,
    enabled: states.length > 0 ? states.every((state) => state.enabled === true) : false,
    rowCount,
    lastRunAt,
    lastStatus,
    lastError,
  };
}

export function buildExperimentProspectTableConfig(
  experiment: ExperimentRecord,
  options: { enabled?: boolean } = {}
): ProspectTableConfig {
  const dailyRowTarget = resolveExperimentProspectDailyRowTarget(experiment);
  return {
    brandId: experiment.brandId,
    ownerType: "experiment",
    ownerId: experiment.id,
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
  const discoveryPrompt = resolveScaleCampaignLane(campaign) === "warmup"
    ? buildWarmupDiscoveryPrompt(campaign.snapshot.audience, campaign.snapshot.offer, campaign.name)
    : buildDiscoveryPrompt(campaign.snapshot.audience, campaign.snapshot.offer, campaign.name);
  return {
    brandId: campaign.brandId,
    ownerType: "campaign",
    ownerId: campaign.id,
    workspaceId: `lastb2b_brand_${campaign.brandId}`,
    tableId: campaignProspectTableId(campaign),
    tableTitle: `${normalizeText(campaign.name) || "Campaign"} prospects`,
    discoveryPrompt,
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

export function buildBrandWarmupPoolProspectTableConfigs(
  campaign: ScaleCampaignRecord
): ProspectTableConfig[] {
  const dailyRowTarget = resolveCampaignProspectDailyRowTarget(campaign);
  const laneDescriptors = deriveWarmupTopicLaneDescriptors({
    audience: campaign.snapshot.audience,
    offer: campaign.snapshot.offer,
    fallbackName: campaign.name,
  });
  const effectiveLanes =
    laneDescriptors.length > 0
      ? laneDescriptors
      : [
          {
            id: "general" as const,
            label: "General",
            copyTerm: "general",
            discoveryPrompt: buildWarmupDiscoveryPrompt(
              campaign.snapshot.audience,
              campaign.snapshot.offer,
              campaign.name
            ),
          },
        ];
  const laneTargets = splitTargetAcrossReservoirs(dailyRowTarget, effectiveLanes.length);

  return effectiveLanes.map((lane, index) => {
    const laneTarget = clampProspectDailyRowTarget(
      laneTargets[index] ?? 1,
      Math.max(1, Math.floor(dailyRowTarget / Math.max(1, effectiveLanes.length)))
    );
    return {
      brandId: campaign.brandId,
      ownerType: "campaign",
      ownerId: campaign.id,
      workspaceId: `lastb2b_brand_${campaign.brandId}`,
      tableId: brandWarmupPoolLaneTableId(campaign.brandId, lane.id),
      tableTitle: `Warmup pool: ${lane.label}`,
      discoveryPrompt: lane.discoveryPrompt,
      enabled: shouldKeepCampaignProspectTableEnabled(campaign),
      entityType: "person",
      entityColumn: "person_name",
      cadence: "daily",
      dailyRowTarget: laneTarget,
      maxRowsPerRun: resolveProspectMaxRowsPerRun(laneTarget),
      overlapHours: 48,
      creditBudget: null,
    };
  });
}

export function buildBrandWarmupPoolProspectTableConfig(campaign: ScaleCampaignRecord): ProspectTableConfig {
  return (
    buildBrandWarmupPoolProspectTableConfigs(campaign)[0] ?? {
      brandId: campaign.brandId,
      ownerType: "campaign",
      ownerId: campaign.id,
      workspaceId: `lastb2b_brand_${campaign.brandId}`,
      tableId: brandWarmupPoolTableId(campaign.brandId),
      tableTitle: "Warmup pool prospects",
      discoveryPrompt: buildWarmupDiscoveryPrompt(
        campaign.snapshot.audience,
        campaign.snapshot.offer,
        campaign.name
      ),
      enabled: shouldKeepCampaignProspectTableEnabled(campaign),
      entityType: "person",
      entityColumn: "person_name",
      cadence: "daily",
      dailyRowTarget: resolveCampaignProspectDailyRowTarget(campaign),
      maxRowsPerRun: resolveProspectMaxRowsPerRun(resolveCampaignProspectDailyRowTarget(campaign)),
      overlapHours: 48,
      creditBudget: null,
    }
  );
}

export function buildLegacyBrandWarmupPoolProspectTableConfig(
  campaign: ScaleCampaignRecord
): ProspectTableConfig {
  const dailyRowTarget = resolveCampaignProspectDailyRowTarget(campaign);
  return {
    brandId: campaign.brandId,
    ownerType: "campaign",
    ownerId: campaign.id,
    workspaceId: `lastb2b_brand_${campaign.brandId}`,
    tableId: brandWarmupPoolTableId(campaign.brandId),
    tableTitle: "Warmup pool prospects",
    discoveryPrompt: buildWarmupDiscoveryPrompt(
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

export async function ensureEnrichAnythingProspectTable(
  config: ProspectTableConfig,
  options: { timeoutMs?: number } = {}
): Promise<ProspectTableState> {
  if (!areEnrichAnythingTablesEnabled()) {
    throw new Error(ENRICHANYTHING_TABLES_DISABLED_REASON);
  }
  const appUrl = resolveEnrichAnythingAppUrl();
  if (!appUrl) {
    throw new Error("ENRICHANYTHING_APP_URL is not configured.");
  }

  let existingTable = await readExistingTable(appUrl, config.tableId, {
    timeoutMs: options.timeoutMs,
  });
  const managedConfig = await resolveManagedProspectTableConfig(config, appUrl, existingTable);
  const hiddenExclusions = await resolveProspectTableHiddenExclusions(managedConfig);

  if (existingTable) {
    const effectiveConfig = resolveEffectiveConfig(managedConfig, existingTable);
    const snapshot = asObject(existingTable.snapshot);
    const liveTable = asObject(snapshot.liveTable);
    const snapshotHiddenExclusions = normalizeHiddenExclusions(snapshot.hiddenExclusions);
    const currentColumns = Array.isArray(snapshot.columns) ? snapshot.columns : [];
    const expectedColumns = defaultSnapshotColumns(effectiveConfig);
    const normalizedCurrentColumnKeys = currentColumns
      .map((current) =>
        current && typeof current === "object"
          ? String((current as Record<string, unknown>).key ?? "").trim()
          : ""
      )
      .filter(Boolean);
    const normalizedExpectedColumnKeys = expectedColumns.map((column) => column.key);
    const hasColumnMismatch =
      normalizedCurrentColumnKeys.length !== normalizedExpectedColumnKeys.length ||
      normalizedExpectedColumnKeys.some((key) => !normalizedCurrentColumnKeys.includes(key));
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
      hasColumnMismatch ||
      liveTable.enabled !== effectiveConfig.enabled ||
      String(liveTable.cadence ?? "").trim() !== effectiveConfig.cadence ||
      Number(liveTable.dailyRowTarget ?? 0) !== effectiveConfig.dailyRowTarget ||
      Number(liveTable.maxRowsPerRun ?? 0) !== effectiveConfig.maxRowsPerRun ||
      Number(liveTable.overlapHours ?? 0) !== effectiveConfig.overlapHours ||
      Number(existingTable.maxRowsPerRun ?? liveTable.maxRowsPerRun ?? 0) !==
        effectiveConfig.maxRowsPerRun ||
      Number(existingTable.creditBudget ?? liveTable.creditBudget ?? 0) !==
        Number(effectiveConfig.creditBudget ?? 0) ||
      hiddenExclusionsSignature(snapshotHiddenExclusions) !== hiddenExclusionsSignature(hiddenExclusions) ||
      staleQuotaPause;

    if (needsPatch) {
      const nextSnapshot = mergeSnapshot(effectiveConfig, existingTable.snapshot) as Record<string, unknown>;
      nextSnapshot.hiddenExclusions = hiddenExclusions;
      if (staleQuotaPause) {
        const nextLiveTable = asObject(nextSnapshot.liveTable);
        nextSnapshot.liveTable = {
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
      const patchResponse = await fetchEnrichAnything(appUrl, "/api/live", {
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
        timeoutMs: options.timeoutMs,
      });
      if (!patchResponse.ok) {
        const patchPayload = await readJsonSafe(patchResponse);
        throw new Error(String(patchPayload.error ?? "Failed to update EnrichAnything prospect table."));
      }
      existingTable = await readExistingTable(appUrl, effectiveConfig.tableId, {
        timeoutMs: options.timeoutMs,
      });
    }

    return {
      ...buildProspectTableState(appUrl, effectiveConfig, existingTable),
    };
  }

  const createResponse = await fetchEnrichAnything(appUrl, "/api/live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workspaceId: managedConfig.workspaceId,
      tableId: managedConfig.tableId,
      snapshot: {
        ...createSnapshot(managedConfig),
        hiddenExclusions,
      },
      enabled: managedConfig.enabled,
      cadence: managedConfig.cadence,
      dailyRowTarget: managedConfig.dailyRowTarget,
      maxRowsPerRun: managedConfig.maxRowsPerRun,
      overlapHours: managedConfig.overlapHours,
      creditBudget: managedConfig.creditBudget,
    }),
    timeoutMs: options.timeoutMs,
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
  if (!areEnrichAnythingTablesEnabled()) {
    throw new Error(ENRICHANYTHING_TABLES_DISABLED_REASON);
  }
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
  if (!areEnrichAnythingTablesEnabled()) {
    throw new Error(ENRICHANYTHING_TABLES_DISABLED_REASON);
  }
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

  const patchResponse = await fetchEnrichAnything(appUrl, "/api/live", {
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
  });
  if (!patchResponse.ok) {
    const patchPayload = await readJsonSafe(patchResponse);
    throw new Error(String(patchPayload.error ?? "Failed to update EnrichAnything prospect table."));
  }

  const refreshed = await readExistingTable(appUrl, nextConfig.tableId);
  return buildProspectTableState(appUrl, nextConfig, refreshed);
}

export async function refreshEnrichAnythingProspectTable(
  config: ProspectTableConfig,
  options: {
    resetRows?: boolean;
  } = {}
): Promise<ProspectTableState> {
  if (!areEnrichAnythingTablesEnabled()) {
    throw new Error(ENRICHANYTHING_TABLES_DISABLED_REASON);
  }
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
  const nextSnapshot = mergeSnapshot(managedConfig, existingTable.snapshot) as Record<string, unknown>;
  const nextLiveTable = asObject(nextSnapshot.liveTable);
  nextSnapshot.liveTable = {
    ...nextLiveTable,
    enabled: managedConfig.enabled,
    lastStatus: "idle",
    lastError: "",
    nextRunAt: String(nextLiveTable.nextRunAt ?? "").trim() || new Date().toISOString(),
  };
  nextSnapshot.result = null;

  if (options.resetRows) {
    nextSnapshot.rows = [];
    nextSnapshot.csvText = "";
    nextSnapshot.selectedRowIndex = 0;
  }

  const patchResponse = await fetchEnrichAnything(appUrl, "/api/live", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tableId: managedConfig.tableId,
      enabled: managedConfig.enabled,
      snapshot: nextSnapshot,
      title: managedConfig.tableTitle,
      cadence: managedConfig.cadence,
      dailyRowTarget: managedConfig.dailyRowTarget,
      maxRowsPerRun: managedConfig.maxRowsPerRun,
      overlapHours: managedConfig.overlapHours,
      creditBudget: managedConfig.creditBudget,
    }),
  });
  if (!patchResponse.ok) {
    const patchPayload = await readJsonSafe(patchResponse);
    throw new Error(String(patchPayload.error ?? "Failed to refresh EnrichAnything prospect table."));
  }

  const refreshed = await readExistingTable(appUrl, managedConfig.tableId);
  return buildProspectTableState(appUrl, managedConfig, refreshed);
}

export async function getEnrichAnythingProspectTableRows(
  config: ProspectTableConfig
): Promise<unknown[]> {
  if (!areEnrichAnythingTablesEnabled()) {
    return [];
  }
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
  config: ProspectTableConfig,
  options: {
    timeoutMs?: number;
    maxRowsPerRun?: number;
    signal?: AbortSignal;
  } = {}
): Promise<ProspectTableRunResult> {
  if (!areEnrichAnythingTablesEnabled()) {
    throw new Error(ENRICHANYTHING_TABLES_DISABLED_REASON);
  }
  const appUrl = resolveEnrichAnythingAppUrl();
  if (!appUrl) {
    throw new Error("ENRICHANYTHING_APP_URL is not configured.");
  }

  const customTimeoutRaw = String(options.timeoutMs ?? "").trim();
  const customTimeoutMs = customTimeoutRaw ? Math.round(Number(customTimeoutRaw)) : Number.NaN;
  const runTimeoutMs = Number.isFinite(customTimeoutMs)
    ? Math.max(2_000, Math.min(55_000, customTimeoutMs))
    : undefined;
  const response = await fetchEnrichAnything(appUrl, "/api/live/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tableId: config.tableId,
      maxRowsPerRun: options.maxRowsPerRun,
      mode: "auto",
    }),
    timeoutMs: runTimeoutMs,
    signal: options.signal ?? (runTimeoutMs ? AbortSignal.timeout(runTimeoutMs) : undefined),
  });

  const payload = await readJsonSafe(response);
  if (!response.ok) {
    throw new Error(String(payload.error ?? "Failed to run EnrichAnything prospect table."));
  }

  if (response.status === 202) {
    const queuedJob = normalizeEnrichAnythingLiveJob(payload.job);

    if (!queuedJob) {
      throw new Error("EnrichAnything queued run did not return a job.");
    }

    const pollIntervalMs = Math.max(
      500,
      Number((payload.jobs as Record<string, unknown> | undefined)?.pollIntervalMs ?? DEFAULT_ENRICHANYTHING_LIVE_JOB_POLL_INTERVAL_MS) ||
        DEFAULT_ENRICHANYTHING_LIVE_JOB_POLL_INTERVAL_MS
    );
    const awaitedJob = await waitForEnrichAnythingLiveJob(appUrl, queuedJob.jobId, {
      timeoutMs: runTimeoutMs,
      pollIntervalMs,
    });

    if (awaitedJob.status === "failed") {
      throw new Error(awaitedJob.errorMessage || "Failed to run EnrichAnything prospect table.");
    }

    const existingTable = await readExistingTable(appUrl, config.tableId);
    const managedConfig = await resolveManagedProspectTableConfig(config, appUrl, existingTable);
    const state = buildProspectTableState(appUrl, managedConfig, existingTable);

    if (awaitedJob.status === "completed") {
      return {
        ...state,
        runId: awaitedJob.result?.runId || awaitedJob.jobId,
        runStatus: "completed",
      };
    }

    return {
      ...state,
      lastStatus: awaitedJob.status,
      lastError: awaitedJob.errorMessage || state.lastError,
      runId: awaitedJob.jobId,
      runStatus: awaitedJob.status,
    };
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
    runStatus: "completed",
  };
}
