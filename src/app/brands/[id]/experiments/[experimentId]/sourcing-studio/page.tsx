import SourcingStudioClient from "./sourcing-studio-client";
import { resolveEnrichAnythingAppUrl } from "@/lib/enrichanything-app-url";

export default async function ExperimentSourcingStudioPage({
  params,
}: {
  params: Promise<{ id: string; experimentId: string }>;
}) {
  const { id, experimentId } = await params;

  return (
    <SourcingStudioClient
      brandId={id}
      experimentId={experimentId}
      enrichAnythingAppUrl={resolveEnrichAnythingAppUrl()}
    />
  );
}
