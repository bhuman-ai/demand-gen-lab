import ExperimentClient from "../experiment-client";
import { resolveEnrichAnythingAppUrl } from "@/lib/enrichanything-app-url";

export default async function ExperimentProspectsPage({
  params,
}: {
  params: Promise<{ id: string; experimentId: string }>;
}) {
  const { id, experimentId } = await params;
  return (
    <ExperimentClient
      brandId={id}
      experimentId={experimentId}
      view="prospects"
      enrichAnythingAppUrl={resolveEnrichAnythingAppUrl()}
    />
  );
}
