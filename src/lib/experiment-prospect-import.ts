import {
  ensureRuntimeForExperiment,
  getExperimentRecordById,
  updateExperimentRecord,
} from "@/lib/experiment-data";
import { verifyExactEmailAddress } from "@/lib/internal-email-finder";
import type { EmailVerificationState, LeadQualityPolicy, OutreachRunLead } from "@/lib/factory-types";
import { resolveLlmModel } from "@/lib/llm-router";
import {
  createOutreachEvent,
  createOutreachRun,
  getBrandOutreachAssignment,
  loadHistoricalCompanyDomains,
  listOwnerRuns,
  listRunLeads,
  updateRunLead,
  updateOutreachRun,
  upsertRunLeads,
} from "@/lib/outreach-data";
import {
  evaluateLeadAgainstQualityPolicy,
  enrichLeadsWithEmailFinderBatch,
  extractFirstEmailAddress,
  getLeadEmailSuppressionReason,
  resolveEmailFinderApiBaseUrl,
  type ApifyLead,
  type EmailFinderVerificationMode,
} from "@/lib/outreach-providers";

type SelectionLeadCandidate = {
  rowNumber: number;
  lead: ApifyLead;
  sourceKind: ProspectEvidenceSourceKind;
  sourceDomain: string;
  domainResolutionSource: ProspectDomainResolutionSource;
};

export type ImportedLead = {
  email: string;
  name: string;
  company: string;
  title: string;
  domain: string;
  sourceUrl: string;
  realVerifiedEmail?: boolean;
  emailVerification?: EmailVerificationState | null;
};

export type ProspectLeadStage =
  | "discovered"
  | "verified_source"
  | "verified_contact"
  | "sendable"
  | "rejected";

export type ProspectEvidenceSourceKind =
  | "company_site"
  | "publisher"
  | "directory"
  | "social"
  | "profile"
  | "unknown";

export type ProspectDomainResolutionSource =
  | "email_domain"
  | "provided_domain"
  | "company_site_source"
  | "historical"
  | "clearout"
  | "unresolved";

export type ProspectLeadQualityPipeline = Record<ProspectLeadStage, number>;

type ProspectLeadAssessment = {
  rowNumber: number;
  stage: ProspectLeadStage;
  accepted: boolean;
  sendable: boolean;
  reason: string;
  message: string;
  normalizedLead: ApifyLead;
  importedLead?: ImportedLead;
};

type CompanyDomainResolution = {
  company: string;
  domain: string;
  source: ProspectDomainResolutionSource;
};

export type ImportExperimentProspectRowsResult = {
  runId: string;
  status: "completed";
  attemptedCount: number;
  importedCount: number;
  storedLeadCount: number;
  storedForVerificationCount: number;
  skippedCount: number;
  matchedCount: number;
  dedupedCount: number;
  parseErrorCount: number;
  parseErrors: string[];
  enrichmentError: string;
  failureSummary: Array<{ reason: string; count: number }>;
  autoLaunchAttempted: boolean;
  autoLaunchTriggered: boolean;
  autoLaunchBlocked: boolean;
  autoLaunchRunId: string;
  autoLaunchReason: string;
  qualityPipeline: ProspectLeadQualityPipeline;
  qualityRejectionSummary: Array<{ reason: string; count: number }>;
};

export type ExperimentSendableLeadSummary = {
  sendableLeadCount: number;
  storedLeadCount: number;
  storedForVerificationCount: number;
  runsChecked: number;
};

type CompanyDomainIdentityDecision = {
  sameCompany: boolean;
  confidenceScore: number;
  reasoning: string;
};

const COMPANY_DOMAIN_IDENTITY_LLM_CONFIDENCE_THRESHOLD = 80;
const companyDomainIdentityDecisionCache = new Map<string, Promise<CompanyDomainIdentityDecision>>();

function normalizePersonIdentity(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function emailVerificationStrength(value: EmailVerificationState | null | undefined) {
  if (!value) return 0;
  const verdict = String(value.verdict ?? "").trim().toLowerCase();
  if (value.acceptAll === true || value.catchAll === true || verdict === "risky-valid") {
    return 1;
  }
  if (["likely-valid", "deliverable", "valid"].includes(verdict)) {
    return 3;
  }
  if (["invalid", "undeliverable"].includes(verdict)) {
    return -1;
  }
  return 0;
}

function buildImportedLeadRefreshPatch(input: {
  existingLead: OutreachRunLead;
  incomingLead: ImportedLead;
  allowEmailReplace?: boolean;
}) {
  const patch: Partial<
    Pick<
      OutreachRunLead,
      "email" | "name" | "company" | "title" | "domain" | "sourceUrl" | "realVerifiedEmail" | "emailVerification"
    >
  > = {};
  const nextEmail = extractFirstEmailAddress(input.incomingLead.email).toLowerCase();
  const currentEmail = extractFirstEmailAddress(input.existingLead.email).toLowerCase();

  if (input.allowEmailReplace && nextEmail && nextEmail !== currentEmail) {
    patch.email = nextEmail;
  }
  if (input.incomingLead.name && input.incomingLead.name !== input.existingLead.name) {
    patch.name = input.incomingLead.name;
  }
  if (input.incomingLead.company && input.incomingLead.company !== input.existingLead.company) {
    patch.company = input.incomingLead.company;
  }
  if (input.incomingLead.title && input.incomingLead.title !== input.existingLead.title) {
    patch.title = input.incomingLead.title;
  }
  if (input.incomingLead.domain && input.incomingLead.domain !== input.existingLead.domain) {
    patch.domain = input.incomingLead.domain;
  }
  if (input.incomingLead.sourceUrl && input.incomingLead.sourceUrl !== input.existingLead.sourceUrl) {
    patch.sourceUrl = input.incomingLead.sourceUrl;
  }
  if (input.incomingLead.realVerifiedEmail === true && input.existingLead.realVerifiedEmail !== true) {
    patch.realVerifiedEmail = true;
  }

  const incomingVerification = input.incomingLead.emailVerification ?? null;
  const existingVerification = input.existingLead.emailVerification ?? null;
  if (emailVerificationStrength(incomingVerification) > emailVerificationStrength(existingVerification)) {
    patch.emailVerification = incomingVerification;
  }

  return Object.keys(patch).length ? patch : null;
}

export async function refreshStoredDuplicateSelectionLeads(input: {
  existingLeads: OutreachRunLead[];
  incomingLeads: ImportedLead[];
  oneContactPerCompany?: boolean;
}) {
  const existingLeadEntries = input.existingLeads.map((lead) => ({
    lead,
    email: extractFirstEmailAddress(lead.email).toLowerCase(),
    companyKey: companyKeyFromLead(lead),
    nameKey: normalizePersonIdentity(lead.name),
  }));

  const existingByEmail = new Map<string, typeof existingLeadEntries>();
  const existingByCompanyAndName = new Map<string, typeof existingLeadEntries>();

  for (const entry of existingLeadEntries) {
    if (entry.email) {
      const list = existingByEmail.get(entry.email) ?? [];
      list.push(entry);
      existingByEmail.set(entry.email, list);
    }
    if (entry.companyKey && entry.nameKey) {
      const key = `${entry.companyKey}|${entry.nameKey}`;
      const list = existingByCompanyAndName.get(key) ?? [];
      list.push(entry);
      existingByCompanyAndName.set(key, list);
    }
  }

  let refreshedCount = 0;
  const touchedLeadIds = new Set<string>();

  for (const incomingLead of input.incomingLeads) {
    const incomingEmail = extractFirstEmailAddress(incomingLead.email).toLowerCase();
    const exactMatches = incomingEmail ? existingByEmail.get(incomingEmail) ?? [] : [];
    const candidates =
      exactMatches.length > 0
        ? exactMatches
        : input.oneContactPerCompany !== false
          ? existingByCompanyAndName.get(
              `${companyKeyFromLead(incomingLead)}|${normalizePersonIdentity(incomingLead.name)}`
            ) ?? []
          : [];

    for (const candidate of candidates) {
      if (touchedLeadIds.has(candidate.lead.id)) {
        continue;
      }
      const patch = buildImportedLeadRefreshPatch({
        existingLead: candidate.lead,
        incomingLead,
        allowEmailReplace: exactMatches.length === 0,
      });
      if (!patch) {
        continue;
      }
      const updated = await updateRunLead(candidate.lead.id, patch);
      if (!updated) {
        continue;
      }
      touchedLeadIds.add(candidate.lead.id);
      refreshedCount += 1;
    }
  }

  return { refreshedCount };
}

export function emptyProspectLeadQualityPipeline(): ProspectLeadQualityPipeline {
  return {
    discovered: 0,
    verified_source: 0,
    verified_contact: 0,
    sendable: 0,
    rejected: 0,
  };
}

function resolveImportVerificationMode(): EmailFinderVerificationMode {
  const rawMode = String(
    process.env.EMAIL_FINDER_IMPORT_VERIFICATION_MODE ??
      process.env.OUTREACH_EMAIL_FINDER_IMPORT_VERIFICATION_MODE ??
      ""
  ).trim();
  const normalized = rawMode.toLowerCase();
  if (normalized === "validatedmails") return "local";
  if (["local", "smtp", "smtp_local", "smtp-local"].includes(normalized)) return "local";
  if (["heuristic", "pattern", "none", "best_guess", "best-guess"].includes(normalized)) {
    return "heuristic";
  }
  return "local";
}

function resolveEmailFinderImportMaxTotalCredits() {
  const parsed = Number(process.env.EMAIL_FINDER_IMPORT_MAX_TOTAL_CREDITS ?? 25);
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(1, Math.min(500, Math.trunc(parsed)));
}

function resolveStoredLeadVerificationMode(): EmailFinderVerificationMode {
  const normalized = String(
    process.env.EMAIL_FINDER_STORED_LEAD_VERIFICATION_MODE ??
      process.env.EMAIL_FINDER_PENDING_LEAD_VERIFICATION_MODE ??
      ""
  )
    .trim()
    .toLowerCase();
  if (normalized === "validatedmails") return "local";
  if (["local", "smtp", "smtp_local", "smtp-local"].includes(normalized)) return "local";
  if (["heuristic", "pattern", "none", "best_guess", "best-guess"].includes(normalized)) {
    return "heuristic";
  }
  return "local";
}

function resolveStoredLeadVerificationMaxLeads(value: unknown = process.env.EMAIL_FINDER_STORED_LEAD_MAX_CHECKS) {
  const parsed = Math.trunc(Number(value ?? 8) || 8);
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(1, Math.min(25, parsed));
}

function shouldReplaceEmailVerificationState(
  current: EmailVerificationState | null | undefined,
  next: EmailVerificationState | null | undefined
) {
  if (!next) return false;
  if (!current) return true;
  if (current.mode === "heuristic" && next.mode !== "heuristic") {
    return true;
  }
  if (emailVerificationStrength(next) !== emailVerificationStrength(current)) {
    return true;
  }
  const currentPValid = Number(current.pValid ?? Number.NaN);
  const nextPValid = Number(next.pValid ?? Number.NaN);
  if (Number.isFinite(nextPValid) && (!Number.isFinite(currentPValid) || Math.abs(nextPValid - currentPValid) > 0.0001)) {
    return true;
  }
  return (
    current.mode !== next.mode ||
    current.provider !== next.provider ||
    current.verdict !== next.verdict ||
    current.confidence !== next.confidence ||
    current.reason !== next.reason ||
    current.mxStatus !== next.mxStatus ||
    current.acceptAll !== next.acceptAll ||
    current.catchAll !== next.catchAll ||
    Number(current.httpStatus ?? 0) !== Number(next.httpStatus ?? 0) ||
    String(current.providerStatus ?? "") !== String(next.providerStatus ?? "")
  );
}

function pendingStoredLeadPriority(lead: OutreachRunLead) {
  const verification = lead.emailVerification ?? null;
  const verificationStrength = emailVerificationStrength(verification);
  const pValid = Number(verification?.pValid ?? Number.NaN);
  const confidence =
    String(verification?.confidence ?? "").trim().toLowerCase() === "high"
      ? 2
      : String(verification?.confidence ?? "").trim().toLowerCase() === "medium"
        ? 1
        : 0;
  const updatedAtMs = Date.parse(lead.updatedAt);
  return (
    verificationStrength * 1000 +
    (Number.isFinite(pValid) ? pValid * 100 : 0) +
    confidence * 10 +
    (Number.isFinite(updatedAtMs) ? updatedAtMs / 1_000_000_000_000 : 0)
  );
}

function verifiedStoredLeadPriority(input: {
  lead: OutreachRunLead;
  verification: EmailVerificationState | null;
}) {
  const verificationStrength = emailVerificationStrength(input.verification);
  const pValid = Number(input.verification?.pValid ?? Number.NaN);
  const confidence =
    String(input.verification?.confidence ?? "").trim().toLowerCase() === "high"
      ? 2
      : String(input.verification?.confidence ?? "").trim().toLowerCase() === "medium"
        ? 1
        : 0;
  const updatedAtMs = Date.parse(input.lead.updatedAt);
  return (
    verificationStrength * 1000 +
    (Number.isFinite(pValid) ? pValid * 100 : 0) +
    confidence * 10 +
    (Number.isFinite(updatedAtMs) ? updatedAtMs / 1_000_000_000_000 : 0)
  );
}

function isStoredLeadInvalidAfterVerification(verification: EmailVerificationState | null | undefined) {
  if (!verification) return false;
  const verdict = String(verification.verdict ?? "").trim().toLowerCase();
  const mxStatus = String(verification.mxStatus ?? "").trim().toLowerCase();
  return verdict === "invalid" || verdict === "undeliverable" || mxStatus === "no-mail-route";
}

function isStoredLeadVerificationCandidate(
  lead: OutreachRunLead,
  input: {
    qualityPolicy?: LeadQualityPolicy;
  } = {}
) {
  if (!isReusableExperimentLeadStatus(lead.status)) return false;
  const email = extractFirstEmailAddress(lead.email);
  if (!email) return false;
  if (lead.realVerifiedEmail === true) return false;
  if (isRunLeadSendable(lead, { qualityPolicy: input.qualityPolicy })) return false;
  const verdict = String(lead.emailVerification?.verdict ?? "").trim().toLowerCase();
  if (verdict === "invalid" || verdict === "undeliverable") return false;
  return true;
}

export type StoredLeadReverificationResult = {
  checkedLeadCount: number;
  updatedLeadCount: number;
  promotedLeadCount: number;
  suppressedLeadCount: number;
};

export async function reverifyStoredOwnerLeads(input: {
  brandId: string;
  ownerType: "experiment" | "campaign";
  ownerId: string;
  qualityPolicy?: LeadQualityPolicy;
  oneContactPerCompany?: boolean;
  maxLeads?: number;
  verificationMode?: EmailFinderVerificationMode;
}): Promise<StoredLeadReverificationResult> {
  const runs = await listOwnerRuns(input.brandId, input.ownerType, input.ownerId);
  if (!runs.length) {
    return {
      checkedLeadCount: 0,
      updatedLeadCount: 0,
      promotedLeadCount: 0,
      suppressedLeadCount: 0,
    };
  }

  const leadLists = await Promise.all(runs.map((run) => listRunLeads(run.id)));
  const allLeads = leadLists.flat();
  const enforceOneContactPerCompany = input.oneContactPerCompany !== false;
  const sendableCompanyKeys = enforceOneContactPerCompany
    ? new Set(
        allLeads
          .filter(
            (lead) =>
              isReusableExperimentLeadStatus(lead.status) &&
              isRunLeadSendable(lead, { qualityPolicy: input.qualityPolicy })
          )
          .map((lead) => companyKeyFromLead(lead))
          .filter(Boolean)
      )
    : new Set<string>();

  const selected = allLeads
    .filter((lead) => isStoredLeadVerificationCandidate(lead, { qualityPolicy: input.qualityPolicy }))
    .sort((left, right) => pendingStoredLeadPriority(right) - pendingStoredLeadPriority(left))
    .slice(0, resolveStoredLeadVerificationMaxLeads(input.maxLeads));

  if (!selected.length) {
    return {
      checkedLeadCount: 0,
      updatedLeadCount: 0,
      promotedLeadCount: 0,
      suppressedLeadCount: 0,
    };
  }

  const verificationMode = input.verificationMode ?? resolveStoredLeadVerificationMode();
  const verifiedRows = [] as Array<{
    lead: OutreachRunLead;
    companyKey: string;
    realVerifiedEmail: boolean;
    emailVerification: EmailVerificationState | null;
  }>;

  for (const lead of selected) {
    const email = extractFirstEmailAddress(lead.email);
    const verification = await verifyExactEmailAddress({
      email,
      verificationMode,
    });
    verifiedRows.push({
      lead,
      companyKey: companyKeyFromLead(lead),
      realVerifiedEmail: verification.realVerifiedEmail,
      emailVerification: verification.emailVerification,
    });
  }

  const promotedLeadIds = new Set<string>();
  if (enforceOneContactPerCompany) {
    const bestByCompany = new Map<string, { leadId: string; score: number }>();
    for (const row of verifiedRows) {
      if (!row.realVerifiedEmail || !row.companyKey || sendableCompanyKeys.has(row.companyKey)) {
        continue;
      }
      const score = verifiedStoredLeadPriority({
        lead: row.lead,
        verification: row.emailVerification,
      });
      const current = bestByCompany.get(row.companyKey);
      if (!current || score > current.score) {
        bestByCompany.set(row.companyKey, { leadId: row.lead.id, score });
      }
    }
    for (const winner of bestByCompany.values()) {
      promotedLeadIds.add(winner.leadId);
    }
  } else {
    for (const row of verifiedRows) {
      if (row.realVerifiedEmail) {
        promotedLeadIds.add(row.lead.id);
      }
    }
  }

  let updatedLeadCount = 0;
  let promotedLeadCount = 0;
  let suppressedLeadCount = 0;

  for (const row of verifiedRows) {
    const nextVerification = row.emailVerification;
    const shouldSuppress = isStoredLeadInvalidAfterVerification(nextVerification);
    const nextRealVerifiedEmail =
      row.realVerifiedEmail &&
      (!enforceOneContactPerCompany || !row.companyKey || promotedLeadIds.has(row.lead.id));
    const patch: Partial<
      Pick<OutreachRunLead, "realVerifiedEmail" | "emailVerification" | "status">
    > = {};

    if (row.lead.realVerifiedEmail !== nextRealVerifiedEmail) {
      patch.realVerifiedEmail = nextRealVerifiedEmail;
    }
    if (shouldReplaceEmailVerificationState(row.lead.emailVerification ?? null, nextVerification)) {
      patch.emailVerification = nextVerification ?? null;
    }
    if (shouldSuppress && row.lead.status !== "suppressed") {
      patch.status = "suppressed";
    }
    if (!Object.keys(patch).length) {
      continue;
    }

    const updated = await updateRunLead(row.lead.id, patch);
    if (!updated) {
      continue;
    }
    updatedLeadCount += 1;
    if (patch.realVerifiedEmail === true && row.lead.realVerifiedEmail !== true) {
      promotedLeadCount += 1;
    }
    if (patch.status === "suppressed" && row.lead.status !== "suppressed") {
      suppressedLeadCount += 1;
    }
  }

  return {
    checkedLeadCount: verifiedRows.length,
    updatedLeadCount,
    promotedLeadCount,
    suppressedLeadCount,
  };
}

export function isReusableExperimentLeadStatus(status: string) {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "new" || normalized === "scheduled";
}

export function isTerminalExperimentLeadStatus(status: string) {
  const normalized = String(status ?? "").trim().toLowerCase();
  return (
    normalized === "suppressed" ||
    normalized === "sent" ||
    normalized === "replied" ||
    normalized === "bounced" ||
    normalized === "unsubscribed"
  );
}

export const NON_COMPANY_PROFILE_ROOTS = [
  "linkedin.com",
  "linkedin.co",
  "facebook.com",
  "x.com",
  "twitter.com",
  "instagram.com",
  "malt.com",
  "malt.fr",
  "malt.uk",
  "upwork.com",
  "fiverr.com",
  "contra.com",
  "freelancer.com",
  "freelancermap.de",
  "freelancermap.com",
  "freelancermap.at",
  "peopleperhour.com",
  "xing.com",
  "xing.de",
  "clutch.co",
  "sortlist.com",
  "sortlist.fr",
  "agencyspotter.com",
  "designrush.com",
  "goodfirms.co",
  "bark.com",
  "substack.com",
  "medium.com",
  "ghost.io",
  "semrush.com",
  "hubspot.com",
  "theorg.com",
  "twine.net",
];

const COMPANY_OWNED_PATH_HINTS = [
  "about",
  "about-us",
  "company",
  "team",
  "our-team",
  "leadership",
  "contact",
  "people",
  "staff",
  "meet-the-team",
  "management",
  "founders",
  "founder",
  "pricing",
  "product",
  "products",
  "platform",
  "solutions",
  "services",
  "integrations",
  "security",
  "trust",
  "demo",
  "trial",
];

const ARTICLE_PATH_HINTS = [
  "news",
  "blog",
  "blogs",
  "article",
  "articles",
  "press",
  "press-release",
  "press-releases",
  "story",
  "stories",
  "interview",
  "interviews",
  "updates",
  "events",
  "insights",
  "magazine",
  "journal",
  "career",
  "careers",
  "job",
  "jobs",
  "author",
  "authors",
  "newsletter",
  "media-kit",
  "mediakit",
  "press-kit",
  "podcast",
  "episode",
  "resource",
  "resources",
];

const PROFILE_SUBDOMAIN_HINTS = new Set([
  "app",
  "apps",
  "book",
  "booking",
  "calendar",
  "community",
  "events",
  "link",
  "links",
  "meet",
  "member",
  "members",
  "people",
  "profile",
  "profiles",
  "u",
  "user",
  "users",
]);

const LOW_SIGNAL_COMPANY_TOKENS = new Set([
  "co",
  "com",
  "company",
  "corp",
  "inc",
  "llc",
  "ltd",
  "group",
  "org",
  "net",
  "app",
  "dev",
  "io",
  "ai",
]);

const COMPANY_DESCRIPTOR_SUFFIX_TOKENS = new Set([
  ...LOW_SIGNAL_COMPANY_TOKENS,
  "advisory",
  "advisor",
  "advisors",
  "associates",
  "consulting",
  "partner",
  "partners",
  "practice",
  "strategies",
  "strategy",
]);

const SOCIAL_SOURCE_ROOTS = new Set([
  "linkedin.com",
  "linkedin.co",
  "facebook.com",
  "x.com",
  "twitter.com",
  "instagram.com",
]);

const DIRECTORY_SOURCE_ROOTS = new Set([
  "clutch.co",
  "sortlist.com",
  "sortlist.fr",
  "agencyspotter.com",
  "designrush.com",
  "goodfirms.co",
  "bark.com",
  "malt.com",
  "malt.fr",
  "malt.uk",
  "upwork.com",
  "fiverr.com",
  "contra.com",
  "freelancer.com",
  "freelancermap.de",
  "freelancermap.com",
  "freelancermap.at",
  "peopleperhour.com",
  "xing.com",
  "xing.de",
  "theorg.com",
  "twine.net",
]);

const PUBLISHER_SOURCE_ROOTS = new Set([
  "substack.com",
  "medium.com",
  "ghost.io",
]);

const IMPORT_LEAD_QUALITY_POLICY: LeadQualityPolicy = {
  allowFreeDomains: false,
  allowRoleInboxes: false,
  requirePersonName: true,
  requireCompany: true,
  requireTitle: false,
  minConfidenceScore: 0.42,
};

export const WARMUP_IMPORT_LEAD_QUALITY_POLICY: LeadQualityPolicy = {
  ...IMPORT_LEAD_QUALITY_POLICY,
  allowRoleInboxes: true,
  allowHighConfidenceFallbackEmail: true,
  fallbackMinPValid: 0.7,
  fallbackRequireMailReadyMx: true,
  fallbackOnlyWhenProviderUnavailable: true,
};

function normalizeCell(value: unknown) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized === "null" ? "" : normalized;
}

function trimText(value: unknown, maxLength: number) {
  const normalized = normalizeCell(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeConfidenceScore(value: unknown) {
  const numeric = Number(value ?? 0) || 0;
  const scaled = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
  return Math.max(0, Math.min(100, Number(scaled.toFixed(1))));
}

async function openAiJsonObjectCall(input: { prompt: string; model: string; maxOutputTokens?: number }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      input: input.prompt,
      text: { format: { type: "json_object" } },
      reasoning: { effort: "minimal" },
      max_output_tokens: input.maxOutputTokens ?? 350,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI JSON call failed (HTTP ${response.status}): ${trimText(raw, 260)}`);
  }

  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  const output = Array.isArray((payload as { output?: unknown[] })?.output)
    ? ((payload as { output: unknown[] }).output ?? [])
    : [];
  let contentText = "";
  for (const item of output) {
    const content = Array.isArray((item as { content?: unknown[] })?.content)
      ? (((item as { content: unknown[] }).content ?? []) as unknown[])
      : [];
    for (const part of content) {
      const textValue =
        typeof (part as { text?: unknown })?.text === "string"
          ? String((part as { text?: unknown }).text)
          : typeof (part as { output_text?: unknown })?.output_text === "string"
            ? String((part as { output_text?: unknown }).output_text)
            : "";
      if (textValue) {
        contentText += textValue;
      }
    }
  }

  if (!contentText.trim()) {
    throw new Error("OpenAI JSON call returned no text content.");
  }

  try {
    return JSON.parse(contentText) as Record<string, unknown>;
  } catch {
    throw new Error(`OpenAI JSON call returned invalid JSON: ${trimText(contentText, 260)}`);
  }
}

function companyDomainIdentityCacheKey(input: {
  company: string;
  domain: string;
  sourceUrl: string;
  personName: string;
  email: string;
}) {
  return JSON.stringify({
    company: normalizeCell(input.company).toLowerCase(),
    domain: normalizeDomainCandidate(input.domain),
    sourceUrl: normalizeCell(input.sourceUrl),
    personName: normalizeCell(input.personName).toLowerCase(),
    email: extractFirstEmailAddress(input.email).toLowerCase(),
  });
}

async function decideCompanyDomainIdentityWithLlm(input: { lead: ApifyLead }) {
  const company = normalizeCell(input.lead.company);
  const domain = normalizeDomainCandidate(input.lead.domain);
  if (!company || !domain || !process.env.OPENAI_API_KEY) {
    return {
      sameCompany: false,
      confidenceScore: 0,
      reasoning: "",
    } satisfies CompanyDomainIdentityDecision;
  }

  const sourceUrl = normalizeCell(input.lead.sourceUrl);
  const personName = normalizeCell(input.lead.name);
  const email = extractFirstEmailAddress(input.lead.email);
  const cacheKey = companyDomainIdentityCacheKey({ company, domain, sourceUrl, personName, email });
  const cached = companyDomainIdentityDecisionCache.get(cacheKey);
  if (cached) {
    return await cached;
  }

  const prompt = [
    "Decide whether the company name and domain refer to the same real company.",
    "Be conservative but practical.",
    "Treat merged words and spaced words as the same when the brand clearly matches.",
    "Treat corporate suffixes and descriptor suffixes as acceptable when the core identity matches.",
    "Examples of acceptable matches: P2EZPay <-> p2ezpay.com, Kinetic CFO <-> kineticcfo.com, Correa Legal LLC <-> correalegal.co.",
    "Return strict JSON only.",
    `{ "same_company": boolean, "confidence_score": number, "reasoning": string }`,
    `Company: ${company}`,
    `Domain: ${domain}`,
    `Person: ${personName || "unknown"}`,
    `Email: ${email || "unknown"}`,
    `Source URL: ${sourceUrl || "unknown"}`,
  ].join("\n");

  const promise = (async () => {
    try {
      const model = resolveLlmModel("company_domain_matcher", {
        prompt,
        legacyModelEnv: process.env.OPENAI_MODEL_COMPANY_DOMAIN_MATCHER || "gpt-5-nano",
      });
      const row = await openAiJsonObjectCall({ prompt, model, maxOutputTokens: 220 });
      return {
        sameCompany: row.same_company === true,
        confidenceScore: normalizeConfidenceScore(row.confidence_score),
        reasoning: trimText(row.reasoning, 220),
      } satisfies CompanyDomainIdentityDecision;
    } catch {
      return {
        sameCompany: false,
        confidenceScore: 0,
        reasoning: "",
      } satisfies CompanyDomainIdentityDecision;
    }
  })();

  companyDomainIdentityDecisionCache.set(cacheKey, promise);
  return await promise;
}

function normalizeHeaderKey(value: string) {
  return normalizeCell(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseUrlish(value: string) {
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol);
  } catch {
    return null;
  }
}

export function isNonCompanyProfileDomain(domain: string) {
  const normalized = domain.trim().toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
  if (!normalized) return false;
  return NON_COMPANY_PROFILE_ROOTS.some(
    (root) => normalized === root || normalized.endsWith(`.${root}`)
  );
}

export function normalizeDomainCandidate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.includes("@")) {
    return raw.split("@")[1]?.trim().toLowerCase().replace(/^www\./, "") ?? "";
  }

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const hostname = new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, "");
    return hostname;
  } catch {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[/?#].*$/, "")
      .replace(/\.+$/, "");
  }
}

function extractUrlPathSegments(value: string) {
  const parsed = parseUrlish(value);
  if (!parsed) return [];

  const pathname = parsed.pathname.toLowerCase().replace(/\/+/g, "/").replace(/\/$/, "");
  if (!pathname || pathname === "/") return [];
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/\.[a-z0-9]+$/i, ""));
}

function extractUrlSubdomainLabels(value: string) {
  const parsed = parseUrlish(value);
  if (!parsed) return [];

  const labels = parsed.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);
  if (labels.length <= 2) return [];

  const rootLabelCount =
    labels.length >= 3 &&
    labels[labels.length - 1].length === 2 &&
    ["ac", "co", "com", "edu", "gov", "net", "org"].includes(labels[labels.length - 2])
      ? 3
      : 2;
  return labels.length > rootLabelCount ? labels.slice(0, -rootLabelCount) : [];
}

export function isLikelyCompanyOwnedUrl(value: string) {
  const normalizedUrl = normalizeCell(value);
  if (!normalizedUrl) return false;

  const sourceDomain = normalizeDomainCandidate(normalizedUrl);
  if (!sourceDomain || isNonCompanyProfileDomain(sourceDomain)) {
    return false;
  }

  const segments = extractUrlPathSegments(value);
  const subdomainLabels = extractUrlSubdomainLabels(value);
  const joined = segments.join("/");

  if (
    subdomainLabels.some((label) => PROFILE_SUBDOMAIN_HINTS.has(label)) &&
    !segments.some((segment) => COMPANY_OWNED_PATH_HINTS.includes(segment))
  ) {
    return false;
  }

  if (
    segments.some((segment) => /^20\d{2}$/.test(segment)) ||
    segments.some((segment) => /^\d{1,2}$/.test(segment)) ||
    segments.some((segment) => /^\d{5,}$/.test(segment))
  ) {
    return false;
  }

  if (
    ARTICLE_PATH_HINTS.some(
      (hint) =>
        segments.includes(hint) ||
        joined.includes(`/${hint}/`) ||
        segments.some((segment) => segment.startsWith(`${hint}-`) || segment.endsWith(`-${hint}`))
    )
  ) {
    return false;
  }

  if (segments.some((segment) => segment.split("-").filter(Boolean).length >= 6)) {
    return false;
  }

  if (!segments.length) return true;

  if (segments.some((segment) => COMPANY_OWNED_PATH_HINTS.includes(segment))) {
    return true;
  }

  // Accept shallow first-party paths on company domains unless they already matched
  // an article/profile pattern above.
  return segments.length <= 2;
}

function rootDomain(value: string) {
  const normalized = normalizeDomainCandidate(value);
  if (!normalized) return "";
  const parts = normalized.split(".").filter(Boolean);
  if (parts.length <= 2) return normalized;
  const usesSecondLevelTld =
    parts[parts.length - 1]?.length === 2 &&
    ["ac", "co", "com", "edu", "gov", "net", "org"].includes(parts[parts.length - 2] ?? "");
  return parts.slice(usesSecondLevelTld ? -3 : -2).join(".");
}

function canonicalCompanyDomain(value: unknown) {
  const normalized = rootDomain(String(value ?? ""));
  if (!normalized || isNonCompanyProfileDomain(normalized)) {
    return "";
  }
  return normalized;
}

function classifyEvidenceSource(value: string): {
  kind: ProspectEvidenceSourceKind;
  sourceDomain: string;
} {
  const sourceDomain = normalizeDomainCandidate(value);
  if (!sourceDomain) {
    return { kind: "unknown", sourceDomain: "" };
  }
  const normalizedRoot = rootDomain(sourceDomain);
  if (isLikelyCompanyOwnedUrl(value)) {
    return { kind: "company_site", sourceDomain };
  }
  if (SOCIAL_SOURCE_ROOTS.has(normalizedRoot)) {
    return { kind: "social", sourceDomain };
  }
  if (DIRECTORY_SOURCE_ROOTS.has(normalizedRoot)) {
    return { kind: "directory", sourceDomain };
  }
  if (PUBLISHER_SOURCE_ROOTS.has(normalizedRoot)) {
    return { kind: "publisher", sourceDomain };
  }
  if (
    isNonCompanyProfileDomain(sourceDomain) ||
    extractUrlSubdomainLabels(value).some((label) => PROFILE_SUBDOMAIN_HINTS.has(label))
  ) {
    return { kind: "profile", sourceDomain };
  }
  return { kind: "unknown", sourceDomain };
}

function normalizeCompanyKey(value: string) {
  const tokens = normalizeCompanyName(value)
    .split(" ")
    .filter(Boolean);
  while (tokens.length > 1 && LOW_SIGNAL_COMPANY_TOKENS.has(tokens[tokens.length - 1] ?? "")) {
    tokens.pop();
  }
  return tokens.join(" ").trim();
}

function companyAliasKeys(value: string) {
  const raw = normalizeCell(value).toLowerCase().replace(/&/g, " and ");
  if (!raw) return [] as string[];

  const variants = new Set<string>([
    raw,
    raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim(),
  ]);
  const noParentheticals = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  for (const separator of ["/", "|", " - ", " – ", " — ", ","]) {
    if (noParentheticals.includes(separator)) {
      for (const part of noParentheticals.split(separator)) {
        variants.add(part.trim());
      }
    }
  }

  const keys = new Set<string>();
  for (const variant of variants) {
    const normalized = normalizeCompanyKey(variant);
    if (!normalized) continue;
    keys.add(normalized);
    const compact = normalized.replace(/\s+/g, "");
    if (compact && compact !== normalized) keys.add(compact);
  }
  return [...keys];
}

function companyTokens(value: string) {
  return normalizeCompanyKey(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !LOW_SIGNAL_COMPANY_TOKENS.has(token));
}

function inferDomainFromCompanyString(companyName: string) {
  const raw = normalizeCell(companyName).toLowerCase();
  if (!raw) return "";
  const directMatch = raw.match(/\b([a-z0-9-]+\.(?:com|co|io|ai|dev|app|net|org|xyz|so))\b/i);
  return normalizeDomainCandidate(directMatch?.[1] ?? "");
}

function scoreCompanyNameMatch(companyName: string, candidateName: string, candidateDomain: string) {
  const queryKey = normalizeCompanyKey(companyName);
  const candidateKey = normalizeCompanyKey(candidateName);
  if (!queryKey || !candidateKey) return 0;
  if (queryKey === candidateKey) return 1;

  const queryAliases = companyAliasKeys(companyName);
  const candidateAliases = companyAliasKeys(candidateName);
  if (queryAliases.some((alias) => candidateAliases.includes(alias))) {
    return 0.98;
  }

  const queryTokens = companyTokens(queryKey);
  const candidateTokens = companyTokens(candidateKey);
  if (!queryTokens.length || !candidateTokens.length) return 0;

  const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;
  const recall = overlap / queryTokens.length;
  const precision = overlap / candidateTokens.length;
  let score = 0.65 * recall + 0.35 * precision;

  const queryCompact = queryTokens.join("");
  const candidateRoot = normalizeDomainCandidate(candidateDomain).split(".", 1)[0] ?? "";
  if (candidateRoot && queryCompact && (candidateRoot === queryCompact || candidateRoot.startsWith(queryCompact))) {
    score += 0.1;
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

async function resolveCompanyDomainWithClearout(
  companyName: string,
  options: { timeoutMs?: number } = {}
) {
  const query = normalizeCompanyKey(companyName) || normalizeCell(companyName);
  if (!query) return null;

  const timeoutMs = Math.max(250, Math.min(10_000, Math.trunc(Number(options.timeoutMs ?? 2_000) || 2_000)));
  let response: Response;
  try {
    response = await fetch(
      `https://api.clearout.io/public/companies/autocomplete?query=${encodeURIComponent(query)}`,
      {
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
  } catch (error) {
    const abortLike =
      error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    if (abortLike) {
      throw new Error(`Clearout autocomplete timed out after ${timeoutMs}ms.`);
    }
    throw error;
  }
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Clearout autocomplete failed (${response.status}): ${raw.slice(0, 220)}`);
  }

  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  const data =
    payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray((payload as { data?: unknown[] }).data)
      ? ((payload as { data: unknown[] }).data ?? [])
      : [];
  const candidates = data
    .map((entry) => (entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {}))
    .map((entry) => {
      const name = normalizeCell(entry.name);
      const domain = rootDomain(String(entry.domain ?? ""));
      const confidenceScore = Number(entry.confidence_score ?? 0) || 0;
      const matchScore = scoreCompanyNameMatch(query, name, domain);
      return { name, domain, confidenceScore, matchScore };
    })
    .filter((entry) => entry.name && entry.domain && !isNonCompanyProfileDomain(entry.domain))
    .sort((left, right) => {
      const combinedLeft = left.matchScore * 100 + left.confidenceScore;
      const combinedRight = right.matchScore * 100 + right.confidenceScore;
      return combinedRight - combinedLeft;
    });

  const top = candidates[0] ?? null;
  if (!top || top.matchScore < 0.85) return null;
  return top.domain;
}

function domainFromEmailOrUrl(email: string, source: string) {
  const normalizedEmail = extractFirstEmailAddress(email);
  if (normalizedEmail.includes("@")) {
    return canonicalCompanyDomain(normalizedEmail);
  }
  return canonicalCompanyDomain(source);
}

function normalizeCompanyName(value: string) {
  return normalizeCell(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function isLowSignalCompanyName(value: string) {
  const normalized = normalizeCompanyName(value);
  if (!normalized) return true;
  if (normalized.length <= 2) return true;
  if (LOW_SIGNAL_COMPANY_TOKENS.has(normalized)) return true;
  return normalized.split(" ").every((token) => LOW_SIGNAL_COMPANY_TOKENS.has(token));
}

export function deriveCompanyFromDomain(domain: string) {
  const normalized = normalizeDomainCandidate(domain);
  if (!normalized || isNonCompanyProfileDomain(normalized)) {
    return "";
  }

  const hostParts = normalized.split(".");
  const root = hostParts.length > 1 ? hostParts[hostParts.length - 2] : hostParts[0];
  const humanized = root.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!humanized) {
    return "";
  }

  return titleCaseWords(humanized);
}

function domainRootLabel(domain: string) {
  const normalized = rootDomain(domain);
  if (!normalized) return "";
  const parts = normalized.split(".").filter(Boolean);
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }
  const usesSecondLevelTld =
    parts[parts.length - 1]?.length === 2 &&
    ["ac", "co", "com", "edu", "gov", "net", "org"].includes(parts[parts.length - 2] ?? "");
  return parts[usesSecondLevelTld ? parts.length - 3 : parts.length - 2] ?? "";
}

function compactCompanyIdentity(value: string) {
  const tokens = normalizeCompanyName(value)
    .split(" ")
    .filter(Boolean);
  while (tokens.length > 1 && COMPANY_DESCRIPTOR_SUFFIX_TOKENS.has(tokens[tokens.length - 1] ?? "")) {
    tokens.pop();
  }
  return tokens.join("");
}

function compactContainsOrderedTokens(compactValue: string, tokens: string[]) {
  if (!compactValue || !tokens.length) return false;
  let cursor = 0;
  for (const token of tokens) {
    const index = compactValue.indexOf(token, cursor);
    if (index < 0) return false;
    cursor = index + token.length;
  }
  return true;
}

function companyIdentityMatchesDomain(company: string, domain: string) {
  const normalizedCompany = normalizeCompanyName(company);
  const companyKey = normalizeCompanyKey(company) || normalizedCompany;
  const derivedCompany = normalizeCompanyName(deriveCompanyFromDomain(domain));
  const normalizedDomainLabel = normalizeCompanyName(domainRootLabel(domain));
  if (!normalizedCompany || (!derivedCompany && !normalizedDomainLabel)) return true;

  const compactCompany = compactCompanyIdentity(company);
  const compactDomain = compactCompanyIdentity(normalizedDomainLabel);
  if (compactCompany && compactDomain && compactCompany === compactDomain) {
    return true;
  }

  const companyKeyTokens = companyKey.split(" ").filter(Boolean);
  if (
    compactCompany &&
    compactDomain &&
    companyKeyTokens.length > 1 &&
    compactContainsOrderedTokens(compactDomain, companyKeyTokens)
  ) {
    return true;
  }

  if (
    derivedCompany &&
    (normalizedCompany === derivedCompany ||
      normalizedCompany.includes(derivedCompany) ||
      derivedCompany.includes(normalizedCompany))
  ) {
    return true;
  }

  const companyTokens = new Set(companyKeyTokens);
  const domainTokens = new Set((normalizeCompanyKey(derivedCompany) || derivedCompany).split(" ").filter(Boolean));
  let overlap = 0;
  for (const token of companyTokens) {
    if (domainTokens.has(token)) overlap += 1;
  }

  return overlap > 0 && overlap / Math.min(companyTokens.size, domainTokens.size) >= 0.5;
}

function resolveLeadCompanyAndDomain(input: {
  lead: ApifyLead;
  sourceKind?: ProspectEvidenceSourceKind;
  sourceDomain?: string;
}): CompanyDomainResolution {
  const emailDomain = canonicalCompanyDomain(extractFirstEmailAddress(input.lead.email));
  const explicitDomain = canonicalCompanyDomain(input.lead.domain);
  const sourceDomain = canonicalCompanyDomain(input.sourceDomain ?? input.lead.sourceUrl);
  const companyStringDomain = canonicalCompanyDomain(inferDomainFromCompanyString(input.lead.company ?? ""));

  let domain = "";
  let domainResolutionSource: ProspectDomainResolutionSource = "unresolved";

  if (emailDomain && !isNonCompanyProfileDomain(emailDomain)) {
    domain = emailDomain;
    domainResolutionSource = "email_domain";
  } else if (explicitDomain && !isNonCompanyProfileDomain(explicitDomain)) {
    domain = explicitDomain;
    domainResolutionSource = "provided_domain";
  } else if (companyStringDomain && !isNonCompanyProfileDomain(companyStringDomain)) {
    domain = companyStringDomain;
    domainResolutionSource = "provided_domain";
  } else if (
    sourceDomain &&
    input.sourceKind === "company_site" &&
    !isNonCompanyProfileDomain(sourceDomain) &&
    companyIdentityMatchesDomain(String(input.lead.company ?? ""), sourceDomain)
  ) {
    domain = sourceDomain;
    domainResolutionSource = "company_site_source";
  }

  let company = normalizeCell(input.lead.company);
  if (!company && domain) {
    company = deriveCompanyFromDomain(domain);
  }

  return {
    company,
    domain,
    source: domainResolutionSource,
  };
}

function formatLeadQualityReason(reason: string, lead: ApifyLead) {
  switch (reason) {
    case "free_domain_blocked":
      return `skipped ${leadLabel(lead)} because the resolved email uses a free-mail inbox.`;
    case "role_inbox_blocked":
    case "role_inbox_low_evidence":
      return `skipped ${leadLabel(lead)} because the resolved email looks like a generic team inbox, not a person.`;
    case "non_person_name":
      return `skipped ${leadLabel(lead)} because the person identity does not look reliable enough.`;
    case "missing_name":
      return `skipped ${leadLabel(lead)} because the person name could not be verified.`;
    case "missing_company":
      return `skipped ${leadLabel(lead)} because the company could not be verified.`;
    case "missing_title_for_icp":
    case "missing_title":
      return `skipped ${leadLabel(lead)} because the role evidence is too weak.`;
    case "source_domain_mismatch":
      return `skipped ${leadLabel(lead)} because the supporting evidence does not line up with the work email domain.`;
    case "email_domain_company_mismatch":
      return `skipped ${leadLabel(lead)} because the work email domain does not match the resolved company domain.`;
    case "subdomain_mail_domain_unverified":
      return `skipped ${leadLabel(lead)} because the work email uses an unverified subdomain instead of the company's canonical domain.`;
    case "email_not_likely_valid":
      return `skipped ${leadLabel(lead)} because the email was not verified as a real mailbox.`;
    case "catch_all_email_blocked":
      return `skipped ${leadLabel(lead)} because the domain behaves like catch-all, so the mailbox may not actually exist.`;
    case "insufficient_person_evidence":
      return `skipped ${leadLabel(lead)} because there is not enough evidence that this is a real person at the company.`;
    case "excluded_company_keyword":
      return `skipped ${leadLabel(lead)} because the company context matched an excluded pattern.`;
    case "below_confidence_threshold":
      return `skipped ${leadLabel(lead)} because the combined person/company/email confidence is too low.`;
    case "invalid_email":
      return `skipped ${leadLabel(lead)} because no usable work email was found.`;
    default:
      return `skipped ${leadLabel(lead)} because the contact could not be verified.`;
  }
}

export async function resolveSelectionLeadDomains(
  candidates: SelectionLeadCandidate[],
  options: { clearoutMaxCompanies?: number; clearoutTimeoutMs?: number } = {}
) {
  const resolved: SelectionLeadCandidate[] = candidates.map((candidate) => {
    const initial = resolveLeadCompanyAndDomain({
      lead: candidate.lead,
      sourceKind: candidate.sourceKind,
      sourceDomain: candidate.sourceDomain,
    });
    return {
      ...candidate,
      lead: {
        ...candidate.lead,
        company: initial.company || candidate.lead.company,
        domain: initial.domain || candidate.lead.domain,
      },
      sourceDomain: candidate.sourceDomain || normalizeDomainCandidate(candidate.lead.sourceUrl),
      domainResolutionSource: initial.source,
    };
  });

  const unresolvedCompanies = Array.from(
    new Set(
      resolved
        .filter((candidate) => !normalizeDomainCandidate(candidate.lead.domain) && normalizeCell(candidate.lead.company))
        .map((candidate) => normalizeCell(candidate.lead.company))
        .filter(Boolean)
    )
  );
  if (!unresolvedCompanies.length) {
    return resolved;
  }

  const historicalMatches = await loadHistoricalCompanyDomains(unresolvedCompanies);
  const historicalDomainByCompany = new Map(
    historicalMatches
      .map((entry) => [normalizeCompanyKey(entry.company), rootDomain(entry.domain)] as const)
      .filter((entry) => Boolean(entry[0]) && Boolean(entry[1]))
  );

  for (const candidate of resolved) {
    if (normalizeDomainCandidate(candidate.lead.domain)) continue;
    const companyKey = normalizeCompanyKey(candidate.lead.company);
    const historicalDomain = historicalDomainByCompany.get(companyKey) ?? "";
    if (!historicalDomain || isNonCompanyProfileDomain(historicalDomain)) continue;
    candidate.lead = {
      ...candidate.lead,
      domain: historicalDomain,
      company: normalizeCell(candidate.lead.company) || deriveCompanyFromDomain(historicalDomain),
    };
    candidate.domainResolutionSource = "historical";
  }

  const stillUnresolved = Array.from(
    new Set(
      resolved
        .filter((candidate) => !normalizeDomainCandidate(candidate.lead.domain) && normalizeCell(candidate.lead.company))
        .map((candidate) => normalizeCell(candidate.lead.company))
        .filter(Boolean)
    )
  );

  const clearoutMaxCompanies = Math.max(
    0,
    Math.trunc(Number(options.clearoutMaxCompanies ?? stillUnresolved.length) || 0)
  );
  const clearoutTimeoutMs = Math.max(
    250,
    Math.min(10_000, Math.trunc(Number(options.clearoutTimeoutMs ?? 2_000) || 2_000))
  );

  for (const company of stillUnresolved.slice(0, clearoutMaxCompanies)) {
    try {
      const resolvedDomain = await resolveCompanyDomainWithClearout(company, {
        timeoutMs: clearoutTimeoutMs,
      });
      if (!resolvedDomain || isNonCompanyProfileDomain(resolvedDomain)) continue;
      for (const candidate of resolved) {
        if (normalizeDomainCandidate(candidate.lead.domain)) continue;
        if (normalizeCompanyKey(candidate.lead.company) !== normalizeCompanyKey(company)) continue;
        candidate.lead = {
          ...candidate.lead,
          domain: resolvedDomain,
          company: normalizeCell(candidate.lead.company) || deriveCompanyFromDomain(resolvedDomain),
        };
        candidate.domainResolutionSource = "clearout";
      }
    } catch {
      continue;
    }
  }

  return resolved;
}

export function filterSelectionCandidatesAgainstExistingLeads(input: {
  candidates: SelectionLeadCandidate[];
  existingLeads: Array<
    Pick<
      OutreachRunLead,
      "email" | "name" | "company" | "title" | "domain" | "sourceUrl" | "realVerifiedEmail" | "emailVerification"
    >
  >;
  oneContactPerCompany?: boolean;
  qualityPolicy?: LeadQualityPolicy;
}) {
  const existingEmails = new Set(
    input.existingLeads
      .map((lead) => extractFirstEmailAddress(lead.email).toLowerCase())
      .filter(Boolean)
  );
  const existingCompanyKeys = new Set(
    input.oneContactPerCompany !== false
      ? input.existingLeads
          .filter((lead) => isRunLeadSendable(lead, { qualityPolicy: input.qualityPolicy }))
          .map((lead) => companyKeyFromLead(lead))
          .filter(Boolean)
      : []
  );

  const filteredCandidates: SelectionLeadCandidate[] = [];
  let dedupedCount = 0;

  for (const candidate of input.candidates) {
    const normalizedEmail = extractFirstEmailAddress(candidate.lead.email).toLowerCase();
    if (normalizedEmail && existingEmails.has(normalizedEmail)) {
      dedupedCount += 1;
      continue;
    }

    const companyKey = input.oneContactPerCompany !== false ? companyKeyFromLead(candidate.lead) : "";
    if (companyKey && existingCompanyKeys.has(companyKey)) {
      dedupedCount += 1;
      continue;
    }

    filteredCandidates.push(candidate);
  }

  return {
    filteredCandidates,
    dedupedCount,
    existingEmails,
    existingCompanyKeys,
  };
}

export function companyKeyFromLead(input: {
  domain?: string;
  company?: string;
  email?: string;
  sourceUrl?: string;
}) {
  const domain = canonicalCompanyDomain(
    input.domain || domainFromEmailOrUrl(input.email ?? "", input.sourceUrl ?? "")
  );
  if (domain && !isNonCompanyProfileDomain(domain)) {
    return `domain:${domain}`;
  }

  const company = normalizeCompanyName(String(input.company ?? ""));
  if (company) {
    return `company:${company}`;
  }

  return "";
}

function summarizeReasons(assessments: ProspectLeadAssessment[]) {
  const counts = new Map<string, number>();
  for (const assessment of assessments) {
    if (assessment.accepted) continue;
    const key = assessment.reason || "rejected";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => ({ reason, count }));
}

function leadLabel(lead: Pick<ApifyLead, "name" | "company" | "domain" | "email">) {
  return normalizeCell(lead.name) || normalizeCell(lead.company) || normalizeDomainCandidate(lead.domain || lead.email) || "this row";
}

function rejectProspectLead(input: {
  rowNumber: number;
  lead: ApifyLead;
  stage: ProspectLeadStage;
  reason: string;
  message: string;
}): ProspectLeadAssessment {
  return {
    rowNumber: input.rowNumber,
    stage: "rejected",
    accepted: false,
    sendable: false,
    reason: input.reason,
    message: `Row ${input.rowNumber}: ${input.message}`,
    normalizedLead: input.lead,
  };
}

function acceptProspectLead(input: {
  rowNumber: number;
  stage: ProspectLeadStage;
  lead: ApifyLead;
  importedLead?: ImportedLead;
  reason?: string;
  message?: string;
  sendable?: boolean;
}): ProspectLeadAssessment {
  return {
    rowNumber: input.rowNumber,
    stage: input.stage,
    accepted: true,
    sendable: input.sendable ?? input.stage === "sendable",
    reason: input.reason ?? "",
    message: input.message ?? "",
    normalizedLead: input.lead,
    importedLead: input.importedLead,
  };
}

function buildImportedLead(input: ApifyLead): ImportedLead {
  return {
    email: extractFirstEmailAddress(input.email),
    name: normalizeCell(input.name),
    company: normalizeCell(input.company),
    title: normalizeCell(input.title),
    domain: normalizeDomainCandidate(input.domain),
    sourceUrl: normalizeCell(input.sourceUrl),
    realVerifiedEmail: input.realVerifiedEmail,
    emailVerification: input.emailVerification ?? null,
  };
}

function isVerificationPendingImportReason(reason: string) {
  return reason === "email_not_likely_valid" || reason === "catch_all_email_blocked";
}

function finalizeVerifiedProspectLead(input: {
  rowNumber: number;
  lead: ApifyLead;
  qualityPolicy?: LeadQualityPolicy;
}): ProspectLeadAssessment {
  const normalizedLead: ApifyLead = {
    email: extractFirstEmailAddress(input.lead.email),
    name: normalizeCell(input.lead.name),
    company: normalizeCell(input.lead.company),
    title: normalizeCell(input.lead.title),
    domain: normalizeDomainCandidate(input.lead.domain),
    sourceUrl: normalizeCell(input.lead.sourceUrl),
    realVerifiedEmail: input.lead.realVerifiedEmail,
    emailVerification: input.lead.emailVerification ?? null,
  };

  if (!normalizedLead.email) {
    return rejectProspectLead({
      rowNumber: input.rowNumber,
      lead: normalizedLead,
      stage: "verified_contact",
      reason: "missing_work_email",
      message: `no usable work email was found for ${leadLabel(normalizedLead)}.`,
    });
  }

  const suppressionReason = getLeadEmailSuppressionReason(normalizedLead.email);
  const shouldAllowRoleSuppression =
    suppressionReason === "role_account" && input.qualityPolicy?.allowRoleInboxes === true;
  if (suppressionReason && !shouldAllowRoleSuppression) {
    return rejectProspectLead({
      rowNumber: input.rowNumber,
      lead: normalizedLead,
      stage: "verified_contact",
      reason: suppressionReason,
      message: formatLeadQualityReason(suppressionReason, normalizedLead),
    });
  }

  const policyDecision = evaluateLeadAgainstQualityPolicy({
    lead: normalizedLead,
    policy: input.qualityPolicy ?? IMPORT_LEAD_QUALITY_POLICY,
  });
  if (!policyDecision.accepted) {
    if (isVerificationPendingImportReason(policyDecision.reason)) {
      return acceptProspectLead({
        rowNumber: input.rowNumber,
        stage: "verified_contact",
        lead: normalizedLead,
        sendable: false,
        reason: policyDecision.reason,
        importedLead: buildImportedLead(normalizedLead),
      });
    }
    return rejectProspectLead({
      rowNumber: input.rowNumber,
      lead: normalizedLead,
      stage: "verified_contact",
      reason: policyDecision.reason,
      message: formatLeadQualityReason(policyDecision.reason, normalizedLead),
    });
  }

  return acceptProspectLead({
    rowNumber: input.rowNumber,
    stage: "sendable",
    lead: normalizedLead,
    sendable: true,
    importedLead: buildImportedLead(normalizedLead),
  });
}

function assessProspectLead(input: {
  rowNumber: number;
  lead: ApifyLead;
  requireEmail: boolean;
  sourceKind?: ProspectEvidenceSourceKind;
  sourceDomain?: string;
  qualityPolicy?: LeadQualityPolicy;
}): ProspectLeadAssessment {
  const sourceUrl = normalizeCell(input.lead.sourceUrl);
  const sourceMeta = classifyEvidenceSource(sourceUrl);
  const sourceKind = input.sourceKind ?? sourceMeta.kind;
  const sourceDomain = normalizeDomainCandidate(input.sourceDomain ?? sourceMeta.sourceDomain);
  const startingLead: ApifyLead = {
    email: extractFirstEmailAddress(input.lead.email),
    name: normalizeCell(input.lead.name),
    company: normalizeCell(input.lead.company),
    title: normalizeCell(input.lead.title),
    domain: normalizeDomainCandidate(input.lead.domain),
    sourceUrl,
    realVerifiedEmail: input.lead.realVerifiedEmail,
    emailVerification: input.lead.emailVerification ?? null,
  };
  const resolvedIdentity = resolveLeadCompanyAndDomain({
    lead: startingLead,
    sourceKind,
    sourceDomain,
  });
  const company =
    resolvedIdentity.company ||
    (sourceKind === "company_site" && sourceDomain ? deriveCompanyFromDomain(sourceDomain) : "");
  const domain = resolvedIdentity.domain;
  const normalizedLead: ApifyLead = {
    ...startingLead,
    company,
    domain,
  };
  const allowFirstPartyWarmupIdentity =
    input.qualityPolicy?.allowRoleInboxes === true &&
    sourceKind === "company_site" &&
    Boolean(sourceDomain) &&
    normalizedLead.domain === sourceDomain;

  if (!normalizedLead.name && !normalizedLead.email) {
    return rejectProspectLead({
      rowNumber: input.rowNumber,
      lead: normalizedLead,
      stage: "discovered",
      reason: "missing_person_identity",
      message: `skipped ${leadLabel(normalizedLead)} because neither a person name nor a work email is present.`,
    });
  }

  if (!normalizedLead.company && !normalizedLead.domain && !sourceDomain) {
    return rejectProspectLead({
      rowNumber: input.rowNumber,
      lead: normalizedLead,
      stage: "discovered",
      reason: "missing_company_identity",
      message: `skipped ${leadLabel(normalizedLead)} because the company could not be identified from the evidence row.`,
    });
  }

  if (
    isLowSignalCompanyName(normalizedLead.company) &&
    !normalizedLead.domain &&
    !allowFirstPartyWarmupIdentity
  ) {
    return rejectProspectLead({
      rowNumber: input.rowNumber,
      lead: normalizedLead,
      stage: "discovered",
      reason: "weak_company_identity",
      message: `skipped ${leadLabel(normalizedLead)} because the company identity is too weak to verify automatically.`,
    });
  }

  if (!input.requireEmail) {
    return acceptProspectLead({
      rowNumber: input.rowNumber,
      stage: "verified_source",
      lead: normalizedLead,
    });
  }

  if (!normalizedLead.domain || isNonCompanyProfileDomain(normalizedLead.domain)) {
    return rejectProspectLead({
      rowNumber: input.rowNumber,
      lead: normalizedLead,
      stage: "verified_contact",
      reason: "missing_company_domain",
      message: `skipped ${leadLabel(normalizedLead)} because no company domain could be resolved from the evidence.`,
    });
  }

  if (isLowSignalCompanyName(normalizedLead.company) && !allowFirstPartyWarmupIdentity) {
    return rejectProspectLead({
      rowNumber: input.rowNumber,
      lead: normalizedLead,
      stage: "verified_contact",
      reason: "weak_company_identity",
      message: `skipped ${leadLabel(normalizedLead)} because the company identity is too weak to verify automatically.`,
    });
  }

  if (
    !allowFirstPartyWarmupIdentity &&
    !companyIdentityMatchesDomain(normalizedLead.company, normalizedLead.domain)
  ) {
    return rejectProspectLead({
      rowNumber: input.rowNumber,
      lead: normalizedLead,
      stage: "verified_contact",
      reason: "company_domain_identity_mismatch",
      message:
        `skipped ${leadLabel(normalizedLead)} because the company name does not match the resolved company domain.`,
    });
  }

  return finalizeVerifiedProspectLead({
    rowNumber: input.rowNumber,
    lead: normalizedLead,
    qualityPolicy: input.qualityPolicy,
  });
}

async function assessProspectLeadWithLlmFallback(input: {
  rowNumber: number;
  lead: ApifyLead;
  requireEmail: boolean;
  sourceKind?: ProspectEvidenceSourceKind;
  sourceDomain?: string;
  qualityPolicy?: LeadQualityPolicy;
}) {
  const assessment = assessProspectLead(input);
  if (
    assessment.accepted ||
    !input.requireEmail ||
    assessment.reason !== "company_domain_identity_mismatch"
  ) {
    return assessment;
  }

  const decision = await decideCompanyDomainIdentityWithLlm({
    lead: assessment.normalizedLead,
  });
  if (
    !decision.sameCompany ||
    decision.confidenceScore < COMPANY_DOMAIN_IDENTITY_LLM_CONFIDENCE_THRESHOLD
  ) {
    return assessment;
  }

  return finalizeVerifiedProspectLead({
    rowNumber: input.rowNumber,
    lead: assessment.normalizedLead,
    qualityPolicy: input.qualityPolicy,
  });
}
function buildQualityPipeline(input: {
  discoveredCount: number;
  evidenceAcceptedCount: number;
  verifiedContactCount: number;
  sendableCount: number;
  rejectedCount: number;
}): ProspectLeadQualityPipeline {
  return {
    discovered: input.discoveredCount,
    verified_source: input.evidenceAcceptedCount,
    verified_contact: input.verifiedContactCount,
    sendable: input.sendableCount,
    rejected: input.rejectedCount,
  };
}

function extractFirstUrlish(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const parts = raw
    .split(/[\n,|]/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const urlMatch = part.match(/https?:\/\/[^\s,\]|]+/i);
    if (urlMatch?.[0]) return urlMatch[0];
  }

  const urlMatch = raw.match(/https?:\/\/[^\s,\]|]+/i);
  if (urlMatch?.[0]) return urlMatch[0];

  return parts[0] ?? "";
}

function normalizeRowValues(row: Record<string, unknown>) {
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(row)) {
    values.set(normalizeHeaderKey(key), normalizeCell(value));
  }
  return values;
}

function firstValue(values: Map<string, string>, candidates: string[]) {
  for (const candidate of candidates) {
    const value = values.get(candidate);
    if (value) return value;
  }
  return "";
}

function resolveName(values: Map<string, string>) {
  const direct = firstValue(values, [
    "personname",
    "fullname",
    "name",
    "contactname",
  ]);
  if (direct) return direct;

  const firstName = firstValue(values, ["firstname", "fname", "givenname"]);
  const lastName = firstValue(values, ["lastname", "lname", "familyname"]);
  return `${firstName} ${lastName}`.trim();
}

function resolveSourceUrl(values: Map<string, string>) {
  return extractFirstUrlish(
    firstValue(values, [
      "sourceurl",
      "sourceurls",
      "linkedinurl",
      "profileurl",
      "websiteurl",
      "url",
    ])
  );
}

function resolveDomain(values: Map<string, string>, email: string, sourceUrl: string) {
  const directDomain = domainFromEmailOrUrl(
    "",
    extractFirstUrlish(
      firstValue(values, [
        "domain",
        "companydomain",
        "website",
        "companywebsite",
        "companyurl",
        "websiteurl",
      ])
    )
  );
  const websiteDomain = domainFromEmailOrUrl(
    "",
    extractFirstUrlish(firstValue(values, ["companywebsite", "companyurl", "website"]))
  );
  const sourceDomain = isLikelyCompanyOwnedUrl(sourceUrl) ? domainFromEmailOrUrl("", sourceUrl) : "";
  const emailDomain = domainFromEmailOrUrl(email, "");

  for (const candidate of [directDomain, websiteDomain, sourceDomain, emailDomain]) {
    const normalized = canonicalCompanyDomain(candidate);
    if (!normalized) {
      continue;
    }
    return normalized;
  }

  return "";
}

function resolveEmail(values: Map<string, string>) {
  const rawEmail = firstValue(values, [
    "email",
    "workemail",
    "businessemail",
    "publicworkemail",
    "professionalemail",
    "emailaddress",
  ]);
  const directEmail = extractFirstEmailAddress(rawEmail);
  if (directEmail) return directEmail;

  return extractFirstEmailAddress(
    firstValue(values, [
      "publicemail",
      "contactemail",
      "whymatched",
      "why",
      "evidence",
      "notes",
      "description",
      "summary",
    ]) || Array.from(values.values()).join(" ")
  );
}

function parseSelectionLeads(rawRows: unknown[]): {
  candidates: SelectionLeadCandidate[];
  errors: string[];
} {
  const candidates: SelectionLeadCandidate[] = [];
  const errors: string[] = [];

  rawRows.forEach((value, index) => {
    const rowNumber = index + 1;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`Row ${rowNumber}: expected an object of prospect fields.`);
      return;
    }

    const values = normalizeRowValues(value as Record<string, unknown>);
    const rawEmail = firstValue(values, [
      "email",
      "workemail",
      "businessemail",
      "publicworkemail",
      "professionalemail",
      "emailaddress",
    ]);
    const email = resolveEmail(values);
    const name = resolveName(values);
    const company = firstValue(values, [
      "companyname",
      "company",
      "organization",
      "organisation",
      "org",
      "employer",
    ]);
    const title = firstValue(values, [
      "jobtitle",
      "title",
      "role",
      "position",
      "headline",
    ]);
    const sourceUrl = resolveSourceUrl(values);
    const domain = resolveDomain(values, email, sourceUrl);
    const sourceMeta = classifyEvidenceSource(sourceUrl);

    if (rawEmail && !email && (!name || !domain)) {
      errors.push(`Row ${rowNumber}: invalid email "${rawEmail}".`);
      return;
    }

    if (!email && !name) {
      errors.push(`Row ${rowNumber}: missing person name or email.`);
      return;
    }

    if (!email && !domain && !sourceUrl && !company) {
      errors.push(`Row ${rowNumber}: missing usable company or evidence URL.`);
      return;
    }

    candidates.push({
      rowNumber,
      lead: {
        email,
        name,
        company,
        title,
        domain,
        sourceUrl,
      },
      sourceKind: sourceMeta.kind,
      sourceDomain: sourceMeta.sourceDomain,
      domainResolutionSource: domain ? "provided_domain" : "unresolved",
    });
  });

  return { candidates, errors };
}

export function prepareSelectionLeadsForEnrichment(rawRows: unknown[]) {
  const parsed = parseSelectionLeads(rawRows);
  const candidates: SelectionLeadCandidate[] = [];
  const rejectedAssessments: ProspectLeadAssessment[] = [];
  const errors = [...parsed.errors];

  for (const candidate of parsed.candidates) {
    const assessment = assessProspectLead({
      rowNumber: candidate.rowNumber,
      lead: candidate.lead,
      requireEmail: false,
    });
    if (assessment.accepted) {
      candidates.push({
        rowNumber: candidate.rowNumber,
        lead: assessment.normalizedLead,
        sourceKind: candidate.sourceKind,
        sourceDomain: candidate.sourceDomain,
        domainResolutionSource: candidate.domainResolutionSource,
      });
      continue;
    }

    rejectedAssessments.push(assessment);
    errors.push(assessment.message);
  }

  return {
    candidates,
    errors,
    discoveredCount: rawRows.length,
    rejectedAssessments,
  };
}

export async function finalizeImportedSelectionLeads(input: {
  candidates: SelectionLeadCandidate[];
  enrichmentLeads: ApifyLead[];
  initialErrors?: string[];
  rejectedAssessments?: ProspectLeadAssessment[];
  discoveredCount?: number;
  qualityPolicy?: LeadQualityPolicy;
}) {
  const assessments = [...(input.rejectedAssessments ?? [])];
  const parseErrors = [...(input.initialErrors ?? [])];
  const storedLeads: ImportedLead[] = [];
  const sendableLeads: ImportedLead[] = [];
  let verifiedContactCount = 0;

  for (const [index, candidate] of input.candidates.entries()) {
    const enrichedLead = input.enrichmentLeads[index] ?? candidate.lead;
    const assessment = await assessProspectLeadWithLlmFallback({
      rowNumber: candidate.rowNumber,
      lead: enrichedLead,
      requireEmail: true,
      sourceKind: candidate.sourceKind,
      sourceDomain: candidate.sourceDomain,
      qualityPolicy: input.qualityPolicy,
    });
    assessments.push(assessment);

    if (assessment.accepted && assessment.importedLead) {
      storedLeads.push(assessment.importedLead);
      verifiedContactCount += 1;
      if (assessment.sendable) {
        sendableLeads.push(assessment.importedLead);
      }
      continue;
    }

    parseErrors.push(assessment.message);
  }

  return {
    storedLeads,
    sendableLeads,
    parseErrors,
    rejectedAssessments: assessments.filter((assessment) => !assessment.accepted),
    qualityPipeline: buildQualityPipeline({
      discoveredCount: Math.max(input.discoveredCount ?? input.candidates.length, input.candidates.length),
      evidenceAcceptedCount: input.candidates.length,
      verifiedContactCount,
      sendableCount: sendableLeads.length,
      rejectedCount: assessments.filter((assessment) => !assessment.accepted).length,
    }),
    qualityRejectionSummary: summarizeReasons(assessments),
  };
}
export function isRunLeadSendable(
  lead: Pick<
    OutreachRunLead,
    "email" | "name" | "company" | "title" | "domain" | "sourceUrl" | "realVerifiedEmail" | "emailVerification"
  >,
  options: {
    qualityPolicy?: LeadQualityPolicy;
  } = {}
) {
  const assessment = assessProspectLead({
    rowNumber: 0,
    lead: {
      email: lead.email,
      name: lead.name,
      company: lead.company,
      title: lead.title,
      domain: lead.domain,
      sourceUrl: lead.sourceUrl,
      realVerifiedEmail: lead.realVerifiedEmail,
      emailVerification: lead.emailVerification ?? null,
    },
    requireEmail: true,
    qualityPolicy: options.qualityPolicy,
  });
  return assessment.accepted && assessment.sendable;
}

export function isImportedLeadSendable(
  lead: Pick<
    ImportedLead,
    "email" | "name" | "company" | "title" | "domain" | "sourceUrl" | "realVerifiedEmail" | "emailVerification"
  >,
  options: {
    qualityPolicy?: LeadQualityPolicy;
  } = {}
) {
  return isRunLeadSendable(
    {
      email: lead.email,
      name: lead.name,
      company: lead.company,
      title: lead.title,
      domain: lead.domain,
      sourceUrl: lead.sourceUrl,
      realVerifiedEmail: lead.realVerifiedEmail,
      emailVerification: lead.emailVerification ?? null,
    },
    options
  );
}

function emailFinderApiBaseUrl(origin: string) {
  return `${origin.replace(/\/+$/, "")}/api/internal/email-finder`;
}

function selectExperimentImportCandidateWindow<T>(
  items: T[],
  input: { attempt?: number; maxItems?: number } = {}
) {
  const total = Array.isArray(items) ? items.length : 0;
  const maxItems = Math.max(0, Math.trunc(Number(input.maxItems ?? 0) || 0));
  if (!maxItems || total <= maxItems) {
    return {
      items: [...items],
      offset: 0,
      total,
      truncated: false,
    };
  }

  const attempt = Math.max(1, Math.trunc(Number(input.attempt ?? 1) || 1));
  const offset = ((attempt - 1) * maxItems) % total;
  const slice = items.slice(offset, offset + maxItems);
  const remaining = maxItems - slice.length;
  return {
    items: remaining > 0 ? [...slice, ...items.slice(0, remaining)] : slice,
    offset,
    total,
    truncated: true,
  };
}

export async function importExperimentProspectRows(input: {
  brandId: string;
  experimentId: string;
  rows: unknown[];
  requestOrigin?: string;
  emailFinderApiBaseUrl?: string;
  tableTitle?: string;
  prompt?: string;
  entityType?: string;
  emailFinderTimeoutMs?: number;
  emailFinderMaxCredits?: number;
  emailFinderRetryOnFailure?: boolean;
  maxCandidatesPerBatch?: number;
  prepAttempt?: number;
}) : Promise<ImportExperimentProspectRowsResult> {
  const existing = await getExperimentRecordById(input.brandId, input.experimentId);
  if (!existing) {
    throw new Error("experiment not found");
  }

  const experiment = await ensureRuntimeForExperiment(existing);
  if (!experiment.runtime.campaignId || !experiment.runtime.experimentId || !experiment.runtime.hypothesisId) {
    throw new Error("experiment runtime is not configured");
  }

  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) {
    throw new Error("rows are required");
  }

  const prepared = prepareSelectionLeadsForEnrichment(rows);
  if (!prepared.candidates.length) {
    const finalized = await finalizeImportedSelectionLeads({
      candidates: [],
      enrichmentLeads: [],
      initialErrors: prepared.errors,
      rejectedAssessments: prepared.rejectedAssessments,
      discoveredCount: prepared.discoveredCount,
    });
    return {
      runId: "",
      status: "completed",
      attemptedCount: rows.length,
      importedCount: 0,
      storedLeadCount: 0,
      storedForVerificationCount: 0,
      skippedCount: rows.length,
      matchedCount: 0,
      dedupedCount: 0,
      parseErrorCount: finalized.parseErrors.length,
      parseErrors: finalized.parseErrors.slice(0, 20),
      enrichmentError: "",
      failureSummary: [],
      autoLaunchAttempted: false,
      autoLaunchTriggered: false,
      autoLaunchBlocked: false,
      autoLaunchRunId: "",
      autoLaunchReason: "",
      qualityPipeline: finalized.qualityPipeline,
      qualityRejectionSummary: finalized.qualityRejectionSummary,
    };
  }

  const resolvedCandidates = await resolveSelectionLeadDomains(prepared.candidates);
  const existingRuns = await listOwnerRuns(input.brandId, "experiment", experiment.id);
  const existingLeadLists = await Promise.all(existingRuns.map((run) => listRunLeads(run.id)));
  const existingLeads = existingLeadLists.flat();
  const oneContactPerCompany = experiment.testEnvelope.oneContactPerCompany !== false;
  const prefiltered = filterSelectionCandidatesAgainstExistingLeads({
    candidates: resolvedCandidates,
    existingLeads,
    oneContactPerCompany,
    qualityPolicy: IMPORT_LEAD_QUALITY_POLICY,
  });
  const candidatesForEnrichment = selectExperimentImportCandidateWindow(
    prefiltered.filteredCandidates,
    {
      attempt: input.prepAttempt,
      maxItems: input.maxCandidatesPerBatch,
    }
  ).items;

  const verificationMode = resolveImportVerificationMode();
  const apiBaseUrl =
    resolveEmailFinderApiBaseUrl(input.emailFinderApiBaseUrl) ||
    (input.requestOrigin ? emailFinderApiBaseUrl(input.requestOrigin) : "");

  if (!candidatesForEnrichment.length) {
    const finalized = await finalizeImportedSelectionLeads({
      candidates: [],
      enrichmentLeads: [],
      initialErrors: prepared.errors,
      rejectedAssessments: prepared.rejectedAssessments,
      discoveredCount: prepared.discoveredCount,
    });
    return {
      runId: "",
      status: "completed",
      attemptedCount: prepared.discoveredCount,
      importedCount: 0,
      storedLeadCount: 0,
      storedForVerificationCount: 0,
      skippedCount: Math.max(0, prepared.discoveredCount),
      matchedCount: 0,
      dedupedCount: prefiltered.dedupedCount,
      parseErrorCount: finalized.parseErrors.length,
      parseErrors: finalized.parseErrors.slice(0, 20),
      enrichmentError: "",
      failureSummary: [],
      autoLaunchAttempted: false,
      autoLaunchTriggered: false,
      autoLaunchBlocked: false,
      autoLaunchRunId: "",
      autoLaunchReason: "",
      qualityPipeline: finalized.qualityPipeline,
      qualityRejectionSummary: finalized.qualityRejectionSummary,
    };
  }

  const enrichment = await enrichLeadsWithEmailFinderBatch({
    leads: candidatesForEnrichment.map((entry) => entry.lead),
    apiBaseUrl,
    verificationMode,
    maxCandidates: 12,
    maxCredits: Math.max(1, Math.min(7, Number(input.emailFinderMaxCredits ?? 7) || 7)),
    maxTotalCredits: resolveEmailFinderImportMaxTotalCredits(),
    concurrency: 3,
    timeoutMs: input.emailFinderTimeoutMs,
    retryOnFailure: input.emailFinderRetryOnFailure,
    allowBestGuessFallback: true,
    minBestGuessPValid: 0.58,
    audit: {
      source: "experiment-prospect-import",
      context: {
        brandId: input.brandId,
        experimentId: input.experimentId,
        tableTitle: input.tableTitle,
        entityType: input.entityType,
        verificationMode,
      },
    },
  });

  const finalized = await finalizeImportedSelectionLeads({
    candidates: candidatesForEnrichment,
    enrichmentLeads: enrichment.leads,
    initialErrors: enrichment.error.trim()
      ? [...prepared.errors, enrichment.error.trim()]
      : prepared.errors,
    rejectedAssessments: prepared.rejectedAssessments,
    discoveredCount: prepared.discoveredCount,
  });
  const storedLeads = finalized.storedLeads;
  const parseErrors = finalized.parseErrors;

  if (!storedLeads.length) {
    return {
      runId: "",
      status: "completed",
      attemptedCount: prepared.discoveredCount,
      importedCount: 0,
      storedLeadCount: 0,
      storedForVerificationCount: 0,
      skippedCount: Math.max(0, prepared.discoveredCount),
      matchedCount: enrichment.matched,
      dedupedCount: prefiltered.dedupedCount,
      parseErrorCount: parseErrors.length,
      parseErrors: parseErrors.slice(0, 20),
      enrichmentError: enrichment.error,
      failureSummary: enrichment.failureSummary,
      autoLaunchAttempted: false,
      autoLaunchTriggered: false,
      autoLaunchBlocked: false,
      autoLaunchRunId: "",
      autoLaunchReason: "",
      qualityPipeline: finalized.qualityPipeline,
      qualityRejectionSummary: finalized.qualityRejectionSummary,
    };
  }

  const existingEmails = prefiltered.existingEmails;
  const existingCompanyKeys = prefiltered.existingCompanyKeys;
  const newLeads: ImportedLead[] = [];
  let dedupedCount = prefiltered.dedupedCount;

  for (const lead of storedLeads) {
    const normalizedEmail = lead.email.toLowerCase();
    if (existingEmails.has(normalizedEmail)) {
      dedupedCount += 1;
      continue;
    }

    const companyKey = oneContactPerCompany ? companyKeyFromLead(lead) : "";
    if (companyKey && existingCompanyKeys.has(companyKey)) {
      dedupedCount += 1;
      continue;
    }

    newLeads.push(lead);
    existingEmails.add(normalizedEmail);
    if (companyKey && isImportedLeadSendable(lead, { qualityPolicy: IMPORT_LEAD_QUALITY_POLICY })) {
      existingCompanyKeys.add(companyKey);
    }
  }

  await refreshStoredDuplicateSelectionLeads({
    existingLeads,
    incomingLeads: storedLeads,
    oneContactPerCompany,
  });

  if (!newLeads.length) {
    return {
      runId: "",
      status: "completed",
      attemptedCount: prepared.discoveredCount,
      importedCount: 0,
      storedLeadCount: 0,
      storedForVerificationCount: 0,
      skippedCount: Math.max(0, prepared.discoveredCount),
      matchedCount: enrichment.matched,
      dedupedCount,
      parseErrorCount: parseErrors.length,
      parseErrors: parseErrors.slice(0, 20),
      enrichmentError: enrichment.error,
      failureSummary: enrichment.failureSummary,
      autoLaunchAttempted: false,
      autoLaunchTriggered: false,
      autoLaunchBlocked: false,
      autoLaunchRunId: "",
      autoLaunchReason: "",
      qualityPipeline: finalized.qualityPipeline,
      qualityRejectionSummary: finalized.qualityRejectionSummary,
    };
  }

  const assignment = await getBrandOutreachAssignment(input.brandId);
  const newSendableLeadCount = newLeads.filter((lead) =>
    isImportedLeadSendable(lead, { qualityPolicy: IMPORT_LEAD_QUALITY_POLICY })
  ).length;
  const newStoredForVerificationCount = Math.max(0, newLeads.length - newSendableLeadCount);
  const run = await createOutreachRun({
    brandId: input.brandId,
    campaignId: experiment.runtime.campaignId,
    experimentId: experiment.runtime.experimentId,
    hypothesisId: experiment.runtime.hypothesisId,
    ownerType: "experiment",
    ownerId: experiment.id,
    accountId: assignment?.accountId || "enrichanything_embed",
    status: "completed",
  });

  await upsertRunLeads(
    run.id,
    input.brandId,
    experiment.runtime.campaignId,
    newLeads
  );

  await updateOutreachRun(run.id, {
    status: "completed",
    metrics: {
      sourcedLeads: newLeads.length,
      scheduledMessages: 0,
      sentMessages: 0,
      bouncedMessages: 0,
      failedMessages: 0,
      replies: 0,
      positiveReplies: 0,
      negativeReplies: 0,
    },
    sourcingTraceSummary: {
      phase: "completed",
      selectedActorIds: ["enrichanything_embed_selection"],
      lastActorInputError: "",
      failureStep: "",
      budgetUsedUsd: 0,
    },
    completedAt: new Date().toISOString(),
    lastError: "",
  });

  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_imported_selection",
    payload: {
      importedCount: newSendableLeadCount,
      storedLeadCount: newLeads.length,
      storedForVerificationCount: newStoredForVerificationCount,
      attemptedCount: prepared.discoveredCount,
      skippedCount: Math.max(0, prepared.discoveredCount - newLeads.length),
      matchedCount: enrichment.matched,
      dedupedCount,
      parseErrorCount: parseErrors.length,
      source: "enrichanything_embed",
      tableTitle: normalizeCell(input.tableTitle),
      prompt: normalizeCell(input.prompt),
      entityType: normalizeCell(input.entityType),
      evidenceAcceptedCount: resolvedCandidates.length,
      verifiedContactCount: finalized.qualityPipeline.verified_contact,
      evidenceSample: resolvedCandidates.slice(0, 5).map((candidate) => ({
        rowNumber: candidate.rowNumber,
        name: candidate.lead.name,
        company: candidate.lead.company,
        domain: candidate.lead.domain,
        sourceUrl: candidate.lead.sourceUrl,
        sourceKind: candidate.sourceKind,
        domainResolutionSource: candidate.domainResolutionSource,
      })),
      rejectedSample: finalized.rejectedAssessments.slice(0, 5).map((assessment) => ({
        rowNumber: assessment.rowNumber,
        reason: assessment.reason,
        message: assessment.message,
        name: assessment.normalizedLead.name,
        company: assessment.normalizedLead.company,
        domain: assessment.normalizedLead.domain,
        sourceUrl: assessment.normalizedLead.sourceUrl,
      })),
      qualityPipeline: finalized.qualityPipeline,
      qualityRejectionSummary: finalized.qualityRejectionSummary,
    },
  });

  await updateExperimentRecord(input.brandId, experiment.id, {
    status: newSendableLeadCount > 0 ? "ready" : experiment.status,
  });

  return {
    runId: run.id,
    status: "completed",
    attemptedCount: prepared.discoveredCount,
    importedCount: newSendableLeadCount,
    storedLeadCount: newLeads.length,
    storedForVerificationCount: newStoredForVerificationCount,
    skippedCount: Math.max(0, prepared.discoveredCount - newLeads.length),
    matchedCount: enrichment.matched,
    dedupedCount,
    parseErrorCount: parseErrors.length,
    parseErrors: parseErrors.slice(0, 20),
    enrichmentError: enrichment.error,
    failureSummary: enrichment.failureSummary,
    autoLaunchAttempted: false,
    autoLaunchTriggered: false,
    autoLaunchBlocked: false,
    autoLaunchRunId: "",
    autoLaunchReason: "",
    qualityPipeline: finalized.qualityPipeline,
    qualityRejectionSummary: finalized.qualityRejectionSummary,
  };
}

export async function countExperimentSendableLeadContacts(
  brandId: string,
  experimentId: string
): Promise<ExperimentSendableLeadSummary> {
  const experiment = await getExperimentRecordById(brandId, experimentId);
  if (!experiment) {
    throw new Error("experiment not found");
  }

  const runs = await listOwnerRuns(brandId, "experiment", experiment.id);
  if (!runs.length) {
    return {
      sendableLeadCount: 0,
      storedLeadCount: 0,
      storedForVerificationCount: 0,
      runsChecked: 0,
    };
  }

  const leadLists = await Promise.all(runs.map((run) => listRunLeads(run.id)));
  const storedEmails = new Set<string>();
  const sendableEmails = new Set<string>();

  for (const lead of leadLists.flat()) {
    if (!isReusableExperimentLeadStatus(lead.status)) continue;
    const email = extractFirstEmailAddress(lead.email).toLowerCase();
    if (!email) continue;
    storedEmails.add(email);
    if (!isRunLeadSendable(lead)) {
      continue;
    }
    sendableEmails.add(email);
  }

  return {
    sendableLeadCount: sendableEmails.size,
    storedLeadCount: storedEmails.size,
    storedForVerificationCount: Math.max(0, storedEmails.size - sendableEmails.size),
    runsChecked: runs.length,
  };
}
