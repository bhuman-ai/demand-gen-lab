import { redirect } from "next/navigation";

export default async function ExperimentFlowLegacyRedirect({
  params,
}: {
  params: Promise<{ id: string; experimentId: string }>;
}) {
  const { id, experimentId } = await params;
  redirect(`/brands/${id}/experiments/${experimentId}/messaging`);
}
