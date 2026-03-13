"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CopyPlus, Plus, Search } from "lucide-react";
import {
  createExperimentApi,
  fetchExperiment,
  fetchExperimentListView,
} from "@/lib/client-api";
import { filterExperimentListItems } from "@/lib/experiment-list-view";
import { trackEvent } from "@/lib/telemetry-client";
import { cn } from "@/lib/utils";
import type { ExperimentListItem } from "@/lib/factory-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  PageIntro,
  SectionPanel,
  StatLedger,
  TableHeaderCell,
  TableShell,
} from "@/components/ui/page-layout";

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

function statusTone(status: (typeof STATUS_OPTIONS)[number]) {
  if (status === "Running") {
    return "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]";
  }
  if (status === "Sourcing" || status === "Ready" || status === "Promoted") {
    return "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] text-[color:var(--accent)]";
  }
  if (status === "Paused") {
    return "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]";
  }
  if (status === "Blocked") {
    return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]";
  }
  if (status === "Completed") {
    return "border-[color:var(--border-strong)] bg-[color:var(--surface-muted)] text-[color:var(--foreground)]";
  }
  return "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)]";
}

function leadsCell(item: ExperimentListItem) {
  if (item.sourcedLeads > 0) return item.sourcedLeads;
  if (item.scheduledMessages > 0) return item.scheduledMessages;
  return item.sentMessages;
}

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

function countForStatus(items: ExperimentListItem[], status: (typeof STATUS_OPTIONS)[number]) {
  if (status === "all") return items.length;
  return items.filter((item) => item.status === status).length;
}

export default function ExperimentsClient({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<ExperimentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState("");
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [query, setQuery] = useState("");

  const refresh = async () => {
    const listRows = await fetchExperimentListView(brandId);
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

  const filtered = useMemo(
    () =>
      filterExperimentListItems({
        items,
        status: statusFilter,
        query,
      }),
    [items, query, statusFilter]
  );

  const quickFilters = useMemo(
    () => [
      { label: "All", status: "all" as const, count: items.length },
      {
        label: "Running",
        status: "Running" as const,
        count: items.filter((item) => item.status === "Running").length,
      },
      {
        label: "Draft",
        status: "Draft" as const,
        count: items.filter((item) => item.status === "Draft").length,
      },
      {
        label: "Completed",
        status: "Completed" as const,
        count: items.filter((item) => item.status === "Completed").length,
      },
      {
        label: "Promoted",
        status: "Promoted" as const,
        count: items.filter((item) => item.status === "Promoted").length,
      },
    ],
    [items]
  );

  return (
    <div className="space-y-8">
      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
      {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading experiments...</div> : null}

      <PageIntro
        title="Experiments"
        description="Test new offers and audiences before promoting them to campaigns."
        actions={
          <>
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
                  router.push(`/brands/${brandId}/experiments/${created.id}`);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to create experiment");
                } finally {
                  setCreating(false);
                }
              }}
            >
              <Plus className="h-4 w-4" />
              {creating ? "Creating..." : "Create experiment"}
            </Button>
            <Button asChild variant="outline">
              <Link href={`/brands/${brandId}/experiments/suggestions`}>View suggestions</Link>
            </Button>
          </>
        }
        aside={
          <StatLedger
            items={quickFilters.map((item) => ({
              label: item.label,
              value: formatCount(item.count),
              active: statusFilter === item.status,
              onClick: () => setStatusFilter(item.status),
            }))}
          />
        }
      />

      <SectionPanel className="border-[color:var(--border-strong)]">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((status) => {
              const active = statusFilter === status;
              return (
                <button
                  key={status}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    "rounded-[8px] border px-3 py-1.5 text-sm transition-colors",
                    active
                      ? status === "all"
                        ? "border-[color:var(--border-strong)] bg-[color:var(--surface-muted)] text-[color:var(--foreground)]"
                        : statusTone(status)
                      : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
                  )}
                >
                  {`${statusLabel(status)} (${countForStatus(items, status)})`}
                </button>
              );
            })}
            </div>

            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[color:var(--muted-foreground)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search experiments"
                className="pl-9"
              />
            </div>
          </div>

          {filtered.length ? (
            <TableShell>
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
                  <tr>
                    <TableHeaderCell className="pr-4">Name</TableHeaderCell>
                    <TableHeaderCell className="pr-4">Status</TableHeaderCell>
                    <TableHeaderCell className="pr-4">Audience</TableHeaderCell>
                    <TableHeaderCell align="right" className="px-2 whitespace-nowrap">
                      Leads
                    </TableHeaderCell>
                    <TableHeaderCell align="right" className="px-2 whitespace-nowrap">
                      Replies
                    </TableHeaderCell>
                    <TableHeaderCell align="right" className="px-2 whitespace-nowrap">
                      Positive
                    </TableHeaderCell>
                    <TableHeaderCell className="px-2 whitespace-nowrap">Last active</TableHeaderCell>
                    <TableHeaderCell align="right" className="pl-4 whitespace-nowrap">
                      Actions
                    </TableHeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      className="group cursor-pointer border-t border-[color:var(--border)] transition-colors hover:bg-[color:var(--surface-muted)] focus-within:bg-[color:var(--surface-muted)]"
                      tabIndex={0}
                      onClick={() => {
                        router.push(item.openHref);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") {
                          return;
                        }
                        event.preventDefault();
                        router.push(item.openHref);
                      }}
                    >
                      <td className="py-2 pr-4 align-top font-medium">
                        <div className="flex items-start gap-3">
                          <span
                            className={cn(
                              "mt-1 h-10 w-1 rounded-[2px]",
                              item.status === "Running"
                                ? "bg-[color:var(--success)]"
                                : item.status === "Paused"
                                  ? "bg-[color:var(--warning)]"
                                  : item.status === "Blocked"
                                    ? "bg-[color:var(--danger)]"
                                    : item.status === "Sourcing" || item.status === "Ready" || item.status === "Promoted"
                                      ? "bg-[color:var(--accent)]"
                                      : "bg-[color:var(--border)]"
                            )}
                          />
                          <span>{item.name}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-4 align-top">
                        <Badge className={statusTone(item.status)}>{item.status}</Badge>
                      </td>
                      <td className="py-2 pr-4 align-top text-[color:var(--muted-foreground)]">{item.audience || "—"}</td>
                      <td className="py-2 px-2 align-top text-right">{leadsCell(item) || "—"}</td>
                      <td className="py-2 px-2 align-top text-right">{item.replies || "—"}</td>
                      <td className="py-2 px-2 align-top text-right">{item.positiveReplies || "—"}</td>
                      <td className="py-2 px-2 align-top whitespace-nowrap text-[color:var(--muted-foreground)]">
                        {item.lastActivityLabel}
                      </td>
                      <td className="py-2 pl-4 align-top">
                        <div className="flex justify-end gap-1 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
                          <Button size="sm" variant="outline" asChild>
                            <Link
                              href={item.editHref}
                              onClick={(event) => {
                                event.stopPropagation();
                              }}
                            >
                              Edit
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={duplicatingId === item.id}
                            onClick={async (event) => {
                              event.stopPropagation();
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
                                router.push(`/brands/${brandId}/experiments/${duplicate.id}`);
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
            </TableShell>
          ) : (
            <EmptyState
              title="No experiments match this filter."
              description="Adjust the status filter or search query, or create a new test for this brand."
            />
          )}
        </div>
      </SectionPanel>
    </div>
  );
}
