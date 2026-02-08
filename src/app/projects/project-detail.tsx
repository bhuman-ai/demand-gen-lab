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
  ideas: { title: string; channel: string; rationale: string }[];
  sequences: { name: string; status: string }[];
  leads: { name: string; channel: string; status: string; lastTouch: string }[];
};

type ProjectDetailProps = {
  project: Project;
  projects: Project[];
};

type Idea = { title: string; channel: string; rationale: string };

type Lead = { name: string; channel: string; status: string; lastTouch: string };

type Sequence = { name: string; status: string };

export default function ProjectDetail({ project, projects }: ProjectDetailProps) {
  const router = useRouter();
  const [form, setForm] = useState<Project>(project);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "strategy" | "sequences" | "leads">(
    "overview"
  );
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState("");
  const [newSequenceName, setNewSequenceName] = useState("");
  const [newSequenceStatus, setNewSequenceStatus] = useState("idle");
  const [newLead, setNewLead] = useState<Lead>({
    name: "",
    channel: "",
    status: "New",
    lastTouch: "",
  });

  const updateField = (key: keyof Project, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const persistProject = async (next: Project) => {
    const response = await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: next.id,
        brandName: next.brandName,
        website: next.website,
        tone: next.tone,
        targetBuyers: next.targetBuyers,
        offers: next.offers,
        proof: next.proof,
        modules: next.modules,
        ideas: next.ideas,
        sequences: next.sequences,
        leads: next.leads,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error ?? "Save failed");
    }
    return data.project as Project;
  };

  const handleSave = async () => {
    setError("");
    setSaving(true);
    setSavedAt("");
    try {
      const saved = await persistProject(form);
      setForm(saved);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
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
          existingIdeas: form.ideas,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setIdeasError(data?.error ?? "Idea generation failed");
      } else {
        const nextIdeas = Array.isArray(data?.ideas) ? (data.ideas as Idea[]) : [];
        setForm((prev) => ({ ...prev, ideas: nextIdeas }));
        const saved = await persistProject({ ...form, ideas: nextIdeas });
        setForm(saved);
      }
    } catch {
      setIdeasError("Idea generation failed");
    } finally {
      setIdeasLoading(false);
    }
  };

  const addSequence = async () => {
    if (!newSequenceName.trim()) return;
    const nextSequences: Sequence[] = [
      { name: newSequenceName.trim(), status: newSequenceStatus },
      ...form.sequences,
    ];
    const next = {
      ...form,
      sequences: nextSequences,
      modules: {
        ...form.modules,
        sequences: {
          ...form.modules.sequences,
          activeCount: nextSequences.length,
        },
      },
    };
    setForm(next);
    setNewSequenceName("");
    const saved = await persistProject(next);
    setForm(saved);
  };

  const addLead = async () => {
    if (!newLead.name.trim()) return;
    const nextLeads = [
      { ...newLead, name: newLead.name.trim() },
      ...form.leads,
    ];
    const qualifiedCount = nextLeads.filter((lead) => lead.status.toLowerCase() === "qualified").length;
    const next = {
      ...form,
      leads: nextLeads,
      modules: {
        ...form.modules,
        leads: {
          total: nextLeads.length,
          qualified: qualifiedCount,
        },
      },
    };
    setForm(next);
    setNewLead({ name: "", channel: "", status: "New", lastTouch: "" });
    const saved = await persistProject(next);
    setForm(saved);
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
          {form.ideas.length ? (
            <div className="mt-4 grid gap-3">
              {form.ideas.slice(0, 8).map((idea) => (
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
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <div className="text-[11px] text-[color:var(--muted)]">Sequence name</div>
              <input
                value={newSequenceName}
                onChange={(event) => setNewSequenceName(event.target.value)}
                className="mt-2 h-9 w-56 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
              />
            </div>
            <div>
              <div className="text-[11px] text-[color:var(--muted)]">Status</div>
              <select
                value={newSequenceStatus}
                onChange={(event) => setNewSequenceStatus(event.target.value)}
                className="mt-2 h-9 w-32 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
              >
                <option value="idle">Idle</option>
                <option value="testing">Testing</option>
                <option value="scaling">Scaling</option>
              </select>
            </div>
            <button
              type="button"
              onClick={addSequence}
              className="rounded-md border border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--foreground)]"
            >
              Add sequence
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(form.sequences || []).map((sequence, index) => (
              <div
                key={`${sequence.name}-${index}`}
                className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/40 px-3 py-2"
              >
                <div className="text-xs text-[color:var(--muted)]">{sequence.status}</div>
                <div className="text-sm text-[color:var(--foreground)]">{sequence.name}</div>
              </div>
            ))}
            {!form.sequences.length ? (
              <div className="text-xs text-[color:var(--muted)]">No sequences yet.</div>
            ) : null}
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
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <input
              value={newLead.name}
              onChange={(event) => setNewLead((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Lead name"
              className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
            />
            <input
              value={newLead.channel}
              onChange={(event) => setNewLead((prev) => ({ ...prev, channel: event.target.value }))}
              placeholder="Channel"
              className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
            />
            <input
              value={newLead.status}
              onChange={(event) => setNewLead((prev) => ({ ...prev, status: event.target.value }))}
              placeholder="Status"
              className="h-9 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
            />
            <div className="flex gap-2">
              <input
                value={newLead.lastTouch}
                onChange={(event) => setNewLead((prev) => ({ ...prev, lastTouch: event.target.value }))}
                placeholder="Last touch"
                className="h-9 flex-1 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-xs text-[color:var(--foreground)]"
              />
              <button
                type="button"
                onClick={addLead}
                className="rounded-md border border-[color:var(--border)] px-3 text-xs text-[color:var(--foreground)]"
              >
                Add
              </button>
            </div>
          </div>
          <div className="mt-5 overflow-hidden rounded-md border border-[color:var(--border)]">
            <div className="grid grid-cols-4 bg-[color:var(--background)]/60 text-[11px] text-[color:var(--muted)]">
              {['Lead', 'Channel', 'Status', 'Last Touch'].map((label) => (
                <div key={label} className="px-3 py-2">
                  {label}
                </div>
              ))}
            </div>
            {form.leads.map((row, index) => (
              <div key={`${row.name}-${index}`} className="grid grid-cols-4 text-[11px] text-[color:var(--foreground)]">
                <div className="px-3 py-2">{row.name}</div>
                <div className="px-3 py-2">{row.channel}</div>
                <div className="px-3 py-2">{row.status}</div>
                <div className="px-3 py-2">{row.lastTouch}</div>
              </div>
            ))}
            {!form.leads.length ? (
              <div className="px-3 py-3 text-[11px] text-[color:var(--muted)]">No leads yet.</div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-xs text-[color:var(--muted)]">Project Modules</div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {[
            { label: "Strategy", href: `/projects/${project.id}/strategy` },
            { label: "Hypotheses", href: `/projects/${project.id}/hypotheses` },
            { label: "Evolution", href: `/projects/${project.id}/evolution` },
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
