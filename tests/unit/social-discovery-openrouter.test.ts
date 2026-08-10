import assert from "node:assert/strict";
import test from "node:test";

import type { BrandRecord } from "../../src/lib/factory-types";
import {
  buildScoredSocialDiscoveryPost,
  buildSocialCommentPlanningPrompt,
  refreshSocialDiscoveryCommentDraft,
} from "../../src/lib/social-discovery";

function brand(): BrandRecord {
  return {
    id: "brand_bhuman",
    name: "BHuman",
    website: "https://www.bhuman.ai",
    tone: "Casual",
    notes: "",
    product: "Personalized video at scale",
    socialDiscoveryCommentPrompt: "Join relevant conversations naturally.",
    socialDiscoveryPlatforms: ["youtube"],
    socialDiscoveryQueries: ["personalized marketing"],
    socialDiscoveryYouTubeSubscriptions: [],
    socialDiscoveryYouTubeAutoCommentEnabled: true,
    socialDiscoverySearchStrategy: null,
    operablePersonas: [],
    availableAssets: [],
    targetMarkets: ["sales teams"],
    idealCustomerProfiles: ["outbound teams"],
    keyFeatures: ["personalized video"],
    keyBenefits: ["more relevant outreach"],
    domains: [],
    leads: [],
    inbox: [],
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
  };
}

function post() {
  const now = new Date().toISOString();
  const scored = buildScoredSocialDiscoveryPost({
    id: "socialpost_openrouter",
    brandId: "brand_bhuman",
    platform: "youtube",
    provider: "youtube-data-api",
    externalId: "video_openrouter",
    url: "https://www.youtube.com/watch?v=video_openrouter",
    title: "Personalized video outreach tips",
    body: "How sales teams use personalized video without sounding robotic.",
    author: "Sales Channel",
    community: "Sales Channel",
    query: "personalized marketing",
    engagementScore: 5_000,
    providerRank: 1,
    raw: { youtube: { subscriberCount: 500 } },
    postedAt: now,
    discoveredAt: now,
    updatedAt: now,
    brand: brand(),
  });
  assert.ok(scored);
  return {
    ...scored,
    interactionPlan: {
      ...scored.interactionPlan,
      sequence: scored.interactionPlan.sequence.slice(0, 1),
    },
  };
}

function openRouterResponse(row: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(row) } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

test("thread prompt requires a real reply or rejects the whole opportunity", () => {
  const prompt = buildSocialCommentPlanningPrompt({
    brand: brand(),
    post: post(),
    force: true,
    mode: "thread",
  });
  assert.match(prompt, /replyDraft is required whenever shouldComment is true/i);
  assert.match(prompt, /If no natural reply exists, set shouldComment to false/i);
  assert.doesNotMatch(prompt, /leave it empty if fake or unnecessary/i);
});

test("TapIn live prompt reserves one separately supplied system punctuation rule", () => {
  const tapInBrand = {
    ...brand(),
    name: "BeforeUsersDo",
    socialDiscoveryCommentPrompt: [
      "Opening comment instructions:",
      "Ask how people deal with testing and QA after shipping apps with bugs they miss.",
      "Delayed reply instructions:",
      "Say fresh eyes matter. Mention BeforeUsersDo and explain that AI tests as customer personas while human testers return recordings and fixes.",
      "Runtime context:",
      "TapIn supplies the matched YouTube video title and description to the generator automatically.",
    ].join("\n"),
  };
  const prompt = buildSocialCommentPlanningPrompt({
    brand: tapInBrand,
    post: post(),
    force: true,
    mode: "thread",
  });

  assert.match(prompt, /campaign instructions.*sole authority.*system punctuation rule supplied separately/i);
  assert.doesNotMatch(prompt, /Never use em dashes/i);
  assert.match(prompt, /Do not apply any additional copywriting rules/i);
  assert.match(prompt, /AI tests as customer personas/i);
  assert.match(prompt, /human testers return recordings and fixes/i);
  assert.match(prompt, /Matched YouTube video title/i);
  assert.doesNotMatch(prompt, /TapIn supplies the matched YouTube/i);
  assert.doesNotMatch(
    prompt,
    /TapIn fidelity rule|viewer typing quickly|standard maximum|brand must|affiliation|safe requested intent|marketing language|mention policy|under \d+ words|use up to \d+ words/i
  );
});

test("TapIn live generation removes em dashes but preserves every other user-controlled choice", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  let requestCount = 0;
  const tapInBrand = {
    ...brand(),
    name: "BeforeUsersDo",
    socialDiscoveryCommentPrompt: [
      "Opening comment instructions:",
      "Write exactly: my app shipped — bugs everywhere; what now?",
      "Delayed reply instructions:",
      "Write exactly: BeforeUsersDo first—I work on it; use AI personas, include every recording + fix, and keep all this wording exactly as written!!!",
      "Runtime context:",
      "TapIn supplies the matched YouTube video title and description to the generator automatically.",
    ].join("\n"),
  };
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async (_input, init) => {
    requestCount += 1;
    const request = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    assert.deepEqual(request.messages?.[0], {
      role: "system",
      content: "Never use em dashes. Use commas, periods, or parentheses instead.",
    });
    return openRouterResponse({
      headline: "QA after vibe coding",
      fitSummary: "The video is about building and shipping apps with AI.",
      shouldComment: true,
      commentDraft: "my app shipped — bugs everywhere; what now?",
      replyDraft: "BeforeUsersDo first—I work on it; use AI personas, include every recording + fix, and keep all this wording exactly as written!!!",
      assetNeeded: "",
      riskNotes: [],
      exitRules: [],
    });
  };

  try {
    const drafted = await refreshSocialDiscoveryCommentDraft({
      brand: tapInBrand,
      post: post(),
      force: true,
      mode: "thread",
    });

    assert.equal(requestCount, 1);
    assert.equal(drafted.interactionPlan.sequence.length, 2);
    assert.equal(
      drafted.interactionPlan.sequence[0]?.draft,
      "my app shipped, bugs everywhere; what now?"
    );
    assert.equal(
      drafted.interactionPlan.sequence[1]?.draft,
      "BeforeUsersDo first, I work on it; use AI personas, include every recording + fix, and keep all this wording exactly as written!!!"
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

test("forced TapIn thread generation uses OpenRouter and returns both drafts", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return openRouterResponse({
      headline: "Relevant personalization discussion",
      fitSummary: "The video directly discusses personalized outreach.",
      shouldComment: true,
      commentDraft: "personalization without sounding robotic is the hard part—especially at scale",
      replyDraft: "outreach still feels awkward. BHuman fits the personalization part without taking over the conversation",
      assetNeeded: "",
      riskNotes: [],
      exitRules: [],
    });
  };

  try {
    const drafted = await refreshSocialDiscoveryCommentDraft({
      brand: brand(),
      post: post(),
      force: true,
      mode: "thread",
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(drafted.interactionPlan.sequence.length, 2);
    assert.equal(
      drafted.interactionPlan.sequence[0]?.draft,
      "Personalization without sounding robotic is the hard part, especially at scale"
    );
    assert.equal(drafted.interactionPlan.sequence[1]?.draft, "Outreach still feels awkward. BHuman fits the personalization part without taking over the conversation");
    assert.equal(drafted.interactionPlan.generationPromptMode, "auto");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
});

test("social comment prompt explicitly bans long dashes", () => {
  const prompt = buildSocialCommentPlanningPrompt({
    brand: brand(),
    post: post(),
    force: true,
    mode: "solo",
  });
  assert.match(prompt, /Never use em dashes or en dashes/i);
  assert.match(prompt, /standard maximum 32 words/i);
  assert.match(prompt, /small aside/i);
  assert.doesNotMatch(prompt, /heuristic_comment:/i);
});

test("forced TapIn generation surfaces OpenRouter failures instead of reusing a stale draft", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "quota exhausted" } }), { status: 429 });

  try {
    await assert.rejects(
      refreshSocialDiscoveryCommentDraft({
        brand: brand(),
        post: post(),
        force: true,
        mode: "thread",
      }),
      /Social comment generation failed: OpenRouter request failed with 429/i
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

test("forced thread generation rejects two OpenRouter drafts that omit the reply", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  let requestCount = 0;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => {
    requestCount += 1;
    return openRouterResponse({
      headline: "Relevant personalization discussion",
      fitSummary: "The video directly discusses personalized outreach.",
      shouldComment: true,
      commentDraft: "BHuman makes this part less manual",
      replyDraft: "",
      assetNeeded: "",
      riskNotes: [],
      exitRules: [],
    });
  };

  try {
    await assert.rejects(
      refreshSocialDiscoveryCommentDraft({
        brand: brand(),
        post: post(),
        force: true,
        mode: "thread",
      }),
      /OpenRouter returned no replyDraft for a two-account thread/i
    );
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});
