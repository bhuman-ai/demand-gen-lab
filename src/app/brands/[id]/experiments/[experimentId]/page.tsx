import { notFound, redirect } from "next/navigation";
import { getExperimentRecordById } from "@/lib/experiment-data";
import { listExperimentRuns, listOwnerRuns } from "@/lib/outreach-data";

const PROSPECT_TARGET = 200;

function setupComplete(experiment: NonNullable<Awaited<ReturnType<typeof getExperimentRecordById>>>) {
  return Boolean(
    experiment.name.trim() &&
      experiment.offer.trim() &&
      experiment.audience.trim() &&
      experiment.testEnvelope.timezone.trim()
  );
}

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ id: string; experimentId: string }>;
}) {
  const { id, experimentId } = await params;
  const experiment = await getExperimentRecordById(id, experimentId);
  if (!experiment) notFound();

  let runs = await listOwnerRuns(id, "experiment", experiment.id);
  if (!runs.length && experiment.runtime.campaignId && experiment.runtime.experimentId) {
    runs = await listExperimentRuns(id, experiment.runtime.campaignId, experiment.runtime.experimentId);
  }

  if (runs.length > 0) {
    redirect(`/brands/${id}/experiments/${experiment.id}/run`);
  }

  if (!setupComplete(experiment)) {
    redirect(`/brands/${id}/experiments/${experiment.id}/setup`);
  }

  const sourcedLeads = Number(runs[0]?.metrics?.sourcedLeads ?? 0);
  if (sourcedLeads < PROSPECT_TARGET) {
    redirect(`/brands/${id}/experiments/${experiment.id}/prospects`);
  }

  if (Number(experiment.messageFlow.publishedRevision ?? 0) <= 0) {
    redirect(`/brands/${id}/experiments/${experiment.id}/messaging`);
  }

  redirect(`/brands/${id}/experiments/${experiment.id}/launch`);
}
