import { NextResponse } from "next/server";
import { listBrands, updateBrand } from "@/lib/factory-data";
import type { DomainRow, OutreachAccountConfig } from "@/lib/factory-types";
import {
  OutreachDataError,
  getOutreachAccount,
  getOutreachAccountLookupDebug,
  updateOutreachAccount,
} from "@/lib/outreach-data";
import { sanitizeCustomerIoBillingConfig } from "@/lib/outreach-customerio-billing";
import { getDomainDeliveryAccountId, getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import { getOutreachProvisioningSettingsSecrets } from "@/lib/outreach-provider-settings";
import { kickoffMailpoolAccountDeliverability } from "@/lib/mailpool-deliverability-bootstrap";
import {
  getMailpoolMailbox,
  listMailpoolDomains,
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

function buildMailpoolAccountPatch(
  mailbox: MailpoolMailbox,
  existingConfig: OutreachAccountConfig
) {
  const fromEmail = mailbox.email.trim().toLowerCase();
  return {
    provider: "mailpool" as const,
    name:
      mailbox.firstName && mailbox.lastName
        ? `${mailbox.firstName} ${mailbox.lastName}`
        : mailbox.email,
    accountType: "hybrid" as const,
    status: mailbox.status === "deleted" ? ("inactive" as const) : ("active" as const),
    config: {
      customerIo: {
        siteId: String(existingConfig.customerIo.siteId ?? "").trim(),
        workspaceId: String(existingConfig.customerIo.workspaceId ?? "").trim(),
        fromEmail,
        replyToEmail: String(existingConfig.customerIo.replyToEmail ?? "").trim() || fromEmail,
        billing: sanitizeCustomerIoBillingConfig(existingConfig.customerIo.billing),
      },
      mailpool: {
        domainId: String(mailbox.domain?.id ?? "").trim(),
        mailboxId: mailbox.id,
        mailboxType: mailbox.type,
        status:
          mailbox.status === "active"
            ? "active"
            : mailbox.status === "deleted"
              ? "deleted"
              : "pending",
        spamCheckId: String(existingConfig.mailpool.spamCheckId ?? "").trim(),
        inboxPlacementId: String(existingConfig.mailpool.inboxPlacementId ?? "").trim(),
        lastSpamCheckAt: String(existingConfig.mailpool.lastSpamCheckAt ?? "").trim(),
        lastSpamCheckScore: Number(existingConfig.mailpool.lastSpamCheckScore ?? 0) || 0,
        lastSpamCheckSummary: String(existingConfig.mailpool.lastSpamCheckSummary ?? "").trim(),
      },
      mailbox: {
        provider: "imap" as const,
        email: fromEmail,
        status: mailbox.imapHost ? ("connected" as const) : ("disconnected" as const),
        host: String(mailbox.imapHost ?? "").trim(),
        port: Number(mailbox.imapPort ?? 993) || 993,
        secure: Boolean(mailbox.imapTLS ?? true),
        smtpHost: String(mailbox.smtpHost ?? "").trim(),
        smtpPort: Number(mailbox.smtpPort ?? 587) || 587,
        smtpSecure: Boolean(mailbox.smtpTLS ?? false),
        smtpUsername: String(mailbox.smtpUsername ?? "").trim() || fromEmail,
      },
    },
    credentials: {
      mailboxPassword: String(mailbox.imapPassword ?? mailbox.password ?? "").trim(),
      mailboxSmtpPassword: String(mailbox.smtpPassword ?? mailbox.password ?? "").trim(),
    },
  };
}

function matchesMailpoolDomain(row: DomainRow, input: {
  accountId: string;
  currentDomain?: MailpoolDomain | null;
  fallbackHost?: string;
}) {
  const currentDomainId = String(input.currentDomain?.id ?? "").trim();
  const currentHost = normalizeDomain(input.currentDomain?.domain ?? input.fallbackHost ?? "");
  return (
    getDomainDeliveryAccountId(row) === input.accountId ||
    (currentDomainId && String(row.mailpoolDomainId ?? "").trim() === currentDomainId) ||
    (currentHost && normalizeDomain(row.domain) === currentHost)
  );
}

async function reconcileBrandDomains(input: {
  accountId: string;
  accountName: string;
  domain: MailpoolDomain | null;
  fallbackHost: string;
}) {
  const brands = await listBrands();
  let updatedCount = 0;

  for (const brand of brands) {
    let changed = false;
    const nextDomains = brand.domains.map((row) => {
      if (!matchesMailpoolDomain(row, { accountId: input.accountId, currentDomain: input.domain, fallbackHost: input.fallbackHost })) {
        return row;
      }
      changed = true;
      updatedCount += 1;
      return {
        ...row,
        dnsStatus: input.domain ? mailpoolStatusToDnsStatus(input.domain.status) : row.dnsStatus,
        forwardingTargetUrl: input.domain?.redirectUrl ?? row.forwardingTargetUrl,
        registrar: "mailpool" as const,
        provider: "mailpool" as const,
        deliveryAccountId: input.accountId,
        deliveryAccountName: input.accountName,
        mailpoolDomainId: String(input.domain?.id ?? row.mailpoolDomainId ?? "").trim(),
      };
    });

    if (changed) {
      await updateBrand(brand.id, { domains: nextDomains });
    }
  }

  return updatedCount;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await context.params;
    const account = await getOutreachAccount(accountId);
    if (!account) {
      const debug = await getOutreachAccountLookupDebug(accountId);
      return NextResponse.json({ error: "account not found", debug }, { status: 404 });
    }
    if (account.provider !== "mailpool") {
      return NextResponse.json({ error: "Only Mailpool accounts can be refreshed here." }, { status: 400 });
    }

    const secrets = await getOutreachProvisioningSettingsSecrets();
    const apiKey = secrets.mailpoolApiKey.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Mailpool API key is not configured." }, { status: 400 });
    }

    const mailboxId = account.config.mailpool.mailboxId.trim();
    if (!mailboxId) {
      return NextResponse.json({ error: "Mailpool mailbox ID is missing on this account." }, { status: 400 });
    }

    let mailbox: MailpoolMailbox | null = null;
    let mailboxDeleted = false;
    try {
      mailbox = await getMailpoolMailbox(apiKey, mailboxId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mailpool mailbox lookup failed";
      if (message.includes("HTTP 404")) {
        mailboxDeleted = true;
      } else {
        throw error;
      }
    }

    const senderEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
    const senderDomain = normalizeDomain(senderEmail.split("@")[1] ?? "");
    const domains = await listMailpoolDomains(apiKey);
    const currentDomain =
      domains.find((domain) => domain.id === account.config.mailpool.domainId.trim()) ??
      domains.find((domain) => domain.domain === senderDomain) ??
      null;

    const refreshedAccount =
      mailboxDeleted
        ? await updateOutreachAccount(account.id, {
            status: "inactive",
            config: {
              mailpool: {
                status: "deleted",
              },
              mailbox: {
                status: "disconnected",
              },
            },
          })
        : await updateOutreachAccount(account.id, buildMailpoolAccountPatch(mailbox!, account.config));

    const latestAccount = refreshedAccount ?? account;
    const deliverabilityKickoff =
      mailboxDeleted || !mailbox
        ? { account: latestAccount, triggered: false, errors: [] as string[] }
        : await kickoffMailpoolAccountDeliverability({
            account: latestAccount,
            apiKey,
            mailbox,
          });
    const updatedDomains = await reconcileBrandDomains({
      accountId: deliverabilityKickoff.account.id,
      accountName: deliverabilityKickoff.account.name,
      domain: currentDomain,
      fallbackHost: senderDomain,
    });

    return NextResponse.json({
      account: deliverabilityKickoff.account,
      domain: currentDomain,
      mailboxDeleted,
      updatedDomains,
      deliverabilityKickoffTriggered: deliverabilityKickoff.triggered,
      deliverabilityKickoffErrors: deliverabilityKickoff.errors,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof OutreachDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Mailpool refresh failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
