import { NextResponse } from "next/server";
import {
  ensureRuntimeForExperiment,
  getExperimentRecordById,
  updateExperimentRecord,
} from "@/lib/experiment-data";
import {
  createOutreachEvent,
  createOutreachRun,
  getBrandOutreachAssignment,
  updateOutreachRun,
  upsertRunLeads,
} from "@/lib/outreach-data";
import {
  enrichLeadsWithEmailFinderBatch,
  extractFirstEmailAddress,
  type ApifyLead,
} from "@/lib/outreach-providers";

type SelectionLeadCandidate = {
  rowNumber: number;
  lead: ApifyLead;
};

const NON_COMPANY_PROFILE_ROOTS = [
  "linkedin.com",
  "linkedin.co",
  "facebook.com",
  "x.com",
  "twitter.com",
  "instagram.com",
];

function normalizeCell(value: unknown) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized === "null" ? "" : normalized;
}

function normalizeHeaderKey(value: string) {
  return normalizeCell(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isNonCompanyProfileDomain(domain: string) {
  const normalized = domain.trim().toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
  if (!normalized) return false;
  return NON_COMPANY_PROFILE_ROOTS.some(
    (root) => normalized === root || normalized.endsWith(`.${root}`)
  );
}

function normalizeDomainCandidate(value: unknown) {
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

function emailFinderApiBaseUrl(request: Request) {
  const url = new URL(request.url);
  return `${url.origin}/api/internal/email-finder`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;
  const existing = await getExperimentRecordById(brandId, experimentId);
  if (!existing) {
    return NextResponse.json({ error: "experiment not found" }, { status: 404 });
  }

  const experiment = await ensureRuntimeForExperiment(existing);
  if (!experiment.runtime.campaignId || !experiment.runtime.experimentId || !experiment.runtime.hypothesisId) {
    return NextResponse.json({ error: "experiment runtime is not configured" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) {
    return NextResponse.json({ error: "rows are required" }, { status: 400 });
  }

  const parsed = parseSelectionLeads(rows);
  if (!parsed.candidates.length) {
    return NextResponse.json(
      {
        error: "No importable prospects were found.",
        hint: "Each row needs a work email, or a person name plus a usable company domain.",
        parseErrors: parsed.errors.slice(0, 20),
      },
      { status: 400 }
    );
  }

  const validatedMailsApiKey = String(
    process.env.EMAIL_FINDER_VALIDATEDMAILS_API_KEY ?? process.env.VALIDATEDMAILS_API_KEY ?? ""
  ).trim();

  const enrichment = await enrichLeadsWithEmailFinderBatch({
    leads: parsed.candidates.map((entry) => entry.lead),
    apiBaseUrl: emailFinderApiBaseUrl(request),
    verificationMode: "validatedmails",
    validatedMailsApiKey,
    maxCandidates: 12,
    maxCredits: 7,
    concurrency: 3,
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
      parseErrors.push(`Row ${candidate?.rowNumber ?? index + 1}: no verified work email for ${label}.`);
      return [];
    }

    return [
      {
        email,
        name: normalizeCell(lead.name),
        company: normalizeCell(lead.company),
        title: normalizeCell(lead.title),
        domain: normalizeDomainCandidate(lead.domain || email),
        sourceUrl: normalizeCell(lead.sourceUrl),
      },
    ];
  });

  if (!finalLeads.length) {
    return NextResponse.json(
      {
        error: "No prospects were imported.",
        hint: "The selected rows did not produce any verified work emails.",
        parseErrors: parseErrors.slice(0, 20),
      },
      { status: 400 }
    );
  }

  const assignment = await getBrandOutreachAssignment(brandId);
  const run = await createOutreachRun({
    brandId,
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
    brandId,
    experiment.runtime.campaignId,
    finalLeads
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
      parseErrorCount: parseErrors.length,
      source: "enrichanything_embed",
      tableTitle: normalizeCell(body.tableTitle),
      prompt: normalizeCell(body.prompt),
      entityType: normalizeCell(body.entityType),
    },
  });

  await updateExperimentRecord(brandId, experiment.id, {
    status: imported.length > 0 ? "ready" : experiment.status,
  });

  return NextResponse.json(
    {
      runId: run.id,
      status: "completed",
      attemptedCount: parsed.candidates.length,
      importedCount: imported.length,
      skippedCount: Math.max(0, parsed.candidates.length - imported.length),
      matchedCount: enrichment.matched,
      parseErrorCount: parseErrors.length,
      parseErrors: parseErrors.slice(0, 20),
    },
    { status: 201 }
  );
}
