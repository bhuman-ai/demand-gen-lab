import HypothesesClient from "./hypotheses-client";

export default async function HypothesesPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  return <HypothesesClient brandId={id} campaignId={campaignId} />;
}
