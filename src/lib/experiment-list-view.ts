import type { ExperimentListItem, ExperimentRecord, OutreachRun } from "@/lib/factory-types";

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
  if (latestRun) {
    if (latestRun.status === "sourcing") return "Sourcing";
    if (["queued", "scheduled", "sending", "monitoring"].includes(latestRun.status)) {
      return "Running";
    }
    if (latestRun.status === "paused") return "Paused";
    if (latestRun.status === "completed") {
      return experiment.promotedCampaignId ? "Promoted" : "Completed";
    }
    if (["failed", "preflight_failed", "canceled"].includes(latestRun.status)) {
      return "Blocked";
    }
  }

  if (experiment.status === "draft") return "Draft";
  if (experiment.status === "ready") return "Ready";
  if (experiment.status === "running") return "Running";
  if (experiment.status === "paused") return "Paused";
  if (experiment.status === "completed") return "Completed";
  if (experiment.status === "promoted") return "Promoted";
  if (experiment.status === "archived") return "Blocked";
  return "Draft";
}

function deriveActiveAction(status: ExperimentListItem["status"]) {
  if (status === "Running") return "Open Run" as const;
  if (status === "Sourcing") return "Open Prospects" as const;
  return "Open" as const;
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

  return {
    id: experiment.id,
    brandId,
    name: experiment.name,
    status,
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
