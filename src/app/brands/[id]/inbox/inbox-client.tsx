"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { approveReplyDraftAndSend, fetchInboxThreads } from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, ReplyDraft, ReplyThread } from "@/lib/factory-types";
import {
  EmptyState,
  PageIntro,
  SectionPanel,
  StatLedger,
  TableHeaderCell,
  TableShell,
} from "@/components/ui/page-layout";

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

export default function InboxClient({ brand }: { brand: BrandRecord }) {
  const [threads, setThreads] = useState<ReplyThread[]>([]);
  const [drafts, setDrafts] = useState<ReplyDraft[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [sendingDraftId, setSendingDraftId] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    const rows = await fetchInboxThreads(brand.id);
    setThreads(rows.threads);
    setDrafts(rows.drafts);
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void fetchInboxThreads(brand.id)
      .then((rows) => {
        if (!mounted) return;
        setThreads(rows.threads);
        setDrafts(rows.drafts);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load inbox threads");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    trackEvent("ops_module_opened", { module: "inbox", brandId: brand.id });

    return () => {
      mounted = false;
    };
  }, [brand.id]);

  const filteredThreads = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((item) =>
      [item.subject, item.sentiment, item.status, item.intent, item.runId]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [threads, query]);

  const openCount = threads.filter((item) => item.status !== "closed").length;
  const positiveCount = threads.filter((item) => item.sentiment === "positive").length;
  const draftQueueCount = drafts.filter((item) => item.status === "draft").length;

  return (
    <div className="space-y-8">
      <PageIntro
        eyebrow={`${brand.name} / inbox`}
        title="Keep the reply trail close to the campaigns that created it."
        description="Threads, drafted responses, and final human approval all belong in the same product as the experiment and campaign work behind them."
        aside={
          <StatLedger
            items={[
              { label: "Threads", value: formatCount(threads.length), detail: "All reply threads in this brand workspace." },
              { label: "Open", value: formatCount(openCount), detail: "Conversations still requiring attention." },
              { label: "Positive", value: formatCount(positiveCount), detail: "Threads carrying clear buying signal." },
              { label: "Draft queue", value: formatCount(draftQueueCount), detail: "Replies waiting for manual approval." },
            ]}
          />
        }
      />

      {loading ? (
        <div className="text-sm text-[color:var(--muted-foreground)]">Loading inbox...</div>
      ) : null}
      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      {!loading && !error && threads.length === 0 && draftQueueCount === 0 ? (
        <EmptyState
          title="Nothing here yet."
          description="Replies appear after you connect a reply mailbox and launch an outreach run."
          actions={
            <>
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/outreach">Connect Reply Mailbox</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/brands/${brand.id}/campaigns`}>Launch a Campaign Run</Link>
            </Button>
            </>
          }
        />
      ) : null}

      <SectionPanel title="Reply draft queue" description="Drafts require manual send confirmation." contentClassName="grid gap-3">
          {drafts
            .filter((item) => item.status === "draft")
            .map((draft) => (
              <div key={draft.id} className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{draft.subject}</div>
                  <Badge variant="muted">draft</Badge>
                </div>
                <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{draft.reason}</div>
                <div className="mt-2 whitespace-pre-wrap text-sm">{draft.body}</div>
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    disabled={sendingDraftId === draft.id}
                    onClick={async () => {
                      setSendingDraftId(draft.id);
                      setError("");
                      try {
                        await approveReplyDraftAndSend(brand.id, draft.id);
                        await refresh();
                        trackEvent("reply_draft_sent", { brandId: brand.id, draftId: draft.id });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to send draft");
                      } finally {
                        setSendingDraftId("");
                      }
                    }}
                  >
                    {sendingDraftId === draft.id ? "Sending..." : "Approve & Send"}
                  </Button>
                </div>
              </div>
            ))}

          {!drafts.filter((item) => item.status === "draft").length ? (
            <div className="text-sm text-[color:var(--muted-foreground)]">
              No pending drafts. When replies arrive, we will draft suggested responses here.
            </div>
          ) : null}
      </SectionPanel>

      <SectionPanel
        title="Recent signals"
        description="Filter inbox threads by subject, status, or sentiment."
        actions={
          <Input
            placeholder="Filter inbox threads"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-[18rem]"
          />
        }
      >
        <TableShell>
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <TableHeaderCell>Subject</TableHeaderCell>
                <TableHeaderCell>Sentiment</TableHeaderCell>
                <TableHeaderCell>Intent</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Last message</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {filteredThreads.map((thread) => (
                <tr key={thread.id} className="border-t border-[color:var(--border)] hover:bg-[color:var(--surface-muted)]">
                  <td className="py-2">{thread.subject}</td>
                  <td className="py-2">
                    <Badge
                      variant={
                        thread.sentiment === "positive"
                          ? "success"
                          : thread.sentiment === "negative"
                          ? "danger"
                          : "muted"
                      }
                    >
                      {thread.sentiment}
                    </Badge>
                  </td>
                  <td className="py-2">{thread.intent}</td>
                  <td className="py-2">{thread.status}</td>
                  <td className="py-2">{thread.lastMessageAt || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {!filteredThreads.length ? (
            <div className="py-6 text-sm text-[color:var(--muted-foreground)]">No threads found.</div>
          ) : null}
        </TableShell>
      </SectionPanel>

      <SectionPanel>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/brands/${brand.id}`}>Back to Brand Home</Link>
          </Button>
          <Button asChild>
            <Link href={`/brands/${brand.id}/campaigns`}>Go to Campaigns</Link>
          </Button>
        </div>
      </SectionPanel>
    </div>
  );
}
