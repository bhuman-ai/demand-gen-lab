import { mkdir, readFile, writeFile } from "fs/promises";
import { createId } from "@/lib/factory-data";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  Mission,
  MissionAgentDecision,
  MissionApprovalPolicy,
  MissionDeliverabilityState,
  MissionDetail,
  MissionEvent,
  MissionLearning,
  MissionMetricsSummary,
  MissionPlan,
  MissionRiskLevel,
  MissionStatus,
} from "@/lib/mission-types";

const TABLE_MISSION = "demanddev_missions";
const TABLE_EVENT = "demanddev_mission_events";
const TABLE_DECISION = "demanddev_mission_agent_decisions";
const TABLE_LEARNING = "demanddev_mission_learnings";

type MissionStore = {
  missions: Mission[];
  events: MissionEvent[];
  decisions: MissionAgentDecision[];
  learnings: MissionLearning[];
};

const PLAN_DEFAULT: MissionPlan = {
  offerSummary: "",
  targetCustomers: [],
  avoidList: [],
  outreachAngle: "",
  firstBatchSize: 25,
  primaryRisk: "",
  successCriteria: "",
  sampleMessage: "",
  deliverabilityPlan: {
    summary: "",
    inboxStrategy: "",
    domainStrategy: "",
    warmupStrategy: "",
    inboxPlacementTest: "",
    dailyRamp: "",
    autoProvisioning: true,
  },
  learningPlan: {
    summary: "",
    signalsToWatch: [],
    automaticChanges: [],
    approvalRequiredFor: [],
  },
};

const APPROVAL_DEFAULT: MissionApprovalPolicy = {
  planApprovedAt: "",
  firstBatchLimit: 25,
  allowAutoScale: false,
  allowAutoProvisioning: false,
  allowAutoDomainPurchase: false,
  maxAutoProvisionedSenders: 1,
  maxAutoDomainSpendUsd: 40,
  requireApprovalForNewAudience: true,
  requireApprovalForNewClaim: true,
  requireApprovalForNewDomainPurchase: true,
};

const DELIVERABILITY_DEFAULT: MissionDeliverabilityState = {
  stage: "not_checked",
  summary: "Deliverability has not been checked yet.",
  primaryBlocker: "",
  senderCount: 0,
  readySenderCount: 0,
  warmingSenderCount: 0,
  lastCheckedAt: "",
};

const METRICS_DEFAULT: MissionMetricsSummary = {
  sent: 0,
  scheduled: 0,
  replies: 0,
  positiveReplies: 0,
  bounced: 0,
  failed: 0,
};

function nowIso() {
  return new Date().toISOString();
}

function isDeployedRuntime() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

function missionStorePath() {
  return isDeployedRuntime() ? "/tmp/factory_missions.v1.json" : `${process.cwd()}/data/missions.v1.json`;
}

function errorMessage(error: unknown) {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error);
}

function assertLocalMissionStoreAllowed(operation: string, error?: unknown) {
  if (!isDeployedRuntime()) return;
  const detail = errorMessage(error);
  throw new Error(
    `Mission ${operation} requires Supabase storage in deployed runtime.` +
      (detail ? ` Supabase error: ${detail}` : " Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asString(entry)).filter(Boolean);
}

function normalizeStatus(value: unknown): MissionStatus {
  const normalized = asString(value);
  return [
    "draft",
    "site_analyzing",
    "plan_ready",
    "starting",
    "running",
    "monitoring",
    "learning",
    "deliverability_blocked",
    "paused",
    "completed",
    "failed",
  ].includes(normalized)
    ? (normalized as MissionStatus)
    : "draft";
}

function normalizeRisk(value: unknown): MissionRiskLevel {
  const normalized = asString(value);
  return ["read", "safe_write", "guarded_write", "blocked"].includes(normalized)
    ? (normalized as MissionRiskLevel)
    : "safe_write";
}

function normalizePlan(value: unknown): MissionPlan {
  const row = asRecord(value);
  const deliverabilityPlan = asRecord(row.deliverabilityPlan ?? row.deliverability_plan);
  const learningPlan = asRecord(row.learningPlan ?? row.learning_plan);
  return {
    ...PLAN_DEFAULT,
    offerSummary: asString(row.offerSummary ?? row.offer_summary),
    targetCustomers: asStringArray(row.targetCustomers ?? row.target_customers),
    avoidList: asStringArray(row.avoidList ?? row.avoid_list),
    outreachAngle: asString(row.outreachAngle ?? row.outreach_angle),
    firstBatchSize: Math.max(1, Math.min(100, Math.round(asNumber(row.firstBatchSize ?? row.first_batch_size, 25)))),
    primaryRisk: asString(row.primaryRisk ?? row.primary_risk),
    successCriteria: asString(row.successCriteria ?? row.success_criteria),
    sampleMessage: asString(row.sampleMessage ?? row.sample_message),
    deliverabilityPlan: {
      ...PLAN_DEFAULT.deliverabilityPlan,
      summary: asString(deliverabilityPlan.summary),
      inboxStrategy: asString(deliverabilityPlan.inboxStrategy ?? deliverabilityPlan.inbox_strategy),
      domainStrategy: asString(deliverabilityPlan.domainStrategy ?? deliverabilityPlan.domain_strategy),
      warmupStrategy: asString(deliverabilityPlan.warmupStrategy ?? deliverabilityPlan.warmup_strategy),
      inboxPlacementTest: asString(deliverabilityPlan.inboxPlacementTest ?? deliverabilityPlan.inbox_placement_test),
      dailyRamp: asString(deliverabilityPlan.dailyRamp ?? deliverabilityPlan.daily_ramp),
      autoProvisioning: deliverabilityPlan.autoProvisioning !== false,
    },
    learningPlan: {
      ...PLAN_DEFAULT.learningPlan,
      summary: asString(learningPlan.summary),
      signalsToWatch: asStringArray(learningPlan.signalsToWatch ?? learningPlan.signals_to_watch),
      automaticChanges: asStringArray(learningPlan.automaticChanges ?? learningPlan.automatic_changes),
      approvalRequiredFor: asStringArray(learningPlan.approvalRequiredFor ?? learningPlan.approval_required_for),
    },
  };
}

function normalizeApproval(value: unknown): MissionApprovalPolicy {
  const row = asRecord(value);
  return {
    ...APPROVAL_DEFAULT,
    planApprovedAt: asString(row.planApprovedAt ?? row.plan_approved_at),
    firstBatchLimit: Math.max(1, Math.min(100, Math.round(asNumber(row.firstBatchLimit ?? row.first_batch_limit, 25)))),
    allowAutoScale: row.allowAutoScale === true || row.allow_auto_scale === true,
    allowAutoProvisioning: row.allowAutoProvisioning === true || row.allow_auto_provisioning === true,
    allowAutoDomainPurchase: row.allowAutoDomainPurchase === true || row.allow_auto_domain_purchase === true,
    maxAutoProvisionedSenders: Math.max(
      0,
      Math.min(
        10,
        Math.round(asNumber(row.maxAutoProvisionedSenders ?? row.max_auto_provisioned_senders, 1))
      )
    ),
    maxAutoDomainSpendUsd: Math.max(
      0,
      Math.min(500, asNumber(row.maxAutoDomainSpendUsd ?? row.max_auto_domain_spend_usd, 40))
    ),
    requireApprovalForNewAudience: row.requireApprovalForNewAudience !== false && row.require_approval_for_new_audience !== false,
    requireApprovalForNewClaim: row.requireApprovalForNewClaim !== false && row.require_approval_for_new_claim !== false,
    requireApprovalForNewDomainPurchase:
      row.requireApprovalForNewDomainPurchase !== false && row.require_approval_for_new_domain_purchase !== false,
  };
}

function normalizeDeliverability(value: unknown): MissionDeliverabilityState {
  const row = asRecord(value);
  const stageRaw = asString(row.stage);
  const stage = [
    "not_checked",
    "preparing_inboxes",
    "warming_domains",
    "testing_inbox_placement",
    "ready",
    "needs_attention",
  ].includes(stageRaw)
    ? (stageRaw as MissionDeliverabilityState["stage"])
    : "not_checked";
  return {
    ...DELIVERABILITY_DEFAULT,
    stage,
    summary: asString(row.summary) || DELIVERABILITY_DEFAULT.summary,
    primaryBlocker: asString(row.primaryBlocker ?? row.primary_blocker),
    senderCount: Math.max(0, Math.round(asNumber(row.senderCount ?? row.sender_count, 0))),
    readySenderCount: Math.max(0, Math.round(asNumber(row.readySenderCount ?? row.ready_sender_count, 0))),
    warmingSenderCount: Math.max(0, Math.round(asNumber(row.warmingSenderCount ?? row.warming_sender_count, 0))),
    lastCheckedAt: asString(row.lastCheckedAt ?? row.last_checked_at),
  };
}

function normalizeMetrics(value: unknown): MissionMetricsSummary {
  const row = asRecord(value);
  return {
    sent: Math.max(0, Math.round(asNumber(row.sent, 0))),
    scheduled: Math.max(0, Math.round(asNumber(row.scheduled, 0))),
    replies: Math.max(0, Math.round(asNumber(row.replies, 0))),
    positiveReplies: Math.max(0, Math.round(asNumber(row.positiveReplies ?? row.positive_replies, 0))),
    bounced: Math.max(0, Math.round(asNumber(row.bounced, 0))),
    failed: Math.max(0, Math.round(asNumber(row.failed, 0))),
  };
}

function mapMissionRow(input: unknown): Mission {
  const row = asRecord(input);
  return {
    id: asString(row.id),
    brandId: asString(row.brand_id ?? row.brandId),
    status: normalizeStatus(row.status),
    websiteUrl: asString(row.website_url ?? row.websiteUrl),
    targetCustomerText: asString(row.target_customer_text ?? row.targetCustomerText),
    generatedPlan: normalizePlan(row.generated_plan ?? row.generatedPlan),
    approvedPlan: normalizePlan(row.approved_plan ?? row.approvedPlan),
    approvalPolicy: normalizeApproval(row.approval_policy ?? row.approvalPolicy),
    deliverabilityState: normalizeDeliverability(row.deliverability_state ?? row.deliverabilityState),
    metricsSummary: normalizeMetrics(row.metrics_summary ?? row.metricsSummary),
    currentExperimentId: asString(row.current_experiment_id ?? row.currentExperimentId),
    currentRuntimeCampaignId: asString(row.current_runtime_campaign_id ?? row.currentRuntimeCampaignId),
    currentRuntimeExperimentId: asString(row.current_runtime_experiment_id ?? row.currentRuntimeExperimentId),
    currentRunId: asString(row.current_run_id ?? row.currentRunId),
    lastError: asString(row.last_error ?? row.lastError),
    createdAt: asString(row.created_at ?? row.createdAt) || nowIso(),
    updatedAt: asString(row.updated_at ?? row.updatedAt) || nowIso(),
  };
}

function mapEventRow(input: unknown): MissionEvent {
  const row = asRecord(input);
  return {
    id: asString(row.id),
    missionId: asString(row.mission_id ?? row.missionId),
    brandId: asString(row.brand_id ?? row.brandId),
    eventType: asString(row.event_type ?? row.eventType),
    summary: asString(row.summary),
    payload: asRecord(row.payload),
    createdAt: asString(row.created_at ?? row.createdAt) || nowIso(),
  };
}

function mapDecisionRow(input: unknown): MissionAgentDecision {
  const row = asRecord(input);
  return {
    id: asString(row.id),
    missionId: asString(row.mission_id ?? row.missionId),
    brandId: asString(row.brand_id ?? row.brandId),
    agent: asString(row.agent),
    action: asString(row.action),
    rationale: asString(row.rationale),
    riskLevel: normalizeRisk(row.risk_level ?? row.riskLevel),
    input: asRecord(row.input),
    output: asRecord(row.output),
    createdAt: asString(row.created_at ?? row.createdAt) || nowIso(),
  };
}

function mapLearningRow(input: unknown): MissionLearning {
  const row = asRecord(input);
  return {
    id: asString(row.id),
    missionId: asString(row.mission_id ?? row.missionId),
    brandId: asString(row.brand_id ?? row.brandId),
    learningType: asString(row.learning_type ?? row.learningType),
    summary: asString(row.summary),
    confidence: Math.max(0, Math.min(1, asNumber(row.confidence, 0.5))),
    evidence: asRecord(row.evidence),
    recommendedAction: asString(row.recommended_action ?? row.recommendedAction),
    appliedAt: asString(row.applied_at ?? row.appliedAt),
    createdAt: asString(row.created_at ?? row.createdAt) || nowIso(),
  };
}

function missionToDb(row: Mission) {
  return {
    id: row.id,
    brand_id: row.brandId,
    status: row.status,
    website_url: row.websiteUrl,
    target_customer_text: row.targetCustomerText,
    generated_plan: row.generatedPlan,
    approved_plan: row.approvedPlan,
    approval_policy: row.approvalPolicy,
    deliverability_state: row.deliverabilityState,
    metrics_summary: row.metricsSummary,
    current_experiment_id: row.currentExperimentId,
    current_runtime_campaign_id: row.currentRuntimeCampaignId,
    current_runtime_experiment_id: row.currentRuntimeExperimentId,
    current_run_id: row.currentRunId,
    last_error: row.lastError,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function readLocalStore(): Promise<MissionStore> {
  try {
    const raw = await readFile(missionStorePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<MissionStore>;
    return {
      missions: Array.isArray(parsed.missions) ? parsed.missions.map(mapMissionRow) : [],
      events: Array.isArray(parsed.events) ? parsed.events.map(mapEventRow) : [],
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(mapDecisionRow) : [],
      learnings: Array.isArray(parsed.learnings) ? parsed.learnings.map(mapLearningRow) : [],
    };
  } catch {
    return { missions: [], events: [], decisions: [], learnings: [] };
  }
}

async function writeLocalStore(store: MissionStore) {
  const storePath = missionStorePath();
  await mkdir(storePath.replace(/\/[^/]+$/, ""), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function emptyMissionPlan(): MissionPlan {
  return normalizePlan({});
}

export function defaultMissionApprovalPolicy(firstBatchLimit = 25): MissionApprovalPolicy {
  return {
    ...APPROVAL_DEFAULT,
    firstBatchLimit: Math.max(1, Math.min(100, Math.round(firstBatchLimit))),
  };
}

export function defaultMissionDeliverabilityState(): MissionDeliverabilityState {
  return { ...DELIVERABILITY_DEFAULT };
}

export function defaultMissionMetricsSummary(): MissionMetricsSummary {
  return { ...METRICS_DEFAULT };
}

export async function createMission(input: {
  brandId: string;
  websiteUrl: string;
  targetCustomerText: string;
  generatedPlan?: MissionPlan;
  status?: MissionStatus;
}) {
  const now = nowIso();
  const generatedPlan = normalizePlan(input.generatedPlan ?? {});
  const mission: Mission = {
    id: createId("mission"),
    brandId: input.brandId,
    status: input.status ?? "draft",
    websiteUrl: input.websiteUrl.trim(),
    targetCustomerText: input.targetCustomerText.trim(),
    generatedPlan,
    approvedPlan: normalizePlan({}),
    approvalPolicy: defaultMissionApprovalPolicy(generatedPlan.firstBatchSize),
    deliverabilityState: defaultMissionDeliverabilityState(),
    metricsSummary: defaultMissionMetricsSummary(),
    currentExperimentId: "",
    currentRuntimeCampaignId: "",
    currentRuntimeExperimentId: "",
    currentRunId: "",
    lastError: "",
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  let supabaseError: unknown = null;
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MISSION)
      .insert(missionToDb(mission))
      .select("*")
      .single();
    if (!error && data) return mapMissionRow(data);
    supabaseError = error;
  }

  assertLocalMissionStoreAllowed("create", supabaseError);
  const store = await readLocalStore();
  store.missions.unshift(mission);
  await writeLocalStore(store);
  return mission;
}

export async function listMissions(brandId: string): Promise<Mission[]> {
  const supabase = getSupabaseAdmin();
  let supabaseError: unknown = null;
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MISSION)
      .select("*")
      .eq("brand_id", brandId)
      .order("updated_at", { ascending: false });
    if (!error) return (data ?? []).map((row: unknown) => mapMissionRow(row));
    supabaseError = error;
  }

  assertLocalMissionStoreAllowed("list", supabaseError);
  const store = await readLocalStore();
  return store.missions
    .filter((mission) => mission.brandId === brandId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function listMissionsByStatuses(statuses: MissionStatus[]): Promise<Mission[]> {
  const normalized = Array.from(new Set(statuses.map((status) => normalizeStatus(status))));
  if (!normalized.length) return [];
  const supabase = getSupabaseAdmin();
  let supabaseError: unknown = null;
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MISSION)
      .select("*")
      .in("status", normalized)
      .order("updated_at", { ascending: false });
    if (!error) return (data ?? []).map((row: unknown) => mapMissionRow(row));
    supabaseError = error;
  }

  assertLocalMissionStoreAllowed("list by status", supabaseError);
  const store = await readLocalStore();
  return store.missions
    .filter((mission) => normalized.includes(mission.status))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getMission(brandId: string, missionId: string): Promise<Mission | null> {
  const supabase = getSupabaseAdmin();
  let supabaseError: unknown = null;
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MISSION)
      .select("*")
      .eq("brand_id", brandId)
      .eq("id", missionId)
      .maybeSingle();
    if (!error && data) return mapMissionRow(data);
    if (!error) return null;
    supabaseError = error;
  }

  assertLocalMissionStoreAllowed("load", supabaseError);
  const store = await readLocalStore();
  return store.missions.find((mission) => mission.brandId === brandId && mission.id === missionId) ?? null;
}

export async function updateMission(
  brandId: string,
  missionId: string,
  patch: Partial<
    Pick<
      Mission,
      | "status"
      | "websiteUrl"
      | "targetCustomerText"
      | "generatedPlan"
      | "approvedPlan"
      | "approvalPolicy"
      | "deliverabilityState"
      | "metricsSummary"
      | "currentExperimentId"
      | "currentRuntimeCampaignId"
      | "currentRuntimeExperimentId"
      | "currentRunId"
      | "lastError"
    >
  >
): Promise<Mission | null> {
  const existing = await getMission(brandId, missionId);
  if (!existing) return null;
  const next: Mission = {
    ...existing,
    ...patch,
    generatedPlan: patch.generatedPlan ? normalizePlan(patch.generatedPlan) : existing.generatedPlan,
    approvedPlan: patch.approvedPlan ? normalizePlan(patch.approvedPlan) : existing.approvedPlan,
    approvalPolicy: patch.approvalPolicy ? normalizeApproval(patch.approvalPolicy) : existing.approvalPolicy,
    deliverabilityState: patch.deliverabilityState
      ? normalizeDeliverability(patch.deliverabilityState)
      : existing.deliverabilityState,
    metricsSummary: patch.metricsSummary ? normalizeMetrics(patch.metricsSummary) : existing.metricsSummary,
    updatedAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  let supabaseError: unknown = null;
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MISSION)
      .update(missionToDb(next))
      .eq("brand_id", brandId)
      .eq("id", missionId)
      .select("*")
      .maybeSingle();
    if (!error && data) return mapMissionRow(data);
    if (!error) return null;
    supabaseError = error;
  }

  assertLocalMissionStoreAllowed("update", supabaseError);
  const store = await readLocalStore();
  const index = store.missions.findIndex((mission) => mission.brandId === brandId && mission.id === missionId);
  if (index < 0) return null;
  store.missions[index] = next;
  await writeLocalStore(store);
  return next;
}

export async function createMissionEvent(input: {
  missionId: string;
  brandId: string;
  eventType: string;
  summary: string;
  payload?: Record<string, unknown>;
}) {
  const event: MissionEvent = {
    id: createId("misevt"),
    missionId: input.missionId,
    brandId: input.brandId,
    eventType: input.eventType,
    summary: input.summary,
    payload: input.payload ?? {},
    createdAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  let supabaseError: unknown = null;
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_EVENT)
      .insert({
        id: event.id,
        mission_id: event.missionId,
        brand_id: event.brandId,
        event_type: event.eventType,
        summary: event.summary,
        payload: event.payload,
        created_at: event.createdAt,
      })
      .select("*")
      .single();
    if (!error && data) return mapEventRow(data);
    supabaseError = error;
  }

  assertLocalMissionStoreAllowed("event create", supabaseError);
  const store = await readLocalStore();
  store.events.unshift(event);
  await writeLocalStore(store);
  return event;
}

export async function createMissionAgentDecision(input: {
  missionId: string;
  brandId: string;
  agent: string;
  action: string;
  rationale?: string;
  riskLevel?: MissionRiskLevel;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}) {
  const decision: MissionAgentDecision = {
    id: createId("misdec"),
    missionId: input.missionId,
    brandId: input.brandId,
    agent: input.agent,
    action: input.action,
    rationale: input.rationale ?? "",
    riskLevel: input.riskLevel ?? "safe_write",
    input: input.input ?? {},
    output: input.output ?? {},
    createdAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  let supabaseError: unknown = null;
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_DECISION)
      .insert({
        id: decision.id,
        mission_id: decision.missionId,
        brand_id: decision.brandId,
        agent: decision.agent,
        action: decision.action,
        rationale: decision.rationale,
        risk_level: decision.riskLevel,
        input: decision.input,
        output: decision.output,
        created_at: decision.createdAt,
      })
      .select("*")
      .single();
    if (!error && data) return mapDecisionRow(data);
    supabaseError = error;
  }

  assertLocalMissionStoreAllowed("decision create", supabaseError);
  const store = await readLocalStore();
  store.decisions.unshift(decision);
  await writeLocalStore(store);
  return decision;
}

export async function createMissionLearning(input: {
  missionId: string;
  brandId: string;
  learningType: string;
  summary: string;
  confidence?: number;
  evidence?: Record<string, unknown>;
  recommendedAction?: string;
}) {
  const learning: MissionLearning = {
    id: createId("mislearn"),
    missionId: input.missionId,
    brandId: input.brandId,
    learningType: input.learningType,
    summary: input.summary,
    confidence: Math.max(0, Math.min(1, input.confidence ?? 0.5)),
    evidence: input.evidence ?? {},
    recommendedAction: input.recommendedAction ?? "",
    appliedAt: "",
    createdAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  let supabaseError: unknown = null;
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_LEARNING)
      .insert({
        id: learning.id,
        mission_id: learning.missionId,
        brand_id: learning.brandId,
        learning_type: learning.learningType,
        summary: learning.summary,
        confidence: learning.confidence,
        evidence: learning.evidence,
        recommended_action: learning.recommendedAction,
        applied_at: null,
        created_at: learning.createdAt,
      })
      .select("*")
      .single();
    if (!error && data) return mapLearningRow(data);
    supabaseError = error;
  }

  assertLocalMissionStoreAllowed("learning create", supabaseError);
  const store = await readLocalStore();
  store.learnings.unshift(learning);
  await writeLocalStore(store);
  return learning;
}

export async function getMissionDetail(brandId: string, missionId: string): Promise<MissionDetail | null> {
  const mission = await getMission(brandId, missionId);
  if (!mission) return null;

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const [events, decisions, learnings] = await Promise.all([
      supabase
        .from(TABLE_EVENT)
        .select("*")
        .eq("mission_id", missionId)
        .order("created_at", { ascending: false }),
      supabase
        .from(TABLE_DECISION)
        .select("*")
        .eq("mission_id", missionId)
        .order("created_at", { ascending: false }),
      supabase
        .from(TABLE_LEARNING)
        .select("*")
        .eq("mission_id", missionId)
        .order("created_at", { ascending: false }),
    ]);
    if (events.error) assertLocalMissionStoreAllowed("detail events load", events.error);
    if (decisions.error) assertLocalMissionStoreAllowed("detail decisions load", decisions.error);
    if (learnings.error) assertLocalMissionStoreAllowed("detail learnings load", learnings.error);
    return {
      mission,
      events: events.error ? [] : (events.data ?? []).map((row: unknown) => mapEventRow(row)),
      decisions: decisions.error ? [] : (decisions.data ?? []).map((row: unknown) => mapDecisionRow(row)),
      learnings: learnings.error ? [] : (learnings.data ?? []).map((row: unknown) => mapLearningRow(row)),
    };
  }

  assertLocalMissionStoreAllowed("detail load");
  const store = await readLocalStore();
  return {
    mission,
    events: store.events.filter((event) => event.missionId === missionId),
    decisions: store.decisions.filter((decision) => decision.missionId === missionId),
    learnings: store.learnings.filter((learning) => learning.missionId === missionId),
  };
}
