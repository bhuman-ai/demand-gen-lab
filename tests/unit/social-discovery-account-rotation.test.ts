import assert from "node:assert/strict";
import test from "node:test";

import { selectBalancedAccountPair } from "../../src/lib/social-discovery-account-rotation";

const accounts = [{ id: "a" }, { id: "b" }, { id: "c" }];
const roles = {
  openingAccountIds: ["a", "b", "c"],
  replyAccountIds: ["a", "b", "c"],
};

test("balances eligible accounts and never selects a self-reply", () => {
  const counts = new Map([["a", 2], ["b", 0], ["c", 0]]);
  const selected = selectBalancedAccountPair({
    postId: "video-1",
    accounts,
    roles,
    recentAccountCounts: counts,
    perAccountHourlyCap: 5,
  });
  assert.ok(selected.primary);
  assert.ok(selected.reply);
  assert.notEqual(selected.primary.id, selected.reply.id);
  assert.notEqual(selected.primary.id, "a");
});

test("honors role restrictions", () => {
  const selected = selectBalancedAccountPair({
    postId: "video-2",
    accounts,
    roles: { openingAccountIds: ["a"], replyAccountIds: ["b", "c"] },
    recentAccountCounts: new Map(),
    perAccountHourlyCap: 5,
  });
  assert.equal(selected.primary?.id, "a");
  assert.ok(selected.reply?.id === "b" || selected.reply?.id === "c");
});

test("reuses a pinned pair across retries", () => {
  const selected = selectBalancedAccountPair({
    postId: "video-3",
    accounts,
    roles,
    recentAccountCounts: new Map(),
    perAccountHourlyCap: 5,
    pinned: { openingAccountId: "c", replyAccountId: "a" },
  });
  assert.equal(selected.primary?.id, "c");
  assert.equal(selected.reply?.id, "a");
});

test("rejects a pool that can only reply to itself", () => {
  const selected = selectBalancedAccountPair({
    postId: "video-4",
    accounts,
    roles: { openingAccountIds: ["a"], replyAccountIds: ["a"] },
    recentAccountCounts: new Map(),
    perAccountHourlyCap: 5,
  });
  assert.equal(selected.primary, null);
  assert.equal(selected.reply, null);
  assert.equal(selected.reason, "assigned_accounts_unavailable");
});
