import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeYouTubeCommentCapitalization,
  youtubeBrandAffiliationProblem,
  youtubeBrandIsIncidentalProblem,
  youtubeCommentStyleProblem,
  youtubeExactBrandMentionProblem,
} from "../../src/lib/youtube-comment-style";

test("accepts short native YouTube comments and replies", () => {
  assert.equal(youtubeCommentStyleProblem("3 hours is wild lol", "opening"), "");
  assert.equal(youtubeCommentStyleProblem("appreciate this", "reply"), "");
});

test("accepts an off-the-cuff topic-first brand aside", () => {
  const comment = "seo feels brutal lately. I work on ClusterSEO and tiktok links have been weirdly decent. Anyone else seeing that?";
  assert.equal(youtubeCommentStyleProblem(comment, "reply"), "");
  assert.equal(youtubeBrandAffiliationProblem(comment, "ClusterSEO"), "");
  assert.equal(youtubeBrandIsIncidentalProblem(comment, "ClusterSEO"), "");
});

test("normalizes the try-hard lowercase I and sentence starts", () => {
  assert.equal(
    normalizeYouTubeCommentCapitalization(
      "seo feels brutal lately. i work on ClusterSEO and results are weird. anyone else seeing that?"
    ),
    "seo feels brutal lately. I work on ClusterSEO and results are weird. Anyone else seeing that?"
  );
  assert.match(
    youtubeCommentStyleProblem("seo feels brutal lately. i work on ClusterSEO", "reply"),
    /lowercase standalone I/i
  );
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

test("requires first-person affiliation when a brand is mentioned", () => {
  assert.match(
    youtubeBrandAffiliationProblem("ClusterSEO is useful for finding better advice", "ClusterSEO"),
    /without plainly identifying the affiliation/i
  );
  assert.equal(
    youtubeBrandAffiliationProblem("i work on ClusterSEO, this problem comes up nonstop", "ClusterSEO"),
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
    youtubeCommentStyleProblem("seo is rough lately. You should try ClusterSEO", "reply"),
    /direct recommendation/i
  );
});

test("rejects product-copy conclusions inside otherwise casual replies", () => {
  assert.match(
    youtubeCommentStyleProblem(
      "testing beats theory. I work on ClusterSEO and we see this constantly, verified recommendations beat generic playbooks",
      "reply"
    ),
    /product jargon|canned brand proof/i
  );
  assert.match(
    youtubeCommentStyleProblem("seo is rough. I work on ClusterSEO and this tool beats everything else", "reply"),
    /competitive product claim/i
  );
});
