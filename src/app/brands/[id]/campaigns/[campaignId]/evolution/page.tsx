import EvolutionClient from "./evolution-client";

export default async function EvolutionPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  return <EvolutionClient brandId={id} campaignId={campaignId} />;
}
