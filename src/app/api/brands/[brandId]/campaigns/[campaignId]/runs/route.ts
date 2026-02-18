import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";
import { listCampaignRuns, listRunAnomalies, listRunEvents, listRunJobs } from "@/lib/outreach-data";
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
  const [anomaliesByRun, eventsByRunEntries, jobsByRunEntries] = await Promise.all([
    Promise.all(runs.map((run) => listRunAnomalies(run.id))),
    Promise.all(runs.map(async (run) => [run.id, await listRunEvents(run.id)] as const)),
    Promise.all(runs.map(async (run) => [run.id, await listRunJobs(run.id, 25)] as const)),
  ]);

  const anomalies = anomaliesByRun.flat();
  const eventsByRun = Object.fromEntries(eventsByRunEntries);
  const jobsByRun = Object.fromEntries(jobsByRunEntries);

  return NextResponse.json({ runs, anomalies, eventsByRun, jobsByRun });
}
