import type { SocialDiscoveryCommentDelivery, SocialDiscoveryPost } from "@/lib/social-discovery-types";

export type TapInActivityStatus = "paused" | "posting" | "watching";

export type TapInActivityEvent = {
  id: string;
  kind: "comment" | "reply";
  text: string;
  accountName: string;
  accountHandle: string;
  postedAt: string;
  commentUrl: string;
  videoTitle: string;
  videoUrl: string;
  verification: "verified" | "accepted_unverified" | "";
};

export type TapInActivitySnapshot = {
  status: TapInActivityStatus;
  enabled: boolean;
  checkedAt: string;
  lastPostedAt: string;
  nextReplyAt: string;
  counts: {
    last24Hours: number;
    comments30Days: number;
    replies30Days: number;
    repliesWaiting: number;
  };
  events: TapInActivityEvent[];
};

function validTimestamp(value: string | undefined) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function deliveryEvent(
  post: SocialDiscoveryPost,
  kind: TapInActivityEvent["kind"],
  delivery: SocialDiscoveryCommentDelivery,
  text: string
): TapInActivityEvent {
  return {
    id: `${post.id}:${kind}:${delivery.commentId || delivery.postedAt}`,
    kind,
    text: text.trim(),
    accountName: delivery.accountName.trim(),
    accountHandle: delivery.accountHandle.trim(),
    postedAt: delivery.postedAt,
    commentUrl: delivery.commentUrl.trim(),
    videoTitle: post.title.trim(),
    videoUrl: post.url.trim(),
    verification: delivery.status,
  };
}

export function buildTapInActivitySnapshot(input: {
  enabled: boolean;
  commentedPosts: SocialDiscoveryPost[];
  pendingReplyPosts: SocialDiscoveryPost[];
  campaignStartedAt?: string;
  now?: Date;
}): TapInActivitySnapshot {
  const now = input.now ?? new Date();
  const thirtyDaysAgoMs = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const campaignStartedAtMs = validTimestamp(input.campaignStartedAt);
  const windowStartMs = Math.max(thirtyDaysAgoMs, campaignStartedAtMs);
  const last24HoursMs = now.getTime() - 24 * 60 * 60 * 1000;
  const events = input.commentedPosts
    .flatMap((post) => {
      const sequence = post.interactionPlan.sequence ?? [];
      const comment = post.commentDelivery;
      if (!comment) return [];
      const rows: TapInActivityEvent[] = [];
      if (Date.parse(comment.postedAt) >= windowStartMs) {
        rows.push(deliveryEvent(post, "comment", comment, sequence[0]?.draft ?? ""));
      }
      const reply = comment.replyDelivery;
      if (reply && Date.parse(reply.postedAt) >= windowStartMs) {
        rows.push(deliveryEvent(post, "reply", reply, sequence[1]?.draft ?? ""));
      }
      return rows;
    })
    .filter((event) => Number.isFinite(Date.parse(event.postedAt)))
    .sort((left, right) => right.postedAt.localeCompare(left.postedAt));

  const pendingReplyPosts = input.pendingReplyPosts.filter(
    (post) => validTimestamp(post.pendingReply?.createdAt) >= windowStartMs
  );
  const pendingReplyTimes = pendingReplyPosts
    .map((post) => post.pendingReply?.scheduledAt ?? "")
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((left, right) => left.localeCompare(right));
  const last24Hours = events.filter((event) => Date.parse(event.postedAt) >= last24HoursMs).length;

  return {
    status: input.enabled ? (last24Hours > 0 ? "posting" : "watching") : "paused",
    enabled: input.enabled,
    checkedAt: now.toISOString(),
    lastPostedAt: events[0]?.postedAt ?? "",
    nextReplyAt: pendingReplyTimes[0] ?? "",
    counts: {
      last24Hours,
      comments30Days: events.filter((event) => event.kind === "comment").length,
      replies30Days: events.filter((event) => event.kind === "reply").length,
      repliesWaiting: pendingReplyPosts.length,
    },
    events: events.slice(0, 20),
  };
}
