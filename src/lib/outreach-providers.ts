import nodemailer from "nodemailer";
import type {
  LeadAcceptanceDecision,
  LeadQualityPolicy,
  OutreachAccount,
  OutreachMessage,
  ReplyDraft,
} from "@/lib/factory-types";
import {
  getOutreachAccountFromEmail,
  getOutreachAccountReplyToEmail,
  supportsMailpoolDelivery,
} from "@/lib/outreach-account-helpers";
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
  realVerifiedEmail?: boolean;
};

export type ApifyStoreActor = {
  actorId: string;
  title: string;
  description: string;
  categories: string[];
  users30Days: number;
  rating: number;
  pricingModel: string;
  pricePerUnitUsd: number;
  trialMinutes: number;
};

export type EmailFinderVerificationMode = "validatedmails";

export type EmailFinderBatchEnrichmentResult = {
  ok: boolean;
  leads: ApifyLead[];
  attempted: number;
  matched: number;
  failed: number;
  provider: string;
  error: string;
  failureSummary: Array<{ reason: string; count: number }>;
  failedSamples: Array<{
    id: string;
    name: string;
    domain: string;
    reason: string;
    error: string;
    topAttemptEmail: string;
    topAttemptVerdict: string;
    topAttemptConfidence: string;
    topAttemptReason: string;
  }>;
};

export type ApifyActorSchemaProfile = {
  actorId: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredKeys: string[];
  knownKeys: string[];
  supportsRunSync: boolean;
};

export type ActorCompatibilityDecision = {
  ok: boolean;
  missingRequired: string[];
  score: number;
  reason: string;
};

export type LeadQualityDecision = LeadAcceptanceDecision;

export type LeadEmailSuppressionReason = "invalid_email" | "placeholder_domain" | "role_account";
const PREVIEW_PLACEHOLDER_EMAIL_PREFIX = "preview-missing-email+";

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
  "pr",
  "media",
  "news",
  "events",
  "security",
  "privacy",
  "compliance",
  "dpo",
  "gdpr",
  "datarequest",
  "success",
  "customersuccess",
  "customer-success",
  "customer_success",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
]);

const PLACEHOLDER_EMAIL_DOMAINS = new Set([
  "yourcompany.com",
  "example.com",
  "example.io",
  "example.org",
  "example.net",
  "company.com",
  "test.com",
  "invalid.com",
  "domain.com",
]);

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "yandex.com",
  "mail.com",
  "zoho.com",
  "qq.com",
  "163.com",
  "126.com",
]);

const NON_COMPANY_PROFILE_DOMAIN_ROOTS = new Set([
  "linkedin.com",
  "linkedin.co",
  "facebook.com",
  "x.com",
  "twitter.com",
  "instagram.com",
  "malt.com",
  "malt.fr",
  "malt.uk",
  "freelancermap.de",
  "freelancermap.com",
  "theorg.com",
  "twine.net",
]);

const STRICT_EMAIL_PATTERN = /^([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i;
const EMBEDDED_EMAIL_PATTERN = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;

export function isPreviewPlaceholderEmail(email: string) {
  return extractFirstEmailAddress(email).startsWith(PREVIEW_PLACEHOLDER_EMAIL_PREFIX);
}

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
  const compact = local.replace(/[._+-]/g, "");
  const heuristics = [
    "support",
    "legal",
    "info",
    "contact",
    "billing",
    "security",
    "privacy",
    "compliance",
    "gdpr",
    "dpo",
    "datarequest",
    "noreply",
    "donotreply",
    "helpdesk",
    "customersuccess",
  ];
  for (const token of heuristics) {
    if (compact === token) return true;
    if (compact.startsWith(token) || compact.endsWith(token)) return true;
    if (compact.includes(token) && compact.length - token.length <= 3) return true;
  }
  return false;
}

function isNonCompanyProfileDomain(domain: string) {
  const normalized = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.+$/, "");
  if (!normalized) return false;
  for (const root of NON_COMPANY_PROFILE_DOMAIN_ROOTS) {
    if (normalized === root || normalized.endsWith(`.${root}`)) return true;
  }
  return false;
}

export function getLeadEmailSuppressionReason(email: string): LeadEmailSuppressionReason | "" {
  const normalized = email.trim().toLowerCase();
  if (normalized.startsWith(PREVIEW_PLACEHOLDER_EMAIL_PREFIX)) return "invalid_email";
  const match = normalized.match(STRICT_EMAIL_PATTERN);
  if (!match) return "invalid_email";

  const local = match[1];
  const domain = match[2].replace(/\.+$/, "");
  if (PLACEHOLDER_EMAIL_DOMAINS.has(domain) || isNonCompanyProfileDomain(domain)) return "placeholder_domain";
  if (isRoleAccountLocal(local)) return "role_account";
  return "";
}

export function extractFirstEmailAddress(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const direct = raw.toLowerCase().match(STRICT_EMAIL_PATTERN);
  if (direct) {
    return `${direct[1]}@${direct[2].replace(/\.+$/, "").toLowerCase()}`;
  }

  const embedded = raw.match(EMBEDDED_EMAIL_PATTERN);
  if (!embedded) return "";

  const candidate = String(embedded[1] ?? "").trim().toLowerCase();
  const strict = candidate.match(STRICT_EMAIL_PATTERN);
  if (!strict) return "";
  return `${strict[1]}@${strict[2].replace(/\.+$/, "").toLowerCase()}`;
}

function inferNameFromEmail(email: string) {
  const normalized = String(email ?? "").trim().toLowerCase();
  const local = normalized.split("@")[0] ?? "";
  if (!local || isRoleAccountLocal(local)) return "";
  if (/[0-9]{3,}/.test(local)) return "";

  const cleaned = local.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const tokens = cleaned
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && /^[a-z]+$/.test(token));
  if (!tokens.length || tokens.length > 3) return "";

  return tokens
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function inferCompanyFromDomain(input: string) {
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return "";
  const domain = raw.includes("@") ? raw.split("@")[1] ?? "" : raw;
  const normalized = domain.replace(/^www\./, "");
  if (!normalized || isLikelyFreeDomain(normalized) || isNonCompanyProfileDomain(normalized)) return "";
  const root = normalized.split(".")[0] ?? "";
  if (!root || root.length < 2) return "";
  if (["mail", "smtp", "mx", "email", "contact"].includes(root)) return "";

  return root
    .replace(/[-_]+/g, " ")
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
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

type ApifyStoreSearchResult = {
  ok: boolean;
  query: string;
  total: number;
  actors: ApifyStoreActor[];
  error: string;
};

function customerIoTrackBaseUrl() {
  const explicit = String(process.env.CUSTOMER_IO_TRACK_BASE_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const region = String(process.env.CUSTOMER_IO_REGION ?? "").trim().toLowerCase();
  if (region === "eu") return "https://track-eu.customer.io";

  return "https://track.customer.io";
}

function customerIoAppBaseUrl() {
  const explicit = String(process.env.CUSTOMER_IO_APP_BASE_URL ?? "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const region = String(process.env.CUSTOMER_IO_REGION ?? "").trim().toLowerCase();
  if (region === "eu") return "https://api-eu.customer.io/v1";

  return "https://api.customer.io/v1";
}

function configuredCustomerIoRegion(): "eu" | "us" | "unknown" {
  const explicitAppBase = String(process.env.CUSTOMER_IO_APP_BASE_URL ?? "").trim().toLowerCase();
  if (explicitAppBase.includes("api-eu.customer.io")) return "eu";
  if (explicitAppBase.includes("api.customer.io")) return "us";

  const explicitTrackBase = String(process.env.CUSTOMER_IO_TRACK_BASE_URL ?? "").trim().toLowerCase();
  if (explicitTrackBase.includes("track-eu.customer.io")) return "eu";
  if (explicitTrackBase.includes("track.customer.io")) return "us";

  const region = String(process.env.CUSTOMER_IO_REGION ?? "").trim().toLowerCase();
  if (region === "eu" || region === "us") return region;

  return "unknown";
}

function customerIoAppBaseUrls() {
  const explicit = String(process.env.CUSTOMER_IO_APP_BASE_URL ?? "").trim();
  if (explicit) return [explicit.replace(/\/+$/, "")];

  const preferredRegion = configuredCustomerIoRegion();
  const ordered =
    preferredRegion === "eu"
      ? ["https://api-eu.customer.io/v1", "https://api.customer.io/v1"]
      : preferredRegion === "us"
        ? ["https://api.customer.io/v1", "https://api-eu.customer.io/v1"]
        : [customerIoAppBaseUrl(), "https://api-eu.customer.io/v1", "https://api.customer.io/v1"];

  return Array.from(new Set(ordered.map((value) => value.replace(/\/+$/, ""))));
}

function maybeDomain(email: string, fallback: string) {
  const parts = email.split("@");
  if (parts.length === 2) return parts[1].toLowerCase();
  return fallback.trim().toLowerCase();
}

function parseSchemaRequiredKeys(schema: Record<string, unknown>) {
  const asObject = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const keyPrefixJoin = (prefix: string, key: string) => (prefix ? `${prefix}.${key}` : key);
  const collectVariants = (row: Record<string, unknown>) => {
    const variants: Record<string, unknown>[] = [row];
    for (const key of ["allOf", "anyOf", "oneOf"] as const) {
      const branch = row[key];
      if (!Array.isArray(branch)) continue;
      for (const item of branch) {
        const itemObj = asObject(item);
        if (itemObj) variants.push(itemObj);
      }
    }
    return variants;
  };
  const propertiesOf = (row: Record<string, unknown>) => {
    const properties = asObject(row.properties) ?? {};
    const keys = Object.keys(properties);
    if (
      keys.length === 1 &&
      keys[0] === "input" &&
      asObject(properties.input) &&
      (asObject(properties.input)?.properties || Array.isArray(asObject(properties.input)?.required))
    ) {
      return asObject(properties.input) ?? {};
    }
    return row;
  };

  const visited = new Set<string>();
  const required = new Set<string>();
  const walk = (raw: unknown, prefix = "") => {
    const base = asObject(raw);
    if (!base) return;
    const row = propertiesOf(base);
    const variants = collectVariants(row);
    for (const variant of variants) {
      const key = JSON.stringify(variant);
      if (visited.has(`${prefix}:${key}`)) continue;
      visited.add(`${prefix}:${key}`);

      if (Array.isArray(variant.required)) {
        for (const value of variant.required) {
          const requiredKey = String(value ?? "").trim();
          if (!requiredKey) continue;
          required.add(keyPrefixJoin(prefix, requiredKey));
        }
      }

      const properties = asObject(variant.properties) ?? {};
      for (const [propKey, propSchemaRaw] of Object.entries(properties)) {
        const propSchema = asObject(propSchemaRaw);
        if (!propSchema) continue;
        const fullKey = keyPrefixJoin(prefix, propKey.trim());
        if (!fullKey) continue;
        if (propSchema.required === true) {
          required.add(fullKey);
        }
        if (propSchema.properties || Array.isArray(propSchema.required) || propSchema.allOf || propSchema.anyOf || propSchema.oneOf) {
          walk(propSchema, fullKey);
        }
      }
    }
  };

  walk(schema, "");
  return Array.from(required);
}

function flattenSchemaKeys(schema: Record<string, unknown>) {
  const asObject = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const keyPrefixJoin = (prefix: string, key: string) => (prefix ? `${prefix}.${key}` : key);
  const collectVariants = (row: Record<string, unknown>) => {
    const variants: Record<string, unknown>[] = [row];
    for (const key of ["allOf", "anyOf", "oneOf"] as const) {
      const branch = row[key];
      if (!Array.isArray(branch)) continue;
      for (const item of branch) {
        const itemObj = asObject(item);
        if (itemObj) variants.push(itemObj);
      }
    }
    return variants;
  };
  const propertiesOf = (row: Record<string, unknown>) => {
    const properties = asObject(row.properties) ?? {};
    const keys = Object.keys(properties);
    if (
      keys.length === 1 &&
      keys[0] === "input" &&
      asObject(properties.input) &&
      (asObject(properties.input)?.properties || Array.isArray(asObject(properties.input)?.required))
    ) {
      return asObject(properties.input) ?? {};
    }
    return row;
  };

  const seen = new Set<string>();
  const walk = (raw: unknown, prefix = "") => {
    const base = asObject(raw);
    if (!base) return;
    const row = propertiesOf(base);
    const variants = collectVariants(row);
    for (const variant of variants) {
      const properties = asObject(variant.properties) ?? {};
      for (const [propKey, propSchemaRaw] of Object.entries(properties)) {
        const fullKey = keyPrefixJoin(prefix, propKey.trim());
        if (!fullKey) continue;
        seen.add(fullKey);
        const propSchema = asObject(propSchemaRaw);
        if (!propSchema) continue;
        if (propSchema.properties || Array.isArray(propSchema.required) || propSchema.allOf || propSchema.anyOf || propSchema.oneOf) {
          walk(propSchema, fullKey);
        }
      }
    }
  };

  walk(schema, "");
  return Array.from(seen);
}

function extractApifyErrorDetail(raw: string, payload: unknown) {
  const firstReadable = (value: unknown, depth = 0): string => {
    if (depth > 4 || value === null || value === undefined) return "";
    if (typeof value === "string") {
      const normalized = value.replace(/\s+/g, " ").trim();
      return normalized && normalized !== "[object Object]" ? normalized : "";
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const resolved = firstReadable(item, depth + 1);
        if (resolved) return resolved;
      }
      return "";
    }
    if (typeof value === "object") {
      const row = value as Record<string, unknown>;
      const preferredKeys = [
        "message",
        "error",
        "description",
        "detail",
        "statusMessage",
        "userMessage",
        "title",
        "hint",
        "reason",
      ];
      for (const key of preferredKeys) {
        if (!(key in row)) continue;
        const resolved = firstReadable(row[key], depth + 1);
        if (resolved) return resolved;
      }
      for (const value of Object.values(row)) {
        const resolved = firstReadable(value, depth + 1);
        if (resolved) return resolved;
      }
      return "";
    }
    return "";
  };

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const root = payload as Record<string, unknown>;
    const data =
      root.data && typeof root.data === "object" && !Array.isArray(root.data)
        ? (root.data as Record<string, unknown>)
        : {};
    const hints = [root.error, root.message, data.error, data.message, data.description, data.statusMessage, data.userMessage]
      .map((value) => firstReadable(value))
      .filter(Boolean);
    if (hints.length) return hints[0];
  }
  const normalizedRaw = raw.trim();
  if (!normalizedRaw) return "";
  if (normalizedRaw.startsWith("{") || normalizedRaw.startsWith("[")) {
    try {
      const parsed = JSON.parse(normalizedRaw) as unknown;
      const fromParsed = firstReadable(parsed);
      if (fromParsed) return fromParsed.slice(0, 280);
    } catch {
      // ignore parse errors and return raw text below
    }
  }
  return normalizedRaw.replace(/\s+/g, " ").slice(0, 280);
}

function isLikelyRoleInbox(local: string) {
  return isRoleAccountLocal(local);
}

function isLikelyFreeDomain(domain: string) {
  return FREE_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

function isLikelyHumanName(name: string) {
  const normalized = String(name ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  if (normalized.length > 80) return false;
  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return false;
  const roleLikeTokens = new Set([
    "team",
    "support",
    "sales",
    "marketing",
    "legal",
    "security",
    "privacy",
    "compliance",
    "contact",
    "admin",
    "operations",
    "ops",
    "success",
    "customer",
    "service",
    "services",
    "desk",
    "inbox",
    "mailbox",
  ]);
  let alphaTokenCount = 0;
  for (const token of tokens) {
    const cleaned = token.toLowerCase().replace(/[^a-z'-]/g, "");
    if (!cleaned) continue;
    if (cleaned.length < 2) return false;
    if (roleLikeTokens.has(cleaned)) return false;
    if (/^[a-z]+$/i.test(cleaned)) alphaTokenCount += 1;
  }
  return alphaTokenCount >= 1;
}

function compactText(value: unknown, max = 220) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function coerceRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function resolveEmailFinderApiBaseUrl(explicit?: string) {
  const internalHost = String(
    process.env.EMAIL_FINDER_INTERNAL_HOST ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      process.env.VERCEL_PROJECT_PRODUCTION_URL ??
      process.env.VERCEL_URL ??
      ""
  )
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const internalBaseUrl = internalHost
    ? `https://${internalHost}/api/internal/email-finder`
    : "";
  const candidates = [
    explicit,
    process.env.EMAIL_FINDER_API_BASE_URL,
    process.env.EMAIL_FINDER_BASE_URL,
    process.env.NEXT_PUBLIC_EMAIL_FINDER_API_BASE_URL,
    process.env.EMAIL_FINDER_URL,
    internalBaseUrl,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate ?? "")
      .trim()
      .replace(/\/+$/, "");
    if (normalized) return normalized;
  }

  return "";
}

function parseEmailFinderBestGuessEmail(
  result: unknown,
  options: {
    allowBestGuessFallback?: boolean;
    minFallbackPValid?: number;
  } = {}
) {
  const root = coerceRecord(result);
  const routing = coerceRecord(root.routing);
  const queues = coerceRecord(routing.queues);
  const eligible = Array.isArray(queues.eligible_send_now) ? queues.eligible_send_now : [];
  const risky = Array.isArray(queues.risky_queue) ? queues.risky_queue : [];
  const review = Array.isArray(queues.review_queue) ? queues.review_queue : [];
  const attempts = Array.isArray(root.attempts) ? root.attempts : [];
  const allowBestGuessFallback = options.allowBestGuessFallback === true;
  const minFallbackPValid = Math.max(
    0,
    Math.min(1, Number(options.minFallbackPValid ?? 0.58) || 0.58)
  );

  const toCandidate = (row: unknown) => {
    const candidate = coerceRecord(row);
    const email = extractFirstEmailAddress(candidate.email);
    const verdict = String(candidate.verdict ?? "")
      .trim()
      .toLowerCase();
    const confidence = String(candidate.confidence ?? "")
      .trim()
      .toLowerCase();
    const details = coerceRecord(candidate.details);
    const pValidRaw =
      typeof candidate.p_valid === "number"
        ? candidate.p_valid
        : typeof details.p_valid === "number"
          ? details.p_valid
          : null;
    const pValid = typeof pValidRaw === "number" && Number.isFinite(pValidRaw) ? pValidRaw : -1;
    const attemptRaw = Number(candidate.attempt ?? 0);
    const attempt = Number.isFinite(attemptRaw) ? attemptRaw : 0;
    return { email, verdict, confidence, pValid, attempt };
  };

  // Treat any validator-positive result as acceptable.
  const allowedVerdicts = new Set(["likely-valid", "risky-valid", "valid", "accepted", "deliverable"]);
  const isValidatorPositiveCandidate = (item: {
    email: string;
    verdict: string;
    confidence: string;
    pValid: number;
    attempt: number;
  }) => Boolean(item.email) && allowedVerdicts.has(item.verdict);

  const confidenceScore = (level: string) => {
    if (level === "high") return 2;
    if (level === "medium") return 1;
    return 0;
  };
  const verdictScore = (verdict: string) => {
    if (
      verdict === "likely-valid" ||
      verdict === "valid" ||
      verdict === "accepted" ||
      verdict === "deliverable"
    ) {
      return 1;
    }
    if (verdict === "risky-valid") return 0;
    return -1;
  };

  const candidateRows = [...eligible, ...risky, root.best_guess, ...attempts];
  const candidates = candidateRows
    .map(toCandidate)
    .filter(isValidatorPositiveCandidate)
    .sort((left, right) => {
      const confidenceDelta = confidenceScore(right.confidence) - confidenceScore(left.confidence);
      if (confidenceDelta !== 0) return confidenceDelta;
      const verdictDelta = verdictScore(right.verdict) - verdictScore(left.verdict);
      if (verdictDelta !== 0) return verdictDelta;
      const pValidDelta = right.pValid - left.pValid;
      if (pValidDelta !== 0) return pValidDelta;
      return left.attempt - right.attempt;
    });

  for (const candidate of candidates) {
    const suppressionReason = getLeadEmailSuppressionReason(candidate.email);
    if (suppressionReason) continue;
    return {
      email: candidate.email,
      realVerifiedEmail: true,
    };
  }

  if (allowBestGuessFallback) {
    const fallbackCandidateRows = [...review, root.best_guess, ...attempts];
    const fallbackCandidates = fallbackCandidateRows
      .map(toCandidate)
      .filter((candidate) => {
        if (!candidate.email) return false;
        if (candidate.verdict === "invalid") return false;
        return candidate.pValid >= minFallbackPValid;
      })
      .sort((left, right) => {
        const pValidDelta = right.pValid - left.pValid;
        if (pValidDelta !== 0) return pValidDelta;
        const confidenceDelta = confidenceScore(right.confidence) - confidenceScore(left.confidence);
        if (confidenceDelta !== 0) return confidenceDelta;
        return left.attempt - right.attempt;
      });

    for (const candidate of fallbackCandidates) {
      const suppressionReason = getLeadEmailSuppressionReason(candidate.email);
      if (suppressionReason) continue;
      return {
        email: candidate.email,
        realVerifiedEmail: false,
      };
    }
  }

  return {
    email: "",
    realVerifiedEmail: false,
  };
}

function summarizeNoHitFromBatchResult(result: unknown) {
  const root = coerceRecord(result);
  const attempts = Array.isArray(root.attempts) ? root.attempts.map((row) => coerceRecord(row)) : [];
  const verification = coerceRecord(root.verification);
  const routing = coerceRecord(root.routing);
  const queues = coerceRecord(routing.queues);

  const mxStatus = String(verification.mx_status ?? "")
    .trim()
    .toLowerCase();
  const validatorPositiveAttempts = attempts.filter((row) =>
    ["likely-valid", "risky-valid", "valid", "accepted", "deliverable"].includes(
      String(row.verdict ?? "").trim().toLowerCase()
    )
  ).length;
  const invalidAttempts = attempts.filter(
    (row) => String(row.verdict ?? "").trim().toLowerCase() === "invalid"
  ).length;
  const riskyQueueCount = Array.isArray(queues.risky_queue) ? queues.risky_queue.length : 0;

  const topAttempt = attempts[0] ?? {};
  const topDetails = coerceRecord(topAttempt.details);
  const rawError = String(root.error ?? topDetails.reason ?? topDetails.error ?? "").trim();
  const normalizedError = rawError.toLowerCase();
  const topHttpStatus = Number(topDetails.http_status ?? root.http_status ?? 0);

  let reason = "no_high_confidence_candidate";
  if (topHttpStatus === 401 || normalizedError.includes("unauthorized")) {
    reason = "validatedmails_unauthorized";
  } else if (normalizedError.includes("validatedmails api key is required")) {
    reason = "missing_validatedmails_api_key";
  } else if (mxStatus === "no-mail-route") {
    reason = "no_mail_route";
  } else if (attempts.length > 0 && invalidAttempts === attempts.length) {
    reason = "all_candidates_invalid";
  } else if (validatorPositiveAttempts > 0 || riskyQueueCount > 0) {
    reason = "only_risky_candidates";
  } else if (attempts.length === 0) {
    reason = "no_attempts";
  }

  return {
    reason,
    error:
      reason === "validatedmails_unauthorized"
        ? "ValidatedMails rejected the API key (HTTP 401)."
        : rawError,
    topAttemptEmail: extractFirstEmailAddress(topAttempt.email),
    topAttemptVerdict: String(topAttempt.verdict ?? "").trim().toLowerCase(),
    topAttemptConfidence: String(topAttempt.confidence ?? "").trim().toLowerCase(),
    topAttemptReason: String(topDetails.reason ?? "").trim(),
  };
}

export async function enrichLeadsWithEmailFinderBatch(params: {
  leads: ApifyLead[];
  apiBaseUrl: string;
  verificationMode?: EmailFinderVerificationMode;
  validatedMailsApiKey?: string;
  maxCandidates?: number;
  maxCredits?: number;
  timeoutMs?: number;
  concurrency?: number;
  allowBestGuessFallback?: boolean;
  minBestGuessPValid?: number;
}): Promise<EmailFinderBatchEnrichmentResult> {
  const apiBaseUrl = resolveEmailFinderApiBaseUrl(params.apiBaseUrl);
  if (!apiBaseUrl) {
    return {
      ok: false,
      leads: params.leads,
      attempted: 0,
      matched: 0,
      failed: 0,
      provider: "emailfinder.batch",
      error: "EMAIL_FINDER_API_BASE_URL is missing",
      failureSummary: [{ reason: "missing_api_base_url", count: 1 }],
      failedSamples: [],
    };
  }

  const items: Array<{ id: string; name: string; domain: string }> = [];
  for (const [index, lead] of params.leads.entries()) {
    const existingEmail = extractFirstEmailAddress(lead.email);
    if (existingEmail) continue;
    const name = String(lead.name ?? "").trim();
    const domain = String(lead.domain ?? "")
      .trim()
      .toLowerCase()
      .replace(/^www\./, "");
    if (!name || !domain || !domain.includes(".") || isNonCompanyProfileDomain(domain)) continue;
    items.push({
      id: `lead-${index}`,
      name,
      domain,
    });
  }

  if (!items.length) {
    return {
      ok: true,
      leads: params.leads,
      attempted: 0,
      matched: 0,
      failed: 0,
      provider: "emailfinder.batch",
      error: "",
      failureSummary: [],
      failedSamples: [],
    };
  }

  const verificationMode: EmailFinderVerificationMode = "validatedmails";
  const requestedMode = String(params.verificationMode ?? "validatedmails")
    .trim()
    .toLowerCase();
  if (requestedMode && requestedMode !== "validatedmails") {
    return {
      ok: false,
      leads: params.leads,
      attempted: items.length,
      matched: 0,
      failed: items.length,
      provider: "emailfinder.batch",
      error: "Only real verification mode 'validatedmails' is supported",
      failureSummary: [{ reason: "unsupported_verification_mode", count: items.length }],
      failedSamples: [],
    };
  }
  const apiKey = String(params.validatedMailsApiKey ?? "").trim();
  if (!apiKey) {
    return {
      ok: false,
      leads: params.leads,
      attempted: items.length,
      matched: 0,
      failed: items.length,
      provider: "emailfinder.batch",
      error: "validatedmails API key is required for real verification",
      failureSummary: [{ reason: "missing_validatedmails_api_key", count: items.length }],
      failedSamples: [],
    };
  }
  const maxCandidates = Math.max(4, Math.min(20, Number(params.maxCandidates ?? 12) || 12));
  const maxCredits = Math.max(1, Math.min(25, Number(params.maxCredits ?? 7) || 7));
  const requestedConcurrency = Math.max(1, Math.min(10, Number(params.concurrency ?? 4) || 4));
  const concurrency = requestedConcurrency;
  const effectiveMaxCandidates = maxCandidates;
  const verifierProbeTimeoutSeconds = 8;
  const defaultItem: Record<string, unknown> = {
    verification_mode: verificationMode,
    max_candidates: effectiveMaxCandidates,
    stop_on_first_hit: true,
    stop_on_min_confidence: "high",
    high_confidence_only: true,
    enable_risky_queue: true,
  };
  defaultItem.max_credits = maxCredits;
  defaultItem.validatedmails_api_key = apiKey;
  defaultItem.timeout_seconds = verifierProbeTimeoutSeconds;

  const itemById = new Map(items.map((item) => [item.id, item] as const));

  const buildResultFromEmailMap = (
    emailByIndex: Map<number, { email: string; realVerifiedEmail: boolean }>,
    attempted: number,
    failed: number,
    error = "",
    failureSummary: Array<{ reason: string; count: number }> = [],
    failedSamples: Array<{
      id: string;
      name: string;
      domain: string;
      reason: string;
      error: string;
      topAttemptEmail: string;
      topAttemptVerdict: string;
      topAttemptConfidence: string;
      topAttemptReason: string;
    }> = []
  ) => {
    const leads = params.leads.map((lead, index) => {
      const enriched = emailByIndex.get(index);
      if (!enriched?.email) return lead;
      return {
        ...lead,
        email: enriched.email,
        domain: enriched.email.split("@")[1] || lead.domain,
        realVerifiedEmail: enriched.realVerifiedEmail,
      };
    });
    return {
      ok: !error,
      leads,
      attempted,
      matched: emailByIndex.size,
      failed,
      provider: "emailfinder.batch",
      error,
      failureSummary,
      failedSamples,
    } satisfies EmailFinderBatchEnrichmentResult;
  };

  const effectiveConcurrency = Math.max(1, Math.min(3, concurrency));
  const configuredTimeoutMs = Number(params.timeoutMs ?? 0);
  const baseTimeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0 ? configuredTimeoutMs : 0;
  const estimatedWorstCaseMs = Math.ceil(
    (Math.ceil(items.length / effectiveConcurrency) * maxCredits * verifierProbeTimeoutSeconds * 1000 * 3) / 4 + 15_000
  );
  const batchTimeoutMs = Math.max(30_000, Math.min(600_000, Math.max(baseTimeoutMs, estimatedWorstCaseMs)));

  const buildResultFromBatchRows = (
    results: unknown[],
    batchLevelError = ""
  ) => {
    const emailByIndex = new Map<number, { email: string; realVerifiedEmail: boolean }>();
    const failureCounts = new Map<string, number>();
    const failedSamples: Array<{
      id: string;
      name: string;
      domain: string;
      reason: string;
      error: string;
      topAttemptEmail: string;
      topAttemptVerdict: string;
      topAttemptConfidence: string;
      topAttemptReason: string;
    }> = [];
    let failed = 0;
    let firstError = "";

    for (const row of results) {
      const item = coerceRecord(row);
      const itemId = String(item.id ?? "").trim();
      const itemMeta = itemById.get(itemId);
      const pushFailure = (input: {
        reason: string;
        error: string;
        topAttemptEmail?: string;
        topAttemptVerdict?: string;
        topAttemptConfidence?: string;
        topAttemptReason?: string;
      }) => {
        const reason = input.reason || "unknown_failure";
        failureCounts.set(reason, (failureCounts.get(reason) ?? 0) + 1);
        if (failedSamples.length >= 12) return;
        failedSamples.push({
          id: itemId,
          name: String(itemMeta?.name ?? ""),
          domain: String(itemMeta?.domain ?? ""),
          reason,
          error: input.error,
          topAttemptEmail: input.topAttemptEmail ?? "",
          topAttemptVerdict: input.topAttemptVerdict ?? "",
          topAttemptConfidence: input.topAttemptConfidence ?? "",
          topAttemptReason: input.topAttemptReason ?? "",
        });
      };

      if (!Boolean(item.ok)) {
        failed += 1;
        const itemError = String(item.error ?? "").trim();
        if (!firstError && itemError) firstError = itemError;
        pushFailure({
          reason:
            itemError.includes("401") || /unauthorized/i.test(itemError)
              ? "validatedmails_unauthorized"
              : "item_error",
          error: itemError,
        });
        continue;
      }

      const resolved = parseEmailFinderBestGuessEmail(item.result, {
        allowBestGuessFallback: params.allowBestGuessFallback,
        minFallbackPValid: params.minBestGuessPValid,
      });
      if (!resolved.email) {
        failed += 1;
        const summary = summarizeNoHitFromBatchResult(item.result);
        if (!firstError && summary.error) firstError = summary.error;
        pushFailure(summary);
        continue;
      }

      const numericIndex = Number(itemId.replace("lead-", ""));
      if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < params.leads.length) {
        emailByIndex.set(numericIndex, resolved);
      } else {
        failed += 1;
        const parseError = `Unable to parse numeric lead index from id '${itemId}'`;
        if (!firstError) firstError = parseError;
        pushFailure({
          reason: "invalid_item_id",
          error: parseError,
        });
      }
    }

    const error = emailByIndex.size > 0 ? "" : firstError || batchLevelError || "No high-confidence email could be resolved";
    const failureSummary = Array.from(failureCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
    return buildResultFromEmailMap(emailByIndex, items.length, failed, error, failureSummary, failedSamples);
  };

  const runBatchGuessPass = async (input: { timeoutMs: number; requestConcurrency: number }) => {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, input.timeoutMs);
    try {
      const response = await fetch(`${apiBaseUrl}/v1/guess/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          concurrency: input.requestConcurrency,
          continue_on_error: true,
          default_item: defaultItem,
          items,
        }),
      });
      const raw = await response.text();
      let payload: unknown = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = {};
      }
      const batch = coerceRecord(payload);
      const results = Array.isArray(batch.results) ? batch.results : null;
      if (!results) {
        const nonOkReason =
          !response.ok && (String(batch.error ?? "").trim() || `EmailFinder batch request failed (${response.status})`);
        return buildResultFromEmailMap(
          new Map<number, { email: string; realVerifiedEmail: boolean }>(),
          items.length,
          items.length,
          nonOkReason || "EmailFinder batch response was malformed"
        );
      }
      const batchLevelError =
        !response.ok && (String(batch.error ?? "").trim() || `EmailFinder batch request failed (${response.status})`);
      return buildResultFromBatchRows(results, batchLevelError || "");
    } catch (error) {
      const message = error instanceof Error ? compactText(error.message, 180) : compactText(String(error ?? ""), 180);
      const isAbortError = timedOut || String((error as { name?: unknown })?.name ?? "").toLowerCase() === "aborterror";
      const reason = isAbortError
        ? `EmailFinder batch timed out after ${input.timeoutMs}ms`
        : message
          ? `EmailFinder batch request failed: ${message}`
          : "EmailFinder batch request failed";
      return buildResultFromEmailMap(
        new Map<number, { email: string; realVerifiedEmail: boolean }>(),
        items.length,
        items.length,
        reason,
        [{ reason: isAbortError ? "timeout" : "request_failed", count: items.length }]
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  };

  const initial = await runBatchGuessPass({
    timeoutMs: batchTimeoutMs,
    requestConcurrency: effectiveConcurrency,
  });
  const initialError = initial.error.trim().toLowerCase();
  const shouldRetry =
    initial.matched === 0 &&
    initial.attempted > 0 &&
    Boolean(initialError) &&
    (initialError.includes("timed out") || initialError.includes("request failed"));

  if (!shouldRetry) return initial;

  const retryTimeoutMs = Math.max(batchTimeoutMs, Math.min(900_000, Math.round(batchTimeoutMs * 1.5)));
  const retry = await runBatchGuessPass({
    timeoutMs: retryTimeoutMs,
    requestConcurrency: Math.max(1, Math.min(2, effectiveConcurrency)),
  });
  if (retry.matched > initial.matched) return retry;
  if (retry.matched > 0) return retry;
  if (!retry.error.trim()) return retry;
  if (!initial.error.trim() || retry.error.trim() === initial.error.trim()) return retry;

  return {
    ...retry,
    error: `${retry.error.trim()} (initial: ${initial.error.trim()})`,
  };
}

function customerIoTrackApiKey(secrets: OutreachAccountSecrets) {
  return (
    secrets.customerIoTrackApiKey.trim() ||
    secrets.customerIoApiKey.trim()
  );
}

function customerIoAppApiKey(secrets: OutreachAccountSecrets) {
  return secrets.customerIoAppApiKey.trim();
}

function customerIoApiKey(secrets: OutreachAccountSecrets) {
  return customerIoTrackApiKey(secrets) || customerIoAppApiKey(secrets);
}

function mailboxSmtpPassword(secrets: OutreachAccountSecrets) {
  return secrets.mailboxSmtpPassword.trim() || secrets.mailboxPassword.trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlFromPlainText(value: string) {
  return escapeHtml(value).replace(/\r?\n/g, "<br />");
}

function customerIoResponseMessageId(payload: unknown, fallback = "") {
  const asObject = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

  const queue: unknown[] = [payload];
  const visited = new Set<unknown>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const row = asObject(current);
    if (!row) continue;
    for (const key of ["delivery_id", "deliveryId", "message_id", "messageId", "queued_message_id", "id"] as const) {
      const candidate = String(row[key] ?? "").trim();
      if (candidate) return candidate;
    }
    for (const nested of Object.values(row)) {
      if (nested && typeof nested === "object") {
        queue.push(nested);
      }
    }
  }

  return fallback.trim();
}

async function testCustomerIoTrackCredentials(input: {
  siteId: string;
  apiKey: string;
}): Promise<{ ok: boolean; error: string; region: string; baseUrl: string }> {
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

function normalizeApifyActorId(actorId: string) {
  const trimmed = actorId.trim();
  // Apify API expects "username~actorName". Historically we stored "username/actorName".
  if (trimmed.includes("/") && !trimmed.includes("~")) {
    const [username, actorName] = trimmed.split("/", 2);
    if (username && actorName) return `${username}~${actorName}`;
  }
  return trimmed;
}

function sanitizeStoreText(value: unknown, max = 500) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const PLATFORM_SEARCH_ACTOR_ID = "apify~google-search-scraper";
const PLATFORM_EMAIL_DISCOVERY_ACTOR_ID = String(process.env.PLATFORM_EMAIL_DISCOVERY_ACTOR_ID ?? "").trim();
const PLATFORM_EMAIL_DISCOVERY_ACTOR_CANDIDATES = String(
  process.env.PLATFORM_EMAIL_DISCOVERY_ACTOR_CANDIDATES ?? ""
).trim();
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

export async function runApifyActorSyncGetDatasetItems(input: {
  actorId: string;
  actorInput: Record<string, unknown>;
  token: string;
  timeoutSeconds?: number;
}) {
  return apifyRunSyncGetDatasetItems(input);
}

export async function fetchApifyActorSchemaProfile(input: {
  actorId: string;
  token?: string;
}): Promise<{ ok: boolean; profile: ApifyActorSchemaProfile | null; error: string }> {
  const actorId = normalizeApifyActorId(input.actorId);
  if (!actorId) {
    return { ok: false, profile: null, error: "Missing actor id" };
  }
  const token = String(input.token ?? "").trim();

  try {
    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}${
      token ? `?token=${encodeURIComponent(token)}` : ""
    }`;
    const response = await fetch(url);
    const raw = await response.text();
    let payload: unknown = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = {};
    }

    if (!response.ok) {
      return {
        ok: false,
        profile: null,
        error: `HTTP ${response.status}${raw ? `: ${compactText(raw, 200)}` : ""}`,
      };
    }

    const root =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const data =
      root.data && typeof root.data === "object" && !Array.isArray(root.data)
        ? (root.data as Record<string, unknown>)
        : root;
    const versions = Array.isArray(data.versions) ? data.versions : [];
    const firstVersion =
      versions.find((row) => row && typeof row === "object" && !Array.isArray(row)) ??
      (versions.length ? versions[0] : {});
    const versionRow =
      firstVersion && typeof firstVersion === "object" && !Array.isArray(firstVersion)
        ? (firstVersion as Record<string, unknown>)
        : {};

    const inputSchemaRaw =
      (data.inputSchema && typeof data.inputSchema === "object" && !Array.isArray(data.inputSchema)
        ? data.inputSchema
        : null) ||
      (versionRow.inputSchema &&
      typeof versionRow.inputSchema === "object" &&
      !Array.isArray(versionRow.inputSchema)
        ? versionRow.inputSchema
        : null) ||
      {};
    const inputSchema =
      inputSchemaRaw && typeof inputSchemaRaw === "object" && !Array.isArray(inputSchemaRaw)
        ? (inputSchemaRaw as Record<string, unknown>)
        : {};

    const requiredKeys = parseSchemaRequiredKeys(inputSchema);
    const knownKeys = flattenSchemaKeys(inputSchema);
    const profile: ApifyActorSchemaProfile = {
      actorId,
      title: compactText(data.title ?? data.name ?? actorId, 180),
      description: compactText(data.description ?? data.readme ?? "", 700),
      inputSchema,
      requiredKeys,
      knownKeys,
      supportsRunSync: true,
    };
    return { ok: true, profile, error: "" };
  } catch (error) {
    return {
      ok: false,
      profile: null,
      error: error instanceof Error ? error.message : "Failed to fetch actor profile",
    };
  }
}

export function evaluateActorCompatibility(input: {
  actorProfile: ApifyActorSchemaProfile;
  actorInput: Record<string, unknown>;
  stage: "prospect_discovery" | "website_enrichment" | "email_discovery";
}): ActorCompatibilityDecision {
  const resolvePathValue = (row: Record<string, unknown>, key: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    if (key.includes(".")) {
      const parts = key.split(".").filter(Boolean);
      let cursor: unknown = row;
      for (const part of parts) {
        if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
        cursor = (cursor as Record<string, unknown>)[part];
      }
      if (cursor !== undefined) return cursor;
    }
    if (key.startsWith("input.") && Object.prototype.hasOwnProperty.call(row, key.slice("input.".length))) {
      return row[key.slice("input.".length)];
    }
    return undefined;
  };

  const required = input.actorProfile.requiredKeys;
  const missingRequired: string[] = [];
  for (const key of required) {
    const value = resolvePathValue(input.actorInput, key);
    if (value === undefined || value === null) {
      missingRequired.push(key);
      continue;
    }
    if (typeof value === "string" && !value.trim()) {
      missingRequired.push(key);
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      missingRequired.push(key);
      continue;
    }
  }

  const knownKeys = new Set(input.actorProfile.knownKeys.map((value) => value.toLowerCase()));
  const submittedKeys = Object.keys(input.actorInput);
  const knownHitCount = submittedKeys.filter((value) => knownKeys.has(value.toLowerCase())).length;
  const knownCoverage = input.actorProfile.knownKeys.length
    ? knownHitCount / input.actorProfile.knownKeys.length
    : 1;
  const requiredPenalty = required.length ? missingRequired.length / required.length : 0;

  const stageHints = `${input.actorProfile.title} ${input.actorProfile.description}`.toLowerCase();
  const stageBonus =
    input.stage === "email_discovery"
      ? /(email|contact|mailbox|enrich)/.test(stageHints)
        ? 0.2
        : 0
      : input.stage === "website_enrichment"
        ? /(website|domain|company|crawl|scrape)/.test(stageHints)
          ? 0.2
          : 0
        : /(lead|prospect|people|linkedin|company)/.test(stageHints)
          ? 0.2
          : 0;

  const score = Math.max(0, Math.min(1, 0.65 * knownCoverage + stageBonus - 0.7 * requiredPenalty));
  if (missingRequired.length) {
    return {
      ok: false,
      missingRequired,
      score,
      reason: `Missing required input keys: ${missingRequired.join(", ")}`,
    };
  }

  if (score < 0.25) {
    return {
      ok: false,
      missingRequired,
      score,
      reason: "Actor schema fit is too weak for this stage",
    };
  }

  return {
    ok: true,
    missingRequired,
    score,
    reason: "",
  };
}

export function evaluateLeadAgainstQualityPolicy(input: {
  lead: ApifyLead;
  policy: LeadQualityPolicy;
  allowMissingEmail?: boolean;
}): LeadQualityDecision {
  const allowMissingEmail = input.allowMissingEmail === true;
  const rawEmail = extractFirstEmailAddress(input.lead.email);
  const floorReason = rawEmail ? getLeadEmailSuppressionReason(rawEmail) : "";
  const sourceUrl = String(input.lead.sourceUrl ?? "").trim();
  const hasSourceUrl = Boolean(sourceUrl);
  const sourceHostname = safeHostname(sourceUrl);
  const sourceDomain = toRegistrableDomain(sourceHostname);
  const normalizedName = String(input.lead.name ?? "").trim();
  const normalizedCompany = String(input.lead.company ?? "").trim();
  const normalizedTitle = String(input.lead.title ?? "").trim();
  const hasTwoPartName = normalizedName.split(/\s+/).filter(Boolean).length >= 2;
  const fallbackDomainRaw = String(input.lead.domain ?? "").trim().toLowerCase();
  const fallbackDomain = isNonCompanyProfileDomain(fallbackDomainRaw) ? "" : fallbackDomainRaw;
  const fallbackProfileReady = Boolean(hasTwoPartName && fallbackDomain);

  if ((!rawEmail || floorReason) && !(allowMissingEmail && fallbackProfileReady)) {
    return {
      email: rawEmail || String(input.lead.email ?? "").trim().toLowerCase(),
      accepted: false,
      confidence: 0,
      reason: floorReason || "invalid_email",
      details: {
        floorReason: floorReason || "invalid_email",
        allowMissingEmail,
        hasTwoPartName,
        fallbackDomain,
      },
    };
  }

  const email = !floorReason ? rawEmail : "";
  const local = email ? email.split("@")[0] ?? "" : "";
  const domain = email ? email.split("@")[1] ?? "" : fallbackDomain;
  const sourceDomainMatchesLead =
    Boolean(sourceDomain) &&
    (domain === sourceDomain || domain.endsWith(`.${sourceDomain}`) || sourceDomain.endsWith(`.${domain}`));
  const hasRealVerifiedEmail = input.lead.realVerifiedEmail === true;
  const rawConfidence = Number((input.lead as unknown as Record<string, unknown>).confidence);
  const hasExplicitConfidence = Number.isFinite(rawConfidence);
  const explicitConfidence = hasExplicitConfidence ? Math.max(0, Math.min(1, rawConfidence)) : 0;
  const inferredName = inferNameFromEmail(email);
  const nameLikelyEmailDerived =
    Boolean(email) &&
    Boolean(normalizedName) &&
    Boolean(inferredName) &&
    normalizedName.toLowerCase() === inferredName.toLowerCase();
  const humanName = isLikelyHumanName(normalizedName);
  const hasIndependentPersonEvidence =
    (Boolean(normalizedName) && humanName && !nameLikelyEmailDerived) || Boolean(normalizedTitle);

  if (!input.policy.allowFreeDomains && isLikelyFreeDomain(domain)) {
    return {
      email,
      accepted: false,
      confidence: 0.1,
      reason: "free_domain_blocked",
      details: { domain, policy: "allowFreeDomains=false" },
    };
  }
  if (email && !input.policy.allowRoleInboxes && isLikelyRoleInbox(local)) {
    return {
      email,
      accepted: false,
      confidence: 0.1,
      reason: "role_inbox_blocked",
      details: { local, policy: "allowRoleInboxes=false" },
    };
  }
  // Real verified emails bypass heuristic policy scoring (title/company keyword penalties, confidence threshold).
  if (hasRealVerifiedEmail) {
    return {
      email,
      accepted: true,
      confidence: 1,
      reason: "accepted",
      details: {
        realVerifiedEmail: true,
        policyBypass: "heuristic_confidence",
      },
    };
  }
  if (email && isLikelyRoleInbox(local) && !hasIndependentPersonEvidence) {
    return {
      email,
      accepted: false,
      confidence: 0.08,
      reason: "role_inbox_low_evidence",
      details: { local, normalizedName, titlePresent: Boolean(normalizedTitle) },
    };
  }
  if (normalizedName && !humanName && !normalizedTitle) {
    return {
      email,
      accepted: false,
      confidence: 0.12,
      reason: "non_person_name",
      details: { normalizedName },
    };
  }
  if (domain && isLikelyFreeDomain(domain) && input.policy.allowFreeDomains && !hasIndependentPersonEvidence) {
    return {
      email,
      accepted: false,
      confidence: 0.12,
      reason: "free_domain_low_evidence",
      details: { domain, normalizedName, titlePresent: Boolean(normalizedTitle) },
    };
  }
  if (sourceDomain && !sourceDomainMatchesLead && !normalizedTitle && nameLikelyEmailDerived) {
    return {
      email,
      accepted: false,
      confidence: hasExplicitConfidence ? explicitConfidence : 0.2,
      reason: "source_domain_mismatch",
      details: { sourceDomain, leadDomain: domain, normalizedName, titlePresent: false },
    };
  }
  if (input.policy.requirePersonName && !normalizedName) {
    return {
      email,
      accepted: false,
      confidence: 0.15,
      reason: "missing_name",
      details: { policy: "requirePersonName=true" },
    };
  }
  if (input.policy.requireCompany && !normalizedCompany) {
    return {
      email,
      accepted: false,
      confidence: 0.15,
      reason: "missing_company",
      details: { policy: "requireCompany=true" },
    };
  }
  if (input.policy.requireTitle && !normalizedTitle) {
    return {
      email,
      accepted: false,
      confidence: 0.15,
      reason: "missing_title",
      details: { policy: "requireTitle=true" },
    };
  }

  const titleKeywords = Array.isArray(input.policy.requiredTitleKeywords)
    ? input.policy.requiredTitleKeywords
        .map((item) => String(item ?? "").trim().toLowerCase())
        .filter(Boolean)
    : [];
  let titleKeywordPenalty = 0;
  if (titleKeywords.length) {
    const titleLower = normalizedTitle.toLowerCase();
    if (!titleLower) {
      return {
        email,
        accepted: false,
        confidence: 0.1,
        reason: "missing_title_for_icp",
        details: { requiredTitleKeywords: titleKeywords },
      };
    }
    const matchesTitleKeyword = titleKeywords.some((keyword) => titleLower.includes(keyword));
    if (!matchesTitleKeyword) {
      titleKeywordPenalty = 0.18;
    }
  }

  const companyContext = [
    normalizedCompany,
    domain,
    String(input.lead.domain ?? "").trim(),
    sourceHostname,
    sourceDomain,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const requiredCompanyKeywords = Array.isArray(input.policy.requiredCompanyKeywords)
    ? input.policy.requiredCompanyKeywords
        .map((item) => String(item ?? "").trim().toLowerCase())
        .filter(Boolean)
    : [];
  let companyKeywordPenalty = 0;
  if (requiredCompanyKeywords.length) {
    const matchesRequired = requiredCompanyKeywords.some((keyword) => companyContext.includes(keyword));
    if (!matchesRequired) {
      companyKeywordPenalty = 0.2;
    }
  }

  const excludedCompanyKeywords = Array.isArray(input.policy.excludedCompanyKeywords)
    ? input.policy.excludedCompanyKeywords
        .map((item) => String(item ?? "").trim().toLowerCase())
        .filter(Boolean)
    : [];
  if (excludedCompanyKeywords.length) {
    const hit = excludedCompanyKeywords.find((keyword) => companyContext.includes(keyword));
    if (hit) {
      return {
        email,
        accepted: false,
        confidence: 0.05,
        reason: "excluded_company_keyword",
        details: { company: normalizedCompany, excludedKeyword: hit },
      };
    }
  }

  if (!hasSourceUrl && !normalizedTitle && nameLikelyEmailDerived) {
    return {
      email,
      accepted: false,
      confidence: hasExplicitConfidence ? explicitConfidence : 0.22,
      reason: "insufficient_person_evidence",
      details: {
        hasSourceUrl,
        sourceDomain,
        sourceDomainMatchesLead,
        titlePresent: false,
        nameLikelyEmailDerived,
      },
    };
  }

  const heuristicConfidence = Math.max(
    0,
    Math.min(
      1,
      (normalizedName ? (nameLikelyEmailDerived ? 0.2 : 0.34) : 0.08) +
        (normalizedCompany ? 0.3 : 0.12) +
        (normalizedTitle ? 0.24 : 0.04) +
        (hasSourceUrl ? 0.12 : 0) +
        (sourceDomainMatchesLead ? 0.07 : 0) -
        titleKeywordPenalty -
        companyKeywordPenalty
    )
  );
  const confidence = hasExplicitConfidence
    ? Math.max(0, Math.min(1, explicitConfidence * 0.6 + heuristicConfidence * 0.4))
    : heuristicConfidence;
  const minConfidence = Math.max(0, Math.min(1, Number(input.policy.minConfidenceScore ?? 0) || 0));
  if (confidence < minConfidence) {
    return {
      email,
      accepted: false,
      confidence,
      reason: "below_confidence_threshold",
      details: { confidence, minConfidence },
    };
  }

  return {
    email,
    accepted: true,
    confidence,
    reason: "accepted",
    details: {
      emailPresent: Boolean(email),
      namePresent: Boolean(normalizedName),
      companyPresent: Boolean(normalizedCompany),
      titlePresent: Boolean(normalizedTitle),
      domainPresent: Boolean(domain),
      titleKeywordPenalty,
      companyKeywordPenalty,
    },
  };
}

export async function searchApifyStoreActors(params: {
  query: string;
  limit?: number;
  offset?: number;
}): Promise<ApifyStoreSearchResult> {
  const query = params.query.trim();
  if (!query) {
    return {
      ok: false,
      query: "",
      total: 0,
      actors: [],
      error: "Store search query is empty",
    };
  }

  const limit = Math.max(1, Math.min(100, Number(params.limit ?? 40)));
  const offset = Math.max(0, Number(params.offset ?? 0) || 0);

  try {
    const url = `https://api.apify.com/v2/store?search=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) {
      let body = "";
      try {
        body = (await response.text()).trim();
      } catch {
        body = "";
      }
      return {
        ok: false,
        query,
        total: 0,
        actors: [],
        error: `HTTP ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`,
      };
    }
    const payload: unknown = await response.json();
    const root = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    const data =
      root.data && typeof root.data === "object" && !Array.isArray(root.data)
        ? (root.data as Record<string, unknown>)
        : {};
    const total = Math.max(0, Number(data.total ?? 0) || 0);
    const items = Array.isArray(data.items) ? data.items : [];
    const actors: ApifyStoreActor[] = [];

    for (const item of items) {
      const row = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
      const username = sanitizeStoreText(row.username, 120);
      const name = sanitizeStoreText(row.name, 120);
      if (!username || !name) continue;

      const stats = row.stats && typeof row.stats === "object" && !Array.isArray(row.stats)
        ? (row.stats as Record<string, unknown>)
        : {};
      const categories = Array.isArray(row.categories)
        ? row.categories.map((entry) => sanitizeStoreText(entry, 80)).filter(Boolean).slice(0, 8)
        : [];

      actors.push({
        actorId: normalizeApifyActorId(`${username}~${name}`),
        title: sanitizeStoreText(row.title ?? name, 180),
        description: sanitizeStoreText(row.description ?? row.readmeSummary ?? "", 500),
        categories,
        users30Days: Math.max(0, Number(stats.totalUsers30Days ?? 0) || 0),
        rating: Math.max(0, Math.min(5, Number(row.actorReviewRating ?? stats.actorReviewRating ?? 0) || 0)),
        pricingModel: sanitizeStoreText(
          (row.currentPricingInfo as Record<string, unknown> | null)?.pricingModel ?? "",
          80
        ).toUpperCase(),
        pricePerUnitUsd: Math.max(
          0,
          Number((row.currentPricingInfo as Record<string, unknown> | null)?.pricePerUnitUsd ?? 0) || 0
        ),
        trialMinutes: Math.max(
          0,
          Number((row.currentPricingInfo as Record<string, unknown> | null)?.trialMinutes ?? 0) || 0
        ),
      });
    }

    return {
      ok: true,
      query,
      total,
      actors,
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      query,
      total: 0,
      actors: [],
      error: error instanceof Error ? error.message : "Store search failed",
    };
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
    const raw = await response.text();
    let payload: unknown = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = {};
    }
    const row = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    const data =
      row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : row;
    const runId = String(data.id ?? "").trim();
    const datasetId = String(data.defaultDatasetId ?? data.default_dataset_id ?? "").trim();
    const detail = extractApifyErrorDetail(raw, payload);
    if (!response.ok || !runId) {
      return {
        ok: false,
        runId,
        datasetId,
        error: `HTTP ${response.status}${detail ? `: ${detail}` : runId ? "" : ": Missing run id"}`,
      };
    }
    return { ok: true, runId, datasetId, error: "" };
  } catch (error) {
    return { ok: false, runId: "", datasetId: "", error: error instanceof Error ? error.message : "Apify run start failed" };
  }
}

export async function startApifyActorRun(input: {
  actorId: string;
  actorInput: Record<string, unknown>;
  token: string;
  maxTotalChargeUsd?: number;
}) {
  return apifyStartRun(input);
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

export async function pollApifyActorRun(input: { token: string; runId: string }) {
  return apifyPollRun(input);
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

export async function fetchApifyActorDatasetItems(input: {
  token: string;
  datasetId: string;
  limit?: number;
}) {
  return apifyFetchDatasetItems(input);
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
  actorId?: string;
}): Promise<LeadSourcingEmailDiscoveryRun> {
  const selectedActorId = normalizeApifyActorId(params.actorId ?? PLATFORM_EMAIL_DISCOVERY_ACTOR_ID);
  if (!selectedActorId) {
    return {
      ok: false,
      runId: "",
      datasetId: "",
      error: "PLATFORM_EMAIL_DISCOVERY_ACTOR_ID is not configured",
    };
  }

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
    actorId: selectedActorId,
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

export function getPlatformEmailDiscoveryActorCandidates(): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const pushCandidate = (actorId: string) => {
    const normalized = normalizeApifyActorId(actorId);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  pushCandidate(PLATFORM_EMAIL_DISCOVERY_ACTOR_ID);

  if (PLATFORM_EMAIL_DISCOVERY_ACTOR_CANDIDATES) {
    for (const actorId of PLATFORM_EMAIL_DISCOVERY_ACTOR_CANDIDATES.split(/[\n,]/g)) {
      pushCandidate(actorId);
    }
  }

  return candidates;
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
    const emails = Array.isArray(emailsRaw) ? emailsRaw.map((item) => extractFirstEmailAddress(item)) : [];
    for (const email of emails) {
      if (!email) continue;
      if (getLeadEmailSuppressionReason(email)) continue;
      if (seen.has(email)) continue;
      seen.add(email);
      const resolvedDomain = maybeDomain(email, domain);
      leads.push({
        email,
        name: inferNameFromEmail(email),
        company: inferCompanyFromDomain(domain) || inferCompanyFromDomain(resolvedDomain),
        title: "",
        domain: resolvedDomain,
        sourceUrl: sourceUrl || (domain ? `https://${domain}` : ""),
      });
      if (leads.length >= limit) return leads;
    }
  }

  return leads;
}

function extractEmailsFromUnknown(value: unknown, sink: Set<string>, depth = 0) {
  if (depth > 4 || sink.size > 1000) return;
  if (typeof value === "string") {
    const matches = value
      .toLowerCase()
      .match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g);
    if (!matches) return;
    for (const email of matches) {
      if (!getLeadEmailSuppressionReason(email)) {
        sink.add(email);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractEmailsFromUnknown(item, sink, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      extractEmailsFromUnknown(entry, sink, depth + 1);
    }
  }
}

export function leadsFromApifyRows(rows: unknown[], maxLeads: number): ApifyLead[] {
  const limit = Math.max(1, Math.min(500, Number(maxLeads || 100)));
  const out: ApifyLead[] = [];
  const seen = new Set<string>();

  const dedupeKey = (lead: ApifyLead) => {
    const normalizedEmail = extractFirstEmailAddress(lead.email);
    if (normalizedEmail) return `email:${normalizedEmail}`;
    const normalizedName = String(lead.name ?? "").trim().toLowerCase();
    const normalizedDomain = String(lead.domain ?? "").trim().toLowerCase();
    if (normalizedName && normalizedDomain) return `name_domain:${normalizedName}:${normalizedDomain}`;
    const normalizedSource = String(lead.sourceUrl ?? "").trim().toLowerCase();
    if (normalizedSource) return `source:${normalizedSource}`;
    return "";
  };

  for (const row of rows) {
    const normalized = normalizeApifyLead(row);
    if (!normalized) continue;
    const key = dedupeKey(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= limit) return out;
  }

  if (out.length >= limit) return out;

  for (const row of rows) {
    const record = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : {};
    const emails = new Set<string>();
    extractEmailsFromUnknown(row, emails);
    const company = String(record.company ?? record.companyName ?? record.organization ?? "").trim();
    const name = String(record.name ?? record.fullName ?? "").trim();
    const title = String(record.title ?? record.jobTitle ?? "").trim();
    const sourceUrl = String(record.url ?? record.website ?? record.profileUrl ?? "").trim();
    for (const email of emails) {
      const resolvedDomain = maybeDomain(email, "");
      const candidate: ApifyLead = {
        email,
        name: name || inferNameFromEmail(email),
        company: company || inferCompanyFromDomain(resolvedDomain),
        title,
        domain: resolvedDomain,
        sourceUrl,
      };
      const key = dedupeKey(candidate);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(candidate);
      if (out.length >= limit) return out;
    }
  }

  return out;
}

function normalizeApifyLead(raw: unknown): ApifyLead | null {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const rawEmail = extractFirstEmailAddress(
    row.email ?? row.workEmail ?? row.businessEmail ?? row.contactEmail ?? row.emailAddress ?? ""
  );
  const emailFloorReason = rawEmail ? getLeadEmailSuppressionReason(rawEmail) : "";
  const email = emailFloorReason ? "" : rawEmail;
  const firstName = String(row.firstName ?? row.firstname ?? "").trim();
  const lastName = String(row.lastName ?? row.lastname ?? "").trim();
  const name = String(row.name ?? row.fullName ?? `${firstName} ${lastName}`).trim();
  const company = String(row.company ?? row.companyName ?? row.organization ?? "").trim();
  const title = String(row.title ?? row.jobTitle ?? "").trim();
  const sourceUrl = String(
    row.url ?? row.profileUrl ?? row.linkedinUrl ?? row.website ?? row.companyWebsite ?? ""
  ).trim();
  const sourceDomain = toRegistrableDomain(safeHostname(sourceUrl));
  const fallbackDomainRaw = String(row.domain ?? row.companyDomain ?? sourceDomain ?? "")
    .trim()
    .toLowerCase();
  const fallbackDomain = isNonCompanyProfileDomain(fallbackDomainRaw) ? "" : fallbackDomainRaw;
  const resolvedDomain = email ? maybeDomain(email, fallbackDomain) : fallbackDomain;
  if (!email && (!name || !resolvedDomain)) {
    return null;
  }
  return {
    email,
    name: name || (email ? inferNameFromEmail(email) : ""),
    company: company || inferCompanyFromDomain(resolvedDomain),
    title,
    domain: resolvedDomain,
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

  const fromEmail = getOutreachAccountFromEmail(account).trim();
  const trackingApiKey = customerIoTrackApiKey(secrets);
  const appApiKey = customerIoAppApiKey(secrets);
  const rawCustomerIoPass = requiresDelivery
    ? account.provider === "customerio"
      ? Boolean(account.config.customerIo.siteId && trackingApiKey && appApiKey && fromEmail)
      : supportsMailpoolDelivery(account, secrets)
    : true;

  const rawSourcingPass = true;
  const rawMailboxPass = requiresMailbox
    ? Boolean(account.config.mailbox.email && (secrets.mailboxAccessToken || secrets.mailboxPassword))
    : true;

  let customerIoPass = shouldTestCustomerIo ? rawCustomerIoPass : true;
  let customerIoDetail = "";
  if (requiresDelivery && shouldTestCustomerIo) {
    if (!rawCustomerIoPass) {
      const missing: string[] = [];
      if (account.provider === "customerio") {
        if (!account.config.customerIo.siteId.trim()) missing.push("Site ID");
        if (!trackingApiKey) missing.push("Tracking API key");
        if (!appApiKey) missing.push("App API key");
        if (!fromEmail) missing.push("From Email");
        customerIoDetail = missing.length ? `Missing: ${missing.join(", ")}` : "Customer.io config missing";
      } else {
        if (!account.config.mailbox.smtpHost.trim()) missing.push("SMTP host");
        if (!account.config.mailbox.smtpUsername.trim()) missing.push("SMTP username");
        if (!mailboxSmtpPassword(secrets)) missing.push("SMTP password");
        if (!fromEmail) missing.push("From Email");
        customerIoDetail = missing.length ? `Missing: ${missing.join(", ")}` : "Mailpool SMTP config missing";
      }
      customerIoPass = false;
    } else if (account.provider === "customerio") {
      const auth = await testCustomerIoTrackCredentials({
        siteId: account.config.customerIo.siteId,
        apiKey: trackingApiKey,
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
    } else {
      try {
        const transport = nodemailer.createTransport({
          host: account.config.mailbox.smtpHost.trim(),
          port: account.config.mailbox.smtpPort,
          secure: account.config.mailbox.smtpSecure,
          auth: {
            user: account.config.mailbox.smtpUsername.trim(),
            pass: mailboxSmtpPassword(secrets),
          },
        });
        await transport.verify();
        customerIoPass = true;
        customerIoDetail = `SMTP verified at ${account.config.mailbox.smtpHost.trim()}`;
      } catch (error) {
        customerIoPass = false;
        customerIoDetail = error instanceof Error ? error.message : "Mailpool SMTP verification failed";
      }
    }
  }

  const apifyPass = shouldTestSourcing ? rawSourcingPass : true;
  const mailboxPass = shouldTestMailbox ? rawMailboxPass : true;

  const message =
    scope === "customerio"
      ? customerIoPass
        ? customerIoDetail
          ? `${account.provider === "customerio" ? "Customer.io" : "Mailpool"} check passed. ${customerIoDetail}`
          : `${account.provider === "customerio" ? "Customer.io" : "Mailpool"} check passed`
        : customerIoDetail
          ? `${account.provider === "customerio" ? "Customer.io" : "Mailpool"} check failed. ${customerIoDetail}`
          : `${account.provider === "customerio" ? "Customer.io" : "Mailpool"} check failed`
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

async function sendCustomerIoTransactionalEmail(params: {
  account: OutreachAccount;
  secrets: OutreachAccountSecrets;
  recipient: string;
  fromEmail: string;
  replyToEmail: string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}): Promise<{ ok: boolean; providerMessageId: string; error: string }> {
  const appApiKey = customerIoAppApiKey(params.secrets);
  if (!appApiKey) {
    return {
      ok: false,
      providerMessageId: "",
      error: "Customer.io App API key missing",
    };
  }

  const normalizedRecipient = params.recipient.trim().toLowerCase();
  const normalizedFromEmail = params.fromEmail.trim();
  const normalizedReplyToEmail = params.replyToEmail.trim();
  const normalizedSubject = params.subject.trim();
  const normalizedBody = params.body.trim();
  if (!normalizedRecipient || !normalizedFromEmail || !normalizedReplyToEmail || !normalizedSubject || !normalizedBody) {
    return {
      ok: false,
      providerMessageId: "",
      error: "Customer.io transactional email payload is incomplete",
    };
  }

  const basePayload = {
    to: normalizedRecipient,
    from: normalizedFromEmail,
    reply_to: normalizedReplyToEmail,
    subject: normalizedSubject,
    body_plain: normalizedBody,
    body: htmlFromPlainText(normalizedBody),
    identifiers: {
      email: normalizedRecipient,
    },
    message_data: params.metadata ?? {},
  };

  const configuredTemplateId = String(process.env.CUSTOMER_IO_TRANSACTIONAL_MESSAGE_ID ?? "").trim();
  const payloads = configuredTemplateId
    ? [
        {
          ...basePayload,
          transactional_message_id: configuredTemplateId,
        },
      ]
    : [
        basePayload,
        {
          ...basePayload,
          transactional_message_id: 1,
        },
      ];

  const errors: string[] = [];
  for (const baseUrl of customerIoAppBaseUrls()) {
    for (const payload of payloads) {
      try {
        const response = await fetch(`${baseUrl}/send/email`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${appApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          cache: "no-store",
        });

        const raw = await response.text();
        const payloadJson: unknown = raw
          ? (() => {
              try {
                return JSON.parse(raw);
              } catch {
                return {};
              }
            })()
          : {};
        if (response.ok) {
          const providerMessageId =
            customerIoResponseMessageId(payloadJson, response.headers.get("x-request-id") ?? "") ||
            response.headers.get("x-request-id") ||
            response.headers.get("x-customerio-delivery-id") ||
            "";
          return {
            ok: true,
            providerMessageId,
            error: "",
          };
        }

        const detail = raw.trim().slice(0, 300);
        errors.push(`Customer.io send/email ${baseUrl} HTTP ${response.status}${detail ? `: ${detail}` : ""}`);

        const looksLikeTemplateRequirement =
          !("transactional_message_id" in payload) &&
          (response.status === 400 || response.status === 422) &&
          /transactional_message_id|required/i.test(detail);
        if (looksLikeTemplateRequirement) {
          continue;
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `Customer.io send/email failed for ${baseUrl}`);
      }
    }
  }

  return {
    ok: false,
    providerMessageId: "",
    error: errors.join(" · ") || "Customer.io transactional send failed",
  };
}

async function sendMailpoolSmtpEmail(params: {
  account: OutreachAccount;
  secrets: OutreachAccountSecrets;
  recipient: string;
  fromEmail: string;
  replyToEmail: string;
  subject: string;
  body: string;
}): Promise<{ ok: boolean; providerMessageId: string; error: string }> {
  const smtpHost = params.account.config.mailbox.smtpHost.trim();
  const smtpUsername = params.account.config.mailbox.smtpUsername.trim();
  const smtpPassword = mailboxSmtpPassword(params.secrets);
  const recipient = params.recipient.trim().toLowerCase();
  const fromEmail = params.fromEmail.trim();
  const replyToEmail = params.replyToEmail.trim();
  const subject = params.subject.trim();
  const body = params.body.trim();
  if (!smtpHost || !smtpUsername || !smtpPassword) {
    return {
      ok: false,
      providerMessageId: "",
      error: "Mailpool SMTP credentials are incomplete",
    };
  }
  if (!recipient || !fromEmail || !replyToEmail || !subject || !body) {
    return {
      ok: false,
      providerMessageId: "",
      error: "Mailpool SMTP payload is incomplete",
    };
  }

  try {
    const transport = nodemailer.createTransport({
      host: smtpHost,
      port: params.account.config.mailbox.smtpPort,
      secure: params.account.config.mailbox.smtpSecure,
      auth: {
        user: smtpUsername,
        pass: smtpPassword,
      },
    });
    const info = await transport.sendMail({
      from: fromEmail,
      to: recipient,
      replyTo: replyToEmail,
      subject,
      text: body,
      html: htmlFromPlainText(body),
    });
    return {
      ok: true,
      providerMessageId: String(info.messageId ?? "").trim(),
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      providerMessageId: "",
      error: error instanceof Error ? error.message : "Mailpool SMTP send failed",
    };
  }
}

async function sendDeliveryEmail(params: {
  account: OutreachAccount;
  secrets: OutreachAccountSecrets;
  recipient: string;
  fromEmail: string;
  replyToEmail: string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}) {
  if (params.account.provider === "mailpool") {
    return sendMailpoolSmtpEmail(params);
  }
  return sendCustomerIoTransactionalEmail(params);
}

export async function sendReplyDraftAsEvent(params: {
  draft: ReplyDraft;
  account: OutreachAccount;
  secrets: OutreachAccountSecrets;
  recipient: string;
  replyToEmail?: string;
}): Promise<{ ok: boolean; providerMessageId: string; error: string }> {
  const fromEmail = getOutreachAccountFromEmail(params.account).trim();
  const replyToEmail =
    (params.replyToEmail ?? getOutreachAccountReplyToEmail(params.account)).trim() || fromEmail;
  const result = await sendDeliveryEmail({
    account: params.account,
    secrets: params.secrets,
    recipient: params.recipient,
    fromEmail,
    replyToEmail,
    subject: params.draft.subject,
    body: params.draft.body,
    metadata: {
      draftId: params.draft.id,
      threadId: params.draft.threadId,
      runId: params.draft.runId,
      replyDraft: true,
    },
  });

  return {
    ok: result.ok,
    providerMessageId: result.providerMessageId,
    error: result.error,
  };
}

export async function sendMonitoringProbeMessage(params: {
  account: OutreachAccount;
  secrets: OutreachAccountSecrets;
  replyToEmail: string;
  recipient: string;
  runId: string;
  experimentId: string;
  subject: string;
  body: string;
  probeVariant?: "baseline" | "production";
  probeToken: string;
  monitorAccountId: string;
  monitorEmail: string;
  sourceMessageId?: string;
  sourceMessageStatus?: string;
  sourceType?: string;
  sourceNodeId?: string;
  sourceLeadId?: string;
  contentHash?: string;
}): Promise<{ ok: boolean; providerMessageId: string; error: string }> {
  const fromEmail = getOutreachAccountFromEmail(params.account).trim();
  const replyToEmail = params.replyToEmail.trim();
  if (!fromEmail) {
    return {
      ok: false,
      providerMessageId: "",
      error: `${params.account.provider === "mailpool" ? "Mailpool" : "Customer.io"} From Email missing`,
    };
  }
  if (!replyToEmail) {
    return { ok: false, providerMessageId: "", error: "Reply-To email missing" };
  }
  return sendDeliveryEmail({
    account: params.account,
    secrets: params.secrets,
    recipient: params.recipient,
    fromEmail,
    replyToEmail,
    subject: params.subject,
    body: params.body,
    metadata: {
      runId: params.runId,
      experimentId: params.experimentId,
      messageId: `monitor_${params.probeToken}`,
      step: 0,
      monitoring: true,
      monitor_probe: true,
      probeVariant: params.probeVariant ?? "production",
      probeToken: params.probeToken,
      monitorAccountId: params.monitorAccountId,
      monitorEmail: params.monitorEmail,
      sourceMessageId: params.sourceMessageId ?? "",
      sourceMessageStatus: params.sourceMessageStatus ?? "",
      sourceType: params.sourceType ?? "",
      sourceNodeId: params.sourceNodeId ?? "",
      sourceLeadId: params.sourceLeadId ?? "",
      contentHash: params.contentHash ?? "",
    },
  });
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
  const fromEmail = getOutreachAccountFromEmail(params.account).trim();
  const replyToEmail = params.replyToEmail.trim();
  if (!fromEmail) {
    return {
      ok: false,
      providerMessageId: "",
      error: `${params.account.provider === "mailpool" ? "Mailpool" : "Customer.io"} From Email missing`,
    };
  }
  if (!replyToEmail) {
    return { ok: false, providerMessageId: "", error: "Reply-To email missing" };
  }
  return sendDeliveryEmail({
    account: params.account,
    secrets: params.secrets,
    recipient: params.recipient,
    fromEmail,
    replyToEmail,
    subject: params.message.subject,
    body: params.message.body,
    metadata: {
      runId: params.runId,
      experimentId: params.experimentId,
      messageId: params.message.id,
      step: params.message.step,
    },
  });
}
