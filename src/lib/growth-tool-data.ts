import { mkdir, readFile, writeFile } from "fs/promises";
import { createId } from "@/lib/factory-data";
import type {
  GrowthToolCall,
  GrowthToolCallStatus,
  GrowthToolCategory,
  GrowthToolCapability,
} from "@/lib/growth-tool-types";
import type { MissionRiskLevel } from "@/lib/mission-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const isVercel = Boolean(process.env.VERCEL);
const GROWTH_TOOL_STORE_PATH = isVercel
  ? "/tmp/factory_growth_tool_calls.v1.json"
  : `${process.cwd()}/data/growth-tool-calls.v1.json`;

const TABLE_CALL = "demanddev_growth_tool_calls";

type GrowthToolStore = {
  calls: GrowthToolCall[];
};

function nowIso() {
  return new Date().toISOString();
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

function asBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = asString(value).toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeRisk(value: unknown): MissionRiskLevel {
  const normalized = asString(value);
  return ["read", "safe_write", "guarded_write", "blocked"].includes(normalized)
    ? (normalized as MissionRiskLevel)
    : "read";
}

function normalizeStatus(value: unknown): GrowthToolCallStatus {
  const normalized = asString(value);
  return ["running", "completed", "failed", "blocked", "dry_run"].includes(normalized)
    ? (normalized as GrowthToolCallStatus)
    : "running";
}

function normalizeCategory(value: unknown): GrowthToolCategory | "" {
  const normalized = asString(value);
  return [
    "strategy",
    "lead_source",
    "enrichment",
    "validation",
    "sender_infra",
    "deliverability",
    "channel",
    "analytics",
    "memory",
  ].includes(normalized)
    ? (normalized as GrowthToolCategory)
    : "";
}

function normalizeCapability(value: unknown): GrowthToolCapability | "" {
  const normalized = asString(value);
  return [
    "inspect_state",
    "find_leads",
    "prepare_leads",
    "enrich_contacts",
    "validate_contacts",
    "provision_sender",
    "refresh_sender",
    "test_inbox_placement",
    "launch_campaign",
    "control_campaign",
    "sync_results",
    "record_learning",
  ].includes(normalized)
    ? (normalized as GrowthToolCapability)
    : "";
}

function mapCallRow(input: unknown): GrowthToolCall {
  const row = asRecord(input);
  return {
    id: asString(row.id),
    brandId: asString(row.brand_id ?? row.brandId),
    missionId: asString(row.mission_id ?? row.missionId),
    toolName: asString(row.tool_name ?? row.toolName),
    provider: asString(row.provider),
    category: normalizeCategory(row.category),
    capability: normalizeCapability(row.capability),
    riskLevel: normalizeRisk(row.risk_level ?? row.riskLevel),
    status: normalizeStatus(row.status),
    agent: asString(row.agent),
    rationale: asString(row.rationale),
    input: asRecord(row.input),
    output: asRecord(row.output),
    error: asString(row.error),
    dryRun: asBoolean(row.dry_run ?? row.dryRun),
    spendRisk: asBoolean(row.spend_risk ?? row.spendRisk),
    reputationRisk: asBoolean(row.reputation_risk ?? row.reputationRisk),
    estimatedCostUsd: Math.max(0, asNumber(row.estimated_cost_usd ?? row.estimatedCostUsd, 0)),
    createdAt: asString(row.created_at ?? row.createdAt) || nowIso(),
    completedAt: asString(row.completed_at ?? row.completedAt),
  };
}

function callToDb(row: GrowthToolCall) {
  return {
    id: row.id,
    brand_id: row.brandId,
    mission_id: row.missionId || null,
    tool_name: row.toolName,
    provider: row.provider,
    category: row.category,
    capability: row.capability,
    risk_level: row.riskLevel,
    status: row.status,
    agent: row.agent,
    rationale: row.rationale,
    input: row.input,
    output: row.output,
    error: row.error,
    dry_run: row.dryRun,
    spend_risk: row.spendRisk,
    reputation_risk: row.reputationRisk,
    estimated_cost_usd: row.estimatedCostUsd,
    created_at: row.createdAt,
    completed_at: row.completedAt || null,
  };
}

async function readLocalStore(): Promise<GrowthToolStore> {
  try {
    const raw = await readFile(GROWTH_TOOL_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<GrowthToolStore>;
    return {
      calls: Array.isArray(parsed.calls) ? parsed.calls.map(mapCallRow) : [],
    };
  } catch {
    return { calls: [] };
  }
}

async function writeLocalStore(store: GrowthToolStore) {
  await mkdir(GROWTH_TOOL_STORE_PATH.replace(/\/[^/]+$/, ""), { recursive: true });
  await writeFile(GROWTH_TOOL_STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function createGrowthToolCall(input: Omit<GrowthToolCall, "id" | "createdAt" | "completedAt">) {
  const call: GrowthToolCall = {
    ...input,
    id: createId("gtcall"),
    createdAt: nowIso(),
    completedAt: "",
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase.from(TABLE_CALL).insert(callToDb(call)).select("*").single();
    if (!error && data) return mapCallRow(data);
  }

  const store = await readLocalStore();
  store.calls.unshift(call);
  await writeLocalStore(store);
  return call;
}

export async function updateGrowthToolCall(
  id: string,
  patch: Partial<Pick<GrowthToolCall, "status" | "output" | "error" | "estimatedCostUsd" | "completedAt">>
) {
  const callId = asString(id);
  if (!callId) return null;
  const completedAt = patch.completedAt ?? nowIso();

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = {};
    if (patch.status) update.status = patch.status;
    if (patch.output) update.output = patch.output;
    if (typeof patch.error === "string") update.error = patch.error;
    if (typeof patch.estimatedCostUsd === "number") update.estimated_cost_usd = patch.estimatedCostUsd;
    update.completed_at = completedAt;
    const { data, error } = await supabase
      .from(TABLE_CALL)
      .update(update)
      .eq("id", callId)
      .select("*")
      .maybeSingle();
    if (!error && data) return mapCallRow(data);
  }

  const store = await readLocalStore();
  const index = store.calls.findIndex((call) => call.id === callId);
  if (index < 0) return null;
  store.calls[index] = {
    ...store.calls[index]!,
    ...patch,
    completedAt,
  };
  await writeLocalStore(store);
  return store.calls[index]!;
}

export async function listGrowthToolCalls(input: {
  brandId?: string;
  missionId?: string;
  toolName?: string;
  limit?: number;
} = {}) {
  const limit = Math.max(1, Math.min(250, Math.round(Number(input.limit) || 100)));
  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase.from(TABLE_CALL).select("*").order("created_at", { ascending: false }).limit(limit);
    if (input.brandId) query = query.eq("brand_id", input.brandId);
    if (input.missionId) query = query.eq("mission_id", input.missionId);
    if (input.toolName) query = query.eq("tool_name", input.toolName);
    const { data, error } = await query;
    if (!error) return (data ?? []).map((row: unknown) => mapCallRow(row));
  }

  const store = await readLocalStore();
  return store.calls
    .filter((call) => {
      if (input.brandId && call.brandId !== input.brandId) return false;
      if (input.missionId && call.missionId !== input.missionId) return false;
      if (input.toolName && call.toolName !== input.toolName) return false;
      return true;
    })
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
    .slice(0, limit);
}
