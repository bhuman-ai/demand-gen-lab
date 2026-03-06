"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CopyPlus, Plus, Search } from "lucide-react";
import {
  createExperimentApi,
  fetchBrand,
  fetchExperiment,
  fetchExperimentListView,
} from "@/lib/client-api";
import { filterExperimentListItems } from "@/lib/experiment-list-view";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, ExperimentListItem } from "@/lib/factory-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const STATUS_OPTIONS: Array<"all" | ExperimentListItem["status"]> = [
  "all",
  "Draft",
  "Sourcing",
  "Ready",
  "Running",
  "Paused",
  "Completed",
  "Promoted",
  "Blocked",
];

function statusLabel(status: (typeof STATUS_OPTIONS)[number]) {
  return status === "all" ? "All statuses" : status;
}

function leadsCell(item: ExperimentListItem) {
  if (item.sourcedLeads > 0) return item.sourcedLeads;
  if (item.scheduledMessages > 0) return item.scheduledMessages;
  return item.sentMessages;
}

export default function ExperimentsClient({ brandId }: { brandId: string }) {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [items, setItems] = useState<ExperimentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState("");
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [query, setQuery] = useState("");

  const refresh = async () => {
    const [brandRow, listRows] = await Promise.all([
      fetchBrand(brandId),
      fetchExperimentListView(brandId),
    ]);
    setBrand(brandRow);
    setItems(listRows);
    localStorage.setItem("factory.activeBrandId", brandId);
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    void refresh()
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load experiments");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  const filtered = useMemo(() => {
    return filterExperimentListItems({
      items,
      status: statusFilter,
      query,
    });
  }, [items, query, statusFilter]);

  return (
    <div className="space-y-5">
      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
      {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading experiments...</div> : null}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>
              {brand?.name || "Brand"} · All Experiments
            </CardTitle>
            <CardDescription>
              Show every experiment for this brand and quickly jump into execution.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href={`/brands/${brandId}/experiments/suggestions`}>Suggestions</Link>
            </Button>
            <Button
              type="button"
              disabled={creating}
              onClick={async () => {
                setCreating(true);
                setError("");
                try {
                  const created = await createExperimentApi(brandId, {
                    name: `Experiment ${items.length + 1}`,
                  });
                  trackEvent("experiment_created", { brandId, experimentId: created.id });
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to create experiment");
                } finally {
                  setCreating(false);
                }
              }}
            >
              <Plus className="h-4 w-4" />
              {creating ? "Creating..." : "New Experiment"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((status) => {
              const active = statusFilter === status;
              return (
                <button
                  key={status}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    active
                      ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--foreground)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface-muted)]"
                  }`}
                >
                  {statusLabel(status)}
                </button>
              );
            })}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[color:var(--muted-foreground)]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search experiments"
              className="pl-9"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
            <colgroup>
              <col className="w-[27%]" />
              <col className="w-[10%]" />
              <col className="w-[31%]" />
              <col className="w-[6%]" />
              <col className="w-[6%]" />
              <col className="w-[7%]" />
              <col className="w-[9%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Audience</th>
                <th className="pb-2 px-2 text-right whitespace-nowrap">Leads</th>
                <th className="pb-2 px-2 text-right whitespace-nowrap">Replies</th>
                <th className="pb-2 px-2 text-right whitespace-nowrap">Positive</th>
                <th className="pb-2 px-2 whitespace-nowrap">Last active</th>
                <th className="pb-2 pl-4 text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="group border-t border-[color:var(--border)]">
                  <td className="py-2 pr-4 align-top font-medium">{item.name}</td>
                  <td className="py-2 pr-4 align-top">{item.status}</td>
                  <td className="py-2 pr-4 align-top text-[color:var(--muted-foreground)]">{item.audience || "—"}</td>
                  <td className="py-2 px-2 align-top text-right">{leadsCell(item) || "—"}</td>
                  <td className="py-2 px-2 align-top text-right">{item.replies || "—"}</td>
                  <td className="py-2 px-2 align-top text-right">{item.positiveReplies || "—"}</td>
                  <td className="py-2 px-2 align-top text-[color:var(--muted-foreground)] whitespace-nowrap">{item.lastActivityLabel}</td>
                  <td className="py-2 pl-4 align-top">
                    <div className="flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                      <Button size="sm" variant="outline" asChild>
                        <Link href={item.openHref}>Open</Link>
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <Link href={item.editHref}>Edit</Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={duplicatingId === item.id}
                        onClick={async () => {
                          setDuplicatingId(item.id);
                          setError("");
                          try {
                            const source = await fetchExperiment(brandId, item.id);
                            const duplicate = await createExperimentApi(brandId, {
                              name: `${source.name} Copy`,
                              offer: source.offer,
                              audience: source.audience,
                            });
                            trackEvent("experiment_created", {
                              brandId,
                              experimentId: duplicate.id,
                              source: "duplicate",
                              fromExperimentId: item.id,
                            });
                            await refresh();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Failed to duplicate experiment");
                          } finally {
                            setDuplicatingId("");
                          }
                        }}
                      >
                        <CopyPlus className="h-3.5 w-3.5" />
                        {duplicatingId === item.id ? "Duplicating..." : "Duplicate"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
            {!filtered.length ? (
              <div className="py-6 text-sm text-[color:var(--muted-foreground)]">No experiments match your filters.</div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
