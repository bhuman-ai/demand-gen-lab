import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTapInPreviewPrompt,
  generateTapInThreadPreview,
} from "../../src/lib/tapinsocial-preview";

test("TapIn preview prompt explicitly bans long dashes", () => {
  const prompt = buildTapInPreviewPrompt({
    campaignType: "comment",
    brandName: "Gatekept",
    openingPrompt: "React naturally.",
    replyPrompt: "",
    videoTitle: "Istanbul travel",
    videoDescription: "A morning in Balat.",
  });

  assert.match(prompt, /Never use em dashes or en dashes/i);
  assert.match(prompt, /hard maximum 32 words/i);
  assert.match(prompt, /viewer typing quickly/i);
});

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
                reply: "outreach still feels awkward lol. i work on BHuman and we started with this exact headache",
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
    assert.equal(preview.reply, "outreach still feels awkward lol. i work on BHuman and we started with this exact headache");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
});

test("TapIn preview preserves a valid casual reply beyond the old 150-character cutoff", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const reply = "seo feels impossible lately. i work on ClusterSEO and tiktok links have been oddly decent, but everywhere else feels completely dead. anyone seeing something different?";
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            openingComment: "seo is rough lately. anyone actually seeing consistent results?",
            reply,
          }),
        },
      }],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

  try {
    const preview = await generateTapInThreadPreview({
      brandName: "ClusterSEO",
      openingPrompt: "React naturally.",
      replyPrompt: "Mention ClusterSEO as an aside.",
      videoTitle: "SEO is getting harder",
      videoDescription: "A discussion about unpredictable search results.",
    });
    assert.ok(reply.length > 150);
    assert.equal(preview.reply, reply);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

test("TapIn preview retries polished mini-essays", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  let requestCount = 0;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => {
    requestCount += 1;
    const content = requestCount === 1
      ? {
          openingComment: "Really appreciated the point about testing SEO tactics instead of blindly following checklists across every website and assuming the same best practices will always work in every situation.",
          reply: "This is spot on. Tools like ClusterSEO can help serious marketers understand the gap between generic advice and useful recommendations.",
        }
      : {
          openingComment: "copying the same seo checklist everywhere is so real lol",
          reply: "seo feels random lately. i work on ClusterSEO and this problem comes up nonstop",
        };
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const preview = await generateTapInThreadPreview({
      brandName: "ClusterSEO",
      openingPrompt: "React naturally.",
      replyPrompt: "Mention ClusterSEO.",
      videoTitle: "SEO best practices we ignore",
      videoDescription: "Why the same checklist does not work on every site.",
    });
    assert.equal(requestCount, 2);
    assert.equal(preview.openingComment, "copying the same seo checklist everywhere is so real lol");
    assert.equal(preview.reply, "seo feels random lately. i work on ClusterSEO and this problem comes up nonstop");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

test("TapIn preview retries a misspelled or undisclosed brand reply", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  let requestCount = 0;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => {
    requestCount += 1;
    const content = requestCount === 1
      ? {
          openingComment: "ranking with barely any content is wild",
          reply: "yeah clusterseoul verifies what actually works",
        }
      : {
          openingComment: "ranking with barely any content is wild",
          reply: "seo feels random lately. i work on ClusterSEO and this problem comes up nonstop",
        };
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const preview = await generateTapInThreadPreview({
      brandName: "ClusterSEO",
      openingPrompt: "React naturally.",
      replyPrompt: "Mention ClusterSEO.",
      videoTitle: "SEO best practices we ignore",
      videoDescription: "Why the same checklist does not work on every site.",
    });
    assert.equal(requestCount, 2);
    assert.equal(preview.reply, "seo feels random lately. i work on ClusterSEO and this problem comes up nonstop");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

test("comment-only preview does not require or return a reply", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ openingComment: "This workflow gets the personalization balance right—the details matter." }) } }] }),
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
    assert.equal(preview.openingComment, "This workflow gets the personalization balance right, the details matter.");
    assert.equal(preview.reply, "");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});
