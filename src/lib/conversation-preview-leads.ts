import type {
  ConversationPreviewLead,
  OutreachRun,
  OutreachRunLead,
} from "@/lib/factory-types";
import { getExperimentRecordByRuntimeRef } from "@/lib/experiment-data";
import {
  enrichLeadsWithEmailFinderBatch,
  extractFirstEmailAddress,
  getLeadEmailSuppressionReason,
  isPreviewPlaceholderEmail,
  resolveEmailFinderApiBaseUrl,
} from "@/lib/outreach-providers";
import { listExperimentRuns, listOwnerRuns, listRunLeads } from "@/lib/outreach-data";

export type SourcedConversationPreviewLead = ConversationPreviewLead & {
  runId: string;
  runCreatedAt: string;
  sourceUrl: string;
  source: "sourced";
};

export type PreviewEmailEnrichmentSummary = {
  attempted: number;
  matched: number;
  failed: number;
  provider: string;
  error: string;
};

type PreviewLeadQueryInput = {
  brandId: string;
  campaignId: string;
  experimentId: string;
  limit?: number;
  maxRuns?: number;
};

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "yahoo.com",
  "aol.com",
  "protonmail.com",
]);

const ROLE_INBOX_LOCAL_PARTS = new Set([
  "admin",
  "billing",
  "compliance",
  "contact",
  "customersuccess",
  "datarequest",
  "dpo",
  "gdpr",
  "hello",
  "help",
  "info",
  "legal",
  "marketing",
  "office",
  "privacy",
  "sales",
  "security",
  "support",
  "team",
]);

function safeDateValue(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function extractNameFromUrl(urlLike: string) {
  const raw = String(urlLike ?? "").trim();
  if (!raw) return "";
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw;
  const params = new URLSearchParams(query);
  const firstName =
    params.get("firstName") ??
    params.get("firstname") ??
    params.get("first_name") ??
    params.get("fname") ??
    "";
  const lastName =
    params.get("lastName") ??
    params.get("lastname") ??
    params.get("last_name") ??
    params.get("lname") ??
    "";

  const normalizedFirst = firstName.trim();
  const normalizedLast = lastName.trim();
  const combined = `${normalizedFirst} ${normalizedLast}`.trim();
  if (!combined) return "";
  return combined
    .split(/\s+/)
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : ""))
    .join(" ");
}

function looksLikeRoleInboxEmail(email: string) {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized.includes("@")) return false;
  const local = normalized.split("@")[0] ?? "";
  if (!local) return false;
  if (ROLE_INBOX_LOCAL_PARTS.has(local)) return true;
  if (local.endsWith("support") || local.endsWith("info") || local.endsWith("team")) return true;
  return false;
}

function isLikelyPersonName(name: string) {
  const normalized = String(name ?? "").trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  if (lower.includes("@")) return false;
  if (lower.includes("http://") || lower.includes("https://")) return false;
  if (["unknown", "n/a", "na", "none", "test", "example"].includes(lower)) return false;
  const alphaChars = normalized.replace(/[^a-zA-Z]/g, "");
  if (alphaChars.length < 2) return false;
  if (/\d{3,}/.test(normalized)) return false;
  return true;
}

function defaultPreviewEmailEnrichment(): PreviewEmailEnrichmentSummary {
  return {
    attempted: 0,
    matched: 0,
    failed: 0,
    provider: "emailfinder.batch",
    error: "",
  };
}

function previewProfileKey(lead: Pick<SourcedConversationPreviewLead, "name" | "domain" | "company">) {
  return `${String(lead.name ?? "").trim().toLowerCase()}|${String(lead.domain ?? "")
    .trim()
    .toLowerCase()}|${String(lead.company ?? "").trim().toLowerCase()}`;
}

function prioritizeAndDedupePreviewLeads(leads: SourcedConversationPreviewLead[]) {
  const ranked = [...leads].sort((left, right) => {
    const leftHasEmail = Number(Boolean(left.email.trim()));
    const rightHasEmail = Number(Boolean(right.email.trim()));
    if (leftHasEmail !== rightHasEmail) return rightHasEmail - leftHasEmail;
    const runDelta = safeDateValue(right.runCreatedAt) - safeDateValue(left.runCreatedAt);
    if (runDelta !== 0) return runDelta;
    return left.name.localeCompare(right.name);
  });

  const out = [] as SourcedConversationPreviewLead[];
  const seenEmails = new Set<string>();
  const seenProfiles = new Set<string>();
  for (const lead of ranked) {
    const email = extractFirstEmailAddress(lead.email);
    const profileKey = previewProfileKey(lead);
    if (email && seenEmails.has(email)) continue;
    if (profileKey && seenProfiles.has(profileKey)) continue;
    if (email) seenEmails.add(email);
    if (profileKey) seenProfiles.add(profileKey);
    out.push({
      ...lead,
      email,
    });
  }
  return out;
}

async function enrichPreviewLeadsWithRealEmails(
  leads: SourcedConversationPreviewLead[]
): Promise<{
  leads: SourcedConversationPreviewLead[];
  previewEmailEnrichment: PreviewEmailEnrichmentSummary;
}> {
  const previewEmailEnrichment = defaultPreviewEmailEnrichment();
  const pending = leads
    .map((lead, index) => ({ lead, index }))
    .filter(
      (entry) =>
        !entry.lead.email.trim() &&
        Boolean(entry.lead.name.trim()) &&
        Boolean(entry.lead.domain.trim()) &&
        entry.lead.domain.includes(".")
    )
    .slice(0, 50);

  if (!pending.length) {
    return { leads, previewEmailEnrichment };
  }

  const apiBaseUrl = resolveEmailFinderApiBaseUrl();
  if (!apiBaseUrl) {
    return {
      leads,
      previewEmailEnrichment: {
        ...previewEmailEnrichment,
        error: "EMAIL_FINDER_API_BASE_URL is missing",
      },
    };
  }

  const enrichment = await enrichLeadsWithEmailFinderBatch({
    leads: pending.map(({ lead }) => ({
      email: "",
      name: lead.name,
      company: lead.company,
      title: lead.title,
      domain: lead.domain,
      sourceUrl: lead.sourceUrl,
    })),
    apiBaseUrl,
    verificationMode: "validatedmails",
    validatedMailsApiKey: String(
      process.env.EMAIL_FINDER_VALIDATEDMAILS_API_KEY ?? process.env.VALIDATEDMAILS_API_KEY ?? ""
    ).trim(),
    maxCandidates: 12,
    maxCredits: 7,
    concurrency: 3,
    timeoutMs: Math.max(
      10_000,
      Math.min(90_000, Number(process.env.EMAIL_FINDER_TIMEOUT_MS ?? 45_000) || 45_000)
    ),
  });

  const nextLeads = [...leads];
  for (const [pendingIndex, candidate] of pending.entries()) {
    const enriched = enrichment.leads[pendingIndex];
    const resolvedEmail = extractFirstEmailAddress(enriched?.email ?? "");
    if (!resolvedEmail) continue;
    if (getLeadEmailSuppressionReason(resolvedEmail)) continue;
    if (looksLikeRoleInboxEmail(resolvedEmail)) continue;
    nextLeads[candidate.index] = {
      ...nextLeads[candidate.index],
      email: resolvedEmail,
      domain: String(enriched?.domain ?? nextLeads[candidate.index]?.domain ?? "")
        .trim()
        .toLowerCase(),
    };
  }

  return {
    leads: nextLeads,
    previewEmailEnrichment: {
      attempted: enrichment.attempted,
      matched: enrichment.matched,
      failed: enrichment.failed,
      provider: enrichment.provider,
      error: enrichment.error,
    },
  };
}

function dedupeAndNormalizeLeads(input: {
  rows: Array<{ run: OutreachRun; lead: OutreachRunLead }>;
  limit: number;
}) {
  const out = [] as SourcedConversationPreviewLead[];
  const seen = new Set<string>();

  for (const row of input.rows) {
    if (["suppressed", "bounced", "unsubscribed"].includes(String(row.lead.status ?? "").toLowerCase())) continue;
    const rawEmail = String(row.lead.email ?? "").trim();
    const sourceUrl = String(row.lead.sourceUrl ?? "").trim();
    const resolvedEmail = extractFirstEmailAddress(rawEmail || sourceUrl);
    const isPlaceholder = isPreviewPlaceholderEmail(resolvedEmail);
    const email = isPlaceholder ? "" : resolvedEmail;
    if (!isPlaceholder) {
      if (!email) continue;
      if (getLeadEmailSuppressionReason(email)) continue;
      if (looksLikeRoleInboxEmail(email)) continue;
    }

    const domainFromEmail = resolvedEmail.includes("@") ? resolvedEmail.split("@")[1] ?? "" : "";
    const domain = String(row.lead.domain ?? "").trim().toLowerCase() || domainFromEmail;
    if (!domain) continue;
    if (FREE_EMAIL_DOMAINS.has(domain)) continue;

    const name = String(row.lead.name ?? "").trim() || extractNameFromUrl(rawEmail) || extractNameFromUrl(sourceUrl);
    const company = String(row.lead.company ?? "").trim();
    if (!name || !company) continue;
    if (!isLikelyPersonName(name)) continue;

    const dedupeKey = email
      ? `email:${email}`
      : `profile:${name.toLowerCase()}:${domain}:${company.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      id: String(row.lead.id ?? `${row.run.id}:${dedupeKey}`).trim(),
      runId: row.run.id,
      runCreatedAt: row.run.createdAt,
      email,
      name,
      company,
      title: String(row.lead.title ?? "").trim(),
      domain,
      sourceUrl,
      source: "sourced",
    });
    if (out.length >= input.limit) break;
  }

  return out;
}

export async function listConversationPreviewLeads(input: PreviewLeadQueryInput) {
  const limit = Math.max(1, Math.min(50, Number(input.limit ?? 12) || 12));
  const maxRuns = Math.max(1, Math.min(30, Number(input.maxRuns ?? 1) || 1));

  const sourceExperiment = await getExperimentRecordByRuntimeRef(
    input.brandId,
    input.campaignId,
    input.experimentId
  );
  if (!sourceExperiment) {
    return {
      leads: [] as SourcedConversationPreviewLead[],
      sourceExperimentId: "",
      runtimeRefFound: false,
      runsChecked: 0,
      qualifiedLeadCount: 0,
      qualifiedLeadWithEmailCount: 0,
      qualifiedLeadWithoutEmailCount: 0,
      previewEmailEnrichment: defaultPreviewEmailEnrichment(),
    };
  }

  let runs = [] as OutreachRun[];
  try {
    runs = await listOwnerRuns(input.brandId, "experiment", sourceExperiment.id);
  } catch {
    runs = [];
  }
  if (!runs.length) {
    try {
      runs = await listExperimentRuns(input.brandId, input.campaignId, input.experimentId);
    } catch {
      runs = [];
    }
  }
  if (!runs.length) {
    return {
      leads: [] as SourcedConversationPreviewLead[],
      sourceExperimentId: sourceExperiment.id,
      runtimeRefFound: true,
      runsChecked: 0,
      qualifiedLeadCount: 0,
      qualifiedLeadWithEmailCount: 0,
      qualifiedLeadWithoutEmailCount: 0,
      previewEmailEnrichment: defaultPreviewEmailEnrichment(),
    };
  }

  const recentRuns = [...runs]
    .sort((a, b) => safeDateValue(b.createdAt) - safeDateValue(a.createdAt))
    .slice(0, maxRuns);
  const latestRun = recentRuns[0];
  const sourceRuns =
    latestRun &&
    !["failed", "preflight_failed", "canceled"].includes(String(latestRun.status ?? "").toLowerCase()) &&
    Number(latestRun.metrics?.sourcedLeads ?? 0) > 0
      ? [latestRun]
      : [];
  if (!sourceRuns.length) {
    return {
      leads: [] as SourcedConversationPreviewLead[],
      sourceExperimentId: sourceExperiment.id,
      runtimeRefFound: true,
      runsChecked: latestRun ? 1 : 0,
      qualifiedLeadCount: 0,
      qualifiedLeadWithEmailCount: 0,
      qualifiedLeadWithoutEmailCount: 0,
      previewEmailEnrichment: defaultPreviewEmailEnrichment(),
    };
  }
  const selectedRuns = sourceRuns;

  const runLeads = await Promise.all(
    selectedRuns.map(async (run) => ({
      run,
      leads: await listRunLeads(run.id),
    }))
  );

  const rows = [] as Array<{ run: OutreachRun; lead: OutreachRunLead }>;
  for (const entry of runLeads) {
    for (const lead of entry.leads) {
      rows.push({ run: entry.run, lead });
    }
  }

  const baseQualifiedLeads = dedupeAndNormalizeLeads({
    rows,
    limit: Math.max(limit, rows.length + 25),
  });
  const enrichedPreview = await enrichPreviewLeadsWithRealEmails(baseQualifiedLeads);
  const allQualifiedLeads = prioritizeAndDedupePreviewLeads(enrichedPreview.leads);
  const leads = allQualifiedLeads.slice(0, limit);
  const qualifiedLeadCount = allQualifiedLeads.length;
  const qualifiedLeadWithEmailCount = allQualifiedLeads.filter((lead) => Boolean(lead.email.trim())).length;
  const qualifiedLeadWithoutEmailCount = Math.max(0, qualifiedLeadCount - qualifiedLeadWithEmailCount);
  return {
    leads,
    sourceExperimentId: sourceExperiment.id,
    runtimeRefFound: true,
    runsChecked: selectedRuns.length,
    qualifiedLeadCount,
    qualifiedLeadWithEmailCount,
    qualifiedLeadWithoutEmailCount,
    previewEmailEnrichment: enrichedPreview.previewEmailEnrichment,
  };
}
