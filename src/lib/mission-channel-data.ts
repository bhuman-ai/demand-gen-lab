import { mkdir, readFile, writeFile } from "fs/promises";
import { createId } from "@/lib/factory-data";
import type {
  MissionChannel,
  MissionChannelProvider,
  MissionChannelRun,
  MissionChannelRunStatus,
  MissionChannelTouch,
  MissionChannelTouchStatus,
  MissionChannelTouchType,
} from "@/lib/mission-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const isVercel = Boolean(process.env.VERCEL);
const CHANNEL_STORE_PATH = isVercel
  ? "/tmp/factory_mission_channels.v1.json"
  : `${process.cwd()}/data/mission-channels.v1.json`;

const TABLE_RUN = "demanddev_mission_channel_runs";
const TABLE_TOUCH = "demanddev_mission_channel_touches";

type ChannelStore = {
  runs: MissionChannelRun[];
  touches: MissionChannelTouch[];
};

type ChannelRunPatch = Partial<
  Pick<
    MissionChannelRun,
    | "status"
    | "providerCampaignId"
    | "providerAccountId"
    | "providerUserId"
    | "name"
    | "sourceRunId"
    | "sourceCampaignId"
    | "sourceExperimentId"
    | "targetSummary"
    | "message"
    | "limits"
    | "providerPayload"
    | "lastSyncAt"
    | "lastError"
  >
>;

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

function normalizeChannel(value: unknown): MissionChannel {
  const normalized = asString(value);
  return normalized === "linkedin" ? "linkedin" : "email";
}

function normalizeProvider(value: unknown): MissionChannelProvider {
  const normalized = asString(value);
  return normalized === "leadr" ? "leadr" : "lastb2b";
}

function normalizeRunStatus(value: unknown): MissionChannelRunStatus {
  const normalized = asString(value);
  return ["draft", "scheduled", "running", "paused", "completed", "failed", "blocked"].includes(normalized)
    ? (normalized as MissionChannelRunStatus)
    : "draft";
}

function normalizeTouchType(value: unknown): MissionChannelTouchType {
  const normalized = asString(value);
  return [
    "status",
    "linkedin_invite",
    "linkedin_message",
    "linkedin_reply",
    "linkedin_accept",
    "linkedin_comment",
    "linkedin_like",
  ].includes(normalized)
    ? (normalized as MissionChannelTouchType)
    : "status";
}

function normalizeTouchStatus(value: unknown): MissionChannelTouchStatus {
  const normalized = asString(value);
  return ["queued", "sent", "accepted", "replied", "failed", "skipped", "unknown"].includes(normalized)
    ? (normalized as MissionChannelTouchStatus)
    : "unknown";
}

function mapRunRow(input: unknown): MissionChannelRun {
  const row = asRecord(input);
  return {
    id: asString(row.id),
    missionId: asString(row.mission_id ?? row.missionId),
    brandId: asString(row.brand_id ?? row.brandId),
    channel: normalizeChannel(row.channel),
    provider: normalizeProvider(row.provider),
    providerCampaignId: asString(row.provider_campaign_id ?? row.providerCampaignId),
    providerAccountId: asString(row.provider_account_id ?? row.providerAccountId),
    providerUserId: asString(row.provider_user_id ?? row.providerUserId),
    status: normalizeRunStatus(row.status),
    name: asString(row.name),
    sourceRunId: asString(row.source_run_id ?? row.sourceRunId),
    sourceCampaignId: asString(row.source_campaign_id ?? row.sourceCampaignId),
    sourceExperimentId: asString(row.source_experiment_id ?? row.sourceExperimentId),
    targetSummary: asString(row.target_summary ?? row.targetSummary),
    message: asString(row.message),
    limits: asRecord(row.limits),
    providerPayload: asRecord(row.provider_payload ?? row.providerPayload),
    lastSyncAt: asString(row.last_sync_at ?? row.lastSyncAt),
    lastError: asString(row.last_error ?? row.lastError),
    createdAt: asString(row.created_at ?? row.createdAt) || nowIso(),
    updatedAt: asString(row.updated_at ?? row.updatedAt) || nowIso(),
  };
}

function mapTouchRow(input: unknown): MissionChannelTouch {
  const row = asRecord(input);
  return {
    id: asString(row.id),
    channelRunId: asString(row.channel_run_id ?? row.channelRunId),
    missionId: asString(row.mission_id ?? row.missionId),
    brandId: asString(row.brand_id ?? row.brandId),
    leadId: asString(row.lead_id ?? row.leadId),
    channel: normalizeChannel(row.channel),
    provider: normalizeProvider(row.provider),
    providerEventId: asString(row.provider_event_id ?? row.providerEventId),
    providerProfileUrl: asString(row.provider_profile_url ?? row.providerProfileUrl),
    providerPersonName: asString(row.provider_person_name ?? row.providerPersonName),
    touchType: normalizeTouchType(row.touch_type ?? row.touchType),
    status: normalizeTouchStatus(row.status),
    message: asString(row.message),
    raw: asRecord(row.raw),
    occurredAt: asString(row.occurred_at ?? row.occurredAt),
    createdAt: asString(row.created_at ?? row.createdAt) || nowIso(),
    updatedAt: asString(row.updated_at ?? row.updatedAt) || nowIso(),
  };
}

function runToDb(row: MissionChannelRun) {
  return {
    id: row.id,
    mission_id: row.missionId,
    brand_id: row.brandId,
    channel: row.channel,
    provider: row.provider,
    provider_campaign_id: row.providerCampaignId,
    provider_account_id: row.providerAccountId,
    provider_user_id: row.providerUserId,
    status: row.status,
    name: row.name,
    source_run_id: row.sourceRunId,
    source_campaign_id: row.sourceCampaignId,
    source_experiment_id: row.sourceExperimentId,
    target_summary: row.targetSummary,
    message: row.message,
    limits: row.limits,
    provider_payload: row.providerPayload,
    last_sync_at: row.lastSyncAt || null,
    last_error: row.lastError,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function touchToDb(row: MissionChannelTouch) {
  return {
    id: row.id,
    channel_run_id: row.channelRunId,
    mission_id: row.missionId,
    brand_id: row.brandId,
    lead_id: row.leadId,
    channel: row.channel,
    provider: row.provider,
    provider_event_id: row.providerEventId,
    provider_profile_url: row.providerProfileUrl,
    provider_person_name: row.providerPersonName,
    touch_type: row.touchType,
    status: row.status,
    message: row.message,
    raw: row.raw,
    occurred_at: row.occurredAt || null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function readLocalStore(): Promise<ChannelStore> {
  try {
    const raw = await readFile(CHANNEL_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<ChannelStore>;
    return {
      runs: Array.isArray(parsed.runs) ? parsed.runs.map(mapRunRow) : [],
      touches: Array.isArray(parsed.touches) ? parsed.touches.map(mapTouchRow) : [],
    };
  } catch {
    return { runs: [], touches: [] };
  }
}

async function writeLocalStore(store: ChannelStore) {
  await mkdir(CHANNEL_STORE_PATH.replace(/\/[^/]+$/, ""), { recursive: true });
  await writeFile(CHANNEL_STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function createMissionChannelRun(input: {
  missionId: string;
  brandId: string;
  channel: MissionChannel;
  provider: MissionChannelProvider;
  providerCampaignId?: string;
  providerAccountId?: string;
  providerUserId?: string;
  status?: MissionChannelRunStatus;
  name?: string;
  sourceRunId?: string;
  sourceCampaignId?: string;
  sourceExperimentId?: string;
  targetSummary?: string;
  message?: string;
  limits?: Record<string, unknown>;
  providerPayload?: Record<string, unknown>;
}) {
  const now = nowIso();
  const run: MissionChannelRun = {
    id: createId("mischrun"),
    missionId: input.missionId,
    brandId: input.brandId,
    channel: input.channel,
    provider: input.provider,
    providerCampaignId: input.providerCampaignId ?? "",
    providerAccountId: input.providerAccountId ?? "",
    providerUserId: input.providerUserId ?? "",
    status: input.status ?? "draft",
    name: input.name ?? "",
    sourceRunId: input.sourceRunId ?? "",
    sourceCampaignId: input.sourceCampaignId ?? "",
    sourceExperimentId: input.sourceExperimentId ?? "",
    targetSummary: input.targetSummary ?? "",
    message: input.message ?? "",
    limits: input.limits ?? {},
    providerPayload: input.providerPayload ?? {},
    lastSyncAt: "",
    lastError: "",
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase.from(TABLE_RUN).insert(runToDb(run)).select("*").single();
    if (!error && data) return mapRunRow(data);
  }

  const store = await readLocalStore();
  store.runs.unshift(run);
  await writeLocalStore(store);
  return run;
}

export async function getMissionChannelRun(id: string): Promise<MissionChannelRun | null> {
  const runId = asString(id);
  if (!runId) return null;
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase.from(TABLE_RUN).select("*").eq("id", runId).maybeSingle();
    if (!error && data) return mapRunRow(data);
  }

  const store = await readLocalStore();
  return store.runs.find((run) => run.id === runId) ?? null;
}

export async function listMissionChannelRuns(input: {
  missionId?: string;
  brandId?: string;
  channel?: MissionChannel;
  provider?: MissionChannelProvider;
  statuses?: MissionChannelRunStatus[];
  limit?: number;
} = {}): Promise<MissionChannelRun[]> {
  const limit = Math.max(1, Math.min(250, Math.round(Number(input.limit) || 100)));
  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase.from(TABLE_RUN).select("*").order("updated_at", { ascending: false }).limit(limit);
    if (input.missionId) query = query.eq("mission_id", input.missionId);
    if (input.brandId) query = query.eq("brand_id", input.brandId);
    if (input.channel) query = query.eq("channel", input.channel);
    if (input.provider) query = query.eq("provider", input.provider);
    if (input.statuses?.length) query = query.in("status", input.statuses);
    const { data, error } = await query;
    if (!error) return (data ?? []).map((row: unknown) => mapRunRow(row));
  }

  const store = await readLocalStore();
  return store.runs
    .filter((run) => {
      if (input.missionId && run.missionId !== input.missionId) return false;
      if (input.brandId && run.brandId !== input.brandId) return false;
      if (input.channel && run.channel !== input.channel) return false;
      if (input.provider && run.provider !== input.provider) return false;
      if (input.statuses?.length && !input.statuses.includes(run.status)) return false;
      return true;
    })
    .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))
    .slice(0, limit);
}

export async function updateMissionChannelRun(
  id: string,
  patch: ChannelRunPatch
): Promise<MissionChannelRun | null> {
  const existing = await getMissionChannelRun(id);
  if (!existing) return null;
  const next: MissionChannelRun = {
    ...existing,
    ...patch,
    status: patch.status ? normalizeRunStatus(patch.status) : existing.status,
    limits: patch.limits ? asRecord(patch.limits) : existing.limits,
    providerPayload: patch.providerPayload ? asRecord(patch.providerPayload) : existing.providerPayload,
    updatedAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_RUN)
      .update(runToDb(next))
      .eq("id", next.id)
      .select("*")
      .maybeSingle();
    if (!error && data) return mapRunRow(data);
  }

  const store = await readLocalStore();
  const index = store.runs.findIndex((run) => run.id === next.id);
  if (index < 0) return null;
  store.runs[index] = next;
  await writeLocalStore(store);
  return next;
}

export async function upsertMissionChannelTouch(input: {
  id?: string;
  channelRunId: string;
  missionId: string;
  brandId: string;
  leadId?: string;
  channel: MissionChannel;
  provider: MissionChannelProvider;
  providerEventId: string;
  providerProfileUrl?: string;
  providerPersonName?: string;
  touchType: MissionChannelTouchType;
  status: MissionChannelTouchStatus;
  message?: string;
  raw?: Record<string, unknown>;
  occurredAt?: string;
}) {
  const now = nowIso();
  const providerEventId = input.providerEventId || createId("mischevt");
  const touch: MissionChannelTouch = {
    id: input.id ?? createId("mischtouch"),
    channelRunId: input.channelRunId,
    missionId: input.missionId,
    brandId: input.brandId,
    leadId: input.leadId ?? "",
    channel: input.channel,
    provider: input.provider,
    providerEventId,
    providerProfileUrl: input.providerProfileUrl ?? "",
    providerPersonName: input.providerPersonName ?? "",
    touchType: input.touchType,
    status: input.status,
    message: input.message ?? "",
    raw: input.raw ?? {},
    occurredAt: input.occurredAt ?? "",
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const existing = await supabase
      .from(TABLE_TOUCH)
      .select("id, created_at")
      .eq("channel_run_id", touch.channelRunId)
      .eq("provider_event_id", touch.providerEventId)
      .eq("touch_type", touch.touchType)
      .maybeSingle();
    const row = {
      ...touchToDb(touch),
      id: asString(existing.data?.id) || touch.id,
      created_at: asString(existing.data?.created_at) || touch.createdAt,
    };
    const { data, error } = await supabase.from(TABLE_TOUCH).upsert(row).select("*").single();
    if (!error && data) return mapTouchRow(data);
  }

  const store = await readLocalStore();
  const existingIndex = store.touches.findIndex(
    (row) =>
      row.channelRunId === touch.channelRunId &&
      row.providerEventId === touch.providerEventId &&
      row.touchType === touch.touchType
  );
  if (existingIndex >= 0) {
    touch.id = store.touches[existingIndex]!.id;
    touch.createdAt = store.touches[existingIndex]!.createdAt;
    store.touches[existingIndex] = touch;
  } else {
    store.touches.unshift(touch);
  }
  await writeLocalStore(store);
  return touch;
}

export async function listMissionChannelTouches(input: {
  channelRunId?: string;
  missionId?: string;
  brandId?: string;
  provider?: MissionChannelProvider;
  limit?: number;
} = {}): Promise<MissionChannelTouch[]> {
  const limit = Math.max(1, Math.min(500, Math.round(Number(input.limit) || 100)));
  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase
      .from(TABLE_TOUCH)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (input.channelRunId) query = query.eq("channel_run_id", input.channelRunId);
    if (input.missionId) query = query.eq("mission_id", input.missionId);
    if (input.brandId) query = query.eq("brand_id", input.brandId);
    if (input.provider) query = query.eq("provider", input.provider);
    const { data, error } = await query;
    if (!error) return (data ?? []).map((row: unknown) => mapTouchRow(row));
  }

  const store = await readLocalStore();
  return store.touches
    .filter((touch) => {
      if (input.channelRunId && touch.channelRunId !== input.channelRunId) return false;
      if (input.missionId && touch.missionId !== input.missionId) return false;
      if (input.brandId && touch.brandId !== input.brandId) return false;
      if (input.provider && touch.provider !== input.provider) return false;
      return true;
    })
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
    .slice(0, limit);
}
