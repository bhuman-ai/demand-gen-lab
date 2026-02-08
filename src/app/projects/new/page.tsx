"use client";

import { useState } from "react";

type Prefill = {
  brandName: string;
  tone: string;
  targetBuyers: string;
  offers: string;
  proof: string;
};

export default function Page() {
  const [website, setWebsite] = useState("");
  const [prefill, setPrefill] = useState<Prefill>({
    brandName: "",
    tone: "",
    targetBuyers: "",
    offers: "",
    proof: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleScrape = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/intake/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: website }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "Prefill failed");
      } else {
        setPrefill({
          brandName: data?.prefill?.brandName ?? "",
          tone: data?.prefill?.tone ?? "",
          targetBuyers: data?.prefill?.targetBuyers ?? "",
          offers: data?.prefill?.offers ?? "",
          proof: data?.prefill?.proof ?? "",
        });
      }
    } catch {
      setError("Prefill failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[color:var(--foreground)]">New Project</h1>
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">Step 1</div>
        <div className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">Paste website URL</div>
        <input
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
          placeholder="https://your-site.com"
          className="mt-3 h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 text-sm text-[color:var(--foreground)] outline-none"
        />
        <p className="mt-3 text-xs text-[color:var(--muted)]">
          We will scrape the site and prefill brand voice, product lines, and positioning.
        </p>
        <button
          type="button"
          onClick={handleScrape}
          disabled={!website.trim() || loading}
          className="mt-4 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/80 px-4 py-2 text-xs text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Scraping..." : "Scrape & Prefill"}
        </button>
        {error ? (
          <p className="mt-2 text-xs text-[color:var(--danger)]">{error}</p>
        ) : null}
      </div>

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">Step 2</div>
        <div className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">Confirm context</div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs text-[color:var(--muted)]">Brand name</div>
            <input
              value={prefill.brandName}
              onChange={(event) => setPrefill({ ...prefill, brandName: event.target.value })}
              className="mt-2 h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 text-sm text-[color:var(--foreground)]"
            />
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted)]">Tone</div>
            <input
              value={prefill.tone}
              onChange={(event) => setPrefill({ ...prefill, tone: event.target.value })}
              className="mt-2 h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 text-sm text-[color:var(--foreground)]"
            />
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted)]">Target buyers</div>
            <input
              value={prefill.targetBuyers}
              onChange={(event) => setPrefill({ ...prefill, targetBuyers: event.target.value })}
              className="mt-2 h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 text-sm text-[color:var(--foreground)]"
            />
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted)]">Offers</div>
            <input
              value={prefill.offers}
              onChange={(event) => setPrefill({ ...prefill, offers: event.target.value })}
              className="mt-2 h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 text-sm text-[color:var(--foreground)]"
            />
          </div>
          <div className="md:col-span-2">
            <div className="text-xs text-[color:var(--muted)]">Proof points</div>
            <textarea
              value={prefill.proof}
              onChange={(event) => setPrefill({ ...prefill, proof: event.target.value })}
              className="mt-2 h-20 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 py-2 text-sm text-[color:var(--foreground)]"
            />
          </div>
        </div>
        <p className="mt-4 text-xs text-[color:var(--muted)]">
          Edit the generated summary (target buyers, tone, offers, proof points).
        </p>
      </div>
    </div>
  );
}
