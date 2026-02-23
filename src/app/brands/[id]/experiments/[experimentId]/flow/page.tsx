import { notFound } from "next/navigation";
import { getExperimentRecordById } from "@/lib/experiment-data";
import FlowEditorClient from "@/app/brands/[id]/campaigns/[campaignId]/build/flows/[variantId]/flow-editor-client";

export default async function ExperimentFlowPage({
  params,
}: {
  params: Promise<{ id: string; experimentId: string }>;
}) {
  const { id, experimentId } = await params;
  const experiment = await getExperimentRecordById(id, experimentId);
  if (
    !experiment ||
    !experiment.runtime.campaignId ||
    !experiment.runtime.experimentId
  ) {
    notFound();
  }

  return (
    <FlowEditorClient
      brandId={id}
      campaignId={experiment.runtime.campaignId}
      variantId={experiment.runtime.experimentId}
      backHref={`/brands/${id}/experiments/${experiment.id}`}
    />
  );
}
