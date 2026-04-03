import { NextResponse } from "next/server";
import { refreshMailpoolOutreachAccount } from "@/lib/mailpool-account-refresh";
import {
  OutreachDataError,
  getOutreachAccount,
  getOutreachAccountSecrets,
} from "@/lib/outreach-data";

export async function GET(
  request: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await context.params;
    const url = new URL(request.url);
    const shouldRefresh = url.searchParams.get("refresh") !== "0";

    let account = await getOutreachAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: "account not found" }, { status: 404 });
    }

    const mailboxConfig = (account.config.mailbox ?? {}) as Record<string, unknown>;
    const deliveryMethod = String(mailboxConfig.deliveryMethod ?? mailboxConfig.delivery_method ?? "").trim();
    if (deliveryMethod && deliveryMethod !== "gmail_ui") {
      return NextResponse.json({ error: "Only Gmail UI senders expose verification credentials." }, { status: 400 });
    }

    if (shouldRefresh && account.provider === "mailpool") {
      const result = await refreshMailpoolOutreachAccount(accountId);
      account = result.account;
    }

    const secrets = await getOutreachAccountSecrets(accountId);
    if (!secrets) {
      return NextResponse.json({ error: "account credentials missing" }, { status: 400 });
    }
    const secretsRecord = secrets as Record<string, unknown>;

    return NextResponse.json({
      account,
      refreshedAt: new Date().toISOString(),
      credentials: {
        mailboxEmail: account.config.mailbox.email.trim() || account.config.customerIo.fromEmail.trim(),
        mailboxPassword: secrets.mailboxPassword.trim(),
        mailboxAuthCode: String(secretsRecord.mailboxAuthCode ?? "").trim(),
        mailboxSmtpPassword: String(secretsRecord.mailboxSmtpPassword ?? "").trim(),
        mailboxAdminEmail: String(secretsRecord.mailboxAdminEmail ?? "").trim(),
        mailboxAdminPassword: String(secretsRecord.mailboxAdminPassword ?? "").trim(),
        mailboxAdminAuthCode: String(secretsRecord.mailboxAdminAuthCode ?? "").trim(),
      },
    });
  } catch (err) {
    if (err instanceof OutreachDataError) {
      return NextResponse.json({ error: err.message, hint: err.hint, debug: err.debug }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Failed to load Gmail UI credentials";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
