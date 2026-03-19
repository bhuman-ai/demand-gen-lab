import { NextResponse } from "next/server";
import { getExperimentRecordById } from "@/lib/experiment-data";
import {
  buildExperimentProspectTableConfig,
  getEnrichAnythingProspectTableRows,
  getEnrichAnythingProspectTableState,
} from "@/lib/enrichanything-live-table";
import {
  countExperimentSendableLeadContacts,
  importExperimentProspectRows,
  type ImportExperimentProspectRowsResult,
} from "@/lib/experiment-prospect-import";
import { EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS } from "@/lib/experiment-policy";

const TARGET_SENDABLE_CONTACTS = EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS;

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
    const tableState = await getEnrichAnythingProspectTableState(config);
    const rows = tableState.rowCount > 0 ? await getEnrichAnythingProspectTableRows(config) : [];

    const importResult =
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

    const sendableSummary = await countExperimentSendableLeadContacts(brandId, experimentId);

    return NextResponse.json({
      targetCount: TARGET_SENDABLE_CONTACTS,
      ready: sendableSummary.sendableLeadCount >= TARGET_SENDABLE_CONTACTS,
      savedProspectCount: tableState.rowCount,
      sendableLeadCount: sendableSummary.sendableLeadCount,
      sendableLeadRemaining: Math.max(
        0,
        TARGET_SENDABLE_CONTACTS - sendableSummary.sendableLeadCount
      ),
      runsChecked: sendableSummary.runsChecked,
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
