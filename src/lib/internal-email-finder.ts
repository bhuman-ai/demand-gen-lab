import { promises as dns } from "dns";
import { readFile } from "fs/promises";
import { createClient } from "@supabase/supabase-js";
import type { EmailVerificationState } from "@/lib/factory-types";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { appendEmailFinderAuditEntry } from "@/lib/email-finder-observability";
import {
  localVerifyEmail,
  remoteVerifyEmail,
  resolveLocalVerificationConfig,
} from "@/lib/email-verification-local";

type EmailFinderVerificationMode = "local" | "heuristic";

type PatternShape = {
  separator: "." | "_" | "-" | "mixed" | "none";
  tokenCount: number;
  firstTokenLen: number;
  secondTokenLen: number;
  firstInitial: boolean;
  secondInitial: boolean;
  hasDigits: boolean;
};

type PatternProfile = {
  stage: "completed" | "empty";
  sampleSize: number;
  knownEmailsUsed: string[];
  ignoredInputs: Array<{ email: string; reason: string }>;
  separatorCounts: Record<string, number>;
  tokenCountCounts: Record<string, number>;
  firstInitialCounts: Record<string, number>;
  secondInitialCounts: Record<string, number>;
  digitCounts: Record<string, number>;
  meanFirstTokenLen: number | null;
  meanSecondTokenLen: number | null;
};

type PatternScoreRow = {
  email: string;
  pattern_score: number;
  shape: {
    separator: PatternShape["separator"];
    token_count: number;
    first_token_len: number;
    second_token_len: number;
    first_initial: boolean;
    second_initial: boolean;
    has_digits: boolean;
  };
};

type MxRecord = {
  priority: number;
  host: string;
  implicit?: boolean;
};

type DomainMailSignal = {
  status: "mail-ready" | "no-mail-route" | "unknown";
  records: MxRecord[];
  error: string;
};

type DomainInsights = {
  domain: string;
  mx: DomainMailSignal;
  historicalKnownEmails: string[];
  enrichAnythingKnownEmails: string[];
  enrichAnythingObservedContacts: EmailIntelligenceContact[];
  enrichAnythingDomainRecord: EmailIntelligenceDomainRecord | null;
};

type EmailIntelligenceContact = {
  email: string;
  displayName: string;
  localPart: string;
  domain: string;
  validityStatus: string;
  observedValid: boolean | null;
  lastSeenAt: string;
};

type EmailIntelligenceDomainRecord = {
  domain: string;
  inferredPattern: string;
  patternConfidence: number | null;
  patternSampleCount: number;
};

type QueueItem = {
  email: string;
  attempt: number;
  verdict: string;
  confidence: string;
  p_valid?: number;
  route: string;
  route_reason: string;
};

type ValidationConfig = {
  requestId: string;
  auditSource: string;
  auditContext: Record<string, unknown>;
  id: string;
  name: string;
  companyName: string;
  domain: string;
  linkedinProfileUrl: string;
  maxCandidates: number;
  knownEmails: string[];
  verificationMode: EmailFinderVerificationMode;
  maxCredits: number;
  timeoutSeconds: number;
  stopOnFirstHit: boolean;
  stopOnMinConfidence: "none" | "low" | "medium" | "high";
  hitStatuses: string[];
  highConfidenceOnly: boolean;
  enableRiskyQueue: boolean;
  canaryMode: boolean;
  canarySent: number;
  canaryHardBounces: number;
  canaryMinSamples: number;
  canaryMaxHardBounceRate: number;
  localVerificationEnabled: boolean;
  localFallbackOnRisky: boolean;
  externalProviderFallbackEnabled: boolean;
  externalProviderNames: string[];
};

export type ExactEmailVerificationResult = {
  email: string;
  realVerifiedEmail: boolean;
  emailVerification: EmailVerificationState | null;
};

const TABLE_RUN_LEAD = "demanddev_outreach_run_leads";
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]+)+$/;
const PREVIEW_PLACEHOLDER_EMAIL_PREFIX = "preview-missing-email+";
const OUTREACH_PATH = process.env.VERCEL ? "/tmp/factory_outreach.v1.json" : `${process.cwd()}/data/outreach.v1.json`;
const TRUSTED_STATUSES = new Set(["replied", "unsubscribed"]);
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
const ROLE_LOCALS = new Set([
  "admin",
  "careers",
  "contact",
  "hello",
  "help",
  "hi",
  "hr",
  "info",
  "jobs",
  "marketing",
  "press",
  "sales",
  "support",
  "team",
]);
const MAX_BATCH_ITEMS = 200;
const MAX_BATCH_CONCURRENCY = 10;
const DEFAULT_EXTERNAL_EMAIL_PROVIDERS = ["airscale"];

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clamp(value: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(value, hi));
}

function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function boundedFloat(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function parseBool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(lowered)) return true;
    if (["0", "false", "no", "n", "off"].includes(lowered)) return false;
  }
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function toNullableBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return null;
}

function generateRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `emailfinder-${Date.now()}`;
}

function normalizeDomain(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/^\.+|\.+$/g, "");
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

function normalizeNameToken(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9'-]/g, "")
    .replace(/^['-]+|['-]+$/g, "");
}

function normalizeLocalPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/[._-]{2,}/g, (match) => match[0] ?? "")
    .replace(/^[._-]+|[._-]+$/g, "");
}

function normalizeNameParts(value: unknown) {
  return String(value ?? "")
    .trim()
    .split(/\s+/)
    .map((part) => normalizeNameToken(part))
    .filter(Boolean);
}

function uniqueInOrder(values: string[]) {
  const seen = new Set<string>();
  const ordered = [] as string[];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}

function extractFirstEmailAddress(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const match = text.match(EMAIL_RE);
  if (match) return match[0].toLowerCase();
  const embedded = text.match(/([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/);
  return embedded?.[1]?.toLowerCase() ?? "";
}

function cleanEnvValue(value: unknown) {
  return String(value ?? "")
    .replace(/\\r|\\n/g, "")
    .trim();
}

function normalizeLinkedInProfileUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!["linkedin.com", "linkedin.co"].some((root) => host === root || host.endsWith(`.${root}`))) {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeProviderNames(value: unknown) {
  const raw =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.join(",")
        : cleanEnvValue(process.env.EMAIL_FINDER_EXTERNAL_PROVIDERS ?? process.env.EMAIL_FINDER_PAID_PROVIDERS);
  const normalized = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return uniqueInOrder(normalized.length ? normalized : DEFAULT_EXTERNAL_EMAIL_PROVIDERS);
}

function normalizeExternalProviderFallbackEnabled(value: unknown) {
  const explicit = String(value ?? "").trim();
  if (explicit) return parseBool(explicit, false);
  const envValue = cleanEnvValue(
    process.env.EMAIL_FINDER_EXTERNAL_WATERFALL_ENABLED ??
      process.env.EMAIL_FINDER_PAID_PROVIDER_FALLBACK_ENABLED ??
      process.env.EMAIL_FINDER_AIRSCALE_ENABLED
  );
  if (envValue) return parseBool(envValue, false);
  return false;
}

function looksLikeRoleInbox(email: string) {
  const local = email.split("@", 1)[0] ?? "";
  return ROLE_LOCALS.has(local);
}

function isUsableKnownEmail(email: string, domain: string) {
  const normalized = extractFirstEmailAddress(email);
  if (!normalized || !EMAIL_RE.test(normalized)) return false;
  if (normalized.startsWith(PREVIEW_PLACEHOLDER_EMAIL_PREFIX)) return false;
  const [, emailDomain = ""] = normalized.split("@");
  if (emailDomain !== domain) return false;
  if (isNonCompanyProfileDomain(emailDomain)) return false;
  if (looksLikeRoleInbox(normalized)) return false;
  return true;
}

function parsePersonName(value: unknown) {
  const parts = normalizeNameParts(value);
  if (parts.length < 2) return null;
  return {
    first: parts[0] ?? "",
    last: parts[parts.length - 1] ?? "",
  };
}

function generatePatternLocalPart(pattern: string, personName: string) {
  const person = parsePersonName(personName);
  if (!person) return "";
  const firstInitial = person.first[0] ?? "";
  const lastInitial = person.last[0] ?? "";
  const normalized = pattern.trim().toLowerCase();
  const localPart =
    normalized === "first"
      ? person.first
      : normalized === "first.last"
        ? `${person.first}.${person.last}`
        : normalized === "first_last"
          ? `${person.first}_${person.last}`
          : normalized === "first-last"
            ? `${person.first}-${person.last}`
            : normalized === "firstlast"
              ? `${person.first}${person.last}`
              : normalized === "flast"
                ? `${firstInitial}${person.last}`
                : normalized === "firstl"
                  ? `${person.first}${lastInitial}`
                  : normalized === "f.last"
                    ? `${firstInitial}.${person.last}`
                    : normalized === "first.l"
                      ? `${person.first}.${lastInitial}`
                      : normalized === "last.first"
                        ? `${person.last}.${person.first}`
                        : normalized === "lastf"
                          ? `${person.last}${firstInitial}`
                          : normalized === "f_last"
                            ? `${firstInitial}_${person.last}`
                            : normalized === "last"
                              ? person.last
                              : "";
  return normalizeLocalPart(localPart);
}

function findObservedPersonContactEmails(personName: string, contacts: EmailIntelligenceContact[]) {
  const person = parsePersonName(personName);
  if (!person) return [];
  const generatedLocals = new Set(generateLocalParts(personName));
  const scored = [] as Array<{ email: string; score: number }>;

  for (const contact of contacts) {
    const contactPerson = parsePersonName(contact.displayName);
    let score = 0;
    if (contactPerson?.first === person.first && contactPerson.last === person.last) {
      score += 100;
    } else if (contactPerson?.last === person.last) {
      score += 20;
    }
    if (generatedLocals.has(contact.localPart)) {
      score += 30;
    }
    if (score >= 100) {
      scored.push({ email: contact.email, score });
    }
  }

  return scored
    .sort((left, right) => right.score - left.score)
    .map((row) => row.email);
}

function inferredPatternCandidateEmail(input: {
  personName: string;
  domain: string;
  domainRecord: EmailIntelligenceDomainRecord | null;
}) {
  const domainRecord = input.domainRecord;
  if (!domainRecord?.inferredPattern) return "";
  if ((domainRecord.patternConfidence ?? 0) < 0.5 || domainRecord.patternSampleCount < 1) return "";
  const localPart = generatePatternLocalPart(domainRecord.inferredPattern, input.personName);
  if (!localPart) return "";
  const email = `${localPart}@${input.domain}`;
  return isUsableKnownEmail(email, input.domain) ? email : "";
}

function localShape(localPart: string): PatternShape {
  const hasDot = localPart.includes(".");
  const hasUnderscore = localPart.includes("_");
  const hasHyphen = localPart.includes("-");

  let separator: PatternShape["separator"] = "none";
  let tokens = [localPart];
  if ([hasDot, hasUnderscore, hasHyphen].filter(Boolean).length > 1) {
    separator = "mixed";
    tokens = localPart.split(/[._-]+/).filter(Boolean);
  } else if (hasDot) {
    separator = ".";
    tokens = localPart.split(".").filter(Boolean);
  } else if (hasUnderscore) {
    separator = "_";
    tokens = localPart.split("_").filter(Boolean);
  } else if (hasHyphen) {
    separator = "-";
    tokens = localPart.split("-").filter(Boolean);
  }

  const first = tokens[0] ?? "";
  const second = tokens[1] ?? "";

  return {
    separator,
    tokenCount: tokens.length,
    firstTokenLen: first.length,
    secondTokenLen: second.length,
    firstInitial: first.length === 1,
    secondInitial: second.length === 1,
    hasDigits: /\d/.test(localPart),
  };
}

function distributionScore(value: string, counts: Record<string, number>) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return (Number(counts[value] ?? 0) + 0.5) / (total + 0.5 * (Object.keys(counts).length + 1));
}

function generateLocalParts(fullName: string) {
  const parts = normalizeNameParts(fullName);
  if (!parts.length) return [];

  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  const firstInitial = first[0] ?? "";
  const lastInitial = last[0] ?? "";

  const candidates = [first];
  if (last) {
    candidates.push(
      `${first}.${last}`,
      `${first}_${last}`,
      `${first}-${last}`,
      `${first}${last}`,
      `${firstInitial}${last}`,
      `${first}${lastInitial}`,
      `${firstInitial}.${last}`,
      `${first}.${lastInitial}`,
      `${last}.${first}`,
      `${last}${firstInitial}`,
      `${firstInitial}_${last}`,
      last
    );
  }

  return uniqueInOrder(
    candidates
      .map((candidate) =>
        candidate
          .replace(/\.+/g, ".")
          .replace(/^\.|\.$/g, "")
          .replace(/[_-]{2,}/g, "_")
      )
      .map((candidate) => normalizeLocalPart(candidate))
      .filter(Boolean)
  );
}

function buildPatternProfile(knownEmails: string[], domain: string): PatternProfile {
  const validKnown = [] as Array<{ email: string; localPart: string; shape: PatternShape }>;
  const ignoredInputs = [] as Array<{ email: string; reason: string }>;

  for (const raw of knownEmails) {
    const email = extractFirstEmailAddress(raw);
    if (!email) continue;
    if (!EMAIL_RE.test(email)) {
      ignoredInputs.push({ email, reason: "invalid email syntax" });
      continue;
    }
    const [localPart, emailDomain = ""] = email.split("@");
    if (emailDomain !== domain) {
      ignoredInputs.push({ email, reason: "different domain" });
      continue;
    }
    validKnown.push({ email, localPart, shape: localShape(localPart) });
  }

  const separatorCounts = {} as Record<string, number>;
  const tokenCountCounts = {} as Record<string, number>;
  const firstInitialCounts = {} as Record<string, number>;
  const secondInitialCounts = {} as Record<string, number>;
  const digitCounts = {} as Record<string, number>;
  const firstLengths = [] as number[];
  const secondLengths = [] as number[];

  for (const item of validKnown) {
    const { shape } = item;
    separatorCounts[shape.separator] = (separatorCounts[shape.separator] ?? 0) + 1;
    tokenCountCounts[String(shape.tokenCount)] = (tokenCountCounts[String(shape.tokenCount)] ?? 0) + 1;
    firstInitialCounts[String(shape.firstInitial)] = (firstInitialCounts[String(shape.firstInitial)] ?? 0) + 1;
    secondInitialCounts[String(shape.secondInitial)] = (secondInitialCounts[String(shape.secondInitial)] ?? 0) + 1;
    digitCounts[String(shape.hasDigits)] = (digitCounts[String(shape.hasDigits)] ?? 0) + 1;
    firstLengths.push(shape.firstTokenLen);
    if (shape.secondTokenLen > 0) secondLengths.push(shape.secondTokenLen);
  }

  const sampleSize = validKnown.length;

  return {
    stage: sampleSize ? "completed" : "empty",
    sampleSize,
    knownEmailsUsed: validKnown.map((item) => item.email),
    ignoredInputs,
    separatorCounts,
    tokenCountCounts,
    firstInitialCounts,
    secondInitialCounts,
    digitCounts,
    meanFirstTokenLen: sampleSize ? firstLengths.reduce((sum, value) => sum + value, 0) / sampleSize : null,
    meanSecondTokenLen: secondLengths.length
      ? secondLengths.reduce((sum, value) => sum + value, 0) / secondLengths.length
      : null,
  };
}

function scoreCandidateWithPattern(localPart: string, profile: PatternProfile) {
  if (!profile.sampleSize) return 0.5;

  const shape = localShape(localPart);
  let score = 0;
  score += 0.4 * distributionScore(shape.separator, profile.separatorCounts);
  score += 0.25 * distributionScore(String(shape.tokenCount), profile.tokenCountCounts);
  score += 0.15 * distributionScore(String(shape.firstInitial), profile.firstInitialCounts);
  score += 0.05 * distributionScore(String(shape.secondInitial), profile.secondInitialCounts);
  score += 0.05 * distributionScore(String(shape.hasDigits), profile.digitCounts);

  if (typeof profile.meanFirstTokenLen === "number") {
    const delta = Math.abs(shape.firstTokenLen - profile.meanFirstTokenLen);
    score += 0.1 * Math.max(0, 1 - delta / 10);
  }

  return Number(clamp(score, 0, 1).toFixed(3));
}

function buildPatternScores(emails: string[], profile: PatternProfile) {
  const rows = emails.map((email) => {
    const localPart = email.split("@", 1)[0] ?? "";
    const shape = localShape(localPart);
    return {
      email,
      pattern_score: scoreCandidateWithPattern(localPart, profile),
      shape: {
        separator: shape.separator,
        token_count: shape.tokenCount,
        first_token_len: shape.firstTokenLen,
        second_token_len: shape.secondTokenLen,
        first_initial: shape.firstInitial,
        second_initial: shape.secondInitial,
        has_digits: shape.hasDigits,
      },
    } satisfies PatternScoreRow;
  });

  rows.sort((left, right) => right.pattern_score - left.pattern_score);
  return rows;
}

function buildCandidates(config: ValidationConfig, knownEmails: string[], priorityEmails: string[] = []) {
  const localParts = generateLocalParts(config.name);
  if (!localParts.length) {
    throw new Error("could not generate candidates from name");
  }

  const generated = localParts.map((localPart) => `${localPart}@${config.domain}`);
  const cleanedKnownEmails = uniqueInOrder(knownEmails.filter((email) => isUsableKnownEmail(email, config.domain)));
  const priorityCandidates = uniqueInOrder(
    priorityEmails
      .map((email) => extractFirstEmailAddress(email))
      .filter((email) => isUsableKnownEmail(email, config.domain))
  );

  if (!cleanedKnownEmails.length) {
    const orderedCandidates = uniqueInOrder([...priorityCandidates, ...generated]).slice(0, config.maxCandidates);
    return {
      orderedCandidates,
      patternScores: {} as Record<string, number>,
      orderingMeta: {
        method: priorityCandidates.length ? "priority_then_generation_order" : "generation_order",
        priority_candidates: priorityCandidates,
      },
      profile: buildPatternProfile([], config.domain),
    };
  }

  const profile = buildPatternProfile(cleanedKnownEmails, config.domain);
  const rows = buildPatternScores(generated, profile);
  const orderedCandidates = uniqueInOrder([...priorityCandidates, ...rows.map((row) => row.email)]).slice(
    0,
    config.maxCandidates
  );

  return {
    orderedCandidates,
    patternScores: Object.fromEntries(rows.map((row) => [row.email, row.pattern_score])),
    orderingMeta: {
      method: priorityCandidates.length ? "priority_then_pattern_score" : "pattern_score",
      priority_candidates: priorityCandidates,
      profile: {
        stage: profile.stage,
        sample_size: profile.sampleSize,
        known_emails_used: profile.knownEmailsUsed,
        ignored_inputs: profile.ignoredInputs,
        separator_counts: profile.separatorCounts,
        token_count_counts: profile.tokenCountCounts,
        first_initial_counts: profile.firstInitialCounts,
        second_initial_counts: profile.secondInitialCounts,
        digit_counts: profile.digitCounts,
        mean_first_token_len: profile.meanFirstTokenLen,
        mean_second_token_len: profile.meanSecondTokenLen,
      },
      scores: rows,
    },
    profile,
  };
}

function probabilityToOdds(probability: number) {
  const p = clamp(probability, 1e-6, 1 - 1e-6);
  return p / (1 - p);
}

function oddsToProbability(odds: number) {
  if (odds <= 0) return 0;
  return odds / (1 + odds);
}

function computeAttemptPValid(input: {
  attempt: Record<string, unknown>;
  candidateIndex: number;
  candidateCount: number;
  patternScore?: number;
}) {
  const verdict = String(input.attempt.verdict ?? "unknown").trim().toLowerCase();
  const confidence = String(input.attempt.confidence ?? "low").trim().toLowerCase();
  const details = asRecord(input.attempt.details);

  const prior =
    typeof input.patternScore === "number"
      ? clamp(0.15 + 0.7 * input.patternScore, 0.02, 0.95)
      : clamp(
          0.2 +
            0.5 *
              (1 -
                input.candidateIndex /
                  Math.max(input.candidateCount > 1 ? input.candidateCount - 1 : 1, 1)),
          0.02,
          0.9
        );

  const verdictMultiplier =
    {
      "likely-valid": 5,
      "risky-valid": 2,
      valid: 5,
      deliverable: 5,
      invalid: 0.03,
      unknown: 1,
    }[verdict] ?? 1;
  const confidenceMultiplier =
    {
      high: 1.4,
      medium: 1.15,
      low: 0.9,
    }[confidence] ?? 1;

  const acceptAll = details.accept_all === true || String(details.smtp_status ?? "").trim().toLowerCase() === "accept-all-likely";
  const acceptAllMultiplier = acceptAll ? 0.55 : 1;
  const mxStatus = String(details.mx_status ?? "").trim().toLowerCase();
  const mxMultiplier = mxStatus === "mail-ready" ? 1.15 : mxStatus === "no-mail-route" ? 0.05 : 1;

  let odds = probabilityToOdds(prior);
  odds *= verdictMultiplier;
  odds *= confidenceMultiplier;
  odds *= acceptAllMultiplier;
  odds *= mxMultiplier;
  odds = clamp(odds, 0.001, 1000);
  return Number(oddsToProbability(odds).toFixed(4));
}

function confidenceRank(level: string) {
  const normalized = level.trim().toLowerCase();
  if (normalized === "high") return 2;
  if (normalized === "medium") return 1;
  if (normalized === "low") return 0;
  return -1;
}

function buildEmailVerificationStateFromAttempt(input: {
  verificationModeUsed: EmailFinderVerificationMode;
  attempt: Record<string, unknown>;
}): EmailVerificationState | null {
  const details = asRecord(input.attempt.details);
  const snapshot: EmailVerificationState = {
    mode: input.verificationModeUsed,
    provider: String(details.provider ?? "").trim().toLowerCase(),
    verdict: String(input.attempt.verdict ?? "").trim().toLowerCase(),
    confidence: String(input.attempt.confidence ?? "").trim().toLowerCase(),
    reason: String(details.reason ?? details.provider_reason ?? "").trim(),
    mxStatus: String(details.mx_status ?? "").trim().toLowerCase(),
    acceptAll: toNullableBool(details.accept_all ?? details.acceptall),
    catchAll: toNullableBool(details.catch_all ?? details.catchall),
    pValid:
      typeof input.attempt.p_valid === "number" && Number.isFinite(input.attempt.p_valid)
        ? input.attempt.p_valid
        : typeof details.p_valid === "number" && Number.isFinite(details.p_valid)
          ? details.p_valid
          : null,
    httpStatus:
      typeof details.http_status === "number" && Number.isFinite(details.http_status)
        ? details.http_status
        : null,
    providerStatus: String(details.provider_status ?? details.providerStatus ?? "").trim(),
  };
  if (
    !snapshot.mode &&
    !snapshot.provider &&
    !snapshot.verdict &&
    !snapshot.confidence &&
    !snapshot.reason &&
    !snapshot.mxStatus &&
    snapshot.acceptAll === null &&
    snapshot.catchAll === null
  ) {
    return null;
  }
  return snapshot;
}

function isSafeExactVerificationState(state: EmailVerificationState | null) {
  if (!state) return false;
  const verdict = String(state.verdict ?? "").trim().toLowerCase();
  return (
    state.mode !== "heuristic" &&
    ["likely-valid", "valid", "accepted", "deliverable"].includes(verdict) &&
    state.acceptAll !== true &&
    state.catchAll !== true
  );
}

function queueItemFromAttempt(attempt: Record<string, unknown>, route: string, reason: string): QueueItem {
  return {
    email: String(attempt.email ?? ""),
    attempt: Number(attempt.attempt ?? 0),
    verdict: String(attempt.verdict ?? ""),
    confidence: String(attempt.confidence ?? ""),
    p_valid: typeof attempt.p_valid === "number" ? attempt.p_valid : undefined,
    route,
    route_reason: reason,
  };
}

function sortQueueByProbability(items: QueueItem[]) {
  items.sort((left, right) => {
    const pDelta = Number(right.p_valid ?? -1) - Number(left.p_valid ?? -1);
    if (pDelta !== 0) return pDelta;
    return left.attempt - right.attempt;
  });
}

function routeAttempts(
  attempts: Array<Record<string, unknown>>,
  config: Pick<
    ValidationConfig,
    "highConfidenceOnly" | "enableRiskyQueue" | "canaryMode" | "canarySent" | "canaryHardBounces" | "canaryMinSamples" | "canaryMaxHardBounceRate"
  >
) {
  const highConfidence = [] as QueueItem[];
  let riskyQueue = [] as QueueItem[];
  const suppressed = [] as QueueItem[];
  const reviewQueue = [] as QueueItem[];

  for (const attempt of attempts) {
    const verdict = String(attempt.verdict ?? "unknown").trim().toLowerCase();
    const confidence = String(attempt.confidence ?? "low").trim().toLowerCase();

    if (verdict === "invalid") {
      suppressed.push(queueItemFromAttempt(attempt, "suppressed", "invalid verdict"));
      continue;
    }

    if (["likely-valid", "risky-valid", "valid", "deliverable"].includes(verdict)) {
      if ((verdict === "likely-valid" || verdict === "valid" || verdict === "deliverable") && confidence === "high") {
        highConfidence.push(
          queueItemFromAttempt(attempt, "high_confidence", "likely-valid + high confidence")
        );
      } else if (config.enableRiskyQueue) {
        riskyQueue.push(
          queueItemFromAttempt(attempt, "risky_queue", "mail-ready domain but confidence is not high")
        );
      } else {
        reviewQueue.push(queueItemFromAttempt(attempt, "review_queue", "risky queue disabled"));
      }
      continue;
    }

    reviewQueue.push(queueItemFromAttempt(attempt, "review_queue", "unknown or indeterminate verdict"));
  }

  const hardBounceRate = config.canarySent > 0 ? Number((config.canaryHardBounces / config.canarySent).toFixed(4)) : null;
  const canary = {
    enabled: config.canaryMode,
    policy: {
      min_samples: config.canaryMinSamples,
      max_hard_bounce_rate: config.canaryMaxHardBounceRate,
    },
    observations: {
      sent: config.canarySent,
      hard_bounces: config.canaryHardBounces,
      hard_bounce_rate: hardBounceRate,
    },
    decision: "disabled",
    decision_reason: "canary_mode=false",
    promoted_count: 0,
    suppressed_count: 0,
  };

  if (config.canaryMode) {
    if (!riskyQueue.length) {
      canary.decision = "no_risky_candidates";
      canary.decision_reason = "no risky candidates to evaluate";
    } else if (config.canarySent < config.canaryMinSamples) {
      canary.decision = "hold";
      canary.decision_reason = `need at least ${config.canaryMinSamples} observed canary sends`;
    } else if (typeof hardBounceRate === "number" && hardBounceRate <= config.canaryMaxHardBounceRate) {
      if (config.highConfidenceOnly) {
        canary.decision = "hold_high_confidence_only";
        canary.decision_reason = "high-confidence-only policy disables canary promotion";
      } else {
        const promoted = riskyQueue.map((item) => ({
          ...item,
          route: "high_confidence",
          route_reason: "promoted by canary policy",
        }));
        highConfidence.push(...promoted);
        riskyQueue = [];
        canary.decision = "promote";
        canary.decision_reason = `hard_bounce_rate ${hardBounceRate.toFixed(4)} <= threshold ${config.canaryMaxHardBounceRate.toFixed(4)}`;
        canary.promoted_count = promoted.length;
      }
    } else {
      const demoted = riskyQueue.map((item) => ({
        ...item,
        route: "suppressed",
        route_reason: "suppressed by canary policy",
      }));
      suppressed.push(...demoted);
      riskyQueue = [];
      canary.decision = "suppress";
      canary.decision_reason =
        typeof hardBounceRate === "number"
          ? `hard_bounce_rate ${hardBounceRate.toFixed(4)} > threshold ${config.canaryMaxHardBounceRate.toFixed(4)}`
          : "no canary bounce-rate signal";
      canary.suppressed_count = demoted.length;
    }
  }

  // Hard rule: only high-confidence candidates are eligible to be returned/sent.
  const eligibleSendNow = [...highConfidence];
  sortQueueByProbability(highConfidence);
  sortQueueByProbability(riskyQueue);
  sortQueueByProbability(suppressed);
  sortQueueByProbability(reviewQueue);
  sortQueueByProbability(eligibleSendNow);

  return {
    high_confidence_only: true,
    enable_risky_queue: config.enableRiskyQueue,
    queues: {
      eligible_send_now: eligibleSendNow,
      high_confidence: highConfidence,
      risky_queue: riskyQueue,
      suppressed,
      review_queue: reviewQueue,
    },
    canary,
  };
}

function buildBestGuess(attempts: Array<Record<string, unknown>>, routing?: Record<string, unknown>) {
  const allowedVerdicts = new Set(["likely-valid", "valid", "accepted", "deliverable"]);
  const isHighConfidenceAttempt = (row: Record<string, unknown>) => {
    const email = String(row.email ?? "").trim();
    const verdict = String(row.verdict ?? "")
      .trim()
      .toLowerCase();
    const confidence = String(row.confidence ?? "")
      .trim()
      .toLowerCase();
    return Boolean(email) && allowedVerdicts.has(verdict) && confidence === "high";
  };
  const rankRows = (rows: Record<string, unknown>[]) =>
    [...rows].sort((left, right) => {
      const confidenceDelta = confidenceRank(String(right.confidence ?? "")) - confidenceRank(String(left.confidence ?? ""));
      if (confidenceDelta !== 0) return confidenceDelta;
      const pValidDelta = Number(right.p_valid ?? -1) - Number(left.p_valid ?? -1);
      if (pValidDelta !== 0) return pValidDelta;
      return Number(left.attempt ?? 10_000) - Number(right.attempt ?? 10_000);
    });
  const toBestGuess = (row: Record<string, unknown>) => ({
    email: String(row.email ?? ""),
    verdict: String(row.verdict ?? ""),
    attempt: Number(row.attempt ?? 0),
    confidence: String(row.confidence ?? ""),
    p_valid: typeof row.p_valid === "number" ? row.p_valid : undefined,
    route: String(row.route ?? ""),
  });

  const routingQueues = asRecord(routing?.queues);
  const eligible = (Array.isArray(routingQueues.eligible_send_now) ? routingQueues.eligible_send_now : [])
    .map((item) => asRecord(item))
    .filter(isHighConfidenceAttempt);
  const topEligible = rankRows(eligible)[0];
  if (topEligible) {
    return toBestGuess(topEligible);
  }

  const highConfidenceAttempts = attempts
    .map((attempt) => asRecord(attempt))
    .filter(isHighConfidenceAttempt);
  const topAttempt = rankRows(highConfidenceAttempts)[0];
  if (!topAttempt) return null;
  return toBestGuess(topAttempt);
}

function normalizeConfidenceThreshold(value: unknown): ValidationConfig["stopOnMinConfidence"] {
  const normalized = String(value ?? "high").trim().toLowerCase();
  if (normalized === "none" || normalized === "off" || normalized === "disabled") return "none";
  if (normalized === "low" || normalized === "medium" || normalized === "high") return normalized;
  return "high";
}

function normalizeVerificationMode(value: unknown): EmailFinderVerificationMode {
  const normalized = String(value ?? "local").trim().toLowerCase();
  if (["local", "smtp", "smtp_local", "smtp-local", "enrichanything", "enrichanything-local"].includes(normalized)) {
    return "local";
  }
  // Legacy callers used "validatedmails" to mean "real verification".
  // LastB2B now uses the local EnrichAnything verifier for that contract.
  if (normalized === "validatedmails") {
    return "local";
  }
  if (["heuristic", "pattern", "none", "best_guess", "best-guess"].includes(normalized)) {
    return "heuristic";
  }
  throw new Error("Only verification modes 'local' and 'heuristic' are supported");
}

function normalizeLocalVerificationEnabled(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return String(process.env.EMAIL_FINDER_LOCAL_VERIFICATION_ENABLED ?? "true").toLowerCase() === "true";
  }
  return ["true", "1", "yes", "y", "on"].includes(normalized);
}

function normalizeLocalFallbackOnRisky(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return String(process.env.EMAIL_FINDER_LOCAL_FALLBACK_ON_RISKY ?? "false").toLowerCase() === "true";
  }
  return ["true", "1", "yes", "y", "on"].includes(normalized);
}

function parseValidationConfig(payload: unknown): ValidationConfig {
  const body = asRecord(payload);
  const requestId = String(body.request_id ?? "").trim() || generateRequestId();
  const auditSource = String(body.audit_source ?? "").trim() || "unspecified";
  const auditContext = asRecord(body.audit_context);
  const name = String(body.name ?? "").trim();
  const domain = normalizeDomain(body.domain);
  if (!name) {
    throw new Error("name is required");
  }
  if (!domain) {
    throw new Error("domain is required");
  }
  if (!DOMAIN_RE.test(domain)) {
    throw new Error("domain format is invalid");
  }
  if (isNonCompanyProfileDomain(domain)) {
    throw new Error("domain must be the company website domain, not a profile host");
  }

  const rawKnownEmails = Array.isArray(body.known_emails) ? body.known_emails : [];
  const canaryObservations = asRecord(body.canary_observations);
  const canaryPolicy = asRecord(body.canary_policy);
  const rawHitStatuses = Array.isArray(body.hit_statuses) ? body.hit_statuses : null;
  const verificationMode = normalizeVerificationMode(body.verification_mode);
  return {
    requestId,
    auditSource,
    auditContext,
    id: String(body.id ?? "").trim() || "lead-0",
    name,
    companyName: String(body.company_name ?? body.companyName ?? "").trim(),
    domain,
    linkedinProfileUrl: normalizeLinkedInProfileUrl(
      body.linkedin_url ?? body.linkedinUrl ?? body.linkedin_profile_url ?? body.linkedinProfileUrl ?? body.source_url
    ),
    maxCandidates: boundedInt(body.max_candidates, 12, 1, 20),
    knownEmails: rawKnownEmails.map((value) => extractFirstEmailAddress(value)).filter(Boolean),
    verificationMode,
    maxCredits: boundedInt(body.max_credits, 7, 1, 500),
    timeoutSeconds: boundedFloat(body.probe_timeout_seconds ?? body.timeout_seconds, 8, 1, 20),
    stopOnFirstHit: parseBool(body.stop_on_first_hit, true),
    stopOnMinConfidence: normalizeConfidenceThreshold(body.stop_on_min_confidence),
    hitStatuses: rawHitStatuses
      ? rawHitStatuses.map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean)
      : ["likely-valid", "valid", "deliverable"],
    // Hard policy: do not return/send non-high-confidence candidates.
    highConfidenceOnly: true,
    enableRiskyQueue: parseBool(body.enable_risky_queue, true),
    canaryMode: parseBool(body.canary_mode, false),
    canarySent: boundedInt(canaryObservations.sent, 0, 0, 1_000_000),
    canaryHardBounces: boundedInt(canaryObservations.hard_bounces, 0, 0, 1_000_000),
    canaryMinSamples: boundedInt(canaryPolicy.min_samples, 25, 1, 100_000),
    canaryMaxHardBounceRate: boundedFloat(canaryPolicy.max_hard_bounce_rate, 0.03, 0, 1),
    localVerificationEnabled: normalizeLocalVerificationEnabled(body.local_verification),
    localFallbackOnRisky: normalizeLocalFallbackOnRisky(body.local_fallback_on_risky),
    externalProviderFallbackEnabled: normalizeExternalProviderFallbackEnabled(
      body.external_provider_fallback ?? body.paid_provider_fallback
    ),
    externalProviderNames: normalizeProviderNames(body.external_providers ?? body.paid_providers),
  };
}

function buildHeuristicVerificationOutcome(input: {
  email: string;
  patternScore?: number;
  profile: PatternProfile;
  mx: DomainMailSignal;
  candidateIndex: number;
  candidateCount: number;
}) {
  const patternScore = typeof input.patternScore === "number" ? input.patternScore : 0.5;
  const noHistory = input.profile.sampleSize === 0;
  const isFirstCandidate = input.candidateIndex === 0;

  let verdict = "unknown";
  let confidence = "low";
  let reason = "low heuristic confidence";

  if (input.mx.status === "no-mail-route") {
    verdict = "invalid";
    confidence = "high";
    reason = input.mx.error || "domain has no mail route";
  } else if (!noHistory && patternScore >= 0.84) {
    verdict = "likely-valid";
    confidence = "high";
    reason = "strong domain pattern match";
  } else if (!noHistory && patternScore >= 0.72) {
    verdict = "likely-valid";
    confidence = "medium";
    reason = "good domain pattern match";
  } else if (!noHistory && patternScore >= 0.58) {
    verdict = "risky-valid";
    confidence = "medium";
    reason = "possible domain pattern match";
  } else if (noHistory && isFirstCandidate && patternScore >= 0.62) {
    verdict = "risky-valid";
    confidence = "low";
    reason = "first candidate fallback with mail-ready domain";
  }

  return {
    verdict,
    confidence,
    details: {
      verdict,
      reason,
      provider: "internal-email-finder",
      provider_status: verdict,
      mx_status: input.mx.status,
      mx_records: input.mx.records,
      mx_error: input.mx.error,
      pattern_score: patternScore,
      pattern_sample_size: input.profile.sampleSize,
      heuristic_only: true,
      candidate_index: input.candidateIndex + 1,
      candidate_count: input.candidateCount,
    },
  };
}

function hasHighConfidenceSendableAttempt(attempts: Array<Record<string, unknown>>) {
  return attempts.some((attempt) => {
    const verdict = String(attempt.verdict ?? "").trim().toLowerCase();
    const confidence = String(attempt.confidence ?? "").trim().toLowerCase();
    return ["likely-valid", "valid", "deliverable"].includes(verdict) && confidence === "high";
  });
}

function shouldRunExternalProviderFallback(input: {
  config: ValidationConfig;
  domainInsights: DomainInsights;
  attempts: Array<Record<string, unknown>>;
  creditsUsed: number;
}) {
  if (!input.config.externalProviderFallbackEnabled) return false;
  if (!input.config.externalProviderNames.length) return false;
  if (input.config.maxCredits <= input.creditsUsed) return false;
  if (input.domainInsights.mx.status === "no-mail-route") return false;
  if (hasHighConfidenceSendableAttempt(input.attempts)) return false;
  return true;
}

async function lookupExternalProviderEmail(input: {
  config: ValidationConfig;
  timeoutMs: number;
}): Promise<ExternalEmailProviderLookupResult> {
  for (const providerName of input.config.externalProviderNames) {
    if (providerName === "airscale") {
      const result = await lookupAirscaleEmail(input);
      if (result.email || result.status !== "skipped") return result;
      continue;
    }
  }

  return {
    provider: input.config.externalProviderNames[0] ?? "none",
    email: "",
    verdict: "unknown",
    confidence: "low",
    reason: "no_supported_external_provider_configured",
    status: "skipped",
    httpStatus: null,
    raw: {},
    creditsUsed: 0,
  };
}

async function verifyExternalProviderEmail(input: {
  email: string;
  providerResult: ExternalEmailProviderLookupResult;
  domainInsights: DomainInsights;
  config: ValidationConfig;
  localConfig: ReturnType<typeof resolveLocalVerificationConfig>;
  timeoutMs: number;
}) {
  let outcome = {
    verdict: input.providerResult.verdict,
    confidence: input.providerResult.confidence,
    details: {
      provider: input.providerResult.provider,
      reason: input.providerResult.reason,
      provider_status: input.providerResult.status,
      http_status: input.providerResult.httpStatus,
      mx_status: input.domainInsights.mx.status,
      mx_records: input.domainInsights.mx.records,
      external_provider_fallback: true,
      external_provider: input.providerResult.provider,
      external_provider_status: input.providerResult.status,
      external_provider_http_status: input.providerResult.httpStatus,
      external_verification_only: true,
    } as Record<string, unknown>,
  };

  if (!input.config.localVerificationEnabled) return outcome;

  const hasRemoteLocalVerifier = Boolean(input.localConfig.serviceUrl && input.localConfig.serviceToken);
  const localVerifierSource = hasRemoteLocalVerifier ? "remote-service" : "app-smtp";
  const localProbeTimeoutMs = Math.max(
    1_000,
    Math.min(input.localConfig.timeoutMs, Math.round(input.timeoutMs))
  );
  const localResult = hasRemoteLocalVerifier
    ? await remoteVerifyEmail({
        email: input.email,
        serviceUrl: input.localConfig.serviceUrl,
        serviceToken: input.localConfig.serviceToken,
        allowPaidFallback: false,
        timeoutMs: localProbeTimeoutMs,
      })
    : await localVerifyEmail({
        email: input.email,
        heloDomain: input.localConfig.heloDomain,
        mailFrom: input.localConfig.mailFrom,
        enableSmtp: input.localConfig.enableSmtp,
        enableStartTls: input.localConfig.enableStartTls,
        checkCatchAll: input.localConfig.checkCatchAll,
        timeoutMs: localProbeTimeoutMs,
      });

  if (!localResult) return outcome;

  const externalValid =
    input.providerResult.verdict === "likely-valid" && input.providerResult.confidence === "high";
  const localDetails = asRecord(localResult.details);
  if (externalValid && localResult.verdict !== "invalid") {
    return {
      verdict: input.providerResult.verdict,
      confidence: input.providerResult.confidence,
      details: {
        provider: input.providerResult.provider,
        reason:
          localResult.verdict === "risky-valid"
            ? "external_provider_valid_overrode_local_catchall_uncertainty"
            : input.providerResult.reason,
        provider_status: input.providerResult.status,
        http_status: input.providerResult.httpStatus,
        mx_status: String(localDetails.mx_status ?? input.domainInsights.mx.status).trim().toLowerCase(),
        mx_records: localDetails.mx_records ?? input.domainInsights.mx.records,
        accept_all: false,
        catch_all: false,
        external_provider_fallback: true,
        external_provider: input.providerResult.provider,
        external_provider_status: input.providerResult.status,
        external_provider_http_status: input.providerResult.httpStatus,
        external_provider_verdict: input.providerResult.verdict,
        external_provider_confidence: input.providerResult.confidence,
        external_provider_reason: input.providerResult.reason,
        local_verification: true,
        local_verifier_source: localVerifierSource,
        local_verdict: localResult.verdict,
        local_confidence: localResult.confidence,
        local_reason: localResult.reason,
        local_accept_all: toNullableBool(localDetails.accept_all ?? localDetails.acceptall),
        local_catch_all: toNullableBool(localDetails.catch_all ?? localDetails.catchall),
        local_details: localDetails,
      },
    };
  }

  outcome = {
    verdict: localResult.verdict,
    confidence: localResult.confidence,
    details: {
      ...localDetails,
      local_verification: true,
      local_verifier_source: localVerifierSource,
      local_reason: localResult.reason,
      external_provider_fallback: true,
      external_provider: input.providerResult.provider,
      external_provider_status: input.providerResult.status,
      external_provider_http_status: input.providerResult.httpStatus,
      external_provider_verdict: input.providerResult.verdict,
      external_provider_confidence: input.providerResult.confidence,
      external_provider_reason: input.providerResult.reason,
    },
  };
  return outcome;
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(onTimeout()), Math.max(250, timeoutMs));
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function resolveDomainMailSignal(domain: string, timeoutMs: number): Promise<DomainMailSignal> {
  try {
    const mxRecords = await withTimeout(
      dns.resolveMx(domain),
      timeoutMs,
      () => [] as { exchange: string; priority: number }[]
    );
    if (mxRecords.length) {
      const records = mxRecords
        .map((record) => ({
          priority: boundedInt(record.priority, 0, 0, 65535),
          host: String(record.exchange ?? "").trim().toLowerCase().replace(/\.+$/, ""),
        }))
        .filter((record) => record.host)
        .sort((left, right) => left.priority - right.priority);
      if (records.length) {
        return {
          status: "mail-ready",
          records,
          error: "",
        };
      }
    }

    const anyRecords = await withTimeout(dns.resolveAny(domain), timeoutMs, () => [] as Array<{ type?: unknown }>);
    const hasAddressRecord = anyRecords.some((record) => {
      const type = String(record?.type ?? "").trim().toUpperCase();
      return type === "A" || type === "AAAA";
    });
    if (hasAddressRecord) {
      return {
        status: "mail-ready",
        records: [{ priority: 0, host: domain, implicit: true }],
        error: "",
      };
    }

    return {
      status: "no-mail-route",
      records: [],
      error: "no MX records found",
    };
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? "").trim().toUpperCase();
    if (["ENODATA", "ENOTFOUND", "EAI_NONAME", "NXDOMAIN"].includes(code)) {
      return {
        status: "no-mail-route",
        records: [],
        error: code || "no MX records found",
      };
    }
    return {
      status: "unknown",
      records: [],
      error: String((error as Error)?.message ?? error ?? "mx lookup failed"),
    };
  }
}

type ExternalEmailProviderLookupResult = {
  provider: string;
  email: string;
  verdict: string;
  confidence: string;
  reason: string;
  status: string;
  httpStatus: number | null;
  raw: Record<string, unknown>;
  creditsUsed: number;
};

function airscaleApiKey() {
  return cleanEnvValue(process.env.AIRSCALE_API_KEY ?? process.env.EMAIL_FINDER_AIRSCALE_API_KEY);
}

function airscaleBaseUrl() {
  return (
    cleanEnvValue(process.env.AIRSCALE_API_BASE_URL ?? process.env.EMAIL_FINDER_AIRSCALE_BASE_URL) ||
    "https://api.airscale.io"
  ).replace(/\/+$/, "");
}

let airscaleCreditCache: { expiresAt: number; credits: number | null } | null = null;

async function getAirscaleCreditCount(input: {
  key: string;
  timeoutMs: number;
}): Promise<number | null> {
  const now = Date.now();
  if (airscaleCreditCache && airscaleCreditCache.expiresAt > now) {
    return airscaleCreditCache.credits;
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), Math.max(1_000, input.timeoutMs));
  try {
    const response = await fetch(`${airscaleBaseUrl()}/v1/credits`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({}),
    });
    const raw = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = raw ? asRecord(JSON.parse(raw)) : {};
    } catch {
      payload = {};
    }
    const responsePayload = asRecord(payload.response);
    const credits = Number(responsePayload.credits ?? payload.credits);
    const normalizedCredits = Number.isFinite(credits) ? Math.max(0, Math.trunc(credits)) : null;
    airscaleCreditCache = {
      credits: normalizedCredits,
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
    return normalizedCredits;
  } catch {
    airscaleCreditCache = {
      credits: null,
      expiresAt: Date.now() + 60 * 1000,
    };
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function mapExternalEmailStatusToOutcome(status: string) {
  const normalized = status.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (["valid", "verified", "deliverable", "safe", "success"].includes(normalized)) {
    return {
      verdict: "likely-valid",
      confidence: "high",
      reason: normalized || "external_provider_valid",
    };
  }
  if (["catch-all", "accept-all", "risky", "risky-valid", "unknown", "unverified"].includes(normalized)) {
    return {
      verdict: "risky-valid",
      confidence: "medium",
      reason: normalized || "external_provider_risky",
    };
  }
  if (["invalid", "undeliverable", "bounced", "not-found", "not-found-on-provider"].includes(normalized)) {
    return {
      verdict: "invalid",
      confidence: "high",
      reason: normalized || "external_provider_invalid",
    };
  }
  return {
    verdict: "unknown",
    confidence: "low",
    reason: normalized || "external_provider_unknown",
  };
}

async function lookupAirscaleEmail(input: {
  config: ValidationConfig;
  timeoutMs: number;
}): Promise<ExternalEmailProviderLookupResult> {
  const key = airscaleApiKey();
  if (!key) {
    return {
      provider: "airscale",
      email: "",
      verdict: "unknown",
      confidence: "low",
      reason: "missing_airscale_api_key",
      status: "skipped",
      httpStatus: null,
      raw: {},
      creditsUsed: 0,
    };
  }

  const remainingCredits = await getAirscaleCreditCount({
    key,
    timeoutMs: Math.min(5_000, Math.max(1_000, input.timeoutMs)),
  });
  if (remainingCredits === 0) {
    return {
      provider: "airscale",
      email: "",
      verdict: "unknown",
      confidence: "low",
      reason: "airscale_no_credits",
      status: "no_credits",
      httpStatus: null,
      raw: {},
      creditsUsed: 0,
    };
  }

  const person = parsePersonName(input.config.name);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), Math.max(1_000, input.timeoutMs));
  try {
    const response = await fetch(`${airscaleBaseUrl()}/v1/email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        first_name: person?.first ?? "",
        last_name: person?.last ?? "",
        full_name: input.config.name,
        domain: input.config.domain,
        company_name: input.config.companyName,
        linkedin_profile_url: input.config.linkedinProfileUrl,
      }),
    });
    const rawText = await response.text();
    let raw: Record<string, unknown> = {};
    try {
      raw = rawText ? asRecord(JSON.parse(rawText)) : {};
    } catch {
      raw = { raw: rawText.slice(0, 500) };
    }

    const email = extractFirstEmailAddress(raw.email ?? raw.professional_email ?? raw.work_email);
    const providerStatus = String(raw.email_status ?? raw.status ?? raw.verification_status ?? "")
      .trim()
      .toLowerCase();
    const outcome = mapExternalEmailStatusToOutcome(providerStatus || (email ? "valid" : "not-found"));
    const error = String(raw.error ?? raw.message ?? "").trim();
    return {
      provider: "airscale",
      email,
      verdict: response.ok ? outcome.verdict : "unknown",
      confidence: response.ok ? outcome.confidence : "low",
      reason: response.ok ? outcome.reason : error || `airscale_http_${response.status}`,
      status: providerStatus || (response.ok ? (email ? "found" : "not_found") : "error"),
      httpStatus: response.status,
      raw,
      creditsUsed: response.ok && email ? 1 : 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "airscale request failed");
    return {
      provider: "airscale",
      email: "",
      verdict: "unknown",
      confidence: "low",
      reason: message,
      status: "error",
      httpStatus: null,
      raw: {},
      creditsUsed: 0,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function loadHistoricalKnownEmails(domain: string, limit = 24): Promise<string[]> {
  if (isNonCompanyProfileDomain(domain)) return [];
  const accepted = new Set<string>();

  const acceptEmail = (email: unknown, status: unknown, realVerifiedEmail: unknown = false) => {
    const normalized = extractFirstEmailAddress(email);
    const normalizedStatus = String(status ?? "").trim().toLowerCase();
    const trustedByVerification = realVerifiedEmail === true;
    const trustedByOutcome = TRUSTED_STATUSES.has(normalizedStatus);
    if (!trustedByVerification && !trustedByOutcome) return;
    if (!isUsableKnownEmail(normalized, domain)) return;
    accepted.add(normalized);
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      const { data } = await supabase
        .from(TABLE_RUN_LEAD)
        .select("email,status,real_verified_email,updated_at")
        .eq("domain", domain)
        .order("updated_at", { ascending: false })
        .limit(Math.max(limit * 4, limit));
      for (const row of data ?? []) {
        const record = asRecord(row);
        acceptEmail(record.email, record.status, record.real_verified_email);
        if (accepted.size >= limit) break;
      }
      return [...accepted];
    } catch {
      return [...accepted];
    }
  }

  try {
    const raw = await readFile(OUTREACH_PATH, "utf8");
    const payload = JSON.parse(raw);
    const runLeads = Array.isArray(asRecord(payload).runLeads) ? (asRecord(payload).runLeads as unknown[]) : [];
    for (let index = runLeads.length - 1; index >= 0; index -= 1) {
      const row = asRecord(runLeads[index]);
      if (normalizeDomain(row.domain) !== domain) continue;
      acceptEmail(row.email, row.status, row.real_verified_email ?? row.realVerifiedEmail);
      if (accepted.size >= limit) break;
    }
  } catch {
    return [...accepted];
  }

  return [...accepted];
}

let enrichAnythingEmailSupabase:
  | ReturnType<typeof createClient>
  | null
  | undefined;

function getEnrichAnythingEmailSupabase() {
  if (enrichAnythingEmailSupabase !== undefined) {
    return enrichAnythingEmailSupabase;
  }

  const url = cleanEnvValue(
    process.env.ENRICHANYTHING_EMAIL_INTELLIGENCE_SUPABASE_URL ??
      process.env.ENRICHANYTHING_SUPABASE_URL ??
      process.env.ENRICHANYTHING_INTERNAL_SUPABASE_URL
  );
  const key = cleanEnvValue(
    process.env.ENRICHANYTHING_EMAIL_INTELLIGENCE_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.ENRICHANYTHING_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.ENRICHANYTHING_SUPABASE_SERVICE_KEY ??
      process.env.ENRICHANYTHING_SUPABASE_SECRET_KEY
  );

  if (!url || !key) {
    enrichAnythingEmailSupabase = null;
    return null;
  }

  enrichAnythingEmailSupabase = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return enrichAnythingEmailSupabase;
}

function normalizeEmailIntelligenceContact(row: Record<string, unknown>, domain: string): EmailIntelligenceContact | null {
  const email = extractFirstEmailAddress(row.email);
  if (!isUsableKnownEmail(email, domain)) return null;
  const observedValid = toNullableBool(row.observed_valid ?? row.observedValid);
  if (observedValid === false) return null;
  const validityStatus = String(row.validity_status ?? row.validityStatus ?? "")
    .trim()
    .toLowerCase();
  if (["invalid", "bounced", "suppressed", "unsubscribed"].includes(validityStatus)) return null;
  return {
    email,
    displayName: String(row.display_name ?? row.displayName ?? "").trim(),
    localPart: String(row.local_part ?? row.localPart ?? email.split("@", 1)[0] ?? "")
      .trim()
      .toLowerCase(),
    domain,
    validityStatus,
    observedValid,
    lastSeenAt: String(row.last_seen_at ?? row.lastSeenAt ?? "").trim(),
  };
}

async function loadEnrichAnythingEmailIntelligence(domain: string): Promise<{
  knownEmails: string[];
  observedContacts: EmailIntelligenceContact[];
  domainRecord: EmailIntelligenceDomainRecord | null;
}> {
  const empty = {
    knownEmails: [] as string[],
    observedContacts: [] as EmailIntelligenceContact[],
    domainRecord: null as EmailIntelligenceDomainRecord | null,
  };
  if (isNonCompanyProfileDomain(domain)) return empty;

  const supabase = getEnrichAnythingEmailSupabase();
  if (!supabase) return empty;

  try {
    const [domainResult, contactsResult, mailboxesResult] = await Promise.all([
      supabase
        .from("app_email_domains")
        .select("domain,inferred_pattern,pattern_confidence,pattern_sample_count")
        .eq("domain", domain)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("app_email_contacts")
        .select("email,display_name,local_part,domain,validity_status,observed_valid,last_seen_at")
        .eq("domain", domain)
        .order("last_seen_at", { ascending: false, nullsFirst: false })
        .limit(40),
      supabase
        .from("app_email_mailboxes")
        .select("sender_email,sender_name,account_domain,last_sync_status,contact_count,message_count")
        .eq("account_domain", domain)
        .eq("last_sync_status", "success")
        .order("contact_count", { ascending: false, nullsFirst: false })
        .limit(20),
    ]);

    const contacts = (contactsResult.data ?? [])
      .map((row) => normalizeEmailIntelligenceContact(asRecord(row), domain))
      .filter((row): row is EmailIntelligenceContact => Boolean(row));
    const mailboxEmails = (mailboxesResult.data ?? [])
      .map((row) => extractFirstEmailAddress(asRecord(row).sender_email))
      .filter((email) => isUsableKnownEmail(email, domain));
    const knownEmails = uniqueInOrder([
      ...contacts.map((contact) => contact.email),
      ...mailboxEmails,
    ]);
    const domainRow = asRecord(domainResult.data);
    const patternConfidence =
      typeof domainRow.pattern_confidence === "number" && Number.isFinite(domainRow.pattern_confidence)
        ? domainRow.pattern_confidence
        : null;
    const domainRecord = domainResult.error
      ? null
      : {
          domain,
          inferredPattern: String(domainRow.inferred_pattern ?? "").trim().toLowerCase(),
          patternConfidence,
          patternSampleCount: Math.max(0, Math.trunc(Number(domainRow.pattern_sample_count ?? 0) || 0)),
        };

    return {
      knownEmails,
      observedContacts: contacts,
      domainRecord,
    };
  } catch {
    return empty;
  }
}

async function loadDomainInsights(domain: string, timeoutMs: number): Promise<DomainInsights> {
  const [mx, historicalKnownEmails, enrichAnythingEmailIntelligence] = await Promise.all([
    resolveDomainMailSignal(domain, timeoutMs),
    loadHistoricalKnownEmails(domain),
    loadEnrichAnythingEmailIntelligence(domain),
  ]);

  return {
    domain,
    mx,
    historicalKnownEmails,
    enrichAnythingKnownEmails: enrichAnythingEmailIntelligence.knownEmails,
    enrichAnythingObservedContacts: enrichAnythingEmailIntelligence.observedContacts,
    enrichAnythingDomainRecord: enrichAnythingEmailIntelligence.domainRecord,
  };
}

async function runGuess(
  payload: unknown,
  domainInsightsResolver?: (domain: string, timeoutMs: number) => Promise<DomainInsights>
) {
  const startedAt = Date.now();
  const config = parseValidationConfig(payload);
  const domainInsights =
    (await (domainInsightsResolver?.(config.domain, config.timeoutSeconds * 1000) ??
      loadDomainInsights(config.domain, config.timeoutSeconds * 1000))) ?? {
      domain: config.domain,
      mx: { status: "unknown", records: [], error: "" },
      historicalKnownEmails: [],
      enrichAnythingKnownEmails: [],
      enrichAnythingObservedContacts: [],
      enrichAnythingDomainRecord: null,
    };

  const combinedKnownEmails = uniqueInOrder([
    ...config.knownEmails,
    ...domainInsights.historicalKnownEmails,
    ...domainInsights.enrichAnythingKnownEmails,
  ]).filter((email) => isUsableKnownEmail(email, config.domain));
  const priorityCandidateEmails = uniqueInOrder([
    ...findObservedPersonContactEmails(config.name, domainInsights.enrichAnythingObservedContacts),
    inferredPatternCandidateEmail({
      personName: config.name,
      domain: config.domain,
      domainRecord: domainInsights.enrichAnythingDomainRecord,
    }),
  ]).filter((email) => isUsableKnownEmail(email, config.domain));

  const { orderedCandidates, patternScores, orderingMeta, profile } = buildCandidates(
    config,
    combinedKnownEmails,
    priorityCandidateEmails
  );

  const attempts = [] as Array<Record<string, unknown>>;
  const externalProviderAttempts = [] as Array<Record<string, unknown>>;
  let creditsUsed = 0;
  const verificationModeUsed = config.verificationMode;

  const localConfig = resolveLocalVerificationConfig();
  if (
    verificationModeUsed === "local" &&
    config.localVerificationEnabled &&
    !localConfig.serviceUrl &&
    process.env.VERCEL &&
    String(process.env.EMAIL_FINDER_ALLOW_SERVERLESS_SMTP ?? "").trim().toLowerCase() !== "true"
  ) {
    throw new Error(
      "Local EnrichAnything email validation requires an SMTP-capable EmailFinder worker; Vercel serverless cannot run SMTP probes. Set EMAIL_FINDER_API_BASE_URL or EMAIL_FINDER_LOCAL_VERIFIER_URL to that worker."
    );
  }

  for (const [index, email] of orderedCandidates.entries()) {
    let outcome: {
      verdict: string;
      confidence: string;
      details: Record<string, unknown>;
    } | null = null;

    if (domainInsights.mx.status === "no-mail-route") {
      outcome = {
        verdict: "invalid",
        confidence: "high",
        details: {
          verdict: "invalid",
          reason: domainInsights.mx.error || "domain has no mail route",
          provider: "real-verification-gate",
          mx_status: domainInsights.mx.status,
          mx_records: domainInsights.mx.records,
          pattern_score: typeof patternScores[email] === "number" ? patternScores[email] : null,
          pattern_sample_size: profile.sampleSize,
        },
      };
    } else if (verificationModeUsed === "heuristic") {
      outcome = buildHeuristicVerificationOutcome({
        email,
        patternScore: patternScores[email],
        profile,
        mx: domainInsights.mx,
        candidateIndex: index,
        candidateCount: orderedCandidates.length,
      });
    } else {
      let localResult: Awaited<ReturnType<typeof localVerifyEmail>> | null = null;
      let localVerifierSource = "none";
      if (config.localVerificationEnabled) {
        const hasRemoteLocalVerifier = Boolean(localConfig.serviceUrl && localConfig.serviceToken);
        localVerifierSource = hasRemoteLocalVerifier ? "remote-service" : "app-smtp";
        const localProbeTimeoutMs = Math.max(
          1_000,
          Math.min(localConfig.timeoutMs, Math.round(config.timeoutSeconds * 1000))
        );
        const nextLocalResult = hasRemoteLocalVerifier
          ? await remoteVerifyEmail({
              email,
              serviceUrl: localConfig.serviceUrl,
              serviceToken: localConfig.serviceToken,
              // Keep paid-provider fallback under the app's control so spend is auditable here.
              allowPaidFallback: false,
              timeoutMs: localProbeTimeoutMs,
            })
          : await localVerifyEmail({
              email,
              heloDomain: localConfig.heloDomain,
              mailFrom: localConfig.mailFrom,
              enableSmtp: localConfig.enableSmtp,
              enableStartTls: localConfig.enableStartTls,
              checkCatchAll: localConfig.checkCatchAll,
              timeoutMs: localProbeTimeoutMs,
            });
        if (nextLocalResult) {
          localResult = nextLocalResult;
          const localVerdict = localResult.verdict;
          const localPaidUsed = Boolean(asRecord(localResult.details).paid_used);
          if (localPaidUsed) {
            creditsUsed += 1;
          }
          const localIsFinal =
            localPaidUsed ||
            localVerdict === "invalid" ||
            localVerdict === "likely-valid" ||
            (localVerdict === "risky-valid" && !config.localFallbackOnRisky);
          if (localIsFinal) {
            outcome = {
              verdict: localResult.verdict,
              confidence: localResult.confidence,
              details: {
                ...asRecord(localResult.details),
                local_verification: true,
                local_verifier_source: localVerifierSource,
                local_reason: localResult.reason,
              },
            };
          }
        }
      }

      if (!outcome && verificationModeUsed === "local") {
        outcome = localResult
          ? {
              verdict: localResult.verdict,
              confidence: localResult.confidence,
              details: {
                ...asRecord(localResult.details),
                local_verification: true,
                local_verifier_source: localVerifierSource,
                local_reason: localResult.reason,
              },
            }
          : {
              verdict: "unknown",
              confidence: "low",
              details: {
                provider: "local-verification-gate",
                reason: config.localVerificationEnabled ? "local_result_missing" : "local_verification_disabled",
                local_verification: false,
              },
            };
      }

      if (!outcome) {
        outcome = {
          verdict: "unknown",
          confidence: "low",
          details: {
            provider: "local-verification-gate",
            reason: config.localVerificationEnabled ? "local_non_final_result" : "local_verification_disabled",
            local_verification: Boolean(localResult),
            local_verifier_source: localVerifierSource,
            local_result: localResult
              ? {
                  verdict: localResult.verdict,
                  confidence: localResult.confidence,
                  reason: localResult.reason,
                  details: localResult.details,
                }
              : null,
          },
        };
      }
    }

    const attempt = {
      attempt: index + 1,
      email,
      verdict: outcome.verdict,
      confidence: outcome.confidence,
      is_hit: config.hitStatuses.includes(outcome.verdict),
      details: outcome.details,
    } as Record<string, unknown>;

    const pValid = computeAttemptPValid({
      attempt,
      candidateIndex: index,
      candidateCount: orderedCandidates.length,
      patternScore: patternScores[email],
    });
    attempt.p_valid = pValid;
    asRecord(attempt.details).p_valid = pValid;
    attempts.push(attempt);

    if (
      config.stopOnFirstHit &&
      Boolean(attempt.is_hit) &&
      confidenceRank(String(attempt.confidence ?? "low")) >= confidenceRank(config.stopOnMinConfidence)
    ) {
      break;
    }
  }

  if (
    verificationModeUsed === "local" &&
    shouldRunExternalProviderFallback({
      config,
      domainInsights,
      attempts,
      creditsUsed,
    })
  ) {
    const externalResult = await lookupExternalProviderEmail({
      config,
      timeoutMs: Math.max(1_000, Math.min(localConfig.timeoutMs, Math.round(config.timeoutSeconds * 1000))),
    });
    externalProviderAttempts.push({
      provider: externalResult.provider,
      status: externalResult.status,
      email_found: Boolean(externalResult.email),
      verdict: externalResult.verdict,
      confidence: externalResult.confidence,
      reason: externalResult.reason,
      http_status: externalResult.httpStatus,
      credits_used: externalResult.creditsUsed,
    });
    creditsUsed += externalResult.creditsUsed;

    const email = externalResult.email;
    const priorAttempt = attempts.find((attempt) => extractFirstEmailAddress(attempt.email) === email);
    const priorVerdict = String(priorAttempt?.verdict ?? "").trim().toLowerCase();
    if (
      email &&
      isUsableKnownEmail(email, config.domain) &&
      priorVerdict !== "invalid"
    ) {
      const outcome = await verifyExternalProviderEmail({
        email,
        providerResult: externalResult,
        domainInsights,
        config,
        localConfig,
        timeoutMs: Math.max(1_000, Math.min(localConfig.timeoutMs, Math.round(config.timeoutSeconds * 1000))),
      });
      const attempt = {
        attempt: attempts.length + 1,
        email,
        verdict: outcome.verdict,
        confidence: outcome.confidence,
        is_hit: config.hitStatuses.includes(outcome.verdict),
        details: outcome.details,
      } as Record<string, unknown>;
      const pValid = computeAttemptPValid({
        attempt,
        candidateIndex: orderedCandidates.length,
        candidateCount: orderedCandidates.length + 1,
      });
      attempt.p_valid = pValid;
      asRecord(attempt.details).p_valid = pValid;
      attempts.push(attempt);
    }
  }

  const routing = routeAttempts(attempts, config);
  const bestGuess = buildBestGuess(attempts, routing);

  return {
    ok: true,
    input: {
      id: config.id,
      name: config.name,
      domain: config.domain,
      max_candidates: config.maxCandidates,
      known_emails_count: config.knownEmails.length,
      historical_known_emails_count: domainInsights.historicalKnownEmails.length,
      enrichanything_known_emails_count: domainInsights.enrichAnythingKnownEmails.length,
      enrichanything_observed_contact_count: domainInsights.enrichAnythingObservedContacts.length,
      verification_mode: config.verificationMode,
      verification_mode_used: verificationModeUsed,
      stop_on_first_hit: config.stopOnFirstHit,
      stop_on_min_confidence: config.stopOnMinConfidence,
      max_credits: config.maxCredits,
      hit_statuses: config.hitStatuses,
      high_confidence_only: config.highConfidenceOnly,
      enable_risky_queue: config.enableRiskyQueue,
      external_provider_fallback_enabled: config.externalProviderFallbackEnabled,
      external_providers: config.externalProviderNames,
      canary_mode: config.canaryMode,
      canary_observations: {
        sent: config.canarySent,
        hard_bounces: config.canaryHardBounces,
      },
      canary_policy: {
        min_samples: config.canaryMinSamples,
        max_hard_bounce_rate: config.canaryMaxHardBounceRate,
      },
    },
    ordering: orderingMeta,
    pattern_scores: patternScores,
    ordered_candidates: orderedCandidates,
    attempts,
    verification: {
      mode: verificationModeUsed,
      provider: verificationModeUsed === "local" ? "local" : "internal-email-finder",
      credits_used: creditsUsed,
      max_credits: config.maxCredits,
      mx_status: domainInsights.mx.status,
      mx_records: domainInsights.mx.records,
      mx_error: domainInsights.mx.error,
      historical_known_emails: domainInsights.historicalKnownEmails,
      enrichanything_known_emails_count: domainInsights.enrichAnythingKnownEmails.length,
      enrichanything_observed_contact_count: domainInsights.enrichAnythingObservedContacts.length,
      enrichanything_inferred_pattern: domainInsights.enrichAnythingDomainRecord?.inferredPattern ?? "",
      priority_candidates: priorityCandidateEmails,
      external_provider_fallback_enabled: config.externalProviderFallbackEnabled,
      external_providers: config.externalProviderNames,
      external_provider_attempts: externalProviderAttempts,
    },
    routing,
    domain_fingerprint: {
      enabled:
        domainInsights.historicalKnownEmails.length > 0 ||
        domainInsights.enrichAnythingKnownEmails.length > 0 ||
        Boolean(domainInsights.enrichAnythingDomainRecord?.inferredPattern),
      source:
        domainInsights.enrichAnythingKnownEmails.length > 0 ||
        Boolean(domainInsights.enrichAnythingDomainRecord?.inferredPattern)
          ? "outreach-history+enrichanything-email-intelligence"
          : "outreach-history",
      summary: {
        domain: config.domain,
        sample_size: domainInsights.historicalKnownEmails.length + domainInsights.enrichAnythingKnownEmails.length,
        historical_sample_size: domainInsights.historicalKnownEmails.length,
        enrichanything_sample_size: domainInsights.enrichAnythingKnownEmails.length,
        enrichanything_observed_contact_count: domainInsights.enrichAnythingObservedContacts.length,
        inferred_pattern: domainInsights.enrichAnythingDomainRecord?.inferredPattern ?? "",
        mx_status: domainInsights.mx.status,
        risk_hint:
          domainInsights.mx.status === "no-mail-route"
            ? "no-mail-route"
            : domainInsights.historicalKnownEmails.length + domainInsights.enrichAnythingKnownEmails.length >= 3
              ? "pattern-backed"
              : domainInsights.historicalKnownEmails.length + domainInsights.enrichAnythingKnownEmails.length > 0
                ? "small-sample"
                : "cold-start",
      },
    },
    retry_scheduler: {
      enabled: false,
      reason: "internal route does not persist retries",
    },
    best_guess: bestGuess,
    elapsed_ms: Number((Date.now() - startedAt).toFixed(2)),
  };
}

export async function verifyExactEmailAddress(input: {
  email: string;
  verificationMode?: "local" | "smtp" | "validatedmails" | "heuristic";
  timeoutSeconds?: number;
  localVerificationEnabled?: boolean;
  localFallbackOnRisky?: boolean;
}): Promise<ExactEmailVerificationResult> {
  const normalizedEmail = extractFirstEmailAddress(input.email);
  if (!normalizedEmail || !EMAIL_RE.test(normalizedEmail)) {
    return {
      email: normalizedEmail,
      realVerifiedEmail: false,
      emailVerification: {
        mode: "",
        provider: "exact-email-verifier",
        verdict: "invalid",
        confidence: "high",
        reason: "invalid_syntax",
        mxStatus: "",
        acceptAll: null,
        catchAll: null,
        pValid: 0,
        httpStatus: null,
        providerStatus: "",
      },
    };
  }

  const domain = normalizedEmail.split("@")[1] ?? "";
  let verificationModeUsed: EmailFinderVerificationMode = "local";
  try {
    verificationModeUsed = normalizeVerificationMode(
      input.verificationMode ?? "local"
    );
  } catch {
    verificationModeUsed = "local";
  }

  const timeoutSeconds = boundedFloat(input.timeoutSeconds, 8, 1, 20);
  const localConfig = resolveLocalVerificationConfig();
  if (
    verificationModeUsed === "local" &&
    !localConfig.serviceUrl &&
    process.env.VERCEL &&
    String(process.env.EMAIL_FINDER_ALLOW_SERVERLESS_SMTP ?? "").trim().toLowerCase() !== "true"
  ) {
    return {
      email: normalizedEmail,
      realVerifiedEmail: false,
      emailVerification: {
        mode: "local",
        provider: "local-verification-gate",
        verdict: "unknown",
        confidence: "low",
        reason: "smtp_unavailable_in_serverless",
        mxStatus: "",
        acceptAll: null,
        catchAll: null,
        pValid: null,
        httpStatus: null,
        providerStatus: "",
      },
    };
  }
  const domainInsights = await loadDomainInsights(domain, timeoutSeconds * 1000);
  let outcome:
    | {
        verdict: string;
        confidence: string;
        details: Record<string, unknown>;
      }
    | null = null;

  if (domainInsights.mx.status === "no-mail-route") {
    outcome = {
      verdict: "invalid",
      confidence: "high",
      details: {
        verdict: "invalid",
        reason: domainInsights.mx.error || "domain has no mail route",
        provider: "real-verification-gate",
        mx_status: domainInsights.mx.status,
        mx_records: domainInsights.mx.records,
      },
    };
  } else if (verificationModeUsed === "heuristic") {
    outcome = buildHeuristicVerificationOutcome({
      email: normalizedEmail,
      profile: buildPatternProfile([], domain),
      mx: domainInsights.mx,
      candidateIndex: 0,
      candidateCount: 1,
    });
  } else {
    let localResult: Awaited<ReturnType<typeof localVerifyEmail>> | null = null;
    let localVerifierSource = "none";
    const localVerificationEnabled =
      typeof input.localVerificationEnabled === "boolean"
        ? input.localVerificationEnabled
        : normalizeLocalVerificationEnabled(undefined);
    const localFallbackOnRisky =
      typeof input.localFallbackOnRisky === "boolean"
        ? input.localFallbackOnRisky
        : normalizeLocalFallbackOnRisky(undefined);

    if (localVerificationEnabled) {
      const hasRemoteLocalVerifier = Boolean(localConfig.serviceUrl && localConfig.serviceToken);
      localVerifierSource = hasRemoteLocalVerifier ? "remote-service" : "app-smtp";
      const localProbeTimeoutMs = Math.max(
        1_000,
        Math.min(
          localConfig.timeoutMs,
          Math.round(Math.max(1, Number(input.timeoutSeconds ?? 8) || 8) * 1000)
        )
      );
      localResult = hasRemoteLocalVerifier
        ? await remoteVerifyEmail({
            email: normalizedEmail,
            serviceUrl: localConfig.serviceUrl,
            serviceToken: localConfig.serviceToken,
            allowPaidFallback: false,
            timeoutMs: localProbeTimeoutMs,
          })
        : await localVerifyEmail({
            email: normalizedEmail,
            heloDomain: localConfig.heloDomain,
            mailFrom: localConfig.mailFrom,
            enableSmtp: localConfig.enableSmtp,
            enableStartTls: localConfig.enableStartTls,
            checkCatchAll: localConfig.checkCatchAll,
            timeoutMs: localProbeTimeoutMs,
          });

      if (localResult) {
        const localPaidUsed = Boolean(asRecord(localResult.details).paid_used);
        const localIsFinal =
          localPaidUsed ||
          localResult.verdict === "invalid" ||
          localResult.verdict === "likely-valid" ||
          (localResult.verdict === "risky-valid" && !localFallbackOnRisky);
        if (localIsFinal || verificationModeUsed === "local") {
          outcome = {
            verdict: localResult.verdict,
            confidence: localResult.confidence,
            details: {
              ...asRecord(localResult.details),
              local_verification: true,
              local_verifier_source: localVerifierSource,
              local_reason: localResult.reason,
            },
          };
        }
      }
    }
  }

  const finalizedOutcome =
    outcome ??
    {
      verdict: "unknown",
      confidence: "low",
      details: {
        provider: "exact-email-verifier",
        reason: "verification_unavailable",
        mx_status: domainInsights.mx.status,
      },
    };
  const attempt = {
    attempt: 1,
    email: normalizedEmail,
    verdict: finalizedOutcome.verdict,
    confidence: finalizedOutcome.confidence,
    details: finalizedOutcome.details,
  } as Record<string, unknown>;
  const pValid = computeAttemptPValid({
    attempt,
    candidateIndex: 0,
    candidateCount: 1,
  });
  attempt.p_valid = pValid;
  asRecord(attempt.details).p_valid = pValid;

  const emailVerification = buildEmailVerificationStateFromAttempt({
    verificationModeUsed,
    attempt,
  });
  return {
    email: normalizedEmail,
    realVerifiedEmail: isSafeExactVerificationState(emailVerification),
    emailVerification,
  };
}

export function emailFinderHealthPayload() {
  return {
    ok: true,
    service: "internal-email-finder",
    method: "pattern-scored-ts-local-enrichanything",
  };
}

export async function buildEmailFinderGuessResponse(payload: unknown) {
  try {
    return await runGuess(payload);
  } catch (error) {
    return {
      ok: false,
      error: String((error as Error)?.message ?? error ?? "invalid request"),
    };
  }
}

export async function buildEmailFinderBatchResponse(payload: unknown) {
  const body = asRecord(payload);
  const defaultItem = asRecord(body.default_item);
  const batchRequestId =
    String(body.request_id ?? defaultItem.request_id ?? "").trim() || generateRequestId();
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.slice(0, MAX_BATCH_ITEMS);
  const continueOnError = parseBool(body.continue_on_error, true);
  const concurrency = boundedInt(body.concurrency, 3, 1, MAX_BATCH_CONCURRENCY);
  const domainCache = new Map<string, Promise<DomainInsights>>();

  const getDomainInsights = (domain: string, timeoutMs: number) => {
    const cacheKey = `${domain}:${timeoutMs}`;
    const existing = domainCache.get(cacheKey);
    if (existing) return existing;
    const next = loadDomainInsights(domain, timeoutMs);
    domainCache.set(cacheKey, next);
    return next;
  };

  const results = new Array(items.length) as Array<{
    index: number;
    id: string;
    ok: boolean;
    result: Record<string, unknown>;
    error: string;
  }>;

  let cursor = 0;
  let aborted = false;

  const workers = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length || aborted) return;

      const item = asRecord(items[index]);
      const mergedPayload: Record<string, unknown> = {
        ...defaultItem,
        ...item,
        request_id:
          String(item.request_id ?? defaultItem.request_id ?? "").trim() || batchRequestId,
      };
      const id = String(mergedPayload.id ?? `lead-${index}`).trim() || `lead-${index}`;

      try {
        const result = await runGuess(mergedPayload, getDomainInsights);
        results[index] = {
          index,
          id,
          ok: true,
          result,
          error: "",
        };
      } catch (error) {
        results[index] = {
          index,
          id,
          ok: false,
          result: {},
          error: String((error as Error)?.message ?? error ?? "invalid item"),
        };
        if (!continueOnError) {
          aborted = true;
          return;
        }
      }
    }
  });

  await Promise.all(workers);

  const finalized = results.filter(Boolean);
  const requestedVerificationMode = String(
    defaultItem.verification_mode ?? body.verification_mode ?? "local"
  )
    .trim()
    .toLowerCase();
  const effectiveModes = new Set<string>();
  let okCount = 0;
  let matchedCount = 0;
  let creditsUsed = 0;
  let cacheHits = 0;
  let cacheHitLeads = 0;
  const failedIds = [] as string[];

  for (const row of finalized) {
    if (!row.ok) {
      failedIds.push(row.id);
      continue;
    }

    okCount += 1;
    const result = asRecord(row.result);
    const verification = asRecord(result.verification);
    const bestGuess = asRecord(result.best_guess);
    const attempts = Array.isArray(result.attempts) ? result.attempts.map((item) => asRecord(item)) : [];
    const itemCacheHits = attempts.filter((attempt) => asRecord(attempt.details).cache_hit === true).length;

    const mode = String(verification.mode ?? "")
      .trim()
      .toLowerCase();
    if (mode) effectiveModes.add(mode);
    creditsUsed += Math.max(0, Number(verification.credits_used ?? 0) || 0);
    cacheHits += itemCacheHits;
    if (itemCacheHits > 0) cacheHitLeads += 1;
    if (String(bestGuess.email ?? "").trim()) matchedCount += 1;
  }

  await appendEmailFinderAuditEntry({
    requestId: batchRequestId,
    source: String(body.audit_source ?? defaultItem.audit_source ?? "unspecified").trim() || "unspecified",
    context: asRecord(body.audit_context ?? defaultItem.audit_context),
    itemCount: items.length,
    resultsCount: finalized.length,
    okCount,
    failedCount: finalized.length - okCount,
    matchedCount,
    failedIds: failedIds.slice(0, 12),
    verificationModeRequested: requestedVerificationMode || "local",
    verificationModesUsed: Array.from(effectiveModes).sort(),
    maxCreditsPerLead: Math.max(0, Number(defaultItem.max_credits ?? 0) || 0),
    timeoutSeconds: Math.max(
      0,
      Number(defaultItem.timeout_seconds ?? defaultItem.probe_timeout_seconds ?? 0) || 0
    ),
    concurrency,
    continueOnError,
    creditsUsed,
    cacheHits,
    cacheHitLeads,
  });

  return {
    ok: finalized.every((row) => row.ok),
    mode: "batch",
    item_count: rawItems.length,
    processed_count: finalized.length,
    success_count: finalized.filter((row) => row.ok).length,
    error_count: finalized.filter((row) => !row.ok).length,
    concurrency,
    continue_on_error: continueOnError,
    truncated: rawItems.length > MAX_BATCH_ITEMS,
    results: finalized,
  };
}
