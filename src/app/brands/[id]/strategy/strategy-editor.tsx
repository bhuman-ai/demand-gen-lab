"use client";

import { useCallback, useEffect, useState } from "react";

type Strategy = {
  status: "draft" | "active" | "paused";
  goal: string;
  constraints: string;
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

type Modules = {
  strategy?: Strategy;
  sequences?: { status: "idle" | "testing" | "scaling"; activeCount: number };
  leads?: { total: number; qualified: number };
};

type Brand = {
  id: string;
  brandName: string;
  website: string;
  tone: string;
  modules?: Modules;
  ideas?: { title: string; channel: string; rationale: string }[];
};

type StrategyEditorProps = {
  brand: Brand;
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

export default function StrategyEditor({ brand }: StrategyEditorProps) {
  const [strategy, setStrategy] = useState<Strategy>({
    status: brand.modules?.strategy?.status ?? "draft",
    goal: brand.modules?.strategy?.goal ?? "",
    constraints: brand.modules?.strategy?.constraints ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [variants, setVariants] = useState<StrategyVariant[]>(fallbackVariants);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined" && brand.id) {
      localStorage.setItem(ACTIVE_BRAND_KEY, brand.id);
    }
  }, [brand.id]);

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
            targetBuyers: brand.modules?.strategy?.goal ?? "",
            offers: "",
          },
          constraints: {
            maxDailyLeads: 60,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setVariantsError(data?.error ?? "Strategy generation failed");
        return;
      }
      const next = Array.isArray(data?.variants) ? (data.variants as StrategyVariant[]) : [];
      setVariants(next.length ? next : fallbackVariants);
    } catch {
      setVariantsError("Strategy generation failed");
    } finally {
      setVariantsLoading(false);
    }
  }, [brand.brandName, brand.modules?.strategy?.goal, brand.tone, brand.website]);

  useEffect(() => {
    if (!strategy.goal.trim() && !variantsLoading) {
      loadVariants();
    }
  }, [strategy.goal, variantsLoading, loadVariants]);

  const persist = async () => {
    setSaving(true);
    setError("");
    setSavedAt("");
    try {
      const response = await fetch("/api/brands", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: brand.id,
          modules: {
            strategy,
            sequences: brand.modules?.sequences ?? { status: "idle", activeCount: 0 },
            leads: brand.modules?.leads ?? { total: 0, qualified: 0 },
          },
        }),
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
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Strategy definition</div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <div className="text-[11px] text-[color:var(--muted)]">Status</div>
            <select
              value={strategy.status}
              onChange={(event) =>
                setStrategy((prev) => ({ ...prev, status: event.target.value as Strategy["status"] }))
              }
              className="mt-2 h-9 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <div className="text-[11px] text-[color:var(--muted)]">Goal</div>
            <input
              value={strategy.goal}
              onChange={(event) => setStrategy((prev) => ({ ...prev, goal: event.target.value }))}
              className="mt-2 h-9 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
            />
          </div>
          <div className="md:col-span-3">
            <div className="text-[11px] text-[color:var(--muted)]">Constraints</div>
            <textarea
              value={strategy.constraints}
              onChange={(event) => setStrategy((prev) => ({ ...prev, constraints: event.target.value }))}
              className="mt-2 h-20 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-2 text-xs text-[color:var(--foreground)]"
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={persist}
            disabled={saving}
            className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--foreground)]"
          >
            {saving ? "Saving..." : "Save Strategy"}
          </button>
          {savedAt ? <span className="text-xs text-[color:var(--success)]">Saved {savedAt}</span> : null}
          {error ? <span className="text-xs text-[color:var(--danger)]">{error}</span> : null}
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs text-[color:var(--muted)]">Strategy suggestions</div>
          <button
            type="button"
            onClick={loadVariants}
            className="text-[11px] text-[color:var(--muted)]"
            disabled={variantsLoading}
          >
            {variantsLoading ? "Thinking..." : "Refresh"}
          </button>
        </div>
        {variantsError ? <div className="mt-3 text-xs text-[color:var(--danger)]">{variantsError}</div> : null}
        <div className="mt-4 grid gap-3">
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
                  {variant.scoring.replyWeight.toFixed(1)}R / {variant.scoring.qualityWeight.toFixed(1)}Q
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setStrategy((prev) => ({
                      ...prev,
                      goal: variant.goal,
                      constraints: variant.constraints,
                    }))
                  }
                  className="text-[11px] text-[color:var(--accent)]"
                >
                  Apply
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
