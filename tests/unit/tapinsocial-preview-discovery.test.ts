import assert from "node:assert/strict";
import test from "node:test";

import type { BrandRecord } from "../../src/lib/factory-data";
import type { SocialDiscoveryPost } from "../../src/lib/social-discovery-types";
import {
  discoverTapInPreviewVideo,
  tapInPreviewNoMatchError,
  type TapInPreviewDiscoveryResult,
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
const post = { id: "video_match", query: "brand mentions" } as SocialDiscoveryPost;

function discovery(query: string, matched = false) {
  return {
    provider: "youtube-data-api" as const,
    platforms: ["youtube"] as const,
    queries: [query],
    posts: matched ? [post] : [],
    errors: [],
    queryStats: [{
      query,
      found: 25,
      eligible: 20,
      accepted: matched ? 1 : 0,
      rejectedSubscriberGate: 5,
      rejectedTargetGrade: matched ? 19 : 20,
    }],
    summary: {
      found: 25,
      eligible: 20,
      accepted: matched ? 1 : 0,
      minSubscriberCount: 100,
      maxVideoAgeHours: 24,
      minRelevanceScore: 0,
      minRisingScore: 0,
    },
  };
}

test("preview widens across topics and stops on the first safe match", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await discoverTapInPreviewVideo({
    brand,
    queries: ["YouTube marketing", "brand mentions", "social SEO", "fourth topic"],
    policy,
    discover: async (input) => {
      calls.push(input);
      const query = input.queries[0];
      return discovery(query, query === "brand mentions");
    },
  });

  assert.equal(result.post?.id, "video_match");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.queries), [
    ["YouTube marketing"],
    ["brand mentions"],
  ]);
  assert.ok(calls.every((call) => call.maxResults === 25));
  assert.ok(calls.every((call) => call.order === "relevance"));
  assert.equal(result.summary.found, 50);
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

test("broad and any no-match copy describes a sample instead of repeating active settings", () => {
  const result = {
    post: null,
    queries: ["YouTube marketing", "brand mentions"],
    errors: [],
    queryStats: [discovery("YouTube marketing").queryStats[0], discovery("brand mentions").queryStats[0]],
    summary: { ...discovery("YouTube marketing").summary, found: 50, eligible: 40 },
  } satisfies TapInPreviewDiscoveryResult;

  const message = tapInPreviewNoMatchError(result, policy).error;
  assert.match(message, /recent sample/i);
  assert.match(message, /not all of YouTube/i);
  assert.doesNotMatch(message, /Broad relevance|Any momentum/);
});

test("no-match copy recommends only settings that are still strict", () => {
  const strictPolicy = {
    ...policy,
    relevanceMode: "strict" as const,
    momentumMode: "any" as const,
  };
  const result = {
    post: null,
    queries: ["branding"],
    errors: [],
    queryStats: [discovery("branding").queryStats[0]],
    summary: discovery("branding").summary,
  } satisfies TapInPreviewDiscoveryResult;

  const message = tapInPreviewNoMatchError(result, strictPolicy).error;
  assert.match(message, /Broad relevance/);
  assert.doesNotMatch(message, /Any momentum/);
});
