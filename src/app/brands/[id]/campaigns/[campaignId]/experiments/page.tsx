import ExperimentsClient from "./experiments-client";

export default async function ExperimentsPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  return <ExperimentsClient brandId={id} campaignId={campaignId} />;
}
