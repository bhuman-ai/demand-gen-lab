import { NextResponse } from "next/server";
import {
  ensureRuntimeForExperiment,
  getExperimentRecordById,
  updateExperimentRecord,
} from "@/lib/experiment-data";
import { launchExperimentRun, runOutreachTick } from "@/lib/outreach-runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;
  const existing = await getExperimentRecordById(brandId, experimentId);
  if (!existing) {
    return NextResponse.json({ error: "experiment not found" }, { status: 404 });
  }

  const experiment = await ensureRuntimeForExperiment(existing);
  if (!experiment.runtime.campaignId || !experiment.runtime.experimentId) {
    return NextResponse.json({ error: "experiment runtime is not configured" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const sampleSize = Math.max(5, Math.min(100, Number(body.sampleSize ?? 20) || 20));

  const result = await launchExperimentRun({
    brandId,
    campaignId: experiment.runtime.campaignId,
    experimentId: experiment.runtime.experimentId,
    trigger: "manual",
    ownerType: "experiment",
    ownerId: experiment.id,
    sampleOnly: true,
    maxLeadsOverride: sampleSize,
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

  // Kick one immediate tick so sample sourcing starts without waiting for scheduler.
  await runOutreachTick(8);

  return NextResponse.json(
    {
      runId: result.runId,
      status: "queued",
      sampleSize,
    },
    { status: 201 }
  );
}
