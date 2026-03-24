import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { ingestBrandInboxMessage } from "@/lib/outreach-runtime";

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

  const body = asRecord(await request.json());
  const from = String(body.from ?? "").trim();
  const to = String(body.to ?? "").trim();
  const subject = String(body.subject ?? "").trim();
  const messageBody = String(body.body ?? "").trim();
  if (!from || !to || !subject || !messageBody) {
    return NextResponse.json(
      { error: "from, to, subject, and body are required" },
      { status: 400 }
    );
  }

  const result = await ingestBrandInboxMessage({
    brandId,
    mailboxAccountId: String(body.mailboxAccountId ?? body.mailbox_account_id ?? "").trim(),
    threadId: String(body.threadId ?? body.thread_id ?? "").trim(),
    from,
    to,
    subject,
    body: messageBody,
    providerMessageId: String(body.messageId ?? body.message_id ?? body.providerMessageId ?? "").trim(),
    contactName: String(body.contactName ?? body.contact_name ?? "").trim(),
    contactCompany: String(body.contactCompany ?? body.contact_company ?? "").trim(),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ ok: true, result });
}
