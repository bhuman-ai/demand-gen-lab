import type {
  DomainRow,
  OutreachAccount,
  OutreachMessage,
  OutreachRun,
} from "@/lib/factory-types";
import {
  SENDER_DELIVERABILITY_MIN_MONITORS,
  type SenderDeliverabilityScorecard,
} from "@/lib/outreach-deliverability";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEZONE = "America/Los_Angeles";

export type SenderUsageMap = Record<string, { dailySent: number; hourlySent: number }>;

export type SenderCapacityPolicy = {
  warmupDay: number;
  baseDailyCap: number;
  baseHourlyCap: number;
  dailyCap: number;
  hourlyCap: number;
  automationFactor: number;
  healthFactor: number;
  deliverabilityFactor: number;
  summary: string;
};

export type SenderCapacitySnapshot = SenderCapacityPolicy & {
  senderAccountId: string;
  fromEmail: string;
  dailySent: number;
  hourlySent: number;
};

function toDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0);
  }
  return parsed;
}

function timeZoneDateKey(input: Date, timeZone: string) {
  const zone = timeZone.trim() || DEFAULT_TIMEZONE;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(input);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(input);
  }
}

export function senderWarmupDayNumber(createdAt: string, now: Date, timeZone: string) {
  const created = toDate(createdAt);
  const createdKey = timeZoneDateKey(created, timeZone || DEFAULT_TIMEZONE);
  const nowKey = timeZoneDateKey(now, timeZone || DEFAULT_TIMEZONE);
  const createdDay = Date.parse(`${createdKey}T00:00:00Z`);
  const nowDay = Date.parse(`${nowKey}T00:00:00Z`);
  if (!Number.isFinite(createdDay) || !Number.isFinite(nowDay)) return 1;
  return Math.max(1, Math.floor((nowDay - createdDay) / DAY_MS) + 1);
}

function automationFactor(status?: DomainRow["automationStatus"]) {
  if (status === "ready") return 1;
  if (status === "warming") return 0.75;
  if (status === "testing") return 0.55;
  if (status === "queued") return 0.45;
  if (status === "attention") return 0;
  return 0.65;
}

function launchFactor(state?: DomainRow["senderLaunchState"]) {
  if (state === "ready") return 1;
  if (state === "restricted_send") return 0.65;
  if (state === "warming") return 0.5;
  if (state === "observing") return 0.25;
  if (state === "paused" || state === "blocked" || state === "setup") return 0;
  return 1;
}

function healthStatusFactor(status?: DomainRow["domainHealth"]) {
  if (status === "healthy") return 1;
  if (status === "watch") return 0.82;
  if (status === "queued") return 0.65;
  if (status === "unknown") return 0.55;
  if (status === "risky") return 0;
  return 0.65;
}

function worstHealthFactor(row?: DomainRow | null) {
  if (!row) return 1;
  return Math.min(
    healthStatusFactor(row.domainHealth),
    healthStatusFactor(row.emailHealth),
    healthStatusFactor(row.ipHealth),
    healthStatusFactor(row.messagingHealth)
  );
}

function deliverabilityFactor(scorecard?: SenderDeliverabilityScorecard | null) {
  if (!scorecard) return 0.7;
  if (scorecard.autoPaused) return 0;
  if (scorecard.placement === "spam" || scorecard.spamRate >= 0.5) return 0;

  const reliablePlacement = scorecard.totalMonitors >= SENDER_DELIVERABILITY_MIN_MONITORS;
  if (!reliablePlacement) {
    if (scorecard.placement === "inbox" && scorecard.inboxRate >= 0.8) return 0.85;
    if (scorecard.placement === "all_mail_only") return 0.7;
    if (scorecard.placement === "not_found" || scorecard.placement === "error") return 0.6;
    return 0.7;
  }

  if (scorecard.placement === "inbox" && scorecard.inboxRate >= 0.85 && scorecard.spamRate <= 0.05) return 1;
  if (scorecard.inboxRate >= 0.7 && scorecard.spamRate <= 0.15) return 0.9;
  if (scorecard.placement === "all_mail_only" || scorecard.inboxRate >= 0.55) return 0.75;
  if (scorecard.placement === "not_found" || scorecard.inboxRate >= 0.4) return 0.6;
  return 0.45;
}

function capacitySummary(input: {
  warmupDay: number;
  row?: DomainRow | null;
  scorecard?: SenderDeliverabilityScorecard | null;
}) {
  const pieces = [`Warmup day ${input.warmupDay}`];
  if (input.row?.automationStatus) {
    pieces.push(input.row.automationStatus);
  }
  if (input.row) {
    const healthStates = [
      input.row.domainHealth,
      input.row.emailHealth,
      input.row.ipHealth,
      input.row.messagingHealth,
    ].filter(Boolean) as DomainRow["domainHealth"][];
    const hasRisk = healthStates.includes("risky");
    const hasWatch = healthStates.includes("watch");
    if (hasRisk) {
      pieces.push("health risky");
    } else if (hasWatch) {
      pieces.push("health watch");
    }
  }
  if (input.scorecard) {
    if (input.scorecard.totalMonitors > 0) {
      if (input.scorecard.placement === "inbox") {
        pieces.push(`inbox ${Math.round(input.scorecard.inboxRate * 100)}%`);
      } else {
        pieces.push(`placement ${input.scorecard.placement}`);
      }
    } else {
      pieces.push("no placement history");
    }
  } else {
    pieces.push("no placement history");
  }
  return pieces.join(" · ");
}

export function calculateSenderCapacityPolicy(input: {
  account: Pick<OutreachAccount, "createdAt">;
  now?: Date;
  timeZone: string;
  businessHoursPerDay: number;
  row?: DomainRow | null;
  scorecard?: SenderDeliverabilityScorecard | null;
}): SenderCapacityPolicy {
  const now = input.now ?? new Date();
  const warmupDay = senderWarmupDayNumber(input.account.createdAt, now, input.timeZone);
  const baseDailyCap = Math.max(15, Math.min(120, warmupDay * 15));
  const safeBusinessHours = Math.max(1, Math.round(input.businessHoursPerDay) || 8);
  const baseHourlyCap = Math.max(1, Math.ceil(baseDailyCap / safeBusinessHours));

  const nextAutomationFactor = automationFactor(input.row?.automationStatus);
  const nextLaunchFactor = launchFactor(input.row?.senderLaunchState);
  const nextHealthFactor = worstHealthFactor(input.row);
  const nextDeliverabilityFactor = deliverabilityFactor(input.scorecard);
  const confidence = Math.min(nextAutomationFactor, nextLaunchFactor, nextHealthFactor, nextDeliverabilityFactor);
  const minimumCap = confidence <= 0 ? 0 : input.row?.automationStatus === "ready" ? 10 : 5;
  const dailyCap =
    confidence <= 0 ? 0 : Math.min(baseDailyCap, Math.max(minimumCap, Math.round(baseDailyCap * confidence)));
  const hourlyCap =
    dailyCap <= 0 ? 0 : Math.min(dailyCap, Math.max(1, Math.ceil(dailyCap / safeBusinessHours)));

  return {
    warmupDay,
    baseDailyCap,
    baseHourlyCap,
    dailyCap,
    hourlyCap,
    automationFactor: nextAutomationFactor,
    healthFactor: nextHealthFactor,
    deliverabilityFactor: nextDeliverabilityFactor,
    summary: capacitySummary({
      warmupDay,
      row: input.row,
      scorecard: input.scorecard,
    }),
  };
}

export function buildSenderUsageMap(input: {
  entries: Array<{
    run: Pick<OutreachRun, "accountId">;
    messages: OutreachMessage[];
  }>;
  timeZone: string;
  now?: Date;
}): SenderUsageMap {
  const now = input.now ?? new Date();
  const usage: SenderUsageMap = {};
  const oneHourAgo = now.getTime() - 60 * 60 * 1000;
  const todayKey = timeZoneDateKey(now, input.timeZone || DEFAULT_TIMEZONE);

  for (const entry of input.entries) {
    for (const message of entry.messages) {
      if (message.status !== "sent" || !message.sentAt) continue;
      const senderAccountId =
        String(message.generationMeta?.senderAccountId ?? "").trim() || entry.run.accountId.trim();
      if (!senderAccountId) continue;
      const bucket = usage[senderAccountId] ?? { dailySent: 0, hourlySent: 0 };
      if (timeZoneDateKey(toDate(message.sentAt), input.timeZone || DEFAULT_TIMEZONE) === todayKey) {
        bucket.dailySent += 1;
      }
      if (toDate(message.sentAt).getTime() >= oneHourAgo) {
        bucket.hourlySent += 1;
      }
      usage[senderAccountId] = bucket;
    }
  }

  return usage;
}
