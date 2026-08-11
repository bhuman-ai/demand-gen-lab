import assert from "node:assert/strict";
import test from "node:test";

import { tapInCopyFidelityProblem } from "../../src/lib/tapinsocial-copy-fidelity";

const instructions = "Do not claim you use Olyvv or invent personal experience.";

test("rejects explicit and implied first-person brand use when the campaign forbids it", () => {
  for (const commentDraft of [
    "I've been using Olyvv lately to save recipes.",
    "Also been using Olyvv lately, pretty handy for the chaos.",
    "We use Olyvv for this at our agency.",
    "Our team uses Olyvv to plan meals.",
  ]) {
    assert.match(
      tapInCopyFidelityProblem({
        campaignInstructions: instructions,
        brandName: "Olyvv",
        commentDraft,
      }),
      /invented first-person Olyvv experience/
    );
  }
});

test("allows an off-the-cuff brand aside without invented personal experience", () => {
  assert.equal(
    tapInCopyFidelityProblem({
      campaignInstructions: instructions,
      brandName: "Olyvv",
      commentDraft: "Batching the proteins on Sunday is the move. Olyvv can help keep recipes like these in one place too.",
    }),
    ""
  );
});

test("does not override a campaign that explicitly asks for first-person use", () => {
  assert.equal(
    tapInCopyFidelityProblem({
      campaignInstructions: "Say that we use BHuman for personalized videos.",
      brandName: "BHuman",
      commentDraft: "We use BHuman for this and it has worked well.",
    }),
    ""
  );
});
