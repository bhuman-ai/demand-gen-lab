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
  return (
    account.config.customerIo.replyToEmail.trim() ||
    account.config.mailbox.email.trim() ||
    account.config.customerIo.fromEmail.trim()
  );
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
  return (
    account.provider === "mailpool" &&
    account.accountType !== "mailbox" &&
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
