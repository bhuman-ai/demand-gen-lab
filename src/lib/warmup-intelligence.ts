import { getBrandById } from "@/lib/factory-data";
import type {
  BrandRecord,
  DeliverabilityProbeRun,
  OutreachAccount,
  OutreachRun,
  ReplyThread,
  ScaleCampaignRecord,
} from "@/lib/factory-types";
import { listScaleCampaignRecords, resolveScaleCampaignLane } from "@/lib/experiment-data";
import { getOperatorBrandContext } from "@/lib/operator-context";
import { getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import {
  listBrandRuns,
  listDeliverabilityProbeRuns,
  listOutreachAccounts,
  listReplyThreadsByBrand,
} from "@/lib/outreach-data";

type SenderLike = Pick<OutreachAccount, "id" | "name" | "createdAt" | "status" | "config"> & {
  fromEmail?: string;
};

type WarmupPosture =
  | "no_sender"
  | "fresh"
  | "reply_acquisition"
  | "probe_needed"
  | "micro_outreach_ready"
  | "recovery";

export type WarmupSenderEvidence = {
  senderAccountId: string;
  senderName: string;
  fromEmail: string;
  accountAgeDays: number;
  posture: WarmupPosture;
  warmupCampaignIds: string[];
  warmupRunIds: string[];
  evidence: {
    warmupSent: number;
    warmupReplies: number;
    warmupPositiveReplies: number;
    warmupNegativeReplies: number;
    warmupBounces: number;
    warmupFailures: number;
    replyThreads: number;
    positiveThreads: number;
    negativeThreads: number;
    questionThreads: number;
    progressedThreads: number;
    latestPlacement: string;
    latestPlacementSummary: string;
    latestPlacementAt: string;
  };
  agentRead: {
    whatThisMeans: string;
    nextQuestions: string[];
    usefulMoves: string[];
  };
};

export type BrandWarmupEvidenceSnapshot = {
  version: 1;
  generatedAt: string;
  brandId: string;
  brandName: string;
  principle: string;
  senders: WarmupSenderEvidence[];
  rollup: {
    senderCount: number;
    bestPosture: WarmupPosture;
    totalWarmupSent: number;
    totalWarmupReplies: number;
    totalReplyThreads: number;
    totalPositiveThreads: number;
    totalNegativeThreads: number;
    sendersNeedingProbe: number;
    sendersInRecovery: number;
  };
  agentPrompt: string[];
};

const WARMUP_OPERATING_GUIDE = {
  version: 1,
  id: "lastb2b_reply_acquisition_warmup_guide_v1",
  title: "Reply acquisition warmup guide",
  stance:
    "Warmup is not a day-by-day script. Treat it as an agent-run reply acquisition and inbox-trust loop. Use the evidence snapshot, choose the next legitimate move, and write self-reflection when the same move repeats without changing outcomes.",
  model:
    "The sender should look and behave like a real working mailbox because it is one: real inbound, real replies, real vendor/support/partner conversations, exact-copy seed probes, then tiny reply-focused outreach.",
  emailSetupPrinciples: [
    "Sender setup and warmup are separate questions. First prove the sender route can send and receive. Then prove exact campaign bodies land acceptably. Then earn real replies before any ramp.",
    "A sender can be technically ready but still not reputation-ready. Ready transport only means the route can send; it does not mean cold volume should start.",
    "When sender reputation is weak or placement is poor, prefer reply acquisition, controlled business threads, route/provider checks, and exact-copy placement tests over more cold sends.",
    "If no campaign or warmup inventory is sendable, the agent should inspect campaign readiness and prep state before blaming the sender.",
  ],
  decisionQuestions: [
    "What would a real operator with this brand and this inbox do today to get a useful reply?",
    "What evidence says this sender is gaining trust, stalling, or getting worse?",
    "Which move creates legitimate conversation instead of fake activity?",
    "What should be tested with the real campaign body before any prospect ramp?",
    "Is this a sender reputation problem, a campaign/readiness problem, a list/prep problem, a provider problem, or a missing platform capability?",
  ],
  capabilityMoves: [
    {
      id: "controlled_threads",
      description:
        "Use controlled trusted inboxes or friendly contacts for real back-and-forth. Mix inbound-first and outbound-first threads.",
      goodEvidence: ["reply received", "follow-up answered", "thread has a real question or useful business context"],
      avoid: ["empty thanks loops", "same template to every controlled inbox", "pretending a fake business need exists"],
    },
    {
      id: "inbound_footprint",
      description:
        "Create ordinary mailbox life through relevant newsletters, SaaS trials, support threads, events, communities, or vendor updates.",
      goodEvidence: ["real inbound mail", "occasional replies from the sender", "topics overlap the brand's market"],
      avoid: ["irrelevant bulk signups", "newsletter volume as a substitute for replies"],
    },
    {
      id: "vendor_research",
      description:
        "Ask SaaS sales/support teams, agencies, service providers, newsletter owners, partner managers, or freelancers questions the brand might actually care about. If campaign inventory is empty, choose an available lead-source provider from the tool catalog, including Airscale when its filters fit the brand context.",
      goodEvidence: ["pricing/info reply", "question back", "case study/rate card/demo/info exchange"],
      avoid: ["wasting people with fake purchase intent", "asking about products unrelated to the brand"],
    },
    {
      id: "exact_copy_probes",
      description:
        "Probe inbox placement using the same sender route and actual campaign subject/body that would be sent to prospects.",
      goodEvidence: ["mostly inbox across seed monitors", "no provider send errors", "monitor pool healthy"],
      avoid: ["synthetic probe copy as proof", "spam-score-only proof for a real campaign body"],
    },
    {
      id: "reply_likely_outbound",
      description:
        "Before normal cold outreach, send tiny batches where replies are unusually likely because the ask is useful, specific, and legitimate.",
      goodEvidence: ["positive or helpful reply", "multi-turn thread", "recipient asks a real question back"],
      avoid: ["broad prospecting", "pitch-first copy", "volume growth before replies or placement proof"],
    },
    {
      id: "recovery",
      description:
        "When placement, bounces, provider errors, or negative replies deteriorate, stop ramping and move back to reply acquisition, seed probes, and route repair.",
      goodEvidence: ["problem stops recurring", "new placement proof improves", "reply quality improves"],
      avoid: ["increasing volume to fix reputation", "switching providers to hide a sender problem"],
    },
  ],
  evidenceSignals: [
    "inbox placement for exact campaign copy",
    "real replies from non-seed accounts",
    "positive/helpful reply threads",
    "questions back from recipients",
    "thread progress score from reply-state compiler",
    "bounce/failure/negative-reply trend",
    "route/provider errors",
  ],
  volumeGuidance:
    "Fresh or unproven senders should stay at single-digit daily warmup until the agent can point to real replies and acceptable placement. Any ramp should be an evidence-backed choice, not a calendar habit.",
  agentInstructions: [
    "Do not ask an LLM whether copy sounds human. Judge whether a selfish busy recipient has a real reason to answer.",
    "Do not create fake brands, fake personas, fake buyer intent, or fake warmup loops.",
    "Prefer one legitimate reply-prone action over many low-signal sends.",
    "If the inbox has no current placement proof, run or inspect exact-copy seed probes before prospect ramp.",
    "If a warmup campaign has no sendable inventory or repeated prep failures, inspect campaign/readiness evidence before retrying the same move.",
    "If the blocker is sourcing/provider-specific, do not treat that as no possible move. Inspect the tool catalog and choose another lead-source route such as Airscale when the brand/campaign context gives enough filters.",
    "If a move repeats without improving replies, placement, or state, write that in self-reflection and choose a different move.",
  ],
} as const;

export type WarmupOperatingGuide = typeof WARMUP_OPERATING_GUIDE;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toDateMs(value: string) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function accountAgeDays(createdAt: string, now = new Date()) {
  const created = toDateMs(createdAt);
  if (!created) return 0;
  return Math.max(0, Math.floor((now.getTime() - created) / (24 * 60 * 60 * 1000)));
}

function campaignSenderId(campaign: Pick<ScaleCampaignRecord, "scalePolicy">) {
  return normalizeText(campaign.scalePolicy.accountId || campaign.scalePolicy.mailboxAccountId);
}

function isWarmupCampaign(campaign: ScaleCampaignRecord) {
  return resolveScaleCampaignLane(campaign) === "warmup";
}

function runSenderId(run: OutreachRun) {
  return normalizeText(run.lockedSenderAccountId || run.accountId);
}

function latestProbeForSender(
  probes: DeliverabilityProbeRun[],
  senderAccountId: string,
  fromEmail: string
) {
  const normalizedEmail = fromEmail.trim().toLowerCase();
  return (
    probes
      .filter((probe) => {
        if (probe.status !== "completed") return false;
        if (senderAccountId && probe.senderAccountId === senderAccountId) return true;
        return Boolean(normalizedEmail && probe.fromEmail.trim().toLowerCase() === normalizedEmail);
      })
      .sort((left, right) => {
        const leftAt = left.completedAt || left.updatedAt || left.createdAt;
        const rightAt = right.completedAt || right.updatedAt || right.createdAt;
        return toDateMs(rightAt) - toDateMs(leftAt);
      })[0] ?? null
  );
}

function postureFor(input: {
  senderPresent: boolean;
  sent: number;
  replies: number;
  positiveThreads: number;
  negativeThreads: number;
  bounces: number;
  failures: number;
  latestPlacement: string;
  latestProbePresent: boolean;
}) {
  if (!input.senderPresent) return "no_sender" satisfies WarmupPosture;
  const attempted = Math.max(1, input.sent + input.bounces + input.failures);
  const badDeliveryRate = (input.bounces + input.failures) / attempted;
  if (
    input.latestPlacement === "spam" ||
    input.latestPlacement === "all_mail_only" ||
    input.negativeThreads > Math.max(1, input.positiveThreads) ||
    badDeliveryRate >= 0.1
  ) {
    return "recovery" satisfies WarmupPosture;
  }
  if (!input.sent && !input.replies && !input.latestProbePresent) {
    return "fresh" satisfies WarmupPosture;
  }
  if (!input.latestProbePresent || input.latestPlacement === "unknown") {
    return "probe_needed" satisfies WarmupPosture;
  }
  if (input.replies >= 3 && input.positiveThreads >= 1 && input.latestPlacement === "inbox") {
    return "micro_outreach_ready" satisfies WarmupPosture;
  }
  return "reply_acquisition" satisfies WarmupPosture;
}

function postureRank(posture: WarmupPosture) {
  switch (posture) {
    case "micro_outreach_ready":
      return 5;
    case "reply_acquisition":
      return 4;
    case "probe_needed":
      return 3;
    case "fresh":
      return 2;
    case "recovery":
      return 1;
    case "no_sender":
      return 0;
  }
}

function explanationForPosture(posture: WarmupPosture) {
  switch (posture) {
    case "micro_outreach_ready":
      return "This sender has reply and placement evidence, so the agent can consider very small reply-focused outreach while still monitoring placement.";
    case "reply_acquisition":
      return "This sender has some activity but needs more real replies or stronger thread quality before a ramp.";
    case "probe_needed":
      return "This sender lacks current exact-copy placement proof, so seed probes matter before prospect ramp.";
    case "fresh":
      return "This sender has little or no history. Treat the next move as normal mailbox behavior and reply acquisition, not cold volume.";
    case "recovery":
      return "This sender has negative delivery or reply signals. Stop ramping and repair with route checks, placement probes, and reply-heavy legitimate threads.";
    case "no_sender":
      return "No usable sender evidence is visible.";
  }
}

function usefulMovesForPosture(posture: WarmupPosture) {
  switch (posture) {
    case "micro_outreach_ready":
      return ["exact-copy canary probe", "tiny reply-likely outbound", "continue controlled reply threads"];
    case "reply_acquisition":
      return ["vendor research thread", "controlled trusted thread", "inbound footprint", "reply-likely business inquiry"];
    case "probe_needed":
      return ["inspect probe lifecycle", "run exact-copy seed probe", "repair seed monitor pool if broken"];
    case "fresh":
      return ["controlled inbound-first thread", "vendor/support inquiry", "relevant newsletters/trials", "very low warmup send"];
    case "recovery":
      return ["pause ramp", "repair route/provider", "seed placement retest", "controlled replies only"];
    case "no_sender":
      return ["plan sender route", "provision or connect sender", "ask for missing credentials only if needed"];
  }
}

function senderFromEmail(sender: SenderLike) {
  return normalizeText(sender.fromEmail || getOutreachAccountFromEmail(sender as OutreachAccount)).toLowerCase();
}

export function getWarmupOperatingGuide(): WarmupOperatingGuide {
  return WARMUP_OPERATING_GUIDE;
}

export function buildBrandWarmupEvidenceSnapshot(input: {
  brand: Pick<BrandRecord, "id" | "name">;
  senders: SenderLike[];
  campaigns: ScaleCampaignRecord[];
  runs: OutreachRun[];
  replyThreads: ReplyThread[];
  probes: DeliverabilityProbeRun[];
  now?: Date;
}): BrandWarmupEvidenceSnapshot {
  const now = input.now ?? new Date();
  const campaignById = new Map(input.campaigns.map((campaign) => [campaign.id, campaign] as const));
  const senderEvidence = input.senders.map((sender) => {
    const fromEmail = senderFromEmail(sender);
    const warmupCampaigns = input.campaigns.filter(
      (campaign) => isWarmupCampaign(campaign) && campaignSenderId(campaign) === sender.id
    );
    const warmupCampaignIds = new Set(warmupCampaigns.map((campaign) => campaign.id));
    const warmupRuns = input.runs.filter((run) => {
      if (warmupCampaignIds.has(run.ownerId) || warmupCampaignIds.has(run.campaignId)) return true;
      const campaign = campaignById.get(run.ownerId) ?? campaignById.get(run.campaignId);
      return Boolean(campaign && isWarmupCampaign(campaign) && runSenderId(run) === sender.id);
    });
    const warmupRunIds = new Set(warmupRuns.map((run) => run.id));
    const relatedThreads = input.replyThreads.filter((thread) => warmupRunIds.has(thread.runId));
    const positiveThreads = relatedThreads.filter((thread) => thread.sentiment === "positive").length;
    const negativeThreads = relatedThreads.filter((thread) => thread.sentiment === "negative").length;
    const questionThreads = relatedThreads.filter((thread) => thread.intent === "question").length;
    const progressedThreads = relatedThreads.filter(
      (thread) => (thread.stateSummary?.progressScore ?? 0) >= 0.35
    ).length;
    const latestProbe = latestProbeForSender(input.probes, sender.id, fromEmail);
    const evidence = {
      warmupSent: warmupRuns.reduce((sum, run) => sum + run.metrics.sentMessages, 0),
      warmupReplies: warmupRuns.reduce((sum, run) => sum + run.metrics.replies, 0),
      warmupPositiveReplies: warmupRuns.reduce((sum, run) => sum + run.metrics.positiveReplies, 0),
      warmupNegativeReplies: warmupRuns.reduce((sum, run) => sum + run.metrics.negativeReplies, 0),
      warmupBounces: warmupRuns.reduce((sum, run) => sum + run.metrics.bouncedMessages, 0),
      warmupFailures: warmupRuns.reduce((sum, run) => sum + run.metrics.failedMessages, 0),
      replyThreads: relatedThreads.length,
      positiveThreads,
      negativeThreads,
      questionThreads,
      progressedThreads,
      latestPlacement: latestProbe?.placement || "unknown",
      latestPlacementSummary: latestProbe?.summaryText || "",
      latestPlacementAt: latestProbe?.completedAt || latestProbe?.updatedAt || latestProbe?.createdAt || "",
    };
    const posture = postureFor({
      senderPresent: true,
      sent: evidence.warmupSent,
      replies: evidence.warmupReplies,
      positiveThreads,
      negativeThreads,
      bounces: evidence.warmupBounces,
      failures: evidence.warmupFailures,
      latestPlacement: evidence.latestPlacement,
      latestProbePresent: Boolean(latestProbe),
    });

    return {
      senderAccountId: sender.id,
      senderName: sender.name,
      fromEmail,
      accountAgeDays: accountAgeDays(sender.createdAt, now),
      posture,
      warmupCampaignIds: [...warmupCampaignIds],
      warmupRunIds: [...warmupRunIds],
      evidence,
      agentRead: {
        whatThisMeans: explanationForPosture(posture),
        nextQuestions: [
          "What legitimate reply-prone move best fits this brand right now?",
          "Does the next move create real business conversation or just activity?",
          "Is current placement proof good enough for even a tiny prospect canary?",
        ],
        usefulMoves: usefulMovesForPosture(posture),
      },
    } satisfies WarmupSenderEvidence;
  });

  const rollup = {
    senderCount: senderEvidence.length,
    bestPosture:
      senderEvidence
        .slice()
        .sort((left, right) => postureRank(right.posture) - postureRank(left.posture))[0]?.posture ??
      ("no_sender" as WarmupPosture),
    totalWarmupSent: senderEvidence.reduce((sum, row) => sum + row.evidence.warmupSent, 0),
    totalWarmupReplies: senderEvidence.reduce((sum, row) => sum + row.evidence.warmupReplies, 0),
    totalReplyThreads: senderEvidence.reduce((sum, row) => sum + row.evidence.replyThreads, 0),
    totalPositiveThreads: senderEvidence.reduce((sum, row) => sum + row.evidence.positiveThreads, 0),
    totalNegativeThreads: senderEvidence.reduce((sum, row) => sum + row.evidence.negativeThreads, 0),
    sendersNeedingProbe: senderEvidence.filter((row) => row.posture === "probe_needed").length,
    sendersInRecovery: senderEvidence.filter((row) => row.posture === "recovery").length,
  };

  return {
    version: 1,
    generatedAt: nowIso(),
    brandId: input.brand.id,
    brandName: input.brand.name,
    principle: WARMUP_OPERATING_GUIDE.stance,
    senders: senderEvidence,
    rollup,
    agentPrompt: [
      "Use this as evidence, not a script.",
      "Pick the smallest legitimate move that should increase real replies or placement certainty.",
      "If the evidence did not change after the last warmup move, choose a different reply acquisition move and note why in self-reflection.",
    ],
  };
}

export async function readWarmupIntelligenceSnapshot(brandId: string) {
  const brand = await getBrandById(brandId);
  if (!brand) throw new Error("brand not found");

  const [context, accounts, campaigns, runs, inbox, probes] = await Promise.all([
    getOperatorBrandContext(brand.id),
    listOutreachAccounts(),
    listScaleCampaignRecords(brand.id),
    listBrandRuns(brand.id).catch(() => []),
    listReplyThreadsByBrand(brand.id, { includeEval: true }).catch(() => ({ threads: [], drafts: [] })),
    listDeliverabilityProbeRuns({ brandId: brand.id, limit: 100 }).catch(() => []),
  ]);

  const senderIds = new Set(
    [
      ...(context?.senders.snapshots.map((sender) => sender.accountId) ?? []),
      ...campaigns.filter(isWarmupCampaign).map(campaignSenderId),
    ].filter(Boolean)
  );
  const senderById = new Map(accounts.map((account) => [account.id, account] as const));
  const senders = [...senderIds]
    .map((senderId) => senderById.get(senderId))
    .filter((account): account is OutreachAccount => Boolean(account));

  return {
    guide: getWarmupOperatingGuide(),
    evidence: buildBrandWarmupEvidenceSnapshot({
      brand,
      senders,
      campaigns,
      runs,
      replyThreads: inbox.threads,
      probes,
    }),
  };
}
