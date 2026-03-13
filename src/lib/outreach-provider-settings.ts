import { mkdir, readFile, writeFile } from "fs/promises";
import type {
  DeliverabilityDomainHealth,
  DeliverabilityHealthStatus,
  DeliverabilityProvider,
  OutreachProvisioningSettings,
  ProvisioningValidationStatus,
} from "@/lib/factory-types";
import { OutreachDataError } from "@/lib/outreach-data";
import { decryptJson, encryptJson } from "@/lib/outreach-encryption";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type StoredOutreachProvisioningSettings = {
  id: string;
  config: {
    customerIo: {
      siteId: string;
      workspaceRegion: "unknown" | "us" | "eu";
      lastValidatedAt: string;
      lastValidatedStatus: ProvisioningValidationStatus;
      lastValidationMessage: string;
    };
    namecheap: {
      apiUser: string;
      userName: string;
      clientIp: string;
      lastValidatedAt: string;
      lastValidatedStatus: ProvisioningValidationStatus;
      lastValidationMessage: string;
    };
    deliverability: {
      provider: DeliverabilityProvider;
      monitoredDomains: string[];
      lastValidatedAt: string;
      lastValidatedStatus: ProvisioningValidationStatus;
      lastValidationMessage: string;
      lastCheckedAt: string;
      lastHealthStatus: DeliverabilityHealthStatus;
      lastHealthScore: number;
      lastHealthSummary: string;
      lastDomainSnapshots: DeliverabilityDomainHealth[];
    };
  };
  credentialsEncrypted: string;
  createdAt: string;
  updatedAt: string;
};

type OutreachProvisioningSettingsSecrets = {
  customerIoTrackingApiKey: string;
  customerIoAppApiKey: string;
  namecheapApiKey: string;
  deliverabilityGoogleClientId: string;
  deliverabilityGoogleClientSecret: string;
  deliverabilityGoogleRefreshToken: string;
};

type OutreachProvisioningSettingsPatch = {
  customerIo?: {
    siteId?: string;
    workspaceRegion?: "unknown" | "us" | "eu";
    trackingApiKey?: string;
    appApiKey?: string;
    lastValidatedAt?: string;
    lastValidatedStatus?: ProvisioningValidationStatus;
    lastValidationMessage?: string;
  };
  namecheap?: {
    apiUser?: string;
    userName?: string;
    clientIp?: string;
    apiKey?: string;
    lastValidatedAt?: string;
    lastValidatedStatus?: ProvisioningValidationStatus;
    lastValidationMessage?: string;
  };
  deliverability?: {
    provider?: DeliverabilityProvider;
    monitoredDomains?: string[];
    googleClientId?: string;
    googleClientSecret?: string;
    googleRefreshToken?: string;
    lastValidatedAt?: string;
    lastValidatedStatus?: ProvisioningValidationStatus;
    lastValidationMessage?: string;
    lastCheckedAt?: string;
    lastHealthStatus?: DeliverabilityHealthStatus;
    lastHealthScore?: number;
    lastHealthSummary?: string;
    lastDomainSnapshots?: DeliverabilityDomainHealth[];
  };
};

const TABLE_PROVISIONING_SETTINGS = "demanddev_outreach_provisioning_settings";
const SETTINGS_ID = "default";
const isVercel = Boolean(process.env.VERCEL);
const SETTINGS_PATH = isVercel
  ? "/tmp/factory_outreach_provisioning_settings.v1.json"
  : `${process.cwd()}/data/outreach-provisioning-settings.v1.json`;

const nowIso = () => new Date().toISOString();

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function defaultSecrets(): OutreachProvisioningSettingsSecrets {
  return {
    customerIoTrackingApiKey: "",
    customerIoAppApiKey: "",
    namecheapApiKey: "",
    deliverabilityGoogleClientId: "",
    deliverabilityGoogleClientSecret: "",
    deliverabilityGoogleRefreshToken: "",
  };
}

function sanitizeSecrets(value: unknown): OutreachProvisioningSettingsSecrets {
  const row = asRecord(value);
  return {
    customerIoTrackingApiKey: String(row.customerIoTrackingApiKey ?? "").trim(),
    customerIoAppApiKey: String(row.customerIoAppApiKey ?? "").trim(),
    namecheapApiKey: String(row.namecheapApiKey ?? "").trim(),
    deliverabilityGoogleClientId: String(row.deliverabilityGoogleClientId ?? "").trim(),
    deliverabilityGoogleClientSecret: String(row.deliverabilityGoogleClientSecret ?? "").trim(),
    deliverabilityGoogleRefreshToken: String(row.deliverabilityGoogleRefreshToken ?? "").trim(),
  };
}

function defaultStoredConfig(): StoredOutreachProvisioningSettings["config"] {
  return {
    customerIo: {
      siteId: "",
      workspaceRegion: "unknown",
      lastValidatedAt: "",
      lastValidatedStatus: "unknown",
      lastValidationMessage: "",
    },
    namecheap: {
      apiUser: "",
      userName: "",
      clientIp: "",
      lastValidatedAt: "",
      lastValidatedStatus: "unknown",
      lastValidationMessage: "",
    },
    deliverability: {
      provider: "none",
      monitoredDomains: [],
      lastValidatedAt: "",
      lastValidatedStatus: "unknown",
      lastValidationMessage: "",
      lastCheckedAt: "",
      lastHealthStatus: "unknown",
      lastHealthScore: 0,
      lastHealthSummary: "",
      lastDomainSnapshots: [],
    },
  };
}

function sanitizeValidationStatus(value: unknown): ProvisioningValidationStatus {
  return ["unknown", "pass", "fail"].includes(String(value ?? ""))
    ? (String(value) as ProvisioningValidationStatus)
    : "unknown";
}

function sanitizeDeliverabilityProvider(value: unknown): DeliverabilityProvider {
  return String(value ?? "").trim() === "google_postmaster" ? "google_postmaster" : "none";
}

function sanitizeDeliverabilityHealthStatus(value: unknown): DeliverabilityHealthStatus {
  return ["unknown", "healthy", "warning", "critical"].includes(String(value ?? ""))
    ? (String(value) as DeliverabilityHealthStatus)
    : "unknown";
}

function sanitizeMonitoredDomains(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => String(entry ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function sanitizeDomainSnapshots(value: unknown): DeliverabilityDomainHealth[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      domain: String(entry.domain ?? "").trim().toLowerCase(),
      trafficDate: String(entry.trafficDate ?? entry.traffic_date ?? "").trim(),
      domainReputation: String(entry.domainReputation ?? entry.domain_reputation ?? "").trim(),
      spamRate: Number(entry.spamRate ?? entry.spam_rate ?? 0) || 0,
      status: sanitizeDeliverabilityHealthStatus(entry.status),
      summary: String(entry.summary ?? "").trim(),
    }))
    .filter((entry) => entry.domain.length > 0);
}

function sanitizeConfig(value: unknown): StoredOutreachProvisioningSettings["config"] {
  const row = asRecord(value);
  const customerIo = asRecord(row.customerIo);
  const namecheap = asRecord(row.namecheap);
  const deliverability = asRecord(row.deliverability);
  const customerIoRegion = String(customerIo.workspaceRegion ?? "").trim().toLowerCase();
  return {
    customerIo: {
      siteId: String(customerIo.siteId ?? "").trim(),
      workspaceRegion:
        customerIoRegion === "eu" || customerIoRegion === "us"
          ? (customerIoRegion as "eu" | "us")
          : "unknown",
      lastValidatedAt: String(customerIo.lastValidatedAt ?? customerIo.last_validated_at ?? "").trim(),
      lastValidatedStatus: sanitizeValidationStatus(
        customerIo.lastValidatedStatus ?? customerIo.last_validated_status
      ),
      lastValidationMessage: String(
        customerIo.lastValidationMessage ?? customerIo.last_validation_message ?? ""
      ).trim(),
    },
    namecheap: {
      apiUser: String(namecheap.apiUser ?? namecheap.api_user ?? "").trim(),
      userName: String(namecheap.userName ?? namecheap.user_name ?? "").trim(),
      clientIp: String(namecheap.clientIp ?? namecheap.client_ip ?? "").trim(),
      lastValidatedAt: String(namecheap.lastValidatedAt ?? namecheap.last_validated_at ?? "").trim(),
      lastValidatedStatus: sanitizeValidationStatus(
        namecheap.lastValidatedStatus ?? namecheap.last_validated_status
      ),
      lastValidationMessage: String(
        namecheap.lastValidationMessage ?? namecheap.last_validation_message ?? ""
      ).trim(),
    },
    deliverability: {
      provider: sanitizeDeliverabilityProvider(deliverability.provider),
      monitoredDomains: sanitizeMonitoredDomains(
        deliverability.monitoredDomains ?? deliverability.monitored_domains
      ),
      lastValidatedAt: String(
        deliverability.lastValidatedAt ?? deliverability.last_validated_at ?? ""
      ).trim(),
      lastValidatedStatus: sanitizeValidationStatus(
        deliverability.lastValidatedStatus ?? deliverability.last_validated_status
      ),
      lastValidationMessage: String(
        deliverability.lastValidationMessage ?? deliverability.last_validation_message ?? ""
      ).trim(),
      lastCheckedAt: String(deliverability.lastCheckedAt ?? deliverability.last_checked_at ?? "").trim(),
      lastHealthStatus: sanitizeDeliverabilityHealthStatus(
        deliverability.lastHealthStatus ?? deliverability.last_health_status
      ),
      lastHealthScore: Number(
        deliverability.lastHealthScore ?? deliverability.last_health_score ?? 0
      ) || 0,
      lastHealthSummary: String(
        deliverability.lastHealthSummary ?? deliverability.last_health_summary ?? ""
      ).trim(),
      lastDomainSnapshots: sanitizeDomainSnapshots(
        deliverability.lastDomainSnapshots ?? deliverability.last_domain_snapshots
      ),
    },
  };
}

function defaultStoredSettings(): StoredOutreachProvisioningSettings {
  const now = nowIso();
  return {
    id: SETTINGS_ID,
    config: defaultStoredConfig(),
    credentialsEncrypted: encryptJson(defaultSecrets()),
    createdAt: now,
    updatedAt: now,
  };
}

function mapStoredSettings(row: StoredOutreachProvisioningSettings): OutreachProvisioningSettings {
  const secrets = sanitizeSecrets(
    decryptJson<OutreachProvisioningSettingsSecrets>(row.credentialsEncrypted, defaultSecrets())
  );
  return {
    id: row.id,
    customerIo: {
      siteId: row.config.customerIo.siteId,
      workspaceRegion: row.config.customerIo.workspaceRegion,
      hasTrackingApiKey: Boolean(secrets.customerIoTrackingApiKey.trim()),
      hasAppApiKey: Boolean(secrets.customerIoAppApiKey.trim()),
      lastValidatedAt: row.config.customerIo.lastValidatedAt,
      lastValidatedStatus: row.config.customerIo.lastValidatedStatus,
      lastValidationMessage: row.config.customerIo.lastValidationMessage,
    },
    namecheap: {
      apiUser: row.config.namecheap.apiUser,
      userName: row.config.namecheap.userName,
      clientIp: row.config.namecheap.clientIp,
      hasApiKey: Boolean(secrets.namecheapApiKey.trim()),
      lastValidatedAt: row.config.namecheap.lastValidatedAt,
      lastValidatedStatus: row.config.namecheap.lastValidatedStatus,
      lastValidationMessage: row.config.namecheap.lastValidationMessage,
    },
    deliverability: {
      provider: row.config.deliverability.provider,
      monitoredDomains: row.config.deliverability.monitoredDomains,
      hasGoogleClientId: Boolean(secrets.deliverabilityGoogleClientId.trim()),
      hasGoogleClientSecret: Boolean(secrets.deliverabilityGoogleClientSecret.trim()),
      hasGoogleRefreshToken: Boolean(secrets.deliverabilityGoogleRefreshToken.trim()),
      lastValidatedAt: row.config.deliverability.lastValidatedAt,
      lastValidatedStatus: row.config.deliverability.lastValidatedStatus,
      lastValidationMessage: row.config.deliverability.lastValidationMessage,
      lastCheckedAt: row.config.deliverability.lastCheckedAt,
      lastHealthStatus: row.config.deliverability.lastHealthStatus,
      lastHealthScore: row.config.deliverability.lastHealthScore,
      lastHealthSummary: row.config.deliverability.lastHealthSummary,
      lastDomainSnapshots: row.config.deliverability.lastDomainSnapshots,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapProvisioningSettingsRowFromDb(input: unknown): StoredOutreachProvisioningSettings {
  const row = asRecord(input);
  return {
    id: String(row.id ?? SETTINGS_ID),
    config: sanitizeConfig(row.config),
    credentialsEncrypted: String(row.credentials_encrypted ?? row.credentialsEncrypted ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

async function readLocalSettings(): Promise<StoredOutreachProvisioningSettings | null> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf8");
    return mapProvisioningSettingsRowFromDb(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeLocalSettings(row: StoredOutreachProvisioningSettings) {
  if (!isVercel) {
    await mkdir(`${process.cwd()}/data`, { recursive: true });
  }
  await writeFile(SETTINGS_PATH, JSON.stringify(row, null, 2));
}

function supabaseErrorDebug(error: unknown) {
  const row = asRecord(error);
  const message = typeof row.message === "string" ? row.message : String(error ?? "");
  return {
    message,
    details: typeof row.details === "string" ? row.details : "",
    hint: typeof row.hint === "string" ? row.hint : "",
    code: typeof row.code === "string" ? row.code : "",
  };
}

function isMissingConfigTableError(error: unknown) {
  const dbg = supabaseErrorDebug(error);
  const combined = `${dbg.message}\n${dbg.details}`.toLowerCase();
  return combined.includes(TABLE_PROVISIONING_SETTINGS.toLowerCase()) && combined.includes("does not exist");
}

function provisioningSettingsHintForSupabaseError(error: unknown) {
  const dbg = supabaseErrorDebug(error);
  const combined = `${dbg.message}\n${dbg.details}`.toLowerCase();
  if (
    combined.includes("enotfound") ||
    combined.includes("getaddrinfo") ||
    combined.includes("fetch failed")
  ) {
    return "Supabase host is unreachable from this deployment. Verify SUPABASE_URL points at the live project URL, then redeploy.";
  }
  if (isMissingConfigTableError(error)) {
    return "Provisioning settings table is missing. Apply supabase/migrations/20260310120000_outreach_provisioning_settings.sql, then redeploy.";
  }
  return dbg.hint || "Supabase request failed. Check SUPABASE_URL, service-role permissions, and migrations.";
}

async function getStoredProvisioningSettings(): Promise<StoredOutreachProvisioningSettings | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    if (isVercel) {
      throw new OutreachDataError("Supabase is not configured for outreach storage.", {
        status: 500,
        hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables, then redeploy.",
      });
    }
    return readLocalSettings();
  }

  const { data, error } = await supabase
    .from(TABLE_PROVISIONING_SETTINGS)
    .select("*")
    .eq("id", SETTINGS_ID)
    .maybeSingle();

  if (!error && data) {
    return mapProvisioningSettingsRowFromDb(data);
  }
  if (error && isMissingConfigTableError(error)) {
    return null;
  }
  if (error && isVercel) {
    throw new OutreachDataError("Failed to load outreach provisioning settings from Supabase.", {
      status: 500,
      hint: provisioningSettingsHintForSupabaseError(error),
      debug: {
        operation: "getOutreachProvisioningSettings",
        supabaseError: supabaseErrorDebug(error),
      },
    });
  }

  return readLocalSettings();
}

export async function getOutreachProvisioningSettings(): Promise<OutreachProvisioningSettings> {
  const stored = await getStoredProvisioningSettings();
  return mapStoredSettings(stored ?? defaultStoredSettings());
}

export async function getOutreachProvisioningSettingsSecrets(): Promise<OutreachProvisioningSettingsSecrets> {
  const stored = await getStoredProvisioningSettings();
  if (!stored) return defaultSecrets();
  return sanitizeSecrets(
    decryptJson<OutreachProvisioningSettingsSecrets>(stored.credentialsEncrypted, defaultSecrets())
  );
}

export async function updateOutreachProvisioningSettings(
  patch: OutreachProvisioningSettingsPatch
): Promise<OutreachProvisioningSettings> {
  const existing = (await getStoredProvisioningSettings()) ?? defaultStoredSettings();
  const existingSecrets = sanitizeSecrets(
    decryptJson<OutreachProvisioningSettingsSecrets>(existing.credentialsEncrypted, defaultSecrets())
  );
  const nextCustomerIo = patch.customerIo ?? {};
  const nextNamecheap = patch.namecheap ?? {};
  const nextDeliverability = patch.deliverability ?? {};
  const now = nowIso();

  const nextConfig: StoredOutreachProvisioningSettings["config"] = {
    customerIo: {
      siteId:
        nextCustomerIo.siteId !== undefined ? String(nextCustomerIo.siteId).trim() : existing.config.customerIo.siteId,
      workspaceRegion:
        nextCustomerIo.workspaceRegion ?? existing.config.customerIo.workspaceRegion ?? "unknown",
      lastValidatedAt:
        nextCustomerIo.lastValidatedAt !== undefined
          ? String(nextCustomerIo.lastValidatedAt).trim()
          : existing.config.customerIo.lastValidatedAt,
      lastValidatedStatus: nextCustomerIo.lastValidatedStatus ?? existing.config.customerIo.lastValidatedStatus,
      lastValidationMessage:
        nextCustomerIo.lastValidationMessage !== undefined
          ? String(nextCustomerIo.lastValidationMessage).trim()
          : existing.config.customerIo.lastValidationMessage,
    },
    namecheap: {
      apiUser:
        nextNamecheap.apiUser !== undefined ? String(nextNamecheap.apiUser).trim() : existing.config.namecheap.apiUser,
      userName:
        nextNamecheap.userName !== undefined
          ? String(nextNamecheap.userName).trim()
          : existing.config.namecheap.userName,
      clientIp:
        nextNamecheap.clientIp !== undefined
          ? String(nextNamecheap.clientIp).trim()
          : existing.config.namecheap.clientIp,
      lastValidatedAt:
        nextNamecheap.lastValidatedAt !== undefined
          ? String(nextNamecheap.lastValidatedAt).trim()
          : existing.config.namecheap.lastValidatedAt,
      lastValidatedStatus: nextNamecheap.lastValidatedStatus ?? existing.config.namecheap.lastValidatedStatus,
      lastValidationMessage:
        nextNamecheap.lastValidationMessage !== undefined
          ? String(nextNamecheap.lastValidationMessage).trim()
          : existing.config.namecheap.lastValidationMessage,
    },
    deliverability: {
      provider:
        nextDeliverability.provider !== undefined
          ? sanitizeDeliverabilityProvider(nextDeliverability.provider)
          : existing.config.deliverability.provider,
      monitoredDomains:
        nextDeliverability.monitoredDomains !== undefined
          ? sanitizeMonitoredDomains(nextDeliverability.monitoredDomains)
          : existing.config.deliverability.monitoredDomains,
      lastValidatedAt:
        nextDeliverability.lastValidatedAt !== undefined
          ? String(nextDeliverability.lastValidatedAt).trim()
          : existing.config.deliverability.lastValidatedAt,
      lastValidatedStatus:
        nextDeliverability.lastValidatedStatus ?? existing.config.deliverability.lastValidatedStatus,
      lastValidationMessage:
        nextDeliverability.lastValidationMessage !== undefined
          ? String(nextDeliverability.lastValidationMessage).trim()
          : existing.config.deliverability.lastValidationMessage,
      lastCheckedAt:
        nextDeliverability.lastCheckedAt !== undefined
          ? String(nextDeliverability.lastCheckedAt).trim()
          : existing.config.deliverability.lastCheckedAt,
      lastHealthStatus:
        nextDeliverability.lastHealthStatus ?? existing.config.deliverability.lastHealthStatus,
      lastHealthScore:
        nextDeliverability.lastHealthScore !== undefined
          ? Number(nextDeliverability.lastHealthScore) || 0
          : existing.config.deliverability.lastHealthScore,
      lastHealthSummary:
        nextDeliverability.lastHealthSummary !== undefined
          ? String(nextDeliverability.lastHealthSummary).trim()
          : existing.config.deliverability.lastHealthSummary,
      lastDomainSnapshots:
        nextDeliverability.lastDomainSnapshots !== undefined
          ? sanitizeDomainSnapshots(nextDeliverability.lastDomainSnapshots)
          : existing.config.deliverability.lastDomainSnapshots,
    },
  };

  const nextSecrets: OutreachProvisioningSettingsSecrets = {
    customerIoTrackingApiKey:
      String(nextCustomerIo.trackingApiKey ?? "").trim() || existingSecrets.customerIoTrackingApiKey,
    customerIoAppApiKey: String(nextCustomerIo.appApiKey ?? "").trim() || existingSecrets.customerIoAppApiKey,
    namecheapApiKey: String(nextNamecheap.apiKey ?? "").trim() || existingSecrets.namecheapApiKey,
    deliverabilityGoogleClientId:
      String(nextDeliverability.googleClientId ?? "").trim() || existingSecrets.deliverabilityGoogleClientId,
    deliverabilityGoogleClientSecret:
      String(nextDeliverability.googleClientSecret ?? "").trim() || existingSecrets.deliverabilityGoogleClientSecret,
    deliverabilityGoogleRefreshToken:
      String(nextDeliverability.googleRefreshToken ?? "").trim() || existingSecrets.deliverabilityGoogleRefreshToken,
  };

  const nextStored: StoredOutreachProvisioningSettings = {
    id: existing.id,
    config: nextConfig,
    credentialsEncrypted: encryptJson(nextSecrets),
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    if (isVercel) {
      throw new OutreachDataError("Supabase is not configured for outreach storage.", {
        status: 500,
        hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables, then redeploy.",
      });
    }
    await writeLocalSettings(nextStored);
    return mapStoredSettings(nextStored);
  }

  const { data, error } = await supabase
    .from(TABLE_PROVISIONING_SETTINGS)
    .upsert(
      {
        id: nextStored.id,
        config: nextStored.config,
        credentials_encrypted: nextStored.credentialsEncrypted,
        created_at: nextStored.createdAt,
        updated_at: nextStored.updatedAt,
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();

  if (!error && data) {
    return mapStoredSettings(mapProvisioningSettingsRowFromDb(data));
  }
  if (error && isVercel) {
    throw new OutreachDataError("Failed to save outreach provisioning settings to Supabase.", {
      status: 500,
      hint: provisioningSettingsHintForSupabaseError(error),
      debug: {
        operation: "updateOutreachProvisioningSettings",
        supabaseError: supabaseErrorDebug(error),
      },
    });
  }

  await writeLocalSettings(nextStored);
  return mapStoredSettings(nextStored);
}
