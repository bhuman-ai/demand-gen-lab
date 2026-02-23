import RouteReplacedCard from "@/components/layout/route-replaced-card";

export default async function ObjectiveReplacedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteReplacedCard
      title="Objective step replaced"
      description="Objective setup now lives inside each Experiment page."
      brandId={id}
    />
  );
}
