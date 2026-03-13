import { NextResponse } from "next/server";
import {
  getExperimentRecordById,
  getScaleCampaignRecordById,
} from "@/lib/experiment-data";
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
  context: { params: Promise<{ brandId: string; campaignId: string; runId: string }> }
) {
  const { brandId, campaignId, runId } = await context.params;
  const campaign = await getScaleCampaignRecordById(brandId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const run = await getOutreachRun(runId);
  if (!run || run.brandId !== brandId) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  const sourceExperiment = await getExperimentRecordById(
    brandId,
    campaign.sourceExperimentId
  );
  const ownedByCampaign =
    (run.ownerType === "campaign" && run.ownerId === campaign.id) ||
    (Boolean(sourceExperiment?.runtime.campaignId) &&
      run.campaignId === sourceExperiment?.runtime.campaignId &&
      run.experimentId === sourceExperiment?.runtime.experimentId);
  if (!ownedByCampaign) {
    return NextResponse.json({ error: "run does not belong to this campaign" }, { status: 400 });
  }

  const body = asRecord(await request.json());
  const actionRaw = String(body.action ?? "").toLowerCase();
  const action = ["pause", "resume", "cancel", "probe_deliverability", "resume_sender_deliverability"].includes(actionRaw)
    ? (actionRaw as "pause" | "resume" | "cancel" | "probe_deliverability" | "resume_sender_deliverability")
    : null;

  if (!action) {
    return NextResponse.json({ error: "action must be pause, resume, cancel, probe_deliverability, or resume_sender_deliverability" }, { status: 400 });
  }

  const result = await updateRunControl({
    brandId,
    campaignId: run.campaignId,
    runId,
    action,
    reason: typeof body.reason === "string" ? body.reason : undefined,
    senderAccountId: typeof body.senderAccountId === "string" ? body.senderAccountId : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ ok: true, message: result.reason });
}
