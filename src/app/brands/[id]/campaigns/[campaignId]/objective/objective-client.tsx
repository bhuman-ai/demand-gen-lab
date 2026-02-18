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
import {
  fetchBrand,
  fetchCampaign,
  updateCampaignApi,
  completeStepState,
  suggestObjectiveApi,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, CampaignRecord, ObjectiveData } from "@/lib/factory-types";

type ObjectiveSuggestion = {
  title: string;
  goal: string;
  constraints: string;
  scoring: ObjectiveData["scoring"];
  rationale: string;
};

export default function ObjectiveClient({ brandId, campaignId }: { brandId: string; campaignId: string }) {
  const router = useRouter();
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [objective, setObjective] = useState<ObjectiveData | null>(null);
  const [suggestions, setSuggestions] = useState<ObjectiveSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsLoadedOnce, setSuggestionsLoadedOnce] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState("");
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

  const loadSuggestions = async () => {
    setSuggestionsLoading(true);
    setSuggestionsError("");
    try {
      const rows = await suggestObjectiveApi(brandId, campaignId);
      setSuggestions(rows);
    } catch (err) {
      setSuggestionsError(err instanceof Error ? err.message : "Failed to load suggestions");
    } finally {
      setSuggestionsLoading(false);
      setSuggestionsLoadedOnce(true);
    }
  };

  useEffect(() => {
    if (!objective || !campaign) return;
    if (suggestionsLoadedOnce) return;
    void loadSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objective, campaign, suggestionsLoadedOnce, brandId, campaignId]);

  if (!objective || !campaign) {
    if (error) {
      return (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Could not load objective</CardTitle>
              <CardDescription className="text-[color:var(--danger)]">{error}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => window.location.reload()}>
                Reload
              </Button>
              <Button asChild type="button" variant="outline">
                <Link href={`/brands/${brandId}/campaigns`}>Back to Campaigns</Link>
              </Button>
              <Button asChild type="button" variant="ghost">
                <Link href={`/brands/${brandId}`}>Back to Brand Home</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    return <div className="text-sm text-[color:var(--muted-foreground)]">Loading objective...</div>;
  }

  const brandName = brand?.name?.trim() || "your brand";

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
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">AI Suggestions</div>
                <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                  Click a card to fill your objective. You can edit everything below.
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={loadSuggestions}
                disabled={suggestionsLoading}
              >
                {suggestionsLoading ? "Generating..." : suggestions.length ? "Refresh AI" : "Generate AI"}
              </Button>
            </div>

            {suggestionsError ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="text-xs text-[color:var(--danger)]">{suggestionsError}</div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={loadSuggestions}
                  disabled={suggestionsLoading}
                >
                  Retry
                </Button>
              </div>
            ) : null}

            {suggestionsLoading && !suggestions.length ? (
              <div className="mt-3 text-xs text-[color:var(--muted-foreground)]">
                Generating tailored options for {brandName}...
              </div>
            ) : null}

            {!suggestionsLoading && !suggestionsError && !suggestions.length ? (
              <div className="mt-3 text-xs text-[color:var(--muted-foreground)]">
                No suggestions yet. Click Generate AI to load premade objective cards.
              </div>
            ) : null}

            {suggestions.length ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {suggestions.map((item) => (
                  <button
                    key={item.title}
                    type="button"
                    className="group rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-left shadow-sm transition hover:-translate-y-[1px] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                    onClick={() =>
                      setObjective({
                        ...objective,
                        goal: item.goal,
                        constraints: item.constraints,
                        scoring: item.scoring ?? objective.scoring,
                      })
                    }
                  >
                    <div className="text-sm font-semibold">{item.title}</div>
                    {item.rationale ? (
                      <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                        {item.rationale}
                      </div>
                    ) : null}
                    <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                      <span className="font-semibold text-[color:var(--foreground)]">Goal:</span>{" "}
                      {item.goal}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

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
