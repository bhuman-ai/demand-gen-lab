import {
  ensureRuntimeForExperiment,
  getExperimentRecordById,
  updateExperimentRecord,
} from "@/lib/experiment-data";
import {
  createOutreachEvent,
  createOutreachRun,
  getBrandOutreachAssignment,
  listOwnerRuns,
  listRunLeads,
  updateOutreachRun,
  upsertRunLeads,
} from "@/lib/outreach-data";
import {
  enrichLeadsWithEmailFinderBatch,
  extractFirstEmailAddress,
  resolveEmailFinderApiBaseUrl,
  type ApifyLead,
} from "@/lib/outreach-providers";
import { assessReportCommentLeadQuality } from "@/lib/report-comment-lead-quality";

type SelectionLeadCandidate = {
  rowNumber: number;
  lead: ApifyLead;
};

type ImportedLead = {
  email: string;
  name: string;
  company: string;
  title: string;
  domain: string;
  sourceUrl: string;
};

export type ImportExperimentProspectRowsResult = {
  runId: string;
  status: "completed";
  attemptedCount: number;
  importedCount: number;
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
};

export type ExperimentSendableLeadSummary = {
  sendableLeadCount: number;
  runsChecked: number;
};

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
  "semrush.com",
  "hubspot.com",
  "theorg.com",
  "twine.net",
];

function normalizeCell(value: unknown) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized === "null" ? "" : normalized;
}

function normalizeHeaderKey(value: string) {
  return normalizeCell(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
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

function domainFromEmailOrUrl(email: string, source: string) {
  const normalizedEmail = extractFirstEmailAddress(email);
  if (normalizedEmail.includes("@")) {
    return normalizeDomainCandidate(normalizedEmail);
  }
  return normalizeDomainCandidate(source);
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

export function deriveCompanyFromDomain(domain: string) {
  const normalized = normalizeDomainCandidate(domain);
  if (!normalized || isNonCompanyProfileDomain(normalized)) {
    return "";
  }

  const hostParts = normalized.split(".");
  const root = hostParts.length > 1 ? hostParts[hostParts.length - 2] : hostParts[0];
  const humanized = root.replace(/[-_]+/g, " ").replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
  if (!humanized) {
    return "";
  }

  return titleCaseWords(humanized);
}

function companyKeyFromLead(input: {
  domain?: string;
  company?: string;
  email?: string;
  sourceUrl?: string;
}) {
  const domain = normalizeDomainCandidate(
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

function extractFirstUrlish(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const urlMatch = raw.match(/https?:\/\/[^\s,\]]+/i);
  if (urlMatch?.[0]) return urlMatch[0];

  const parts = raw
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
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
  const directDomain = firstValue(values, [
    "domain",
    "companydomain",
    "website",
    "companywebsite",
    "companyurl",
    "websiteurl",
  ]);
  const websiteDomain = domainFromEmailOrUrl(
    "",
    firstValue(values, ["companywebsite", "companyurl", "website"])
  );
  const sourceDomain = domainFromEmailOrUrl("", sourceUrl);
  const emailDomain = domainFromEmailOrUrl(email, "");

  for (const candidate of [directDomain, websiteDomain, sourceDomain, emailDomain]) {
    const normalized = normalizeDomainCandidate(candidate);
    if (!normalized || isNonCompanyProfileDomain(normalized)) {
      continue;
    }
    return normalized;
  }

  return "";
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
    const email = extractFirstEmailAddress(rawEmail);
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

    if (rawEmail && !email && (!name || !domain)) {
      errors.push(`Row ${rowNumber}: invalid email "${rawEmail}".`);
      return;
    }

    if (!email && !name) {
      errors.push(`Row ${rowNumber}: missing person name or email.`);
      return;
    }

    if (!email && !domain) {
      errors.push(`Row ${rowNumber}: missing email or usable company domain.`);
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
    });
  });

  return { candidates, errors };
}

function emailFinderApiBaseUrl(origin: string) {
  return `${origin.replace(/\/+$/, "")}/api/internal/email-finder`;
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

  const parsed = parseSelectionLeads(rows);
  if (!parsed.candidates.length) {
    const firstError = parsed.errors[0] ?? "";
    throw new Error(firstError || "No importable prospects were found.");
  }

  const validatedMailsApiKey = String(
    process.env.EMAIL_FINDER_VALIDATEDMAILS_API_KEY ??
      process.env.ENRICHANYTHING_VALIDATEDMAILS_API_KEY ??
      process.env.VALIDATEDMAILS_API_KEY ??
      ""
  ).trim();
  const apiBaseUrl = resolveEmailFinderApiBaseUrl(
    input.emailFinderApiBaseUrl ||
      (input.requestOrigin ? emailFinderApiBaseUrl(input.requestOrigin) : "")
  );

  const enrichment = await enrichLeadsWithEmailFinderBatch({
    leads: parsed.candidates.map((entry) => entry.lead),
    apiBaseUrl,
    verificationMode: "validatedmails",
    validatedMailsApiKey,
    maxCandidates: 12,
    maxCredits: 7,
    concurrency: 3,
    allowBestGuessFallback: true,
    minBestGuessPValid: 0.58,
  });

  const parseErrors = [...parsed.errors];
  if (enrichment.error.trim()) {
    parseErrors.push(enrichment.error.trim());
  }

  const finalLeads = enrichment.leads.flatMap((lead, index) => {
    const candidate = parsed.candidates[index];
    const email = extractFirstEmailAddress(lead.email);
    if (!email) {
      const label = candidate?.lead.name || candidate?.lead.company || candidate?.lead.domain || "this row";
      parseErrors.push(`Row ${candidate?.rowNumber ?? index + 1}: no usable work email for ${label}.`);
      return [];
    }

    const domain = normalizeDomainCandidate(lead.domain || email);
    if (!domain || isNonCompanyProfileDomain(domain)) {
      const label = candidate?.lead.name || candidate?.lead.company || domain || "this row";
      parseErrors.push(
        `Row ${candidate?.rowNumber ?? index + 1}: skipped ${label} because the source domain is a marketplace, directory, or profile host.`
      );
      return [];
    }

    const importedLead = {
      email,
      name: normalizeCell(lead.name),
      company: normalizeCell(lead.company) || deriveCompanyFromDomain(domain),
      title: normalizeCell(lead.title),
      domain,
      sourceUrl: normalizeCell(lead.sourceUrl),
    } satisfies ImportedLead;

    const quality = assessReportCommentLeadQuality(experiment, importedLead);
    if (!quality.keep) {
      const label = importedLead.name || importedLead.company || importedLead.domain || "this row";
      parseErrors.push(
        `Row ${candidate?.rowNumber ?? index + 1}: skipped ${label} because it does not look like a strong expert-fit lead for this report (${quality.reason}).`
      );
      return [];
    }

    return [importedLead];
  });

  if (!finalLeads.length) {
    return {
      runId: "",
      status: "completed",
      attemptedCount: parsed.candidates.length,
      importedCount: 0,
      skippedCount: Math.max(0, parsed.candidates.length),
      matchedCount: enrichment.matched,
      dedupedCount: 0,
      parseErrorCount: parseErrors.length,
      parseErrors: parseErrors.slice(0, 20),
      enrichmentError: enrichment.error,
      failureSummary: enrichment.failureSummary,
      autoLaunchAttempted: false,
      autoLaunchTriggered: false,
      autoLaunchBlocked: false,
      autoLaunchRunId: "",
      autoLaunchReason: "",
    };
  }

  const existingRuns = await listOwnerRuns(input.brandId, "experiment", experiment.id);
  const existingLeadLists = await Promise.all(existingRuns.map((run) => listRunLeads(run.id)));
  const existingEmails = new Set(
    existingLeadLists
      .flat()
      .map((lead) => String(lead.email ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
  const oneContactPerCompany = experiment.testEnvelope.oneContactPerCompany !== false;
  const existingCompanyKeys = new Set(
    oneContactPerCompany
      ? existingLeadLists
          .flat()
          .map((lead) => companyKeyFromLead(lead))
          .filter(Boolean)
      : []
  );
  const newLeads: ImportedLead[] = [];
  let dedupedCount = 0;

  for (const lead of finalLeads) {
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
    if (companyKey) {
      existingCompanyKeys.add(companyKey);
    }
  }

  if (!newLeads.length) {
    return {
      runId: "",
      status: "completed",
      attemptedCount: parsed.candidates.length,
      importedCount: 0,
      skippedCount: Math.max(0, parsed.candidates.length),
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
    };
  }

  const assignment = await getBrandOutreachAssignment(input.brandId);
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

  const imported = await upsertRunLeads(
    run.id,
    input.brandId,
    experiment.runtime.campaignId,
    newLeads
  );

  await updateOutreachRun(run.id, {
    status: "completed",
    metrics: {
      sourcedLeads: imported.length,
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
      importedCount: imported.length,
      attemptedCount: parsed.candidates.length,
      skippedCount: Math.max(0, parsed.candidates.length - imported.length),
      matchedCount: enrichment.matched,
      dedupedCount,
      parseErrorCount: parseErrors.length,
      source: "enrichanything_embed",
      tableTitle: normalizeCell(input.tableTitle),
      prompt: normalizeCell(input.prompt),
      entityType: normalizeCell(input.entityType),
    },
  });

  await updateExperimentRecord(input.brandId, experiment.id, {
    status: imported.length > 0 ? "ready" : experiment.status,
  });

  return {
    runId: run.id,
    status: "completed",
    attemptedCount: parsed.candidates.length,
    importedCount: imported.length,
    skippedCount: Math.max(0, parsed.candidates.length - imported.length),
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
      runsChecked: 0,
    };
  }

  const leadLists = await Promise.all(runs.map((run) => listRunLeads(run.id)));
  const emails = new Set<string>();

  for (const lead of leadLists.flat()) {
    if (lead.status === "suppressed") continue;
    const email = extractFirstEmailAddress(lead.email).toLowerCase();
    if (!email) continue;
    const domain = normalizeDomainCandidate(lead.domain || email);
    if (!domain || isNonCompanyProfileDomain(domain)) {
      continue;
    }
    emails.add(email);
  }

  return {
    sendableLeadCount: emails.size,
    runsChecked: runs.length,
  };
}
