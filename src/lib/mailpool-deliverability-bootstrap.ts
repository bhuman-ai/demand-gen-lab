import type { MailpoolInboxPlacementProvider, OutreachAccount } from "@/lib/factory-types";
import { DEFAULT_MAILPOOL_INBOX_PROVIDERS } from "@/lib/outreach-account-helpers";
import { updateOutreachAccount } from "@/lib/outreach-data";
import { getOutreachProvisioningSettings } from "@/lib/outreach-provider-settings";
import {
  createMailpoolInboxPlacement,
  createMailpoolSpamCheck,
  runMailpoolInboxPlacement,
  type MailpoolMailbox,
} from "@/lib/mailpool-client";

export function mailpoolMailboxHasDeliveryCredentials(mailbox: MailpoolMailbox) {
  return Boolean(
    String(mailbox.status ?? "").trim().toLowerCase() === "active" &&
      String(mailbox.smtpHost ?? "").trim() &&
      String(mailbox.imapHost ?? "").trim() &&
      (String(mailbox.smtpPassword ?? mailbox.password ?? "").trim() ||
        String(mailbox.imapPassword ?? mailbox.password ?? "").trim())
  );
}

export async function kickoffMailpoolAccountDeliverability(input: {
  account: OutreachAccount;
  apiKey: string;
  mailbox: MailpoolMailbox;
}) {
  if (!mailpoolMailboxHasDeliveryCredentials(input.mailbox)) {
    return {
      account: input.account,
      triggered: false,
      errors: ["Mailpool mailbox is not active with SMTP and IMAP credentials yet."],
    };
  }

  const settings = await getOutreachProvisioningSettings();
  const providers =
    settings.deliverability.mailpoolInboxProviders.length
      ? settings.deliverability.mailpoolInboxProviders
      : ([...DEFAULT_MAILPOOL_INBOX_PROVIDERS] as MailpoolInboxPlacementProvider[]);

  let spamCheckId = input.account.config.mailpool.spamCheckId.trim();
  let inboxPlacementId = input.account.config.mailpool.inboxPlacementId.trim();
  let lastSpamCheckAt = input.account.config.mailpool.lastSpamCheckAt.trim();
  let lastSpamCheckScore = Number(input.account.config.mailpool.lastSpamCheckScore ?? 0) || 0;
  let lastSpamCheckSummary = input.account.config.mailpool.lastSpamCheckSummary.trim();
  let triggered = false;
  const errors: string[] = [];

  if (!spamCheckId) {
    try {
      const spamCheck = await createMailpoolSpamCheck({
        apiKey: input.apiKey,
        mailboxId: input.mailbox.id,
      });
      spamCheckId = String(spamCheck.id ?? "").trim();
      lastSpamCheckAt = String(spamCheck.createdAt ?? "").trim();
      lastSpamCheckScore = Number(spamCheck.result?.score ?? 0) || 0;
      lastSpamCheckSummary =
        spamCheck.state === "completed"
          ? `Spam score ${lastSpamCheckScore}/100`
          : "Spam check pending";
      triggered = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Failed to create Mailpool spam check.");
    }
  }

  if (!inboxPlacementId) {
    try {
      const placement = await createMailpoolInboxPlacement({
        apiKey: input.apiKey,
        mailboxId: input.mailbox.id,
        providers,
      });
      inboxPlacementId = String(placement.id ?? "").trim();
      triggered = true;
      if (inboxPlacementId) {
        await runMailpoolInboxPlacement(input.apiKey, inboxPlacementId);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Failed to create Mailpool inbox placement.");
    }
  }

  if (!triggered) {
    return {
      account: input.account,
      triggered: false,
      errors,
    };
  }

  const updated =
    (await updateOutreachAccount(input.account.id, {
      config: {
        mailpool: {
          status: "active",
          spamCheckId,
          inboxPlacementId,
          lastSpamCheckAt,
          lastSpamCheckScore,
          lastSpamCheckSummary,
        },
      },
    })) ?? input.account;

  return {
    account: updated,
    triggered: true,
    errors,
  };
}
