import RouteReplacedCard from "@/components/layout/route-replaced-card";

export default async function RunInsightsReplacedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteReplacedCard
      title="Run insights replaced"
      description="Insights are now shown directly on promoted Campaign pages."
      brandId={id}
    />
  );
}
