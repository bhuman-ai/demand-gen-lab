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
      description="Audience is now available in Test/Outbound run visibility and the brand Audience module."
      brandId={id}
    />
  );
}
