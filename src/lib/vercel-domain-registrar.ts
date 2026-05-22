import type { ProvisionSenderInput } from "@/lib/outreach-provisioning";

const VERCEL_API_BASE_URL = "https://api.vercel.com";
const DEFAULT_MAX_DOMAIN_PRICE_USD = 20;

type VercelRequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  path: string;
  token: string;
  teamId?: string;
  body?: unknown;
};

export type VercelDomainContact = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  companyName?: string;
};

export type VercelDomainPurchaseResult = {
  domain: string;
  orderId: string;
  purchasePrice: number;
  years: number;
  alreadyOwned: boolean;
};

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

function envNumber(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function envBoolean(name: string, fallback = false) {
  const normalized = asString(process.env[name]).toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/^\.+|\.+$/g, "");
}

function normalizeCountry(value: string) {
  const normalized = value.trim().toUpperCase();
  if (["USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(normalized)) return "US";
  return normalized.length === 2 ? normalized : normalized.slice(0, 2);
}

function normalizeUsPhone(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) return trimmed.replace(/[^\d+]/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed;
}

function queryString(teamId?: string) {
  const query = new URLSearchParams();
  const resolvedTeamId = asString(teamId ?? process.env.OUTREACH_VERCEL_TEAM_ID);
  if (resolvedTeamId) query.set("teamId", resolvedTeamId);
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

async function vercelRequest<T>(options: VercelRequestOptions): Promise<T> {
  const response = await fetch(
    `${VERCEL_API_BASE_URL}${options.path}${queryString(options.teamId)}`,
    {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${options.token.trim()}`,
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    }
  );
  const raw = await response.text();
  const payload = raw
    ? (() => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return raw as unknown;
        }
      })()
    : null;
  if (!response.ok) {
    const record = asRecord(payload);
    const message = asString(record.error) || asString(record.message) || asString(raw);
    throw new Error(
      `Vercel ${options.method ?? "GET"} ${options.path} failed (HTTP ${response.status})${
        message ? `: ${message.slice(0, 300)}` : ""
      }`
    );
  }
  return payload as T;
}

function getVercelToken() {
  return (
    asString(process.env.OUTREACH_VERCEL_API_TOKEN) ||
    asString(process.env.VERCEL_API_TOKEN) ||
    asString(process.env.VERCEL_TOKEN)
  );
}

export function getVercelRegistrarMode() {
  const normalized = asString(process.env.OUTREACH_DOMAIN_REGISTRAR).toLowerCase();
  if (["vercel", "auto", "mailpool"].includes(normalized)) {
    return normalized as "vercel" | "auto" | "mailpool";
  }
  return getVercelToken() ? "auto" : "mailpool";
}

export function buildVercelDomainContact(
  registrant: NonNullable<ProvisionSenderInput["registrant"]>
): VercelDomainContact {
  return {
    firstName: registrant.firstName.trim(),
    lastName: registrant.lastName.trim(),
    email: registrant.emailAddress.trim(),
    phone: normalizeUsPhone(registrant.phone),
    address1: registrant.address1.trim(),
    city: registrant.city.trim(),
    state: registrant.stateProvince.trim(),
    zip: registrant.postalCode.trim(),
    country: normalizeCountry(registrant.country),
    companyName: asString(registrant.organizationName) || undefined,
  };
}

export async function getVercelDomain(domain: string) {
  const token = getVercelToken();
  if (!token) return null;
  try {
    const payload = await vercelRequest<unknown>({
      token,
      path: `/v5/domains/${encodeURIComponent(normalizeDomain(domain))}`,
    });
    const row = asRecord(asRecord(payload).domain);
    return {
      name: asString(row.name).toLowerCase(),
      registrar: asString(row.registrar),
      nameservers: asArray(row.nameservers).map((entry) => asString(entry).toLowerCase()).filter(Boolean),
      customNameservers: asArray(row.customNameservers)
        .map((entry) => asString(entry).toLowerCase())
        .filter(Boolean),
      verified: Boolean(row.verified),
      boughtAt: Number(row.boughtAt ?? 0) || 0,
      expiresAt: Number(row.expiresAt ?? 0) || 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("HTTP 404")) return null;
    throw error;
  }
}

export async function getVercelDomainAvailability(domain: string) {
  const token = getVercelToken();
  if (!token) {
    throw new Error("Vercel API token is not configured.");
  }
  const payload = await vercelRequest<unknown>({
    token,
    path: `/v1/registrar/domains/${encodeURIComponent(normalizeDomain(domain))}/availability`,
  });
  return Boolean(asRecord(payload).available);
}

export async function getVercelDomainPrice(domain: string) {
  const token = getVercelToken();
  if (!token) {
    throw new Error("Vercel API token is not configured.");
  }
  const payload = await vercelRequest<unknown>({
    token,
    path: `/v1/registrar/domains/${encodeURIComponent(normalizeDomain(domain))}/price`,
  });
  const row = asRecord(payload);
  return {
    years: Math.max(1, Math.round(Number(row.years ?? 1) || 1)),
    purchasePrice: Number(row.purchasePrice ?? 0) || 0,
    renewalPrice: Number(row.renewalPrice ?? 0) || 0,
    transferPrice: Number(row.transferPrice ?? 0) || 0,
  };
}

export async function ensureVercelRegisteredDomain(input: {
  domain: string;
  registrant: NonNullable<ProvisionSenderInput["registrant"]>;
}): Promise<VercelDomainPurchaseResult> {
  const domain = normalizeDomain(input.domain);
  const token = getVercelToken();
  if (!token) {
    throw new Error("Vercel API token is not configured.");
  }

  const existing = await getVercelDomain(domain);
  if (existing?.name === domain) {
    return {
      domain,
      orderId: "",
      purchasePrice: 0,
      years: 0,
      alreadyOwned: true,
    };
  }

  const available = await getVercelDomainAvailability(domain);
  if (!available) {
    throw new Error(`${domain} is not available through Vercel and is not already in this Vercel account.`);
  }

  const price = await getVercelDomainPrice(domain);
  const maxPrice = envNumber(
    "OUTREACH_VERCEL_MAX_DOMAIN_PRICE_USD",
    DEFAULT_MAX_DOMAIN_PRICE_USD,
    1,
    1000
  );
  if (!price.purchasePrice || price.purchasePrice > maxPrice) {
    throw new Error(
      `Vercel price guard blocked ${domain}: $${price.purchasePrice || 0} exceeds max $${maxPrice}.`
    );
  }

  const payload = await vercelRequest<unknown>({
    token,
    method: "POST",
    path: `/v1/registrar/domains/${encodeURIComponent(domain)}/buy`,
    body: {
      autoRenew: envBoolean("OUTREACH_VERCEL_DOMAIN_AUTO_RENEW", false),
      years: price.years,
      expectedPrice: price.purchasePrice,
      contactInformation: buildVercelDomainContact(input.registrant),
    },
  });
  const orderId = asString(asRecord(payload).orderId);
  if (!orderId) {
    throw new Error("Vercel domain purchase did not return an order ID.");
  }

  return {
    domain,
    orderId,
    purchasePrice: price.purchasePrice,
    years: price.years,
    alreadyOwned: false,
  };
}

export async function updateVercelDomainNameservers(input: {
  domain: string;
  nameservers: string[];
}) {
  const domain = normalizeDomain(input.domain);
  const nameservers = input.nameservers
    .map((entry) => asString(entry).toLowerCase())
    .filter(Boolean);
  if (!nameservers.length) {
    return {
      updated: false,
      reason: "No nameservers were provided.",
    };
  }
  const token = getVercelToken();
  if (!token) {
    throw new Error("Vercel API token is not configured.");
  }
  await vercelRequest<unknown>({
    token,
    method: "PATCH",
    path: `/v1/registrar/domains/${encodeURIComponent(domain)}/nameservers`,
    body: { nameservers },
  });
  return {
    updated: true,
    nameservers,
  };
}
