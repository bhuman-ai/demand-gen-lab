import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { getBrandOutreachAssignment } from "@/lib/outreach-data";
import { getReplyThreadDetail } from "@/lib/reply-thread-state";

function assignedMailboxAccountIds(
  assignment: Awaited<ReturnType<typeof getBrandOutreachAssignment>>
) {
  const ids = new Set<string>();
  const primary = String(assignment?.mailboxAccountId ?? assignment?.accountId ?? "").trim();
  if (primary) ids.add(primary);
  for (const accountId of assignment?.accountIds ?? []) {
    const normalized = String(accountId ?? "").trim();
    if (normalized) ids.add(normalized);
  }
  return ids;
}

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; threadId: string }> }
) {
  const { brandId, threadId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const detail = await getReplyThreadDetail(threadId);
  if (!detail || detail.thread.brandId !== brandId) {
    return NextResponse.json({ error: "thread not found" }, { status: 404 });
  }
  const assignment = await getBrandOutreachAssignment(brandId);
  const assignedMailboxIds = assignedMailboxAccountIds(assignment);
  if (
    assignedMailboxIds.size > 0 &&
    detail.thread.mailboxAccountId.trim() &&
    !assignedMailboxIds.has(detail.thread.mailboxAccountId.trim())
  ) {
    return NextResponse.json({ error: "thread not found" }, { status: 404 });
  }

  return NextResponse.json({ detail });
}
