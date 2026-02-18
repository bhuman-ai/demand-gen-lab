import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";
import { listCampaignRuns, listRunAnomalies } from "@/lib/outreach-data";
import { runOutreachTick } from "@/lib/outreach-runtime";

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  // Best-effort queue drain to avoid runs appearing stuck when cron is delayed/misconfigured.
  try {
    await runOutreachTick(10);
  } catch {
    // Ignore tick errors for this read endpoint; we still return current run state.
  }

  const { brandId, campaignId } = await context.params;
  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const runs = await listCampaignRuns(brandId, campaignId);
  const anomalies = (
    await Promise.all(runs.map((run) => listRunAnomalies(run.id)))
  ).flat();

  return NextResponse.json({ runs, anomalies });
}
