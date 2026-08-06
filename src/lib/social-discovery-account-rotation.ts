type RotationAccount = { id: string };

export type AccountRotationRoles = {
  openingAccountIds: string[];
  replyAccountIds: string[];
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function chooseLeastUsed<T extends RotationAccount>(input: {
  accounts: T[];
  eligibleIds: Set<string>;
  excludedIds?: Set<string>;
  counts: Map<string, number>;
  cap: number;
  seed: string;
}) {
  const available = input.accounts.filter(
    (account) =>
      input.eligibleIds.has(account.id) &&
      !input.excludedIds?.has(account.id) &&
      (input.counts.get(account.id) ?? 0) < input.cap
  );
  if (!available.length) return null;
  const lowestCount = Math.min(...available.map((account) => input.counts.get(account.id) ?? 0));
  return available
    .filter((account) => (input.counts.get(account.id) ?? 0) === lowestCount)
    .sort((left, right) =>
      stableHash(`${input.seed}:${left.id}`) - stableHash(`${input.seed}:${right.id}`)
    )[0] ?? null;
}

export function selectBalancedAccountPair<T extends RotationAccount>(input: {
  postId: string;
  accounts: T[];
  roles: AccountRotationRoles;
  recentAccountCounts: Map<string, number>;
  perAccountHourlyCap: number;
  pinned?: { openingAccountId?: string; replyAccountId?: string };
}) {
  const byId = new Map(input.accounts.map((account) => [account.id, account]));
  const openingIds = new Set(input.roles.openingAccountIds);
  const replyIds = new Set(input.roles.replyAccountIds);
  const pinnedOpeningId = String(input.pinned?.openingAccountId ?? "").trim();
  const pinnedReplyId = String(input.pinned?.replyAccountId ?? "").trim();

  if (pinnedOpeningId || pinnedReplyId) {
    const primary = byId.get(pinnedOpeningId) ?? null;
    const reply = byId.get(pinnedReplyId) ?? null;
    if (
      !primary ||
      !reply ||
      primary.id === reply.id ||
      !openingIds.has(primary.id) ||
      !replyIds.has(reply.id)
    ) {
      return { primary: null, reply: null, reason: "assigned_accounts_unavailable" };
    }
    if (
      (input.recentAccountCounts.get(primary.id) ?? 0) >= input.perAccountHourlyCap ||
      (input.recentAccountCounts.get(reply.id) ?? 0) >= input.perAccountHourlyCap
    ) {
      return { primary: null, reply: null, reason: "assigned_account_cap_reached" };
    }
    return { primary, reply, reason: "" };
  }

  const primary = chooseLeastUsed({
    accounts: input.accounts,
    eligibleIds: openingIds,
    counts: input.recentAccountCounts,
    cap: input.perAccountHourlyCap,
    seed: `${input.postId}:opening`,
  });
  if (!primary) return { primary: null, reply: null, reason: "assigned_account_cap_reached" };

  const reply = chooseLeastUsed({
    accounts: input.accounts,
    eligibleIds: replyIds,
    excludedIds: new Set([primary.id]),
    counts: input.recentAccountCounts,
    cap: input.perAccountHourlyCap,
    seed: `${input.postId}:reply`,
  });
  if (!reply) return { primary: null, reply: null, reason: "assigned_accounts_unavailable" };
  return { primary, reply, reason: "" };
}
