import ExperimentsClient from "./experiments-client";

export default async function ExperimentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; suggestions?: string; launched?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  return (
    <ExperimentsClient
      brandId={id}
      openSuggestionsOnLoad={query?.from === "quiz" || query?.suggestions === "1"}
      launchedExperimentId={query?.launched ?? ""}
    />
  );
}
