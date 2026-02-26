import type {
  ConversationPreviewLead,
  OutreachRun,
  OutreachRunLead,
} from "@/lib/factory-types";
import { getExperimentRecordByRuntimeRef } from "@/lib/experiment-data";
import { extractFirstEmailAddress, getLeadEmailSuppressionReason } from "@/lib/outreach-providers";
import { listExperimentRuns, listOwnerRuns, listRunLeads } from "@/lib/outreach-data";

export type SourcedConversationPreviewLead = ConversationPreviewLead & {
  runId: string;
  runCreatedAt: string;
  sourceUrl: string;
  source: "sourced";
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
    const email = extractFirstEmailAddress(rawEmail || sourceUrl);
    if (!email || seen.has(email)) continue;
    if (getLeadEmailSuppressionReason(email)) continue;

    const domainFromEmail = email.includes("@") ? email.split("@")[1] ?? "" : "";
    const domain = String(row.lead.domain ?? "").trim().toLowerCase() || domainFromEmail;
    if (!domain) continue;
    if (FREE_EMAIL_DOMAINS.has(domain)) continue;

    const name = String(row.lead.name ?? "").trim() || extractNameFromUrl(rawEmail) || extractNameFromUrl(sourceUrl);
    const company = String(row.lead.company ?? "").trim();
    if (!name || !company) continue;

    seen.add(email);
    out.push({
      id: String(row.lead.id ?? `${row.run.id}:${email}`).trim(),
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
    };
  }

  const recentRuns = [...runs]
    .sort((a, b) => safeDateValue(b.createdAt) - safeDateValue(a.createdAt))
    .slice(0, maxRuns);
  const sourceRuns = recentRuns.filter(
    (run) =>
      !["failed", "preflight_failed", "canceled"].includes(String(run.status ?? "").toLowerCase()) &&
      Number(run.metrics?.sourcedLeads ?? 0) > 0
  );
  const selectedRuns = (sourceRuns.length ? sourceRuns : recentRuns).slice(0, maxRuns);

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

  const leads = dedupeAndNormalizeLeads({ rows, limit });
  return {
    leads,
    sourceExperimentId: sourceExperiment.id,
    runtimeRefFound: true,
    runsChecked: selectedRuns.length,
  };
}
