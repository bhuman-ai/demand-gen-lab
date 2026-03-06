import SuggestionsClient from "./suggestions-client";

export default async function ExperimentSuggestionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SuggestionsClient brandId={id} />;
}
