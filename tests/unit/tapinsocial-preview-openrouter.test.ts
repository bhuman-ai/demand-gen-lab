import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTapInPreviewFallback,
  buildTapInPreviewPrompt,
  generateTapInThreadPreview,
} from "../../src/lib/tapinsocial-preview";
import {
  youtubeBrandAffiliationProblem,
  youtubeBrandIsIncidentalProblem,
  youtubeCommentStyleProblem,
  youtubeExactBrandMentionProblem,
} from "../../src/lib/youtube-comment-style";

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
    assert.equal(preview.reply, "Outreach still feels awkward lol. I work on BHuman and we started with this exact headache");
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
  const reply = "Seo feels impossible lately. I work on ClusterSEO and tiktok links have been oddly decent, but everywhere else feels completely dead. Anyone seeing something different?";
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
    assert.equal(preview.openingComment, "Copying the same seo checklist everywhere is so real lol");
    assert.equal(preview.reply, "Seo feels random lately. I work on ClusterSEO and this problem comes up nonstop");
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
    assert.equal(preview.reply, "Seo feels random lately. I work on ClusterSEO and this problem comes up nonstop");
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

test("TapIn fallback stays native and transparent for a thread", () => {
  const preview = buildTapInPreviewFallback({
    brandName: "SafeAgain",
    openingPrompt: "React naturally.",
    replyPrompt: "Mention SafeAgain as a personal aside.",
    videoTitle: "Upcoming YouTube video about women's safety",
    videoDescription: "Practical bystander intervention advice.",
  });

  assert.equal(
    preview.openingComment,
    "The practical details around women's safety matter more than they first seem."
  );
  assert.equal(youtubeCommentStyleProblem(preview.openingComment, "opening"), "");
  assert.equal(youtubeCommentStyleProblem(preview.reply, "reply"), "");
  assert.equal(youtubeExactBrandMentionProblem(preview.reply, "SafeAgain"), "");
  assert.equal(youtubeBrandAffiliationProblem(preview.reply, "SafeAgain"), "");
  assert.equal(youtubeBrandIsIncidentalProblem(preview.reply, "SafeAgain"), "");
});

test("TapIn returns a usable comment preview when OpenRouter is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalConsoleError = console.error;
  let requestCount = 0;
  const errors: string[] = [];
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ error: { message: "provider unavailable" } }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  };
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));

  try {
    const preview = await generateTapInThreadPreview({
      campaignType: "comment",
      brandName: "SafeAgain",
      openingPrompt: "React naturally to the video.",
      replyPrompt: "",
      videoTitle: "Women's safety and street harassment prevention",
      videoDescription: "Practical bystander intervention advice.",
    });

    assert.equal(requestCount, 2);
    assert.equal(preview.reply, "");
    assert.ok(preview.openingComment.length > 0);
    assert.equal(youtubeCommentStyleProblem(preview.openingComment, "opening"), "");
    assert.match(errors.join("\n"), /using deterministic fallback/i);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});
