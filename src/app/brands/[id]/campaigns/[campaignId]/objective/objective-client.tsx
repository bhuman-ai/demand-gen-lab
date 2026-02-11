"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchBrand, fetchCampaign, updateCampaignApi, completeStepState } from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, CampaignRecord, ObjectiveData } from "@/lib/factory-types";

export default function ObjectiveClient({ brandId, campaignId }: { brandId: string; campaignId: string }) {
  const router = useRouter();
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [objective, setObjective] = useState<ObjectiveData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    void Promise.all([fetchBrand(brandId), fetchCampaign(brandId, campaignId)])
      .then(([brandRow, campaignRow]) => {
        if (!mounted) return;
        setBrand(brandRow);
        setCampaign(campaignRow);
        setObjective(campaignRow.objective);
        localStorage.setItem("factory.activeBrandId", brandId);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load objective");
      });
    return () => {
      mounted = false;
    };
  }, [brandId, campaignId]);

  useEffect(() => {
    trackEvent("campaign_step_viewed", { brandId, campaignId, step: "objective" });
  }, [brandId, campaignId]);

  if (!objective || !campaign) {
    return <div className="text-sm text-[color:var(--muted-foreground)]">Loading objective...</div>;
  }

  const save = async (markComplete: boolean) => {
    setSaving(true);
    setError("");
    try {
      const next = await updateCampaignApi(brandId, campaignId, {
        objective,
        stepState: markComplete ? completeStepState("objective", campaign.stepState) : campaign.stepState,
      });
      setCampaign(next);
      trackEvent("campaign_saved", { brandId, campaignId, step: "objective" });
      if (markComplete) {
        trackEvent("campaign_step_completed", { brandId, campaignId, step: "objective" });
        router.push(`/brands/${brandId}/campaigns/${campaignId}/hypotheses`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{brand?.name} · {campaign.name}</CardTitle>
          <CardDescription>Step 1 of 4: define the campaign objective and scoring weights.</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Objective Setup</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="objective-goal">Goal</Label>
            <Textarea
              id="objective-goal"
              value={objective.goal}
              onChange={(event) => setObjective({ ...objective, goal: event.target.value })}
              placeholder="What conversion outcome should this campaign drive?"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="objective-constraints">Constraints</Label>
            <Textarea
              id="objective-constraints"
              value={objective.constraints}
              onChange={(event) => setObjective({ ...objective, constraints: event.target.value })}
              placeholder="Volume caps, targeting constraints, message constraints"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="objective-conversion-weight">Conversion Weight</Label>
              <Input
                id="objective-conversion-weight"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={objective.scoring.conversionWeight}
                onChange={(event) =>
                  setObjective({
                    ...objective,
                    scoring: { ...objective.scoring, conversionWeight: Number(event.target.value || 0) },
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="objective-quality-weight">Quality Weight</Label>
              <Input
                id="objective-quality-weight"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={objective.scoring.qualityWeight}
                onChange={(event) =>
                  setObjective({
                    ...objective,
                    scoring: { ...objective.scoring, qualityWeight: Number(event.target.value || 0) },
                  })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="objective-reply-weight">Reply Weight</Label>
              <Input
                id="objective-reply-weight"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={objective.scoring.replyWeight}
                onChange={(event) =>
                  setObjective({
                    ...objective,
                    scoring: { ...objective.scoring, replyWeight: Number(event.target.value || 0) },
                  })
                }
              />
            </div>
          </div>

          {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => save(false)} disabled={saving}>
              {saving ? "Saving..." : "Save Objective"}
            </Button>
            <Button type="button" variant="outline" onClick={() => save(true)} disabled={saving}>
              Save & Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button asChild type="button" variant="ghost">
              <Link href={`/brands/${brandId}/campaigns/${campaignId}/hypotheses`}>Skip to Hypotheses</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
