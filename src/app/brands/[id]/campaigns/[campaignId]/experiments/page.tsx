import RouteReplacedCard from "@/components/layout/route-replaced-card";

export default async function ExperimentsReplacedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteReplacedCard
      title="Legacy experiments step replaced"
      description="Use the new Experiments section at the brand level."
      brandId={id}
    />
  );
}
