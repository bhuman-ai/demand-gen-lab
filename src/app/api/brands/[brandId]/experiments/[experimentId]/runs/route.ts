import { NextResponse } from "next/server";
import { getExperimentRecordById } from "@/lib/experiment-data";
import { listExperimentRuns, listOwnerRuns } from "@/lib/outreach-data";
import { buildRunVisibilityBundle } from "@/lib/run-visibility";

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;
  const experiment = await getExperimentRecordById(brandId, experimentId);
  if (!experiment) {
    return NextResponse.json({ error: "experiment not found" }, { status: 404 });
  }

  let runs = await listOwnerRuns(brandId, "experiment", experiment.id);
  if (
    !runs.length &&
    experiment.runtime.campaignId &&
    experiment.runtime.experimentId
  ) {
    runs = await listExperimentRuns(
      brandId,
      experiment.runtime.campaignId,
      experiment.runtime.experimentId
    );
  }

  const visibility = await buildRunVisibilityBundle({
    brandId,
    runs,
    campaignIdFilter: experiment.runtime.campaignId || undefined,
  });

  return NextResponse.json({
    run: {
      ...visibility,
      insights: [],
    },
  });
}
