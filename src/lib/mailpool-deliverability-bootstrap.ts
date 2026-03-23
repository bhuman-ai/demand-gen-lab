import type { MailpoolInboxPlacementProvider, OutreachAccount } from "@/lib/factory-types";
import { DEFAULT_MAILPOOL_INBOX_PROVIDERS } from "@/lib/outreach-account-helpers";
import { updateOutreachAccount } from "@/lib/outreach-data";
import { getOutreachProvisioningSettings } from "@/lib/outreach-provider-settings";
import {
  createMailpoolInboxPlacement,
  createMailpoolSpamCheck,
  getMailpoolSpamCheck,
  runMailpoolInboxPlacement,
  type MailpoolMailbox,
  type MailpoolSpamCheck,
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMailpoolNotFoundError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\bhttp 404\b/i.test(message);
}

async function waitForMailpoolSpamCheck(apiKey: string, spamCheckId: string) {
  let current = await getMailpoolSpamCheck(apiKey, spamCheckId);
  for (let attempt = 0; attempt < 4 && current.state !== "completed"; attempt += 1) {
    await sleep(1500);
    current = await getMailpoolSpamCheck(apiKey, spamCheckId);
  }
  return current;
}

function summarizeMailpoolSpamCheck(spamCheck: MailpoolSpamCheck) {
  if (spamCheck.state !== "completed") {
    return "Spam check pending";
  }
  const score = Number(spamCheck.result?.score ?? 0) || 0;
  return `Spam score ${score}/100`;
}

export async function kickoffMailpoolAccountDeliverability(input: {
  account: OutreachAccount;
  apiKey: string;
  mailbox: MailpoolMailbox;
  forceSpamCheck?: boolean;
  forceInboxPlacement?: boolean;
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

  let resolvedSpamCheck: MailpoolSpamCheck | null = null;
  let shouldCreateSpamCheck = Boolean(input.forceSpamCheck) || !spamCheckId;

  if (!shouldCreateSpamCheck && spamCheckId) {
    try {
      resolvedSpamCheck = await waitForMailpoolSpamCheck(input.apiKey, spamCheckId);
    } catch (error) {
      if (isMailpoolNotFoundError(error)) {
        spamCheckId = "";
        shouldCreateSpamCheck = true;
      } else {
        errors.push(error instanceof Error ? error.message : "Failed to refresh Mailpool spam check.");
      }
    }
  }

  if (shouldCreateSpamCheck) {
    try {
      resolvedSpamCheck = await createMailpoolSpamCheck({
        apiKey: input.apiKey,
        mailboxId: input.mailbox.id,
      });
      spamCheckId = String(resolvedSpamCheck.id ?? "").trim();
      triggered = true;
      if (spamCheckId && resolvedSpamCheck.state !== "completed") {
        resolvedSpamCheck = await waitForMailpoolSpamCheck(input.apiKey, spamCheckId);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Failed to create Mailpool spam check.");
    }
  }

  if (resolvedSpamCheck) {
    lastSpamCheckAt = String(resolvedSpamCheck.createdAt ?? "").trim();
    lastSpamCheckScore = Number(resolvedSpamCheck.result?.score ?? 0) || 0;
    lastSpamCheckSummary = summarizeMailpoolSpamCheck(resolvedSpamCheck);
  } else if (!spamCheckId) {
    lastSpamCheckAt = "";
    lastSpamCheckScore = 0;
    lastSpamCheckSummary = "";
  }

  const shouldCreateInboxPlacement = !inboxPlacementId;
  const shouldRunInboxPlacement = Boolean(input.forceInboxPlacement) || shouldCreateInboxPlacement;

  if (shouldCreateInboxPlacement) {
    try {
      const placement = await createMailpoolInboxPlacement({
        apiKey: input.apiKey,
        mailboxId: input.mailbox.id,
        providers,
      });
      inboxPlacementId = String(placement.id ?? "").trim();
      triggered = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Failed to create Mailpool inbox placement.");
    }
  }

  if (inboxPlacementId && shouldRunInboxPlacement) {
    try {
      await runMailpoolInboxPlacement(input.apiKey, inboxPlacementId);
      triggered = true;
    } catch (error) {
      if (isMailpoolNotFoundError(error)) {
        inboxPlacementId = "";
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
        } catch (innerError) {
          errors.push(
            innerError instanceof Error ? innerError.message : "Failed to recreate Mailpool inbox placement."
          );
        }
      } else {
        errors.push(error instanceof Error ? error.message : "Failed to run Mailpool inbox placement.");
      }
    }
  }

  const configChanged =
    spamCheckId !== input.account.config.mailpool.spamCheckId.trim() ||
    inboxPlacementId !== input.account.config.mailpool.inboxPlacementId.trim() ||
    lastSpamCheckAt !== input.account.config.mailpool.lastSpamCheckAt.trim() ||
    lastSpamCheckScore !== (Number(input.account.config.mailpool.lastSpamCheckScore ?? 0) || 0) ||
    lastSpamCheckSummary !== input.account.config.mailpool.lastSpamCheckSummary.trim() ||
    input.account.config.mailpool.status !== "active";

  if (!triggered && !configChanged) {
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
    triggered: triggered || configChanged,
    errors,
  };
}
