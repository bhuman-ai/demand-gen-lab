"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import {
  createExperimentApi,
  deleteExperimentApi,
  fetchExperiment,
  fetchExperimentListView,
} from "@/lib/client-api";
import { filterExperimentListItems } from "@/lib/experiment-list-view";
import { trackEvent } from "@/lib/telemetry-client";
import { cn } from "@/lib/utils";
import type { ExperimentListItem } from "@/lib/factory-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import CreateExperimentModal from "@/components/experiments/create-experiment-modal";
import { Input } from "@/components/ui/input";
import ExperimentSuggestionsPanel from "@/components/experiments/experiment-suggestions-panel";
import {
  EmptyState,
  PageIntro,
  SectionPanel,
  StatLedger,
  TableHeaderCell,
  TableShell,
} from "@/components/ui/page-layout";
import { SettingsModal } from "@/app/settings/outreach/settings-primitives";

const STATUS_OPTIONS: Array<"all" | ExperimentListItem["status"]> = [
  "all",
  "Draft",
  "Sourcing",
  "Preparing",
  "Waiting",
  "Sending",
  "Paused",
  "Completed",
  "Promoted",
  "Blocked",
];

function statusLabel(status: (typeof STATUS_OPTIONS)[number]) {
  return status === "all" ? "All statuses" : status;
}

function statusTone(status: (typeof STATUS_OPTIONS)[number]) {
  if (status === "Sending" || status === "Running") {
    return "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]";
  }
  if (
    status === "Sourcing" ||
    status === "Preparing" ||
    status === "Waiting" ||
    status === "Ready" ||
    status === "Promoted"
  ) {
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

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

function formatMetric(value: number, options?: { showZero?: boolean }) {
  if (options?.showZero && value === 0) return 0;
  return value > 0 ? value : "—";
}

function nextActivityForItem(item: ExperimentListItem) {
  if (item.statusDetail) {
    return {
      primary: item.statusDetail,
      secondary: `Last activity ${item.lastActivityLabel}`,
    };
  }

  if (item.status === "Completed") {
    return {
      primary: "No pending activity.",
      secondary: `Completed ${item.lastActivityLabel}`,
    };
  }

  if (item.status === "Draft") {
    return {
      primary: "Finish setup and publish messaging before launch.",
      secondary: `Last activity ${item.lastActivityLabel}`,
    };
  }

  if (item.status === "Promoted") {
    return {
      primary: "Experiment was promoted into a campaign.",
      secondary: `Last activity ${item.lastActivityLabel}`,
    };
  }

  return {
    primary: "Open the experiment to inspect the latest state.",
    secondary: `Last activity ${item.lastActivityLabel}`,
  };
}

function countForStatus(items: ExperimentListItem[], status: (typeof STATUS_OPTIONS)[number]) {
  if (status === "all") return items.length;
  return items.filter((item) => item.status === status).length;
}

function isActiveLaunchStatus(status: ExperimentListItem["status"]) {
  return status === "Sending" || status === "Running" || status === "Sourcing";
}

function launchNoticeForItem(item: ExperimentListItem | null, loading: boolean) {
  if (loading) {
    return {
      tone:
        "border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--foreground)]",
      title: "Checking launched experiment",
      detail: "Refreshing the latest run status.",
    };
  }

  if (!item) {
    return null;
  }

  if (item.status === "Sending" || item.status === "Running") {
    return {
      tone:
        "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]",
      title: "Experiment launched and is now sending.",
      detail: "The list below reflects its latest live state.",
    };
  }

  if (item.status === "Sourcing") {
    return {
      tone:
        "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] text-[color:var(--accent)]",
      title: "Experiment launched and is sourcing prospects.",
      detail: "The list below reflects its latest live state.",
    };
  }

  if (item.status === "Blocked") {
    return {
      tone:
        "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
      title: "Launch was submitted, but the latest status is blocked.",
      detail: "Open the experiment to inspect the run and fix what stopped it.",
    };
  }

  if (item.status === "Paused") {
    return {
      tone:
        "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]",
      title: "Experiment launched, but it is currently paused.",
      detail: "Open the experiment to review the run before resuming it.",
    };
  }

  return {
    tone:
      "border-[color:var(--border-strong)] bg-[color:var(--surface-muted)] text-[color:var(--foreground)]",
    title: `Experiment launched. Latest status: ${item.status}.`,
    detail: "The list below reflects the current state after refresh.",
  };
}

export default function ExperimentsClient({
  brandId,
  openSuggestionsOnLoad = false,
  launchedExperimentId = "",
}: {
  brandId: string;
  openSuggestionsOnLoad?: boolean;
  launchedExperimentId?: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ExperimentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [actionMenuId, setActionMenuId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ExperimentListItem | null>(null);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [query, setQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(openSuggestionsOnLoad);
  const [launchNoticeId, setLaunchNoticeId] = useState(launchedExperimentId);

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

  useEffect(() => {
    if (!openSuggestionsOnLoad && !(launchedExperimentId && !loading)) return;
    router.replace(`/brands/${brandId}/experiments`, { scroll: false });
  }, [brandId, launchedExperimentId, loading, openSuggestionsOnLoad, router]);

  useEffect(() => {
    if (!launchedExperimentId) return;
    setLaunchNoticeId(launchedExperimentId);
  }, [launchedExperimentId]);

  useEffect(() => {
    if (!actionMenuId) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-experiment-actions-root]")) {
        return;
      }
      setActionMenuId("");
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActionMenuId("");
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionMenuId]);

  const handleDuplicate = async (item: ExperimentListItem) => {
    setActionMenuId("");
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
      router.push(`/brands/${brandId}/experiments/${duplicate.id}/setup`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate experiment");
    } finally {
      setDuplicatingId("");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setDeletingId(deleteTarget.id);
    setError("");
    try {
      await deleteExperimentApi(brandId, deleteTarget.id);
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete experiment");
    } finally {
      setDeletingId("");
    }
  };

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
        label: "Sending",
        status: "Sending" as const,
        count: items.filter((item) => item.status === "Sending" || item.status === "Running").length,
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

  const launchedItem = useMemo(
    () => (launchNoticeId ? items.find((item) => item.id === launchNoticeId) ?? null : null),
    [items, launchNoticeId]
  );

  const launchNotice = useMemo(
    () => (launchNoticeId ? launchNoticeForItem(launchedItem, loading) : null),
    [launchedItem, launchNoticeId, loading]
  );

  return (
    <div className="space-y-8">
      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
      {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading experiments...</div> : null}
      {launchNotice ? (
        <div className={cn("rounded-[12px] border px-4 py-3 text-sm", launchNotice.tone)}>
          <div className="font-medium">{launchNotice.title}</div>
          <div className="mt-1 opacity-90">{launchNotice.detail}</div>
        </div>
      ) : null}

      <PageIntro
        title="Experiments"
        description="Test new offers and audiences before promoting them to campaigns."
        actions={
          <>
            <Button
              type="button"
              disabled={creating}
              onClick={() => {
                setError("");
                setCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              {creating ? "Creating..." : "Create experiment"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setSuggestionsOpen(true)}>
              View suggestions
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
              <table className="w-full min-w-[1280px] text-sm">
                <colgroup>
                  <col className="w-[23%]" />
                  <col className="w-[10%]" />
                  <col className="w-[25%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                  <col className="w-[6%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead>
                  <tr>
                    <TableHeaderCell className="pr-4">Name</TableHeaderCell>
                    <TableHeaderCell className="pr-4">Status</TableHeaderCell>
                    <TableHeaderCell className="pr-4">Audience</TableHeaderCell>
                    <TableHeaderCell align="right" className="px-2 whitespace-nowrap">
                      Prospects
                    </TableHeaderCell>
                    <TableHeaderCell align="right" className="px-2 whitespace-nowrap">
                      Sent
                    </TableHeaderCell>
                    <TableHeaderCell align="right" className="px-2 whitespace-nowrap">
                      Replies
                    </TableHeaderCell>
                    <TableHeaderCell align="right" className="px-2 whitespace-nowrap">
                      Positive
                    </TableHeaderCell>
                    <TableHeaderCell className="px-2 whitespace-nowrap">Next Activity</TableHeaderCell>
                    <TableHeaderCell align="right" className="pl-4 whitespace-nowrap">
                      Actions
                    </TableHeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const launched = launchNoticeId === item.id;
                    const launchedAndActive = launched && isActiveLaunchStatus(item.status);
                    const nextActivity = nextActivityForItem(item);
                    return (
                      <tr
                        key={item.id}
                        className={cn(
                          "group cursor-pointer border-t border-[color:var(--border)] transition-colors focus-within:bg-[color:var(--surface-muted)] hover:bg-[color:var(--surface-muted)]",
                          launchedAndActive && "bg-[color:var(--success-soft)]"
                        )}
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
                                item.status === "Sending" || item.status === "Running"
                                  ? "bg-[color:var(--success)]"
                                  : item.status === "Paused"
                                    ? "bg-[color:var(--warning)]"
                                    : item.status === "Blocked"
                                      ? "bg-[color:var(--danger)]"
                                        : item.status === "Sourcing" ||
                                            item.status === "Preparing" ||
                                            item.status === "Waiting" ||
                                            item.status === "Ready" ||
                                            item.status === "Promoted"
                                          ? "bg-[color:var(--accent)]"
                                          : "bg-[color:var(--border)]"
                              )}
                            />
                            <span>{item.name}</span>
                          </div>
                        </td>
                        <td className="py-2 pr-4 align-top">
                          <Badge className={statusTone(item.status)} title={item.statusDetail}>
                            {item.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 align-top text-[color:var(--muted-foreground)]">{item.audience || "—"}</td>
                        <td className="py-2 px-2 align-top text-right">{formatMetric(item.sourcedLeads)}</td>
                        <td className="py-2 px-2 align-top text-right">{formatMetric(item.sentMessages, { showZero: true })}</td>
                        <td className="py-2 px-2 align-top text-right">{formatMetric(item.replies)}</td>
                        <td className="py-2 px-2 align-top text-right">{formatMetric(item.positiveReplies)}</td>
                        <td className="py-2 px-2 align-top">
                          <div
                            className="max-w-[16rem] space-y-1"
                            title={nextActivity.primary}
                          >
                            <div className="text-sm text-[color:var(--foreground)]">{nextActivity.primary}</div>
                            <div className="text-xs text-[color:var(--muted-foreground)]">{nextActivity.secondary}</div>
                          </div>
                        </td>
                        <td className="py-2 pl-4 align-top">
                          <div
                            data-experiment-actions-root
                            className="relative flex justify-end opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-haspopup="menu"
                              aria-expanded={actionMenuId === item.id}
                              aria-label={`Open actions for ${item.name}`}
                              onClick={() => {
                                setActionMenuId((current) => (current === item.id ? "" : item.id));
                              }}
                            >
                              <span className="text-lg leading-none tracking-[0.18em]">...</span>
                            </Button>
                            {actionMenuId === item.id ? (
                              <div
                                role="menu"
                                aria-label={`Actions for ${item.name}`}
                                className="absolute right-0 top-[calc(100%+8px)] z-20 min-w-[10rem] overflow-hidden rounded-[14px] border border-[color:var(--border-strong)] bg-[color:var(--surface)] p-1 shadow-[0_16px_40px_rgba(15,23,42,0.14)]"
                              >
                                <Link
                                  href={item.editHref}
                                  role="menuitem"
                                  className="block rounded-[10px] px-3 py-2 text-left text-sm text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--surface-muted)]"
                                  onClick={() => {
                                    setActionMenuId("");
                                  }}
                                >
                                  Edit
                                </Link>
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={duplicatingId === item.id}
                                  className="block w-full rounded-[10px] px-3 py-2 text-left text-sm text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={() => {
                                    void handleDuplicate(item);
                                  }}
                                >
                                  {duplicatingId === item.id ? "Duplicating..." : "Duplicate"}
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  disabled={deletingId === item.id}
                                  className="block w-full rounded-[10px] px-3 py-2 text-left text-sm text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                                  onClick={() => {
                                    setActionMenuId("");
                                    setDeleteTarget(item);
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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

      <SettingsModal
        open={suggestionsOpen}
        title="Experiment lab"
        description="Pressure-test experiment ideas or outreach-flow angles before you build from scratch."
        panelClassName="max-w-7xl"
        bodyClassName="p-0"
        onOpenChange={setSuggestionsOpen}
      >
        <ExperimentSuggestionsPanel brandId={brandId} />
      </SettingsModal>

      <CreateExperimentModal
        brandId={brandId}
        open={createOpen}
        defaultName={`Experiment ${items.length + 1}`}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setCreating(false);
        }}
        onCreated={(experiment, source) => {
          setCreating(false);
          trackEvent("experiment_created", { brandId, experimentId: experiment.id, source });
          router.push(`/brands/${brandId}/experiments/${experiment.id}/setup`);
        }}
      />

      <SettingsModal
        open={Boolean(deleteTarget)}
        title="Delete experiment?"
        description={
          deleteTarget
            ? `Delete "${deleteTarget.name}" and all of its run history?`
            : "Delete this experiment and all of its run history?"
        }
        onOpenChange={(open) => {
          if (!open && !deletingId) {
            setDeleteTarget(null);
          }
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={Boolean(deletingId)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                void handleDelete();
              }}
              disabled={!deleteTarget || Boolean(deletingId)}
            >
              {deletingId ? "Deleting..." : "Delete"}
            </Button>
          </div>
        }
      >
        <div className="text-sm text-[color:var(--muted-foreground)]">
          This removes the experiment, its runs, and the related run history from this brand.
        </div>
      </SettingsModal>
    </div>
  );
}
