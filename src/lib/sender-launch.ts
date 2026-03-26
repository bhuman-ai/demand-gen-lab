import { getBrandById, listBrands } from "@/lib/factory-data";
import { listExperimentRecords } from "@/lib/experiment-data";
import type {
  BrandRecord,
  DomainRow,
  ExperimentRecord,
  OutreachMessage,
  OutreachRun,
  ReplyThread,
  SenderLaunch,
  SenderLaunchAction,
  SenderLaunchEvent,
  SenderLaunchPlanType,
  SenderLaunchState,
} from "@/lib/factory-types";
import {
  createSenderLaunchEvent,
  listBrandRuns,
  listDeliverabilityProbeRuns,
  listOutreachAccounts,
  listReplyThreadsByBrand,
  listSenderLaunchActions,
  listRunMessages,
  listSenderLaunchEvents,
  listSenderLaunches,
  upsertSenderLaunch,
} from "@/lib/outreach-data";
import { getDomainDeliveryAccountId, getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import { buildSenderDeliverabilityScorecards } from "@/lib/outreach-deliverability";
import { syncBrandInboxMailbox } from "@/lib/outreach-runtime";
import { enrichBrandWithSenderHealth } from "@/lib/sender-health";
import { runSenderLaunchAutopilotForBrand } from "@/lib/sender-launch-autopilot";

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "this",
  "to",
  "we",
  "with",
  "your",
]);

type SenderMessageStats = {
  sentCount: number;
  repliedCount: number;
  bouncedCount: number;
  failedCount: number;
  lastSentAt: string;
};

type TopicProfile = {
  summary: string;
  keywords: string[];
  sourceExperimentIds: string[];
};

type BridgeStats = {
  mailboxAccountIds: string[];
  mailboxEmails: string[];
  threadCount: number;
  openThreadCount: number;
  uniqueContactDomains: number;
  lastActivityAt: string;
};

type SenderLaunchScores = {
  infraScore: number;
  reputationScore: number;
  trustScore: number;
  safetyScore: number;
  topicScore: number;
  readinessScore: number;
};

export type SenderLaunchView = {
  brand: BrandRecord;
  launches: SenderLaunch[];
  events: SenderLaunchEvent[];
  actions: SenderLaunchAction[];
};

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 3 && !STOPWORDS.has(entry) && !/^\d+$/.test(entry));
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function emailDomain(value: string) {
  const normalized = normalizeEmail(value);
  const at = normalized.lastIndexOf("@");
  return at >= 0 ? normalized.slice(at + 1) : "";
}

function topicProfileFromBrand(brand: BrandRecord, experiments: ExperimentRecord[]): TopicProfile {
  const texts = [
    brand.name,
    brand.website,
    brand.product,
    brand.notes,
    ...brand.targetMarkets,
    ...brand.idealCustomerProfiles,
    ...brand.keyFeatures,
    ...brand.keyBenefits,
    ...experiments.flatMap((experiment) => [experiment.name, experiment.offer, experiment.audience]),
  ].filter(Boolean);
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const token of tokenize(text)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  const keywords = [...counts.entries()]
    .sort((left, right) => {
      if (left[1] !== right[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 8)
    .map(([token]) => token);
  return {
    summary: keywords.length
      ? `Launch profile mirrors ${keywords.slice(0, 4).join(", ")}.`
      : "Launch profile is waiting for clearer experiment themes.",
    keywords,
    sourceExperimentIds: experiments.map((experiment) => experiment.id),
  };
}

function planTypeForRow(brand: BrandRecord, row: DomainRow): SenderLaunchPlanType {
  const protectedDomain =
    brand.domains.find((entry) => entry.role === "brand")?.domain ||
    normalizeDomain(brand.website) ||
    "";
  const senderDomain = normalizeDomain(row.domain);
  if (row.forwardingTargetUrl || (row.replyMailboxEmail && row.replyMailboxEmail !== row.fromEmail)) {
    return "bridge";
  }
  if (protectedDomain && (senderDomain === protectedDomain || senderDomain.endsWith(`.${protectedDomain}`))) {
    return "subdomain";
  }
  return "fresh";
}

function buildSenderMessageStats(runs: OutreachRun[], messages: OutreachMessage[]): Map<string, SenderMessageStats> {
  const runById = new Map(runs.map((run) => [run.id, run] as const));
  const statsBySender = new Map<string, SenderMessageStats>();
  for (const message of messages) {
    const run = runById.get(message.runId);
    const senderAccountId =
      String(message.generationMeta?.senderAccountId ?? "").trim() || run?.accountId.trim() || "";
    if (!senderAccountId) continue;
    const bucket = statsBySender.get(senderAccountId) ?? {
      sentCount: 0,
      repliedCount: 0,
      bouncedCount: 0,
      failedCount: 0,
      lastSentAt: "",
    };
    if (["sent", "replied", "bounced"].includes(message.status)) {
      bucket.sentCount += 1;
    }
    if (message.status === "replied") {
      bucket.repliedCount += 1;
    }
    if (message.status === "bounced") {
      bucket.bouncedCount += 1;
    }
    if (message.status === "failed") {
      bucket.failedCount += 1;
    }
    if (message.sentAt && (!bucket.lastSentAt || bucket.lastSentAt < message.sentAt)) {
      bucket.lastSentAt = message.sentAt;
    }
    statsBySender.set(senderAccountId, bucket);
  }
  return statsBySender;
}

function buildMailboxBridgeStats(threads: ReplyThread[]) {
  const statsByMailboxAccountId = new Map<string, BridgeStats>();
  const contactDomainsByMailboxAccountId = new Map<string, Set<string>>();
  for (const thread of threads) {
    if (thread.sourceType !== "mailbox") continue;
    const mailboxAccountId = thread.mailboxAccountId.trim();
    if (!mailboxAccountId) continue;
    const existing = statsByMailboxAccountId.get(mailboxAccountId) ?? {
      mailboxAccountIds: [mailboxAccountId],
      mailboxEmails: [],
      threadCount: 0,
      openThreadCount: 0,
      uniqueContactDomains: 0,
      lastActivityAt: "",
    };
    existing.threadCount += 1;
    if (thread.status !== "closed") existing.openThreadCount += 1;
    const contactDomains = contactDomainsByMailboxAccountId.get(mailboxAccountId) ?? new Set<string>();
    const contactDomain = emailDomain(thread.contactEmail);
    if (contactDomain) {
      contactDomains.add(contactDomain);
      contactDomainsByMailboxAccountId.set(mailboxAccountId, contactDomains);
      existing.uniqueContactDomains = contactDomains.size;
    }
    if (thread.lastMessageAt && (!existing.lastActivityAt || existing.lastActivityAt < thread.lastMessageAt)) {
      existing.lastActivityAt = thread.lastMessageAt;
    }
    statsByMailboxAccountId.set(mailboxAccountId, existing);
  }
  return statsByMailboxAccountId;
}

function buildMailboxIdsByEmail(accounts: Awaited<ReturnType<typeof listOutreachAccounts>>) {
  const mailboxIdsByEmail = new Map<string, string[]>();
  for (const account of accounts) {
    const mailboxEmail = normalizeEmail(account.config.mailbox.email);
    if (!mailboxEmail) continue;
    const existing = mailboxIdsByEmail.get(mailboxEmail) ?? [];
    if (!existing.includes(account.id)) {
      existing.push(account.id);
      mailboxIdsByEmail.set(mailboxEmail, existing);
    }
  }
  return mailboxIdsByEmail;
}

function resolveBridgeStatsForRow(input: {
  row: DomainRow;
  mailboxIdsByEmail: Map<string, string[]>;
  mailboxStatsById: Map<string, BridgeStats>;
}) {
  const mailboxIds = new Set<string>();
  const replyMailboxEmail = normalizeEmail(input.row.replyMailboxEmail ?? "");
  const fromEmail = normalizeEmail(input.row.fromEmail ?? "");
  for (const candidateEmail of [replyMailboxEmail, fromEmail]) {
    if (!candidateEmail) continue;
    for (const mailboxAccountId of input.mailboxIdsByEmail.get(candidateEmail) ?? []) {
      mailboxIds.add(mailboxAccountId);
    }
  }
  const deliveryAccountId = getDomainDeliveryAccountId(input.row);
  if (deliveryAccountId) mailboxIds.add(deliveryAccountId);

  const mailboxAccountIds = [...mailboxIds];
  const mailboxEmails = new Set<string>(
    [replyMailboxEmail, fromEmail].filter((value) => Boolean(value))
  );
  let threadCount = 0;
  let openThreadCount = 0;
  let uniqueContactDomains = 0;
  let lastActivityAt = "";

  for (const mailboxAccountId of mailboxAccountIds) {
    const stats = input.mailboxStatsById.get(mailboxAccountId);
    if (!stats) continue;
    threadCount += stats.threadCount;
    openThreadCount += stats.openThreadCount;
    uniqueContactDomains += stats.uniqueContactDomains;
    if (stats.lastActivityAt && (!lastActivityAt || lastActivityAt < stats.lastActivityAt)) {
      lastActivityAt = stats.lastActivityAt;
    }
  }

  return {
    mailboxAccountIds,
    mailboxEmails: [...mailboxEmails],
    threadCount,
    openThreadCount,
    uniqueContactDomains,
    lastActivityAt,
  } satisfies BridgeStats;
}

function scoreInfra(row: DomainRow) {
  let score = 0;
  if (row.fromEmail) score += 6;
  if (row.replyMailboxEmail) score += 4;
  if (row.dnsStatus === "verified") score += 12;
  else if (row.dnsStatus === "configured") score += 6;
  if (getDomainDeliveryAccountId(row)) score += 4;
  if (row.provider && row.provider !== "manual") score += 4;
  return clampInt(score, 0, 30);
}

function scoreReputation(
  row: DomainRow,
  scorecard: ReturnType<typeof buildSenderDeliverabilityScorecards>[number] | null
) {
  if (scorecard) {
    if (scorecard.autoPaused) return 0;
    if (scorecard.totalMonitors > 0) {
      const score = scorecard.inboxRate * 18 + Math.max(0, 1 - scorecard.spamRate) * 7;
      return clampInt(score, 0, 25);
    }
  }
  if (row.domainHealth === "healthy" && row.messagingHealth === "healthy") return 16;
  if (row.domainHealth === "watch" || row.messagingHealth === "watch") return 10;
  if (row.domainHealth === "queued" || row.messagingHealth === "queued") return 6;
  if (row.domainHealth === "risky" || row.messagingHealth === "risky") return 0;
  return 8;
}

function scoreTrust(
  row: DomainRow,
  planType: SenderLaunchPlanType,
  stats: SenderMessageStats | null,
  topic: TopicProfile,
  scorecard: ReturnType<typeof buildSenderDeliverabilityScorecards>[number] | null,
  bridge: BridgeStats,
  autopilotSignalCount: number
) {
  let score = 0;
  if (planType === "bridge") score += 4;
  if (row.replyMailboxEmail) score += 2;
  if (bridge.threadCount > 0) score += Math.min(8, 3 + bridge.threadCount);
  if (bridge.uniqueContactDomains > 0) score += Math.min(3, bridge.uniqueContactDomains);
  if (stats?.sentCount) score += Math.min(4, 1 + Math.floor(stats.sentCount / 25));
  if (stats?.repliedCount) score += Math.min(7, 3 + Math.floor(stats.repliedCount / 2));
  if ((scorecard?.inboxRate ?? 0) >= 0.7) score += 2;
  if (autopilotSignalCount > 0) score += Math.min(3, autopilotSignalCount);
  if (topic.keywords.length >= 3 && bridge.threadCount > 0) score += 1;
  return clampInt(score, 0, 20);
}

function scoreSafety(
  row: DomainRow,
  stats: SenderMessageStats | null,
  scorecard: ReturnType<typeof buildSenderDeliverabilityScorecards>[number] | null
) {
  let score = 15;
  const totalSent = Math.max(1, stats?.sentCount ?? 0);
  const bounceRate = (stats?.bouncedCount ?? 0) / totalSent;
  const failRate = (stats?.failedCount ?? 0) / totalSent;
  if (bounceRate >= 0.1) score -= 8;
  else if (bounceRate >= 0.03) score -= 4;
  if (failRate >= 0.1) score -= 4;
  else if (failRate >= 0.03) score -= 2;
  if ((scorecard?.spamRate ?? 0) >= 0.15) score -= 5;
  else if ((scorecard?.spamRate ?? 0) >= 0.05) score -= 2;
  if (scorecard?.autoPaused) score -= 10;
  if (row.domainHealth === "risky" || row.messagingHealth === "risky") score -= 8;
  return clampInt(score, 0, 15);
}

function scoreTopic(topic: TopicProfile) {
  if (!topic.keywords.length) return 0;
  if (topic.sourceExperimentIds.length > 0 && topic.keywords.length >= 6) return 10;
  if (topic.sourceExperimentIds.length > 0 && topic.keywords.length >= 3) return 8;
  return 5;
}

function dailyCapForState(state: SenderLaunchState) {
  if (state === "ready") return 120;
  if (state === "restricted_send") return 25;
  if (state === "warming") return 15;
  if (state === "observing") return 5;
  return 0;
}

function summaryForState(input: {
  state: SenderLaunchState;
  planType: SenderLaunchPlanType;
  row: DomainRow;
  topic: TopicProfile;
  scorecard: ReturnType<typeof buildSenderDeliverabilityScorecards>[number] | null;
  stats: SenderMessageStats | null;
  bridge: BridgeStats;
}) {
  if (input.state === "blocked") {
    if (!input.row.fromEmail) {
      return {
        summary: "Launch is blocked until this sender mailbox is attached.",
        nextStep: "Attach a sender mailbox.",
      };
    }
    if (input.row.dnsStatus === "error") {
      return {
        summary: "Launch is blocked because sender DNS is broken.",
        nextStep: "Repair sender DNS and retry launch.",
      };
    }
    return {
      summary: "Launch is blocked until sender setup is completed.",
      nextStep: "Finish sender setup.",
    };
  }
  if (input.state === "setup") {
    return {
      summary: "Launch is waiting for DNS verification and mailbox wiring before trust-building can start.",
      nextStep: "Wait for DNS verification to finish.",
    };
  }
  if (input.state === "paused") {
    return {
      summary:
        input.scorecard?.autoPaused === true
          ? "Launch is paused because recent deliverability checks cooled this sender automatically."
          : "Launch is paused because sender safety signals are below the safe threshold.",
      nextStep: "Wait for healthier placement or resume after fixing the sender.",
    };
  }
  if (input.state === "observing") {
    if (input.bridge.threadCount > 0) {
      return {
        summary: `Launch is observing ${input.bridge.threadCount} real inbox thread${input.bridge.threadCount === 1 ? "" : "s"} through the bridge mailbox while ${input.topic.keywords.slice(0, 3).join(", ") || "the active niche"} settles.`,
        nextStep: "Keep legitimate inbox activity flowing through the reply mailbox.",
      };
    }
    return {
      summary: `Launch is collecting early trust around ${input.topic.keywords.slice(0, 3).join(", ") || "the active niche"} before normal outbound starts.`,
      nextStep: input.planType === "bridge" ? "Keep bridge traffic flowing until trust signals improve." : "Keep collecting positive delivery signal.",
    };
  }
  if (input.state === "warming") {
    if (input.bridge.threadCount > 0) {
      return {
        summary: `Launch is using ${input.bridge.threadCount} real bridge thread${input.bridge.threadCount === 1 ? "" : "s"} to support a low-volume warm lane.`,
        nextStep: "Keep bridge traffic active while outbound stays limited.",
      };
    }
    if ((input.stats?.repliedCount ?? 0) <= 0) {
      return {
        summary: "Launch is active on a low-volume warm lane, but restricted send is still waiting for a real trust signal.",
        nextStep: "Wait for healthy probes, real replies, or bridge inbox activity before more volume unlocks.",
      };
    }
    return {
      summary: "Launch is active on a low-volume lane while reputation and replies settle.",
      nextStep: "Keep sending on the limited warm lane.",
    };
  }
  if (input.state === "restricted_send") {
    if (input.bridge.threadCount > 0) {
      return {
        summary: `Launch is allowing restricted outbound with ${input.bridge.threadCount} real bridge thread${input.bridge.threadCount === 1 ? "" : "s"} and ${Math.max(0, input.stats?.repliedCount ?? 0)} reply signal${(input.stats?.repliedCount ?? 0) === 1 ? "" : "s"} behind it.`,
        nextStep: "Keep outbound restricted while real inbox activity continues.",
      };
    }
    return {
      summary: `Launch is allowing real outbound in a restricted lane while ${Math.max(0, input.stats?.repliedCount ?? 0)} reply signal${(input.stats?.repliedCount ?? 0) === 1 ? "" : "s"} accumulate.`,
      nextStep: "Keep outbound restricted to the safest audience.",
    };
  }
  return {
    summary: "Launch is healthy enough to let the sender use normal routing and capacity controls.",
    nextStep: "Keep monitoring sender health while normal traffic runs.",
  };
}

function launchStateForInput(input: {
  row: DomainRow;
  scorecard: ReturnType<typeof buildSenderDeliverabilityScorecards>[number] | null;
  scores: SenderLaunchScores;
  stats: SenderMessageStats | null;
  bridge: BridgeStats;
  autopilotSignalCount: number;
}) {
  const { row, scorecard, scores, stats, bridge, autopilotSignalCount } = input;
  if (!row.fromEmail || !getDomainDeliveryAccountId(row)) return "blocked" as const;
  if (row.dnsStatus === "error") return "blocked" as const;
  if (row.dnsStatus !== "verified") return "setup" as const;
  if (scorecard?.autoPaused || row.domainHealth === "risky" || row.messagingHealth === "risky" || scores.safetyScore <= 4) {
    return "paused" as const;
  }
  const hasHealthyProbe = (scorecard?.inboxRate ?? 0) >= 0.7 && (scorecard?.spamRate ?? 0) <= 0.1;
  const hasReplySignal = (stats?.repliedCount ?? 0) > 0;
  const hasBridgeSignal = bridge.threadCount > 0;
  const hasAutopilotSignal = autopilotSignalCount > 0;
  if (scores.readinessScore < 55) return "observing" as const;
  if (!hasHealthyProbe && !hasReplySignal && !hasBridgeSignal && !hasAutopilotSignal) return "warming" as const;
  if (scores.readinessScore < 72) return "warming" as const;
  if (scores.readinessScore < 85 || ((stats?.repliedCount ?? 0) <= 0 && !hasBridgeSignal && !hasAutopilotSignal)) {
    return "restricted_send" as const;
  }
  return "ready" as const;
}

function buildLaunchScores(input: {
  row: DomainRow;
  planType: SenderLaunchPlanType;
  stats: SenderMessageStats | null;
  topic: TopicProfile;
  scorecard: ReturnType<typeof buildSenderDeliverabilityScorecards>[number] | null;
  bridge: BridgeStats;
  autopilotSignalCount: number;
}): SenderLaunchScores {
  const infraScore = scoreInfra(input.row);
  const reputationScore = scoreReputation(input.row, input.scorecard);
  const trustScore = scoreTrust(
    input.row,
    input.planType,
    input.stats,
    input.topic,
    input.scorecard,
    input.bridge,
    input.autopilotSignalCount
  );
  const safetyScore = scoreSafety(input.row, input.stats, input.scorecard);
  const topicScore = scoreTopic(input.topic);
  const readinessScore = clampInt(
    infraScore + reputationScore + trustScore + safetyScore + topicScore,
    0,
    100
  );
  return {
    infraScore,
    reputationScore,
    trustScore,
    safetyScore,
    topicScore,
    readinessScore,
  };
}

function applyLaunchToDomainRow(row: DomainRow, launch: SenderLaunch | null): DomainRow {
  if (!launch) return row;
  return {
    ...row,
    senderLaunchId: launch.id,
    senderLaunchPlanType: launch.planType,
    senderLaunchState: launch.state,
    senderLaunchScore: launch.readinessScore,
    senderLaunchSummary: launch.summary,
    senderLaunchNextStep: launch.nextStep,
    senderLaunchTopicSummary: launch.topicSummary,
    senderLaunchDailyCap: launch.dailyCap,
    senderLaunchLastEvaluatedAt: launch.lastEvaluatedAt,
    senderLaunchAutopilotMode: launch.autopilotMode,
    senderLaunchAutopilotAllowedDomains: launch.autopilotAllowedDomains,
    senderLaunchAutopilotBlockedDomains: launch.autopilotBlockedDomains,
  };
}

function eventAlreadyExists(events: SenderLaunchEvent[], launchId: string, eventType: SenderLaunchEvent["eventType"]) {
  return events.some((event) => event.senderLaunchId === launchId && event.eventType === eventType);
}

function buildStateChangeTitle(state: SenderLaunchState) {
  if (state === "setup") return "Launch returned to setup";
  if (state === "observing") return "Launch moved to observing";
  if (state === "warming") return "Launch moved to warming";
  if (state === "restricted_send") return "Restricted send unlocked";
  if (state === "ready") return "Sender launch ready";
  if (state === "paused") return "Sender launch paused";
  return "Sender launch blocked";
}

async function buildSenderLaunchesForBrand(brandId: string) {
  const brand = await getBrandById(brandId);
  if (!brand) return null;

  const [
    enrichedBrand,
    experiments,
    accounts,
    probeRuns,
    brandRuns,
    existingLaunches,
    existingEvents,
    existingActions,
    replyThreadsResult,
  ] =
    await Promise.all([
      enrichBrandWithSenderHealth(brand),
      listExperimentRecords(brandId),
      listOutreachAccounts(),
      listDeliverabilityProbeRuns({ brandId, limit: 300 }),
      listBrandRuns(brandId),
      listSenderLaunches({ brandId }, { allowMissingTable: true }),
      listSenderLaunchEvents({ brandId, limit: 200 }, { allowMissingTable: true }),
      listSenderLaunchActions({ brandId }, { allowMissingTable: true }),
      listReplyThreadsByBrand(brandId),
    ]);

  const senderRows = enrichedBrand.domains.filter((row) => row.role !== "brand");
  const senderAccountIds = new Set(
    senderRows.map((row) => getDomainDeliveryAccountId(row)).filter((value): value is string => Boolean(value))
  );
  const senderEmails = new Set(senderRows.map((row) => String(row.fromEmail ?? "").trim().toLowerCase()).filter(Boolean));
  const senderAccounts = accounts.filter((account) => {
    if (account.accountType === "mailbox") return false;
    const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
    return senderAccountIds.has(account.id) || (fromEmail ? senderEmails.has(fromEmail) : false);
  });
  const scorecards = buildSenderDeliverabilityScorecards({
    probeRuns,
    senderAccounts,
  });
  const scorecardByAccountId = new Map(
    scorecards
      .filter((scorecard) => scorecard.senderAccountId)
      .map((scorecard) => [scorecard.senderAccountId, scorecard] as const)
  );
  const messages = (
    await Promise.all(brandRuns.map(async (run) => listRunMessages(run.id)))
  ).flat();
  const messageStatsBySender = buildSenderMessageStats(brandRuns, messages);
  const mailboxIdsByEmail = buildMailboxIdsByEmail(accounts);
  const mailboxBridgeStats = buildMailboxBridgeStats(replyThreadsResult.threads);
  const topic = topicProfileFromBrand(brand, experiments);
  const existingBySenderId = new Map(existingLaunches.map((launch) => [launch.senderAccountId, launch] as const));
  const autopilotSignalCountBySenderId = new Map<string, number>();
  const autopilotLastSignalAtBySenderId = new Map<string, string>();
  for (const event of existingEvents) {
    if (!["opt_in_completed", "double_opt_in_confirmed", "inquiry_completed"].includes(event.eventType)) continue;
    autopilotSignalCountBySenderId.set(
      event.senderAccountId,
      (autopilotSignalCountBySenderId.get(event.senderAccountId) ?? 0) + 1
    );
    const current = autopilotLastSignalAtBySenderId.get(event.senderAccountId) ?? "";
    if (!current || current < event.occurredAt) {
      autopilotLastSignalAtBySenderId.set(event.senderAccountId, event.occurredAt);
    }
  }
  const nextEvents = [...existingEvents];
  const launches: SenderLaunch[] = [];

  for (const row of senderRows) {
    const senderAccountId = getDomainDeliveryAccountId(row);
    if (!senderAccountId) continue;
    const existing = existingBySenderId.get(senderAccountId) ?? null;
    const planType = planTypeForRow(enrichedBrand, row);
    const stats = messageStatsBySender.get(senderAccountId) ?? null;
    const scorecard = scorecardByAccountId.get(senderAccountId) ?? null;
    const autopilotSignalCount = autopilotSignalCountBySenderId.get(senderAccountId) ?? 0;
    const bridge = resolveBridgeStatsForRow({
      row,
      mailboxIdsByEmail,
      mailboxStatsById: mailboxBridgeStats,
    });
    const scores = buildLaunchScores({
      row,
      planType,
      stats,
      topic,
      scorecard,
      bridge,
      autopilotSignalCount,
    });
    const state = launchStateForInput({
      row,
      scorecard,
      scores,
      stats,
      bridge,
      autopilotSignalCount,
    });
    const text = summaryForState({
      state,
      planType,
      row,
      topic,
      scorecard,
      stats,
      bridge,
    });
    const launch = await upsertSenderLaunch(
      {
        id: existing?.id,
        senderAccountId,
        brandId,
        fromEmail: row.fromEmail?.trim().toLowerCase() || "",
        domain: row.domain,
        planType,
        state,
        readinessScore: scores.readinessScore,
        summary: text.summary,
        nextStep: text.nextStep,
        topicSummary: topic.summary,
        topicKeywords: topic.keywords,
        sourceExperimentIds: topic.sourceExperimentIds,
        infraScore: scores.infraScore,
        reputationScore: scores.reputationScore,
        trustScore: scores.trustScore,
        safetyScore: scores.safetyScore,
        topicScore: scores.topicScore,
        dailyCap: dailyCapForState(state),
        sentCount: stats?.sentCount ?? 0,
        repliedCount: stats?.repliedCount ?? 0,
        bouncedCount: stats?.bouncedCount ?? 0,
        failedCount: stats?.failedCount ?? 0,
        inboxRate: scorecard?.inboxRate ?? 0,
        spamRate: scorecard?.spamRate ?? 0,
        trustEventCount:
          (stats?.repliedCount ?? 0) +
          ((scorecard?.inboxRate ?? 0) >= 0.7 ? 1 : 0) +
          (planType === "bridge" ? 1 : 0) +
          bridge.threadCount +
          autopilotSignalCount,
        pausedUntil: scorecard?.autoPauseUntil ?? "",
        pauseReason: scorecard?.autoPaused ? scorecard.autoPauseReason : "",
        lastEventAt:
          [bridge.lastActivityAt, stats?.lastSentAt ?? "", scorecard?.checkedAt ?? "", autopilotLastSignalAtBySenderId.get(senderAccountId) ?? ""]
            .filter(Boolean)
            .sort()
            .at(-1) ?? "",
        lastEvaluatedAt: new Date().toISOString(),
        autopilotMode: existing?.autopilotMode ?? "curated_plus_open_web",
        autopilotAllowedDomains: existing?.autopilotAllowedDomains ?? [],
        autopilotBlockedDomains: existing?.autopilotBlockedDomains ?? [],
      },
      { allowMissingTable: true }
    );
    launches.push(launch);

    if (!existing) {
      const created = await createSenderLaunchEvent(
        {
          senderLaunchId: launch.id,
          senderAccountId,
          brandId,
          eventType: "launch_initialized",
          title: "Sender launch initialized",
          detail: `Plan ${launch.planType} started for ${launch.fromEmail}.`,
          metadata: {
            planType: launch.planType,
            state: launch.state,
          },
          occurredAt: launch.lastEvaluatedAt,
        },
        { allowMissingTable: true }
      );
      nextEvents.unshift(created);
    }

    if (existing && existing.topicSummary !== launch.topicSummary) {
      const event = await createSenderLaunchEvent(
        {
          senderLaunchId: launch.id,
          senderAccountId,
          brandId,
          eventType: "topic_profile_refreshed",
          title: "Launch topic profile refreshed",
          detail: launch.topicSummary,
          metadata: {
            keywords: launch.topicKeywords,
          },
          occurredAt: launch.lastEvaluatedAt,
        },
        { allowMissingTable: true }
      );
      nextEvents.unshift(event);
    }

    if (!eventAlreadyExists(nextEvents, launch.id, "bridge_inbound_recorded") && bridge.threadCount > 0) {
      const bridgeMailboxLabel =
        bridge.mailboxEmails[0] ?? row.replyMailboxEmail?.trim().toLowerCase() ?? row.fromEmail?.trim().toLowerCase() ?? "the reply mailbox";
      const event = await createSenderLaunchEvent(
        {
          senderLaunchId: launch.id,
          senderAccountId,
          brandId,
          eventType: "bridge_inbound_recorded",
          title: "Bridge lane recorded real inbound",
          detail: `${bridge.threadCount} real inbox thread${bridge.threadCount === 1 ? "" : "s"} reached ${bridgeMailboxLabel}.`,
          metadata: {
            threadCount: bridge.threadCount,
            openThreadCount: bridge.openThreadCount,
            uniqueContactDomains: bridge.uniqueContactDomains,
            mailboxAccountIds: bridge.mailboxAccountIds,
            mailboxEmails: bridge.mailboxEmails,
          },
          occurredAt: bridge.lastActivityAt || launch.lastEvaluatedAt,
        },
        { allowMissingTable: true }
      );
      nextEvents.unshift(event);
    }

    if (!eventAlreadyExists(nextEvents, launch.id, "healthy_probe_recorded") && launch.inboxRate >= 0.7 && launch.spamRate <= 0.1) {
      const event = await createSenderLaunchEvent(
        {
          senderLaunchId: launch.id,
          senderAccountId,
          brandId,
          eventType: "healthy_probe_recorded",
          title: "Healthy inbox placement recorded",
          detail: `Recent probes show ${Math.round(launch.inboxRate * 100)}% inbox placement.`,
          metadata: {
            inboxRate: launch.inboxRate,
            spamRate: launch.spamRate,
          },
          occurredAt: launch.lastEvaluatedAt,
        },
        { allowMissingTable: true }
      );
      nextEvents.unshift(event);
    }

    if (!eventAlreadyExists(nextEvents, launch.id, "first_reply_recorded") && launch.repliedCount > 0) {
      const event = await createSenderLaunchEvent(
        {
          senderLaunchId: launch.id,
          senderAccountId,
          brandId,
          eventType: "first_reply_recorded",
          title: "First reply signal recorded",
          detail: `${launch.repliedCount} replied message${launch.repliedCount === 1 ? "" : "s"} seen for this sender.`,
          metadata: {
            repliedCount: launch.repliedCount,
          },
          occurredAt: launch.lastEvaluatedAt,
        },
        { allowMissingTable: true }
      );
      nextEvents.unshift(event);
    }

    if (existing?.state !== launch.state) {
      const eventType =
        launch.state === "paused" ? "launch_paused" : existing?.state === "paused" ? "launch_resumed" : "state_changed";
      const event = await createSenderLaunchEvent(
        {
          senderLaunchId: launch.id,
          senderAccountId,
          brandId,
          eventType,
          title: buildStateChangeTitle(launch.state),
          detail: `${launch.fromEmail} is now ${launch.state.replace("_", " ")} with score ${launch.readinessScore}/100.`,
          metadata: {
            previousState: existing?.state ?? "",
            nextState: launch.state,
            readinessScore: launch.readinessScore,
          },
          occurredAt: launch.lastEvaluatedAt,
        },
        { allowMissingTable: true }
      );
      nextEvents.unshift(event);
    }
  }

  const launchBySenderId = new Map(launches.map((launch) => [launch.senderAccountId, launch] as const));
  return {
    brand: {
      ...enrichedBrand,
      domains: enrichedBrand.domains.map((row) =>
        applyLaunchToDomainRow(row, launchBySenderId.get(getDomainDeliveryAccountId(row) || "") ?? null)
      ),
    },
    launches,
    events: nextEvents.sort((left, right) => (left.occurredAt < right.occurredAt ? 1 : -1)),
    actions: existingActions.sort((left, right) => {
      const leftTimestamp = left.completedAt || left.updatedAt || left.createdAt;
      const rightTimestamp = right.completedAt || right.updatedAt || right.createdAt;
      return leftTimestamp < rightTimestamp ? 1 : -1;
    }),
  } satisfies SenderLaunchView;
}

export async function loadBrandSenderLaunchView(brandId: string): Promise<SenderLaunchView | null> {
  return buildSenderLaunchesForBrand(brandId);
}

export async function runSenderLaunchTick(limit = 10, options: { mailboxSync?: boolean } = {}) {
  const brands = await listBrands();
  const candidates = brands.filter((brand) => brand.domains.some((row) => row.role !== "brand")).slice(0, limit);
  const errors: Array<{ brandId: string; error: string }> = [];
  let brandsProcessed = 0;
  let launchesUpdated = 0;
  let mailboxesSynced = 0;
  let importedInboxMessages = 0;
  let actionsScheduled = 0;
  let actionsCompleted = 0;
  let actionsFailed = 0;
  const shouldSyncMailboxes = options.mailboxSync !== false;
  for (const brand of candidates) {
    try {
      if (shouldSyncMailboxes) {
        const syncResult = await syncBrandInboxMailbox({
          brandId: brand.id,
          maxMessages: 25,
        }).catch((error: unknown) => ({
          ok: false,
          reason: error instanceof Error ? error.message : "Mailbox sync failed",
          importedCount: 0,
        }));
        if (syncResult.ok) {
          mailboxesSynced += 1;
          importedInboxMessages += syncResult.importedCount;
        }
      }
      const view = await loadBrandSenderLaunchView(brand.id);
      if (view) {
        const autopilot = await runSenderLaunchAutopilotForBrand({
          brandId: brand.id,
          launches: view.launches,
        });
        actionsScheduled += autopilot.actionsScheduled;
        actionsCompleted += autopilot.actionsCompleted;
        actionsFailed += autopilot.actionsFailed;
      }
      brandsProcessed += 1;
      launchesUpdated += view?.launches.length ?? 0;
    } catch (error) {
      errors.push({
        brandId: brand.id,
        error: error instanceof Error ? error.message : "Failed to update sender launches.",
      });
    }
  }
  return {
    brandsChecked: candidates.length,
    brandsProcessed,
    launchesUpdated,
    mailboxesSynced,
    importedInboxMessages,
    actionsScheduled,
    actionsCompleted,
    actionsFailed,
    errors,
  };
}
