import BuildClient from "./build-client";

export default async function CampaignBuildPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  return <BuildClient brandId={id} campaignId={campaignId} />;
}
