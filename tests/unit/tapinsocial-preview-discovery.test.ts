import assert from "node:assert/strict";
import test from "node:test";

import type { BrandRecord } from "../../src/lib/factory-data";
import type { SocialDiscoveryPost } from "../../src/lib/social-discovery-types";
import { isEligibleYouTubePreviewFallbackPost } from "../../src/lib/social-discovery-youtube-search";
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
