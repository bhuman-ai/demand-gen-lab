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

test("TapIn preview prompt contains only user copy instructions, output structure, and video context", () => {
  const prompt = buildTapInPreviewPrompt({
    brandName: "BeforeUsersDo",
    openingPrompt: "Use my exact opening voice.",
    replyPrompt: "Use my exact reply voice.",
    videoTitle: "Shipping an app with Codex",
    videoDescription: "A walkthrough of building and shipping an app.",
  });

  assert.match(prompt, /user's prompts.*sole authority/i);
  assert.match(prompt, /Opening prompt:\nUse my exact opening voice/i);
  assert.match(prompt, /Reply prompt:\nUse my exact reply voice/i);
  assert.match(prompt, /Matched YouTube video title:\nShipping an app with Codex/i);
  assert.doesNotMatch(
    prompt,
    /viewer typing quickly|standard maximum|brand must|affiliation|em dashes|safe instruction|unsupported claim|marketing language|direct recommendation|maximum \d+ words|grounding/i
  );
});

test("TapIn preview returns model copy without punctuation, capitalization, length, or brand rewriting", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const openingComment = "my app shipped — bugs everywhere; what now?";
  const reply = "BeforeUsersDo first: I work on it, use AI personas, then send every recording + fix!!!";
  let requestCount = 0;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => {
    requestCount += 1;
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
    assert.deepEqual(preview, { openingComment, reply });
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
      messages?: Array<{ content?: string }>;
    };
    if (requestCount === 2) {
      const prompt = request.messages?.[0]?.content ?? "";
      assert.match(prompt, /structurally invalid because reply is empty/i);
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
    assert.equal(preview.reply, "reply exactly as requested");
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
    assert.deepEqual(preview, { openingComment: "exact solo comment", reply: "" });
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
