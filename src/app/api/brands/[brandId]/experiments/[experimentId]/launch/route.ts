import { NextResponse } from "next/server";
import { ensureRuntimeForExperiment, getExperimentRecordById, updateExperimentRecord } from "@/lib/experiment-data";
import { listConversationPreviewLeads } from "@/lib/conversation-preview-leads";
import { EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS } from "@/lib/experiment-policy";
import { launchExperimentRun } from "@/lib/outreach-runtime";

const MIN_REAL_PROSPECTS_FOR_LAUNCH = EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS;

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

  const preview = await listConversationPreviewLeads({
    brandId,
    campaignId: experiment.runtime.campaignId,
    experimentId: experiment.runtime.experimentId,
    limit: 50,
    maxRuns: 1,
  });

  if (preview.qualifiedLeadWithEmailCount < MIN_REAL_PROSPECTS_FOR_LAUNCH) {
    return NextResponse.json(
      {
        error: `Prospect validation failed: need at least ${MIN_REAL_PROSPECTS_FOR_LAUNCH} qualified leads with real work emails before launch.`,
        hint: "Go to Stage 1 (Prospects), run auto-sourcing/import, and wait for the gate to pass.",
        debug: {
          qualifiedLeadCount: preview.qualifiedLeadCount,
          qualifiedLeadWithEmailCount: preview.qualifiedLeadWithEmailCount,
          qualifiedLeadWithoutEmailCount: preview.qualifiedLeadWithoutEmailCount,
          runsChecked: preview.runsChecked,
          sourceExperimentId: preview.sourceExperimentId,
          runtimeRefFound: preview.runtimeRefFound,
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

  return NextResponse.json({ runId: result.runId, status: "queued" }, { status: 201 });
}
