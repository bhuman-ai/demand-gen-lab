import RouteReplacedCard from "@/components/layout/route-replaced-card";

export default async function HypothesesReplacedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteReplacedCard
      title="Hypotheses step replaced"
      description="Use the Experiments workspace. Hypothesis/variant jargon has been replaced with a single experiment-first flow."
      brandId={id}
    />
  );
}
