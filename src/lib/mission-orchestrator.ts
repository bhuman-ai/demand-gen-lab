import { createExperimentRecord, ensureRuntimeForExperiment } from "@/lib/experiment-data";
import { getBrandById, updateBrand } from "@/lib/factory-data";
import { launchExperimentRun } from "@/lib/outreach-runtime";
import {
  createMissionAgentDecision,
  createMissionEvent,
  defaultMissionApprovalPolicy,
  getMission,
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
  return stage === "preparing_inboxes" || stage === "warming_domains" || stage === "testing_inbox_placement";
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

  const experiment = await createExperimentRecord({
    brandId: input.brandId,
    name: `${brand.name || "Brand"} Mission Test`,
    offer: approvedPlan.offerSummary,
    audience: approvedPlan.targetCustomers.join("; "),
  });
  const runtimeExperiment = await ensureRuntimeForExperiment(experiment);
  await createMissionAgentDecision({
    missionId: mission.id,
    brandId: mission.brandId,
    agent: "mission_operator",
    action: "compile_to_internal_experiment",
    rationale: "The user sees one mission, while the existing outreach runtime still uses experiments internally.",
    riskLevel: "safe_write",
    input: { missionId: mission.id },
    output: {
      experimentId: runtimeExperiment.id,
      runtimeCampaignId: runtimeExperiment.runtime.campaignId,
      runtimeExperimentId: runtimeExperiment.runtime.experimentId,
    },
  });

  let updatedMission =
    (await updateMission(input.brandId, input.missionId, {
      currentExperimentId: runtimeExperiment.id,
      currentRuntimeCampaignId: runtimeExperiment.runtime.campaignId,
      currentRuntimeExperimentId: runtimeExperiment.runtime.experimentId,
      deliverabilityState,
      status: shouldWaitForDeliverability(deliverabilityState.stage) ? "deliverability_blocked" : "starting",
      lastError: shouldWaitForDeliverability(deliverabilityState.stage) ? deliverabilityState.primaryBlocker : "",
    })) ?? mission;

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

  const launch = await launchExperimentRun({
    brandId: input.brandId,
    campaignId: runtimeExperiment.runtime.campaignId,
    experimentId: runtimeExperiment.runtime.experimentId,
    trigger: "manual",
    ownerType: "experiment",
    ownerId: runtimeExperiment.id,
    maxLeadsOverride: approvedPlan.firstBatchSize,
  });

  await createMissionAgentDecision({
    missionId: mission.id,
    brandId: mission.brandId,
    agent: "launch_operator",
    action: "launch_first_batch",
    rationale: "The approved plan allows a small first batch. Scaling remains gated by learning and approval policy.",
    riskLevel: launch.ok ? "guarded_write" : "blocked",
    input: {
      firstBatchSize: approvedPlan.firstBatchSize,
      runtimeCampaignId: runtimeExperiment.runtime.campaignId,
      runtimeExperimentId: runtimeExperiment.runtime.experimentId,
    },
    output: launch,
  });

  updatedMission =
    (await updateMission(input.brandId, input.missionId, {
      currentRunId: launch.runId,
      status: launch.ok ? "running" : "deliverability_blocked",
      lastError: launch.ok ? "" : launch.reason,
      deliverabilityState: launch.ok
        ? deliverabilityState
        : {
            ...deliverabilityState,
            stage: "needs_attention",
            summary: launch.reason,
            primaryBlocker: launch.reason,
            lastCheckedAt: nowIso(),
          },
    })) ?? updatedMission;

  await createMissionEvent({
    missionId: mission.id,
    brandId: mission.brandId,
    eventType: launch.ok ? "first_batch_launched" : "launch_blocked",
    summary: launch.ok
      ? `First batch launched for up to ${approvedPlan.firstBatchSize} contacts.`
      : `Launch blocked: ${launch.reason}`,
    payload: { launch },
  });

  return refreshMissionRuntimeSummary(updatedMission);
}
