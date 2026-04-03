"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  RefreshCcw,
  Sparkles,
  Trophy,
  UserRound,
  WandSparkles,
} from "lucide-react";
import {
  fetchBrand,
  streamOutreachFlowTournamentApi,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import { cn } from "@/lib/utils";
import type {
  BrandRecord,
  OutreachFlowTournamentCandidate,
  OutreachFlowTournamentInput,
  OutreachFlowTournamentResult,
  OutreachFlowTournamentStreamEvent,
  OutreachFlowTournamentTurn,
} from "@/lib/factory-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const FORM_STORAGE_PREFIX = "factory.outreachFlow";
const TURN_EASE = "motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]";
const PLACEHOLDER_TICK_MS = 900;

const DEFAULT_PERSONAS = [
  "Editor of an industry journal or market note we operate",
  "Research lead behind a benchmark, report, or field note",
  "Organizer of a small operator roundtable in this space",
  "Partnerships lead for a co-created spotlight or feature",
].join("\n");

const DEFAULT_ASSETS = [
  "Editorial or case-study format we can publish from",
  "Benchmark or report framework",
  "Roundtable invite and summary format",
  "Private notes memo we can send after the reply",
].join("\n");

const DEFAULT_CONSTRAINTS = [
  "The opener must not read like cold outreach.",
  "The first ask should be easy to answer in one line.",
  "Bridge to the offer should happen only after real engagement.",
  "Avoid invented authority or fake affiliations.",
].join("\n");

const DEFAULT_BAR = [
  "Prefer identity-led entry vehicles over problem-first cold email.",
  "Reward low-friction reply asks.",
  "Prefer natural handoffs to a specialist over abrupt reveals.",
  "Penalize angles that collapse under one skeptical follow-up.",
].join("\n");

const PLACEHOLDER_AGENTS = [
  {
    name: "Agent 1 · Editorial Operator",
    style: "editorial-led",
    brief: "Find the journal, feature, or case-study invitation that gives the target a reason to reply.",
  },
  {
    name: "Agent 2 · Research Lead",
    style: "research-led",
    brief: "Pressure-test whether a benchmark or report frame can open the conversation cleanly.",
  },
  {
    name: "Agent 3 · Peer Convener",
    style: "peer-context-led",
    brief: "Look for a roundtable or operator exchange the target may genuinely want to join.",
  },
  {
    name: "Agent 4 · Collaboration Architect",
    style: "collaboration-led",
    brief: "Try a co-created feature, contribution, or spotlight that keeps the thread non-sales at first.",
  },
  {
    name: "Agent 5 · Credibility Minimalist",
    style: "minimalist",
    brief: "Prefer the lightest truthful persona with the least asset strain.",
  },
  {
    name: "Agent 6 · Contrarian",
    style: "contrarian",
    brief: "Bring the less obvious entry vehicle that still survives skeptical follow-up.",
  },
];

type OutreachFlowFormState = {
  target: string;
  desiredOutcome: string;
  offer: string;
  channel: string;
  availablePersonas: string;
  availableAssets: string;
  constraints: string;
  qualityBar: string;
  maxTurnsBeforeCTA: string;
  agentCount: string;
  ideasPerAgent: string;
};

const INITIAL_FORM: OutreachFlowFormState = {
  target: "",
  desiredOutcome: "",
  offer: "",
  channel: "email",
  availablePersonas: DEFAULT_PERSONAS,
  availableAssets: DEFAULT_ASSETS,
  constraints: DEFAULT_CONSTRAINTS,
  qualityBar: DEFAULT_BAR,
  maxTurnsBeforeCTA: "4",
  agentCount: "4",
  ideasPerAgent: "2",
};

function splitLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function progressLabel(result: OutreachFlowTournamentResult | null, running: boolean) {
  if (running) {
    return {
      title: "Outreach-flow tournament is running",
      detail: "Agents are competing on reply pull, credibility, and bridge quality.",
    };
  }

  if (result) {
    return {
      title: "Shortlist is ready",
      detail: `${result.snapshot.accepted} of ${result.snapshot.ideas} ideas survived the gate.`,
    };
  }

  return {
    title: "Design a reply-first outreach lane",
    detail: "Write the brief once, then let the arena pressure-test the entry vehicles for you.",
  };
}

function candidateTone(
  candidate: OutreachFlowTournamentCandidate
): "success" | "accent" | "danger" {
  if (candidate.accepted) return "success";
  if (candidate.decision === "revise") return "accent";
  return "danger";
}

function candidateLabel(candidate: OutreachFlowTournamentCandidate) {
  if (candidate.accepted) return "Accepted";
  if (candidate.decision === "revise") return "Needs rewrite";
  return "Rejected";
}

function findBranch(candidate: OutreachFlowTournamentCandidate, branchName: string) {
  return (
    candidate.branches.find(
      (branch) => branch.branch.trim().toLowerCase() === branchName.trim().toLowerCase()
    ) ?? null
  );
}

function DetailField({
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
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
        {label}
      </p>
      <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">{value}</p>
    </div>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-2">
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
          {label}
        </p>
        {hint ? (
          <p className="text-xs leading-5 text-[color:var(--muted-foreground)]">{hint}</p>
        ) : null}
      </div>
      {children}
    </label>
  );
}

function turnAcceptedCount(turn: OutreachFlowTournamentTurn) {
  return turn.acceptedTitles.length;
}

export default function OutreachFlowSuggestionsPanel({ brandId }: { brandId: string }) {
  const controllerRef = useRef<AbortController | null>(null);
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [form, setForm] = useState<OutreachFlowFormState>(INITIAL_FORM);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<OutreachFlowTournamentResult | null>(null);
  const [placeholderAgentIndex, setPlaceholderAgentIndex] = useState(0);
  const [progressPercent, setProgressPercent] = useState(6);

  const storageKey = `${FORM_STORAGE_PREFIX}:${brandId}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<OutreachFlowFormState>;
      setForm((current) => ({
        ...current,
        ...parsed,
      }));
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    let mounted = true;

    void fetchBrand(brandId)
      .then((loadedBrand) => {
        if (!mounted) return;
        setBrand(loadedBrand);
        setForm((current) => ({
          ...current,
          offer: current.offer.trim() ? current.offer : loadedBrand.product || loadedBrand.name,
        }));
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [brandId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(form));
  }, [form, storageKey]);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      setPlaceholderAgentIndex((current) => (current + 1) % PLACEHOLDER_AGENTS.length);
      setProgressPercent((current) => Math.min(current + 7, 92));
    }, PLACEHOLDER_TICK_MS);
    return () => window.clearInterval(interval);
  }, [running]);

  const preparedInput = useMemo<OutreachFlowTournamentInput>(
    () => ({
      target: form.target.trim(),
      desiredOutcome: form.desiredOutcome.trim(),
      offer: form.offer.trim(),
      channel: form.channel.trim() || "email",
      availablePersonas: splitLines(form.availablePersonas),
      availableAssets: splitLines(form.availableAssets),
      constraints: splitLines(form.constraints),
      qualityBar: splitLines(form.qualityBar),
      maxTurnsBeforeCTA: Number(form.maxTurnsBeforeCTA) || 4,
      agentCount: Number(form.agentCount) || 4,
      ideasPerAgent: Number(form.ideasPerAgent) || 2,
    }),
    [form]
  );

  const canRun =
    Boolean(preparedInput.target.trim()) &&
    Boolean(preparedInput.desiredOutcome.trim()) &&
    !running;

  const progressCopy = progressLabel(result, running);
  const shortlisted = useMemo(
    () =>
      result?.shortlist
        .map((item) => ({
          item,
          candidate:
            result.allCandidates.find((candidate) => candidate.index === item.index) ?? null,
        }))
        .filter((entry) => entry.candidate) ?? [],
    [result]
  );

  const topCandidates = useMemo(() => result?.allCandidates.slice(0, 6) ?? [], [result]);

  const handleStreamEvent = (event: OutreachFlowTournamentStreamEvent) => {
    if (event.type === "start") {
      setRunning(true);
      setProgressPercent(Math.max(8, event.progress));
      return;
    }

    if (event.type === "done") {
      setResult(event.result);
      setRunning(false);
      setProgressPercent(100);
      setError("");
      trackEvent("outreach_flow_tournament_ready", {
        brandId,
        shortlistCount: event.result.shortlist.length,
        acceptedCount: event.result.snapshot.accepted,
      });
      return;
    }

    setRunning(false);
    setProgressPercent(0);
    setError([event.message, event.hint].filter(Boolean).join(" ") || "Failed to run outreach tournament");
  };

  const runTournament = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError("");
    setRunning(true);
    setResult(null);
    setProgressPercent(8);
    setPlaceholderAgentIndex(0);

    try {
      await streamOutreachFlowTournamentApi(brandId, {
        ...preparedInput,
        signal: controller.signal,
        onEvent: handleStreamEvent,
      });
      trackEvent("outreach_flow_tournament_run", {
        brandId,
        target: preparedInput.target.slice(0, 120),
        desiredOutcome: preparedInput.desiredOutcome.slice(0, 120),
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setRunning(false);
      setProgressPercent(0);
      setError(err instanceof Error ? err.message : "Failed to run outreach tournament");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[color:var(--muted-foreground)]">
              Outreach-flow arena
            </p>
            <h3 className="text-base font-semibold text-[color:var(--foreground)]">
              {progressCopy.title}
            </h3>
            <p className="max-w-3xl text-sm leading-6 text-[color:var(--muted-foreground)]">
              {progressCopy.detail}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="accent">Reply-first</Badge>
            <Badge variant="muted">Identity-led</Badge>
            <Badge variant="muted">Bridge aware</Badge>
            {result ? (
              <Badge variant="success">
                {result.snapshot.accepted} accepted / {result.snapshot.ideas} reviewed
              </Badge>
            ) : null}
          </div>
        </div>

        {running ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
              <span>{PLACEHOLDER_AGENTS[placeholderAgentIndex]?.name ?? "Arena"}</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full border border-[color:var(--border)] bg-[color:var(--surface)]">
              <div
                className={cn(
                  "h-full rounded-full bg-[color:var(--accent)] transition-[width] duration-500",
                  TURN_EASE
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        ) : null}
      </section>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(320px,0.88fr)_minmax(0,1.12fr)]">
        <div className="space-y-4 rounded-[22px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 md:p-5">
          <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  Brief
                </p>
                <h4 className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                  Tell the arena who to move and where to land them
                </h4>
              </div>
              {brand ? <Badge variant="muted">{brand.name}</Badge> : null}
            </div>

            <div className="mt-4 grid gap-4">
              <FormField
                label="Target"
                hint="Describe the role, company type, and immediate context the openers should aim at."
              >
                <Textarea
                  value={form.target}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, target: event.target.value }))
                  }
                  placeholder="CMO at an upscale hotel brand with a dated website and weak direct-booking experience"
                  rows={4}
                />
              </FormField>

              <FormField
                label="Desired endpoint"
                hint="State the commercial place the thread should arrive at after the natural bridge."
              >
                <Textarea
                  value={form.desiredOutcome}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      desiredOutcome: event.target.value,
                    }))
                  }
                  placeholder="Get them into an async thread that naturally leads to a website strategy call"
                  rows={3}
                />
              </FormField>

              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Offer">
                  <Input
                    value={form.offer}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, offer: event.target.value }))
                    }
                    placeholder={brand?.product || brand?.name || "Underlying offer"}
                  />
                </FormField>
                <FormField label="Channel">
                  <Input
                    value={form.channel}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, channel: event.target.value }))
                    }
                    placeholder="email"
                  />
                </FormField>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <FormField label="Turns Before CTA">
                  <Input
                    type="number"
                    min={1}
                    max={8}
                    value={form.maxTurnsBeforeCTA}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        maxTurnsBeforeCTA: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="Agents">
                  <Input
                    type="number"
                    min={1}
                    max={6}
                    value={form.agentCount}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, agentCount: event.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Ideas Per Agent">
                  <Input
                    type="number"
                    min={1}
                    max={4}
                    value={form.ideasPerAgent}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, ideasPerAgent: event.target.value }))
                    }
                  />
                </FormField>
              </div>
            </div>
          </div>

          <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
            <div className="grid gap-4">
              <FormField
                label="Available personas"
                hint="One per line. These should be real roles your team can actually operate."
              >
                <Textarea
                  value={form.availablePersonas}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      availablePersonas: event.target.value,
                    }))
                  }
                  rows={5}
                />
              </FormField>

              <FormField
                label="Available assets"
                hint="One per line. These are the proof points or containers that make the persona believable."
              >
                <Textarea
                  value={form.availableAssets}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      availableAssets: event.target.value,
                    }))
                  }
                  rows={5}
                />
              </FormField>

              <FormField label="Constraints">
                <Textarea
                  value={form.constraints}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, constraints: event.target.value }))
                  }
                  rows={4}
                />
              </FormField>

              <FormField label="Quality bar">
                <Textarea
                  value={form.qualityBar}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, qualityBar: event.target.value }))
                  }
                  rows={4}
                />
              </FormField>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="button" disabled={!canRun} onClick={runTournament}>
                <Sparkles className={`h-4 w-4 ${running ? "motion-safe:animate-pulse" : ""}`} />
                {running ? "Running arena..." : "Run outreach tournament"}
              </Button>
              {running ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    controllerRef.current?.abort();
                    setRunning(false);
                    setProgressPercent(0);
                  }}
                >
                  Stop
                </Button>
              ) : result ? (
                <Button type="button" variant="outline" onClick={runTournament}>
                  <RefreshCcw className="h-4 w-4" />
                  Rerun
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-[22px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 md:p-5">
          {running ? (
            <>
              <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                      Arena board
                    </p>
                    <h4 className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                      The agents are still claiming territory
                    </h4>
                  </div>
                  <Badge variant="accent">Live</Badge>
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
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-[90%] rounded-[18px] border border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] px-4 py-3">
                      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--foreground)]">
                        <WandSparkles className="h-3.5 w-3.5 motion-safe:animate-pulse" />
                        {PLACEHOLDER_AGENTS[placeholderAgentIndex]?.name ?? "Agent"}
                      </div>
                      <p className="text-sm leading-6 text-[color:var(--foreground)]">
                        Drafting identity-led openers that feel worth replying to before the real
                        offer enters the frame.
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <div className="max-w-[90%] rounded-[18px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3">
                      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--danger)]">
                        <UserRound className="h-3.5 w-3.5" />
                        Judge pressure
                      </div>
                      <p className="text-sm leading-6 text-[color:var(--danger)]">
                        If the opener feels like disguised cold outreach or the bridge looks staged,
                        it gets cut.
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
                        The winner must survive reply pull, persona credibility, and bridge quality
                        at the same time.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : result ? (
            <>
              <div className="space-y-3">
                {shortlisted.map(({ item, candidate }, index) =>
                  candidate ? (
                    <article
                      key={`${item.index}:${item.title}`}
                      className="rounded-[20px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-4 shadow-[0_18px_48px_-30px_color-mix(in_srgb,var(--shadow)_55%,transparent)] md:px-5"
                    >
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="accent">Shortlist #{index + 1}</Badge>
                          <Badge variant={candidateTone(candidate)}>{candidateLabel(candidate)}</Badge>
                          {item.category ? <Badge variant="muted">{item.category}</Badge> : null}
                        </div>

                        <div className="space-y-2">
                          <h4 className="text-lg font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
                            {item.title}
                          </h4>
                          <p className="text-sm leading-6 text-[color:var(--foreground)]">
                            {item.pitch}
                          </p>
                          <p className="text-sm leading-6 text-[color:var(--muted-foreground)]">
                            {item.note}
                          </p>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-2">
                          <DetailField label="Persona" value={candidate.persona} />
                          <DetailField label="Entry Vehicle" value={candidate.entryVehicle} />
                          <DetailField label="Opener" value={candidate.openerBody} />
                          <DetailField label="Why They Reply" value={candidate.whyReply} />
                          <DetailField label="Bridge" value={candidate.bridgeMoment} />
                          <DetailField label="CTA" value={candidate.cta} />
                        </div>

                        <div className="grid gap-3 lg:grid-cols-2">
                          {findBranch(candidate, "positive") ? (
                            <DetailField
                              label="Positive Branch"
                              value={findBranch(candidate, "positive")?.response || ""}
                            />
                          ) : null}
                          {findBranch(candidate, "skeptical") ? (
                            <DetailField
                              label="Skeptical Branch"
                              value={findBranch(candidate, "skeptical")?.response || ""}
                            />
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ) : null
                )}
              </div>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                    Manager pressure
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                    {result.pressureSummary}
                  </p>
                </div>
                <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                    Useful denial
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                    {result.strongestUsefulDenial || "No additional denial came back from the manager."}
                  </p>
                </div>
              </section>

              <section className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                      Agent board
                    </p>
                    <h4 className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                      Who found useful territory
                    </h4>
                  </div>
                  <Badge variant="muted">
                    {result.snapshot.agents} agents / {result.snapshot.ideas} ideas
                  </Badge>
                </div>

                <div className="mt-4 space-y-2">
                  {result.turns.map((turn, index) => (
                    <div
                      key={`${turn.agentId}:${turn.agentName}`}
                      className="rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="muted">Turn {index + 1}</Badge>
                            <Badge variant={turnAcceptedCount(turn) > 0 ? "accent" : "muted"}>
                              {turnAcceptedCount(turn)} kept
                            </Badge>
                          </div>
                          <p className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">
                            {turn.agentName}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                            {turn.brief}
                          </p>
                        </div>
                        {index < 3 ? (
                          <Badge variant={index === 0 ? "accent" : "muted"} className="gap-1">
                            <Trophy className="h-3.5 w-3.5" />
                            #{index + 1}
                          </Badge>
                        ) : null}
                      </div>

                      {turn.ideas[0] ? (
                        <div className="mt-3 rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3">
                          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                            Lead lane
                          </p>
                          <p className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">
                            {turn.ideas[0].title}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-[color:var(--foreground)]">
                            {turn.ideas[0].openerBody}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                      Candidate board
                    </p>
                    <h4 className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
                      All scored lanes
                    </h4>
                  </div>
                  <Badge variant="muted">Top {topCandidates.length}</Badge>
                </div>

                <div className="mt-4 space-y-3">
                  {topCandidates.map((candidate) => (
                    <article
                      key={`${candidate.index}:${candidate.title}`}
                      className="rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={candidateTone(candidate)}>{candidateLabel(candidate)}</Badge>
                        <Badge variant="muted">Reply {candidate.replyLikelihood}%</Badge>
                        <Badge variant="muted">Credibility {candidate.personaCredibility}%</Badge>
                        <Badge variant="muted">Bridge {candidate.bridgeQuality}%</Badge>
                        <Badge variant="muted">Risk {candidate.suspicionRisk}%</Badge>
                      </div>
                      <h5 className="mt-3 text-base font-semibold text-[color:var(--foreground)]">
                        {candidate.title}
                      </h5>
                      <p className="mt-1 text-sm leading-6 text-[color:var(--foreground)]">
                        {candidate.summary || candidate.rationale}
                      </p>
                      {candidate.risks[0] ? (
                        <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
                          Main pushback: {candidate.risks[0]}
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  What this tab does
                </p>
                <div className="mt-3 space-y-3 text-sm leading-6 text-[color:var(--foreground)]">
                  <p>
                    It does not write a cold email first. It chooses the opening environment first,
                    then pressure-tests whether that environment can survive a skeptical reply and
                    still bridge to the real offer.
                  </p>
                  <p>
                    The winners usually come from editorial, research, roundtable, or collaboration
                    frames that your team can actually support with real personas and assets.
                  </p>
                </div>
              </div>

              <div className="rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                  Ready-to-edit defaults
                </p>
                <div className="mt-3 space-y-3 text-sm leading-6 text-[color:var(--foreground)]">
                  <p>
                    Personas, assets, constraints, and scoring rules are already loaded with a safe
                    starting point. The only fields you need to set to run are the target and the
                    desired endpoint.
                  </p>
                  {brand ? (
                    <p className="text-[color:var(--muted-foreground)]">
                      Brand context loaded from <span className="font-medium text-[color:var(--foreground)]">{brand.name}</span>.
                      Default offer was seeded from the current brand profile.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
