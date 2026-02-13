"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { approveReplyDraftAndSend, fetchInboxThreads } from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, ReplyDraft, ReplyThread } from "@/lib/factory-types";

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
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
          <CardDescription>Reply triage and human-approved draft sending for {brand.name}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Threads</div>
            <div className="text-lg font-semibold">{threads.length}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Open</div>
            <div className="text-lg font-semibold">{openCount}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Positive</div>
            <div className="text-lg font-semibold">{positiveCount}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Draft Queue</div>
            <div className="text-lg font-semibold">{draftQueueCount}</div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-sm text-[color:var(--muted-foreground)]">Loading inbox...</div>
      ) : null}
      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      {!loading && !error && threads.length === 0 && draftQueueCount === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nothing Here Yet</CardTitle>
            <CardDescription>
              Replies appear after you connect a reply mailbox and launch an outreach run.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/outreach">Connect Reply Mailbox</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/brands/${brand.id}/campaigns`}>Launch a Campaign Run</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reply Draft Queue</CardTitle>
          <CardDescription>Drafts require manual send confirmation.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {drafts
            .filter((item) => item.status === "draft")
            .map((draft) => (
              <div key={draft.id} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Thread Table</CardTitle>
          <Input
            placeholder="Filter inbox threads"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-xs"
          />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
                <th className="pb-2">Subject</th>
                <th className="pb-2">Sentiment</th>
                <th className="pb-2">Intent</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Last Message</th>
              </tr>
            </thead>
            <tbody>
              {filteredThreads.map((thread) => (
                <tr key={thread.id} className="border-t border-[color:var(--border)]">
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Button asChild variant="outline">
            <Link href={`/brands/${brand.id}`}>Back to Brand Home</Link>
          </Button>
          <Button asChild>
            <Link href={`/brands/${brand.id}/campaigns`}>Go to Campaigns</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
