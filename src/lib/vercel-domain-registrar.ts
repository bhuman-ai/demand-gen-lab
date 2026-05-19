import type { MailpoolDomain, MailpoolDomainOwner } from "@/lib/mailpool-client";
import { transferMailpoolDomain } from "@/lib/mailpool-client";

const VERCEL_API_BASE_URL = "https://api.vercel.com";
const DEFAULT_MAX_DOMAIN_PRICE_USD = 25;

export type DomainRegistrarProvider = "vercel" | "namecheap" | "mailpool";

export type DomainRegistrantContact = {
  firstName: string;
  lastName: string;
  organizationName?: string;
  emailAddress: string;
  phone: string;
  address1: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
};

export type VercelDomainRegistrarConfig = {
  provider: "vercel";
  configured: boolean;
  token: string;
  teamId: string;
  maxPurchasePriceUsd: number;
};

export type DomainRegistrarSnapshot = {
  provider: DomainRegistrarProvider;
  configured: boolean;
  canRegisterDomains: boolean;
  canSetNameservers: boolean;
  maxPurchasePriceUsd: number;
  teamConfigured: boolean;
  missing: string[];
};

type VercelRequestOptions = {
  token: string;
  teamId?: string;
  method?: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
};

type VercelDomainPrice = {
  years: number;
  purchasePrice: number;
  renewalPrice: number;
  transferPrice: number;
};

type VercelRegistrarOrder = {
  orderId: string;
  status: string;
  domains: Array<{
    domainName: string;
    status: string;
    price?: number;
    error?: unknown;
  }>;
  error?: {
    code?: string;
    message?: string;
  };
};

export class VercelDomainRegistrarError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "VercelDomainRegistrarError";
    this.status = status;
  }
}

function stringEnv(...names: string[]) {
  for (const name of names) {
    const value = String(process.env[name] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function numberEnv(name: string, fallback: number) {
  const parsed = Number(String(process.env[name] ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function configuredProvider(): DomainRegistrarProvider {
  const raw = stringEnv("OUTREACH_DOMAIN_REGISTRAR", "OUTREACH_DOMAIN_REGISTRAR_PROVIDER").toLowerCase();
  if (raw === "namecheap" || raw === "mailpool") return raw;
  return "vercel";
}

function vercelToken() {
  return stringEnv("OUTREACH_VERCEL_API_TOKEN", "VERCEL_API_TOKEN", "VERCEL_TOKEN");
}

function vercelTeamId() {
  return stringEnv("OUTREACH_VERCEL_TEAM_ID", "VERCEL_TEAM_ID", "VERCEL_ORG_ID");
}

function parseMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactVercelError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    const text = String(payload ?? "").trim();
    return text || fallback;
  }
  const row = payload as Record<string, unknown>;
  const error = row.error && typeof row.error === "object" && !Array.isArray(row.error)
    ? (row.error as Record<string, unknown>)
    : {};
  return String(error.message ?? row.message ?? row.error ?? fallback).replace(/\s+/g, " ").trim();
}

function describeVercelOrderError(order: VercelRegistrarOrder, domain: string) {
  const domainRow = order.domains.find((entry) => normalizeDomain(entry.domainName) === normalizeDomain(domain));
  const domainError = domainRow?.error && typeof domainRow.error === "object" && !Array.isArray(domainRow.error)
    ? (domainRow.error as Record<string, unknown>)
    : {};
  const orderError = order.error ?? {};
  return String(
    domainError.message ??
      domainError.code ??
      orderError.message ??
      orderError.code ??
      `order ${order.status || "failed"}`
  )
    .replace(/\s+/g, " ")
    .trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function vercelRequest<T>(options: VercelRequestOptions): Promise<T> {
  const url = new URL(`${VERCEL_API_BASE_URL}${options.path}`);
  if (options.teamId?.trim()) {
    url.searchParams.set("teamId", options.teamId.trim());
  }
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${options.token.trim()}`,
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  const raw = await response.text();
  const payload = raw
    ? (() => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return raw;
        }
      })()
    : {};

  if (!response.ok) {
    throw new VercelDomainRegistrarError(
      `Vercel ${options.method ?? "GET"} ${options.path} failed (HTTP ${response.status}): ${compactVercelError(
        payload,
        raw
      ).slice(0, 300)}`,
      response.status
    );
  }

  return payload as T;
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function normalizeCountryCode(value: string) {
  return value.trim().toUpperCase();
}

function normalizePhoneForVercel(phone: string, country: string) {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) {
    return `+${trimmed.replace(/[^\d]/g, "")}`;
  }
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return trimmed;
  const countryCode = normalizeCountryCode(country);
  if ((countryCode === "US" || countryCode === "CA") && digits.length === 10) {
    return `+1${digits}`;
  }
  if ((countryCode === "US" || countryCode === "CA") && digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

function vercelContactInformation(registrant: DomainRegistrantContact) {
  const contact: Record<string, unknown> = {
    firstName: registrant.firstName.trim(),
    lastName: registrant.lastName.trim(),
    email: registrant.emailAddress.trim(),
    phone: normalizePhoneForVercel(registrant.phone, registrant.country),
    address1: registrant.address1.trim(),
    city: registrant.city.trim(),
    state: registrant.stateProvince.trim(),
    zip: registrant.postalCode.trim(),
    country: normalizeCountryCode(registrant.country),
  };
  const companyName = String(registrant.organizationName ?? "").trim();
  if (companyName) {
    contact.companyName = companyName;
  }
  return contact;
}

export function resolveDomainRegistrarSnapshot(): DomainRegistrarSnapshot {
  const provider = configuredProvider();
  const token = vercelToken();
  const maxPurchasePriceUsd = numberEnv("OUTREACH_VERCEL_MAX_DOMAIN_PRICE_USD", DEFAULT_MAX_DOMAIN_PRICE_USD);
  const missing = provider === "vercel" && !token ? ["OUTREACH_VERCEL_API_TOKEN"] : [];
  return {
    provider,
    configured: provider !== "vercel" || Boolean(token),
    canRegisterDomains: provider === "vercel" && Boolean(token),
    canSetNameservers: provider === "vercel" && Boolean(token),
    maxPurchasePriceUsd,
    teamConfigured: Boolean(vercelTeamId()),
    missing,
  };
}

export function resolveVercelDomainRegistrarConfig(): VercelDomainRegistrarConfig {
  return {
    provider: "vercel",
    configured: Boolean(vercelToken()),
    token: vercelToken(),
    teamId: vercelTeamId(),
    maxPurchasePriceUsd: numberEnv("OUTREACH_VERCEL_MAX_DOMAIN_PRICE_USD", DEFAULT_MAX_DOMAIN_PRICE_USD),
  };
}

export function shouldUseVercelDomainRegistrarFallback() {
  const snapshot = resolveDomainRegistrarSnapshot();
  return snapshot.provider === "vercel" && snapshot.configured;
}

export async function getVercelDomainAvailability(input: {
  token: string;
  teamId?: string;
  domain: string;
}) {
  const domain = normalizeDomain(input.domain);
  const payload = await vercelRequest<{ available: boolean }>({
    token: input.token,
    teamId: input.teamId,
    path: `/v1/registrar/domains/${encodeURIComponent(domain)}/availability`,
  });
  return Boolean(payload.available);
}

export async function getVercelDomainPrice(input: {
  token: string;
  teamId?: string;
  domain: string;
  years?: number;
}): Promise<VercelDomainPrice> {
  const domain = normalizeDomain(input.domain);
  const years = Math.max(1, Math.round(input.years ?? 1));
  const payload = await vercelRequest<Record<string, unknown>>({
    token: input.token,
    teamId: input.teamId,
    path: `/v1/registrar/domains/${encodeURIComponent(domain)}/price?years=${encodeURIComponent(String(years))}`,
  });
  return {
    years: Number(payload.years ?? years) || years,
    purchasePrice: parseMoney(payload.purchasePrice),
    renewalPrice: parseMoney(payload.renewalPrice),
    transferPrice: parseMoney(payload.transferPrice),
  };
}

export async function getVercelDomain(input: {
  token: string;
  teamId?: string;
  domain: string;
}) {
  const domain = normalizeDomain(input.domain);
  try {
    const payload = await vercelRequest<Record<string, unknown>>({
      token: input.token,
      teamId: input.teamId,
      path: `/v5/domains/${encodeURIComponent(domain)}`,
    });
    const row = payload.domain && typeof payload.domain === "object" && !Array.isArray(payload.domain)
      ? (payload.domain as Record<string, unknown>)
      : {};
    return {
      domain,
      expiresAt: Number(row.expiresAt ?? 0) || 0,
      verified: Boolean(row.verified),
      nameservers: Array.isArray(row.nameservers) ? row.nameservers.map((entry) => String(entry ?? "")) : [],
      customNameservers: Array.isArray(row.customNameservers)
        ? row.customNameservers.map((entry) => String(entry ?? ""))
        : [],
    };
  } catch (error) {
    if (error instanceof VercelDomainRegistrarError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function buyVercelDomain(input: {
  token: string;
  teamId?: string;
  domain: string;
  registrant: DomainRegistrantContact;
  expectedPrice: number;
  years?: number;
}) {
  const domain = normalizeDomain(input.domain);
  const years = Math.max(1, Math.round(input.years ?? 1));
  return vercelRequest<{ orderId: string }>({
    token: input.token,
    teamId: input.teamId,
    method: "POST",
    path: `/v1/registrar/domains/${encodeURIComponent(domain)}/buy`,
    body: {
      autoRenew: true,
      years,
      expectedPrice: input.expectedPrice,
      contactInformation: vercelContactInformation(input.registrant),
    },
  });
}

export async function getVercelRegistrarOrder(input: {
  token: string;
  teamId?: string;
  orderId: string;
}) {
  return vercelRequest<VercelRegistrarOrder>({
    token: input.token,
    teamId: input.teamId,
    path: `/v1/registrar/orders/${encodeURIComponent(input.orderId.trim())}`,
  });
}

async function waitForVercelRegistrarOrder(input: {
  token: string;
  teamId?: string;
  orderId: string;
  domain: string;
  timeoutMs?: number;
}) {
  const startedAt = Date.now();
  const timeoutMs = Math.max(1000, input.timeoutMs ?? 30000);
  let latest: VercelRegistrarOrder | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await getVercelRegistrarOrder({
      token: input.token,
      teamId: input.teamId,
      orderId: input.orderId,
    });
    const domainRow = latest.domains.find((entry) => normalizeDomain(entry.domainName) === normalizeDomain(input.domain));
    if (latest.status === "completed" && domainRow?.status === "completed") {
      return latest;
    }
    if (latest.status === "failed" || domainRow?.status === "failed") {
      throw new Error(`Vercel domain order ${input.orderId} failed for ${input.domain}: ${describeVercelOrderError(latest, input.domain)}`);
    }
    await sleep(750);
  }
  throw new Error(
    `Vercel domain order ${input.orderId} for ${input.domain} did not complete within ${timeoutMs}ms${
      latest?.status ? `; latest status was ${latest.status}` : ""
    }.`
  );
}

async function ensureVercelDomainPurchased(input: {
  token: string;
  teamId?: string;
  domain: string;
  registrant: DomainRegistrantContact;
  maxPurchasePriceUsd: number;
}) {
  const existing = await getVercelDomain({
    token: input.token,
    teamId: input.teamId,
    domain: input.domain,
  });
  if (existing?.expiresAt) {
    return {
      orderId: "",
      price: { years: 1, purchasePrice: 0, renewalPrice: 0, transferPrice: 0 },
      existing,
    };
  }

  const available = await getVercelDomainAvailability({
    token: input.token,
    teamId: input.teamId,
    domain: input.domain,
  });
  if (!available) {
    throw new Error(`Vercel says ${input.domain} is not available to register, and it is not already owned in this Vercel team.`);
  }

  const price = await getVercelDomainPrice({
    token: input.token,
    teamId: input.teamId,
    domain: input.domain,
    years: 1,
  });
  if (price.purchasePrice <= 0) {
    throw new Error(`Vercel did not return a usable purchase price for ${input.domain}.`);
  }
  if (price.purchasePrice > input.maxPurchasePriceUsd) {
    throw new Error(
      `Vercel price for ${input.domain} is ${price.purchasePrice}, above the active max domain purchase guardrail ${input.maxPurchasePriceUsd}.`
    );
  }

  const order = await buyVercelDomain({
    token: input.token,
    teamId: input.teamId,
    domain: input.domain,
    registrant: input.registrant,
    expectedPrice: price.purchasePrice,
    years: price.years,
  });
  const orderId = String(order.orderId ?? "").trim();
  if (!orderId) {
    throw new Error(`Vercel domain purchase for ${input.domain} did not return an order id.`);
  }
  await waitForVercelRegistrarOrder({
    token: input.token,
    teamId: input.teamId,
    orderId,
    domain: input.domain,
  });

  const purchased = await getVercelDomain({
    token: input.token,
    teamId: input.teamId,
    domain: input.domain,
  });
  if (!purchased?.expiresAt) {
    throw new Error(`Vercel order ${orderId} completed, but ${input.domain} is not visible in the Vercel domain inventory yet.`);
  }
  return { orderId, price, existing: purchased };
}

export async function setVercelDomainNameservers(input: {
  token: string;
  teamId?: string;
  domain: string;
  nameservers: string[];
}) {
  const domain = normalizeDomain(input.domain);
  const nameservers = input.nameservers
    .map((entry) => String(entry ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (!nameservers.length) {
    throw new Error("Vercel nameserver update requires at least one nameserver.");
  }
  await vercelRequest<Record<string, unknown>>({
    token: input.token,
    teamId: input.teamId,
    method: "PATCH",
    path: `/v1/registrar/domains/${encodeURIComponent(domain)}/nameservers`,
    body: { nameservers },
  });
  return { domain, nameservers };
}

export async function testVercelDomainRegistrarConnection(): Promise<{
  ok: boolean;
  message: string;
  details: Record<string, unknown>;
}> {
  const config = resolveVercelDomainRegistrarConfig();
  if (!config.token) {
    return {
      ok: false,
      message: "Vercel registrar is missing OUTREACH_VERCEL_API_TOKEN.",
      details: resolveDomainRegistrarSnapshot(),
    };
  }
  const available = await getVercelDomainAvailability({
    token: config.token,
    teamId: config.teamId,
    domain: "example.com",
  });
  return {
    ok: true,
    message: "Vercel Registrar API is reachable.",
    details: {
      provider: "vercel",
      teamConfigured: Boolean(config.teamId),
      maxPurchasePriceUsd: config.maxPurchasePriceUsd,
      exampleComAvailable: available,
    },
  };
}

export async function buyVercelDomainAndAttachToMailpool(input: {
  mailpoolApiKey: string;
  domain: string;
  registrant: DomainRegistrantContact;
  redirectUrl?: string;
  domainOwner: MailpoolDomainOwner;
  existingMailpoolDomain?: MailpoolDomain | null;
  maxPurchasePriceUsd?: number;
}): Promise<{ domain: MailpoolDomain; orderId: string; price: VercelDomainPrice; nameservers: string[] }> {
  const config = resolveVercelDomainRegistrarConfig();
  if (!config.token) {
    throw new Error("Vercel registrar fallback is configured, but OUTREACH_VERCEL_API_TOKEN is missing.");
  }

  const domain = normalizeDomain(input.domain);
  const maxPurchasePriceUsd =
    typeof input.maxPurchasePriceUsd === "number" &&
    Number.isFinite(input.maxPurchasePriceUsd) &&
    input.maxPurchasePriceUsd > 0
      ? Math.min(config.maxPurchasePriceUsd, Number(input.maxPurchasePriceUsd))
      : config.maxPurchasePriceUsd;
  const purchase = await ensureVercelDomainPurchased({
    token: config.token,
    teamId: config.teamId,
    domain,
    registrant: input.registrant,
    maxPurchasePriceUsd,
  });

  const mailpoolDomain = input.existingMailpoolDomain?.domain === domain
    ? input.existingMailpoolDomain
    : await transferMailpoolDomain({
        apiKey: input.mailpoolApiKey,
        domain,
        redirectUrl: input.redirectUrl,
        domainOwner: input.domainOwner,
      });
  const nameservers = mailpoolDomain.nameservers ?? [];
  if (nameservers.length) {
    await setVercelDomainNameservers({
      token: config.token,
      teamId: config.teamId,
      domain,
      nameservers,
    });
  }

  return {
    domain: mailpoolDomain,
    orderId: purchase.orderId,
    price: purchase.price,
    nameservers,
  };
}
