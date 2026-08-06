import assert from "node:assert/strict";
import test from "node:test";

import type { BrandRecord } from "../../src/lib/factory-types";
import { socialDiscoveryCampaignBrand } from "../../src/lib/social-discovery-campaign-context";
import { buildScoredSocialDiscoveryPost } from "../../src/lib/social-discovery";
import { isEligibleYouTubeDiscoveryPost } from "../../src/lib/social-discovery-youtube-search";

function brand(overrides: Partial<BrandRecord> = {}): BrandRecord {
  return {
    id: "brand_test",
    name: "SafeAgain",
    website: "https://safeagain.example",
    tone: "Warm",
    notes: "personal safety for women walking alone",
    product: "personal safety app",
    socialDiscoveryCommentPrompt: "",
    socialDiscoveryPlatforms: ["youtube"],
    socialDiscoveryQueries: ["sales outreach", "personalized marketing"],
    socialDiscoveryYouTubeSubscriptions: [],
    socialDiscoveryYouTubeAutoCommentEnabled: true,
    socialDiscoverySearchStrategy: null,
    operablePersonas: [],
    availableAssets: [],
    targetMarkets: ["women"],
    idealCustomerProfiles: ["solo travelers"],
    keyFeatures: ["location sharing"],
    keyBenefits: ["feel safer"],
    domains: [],
    leads: [],
    inbox: [],
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

test("TapIn runtime context replaces the seed brand identity without changing ownership", () => {
  const source = brand({
    socialDiscoveryCommentPrompt: [
      "Brand name: BHuman",
      "Brand positioning: personalized video at scale",
      "Runtime context:",
      "- TapIn supplies the matched YouTube video title and description to the generator automatically.",
    ].join("\n"),
  });

  const campaign = socialDiscoveryCampaignBrand(source);

  assert.equal(campaign.id, source.id);
  assert.equal(campaign.name, "BHuman");
  assert.equal(campaign.product, "personalized video at scale");
  assert.deepEqual(campaign.targetMarkets, ["sales outreach", "personalized marketing"]);
  assert.equal(campaign.website, "");
  assert.equal(campaign.notes, "");
  assert.deepEqual(campaign.idealCustomerProfiles, []);
});

test("non-TapIn social discovery brands are unchanged", () => {
  const source = brand({ socialDiscoveryCommentPrompt: "Brand name: Another Brand" });
  assert.equal(socialDiscoveryCampaignBrand(source), source);
});

test("strong personalized-marketing content is target grade for the BHuman campaign", () => {
  const now = new Date().toISOString();
  const campaign = socialDiscoveryCampaignBrand(brand({
    socialDiscoveryCommentPrompt: [
      "Brand name: BHuman",
      "Brand positioning: personalized video at scale for sales outreach and marketing",
      "Runtime context:",
      "- TapIn supplies the matched YouTube video title and description to the generator automatically.",
    ].join("\n"),
  }));
  const post = buildScoredSocialDiscoveryPost({
    id: "socialpost_personalization",
    brandId: campaign.id,
    platform: "youtube",
    provider: "youtube-data-api",
    externalId: "video_personalization",
    url: "https://www.youtube.com/watch?v=video_personalization",
    title: "AI Personalization for Marketing Campaigns",
    body: "Practical tactics for outreach, personalization and marketing campaigns.",
    author: "Marketing channel",
    community: "Marketing channel",
    query: "personalized marketing",
    engagementScore: 5_000,
    providerRank: 1,
    raw: {},
    postedAt: now,
    discoveredAt: now,
    updatedAt: now,
    brand: campaign,
  });

  assert.ok(post);
  assert.ok(post.relevanceScore >= 18);
  assert.notEqual(post.interactionPlan.targetStrength, "skip");
  assert.notEqual(post.interactionPlan.commentPosture, "no_comment");
  assert.equal(isEligibleYouTubeDiscoveryPost(post), true);
});
