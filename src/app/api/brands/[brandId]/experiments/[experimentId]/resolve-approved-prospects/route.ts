import { NextResponse } from "next/server";
import { getExperimentRecordById } from "@/lib/experiment-data";
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
import { EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS } from "@/lib/experiment-policy";

const TARGET_SENDABLE_CONTACTS = EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS;
const LIVE_TOP_UP_MIN_INTERVAL_MS = 20_000;

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
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;
  const experiment = await getExperimentRecordById(brandId, experimentId);
  if (!experiment) {
    return NextResponse.json({ error: "experiment not found" }, { status: 404 });
  }

  try {
    const config = buildExperimentProspectTableConfig(experiment);
    const hostManagedWorkspace = isHostManagedWorkspace(config.workspaceId);
    let tableState = await ensureEnrichAnythingProspectTable(config);
    let rows = tableState.rowCount > 0 ? await getEnrichAnythingProspectTableRows(config) : [];

    let importResult =
      rows.length > 0
        ? await importExperimentProspectRows({
            brandId,
            experimentId,
            rows,
            requestOrigin: new URL(request.url).origin,
            tableTitle: tableState.tableTitle,
            prompt: tableState.discoveryPrompt,
            entityType: tableState.entityType,
          })
        : emptyImportResult();

    let sendableSummary = await countExperimentSendableLeadContacts(brandId, experimentId);
    let liveTopUpAttempted = false;
    let liveTopUpRunId = "";
    let liveTopUpRowsAppended = 0;
    let liveTopUpStatus = "";
    let liveTopUpError = "";
    let queryExhausted = false;

    if (sendableSummary.sendableLeadCount < TARGET_SENDABLE_CONTACTS) {
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
                    brandId,
                    experimentId,
                    rows,
                    requestOrigin: new URL(request.url).origin,
                    tableTitle: liveRun.tableTitle,
                    prompt: liveRun.discoveryPrompt,
                    entityType: liveRun.entityType,
                  })
                : emptyImportResult();

            sendableSummary = await countExperimentSendableLeadContacts(brandId, experimentId);
          } else {
            queryExhausted = sendableSummary.sendableLeadCount < TARGET_SENDABLE_CONTACTS;
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

    return NextResponse.json({
      targetCount: TARGET_SENDABLE_CONTACTS,
      ready: sendableSummary.sendableLeadCount >= TARGET_SENDABLE_CONTACTS,
      hostManagedWorkspace,
      savedProspectCount: tableState.rowCount,
      sendableLeadCount: sendableSummary.sendableLeadCount,
      sendableLeadRemaining: Math.max(
        0,
        TARGET_SENDABLE_CONTACTS - sendableSummary.sendableLeadCount
      ),
      runsChecked: sendableSummary.runsChecked,
      liveTopUpAttempted,
      liveTopUpRunId,
      liveTopUpRowsAppended,
      liveTopUpStatus,
      liveTopUpError,
      queryExhausted,
      ...importResult,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve approved prospects.";

    if (message === "experiment runtime is not configured") {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: "Failed to resolve approved prospects.",
        hint: message,
      },
      { status: 500 }
    );
  }
}
