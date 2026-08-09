import assert from "node:assert/strict";
import test from "node:test";

import {
  youtubeBrandAffiliationProblem,
  youtubeCommentStyleProblem,
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
