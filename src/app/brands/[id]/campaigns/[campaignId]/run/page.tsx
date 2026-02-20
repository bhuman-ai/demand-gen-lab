import { redirect } from "next/navigation";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  redirect(`/brands/${id}/campaigns/${campaignId}/run/overview`);
}
