import { listBrands, updateBrand } from "@/lib/factory-data";
import type { DomainRow, OutreachAccount, OutreachAccountConfig } from "@/lib/factory-types";
import {
  getOutreachAccount,
  getOutreachAccountSecrets,
  listOutreachAccounts,
  updateOutreachAccount,
} from "@/lib/outreach-data";
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

export type MailpoolOutreachAccountSyncTickResult = {
  accountsEligible: number;
  accountsChecked: number;
  accountsSynced: number;
  accountsInactive: number;
  accountsDeleted: number;
  errors: Array<{ accountId: string; fromEmail: string; error: string }>;
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

function mailpoolMailboxErrorMessage(mailbox: MailpoolMailbox) {
  return String(mailbox.error?.message ?? "").trim();
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

function shouldDisableMailpoolAccount(mailbox: MailpoolMailbox) {
  const mailboxStatus = String(mailbox.status ?? "").trim().toLowerCase();
  return (
    Boolean(mailpoolMailboxErrorMessage(mailbox)) ||
    mailboxStatus === "inactive" ||
    mailboxStatus === "deleted"
  );
}

function hasBlockingGmailUiLoginState(config: OutreachAccountConfig) {
  return (
    config.mailbox.deliveryMethod === "gmail_ui" &&
    normalizeGmailUiLoginStatus({
      deliveryMethod: config.mailbox.deliveryMethod,
      state: config.mailbox.gmailUiLoginState,
      checkedAt: config.mailbox.gmailUiLoginCheckedAt,
      message: config.mailbox.gmailUiLoginMessage,
    }).gmailUiLoginState !== "ready"
  );
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

function mailpoolMailboxResourceStatus(mailbox: MailpoolMailbox) {
  const providerError = mailpoolMailboxErrorMessage(mailbox);
  const mailboxStatus = String(mailbox.status ?? "").trim().toLowerCase();
  if (providerError || mailboxStatus === "inactive") return "error" as const;
  if (mailboxStatus === "active") return "active" as const;
  if (mailboxStatus === "deleted") return "deleted" as const;
  if (mailboxStatus === "updating") return "updating" as const;
  return "pending" as const;
}

function buildMailpoolAccountPatch(mailbox: MailpoolMailbox, existingConfig: OutreachAccountConfig) {
  const fromEmail = mailbox.email.trim().toLowerCase();
  const existingUsesGmailUi = existingConfig.mailbox.deliveryMethod === "gmail_ui";
  const gmailUiBlocked = hasBlockingGmailUiLoginState(existingConfig);
  const useSmtpFallback = existingUsesGmailUi && gmailUiBlocked && mailboxHasSmtpCredentials(mailbox);
  const deliveryMethod = useSmtpFallback ? ("smtp" as const) : existingConfig.mailbox.deliveryMethod;
  const usesGmailUi = deliveryMethod === "gmail_ui";
  const providerError = mailpoolMailboxErrorMessage(mailbox);
  const disabled = shouldDisableMailpoolAccount(mailbox) || (usesGmailUi && gmailUiBlocked);
  const loginStatus = normalizeGmailUiLoginStatus({
    deliveryMethod,
    state: existingConfig.mailbox.gmailUiLoginState,
    checkedAt: existingConfig.mailbox.gmailUiLoginCheckedAt,
    message:
      providerError ||
      (useSmtpFallback
        ? "Mailpool SMTP is available, so refresh moved delivery off Gmail UI."
        : existingConfig.mailbox.gmailUiLoginMessage),
  });
  return {
    provider: "mailpool" as const,
    name:
      mailbox.firstName && mailbox.lastName
        ? `${mailbox.firstName} ${mailbox.lastName}`
        : mailbox.email,
    accountType: "hybrid" as const,
    status: disabled ? ("inactive" as const) : ("active" as const),
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
        status: mailpoolMailboxResourceStatus(mailbox),
        spamCheckId: String(existingConfig.mailpool.spamCheckId ?? "").trim(),
        inboxPlacementId: "",
        lastSpamCheckAt: String(existingConfig.mailpool.lastSpamCheckAt ?? "").trim(),
        lastSpamCheckScore: Number(existingConfig.mailpool.lastSpamCheckScore ?? 0) || 0,
        lastSpamCheckSummary: String(existingConfig.mailpool.lastSpamCheckSummary ?? "").trim(),
      },
      mailbox: {
        provider: usesGmailUi ? ("gmail" as const) : ("imap" as const),
        deliveryMethod,
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
        gmailUiLoginMessage:
          providerError ||
          (useSmtpFallback
            ? "Mailpool SMTP is available, so refresh moved delivery off Gmail UI."
            : loginStatus.gmailUiLoginMessage),
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

  let mailbox: MailpoolMailbox | null = null;
  try {
    mailbox = await getMailpoolMailbox(apiKey, mailboxId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mailpool mailbox lookup failed";
    if (!message.includes("HTTP 404")) {
      throw error;
    }
    const updated = await updateOutreachAccount(account.id, {
      status: "inactive",
      config: {
        mailpool: {
          status: "deleted",
        },
        mailbox: {
          status: "disconnected",
          gmailUiLoginState: "error",
          gmailUiLoginMessage: "Mailpool mailbox no longer exists.",
        },
      },
    });
    return updated ?? account;
  }

  const providerError = mailpoolMailboxErrorMessage(mailbox);
  const disabled = shouldDisableMailpoolAccount(mailbox) || hasBlockingGmailUiLoginState(account.config);
  const updated = await updateOutreachAccount(account.id, {
    status: disabled ? ("inactive" as const) : ("active" as const),
    config: {
      mailpool: {
        status: mailpoolMailboxResourceStatus(mailbox),
      },
      mailbox: {
        ...(providerError ? { gmailUiLoginState: "error" as const, gmailUiLoginMessage: providerError } : {}),
      },
    },
    credentials: buildMailpoolMailboxCredentials(mailbox),
  });
  return updated ?? account;
}

function mailpoolAccountSyncPriority(account: OutreachAccount) {
  let priority = 0;
  if (account.status === "active" && account.config.mailpool.status === "deleted") priority += 1000;
  if (account.config.mailpool.status !== "active") priority += 500;
  if (account.config.mailbox.status !== "connected") priority += 150;
  if (account.config.mailbox.deliveryMethod === "gmail_ui" && account.config.mailbox.gmailUiLoginState === "error") {
    priority += 50;
  }
  return priority;
}

function isFinishedDeletedMailpoolAccount(account: OutreachAccount) {
  return account.status === "inactive" && account.config.mailpool.status === "deleted";
}

export async function runMailpoolOutreachAccountSyncTick(
  limit = 8
): Promise<MailpoolOutreachAccountSyncTickResult> {
  const accounts = await listOutreachAccounts();
  const candidates = accounts
    .filter(
      (account) =>
        account.provider === "mailpool" &&
        account.accountType !== "mailbox" &&
        !isFinishedDeletedMailpoolAccount(account) &&
        Boolean(account.config.mailpool.mailboxId.trim())
    )
    .sort((left, right) => {
      const priorityDiff = mailpoolAccountSyncPriority(right) - mailpoolAccountSyncPriority(left);
      if (priorityDiff !== 0) return priorityDiff;
      if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? -1 : 1;
      return left.id.localeCompare(right.id);
    });

  const selected = candidates.slice(0, Math.max(1, Math.min(50, Math.round(Number(limit) || 8))));
  const result: MailpoolOutreachAccountSyncTickResult = {
    accountsEligible: candidates.length,
    accountsChecked: selected.length,
    accountsSynced: 0,
    accountsInactive: 0,
    accountsDeleted: 0,
    errors: [],
  };

  for (const account of selected) {
    try {
      const updated = await syncMailpoolOutreachAccountCredentials(account.id);
      result.accountsSynced += 1;
      if (updated.status !== "active") {
        result.accountsInactive += 1;
      }
      if (updated.config.mailpool.status === "deleted") {
        result.accountsDeleted += 1;
      }
    } catch (error) {
      result.errors.push({
        accountId: account.id,
        fromEmail: getOutreachAccountFromEmail(account),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

export async function resolveMailpoolOutreachAccountAuthCode(accountId: string) {
  const account = await getOutreachAccount(accountId);
  if (!account || account.provider !== "mailpool") {
    return "";
  }

  await syncMailpoolOutreachAccountCredentials(accountId);
  const secrets = await getOutreachAccountSecrets(accountId);
  return String(secrets?.mailboxAuthCode || secrets?.mailboxAdminAuthCode || "").trim();
}
