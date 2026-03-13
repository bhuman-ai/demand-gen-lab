"use client";

import LeadFinderEmbed from "@/components/experiments/lead-finder-embed";

export default function SourcingStudioClient({
  brandId,
  experimentId,
  enrichAnythingAppUrl,
}: {
  brandId: string;
  experimentId: string;
  enrichAnythingAppUrl: string;
}) {
  return (
    <LeadFinderEmbed
      brandId={brandId}
      experimentId={experimentId}
      enrichAnythingAppUrl={enrichAnythingAppUrl}
      layout="page"
      showBackLink
    />
  );
}
