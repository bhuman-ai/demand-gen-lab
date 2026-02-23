"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Rocket, Trash2 } from "lucide-react";
import {
  fetchBrand,
  fetchScaleCampaigns,
} from "@/lib/client-api";
import type { BrandRecord, ScaleCampaignRecord } from "@/lib/factory-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function statusVariant(status: ScaleCampaignRecord["status"]) {
  if (status === "active") return "accent" as const;
  if (status === "completed") return "success" as const;
  if (status === "paused") return "danger" as const;
  return "muted" as const;
}

export default function CampaignsClient({ brandId }: { brandId: string }) {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaigns, setCampaigns] = useState<ScaleCampaignRecord[]>([]);
  const [error, setError] = useState("");

  const refresh = async () => {
    const [brandRow, campaignRows] = await Promise.all([
      fetchBrand(brandId),
      fetchScaleCampaigns(brandId),
    ]);
    setBrand(brandRow);
    setCampaigns(campaignRows);
    localStorage.setItem("factory.activeBrandId", brandId);
  };

  useEffect(() => {
    let mounted = true;
    void refresh().catch((err: unknown) => {
      if (!mounted) return;
      setError(err instanceof Error ? err.message : "Failed to load campaigns");
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  const activeCount = useMemo(
    () => campaigns.filter((campaign) => campaign.status === "active").length,
    [campaigns]
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{brand?.name || "Brand"} Campaigns</CardTitle>
          <CardDescription>
            Campaigns are scale engines promoted from validated experiments.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/brands/${brandId}/experiments`}>
              Open Experiments
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/brands/${brandId}/experiments`}>
              Promote an experiment
            </Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total Campaigns</CardDescription>
            <CardTitle>{campaigns.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Active</CardDescription>
            <CardTitle>{activeCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Completed</CardDescription>
            <CardTitle>{campaigns.filter((row) => row.status === "completed").length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      {campaigns.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {campaigns.map((campaign) => (
            <Card key={campaign.id}>
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{campaign.name}</CardTitle>
                  <Badge variant={statusVariant(campaign.status)}>{campaign.status}</Badge>
                </div>
                <CardDescription>
                  Source experiment: {campaign.sourceExperimentId.slice(-6)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  Snapshot: {campaign.snapshot.offer || "No offer"}
                </div>
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  Sent {campaign.metricsSummary.sent} · Replies {campaign.metricsSummary.replies} · Positive {campaign.metricsSummary.positiveReplies}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" asChild>
                    <Link href={`/brands/${brandId}/campaigns/${campaign.id}`}>
                      <Rocket className="h-4 w-4" /> Open Campaign
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/brands/${brandId}/experiments/${campaign.sourceExperimentId}`}>
                      View Source Experiment
                    </Link>
                  </Button>
                  <Button size="sm" variant="ghost" disabled>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-sm text-[color:var(--muted-foreground)]">
            No campaigns yet. Promote a winning experiment to create one.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
