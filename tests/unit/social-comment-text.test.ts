import assert from "node:assert/strict";
import test from "node:test";

import {
  containsLongDash,
  sanitizeSocialCommentText,
} from "../../src/lib/social-comment-text";

test("social comment cleanup removes long dashes from prose and numeric ranges", () => {
  const cleaned = sanitizeSocialCommentText(
    "Go before the crowds—the light is better. Replies arrive in 1–6 hours."
  );

  assert.equal(cleaned, "Go before the crowds, the light is better. Replies arrive in 1 to 6 hours.");
  assert.equal(containsLongDash(cleaned), false);
});

test("social comment cleanup handles HTML dash entities", () => {
  assert.equal(
    sanitizeSocialCommentText("Short and useful&mdash;not polished."),
    "Short and useful, not polished."
  );
});
