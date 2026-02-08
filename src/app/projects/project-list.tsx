"use client";

import { useState } from "react";

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

type ProjectListProps = {
  projects: Project[];
};

export default function ProjectList({ projects }: ProjectListProps) {
  const [items, setItems] = useState<Project[]>(projects);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Project>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const beginEdit = (project: Project) => {
    setEditingId(project.id);
    setForm(project);
    setError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({});
    setError("");
  };

  const updateField = (key: keyof Project, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!editingId) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          brandName: form.brandName ?? "",
          website: form.website ?? "",
          tone: form.tone ?? "",
          targetBuyers: form.targetBuyers ?? "",
          offers: form.offers ?? "",
          proof: form.proof ?? "",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "Save failed");
      } else {
        setItems((prev) => prev.map((item) => (item.id === editingId ? data.project : item)));
        setEditingId(null);
        setForm({});
      }
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this project?")) return;
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "Delete failed");
      } else {
        setItems((prev) => prev.filter((item) => item.id !== id));
      }
    } catch {
      setError("Delete failed");
    }
  };

  if (!items.length) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-sm text-[color:var(--muted)]">No projects yet.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <div className="text-xs text-[color:var(--danger)]">{error}</div> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((project) => {
          const isEditing = editingId === project.id;
          return (
            <div
              key={project.id}
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-[color:var(--foreground)]">
                  {isEditing ? (
                    <input
                      value={form.brandName ?? ""}
                      onChange={(event) => updateField("brandName", event.target.value)}
                      className="h-8 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-sm"
                    />
                  ) : (
                    project.brandName
                  )}
                </div>
                <div className="flex gap-2">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--foreground)]"
                      >
                        {saving ? "Saving" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--muted)]"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => beginEdit(project)}
                        className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--foreground)]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(project.id)}
                        className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--danger)]"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-3 text-xs text-[color:var(--muted)]">
                {isEditing ? (
                  <input
                    value={form.website ?? ""}
                    onChange={(event) => updateField("website", event.target.value)}
                    className="h-8 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-sm"
                  />
                ) : (
                  project.website
                )}
              </div>
              <div className="mt-4 grid gap-2 text-[11px] text-[color:var(--muted)]">
                {[
                  { label: "Tone", key: "tone" },
                  { label: "Target buyers", key: "targetBuyers" },
                  { label: "Offers", key: "offers" },
                ].map((field) => (
                  <div key={field.key} className="flex justify-between gap-2">
                    <span>{field.label}</span>
                    {isEditing ? (
                      <input
                        value={(form as any)[field.key] ?? ""}
                        onChange={(event) => updateField(field.key as keyof Project, event.target.value)}
                        className="h-7 w-56 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-[11px]"
                      />
                    ) : (
                      <span className="text-[color:var(--foreground)]">
                        {(project as any)[field.key] || "—"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 text-[11px] text-[color:var(--muted)]">Proof</div>
              {isEditing ? (
                <textarea
                  value={form.proof ?? ""}
                  onChange={(event) => updateField("proof", event.target.value)}
                  className="mt-2 h-16 w-full resize-none rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 py-1 text-[11px]"
                />
              ) : (
                <div className="mt-2 text-[11px] text-[color:var(--foreground)]">
                  {project.proof || "—"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
