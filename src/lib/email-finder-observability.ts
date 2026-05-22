import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const isVercel = Boolean(process.env.VERCEL);
const CACHE_PATH = isVercel
  ? "/tmp/email-finder-cache.v1.json"
  : path.join(process.cwd(), "data", "email-finder-cache.v1.json");
const AUDIT_PATH = isVercel
  ? "/tmp/email-finder-audit.v1.json"
  : path.join(process.cwd(), "data", "email-finder-audit.v1.json");
const FALLBACK_AUDIT_PATH = isVercel
  ? "/tmp/email-finder-fallback-audit.v1.json"
  : path.join(process.cwd(), "data", "email-finder-fallback-audit.v1.json");
const MAX_AUDIT_ENTRIES = 500;
const MAX_FALLBACK_AUDIT_ENTRIES = 2_000;

type CachedValidatedMailsOutcome = {
  email: string;
  verdict: string;
  confidence: string;
  details: Record<string, unknown>;
  updatedAt: string;
};

type EmailFinderAuditEntry = {
  requestId: string;
  source: string;
  context: Record<string, unknown>;
  itemCount: number;
  resultsCount: number;
  okCount: number;
  failedCount: number;
  matchedCount: number;
  failedIds: string[];
  verificationModeRequested: string;
  verificationModesUsed: string[];
  maxCreditsPerLead: number;
  timeoutSeconds: number;
  concurrency: number;
  continueOnError: boolean;
  creditsUsed: number;
  cacheHits: number;
  cacheHitLeads: number;
  createdAt: string;
};

type EmailFinderFallbackAuditEntry = {
  requestId: string;
  source: string;
  context: Record<string, unknown>;
  leadId: string;
  leadName: string;
  domain: string;
  candidateEmail: string;
  attempt: number;
  verificationMode: string;
  localVerificationEnabled: boolean;
  localVerifierSource: string;
  localProvider: string;
  localVerdict: string;
  localConfidence: string;
  localReason: string;
  localPaidUsed: boolean;
  fallbackReason: string;
  creditsUsedBefore: number;
  maxCredits: number;
  validatedMailsBilled: boolean;
  validatedMailsCacheHit: boolean;
  validatedMailsVerdict: string;
  validatedMailsConfidence: string;
  validatedMailsReason: string;
  finalVerdict: string;
  finalConfidence: string;
  createdAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

async function ensureParentDirectory(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeJsonArray<T>(filePath: string, rows: T[]) {
  await ensureParentDirectory(filePath);
  await writeFile(filePath, JSON.stringify(rows, null, 2));
}

export async function getCachedValidatedMailsOutcome(email: string): Promise<{
  verdict: string;
  confidence: string;
  details: Record<string, unknown>;
} | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const rows = await readJsonArray<CachedValidatedMailsOutcome>(CACHE_PATH);
  const hit = rows.find((row) => row.email === normalizedEmail) ?? null;
  if (!hit) return null;
  return {
    verdict: hit.verdict,
    confidence: hit.confidence,
    details: { ...(hit.details ?? {}) },
  };
}

export async function setCachedValidatedMailsOutcome(input: {
  email: string;
  verdict: string;
  confidence: string;
  details: Record<string, unknown>;
}): Promise<void> {
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) return;

  const rows = await readJsonArray<CachedValidatedMailsOutcome>(CACHE_PATH);
  const nextRow: CachedValidatedMailsOutcome = {
    email: normalizedEmail,
    verdict: input.verdict,
    confidence: input.confidence,
    details: { ...(input.details ?? {}) },
    updatedAt: nowIso(),
  };
  const deduped = rows.filter((row) => row.email !== normalizedEmail);
  deduped.unshift(nextRow);
  await writeJsonArray(CACHE_PATH, deduped);
}

export async function appendEmailFinderAuditEntry(input: {
  requestId: string;
  source: string;
  context: Record<string, unknown>;
  itemCount: number;
  resultsCount: number;
  okCount: number;
  failedCount: number;
  matchedCount: number;
  failedIds: string[];
  verificationModeRequested: string;
  verificationModesUsed: string[];
  maxCreditsPerLead: number;
  timeoutSeconds: number;
  concurrency: number;
  continueOnError: boolean;
  creditsUsed: number;
  cacheHits: number;
  cacheHitLeads: number;
}): Promise<void> {
  const rows = await readJsonArray<EmailFinderAuditEntry>(AUDIT_PATH);
  const nextRow: EmailFinderAuditEntry = {
    ...input,
    context: { ...(input.context ?? {}) },
    failedIds: [...(input.failedIds ?? [])],
    verificationModesUsed: [...(input.verificationModesUsed ?? [])],
    createdAt: nowIso(),
  };
  rows.unshift(nextRow);
  await writeJsonArray(AUDIT_PATH, rows.slice(0, MAX_AUDIT_ENTRIES));
}

export async function appendEmailFinderFallbackAuditEntry(input: {
  requestId: string;
  source: string;
  context: Record<string, unknown>;
  leadId: string;
  leadName: string;
  domain: string;
  candidateEmail: string;
  attempt: number;
  verificationMode: string;
  localVerificationEnabled: boolean;
  localVerifierSource: string;
  localProvider: string;
  localVerdict: string;
  localConfidence: string;
  localReason: string;
  localPaidUsed: boolean;
  fallbackReason: string;
  creditsUsedBefore: number;
  maxCredits: number;
  validatedMailsBilled: boolean;
  validatedMailsCacheHit: boolean;
  validatedMailsVerdict: string;
  validatedMailsConfidence: string;
  validatedMailsReason: string;
  finalVerdict: string;
  finalConfidence: string;
}): Promise<void> {
  const rows = await readJsonArray<EmailFinderFallbackAuditEntry>(FALLBACK_AUDIT_PATH);
  const nextRow: EmailFinderFallbackAuditEntry = {
    ...input,
    context: { ...(input.context ?? {}) },
    createdAt: nowIso(),
  };
  rows.unshift(nextRow);
  await writeJsonArray(FALLBACK_AUDIT_PATH, rows.slice(0, MAX_FALLBACK_AUDIT_ENTRIES));
}
