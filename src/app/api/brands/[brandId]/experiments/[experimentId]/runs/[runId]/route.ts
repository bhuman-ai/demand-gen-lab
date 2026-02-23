import { NextResponse } from "next/server";
import { getExperimentRecordById } from "@/lib/experiment-data";
import { getOutreachRun } from "@/lib/outreach-data";
import { updateRunControl } from "@/lib/outreach-runtime";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ brandId: string; experimentId: string; runId: string }> }
) {
  const { brandId, experimentId, runId } = await context.params;
  const experiment = await getExperimentRecordById(brandId, experimentId);
  if (!experiment) {
    return NextResponse.json({ error: "experiment not found" }, { status: 404 });
  }

  const run = await getOutreachRun(runId);
  if (!run || run.brandId !== brandId) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  const ownedByExperiment =
    (run.ownerType === "experiment" && run.ownerId === experiment.id) ||
    (experiment.runtime.campaignId === run.campaignId &&
      experiment.runtime.experimentId === run.experimentId);

  if (!ownedByExperiment) {
    return NextResponse.json({ error: "run does not belong to this experiment" }, { status: 400 });
  }

  const body = asRecord(await request.json());
  const actionRaw = String(body.action ?? "").toLowerCase();
  const action = ["pause", "resume", "cancel"].includes(actionRaw)
    ? (actionRaw as "pause" | "resume" | "cancel")
    : null;

  if (!action) {
    return NextResponse.json({ error: "action must be pause, resume, or cancel" }, { status: 400 });
  }

  const result = await updateRunControl({
    brandId,
    campaignId: run.campaignId,
    runId,
    action,
    reason: typeof body.reason === "string" ? body.reason : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ ok: true, message: result.reason });
}
