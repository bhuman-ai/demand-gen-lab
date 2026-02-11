import { NextResponse } from "next/server";
import {
  getBrandOutreachAssignment,
  getOutreachAccount,
  setBrandOutreachAssignment,
} from "@/lib/outreach-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await context.params;
  const assignment = await getBrandOutreachAssignment(brandId);
  if (!assignment) {
    return NextResponse.json({ assignment: null, account: null, mailboxAccount: null });
  }

  const account = await getOutreachAccount(assignment.accountId);
  const mailboxAccountId = assignment.mailboxAccountId || assignment.accountId;
  const mailboxAccount = mailboxAccountId ? await getOutreachAccount(mailboxAccountId) : null;
  return NextResponse.json({ assignment, account, mailboxAccount });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await context.params;
  const body = asRecord(await request.json());
  const accountId = String(body.accountId ?? "").trim();
  const mailboxAccountIdRaw = body.mailboxAccountId;
  const mailboxAccountId =
    typeof mailboxAccountIdRaw === "string" ? mailboxAccountIdRaw.trim() : undefined;

  if (accountId) {
    const account = await getOutreachAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: "account not found" }, { status: 404 });
    }
  }

  if (typeof mailboxAccountId === "string" && mailboxAccountId) {
    const mailboxAccount = await getOutreachAccount(mailboxAccountId);
    if (!mailboxAccount) {
      return NextResponse.json({ error: "mailbox account not found" }, { status: 404 });
    }
  }

  const assignment = await setBrandOutreachAssignment(
    brandId,
    typeof mailboxAccountId === "string" ? { accountId, mailboxAccountId } : { accountId }
  );
  const account = assignment ? await getOutreachAccount(assignment.accountId) : null;
  const mailboxAccount = assignment
    ? await getOutreachAccount(assignment.mailboxAccountId || assignment.accountId)
    : null;
  return NextResponse.json({ assignment, account, mailboxAccount });
}
