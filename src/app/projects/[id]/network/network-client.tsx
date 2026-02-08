"use client";

import { useState } from "react";

type DomainEntry = {
  domain: string;
  status: string;
  warmupStage: string;
  reputation: string;
};

type Project = {
  id: string;
  brandName: string;
  domains?: DomainEntry[];
};

type NetworkClientProps = {
  project: Project;
};

export default function NetworkClient({ project }: NetworkClientProps) {
  const [domains, setDomains] = useState<DomainEntry[]>(project.domains ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newDomain, setNewDomain] = useState<DomainEntry>({
    domain: "",
    status: "Active",
    warmupStage: "Day 1",
    reputation: "Low",
  });

  const persistDomains = async (nextDomains: DomainEntry[]) => {
    const response = await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: project.id,
        domains: nextDomains,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error ?? "Save failed");
    }
    const saved = Array.isArray(data?.project?.domains) ? (data.project.domains as DomainEntry[]) : [];
    return saved;
  };

  const addDomain = async () => {
    if (!newDomain.domain.trim()) return;
    setSaving(true);
    setError("");
    const nextDomains = [
      { ...newDomain, domain: newDomain.domain.trim() },
      ...domains,
    ];
    setDomains(nextDomains);
    try {
      const saved = await persistDomains(nextDomains);
      setDomains(saved);
      setNewDomain({ domain: "", status: "Active", warmupStage: "Day 1", reputation: "Low" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const active = domains.filter((item) => item.status.toLowerCase() === "active").length;
  const warming = domains.filter((item) => item.status.toLowerCase().includes("warm")).length;
  const risk = domains.some((item) => item.reputation.toLowerCase() === "high") ? "High" : "Low";

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
      <div className="text-xs text-[color:var(--muted)]">Domains & reputation</div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {[
          { label: "Active domains", value: active },
          { label: "Warming up", value: warming },
          { label: "Reputation risk", value: risk },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/40 px-4 py-3"
          >
            <div className="text-[11px] text-[color:var(--muted)]">{item.label}</div>
            <div className="mt-1 text-sm text-[color:var(--foreground)]">{item.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <input
          value={newDomain.domain}
          onChange={(event) => setNewDomain((prev) => ({ ...prev, domain: event.target.value }))}
          placeholder="Domain"
          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
        />
        <input
          value={newDomain.status}
          onChange={(event) => setNewDomain((prev) => ({ ...prev, status: event.target.value }))}
          placeholder="Status"
          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
        />
        <input
          value={newDomain.warmupStage}
          onChange={(event) => setNewDomain((prev) => ({ ...prev, warmupStage: event.target.value }))}
          placeholder="Warmup stage"
          className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
        />
        <div className="flex gap-2">
          <input
            value={newDomain.reputation}
            onChange={(event) => setNewDomain((prev) => ({ ...prev, reputation: event.target.value }))}
            placeholder="Reputation"
            className="h-9 flex-1 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
          />
          <button
            type="button"
            onClick={addDomain}
            disabled={saving}
            className="rounded-md border border-[color:var(--border)] px-3 text-xs text-[color:var(--foreground)]"
          >
            {saving ? "Saving" : "Add"}
          </button>
        </div>
      </div>
      {error ? <div className="mt-3 text-xs text-[color:var(--danger)]">{error}</div> : null}
      <div className="mt-5 overflow-hidden rounded-md border border-[color:var(--border)]">
        <div className="grid grid-cols-4 bg-[color:var(--background)]/60 text-[11px] text-[color:var(--muted)]">
          {["Domain", "Status", "Warmup", "Reputation"].map((label) => (
            <div key={label} className="px-3 py-2">
              {label}
            </div>
          ))}
        </div>
        {domains.map((row, index) => (
          <div key={`${row.domain}-${index}`} className="grid grid-cols-4 text-[11px] text-[color:var(--foreground)]">
            <div className="px-3 py-2">{row.domain}</div>
            <div className="px-3 py-2">{row.status}</div>
            <div className="px-3 py-2">{row.warmupStage}</div>
            <div className="px-3 py-2">{row.reputation}</div>
          </div>
        ))}
        {!domains.length ? (
          <div className="px-3 py-3 text-[11px] text-[color:var(--muted)]">No domains assigned.</div>
        ) : null}
      </div>
    </div>
  );
}
