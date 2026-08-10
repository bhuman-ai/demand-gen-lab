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

test("TapIn live prompt preserves campaign instructions that need factual capability context", () => {
  const tapInBrand = {
    ...brand(),
    name: "BeforeUsersDo",
    socialDiscoveryCommentPrompt: [
      "Opening comment instructions:",
      "Ask how people deal with testing and QA after shipping apps with bugs they miss.",
      "Delayed reply instructions:",
      "Say fresh eyes matter. Mention BeforeUsersDo and explain that AI tests as customer personas while human testers return recordings and fixes.",
      "TapIn supplies the matched YouTube video title and description to the generator automatically.",
    ].join("\n"),
  };
  const prompt = buildSocialCommentPlanningPrompt({
    brand: tapInBrand,
    post: post(),
    force: true,
    mode: "thread",
  });

  assert.match(prompt, /TapIn fidelity rule/i);
  assert.match(prompt, /preserve every safe requested intent/i);
  assert.match(prompt, /include every requested capability/i);
  assert.match(prompt, /use up to 48 words/i);
  assert.match(prompt, /AI tests as customer personas/i);
  assert.match(prompt, /human testers return recordings and fixes/i);
});

test("TapIn live generation keeps a prompt-faithful factual reply beyond the default limit", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const tapInBrand = {
    ...brand(),
    name: "BeforeUsersDo",
    socialDiscoveryCommentPrompt: [
      "Opening comment instructions:",
      "Ask how people deal with testing and QA after shipping apps with bugs they miss.",
      "Delayed reply instructions:",
      "Say fresh eyes matter. Mention BeforeUsersDo and explain that AI tests as customer personas while human testers return recordings and fixes.",
      "TapIn supplies the matched YouTube video title and description to the generator automatically.",
    ].join("\n"),
  };
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => openRouterResponse({
    headline: "QA after vibe coding",
    fitSummary: "The video is about building and shipping apps with AI.",
    shouldComment: true,
    commentDraft: "How do people catch the bugs they miss after tutorials like this? Shipping an app and realizing QA missed things is brutal.",
    replyDraft: "Fresh eyes are usually what changes it. I work on BeforeUsersDo. Our AI tests apps as customer personas, and human testers can return recordings, fixes, and instructions for Codex or Claude.",
    assetNeeded: "",
    riskNotes: [],
    exitRules: [],
  });

  try {
    const drafted = await refreshSocialDiscoveryCommentDraft({
      brand: tapInBrand,
      post: post(),
      force: true,
      mode: "thread",
    });

    assert.equal(drafted.interactionPlan.sequence.length, 2);
    assert.match(drafted.interactionPlan.sequence[0]?.draft ?? "", /bugs.*tutorial|tutorial.*bugs/i);
    assert.match(drafted.interactionPlan.sequence[1]?.draft ?? "", /Fresh eyes/i);
    assert.match(drafted.interactionPlan.sequence[1]?.draft ?? "", /I work on BeforeUsersDo/i);
    assert.match(drafted.interactionPlan.sequence[1]?.draft ?? "", /AI tests apps as customer personas/i);
    assert.match(drafted.interactionPlan.sequence[1]?.draft ?? "", /human testers.*recordings.*fixes.*Codex or Claude/i);
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
      replyDraft: "outreach still feels awkward. i work on BHuman and we started with this exact headache",
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
    assert.equal(drafted.interactionPlan.sequence[1]?.draft, "Outreach still feels awkward. I work on BHuman and we started with this exact headache");
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
  assert.match(prompt, /small (?:disclosed )?aside/i);
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
