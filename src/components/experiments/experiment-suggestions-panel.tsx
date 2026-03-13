"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Lightbulb, RefreshCcw, Sparkles, UserRound, WandSparkles } from "lucide-react";
import {
  applyExperimentSuggestion,
  dismissExperimentSuggestion,
  fetchExperimentSuggestions,
  generateExperimentSuggestions,
  generateExperimentSuggestionsDetailed,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import { cn } from "@/lib/utils";
import type {
  ExperimentSuggestionGenerationResult,
  ExperimentSuggestionRecord,
  ExperimentSuggestionReviewCandidate,
} from "@/lib/factory-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const MIN_READY_SUGGESTIONS = 3;

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

function suggestionErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (message === "Failed to fetch") {
    return "Could not reach the suggestion service. Retry in a moment.";
  }
  return message || fallback;
}

function selectPlaybackCandidates(candidates: ExperimentSuggestionReviewCandidate[]) {
  const shortlisted = candidates.filter((candidate) => candidate.accepted).slice(0, 2);
  const pushback =
    candidates.find((candidate) => !candidate.accepted) ??
    candidates.find((candidate) => candidate.decision !== "promote") ??
    null;

  const ordered = [...shortlisted];
  if (pushback) {
    ordered.push(pushback);
  }
  for (const candidate of candidates) {
    if (ordered.some((row) => row.index === candidate.index)) continue;
    ordered.push(candidate);
    if (ordered.length >= 4) break;
  }
  return ordered.slice(0, 4);
}

function statusBadgeVariant(candidate: ExperimentSuggestionReviewCandidate) {
  if (candidate.accepted) return "success";
  if (candidate.decision === "revise") return "accent";
  return "danger";
}

function statusLabel(candidate: ExperimentSuggestionReviewCandidate) {
  if (candidate.accepted) return "Shortlisted";
  if (candidate.decision === "revise") return "Needs rewrite";
  return "Rejected";
}

function prospectPushback(candidate: ExperimentSuggestionReviewCandidate) {
  return (
    candidate.risks[0] ||
    candidate.summary ||
    "Not interested. This does not feel specific enough to stop the scroll."
  );
}

function strategistResponse(candidate: ExperimentSuggestionReviewCandidate) {
  if (candidate.accepted) {
    return candidate.strengths[0] || "Keep this one. The angle is specific enough to earn a reply.";
  }
  if (candidate.decision === "revise") {
    return candidate.strengths[0] || "The core idea works, but the ask still needs to tighten.";
  }
  return "Drop it. The prospect pushback is too strong for first-touch outbound.";
}

function reviewNarrative(candidate: ExperimentSuggestionReviewCandidate) {
  return [
    {
      role: "strategist" as const,
      label: "Strategist",
      message: candidate.name,
    },
    {
      role: "prospect" as const,
      label: "Prospect roleplay",
      message: prospectPushback(candidate),
    },
    {
      role: "strategist" as const,
      label: statusLabel(candidate),
      message: strategistResponse(candidate),
    },
  ];
}

export default function ExperimentSuggestionsPanel({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<ExperimentSuggestionRecord[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [playbackActive, setPlaybackActive] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [playbackCandidates, setPlaybackCandidates] = useState<ExperimentSuggestionReviewCandidate[]>([]);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
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
  const readySuggestionCount = renderableSuggestions.length;
  const hasRenderableSuggestions = readySuggestionCount > 0;
  const isPreparing = bootstrapping || (refreshing && !hasRenderableSuggestions) || playbackActive;
  const activePlaybackCandidate =
    playbackCandidates[Math.min(playbackIndex, Math.max(0, playbackCandidates.length - 1))] ?? null;
  const playbackNarrative = activePlaybackCandidate ? reviewNarrative(activePlaybackCandidate) : [];

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!playbackActive || !playbackCandidates.length) return;

    setPlaybackIndex(0);

    if (prefersReducedMotion) {
      const timeout = window.setTimeout(() => {
        setPlaybackActive(false);
      }, 900);
      return () => window.clearTimeout(timeout);
    }

    let nextIndex = 0;
    const interval = window.setInterval(() => {
      nextIndex += 1;
      if (nextIndex < playbackCandidates.length) {
        setPlaybackIndex(nextIndex);
        return;
      }
      window.clearInterval(interval);
      window.setTimeout(() => {
        setPlaybackActive(false);
      }, 720);
    }, 1400);

    return () => window.clearInterval(interval);
  }, [playbackActive, playbackCandidates, prefersReducedMotion]);

  const startPlayback = (result: ExperimentSuggestionGenerationResult) => {
    const candidates = selectPlaybackCandidates(result.reviewCandidates ?? []);
    if (!candidates.length) {
      setPlaybackCandidates([]);
      setPlaybackIndex(0);
      setPlaybackActive(false);
      return;
    }

    setPlaybackCandidates(candidates);
    setPlaybackIndex(0);
    setPlaybackActive(true);
  };

  const regenerateSuggestions = async (refresh = true) => {
    setRefreshing(true);
    setError("");
    try {
      const result = await generateExperimentSuggestionsDetailed(brandId, refresh);
      setSuggestions(result.suggestions);
      startPlayback(result);
      return result.suggestions;
    } catch (err) {
      setError(suggestionErrorMessage(err, "Failed to generate suggestions"));
      return [];
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    setBootstrapping(true);
    setError("");

    void refresh()
      .then(async (rows) => {
        if (!mounted) return;
        if (rows.filter((row) => isRenderableSuggestion(row)).length >= MIN_READY_SUGGESTIONS) return;
        try {
          const generated = await generateExperimentSuggestions(brandId);
          if (!mounted) return;
          setSuggestions(generated);
        } catch (err) {
          if (!mounted) return;
          setError(suggestionErrorMessage(err, "Failed to generate suggestions"));
        }
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(suggestionErrorMessage(err, "Failed to load suggestions"));
      })
      .finally(() => {
        if (mounted) setBootstrapping(false);
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
            <Badge variant={hasRenderableSuggestions ? "accent" : "muted"}>
              {readySuggestionCount} ready
            </Badge>
            {!isPreparing ? (
              <Button
                type="button"
                variant="outline"
                disabled={refreshing}
                onClick={async () => {
                  await regenerateSuggestions(true);
                }}
              >
                <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Refreshing..." : "Refresh ideas"}
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      {isPreparing ? (
        playbackCandidates.length && activePlaybackCandidate ? (
          <section className="grid gap-4 rounded-[22px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 md:p-5 xl:grid-cols-[minmax(280px,0.88fr)_minmax(0,1.12fr)]">
            <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
                    Idea queue
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                    Reviewing real drafts
                  </h3>
                </div>
                <Badge variant="muted">{playbackIndex + 1} / {playbackCandidates.length}</Badge>
              </div>

              <div className="mt-4 space-y-2">
                {playbackCandidates.map((candidate, index) => {
                  const active = index === playbackIndex;
                  return (
                    <div
                      key={`${candidate.index}:${candidate.name}`}
                      className={cn(
                        "rounded-[16px] border px-3 py-3 transition-all duration-300 motion-reduce:transition-none",
                        active
                          ? "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] shadow-[0_12px_28px_-20px_color-mix(in_srgb,var(--accent)_35%,transparent)]"
                          : "border-[color:var(--border)] bg-[color:var(--surface-muted)] opacity-70"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold leading-5 text-[color:var(--foreground)]">{candidate.name}</p>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[color:var(--muted-foreground)]">
                            {candidate.audience}
                          </p>
                        </div>
                        <Badge variant={statusBadgeVariant(candidate)}>{statusLabel(candidate)}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusBadgeVariant(activePlaybackCandidate)}>{statusLabel(activePlaybackCandidate)}</Badge>
                <Badge variant="muted">Reply {activePlaybackCandidate.replyLikelihood}%</Badge>
                <Badge variant="muted">Positive {activePlaybackCandidate.positiveReplyLikelihood}%</Badge>
                <Badge variant="muted">Risk {activePlaybackCandidate.unsubscribeRisk}%</Badge>
              </div>

              <div className="mt-4 space-y-3">
                {playbackNarrative.map((entry, index) => (
                  <div
                    key={`${activePlaybackCandidate.index}:${entry.label}:${index}`}
                    className={cn(
                      "flex transition-all duration-300 motion-reduce:transition-none",
                      entry.role === "prospect" ? "justify-start" : "justify-end",
                      index === playbackNarrative.length - 1 ? "motion-safe:animate-pulse" : ""
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[88%] rounded-[18px] px-4 py-3 shadow-[0_12px_32px_-24px_color-mix(in_srgb,var(--shadow)_45%,transparent)]",
                        entry.role === "prospect"
                          ? "border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
                          : "border border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] text-[color:var(--foreground)]"
                      )}
                    >
                      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em]">
                        {entry.role === "prospect" ? <UserRound className="h-3.5 w-3.5" /> : <WandSparkles className="h-3.5 w-3.5" />}
                        {entry.label}
                      </div>
                      <p className="text-sm leading-6">{entry.message}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  First-line preview
                </p>
                <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                  {activePlaybackCandidate.emailPreview}
                </p>
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-[20px] border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] px-5 py-14">
            <div className="mx-auto grid max-w-4xl gap-4 xl:grid-cols-[minmax(240px,0.75fr)_minmax(0,1.25fr)]">
              <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
                  Pipeline
                </p>
                <div className="mt-4 space-y-3">
                  {[
                    "Drafting audience + offer pairs",
                    "Pressure-testing the first-line hook",
                    "Simulating prospect replies and objections",
                  ].map((label, index) => (
                    <div key={label} className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)]">
                        {index === 2 ? (
                          <Sparkles className="h-4 w-4 text-[color:var(--muted-foreground)]" />
                        ) : (
                          <RefreshCcw className="h-4 w-4 animate-spin text-[color:var(--muted-foreground)]" />
                        )}
                      </div>
                      <div className="text-sm text-[color:var(--foreground)]">{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  <WandSparkles className="h-3.5 w-3.5" />
                  Live review
                </div>
                <div className="mt-4 space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-[84%] rounded-[18px] border border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] px-4 py-3 text-sm leading-6 text-[color:var(--foreground)]">
                      Building the strongest experiment angles from this brand profile.
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="max-w-[84%] rounded-[18px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3 text-sm leading-6 text-[color:var(--danger)]">
                      Stress-testing whether the prospect would ignore it, push back, or actually reply.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )
      ) : hasRenderableSuggestions ? (
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
                      disabled={Boolean(busyId) || refreshing}
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
                      disabled={Boolean(busyId) || refreshing}
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
              disabled={refreshing}
              onClick={async () => {
                await regenerateSuggestions(true);
              }}
            >
              <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Generate suggestions
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
