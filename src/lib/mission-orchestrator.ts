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
  listRunLeads,
  listRunEvents,
  listRunMessages,
  updateOutreachJob,
  updateOutreachRun,
} from "@/lib/outreach-data";
import { launchExperimentRun } from "@/lib/outreach-runtime";
import { resolveLlmModel } from "@/lib/llm-router";
import {
  createMissionAgentDecision,
  createMissionEvent,
  defaultMissionApprovalPolicy,
  getMission,
  listMissionEvents,
  listMissionsByStatuses,
  updateMission,
} from "@/lib/mission-data";
import { ensureMissionDeliverabilityCapacity } from "@/lib/mission-deliverability-capacity";
import { refreshMissionRuntimeSummary } from "@/lib/mission-learning";
import type { Mission, MissionPlan } from "@/lib/mission-types";

const BATCH_READINESS_APPROVAL_REUSE_HOURS = 6;

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(dateIso: string, minutes: number) {
  return new Date(new Date(dateIso).getTime() + minutes * 60_000).toISOString();
}

function dateMs(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function missionOperatorMaxOutputTokens() {
  const parsed = Number(process.env.OPENAI_MISSION_MAX_OUTPUT_TOKENS ?? 8000);
  return Number.isFinite(parsed) ? Math.max(3000, Math.min(20000, Math.round(parsed))) : 8000;
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

function nextScheduledMessageAt(messages: Awaited<ReturnType<typeof listRunMessages>>) {
  return [...messages]
    .filter((message) => message.status === "scheduled")
    .sort((left, right) => (left.scheduledAt < right.scheduledAt ? -1 : 1))[0]?.scheduledAt ?? "";
}

function extractResponseText(payload: unknown) {
  const row = asRecord(payload);
  if (typeof row.output_text === "string") return row.output_text;
  const output = Array.isArray(row.output) ? row.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    const content = asRecord(item).content;
    if (!Array.isArray(content)) continue;
    for (const contentItem of content) {
      const text = asRecord(contentItem).text;
      if (typeof text === "string") chunks.push(text);
    }
  }
  return chunks.join("");
}

type BatchReadinessToolName =
  | "dispatch_prepared_batch"
  | "source_more_leads"
  | "run_smoke_test"
  | "wait_for_batch_readiness"
  | "block_for_policy";

const BATCH_READINESS_TOOLS: BatchReadinessToolName[] = [
  "dispatch_prepared_batch",
  "source_more_leads",
  "run_smoke_test",
  "wait_for_batch_readiness",
  "block_for_policy",
];

type BatchReadinessPlan = {
  toolName: BatchReadinessToolName;
  toolInput: Record<string, unknown>;
  rationale: string;
  expectedOutcome: string;
  model: string;
  raw: Record<string, unknown>;
};

type BatchReadinessSnapshot = {
  mission: {
    id: string;
    brandId: string;
    status: Mission["status"];
    firstBatchTarget: number;
    approvalFirstBatchLimit: number;
    targetCustomers: string[];
    primaryRisk: string;
    successCriteria: string;
  };
  run: {
    id: string;
    status: string;
    metrics: NonNullable<Awaited<ReturnType<typeof getOutreachRun>>>["metrics"] | null;
    pauseReason: string;
    lastError: string;
  };
  batch: {
    leadCount: number;
    scheduledMessageCount: number;
    sentMessageCount: number;
    failedMessageCount: number;
    bouncedMessageCount: number;
    targetLeadCount: number;
    deficitToTarget: number;
    nextScheduledAt: string;
  };
  deliverability: Mission["deliverabilityState"];
  jobs: {
    activeSourceJobIds: string[];
    activeScheduleJobIds: string[];
    activeDispatchJobIds: string[];
    activeDispatchJobs: Array<{
      id: string;
      status: string;
      executeAfter: string;
      postponedByBatchReadinessGate: boolean;
      postponedReason: string;
    }>;
  };
  sourcing: {
    recentFailures: Array<{
      createdAt: string;
      eventType: string;
      reason: string;
      existingLeadCount: number;
      targetLeadCount: number;
      scheduledMessageCount: number;
    }>;
  };
  allowedToolNames: BatchReadinessToolName[];
};

function batchReadinessToolCatalog() {
  return [
    {
      name: "dispatch_prepared_batch",
      description: "Allow the currently prepared scheduled campaign messages to dispatch.",
    },
    {
      name: "source_more_leads",
      description:
        "Queue autonomous lead sourcing/top-up before dispatch. Use when the prepared batch is below target and should not be treated as the full first batch.",
      input: {
        targetLeadCount: "desired total lead count for the run",
        reason: "why more leads should be sourced before dispatch",
      },
    },
    {
      name: "run_smoke_test",
      description:
        "Intentionally dispatch fewer than the first-batch target as a tiny smoke test. Must explain why this is strategically better than topping up first.",
      input: {
        smokeTestSize: "number of scheduled messages to allow now",
        reason: "why a tiny smoke test is warranted",
      },
    },
    {
      name: "wait_for_batch_readiness",
      description: "Do not dispatch yet; wait for active sourcing/scheduling/proof work or another external condition.",
      input: {
        reason: "what the operator is waiting for",
        nextCheckMinutes: "how long to postpone dispatch checks",
      },
    },
    {
      name: "block_for_policy",
      description: "Block dispatch because policy, safety, quality, or missing context prevents a safe action.",
      input: {
        reason: "specific blocker",
        desiredAction: "what should happen before this can continue",
      },
    },
  ];
}

function allowedBatchReadinessTools(snapshot: BatchReadinessSnapshot): BatchReadinessToolName[] {
  const tools: BatchReadinessToolName[] = ["wait_for_batch_readiness", "block_for_policy"];
  if (snapshot.batch.scheduledMessageCount > 0 && snapshot.deliverability.stage === "ready") {
    tools.push("dispatch_prepared_batch", "run_smoke_test");
  }
  const sourceTopUpUnavailable = snapshot.sourcing.recentFailures.some(
    (event) =>
      event.eventType === "lead_sourcing_skipped" &&
      /runtime_sourcing_disabled/i.test(event.reason)
  );
  if (
    snapshot.batch.deficitToTarget > 0 &&
    snapshot.run.status !== "completed" &&
    snapshot.run.status !== "canceled" &&
    snapshot.run.status !== "failed" &&
    snapshot.jobs.activeSourceJobIds.length === 0 &&
    !sourceTopUpUnavailable
  ) {
    tools.push("source_more_leads");
  }
  return tools;
}

async function findReusableBatchReadinessApproval(input: {
  missionId: string;
  snapshot: BatchReadinessSnapshot;
}) {
  if (input.snapshot.deliverability.stage !== "ready") return null;
  if (input.snapshot.batch.scheduledMessageCount <= 0) return null;
  if (input.snapshot.jobs.activeSourceJobIds.length || input.snapshot.jobs.activeScheduleJobIds.length) return null;
  if (
    !input.snapshot.allowedToolNames.includes("dispatch_prepared_batch") &&
    !input.snapshot.allowedToolNames.includes("run_smoke_test")
  ) {
    return null;
  }

  const minCreatedAt = Date.now() - BATCH_READINESS_APPROVAL_REUSE_HOURS * 60 * 60 * 1000;
  const events = await listMissionEvents(input.missionId, 25).catch(() => []);
  return (
    events.find((event) => {
      if (!["batch_dispatch_approved", "batch_smoke_test_approved"].includes(event.eventType)) return false;
      if (dateMs(event.createdAt) < minCreatedAt) return false;
      const payload = asRecord(event.payload);
      const approvedScheduledCount = asNumber(payload.scheduledMessageCount, 0);
      if (approvedScheduledCount <= 0) return false;
      return input.snapshot.batch.scheduledMessageCount <= approvedScheduledCount;
    }) ?? null
  );
}

async function buildBatchReadinessSnapshot(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
  runId: string;
  deliverabilityState: Mission["deliverabilityState"];
}): Promise<BatchReadinessSnapshot | null> {
  const run = await getOutreachRun(input.runId).catch(() => null);
  if (!run) return null;
  const [leads, messages, jobs, events] = await Promise.all([
    listRunLeads(run.id).catch(() => []),
    listRunMessages(run.id).catch(() => []),
    listRunJobs(run.id, 50).catch(() => []),
    listRunEvents(run.id).catch(() => []),
  ]);
  const scheduledMessages = messages.filter((message) => message.status === "scheduled");
  const sentMessageCount = messages.filter((message) => message.status === "sent").length;
  const targetLeadCount = Math.max(
    1,
    Math.min(
      input.mission.approvalPolicy.firstBatchLimit || clampFirstBatch(input.approvedPlan.firstBatchSize),
      clampFirstBatch(input.approvedPlan.firstBatchSize)
    )
  );
  const activeJobs = jobs.filter((job) => ["queued", "running"].includes(job.status));
  const activeDispatchJobs = activeJobs.filter((job) => job.jobType === "dispatch_messages");
  const snapshot: BatchReadinessSnapshot = {
    mission: {
      id: input.mission.id,
      brandId: input.mission.brandId,
      status: input.mission.status,
      firstBatchTarget: clampFirstBatch(input.approvedPlan.firstBatchSize),
      approvalFirstBatchLimit: input.mission.approvalPolicy.firstBatchLimit,
      targetCustomers: input.approvedPlan.targetCustomers,
      primaryRisk: input.approvedPlan.primaryRisk,
      successCriteria: input.approvedPlan.successCriteria,
    },
    run: {
      id: run.id,
      status: run.status,
      metrics: run.metrics,
      pauseReason: run.pauseReason,
      lastError: run.lastError,
    },
    batch: {
      leadCount: leads.length,
      scheduledMessageCount: scheduledMessages.length,
      sentMessageCount,
      failedMessageCount: messages.filter((message) => message.status === "failed").length,
      bouncedMessageCount: messages.filter((message) => message.status === "bounced").length,
      targetLeadCount,
      deficitToTarget: Math.max(0, targetLeadCount - Math.max(leads.length, scheduledMessages.length + sentMessageCount)),
      nextScheduledAt: nextScheduledMessageAt(messages),
    },
    deliverability: input.deliverabilityState,
    jobs: {
      activeSourceJobIds: activeJobs.filter((job) => job.jobType === "source_leads").map((job) => job.id),
      activeScheduleJobIds: activeJobs.filter((job) => job.jobType === "schedule_messages").map((job) => job.id),
      activeDispatchJobIds: activeDispatchJobs.map((job) => job.id),
      activeDispatchJobs: activeDispatchJobs.map((job) => {
        const payload = asRecord(job.payload);
        return {
          id: job.id,
          status: job.status,
          executeAfter: job.executeAfter,
          postponedByBatchReadinessGate: payload.postponedByBatchReadinessGate === true,
          postponedReason: asString(payload.postponedReason),
        };
      }),
    },
    sourcing: {
      recentFailures: events
        .filter(
          (event) =>
            event.eventType === "lead_sourcing_top_up_failed" ||
            event.eventType === "lead_sourcing_failed" ||
            event.eventType === "lead_sourcing_skipped"
        )
        .slice(0, 5)
        .map((event) => {
          const payload = asRecord(event.payload);
          return {
            createdAt: event.createdAt,
            eventType: event.eventType,
            reason: asString(payload.reason),
            existingLeadCount: asNumber(payload.existingLeadCount, 0),
            targetLeadCount: asNumber(payload.targetLeadCount, 0),
            scheduledMessageCount: asNumber(payload.scheduledMessageCount, 0),
          };
        })
        .filter((event) => !(event.eventType === "lead_sourcing_skipped" && event.reason === "leads_already_present")),
    },
    allowedToolNames: [],
  };
  snapshot.allowedToolNames = allowedBatchReadinessTools(snapshot);
  return snapshot;
}

function buildBatchReadinessPrompt(snapshot: BatchReadinessSnapshot) {
  return [
    "You are the LastB2B mission batch-readiness operator.",
    "You are the decision-maker. The code will not decide whether a below-target prepared batch is acceptable.",
    "Choose exactly one tool from the catalog. Provide exact tool arguments.",
    "Use the mission goal and live state. If the first-batch target is 25 and only 2 are prepared, do not silently treat 2 as complete.",
    "You may still choose a tiny smoke test, but only if it is strategically better than sourcing more leads first. Explain why.",
    "If more leads are needed, choose source_more_leads. The system will top up and render campaign copy without dispatching until this gate passes again.",
    "If active sourcing or scheduling is already running, choose wait_for_batch_readiness.",
    "A dispatch job with postponedByBatchReadinessGate=true is held by this gate; it is not evidence that dispatch is actively sending. If dispatch is now the right move, choose dispatch_prepared_batch to release it.",
    "If recentFailures shows runtime_sourcing_disabled or repeated top-ups that did not increase leads/messages, source_more_leads will be unavailable. Choose dispatch_prepared_batch, run_smoke_test, or block_for_policy based on the mission state.",
    "If recent sourcing top-up failed and prepared campaign copy already exists, decide whether to retry with a changed reason, run a smoke test, dispatch the prepared batch, or block. Do not blindly repeat the same top-up loop.",
    "Return only JSON matching the schema. Put tool arguments in toolInputJson as a JSON object encoded in a string.",
    "",
    `Tool catalog JSON:\n${JSON.stringify(batchReadinessToolCatalog())}`,
    "",
    `Mission batch state JSON:\n${JSON.stringify(snapshot)}`,
  ].join("\n");
}

function normalizeBatchReadinessPlan(
  value: unknown,
  model: string,
  fallback: { toolName: BatchReadinessToolName; rationale: string; toolInput?: Record<string, unknown> }
): BatchReadinessPlan {
  const row = asRecord(value);
  let toolInput = asRecord(row.toolInput);
  const toolInputJson = asString(row.toolInputJson);
  if (toolInputJson) {
    try {
      toolInput = asRecord(JSON.parse(toolInputJson));
    } catch {
      toolInput = {};
    }
  }
  const requestedToolName = asString(row.toolName) as BatchReadinessToolName;
  const toolName = BATCH_READINESS_TOOLS.includes(requestedToolName) ? requestedToolName : fallback.toolName;
  return {
    toolName,
    toolInput: toolName === requestedToolName ? toolInput : (fallback.toolInput ?? {}),
    rationale: asString(row.rationale) || fallback.rationale,
    expectedOutcome: asString(row.expectedOutcome),
    model,
    raw: row,
  };
}

async function planBatchReadinessAction(snapshot: BatchReadinessSnapshot): Promise<BatchReadinessPlan> {
  const apiKey = asString(process.env.OPENAI_API_KEY);
  const model = resolveLlmModel("mission_operator", {
    input: snapshot,
    overrideModel: asString(process.env.OPENAI_MODEL_MISSION_OPERATOR),
  });
  if (!apiKey) {
    return normalizeBatchReadinessPlan({}, "mission-operator-unavailable", {
      toolName: "wait_for_batch_readiness",
      rationale: "OPENAI_API_KEY is missing, so the batch-readiness operator cannot choose whether to dispatch or top up.",
      toolInput: { reason: "OPENAI_API_KEY is missing.", nextCheckMinutes: 30 },
    });
  }

  const prompt = buildBatchReadinessPrompt(snapshot);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      reasoning: { effort: asString(process.env.OPENAI_MISSION_REASONING_EFFORT) || "high" },
      text: {
        format: {
          type: "json_schema",
          name: "mission_batch_readiness_tool_choice",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              toolName: { type: "string", enum: BATCH_READINESS_TOOLS },
              rationale: { type: "string", maxLength: 700 },
              expectedOutcome: { type: "string", maxLength: 500 },
              toolInputJson: { type: "string", maxLength: 1000 },
            },
            required: ["toolName", "rationale", "expectedOutcome", "toolInputJson"],
          },
        },
      },
      max_output_tokens: missionOperatorMaxOutputTokens(),
      store: false,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    return normalizeBatchReadinessPlan({}, model, {
      toolName: "wait_for_batch_readiness",
      rationale: `Mission batch-readiness AI request failed with HTTP ${response.status}.`,
      toolInput: { reason: raw.slice(0, 500), nextCheckMinutes: 30 },
    });
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  try {
    return normalizeBatchReadinessPlan(JSON.parse(extractResponseText(payload)), model, {
      toolName: "wait_for_batch_readiness",
      rationale: "Mission batch-readiness AI did not choose a valid tool.",
      toolInput: { reason: "Invalid tool choice.", nextCheckMinutes: 30 },
    });
  } catch {
    return normalizeBatchReadinessPlan({}, model, {
      toolName: "wait_for_batch_readiness",
      rationale: "Mission batch-readiness AI returned invalid JSON.",
      toolInput: { reason: extractResponseText(payload).slice(0, 500), nextCheckMinutes: 30 },
    });
  }
}

function textLooksDeliverabilityRelated(value: string) {
  return /deliverability|inbox|placement|spam|seed|pre[-_ ]?send|sender|warmup/i.test(value);
}

async function shouldAutopilotProcessMission(mission: Mission) {
  if (mission.status === "failed") {
    const missionText = `${mission.lastError} ${mission.deliverabilityState.primaryBlocker} ${mission.deliverabilityState.summary}`;
    if (textLooksDeliverabilityRelated(missionText)) return true;
    const run = mission.currentRunId ? await getOutreachRun(mission.currentRunId).catch(() => null) : null;
    return Boolean(
      run &&
        !["completed", "canceled"].includes(run.status) &&
        textLooksDeliverabilityRelated(`${run.pauseReason} ${run.lastError}`)
    );
  }
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

async function postponeDispatchJobs(input: {
  jobs: Awaited<ReturnType<typeof listRunJobs>>;
  reason: string;
  minutes?: number;
}) {
  const nextCheckMinutes = Math.max(5, Math.min(240, Math.round(input.minutes ?? 30)));
  const proposedExecuteAfter = addMinutes(nowIso(), nextCheckMinutes);
  const activeDispatchJobs = input.jobs.filter(
    (job) => job.jobType === "dispatch_messages" && ["queued", "running"].includes(job.status)
  );
  const updatedJobs: Array<{ jobId: string; executeAfter: string }> = [];
  for (const job of activeDispatchJobs) {
    const executeAfter =
      dateMs(job.executeAfter) > dateMs(proposedExecuteAfter) ? job.executeAfter : proposedExecuteAfter;
    await updateOutreachJob(job.id, {
      status: "queued",
      executeAfter,
      payload: {
        ...job.payload,
        postponedByBatchReadinessGate: true,
        postponedReason: input.reason,
      },
    });
    updatedJobs.push({ jobId: job.id, executeAfter });
  }
  return { dispatchJobIds: activeDispatchJobs.map((job) => job.id), updatedJobs, nextCheckMinutes };
}

async function ensureBatchReadyForDispatch(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
  runId: string;
  deliverabilityState: Mission["deliverabilityState"];
}): Promise<{ ready: boolean; reason: string; scheduledMessageCount: number; targetLeadCount: number }> {
  const snapshot = await buildBatchReadinessSnapshot(input);
  if (!snapshot) {
    return { ready: false, reason: "Run not found.", scheduledMessageCount: 0, targetLeadCount: 0 };
  }
  const reusableApproval = await findReusableBatchReadinessApproval({
    missionId: input.mission.id,
    snapshot,
  });
  if (reusableApproval) {
    const summary = `Reusing recent AI batch approval from ${reusableApproval.createdAt}.`;
    await createMissionEvent({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      eventType: "batch_dispatch_reused_recent_ai_approval",
      summary,
      payload: {
        approvalEventId: reusableApproval.id,
        approvalEventType: reusableApproval.eventType,
        approvalSummary: reusableApproval.summary,
        scheduledMessageCount: snapshot.batch.scheduledMessageCount,
        targetLeadCount: snapshot.batch.targetLeadCount,
      },
    });
    await createMissionAgentDecision({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      agent: "mission_batch_readiness_operator",
      action: "reuse_recent_batch_approval",
      rationale: summary,
      riskLevel: "guarded_write",
      input: {
        snapshot,
        approvalEvent: {
          id: reusableApproval.id,
          eventType: reusableApproval.eventType,
          summary: reusableApproval.summary,
          createdAt: reusableApproval.createdAt,
          payload: reusableApproval.payload,
        },
      },
      output: {
        ready: true,
        scheduledMessageCount: snapshot.batch.scheduledMessageCount,
        targetLeadCount: snapshot.batch.targetLeadCount,
        recordedAt: nowIso(),
      },
    });
    return {
      ready: true,
      reason: summary,
      scheduledMessageCount: snapshot.batch.scheduledMessageCount,
      targetLeadCount: snapshot.batch.targetLeadCount,
    };
  }
  const plan = await planBatchReadinessAction(snapshot);
  let ok = false;
  let ready = false;
  let summary = plan.rationale;
  let result: Record<string, unknown> = {};
  const jobs = await listRunJobs(input.runId, 50).catch(() => []);

  if (!snapshot.allowedToolNames.includes(plan.toolName)) {
    summary = `AI selected ${plan.toolName}, but current batch guardrails do not allow it.`;
    result = {
      selectedToolName: plan.toolName,
      allowedToolNames: snapshot.allowedToolNames,
    };
  } else if (plan.toolName === "dispatch_prepared_batch" || plan.toolName === "run_smoke_test") {
    ok = true;
    ready = true;
    summary =
      plan.toolName === "run_smoke_test"
        ? asString(plan.toolInput.reason) || plan.rationale
        : plan.rationale || "Batch-readiness operator approved dispatch.";
    result = {
      mode: plan.toolName,
      scheduledMessageCount: snapshot.batch.scheduledMessageCount,
      targetLeadCount: snapshot.batch.targetLeadCount,
      deficitToTarget: snapshot.batch.deficitToTarget,
    };
    await createMissionEvent({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      eventType: plan.toolName === "run_smoke_test" ? "batch_smoke_test_approved" : "batch_dispatch_approved",
      summary,
      payload: result,
    });
  } else if (plan.toolName === "source_more_leads") {
    const requestedTarget = Math.max(
      snapshot.batch.leadCount + 1,
      Math.min(500, Math.round(asNumber(plan.toolInput.targetLeadCount, snapshot.batch.targetLeadCount)))
    );
    const targetLeadCount = Math.max(snapshot.batch.targetLeadCount, requestedTarget);
    const postponed = await postponeDispatchJobs({
      jobs,
      reason: asString(plan.toolInput.reason) || plan.rationale,
      minutes: 30,
    });
    if (snapshot.run.status === "paused") {
      await updateOutreachRun(input.runId, {
        status: "sourcing",
        pauseReason: "",
        lastError: "",
      });
    }
    await enqueueOutreachJob({
      runId: input.runId,
      jobType: "source_leads",
      executeAfter: nowIso(),
      payload: {
        maxLeadsOverride: targetLeadCount,
        deliverabilityProofOnly: true,
        reason: "mission_batch_readiness_top_up",
      },
    });
    ok = true;
    summary = asString(plan.toolInput.reason) || plan.rationale;
    result = {
      targetLeadCount,
      currentLeadCount: snapshot.batch.leadCount,
      scheduledMessageCount: snapshot.batch.scheduledMessageCount,
      deficitToTarget: Math.max(0, targetLeadCount - snapshot.batch.leadCount),
      postponedDispatch: postponed,
    };
    await createMissionEvent({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      eventType: "batch_top_up_requested",
      summary,
      payload: result,
    });
  } else if (plan.toolName === "wait_for_batch_readiness") {
    const nextCheckMinutes = Math.max(5, Math.min(240, Math.round(asNumber(plan.toolInput.nextCheckMinutes, 30))));
    const postponed = await postponeDispatchJobs({
      jobs,
      reason: asString(plan.toolInput.reason) || plan.rationale,
      minutes: nextCheckMinutes,
    });
    ok = true;
    summary = asString(plan.toolInput.reason) || plan.rationale;
    result = {
      nextCheckMinutes,
      postponedDispatch: postponed,
    };
    await createMissionEvent({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      eventType: "batch_readiness_waiting",
      summary,
      payload: result,
    });
  } else {
    const postponed = await postponeDispatchJobs({
      jobs,
      reason: asString(plan.toolInput.reason) || plan.rationale,
      minutes: 60,
    });
    summary = asString(plan.toolInput.reason) || plan.rationale;
    result = {
      desiredAction: asString(plan.toolInput.desiredAction),
      postponedDispatch: postponed,
    };
    await createMissionEvent({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      eventType: "batch_readiness_blocked",
      summary,
      payload: result,
    });
  }

  await createMissionAgentDecision({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    agent: "mission_batch_readiness_operator",
    action: plan.toolName,
    rationale: plan.rationale,
    riskLevel: ready ? "guarded_write" : ok ? "safe_write" : "blocked",
    input: {
      model: plan.model,
      toolName: plan.toolName,
      toolInput: plan.toolInput,
      expectedOutcome: plan.expectedOutcome,
      snapshot,
    },
    output: {
      ok,
      ready,
      summary,
      result,
      recordedAt: nowIso(),
    },
  });

  return {
    ready,
    reason: summary,
    scheduledMessageCount: snapshot.batch.scheduledMessageCount,
    targetLeadCount: snapshot.batch.targetLeadCount,
  };
}

async function queuePreparedRunDispatch(input: {
  mission: Mission;
  runId: string;
  approvedPlan: MissionPlan;
  deliverabilityState: Mission["deliverabilityState"];
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

  const batchReadiness = await ensureBatchReadyForDispatch({
    mission: input.mission,
    approvedPlan: input.approvedPlan,
    runId: run.id,
    deliverabilityState: input.deliverabilityState,
  });
  if (!batchReadiness.ready) {
    return {
      queued: false,
      reason: batchReadiness.reason,
      scheduledMessageCount,
    };
  }

  const jobs = await listRunJobs(run.id, 25).catch(() => []);
  const activeDispatchJob = jobs.find(
    (job) => job.jobType === "dispatch_messages" && ["queued", "running"].includes(job.status)
  );
  if (activeDispatchJob) {
    const activeDispatchPayload = asRecord(activeDispatchJob.payload);
    if (activeDispatchJob.status === "queued" && activeDispatchPayload.postponedByBatchReadinessGate === true) {
      if (run.status === "paused") {
        await updateOutreachRun(run.id, {
          status: "scheduled",
          pauseReason: "",
          lastError: "",
        });
      }
      await updateOutreachJob(activeDispatchJob.id, {
        status: "queued",
        executeAfter: nowIso(),
        payload: {
          ...activeDispatchPayload,
          postponedByBatchReadinessGate: false,
          releasedByBatchReadinessGate: true,
          releasedAt: nowIso(),
        },
      });
      return {
        queued: true,
        reason: "Dispatch was already queued and has been released by batch readiness.",
        scheduledMessageCount,
      };
    }
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
        const dispatch = await queuePreparedRunDispatch({
          mission,
          runId: currentRun.id,
          approvedPlan: input.approvedPlan,
          deliverabilityState: input.deliverabilityState,
        });
        if (dispatch.queued) {
          mission =
            (await updateMission(mission.brandId, mission.id, {
              status: "running",
              lastError: "",
            })) ?? mission;
          return refreshMissionRuntimeSummary(mission);
        }
        return refreshMissionRuntimeSummary(mission);
      } else {
        return refreshMissionRuntimeSummary(mission);
      }
    }
    if (currentRun && currentRun.status === "paused" && input.deliverabilityState.stage === "ready") {
      const dispatch = await queuePreparedRunDispatch({
        mission,
        runId: currentRun.id,
        approvedPlan: input.approvedPlan,
        deliverabilityState: input.deliverabilityState,
      });
      if (dispatch.queued) {
        mission =
          (await updateMission(mission.brandId, mission.id, {
            status: "running",
            lastError: "",
          })) ?? mission;
        return refreshMissionRuntimeSummary(mission);
      }
      return refreshMissionRuntimeSummary(mission);
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
  const missions = await listMissionsByStatuses(["starting", "deliverability_blocked", "paused", "running", "failed"]);
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
