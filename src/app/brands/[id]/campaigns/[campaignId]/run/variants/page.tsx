import RouteReplacedCard from "@/components/layout/route-replaced-card";

export default async function RunVariantsReplacedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteReplacedCard
      title="Run variants replaced"
      description="Variant controls now live in Experiment detail."
      brandId={id}
    />
  );
}
