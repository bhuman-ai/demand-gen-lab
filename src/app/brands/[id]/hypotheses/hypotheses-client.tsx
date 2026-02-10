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
        {ideas.slice(0, 12).map((idea) => (
          <div key={idea.title} className="rounded-md border border-[color:var(--border)] px-3 py-2">
            <div className="text-xs text-[color:var(--muted)]">{idea.channel}</div>
            <div className="text-sm text-[color:var(--foreground)]">{idea.title}</div>
            <div className="mt-1 text-[11px] text-[color:var(--muted)]">{idea.rationale}</div>
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
