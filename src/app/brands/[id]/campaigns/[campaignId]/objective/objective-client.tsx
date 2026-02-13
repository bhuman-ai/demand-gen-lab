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

type ObjectiveTemplate = {
  label: string;
  goal: string;
  constraints: string;
  scoring?: ObjectiveData["scoring"];
};

function normalizeWeights(scoring: ObjectiveData["scoring"]): ObjectiveData["scoring"] {
  const conversionWeight = Number(scoring.conversionWeight ?? 0);
  const qualityWeight = Number(scoring.qualityWeight ?? 0);
  const replyWeight = Number(scoring.replyWeight ?? 0);
  const sum = conversionWeight + qualityWeight + replyWeight;
  if (!sum) {
    return { conversionWeight: 0.6, qualityWeight: 0.2, replyWeight: 0.2 };
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    conversionWeight: round(conversionWeight / sum),
    qualityWeight: round(qualityWeight / sum),
    replyWeight: round(replyWeight / sum),
  };
}

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

  const brandName = brand?.name?.trim() || "your brand";
  const templates: ObjectiveTemplate[] = [
    {
      label: "Book Demos",
      goal: `Book 10 qualified demos in 14 days with ${brandName}'s ideal buyers.`,
      constraints:
        "Email only. Keep copy under 90 words. Target a single ICP (role + company type). Start conservative: 30 sends/day per mailbox, 6/hour, 8+ minutes between touches. Unsubscribe always on.",
      scoring: { conversionWeight: 0.7, qualityWeight: 0.2, replyWeight: 0.1 },
    },
    {
      label: "Validate Offer",
      goal: `Validate that ${brandName} has a compelling offer by earning 20 replies and 3 intro calls in 10 days.`,
      constraints:
        "Email only. Keep one offer per message. Include a simple CTA (one question). Target 1-2 verticals max. Start conservative with caps; pause on complaints or bounces.",
      scoring: { conversionWeight: 0.55, qualityWeight: 0.25, replyWeight: 0.2 },
    },
    {
      label: "Max Replies",
      goal: `Generate 25 positive replies from a single ICP in 7 days (as fast feedback for ${brandName}).`,
      constraints:
        "Email only. Short messages (50-80 words). Personalize first line. Avoid links on touch 1. Conservative sending caps. Stop sequence after any reply.",
      scoring: { conversionWeight: 0.4, qualityWeight: 0.2, replyWeight: 0.4 },
    },
  ];

  const goalSuggestions: Array<{ label: string; text: string }> = [
    {
      label: "Book demos",
      text: `Book 10 qualified demos in 14 days with ${brandName}'s ideal buyers.`,
    },
    {
      label: "Positive replies",
      text: `Generate 20 positive replies from a single ICP in 7 days for ${brandName}.`,
    },
    {
      label: "Validate PMF",
      text: "Validate product-market fit by securing 3 intro calls and 15 replies in 10 days.",
    },
  ];

  const constraintSuggestions: Array<{ label: string; text: string }> = [
    {
      label: "Conservative sending",
      text: "Email only. Cap: 30 sends/day per mailbox, 6 sends/hour, 8+ minutes spacing. Unsubscribe always on.",
    },
    {
      label: "Tight targeting",
      text: "Targeting: 1 ICP (role + company size + industry). Exclude existing customers, unsubscribes, and previous bounces.",
    },
    {
      label: "Message rules",
      text: "Messaging: 50-90 words. One offer per email. One clear CTA. Stop after any reply.",
    },
  ];

  const scoringPresets: Array<{ label: string; scoring: ObjectiveData["scoring"] }> = [
    { label: "Pipeline", scoring: { conversionWeight: 0.7, qualityWeight: 0.2, replyWeight: 0.1 } },
    { label: "Balanced", scoring: { conversionWeight: 0.6, qualityWeight: 0.2, replyWeight: 0.2 } },
    { label: "Replies", scoring: { conversionWeight: 0.4, qualityWeight: 0.2, replyWeight: 0.4 } },
  ];

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
          {!objective.goal.trim() || !objective.constraints.trim() ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="text-sm font-semibold">Suggestions</div>
              <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                Pick a template or one-click fill pieces. You can edit everything.
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <div className="text-xs font-semibold text-[color:var(--muted-foreground)]">Templates</div>
                  <div className="flex flex-wrap gap-2">
                    {templates.map((template) => (
                      <Button
                        key={template.label}
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setObjective({
                            ...objective,
                            goal: template.goal,
                            constraints: template.constraints,
                            scoring: template.scoring ?? objective.scoring,
                          })
                        }
                      >
                        {template.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2">
                  <div className="text-xs font-semibold text-[color:var(--muted-foreground)]">Scoring Presets</div>
                  <div className="flex flex-wrap gap-2">
                    {scoringPresets.map((preset) => (
                      <Button
                        key={preset.label}
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setObjective({ ...objective, scoring: preset.scoring })}
                      >
                        {preset.label}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setObjective({ ...objective, scoring: normalizeWeights(objective.scoring) })}
                    >
                      Normalize
                    </Button>
                  </div>
                </div>
              </div>

              {!objective.goal.trim() ? (
                <div className="mt-3 grid gap-2">
                  <div className="text-xs font-semibold text-[color:var(--muted-foreground)]">Goal Starters</div>
                  <div className="flex flex-wrap gap-2">
                    {goalSuggestions.map((item) => (
                      <Button
                        key={item.label}
                        type="button"
                        size="sm"
                        variant="outline"
                        title={item.text}
                        onClick={() => setObjective({ ...objective, goal: item.text })}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}

              {!objective.constraints.trim() ? (
                <div className="mt-3 grid gap-2">
                  <div className="text-xs font-semibold text-[color:var(--muted-foreground)]">Constraint Starters</div>
                  <div className="flex flex-wrap gap-2">
                    {constraintSuggestions.map((item) => (
                      <Button
                        key={item.label}
                        type="button"
                        size="sm"
                        variant="outline"
                        title={item.text}
                        onClick={() => setObjective({ ...objective, constraints: item.text })}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

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
