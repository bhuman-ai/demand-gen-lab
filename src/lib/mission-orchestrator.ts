import { createExperimentRecord, ensureRuntimeForExperiment } from "@/lib/experiment-data";
import { getBrandById, updateBrand } from "@/lib/factory-data";
import { launchExperimentRun } from "@/lib/outreach-runtime";
import {
  createMissionAgentDecision,
  createMissionEvent,
  defaultMissionApprovalPolicy,
  getMission,
  listMissionsByStatuses,
  updateMission,
} from "@/lib/mission-data";
import { inspectMissionDeliverability, refreshMissionRuntimeSummary } from "@/lib/mission-learning";
import type { Mission, MissionPlan } from "@/lib/mission-types";

function nowIso() {
  return new Date().toISOString();
}

function asLines(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

function clampFirstBatch(value: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(10, Math.min(50, parsed));
}

function buildMissionNotes(plan: MissionPlan) {
  return [
    "LastB2B mission plan:",
    `Offer: ${plan.offerSummary}`,
    `Target: ${plan.targetCustomers.join("; ")}`,
    `Avoid: ${plan.avoidList.join("; ")}`,
    `Angle: ${plan.outreachAngle}`,
    `Deliverability: ${plan.deliverabilityPlan.summary}`,
    `Learning: ${plan.learningPlan.summary}`,
  ]
    .filter((line) => line.trim() !== "Avoid:")
    .join("\n");
}

function shouldWaitForDeliverability(stage: Mission["deliverabilityState"]["stage"]) {
  return stage !== "ready";
}

function hasApprovedMissionPlan(mission: Mission) {
  return Boolean(mission.approvalPolicy.planApprovedAt && mission.approvedPlan.offerSummary.trim());
}

async function ensureMissionRuntime(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
  brandName?: string;
}): Promise<Mission> {
  if (
    input.mission.currentExperimentId &&
    input.mission.currentRuntimeCampaignId &&
    input.mission.currentRuntimeExperimentId
  ) {
    return input.mission;
  }

  const brand =
    input.brandName
      ? { name: input.brandName }
      : await getBrandById(input.mission.brandId, { includeEmbedded: true });
  const experiment = await createExperimentRecord({
    brandId: input.mission.brandId,
    name: `${brand?.name || "Brand"} Mission Test`,
    offer: input.approvedPlan.offerSummary,
    audience: input.approvedPlan.targetCustomers.join("; "),
  });
  const runtimeExperiment = await ensureRuntimeForExperiment(experiment);
  await createMissionAgentDecision({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    agent: "mission_operator",
    action: "compile_to_internal_experiment",
    rationale: "The user sees one mission, while the existing outreach runtime still uses experiments internally.",
    riskLevel: "safe_write",
    input: { missionId: input.mission.id },
    output: {
      experimentId: runtimeExperiment.id,
      runtimeCampaignId: runtimeExperiment.runtime.campaignId,
      runtimeExperimentId: runtimeExperiment.runtime.experimentId,
    },
  });

  return (
    (await updateMission(input.mission.brandId, input.mission.id, {
      currentExperimentId: runtimeExperiment.id,
      currentRuntimeCampaignId: runtimeExperiment.runtime.campaignId,
      currentRuntimeExperimentId: runtimeExperiment.runtime.experimentId,
    })) ?? input.mission
  );
}

async function launchApprovedMissionFirstBatch(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
  deliverabilityState: Mission["deliverabilityState"];
  brandName?: string;
}): Promise<Mission> {
  let mission = await ensureMissionRuntime(input);
  if (mission.currentRunId) {
    return refreshMissionRuntimeSummary(mission);
  }

  const launch = await launchExperimentRun({
    brandId: mission.brandId,
    campaignId: mission.currentRuntimeCampaignId,
    experimentId: mission.currentRuntimeExperimentId,
    trigger: "manual",
    ownerType: "experiment",
    ownerId: mission.currentExperimentId,
    maxLeadsOverride: input.approvedPlan.firstBatchSize,
  });

  await createMissionAgentDecision({
    missionId: mission.id,
    brandId: mission.brandId,
    agent: "launch_operator",
    action: "launch_first_batch",
    rationale: "The approved plan allows a small first batch. Scaling remains gated by learning and approval policy.",
    riskLevel: launch.ok ? "guarded_write" : "blocked",
    input: {
      firstBatchSize: input.approvedPlan.firstBatchSize,
      runtimeCampaignId: mission.currentRuntimeCampaignId,
      runtimeExperimentId: mission.currentRuntimeExperimentId,
    },
    output: launch,
  });

  mission =
    (await updateMission(mission.brandId, mission.id, {
      currentRunId: launch.runId,
      status: launch.ok ? "running" : "deliverability_blocked",
      lastError: launch.ok ? "" : launch.reason,
      deliverabilityState: launch.ok
        ? input.deliverabilityState
        : {
            ...input.deliverabilityState,
            stage: "needs_attention",
            summary: launch.reason,
            primaryBlocker: launch.reason,
            lastCheckedAt: nowIso(),
          },
    })) ?? mission;

  await createMissionEvent({
    missionId: mission.id,
    brandId: mission.brandId,
    eventType: launch.ok ? "first_batch_launched" : "launch_blocked",
    summary: launch.ok
      ? `First batch launched for up to ${input.approvedPlan.firstBatchSize} contacts.`
      : `Launch blocked: ${launch.reason}`,
    payload: { launch },
  });

  return refreshMissionRuntimeSummary(mission);
}

export async function startMission(input: {
  brandId: string;
  missionId: string;
  approvedPlan: MissionPlan;
}): Promise<Mission> {
  const mission = await getMission(input.brandId, input.missionId);
  if (!mission) throw new Error("Mission not found.");
  const brand = await getBrandById(input.brandId, { includeEmbedded: true });
  if (!brand) throw new Error("Brand not found.");

  const approvedPlan = {
    ...input.approvedPlan,
    firstBatchSize: clampFirstBatch(input.approvedPlan.firstBatchSize),
    targetCustomers: asLines(input.approvedPlan.targetCustomers),
    avoidList: asLines(input.approvedPlan.avoidList),
  };
  const approvalPolicy = {
    ...defaultMissionApprovalPolicy(approvedPlan.firstBatchSize),
    planApprovedAt: nowIso(),
  };

  await updateMission(input.brandId, input.missionId, {
    status: "starting",
    approvedPlan,
    approvalPolicy,
    lastError: "",
  });
  await createMissionEvent({
    missionId: mission.id,
    brandId: mission.brandId,
    eventType: "plan_approved",
    summary: "Mission plan approved. Operator is preparing the internal campaign.",
    payload: { firstBatchSize: approvedPlan.firstBatchSize },
  });

  await updateBrand(input.brandId, {
    website: mission.websiteUrl,
    product: approvedPlan.offerSummary,
    notes: buildMissionNotes(approvedPlan),
    targetMarkets: approvedPlan.targetCustomers.slice(0, 5),
    idealCustomerProfiles: approvedPlan.targetCustomers,
    keyBenefits: [approvedPlan.outreachAngle, approvedPlan.successCriteria].filter(Boolean),
  });
  await createMissionAgentDecision({
    missionId: mission.id,
    brandId: mission.brandId,
    agent: "mission_operator",
    action: "update_brand_context",
    rationale: "The approved mission plan becomes the brand context used by sourcing, messaging, and deliverability checks.",
    riskLevel: "safe_write",
    input: { websiteUrl: mission.websiteUrl, targetCustomerText: mission.targetCustomerText },
    output: {
      offerSummary: approvedPlan.offerSummary,
      targetCustomers: approvedPlan.targetCustomers,
      avoidList: approvedPlan.avoidList,
    },
  });

  const deliverabilityState = await inspectMissionDeliverability(input.brandId);
  await updateMission(input.brandId, input.missionId, { deliverabilityState });
  await createMissionAgentDecision({
    missionId: mission.id,
    brandId: mission.brandId,
    agent: "deliverability_operator",
    action: "inspect_sender_readiness",
    rationale: "Outbound should only launch after inboxes, warmup policy, and sender readiness are acceptable.",
    riskLevel: deliverabilityState.stage === "ready" ? "read" : "guarded_write",
    input: { brandId: input.brandId },
    output: { deliverabilityState },
  });

  let updatedMission =
    (await updateMission(input.brandId, input.missionId, {
      deliverabilityState,
      status: shouldWaitForDeliverability(deliverabilityState.stage) ? "deliverability_blocked" : "starting",
      lastError: shouldWaitForDeliverability(deliverabilityState.stage) ? deliverabilityState.primaryBlocker : "",
    })) ?? mission;

  updatedMission = await ensureMissionRuntime({
    mission: updatedMission,
    approvedPlan,
    brandName: brand.name,
  });

  if (shouldWaitForDeliverability(deliverabilityState.stage)) {
    await createMissionEvent({
      missionId: mission.id,
      brandId: mission.brandId,
      eventType: "deliverability_waiting",
      summary: deliverabilityState.summary,
      payload: { deliverabilityState },
    });
    return updatedMission;
  }

  return launchApprovedMissionFirstBatch({
    mission: updatedMission,
    approvedPlan,
    deliverabilityState,
    brandName: brand.name,
  });
}

export async function runMissionAutopilotTick(limit = 10) {
  const missions = await listMissionsByStatuses(["starting", "deliverability_blocked"]);
  const rows = [];
  for (const mission of missions.slice(0, limit)) {
    if (!hasApprovedMissionPlan(mission)) {
      rows.push({
        missionId: mission.id,
        brandId: mission.brandId,
        status: mission.status,
        ok: true,
        skipped: "no_approved_plan",
      });
      continue;
    }

    try {
      const deliverabilityState = await inspectMissionDeliverability(mission.brandId);
      const updatedMission =
        (await updateMission(mission.brandId, mission.id, {
          deliverabilityState,
          status: shouldWaitForDeliverability(deliverabilityState.stage) ? "deliverability_blocked" : "starting",
          lastError: shouldWaitForDeliverability(deliverabilityState.stage) ? deliverabilityState.primaryBlocker : "",
        })) ?? mission;

      if (shouldWaitForDeliverability(deliverabilityState.stage)) {
        rows.push({
          missionId: updatedMission.id,
          brandId: updatedMission.brandId,
          status: updatedMission.status,
          deliverabilityStage: deliverabilityState.stage,
          ok: true,
          waiting: true,
        });
        continue;
      }

      const launched = await launchApprovedMissionFirstBatch({
        mission: updatedMission,
        approvedPlan: updatedMission.approvedPlan,
        deliverabilityState,
      });
      rows.push({
        missionId: launched.id,
        brandId: launched.brandId,
        status: launched.status,
        runId: launched.currentRunId,
        ok: true,
      });
    } catch (error) {
      rows.push({
        missionId: mission.id,
        brandId: mission.brandId,
        status: mission.status,
        ok: false,
        error: error instanceof Error ? error.message : "mission autopilot failed",
      });
    }
  }

  return {
    checked: missions.length,
    advanced: rows.filter((row) => row.ok && !("waiting" in row) && !("skipped" in row)).length,
    waiting: rows.filter((row) => "waiting" in row).length,
    failed: rows.filter((row) => !row.ok).length,
    missions: rows,
  };
}
