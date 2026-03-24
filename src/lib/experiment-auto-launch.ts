import { updateExperimentRecord } from "@/lib/experiment-data";
import type { ExperimentRecord } from "@/lib/factory-types";
import { listExperimentRuns, listOwnerRuns } from "@/lib/outreach-data";
import { launchExperimentRun } from "@/lib/outreach-runtime";

const TARGET_EXPERIMENT_CONTACTS = 500;
const AUTO_LAUNCH_RETRY_COOLDOWN_MS = 15 * 60 * 1000;

type LaunchRelevantRun = Awaited<ReturnType<typeof listOwnerRuns>>[number];

export type ExperimentAutoLaunchResult = {
  launched: boolean;
  blocked: boolean;
  runId?: string;
  reason?: string;
  activeRunStatus?: string;
};

export function isExperimentOpenRunStatus(status: string) {
  return ["queued", "sourcing", "scheduled", "sending", "monitoring", "paused"].includes(
    String(status ?? "").trim().toLowerCase()
  );
}

export function deriveExperimentStoredStatusFromRun(
  status: string
): ExperimentRecord["status"] {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "paused") return "paused";
  if (["scheduled", "sending", "monitoring"].includes(normalized)) return "running";
  return "ready";
}

function hasLaunchFailureCooldown(runs: LaunchRelevantRun[]) {
  const latestRun = runs[0] ?? null;
  if (!latestRun) return false;
  if (isExperimentOpenRunStatus(latestRun.status)) return true;
  if (!["failed", "preflight_failed"].includes(latestRun.status)) return false;
  const sentMessages = Math.max(0, Number(latestRun.metrics.sentMessages ?? 0) || 0);
  if (sentMessages > 0) return false;
  const updatedAtMs = Date.parse(String(latestRun.updatedAt ?? ""));
  if (!Number.isFinite(updatedAtMs)) return false;
  return Date.now() - updatedAtMs < AUTO_LAUNCH_RETRY_COOLDOWN_MS;
}

async function setExperimentStoredStatus(
  experiment: ExperimentRecord,
  nextStatus: ExperimentRecord["status"]
) {
  if (experiment.status === nextStatus) return;
  await updateExperimentRecord(experiment.brandId, experiment.id, { status: nextStatus });
}

export async function maybeAutoLaunchPreparedExperiment(
  experiment: ExperimentRecord
): Promise<ExperimentAutoLaunchResult> {
  if (!experiment.runtime.campaignId || !experiment.runtime.experimentId) {
    return { launched: false, blocked: true, reason: "runtime_missing" };
  }
  if (["completed", "promoted", "archived"].includes(experiment.status)) {
    return { launched: false, blocked: true, reason: "not_launchable" };
  }

  const ownerRuns = await listOwnerRuns(experiment.brandId, "experiment", experiment.id);
  const experimentRuns =
    experiment.runtime.campaignId && experiment.runtime.experimentId
      ? await listExperimentRuns(
          experiment.brandId,
          experiment.runtime.campaignId,
          experiment.runtime.experimentId
        )
      : [];
  const launchRelevantRuns = [...ownerRuns, ...experimentRuns].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1
  );
  const activeRun =
    launchRelevantRuns.find((run) => isExperimentOpenRunStatus(run.status)) ?? null;

  if (activeRun) {
    await setExperimentStoredStatus(
      experiment,
      deriveExperimentStoredStatusFromRun(activeRun.status)
    );
    return {
      launched: false,
      blocked: true,
      runId: activeRun.id,
      reason: "active_run",
      activeRunStatus: activeRun.status,
    };
  }

  if (["running", "paused"].includes(experiment.status)) {
    await setExperimentStoredStatus(experiment, "ready");
  }

  if (hasLaunchFailureCooldown(launchRelevantRuns)) {
    return { launched: false, blocked: true, reason: "cooldown" };
  }

  const launch = await launchExperimentRun({
    brandId: experiment.brandId,
    campaignId: experiment.runtime.campaignId,
    experimentId: experiment.runtime.experimentId,
    trigger: "manual",
    ownerType: "experiment",
    ownerId: experiment.id,
    maxLeadsOverride: TARGET_EXPERIMENT_CONTACTS,
  });

  if (!launch.ok) {
    if (launch.reason.includes("already has an active run")) {
      const refreshedRuns = await listOwnerRuns(experiment.brandId, "experiment", experiment.id);
      const refreshedActive =
        refreshedRuns.find((run) => isExperimentOpenRunStatus(run.status)) ?? null;
      if (refreshedActive) {
        await setExperimentStoredStatus(
          experiment,
          deriveExperimentStoredStatusFromRun(refreshedActive.status)
        );
      }
    } else {
      await setExperimentStoredStatus(experiment, "ready");
    }

    return {
      launched: false,
      blocked: true,
      runId: launch.runId || undefined,
      reason: launch.reason,
    };
  }

  const refreshedRuns = await listOwnerRuns(experiment.brandId, "experiment", experiment.id);
  const refreshedActive =
    refreshedRuns.find((run) => isExperimentOpenRunStatus(run.status)) ?? null;
  await setExperimentStoredStatus(
    experiment,
    refreshedActive ? deriveExperimentStoredStatusFromRun(refreshedActive.status) : "ready"
  );

  return {
    launched: true,
    blocked: false,
    runId: launch.runId || undefined,
    reason: refreshedActive ? undefined : "launched",
    activeRunStatus: refreshedActive?.status,
  };
}
