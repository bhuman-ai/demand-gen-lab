import ExperimentsClient from "./experiments-client";

export default async function ExperimentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  return <ExperimentsClient brandId={id} showFeedHint={query?.from === "quiz"} />;
}
