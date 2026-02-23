import CampaignClient from "./campaign-client";

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  return <CampaignClient brandId={id} campaignId={campaignId} />;
}
