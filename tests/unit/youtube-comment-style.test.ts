import assert from "node:assert/strict";
import test from "node:test";

import {
  YOUTUBE_NATIVE_COMMENT_STYLE_RULES,
  normalizeYouTubeCommentCapitalization,
  youtubeBrandIsIncidentalProblem,
  youtubeCommentStyleProblem,
  youtubeExactBrandMentionProblem,
  youtubeRequestedCapabilityProblem,
  youtubeUnrequestedBrandAffiliationProblem,
} from "../../src/lib/youtube-comment-style";

test("accepts short native YouTube comments and replies", () => {
  assert.equal(youtubeCommentStyleProblem("3 hours is wild lol", "opening"), "");
  assert.equal(youtubeCommentStyleProblem("Appreciate this", "reply"), "");
});

test("accepts an off-the-cuff topic-first brand aside without affiliation", () => {
  const comment = "SEO feels brutal lately. ClusterSEO comes to mind because tiktok links have been weirdly decent. Anyone else seeing that?";
  assert.equal(youtubeCommentStyleProblem(comment, "reply"), "");
  assert.equal(youtubeUnrequestedBrandAffiliationProblem("Mention ClusterSEO.", comment, "ClusterSEO"), "");
  assert.equal(youtubeBrandIsIncidentalProblem(comment, "ClusterSEO"), "");
});

test("shared rules never inject first-person affiliation", () => {
  assert.doesNotMatch(YOUTUBE_NATIVE_COMMENT_STYLE_RULES, /i work on \[brand\]|identify the affiliation|after disclosing/i);
  assert.match(YOUTUBE_NATIVE_COMMENT_STYLE_RULES, /Never add first-person brand affiliation.*unless/i);
});

test("TapIn can preserve concise factual capability context without weakening default limits", () => {
  const reply = "Fresh eyes are usually what changes it. BeforeUsersDo uses AI to test apps as customer personas, and connects you with human testers who return recordings, fixes, and instructions for Codex or Claude.";

  assert.match(youtubeCommentStyleProblem(reply, "reply"), /maximum is 30/i);
  assert.equal(
    youtubeCommentStyleProblem(reply, "reply", {
      allowFactualBrandContext: true,
      maxCharacters: 360,
      maxWords: 48,
    }),
    ""
  );
});

test("TapIn rejects invented experience and missing requested capabilities", () => {
  const options = {
    allowFactualBrandContext: true,
    disallowPersonalExperience: true,
    maxCharacters: 360,
    maxWords: 48,
  };
  assert.match(
    youtubeCommentStyleProblem(
      "Yeah same problem here. Fresh eyes matter. BeforeUsersDo connects you with human testers who send recordings and fixes.",
      "reply",
      options
    ),
    /invents personal or customer experience/i
  );

  const instructions = "Use fresh eyes. AI does QA as a customer persona, and human testers return recordings and fixes for Codex or Claude.";
  assert.match(
    youtubeRequestedCapabilityProblem(
      instructions,
      "Fresh eyes matter. BeforeUsersDo connects you with human testers who send recordings and fixes for Claude."
    ),
    /omits the requested AI customer-persona QA capability/i
  );
  assert.equal(
    youtubeRequestedCapabilityProblem(
      instructions,
      "Fresh eyes matter. BeforeUsersDo uses AI to test as customer personas, and human testers send recordings and fixes for Claude."
    ),
    ""
  );
});

test("normalizes the try-hard lowercase I and sentence starts", () => {
  assert.equal(
    normalizeYouTubeCommentCapitalization(
      "seo feels brutal lately. i work on ClusterSEO and results are weird. anyone else seeing that?"
    ),
    "Seo feels brutal lately. I work on ClusterSEO and results are weird. Anyone else seeing that?"
  );
  assert.match(
    youtubeCommentStyleProblem("seo feels brutal lately. i work on ClusterSEO", "reply"),
    /begins with lowercase text/i
  );
  assert.match(youtubeCommentStyleProblem("\"same here. I keep seeing it", "reply"), /begins with lowercase text/i);
});

test("rejects polished mini-essays and sales bridges", () => {
  assert.match(
    youtubeCommentStyleProblem(
      "Really appreciated the point about testing SEO tactics instead of following the same checklist everywhere.",
      "opening"
    ),
    /formal appreciation opener/i
  );
  assert.match(
    youtubeCommentStyleProblem("Tools like ClusterSEO can help serious marketers understand this better", "reply"),
    /salesy tool bridge/i
  );
  assert.match(
    youtubeCommentStyleProblem("I work on ClusterSEO and this is exactly why we focus on verified results", "reply"),
    /brand-copy rationale/i
  );
});

test("rejects first-person affiliation unless the campaign prompt requests it", () => {
  assert.match(
    youtubeUnrequestedBrandAffiliationProblem(
      "Mention ClusterSEO.",
      "SEO feels rough. I work on ClusterSEO and see this a lot.",
      "ClusterSEO"
    ),
    /campaign prompt did not request/i
  );
  assert.equal(
    youtubeUnrequestedBrandAffiliationProblem(
      "Mention ClusterSEO and disclose that I work on it.",
      "SEO feels rough. I work on ClusterSEO and see this a lot.",
      "ClusterSEO"
    ),
    ""
  );
  assert.equal(
    youtubeUnrequestedBrandAffiliationProblem(
      "Mention ClusterSEO.",
      "SEO feels rough. ClusterSEO comes to mind here.",
      "ClusterSEO"
    ),
    ""
  );
});

test("requires the exact brand name in a brand reply", () => {
  assert.match(
    youtubeExactBrandMentionProblem("i work on clusterseoul", "ClusterSEO"),
    /does not mention ClusterSEO exactly/i
  );
  assert.equal(
    youtubeExactBrandMentionProblem("i work on ClusterSEO, this problem comes up nonstop", "ClusterSEO"),
    ""
  );
});

test("rejects a brand-first recommendation even when affiliation is disclosed", () => {
  assert.match(
    youtubeBrandIsIncidentalProblem("i work on ClusterSEO and seo is rough lately", "ClusterSEO"),
    /before the broader topic/i
  );
  assert.match(
    youtubeCommentStyleProblem("SEO is rough lately. You should try ClusterSEO", "reply"),
    /direct recommendation/i
  );
});

test("rejects product-copy conclusions inside otherwise casual replies", () => {
  assert.match(
    youtubeCommentStyleProblem(
      "Testing beats theory. I work on ClusterSEO and we see this constantly, verified recommendations beat generic playbooks",
      "reply"
    ),
    /product jargon|canned brand proof/i
  );
  assert.match(
    youtubeCommentStyleProblem("SEO is rough. I work on ClusterSEO and this tool beats everything else", "reply"),
    /competitive product claim/i
  );
});
