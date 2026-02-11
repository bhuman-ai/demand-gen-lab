import CampaignsClient from "./campaigns-client";

export default async function CampaignsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignsClient brandId={id} />;
}
