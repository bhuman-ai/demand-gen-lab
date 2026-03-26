import { NextResponse } from "next/server";
import { listStoredExperimentRecords } from "@/lib/experiment-data";
import { mapExperimentToListItem, sortExperimentListItems } from "@/lib/experiment-list-view";
import { listExperimentRuns, listOwnerRuns } from "@/lib/outreach-data";

export async function GET(_: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const experiments = await listStoredExperimentRecords(brandId);
  const now = Date.now();
  const items = await Promise.all(
    experiments.map(async (experiment) => {
      let runs = await listOwnerRuns(brandId, "experiment", experiment.id);
      if (!runs.length && experiment.runtime.campaignId && experiment.runtime.experimentId) {
        runs = await listExperimentRuns(
          brandId,
          experiment.runtime.campaignId,
          experiment.runtime.experimentId
        );
      }
      const preferredRunId = experiment.lastRunId.trim();
      const latestRun =
        (preferredRunId ? runs.find((run) => run.id === preferredRunId) ?? null : null) ??
        runs[0] ??
        null;
      return mapExperimentToListItem({
        brandId,
        experiment,
        latestRun,
        now,
      });
    })
  );

  return NextResponse.json({ items: sortExperimentListItems(items) });
}
