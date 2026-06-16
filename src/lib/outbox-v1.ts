import { getBrandById, listBrands } from "@/lib/factory-data";
import {
  createExperimentRecord,
  createScaleCampaignRecordFromExperiment,
  listStoredScaleCampaignRecords,
  updateExperimentRecord,
} from "@/lib/experiment-data";
import type {
  EmailVerificationState,
  BrandRecord,
  OutreachAccount,
  OutreachMessage,
  OutreachRun,
  OutreachRunLead,
  ScaleCampaignRecord,
} from "@/lib/factory-types";
import {
  createOutreachEvent,
  createOutreachRun,
  createRunMessages,
  getBrandOutreachAssignment,
  getOutreachAccount,
  getOutreachAccountSecrets,
  type OutreachAccountSecrets,
  listBrandRuns,
  listOutreachAccounts,
  listReplyThreadsByBrand,
  listRunLeads,
  listRunMessages,
  updateOutreachRun,
  updateRunLead,
  updateRunMessage,
  upsertRunLeads,
} from "@/lib/outreach-data";
import {
  getOutreachAccountFromEmail,
  getOutreachAccountReplyToEmail,
  supportsAnyDelivery,
  supportsMailpoolDelivery,
} from "@/lib/outreach-account-helpers";
import { getCanonicalSenderPoolForBrand } from "@/lib/senders";
import { buildEmailFinderBatchResponse } from "@/lib/internal-email-finder";
import {
  parseManualBatchContacts,
  type ManualBatchAcceptedContact,
  type ManualBatchRejectedContact,
} from "@/lib/manual-batch-outreach";
import {
  extractFirstEmailAddress,
  getLeadEmailSuppressionReason,
  sendOutreachMessage,
} from "@/lib/outreach-providers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { generateJsonWithLlm } from "@/lib/llm-json";

export const OUTBOX_V1_EXTERNAL_REF_PREFIX = "outbox_v1:";
export const OUTBOX_V1_SOURCE_PREFIX = "outbox-v1:";

const DEFAULT_TIMEZONE = "America/Los_Angeles";
const DEFAULT_WARMING_DAILY_CAP = 25;
const DEFAULT_HEALTHY_DAILY_CAP = 100;
const DEFAULT_HOURLY_CAP = 25;
const MAX_OUTBOX_BATCH_CONTACTS = 1000;
const MAX_OUTBOX_AIRSCALE_TARGETS = 200;
const OUTBOX_RECENT_RECIPIENT_DEDUPE_DAYS = 90;
const DEFAULT_OUTBOX_AUTOPILOT_COOLDOWN_HOURS = 1;
const OUTBOX_AUTOPILOT_SOURCE_OVERFETCH_MULTIPLIER = 4;
const OUTBOX_AUTOPILOT_SOURCE_OVERFETCH_FLOOR = 6;
const OUTBOX_AUTOPILOT_SOURCE_OVERFETCH_CAP = 20;
const DEFAULT_OUTBOX_MESSAGE_EXPERIMENT_MODEL = "openai/gpt-5.5";

const EMPTY_OUTREACH_ACCOUNT_SECRETS: OutreachAccountSecrets = {
  customerIoApiKey: "",
  customerIoTrackApiKey: "",
  customerIoAppApiKey: "",
  apifyToken: "",
  youtubeClientId: "",
  youtubeClientSecret: "",
  youtubeRefreshToken: "",
  mailboxAccessToken: "",
  mailboxRefreshToken: "",
  mailboxPassword: "",
  mailboxAuthCode: "",
  mailboxSmtpPassword: "",
  mailboxAdminEmail: "",
  mailboxAdminPassword: "",
  mailboxAdminAuthCode: "",
  mailboxRecoveryEmail: "",
  mailboxRecoveryCodes: "",
};

type OutboxSourceMode = "contacts" | "airscale" | "auto";

type OutboxFinderTarget = {
  rowNumber: number;
  name: string;
  company: string;
  title: string;
  domain: string;
  sourceUrl: string;
};

type OutboxPreparedContact = ManualBatchAcceptedContact & {
  sourceMode: OutboxSourceMode;
  realVerifiedEmail: boolean;
  emailVerification: EmailVerificationState;
  finderMeta: Record<string, unknown> | null;
};

type OutboxFinderSummary = {
  provider: "airscale";
  requested: number;
  processed: number;
  found: number;
  rejected: number;
  creditsUsed: number;
  truncated: boolean;
};

type OutboxProspectSourcingSummary = {
  provider: "airscale";
  requested: number;
  sourced: number;
  rejected: number;
  diagnosticsCount: number;
  creditsUsed: number;
  budgetUsedUsd: number;
  exaSpendUsd: number;
  dataForSeoSpendUsd: number;
  sample: Array<{
    name: string;
    company: string;
    title: string;
    domain: string;
  }>;
};

type OutboxSourcedProspect = {
  name: string;
  company: string;
  title: string;
  domain: string;
  sourceUrl: string;
};

type OutboxProspectSourcingResult = {
  prospects: OutboxSourcedProspect[];
  rejectedCount: number;
  diagnostics: Array<Record<string, unknown>>;
  queryPlan: Record<string, unknown>;
  creditsUsed: number;
  budgetUsedUsd: number;
  exaSpendUsd: number;
  dataForSeoSpendUsd: number;
};

type OutboxMessageExperiment = {
  id: string;
  provider: "openrouter" | "openai";
  model: string;
  variantName: string;
  hypothesis: string;
  targetSegment: string;
  primaryAngle: string;
  proofPoint: string;
  subject: string;
  body: string;
  replyGoal: string;
  expectedReplySignal: string;
  risks: string[];
  qualityScore: number;
  generatedAt: string;
};

export type OutboxSenderOption = {
  accountId: string;
  name: string;
  fromEmail: string;
  replyToEmail: string;
  provider: OutreachAccount["provider"];
  status: OutreachAccount["status"];
  ready: boolean;
  reason: string;
  primary: boolean;
};

export type OutboxPolicyDecision = {
  senderState: "warming" | "healthy" | "constrained" | "paused";
  dailyCap: number;
  hourlyCap: number;
  sentToday: number;
  sentThisHour: number;
  failedOrBouncedLast7d: number;
  availableNow: number;
  sendNow: number;
  hold: number;
  reject: number;
  reasons: string[];
};

export type OutboxBatchSummary = {
  run: OutreachRun;
  campaign: ScaleCampaignRecord | null;
  sender: {
    accountId: string;
    name: string;
    fromEmail: string;
    replyToEmail: string;
  };
  counts: {
    leads: number;
    scheduled: number;
    sent: number;
    failed: number;
    canceled: number;
    bounced: number;
    replies: number;
    positiveReplies: number;
  };
  latestReplyAt: string;
  policy: OutboxPolicyDecision | null;
};

export type OutboxConsoleState = {
  batches: OutboxBatchSummary[];
  senders: OutboxSenderOption[];
  selectedPolicy: OutboxPolicyDecision | null;
  outboundSendingEnabled: boolean;
  maxBatchContacts: number;
};

export type OutboxLaunchInput = {
  brandId: string;
  senderAccountId?: string;
  batchName?: string;
  contactsText?: string;
  finderText?: string;
  sourceMode?: OutboxSourceMode;
  prospectQuery?: string;
  prospectOffer?: string;
  maxProspects?: number;
  subject: string;
  body: string;
  requestedSendNow?: number;
  timezone?: string;
};

export type OutboxLaunchResult = {
  batchId: string;
  run: OutreachRun;
  campaign: ScaleCampaignRecord;
  accepted: ManualBatchAcceptedContact[];
  rejected: ManualBatchRejectedContact[];
  policy: OutboxPolicyDecision;
  messages: OutreachMessage[];
  copyExperiment: OutboxMessageExperiment | null;
  finder: OutboxFinderSummary | null;
  prospectSourcing: OutboxProspectSourcingSummary | null;
  counts: {
    created: number;
    sourced: number;
    found: number;
    sent: number;
    failed: number;
    held: number;
    rejected: number;
  };
};

export type OutboxHeldSendResult = {
  brandId: string;
  senderAccountId: string;
  runsEvaluated: number;
  messagesEvaluated: number;
  sent: number;
  failed: number;
  held: number;
  skipped: boolean;
  reason: string;
};

export type OutboxAutopilotBrandResult = {
  brandId: string;
  brandName: string;
  action: "launch" | "release_held" | "skip" | "error";
  reason: string;
  senderAccountId: string;
  sent: number;
  held: number;
  failed: number;
  sourced: number;
  found: number;
  batchId: string;
  cooldownHours: number;
};

export type OutboxAutopilotTickResult = {
  enabled: boolean;
  brandsConfigured: number;
  brandsProcessed: number;
  launched: number;
  releasedHeld: number;
  sent: number;
  held: number;
  failed: number;
  results: OutboxAutopilotBrandResult[];
};

type OutboxAutopilotSenderChoice = {
  sender: OutboxSenderOption;
  account: OutreachAccount;
  policy: OutboxPolicyDecision;
};

function nowIso() {
  return new Date().toISOString();
}

function outboundSendingEnabled() {
  const raw = String(process.env.OUTBOUND_SENDING_ENABLED ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function cleanEnvValue(value: unknown) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
}

function airscaleApiKey() {
  return cleanEnvValue(process.env.AIRSCALE_API_KEY ?? process.env.EMAIL_FINDER_AIRSCALE_API_KEY);
}

function airscaleBaseUrl() {
  return (
    cleanEnvValue(process.env.AIRSCALE_API_BASE_URL ?? process.env.EMAIL_FINDER_AIRSCALE_BASE_URL) ||
    "https://api.airscale.io"
  ).replace(/\/+$/, "");
}

function compactText(value: unknown, max = 180) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}...` : normalized;
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function outboxAutopilotProspectRequestSize(input: { maxProspects: number; sendNow: number; availableNow: number }) {
  const capacity = Math.max(0, Math.min(input.sendNow, input.availableNow));
  if (capacity <= 0) return 0;
  const desired = Math.min(
    OUTBOX_AUTOPILOT_SOURCE_OVERFETCH_CAP,
    Math.max(
      capacity,
      capacity * OUTBOX_AUTOPILOT_SOURCE_OVERFETCH_MULTIPLIER,
      OUTBOX_AUTOPILOT_SOURCE_OVERFETCH_FLOOR
    )
  );
  return clampInt(desired, capacity, 1, Math.max(1, input.maxProspects));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function domainFromUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? normalizeDomain(host) : "";
  } catch {
    return normalizeDomain(raw);
  }
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const normalized = compactText(value, 500);
    if (normalized) return normalized;
  }
  return "";
}

function cleanLeadText(value: unknown, max = 180) {
  return compactText(String(value ?? "").replace(/[^\p{L}\p{M}\p{N}\s&.,'()/+-]/gu, " "), max);
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function splitEnvLines(value: unknown) {
  return compactText(value, 2_000)
    .split(/\r?\n|,/)
    .map((entry) => compactText(entry, 120))
    .filter(Boolean);
}

function airscaleConfiguredFilters() {
  const raw = cleanEnvValue(process.env.OUTBOX_AUTOPILOT_AIRSCALE_FILTERS_JSON);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function defaultAirscaleJobFilters(targetAudience: string) {
  const normalized = targetAudience.toLowerCase();
  const jobs: string[] = [];
  const add = (...values: string[]) => {
    for (const value of values) {
      if (!jobs.includes(value)) jobs.push(value);
    }
  };
  if (/\bgrowth\b/.test(normalized)) add("Head of Growth", "VP Growth", "Growth Lead");
  if (/\bdemand\s*gen|demand generation\b/.test(normalized)) {
    add("Head of Demand Generation", "Demand Generation Manager", "VP Demand Generation");
  }
  if (/\boutbound|sales development|sdr|bdr\b/.test(normalized)) {
    add("Head of Sales Development", "SDR Manager", "BDR Manager", "VP Sales");
  }
  if (/\blifecycle|customer onboarding|retention\b/.test(normalized)) {
    add("Lifecycle Marketing Manager", "Head of Lifecycle Marketing", "Customer Marketing Lead");
  }
  if (/\bfounder|founders\b/.test(normalized)) add("Founder", "Co-Founder", "CEO");
  if (!jobs.length) add("Founder", "CEO", "Head of Growth", "VP Sales");
  return jobs.slice(0, 12);
}

function buildAirscaleLeadFilters(input: {
  targetAudience: string;
  offer: string;
}) {
  const configured = airscaleConfiguredFilters();
  if (configured && Object.keys(configured).length > 0) {
    return {
      ...configured,
      searchMode: String(configured.searchMode ?? "SMART").trim() || "SMART",
    };
  }

  const audience = compactText(input.targetAudience, 1_500);
  const offer = compactText(input.offer, 1_000);
  const normalized = `${audience} ${offer}`.toLowerCase();
  const peopleLocations = splitEnvLines(process.env.OUTBOX_AUTOPILOT_AIRSCALE_PEOPLE_LOCATIONS);
  const companySizes = splitEnvLines(process.env.OUTBOX_AUTOPILOT_AIRSCALE_COMPANY_SIZES);
  const industries = splitEnvLines(process.env.OUTBOX_AUTOPILOT_AIRSCALE_INDUSTRIES);
  const jobs = splitEnvLines(process.env.OUTBOX_AUTOPILOT_AIRSCALE_JOBS);

  return {
    job: jobs.length ? jobs : defaultAirscaleJobFilters(audience),
    peopleLocation: peopleLocations.length
      ? peopleLocations
      : /\bunited states\b|\busa\b|\bu\.s\./.test(normalized)
        ? ["United States"]
        : undefined,
    size: companySizes.length
      ? companySizes.join("\n")
      : /11\s*-\s*500|11 to 500|11-500/.test(normalized)
        ? "11-20\n21-50\n51-100\n101-200\n201-500"
        : undefined,
    industry: industries.length
      ? industries.join("\n")
      : /\bsaas|software|b2b\b/.test(normalized)
        ? "software development\nit services and it consulting"
        : undefined,
    profileKeywords: [
      "growth",
      "outbound",
      "demand generation",
      "sales development",
      "lifecycle marketing",
      "customer onboarding",
    ].join("\n"),
    companyKeywords: compactText(audience, 500),
    searchMode: "SMART",
  };
}

function prospectFromAirscaleRow(row: Record<string, unknown>): OutboxSourcedProspect | null {
  const profile = asRecord(row.profile);
  const link = asRecord(row.link);
  const positionGroup = asRecord(asArray(row.position_groups)[0] ?? asArray(row.positionGroups)[0]);
  const positionCompany = asRecord(positionGroup.company);
  const position = asRecord(asArray(positionGroup.profile_positions)[0] ?? asArray(positionGroup.profilePositions)[0]);
  const companyRecord = asRecord(row.company);
  const companyLink = asRecord(companyRecord.link);
  const firstName = cleanLeadText(profile.first_name ?? profile.firstName ?? row.firstName ?? row.first_name, 80);
  const lastName = cleanLeadText(profile.last_name ?? profile.lastName ?? row.lastName ?? row.last_name, 80);
  const name = firstNonEmpty(
    cleanLeadText(profile.full_name ?? profile.fullName ?? row.name ?? row.fullName, 120),
    [firstName, lastName].filter(Boolean).join(" ")
  );
  const company = firstNonEmpty(
    cleanLeadText(positionCompany.name, 120),
    cleanLeadText(position.company, 120),
    cleanLeadText(companyRecord.name, 120),
    cleanLeadText(row.companyName, 120)
  );
  const title = firstNonEmpty(
    cleanLeadText(profile.title, 160),
    cleanLeadText(position.title, 160),
    cleanLeadText(profile.headline, 160)
  );
  const website = firstNonEmpty(
    positionCompany.domain,
    positionCompany.website,
    companyRecord.domain,
    companyRecord.website,
    companyLink.website,
    row.domain,
    row.companyDomain
  );
  const sourceUrl = firstNonEmpty(
    link.linkedin,
    profile.linkedin,
    profile.linkedin_url,
    row.linkedinUrl,
    row.linkedin_url,
    row.sourceUrl,
    companyLink.linkedin,
    positionCompany.url,
    website
  );
  const domain = normalizeDomain(website) || domainFromUrl(website);
  if (!name || (!domain && !sourceUrl)) return null;
  return {
    name: compactText(name, 120),
    company: compactText(company, 120),
    title: compactText(title, 160),
    domain,
    sourceUrl: compactText(sourceUrl, 500),
  };
}

async function sourceOutboxProspectsFromAirscale(input: {
  targetAudience: string;
  offer: string;
  maxProspects: number;
  signal?: AbortSignal;
}): Promise<OutboxProspectSourcingResult> {
  const targetAudience = compactText(input.targetAudience, 1_500);
  const offer = compactText(input.offer, 1_000);
  if (!targetAudience) throw new Error("Target audience is required for prospect sourcing.");
  if (!offer) throw new Error("Offer is required for prospect sourcing.");
  const key = airscaleApiKey();
  if (!key) throw new Error("AIRSCALE_API_KEY is missing. Add it before using automatic Airscale prospect sourcing.");
  const maxProspects = Math.max(1, Math.min(100, Math.trunc(Number(input.maxProspects) || 25)));
  const filters = buildAirscaleLeadFilters({ targetAudience, offer });
  const body = {
    filters,
    page: 0,
    size: maxProspects,
  };
  const response = await fetch(`${airscaleBaseUrl()}/v1/leads-finder`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  const rawText = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = rawText ? asRecord(JSON.parse(rawText)) : {};
  } catch {
    payload = { raw: rawText.slice(0, 500) };
  }
  if (!response.ok) {
    const message = compactText(payload.message ?? payload.error ?? rawText, 500);
    throw new Error(`Airscale leads finder failed (${response.status}): ${message || "unknown_error"}`);
  }

  const rows = asArray(payload.rows).map(asRecord);
  const prospects = rows
    .map(prospectFromAirscaleRow)
    .filter((prospect): prospect is OutboxSourcedProspect => Boolean(prospect))
    .slice(0, maxProspects);
  const rejectedCount = Math.max(0, rows.length - prospects.length);
  const creditsUsed = Number((rows.length * 0.1).toFixed(2));
  return {
    prospects,
    rejectedCount,
    diagnostics: [
      {
        provider: "airscale",
        total: Number(payload.total ?? rows.length) || rows.length,
        returned: rows.length,
        usable: prospects.length,
      },
    ],
    queryPlan: {
      provider: "airscale",
      endpoint: "/v1/leads-finder",
      filters,
      page: Number(payload.page ?? 0) || 0,
      size: Number(payload.size ?? maxProspects) || maxProspects,
    },
    creditsUsed,
    budgetUsedUsd: 0,
    exaSpendUsd: 0,
    dataForSeoSpendUsd: 0,
  };
}

function finderHeaderFieldName(value: string) {
  const key = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["name", "fullname", "person", "contact", "contactname"].includes(key)) return "name";
  if (["firstname", "first"].includes(key)) return "firstName";
  if (["lastname", "last", "surname"].includes(key)) return "lastName";
  if (["company", "companyname", "account", "organization", "org"].includes(key)) return "company";
  if (["title", "jobtitle", "role"].includes(key)) return "title";
  if (["domain", "companydomain", "website", "url"].includes(key)) return "domain";
  if (["source", "sourceurl", "profile", "profileurl", "linkedin", "linkedinurl", "linkedinprofile"].includes(key)) {
    return "sourceUrl";
  }
  return "";
}

function normalizeOutboxSourceMode(input: OutboxLaunchInput): OutboxSourceMode {
  const explicit = String(input.sourceMode ?? "").trim().toLowerCase();
  if (explicit === "auto" || explicit === "prospects" || explicit === "source" || explicit === "sourcing") return "auto";
  if (explicit === "airscale" || explicit === "finder" || explicit === "find") return "airscale";
  if (explicit === "contacts" || explicit === "manual" || explicit === "paste") return "contacts";
  if (String(input.prospectQuery ?? "").trim()) return "auto";
  return String(input.finderText ?? "").trim() ? "airscale" : "contacts";
}

function csvCell(value: unknown) {
  const raw = String(value ?? "").replace(/\r|\n/g, " ").trim();
  return /[",]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function finderTextFromSourcedProspects(sourced: OutboxProspectSourcingResult) {
  const rows = sourced.prospects.map((prospect) =>
    [
      prospect.name,
      prospect.company,
      prospect.domain,
      prospect.title,
      prospect.sourceUrl,
    ].map(csvCell).join(",")
  );
  return ["name,company,domain,title,linkedin", ...rows].join("\n");
}

function prospectSourcingSummary(
  sourced: OutboxProspectSourcingResult,
  requested: number
): OutboxProspectSourcingSummary {
  return {
    provider: "airscale",
    requested,
    sourced: sourced.prospects.length,
    rejected: sourced.rejectedCount,
    diagnosticsCount: sourced.diagnostics.length,
    creditsUsed: sourced.creditsUsed,
    budgetUsedUsd: sourced.budgetUsedUsd,
    exaSpendUsd: sourced.exaSpendUsd,
    dataForSeoSpendUsd: sourced.dataForSeoSpendUsd,
    sample: sourced.prospects.slice(0, 5).map((prospect) => ({
      name: prospect.name,
      company: prospect.company,
      title: prospect.title,
      domain: prospect.domain,
    })),
  };
}

function parseOutboxFinderTargets(text: string): {
  targets: OutboxFinderTarget[];
  rejected: ManualBatchRejectedContact[];
  truncated: boolean;
} {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return { targets: [], rejected: [], truncated: false };

  const firstCells = parseCsvLine(lines[0] ?? "");
  const headerNames = firstCells.map(finderHeaderFieldName);
  const hasHeader = headerNames.some(Boolean) && firstCells.some((cell) => !cell.includes("."));
  const rows = hasHeader ? lines.slice(1) : lines;
  const targets: OutboxFinderTarget[] = [];
  const rejected: ManualBatchRejectedContact[] = [];
  const truncated = rows.length > MAX_OUTBOX_AIRSCALE_TARGETS;

  rows.forEach((line, index) => {
    const rowNumber = index + 1;
    if (index >= MAX_OUTBOX_AIRSCALE_TARGETS) {
      rejected.push({ rowNumber, email: "", reason: "airscale_batch_limit_200" });
      return;
    }
    const cells = parseCsvLine(line);
    const record: Record<string, string> = {};
    if (hasHeader) {
      headerNames.forEach((name, cellIndex) => {
        if (!name) return;
        record[name] = cells[cellIndex] ?? "";
      });
    } else {
      record.name = cells[0] ?? "";
      record.company = cells[1] ?? "";
      record.domain = cells[2] ?? "";
      record.title = cells[3] ?? "";
      record.sourceUrl = cells[4] ?? "";
    }

    const name = compactText(record.name || [record.firstName, record.lastName].filter(Boolean).join(" "), 120);
    const sourceUrl = String(record.sourceUrl ?? "").trim();
    const sourceDomain = /linkedin\.com\/in\//i.test(sourceUrl) ? "" : domainFromUrl(sourceUrl);
    const domain = normalizeDomain(record.domain) || sourceDomain;
    if (!name) {
      rejected.push({ rowNumber, email: "", reason: "missing_name_for_airscale" });
      return;
    }
    if (!domain && !sourceUrl) {
      rejected.push({ rowNumber, email: name, reason: "missing_company_domain_or_profile_for_airscale" });
      return;
    }
    targets.push({
      rowNumber,
      name,
      company: compactText(record.company, 120),
      title: compactText(record.title, 160),
      domain,
      sourceUrl,
    });
  });

  return { targets, rejected, truncated };
}

function startOfUtcDayIso() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function startOfUtcHourIso() {
  const date = new Date();
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function renderTemplate(template: string, contact: ManualBatchAcceptedContact) {
  const values: Record<string, string> = {
    email: contact.email,
    name: contact.name || contact.email,
    firstName: (contact.name || "").split(/\s+/).filter(Boolean)[0] ?? "",
    company: contact.company,
    title: contact.title,
    domain: contact.domain,
  };
  return String(template ?? "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
}

function outboxCopyExperimentModel() {
  return (
    outboxEnvText("OUTBOX_AUTOPILOT_MESSAGE_MODEL", 120) ||
    outboxEnvText("OPENROUTER_MODEL_TASK_OUTBOX_MESSAGE_EXPERIMENT", 120) ||
    DEFAULT_OUTBOX_MESSAGE_EXPERIMENT_MODEL
  );
}

function outboxMessageExperimentsEnabled(sourceMode: OutboxSourceMode) {
  if (sourceMode === "auto") return true;
  const raw = String(process.env.OUTBOX_AUTOPILOT_MESSAGE_EXPERIMENTS_ENABLED ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return false;
}

function outboxWordCount(text: string) {
  return text.split(/\s+/).map((word) => word.trim()).filter(Boolean).length;
}

function hasTemplateToken(text: string, token: string) {
  return new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, "i").test(text);
}

function outboxMessageExperimentSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "variantName",
      "hypothesis",
      "targetSegment",
      "primaryAngle",
      "proofPoint",
      "subject",
      "body",
      "replyGoal",
      "expectedReplySignal",
      "risks",
      "qualityScore",
    ],
    properties: {
      variantName: { type: "string", minLength: 4, maxLength: 80 },
      hypothesis: { type: "string", minLength: 20, maxLength: 240 },
      targetSegment: { type: "string", minLength: 10, maxLength: 180 },
      primaryAngle: { type: "string", minLength: 10, maxLength: 160 },
      proofPoint: { type: "string", minLength: 5, maxLength: 180 },
      subject: {
        type: "string",
        minLength: 4,
        maxLength: 90,
        description: "Short subject containing {{company}}. No hype or fake familiarity.",
      },
      body: {
        type: "string",
        minLength: 120,
        maxLength: 900,
        description:
          "Plain-text email body with {{firstName}} and {{company}}, 45-150 words, signed by Zeynep. No URLs, no fake observation opener.",
      },
      replyGoal: { type: "string", minLength: 10, maxLength: 160 },
      expectedReplySignal: { type: "string", minLength: 10, maxLength: 160 },
      risks: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: { type: "string", minLength: 3, maxLength: 140 },
      },
      qualityScore: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description: "0-100 sendability and reply-quality score. Use 80+ only when the copy clears all constraints.",
      },
    },
  };
}

function normalizeOutboxMessageExperiment(input: {
  raw: unknown;
  provider: OutboxMessageExperiment["provider"];
  model: string;
  batchId: string;
}): OutboxMessageExperiment {
  const row = asRecord(input.raw);
  const risks = asArray(row.risks).map((risk) => compactText(risk, 140)).filter(Boolean).slice(0, 4);
  const subject = compactText(row.subject, 90);
  const body = String(row.body ?? "").replace(/\r\n/g, "\n").trim();
  const rawQualityScore = clampInt(row.qualityScore, 0, 0, 100);
  const qualityScore = rawQualityScore > 0 && rawQualityScore <= 10 ? rawQualityScore * 10 : rawQualityScore;
  const failures: string[] = [];

  if (!hasTemplateToken(body, "firstName")) failures.push("body_missing_first_name_token");
  if (!hasTemplateToken(body, "company")) failures.push("body_missing_company_token");
  if (!hasTemplateToken(subject, "company")) failures.push("subject_missing_company_token");
  if (outboxWordCount(body) < 45 || outboxWordCount(body) > 150) failures.push("body_word_count_out_of_bounds");
  if (/https?:\/\//i.test(body)) failures.push("body_contains_url");
  if (/\b(guarantee|guaranteed|revolutionary|no[- ]?brainer|just checking in)\b/i.test(body)) {
    failures.push("body_contains_hype_or_spam_phrase");
  }
  if (/\b(noticed|saw|came across)\b/i.test(body)) failures.push("body_uses_rejected_observation_frame");
  if (qualityScore < 70) failures.push("quality_score_below_bar");
  if (failures.length) {
    throw new Error(`GPT outbox message experiment failed validation: ${failures.join(", ")}`);
  }

  return {
    id: `copy_${input.batchId}`,
    provider: input.provider,
    model: input.model,
    variantName: compactText(row.variantName, 80),
    hypothesis: compactText(row.hypothesis, 240),
    targetSegment: compactText(row.targetSegment, 180),
    primaryAngle: compactText(row.primaryAngle, 160),
    proofPoint: compactText(row.proofPoint, 180),
    subject,
    body,
    replyGoal: compactText(row.replyGoal, 160),
    expectedReplySignal: compactText(row.expectedReplySignal, 160),
    risks: risks.length ? risks : ["Unknown copy risk"],
    qualityScore,
    generatedAt: nowIso(),
  };
}

async function generateOutboxMessageExperiment(input: {
  brand: BrandRecord;
  targetAudience: string;
  offer: string;
  contacts: OutboxPreparedContact[];
  batchId: string;
}): Promise<OutboxMessageExperiment> {
  const sampleContacts = input.contacts.slice(0, 8).map((contact) => ({
    firstName: (contact.name || "").split(/\s+/).filter(Boolean)[0] || "",
    name: contact.name,
    company: contact.company,
    title: contact.title,
    domain: contact.domain,
  }));
  const brandContext = {
    name: input.brand.name,
    website: input.brand.website,
    product: input.brand.product,
    offer: input.offer || input.brand.product || input.brand.name,
    targetAudience: input.targetAudience,
    idealCustomerProfiles: input.brand.idealCustomerProfiles.slice(0, 6),
    targetMarkets: input.brand.targetMarkets.slice(0, 6),
    keyFeatures: input.brand.keyFeatures.slice(0, 8),
    keyBenefits: input.brand.keyBenefits.slice(0, 8),
    availableAssets: input.brand.availableAssets.slice(0, 8),
    sampleContacts,
  };
  const prompt = [
    "You choose the outbound email experiment for LastB2B Outbox. This is not an env-template fill-in task.",
    "",
    "Create one message experiment for this batch. The goal is a credible reply, not a pitch dump.",
    "Use only facts in the provided JSON. Do not invent case studies, metrics, mutual connections, observed behavior, or company-specific research.",
    "Prefer a role-relevant reply-first question. Keep it plain text, direct, and low-pressure.",
    "Avoid any observation opener. Do not use noticed, saw, came across, just checking in, or similar fake-research frames.",
    "The email must contain {{firstName}} and {{company}} placeholders in the body, and {{company}} in the subject.",
    "Do not include URLs, markdown, tracking language, fake familiarity, hype, discounts, guarantees, or manipulative urgency.",
    "Sign as Zeynep. Keep the body between 45 and 150 words.",
    "qualityScore must be an integer on a 0-100 scale. Improve the copy until it honestly deserves at least 80.",
    "",
    `Brand and batch context JSON:\n${JSON.stringify(brandContext, null, 2)}`,
  ].join("\n");
  const result = await generateJsonWithLlm({
    task: "outbox_message_experiment",
    providerOverride: "openrouter",
    openRouterOverrideModel: outboxCopyExperimentModel(),
    prompt,
    format: {
      type: "json_schema",
      name: "outbox_message_experiment",
      schema: outboxMessageExperimentSchema(),
    },
    reasoningEffort: "high",
    maxOutputTokens: 1400,
  });
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(result.text);
  } catch {
    throw new Error(`GPT outbox message experiment returned invalid JSON: ${result.text.slice(0, 240)}`);
  }
  return normalizeOutboxMessageExperiment({
    raw: parsed,
    provider: result.provider,
    model: result.model,
    batchId: input.batchId,
  });
}

function outboxEmailVerification(): EmailVerificationState {
  return {
    mode: "heuristic",
    provider: "outbox_v1",
    verdict: "operator_supplied",
    confidence: "manual",
    reason: "operator_outbox_batch",
    mxStatus: "unknown",
    acceptAll: null,
    catchAll: null,
  };
}

function nullableBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return null;
}

function emailVerificationFromFinderResult(input: {
  result: Record<string, unknown>;
  bestGuess: Record<string, unknown>;
  bestAttempt: Record<string, unknown>;
}): EmailVerificationState {
  const verification = asRecord(input.result.verification);
  const details = asRecord(input.bestAttempt.details);
  const rawMode = String(verification.mode ?? "").trim().toLowerCase();
  const mode: EmailVerificationState["mode"] =
    rawMode === "local" || rawMode === "validatedmails" || rawMode === "heuristic" ? rawMode : "local";
  const provider = String(details.provider ?? details.external_provider ?? verification.provider ?? "airscale").trim();
  const verdict = String(input.bestGuess.verdict ?? input.bestAttempt.verdict ?? "").trim();
  const confidence = String(input.bestGuess.confidence ?? input.bestAttempt.confidence ?? "").trim();
  const acceptAll = nullableBool(details.accept_all ?? details.acceptAll);
  const catchAll = nullableBool(details.catch_all ?? details.catchAll);
  const pValid = Number(input.bestGuess.p_valid ?? input.bestAttempt.p_valid);
  const httpStatus = Number(details.http_status ?? details.external_provider_http_status);
  return {
    mode,
    provider,
    verdict,
    confidence,
    reason: String(details.reason ?? details.external_provider_reason ?? "").trim(),
    mxStatus: String(details.mx_status ?? verification.mx_status ?? "").trim(),
    acceptAll,
    catchAll,
    pValid: Number.isFinite(pValid) ? pValid : null,
    httpStatus: Number.isFinite(httpStatus) ? httpStatus : null,
    providerStatus: String(details.provider_status ?? details.external_provider_status ?? "").trim(),
  };
}

function isSafeFinderVerification(state: EmailVerificationState) {
  const verdict = String(state.verdict ?? "").trim().toLowerCase();
  const confidence = String(state.confidence ?? "").trim().toLowerCase();
  return (
    state.mode !== "heuristic" &&
    ["likely-valid", "valid", "accepted", "deliverable"].includes(verdict) &&
    confidence === "high" &&
    state.acceptAll !== true &&
    state.catchAll !== true
  );
}

function finderRejectReason(result: Record<string, unknown>, fallback: string) {
  const verification = asRecord(result.verification);
  const attempts = asArray(verification.external_provider_attempts).map(asRecord);
  const lastExternal = attempts[attempts.length - 1] ?? {};
  return (
    String(lastExternal.reason ?? "").trim() ||
    String(lastExternal.status ?? "").trim() ||
    String(asRecord(result.best_guess).route ?? "").trim() ||
    fallback
  );
}

async function prepareAirscaleOutboxContacts(input: {
  brandId: string;
  senderAccountId: string;
  batchName: string;
  finderText: string;
}): Promise<{
  accepted: OutboxPreparedContact[];
  rejected: ManualBatchRejectedContact[];
  finder: OutboxFinderSummary;
}> {
  const parsedTargets = parseOutboxFinderTargets(input.finderText);
  if (!parsedTargets.targets.length) {
    return {
      accepted: [],
      rejected: parsedTargets.rejected,
      finder: {
        provider: "airscale",
        requested: 0,
        processed: 0,
        found: 0,
        rejected: parsedTargets.rejected.length,
        creditsUsed: 0,
        truncated: parsedTargets.truncated,
      },
    };
  }

  const response = asRecord(
    await buildEmailFinderBatchResponse({
      request_id: `outbox-airscale-${Date.now()}`,
      audit_source: "outbox_v1_airscale",
      audit_context: {
        brandId: input.brandId,
        senderAccountId: input.senderAccountId,
        batchName: input.batchName,
      },
      default_item: {
        verification_mode: "local",
        external_provider_fallback: true,
        external_providers: ["airscale"],
        max_credits: 1,
        timeout_seconds: 12,
        probe_timeout_seconds: 12,
        stop_on_first_hit: true,
        stop_on_min_confidence: "high",
        local_fallback_on_risky: true,
        max_candidates: 12,
      },
      items: parsedTargets.targets.map((target) => ({
        id: `row-${target.rowNumber}`,
        name: target.name,
        company_name: target.company,
        domain: target.domain,
        linkedin_url: target.sourceUrl,
        source_url: target.sourceUrl,
      })),
      concurrency: 3,
      continue_on_error: true,
    })
  );
  const resultRows = asArray(response.results).map(asRecord);
  const resolvedContacts: Array<{
    email: string;
    name: string;
    company: string;
    title: string;
    domain: string;
    sourceUrl: string;
    verification: EmailVerificationState;
    realVerifiedEmail: boolean;
    finderMeta: Record<string, unknown>;
  }> = [];
  const rejected: ManualBatchRejectedContact[] = [...parsedTargets.rejected];
  let creditsUsed = 0;

  for (const row of resultRows) {
    const target = parsedTargets.targets[Number(row.index ?? 0)] ?? null;
    if (!target) continue;
    if (row.ok !== true) {
      rejected.push({ rowNumber: target.rowNumber, email: target.name, reason: String(row.error ?? "airscale_lookup_failed") });
      continue;
    }
    const result = asRecord(row.result);
    const verification = asRecord(result.verification);
    creditsUsed += Math.max(0, Number(verification.credits_used ?? 0) || 0);
    const bestGuess = asRecord(result.best_guess);
    const email = extractFirstEmailAddress(bestGuess.email);
    if (!email) {
      rejected.push({ rowNumber: target.rowNumber, email: target.name, reason: finderRejectReason(result, "airscale_no_high_confidence_email") });
      continue;
    }
    const suppressionReason = getLeadEmailSuppressionReason(email);
    if (suppressionReason) {
      rejected.push({ rowNumber: target.rowNumber, email, reason: suppressionReason });
      continue;
    }
    const attempts = asArray(result.attempts).map(asRecord);
    const bestAttempt =
      attempts.find((attempt) => extractFirstEmailAddress(attempt.email) === email) ??
      attempts.find((attempt) => Number(attempt.attempt ?? 0) === Number(bestGuess.attempt ?? 0)) ??
      {};
    const emailVerification = emailVerificationFromFinderResult({ result, bestGuess, bestAttempt });
    if (!isSafeFinderVerification(emailVerification)) {
      rejected.push({ rowNumber: target.rowNumber, email, reason: "airscale_email_not_safe_to_send" });
      continue;
    }
    resolvedContacts.push({
      email,
      name: target.name,
      company: target.company,
      title: target.title,
      domain: target.domain,
      sourceUrl: target.sourceUrl,
      verification: emailVerification,
      realVerifiedEmail: true,
      finderMeta: {
        provider: "airscale",
        bestGuess,
        externalProviderAttempts: asArray(verification.external_provider_attempts),
        creditsUsed: Math.max(0, Number(verification.credits_used ?? 0) || 0),
      },
    });
  }

  const parsedContacts = parseManualBatchContacts({ contacts: resolvedContacts });
  const verificationByEmail = new Map(resolvedContacts.map((contact) => [contact.email.toLowerCase(), contact] as const));
  const accepted = parsedContacts.accepted.map((contact) => {
    const found = verificationByEmail.get(contact.email.toLowerCase());
    return {
      ...contact,
      sourceMode: "airscale" as const,
      realVerifiedEmail: found?.realVerifiedEmail === true,
      emailVerification: found?.verification ?? outboxEmailVerification(),
      finderMeta: found?.finderMeta ?? null,
    };
  });
  const allRejected = [...rejected, ...parsedContacts.rejected];
  return {
    accepted,
    rejected: allRejected,
    finder: {
      provider: "airscale",
      requested: parsedTargets.targets.length,
      processed: resultRows.length,
      found: accepted.length,
      rejected: allRejected.length,
      creditsUsed,
      truncated: parsedTargets.truncated || response.truncated === true,
    },
  };
}

async function prepareOutboxContacts(input: {
  brandId: string;
  brandName: string;
  brandWebsite: string;
  senderAccountId: string;
  batchName: string;
  sourceMode: OutboxSourceMode;
  contactsText?: string;
  finderText?: string;
  prospectQuery?: string;
  prospectOffer?: string;
  maxProspects?: number;
}): Promise<{
  accepted: OutboxPreparedContact[];
  rejected: ManualBatchRejectedContact[];
  finder: OutboxFinderSummary | null;
  prospectSourcing: OutboxProspectSourcingSummary | null;
}> {
  if (input.sourceMode === "auto") {
    const requested = clampInt(input.maxProspects, 25, 1, 100);
    const sourced = await sourceOutboxProspectsFromAirscale({
      targetAudience: input.prospectQuery ?? "",
      offer: input.prospectOffer ?? "",
      maxProspects: requested,
    });
    if (!sourced.prospects.length) {
      return {
        accepted: [],
        rejected: [{ rowNumber: 1, email: "", reason: "no_prospects_found" }],
        finder: {
          provider: "airscale",
          requested: 0,
          processed: 0,
          found: 0,
          rejected: 0,
          creditsUsed: 0,
          truncated: false,
        },
        prospectSourcing: prospectSourcingSummary(sourced, requested),
      };
    }
    const prepared = await prepareAirscaleOutboxContacts({
      brandId: input.brandId,
      senderAccountId: input.senderAccountId,
      batchName: input.batchName,
      finderText: finderTextFromSourcedProspects(sourced),
    });
    return {
      ...prepared,
      accepted: prepared.accepted.map((contact) => ({
        ...contact,
        sourceMode: "auto" as const,
      })),
      prospectSourcing: prospectSourcingSummary(sourced, requested),
    };
  }

  if (input.sourceMode === "airscale") {
    const prepared = await prepareAirscaleOutboxContacts({
      brandId: input.brandId,
      senderAccountId: input.senderAccountId,
      batchName: input.batchName,
      finderText: input.finderText ?? "",
    });
    return {
      ...prepared,
      prospectSourcing: null,
    };
  }

  const parsed = parseManualBatchContacts({ contactsText: input.contactsText });
  return {
    accepted: parsed.accepted.map((contact) => ({
      ...contact,
      sourceMode: "contacts" as const,
      realVerifiedEmail: false,
      emailVerification: outboxEmailVerification(),
      finderMeta: null,
    })),
    rejected: parsed.rejected,
    finder: null,
    prospectSourcing: null,
  };
}

async function filterRecentOutboxRecipients(input: {
  brandId: string;
  contacts: OutboxPreparedContact[];
}): Promise<{
  accepted: OutboxPreparedContact[];
  rejected: ManualBatchRejectedContact[];
}> {
  const accepted: OutboxPreparedContact[] = [];
  const rejected: ManualBatchRejectedContact[] = [];
  const seenInBatch = new Set<string>();
  const emails = input.contacts
    .map((contact) => contact.email.trim().toLowerCase())
    .filter(Boolean);
  const recentEmails = new Set<string>();
  const supabase = getSupabaseAdmin();
  if (supabase && emails.length > 0) {
    const { data, error } = await supabase
      .from("demanddev_outreach_messages")
      .select("to_email,lead_id,status,created_at,sent_at")
      .eq("brand_id", input.brandId)
      .in("status", ["scheduled", "sent", "replied"])
      .gte("created_at", daysAgoIso(OUTBOX_RECENT_RECIPIENT_DEDUPE_DAYS))
      .limit(5000);
    if (!error) {
      const messageRows = data ?? [];
      const leadIds = Array.from(
        new Set(
          messageRows
            .map((row) => String((row as Record<string, unknown>).lead_id ?? "").trim())
            .filter(Boolean)
        )
      );
      const leadEmailById = new Map<string, string>();
      if (leadIds.length > 0) {
        const { data: leadRows, error: leadError } = await supabase
          .from("demanddev_outreach_run_leads")
          .select("id,email")
          .in("id", leadIds)
          .limit(5000);
        if (!leadError) {
          for (const row of leadRows ?? []) {
            const record = row as Record<string, unknown>;
            const id = String(record.id ?? "").trim();
            const email = String(record.email ?? "").trim().toLowerCase();
            if (id && email) leadEmailById.set(id, email);
          }
        }
      }
      for (const row of data ?? []) {
        const record = row as Record<string, unknown>;
        const leadId = String(record.lead_id ?? "").trim();
        const candidates = [
          String(record.to_email ?? "").trim().toLowerCase(),
          leadEmailById.get(leadId) ?? "",
        ];
        for (const email of candidates) {
          if (email) recentEmails.add(email);
        }
      }
    }
  }

  input.contacts.forEach((contact, index) => {
    const email = contact.email.trim().toLowerCase();
    if (!email) {
      rejected.push({ rowNumber: index + 1, email: "", reason: "missing_email" });
      return;
    }
    if (seenInBatch.has(email)) {
      rejected.push({ rowNumber: index + 1, email: contact.email, reason: "duplicate_in_current_outbox_batch" });
      return;
    }
    seenInBatch.add(email);
    if (recentEmails.has(email)) {
      rejected.push({ rowNumber: index + 1, email: contact.email, reason: "duplicate_recent_outbox_recipient" });
      return;
    }
    accepted.push(contact);
  });

  return { accepted, rejected };
}

function isOutboxRunExternalRef(value: string | null | undefined) {
  return String(value ?? "").trim().startsWith(OUTBOX_V1_EXTERNAL_REF_PREFIX);
}

async function resolveReplyToEmail(input: {
  brandId: string;
  account: OutreachAccount;
}) {
  const assignment = await getBrandOutreachAssignment(input.brandId).catch(() => null);
  const mailboxAccountId = String(assignment?.mailboxAccountId ?? "").trim();
  const mailboxAccount = mailboxAccountId ? await getOutreachAccount(mailboxAccountId).catch(() => null) : null;
  const replyToEmail =
    getOutreachAccountReplyToEmail(mailboxAccount ?? input.account).trim() ||
    input.account.config.customerIo.replyToEmail.trim() ||
    getOutreachAccountFromEmail(input.account).trim();
  return {
    replyToEmail,
    mailboxAccountId: mailboxAccount?.id ?? input.account.id,
  };
}

function outboxResolvedSecrets(secrets: OutreachAccountSecrets | null | undefined) {
  return secrets ?? EMPTY_OUTREACH_ACCOUNT_SECRETS;
}

function outboxSenderDeliveryReason(account: OutreachAccount, secrets: OutreachAccountSecrets | null | undefined) {
  const resolvedSecrets = outboxResolvedSecrets(secrets);
  if (supportsAnyDelivery(account, resolvedSecrets)) return "";
  if (account.provider === "mailpool") {
    return supportsMailpoolDelivery(account, resolvedSecrets)
      ? ""
      : "Mailpool sender missing mailbox, SMTP, Gmail UI, or password readiness";
  }
  return "Customer.io sender missing Site ID, From email, Reply-To, or App API key";
}

function outboxSenderReadiness(input: {
  account: OutreachAccount;
  secrets: OutreachAccountSecrets | null | undefined;
  replyToEmail: string;
}) {
  return [
    input.account.status === "active" ? "" : "Account inactive",
    outboxSenderDeliveryReason(input.account, input.secrets),
    input.replyToEmail ? "" : "Reply-To email missing",
  ].filter(Boolean);
}

async function requireOutboxSenderReady(input: {
  brandId: string;
  account: OutreachAccount;
  secrets: OutreachAccountSecrets | null | undefined;
}) {
  await ensureOutboxSenderAllowed({ brandId: input.brandId, accountId: input.account.id });
  const reply = await resolveReplyToEmail({ brandId: input.brandId, account: input.account });
  const missing = outboxSenderReadiness({
    account: input.account,
    secrets: input.secrets,
    replyToEmail: reply.replyToEmail,
  });
  if (missing.length > 0) {
    throw new Error(missing.join("; "));
  }
  return {
    secrets: outboxResolvedSecrets(input.secrets),
    reply,
  };
}

async function senderOptionsForBrand(brandId: string): Promise<OutboxSenderOption[]> {
  const [accounts, assignment, canonicalPool] = await Promise.all([
    listOutreachAccounts(),
    getBrandOutreachAssignment(brandId).catch(() => null),
    getCanonicalSenderPoolForBrand(brandId).catch(() => null),
  ]);
  const primaryAccountId = String(assignment?.accountId ?? "").trim();
  const allowedAccountIds = new Set(
    [
      primaryAccountId,
      ...(assignment?.accountIds ?? []),
      ...(canonicalPool?.senders.map((sender) => sender.deliveryAccountId) ?? []),
    ]
      .map((accountId) => accountId.trim())
      .filter(Boolean)
  );
  const scopedAccounts = accounts.filter(
    (account) =>
      account.accountType !== "mailbox" &&
      (allowedAccountIds.size === 0 || allowedAccountIds.has(account.id))
  );
  const options = await Promise.all(
    scopedAccounts.map(async (account) => {
      const secrets = await getOutreachAccountSecrets(account.id).catch(() => null);
      const reply = await resolveReplyToEmail({ brandId, account }).catch(() => ({
        replyToEmail: "",
        mailboxAccountId: "",
      }));
      const fromEmail = getOutreachAccountFromEmail(account).trim();
      const missing = outboxSenderReadiness({ account, secrets, replyToEmail: reply.replyToEmail });
      return {
        accountId: account.id,
        name: account.name,
        fromEmail,
        replyToEmail: reply.replyToEmail,
        provider: account.provider,
        status: account.status,
        ready: missing.length === 0,
        reason: missing.join("; "),
        primary: account.id === primaryAccountId,
      } satisfies OutboxSenderOption;
    })
  );
  return options.sort((left, right) => {
    if (left.ready !== right.ready) return left.ready ? -1 : 1;
    if (left.primary !== right.primary) return left.primary ? -1 : 1;
    return left.fromEmail.localeCompare(right.fromEmail);
  });
}

async function ensureOutboxSenderAllowed(input: { brandId: string; accountId: string }) {
  const sender = (await senderOptionsForBrand(input.brandId)).find((option) => option.accountId === input.accountId) ?? null;
  if (!sender) {
    throw new Error("Choose an assigned sender for this brand.");
  }
  if (!sender.ready) {
    throw new Error(sender.reason || "Selected sender is not ready.");
  }
  return sender;
}

function metadataMatchesSender(meta: unknown, account: OutreachAccount) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  const record = meta as Record<string, unknown>;
  const accountId = String(record.senderAccountId ?? record.accountId ?? "").trim();
  const fromEmail = String(record.senderFromEmail ?? record.fromEmail ?? "").trim().toLowerCase();
  return accountId === account.id || fromEmail === getOutreachAccountFromEmail(account).trim().toLowerCase();
}

async function senderMessageWindowStats(account: OutreachAccount) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { sentToday: 0, sentThisHour: 0, failedOrBouncedLast7d: 0 };
  }

  const [todayResult, hourResult, weekResult] = await Promise.all([
    supabase
      .from("demanddev_outreach_messages")
      .select("status,generation_meta,sent_at,created_at")
      .gte("sent_at", startOfUtcDayIso())
      .in("status", ["sent", "replied"])
      .limit(5000),
    supabase
      .from("demanddev_outreach_messages")
      .select("status,generation_meta,sent_at,created_at")
      .gte("sent_at", startOfUtcHourIso())
      .in("status", ["sent", "replied"])
      .limit(5000),
    supabase
      .from("demanddev_outreach_messages")
      .select("status,generation_meta,sent_at,created_at")
      .gte("created_at", daysAgoIso(7))
      .in("status", ["failed", "bounced"])
      .limit(5000),
  ]);

  const todayRows = todayResult.error ? [] : todayResult.data ?? [];
  const hourRows = hourResult.error ? [] : hourResult.data ?? [];
  const weekRows = weekResult.error ? [] : weekResult.data ?? [];
  return {
    sentToday: todayRows.filter((row) => metadataMatchesSender((row as Record<string, unknown>).generation_meta, account)).length,
    sentThisHour: hourRows.filter((row) => metadataMatchesSender((row as Record<string, unknown>).generation_meta, account)).length,
    failedOrBouncedLast7d: weekRows.filter((row) => metadataMatchesSender((row as Record<string, unknown>).generation_meta, account)).length,
  };
}

async function policyForSender(input: {
  brandId: string;
  account: OutreachAccount;
  requestedContacts?: number;
  requestedSendNow?: number;
}): Promise<OutboxPolicyDecision> {
  const [canonicalPool, stats] = await Promise.all([
    getCanonicalSenderPoolForBrand(input.brandId).catch(() => null),
    senderMessageWindowStats(input.account),
  ]);
  const canonicalSender = canonicalPool?.senderByAccountId.get(input.account.id) ?? null;
  const canonicalState = String(canonicalSender?.state ?? "").trim();
  const reasons: string[] = [];
  let senderState: OutboxPolicyDecision["senderState"] = "warming";
  if (canonicalState === "ready") senderState = "healthy";
  if (canonicalState === "restricted") senderState = "constrained";
  if (canonicalState === "blocked" || canonicalState === "retired") senderState = "paused";
  if (input.account.status !== "active") {
    senderState = "paused";
    reasons.push("sender_inactive");
  }
  if (!outboundSendingEnabled()) {
    senderState = "paused";
    reasons.push("outbound_sending_disabled");
  }
  if (stats.failedOrBouncedLast7d >= 5 && senderState !== "paused") {
    senderState = "constrained";
    reasons.push("recent_provider_failures_or_bounces");
  }

  const baseDailyCap =
    canonicalSender?.dailyCap && canonicalSender.dailyCap > 0
      ? canonicalSender.dailyCap
      : senderState === "healthy"
        ? DEFAULT_HEALTHY_DAILY_CAP
        : DEFAULT_WARMING_DAILY_CAP;
  const dailyCap =
    senderState === "paused"
      ? 0
      : senderState === "constrained"
        ? Math.min(baseDailyCap, 10)
        : baseDailyCap;
  const hourlyCap =
    canonicalSender?.hourlyCap && canonicalSender.hourlyCap > 0
      ? canonicalSender.hourlyCap
      : Math.min(DEFAULT_HOURLY_CAP, dailyCap || DEFAULT_HOURLY_CAP);
  const availableNow = Math.max(0, Math.min(dailyCap - stats.sentToday, hourlyCap - stats.sentThisHour));
  const requestedContacts = Math.max(0, Math.round(Number(input.requestedContacts ?? 0) || 0));
  const requestedSendNow =
    input.requestedSendNow === undefined
      ? requestedContacts
      : Math.max(0, Math.round(Number(input.requestedSendNow) || 0));
  const sendNow = Math.max(0, Math.min(requestedContacts, requestedSendNow, availableNow));
  const hold = Math.max(0, requestedContacts - sendNow);
  if (hold > 0 && availableNow <= 0 && senderState !== "paused") reasons.push("daily_or_hourly_cap_exhausted");
  if (hold > 0 && sendNow > 0) reasons.push("batch_exceeds_current_sender_cap");

  return {
    senderState,
    dailyCap,
    hourlyCap,
    sentToday: stats.sentToday,
    sentThisHour: stats.sentThisHour,
    failedOrBouncedLast7d: stats.failedOrBouncedLast7d,
    availableNow,
    sendNow,
    hold,
    reject: 0,
    reasons,
  };
}

async function chooseOutboxAutopilotSender(input: {
  brandId: string;
  senders: OutboxSenderOption[];
  preferredSenderAccountId?: string;
  requestedContacts: number;
  requestedSendNow: number;
}): Promise<{ choice: OutboxAutopilotSenderChoice | null; reason: string; senderAccountId: string }> {
  const preferredSenderAccountId = String(input.preferredSenderAccountId ?? "").trim();
  const readySenders = input.senders.filter((sender) => sender.ready);
  const senderCandidates = preferredSenderAccountId
    ? input.senders.filter((sender) => sender.accountId === preferredSenderAccountId)
    : readySenders;
  if (!senderCandidates.length) {
    const selected = preferredSenderAccountId
      ? input.senders.find((sender) => sender.accountId === preferredSenderAccountId) ?? null
      : input.senders[0] ?? null;
    return {
      choice: null,
      reason: selected?.reason || (preferredSenderAccountId ? "sender_not_found_or_not_assigned" : "no_ready_sender"),
      senderAccountId: preferredSenderAccountId || selected?.accountId || "",
    };
  }

  const choices: OutboxAutopilotSenderChoice[] = [];
  for (const sender of senderCandidates) {
    if (!sender.ready) {
      if (preferredSenderAccountId) {
        return {
          choice: null,
          reason: sender.reason || "sender_not_ready",
          senderAccountId: sender.accountId,
        };
      }
      continue;
    }
    const account = await getOutreachAccount(sender.accountId).catch(() => null);
    if (!account) {
      if (preferredSenderAccountId) {
        return { choice: null, reason: "sender_account_not_found", senderAccountId: sender.accountId };
      }
      continue;
    }
    const policy = await policyForSender({
      brandId: input.brandId,
      account,
      requestedContacts: input.requestedContacts,
      requestedSendNow: input.requestedSendNow,
    });
    choices.push({ sender, account, policy });
  }

  if (!choices.length) {
    return {
      choice: null,
      reason: preferredSenderAccountId ? "sender_account_not_found" : "no_ready_sender",
      senderAccountId: preferredSenderAccountId,
    };
  }

  const stateRank: Record<OutboxPolicyDecision["senderState"], number> = {
    healthy: 4,
    constrained: 3,
    warming: 2,
    paused: 1,
  };
  const [best] = choices.sort((left, right) => {
    const sendNowDiff = right.policy.sendNow - left.policy.sendNow;
    if (sendNowDiff !== 0) return sendNowDiff;
    const availableDiff = right.policy.availableNow - left.policy.availableNow;
    if (availableDiff !== 0) return availableDiff;
    const stateDiff = stateRank[right.policy.senderState] - stateRank[left.policy.senderState];
    if (stateDiff !== 0) return stateDiff;
    const dailyDiff = right.policy.dailyCap - left.policy.dailyCap;
    if (dailyDiff !== 0) return dailyDiff;
    if (left.sender.primary !== right.sender.primary) return left.sender.primary ? -1 : 1;
    return left.sender.fromEmail.localeCompare(right.sender.fromEmail);
  });
  return {
    choice: best ?? null,
    reason: best ? "" : "no_ready_sender",
    senderAccountId: best?.sender.accountId ?? preferredSenderAccountId,
  };
}

function buildRunMetrics(input: {
  leads: OutreachRunLead[];
  messages: OutreachMessage[];
  replies: number;
  positiveReplies: number;
}) {
  return {
    sourcedLeads: input.leads.length,
    scheduledMessages: input.messages.filter((message) => message.status === "scheduled").length,
    sentMessages: input.messages.filter((message) => ["sent", "replied"].includes(message.status)).length,
    bouncedMessages: input.messages.filter((message) => message.status === "bounced").length,
    failedMessages: input.messages.filter((message) => message.status === "failed").length,
    replies: input.replies,
    positiveReplies: input.positiveReplies,
    negativeReplies: 0,
  };
}

async function refreshOutboxRunMetrics(run: OutreachRun) {
  const [leads, messages, { threads }] = await Promise.all([
    listRunLeads(run.id),
    listRunMessages(run.id),
    listReplyThreadsByBrand(run.brandId),
  ]);
  const runThreads = threads.filter((thread) => thread.runId === run.id);
  const metrics = buildRunMetrics({
    leads,
    messages,
    replies: runThreads.length,
    positiveReplies: runThreads.filter((thread) => thread.sentiment === "positive").length,
  });
  const remainingScheduled = metrics.scheduledMessages;
  const sentOrReplied = metrics.sentMessages;
  const nextStatus: OutreachRun["status"] =
    remainingScheduled > 0 ? "paused" : sentOrReplied > 0 ? "monitoring" : metrics.failedMessages > 0 ? "failed" : "monitoring";
  await updateOutreachRun(run.id, {
    status: nextStatus,
    metrics,
    pauseReason: remainingScheduled > 0 ? "Outbox policy is holding remaining contacts until sender cap opens." : "",
    lastError: "",
  });
  return { leads, messages, threads, metrics };
}

async function summarizeOutboxRun(input: {
  run: OutreachRun;
  campaigns: ScaleCampaignRecord[];
}): Promise<OutboxBatchSummary> {
  const [messages, leads, { threads }, account] = await Promise.all([
    listRunMessages(input.run.id),
    listRunLeads(input.run.id),
    listReplyThreadsByBrand(input.run.brandId),
    getOutreachAccount(input.run.accountId).catch(() => null),
  ]);
  const runThreads = threads.filter((thread) => thread.runId === input.run.id);
  const latestReplyAt =
    runThreads
      .map((thread) => thread.lastMessageAt)
      .filter(Boolean)
      .sort((left, right) => (left < right ? 1 : -1))[0] ?? "";
  const policyMeta = messages
    .map((message) => message.generationMeta?.outboxPolicy)
    .find((value) => value && typeof value === "object") as OutboxPolicyDecision | undefined;
  return {
    run: input.run,
    campaign: input.campaigns.find((campaign) => campaign.id === input.run.ownerId) ?? null,
    sender: {
      accountId: input.run.accountId,
      name: account?.name ?? "",
      fromEmail: getOutreachAccountFromEmail(account).trim(),
      replyToEmail: getOutreachAccountReplyToEmail(account).trim(),
    },
    counts: {
      leads: leads.length,
      scheduled: messages.filter((message) => message.status === "scheduled").length,
      sent: messages.filter((message) => ["sent", "replied"].includes(message.status)).length,
      failed: messages.filter((message) => message.status === "failed").length,
      canceled: messages.filter((message) => message.status === "canceled").length,
      bounced: messages.filter((message) => message.status === "bounced").length,
      replies: runThreads.length,
      positiveReplies: runThreads.filter((thread) => thread.sentiment === "positive").length,
    },
    latestReplyAt,
    policy: policyMeta ?? null,
  };
}

export async function listOutboxBatches(brandId: string, limit = 25): Promise<OutboxBatchSummary[]> {
  const [runs, campaigns] = await Promise.all([
    listBrandRuns(brandId),
    listStoredScaleCampaignRecords(brandId),
  ]);
  const outboxRuns = runs
    .filter((run) => isOutboxRunExternalRef(run.externalRef))
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
    .slice(0, Math.max(1, Math.min(100, Math.round(Number(limit) || 25))));
  return Promise.all(outboxRuns.map((run) => summarizeOutboxRun({ run, campaigns })));
}

export async function getOutboxConsoleState(brandId: string, preferredSenderAccountId = ""): Promise<OutboxConsoleState> {
  const [batches, senders] = await Promise.all([
    listOutboxBatches(brandId),
    senderOptionsForBrand(brandId),
  ]);
  const selectedSender = (
    preferredSenderAccountId
      ? senders.find((sender) => sender.accountId === preferredSenderAccountId)
      : senders.find((sender) => sender.ready)
  ) ?? senders.find((sender) => sender.ready) ?? null;
  const account = selectedSender ? await getOutreachAccount(selectedSender.accountId).catch(() => null) : null;
  const selectedPolicy = account
    ? await policyForSender({ brandId, account, requestedContacts: 0, requestedSendNow: 0 })
    : null;
  return {
    batches,
    senders,
    selectedPolicy,
    outboundSendingEnabled: outboundSendingEnabled(),
    maxBatchContacts: MAX_OUTBOX_BATCH_CONTACTS,
  };
}

export async function launchOutboxBatch(input: OutboxLaunchInput): Promise<OutboxLaunchResult> {
  const brand = await getBrandById(input.brandId, { includeEmbedded: true });
  if (!brand) throw new Error("Brand not found.");

  const sourceMode = normalizeOutboxSourceMode(input);
  const messageExperimentsEnabled = outboxMessageExperimentsEnabled(sourceMode);
  let subject = compactText(input.subject, 200);
  let body = String(input.body ?? "").trim();
  if (!messageExperimentsEnabled && !subject) throw new Error("Subject is required.");
  if (!messageExperimentsEnabled && !body) throw new Error("Body is required.");
  const batchId = `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const batchName = compactText(input.batchName, 120) || `Outbox ${new Date().toLocaleDateString("en-US")}`;

  const senderAccountId = String(input.senderAccountId ?? "").trim() ||
    String((await getBrandOutreachAssignment(input.brandId).catch(() => null))?.accountId ?? "").trim();
  if (!senderAccountId) throw new Error("Choose a sender.");
  const account = await getOutreachAccount(senderAccountId);
  if (!account) throw new Error("Sender account not found.");
  const { secrets, reply } = await requireOutboxSenderReady({
    brandId: input.brandId,
    account,
    secrets: await getOutreachAccountSecrets(account.id),
  });

  const prepared = await prepareOutboxContacts({
    brandId: input.brandId,
    brandName: brand.name,
    brandWebsite: brand.website,
    senderAccountId,
    batchName,
    sourceMode,
    contactsText: input.contactsText,
    finderText: input.finderText,
    prospectQuery: input.prospectQuery,
    prospectOffer: input.prospectOffer || subject,
    maxProspects: input.maxProspects,
  });
  if (!prepared.accepted.length) {
    throw new Error(
      prepared.rejected.length
        ? `No sendable contacts. First rejection: ${prepared.rejected[0]?.reason}`
        : sourceMode === "auto"
          ? "No prospects were sourced."
          : sourceMode === "airscale"
          ? "Airscale targets are required."
          : "Contacts are required."
    );
  }

  const deduped = await filterRecentOutboxRecipients({
    brandId: input.brandId,
    contacts: prepared.accepted,
  });
  const allRejected = [...prepared.rejected, ...deduped.rejected];
  if (!deduped.accepted.length) {
    throw new Error(
      allRejected.length
        ? `No sendable contacts after dedupe. First rejection: ${allRejected[0]?.reason}`
        : "No sendable contacts after dedupe."
    );
  }

  const accepted = deduped.accepted.slice(0, MAX_OUTBOX_BATCH_CONTACTS);
  const copyExperiment = messageExperimentsEnabled
    ? await generateOutboxMessageExperiment({
        brand,
        targetAudience: compactText(input.prospectQuery, 1000) || defaultOutboxAutopilotTargetAudience(brand),
        offer: compactText(input.prospectOffer, 1000) || brand.product || brand.name,
        contacts: accepted,
        batchId,
      })
    : null;
  if (copyExperiment) {
    subject = copyExperiment.subject;
    body = copyExperiment.body;
  }
  const requestedSendNow = clampInt(input.requestedSendNow, accepted.length, 0, MAX_OUTBOX_BATCH_CONTACTS);
  const policy = await policyForSender({
    brandId: input.brandId,
    account,
    requestedContacts: accepted.length,
    requestedSendNow,
  });
  const timezone = String(input.timezone ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const dailyCap = Math.max(1, policy.dailyCap || DEFAULT_WARMING_DAILY_CAP);
  const hourlyCap = Math.max(1, policy.hourlyCap || Math.min(DEFAULT_HOURLY_CAP, dailyCap));

  const experiment = await createExperimentRecord({
    brandId: input.brandId,
    name: batchName,
    offer: subject,
    audience:
      sourceMode === "auto"
        ? `${accepted.length} auto-sourced outbox contacts`
        : sourceMode === "airscale"
          ? `${accepted.length} Airscale-resolved outbox contacts`
          : `${accepted.length} operator-supplied outbox contacts`,
    createRuntime: true,
  });
  const updatedExperiment = await updateExperimentRecord(input.brandId, experiment.id, {
    status: "ready",
    testEnvelope: {
      ...experiment.testEnvelope,
      sampleSize: accepted.length,
      dailyCap,
      hourlyCap,
      timezone,
      minSpacingMinutes: 0,
      oneContactPerCompany: false,
      businessHoursEnabled: false,
      businessHoursStartHour: 0,
      businessHoursEndHour: 0,
      businessDays: [0, 1, 2, 3, 4, 5, 6],
    },
  });
  const runtimeExperiment = updatedExperiment ?? experiment;
  const campaign = await createScaleCampaignRecordFromExperiment({
    brandId: input.brandId,
    experimentId: runtimeExperiment.id,
    campaignName: batchName,
    status: "active",
    lane: "outbound",
    scalePolicy: {
      dailyCap,
      hourlyCap,
      timezone,
      minSpacingMinutes: 0,
      accountId: account.id,
      mailboxAccountId: reply.mailboxAccountId || account.id,
      safetyMode: "balanced",
    },
  });
  const run = await createOutreachRun({
    brandId: input.brandId,
    campaignId: runtimeExperiment.runtime.campaignId,
    experimentId: runtimeExperiment.runtime.experimentId,
    hypothesisId: runtimeExperiment.runtime.hypothesisId,
    ownerType: "campaign",
    ownerId: campaign.id,
    accountId: account.id,
    lockedSenderAccountId: account.id,
    status: policy.sendNow > 0 ? "sending" : "paused",
    dailyCap,
    hourlyCap,
    timezone,
    minSpacingMinutes: 0,
    externalRef: `${OUTBOX_V1_EXTERNAL_REF_PREFIX}${batchId}`,
    pauseReason: policy.sendNow > 0 ? "" : "Outbox policy is holding all contacts.",
  });

  const leads = await upsertRunLeads(
    run.id,
    input.brandId,
    runtimeExperiment.runtime.campaignId,
    accepted.map((contact, index) => ({
      email: contact.email,
      name: contact.name,
      company: contact.company,
      title: contact.title,
      domain: contact.domain,
      sourceUrl: `${OUTBOX_V1_SOURCE_PREFIX}${batchId}:${contact.sourceMode}:${index + 1}`,
      realVerifiedEmail: contact.realVerifiedEmail,
      emailVerification: contact.emailVerification,
    }))
  );
  const leadByEmail = new Map(leads.map((lead) => [lead.email.toLowerCase(), lead] as const));
  const scheduledAt = nowIso();
  const messages = await createRunMessages(
    accepted.flatMap((contact, index) => {
      const lead = leadByEmail.get(contact.email.toLowerCase());
      if (!lead) return [];
      const selectedForImmediateSend = index < policy.sendNow;
      return [{
        runId: run.id,
        brandId: input.brandId,
        campaignId: runtimeExperiment.runtime.campaignId,
        leadId: lead.id,
        step: 1,
        subject: renderTemplate(subject, contact),
        body: renderTemplate(body, contact),
        status: "scheduled" as const,
        scheduledAt,
        sourceType: "cadence" as const,
        nodeId: "outbox_v1",
        generationMeta: {
          outboxV1: true,
          batchId,
          sourceMode: contact.sourceMode,
          selectedForImmediateSend,
          holdReason: selectedForImmediateSend ? "" : "sender_policy_cap",
          originalSourceUrl: contact.originalSourceUrl,
          warnings: contact.warnings,
          finder: contact.finderMeta,
          copyExperiment,
          senderAccountId: account.id,
          senderAccountName: account.name,
          senderFromEmail: getOutreachAccountFromEmail(account).trim(),
          replyToEmail: reply.replyToEmail,
          outboxPolicy: policy,
        },
      }];
    })
  );
  await Promise.all(leads.map((lead, index) => updateRunLead(lead.id, { status: index < policy.sendNow ? "scheduled" : "scheduled" })));
  await createOutreachEvent({
    runId: run.id,
    eventType: "outbox_batch_created",
    payload: {
      batchId,
      batchName,
      sourceMode,
      prospectSourcing: prepared.prospectSourcing,
      finder: prepared.finder,
      acceptedContacts: accepted.length,
      rejectedContacts: allRejected.length,
      senderAccountId: account.id,
      fromEmail: getOutreachAccountFromEmail(account).trim(),
      replyToEmail: reply.replyToEmail,
      policy,
    },
  });

  let sent = 0;
  let failed = 0;
  const sendableMessages = messages.slice(0, policy.sendNow);
  for (const message of sendableMessages) {
    const lead = leads.find((candidate) => candidate.id === message.leadId) ?? null;
    if (!lead?.email) {
      failed += 1;
      await updateRunMessage(message.id, { status: "failed", lastError: "Lead email missing" });
      continue;
    }
    const send = await sendOutreachMessage({
      message,
      account,
      secrets,
      replyToEmail: reply.replyToEmail,
      recipient: lead.email,
      runId: run.id,
      experimentId: run.experimentId,
    });
    const generationMeta = {
      ...message.generationMeta,
      outboxV1: true,
      batchId,
      senderAccountId: account.id,
      senderAccountName: account.name,
      senderFromEmail: getOutreachAccountFromEmail(account).trim(),
      replyToEmail: reply.replyToEmail,
      outboxPolicy: policy,
    };
    if (send.ok) {
      sent += 1;
      const sentAt = nowIso();
      await updateRunMessage(message.id, {
        status: "sent",
        providerMessageId: send.providerMessageId,
        sentAt,
        lastError: "",
        generationMeta,
      });
      await updateRunLead(lead.id, { status: "sent" });
      await createOutreachEvent({
        runId: run.id,
        eventType: "outbox_message_sent",
        payload: {
          batchId,
          messageId: message.id,
          accountId: account.id,
          fromEmail: getOutreachAccountFromEmail(account).trim(),
          recipient: lead.email,
          providerMessageId: send.providerMessageId,
        },
      });
    } else {
      failed += 1;
      await updateRunMessage(message.id, {
        status: "failed",
        lastError: send.error,
        generationMeta,
      });
      await createOutreachEvent({
        runId: run.id,
        eventType: "outbox_dispatch_failed",
        payload: {
          batchId,
          messageId: message.id,
          accountId: account.id,
          fromEmail: getOutreachAccountFromEmail(account).trim(),
          recipient: lead.email,
          error: send.error,
        },
      });
    }
  }

  const refreshed = await refreshOutboxRunMetrics(run);
  return {
    batchId,
    run,
    campaign,
    accepted,
    rejected: allRejected,
    policy,
    messages: refreshed.messages,
    copyExperiment,
    finder: prepared.finder,
    prospectSourcing: prepared.prospectSourcing,
    counts: {
      created: messages.length,
      sourced: prepared.prospectSourcing?.sourced ?? 0,
      found: accepted.length,
      sent,
      failed,
      held: Math.max(0, messages.length - sent - failed),
      rejected: allRejected.length,
    },
  };
}

function outboxEnvFlag(name: string) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function outboxEnvNumber(name: string, fallback: number, min: number, max: number) {
  return clampInt(process.env[name], fallback, min, max);
}

function outboxEnvText(name: string, max = 1000) {
  return compactText(String(process.env[name] ?? "").replace(/\\n/g, "\n"), max);
}

function outboxAutopilotEnabled() {
  return outboxEnvFlag("OUTBOX_AUTOPILOT_ENABLED");
}

function configuredOutboxAutopilotBrandIds() {
  const raw =
    String(process.env.OUTBOX_AUTOPILOT_BRAND_IDS ?? "").trim() ||
    String(process.env.OUTBOX_AUTOPILOT_BRAND_ID ?? "").trim();
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function defaultOutboxAutopilotTargetAudience(brand: BrandRecord) {
  const primaryProfiles = brand.idealCustomerProfiles.filter(Boolean).slice(0, 4);
  const targetMarkets = brand.targetMarkets.filter(Boolean).slice(0, 4);
  const targets = primaryProfiles.length ? primaryProfiles : targetMarkets;
  if (targets.length) {
    return `Find senior decision makers at companies matching these ICPs: ${targets.join("; ")}. Prioritize people likely to own budget for ${brand.product || brand.name}.`;
  }
  return `Find senior decision makers at B2B companies likely to need ${brand.product || brand.name}. Prioritize founders, growth leaders, sales leaders, marketing leaders, and operators with budget authority.`;
}

async function loadOutboxAutopilotBrands(limit: number) {
  const ids = configuredOutboxAutopilotBrandIds();
  if (ids.some((id) => id.toLowerCase() === "all")) {
    return (await listBrands()).slice(0, Math.max(1, limit));
  }
  const brands = await Promise.all(ids.map((id) => getBrandById(id, { includeEmbedded: true })));
  return brands.filter((brand): brand is BrandRecord => Boolean(brand)).slice(0, Math.max(1, limit));
}

function outboxAutopilotSkip(input: {
  brand: BrandRecord;
  reason: string;
  senderAccountId?: string;
  cooldownHours: number;
}): OutboxAutopilotBrandResult {
  return {
    brandId: input.brand.id,
    brandName: input.brand.name,
    action: "skip",
    reason: input.reason,
    senderAccountId: input.senderAccountId ?? "",
    sent: 0,
    held: 0,
    failed: 0,
    sourced: 0,
    found: 0,
    batchId: "",
    cooldownHours: input.cooldownHours,
  };
}

function outboxRunBatchId(run: OutreachRun) {
  const externalRef = String(run.externalRef ?? "").trim();
  return externalRef.startsWith(OUTBOX_V1_EXTERNAL_REF_PREFIX)
    ? externalRef.slice(OUTBOX_V1_EXTERNAL_REF_PREFIX.length)
    : run.id;
}

export async function releaseOutboxHeldMessagesForBrand(
  brandId: string,
  options: {
    senderAccountId?: string;
    limit?: number;
  } = {}
): Promise<OutboxHeldSendResult> {
  const limit = clampInt(options.limit, 25, 1, 100);
  const preferredSenderAccountId = String(options.senderAccountId ?? "").trim();
  const runs = (await listBrandRuns(brandId))
    .filter((run) => isOutboxRunExternalRef(run.externalRef))
    .sort((left, right) => (left.createdAt < right.createdAt ? -1 : 1));
  let runsEvaluated = 0;
  let messagesEvaluated = 0;
  let sent = 0;
  let failed = 0;
  let held = 0;
  let lastReason = "";
  let activeSenderAccountId = preferredSenderAccountId;

  if (!outboundSendingEnabled()) {
    return {
      brandId,
      senderAccountId: preferredSenderAccountId,
      runsEvaluated: 0,
      messagesEvaluated: 0,
      sent: 0,
      failed: 0,
      held: 0,
      skipped: true,
      reason: "outbound_sending_disabled",
    };
  }

  for (const run of runs) {
    if (sent + failed >= limit) break;
    if (preferredSenderAccountId && run.accountId !== preferredSenderAccountId) continue;
    const messages = (await listRunMessages(run.id))
      .filter((message) => message.status === "scheduled")
      .sort((left, right) => (left.scheduledAt < right.scheduledAt ? -1 : 1));
    if (!messages.length) continue;

    runsEvaluated += 1;
    messagesEvaluated += messages.length;
    const account = await getOutreachAccount(run.accountId).catch(() => null);
    if (!account) {
      held += messages.length;
      lastReason = "sender_account_missing";
      continue;
    }
    activeSenderAccountId = account.id;
    const secrets = await getOutreachAccountSecrets(account.id);
    let reply: Awaited<ReturnType<typeof resolveReplyToEmail>>;
    let resolvedSecrets: OutreachAccountSecrets;
    try {
      const ready = await requireOutboxSenderReady({ brandId, account, secrets });
      reply = ready.reply;
      resolvedSecrets = ready.secrets;
    } catch (error) {
      held += messages.length;
      lastReason = error instanceof Error ? error.message : "sender_not_allowed";
      continue;
    }

    const remainingLimit = Math.max(0, limit - sent - failed);
    const policy = await policyForSender({
      brandId,
      account,
      requestedContacts: messages.length,
      requestedSendNow: remainingLimit,
    });
    if (policy.sendNow <= 0) {
      held += messages.length;
      lastReason = policy.reasons[0] ?? "sender_policy_cap";
      continue;
    }

    await updateOutreachRun(run.id, {
      status: "sending",
      pauseReason: "",
      lastError: "",
    });
    const leads = await listRunLeads(run.id);
    const leadById = new Map(leads.map((lead) => [lead.id, lead] as const));
    const sendableMessages = messages.slice(0, policy.sendNow);
    const batchId = outboxRunBatchId(run);

    for (const message of sendableMessages) {
      const lead = leadById.get(message.leadId) ?? null;
      if (!lead?.email) {
        failed += 1;
        await updateRunMessage(message.id, { status: "failed", lastError: "Lead email missing" });
        continue;
      }
      const send = await sendOutreachMessage({
        message,
        account,
        secrets: resolvedSecrets,
        replyToEmail: reply.replyToEmail,
        recipient: lead.email,
        runId: run.id,
        experimentId: run.experimentId,
      });
      const generationMeta = {
        ...message.generationMeta,
        outboxV1: true,
        batchId,
        selectedForImmediateSend: true,
        holdReason: "",
        releasedFromHoldAt: nowIso(),
        senderAccountId: account.id,
        senderAccountName: account.name,
        senderFromEmail: getOutreachAccountFromEmail(account).trim(),
        replyToEmail: reply.replyToEmail,
        outboxPolicy: policy,
      };
      if (send.ok) {
        sent += 1;
        const sentAt = nowIso();
        await updateRunMessage(message.id, {
          status: "sent",
          providerMessageId: send.providerMessageId,
          sentAt,
          lastError: "",
          generationMeta,
        });
        await updateRunLead(lead.id, { status: "sent" });
        await createOutreachEvent({
          runId: run.id,
          eventType: "outbox_held_message_sent",
          payload: {
            batchId,
            messageId: message.id,
            accountId: account.id,
            fromEmail: getOutreachAccountFromEmail(account).trim(),
            recipient: lead.email,
            providerMessageId: send.providerMessageId,
          },
        });
      } else {
        failed += 1;
        await updateRunMessage(message.id, {
          status: "failed",
          lastError: send.error,
          generationMeta,
        });
        await createOutreachEvent({
          runId: run.id,
          eventType: "outbox_held_dispatch_failed",
          payload: {
            batchId,
            messageId: message.id,
            accountId: account.id,
            fromEmail: getOutreachAccountFromEmail(account).trim(),
            recipient: lead.email,
            error: send.error,
          },
        });
      }
    }
    const refreshed = await refreshOutboxRunMetrics(run);
    held += refreshed.messages.filter((message) => message.status === "scheduled").length;
  }

  return {
    brandId,
    senderAccountId: activeSenderAccountId,
    runsEvaluated,
    messagesEvaluated,
    sent,
    failed,
    held,
    skipped: runsEvaluated === 0,
    reason: sent > 0 ? "released_held_messages" : lastReason || "no_held_messages",
  };
}

export async function runOutboxAutopilotTick(limit = 1): Promise<OutboxAutopilotTickResult> {
  const enabled = outboxAutopilotEnabled();
  if (!enabled) {
    return {
      enabled: false,
      brandsConfigured: configuredOutboxAutopilotBrandIds().length,
      brandsProcessed: 0,
      launched: 0,
      releasedHeld: 0,
      sent: 0,
      held: 0,
      failed: 0,
      results: [],
    };
  }

  const maxBrands = clampInt(limit, 1, 1, 10);
  const brands = await loadOutboxAutopilotBrands(maxBrands);
  const senderAccountId = outboxEnvText("OUTBOX_AUTOPILOT_SENDER_ACCOUNT_ID", 120);
  const maxProspects = outboxEnvNumber("OUTBOX_AUTOPILOT_MAX_PROSPECTS", 50, 1, 100);
  const requestedSendNow = outboxEnvNumber("OUTBOX_AUTOPILOT_REQUESTED_SEND_NOW", 25, 0, 100);
  const cooldownHours = outboxEnvNumber(
    "OUTBOX_AUTOPILOT_MIN_HOURS_BETWEEN_BATCHES",
    DEFAULT_OUTBOX_AUTOPILOT_COOLDOWN_HOURS,
    1,
    168
  );
  const timezone = outboxEnvText("OUTBOX_AUTOPILOT_TIMEZONE", 80) || DEFAULT_TIMEZONE;
  const configuredTargetAudience = outboxEnvText("OUTBOX_AUTOPILOT_TARGET_AUDIENCE", 1000);
  const configuredBatchName = outboxEnvText("OUTBOX_AUTOPILOT_BATCH_NAME", 120);
  const results: OutboxAutopilotBrandResult[] = [];

  for (const brand of brands) {
    try {
      const release = await releaseOutboxHeldMessagesForBrand(brand.id, {
        senderAccountId,
        limit: requestedSendNow || 25,
      });
      if (release.sent > 0 || release.failed > 0) {
        results.push({
          brandId: brand.id,
          brandName: brand.name,
          action: "release_held",
          reason: release.reason,
          senderAccountId: release.senderAccountId,
          sent: release.sent,
          held: release.held,
          failed: release.failed,
          sourced: 0,
          found: 0,
          batchId: "",
          cooldownHours,
        });
        continue;
      }
      if (release.held > 0) {
        results.push(outboxAutopilotSkip({
          brand,
          reason: release.reason || "held_messages_waiting_for_sender_capacity",
          senderAccountId: release.senderAccountId,
          cooldownHours,
        }));
        continue;
      }

      const latestBatch = (await listOutboxBatches(brand.id, 1))[0] ?? null;
      const latestCreatedAtMs = latestBatch ? Date.parse(latestBatch.run.createdAt) : 0;
      const cooldownMs = cooldownHours * 60 * 60 * 1000;
      if (Number.isFinite(latestCreatedAtMs) && latestCreatedAtMs > 0 && Date.now() - latestCreatedAtMs < cooldownMs) {
        results.push(outboxAutopilotSkip({
          brand,
          reason: "cooldown_active",
          senderAccountId,
          cooldownHours,
        }));
        continue;
      }

      if (!outboundSendingEnabled()) {
        results.push(outboxAutopilotSkip({
          brand,
          reason: "outbound_sending_disabled",
          senderAccountId,
          cooldownHours,
        }));
        continue;
      }

      const senders = await senderOptionsForBrand(brand.id);
      const senderChoice = await chooseOutboxAutopilotSender({
        brandId: brand.id,
        senders,
        preferredSenderAccountId: senderAccountId,
        requestedContacts: maxProspects,
        requestedSendNow: requestedSendNow || maxProspects,
      });
      if (!senderChoice.choice) {
        results.push(outboxAutopilotSkip({
          brand,
          reason: senderChoice.reason,
          senderAccountId: senderChoice.senderAccountId,
          cooldownHours,
        }));
        continue;
      }
      const selectedSender = senderChoice.choice.sender;
      const policy = senderChoice.choice.policy;
      if (policy.availableNow <= 0) {
        const reason =
          policy.reasons[0] ||
          `sender_capacity_unavailable:${policy.senderState}:sent_today_${policy.sentToday}:daily_cap_${policy.dailyCap}:available_now_${policy.availableNow}`;
        results.push(outboxAutopilotSkip({
          brand,
          reason,
          senderAccountId: selectedSender.accountId,
          cooldownHours,
        }));
        continue;
      }

      const launchSendNow = Math.min(requestedSendNow || 25, policy.availableNow);
      const launchMaxProspects = outboxAutopilotProspectRequestSize({
        maxProspects,
        sendNow: launchSendNow,
        availableNow: policy.availableNow,
      });
      const launch = await launchOutboxBatch({
        brandId: brand.id,
        senderAccountId: selectedSender.accountId,
        batchName: configuredBatchName || `Autopilot ${new Date().toLocaleDateString("en-US")}`,
        sourceMode: "auto",
        prospectQuery: configuredTargetAudience || defaultOutboxAutopilotTargetAudience(brand),
        prospectOffer: brand.product || brand.name,
        maxProspects: launchMaxProspects,
        subject: "",
        body: "",
        requestedSendNow: launchSendNow,
        timezone,
      });
      results.push({
        brandId: brand.id,
        brandName: brand.name,
        action: "launch",
        reason: "auto_sourced_batch_launched",
        senderAccountId: selectedSender.accountId,
        sent: launch.counts.sent,
        held: launch.counts.held,
        failed: launch.counts.failed,
        sourced: launch.counts.sourced,
        found: launch.counts.found,
        batchId: launch.batchId,
        cooldownHours,
      });
    } catch (error) {
      results.push({
        brandId: brand.id,
        brandName: brand.name,
        action: "error",
        reason: error instanceof Error ? error.message : "outbox_autopilot_failed",
        senderAccountId,
        sent: 0,
        held: 0,
        failed: 1,
        sourced: 0,
        found: 0,
        batchId: "",
        cooldownHours,
      });
    }
  }

  return {
    enabled: true,
    brandsConfigured: brands.length,
    brandsProcessed: results.length,
    launched: results.filter((result) => result.action === "launch").length,
    releasedHeld: results.filter((result) => result.action === "release_held").length,
    sent: results.reduce((total, result) => total + result.sent, 0),
    held: results.reduce((total, result) => total + result.held, 0),
    failed: results.reduce((total, result) => total + result.failed, 0),
    results,
  };
}
