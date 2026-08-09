import assert from "node:assert/strict";
import test from "node:test";

import type { BrandRecord } from "../../src/lib/factory-types";
import {
  campaignBrandName,
  socialDiscoveryCampaignBrand,
  tapInPreviewCampaignBrand,
} from "../../src/lib/social-discovery-campaign-context";
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

test("campaign identity comes from the selected TapIn campaign, not the seed workspace", () => {
  assert.equal(campaignBrandName("Olyvv · Recipe discovery"), "Olyvv");
  assert.equal(campaignBrandName("Gatekept — Istanbul discovery"), "Gatekept");
});

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

test("TapIn preview isolates the draft campaign before it is saved", () => {
  const source = brand({
    name: "BHuman",
    product: "personalized video",
    targetMarkets: ["sales outreach"],
    keyFeatures: ["AI presenter"],
  });

  const campaign = tapInPreviewCampaignBrand(source, {
    campaignName: "Olyvv · Recipe discovery",
    targets: ["weeknight dinners", "meal planning"],
  });

  assert.equal(campaign.id, source.id);
  assert.equal(campaign.name, "Olyvv");
  assert.equal(campaign.product, "weeknight dinners, meal planning");
  assert.deepEqual(campaign.socialDiscoveryQueries, ["weeknight dinners", "meal planning"]);
  assert.deepEqual(campaign.targetMarkets, ["weeknight dinners", "meal planning"]);
  assert.deepEqual(campaign.keyFeatures, []);
  assert.equal(campaign.website, "");
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

test("YouTube scoring keeps relevant videos from the full default 24-hour discovery window", () => {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1_000).toISOString();
  const campaign = socialDiscoveryCampaignBrand(brand({
    socialDiscoveryCommentPrompt: [
      "Brand name: BHuman",
      "Brand positioning: personalized video at scale for sales outreach and marketing",
      "Runtime context:",
      "- TapIn supplies the matched YouTube video title and description to the generator automatically.",
    ].join("\n"),
  }));
  const post = buildScoredSocialDiscoveryPost({
    id: "socialpost_two_hours_old",
    brandId: campaign.id,
    platform: "youtube",
    provider: "youtube-data-api",
    externalId: "video_two_hours_old",
    url: "https://www.youtube.com/watch?v=video_two_hours_old",
    title: "How to personalize sales outreach with video",
    body: "A practical personalized marketing workflow for lead generation.",
    author: "Sales channel",
    community: "Sales channel",
    query: "sales outreach",
    engagementScore: 5_000,
    providerRank: 1,
    raw: {},
    postedAt: twoHoursAgo,
    discoveredAt: now.toISOString(),
    updatedAt: now.toISOString(),
    brand: campaign,
  });

  assert.ok(post);
  assert.equal(isEligibleYouTubeDiscoveryPost(post), true);
});
