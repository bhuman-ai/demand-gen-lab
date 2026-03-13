import type { DomainRow } from "@/lib/factory-types";

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

export function buildSenderRoutingSignalFromDomainRow(
  row: DomainRow,
  input?: {
    inboxRate?: number;
    spamRate?: number;
    checkedAt?: string;
  }
): SenderRoutingSignals | null {
  const senderAccountId = String(row.customerIoAccountId ?? "").trim();
  const fromEmail = String(row.fromEmail ?? "").trim().toLowerCase();
  if (row.role === "brand" || !senderAccountId || !fromEmail) return null;
  return {
    senderAccountId,
    senderAccountName: row.customerIoAccountName ?? fromEmail,
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
