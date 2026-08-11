import assert from "node:assert/strict";
import test from "node:test";

import {
  findTapInCampaignRuntimeBrand,
  resolveActiveTapInRunnerBrandIds,
  tapInCampaignRuntimeIdentity,
  tapInCampaignRuntimeNotes,
} from "../../src/lib/tapinsocial-campaign-runtime";
import type { BrandRecord } from "../../src/lib/factory-types";

function brand(input: Partial<BrandRecord> & Pick<BrandRecord, "id">): BrandRecord {
  return {
    id: input.id,
    name: input.name ?? input.id,
    website: "",
    tone: "",
    notes: input.notes ?? "",
    product: "",
    socialDiscoveryCommentPrompt: "",
    socialDiscoveryPlatforms: ["youtube"],
    socialDiscoveryQueries: [],
    socialDiscoveryYouTubeSubscriptions: [],
    socialDiscoveryYouTubeAutoCommentEnabled: input.socialDiscoveryYouTubeAutoCommentEnabled ?? true,
    socialDiscoverySearchStrategy: null,
    socialDiscoveryYouTubePolicy: null,
    operablePersonas: [],
    availableAssets: [],
    targetMarkets: [],
    idealCustomerProfiles: [],
    keyFeatures: [],
    keyBenefits: [],
    domains: [],
    leads: [],
    inbox: [],
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
  };
}

test("stores and resolves a campaign identity without reusing the workspace brand", () => {
  const notes = tapInCampaignRuntimeNotes({ workspaceBrandId: "brand_seed", campaignId: "campaign_olyvv" });
  assert.deepEqual(tapInCampaignRuntimeIdentity({ notes }), {
    workspaceBrandId: "brand_seed",
    campaignId: "campaign_olyvv",
  });
  const campaign = brand({ id: "brand_campaign", notes });
  assert.equal(findTapInCampaignRuntimeBrand([campaign], {
    workspaceBrandId: "brand_seed",
    campaignId: "campaign_olyvv",
  })?.id, "brand_campaign");
});

test("active campaign brands replace their shared seed in the runner", () => {
  const olyvv = brand({
    id: "brand_olyvv",
    notes: tapInCampaignRuntimeNotes({ workspaceBrandId: "brand_seed", campaignId: "campaign_olyvv" }),
  });
  const cluster = brand({
    id: "brand_cluster",
    notes: tapInCampaignRuntimeNotes({ workspaceBrandId: "brand_seed", campaignId: "campaign_cluster" }),
  });
  const disabled = brand({
    id: "brand_disabled",
    notes: tapInCampaignRuntimeNotes({ workspaceBrandId: "brand_seed", campaignId: "campaign_disabled" }),
    socialDiscoveryYouTubeAutoCommentEnabled: false,
  });

  assert.deepEqual(
    resolveActiveTapInRunnerBrandIds({
      configuredBrandIds: ["brand_seed", "brand_other"],
      brands: [olyvv, cluster, disabled],
    }),
    ["brand_other", "brand_olyvv", "brand_cluster"]
  );
});
