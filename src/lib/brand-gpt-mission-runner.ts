import { getBrandById } from "@/lib/factory-data";
import {
  createMissionAgentDecision,
  createMissionEvent,
  createMissionLearning,
  getMissionDetail,
  listMissionsByStatuses,
} from "@/lib/mission-data";
import { refreshMissionRuntimeSummary } from "@/lib/mission-learning";
import type { Mission, MissionAgentDecision, MissionDetail, MissionRiskLevel } from "@/lib/mission-types";
import { createOperatorThread, listOperatorThreads } from "@/lib/operator-data";
import { runOperatorChatTurn } from "@/lib/operator-runtime";
import type {
  OperatorChatRequest,
  OperatorChatResponse,
  OperatorEvidenceCheck,
  OperatorEvidenceTraceEntry,
} from "@/lib/operator-types";

type MissionRunnerMode = NonNullable<OperatorChatRequest["mode"]>;

type BrandGptMissionRunnerConfig = {
  enabled: boolean;
  limit: number;
  cooldownMinutes: number;
  maxTurnsPerMission: number;
  maxRuntimeMs: number;
  mode: MissionRunnerMode;
  executionPolicy: NonNullable<OperatorChatRequest["executionPolicy"]>;
  autonomousToolAllowlist: string[];
  brandAllowlist: Set<string>;
  brandDenylist: Set<string>;
  brandNameDenylist: Set<string>;
};

export type BrandGptMissionTickRow = {
  missionId: string;
  brandId: string;
  brandName: string;
  status: Mission["status"];
  ok: boolean;
  skipped: boolean;
  reason: string;
  threadId: string;
  runId: string;
  model: string;
  turns: number;
  actions: string[];
  stopReason: string;
  summary: string;
  evidenceStatus: string;
  error: string;
};

type MissionTurnResult = {
  response: OperatorChatResponse;
  evidence: {
    check: OperatorEvidenceCheck | null;
    trace: OperatorEvidenceTraceEntry[];
  };
  summary: string;
  action: string;
  executionState: string;
  actionStatus: string;
  plannerUnavailable: boolean;
};

const ACTIVE_MISSION_STATUSES: Mission["status"][] = [
  "starting",
  "running",
  "monitoring",
  "learning",
  "deliverability_blocked",
];

const RUNNER_AGENT = "brand_gpt_mission_runner";
const RUNNER_THREAD_PREFIX = "Autonomous Brand GPT mission";
const DEFAULT_DENY_BRAND_NAMES = ["unibari", "unibari labs"];

function nowIso() {
  return new Date().toISOString();
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = asString(value).toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function envBoolean(name: string, fallback = false) {
  return asBoolean(process.env[name], fallback);
}

function envNumber(name: string, fallback: number, min: number, max: number) {
  const parsed = Math.round(Number(process.env[name]));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function envSet(name: string, fallback: string[] = []) {
  const raw = asString(process.env[name]);
  const values = raw ? raw.split(",") : fallback;
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function envList(name: string, fallback: string[] = []) {
  const raw = asString(process.env[name]);
  const values = raw ? raw.split(",") : fallback;
  return values.map((value) => value.trim()).filter(Boolean);
}

function getConfig(): BrandGptMissionRunnerConfig {
  const rawMode = asString(process.env.BRAND_GPT_MISSION_RUNNER_MODE).toLowerCase();
  const rawExecutionPolicy = asString(process.env.BRAND_GPT_MISSION_RUNNER_EXECUTION_POLICY).toLowerCase();
  return {
    enabled: envBoolean("BRAND_GPT_MISSION_RUNNER_ENABLED", false),
    limit: envNumber("BRAND_GPT_MISSION_RUNNER_LIMIT", 3, 1, 25),
    cooldownMinutes: envNumber("BRAND_GPT_MISSION_RUNNER_COOLDOWN_MINUTES", 15, 5, 1440),
    maxTurnsPerMission: envNumber("BRAND_GPT_MISSION_RUNNER_MAX_TURNS_PER_MISSION", 4, 1, 10),
    maxRuntimeMs: envNumber("BRAND_GPT_MISSION_RUNNER_MAX_RUNTIME_MS", 90_000, 15_000, 240_000),
    mode: rawMode === "recommendation_only" ? "recommendation_only" : "default",
    executionPolicy: rawExecutionPolicy === "confirm_required" ? "confirm_required" : "autonomous",
    autonomousToolAllowlist: envList("BRAND_GPT_MISSION_RUNNER_AUTONOMOUS_TOOLS"),
    brandAllowlist: envSet("BRAND_GPT_MISSION_RUNNER_BRAND_IDS"),
    brandDenylist: envSet("BRAND_GPT_MISSION_RUNNER_DENY_BRAND_IDS"),
    brandNameDenylist: envSet("BRAND_GPT_MISSION_RUNNER_DENY_BRAND_NAMES", DEFAULT_DENY_BRAND_NAMES),
  };
}

function ageMinutes(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - timestamp) / 60000);
}

function latestRunnerDecision(detail: MissionDetail): MissionAgentDecision | null {
  return (
    detail.decisions.find((decision) => decision.agent === RUNNER_AGENT) ??
    null
  );
}

function truncateText(value: string, maxLength = 900) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
}

function safeJson(value: unknown, maxLength = 7000) {
  try {
    return truncateText(JSON.stringify(value), maxLength);
  } catch {
    return "";
  }
}

function extractEvidence(response: OperatorChatResponse): {
  check: OperatorEvidenceCheck | null;
  trace: OperatorEvidenceTraceEntry[];
} {
  const content = response.messages[0]?.content ?? {};
  const rawCheck = content.evidenceCheck;
  const rawTrace = content.evidenceTrace;
  const check =
    rawCheck && typeof rawCheck === "object" && !Array.isArray(rawCheck)
      ? (rawCheck as OperatorEvidenceCheck)
      : null;
  const trace = Array.isArray(rawTrace) ? (rawTrace as OperatorEvidenceTraceEntry[]) : [];
  return { check, trace };
}

function riskFromResponse(response: OperatorChatResponse): MissionRiskLevel {
  const risk = response.actions[0]?.riskLevel;
  if (risk === "read" || risk === "safe_write" || risk === "guarded_write" || risk === "blocked") {
    return risk;
  }
  const executionRisk = response.execution?.state === "awaiting_confirmation" ? "guarded_write" : "read";
  return executionRisk;
}

function isPlannerUnavailableResponse(response: OperatorChatResponse, summary: string) {
  return (
    response.run.model === "operator-v1" &&
    summary.toLowerCase().includes("couldn't reach the ai planner")
  );
}

function actionFromResponse(response: OperatorChatResponse) {
  return response.execution?.toolName || response.actions[0]?.toolName || "autonomous_heartbeat";
}

function needsLiveToolSelfCorrection(turn: MissionTurnResult) {
  return (
    turn.action === "autonomous_heartbeat" &&
    turn.evidence.check?.status !== "verified" &&
    turn.executionState !== "need_info" &&
    turn.executionState !== "awaiting_confirmation"
  );
}

function shouldContinueAfterTurn(input: {
  turn: MissionTurnResult;
  turnIndex: number;
  maxTurns: number;
}) {
  if (input.turn.plannerUnavailable) return false;
  if (input.turnIndex + 1 >= input.maxTurns) return false;
  if (!input.turn.action) return false;
  if (needsLiveToolSelfCorrection(input.turn)) return true;
  if (input.turn.action === "autonomous_heartbeat") return false;
  if (input.turn.executionState === "need_info") return false;
  if (input.turn.executionState === "awaiting_confirmation") return false;
  if (input.turn.executionState === "running") return false;
  return Boolean(input.turn.response.actions.length || input.turn.executionState === "failed");
}

async function ensureMissionThread(mission: Mission) {
  const title = `${RUNNER_THREAD_PREFIX} ${mission.id}`;
  const existing = (await listOperatorThreads({
    brandId: mission.brandId,
    status: "active",
  })).find((thread) => thread.title === title);
  if (existing) return existing;
  return createOperatorThread({
    brandId: mission.brandId,
    title,
    lastSummary: "Brand GPT autonomous mission runner is ready.",
  });
}

function buildHeartbeatPrompt(input: {
  mission: Mission;
  detail: MissionDetail;
  brandName: string;
  mode: MissionRunnerMode;
  executionPolicy: NonNullable<OperatorChatRequest["executionPolicy"]>;
}) {
  const recentEvents = input.detail.events.slice(0, 8).map((event) => ({
    type: event.eventType,
    summary: event.summary,
    createdAt: event.createdAt,
  }));
  const recentLearnings = input.detail.learnings.slice(0, 6).map((learning) => ({
    type: learning.learningType,
    summary: learning.summary,
    confidence: learning.confidence,
    recommendedAction: learning.recommendedAction,
    createdAt: learning.createdAt,
  }));
  const recentDecisions = input.detail.decisions.slice(0, 6).map((decision) => ({
    agent: decision.agent,
    action: decision.action,
    rationale: decision.rationale,
    riskLevel: decision.riskLevel,
    createdAt: decision.createdAt,
  }));

  return [
    `Autonomous Brand GPT mission heartbeat for ${input.brandName || input.mission.brandId}.`,
    "You are running without a human prompt. Think like Codex: build a live world model, choose tools, observe results, and keep moving until the mission advances or a real blocker is proven.",
    "You are not following a fixed campaign script. The goal is to create qualified B2B conversations safely. Decide the next action from live evidence, the tool catalog, prior attempts, cost/risk boundaries, and the mission objective.",
    "Do not stop at advice when an allowed tool can inspect, repair, test, launch, pause, retry, source, enrich, or route around the blocker.",
    "When an action fails, treat the failure as an observation. Try a materially different available path, inspect the cause, or record the missing platform capability with record_capability_gap.",
    `Runner mode: ${input.mode}. If a write, send, launch, domain purchase, or other risky action is needed while mode is recommendation_only, propose it precisely with evidence instead of pretending it happened.`,
    `Execution policy: ${input.executionPolicy}. If this is autonomous, the host may auto-approve allowed guarded tools and will still enforce tenant credentials, budgets, unsubscribe/compliance, provider limits, and audit logging.`,
    "Do not wait for generic instructions. Use your tools when live state is needed. Do not invent replies, lead counts, sender state, or deliverability status.",
    "Prefer a concise final answer that says: what changed, what you tried, what is blocked, and what you will try next if another tick runs.",
    `Mission JSON: ${safeJson({
      id: input.mission.id,
      status: input.mission.status,
      websiteUrl: input.mission.websiteUrl,
      targetCustomerText: input.mission.targetCustomerText,
      approvedPlan: input.mission.approvedPlan,
      generatedPlan: input.mission.generatedPlan,
      deliverabilityState: input.mission.deliverabilityState,
      metricsSummary: input.mission.metricsSummary,
      currentExperimentId: input.mission.currentExperimentId,
      currentRuntimeCampaignId: input.mission.currentRuntimeCampaignId,
      currentRuntimeExperimentId: input.mission.currentRuntimeExperimentId,
      currentRunId: input.mission.currentRunId,
      lastError: input.mission.lastError,
    })}`,
    `Recent mission events JSON: ${safeJson(recentEvents, 3500)}`,
    `Recent mission learnings JSON: ${safeJson(recentLearnings, 3500)}`,
    `Recent agent decisions JSON: ${safeJson(recentDecisions, 3500)}`,
  ].join("\n\n");
}

function buildContinuationPrompt(input: {
  mission: Mission;
  brandName: string;
  previousTurn: MissionTurnResult;
  turnNumber: number;
  maxTurns: number;
}) {
  return [
    `Continue autonomous Brand GPT mission execution for ${input.brandName || input.mission.brandId}.`,
    `This is turn ${input.turnNumber} of ${input.maxTurns}. The previous turn already ran or attempted a tool. Do not wait for the human if a useful next tool is available.`,
    ...(needsLiveToolSelfCorrection(input.previousTurn)
      ? [
          "The previous turn answered without verified live-tool evidence. For an autonomous mission tick, that is not enough. Choose and run the most relevant available tool now, or stop only if no available tool can improve the answer.",
        ]
      : []),
    "Read the previous result as your observation. Decide the next useful action from live state: inspect deeper, fix the blocker, try a viable alternate route, launch a safe limited step, pause a risky route, or record a missing platform capability.",
    "Do not repeat the same failed action unless the previous result gives new evidence that it can now work. Do not ask the user to choose from internal options when you can inspect the account state yourself.",
    "Stop only when the remaining blocker is truly external, needs private human credentials, needs spend approval beyond policy, or no existing tool can do the needed job. If no existing tool can do it, call record_capability_gap instead of giving a generic status answer.",
    `Previous action JSON: ${safeJson({
      action: input.previousTurn.action,
      actionStatus: input.previousTurn.actionStatus,
      executionState: input.previousTurn.executionState,
      assistantSummary: input.previousTurn.summary,
      execution: input.previousTurn.response.execution,
      actions: input.previousTurn.response.actions,
      evidenceCheck: input.previousTurn.evidence.check,
      evidenceTrace: input.previousTurn.evidence.trace,
      runId: input.previousTurn.response.run.id,
      model: input.previousTurn.response.run.model,
    })}`,
  ].join("\n\n");
}

async function shouldSkipMission(input: {
  mission: Mission;
  detail: MissionDetail;
  brandName: string;
  config: BrandGptMissionRunnerConfig;
}): Promise<string> {
  if (!ACTIVE_MISSION_STATUSES.includes(input.mission.status)) return "mission_not_active";
  const brandId = input.mission.brandId.toLowerCase();
  const brandName = input.brandName.trim().toLowerCase();
  if (input.config.brandAllowlist.size && !input.config.brandAllowlist.has(brandId)) {
    return "brand_not_allowlisted";
  }
  if (input.config.brandDenylist.has(brandId)) return "brand_denied";
  if (brandName && input.config.brandNameDenylist.has(brandName)) return "brand_name_denied";
  const lastDecision = latestRunnerDecision(input.detail);
  if (lastDecision && ageMinutes(lastDecision.createdAt) < input.config.cooldownMinutes) {
    return "cooldown";
  }
  return "";
}

async function runMission(input: {
  mission: Mission;
  config: BrandGptMissionRunnerConfig;
}): Promise<BrandGptMissionTickRow> {
  const refreshed = await refreshMissionRuntimeSummary(input.mission).catch(() => input.mission);
  const detail = await getMissionDetail(refreshed.brandId, refreshed.id);
  if (!detail) {
    return {
      missionId: refreshed.id,
      brandId: refreshed.brandId,
      brandName: "",
      status: refreshed.status,
      ok: false,
      skipped: true,
      reason: "mission_detail_missing",
      threadId: "",
      runId: "",
      model: "",
      turns: 0,
      actions: [],
      stopReason: "mission_detail_missing",
      summary: "",
      evidenceStatus: "",
      error: "Mission detail could not be loaded.",
    };
  }

  const brand = await getBrandById(refreshed.brandId).catch(() => null);
  const brandName = brand?.name ?? "";
  const skipReason = await shouldSkipMission({
    mission: refreshed,
    detail,
    brandName,
    config: input.config,
  });
  if (skipReason) {
    return {
      missionId: refreshed.id,
      brandId: refreshed.brandId,
      brandName,
      status: refreshed.status,
      ok: true,
      skipped: true,
      reason: skipReason,
      threadId: "",
      runId: "",
      model: "",
      turns: 0,
      actions: [],
      stopReason: skipReason,
      summary: "",
      evidenceStatus: "",
      error: "",
    };
  }

  const thread = await ensureMissionThread(refreshed);
  let message = buildHeartbeatPrompt({
    mission: refreshed,
    detail,
    brandName,
    mode: input.config.mode,
    executionPolicy: input.config.executionPolicy,
  });
  const turns: MissionTurnResult[] = [];
  const missionStartedAt = Date.now();
  let stopReason = "";

  for (let turnIndex = 0; turnIndex < input.config.maxTurnsPerMission; turnIndex += 1) {
    if (Date.now() - missionStartedAt >= input.config.maxRuntimeMs) {
      stopReason = "runtime_budget_exhausted";
      break;
    }

    const response = await runOperatorChatTurn({
      brandId: refreshed.brandId,
      threadId: thread.id,
      message,
      mode: input.config.mode,
      executionPolicy: input.config.executionPolicy,
      autonomousToolAllowlist: input.config.autonomousToolAllowlist,
      disableLocalHeuristics: true,
    });
    const evidence = extractEvidence(response);
    const summary = truncateText(response.assistant.summary, 1200);
    const turn: MissionTurnResult = {
      response,
      evidence,
      summary,
      action: actionFromResponse(response),
      executionState: response.execution?.state ?? "",
      actionStatus: response.actions[0]?.status ?? "",
      plannerUnavailable: isPlannerUnavailableResponse(response, summary),
    };
    turns.push(turn);

    if (Date.now() - missionStartedAt >= input.config.maxRuntimeMs) {
      stopReason = "runtime_budget_exhausted";
      break;
    }

    if (
      !shouldContinueAfterTurn({
        turn,
        turnIndex,
        maxTurns: input.config.maxTurnsPerMission,
      })
    ) {
      stopReason = turn.plannerUnavailable ? "planner_unavailable" : "no_followup_tool_needed";
      break;
    }

    if (input.config.maxRuntimeMs - (Date.now() - missionStartedAt) < 20_000) {
      stopReason = "runtime_budget_low";
      break;
    }

    message = buildContinuationPrompt({
      mission: refreshed,
      brandName,
      previousTurn: turn,
      turnNumber: turnIndex + 2,
      maxTurns: input.config.maxTurnsPerMission,
    });
  }
  if (!stopReason && turns.length >= input.config.maxTurnsPerMission) {
    stopReason = "max_turns_reached";
  }

  const finalTurn = turns[turns.length - 1];
  if (!finalTurn) {
    throw new Error("Brand GPT mission runner did not produce a turn.");
  }
  const response = finalTurn.response;
  const evidence = finalTurn.evidence;
  const summary = finalTurn.summary;
  const plannerUnavailable = finalTurn.plannerUnavailable;
  const action = finalTurn.action;
  const actions = turns.map((turn) => turn.action);

  if (plannerUnavailable) {
    await createMissionAgentDecision({
      missionId: refreshed.id,
      brandId: refreshed.brandId,
      agent: RUNNER_AGENT,
      action: "planner_unavailable",
      rationale: "Brand GPT could not reach the planner during this autonomous heartbeat.",
      riskLevel: "read",
      input: {
        threadId: response.thread.id,
        mode: input.config.mode,
        executionPolicy: input.config.executionPolicy,
        maxTurnsPerMission: input.config.maxTurnsPerMission,
        maxRuntimeMs: input.config.maxRuntimeMs,
        turns: turns.length,
        actions,
        prompt: "autonomous mission heartbeat",
      },
      output: {
        runId: response.run.id,
        model: response.run.model,
        runStatus: response.run.status,
        assistant: response.assistant,
        execution: response.execution,
      },
    });
    await createMissionEvent({
      missionId: refreshed.id,
      brandId: refreshed.brandId,
      eventType: "brand_gpt_planner_unavailable",
      summary,
      payload: {
        threadId: response.thread.id,
        runId: response.run.id,
        model: response.run.model,
        stopReason,
        turns: turns.length,
        actions,
      },
    });
    return {
      missionId: refreshed.id,
      brandId: refreshed.brandId,
      brandName,
      status: refreshed.status,
      ok: false,
      skipped: false,
      reason: "planner_unavailable",
      threadId: response.thread.id,
      runId: response.run.id,
      model: response.run.model,
      turns: turns.length,
      actions,
      stopReason,
      summary,
      evidenceStatus: "",
      error: "Brand GPT planner was unavailable for this mission tick.",
    };
  }

  for (const [index, turn] of turns.entries()) {
    await createMissionAgentDecision({
      missionId: refreshed.id,
      brandId: refreshed.brandId,
      agent: RUNNER_AGENT,
      action: index === turns.length - 1 ? turn.action : `continued:${turn.action}`,
      rationale: turn.summary,
      riskLevel: riskFromResponse(turn.response),
      input: {
        threadId: turn.response.thread.id,
        mode: input.config.mode,
        executionPolicy: input.config.executionPolicy,
        autonomousToolAllowlist: input.config.autonomousToolAllowlist,
        prompt: index === 0 ? "autonomous mission heartbeat" : "autonomous mission continuation",
        turn: index + 1,
        maxTurnsPerMission: input.config.maxTurnsPerMission,
        maxRuntimeMs: input.config.maxRuntimeMs,
        actions,
      },
      output: {
        runId: turn.response.run.id,
        model: turn.response.run.model,
        runStatus: turn.response.run.status,
        execution: turn.response.execution,
        actions: turn.response.actions,
        assistant: turn.response.assistant,
        evidenceCheck: turn.evidence.check,
        evidenceTrace: turn.evidence.trace,
      },
    });
  }
  await createMissionEvent({
    missionId: refreshed.id,
    brandId: refreshed.brandId,
    eventType: "brand_gpt_autonomous_tick",
    summary,
    payload: {
      threadId: response.thread.id,
      runId: response.run.id,
      model: response.run.model,
      evidenceCheck: evidence.check,
      action,
      actions,
      turns: turns.length,
      stopReason,
    },
  });
  if (summary) {
    await createMissionLearning({
      missionId: refreshed.id,
      brandId: refreshed.brandId,
      learningType: "brand_gpt_autonomous_observation",
      summary,
      confidence:
        evidence.check?.status === "verified"
          ? 0.8
          : evidence.check?.status === "inconclusive"
            ? 0.55
            : 0.35,
      evidence: {
        threadId: response.thread.id,
        runId: response.run.id,
        actions,
        turns: turns.length,
        stopReason,
        evidenceCheck: evidence.check,
        evidenceTrace: evidence.trace,
      },
      recommendedAction: action,
    });
  }

  return {
    missionId: refreshed.id,
    brandId: refreshed.brandId,
    brandName,
    status: refreshed.status,
    ok: true,
    skipped: false,
    reason: "",
    threadId: response.thread.id,
    runId: response.run.id,
    model: response.run.model,
    turns: turns.length,
    actions,
    stopReason,
    summary,
    evidenceStatus: evidence.check?.status ?? "",
    error: "",
  };
}

export async function runBrandGptMissionTick() {
  const config = getConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      mode: config.mode,
      executionPolicy: config.executionPolicy,
      maxTurnsPerMission: config.maxTurnsPerMission,
      maxRuntimeMs: config.maxRuntimeMs,
      checked: 0,
      ran: 0,
      skipped: 0,
      failed: 0,
      missions: [] as BrandGptMissionTickRow[],
    };
  }

  const missions = await listMissionsByStatuses(ACTIVE_MISSION_STATUSES);
  const rows: BrandGptMissionTickRow[] = [];
  let ran = 0;

  for (const mission of missions) {
    if (ran >= config.limit) break;
    try {
      const row = await runMission({ mission, config });
      rows.push(row);
      if (!row.skipped) ran += 1;
    } catch (error) {
      rows.push({
        missionId: mission.id,
        brandId: mission.brandId,
        brandName: "",
        status: mission.status,
        ok: false,
        skipped: false,
        reason: "",
        threadId: "",
        runId: "",
        model: "",
        turns: 0,
        actions: [],
        stopReason: "exception",
        summary: "",
        evidenceStatus: "",
        error: error instanceof Error ? error.message : "Brand GPT mission runner failed.",
      });
      ran += 1;
    }
  }

  return {
    enabled: true,
    mode: config.mode,
    executionPolicy: config.executionPolicy,
    maxTurnsPerMission: config.maxTurnsPerMission,
    maxRuntimeMs: config.maxRuntimeMs,
    checked: missions.length,
    ran,
    skipped: rows.filter((row) => row.skipped).length,
    failed: rows.filter((row) => !row.ok).length,
    missions: rows,
    finishedAt: nowIso(),
  };
}
