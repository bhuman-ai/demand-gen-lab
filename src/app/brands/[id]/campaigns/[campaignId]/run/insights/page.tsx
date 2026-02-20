import RunClient from "../run-client";

export default async function RunInsightsPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  return <RunClient brandId={id} campaignId={campaignId} tab="insights" />;
}
