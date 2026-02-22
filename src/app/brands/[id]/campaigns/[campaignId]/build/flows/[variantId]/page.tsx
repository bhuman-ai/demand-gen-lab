import FlowEditorClient from "./flow-editor-client";

export default async function BuildFlowEditorPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string; variantId: string }>;
}) {
  const { id, campaignId, variantId } = await params;
  return <FlowEditorClient brandId={id} campaignId={campaignId} variantId={variantId} />;
}
