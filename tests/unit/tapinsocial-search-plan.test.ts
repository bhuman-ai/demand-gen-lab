import assert from "node:assert/strict";
import test from "node:test";

import { selectTapInCampaignQueriesForRun } from "../../src/lib/tapinsocial-search-plan";

test("TapIn live discovery searches the user's campaign targets first", () => {
  const result = selectTapInCampaignQueriesForRun({
    queries: [
      "weeknight dinners",
      "easy recipes",
      "meal planning",
      "high protein recipes",
      "family meals",
    ],
    maxQueries: 4,
    rotationBucketMinutes: 60,
    now: 0,
  });

  assert.deepEqual(result.map((entry) => entry.query), [
    "weeknight dinners",
    "easy recipes",
    "meal planning",
    "high protein recipes",
  ]);
  assert.ok(result.every((entry) => entry.source === "manual"));
});

test("TapIn campaign targets are deduplicated and rotate over time", () => {
  const first = selectTapInCampaignQueriesForRun({
    queries: ["weeknight dinners", "weeknight   dinners", "easy recipes", "meal planning"],
    maxQueries: 2,
    rotationBucketMinutes: 60,
    now: 0,
  });
  const next = selectTapInCampaignQueriesForRun({
    queries: ["weeknight dinners", "weeknight   dinners", "easy recipes", "meal planning"],
    maxQueries: 2,
    rotationBucketMinutes: 60,
    now: 60 * 60 * 1000,
  });

  assert.deepEqual(first.map((entry) => entry.query), ["weeknight dinners", "easy recipes"]);
  assert.deepEqual(next.map((entry) => entry.query), ["easy recipes", "meal planning"]);
});
