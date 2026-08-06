import assert from "node:assert/strict";
import test from "node:test";

import { generateTapInThreadPreview } from "../../src/lib/tapinsocial-preview";

test("TapIn preview uses OpenRouter directly", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const urls: string[] = [];
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                openingComment: "personalization without sounding robotic is the hard part",
                reply: "we use BHuman for this and it has been solid",
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const preview = await generateTapInThreadPreview({
      brandName: "BHuman",
      openingPrompt: "Ask a natural question about personalized video.",
      replyPrompt: "Reply naturally and mention BHuman once.",
      videoTitle: "Personalized video outreach tips",
      videoDescription: "How sales teams use personalized video without sounding robotic.",
    });
    assert.deepEqual(urls, ["https://openrouter.ai/api/v1/chat/completions"]);
    assert.equal(preview.reply, "we use BHuman for this and it has been solid");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
});

test("comment-only preview does not require or return a reply", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ openingComment: "This workflow gets the personalization balance right." }) } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

  try {
    const preview = await generateTapInThreadPreview({
      campaignType: "comment",
      brandName: "BHuman",
      openingPrompt: "React naturally to the video.",
      replyPrompt: "",
      videoTitle: "Personalized outreach workflows",
      videoDescription: "A practical walkthrough.",
    });
    assert.equal(preview.openingComment, "This workflow gets the personalization balance right.");
    assert.equal(preview.reply, "");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});
