import RouteReplacedCard from "@/components/layout/route-replaced-card";

export default async function EvolutionReplacedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteReplacedCard
      title="Evolution step replaced"
      description="Insights now live on campaign execution pages."
      brandId={id}
    />
  );
}
