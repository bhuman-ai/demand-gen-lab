"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FolderKanban, Inbox, ListTodo, Mail, Plus, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, SectionPanel } from "@/components/ui/page-layout";
import { fetchBrands, fetchExperiments, fetchScaleCampaigns } from "@/lib/client-api";
import type { BrandRecord, ExperimentRecord, InboxRow, ScaleCampaignRecord } from "@/lib/factory-types";
import { cn } from "@/lib/utils";

type BrandOverview = {
  brand: BrandRecord;
  experiments: ExperimentRecord[];
  campaigns: ScaleCampaignRecord[];
};

type QueueItem = {
  brandId: string;
  brandName: string;
  subject: string;
  from: string;
  receivedAt: string;
};

type NextAction = {
  brandId: string;
  brandName: string;
  label: string;
  detail: string;
  href: string;
};

function pluralize(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatRelativeTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "now";

  const diffMs = Date.now() - parsed.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "now";
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.max(1, Math.round(diffMs / hour))}h ago`;
  if (diffMs < 7 * day) return `${Math.max(1, Math.round(diffMs / day))}d ago`;

  return parsed.toLocaleDateString();
}

function countOpenReplies(inbox: InboxRow[]) {
  return inbox.filter((row) => row.status !== "closed").length;
}

function countLiveExperiments(experiments: ExperimentRecord[]) {
  return experiments.filter((row) => row.status === "running" || row.status === "ready").length;
}

function countLiveCampaigns(campaigns: ScaleCampaignRecord[]) {
  return campaigns.filter((row) => row.status === "active").length;
}

function buildNextAction(entry: BrandOverview): NextAction {
  const openReplies = countOpenReplies(entry.brand.inbox);
  const liveExperiments = countLiveExperiments(entry.experiments);
  const liveCampaigns = countLiveCampaigns(entry.campaigns);
  const totalLeads = entry.brand.leads.length;

  if (openReplies > 0) {
    return {
      brandId: entry.brand.id,
      brandName: entry.brand.name,
      label: "Open inbox",
      detail: `${pluralize(openReplies, "reply")} waiting.`,
      href: `/brands/${entry.brand.id}/inbox`,
    };
  }

  if (!entry.experiments.length) {
    return {
      brandId: entry.brand.id,
      brandName: entry.brand.name,
      label: "Start test",
      detail: "No experiment yet.",
      href: `/brands/${entry.brand.id}`,
    };
  }

  if (!totalLeads) {
    return {
      brandId: entry.brand.id,
      brandName: entry.brand.name,
      label: "Add leads",
      detail: "No leads loaded.",
      href: `/brands/${entry.brand.id}/leads`,
    };
  }

  if (!liveExperiments && !liveCampaigns) {
    return {
      brandId: entry.brand.id,
      brandName: entry.brand.name,
      label: "Check tests",
      detail: "Nothing is moving right now.",
      href: `/brands/${entry.brand.id}/experiments`,
    };
  }

  if (liveCampaigns > 0) {
    return {
      brandId: entry.brand.id,
      brandName: entry.brand.name,
      label: "Check campaigns",
      detail: `${pluralize(liveCampaigns, "campaign")} live.`,
      href: `/brands/${entry.brand.id}/campaigns`,
    };
  }

  return {
    brandId: entry.brand.id,
    brandName: entry.brand.name,
    label: "Open brand",
    detail: `${pluralize(liveExperiments, "test")} moving.`,
    href: `/brands/${entry.brand.id}`,
  };
}

export default function WorkspaceOverview() {
  const [overview, setOverview] = useState<BrandOverview[]>([]);
  const [activeBrandId, setActiveBrandId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setActiveBrandId(localStorage.getItem("factory.activeBrandId") || "");
  }, []);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const brands = await fetchBrands();
        const rows = await Promise.all(
          brands.map(async (brand) => {
            const [experiments, campaigns] = await Promise.allSettled([
              fetchExperiments(brand.id),
              fetchScaleCampaigns(brand.id),
            ]);

            return {
              brand,
              experiments: experiments.status === "fulfilled" ? experiments.value : [],
              campaigns: campaigns.status === "fulfilled" ? campaigns.value : [],
            };
          })
        );

        if (!mounted) return;
        setOverview(rows);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load overview");
        setOverview([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, []);

  const sortedOverview = useMemo(() => {
    const rows = [...overview];

    rows.sort((left, right) => {
      const leftActive = left.brand.id === activeBrandId ? 1 : 0;
      const rightActive = right.brand.id === activeBrandId ? 1 : 0;
      if (leftActive !== rightActive) return rightActive - leftActive;

      const leftReplies = countOpenReplies(left.brand.inbox);
      const rightReplies = countOpenReplies(right.brand.inbox);
      if (leftReplies !== rightReplies) return rightReplies - leftReplies;

      return new Date(right.brand.updatedAt).getTime() - new Date(left.brand.updatedAt).getTime();
    });

    return rows;
  }, [overview, activeBrandId]);

  const activeBrand = useMemo(
    () => sortedOverview.find((entry) => entry.brand.id === activeBrandId) ?? null,
    [sortedOverview, activeBrandId]
  );
  const currentBrand = activeBrand ?? sortedOverview[0] ?? null;

  const totals = useMemo(() => {
    return sortedOverview.reduce(
      (result, entry) => {
        result.brands += 1;
        result.leads += entry.brand.leads.length;
        result.replies += countOpenReplies(entry.brand.inbox);
        result.liveExperiments += countLiveExperiments(entry.experiments);
        result.liveCampaigns += countLiveCampaigns(entry.campaigns);
        return result;
      },
      {
        brands: 0,
        leads: 0,
        replies: 0,
        liveExperiments: 0,
        liveCampaigns: 0,
      }
    );
  }, [sortedOverview]);

  const replyQueue = useMemo<QueueItem[]>(() => {
    return sortedOverview
      .flatMap((entry) =>
        entry.brand.inbox
          .filter((row) => row.status !== "closed")
          .map((row) => ({
            brandId: entry.brand.id,
            brandName: entry.brand.name,
            subject: row.subject || "No subject",
            from: row.from,
            receivedAt: row.receivedAt,
          }))
      )
      .sort((left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime())
      .slice(0, 6);
  }, [sortedOverview]);

  const nextActions = useMemo(() => {
    return sortedOverview.map((entry) => buildNextAction(entry)).slice(0, 6);
  }, [sortedOverview]);

  const summaryItems = [
    {
      label: "Brands",
      value: totals.brands,
      detail: currentBrand ? currentBrand.brand.name : "None picked",
    },
    {
      label: "Leads",
      value: totals.leads,
      detail: totals.leads ? "Loaded" : "Empty",
    },
    {
      label: "Replies",
      value: totals.replies,
      detail: totals.replies ? "Need a look" : "Clear",
    },
    {
      label: "Tests live",
      value: totals.liveExperiments,
      detail: totals.liveExperiments ? "Ready or running" : "Quiet",
    },
    {
      label: "Campaigns live",
      value: totals.liveCampaigns,
      detail: totals.liveCampaigns ? "Sending now" : "None live",
    },
  ];

  if (!loading && !sortedOverview.length) {
    return (
      <EmptyState
        title="No brands yet."
        description="Create a brand first. After that, this page becomes the quick place to check replies, tests, campaigns, and leads."
        actions={
          <Button asChild>
            <Link href="/brands/new">
              <Plus className="h-4 w-4" />
              Create brand
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 border-b border-[color:var(--border)] pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-[1.65rem] font-semibold tracking-[-0.05em] text-[color:var(--foreground)]">Overview</h1>
          <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">
            {currentBrand ? `Current brand: ${currentBrand.brand.name}` : "Pick a brand and keep moving."}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {currentBrand ? (
            <Button asChild>
              <Link href={`/brands/${currentBrand.brand.id}`}>
                <ArrowRight className="h-4 w-4" />
                Open current brand
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link href="/brands">
              <Target className="h-4 w-4" />
              Brands
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/brands/new">
              <Plus className="h-4 w-4" />
              New brand
            </Link>
          </Button>
        </div>
      </section>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <section className="overflow-hidden rounded-[10px] border border-[color:var(--border)] bg-[color:var(--border)]">
        <div
          className="grid gap-px"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
        >
          {summaryItems.map((item) => (
            <div key={item.label} className="bg-[color:var(--surface)] px-4 py-4">
              <div className="text-[12px] text-[color:var(--muted-foreground)]">{item.label}</div>
              <div className="mt-3 text-[1.8rem] font-semibold leading-none tracking-[-0.06em] text-[color:var(--foreground)]">
                {item.value}
              </div>
              <div className="mt-2 text-sm text-[color:var(--foreground)]">{item.detail}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <SectionPanel title="Brands" contentClassName="p-0">
          {loading ? (
            <div className="px-4 py-5 text-sm text-[color:var(--muted-foreground)]">Loading overview...</div>
          ) : (
            sortedOverview.map((entry, index) => {
              const leads = entry.brand.leads.length;
              const openReplies = countOpenReplies(entry.brand.inbox);
              const liveExperiments = countLiveExperiments(entry.experiments);
              const liveCampaigns = countLiveCampaigns(entry.campaigns);
              const action = buildNextAction(entry);
              const isActive = currentBrand ? entry.brand.id === currentBrand.brand.id : false;

              return (
                <div
                  key={entry.brand.id}
                  className={cn(
                    "grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)_auto]",
                    index > 0 ? "border-t border-[color:var(--border)]" : "",
                    isActive ? "bg-[color:var(--surface-muted)]" : ""
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        href={`/brands/${entry.brand.id}`}
                        className="text-base font-semibold tracking-[-0.04em] text-[color:var(--foreground)]"
                      >
                        {entry.brand.name}
                      </Link>
                      {isActive ? <div className="text-xs text-[color:var(--muted-foreground)]">Active</div> : null}
                    </div>
                    <div className="mt-1 truncate text-sm text-[color:var(--muted-foreground)]">
                      {entry.brand.website || "No website"}
                    </div>
                    <div className="mt-3 text-sm text-[color:var(--foreground)]">{action.detail}</div>
                    <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                      Updated {formatRelativeTime(entry.brand.updatedAt)}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <div className="text-[12px] text-[color:var(--muted-foreground)]">Leads</div>
                      <div className="mt-1 font-medium text-[color:var(--foreground)]">{leads}</div>
                    </div>
                    <div>
                      <div className="text-[12px] text-[color:var(--muted-foreground)]">Replies</div>
                      <div className="mt-1 font-medium text-[color:var(--foreground)]">{openReplies}</div>
                    </div>
                    <div>
                      <div className="text-[12px] text-[color:var(--muted-foreground)]">Tests live</div>
                      <div className="mt-1 font-medium text-[color:var(--foreground)]">{liveExperiments}</div>
                    </div>
                    <div>
                      <div className="text-[12px] text-[color:var(--muted-foreground)]">Campaigns live</div>
                      <div className="mt-1 font-medium text-[color:var(--foreground)]">{liveCampaigns}</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    <Button size="sm" asChild>
                      <Link href={`/brands/${entry.brand.id}`}>Open</Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/brands/${entry.brand.id}/inbox`}>
                        <Inbox className="h-4 w-4" />
                        Inbox
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/brands/${entry.brand.id}/campaigns`}>
                        <FolderKanban className="h-4 w-4" />
                        Campaigns
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </SectionPanel>

        <div className="grid gap-6">
          <SectionPanel title="Reply queue" contentClassName="p-0">
            {replyQueue.length ? (
              replyQueue.map((item, index) => (
                <Link
                  key={`${item.brandId}-${item.subject}-${item.receivedAt}`}
                  href={`/brands/${item.brandId}/inbox`}
                  className={cn(
                    "block px-4 py-3 transition-colors hover:bg-[color:var(--surface-muted)]",
                    index > 0 ? "border-t border-[color:var(--border)]" : ""
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[color:var(--foreground)]">{item.subject}</div>
                      <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                        {item.brandName} · {item.from}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-[color:var(--muted-foreground)]">
                      {formatRelativeTime(item.receivedAt)}
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="px-4 py-4 text-sm text-[color:var(--muted-foreground)]">No replies waiting.</div>
            )}
          </SectionPanel>

          <SectionPanel title="Next actions" contentClassName="p-0">
            {nextActions.length ? (
              nextActions.map((item, index) => (
                <Link
                  key={`${item.brandId}-${item.label}`}
                  href={item.href}
                  className={cn(
                    "flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--surface-muted)]",
                    index > 0 ? "border-t border-[color:var(--border)]" : ""
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[color:var(--foreground)]">
                      {item.brandName} · {item.label}
                    </div>
                    <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{item.detail}</div>
                  </div>
                  <ListTodo className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]" />
                </Link>
              ))
            ) : (
              <div className="px-4 py-4 text-sm text-[color:var(--muted-foreground)]">Nothing to do right now.</div>
            )}
          </SectionPanel>

          <SectionPanel title="Shortcuts" contentClassName="px-4 py-4">
            <div className="grid gap-2">
              <Button asChild variant="outline" className="justify-start">
                <Link href="/brands">
                  <Target className="h-4 w-4" />
                  Open brands
                </Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <Link href="/brands/new">
                  <Plus className="h-4 w-4" />
                  Make new brand
                </Link>
              </Button>
              {currentBrand ? (
                <Button asChild variant="outline" className="justify-start">
                  <Link href={`/brands/${currentBrand.brand.id}/leads`}>
                    <Mail className="h-4 w-4" />
                    Open leads
                  </Link>
                </Button>
              ) : null}
            </div>
          </SectionPanel>
        </div>
      </div>
    </div>
  );
}
