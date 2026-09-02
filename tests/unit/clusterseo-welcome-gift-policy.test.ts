import assert from "node:assert/strict";
import test from "node:test";
import {
  clusterSeoWelcomeGiftAutomationConfig,
  explainClusterSeoWelcomeGiftEligibility,
  isAutomatableClusterSeoWelcomeGift,
  normalizeAutomatedWelcomeGiftComment,
  normalizeClusterSeoTargetDomain,
  validateAutomatedWelcomeGiftComment,
} from "../../src/lib/clusterseo-welcome-gift-policy";

const tapInUserId = "5d18d7f7-3c3d-4e49-a50d-579be182af85";
const clusterUserId = "16bf98d0-c367-4802-95dd-d8404dd4a11b";
const youtubeAccountId = "acct_38738ec8bcf343f0";

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
    accountIds: [],
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
    CLUSTERSEO_WELCOME_GIFT_AUTOMATION_ACCOUNT_IDS: `${youtubeAccountId},invalid,${youtubeAccountId}`,
    CLUSTERSEO_WELCOME_GIFT_AUTOMATION_TARGET_DOMAINS: "https://www.bhuman.ai/, BHUMAN.AI",
    CLUSTERSEO_WELCOME_GIFT_AUTOMATION_PER_RUN_CAP: "20",
  });
  assert.equal(config.enabled, true);
  assert.equal(config.dryRun, false);
  assert.deepEqual(config.userIds, [tapInUserId]);
  assert.deepEqual(config.accountIds, [youtubeAccountId]);
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

test("automated comments reject the exact generic YouTube boilerplate failure", () => {
  const result = validateAutomatedWelcomeGiftComment({
    value:
      "It’s cool how YouTube lets you share original content with friends and family. Bhuman’s approach to AI videos feels more natural and less forced.",
    opportunity: candidate({
      targetPostTitle: "Actually human AI videos that do not look cringe | BHuman Speakeasy",
    }),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.reasons, [
    "generic_comment",
    "missing_reason_or_implication",
    "missing_title_context",
  ]);
});

test("automated comments reject bland praise from the production preview", () => {
  const result = validateAutomatedWelcomeGiftComment({
    value:
      "The walkthrough covers a solid range of features without getting overwhelming. Bhuman’s approach to simplifying complex tools feels pretty balanced here.",
    opportunity: candidate({
      targetPostTitle: "BHuman Full Platform Walkthrough",
    }),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.reasons, ["generic_comment", "missing_reason_or_implication"]);
});

test("automated comments reject hedged AI-style language from the revised preview", () => {
  const result = validateAutomatedWelcomeGiftComment({
    value:
      "The full platform walkthrough makes it easier to see how different tools work together on YouTube. Bhuman’s setup seems thoughtfully organized without overcomplicating things.",
    opportunity: candidate({
      targetPostTitle: "BHuman Full Platform Walkthrough",
    }),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.reasons, ["generic_comment", "missing_reason_or_implication"]);
});

test("automated comments reject abstract reviewer language from the final preview", () => {
  const result = validateAutomatedWelcomeGiftComment({
    value:
      "This full platform walkthrough helps clarify how each feature fits together, which makes BHuman easier to understand rather than just seeing isolated parts.",
    opportunity: candidate({
      targetPostTitle: "BHuman Full Platform Walkthrough",
    }),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.reasons, ["generic_comment"]);
});

test("automated comments reject abstract workflow language after transcript grounding", () => {
  const result = validateAutomatedWelcomeGiftComment({
    value:
      "The full platform walkthrough shows how BHuman handles video personalization steps in one place, which helps keep the workflow smooth instead of juggling multiple apps.",
    opportunity: candidate({
      targetPostTitle: "BHuman Full Platform Walkthrough",
    }),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.reasons, ["generic_comment"]);
});

test("automated comments accept a concrete operational observation", () => {
  const result = validateAutomatedWelcomeGiftComment({
    value:
      "Turning one recording into personalized videos for every lead matters because the workflow has to stay manageable as the campaign scales. BHuman shows that here.",
    opportunity: candidate({
      targetPostTitle: "How to Create Personalized AI Videos at Scale with BHuman 2.0",
    }),
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.reasons, []);
});

test("automated comments require a brand mention and a distinctive title cue", () => {
  const result = validateAutomatedWelcomeGiftComment({
    value:
      "AI videos need to feel less cringe because faster output does not matter if teams will not send it. BHuman gets much closer to that bar.",
    opportunity: candidate({
      targetPostTitle: "Actually human AI videos that do not look cringe | BHuman Speakeasy",
    }),
  });

  assert.deepEqual(result, {
    text:
      "AI videos need to feel less cringe because faster output does not matter if teams will not send it. BHuman gets much closer to that bar.",
    valid: true,
    reasons: [],
    titleCues: ["actually", "human", "cringe", "speakeasy"],
  });
});
