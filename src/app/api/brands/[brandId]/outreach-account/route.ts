import { NextResponse } from "next/server";
import {
  OutreachDataError,
  getBrandOutreachAssignment,
  getOutreachAccount,
  setBrandOutreachAssignment,
} from "@/lib/outreach-data";
import { getOutreachSenderBackingIssue, supportsCustomerIoDelivery } from "@/lib/outreach-account-helpers";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeAccountIds(value: unknown, fallbackAccountId = "") {
  const ids = new Set(
    (Array.isArray(value) ? value : [])
      .map((entry) => String(entry ?? "").trim())
      .filter((entry) => entry.length > 0)
  );
  const primary = fallbackAccountId.trim();
  if (primary) ids.add(primary);
  return Array.from(ids);
}

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  try {
    const { brandId } = await context.params;
    const assignment = await getBrandOutreachAssignment(brandId);
    if (!assignment) {
      return NextResponse.json({ assignment: null, account: null, mailboxAccount: null });
    }

    const account = await getOutreachAccount(assignment.accountId);
    const mailboxAccountId = assignment.mailboxAccountId || assignment.accountId;
    const mailboxAccount = mailboxAccountId ? await getOutreachAccount(mailboxAccountId) : null;
    return NextResponse.json({ assignment, account, mailboxAccount });
  } catch (err) {
    if (err instanceof OutreachDataError) {
      return NextResponse.json({ error: err.message, hint: err.hint, debug: err.debug }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Failed to load outreach assignment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  try {
    const { brandId } = await context.params;
    const body = asRecord(await request.json());
    const requestedAccountId = String(body.accountId ?? "").trim();
    const accountIds = normalizeAccountIds(body.accountIds, requestedAccountId);
    const accountId = requestedAccountId || accountIds[0] || "";
    const mailboxAccountIdRaw = body.mailboxAccountId;
    const mailboxAccountId =
      typeof mailboxAccountIdRaw === "string" ? mailboxAccountIdRaw.trim() : undefined;
    const accountsById = new Map<string, Awaited<ReturnType<typeof getOutreachAccount>>>();

    for (const selectedAccountId of accountIds) {
      const account = await getOutreachAccount(selectedAccountId);
      if (!account) {
        return NextResponse.json({ error: `account not found: ${selectedAccountId}` }, { status: 404 });
      }
      accountsById.set(selectedAccountId, account);
    }

    const explicitMailboxAccount =
      typeof mailboxAccountId === "string" && mailboxAccountId
        ? await getOutreachAccount(mailboxAccountId)
        : null;
    if (typeof mailboxAccountId === "string" && mailboxAccountId) {
      if (!explicitMailboxAccount) {
        return NextResponse.json({ error: "mailbox account not found" }, { status: 404 });
      }
    }

    for (const selectedAccountId of accountIds) {
      const deliveryAccount = accountsById.get(selectedAccountId) ?? null;
      if (!deliveryAccount) continue;
      if (!supportsCustomerIoDelivery(deliveryAccount)) continue;
      const effectiveMailboxAccount =
        explicitMailboxAccount ??
        (deliveryAccount.accountType !== "delivery" ? deliveryAccount : null);
      const issue = getOutreachSenderBackingIssue(deliveryAccount, effectiveMailboxAccount);
      if (issue) {
        return NextResponse.json(
          {
            error: issue,
            hint:
              "Customer.io senders must use a real connected mailbox with the exact same email address as the From address.",
          },
          { status: 400 }
        );
      }
    }

    const assignment = await setBrandOutreachAssignment(
      brandId,
      typeof mailboxAccountId === "string"
        ? { accountId, accountIds, mailboxAccountId }
        : { accountId, accountIds }
    );
    const account = assignment ? await getOutreachAccount(assignment.accountId) : null;
    const mailboxAccount = assignment
      ? await getOutreachAccount(assignment.mailboxAccountId || assignment.accountId)
      : null;
    return NextResponse.json({ assignment, account, mailboxAccount });
  } catch (err) {
    if (err instanceof OutreachDataError) {
      return NextResponse.json({ error: err.message, hint: err.hint, debug: err.debug }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Failed to save outreach assignment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
