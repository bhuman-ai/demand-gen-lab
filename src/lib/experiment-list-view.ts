import type { ExperimentListItem, ExperimentRecord, OutreachRun } from "@/lib/factory-types";
import { EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS } from "@/lib/experiment-policy";

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

function deriveListStatus(experiment: ExperimentRecord, latestRun: OutreachRun | null): ExperimentListItem["status"] {
  if (experiment.status === "archived") return "Blocked";
  if (experiment.status === "promoted") return "Promoted";
  if (experiment.status === "completed") return "Completed";

  if (experiment.status === "running") {
    if (latestRun?.status === "sourcing") return "Sourcing";
    if (latestRun?.status === "paused") return "Paused";
    if (latestRun && ["failed", "preflight_failed", "canceled"].includes(latestRun.status)) {
      return "Blocked";
    }
    return "Running";
  }

  if (experiment.status === "paused") {
    return "Paused";
  }

  if (latestRun?.status === "sourcing") {
    return "Sourcing";
  }

  if (experiment.status === "ready") {
    const sourcedLeads = normalizeCount(latestRun?.metrics.sourcedLeads);
    const flowPublished = normalizeCount(experiment.messageFlow.publishedRevision) > 0;
    const hasStartedSending =
      normalizeCount(latestRun?.metrics.sentMessages) > 0 ||
      normalizeCount(experiment.metricsSummary.sent) > 0;

    if (!hasStartedSending && flowPublished && sourcedLeads < EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS) {
      return "Preparing";
    }

    return "Ready";
  }
  return "Draft";
}

function deriveActiveAction(status: ExperimentListItem["status"]) {
  if (status === "Running") return "Open Run" as const;
  if (status === "Sourcing") return "Open Prospects" as const;
  return "Open" as const;
}

function summarizeBlockedReason(latestRun: OutreachRun | null, experiment: ExperimentRecord) {
  if (experiment.status === "archived") {
    return "This experiment is archived.";
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
  if (status === "Preparing") {
    const sourcedLeads = normalizeCount(latestRun?.metrics.sourcedLeads);
    const remaining = Math.max(0, EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS - sourcedLeads);
    if (remaining > 0) {
      return `Waiting on ${remaining} more contacts before launch.`;
    }
    return "Finishing pre-launch checks before sending starts.";
  }

  if (status === "Ready") {
    if (normalizeCount(experiment.messageFlow.publishedRevision) > 0) {
      return "Ready to launch. No active run is sending yet.";
    }
    return "Setup is ready, but messaging still needs to be published.";
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
    isActiveNow: status === "Running" || status === "Sourcing",
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
