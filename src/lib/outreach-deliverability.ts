import type {
  DeliverabilityDomainHealth,
  DeliverabilityHealthStatus,
  OutreachAccount,
  OutreachRunEvent,
} from "@/lib/factory-types";
import type { ProvisioningProviderTestResult } from "@/lib/outreach-provisioning";

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_POSTMASTER_API_BASE = "https://gmailpostmastertools.googleapis.com/v1beta1";

type GooglePostmasterCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type GoogleTrafficErrorRow = {
  errorClass: string;
  errorType: string;
  errorRatio: number;
};

export type DeliverabilityHealthSnapshot = {
  provider: "google_postmaster";
  checkedAt: string;
  overallStatus: DeliverabilityHealthStatus;
  overallScore: number;
  summary: string;
  domains: DeliverabilityDomainHealth[];
};

export const SENDER_DELIVERABILITY_MIN_MONITORS = 6;
export const SENDER_DELIVERABILITY_SPAM_RATE_THRESHOLD = 0.5;
export const SENDER_DELIVERABILITY_COOLDOWN_HOURS = 24;

export type SenderDeliverabilityScorecard = {
  senderAccountId: string;
  senderAccountName: string;
  fromEmail: string;
  checkedAt: string;
  placement: string;
  totalMonitors: number;
  inboxCount: number;
  spamCount: number;
  allMailOnlyCount: number;
  notFoundCount: number;
  errorCount: number;
  inboxRate: number;
  spamRate: number;
  summaryText: string;
  autoPaused: boolean;
  autoPauseReason: string;
  autoPauseUntil: string;
  manualOverrideActive: boolean;
  manualOverrideAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addHoursIso(value: string, hours: number) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Date(parsed.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function normalizeCounts(
  placement: string,
  countsValue: unknown,
  totalMonitorsValue: unknown
) {
  const countsRecord = asRecord(countsValue);
  const counts = {
    inbox: asNumber(countsRecord.inbox),
    spam: asNumber(countsRecord.spam),
    all_mail_only: asNumber(countsRecord.all_mail_only),
    not_found: asNumber(countsRecord.not_found),
    error: asNumber(countsRecord.error),
  };
  let total = asNumber(totalMonitorsValue);
  if (total <= 0) {
    total =
      counts.inbox + counts.spam + counts.all_mail_only + counts.not_found + counts.error;
  }
  if (total <= 0 && placement) {
    total = 1;
    if (placement === "inbox") counts.inbox = 1;
    else if (placement === "spam") counts.spam = 1;
    else if (placement === "all_mail_only") counts.all_mail_only = 1;
    else if (placement === "not_found") counts.not_found = 1;
    else counts.error = 1;
  }
  return { counts, total };
}

function resolveSenderKey(input: {
  event: OutreachRunEvent;
  accountsById: Map<string, OutreachAccount>;
  accountIdByFromEmail: Map<string, string>;
}) {
  const payload = asRecord(input.event.payload);
  const payloadAccountId = asText(payload.senderAccountId);
  const payloadFromEmail = asText(payload.fromEmail).toLowerCase();
  const accountId =
    payloadAccountId ||
    (payloadFromEmail ? input.accountIdByFromEmail.get(payloadFromEmail) ?? "" : "");
  const account = accountId ? input.accountsById.get(accountId) ?? null : null;
  const fromEmail =
    payloadFromEmail || account?.config.customerIo.fromEmail.trim().toLowerCase() || "";
  const senderAccountName = asText(payload.senderAccountName) || account?.name || fromEmail;
  const senderKey = accountId || fromEmail;
  return {
    senderKey,
    senderAccountId: accountId,
    senderAccountName,
    fromEmail,
  };
}

export function buildSenderDeliverabilityScorecards(input: {
  events: OutreachRunEvent[];
  senderAccounts: OutreachAccount[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const accountsById = new Map(input.senderAccounts.map((account) => [account.id, account] as const));
  const accountIdByFromEmail = new Map(
    input.senderAccounts
      .map((account) => [account.config.customerIo.fromEmail.trim().toLowerCase(), account.id] as const)
      .filter(([fromEmail]) => Boolean(fromEmail))
  );
  const latestBySenderKey = new Map<string, SenderDeliverabilityScorecard>();
  const latestManualResumeBySenderKey = new Map<string, string>();

  const manualResumeEvents = [...input.events]
    .filter((event) => event.eventType === "sender_deliverability_resumed_manual")
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));

  for (const event of manualResumeEvents) {
    const { senderKey } = resolveSenderKey({
      event,
      accountsById,
      accountIdByFromEmail,
    });
    if (!senderKey || latestManualResumeBySenderKey.has(senderKey)) continue;
    latestManualResumeBySenderKey.set(senderKey, event.createdAt);
  }

  const probeResults = [...input.events]
    .filter((event) => event.eventType === "deliverability_probe_result")
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));

  for (const event of probeResults) {
    const payload = asRecord(event.payload);
    const { senderKey, senderAccountId, senderAccountName, fromEmail } = resolveSenderKey({
      event,
      accountsById,
      accountIdByFromEmail,
    });
    if (!senderKey) continue;
    if (latestBySenderKey.has(senderKey)) continue;

    const placement = asText(payload.placement) || "unknown";
    const { counts, total } = normalizeCounts(placement, payload.counts, payload.totalMonitors);
    const summaryText = asText(payload.summaryText) || "No monitor summary";
    const spamRate = total > 0 ? counts.spam / total : 0;
    const inboxRate = total > 0 ? counts.inbox / total : 0;
    const autoPauseUntil = addHoursIso(event.createdAt, SENDER_DELIVERABILITY_COOLDOWN_HOURS);
    const manualOverrideAt = latestManualResumeBySenderKey.get(senderKey) ?? "";
    const manualOverrideActive =
      Boolean(manualOverrideAt) &&
      new Date(manualOverrideAt).getTime() >= new Date(event.createdAt).getTime();
    const autoPaused =
      !manualOverrideActive &&
      total >= SENDER_DELIVERABILITY_MIN_MONITORS &&
      spamRate >= SENDER_DELIVERABILITY_SPAM_RATE_THRESHOLD &&
      Boolean(autoPauseUntil) &&
      new Date(autoPauseUntil).getTime() > now.getTime();

    latestBySenderKey.set(senderKey, {
      senderAccountId,
      senderAccountName,
      fromEmail,
      checkedAt: event.createdAt,
      placement,
      totalMonitors: total,
      inboxCount: counts.inbox,
      spamCount: counts.spam,
      allMailOnlyCount: counts.all_mail_only,
      notFoundCount: counts.not_found,
      errorCount: counts.error,
      inboxRate,
      spamRate,
      summaryText,
      autoPaused,
      autoPauseReason: autoPaused
        ? `Spam ${(spamRate * 100).toFixed(0)}% across ${total} seed inboxes`
        : "",
      autoPauseUntil: autoPaused ? autoPauseUntil : "",
      manualOverrideActive,
      manualOverrideAt,
    });
  }

  for (const account of input.senderAccounts) {
    const senderKey = account.id;
    if (latestBySenderKey.has(senderKey)) continue;
    latestBySenderKey.set(senderKey, {
      senderAccountId: account.id,
      senderAccountName: account.name,
      fromEmail: account.config.customerIo.fromEmail.trim().toLowerCase(),
      checkedAt: "",
      placement: "unknown",
      totalMonitors: 0,
      inboxCount: 0,
      spamCount: 0,
      allMailOnlyCount: 0,
      notFoundCount: 0,
      errorCount: 0,
      inboxRate: 0,
      spamRate: 0,
      summaryText: "No seed-group check yet",
      autoPaused: false,
      autoPauseReason: "",
      autoPauseUntil: "",
      manualOverrideActive: false,
      manualOverrideAt: "",
    });
  }

  return Array.from(latestBySenderKey.values()).sort((left, right) => {
    if (left.autoPaused !== right.autoPaused) return left.autoPaused ? -1 : 1;
    if (left.checkedAt !== right.checkedAt) return left.checkedAt < right.checkedAt ? 1 : -1;
    return left.senderAccountName.localeCompare(right.senderAccountName);
  });
}

function reputationBaseScore(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === "HIGH") return 100;
  if (normalized === "MEDIUM") return 82;
  if (normalized === "LOW") return 45;
  if (normalized === "BAD") return 15;
  return 60;
}

function statusRank(status: DeliverabilityHealthStatus) {
  if (status === "critical") return 3;
  if (status === "warning") return 2;
  if (status === "healthy") return 1;
  return 0;
}

function detectTrafficDate(row: Record<string, unknown>) {
  const name = String(row.name ?? "").trim();
  const dateMatch = name.match(/trafficStats\/(\d{4})(\d{2})(\d{2})$/);
  if (dateMatch) {
    return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  }
  const date = asRecord(row.date);
  const year = Number(date.year ?? 0);
  const month = Number(date.month ?? 0);
  const day = Number(date.day ?? 0);
  if (year && month && day) {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return "";
}

function parseTrafficErrors(value: unknown): GoogleTrafficErrorRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      errorClass: String(entry.errorClass ?? "").trim(),
      errorType: String(entry.errorType ?? "").trim(),
      errorRatio: Number(entry.errorRatio ?? 0) || 0,
    }))
    .filter((entry) => entry.errorType || entry.errorClass || entry.errorRatio > 0);
}

function summarizeDomainHealth(input: {
  domain: string;
  trafficDate: string;
  domainReputation: string;
  spamRate: number;
  deliveryErrors: GoogleTrafficErrorRow[];
}) {
  const rep = input.domainReputation.trim().toUpperCase();
  const maxErrorRatio = input.deliveryErrors.reduce((max, row) => Math.max(max, row.errorRatio), 0);
  let score = reputationBaseScore(rep);

  if (input.spamRate >= 0.03) {
    score -= 35;
  } else if (input.spamRate >= 0.01) {
    score -= 20;
  } else if (input.spamRate >= 0.003) {
    score -= 10;
  }

  if (maxErrorRatio >= 0.15) {
    score -= 20;
  } else if (maxErrorRatio >= 0.05) {
    score -= 10;
  }

  score = Math.max(0, Math.min(100, score));

  let status: DeliverabilityHealthStatus = "healthy";
  if (rep === "BAD" || input.spamRate >= 0.03 || score < 45) {
    status = "critical";
  } else if (rep === "LOW" || input.spamRate >= 0.01 || maxErrorRatio >= 0.05 || score < 75) {
    status = "warning";
  }

  const pieces = [
    input.domain,
    rep ? `reputation ${rep}` : "reputation unknown",
    `spam ${(input.spamRate * 100).toFixed(2)}%`,
  ];
  if (maxErrorRatio > 0) {
    pieces.push(`delivery errors ${(maxErrorRatio * 100).toFixed(2)}%`);
  }
  if (input.trafficDate) {
    pieces.push(`latest ${input.trafficDate}`);
  }

  const summary = pieces.join(" · ");

  return {
    domain: input.domain,
    trafficDate: input.trafficDate,
    domainReputation: rep,
    spamRate: input.spamRate,
    status,
    summary,
    score,
  } satisfies DeliverabilityDomainHealth & { score: number };
}

async function fetchGoogleAccessToken(input: GooglePostmasterCredentials) {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId.trim(),
      client_secret: input.clientSecret.trim(),
      refresh_token: input.refreshToken.trim(),
      grant_type: "refresh_token",
    }),
  });

  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    const message =
      String(payload.error_description ?? payload.error ?? "").trim() || "Google OAuth token refresh failed";
    throw new Error(message);
  }

  const token = String(payload.access_token ?? "").trim();
  if (!token) {
    throw new Error("Google OAuth token refresh returned no access token");
  }
  return token;
}

async function fetchLatestGoogleTrafficStat(input: { accessToken: string; domain: string }) {
  const response = await fetch(
    `${GOOGLE_POSTMASTER_API_BASE}/domains/${encodeURIComponent(input.domain)}/trafficStats?pageSize=1`,
    {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
      cache: "no-store",
    }
  );

  const payload = asRecord(await response.json().catch(() => ({})));
  if (!response.ok) {
    const errorRow = asRecord(payload.error);
    const message =
      String(errorRow.message ?? payload.message ?? "").trim() || "Google Postmaster request failed";
    throw new Error(message);
  }

  const trafficStats = Array.isArray(payload.trafficStats) ? payload.trafficStats : [];
  if (!trafficStats.length) {
    throw new Error(`Google Postmaster returned no traffic stats for ${input.domain}`);
  }
  return asRecord(trafficStats[0]);
}

export async function fetchGooglePostmasterHealth(input: GooglePostmasterCredentials & { domains: string[] }) {
  const uniqueDomains = Array.from(
    new Set(
      input.domains
        .map((domain) => String(domain ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
  if (!uniqueDomains.length) {
    throw new Error("Add at least one monitored domain for deliverability intelligence");
  }

  const accessToken = await fetchGoogleAccessToken(input);
  const domainSnapshots = [] as Array<DeliverabilityDomainHealth & { score: number }>;
  for (const domain of uniqueDomains) {
    const row = await fetchLatestGoogleTrafficStat({ accessToken, domain });
    const snapshot = summarizeDomainHealth({
      domain,
      trafficDate: detectTrafficDate(row),
      domainReputation: String(row.domainReputation ?? "").trim(),
      spamRate: Number(row.userReportedSpamRatio ?? 0) || 0,
      deliveryErrors: parseTrafficErrors(row.deliveryErrors),
    });
    domainSnapshots.push(snapshot);
  }

  const overall = domainSnapshots.reduce(
    (worst, snapshot) =>
      statusRank(snapshot.status) > statusRank(worst.status) || snapshot.score < worst.score
        ? { status: snapshot.status, score: snapshot.score }
        : worst,
    { status: "healthy" as DeliverabilityHealthStatus, score: 100 }
  );

  return {
    provider: "google_postmaster" as const,
    checkedAt: nowIso(),
    overallStatus: domainSnapshots.length ? overall.status : "unknown",
    overallScore: domainSnapshots.length ? overall.score : 0,
    summary: domainSnapshots.map((snapshot) => snapshot.summary).join(" | "),
    domains: domainSnapshots.map((snapshot) => {
      const { score, ...rest } = snapshot;
      void score;
      return rest;
    }),
  } satisfies DeliverabilityHealthSnapshot;
}

export async function testGooglePostmasterDeliverabilityConnection(
  input: GooglePostmasterCredentials & { domains: string[] }
): Promise<ProvisioningProviderTestResult & { snapshot?: DeliverabilityHealthSnapshot }> {
  const snapshot = await fetchGooglePostmasterHealth(input);
  const previewDomains = snapshot.domains.slice(0, 3).map((row) => row.domain).join(", ");
  return {
    provider: "deliverability",
    ok: true,
    message:
      snapshot.domains.length > 0
        ? `Google Postmaster connected. Monitoring ${previewDomains}.`
        : "Google Postmaster connected.",
    details: {
      provider: snapshot.provider,
      overallStatus: snapshot.overallStatus,
      overallScore: snapshot.overallScore,
      checkedAt: snapshot.checkedAt,
      summary: snapshot.summary,
      monitoredDomains: snapshot.domains.map((row) => row.domain),
      domainSnapshots: snapshot.domains,
    },
    snapshot,
  };
}
