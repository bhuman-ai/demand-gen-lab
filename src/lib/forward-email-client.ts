const DEFAULT_FORWARD_EMAIL_API_BASE_URL = "https://api.forwardemail.net";
const DEFAULT_FORWARD_EMAIL_IMAP_HOST = "imap.forwardemail.net";

export type ForwardEmailProbeMode = "off" | "only" | "prefer";

export type ForwardEmailProbeConfig = {
  apiToken: string;
  apiBaseUrl: string;
  domain: string;
  mode: ForwardEmailProbeMode;
  targetCount: number;
  aliasPrefix: string;
  aliasTtlHours: number;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  recipients: string[];
};

export type ForwardEmailAlias = {
  id: string;
  name: string;
  email: string;
  domain: string;
};

export type ForwardEmailAliasPassword = {
  username: string;
  password: string;
};

export class ForwardEmailApiError extends Error {
  status: number;
  detail: string;

  constructor(message: string, status: number, detail: string) {
    super(message);
    this.name = "ForwardEmailApiError";
    this.status = status;
    this.detail = detail;
  }
}

function envString(name: string) {
  return String(process.env[name] ?? "").trim();
}

function envBoolean(name: string, fallback: boolean) {
  const value = envString(name).toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function envNumber(name: string, fallback: number, min: number, max: number) {
  const raw = envString(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function splitList(value: string) {
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeProbeMode(value: string): ForwardEmailProbeMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "off") return "off";
  if (normalized === "prefer") return "prefer";
  if (normalized === "only") return "only";
  return "only";
}

export function getForwardEmailProbeConfig(): ForwardEmailProbeConfig | null {
  const apiToken = envString("FORWARD_EMAIL_API_TOKEN");
  const domain = envString("FORWARD_EMAIL_PROBE_DOMAIN").toLowerCase();
  if (!apiToken || !domain) return null;

  const mode = normalizeProbeMode(envString("FORWARD_EMAIL_PROBE_MODE"));
  if (mode === "off") return null;

  return {
    apiToken,
    apiBaseUrl: envString("FORWARD_EMAIL_API_BASE_URL") || DEFAULT_FORWARD_EMAIL_API_BASE_URL,
    domain,
    mode,
    targetCount: envNumber("FORWARD_EMAIL_PROBE_TARGETS_PER_RUN", 1, 1, 10),
    aliasPrefix: envString("FORWARD_EMAIL_PROBE_ALIAS_PREFIX") || "lastb2b-probe",
    aliasTtlHours: envNumber("FORWARD_EMAIL_PROBE_TTL_HOURS", 24, 1, 24 * 30),
    imapHost: envString("FORWARD_EMAIL_IMAP_HOST") || DEFAULT_FORWARD_EMAIL_IMAP_HOST,
    imapPort: envNumber("FORWARD_EMAIL_IMAP_PORT", 993, 1, 65535),
    imapSecure: envBoolean("FORWARD_EMAIL_IMAP_SECURE", true),
    recipients: splitList(envString("FORWARD_EMAIL_PROBE_RECIPIENTS")),
  };
}

function basicAuth(token: string) {
  return `Basic ${Buffer.from(`${token}:`, "utf8").toString("base64")}`;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function toFormBody(input: Record<string, unknown>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      body.set(key, value.join(","));
      continue;
    }
    body.set(key, String(value));
  }
  return body;
}

async function forwardEmailRequest<T>(input: {
  config: Pick<ForwardEmailProbeConfig, "apiToken" | "apiBaseUrl">;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
}) {
  const method = input.method ?? "GET";
  const response = await fetch(`${normalizeBaseUrl(input.config.apiBaseUrl)}${input.path}`, {
    method,
    headers: {
      Authorization: basicAuth(input.config.apiToken),
      ...(input.body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: input.body ? toFormBody(input.body) : undefined,
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    throw new ForwardEmailApiError(
      `Forward Email API request failed: ${method} ${input.path}`,
      response.status,
      typeof payload === "string" ? payload : JSON.stringify(payload)
    );
  }
  return payload as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function mapAlias(value: unknown, domain: string): ForwardEmailAlias {
  const wrapper = asRecord(value);
  const row = asRecord(wrapper.alias ?? wrapper.data ?? wrapper.result ?? value);
  const name = firstString(row.name, row.alias, row.local_part, row.localPart).replace(/^@+/, "");
  const email = firstString(row.email, row.address, name ? `${name}@${domain}` : "");
  return {
    id: firstString(row.id, row._id, row.alias_id, name),
    name: name || email.split("@")[0] || "",
    email: email.toLowerCase(),
    domain,
  };
}

export async function getForwardEmailDomain(config: ForwardEmailProbeConfig, domain = config.domain) {
  return forwardEmailRequest<unknown>({
    config,
    path: `/v1/domains/${encodeURIComponent(domain)}`,
  });
}

export async function createForwardEmailDomain(input: {
  config: ForwardEmailProbeConfig;
  domain?: string;
  plan?: "free" | "enhanced_protection" | "team";
  catchall?: boolean | string;
}) {
  return forwardEmailRequest<unknown>({
    config: input.config,
    method: "POST",
    path: "/v1/domains",
    body: {
      domain: input.domain ?? input.config.domain,
      plan: input.plan ?? "free",
      catchall: input.catchall ?? false,
    },
  });
}

export async function verifyForwardEmailDomainRecords(config: ForwardEmailProbeConfig, domain = config.domain) {
  return forwardEmailRequest<unknown>({
    config,
    path: `/v1/domains/${encodeURIComponent(domain)}/verify-records`,
  });
}

export async function verifyForwardEmailDomainSmtp(config: ForwardEmailProbeConfig, domain = config.domain) {
  return forwardEmailRequest<unknown>({
    config,
    path: `/v1/domains/${encodeURIComponent(domain)}/verify-smtp`,
  });
}

export async function createForwardEmailAlias(input: {
  config: ForwardEmailProbeConfig;
  name: string;
  description?: string;
  labels?: string[];
  recipients?: string[];
  hasImap?: boolean;
}) {
  const payload = await forwardEmailRequest<unknown>({
    config: input.config,
    method: "POST",
    path: `/v1/domains/${encodeURIComponent(input.config.domain)}/aliases`,
    body: {
      name: input.name,
      description: input.description,
      labels: input.labels ?? ["lastb2b", "probe"],
      recipients: input.recipients ?? input.config.recipients,
      has_imap: input.hasImap ?? true,
      is_enabled: true,
    },
  });
  return mapAlias(payload, input.config.domain);
}

export async function generateForwardEmailAliasPassword(input: {
  config: ForwardEmailProbeConfig;
  aliasId: string;
}) {
  const payload = await forwardEmailRequest<unknown>({
    config: input.config,
    method: "POST",
    path: `/v1/domains/${encodeURIComponent(input.config.domain)}/aliases/${encodeURIComponent(input.aliasId)}/generate-password`,
  });
  const row = asRecord(payload);
  return {
    username: firstString(row.username, row.email),
    password: firstString(row.password, row.generated_password, row.generatedPassword),
  } satisfies ForwardEmailAliasPassword;
}

export async function deleteForwardEmailAlias(input: {
  config: ForwardEmailProbeConfig;
  aliasId: string;
}) {
  await forwardEmailRequest<unknown>({
    config: input.config,
    method: "DELETE",
    path: `/v1/domains/${encodeURIComponent(input.config.domain)}/aliases/${encodeURIComponent(input.aliasId)}`,
  });
}
