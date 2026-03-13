"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, RefreshCcw } from "lucide-react";
import {
  applyExperimentSuggestion,
  dismissExperimentSuggestion,
  fetchExperimentSuggestions,
  generateExperimentSuggestions,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import { cn } from "@/lib/utils";
import type { ExperimentSuggestionRecord } from "@/lib/factory-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

function SuggestionField({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3",
        className
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
        {label}
      </p>
      <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">{value}</p>
    </div>
  );
}

export default function ExperimentSuggestionsPanel({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<ExperimentSuggestionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    const rows = await fetchExperimentSuggestions(brandId);
    setSuggestions(rows);
    localStorage.setItem("factory.activeBrandId", brandId);
    return rows;
  };

  const renderableSuggestions = useMemo(
    () => suggestions.filter((row) => isRenderableSuggestion(row)),
    [suggestions]
  );

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");

    void refresh()
      .then(async (rows) => {
        if (!mounted) return;
        if (rows.some((row) => isRenderableSuggestion(row))) return;
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

  return (
    <div className="space-y-4 p-4 md:p-6">
      <section className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              Suggestion bank
            </p>
            <h3 className="text-base font-semibold text-[color:var(--foreground)]">
              Start from a real idea, not a blank experiment.
            </h3>
            <p className="max-w-3xl text-sm leading-6 text-[color:var(--muted-foreground)]">
              Review the strongest audience and offer combinations for this brand, then open the one you want to run.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={renderableSuggestions.length ? "accent" : "muted"}>
              {renderableSuggestions.length} ready
            </Badge>
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
              {generating ? "Refreshing..." : "Refresh ideas"}
            </Button>
          </div>
        </div>
      </section>

      {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading suggestions...</div> : null}
      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      {renderableSuggestions.length ? (
        <div className="space-y-3">
          {renderableSuggestions.map((suggestion, index) => {
            const detail = suggestionDetails(suggestion);
            return (
              <article
                key={suggestion.id}
                className="rounded-[20px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-4 shadow-[0_18px_48px_-30px_color-mix(in_srgb,var(--shadow)_55%,transparent)] md:px-5"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="muted">{String(index + 1).padStart(2, "0")}</Badge>
                      {detail.trigger ? <Badge variant="default">{detail.trigger}</Badge> : null}
                      <Badge variant="accent">Suggested experiment</Badge>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-lg font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                        {detail.campaignIdea}
                      </h4>
                      <p className="max-w-3xl text-sm leading-6 text-[color:var(--muted-foreground)]">
                        {detail.rationale}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 xl:justify-end">
                    <Button
                      type="button"
                      disabled={Boolean(busyId) || generating}
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
                          router.push(`/brands/${brandId}/experiments/${experiment.id}`);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Failed to create experiment");
                        } finally {
                          setBusyId("");
                        }
                      }}
                    >
                      {busyId === suggestion.id ? "Creating..." : "Use this idea"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={Boolean(busyId) || generating}
                      onClick={async () => {
                        setBusyId(suggestion.id);
                        setError("");
                        try {
                          await dismissExperimentSuggestion(brandId, suggestion.id);
                          setSuggestions((current) => current.filter((row) => row.id !== suggestion.id));
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
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
                  <div className="grid gap-3 md:grid-cols-2">
                    <SuggestionField label="Audience" value={detail.who} />
                    <SuggestionField label="Offer" value={detail.offer} />
                    <SuggestionField label="Call to action" value={detail.cta} />
                    <SuggestionField label="Success target" value={detail.successTarget} />
                  </div>
                  <SuggestionField
                    label="Email preview"
                    value={detail.emailPreview}
                    className="border-[color:var(--accent-border)] bg-[color:var(--accent-soft)]"
                  />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="rounded-[20px] border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] px-5 py-10 text-center">
          <div className="mx-auto flex max-w-md flex-col items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface)]">
              <Lightbulb className="h-5 w-5 text-[color:var(--muted-foreground)]" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-[color:var(--foreground)]">No ready suggestions yet</h3>
              <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                Generate a fresh batch and this list will fill with concrete experiment ideas you can open directly.
              </p>
            </div>
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
              {generating ? "Generating..." : "Generate suggestions"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
