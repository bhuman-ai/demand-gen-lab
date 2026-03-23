import { NextResponse } from "next/server";
import { listBrands, updateBrand } from "@/lib/factory-data";
import type { BrandRecord, DomainRow, OutreachAccountConfig } from "@/lib/factory-types";
import {
  createOutreachAccount,
  listOutreachAccounts,
  updateOutreachAccount,
} from "@/lib/outreach-data";
import { getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import { sanitizeCustomerIoBillingConfig } from "@/lib/outreach-customerio-billing";
import { getOutreachProvisioningSettingsSecrets } from "@/lib/outreach-provider-settings";
import { kickoffMailpoolAccountDeliverability } from "@/lib/mailpool-deliverability-bootstrap";
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

function mailboxConfigFromMailpool(
  mailbox: MailpoolMailbox,
  existingConfig?: OutreachAccountConfig | null
): OutreachAccountConfig {
  const fromEmail = mailbox.email.trim().toLowerCase();
  return {
    customerIo: {
      siteId: String(existingConfig?.customerIo.siteId ?? "").trim(),
      workspaceId: String(existingConfig?.customerIo.workspaceId ?? "").trim(),
      fromEmail,
      replyToEmail: String(existingConfig?.customerIo.replyToEmail ?? "").trim() || fromEmail,
      billing: sanitizeCustomerIoBillingConfig(existingConfig?.customerIo.billing ?? {}),
    },
    mailpool: {
      domainId: String(mailbox.domain?.id ?? "").trim(),
      mailboxId: mailbox.id,
      mailboxType: mailbox.type,
      spamCheckId: String(existingConfig?.mailpool.spamCheckId ?? "").trim(),
      inboxPlacementId: String(existingConfig?.mailpool.inboxPlacementId ?? "").trim(),
      status:
        String(mailbox.status ?? "").trim().toLowerCase() === "active" ? "active" : "pending",
      lastSpamCheckAt: String(existingConfig?.mailpool.lastSpamCheckAt ?? "").trim(),
      lastSpamCheckScore: Number(existingConfig?.mailpool.lastSpamCheckScore ?? 0) || 0,
      lastSpamCheckSummary: String(existingConfig?.mailpool.lastSpamCheckSummary ?? "").trim(),
    },
    apify: {
      defaultActorId: String(existingConfig?.apify.defaultActorId ?? "").trim(),
    },
    mailbox: {
      provider: "imap",
      email: fromEmail,
      status: mailbox.imapHost ? "connected" : "disconnected",
      host: String(mailbox.imapHost ?? "").trim(),
      port: Number(mailbox.imapPort ?? 993) || 993,
      secure: Boolean(mailbox.imapTLS ?? true),
      smtpHost: String(mailbox.smtpHost ?? "").trim(),
      smtpPort: Number(mailbox.smtpPort ?? 587) || 587,
      smtpSecure: Boolean(mailbox.smtpTLS ?? false),
      smtpUsername: String(mailbox.smtpUsername ?? "").trim() || fromEmail,
    },
  };
}

async function reconcileMailbox(mailbox: MailpoolMailbox, deleted = false) {
  const accounts = await listOutreachAccounts();
  const existing =
    accounts.find((account) => account.config.mailpool.mailboxId === mailbox.id) ??
    accounts.find((account) => getOutreachAccountFromEmail(account).trim().toLowerCase() === mailbox.email.trim().toLowerCase()) ??
    null;

  const patch = {
    provider: "mailpool" as const,
    name:
      mailbox.firstName && mailbox.lastName
        ? `${mailbox.firstName} ${mailbox.lastName}`
        : mailbox.email,
    accountType: "hybrid" as const,
    status: deleted ? ("inactive" as const) : ("active" as const),
    config: {
      ...mailboxConfigFromMailpool(mailbox, existing?.config),
      mailpool: {
        ...mailboxConfigFromMailpool(mailbox, existing?.config).mailpool,
        status: deleted ? "deleted" : mailboxConfigFromMailpool(mailbox, existing?.config).mailpool.status,
      },
    },
    credentials: {
      mailboxPassword: String(mailbox.imapPassword ?? mailbox.password ?? "").trim(),
      mailboxSmtpPassword: String(mailbox.smtpPassword ?? mailbox.password ?? "").trim(),
    },
  };

  if (existing) {
    return updateOutreachAccount(existing.id, patch);
  }

  if (!deleted) {
    return createOutreachAccount(patch);
  }

  return null;
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
  }
  if (event.mailbox && event.type.startsWith("mailboxes.")) {
    const account = await reconcileMailbox(event.mailbox, event.type === "mailboxes.deleted");
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
