import { NextResponse } from "next/server";
import { listBrands, updateBrand } from "@/lib/factory-data";
import type { BrandRecord, DomainRow, OutreachAccount, OutreachAccountConfig } from "@/lib/factory-types";
import { syncBrandGmailUiAssignments } from "@/lib/gmail-ui-brand-sync";
import { normalizeGmailUiLoginStatus } from "@/lib/gmail-ui-login";
import { buildGmailUiUserDataDir } from "@/lib/gmail-ui-profile";
import {
  createOutreachAccount,
  listOutreachAccounts,
  updateOutreachAccount,
} from "@/lib/outreach-data";
import { getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import { sanitizeCustomerIoBillingConfig } from "@/lib/outreach-customerio-billing";
import { getOutreachProvisioningSettingsSecrets } from "@/lib/outreach-provider-settings";
import { kickoffMailpoolAccountDeliverability } from "@/lib/mailpool-deliverability-bootstrap";
import { defaultSocialAccountConfig } from "@/lib/social-account-config";
import { ensureRequiredWebshareProxy, wantsWebshareProxy } from "@/lib/webshare-proxy-assignment";
import {
  parseMailpoolWebhookEvent,
  verifyMailpoolWebhookSignature,
  type MailpoolDomain,
  type MailpoolMailbox,
} from "@/lib/mailpool-client";

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function mailpoolStatusToDnsStatus(status: string): DomainRow["dnsStatus"] {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "active") return "verified";
  if (normalized === "pending") return "configured";
  return "error";
}

function gmailUiProfileDir(fromEmail: string) {
  const root = String(process.env.GMAIL_UI_PROFILE_ROOT ?? "").trim();
  return buildGmailUiUserDataDir(root, fromEmail);
}

function mailboxHasSmtpCredentials(mailbox: MailpoolMailbox) {
  return Boolean(
    String(mailbox.smtpHost ?? "").trim() &&
      String(mailbox.smtpUsername ?? "").trim() &&
      String(mailbox.imapHost ?? "").trim() &&
      String(mailbox.status ?? "").trim().toLowerCase() === "active" &&
      (String(mailbox.smtpPassword ?? "").trim() || String(mailbox.password ?? "").trim())
  );
}

function mailboxConfigFromMailpool(
  mailbox: MailpoolMailbox,
  existingConfig?: OutreachAccountConfig | null
): OutreachAccountConfig {
  const fromEmail = mailbox.email.trim().toLowerCase();
  const wantsGmailUi = wantsWebshareProxy();
  const existingGmailUiStatus = normalizeGmailUiLoginStatus({
    deliveryMethod: "gmail_ui",
    state: existingConfig?.mailbox.gmailUiLoginState,
    checkedAt: existingConfig?.mailbox.gmailUiLoginCheckedAt,
    message: existingConfig?.mailbox.gmailUiLoginMessage,
    forceLoginRequired: !String(existingConfig?.mailbox.gmailUiUserDataDir ?? "").trim(),
  });
  const useSmtpFallback = Boolean(
    mailboxHasSmtpCredentials(mailbox) &&
      (existingConfig?.mailbox.deliveryMethod === "smtp" || existingGmailUiStatus.gmailUiLoginState !== "ready")
  );
  const usesGmailUi = wantsGmailUi && !useSmtpFallback;
  const loginStatus = normalizeGmailUiLoginStatus({
    deliveryMethod: usesGmailUi ? "gmail_ui" : "smtp",
    state: existingConfig?.mailbox.gmailUiLoginState,
    checkedAt: existingConfig?.mailbox.gmailUiLoginCheckedAt,
    message: useSmtpFallback
      ? "Mailpool SMTP is available, so webhook sync kept delivery off Gmail UI."
      : existingConfig?.mailbox.gmailUiLoginMessage,
    forceLoginRequired: usesGmailUi && !String(existingConfig?.mailbox.gmailUiUserDataDir ?? "").trim(),
  });
  return {
    customerIo: {
      siteId: String(existingConfig?.customerIo.siteId ?? "").trim(),
      workspaceId: String(existingConfig?.customerIo.workspaceId ?? "").trim(),
      fromEmail,
      replyToEmail: fromEmail,
      billing: sanitizeCustomerIoBillingConfig(existingConfig?.customerIo.billing ?? {}),
    },
    mailpool: {
      domainId: String(mailbox.domain?.id ?? "").trim(),
      mailboxId: mailbox.id,
      mailboxType: mailbox.type,
      spamCheckId: String(existingConfig?.mailpool.spamCheckId ?? "").trim(),
      inboxPlacementId: "",
      status:
        String(mailbox.status ?? "").trim().toLowerCase() === "active" ? "active" : "pending",
      lastSpamCheckAt: String(existingConfig?.mailpool.lastSpamCheckAt ?? "").trim(),
      lastSpamCheckScore: Number(existingConfig?.mailpool.lastSpamCheckScore ?? 0) || 0,
      lastSpamCheckSummary: String(existingConfig?.mailpool.lastSpamCheckSummary ?? "").trim(),
    },
    apify: {
      defaultActorId: String(existingConfig?.apify.defaultActorId ?? "").trim(),
    },
    social: existingConfig?.social ?? defaultSocialAccountConfig(),
    mailbox: {
      provider: usesGmailUi ? "gmail" : "imap",
      deliveryMethod: usesGmailUi ? "gmail_ui" : "smtp",
      email: fromEmail,
      status: mailbox.imapHost ? "connected" : "disconnected",
      host: String(mailbox.imapHost ?? "").trim(),
      port: Number(mailbox.imapPort ?? 993) || 993,
      secure: Boolean(mailbox.imapTLS ?? true),
      smtpHost: String(mailbox.smtpHost ?? "").trim(),
      smtpPort: Number(mailbox.smtpPort ?? 587) || 587,
      smtpSecure: Boolean(mailbox.smtpTLS ?? false),
      smtpUsername: String(mailbox.smtpUsername ?? "").trim() || fromEmail,
      gmailUiUserDataDir: gmailUiProfileDir(fromEmail),
      gmailUiProfileDirectory: "",
      gmailUiBrowserChannel: "chrome",
      gmailUiLoginState: loginStatus.gmailUiLoginState,
      gmailUiLoginCheckedAt: loginStatus.gmailUiLoginCheckedAt,
      gmailUiLoginMessage: loginStatus.gmailUiLoginMessage,
      proxyUrl: "",
      proxyHost: "",
      proxyPort: 0,
      proxyUsername: "",
      proxyPassword: "",
    },
  };
}

async function reconcileMailbox(mailbox: MailpoolMailbox, deleted = false) {
  const accounts = await listOutreachAccounts();
  const existing =
    accounts.find((account) => account.config.mailpool.mailboxId === mailbox.id) ??
    accounts.find((account) => getOutreachAccountFromEmail(account).trim().toLowerCase() === mailbox.email.trim().toLowerCase()) ??
    null;
  const nextConfig = mailboxConfigFromMailpool(mailbox, existing?.config);
  const usesGmailUi = nextConfig.mailbox.deliveryMethod === "gmail_ui";

  const patch = {
    provider: "mailpool" as const,
    name:
      mailbox.firstName && mailbox.lastName
        ? `${mailbox.firstName} ${mailbox.lastName}`
        : mailbox.email,
    accountType: "hybrid" as const,
    status: deleted ? ("inactive" as const) : ("active" as const),
    config: {
      ...nextConfig,
      mailpool: {
        ...nextConfig.mailpool,
        status: deleted ? "deleted" : nextConfig.mailpool.status,
      },
    },
    credentials: {
      mailboxPassword: usesGmailUi
        ? String(mailbox.password ?? mailbox.imapPassword ?? "").trim()
        : String(mailbox.imapPassword ?? mailbox.password ?? "").trim(),
      mailboxAuthCode: String(mailbox.authCode ?? "").trim(),
      mailboxSmtpPassword: String(mailbox.smtpPassword ?? mailbox.password ?? "").trim(),
      mailboxAdminEmail: String(mailbox.admin?.email ?? "").trim(),
      mailboxAdminPassword: String(mailbox.admin?.password ?? "").trim(),
      mailboxAdminAuthCode: String(mailbox.admin?.authCode ?? "").trim(),
    },
  };

  if (existing) {
    const updated = await updateOutreachAccount(existing.id, patch);
    if (updated) {
      await maybeAssignWebshareProxy(updated);
    }
    return updated;
  }

  if (!deleted) {
    const created = await createOutreachAccount(patch);
    if (created) {
      await maybeAssignWebshareProxy(created);
    }
    return created;
  }

  return null;
}

async function maybeAssignWebshareProxy(account: OutreachAccount) {
  if (!wantsWebshareProxy()) return;
  await ensureRequiredWebshareProxy(account);
}

async function reconcileDomain(domain: MailpoolDomain) {
  const brands = await listBrands();
  for (const brand of brands) {
    let changed = false;
    const nextDomains = brand.domains.map((row) => {
      const matches =
        normalizeDomain(row.domain) === normalizeDomain(domain.domain) ||
        String(row.mailpoolDomainId ?? "").trim() === String(domain.id ?? "").trim();
      if (!matches) return row;
      changed = true;
      return {
        ...row,
        provider: row.provider === "manual" ? "mailpool" : row.provider,
        registrar: row.registrar === "manual" ? "mailpool" : row.registrar,
        dnsStatus: mailpoolStatusToDnsStatus(domain.status),
        mailpoolDomainId: domain.id,
        forwardingTargetUrl: domain.redirectUrl || row.forwardingTargetUrl,
        notes: row.notes || "Reconciled from Mailpool webhook.",
        lastProvisionedAt: new Date().toISOString(),
      } satisfies BrandRecord["domains"][number];
    });
    if (changed) {
      await updateBrand(brand.id, { domains: nextDomains });
    }
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secrets = await getOutreachProvisioningSettingsSecrets();

  if (
    !secrets.mailpoolWebhookSecret.trim() ||
    !verifyMailpoolWebhookSignature({
      rawBody,
      secret: secrets.mailpoolWebhookSecret,
      headers: request.headers,
    })
  ) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = parseMailpoolWebhookEvent(rawBody);
  let deliverabilityKickoffTriggered = false;
  let deliverabilityKickoffErrors: string[] = [];

  if (event.domain && event.type.startsWith("domains.")) {
    await reconcileDomain(event.domain);
    await syncBrandGmailUiAssignments().catch(() => null);
  }
  if (event.mailbox && event.type.startsWith("mailboxes.")) {
    const account = await reconcileMailbox(event.mailbox, event.type === "mailboxes.deleted");
    await syncBrandGmailUiAssignments().catch(() => null);
    if (account && event.type !== "mailboxes.deleted" && secrets.mailpoolApiKey.trim()) {
      const kickoff = await kickoffMailpoolAccountDeliverability({
        account,
        apiKey: secrets.mailpoolApiKey.trim(),
        mailbox: event.mailbox,
      });
      deliverabilityKickoffTriggered = kickoff.triggered;
      deliverabilityKickoffErrors = kickoff.errors;
    }
  }

  return NextResponse.json({
    ok: true,
    deliverabilityKickoffTriggered,
    deliverabilityKickoffErrors,
  });
}
