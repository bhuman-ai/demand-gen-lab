"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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

type StrategyVariant = {
  title: string;
  goal: string;
  constraints: string;
  scoring: {
    replyWeight: number;
    conversionWeight: number;
    qualityWeight: number;
  };
};

type Brand = {
  id: string;
  brandName: string;
  website?: string;
  tone?: string;
  objectives?: Objective[];
};

const ACTIVE_BRAND_KEY = "factory.activeBrandId";

const fallbackVariants: StrategyVariant[] = [
  {
    title: "Founder-led outbound sprint",
    goal: "Book 10 founder-level discovery calls with operators already buying AI video.",
    constraints: "Personalized first-line, max 60 outbound/day, prioritize warm communities.",
    scoring: { replyWeight: 0.3, conversionWeight: 0.6, qualityWeight: 0.1 },
  },
  {
    title: "Creative ops wedge",
    goal: "Land 5 pilots with creative ops leads at high-velocity teams.",
    constraints: "Target weekly launch teams, proof + time-saved angle, 40 leads/day.",
    scoring: { replyWeight: 0.2, conversionWeight: 0.7, qualityWeight: 0.1 },
  },
  {
    title: "Agency partner channel",
    goal: "Recruit 3 agencies to resell AI personalized video as a service line.",
    constraints: "Video-focused agencies, 25 leads/day, partner pitch only.",
    scoring: { replyWeight: 0.2, conversionWeight: 0.6, qualityWeight: 0.2 },
  },
];

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
};

const createObjective = (input?: Partial<Objective>): Objective => ({
  id: createId(),
  title: input?.title ?? "New objective",
  status: input?.status ?? "draft",
  goal: input?.goal ?? "",
  constraints: input?.constraints ?? "",
  scoring: input?.scoring ?? {
    replyWeight: 0.3,
    conversionWeight: 0.6,
    qualityWeight: 0.1,
  },
  hypotheses: input?.hypotheses ?? [],
  experiments: input?.experiments ?? [],
  evolution: input?.evolution ?? [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export default function CampaignsClient({ brand }: { brand: Brand }) {
  const router = useRouter();
  const normalizeObjective = (objective: Objective): Objective => ({
    ...objective,
    id: objective.id || createId(),
    title: objective.title || "Untitled objective",
    status: objective.status ?? "draft",
    scoring: objective.scoring ?? {
      replyWeight: 0.3,
      conversionWeight: 0.6,
      qualityWeight: 0.1,
    },
    hypotheses: objective.hypotheses ?? [],
    experiments: objective.experiments ?? [],
    evolution: objective.evolution ?? [],
    createdAt: objective.createdAt ?? new Date().toISOString(),
    updatedAt: objective.updatedAt ?? new Date().toISOString(),
  });
  const [objectives, setObjectives] = useState<Objective[]>(
    Array.isArray(brand.objectives) ? brand.objectives.map(normalizeObjective) : []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [variants, setVariants] = useState<StrategyVariant[]>(fallbackVariants);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined" && brand.id) {
      localStorage.setItem(ACTIVE_BRAND_KEY, brand.id);
    }
  }, [brand.id]);

  const sortedObjectives = useMemo(() => {
    return [...objectives].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [objectives]);

  const persistObjectives = useCallback(
    async (nextObjectives: Objective[]) => {
      setSaving(true);
      setError("");
      try {
        const response = await fetch("/api/brands", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: brand.id, objectives: nextObjectives }),
        });
        const data = await response.json();
        if (!response.ok) {
          setError(data?.error ?? "Save failed");
          return false;
        }
        setObjectives(nextObjectives);
        return true;
      } catch {
        setError("Save failed");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [brand.id]
  );

  const loadVariants = useCallback(async () => {
    setVariantsLoading(true);
    setVariantsError("");
    try {
      const response = await fetch("/api/strategy/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: {
            brandName: brand.brandName,
            website: brand.website,
            tone: brand.tone,
          },
          needs: {
            targetBuyers: "",
            offers: "",
          },
          constraints: {
            maxDailyLeads: 60,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setVariantsError(data?.error ?? "Objective generation failed");
        return;
      }
      const next = Array.isArray(data?.variants) ? (data.variants as StrategyVariant[]) : [];
      setVariants(next.length ? next : fallbackVariants);
    } catch {
      setVariantsError("Objective generation failed");
    } finally {
      setVariantsLoading(false);
    }
  }, [brand.brandName, brand.tone, brand.website]);

  useEffect(() => {
    if (!objectives.length) {
      loadVariants();
    }
  }, [objectives.length, loadVariants]);

  const handleCreateObjective = async (input?: Partial<Objective>) => {
    const nextObjective = createObjective(input);
    const next = [nextObjective, ...objectives];
    const saved = await persistObjectives(next);
    if (saved) {
      router.push(`/brands/${brand.id}/objectives/${nextObjective.id}`);
    }
  };

  const handleDelete = async (objectiveId: string) => {
    const next = objectives.filter((objective) => objective.id !== objectiveId);
    await persistObjectives(next);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[color:var(--foreground)]">{brand.brandName} — Campaigns</h1>
          <div className="text-xs text-[color:var(--muted)]">
            Objectives define the plan. Each objective contains hypotheses and experiments.
          </div>
        </div>
        <button
          type="button"
          onClick={() => handleCreateObjective()}
          className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--foreground)]"
        >
          New Objective
        </button>
      </div>

      {error ? <div className="text-xs text-[color:var(--danger)]">{error}</div> : null}

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs text-[color:var(--muted)]">Objectives</div>
          <div className="text-[11px] text-[color:var(--muted)]">{objectives.length} total</div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {sortedObjectives.map((objective) => (
            <div
              key={objective.id}
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]/40 px-3 py-3"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm text-[color:var(--foreground)]">{objective.title}</div>
                <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[10px] text-[color:var(--muted)]">
                  {objective.status}
                </span>
              </div>
              <div className="mt-2 text-xs text-[color:var(--muted)]">{objective.goal || "No goal yet."}</div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-[color:var(--muted)]">
                <span>
                  C {objective.scoring.conversionWeight.toFixed(1)} · Q {objective.scoring.qualityWeight.toFixed(1)} ·
                  R {objective.scoring.replyWeight.toFixed(1)}
                </span>
                <span>{objective.hypotheses.length} hypotheses</span>
                <span>{objective.experiments.length} experiments</span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => router.push(`/brands/${brand.id}/objectives/${objective.id}`)}
                  className="text-xs text-[color:var(--accent)]"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(objective.id)}
                  className="text-xs text-[color:var(--danger)]"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {!sortedObjectives.length ? (
            <div className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-4 text-xs text-[color:var(--muted)]">
              No objectives yet. Choose a suggestion or create one from scratch.
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="text-xs text-[color:var(--muted)]">Suggested objectives</div>
          <button
            type="button"
            onClick={loadVariants}
            disabled={variantsLoading}
            className="text-[11px] text-[color:var(--muted)]"
          >
            {variantsLoading ? "Thinking..." : "Refresh"}
          </button>
        </div>
        {variantsError ? <div className="mt-3 text-xs text-[color:var(--danger)]">{variantsError}</div> : null}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(variants.length ? variants : fallbackVariants).map((variant) => (
            <div
              key={variant.title}
              className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/40 px-3 py-3"
            >
              <div className="text-sm text-[color:var(--foreground)]">{variant.title}</div>
              <div className="mt-2 text-[11px] text-[color:var(--muted)]">Goal</div>
              <div className="text-xs text-[color:var(--foreground)]">{variant.goal}</div>
              <div className="mt-2 text-[11px] text-[color:var(--muted)]">Constraints</div>
              <div className="text-xs text-[color:var(--foreground)]">{variant.constraints}</div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-[color:var(--muted)]">
                <span>
                  Score: {variant.scoring.conversionWeight.toFixed(1)}C /{" "}
                  {variant.scoring.qualityWeight.toFixed(1)}Q / {variant.scoring.replyWeight.toFixed(1)}R
                </span>
                <button
                  type="button"
                  onClick={() =>
                    handleCreateObjective({
                      title: variant.title,
                      goal: variant.goal,
                      constraints: variant.constraints,
                      scoring: variant.scoring,
                    })
                  }
                  className="text-[11px] text-[color:var(--accent)]"
                >
                  Create
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => handleCreateObjective()}
            className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-3 text-left text-xs text-[color:var(--muted)]"
          >
            Create an objective from scratch
          </button>
        </div>
      </div>

      {saving ? <div className="text-xs text-[color:var(--muted)]">Saving objectives...</div> : null}
    </div>
  );
}
