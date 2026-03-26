import { promises as dns } from "dns";
import { readFile } from "fs/promises";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type EmailFinderVerificationMode = "validatedmails" | "heuristic";

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
  id: string;
  name: string;
  domain: string;
  maxCandidates: number;
  knownEmails: string[];
  verificationMode: EmailFinderVerificationMode;
  validatedMailsApiKey: string;
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
};

const TABLE_RUN_LEAD = "demanddev_outreach_run_leads";
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]+)+$/;
const PREVIEW_PLACEHOLDER_EMAIL_PREFIX = "preview-missing-email+";
const OUTREACH_PATH = process.env.VERCEL ? "/tmp/factory_outreach.v1.json" : `${process.cwd()}/data/outreach.v1.json`;
const TRUSTED_STATUSES = new Set(["new", "scheduled", "sent", "replied", "unsubscribed"]);
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
const VALIDATEDMAILS_URL = "https://api.validatedmails.com/validate";
const MAX_BATCH_ITEMS = 200;
const MAX_BATCH_CONCURRENCY = 10;

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

function buildCandidates(config: ValidationConfig, knownEmails: string[]) {
  const localParts = generateLocalParts(config.name);
  if (!localParts.length) {
    throw new Error("could not generate candidates from name");
  }

  const generated = localParts.slice(0, config.maxCandidates).map((localPart) => `${localPart}@${config.domain}`);
  const cleanedKnownEmails = uniqueInOrder(knownEmails.filter((email) => isUsableKnownEmail(email, config.domain)));

  if (!cleanedKnownEmails.length) {
    return {
      orderedCandidates: generated,
      patternScores: {} as Record<string, number>,
      orderingMeta: { method: "generation_order" },
      profile: buildPatternProfile([], config.domain),
    };
  }

  const profile = buildPatternProfile(cleanedKnownEmails, config.domain);
  const rows = buildPatternScores(generated, profile);

  return {
    orderedCandidates: rows.map((row) => row.email),
    patternScores: Object.fromEntries(rows.map((row) => [row.email, row.pattern_score])),
    orderingMeta: {
      method: "pattern_score",
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
  const normalized = String(value ?? "validatedmails").trim().toLowerCase();
  if (normalized === "validatedmails") {
    return "validatedmails";
  }
  if (["heuristic", "pattern", "none", "best_guess", "best-guess"].includes(normalized)) {
    return "heuristic";
  }
  throw new Error("Only verification modes 'validatedmails' and 'heuristic' are supported");
}

function parseValidationConfig(payload: unknown): ValidationConfig {
  const body = asRecord(payload);
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
  const validatedMailsApiKey = String(body.validatedmails_api_key ?? "").trim();

  if (verificationMode === "validatedmails" && !validatedMailsApiKey) {
    throw new Error("validatedmails_api_key is required for real verification");
  }

  return {
    id: String(body.id ?? "").trim() || "lead-0",
    name,
    domain,
    maxCandidates: boundedInt(body.max_candidates, 12, 1, 20),
    knownEmails: rawKnownEmails.map((value) => extractFirstEmailAddress(value)).filter(Boolean),
    verificationMode,
    validatedMailsApiKey,
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

async function loadHistoricalKnownEmails(domain: string, limit = 24): Promise<string[]> {
  if (isNonCompanyProfileDomain(domain)) return [];
  const accepted = new Set<string>();

  const acceptEmail = (email: unknown, status: unknown) => {
    const normalized = extractFirstEmailAddress(email);
    const normalizedStatus = String(status ?? "").trim().toLowerCase();
    if (!TRUSTED_STATUSES.has(normalizedStatus)) return;
    if (!isUsableKnownEmail(normalized, domain)) return;
    accepted.add(normalized);
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      const { data } = await supabase
        .from(TABLE_RUN_LEAD)
        .select("email,status,updated_at")
        .eq("domain", domain)
        .order("updated_at", { ascending: false })
        .limit(Math.max(limit * 4, limit));
      for (const row of data ?? []) {
        const record = asRecord(row);
        acceptEmail(record.email, record.status);
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
      acceptEmail(row.email, row.status);
      if (accepted.size >= limit) break;
    }
  } catch {
    return [...accepted];
  }

  return [...accepted];
}

async function loadDomainInsights(domain: string, timeoutMs: number): Promise<DomainInsights> {
  const [mx, historicalKnownEmails] = await Promise.all([
    resolveDomainMailSignal(domain, timeoutMs),
    loadHistoricalKnownEmails(domain),
  ]);

  return {
    domain,
    mx,
    historicalKnownEmails,
  };
}

async function verifyWithValidatedMails(email: string, apiKey: string, timeoutSeconds: number) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), Math.max(1000, timeoutSeconds * 1000));

  try {
    const response = await fetch(VALIDATEDMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    });

    let payload: unknown = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    const data = asRecord(payload);
    const providerStatus = String(
      data.status ?? data.result ?? data.verdict ?? data.state ?? ""
    )
      .trim()
      .toLowerCase();
    const toBoolish = (value: unknown) => {
      if (typeof value === "boolean") return value;
      const normalized = String(value ?? "").trim().toLowerCase();
      if (!normalized) return null;
      if (["true", "1", "yes"].includes(normalized)) return true;
      if (["false", "0", "no"].includes(normalized)) return false;
      return null;
    };
    const acceptAll =
      toBoolish(data.accept_all) === true ||
      toBoolish(data.acceptall) === true ||
      toBoolish(data.catch_all) === true ||
      toBoolish(data.catchall) === true;
    const isValid = toBoolish(data.is_valid);
    const isDeliverable =
      toBoolish(data.deliverable) === true ||
      toBoolish(data.is_deliverable) === true ||
      toBoolish(data.smtp_ok) === true ||
      toBoolish(data.smtp_check) === true ||
      toBoolish(data.smtp_valid) === true ||
      toBoolish(data.reachable) === true;
    const status = providerStatus;

    let verdict = "unknown";
    let reason = "unrecognized response status";
    if (
      [
        "valid",
        "deliverable",
        "accepted",
        "ok",
        "safe",
        "safe-to-send",
        "safe_to_send",
        "reachable",
      ].includes(status)
    ) {
      verdict = acceptAll ? "risky-valid" : "likely-valid";
      reason = acceptAll ? `${status} + catch-all=true` : `${status} + catch-all=false`;
    } else if (
      ["catch-all", "catch_all", "accept-all", "accept_all", "catchall", "risky-valid", "risky_valid", "risky"].includes(
        status
      )
    ) {
      verdict = "risky-valid";
      reason = `${status} + catch-all routing`;
    } else if (["invalid", "undeliverable", "rejected", "bounce", "bounced", "failed", "bad"].includes(status)) {
      verdict = "invalid";
      reason = `status=${status}`;
    } else if (status === "unknown") {
      verdict = "unknown";
      reason = "status=unknown";
    } else if (isDeliverable) {
      verdict = acceptAll ? "risky-valid" : "likely-valid";
      reason = acceptAll ? "deliverable=true + catch-all=true" : "deliverable=true";
    } else if (isValid === true) {
      verdict = acceptAll ? "risky-valid" : "likely-valid";
      reason = acceptAll ? "is_valid=true + catch-all=true" : "is_valid=true";
    } else if (isValid === false) {
      verdict = "invalid";
      reason = "is_valid=false";
    }

    let confidence = "low";
    const rawScore = typeof data.score === "number" ? data.score : Number(data.score);
    const score = Number.isFinite(rawScore) ? rawScore : null;
    if (status === "invalid" || verdict === "invalid") {
      confidence = "high";
    } else if (verdict === "likely-valid") {
      confidence = acceptAll ? "medium" : score !== null && score >= 90 ? "high" : "medium";
    } else if (verdict === "risky-valid") {
      confidence = score !== null && score >= 85 ? "medium" : "low";
    }

    return {
      verdict,
      confidence,
      details: {
        verdict,
        reason,
        provider: "validatedmails",
        provider_status: providerStatus,
        provider_reason: data.reason,
        accept_all: data.accept_all,
        catch_all: data.catch_all ?? data.catchall,
        deliverable: data.deliverable ?? data.is_deliverable,
        smtp_ok: data.smtp_ok,
        score: data.score,
        trace_id: data.trace_id,
        http_status: response.status,
        mx_status: "mail-ready",
      },
    };
  } catch (error) {
    return {
      verdict: "unknown",
      confidence: "low",
      details: {
        verdict: "unknown",
        reason: "validatedmails request failed",
        provider: "validatedmails",
        error: String((error as Error)?.message ?? error ?? "request failed"),
      },
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
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
    };

  const combinedKnownEmails = uniqueInOrder([
    ...config.knownEmails,
    ...domainInsights.historicalKnownEmails,
  ]).filter((email) => isUsableKnownEmail(email, config.domain));

  const { orderedCandidates, patternScores, orderingMeta, profile } = buildCandidates(config, combinedKnownEmails);

  const attempts = [] as Array<Record<string, unknown>>;
  let creditsUsed = 0;
  const verificationModeUsed = config.verificationMode;

  for (const [index, email] of orderedCandidates.entries()) {
    let outcome: {
      verdict: string;
      confidence: string;
      details: Record<string, unknown>;
    };

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
      if (creditsUsed >= config.maxCredits) {
        break;
      }
      outcome = await verifyWithValidatedMails(email, config.validatedMailsApiKey, config.timeoutSeconds);
      creditsUsed += 1;
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
      verification_mode: config.verificationMode,
      verification_mode_used: verificationModeUsed,
      stop_on_first_hit: config.stopOnFirstHit,
      stop_on_min_confidence: config.stopOnMinConfidence,
      max_credits: verificationModeUsed === "validatedmails" ? config.maxCredits : 0,
      hit_statuses: config.hitStatuses,
      high_confidence_only: config.highConfidenceOnly,
      enable_risky_queue: config.enableRiskyQueue,
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
      provider: verificationModeUsed === "validatedmails" ? "validatedmails" : "internal-email-finder",
      credits_used: creditsUsed,
      max_credits: verificationModeUsed === "validatedmails" ? config.maxCredits : 0,
      mx_status: domainInsights.mx.status,
      mx_records: domainInsights.mx.records,
      mx_error: domainInsights.mx.error,
      historical_known_emails: domainInsights.historicalKnownEmails,
    },
    routing,
    domain_fingerprint: {
      enabled: domainInsights.historicalKnownEmails.length > 0,
      source: "outreach-history",
      summary: {
        domain: config.domain,
        sample_size: domainInsights.historicalKnownEmails.length,
        mx_status: domainInsights.mx.status,
        risk_hint:
          domainInsights.mx.status === "no-mail-route"
            ? "no-mail-route"
            : domainInsights.historicalKnownEmails.length >= 3
              ? "pattern-backed"
              : domainInsights.historicalKnownEmails.length > 0
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

export function emailFinderHealthPayload() {
  return {
    ok: true,
    service: "internal-email-finder",
    method: "pattern-scored-ts",
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
      const mergedPayload = { ...defaultItem, ...item };
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
