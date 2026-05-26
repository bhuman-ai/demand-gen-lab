import RouteReplacedCard from "@/components/layout/route-replaced-card";

export default async function CampaignBuildReplacedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteReplacedCard
      title="Build route replaced"
      description="Outbound setup now lives in Tests. Create or edit a test, then launch from there."
      brandId={id}
    />
  );
}
