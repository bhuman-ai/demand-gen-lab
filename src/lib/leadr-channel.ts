import { getBrandById } from "@/lib/factory-data";
import {
  createLeadrAuthLink,
  createLeadrCampaign,
  getLeadrCampaignResults,
  getLeadrCampaignStatus,
  getLeadrConfigStatus,
  listLeadrAccounts,
  listLeadrCampaigns,
  resolveLeadrUserId,
  resumeLeadrCampaign,
  type LeadrAccount,
  type LeadrCampaign,
  type LeadrCampaignCreatePayload,
  type LeadrCampaignResult,
  type LeadrCampaignStatus,
} from "@/lib/leadr-client";
import {
  createMissionAgentDecision,
  createMissionEvent,
  getMission,
  listMissions,
} from "@/lib/mission-data";
import {
  createMissionChannelRun,
  getMissionChannelRun,
  listMissionChannelRuns,
  listMissionChannelTouches,
  updateMissionChannelRun,
  upsertMissionChannelTouch,
} from "@/lib/mission-channel-data";
import type {
  Mission,
  MissionChannelRunStatus,
  MissionChannelTouchStatus,
  MissionChannelTouchType,
} from "@/lib/mission-types";

const DEFAULT_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

type LeadrCampaignSourceType =
  | "SEARCH_URL"
  | "LEAD_RADAR"
  | "SIGNAL_DISCOVERY"
  | "EXA_LINKEDIN_JOBS"
  | "enrichanything_table";

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

function asStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((entry) => asString(entry)).filter(Boolean);
  const raw = asString(value);
  if (!raw) return [];
  return raw
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeSourceType(value: unknown, managedTableId: string): LeadrCampaignSourceType {
  const normalized = asString(value);
  if (managedTableId) return "enrichanything_table";
  if (
    normalized === "SEARCH_URL" ||
    normalized === "LEAD_RADAR" ||
    normalized === "SIGNAL_DISCOVERY" ||
    normalized === "EXA_LINKEDIN_JOBS" ||
    normalized === "enrichanything_table"
  ) {
    return normalized;
  }
  return "SEARCH_URL";
}

function normalizeStartTime(value: unknown) {
  const raw = asString(value);
  if (/^\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM))?$/i.test(raw)) return raw;
  return "10:00 AM";
}

function normalizeTimeZone(value: unknown) {
  return asString(value) || process.env.LEADR_DEFAULT_TIMEZONE || "America/New_York";
}

function normalizeDays(value: unknown) {
  const raw = asStringArray(value);
  const valid = raw.filter((day) => DEFAULT_DAYS.includes(day) || day === "Saturday" || day === "Sunday");
  return valid.length ? valid : DEFAULT_DAYS;
}

function sortCampaignsNewestFirst(campaigns: LeadrCampaign[]) {
  return [...campaigns].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || left.updatedAt) || 0;
    const rightTime = Date.parse(right.createdAt || right.updatedAt) || 0;
    return rightTime - leftTime;
  });
}

function findCreatedCampaign(input: {
  before: LeadrCampaign[];
  after: LeadrCampaign[];
  name: string;
  accountId: string;
}) {
  const beforeIds = new Set(input.before.map((campaign) => campaign.id));
  const name = input.name.trim();
  const accountId = input.accountId.trim();
  const freshMatches = input.after.filter(
    (campaign) =>
      !beforeIds.has(campaign.id) &&
      (!name || campaign.name === name) &&
      (!accountId || campaign.linkedInAccountId === accountId)
  );
  if (freshMatches.length) return sortCampaignsNewestFirst(freshMatches)[0] ?? null;
  const anyMatches = input.after.filter(
    (campaign) =>
      (!name || campaign.name === name) &&
      (!accountId || campaign.linkedInAccountId === accountId)
  );
  return sortCampaignsNewestFirst(anyMatches)[0] ?? null;
}

async function resolveMissionForBrand(input: { brandId: string; missionId?: string }): Promise<Mission> {
  const missionId = asString(input.missionId);
  if (missionId) {
    const mission = await getMission(input.brandId, missionId);
    if (!mission) throw new Error("Mission not found for this brand.");
    return mission;
  }

  const missions = await listMissions(input.brandId);
  const mission =
    missions.find((row) =>
      ["running", "monitoring", "learning", "deliverability_blocked", "starting", "plan_ready"].includes(row.status)
    ) ??
    missions[0] ??
    null;
  if (!mission) {
    throw new Error("No mission exists for this brand yet. Create/start the mission before launching LinkedIn.");
  }
  return mission;
}

function requireConfiguredForCall(inputUserId?: string) {
  const config = getLeadrConfigStatus();
  const userId = resolveLeadrUserId(inputUserId);
  const missing = [...config.missingEnv];
  if (inputUserId && missing.includes("LEADR_DEFAULT_USER_ID")) {
    missing.splice(missing.indexOf("LEADR_DEFAULT_USER_ID"), 1);
  }
  if (!userId && !missing.includes("LEADR_DEFAULT_USER_ID")) missing.push("LEADR_DEFAULT_USER_ID");
  if (missing.length) {
    throw new Error(`Leadr is not configured. Missing ${missing.join(", ")}.`);
  }
  return { config, userId };
}

async function requireRunnableAccount(input: { userId?: string; accountId: string }): Promise<LeadrAccount> {
  const accountId = asString(input.accountId);
  if (!accountId) throw new Error("accountId is required.");
  const accounts = await listLeadrAccounts({ userId: input.userId });
  const account = accounts.find((row) => row.accountId === accountId) ?? null;
  if (!account) throw new Error("Leadr LinkedIn account was not found for this user.");
  if (!account.runnable) {
    throw new Error(
      `Leadr LinkedIn account ${account.name || account.accountId} is not runnable. Status: ${
        account.connectionState || account.status || "unknown"
      }.`
    );
  }
  return account;
}

function buildCampaignPayload(input: {
  userId: string;
  accountId: string;
  name: string;
  message: string;
  campaignUrl: string;
  sourceType: LeadrCampaignSourceType;
  limit: number;
  invite: boolean;
  managedWorkspaceId: string;
  managedTableId: string;
  enrichanythingOrigin: string;
  timeZone: string;
  startTime: string;
  daysOfWeek: string[];
  workflowActionOrder: string[];
}): LeadrCampaignCreatePayload {
  const campaignOptions: Record<string, unknown> = {
    campaign_url: input.campaignUrl,
    source_type: input.sourceType,
    invite: input.invite,
    limit: input.limit,
    variables: [],
    background_mode: false,
    rephrase_msg: false,
    free_user: false,
    workflow_comment_mode: "off",
    workflow_like_enabled: false,
    workflow_message_after_accept_enabled: input.workflowActionOrder.includes("message"),
    workflow_message_wait_hours: 24,
    workflow_invite_delay_minutes: 30,
    workflow_action_order: input.workflowActionOrder,
  };

  if (input.managedWorkspaceId) campaignOptions.managed_workspace_id = input.managedWorkspaceId;
  if (input.managedTableId) campaignOptions.managed_table_id = input.managedTableId;
  if (input.enrichanythingOrigin) campaignOptions.enrichanything_origin = input.enrichanythingOrigin;

  return {
    campaign_options: campaignOptions,
    campaign_type: input.sourceType === "enrichanything_table" ? "Search" : "Search",
    bh_id: input.userId,
    linkedin_account_id: input.accountId,
    message: input.message,
    name: input.name,
    video_instance_id: "",
    schedule: {
      daysOfWeek: { days: input.daysOfWeek },
      time: input.startTime,
      timeZone: input.timeZone,
    },
    token: "",
    videos_processing: 0,
    videos_failed: 0,
    videos_generated: 0,
    state: "Scheduled",
    invites_sent: 0,
  };
}

function inferRunStatus(campaign: LeadrCampaign | null, status: LeadrCampaignStatus): MissionChannelRunStatus {
  const state = `${campaign?.state ?? ""} ${campaign?.status ?? ""}`.toLowerCase();
  if (state.includes("halt")) return "paused";
  if (state.includes("error")) return "failed";
  if (state.includes("finish")) return "completed";
  if (status.n_processing > 0) return "running";
  if (state.includes("schedule")) return "scheduled";
  if (status.n_results > 0 || status.n_invite_sent > 0 || status.n_messages_sent > 0) return "running";
  return "scheduled";
}

function normalizeOccurredAt(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  if (/^\d{10,}$/.test(raw)) {
    const date = new Date(Number(raw));
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function inferTouchType(result: LeadrCampaignResult): MissionChannelTouchType {
  const act = result.act.toLowerCase();
  if (act.includes("message")) return "linkedin_message";
  if (act.includes("invite")) return "linkedin_invite";
  if (act.includes("comment")) return "linkedin_comment";
  if (act.includes("like") || act.includes("reaction")) return "linkedin_like";
  return "status";
}

function inferTouchStatus(result: LeadrCampaignResult): MissionChannelTouchStatus {
  const state = result.state.toLowerCase();
  const act = result.act.toLowerCase();
  if (result.response) return "replied";
  if (state.includes("error") || state.includes("fail")) return "failed";
  if (act.includes("skipped")) return "skipped";
  if (act.includes("accept")) return "accepted";
  if (state.includes("finished")) return "sent";
  if (state.includes("processing") || state.includes("scheduled")) return "queued";
  return "unknown";
}

function touchEventId(campaignId: string, result: LeadrCampaignResult, suffix = "") {
  return [
    "leadr",
    campaignId,
    result.profileUrl || result.name || "unknown-profile",
    result.act || "status",
    result.startAt || result.state || "unknown-time",
    suffix,
  ]
    .filter(Boolean)
    .join(":")
    .slice(0, 500);
}

export async function getLeadrChannelSnapshot(input: { brandId?: string; userId?: string } = {}) {
  const config = getLeadrConfigStatus();
  const userId = resolveLeadrUserId(input.userId);
  let accounts: LeadrAccount[] = [];
  let accountsError = "";
  if (config.missingEnv.length === 0 || (userId && !config.missingEnv.includes("LEADR_JWT_SECRET"))) {
    try {
      accounts = await listLeadrAccounts({ userId });
    } catch (error) {
      accountsError = error instanceof Error ? error.message : "Failed to list Leadr accounts.";
    }
  }
  const runs = await listMissionChannelRuns({
    brandId: asString(input.brandId) || undefined,
    channel: "linkedin",
    provider: "leadr",
    limit: 25,
  });
  const touches = input.brandId
    ? await listMissionChannelTouches({ brandId: input.brandId, provider: "leadr", limit: 25 })
    : [];
  return {
    configured: config.configured || Boolean(userId && !config.missingEnv.includes("LEADR_JWT_SECRET")),
    baseUrl: config.baseUrl,
    defaultUserIdConfigured: Boolean(config.defaultUserId),
    missingEnv: config.missingEnv,
    accountsError,
    accounts: accounts.map((account) => ({
      accountId: account.accountId,
      name: account.name,
      status: account.status,
      connectionState: account.connectionState,
      activeCampaignCount: account.activeCampaignCount,
      runnable: account.runnable,
    })),
    runs: runs.map((run) => ({
      id: run.id,
      missionId: run.missionId,
      brandId: run.brandId,
      status: run.status,
      name: run.name,
      providerCampaignId: run.providerCampaignId,
      providerAccountId: run.providerAccountId,
      lastSyncAt: run.lastSyncAt,
      lastError: run.lastError,
      limits: run.limits,
    })),
    recentTouches: touches.slice(0, 10).map((touch) => ({
      id: touch.id,
      channelRunId: touch.channelRunId,
      touchType: touch.touchType,
      status: touch.status,
      person: touch.providerPersonName,
      profileUrl: touch.providerProfileUrl,
      occurredAt: touch.occurredAt,
    })),
  };
}

export async function createLeadrLinkedInAuthLink(input: { userId?: string; redirectUrl?: string } = {}) {
  requireConfiguredForCall(input.userId);
  return createLeadrAuthLink(input);
}

export async function createLeadrLinkedInCampaign(input: {
  brandId: string;
  missionId?: string;
  userId?: string;
  accountId: string;
  campaignUrl?: string;
  sourceType?: LeadrCampaignSourceType;
  managedWorkspaceId?: string;
  managedTableId?: string;
  enrichanythingOrigin?: string;
  name?: string;
  message: string;
  limit?: number;
  invite?: boolean;
  timeZone?: string;
  startTime?: string;
  daysOfWeek?: string[] | string;
  workflowActionOrder?: string[] | string;
  sourceRunId?: string;
  sourceCampaignId?: string;
  sourceExperimentId?: string;
  targetSummary?: string;
}) {
  const brandId = asString(input.brandId);
  if (!brandId) throw new Error("brandId is required.");
  const message = asString(input.message);
  if (!message) throw new Error("message is required. Use the actual campaign copy, not a synthetic probe.");
  const { userId } = requireConfiguredForCall(input.userId);
  const mission = await resolveMissionForBrand({ brandId, missionId: input.missionId });
  const brand = await getBrandById(brandId, { includeEmbedded: true });
  const account = await requireRunnableAccount({ userId, accountId: input.accountId });
  const managedTableId = asString(input.managedTableId);
  const sourceType = normalizeSourceType(input.sourceType, managedTableId);
  const campaignUrl = asString(input.campaignUrl) || (managedTableId ? managedTableId : "");
  if (!campaignUrl) {
    throw new Error("campaignUrl is required unless managedTableId is provided.");
  }

  const limit = clampInteger(input.limit, 25, 1, 100);
  const workflowActionOrder = asStringArray(input.workflowActionOrder);
  const actionOrder =
    workflowActionOrder.length > 0
      ? workflowActionOrder.filter((action) => ["comment", "like", "invite", "message"].includes(action))
      : ["invite", "message"];
  const name =
    asString(input.name) ||
    `${brand?.name || "LastB2B"} LinkedIn ${new Date().toISOString().slice(0, 10)}`;
  const before = await listLeadrCampaigns({ userId }).catch(() => []);
  const payload = buildCampaignPayload({
    userId,
    accountId: account.accountId,
    name,
    message,
    campaignUrl,
    sourceType,
    limit,
    invite: input.invite !== false,
    managedWorkspaceId: asString(input.managedWorkspaceId),
    managedTableId,
    enrichanythingOrigin: asString(input.enrichanythingOrigin),
    timeZone: normalizeTimeZone(input.timeZone),
    startTime: normalizeStartTime(input.startTime),
    daysOfWeek: normalizeDays(input.daysOfWeek),
    workflowActionOrder: actionOrder.length ? actionOrder : ["invite", "message"],
  });

  const createResponse = await createLeadrCampaign({ userId, payload });
  const after = await listLeadrCampaigns({ userId }).catch(() => []);
  const providerCampaign = findCreatedCampaign({
    before,
    after,
    name,
    accountId: account.accountId,
  });
  const localRun = await createMissionChannelRun({
    missionId: mission.id,
    brandId,
    channel: "linkedin",
    provider: "leadr",
    providerCampaignId: providerCampaign?.id ?? "",
    providerAccountId: account.accountId,
    providerUserId: userId,
    status: providerCampaign?.id ? "scheduled" : "running",
    name,
    sourceRunId: asString(input.sourceRunId),
    sourceCampaignId: asString(input.sourceCampaignId),
    sourceExperimentId: asString(input.sourceExperimentId),
    targetSummary: asString(input.targetSummary),
    message,
    limits: {
      limit,
      invite: input.invite !== false,
      workflowActionOrder: actionOrder,
      sourceType,
      campaignUrl,
      managedTableId,
    },
    providerPayload: {
      createResponse,
      providerCampaign: providerCampaign?.raw ?? null,
      payload,
    },
  });
  const channelRun = providerCampaign?.id
    ? localRun
    : await updateMissionChannelRun(localRun.id, {
        lastError: "Leadr accepted the campaign, but its campaign id was not returned by /api/campaigns.",
      });

  await createMissionAgentDecision({
    missionId: mission.id,
    brandId,
    agent: "leadr_channel",
    action: "create_leadr_campaign",
    rationale: "GPT selected LinkedIn as an execution channel and launched through Leadr.",
    riskLevel: "guarded_write",
    input: {
      accountId: account.accountId,
      campaignUrl,
      sourceType,
      limit,
      name,
    },
    output: {
      channelRunId: channelRun?.id ?? localRun.id,
      providerCampaignId: providerCampaign?.id ?? "",
      createResponse,
    },
  });
  await createMissionEvent({
    missionId: mission.id,
    brandId,
    eventType: "leadr_campaign_created",
    summary: providerCampaign?.id
      ? `Leadr LinkedIn campaign ${name} was created.`
      : `Leadr LinkedIn campaign ${name} was accepted, but the provider campaign id was not found yet.`,
    payload: {
      channelRunId: channelRun?.id ?? localRun.id,
      providerCampaignId: providerCampaign?.id ?? "",
      accountId: account.accountId,
      sourceType,
      limit,
    },
  });

  return {
    channelRun: channelRun ?? localRun,
    providerCampaign,
    createResponse,
    account,
    mission,
  };
}

export async function syncLeadrLinkedInCampaign(input: { channelRunId: string; userId?: string }) {
  requireConfiguredForCall(input.userId);
  const channelRunId = asString(input.channelRunId);
  if (!channelRunId) throw new Error("channelRunId is required.");
  const run = await getMissionChannelRun(channelRunId);
  if (!run) throw new Error("Leadr channel run not found.");
  const userId = asString(input.userId) || run.providerUserId || resolveLeadrUserId();
  if (!run.providerCampaignId) {
    const updated = await updateMissionChannelRun(run.id, {
      status: "blocked",
      lastSyncAt: nowIso(),
      lastError: "No Leadr provider campaign id is stored for this channel run.",
    });
    return {
      channelRun: updated ?? run,
      status: null,
      results: [],
      touchesUpserted: 0,
    };
  }

  const [status, results, campaigns] = await Promise.all([
    getLeadrCampaignStatus({ userId, campaignId: run.providerCampaignId }),
    getLeadrCampaignResults({ userId, campaignId: run.providerCampaignId }),
    listLeadrCampaigns({ userId }).catch(() => []),
  ]);
  const providerCampaign = campaigns.find((campaign) => campaign.id === run.providerCampaignId) ?? null;
  const nextStatus = inferRunStatus(providerCampaign, status);
  const touches = [];
  for (const result of results) {
    const touchType = inferTouchType(result);
    touches.push(
      await upsertMissionChannelTouch({
        channelRunId: run.id,
        missionId: run.missionId,
        brandId: run.brandId,
        channel: "linkedin",
        provider: "leadr",
        providerEventId: touchEventId(run.providerCampaignId, result),
        providerProfileUrl: result.profileUrl,
        providerPersonName: result.name,
        touchType,
        status: inferTouchStatus(result),
        message: touchType === "linkedin_message" || touchType === "linkedin_invite" ? run.message : "",
        raw: result.raw,
        occurredAt: normalizeOccurredAt(result.startAt),
      })
    );
    if (result.response) {
      touches.push(
        await upsertMissionChannelTouch({
          channelRunId: run.id,
          missionId: run.missionId,
          brandId: run.brandId,
          channel: "linkedin",
          provider: "leadr",
          providerEventId: touchEventId(run.providerCampaignId, result, "reply"),
          providerProfileUrl: result.profileUrl,
          providerPersonName: result.name,
          touchType: "linkedin_reply",
          status: "replied",
          message: result.response,
          raw: result.raw,
          occurredAt: normalizeOccurredAt(result.startAt),
        })
      );
    }
  }

  const updated = await updateMissionChannelRun(run.id, {
    status: nextStatus,
    lastSyncAt: nowIso(),
    lastError: "",
    providerPayload: {
      ...run.providerPayload,
      providerCampaign: providerCampaign?.raw ?? run.providerPayload.providerCampaign ?? null,
      status: status.raw,
      results: results.map((result) => result.raw),
    },
  });

  await createMissionEvent({
    missionId: run.missionId,
    brandId: run.brandId,
    eventType: "leadr_campaign_synced",
    summary: `Synced Leadr campaign ${run.name || run.providerCampaignId}.`,
    payload: {
      channelRunId: run.id,
      providerCampaignId: run.providerCampaignId,
      status: status.raw,
      resultCount: results.length,
      touchesUpserted: touches.length,
    },
  });

  return {
    channelRun: updated ?? run,
    status,
    results,
    touchesUpserted: touches.length,
  };
}

export async function resumeLeadrLinkedInCampaign(input: { channelRunId: string; userId?: string }) {
  requireConfiguredForCall(input.userId);
  const run = await getMissionChannelRun(input.channelRunId);
  if (!run) throw new Error("Leadr channel run not found.");
  if (!run.providerCampaignId) throw new Error("No Leadr provider campaign id is stored for this channel run.");
  if (!run.providerAccountId) throw new Error("No Leadr account id is stored for this channel run.");
  const userId = asString(input.userId) || run.providerUserId || resolveLeadrUserId();
  const response = await resumeLeadrCampaign({
    userId,
    campaignId: run.providerCampaignId,
    accountId: run.providerAccountId,
  });
  const updated = await updateMissionChannelRun(run.id, {
    status: "running",
    lastError: "",
    providerPayload: {
      ...run.providerPayload,
      resumeResponse: asRecord(response),
    },
  });
  await createMissionEvent({
    missionId: run.missionId,
    brandId: run.brandId,
    eventType: "leadr_campaign_resumed",
    summary: `Resumed Leadr campaign ${run.name || run.providerCampaignId}.`,
    payload: {
      channelRunId: run.id,
      providerCampaignId: run.providerCampaignId,
      response,
    },
  });
  return {
    channelRun: updated ?? run,
    response,
  };
}

export async function runLeadrChannelSyncTick(limit = 10) {
  const config = getLeadrConfigStatus();
  if (!config.configured) {
    return {
      ok: true,
      configured: false,
      missingEnv: config.missingEnv,
      scanned: 0,
      synced: 0,
      failed: 0,
      results: [],
    };
  }

  const runs = await listMissionChannelRuns({
    channel: "linkedin",
    provider: "leadr",
    statuses: ["scheduled", "running", "paused"],
    limit,
  });
  const results: Array<{
    channelRunId: string;
    ok: boolean;
    status: MissionChannelRunStatus | "";
    error: string;
  }> = [];
  for (const run of runs) {
    try {
      const synced = await syncLeadrLinkedInCampaign({ channelRunId: run.id });
      results.push({
        channelRunId: run.id,
        ok: true,
        status: synced.channelRun.status,
        error: "",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync Leadr campaign.";
      await updateMissionChannelRun(run.id, {
        lastSyncAt: nowIso(),
        lastError: message,
      }).catch(() => null);
      results.push({
        channelRunId: run.id,
        ok: false,
        status: "",
        error: message,
      });
    }
  }
  return {
    ok: results.every((result) => result.ok),
    configured: true,
    scanned: runs.length,
    synced: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}
