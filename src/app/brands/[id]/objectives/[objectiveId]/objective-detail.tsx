"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Hypothesis = {
  id: string;
  title: string;
  channel: string;
  rationale: string;
  actorQuery?: string;
  seedInputs?: string[];
};

type Experiment = {
  id: string;
  hypothesisId?: string;
  name: string;
  status: string;
  notes?: string;
};

type EvolutionSnapshot = {
  id: string;
  title: string;
  summary: string;
  status: string;
};

type Objective = {
  id: string;
  title: string;
  status: "draft" | "active" | "paused";
  goal: string;
  constraints: string;
  scoring: {
    replyWeight: number;
    conversionWeight: number;
    qualityWeight: number;
  };
  hypotheses: Hypothesis[];
  experiments: Experiment[];
  evolution: EvolutionSnapshot[];
  createdAt: string;
  updatedAt: string;
};

type ObjectiveDetailProps = {
  brandId: string;
  brandName: string;
  website?: string;
  tone?: string;
  targetBuyers?: string;
  offers?: string;
  proof?: string;
  objectives: Objective[];
  initialObjective: Objective;
};

type IdeaSuggestion = {
  title: string;
  channel: string;
  rationale: string;
  actorQuery?: string;
  seedInputs?: string[];
};

const ACTIVE_BRAND_KEY = "factory.activeBrandId";

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

export default function ObjectiveDetail({
  brandId,
  brandName,
  website,
  tone,
  targetBuyers,
  offers,
  proof,
  objectives,
  initialObjective,
}: ObjectiveDetailProps) {
  const router = useRouter();
  const normalizedScoring = initialObjective.scoring ?? {
    replyWeight: 0.3,
    conversionWeight: 0.6,
    qualityWeight: 0.1,
  };
  const [objective, setObjective] = useState<Objective>({
    ...initialObjective,
    id: initialObjective.id || createId(),
    title: initialObjective.title || "Untitled objective",
    status: initialObjective.status ?? "draft",
    goal: initialObjective.goal ?? "",
    constraints: initialObjective.constraints ?? "",
    createdAt: initialObjective.createdAt ?? new Date().toISOString(),
    updatedAt: initialObjective.updatedAt ?? new Date().toISOString(),
    scoring: normalizedScoring,
    hypotheses: initialObjective.hypotheses ?? [],
    experiments: initialObjective.experiments ?? [],
    evolution: initialObjective.evolution ?? [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [suggestions, setSuggestions] = useState<IdeaSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined" && brandId) {
      localStorage.setItem(ACTIVE_BRAND_KEY, brandId);
    }
  }, [brandId]);

  const updateObjective = (patch: Partial<Objective>) => {
    setObjective((prev) => ({
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    }));
  };

  const persistObjective = useCallback(
    async (nextObjective: Objective) => {
      setSaving(true);
      setError("");
      setSavedAt("");
      const exists = objectives.some((item) => item.id === nextObjective.id);
      const nextObjectives = exists
        ? objectives.map((item) => (item.id === nextObjective.id ? nextObjective : item))
        : [nextObjective, ...objectives];
      try {
        const response = await fetch("/api/brands", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: brandId, objectives: nextObjectives }),
        });
        const data = await response.json();
        if (!response.ok) {
          setError(data?.error ?? "Save failed");
        } else {
          setSavedAt(new Date().toLocaleTimeString());
        }
      } catch {
        setError("Save failed");
      } finally {
        setSaving(false);
      }
    },
    [brandId, objectives]
  );

  const removeObjective = async () => {
    setSaving(true);
    setError("");
    const nextObjectives = objectives.filter((item) => item.id !== objective.id);
    try {
      const response = await fetch("/api/brands", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: brandId, objectives: nextObjectives }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "Delete failed");
      } else {
        router.push(`/brands/${brandId}/campaigns`);
      }
    } catch {
      setError("Delete failed");
    } finally {
      setSaving(false);
    }
  };

  const loadSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    setSuggestionsError("");
    try {
      const response = await fetch("/api/strategy/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: objective.goal || "Generate outreach hypotheses",
          existingIdeas: objective.hypotheses,
          context: {
            brandName,
            website,
            tone,
            targetBuyers: targetBuyers ?? "",
            offers: offers ?? "",
            proof: proof ?? "",
          },
          needs: {
            objectiveTitle: objective.title,
            objectiveGoal: objective.goal,
            objectiveConstraints: objective.constraints,
          },
          constraints: {
            scoring: objective.scoring,
            status: objective.status,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setSuggestionsError(data?.error ?? "Hypothesis generation failed");
        setSuggestions([]);
        return;
      }
      const next = Array.isArray(data?.ideas) ? (data.ideas as IdeaSuggestion[]) : [];
      setSuggestions(next);
      if (!next.length) {
        setSuggestionsError("No objective-aligned hypotheses returned.");
      }
    } catch {
      setSuggestionsError("Hypothesis generation failed");
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [
    brandName,
    objective.constraints,
    objective.goal,
    objective.hypotheses,
    objective.scoring,
    objective.status,
    objective.title,
    offers,
    proof,
    targetBuyers,
    tone,
    website,
  ]);

  useEffect(() => {
    if (!objective.hypotheses.length) {
      loadSuggestions();
    }
  }, [objective.hypotheses.length, loadSuggestions]);

  const addHypothesis = (hypothesis?: Partial<Hypothesis>) => {
    const next: Hypothesis = {
      id: createId(),
      title: hypothesis?.title ?? "New hypothesis",
      channel: hypothesis?.channel ?? "",
      rationale: hypothesis?.rationale ?? "",
      actorQuery: hypothesis?.actorQuery ?? "",
      seedInputs: hypothesis?.seedInputs ?? [],
    };
    updateObjective({ hypotheses: [next, ...objective.hypotheses] });
  };

  const updateHypothesis = (index: number, patch: Partial<Hypothesis>) => {
    const next = [...objective.hypotheses];
    next[index] = { ...next[index], ...patch };
    updateObjective({ hypotheses: next });
  };

  const removeHypothesis = (index: number) => {
    const target = objective.hypotheses[index];
    const nextHypotheses = objective.hypotheses.filter((_, idx) => idx !== index);
    const nextExperiments = target
      ? objective.experiments.filter((experiment) => experiment.hypothesisId !== target.id)
      : objective.experiments;
    updateObjective({ hypotheses: nextHypotheses, experiments: nextExperiments });
  };

  const addExperiment = (experiment?: Partial<Experiment>) => {
    const next: Experiment = {
      id: createId(),
      hypothesisId: experiment?.hypothesisId ?? "",
      name: experiment?.name ?? "New experiment",
      status: experiment?.status ?? "draft",
      notes: experiment?.notes ?? "",
    };
    updateObjective({ experiments: [next, ...objective.experiments] });
  };

  const updateExperiment = (experimentId: string, patch: Partial<Experiment>) => {
    const next = objective.experiments.map((experiment) =>
      experiment.id === experimentId ? { ...experiment, ...patch } : experiment
    );
    updateObjective({ experiments: next });
  };

  const removeExperiment = (experimentId: string) => {
    const next = objective.experiments.filter((experiment) => experiment.id !== experimentId);
    updateObjective({ experiments: next });
  };

  const buildExperimentVariants = (hypothesis: Hypothesis) => {
    const channel = (hypothesis.channel || "outbound").toLowerCase();
    const existingNames = new Set(
      objective.experiments
        .filter((experiment) => experiment.hypothesisId === hypothesis.id)
        .map((experiment) => experiment.name.toLowerCase())
    );
    const variants: Array<{ suffix: string; notes: string }> = [
      {
        suffix: "Hook-first",
        notes: `Lead with a sharp ${channel} hook tied to ${hypothesis.title}. CTA: quick discovery call.`,
      },
      {
        suffix: "Proof-first",
        notes: `Open with proof and measurable outcomes. Emphasize ${hypothesis.rationale}. CTA: pilot proposal.`,
      },
      {
        suffix: "Pain-first",
        notes: `Start from buyer pain and urgency. Use ${hypothesis.actorQuery || "targeted lead pull"} for inputs.`,
      },
    ];
    return variants
      .map((variant) => {
        const name = `Experiment: ${hypothesis.title} / ${variant.suffix}`;
        return {
          id: createId(),
          hypothesisId: hypothesis.id,
          name,
          status: "draft",
          notes: variant.notes,
        } as Experiment;
      })
      .filter((experiment) => !existingNames.has(experiment.name.toLowerCase()));
  };

  const addExperimentsForHypothesis = (hypothesis: Hypothesis) => {
    const variants = buildExperimentVariants(hypothesis);
    if (!variants.length) {
      return;
    }
    updateObjective({ experiments: [...variants, ...objective.experiments] });
  };

  const generateExperiments = () => {
    if (!objective.hypotheses.length) {
      return;
    }
    const variants = objective.hypotheses.flatMap((hypothesis) => buildExperimentVariants(hypothesis));
    if (!variants.length) {
      return;
    }
    updateObjective({ experiments: [...variants, ...objective.experiments] });
  };

  const addEvolution = (snapshot?: Partial<EvolutionSnapshot>) => {
    const next: EvolutionSnapshot = {
      id: createId(),
      title: snapshot?.title ?? "Evolution snapshot",
      summary: snapshot?.summary ?? "",
      status: snapshot?.status ?? "observing",
    };
    updateObjective({ evolution: [next, ...objective.evolution] });
  };

  const updateEvolution = (index: number, patch: Partial<EvolutionSnapshot>) => {
    const next = [...objective.evolution];
    next[index] = { ...next[index], ...patch };
    updateObjective({ evolution: next });
  };

  const removeEvolution = (index: number) => {
    const next = objective.evolution.filter((_, idx) => idx !== index);
    updateObjective({ evolution: next });
  };

  const generateEvolution = () => {
    if (!objective.experiments.length) {
      return;
    }
    const snapshots = objective.experiments.map((experiment) => ({
      id: createId(),
      title: `Evolution: ${experiment.name}`,
      summary: experiment.notes ?? "",
      status: experiment.status === "scaling" ? "winner" : "observing",
    }));
    updateObjective({ evolution: [...snapshots, ...objective.evolution] });
  };

  const groupedExperiments = objective.hypotheses.map((hypothesis) => ({
    hypothesis,
    experiments: objective.experiments.filter((experiment) => experiment.hypothesisId === hypothesis.id),
  }));

  const unlinkedExperiments = objective.experiments.filter(
    (experiment) =>
      !experiment.hypothesisId || !objective.hypotheses.some((hypothesis) => hypothesis.id === experiment.hypothesisId)
  );

  const activeExperimentCount = objective.experiments.filter((experiment) =>
    ["testing", "scaling"].includes(experiment.status)
  ).length;
  const winnerCount = objective.evolution.filter((snapshot) => snapshot.status === "winner").length;

  const renderExperimentEditor = (experiment: Experiment) => (
    <div
      key={experiment.id}
      className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/45 px-3 py-3"
    >
      <div className="grid gap-2 md:grid-cols-[1.1fr_130px_180px_auto]">
        <input
          value={experiment.name}
          onChange={(event) => updateExperiment(experiment.id, { name: event.target.value })}
          placeholder="Experiment name"
          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
        />
        <select
          value={experiment.status}
          onChange={(event) => updateExperiment(experiment.id, { status: event.target.value })}
          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
        >
          <option value="draft">Draft</option>
          <option value="testing">Testing</option>
          <option value="scaling">Scaling</option>
          <option value="paused">Paused</option>
        </select>
        <select
          value={experiment.hypothesisId ?? ""}
          onChange={(event) => updateExperiment(experiment.id, { hypothesisId: event.target.value })}
          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
        >
          <option value="">Unlinked</option>
          {objective.hypotheses.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => removeExperiment(experiment.id)}
          className="h-9 rounded-md border border-[color:var(--border)] px-3 text-[11px] text-[color:var(--danger)]"
        >
          Delete
        </button>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-[color:var(--muted)]">Notes</summary>
        <textarea
          value={experiment.notes ?? ""}
          onChange={(event) => updateExperiment(experiment.id, { notes: event.target.value })}
          placeholder="Notes, message angle, execution constraints."
          className="mt-2 h-20 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2 text-xs text-[color:var(--foreground)]"
        />
      </details>
    </div>
  );

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs text-[color:var(--muted)]">{brandName} / Objective workspace</div>
            <h1 className="mt-1 text-xl font-semibold text-[color:var(--foreground)]">{objective.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => persistObjective(objective)}
              disabled={saving}
              className="rounded-md border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-3 py-2 text-xs text-[color:var(--foreground)]"
            >
              {saving ? "Saving..." : "Save Objective"}
            </button>
            <button
              type="button"
              onClick={removeObjective}
              className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--danger)]"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => router.push(`/brands/${brandId}/campaigns`)}
              className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--muted)]"
            >
              Back
            </button>
          </div>
        </div>
        {error ? <div className="mt-3 text-xs text-[color:var(--danger)]">{error}</div> : null}
        {savedAt ? <div className="mt-3 text-xs text-[color:var(--success)]">Saved {savedAt}</div> : null}
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <a href="#objective" className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/45 px-3 py-2 text-xs">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">Step 1</div>
            <div className="mt-1 text-[color:var(--foreground)]">Objective</div>
          </a>
          <a href="#hypotheses" className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/45 px-3 py-2 text-xs">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">Step 2</div>
            <div className="mt-1 text-[color:var(--foreground)]">Hypotheses ({objective.hypotheses.length})</div>
          </a>
          <a href="#experiments" className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/45 px-3 py-2 text-xs">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">Step 3</div>
            <div className="mt-1 text-[color:var(--foreground)]">
              Experiments ({objective.experiments.length}) / Active ({activeExperimentCount})
            </div>
          </a>
          <a href="#evolution" className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/45 px-3 py-2 text-xs">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted)]">Step 4</div>
            <div className="mt-1 text-[color:var(--foreground)]">Evolution ({objective.evolution.length}) / Winners ({winnerCount})</div>
          </a>
        </div>
      </section>

      <section id="objective" className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">1. Objective setup</div>
        <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr]">
          <div>
            <div className="text-[11px] text-[color:var(--muted)]">Status</div>
            <select
              value={objective.status}
              onChange={(event) => updateObjective({ status: event.target.value as Objective["status"] })}
              className="mt-2 h-9 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </div>
          <div>
            <div className="text-[11px] text-[color:var(--muted)]">Title</div>
            <input
              value={objective.title}
              onChange={(event) => updateObjective({ title: event.target.value })}
              className="mt-2 h-9 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
            />
          </div>
          <div className="md:col-span-2">
            <div className="text-[11px] text-[color:var(--muted)]">Goal</div>
            <textarea
              value={objective.goal}
              onChange={(event) => updateObjective({ goal: event.target.value })}
              className="mt-2 h-16 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2 text-xs text-[color:var(--foreground)]"
            />
          </div>
          <div className="md:col-span-2">
            <div className="text-[11px] text-[color:var(--muted)]">Constraints</div>
            <textarea
              value={objective.constraints}
              onChange={(event) => updateObjective({ constraints: event.target.value })}
              className="mt-2 h-16 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2 text-xs text-[color:var(--foreground)]"
            />
          </div>
        </div>
        <div className="mt-4">
          <div className="text-[11px] text-[color:var(--muted)]">Scoring weights (C/Q/R)</div>
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            <label className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 py-2 text-xs text-[color:var(--foreground)]">
              <div className="text-[10px] text-[color:var(--muted)]">Conversion (C)</div>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={objective.scoring.conversionWeight}
                onChange={(event) =>
                  updateObjective({
                    scoring: {
                      ...objective.scoring,
                      conversionWeight: Number(event.target.value || 0),
                    },
                  })
                }
                className="mt-2 h-9 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/40 px-2 text-xs"
              />
            </label>
            <label className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 py-2 text-xs text-[color:var(--foreground)]">
              <div className="text-[10px] text-[color:var(--muted)]">Reply Quality (Q)</div>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={objective.scoring.qualityWeight}
                onChange={(event) =>
                  updateObjective({
                    scoring: {
                      ...objective.scoring,
                      qualityWeight: Number(event.target.value || 0),
                    },
                  })
                }
                className="mt-2 h-9 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/40 px-2 text-xs"
              />
            </label>
            <label className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 py-2 text-xs text-[color:var(--foreground)]">
              <div className="text-[10px] text-[color:var(--muted)]">Reply Rate (R)</div>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={objective.scoring.replyWeight}
                onChange={(event) =>
                  updateObjective({
                    scoring: {
                      ...objective.scoring,
                      replyWeight: Number(event.target.value || 0),
                    },
                  })
                }
                className="mt-2 h-9 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/40 px-2 text-xs"
              />
            </label>
          </div>
          <div className="mt-2 text-[11px] text-[color:var(--muted)]">
            C = conversion likelihood, Q = reply quality/intent, R = reply rate.
          </div>
        </div>
      </section>

      <section id="hypotheses" className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs text-[color:var(--muted)]">2. Hypotheses</div>
              <div className="text-[11px] text-[color:var(--muted)]">Define testable approaches before building experiments.</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => addHypothesis()}
                className="rounded-md border border-[color:var(--border)] px-3 py-2 text-[11px] text-[color:var(--foreground)]"
              >
                Add manual
              </button>
              <button
                type="button"
                onClick={loadSuggestions}
                disabled={suggestionsLoading}
                className="rounded-md border border-[color:var(--border)] px-3 py-2 text-[11px] text-[color:var(--muted)]"
              >
                {suggestionsLoading ? "Generating..." : "Regenerate ideas"}
              </button>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {objective.hypotheses.map((hypothesis, index) => {
              const linkedCount = objective.experiments.filter((experiment) => experiment.hypothesisId === hypothesis.id).length;
              return (
                <div
                  key={hypothesis.id}
                  className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/45 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={hypothesis.title}
                      onChange={(event) => updateHypothesis(index, { title: event.target.value })}
                      placeholder="Hypothesis title"
                      className="h-9 min-w-[220px] flex-1 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                    />
                    <input
                      value={hypothesis.channel}
                      onChange={(event) => updateHypothesis(index, { channel: event.target.value })}
                      placeholder="Channel"
                      className="h-9 w-[150px] rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                    />
                    <span className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[10px] text-[color:var(--muted)]">
                      {linkedCount} experiments
                    </span>
                    <button
                      type="button"
                      onClick={() => addExperimentsForHypothesis(hypothesis)}
                      className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[10px] text-[color:var(--accent)]"
                    >
                      +3 variants
                    </button>
                    <button
                      type="button"
                      onClick={() => removeHypothesis(index)}
                      className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[10px] text-[color:var(--danger)]"
                    >
                      Delete
                    </button>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-[color:var(--muted)]">Details</summary>
                    <div className="mt-2 grid gap-2">
                      <input
                        value={hypothesis.actorQuery ?? ""}
                        onChange={(event) => updateHypothesis(index, { actorQuery: event.target.value })}
                        placeholder="Apify actor query"
                        className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                      />
                      <textarea
                        value={hypothesis.rationale}
                        onChange={(event) => updateHypothesis(index, { rationale: event.target.value })}
                        placeholder="Rationale"
                        className="h-16 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2 text-xs text-[color:var(--foreground)]"
                      />
                      <textarea
                        value={(hypothesis.seedInputs ?? []).join("\n")}
                        onChange={(event) =>
                          updateHypothesis(index, {
                            seedInputs: event.target.value
                              .split("\n")
                              .map((value) => value.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="Seed inputs (one per line)"
                        className="h-16 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2 text-xs text-[color:var(--foreground)]"
                      />
                    </div>
                  </details>
                </div>
              );
            })}
            {!objective.hypotheses.length ? (
              <div className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-4 text-xs text-[color:var(--muted)]">
                No hypotheses yet. Add one manually or use generated suggestions.
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-[color:var(--muted)]">Suggested hypotheses</div>
            <button
              type="button"
              onClick={loadSuggestions}
              disabled={suggestionsLoading}
              className="rounded-md border border-[color:var(--border)] px-3 py-2 text-[11px] text-[color:var(--muted)]"
            >
              {suggestionsLoading ? "..." : "Refresh"}
            </button>
          </div>
          {suggestionsError ? <div className="mt-3 text-xs text-[color:var(--danger)]">{suggestionsError}</div> : null}
          <div className="mt-3 space-y-3">
            {suggestions.map((idea) => (
              <div
                key={idea.title}
                className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/45 px-3 py-3"
              >
                <div className="text-sm text-[color:var(--foreground)]">{idea.title}</div>
                <div className="mt-1 text-[11px] text-[color:var(--muted)]">{idea.channel}</div>
                <div className="mt-2 text-xs text-[color:var(--foreground)]">{idea.rationale}</div>
                <div className="mt-2 text-[11px] text-[color:var(--muted)]">Actor query: {idea.actorQuery || "—"}</div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-[color:var(--muted)]">{(idea.seedInputs || []).length} seed inputs</span>
                  <button
                    type="button"
                    onClick={() =>
                      addHypothesis({
                        title: idea.title,
                        channel: idea.channel,
                        rationale: idea.rationale,
                        actorQuery: idea.actorQuery,
                        seedInputs: idea.seedInputs ?? [],
                      })
                    }
                    className="rounded-md border border-[color:var(--border)] px-3 py-1.5 text-[11px] text-[color:var(--accent)]"
                  >
                    Add to objective
                  </button>
                </div>
              </div>
            ))}
            {!suggestions.length && !suggestionsLoading ? (
              <div className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-4 text-xs text-[color:var(--muted)]">
                No suggestions yet. Click Refresh.
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section id="experiments" className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-[color:var(--muted)]">3. Experiments</div>
            <div className="text-[11px] text-[color:var(--muted)]">Each hypothesis can have multiple message variants.</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => addExperiment({ hypothesisId: "" })}
              className="rounded-md border border-[color:var(--border)] px-3 py-2 text-[11px] text-[color:var(--foreground)]"
            >
              Add unlinked
            </button>
            <button
              type="button"
              onClick={generateExperiments}
              className="rounded-md border border-[color:var(--border)] px-3 py-2 text-[11px] text-[color:var(--muted)]"
            >
              Generate all variants
            </button>
          </div>
        </div>
        <div className="mt-4 space-y-4">
          {groupedExperiments.map(({ hypothesis, experiments }) => (
            <div
              key={hypothesis.id}
              className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/35 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-[color:var(--foreground)]">{hypothesis.title}</div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[10px] text-[color:var(--muted)]">
                    {experiments.length} experiments
                  </span>
                  <button
                    type="button"
                    onClick={() => addExperimentsForHypothesis(hypothesis)}
                    className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[10px] text-[color:var(--accent)]"
                  >
                    Generate 3
                  </button>
                  <button
                    type="button"
                    onClick={() => addExperiment({ hypothesisId: hypothesis.id })}
                    className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[10px] text-[color:var(--accent)]"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {experiments.length ? experiments.map((experiment) => renderExperimentEditor(experiment)) : (
                  <div className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-3 text-xs text-[color:var(--muted)]">
                    No experiments under this hypothesis yet.
                  </div>
                )}
              </div>
            </div>
          ))}
          {unlinkedExperiments.length ? (
            <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/35 p-3">
              <div className="text-xs text-[color:var(--foreground)]">Unlinked experiments</div>
              <div className="mt-3 space-y-2">{unlinkedExperiments.map((experiment) => renderExperimentEditor(experiment))}</div>
            </div>
          ) : null}
          {!objective.experiments.length ? (
            <div className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-4 text-xs text-[color:var(--muted)]">
              No experiments yet. Generate variants from hypotheses.
            </div>
          ) : null}
        </div>
      </section>

      <section id="evolution" className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs text-[color:var(--muted)]">4. Evolution</div>
            <div className="text-[11px] text-[color:var(--muted)]">Capture outcomes and promote winners.</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={generateEvolution}
              className="rounded-md border border-[color:var(--border)] px-3 py-2 text-[11px] text-[color:var(--muted)]"
            >
              Generate from experiments
            </button>
            <button
              type="button"
              onClick={() => addEvolution()}
              className="rounded-md border border-[color:var(--border)] px-3 py-2 text-[11px] text-[color:var(--accent)]"
            >
              Add snapshot
            </button>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {objective.evolution.map((snapshot, index) => (
            <div
              key={snapshot.id}
              className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/45 px-3 py-3"
            >
              <div className="grid gap-2 md:grid-cols-[1fr_140px_auto]">
                <input
                  value={snapshot.title}
                  onChange={(event) => updateEvolution(index, { title: event.target.value })}
                  className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                />
                <select
                  value={snapshot.status}
                  onChange={(event) => updateEvolution(index, { status: event.target.value })}
                  className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                >
                  <option value="observing">Observing</option>
                  <option value="winner">Winner</option>
                  <option value="killed">Killed</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeEvolution(index)}
                  className="h-9 rounded-md border border-[color:var(--border)] px-3 text-[11px] text-[color:var(--danger)]"
                >
                  Delete
                </button>
              </div>
              <textarea
                value={snapshot.summary}
                onChange={(event) => updateEvolution(index, { summary: event.target.value })}
                placeholder="Why this won or failed"
                className="mt-2 h-16 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2 text-xs text-[color:var(--foreground)]"
              />
            </div>
          ))}
          {!objective.evolution.length ? (
            <div className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-4 text-xs text-[color:var(--muted)]">
              No snapshots yet. Promote results from experiments when data arrives.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
