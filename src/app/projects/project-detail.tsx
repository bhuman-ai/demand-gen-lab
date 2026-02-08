"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
  modules: {
    strategy: {
      status: "draft" | "active" | "paused";
      goal: string;
      constraints: string;
    };
    sequences: {
      status: "idle" | "testing" | "scaling";
      activeCount: number;
    };
    leads: {
      total: number;
      qualified: number;
    };
  };
};

type ProjectDetailProps = {
  project: Project;
  projects: Project[];
};

type Idea = {
  title: string;
  channel: string;
  rationale: string;
};

export default function ProjectDetail({ project, projects }: ProjectDetailProps) {
  const router = useRouter();
  const [form, setForm] = useState<Project>(project);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "strategy" | "sequences" | "leads">(
    "overview"
  );
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState("");

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
          modules: form.modules,
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

  const handleGenerateIdeas = async () => {
    setIdeasError("");
    setIdeasLoading(true);
    try {
      const response = await fetch("/api/strategy/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: form.modules.strategy.goal || "Generate outreach ideas",
          context: {
            website: form.website,
            brandName: form.brandName,
            tone: form.tone,
          },
          needs: {
            targetBuyers: form.targetBuyers,
            offers: form.offers,
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
          existingIdeas: [],
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setIdeasError(data?.error ?? "Idea generation failed");
      } else {
        setIdeas(Array.isArray(data?.ideas) ? data.ideas : []);
      }
    } catch {
      setIdeasError("Idea generation failed");
    } finally {
      setIdeasLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-[color:var(--foreground)]">{form.brandName}</h1>
          <select
            value={form.id}
            onChange={(event) => router.push(`/projects/${event.target.value}`)}
            className="h-8 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
          >
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.brandName}
              </option>
            ))}
          </select>
        </div>
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

      <div className="flex flex-wrap gap-2 text-xs">
        {[
          { id: "overview", label: "Overview" },
          { id: "strategy", label: "Strategy" },
          { id: "sequences", label: "Sequences" },
          { id: "leads", label: "Leads" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`rounded-md border px-3 py-1 ${
              activeTab === tab.id
                ? "border-[color:var(--accent)] text-[color:var(--foreground)]"
                : "border-[color:var(--border)] text-[color:var(--muted)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <>
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
        </>
      ) : null}

      {activeTab === "strategy" ? (
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="text-xs text-[color:var(--muted)]">Strategy status</div>
          <select
            value={form.modules.strategy.status}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                modules: {
                  ...prev.modules,
                  strategy: {
                    ...prev.modules.strategy,
                    status: event.target.value as Project["modules"]["strategy"]["status"],
                  },
                },
              }))
            }
            className="mt-2 h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
          <div className="mt-4 text-xs text-[color:var(--muted)]">Goal</div>
          <input
            value={form.modules.strategy.goal}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                modules: {
                  ...prev.modules,
                  strategy: { ...prev.modules.strategy, goal: event.target.value },
                },
              }))
            }
            className="mt-2 h-10 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 text-sm text-[color:var(--foreground)]"
          />
          <div className="mt-4 text-xs text-[color:var(--muted)]">Constraints</div>
          <textarea
            value={form.modules.strategy.constraints}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                modules: {
                  ...prev.modules,
                  strategy: { ...prev.modules.strategy, constraints: event.target.value },
                },
              }))
            }
            className="mt-2 h-20 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 py-2 text-sm text-[color:var(--foreground)]"
          />
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleGenerateIdeas}
              disabled={ideasLoading}
              className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--foreground)]"
            >
              {ideasLoading ? "Generating..." : "Generate Ideas"}
            </button>
            {ideasError ? <span className="text-xs text-[color:var(--danger)]">{ideasError}</span> : null}
          </div>
          {ideas.length ? (
            <div className="mt-4 grid gap-3">
              {ideas.slice(0, 6).map((idea) => (
                <div
                  key={idea.title}
                  className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/40 px-3 py-2"
                >
                  <div className="text-xs text-[color:var(--muted)]">{idea.channel}</div>
                  <div className="text-sm text-[color:var(--foreground)]">{idea.title}</div>
                  <div className="mt-1 text-[11px] text-[color:var(--muted)]">{idea.rationale}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "sequences" ? (
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="text-xs text-[color:var(--muted)]">Sequence status</div>
          <select
            value={form.modules.sequences.status}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                modules: {
                  ...prev.modules,
                  sequences: {
                    ...prev.modules.sequences,
                    status: event.target.value as Project["modules"]["sequences"]["status"],
                  },
                },
              }))
            }
            className="mt-2 h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
          >
            <option value="idle">Idle</option>
            <option value="testing">Testing</option>
            <option value="scaling">Scaling</option>
          </select>
          <div className="mt-4 text-xs text-[color:var(--muted)]">Active sequences</div>
          <input
            value={form.modules.sequences.activeCount}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                modules: {
                  ...prev.modules,
                  sequences: {
                    ...prev.modules.sequences,
                    activeCount: Number(event.target.value || 0),
                  },
                },
              }))
            }
            className="mt-2 h-10 w-40 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-3 text-sm text-[color:var(--foreground)]"
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {Array.from({ length: Math.max(2, form.modules.sequences.activeCount || 0) }).map((_, index) => (
              <div
                key={`seq-${index}`}
                className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/40 px-3 py-2"
              >
                <div className="text-xs text-[color:var(--muted)]">Sequence {index + 1}</div>
                <div className="text-sm text-[color:var(--foreground)]">Status: {form.modules.sequences.status}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeTab === "leads" ? (
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
          <div className="text-xs text-[color:var(--muted)]">Lead totals</div>
          <div className="mt-3 flex gap-4">
            <div>
              <div className="text-[11px] text-[color:var(--muted)]">Total</div>
              <input
                value={form.modules.leads.total}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    modules: {
                      ...prev.modules,
                      leads: { ...prev.modules.leads, total: Number(event.target.value || 0) },
                    },
                  }))
                }
                className="mt-2 h-9 w-28 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
              />
            </div>
            <div>
              <div className="text-[11px] text-[color:var(--muted)]">Qualified</div>
              <input
                value={form.modules.leads.qualified}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    modules: {
                      ...prev.modules,
                      leads: {
                        ...prev.modules.leads,
                        qualified: Number(event.target.value || 0),
                      },
                    },
                  }))
                }
                className="mt-2 h-9 w-28 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
              />
            </div>
          </div>
          <div className="mt-5 overflow-hidden rounded-md border border-[color:var(--border)]">
            <div className="grid grid-cols-4 bg-[color:var(--background)]/60 text-[11px] text-[color:var(--muted)]">
              {["Lead", "Channel", "Status", "Last Touch"].map((label) => (
                <div key={label} className="px-3 py-2">
                  {label}
                </div>
              ))}
            </div>
            {[
              { lead: "Aurora Studios", channel: "Email", status: "Qualified", touch: "2d" },
              { lead: "Void Signal", channel: "Instagram", status: "Pending", touch: "5d" },
              { lead: "Helix Plays", channel: "YouTube", status: "New", touch: "1d" },
            ].map((row) => (
              <div key={row.lead} className="grid grid-cols-4 text-[11px] text-[color:var(--foreground)]">
                <div className="px-3 py-2">{row.lead}</div>
                <div className="px-3 py-2">{row.channel}</div>
                <div className="px-3 py-2">{row.status}</div>
                <div className="px-3 py-2">{row.touch}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
