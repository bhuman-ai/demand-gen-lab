import assert from "node:assert/strict";
import test from "node:test";

import type { BrandRecord } from "../../src/lib/factory-data";
import type { SocialDiscoveryPost } from "../../src/lib/social-discovery-types";
import { tapInPreviewCampaignBrand } from "../../src/lib/social-discovery-campaign-context";
import {
  discoverYouTubeSearchPostsForBrand,
  isEligibleYouTubePreviewFallbackPost,
  isWithinYouTubeDiscoveryWindow,
} from "../../src/lib/social-discovery-youtube-search";
import {
  buildTapInPreviewTargetExample,
  discoverTapInPreviewVideo,
} from "../../src/lib/tapinsocial-preview-discovery";
import type { SocialDiscoveryYouTubePolicy } from "../../src/lib/social-discovery-youtube-policy";

const policy: SocialDiscoveryYouTubePolicy = {
  minSubscriberCount: 100,
  maxVideoAgeHours: 24,
  minRelevanceScore: 0,
  minRisingScore: 0,
  relevanceMode: "broad",
  momentumMode: "any",
};

const brand = { id: "brand_tapin", name: "TapIn Social" } as BrandRecord;

function candidate(
  id: string,
  query: string,
  relevanceScore: number,
  risingScore: number
) {
  return {
    id,
    externalId: id,
    url: `https://youtube.com/watch?v=${id}`,
    query,
    relevanceScore,
    risingScore,
    engagementScore: 100,
    providerRank: 1,
    postedAt: new Date().toISOString(),
    interactionPlan: { surfaceType: "generic" },
  } as SocialDiscoveryPost;
}

function discovery(
  query: string,
  options: { matches?: SocialDiscoveryPost[]; candidates?: SocialDiscoveryPost[] } = {}
) {
  const matches = options.matches ?? [];
  const candidates = options.candidates ?? matches;
  return {
    provider: "youtube-data-api" as const,
    platforms: ["youtube"] as const,
    queries: [query],
    posts: matches,
    candidates,
    errors: [],
    queryStats: [{
      query,
      found: 25,
      eligible: 20,
      accepted: matches.length,
      rejectedSubscriberGate: 5,
      rejectedTargetGrade: 20 - matches.length,
    }],
    summary: {
      found: 25,
      eligible: 20,
      accepted: matches.length,
      minSubscriberCount: 100,
      maxVideoAgeHours: 24,
      minRelevanceScore: 0,
      minRisingScore: 0,
    },
  };
}

test("preview checks every campaign topic and chooses the strongest policy match", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const earlyMatch = candidate("video_early", "YouTube marketing", 42, 55);
  const bestMatch = candidate("video_best", "brand mentions", 78, 60);
  const result = await discoverTapInPreviewVideo({
    brand,
    queries: ["YouTube marketing", "brand mentions", "social SEO", "fourth topic"],
    policy,
    discover: async (input) => {
      calls.push(input);
      const query = input.queries[0];
      if (query === "YouTube marketing") return discovery(query, { matches: [earlyMatch] });
      if (query === "brand mentions") return discovery(query, { matches: [bestMatch] });
      return discovery(query);
    },
  });

  assert.equal(result.post?.id, "video_best");
  assert.equal(result.selectionMode, "policy_match");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.queries), [
    ["YouTube marketing"],
    ["brand mentions"],
    ["social SEO"],
  ]);
  assert.ok(calls.every((call) => call.maxResults === 25));
  assert.ok(calls.every((call) => call.order === "relevance"));
  assert.ok(calls.every((call) => call.includePolicyFallbackCandidates === true));
  assert.equal(result.summary.found, 75);
});

test("preview falls back to the best candidate when soft thresholds reject every match", async () => {
  const weaker = candidate("video_weaker", "one", 24, 70);
  const strongest = candidate("video_strongest", "two", 51, 35);
  const result = await discoverTapInPreviewVideo({
    brand,
    queries: ["one", "two"],
    policy,
    discover: async (input) => {
      const query = input.queries[0];
      return discovery(query, {
        candidates: query === "one" ? [weaker] : [strongest],
      });
    },
  });

  assert.equal(result.post?.id, "video_strongest");
  assert.equal(result.selectionMode, "best_available");
  assert.equal(result.summary.accepted, 0);
});

test("preview still returns no match when discovery has no safe candidates", async () => {
  const result = await discoverTapInPreviewVideo({
    brand,
    queries: ["one"],
    policy,
    discover: async (input) => discovery(input.queries[0]),
  });

  assert.equal(result.post, null);
  assert.equal(result.selectionMode, null);
});

test("preview fallback excludes news and political surfaces", () => {
  const news = candidate("video_news", "one", 90, 90);
  news.interactionPlan.surfaceType = "news_or_political";

  assert.equal(isEligibleYouTubePreviewFallbackPost(news), false);
  assert.equal(isEligibleYouTubePreviewFallbackPost(candidate("video_safe", "one", 20, 20)), true);
});

test("preview requests real videos outside the live policy window", async () => {
  const olderRealMatch = candidate("video_older", "women's safety", 64, 20);
  olderRealMatch.postedAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

  const result = await discoverTapInPreviewVideo({
    brand,
    queries: ["women's safety"],
    policy,
    discover: async (input) => discovery(input.queries[0], {
      candidates: input.includePolicyFallbackCandidates ? [olderRealMatch] : [],
    }),
  });

  assert.equal(result.post?.id, "video_older");
  assert.equal(result.selectionMode, "best_available");
});

test("live policy age stays strict while preview can rank an older candidate", () => {
  const now = Date.parse("2026-08-10T00:00:00.000Z");
  const post = { postedAt: "2026-08-07T00:00:00.000Z" };

  assert.equal(isWithinYouTubeDiscoveryWindow(post, 24, now), false);
  assert.equal(isWithinYouTubeDiscoveryWindow(post, 168, now), true);
});

test("preview checks at most three campaign topics", async () => {
  const queries: string[] = [];
  await discoverTapInPreviewVideo({
    brand,
    queries: ["one", "two", "three", "four"],
    policy,
    discover: async (input) => {
      queries.push(input.queries[0]);
      return discovery(input.queries[0]);
    },
  });

  assert.deepEqual(queries, ["one", "two", "three"]);
});

test("no safe current candidate becomes a clearly hypothetical future target", () => {
  const example = buildTapInPreviewTargetExample({
    campaignName: "Meet creators who need better brand mentions",
    targets: ["YouTube brand mentions"],
  });

  assert.equal(example.matchQuality, "target_example");
  assert.equal(example.matchedTarget, "YouTube brand mentions");
  assert.match(example.description, /representative future match/i);
  assert.match(example.description, /hypothetical/i);
  assert.equal(example.url, "");
});

test("preview candidate pool keeps older and below-subscriber real videos without weakening policy matches", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.YOUTUBE_DATA_API_KEY;
  const publishedAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const searchUrls: URL[] = [];
  process.env.YOUTUBE_DATA_API_KEY = "test-youtube-key";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/search")) {
      searchUrls.push(url);
      return Response.json({
        items: [
          { id: { videoId: "established" }, snippet: { channelId: "channel-big", title: "Women's safety planning", description: "Practical safety planning advice", publishedAt } },
          { id: { videoId: "small" }, snippet: { channelId: "channel-small", title: "Street safety basics", description: "Everyday street safety", publishedAt } },
        ],
      });
    }
    if (url.pathname.endsWith("/videos")) {
      return Response.json({
        items: [
          { id: "established", snippet: { title: "Women's safety planning", description: "Practical safety planning advice", publishedAt }, statistics: { viewCount: "1000", likeCount: "100", commentCount: "20" } },
          { id: "small", snippet: { title: "Street safety basics", description: "Everyday street safety", publishedAt }, statistics: { viewCount: "100", likeCount: "10", commentCount: "2" } },
        ],
      });
    }
    if (url.pathname.endsWith("/channels")) {
      return Response.json({
        items: [
          { id: "channel-big", snippet: { title: "Women's Safety Channel" }, statistics: { subscriberCount: "10000" } },
          { id: "channel-small", snippet: { title: "Neighborhood Safety" }, statistics: { subscriberCount: "20" } },
        ],
      });
    }
    throw new Error(`Unexpected YouTube request: ${url.pathname}`);
  };

  try {
    const result = await discoverYouTubeSearchPostsForBrand({
      brand: tapInPreviewCampaignBrand(brand, {
        campaignName: "SafeAgain · Women's safety",
        targets: ["women's safety"],
      }),
      queries: ["women's safety"],
      order: "relevance",
      policy,
      includePolicyFallbackCandidates: true,
    });

    assert.equal(searchUrls.length, 1);
    assert.equal(searchUrls[0].searchParams.has("publishedAfter"), false);
    assert.deepEqual(result.candidates.map((post) => post.externalId), ["established", "small"]);
    assert.equal(result.queryStats[0].eligible, 1);
    assert.equal(result.queryStats[0].rejectedSubscriberGate, 1);
    assert.equal(result.posts.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.YOUTUBE_DATA_API_KEY;
    else process.env.YOUTUBE_DATA_API_KEY = originalApiKey;
  }
});
