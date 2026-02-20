import Link from "next/link";

export default async function CampaignLandingPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Campaign Workspace</h2>
      <p className="text-sm text-[color:var(--muted-foreground)]">
        Open Build to define campaign setup, or Run to launch and monitor execution.
      </p>
      <div className="flex gap-2">
        <Link
          href={`/brands/${id}/campaigns/${campaignId}/build`}
          className="rounded-xl border border-[color:var(--border)] px-4 py-2 text-sm"
        >
          Open Build
        </Link>
        <Link
          href={`/brands/${id}/campaigns/${campaignId}/run/overview`}
          className="rounded-xl border border-[color:var(--border)] px-4 py-2 text-sm"
        >
          Open Run
        </Link>
        <Link
          href={`/brands/${id}/campaigns`}
          className="rounded-xl border border-[color:var(--border)] px-4 py-2 text-sm"
        >
          Back to Campaigns
        </Link>
      </div>
    </div>
  );
}
