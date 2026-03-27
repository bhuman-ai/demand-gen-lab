import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import {
  getBrandOutreachAssignment,
  listInboxSyncStatesByBrand,
  listOutreachAccounts,
  listReplyThreadsByBrand,
} from "@/lib/outreach-data";
import type { BrandInboxSource, ReplyThread } from "@/lib/factory-types";

function assignedMailboxAccountId(
  assignment: Awaited<ReturnType<typeof getBrandOutreachAssignment>>
) {
  return String(assignment?.mailboxAccountId ?? assignment?.accountId ?? "").trim();
}

function assignedMailboxAccountIds(
  assignment: Awaited<ReturnType<typeof getBrandOutreachAssignment>>
) {
  const ids = new Set<string>();
  const primary = assignedMailboxAccountId(assignment);
  if (primary) ids.add(primary);
  for (const accountId of assignment?.accountIds ?? []) {
    const normalized = String(accountId ?? "").trim();
    if (normalized) ids.add(normalized);
  }
  return ids;
}

function providerValue(value: unknown): BrandInboxSource["provider"] {
  return value === "mailpool" || value === "customerio" ? value : "";
}

function accountTypeValue(value: unknown): BrandInboxSource["accountType"] {
  return value === "delivery" || value === "mailbox" || value === "hybrid" ? value : "";
}

function accountStatusValue(value: unknown): BrandInboxSource["accountStatus"] {
  return value === "active" || value === "inactive" ? value : "unknown";
}

function mailboxStatusValue(value: unknown): BrandInboxSource["mailboxStatus"] {
  return value === "connected" ||
    value === "disconnected" ||
    value === "error" ||
    value === "unknown"
    ? value
    : "unknown";
}

function sourceTypesForMailbox(
  threads: ReplyThread[],
  mailboxAccountId: string
): Array<ReplyThread["sourceType"]> {
  return [...new Set(
    threads
      .filter((thread) => thread.mailboxAccountId === mailboxAccountId)
      .map((thread) => thread.sourceType)
  )];
}

function isVisibleInboxThread(thread: ReplyThread, allowedMailboxIds: Set<string>) {
  const mailboxAccountId = thread.mailboxAccountId.trim();
  return !mailboxAccountId || allowedMailboxIds.size === 0 || allowedMailboxIds.has(mailboxAccountId);
}

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const [{ threads, drafts }, assignment, syncStates, accounts] = await Promise.all([
    listReplyThreadsByBrand(brandId),
    getBrandOutreachAssignment(brandId),
    listInboxSyncStatesByBrand(brandId),
    listOutreachAccounts(),
  ]);
  const currentMailboxAccountId = assignedMailboxAccountId(assignment);
  const allowedMailboxIds = assignedMailboxAccountIds(assignment);
  const visibleThreads = threads.filter((thread) => isVisibleInboxThread(thread, allowedMailboxIds));
  const visibleDraftThreadIds = new Set(visibleThreads.map((thread) => thread.id));
  const visibleDrafts = drafts.filter((draft) => visibleDraftThreadIds.has(draft.threadId));
  const visibleSyncStates = syncStates.filter((state) => {
    const mailboxAccountId = state.mailboxAccountId.trim();
    return !mailboxAccountId || allowedMailboxIds.size === 0 || allowedMailboxIds.has(mailboxAccountId);
  });

  const accountById = new Map(accounts.map((account) => [account.id, account] as const));
  const syncStateByMailboxId = new Map(visibleSyncStates.map((state) => [state.mailboxAccountId, state] as const));
  const threadCountsByMailboxId = new Map<string, number>();

  for (const thread of visibleThreads) {
    const mailboxAccountId = thread.mailboxAccountId.trim();
    if (!mailboxAccountId) continue;
    threadCountsByMailboxId.set(
      mailboxAccountId,
      (threadCountsByMailboxId.get(mailboxAccountId) ?? 0) + 1
    );
  }

  const mailboxIds = new Set<string>();
  for (const thread of visibleThreads) {
    if (thread.mailboxAccountId.trim()) mailboxIds.add(thread.mailboxAccountId.trim());
  }
  for (const state of visibleSyncStates) {
    if (state.mailboxAccountId.trim()) mailboxIds.add(state.mailboxAccountId.trim());
  }
  if (currentMailboxAccountId) {
    mailboxIds.add(currentMailboxAccountId);
  }

  const inboxSources: BrandInboxSource[] = [...mailboxIds]
    .map((mailboxAccountId) => {
      const account = accountById.get(mailboxAccountId);
      const syncState = syncStateByMailboxId.get(mailboxAccountId);
      const email =
        getOutreachAccountFromEmail(account).trim() ||
        account?.config.mailbox.email.trim() ||
        "";

      return {
        mailboxAccountId,
        accountName:
          account?.name.trim() ||
          syncState?.mailboxName.trim() ||
          email ||
          mailboxAccountId,
        email,
        provider: providerValue(account?.provider),
        accountType: accountTypeValue(account?.accountType),
        accountStatus: accountStatusValue(account?.status),
        mailboxStatus: mailboxStatusValue(account?.config.mailbox.status),
        threadCount: threadCountsByMailboxId.get(mailboxAccountId) ?? 0,
        sourceTypes: sourceTypesForMailbox(visibleThreads, mailboxAccountId),
        lastSyncedAt: syncState?.lastSyncedAt ?? "",
        lastError: syncState?.lastError ?? "",
        primary: currentMailboxAccountId === mailboxAccountId,
      };
    })
    .sort((left, right) => {
      if (left.primary !== right.primary) return left.primary ? -1 : 1;
      if (left.threadCount !== right.threadCount) return right.threadCount - left.threadCount;
      if (left.lastSyncedAt !== right.lastSyncedAt) return left.lastSyncedAt < right.lastSyncedAt ? 1 : -1;
      return (left.email || left.accountName).localeCompare(right.email || right.accountName);
    });

  return NextResponse.json({ threads: visibleThreads, drafts: visibleDrafts, inboxSources });
}
