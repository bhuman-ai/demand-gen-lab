import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
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
  const result = await syncBrandInboxMailbox({
    brandId,
    mailboxAccountId: String(body.mailboxAccountId ?? body.mailbox_account_id ?? "").trim(),
    maxMessages: Number(body.maxMessages ?? body.max_messages ?? 25) || 25,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason, result }, { status: 400 });
  }

  return NextResponse.json({ ok: true, result });
}
