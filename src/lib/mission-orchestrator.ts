import {
  createExperimentRecord,
  ensureRuntimeForExperiment,
  getExperimentRecordByRuntimeRef,
} from "@/lib/experiment-data";
import { getBrandById, getCampaignById, updateBrand } from "@/lib/factory-data";
import {
  getPublishedConversationMapForExperiment,
  publishConversationMap,
  upsertConversationMapDraft,
} from "@/lib/conversation-flow-data";
import { generateScreenedConversationFlowGraph } from "@/lib/conversation-flow-generation";
import {
  enqueueOutreachJob,
  getOutreachRun,
  listRunJobs,
  listRunMessages,
  updateOutreachRun,
} from "@/lib/outreach-data";
import { launchExperimentRun } from "@/lib/outreach-runtime";
import {
  createMissionAgentDecision,
  createMissionEvent,
  defaultMissionApprovalPolicy,
  getMission,
  listMissionsByStatuses,
  updateMission,
} from "@/lib/mission-data";
import { ensureMissionDeliverabilityCapacity } from "@/lib/mission-deliverability-capacity";
import { refreshMissionRuntimeSummary } from "@/lib/mission-learning";
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

function parseOfferAndCta(rawOffer: string) {
  const text = String(rawOffer ?? "").trim();
  if (!text) return { offer: "", cta: "" };
  const ctaMatch = text.match(/\bCTA\s*:\s*([^\n]+)/i);
  const cta = ctaMatch ? ctaMatch[1].trim() : "";
  const offer = text.replace(/\bCTA\s*:\s*[^\n]+/gi, "").replace(/\s{2,}/g, " ").trim();
  return { offer, cta };
}

function shouldWaitForDeliverability(stage: Mission["deliverabilityState"]["stage"]) {
  return stage !== "ready";
}

function hasApprovedMissionPlan(mission: Mission) {
  return Boolean(mission.approvalPolicy.planApprovedAt && mission.approvedPlan.offerSummary.trim());
}

function runCanContinue(status: string) {
  return ["queued", "sourcing", "scheduled", "sending", "monitoring"].includes(status);
}

function hasScheduledOrSentMessages(
  messages: Awaited<ReturnType<typeof listRunMessages>>
) {
  return messages.some((message) => ["scheduled", "sent"].includes(message.status));
}

function hasActivePreparationJob(jobs: Awaited<ReturnType<typeof listRunJobs>>) {
  return jobs.some(
    (job) =>
      ["queued", "running"].includes(job.status) &&
      ["source_leads", "schedule_messages"].includes(job.jobType)
  );
}

function textLooksDeliverabilityRelated(value: string) {
  return /deliverability|inbox|placement|spam|seed|pre[-_ ]?send|sender|warmup/i.test(value);
}

async function shouldAutopilotProcessMission(mission: Mission) {
  if (mission.status !== "paused") return true;
  if (
    textLooksDeliverabilityRelated(
      `${mission.lastError} ${mission.deliverabilityState.primaryBlocker} ${mission.deliverabilityState.summary}`
    )
  ) {
    return true;
  }
  const run = mission.currentRunId ? await getOutreachRun(mission.currentRunId).catch(() => null) : null;
  return Boolean(run && textLooksDeliverabilityRelated(`${run.pauseReason} ${run.lastError}`));
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

async function ensureMissionConversationMap(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
  brandName?: string;
}): Promise<{ ok: boolean; reason: string; publishedRevision: number }> {
  if (!input.mission.currentRuntimeCampaignId || !input.mission.currentRuntimeExperimentId) {
    return { ok: false, reason: "Mission runtime is not configured.", publishedRevision: 0 };
  }

  const existing = await getPublishedConversationMapForExperiment(
    input.mission.brandId,
    input.mission.currentRuntimeCampaignId,
    input.mission.currentRuntimeExperimentId
  );
  if (existing?.publishedRevision) {
    return { ok: true, reason: "Conversation Map already published.", publishedRevision: existing.publishedRevision };
  }

  const [brand, campaign, sourceExperiment] = await Promise.all([
    getBrandById(input.mission.brandId, { includeEmbedded: true }).catch(() => null),
    getCampaignById(input.mission.brandId, input.mission.currentRuntimeCampaignId).catch(() => null),
    getExperimentRecordByRuntimeRef(
      input.mission.brandId,
      input.mission.currentRuntimeCampaignId,
      input.mission.currentRuntimeExperimentId
    ).catch(() => null),
  ]);
  if (!campaign) {
    return { ok: false, reason: "Runtime campaign not found.", publishedRevision: 0 };
  }
  const variant = campaign.experiments.find((item) => item.id === input.mission.currentRuntimeExperimentId) ?? null;
  if (!variant) {
    return { ok: false, reason: "Runtime campaign variant not found.", publishedRevision: 0 };
  }
  const hypothesis = campaign.hypotheses.find((item) => item.id === variant.hypothesisId) ?? null;
  const parsed = parseOfferAndCta(sourceExperiment?.offer ?? input.approvedPlan.offerSummary);

  const generated = await generateScreenedConversationFlowGraph({
    context: {
      brand: {
        name: brand?.name ?? input.brandName ?? "",
        website: brand?.website ?? input.mission.websiteUrl,
        tone: brand?.tone ?? "",
        notes: brand?.notes ?? "",
      },
      campaign: {
        campaignName: campaign.name,
        objectiveGoal: campaign.objective?.goal ?? input.approvedPlan.successCriteria,
        objectiveConstraints: campaign.objective?.constraints ?? input.approvedPlan.primaryRisk,
        angleTitle: hypothesis?.title ?? input.approvedPlan.outreachAngle,
        angleRationale: hypothesis?.rationale ?? "",
        targetAudience: hypothesis?.actorQuery ?? input.approvedPlan.targetCustomers.join("; "),
        variantName: variant.name,
        variantNotes: variant.notes ?? "",
      },
      experiment: {
        experimentRecordName: sourceExperiment?.name ?? variant.name,
        offer: parsed.offer || sourceExperiment?.offer || input.approvedPlan.offerSummary,
        cta: parsed.cta || "",
        audience: sourceExperiment?.audience || input.approvedPlan.targetCustomers.join("; "),
        ultimateGoal: input.approvedPlan.successCriteria,
        testEnvelope: sourceExperiment?.testEnvelope ?? null,
      },
    },
  });
  await upsertConversationMapDraft({
    brandId: input.mission.brandId,
    campaignId: input.mission.currentRuntimeCampaignId,
    experimentId: input.mission.currentRuntimeExperimentId,
    name: `${variant.name || "Mission"} Conversation Flow`,
    draftGraph: generated.graph,
  });
  const published = await publishConversationMap({
    brandId: input.mission.brandId,
    campaignId: input.mission.currentRuntimeCampaignId,
    experimentId: input.mission.currentRuntimeExperimentId,
  });
  if (!published?.publishedRevision) {
    return { ok: false, reason: "Failed to publish generated Conversation Map.", publishedRevision: 0 };
  }

  await createMissionAgentDecision({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    agent: "conversation_map_operator",
    action: "generate_and_publish_conversation_map",
    rationale: "Autopilot missions must not require the user to manually build the first outbound message flow.",
    riskLevel: "safe_write",
    input: {
      runtimeCampaignId: input.mission.currentRuntimeCampaignId,
      runtimeExperimentId: input.mission.currentRuntimeExperimentId,
      mode: generated.mode,
    },
    output: {
      publishedRevision: published.publishedRevision,
      summary: generated.summary,
      selectedIndex: generated.selectedIndex,
      score: generated.score,
    },
  });
  await createMissionEvent({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    eventType: "conversation_map_published_auto",
    summary: "AI generated and published the first outbound Conversation Map.",
    payload: {
      publishedRevision: published.publishedRevision,
      mode: generated.mode,
      summary: generated.summary,
    },
  });

  return { ok: true, reason: "Conversation Map generated and published.", publishedRevision: published.publishedRevision };
}

async function ensureMissionPreparedForDeliverabilityProof(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
}): Promise<Mission> {
  let mission = input.mission;
  if (!mission.currentRuntimeCampaignId || !mission.currentRuntimeExperimentId) {
    return mission;
  }

  if (mission.currentRunId) {
    const currentRun = await getOutreachRun(mission.currentRunId).catch(() => null);
    if (currentRun) {
      const messages = await listRunMessages(currentRun.id).catch(() => []);
      if (hasScheduledOrSentMessages(messages)) {
        return mission;
      }

      const jobs = await listRunJobs(currentRun.id, 25).catch(() => []);
      if (hasActivePreparationJob(jobs) && ["queued", "sourcing", "scheduled"].includes(currentRun.status)) {
        return mission;
      }

      if (!["preflight_failed", "failed", "canceled", "completed"].includes(currentRun.status)) {
        await updateOutreachRun(currentRun.id, {
          status: "canceled",
          completedAt: nowIso(),
          pauseReason: "",
          lastError: "Replaced by campaign-copy deliverability proof preparation.",
        });
      }
      await createMissionEvent({
        missionId: mission.id,
        brandId: mission.brandId,
        eventType: "stale_delivery_proof_run_replaced",
        summary: "Previous run had no real campaign copy available for inbox-placement proof.",
        payload: {
          previousRunId: currentRun.id,
          previousRunStatus: currentRun.status,
          activePreparationJobs: jobs
            .filter((job) => ["queued", "running"].includes(job.status))
            .map((job) => ({ jobId: job.id, jobType: job.jobType, status: job.status })),
        },
      });
    } else {
      await createMissionEvent({
        missionId: mission.id,
        brandId: mission.brandId,
        eventType: "stale_delivery_proof_run_replaced",
        summary: "Previous run could not be found; preparing a fresh campaign-copy proof run.",
        payload: { previousRunId: mission.currentRunId, previousRunStatus: "missing" },
      });
    }

    mission =
      (await updateMission(mission.brandId, mission.id, {
        currentRunId: "",
        lastError: "",
      })) ?? mission;
  }

  const launch = await launchExperimentRun({
    brandId: mission.brandId,
    campaignId: mission.currentRuntimeCampaignId,
    experimentId: mission.currentRuntimeExperimentId,
    trigger: "manual",
    ownerType: "experiment",
    ownerId: mission.currentExperimentId,
    maxLeadsOverride: clampFirstBatch(input.approvedPlan.firstBatchSize),
    deliverabilityProofOnly: true,
  });

  await createMissionAgentDecision({
    missionId: mission.id,
    brandId: mission.brandId,
    agent: "mission_operator",
    action: "prepare_campaign_copy_for_delivery_proof",
    rationale:
      "Inbox placement must be tested with the actual first campaign email before any prospect dispatch is queued.",
    riskLevel: launch.ok ? "guarded_write" : "blocked",
    input: {
      runtimeCampaignId: mission.currentRuntimeCampaignId,
      runtimeExperimentId: mission.currentRuntimeExperimentId,
      firstBatchSize: clampFirstBatch(input.approvedPlan.firstBatchSize),
    },
    output: launch,
  });

  mission =
    (await updateMission(mission.brandId, mission.id, {
      currentRunId: launch.runId || mission.currentRunId,
      status: "deliverability_blocked",
      lastError: launch.ok ? "" : launch.reason,
    })) ?? mission;

  await createMissionEvent({
    missionId: mission.id,
    brandId: mission.brandId,
    eventType: launch.ok ? "campaign_copy_proof_preparing" : "campaign_copy_proof_prepare_blocked",
    summary: launch.ok
      ? "Queued real campaign-copy preparation for inbox-placement proof."
      : `Could not prepare campaign-copy proof: ${launch.reason}`,
    payload: { launch },
  });

  return mission;
}

async function queuePreparedRunDispatch(input: {
  mission: Mission;
  runId: string;
}): Promise<{ queued: boolean; reason: string; scheduledMessageCount: number }> {
  const run = await getOutreachRun(input.runId).catch(() => null);
  if (!run) {
    return { queued: false, reason: "Run not found.", scheduledMessageCount: 0 };
  }
  const messages = await listRunMessages(run.id).catch(() => []);
  const scheduledMessageCount = messages.filter((message) => message.status === "scheduled").length;
  if (scheduledMessageCount === 0) {
    return {
      queued: false,
      reason: "No scheduled campaign messages are ready for dispatch.",
      scheduledMessageCount,
    };
  }

  const jobs = await listRunJobs(run.id, 25).catch(() => []);
  const activeDispatchJob = jobs.find(
    (job) => job.jobType === "dispatch_messages" && ["queued", "running"].includes(job.status)
  );
  if (activeDispatchJob) {
    return {
      queued: true,
      reason: "Dispatch is already queued.",
      scheduledMessageCount,
    };
  }

  if (run.status === "paused") {
    await updateOutreachRun(run.id, {
      status: "scheduled",
      pauseReason: "",
      lastError: "",
    });
  }
  await enqueueOutreachJob({
    runId: run.id,
    jobType: "dispatch_messages",
    executeAfter: nowIso(),
    payload: {
      source: "mission_deliverability_ready",
    },
  });
  await createMissionEvent({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    eventType: "prepared_run_dispatch_queued",
    summary: `Deliverability is ready; queued dispatch for ${scheduledMessageCount} prepared messages.`,
    payload: {
      runId: run.id,
      runStatus: run.status,
      scheduledMessageCount,
    },
  });

  return { queued: true, reason: "Dispatch queued.", scheduledMessageCount };
}

async function launchApprovedMissionFirstBatch(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
  deliverabilityState: Mission["deliverabilityState"];
  brandName?: string;
}): Promise<Mission> {
  let mission = await ensureMissionRuntime(input);
  if (mission.currentRunId) {
    const currentRun = await getOutreachRun(mission.currentRunId).catch(() => null);
    if (currentRun && runCanContinue(currentRun.status)) {
      if (input.deliverabilityState.stage === "ready" && currentRun.status === "scheduled") {
        const dispatch = await queuePreparedRunDispatch({ mission, runId: currentRun.id });
        if (dispatch.queued) {
          mission =
            (await updateMission(mission.brandId, mission.id, {
              status: "running",
              lastError: "",
            })) ?? mission;
          return refreshMissionRuntimeSummary(mission);
        }
      } else {
        return refreshMissionRuntimeSummary(mission);
      }
    }
    if (currentRun && currentRun.status === "paused" && input.deliverabilityState.stage === "ready") {
      const dispatch = await queuePreparedRunDispatch({ mission, runId: currentRun.id });
      if (dispatch.queued) {
        mission =
          (await updateMission(mission.brandId, mission.id, {
            status: "running",
            lastError: "",
          })) ?? mission;
        return refreshMissionRuntimeSummary(mission);
      }
    }
    await createMissionEvent({
      missionId: mission.id,
      brandId: mission.brandId,
      eventType: "stale_run_replaced",
      summary: currentRun
        ? `Previous run is ${currentRun.status}; launching a fresh run.`
        : "Previous run could not be found; launching a fresh run.",
      payload: {
        previousRunId: mission.currentRunId,
        previousRunStatus: currentRun?.status ?? "missing",
      },
    });
    mission =
      (await updateMission(mission.brandId, mission.id, {
        currentRunId: "",
        lastError: "",
      })) ?? mission;
  }

  const conversationMap = await ensureMissionConversationMap({
    mission,
    approvedPlan: input.approvedPlan,
    brandName: input.brandName,
  });
  if (!conversationMap.ok) {
    await createMissionAgentDecision({
      missionId: mission.id,
      brandId: mission.brandId,
      agent: "conversation_map_operator",
      action: "generate_and_publish_conversation_map",
      rationale: "A published Conversation Map is required before launching the first batch.",
      riskLevel: "blocked",
      input: {
        runtimeCampaignId: mission.currentRuntimeCampaignId,
        runtimeExperimentId: mission.currentRuntimeExperimentId,
      },
      output: conversationMap,
    });
    mission =
      (await updateMission(mission.brandId, mission.id, {
        status: "deliverability_blocked",
        lastError: conversationMap.reason,
        deliverabilityState: {
          ...input.deliverabilityState,
          stage: "needs_attention",
          summary: conversationMap.reason,
          primaryBlocker: conversationMap.reason,
          lastCheckedAt: nowIso(),
        },
      })) ?? mission;
    return mission;
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
  autopilot?: boolean;
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
  const autoProvisioningAllowed = Boolean(input.autopilot && approvedPlan.deliverabilityPlan.autoProvisioning !== false);
  const approvalPolicy = {
    ...defaultMissionApprovalPolicy(approvedPlan.firstBatchSize),
    planApprovedAt: nowIso(),
    allowAutoProvisioning: autoProvisioningAllowed,
    allowAutoDomainPurchase: autoProvisioningAllowed,
    maxAutoProvisionedSenders: autoProvisioningAllowed ? 3 : 0,
    maxAutoDomainSpendUsd: autoProvisioningAllowed ? 40 : 0,
    requireApprovalForNewDomainPurchase: !autoProvisioningAllowed,
  };

  let updatedMission =
    (await updateMission(input.brandId, input.missionId, {
      status: "starting",
      approvedPlan,
      approvalPolicy,
      lastError: "",
    })) ?? mission;
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

  updatedMission = await ensureMissionRuntime({
    mission: updatedMission,
    approvedPlan,
    brandName: brand.name,
  });
  const conversationMap = await ensureMissionConversationMap({
    mission: updatedMission,
    approvedPlan,
    brandName: brand.name,
  }).catch((error) => {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Failed to auto-publish Conversation Map.",
      publishedRevision: 0,
    };
  });
  if (!conversationMap.ok) {
    await createMissionEvent({
      missionId: updatedMission.id,
      brandId: updatedMission.brandId,
      eventType: "conversation_map_auto_publish_failed",
      summary: conversationMap.reason,
      payload: { publishedRevision: conversationMap.publishedRevision },
    });
  } else {
    updatedMission = await ensureMissionPreparedForDeliverabilityProof({
      mission: updatedMission,
      approvedPlan,
    });
  }

  const capacity = await ensureMissionDeliverabilityCapacity({
    mission: updatedMission,
    approvedPlan,
  });
  const deliverabilityState = capacity.deliverabilityState;
  updatedMission = capacity.mission;
  await createMissionAgentDecision({
    missionId: mission.id,
    brandId: mission.brandId,
    agent: "deliverability_operator",
    action: input.autopilot ? "ensure_sender_capacity" : "inspect_sender_readiness",
    rationale: input.autopilot
      ? "Autopilot should actively assign, warm, or provision sender capacity, then only launch after readiness checks pass."
      : "Outbound should only launch after inboxes, warmup policy, and sender readiness are acceptable.",
    riskLevel: deliverabilityState.stage === "ready" ? "read" : "guarded_write",
    input: { brandId: input.brandId, autopilot: Boolean(input.autopilot), approvalPolicy },
    output: { deliverabilityState },
  });

  updatedMission =
    (await updateMission(input.brandId, input.missionId, {
      deliverabilityState,
      status: shouldWaitForDeliverability(deliverabilityState.stage) ? "deliverability_blocked" : "starting",
      lastError: shouldWaitForDeliverability(deliverabilityState.stage) ? deliverabilityState.primaryBlocker : "",
    })) ?? updatedMission;

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
  const missions = await listMissionsByStatuses(["starting", "deliverability_blocked", "paused", "running"]);
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

    if (!(await shouldAutopilotProcessMission(mission))) {
      rows.push({
        missionId: mission.id,
        brandId: mission.brandId,
        status: mission.status,
        ok: true,
        skipped: "paused_not_deliverability",
      });
      continue;
    }

    try {
      let updatedMission = await ensureMissionRuntime({
        mission,
        approvedPlan: mission.approvedPlan,
      });
      const conversationMap = await ensureMissionConversationMap({
        mission: updatedMission,
        approvedPlan: updatedMission.approvedPlan,
      }).catch((error) => {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : "Failed to auto-publish Conversation Map.",
          publishedRevision: 0,
        };
      });
      if (!conversationMap.ok) {
        await createMissionEvent({
          missionId: updatedMission.id,
          brandId: updatedMission.brandId,
          eventType: "conversation_map_auto_publish_failed",
          summary: conversationMap.reason,
          payload: { publishedRevision: conversationMap.publishedRevision },
        });
      } else {
        updatedMission = await ensureMissionPreparedForDeliverabilityProof({
          mission: updatedMission,
          approvedPlan: updatedMission.approvedPlan,
        });
      }

      const capacity = await ensureMissionDeliverabilityCapacity({
        mission: updatedMission,
        approvedPlan: updatedMission.approvedPlan,
      });
      const deliverabilityState = capacity.deliverabilityState;
      updatedMission = capacity.mission;
      updatedMission =
        (await updateMission(mission.brandId, mission.id, {
          deliverabilityState,
          status: shouldWaitForDeliverability(deliverabilityState.stage) ? "deliverability_blocked" : "starting",
          lastError: shouldWaitForDeliverability(deliverabilityState.stage) ? deliverabilityState.primaryBlocker : "",
        })) ?? updatedMission;

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
