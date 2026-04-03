import type { DomainRow, OutreachAccount } from "@/lib/factory-types";
import {
  getOutreachAccountFromEmail,
  getOutreachMailboxDeliveryMethod,
  getOutreachAccountReplyToEmail,
  getOutreachSenderBackingIssue,
  getOutreachGmailUiLoginState,
  getOutreachMailboxEmail,
  supportsGmailUiDelivery,
} from "@/lib/outreach-account-helpers";
import type { SenderCapacitySnapshot } from "@/lib/sender-capacity";

export type SenderReadinessIssueSeverity = "blocking" | "warning";
export type SenderReadinessIssueKind = "setup" | "policy" | "capacity" | "health";
export type SenderReadinessIssueCode =
  | "missing_delivery_account"
  | "inactive_delivery_account"
  | "missing_from_email"
  | "missing_delivery_credentials"
  | "missing_mailbox_account"
  | "inactive_mailbox_account"
  | "missing_mailbox_credentials"
  | "sender_not_backed_by_mailbox"
  | "mailpool_pending"
  | "mailpool_error"
  | "gmail_ui_login_required"
  | "mailbox_disconnected"
  | "mailbox_error"
  | "dns_pending"
  | "dns_error"
  | "sender_paused"
  | "sender_blocked"
  | "domain_limit"
  | "daily_cap_reached"
  | "hourly_cap_reached"
  | "health_watch"
  | "health_risky"
  | "automation_attention";

export type SenderReadinessIssue = {
  code: SenderReadinessIssueCode;
  severity: SenderReadinessIssueSeverity;
  kind: SenderReadinessIssueKind;
  summary: string;
  detail: string;
};

export type SenderReadinessLifecycle = "ready" | "warming" | "setup" | "blocked";

export type SenderReadiness = {
  canSendNow: boolean;
  lifecycle: SenderReadinessLifecycle;
  currentDailyCap: number;
  currentHourlyCap: number;
  maxDailyCap: number;
  dailySent: number;
  hourlySent: number;
  remainingDailyCap: number;
  remainingHourlyCap: number;
  fromEmail: string;
  replyToEmail: string;
  mailboxEmail: string;
  blockingIssues: SenderReadinessIssue[];
  warnings: SenderReadinessIssue[];
  primaryBlockingReason: string;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function pushIssue(
  bucket: SenderReadinessIssue[],
  issue: Omit<SenderReadinessIssue, "detail"> & { detail?: string }
) {
  bucket.push({
    ...issue,
    detail: issue.detail?.trim() || issue.summary,
  });
}

function rowHealthIssues(row: DomainRow | null | undefined) {
  if (!row) return [] as SenderReadinessIssue[];
  const issues: SenderReadinessIssue[] = [];
  const healthStates = [
    ["domain", row.domainHealth, row.domainHealthSummary],
    ["mailbox", row.emailHealth, row.emailHealthSummary],
    ["route", row.ipHealth, row.ipHealthSummary],
    ["message", row.messagingHealth, row.messagingHealthSummary],
  ] as const;
  for (const [label, status, summary] of healthStates) {
    if (status === "risky") {
      pushIssue(issues, {
        code: "health_risky",
        severity: "warning",
        kind: "health",
        summary: `${label} health is risky`,
        detail: summary || `${label} health needs attention.`,
      });
    } else if (status === "watch") {
      pushIssue(issues, {
        code: "health_watch",
        severity: "warning",
        kind: "health",
        summary: `${label} health needs watching`,
        detail: summary || `${label} health should be watched.`,
      });
    }
  }

  if (row.automationStatus === "attention") {
    pushIssue(issues, {
      code: "automation_attention",
      severity: "warning",
      kind: "health",
      summary: "Automation has warnings",
      detail: row.automationSummary || "Automation checks reported something worth reviewing.",
    });
  }

  return issues;
}

function classifyLifecycle(input: {
  blockingIssues: SenderReadinessIssue[];
  currentDailyCap: number;
  maxDailyCap: number;
}) {
  if (!input.blockingIssues.length) {
    if (input.currentDailyCap > 0 && input.currentDailyCap < input.maxDailyCap) {
      return "warming" as const;
    }
    return "ready" as const;
  }

  const hasSetupIssue = input.blockingIssues.some((issue) => issue.kind === "setup");
  const onlyCapacityIssues = input.blockingIssues.every((issue) => issue.kind === "capacity");

  if (hasSetupIssue) return "setup" as const;
  if (onlyCapacityIssues && input.currentDailyCap > 0 && input.currentDailyCap < input.maxDailyCap) {
    return "warming" as const;
  }
  return "blocked" as const;
}

export function evaluateSenderReadiness(input: {
  account?: OutreachAccount | null;
  mailboxAccount?: OutreachAccount | null;
  hasDeliveryCredentials?: boolean;
  hasMailboxCredentials?: boolean;
  row?: DomainRow | null;
  capacity?: SenderCapacitySnapshot | null;
}) {
  const account = input.account ?? null;
  const defaultMailboxAccount = account && getOutreachMailboxEmail(account) ? account : null;
  const mailboxAccount = input.mailboxAccount ?? defaultMailboxAccount;
  const row = input.row ?? null;
  const capacity = input.capacity ?? null;
  const fromEmail = normalizeEmail(getOutreachAccountFromEmail(account));
  const replyToEmail = normalizeEmail(getOutreachAccountReplyToEmail(mailboxAccount ?? account));
  const mailboxEmail = normalizeEmail(getOutreachMailboxEmail(mailboxAccount));
  const currentDailyCap = Math.max(0, Number(capacity?.dailyCap ?? 0) || 0);
  const currentHourlyCap = Math.max(0, Number(capacity?.hourlyCap ?? 0) || 0);
  const maxDailyCap = Math.max(currentDailyCap, Number(capacity?.maxDailyCap ?? currentDailyCap) || currentDailyCap);
  const dailySent = Math.max(0, Number(capacity?.dailySent ?? 0) || 0);
  const hourlySent = Math.max(0, Number(capacity?.hourlySent ?? 0) || 0);
  const remainingDailyCap = Math.max(0, currentDailyCap - dailySent);
  const remainingHourlyCap = Math.max(0, currentHourlyCap - hourlySent);

  const blockingIssues: SenderReadinessIssue[] = [];
  const warnings: SenderReadinessIssue[] = rowHealthIssues(row);

  if (!account) {
    pushIssue(blockingIssues, {
      code: "missing_delivery_account",
      severity: "blocking",
      kind: "setup",
      summary: "No delivery account is assigned",
      detail: "Assign a real sending inbox before this sender can send.",
    });
  } else if (account.status !== "active") {
    pushIssue(blockingIssues, {
      code: "inactive_delivery_account",
      severity: "blocking",
      kind: "policy",
      summary: "Delivery account is inactive",
      detail: "Activate the assigned delivery account before sending.",
    });
  }

  if (!fromEmail) {
    pushIssue(blockingIssues, {
      code: "missing_from_email",
      severity: "blocking",
      kind: "setup",
      summary: "Sender email is missing",
      detail: "A sender must have a real from-email before sending can start.",
    });
  }

  if (account && input.hasDeliveryCredentials === false) {
    pushIssue(blockingIssues, {
      code: "missing_delivery_credentials",
      severity: "blocking",
      kind: "setup",
      summary: "Delivery credentials are missing",
      detail: "Reconnect the delivery account credentials before sending.",
    });
  }

  if (
    account &&
    account.provider === "mailpool" &&
    getOutreachMailboxDeliveryMethod(account) === "gmail_ui" &&
    !supportsGmailUiDelivery(account)
  ) {
    pushIssue(blockingIssues, {
      code: "missing_delivery_credentials",
      severity: "blocking",
      kind: "setup",
      summary: "Gmail UI delivery is not configured",
      detail: "Set a logged-in Gmail UI profile path for this sender before sending.",
    });
  }

  if (account && getOutreachMailboxDeliveryMethod(account) === "gmail_ui") {
    const gmailUiState = getOutreachGmailUiLoginState(mailboxAccount ?? account);
    if (gmailUiState !== "ready") {
      const message =
        (mailboxAccount ?? account).config.mailbox.gmailUiLoginMessage.trim() ||
        "Open this sender on the worker and complete Gmail login before sending.";
      pushIssue(blockingIssues, {
        code: "gmail_ui_login_required",
        severity: "blocking",
        kind: "setup",
        summary:
          gmailUiState === "error"
            ? "Gmail UI session check failed"
            : "Gmail UI login is still required",
        detail: message,
      });
    }
  }

  if (!mailboxAccount) {
    pushIssue(blockingIssues, {
      code: "missing_mailbox_account",
      severity: "blocking",
      kind: "setup",
      summary: "Backing mailbox is missing",
      detail: "Each sender must be backed by a real mailbox inbox.",
    });
  } else if (mailboxAccount.status !== "active") {
    pushIssue(blockingIssues, {
      code: "inactive_mailbox_account",
      severity: "blocking",
      kind: "policy",
      summary: "Backing mailbox is inactive",
      detail: "Activate the backing mailbox before sending.",
    });
  }

  if (mailboxAccount && input.hasMailboxCredentials === false) {
    pushIssue(blockingIssues, {
      code: "missing_mailbox_credentials",
      severity: "blocking",
      kind: "setup",
      summary: "Mailbox credentials are missing",
      detail: "Reconnect the mailbox credentials before sending.",
    });
  }

  const backingIssue = getOutreachSenderBackingIssue(account, mailboxAccount);
  if (backingIssue) {
    pushIssue(blockingIssues, {
      code: "sender_not_backed_by_mailbox",
      severity: "blocking",
      kind: "setup",
      summary: "Sender is not backed by the assigned mailbox",
      detail: backingIssue,
    });
  }

  if (account?.provider === "mailpool") {
    const mailpoolStatus = account.config.mailpool.status;
    if (mailpoolStatus === "pending" || mailpoolStatus === "updating") {
      pushIssue(blockingIssues, {
        code: "mailpool_pending",
        severity: "blocking",
        kind: "setup",
        summary: "Mailpool is still provisioning this sender",
        detail: "Wait for Mailpool to finish provisioning before sending.",
      });
    } else if (mailpoolStatus === "error" || mailpoolStatus === "deleted") {
      pushIssue(blockingIssues, {
        code: "mailpool_error",
        severity: "blocking",
        kind: "policy",
        summary: "Mailpool reported a sender error",
        detail: "Repair or recreate this Mailpool sender before sending.",
      });
    }
  }

  const mailboxStatus = mailboxAccount?.config.mailbox.status ?? account?.config.mailbox.status ?? "";
  if (mailboxStatus === "disconnected") {
    pushIssue(blockingIssues, {
      code: "mailbox_disconnected",
      severity: "blocking",
      kind: "setup",
      summary: "Mailbox is disconnected",
      detail: "Reconnect the mailbox before sending.",
    });
  } else if (mailboxStatus === "error") {
    pushIssue(blockingIssues, {
      code: "mailbox_error",
      severity: "blocking",
      kind: "policy",
      summary: "Mailbox has an error",
      detail: "Fix the mailbox error before sending.",
    });
  }

  if (row?.senderLaunchState === "paused") {
    pushIssue(warnings, {
      code: "sender_paused",
      severity: "warning",
      kind: "policy",
      summary: "Sender is paused",
      detail: row.senderLaunchSummary || "This sender is paused and should be reviewed.",
    });
  } else if (row?.senderLaunchState === "blocked") {
    pushIssue(warnings, {
      code: "sender_blocked",
      severity: "warning",
      kind: "policy",
      summary: "Sender is blocked",
      detail: row.senderLaunchSummary || "This sender is blocked and should be reviewed.",
    });
  }

  if (row?.dnsStatus && row.dnsStatus !== "verified") {
    pushIssue(blockingIssues, {
      code: row.dnsStatus === "error" ? "dns_error" : "dns_pending",
      severity: "blocking",
      kind: row.dnsStatus === "error" ? "policy" : "setup",
      summary: row.dnsStatus === "error" ? "DNS is broken" : "DNS is still verifying",
      detail:
        row.dnsStatus === "error"
          ? "Repair the sender DNS before sending."
          : "This sender cannot send until DNS verification completes.",
    });
  }

  if (capacity?.domainLimitBlocked) {
    pushIssue(blockingIssues, {
      code: "domain_limit",
      severity: "blocking",
      kind: "policy",
      summary: `Domain already has ${capacity.activeSenderLimitPerDomain} active sending inboxes`,
      detail: `Only ${capacity.activeSenderLimitPerDomain} inboxes can send on the same domain at once.`,
    });
  }

  if (currentDailyCap > 0 && remainingDailyCap <= 0) {
    pushIssue(blockingIssues, {
      code: "daily_cap_reached",
      severity: "blocking",
      kind: "capacity",
      summary: "Daily cap reached",
      detail: `This sender already used its ${currentDailyCap}/day allowance.`,
    });
  }

  if (currentHourlyCap > 0 && remainingHourlyCap <= 0) {
    pushIssue(blockingIssues, {
      code: "hourly_cap_reached",
      severity: "blocking",
      kind: "capacity",
      summary: "Hourly cap reached",
      detail: `This sender already used its ${currentHourlyCap}/hour allowance.`,
    });
  }

  const lifecycle = classifyLifecycle({
    blockingIssues,
    currentDailyCap,
    maxDailyCap,
  });

  return {
    canSendNow: blockingIssues.length === 0 && currentDailyCap > 0,
    lifecycle,
    currentDailyCap,
    currentHourlyCap,
    maxDailyCap,
    dailySent,
    hourlySent,
    remainingDailyCap,
    remainingHourlyCap,
    fromEmail,
    replyToEmail,
    mailboxEmail,
    blockingIssues,
    warnings,
    primaryBlockingReason: blockingIssues[0]?.detail || "",
  } satisfies SenderReadiness;
}

export function summarizeSenderReadinessBlock(readiness: SenderReadiness, senderLabel: string) {
  if (!readiness.blockingIssues.length) return "";
  return `${senderLabel}: ${readiness.blockingIssues[0].detail}`;
}
