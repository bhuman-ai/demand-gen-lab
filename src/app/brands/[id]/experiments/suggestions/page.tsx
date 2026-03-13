import { redirect } from "next/navigation";

export default async function ExperimentSuggestionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/brands/${id}/experiments?suggestions=1`);
}
