"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Trophy, Plus, Check } from "lucide-react";
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
  fetchCampaignRuns,
  suggestEvolutionApi,
  summarizeWinners,
  updateCampaignApi,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, CampaignRecord, EvolutionSnapshot, OutreachRun } from "@/lib/factory-types";

const makeId = () => `evo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

type EvolutionSuggestion = {
  title: string;
  summary: string;
  status: "observing" | "winner" | "killed";
};

export default function EvolutionClient({ brandId, campaignId }: { brandId: string; campaignId: string }) {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [runs, setRuns] = useState<OutreachRun[]>([]);
  const [rows, setRows] = useState<EvolutionSnapshot[]>([]);
  const [suggestions, setSuggestions] = useState<EvolutionSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsLoadedOnce, setSuggestionsLoadedOnce] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    void Promise.all([fetchBrand(brandId), fetchCampaign(brandId, campaignId), fetchCampaignRuns(brandId, campaignId)])
      .then(([brandRow, campaignRow, runRows]) => {
        if (!mounted) return;
        setBrand(brandRow);
        setCampaign(campaignRow);
        setRows(campaignRow.evolution);
        setRuns(runRows.runs);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load evolution");
      });
    return () => {
      mounted = false;
    };
  }, [brandId, campaignId]);

  useEffect(() => {
    trackEvent("campaign_step_viewed", { brandId, campaignId, step: "evolution" });
  }, [brandId, campaignId]);

  const winners = useMemo(() => summarizeWinners(rows), [rows]);

  const loadSuggestions = async () => {
    setSuggestionsLoading(true);
    setSuggestionsError("");
    try {
      const suggested = await suggestEvolutionApi(brandId, campaignId);
      setSuggestions(suggested);
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
    return <div className="text-sm text-[color:var(--muted-foreground)]">Loading evolution...</div>;
  }

  const save = async (completeStep: boolean) => {
    setSaving(true);
    setError("");
    try {
      const next = await updateCampaignApi(brandId, campaignId, {
        evolution: rows,
        stepState: completeStep ? completeStepState("evolution", campaign.stepState) : campaign.stepState,
        status: winners > 0 ? "active" : campaign.status,
      });
      setCampaign(next);
      trackEvent("campaign_saved", { brandId, campaignId, step: "evolution" });
      if (completeStep) {
        trackEvent("campaign_step_completed", { brandId, campaignId, step: "evolution" });
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
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>{brand?.name} · {campaign.name}</CardTitle>
            <CardDescription>Step 4 of 4: capture outcomes and promote winners.</CardDescription>
          </div>
          <Badge variant={winners > 0 ? "success" : "muted"}>
            <Trophy className="mr-1 h-3.5 w-3.5" />
            Winners: {winners}
          </Badge>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setRows((prev) => [
                {
                  id: makeId(),
                  title: "Evolution snapshot",
                  summary: "",
                  status: "observing",
                },
                ...prev,
              ])
            }
          >
            <Plus className="h-4 w-4" />
            Add Snapshot
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Suggestions</CardTitle>
          <CardDescription>
            Click a card to add it as an evolution snapshot. Suggestions use your campaign context and run outcomes.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={loadSuggestions} disabled={suggestionsLoading}>
              <Plus className="h-4 w-4" />
              {suggestionsLoading ? "Generating..." : suggestions.length ? "Refresh Suggestions" : "Generate Suggestions"}
            </Button>
          </div>
          {suggestionsError ? <div className="text-xs text-[color:var(--danger)]">{suggestionsError}</div> : null}
          {suggestionsLoading && !suggestions.length ? (
            <div className="text-xs text-[color:var(--muted-foreground)]">Generating snapshot cards...</div>
          ) : null}
          {suggestions.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.title}
                  type="button"
                  className="group rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-left transition hover:bg-[color:var(--surface)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                  onClick={() =>
                    setRows((prev) => [
                      {
                        id: makeId(),
                        title: suggestion.title,
                        summary: suggestion.summary,
                        status: suggestion.status,
                      },
                      ...prev,
                    ])
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold">{suggestion.title}</div>
                    <Badge variant={suggestion.status === "winner" ? "success" : suggestion.status === "killed" ? "danger" : "muted"}>
                      {suggestion.status}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{suggestion.summary}</div>
                </button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <div className="grid gap-4">
        {rows.map((row, index) => (
          <Card key={row.id}>
            <CardHeader>
              <CardTitle className="text-base">Snapshot {index + 1}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor={`evolution-title-${index}`}>Title</Label>
                <Input
                  id={`evolution-title-${index}`}
                  value={row.title}
                  onChange={(event) => {
                    const next = [...rows];
                    next[index] = { ...next[index], title: event.target.value };
                    setRows(next);
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`evolution-status-${index}`}>Status</Label>
                <Select
                  id={`evolution-status-${index}`}
                  value={row.status}
                  onChange={(event) => {
                    const next = [...rows];
                    next[index] = {
                      ...next[index],
                      status: ["observing", "winner", "killed"].includes(event.target.value)
                        ? (event.target.value as EvolutionSnapshot["status"])
                        : "observing",
                    };
                    setRows(next);
                  }}
                >
                  <option value="observing">Observing</option>
                  <option value="winner">Winner</option>
                  <option value="killed">Killed</option>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`evolution-summary-${index}`}>Summary</Label>
                <Textarea
                  id={`evolution-summary-${index}`}
                  value={row.summary}
                  onChange={(event) => {
                    const next = [...rows];
                    next[index] = { ...next[index], summary: event.target.value };
                    setRows(next);
                  }}
                />
              </div>
            </CardContent>
          </Card>
        ))}

        {!rows.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Start Here</CardTitle>
              <CardDescription>
                Capture what worked, what failed, and what to do next. Add one snapshot per learning cycle.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setRows((prev) => [
                      {
                        id: makeId(),
                        title: "Week 1 learnings",
                        summary: "What did we learn? What should we change next week?",
                        status: "observing",
                      },
                      ...prev,
                    ])
                  }
                >
                  <Plus className="h-4 w-4" />
                  Add First Snapshot
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/brands/${brandId}/campaigns/${campaignId}/experiments`}>Go to Experiments</Link>
                </Button>
              </div>
              <div className="text-xs text-[color:var(--muted-foreground)]">
                Tip: promote winners only after consistent positive replies and low anomaly rates.
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Autopilot Outcomes</CardTitle>
          <CardDescription>Run-level metrics feed winner and kill decisions.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
                <th className="pb-2">Run</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Leads</th>
                <th className="pb-2">Sent</th>
                <th className="pb-2">Replies</th>
                <th className="pb-2">Positive</th>
                <th className="pb-2">Negative</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-[color:var(--border)]">
                  <td className="py-2">{run.id.slice(-6)}</td>
                  <td className="py-2">{run.status}</td>
                  <td className="py-2">{run.metrics.sourcedLeads}</td>
                  <td className="py-2">{run.metrics.sentMessages}</td>
                  <td className="py-2">{run.metrics.replies}</td>
                  <td className="py-2">{run.metrics.positiveReplies}</td>
                  <td className="py-2">{run.metrics.negativeReplies}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!runs.length ? (
            <div className="py-4 text-sm text-[color:var(--muted-foreground)]">
              No autopilot runs yet. Launch runs from experiments.
              <div className="mt-2">
                <Button asChild size="sm" variant="outline">
                  <Link href={`/brands/${brandId}/campaigns/${campaignId}/experiments`}>Launch a Run</Link>
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Button type="button" onClick={() => save(false)} disabled={saving}>
            {saving ? "Saving..." : "Save Evolution"}
          </Button>
          <Button type="button" variant="outline" onClick={() => save(true)} disabled={saving}>
            <Check className="h-4 w-4" />
            Mark Step Complete
          </Button>
          <Button asChild variant="ghost">
            <Link href={`/brands/${brandId}/campaigns`}>Back to Campaigns</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
