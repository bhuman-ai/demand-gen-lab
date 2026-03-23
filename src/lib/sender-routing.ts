import type { DomainRow } from "@/lib/factory-types";
import { getDomainDeliveryAccountId, getDomainDeliveryAccountName } from "@/lib/outreach-account-helpers";

export type SenderRoutingSignals = {
  senderAccountId: string;
  senderAccountName: string;
  domain: string;
  fromEmail: string;
  automationStatus: NonNullable<DomainRow["automationStatus"]>;
  automationSummary: string;
  domainStatus: NonNullable<DomainRow["domainHealth"]>;
  emailStatus: NonNullable<DomainRow["emailHealth"]>;
  transportStatus: NonNullable<DomainRow["ipHealth"]>;
  messageStatus: NonNullable<DomainRow["messagingHealth"]>;
  inboxRate: number;
  spamRate: number;
  checkedAt: string;
};

export type SenderRouteSelectionState =
  | "auto"
  | "locked_preferred"
  | "locked_standby"
  | "blocked"
  | "locked_unknown"
  | "none";

export type SenderRouteSelectionSummary = {
  state: SenderRouteSelectionState;
  label: string;
  title: string;
  detail: string;
  signal: SenderRoutingSignals | null;
};

export type SenderRoutingScoreLevel = "strong" | "usable" | "watch" | "weak";

export type SenderRoutingScoreSummary = {
  normalizedScore: number;
  rawScore: number;
  level: SenderRoutingScoreLevel;
  label: string;
  detail: string;
  breakdown: Array<{
    label: string;
    value: string;
    detail: string;
  }>;
};

const ROUTING_SCORE_MIN = -176;
const ROUTING_SCORE_MAX = 152.5;

export function senderHealthValue(status: NonNullable<DomainRow["domainHealth"]>) {
  if (status === "healthy") return 4;
  if (status === "watch") return 2;
  if (status === "queued") return 1;
  if (status === "unknown") return 0;
  return -6;
}

export function senderAutomationValue(status: NonNullable<DomainRow["automationStatus"]>) {
  if (status === "ready") return 8;
  if (status === "warming") return 5;
  if (status === "testing") return 3;
  if (status === "queued") return 1;
  return -8;
}

export function scoreSenderRoutingSignal(signal: SenderRoutingSignals) {
  const healthScore =
    senderHealthValue(signal.domainStatus) +
    senderHealthValue(signal.emailStatus) +
    senderHealthValue(signal.transportStatus) +
    senderHealthValue(signal.messageStatus);
  const routingScore =
    senderAutomationValue(signal.automationStatus) * 10 +
    healthScore * 4 +
    signal.inboxRate * 8 -
    signal.spamRate * 12 +
    (signal.checkedAt ? 0.5 : 0);
  return {
    healthScore,
    routingScore,
  };
}

function normalizeRoutingScore(routingScore: number) {
  const clamped = Math.max(ROUTING_SCORE_MIN, Math.min(ROUTING_SCORE_MAX, routingScore));
  const normalized = ((clamped - ROUTING_SCORE_MIN) / (ROUTING_SCORE_MAX - ROUTING_SCORE_MIN)) * 100;
  return Math.round(normalized);
}

export function senderRoutingScoreVariant(level: SenderRoutingScoreLevel) {
  if (level === "strong") return "success" as const;
  if (level === "usable") return "accent" as const;
  if (level === "watch") return "muted" as const;
  return "danger" as const;
}

export function summarizeSenderRoutingScore(signal: SenderRoutingSignals): SenderRoutingScoreSummary {
  const automationContribution = senderAutomationValue(signal.automationStatus) * 10;
  const domainContribution = senderHealthValue(signal.domainStatus);
  const emailContribution = senderHealthValue(signal.emailStatus);
  const transportContribution = senderHealthValue(signal.transportStatus);
  const messageContribution = senderHealthValue(signal.messageStatus);
  const healthScore = domainContribution + emailContribution + transportContribution + messageContribution;
  const healthContribution = healthScore * 4;
  const placementContribution = signal.inboxRate * 8 - signal.spamRate * 12;
  const freshnessContribution = signal.checkedAt ? 0.5 : 0;
  const rawScore = automationContribution + healthContribution + placementContribution + freshnessContribution;
  const normalizedScore = normalizeRoutingScore(rawScore);

  let level: SenderRoutingScoreLevel = "weak";
  let label = "Weak";
  let detail = "This sender is unlikely to win routing until its automation state or health signals improve.";

  if (signal.automationStatus === "attention") {
    level = "weak";
    label = "Blocked";
    detail = "This sender is outside rotation because one or more automation or health checks are currently unsafe.";
  } else if (normalizedScore >= 75) {
    level = "strong";
    label = "Strong";
    detail = "This sender is a strong candidate for first-in-rotation dispatch.";
  } else if (normalizedScore >= 55) {
    level = "usable";
    label = "Usable";
    detail = "This sender is healthy enough to use, but it may sit behind a stronger route.";
  } else if (normalizedScore >= 35) {
    level = "watch";
    label = "Watch";
    detail = "This sender is borderline and should stay behind healthier routes until more signal arrives.";
  }

  return {
    normalizedScore,
    rawScore,
    level,
    label,
    detail,
    breakdown: [
      {
        label: "Automation",
        value: signal.automationStatus,
        detail: `Automation contributes ${automationContribution.toFixed(1)} raw points based on whether the sender is queued, testing, warming, ready, or blocked.`,
      },
      {
        label: "Health signals",
        value: `${signal.domainStatus} domain · ${signal.emailStatus} email · ${signal.transportStatus} transport · ${signal.messageStatus} message`,
        detail: `The four health signals contribute ${healthContribution.toFixed(1)} raw points combined.`,
      },
      {
        label: "Placement history",
        value: `${Math.round(signal.inboxRate * 100)}% inbox · ${Math.round(signal.spamRate * 100)}% spam`,
        detail: `Recent inbox and spam placement contributes ${placementContribution.toFixed(1)} raw points.`,
      },
      {
        label: "Freshness",
        value: signal.checkedAt ? "Recent check on file" : "No recent check",
        detail: signal.checkedAt
          ? `A recent health check adds ${freshnessContribution.toFixed(1)} raw points.`
          : "No freshness bonus is applied until the sender has a recorded health check.",
      },
    ],
  };
}

export function buildSenderRoutingSignalFromDomainRow(
  row: DomainRow,
  input?: {
    inboxRate?: number;
    spamRate?: number;
    checkedAt?: string;
  }
): SenderRoutingSignals | null {
  const senderAccountId = getDomainDeliveryAccountId(row);
  const fromEmail = String(row.fromEmail ?? "").trim().toLowerCase();
  if (row.role === "brand" || !senderAccountId || !fromEmail) return null;
  return {
    senderAccountId,
    senderAccountName: getDomainDeliveryAccountName(row) || fromEmail,
    domain: row.domain,
    fromEmail,
    automationStatus: row.automationStatus ?? "queued",
    automationSummary: row.automationSummary ?? "",
    domainStatus: row.domainHealth ?? "unknown",
    emailStatus: row.emailHealth ?? "unknown",
    transportStatus: row.ipHealth ?? "unknown",
    messageStatus: row.messagingHealth ?? "unknown",
    inboxRate: input?.inboxRate ?? 0,
    spamRate: input?.spamRate ?? 0,
    checkedAt: input?.checkedAt ?? row.lastHealthCheckAt ?? "",
  };
}

export function rankSenderRoutingSignals(signals: SenderRoutingSignals[]) {
  return [...signals].sort((left, right) => {
    const leftScore = scoreSenderRoutingSignal(left);
    const rightScore = scoreSenderRoutingSignal(right);
    if (leftScore.routingScore !== rightScore.routingScore) {
      return rightScore.routingScore - leftScore.routingScore;
    }
    if (leftScore.healthScore !== rightScore.healthScore) {
      return rightScore.healthScore - leftScore.healthScore;
    }
    if (left.checkedAt !== right.checkedAt) {
      return left.checkedAt < right.checkedAt ? 1 : -1;
    }
    return left.senderAccountName.localeCompare(right.senderAccountName);
  });
}

export function senderRouteSelectionVariant(state: SenderRouteSelectionState) {
  if (state === "auto" || state === "locked_preferred") return "success" as const;
  if (state === "locked_standby") return "accent" as const;
  if (state === "blocked") return "danger" as const;
  return "muted" as const;
}

export function summarizeSelectedSenderRoute(input: {
  signals: SenderRoutingSignals[];
  preferredSignal?: SenderRoutingSignals | null;
  selectedAccountId?: string | null;
}): SenderRouteSelectionSummary {
  const selectedAccountId = String(input.selectedAccountId ?? "").trim();
  const preferredSignal =
    input.preferredSignal ?? input.signals.find((signal) => signal.automationStatus !== "attention") ?? null;
  const selectedSignal = selectedAccountId
    ? input.signals.find((signal) => signal.senderAccountId === selectedAccountId) ?? null
    : null;
  const blockedCount = input.signals.filter((signal) => signal.automationStatus === "attention").length;

  if (selectedSignal) {
    if (selectedSignal.automationStatus === "attention") {
      return {
        state: "blocked",
        label: "Blocked sender",
        title: selectedSignal.fromEmail || selectedSignal.senderAccountName,
        detail: selectedSignal.automationSummary || "This sender is currently out of rotation.",
        signal: selectedSignal,
      };
    }
    if (preferredSignal && selectedSignal.senderAccountId === preferredSignal.senderAccountId) {
      return {
        state: "locked_preferred",
        label: "Locked to preferred",
        title: selectedSignal.fromEmail || selectedSignal.senderAccountName,
        detail:
          selectedSignal.automationSummary ||
          "This campaign is pinned to the sender currently at the top of the health-first route order.",
        signal: selectedSignal,
      };
    }
    return {
      state: "locked_standby",
      label: "Locked to standby",
      title: selectedSignal.fromEmail || selectedSignal.senderAccountName,
      detail: preferredSignal
        ? `Health-first routing would currently choose ${preferredSignal.fromEmail}.`
        : selectedSignal.automationSummary || "This sender is available, but not first in the route order.",
      signal: selectedSignal,
    };
  }

  if (selectedAccountId) {
    return {
      state: "locked_unknown",
      label: "Locked sender",
      title: "Sender not found",
      detail: "This campaign points to a sender that is not currently available in the routing table.",
      signal: null,
    };
  }

  if (preferredSignal) {
    return {
      state: "auto",
      label: "Auto route",
      title: preferredSignal.fromEmail || preferredSignal.senderAccountName,
      detail:
        preferredSignal.automationSummary || "The system will choose the healthiest sender automatically.",
      signal: preferredSignal,
    };
  }

  if (blockedCount > 0) {
    return {
      state: "none",
      label: "No ready route",
      title: "All configured senders are blocked",
      detail: `${blockedCount} sender${blockedCount === 1 ? "" : "s"} currently sit outside rotation.`,
      signal: null,
    };
  }

  return {
    state: "none",
    label: "No route",
    title: "No sender ready yet",
    detail: "Attach and verify a sender before production dispatch begins.",
    signal: null,
  };
}
