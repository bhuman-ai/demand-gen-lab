import { NextResponse } from "next/server";
import { getExperimentRecordById, getScaleCampaignRecordById } from "@/lib/experiment-data";
import { listExperimentRuns, listOwnerRuns } from "@/lib/outreach-data";
import { buildRunVisibilityBundle } from "@/lib/run-visibility";

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;
  const campaign = await getScaleCampaignRecordById(brandId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  let runs = await listOwnerRuns(brandId, "campaign", campaign.id);
  if (!runs.length) {
    const sourceExperiment = await getExperimentRecordById(
      brandId,
      campaign.sourceExperimentId
    );
    if (
      sourceExperiment?.runtime.campaignId &&
      sourceExperiment.runtime.experimentId
    ) {
      runs = await listExperimentRuns(
        brandId,
        sourceExperiment.runtime.campaignId,
        sourceExperiment.runtime.experimentId
      );
    }
  }
  const visibility = await buildRunVisibilityBundle({ brandId, runs });

  return NextResponse.json({
    runs: visibility.runs,
    anomalies: visibility.anomalies,
    eventsByRun: visibility.eventsByRun,
    jobsByRun: visibility.jobsByRun,
    run: {
      ...visibility,
      insights: [],
    },
  });
}
