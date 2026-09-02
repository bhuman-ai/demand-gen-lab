import assert from "node:assert/strict";
import test from "node:test";
import {
  clusterSeoWelcomeGiftAutomationConfig,
  explainClusterSeoWelcomeGiftEligibility,
  isAutomatableClusterSeoWelcomeGift,
  normalizeAutomatedWelcomeGiftComment,
  normalizeClusterSeoTargetDomain,
} from "../../src/lib/clusterseo-welcome-gift-policy";

const tapInUserId = "5d18d7f7-3c3d-4e49-a50d-579be182af85";
const clusterUserId = "16bf98d0-c367-4802-95dd-d8404dd4a11b";

function candidate(overrides: Record<string, string> = {}) {
  return {
    id: "4591bbf7-b8b4-4859-92d6-55c519f0c849",
    platform: "YOUTUBE",
    actionKind: "COMMENT",
    targetPostUrl: "https://www.youtube.com/watch?v=example",
    targetPostTitle: "BHuman product demo",
    targetBrandName: "BHuman",
    targetBrandUserId: clusterUserId,
    targetDomainToken: "https://www.bhuman.ai/",
    sourceProvider: "clusterseo:welcome_youtube_gift",
    ...overrides,
  };
}

test("welcome gift automation is disabled and dry by default", () => {
  assert.deepEqual(clusterSeoWelcomeGiftAutomationConfig({}), {
    enabled: false,
    dryRun: true,
    userIds: [],
    targetDomains: [],
    perRunCap: 1,
    configured: false,
  });
});

test("welcome gift automation validates allowlists and caps each run", () => {
  const config = clusterSeoWelcomeGiftAutomationConfig({
    CLUSTERSEO_WELCOME_GIFT_AUTOMATION_ENABLED: "true",
    CLUSTERSEO_WELCOME_GIFT_AUTOMATION_DRY_RUN: "false",
    CLUSTERSEO_WELCOME_GIFT_AUTOMATION_USER_IDS: `${tapInUserId},not-a-user,${tapInUserId}`,
    CLUSTERSEO_WELCOME_GIFT_AUTOMATION_TARGET_DOMAINS: "https://www.bhuman.ai/, BHUMAN.AI",
    CLUSTERSEO_WELCOME_GIFT_AUTOMATION_PER_RUN_CAP: "20",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.dryRun, false);
  assert.deepEqual(config.userIds, [tapInUserId]);
  assert.deepEqual(config.targetDomains, ["bhuman.ai"]);
  assert.equal(config.perRunCap, 3);
  assert.equal(config.configured, true);
});

test("only self-owned, tagged, domain-allowlisted YouTube comments are automatic", () => {
  const accepts = (overrides: Record<string, string> = {}) =>
    isAutomatableClusterSeoWelcomeGift({
      opportunity: candidate(overrides),
      clusterUserId,
      targetDomains: ["bhuman.ai"],
    });

  assert.equal(accepts(), true);
  assert.equal(accepts({ sourceProvider: "clusterseo:ordinary_mission" }), false);
  assert.equal(accepts({ targetBrandUserId: "46ef7202-834d-4c37-b4b2-bfdac1fd6cec" }), false);
  assert.equal(accepts({ targetDomainToken: "example.com" }), false);
  assert.equal(accepts({ platform: "LINKEDIN" }), false);
  assert.equal(accepts({ actionKind: "LIKE" }), false);
});

test("eligibility diagnostics expose only bounded checks", () => {
  assert.deepEqual(
    explainClusterSeoWelcomeGiftEligibility({
      opportunity: candidate({ targetDomainToken: "other.example" }),
      clusterUserId,
      targetDomains: ["bhuman.ai"],
    }),
    {
      missionId: "4591bbf7-b8b4-4859-92d6-55c519f0c849",
      targetBrandName: "BHuman",
      targetDomain: "other.example",
      targetPostTitle: "BHuman product demo",
      targetPostUrl: "https://www.youtube.com/watch?v=example",
      checks: {
        youtubeComment: true,
        selfOwned: true,
        welcomeGiftTagged: true,
        targetDomainAllowlisted: false,
      },
      eligible: false,
    }
  );
});

test("domain and comment normalization remove presentation differences and long dashes", () => {
  assert.equal(normalizeClusterSeoTargetDomain("https://www.BHuman.ai/path/"), "bhuman.ai");
  assert.equal(
    normalizeAutomatedWelcomeGiftComment("Useful\u2014clear\n\nexample\u2013thanks."),
    "Useful-clear example-thanks."
  );
});
