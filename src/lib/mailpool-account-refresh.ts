import { listBrands, updateBrand } from "@/lib/factory-data";
import type { DomainRow, OutreachAccount, OutreachAccountConfig } from "@/lib/factory-types";
import { getOutreachAccount, updateOutreachAccount } from "@/lib/outreach-data";
import { sanitizeCustomerIoBillingConfig } from "@/lib/outreach-customerio-billing";
import { normalizeGmailUiLoginStatus } from "@/lib/gmail-ui-login";
import { getDomainDeliveryAccountId, getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import { getOutreachProvisioningSettingsSecrets } from "@/lib/outreach-provider-settings";
import { kickoffMailpoolAccountDeliverability } from "@/lib/mailpool-deliverability-bootstrap";
import {
  getMailpoolMailbox,
  listMailpoolDomains,
  type MailpoolDomain,
  type MailpoolMailbox,
} from "@/lib/mailpool-client";

export type MailpoolAccountRefreshResult = {
  account: OutreachAccount;
  domain: MailpoolDomain | null;
  mailboxDeleted: boolean;
  updatedDomains: number;
  deliverabilityKickoffTriggered: boolean;
  deliverabilityKickoffErrors: string[];
  refreshedAt: string;
};

function buildMailpoolMailboxCredentials(mailbox: MailpoolMailbox) {
  return {
    mailboxPassword: String(mailbox.imapPassword ?? mailbox.password ?? "").trim(),
    mailboxAuthCode: String(mailbox.authCode ?? "").trim(),
    mailboxSmtpPassword: String(mailbox.smtpPassword ?? mailbox.password ?? "").trim(),
    mailboxAdminEmail: String(mailbox.admin?.email ?? "").trim(),
    mailboxAdminPassword: String(mailbox.admin?.password ?? "").trim(),
    mailboxAdminAuthCode: String(mailbox.admin?.authCode ?? "").trim(),
  };
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function mailpoolStatusToDnsStatus(status: string): DomainRow["dnsStatus"] {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "active") return "verified";
  if (normalized === "pending") return "configured";
  return "error";
}

function buildMailpoolAccountPatch(mailbox: MailpoolMailbox, existingConfig: OutreachAccountConfig) {
  const fromEmail = mailbox.email.trim().toLowerCase();
  const usesGmailUi = existingConfig.mailbox.deliveryMethod === "gmail_ui";
  const loginStatus = normalizeGmailUiLoginStatus({
    deliveryMethod: usesGmailUi ? "gmail_ui" : existingConfig.mailbox.deliveryMethod,
    state: existingConfig.mailbox.gmailUiLoginState,
    checkedAt: existingConfig.mailbox.gmailUiLoginCheckedAt,
    message: existingConfig.mailbox.gmailUiLoginMessage,
  });
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
        replyToEmail: fromEmail,
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
        inboxPlacementId: "",
        lastSpamCheckAt: String(existingConfig.mailpool.lastSpamCheckAt ?? "").trim(),
        lastSpamCheckScore: Number(existingConfig.mailpool.lastSpamCheckScore ?? 0) || 0,
        lastSpamCheckSummary: String(existingConfig.mailpool.lastSpamCheckSummary ?? "").trim(),
      },
      mailbox: {
        provider: usesGmailUi ? ("gmail" as const) : ("imap" as const),
        deliveryMethod: usesGmailUi ? ("gmail_ui" as const) : existingConfig.mailbox.deliveryMethod,
        email: fromEmail,
        status: mailbox.imapHost ? ("connected" as const) : ("disconnected" as const),
        host: String(mailbox.imapHost ?? "").trim(),
        port: Number(mailbox.imapPort ?? 993) || 993,
        secure: Boolean(mailbox.imapTLS ?? true),
        smtpHost: String(mailbox.smtpHost ?? "").trim(),
        smtpPort: Number(mailbox.smtpPort ?? 587) || 587,
        smtpSecure: Boolean(mailbox.smtpTLS ?? false),
        smtpUsername: String(mailbox.smtpUsername ?? "").trim() || fromEmail,
        gmailUiUserDataDir: String(existingConfig.mailbox.gmailUiUserDataDir ?? "").trim(),
        gmailUiProfileDirectory: String(existingConfig.mailbox.gmailUiProfileDirectory ?? "").trim(),
        gmailUiBrowserChannel: String(existingConfig.mailbox.gmailUiBrowserChannel ?? "chrome").trim() || "chrome",
        gmailUiLoginState: loginStatus.gmailUiLoginState,
        gmailUiLoginCheckedAt: loginStatus.gmailUiLoginCheckedAt,
        gmailUiLoginMessage: loginStatus.gmailUiLoginMessage,
        proxyUrl: String(existingConfig.mailbox.proxyUrl ?? "").trim(),
        proxyHost: String(existingConfig.mailbox.proxyHost ?? "").trim(),
        proxyPort: Number(existingConfig.mailbox.proxyPort ?? 0) || 0,
        proxyUsername: String(existingConfig.mailbox.proxyUsername ?? "").trim(),
        proxyPassword: String(existingConfig.mailbox.proxyPassword ?? "").trim(),
      },
    },
    credentials: buildMailpoolMailboxCredentials(mailbox),
  };
}

function matchesMailpoolDomain(
  row: DomainRow,
  input: {
    accountId: string;
    currentDomain?: MailpoolDomain | null;
    fallbackHost?: string;
  }
) {
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
      if (
        !matchesMailpoolDomain(row, {
          accountId: input.accountId,
          currentDomain: input.domain,
          fallbackHost: input.fallbackHost,
        })
      ) {
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

export async function refreshMailpoolOutreachAccount(accountId: string): Promise<MailpoolAccountRefreshResult> {
  const account = await getOutreachAccount(accountId);
  if (!account) {
    throw new Error("Mailpool outreach account not found");
  }
  if (account.provider !== "mailpool") {
    throw new Error("Only Mailpool accounts can be refreshed");
  }

  const secrets = await getOutreachProvisioningSettingsSecrets();
  const apiKey = secrets.mailpoolApiKey.trim();
  if (!apiKey) {
    throw new Error("Mailpool API key is not configured");
  }

  const mailboxId = account.config.mailpool.mailboxId.trim();
  if (!mailboxId) {
    throw new Error("Mailpool mailbox ID is missing on this account");
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
          forceSpamCheck: true,
        });
  const updatedDomains = await reconcileBrandDomains({
    accountId: deliverabilityKickoff.account.id,
    accountName: deliverabilityKickoff.account.name,
    domain: currentDomain,
    fallbackHost: senderDomain,
  });

  return {
    account: deliverabilityKickoff.account,
    domain: currentDomain,
    mailboxDeleted,
    updatedDomains,
    deliverabilityKickoffTriggered: deliverabilityKickoff.triggered,
    deliverabilityKickoffErrors: deliverabilityKickoff.errors,
    refreshedAt: new Date().toISOString(),
  };
}

export async function syncMailpoolOutreachAccountCredentials(accountId: string): Promise<OutreachAccount> {
  const account = await getOutreachAccount(accountId);
  if (!account) {
    throw new Error("Mailpool outreach account not found");
  }
  if (account.provider !== "mailpool") {
    throw new Error("Only Mailpool accounts can sync Mailpool credentials");
  }

  const secrets = await getOutreachProvisioningSettingsSecrets();
  const apiKey = secrets.mailpoolApiKey.trim();
  if (!apiKey) {
    throw new Error("Mailpool API key is not configured");
  }

  const mailboxId = account.config.mailpool.mailboxId.trim();
  if (!mailboxId) {
    throw new Error("Mailpool mailbox ID is missing on this account");
  }

  const mailbox = await getMailpoolMailbox(apiKey, mailboxId);
  const updated = await updateOutreachAccount(account.id, {
    credentials: buildMailpoolMailboxCredentials(mailbox),
  });
  return updated ?? account;
}
