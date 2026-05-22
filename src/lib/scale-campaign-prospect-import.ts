import {
  getExperimentRecordById,
  getScaleCampaignRecordById,
  listScaleCampaignRecords,
  resolveScaleCampaignLane,
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
  resolveEmailFinderApiBaseUrl,
  type EmailFinderVerificationMode,
} from "@/lib/outreach-providers";
import {
  filterSelectionCandidatesAgainstExistingLeads,
  companyKeyFromLead,
  finalizeImportedSelectionLeads,
  isImportedLeadSendable,
  isRunLeadSendable,
  isReusableExperimentLeadStatus,
  isTerminalExperimentLeadStatus,
  prepareSelectionLeadsForEnrichment,
  refreshStoredDuplicateSelectionLeads,
  resolveSelectionLeadDomains,
  WARMUP_IMPORT_LEAD_QUALITY_POLICY,
  type ImportExperimentProspectRowsResult,
  type ImportedLead,
} from "@/lib/experiment-prospect-import";
import { isWarmupSeedLead } from "@/lib/warmup-seed-targets";

const DEFAULT_BACKGROUND_PREP_CANDIDATE_BATCH_SIZE = 12;
const MAX_BACKGROUND_PREP_CANDIDATE_BATCH_SIZE = 24;
const DEFAULT_BACKGROUND_PREP_CLEAROUT_MAX_COMPANIES = 3;
const DEFAULT_BACKGROUND_PREP_CLEAROUT_TIMEOUT_MS = 1_200;

export type ImportScaleCampaignProspectRowsResult = ImportExperimentProspectRowsResult & {
  backgroundBatchCandidateCount: number;
  backgroundBatchOffset: number;
  backgroundBatchTotalCandidates: number;
  backgroundBatchTruncated: boolean;
};

export type ScaleCampaignSendableLeadSummary = {
  sendableLeadCount: number;
  storedLeadCount: number;
  storedForVerificationCount: number;
  runsChecked: number;
};

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

function resolveBackgroundPrepCandidateBatchSize(value: unknown) {
  const parsed = Math.trunc(
    Number(value ?? process.env.OUTREACH_BACKGROUND_PREP_IMPORT_MAX_CANDIDATES) ||
      DEFAULT_BACKGROUND_PREP_CANDIDATE_BATCH_SIZE
  );
  if (!Number.isFinite(parsed)) {
    return DEFAULT_BACKGROUND_PREP_CANDIDATE_BATCH_SIZE;
  }
  return Math.max(1, Math.min(MAX_BACKGROUND_PREP_CANDIDATE_BATCH_SIZE, parsed));
}

export function selectBackgroundPrepCandidateWindow<T>(
  items: T[],
  input: { attempt?: number; maxItems?: number } = {}
) {
  const total = Array.isArray(items) ? items.length : 0;
  const maxItems = resolveBackgroundPrepCandidateBatchSize(input.maxItems);
  if (total <= maxItems) {
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

function normalizeCell(value: unknown) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized === "null" ? "" : normalized;
}

function emailFinderApiBaseUrl(origin: string) {
  return `${origin.replace(/\/+$/, "")}/api/internal/email-finder`;
}

function isSenderOwnedScaleCampaign(input: {
  scalePolicy?: { accountId?: string; mailboxAccountId?: string } | null;
}) {
  return Boolean(
    String(input.scalePolicy?.accountId ?? "").trim() ||
      String(input.scalePolicy?.mailboxAccountId ?? "").trim()
  );
}

async function listCrossCampaignDedupLeads(brandId: string, campaignId: string) {
  const campaigns = await listScaleCampaignRecords(brandId);
  const siblingCampaigns = campaigns.filter(
    (entry) =>
      entry.id !== campaignId &&
      entry.status !== "archived" &&
      isSenderOwnedScaleCampaign(entry)
  );
  if (!siblingCampaigns.length) {
    return [];
  }

  const siblingRuns = await Promise.all(
    siblingCampaigns.map((entry) => listOwnerRuns(brandId, "campaign", entry.id))
  );
  const siblingLeadLists = await Promise.all(siblingRuns.flat().map((run) => listRunLeads(run.id)));
  return siblingLeadLists.flat();
}

export async function importScaleCampaignProspectRows(input: {
  brandId: string;
  campaignId: string;
  rows: unknown[];
  requestOrigin?: string;
  emailFinderApiBaseUrl?: string;
  tableTitle?: string;
  prompt?: string;
  entityType?: string;
  backgroundMode?: boolean;
  prepAttempt?: number;
  maxCandidatesPerBatch?: number;
  emailFinderTimeoutMs?: number;
}): Promise<ImportScaleCampaignProspectRowsResult> {
  const campaign = await getScaleCampaignRecordById(input.brandId, input.campaignId);
  if (!campaign) {
    throw new Error("campaign not found");
  }

  const sourceExperiment = campaign.sourceExperimentId
    ? await getExperimentRecordById(input.brandId, campaign.sourceExperimentId)
    : null;
  const runtimeCampaignId = String(sourceExperiment?.runtime.campaignId ?? "").trim();
  const runtimeExperimentId = String(sourceExperiment?.runtime.experimentId ?? "").trim();
  const runtimeHypothesisId = String(sourceExperiment?.runtime.hypothesisId ?? "").trim();
  const isWarmupCampaign = resolveScaleCampaignLane(campaign) === "warmup";
  const qualityPolicy = isWarmupCampaign ? WARMUP_IMPORT_LEAD_QUALITY_POLICY : undefined;

  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) {
    throw new Error("rows are required");
  }

  const prepared = prepareSelectionLeadsForEnrichment(rows);
  const candidateWindow = input.backgroundMode
    ? selectBackgroundPrepCandidateWindow(prepared.candidates, {
        attempt: input.prepAttempt,
        maxItems: input.maxCandidatesPerBatch,
      })
    : {
        items: prepared.candidates,
        offset: 0,
        total: prepared.candidates.length,
        truncated: false,
      };
  if (!prepared.candidates.length) {
    const finalized = await finalizeImportedSelectionLeads({
      candidates: [],
      enrichmentLeads: [],
      initialErrors: prepared.errors,
      rejectedAssessments: prepared.rejectedAssessments,
      discoveredCount: prepared.discoveredCount,
      qualityPolicy,
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
      backgroundBatchCandidateCount: 0,
      backgroundBatchOffset: 0,
      backgroundBatchTotalCandidates: 0,
      backgroundBatchTruncated: false,
    };
  }

  const resolvedCandidates = await resolveSelectionLeadDomains(
    candidateWindow.items,
    input.backgroundMode
      ? {
          clearoutMaxCompanies: DEFAULT_BACKGROUND_PREP_CLEAROUT_MAX_COMPANIES,
          clearoutTimeoutMs: DEFAULT_BACKGROUND_PREP_CLEAROUT_TIMEOUT_MS,
        }
      : undefined
  );
  const existingRuns = await listOwnerRuns(input.brandId, "campaign", campaign.id);
  const existingLeadLists = await Promise.all(existingRuns.map((run) => listRunLeads(run.id)));
  const existingLeads = existingLeadLists.flat();
  const crossCampaignLeadList = isSenderOwnedScaleCampaign(campaign)
    ? await listCrossCampaignDedupLeads(input.brandId, campaign.id)
    : [];
  const dedupeLeadLists = [...existingLeads, ...crossCampaignLeadList];
  const oneContactPerCompany = sourceExperiment?.testEnvelope.oneContactPerCompany !== false;
  const prefiltered = filterSelectionCandidatesAgainstExistingLeads({
    candidates: resolvedCandidates,
    existingLeads: dedupeLeadLists,
    oneContactPerCompany,
    qualityPolicy,
  });
  const candidatesForEnrichment = prefiltered.filteredCandidates;

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
      backgroundBatchCandidateCount: candidateWindow.items.length,
      backgroundBatchOffset: candidateWindow.offset,
      backgroundBatchTotalCandidates: candidateWindow.total,
      backgroundBatchTruncated: candidateWindow.truncated,
    };
  }

  const enrichment = await enrichLeadsWithEmailFinderBatch({
    leads: candidatesForEnrichment.map((entry) => entry.lead),
    apiBaseUrl,
    verificationMode,
    maxCandidates: 12,
    maxCredits: 7,
    maxTotalCredits: resolveEmailFinderImportMaxTotalCredits(),
    concurrency: 3,
    timeoutMs: input.emailFinderTimeoutMs,
    allowBestGuessFallback: true,
    minBestGuessPValid: 0.58,
    audit: {
      source: "scale-campaign-prospect-import",
      context: {
        brandId: input.brandId,
        campaignId: input.campaignId,
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
    qualityPolicy,
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
      backgroundBatchCandidateCount: candidateWindow.items.length,
      backgroundBatchOffset: candidateWindow.offset,
      backgroundBatchTotalCandidates: candidateWindow.total,
      backgroundBatchTruncated: candidateWindow.truncated,
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
    if (companyKey && isImportedLeadSendable(lead, { qualityPolicy })) {
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
      backgroundBatchCandidateCount: candidateWindow.items.length,
      backgroundBatchOffset: candidateWindow.offset,
      backgroundBatchTotalCandidates: candidateWindow.total,
      backgroundBatchTruncated: candidateWindow.truncated,
    };
  }

  const assignment = await getBrandOutreachAssignment(input.brandId);
  const newSendableLeadCount = newLeads.filter((lead) =>
    isImportedLeadSendable(lead, { qualityPolicy })
  ).length;
  const newStoredForVerificationCount = Math.max(0, newLeads.length - newSendableLeadCount);
  const run = await createOutreachRun({
    brandId: input.brandId,
    campaignId: runtimeCampaignId || campaign.id,
    experimentId: runtimeExperimentId,
    hypothesisId: runtimeHypothesisId,
    ownerType: "campaign",
    ownerId: campaign.id,
    accountId:
      String(campaign.scalePolicy.accountId ?? "").trim() ||
      assignment?.accountId ||
      "enrichanything_campaign_table",
    status: "completed",
    dailyCap: campaign.scalePolicy.dailyCap,
    hourlyCap: campaign.scalePolicy.hourlyCap,
    timezone: campaign.scalePolicy.timezone,
    minSpacingMinutes: campaign.scalePolicy.minSpacingMinutes,
  });

  await upsertRunLeads(run.id, input.brandId, runtimeCampaignId || campaign.id, newLeads);

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
      selectedActorIds: ["enrichanything_live_table_campaign"],
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
      source: "enrichanything_live_table_campaign",
      tableTitle: normalizeCell(input.tableTitle),
      prompt: normalizeCell(input.prompt),
      entityType: normalizeCell(input.entityType),
      evidenceAcceptedCount: candidatesForEnrichment.length,
      verifiedContactCount: finalized.qualityPipeline.verified_contact,
      backgroundBatchCandidateCount: candidateWindow.items.length,
      backgroundBatchOffset: candidateWindow.offset,
      backgroundBatchTotalCandidates: candidateWindow.total,
      backgroundBatchTruncated: candidateWindow.truncated,
      evidenceSample: candidatesForEnrichment.slice(0, 5).map((candidate) => ({
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
    backgroundBatchCandidateCount: candidateWindow.items.length,
    backgroundBatchOffset: candidateWindow.offset,
    backgroundBatchTotalCandidates: candidateWindow.total,
    backgroundBatchTruncated: candidateWindow.truncated,
  };
}

export async function countScaleCampaignSendableLeadContacts(
  brandId: string,
  campaignId: string
): Promise<ScaleCampaignSendableLeadSummary> {
  const campaign = await getScaleCampaignRecordById(brandId, campaignId);
  if (!campaign) {
    throw new Error("campaign not found");
  }

  const runs = await listOwnerRuns(brandId, "campaign", campaign.id);
  if (!runs.length) {
    return {
      sendableLeadCount: 0,
      storedLeadCount: 0,
      storedForVerificationCount: 0,
      runsChecked: 0,
    };
  }

  const isWarmupCampaign = resolveScaleCampaignLane(campaign) === "warmup";
  const qualityPolicy = isWarmupCampaign ? WARMUP_IMPORT_LEAD_QUALITY_POLICY : undefined;
  const leadLists = await Promise.all(runs.map((run) => listRunLeads(run.id)));
  const allLeads = leadLists.flat();
  const blockedEmails = new Set<string>();
  for (const lead of allLeads) {
    if (!isTerminalExperimentLeadStatus(lead.status)) continue;
    const email = normalizeCell(lead.email).toLowerCase();
    if (email) blockedEmails.add(email);
  }

  const storedEmails = new Set<string>();
  const sendableEmails = new Set<string>();

  for (const lead of allLeads) {
    if (!isReusableExperimentLeadStatus(lead.status)) continue;
    if (isWarmupCampaign && isWarmupSeedLead(lead)) continue;
    const email = normalizeCell(lead.email).toLowerCase();
    if (!email) continue;
    if (blockedEmails.has(email)) continue;
    storedEmails.add(email);
    if (!isRunLeadSendable(lead, { qualityPolicy })) {
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
