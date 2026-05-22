import { listBrands } from "@/lib/factory-data";
import {
  getExperimentRecordById,
  listExperimentRecords,
} from "@/lib/experiment-data";
import type { ExperimentRecord } from "@/lib/factory-types";
import { maybeAutoLaunchPreparedExperiment } from "@/lib/experiment-auto-launch";
import {
  buildExperimentProspectTableConfig,
  ensureEnrichAnythingProspectTable,
  getEnrichAnythingProspectTableRows,
  runEnrichAnythingProspectTable,
} from "@/lib/enrichanything-live-table";
import {
  countExperimentSendableLeadContacts,
  emptyProspectLeadQualityPipeline,
  importExperimentProspectRows,
  reverifyStoredOwnerLeads,
  type ImportExperimentProspectRowsResult,
} from "@/lib/experiment-prospect-import";
import { getExperimentVerifiedEmailLeadTarget } from "@/lib/experiment-policy";
import {
  resolveEnrichAnythingPrepMaxRowsPerRun,
  resolveEnrichAnythingPrepRequestTimeoutMs,
  shouldDeferHostManagedEnrichAnythingLiveTopUp,
} from "@/lib/outreach-prep-policy";
import { resolveEmailFinderApiBaseUrl } from "@/lib/outreach-providers";

const LIVE_TOP_UP_MIN_INTERVAL_MS = 20_000;

function areEnrichAnythingTablesEnabled() {
  const raw = String(process.env.ENRICHANYTHING_TABLES_ENABLED ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

export type ExperimentSendablePrepResult = {
  targetCount: number;
  ready: boolean;
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
} & ImportExperimentProspectRowsResult;

export type ExperimentSendablePrepTickResult = {
  brandsChecked: number;
  experimentsChecked: number;
  experimentsPrepared: number;
  experimentsReady: number;
  experimentsAdvanced: number;
  experimentsLaunched: number;
  experimentsLaunchBlocked: number;
  liveTopUpsAttempted: number;
  errors: Array<{ brandId: string; experimentId: string; error: string }>;
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
    normalized.includes("not enough credits remain")
  );
}

function emptyImportResult(): ImportExperimentProspectRowsResult {
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
  };
}

function shouldPrepareExperimentInBackground(experiment: ExperimentRecord) {
  if (!experiment.runtime.campaignId || !experiment.runtime.experimentId || !experiment.runtime.hypothesisId) {
    return false;
  }
  if (!experiment.offer.trim() || !experiment.audience.trim()) {
    return false;
  }
  if (experiment.status === "archived" || experiment.status === "completed" || experiment.status === "promoted") {
    return false;
  }
  return experiment.messageFlow.publishedRevision > 0;
}

export async function prepareExperimentSendableContacts(input: {
  brandId: string;
  experimentId: string;
  requestOrigin?: string;
  emailFinderApiBaseUrl?: string;
  allowLiveTopUp?: boolean;
  backgroundMode?: boolean;
  maxLiveTopUpPasses?: number;
  enrichAnythingRunTimeoutMs?: number;
  targetSendableContactsOverride?: number;
  emailFinderTimeoutMs?: number;
  emailFinderMaxCredits?: number;
  emailFinderRetryOnFailure?: boolean;
  maxCandidatesPerBatch?: number;
  prepAttempt?: number;
}): Promise<ExperimentSendablePrepResult> {
  const experiment = await getExperimentRecordById(input.brandId, input.experimentId);
  if (!experiment) {
    throw new Error("experiment not found");
  }

  const config = buildExperimentProspectTableConfig(experiment);
  const targetSendableContacts = Math.max(
    getExperimentVerifiedEmailLeadTarget(experiment),
    Math.min(500, Math.round(Number(input.targetSendableContactsOverride ?? 0) || 0))
  );
  const hostManagedWorkspace = isHostManagedWorkspace(config.workspaceId);
  const oneContactPerCompany = experiment.testEnvelope.oneContactPerCompany !== false;
  const emailFinderApiBaseUrl = resolveEmailFinderApiBaseUrl(input.emailFinderApiBaseUrl);
  const liveRunTimeoutMs = resolveEnrichAnythingPrepRequestTimeoutMs(input.enrichAnythingRunTimeoutMs);
  const liveTopUpMaxRowsPerRun = resolveEnrichAnythingPrepMaxRowsPerRun();

  let tableState = await ensureEnrichAnythingProspectTable(config);
  let rows = tableState.rowCount > 0 ? await getEnrichAnythingProspectTableRows(config) : [];

  let importResult =
    rows.length > 0
      ? await importExperimentProspectRows({
          brandId: input.brandId,
          experimentId: input.experimentId,
          rows,
          requestOrigin: input.requestOrigin,
          emailFinderApiBaseUrl,
          tableTitle: tableState.tableTitle,
          prompt: tableState.discoveryPrompt,
          entityType: tableState.entityType,
          emailFinderTimeoutMs: input.emailFinderTimeoutMs,
          emailFinderMaxCredits: input.emailFinderMaxCredits,
          emailFinderRetryOnFailure: input.emailFinderRetryOnFailure,
          maxCandidatesPerBatch: input.maxCandidatesPerBatch,
          prepAttempt: input.prepAttempt,
        })
      : emptyImportResult();

  await reverifyStoredOwnerLeads({
    brandId: input.brandId,
    ownerType: "experiment",
    ownerId: experiment.id,
    oneContactPerCompany,
  });

  let sendableSummary = await countExperimentSendableLeadContacts(input.brandId, input.experimentId);
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
  });
  if (deferHostManagedLiveTopUp) {
    liveTopUpStatus = "deferred";
  }
  const maxLiveTopUpPasses = input.allowLiveTopUp
    ? deferHostManagedLiveTopUp
      ? 0
      : Math.max(1, Math.min(10, Math.trunc(Number(input.maxLiveTopUpPasses ?? 1) || 1)))
    : 0;

  while (liveTopUpAttempts < maxLiveTopUpPasses && sendableSummary.sendableLeadCount < targetSendableContacts) {
    const lastRunAtMs = tableState.lastRunAt ? Date.parse(tableState.lastRunAt) : Number.NaN;
    const canAttemptTopUp =
      liveTopUpAttempts > 0 ||
      !Number.isFinite(lastRunAtMs) ||
      Date.now() - lastRunAtMs >= LIVE_TOP_UP_MIN_INTERVAL_MS;

    if (!canAttemptTopUp) {
      break;
    }

    liveTopUpAttempted = true;
    liveTopUpAttempts += 1;
    try {
      const previousSendableLeadCount = sendableSummary.sendableLeadCount;
      const previousRowCount = rows.length;
      const liveRun = await runEnrichAnythingProspectTable(config, {
        timeoutMs: liveRunTimeoutMs,
        maxRowsPerRun: liveTopUpMaxRowsPerRun,
      });
      liveTopUpRunId = liveRun.runId;
      liveTopUpRowsAppended = liveRun.lastRowsAppended;
      liveTopUpStatus = liveRun.runStatus === "completed" ? liveRun.lastStatus : liveRun.runStatus;
      tableState = liveRun;

      if (liveRun.runStatus !== "completed") {
        break;
      }

      if (liveTopUpRowsAppended > 0 || liveRun.rowCount > previousRowCount) {
        rows = liveRun.rowCount > 0 ? await getEnrichAnythingProspectTableRows(config) : [];
        importResult =
          rows.length > 0
            ? await importExperimentProspectRows({
                brandId: input.brandId,
                experimentId: input.experimentId,
                rows,
                requestOrigin: input.requestOrigin,
                emailFinderApiBaseUrl,
                tableTitle: liveRun.tableTitle,
                prompt: liveRun.discoveryPrompt,
                entityType: liveRun.entityType,
                emailFinderTimeoutMs: input.emailFinderTimeoutMs,
                emailFinderMaxCredits: input.emailFinderMaxCredits,
                emailFinderRetryOnFailure: input.emailFinderRetryOnFailure,
                maxCandidatesPerBatch: input.maxCandidatesPerBatch,
                prepAttempt: input.prepAttempt,
              })
            : emptyImportResult();

        await reverifyStoredOwnerLeads({
          brandId: input.brandId,
          ownerType: "experiment",
          ownerId: experiment.id,
          oneContactPerCompany,
        });

        sendableSummary = await countExperimentSendableLeadContacts(input.brandId, input.experimentId);
      } else {
        queryExhausted = sendableSummary.sendableLeadCount < targetSendableContacts;
        break;
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

      if (!shouldRetryBecauseInventoryDidNotAdvance) {
        break;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Live prospect top-up failed.";
      if (hostManagedWorkspace && hasQuotaLikeTopUpError(message)) {
        liveTopUpStatus = "idle";
        liveTopUpError = "";
        tableState = await ensureEnrichAnythingProspectTable(config);
      } else {
        liveTopUpStatus = "failed";
        liveTopUpError = message;
      }
      break;
    }
  }

  return {
    targetCount: targetSendableContacts,
    ready: sendableSummary.sendableLeadCount >= targetSendableContacts,
    hostManagedWorkspace,
    savedProspectCount: tableState.rowCount,
    sendableLeadCount: sendableSummary.sendableLeadCount,
    sendableLeadRemaining: Math.max(
      0,
      targetSendableContacts - sendableSummary.sendableLeadCount
    ),
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

export async function runExperimentSendablePrepTick(
  limit = 8,
  options: { requestOrigin?: string; emailFinderApiBaseUrl?: string } = {}
): Promise<ExperimentSendablePrepTickResult> {
  if (!areEnrichAnythingTablesEnabled()) {
    return {
      brandsChecked: 0,
      experimentsChecked: 0,
      experimentsPrepared: 0,
      experimentsReady: 0,
      experimentsAdvanced: 0,
      experimentsLaunched: 0,
      experimentsLaunchBlocked: 0,
      liveTopUpsAttempted: 0,
      errors: [],
    };
  }
  const brands = await listBrands();
  const results: ExperimentSendablePrepTickResult = {
    brandsChecked: brands.length,
    experimentsChecked: 0,
    experimentsPrepared: 0,
    experimentsReady: 0,
    experimentsAdvanced: 0,
    experimentsLaunched: 0,
    experimentsLaunchBlocked: 0,
    liveTopUpsAttempted: 0,
    errors: [],
  };

  const emailFinderApiBaseUrl =
    resolveEmailFinderApiBaseUrl(options.emailFinderApiBaseUrl) ||
    (options.requestOrigin
      ? `${options.requestOrigin.replace(/\/+$/, "")}/api/internal/email-finder`
      : "");

  for (const brand of brands) {
    if (results.experimentsChecked >= limit) break;
    const experiments = await listExperimentRecords(brand.id);

    for (const experiment of experiments) {
      if (results.experimentsChecked >= limit) break;
      if (!shouldPrepareExperimentInBackground(experiment)) {
        continue;
      }

      results.experimentsChecked += 1;

      try {
        const before = await countExperimentSendableLeadContacts(brand.id, experiment.id);
        const targetSendableContacts = getExperimentVerifiedEmailLeadTarget(experiment);
        if (before.sendableLeadCount >= targetSendableContacts) {
          results.experimentsReady += 1;
          const launch = await maybeAutoLaunchPreparedExperiment(experiment);
          if (launch.launched) {
            results.experimentsLaunched += 1;
          } else if (launch.blocked) {
            results.experimentsLaunchBlocked += 1;
          }
          continue;
        }

        const prep = await prepareExperimentSendableContacts({
          brandId: brand.id,
          experimentId: experiment.id,
          requestOrigin: options.requestOrigin,
          emailFinderApiBaseUrl,
          allowLiveTopUp: true,
          backgroundMode: true,
          maxLiveTopUpPasses: 2,
        });

        results.experimentsPrepared += 1;
        if (prep.liveTopUpAttempted) {
          results.liveTopUpsAttempted += 1;
        }
        if (prep.ready) {
          results.experimentsReady += 1;
          const latestExperiment = (await getExperimentRecordById(brand.id, experiment.id)) ?? experiment;
          const launch = await maybeAutoLaunchPreparedExperiment(latestExperiment);
          if (launch.launched) {
            results.experimentsLaunched += 1;
          } else if (launch.blocked) {
            results.experimentsLaunchBlocked += 1;
          }
        }
        if (prep.sendableLeadCount > before.sendableLeadCount) {
          results.experimentsAdvanced += 1;
        }
      } catch (error) {
        results.errors.push({
          brandId: brand.id,
          experimentId: experiment.id,
          error: error instanceof Error ? error.message : "Experiment sendable prep failed",
        });
      }
    }
  }

  return results;
}
