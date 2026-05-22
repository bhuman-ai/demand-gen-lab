import { createId, getBrandById, listBrands } from "@/lib/factory-data";
import type {
  BrandOutreachAssignment,
  BrandRecord,
  CanonicalSender,
  CanonicalSenderAccountAlias,
  CanonicalSenderAccountAliasType,
  CanonicalSenderState,
  DomainRow,
  OutreachAccount,
  SenderLaunch,
} from "@/lib/factory-types";
import {
  getDomainDeliveryAccountId,
  getOutreachAccountFromEmail,
  getOutreachAccountReplyToEmail,
  getOutreachGmailUiLoginState,
  getOutreachMailboxEmail,
  getOutreachSenderBackingIssue,
} from "@/lib/outreach-account-helpers";
import {
  getBrandOutreachAssignment,
  getOutreachAccount,
  listOutreachAccounts,
  listSenderLaunches,
} from "@/lib/outreach-data";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const TABLE_SENDER = "demanddev_senders";
const TABLE_SENDER_ALIAS = "demanddev_sender_account_aliases";

const nowIso = () => new Date().toISOString();

type CanonicalSenderBundle = {
  sender: CanonicalSender;
  aliases: CanonicalSenderAccountAlias[];
};

export type CanonicalSenderPool = {
  senders: CanonicalSender[];
  aliasesBySenderId: Map<string, CanonicalSenderAccountAlias[]>;
  senderByAccountId: Map<string, CanonicalSender>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeEmail(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeDomain(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function senderDomainFromEmail(value: string) {
  return normalizeEmail(value).split("@")[1] ?? "";
}

function latestTimestamp(...values: Array<string | undefined | null>) {
  return (
    values
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .sort((left, right) => (left < right ? 1 : -1))[0] ?? ""
  );
}

function normalizeSenderState(value: unknown): CanonicalSenderState {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "blocked") return "blocked";
  if (normalized === "warming") return "warming";
  if (normalized === "ready") return "ready";
  if (normalized === "restricted") return "restricted";
  if (normalized === "retired") return "retired";
  return "provisioning";
}

function normalizeAliasType(value: unknown): CanonicalSenderAccountAliasType {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "current_delivery") return "current_delivery";
  if (normalized === "current_mailbox") return "current_mailbox";
  return "legacy";
}

function mapCanonicalSenderRow(input: unknown): CanonicalSender {
  const row = asRecord(input);
  return {
    id: String(row.id ?? "").trim(),
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    fromEmail: normalizeEmail(String(row.from_email ?? row.fromEmail ?? "")),
    replyToEmail: normalizeEmail(String(row.reply_to_email ?? row.replyToEmail ?? "")),
    domain: normalizeDomain(String(row.domain ?? "")),
    deliveryAccountId: String(row.delivery_account_id ?? row.deliveryAccountId ?? "").trim(),
    mailboxAccountId: String(row.mailbox_account_id ?? row.mailboxAccountId ?? "").trim(),
    state: normalizeSenderState(row.state),
    readinessScore: Math.max(0, Math.min(100, Number(row.readiness_score ?? row.readinessScore ?? 0) || 0)),
    dailyCap: Math.max(0, Math.round(Number(row.daily_cap ?? row.dailyCap ?? 0) || 0)),
    hourlyCap: Math.max(0, Math.round(Number(row.hourly_cap ?? row.hourlyCap ?? 0) || 0)),
    blockedReason: String(row.blocked_reason ?? row.blockedReason ?? "").trim(),
    lastTestStatus:
      String(row.last_test_status ?? row.lastTestStatus ?? "unknown").trim() === "fail"
        ? "fail"
        : String(row.last_test_status ?? row.lastTestStatus ?? "unknown").trim() === "pass"
          ? "pass"
          : "unknown",
    lastSendAt: String(row.last_send_at ?? row.lastSendAt ?? "").trim(),
    lastReplyAt: String(row.last_reply_at ?? row.lastReplyAt ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? "").trim() || nowIso(),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? "").trim() || nowIso(),
  };
}

function mapCanonicalSenderAliasRow(input: unknown): CanonicalSenderAccountAlias {
  const row = asRecord(input);
  return {
    id: String(row.id ?? "").trim(),
    senderId: String(row.sender_id ?? row.senderId ?? "").trim(),
    accountId: String(row.account_id ?? row.accountId ?? "").trim(),
    aliasType: normalizeAliasType(row.alias_type ?? row.aliasType),
    active: row.active !== false,
    createdAt: String(row.created_at ?? row.createdAt ?? "").trim() || nowIso(),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? "").trim() || nowIso(),
  };
}

function isMissingRelationError(error: unknown, relationName: string) {
  const row = asRecord(error);
  const code = String(row.code ?? "").trim();
  const message = String(row.message ?? row.details ?? "").trim();
  return (
    code === "42P01" &&
    (!relationName || message.toLowerCase().includes(relationName.toLowerCase()))
  );
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function accountMatchesSenderEmail(account: OutreachAccount | null | undefined, senderEmail: string) {
  if (!account) return false;
  const fromEmail = normalizeEmail(getOutreachAccountFromEmail(account));
  const mailboxEmail = normalizeEmail(getOutreachMailboxEmail(account));
  return fromEmail === senderEmail || mailboxEmail === senderEmail;
}

function pickBestDomainRow(rows: DomainRow[], senderEmail: string, deliveryAccountId: string) {
  const normalizedSenderEmail = normalizeEmail(senderEmail);
  const normalizedDeliveryAccountId = deliveryAccountId.trim();
  const exactAccountMatch =
    rows.find((row) => getDomainDeliveryAccountId(row) === normalizedDeliveryAccountId) ?? null;
  if (exactAccountMatch) return exactAccountMatch;

  const exactEmailMatch =
    rows.find((row) => normalizeEmail(String(row.fromEmail ?? "")) === normalizedSenderEmail) ?? null;
  if (exactEmailMatch) return exactEmailMatch;

  return rows[0] ?? null;
}

function accountRank(account: OutreachAccount | null | undefined) {
  if (!account) return -1;
  let score = 0;
  if (account.status === "active") score += 100;
  if (account.lastTestStatus === "pass") score += 10;
  if (account.lastTestStatus === "fail") score -= 10;
  if (account.config.mailbox.status === "connected") score += 4;
  if (getOutreachGmailUiLoginState(account) === "ready") score += 2;
  return score;
}

function pickBestDeliveryAccount(accounts: OutreachAccount[]) {
  return [...accounts].sort((left, right) => {
    const rankDiff = accountRank(right) - accountRank(left);
    if (rankDiff !== 0) return rankDiff;
    if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1;
    return left.id.localeCompare(right.id);
  })[0] ?? null;
}

function pickBestMailboxAccount(accounts: OutreachAccount[], senderEmail: string) {
  const normalizedSenderEmail = normalizeEmail(senderEmail);
  return [...accounts].sort((left, right) => {
    const leftExact = normalizeEmail(getOutreachMailboxEmail(left)) === normalizedSenderEmail ? 1 : 0;
    const rightExact = normalizeEmail(getOutreachMailboxEmail(right)) === normalizedSenderEmail ? 1 : 0;
    if (leftExact !== rightExact) return rightExact - leftExact;
    const rankDiff = accountRank(right) - accountRank(left);
    if (rankDiff !== 0) return rankDiff;
    if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1;
    return left.id.localeCompare(right.id);
  })[0] ?? null;
}

function deriveCanonicalSenderState(input: {
  deliveryAccount: OutreachAccount | null;
  mailboxAccount: OutreachAccount | null;
  row: DomainRow | null;
  launch: SenderLaunch | null;
}) {
  const launch = input.launch;
  const deliveryAccount = input.deliveryAccount;
  const mailboxAccount = input.mailboxAccount;
  const row = input.row;
  const senderBackingIssue = getOutreachSenderBackingIssue(deliveryAccount, mailboxAccount);
  const loginState = getOutreachGmailUiLoginState(mailboxAccount ?? deliveryAccount);

  if (!deliveryAccount) {
    return {
      state: "provisioning" as const,
      blockedReason: "Delivery account is missing.",
    };
  }

  if (deliveryAccount.config.mailpool.status === "pending" || deliveryAccount.config.mailpool.status === "updating") {
    return {
      state: "provisioning" as const,
      blockedReason: "Mailpool is still provisioning this sender.",
    };
  }

  if (deliveryAccount.status !== "active") {
    return {
      state: "retired" as const,
      blockedReason: "Delivery account is inactive.",
    };
  }

  if (deliveryAccount.config.mailpool.status === "deleted") {
    return {
      state: "retired" as const,
      blockedReason: "Mailpool deleted this sender.",
    };
  }

  if (senderBackingIssue) {
    return {
      state: "blocked" as const,
      blockedReason: senderBackingIssue,
    };
  }

  if (loginState === "login_required" || loginState === "error") {
    return {
      state: "blocked" as const,
      blockedReason:
        (mailboxAccount ?? deliveryAccount)?.config.mailbox.gmailUiLoginMessage.trim() ||
        "Gmail UI login is required before sending.",
    };
  }

  if (row?.dnsStatus === "pending" || row?.dnsStatus === "configured") {
    return {
      state: "provisioning" as const,
      blockedReason: "DNS verification is still in progress.",
    };
  }

  if (row?.dnsStatus === "error") {
    return {
      state: "blocked" as const,
      blockedReason: row.automationSummary || "Sender DNS is broken.",
    };
  }

  if (deliveryAccount.lastTestStatus === "fail") {
    return {
      state: "restricted" as const,
      blockedReason: "Latest sender test failed.",
    };
  }

  if (launch?.state === "blocked") {
    return {
      state: "restricted" as const,
      blockedReason: launch.summary || launch.pauseReason || "Sender launch is blocked.",
    };
  }

  if (launch?.state === "paused" || launch?.state === "restricted_send") {
    return {
      state: "restricted" as const,
      blockedReason: launch.summary || launch.pauseReason || "Sender launch is restricted.",
    };
  }

  if (launch?.state === "warming" || row?.automationStatus === "warming") {
    return {
      state: "warming" as const,
      blockedReason: "",
    };
  }

  if (row?.automationStatus === "testing" || row?.automationStatus === "queued") {
    return {
      state: "warming" as const,
      blockedReason: "",
    };
  }

  return {
    state: "ready" as const,
    blockedReason: "",
  };
}

function buildAlias(
  senderId: string,
  accountId: string,
  aliasType: CanonicalSenderAccountAliasType,
  active: boolean
): CanonicalSenderAccountAlias {
  return {
    id: createId("sender_alias"),
    senderId,
    accountId: accountId.trim(),
    aliasType,
    active,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function buildCanonicalSenderFromLegacy(input: {
  brandId: string;
  senderEmail: string;
  accounts: OutreachAccount[];
  rows: DomainRow[];
  launch: SenderLaunch | null;
  mailboxAccountId?: string;
}) {
  const senderEmail = normalizeEmail(input.senderEmail);
  if (!senderEmail) return null;

  const matchingAccounts = input.accounts.filter((account) => accountMatchesSenderEmail(account, senderEmail));
  const deliveryAccounts = matchingAccounts.filter(
    (account) => normalizeEmail(getOutreachAccountFromEmail(account)) === senderEmail
  );
  const deliveryAccount = pickBestDeliveryAccount(deliveryAccounts.length ? deliveryAccounts : matchingAccounts);
  const mailboxAccountId = String(input.mailboxAccountId ?? "").trim();
  const mailboxCandidates = [
    ...(mailboxAccountId ? input.accounts.filter((account) => account.id === mailboxAccountId) : []),
    ...matchingAccounts,
    ...(deliveryAccount ? [deliveryAccount] : []),
  ];
  const mailboxAccount = pickBestMailboxAccount(
    uniqueStrings(mailboxCandidates.map((account) => account.id))
      .map((accountId) => mailboxCandidates.find((account) => account.id === accountId) ?? null)
      .filter((account): account is OutreachAccount => Boolean(account)),
    senderEmail
  );
  const row = pickBestDomainRow(input.rows, senderEmail, deliveryAccount?.id ?? "");
  const derivedState = deriveCanonicalSenderState({
    deliveryAccount,
    mailboxAccount,
    row,
    launch: input.launch,
  });
  const state = derivedState.state;
  const readinessScore =
    input.launch?.readinessScore ??
    (state === "ready" ? 90 : state === "warming" ? 60 : state === "restricted" ? 35 : 10);
  const dailyCap = Math.max(0, Number(input.launch?.dailyCap ?? row?.senderLaunchDailyCap ?? 0) || 0);
  const hourlyCap = dailyCap > 0 ? Math.max(1, Math.ceil(dailyCap / 8)) : 0;
  const senderId = createId("sender");
  const sender: CanonicalSender = {
    id: senderId,
    brandId: input.brandId.trim(),
    fromEmail: senderEmail,
    replyToEmail: normalizeEmail(
      getOutreachAccountReplyToEmail(mailboxAccount ?? deliveryAccount) || row?.replyMailboxEmail || senderEmail
    ),
    domain: normalizeDomain(row?.domain || senderDomainFromEmail(senderEmail)),
    deliveryAccountId: deliveryAccount?.id ?? "",
    mailboxAccountId: mailboxAccount?.id ?? "",
    state,
    readinessScore: Math.max(0, Math.min(100, Math.round(readinessScore))),
    dailyCap,
    hourlyCap,
    blockedReason: derivedState.blockedReason,
    lastTestStatus: deliveryAccount?.lastTestStatus ?? "unknown",
    lastSendAt: "",
    lastReplyAt: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const aliases: CanonicalSenderAccountAlias[] = [];
  if (deliveryAccount?.id) {
    aliases.push(buildAlias(sender.id, deliveryAccount.id, "current_delivery", true));
  }
  if (mailboxAccount?.id && mailboxAccount.id !== deliveryAccount?.id) {
    aliases.push(buildAlias(sender.id, mailboxAccount.id, "current_mailbox", true));
  }
  for (const account of matchingAccounts) {
    if (account.id === deliveryAccount?.id || account.id === mailboxAccount?.id) continue;
    aliases.push(buildAlias(sender.id, account.id, "legacy", true));
  }

  return {
    sender,
    aliases,
  } satisfies CanonicalSenderBundle;
}

async function deriveLegacyCanonicalSenderBundlesForBrand(input: {
  brandId: string;
  brand?: BrandRecord | null;
  assignment?: BrandOutreachAssignment | null;
  accounts?: OutreachAccount[];
  launches?: SenderLaunch[];
}) {
  const brand =
    input.brand === undefined ? await getBrandById(input.brandId, { includeEmbedded: true }) : input.brand;
  if (!brand) return [] as CanonicalSenderBundle[];

  const assignment =
    input.assignment === undefined ? await getBrandOutreachAssignment(input.brandId) : input.assignment;
  const accounts = input.accounts ?? (await listOutreachAccounts());
  const launches =
    input.launches ??
    (await listSenderLaunches({ brandId: input.brandId }, { allowMissingTable: true }));
  const senderRows = brand.domains.filter((row) => row.role !== "brand");
  const emailCandidates = new Set<string>();

  for (const row of senderRows) {
    const senderEmail = normalizeEmail(String(row.fromEmail ?? ""));
    if (senderEmail) emailCandidates.add(senderEmail);
  }

  for (const accountId of assignment?.accountIds ?? []) {
    const account = accounts.find((entry) => entry.id === accountId) ?? null;
    const senderEmail = normalizeEmail(getOutreachAccountFromEmail(account));
    if (senderEmail) emailCandidates.add(senderEmail);
  }

  if (assignment?.accountId) {
    const account = accounts.find((entry) => entry.id === assignment.accountId) ?? null;
    const senderEmail = normalizeEmail(getOutreachAccountFromEmail(account));
    if (senderEmail) emailCandidates.add(senderEmail);
  }

  for (const launch of launches) {
    const senderEmail = normalizeEmail(launch.fromEmail);
    if (senderEmail) emailCandidates.add(senderEmail);
  }

  const bundles: CanonicalSenderBundle[] = [];
  for (const senderEmail of emailCandidates) {
    const matchingRows = senderRows.filter((row) => normalizeEmail(String(row.fromEmail ?? "")) === senderEmail);
    const launch =
      launches.find(
        (entry) =>
          normalizeEmail(entry.fromEmail) === senderEmail ||
          (entry.senderAccountId &&
            accounts.some(
              (account) =>
                account.id === entry.senderAccountId &&
                normalizeEmail(getOutreachAccountFromEmail(account)) === senderEmail
            ))
      ) ?? null;
    const mailboxAccountId =
      assignment?.mailboxAccountId &&
      accounts.some(
        (account) =>
          account.id === assignment.mailboxAccountId &&
          normalizeEmail(getOutreachMailboxEmail(account)) === senderEmail
      )
        ? assignment.mailboxAccountId
        : "";
    const bundle = buildCanonicalSenderFromLegacy({
      brandId: input.brandId,
      senderEmail,
      accounts,
      rows: matchingRows,
      launch,
      mailboxAccountId,
    });
    if (bundle) {
      bundles.push(bundle);
    }
  }

  return bundles.sort((left, right) => left.sender.fromEmail.localeCompare(right.sender.fromEmail));
}

function buildPool(senders: CanonicalSender[], aliases: CanonicalSenderAccountAlias[]): CanonicalSenderPool {
  const aliasesBySenderId = new Map<string, CanonicalSenderAccountAlias[]>();
  const senderByAccountId = new Map<string, CanonicalSender>();

  for (const alias of aliases) {
    const bucket = aliasesBySenderId.get(alias.senderId) ?? [];
    bucket.push(alias);
    aliasesBySenderId.set(alias.senderId, bucket);
  }

  for (const sender of senders) {
    if (sender.deliveryAccountId) {
      senderByAccountId.set(sender.deliveryAccountId, sender);
    }
    if (sender.mailboxAccountId) {
      senderByAccountId.set(sender.mailboxAccountId, sender);
    }
    for (const alias of aliasesBySenderId.get(sender.id) ?? []) {
      if (alias.active && alias.accountId) {
        senderByAccountId.set(alias.accountId, sender);
      }
    }
  }

  return {
    senders,
    aliasesBySenderId,
    senderByAccountId,
  };
}

async function loadPersistedCanonicalSendersForBrand(brandId: string, strict = false) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from(TABLE_SENDER)
    .select("*")
    .eq("brand_id", brandId)
    .order("updated_at", { ascending: false });
  if (error) {
    if (strict && !isMissingRelationError(error, TABLE_SENDER)) {
      throw error;
    }
    return null;
  }

  return (data ?? []).map((row: unknown) => mapCanonicalSenderRow(row));
}

async function loadPersistedCanonicalAliases(senderIds: string[], strict = false) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !senderIds.length) return null;

  const { data, error } = await supabase
    .from(TABLE_SENDER_ALIAS)
    .select("*")
    .in("sender_id", senderIds)
    .order("updated_at", { ascending: false });
  if (error) {
    if (strict && !isMissingRelationError(error, TABLE_SENDER_ALIAS)) {
      throw error;
    }
    return null;
  }

  return (data ?? []).map((row: unknown) => mapCanonicalSenderAliasRow(row));
}

async function persistCanonicalSenderBundle(bundle: CanonicalSenderBundle, strict = false) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return bundle.sender;
  }

  const senderPayload = {
    id: bundle.sender.id,
    brand_id: bundle.sender.brandId,
    from_email: bundle.sender.fromEmail,
    reply_to_email: bundle.sender.replyToEmail,
    domain: bundle.sender.domain,
    delivery_account_id: bundle.sender.deliveryAccountId || null,
    mailbox_account_id: bundle.sender.mailboxAccountId || null,
    state: bundle.sender.state,
    readiness_score: bundle.sender.readinessScore,
    daily_cap: bundle.sender.dailyCap,
    hourly_cap: bundle.sender.hourlyCap,
    blocked_reason: bundle.sender.blockedReason,
    last_test_status: bundle.sender.lastTestStatus,
    last_send_at: bundle.sender.lastSendAt || null,
    last_reply_at: bundle.sender.lastReplyAt || null,
    created_at: bundle.sender.createdAt,
    updated_at: bundle.sender.updatedAt,
  } satisfies Record<string, unknown>;

  const senderResult = await supabase
    .from(TABLE_SENDER)
    .upsert(senderPayload, { onConflict: "brand_id,from_email" })
    .select("*")
    .single();
  if (senderResult.error) {
    if (strict && !isMissingRelationError(senderResult.error, TABLE_SENDER)) {
      throw senderResult.error;
    }
    return bundle.sender;
  }

  const persistedSender = mapCanonicalSenderRow(senderResult.data);
  const desiredAliases = bundle.aliases
    .map((alias) => ({
      ...alias,
      senderId: persistedSender.id,
    }))
    .filter((alias) => alias.accountId);

  const existingAliases = await loadPersistedCanonicalAliases([persistedSender.id], false);
  const existingByAccountId = new Map(
    (existingAliases ?? [])
      .filter((alias) => alias.senderId === persistedSender.id)
      .map((alias) => [alias.accountId, alias] as const)
  );

  for (const alias of desiredAliases) {
    const existing = existingByAccountId.get(alias.accountId);
    const payload = {
      id: existing?.id ?? alias.id,
      sender_id: persistedSender.id,
      account_id: alias.accountId,
      alias_type: alias.aliasType,
      active: true,
      created_at: existing?.createdAt ?? alias.createdAt,
      updated_at: nowIso(),
    } satisfies Record<string, unknown>;
    const result = await supabase
      .from(TABLE_SENDER_ALIAS)
      .upsert(payload, { onConflict: "sender_id,account_id" })
      .select("id")
      .single();
    if (result.error && strict && !isMissingRelationError(result.error, TABLE_SENDER_ALIAS)) {
      throw result.error;
    }
  }

  for (const existing of existingByAccountId.values()) {
    if (desiredAliases.some((alias) => alias.accountId === existing.accountId)) continue;
    const result = await supabase
      .from(TABLE_SENDER_ALIAS)
      .update({
        active: false,
        updated_at: nowIso(),
      })
      .eq("id", existing.id)
      .select("id")
      .single();
    if (result.error && strict && !isMissingRelationError(result.error, TABLE_SENDER_ALIAS)) {
      throw result.error;
    }
  }

  return persistedSender;
}

function accountIdsForAssignment(assignment: BrandOutreachAssignment | null | undefined) {
  return uniqueStrings([
    assignment?.accountId ?? "",
    ...(assignment?.accountIds ?? []),
    assignment?.mailboxAccountId ?? "",
  ]);
}

function accountIdsForBundle(bundle: CanonicalSenderBundle) {
  return uniqueStrings([
    bundle.sender.deliveryAccountId,
    bundle.sender.mailboxAccountId,
    ...bundle.aliases.map((alias) => alias.accountId),
  ]);
}

async function reloadPersistedSenderPool(brandId: string, strict: boolean) {
  const senders = await loadPersistedCanonicalSendersForBrand(brandId, strict);
  if (!senders || senders.length <= 0) return null;
  const aliases = await loadPersistedCanonicalAliases(
    senders.map((sender) => sender.id),
    strict
  );
  return buildPool(senders, aliases ?? []);
}

async function repairPersistedPoolForCurrentAssignment(input: {
  brandId: string;
  pool: CanonicalSenderPool;
  strict: boolean;
}) {
  const assignment = await getBrandOutreachAssignment(input.brandId);
  const missingAssignedAccountIds = accountIdsForAssignment(assignment).filter(
    (accountId) => !input.pool.senderByAccountId.has(accountId)
  );
  if (!missingAssignedAccountIds.length) return null;

  const missingAssignedAccountIdSet = new Set(missingAssignedAccountIds);
  const bundles = await deriveLegacyCanonicalSenderBundlesForBrand({
    brandId: input.brandId,
    assignment,
  });
  const repairBundles = bundles.filter((bundle) =>
    accountIdsForBundle(bundle).some((accountId) => missingAssignedAccountIdSet.has(accountId))
  );
  if (!repairBundles.length) return null;

  for (const bundle of repairBundles) {
    await persistCanonicalSenderBundle(bundle, input.strict);
  }

  const repairedPool = await reloadPersistedSenderPool(input.brandId, input.strict);
  if (repairedPool) return repairedPool;

  const sendersByEmail = new Map(input.pool.senders.map((sender) => [sender.fromEmail, sender] as const));
  for (const bundle of repairBundles) {
    sendersByEmail.set(bundle.sender.fromEmail, bundle.sender);
  }
  return buildPool(
    [...sendersByEmail.values()],
    [...input.pool.aliasesBySenderId.values()].flat().concat(repairBundles.flatMap((bundle) => bundle.aliases))
  );
}

export async function getCanonicalSenderPoolForBrand(
  brandId: string,
  options: { strict?: boolean } = {}
): Promise<CanonicalSenderPool> {
  const normalizedBrandId = brandId.trim();
  if (!normalizedBrandId) {
    return buildPool([], []);
  }

  const strict = options.strict === true;
  const persistedSenders = await loadPersistedCanonicalSendersForBrand(normalizedBrandId, strict);
  if (persistedSenders && persistedSenders.length > 0) {
    const aliases = await loadPersistedCanonicalAliases(
      persistedSenders.map((sender) => sender.id),
      strict
    );
    const pool = buildPool(persistedSenders, aliases ?? []);
    return (
      (await repairPersistedPoolForCurrentAssignment({
        brandId: normalizedBrandId,
        pool,
        strict,
      })) ?? pool
    );
  }

  const bundles = await deriveLegacyCanonicalSenderBundlesForBrand({
    brandId: normalizedBrandId,
  });
  return buildPool(
    bundles.map((bundle) => bundle.sender),
    bundles.flatMap((bundle) => bundle.aliases)
  );
}

export async function listCanonicalSendersForBrand(
  brandId: string,
  options: { strict?: boolean } = {}
) {
  return (await getCanonicalSenderPoolForBrand(brandId, options)).senders;
}

export async function getCanonicalSenderByEmail(
  brandId: string,
  fromEmail: string,
  options: { strict?: boolean } = {}
) {
  const normalizedEmail = normalizeEmail(fromEmail);
  if (!normalizedEmail) return null;
  return (
    (await listCanonicalSendersForBrand(brandId, options)).find(
      (sender) => sender.fromEmail === normalizedEmail
    ) ?? null
  );
}

export async function syncCanonicalSenderFromProvisionedAccount(input: {
  brandId: string;
  accountId: string;
  mailboxAccountId?: string;
  brand?: BrandRecord | null;
  assignment?: BrandOutreachAssignment | null;
  strict?: boolean;
}) {
  const normalizedAccountId = input.accountId.trim();
  if (!normalizedAccountId) return null;

  const [account, brand, assignment, accounts, launches] = await Promise.all([
    getOutreachAccount(normalizedAccountId),
    input.brand === undefined ? getBrandById(input.brandId, { includeEmbedded: true }) : input.brand,
    input.assignment === undefined ? getBrandOutreachAssignment(input.brandId) : input.assignment,
    listOutreachAccounts(),
    listSenderLaunches({ brandId: input.brandId }, { allowMissingTable: true }),
  ]);
  if (!account) return null;

  const bundles = await deriveLegacyCanonicalSenderBundlesForBrand({
    brandId: input.brandId,
    brand,
    assignment:
      input.mailboxAccountId && assignment
        ? {
            ...assignment,
            mailboxAccountId: input.mailboxAccountId,
          }
        : assignment,
    accounts,
    launches,
  });
  const senderEmail = normalizeEmail(getOutreachAccountFromEmail(account));
  let targetBundle =
    bundles.find((bundle) => bundle.sender.fromEmail === senderEmail) ?? null;

  if (!targetBundle) {
    const fallbackBundle = buildCanonicalSenderFromLegacy({
      brandId: input.brandId,
      senderEmail,
      accounts,
      rows: brand?.domains.filter((row) => row.role !== "brand") ?? [],
      launch:
        launches.find(
          (launch) =>
            normalizeEmail(launch.fromEmail) === senderEmail ||
            launch.senderAccountId === normalizedAccountId
        ) ?? null,
      mailboxAccountId: input.mailboxAccountId,
    });
    targetBundle = fallbackBundle;
  }

  if (!targetBundle) return null;
  return persistCanonicalSenderBundle(targetBundle, input.strict === true);
}

export async function backfillCanonicalSenders(input: {
  brandId?: string;
  strict?: boolean;
} = {}) {
  const strict = input.strict === true;
  const brands = input.brandId
    ? [await getBrandById(input.brandId, { includeEmbedded: true })].filter(
        (brand): brand is BrandRecord => Boolean(brand)
      )
    : await listBrands();
  const accounts = await listOutreachAccounts();
  const launches = await listSenderLaunches({}, { allowMissingTable: true });

  let senderCount = 0;
  let brandCount = 0;

  for (const brand of brands) {
    const assignment = await getBrandOutreachAssignment(brand.id);
    const bundles = await deriveLegacyCanonicalSenderBundlesForBrand({
      brandId: brand.id,
      brand,
      assignment,
      accounts,
      launches: launches.filter((launch) => launch.brandId === brand.id),
    });
    if (!bundles.length) continue;
    brandCount += 1;
    for (const bundle of bundles) {
      await persistCanonicalSenderBundle(bundle, strict);
      senderCount += 1;
    }
  }

  return {
    brandCount,
    senderCount,
  };
}
