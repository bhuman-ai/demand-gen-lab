"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageIntro, SectionPanel, StatLedger } from "@/components/ui/page-layout";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  SocialDiscoveryPost,
  SocialDiscoveryRun,
  SocialDiscoveryStatus,
} from "@/lib/social-discovery-types";

type InteractionPlan = SocialDiscoveryPost["interactionPlan"] & {
  targetStrength?: "target" | "watch" | "skip";
  commentPosture?: string;
  mentionPolicy?: string;
  analyticsTag?: string;
  exitRules?: string[];
};

type DiscoveryPost = SocialDiscoveryPost & {
  interactionPlan: InteractionPlan;
};

type DiscoveryResponse = {
  posts: DiscoveryPost[];
  runs: SocialDiscoveryRun[];
};

const statusOptions: Array<SocialDiscoveryStatus | "all"> = ["all", "new", "saved", "triaged", "dismissed"];

function planFor(post: DiscoveryPost | null): InteractionPlan | null {
  return post?.interactionPlan ?? null;
}

function strengthFor(post: DiscoveryPost | null) {
  return planFor(post)?.targetStrength || "skip";
}

function postureFor(plan: InteractionPlan | null) {
  if (!plan?.commentPosture) return strengthForPlan(plan) === "skip" ? "no_comment" : "method_first";
  return plan.commentPosture;
}

function strengthForPlan(plan: InteractionPlan | null) {
  return plan?.targetStrength || "skip";
}

function mentionPolicyFor(plan: InteractionPlan | null) {
  if (!plan?.mentionPolicy) return strengthForPlan(plan) === "skip" ? "never_mention" : "mention_only_if_asked";
  return plan.mentionPolicy;
}

function hasCommentSequence(plan: InteractionPlan | null) {
  if (!plan?.sequence?.length) return false;
  if (strengthForPlan(plan) === "skip") return false;
  if (postureFor(plan) === "no_comment" || postureFor(plan) === "watch_only") return false;
  if (mentionPolicyFor(plan) === "never_mention") return false;
  return true;
}

function badgeVariant(strength: string) {
  if (strength === "target") return "success" as const;
  if (strength === "watch") return "accent" as const;
  return "muted" as const;
}

function formatDate(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "unknown age";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

async function readDiscoveryResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Social discovery request failed");
  }
  return {
    posts: Array.isArray(data?.posts) ? data.posts : [],
    runs: Array.isArray(data?.runs) ? data.runs : data?.run ? [data.run] : [],
  } as DiscoveryResponse;
}

export default function SocialDiscoveryClient({ brandId }: { brandId: string }) {
  const [posts, setPosts] = useState<DiscoveryPost[]>([]);
  const [runs, setRuns] = useState<SocialDiscoveryRun[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState<SocialDiscoveryStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedId) ?? posts[0] ?? null,
    [posts, selectedId]
  );
  const selectedPlan = planFor(selectedPost);
  const counts = useMemo(() => {
    const target = posts.filter((post) => strengthFor(post) === "target").length;
    const watch = posts.filter((post) => strengthFor(post) === "watch").length;
    const skip = posts.filter((post) => strengthFor(post) === "skip").length;
    return { target, watch, skip };
  }, [posts]);

  async function loadPosts(nextStatus = status) {
    setLoading(true);
    setError("");
    try {
      const query = nextStatus === "all" ? "" : `?status=${nextStatus}`;
      const response = await fetch(`/api/brands/${brandId}/social-discovery${query}`, { cache: "no-store" });
      const data = await readDiscoveryResponse(response);
      setPosts(data.posts);
      setRuns(data.runs);
      setSelectedId((current) => current && data.posts.some((post) => post.id === current) ? current : data.posts[0]?.id ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load social discovery");
      setPosts([]);
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPosts(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, status]);

  async function runScan() {
    setScanning(true);
    setError("");
    try {
      const response = await fetch(`/api/brands/${brandId}/social-discovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "scan",
          provider: "dataforseo",
          platforms: ["instagram"],
          maxQueries: 6,
          limitPerQuery: 10,
        }),
      });
      const data = await readDiscoveryResponse(response);
      setPosts(data.posts);
      setSelectedId(data.posts[0]?.id ?? "");
      await loadPosts(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run social discovery");
    } finally {
      setScanning(false);
    }
  }

  async function updateStatus(postId: string, nextStatus: SocialDiscoveryStatus) {
    setError("");
    try {
      const response = await fetch(`/api/brands/${brandId}/social-discovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", id: postId, status: nextStatus }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to update status");
      }
      const updated = data.post as DiscoveryPost;
      setPosts((current) => current.map((post) => post.id === updated.id ? updated : post));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  }

  async function copyText(value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="space-y-6">
      <PageIntro
        title="Social discovery"
        description="Review rising Instagram candidates, decide whether to enter, and copy the planned interaction."
        actions={
          <div className="flex flex-wrap gap-2">
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value as SocialDiscoveryStatus | "all")}
              className="h-10 w-[150px]"
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </Select>
            <Button type="button" onClick={runScan} disabled={scanning}>
              <RefreshCw className={cn("h-4 w-4", scanning ? "animate-spin" : "")} />
              {scanning ? "Scanning..." : "Run scan"}
            </Button>
          </div>
        }
        aside={
          <StatLedger
            items={[
              { label: "Targets", value: counts.target, detail: "Ready for one real operator comment." },
              { label: "Watch", value: counts.watch, detail: "Hold unless the thread asks a concrete question." },
              { label: "Skip", value: counts.skip, detail: "No comment or product mention." },
              {
                label: "Last run",
                value: runs[0] ? "Seen" : "None",
                detail: runs[0] ? formatDate(runs[0].finishedAt) : "Run a scan to create candidates.",
              },
            ]}
          />
        }
      />

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      {!loading && !posts.length ? (
        <EmptyState
          title="No candidates yet."
          description="Run a scan to pull Instagram post candidates and generate interaction plans."
          actions={<Button onClick={runScan} disabled={scanning}>Run scan</Button>}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
        <SectionPanel
          title="Candidates"
          description={loading ? "Loading candidates..." : `${posts.length} posts in this view.`}
          contentClassName="p-0"
        >
          <div className="divide-y divide-[color:var(--border)]">
            {posts.map((post) => {
              const plan = post.interactionPlan;
              const active = post.id === selectedPost?.id;
              return (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => setSelectedId(post.id)}
                  className={cn(
                    "grid w-full gap-2 px-4 py-3 text-left transition-colors hover:bg-[color:var(--surface-muted)]",
                    active ? "bg-[color:var(--surface-muted)]" : ""
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badgeVariant(plan.targetStrength || "skip")}>{plan.targetStrength || "skip"}</Badge>
                    <span className="text-xs text-[color:var(--muted-foreground)]">
                      score {post.risingScore} · {post.engagementScore} eng · {formatDate(post.postedAt)}
                    </span>
                  </div>
                  <div className="line-clamp-2 text-sm font-medium leading-5 text-[color:var(--foreground)]">
                    {post.title}
                  </div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    {post.query} · {post.status}
                  </div>
                </button>
              );
            })}
          </div>
        </SectionPanel>

        <SectionPanel
          title="Interaction plan"
          description={selectedPost ? selectedPost.title : "Choose a candidate."}
          actions={
            selectedPost ? (
              <Button asChild variant="outline" size="sm">
                <Link href={selectedPost.url} target="_blank" rel="noreferrer">
                  Open post
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null
          }
        >
          {selectedPost && selectedPlan ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant={badgeVariant(strengthForPlan(selectedPlan))}>
                  {strengthForPlan(selectedPlan)}
                </Badge>
                <Badge variant="muted">{postureFor(selectedPlan)}</Badge>
                <Badge variant="muted">{mentionPolicyFor(selectedPlan)}</Badge>
              </div>

              {hasCommentSequence(selectedPlan) ? (
                <div className="grid gap-3">
                  {selectedPlan.sequence.map((step, index) => (
                    <div key={`${step.actorRole}-${index}`} className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--muted-foreground)]">
                        <span>{step.actorRole} · {step.timing}</span>
                        <Button type="button" variant="outline" size="sm" onClick={() => copyText(step.draft)}>
                          Copy
                        </Button>
                      </div>
                      <p className="text-sm leading-6 text-[color:var(--foreground)]">{step.draft}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                  <div className="text-sm font-medium text-[color:var(--foreground)]">No comment recommended.</div>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                    Leave this post alone unless a real person has first-hand context and the thread directly asks for a relevant method or resource.
                  </p>
                </div>
              )}

              <div className="rounded-[10px] border border-[color:var(--border)] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--muted-foreground)]">
                  <span>Analytics</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => copyText(selectedPlan.analyticsTag || "")}>
                    Copy tag
                  </Button>
                </div>
                <code className="break-all text-xs text-[color:var(--foreground)]">{selectedPlan.analyticsTag || "none"}</code>
              </div>

              <div className="grid gap-2 text-sm text-[color:var(--muted-foreground)]">
                {(selectedPlan.exitRules || []).map((rule) => (
                  <div key={rule}>- {rule}</div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-[color:var(--border)] pt-4">
                <Button type="button" variant="outline" onClick={() => updateStatus(selectedPost.id, "saved")}>
                  Save
                </Button>
                <Button type="button" variant="outline" onClick={() => updateStatus(selectedPost.id, "triaged")}>
                  Mark triaged
                </Button>
                <Button type="button" variant="ghost" onClick={() => updateStatus(selectedPost.id, "dismissed")}>
                  Dismiss
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[color:var(--muted-foreground)]">Select a candidate to see the plan.</div>
          )}
        </SectionPanel>
      </div>
    </div>
  );
}
