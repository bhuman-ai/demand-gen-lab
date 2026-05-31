import { NextResponse } from "next/server";
import {
  registerExistingSenderEmail,
  type RegisterExistingSenderInput,
} from "@/lib/outreach-provisioning";
import { OutreachDataError } from "@/lib/outreach-data";

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
  try {
    const { brandId } = await context.params;
    const body = asRecord(await request.json());
    const result = await registerExistingSenderEmail({
      brandId,
      accountName: String(body.accountName ?? "").trim(),
      email: String(body.email ?? "").trim(),
      assignToBrand: body.assignToBrand !== false,
      mailboxProvider:
        body.mailboxProvider === "gmail" || body.mailboxProvider === "outlook" || body.mailboxProvider === "imap"
          ? body.mailboxProvider
          : undefined,
      imapHost: String(body.imapHost ?? "").trim(),
      imapPort: Number(body.imapPort ?? 993) || 993,
      imapSecure: body.imapSecure !== false,
      imapPassword: String(body.imapPassword ?? "").trim(),
      smtpHost: String(body.smtpHost ?? "").trim(),
      smtpPort: Number(body.smtpPort ?? 587) || 587,
      smtpSecure: body.smtpSecure === true,
      smtpUsername: String(body.smtpUsername ?? "").trim(),
      smtpPassword: String(body.smtpPassword ?? "").trim(),
    } satisfies RegisterExistingSenderInput);

    return NextResponse.json({ result }, { status: 201 });
  } catch (err) {
    if (err instanceof OutreachDataError) {
      return NextResponse.json({ error: err.message, hint: err.hint, debug: err.debug }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Failed to add existing sender";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
