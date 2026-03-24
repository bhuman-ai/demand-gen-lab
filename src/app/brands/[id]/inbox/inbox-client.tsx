"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  approveReplyDraftAndSend,
  fetchInboxThreadDetail,
  fetchInboxThreads,
  submitInboxThreadFeedback,
  syncInboxMailbox,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type {
  BrandRecord,
  ReplyDraft,
  ReplyThreadFeedbackType,
  ReplyThread,
  ReplyThreadDetail,
  ReplyThreadFact,
} from "@/lib/factory-types";
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

function formatLabel(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatConfidence(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function moveBadgeVariant(move: string) {
  if (move === "advance_next_step" || move === "answer_question" || move === "offer_proof") {
    return "accent" as const;
  }
  if (move === "handoff_to_human" || move === "reframe_objection") {
    return "danger" as const;
  }
  if (move === "stay_silent" || move === "respect_opt_out") {
    return "muted" as const;
  }
  return "default" as const;
}

function factLabel(value: string) {
  return formatLabel(value);
}

export default function InboxClient({ brand }: { brand: BrandRecord }) {
  const [threads, setThreads] = useState<ReplyThread[]>([]);
  const [drafts, setDrafts] = useState<ReplyDraft[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<ReplyThreadDetail | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [sendingDraftId, setSendingDraftId] = useState("");
  const [syncingMailbox, setSyncingMailbox] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    const rows = await fetchInboxThreads(brand.id);
    setThreads(rows.threads);
    setDrafts(rows.drafts);
    if (selectedThreadId && rows.threads.some((item) => item.id === selectedThreadId)) {
      const detail = await fetchInboxThreadDetail(brand.id, selectedThreadId);
      setSelectedDetail(detail);
    }
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void fetchInboxThreads(brand.id)
      .then((rows) => {
        if (!mounted) return;
        setThreads(rows.threads);
        setDrafts(rows.drafts);
        if (rows.threads.length) {
          setSelectedThreadId((current) =>
            current && rows.threads.some((item) => item.id === current)
              ? current
              : rows.threads[0]?.id ?? ""
          );
        }
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

  useEffect(() => {
    if (!threads.length) {
      setSelectedThreadId("");
      setSelectedDetail(null);
      return;
    }
    if (!selectedThreadId || !threads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(threads[0]?.id ?? "");
    }
  }, [selectedThreadId, threads]);

  useEffect(() => {
    if (!selectedThreadId) {
      setSelectedDetail(null);
      return;
    }

    let mounted = true;
    setDetailLoading(true);
    void fetchInboxThreadDetail(brand.id, selectedThreadId)
      .then((detail) => {
        if (!mounted) return;
        setSelectedDetail(detail);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load thread state");
      })
      .finally(() => {
        if (mounted) setDetailLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [brand.id, selectedThreadId]);

  const filteredThreads = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter((item) =>
      [
        item.subject,
        item.sentiment,
        item.status,
        item.intent,
        item.runId,
        item.sourceType,
        item.contactEmail,
        item.contactName,
        item.contactCompany,
        item.stateSummary?.currentStage ?? "",
        item.stateSummary?.recommendedMove ?? "",
        item.stateSummary?.latestUserAsk ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [threads, query]);

  const threadMap = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread])),
    [threads]
  );
  const openCount = threads.filter((item) => item.status !== "closed").length;
  const humanReviewCount = threads.filter(
    (item) => Boolean(item.stateSummary?.manualReviewReason) || item.stateSummary?.autopilotOk === false
  ).length;
  const draftQueueCount = drafts.filter((item) => item.status === "draft").length;
  const selectedThread =
    threads.find((thread) => thread.id === selectedThreadId) ?? selectedDetail?.thread ?? null;
  const selectedState = selectedDetail?.state;
  const confirmedFacts = selectedState?.canonicalState.evidence.confirmedFacts ?? [];
  const inferredFacts = selectedState?.canonicalState.evidence.inferredFacts ?? [];
  const feedbackActions: Array<{ type: ReplyThreadFeedbackType; label: string }> = [
    { type: "good", label: "Right Move" },
    { type: "wrong_move", label: "Wrong Move" },
    { type: "wrong_facts", label: "Wrong Facts" },
    { type: "too_aggressive", label: "Too Aggressive" },
    { type: "should_be_human", label: "Should Be Human" },
  ];

  const renderFactList = (facts: ReplyThreadFact[], empty: string) =>
    facts.length ? (
      <div className="grid gap-2">
        {facts.map((fact) => (
          <div
            key={`${fact.key}:${fact.value}`}
            className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2"
          >
            <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
              {factLabel(fact.key)}
            </div>
            <div className="mt-1 text-sm text-[color:var(--foreground)]">{fact.value}</div>
            <div className="mt-1 text-[11px] text-[color:var(--muted-foreground)]">
              {fact.source} · {formatConfidence(fact.confidence)}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div className="text-sm text-[color:var(--muted-foreground)]">{empty}</div>
    );

  return (
    <div className="space-y-8">
      <PageIntro
        title="Inbox"
        aside={
          <StatLedger
            items={[
              { label: "Threads", value: formatCount(threads.length), detail: "All reply threads in this brand workspace." },
              { label: "Open", value: formatCount(openCount), detail: "Conversations still requiring attention." },
              { label: "Human review", value: formatCount(humanReviewCount), detail: "Threads the model marked as risky or manual." },
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
          description="Threads appear after a connected brand mailbox or outreach run starts sending inbound mail into the inbox."
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
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{draft.subject}</div>
                    {threadMap.get(draft.threadId)?.stateSummary ? (
                      <div className="mt-1 flex flex-wrap gap-2">
                        <Badge variant="muted">
                          {formatLabel(threadMap.get(draft.threadId)?.stateSummary?.currentStage ?? "")}
                        </Badge>
                        <Badge variant={moveBadgeVariant(threadMap.get(draft.threadId)?.stateSummary?.recommendedMove ?? "")}>
                          {formatLabel(threadMap.get(draft.threadId)?.stateSummary?.recommendedMove ?? "")}
                        </Badge>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="muted">draft</Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedThreadId(draft.threadId);
                      }}
                    >
                      Inspect Thread
                    </Button>
                  </div>
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
        title="Threads"
        description="Filter by subject, stage, move, sentiment, or the latest user ask."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Filter inbox threads"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-[18rem]"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={syncingMailbox}
              onClick={async () => {
                setSyncingMailbox(true);
                setError("");
                setSyncStatus("");
                try {
                  const result = await syncInboxMailbox(brand.id);
                  if (result.threadIds[0]) {
                    setSelectedThreadId(result.threadIds[0]);
                  }
                  setSyncStatus(result.reason);
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to sync mailbox");
                } finally {
                  setSyncingMailbox(false);
                }
              }}
            >
              {syncingMailbox ? "Syncing..." : "Sync Mailbox"}
            </Button>
          </div>
        }
      >
        {syncStatus ? (
          <div className="mb-3 text-sm text-[color:var(--muted-foreground)]">{syncStatus}</div>
        ) : null}
        <TableShell>
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <TableHeaderCell>Subject</TableHeaderCell>
                <TableHeaderCell>Stage</TableHeaderCell>
                <TableHeaderCell>Move</TableHeaderCell>
                <TableHeaderCell>Sentiment</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Last message</TableHeaderCell>
              </tr>
            </thead>
            <tbody>
              {filteredThreads.map((thread) => (
                <tr
                  key={thread.id}
                  className={`border-t border-[color:var(--border)] ${
                    selectedThreadId === thread.id
                      ? "bg-[color:var(--surface-muted)]"
                      : "hover:bg-[color:var(--surface-muted)]"
                  }`}
                >
                  <td className="py-2">
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => setSelectedThreadId(thread.id)}
                    >
                      <div className="font-medium text-[color:var(--foreground)]">{thread.subject}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                        <Badge variant="muted">{thread.sourceType}</Badge>
                        <span>
                          {thread.contactName || thread.contactEmail || thread.contactCompany || thread.stateSummary?.latestUserAsk || thread.intent}
                        </span>
                      </div>
                    </button>
                  </td>
                  <td className="py-2">
                    {thread.stateSummary ? (
                      <Badge variant="muted">{formatLabel(thread.stateSummary.currentStage)}</Badge>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="py-2">
                    {thread.stateSummary ? (
                      <Badge variant={moveBadgeVariant(thread.stateSummary.recommendedMove)}>
                        {formatLabel(thread.stateSummary.recommendedMove)}
                      </Badge>
                    ) : (
                      "-"
                    )}
                  </td>
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
                  <td className="py-2">{thread.status}</td>
                  <td className="py-2">{formatDateTime(thread.lastMessageAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {!filteredThreads.length ? (
            <div className="py-6 text-sm text-[color:var(--muted-foreground)]">No threads found.</div>
          ) : null}
        </TableShell>
      </SectionPanel>

      <SectionPanel
        title="Thread state"
        description={
          selectedThread
            ? "Canonical state, reasoning, evidence, and recent history for the selected thread."
            : "Select a thread to inspect the current stage and reasoning."
        }
      >
        {!selectedThread ? (
          <div className="text-sm text-[color:var(--muted-foreground)]">Select a thread to inspect it.</div>
        ) : detailLoading && !selectedDetail ? (
          <div className="text-sm text-[color:var(--muted-foreground)]">Loading thread state...</div>
        ) : selectedDetail && selectedState ? (
          <div className="space-y-4">
            <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="text-lg font-semibold tracking-[-0.04em] text-[color:var(--foreground)]">
                    {selectedDetail.thread.subject}
                  </div>
                  <div className="text-sm text-[color:var(--muted-foreground)]">
                    {selectedDetail.thread.contactName || selectedDetail.thread.contactEmail || "Unknown contact"}
                    {selectedDetail.thread.contactCompany ? ` · ${selectedDetail.thread.contactCompany}` : ""}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="muted">{selectedDetail.thread.sourceType}</Badge>
                    <Badge variant="muted">
                      {formatLabel(selectedState.canonicalState.thread.currentStage)}
                    </Badge>
                    <Badge variant={moveBadgeVariant(selectedState.latestDecision.recommendedMove)}>
                      {formatLabel(selectedState.latestDecision.recommendedMove)}
                    </Badge>
                    <Badge variant={selectedState.latestDecision.autopilotOk ? "success" : "muted"}>
                      {selectedState.latestDecision.autopilotOk ? "Autopilot OK" : "Manual Check"}
                    </Badge>
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-medium text-[color:var(--foreground)]">
                    Confidence {formatConfidence(selectedState.latestDecision.confidence)}
                  </div>
                  <div className="mt-1 text-[color:var(--muted-foreground)]">
                    Updated {formatDateTime(selectedState.updatedAt)}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {feedbackActions.map((action) => (
                  <Button
                    key={action.type}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={feedbackSubmitting === action.type}
                    onClick={async () => {
                      setFeedbackSubmitting(action.type);
                      setFeedbackStatus("");
                      setError("");
                      try {
                        await submitInboxThreadFeedback(brand.id, selectedDetail.thread.id, action.type);
                        setFeedbackStatus(`${action.label} saved`);
                        await refresh();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to save feedback");
                      } finally {
                        setFeedbackSubmitting("");
                      }
                    }}
                  >
                    {feedbackSubmitting === action.type ? "Saving..." : action.label}
                  </Button>
                ))}
              </div>
              {feedbackStatus ? (
                <div className="mt-3 text-sm text-[color:var(--muted-foreground)]">{feedbackStatus}</div>
              ) : null}

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                    Objective
                  </div>
                  <div className="mt-2 text-sm text-[color:var(--foreground)]">
                    {selectedState.latestDecision.objectiveForThisTurn}
                  </div>
                </div>
                <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                    Latest User Ask
                  </div>
                  <div className="mt-2 text-sm text-[color:var(--foreground)]">
                    {selectedState.canonicalState.thread.latestUserAsk || "No direct ask extracted yet."}
                  </div>
                </div>
                <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                    Desired Outcome
                  </div>
                  <div className="mt-2 text-sm text-[color:var(--foreground)]">
                    {selectedState.canonicalState.org.desiredOutcome || "No explicit outcome found."}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                    Why This Move
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                    {selectedState.latestDecision.rationale}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                    Manual Review
                  </div>
                  <div className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                    {selectedState.latestDecision.manualReviewReason || "No manual review reason is active."}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4">
                <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">Confirmed Facts</div>
                  <div className="mt-3">{renderFactList(confirmedFacts, "No confirmed facts captured yet.")}</div>
                </div>

                <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">Inferred Facts</div>
                  <div className="mt-3">{renderFactList(inferredFacts, "No inferred facts yet.")}</div>
                </div>

                <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">Signals</div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                        Open Questions
                      </div>
                      <div className="mt-2 space-y-2 text-sm text-[color:var(--foreground)]">
                        {selectedState.canonicalState.evidence.openQuestions.length ? (
                          selectedState.canonicalState.evidence.openQuestions.map((item) => (
                            <div key={item} className="rounded-[10px] border border-[color:var(--border)] px-3 py-2">
                              {item}
                            </div>
                          ))
                        ) : (
                          <div className="text-[color:var(--muted-foreground)]">None</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                        Risk Flags
                      </div>
                      <div className="mt-2 space-y-2 text-sm text-[color:var(--foreground)]">
                        {selectedState.canonicalState.evidence.riskFlags.length ? (
                          selectedState.canonicalState.evidence.riskFlags.map((item) => (
                            <div key={item} className="rounded-[10px] border border-[color:var(--danger-border)] px-3 py-2">
                              {item}
                            </div>
                          ))
                        ) : (
                          <div className="text-[color:var(--muted-foreground)]">None</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                        Buying Signals
                      </div>
                      <div className="mt-2 space-y-2 text-sm text-[color:var(--foreground)]">
                        {selectedState.canonicalState.evidence.buyingSignals.length ? (
                          selectedState.canonicalState.evidence.buyingSignals.map((item) => (
                            <div key={item} className="rounded-[10px] border border-[color:var(--success-border)] px-3 py-2">
                              {item}
                            </div>
                          ))
                        ) : (
                          <div className="text-[color:var(--muted-foreground)]">None</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                        Objections
                      </div>
                      <div className="mt-2 space-y-2 text-sm text-[color:var(--foreground)]">
                        {selectedState.canonicalState.evidence.objections.length ? (
                          selectedState.canonicalState.evidence.objections.map((item) => (
                            <div key={item} className="rounded-[10px] border border-[color:var(--border)] px-3 py-2">
                              {item}
                            </div>
                          ))
                        ) : (
                          <div className="text-[color:var(--muted-foreground)]">None</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[color:var(--foreground)]">Current Draft</div>
                    {selectedState.latestDraftMeta.status !== "none" ? (
                      <Badge variant="muted">{selectedState.latestDraftMeta.status}</Badge>
                    ) : null}
                  </div>
                  {selectedState.latestDraftMeta.status === "none" ? (
                    <div className="mt-3 text-sm text-[color:var(--muted-foreground)]">
                      No draft is attached to this thread yet.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                          Subject
                        </div>
                        <div className="mt-1 text-sm text-[color:var(--foreground)]">
                          {selectedState.latestDraftMeta.subject}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                          Reason
                        </div>
                        <div className="mt-1 text-sm text-[color:var(--foreground)]">
                          {selectedState.latestDraftMeta.reason || "No draft reason recorded."}
                        </div>
                      </div>
                      <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 whitespace-pre-wrap text-sm text-[color:var(--foreground)]">
                        {selectedState.canonicalState.draft.body || "No draft body stored in state."}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">Reviewer Feedback</div>
                  <div className="mt-3 space-y-2">
                    {selectedDetail.feedback.length ? (
                      selectedDetail.feedback.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Badge variant="muted">{formatLabel(item.type)}</Badge>
                            <div className="text-xs text-[color:var(--muted-foreground)]">
                              {formatDateTime(item.createdAt)}
                            </div>
                          </div>
                          {item.note ? (
                            <div className="mt-2 text-sm text-[color:var(--foreground)]">{item.note}</div>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-[color:var(--muted-foreground)]">
                        No reviewer feedback recorded yet.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">History</div>
                  <div className="mt-3 space-y-3">
                    {selectedDetail.history.map((item) => (
                      <div
                        key={`${item.source}:${item.id}`}
                        className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={item.direction === "inbound" ? "accent" : "muted"}>
                              {item.direction}
                            </Badge>
                            <div className="text-xs text-[color:var(--muted-foreground)]">
                              {item.status}
                            </div>
                          </div>
                          <div className="text-xs text-[color:var(--muted-foreground)]">
                            {formatDateTime(item.at)}
                          </div>
                        </div>
                        {item.subject ? (
                          <div className="mt-2 text-sm font-medium text-[color:var(--foreground)]">
                            {item.subject}
                          </div>
                        ) : null}
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[color:var(--foreground)]">
                          {item.body}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[color:var(--muted-foreground)]">
            No thread state has been generated yet.
          </div>
        )}
      </SectionPanel>

      <SectionPanel>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/brands/${brand.id}/inbox/evals`}>Eval Lab</Link>
          </Button>
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
