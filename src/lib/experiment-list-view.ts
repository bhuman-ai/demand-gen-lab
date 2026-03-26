import type { ExperimentListItem, ExperimentRecord, OutreachRun } from "@/lib/factory-types";
import { getExperimentVerifiedEmailLeadTarget } from "@/lib/experiment-policy";

function safeDate(input: string) {
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRelativeTime(input: string, now = Date.now()) {
  const ts = safeDate(input);
  if (!ts) return "n/a";
  const diffMs = Math.max(0, now - ts);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < minuteMs) return "just now";
  if (diffMs < hourMs) {
    const mins = Math.max(1, Math.round(diffMs / minuteMs));
    return `${mins} min ago`;
  }
  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.round(diffMs / hourMs));
    return `${hours} hr ago`;
  }
  const days = Math.max(1, Math.round(diffMs / dayMs));
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function hasPublishedMessaging(experiment: ExperimentRecord) {
  return normalizeCount(experiment.messageFlow.publishedRevision) > 0;
}

function hasStartedSending(experiment: ExperimentRecord, latestRun: OutreachRun | null) {
  return (
    normalizeCount(latestRun?.metrics.sentMessages) > 0 ||
    normalizeCount(experiment.metricsSummary.sent) > 0
  );
}

function deriveListStatus(experiment: ExperimentRecord, latestRun: OutreachRun | null): ExperimentListItem["status"] {
  if (experiment.status === "archived") return "Blocked";
  if (experiment.status === "promoted") return "Promoted";
  if (experiment.status === "completed") return "Completed";

  if (latestRun && ["failed", "preflight_failed", "canceled"].includes(latestRun.status)) {
    return "Blocked";
  }

  if (latestRun?.status === "paused") {
    return "Paused";
  }

  if (latestRun?.status === "sourcing") {
    return "Sourcing";
  }

  if (latestRun?.status === "queued") {
    return "Preparing";
  }

  if (latestRun && ["scheduled", "sending", "monitoring"].includes(latestRun.status)) {
    return "Sending";
  }

  if (experiment.status === "running") {
    return "Sending";
  }

  if (experiment.status === "paused") {
    return "Paused";
  }

  if (experiment.status === "ready") {
    const sourcedLeads = normalizeCount(latestRun?.metrics.sourcedLeads);
    const leadTarget = getExperimentVerifiedEmailLeadTarget(experiment);
    const flowPublished = hasPublishedMessaging(experiment);
    const sent = hasStartedSending(experiment, latestRun);

    if (!flowPublished) {
      return "Blocked";
    }

    if (!sent && sourcedLeads < leadTarget) {
      return "Preparing";
    }

    return "Waiting";
  }
  return "Draft";
}

function deriveActiveAction(status: ExperimentListItem["status"]) {
  if (status === "Sending" || status === "Running") return "Open Run" as const;
  if (status === "Sourcing") return "Open Prospects" as const;
  return "Open" as const;
}

function summarizeBlockedReason(latestRun: OutreachRun | null, experiment: ExperimentRecord) {
  if (experiment.status === "archived") {
    return "This experiment is archived.";
  }

  if (experiment.status === "ready" && !hasPublishedMessaging(experiment)) {
    return "Messaging is not published yet. Publish the flow before sending can start.";
  }

  const raw = String(latestRun?.lastError ?? "").trim();
  if (!raw) {
    return "Latest run is blocked. Open the experiment to inspect what stopped it.";
  }

  const firstSection = raw.split(/\b(?:Hint|Debug):/i)[0] ?? raw;
  const normalized = firstSection.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Latest run is blocked. Open the experiment to inspect what stopped it.";
  }

  if (normalized.length <= 140) {
    return normalized;
  }

  return `${normalized.slice(0, 137).trimEnd()}...`;
}

function summarizeStatusDetail(
  status: ExperimentListItem["status"],
  experiment: ExperimentRecord,
  latestRun: OutreachRun | null
) {
  if (status === "Sending") {
    const sourcedLeads = normalizeCount(latestRun?.metrics.sourcedLeads);
    const leadTarget = getExperimentVerifiedEmailLeadTarget(experiment);
    const scheduledMessages = normalizeCount(latestRun?.metrics.scheduledMessages);
    const sentMessages = normalizeCount(latestRun?.metrics.sentMessages);
    if (sentMessages > 0) {
      const queuedMessages = Math.max(0, scheduledMessages - sentMessages);
      if (queuedMessages > 0) {
        return `${sentMessages} email${sentMessages === 1 ? "" : "s"} sent so far. ${queuedMessages} more ${queuedMessages === 1 ? "is" : "are"} queued for upcoming send slots.`;
      }
      return `${sentMessages} email${sentMessages === 1 ? "" : "s"} already sent.`;
    }
    if (scheduledMessages > 0) {
      return `${scheduledMessages} ${scheduledMessages === 1 ? "message is" : "messages are"} queued for the first eligible send slot.`;
    }
    const remaining = Math.max(0, leadTarget - sourcedLeads);
    if (latestRun?.status === "monitoring" && remaining > 0) {
      return `Waiting on ${remaining} more contacts before sending can resume.`;
    }
    if (latestRun?.status === "monitoring") {
      return "Waiting for the next dispatch cycle.";
    }
    return "A sending run is active.";
  }

  if (status === "Preparing") {
    if (!hasPublishedMessaging(experiment)) {
      return "Waiting on messaging to be published before launch.";
    }
    const sourcedLeads = normalizeCount(latestRun?.metrics.sourcedLeads);
    const leadTarget = getExperimentVerifiedEmailLeadTarget(experiment);
    const remaining = Math.max(0, leadTarget - sourcedLeads);
    if (remaining > 0) {
      return `Waiting on ${remaining} more contacts before launch.`;
    }
    if (latestRun?.status === "queued") {
      return "Run is queued and pre-launch checks are still running.";
    }
    return "Finishing pre-launch checks before sending starts.";
  }

  if (status === "Waiting") {
    const sentMessages = latestRun
      ? normalizeCount(latestRun.metrics.sentMessages)
      : normalizeCount(experiment.metricsSummary.sent);
    if (!hasPublishedMessaging(experiment)) {
      return "Waiting on messaging to be published before sending can start.";
    }
    if (!latestRun) {
      return "Waiting for launch. No run has been started yet.";
    }
    if (latestRun.status === "completed" && sentMessages === 0) {
      return "Waiting to relaunch. The last run finished without sending any messages.";
    }
    if (latestRun.status === "completed" && sentMessages > 0) {
      return `Waiting to relaunch. The last run already sent ${sentMessages} email${
        sentMessages === 1 ? "" : "s"
      }.`;
    }
    return "Waiting for launch. No active run is sending right now.";
  }

  return undefined;
}

function normalizeCount(value: unknown) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0;
  return Math.max(0, Math.round(next));
}

export function mapExperimentToListItem(input: {
  brandId: string;
  experiment: ExperimentRecord;
  latestRun: OutreachRun | null;
  now?: number;
}): ExperimentListItem {
  const now = input.now ?? Date.now();
  const { experiment, latestRun, brandId } = input;
  const status = deriveListStatus(experiment, latestRun);

  const sourcedLeads = normalizeCount(latestRun?.metrics.sourcedLeads);
  const scheduledMessages = normalizeCount(latestRun?.metrics.scheduledMessages);
  const sentMessages = latestRun
    ? normalizeCount(latestRun.metrics.sentMessages)
    : normalizeCount(experiment.metricsSummary.sent);
  const replies = latestRun
    ? normalizeCount(latestRun.metrics.replies)
    : normalizeCount(experiment.metricsSummary.replies);
  const positiveReplies = latestRun
    ? normalizeCount(latestRun.metrics.positiveReplies)
    : normalizeCount(experiment.metricsSummary.positiveReplies);

  const lastActivityAt =
    latestRun?.updatedAt || latestRun?.createdAt || experiment.updatedAt || experiment.createdAt;
  const lastActivityLabel = formatRelativeTime(lastActivityAt, now);
  const openHref = `/brands/${brandId}/experiments/${experiment.id}`;
  const editHref = `/brands/${brandId}/experiments/${experiment.id}/setup`;
  const duplicateHref = `/brands/${brandId}/experiments/${experiment.id}/setup?duplicate=1`;

  const activeActionLabel = deriveActiveAction(status);
  const activeHref =
    activeActionLabel === "Open Run"
      ? `/brands/${brandId}/experiments/${experiment.id}/run`
      : activeActionLabel === "Open Prospects"
        ? `/brands/${brandId}/experiments/${experiment.id}/prospects`
        : openHref;
  const blockedReason = status === "Blocked" ? summarizeBlockedReason(latestRun, experiment) : undefined;
  const statusDetail =
    status === "Blocked" ? blockedReason : summarizeStatusDetail(status, experiment, latestRun);

  return {
    id: experiment.id,
    brandId,
    name: experiment.name,
    status,
    blockedReason,
    statusDetail,
    audience: experiment.audience,
    offer: experiment.offer,
    owner: "Unassigned",
    flowRevision: normalizeCount(experiment.messageFlow.publishedRevision),
    sourcedLeads,
    scheduledMessages,
    sentMessages,
    replies,
    positiveReplies,
    isActiveNow: status === "Sending" || status === "Running" || status === "Sourcing",
    activeActionLabel,
    openHref,
    editHref,
    duplicateHref,
    activeHref,
    lastActivityAt,
    lastActivityLabel,
    promotedCampaignId: experiment.promotedCampaignId,
  };
}

export function sortExperimentListItems(items: ExperimentListItem[]) {
  return [...items].sort((left, right) => {
    const leftActive = Number(left.isActiveNow);
    const rightActive = Number(right.isActiveNow);
    if (leftActive !== rightActive) return rightActive - leftActive;
    return safeDate(right.lastActivityAt) - safeDate(left.lastActivityAt);
  });
}

export function filterExperimentListItems(input: {
  items: ExperimentListItem[];
  status: "all" | string;
  query: string;
}) {
  const query = input.query.trim().toLowerCase();
  return input.items.filter((item) => {
    if (input.status !== "all" && item.status.toLowerCase() !== input.status.toLowerCase()) {
      return false;
    }
    if (!query) return true;
    const haystack = [item.name, item.status, item.audience, item.offer, item.lastActivityLabel]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}
