import assert from "node:assert/strict";
import test from "node:test";

import { buildTapInActivitySnapshot } from "../../src/lib/tapinsocial-activity";
import type { SocialDiscoveryPost } from "../../src/lib/social-discovery-types";

function deliveredPost(input: {
  id: string;
  commentAt: string;
  replyAt?: string;
  pendingCreatedAt?: string;
}): SocialDiscoveryPost {
  return {
    id: input.id,
    brandId: "brand_test",
    platform: "youtube",
    provider: "youtube-data-api",
    externalId: input.id,
    url: `https://www.youtube.com/watch?v=${input.id}`,
    title: `Video ${input.id}`,
    body: "",
    author: "Channel",
    community: "Channel",
    query: "test",
    matchedTerms: [],
    intent: "category_intent",
    relevanceScore: 20,
    risingScore: 10,
    engagementScore: 100,
    providerRank: 1,
    status: "triaged",
    interactionPlan: {
      headline: "",
      actors: [],
      sequence: [
        { actorRole: "operator", timing: "now", move: "comment", draft: `Comment ${input.id}` },
        { actorRole: "brand", timing: "later", move: "reply", draft: `Reply ${input.id}` },
      ],
      assetNeeded: "",
      riskNotes: [],
    },
    commentDelivery: {
      commentId: `comment_${input.id}`,
      commentUrl: `https://www.youtube.com/watch?v=${input.id}&lc=comment_${input.id}`,
      status: "verified",
      source: "response",
      message: "",
      postedAt: input.commentAt,
      accountId: "account_comment",
      accountName: "Commenter",
      accountHandle: "@commenter",
      replyDelivery: input.replyAt ? {
        commentId: `reply_${input.id}`,
        commentUrl: `https://www.youtube.com/watch?v=${input.id}&lc=reply_${input.id}`,
        status: "verified",
        source: "response",
        message: "",
        postedAt: input.replyAt,
        accountId: "account_reply",
        accountName: "Replier",
        accountHandle: "@replier",
      } : undefined,
    },
    pendingReply: input.pendingCreatedAt ? {
      parentCommentId: `comment_${input.id}`,
      text: "Pending reply",
      accountId: "account_reply",
      accountName: "Replier",
      accountHandle: "@replier",
      scheduledAt: "2026-08-09T10:00:00.000Z",
      createdAt: input.pendingCreatedAt,
      attempts: 0,
      status: "scheduled",
    } : undefined,
    raw: {},
    postedAt: input.commentAt,
    discoveredAt: input.commentAt,
    updatedAt: input.commentAt,
  };
}

test("activity contains only deliveries created during the active campaign run", () => {
  const oldPost = deliveredPost({
    id: "old",
    commentAt: "2026-08-09T07:00:00.000Z",
    replyAt: "2026-08-09T07:30:00.000Z",
    pendingCreatedAt: "2026-08-09T07:15:00.000Z",
  });
  const currentPost = deliveredPost({
    id: "current",
    commentAt: "2026-08-09T09:00:00.000Z",
    pendingCreatedAt: "2026-08-09T09:05:00.000Z",
  });

  const activity = buildTapInActivitySnapshot({
    enabled: true,
    commentedPosts: [oldPost, currentPost],
    pendingReplyPosts: [oldPost, currentPost],
    campaignStartedAt: "2026-08-09T08:00:00.000Z",
    now: new Date("2026-08-09T09:30:00.000Z"),
  });

  assert.deepEqual(activity.events.map((event) => event.id), ["current:comment:comment_current"]);
  assert.equal(activity.counts.last24Hours, 1);
  assert.equal(activity.counts.comments30Days, 1);
  assert.equal(activity.counts.replies30Days, 0);
  assert.equal(activity.counts.repliesWaiting, 1);
});
