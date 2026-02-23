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
      description="Campaign setup now lives in Experiments. Create or edit an experiment, then launch tests from there."
      brandId={id}
    />
  );
}
