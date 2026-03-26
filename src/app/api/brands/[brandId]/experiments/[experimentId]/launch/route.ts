import { NextResponse } from "next/server";
import { ensureRuntimeForExperiment, getExperimentRecordById, updateExperimentRecord } from "@/lib/experiment-data";
import {
  buildExperimentProspectTableConfig,
  ensureEnrichAnythingProspectTable,
  getEnrichAnythingProspectTableState,
} from "@/lib/enrichanything-live-table";
import { countExperimentSendableLeadContacts } from "@/lib/experiment-prospect-import";
import { getExperimentVerifiedEmailLeadTarget } from "@/lib/experiment-policy";
import { launchExperimentRun } from "@/lib/outreach-runtime";

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
  const minProspectsForLaunch = getExperimentVerifiedEmailLeadTarget(experiment);
  if (!experiment.runtime.campaignId || !experiment.runtime.experimentId) {
    return NextResponse.json(
      { error: "experiment runtime is not configured" },
      { status: 400 }
    );
  }

  const prospectTable = await getEnrichAnythingProspectTableState(
    buildExperimentProspectTableConfig(experiment)
  );

  if (prospectTable.rowCount < minProspectsForLaunch) {
    return NextResponse.json(
      {
        error: `Prospect validation failed: need at least ${minProspectsForLaunch} saved leads before launch.`,
        hint: `Go to Stage 1 (Prospects), keep sourcing until the first ${minProspectsForLaunch} leads are ready, then relaunch.`,
        debug: {
          prospectTableId: prospectTable.tableId,
          prospectWorkspaceId: prospectTable.workspaceId,
          savedLeadCount: prospectTable.rowCount,
        },
      },
      { status: 400 }
    );
  }

  const sendableSummary = await countExperimentSendableLeadContacts(brandId, experiment.id);
  if (sendableSummary.sendableLeadCount < minProspectsForLaunch) {
    return NextResponse.json(
      {
        error: "Launch is still waiting on approved EnrichAnything contacts with work emails.",
        hint: `Only approved EnrichAnything table leads are used for sending. Launch unlocks once ${minProspectsForLaunch} approved contacts with work emails are ready.`,
        debug: {
          approvedTableRows: prospectTable.rowCount,
          sendableLeadCount: sendableSummary.sendableLeadCount,
          sendableLeadRemaining: Math.max(
            0,
            minProspectsForLaunch - sendableSummary.sendableLeadCount
          ),
          runsChecked: sendableSummary.runsChecked,
        },
      },
      { status: 400 }
    );
  }

  const result = await launchExperimentRun({
    brandId,
    campaignId: experiment.runtime.campaignId,
    experimentId: experiment.runtime.experimentId,
    trigger: "manual",
    ownerType: "experiment",
    ownerId: experiment.id,
    maxLeadsOverride: 500,
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
