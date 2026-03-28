import type {
  DomainRow,
  OutreachAccount,
  OutreachMessage,
  OutreachRun,
} from "@/lib/factory-types";
import type { SenderDeliverabilityScorecard } from "@/lib/outreach-deliverability";
import { getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEZONE = "America/Los_Angeles";

export const MAX_ACTIVE_SENDERS_PER_DOMAIN = 3;
export const MAX_SENDER_DAILY_CAP = 100;

const WARMUP_RAMP = [
  { minDay: 1, maxDay: 3, dailyCap: 20, label: "Days 1-3" },
  { minDay: 4, maxDay: 7, dailyCap: 35, label: "Days 4-7" },
  { minDay: 8, maxDay: 14, dailyCap: 50, label: "Days 8-14" },
  { minDay: 15, maxDay: 21, dailyCap: 75, label: "Days 15-21" },
  { minDay: 22, maxDay: Number.POSITIVE_INFINITY, dailyCap: MAX_SENDER_DAILY_CAP, label: "Day 22+" },
] as const;

export type SenderUsageMap = Record<string, { dailySent: number; hourlySent: number }>;

export type SenderCapacityPolicy = {
  warmupDay: number;
  warmupStage: string;
  baseDailyCap: number;
  baseHourlyCap: number;
  maxDailyCap: number;
  dailyCap: number;
  hourlyCap: number;
  automationFactor: number;
  launchFactor: number;
  healthFactor: number;
  deliverabilityFactor: number;
  domain: string;
  domainActiveSenderRank: number;
  activeSenderLimitPerDomain: number;
  domainLimitBlocked: boolean;
  summary: string;
};

export type SenderCapacitySnapshot = SenderCapacityPolicy & {
  senderAccountId: string;
  fromEmail: string;
  dailySent: number;
  hourlySent: number;
};

type SenderCapacitySubject = {
  account: OutreachAccount;
  row?: DomainRow | null;
  scorecard?: SenderDeliverabilityScorecard | null;
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

function normalizeSenderDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function senderDomainFromInput(input: { row?: DomainRow | null; fromEmail?: string }) {
  const explicit = normalizeSenderDomain(String(input.row?.domain ?? ""));
  if (explicit) return explicit;
  const email = String(input.fromEmail ?? "").trim().toLowerCase();
  return normalizeSenderDomain(email.split("@")[1] ?? "");
}

function automationFactor(status?: DomainRow["automationStatus"]) {
  if (!status || status === "warming" || status === "ready") return 1;
  if (status === "testing" || status === "queued" || status === "attention") return 0;
  return 1;
}

function launchFactor(state?: DomainRow["senderLaunchState"]) {
  if (!state) return 1;
  if (state === "setup" || state === "paused" || state === "blocked") return 0;
  return 1;
}

function healthStatusFactor(status?: DomainRow["domainHealth"]) {
  if (!status || status === "healthy" || status === "watch" || status === "queued" || status === "unknown") {
    return 1;
  }
  if (status === "risky") return 0;
  return 1;
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
  if (!scorecard) return 1;
  if (scorecard.autoPaused) return 0;
  if (scorecard.placement === "spam" || scorecard.spamRate >= 0.5) return 0;
  return 1;
}

function warmupRampStage(day: number) {
  return WARMUP_RAMP.find((stage) => day >= stage.minDay && day <= stage.maxDay) ?? WARMUP_RAMP[WARMUP_RAMP.length - 1];
}

function warmupStageLabel(stage: { label: string; dailyCap: number }) {
  return `${stage.label} · ${stage.dailyCap}/day`;
}

function capacitySummary(input: {
  warmupDay: number;
  warmupStage: string;
  row?: DomainRow | null;
  scorecard?: SenderDeliverabilityScorecard | null;
  domainLimitBlocked?: boolean;
  activeSenderLimitPerDomain?: number;
}) {
  const pieces = [input.warmupStage, `warmup day ${input.warmupDay}`];
  if (input.domainLimitBlocked) {
    pieces.push(`domain capped at ${input.activeSenderLimitPerDomain ?? MAX_ACTIVE_SENDERS_PER_DOMAIN} active inboxes`);
  }
  if (input.row?.automationStatus === "testing" || input.row?.automationStatus === "queued") {
    pieces.push("setup still running");
  } else if (input.row?.automationStatus === "attention") {
    pieces.push("attention required");
  }
  if (input.row?.senderLaunchState === "restricted_send") {
    pieces.push("restricted send");
  } else if (input.row?.senderLaunchState === "ready") {
    pieces.push("ready");
  }
  if (input.row) {
    const healthStates = [
      input.row.domainHealth,
      input.row.emailHealth,
      input.row.ipHealth,
      input.row.messagingHealth,
    ].filter(Boolean) as DomainRow["domainHealth"][];
    if (healthStates.includes("risky")) {
      pieces.push("health risky");
    } else if (healthStates.includes("watch")) {
      pieces.push("health watch");
    }
  }
  if (input.scorecard?.autoPaused) {
    pieces.push("deliverability paused");
  }
  return pieces.join(" · ");
}

function compareSenderPriority(left: SenderCapacitySnapshot, right: SenderCapacitySnapshot) {
  if (left.dailyCap !== right.dailyCap) return right.dailyCap - left.dailyCap;
  if (left.warmupDay !== right.warmupDay) return right.warmupDay - left.warmupDay;
  if (left.deliverabilityFactor !== right.deliverabilityFactor) {
    return right.deliverabilityFactor - left.deliverabilityFactor;
  }
  if (left.healthFactor !== right.healthFactor) {
    return right.healthFactor - left.healthFactor;
  }
  return left.fromEmail.localeCompare(right.fromEmail);
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

export function calculateSenderCapacityPolicy(input: {
  account: Pick<OutreachAccount, "createdAt">;
  now?: Date;
  timeZone: string;
  businessHoursPerDay: number;
  row?: DomainRow | null;
  scorecard?: SenderDeliverabilityScorecard | null;
  fromEmail?: string;
  domainActiveSenderRank?: number;
  activeSenderLimitPerDomain?: number;
}): SenderCapacityPolicy {
  const now = input.now ?? new Date();
  const warmupDay = senderWarmupDayNumber(input.account.createdAt, now, input.timeZone);
  const stage = warmupRampStage(warmupDay);
  const baseDailyCap = stage.dailyCap;
  const safeBusinessHours = Math.max(1, Math.round(input.businessHoursPerDay) || 8);
  const baseHourlyCap = Math.max(1, Math.ceil(baseDailyCap / safeBusinessHours));
  const nextAutomationFactor = automationFactor(input.row?.automationStatus);
  const nextLaunchFactor = launchFactor(input.row?.senderLaunchState);
  const nextHealthFactor = worstHealthFactor(input.row);
  const nextDeliverabilityFactor = deliverabilityFactor(input.scorecard);
  const activeSenderLimitPerDomain = Math.max(1, input.activeSenderLimitPerDomain ?? MAX_ACTIVE_SENDERS_PER_DOMAIN);
  const domainActiveSenderRank = Math.max(0, Number(input.domainActiveSenderRank ?? 0) || 0);
  const domainLimitBlocked =
    domainActiveSenderRank > 0 && domainActiveSenderRank > activeSenderLimitPerDomain;
  const dailyCap = domainLimitBlocked ? 0 : Math.min(MAX_SENDER_DAILY_CAP, baseDailyCap);
  const hourlyCap =
    dailyCap <= 0 ? 0 : Math.min(dailyCap, Math.max(1, Math.ceil(dailyCap / safeBusinessHours)));
  const warmupStage = warmupStageLabel(stage);

  return {
    warmupDay,
    warmupStage,
    baseDailyCap,
    baseHourlyCap,
    maxDailyCap: MAX_SENDER_DAILY_CAP,
    dailyCap,
    hourlyCap,
    automationFactor: nextAutomationFactor,
    launchFactor: nextLaunchFactor,
    healthFactor: nextHealthFactor,
    deliverabilityFactor: nextDeliverabilityFactor,
    domain: senderDomainFromInput({ row: input.row, fromEmail: input.fromEmail }),
    domainActiveSenderRank,
    activeSenderLimitPerDomain,
    domainLimitBlocked,
    summary: capacitySummary({
      warmupDay,
      warmupStage,
      row: input.row,
      scorecard: input.scorecard,
      domainLimitBlocked,
      activeSenderLimitPerDomain,
    }),
  };
}

export function buildSenderCapacitySnapshots(input: {
  senders: SenderCapacitySubject[];
  timeZone: string;
  businessHoursPerDay: number;
  usage?: SenderUsageMap;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const preliminary = input.senders.map((subject) => {
    const fromEmail = getOutreachAccountFromEmail(subject.account).trim().toLowerCase();
    const policy = calculateSenderCapacityPolicy({
      account: subject.account,
      now,
      timeZone: input.timeZone,
      businessHoursPerDay: input.businessHoursPerDay,
      row: subject.row,
      scorecard: subject.scorecard,
      fromEmail,
    });
    const usage = input.usage?.[subject.account.id] ?? { dailySent: 0, hourlySent: 0 };
    return {
      senderAccountId: subject.account.id,
      fromEmail,
      dailySent: usage.dailySent,
      hourlySent: usage.hourlySent,
      ...policy,
    } satisfies SenderCapacitySnapshot;
  });

  const activeRankBySenderId = new Map<string, number>();
  const snapshotsByDomain = new Map<string, SenderCapacitySnapshot[]>();
  for (const snapshot of preliminary) {
    if (!snapshot.domain) continue;
    const bucket = snapshotsByDomain.get(snapshot.domain) ?? [];
    bucket.push(snapshot);
    snapshotsByDomain.set(snapshot.domain, bucket);
  }

  for (const snapshots of snapshotsByDomain.values()) {
    const ranked = snapshots.filter((snapshot) => snapshot.dailyCap > 0).sort(compareSenderPriority);
    ranked.forEach((snapshot, index) => {
      activeRankBySenderId.set(snapshot.senderAccountId, index + 1);
    });
  }

  return preliminary.map((snapshot) => {
    const domainActiveSenderRank = activeRankBySenderId.get(snapshot.senderAccountId) ?? 0;
    const domainLimitBlocked =
      domainActiveSenderRank > 0 &&
      domainActiveSenderRank > MAX_ACTIVE_SENDERS_PER_DOMAIN;
    return {
      ...snapshot,
      dailyCap: domainLimitBlocked ? 0 : snapshot.dailyCap,
      hourlyCap: domainLimitBlocked ? 0 : snapshot.hourlyCap,
      domainActiveSenderRank,
      activeSenderLimitPerDomain: MAX_ACTIVE_SENDERS_PER_DOMAIN,
      domainLimitBlocked,
      summary: domainLimitBlocked
        ? `${snapshot.summary} · domain already has ${MAX_ACTIVE_SENDERS_PER_DOMAIN} active sending inboxes`
        : snapshot.summary,
    };
  });
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
