import {
  getBrandOutreachAssignment,
  getOutreachRun,
  listOutreachAccounts,
  listRunAnomalies,
  listRunMessages,
} from "@/lib/outreach-data";
import {
  createMissionEvent,
  createMissionLearning,
  defaultMissionDeliverabilityState,
  defaultMissionMetricsSummary,
  listMissionsByStatuses,
  updateMission,
} from "@/lib/mission-data";
import type { OutreachMessage, OutreachRun } from "@/lib/factory-types";
import type {
  Mission,
  MissionDeliverabilityState,
  MissionMetricsSummary,
  MissionStatus,
} from "@/lib/mission-types";

function nowIso() {
  return new Date().toISOString();
}

function metricsFromRunAndMessages(run: OutreachRun | null, messages: OutreachMessage[]): MissionMetricsSummary {
  const metrics = defaultMissionMetricsSummary();
  if (run) {
    metrics.sent = Math.max(0, Number(run.metrics.sentMessages ?? 0) || 0);
    metrics.scheduled = Math.max(0, Number(run.metrics.scheduledMessages ?? 0) || 0);
    metrics.replies = Math.max(0, Number(run.metrics.replies ?? 0) || 0);
    metrics.positiveReplies = Math.max(0, Number(run.metrics.positiveReplies ?? 0) || 0);
    metrics.bounced = Math.max(0, Number(run.metrics.bouncedMessages ?? 0) || 0);
    metrics.failed = Math.max(0, Number(run.metrics.failedMessages ?? 0) || 0);
  }

  if (messages.length) {
    metrics.sent = Math.max(metrics.sent, messages.filter((message) => message.status === "sent").length);
    metrics.scheduled = Math.max(metrics.scheduled, messages.filter((message) => message.status === "scheduled").length);
    metrics.bounced = Math.max(metrics.bounced, messages.filter((message) => message.status === "bounced").length);
    metrics.failed = Math.max(metrics.failed, messages.filter((message) => message.status === "failed").length);
  }

  return metrics;
}

function missionStatusFromRun(run: OutreachRun | null, fallback: MissionStatus): MissionStatus {
  if (!run) return fallback;
  if (run.status === "preflight_failed") return "deliverability_blocked";
  if (run.status === "queued" || run.status === "sourcing" || run.status === "scheduled" || run.status === "sending") {
    return "running";
  }
  if (run.status === "monitoring") return "monitoring";
  if (run.status === "paused") return "paused";
  if (run.status === "completed") return "learning";
  if (run.status === "failed" || run.status === "canceled") return "failed";
  return fallback;
}

function isMissionOutboundReady(account: { config?: unknown }) {
  const config = account.config && typeof account.config === "object" ? account.config as Record<string, unknown> : {};
  const outbound = config.outbound && typeof config.outbound === "object" ? outboundAsRecord(config.outbound) : null;
  return outbound ? outbound.enabled === true : true;
}

function outboundAsRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as { enabled?: unknown } : {};
}

export async function inspectMissionDeliverability(brandId: string): Promise<MissionDeliverabilityState> {
  const base = defaultMissionDeliverabilityState();
  const assignment = await getBrandOutreachAssignment(brandId).catch(() => null);
  const accounts = await listOutreachAccounts().catch(() => []);
  const assignedIds = assignment?.accountIds?.length
    ? assignment.accountIds
    : assignment?.accountId
      ? [assignment.accountId]
      : [];
  const assignedAccounts = assignedIds
    .map((accountId) => accounts.find((account) => account.id === accountId) ?? null)
    .filter((account): account is NonNullable<typeof account> => Boolean(account));
  const activeAccounts = assignedAccounts.filter((account) => account.status === "active");
  const outboundAccounts = activeAccounts.filter((account) => isMissionOutboundReady(account));
  const warmingAccounts = activeAccounts.filter((account) => !isMissionOutboundReady(account));

  if (!assignedAccounts.length) {
    return {
      ...base,
      stage: "preparing_inboxes",
      summary: "No sending inbox is assigned yet. The mission operator needs to prepare inboxes before launch.",
      primaryBlocker: "No sending inbox is assigned.",
      senderCount: 0,
      readySenderCount: 0,
      warmingSenderCount: 0,
      lastCheckedAt: nowIso(),
    };
  }

  if (!outboundAccounts.length) {
    return {
      ...base,
      stage: "warming_domains",
      summary: "Assigned inboxes are present, but they are still warmup-only or not ready for outbound.",
      primaryBlocker: "Assigned inboxes are not outbound-ready.",
      senderCount: assignedAccounts.length,
      readySenderCount: 0,
      warmingSenderCount: warmingAccounts.length || assignedAccounts.length,
      lastCheckedAt: nowIso(),
    };
  }

  return {
    ...base,
    stage: "ready",
    summary: `${outboundAccounts.length} outbound-ready inbox${outboundAccounts.length === 1 ? "" : "es"} can be used for the first batch.`,
    senderCount: assignedAccounts.length,
    readySenderCount: outboundAccounts.length,
    warmingSenderCount: warmingAccounts.length,
    lastCheckedAt: nowIso(),
  };
}

export async function refreshMissionRuntimeSummary(mission: Mission): Promise<Mission> {
  const run = mission.currentRunId ? await getOutreachRun(mission.currentRunId) : null;
  const messages = mission.currentRunId ? await listRunMessages(mission.currentRunId).catch(() => []) : [];
  const anomalies = mission.currentRunId ? await listRunAnomalies(mission.currentRunId).catch(() => []) : [];
  const metricsSummary = metricsFromRunAndMessages(run, messages);
  const status = missionStatusFromRun(run, mission.status);
  const deliverabilityState =
    run?.status === "preflight_failed"
      ? {
          ...mission.deliverabilityState,
          stage: "needs_attention" as const,
          summary: run.lastError || "Launch was blocked by deliverability preflight.",
          primaryBlocker: run.lastError || "Launch was blocked by deliverability preflight.",
          lastCheckedAt: nowIso(),
        }
      : anomalies.some((anomaly) => anomaly.status === "active")
        ? {
            ...mission.deliverabilityState,
            stage: "needs_attention" as const,
            summary: anomalies[0]?.details || "Deliverability anomaly is active.",
            primaryBlocker: anomalies[0]?.details || "Deliverability anomaly is active.",
            lastCheckedAt: nowIso(),
          }
        : await inspectMissionDeliverability(mission.brandId);

  const updated = await updateMission(mission.brandId, mission.id, {
    status,
    metricsSummary,
    deliverabilityState,
    lastError: run?.status === "preflight_failed" ? run.lastError : mission.lastError,
  });

  if (updated && run?.status === "completed") {
    await createMissionLearning({
      missionId: mission.id,
      brandId: mission.brandId,
      learningType: "first_batch_summary",
      summary:
        metricsSummary.replies > 0
          ? `First batch generated ${metricsSummary.replies} replies from ${metricsSummary.sent} sent messages.`
          : `First batch sent ${metricsSummary.sent} messages and is ready for reply-quality review.`,
      confidence: metricsSummary.sent > 0 ? 0.7 : 0.4,
      evidence: { metricsSummary, runId: run.id },
      recommendedAction: metricsSummary.positiveReplies > 0 ? "scale_winner" : "revise_targeting_or_message",
    });
    await createMissionEvent({
      missionId: mission.id,
      brandId: mission.brandId,
      eventType: "learning_ready",
      summary: "The first batch finished and learning is ready.",
      payload: { metricsSummary, runId: run.id },
    });
  }

  return updated ?? mission;
}

export async function runMissionTick(limit = 25) {
  const missions = await listMissionsByStatuses([
    "running",
    "monitoring",
    "learning",
    "deliverability_blocked",
  ]);
  const rows = [];
  for (const mission of missions.slice(0, limit)) {
    try {
      const refreshed = await refreshMissionRuntimeSummary(mission);
      rows.push({
        missionId: refreshed.id,
        brandId: refreshed.brandId,
        status: refreshed.status,
        runId: refreshed.currentRunId,
        ok: true,
      });
    } catch (error) {
      rows.push({
        missionId: mission.id,
        brandId: mission.brandId,
        status: mission.status,
        runId: mission.currentRunId,
        ok: false,
        error: error instanceof Error ? error.message : "mission refresh failed",
      });
    }
  }

  return {
    checked: missions.length,
    refreshed: rows.length,
    failed: rows.filter((row) => !row.ok).length,
    missions: rows,
  };
}
