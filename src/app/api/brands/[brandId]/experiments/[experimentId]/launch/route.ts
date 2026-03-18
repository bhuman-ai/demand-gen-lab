import { NextResponse } from "next/server";
import { ensureRuntimeForExperiment, getExperimentRecordById, updateExperimentRecord } from "@/lib/experiment-data";
import {
  buildExperimentProspectTableConfig,
  ensureEnrichAnythingProspectTable,
  getEnrichAnythingProspectTableRows,
  getEnrichAnythingProspectTableState,
} from "@/lib/enrichanything-live-table";
import { importExperimentProspectRows } from "@/lib/experiment-prospect-import";
import { EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS } from "@/lib/experiment-policy";
import { listOwnerRuns, listRunLeads } from "@/lib/outreach-data";
import { launchExperimentRun } from "@/lib/outreach-runtime";

const MIN_PROSPECTS_FOR_LAUNCH = EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS;

export async function POST(
  _: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;
  const existing = await getExperimentRecordById(brandId, experimentId);
  if (!existing) {
    return NextResponse.json({ error: "experiment not found" }, { status: 404 });
  }

  const experiment = await ensureRuntimeForExperiment(existing);
  if (!experiment.runtime.campaignId || !experiment.runtime.experimentId) {
    return NextResponse.json(
      { error: "experiment runtime is not configured" },
      { status: 400 }
    );
  }

  const prospectTable = await getEnrichAnythingProspectTableState(
    buildExperimentProspectTableConfig(experiment)
  );

  if (prospectTable.rowCount < MIN_PROSPECTS_FOR_LAUNCH) {
    return NextResponse.json(
      {
        error: `Prospect validation failed: need at least ${MIN_PROSPECTS_FOR_LAUNCH} saved leads before launch.`,
        hint: "Go to Stage 1 (Prospects), keep sourcing until the first 20 leads are ready, then relaunch.",
        debug: {
          prospectTableId: prospectTable.tableId,
          prospectWorkspaceId: prospectTable.workspaceId,
          savedLeadCount: prospectTable.rowCount,
        },
      },
      { status: 400 }
    );
  }

  const existingRuns = await listOwnerRuns(brandId, "experiment", experiment.id);
  const existingLeadLists = await Promise.all(existingRuns.map((run) => listRunLeads(run.id)));
  const existingLeadCount = existingLeadLists.flat().length;

  if (existingLeadCount <= 0) {
    const tableRows = await getEnrichAnythingProspectTableRows(
      buildExperimentProspectTableConfig(experiment)
    );
    const importResult = await importExperimentProspectRows({
      brandId,
      experimentId,
      rows: tableRows,
      requestOrigin: new URL(_.url).origin,
      tableTitle: prospectTable.tableTitle,
      prompt: prospectTable.discoveryPrompt,
      entityType: prospectTable.entityType,
    });

    if (importResult.importedCount <= 0) {
      return NextResponse.json(
        {
          error:
            "Launch could not find any sendable leads yet. The approved prospects table has people, but none have been imported as verified contact leads.",
          hint:
            "Go back to Prospects and let AI keep checking emails, or refine the targeting so more rows resolve to a real work email.",
          debug: {
            approvedTableRows: prospectTable.rowCount,
            importedLeadCount: importResult.importedCount,
            attemptedCount: importResult.attemptedCount,
            matchedCount: importResult.matchedCount,
            parseErrorCount: importResult.parseErrorCount,
          },
        },
        { status: 400 }
      );
    }
  }

  const result = await launchExperimentRun({
    brandId,
    campaignId: experiment.runtime.campaignId,
    experimentId: experiment.runtime.experimentId,
    trigger: "manual",
    ownerType: "experiment",
    ownerId: experiment.id,
  });

  if (!result.ok) {
    await updateExperimentRecord(brandId, experiment.id, {
      status: "ready",
    });

    return NextResponse.json(
      {
        error: result.reason,
        runId: result.runId,
        hint: result.hint,
        debug: result.debug,
      },
      { status: 400 }
    );
  }

  await updateExperimentRecord(brandId, experiment.id, {
    status: "running",
  });

  try {
    await ensureEnrichAnythingProspectTable(
      buildExperimentProspectTableConfig(experiment, { enabled: true })
    );
  } catch {
    // Best effort only. Launching should not fail just because the live prospect table could not switch on.
  }

  return NextResponse.json({ runId: result.runId, status: "queued" }, { status: 201 });
}
