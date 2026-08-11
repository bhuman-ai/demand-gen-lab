import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTapInPreviewPrompt,
  generateTapInThreadPreview,
} from "../../src/lib/tapinsocial-preview";

function openRouterResponse(value: Record<string, unknown>) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

test("TapIn preview prompt reserves separately supplied YouTube-native system rules", () => {
  const prompt = buildTapInPreviewPrompt({
    brandName: "BeforeUsersDo",
    openingPrompt: "Use my exact opening voice.",
    replyPrompt: "Use my exact reply voice.",
    videoTitle: "Shipping an app with Codex",
    videoDescription: "A walkthrough of building and shipping an app.",
  });

  assert.match(prompt, /user's prompts.*control the topic, perspective, brand mentions, and required details/i);
  assert.match(prompt, /YouTube-native length, capitalization, and punctuation rules supplied separately/i);
  assert.doesNotMatch(prompt, /Never use em dashes/i);
  assert.match(prompt, /Opening prompt:\nUse my exact opening voice/i);
  assert.match(prompt, /Reply prompt:\nUse my exact reply voice/i);
  assert.match(prompt, /Matched YouTube video title:\nShipping an app with Codex/i);
  assert.doesNotMatch(
    prompt,
    /viewer typing quickly|standard maximum|brand must|affiliation|safe instruction|unsupported claim|marketing language|direct recommendation|maximum \d+ words|grounding/i
  );
});

test("TapIn preview removes em dashes and normalizes natural capitalization", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const openingComment = "my app shipped — bugs everywhere. what now?";
  const reply = "BeforeUsersDo first — I work on it. AI personas + recordings help.";
  let requestCount = 0;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async (_input, init) => {
    requestCount += 1;
    const request = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    assert.equal(request.messages?.[0]?.role, "system");
    assert.match(request.messages?.[0]?.content ?? "", /Never use em dashes/i);
    assert.match(request.messages?.[0]?.content ?? "", /YouTube-native voice rules/i);
    assert.match(request.messages?.[0]?.content ?? "", /standard maximum 32 words/i);
    return openRouterResponse({ openingComment, reply });
  };

  try {
    const preview = await generateTapInThreadPreview({
      brandName: "BeforeUsersDo",
      openingPrompt: `Write exactly: ${openingComment}`,
      replyPrompt: `Write exactly: ${reply}`,
      videoTitle: "Vibe coding",
      videoDescription: "A video about shipping apps.",
    });

    assert.equal(requestCount, 1);
    assert.deepEqual(preview, {
      openingComment: "My app shipped, bugs everywhere. What now?",
      reply: "BeforeUsersDo first, I work on it. AI personas + recordings help.",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

test("TapIn retries only an incomplete output and adds no copy rules during repair", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  let requestCount = 0;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async (_input, init) => {
    requestCount += 1;
    const request = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    if (requestCount === 2) {
      const prompt = request.messages?.find((message) => message.role === "user")?.content ?? "";
      assert.match(prompt, /structurally invalid because reply is empty/i);
      assert.match(prompt, /rewrite the complete response so it passes that exact failed check/i);
      assert.match(prompt, /Do not change, reinterpret, or add to the user's copy instructions/i);
      assert.doesNotMatch(prompt, /brand.*aside|affiliation|maximum \d+ words|marketing language/i);
    }
    return openRouterResponse(
      requestCount === 1
        ? { openingComment: "opening exactly as requested", reply: "" }
        : { openingComment: "opening exactly as requested", reply: "reply exactly as requested" }
    );
  };

  try {
    const preview = await generateTapInThreadPreview({
      brandName: "AnyBrand",
      openingPrompt: "opening instruction",
      replyPrompt: "reply instruction",
      videoTitle: "Video",
      videoDescription: "Description",
    });
    assert.equal(requestCount, 2);
    assert.equal(preview.reply, "Reply exactly as requested");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

test("TapIn retries a long AI-style preview before approval", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  let requestCount = 0;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async (_input, init) => {
    requestCount += 1;
    if (requestCount === 2) {
      const request = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      const prompt = request.messages?.find((message) => message.role === "user")?.content ?? "";
      assert.match(prompt, /too many words/i);
      assert.match(prompt, /remove optional detail instead of repeating the same draft/i);
    }
    return openRouterResponse({
      openingComment:
        requestCount === 1
          ? "This is a polished and unnecessarily long explanation of the recipe workflow that keeps going with extra detail about planning every meal and organizing every ingredient before adding a product recommendation that sounds like a marketing assistant wrote it."
          : "Batching the proteins on Sunday saves so much time. Olyvv can keep recipes like these together too.",
    });
  };

  try {
    const preview = await generateTapInThreadPreview({
      campaignType: "comment",
      brandName: "Olyvv",
      openingPrompt: "Keep it short and casual. Mention Olyvv only as an aside.",
      replyPrompt: "",
      videoTitle: "Busy weeknight dinners",
      videoDescription: "Quick meals for families.",
    });
    assert.equal(requestCount, 2);
    assert.equal(
      preview.openingComment,
      "Batching the proteins on Sunday saves so much time. Olyvv can keep recipes like these together too."
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

test("TapIn comment-only preview maps only the opening prompt", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => openRouterResponse({ openingComment: "exact solo comment" });

  try {
    const preview = await generateTapInThreadPreview({
      campaignType: "comment",
      brandName: "AnyBrand",
      openingPrompt: "Write exact solo comment.",
      replyPrompt: "This must not be used.",
      videoTitle: "Video",
      videoDescription: "Description",
    });
    assert.deepEqual(preview, { openingComment: "Exact solo comment", reply: "" });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

test("TapIn does not substitute hidden fallback copy when generation is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  let requestCount = 0;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ error: { message: "provider unavailable" } }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await assert.rejects(
      generateTapInThreadPreview({
        brandName: "AnyBrand",
        openingPrompt: "opening instruction",
        replyPrompt: "reply instruction",
        videoTitle: "Video",
        videoDescription: "Description",
      }),
      /failed after three attempts/i
    );
    assert.ok(requestCount >= 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});
