import assert from "node:assert/strict";
import test from "node:test";

import { youtubePolicyFromPrompt } from "../../src/lib/social-discovery-youtube-policy";
import { buildTapInCampaignPrompt } from "../../src/lib/tapinsocial-campaign-prompt";

test("TapIn campaign prompt preserves the user's YouTube discovery policy", () => {
  const youtubePolicy = {
    minSubscriberCount: 100,
    maxVideoAgeHours: 168,
    minRelevanceScore: 8,
    minRisingScore: 0,
    relevanceMode: "broad" as const,
    momentumMode: "any" as const,
  };
  const prompt = buildTapInCampaignPrompt({
    campaignType: "comment",
    openingCommentPrompt: "Keep it casual.",
    delayedReplyPrompt: "",
    youtubePolicy,
  });

  assert.deepEqual(youtubePolicyFromPrompt(prompt), youtubePolicy);
  assert.match(prompt, /Campaign type: Comment only\./);
});
