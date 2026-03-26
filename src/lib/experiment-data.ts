import { mkdir, readFile, writeFile } from "fs/promises";
import {
  createCampaign,
  createId,
  defaultExperimentRunPolicy,
  deleteCampaign,
  getCampaignById,
  updateCampaign,
  type CampaignRecord,
  type Experiment,
  type Hypothesis,
} from "@/lib/factory-data";
import { getPublishedConversationMapForExperiment } from "@/lib/conversation-flow-data";
import {
  clampExperimentSampleSize,
  EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS,
} from "@/lib/experiment-policy";
import {
  deleteOutreachRunsByIds,
  getBrandOutreachAssignment,
  listExperimentRuns,
  listOwnerRuns,
  setBrandOutreachAssignment,
} from "@/lib/outreach-data";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  CampaignScalePolicy,
  ExperimentMetricsSummary,
  ExperimentRecord,
  ExperimentRuntimeRef,
  ExperimentSuccessMetric,
  ExperimentTestEnvelope,
  ScaleCampaignRecord,
} from "@/lib/factory-types";

const isVercel = Boolean(process.env.VERCEL);
const EXPERIMENTS_PATH = isVercel
  ? "/tmp/factory_experiments.v1.json"
  : `${process.cwd()}/data/experiments.v1.json`;
const SCALE_CAMPAIGNS_PATH = isVercel
  ? "/tmp/factory_scale_campaigns.v1.json"
  : `${process.cwd()}/data/scale-campaigns.v1.json`;

const EXPERIMENT_TABLE = "demanddev_experiments";
const SCALE_CAMPAIGN_TABLE = "demanddev_scale_campaigns";
const SUPABASE_QUERY_TIMEOUT_MS = 3500;

const nowIso = () => new Date().toISOString();

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

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
  if (!Array.isArray(value)) return [1, 2, 3, 4, 5];
  const days = value
    .map((entry) => Math.round(Number(entry)))
    .filter((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 6);
  const deduped = Array.from(new Set(days)).sort((a, b) => a - b);
  return deduped.length ? deduped : [1, 2, 3, 4, 5];
}

function defaultMetricsSummary(): ExperimentMetricsSummary {
  return {
    sent: 0,
    replies: 0,
    positiveReplies: 0,
    failed: 0,
  };
}

function defaultTestEnvelope(): ExperimentTestEnvelope {
  return {
    sampleSize: EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS,
    durationDays: 7,
    dailyCap: 30,
    hourlyCap: 6,
    timezone: "America/Los_Angeles",
    minSpacingMinutes: 8,
    oneContactPerCompany: true,
    businessHoursEnabled: true,
    businessHoursStartHour: 9,
    businessHoursEndHour: 17,
    businessDays: [1, 2, 3, 4, 5],
  };
}

function defaultSuccessMetric(): ExperimentSuccessMetric {
  return {
    metric: "reply_rate",
    thresholdPct: 5,
  };
}

function defaultScalePolicy(): CampaignScalePolicy {
  return {
    dailyCap: 30,
    hourlyCap: 6,
    timezone: "America/Los_Angeles",
    minSpacingMinutes: 8,
    accountId: "",
    mailboxAccountId: "",
    safetyMode: "strict",
  };
}

function mapLegacyScaleCampaignStatus(sourceExperiment: ExperimentRecord): ScaleCampaignRecord["status"] {
  if (sourceExperiment.status === "running") return "active";
  if (sourceExperiment.status === "paused") return "paused";
  if (sourceExperiment.status === "completed" || sourceExperiment.status === "promoted") {
    return "completed";
  }
  return "draft";
}

function mapExperimentRow(input: unknown): ExperimentRecord {
  const row = asRecord(input);
  const messageFlow = asRecord(row.message_flow ?? row.messageFlow);
  const testEnvelope = asRecord(row.test_envelope ?? row.testEnvelope);
  const successMetric = asRecord(row.success_metric ?? row.successMetric);
  const metricsSummary = asRecord(row.metrics_summary ?? row.metricsSummary);
  const runtime = asRecord(row.runtime_ref ?? row.runtime);

  return {
    id: String(row.id ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    name: String(row.name ?? "Untitled Experiment"),
    status: ["draft", "ready", "running", "paused", "completed", "promoted", "archived"].includes(
      String(row.status ?? "")
    )
      ? (String(row.status) as ExperimentRecord["status"])
      : "draft",
    offer: String(row.offer ?? ""),
    audience: String(row.audience ?? ""),
    messageFlow: {
      mapId: String(messageFlow.mapId ?? ""),
      publishedRevision: Math.max(0, asNumber(messageFlow.publishedRevision, 0)),
    },
    testEnvelope: {
      sampleSize: clampExperimentSampleSize(testEnvelope.sampleSize),
      durationDays: Math.max(1, asNumber(testEnvelope.durationDays, 7)),
      dailyCap: Math.max(1, asNumber(testEnvelope.dailyCap, 30)),
      hourlyCap: Math.max(1, asNumber(testEnvelope.hourlyCap, 6)),
      timezone: String(testEnvelope.timezone ?? "America/Los_Angeles") || "America/Los_Angeles",
      minSpacingMinutes: Math.max(1, asNumber(testEnvelope.minSpacingMinutes, 8)),
      oneContactPerCompany: testEnvelope.oneContactPerCompany !== false,
      businessHoursEnabled: testEnvelope.businessHoursEnabled !== false,
      businessHoursStartHour: clampBusinessHour(testEnvelope.businessHoursStartHour, 9),
      businessHoursEndHour: clampBusinessEndHour(testEnvelope.businessHoursEndHour, 17),
      businessDays: normalizeBusinessDays(testEnvelope.businessDays),
    },
    successMetric: {
      metric: "reply_rate",
      thresholdPct: Math.max(0, asNumber(successMetric.thresholdPct, 5)),
    },
    lastRunId: String(row.last_run_id ?? row.lastRunId ?? ""),
    metricsSummary: {
      sent: Math.max(0, asNumber(metricsSummary.sent, 0)),
      replies: Math.max(0, asNumber(metricsSummary.replies, 0)),
      positiveReplies: Math.max(0, asNumber(metricsSummary.positiveReplies, 0)),
      failed: Math.max(0, asNumber(metricsSummary.failed, 0)),
    },
    promotedCampaignId: String(row.promoted_campaign_id ?? row.promotedCampaignId ?? ""),
    runtime: {
      campaignId: String(runtime.campaignId ?? ""),
      hypothesisId: String(runtime.hypothesisId ?? ""),
      experimentId: String(runtime.experimentId ?? ""),
    },
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapScaleCampaignRow(input: unknown): ScaleCampaignRecord {
  const row = asRecord(input);
  const snapshot = asRecord(row.snapshot);
  const scalePolicy = asRecord(row.scale_policy ?? row.scalePolicy);
  const metricsSummary = asRecord(row.metrics_summary ?? row.metricsSummary);

  return {
    id: String(row.id ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    name: String(row.name ?? "Untitled Campaign"),
    status: ["draft", "active", "paused", "completed", "archived"].includes(String(row.status ?? ""))
      ? (String(row.status) as ScaleCampaignRecord["status"])
      : "draft",
    sourceExperimentId: String(row.source_experiment_id ?? row.sourceExperimentId ?? ""),
    snapshot: {
      offer: String(snapshot.offer ?? ""),
      audience: String(snapshot.audience ?? ""),
      mapId: String(snapshot.mapId ?? ""),
      publishedRevision: Math.max(0, asNumber(snapshot.publishedRevision, 0)),
    },
    scalePolicy: {
      dailyCap: Math.max(1, asNumber(scalePolicy.dailyCap, 30)),
      hourlyCap: Math.max(1, asNumber(scalePolicy.hourlyCap, 6)),
      timezone: String(scalePolicy.timezone ?? "America/Los_Angeles") || "America/Los_Angeles",
      minSpacingMinutes: Math.max(1, asNumber(scalePolicy.minSpacingMinutes, 8)),
      accountId: String(scalePolicy.accountId ?? ""),
      mailboxAccountId: String(scalePolicy.mailboxAccountId ?? ""),
      safetyMode: String(scalePolicy.safetyMode) === "balanced" ? "balanced" : "strict",
    },
    lastRunId: String(row.last_run_id ?? row.lastRunId ?? ""),
    metricsSummary: {
      sent: Math.max(0, asNumber(metricsSummary.sent, 0)),
      replies: Math.max(0, asNumber(metricsSummary.replies, 0)),
      positiveReplies: Math.max(0, asNumber(metricsSummary.positiveReplies, 0)),
      failed: Math.max(0, asNumber(metricsSummary.failed, 0)),
    },
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeJsonArray<T>(filePath: string, rows: T[]) {
  if (!isVercel) {
    await mkdir(`${process.cwd()}/data`, { recursive: true });
  }
  await writeFile(filePath, JSON.stringify(rows, null, 2));
}

async function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), ms);
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }) as Promise<T | null>;
}

function mergeExperimentStores(
  primary: ExperimentRecord[],
  secondary: ExperimentRecord[]
): ExperimentRecord[] {
  const merged = new Map<string, ExperimentRecord>();

  for (const row of [...primary, ...secondary]) {
    const existing = merged.get(row.id);
    if (!existing || existing.updatedAt < row.updatedAt) {
      merged.set(row.id, row);
    }
  }

  return [...merged.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function runSummaryFromMetrics(input: {
  sentMessages: number;
  replies: number;
  positiveReplies: number;
  failedMessages: number;
  bouncedMessages: number;
}): ExperimentMetricsSummary {
  return {
    sent: input.sentMessages,
    replies: input.replies,
    positiveReplies: input.positiveReplies,
    failed: input.failedMessages + input.bouncedMessages,
  };
}

function runSentMessages(input?: {
  metrics?: { sentMessages?: number | null; scheduledMessages?: number | null } | null;
}) {
  return Math.max(0, Number(input?.metrics?.sentMessages ?? 0) || 0);
}

function runScheduledMessages(input?: {
  metrics?: { sentMessages?: number | null; scheduledMessages?: number | null } | null;
}) {
  return Math.max(0, Number(input?.metrics?.scheduledMessages ?? 0) || 0);
}

function findAuthoritativeExperimentRun<T extends { status: string; metrics: { sentMessages: number; scheduledMessages: number } }>(
  runs: T[]
): T | null {
  const latestRun = runs[0] ?? null;
  if (!latestRun) return null;

  const latestStatus = String(latestRun.status ?? "").trim().toLowerCase();
  const historicalSuccessfulRun =
    runs.find((run) => runSentMessages(run) > 0) ??
    runs.find(
      (run) =>
        String(run.status ?? "").trim().toLowerCase() === "completed" &&
        runScheduledMessages(run) > 0
    ) ??
    null;

  if (!historicalSuccessfulRun || historicalSuccessfulRun === latestRun) {
    return latestRun;
  }

  if (
    ["failed", "preflight_failed"].includes(latestStatus) &&
    runSentMessages(latestRun) === 0 &&
    runScheduledMessages(latestRun) === 0
  ) {
    return historicalSuccessfulRun;
  }

  return latestRun;
}

function mapExperimentStatusFromRun(input: {
  currentStatus: ExperimentRecord["status"];
  hasOffer: boolean;
  hasAudience: boolean;
  promotedCampaignId: string;
  runStatus?: string;
  scheduledMessages?: number;
  sentMessages?: number;
}): ExperimentRecord["status"] {
  if (input.currentStatus === "archived") return "archived";

  if (!input.runStatus) {
    if (input.promotedCampaignId) return "promoted";
    if (!input.hasOffer || !input.hasAudience) return "draft";
    return "ready";
  }

  if (["scheduled", "sending", "monitoring"].includes(input.runStatus)) {
    return "running";
  }
  if (["queued", "sourcing"].includes(input.runStatus)) {
    return input.promotedCampaignId ? "promoted" : input.hasOffer && input.hasAudience ? "ready" : "draft";
  }
  if (input.runStatus === "paused") return "paused";
  if (input.runStatus === "completed") {
    const scheduledMessages = Math.max(0, Number(input.scheduledMessages ?? 0));
    const sentMessages = Math.max(0, Number(input.sentMessages ?? 0));
    if (scheduledMessages === 0 && sentMessages === 0) {
      return input.promotedCampaignId ? "promoted" : input.hasOffer && input.hasAudience ? "ready" : "draft";
    }
    return input.promotedCampaignId ? "promoted" : "completed";
  }
  if (input.promotedCampaignId) return "promoted";
  return input.hasOffer && input.hasAudience ? "ready" : "draft";
}

function experimentSnapshotNeedsPersistence(raw: ExperimentRecord, hydrated: ExperimentRecord) {
  return (
    raw.status !== hydrated.status ||
    raw.lastRunId !== hydrated.lastRunId ||
    raw.messageFlow.mapId !== hydrated.messageFlow.mapId ||
    raw.messageFlow.publishedRevision !== hydrated.messageFlow.publishedRevision ||
    raw.metricsSummary.sent !== hydrated.metricsSummary.sent ||
    raw.metricsSummary.replies !== hydrated.metricsSummary.replies ||
    raw.metricsSummary.positiveReplies !== hydrated.metricsSummary.positiveReplies ||
    raw.metricsSummary.failed !== hydrated.metricsSummary.failed
  );
}

async function createRuntimeRef(input: {
  brandId: string;
  name: string;
  offer: string;
  audience: string;
  testEnvelope: ExperimentTestEnvelope;
}): Promise<ExperimentRuntimeRef> {
  const runtimeCampaign = await createCampaign({
    brandId: input.brandId,
    name: `${input.name} Runtime`,
  });

  const hypothesisId = createId("hyp");
  const experimentId = createId("exp");

  const hypothesis: Hypothesis = {
    id: hypothesisId,
    title: input.offer.trim() || `${input.name} angle`,
    channel: "Email",
    rationale: input.offer.trim(),
    actorQuery: input.audience.trim(),
    sourceConfig: {
      actorId: "",
      actorInput: {},
      maxLeads: clampExperimentSampleSize(input.testEnvelope.sampleSize),
    },
    seedInputs: [],
    status: "approved",
  };

  const runtimeExperiment: Experiment = {
    id: experimentId,
    hypothesisId,
    name: input.name.trim() || "Variant A",
    status: "testing",
    notes: `Offer: ${input.offer.trim()}\nAudience: ${input.audience.trim()}`,
    runPolicy: {
      ...defaultExperimentRunPolicy(),
      dailyCap: input.testEnvelope.dailyCap,
      hourlyCap: input.testEnvelope.hourlyCap,
      timezone: input.testEnvelope.timezone,
      minSpacingMinutes: input.testEnvelope.minSpacingMinutes,
    },
    executionStatus: "idle",
  };

  await updateCampaign(input.brandId, runtimeCampaign.id, {
    objective: {
      goal: input.offer.trim(),
      constraints: input.audience.trim(),
      scoring: {
        conversionWeight: 0.6,
        qualityWeight: 0.2,
        replyWeight: 0.2,
      },
    },
    hypotheses: [hypothesis],
    experiments: [runtimeExperiment],
    evolution: [],
    stepState: {
      objectiveCompleted: Boolean(input.offer.trim()),
      hypothesesCompleted: true,
      experimentsCompleted: true,
      evolutionCompleted: false,
      currentStep: "experiments",
    },
  });

  return {
    campaignId: runtimeCampaign.id,
    hypothesisId,
    experimentId,
  };
}

async function syncRuntimeFromExperiment(experiment: ExperimentRecord): Promise<void> {
  if (!experiment.runtime.campaignId || !experiment.runtime.hypothesisId || !experiment.runtime.experimentId) {
    return;
  }

  const runtimeCampaign = await getCampaignById(experiment.brandId, experiment.runtime.campaignId);
  if (!runtimeCampaign) {
    return;
  }

  const currentExperiment =
    runtimeCampaign.experiments.find((item) => item.id === experiment.runtime.experimentId) ?? null;

  const runtimeHypothesis: Hypothesis = {
    id: experiment.runtime.hypothesisId,
    title: experiment.offer.trim() || experiment.name,
    channel: "Email",
    rationale: experiment.offer.trim(),
    actorQuery: experiment.audience.trim(),
    sourceConfig: {
      actorId: "",
      actorInput: {},
      maxLeads: clampExperimentSampleSize(experiment.testEnvelope.sampleSize),
    },
    seedInputs: [],
    status: "approved",
  };

  const runtimeVariant: Experiment = {
    id: experiment.runtime.experimentId,
    hypothesisId: experiment.runtime.hypothesisId,
    name: experiment.name,
    status: currentExperiment?.status ?? "testing",
    notes: `Offer: ${experiment.offer.trim()}\nAudience: ${experiment.audience.trim()}`,
    runPolicy: {
      ...defaultExperimentRunPolicy(),
      dailyCap: experiment.testEnvelope.dailyCap,
      hourlyCap: experiment.testEnvelope.hourlyCap,
      timezone: experiment.testEnvelope.timezone,
      minSpacingMinutes: experiment.testEnvelope.minSpacingMinutes,
    },
    executionStatus: currentExperiment?.executionStatus ?? "idle",
  };

  const nextEvolution = runtimeCampaign.evolution;
  const hasOffer = Boolean(experiment.offer.trim());
  const hasAudience = Boolean(experiment.audience.trim());

  await updateCampaign(experiment.brandId, runtimeCampaign.id, {
    name: `${experiment.name} Runtime`,
    objective: {
      goal: experiment.offer.trim(),
      constraints: experiment.audience.trim(),
      scoring: runtimeCampaign.objective?.scoring ?? {
        conversionWeight: 0.6,
        qualityWeight: 0.2,
        replyWeight: 0.2,
      },
    },
    hypotheses: [runtimeHypothesis],
    experiments: [runtimeVariant],
    evolution: nextEvolution,
    stepState: {
      objectiveCompleted: hasOffer,
      hypothesesCompleted: hasAudience,
      experimentsCompleted: hasOffer && hasAudience,
      evolutionCompleted: Boolean(nextEvolution.length),
      currentStep: "experiments",
    },
  });
}

async function hydrateExperimentRecord(record: ExperimentRecord): Promise<ExperimentRecord> {
  const runtimeCampaignId = record.runtime.campaignId;
  const runtimeExperimentId = record.runtime.experimentId;

  let publishedMapId = record.messageFlow.mapId;
  let publishedRevision = record.messageFlow.publishedRevision;

  if (runtimeCampaignId && runtimeExperimentId) {
    try {
      const publishedMap = await getPublishedConversationMapForExperiment(
        record.brandId,
        runtimeCampaignId,
        runtimeExperimentId
      );
      if (publishedMap) {
        publishedMapId = publishedMap.id;
        publishedRevision = publishedMap.publishedRevision;
      }
    } catch {
      // Keep existing message flow values if conversation map storage is unavailable.
    }
  }

  let ownerRuns = [] as Awaited<ReturnType<typeof listOwnerRuns>>;
  try {
    ownerRuns = await listOwnerRuns(record.brandId, "experiment", record.id);
  } catch {
    ownerRuns = [];
  }

  const fallbackRuns =
    ownerRuns.length === 0 && runtimeCampaignId && runtimeExperimentId
      ? await (async () => {
          try {
            return await listExperimentRuns(record.brandId, runtimeCampaignId, runtimeExperimentId);
          } catch {
            return [];
          }
        })()
      : ownerRuns;

  const latestRun = fallbackRuns[0] ?? null;
  const authoritativeRun = findAuthoritativeExperimentRun(fallbackRuns);
  const metricsSummary = authoritativeRun
    ? runSummaryFromMetrics(authoritativeRun.metrics)
    : record.metricsSummary ?? defaultMetricsSummary();

  const status = mapExperimentStatusFromRun({
    currentStatus: record.status,
    hasOffer: Boolean(record.offer.trim()),
    hasAudience: Boolean(record.audience.trim()),
    promotedCampaignId: record.promotedCampaignId,
    runStatus: authoritativeRun?.status,
    scheduledMessages: authoritativeRun?.metrics.scheduledMessages,
    sentMessages: authoritativeRun?.metrics.sentMessages,
  });

  return {
    ...record,
    status,
    messageFlow: {
      mapId: publishedMapId,
      publishedRevision,
    },
    lastRunId: authoritativeRun?.id ?? latestRun?.id ?? record.lastRunId,
    metricsSummary,
  };
}

async function hydrateScaleCampaignRecord(record: ScaleCampaignRecord): Promise<ScaleCampaignRecord> {
  let runs = [] as Awaited<ReturnType<typeof listOwnerRuns>>;
  try {
    runs = await listOwnerRuns(record.brandId, "campaign", record.id);
  } catch {
    runs = [];
  }
  const latestRun = runs[0] ?? null;

  if (!latestRun) {
    return record;
  }

  const status: ScaleCampaignRecord["status"] =
    latestRun.status === "paused"
      ? "paused"
      : ["queued", "sourcing", "scheduled", "sending", "monitoring"].includes(latestRun.status)
        ? "active"
        : latestRun.status === "completed"
          ? "completed"
          : record.status;

  return {
    ...record,
    status,
    lastRunId: latestRun.id,
    metricsSummary: runSummaryFromMetrics(latestRun.metrics),
  };
}

export async function normalizeExperimentRecordState(
  brandId: string,
  experimentId: string,
  options: { includeSuggestions?: boolean } = {}
): Promise<ExperimentRecord | null> {
  const includeSuggestions = Boolean(options.includeSuggestions);
  const rows = await listExperimentRowsFromStore(brandId);
  const raw = rows.find((row) => row.id === experimentId) ?? null;
  if (!raw) return null;

  let hydrated: ExperimentRecord = raw;
  try {
    hydrated = await hydrateExperimentRecord(raw);
  } catch {
    hydrated = raw;
  }

  if (!includeSuggestions && isExperimentSuggestionRecord(hydrated)) return null;
  if (!experimentSnapshotNeedsPersistence(raw, hydrated)) {
    return hydrated;
  }

  const persisted = await persistExperiment({
    ...raw,
    status: hydrated.status,
    messageFlow: hydrated.messageFlow,
    lastRunId: hydrated.lastRunId,
    metricsSummary: hydrated.metricsSummary,
    updatedAt: nowIso(),
  });

  return {
    ...persisted,
    status: hydrated.status,
    messageFlow: hydrated.messageFlow,
    lastRunId: hydrated.lastRunId,
    metricsSummary: hydrated.metricsSummary,
  };
}

async function getLegacySourceExperimentByRuntimeCampaignId(
  brandId: string,
  runtimeCampaignId: string
): Promise<ExperimentRecord | null> {
  const records = await listExperimentRecordsWithOptions(brandId, {});
  return (
    records.find(
      (record) =>
        !record.promotedCampaignId.trim() && record.runtime.campaignId.trim() === runtimeCampaignId.trim()
    ) ?? null
  );
}

async function normalizeLegacyRuntimeCampaign(input: {
  brandId: string;
  sourceExperiment: ExperimentRecord;
}): Promise<ScaleCampaignRecord | null> {
  const runtimeCampaignId = input.sourceExperiment.runtime.campaignId.trim();
  if (!runtimeCampaignId) return null;

  const runtimeCampaign = await getCampaignById(input.brandId, runtimeCampaignId);
  if (!runtimeCampaign) return null;

  let assignment = null as Awaited<ReturnType<typeof getBrandOutreachAssignment>>;
  try {
    assignment = await getBrandOutreachAssignment(input.brandId);
  } catch {
    assignment = null;
  }

  return {
    id: runtimeCampaign.id,
    brandId: input.brandId,
    name:
      input.sourceExperiment.name.trim() ||
      runtimeCampaign.name.replace(/\s+Runtime$/, "").trim() ||
      runtimeCampaign.name,
    status: mapLegacyScaleCampaignStatus(input.sourceExperiment),
    sourceExperimentId: input.sourceExperiment.id,
    snapshot: {
      offer: input.sourceExperiment.offer,
      audience: input.sourceExperiment.audience,
      mapId: input.sourceExperiment.messageFlow.mapId,
      publishedRevision: input.sourceExperiment.messageFlow.publishedRevision,
    },
    scalePolicy: {
      ...defaultScalePolicy(),
      dailyCap: input.sourceExperiment.testEnvelope.dailyCap,
      hourlyCap: input.sourceExperiment.testEnvelope.hourlyCap,
      timezone: input.sourceExperiment.testEnvelope.timezone,
      minSpacingMinutes: input.sourceExperiment.testEnvelope.minSpacingMinutes,
      accountId: assignment?.accountId ?? "",
      mailboxAccountId: assignment?.mailboxAccountId ?? "",
    },
    lastRunId: input.sourceExperiment.lastRunId,
    metricsSummary: input.sourceExperiment.metricsSummary ?? defaultMetricsSummary(),
    createdAt: runtimeCampaign.createdAt || input.sourceExperiment.createdAt,
    updatedAt:
      input.sourceExperiment.updatedAt > runtimeCampaign.updatedAt
        ? input.sourceExperiment.updatedAt
        : runtimeCampaign.updatedAt,
  };
}

async function listExperimentRowsFromStore(brandId: string): Promise<ExperimentRecord[]> {
  const local = (await readJsonArray<ExperimentRecord>(EXPERIMENTS_PATH))
    .map((row) => mapExperimentRow(row))
    .filter((row) => row.brandId === brandId);

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const response = (await withTimeout(
      supabase
        .from(EXPERIMENT_TABLE)
        .select("*")
        .eq("brand_id", brandId)
        .order("updated_at", { ascending: false }),
      SUPABASE_QUERY_TIMEOUT_MS
    )) as { data: unknown[] | null; error: unknown | null } | null;
    if (response && !response.error) {
      return mergeExperimentStores(
        (response.data ?? []).map((row: unknown) => mapExperimentRow(row)),
        local
      );
    }
  }

  return local.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

async function listScaleCampaignRowsFromStore(brandId: string): Promise<ScaleCampaignRecord[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const response = (await withTimeout(
      supabase
        .from(SCALE_CAMPAIGN_TABLE)
        .select("*")
        .eq("brand_id", brandId)
        .order("updated_at", { ascending: false }),
      SUPABASE_QUERY_TIMEOUT_MS
    )) as { data: unknown[] | null; error: unknown | null } | null;
    if (response && !response.error) {
      return (response.data ?? []).map((row: unknown) => mapScaleCampaignRow(row));
    }
  }

  const local = await readJsonArray<ScaleCampaignRecord>(SCALE_CAMPAIGNS_PATH);
  return local
    .map((row) => mapScaleCampaignRow(row))
    .filter((row) => row.brandId === brandId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

async function persistExperiment(record: ExperimentRecord): Promise<ExperimentRecord> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const payload = {
      id: record.id,
      brand_id: record.brandId,
      name: record.name,
      status: record.status,
      offer: record.offer,
      audience: record.audience,
      message_flow: record.messageFlow,
      test_envelope: record.testEnvelope,
      success_metric: record.successMetric,
      last_run_id: record.lastRunId,
      metrics_summary: record.metricsSummary,
      promoted_campaign_id: record.promotedCampaignId,
      runtime_ref: record.runtime,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    };

    const { data, error } = await supabase
      .from(EXPERIMENT_TABLE)
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .single();

    if (!error && data) {
      return mapExperimentRow(data);
    }
  }

  const rows = await readJsonArray<ExperimentRecord>(EXPERIMENTS_PATH);
  const index = rows.findIndex((row) => row.id === record.id);
  if (index >= 0) {
    rows[index] = record;
  } else {
    rows.unshift(record);
  }
  await writeJsonArray(EXPERIMENTS_PATH, rows);
  return record;
}

async function persistScaleCampaign(record: ScaleCampaignRecord): Promise<ScaleCampaignRecord> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const payload = {
      id: record.id,
      brand_id: record.brandId,
      name: record.name,
      status: record.status,
      source_experiment_id: record.sourceExperimentId,
      snapshot: record.snapshot,
      scale_policy: record.scalePolicy,
      last_run_id: record.lastRunId,
      metrics_summary: record.metricsSummary,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    };

    const { data, error } = await supabase
      .from(SCALE_CAMPAIGN_TABLE)
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .single();

    if (!error && data) {
      return mapScaleCampaignRow(data);
    }
  }

  const rows = await readJsonArray<ScaleCampaignRecord>(SCALE_CAMPAIGNS_PATH);
  const index = rows.findIndex((row) => row.id === record.id);
  if (index >= 0) {
    rows[index] = record;
  } else {
    rows.unshift(record);
  }
  await writeJsonArray(SCALE_CAMPAIGNS_PATH, rows);
  return record;
}

export async function listExperimentRecords(brandId: string): Promise<ExperimentRecord[]> {
  return listExperimentRecordsWithOptions(brandId, {});
}

export function isExperimentSuggestionRecord(record: ExperimentRecord) {
  return !record.runtime.campaignId && !record.runtime.experimentId;
}

export async function listStoredExperimentRecords(
  brandId: string,
  options: { includeSuggestions?: boolean } = {}
): Promise<ExperimentRecord[]> {
  const includeSuggestions = Boolean(options.includeSuggestions);
  const records = await listExperimentRowsFromStore(brandId);
  if (includeSuggestions) {
    return records;
  }
  return records.filter((record) => !isExperimentSuggestionRecord(record));
}

export async function listExperimentRecordsWithOptions(
  brandId: string,
  options: { includeSuggestions?: boolean }
): Promise<ExperimentRecord[]> {
  const includeSuggestions = Boolean(options.includeSuggestions);
  const records = await listStoredExperimentRecords(brandId, { includeSuggestions });
  const normalized = await Promise.all(
    records.map(async (record) => {
      try {
        return await normalizeExperimentRecordState(brandId, record.id, {
          includeSuggestions,
        });
      } catch {
        return record;
      }
    })
  );
  const hydrated = normalized.filter((record): record is ExperimentRecord => Boolean(record));
  if (includeSuggestions) return hydrated;
  return hydrated.filter((record) => !isExperimentSuggestionRecord(record));
}

export async function getExperimentRecordById(
  brandId: string,
  experimentId: string,
  options: { includeSuggestions?: boolean } = {}
): Promise<ExperimentRecord | null> {
  const includeSuggestions = Boolean(options.includeSuggestions);
  const hydrated = await normalizeExperimentRecordState(brandId, experimentId, {
    includeSuggestions: options.includeSuggestions,
  });
  if (!hydrated) return null;
  if (!includeSuggestions && isExperimentSuggestionRecord(hydrated)) return null;
  return hydrated;
}

export async function getExperimentRecordByRuntimeRef(
  brandId: string,
  runtimeCampaignId: string,
  runtimeExperimentId: string
): Promise<ExperimentRecord | null> {
  const records = await listExperimentRecordsWithOptions(brandId, {});
  return (
    records.find(
      (record) =>
        record.runtime.campaignId === runtimeCampaignId &&
        record.runtime.experimentId === runtimeExperimentId
    ) ?? null
  );
}

export async function createExperimentRecord(input: {
  brandId: string;
  name: string;
  offer?: string;
  audience?: string;
  createRuntime?: boolean;
}): Promise<ExperimentRecord> {
  const now = nowIso();
  const testEnvelope = defaultTestEnvelope();
  const shouldCreateRuntime = input.createRuntime !== false;
  const runtime = shouldCreateRuntime
    ? await createRuntimeRef({
        brandId: input.brandId,
        name: input.name.trim() || "New Experiment",
        offer: String(input.offer ?? "").trim(),
        audience: String(input.audience ?? "").trim(),
        testEnvelope,
      })
    : {
        campaignId: "",
        hypothesisId: "",
        experimentId: "",
      };

  const row: ExperimentRecord = {
    id: createId("expt"),
    brandId: input.brandId,
    name: input.name.trim() || "New Experiment",
    status: "draft",
    offer: String(input.offer ?? "").trim(),
    audience: String(input.audience ?? "").trim(),
    messageFlow: {
      mapId: "",
      publishedRevision: 0,
    },
    testEnvelope,
    successMetric: defaultSuccessMetric(),
    lastRunId: "",
    metricsSummary: defaultMetricsSummary(),
    promotedCampaignId: "",
    runtime,
    createdAt: now,
    updatedAt: now,
  };

  const persisted = await persistExperiment(row);
  if (shouldCreateRuntime) {
    await syncRuntimeFromExperiment(persisted);
  }
  return hydrateExperimentRecord(persisted);
}

export async function updateExperimentRecord(
  brandId: string,
  experimentId: string,
  patch: Partial<
    Pick<
      ExperimentRecord,
      "name" | "status" | "offer" | "audience" | "testEnvelope" | "successMetric" | "promotedCampaignId"
    >
  >,
  options: { includeSuggestions?: boolean } = {}
): Promise<ExperimentRecord | null> {
  const existing = await getExperimentRecordById(brandId, experimentId, {
    includeSuggestions: options.includeSuggestions,
  });
  if (!existing) return null;

  const now = nowIso();
  const next: ExperimentRecord = {
    ...existing,
    name: typeof patch.name === "string" ? patch.name.trim() || existing.name : existing.name,
    status:
      patch.status &&
      ["draft", "ready", "running", "paused", "completed", "promoted", "archived"].includes(
        patch.status
      )
        ? patch.status
        : existing.status,
    offer: typeof patch.offer === "string" ? patch.offer.trim() : existing.offer,
    audience: typeof patch.audience === "string" ? patch.audience.trim() : existing.audience,
    testEnvelope: patch.testEnvelope
      ? {
          sampleSize: clampExperimentSampleSize(
            patch.testEnvelope.sampleSize ?? existing.testEnvelope.sampleSize
          ),
          durationDays: Math.max(1, Number(patch.testEnvelope.durationDays ?? existing.testEnvelope.durationDays)),
          dailyCap: Math.max(1, Number(patch.testEnvelope.dailyCap ?? existing.testEnvelope.dailyCap)),
          hourlyCap: Math.max(1, Number(patch.testEnvelope.hourlyCap ?? existing.testEnvelope.hourlyCap)),
          timezone: String(patch.testEnvelope.timezone ?? existing.testEnvelope.timezone),
          minSpacingMinutes: Math.max(
            1,
            Number(patch.testEnvelope.minSpacingMinutes ?? existing.testEnvelope.minSpacingMinutes)
          ),
          oneContactPerCompany:
            patch.testEnvelope.oneContactPerCompany ?? existing.testEnvelope.oneContactPerCompany ?? true,
          businessHoursEnabled:
            patch.testEnvelope.businessHoursEnabled ?? existing.testEnvelope.businessHoursEnabled ?? true,
          businessHoursStartHour: clampBusinessHour(
            patch.testEnvelope.businessHoursStartHour ?? existing.testEnvelope.businessHoursStartHour ?? 9,
            existing.testEnvelope.businessHoursStartHour ?? 9
          ),
          businessHoursEndHour: clampBusinessEndHour(
            patch.testEnvelope.businessHoursEndHour ?? existing.testEnvelope.businessHoursEndHour ?? 17,
            existing.testEnvelope.businessHoursEndHour ?? 17
          ),
          businessDays: normalizeBusinessDays(
            patch.testEnvelope.businessDays ?? existing.testEnvelope.businessDays ?? [1, 2, 3, 4, 5]
          ),
        }
      : existing.testEnvelope,
    successMetric: patch.successMetric
      ? {
          metric: "reply_rate",
          thresholdPct: Math.max(0, Number(patch.successMetric.thresholdPct ?? existing.successMetric.thresholdPct)),
        }
      : existing.successMetric,
    promotedCampaignId:
      typeof patch.promotedCampaignId === "string"
        ? patch.promotedCampaignId
        : existing.promotedCampaignId,
    updatedAt: now,
  };

  await syncRuntimeFromExperiment(next);
  const persisted = await persistExperiment(next);
  return hydrateExperimentRecord(persisted);
}

export async function deleteExperimentRecord(brandId: string, experimentId: string): Promise<boolean> {
  const existing = await getExperimentRecordById(brandId, experimentId);
  if (!existing) return false;

  const ownerRuns = await listOwnerRuns(brandId, "experiment", experimentId);
  const runtimeRuns =
    existing.runtime.campaignId && existing.runtime.experimentId
      ? await listExperimentRuns(brandId, existing.runtime.campaignId, existing.runtime.experimentId)
      : [];
  const runIds = Array.from(
    new Set([...ownerRuns, ...runtimeRuns].map((run) => run.id).filter(Boolean))
  );
  if (runIds.length) {
    await deleteOutreachRunsByIds(runIds);
  }

  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase.from(EXPERIMENT_TABLE).delete().eq("brand_id", brandId).eq("id", experimentId);
  }

  const localRows = await readJsonArray<ExperimentRecord>(EXPERIMENTS_PATH);
  const nextRows = localRows.filter((row) => !(row.brandId === brandId && row.id === experimentId));
  if (nextRows.length !== localRows.length) {
    await writeJsonArray(EXPERIMENTS_PATH, nextRows);
  }

  if (existing.runtime.campaignId) {
    await deleteCampaign(brandId, existing.runtime.campaignId);
  }

  return true;
}

export async function listScaleCampaignRecords(brandId: string): Promise<ScaleCampaignRecord[]> {
  const rows = await listScaleCampaignRowsFromStore(brandId);
  const hydrated = await Promise.all(rows.map((row) => hydrateScaleCampaignRecord(row)));
  return hydrated.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function listStoredScaleCampaignRecords(
  brandId: string
): Promise<ScaleCampaignRecord[]> {
  const rows = await listScaleCampaignRowsFromStore(brandId);
  return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getScaleCampaignRecordById(
  brandId: string,
  campaignId: string
): Promise<ScaleCampaignRecord | null> {
  const rows = await listScaleCampaignRowsFromStore(brandId);
  const hit = rows.find((row) => row.id === campaignId) ?? null;
  if (hit) {
    return hydrateScaleCampaignRecord(hit);
  }

  const sourceExperiment = await getLegacySourceExperimentByRuntimeCampaignId(brandId, campaignId);
  if (!sourceExperiment) return null;
  return normalizeLegacyRuntimeCampaign({ brandId, sourceExperiment });
}

export async function updateScaleCampaignRecord(
  brandId: string,
  campaignId: string,
  patch: Partial<Pick<ScaleCampaignRecord, "name" | "status" | "scalePolicy">>
): Promise<ScaleCampaignRecord | null> {
  const rows = await listScaleCampaignRowsFromStore(brandId);
  const persistedRow = rows.find((row) => row.id === campaignId) ?? null;
  if (!persistedRow) {
    const sourceExperiment = await getLegacySourceExperimentByRuntimeCampaignId(brandId, campaignId);
    if (!sourceExperiment) return null;

    const testEnvelopePatch = patch.scalePolicy
      ? {
          ...sourceExperiment.testEnvelope,
          dailyCap: Math.max(1, Number(patch.scalePolicy.dailyCap ?? sourceExperiment.testEnvelope.dailyCap)),
          hourlyCap: Math.max(1, Number(patch.scalePolicy.hourlyCap ?? sourceExperiment.testEnvelope.hourlyCap)),
          timezone: String(patch.scalePolicy.timezone ?? sourceExperiment.testEnvelope.timezone),
          minSpacingMinutes: Math.max(
            1,
            Number(patch.scalePolicy.minSpacingMinutes ?? sourceExperiment.testEnvelope.minSpacingMinutes)
          ),
        }
      : undefined;

    const nextStatus =
      patch.status === "paused"
        ? "paused"
        : patch.status === "completed"
          ? "completed"
          : patch.status === "active"
            ? "ready"
            : patch.status === "draft"
              ? "draft"
              : undefined;

    const updatedExperiment = await updateExperimentRecord(brandId, sourceExperiment.id, {
      ...(typeof patch.name === "string" ? { name: patch.name } : {}),
      ...(testEnvelopePatch ? { testEnvelope: testEnvelopePatch } : {}),
      ...(nextStatus ? { status: nextStatus } : {}),
    });

    if (patch.scalePolicy) {
      const nextAccountId = String(patch.scalePolicy.accountId ?? "").trim();
      const nextMailboxAccountId = String(patch.scalePolicy.mailboxAccountId ?? "").trim();
      if (nextAccountId || nextMailboxAccountId) {
        await setBrandOutreachAssignment(brandId, {
          accountId: nextAccountId,
          mailboxAccountId: nextMailboxAccountId,
        });
      }
    }

    if (!updatedExperiment) return null;
    return normalizeLegacyRuntimeCampaign({ brandId, sourceExperiment: updatedExperiment });
  }

  const existing = await hydrateScaleCampaignRecord(persistedRow);

  const next: ScaleCampaignRecord = {
    ...existing,
    name: typeof patch.name === "string" ? patch.name.trim() || existing.name : existing.name,
    status:
      patch.status && ["draft", "active", "paused", "completed", "archived"].includes(patch.status)
        ? patch.status
        : existing.status,
    scalePolicy: patch.scalePolicy
      ? {
          ...existing.scalePolicy,
          dailyCap: Math.max(1, Number(patch.scalePolicy.dailyCap ?? existing.scalePolicy.dailyCap)),
          hourlyCap: Math.max(1, Number(patch.scalePolicy.hourlyCap ?? existing.scalePolicy.hourlyCap)),
          timezone: String(patch.scalePolicy.timezone ?? existing.scalePolicy.timezone),
          minSpacingMinutes: Math.max(
            1,
            Number(patch.scalePolicy.minSpacingMinutes ?? existing.scalePolicy.minSpacingMinutes)
          ),
          accountId: String(patch.scalePolicy.accountId ?? existing.scalePolicy.accountId),
          mailboxAccountId: String(
            patch.scalePolicy.mailboxAccountId ?? existing.scalePolicy.mailboxAccountId
          ),
          safetyMode: patch.scalePolicy.safetyMode === "balanced" ? "balanced" : "strict",
        }
      : existing.scalePolicy,
    updatedAt: nowIso(),
  };

  const persisted = await persistScaleCampaign(next);
  return hydrateScaleCampaignRecord(persisted);
}

export async function deleteScaleCampaignRecord(
  brandId: string,
  campaignId: string
): Promise<boolean> {
  const existing = await getScaleCampaignRecordById(brandId, campaignId);
  if (!existing) return false;

  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase
      .from(SCALE_CAMPAIGN_TABLE)
      .delete()
      .eq("brand_id", brandId)
      .eq("id", campaignId);
  }

  const rows = await readJsonArray<ScaleCampaignRecord>(SCALE_CAMPAIGNS_PATH);
  const next = rows.filter(
    (row) => !(row.brandId === brandId && row.id === campaignId)
  );
  if (next.length !== rows.length) {
    await writeJsonArray(SCALE_CAMPAIGNS_PATH, next);
  }

  return true;
}

export async function promoteExperimentRecordToCampaign(input: {
  brandId: string;
  experimentId: string;
  campaignName?: string;
}): Promise<ScaleCampaignRecord> {
  const experiment = await getExperimentRecordById(input.brandId, input.experimentId);
  if (!experiment) {
    throw new Error("experiment not found");
  }

  const runtimeCampaignId = experiment.runtime.campaignId;
  const runtimeExperimentId = experiment.runtime.experimentId;
  if (!runtimeCampaignId || !runtimeExperimentId) {
    throw new Error("experiment runtime is not configured");
  }

  let runs = [] as Awaited<ReturnType<typeof listOwnerRuns>>;
  try {
    runs = await listOwnerRuns(input.brandId, "experiment", experiment.id);
  } catch {
    runs = [];
  }
  const fallbackRuns =
    runs.length === 0
      ? await (async () => {
          try {
            return await listExperimentRuns(input.brandId, runtimeCampaignId, runtimeExperimentId);
          } catch {
            return [];
          }
        })()
      : runs;
  if (!fallbackRuns.length) {
    throw new Error("Cannot promote before at least one test run exists");
  }

  if (experiment.promotedCampaignId.trim()) {
    const existing = await getScaleCampaignRecordById(input.brandId, experiment.promotedCampaignId.trim());
    if (existing) {
      return existing;
    }
  }

  const now = nowIso();
  const row: ScaleCampaignRecord = {
    id: createId("camp"),
    brandId: input.brandId,
    name: input.campaignName?.trim() || `${experiment.name} Campaign`,
    status: "draft",
    sourceExperimentId: experiment.id,
    snapshot: {
      offer: experiment.offer,
      audience: experiment.audience,
      mapId: experiment.messageFlow.mapId,
      publishedRevision: experiment.messageFlow.publishedRevision,
    },
    scalePolicy: {
      ...defaultScalePolicy(),
      dailyCap: experiment.testEnvelope.dailyCap,
      hourlyCap: experiment.testEnvelope.hourlyCap,
      timezone: experiment.testEnvelope.timezone,
      minSpacingMinutes: experiment.testEnvelope.minSpacingMinutes,
    },
    lastRunId: "",
    metricsSummary: defaultMetricsSummary(),
    createdAt: now,
    updatedAt: now,
  };

  const persistedCampaign = await persistScaleCampaign(row);

  await updateExperimentRecord(input.brandId, experiment.id, {
    status: "promoted",
    promotedCampaignId: persistedCampaign.id,
  });

  return hydrateScaleCampaignRecord(persistedCampaign);
}

export async function resolveRuntimeCampaignForExperiment(
  brandId: string,
  experimentId: string
): Promise<CampaignRecord | null> {
  const experiment = await getExperimentRecordById(brandId, experimentId);
  if (!experiment?.runtime.campaignId) return null;
  return getCampaignById(brandId, experiment.runtime.campaignId);
}

export async function resolveExperimentByCampaign(
  brandId: string,
  campaignId: string
): Promise<ExperimentRecord | null> {
  const campaigns = await listScaleCampaignRowsFromStore(brandId);
  const target = campaigns.find((row) => row.id === campaignId);
  if (!target) return null;
  return getExperimentRecordById(brandId, target.sourceExperimentId);
}

export async function ensureRuntimeForExperiment(record: ExperimentRecord): Promise<ExperimentRecord> {
  if (record.runtime.campaignId && record.runtime.hypothesisId && record.runtime.experimentId) {
    return record;
  }

  const runtime = await createRuntimeRef({
    brandId: record.brandId,
    name: record.name,
    offer: record.offer,
    audience: record.audience,
    testEnvelope: record.testEnvelope,
  });

  const next: ExperimentRecord = {
    ...record,
    runtime,
    updatedAt: nowIso(),
  };

  const persisted = await persistExperiment(next);
  return hydrateExperimentRecord(persisted);
}

export function defaultExperimentRecordInput() {
  return {
    name: "",
    offer: "",
    audience: "",
    testEnvelope: defaultTestEnvelope(),
  };
}

export function defaultScaleCampaignInput() {
  return {
    name: "",
    scalePolicy: defaultScalePolicy(),
  };
}
