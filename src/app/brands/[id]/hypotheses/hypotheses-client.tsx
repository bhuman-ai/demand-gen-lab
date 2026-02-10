"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Idea = { title: string; channel: string; rationale: string };

type Brand = {
  id?: string;
  brandName?: string;
  website?: string;
  tone?: string;
  ideas?: unknown[];
  modules?: {
    strategy?: {
      goal?: string;
      constraints?: string;
    };
  };
  targetBuyers?: string;
  offers?: string;
};

const normalizeIdeas = (rows: unknown[] = []): Idea[] =>
  rows
    .map((row: any) => ({
      title: String(row?.title ?? ""),
      channel: String(row?.channel ?? ""),
      rationale: String(row?.rationale ?? ""),
    }))
    .filter((row) => row.title.length > 0);

export default function HypothesesClient({ brand }: { brand: Brand }) {
  const [ideas, setIdeas] = useState<Idea[]>(
    normalizeIdeas(Array.isArray(brand.ideas) ? brand.ideas : [])
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Idea | null>(null);

  const generateIdeas = async () => {
    if (!brand.id) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/strategy/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: brand.modules?.strategy?.goal ?? "Generate hypotheses",
          context: {
            website: brand.website ?? "",
            brandName: brand.brandName ?? "",
            tone: brand.tone ?? "",
          },
          needs: {
            targetBuyers: brand.targetBuyers ?? "",
            offers: brand.offers ?? "",
          },
          constraints: {
            maxDailyLeads: 50,
          },
          preferences: {
            channels: ["YouTube", "Instagram", "Reddit", "LinkedIn", "X"],
          },
          exclusions: {
            avoid: ["Etsy", "Fiverr", "Upwork"],
          },
          existingIdeas: ideas,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "Idea generation failed");
        return;
      }
      const nextIdeas = Array.isArray(data?.ideas) ? (data.ideas as Idea[]) : [];
      setIdeas(nextIdeas);
      await fetch("/api/brands", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: brand.id,
          ideas: nextIdeas,
        }),
      });
    } catch {
      setError("Idea generation failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ideas.length && brand.id && !loading) {
      generateIdeas();
    }
  }, [brand.id, ideas.length, loading]);

  const persistIdeas = async (nextIdeas: Idea[]) => {
    if (!brand.id) return;
    await fetch("/api/brands", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: brand.id,
        ideas: nextIdeas,
      }),
    });
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditDraft({ ...ideas[index] });
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditDraft(null);
  };

  const saveEdit = async () => {
    if (editingIndex === null || !editDraft) return;
    const nextIdeas = ideas.map((idea, idx) => (idx === editingIndex ? editDraft : idea));
    setIdeas(nextIdeas);
    await persistIdeas(nextIdeas);
    setEditingIndex(null);
    setEditDraft(null);
  };

  const deleteIdea = async (index: number) => {
    const nextIdeas = ideas.filter((_, idx) => idx !== index);
    setIdeas(nextIdeas);
    await persistIdeas(nextIdeas);
    if (editingIndex === index) {
      cancelEdit();
    }
  };

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs text-[color:var(--muted)]">Approved hypotheses</div>
        <button
          type="button"
          onClick={generateIdeas}
          disabled={loading}
          className="text-[11px] text-[color:var(--muted)]"
        >
          {loading ? "Generating..." : "Regenerate"}
        </button>
      </div>
      {error ? <div className="mt-3 text-xs text-[color:var(--danger)]">{error}</div> : null}
      <div className="mt-3 grid gap-2">
        {ideas.slice(0, 12).map((idea, index) => (
          <div key={`${idea.title}-${index}`} className="rounded-md border border-[color:var(--border)] px-3 py-2">
            {editingIndex === index && editDraft ? (
              <div className="grid gap-2">
                <input
                  value={editDraft.channel}
                  onChange={(event) => setEditDraft({ ...editDraft, channel: event.target.value })}
                  className="h-8 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                />
                <input
                  value={editDraft.title}
                  onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })}
                  className="h-8 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
                />
                <textarea
                  value={editDraft.rationale}
                  onChange={(event) => setEditDraft({ ...editDraft, rationale: event.target.value })}
                  className="h-16 resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-1 text-xs text-[color:var(--foreground)]"
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
              <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-[color:var(--muted)]">{idea.channel}</div>
                    <div className="text-sm text-[color:var(--foreground)]">{idea.title}</div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => startEdit(index)}
                      className="text-[color:var(--accent)]"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteIdea(index)}
                      className="text-[color:var(--danger)]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-[color:var(--muted)]">{idea.rationale}</div>
              </>
            )}
          </div>
        ))}
        {!ideas.length ? (
          <div className="text-xs text-[color:var(--muted)]">Generating hypotheses...</div>
        ) : null}
      </div>
      {ideas.length ? (
        <div className="mt-4">
          <Link
            href={`/brands/${brand.id}?tab=experiments`}
            className="text-xs text-[color:var(--accent)]"
          >
            Move to Experiments →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
