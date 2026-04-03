import type { DomainRow, OutreachAccount } from "@/lib/factory-types";
import type { OutreachAccountSecrets } from "@/lib/outreach-data";

export const DEFAULT_MAILPOOL_INBOX_PROVIDERS = [
  "GoogleWorkspace",
  "Gmail",
  "Outlook",
  "M365Outlook",
  "Yahoo",
  "Hotmail",
] as const;

export function getOutreachAccountFromEmail(account: Pick<OutreachAccount, "config"> | null | undefined) {
  if (!account) return "";
  return (
    account.config.customerIo.fromEmail.trim() ||
    account.config.mailbox.email.trim()
  );
}

export function getOutreachAccountReplyToEmail(account: Pick<OutreachAccount, "config"> | null | undefined) {
  if (!account) return "";
  const mailboxEmail = account.config.mailbox.email.trim();
  if (mailboxEmail) {
    return mailboxEmail;
  }
  return (
    account.config.customerIo.replyToEmail.trim() ||
    account.config.customerIo.fromEmail.trim()
  );
}

export function getOutreachMailboxEmail(account: Pick<OutreachAccount, "config"> | null | undefined) {
  if (!account) return "";
  return account.config.mailbox.email.trim();
}

export function getOutreachMailboxDeliveryMethod(account: Pick<OutreachAccount, "config"> | null | undefined) {
  if (!account) return "smtp";
  return account.config.mailbox.deliveryMethod;
}

export function supportsGmailUiDelivery(account: Pick<OutreachAccount, "provider" | "accountType" | "config">) {
  return (
    account.provider === "mailpool" &&
    account.accountType !== "mailbox" &&
    account.config.mailbox.deliveryMethod === "gmail_ui" &&
    Boolean(account.config.mailbox.gmailUiUserDataDir.trim()) &&
    Boolean(getOutreachAccountFromEmail(account))
  );
}

export function getOutreachGmailUiLoginState(account: Pick<OutreachAccount, "config"> | null | undefined) {
  if (!account) return "unknown" as const;
  if (account.config.mailbox.deliveryMethod !== "gmail_ui") {
    return "unknown" as const;
  }
  const state = String(account.config.mailbox.gmailUiLoginState ?? "").trim();
  if (state === "ready" || state === "error" || state === "login_required") {
    return state;
  }
  return "login_required" as const;
}

export function isOutreachGmailUiLoginReady(account: Pick<OutreachAccount, "config"> | null | undefined) {
  return getOutreachGmailUiLoginState(account) === "ready";
}

export function getOutreachSenderBackingIssue(
  deliveryAccount: Pick<OutreachAccount, "provider" | "accountType" | "config"> | null | undefined,
  mailboxAccount: Pick<OutreachAccount, "provider" | "accountType" | "config"> | null | undefined
) {
  const fromEmail = getOutreachAccountFromEmail(deliveryAccount).trim().toLowerCase();
  const mailboxEmail = getOutreachMailboxEmail(mailboxAccount).trim().toLowerCase();

  if (!fromEmail) return "From email is missing.";
  if (!mailboxAccount) return "A real mailbox account must be assigned before sending.";
  if (!mailboxEmail) return "Assigned mailbox inbox email is missing.";
  if (fromEmail !== mailboxEmail) {
    return `From email ${fromEmail} is not backed by the assigned mailbox ${mailboxEmail}.`;
  }
  return "";
}

export function isOutreachSenderBackedByMailbox(
  deliveryAccount: Pick<OutreachAccount, "provider" | "accountType" | "config"> | null | undefined,
  mailboxAccount: Pick<OutreachAccount, "provider" | "accountType" | "config"> | null | undefined
) {
  return !getOutreachSenderBackingIssue(deliveryAccount, mailboxAccount);
}

export function supportsCustomerIoDelivery(account: Pick<OutreachAccount, "provider" | "accountType" | "config">) {
  return (
    account.provider === "customerio" &&
    account.accountType !== "mailbox" &&
    Boolean(account.config.customerIo.siteId.trim()) &&
    Boolean(account.config.customerIo.fromEmail.trim())
  );
}

export function supportsMailpoolDelivery(
  account: Pick<OutreachAccount, "provider" | "accountType" | "config">,
  secrets?: Pick<OutreachAccountSecrets, "mailboxPassword" | "mailboxSmtpPassword">
) {
  if (account.provider !== "mailpool" || account.accountType === "mailbox") {
    return false;
  }
  if (account.config.mailbox.deliveryMethod === "gmail_ui") {
    return supportsGmailUiDelivery(account);
  }
  return (
    Boolean(account.config.mailpool.mailboxId.trim()) &&
    Boolean(account.config.mailbox.smtpHost.trim()) &&
    Boolean(account.config.mailbox.smtpUsername.trim()) &&
    Boolean(getOutreachAccountFromEmail(account)) &&
    (!secrets || Boolean(secrets.mailboxSmtpPassword.trim() || secrets.mailboxPassword.trim()))
  );
}

export function supportsSmtpDelivery(
  account: Pick<OutreachAccount, "provider" | "accountType" | "config">,
  secrets?: Pick<OutreachAccountSecrets, "mailboxPassword" | "mailboxSmtpPassword">
) {
  return supportsMailpoolDelivery(account, secrets);
}

export function supportsAnyDelivery(account: Pick<OutreachAccount, "provider" | "accountType" | "config">) {
  return supportsCustomerIoDelivery(account) || supportsMailpoolDelivery(account);
}

export function outreachProviderLabel(provider: Pick<OutreachAccount, "provider"> | OutreachAccount["provider"]) {
  const value = typeof provider === "string" ? provider : provider.provider;
  return value === "mailpool" ? "Mailpool" : "Customer.io";
}

export function getDomainDeliveryAccountId(domainRow: DomainRow) {
  return String(domainRow.deliveryAccountId ?? domainRow.customerIoAccountId ?? "").trim();
}

export function getDomainDeliveryAccountName(domainRow: DomainRow) {
  return String(domainRow.deliveryAccountName ?? domainRow.customerIoAccountName ?? "").trim();
}
