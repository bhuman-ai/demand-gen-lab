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
  assert.match(prompt, /standard maximum 32 words/i);
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

test("TapIn follows the requested QA question and factual BeforeUsersDo reply", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  let requestCount = 0;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async (_input, init) => {
    requestCount += 1;
    const request = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ content?: string }>;
    };
    const prompt = request.messages?.[0]?.content ?? "";
    assert.match(prompt, /Ask how people deal with testing and QA/i);
    assert.match(prompt, /fresh eyes/i);
    assert.match(prompt, /AI does the QA as persona of your customer/i);
    assert.match(prompt, /human who tests your app/i);
    assert.match(prompt, /every safe instruction.*required substance/i);
    if (requestCount === 2) {
      assert.match(prompt, /omits the requested AI customer-persona QA capability/i);
      assert.match(prompt, /include every requested capability/i);
    }

    const reply = requestCount === 1
      ? "Fresh eyes are usually what changes it. I work on BeforeUsersDo. Human testers can return recordings, fixes, and instructions for Codex or Claude."
      : "Fresh eyes are usually what changes it. I work on BeforeUsersDo. Our AI tests apps as customer personas, and human testers can return recordings, fixes, and instructions for Codex or Claude.";
    return new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              openingComment: "How do people catch the bugs they miss after tutorials like this? Shipping an app and realizing QA missed things is brutal.",
              reply,
            }),
          },
        }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const preview = await generateTapInThreadPreview({
      brandName: "BeforeUsersDo",
      openingPrompt: "Ask how people deal with testing and QA cause you followed this tutorial and others and have shipped app but theyre always full of bugs you miss",
      replyPrompt: "Reply directly to the opening comment with saying you had this problem and u just need to get fresh eyes on it that's the only way. Mention Before Users Do in a relevant way. You can talk about their features which an AI does the QA as persona of your customer and for real testing they connect you with an actual human who tests your app and you get all the recordings all the fixes and instructions you just paste into codex/claude",
      videoTitle: "100 hours of Vibe Coding lessons in 20 minutes",
      videoDescription: "A condensed vibe coding tutorial about building and shipping apps with AI.",
    });

    assert.equal(requestCount, 2);
    assert.match(preview.openingComment, /bugs.*tutorial|tutorial.*bugs/i);
    assert.match(preview.reply, /Fresh eyes/i);
    assert.match(preview.reply, /I work on BeforeUsersDo/i);
    assert.match(preview.reply, /AI tests apps as customer personas/i);
    assert.match(preview.reply, /human testers.*recordings.*fixes.*Codex or Claude/i);
    assert.doesNotMatch(`${preview.openingComment} ${preview.reply}`, /practical details around|real challenge is applying it consistently/i);
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
          openingComment: "copying the same seo checklist everywhere is wild",
          reply: "yeah clusterseoul verifies what actually works",
        }
      : {
          openingComment: "copying the same seo checklist everywhere is wild",
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
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ openingComment: "This practical walkthrough gets the personalization balance right—the details matter." }) } }] }),
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
    assert.equal(preview.openingComment, "This practical walkthrough gets the personalization balance right, the details matter.");
    assert.equal(preview.reply, "");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

test("TapIn fallback grounds the thread in a concrete video claim", () => {
  const preview = buildTapInPreviewFallback({
    brandName: "SafeAgain",
    openingPrompt: "React naturally.",
    replyPrompt: "Mention SafeAgain as a personal aside.",
    videoTitle: "STAND UP Let's Act Together Against Street Harassment",
    videoDescription: [
      "L'Oréal Paris is a brand that stands for and with women.",
      "The research found that the #1 issue women and girls face globally is harassment.",
      "Yet 79% of women wish someone had intervened.",
    ].join(" "),
  });

  assert.match(preview.openingComment, /79% of women wish someone had intervened/i);
  assert.doesNotMatch(preview.openingComment, /practical details around/i);
  assert.doesNotMatch(preview.reply, /applying it consistently|question comes up often/i);
  assert.equal(youtubeCommentStyleProblem(preview.openingComment, "opening"), "");
  assert.equal(youtubeCommentStyleProblem(preview.reply, "reply"), "");
  assert.equal(youtubeExactBrandMentionProblem(preview.reply, "SafeAgain"), "");
  assert.equal(youtubeBrandAffiliationProblem(preview.reply, "SafeAgain"), "");
  assert.equal(youtubeBrandIsIncidentalProblem(preview.reply, "SafeAgain"), "");
});

test("TapIn repairs the rejected draft instead of replacing it with canned fallback copy", async () => {
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
      assert.match(request.messages?.[0]?.content ?? "", /previous rejected draft/i);
      assert.match(request.messages?.[0]?.content ?? "", /you should try it/i);
      assert.match(request.messages?.[0]?.content ?? "", /reply uses direct recommendation/i);
    }
    const content = requestCount === 1
      ? {
          openingComment: "That 79% figure is brutal. Why do so few people step in?",
          reply: "People need better ways to step in. I work on SafeAgain, and you should try it before it is too late.",
        }
      : {
          openingComment: "That 79% figure is brutal. Why do so few people step in?",
          reply: "Actually stepping in is the hard part. I work on SafeAgain, and that number still gets me.",
        };
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const preview = await generateTapInThreadPreview({
      brandName: "SafeAgain",
      openingPrompt: "React to a concrete point and ask a real question.",
      replyPrompt: "Reply naturally and disclose the SafeAgain affiliation.",
      videoTitle: "STAND UP Let's Act Together Against Street Harassment",
      videoDescription: "The research found that 79% of women wish someone had intervened.",
    });

    assert.equal(requestCount, 2);
    assert.match(preview.openingComment, /79%/);
    assert.equal(
      preview.reply,
      "Actually stepping in is the hard part. I work on SafeAgain, and that number still gets me."
    );
    assert.doesNotMatch(`${preview.openingComment} ${preview.reply}`, /practical details around|applying it consistently/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

test("TapIn accepts a concrete title-grounded opening", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  let requestCount = 0;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => {
    requestCount += 1;
    const content = {
      openingComment: "Street harassment is brutal. Why do so few people step in?",
      reply: "Actually stepping in is the hard part. I work on SafeAgain, and that topic still gets me.",
    };
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const preview = await generateTapInThreadPreview({
      brandName: "SafeAgain",
      openingPrompt: "React naturally to one concrete point.",
      replyPrompt: "Reply naturally and disclose the SafeAgain affiliation.",
      videoTitle: "STAND UP Let's Act Together Against Street Harassment",
      videoDescription: "The research found 78% of women were harassed, but only 25% said someone helped them.",
    });

    assert.equal(requestCount, 1);
    assert.match(preview.openingComment, /street harassment/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
});

test("TapIn keeps the last safe prompt-faithful draft when only soft grounding misses", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalConsoleWarn = console.warn;
  let requestCount = 0;
  const warnings: string[] = [];
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              openingComment: "How do people catch the bugs they miss after shipping an app? Testing and QA still feel impossible.",
              reply: "Fresh eyes matter. I work on BeforeUsersDo. AI tests as customer personas, and human testers return recordings and fixes for Claude.",
            }),
          },
        }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));

  try {
    const preview = await generateTapInThreadPreview({
      brandName: "BeforeUsersDo",
      openingPrompt: "Ask how people handle testing and QA after shipping apps with bugs they miss.",
      replyPrompt: "Say fresh eyes matter. Mention BeforeUsersDo. AI tests as customer personas, and human testers return recordings and fixes for Claude.",
      videoTitle: "Codex is INSANE - Everything New in 10 Minutes",
      videoDescription: "A breakdown of GPT capabilities, deployment, computer use, spreadsheets, and presentations.",
    });

    assert.equal(requestCount, 3);
    assert.match(preview.openingComment, /testing and QA/i);
    assert.match(preview.reply, /AI tests as customer personas/i);
    assert.match(preview.reply, /human testers.*recordings.*fixes.*Claude/i);
    assert.doesNotMatch(`${preview.openingComment} ${preview.reply}`, /part that stuck with me|number is hard to ignore/i);
    assert.match(warnings.join("\n"), /safe prompt-faithful draft after soft grounding retries/i);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalConsoleWarn;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  }
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
