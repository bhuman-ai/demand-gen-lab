import RouteReplacedCard from "@/components/layout/route-replaced-card";

export default async function RunOverviewReplacedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteReplacedCard
      title="Run overview replaced"
      description="Open the Experiment or Campaign page for live run visibility, logs, and controls."
      brandId={id}
    />
  );
}
