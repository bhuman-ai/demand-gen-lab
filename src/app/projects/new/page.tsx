"use client";

import { useState } from "react";

const mockPrefill = {
  brandName: "Example Artist Studio",
  tone: "Precise, confident, technical",
  targetBuyers: "Indie game studios, YouTube creators, small agencies",
  offers: "Key art, thumbnail packs, character concepts",
  proof: "5+ shipped indie titles, 2M+ thumbnail impressions",
};

export default function Page() {
  const [website, setWebsite] = useState("");
  const [prefill, setPrefill] = useState<typeof mockPrefill | null>(null);

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
          onClick={() => setPrefill(mockPrefill)}
          className="mt-4 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/80 px-4 py-2 text-xs text-[color:var(--foreground)]"
        >
          Scrape & Prefill
        </button>
      </div>

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">Step 2</div>
        <div className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">Confirm context</div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[
            { label: "Brand name", value: prefill?.brandName ?? "" },
            { label: "Tone", value: prefill?.tone ?? "" },
            { label: "Target buyers", value: prefill?.targetBuyers ?? "" },
            { label: "Offers", value: prefill?.offers ?? "" },
            { label: "Proof points", value: prefill?.proof ?? "" },
          ].map((field) => (
            <div key={field.label}>
              <div className="text-xs text-[color:var(--muted)]">{field.label}</div>
              <div className="mt-2 h-10 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 text-sm text-[color:var(--foreground)]">
                {field.value}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-[color:var(--muted)]">
          Edit the generated summary (target buyers, tone, offers, proof points).
        </p>
      </div>
    </div>
  );
}
