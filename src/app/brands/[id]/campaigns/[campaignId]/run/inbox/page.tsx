import RouteReplacedCard from "@/components/layout/route-replaced-card";

export default async function RunInboxReplacedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteReplacedCard
      title="Run inbox replaced"
      description="Inbox handling is now consolidated in Experiment/Campaign run visibility and Brand Inbox."
      brandId={id}
    />
  );
}
