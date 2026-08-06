import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY,
  normalizeSocialDiscoveryYouTubePolicy,
  youtubePolicyFromPrompt,
  youtubePolicyPromptLines,
} from "../../src/lib/social-discovery-youtube-policy";

test("campaign policy uses safe defaults and clamps unsafe values", () => {
  assert.deepEqual(
    normalizeSocialDiscoveryYouTubePolicy({}, DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY),
    DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY
  );
  assert.deepEqual(
    normalizeSocialDiscoveryYouTubePolicy(
      {
        minSubscriberCount: -4,
        maxVideoAgeHours: 999,
        minRelevanceScore: 130,
        minRisingScore: -10,
        relevanceMode: "strict",
        momentumMode: "fast",
      },
      DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY
    ),
    {
      minSubscriberCount: 0,
      maxVideoAgeHours: 168,
      minRelevanceScore: 100,
      minRisingScore: 0,
      relevanceMode: "strict",
      momentumMode: "fast",
    }
  );
});

test("campaign policy survives durable backend prompt storage", () => {
  const policy = {
    minSubscriberCount: 750,
    maxVideoAgeHours: 48,
    minRelevanceScore: 30,
    minRisingScore: 50,
    relevanceMode: "strict" as const,
    momentumMode: "fast" as const,
  };
  const prompt = ["Comment instructions", ...youtubePolicyPromptLines(policy)].join("\n");
  assert.deepEqual(youtubePolicyFromPrompt(prompt), policy);
});
