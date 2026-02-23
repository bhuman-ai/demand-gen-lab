import RouteReplacedCard from "@/components/layout/route-replaced-card";

export default async function RunLeadsReplacedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteReplacedCard
      title="Run leads replaced"
      description="Leads are now available in Experiment/Campaign Run visibility and the brand Leads module."
      brandId={id}
    />
  );
}
