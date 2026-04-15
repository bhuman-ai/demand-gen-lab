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

export const MAX_ACTIVE_SENDERS_PER_DOMAIN = 4;
export const MAX_SENDER_DAILY_CAP = 100;
export const MAX_WARMUP_CAMPAIGN_DAILY_CAP = 25;
export const MAX_OUTBOUND_SENDER_DAILY_CAP = 60;

const OUTBOUND_RAMP_DAILY_CAPS = [3, 8, 15, 25, 40, MAX_OUTBOUND_SENDER_DAILY_CAP] as const;

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

function normalizeWarmupDay(day: number) {
  const parsed = Math.max(1, Math.floor(Number(day) || 1));
  return Number.isFinite(parsed) ? parsed : 1;
}

export function isWarmupCampaignName(value: string) {
  return /\bwarmup\b/i.test(value);
}

export function warmupDailyCapForDay(day: number) {
  return Math.min(MAX_SENDER_DAILY_CAP, normalizeWarmupDay(day) * 5);
}

export function warmupHourlyCapForDay(day: number, businessHoursPerDay = 8) {
  const dailyCap = warmupDailyCapForDay(day);
  const safeBusinessHours = Math.max(1, Math.round(businessHoursPerDay) || 8);
  return Math.min(dailyCap, Math.max(1, Math.ceil(dailyCap / safeBusinessHours)));
}

export function warmupMinSpacingMinutesForDay(day: number, businessHoursPerDay = 8) {
  const dailyCap = warmupDailyCapForDay(day);
  const safeBusinessHours = Math.max(1, Math.round(businessHoursPerDay) || 8);
  return Math.max(8, Math.floor((safeBusinessHours * 60) / Math.max(1, dailyCap)));
}

export function laneHourlyCapForDailyCap(dailyCap: number, businessHoursPerDay = 8) {
  const safeDailyCap = Math.max(0, Math.round(Number(dailyCap) || 0));
  if (safeDailyCap <= 0) return 0;
  const safeBusinessHours = Math.max(1, Math.round(businessHoursPerDay) || 8);
  return Math.min(safeDailyCap, Math.max(1, Math.ceil(safeDailyCap / safeBusinessHours)));
}

export function laneMinSpacingMinutesForDailyCap(dailyCap: number, businessHoursPerDay = 8) {
  const safeDailyCap = Math.max(0, Math.round(Number(dailyCap) || 0));
  if (safeDailyCap <= 0) return 0;
  const safeBusinessHours = Math.max(1, Math.round(businessHoursPerDay) || 8);
  return Math.max(8, Math.floor((safeBusinessHours * 60) / Math.max(1, safeDailyCap)));
}

export function warmupCampaignDailyCapForDay(day: number) {
  return Math.min(MAX_WARMUP_CAMPAIGN_DAILY_CAP, normalizeWarmupDay(day) * 5);
}

export function warmupCampaignHourlyCapForDay(day: number, businessHoursPerDay = 8) {
  return laneHourlyCapForDailyCap(warmupCampaignDailyCapForDay(day), businessHoursPerDay);
}

export function warmupCampaignMinSpacingMinutesForDay(day: number, businessHoursPerDay = 8) {
  return laneMinSpacingMinutesForDailyCap(warmupCampaignDailyCapForDay(day), businessHoursPerDay);
}

export function outboundDailyCapForDay(day: number, targetDailyCap = MAX_OUTBOUND_SENDER_DAILY_CAP) {
  const safeDay = normalizeWarmupDay(day);
  const safeTargetDailyCap = Math.max(
    1,
    Math.min(MAX_OUTBOUND_SENDER_DAILY_CAP, Math.round(Number(targetDailyCap) || MAX_OUTBOUND_SENDER_DAILY_CAP))
  );
  const rampCap = OUTBOUND_RAMP_DAILY_CAPS[Math.min(safeDay - 1, OUTBOUND_RAMP_DAILY_CAPS.length - 1)];
  return Math.min(safeTargetDailyCap, rampCap);
}

export function outboundHourlyCapForDay(day: number, targetDailyCap = MAX_OUTBOUND_SENDER_DAILY_CAP, businessHoursPerDay = 8) {
  return laneHourlyCapForDailyCap(outboundDailyCapForDay(day, targetDailyCap), businessHoursPerDay);
}

export function outboundMinSpacingMinutesForDay(
  day: number,
  targetDailyCap = MAX_OUTBOUND_SENDER_DAILY_CAP,
  businessHoursPerDay = 8
) {
  return laneMinSpacingMinutesForDailyCap(outboundDailyCapForDay(day, targetDailyCap), businessHoursPerDay);
}

function warmupRampStage(day: number) {
  const safeDay = normalizeWarmupDay(day);
  return {
    minDay: safeDay,
    maxDay: safeDay,
    dailyCap: warmupDailyCapForDay(safeDay),
    label: `Day ${safeDay}`,
  };
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

export function selectSenderAccountIdsWithinDomainLimit(
  snapshots: SenderCapacitySnapshot[],
  maxActiveSendersPerDomain = MAX_ACTIVE_SENDERS_PER_DOMAIN
) {
  const selected = new Set<string>();
  const snapshotsByDomain = new Map<string, SenderCapacitySnapshot[]>();

  for (const snapshot of snapshots) {
    if (!snapshot.domain) {
      selected.add(snapshot.senderAccountId);
      continue;
    }
    const bucket = snapshotsByDomain.get(snapshot.domain) ?? [];
    bucket.push(snapshot);
    snapshotsByDomain.set(snapshot.domain, bucket);
  }

  for (const domainSnapshots of snapshotsByDomain.values()) {
    domainSnapshots
      .filter((snapshot) => snapshot.dailyCap > 0)
      .sort(compareSenderPriority)
      .slice(0, Math.max(1, maxActiveSendersPerDomain))
      .forEach((snapshot) => {
        selected.add(snapshot.senderAccountId);
      });
  }

  return selected;
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
