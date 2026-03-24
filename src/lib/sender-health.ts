import type {
  BrandRecord,
  DeliverabilityProbeRun,
  DeliverabilitySeedReservation,
  DeliverabilityDomainHealth,
  DomainRow,
  OutreachAccount,
} from "@/lib/factory-types";
import {
  listDeliverabilityProbeRuns,
  listDeliverabilitySeedReservations,
  listOutreachAccounts,
} from "@/lib/outreach-data";
import { getDomainDeliveryAccountId, getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import { getOutreachProvisioningSettings } from "@/lib/outreach-provider-settings";

const HEALTH_WINDOW_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAILPOOL_SPAM_FALLBACK_MAX_AGE_DAYS = 7;
const MONITOR_POOL_UNAVAILABLE_REASONS = [
  "No unused deliverability monitor mailbox remains for this sender",
  "No dedicated deliverability monitor group is connected",
] as const;

type HealthLabel = NonNullable<DomainRow["domainHealth"]>;
export type SenderHealthDimension = "domain" | "email" | "transport" | "message";
export type SenderHealthGateIssue = {
  dimension: SenderHealthDimension;
  status: HealthLabel;
  summary: string;
};

type ProbeObservation = {
  senderKey: string;
  senderAccountId: string;
  fromEmail: string;
  senderDomain: string;
  transportKey: string;
  variant: DeliverabilityProbeRun["probeVariant"];
  contentHash: string;
  score: number;
  totalMonitors: number;
  summaryText: string;
  createdAt: string;
};

type MailpoolSpamFallback = {
  status: HealthLabel;
  score: number;
  checkedAt: string;
  summary: string;
};

type HealthSignal = {
  status: HealthLabel;
  summary: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function toDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0);
  }
  return parsed;
}

function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function worseHealth(left: HealthLabel, right: HealthLabel) {
  const rank = (value: HealthLabel) => {
    if (value === "risky") return 4;
    if (value === "watch") return 3;
    if (value === "healthy") return 2;
    if (value === "queued") return 1;
    return 0;
  };
  return rank(left) >= rank(right) ? left : right;
}

function healthFromScore(score: number): HealthLabel {
  if (score >= 0.84) return "healthy";
  if (score >= 0.6) return "watch";
  return "risky";
}

function postmasterToHealth(status: DeliverabilityDomainHealth["status"]): HealthLabel {
  if (status === "healthy") return "healthy";
  if (status === "warning") return "watch";
  if (status === "critical") return "risky";
  return "unknown";
}

function averageScore(rows: ProbeObservation[]) {
  if (!rows.length) return null;
  return rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
}

function normalizeCounts(payload: Record<string, unknown>) {
  const countsRecord = asRecord(payload.counts);
  const counts = {
    inbox: asNumber(countsRecord.inbox),
    spam: asNumber(countsRecord.spam),
    allMailOnly: asNumber(countsRecord.all_mail_only),
    notFound: asNumber(countsRecord.not_found),
    error: asNumber(countsRecord.error),
  };
  let total = asNumber(payload.totalMonitors);
  if (total <= 0) {
    total = counts.inbox + counts.spam + counts.allMailOnly + counts.notFound + counts.error;
  }
  return { counts, total };
}

function scorePlacement(payload: Record<string, unknown>) {
  const { counts, total } = normalizeCounts(payload);
  if (total <= 0) return null;
  const weighted =
    counts.inbox * 1 +
    counts.allMailOnly * 0.65 +
    counts.notFound * 0.3 +
    counts.error * 0.15;
  return Math.max(0, Math.min(1, weighted / total));
}

function transportKeyForAccount(account: OutreachAccount | null, senderAccountId: string, fromEmail: string) {
  const siteId = account?.config.customerIo.siteId.trim() ?? "";
  return siteId || senderAccountId || fromEmail;
}

function parseProbeObservation(
  probeRun: DeliverabilityProbeRun,
  accountsById: Map<string, OutreachAccount>,
  accountIdByFromEmail: Map<string, string>
): ProbeObservation | null {
  if (probeRun.status !== "completed") return null;
  const senderAccountId = probeRun.senderAccountId.trim();
  const payloadFromEmail = probeRun.fromEmail.trim().toLowerCase();
  const resolvedAccountId =
    senderAccountId || (payloadFromEmail ? accountIdByFromEmail.get(payloadFromEmail) ?? "" : "");
  const account = resolvedAccountId ? accountsById.get(resolvedAccountId) ?? null : null;
  const fromEmail = payloadFromEmail || getOutreachAccountFromEmail(account).trim().toLowerCase() || "";
  const senderDomain = normalizeDomain(fromEmail.split("@")[1] ?? "");
  if (!fromEmail || !senderDomain) return null;
  const score = scorePlacement({ counts: probeRun.counts, totalMonitors: probeRun.totalMonitors });
  if (score === null) return null;
  const totalMonitors = Math.max(0, probeRun.totalMonitors);
  return {
    senderKey: fromEmail,
    senderAccountId: resolvedAccountId,
    fromEmail,
    senderDomain,
    transportKey: transportKeyForAccount(account, resolvedAccountId, fromEmail),
    variant: probeRun.probeVariant,
    contentHash: probeRun.contentHash.trim(),
    score,
    totalMonitors,
    summaryText: probeRun.summaryText.trim() || "No monitor summary",
    createdAt: probeRun.completedAt.trim() || probeRun.updatedAt || probeRun.createdAt,
  };
}

function parseSeedPolicyBySender(input: {
  reservations: DeliverabilitySeedReservation[];
}) {
  const latestBySender = new Map<string, DomainRow["seedPolicy"]>();
  for (const reservation of input.reservations) {
    const fromEmail = reservation.fromEmail.trim().toLowerCase();
    if (!fromEmail || latestBySender.has(fromEmail)) continue;
    if (reservation.status === "consumed" || reservation.status === "reserved") {
      latestBySender.set(fromEmail, "rotating_pool");
    }
  }
  return latestBySender;
}

function isMonitorPoolUnavailableReason(reason: string) {
  return MONITOR_POOL_UNAVAILABLE_REASONS.includes(
    reason as (typeof MONITOR_POOL_UNAVAILABLE_REASONS)[number]
  );
}

function readMailpoolSpamFallback(
  account: OutreachAccount | null,
  automation: SenderAutomationContext,
  now: Date
): MailpoolSpamFallback | null {
  const latestFailure = latestProbeFailureReason(automation.latestProbe);
  if (!isMonitorPoolUnavailableReason(latestFailure)) return null;
  if (!account) return null;

  const checkedAt = account.config.mailpool.lastSpamCheckAt.trim();
  const score = Math.max(0, Math.min(100, Number(account.config.mailpool.lastSpamCheckScore ?? 0) || 0));
  if (!checkedAt || score <= 0) return null;

  const checkedDate = toDate(checkedAt);
  if (checkedDate.getTime() <= 0) return null;
  if (now.getTime() - checkedDate.getTime() > MAILPOOL_SPAM_FALLBACK_MAX_AGE_DAYS * DAY_MS) return null;

  return {
    status: healthFromScore(score / 100),
    score,
    checkedAt,
    summary: account.config.mailpool.lastSpamCheckSummary.trim() || `Mailpool spam check scored ${score}/100.`,
  };
}

function buildMailpoolSpamFallbackSignal(input: {
  dimension: SenderHealthDimension;
  fallback: MailpoolSpamFallback;
}): HealthSignal {
  const label =
    input.dimension === "domain"
      ? "domain"
      : input.dimension === "email"
        ? "mailbox"
        : input.dimension === "transport"
          ? "route"
          : "message";
  const tail =
    input.fallback.status === "risky"
      ? "Treat this sender as risky until a stronger check improves it."
      : input.fallback.status === "watch"
        ? "Good enough to keep sending carefully while richer placement checks are unavailable."
        : "Good enough to keep sending while richer placement checks are unavailable.";

  return {
    status: input.fallback.status,
    summary: `Mailpool spam check ${input.fallback.score}/100. Using that as the best available ${label} health signal because inbox placement checks were unavailable. ${tail}`,
  };
}

function fallbackSignal(
  row: DomainRow,
  dimension: "domain" | "email" | "transport" | "message"
): HealthSignal {
  if (dimension === "domain") {
    const status = row.domainHealth ?? (row.role === "brand" ? "healthy" : row.dnsStatus === "verified" ? "queued" : "unknown");
    const summary =
      row.domainHealthSummary ||
      (row.role === "brand"
        ? "Protected destination domain. Domain reputation is watched separately from sender mailboxes."
        : "Awaiting control probes to isolate domain health from mailbox, route, and message effects.");
    return { status, summary };
  }
  if (dimension === "email") {
    const status = row.emailHealth ?? (row.fromEmail ? "queued" : "unknown");
    return {
      status,
      summary:
        row.emailHealthSummary ||
        (row.fromEmail
          ? "Awaiting mailbox-specific control probes."
          : "Mailbox-specific health starts when a sender mailbox is attached."),
    };
  }
  if (dimension === "transport") {
    const status = row.ipHealth ?? (row.fromEmail ? "queued" : "unknown");
    return {
      status,
      summary:
        row.ipHealthSummary ||
        (row.fromEmail
          ? "Awaiting route-level control probes across senders on the same delivery route."
          : "Transport health starts when a sender mailbox is attached."),
    };
  }
  const status = row.messagingHealth ?? (row.fromEmail ? "queued" : "unknown");
  return {
    status,
    summary:
      row.messagingHealthSummary ||
      (row.fromEmail
        ? "Awaiting both control and live-content probes before message risk can be isolated."
        : "Message health starts when a sender mailbox and a real message both exist."),
  };
}

function buildTransportSignal(
  row: DomainRow,
  transportBaselines: ProbeObservation[],
  mailpoolSpamFallback: MailpoolSpamFallback | null
): HealthSignal {
  if (row.role === "brand") {
    return {
      status: "unknown",
      summary: "Protected destination domains do not send mail through a sender route.",
    };
  }
  if (!transportBaselines.length) {
    if (mailpoolSpamFallback) {
      return buildMailpoolSpamFallbackSignal({
        dimension: "transport",
        fallback: mailpoolSpamFallback,
      });
    }
    return fallbackSignal(row, "transport");
  }
  const score = averageScore(transportBaselines) ?? 0;
  const status = healthFromScore(score);
  const summary = [
    `Control placement ${formatPercent(score)} across ${transportBaselines.length} sender ${
      transportBaselines.length === 1 ? "mailbox" : "mailboxes"
    } on the shared delivery route.`,
    status === "risky"
      ? "Infrastructure looks weak before message content is considered."
      : status === "watch"
        ? "The route is usable but not yet comfortably healthy."
        : "The shared route is holding up under control probes.",
  ].join(" ");
  return { status, summary };
}

function buildDomainSignal(input: {
  row: DomainRow;
  domainBaselines: ProbeObservation[];
  transportPeerBaselines: ProbeObservation[];
  postmasterSnapshot: DeliverabilityDomainHealth | null;
  mailpoolSpamFallback: MailpoolSpamFallback | null;
}) {
  if (!input.domainBaselines.length && !input.postmasterSnapshot) {
    if (input.mailpoolSpamFallback) {
      return buildMailpoolSpamFallbackSignal({
        dimension: "domain",
        fallback: input.mailpoolSpamFallback,
      });
    }
    return fallbackSignal(input.row, "domain");
  }

  let status: HealthLabel = input.domainBaselines.length
    ? healthFromScore(averageScore(input.domainBaselines) ?? 0)
    : "unknown";
  const pieces: string[] = [];

  if (input.domainBaselines.length) {
    const domainScore = averageScore(input.domainBaselines) ?? 0;
    pieces.push(
      `Control placement ${formatPercent(domainScore)} across ${input.domainBaselines.length} sender ${
        input.domainBaselines.length === 1 ? "mailbox" : "mailboxes"
      } on ${input.row.domain}.`
    );
    const transportPeerScore = averageScore(input.transportPeerBaselines);
    if (transportPeerScore !== null) {
      const delta = domainScore - transportPeerScore;
      if (delta <= -0.18) {
        status = worseHealth(status, "risky");
        pieces.push(`This domain trails other domains on the same route by ${formatPercent(-delta)}.`);
      } else if (delta <= -0.08) {
        status = worseHealth(status, "watch");
        pieces.push(`This domain is lagging peer domains on the same route.`);
      } else if (transportPeerScore < 0.6) {
        status = "healthy";
        pieces.push("This domain is tracking a weak shared route, so the route looks like the main issue.");
      }
    }
  }

  if (input.postmasterSnapshot) {
    const snapshotStatus = postmasterToHealth(input.postmasterSnapshot.status);
    status = worseHealth(status, snapshotStatus);
    pieces.push(`Google Postmaster: ${input.postmasterSnapshot.summary}.`);
  }

  return {
    status,
    summary: pieces.join(" "),
  } satisfies HealthSignal;
}

function buildEmailSignal(input: {
  row: DomainRow;
  baseline: ProbeObservation | null;
  domainPeerBaselines: ProbeObservation[];
  transportPeerBaselines: ProbeObservation[];
  mailpoolSpamFallback: MailpoolSpamFallback | null;
}) {
  if (!input.row.fromEmail || !input.baseline) {
    if (input.mailpoolSpamFallback) {
      return buildMailpoolSpamFallbackSignal({
        dimension: "email",
        fallback: input.mailpoolSpamFallback,
      });
    }
    return fallbackSignal(input.row, "email");
  }

  const senderScore = input.baseline.score;
  const peerScore =
    averageScore(input.domainPeerBaselines) ?? averageScore(input.transportPeerBaselines);
  let status = healthFromScore(senderScore);
  const pieces = [`Control placement ${formatPercent(senderScore)} for ${input.row.fromEmail}.`];

  if (peerScore !== null) {
    const delta = senderScore - peerScore;
    if (delta <= -0.18) {
      status = "risky";
      pieces.push("This mailbox is materially weaker than sibling senders.");
    } else if (delta <= -0.08) {
      status = worseHealth(status, "watch");
      pieces.push("This mailbox is lagging peer senders on the same domain or route.");
    } else if (peerScore < 0.6) {
      status = "healthy";
      pieces.push("This mailbox tracks the weak peer baseline, so the mailbox itself is not the main outlier.");
    } else {
      pieces.push("This mailbox is tracking peer senders normally.");
    }
  } else {
    pieces.push("No sibling sender baseline exists yet, so this is based on absolute control placement only.");
  }

  return {
    status,
    summary: pieces.join(" "),
  } satisfies HealthSignal;
}

function buildMessageSignal(input: {
  row: DomainRow;
  baseline: ProbeObservation | null;
  production: ProbeObservation | null;
  mailpoolSpamFallback: MailpoolSpamFallback | null;
}) {
  if (!input.row.fromEmail) {
    return fallbackSignal(input.row, "message");
  }
  if (input.mailpoolSpamFallback && (!input.baseline || !input.production)) {
    return buildMailpoolSpamFallbackSignal({
      dimension: "message",
      fallback: input.mailpoolSpamFallback,
    });
  }
  if (!input.production) {
    return fallbackSignal(input.row, "message");
  }
  if (!input.baseline) {
    return {
      status: "queued",
      summary:
        "Live-content probe exists, but the control probe has not landed yet. Message risk cannot be isolated cleanly.",
    } satisfies HealthSignal;
  }

  const baselineScore = input.baseline.score;
  const productionScore = input.production.score;
  const delta = productionScore - baselineScore;
  let status: HealthLabel = "healthy";
  const pieces = [
    `Control placement ${formatPercent(baselineScore)}.`,
    `Live content placement ${formatPercent(productionScore)}.`,
  ];

  if (baselineScore < 0.6 && delta >= -0.08) {
    status = "healthy";
    pieces.push("Live content is tracking a weak control, so messaging is not the primary issue.");
  } else if (delta <= -0.22) {
    status = "risky";
    pieces.push("Production content is causing a material drop from the control.");
  } else if (delta <= -0.1) {
    status = "watch";
    pieces.push("Production content is underperforming the control.");
  } else {
    status = "healthy";
    pieces.push("Production content is tracking the control closely.");
  }

  return {
    status,
    summary: pieces.join(" "),
  } satisfies HealthSignal;
}

type SenderAutomationContext = {
  latestProbe: DeliverabilityProbeRun | null;
  latestBaseline: ProbeObservation | null;
  latestProduction: ProbeObservation | null;
  activeReservationCount: number;
  consumedReservationCount: number;
};

function latestProbeFailureReason(probeRun: DeliverabilityProbeRun | null) {
  if (!probeRun || probeRun.status !== "failed") return "";
  return probeRun.lastError.trim() || "";
}

function buildAutomationSummary(input: {
  row: DomainRow;
  domain: HealthSignal;
  email: HealthSignal;
  transport: HealthSignal;
  message: HealthSignal;
  automation: SenderAutomationContext;
  mailpoolSpamFallback: MailpoolSpamFallback | null;
}) {
  if (input.row.role === "brand") {
    return input.row.automationSummary || "Protected destination only. Sender warmup and probes stay on satellite mailboxes.";
  }

  if (input.row.dnsStatus === "error") {
    return "Paused: DNS or sender authentication failed. Fix the sender setup before warmup and probes resume.";
  }

  if (!input.row.fromEmail) {
    return "Preparing sender. Attach a sender mailbox before mailbox, transport, and message checks can start.";
  }

  if (input.row.dnsStatus !== "verified") {
    return "Preparing sender. DNS verification must complete before control probes and warmup can begin.";
  }

  const latestFailure = latestProbeFailureReason(input.automation.latestProbe);
  if (isMonitorPoolUnavailableReason(latestFailure)) {
    if (input.mailpoolSpamFallback) {
      return input.mailpoolSpamFallback.status === "risky"
        ? `Paused: inbox placement checks were unavailable, and the Mailpool spam check scored ${input.mailpoolSpamFallback.score}/100. That is too risky to keep sending.`
        : `Inbox placement checks were unavailable, so the sender is using Mailpool spam check fallback (${input.mailpoolSpamFallback.score}/100). This does not block sending.`;
    }
    return "Paused: this sender is fine, but we ran out of extra inboxes used to check it safely. Add 1 more inbox and checks will run again.";
  }
  if (latestFailure) {
    return `Preparing sender. The latest probe failed: ${latestFailure}. Automation will retry after the sender state changes.`;
  }

  if (input.automation.activeReservationCount > 0) {
    return "Validating sender. Seed probes are in flight and the system is waiting for placement results.";
  }

  const risky = (
    [
      ["message", input.message],
      ["transport", input.transport],
      ["domain", input.domain],
      ["email", input.email],
    ] as const
  ).find((entry) => entry[1].status === "risky");
  if (risky) {
    const label =
      risky[0] === "message"
        ? "Paused: message risk."
        : risky[0] === "transport"
          ? "Paused: transport risk."
          : risky[0] === "domain"
            ? "Paused: domain risk."
            : "Paused: mailbox risk.";
    return `${label} ${risky[1].summary}`;
  }

  if (!input.automation.latestBaseline) {
    return "Preparing sender. Running the control probe to isolate domain, mailbox, and transport health.";
  }

  if (!input.automation.latestProduction) {
    return "Control probe is healthy enough. Waiting for an exact-content probe before this sender earns production traffic.";
  }

  const queuedCount = [input.domain, input.email, input.transport, input.message].filter(
    (signal) => signal.status === "queued" || signal.status === "unknown"
  ).length;
  if (queuedCount > 0 || input.row.status === "warming") {
    return "Warming sender. Control and live-content checks are still settling before full production trust is granted.";
  }

  if (input.automation.consumedReservationCount > 0) {
    return "Ready. Baseline and exact-content probes are healthy, and the system is rotating seed pairs to avoid tainting later checks.";
  }

  return "Ready. Baseline and exact-content probes are healthy, so this sender can carry production traffic.";
}

function buildAutomationStatus(input: {
  row: DomainRow;
  domain: HealthSignal;
  email: HealthSignal;
  transport: HealthSignal;
  message: HealthSignal;
  automation: SenderAutomationContext;
  mailpoolSpamFallback: MailpoolSpamFallback | null;
}): NonNullable<DomainRow["automationStatus"]> {
  if (input.row.role === "brand") return "ready";
  if (input.row.dnsStatus === "error") return "attention";
  if (!input.row.fromEmail) return "queued";
  if (input.row.dnsStatus !== "verified") return "testing";
  if (isMonitorPoolUnavailableReason(latestProbeFailureReason(input.automation.latestProbe))) {
    if (!input.mailpoolSpamFallback) {
      return "attention";
    }
    if (input.mailpoolSpamFallback.status === "risky") {
      return "attention";
    }
    if (input.row.status === "warming" || !input.automation.latestBaseline || !input.automation.latestProduction) {
      return "warming";
    }
    return "ready";
  }
  if (input.automation.activeReservationCount > 0) return "testing";
  if ([input.domain, input.email, input.transport, input.message].some((signal) => signal.status === "risky")) {
    return "attention";
  }
  if (!input.automation.latestBaseline) return "testing";
  if (!input.automation.latestProduction) return "warming";
  if ([input.domain, input.email, input.transport, input.message].some((signal) => signal.status === "queued")) {
    return input.row.dnsStatus === "verified" ? "warming" : "testing";
  }
  if (input.row.status === "warming") return "warming";
  return "ready";
}

export function buildBrandSenderHealthRows(input: {
  domains: DomainRow[];
  senderAccounts: OutreachAccount[];
  probeRuns: DeliverabilityProbeRun[];
  reservations: DeliverabilitySeedReservation[];
  postmasterSnapshots?: DeliverabilityDomainHealth[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - HEALTH_WINDOW_DAYS * DAY_MS;
  const accountsById = new Map(input.senderAccounts.map((account) => [account.id, account] as const));
  const accountIdByFromEmail = new Map(
    input.senderAccounts
      .map((account) => [getOutreachAccountFromEmail(account).trim().toLowerCase(), account.id] as const)
      .filter(([fromEmail]) => Boolean(fromEmail))
  );
  const observations = input.probeRuns
    .filter((probeRun) => toDate(probeRun.completedAt || probeRun.updatedAt || probeRun.createdAt).getTime() >= cutoff)
    .map((probeRun) => parseProbeObservation(probeRun, accountsById, accountIdByFromEmail))
    .filter((row): row is ProbeObservation => Boolean(row))
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));

  const recentProbeRuns = input.probeRuns
    .filter((probeRun) => toDate(probeRun.updatedAt || probeRun.createdAt).getTime() >= cutoff)
    .sort((left, right) => {
      const leftAt = left.updatedAt || left.createdAt;
      const rightAt = right.updatedAt || right.createdAt;
      return leftAt < rightAt ? 1 : -1;
    });
  const recentReservations = input.reservations
    .filter((reservation) => toDate(reservation.updatedAt || reservation.createdAt).getTime() >= cutoff)
    .sort((left, right) => {
      const leftAt = left.updatedAt || left.createdAt;
      const rightAt = right.updatedAt || right.createdAt;
      return leftAt < rightAt ? 1 : -1;
    });
  const seedPolicyBySender = parseSeedPolicyBySender({
    reservations: recentReservations,
  });
  const latestBySenderVariant = new Map<string, ProbeObservation>();
  for (const observation of observations) {
    const key = `${observation.senderKey}:${observation.variant}`;
    if (!latestBySenderVariant.has(key)) {
      latestBySenderVariant.set(key, observation);
    }
  }

  const latestBaselineBySender = new Map<string, ProbeObservation>();
  const latestProductionBySender = new Map<string, ProbeObservation>();
  for (const observation of latestBySenderVariant.values()) {
    if (observation.variant === "baseline") {
      latestBaselineBySender.set(observation.senderKey, observation);
    } else {
      latestProductionBySender.set(observation.senderKey, observation);
    }
  }

  const baselineByDomain = new Map<string, ProbeObservation[]>();
  const baselineByTransport = new Map<string, ProbeObservation[]>();
  for (const observation of latestBaselineBySender.values()) {
    const domainRows = baselineByDomain.get(observation.senderDomain) ?? [];
    domainRows.push(observation);
    baselineByDomain.set(observation.senderDomain, domainRows);

    const transportRows = baselineByTransport.get(observation.transportKey) ?? [];
    transportRows.push(observation);
    baselineByTransport.set(observation.transportKey, transportRows);
  }

  const postmasterByDomain = new Map(
    (input.postmasterSnapshots ?? []).map((snapshot) => [normalizeDomain(snapshot.domain), snapshot] as const)
  );
  const latestProbeBySender = new Map<string, DeliverabilityProbeRun>();
  for (const probeRun of recentProbeRuns) {
    const fromEmail = probeRun.fromEmail.trim().toLowerCase();
    if (!fromEmail || latestProbeBySender.has(fromEmail)) continue;
    latestProbeBySender.set(fromEmail, probeRun);
  }
  const reservationStatsBySender = new Map<
    string,
    {
      activeReservationCount: number;
      consumedReservationCount: number;
    }
  >();
  for (const reservation of recentReservations) {
    const fromEmail = reservation.fromEmail.trim().toLowerCase();
    if (!fromEmail) continue;
    const bucket = reservationStatsBySender.get(fromEmail) ?? {
      activeReservationCount: 0,
      consumedReservationCount: 0,
    };
    if (reservation.status === "reserved") {
      bucket.activeReservationCount += 1;
    }
    if (reservation.status === "consumed") {
      bucket.consumedReservationCount += 1;
    }
    reservationStatsBySender.set(fromEmail, bucket);
  }

  return input.domains.map((row) => {
    const rowDomain = normalizeDomain(row.domain);
    const rowEmail = row.fromEmail?.trim().toLowerCase() || "";
    const rowAccountId =
      getDomainDeliveryAccountId(row) ||
      (rowEmail ? accountIdByFromEmail.get(rowEmail) ?? "" : "");
    const rowAccount = rowAccountId ? accountsById.get(rowAccountId) ?? null : null;
    const rowTransportKey = transportKeyForAccount(rowAccount, rowAccountId, rowEmail);
    const senderBaseline = rowEmail ? latestBaselineBySender.get(rowEmail) ?? null : null;
    const senderProduction = rowEmail ? latestProductionBySender.get(rowEmail) ?? null : null;
    const domainBaselines = baselineByDomain.get(rowDomain) ?? [];
    const domainPeerBaselines = domainBaselines.filter((observation) => observation.fromEmail !== rowEmail);
    const transportBaselines = baselineByTransport.get(rowTransportKey) ?? [];
    const transportPeerBaselines = transportBaselines.filter(
      (observation) => observation.senderDomain !== rowDomain
    );
    const emailTransportPeers = transportBaselines.filter((observation) => observation.fromEmail !== rowEmail);
    const postmasterSnapshot = postmasterByDomain.get(rowDomain) ?? null;
    const reservationStats = reservationStatsBySender.get(rowEmail) ?? {
      activeReservationCount: 0,
      consumedReservationCount: 0,
    };
    const automation = {
      latestProbe: latestProbeBySender.get(rowEmail) ?? null,
      latestBaseline: senderBaseline,
      latestProduction: senderProduction,
      activeReservationCount: reservationStats.activeReservationCount,
      consumedReservationCount: reservationStats.consumedReservationCount,
    } satisfies SenderAutomationContext;
    const mailpoolSpamFallback = readMailpoolSpamFallback(rowAccount, automation, now);

    const domainSignal = buildDomainSignal({
      row,
      domainBaselines,
      transportPeerBaselines,
      postmasterSnapshot,
      mailpoolSpamFallback,
    });
    const emailSignal = buildEmailSignal({
      row,
      baseline: senderBaseline,
      domainPeerBaselines,
      transportPeerBaselines: emailTransportPeers,
      mailpoolSpamFallback,
    });
    const transportSignal = buildTransportSignal(row, transportBaselines, mailpoolSpamFallback);
    const messageSignal = buildMessageSignal({
      row,
      baseline: senderBaseline,
      production: senderProduction,
      mailpoolSpamFallback,
    });

    const latestCheckAt = [senderBaseline?.createdAt, senderProduction?.createdAt, mailpoolSpamFallback?.checkedAt]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => (left < right ? 1 : -1))[0];
    const latestReservationAt = recentReservations
      .filter((reservation) => reservation.fromEmail.trim().toLowerCase() === rowEmail)
      .map((reservation) => reservation.updatedAt || reservation.createdAt)
      .sort((left, right) => (left < right ? 1 : -1))[0];

    return {
      ...row,
      automationStatus: buildAutomationStatus({
        row,
        domain: domainSignal,
        email: emailSignal,
        transport: transportSignal,
        message: messageSignal,
        automation,
        mailpoolSpamFallback,
      }),
      automationSummary: buildAutomationSummary({
        row,
        domain: domainSignal,
        email: emailSignal,
        transport: transportSignal,
        message: messageSignal,
        automation,
        mailpoolSpamFallback,
      }),
      domainHealth: domainSignal.status,
      domainHealthSummary: domainSignal.summary,
      emailHealth: emailSignal.status,
      emailHealthSummary: emailSignal.summary,
      ipHealth: transportSignal.status,
      ipHealthSummary: transportSignal.summary,
      messagingHealth: messageSignal.status,
      messagingHealthSummary: messageSignal.summary,
      seedPolicy: seedPolicyBySender.get(rowEmail) ?? row.seedPolicy,
      lastHealthCheckAt: latestCheckAt || latestReservationAt || row.lastHealthCheckAt,
    } satisfies DomainRow;
  });
}

export function evaluateSenderHealthGate(input: {
  domains: DomainRow[];
  accountId?: string;
  fromEmail?: string;
  requireInfrastructureReady?: boolean;
  requireMessageReady?: boolean;
}) {
  const accountId = String(input.accountId ?? "").trim();
  const fromEmail = String(input.fromEmail ?? "").trim().toLowerCase();
  const row =
    input.domains.find(
      (domainRow) =>
        domainRow.role !== "brand" &&
        ((accountId && getDomainDeliveryAccountId(domainRow) === accountId) ||
          (fromEmail && String(domainRow.fromEmail ?? "").trim().toLowerCase() === fromEmail))
    ) ?? null;

  if (!row) {
    const pending: SenderHealthGateIssue[] =
      input.requireInfrastructureReady || input.requireMessageReady
        ? [
            {
              dimension: input.requireInfrastructureReady ? "transport" : "message",
              status: "unknown",
              summary: "Sender health has not been derived for this sender yet.",
            },
          ]
        : [];
    return { row: null, blockers: [] as SenderHealthGateIssue[], pending };
  }

  const blockers: SenderHealthGateIssue[] = [];
  const pending: SenderHealthGateIssue[] = [];
  const pushIssue = (
    dimension: SenderHealthDimension,
    status: HealthLabel,
    summary: string,
    requireReady = false
  ) => {
    if (status === "risky") {
      blockers.push({ dimension, status, summary });
      return;
    }
    if (requireReady && (status === "queued" || status === "unknown")) {
      pending.push({ dimension, status, summary });
    }
  };

  pushIssue(
    "domain",
    row.domainHealth ?? "unknown",
    row.domainHealthSummary ?? "",
    input.requireInfrastructureReady === true
  );
  pushIssue(
    "email",
    row.emailHealth ?? "unknown",
    row.emailHealthSummary ?? "",
    input.requireInfrastructureReady === true
  );
  pushIssue(
    "transport",
    row.ipHealth ?? "unknown",
    row.ipHealthSummary ?? "",
    input.requireInfrastructureReady === true
  );
  pushIssue(
    "message",
    row.messagingHealth ?? "unknown",
    row.messagingHealthSummary ?? "",
    input.requireMessageReady === true
  );

  return { row, blockers, pending };
}

export async function enrichBrandWithSenderHealth(brand: BrandRecord): Promise<BrandRecord> {
  try {
    const [senderAccounts, probeRuns, reservations, settings] = await Promise.all([
      listOutreachAccounts(),
      listDeliverabilityProbeRuns({ brandId: brand.id, limit: 500 }),
      listDeliverabilitySeedReservations({ brandId: brand.id }),
      getOutreachProvisioningSettings(),
    ]);
    return {
      ...brand,
      domains: buildBrandSenderHealthRows({
        domains: brand.domains,
        senderAccounts,
        probeRuns,
        reservations,
        postmasterSnapshots: settings.deliverability.lastDomainSnapshots,
      }),
    };
  } catch {
    return brand;
  }
}
