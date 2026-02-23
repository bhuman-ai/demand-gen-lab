"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Lightbulb, Plus, RefreshCcw, Trash2 } from "lucide-react";
import {
  applyExperimentSuggestion,
  createExperimentApi,
  deleteExperimentApi,
  dismissExperimentSuggestion,
  fetchBrand,
  fetchExperiments,
  fetchExperimentSuggestions,
  generateExperimentSuggestions,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, ExperimentRecord, ExperimentSuggestionRecord } from "@/lib/factory-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function statusVariant(status: ExperimentRecord["status"]) {
  if (status === "running") return "accent" as const;
  if (status === "completed" || status === "promoted") return "success" as const;
  if (status === "paused") return "danger" as const;
  return "muted" as const;
}

function pickLine(value: string, label: string) {
  const regex = new RegExp(`^${label}:\\s*(.+)$`, "im");
  return value.match(regex)?.[1]?.trim() ?? "";
}

function suggestionDetails(suggestion: ExperimentSuggestionRecord) {
  return {
    campaignIdea: suggestion.name,
    who: suggestion.audience || pickLine(suggestion.audience, "Who"),
    trigger: suggestion.trigger || pickLine(suggestion.audience, "Trigger"),
    offer: suggestion.offer || pickLine(suggestion.offer, "Offer"),
    cta: suggestion.cta || pickLine(suggestion.offer, "CTA"),
    emailPreview: suggestion.emailPreview || pickLine(suggestion.offer, "EmailPreview"),
    successTarget: suggestion.successTarget || pickLine(suggestion.offer, "SuccessTarget"),
    rationale: suggestion.rationale || pickLine(suggestion.offer, "Why"),
  };
}

export default function ExperimentsClient({ brandId }: { brandId: string }) {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [suggestions, setSuggestions] = useState<ExperimentSuggestionRecord[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionBusyId, setSuggestionBusyId] = useState("");

  const refresh = async () => {
    const [brandRow, experimentRows, suggestionRows] = await Promise.all([
      fetchBrand(brandId),
      fetchExperiments(brandId),
      fetchExperimentSuggestions(brandId),
    ]);
    setBrand(brandRow);
    setExperiments(experimentRows);
    setSuggestions(suggestionRows);
    localStorage.setItem("factory.activeBrandId", brandId);
    return { experimentRows, suggestionRows };
  };

  useEffect(() => {
    let mounted = true;
    setError("");
    void refresh()
      .then(async ({ suggestionRows }) => {
        if (!mounted) return;
        if (suggestionRows.length) return;
        setSuggestionsLoading(true);
        try {
          const generated = await generateExperimentSuggestions(brandId);
          if (!mounted) return;
          setSuggestions(generated);
        } catch (err) {
          if (!mounted) return;
          setError(err instanceof Error ? err.message : "Failed to generate suggestions");
        } finally {
          if (mounted) setSuggestionsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load experiments");
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  const promotedCount = useMemo(
    () => experiments.filter((row) => row.status === "promoted").length,
    [experiments]
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{brand?.name || "Brand"} Experiments</CardTitle>
          <CardDescription>
            One experiment = one audience + one offer + one flow + one test envelope.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Input
            placeholder="Experiment name"
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
                const created = await createExperimentApi(brandId, {
                  name: name.trim() || `Experiment ${experiments.length + 1}`,
                });
                trackEvent("experiment_created", { brandId, experimentId: created.id });
                setName("");
                await refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to create experiment");
              } finally {
                setSaving(false);
              }
            }}
          >
            <Plus className="h-4 w-4" />
            {saving ? "Creating..." : "Create Experiment"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total Experiments</CardDescription>
            <CardTitle>{experiments.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Running</CardDescription>
            <CardTitle>{experiments.filter((row) => row.status === "running").length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Promoted</CardDescription>
            <CardTitle>{promotedCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Suggested Experiments</CardTitle>
            <CardDescription>
              Generated from your brand profile. Suggestions are saved so you can return later.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={suggestionsLoading}
            onClick={async () => {
              setSuggestionsLoading(true);
              setError("");
              try {
                const generated = await generateExperimentSuggestions(brandId, true);
                setSuggestions(generated);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to generate suggestions");
              } finally {
                setSuggestionsLoading(false);
              }
            }}
          >
            <RefreshCcw className="h-4 w-4" />
            {suggestionsLoading ? "Generating..." : "Generate Suggestions"}
          </Button>
        </CardHeader>
        <CardContent>
          {suggestionsLoading ? (
            <div className="text-sm text-[color:var(--muted-foreground)]">
              Generating suggested experiments from your brand context...
            </div>
          ) : suggestions.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {suggestions.map((suggestion) => {
                const detail = suggestionDetails(suggestion);
                return (
                <Card key={suggestion.id} className="border-[color:var(--border)] bg-[color:var(--surface-muted)]">
                  <CardHeader className="space-y-2">
                    <CardTitle className="text-sm">{detail.campaignIdea}</CardTitle>
                    <CardDescription>
                      {detail.rationale || "Concrete test idea generated from your brand context."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      <strong className="text-[color:var(--foreground)]">Who:</strong>{" "}
                      {detail.who || "Define role + company segment"}
                    </div>
                    {detail.trigger ? (
                      <div className="text-xs text-[color:var(--muted-foreground)]">
                        <strong className="text-[color:var(--foreground)]">Trigger:</strong> {detail.trigger}
                      </div>
                    ) : null}
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      <strong className="text-[color:var(--foreground)]">Offer:</strong>{" "}
                      {detail.offer || "Define concrete offer"}
                    </div>
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      <strong className="text-[color:var(--foreground)]">CTA:</strong>{" "}
                      {detail.cta || "Define one clear ask"}
                    </div>
                    {detail.emailPreview ? (
                      <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-1 text-xs text-[color:var(--muted-foreground)]">
                        <strong className="text-[color:var(--foreground)]">Email #1 Preview:</strong>{" "}
                        {detail.emailPreview}
                      </div>
                    ) : null}
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      <strong className="text-[color:var(--foreground)]">Success target:</strong>{" "}
                      {detail.successTarget || ">=8 positive replies from first 150 sends"}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        disabled={Boolean(suggestionBusyId)}
                        onClick={async () => {
                          setSuggestionBusyId(suggestion.id);
                          setError("");
                          try {
                            const experiment = await applyExperimentSuggestion(brandId, suggestion.id);
                            trackEvent("experiment_created", {
                              brandId,
                              experimentId: experiment.id,
                              source: "suggestion",
                            });
                            await refresh();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Failed to create experiment");
                          } finally {
                            setSuggestionBusyId("");
                          }
                        }}
                      >
                        {suggestionBusyId === suggestion.id ? "Creating..." : "Create From Suggestion"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={Boolean(suggestionBusyId)}
                        onClick={async () => {
                          setSuggestionBusyId(suggestion.id);
                          setError("");
                          try {
                            await dismissExperimentSuggestion(brandId, suggestion.id);
                            await refresh();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Failed to dismiss suggestion");
                          } finally {
                            setSuggestionBusyId("");
                          }
                        }}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
              <Lightbulb className="h-4 w-4" />
              Generating starter experiments for this brand...
            </div>
          )}
        </CardContent>
      </Card>

      {experiments.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {experiments.map((experiment) => (
            <Card key={experiment.id}>
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{experiment.name}</CardTitle>
                  <Badge variant={statusVariant(experiment.status)}>{experiment.status}</Badge>
                </div>
                <CardDescription>
                  {experiment.offer || "No offer yet"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  Audience: {experiment.audience || "Not set"}
                </div>
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  Sent {experiment.metricsSummary.sent} · Replies {experiment.metricsSummary.replies} · Positive {experiment.metricsSummary.positiveReplies}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" asChild>
                    <Link href={`/brands/${brandId}/experiments/${experiment.id}`}>Open Experiment</Link>
                  </Button>
                  {experiment.promotedCampaignId ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/brands/${brandId}/campaigns/${experiment.promotedCampaignId}`}>Open Campaign</Link>
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!window.confirm("Delete this experiment?")) return;
                      await deleteExperimentApi(brandId, experiment.id);
                      await refresh();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-10 text-sm text-[color:var(--muted-foreground)]">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4" />
              No experiments launched yet. Start from a suggestion above or create one manually.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
