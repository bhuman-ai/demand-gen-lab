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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-[color:var(--muted)]">{brandName} / Objectives</div>
          <h1 className="text-xl font-semibold text-[color:var(--foreground)]">{objective.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => persistObjective(objective)}
            disabled={saving}
            className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--foreground)]"
          >
            {saving ? "Saving..." : "Save"}
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
            className="text-xs text-[color:var(--accent)]"
          >
            Back to Campaigns
          </button>
        </div>
      </div>

      {error ? <div className="text-xs text-[color:var(--danger)]">{error}</div> : null}
      {savedAt ? <div className="text-xs text-[color:var(--success)]">Saved {savedAt}</div> : null}

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Objective definition</div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <div className="text-[11px] text-[color:var(--muted)]">Status</div>
            <select
              value={objective.status}
              onChange={(event) =>
                updateObjective({ status: event.target.value as Objective["status"] })
              }
              className="mt-2 h-9 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <div className="text-[11px] text-[color:var(--muted)]">Title</div>
            <input
              value={objective.title}
              onChange={(event) => updateObjective({ title: event.target.value })}
              className="mt-2 h-9 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
            />
          </div>
          <div className="md:col-span-3">
            <div className="text-[11px] text-[color:var(--muted)]">Goal</div>
            <input
              value={objective.goal}
              onChange={(event) => updateObjective({ goal: event.target.value })}
              className="mt-2 h-9 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
            />
          </div>
          <div className="md:col-span-3">
            <div className="text-[11px] text-[color:var(--muted)]">Constraints</div>
            <textarea
              value={objective.constraints}
              onChange={(event) => updateObjective({ constraints: event.target.value })}
              className="mt-2 h-20 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2 text-xs text-[color:var(--foreground)]"
            />
          </div>
          <div className="md:col-span-3">
            <div className="text-[11px] text-[color:var(--muted)]">Scoring weights</div>
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
              C = conversion likelihood, Q = reply quality/intent, R = reply rate. Higher C is recommended.
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-[color:var(--muted)]">Hypotheses</div>
            <div className="flex items-center gap-3 text-[11px] text-[color:var(--muted)]">
              <button type="button" onClick={() => addHypothesis()} className="text-[color:var(--accent)]">
                Add
              </button>
              <button
                type="button"
                onClick={loadSuggestions}
                className="text-[color:var(--muted)]"
                disabled={suggestionsLoading}
              >
                {suggestionsLoading ? "Thinking..." : "Regenerate"}
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {objective.hypotheses.map((hypothesis, index) => (
              <div
                key={hypothesis.id}
                className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]/40 px-3 py-3"
              >
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <input
                    value={hypothesis.title}
                    onChange={(event) => updateHypothesis(index, { title: event.target.value })}
                    className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                  />
                  <button
                    type="button"
                    onClick={() => removeHypothesis(index)}
                    className="rounded-md border border-[color:var(--border)] px-3 py-2 text-[11px] text-[color:var(--danger)]"
                  >
                    Delete
                  </button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <input
                    value={hypothesis.channel}
                    onChange={(event) => updateHypothesis(index, { channel: event.target.value })}
                    placeholder="Channel"
                    className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                  />
                  <input
                    value={hypothesis.actorQuery ?? ""}
                    onChange={(event) => updateHypothesis(index, { actorQuery: event.target.value })}
                    placeholder="Apify actor query"
                    className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                  />
                </div>
                <textarea
                  value={hypothesis.rationale}
                  onChange={(event) => updateHypothesis(index, { rationale: event.target.value })}
                  placeholder="Rationale"
                  className="mt-3 h-20 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2 text-xs text-[color:var(--foreground)]"
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
                  className="mt-3 h-20 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2 text-xs text-[color:var(--foreground)]"
                />
                <div className="mt-3 flex items-center justify-between text-[11px] text-[color:var(--muted)]">
                  <span>
                    {
                      objective.experiments.filter(
                        (experiment) => experiment.hypothesisId === hypothesis.id
                      ).length
                    }{" "}
                    experiments linked
                  </span>
                  <button
                    type="button"
                    onClick={() => addExperimentsForHypothesis(hypothesis)}
                    className="text-[11px] text-[color:var(--accent)]"
                  >
                    Generate 3 experiments
                  </button>
                </div>
              </div>
            ))}
            {!objective.hypotheses.length ? (
              <div className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-4 text-xs text-[color:var(--muted)]">
                No hypotheses yet. Generate suggestions or add one manually.
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-[color:var(--muted)]">Hypothesis suggestions</div>
            <button
              type="button"
              onClick={loadSuggestions}
              disabled={suggestionsLoading}
              className="text-[11px] text-[color:var(--muted)]"
            >
              {suggestionsLoading ? "Thinking..." : "Refresh"}
            </button>
          </div>
          {suggestionsError ? <div className="mt-3 text-xs text-[color:var(--danger)]">{suggestionsError}</div> : null}
          <div className="mt-4 grid gap-3">
            {suggestions.map((idea) => (
              <div
                key={idea.title}
                className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/40 px-3 py-3"
              >
                <div className="text-sm text-[color:var(--foreground)]">{idea.title}</div>
                <div className="mt-2 text-[11px] text-[color:var(--muted)]">{idea.channel}</div>
                <div className="text-xs text-[color:var(--foreground)]">{idea.rationale}</div>
                <div className="mt-2 text-[11px] text-[color:var(--muted)]">Actor query</div>
                <div className="text-xs text-[color:var(--foreground)]">{idea.actorQuery || "—"}</div>
                <div className="mt-3 flex items-center justify-between text-[11px] text-[color:var(--muted)]">
                  <span>{(idea.seedInputs || []).length} seeds</span>
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
                    className="text-[11px] text-[color:var(--accent)]"
                  >
                    Add
                  </button>
                </div>
              </div>
            ))}
            {!suggestions.length && !suggestionsLoading ? (
              <div className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-4 text-xs text-[color:var(--muted)]">
                No suggestions yet. Add objective details and click Refresh.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-[color:var(--muted)]">Experiments</div>
            <div className="flex items-center gap-3 text-[11px] text-[color:var(--muted)]">
              <button type="button" onClick={() => addExperiment({ hypothesisId: "" })} className="text-[color:var(--accent)]">
                Add unlinked
              </button>
              <button type="button" onClick={generateExperiments} className="text-[color:var(--muted)]">
                Generate variants for all
              </button>
            </div>
          </div>
          <div className="mt-4 space-y-4">
            {groupedExperiments.map(({ hypothesis, experiments }) => (
              <div
                key={hypothesis.id}
                className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]/35 px-3 py-3"
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs text-[color:var(--foreground)]">{hypothesis.title}</div>
                  <div className="flex items-center gap-3 text-[11px] text-[color:var(--muted)]">
                    <span>{experiments.length} experiments</span>
                    <button
                      type="button"
                      onClick={() => addExperimentsForHypothesis(hypothesis)}
                      className="text-[color:var(--accent)]"
                    >
                      Generate 3
                    </button>
                    <button
                      type="button"
                      onClick={() => addExperiment({ hypothesisId: hypothesis.id })}
                      className="text-[color:var(--accent)]"
                    >
                      Add
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3">
                  {experiments.map((experiment) => (
                    <div
                      key={experiment.id}
                      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]/50 px-3 py-3"
                    >
                      <div className="grid gap-3 md:grid-cols-[1.2fr_auto_auto_auto]">
                        <input
                          value={experiment.name}
                          onChange={(event) => updateExperiment(experiment.id, { name: event.target.value })}
                          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                        />
                        <select
                          value={experiment.hypothesisId ?? ""}
                          onChange={(event) =>
                            updateExperiment(experiment.id, { hypothesisId: event.target.value })
                          }
                          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                        >
                          <option value="">Unlinked</option>
                          {objective.hypotheses.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </select>
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
                        <button
                          type="button"
                          onClick={() => removeExperiment(experiment.id)}
                          className="rounded-md border border-[color:var(--border)] px-3 py-2 text-[11px] text-[color:var(--danger)]"
                        >
                          Delete
                        </button>
                      </div>
                      <textarea
                        value={experiment.notes ?? ""}
                        onChange={(event) => updateExperiment(experiment.id, { notes: event.target.value })}
                        placeholder="Notes or delivery constraints"
                        className="mt-3 h-20 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2 text-xs text-[color:var(--foreground)]"
                      />
                    </div>
                  ))}
                  {!experiments.length ? (
                    <div className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-3 text-xs text-[color:var(--muted)]">
                      No experiments for this hypothesis yet.
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {unlinkedExperiments.length ? (
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]/35 px-3 py-3">
                <div className="text-xs text-[color:var(--foreground)]">Unlinked experiments</div>
                <div className="mt-3 grid gap-3">
                  {unlinkedExperiments.map((experiment) => (
                    <div
                      key={experiment.id}
                      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]/50 px-3 py-3"
                    >
                      <div className="grid gap-3 md:grid-cols-[1.2fr_auto_auto_auto]">
                        <input
                          value={experiment.name}
                          onChange={(event) => updateExperiment(experiment.id, { name: event.target.value })}
                          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                        />
                        <select
                          value={experiment.hypothesisId ?? ""}
                          onChange={(event) =>
                            updateExperiment(experiment.id, { hypothesisId: event.target.value })
                          }
                          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                        >
                          <option value="">Unlinked</option>
                          {objective.hypotheses.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </select>
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
                        <button
                          type="button"
                          onClick={() => removeExperiment(experiment.id)}
                          className="rounded-md border border-[color:var(--border)] px-3 py-2 text-[11px] text-[color:var(--danger)]"
                        >
                          Delete
                        </button>
                      </div>
                      <textarea
                        value={experiment.notes ?? ""}
                        onChange={(event) => updateExperiment(experiment.id, { notes: event.target.value })}
                        placeholder="Notes or delivery constraints"
                        className="mt-3 h-20 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2 text-xs text-[color:var(--foreground)]"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {!objective.experiments.length ? (
              <div className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-4 text-xs text-[color:var(--muted)]">
                No experiments yet. Generate variants from hypotheses or add one manually.
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-[color:var(--muted)]">Evolution</div>
            <div className="flex items-center gap-3 text-[11px] text-[color:var(--muted)]">
              <button type="button" onClick={generateEvolution} className="text-[color:var(--muted)]">
                Generate from experiments
              </button>
              <button type="button" onClick={() => addEvolution()} className="text-[color:var(--accent)]">
                Add snapshot
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {objective.evolution.map((snapshot, index) => (
              <div
                key={snapshot.id}
                className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]/40 px-3 py-3"
              >
                <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
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
                    className="rounded-md border border-[color:var(--border)] px-3 py-2 text-[11px] text-[color:var(--danger)]"
                  >
                    Delete
                  </button>
                </div>
                <textarea
                  value={snapshot.summary}
                  onChange={(event) => updateEvolution(index, { summary: event.target.value })}
                  placeholder="Why this won or failed"
                  className="mt-3 h-20 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2 text-xs text-[color:var(--foreground)]"
                />
              </div>
            ))}
            {!objective.evolution.length ? (
              <div className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-4 text-xs text-[color:var(--muted)]">
                No evolution snapshots yet. Add a snapshot when experiments start producing signal.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
