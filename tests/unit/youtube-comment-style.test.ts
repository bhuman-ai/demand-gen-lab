import assert from "node:assert/strict";
import test from "node:test";

import {
  youtubeBrandAffiliationProblem,
  youtubeCommentStyleProblem,
  youtubeExactBrandMentionProblem,
} from "../../src/lib/youtube-comment-style";

test("accepts short native YouTube comments and replies", () => {
  assert.equal(youtubeCommentStyleProblem("3 hours is wild lol", "opening"), "");
  assert.equal(youtubeCommentStyleProblem("appreciate this", "reply"), "");
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
    youtubeCommentStyleProblem("i work on ClusterSEO and this is exactly why we focus on verified results", "reply"),
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
