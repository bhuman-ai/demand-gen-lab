import { createHmac } from "node:crypto";

const DEFAULT_LEADR_BASE_URL = "https://leadr.bhumanai.workers.dev";

export type LeadrConfigStatus = {
  configured: boolean;
  baseUrl: string;
  defaultUserId: string;
  defaultRedirectUrl: string;
  missingEnv: string[];
};

export type LeadrAccount = {
  bhId: string;
  accountId: string;
  status: string;
  connectionState: string;
  activeCampaignCount: number;
  name: string;
  runnable: boolean;
};

export type LeadrCampaign = {
  id: string;
  name: string;
  bhId: string;
  linkedInAccountId: string;
  state: string;
  status: string;
  message: string;
  campaignType: string;
  campaignOptions: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
};

export type LeadrCampaignStatus = {
  n_failed: number;
  n_invite_sent: number;
  n_messages_sent: number;
  n_waiting_acceptance: number;
  n_comment_drafts: number;
  n_unreachable: number;
  n_processing: number;
  n_results: number;
  n_successful: number;
  raw: Record<string, unknown>;
};

export type LeadrCampaignResult = {
  profileUrl: string;
  name: string;
  state: string;
  act: string;
  generatedVideoUrl: string;
  startAt: string;
  response: string;
  raw: Record<string, unknown>;
};

export type LeadrCampaignCreatePayload = {
  campaign_options: Record<string, unknown>;
  campaign_type: "Search" | "CsvFile";
  bh_id: string;
  linkedin_account_id: string;
  message: string;
  name: string;
  video_instance_id: string;
  schedule: {
    daysOfWeek: { days: string[] };
    time: string;
    timeZone: string;
  };
  token: string;
  videos_processing: number;
  videos_failed: number;
  videos_generated: number;
  state: string;
  invites_sent: number;
};

export class LeadrClientError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "LeadrClientError";
    this.status = status;
    this.payload = payload;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function configValue(...names: string[]) {
  for (const name of names) {
    const value = asString(process.env[name]);
    if (value) return value;
  }
  return "";
}

function configuredBaseUrl() {
  return (configValue("LEADR_BASE_URL", "NEXT_PUBLIC_LEADR_BASE_URL") || DEFAULT_LEADR_BASE_URL).replace(/\/+$/, "");
}

function configuredJwtSecret() {
  return configValue("LEADR_JWT_SECRET", "LEADR_WORKER_JWT_SECRET");
}

function configuredDefaultUserId() {
  return configValue("LEADR_DEFAULT_USER_ID", "LEADR_BHUMAN_USER_ID");
}

function configuredDefaultRedirectUrl() {
  const explicit = configValue("LEADR_DEFAULT_REDIRECT_URL");
  if (explicit) return explicit;
  const appUrl = configValue("NEXT_PUBLIC_APP_URL", "APP_URL", "VERCEL_PROJECT_PRODUCTION_URL");
  if (appUrl) {
    const normalized = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
    return `${normalized.replace(/\/+$/, "")}/settings/outreach`;
  }
  return "https://www.lastb2b.com/settings/outreach";
}

export function getLeadrConfigStatus(): LeadrConfigStatus {
  const missingEnv: string[] = [];
  if (!configuredJwtSecret()) missingEnv.push("LEADR_JWT_SECRET");
  if (!configuredDefaultUserId()) missingEnv.push("LEADR_DEFAULT_USER_ID");
  return {
    configured: missingEnv.length === 0,
    baseUrl: configuredBaseUrl(),
    defaultUserId: configuredDefaultUserId(),
    defaultRedirectUrl: configuredDefaultRedirectUrl(),
    missingEnv,
  };
}

export function resolveLeadrUserId(userId?: string) {
  return asString(userId) || configuredDefaultUserId();
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signLeadrJwt(userId: string) {
  const secret = configuredJwtSecret();
  if (!secret) {
    throw new LeadrClientError("LEADR_JWT_SECRET is not configured.", 0, {
      missingEnv: ["LEADR_JWT_SECRET"],
    });
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const encodedHeader = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedPayload = base64Url(
    JSON.stringify({
      sub: userId,
      role: "Admin",
      iat: nowSeconds,
      exp: nowSeconds + 60 * 60,
    })
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64Url(signature)}`;
}

async function parseLeadrResponse(response: Response) {
  const text = await response.text();
  let payload: unknown = text;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const row = asRecord(payload);
    const message =
      asString(row.message) ||
      asString(row.error) ||
      asString(asRecord(row.result).error) ||
      `Leadr request failed with status ${response.status}.`;
    throw new LeadrClientError(message, response.status, payload);
  }
  return payload;
}

async function leadrRequest(input: {
  userId?: string;
  path: string;
  method?: string;
  query?: Record<string, string>;
  body?: unknown;
}) {
  const userId = resolveLeadrUserId(input.userId);
  if (!userId) {
    throw new LeadrClientError("LEADR_DEFAULT_USER_ID is not configured and no Leadr userId was provided.", 0, {
      missingEnv: ["LEADR_DEFAULT_USER_ID"],
    });
  }

  const url = new URL(input.path, `${configuredBaseUrl()}/`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: input.method ?? (input.body === undefined ? "GET" : "POST"),
    headers: {
      authorization: `Bearer ${signLeadrJwt(userId)}`,
      ...(input.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    cache: "no-store",
  });
  return parseLeadrResponse(response);
}

function isRunnableAccount(status: string, connectionState: string) {
  const combined = `${status} ${connectionState}`.trim().toLowerCase();
  if (!combined) return false;
  if (
    ["sleep", "error", "checkpoint", "credential", "disconnect", "expired", "reconnect", "invalid"].some((bad) =>
      combined.includes(bad)
    )
  ) {
    return false;
  }
  return ["ok", "connected", "active", "valid"].some((good) => combined.includes(good));
}

function mapAccount(value: unknown): LeadrAccount {
  const row = asRecord(value);
  const status = asString(row.status);
  const connectionState = asString(row.connection_state ?? row.connectionState);
  return {
    bhId: asString(row.bh_id ?? row.bhId),
    accountId: asString(row.account_id ?? row.accountId),
    status,
    connectionState,
    activeCampaignCount: Math.max(0, Math.round(asNumber(row.active_campaign_count ?? row.activeCampaignCount, 0))),
    name: asString(row.name),
    runnable: isRunnableAccount(status, connectionState),
  };
}

function parseCampaignOptions(value: unknown) {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return asRecord(value);
}

function mapCampaign(value: unknown): LeadrCampaign {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    name: asString(row.name),
    bhId: asString(row.bh_id ?? row.bhId),
    linkedInAccountId: asString(row.linkedin_account_id ?? row.linkedInAccountId),
    state: asString(row.state),
    status: asString(row.status),
    message: asString(row.message),
    campaignType: asString(row.campaign_type ?? row.c_type ?? row.campaignType),
    campaignOptions: parseCampaignOptions(row.campaign_options ?? row.campaignOptions),
    createdAt: asString(row.created_at ?? row.createdAt),
    updatedAt: asString(row.updated_at ?? row.updatedAt),
    raw: row,
  };
}

function mapCampaignStatus(value: unknown): LeadrCampaignStatus {
  const row = asRecord(value);
  return {
    n_failed: Math.max(0, Math.round(asNumber(row.n_failed, 0))),
    n_invite_sent: Math.max(0, Math.round(asNumber(row.n_invite_sent, 0))),
    n_messages_sent: Math.max(0, Math.round(asNumber(row.n_messages_sent, 0))),
    n_waiting_acceptance: Math.max(0, Math.round(asNumber(row.n_waiting_acceptance, 0))),
    n_comment_drafts: Math.max(0, Math.round(asNumber(row.n_comment_drafts, 0))),
    n_unreachable: Math.max(0, Math.round(asNumber(row.n_unreachable, 0))),
    n_processing: Math.max(0, Math.round(asNumber(row.n_processing, 0))),
    n_results: Math.max(0, Math.round(asNumber(row.n_results, 0))),
    n_successful: Math.max(0, Math.round(asNumber(row.n_successful, 0))),
    raw: row,
  };
}

function mapCampaignResult(value: unknown): LeadrCampaignResult {
  const row = asRecord(value);
  return {
    profileUrl: asString(row.profile_url ?? row.profileUrl),
    name: asString(row.name),
    state: asString(row.state),
    act: asString(row.act),
    generatedVideoUrl: asString(row.generated_video_url ?? row.generatedVideoUrl),
    startAt: asString(row.start_at ?? row.startAt),
    response: asString(row.response),
    raw: row,
  };
}

export async function listLeadrAccounts(input: { userId?: string } = {}) {
  const payload = asRecord(await leadrRequest({ userId: input.userId, path: "/api/getLinkedInAccount" }));
  return asArray(payload.accounts).map(mapAccount).filter((account) => account.accountId);
}

export async function createLeadrAuthLink(input: { userId?: string; redirectUrl?: string } = {}) {
  const userId = resolveLeadrUserId(input.userId);
  const location = asString(input.redirectUrl) || configuredDefaultRedirectUrl();
  const payload = asRecord(
    await leadrRequest({
      userId,
      path: "/api/getHostedAuthLink",
      query: {
        user_id: userId,
        location,
      },
    })
  );
  return {
    url: asString(payload.url),
    userId,
    redirectUrl: location,
    raw: payload,
  };
}

export async function listLeadrCampaigns(input: { userId?: string } = {}) {
  const payload = await leadrRequest({ userId: input.userId, path: "/api/campaigns" });
  return asArray(payload).map(mapCampaign).filter((campaign) => campaign.id);
}

export async function createLeadrCampaign(input: {
  userId?: string;
  payload: LeadrCampaignCreatePayload;
}) {
  return leadrRequest({
    userId: input.userId,
    path: "/api/createCampaign",
    method: "POST",
    body: input.payload,
  });
}

export async function getLeadrCampaignStatus(input: { userId?: string; campaignId: string }) {
  return mapCampaignStatus(
    await leadrRequest({
      userId: input.userId,
      path: "/api/campaignStatus",
      query: { campaign_id: input.campaignId },
    })
  );
}

export async function getLeadrCampaignResults(input: { userId?: string; campaignId: string }) {
  const payload = asRecord(
    await leadrRequest({
      userId: input.userId,
      path: "/api/campaign",
      query: { campaign_id: input.campaignId },
    })
  );
  return asArray(payload.campaignResultData).map(mapCampaignResult);
}

export async function resumeLeadrCampaign(input: {
  userId?: string;
  campaignId: string;
  accountId: string;
}) {
  return leadrRequest({
    userId: input.userId,
    path: "/api/resume-campaign",
    method: "POST",
    body: {
      campaign_id: input.campaignId,
      account_id: input.accountId,
    },
  });
}
