"use client";

import { useState } from "react";

type Strategy = {
  status: "draft" | "active" | "paused";
  goal: string;
  constraints: string;
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

export default function StrategyEditor({ brand }: StrategyEditorProps) {
  const [strategy, setStrategy] = useState<Strategy>({
    status: brand.modules?.strategy?.status ?? "draft",
    goal: brand.modules?.strategy?.goal ?? "",
    constraints: brand.modules?.strategy?.constraints ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");

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
  );
}
