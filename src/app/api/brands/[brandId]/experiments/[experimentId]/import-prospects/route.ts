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
import { extractFirstEmailAddress } from "@/lib/outreach-providers";

type CsvLeadRow = {
  email: string;
  name: string;
  company: string;
  title: string;
  domain: string;
  sourceUrl: string;
};

function normalizeCell(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseCsvRows(raw: string) {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (char === '"') {
      if (inQuotes && raw[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      current.push(field);
      field = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && raw[index + 1] === "\n") index += 1;
      current.push(field);
      field = "";
      if (current.some((cell) => normalizeCell(cell))) {
        rows.push(current);
      }
      current = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || current.length > 0) {
    current.push(field);
    if (current.some((cell) => normalizeCell(cell))) {
      rows.push(current);
    }
  }

  return rows;
}

function normalizeHeaderKey(value: string) {
  return normalizeCell(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function domainFromEmailOrUrl(email: string, sourceUrl: string) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (normalizedEmail.includes("@")) {
    return normalizedEmail.split("@")[1] ?? "";
  }
  try {
    const normalizedUrl =
      String(sourceUrl ?? "").startsWith("http://") || String(sourceUrl ?? "").startsWith("https://")
        ? String(sourceUrl ?? "")
        : `https://${String(sourceUrl ?? "")}`;
    const hostname = new URL(normalizedUrl).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function parseCsvLeads(rawCsv: string): { leads: CsvLeadRow[]; errors: string[] } {
  const rows = parseCsvRows(rawCsv);
  if (!rows.length) {
    return { leads: [], errors: ["CSV is empty."] };
  }

  const headerRow = rows[0] ?? [];
  const headers = headerRow.map((value) => normalizeHeaderKey(value));
  const findIndex = (...candidates: string[]) => {
    for (const candidate of candidates) {
      const idx = headers.indexOf(candidate);
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const emailIndex = findIndex("email", "workemail", "businessemail", "emailaddress", "e-mail");
  const nameIndex = findIndex("name", "fullname", "full_name", "contactname");
  const firstNameIndex = findIndex("firstname", "first_name", "fname");
  const lastNameIndex = findIndex("lastname", "last_name", "lname");
  const companyIndex = findIndex("company", "companyname", "organization", "org");
  const titleIndex = findIndex("title", "jobtitle", "role", "position");
  const domainIndex = findIndex("domain", "companydomain", "website", "companywebsite");
  const sourceUrlIndex = findIndex("sourceurl", "url", "linkedinurl", "profileurl", "websiteurl");

  if (emailIndex < 0) {
    return {
      leads: [],
      errors: [
        "Missing email column. Include a valid work email for each row.",
      ],
    };
  }

  const leads: CsvLeadRow[] = [];
  const errors: string[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const rawEmail = normalizeCell(row[emailIndex] ?? "");
    const parsedEmail = extractFirstEmailAddress(rawEmail);

    const fullName = nameIndex >= 0 ? normalizeCell(row[nameIndex] ?? "") : "";
    const firstName = firstNameIndex >= 0 ? normalizeCell(row[firstNameIndex] ?? "") : "";
    const lastName = lastNameIndex >= 0 ? normalizeCell(row[lastNameIndex] ?? "") : "";
    const name = fullName || `${firstName} ${lastName}`.trim();
    const company = companyIndex >= 0 ? normalizeCell(row[companyIndex] ?? "") : "";
    const title = titleIndex >= 0 ? normalizeCell(row[titleIndex] ?? "") : "";
    const sourceUrl = sourceUrlIndex >= 0 ? normalizeCell(row[sourceUrlIndex] ?? "") : "";
    const rawDomain = domainIndex >= 0 ? normalizeCell(row[domainIndex] ?? "").toLowerCase() : "";
    const domain = rawDomain || domainFromEmailOrUrl(parsedEmail, sourceUrl);
    const email = parsedEmail;

    if (!email) {
      if (rawEmail && !parsedEmail) {
        errors.push(`Row ${rowIndex + 1}: invalid email "${rawEmail}"`);
      } else {
        errors.push(`Row ${rowIndex + 1}: missing email.`);
      }
      continue;
    }

    leads.push({
      email,
      name,
      company,
      title,
      domain,
      sourceUrl,
    });
  }

  return { leads, errors };
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

  const rawCsv = String(body.csvText ?? "").trim();
  if (!rawCsv) {
    return NextResponse.json({ error: "csvText is required" }, { status: 400 });
  }

  const parsed = parseCsvLeads(rawCsv);
  if (!parsed.leads.length) {
    return NextResponse.json(
      {
        error: "No valid leads found in CSV.",
        hint: "Include at least one row with a valid work email.",
        parseErrors: parsed.errors.slice(0, 20),
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
    accountId: assignment?.accountId || "manual_import",
    status: "completed",
  });

  const imported = await upsertRunLeads(
    run.id,
    brandId,
    experiment.runtime.campaignId,
    parsed.leads
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
      selectedActorIds: ["manual_csv_import"],
      lastActorInputError: "",
      failureStep: "",
      budgetUsedUsd: 0,
    },
    completedAt: new Date().toISOString(),
    lastError: "",
  });

  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_imported_csv",
    payload: {
      importedCount: imported.length,
      parseErrorCount: parsed.errors.length,
    },
  });

  await updateExperimentRecord(brandId, experiment.id, {
    status: imported.length > 0 ? "ready" : experiment.status,
  });

  return NextResponse.json(
    {
      runId: run.id,
      importedCount: imported.length,
      parseErrorCount: parsed.errors.length,
      parseErrors: parsed.errors.slice(0, 20),
      status: "completed",
    },
    { status: 201 }
  );
}
