"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Lightbulb,
  RefreshCcw,
  Sparkles,
  Trophy,
  UserRound,
  WandSparkles,
} from "lucide-react";
import {
  applyExperimentSuggestion,
  dismissExperimentSuggestion,
  fetchExperimentSuggestions,
  streamExperimentSuggestions,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import { cn } from "@/lib/utils";
import type {
  ExperimentSuggestionBrainstormTurn,
  ExperimentSuggestionGenerationResult,
  ExperimentSuggestionRecord,
  ExperimentSuggestionReviewCandidate,
  ExperimentSuggestionStreamEvent,
} from "@/lib/factory-types";
import OutreachFlowSuggestionsPanel from "@/components/experiments/outreach-flow-suggestions-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const MIN_READY_SUGGESTIONS = 3;
const STREAM_PLACEHOLDER_MS = 900;
const TURN_EASE = "motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]";
const PLACEHOLDER_AGENTS = [
  {
    name: "Agent 1 · Pain Sniper",
    style: "pain-led",
    brief: "Hunts the operational pain the prospect already feels this week.",
  },
  {
    name: "Agent 2 · Trigger Hunter",
    style: "timing-led",
    brief: "Looks for a deadline or event that makes the idea timely right now.",
  },
  {
    name: "Agent 3 · Proof Builder",
    style: "proof-led",
    brief: "Pushes evidence-first angles instead of vague improvement claims.",
  },
  {
    name: "Agent 4 · Teardown Critic",
    style: "teardown-led",
    brief: "Calls out a broken workflow the prospect will recognize instantly.",
  },
  {
    name: "Agent 5 · Workflow Surgeon",
    style: "workflow-led",
    brief: "Targets one exact handoff or approval jam.",
  },
  {
    name: "Agent 6 · Economic Buyer",
    style: "economic-led",
    brief: "Frames the offer around waste, margin, or efficiency.",
  },
  {
    name: "Agent 7 · Contrarian",
    style: "contrarian",
    brief: "Brings a sharper angle the safe agents avoid.",
  },
  {
    name: "Agent 8 · Narrow ICP",
    style: "specialist-led",
    brief: "Zooms into a tiny segment the others skipped.",
  },
  {
    name: "Agent 9 · Peer Pressure",
    style: "social-proof-led",
    brief: "Uses market pressure without fake social proof.",
  },
  {
    name: "Agent 10 · Wildcard",
    style: "wildcard",
    brief: "Throws the weird but defensible option onto the board.",
  },
];

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

function statusBadgeVariant(candidate: ExperimentSuggestionReviewCandidate) {
  if (candidate.accepted) return "success";
  if (candidate.decision === "revise") return "accent";
  return "danger";
}

function statusLabel(candidate: ExperimentSuggestionReviewCandidate) {
  if (candidate.accepted) return "Accepted";
  if (candidate.decision === "revise") return "Needs rewrite";
  return "Rejected";
}

function turnStatusLabel(turn: ExperimentSuggestionBrainstormTurn) {
  if (turn.status === "drafting") return "Drafting";
  if (turn.status === "reviewing") return "Roleplaying";
  if (turn.status === "failed") return "Stalled";
  return `${turn.acceptedCount} accepted`;
}

function turnStatusVariant(turn: ExperimentSuggestionBrainstormTurn) {
  if (turn.status === "failed") return "danger";
  if (turn.status === "completed" && turn.acceptedCount > 0) return "success";
  if (turn.status === "reviewing") return "accent";
  return "muted";
}

function prospectPushback(candidate: ExperimentSuggestionReviewCandidate) {
  return (
    candidate.risks[0] ||
    candidate.summary ||
    "Not interested. This still feels too broad to earn attention."
  );
}

function judgeResponse(candidate: ExperimentSuggestionReviewCandidate) {
  if (candidate.accepted) {
    return candidate.strengths[0] || "Keep it. This one is specific enough to survive first-touch scrutiny.";
  }
  if (candidate.decision === "revise") {
    return candidate.strengths[0] || "There is a real angle here, but the ask or trigger still needs tightening.";
  }
  return "Drop it. The prospect pushback is stronger than the hook.";
}

function ideaRankScore(candidate: ExperimentSuggestionReviewCandidate) {
  const decisionBoost = candidate.decision === "promote" ? 8 : candidate.decision === "revise" ? 2 : -12;
  return (
    candidate.score +
    candidate.openLikelihood * 0.15 +
    candidate.replyLikelihood * 0.45 +
    candidate.positiveReplyLikelihood * 0.35 -
    candidate.unsubscribeRisk * 0.5 +
    decisionBoost
  );
}

function rankTurns(turns: ExperimentSuggestionBrainstormTurn[]) {
  return [...turns].sort((left, right) => {
    if (right.acceptedCount !== left.acceptedCount) {
      return right.acceptedCount - left.acceptedCount;
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.turn - right.turn;
  });
}

function bestCompletedIdea(turn: ExperimentSuggestionBrainstormTurn) {
  return [...turn.ideas].sort((left, right) => ideaRankScore(right) - ideaRankScore(left))[0] ?? null;
}

function bestDraftIdea(turn: ExperimentSuggestionBrainstormTurn) {
  return turn.draftIdeas[0] ?? null;
}

function summarizeTournamentProgress(input: {
  turns: ExperimentSuggestionBrainstormTurn[];
  placeholderAgentIndex: number;
  preparing: boolean;
}) {
  const totalTurns = PLACEHOLDER_AGENTS.length;
  const totalPhases = totalTurns * 2;

  if (!input.preparing) {
    return {
      percent: 100,
      label: "Suggestion bank ready",
      detail: "Tournament finished",
    };
  }

  if (!input.turns.length) {
    const stagedPercent = Math.max(
      8,
      Math.min(18, Math.round(((input.placeholderAgentIndex + 1) / totalTurns) * 18))
    );
    return {
      percent: stagedPercent,
      label: "Warming up the tournament",
      detail: `${Math.min(input.placeholderAgentIndex + 1, totalTurns)} of ${totalTurns} agents queued`,
    };
  }

  const completedPhases = input.turns.reduce((total, turn) => {
    if (turn.status === "drafting") return total + 1;
    if (turn.status === "reviewing") return total + 1.5;
    return total + 2;
  }, 0);

  const activeTurn = input.turns[input.turns.length - 1] ?? null;
  const currentTurn = activeTurn?.turn ?? input.turns.length;
  const percent = Math.max(10, Math.min(98, Math.round((completedPhases / totalPhases) * 100)));

  if (!activeTurn) {
    return {
      percent,
      label: "Preparing suggestions",
      detail: `${input.turns.length} turns observed`,
    };
  }

  if (activeTurn.status === "drafting") {
    return {
      percent,
      label: `${activeTurn.agentName} is drafting`,
      detail: `Turn ${currentTurn} of ${totalTurns}`,
    };
  }

  if (activeTurn.status === "reviewing") {
    return {
      percent,
      label: `${activeTurn.agentName} is under prospect review`,
      detail: `Turn ${currentTurn} of ${totalTurns}`,
    };
  }

  if (activeTurn.status === "failed") {
    return {
      percent,
      label: `${activeTurn.agentName} stalled`,
      detail: `Moving to turn ${Math.min(currentTurn + 1, totalTurns)}`,
    };
  }

  return {
    percent,
    label: `${activeTurn.agentName} scored ${activeTurn.acceptedCount} accepted`,
    detail: `Turn ${currentTurn} of ${totalTurns}`,
  };
}

function upsertTurn(
  turns: ExperimentSuggestionBrainstormTurn[],
  nextTurn: ExperimentSuggestionBrainstormTurn
) {
  const copy = [...turns];
  const existingIndex = copy.findIndex((turn) => turn.turn === nextTurn.turn);
  if (existingIndex >= 0) {
    copy[existingIndex] = nextTurn;
  } else {
    copy.push(nextTurn);
  }
  copy.sort((left, right) => left.turn - right.turn);
  return copy;
}

export default function ExperimentSuggestionsPanel({ brandId }: { brandId: string }) {
  const router = useRouter();
  const streamControllerRef = useRef<AbortController | null>(null);
  const [activeTab, setActiveTab] = useState<"experiments" | "outreach">("experiments");
  const [suggestions, setSuggestions] = useState<ExperimentSuggestionRecord[]>([]);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamTurns, setStreamTurns] = useState<ExperimentSuggestionBrainstormTurn[]>([]);
  const [activeTurnIndex, setActiveTurnIndex] = useState(0);
  const [placeholderAgentIndex, setPlaceholderAgentIndex] = useState(0);
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
  const isPreparing = bootstrapping || streaming;
  const activeTurn =
    streamTurns[Math.min(activeTurnIndex, Math.max(0, streamTurns.length - 1))] ?? null;
  const leaderboardTurns = useMemo(
    () => rankTurns(streamTurns.filter((turn) => turn.status === "completed")),
    [streamTurns]
  );
  const leaderboardRankMap = useMemo(
    () => new Map(leaderboardTurns.map((turn, index) => [turn.agentId, index + 1])),
    [leaderboardTurns]
  );
  const activeRank = activeTurn ? leaderboardRankMap.get(activeTurn.agentId) ?? null : null;
  const activeBestCompletedIdea =
    activeTurn?.status === "completed" ? bestCompletedIdea(activeTurn) : null;
  const activeBestDraftIdea =
    activeTurn && activeTurn.status !== "completed" ? bestDraftIdea(activeTurn) : null;
  const activeBestIdea = activeBestCompletedIdea ?? activeBestDraftIdea;
  const tournamentProgress = useMemo(
    () =>
      summarizeTournamentProgress({
        turns: streamTurns,
        placeholderAgentIndex,
        preparing: isPreparing,
      }),
    [streamTurns, placeholderAgentIndex, isPreparing]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isPreparing || streamTurns.length || prefersReducedMotion) return;
    const interval = window.setInterval(() => {
      setPlaceholderAgentIndex((current) => (current + 1) % PLACEHOLDER_AGENTS.length);
    }, STREAM_PLACEHOLDER_MS);
    return () => window.clearInterval(interval);
  }, [isPreparing, streamTurns.length, prefersReducedMotion]);

  useEffect(() => {
    return () => {
      streamControllerRef.current?.abort();
    };
  }, []);

  const applyGeneratedResult = (result: ExperimentSuggestionGenerationResult) => {
    setSuggestions(result.suggestions);
    if (result.brainstormTurns?.length) {
      setStreamTurns(result.brainstormTurns);
      setActiveTurnIndex(Math.max(result.brainstormTurns.length - 1, 0));
    }
  };

  const handleStreamEvent = (event: ExperimentSuggestionStreamEvent) => {
    if (event.type === "start") {
      setStreaming(true);
      return;
    }

    if (
      event.type === "turn_started" ||
      event.type === "turn_drafted" ||
      event.type === "turn_completed" ||
      event.type === "turn_failed"
    ) {
      setStreamTurns((current) => {
        const next = upsertTurn(current, event.turn);
        const nextIndex = next.findIndex((turn) => turn.turn === event.turn.turn);
        if (nextIndex >= 0) {
          setActiveTurnIndex(nextIndex);
        }
        return next;
      });
      return;
    }

    if (event.type === "done") {
      applyGeneratedResult(event.result);
      setStreaming(false);
      setRefreshing(false);
      return;
    }

    if (event.type !== "error") {
      return;
    }

    setError(
      [event.message, event.hint].filter(Boolean).join(" ") ||
        "Failed to generate suggestions"
    );
    setStreaming(false);
    setRefreshing(false);
  };

  const runLiveGeneration = async (refreshMode = true) => {
    streamControllerRef.current?.abort();
    const controller = new AbortController();
    streamControllerRef.current = controller;
    setRefreshing(true);
    setStreaming(true);
    setStreamTurns([]);
    setActiveTurnIndex(0);
    setError("");

    try {
      await streamExperimentSuggestions(brandId, {
        refresh: refreshMode,
        signal: controller.signal,
        onEvent: handleStreamEvent,
      });
    } catch (err) {
      if (controller.signal.aborted) return [];
      setError(suggestionErrorMessage(err, "Failed to generate suggestions"));
      setStreaming(false);
      setRefreshing(false);
      return [];
    } finally {
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null;
      }
    }

    return [];
  };

  useEffect(() => {
    let mounted = true;
    setBootstrapping(true);
    setError("");

    void refresh()
      .then(async (rows) => {
        if (!mounted) return;
        if (rows.filter((row) => isRenderableSuggestion(row)).length >= MIN_READY_SUGGESTIONS) return;
        await runLiveGeneration(false);
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
      streamControllerRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <section className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              Brainstorm lab
            </p>
            <h3 className="text-base font-semibold text-[color:var(--foreground)]">
              Choose the lane you want to pressure-test.
            </h3>
            <p className="max-w-3xl text-sm leading-6 text-[color:var(--muted-foreground)]">
              Keep the live experiment idea bank, or switch to outreach-flow tournaments when you
              need a reply-first conversational path before you build anything.
            </p>
          </div>

          <div className="inline-flex rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface)] p-1">
            <button
              type="button"
              className={cn(
                "rounded-[10px] px-3 py-2 text-sm font-medium transition-colors",
                activeTab === "experiments"
                  ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]"
                  : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
              )}
              onClick={() => setActiveTab("experiments")}
            >
              Experiment ideas
            </button>
            <button
              type="button"
              className={cn(
                "rounded-[10px] px-3 py-2 text-sm font-medium transition-colors",
                activeTab === "outreach"
                  ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]"
                  : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
              )}
              onClick={() => setActiveTab("outreach")}
            >
              Outreach flows
            </button>
          </div>
        </div>
      </section>

      {activeTab === "outreach" ? (
        <OutreachFlowSuggestionsPanel brandId={brandId} />
      ) : (
        <>
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
              Ten agents now brainstorm in sequence, then the prospect roleplay judge pushes back in
              real time while the leaderboard updates live.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={hasRenderableSuggestions ? "accent" : "muted"}>
              {readySuggestionCount} ready
            </Badge>
            {streaming ? (
              <Badge variant="accent" className="gap-1">
                <Sparkles className="h-3.5 w-3.5 motion-safe:animate-pulse" />
                Live
              </Badge>
            ) : null}
            {!isPreparing ? (
              <Button
                type="button"
                variant="outline"
                disabled={refreshing}
                onClick={async () => {
                  await runLiveGeneration(true);
                }}
              >
                <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Refreshing..." : "Refresh ideas"}
              </Button>
            ) : null}
          </div>
        </div>
        {isPreparing ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
              <span>{tournamentProgress.label}</span>
              <span>{tournamentProgress.detail}</span>
            </div>
            <div className="relative mt-2 h-2.5 overflow-hidden rounded-full border border-[color:var(--border)] bg-[color:var(--surface)]">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full bg-[color:var(--accent)] transition-[width] duration-500",
                  TURN_EASE
                )}
                style={{ width: `${tournamentProgress.percent}%` }}
              />
              {!prefersReducedMotion ? (
                <div
                  className={cn(
                    "absolute inset-y-0 w-20 rounded-full bg-gradient-to-r from-transparent via-white/45 to-transparent transition-[left] duration-700",
                    TURN_EASE
                  )}
                  style={{
                    left: `max(calc(${tournamentProgress.percent}% - 5rem), 0px)`,
                  }}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      {isPreparing ? (
        streamTurns.length && activeTurn ? (
          <section className="grid gap-4 rounded-[22px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 md:p-5 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
            <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
                    Agent tournament
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                    Live brainstorm with no repeats
                  </h3>
                </div>
                <Badge variant="muted">
                  {Math.min(activeTurnIndex + 1, streamTurns.length)} / {Math.max(streamTurns.length, 1)}
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {leaderboardTurns.slice(0, 3).map((turn, index) => (
                  <Badge
                    key={turn.agentId}
                    variant={index === 0 ? "accent" : "muted"}
                    className="gap-1"
                  >
                    <Trophy className="h-3.5 w-3.5" />
                    #{index + 1} {turn.agentName.split("·")[1]?.trim() ?? turn.agentName}
                  </Badge>
                ))}
              </div>

              <div className="mt-4 space-y-2">
                {streamTurns.map((turn, index) => {
                  const active = index === activeTurnIndex;
                  const turnRank = leaderboardRankMap.get(turn.agentId);
                  return (
                    <div
                      key={`${turn.agentId}:${turn.turn}`}
                      className={cn(
                        "rounded-[16px] border px-3 py-3 transition-[transform,opacity,background-color,border-color,box-shadow] duration-300",
                        TURN_EASE,
                        active
                          ? "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] shadow-[0_12px_28px_-20px_color-mix(in_srgb,var(--accent)_35%,transparent)] motion-safe:-translate-y-0.5"
                          : "border-[color:var(--border)] bg-[color:var(--surface-muted)]"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                              Turn {turn.turn}
                            </p>
                            {turnRank ? <Badge variant={turnRank === 1 ? "accent" : "muted"}>#{turnRank}</Badge> : null}
                          </div>
                          <p className="mt-1 text-sm font-semibold leading-5 text-[color:var(--foreground)]">
                            {turn.agentName}
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[color:var(--muted-foreground)]">
                            {turn.brief}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Badge variant={turnStatusVariant(turn)}>{turnStatusLabel(turn)}</Badge>
                          <span className="text-xs text-[color:var(--muted-foreground)]">
                            {turn.score} pts
                          </span>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {turn.status === "drafting" ? (
                          <Badge variant="muted">Searching for untouched territory</Badge>
                        ) : turn.status === "reviewing" ? (
                          <>
                            <Badge variant="accent">Ideas drafted</Badge>
                            <Badge variant="muted">Roleplay in progress</Badge>
                          </>
                        ) : turn.status === "failed" ? (
                          <Badge variant="danger">{turn.error || "Turn failed"}</Badge>
                        ) : (
                          turn.ideas.map((idea, ideaIndex) => (
                            <Badge key={`${turn.agentId}:${idea.index}`} variant={statusBadgeVariant(idea)}>
                              Idea {ideaIndex + 1} · {statusLabel(idea)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="accent">{activeTurn.agentStyle}</Badge>
                    {activeRank ? <Badge variant="muted">Rank #{activeRank}</Badge> : null}
                    <Badge variant={turnStatusVariant(activeTurn)}>{turnStatusLabel(activeTurn)}</Badge>
                  </div>
                  <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                    {activeTurn.agentName}
                  </h3>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-[color:var(--muted-foreground)]">
                    {activeTurn.brief}
                  </p>
                </div>
                <div className="rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-right">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                    Score
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[color:var(--foreground)]">
                    {activeTurn.score}
                  </p>
                </div>
              </div>

              {activeTurn.status === "drafting" ? (
                <div className="mt-5 space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-[90%] rounded-[18px] border border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] px-4 py-3 shadow-[0_12px_32px_-24px_color-mix(in_srgb,var(--shadow)_45%,transparent)]">
                      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--foreground)]">
                        <WandSparkles className="h-3.5 w-3.5 motion-safe:animate-pulse" />
                        {activeTurn.agentName}
                      </div>
                      <p className="text-sm leading-6 text-[color:var(--foreground)]">
                        Mapping untouched territory and drafting two new angles the earlier agents did not claim.
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <div className="max-w-[90%] rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                        <Bot className="h-3.5 w-3.5" />
                        Rule
                      </div>
                      <p className="text-sm leading-6 text-[color:var(--foreground)]">
                        No paraphrases. No recycled audience-trigger-offer combos.
                      </p>
                    </div>
                  </div>
                </div>
              ) : activeTurn.status === "reviewing" ? (
                <div className="mt-5 space-y-4">
                  {activeTurn.draftIdeas.map((idea, ideaIndex) => (
                    <div
                      key={`${activeTurn.agentId}:draft:${idea.name}`}
                      className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="muted">Idea {ideaIndex + 1}</Badge>
                        <Badge variant="accent">Under review</Badge>
                      </div>

                      <div className="mt-3 space-y-3">
                        <div className="flex justify-end">
                          <div className="max-w-[90%] rounded-[18px] border border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] px-4 py-3 shadow-[0_12px_32px_-24px_color-mix(in_srgb,var(--shadow)_45%,transparent)]">
                            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--foreground)]">
                              <WandSparkles className="h-3.5 w-3.5" />
                              {activeTurn.agentName}
                            </div>
                            <p className="text-sm font-semibold leading-6 text-[color:var(--foreground)]">
                              {idea.name}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                              {idea.audience}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                              {idea.offer}
                            </p>
                          </div>
                        </div>

                        <div className="flex justify-start">
                          <div className="max-w-[90%] rounded-[18px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3 shadow-[0_12px_32px_-24px_color-mix(in_srgb,var(--shadow)_45%,transparent)]">
                            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--danger)]">
                              <UserRound className="h-3.5 w-3.5" />
                              Prospect roleplay
                            </div>
                            <p className="text-sm leading-6 text-[color:var(--danger)]">
                              Pressure-testing whether the hook feels timely, specific, and worth replying to.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : activeTurn.status === "failed" ? (
                <div className="mt-5 rounded-[18px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-4">
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--danger)]">
                    <Bot className="h-3.5 w-3.5" />
                    Turn blocked
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--danger)]">
                    {activeTurn.error || "This agent failed to produce a distinct idea."}
                  </p>
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  {activeTurn.ideas.map((idea, ideaIndex) => (
                    <div
                      key={`${activeTurn.agentId}:${idea.index}`}
                      className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="muted">Idea {ideaIndex + 1}</Badge>
                        <Badge variant={statusBadgeVariant(idea)}>{statusLabel(idea)}</Badge>
                        <Badge variant="muted">Reply {idea.replyLikelihood}%</Badge>
                        <Badge variant="muted">Positive {idea.positiveReplyLikelihood}%</Badge>
                        <Badge variant="muted">Risk {idea.unsubscribeRisk}%</Badge>
                      </div>

                      <div className="mt-3 space-y-3">
                        <div className="flex justify-end">
                          <div className="max-w-[90%] rounded-[18px] border border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] px-4 py-3 shadow-[0_12px_32px_-24px_color-mix(in_srgb,var(--shadow)_45%,transparent)]">
                            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--foreground)]">
                              <WandSparkles className="h-3.5 w-3.5" />
                              {activeTurn.agentName}
                            </div>
                            <p className="text-sm font-semibold leading-6 text-[color:var(--foreground)]">
                              {idea.name}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                              {idea.audience}
                            </p>
                            <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                              {idea.offer}
                            </p>
                          </div>
                        </div>

                        <div className="flex justify-start">
                          <div className="max-w-[90%] rounded-[18px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3 shadow-[0_12px_32px_-24px_color-mix(in_srgb,var(--shadow)_45%,transparent)]">
                            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--danger)]">
                              <UserRound className="h-3.5 w-3.5" />
                              Prospect roleplay
                            </div>
                            <p className="text-sm leading-6 text-[color:var(--danger)]">
                              {prospectPushback(idea)}
                            </p>
                          </div>
                        </div>

                        <div className="flex justify-end">
                          <div className="max-w-[90%] rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 shadow-[0_12px_32px_-24px_color-mix(in_srgb,var(--shadow)_45%,transparent)]">
                            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                              <Bot className="h-3.5 w-3.5" />
                              {statusLabel(idea)}
                            </div>
                            <p className="text-sm leading-6 text-[color:var(--foreground)]">
                              {judgeResponse(idea)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeBestIdea ? (
                <div className="mt-4 rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                        Live hook
                      </p>
                      <p className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">
                        {activeBestIdea.name}
                      </p>
                    </div>
                    {activeBestCompletedIdea ? (
                      <Badge variant={statusBadgeVariant(activeBestCompletedIdea)}>
                        {statusLabel(activeBestCompletedIdea)}
                      </Badge>
                    ) : (
                      <Badge variant="accent">Draft</Badge>
                    )}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[color:var(--foreground)]">
                    {activeBestIdea.emailPreview}
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        ) : (
          <section className="grid gap-4 rounded-[22px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 md:p-5 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
            <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[color:var(--muted-foreground)]">
                    Adversarial brainstorm
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                    Ten agents are entering the arena
                  </h3>
                </div>
                <Badge variant="accent">Live stream armed</Badge>
              </div>

              <div className="mt-4 space-y-2">
                {PLACEHOLDER_AGENTS.map((agent, index) => {
                  const active = index === placeholderAgentIndex;
                  const complete = index < placeholderAgentIndex;
                  return (
                    <div
                      key={agent.name}
                      className={cn(
                        "rounded-[16px] border px-3 py-3 transition-[transform,opacity,background-color,border-color] duration-300",
                        TURN_EASE,
                        active
                          ? "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] motion-safe:-translate-y-0.5"
                          : complete
                            ? "border-[color:var(--border)] bg-[color:var(--surface-muted)]"
                            : "border-[color:var(--border)] bg-[color:var(--surface-muted)] opacity-55"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[color:var(--foreground)]">
                            {agent.name}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                            {agent.brief}
                          </p>
                        </div>
                        <Badge variant={active ? "accent" : "muted"}>
                          {active ? "Working" : complete ? "Queued" : "Waiting"}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="muted">{PLACEHOLDER_AGENTS[placeholderAgentIndex]?.style}</Badge>
                <Badge variant="muted">2 ideas per turn</Badge>
                <Badge variant="muted">Prospect roleplay judge</Badge>
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex justify-end">
                  <div className="max-w-[90%] rounded-[18px] border border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] px-4 py-3">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--foreground)]">
                      <WandSparkles className="h-3.5 w-3.5 motion-safe:animate-pulse" />
                      {PLACEHOLDER_AGENTS[placeholderAgentIndex]?.name ?? "Agent"}
                    </div>
                    <p className="text-sm leading-6 text-[color:var(--foreground)]">
                      Drafting two fresh experiment ideas while avoiding every audience, trigger, and offer already claimed.
                    </p>
                  </div>
                </div>

                <div className="flex justify-start">
                  <div className="max-w-[90%] rounded-[18px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--danger)]">
                      <UserRound className="h-3.5 w-3.5" />
                      Prospect roleplay
                    </div>
                    <p className="text-sm leading-6 text-[color:var(--danger)]">
                      If the hook sounds generic or the ask feels fuzzy, I ignore it immediately.
                    </p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <div className="max-w-[90%] rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                      <Bot className="h-3.5 w-3.5" />
                      Filter rule
                    </div>
                    <p className="text-sm leading-6 text-[color:var(--foreground)]">
                      Only ideas that survive the prospect pushback make the board.
                    </p>
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
                          router.push(`/brands/${brandId}/experiments/${experiment.id}/setup`);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Failed to create experiment");
                        } finally {
                          setBusyId("");
                        }
                      }}
                    >
                      {busyId === suggestion.id ? "Opening setup..." : "Start with this idea"}
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
                await runLiveGeneration(true);
              }}
            >
              <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Generate suggestions
            </Button>
          </div>
        </section>
      )}
        </>
      )}
    </div>
  );
}
