import ObjectiveClient from "./objective-client";

export default async function ObjectivePage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  return <ObjectiveClient brandId={id} campaignId={campaignId} />;
}
