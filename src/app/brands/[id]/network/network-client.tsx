"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SenderProvisionCard from "@/app/settings/outreach/sender-provision-card";
import { SettingsModal } from "@/app/settings/outreach/settings-primitives";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  fetchBrand,
  fetchBrandOutreachAssignment,
  fetchBrands,
  fetchOutreachAccounts,
  fetchOutreachProvisioningSettings,
  provisionSenderDomain,
  refreshMailpoolOutreachAccount,
} from "@/lib/client-api";
import {
  buildSenderRoutingSignalFromDomainRow,
  rankSenderRoutingSignals,
  summarizeSenderRoutingScore,
  type SenderRoutingSignals,
} from "@/lib/sender-routing";
import { getDomainDeliveryAccountId, getDomainDeliveryAccountName } from "@/lib/outreach-account-helpers";
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

const DAY_MS = 24 * 60 * 60 * 1000;
const FILTERS = ["all", "queued", "warming", "attention", "ready"] as const;

type SenderFilter = (typeof FILTERS)[number];
type RoutingRole = "primary" | "standby" | "blocked" | "pending";
type SenderCardStatus = "ready" | "warming" | "setup" | "fix" | "protected";
type SenderHealthTone = "good" | "watch" | "checking" | "problem";
type SenderActionKind = "repair_setup" | "refresh_mailpool" | "open_setup" | "open_settings" | "add_inbox";
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
  senderCapacitySnapshots?: unknown[];
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

function senderWarmupDay(value?: string) {
  if (!value) return 1;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 1;
  const startDay = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  const today = new Date();
  const todayDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.max(1, Math.floor((todayDay - startDay) / DAY_MS) + 1);
}

function senderDailyCap(row: DomainRow) {
  if (row.role === "brand" || !row.fromEmail) return 0;
  return Math.max(15, Math.min(120, senderWarmupDay(row.lastProvisionedAt) * 15));
}

function derivedAutomationStatus(row: DomainRow): NonNullable<DomainRow["automationStatus"]> {
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

function filterBucket(row: DomainRow): Exclude<SenderFilter, "all"> {
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

function senderCardStatus(row: DomainRow, routingRole: RoutingRole): SenderCardStatus {
  const automationStatus = derivedAutomationStatus(row);
  if (row.role === "brand") return "protected";
  if (automationStatus === "attention" || routingRole === "blocked" || row.status === "risky") return "fix";
  if (!row.fromEmail || automationStatus === "testing" || automationStatus === "queued") return "setup";
  if (automationStatus === "warming") return "warming";
  return "ready";
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
  health: SenderHealthTone
) {
  if (status === "protected") return "Replies only";
  if (status === "fix") {
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
  health: SenderHealthTone
) {
  if (status === "protected") return "Reply inbox only";
  if (status === "fix") {
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
  health: SenderHealthTone
): { badgeLabel: string; cardLabel: string; detail: string; variant: SenderBadgeVariant } {
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

function senderTodaySummary(row: DomainRow, status: SenderCardStatus) {
  const cap = senderDailyCap(row);
  if (status === "protected") {
    return { value: "-", detail: "not a sender" };
  }
  if (status === "fix") {
    return { value: "0", detail: "paused today" };
  }
  if (status === "setup") {
    return { value: "0", detail: "not ready yet" };
  }
  if (status === "warming") {
    return { value: String(cap), detail: "warmup cap" };
  }
  return { value: String(cap), detail: "emails today" };
}

function senderNextStep(row: DomainRow, status: SenderCardStatus, health: SenderHealthTone) {
  if (status === "protected") return "Replies land here";
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
  health: SenderHealthTone
): SenderActionPlan | null {
  if (status === "protected" || status === "ready") return null;
  if (!row.fromEmail) {
    return {
      kind: "open_setup",
      label: "Finish setup",
      description: "Open sender setup and attach the missing sender mailbox.",
    };
  }
  if (row.provider === "mailpool" && row.dnsStatus !== "verified") {
    return {
      kind: "refresh_mailpool",
      label: "Refresh status",
      description: "Pull the latest domain and mailbox state from Mailpool.",
    };
  }
  if (row.dnsStatus === "error") {
    return {
      kind: "repair_setup",
      label: "Repair setup",
      description: "Re-apply sender DNS, forwarding, and account setup for this domain.",
    };
  }
  if (row.dnsStatus !== "verified") {
    return {
      kind: "repair_setup",
      label: "Re-run setup",
      description: "Re-apply sender DNS and forwarding while this domain finishes verifying.",
    };
  }
  if (isMonitorInboxIssue(row)) {
    return {
      kind: "add_inbox",
      label: "Add inbox",
      description: "Add 1 more reply inbox. We will open the right screen with the form already open.",
    };
  }
  if (status === "fix" || health === "problem") {
    return {
      kind: "open_settings",
      label: "Open outreach settings",
      description: "Review deliverability settings and the sender inputs driving health checks.",
    };
  }
  return null;
}

function senderSummaryLine(
  row: DomainRow,
  status: SenderCardStatus,
  routingRole: RoutingRole,
  health: SenderHealthTone
) {
  if (status === "protected") {
    return "This is your protected reply domain. It catches replies but does not send outbound mail.";
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
  const senderDomains = useMemo(() => domains.filter((item) => item.role !== "brand"), [domains]);
  const protectedDestination = useMemo(() => domains.find((item) => item.role === "brand") ?? null, [domains]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return senderDomains.filter((item) => {
      if (statusFilter !== "all" && filterBucket(item) !== statusFilter) return false;
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
  }, [query, senderDomains, statusFilter]);

  const ledgerItems = useMemo(
    () =>
      FILTERS.map((filter) => ({
        label: filterLabel(filter),
        value: formatCount(
          filter === "all" ? senderDomains.length : senderDomains.filter((item) => filterBucket(item) === filter).length
        ),
        active: statusFilter === filter,
        onClick: () => setStatusFilter(filter),
      })),
    [senderDomains, statusFilter]
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
    () => rankedRoutingSignals.find((signal) => signal.automationStatus !== "attention") ?? null,
    [rankedRoutingSignals]
  );
  const routingRoleBySenderId = useMemo(() => {
    const next = new Map<string, "primary" | "standby" | "blocked" | "pending">();
    for (const signal of rankedRoutingSignals) {
      if (signal.automationStatus === "attention") {
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
  }, [rankedRoutingSignals, preferredRoutingSignal]);
  const blockedRoutingSignals = useMemo(
    () => rankedRoutingSignals.filter((signal) => signal.automationStatus === "attention"),
    [rankedRoutingSignals]
  );
  const senderSummary = useMemo(
    () =>
      senderDomains.reduce(
        (summary, row) => {
          const routingRole = routingRoleForRow(row, routingRoleBySenderId);
          const status = senderCardStatus(row, routingRole);
          const health = senderOverallHealth(row);
          const action = senderActionPlan(row, status, health);

          if (status === "ready") {
            summary.readyCount += 1;
            summary.readyCapacity += senderDailyCap(row);
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
          if (action && action.kind !== "open_settings") {
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
    [senderDomains, routingRoleBySenderId]
  );
  const preferredReadyRoutingSignal = useMemo(() => {
    if (!preferredRoutingSignal) return null;
    const row =
      senderDomains.find((item) => getDomainDeliveryAccountId(item) === preferredRoutingSignal.senderAccountId) ?? null;
    if (!row) return null;
    const status = senderCardStatus(row, routingRoleForRow(row, routingRoleBySenderId));
    return status === "ready" ? preferredRoutingSignal : null;
  }, [preferredRoutingSignal, routingRoleBySenderId, senderDomains]);
  const readyBackupCount = Math.max(0, senderSummary.readyCount - (preferredReadyRoutingSignal ? 1 : 0));

  useEffect(() => {
    trackEvent("ops_module_opened", { module: "senders", brandId: brand.id });
  }, [brand.id]);

  useEffect(() => {
    setDomains(brand.domains || []);
  }, [brand.domains]);

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
    const refreshedBrand = await fetchBrand(brand.id);
    setDomains(refreshedBrand.domains || []);
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

  async function handleSenderAction(row: DomainRow, action: SenderActionPlan) {
    updateSenderActionState(row.id, { pending: true, error: "", success: "" });

    try {
      if (action.kind === "open_setup") {
        openSenderModal();
        updateSenderActionState(row.id, {
          pending: false,
          success: "Sender setup opened. Use the same domain to finish attaching the mailbox.",
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
        const accountId = getDomainDeliveryAccountId(row);
        if (!accountId) {
          throw new Error("This sender is missing its Mailpool account link, so it cannot be refreshed here.");
        }
        await refreshMailpoolOutreachAccount(accountId);
        await refreshDomainsFromServer();
        updateSenderActionState(row.id, {
          pending: false,
          success: "Pulled the latest Mailpool status for this sender.",
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
          ? "Setup repaired. This sender is ready for traffic."
          : result.warnings[0] || "Setup refreshed. DNS or checks may still need time.",
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
              <Badge variant={preferredReadyRoutingSignal ? "success" : senderSummary.autoFixCount ? "accent" : "muted"}>
                {preferredReadyRoutingSignal
                  ? "Sending now"
                  : senderSummary.autoFixCount
                    ? "Fixes available"
                    : "Nobody ready yet"}
              </Badge>
              {preferredReadyRoutingSignal ? <RoutingScoreDetails signal={preferredReadyRoutingSignal} /> : null}
            </div>
            <div>
              <div className="text-lg font-semibold text-[color:var(--foreground)]">
                {preferredReadyRoutingSignal?.fromEmail || "0 senders can send right now"}
              </div>
              <div className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                {preferredReadyRoutingSignal
                  ? `${preferredReadyRoutingSignal.senderAccountName} · ${preferredReadyRoutingSignal.domain}`
                  : [
                      senderSummary.dnsWaitingCount
                        ? `${senderSummary.dnsWaitingCount} waiting on DNS`
                        : "",
                      senderSummary.mailboxMissingCount
                        ? `${senderSummary.mailboxMissingCount} missing a mailbox`
                        : "",
                      senderSummary.fixCount ? `${senderSummary.fixCount} paused` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Finish setup and the healthiest sender will show up here automatically."}
              </div>
            </div>
            <div className="text-sm leading-6 text-[color:var(--foreground)]">
              {preferredReadyRoutingSignal
                ? "This sender is first in line right now. If it slips, the system moves traffic to a healthy backup."
                : senderSummary.autoFixCount
                  ? "Use the fix buttons on the sender cards below. Setup problems can be repaired here without leaving the page."
                  : "Use the cards below to see which senders are ready, which ones are warming up, and which ones need a fix."}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
              <span>
                {readyBackupCount} backup sender{readyBackupCount === 1 ? "" : "s"} ready
              </span>
              <span aria-hidden="true">•</span>
              <span>{blockedRoutingSignals.length} paused</span>
              {protectedDestination ? (
                <>
                  <span aria-hidden="true">•</span>
                  <span>Replies land on {protectedDestination.domain}</span>
                </>
              ) : null}
            </div>
          </div>
          <div className="rounded-[16px] border border-[color:var(--border)] px-4 py-4 md:px-5">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">Ready today</div>
            <div className="mt-3 text-3xl font-semibold text-[color:var(--foreground)]">{senderSummary.readyCapacity}</div>
            <div className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
              {senderSummary.readyCount
                ? `${formatEmailCount(senderSummary.readyCapacity)} across ${senderSummary.readyCount} sender${senderSummary.readyCount === 1 ? "" : "s"}.`
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
              const routingRole = routingRoleForRow(item, routingRoleBySenderId);
              const status = senderCardStatus(item, routingRole);
              const overallHealth = senderOverallHealth(item);
              const healthDisplay = senderHealthDisplay(item, status, overallHealth);
              const today = senderTodaySummary(item, status);
              const action = senderActionPlan(item, status, overallHealth);
              const nextStep = action?.label ?? senderNextStep(item, status, overallHealth);
              const healthSignals = senderHealthSignals(item);
              const setupLine = senderSetupLine(item);
              const dailyCap = senderDailyCap(item);
              const warmupDay = senderWarmupDay(item.lastProvisionedAt);
              const actionState = senderActionState[item.id] ?? EMPTY_SENDER_ACTION_STATE;
              const statusHeading = status === "fix" || status === "setup" ? "Issue" : "Status";
              const nextStepHeading = action ? "Fix" : "Next step";

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
                          {senderRouteLabel(routingRole, item, status, overallHealth)}
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
                          {senderRouteLabel(routingRole, item, status, overallHealth)}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                          {senderRouteDetail(routingRole, item, status, overallHealth)}
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
                    {senderSummaryLine(item, status, routingRole, overallHealth)}
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
                        <span className="font-medium">Warmup:</span> {item.warmupStage || "Warmup not started"}.
                      </p>
                      <p>
                        <span className="font-medium">Daily cap:</span>{" "}
                        {dailyCap ? `${formatEmailCount(dailyCap)} on warmup day ${warmupDay}.` : "No sending cap yet."}
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
    </div>
  );
}
