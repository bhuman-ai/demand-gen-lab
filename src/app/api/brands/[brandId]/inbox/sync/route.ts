import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { getBrandOutreachAssignment } from "@/lib/outreach-data";
import { syncBrandInboxMailbox } from "@/lib/outreach-runtime";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const requestedMailboxAccountId = String(body.mailboxAccountId ?? body.mailbox_account_id ?? "").trim();
  const maxMessages = Number(body.maxMessages ?? body.max_messages ?? 25) || 25;
  if (requestedMailboxAccountId) {
    const result = await syncBrandInboxMailbox({
      brandId,
      mailboxAccountId: requestedMailboxAccountId,
      maxMessages,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.reason, result }, { status: 400 });
    }

    return NextResponse.json({ ok: true, result });
  }

  const assignment = await getBrandOutreachAssignment(brandId);
  const mailboxIds = new Set<string>();
  const primaryMailboxId = String(assignment?.mailboxAccountId ?? assignment?.accountId ?? "").trim();
  if (primaryMailboxId) mailboxIds.add(primaryMailboxId);
  for (const accountId of assignment?.accountIds ?? []) {
    const normalized = String(accountId ?? "").trim();
    if (normalized) mailboxIds.add(normalized);
  }
  if (mailboxIds.size === 0) {
    return NextResponse.json({ error: "No mailbox accounts assigned to this brand." }, { status: 400 });
  }

  const results = [];
  for (const mailboxAccountId of mailboxIds) {
    results.push(
      await syncBrandInboxMailbox({
        brandId,
        mailboxAccountId,
        maxMessages,
      })
    );
  }
  const failures = results.filter((result) => !result.ok);
  if (failures.length === results.length) {
    return NextResponse.json({ error: failures[0]?.reason ?? "Inbox sync failed.", results }, { status: 400 });
  }

  return NextResponse.json({ ok: true, results });
}
