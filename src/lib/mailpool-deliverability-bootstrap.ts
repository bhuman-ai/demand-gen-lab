import type { OutreachAccount } from "@/lib/factory-types";
import { updateOutreachAccount } from "@/lib/outreach-data";
import {
  createMailpoolSpamCheck,
  getMailpoolSpamCheck,
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
  for (let attempt = 0; attempt < 10 && current.state !== "completed"; attempt += 1) {
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
}) {
  if (!mailpoolMailboxHasDeliveryCredentials(input.mailbox)) {
    return {
      account: input.account,
      triggered: false,
      errors: ["Mailpool mailbox is not active with SMTP and IMAP credentials yet."],
    };
  }

  let spamCheckId = input.account.config.mailpool.spamCheckId.trim();
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
  const inboxPlacementId = "";

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
