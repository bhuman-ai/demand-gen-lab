"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command, Search } from "lucide-react";
import {
  fetchBrand,
  fetchExperimentListView,
  fetchInboxThreads,
  fetchScaleCampaigns,
} from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SearchEntity = {
  id: string;
  group: "Experiments" | "Campaigns" | "Leads" | "Inbox";
  title: string;
  subtitle: string;
  href: string;
  updatedAt: string;
};

function safeDate(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rankResult(result: SearchEntity, query: string) {
  const needle = query.toLowerCase();
  if (!needle) return 0;
  const title = result.title.toLowerCase();
  const subtitle = result.subtitle.toLowerCase();
  if (title.startsWith(needle)) return 0;
  if (title.includes(needle)) return 1;
  if (subtitle.includes(needle)) return 2;
  return 9;
}

export default function GlobalCommandPalette({ activeBrandId }: { activeBrandId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [entities, setEntities] = useState<SearchEntity[]>([]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...entities]
      .filter((row) => {
        if (!needle) return true;
        const haystack = `${row.title} ${row.subtitle}`.toLowerCase();
        return haystack.includes(needle);
      })
      .sort((left, right) => {
        const leftRank = rankResult(left, needle);
        const rightRank = rankResult(right, needle);
        if (leftRank !== rightRank) return leftRank - rightRank;
        return safeDate(right.updatedAt) - safeDate(left.updatedAt);
      })
      .slice(0, 50);
  }, [entities, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setSelectedIndex(0);
        setOpen(true);
        return;
      }

      if (!open) return;

      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, Math.max(0, filtered.length - 1)));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const target = filtered[selectedIndex] ?? filtered[0];
        if (!target) return;
        setOpen(false);
        setQuery("");
        router.push(target.href);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, open, router, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }, [open]);

  useEffect(() => {
    if (!open || !activeBrandId) return;
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [experiments, campaigns, brand, inbox] = await Promise.all([
          fetchExperimentListView(activeBrandId),
          fetchScaleCampaigns(activeBrandId),
          fetchBrand(activeBrandId),
          fetchInboxThreads(activeBrandId),
        ]);
        if (!mounted) return;

        const experimentEntities: SearchEntity[] = experiments.map((item) => ({
          id: `experiment:${item.id}`,
          group: "Experiments",
          title: item.name,
          subtitle: `${item.status} · ${item.audience || "No audience"}`,
          href: `/brands/${activeBrandId}/experiments/${item.id}`,
          updatedAt: item.lastActivityAt || "",
        }));

        const campaignEntities: SearchEntity[] = campaigns.map((item) => ({
          id: `campaign:${item.id}`,
          group: "Campaigns",
          title: item.name,
          subtitle: `${item.status} · Replies ${item.metricsSummary.replies}`,
          href: `/brands/${activeBrandId}/campaigns/${item.id}`,
          updatedAt: item.updatedAt,
        }));

        const leadEntities: SearchEntity[] = (brand.leads || []).map((lead) => ({
          id: `lead:${lead.id}`,
          group: "Leads",
          title: lead.name || "Unnamed lead",
          subtitle: `${lead.channel} · ${lead.status}`,
          href: `/brands/${activeBrandId}/leads`,
          updatedAt: lead.lastTouch || brand.updatedAt,
        }));

        const inboxEntities: SearchEntity[] = inbox.threads.map((thread) => ({
          id: `thread:${thread.id}`,
          group: "Inbox",
          title: thread.subject || "(no subject)",
          subtitle: `${thread.intent} · ${thread.sentiment}`,
          href: `/brands/${activeBrandId}/inbox`,
          updatedAt: thread.lastMessageAt || thread.updatedAt,
        }));

        setEntities([...experimentEntities, ...campaignEntities, ...leadEntities, ...inboxEntities]);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load search index");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, [activeBrandId, open]);

  const grouped = useMemo(() => {
    const map: Record<SearchEntity["group"], SearchEntity[]> = {
      Experiments: [],
      Campaigns: [],
      Leads: [],
      Inbox: [],
    };
    for (const item of filtered) map[item.group].push(item);
    return map;
  }, [filtered]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="inline-flex items-center gap-1.5"
        onClick={() => {
          setQuery("");
          setSelectedIndex(0);
          setOpen(true);
        }}
      >
        <Search className="h-3.5 w-3.5" />
        Global Search
        <span className="hidden rounded border border-[color:var(--border)] px-1.5 py-0.5 text-[10px] text-[color:var(--muted-foreground)] sm:inline-flex">
          <Command className="mr-0.5 h-2.5 w-2.5" />K
        </span>
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-16" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-2xl rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-[color:var(--border)] p-3">
              <Input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedIndex(0);
                }}
                placeholder="Search experiments, campaigns, leads, inbox"
              />
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-2">
              {loading ? <div className="p-2 text-sm text-[color:var(--muted-foreground)]">Loading search index...</div> : null}
              {error ? <div className="p-2 text-sm text-[color:var(--danger)]">{error}</div> : null}
              {!loading && !error && !filtered.length ? (
                <div className="p-2 text-sm text-[color:var(--muted-foreground)]">No results.</div>
              ) : null}

              {(["Experiments", "Campaigns", "Leads", "Inbox"] as const).map((group) => {
                const rows = grouped[group];
                if (!rows.length) return null;
                return (
                  <div key={group} className="mb-2">
                    <div className="px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
                      {group}
                    </div>
                    <div className="space-y-1">
                      {rows.map((row) => {
                        const globalIndex = filtered.findIndex((item) => item.id === row.id);
                        const isSelected = globalIndex === selectedIndex;
                        return (
                          <button
                            key={row.id}
                            type="button"
                            onMouseEnter={() => setSelectedIndex(globalIndex)}
                            onClick={() => {
                              setOpen(false);
                              setQuery("");
                              router.push(row.href);
                            }}
                            className={`w-full rounded-lg px-2 py-2 text-left ${isSelected ? "bg-[color:var(--accent-soft)]" : "hover:bg-[color:var(--surface-muted)]"}`}
                          >
                            <div className="text-sm font-medium text-[color:var(--foreground)]">{row.title}</div>
                            <div className="text-xs text-[color:var(--muted-foreground)]">{row.subtitle}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
