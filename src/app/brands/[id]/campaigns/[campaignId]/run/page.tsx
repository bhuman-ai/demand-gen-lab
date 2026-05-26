import RouteReplacedCard from "@/components/layout/route-replaced-card";

export default async function CampaignRunReplacedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteReplacedCard
      title="Run route replaced"
      description="Run controls now live on each Test or promoted Outbound page."
      brandId={id}
    />
  );
}
