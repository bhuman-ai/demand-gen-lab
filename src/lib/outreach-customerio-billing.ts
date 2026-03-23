import type {
  CustomerIoBillingConfig,
  CustomerIoBillingSummary,
  OutreachAccountConfig,
} from "@/lib/factory-types";

export const DEFAULT_CUSTOMER_IO_MONTHLY_PROFILE_LIMIT = 30_000;
export const DEFAULT_CUSTOMER_IO_BILLING_CYCLE_ANCHOR_DAY = 1;

type CustomerIoRegion = "us" | "eu";

type CustomerIoTrackRegionResponse = {
  region: CustomerIoRegion;
  environmentId: string;
};

export type CustomerIoWorkspaceSnapshot = {
  workspaceId: string;
  region: CustomerIoRegion;
  people: number;
  fetchedAt: string;
  appBaseUrl: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function clampNonNegativeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

export function clampCustomerIoBillingCycleAnchorDay(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_CUSTOMER_IO_BILLING_CYCLE_ANCHOR_DAY;
  }
  return Math.max(1, Math.min(28, Math.floor(parsed)));
}

export function sanitizeCustomerIoBillingConfig(value: unknown): CustomerIoBillingConfig {
  const row = asRecord(value);
  return {
    monthlyProfileLimit: clampNonNegativeInteger(
      row.monthlyProfileLimit ?? row.monthly_profile_limit,
      DEFAULT_CUSTOMER_IO_MONTHLY_PROFILE_LIMIT
    ),
    billingCycleAnchorDay: clampCustomerIoBillingCycleAnchorDay(
      row.billingCycleAnchorDay ?? row.billing_cycle_anchor_day
    ),
    currentPeriodStart: String(row.currentPeriodStart ?? row.current_period_start ?? "").trim(),
    currentPeriodBaselineProfiles: clampNonNegativeInteger(
      row.currentPeriodBaselineProfiles ?? row.current_period_baseline_profiles,
      0
    ),
    currentPeriodBaselineSyncedAt: String(
      row.currentPeriodBaselineSyncedAt ?? row.current_period_baseline_synced_at ?? ""
    ).trim(),
    lastWorkspacePeopleCount: clampNonNegativeInteger(
      row.lastWorkspacePeopleCount ?? row.last_workspace_people_count,
      0
    ),
    lastWorkspacePeopleCountAt: String(
      row.lastWorkspacePeopleCountAt ?? row.last_workspace_people_count_at ?? ""
    ).trim(),
  };
}

export function currentCustomerIoBillingPeriodStart(anchorDay: number, now = new Date()) {
  const cycleDay = clampCustomerIoBillingCycleAnchorDay(anchorDay);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const currentMonthAnchor = new Date(Date.UTC(year, month, cycleDay, 0, 0, 0, 0));
  if (now.getTime() >= currentMonthAnchor.getTime()) {
    return currentMonthAnchor.toISOString();
  }
  return new Date(Date.UTC(year, month - 1, cycleDay, 0, 0, 0, 0)).toISOString();
}

export function nextCustomerIoBillingPeriodStart(periodStartIso: string, anchorDay: number) {
  const start = periodStartIso ? new Date(periodStartIso) : new Date();
  const cycleDay = clampCustomerIoBillingCycleAnchorDay(anchorDay);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, cycleDay, 0, 0, 0, 0)).toISOString();
}

export function normalizeCustomerIoProfileIdentifier(value: string) {
  return value.trim().toLowerCase();
}

export function mergeOutreachAccountConfig(
  existing: OutreachAccountConfig,
  patch: unknown
): OutreachAccountConfig {
  const next = asRecord(patch);
  const nextCustomerIo = asRecord(next.customerIo);
  const nextMailpool = asRecord(next.mailpool);
  const nextApify = asRecord(next.apify);
  const nextMailbox = asRecord(next.mailbox);
  const nextBilling = asRecord(nextCustomerIo.billing);

  return {
    ...existing,
    customerIo: {
      ...existing.customerIo,
      ...nextCustomerIo,
      billing: {
        ...existing.customerIo.billing,
        ...nextBilling,
      },
    },
    mailpool: {
      ...existing.mailpool,
      ...nextMailpool,
    },
    apify: {
      ...existing.apify,
      ...nextApify,
    },
    mailbox: {
      ...existing.mailbox,
      ...nextMailbox,
    },
  };
}

export function buildCustomerIoBillingSummary(input: {
  config: CustomerIoBillingConfig;
  admittedProfiles: number;
  now?: Date;
}): CustomerIoBillingSummary {
  const config = sanitizeCustomerIoBillingConfig(input.config);
  const billingPeriodStart = currentCustomerIoBillingPeriodStart(config.billingCycleAnchorDay, input.now);
  const baselineReady =
    Boolean(config.currentPeriodStart) &&
    config.currentPeriodStart === billingPeriodStart &&
    Boolean(config.currentPeriodBaselineSyncedAt);
  const baseline = baselineReady ? config.currentPeriodBaselineProfiles : 0;
  const admittedProfiles = Math.max(0, Math.floor(Number(input.admittedProfiles ?? 0) || 0));
  const observedWorkspaceProfiles = Math.max(
    baseline,
    clampNonNegativeInteger(config.lastWorkspacePeopleCount, 0)
  );
  const projectedProfiles = Math.max(baseline + admittedProfiles, observedWorkspaceProfiles);
  return {
    monthlyProfileLimit: config.monthlyProfileLimit,
    billingCycleAnchorDay: config.billingCycleAnchorDay,
    billingPeriodStart,
    baselineReady,
    currentPeriodBaselineProfiles: baseline,
    currentPeriodAdmittedProfiles: admittedProfiles,
    observedWorkspaceProfiles,
    observedWorkspaceProfilesAt: config.lastWorkspacePeopleCountAt,
    projectedProfiles,
    remainingProfiles: Math.max(0, config.monthlyProfileLimit - projectedProfiles),
  };
}

function customerIoTrackHeaders(siteId: string, trackingApiKey: string) {
  return {
    Authorization: `Basic ${Buffer.from(`${siteId.trim()}:${trackingApiKey.trim()}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

function customerIoAppHeaders(appApiKey: string) {
  return {
    Authorization: `Bearer ${appApiKey.trim()}`,
    "Content-Type": "application/json",
  };
}

function customerIoAppBaseUrls(region: CustomerIoRegion) {
  return region === "eu"
    ? ["https://api-eu.customer.io/v1", "https://api.customer.io/v1"]
    : ["https://api.customer.io/v1", "https://api-eu.customer.io/v1"];
}

export async function detectCustomerIoRegionAndEnvironment(input: {
  siteId: string;
  trackingApiKey: string;
}): Promise<CustomerIoTrackRegionResponse> {
  const response = await fetch("https://track.customer.io/api/v1/accounts/region", {
    method: "GET",
    headers: customerIoTrackHeaders(input.siteId, input.trackingApiKey),
    cache: "no-store",
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Customer.io region lookup failed (HTTP ${response.status}): ${raw.slice(0, 200)}`);
  }
  const payload: unknown = raw ? JSON.parse(raw) : {};
  const row = asRecord(payload);
  const region = String(row.region ?? "").trim().toLowerCase() === "eu" ? "eu" : "us";
  return {
    region,
    environmentId: String(row.environment_id ?? row.environmentId ?? "").trim(),
  };
}

async function listCustomerIoWorkspaces(input: { baseUrl: string; appApiKey: string }) {
  const response = await fetch(`${input.baseUrl}/workspaces`, {
    method: "GET",
    headers: customerIoAppHeaders(input.appApiKey),
    cache: "no-store",
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Customer.io workspace lookup failed (HTTP ${response.status}): ${raw.slice(0, 300)}`);
  }
  const payload: unknown = raw ? JSON.parse(raw) : {};
  const row = asRecord(payload);
  const workspaces = Array.isArray(row.workspaces) ? row.workspaces : [];
  return workspaces.map((workspace) => asRecord(workspace));
}

export async function fetchCustomerIoWorkspaceSnapshot(input: {
  siteId: string;
  trackingApiKey: string;
  appApiKey: string;
  workspaceId?: string;
}): Promise<CustomerIoWorkspaceSnapshot> {
  const detected = await detectCustomerIoRegionAndEnvironment({
    siteId: input.siteId,
    trackingApiKey: input.trackingApiKey,
  });
  const preferredWorkspaceId = input.workspaceId?.trim() || detected.environmentId;

  let lastError: unknown = null;
  for (const baseUrl of customerIoAppBaseUrls(detected.region)) {
    try {
      const workspaces = await listCustomerIoWorkspaces({
        baseUrl,
        appApiKey: input.appApiKey,
      });
      const matched =
        workspaces.find((workspace) => String(workspace.id ?? "").trim() === preferredWorkspaceId) ??
        workspaces.find((workspace) => String(workspace.id ?? "").trim() === detected.environmentId) ??
        null;
      if (!matched) {
        throw new Error(`Workspace ${preferredWorkspaceId || detected.environmentId || "(unknown)"} was not found`);
      }

      return {
        workspaceId: String(matched.id ?? preferredWorkspaceId).trim(),
        region: detected.region,
        people: clampNonNegativeInteger(matched.people, 0),
        fetchedAt: new Date().toISOString(),
        appBaseUrl: baseUrl,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Customer.io workspace lookup failed");
}
