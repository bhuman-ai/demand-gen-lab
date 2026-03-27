import { NextResponse } from "next/server";
import { listExperimentRecords } from "@/lib/experiment-data";
import { mapExperimentToListItem, sortExperimentListItems } from "@/lib/experiment-list-view";
import { listExperimentRuns, listOwnerRuns, listRunMessages } from "@/lib/outreach-data";

async function hydrateRunMetricsFromMessages<T extends { id: string; metrics: Record<string, number> }>(
  run: T | null
): Promise<T | null> {
  if (!run) return null;
  const messages = await listRunMessages(run.id);
  const sentMessages = messages.filter((message) => message.status === "sent").length;
  const scheduledMessages = messages.filter((message) =>
    ["scheduled", "sent"].includes(message.status)
  ).length;
  const bouncedMessages = messages.filter((message) => message.status === "bounced").length;
  const failedMessages = messages.filter((message) => message.status === "failed").length;

  return {
    ...run,
    metrics: {
      ...run.metrics,
      scheduledMessages: Math.max(Number(run.metrics.scheduledMessages ?? 0) || 0, scheduledMessages),
      sentMessages,
      bouncedMessages,
      failedMessages,
    },
  };
}

export async function GET(_: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const experiments = await listExperimentRecords(brandId);
  const now = Date.now();
  const items = await Promise.all(
    experiments.map(async (experiment) => {
      const ownerRuns = await listOwnerRuns(brandId, "experiment", experiment.id);
      const runtimeRuns =
        experiment.runtime.campaignId && experiment.runtime.experimentId
          ? await listExperimentRuns(
              brandId,
              experiment.runtime.campaignId,
              experiment.runtime.experimentId
            )
          : [];
      const runs = Array.from(
        new Map(
          [...ownerRuns, ...runtimeRuns]
            .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
            .map((run) => [run.id, run] as const)
        ).values()
      );
      const preferredRunId = experiment.lastRunId.trim();
      const latestRun =
        (preferredRunId ? runs.find((run) => run.id === preferredRunId) ?? null : null) ??
        runs[0] ??
        null;
      const liveLatestRun = await hydrateRunMetricsFromMessages(latestRun);
      return mapExperimentToListItem({
        brandId,
        experiment,
        latestRun: liveLatestRun,
        now,
      });
    })
  );

  return NextResponse.json({ items: sortExperimentListItems(items) });
}
