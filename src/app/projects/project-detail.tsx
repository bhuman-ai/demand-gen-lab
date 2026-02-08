"use client";

import { useState } from "react";
import Link from "next/link";

type Project = {
  id: string;
  website: string;
  brandName: string;
  tone: string;
  targetBuyers: string;
  offers: string;
  proof: string;
  createdAt: string;
  updatedAt?: string;
};

type ProjectDetailProps = {
  project: Project;
};

export default function ProjectDetail({ project }: ProjectDetailProps) {
  const [form, setForm] = useState<Project>(project);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");

  const updateField = (key: keyof Project, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setError("");
    setSaving(true);
    setSavedAt("");
    try {
      const response = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          brandName: form.brandName,
          website: form.website,
          tone: form.tone,
          targetBuyers: form.targetBuyers,
          offers: form.offers,
          proof: form.proof,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "Save failed");
      } else {
        setForm(data.project);
        setSavedAt(new Date().toLocaleTimeString());
      }
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-[color:var(--foreground)]">{form.brandName}</h1>
        <div className="flex items-center gap-3">
          {savedAt ? <span className="text-xs text-[color:var(--success)]">Saved {savedAt}</span> : null}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--foreground)]"
          >
            {saving ? "Saving" : "Save"}
          </button>
          <Link className="text-xs text-[color:var(--accent)]" href="/projects">
            Back
          </Link>
        </div>
      </div>
      {error ? <div className="text-xs text-[color:var(--danger)]">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="text-xs text-[color:var(--muted)]">Website</div>
          <input
            value={form.website}
            onChange={(event) => updateField("website", event.target.value)}
            className="mt-2 h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 text-sm text-[color:var(--foreground)]"
          />
        </div>
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="text-xs text-[color:var(--muted)]">Tone</div>
          <input
            value={form.tone}
            onChange={(event) => updateField("tone", event.target.value)}
            className="mt-2 h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 text-sm text-[color:var(--foreground)]"
          />
        </div>
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="text-xs text-[color:var(--muted)]">Target buyers</div>
          <input
            value={form.targetBuyers}
            onChange={(event) => updateField("targetBuyers", event.target.value)}
            className="mt-2 h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 text-sm text-[color:var(--foreground)]"
          />
        </div>
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="text-xs text-[color:var(--muted)]">Offers</div>
          <input
            value={form.offers}
            onChange={(event) => updateField("offers", event.target.value)}
            className="mt-2 h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 text-sm text-[color:var(--foreground)]"
          />
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Proof</div>
        <textarea
          value={form.proof}
          onChange={(event) => updateField("proof", event.target.value)}
          className="mt-2 h-24 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 py-2 text-sm text-[color:var(--foreground)]"
        />
      </div>

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Project Modules</div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {[
            { label: "Strategy", href: "/strategy" },
            { label: "Hypotheses", href: "/hypotheses" },
            { label: "Evolution", href: "/evolution" },
            { label: "Leads", href: "/leads" },
            { label: "Inbox", href: "/inbox" },
            { label: "Network", href: "/network" },
          ].map((module) => (
            <Link
              key={module.label}
              href={module.href}
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--background)]/40 px-3 py-2 text-xs text-[color:var(--foreground)]"
            >
              {module.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Created</div>
        <div className="mt-1 text-sm text-[color:var(--foreground)]">{project.createdAt}</div>
      </div>
    </div>
  );
}
