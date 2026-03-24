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
  importExperimentProspectRows,
  type ImportExperimentProspectRowsResult,
} from "@/lib/experiment-prospect-import";
import { getExperimentVerifiedEmailLeadTarget } from "@/lib/experiment-policy";
import { resolveEmailFinderApiBaseUrl } from "@/lib/outreach-providers";

const LIVE_TOP_UP_MIN_INTERVAL_MS = 20_000;

export type ExperimentSendablePrepResult = {
  targetCount: number;
  ready: boolean;
  hostManagedWorkspace: boolean;
  savedProspectCount: number;
  sendableLeadCount: number;
  sendableLeadRemaining: number;
  runsChecked: number;
  liveTopUpAttempted: boolean;
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
}): Promise<ExperimentSendablePrepResult> {
  const experiment = await getExperimentRecordById(input.brandId, input.experimentId);
  if (!experiment) {
    throw new Error("experiment not found");
  }

  const config = buildExperimentProspectTableConfig(experiment);
  const targetSendableContacts = getExperimentVerifiedEmailLeadTarget(experiment);
  const hostManagedWorkspace = isHostManagedWorkspace(config.workspaceId);
  const emailFinderApiBaseUrl = resolveEmailFinderApiBaseUrl(input.emailFinderApiBaseUrl);

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
        })
      : emptyImportResult();

  let sendableSummary = await countExperimentSendableLeadContacts(input.brandId, input.experimentId);
  let liveTopUpAttempted = false;
  let liveTopUpRunId = "";
  let liveTopUpRowsAppended = 0;
  let liveTopUpStatus = "";
  let liveTopUpError = "";
  let queryExhausted = false;

  if (sendableSummary.sendableLeadCount < targetSendableContacts) {
    const lastRunAtMs = tableState.lastRunAt ? Date.parse(tableState.lastRunAt) : Number.NaN;
    const canAttemptTopUp =
      !Number.isFinite(lastRunAtMs) || Date.now() - lastRunAtMs >= LIVE_TOP_UP_MIN_INTERVAL_MS;

    if (canAttemptTopUp) {
      liveTopUpAttempted = true;
      try {
        const liveRun = await runEnrichAnythingProspectTable(config);
        liveTopUpRunId = liveRun.runId;
        liveTopUpRowsAppended = liveRun.lastRowsAppended;
        liveTopUpStatus = liveRun.lastStatus;
        tableState = liveRun;

        if (liveTopUpRowsAppended > 0 || liveRun.rowCount > rows.length) {
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
                })
              : emptyImportResult();

          sendableSummary = await countExperimentSendableLeadContacts(input.brandId, input.experimentId);
        } else {
          queryExhausted = sendableSummary.sendableLeadCount < targetSendableContacts;
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
      }
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

  const emailFinderApiBaseUrl = resolveEmailFinderApiBaseUrl(
    options.emailFinderApiBaseUrl ||
      (options.requestOrigin
        ? `${options.requestOrigin.replace(/\/+$/, "")}/api/internal/email-finder`
        : "")
  );

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
