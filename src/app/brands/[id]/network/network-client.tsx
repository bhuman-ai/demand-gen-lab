"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SenderProvisionCard from "@/app/settings/outreach/sender-provision-card";
import { SettingsModal, formatRelativeTimeLabel } from "@/app/settings/outreach/settings-primitives";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  advanceOutreachGmailUiSession,
  fetchBrand,
  fetchBrandOutreachAssignment,
  fetchBrands,
  fetchOutreachAccounts,
  fetchOutreachProvisioningSettings,
  getOutreachGmailUiSession,
  provisionSenderDomain,
  refreshMailpoolOutreachAccount,
  testOutreachAccount,
  closeOutreachGmailUiSession,
} from "@/lib/client-api";
import {
  buildSenderRoutingSignalFromDomainRow,
  rankSenderRoutingSignals,
  summarizeSenderRoutingScore,
  type SenderRoutingSignals,
} from "@/lib/sender-routing";
import {
  getDomainDeliveryAccountId,
  getDomainDeliveryAccountName,
  getOutreachAccountFromEmail,
  getOutreachAccountReplyToEmail,
} from "@/lib/outreach-account-helpers";
import { evaluateSenderReadiness, type SenderReadiness } from "@/lib/send-readiness";
import { trackEvent } from "@/lib/telemetry-client";
import type {
  BrandOutreachAssignment,
  BrandRecord,
  DomainRow,
  OutreachAccount,
  OutreachProvisioningSettings,
} from "@/lib/factory-types";
import {
  PageIntro,
  SectionPanel,
  StatLedger,
} from "@/components/ui/page-layout";
import { ExplainableHint } from "@/components/ui/explainable-hint";
import type { SenderCapacitySnapshot } from "@/lib/sender-capacity";

const DAY_MS = 24 * 60 * 60 * 1000;
const FILTERS = ["all", "queued", "warming", "attention", "ready"] as const;

type SenderFilter = (typeof FILTERS)[number];
type RoutingRole = "primary" | "standby" | "blocked" | "pending";
type SenderCardStatus = "ready" | "warming" | "setup" | "fix" | "protected";
type SenderHealthTone = "good" | "watch" | "checking" | "problem";
type SenderActionKind =
  | "repair_setup"
  | "refresh_mailpool"
  | "open_setup"
  | "open_settings"
  | "add_inbox"
  | "verify_gmail_ui";
type SenderBadgeVariant = "default" | "success" | "accent" | "muted" | "danger";
type HealthDimension = "domainHealth" | "emailHealth" | "ipHealth" | "messagingHealth";
type HealthSummaryDimension =
  | "domainHealthSummary"
  | "emailHealthSummary"
  | "ipHealthSummary"
  | "messagingHealthSummary";
type SenderActionPlan = {
  kind: SenderActionKind;
  label: string;
  description: string;
};
type SenderActionState = {
  pending: boolean;
  error: string;
  success: string;
};
type GmailUiWorkerSnapshot = {
  ok: boolean;
  accountId: string;
  fromEmail: string;
  step: string;
  prompt: string;
  currentUrl: string;
  title: string;
  loginState: "login_required" | "ready" | "error";
  screenshotPath: string;
  updatedAt: string;
};
type SenderProvisioningSnapshot = {
  headline: string;
  detail: string;
  etaLabel: string;
  nextStep: string;
  summary: string;
};
type AssignmentMap = Record<
  string,
  {
    accountId: string;
    accountIds: string[];
    mailboxAccountId: string;
  }
>;
type NetworkClientProps = {
  brand: BrandRecord;
  allBrands?: BrandRecord[];
  mailboxAccounts?: OutreachAccount[];
  customerIoAccounts?: OutreachAccount[];
  assignments?: AssignmentMap;
  provisioningSettings?: OutreachProvisioningSettings | null;
  senderCapacitySnapshots?: SenderCapacitySnapshot[];
};

const EMPTY_SENDER_ACTION_STATE: SenderActionState = {
  pending: false,
  error: "",
  success: "",
};

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

function stripUrl(value?: string) {
  if (!value) return "";
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function formatTimestamp(value?: string) {
  if (!value) return "No run logged";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "No run logged";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatEmailCount(value: number) {
  return `${value} email${value === 1 ? "" : "s"}`;
}

function formatElapsed(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const minutes = Math.max(0, Math.round((Date.now() - parsed.getTime()) / (60 * 1000)));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m ago` : `${hours}h ago`;
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function senderWarmupDay(value?: string) {
  if (!value) return 1;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 1;
  const startDay = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  const today = new Date();
  const todayDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(1, Math.floor((todayDay - startDay) / DAY_MS) + 1);
}

function senderDailyCap(row: DomainRow, capacity?: SenderCapacitySnapshot | null) {
  if (row.role === "brand" || !row.fromEmail) return 0;
  if (capacity) return Math.max(0, Number(capacity.dailyCap) || 0);
  return 0;
}

function senderMaxDailyCap(capacity?: SenderCapacitySnapshot | null) {
  return Math.max(0, Number(capacity?.maxDailyCap ?? 0) || 0);
}

function senderWarmupStageLabel(row: DomainRow, capacity?: SenderCapacitySnapshot | null) {
  return capacity?.warmupStage || row.warmupStage || "Warmup not started";
}

function derivedAutomationStatus(row: DomainRow): NonNullable<DomainRow["automationStatus"]> {
  if (row.senderLaunchState === "paused" || row.senderLaunchState === "blocked") return "attention";
  if (row.senderLaunchState === "setup" || row.senderLaunchState === "observing") return "testing";
  if (row.senderLaunchState === "warming" || row.senderLaunchState === "restricted_send") return "warming";
  if (row.senderLaunchState === "ready") return "ready";
  if (row.automationStatus) return row.automationStatus;
  if (row.role === "brand") return "ready";
  if (row.status === "risky" || row.dnsStatus === "error") return "attention";
  if (row.status === "warming") {
    return row.dnsStatus === "verified" ? "warming" : "testing";
  }
  if (row.dnsStatus === "pending" || row.dnsStatus === "configured") return "testing";
  return "ready";
}

function derivedHealth(row: DomainRow, dimension: HealthDimension): NonNullable<DomainRow["domainHealth"]> {
  const explicit = row[dimension];
  if (explicit) return explicit;

  const reputation = row.reputation.toLowerCase();
  const risky =
    row.status === "risky" ||
    row.dnsStatus === "error" ||
    reputation.includes("risky") ||
    reputation.includes("poor") ||
    reputation.includes("attention");
  if (risky) return "risky";

  const watch = reputation.includes("low") || reputation.includes("building") || reputation.includes("watch");
  const healthy = reputation.includes("good") || reputation.includes("high") || reputation.includes("strong");

  if (dimension === "domainHealth") {
    if (row.role === "brand") return "healthy";
    if (healthy || row.reputation.toLowerCase() === "protected") return "healthy";
    if (watch) return "watch";
    if (row.status === "warming" || row.dnsStatus === "pending" || row.dnsStatus === "configured") return "queued";
    return "unknown";
  }

  if (row.role === "brand") return "unknown";
  if (!row.fromEmail) return "unknown";
  if (healthy && row.status === "active") return "healthy";
  if (watch) return "watch";
  if (row.status === "warming" || row.dnsStatus !== "verified") return "queued";
  return "unknown";
}

function derivedHealthSummary(row: DomainRow, dimension: HealthSummaryDimension) {
  const explicit = row[dimension];
  if (explicit) return explicit;
  if (dimension === "domainHealthSummary") {
    return row.role === "brand"
      ? "Protected destination domain."
      : "Awaiting enough control probes to isolate domain effects.";
  }
  if (dimension === "emailHealthSummary") {
    return row.fromEmail
      ? "Awaiting mailbox-specific control probes."
      : "Mailbox-specific health starts when a sender mailbox is attached.";
  }
  if (dimension === "ipHealthSummary") {
    return row.fromEmail
      ? "Awaiting route-level control probes."
      : "Transport health starts when a sender mailbox is attached.";
  }
  return row.fromEmail
    ? "Awaiting both control and live-content probes."
    : "Message health starts when a sender mailbox and a real message both exist.";
}

function healthBadgeVariant(value: NonNullable<DomainRow["domainHealth"]>) {
  if (value === "healthy") return "success";
  if (value === "watch") return "accent";
  if (value === "risky") return "danger";
  return "muted";
}

function automationSummary(row: DomainRow) {
  if (row.automationSummary) return row.automationSummary;
  const status = derivedAutomationStatus(row);
  if (row.role === "brand") {
    return "Protected destination only. Spam-test probes stay on the satellite sender mailboxes.";
  }
  if (status === "attention") {
    return "Checks are blocked or degraded. Fix DNS, mailbox, IP, or message issues before more volume goes out.";
  }
  if (status === "warming") {
    return "Warmup is active. Domain, mailbox, IP, and message signals are still settling.";
  }
  if (status === "testing" || status === "queued") {
    return "DNS verification is still in flight. Warmup and isolated seed checks start as each sender becomes ready.";
  }
  return "Sender is ready for production volume. Keep watching the separate health signals.";
}

function automationTimingLabel(row: DomainRow) {
  if (row.lastHealthCheckAt) return `Last check ${formatTimestamp(row.lastHealthCheckAt)}`;
  if (row.nextHealthCheckAt) return `Next check ${formatTimestamp(row.nextHealthCheckAt)}`;
  return row.role === "brand" ? "No sender checks scheduled" : "Awaiting first automated check";
}

function filterBucket(
  row: DomainRow,
  capacity?: SenderCapacitySnapshot | null,
  readiness?: SenderReadiness | null
): Exclude<SenderFilter, "all"> {
  if (row.role === "brand") return "ready";
  if (readiness?.lifecycle === "blocked") return "attention";
  if (readiness?.lifecycle === "setup") return "queued";
  if (readiness?.lifecycle === "warming") return "warming";
  if (readiness?.lifecycle === "ready") return "ready";
  if (capacity?.domainLimitBlocked) return "attention";
  const status = derivedAutomationStatus(row);
  if (status === "attention") return "attention";
  if (status === "warming") return "warming";
  if (status === "ready") return "ready";
  return "queued";
}

function filterLabel(filter: SenderFilter) {
  if (filter === "all") return "All senders";
  if (filter === "queued") return "Setting up";
  if (filter === "warming") return "Warming up";
  if (filter === "attention") return "Needs fix";
  return "Ready to send";
}

function routingRoleBadgeVariant(role: RoutingRole) {
  if (role === "primary") return "success";
  if (role === "standby") return "accent";
  if (role === "blocked") return "danger";
  return "muted";
}

function senderSetupLine(row: DomainRow) {
  const parts: string[] = [];
  if (getDomainDeliveryAccountName(row)) parts.push(`Mailer ${getDomainDeliveryAccountName(row)}`);
  if (row.forwardingTargetUrl) parts.push(`forwards to ${stripUrl(row.forwardingTargetUrl)}`);
  return parts.join(" · ");
}

function isMonitorInboxIssue(row: DomainRow) {
  const summary = automationSummary(row).toLowerCase();
  return (
    row.seedPolicy === "tainted_mailbox" ||
    summary.includes("seed pool exhausted") ||
    summary.includes("spare check inbox") ||
    summary.includes("no unused deliverability monitor mailbox remains")
  );
}

function routingRoleForRow(row: DomainRow, routingRoleBySenderId: Map<string, RoutingRole>): RoutingRole {
  if (getDomainDeliveryAccountId(row)) {
    return routingRoleBySenderId.get(getDomainDeliveryAccountId(row)) ?? "pending";
  }
  if (row.role === "brand") return "pending";
  if (derivedAutomationStatus(row) === "attention") return "blocked";
  return "pending";
}

function senderCardStatus(
  row: DomainRow,
  routingRole: RoutingRole,
  capacity?: SenderCapacitySnapshot | null,
  readiness?: SenderReadiness | null
): SenderCardStatus {
  const automationStatus = derivedAutomationStatus(row);
  if (row.role === "brand") return "protected";
  if (readiness?.lifecycle === "setup") return "setup";
  if (readiness?.lifecycle === "blocked") return "fix";
  if (readiness?.lifecycle === "warming") return "warming";
  if (readiness?.lifecycle === "ready") return "ready";
  if (capacity?.domainLimitBlocked) return "fix";
  if (automationStatus === "attention" || routingRole === "blocked" || row.status === "risky") return "fix";
  if (!row.fromEmail || automationStatus === "testing" || automationStatus === "queued") return "setup";
  if (automationStatus === "warming") return "warming";
  return "ready";
}

function senderProvisioningSnapshot(row: DomainRow, account: OutreachAccount | null): SenderProvisioningSnapshot | null {
  if (!account || account.provider !== "mailpool") return null;
  const mailpoolStatus = account.config.mailpool.status;
  const mailboxStatus = account.config.mailbox.status;
  const startedLabel = formatElapsed(row.lastProvisionedAt || account.updatedAt || account.createdAt);
  const standardEta = startedLabel
    ? `Started ${startedLabel}. Mailpool usually finishes this in about 10-15 minutes.`
    : "Mailpool usually finishes this in about 10-15 minutes.";

  if (mailpoolStatus === "pending") {
    return {
      headline: "Pending setup",
      detail: "Mailpool is still creating the mailbox and sender credentials.",
      etaLabel: standardEta,
      nextStep: "Wait for setup",
      summary: `Mailpool is still creating the mailbox and sender credentials. ${standardEta}`,
    };
  }

  if (mailpoolStatus === "updating") {
    return {
      headline: "Updating setup",
      detail: "Mailpool is updating the sender configuration before this inbox can send.",
      etaLabel: standardEta,
      nextStep: "Wait for update",
      summary: `Mailpool is updating the sender configuration before this inbox can send. ${standardEta}`,
    };
  }

  if (mailboxStatus === "disconnected") {
    return {
      headline: "Finishing connection",
      detail: "The mailbox exists, but the sending connection is still coming online.",
      etaLabel: startedLabel
        ? `Started ${startedLabel}. This usually clears a few minutes after provisioning finishes.`
        : "This usually clears a few minutes after provisioning finishes.",
      nextStep: "Refresh status",
      summary:
        "The mailbox exists, but the sending connection is still coming online. This sender will stay blocked until Mailpool finishes the connection.",
    };
  }

  return null;
}

function senderCardStatusLabel(status: SenderCardStatus) {
  if (status === "ready") return "Can send";
  if (status === "warming") return "Warming up";
  if (status === "setup") return "Setting up";
  if (status === "fix") return "Fix this";
  return "Replies only";
}

function senderCardStatusVariant(status: SenderCardStatus) {
  if (status === "ready") return "success";
  if (status === "warming") return "accent";
  if (status === "fix") return "danger";
  return "muted";
}

function senderRouteLabel(
  role: RoutingRole,
  row: DomainRow,
  status: SenderCardStatus,
  health: SenderHealthTone,
  provisioning: SenderProvisioningSnapshot | null,
  capacity?: SenderCapacitySnapshot | null,
  readiness?: SenderReadiness | null
) {
  if (status === "protected") return "Replies only";
  if (provisioning) return provisioning.headline;
  if (capacity?.domainLimitBlocked) return "Domain capped";
  if (status === "fix") {
    if (readiness?.primaryBlockingReason) return "Blocked";
    if (row.dnsStatus === "error") return "Setup broken";
    if (isMonitorInboxIssue(row)) return "Need another inbox";
    if (health === "problem") return "Health problem";
    return "Paused";
  }
  if (status === "setup") {
    if (!row.fromEmail) return "Missing mailbox";
    if (row.dnsStatus === "pending") return "Waiting on DNS";
    if (row.dnsStatus === "configured") return "Checking DNS";
    return "Running checks";
  }
  if (status === "warming") return "Warming up";
  if (role === "primary") return "Sending now";
  if (role === "standby") return "Backup ready";
  if (role === "blocked") return "Paused";
  return "Ready";
}

function senderRouteDetail(
  role: RoutingRole,
  row: DomainRow,
  status: SenderCardStatus,
  health: SenderHealthTone,
  provisioning: SenderProvisioningSnapshot | null,
  capacity?: SenderCapacitySnapshot | null,
  readiness?: SenderReadiness | null
) {
  if (status === "protected") return "Reply inbox only";
  if (provisioning) return provisioning.etaLabel;
  if (capacity?.domainLimitBlocked) return `Only ${capacity.activeSenderLimitPerDomain} inboxes can send on this domain`;
  if (status === "fix") {
    if (readiness?.primaryBlockingReason) return readiness.primaryBlockingReason;
    if (row.dnsStatus === "error") return "Warmup cannot start";
    if (isMonitorInboxIssue(row)) return "Checks are paused";
    if (health === "problem") return "Out of rotation";
    return "Needs review";
  }
  if (status === "setup") {
    if (!row.fromEmail) return "Finish sender setup";
    if (row.dnsStatus !== "verified") return "Cannot send until DNS verifies";
    return "Waiting for control checks";
  }
  if (status === "warming") return "Limited volume only";
  if (role === "primary") return "First in line";
  if (role === "standby") return "Healthy backup";
  if (role === "blocked") return "Out of rotation";
  return "Ready when needed";
}

function senderRouteVariant(status: SenderCardStatus, role: RoutingRole) {
  if (status === "fix") return "danger";
  if (status === "warming") return "accent";
  if (status === "ready") return routingRoleBadgeVariant(role);
  return "muted";
}

function senderHealthSignals(row: DomainRow) {
  return [
    ["Domain", derivedHealth(row, "domainHealth"), derivedHealthSummary(row, "domainHealthSummary")],
    ["Mailbox", derivedHealth(row, "emailHealth"), derivedHealthSummary(row, "emailHealthSummary")],
    ["Route", derivedHealth(row, "ipHealth"), derivedHealthSummary(row, "ipHealthSummary")],
    ["Message", derivedHealth(row, "messagingHealth"), derivedHealthSummary(row, "messagingHealthSummary")],
  ] as Array<[string, NonNullable<DomainRow["domainHealth"]>, string]>;
}

function friendlyHealthLabel(value: NonNullable<DomainRow["domainHealth"]>) {
  if (value === "healthy") return "Good";
  if (value === "watch") return "Watch";
  if (value === "risky") return "Fix";
  return "Checking";
}

function senderOverallHealth(row: DomainRow): SenderHealthTone {
  const values = senderHealthSignals(row).map(([, value]) => value);
  if (values.includes("risky")) return "problem";
  if (values.includes("watch")) return "watch";
  if (values.some((value) => value === "queued" || value === "unknown")) return "checking";
  return "good";
}

function senderOverallHealthLabel(status: SenderHealthTone) {
  if (status === "good") return "Good";
  if (status === "watch") return "Watch";
  if (status === "problem") return "Problem";
  return "Checking";
}

function senderOverallHealthVariant(status: SenderHealthTone) {
  if (status === "good") return "success";
  if (status === "watch") return "accent";
  if (status === "problem") return "danger";
  return "muted";
}

function senderHealthDisplay(
  row: DomainRow,
  status: SenderCardStatus,
  health: SenderHealthTone,
  provisioning: SenderProvisioningSnapshot | null
): { badgeLabel: string; cardLabel: string; detail: string; variant: SenderBadgeVariant } {
  if (provisioning) {
    return {
      badgeLabel: "Setting up",
      cardLabel: "Pending",
      detail: provisioning.etaLabel,
      variant: "muted",
    };
  }

  if (status === "fix" && isMonitorInboxIssue(row)) {
    return {
      badgeLabel: "Sender okay",
      cardLabel: "Sender okay",
      detail: "Blocked only because checks need another inbox",
      variant: "success",
    };
  }

  return {
    badgeLabel: senderOverallHealthLabel(health),
    cardLabel: senderOverallHealthLabel(health),
    detail:
      health === "good"
        ? "Looks healthy"
        : health === "watch"
          ? "Usable, but watch it"
          : health === "problem"
            ? "Fix before sending"
            : "Still gathering signal",
    variant: senderOverallHealthVariant(health),
  };
}

function senderTodaySummary(
  row: DomainRow,
  status: SenderCardStatus,
  provisioning: SenderProvisioningSnapshot | null,
  capacity?: SenderCapacitySnapshot | null,
  readiness?: SenderReadiness | null
) {
  const cap = senderDailyCap(row, capacity);
  if (status === "protected") {
    return { value: "-", detail: "not a sender" };
  }
  if (provisioning) {
    return { value: "0", detail: "pending setup" };
  }
  if (capacity?.domainLimitBlocked) {
    return { value: "0", detail: `domain capped at ${capacity.activeSenderLimitPerDomain}` };
  }
  if (status === "fix") {
    return { value: "0", detail: readiness?.primaryBlockingReason || "paused today" };
  }
  if (status === "setup") {
    return { value: "0", detail: "not ready yet" };
  }
  if (status === "warming") {
    return { value: String(cap), detail: `${capacity?.dailySent ?? 0} used · warmup cap` };
  }
  return { value: String(cap), detail: `${capacity?.dailySent ?? 0} used today` };
}

function senderNextStep(
  row: DomainRow,
  status: SenderCardStatus,
  health: SenderHealthTone,
  provisioning: SenderProvisioningSnapshot | null,
  capacity?: SenderCapacitySnapshot | null
) {
  if (status === "protected") return "Replies land here";
  if (provisioning) return provisioning.nextStep;
  if (capacity?.domainLimitBlocked) return "Reduce to 3 active inboxes";
  if (status === "fix") {
    if (row.dnsStatus === "error") return "Fix DNS";
    if (health === "problem") return "Fix health";
    return "Review sender";
  }
  if (status === "setup") {
    if (!row.fromEmail) return "Attach mailbox";
    if (row.dnsStatus !== "verified") return "Finish DNS";
    return "Wait for checks";
  }
  if (status === "warming") return "Finish warmup";
  return "Keep sending";
}

function senderActionPlan(
  row: DomainRow,
  status: SenderCardStatus,
  health: SenderHealthTone,
  provisioning: SenderProvisioningSnapshot | null,
  account: OutreachAccount | null,
  readiness?: SenderReadiness | null
): SenderActionPlan | null {
  if (status === "protected" || status === "ready") return null;
  const mailboxConfig = account ? ((account.config.mailbox ?? {}) as Record<string, unknown>) : null;
  const deliveryMethod = mailboxConfig
    ? String(mailboxConfig.deliveryMethod ?? mailboxConfig.delivery_method ?? "").trim()
    : "";
  const gmailUiLoginState = mailboxConfig
    ? String(mailboxConfig.gmailUiLoginState ?? mailboxConfig.gmail_ui_login_state ?? "").trim()
    : "";
  if (provisioning) {
    return {
      kind: "refresh_mailpool",
      label: "Verify sender",
      description: `${provisioning.detail} ${provisioning.etaLabel}`.trim(),
    };
  }
  if (!row.fromEmail) {
    return {
      kind: "open_setup",
      label: "Verify sender",
      description: "Open the sender flow and attach the missing mailbox.",
    };
  }
  if (
    account &&
    account.provider === "mailpool" &&
    !isMonitorInboxIssue(row) &&
    (deliveryMethod === "gmail_ui" || !deliveryMethod) &&
    gmailUiLoginState !== "ready" &&
    row.fromEmail &&
    row.dnsStatus === "verified"
  ) {
    return {
      kind: "verify_gmail_ui",
      label: "Verify sender",
      description: "Open the Gmail verification panel with the current password and auth code.",
    };
  }
  if (row.provider === "mailpool" && row.dnsStatus !== "verified") {
    return {
      kind: "refresh_mailpool",
      label: "Verify sender",
      description: "Pull the latest domain and mailbox state from Mailpool.",
    };
  }
  if (row.dnsStatus === "error") {
    return {
      kind: "repair_setup",
      label: "Verify sender",
      description: "Repair sender DNS, forwarding, and connection settings for this domain.",
    };
  }
  if (row.dnsStatus !== "verified") {
    return {
      kind: "repair_setup",
      label: "Verify sender",
      description: "Re-run sender checks while this domain finishes verifying.",
    };
  }
  if (isMonitorInboxIssue(row)) {
    return {
      kind: "add_inbox",
      label: "Verify sender",
      description: "Open the inbox flow and add 1 more reply inbox so checks can resume.",
    };
  }
  if (status === "fix" || health === "problem") {
    if (
      account &&
      account.provider === "mailpool" &&
      !isMonitorInboxIssue(row) &&
      row.fromEmail &&
      row.dnsStatus === "verified"
    ) {
      return {
        kind: "verify_gmail_ui",
        label: "Verify sender",
        description:
          "Open the Gmail verification panel. If login is already done, re-check the sender from there.",
      };
    }
    return {
      kind: "open_settings",
      label: "Verify sender",
      description:
        readiness?.primaryBlockingReason ||
        "Open sender checks and review what is blocking readiness.",
    };
  }
  return null;
}

function senderSummaryLine(
  row: DomainRow,
  status: SenderCardStatus,
  routingRole: RoutingRole,
  health: SenderHealthTone,
  provisioning: SenderProvisioningSnapshot | null,
  capacity?: SenderCapacitySnapshot | null,
  readiness?: SenderReadiness | null
) {
  if (status === "protected") {
    return "This is your protected reply domain. It catches replies but does not send outbound mail.";
  }
  if (provisioning) return provisioning.summary;
  if (capacity?.domainLimitBlocked) {
    return `This inbox is healthy, but it is intentionally idle because ${row.domain} already has ${capacity.activeSenderLimitPerDomain} active sending inboxes.`;
  }
  if (status === "fix" && readiness?.primaryBlockingReason) {
    return readiness.primaryBlockingReason;
  }
  if (status === "fix" && isMonitorInboxIssue(row)) {
    return "This sender is not broken. We just ran out of extra inboxes used to check it safely. Add 1 more inbox and checks will start again.";
  }
  if (status === "fix" || status === "setup" || status === "warming") return automationSummary(row);
  if (health === "watch") {
    return "This sender can send, but one of the health signals needs watching.";
  }
  if (routingRole === "primary") return "This sender is healthy and first in line right now.";
  if (routingRole === "standby") return "This sender is healthy and ready as a backup.";
  return "This sender is healthy and ready when routing needs it.";
}

function isDeliverabilityMonitorAccount(account: OutreachAccount) {
  return account.name.trim().toLowerCase().startsWith("deliverability ");
}

function normalizeAssignment(brandId: string, assignment: BrandOutreachAssignment | null): AssignmentMap {
  return {
    [brandId]: {
      accountId: assignment?.accountId ?? "",
      accountIds: Array.isArray(assignment?.accountIds)
        ? assignment.accountIds
        : assignment?.accountId
          ? [assignment.accountId]
          : [],
      mailboxAccountId: assignment?.mailboxAccountId ?? "",
    },
  };
}

function buildPendingSenderRow(brand: BrandRecord, account: OutreachAccount, mailboxAccount: OutreachAccount | null): DomainRow | null {
  const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
  const domain = normalizeDomain(fromEmail.split("@")[1] ?? "");
  if (!fromEmail || !domain) return null;

  const lastProvisionedAt = account.updatedAt || account.createdAt;
  const provisioning = senderProvisioningSnapshot(
    {
      id: `pending:${account.id}`,
      domain,
      status: "warming",
      warmupStage: "Provisioning",
      reputation: "Pending setup",
      role: "sender",
      provider: account.provider,
      dnsStatus: "pending",
      lastProvisionedAt,
    },
    account
  );

  return {
    id: `pending:${account.id}`,
    domain,
    status: "warming",
    warmupStage: "Provisioning",
    reputation: "Pending setup",
    automationStatus: "testing",
    automationSummary: provisioning?.summary || "Mailpool is still provisioning this sender.",
    domainHealth: "queued",
    domainHealthSummary: "Provisioning is still running, so domain health checks have not started yet.",
    emailHealth: "queued",
    emailHealthSummary: "Mailbox health checks will begin once the inbox is connected.",
    ipHealth: "queued",
    ipHealthSummary: "Transport health will appear after Mailpool finishes connecting the sender.",
    messagingHealth: "queued",
    messagingHealthSummary: "Message health starts after the first completed setup checks.",
    role: "sender",
    registrar: "mailpool",
    provider: account.provider,
    dnsStatus: "pending",
    fromEmail,
    replyMailboxEmail: getOutreachAccountReplyToEmail(mailboxAccount ?? account).trim().toLowerCase() || fromEmail,
    deliveryAccountId: account.id,
    deliveryAccountName: account.name,
    customerIoAccountId: account.provider === "customerio" ? account.id : "",
    customerIoAccountName: account.provider === "customerio" ? account.name : "",
    mailpoolDomainId: account.config.mailpool.domainId.trim(),
    notes: `${brand.name} sender provisioning`,
    lastProvisionedAt,
    lastHealthCheckAt: account.lastTestAt,
  };
}

function RoutingScoreDetails({
  signal,
  align = "left",
}: {
  signal: SenderRoutingSignals;
  align?: "left" | "right" | "center";
}) {
  const routeScore = summarizeSenderRoutingScore(signal);

  return (
    <ExplainableHint
      label={`Explain route score for ${signal.fromEmail}`}
      title={`Route score ${routeScore.normalizedScore}/100`}
      align={align}
      panelClassName="w-[min(28rem,calc(100vw-2rem))]"
    >
      <p>This is a normalized route score out of 100. It is not a deliverability percentage.</p>
      <p>{routeScore.detail}</p>
      <div className="grid gap-2 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-2">
        {routeScore.breakdown.map((item) => (
          <div key={item.label} className="space-y-1">
            <div className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
              {item.label}
            </div>
            <div className="text-sm font-medium text-[color:var(--foreground)]">{item.value}</div>
            <div className="text-xs leading-5 text-[color:var(--muted-foreground)]">{item.detail}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-[color:var(--muted-foreground)]">
        Strong: 75-100. Usable: 55-74. Watch: 35-54. Weak: 0-34.
      </p>
    </ExplainableHint>
  );
}

export default function NetworkClient({
  brand,
  allBrands: initialAllBrands = [],
  mailboxAccounts: initialMailboxAccounts = [],
  customerIoAccounts: initialCustomerIoAccounts = [],
  assignments: initialAssignments = {},
  provisioningSettings: initialProvisioningSettings = null,
  senderCapacitySnapshots = [],
}: NetworkClientProps) {
  const router = useRouter();
  const [domains, setDomains] = useState<DomainRow[]>(brand.domains || []);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<SenderFilter>("all");
  const [error, setError] = useState("");
  const [senderModalOpen, setSenderModalOpen] = useState(false);
  const [senderModalLoading, setSenderModalLoading] = useState(false);
  const [senderModalError, setSenderModalError] = useState("");
  const [senderModalAccounts, setSenderModalAccounts] = useState<OutreachAccount[]>([
    ...initialCustomerIoAccounts,
    ...initialMailboxAccounts,
  ]);
  const [senderModalAssignments, setSenderModalAssignments] = useState<AssignmentMap>(initialAssignments);
  const [senderModalBrands, setSenderModalBrands] = useState<BrandRecord[]>(initialAllBrands);
  const [senderModalSettings, setSenderModalSettings] =
    useState<OutreachProvisioningSettings | null>(initialProvisioningSettings);
  const [senderActionState, setSenderActionState] = useState<Record<string, SenderActionState>>({});
  const [gmailVerifyOpen, setGmailVerifyOpen] = useState(false);
  const [gmailVerifyRow, setGmailVerifyRow] = useState<DomainRow | null>(null);
  const [gmailVerifyAccountId, setGmailVerifyAccountId] = useState("");
  const [gmailVerifyLoading, setGmailVerifyLoading] = useState(false);
  const [gmailVerifySubmitting, setGmailVerifySubmitting] = useState(false);
  const [gmailVerifyError, setGmailVerifyError] = useState("");
  const [gmailVerifyCheckMessage, setGmailVerifyCheckMessage] = useState("");
  const [gmailVerifyCheckPending, setGmailVerifyCheckPending] = useState(false);
  const [gmailVerifyOtpInput, setGmailVerifyOtpInput] = useState("");
  const [gmailVerifyPasswordInput, setGmailVerifyPasswordInput] = useState("");
  const [gmailVerifySession, setGmailVerifySession] = useState<GmailUiWorkerSnapshot | null>(null);

  const activeBrand = useMemo(() => ({ ...brand, domains }), [brand, domains]);
  const modalBrands = useMemo(() => [activeBrand], [activeBrand]);
  const modalAllBrands = useMemo(() => {
    const otherBrands = senderModalBrands.filter((item) => item.id !== activeBrand.id);
    return [activeBrand, ...otherBrands];
  }, [activeBrand, senderModalBrands]);
  const deliveryAccounts = useMemo(
    () => senderModalAccounts.filter((account) => account.accountType !== "mailbox"),
    [senderModalAccounts]
  );
  const mailboxAccounts = useMemo(
    () =>
      senderModalAccounts.filter(
        (account) => account.accountType !== "delivery" && !isDeliverabilityMonitorAccount(account)
      ),
    [senderModalAccounts]
  );
  const activeAssignment = senderModalAssignments[brand.id] ?? initialAssignments[brand.id];
  const deliveryAccountById = useMemo(
    () => new Map(deliveryAccounts.map((account) => [account.id, account] as const)),
    [deliveryAccounts]
  );
  const deliveryAccountByEmail = useMemo(
    () =>
      new Map(
        deliveryAccounts
          .map((account) => [getOutreachAccountFromEmail(account).trim().toLowerCase(), account] as const)
          .filter(([email]) => Boolean(email))
      ),
    [deliveryAccounts]
  );
  const deliveryAccountByName = useMemo(
    () =>
      new Map(
        deliveryAccounts
          .map((account) => [account.name.trim().toLowerCase(), account] as const)
          .filter(([name]) => Boolean(name))
      ),
    [deliveryAccounts]
  );
  const mailboxAccountById = useMemo(
    () => new Map(mailboxAccounts.map((account) => [account.id, account] as const)),
    [mailboxAccounts]
  );
  const assignedMailboxAccount = activeAssignment?.mailboxAccountId
    ? mailboxAccountById.get(activeAssignment.mailboxAccountId) ?? null
    : null;
  const assignedDeliveryAccounts = useMemo(() => {
    const accountIds = [activeAssignment?.accountId ?? "", ...(activeAssignment?.accountIds ?? [])].filter(Boolean);
    return accountIds
      .map((accountId) => deliveryAccountById.get(accountId) ?? null)
      .filter((account): account is OutreachAccount => Boolean(account));
  }, [activeAssignment, deliveryAccountById]);
  const resolveDeliveryAccountForRow = useCallback(
    (row: DomainRow) => {
      const deliveryAccountId = getDomainDeliveryAccountId(row);
      if (deliveryAccountId) {
        const account = deliveryAccountById.get(deliveryAccountId) ?? null;
        if (account) return account;
      }

      const fromEmail = String(row.fromEmail ?? "").trim().toLowerCase();
      if (fromEmail) {
        const account = deliveryAccountByEmail.get(fromEmail) ?? null;
        if (account) return account;
      }

      const deliveryAccountName = getDomainDeliveryAccountName(row).trim().toLowerCase();
      if (deliveryAccountName) {
        const account = deliveryAccountByName.get(deliveryAccountName) ?? null;
        if (account) return account;
      }

      if (assignedDeliveryAccounts.length === 1) {
        return assignedDeliveryAccounts[0] ?? null;
      }

      return null;
    },
    [assignedDeliveryAccounts, deliveryAccountByEmail, deliveryAccountById, deliveryAccountByName]
  );
  const resolveDeliveryAccountIdForRow = useCallback(
    (row: DomainRow) => resolveDeliveryAccountForRow(row)?.id ?? getDomainDeliveryAccountId(row),
    [resolveDeliveryAccountForRow]
  );
  const syntheticPendingSenderRows = useMemo(() => {
    const assignedIds = new Set(
      [activeAssignment?.accountId ?? "", ...(activeAssignment?.accountIds ?? [])].filter(Boolean)
    );
    if (!assignedIds.size) return [];
    return [...assignedIds]
      .map((accountId) => deliveryAccountById.get(accountId) ?? null)
      .filter((account): account is OutreachAccount => Boolean(account))
      .flatMap((account) => {
        const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
        const alreadyRendered = domains.some(
          (item) =>
            getDomainDeliveryAccountId(item) === account.id ||
            (fromEmail && String(item.fromEmail ?? "").trim().toLowerCase() === fromEmail)
        );
        if (alreadyRendered) return [];
        const synthetic = buildPendingSenderRow(brand, account, assignedMailboxAccount);
        return synthetic ? [synthetic] : [];
      });
  }, [activeAssignment, assignedMailboxAccount, brand, deliveryAccountById, domains]);
  const senderDomains = useMemo(
    () => [...domains.filter((item) => item.role !== "brand"), ...syntheticPendingSenderRows],
    [domains, syntheticPendingSenderRows]
  );
  const protectedDestination = useMemo(() => domains.find((item) => item.role === "brand") ?? null, [domains]);
  const senderCapacityByAccountId = useMemo(
    () => new Map(senderCapacitySnapshots.map((snapshot) => [snapshot.senderAccountId, snapshot] as const)),
    [senderCapacitySnapshots]
  );
  const senderCapacityByEmail = useMemo(
    () =>
      new Map(
        senderCapacitySnapshots
          .filter((snapshot) => snapshot.fromEmail.trim())
          .map((snapshot) => [snapshot.fromEmail.trim().toLowerCase(), snapshot] as const)
      ),
    [senderCapacitySnapshots]
  );
  const capacityForRow = useCallback(
    (row: DomainRow) =>
      (resolveDeliveryAccountIdForRow(row)
        ? senderCapacityByAccountId.get(resolveDeliveryAccountIdForRow(row)) ?? null
        : null) ||
      (row.fromEmail ? senderCapacityByEmail.get(String(row.fromEmail).trim().toLowerCase()) ?? null : null),
    [resolveDeliveryAccountIdForRow, senderCapacityByAccountId, senderCapacityByEmail]
  );
  const readinessForRow = useCallback(
    (row: DomainRow) => {
      if (row.role === "brand") return null;
      const account = resolveDeliveryAccountForRow(row);
      const fromEmail = String(row.fromEmail ?? "").trim().toLowerCase();
      const mailboxAccount =
        account && account.config.mailbox.email.trim().toLowerCase() === fromEmail
          ? account
          : assignedMailboxAccount;
      return evaluateSenderReadiness({
        account,
        mailboxAccount,
        hasDeliveryCredentials: account?.hasCredentials ?? false,
        hasMailboxCredentials: mailboxAccount?.hasCredentials ?? false,
        row,
        capacity: capacityForRow(row),
      });
    },
    [assignedMailboxAccount, capacityForRow, resolveDeliveryAccountForRow]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return senderDomains.filter((item) => {
      if (statusFilter !== "all" && filterBucket(item, capacityForRow(item), readinessForRow(item)) !== statusFilter) {
        return false;
      }
      if (!needle) return true;
      return [
        item.domain,
        item.fromEmail ?? "",
        item.replyMailboxEmail ?? "",
        getDomainDeliveryAccountName(item),
        senderSetupLine(item),
        automationSummary(item),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [capacityForRow, query, readinessForRow, senderDomains, statusFilter]);

  const ledgerItems = useMemo(
    () =>
      FILTERS.map((filter) => ({
        label: filterLabel(filter),
        value: formatCount(
          filter === "all"
            ? senderDomains.length
            : senderDomains.filter((item) => filterBucket(item, capacityForRow(item), readinessForRow(item)) === filter).length
        ),
        active: statusFilter === filter,
        onClick: () => setStatusFilter(filter),
      })),
    [capacityForRow, readinessForRow, senderDomains, statusFilter]
  );

  const rankedRoutingSignals = useMemo(
    () =>
      rankSenderRoutingSignals(
        senderDomains
          .map((row) => buildSenderRoutingSignalFromDomainRow(row))
          .filter((row): row is SenderRoutingSignals => Boolean(row))
      ),
    [senderDomains]
  );
  const preferredRoutingSignal = useMemo(
    () =>
      rankedRoutingSignals.find((signal) => {
        const row =
          senderDomains.find((item) => getDomainDeliveryAccountId(item) === signal.senderAccountId) ?? null;
        return Boolean(row && readinessForRow(row)?.canSendNow);
      }) ?? null,
    [rankedRoutingSignals, readinessForRow, senderDomains]
  );
  const routingRoleBySenderId = useMemo(() => {
    const next = new Map<string, "primary" | "standby" | "blocked" | "pending">();
    for (const signal of rankedRoutingSignals) {
      const row =
        senderDomains.find((item) => getDomainDeliveryAccountId(item) === signal.senderAccountId) ?? null;
      const readiness = row ? readinessForRow(row) : null;
      if (readiness && !readiness.canSendNow) {
        next.set(signal.senderAccountId, "blocked");
        continue;
      }
      if (preferredRoutingSignal && signal.senderAccountId === preferredRoutingSignal.senderAccountId) {
        next.set(signal.senderAccountId, "primary");
        continue;
      }
      next.set(signal.senderAccountId, "standby");
    }
    return next;
  }, [preferredRoutingSignal, rankedRoutingSignals, readinessForRow, senderDomains]);
  const blockedRoutingSignals = useMemo(
    () =>
      rankedRoutingSignals.filter((signal) => {
        const row =
          senderDomains.find((item) => getDomainDeliveryAccountId(item) === signal.senderAccountId) ?? null;
        return Boolean(row && readinessForRow(row) && !readinessForRow(row)?.canSendNow);
      }),
    [rankedRoutingSignals, readinessForRow, senderDomains]
  );
  const senderSummary = useMemo(
    () =>
      senderDomains.reduce(
        (summary, row) => {
          const account = resolveDeliveryAccountForRow(row);
          const capacity = capacityForRow(row);
          const routingRole = routingRoleForRow(row, routingRoleBySenderId);
          const readiness = readinessForRow(row);
          const status = senderCardStatus(row, routingRole, capacity, readiness);
          const health = senderOverallHealth(row);
          const provisioning = senderProvisioningSnapshot(row, account);
          const action = senderActionPlan(row, status, health, provisioning, account, readiness);

          if (status === "ready") {
            summary.readyCount += 1;
            summary.readyCapacity += readiness?.canSendNow ? senderDailyCap(row, capacity) : 0;
          } else if (status === "warming") {
            summary.warmingCount += 1;
          } else if (status === "fix") {
            summary.fixCount += 1;
          } else if (status === "setup") {
            summary.setupCount += 1;
          }
          if (status === "setup" && row.fromEmail && row.dnsStatus !== "verified") {
            summary.dnsWaitingCount += 1;
          }
          if (status === "setup" && !row.fromEmail) {
            summary.mailboxMissingCount += 1;
          }
          if (action && action.kind !== "open_settings" && action.kind !== "verify_gmail_ui") {
            summary.autoFixCount += 1;
          }

          return summary;
        },
        {
          readyCount: 0,
          readyCapacity: 0,
          warmingCount: 0,
          fixCount: 0,
          setupCount: 0,
          dnsWaitingCount: 0,
          mailboxMissingCount: 0,
          autoFixCount: 0,
        }
      ),
    [
      readinessForRow,
      resolveDeliveryAccountForRow,
      routingRoleBySenderId,
      senderDomains,
      capacityForRow,
    ]
  );
  const provisioningSenders = useMemo(
    () =>
      senderDomains
        .map((row) => {
          const account = resolveDeliveryAccountForRow(row);
          const provisioning = senderProvisioningSnapshot(row, account);
          return provisioning ? { row, provisioning } : null;
        })
        .filter((item): item is { row: DomainRow; provisioning: SenderProvisioningSnapshot } => Boolean(item)),
    [resolveDeliveryAccountForRow, senderDomains]
  );
  const primaryProvisioningSender = provisioningSenders[0] ?? null;
  const preferredReadyRoutingSignal = useMemo(() => {
    if (!preferredRoutingSignal) return null;
    const row =
      senderDomains.find((item) => getDomainDeliveryAccountId(item) === preferredRoutingSignal.senderAccountId) ?? null;
    if (!row) return null;
    const readiness = readinessForRow(row);
    const status = senderCardStatus(
      row,
      routingRoleForRow(row, routingRoleBySenderId),
      capacityForRow(row),
      readiness
    );
    return status === "ready" ? preferredRoutingSignal : null;
  }, [capacityForRow, preferredRoutingSignal, readinessForRow, routingRoleBySenderId, senderDomains]);
  const readyBackupCount = Math.max(0, senderSummary.readyCount - (preferredReadyRoutingSignal ? 1 : 0));
  const sendingPower = useMemo(() => {
    const evaluated = senderDomains
      .map((row) => ({ row, readiness: readinessForRow(row) }))
      .filter((entry) => entry.row.role !== "brand" && entry.readiness);
    const totalDailyCap = evaluated.reduce(
      (sum, entry) => sum + (entry.readiness?.canSendNow ? entry.readiness.currentDailyCap : 0),
      0
    );
    const usedToday = evaluated.reduce(
      (sum, entry) => sum + Math.max(0, Number(entry.readiness?.dailySent ?? 0) || 0),
      0
    );
    const activeSenders = evaluated.filter((entry) => entry.readiness?.canSendNow).length;
    return {
      totalDailyCap,
      usedToday,
      remaining: Math.max(totalDailyCap - usedToday, 0),
      utilization: totalDailyCap > 0 ? Math.min(1, usedToday / totalDailyCap) : 0,
      activeSenders,
    };
  }, [readinessForRow, senderDomains]);
  const brandReadiness = useMemo(() => {
    const evaluated = senderDomains
      .filter((row) => row.role !== "brand")
      .map((row) => {
        const account = resolveDeliveryAccountForRow(row);
        const capacity = capacityForRow(row);
        const routingRole = routingRoleForRow(row, routingRoleBySenderId);
        const readiness = readinessForRow(row);
        const status = senderCardStatus(row, routingRole, capacity, readiness);
        const provisioning = senderProvisioningSnapshot(row, account);
        return {
          row,
          account,
          capacity,
          routingRole,
          readiness,
          status,
          provisioning,
        };
      });

    const readySenders = evaluated.filter((entry) => entry.readiness?.canSendNow);
    if (readySenders.length) {
      return {
        state: "ready" as const,
        value: "Yes",
        detail: `${formatEmailCount(sendingPower.totalDailyCap)} available today across ${readySenders.length} sender${readySenders.length === 1 ? "" : "s"}.`,
        note:
          preferredReadyRoutingSignal
            ? `${preferredReadyRoutingSignal.fromEmail} is first in line right now.`
            : "A healthy sender is ready and available for dispatch.",
      };
    }

    const provisioningSender = evaluated.find((entry) => entry.provisioning);
    if (provisioningSender) {
      return {
        state: "provisioning" as const,
        value: "No",
        detail: provisioningSender.provisioning?.detail || "A sender is still being provisioned.",
        note: provisioningSender.provisioning?.etaLabel || "Sending unlocks automatically when provisioning finishes.",
      };
    }

    const blockedSender = evaluated.find((entry) => entry.readiness?.primaryBlockingReason);
    if (blockedSender?.readiness) {
      return {
        state: "blocked" as const,
        value: "No",
        detail: blockedSender.readiness.primaryBlockingReason,
        note: `${blockedSender.row.fromEmail || blockedSender.row.domain} is the first sender blocking outbound right now.`,
      };
    }

    const setupSender = evaluated.find((entry) => entry.status === "setup");
    if (setupSender) {
      return {
        state: "setup" as const,
        value: "No",
        detail: senderRouteDetail(
          setupSender.routingRole,
          setupSender.row,
          setupSender.status,
          senderOverallHealth(setupSender.row),
          setupSender.provisioning,
          setupSender.capacity,
          setupSender.readiness
        ),
        note: "Finish sender setup and a ready sender will appear here automatically.",
      };
    }

    return {
      state: "empty" as const,
      value: "No",
      detail: "No sender is currently assigned and ready for outbound.",
      note: "Assign or provision a sender to start sending.",
    };
  }, [
    capacityForRow,
    preferredReadyRoutingSignal,
    readinessForRow,
    resolveDeliveryAccountForRow,
    routingRoleBySenderId,
    senderDomains,
    sendingPower.totalDailyCap,
  ]);

  useEffect(() => {
    trackEvent("ops_module_opened", { module: "senders", brandId: brand.id });
  }, [brand.id]);

  useEffect(() => {
    setDomains(brand.domains || []);
  }, [brand.domains]);

  useEffect(() => {
    if (!gmailVerifyOpen || !gmailVerifyAccountId || !gmailVerifySession) return;
    if (gmailVerifySession?.loginState === "ready") return;
    if (gmailVerifySubmitting || gmailVerifyLoading) return;
    const interval = window.setInterval(() => {
      void refreshGmailVerifySession(gmailVerifyAccountId);
    }, 3000);
    return () => {
      window.clearInterval(interval);
    };
  }, [
    gmailVerifyAccountId,
    gmailVerifyLoading,
    gmailVerifyOpen,
    gmailVerifySession?.loginState,
    gmailVerifySubmitting,
  ]);

  async function loadSenderProvisioningModal() {
    setSenderModalLoading(true);
    setSenderModalError("");
    try {
      const [accounts, settings, assignmentResult, brands] = await Promise.all([
        fetchOutreachAccounts(),
        fetchOutreachProvisioningSettings(),
        fetchBrandOutreachAssignment(brand.id),
        fetchBrands(),
      ]);
      setSenderModalAccounts(accounts);
      setSenderModalSettings(settings);
      setSenderModalAssignments(normalizeAssignment(brand.id, assignmentResult.assignment));
      setSenderModalBrands(brands);
    } catch (err) {
      setSenderModalError(err instanceof Error ? err.message : "Failed to load sender setup.");
    } finally {
      setSenderModalLoading(false);
    }
  }

  async function refreshDomainsFromServer() {
    const [refreshedBrand, accounts, assignmentResult] = await Promise.all([
      fetchBrand(brand.id),
      fetchOutreachAccounts(),
      fetchBrandOutreachAssignment(brand.id),
    ]);
    setDomains(refreshedBrand.domains || []);
    setSenderModalAccounts(accounts);
    setSenderModalAssignments(normalizeAssignment(brand.id, assignmentResult.assignment));
    router.refresh();
    return refreshedBrand;
  }

  function updateSenderActionState(rowId: string, patch: Partial<SenderActionState>) {
    setSenderActionState((prev) => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] ?? EMPTY_SENDER_ACTION_STATE),
        ...patch,
      },
    }));
  }

  async function startGmailVerifySession(accountId: string) {
    setGmailVerifyLoading(true);
    setGmailVerifyError("");
    try {
      const snapshot = await advanceOutreachGmailUiSession(accountId, {
        ignoreConfiguredProxy: true,
        refreshMailpoolCredentials: true,
      });
      setGmailVerifySession(snapshot);
      if (snapshot.step !== "awaiting_password") {
        setGmailVerifyPasswordInput("");
      }
    } catch (err) {
      setGmailVerifyError(err instanceof Error ? err.message : "Failed to start Gmail verification.");
      setGmailVerifySession(null);
    } finally {
      setGmailVerifyLoading(false);
    }
  }

  async function refreshGmailVerifySession(accountId: string) {
    if (!accountId) return;
    try {
      const snapshot = await getOutreachGmailUiSession(accountId);
      setGmailVerifySession(snapshot);
      setGmailVerifyError("");
    } catch (err) {
      setGmailVerifyError(err instanceof Error ? err.message : "Failed to refresh Gmail verification state.");
    }
  }

  function openGmailVerifyModal(row: DomainRow, accountId: string) {
    setGmailVerifyRow(row);
    setGmailVerifyAccountId(accountId);
    setGmailVerifyOpen(true);
    setGmailVerifyCheckMessage("");
    setGmailVerifyError("");
    setGmailVerifySession(null);
    setGmailVerifyOtpInput("");
    setGmailVerifyPasswordInput("");
    void startGmailVerifySession(accountId);
  }

  async function recheckGmailVerifiedSender() {
    if (!gmailVerifyAccountId) return;
    setGmailVerifyCheckPending(true);
    setGmailVerifyCheckMessage("");
    setGmailVerifyError("");
    try {
      const result = await testOutreachAccount(gmailVerifyAccountId, "customerio");
      await refreshDomainsFromServer();
      await refreshGmailVerifySession(gmailVerifyAccountId);
      setGmailVerifyCheckMessage(
        result.ok ? "Sender check passed. This sender should now show as ready." : result.message
      );
    } catch (err) {
      setGmailVerifyError(err instanceof Error ? err.message : "Sender check failed.");
    } finally {
      setGmailVerifyCheckPending(false);
    }
  }

  async function submitGmailVerifyInput() {
    if (!gmailVerifyAccountId) return;
    setGmailVerifySubmitting(true);
    setGmailVerifyError("");
    setGmailVerifyCheckMessage("");
    try {
      const snapshot = await advanceOutreachGmailUiSession(gmailVerifyAccountId, {
        otp: gmailVerifyOtpInput,
        password: gmailVerifyPasswordInput,
        ignoreConfiguredProxy: true,
        refreshMailpoolCredentials: false,
      });
      setGmailVerifySession(snapshot);
      setGmailVerifyOtpInput("");
      if (snapshot.step !== "awaiting_password") {
        setGmailVerifyPasswordInput("");
      }
      if (snapshot.loginState === "ready") {
        await recheckGmailVerifiedSender();
      }
    } catch (err) {
      setGmailVerifyError(err instanceof Error ? err.message : "Failed to submit Gmail verification input.");
    } finally {
      setGmailVerifySubmitting(false);
    }
  }

  async function handleSenderAction(row: DomainRow, action: SenderActionPlan) {
    updateSenderActionState(row.id, { pending: true, error: "", success: "" });

    try {
      const resolvedDeliveryAccount = resolveDeliveryAccountForRow(row);
      const resolvedDeliveryAccountId = resolvedDeliveryAccount?.id ?? resolveDeliveryAccountIdForRow(row);
      const canOpenGmailVerify =
        Boolean(row.fromEmail) &&
        row.dnsStatus === "verified" &&
        !isMonitorInboxIssue(row) &&
        resolvedDeliveryAccount?.provider === "mailpool";

      if ((action.kind === "verify_gmail_ui" || action.kind === "open_settings") && canOpenGmailVerify) {
        if (!resolvedDeliveryAccountId) {
          throw new Error("This Gmail UI sender is missing its delivery account link.");
        }
        openGmailVerifyModal(row, resolvedDeliveryAccountId);
        updateSenderActionState(row.id, { pending: false, success: "" });
        return;
      }

      if (action.kind === "verify_gmail_ui") {
        if (!resolvedDeliveryAccountId) {
          throw new Error("This Gmail UI sender is missing its delivery account link.");
        }
        openGmailVerifyModal(row, resolvedDeliveryAccountId);
        updateSenderActionState(row.id, { pending: false, success: "" });
        return;
      }

      if (action.kind === "open_setup") {
        openSenderModal();
        updateSenderActionState(row.id, {
          pending: false,
          success: "Verification opened. Attach the sender mailbox to continue.",
        });
        return;
      }

      if (action.kind === "open_settings") {
        router.push("/settings/outreach");
        updateSenderActionState(row.id, { pending: false, success: "" });
        return;
      }

      if (action.kind === "add_inbox") {
        router.push("/settings/outreach?tab=email&open=mailbox&reason=monitor_pool");
        updateSenderActionState(row.id, { pending: false, success: "" });
        return;
      }

      if (action.kind === "refresh_mailpool") {
        if (!resolvedDeliveryAccountId) {
          throw new Error("This sender is missing its Mailpool account link, so it cannot be refreshed here.");
        }
        await refreshMailpoolOutreachAccount(resolvedDeliveryAccountId);
        await refreshDomainsFromServer();
        updateSenderActionState(row.id, {
          pending: false,
          success: "Verification refreshed. Pulled the latest Mailpool status for this sender.",
        });
        return;
      }

      const fromLocalPart = row.fromEmail?.split("@")[0]?.trim() || "";
      if (!fromLocalPart) {
        throw new Error("This sender does not have a mailbox local-part saved yet. Finish setup manually.");
      }

      const assignmentResult = await fetchBrandOutreachAssignment(brand.id);
      const sourceAccountId = String(row.customerIoAccountId ?? row.deliveryAccountId ?? "").trim();
      const useSavedDefaults =
        row.provider !== "customerio" ||
        !sourceAccountId ||
        getDomainDeliveryAccountName(row).trim().toLowerCase() === "saved defaults";

      const result = await provisionSenderDomain(brand.id, {
        provider: row.provider === "mailpool" ? "mailpool" : "customerio",
        accountName: getDomainDeliveryAccountName(row) || `${brand.name} ${row.domain}`,
        assignToBrand: true,
        selectedMailboxAccountId: row.provider === "mailpool" ? "" : assignmentResult.assignment?.mailboxAccountId ?? "",
        domainMode: "existing",
        domain: row.domain,
        fromLocalPart,
        autoPickCustomerIoAccount: row.provider === "customerio" ? false : undefined,
        customerIoSourceAccountId: row.provider === "customerio" && !useSavedDefaults ? sourceAccountId : "",
        forwardingTargetUrl: row.forwardingTargetUrl || brand.website || "",
        customerIoSiteId: "",
        customerIoTrackingApiKey: "",
        customerIoAppApiKey: "",
        namecheapApiUser: "",
        namecheapUserName: "",
        namecheapApiKey: "",
        namecheapClientIp: "",
      });

      await refreshDomainsFromServer();
      updateSenderActionState(row.id, {
        pending: false,
        success: result.readyToSend
          ? "Verification complete. This sender is ready for traffic."
          : result.warnings[0] || "Verification refreshed. DNS or checks may still need time.",
      });
    } catch (err) {
      updateSenderActionState(row.id, {
        pending: false,
        error: err instanceof Error ? err.message : "Failed to update this sender.",
      });
    }
  }

  function openSenderModal() {
    setSenderModalOpen(true);
    void loadSenderProvisioningModal();
  }

  return (
    <div className="space-y-8">
      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <PageIntro
        title={
          <span className="inline-flex items-center gap-2">
            <span>Senders</span>
            <ExplainableHint
              label="Explain Senders"
              title="What happens here"
            >
              <p>
                This page answers four questions for every sender: can it send, how much can it send today, is it
                healthy, and what needs to happen next.
              </p>
              <p>
                You do not need to decode the internal system states. Read the big labels first, then open the details
                only if something looks wrong.
              </p>
            </ExplainableHint>
          </span>
        }
        actions={
          <Button type="button" onClick={openSenderModal}>
            Add sender
          </Button>
        }
        aside={
          <StatLedger items={ledgerItems} />
        }
      />

      <SectionPanel
        title={
          <span className="inline-flex items-center gap-2">
            <span>At a glance</span>
            <ExplainableHint
              label="Explain sender summary"
              title="What this summary means"
            >
              <p>
                The big card shows what can send right now and what is blocking everything else. The smaller cards tell
                you how much ready volume you have, how many senders are still warming up, and how many need fixing.
              </p>
              <p>
                Only senders marked <span className="font-medium">Can send</span> count toward ready volume today.
              </p>
            </ExplainableHint>
          </span>
        }
        className="border-[color:var(--border-strong)]"
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_repeat(3,minmax(0,0.55fr))]">
          <div className="space-y-3 rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4 md:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  brandReadiness.state === "ready"
                    ? "success"
                    : brandReadiness.state === "provisioning"
                      ? "accent"
                      : brandReadiness.state === "blocked"
                        ? "danger"
                        : "muted"
                }
              >
                Can send now
              </Badge>
              {preferredReadyRoutingSignal ? <RoutingScoreDetails signal={preferredReadyRoutingSignal} /> : null}
              </div>
            <div>
              <div className="text-lg font-semibold text-[color:var(--foreground)]">{brandReadiness.value}</div>
              <div className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                {brandReadiness.detail}
              </div>
            </div>
            <div className="text-sm leading-6 text-[color:var(--foreground)]">
              {brandReadiness.note}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
              <span>
                {readyBackupCount} backup sender{readyBackupCount === 1 ? "" : "s"} ready
              </span>
              <span aria-hidden="true">•</span>
              <span>{blockedRoutingSignals.length} paused</span>
              {provisioningSenders.length ? (
                <>
                  <span aria-hidden="true">•</span>
                  <span>
                    {provisioningSenders.length} sender{provisioningSenders.length === 1 ? "" : "s"} still provisioning
                  </span>
                </>
              ) : null}
              {protectedDestination ? (
                <>
                  <span aria-hidden="true">•</span>
                  <span>Replies land on {protectedDestination.domain}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="rounded-[16px] border border-[color:var(--border)] px-4 py-4 md:px-5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
              Total sending power
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="text-3xl font-semibold text-[color:var(--foreground)]">{sendingPower.totalDailyCap}</div>
              <div className="text-right text-xs text-[color:var(--muted-foreground)]">
                {sendingPower.totalDailyCap
                  ? `${sendingPower.usedToday} used today`
                  : primaryProvisioningSender
                    ? "Pending setup"
                    : "No sender capacity yet"}
              </div>
            </div>
            <div className="mt-3">
              <div className="h-2.5 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
                <div
                  className="h-full rounded-full bg-[color:var(--foreground)] transition-[width] duration-300"
                  style={{
                    width:
                      sendingPower.totalDailyCap > 0 && sendingPower.usedToday > 0
                        ? `${Math.max(6, Math.round(sendingPower.utilization * 100))}%`
                        : "0%",
                  }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-[color:var(--muted-foreground)]">
                <span>{sendingPower.usedToday} used</span>
                <span>{sendingPower.totalDailyCap} total</span>
              </div>
            </div>
            <div className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
              {sendingPower.totalDailyCap
                ? `${formatEmailCount(sendingPower.totalDailyCap)} of enforced daily sending power across ${sendingPower.activeSenders} active sender${sendingPower.activeSenders === 1 ? "" : "s"}. ${formatEmailCount(sendingPower.remaining)} left today.`
                : primaryProvisioningSender
                  ? primaryProvisioningSender.provisioning.etaLabel
                  : "No sender is fully ready yet."}
            </div>
          </div>
          <div className="rounded-[16px] border border-[color:var(--border)] px-4 py-4 md:px-5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Warming up</div>
            <div className="mt-3 text-3xl font-semibold text-[color:var(--foreground)]">{senderSummary.warmingCount}</div>
            <div className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
              {senderSummary.warmingCount
                ? "These senders are building trust before they take normal traffic."
                : "Nothing is in warmup right now."}
            </div>
          </div>
          <div className="rounded-[16px] border border-[color:var(--border)] px-4 py-4 md:px-5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Needs fix</div>
            <div className="mt-3 text-3xl font-semibold text-[color:var(--foreground)]">{senderSummary.fixCount}</div>
            <div className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
              {senderSummary.fixCount
                ? "These senders are paused until you fix setup or health issues."
                : "No sender is blocked right now."}
            </div>
          </div>
        </div>
      </SectionPanel>

      <SectionPanel
        title={
          <span className="inline-flex items-center gap-2">
            <span>All senders</span>
            <ExplainableHint
              label="Explain sender cards"
              title="How to read these cards"
            >
              <p>
                Each card answers four questions in order: can this sender send, how much can it send today, is it
                healthy, and what should happen next.
              </p>
              <p>
                Open the details only when you need the deeper system explanation.
              </p>
            </ExplainableHint>
          </span>
        }
        className="border-[color:var(--border-strong)]"
        actions={
          <Input
            placeholder="Search senders"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full sm:w-[18rem]"
          />
        }
      >
        {filtered.length ? (
          <div className="space-y-3">
            {filtered.map((item) => {
              const account = resolveDeliveryAccountForRow(item);
              const capacity = capacityForRow(item);
              const routingRole = routingRoleForRow(item, routingRoleBySenderId);
              const readiness = readinessForRow(item);
              const status = senderCardStatus(item, routingRole, capacity, readiness);
              const overallHealth = senderOverallHealth(item);
              const provisioning = senderProvisioningSnapshot(item, account);
              const healthDisplay = senderHealthDisplay(item, status, overallHealth, provisioning);
              const today = senderTodaySummary(item, status, provisioning, capacity, readiness);
              const action = senderActionPlan(item, status, overallHealth, provisioning, account, readiness);
              const nextStep =
                action?.label ?? senderNextStep(item, status, overallHealth, provisioning, capacity);
              const healthSignals = senderHealthSignals(item);
              const setupLine = provisioning
                ? `${provisioning.headline} · ${provisioning.etaLabel}`
                : senderSetupLine(item);
              const dailyCap = senderDailyCap(item, capacity);
              const warmupDay = capacity?.warmupDay ?? senderWarmupDay(item.lastProvisionedAt);
              const maxDailyCap = senderMaxDailyCap(capacity);
              const warmupStage = senderWarmupStageLabel(item, capacity);
              const actionState = senderActionState[item.id] ?? EMPTY_SENDER_ACTION_STATE;
              const statusHeading = status === "fix" || status === "setup" ? "Issue" : "Status";
              const nextStepHeading = action ? "Verify" : "Next step";

              return (
                <article
                  key={item.id}
                  className="rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-4 md:px-5 md:py-5"
                >
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 xl:max-w-[26rem]">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={senderCardStatusVariant(status)}>{senderCardStatusLabel(status)}</Badge>
                        <Badge variant={senderRouteVariant(status, routingRole)}>
                          {senderRouteLabel(routingRole, item, status, overallHealth, provisioning, capacity, readiness)}
                        </Badge>
                        <Badge variant={healthDisplay.variant}>{healthDisplay.badgeLabel}</Badge>
                      </div>
                      <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">{item.domain}</div>
                      <div className="mt-1 text-sm text-[color:var(--foreground)]">{item.fromEmail || "Mailbox pending"}</div>
                      {setupLine ? (
                        <div className="mt-2 text-xs leading-5 text-[color:var(--muted-foreground)]">{setupLine}</div>
                      ) : null}
                      <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                        {item.replyMailboxEmail
                          ? `Replies go to ${item.replyMailboxEmail}`
                          : "Replies show up after the sender mailbox is attached."}
                      </div>
                    </div>

                    <div className="grid flex-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                      <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">Today</div>
                        <div className="mt-2 text-2xl font-semibold text-[color:var(--foreground)]">{today.value}</div>
                        <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">{today.detail}</div>
                      </div>
                      <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">Health</div>
                        <div className="mt-2 text-xl font-semibold text-[color:var(--foreground)]">{healthDisplay.cardLabel}</div>
                        <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">{healthDisplay.detail}</div>
                      </div>
                      <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">{statusHeading}</div>
                        <div className="mt-2 text-xl font-semibold text-[color:var(--foreground)]">
                          {senderRouteLabel(routingRole, item, status, overallHealth, provisioning, capacity, readiness)}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                          {senderRouteDetail(routingRole, item, status, overallHealth, provisioning, capacity, readiness)}
                        </div>
                      </div>
                      <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">{nextStepHeading}</div>
                        <div className="mt-2 text-xl font-semibold text-[color:var(--foreground)]">{nextStep}</div>
                        <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                          {action?.description ?? automationTimingLabel(item)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-[color:var(--foreground)]">
                    {senderSummaryLine(item, status, routingRole, overallHealth, provisioning, capacity, readiness)}
                  </p>

                  {action ? (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          action.kind === "open_settings"
                            ? "outline"
                            : action.kind === "add_inbox"
                              ? "default"
                              : status === "fix"
                                ? "danger"
                                : "default"
                        }
                        onClick={() => void handleSenderAction(item, action)}
                        disabled={actionState.pending}
                      >
                        {actionState.pending ? "Working..." : action.label}
                      </Button>
                      <div className="text-sm text-[color:var(--muted-foreground)]">{action.description}</div>
                    </div>
                  ) : null}

                  {actionState.error ? (
                    <div className="mt-3 rounded-[12px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-3 py-2 text-sm text-[color:var(--danger)]">
                      {actionState.error}
                    </div>
                  ) : null}

                  {actionState.success ? (
                    <div className="mt-3 rounded-[12px] border border-[color:var(--success-border)] bg-[color:var(--success-soft)] px-3 py-2 text-sm text-[color:var(--success)]">
                      {actionState.success}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {healthSignals.map(([label, value]) => (
                      <div
                        key={label}
                        className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-1.5"
                      >
                        <span className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
                          {label}
                        </span>
                        <Badge variant={healthBadgeVariant(value)}>{friendlyHealthLabel(value)}</Badge>
                      </div>
                    ))}
                    <ExplainableHint
                      label={`Explain sender status for ${item.domain}`}
                      title={`${item.domain} details`}
                      align="right"
                    >
                      <p>
                        <span className="font-medium">What this means:</span> {automationSummary(item)}
                      </p>
                      {healthSignals.map(([label, , summary]) => (
                        <p key={label}>
                          <span className="font-medium">{label}:</span> {summary}
                        </p>
                      ))}
                      <p>
                        <span className="font-medium">Warmup:</span> {warmupStage}.
                      </p>
                      <p>
                        <span className="font-medium">Current cap:</span>{" "}
                        {dailyCap ? `${formatEmailCount(dailyCap)} on warmup day ${warmupDay}.` : "No sending cap yet."}
                      </p>
                      <p>
                        <span className="font-medium">Max eventual cap:</span>{" "}
                        {maxDailyCap ? `${formatEmailCount(maxDailyCap)} after warmup completes.` : "Not set."}
                      </p>
                    </ExplainableHint>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-6 text-sm text-[color:var(--muted-foreground)]">
            {senderDomains.length
              ? "No senders match the current filter."
              : "No senders yet. Add one to start setup, DNS checks, warmup, and sending."}
          </div>
        )}
      </SectionPanel>

      <SettingsModal
        open={senderModalOpen}
        onOpenChange={(open) => {
          setSenderModalOpen(open);
          if (!open) setSenderModalError("");
        }}
        title="Add sender"
        description="Buy or attach a sender domain, provision the mailbox, and assign it to this brand."
        panelClassName="max-w-6xl"
        bodyClassName="p-0"
      >
        <div className="p-5 md:p-6">
          {senderModalLoading ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-6 text-sm text-[color:var(--muted-foreground)]">
              Loading sender setup...
            </div>
          ) : senderModalError ? (
            <div className="rounded-xl border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-6 text-sm text-[color:var(--danger)]">
              {senderModalError}
            </div>
          ) : senderModalSettings ? (
            <SenderProvisionCard
              embedded
              brands={modalBrands}
              allBrands={modalAllBrands}
              mailboxAccounts={mailboxAccounts}
              customerIoAccounts={deliveryAccounts}
              assignments={senderModalAssignments}
              provisioningSettings={senderModalSettings}
              onProvisioned={(result) => {
                void (async () => {
                  try {
                    await refreshDomainsFromServer();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to refresh senders.");
                  }
                })();
                if (result.readyToSend) {
                  setSenderModalOpen(false);
                }
              }}
            />
          ) : null}
        </div>
      </SettingsModal>

      <SettingsModal
        open={gmailVerifyOpen}
        onOpenChange={(open) => {
          setGmailVerifyOpen(open);
          if (!open) {
            const closingAccountId = gmailVerifyAccountId;
            setGmailVerifyError("");
            setGmailVerifyCheckMessage("");
            setGmailVerifyOtpInput("");
            setGmailVerifyPasswordInput("");
            setGmailVerifySession(null);
            setGmailVerifyRow(null);
            setGmailVerifyAccountId("");
            if (closingAccountId) {
              void closeOutreachGmailUiSession(closingAccountId).catch(() => {});
            }
          }
        }}
        title={gmailVerifyRow?.fromEmail ? `Verify ${gmailVerifyRow.fromEmail}` : "Verify sender"}
        description="Enter the current code when Google asks for it. lastb2b will drive the live Gmail worker session and verify when the inbox is ready."
        panelClassName="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4 text-sm leading-6 text-[color:var(--foreground)]">
            <div className="font-medium">Live worker status</div>
            <div className="mt-2">
              {gmailVerifySession?.prompt ||
                `Opening Gmail for ${gmailVerifyRow?.fromEmail || "this sender"} and moving it to the next login step.`}
            </div>
            {gmailVerifySession ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[color:var(--muted-foreground)]">
                <span>Step: {gmailVerifySession.step.replaceAll("_", " ")}</span>
                <span>Checked {formatRelativeTimeLabel(gmailVerifySession.updatedAt, "just now")}</span>
              </div>
            ) : null}
          </div>

          {gmailVerifyLoading && !gmailVerifySession ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-6 text-sm text-[color:var(--muted-foreground)]">
              Opening the Gmail worker session...
            </div>
          ) : null}

          {gmailVerifyError ? (
            <div className="rounded-xl border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-4 text-sm text-[color:var(--danger)]">
              {gmailVerifyError}
            </div>
          ) : null}

          {gmailVerifySession?.step === "awaiting_password" ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                Password
              </div>
              <Input
                type="password"
                value={gmailVerifyPasswordInput}
                onChange={(event) => setGmailVerifyPasswordInput(event.target.value)}
                placeholder="Enter the Gmail password if Google still needs it"
                className="mt-3"
              />
            </div>
          ) : null}

          {gmailVerifySession?.step === "awaiting_otp" ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                One-time code
              </div>
              <Input
                value={gmailVerifyOtpInput}
                onChange={(event) => setGmailVerifyOtpInput(event.target.value)}
                placeholder="Enter the current Google code for this sender"
                inputMode="numeric"
                className="mt-3 font-mono"
              />
            </div>
          ) : null}

          {gmailVerifySession?.loginState === "ready" ? (
            <div className="rounded-xl border border-[color:var(--success-border)] bg-[color:var(--success-soft)] px-4 py-4 text-sm text-[color:var(--success)]">
              Gmail inbox confirmed. Refreshing sender readiness will mark this sender ready if everything else is healthy.
            </div>
          ) : null}

          {gmailVerifySession?.currentUrl ? (
            <details className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4">
              <summary className="cursor-pointer text-sm font-medium text-[color:var(--foreground)]">
                Worker details
              </summary>
              <div className="mt-3 space-y-2 text-sm text-[color:var(--muted-foreground)]">
                <div>Page title: {gmailVerifySession.title || "Unknown"}</div>
                <div className="break-all">Current URL: {gmailVerifySession.currentUrl}</div>
              </div>
            </details>
          ) : null}

          {gmailVerifyCheckMessage ? (
            <div className="rounded-xl border border-[color:var(--success-border)] bg-[color:var(--success-soft)] px-4 py-4 text-sm text-[color:var(--success)]">
              {gmailVerifyCheckMessage}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void (gmailVerifySession
                ? refreshGmailVerifySession(gmailVerifyAccountId)
                : startGmailVerifySession(gmailVerifyAccountId))
            }
            disabled={gmailVerifyLoading || gmailVerifySubmitting || !gmailVerifyAccountId}
          >
            Refresh status
          </Button>
          {(gmailVerifySession?.step === "awaiting_password" || gmailVerifySession?.step === "awaiting_otp") ? (
            <Button
              type="button"
              onClick={() => void submitGmailVerifyInput()}
              disabled={
                gmailVerifySubmitting ||
                gmailVerifyLoading ||
                !gmailVerifyAccountId ||
                (gmailVerifySession?.step === "awaiting_password"
                  ? !gmailVerifyPasswordInput.trim()
                  : !gmailVerifyOtpInput.trim())
              }
            >
              {gmailVerifySubmitting
                ? "Submitting..."
                : gmailVerifySession?.step === "awaiting_password"
                  ? "Submit password"
                  : "Submit code"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => void recheckGmailVerifiedSender()}
            disabled={
              gmailVerifyCheckPending ||
              gmailVerifyLoading ||
              gmailVerifySubmitting ||
              !gmailVerifyAccountId ||
              gmailVerifySession?.loginState !== "ready"
            }
          >
            {gmailVerifyCheckPending ? "Checking..." : "Verify sender"}
          </Button>
        </div>
      </SettingsModal>
    </div>
  );
}
