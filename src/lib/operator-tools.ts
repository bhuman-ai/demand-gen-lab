import {
  createBrand,
  createId,
  deleteBrand,
  getBrandById,
  updateBrand,
} from "@/lib/factory-data";
import type {
  BrandRecord,
  DeliverabilityProbeRun,
  LeadRow,
  ScaleCampaignRecord,
} from "@/lib/factory-types";
import {
  buildExperimentProspectTableConfig,
  ensureEnrichAnythingProspectTable,
  getEnrichAnythingProspectTableState,
} from "@/lib/enrichanything-live-table";
import {
  countExperimentSendableLeadContacts,
} from "@/lib/experiment-prospect-import";
import { getExperimentVerifiedEmailLeadTarget } from "@/lib/experiment-policy";
import {
  createExperimentRecord,
  deleteScaleCampaignRecord,
  deleteExperimentRecord,
  ensureRuntimeForExperiment,
  getExperimentRecordById,
  listExperimentRecords,
  getScaleCampaignRecordById,
  listScaleCampaignRecords,
  promoteExperimentRecordToCampaign,
  updateExperimentRecord,
  updateScaleCampaignRecord,
} from "@/lib/experiment-data";
import { refreshMailpoolOutreachAccount } from "@/lib/mailpool-account-refresh";
import {
  createLeadrLinkedInAuthLink,
  createLeadrLinkedInCampaign,
  getLeadrChannelSnapshot,
  resumeLeadrLinkedInCampaign,
  syncLeadrLinkedInCampaign,
} from "@/lib/leadr-channel";
import { listLeadrAccounts } from "@/lib/leadr-client";
import {
  closeGmailUiWorkerSession,
  getGmailUiWorkerSession,
  searchGmailUiWorkerMailbox,
  sendGmailUiWorkerMessage,
  verifyGmailUiWorkerSentMessage,
} from "@/lib/gmail-ui-worker-client";
import { getOperatorBrandContext, getOperatorSenderContext } from "@/lib/operator-context";
import type { OperatorToolName, OperatorToolResult, OperatorToolSpec } from "@/lib/operator-types";
import {
  getOutreachRun,
  getReplyDraft,
  getReplyThread,
  getReplyThreadState,
  listDeliverabilityProbeRuns,
  listReplyMessagesByThread,
  listReplyThreadFeedback,
  listExperimentRuns,
  listOwnerRuns,
  listRunEvents,
  listRunLeads,
  listRunMessages,
  listReplyThreadsByBrand,
  updateReplyDraft,
} from "@/lib/outreach-data";
import { provisionSender } from "@/lib/outreach-provisioning";
import {
  approveReplyDraftAndSend,
  launchExperimentRun,
  launchScaleCampaignRun,
  updateRunControl,
} from "@/lib/outreach-runtime";
import { isDeliverabilitySeedSendingDisabledReason } from "@/lib/sender-health";

const RUN_OPEN_STATUSES = new Set([
  "queued",
  "sourcing",
  "scheduled",
  "sending",
  "monitoring",
  "paused",
]);

function nowIso() {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => asString(entry)).filter(Boolean);
  }
  const raw = asString(value);
  if (!raw) return [];
  return raw
    .split(/\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function requireString(input: Record<string, unknown>, key: string) {
  const value = asString(input[key]);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function pickRun<T extends { status: string }>(runs: T[]) {
  return runs.find((run) => RUN_OPEN_STATUSES.has(run.status)) ?? runs[0] ?? null;
}

function buildProvisionPreview(input: Record<string, unknown>) {
  const domain = asString(input.domain) || "new Mailpool domain";
  const fromLocalPart = asString(input.fromLocalPart) || "sender local-part";
  const rawDomainMode = asString(input.domainMode);
  const domainMode =
    rawDomainMode === "register" ? "register" : rawDomainMode === "transfer" ? "transfer" : "existing";
  return {
    title: "Add Mailpool sender",
    summary:
      domainMode === "register"
        ? `Buy ${domain}, create ${fromLocalPart}@${domain}, and attach it to the brand.`
        : domainMode === "transfer"
          ? `Transfer ${domain} into Mailpool, create ${fromLocalPart}@${domain}, and attach it to the brand.`
        : `Use ${domain}, create ${fromLocalPart}@${domain}, and attach it to the brand.`,
    domainMode,
    domain,
    fromLocalPart,
  };
}

function buildSimplePreview(title: string, summary: string) {
  return { title, summary };
}

function buildRegistrant(value: unknown) {
  const row = asRecord(value);
  if (!Object.keys(row).length) return undefined;
  return {
    firstName: asString(row.firstName),
    lastName: asString(row.lastName),
    organizationName: asString(row.organizationName),
    emailAddress: asString(row.emailAddress),
    phone: asString(row.phone),
    address1: asString(row.address1),
    city: asString(row.city),
    stateProvince: asString(row.stateProvince),
    postalCode: asString(row.postalCode),
    country: asString(row.country),
  };
}

function summarizeCampaignCounts(campaigns: ScaleCampaignRecord[]) {
  return {
    total: campaigns.length,
    draft: campaigns.filter((campaign) => campaign.status === "draft").length,
    active: campaigns.filter((campaign) => campaign.status === "active").length,
    paused: campaigns.filter((campaign) => campaign.status === "paused").length,
    completed: campaigns.filter((campaign) => campaign.status === "completed").length,
    archived: campaigns.filter((campaign) => campaign.status === "archived").length,
  };
}

function truncateText(value: unknown, maxLength = 3000) {
  const text = asString(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function stripSensitiveKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stripSensitiveKeys(entry));
  if (!value || typeof value !== "object") return value;
  const clean: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/(api[_-]?key|password|secret|token|authorization|credential|authcode|refresh[_-]?token|access[_-]?token)/i.test(key)) {
      clean[key] = "[redacted]";
      continue;
    }
    clean[key] = stripSensitiveKeys(entry);
  }
  return clean;
}

function searchTerms(value: unknown) {
  return Array.from(
    new Set(
      asString(value)
        .toLowerCase()
        .split(/[^a-z0-9@._-]+/i)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3)
        .filter(
          (term) =>
            ![
              "the",
              "and",
              "that",
              "this",
              "with",
              "what",
              "when",
              "where",
              "from",
              "have",
              "does",
              "did",
              "say",
              "said",
              "email",
              "reply",
              "thread",
            ].includes(term)
        )
    )
  );
}

function scoreTextForQuery(text: string, terms: string[]) {
  const haystack = text.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function selectByQuery<T>(
  items: T[],
  input: {
    query: string;
    limit: number;
    text: (item: T) => string;
    forceInclude?: (item: T) => boolean;
  }
) {
  const terms = searchTerms(input.query);
  const withScores = items.map((item, index) => ({
    item,
    index,
    forced: input.forceInclude?.(item) === true,
    score: scoreTextForQuery(input.text(item), terms),
  }));
  return withScores
    .filter((row) => row.forced || !terms.length || row.score > 0)
    .sort((left, right) => {
      if (left.forced !== right.forced) return left.forced ? -1 : 1;
      if (left.score !== right.score) return right.score - left.score;
      return left.index - right.index;
    })
    .slice(0, Math.max(1, input.limit))
    .map((row) => row.item);
}

function compactReplyMessage(message: Awaited<ReturnType<typeof listReplyMessagesByThread>>[number]) {
  return {
    id: message.id,
    direction: message.direction,
    from: message.from,
    to: message.to,
    subject: message.subject,
    body: truncateText(message.body, 5000),
    providerMessageId: message.providerMessageId,
    receivedAt: message.receivedAt,
    createdAt: message.createdAt,
  };
}

function compactRunMessage(message: Awaited<ReturnType<typeof listRunMessages>>[number]) {
  return {
    id: message.id,
    leadId: message.leadId,
    step: message.step,
    subject: message.subject,
    body: truncateText(message.body, 5000),
    sourceType: message.sourceType,
    nodeId: message.nodeId,
    parentMessageId: message.parentMessageId,
    status: message.status,
    providerMessageId: message.providerMessageId,
    scheduledAt: message.scheduledAt,
    sentAt: message.sentAt,
    lastError: message.lastError,
    generationMeta: stripSensitiveKeys(message.generationMeta),
  };
}

function compactRunLead(lead: Awaited<ReturnType<typeof listRunLeads>>[number]) {
  return {
    id: lead.id,
    email: lead.email,
    name: lead.name,
    company: lead.company,
    title: lead.title,
    domain: lead.domain,
    sourceUrl: lead.sourceUrl,
    realVerifiedEmail: lead.realVerifiedEmail ?? false,
    emailVerification: stripSensitiveKeys(lead.emailVerification ?? null),
    status: lead.status,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

function compactEvent(event: Awaited<ReturnType<typeof listRunEvents>>[number]) {
  return {
    id: event.id,
    eventType: event.eventType,
    payload: stripSensitiveKeys(event.payload),
    createdAt: event.createdAt,
  };
}

async function getBrandOrThrow(brandId: string) {
  const brand = await getBrandById(brandId, { includeEmbedded: true });
  if (!brand) throw new Error("Brand not found");
  return brand;
}

async function getExperimentOrThrow(brandId: string, experimentId: string) {
  const experiment = await getExperimentRecordById(brandId, experimentId);
  if (!experiment) throw new Error("Experiment not found");
  return experiment;
}

async function getScaleCampaignOrThrow(brandId: string, campaignId: string) {
  const campaign = await getScaleCampaignRecordById(brandId, campaignId);
  if (!campaign) throw new Error("Campaign not found");
  return campaign;
}

function normalizeLeadStatus(value: unknown): LeadRow["status"] {
  const normalized = asString(value).toLowerCase();
  return ["new", "contacted", "qualified", "closed"].includes(normalized)
    ? (normalized as LeadRow["status"])
    : "new";
}

function findLead(brand: BrandRecord, input: Record<string, unknown>) {
  const leadId = asString(input.leadId);
  if (leadId) {
    return brand.leads.find((lead) => lead.id === leadId) ?? null;
  }
  const name = asString(input.name).toLowerCase();
  if (!name) return null;
  return brand.leads.find((lead) => lead.name.trim().toLowerCase() === name) ?? null;
}

function buildBrandPatch(input: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  if (typeof input.name === "string") patch.name = asString(input.name);
  if (typeof input.website === "string") patch.website = asString(input.website);
  if (typeof input.tone === "string") patch.tone = asString(input.tone);
  if (typeof input.notes === "string") patch.notes = asString(input.notes);
  if (typeof input.product === "string") patch.product = asString(input.product);
  const targetMarkets = asStringArray(input.targetMarkets);
  const idealCustomerProfiles = asStringArray(input.idealCustomerProfiles);
  const keyFeatures = asStringArray(input.keyFeatures);
  const keyBenefits = asStringArray(input.keyBenefits);
  if (targetMarkets.length) patch.targetMarkets = targetMarkets;
  if (idealCustomerProfiles.length) patch.idealCustomerProfiles = idealCustomerProfiles;
  if (keyFeatures.length) patch.keyFeatures = keyFeatures;
  if (keyBenefits.length) patch.keyBenefits = keyBenefits;
  return patch;
}

async function resolveExperimentRunTarget(input: {
  brandId: string;
  experimentId: string;
  runId?: string;
}) {
  const experiment = await getExperimentOrThrow(input.brandId, input.experimentId);
  if (input.runId) {
    const run = await getOutreachRun(input.runId);
    if (!run || run.brandId !== input.brandId) throw new Error("Run not found");
    return { experiment, run };
  }

  const ownerRuns = await listOwnerRuns(input.brandId, "experiment", experiment.id);
  if (ownerRuns.length) {
    return { experiment, run: pickRun(ownerRuns)! };
  }

  if (experiment.runtime.campaignId && experiment.runtime.experimentId) {
    const runtimeRuns = await listExperimentRuns(
      input.brandId,
      experiment.runtime.campaignId,
      experiment.runtime.experimentId
    );
    if (runtimeRuns.length) {
      return { experiment, run: pickRun(runtimeRuns)! };
    }
  }

  throw new Error("No run found for this experiment");
}

async function resolveCampaignRunTarget(input: {
  brandId: string;
  campaignId: string;
  runId?: string;
}) {
  const campaign = await getScaleCampaignOrThrow(input.brandId, input.campaignId);
  if (input.runId) {
    const run = await getOutreachRun(input.runId);
    if (!run || run.brandId !== input.brandId) throw new Error("Run not found");
    return { campaign, run };
  }

  const ownerRuns = await listOwnerRuns(input.brandId, "campaign", campaign.id);
  if (ownerRuns.length) {
    return { campaign, run: pickRun(ownerRuns)! };
  }

  throw new Error("No run found for this campaign");
}

async function investigateBrandData(input: Record<string, unknown>): Promise<OperatorToolResult> {
  const brandId = requireString(input, "brandId");
  const query = asString(input.query) || "latest important brand state";
  const threadId = asString(input.threadId);
  const runId = asString(input.runId);
  const leadId = asString(input.leadId);
  const campaignId = asString(input.campaignId);
  const maxThreads = Math.min(8, Math.max(1, asNumber(input.maxThreads, 5)));
  const maxRuns = Math.min(8, Math.max(1, asNumber(input.maxRuns, 4)));
  const maxMessages = Math.min(20, Math.max(1, asNumber(input.maxMessages, 8)));

  const [brand, context, campaigns, experiments, inbox] = await Promise.all([
    getBrandOrThrow(brandId),
    getOperatorBrandContext(brandId),
    listScaleCampaignRecords(brandId),
    listExperimentRecords(brandId),
    listReplyThreadsByBrand(brandId, { includeEval: true }),
  ]);

  const selectedThreads = selectByQuery(inbox.threads, {
    query,
    limit: maxThreads,
    text: (thread) =>
      [
        thread.id,
        thread.subject,
        thread.contactEmail,
        thread.contactName,
        thread.contactCompany,
        thread.sentiment,
        thread.intent,
        thread.status,
        thread.runId,
        thread.leadId,
        thread.campaignId,
        JSON.stringify(thread.stateSummary ?? {}),
      ].join(" "),
    forceInclude: (thread) =>
      Boolean(threadId && thread.id === threadId) ||
      Boolean(runId && thread.runId === runId) ||
      Boolean(leadId && thread.leadId === leadId) ||
      Boolean(campaignId && thread.campaignId === campaignId),
  });

  const threadDetails = await Promise.all(
    selectedThreads.map(async (thread) => {
      const [messages, state, feedback] = await Promise.all([
        listReplyMessagesByThread(thread.id),
        getReplyThreadState(thread.id),
        listReplyThreadFeedback(thread.id),
      ]);
      return {
        thread,
        state: stripSensitiveKeys(state),
        messages: messages.slice(0, maxMessages).map(compactReplyMessage),
        drafts: inbox.drafts
          .filter((draft) => draft.threadId === thread.id)
          .slice(0, 6)
          .map((draft) => ({
            id: draft.id,
            subject: draft.subject,
            body: truncateText(draft.body, 5000),
            status: draft.status,
            reason: draft.reason,
            runId: draft.runId,
            createdAt: draft.createdAt,
            updatedAt: draft.updatedAt,
            sentAt: draft.sentAt,
          })),
        feedback: feedback.slice(0, 6),
      };
    })
  );

  const ownerRunGroups = await Promise.all([
    ...campaigns.slice(0, 20).map((campaign) => listOwnerRuns(brandId, "campaign", campaign.id)),
    ...experiments.slice(0, 20).map((experiment) => listOwnerRuns(brandId, "experiment", experiment.id)),
  ]);
  const runById = new Map(ownerRunGroups.flat().map((run) => [run.id, run] as const));
  if (runId) {
    const explicitRun = await getOutreachRun(runId);
    if (explicitRun?.brandId === brandId) runById.set(explicitRun.id, explicitRun);
  }
  for (const thread of selectedThreads) {
    if (!thread.runId || runById.has(thread.runId)) continue;
    const threadRun = await getOutreachRun(thread.runId);
    if (threadRun?.brandId === brandId) runById.set(threadRun.id, threadRun);
  }
  const allRuns = Array.from(runById.values()).sort((left, right) =>
    left.updatedAt < right.updatedAt ? 1 : -1
  );
  const forcedRunIds = new Set([runId, ...selectedThreads.map((thread) => thread.runId)].filter(Boolean));
  const selectedRuns = selectByQuery(allRuns, {
    query,
    limit: maxRuns,
    text: (run) =>
      [
        run.id,
        run.campaignId,
        run.experimentId,
        run.status,
        run.lastError,
        run.externalRef,
        JSON.stringify(run.metrics ?? {}),
        JSON.stringify(run.sourcingTraceSummary ?? {}),
      ].join(" "),
    forceInclude: (run) =>
      forcedRunIds.has(run.id) ||
      Boolean(campaignId && run.campaignId === campaignId),
  });

  const runDetails = await Promise.all(
    selectedRuns.map(async (run) => {
      const [messages, leads, events] = await Promise.all([
        listRunMessages(run.id),
        listRunLeads(run.id),
        listRunEvents(run.id),
      ]);
      const selectedMessages = selectByQuery(messages, {
        query,
        limit: maxMessages,
        text: (message) =>
          [
            message.id,
            message.leadId,
            message.subject,
            message.body,
            message.status,
            message.lastError,
            message.nodeId,
            message.providerMessageId,
          ].join(" "),
        forceInclude: (message) => Boolean(leadId && message.leadId === leadId),
      });
      const selectedLeads = selectByQuery(leads, {
        query,
        limit: maxMessages,
        text: (lead) =>
          [
            lead.id,
            lead.email,
            lead.name,
            lead.company,
            lead.title,
            lead.domain,
            lead.status,
            JSON.stringify(lead.emailVerification ?? {}),
          ].join(" "),
        forceInclude: (lead) => Boolean(leadId && lead.id === leadId),
      });
      return {
        run: {
          id: run.id,
          brandId: run.brandId,
          campaignId: run.campaignId,
          experimentId: run.experimentId,
          accountId: run.accountId,
          status: run.status,
          lastError: run.lastError,
          metrics: run.metrics,
          sourcingTraceSummary: stripSensitiveKeys(run.sourcingTraceSummary ?? {}),
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        },
        messages: selectedMessages.map(compactRunMessage),
        leads: selectedLeads.map(compactRunLead),
        events: events.slice(0, 12).map(compactEvent),
      };
    })
  );

  const selectedCampaigns = selectByQuery(campaigns, {
    query,
    limit: 8,
    text: (campaign) =>
      [
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.sourceExperimentId,
        campaign.lastRunId,
        JSON.stringify(campaign),
      ].join(" "),
    forceInclude: (campaign) => Boolean(campaignId && campaign.id === campaignId),
  });
  const selectedExperiments = selectByQuery(experiments, {
    query,
    limit: 8,
    text: (experiment) => [experiment.id, experiment.name, experiment.status, JSON.stringify(experiment)].join(" "),
  });

  const inboundCount = threadDetails.reduce(
    (count, detail) => count + detail.messages.filter((message) => message.direction === "inbound").length,
    0
  );

  return {
    summary: `Investigated ${brand.name}: ${threadDetails.length} inbox thread${threadDetails.length === 1 ? "" : "s"} with ${inboundCount} inbound message${inboundCount === 1 ? "" : "s"}, ${runDetails.length} run${runDetails.length === 1 ? "" : "s"}, campaign/experiment context, and sender context.`,
    result: {
      query,
      brand: {
        id: brand.id,
        name: brand.name,
        website: brand.website,
        product: brand.product,
        notes: truncateText(brand.notes, 1500),
        targetMarkets: brand.targetMarkets,
        idealCustomerProfiles: brand.idealCustomerProfiles,
        keyFeatures: brand.keyFeatures,
        keyBenefits: brand.keyBenefits,
      },
      senderContext: context?.senders ?? null,
      routingContext: context?.routing ?? null,
      inbox: {
        totalThreads: inbox.threads.length,
        totalDrafts: inbox.drafts.length,
        selectedThreads: threadDetails,
      },
      campaigns: selectedCampaigns,
      experiments: selectedExperiments,
      runs: runDetails,
      brandLeads: brand.leads.slice(0, 25),
      evidencePolicy:
        "Raw email bodies, sent message bodies, drafts, run events, and leads are included when available. If a needed body is not present here, call this tool again with a more specific threadId, runId, leadId, or query.",
    } as Record<string, unknown>,
  };
}

function normalizeProbeCounts(probe: DeliverabilityProbeRun) {
  const countsRecord = asRecord(probe.counts);
  const counts = {
    inbox: asNumber(countsRecord.inbox),
    spam: asNumber(countsRecord.spam),
    allMailOnly: asNumber(countsRecord.all_mail_only),
    notFound: asNumber(countsRecord.not_found),
    error: asNumber(countsRecord.error),
  };
  let total = asNumber(probe.totalMonitors);
  if (total <= 0) {
    total = counts.inbox + counts.spam + counts.allMailOnly + counts.notFound + counts.error;
  }
  if (total <= 0 && probe.placement) {
    total = 1;
    if (probe.placement === "inbox") counts.inbox = 1;
    else if (probe.placement === "spam") counts.spam = 1;
    else if (probe.placement === "all_mail_only") counts.allMailOnly = 1;
    else if (probe.placement === "not_found") counts.notFound = 1;
    else counts.error = 1;
  }
  return {
    ...counts,
    total,
    inboxRate: total > 0 ? counts.inbox / total : 0,
    spamRate: total > 0 ? counts.spam / total : 0,
  };
}

function summarizeProbePlacement(probe: DeliverabilityProbeRun | null) {
  if (!probe) return "No inbox-placement probe has run yet.";
  if (probe.status === "failed") {
    return isDeliverabilitySeedSendingDisabledReason(probe.lastError)
      ? "Inbox-placement seed sending is paused platform-wide, so this sender does not have fresh placement evidence."
      : probe.lastError || "The latest inbox-placement probe failed before it produced placement evidence.";
  }
  if (probe.status !== "completed") {
    return `The latest inbox-placement probe is ${probe.status}; it has not produced final inbox/spam evidence yet.`;
  }
  const counts = normalizeProbeCounts(probe);
  if (counts.total <= 0) return probe.summaryText || "The latest probe completed but did not return seed inbox counts.";
  return `${counts.inbox} inbox, ${counts.spam} spam, ${counts.allMailOnly} all-mail-only, ${counts.notFound} missing, and ${counts.error} error across ${counts.total} seed inbox${counts.total === 1 ? "" : "es"}.`;
}

function describeSenderDeliveryState(input: {
  automationStatus: string;
  usableForRouting: boolean;
  latestProbe: DeliverabilityProbeRun | null;
}) {
  const status = input.automationStatus.trim().toLowerCase();
  if (status === "ready") {
    return "This sender has cleared the current system checks and can be considered the cleanest route.";
  }
  if (status === "attention" || status === "blocked") {
    return "This sender needs attention before it should carry real outbound.";
  }
  if (input.latestProbe?.status === "completed") {
    return input.usableForRouting
      ? "This sender can be used carefully, but the system is still collecting enough inbox-placement evidence before scaling."
      : "This sender has some placement evidence, but the route is not strong enough to scale yet.";
  }
  return input.usableForRouting
    ? "This sender looks usable, but it still needs fresh inbox-placement proof before aggressive volume."
    : "This sender is still being prepared or checked and should not be treated as fully ready.";
}

function compactProbeRun(probe: DeliverabilityProbeRun) {
  const counts = normalizeProbeCounts(probe);
  return {
    id: probe.id,
    status: probe.status,
    stage: probe.stage,
    probeVariant: probe.probeVariant,
    senderAccountId: probe.senderAccountId,
    fromEmail: probe.fromEmail,
    subject: probe.subject,
    sourceMessageStatus: probe.sourceMessageStatus,
    placement: probe.placement,
    counts,
    summaryText: probe.summaryText,
    lastError: probe.lastError,
    createdAt: probe.createdAt,
    updatedAt: probe.updatedAt,
    completedAt: probe.completedAt,
    seedResults: probe.results.slice(0, 25).map((result) => ({
      accountId: result.accountId,
      email: result.email,
      placement: result.placement,
      matchedMailbox: result.matchedMailbox,
      ok: result.ok,
      error: result.error,
      cleanup: result.cleanup,
    })),
  };
}

function extractEmailFromText(value: string) {
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? "";
}

async function inspectSenderDeliveryEvidence(input: Record<string, unknown>): Promise<OperatorToolResult> {
  const brandId = requireString(input, "brandId");
  const query = asString(input.query);
  const requestedSenderAccountId = asString(input.senderAccountId);
  const requestedFromEmail = (asString(input.fromEmail) || extractEmailFromText(query)).toLowerCase();
  const maxProbeRuns = Math.min(120, Math.max(10, asNumber(input.maxProbeRuns, 80)));
  const perSenderHistory = Math.min(8, Math.max(1, asNumber(input.perSenderHistory, 5)));

  const [brand, context, probeRuns] = await Promise.all([
    getBrandOrThrow(brandId),
    getOperatorBrandContext(brandId),
    listDeliverabilityProbeRuns({ brandId, limit: maxProbeRuns }),
  ]);
  if (!context) throw new Error("Brand not found");

  const matchingSenders = context.senders.snapshots.filter((sender) => {
    if (requestedSenderAccountId && sender.accountId !== requestedSenderAccountId) return false;
    if (requestedFromEmail && sender.fromEmail.toLowerCase() !== requestedFromEmail) return false;
    if (!query) return true;
    const terms = searchTerms(query);
    if (!terms.length || requestedSenderAccountId || requestedFromEmail) return true;
    const text = [
      sender.accountId,
      sender.accountName,
      sender.fromEmail,
      sender.domain,
      sender.automationStatus,
      sender.automationSummary,
      sender.routeLabel,
      sender.spamCheckSummary,
      sender.dnsStatus,
    ].join(" ");
    return scoreTextForQuery(text, terms) > 0;
  });
  const senders = matchingSenders.length ? matchingSenders : context.senders.snapshots;

  const recentBySender = new Map<string, DeliverabilityProbeRun[]>();
  for (const probe of probeRuns) {
    const keys = [probe.senderAccountId, probe.fromEmail.toLowerCase()].filter(Boolean);
    for (const key of keys) {
      if (!recentBySender.has(key)) recentBySender.set(key, []);
      recentBySender.get(key)!.push(probe);
    }
  }

  const senderRows = senders.map((sender) => {
    const senderProbeRuns = [
      ...(recentBySender.get(sender.accountId) ?? []),
      ...(recentBySender.get(sender.fromEmail.toLowerCase()) ?? []),
    ]
      .filter((probe, index, rows) => rows.findIndex((row) => row.id === probe.id) === index)
      .sort((left, right) => {
        const leftAt = left.completedAt || left.updatedAt || left.createdAt;
        const rightAt = right.completedAt || right.updatedAt || right.createdAt;
        return leftAt < rightAt ? 1 : -1;
      });
    const latestProbe = senderProbeRuns[0] ?? null;
    const completedProbe = senderProbeRuns.find((probe) => probe.status === "completed") ?? null;
    return {
      accountId: sender.accountId,
      accountName: sender.accountName,
      fromEmail: sender.fromEmail,
      domain: sender.domain,
      provider: sender.provider,
      accountStatus: sender.status,
      dnsStatus: sender.dnsStatus,
      mailpoolStatus: sender.mailpoolStatus,
      mailpoolSpamCheck: sender.spamCheckSummary,
      inboxPlacementId: sender.inboxPlacementId,
      automationStatus: sender.automationStatus,
      automationSummary: sender.automationSummary,
      routeScore: sender.routeScore,
      routeLabel: sender.routeLabel,
      usableForRouting: sender.usableForRouting,
      hasCompletedPlacementEvidence: Boolean(completedProbe),
      plainStatus: describeSenderDeliveryState({
        automationStatus: sender.automationStatus,
        usableForRouting: sender.usableForRouting,
        latestProbe,
      }),
      latestPlacementSummary: summarizeProbePlacement(latestProbe),
      latestCompletedPlacementSummary: summarizeProbePlacement(completedProbe),
      latestProbe: latestProbe ? compactProbeRun(latestProbe) : null,
      recentProbes: senderProbeRuns.slice(0, perSenderHistory).map(compactProbeRun),
    };
  });

  const completedEvidenceCount = senderRows.filter((row) => row.hasCompletedPlacementEvidence).length;
  const failedDueToPausedSeeds = senderRows.filter((row) =>
    row.latestProbe?.lastError ? isDeliverabilitySeedSendingDisabledReason(row.latestProbe.lastError) : false
  ).length;
  const usableCount = senderRows.filter((row) => row.usableForRouting).length;
  const readyCount = senderRows.filter((row) => row.automationStatus === "ready").length;
  const blockedCount = senderRows.filter((row) => row.automationStatus === "attention" || row.automationStatus === "blocked").length;

  const summaryParts = [
    `${brand.name}: ${readyCount} ready sender${readyCount === 1 ? "" : "s"}`,
    `${usableCount} usable`,
    `${blockedCount} needing attention`,
    `${completedEvidenceCount}/${senderRows.length} with completed inbox-placement evidence`,
  ];
  if (failedDueToPausedSeeds) {
    summaryParts.push(`${failedDueToPausedSeeds} blocked by paused seed sending`);
  }

  return {
    summary: summaryParts.join(", ") + ".",
    result: {
      objectType: "sender_delivery",
      brand: {
        id: brand.id,
        name: brand.name,
      },
      query,
      requestedSenderAccountId,
      requestedFromEmail,
      plainEnglish: {
        warmupOrControlChecks:
          "This means the system is checking whether real test emails land in inbox vs spam before it scales outbound volume.",
        inboxPlacementEvidence:
          "Use completed probe rows and seedResults for the actual inbox/spam/all-mail/missing evidence. Mailpool spam score is useful, but it is not the same as Gmail inbox placement.",
        scaleRule:
          "If there is no completed placement evidence, or the latest evidence is spam/missing-heavy, the sender should stay low-volume or blocked until a fresh check improves.",
      },
      brandWide: {
        totalSenders: context.senders.total,
        ready: context.senders.ready,
        pending: context.senders.pending,
        blocked: context.senders.blocked,
        preferredSenderAccountId: context.routing.preferredSenderAccountId,
        preferredSenderEmail: context.routing.preferredSenderEmail,
        preferredSenderSummary: context.routing.preferredSenderSummary,
      },
      senderDeliveryEvidence: senderRows,
      evidencePolicy:
        "This tool answers sender readiness, warmup/control checks, inbox placement, spam placement, Mailpool checks, and which seed inboxes saw the message. Do not ask the user to choose an experiment unless they explicitly ask about experiments, campaign variants, or a specific experiment run.",
    },
  } satisfies OperatorToolResult;
}

const TOOL_SPECS: OperatorToolSpec[] = [
  {
    name: "get_brand_snapshot",
    riskLevel: "read",
    approvalMode: "none",
    description: "Summarize a brand's senders, routing, experiments, campaigns, leads, and inbox state.",
    previewTitle: "Get brand snapshot",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const context = await getOperatorBrandContext(brandId);
      if (!context) {
        throw new Error("Brand not found");
      }
      const runningExperiments = context.experiments.running + context.experiments.sourcing;
      return {
        summary: `${context.brand.name} has ${context.senders.total} sender${context.senders.total === 1 ? "" : "s"}, ${context.experiments.total} experiment${context.experiments.total === 1 ? "" : "s"}${runningExperiments ? `, ${runningExperiments} running` : ""}, ${context.leads.total} lead${context.leads.total === 1 ? "" : "s"}, and ${context.inbox.threads} inbox thread${context.inbox.threads === 1 ? "" : "s"}.`,
        result: context as unknown as Record<string, unknown>,
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "get_sender_snapshot",
    riskLevel: "read",
    approvalMode: "none",
    description: "Inspect one sender account, including Mailpool status and brand attachments.",
    previewTitle: "Get sender snapshot",
    run: async (input) => {
      const accountId = requireString(input, "accountId");
      const context = await getOperatorSenderContext(accountId);
      if (!context) {
        throw new Error("Sender account not found");
      }
      return {
        summary: `${context.account.fromEmail || context.account.name} is ${context.account.readyToSend ? "ready to send" : "not ready to send"} and is attached to ${context.brands.length} brand${context.brands.length === 1 ? "" : "s"}.`,
        result: context as unknown as Record<string, unknown>,
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "inspect_sender_delivery_evidence",
    riskLevel: "read",
    approvalMode: "none",
    description:
      "Inspect sender delivery evidence for warmup/control checks, Gmail inbox/spam placement, Mailpool spam checks, seed inbox results, sender readiness, and which sender emails are actually landing in inbox vs spam. Use this for deliverability/inboxing questions, not experiment questions.",
    previewTitle: "Inspect sender delivery evidence",
    run: inspectSenderDeliveryEvidence,
  },
  {
    name: "summarize_campaign_status",
    riskLevel: "read",
    approvalMode: "none",
    description: "Summarize user-facing campaign state for a brand or one campaign.",
    previewTitle: "Summarize campaign status",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const campaignId = asString(input.campaignId);
      if (campaignId) {
        const campaign = await getScaleCampaignOrThrow(brandId, campaignId);
        const runs = await listOwnerRuns(brandId, "campaign", campaign.id);
        const latestRun = runs[0] ?? null;
        return {
          summary: `${campaign.name} is ${campaign.status}${latestRun ? ` and its latest run is ${latestRun.status}` : ""}.`,
          result: {
            campaign,
            runSummary: {
              totalRuns: runs.length,
              latestRunId: latestRun?.id ?? "",
              latestRunStatus: latestRun?.status ?? "",
              latestRunMetrics: latestRun?.metrics ?? {},
            },
          },
        } satisfies OperatorToolResult;
      }

      const campaigns = await listScaleCampaignRecords(brandId);
      const counts = summarizeCampaignCounts(campaigns);
      return {
        summary: `This brand has ${counts.total} campaign${counts.total === 1 ? "" : "s"}: ${counts.active} active, ${counts.paused} paused, ${counts.draft} draft, and ${counts.completed} completed.`,
        result: {
          counts,
          campaigns: campaigns.map((campaign) => ({
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            sourceExperimentId: campaign.sourceExperimentId,
            lastRunId: campaign.lastRunId,
            updatedAt: campaign.updatedAt,
          })),
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "get_campaign_snapshot",
    riskLevel: "read",
    approvalMode: "none",
    description: "Inspect one promoted campaign, including run state and scale settings.",
    previewTitle: "Get campaign snapshot",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const campaignId = requireString(input, "campaignId");
      const campaign = await getScaleCampaignOrThrow(brandId, campaignId);
      const [runs, sourceExperiment] = await Promise.all([
        listOwnerRuns(brandId, "campaign", campaign.id),
        getExperimentRecordById(brandId, campaign.sourceExperimentId),
      ]);
      const latestRun = runs[0] ?? null;
      return {
        summary: `${campaign.name} is ${campaign.status}${latestRun ? ` and its latest run is ${latestRun.status}` : ""}.`,
        result: {
          campaign,
          sourceExperiment,
          runSummary: {
            totalRuns: runs.length,
            latestRunId: latestRun?.id ?? "",
            latestRunStatus: latestRun?.status ?? "",
            latestRunMetrics: latestRun?.metrics ?? {},
          },
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "summarize_experiments",
    riskLevel: "read",
    approvalMode: "none",
    description: "Summarize experiment state for a brand.",
    previewTitle: "Summarize experiments",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const context = await getOperatorBrandContext(brandId);
      if (!context) throw new Error("Brand not found");
      return {
        summary: `${context.brand.name} has ${context.experiments.total} experiment${context.experiments.total === 1 ? "" : "s"}: ${context.experiments.running} running, ${context.experiments.sourcing} sourcing, ${context.experiments.ready} ready, ${context.experiments.draft} draft, and ${context.experiments.completed} completed.`,
        result: context.experiments as unknown as Record<string, unknown>,
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "get_experiment_snapshot",
    riskLevel: "read",
    approvalMode: "none",
    description: "Inspect one experiment, including runtime mapping and recent runs.",
    previewTitle: "Get experiment snapshot",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const experimentId = requireString(input, "experimentId");
      const experiment = await getExperimentOrThrow(brandId, experimentId);
      const ownerRuns = await listOwnerRuns(brandId, "experiment", experiment.id);
      const runtimeRuns =
        experiment.runtime.campaignId && experiment.runtime.experimentId
          ? await listExperimentRuns(brandId, experiment.runtime.campaignId, experiment.runtime.experimentId)
          : [];
      const runs = ownerRuns.length ? ownerRuns : runtimeRuns;
      const latestRun = runs[0] ?? null;
      return {
        summary: `${experiment.name} is ${experiment.status}${latestRun ? ` and its latest run is ${latestRun.status}` : ""}.`,
        result: {
          experiment,
          runSummary: {
            totalRuns: runs.length,
            latestRunId: latestRun?.id ?? "",
            latestRunStatus: latestRun?.status ?? "",
            latestRunMetrics: latestRun?.metrics ?? {},
          },
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "summarize_leads",
    riskLevel: "read",
    approvalMode: "none",
    description: "Summarize brand leads and their current statuses.",
    previewTitle: "Summarize leads",
    run: async (input) => {
      const brand = await getBrandOrThrow(requireString(input, "brandId"));
      const counts = {
        total: brand.leads.length,
        new: brand.leads.filter((lead) => lead.status === "new").length,
        contacted: brand.leads.filter((lead) => lead.status === "contacted").length,
        qualified: brand.leads.filter((lead) => lead.status === "qualified").length,
        closed: brand.leads.filter((lead) => lead.status === "closed").length,
      };
      return {
        summary: `${brand.name} has ${counts.total} lead${counts.total === 1 ? "" : "s"}: ${counts.new} new, ${counts.contacted} contacted, ${counts.qualified} qualified, and ${counts.closed} closed.`,
        result: {
          counts,
          leads: brand.leads.slice(0, 20),
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "summarize_inbox",
    riskLevel: "read",
    approvalMode: "none",
    description: "Summarize reply inbox activity for a brand.",
    previewTitle: "Summarize inbox",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const inbox = await listReplyThreadsByBrand(brandId);
      const threads = inbox.threads;
      const topSubjects = threads.slice(0, 3).map((thread) => thread.subject).filter(Boolean);
      return {
        summary: `Inbox has ${threads.length} thread${threads.length === 1 ? "" : "s"} and ${inbox.drafts.length} draft${inbox.drafts.length === 1 ? "" : "s"}.`,
        result: {
          counts: {
            threads: threads.length,
            drafts: inbox.drafts.length,
            newThreads: threads.filter((thread) => thread.status === "new").length,
            openThreads: threads.filter((thread) => thread.status === "open").length,
            closedThreads: threads.filter((thread) => thread.status === "closed").length,
            positive: threads.filter((thread) => thread.sentiment === "positive").length,
            neutral: threads.filter((thread) => thread.sentiment === "neutral").length,
            negative: threads.filter((thread) => thread.sentiment === "negative").length,
          },
          topSubjects,
          threads: threads.slice(0, 10).map((thread) => ({
            id: thread.id,
            subject: thread.subject,
            sentiment: thread.sentiment,
            status: thread.status,
            intent: thread.intent,
            runId: thread.runId,
            leadId: thread.leadId,
            lastMessageAt: thread.lastMessageAt,
          })),
          drafts: inbox.drafts.slice(0, 10).map((draft) => ({
            id: draft.id,
            subject: draft.subject,
            status: draft.status,
            reason: draft.reason,
            threadId: draft.threadId,
            runId: draft.runId,
            createdAt: draft.createdAt,
          })),
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "investigate_brand_data",
    riskLevel: "read",
    approvalMode: "none",
    description:
      "Broad Codex-style read-only investigation across the active brand. Fetches raw reply bodies, sent message bodies, drafts, leads, runs, events, campaigns, experiments, sender/routing context, and related evidence. Use whenever the compact snapshot is not enough.",
    previewTitle: "Investigate brand data",
    run: investigateBrandData,
  },
  {
    name: "get_leadr_snapshot",
    riskLevel: "read",
    approvalMode: "none",
    description: "Inspect Leadr LinkedIn channel configuration, connected accounts, channel runs, and recent touches.",
    previewTitle: "Get Leadr snapshot",
    run: async (input) => {
      const snapshot = await getLeadrChannelSnapshot({
        brandId: asString(input.brandId),
        userId: asString(input.userId),
      });
      return {
        summary: snapshot.configured
          ? `Leadr has ${snapshot.accounts.length} LinkedIn account${snapshot.accounts.length === 1 ? "" : "s"} available and ${snapshot.runs.length} recorded channel run${snapshot.runs.length === 1 ? "" : "s"}.`
          : `Leadr is not fully configured. Missing ${snapshot.missingEnv.join(", ") || "configuration"}.`,
        result: snapshot as Record<string, unknown>,
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "list_leadr_accounts",
    riskLevel: "read",
    approvalMode: "none",
    description: "List LinkedIn accounts connected in Leadr and whether each one is runnable.",
    previewTitle: "List Leadr accounts",
    run: async (input) => {
      const accounts = await listLeadrAccounts({ userId: asString(input.userId) });
      return {
        summary: `Leadr returned ${accounts.length} LinkedIn account${accounts.length === 1 ? "" : "s"}.`,
        result: { accounts } as Record<string, unknown>,
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "create_leadr_auth_link",
    riskLevel: "safe_write",
    approvalMode: "none",
    description: "Create a hosted Leadr LinkedIn auth link for a user to connect a LinkedIn account.",
    previewTitle: "Create Leadr auth link",
    buildPreview: (input) =>
      buildSimplePreview(
        "Create Leadr auth link",
        `Create a LinkedIn connection link${asString(input.userId) ? ` for ${asString(input.userId)}` : ""}.`
      ),
    run: async (input) => {
      const link = await createLeadrLinkedInAuthLink({
        userId: asString(input.userId),
        redirectUrl: asString(input.redirectUrl),
      });
      return {
        summary: "Created a Leadr LinkedIn connection link.",
        result: link as Record<string, unknown>,
        receipt: {
          title: "Leadr auth link created",
          summary: "Use this link to connect a LinkedIn account in Leadr.",
          details: [link.url ? `URL: ${link.url}` : "Leadr did not return a URL."],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "gmail_ui_observe_account",
    riskLevel: "read",
    approvalMode: "none",
    description:
      "Observe the live Gmail UI worker browser session for a sender account, including login state, URL, title, and screenshot path. Input: accountId.",
    previewTitle: "Observe Gmail UI account",
    run: async (input) => {
      const accountId = requireString(input, "accountId");
      const snapshot = await getGmailUiWorkerSession(accountId);
      return {
        summary: `${snapshot.fromEmail || accountId} Gmail UI session is ${snapshot.loginState}: ${snapshot.prompt}`,
        result: snapshot as unknown as Record<string, unknown>,
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "gmail_ui_search_mailbox",
    riskLevel: "read",
    approvalMode: "none",
    description:
      "Search a live Gmail UI worker mailbox with Gmail search syntax and return the visible mailbox text excerpt plus screenshot path. Use this for discovery and orientation only; broad search results are not proof that a specific message was sent to a specific recipient. Input: accountId, query.",
    previewTitle: "Search Gmail UI mailbox",
    run: async (input) => {
      const accountId = requireString(input, "accountId");
      const query = requireString(input, "query");
      const result = await searchGmailUiWorkerMailbox(accountId, {
        query,
        ignoreConfiguredProxy:
          input.ignoreConfiguredProxy === undefined ? undefined : Boolean(input.ignoreConfiguredProxy),
        refreshMailpoolCredentials: input.refreshMailpoolCredentials !== false,
      });
      return {
        summary: `Searched ${result.fromEmail || accountId} Gmail UI mailbox for "${query}".`,
        result: result as unknown as Record<string, unknown>,
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "gmail_ui_verify_sent",
    riskLevel: "read",
    approvalMode: "none",
    description:
      "Verify from the live Gmail UI worker that an exact expected message exists in the sender's Sent Mail. This is the proof tool for specific sent-email claims; provide recipient plus subject and/or body. Input: accountId, recipient, subject and/or body.",
    previewTitle: "Verify Gmail UI sent mail",
    run: async (input) => {
      const accountId = requireString(input, "accountId");
      const recipient = requireString(input, "recipient");
      const subject = asString(input.subject);
      const body = asString(input.body);
      if (!subject && !body) {
        throw new Error("subject or body is required");
      }
      const result = await verifyGmailUiWorkerSentMessage(accountId, {
        recipient,
        subject,
        body,
        ignoreConfiguredProxy:
          input.ignoreConfiguredProxy === undefined ? undefined : Boolean(input.ignoreConfiguredProxy),
        refreshMailpoolCredentials: input.refreshMailpoolCredentials !== false,
      });
      return {
        summary: result.verification.verified
          ? `Verified the expected message in ${result.fromEmail || accountId} Sent Mail.`
          : `Could not verify the expected message in ${result.fromEmail || accountId} Sent Mail: ${result.verification.reason}`,
        result: result as unknown as Record<string, unknown>,
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "gmail_ui_send_message",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description:
      "Send a message through the live Gmail UI worker and require Sent Mail verification before reporting success. Input: accountId, recipient, subject, body, optional expectedFrom.",
    previewTitle: "Send Gmail UI message",
    buildPreview: (input) =>
      buildSimplePreview(
        "Send Gmail UI message",
        `Send "${asString(input.subject) || "email"}" to ${asString(input.recipient) || "the selected recipient"} through ${asString(input.accountId) || "the selected Gmail UI sender"}.`
      ),
    run: async (input) => {
      const accountId = requireString(input, "accountId");
      const recipient = requireString(input, "recipient");
      const subject = requireString(input, "subject");
      const body = requireString(input, "body");
      const result = await sendGmailUiWorkerMessage(accountId, {
        recipient,
        subject,
        body,
        expectedFrom: asString(input.expectedFrom),
        ignoreConfiguredProxy:
          input.ignoreConfiguredProxy === undefined ? undefined : Boolean(input.ignoreConfiguredProxy),
        refreshMailpoolCredentials: input.refreshMailpoolCredentials !== false,
      });
      if (!result.ok) {
        throw new Error(result.error || "Gmail UI worker did not verify the send.");
      }
      return {
        summary: `Sent and verified "${subject}" to ${recipient} through ${result.fromEmail || accountId}.`,
        result: result as unknown as Record<string, unknown>,
        receipt: {
          title: "Gmail UI message sent",
          summary: `Sent "${subject}" to ${recipient}.`,
          details: [
            result.sentVerified ? "Sent Mail verification passed." : "Sent Mail verification did not pass.",
            result.providerMessageId ? `Provider message id: ${result.providerMessageId}` : "No provider id returned.",
          ],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "gmail_ui_close_session",
    riskLevel: "safe_write",
    approvalMode: "none",
    description: "Close a live Gmail UI worker browser session for a sender account. Input: accountId.",
    previewTitle: "Close Gmail UI session",
    buildPreview: (input) =>
      buildSimplePreview(
        "Close Gmail UI session",
        `Close Gmail UI worker session for ${asString(input.accountId) || "the selected sender"}.`
      ),
    run: async (input) => {
      const accountId = requireString(input, "accountId");
      const result = await closeGmailUiWorkerSession(accountId);
      return {
        summary: result.closed
          ? `Closed Gmail UI worker session for ${accountId}.`
          : `No open Gmail UI worker session existed for ${accountId}.`,
        result: result as Record<string, unknown>,
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "refresh_mailpool_sender",
    riskLevel: "safe_write",
    approvalMode: "none",
    description: "Refresh a Mailpool sender, syncing mailbox state and bootstrapping deliverability.",
    previewTitle: "Refresh Mailpool sender",
    buildPreview: (input) =>
      buildSimplePreview(
        "Refresh Mailpool sender",
        `Refresh Mailpool state for ${asString(input.accountId) || "the selected sender"}.`
      ),
    run: async (input) => {
      const accountId = requireString(input, "accountId");
      const result = await refreshMailpoolOutreachAccount(accountId);
      const fromEmail = result.account.config.customerIo.fromEmail || result.account.name;
      const spamSummary = result.account.config.mailpool.lastSpamCheckSummary.trim();
      const deliverabilityDetails = [
        result.domain?.domain ? `Domain: ${result.domain.domain}` : "No Mailpool domain match was found.",
        spamSummary ? `Spam check: ${spamSummary}` : "Spam check: not available yet.",
        "Inbox placement: handled by the internal monitor pool.",
        result.mailboxDeleted ? "Mailbox is deleted in Mailpool." : "Mailbox still exists in Mailpool.",
        ...result.deliverabilityKickoffErrors.slice(0, 2),
      ];
      return {
        summary:
          result.deliverabilityKickoffErrors.length > 0
            ? `${fromEmail} refreshed. Spam checks were synced, but one or more Mailpool refresh checks still need attention.`
            : `${fromEmail} refreshed. Mailpool status is ${result.account.config.mailpool.status}.`,
        result: result as unknown as Record<string, unknown>,
        receipt: {
          title: "Mailpool sender refreshed",
          summary: `${result.account.name} was refreshed from Mailpool.`,
          details: deliverabilityDetails,
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "provision_mailpool_sender",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description: "Buy or attach a Mailpool domain, create a sender mailbox, and assign it to the brand.",
    previewTitle: "Provision Mailpool sender",
    buildPreview: buildProvisionPreview,
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const result = await provisionSender({
        brandId,
        provider: "mailpool",
        accountName: asString(input.accountName),
        assignToBrand: input.assignToBrand !== false,
        selectedMailboxAccountId: asString(input.selectedMailboxAccountId),
        domainMode: asString(input.domainMode) === "register" ? "register" : "existing",
        domain: requireString(input, "domain"),
        fromLocalPart: requireString(input, "fromLocalPart"),
        senderFirstName: requireString(input, "senderFirstName"),
        senderLastName: requireString(input, "senderLastName"),
        autoPickCustomerIoAccount: false,
        customerIoSourceAccountId: "",
        forwardingTargetUrl: asString(input.forwardingTargetUrl),
        customerIoSiteId: "",
        customerIoTrackingApiKey: "",
        customerIoAppApiKey: "",
        mailpoolApiKey: asString(input.mailpoolApiKey),
        namecheapApiUser: "",
        namecheapUserName: "",
        namecheapApiKey: "",
        namecheapClientIp: "",
        registrant: buildRegistrant(input.registrant),
      });
      return {
        summary: `Provisioned ${result.fromEmail} for ${result.brand.name}.`,
        result: result as unknown as Record<string, unknown>,
        receipt: {
          title: "Sender provisioning started",
          summary: `${result.fromEmail} is now attached to ${result.brand.name}.`,
          details: [
            `Domain: ${result.domain}`,
            result.readyToSend ? "Sender is ready to send." : "Sender is still settling and not ready to send yet.",
            ...(result.warnings ?? []).slice(0, 3),
          ],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "create_brand",
    riskLevel: "safe_write",
    approvalMode: "none",
    description: "Create a new brand.",
    previewTitle: "Create brand",
    run: async (input) => {
      const brand = await createBrand({
        name: requireString(input, "name"),
        website: asString(input.website),
        tone: asString(input.tone),
        notes: asString(input.notes),
        product: asString(input.product),
        targetMarkets: asStringArray(input.targetMarkets),
        idealCustomerProfiles: asStringArray(input.idealCustomerProfiles),
        keyFeatures: asStringArray(input.keyFeatures),
        keyBenefits: asStringArray(input.keyBenefits),
      });
      return {
        summary: `Created brand ${brand.name}.`,
        result: { brand } as Record<string, unknown>,
        receipt: {
          title: "Brand created",
          summary: `${brand.name} is ready.`,
          details: [brand.website ? `Website: ${brand.website}` : "Website was not provided."],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "update_brand",
    riskLevel: "safe_write",
    approvalMode: "none",
    description: "Update brand profile fields like website, notes, tone, product, and ICPs.",
    previewTitle: "Update brand",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const patch = buildBrandPatch(input);
      if (!Object.keys(patch).length) {
        throw new Error("No brand fields were provided");
      }
      const brand = await updateBrand(brandId, patch);
      if (!brand) throw new Error("Brand not found");
      return {
        summary: `Updated ${brand.name}.`,
        result: { brand } as Record<string, unknown>,
        receipt: {
          title: "Brand updated",
          summary: `${brand.name} was updated.`,
          details: Object.keys(patch).map((key) => `Updated ${key}.`),
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "delete_brand",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description: "Delete a brand and its associated campaign records.",
    previewTitle: "Delete brand",
    buildPreview: (input) =>
      buildSimplePreview(
        "Delete brand",
        `Delete ${asString(input.brandName) || asString(input.brandId) || "this brand"} and its campaign records.`
      ),
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const brand = await getBrandOrThrow(brandId);
      const deleted = await deleteBrand(brandId);
      if (!deleted) throw new Error("Brand not found");
      return {
        summary: `Deleted ${brand.name}.`,
        result: { deletedId: brandId, brandName: brand.name },
        receipt: {
          title: "Brand deleted",
          summary: `${brand.name} was deleted.`,
          details: [],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "add_brand_lead",
    riskLevel: "safe_write",
    approvalMode: "none",
    description: "Add a lead to a brand.",
    previewTitle: "Add lead",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const brand = await getBrandOrThrow(brandId);
      const lead: LeadRow = {
        id: createId("lead"),
        name: requireString(input, "name"),
        channel: asString(input.channel),
        status: normalizeLeadStatus(input.status),
        lastTouch: asString(input.lastTouch) || nowIso(),
      };
      const updatedBrand = await updateBrand(brand.id, {
        leads: [lead, ...brand.leads],
      });
      if (!updatedBrand) throw new Error("Brand not found");
      return {
        summary: `Added ${lead.name} to ${brand.name}.`,
        result: { brand: updatedBrand, lead } as Record<string, unknown>,
        receipt: {
          title: "Lead added",
          summary: `${lead.name} was added to ${brand.name}.`,
          details: [lead.channel ? `Channel: ${lead.channel}` : "No channel was set."],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "update_brand_lead",
    riskLevel: "safe_write",
    approvalMode: "none",
    description: "Update a lead's status or metadata on a brand.",
    previewTitle: "Update lead",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const brand = await getBrandOrThrow(brandId);
      const lead = findLead(brand, input);
      if (!lead) throw new Error("Lead not found");
      const nextLeads = brand.leads.map((row) =>
        row.id === lead.id
          ? {
              ...row,
              ...(typeof input.name === "string" ? { name: asString(input.name) } : {}),
              ...(typeof input.channel === "string" ? { channel: asString(input.channel) } : {}),
              ...(input.status !== undefined ? { status: normalizeLeadStatus(input.status) } : {}),
              ...(typeof input.lastTouch === "string"
                ? { lastTouch: asString(input.lastTouch) }
                : {}),
            }
          : row
      );
      const updatedBrand = await updateBrand(brand.id, { leads: nextLeads });
      if (!updatedBrand) throw new Error("Brand not found");
      const updatedLead = nextLeads.find((row) => row.id === lead.id) ?? lead;
      return {
        summary: `Updated ${updatedLead.name}.`,
        result: { brand: updatedBrand, lead: updatedLead } as Record<string, unknown>,
        receipt: {
          title: "Lead updated",
          summary: `${updatedLead.name} was updated.`,
          details: [`Status: ${updatedLead.status}`],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "create_experiment",
    riskLevel: "safe_write",
    approvalMode: "none",
    description: "Create a new experiment for a brand.",
    previewTitle: "Create experiment",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const brand = await getBrandOrThrow(brandId);
      const experiment = await createExperimentRecord({
        brandId,
        name: requireString(input, "name"),
        offer: asString(input.offer),
        audience: asString(input.audience),
        createRuntime: input.createRuntime !== false,
      });
      return {
        summary: `Created experiment ${experiment.name} for ${brand.name}.`,
        result: { experiment } as Record<string, unknown>,
        receipt: {
          title: "Experiment created",
          summary: `${experiment.name} is ready to edit.`,
          details: [
            experiment.offer ? `Offer: ${experiment.offer}` : "Offer is still blank.",
            experiment.audience ? `Audience: ${experiment.audience}` : "Audience is still blank.",
          ],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "update_experiment",
    riskLevel: "safe_write",
    approvalMode: "none",
    description: "Update experiment fields like name, status, offer, audience, and test settings.",
    previewTitle: "Update experiment",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const experimentId = requireString(input, "experimentId");
      const existing = await getExperimentOrThrow(brandId, experimentId);
      const patch: Parameters<typeof updateExperimentRecord>[2] = {};
      if (typeof input.name === "string") patch.name = asString(input.name);
      if (typeof input.offer === "string") patch.offer = asString(input.offer);
      if (typeof input.audience === "string") patch.audience = asString(input.audience);
      const status = asString(input.status).toLowerCase();
      if (
        ["draft", "ready", "running", "paused", "completed", "promoted", "archived"].includes(status)
      ) {
        patch.status = status as NonNullable<typeof patch.status>;
      }
      const testEnvelope = asRecord(input.testEnvelope);
      if (Object.keys(testEnvelope).length) {
        patch.testEnvelope = {
          sampleSize: Math.max(1, asNumber(testEnvelope.sampleSize, existing.testEnvelope.sampleSize)),
          durationDays: Math.max(1, asNumber(testEnvelope.durationDays, existing.testEnvelope.durationDays)),
          dailyCap: Math.max(1, asNumber(testEnvelope.dailyCap, existing.testEnvelope.dailyCap)),
          hourlyCap: Math.max(1, asNumber(testEnvelope.hourlyCap, existing.testEnvelope.hourlyCap)),
          timezone: asString(testEnvelope.timezone) || existing.testEnvelope.timezone,
          minSpacingMinutes: Math.max(
            1,
            asNumber(testEnvelope.minSpacingMinutes, existing.testEnvelope.minSpacingMinutes)
          ),
          oneContactPerCompany:
            testEnvelope.oneContactPerCompany === undefined
              ? existing.testEnvelope.oneContactPerCompany
              : Boolean(testEnvelope.oneContactPerCompany),
          businessHoursEnabled:
            testEnvelope.businessHoursEnabled === undefined
              ? existing.testEnvelope.businessHoursEnabled
              : Boolean(testEnvelope.businessHoursEnabled),
          businessHoursStartHour: Math.max(
            0,
            Math.min(
              23,
              Math.round(
                asNumber(testEnvelope.businessHoursStartHour, existing.testEnvelope.businessHoursStartHour ?? 9)
              )
            )
          ),
          businessHoursEndHour: Math.max(
            1,
            Math.min(
              24,
              Math.round(
                asNumber(testEnvelope.businessHoursEndHour, existing.testEnvelope.businessHoursEndHour ?? 17)
              )
            )
          ),
          businessDays: Array.isArray(testEnvelope.businessDays)
            ? testEnvelope.businessDays
                .map((value) => Math.round(asNumber(value)))
                .filter((value) => Number.isFinite(value) && value >= 0 && value <= 6)
            : existing.testEnvelope.businessDays,
        };
      }
      const successMetric = asRecord(input.successMetric);
      if (Object.keys(successMetric).length) {
        patch.successMetric = {
          metric: "reply_rate",
          thresholdPct: Math.max(
            0,
            asNumber(successMetric.thresholdPct, existing.successMetric.thresholdPct)
          ),
        };
      }
      if (!Object.keys(patch).length) {
        throw new Error("No experiment fields were provided");
      }
      const experiment = await updateExperimentRecord(brandId, experimentId, patch);
      if (!experiment) throw new Error("Experiment not found");
      return {
        summary: `Updated ${experiment.name}.`,
        result: { experiment } as Record<string, unknown>,
        receipt: {
          title: "Experiment updated",
          summary: `${experiment.name} was updated.`,
          details: Object.keys(patch).map((key) => `Updated ${key}.`),
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "delete_experiment",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description: "Delete an experiment.",
    previewTitle: "Delete experiment",
    buildPreview: (input) =>
      buildSimplePreview(
        "Delete experiment",
        `Delete ${asString(input.experimentName) || asString(input.experimentId) || "this experiment"}.`
      ),
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const experimentId = requireString(input, "experimentId");
      const experiment = await getExperimentOrThrow(brandId, experimentId);
      const deleted = await deleteExperimentRecord(brandId, experimentId);
      if (!deleted) throw new Error("Experiment not found");
      return {
        summary: `Deleted ${experiment.name}.`,
        result: { deletedId: experimentId, experimentName: experiment.name },
        receipt: {
          title: "Experiment deleted",
          summary: `${experiment.name} was deleted.`,
          details: [],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "launch_experiment_run",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description: "Launch an experiment run.",
    previewTitle: "Launch experiment",
    buildPreview: (input) =>
      buildSimplePreview(
        "Launch experiment",
        `Launch ${asString(input.experimentName) || asString(input.experimentId) || "the selected experiment"}.`
      ),
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const experimentId = requireString(input, "experimentId");
      const existing = await getExperimentOrThrow(brandId, experimentId);
      const experiment = await ensureRuntimeForExperiment(existing);
      if (!experiment.runtime.campaignId || !experiment.runtime.experimentId) {
        throw new Error("Experiment runtime is not configured");
      }

      const prospectTable = await getEnrichAnythingProspectTableState(
        buildExperimentProspectTableConfig(experiment)
      );
      const leadTarget = getExperimentVerifiedEmailLeadTarget(experiment);
      if (prospectTable.rowCount < leadTarget) {
        throw new Error(
          `Prospect validation failed: need at least ${leadTarget} saved leads before launch.`
        );
      }

      const sendableSummary = await countExperimentSendableLeadContacts(brandId, experiment.id);
      if (sendableSummary.sendableLeadCount < leadTarget) {
        throw new Error("Launch is still preparing contacts with work emails.");
      }

      const result = await launchExperimentRun({
        brandId,
        campaignId: experiment.runtime.campaignId,
        experimentId: experiment.runtime.experimentId,
        trigger: "manual",
        ownerType: "experiment",
        ownerId: experiment.id,
      });
      if (!result.ok) {
        await updateExperimentRecord(brandId, experiment.id, { status: "ready" });
        throw new Error(result.hint ? `${result.reason} ${result.hint}` : result.reason);
      }

      await updateExperimentRecord(brandId, experiment.id, { status: "running" });
      try {
        await ensureEnrichAnythingProspectTable(
          buildExperimentProspectTableConfig(experiment, { enabled: true })
        );
      } catch {
        // Best effort only.
      }

      return {
        summary: `${experiment.name} is queued to launch.`,
        result: { runId: result.runId, experimentId: experiment.id } as Record<string, unknown>,
        receipt: {
          title: "Experiment launched",
          summary: `${experiment.name} is queued.`,
          details: [`Run id: ${result.runId}`],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "control_experiment_run",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description: "Pause, resume, or cancel an experiment run.",
    previewTitle: "Control experiment run",
    buildPreview: (input) =>
      buildSimplePreview(
        "Control experiment run",
        `${asString(input.action) || "Update"} ${asString(input.experimentName) || asString(input.experimentId) || "the selected experiment run"}.`
      ),
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const experimentId = requireString(input, "experimentId");
      const action = asString(input.action).toLowerCase();
      if (!["pause", "resume", "cancel"].includes(action)) {
        throw new Error("action must be pause, resume, or cancel");
      }
      const { experiment, run } = await resolveExperimentRunTarget({
        brandId,
        experimentId,
        runId: asString(input.runId),
      });
      const result = await updateRunControl({
        brandId,
        campaignId: run.campaignId,
        runId: run.id,
        action: action as "pause" | "resume" | "cancel",
        reason: asString(input.reason) || undefined,
      });
      if (!result.ok) throw new Error(result.reason);
      return {
        summary: `${experiment.name}: ${result.reason}.`,
        result: { runId: run.id, action, experimentId: experiment.id } as Record<string, unknown>,
        receipt: {
          title: "Experiment run updated",
          summary: `${experiment.name}: ${result.reason}.`,
          details: [`Run id: ${run.id}`],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "promote_experiment_to_campaign",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description: "Promote a tested experiment into a campaign.",
    previewTitle: "Promote experiment",
    buildPreview: (input) =>
      buildSimplePreview(
        "Promote experiment to campaign",
        `Promote ${asString(input.experimentName) || asString(input.experimentId) || "the selected experiment"} into a campaign.`
      ),
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const experimentId = requireString(input, "experimentId");
      const campaign = await promoteExperimentRecordToCampaign({
        brandId,
        experimentId,
        campaignName: asString(input.campaignName) || undefined,
      });
      return {
        summary: `Promoted experiment into ${campaign.name}.`,
        result: { campaign } as Record<string, unknown>,
        receipt: {
          title: "Campaign created",
          summary: `${campaign.name} was created from the experiment.`,
          details: [`Source experiment: ${campaign.sourceExperimentId}`],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "update_campaign",
    riskLevel: "safe_write",
    approvalMode: "none",
    description: "Update a promoted campaign's name, status, or scale policy.",
    previewTitle: "Update campaign",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const campaignId = requireString(input, "campaignId");
      const existing = await getScaleCampaignOrThrow(brandId, campaignId);
      const patch: Parameters<typeof updateScaleCampaignRecord>[2] = {};
      if (typeof input.name === "string") patch.name = asString(input.name);
      const status = asString(input.status).toLowerCase();
      if (["draft", "active", "paused", "completed", "archived"].includes(status)) {
        patch.status = status as NonNullable<typeof patch.status>;
      }
      const scalePolicyInput = asRecord(input.scalePolicy);
      if (
        Object.keys(scalePolicyInput).length ||
        typeof input.accountId === "string" ||
        typeof input.mailboxAccountId === "string"
      ) {
        patch.scalePolicy = {
          dailyCap: Math.max(
            1,
            asNumber(scalePolicyInput.dailyCap, existing.scalePolicy.dailyCap)
          ),
          hourlyCap: Math.max(
            1,
            asNumber(scalePolicyInput.hourlyCap, existing.scalePolicy.hourlyCap)
          ),
          timezone: asString(scalePolicyInput.timezone) || existing.scalePolicy.timezone,
          minSpacingMinutes: Math.max(
            1,
            asNumber(scalePolicyInput.minSpacingMinutes, existing.scalePolicy.minSpacingMinutes)
          ),
          accountId: asString(input.accountId) || asString(scalePolicyInput.accountId) || existing.scalePolicy.accountId,
          mailboxAccountId:
            asString(input.mailboxAccountId) ||
            asString(scalePolicyInput.mailboxAccountId) ||
            existing.scalePolicy.mailboxAccountId,
          safetyMode:
            asString(scalePolicyInput.safetyMode) === "balanced" ? "balanced" : existing.scalePolicy.safetyMode,
        };
      }
      if (!Object.keys(patch).length) {
        throw new Error("No campaign fields were provided");
      }
      const campaign = await updateScaleCampaignRecord(brandId, campaignId, patch);
      if (!campaign) throw new Error("Campaign not found");
      return {
        summary: `Updated ${campaign.name}.`,
        result: { campaign } as Record<string, unknown>,
        receipt: {
          title: "Campaign updated",
          summary: `${campaign.name} was updated.`,
          details: Object.keys(patch).map((key) => `Updated ${key}.`),
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "delete_campaign",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description: "Delete a promoted campaign.",
    previewTitle: "Delete campaign",
    buildPreview: (input) =>
      buildSimplePreview(
        "Delete campaign",
        `Delete ${asString(input.campaignName) || asString(input.campaignId) || "this campaign"}.`
      ),
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const campaignId = requireString(input, "campaignId");
      const campaign = await getScaleCampaignOrThrow(brandId, campaignId);
      const deleted = await deleteScaleCampaignRecord(brandId, campaignId);
      if (!deleted) throw new Error("Campaign not found");
      return {
        summary: `Deleted ${campaign.name}.`,
        result: { deletedId: campaignId, campaignName: campaign.name },
        receipt: {
          title: "Campaign deleted",
          summary: `${campaign.name} was deleted.`,
          details: [],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "launch_campaign_run",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description: "Launch a campaign run.",
    previewTitle: "Launch campaign",
    buildPreview: (input) =>
      buildSimplePreview(
        "Launch campaign",
        `Launch ${asString(input.campaignName) || asString(input.campaignId) || "the selected campaign"}.`
      ),
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const campaignId = requireString(input, "campaignId");
      const campaign = await getScaleCampaignOrThrow(brandId, campaignId);
      const result = await launchScaleCampaignRun({
        brandId,
        scaleCampaignId: campaign.id,
        trigger: "manual",
      });
      if (!result.ok) {
        throw new Error(result.hint ? `${result.reason} ${result.hint}` : result.reason);
      }
      return {
        summary: `${campaign.name} is queued to launch.`,
        result: { runId: result.runId, campaignId: campaign.id } as Record<string, unknown>,
        receipt: {
          title: "Campaign launched",
          summary: `${campaign.name} is queued.`,
          details: [`Run id: ${result.runId}`],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "control_campaign_run",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description:
      "Pause, resume, cancel, or deliverability-control a campaign run. Use probe_all_senders_deliverability to compare Gmail UI, Mailpool SMTP, and Customer.io transports with the same live campaign copy before choosing a route.",
    previewTitle: "Control campaign run",
    buildPreview: (input) =>
      buildSimplePreview(
        "Control campaign run",
        `${asString(input.action) || "Update"} ${asString(input.campaignName) || asString(input.campaignId) || "the selected campaign run"}.`
      ),
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const campaignId = requireString(input, "campaignId");
      const action = asString(input.action).toLowerCase();
      if (
        ![
          "pause",
          "resume",
          "cancel",
          "probe_deliverability",
          "probe_all_senders_deliverability",
          "resume_sender_deliverability",
          "seed_inbox_placement",
        ].includes(action)
      ) {
        throw new Error(
          "action must be pause, resume, cancel, probe_deliverability, probe_all_senders_deliverability, resume_sender_deliverability, or seed_inbox_placement"
        );
      }
      const { campaign, run } = await resolveCampaignRunTarget({
        brandId,
        campaignId,
        runId: asString(input.runId),
      });
      const result = await updateRunControl({
        brandId,
        campaignId: run.campaignId,
        runId: run.id,
        action: action as
          | "pause"
          | "resume"
          | "cancel"
          | "probe_deliverability"
          | "probe_all_senders_deliverability"
          | "resume_sender_deliverability"
          | "seed_inbox_placement",
        reason: asString(input.reason) || undefined,
        senderAccountId: asString(input.senderAccountId) || undefined,
        recipientEmail: asString(input.recipientEmail) || undefined,
      });
      if (!result.ok) throw new Error(result.reason);
      return {
        summary: `${campaign.name}: ${result.reason}.`,
        result: { runId: run.id, campaignId: campaign.id, action } as Record<string, unknown>,
        receipt: {
          title: "Campaign run updated",
          summary: `${campaign.name}: ${result.reason}.`,
          details: [`Run id: ${run.id}`],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "create_leadr_campaign",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description:
      "Launch a LinkedIn campaign through Leadr from a connected LinkedIn account, using the actual campaign copy.",
    previewTitle: "Create Leadr campaign",
    buildPreview: (input) =>
      buildSimplePreview(
        "Create Leadr campaign",
        `Launch ${asString(input.name) || "a LinkedIn campaign"} through Leadr with ${
          asNumber(input.limit, 25) || 25
        } target${(asNumber(input.limit, 25) || 25) === 1 ? "" : "s"}.`
      ),
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const result = await createLeadrLinkedInCampaign({
        brandId,
        missionId: asString(input.missionId),
        userId: asString(input.userId),
        accountId: requireString(input, "accountId"),
        campaignUrl: asString(input.campaignUrl),
        sourceType: asString(input.sourceType) as Parameters<typeof createLeadrLinkedInCampaign>[0]["sourceType"],
        managedWorkspaceId: asString(input.managedWorkspaceId),
        managedTableId: asString(input.managedTableId),
        enrichanythingOrigin: asString(input.enrichanythingOrigin),
        name: asString(input.name),
        message: requireString(input, "message"),
        limit: Math.max(1, asNumber(input.limit, 25)),
        invite: input.invite !== false,
        timeZone: asString(input.timeZone),
        startTime: asString(input.startTime),
        daysOfWeek: asStringArray(input.daysOfWeek),
        workflowActionOrder: asStringArray(input.workflowActionOrder),
        sourceRunId: asString(input.sourceRunId),
        sourceCampaignId: asString(input.sourceCampaignId),
        sourceExperimentId: asString(input.sourceExperimentId),
        targetSummary: asString(input.targetSummary),
      });
      return {
        summary: `${result.channelRun.name || "Leadr campaign"} is queued in Leadr.`,
        result: result as unknown as Record<string, unknown>,
        receipt: {
          title: "Leadr campaign created",
          summary: result.providerCampaign?.id
            ? `${result.channelRun.name} is linked to Leadr campaign ${result.providerCampaign.id}.`
            : `${result.channelRun.name} was accepted by Leadr; provider id is still pending.`,
          details: [
            `Channel run: ${result.channelRun.id}`,
            result.providerCampaign?.id ? `Provider campaign: ${result.providerCampaign.id}` : "Provider campaign id not found yet.",
            `LinkedIn account: ${result.account.name || result.account.accountId}`,
          ],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "sync_leadr_campaign",
    riskLevel: "safe_write",
    approvalMode: "none",
    description: "Sync a Leadr LinkedIn campaign's status, touches, and replies back into LastB2B.",
    previewTitle: "Sync Leadr campaign",
    buildPreview: (input) =>
      buildSimplePreview(
        "Sync Leadr campaign",
        `Sync ${asString(input.channelRunId) || "the selected Leadr channel run"}.`
      ),
    run: async (input) => {
      const result = await syncLeadrLinkedInCampaign({
        channelRunId: requireString(input, "channelRunId"),
        userId: asString(input.userId),
      });
      return {
        summary: `Synced Leadr channel run ${result.channelRun.id}; ${result.touchesUpserted} touch${result.touchesUpserted === 1 ? "" : "es"} recorded.`,
        result: result as unknown as Record<string, unknown>,
        receipt: {
          title: "Leadr campaign synced",
          summary: `${result.channelRun.name || result.channelRun.id} is now ${result.channelRun.status}.`,
          details: [
            `Channel run: ${result.channelRun.id}`,
            `Touches recorded: ${result.touchesUpserted}`,
          ],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "resume_leadr_campaign",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description: "Resume a halted Leadr LinkedIn campaign using its stored account and campaign IDs.",
    previewTitle: "Resume Leadr campaign",
    buildPreview: (input) =>
      buildSimplePreview(
        "Resume Leadr campaign",
        `Resume ${asString(input.channelRunId) || "the selected Leadr channel run"}.`
      ),
    run: async (input) => {
      const result = await resumeLeadrLinkedInCampaign({
        channelRunId: requireString(input, "channelRunId"),
        userId: asString(input.userId),
      });
      return {
        summary: `Resumed Leadr channel run ${result.channelRun.id}.`,
        result: result as unknown as Record<string, unknown>,
        receipt: {
          title: "Leadr campaign resumed",
          summary: `${result.channelRun.name || result.channelRun.id} was resumed.`,
          details: [`Channel run: ${result.channelRun.id}`],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "send_reply_draft",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description: "Send an existing inbox reply draft.",
    previewTitle: "Send reply draft",
    buildPreview: (input) =>
      buildSimplePreview(
        "Send reply draft",
        `Send ${asString(input.draftSubject) || asString(input.draftId) || "the selected reply draft"}.`
      ),
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const draftId = requireString(input, "draftId");
      const draft = await getReplyDraft(draftId);
      if (!draft || draft.brandId !== brandId) throw new Error("Reply draft not found");
      const thread = await getReplyThread(draft.threadId);
      const result = await approveReplyDraftAndSend({ brandId, draftId });
      if (!result.ok) throw new Error(result.reason);
      return {
        summary: `Sent the reply draft${thread?.subject ? ` for "${thread.subject}"` : ""}.`,
        result: { draftId, threadId: draft.threadId, message: result.reason },
        receipt: {
          title: "Reply sent",
          summary: thread?.subject
            ? `Sent the reply draft for "${thread.subject}".`
            : "Sent the reply draft.",
          details: [draft.subject ? `Subject: ${draft.subject}` : "No subject."],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "dismiss_reply_draft",
    riskLevel: "safe_write",
    approvalMode: "none",
    description: "Dismiss an inbox reply draft without sending it.",
    previewTitle: "Dismiss reply draft",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const draftId = requireString(input, "draftId");
      const draft = await getReplyDraft(draftId);
      if (!draft || draft.brandId !== brandId) throw new Error("Reply draft not found");
      if (draft.status !== "draft") {
        throw new Error("Draft is already sent or dismissed");
      }
      const updated = await updateReplyDraft(draftId, { status: "dismissed", sentAt: "" });
      if (!updated) throw new Error("Reply draft not found");
      return {
        summary: `Dismissed the reply draft${draft.subject ? ` "${draft.subject}"` : ""}.`,
        result: { draft: updated } as Record<string, unknown>,
        receipt: {
          title: "Reply draft dismissed",
          summary: draft.subject
            ? `Dismissed "${draft.subject}".`
            : "Dismissed the reply draft.",
          details: [draft.reason ? `Reason: ${draft.reason}` : "No draft reason."],
        },
      } satisfies OperatorToolResult;
    },
  },
];

export function listOperatorToolSpecs() {
  return [...TOOL_SPECS];
}

export function getOperatorToolSpec(name: OperatorToolName) {
  return TOOL_SPECS.find((tool) => tool.name === name) ?? null;
}
