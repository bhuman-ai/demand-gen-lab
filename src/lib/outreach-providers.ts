import type { OutreachAccount, OutreachMessage, ReplyDraft } from "@/lib/factory-types";
import type { OutreachAccountSecrets } from "@/lib/outreach-data";

export type ProviderTestResult = {
  ok: boolean;
  scope: ProviderTestScope;
  checks: {
    customerIo: "pass" | "fail";
    apify: "pass" | "fail";
    mailbox: "pass" | "fail";
  };
  message: string;
};

export type ProviderTestScope = "full" | "customerio" | "mailbox";

export type ApifyLead = {
  email: string;
  name: string;
  company: string;
  title: string;
  domain: string;
  sourceUrl: string;
};

export type LeadEmailSuppressionReason = "invalid_email" | "placeholder_domain" | "role_account";

const ROLE_ACCOUNT_LOCALS = new Set([
  "info",
  "hello",
  "hi",
  "support",
  "help",
  "contact",
  "team",
  "sales",
  "legal",
  "marketing",
  "admin",
  "office",
  "ops",
  "operations",
  "billing",
  "accounts",
  "careers",
  "jobs",
  "hr",
  "press",
  "media",
  "news",
  "events",
  "security",
  "privacy",
  "compliance",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
]);

const PLACEHOLDER_EMAIL_DOMAINS = new Set([
  "yourcompany.com",
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "invalid.com",
  "domain.com",
]);

function isRoleAccountLocal(local: string) {
  if (!local) return true;
  if (ROLE_ACCOUNT_LOCALS.has(local)) return true;
  for (const role of ROLE_ACCOUNT_LOCALS) {
    if (
      local.startsWith(`${role}.`) ||
      local.startsWith(`${role}_`) ||
      local.startsWith(`${role}-`) ||
      local.startsWith(`${role}+`)
    ) {
      return true;
    }
  }
  return false;
}

export function getLeadEmailSuppressionReason(email: string): LeadEmailSuppressionReason | "" {
  const normalized = email.trim().toLowerCase();
  const match = normalized.match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  if (!match) return "invalid_email";

  const local = match[1];
  const domain = match[2].replace(/\.+$/, "");
  if (PLACEHOLDER_EMAIL_DOMAINS.has(domain)) return "placeholder_domain";
  if (isRoleAccountLocal(local)) return "role_account";
  return "";
}

type LeadSourcingSearchResult = {
  ok: boolean;
  query: string;
  domains: string[];
  rawResultCount: number;
  filteredCount: number;
  error: string;
};

type LeadSourcingEmailDiscoveryRun = {
  ok: boolean;
  runId: string;
  datasetId: string;
  error: string;
};

type LeadSourcingEmailDiscoveryPoll = {
  ok: boolean;
  status: "ready" | "running" | "succeeded" | "failed";
  datasetId: string;
  error: string;
};

type LeadSourcingDatasetFetch = {
  ok: boolean;
  rows: unknown[];
  error: string;
};

function customerIoTrackBaseUrl() {
  const explicit = String(process.env.CUSTOMER_IO_TRACK_BASE_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const region = String(process.env.CUSTOMER_IO_REGION ?? "").trim().toLowerCase();
  if (region === "eu") return "https://track-eu.customer.io";

  return "https://track.customer.io";
}

function maybeDomain(email: string, fallback: string) {
  const parts = email.split("@");
  if (parts.length === 2) return parts[1].toLowerCase();
  return fallback.trim().toLowerCase();
}

function customerIoApiKey(secrets: OutreachAccountSecrets) {
  return (
    secrets.customerIoApiKey.trim() ||
    secrets.customerIoTrackApiKey.trim() ||
    secrets.customerIoAppApiKey.trim()
  );
}

async function testCustomerIoTrackCredentials(input: {
  siteId: string;
  apiKey: string;
}): Promise<{ ok: boolean; error: string; region: string; baseUrl: string }> {
  if (process.env.CUSTOMER_IO_SIMULATE === "1") {
    return { ok: true, error: "", region: "simulated", baseUrl: "simulated" };
  }

  const siteId = input.siteId.trim();
  const apiKey = input.apiKey.trim();
  if (!siteId || !apiKey) {
    return { ok: false, error: "Missing Customer.io Site ID or API key.", region: "", baseUrl: customerIoTrackBaseUrl() };
  }

  const baseUrl = customerIoTrackBaseUrl();

  async function attempt(url: string) {
    const auth = Buffer.from(`${siteId}:${apiKey}`).toString("base64");
    const response = await fetch(`${url}/api/v1/accounts/region`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      let body = "";
      try {
        body = (await response.text()).trim();
      } catch {
        body = "";
      }
      return { ok: false as const, status: response.status, body };
    }

    const payload: unknown = await response.json().catch(() => ({}));
    const row = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    const region = String(row.region ?? "").trim();
    return { ok: true as const, status: 200, region, body: "" };
  }

  try {
    const primary = await attempt(baseUrl);
    if (primary.ok) {
      return { ok: true, error: "", region: primary.region, baseUrl };
    }

    // If the account lives in the other region, try the alternate Track base URL to produce a useful hint.
    const explicitBase = String(process.env.CUSTOMER_IO_TRACK_BASE_URL ?? "").trim();
    if (!explicitBase && primary.status === 401) {
      const alternateBase =
        baseUrl === "https://track-eu.customer.io" ? "https://track.customer.io" : "https://track-eu.customer.io";
      const alternate = await attempt(alternateBase);
      if (alternate.ok) {
        return {
          ok: false,
          error: `Customer.io auth failed (HTTP 401) on ${baseUrl}, but succeeded on ${alternateBase}. Your account may be in a different region. Also confirm you used a Tracking API key (not an App API key).`,
          region: alternate.region,
          baseUrl,
        };
      }
    }

    const siteIdLooksWrong = siteId.includes("@") || siteId.includes(".") || siteId.includes(" ");
    const siteIdHint = siteIdLooksWrong
      ? " Site ID looks wrong (it should be the Site ID value, not a workspace/name)."
      : "";
    const bodyText = primary.body ? ` ${primary.body.slice(0, 160)}` : "";
    return {
      ok: false,
      error: `Customer.io auth failed (HTTP ${primary.status}) on ${baseUrl}.${bodyText}${siteIdHint} Use a Tracking API key (not an App API key).`,
      region: "",
      baseUrl,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Customer.io auth failed",
      region: "",
      baseUrl,
    };
  }
}

function sourcingToken(secrets: OutreachAccountSecrets) {
  return (
    secrets.apifyToken.trim() ||
    String(process.env.APIFY_TOKEN ?? "").trim() ||
    String(process.env.APIFY_API_TOKEN ?? "").trim() ||
    String(process.env.APIFY_API_KEY ?? "").trim()
  );
}

function normalizeApifyActorId(actorId: string) {
  const trimmed = actorId.trim();
  // Apify API expects "username~actorName". Historically we stored "username/actorName".
  if (trimmed.includes("/") && !trimmed.includes("~")) {
    const [username, actorName] = trimmed.split("/", 2);
    if (username && actorName) return `${username}~${actorName}`;
  }
  return trimmed;
}

const PLATFORM_SEARCH_ACTOR_ID = "apify~google-search-scraper";
const PLATFORM_EMAIL_DISCOVERY_ACTOR_ID =
  String(process.env.PLATFORM_EMAIL_DISCOVERY_ACTOR_ID ?? "").trim() || "9Sk4JJhEma9vBKqrg";
const PLATFORM_EMAIL_DISCOVERY_MAX_CHARGE_USD = Math.max(
  0.5,
  Math.min(25, Number(process.env.PLATFORM_EMAIL_DISCOVERY_MAX_CHARGE_USD ?? 0.5) || 0.5)
);

const BLOCKED_SEARCH_DOMAINS = new Set<string>([
  "linkedin.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "youtube.com",
  "reddit.com",
  "medium.com",
  "quora.com",
  "saastr.com",
  "glassdoor.com",
  "indeed.com",
  "angel.co",
  "wellfound.com",
  "crunchbase.com",
  "wikipedia.org",
]);

function safeHostname(input: string) {
  try {
    const url = new URL(input);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function toRegistrableDomain(hostname: string) {
  const normalized = hostname.replace(/^www\./, "").toLowerCase();
  if (!normalized) return "";
  return normalized;
}

async function apifyRunSyncGetDatasetItems(input: {
  actorId: string;
  actorInput: Record<string, unknown>;
  token: string;
  timeoutSeconds?: number;
}): Promise<{ ok: boolean; status: number; rows: unknown[]; error: string }> {
  const token = input.token.trim();
  const actorId = normalizeApifyActorId(input.actorId);
  if (!token || !actorId) {
    return { ok: false, status: 0, rows: [], error: "Missing token or actor id" };
  }

  try {
    const timeout = Math.max(10, Math.min(120, Number(input.timeoutSeconds ?? 60)));
    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
      actorId
    )}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=${timeout}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.actorInput ?? {}),
    });

    if (!response.ok) {
      let body = "";
      try {
        body = (await response.text()).trim();
      } catch {
        body = "";
      }
      return {
        ok: false,
        status: response.status,
        rows: [],
        error: `HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
      };
    }

    const payload: unknown = await response.json();
    const rows = Array.isArray(payload) ? payload : [];
    return { ok: true, status: 200, rows, error: "" };
  } catch (error) {
    return { ok: false, status: 0, rows: [], error: error instanceof Error ? error.message : "Apify request failed" };
  }
}

async function apifyStartRun(input: {
  actorId: string;
  actorInput: Record<string, unknown>;
  token: string;
  maxTotalChargeUsd?: number;
}): Promise<LeadSourcingEmailDiscoveryRun> {
  const token = input.token.trim();
  const actorId = normalizeApifyActorId(input.actorId);
  if (!token || !actorId) {
    return { ok: false, runId: "", datasetId: "", error: "Missing token or actor id" };
  }

  try {
    const maxTotalChargeUsd =
      input.maxTotalChargeUsd === undefined
        ? null
        : Math.max(0.5, Math.min(25, Number(input.maxTotalChargeUsd) || PLATFORM_EMAIL_DISCOVERY_MAX_CHARGE_USD));
    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(
      token
    )}&waitForFinish=0${maxTotalChargeUsd ? `&maxTotalChargeUsd=${encodeURIComponent(String(maxTotalChargeUsd))}` : ""}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.actorInput ?? {}),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    const row = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    const data =
      row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : row;
    const runId = String(data.id ?? "").trim();
    const datasetId = String(data.defaultDatasetId ?? data.default_dataset_id ?? "").trim();
    if (!response.ok || !runId) {
      return {
        ok: false,
        runId,
        datasetId,
        error: `HTTP ${response.status}${runId ? "" : ": Missing run id"}`,
      };
    }
    return { ok: true, runId, datasetId, error: "" };
  } catch (error) {
    return { ok: false, runId: "", datasetId: "", error: error instanceof Error ? error.message : "Apify run start failed" };
  }
}

async function apifyPollRun(input: { token: string; runId: string }): Promise<LeadSourcingEmailDiscoveryPoll> {
  const token = input.token.trim();
  const runId = input.runId.trim();
  if (!token || !runId) {
    return { ok: false, status: "failed", datasetId: "", error: "Missing token or run id" };
  }

  try {
    const url = `https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}?token=${encodeURIComponent(token)}`;
    const response = await fetch(url);
    const payload: unknown = await response.json().catch(() => ({}));
    const row = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    const data =
      row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : row;
    const statusRaw = String(data.status ?? "").trim().toUpperCase();
    const datasetId = String(data.defaultDatasetId ?? "").trim();

    if (!response.ok) {
      return { ok: false, status: "failed", datasetId, error: `HTTP ${response.status}` };
    }

    if (["READY", "RUNNING"].includes(statusRaw)) {
      return { ok: true, status: statusRaw === "READY" ? "ready" : "running", datasetId, error: "" };
    }
    if (statusRaw === "SUCCEEDED") {
      return { ok: true, status: "succeeded", datasetId, error: "" };
    }
    return { ok: false, status: "failed", datasetId, error: `Run ${statusRaw || "UNKNOWN"}` };
  } catch (error) {
    return { ok: false, status: "failed", datasetId: "", error: error instanceof Error ? error.message : "Poll failed" };
  }
}

async function apifyFetchDatasetItems(input: {
  token: string;
  datasetId: string;
  limit?: number;
}): Promise<LeadSourcingDatasetFetch> {
  const token = input.token.trim();
  const datasetId = input.datasetId.trim();
  if (!token || !datasetId) {
    return { ok: false, rows: [], error: "Missing token or dataset id" };
  }

  const limit = Math.max(1, Math.min(500, Number(input.limit ?? 200)));
  try {
    const url = `https://api.apify.com/v2/datasets/${encodeURIComponent(
      datasetId
    )}/items?token=${encodeURIComponent(token)}&clean=true&format=json&limit=${limit}`;
    const response = await fetch(url);
    if (!response.ok) {
      let body = "";
      try {
        body = (await response.text()).trim();
      } catch {
        body = "";
      }
      return { ok: false, rows: [], error: `HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}` };
    }
    const payload: unknown = await response.json();
    return { ok: true, rows: Array.isArray(payload) ? payload : [], error: "" };
  } catch (error) {
    return { ok: false, rows: [], error: error instanceof Error ? error.message : "Dataset fetch failed" };
  }
}

export async function runPlatformLeadDomainSearch(params: {
  token: string;
  query: string;
  maxResults?: number;
  excludeDomains?: string[];
}): Promise<LeadSourcingSearchResult> {
  const query = params.query.trim();
  if (!query) {
    return { ok: false, query: "", domains: [], rawResultCount: 0, filteredCount: 0, error: "Search query is empty" };
  }

  const maxResults = Math.max(5, Math.min(50, Number(params.maxResults ?? 15)));
  const exclude = new Set((params.excludeDomains ?? []).map((d) => d.replace(/^www\./, "").toLowerCase()));

  const response = await apifyRunSyncGetDatasetItems({
    actorId: PLATFORM_SEARCH_ACTOR_ID,
    token: params.token,
    timeoutSeconds: 60,
    actorInput: {
      queries: query,
      maxPagesPerQuery: 1,
      resultsPerPage: Math.min(10, maxResults),
      languageCode: "en",
    },
  });

  if (!response.ok) {
    return {
      ok: false,
      query,
      domains: [],
      rawResultCount: 0,
      filteredCount: 0,
      error: response.error || "Search failed",
    };
  }

  const firstRow =
    response.rows.find((row) => row && typeof row === "object" && !Array.isArray(row)) ??
    (response.rows.length ? response.rows[0] : null);
  const row = firstRow && typeof firstRow === "object" && !Array.isArray(firstRow) ? (firstRow as Record<string, unknown>) : {};
  const organic = Array.isArray(row.organicResults) ? (row.organicResults as unknown[]) : [];
  const rawUrls = organic
    .map((item) => {
      const r = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
      return String(r.url ?? "").trim();
    })
    .filter(Boolean);

  const domains: string[] = [];
  const seen = new Set<string>();
  let filtered = 0;
  for (const url of rawUrls) {
    const hostname = safeHostname(url);
    const domain = toRegistrableDomain(hostname);
    if (!domain) continue;

    const parts = domain.split(".");
    const root = parts.slice(-2).join(".");
    const blocked = BLOCKED_SEARCH_DOMAINS.has(domain) || BLOCKED_SEARCH_DOMAINS.has(root);
    if (blocked || exclude.has(domain) || exclude.has(root)) {
      filtered += 1;
      continue;
    }
    if (seen.has(domain)) continue;
    seen.add(domain);
    domains.push(domain);
    if (domains.length >= maxResults) break;
  }

  return {
    ok: true,
    query,
    domains,
    rawResultCount: rawUrls.length,
    filteredCount: filtered,
    error: "",
  };
}

export async function startPlatformEmailDiscovery(params: {
  token: string;
  domains: string[];
  maxRequestsPerCrawl?: number;
}): Promise<LeadSourcingEmailDiscoveryRun> {
  const domains = (params.domains ?? [])
    .map((d) => d.replace(/^www\./, "").trim().toLowerCase())
    .filter(Boolean);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const domain of domains) {
    if (seen.has(domain)) continue;
    seen.add(domain);
    unique.push(domain);
  }
  if (!unique.length) {
    return { ok: false, runId: "", datasetId: "", error: "No domains provided for email discovery" };
  }

  const maxRequestsPerCrawl = Math.max(10, Math.min(120, Number(params.maxRequestsPerCrawl ?? 40)));
  return apifyStartRun({
    actorId: PLATFORM_EMAIL_DISCOVERY_ACTOR_ID,
    token: params.token,
    maxTotalChargeUsd: PLATFORM_EMAIL_DISCOVERY_MAX_CHARGE_USD,
    actorInput: {
      startUrls: unique.map((domain) => ({ url: `https://${domain}` })),
      maxRequestsPerCrawl,
      maxConcurrency: 6,
      maxDepth: 2,
    },
  });
}

export async function pollPlatformEmailDiscovery(params: {
  token: string;
  runId: string;
}): Promise<LeadSourcingEmailDiscoveryPoll> {
  return apifyPollRun({ token: params.token, runId: params.runId });
}

export async function fetchPlatformEmailDiscoveryResults(params: {
  token: string;
  datasetId: string;
  limit?: number;
}): Promise<LeadSourcingDatasetFetch> {
  return apifyFetchDatasetItems({ token: params.token, datasetId: params.datasetId, limit: params.limit });
}

export function leadsFromEmailDiscoveryRows(rows: unknown[], maxLeads: number): ApifyLead[] {
  const limit = Math.max(1, Math.min(500, Number(maxLeads || 100)));
  const leads: ApifyLead[] = [];
  const seen = new Set<string>();

  for (const raw of rows) {
    const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const domain = String(row.domain ?? "").trim().toLowerCase();
    const sourceUrl = String(row.originalStartUrl ?? row.original_start_url ?? "").trim();
    const emailsRaw = row.emails;
    const emails = Array.isArray(emailsRaw) ? emailsRaw.map((item) => String(item ?? "").trim().toLowerCase()) : [];
    for (const email of emails) {
      if (!email || !email.includes("@")) continue;
      if (getLeadEmailSuppressionReason(email)) continue;
      if (seen.has(email)) continue;
      seen.add(email);
      leads.push({
        email,
        name: "",
        company: domain || maybeDomain(email, ""),
        title: "",
        domain: maybeDomain(email, domain),
        sourceUrl: sourceUrl || (domain ? `https://${domain}` : ""),
      });
      if (leads.length >= limit) return leads;
    }
  }

  return leads;
}

function normalizeApifyLead(raw: unknown): ApifyLead | null {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const email = String(
    row.email ?? row.workEmail ?? row.businessEmail ?? row.contactEmail ?? row.emailAddress ?? ""
  )
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) {
    return null;
  }
  if (getLeadEmailSuppressionReason(email)) {
    return null;
  }

  const name = String(row.name ?? row.fullName ?? `${row.firstName ?? ""} ${row.lastName ?? ""}`).trim();
  const company = String(row.company ?? row.companyName ?? row.organization ?? "").trim();
  const title = String(row.title ?? row.jobTitle ?? "").trim();
  const sourceUrl = String(row.url ?? row.profileUrl ?? row.linkedinUrl ?? row.website ?? "").trim();

  return {
    email,
    name,
    company,
    title,
    domain: maybeDomain(email, String(row.domain ?? "")),
    sourceUrl,
  };
}

export async function testOutreachProviders(
  account: OutreachAccount,
  secrets: OutreachAccountSecrets,
  scope: ProviderTestScope = "full"
): Promise<ProviderTestResult> {
  const requiresDelivery = account.accountType !== "mailbox";
  const requiresMailbox = account.accountType !== "delivery";
  const shouldTestCustomerIo = scope === "full" || scope === "customerio";
  const shouldTestMailbox = scope === "full" || scope === "mailbox";
  const shouldTestSourcing = scope === "full";

  const fromEmail = account.config.customerIo.fromEmail.trim();
  const rawCustomerIoPass = requiresDelivery
    ? Boolean(account.config.customerIo.siteId && customerIoApiKey(secrets) && fromEmail)
    : true;

  const rawSourcingPass = requiresDelivery ? Boolean(sourcingToken(secrets)) : true;
  const rawMailboxPass = requiresMailbox
    ? Boolean(account.config.mailbox.email && (secrets.mailboxAccessToken || secrets.mailboxPassword))
    : true;

  let customerIoPass = shouldTestCustomerIo ? rawCustomerIoPass : true;
  let customerIoDetail = "";
  if (requiresDelivery && shouldTestCustomerIo) {
    if (!rawCustomerIoPass) {
      const missing: string[] = [];
      if (!account.config.customerIo.siteId.trim()) missing.push("Site ID");
      if (!customerIoApiKey(secrets)) missing.push("API key");
      if (!fromEmail) missing.push("From Email");
      customerIoDetail = missing.length ? `Missing: ${missing.join(", ")}` : "Customer.io config missing";
      customerIoPass = false;
    } else {
      const auth = await testCustomerIoTrackCredentials({
        siteId: account.config.customerIo.siteId,
        apiKey: customerIoApiKey(secrets),
      });
      customerIoPass = auth.ok;
      if (!auth.ok) {
        customerIoDetail = auth.error;
      } else {
        const detailParts: string[] = [];
        if (auth.region) detailParts.push(`Region: ${auth.region}`);
        if (auth.baseUrl) detailParts.push(`Base: ${auth.baseUrl.replace(/^https?:\/\//, "")}`);
        customerIoDetail = detailParts.join(" · ");
      }
    }
  }

  const apifyPass = shouldTestSourcing ? rawSourcingPass : true;
  const mailboxPass = shouldTestMailbox ? rawMailboxPass : true;

  const message =
    scope === "customerio"
      ? customerIoPass
        ? customerIoDetail
          ? `Customer.io check passed. ${customerIoDetail}`
          : "Customer.io check passed"
        : customerIoDetail
          ? `Customer.io check failed. ${customerIoDetail}`
          : "Customer.io check failed"
      : scope === "mailbox"
        ? mailboxPass
          ? "Mailbox check passed"
          : "Mailbox check failed"
        : customerIoPass && apifyPass && mailboxPass
          ? "All checks passed"
          : "One or more checks failed";

  return {
    ok: customerIoPass && apifyPass && mailboxPass,
    scope,
    checks: {
      customerIo: customerIoPass ? "pass" : "fail",
      apify: apifyPass ? "pass" : "fail",
      mailbox: mailboxPass ? "pass" : "fail",
    },
    message,
  };
}

export async function sourceLeadsFromApify(params: {
  actorId: string;
  actorInput: Record<string, unknown>;
  maxLeads: number;
  token: string;
}): Promise<ApifyLead[]> {
  const token = params.token.trim();
  if (!token) {
    return [];
  }

  const actorId = normalizeApifyActorId(params.actorId);
  if (!actorId) return [];

  try {
    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
      actorId
    )}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=120`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params.actorInput ?? {}),
    });

    if (!response.ok) {
      return [];
    }

    const payload: unknown = await response.json();
    const rows = Array.isArray(payload) ? payload : [];
    const leads: ApifyLead[] = [];
    for (const row of rows) {
      const normalized = normalizeApifyLead(row);
      if (normalized) {
        leads.push(normalized);
      }
      if (leads.length >= params.maxLeads) {
        break;
      }
    }
    return leads;
  } catch {
    return [];
  }
}

export async function sendCustomerIoEvent(params: {
  account: OutreachAccount;
  secrets: OutreachAccountSecrets;
  customerId: string;
  eventName: string;
  data: Record<string, unknown>;
}): Promise<{ ok: boolean; providerMessageId: string; error: string }> {
  if (process.env.CUSTOMER_IO_SIMULATE === "1") {
    return {
      ok: true,
      providerMessageId: `sim_${Date.now().toString(36)}`,
      error: "",
    };
  }

  const siteId = params.account.config.customerIo.siteId.trim();
  const apiKey = customerIoApiKey(params.secrets);

  if (!siteId || !apiKey) {
    return {
      ok: false,
      providerMessageId: "",
      error: "Customer.io Site ID/API key missing",
    };
  }

  try {
    const auth = Buffer.from(`${siteId}:${apiKey}`).toString("base64");
    const response = await fetch(
      `${customerIoTrackBaseUrl()}/api/v1/customers/${encodeURIComponent(params.customerId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: params.eventName,
          data: params.data,
        }),
      }
    );

    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.text()).trim();
      } catch {
        detail = "";
      }
      return {
        ok: false,
        providerMessageId: "",
        error: `Customer.io HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      };
    }

    return {
      ok: true,
      providerMessageId: `cio_${Date.now().toString(36)}`,
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      providerMessageId: "",
      error: error instanceof Error ? error.message : "Customer.io send failed",
    };
  }
}

export function buildOutreachMessageBody(input: {
  brandName: string;
  experimentName: string;
  hypothesisTitle: string;
  step: number;
  recipientName: string;
}): { subject: string; body: string } {
  const name = input.recipientName || "there";
  const stepLabel = input.step === 1 ? "Intro" : input.step === 2 ? "Follow-up" : "Close-out";
  return {
    subject: `${stepLabel}: ${input.hypothesisTitle}`,
    body: `Hi ${name},\n\nRunning ${input.experimentName} for ${input.brandName}. This touch is part of ${input.hypothesisTitle}.\n\nIf relevant, reply and I can share specifics.`,
  };
}

export async function sendReplyDraftAsEvent(params: {
  draft: ReplyDraft;
  account: OutreachAccount;
  secrets: OutreachAccountSecrets;
  recipient: string;
}): Promise<{ ok: boolean; error: string }> {
  const result = await sendCustomerIoEvent({
    account: params.account,
    secrets: params.secrets,
    customerId: params.recipient,
    eventName: "factory_reply_sent",
    data: {
      draftId: params.draft.id,
      subject: params.draft.subject,
      body: params.draft.body,
    },
  });

  return {
    ok: result.ok,
    error: result.error,
  };
}

export async function sendOutreachMessage(params: {
  message: OutreachMessage;
  account: OutreachAccount;
  secrets: OutreachAccountSecrets;
  replyToEmail: string;
  recipient: string;
  runId: string;
  experimentId: string;
}): Promise<{ ok: boolean; providerMessageId: string; error: string }> {
  const fromEmail = params.account.config.customerIo.fromEmail.trim();
  const replyToEmail = params.replyToEmail.trim();
  return sendCustomerIoEvent({
    account: params.account,
    secrets: params.secrets,
    customerId: params.recipient,
    eventName: "factory_outreach_touch",
    data: {
      // Reserved properties (Customer.io track) override campaign From/To/Reply-To.
      recipient: params.recipient,
      ...(fromEmail ? { from_address: fromEmail } : {}),
      ...(replyToEmail ? { reply_to: replyToEmail } : {}),
      runId: params.runId,
      experimentId: params.experimentId,
      messageId: params.message.id,
      step: params.message.step,
      subject: params.message.subject,
      body: params.message.body,
    },
  });
}
