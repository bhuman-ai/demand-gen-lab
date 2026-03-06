import ExperimentsClient from "./experiments-client";
import { redirect } from "next/navigation";

export default async function ExperimentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (query?.from === "quiz") {
    redirect(`/brands/${id}/experiments/suggestions?from=quiz`);
  }
  return <ExperimentsClient brandId={id} />;
}
