import type {
  ConversationPreviewLead,
  OutreachRun,
  OutreachRunLead,
} from "@/lib/factory-types";
import { getExperimentRecordByRuntimeRef } from "@/lib/experiment-data";
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

function safeDateValue(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function dedupeAndNormalizeLeads(input: {
  rows: Array<{ run: OutreachRun; lead: OutreachRunLead }>;
  limit: number;
}) {
  const out = [] as SourcedConversationPreviewLead[];
  const seen = new Set<string>();

  for (const row of input.rows) {
    const email = String(row.lead.email ?? "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;

    const domainFromEmail = email.includes("@") ? email.split("@")[1] ?? "" : "";
    const domain = String(row.lead.domain ?? "").trim().toLowerCase() || domainFromEmail;
    if (!domain) continue;

    seen.add(email);
    out.push({
      id: String(row.lead.id ?? `${row.run.id}:${email}`).trim(),
      runId: row.run.id,
      runCreatedAt: row.run.createdAt,
      email,
      name: String(row.lead.name ?? "").trim(),
      company: String(row.lead.company ?? "").trim(),
      title: String(row.lead.title ?? "").trim(),
      domain,
      sourceUrl: String(row.lead.sourceUrl ?? "").trim(),
      source: "sourced",
    });
    if (out.length >= input.limit) break;
  }

  return out;
}

export async function listConversationPreviewLeads(input: PreviewLeadQueryInput) {
  const limit = Math.max(1, Math.min(50, Number(input.limit ?? 12) || 12));
  const maxRuns = Math.max(1, Math.min(30, Number(input.maxRuns ?? 10) || 10));

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

  const runLeads = await Promise.all(
    recentRuns.map(async (run) => ({
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
    runsChecked: recentRuns.length,
  };
}
