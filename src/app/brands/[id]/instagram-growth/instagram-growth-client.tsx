"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Instagram,
  RefreshCcw,
  Send,
  ShieldCheck,
  SkipForward,
} from "lucide-react";
import { canonicalApiUrl } from "@/lib/client-api-url";
import { cn } from "@/lib/utils";
import styles from "./instagram-growth.module.css";

export type InstagramGrowthAccount = {
  id: string;
  name: string;
  handle: string;
  displayName: string;
  profileUrl: string;
  trustLevel: number;
  cooldownMinutes: number;
  lastSocialCommentAt: string;
  recentActivity24h: number;
  recentActivity7d: number;
};

export type InstagramGrowthOpportunity = {
  id: string;
  title: string;
  body: string;
  author: string;
  community: string;
  query: string;
  url: string;
  status: "new" | "triaged" | "saved" | "dismissed";
  draft: string;
  headline: string;
  fitSummary: string;
  targetStrength: string;
  commentPosture: string;
  riskNotes: string[];
  relevanceScore: number;
  risingScore: number;
  engagementScore: number;
  postedAt: string;
  discoveredAt: string;
  recommendedAccountId: string;
  recommendedAccountName: string;
  recommendedAccountHandle: string;
  commentDelivery: {
    commentUrl: string;
    postedAt: string;
    accountName: string;
    accountHandle: string;
    status: string;
    message: string;
  } | null;
  promotionPurchase: {
    status: string;
    message: string;
    orderUrl: string;
    attemptedAt: string;
  } | null;
};

type QueueFilter = "ready" | "needs_edit" | "posted" | "blocked";

type LocalOpportunity = InstagramGrowthOpportunity & {
  localSkipped?: boolean;
};

const FILTERS: { id: QueueFilter; label: string }[] = [
  { id: "ready", label: "Ready" },
  { id: "needs_edit", label: "Needs edit" },
  { id: "posted", label: "Posted" },
  { id: "blocked", label: "Needs attention" },
];

function shortText(value: string, max = 170) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}...` : cleaned;
}

function relativeDate(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "No date";
  const deltaMs = Date.now() - parsed;
  const minutes = Math.round(deltaMs / 60000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function accountLabel(account: InstagramGrowthAccount) {
  return account.handle || account.displayName || account.name;
}

function cooldownActive(account: InstagramGrowthAccount | null) {
  if (!account?.lastSocialCommentAt || !account.cooldownMinutes) return false;
  const last = Date.parse(account.lastSocialCommentAt);
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < account.cooldownMinutes * 60000;
}

function queueState(opportunity: LocalOpportunity, accounts: InstagramGrowthAccount[]): QueueFilter {
  if (opportunity.commentDelivery?.postedAt) return "posted";
  if (opportunity.localSkipped) return "blocked";
  if (opportunity.status === "dismissed") return "blocked";
  if (opportunity.targetStrength === "skip" || opportunity.commentPosture === "no_comment") return "blocked";
  if (!opportunity.draft.trim()) return "needs_edit";
  const account = accounts.find((entry) => entry.id === opportunity.recommendedAccountId) ?? accounts[0] ?? null;
  if (!account || cooldownActive(account)) return "blocked";
  if (opportunity.riskNotes.length) return "needs_edit";
  return "ready";
}

function stateLabel(state: QueueFilter) {
  if (state === "ready") return "Ready";
  if (state === "needs_edit") return "Needs edit";
  if (state === "posted") return "Posted";
  return "Needs attention";
}

function stateClass(state: QueueFilter) {
  if (state === "ready") return styles.stateReady;
  if (state === "needs_edit") return styles.stateReview;
  if (state === "posted") return styles.statePosted;
  return styles.stateBlocked;
}

function qualityLine(opportunity: InstagramGrowthOpportunity) {
  const parts = [
    opportunity.relevanceScore ? `Fit ${opportunity.relevanceScore}` : "",
    opportunity.risingScore ? `Timing ${opportunity.risingScore}` : "",
    opportunity.engagementScore ? `Engagement ${opportunity.engagementScore}` : "",
  ].filter(Boolean);
  return parts.join(" / ") || "Not scored yet";
}

function firstAccountId(opportunity: InstagramGrowthOpportunity | null, accounts: InstagramGrowthAccount[]) {
  if (!opportunity) return accounts[0]?.id ?? "";
  return opportunity.recommendedAccountId || accounts[0]?.id || "";
}

export default function InstagramGrowthClient({
  brandId,
  brandName,
  opportunities: initialOpportunities,
  accounts,
}: {
  brandId: string;
  brandName: string;
  opportunities: InstagramGrowthOpportunity[];
  accounts: InstagramGrowthAccount[];
}) {
  const [opportunities, setOpportunities] = useState<LocalOpportunity[]>(initialOpportunities);
  const [filter, setFilter] = useState<QueueFilter>("ready");
  const [selectedId, setSelectedId] = useState(initialOpportunities[0]?.id ?? "");
  const selected = opportunities.find((opportunity) => opportunity.id === selectedId) ?? opportunities[0] ?? null;
  const [draft, setDraft] = useState(selected?.draft ?? "");
  const [accountId, setAccountId] = useState(firstAccountId(selected, accounts));
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setOpportunities(initialOpportunities);
    setSelectedId(initialOpportunities[0]?.id ?? "");
  }, [initialOpportunities]);

  useEffect(() => {
    setDraft(selected?.draft ?? "");
    setAccountId(firstAccountId(selected, accounts));
    setNotice("");
    setError("");
  }, [selected?.id, accounts, selected]);

  const counts = useMemo(() => {
    const next: Record<QueueFilter, number> = {
      ready: 0,
      needs_edit: 0,
      posted: 0,
      blocked: 0,
    };
    for (const opportunity of opportunities) {
      next[queueState(opportunity, accounts)] += 1;
    }
    return next;
  }, [opportunities, accounts]);

  const visible = useMemo(
    () => opportunities.filter((opportunity) => queueState(opportunity, accounts) === filter),
    [accounts, filter, opportunities]
  );

  const selectedState = selected ? queueState(selected, accounts) : "blocked";
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null;
  const selectedAccountBlocked = cooldownActive(selectedAccount);
  const canPost =
    Boolean(selected) &&
    selectedState !== "posted" &&
    !selected?.localSkipped &&
    Boolean(accountId) &&
    Boolean(draft.trim()) &&
    !selectedAccountBlocked &&
    !posting;

  function chooseFilter(nextFilter: QueueFilter) {
    setFilter(nextFilter);
    const firstInLane = opportunities.find((opportunity) => queueState(opportunity, accounts) === nextFilter);
    if (firstInLane) setSelectedId(firstInLane.id);
  }

  async function postComment() {
    if (!selected) return;
    setPosting(true);
    setNotice("");
    setError("");
    try {
      const response = await fetch(canonicalApiUrl(`/api/brands/${brandId}/social-discovery/comment`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: selected.id,
          accountId,
          text: draft.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Could not post this comment.");
      }

      const result = data?.result ?? {};
      const updatedPost = data?.post as Partial<InstagramGrowthOpportunity> | undefined;
      const commentDelivery = {
        commentUrl:
          typeof result.commentUrl === "string" && result.commentUrl.trim()
            ? result.commentUrl.trim()
            : selected.commentDelivery?.commentUrl ?? "",
        postedAt: new Date().toISOString(),
        accountName: selectedAccount?.name ?? "",
        accountHandle: selectedAccount?.handle ?? "",
        status: typeof result.deliveryStatus === "string" ? result.deliveryStatus : "accepted_unverified",
        message:
          typeof result.deliveryMessage === "string" && result.deliveryMessage.trim()
            ? result.deliveryMessage.trim()
            : "Instagram accepted the approved comment.",
      };
      setOpportunities((current) =>
        current.map((opportunity) =>
          opportunity.id === selected.id
            ? {
                ...opportunity,
                ...updatedPost,
                draft: draft.trim(),
                commentDelivery,
              }
            : opportunity
        )
      );
      setFilter("posted");
      setNotice("Comment submitted. This item moved to Posted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post this comment.");
    } finally {
      setPosting(false);
    }
  }

  function skipSelected() {
    if (!selected) return;
    setOpportunities((current) =>
      current.map((opportunity) =>
        opportunity.id === selected.id ? { ...opportunity, localSkipped: true } : opportunity
      )
    );
    setFilter("blocked");
    setNotice("Skipped for this review session.");
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <Link href={`/brands/${brandId}/instagram-growth`} className={styles.brandLockup} aria-label="Liftline home">
          <span className={styles.brandMark}>
            <Instagram className={styles.brandIcon} />
          </span>
          <span>
            <span className={styles.brandName}>Liftline</span>
            <span className={styles.brandSubline}>Instagram growth desk</span>
          </span>
        </Link>
        <div className={styles.topContext}>
          <span className={styles.contextItem}>{brandName}</span>
          <span className={styles.contextItem}>
            {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
          </span>
          <Link href={`/brands/${brandId}/social-discovery`} className={styles.secondaryButton}>
            <RefreshCcw className={styles.buttonIcon} />
            Source posts
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.summary}>
          <div className={styles.summaryCopy}>
            <h1>Review the next Instagram opportunity</h1>
            <p>Approve useful comments, keep account health visible, and move one timely post forward.</p>
          </div>
          <div className={styles.summaryAside}>
            <span className={styles.summaryNumber}>{counts.ready}</span>
            <span className={styles.summaryLabel}>ready now</span>
          </div>
        </section>

        <section className={styles.filterRow} aria-label="Queue filters">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => chooseFilter(entry.id)}
              className={cn(styles.filterButton, filter === entry.id ? styles.filterButtonActive : "")}
            >
              <span>{entry.label}</span>
              <strong>{counts[entry.id]}</strong>
            </button>
          ))}
        </section>

        {opportunities.length === 0 ? (
          <section className={styles.emptyState}>
            <div className={styles.emptyCopy}>
              <h2>Build your first review queue</h2>
              <p>
                Source posts from the audience you want to reach. Liftline will turn the best matches into a review
                queue with a draft comment and account-health check.
              </p>
              <Link href={`/brands/${brandId}/social-discovery`} className={styles.primaryButton}>
                <Instagram className={styles.buttonIcon} />
                Source Instagram posts
              </Link>
            </div>
            <ol className={styles.emptySteps}>
              <li>
                <span>1</span>
                <strong>Find relevant posts</strong>
                <p>Start with creators, customers, topics, or competitor communities.</p>
              </li>
              <li>
                <span>2</span>
                <strong>Approve the comment</strong>
                <p>Edit the draft so the reply sounds useful and human.</p>
              </li>
              <li>
                <span>3</span>
                <strong>Protect the account</strong>
                <p>Post only when cooldown and account activity are in range.</p>
              </li>
            </ol>
          </section>
        ) : (
          <div className={styles.boardGrid}>
            <section className={styles.queuePanel} aria-label={`${stateLabel(filter)} queue`}>
              <div className={styles.panelHeader}>
                <h2>{stateLabel(filter)}</h2>
                <span>{visible.length} in lane</span>
              </div>
              {visible.length ? (
                <div className={styles.queueList}>
                  {visible.map((opportunity) => {
                    const state = queueState(opportunity, accounts);
                    const active = selected?.id === opportunity.id;
                    return (
                      <button
                        key={opportunity.id}
                        type="button"
                        onClick={() => setSelectedId(opportunity.id)}
                        className={cn(styles.queueItem, active ? styles.queueItemActive : "")}
                      >
                        <span className={cn(styles.statePill, stateClass(state))}>{stateLabel(state)}</span>
                        <span className={styles.queueTitle}>{opportunity.title}</span>
                        <span className={styles.queueMeta}>
                          {opportunity.author ? `@${opportunity.author}` : "Unknown author"}
                          {opportunity.query ? ` / ${opportunity.query}` : ""}
                        </span>
                        <span className={styles.queueExcerpt}>
                          {shortText(opportunity.body || opportunity.fitSummary || opportunity.headline, 150) ||
                            "No caption captured yet."}
                        </span>
                        <span className={styles.queueFooter}>
                          <span>{qualityLine(opportunity)}</span>
                          <span>{relativeDate(opportunity.discoveredAt || opportunity.postedAt)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.emptyLane}>No items in this lane.</div>
              )}
            </section>

            <section className={styles.reviewPanel} aria-label="Opportunity review">
              {selected ? (
                <>
                  <div className={styles.reviewHeader}>
                    <div>
                      <span className={cn(styles.statePill, stateClass(selectedState))}>{stateLabel(selectedState)}</span>
                      <h2>{selected.title}</h2>
                      <p>{qualityLine(selected)}</p>
                    </div>
                    {selected.url ? (
                      <a href={selected.url} target="_blank" rel="noreferrer" className={styles.textLink}>
                        Open post
                        <ExternalLink className={styles.linkIcon} />
                      </a>
                    ) : null}
                  </div>

                  <div className={styles.postPreview}>
                    <p>
                      {shortText(selected.body || selected.fitSummary || selected.headline, 430) ||
                        "No caption text was captured for this post."}
                    </p>
                  </div>

                  <div className={styles.composerGrid}>
                    <div className={styles.commentColumn}>
                      <label htmlFor="instagram-comment-draft">Approved comment</label>
                      <textarea
                        id="instagram-comment-draft"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="Write a normal comment that fits this post."
                        className={styles.commentBox}
                      />
                      <div className={styles.inputMeta}>
                        <span>{draft.trim().length}/1250 characters</span>
                        {!draft.trim() ? <span>Write a comment before posting.</span> : null}
                      </div>
                    </div>

                    <aside className={styles.healthColumn} aria-label="Account health">
                      <label htmlFor="instagram-account">Posting account</label>
                      <select
                        id="instagram-account"
                        value={accountId}
                        onChange={(event) => setAccountId(event.target.value)}
                        disabled={!accounts.length}
                        className={styles.accountSelect}
                      >
                        {accounts.length ? null : <option value="">No Instagram accounts</option>}
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {accountLabel(account)}
                          </option>
                        ))}
                      </select>

                      <div
                        className={cn(
                          styles.healthBox,
                          selectedAccount && !selectedAccountBlocked ? styles.healthGood : styles.healthWarning
                        )}
                      >
                        <div className={styles.healthTitle}>
                          {selectedAccount && !selectedAccountBlocked ? (
                            <ShieldCheck className={styles.healthIcon} />
                          ) : (
                            <CircleAlert className={styles.healthIcon} />
                          )}
                          {selectedAccount
                            ? selectedAccountBlocked
                              ? "Cooldown active"
                              : "Account ready"
                            : "Connect account"}
                        </div>
                        <p>
                          {selectedAccount
                            ? `${selectedAccount.recentActivity24h} comments in 24h / trust ${
                                selectedAccount.trustLevel || 0
                              }`
                            : "Add an Instagram account before posting."}
                        </p>
                      </div>

                      {selected.riskNotes.length ? (
                        <div className={styles.riskNote}>
                          <CircleAlert className={styles.riskIcon} />
                          <span>{selected.riskNotes[0]}</span>
                        </div>
                      ) : (
                        <div className={styles.cleanNote}>
                          <CheckCircle2 className={styles.riskIcon} />
                          <span>No review notes on this opportunity.</span>
                        </div>
                      )}
                    </aside>
                  </div>

                  {selected.commentDelivery?.postedAt ? (
                    <div className={styles.noticeGood}>
                      <span>
                        Posted by{" "}
                        {selected.commentDelivery.accountHandle ||
                          selected.commentDelivery.accountName ||
                          "the selected account"}
                        .
                      </span>
                      {selected.commentDelivery.commentUrl ? (
                        <a href={selected.commentDelivery.commentUrl} target="_blank" rel="noreferrer">
                          View comment
                          <ArrowUpRight className={styles.linkIcon} />
                        </a>
                      ) : null}
                    </div>
                  ) : null}

                  {notice ? <div className={styles.noticeGood}>{notice}</div> : null}
                  {error ? <div className={styles.noticeError}>{error}</div> : null}

                  <div className={styles.actionBar}>
                    <button
                      type="button"
                      onClick={skipSelected}
                      disabled={posting || selectedState === "posted"}
                      className={styles.ghostButton}
                    >
                      <SkipForward className={styles.buttonIcon} />
                      Skip
                    </button>
                    <button type="button" onClick={postComment} disabled={!canPost} className={styles.primaryButton}>
                      <Send className={styles.buttonIcon} />
                      {posting ? "Posting..." : "Post approved comment"}
                    </button>
                  </div>
                </>
              ) : (
                <div className={styles.emptyLane}>Select an opportunity to review.</div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
