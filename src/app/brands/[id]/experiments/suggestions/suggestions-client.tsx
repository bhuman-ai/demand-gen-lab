"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Lightbulb, RefreshCcw } from "lucide-react";
import {
  applyExperimentSuggestion,
  dismissExperimentSuggestion,
  fetchBrand,
  fetchExperimentSuggestions,
  generateExperimentSuggestions,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, ExperimentSuggestionRecord } from "@/lib/factory-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

function isRenderableSuggestion(suggestion: ExperimentSuggestionRecord) {
  const detail = suggestionDetails(suggestion);
  return Boolean(
    detail.campaignIdea &&
      detail.who &&
      detail.offer &&
      detail.cta &&
      detail.emailPreview &&
      detail.successTarget &&
      detail.rationale
  );
}

export default function SuggestionsClient({ brandId }: { brandId: string }) {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [suggestions, setSuggestions] = useState<ExperimentSuggestionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    const [brandRow, suggestionRows] = await Promise.all([
      fetchBrand(brandId),
      fetchExperimentSuggestions(brandId),
    ]);
    setBrand(brandRow);
    setSuggestions(suggestionRows);
    localStorage.setItem("factory.activeBrandId", brandId);
    return suggestionRows;
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    void refresh()
      .then(async (rows) => {
        if (!mounted) return;
        if (rows.length) return;
        setGenerating(true);
        try {
          const generated = await generateExperimentSuggestions(brandId);
          if (!mounted) return;
          setSuggestions(generated);
        } catch (err) {
          if (!mounted) return;
          setError(err instanceof Error ? err.message : "Failed to generate suggestions");
        } finally {
          if (mounted) setGenerating(false);
        }
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load suggestions");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  const renderableSuggestions = useMemo(
    () => suggestions.filter((row) => isRenderableSuggestion(row)),
    [suggestions]
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>{brand?.name || "Brand"} Suggestions</CardTitle>
            <CardDescription>
              AI-generated experiment ideas from brand profile context. Create an experiment from any suggestion.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/brands/${brandId}/experiments`}>Back to Experiments</Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={generating}
              onClick={async () => {
                setGenerating(true);
                setError("");
                try {
                  const generated = await generateExperimentSuggestions(brandId, true);
                  setSuggestions(generated);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to generate suggestions");
                } finally {
                  setGenerating(false);
                }
              }}
            >
              <RefreshCcw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} />
              {generating ? "Generating..." : "Generate Suggestions"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading suggestions...</div> : null}
      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      {renderableSuggestions.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {renderableSuggestions.map((suggestion) => {
            const detail = suggestionDetails(suggestion);
            return (
              <Card key={suggestion.id} className="border-[color:var(--border)] bg-[color:var(--surface-muted)]">
                <CardHeader className="space-y-2">
                  <CardTitle className="text-sm">{detail.campaignIdea}</CardTitle>
                  <CardDescription>{detail.rationale}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-[color:var(--muted-foreground)]">
                  <div><strong className="text-[color:var(--foreground)]">Who:</strong> {detail.who}</div>
                  {detail.trigger ? (
                    <div><strong className="text-[color:var(--foreground)]">Trigger:</strong> {detail.trigger}</div>
                  ) : null}
                  <div><strong className="text-[color:var(--foreground)]">Offer:</strong> {detail.offer}</div>
                  <div><strong className="text-[color:var(--foreground)]">CTA:</strong> {detail.cta}</div>
                  <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-1">
                    <strong className="text-[color:var(--foreground)]">Email #1 Preview:</strong> {detail.emailPreview}
                  </div>
                  <div><strong className="text-[color:var(--foreground)]">Success target:</strong> {detail.successTarget}</div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      disabled={Boolean(busyId)}
                      onClick={async () => {
                        setBusyId(suggestion.id);
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
                          setBusyId("");
                        }
                      }}
                    >
                      {busyId === suggestion.id ? "Creating..." : "Create From Suggestion"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(busyId)}
                      onClick={async () => {
                        setBusyId(suggestion.id);
                        setError("");
                        try {
                          await dismissExperimentSuggestion(brandId, suggestion.id);
                          await refresh();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Failed to dismiss suggestion");
                        } finally {
                          setBusyId("");
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
        <Card>
          <CardContent className="py-8 text-sm text-[color:var(--muted-foreground)]">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              No concrete suggestions saved yet. Generate suggestions to populate this list.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
