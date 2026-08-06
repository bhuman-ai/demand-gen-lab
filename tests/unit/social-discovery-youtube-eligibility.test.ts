import assert from "node:assert/strict";
import test from "node:test";

import {
  meetsYouTubeSubscriberMinimum,
  MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS,
  youtubeSubscriberMinimumMessage,
} from "../../src/lib/social-discovery-youtube-eligibility";

test("YouTube subscriber minimum includes channels with exactly 100 subscribers", () => {
  assert.equal(MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS, 100);
  assert.equal(meetsYouTubeSubscriberMinimum(99), false);
  assert.equal(meetsYouTubeSubscriberMinimum(100), true);
  assert.equal(meetsYouTubeSubscriberMinimum("100"), true);
  assert.equal(meetsYouTubeSubscriberMinimum(101), true);
  assert.equal(meetsYouTubeSubscriberMinimum(undefined), false);
  assert.match(youtubeSubscriberMinimumMessage(), /at least 100 subscribers/i);
});
