import { NextResponse } from "next/server";
import { listExperimentRecords } from "@/lib/experiment-data";
import {
  countExperimentSendableLeadContacts,
  deriveCompanyFromDomain,
  isNonCompanyProfileDomain,
  normalizeDomainCandidate,
} from "@/lib/experiment-prospect-import";
import { assessReportCommentLeadQuality } from "@/lib/report-comment-lead-quality";
import { listOwnerRuns, listRunLeads, updateRunLead } from "@/lib/outreach-data";
import { extractFirstEmailAddress } from "@/lib/outreach-providers";

const DEFAULT_BRAND_ID = "brand_7bfdb4d1686b4afc";
const REPORT_EXPERIMENT_PREFIX = "Report comment outreach · ";

function isAuthorized(request: Request) {
  const token =
    String(process.env.OUTREACH_CRON_TOKEN ?? "").trim() ||
    String(process.env.CRON_SECRET ?? "").trim();
  if (!token) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${token}`;
}

function resolveLeadDomain(lead: {
  domain?: string;
  email?: string;
  sourceUrl?: string;
}) {
  const email = extractFirstEmailAddress(lead.email ?? "");
  const candidates = [lead.domain ?? "", email, lead.sourceUrl ?? ""];
  for (const candidate of candidates) {
    const normalized = normalizeDomainCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

async function cleanupExperiment(
  brandId: string,
  experiment: { id: string; name: string; audience: string; offer: string }
) {
  const runs = await listOwnerRuns(brandId, "experiment", experiment.id);
  let leadsChecked = 0;
  let suppressedLeads = 0;
  let normalizedLeads = 0;

  for (const run of runs) {
    const leads = await listRunLeads(run.id);
    for (const lead of leads) {
      leadsChecked += 1;
      const normalizedDomain = resolveLeadDomain(lead);

      if (normalizedDomain && isNonCompanyProfileDomain(normalizedDomain)) {
        if (lead.status !== "suppressed") {
          await updateRunLead(lead.id, { status: "suppressed" });
          suppressedLeads += 1;
        }
        continue;
      }

      const quality = assessReportCommentLeadQuality(experiment, {
        name: lead.name,
        company: lead.company,
        title: lead.title,
        domain: normalizedDomain || lead.domain,
        sourceUrl: lead.sourceUrl,
        email: lead.email,
      });
      if (!quality.keep) {
        if (lead.status !== "suppressed") {
          await updateRunLead(lead.id, { status: "suppressed" });
          suppressedLeads += 1;
        }
        continue;
      }

      const patch: Parameters<typeof updateRunLead>[1] = {};
      if (normalizedDomain && normalizedDomain !== String(lead.domain ?? "").trim().toLowerCase()) {
        patch.domain = normalizedDomain;
      }

      if (!String(lead.company ?? "").trim() && normalizedDomain) {
        const derivedCompany = deriveCompanyFromDomain(normalizedDomain);
        if (derivedCompany) {
          patch.company = derivedCompany;
        }
      }

      if (Object.keys(patch).length > 0) {
        await updateRunLead(lead.id, patch);
        normalizedLeads += 1;
      }
    }
  }

  const sendable = await countExperimentSendableLeadContacts(brandId, experiment.id);

  return {
    experimentId: experiment.id,
    runsChecked: runs.length,
    leadsChecked,
    suppressedLeads,
    normalizedLeads,
    sendableLeadCount: sendable.sendableLeadCount,
  };
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const brandId = String(body.brandId ?? DEFAULT_BRAND_ID).trim() || DEFAULT_BRAND_ID;
  const requestedIds = Array.isArray(body.experimentIds)
    ? body.experimentIds.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];

  const experiments = (await listExperimentRecords(brandId)).filter((experiment) => {
    if (!experiment.name.startsWith(REPORT_EXPERIMENT_PREFIX)) {
      return false;
    }
    if (!requestedIds.length) {
      return true;
    }
    return requestedIds.includes(experiment.id);
  });

  const summary = [];
  for (const experiment of experiments) {
    summary.push({
      name: experiment.name,
      ...(await cleanupExperiment(brandId, experiment)),
    });
  }

  return NextResponse.json({
    ok: true,
    brandId,
    experimentsChecked: summary.length,
    summary,
  });
}
