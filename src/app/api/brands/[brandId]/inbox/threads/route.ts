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

  const accountById = new Map(accounts.map((account) => [account.id, account] as const));
  const syncStateByMailboxId = new Map(syncStates.map((state) => [state.mailboxAccountId, state] as const));
  const threadCountsByMailboxId = new Map<string, number>();

  for (const thread of threads) {
    const mailboxAccountId = thread.mailboxAccountId.trim();
    if (!mailboxAccountId) continue;
    threadCountsByMailboxId.set(
      mailboxAccountId,
      (threadCountsByMailboxId.get(mailboxAccountId) ?? 0) + 1
    );
  }

  const mailboxIds = new Set<string>();
  for (const thread of threads) {
    if (thread.mailboxAccountId.trim()) mailboxIds.add(thread.mailboxAccountId.trim());
  }
  for (const state of syncStates) {
    if (state.mailboxAccountId.trim()) mailboxIds.add(state.mailboxAccountId.trim());
  }
  if (assignment?.mailboxAccountId.trim()) {
    mailboxIds.add(assignment.mailboxAccountId.trim());
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
        sourceTypes: sourceTypesForMailbox(threads, mailboxAccountId),
        lastSyncedAt: syncState?.lastSyncedAt ?? "",
        lastError: syncState?.lastError ?? "",
        primary: assignment?.mailboxAccountId.trim() === mailboxAccountId,
      };
    })
    .sort((left, right) => {
      if (left.primary !== right.primary) return left.primary ? -1 : 1;
      if (left.threadCount !== right.threadCount) return right.threadCount - left.threadCount;
      if (left.lastSyncedAt !== right.lastSyncedAt) return left.lastSyncedAt < right.lastSyncedAt ? 1 : -1;
      return (left.email || left.accountName).localeCompare(right.email || right.accountName);
    });

  return NextResponse.json({ threads, drafts, inboxSources });
}
