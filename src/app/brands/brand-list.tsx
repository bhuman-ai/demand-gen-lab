"use client";

import { useState } from "react";
import Link from "next/link";

type Brand = {
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

type BrandListProps = {
  brands: Brand[];
};

export default function BrandList({ brands }: BrandListProps) {
  const [items, setItems] = useState<Brand[]>(brands);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Brand>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [undoQueue, setUndoQueue] = useState<{
    brand: Brand;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);

  const beginEdit = (brand: Brand) => {
    setEditingId(brand.id);
    setForm(brand);
    setError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({});
    setError("");
  };

  const updateField = (key: keyof Brand, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!editingId) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/brands", {
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
        setItems((prev) => prev.map((item) => (item.id === editingId ? data.brand : item)));
        setEditingId(null);
        setForm({});
      }
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (brand: Brand) => {
    if (!window.confirm("Delete this brand?")) return;
    setError("");
    setItems((prev) => prev.filter((item) => item.id !== brand.id));
    if (undoQueue?.timeoutId) {
      clearTimeout(undoQueue.timeoutId);
    }
    const timeoutId = setTimeout(async () => {
      try {
        const response = await fetch("/api/brands", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: brand.id }),
        });
        const data = await response.json();
        if (!response.ok) {
          setError(data?.error ?? "Delete failed");
          setItems((prev) => [brand, ...prev]);
        }
      } catch {
        setError("Delete failed");
        setItems((prev) => [brand, ...prev]);
      } finally {
        setUndoQueue(null);
      }
    }, 4000);
    setUndoQueue({ brand, timeoutId });
  };

  const handleUndo = () => {
    if (!undoQueue) return;
    clearTimeout(undoQueue.timeoutId);
    setItems((prev) => [undoQueue.brand, ...prev]);
    setUndoQueue(null);
  };

  if (!items.length) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background-elevated)] p-5">
        <div className="text-sm text-[color:var(--muted)]">No brands yet.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? <div className="text-xs text-[color:var(--danger)]">{error}</div> : null}
      {undoQueue ? (
        <div className="flex items-center justify-between rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/70 px-3 py-2 text-xs text-[color:var(--foreground)]">
          <span>Brand deleted.</span>
          <button
            type="button"
            onClick={handleUndo}
            className="text-[color:var(--accent)]"
          >
            Undo
          </button>
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((brand) => {
          const isEditing = editingId === brand.id;
          return (
            <div
              key={brand.id}
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
                    brand.brandName
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
                      <Link
                        href={`/brands/${brand.id}`}
                        className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--accent)]"
                      >
                        View
                      </Link>
                      <button
                        type="button"
                        onClick={() => beginEdit(brand)}
                        className="rounded-md border border-[color:var(--border)] px-2 py-1 text-[11px] text-[color:var(--foreground)]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(brand)}
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
                  brand.website
                )}
              </div>
              <div className="mt-4 grid gap-2 text-[11px] text-[color:var(--muted)]">
                {[
                  { label: "Tone", key: "tone" },
                ].map((field) => (
                  <div key={field.key} className="flex justify-between gap-2">
                    <span>{field.label}</span>
                    {isEditing ? (
                      <input
                        value={(form as any)[field.key] ?? ""}
                        onChange={(event) => updateField(field.key as keyof Brand, event.target.value)}
                        className="h-7 w-56 rounded-md border border-[color:var(--border)] bg-[color:var(--background)]/60 px-2 text-[11px]"
                      />
                    ) : (
                      <span className="text-[color:var(--foreground)]">
                        {(brand as any)[field.key] || "—"}
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
                  {brand.proof || "—"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
