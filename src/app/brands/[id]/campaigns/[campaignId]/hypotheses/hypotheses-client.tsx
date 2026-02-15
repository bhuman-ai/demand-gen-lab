"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  completeStepState,
  fetchBrand,
  fetchCampaign,
  suggestHypothesesApi,
  updateCampaignApi,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, CampaignRecord, Hypothesis } from "@/lib/factory-types";

const makeId = () => `hyp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

type HypothesisSuggestion = {
  title: string;
  channel: "Email";
  rationale: string;
  leadTarget: string;
  maxLeads: number;
  seedInputs: string[];
};

export default function HypothesesClient({ brandId, campaignId }: { brandId: string; campaignId: string }) {
  const router = useRouter();
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [suggestions, setSuggestions] = useState<HypothesisSuggestion[]>([]);
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
        setHypotheses(campaignRow.hypotheses);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load hypotheses");
      });
    return () => {
      mounted = false;
    };
  }, [brandId, campaignId]);

  useEffect(() => {
    trackEvent("campaign_step_viewed", { brandId, campaignId, step: "hypotheses" });
  }, [brandId, campaignId]);

  const loadSuggestions = async () => {
    setSuggestionsLoading(true);
    setSuggestionsError("");
    try {
      const rows = await suggestHypothesesApi(brandId, campaignId);
      setSuggestions(rows);
    } catch (err) {
      setSuggestionsError(err instanceof Error ? err.message : "Failed to load suggestions");
    } finally {
      setSuggestionsLoading(false);
      setSuggestionsLoadedOnce(true);
    }
  };

  useEffect(() => {
    if (!campaign) return;
    if (suggestionsLoadedOnce) return;
    void loadSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, suggestionsLoadedOnce, brandId, campaignId]);

  if (!campaign) {
    return <div className="text-sm text-[color:var(--muted-foreground)]">Loading hypotheses...</div>;
  }

  const save = async (completeStep: boolean) => {
    setSaving(true);
    setError("");
    try {
      const next = await updateCampaignApi(brandId, campaignId, {
        hypotheses,
        stepState: completeStep ? completeStepState("hypotheses", campaign.stepState) : campaign.stepState,
      });
      setCampaign(next);
      trackEvent("campaign_saved", { brandId, campaignId, step: "hypotheses" });
      if (completeStep) {
        trackEvent("campaign_step_completed", { brandId, campaignId, step: "hypotheses" });
        router.push(`/brands/${brandId}/campaigns/${campaignId}/experiments`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addFromSuggestion = (suggestion: HypothesisSuggestion) => {
    setHypotheses((prev) => [
      {
        id: makeId(),
        title: suggestion.title,
        channel: suggestion.channel ?? "Email",
        rationale: suggestion.rationale,
        actorQuery: suggestion.leadTarget ?? "",
        sourceConfig: {
          actorId: "",
          actorInput: {},
          maxLeads: Number.isFinite(suggestion.maxLeads) ? suggestion.maxLeads : 100,
        },
        seedInputs: Array.isArray(suggestion.seedInputs) ? suggestion.seedInputs : [],
        status: "draft",
      },
      ...prev,
    ]);
  };

  const applyAllSuggestions = () => {
    setHypotheses(
      suggestions.map((suggestion) => ({
        id: makeId(),
        title: suggestion.title,
        channel: suggestion.channel ?? "Email",
        rationale: suggestion.rationale,
        actorQuery: suggestion.leadTarget ?? "",
        sourceConfig: {
          actorId: "",
          actorInput: {},
          maxLeads: Number.isFinite(suggestion.maxLeads) ? suggestion.maxLeads : 100,
        },
        seedInputs: Array.isArray(suggestion.seedInputs) ? suggestion.seedInputs : [],
        status: "draft" as const,
      }))
    );
  };

  const addManual = (input?: Partial<Pick<Hypothesis, "title" | "channel" | "rationale">>) => {
    setHypotheses((prev) => [
      {
        id: makeId(),
        title: input?.title ?? "New hypothesis",
        channel: input?.channel ?? "Email",
        rationale: input?.rationale ?? "",
        actorQuery: "",
        sourceConfig: {
          actorId: "",
          actorInput: {},
          maxLeads: 100,
        },
        seedInputs: [],
        status: "draft",
      },
      ...prev,
    ]);
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{brand?.name} · {campaign.name}</CardTitle>
          <CardDescription>Step 2 of 4: generate and approve hypotheses.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={loadSuggestions} disabled={suggestionsLoading}>
            <Sparkles className="h-4 w-4" />
            {suggestionsLoading ? "Generating..." : "Generate Hypotheses"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => addManual()}
          >
            <Plus className="h-4 w-4" />
            Add Manual
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Suggestions</CardTitle>
          <CardDescription>
            Click a card to add it as a draft hypothesis. These are tailored to your brand and objective.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={loadSuggestions} disabled={suggestionsLoading}>
              <Sparkles className="h-4 w-4" />
              {suggestionsLoading ? "Generating..." : suggestions.length ? "Refresh Suggestions" : "Generate Suggestions"}
            </Button>
            {suggestions.length ? (
              <Button type="button" size="sm" variant="outline" onClick={applyAllSuggestions} disabled={suggestionsLoading}>
                Use All (Replace List)
              </Button>
            ) : null}
          </div>

          {suggestionsError ? (
            <div className="text-xs text-[color:var(--danger)]">{suggestionsError}</div>
          ) : null}

          {suggestionsLoading && !suggestions.length ? (
            <div className="text-xs text-[color:var(--muted-foreground)]">Generating hypothesis cards...</div>
          ) : null}

          {suggestions.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.title}
                  type="button"
                  className="group rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-left transition hover:bg-[color:var(--surface)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                  onClick={() => addFromSuggestion(suggestion)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold">{suggestion.title}</div>
                    <Badge variant="muted">{suggestion.channel}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{suggestion.rationale}</div>
                  <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                    Target: {suggestion.leadTarget || "Choose an ICP"} · Leads: {suggestion.maxLeads ?? 100}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <div className="grid gap-4">
        {hypotheses.map((hypothesis, index) => (
          <Card key={hypothesis.id}>
            <CardHeader className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Hypothesis {index + 1}</CardTitle>
                <Badge variant={hypothesis.status === "approved" ? "success" : "muted"}>{hypothesis.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor={`hypothesis-title-${index}`}>Title</Label>
                <Input
                  id={`hypothesis-title-${index}`}
                  value={hypothesis.title}
                  onChange={(event) => {
                    const next = [...hypotheses];
                    next[index] = { ...next[index], title: event.target.value };
                    setHypotheses(next);
                  }}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor={`hypothesis-rationale-${index}`}>Rationale</Label>
                  <Textarea
                    id={`hypothesis-rationale-${index}`}
                    value={hypothesis.rationale}
                    onChange={(event) => {
                      const next = [...hypotheses];
                      next[index] = { ...next[index], rationale: event.target.value };
                      setHypotheses(next);
                    }}
                    />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`hypothesis-channel-${index}`}>Channel</Label>
                  <Input
                    id={`hypothesis-channel-${index}`}
                    value={hypothesis.channel}
                    onChange={(event) => {
                      const next = [...hypotheses];
                      next[index] = { ...next[index], channel: event.target.value };
                      setHypotheses(next);
                    }}
                  />
                  <Label htmlFor={`hypothesis-status-${index}`}>Status</Label>
                  <Select
                    id={`hypothesis-status-${index}`}
                    value={hypothesis.status}
                    onChange={(event) => {
                      const next = [...hypotheses];
                      next[index] = {
                        ...next[index],
                        status: event.target.value === "approved" ? "approved" : "draft",
                      };
                      setHypotheses(next);
                    }}
                  >
                    <option value="draft">Draft</option>
                    <option value="approved">Approved</option>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`hypothesis-target-${index}`}>Target Audience</Label>
                <Textarea
                  id={`hypothesis-target-${index}`}
                  value={hypothesis.actorQuery}
                  onChange={(event) => {
                    const next = [...hypotheses];
                    next[index] = { ...next[index], actorQuery: event.target.value };
                    setHypotheses(next);
                  }}
                  placeholder="Who should we reach? Example: VP Marketing at SaaS (20-200 employees) using HubSpot"
                />
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  This is used to source leads for outreach when you approve and run this hypothesis.
                </div>
              </div>
              <div className="grid gap-2 md:max-w-[260px]">
                <Label htmlFor={`hypothesis-max-leads-${index}`}>Max Leads</Label>
                <Input
                  id={`hypothesis-max-leads-${index}`}
                  type="number"
                  min={1}
                  max={500}
                  value={hypothesis.sourceConfig?.maxLeads ?? 100}
                  onChange={(event) => {
                    const next = [...hypotheses];
                    next[index] = {
                      ...next[index],
                      sourceConfig: {
                        actorId: next[index].sourceConfig?.actorId ?? "",
                        actorInput: next[index].sourceConfig?.actorInput ?? {},
                        maxLeads: Number(event.target.value || 100),
                      },
                    };
                    setHypotheses(next);
                  }}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setHypotheses((prev) => prev.filter((item) => item.id !== hypothesis.id))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {!hypotheses.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Start Here</CardTitle>
              <CardDescription>
                Generate tailored hypothesis cards, then click one to add it to your list. You can edit everything.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {!campaign.objective.goal.trim() ? (
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-sm">
                  Objective goal is empty. Hypothesis generation works best after you define a clear goal.
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/brands/${brandId}/campaigns/${campaignId}/objective`}>Go to Objective</Link>
                    </Button>
                    <Button size="sm" variant="secondary" type="button" onClick={loadSuggestions} disabled={suggestionsLoading}>
                      <Sparkles className="h-4 w-4" />
                      {suggestionsLoading ? "Generating..." : "Generate Anyway"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" type="button" onClick={loadSuggestions} disabled={suggestionsLoading}>
                    <Sparkles className="h-4 w-4" />
                    {suggestionsLoading ? "Generating..." : "Generate From Objective"}
                  </Button>
                  <Button size="sm" variant="outline" type="button" onClick={() => addManual()}>
                    <Plus className="h-4 w-4" />
                    Add Manual
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Button type="button" onClick={() => save(false)} disabled={saving}>
            {saving ? "Saving..." : "Save Hypotheses"}
          </Button>
          <Button type="button" variant="outline" onClick={() => save(true)} disabled={saving || !hypotheses.length}>
            Save & Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button asChild variant="ghost">
            <Link href={`/brands/${brandId}/campaigns/${campaignId}/experiments`}>Skip to Experiments</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
