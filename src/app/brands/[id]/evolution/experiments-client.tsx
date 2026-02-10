"use client";

import { useState } from "react";
import Link from "next/link";

type Experiment = { name: string; status: string };

type Brand = {
  id?: string;
  sequences?: unknown[];
};

const normalizeExperiments = (rows: unknown[] = []): Experiment[] =>
  rows
    .map((row: any) => ({
      name: String(row?.name ?? ""),
      status: String(row?.status ?? ""),
    }))
    .filter((row) => row.name.length > 0);

export default function ExperimentsClient({ brand }: { brand: Brand }) {
  const [experiments, setExperiments] = useState<Experiment[]>(
    normalizeExperiments(Array.isArray(brand.sequences) ? brand.sequences : [])
  );
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Experiment | null>(null);

  const persist = async (nextExperiments: Experiment[]) => {
    if (!brand.id) return;
    await fetch("/api/brands", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: brand.id,
        sequences: nextExperiments,
        modules: {
          sequences: {
            status: "testing",
            activeCount: nextExperiments.length,
          },
        },
      }),
    });
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setDraft({ ...experiments[index] });
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setDraft(null);
  };

  const saveEdit = async () => {
    if (editingIndex === null || !draft) return;
    const next = experiments.map((exp, idx) => (idx === editingIndex ? draft : exp));
    setExperiments(next);
    await persist(next);
    cancelEdit();
  };

  const deleteExperiment = async (index: number) => {
    const next = experiments.filter((_, idx) => idx !== index);
    setExperiments(next);
    await persist(next);
    if (editingIndex === index) cancelEdit();
  };

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs text-[color:var(--muted)]">Active experiments</div>
        {brand.id ? (
          <Link href={`/brands/${brand.id}?tab=experiments`} className="text-[11px] text-[color:var(--accent)]">
            Manage all
          </Link>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2">
        {experiments.slice(0, 12).map((experiment, index) => (
          <div key={`${experiment.name}-${index}`} className="rounded-md border border-[color:var(--border)] px-3 py-2">
            {editingIndex === index && draft ? (
              <div className="grid gap-2">
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  className="h-8 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                />
                <input
                  value={draft.status}
                  onChange={(event) => setDraft({ ...draft, status: event.target.value })}
                  className="h-8 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                />
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={saveEdit}
                    className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[color:var(--foreground)]"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[color:var(--muted)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs text-[color:var(--muted)]">{experiment.status}</div>
                  <div className="text-sm text-[color:var(--foreground)]">{experiment.name}</div>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <button type="button" onClick={() => startEdit(index)} className="text-[color:var(--accent)]">
                    Edit
                  </button>
                  <button type="button" onClick={() => deleteExperiment(index)} className="text-[color:var(--danger)]">
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {!experiments.length ? (
          <div className="text-xs text-[color:var(--muted)]">No experiments yet.</div>
        ) : null}
      </div>
    </div>
  );
}
