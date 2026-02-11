"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  createCampaignApi,
  deleteCampaignApi,
  fetchCampaigns,
  fetchBrand,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, CampaignRecord } from "@/lib/factory-types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

function nextStep(campaign: CampaignRecord) {
  if (!campaign.stepState.objectiveCompleted) return "objective";
  if (!campaign.stepState.hypothesesCompleted) return "hypotheses";
  if (!campaign.stepState.experimentsCompleted) return "experiments";
  return "evolution";
}

export default function CampaignsClient({ brandId }: { brandId: string }) {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    void Promise.all([fetchBrand(brandId), fetchCampaigns(brandId)])
      .then(([brandRow, campaignRows]) => {
        if (!mounted) return;
        setBrand(brandRow);
        setCampaigns(campaignRows);
        localStorage.setItem("factory.activeBrandId", brandId);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load campaigns");
      });
    return () => {
      mounted = false;
    };
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
          <CardDescription>Create and manage campaigns, then execute step-by-step.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Input
            placeholder="Campaign name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                const created = await createCampaignApi(brandId, {
                  name: name.trim() || `Campaign ${campaigns.length + 1}`,
                });
                trackEvent("campaign_created", { brandId, campaignId: created.id });
                setName("");
                const refreshed = await fetchCampaigns(brandId);
                setCampaigns(refreshed);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Create failed");
              } finally {
                setSaving(false);
              }
            }}
          >
            <Plus className="h-4 w-4" />
            {saving ? "Creating..." : "Create Campaign"}
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
            <CardDescription>Draft</CardDescription>
            <CardTitle>{campaigns.length - activeCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {campaigns.map((campaign) => {
          const step = nextStep(campaign);
          return (
            <Card key={campaign.id}>
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{campaign.name}</CardTitle>
                  <Badge variant={campaign.status === "active" ? "success" : "muted"}>{campaign.status}</Badge>
                </div>
                <CardDescription>Continue at step: {step}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button size="sm" asChild>
                  <Link href={`/brands/${brandId}/campaigns/${campaign.id}/${step}`}>Open</Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/brands/${brandId}/campaigns/${campaign.id}/objective`}>Objective</Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!window.confirm("Delete this campaign?")) return;
                    await deleteCampaignApi(brandId, campaign.id);
                    const refreshed = await fetchCampaigns(brandId);
                    setCampaigns(refreshed);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!campaigns.length ? (
        <Card>
          <CardContent className="py-8 text-sm text-[color:var(--muted-foreground)]">
            No campaigns yet. Create one and start with Objective.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
