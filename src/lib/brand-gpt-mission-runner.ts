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
  mode: MissionRunnerMode;
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
  summary: string;
  evidenceStatus: string;
  error: string;
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

function getConfig(): BrandGptMissionRunnerConfig {
  const rawMode = asString(process.env.BRAND_GPT_MISSION_RUNNER_MODE).toLowerCase();
  return {
    enabled: envBoolean("BRAND_GPT_MISSION_RUNNER_ENABLED", false),
    limit: envNumber("BRAND_GPT_MISSION_RUNNER_LIMIT", 3, 1, 25),
    cooldownMinutes: envNumber("BRAND_GPT_MISSION_RUNNER_COOLDOWN_MINUTES", 60, 5, 1440),
    mode: rawMode === "default" ? "default" : "recommendation_only",
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
    "You are running without a human prompt. Think like Codex: inspect live account evidence with tools, decide what matters now, and report the next useful move.",
    `Runner mode: ${input.mode}. If a write, send, launch, domain purchase, or other risky action is needed while mode is recommendation_only, propose it precisely with evidence instead of pretending it happened.`,
    "Do not wait for generic instructions. Use your tools when live state is needed. Do not invent replies, lead counts, sender state, or deliverability status.",
    "Prefer a concise final answer that says: what you checked, what you learned, next move, and what remains unproven.",
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
      summary: "",
      evidenceStatus: "",
      error: "",
    };
  }

  const thread = await ensureMissionThread(refreshed);
  const message = buildHeartbeatPrompt({
    mission: refreshed,
    detail,
    brandName,
    mode: input.config.mode,
  });
  const response = await runOperatorChatTurn({
    brandId: refreshed.brandId,
    threadId: thread.id,
    message,
    mode: input.config.mode,
  });
  const evidence = extractEvidence(response);
  const summary = truncateText(response.assistant.summary, 1200);
  const action = response.execution?.toolName || response.actions[0]?.toolName || "autonomous_heartbeat";

  await createMissionAgentDecision({
    missionId: refreshed.id,
    brandId: refreshed.brandId,
    agent: RUNNER_AGENT,
    action,
    rationale: summary,
    riskLevel: riskFromResponse(response),
    input: {
      threadId: response.thread.id,
      mode: input.config.mode,
      prompt: "autonomous mission heartbeat",
    },
    output: {
      runId: response.run.id,
      model: response.run.model,
      runStatus: response.run.status,
      execution: response.execution,
      actions: response.actions,
      assistant: response.assistant,
      evidenceCheck: evidence.check,
      evidenceTrace: evidence.trace,
    },
  });
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
    checked: missions.length,
    ran,
    skipped: rows.filter((row) => row.skipped).length,
    failed: rows.filter((row) => !row.ok).length,
    missions: rows,
    finishedAt: nowIso(),
  };
}
