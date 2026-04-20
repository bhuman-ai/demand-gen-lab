import { NextResponse } from "next/server";
import { getOutreachAccount, updateOutreachAccount } from "@/lib/outreach-data";
import { resolveUnipileSocialIdentity } from "@/lib/unipile";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function notifySecret() {
  return String(process.env.UNIPILE_NOTIFY_SECRET ?? process.env.AUTH_SESSION_SECRET ?? "").trim();
}

function matchesNotifySecret(request: Request) {
  const secret = notifySecret();
  if (!secret) return true;
  const url = new URL(request.url);
  return url.searchParams.get("token") === secret;
}

function accountIdFromWebhookName(value: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (normalized.startsWith("outreach:")) return normalized.slice("outreach:".length).trim();
  return normalized;
}

export async function POST(request: Request) {
  if (!matchesNotifySecret(request)) {
    return NextResponse.json({ error: "invalid webhook token" }, { status: 401 });
  }

  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const status = String(body.status ?? "").trim().toUpperCase();
    const externalAccountId = String(body.account_id ?? body.accountId ?? "").trim();
    const outreachAccountId = accountIdFromWebhookName(String(body.name ?? ""));

    if (!externalAccountId || !outreachAccountId) {
      return NextResponse.json({ ok: false, ignored: true, reason: "missing account mapping" });
    }

    const outreachAccount = await getOutreachAccount(outreachAccountId);
    if (!outreachAccount) {
      return NextResponse.json({ ok: false, ignored: true, reason: "outreach account not found" });
    }

    const syncedSocial = await resolveUnipileSocialIdentity(externalAccountId);
    const linkedAt = outreachAccount.config.social.linkedAt || new Date().toISOString();
    const updated = await updateOutreachAccount(outreachAccountId, {
      config: {
        social: {
          ...syncedSocial,
          enabled: outreachAccount.config.social.enabled || true,
          connectionProvider: "unipile",
          externalAccountId,
          linkedAt,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      status,
      accountId: outreachAccountId,
      externalAccountId,
      account: updated,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process Unipile account webhook" },
      { status: 500 }
    );
  }
}
