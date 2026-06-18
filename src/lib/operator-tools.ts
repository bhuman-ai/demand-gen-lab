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
  EmailVerificationState,
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
import { importScaleCampaignProspectRows } from "@/lib/scale-campaign-prospect-import";
import {
  extractFirstEmailAddress,
  hasAirscalePeopleSourcingConfig,
  sourceLeadsFromAirscalePeopleSearch,
} from "@/lib/outreach-providers";
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
  resolveScaleCampaignLane,
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
import { createMissionEvent, createMissionLearning } from "@/lib/mission-data";
import type { OperatorToolName, OperatorToolResult, OperatorToolSpec } from "@/lib/operator-types";
import {
  getCampaignPrepTask,
  getOutreachAccount,
  getOutreachRun,
  getReplyDraft,
  getReplyThread,
  getReplyThreadState,
  createOutreachEvent,
  createOutreachRun,
  createRunMessages,
  enqueueOutreachJob,
  listRunJobs,
  listDeliverabilityProbeRuns,
  listReplyMessagesByThread,
  listReplyThreadFeedback,
  listExperimentRuns,
  listOwnerRuns,
  listRunEvents,
  listRunLeads,
  listRunMessages,
  listReplyThreadsByBrand,
  updateOutreachRun,
  updateOutreachAccount,
  updateReplyDraft,
  upsertRunLeads,
} from "@/lib/outreach-data";
import { provisionSender } from "@/lib/outreach-provisioning";
import {
  approveReplyDraftAndSend,
  launchExperimentRun,
  launchScaleCampaignRun,
  updateRunControl,
} from "@/lib/outreach-runtime";
import { buildOutreachStatusResponse } from "@/lib/outreach-status";
import {
  getOutreachAccountFromEmail,
  isOutreachOutboundEnabled,
} from "@/lib/outreach-account-helpers";
import { isDeliverabilitySeedSendingDisabledReason } from "@/lib/sender-health";
import { readWarmupIntelligenceSnapshot } from "@/lib/warmup-intelligence";

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

function normalizeAttentionUrgency(value: unknown) {
  const normalized = asString(value).toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "low") return "low";
  return "normal";
}

function attentionSuggestedActions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      return {
        label: asString(row.label),
        message: asString(row.message),
      };
    })
    .filter((entry) => entry.label && entry.message)
    .slice(0, 5);
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

function buildCustomerIoProvisionPreview(input: Record<string, unknown>) {
  const domain = asString(input.domain) || "new Customer.io sender domain";
  const fromLocalPart = asString(input.fromLocalPart) || "sender local-part";
  const rawDomainMode = asString(input.domainMode);
  const domainMode =
    rawDomainMode === "register" ? "register" : rawDomainMode === "transfer" ? "transfer" : "existing";
  return {
    title: "Add Customer.io sender",
    summary:
      domainMode === "register"
        ? `Buy ${domain} through the configured registrar, create ${fromLocalPart}@${domain} in Customer.io, apply DNS, and attach it to the brand.`
        : `Use ${domain}, create ${fromLocalPart}@${domain} in Customer.io, apply DNS, and attach it to the brand.`,
    domainMode,
    domain,
    fromLocalPart,
  };
}

function buildSimplePreview(title: string, summary: string) {
  return { title, summary };
}

function inputStringList(...values: unknown[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const source = Array.isArray(value)
      ? value
      : String(value ?? "")
          .split(/[\n,]/g)
          .map((entry) => entry.trim());
    for (const item of source) {
      const normalized = asString(item);
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
    }
  }
  return out;
}

function compactSourcingText(value: unknown, max = 120) {
  const normalized = asString(value);
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  const slice = normalized.slice(0, max);
  const breakAt = slice.lastIndexOf(" ");
  return (breakAt > 40 ? slice.slice(0, breakAt) : slice).trim();
}

function defaultAirscaleKeywords(input: {
  brand: BrandRecord | null;
  campaign: ScaleCampaignRecord | null;
}) {
  return inputStringList(
    input.campaign?.snapshot.offer,
    input.campaign?.snapshot.audience,
    input.brand?.product,
    input.brand?.targetMarkets,
    input.brand?.idealCustomerProfiles,
    input.brand?.keyFeatures
  )
    .map((value) => compactSourcingText(value))
    .filter(Boolean)
    .slice(0, 6);
}

function buildAirscaleSourcingPreview(input: Record<string, unknown>) {
  const campaignId = asString(input.campaignId);
  const maxResults = Math.max(1, Math.min(100, asNumber(input.maxResults ?? input.limit ?? input.size, 25)));
  const keywords = inputStringList(input.keywords, input.keyword, input.query).slice(0, 4);
  return {
    title: "Source people with Airscale",
    summary: campaignId
      ? `Search Airscale and import up to ${maxResults} people into campaign ${campaignId}.`
      : `Search Airscale for up to ${maxResults} people.`,
    keywords,
    campaignId,
  };
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

function addMinutesIso(dateIso: string, minutes: number) {
  const base = Date.parse(dateIso);
  const start = Number.isFinite(base) ? base : Date.now();
  return new Date(start + minutes * 60 * 1000).toISOString();
}

function emailDomain(email: string) {
  return email.split("@")[1]?.trim().toLowerCase() ?? "";
}

function campaignSenderId(campaign: Pick<ScaleCampaignRecord, "scalePolicy">) {
  return asString(campaign.scalePolicy.accountId || campaign.scalePolicy.mailboxAccountId);
}

type AgentWarmupMessage = {
  campaignId: string;
  senderAccountId: string;
  recipientEmail: string;
  recipientName: string;
  recipientCompany: string;
  recipientTitle: string;
  recipientDomain: string;
  sourceUrl: string;
  reason: string;
  subject: string;
  body: string;
  realVerifiedEmail: boolean;
  emailVerification: EmailVerificationState | null;
};

function normalizeAgentWarmupMessages(input: Record<string, unknown>) {
  const raw =
    Array.isArray(input.targetMessages)
      ? input.targetMessages
      : Array.isArray(input.messages)
        ? input.messages
        : Array.isArray(input.targets)
          ? input.targets
          : [];
  const normalized = raw
    .map((entry) => {
      const row = asRecord(entry);
      const recipientEmail = extractFirstEmailAddress(
        row.recipientEmail ?? row.email ?? row.to ?? row.address
      ).toLowerCase();
      const subject = asString(row.subject);
      const body = asString(row.body ?? row.message ?? row.emailBody);
      const recipientDomain = asString(row.recipientDomain ?? row.domain) || emailDomain(recipientEmail);
      const verification = asRecord(row.emailVerification);
      return {
        campaignId: asString(row.campaignId),
        senderAccountId: asString(row.senderAccountId ?? row.accountId),
        recipientEmail,
        recipientName: asString(row.recipientName ?? row.name),
        recipientCompany: asString(row.recipientCompany ?? row.company),
        recipientTitle: asString(row.recipientTitle ?? row.title),
        recipientDomain,
        sourceUrl: asString(row.sourceUrl ?? row.url),
        reason: asString(row.reason ?? row.why ?? row.rationale),
        subject,
        body,
        realVerifiedEmail: row.realVerifiedEmail === true,
        emailVerification: Object.keys(verification).length
          ? (verification as EmailVerificationState)
          : null,
      } satisfies AgentWarmupMessage;
    })
    .filter((row) => row.recipientEmail && row.subject && row.body);

  if (!normalized.length) {
    throw new Error(
      "targetMessages is required. Each message needs recipientEmail, subject, and body chosen by the agent."
    );
  }

  const seen = new Set<string>();
  return normalized.filter((row) => {
    const key = `${row.campaignId}|${row.senderAccountId}|${row.recipientEmail}|${row.subject}|${row.body}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function listWarmupCampaignsForBrand(brandId: string) {
  const campaigns = await listScaleCampaignRecords(brandId);
  return campaigns.filter(
    (campaign) =>
      resolveScaleCampaignLane(campaign) === "warmup" &&
      campaign.status !== "archived" &&
      campaign.status !== "completed"
  );
}

async function resolveAgentWarmupCampaign(input: {
  brandId: string;
  campaigns: ScaleCampaignRecord[];
  campaignId?: string;
  senderAccountId?: string;
  allowNonWarmupCampaign?: boolean;
}) {
  const requestedCampaignId = asString(input.campaignId);
  if (requestedCampaignId) {
    const campaign = await getScaleCampaignOrThrow(input.brandId, requestedCampaignId);
    if (
      !input.allowNonWarmupCampaign &&
      resolveScaleCampaignLane(campaign) !== "warmup"
    ) {
      throw new Error(
        "This tool only schedules warmup/reply-acquisition campaigns unless allowNonWarmupCampaign is true."
      );
    }
    return campaign;
  }

  const senderAccountId = asString(input.senderAccountId);
  if (senderAccountId) {
    const senderCampaign =
      input.campaigns.find((campaign) => campaignSenderId(campaign) === senderAccountId) ?? null;
    if (senderCampaign) return senderCampaign;
  }

  const active = input.campaigns.find((campaign) => campaign.status === "active");
  if (active) return active;
  const paused = input.campaigns.find((campaign) => campaign.status === "paused");
  if (paused) return paused;
  const draft = input.campaigns.find((campaign) => campaign.status === "draft");
  if (draft) return draft;
  throw new Error("No warmup campaign exists for this brand/sender yet.");
}

async function planWarmupAgentWork(input: Record<string, unknown>) {
  const brandId = requireString(input, "brandId");
  const [brand, snapshot, warmupCampaigns, inbox] = await Promise.all([
    getBrandById(brandId),
    readWarmupIntelligenceSnapshot(brandId),
    listWarmupCampaignsForBrand(brandId),
    listReplyThreadsByBrand(brandId),
  ]);
  if (!brand) throw new Error("Brand not found");

  const campaignSummaries = await Promise.all(
    warmupCampaigns.map(async (campaign) => {
      const runs = await listOwnerRuns(brandId, "campaign", campaign.id);
      const latestRun = pickRun(runs);
      const [messages, leads, jobs] = latestRun
        ? await Promise.all([
            listRunMessages(latestRun.id),
            listRunLeads(latestRun.id),
            listRunJobs(latestRun.id),
          ])
        : [[], [], []];
      return {
        campaignId: campaign.id,
        name: campaign.name,
        status: campaign.status,
        lane: resolveScaleCampaignLane(campaign),
        senderAccountId: campaignSenderId(campaign),
        replyMailboxAccountId: asString(campaign.scalePolicy.mailboxAccountId),
        dailyCap: campaign.scalePolicy.dailyCap,
        hourlyCap: campaign.scalePolicy.hourlyCap,
        minSpacingMinutes: campaign.scalePolicy.minSpacingMinutes,
        latestRunId: latestRun?.id ?? "",
        latestRunStatus: latestRun?.status ?? "",
        existingLeads: leads.length,
        scheduledOrSentMessages: messages.filter((message) =>
          ["scheduled", "sent"].includes(message.status)
        ).length,
        queuedJobs: jobs.filter((job) => job.status === "queued").map((job) => job.jobType),
      };
    })
  );

  return {
    summary: `${brand.name}: ${warmupCampaigns.length} warmup campaign${warmupCampaigns.length === 1 ? "" : "s"}, ${snapshot.evidence.rollup.totalWarmupReplies} warmup repl${snapshot.evidence.rollup.totalWarmupReplies === 1 ? "y" : "ies"}, ${snapshot.evidence.rollup.sendersNeedingProbe} sender${snapshot.evidence.rollup.sendersNeedingProbe === 1 ? "" : "s"} needing probe.`,
    result: {
      brand: {
        id: brand.id,
        name: brand.name,
        website: brand.website,
        product: brand.product,
        idealCustomerProfiles: brand.idealCustomerProfiles,
        targetMarkets: brand.targetMarkets,
      },
      warmupEvidence: snapshot.evidence,
      warmupCampaigns: campaignSummaries,
      recentReplyThreads: inbox.threads.slice(0, 20).map((thread) => ({
        id: thread.id,
        campaignId: thread.campaignId,
        runId: thread.runId,
        subject: thread.subject,
        sentiment: thread.sentiment,
        intent: thread.intent,
        lastMessageAt: thread.lastMessageAt,
        progressScore: thread.stateSummary?.progressScore ?? 0,
      })),
      agentWorkspaceContract: {
        principle:
          "The agent chooses real recipients and exact subject/body. The tool only schedules and audits the send plumbing.",
        targetSourceIdeas:
          "Use legitimate reply-prone business reasons: vendors, SaaS support/sales, newsletters/sponsorships, partners, friendly contacts, existing customers, or controlled trusted inboxes. Do not fake demand.",
        enqueueTool: "warmup.agent.enqueue_messages",
        requiredTargetMessageFields: ["recipientEmail", "subject", "body"],
        optionalTargetMessageFields: [
          "campaignId",
          "senderAccountId",
          "recipientName",
          "recipientCompany",
          "recipientTitle",
          "sourceUrl",
          "reason",
          "realVerifiedEmail",
          "emailVerification",
        ],
      },
    },
  } satisfies OperatorToolResult;
}

async function enqueueWarmupAgentMessages(input: Record<string, unknown>) {
  const brandId = requireString(input, "brandId");
  const brand = await getBrandById(brandId);
  if (!brand) throw new Error("Brand not found");

  const rawMessages = normalizeAgentWarmupMessages(input);
  const maxMessages = Math.max(1, Math.min(10, asNumber(input.maxMessages, rawMessages.length)));
  const targetMessages = rawMessages.slice(0, maxMessages);
  const campaigns = await listWarmupCampaignsForBrand(brandId);
  const allowNonWarmupCampaign = input.allowNonWarmupCampaign === true;
  const defaultCampaignId = asString(input.campaignId);
  const defaultSenderAccountId = asString(input.senderAccountId ?? input.accountId);

  const groups = new Map<string, { campaign: ScaleCampaignRecord; messages: AgentWarmupMessage[] }>();
  for (const message of targetMessages) {
    const campaign = await resolveAgentWarmupCampaign({
      brandId,
      campaigns,
      campaignId: message.campaignId || defaultCampaignId,
      senderAccountId: message.senderAccountId || defaultSenderAccountId,
      allowNonWarmupCampaign,
    });
    const existing = groups.get(campaign.id);
    if (existing) {
      existing.messages.push(message);
    } else {
      groups.set(campaign.id, { campaign, messages: [message] });
    }
  }

  const startAt = asString(input.startAt) || nowIso();
  const minSpacingMinutes = Math.max(10, Math.min(240, asNumber(input.minSpacingMinutes, 30)));
  const runs = [];
  let globalIndex = 0;

  for (const group of groups.values()) {
    const campaign = group.campaign;
    const senderAccountId =
      asString(input.senderAccountId ?? input.accountId) || campaignSenderId(campaign);
    if (!senderAccountId) {
      throw new Error(`Warmup campaign ${campaign.id} does not have a sender account.`);
    }
    const sender = await getOutreachAccount(senderAccountId);
    const senderEmail = sender ? getOutreachAccountFromEmail(sender).trim().toLowerCase() : "";
    if (!sender) {
      throw new Error(`Sender account ${senderAccountId} was not found.`);
    }

    const run = await createOutreachRun({
      brandId,
      campaignId: campaign.id,
      experimentId: campaign.sourceExperimentId || "",
      hypothesisId: "",
      ownerType: "campaign",
      ownerId: campaign.id,
      accountId: senderAccountId,
      lockedSenderAccountId: senderAccountId,
      status: "scheduled",
      cadence: "3_step_7_day",
      dailyCap: Math.max(1, Math.min(10, asNumber(input.dailyCap, group.messages.length))),
      hourlyCap: Math.max(1, Math.min(3, asNumber(input.hourlyCap, 1))),
      timezone: asString(input.timezone) || campaign.scalePolicy.timezone || "America/Los_Angeles",
      minSpacingMinutes,
      externalRef: "codex_agent_warmup",
    });

    const leads = await upsertRunLeads(
      run.id,
      brandId,
      campaign.id,
      group.messages.map((message) => ({
        email: message.recipientEmail,
        name: message.recipientName,
        company: message.recipientCompany,
        title: message.recipientTitle,
        domain: message.recipientDomain,
        sourceUrl: message.sourceUrl,
        realVerifiedEmail: message.realVerifiedEmail,
        emailVerification: message.emailVerification,
      }))
    );
    const leadByEmail = new Map(leads.map((lead) => [lead.email.toLowerCase(), lead.id] as const));
    const createdMessages = await createRunMessages(
      group.messages.map((message) => {
        const leadId = leadByEmail.get(message.recipientEmail.toLowerCase());
        if (!leadId) {
          throw new Error(`Failed to create run lead for ${message.recipientEmail}.`);
        }
        const scheduledAt = addMinutesIso(startAt, globalIndex * minSpacingMinutes);
        globalIndex += 1;
        return {
          runId: run.id,
          brandId,
          campaignId: campaign.id,
          leadId,
          step: 1,
          subject: message.subject,
          body: message.body,
          status: "scheduled" as const,
          scheduledAt,
          sourceType: "conversation" as const,
          generationMeta: {
            source: "codex_agent",
            mode: "agent_authored_warmup",
            reason: message.reason,
            senderAccountId,
            senderEmail,
            recipientDomain: message.recipientDomain,
          },
        };
      })
    );

    await updateOutreachRun(run.id, {
      metrics: {
        ...run.metrics,
        sourcedLeads: leads.length,
        scheduledMessages: createdMessages.length,
      },
      lastError: "",
      pauseReason: "",
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "agent_authored_warmup_messages_enqueued",
      payload: {
        messageCount: createdMessages.length,
        senderAccountId,
        senderEmail,
        brandId,
        campaignId: campaign.id,
        reasons: group.messages.map((message) => message.reason).filter(Boolean).slice(0, 20),
      },
    });
    await Promise.all([
      enqueueOutreachJob({
        runId: run.id,
        jobType: "dispatch_messages",
        executeAfter: nowIso(),
      }),
      enqueueOutreachJob({
        runId: run.id,
        jobType: "sync_replies",
        executeAfter: addMinutesIso(nowIso(), 60),
      }),
    ]);
    runs.push({
      runId: run.id,
      campaignId: campaign.id,
      senderAccountId,
      senderEmail,
      leadCount: leads.length,
      messageCount: createdMessages.length,
      firstScheduledAt: createdMessages[0]?.scheduledAt ?? "",
      lastScheduledAt: createdMessages[createdMessages.length - 1]?.scheduledAt ?? "",
    });
  }

  return {
    summary: `Enqueued ${targetMessages.length} agent-authored warmup message${targetMessages.length === 1 ? "" : "s"} across ${runs.length} run${runs.length === 1 ? "" : "s"}.`,
    result: {
      brandId,
      runs,
      messageCount: targetMessages.length,
      nextRecommendedTool: "deliverability.probe.start",
    },
    receipt: {
      title: "Warmup messages enqueued",
      summary: `Scheduled ${targetMessages.length} exact agent-written warmup message${targetMessages.length === 1 ? "" : "s"}.`,
      details: runs.map((run) => `${run.senderEmail || run.senderAccountId}: ${run.messageCount} message${run.messageCount === 1 ? "" : "s"} in ${run.runId}`),
    },
  } satisfies OperatorToolResult;
}

async function startDeliverabilityProbe(input: Record<string, unknown>) {
  const brandId = requireString(input, "brandId");
  const explicitRunId = asString(input.runId);
  const explicitCampaignId = asString(input.campaignId);
  let campaign: ScaleCampaignRecord | null = explicitCampaignId
    ? await getScaleCampaignOrThrow(brandId, explicitCampaignId)
    : null;
  let run = explicitRunId ? await getOutreachRun(explicitRunId) : null;
  if (run && run.brandId !== brandId) throw new Error("Run not found for brand");

  if (!run) {
    if (!campaign) {
      const campaigns = await listWarmupCampaignsForBrand(brandId);
      campaign = await resolveAgentWarmupCampaign({
        brandId,
        campaigns,
        senderAccountId: asString(input.senderAccountId ?? input.accountId),
        allowNonWarmupCampaign: input.allowNonWarmupCampaign === true,
      });
    }
    const runs = await listOwnerRuns(brandId, "campaign", campaign.id);
    run = pickRun(runs);
  }
  if (!run) {
    throw new Error("No run exists to probe. Enqueue agent warmup messages or launch a campaign run first.");
  }
  if (!campaign) {
    campaign = await getScaleCampaignOrThrow(brandId, run.campaignId);
  }

  const probeAll =
    input.probeAllSenders === true ||
    asString(input.action) === "probe_all_senders_deliverability";
  const action = probeAll ? "probe_all_senders_deliverability" : "probe_deliverability";
  const result = await updateRunControl({
    brandId,
    campaignId: run.campaignId,
    runId: run.id,
    action,
    reason:
      asString(input.reason) ||
      "Agent requested exact-copy deliverability probe after creating or finding real scheduled copy.",
    senderAccountId: asString(input.senderAccountId ?? input.accountId) || undefined,
    recipientEmail: asString(input.recipientEmail) || undefined,
  });
  if (!result.ok) throw new Error(result.reason);
  return {
    summary: `${campaign.name}: ${result.reason}.`,
    result: {
      brandId,
      campaignId: campaign.id,
      runId: run.id,
      action,
      reason: result.reason,
    },
    receipt: {
      title: "Deliverability probe started",
      summary: `${campaign.name}: ${result.reason}.`,
      details: [`Run id: ${run.id}`, `Action: ${action}`],
    },
  } satisfies OperatorToolResult;
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

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function activeOutboundCampaigns(campaigns: ScaleCampaignRecord[]) {
  return campaigns.filter(
    (campaign) => campaign.status === "active" && resolveScaleCampaignLane(campaign) === "outbound"
  );
}

function sortByNewestUpdate<T extends { updatedAt?: string; createdAt?: string }>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const leftAt = asString(left.updatedAt) || asString(left.createdAt);
    const rightAt = asString(right.updatedAt) || asString(right.createdAt);
    return leftAt < rightAt ? 1 : -1;
  });
}

function compactOutboundRun(run: Awaited<ReturnType<typeof listOwnerRuns>>[number] | null) {
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    campaignId: run.campaignId,
    experimentId: run.experimentId,
    ownerType: run.ownerType,
    ownerId: run.ownerId,
    accountId: run.accountId,
    lockedSenderAccountId: run.lockedSenderAccountId,
    dailyCap: run.dailyCap,
    hourlyCap: run.hourlyCap,
    minSpacingMinutes: run.minSpacingMinutes,
    metrics: run.metrics,
    lastError: run.lastError,
    pauseReason: run.pauseReason,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function compactRunJob(job: Awaited<ReturnType<typeof listRunJobs>>[number]) {
  return {
    id: job.id,
    jobType: job.jobType,
    status: job.status,
    executeAfter: job.executeAfter,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function summarizeMessageQueue(messages: Awaited<ReturnType<typeof listRunMessages>>) {
  return {
    total: messages.length,
    scheduled: messages.filter((message) => message.status === "scheduled").length,
    due: messages.filter(
      (message) =>
        message.status === "scheduled" &&
        message.scheduledAt &&
        Date.parse(message.scheduledAt) <= Date.now()
    ).length,
    sent: messages.filter((message) => message.status === "sent").length,
    failed: messages.filter((message) => message.status === "failed").length,
    canceled: messages.filter((message) => message.status === "canceled").length,
  };
}

function blockerStep(input: {
  layer: string;
  status: "ok" | "blocked" | "waiting" | "unknown";
  summary: string;
  details?: Record<string, unknown>;
}) {
  return {
    layer: input.layer,
    status: input.status,
    summary: input.summary,
    details: input.details ?? {},
  };
}

async function inspectOutboundBlockerChain(input: Record<string, unknown>): Promise<OperatorToolResult> {
  const brandId = requireString(input, "brandId");
  const requestedCampaignId = asString(input.campaignId);

  const [brand, context, outreachStatus, campaigns] = await Promise.all([
    getBrandOrThrow(brandId),
    getOperatorBrandContext(brandId),
    buildOutreachStatusResponse({ brandId, includeWarmup: true, limitBrands: 1 }),
    listScaleCampaignRecords(brandId),
  ]);
  if (!context) throw new Error("Brand not found");

  const brandStatus = outreachStatus.brands[0] ?? null;
  const outboundCampaigns = activeOutboundCampaigns(campaigns);
  const selectedCampaign =
    (requestedCampaignId
      ? campaigns.find((campaign) => campaign.id === requestedCampaignId) ?? null
      : null) ??
    (brandStatus?.campaignSummary.activeOutboundCampaignId
      ? campaigns.find((campaign) => campaign.id === brandStatus.campaignSummary.activeOutboundCampaignId) ?? null
      : null) ??
    sortByNewestUpdate(outboundCampaigns)[0] ??
    null;

  const selectedCampaignId = selectedCampaign?.id ?? "";
  const [prepTask, campaignRuns] = selectedCampaignId
    ? await Promise.all([
        getCampaignPrepTask(brandId, selectedCampaignId, { allowMissingTable: true }),
        listOwnerRuns(brandId, "campaign", selectedCampaignId),
      ])
    : [null, [] as Awaited<ReturnType<typeof listOwnerRuns>>];
  const latestRun = pickRun(sortByNewestUpdate(campaignRuns));
  const [runMessages, runLeads, runJobs] = latestRun
    ? await Promise.all([
        listRunMessages(latestRun.id),
        listRunLeads(latestRun.id),
        listRunJobs(latestRun.id),
      ])
    : [
        [] as Awaited<ReturnType<typeof listRunMessages>>,
        [] as Awaited<ReturnType<typeof listRunLeads>>,
        [] as Awaited<ReturnType<typeof listRunJobs>>,
      ];

  const evidenceRows = brandStatus?.senderRouteEvidence ?? [];
  const senderAccountIds = uniqueValues([
    ...evidenceRows.map((row) => row.accountId),
    selectedCampaign?.scalePolicy.accountId ?? "",
    selectedCampaign?.scalePolicy.mailboxAccountId ?? "",
    context.assignment?.accountId ?? "",
    ...(context.assignment?.accountIds ?? []),
    context.assignment?.mailboxAccountId ?? "",
  ]);
  const accounts = await Promise.all(senderAccountIds.map((accountId) => getOutreachAccount(accountId)));
  const accountById = new Map(
    accounts
      .filter((account): account is NonNullable<typeof account> => Boolean(account))
      .map((account) => [account.id, account] as const)
  );

  const senderRows = evidenceRows.map((row) => {
    const account = accountById.get(row.accountId) ?? null;
    return {
      accountId: row.accountId,
      fromEmail: row.fromEmail || (account ? getOutreachAccountFromEmail(account) : ""),
      routeKind: row.routeKind,
      provider: row.provider,
      accountStatus: account?.status ?? "",
      outboundEnabled: isOutreachOutboundEnabled(account),
      state: row.state,
      placement: row.placement,
      inboxRate: row.inboxRate,
      spamRate: row.spamRate,
      autoPaused: row.autoPaused,
      checkedAt: row.checkedAt,
      summaryText: row.summaryText,
    };
  });
  const selectedSenderAccountId =
    asString(selectedCampaign?.scalePolicy.accountId) ||
    asString(latestRun?.accountId) ||
    asString(context.assignment?.accountId);
  const selectedAccount = selectedSenderAccountId ? accountById.get(selectedSenderAccountId) ?? await getOutreachAccount(selectedSenderAccountId) : null;
  const selectedSenderEvidence =
    senderRows.find((row) => row.accountId === selectedSenderAccountId) ?? null;
  const outboundEnabledReadySenders = senderRows.filter(
    (row) => row.state === "ready" && row.accountStatus === "active" && row.outboundEnabled
  );

  const messageQueue = summarizeMessageQueue(runMessages);
  const activeDispatchJobs = runJobs.filter(
    (job) => job.jobType === "dispatch_messages" && ["queued", "running"].includes(job.status)
  );
  const openRunStatuses = new Set(["queued", "sourcing", "scheduled", "sending", "monitoring", "paused"]);
  const latestRunOpen = latestRun ? openRunStatuses.has(latestRun.status) : false;

  const chain = [
    blockerStep({
      layer: "sender_routes",
      status: outboundEnabledReadySenders.length > 0 ? "ok" : senderRows.length > 0 ? "blocked" : "unknown",
      summary: outboundEnabledReadySenders.length
        ? `${outboundEnabledReadySenders.length} sender route${outboundEnabledReadySenders.length === 1 ? "" : "s"} are ready and enabled for outbound.`
        : senderRows.length
          ? "Sender routes exist, but none are both ready and enabled for outbound."
          : "No sender route evidence was found.",
      details: {
        selectedSenderAccountId,
        selectedSenderEmail:
          selectedSenderEvidence?.fromEmail ||
          (selectedAccount ? getOutreachAccountFromEmail(selectedAccount).trim().toLowerCase() : ""),
        selectedSenderOutboundEnabled: isOutreachOutboundEnabled(selectedAccount),
        readyOutboundSenderCount: outboundEnabledReadySenders.length,
      },
    }),
    blockerStep({
      layer: "active_campaign",
      status: selectedCampaign && selectedCampaign.status === "active" ? "ok" : outboundCampaigns.length ? "waiting" : "blocked",
      summary: selectedCampaign
        ? `${selectedCampaign.name} is ${selectedCampaign.status} on the ${resolveScaleCampaignLane(selectedCampaign)} lane.`
        : "No active outbound campaign is selected.",
      details: {
        campaignId: selectedCampaign?.id ?? "",
        activeOutboundCampaignCount: outboundCampaigns.length,
        pinnedSenderAccountId: selectedCampaign?.scalePolicy.accountId ?? "",
      },
    }),
    blockerStep({
      layer: "inventory",
      status:
        brandStatus?.inventorySummary.inventoryBlockerCode &&
        brandStatus.inventorySummary.inventoryBlockerCode !== "none"
          ? "blocked"
          : brandStatus?.inventorySummary.inventoryDispatchable
            ? "ok"
            : "waiting",
      summary:
        brandStatus?.inventorySummary.inventoryBlockerCode &&
        brandStatus.inventorySummary.inventoryBlockerCode !== "none"
          ? brandStatus.inventorySummary.inventoryBlockerSummary || "Campaign inventory is not ready."
          : brandStatus?.inventorySummary.inventoryDispatchable
            ? "Campaign inventory is dispatchable."
            : "Campaign inventory is not dispatchable yet.",
      details: {
        prepTask: prepTask
          ? {
              id: prepTask.id,
              status: prepTask.status,
              attempt: prepTask.attempt,
              executeAfter: prepTask.executeAfter,
              blockerCode: prepTask.blockerCode,
              summary: prepTask.summary,
              lastError: prepTask.lastError,
              progress: stripSensitiveKeys(prepTask.progress),
            }
          : null,
        inventorySummary: brandStatus?.inventorySummary ?? null,
      },
    }),
    blockerStep({
      layer: "run",
      status: latestRunOpen ? "ok" : latestRun ? "blocked" : "waiting",
      summary: latestRun
        ? latestRunOpen
          ? `Latest campaign run is open with status ${latestRun.status}.`
          : `Latest campaign run is ${latestRun.status}; there is no open outbound run${
              messageQueue.scheduled === 0 ? " and no scheduled messages" : ""
            }${latestRun.lastError ? `: ${latestRun.lastError}` : ""}.`
        : "No campaign run exists for the selected campaign.",
      details: {
        latestRun: compactOutboundRun(latestRun),
        totalCampaignRuns: campaignRuns.length,
      },
    }),
    blockerStep({
      layer: "message_queue",
      status: messageQueue.due > 0 || messageQueue.scheduled > 0 ? "ok" : latestRunOpen ? "waiting" : "blocked",
      summary:
        messageQueue.due > 0
          ? `${messageQueue.due} scheduled message${messageQueue.due === 1 ? " is" : "s are"} due now.`
          : messageQueue.scheduled > 0
            ? `${messageQueue.scheduled} message${messageQueue.scheduled === 1 ? " is" : "s are"} scheduled for later.`
            : "There are no scheduled outbound messages.",
      details: {
        messageQueue,
        leadCount: runLeads.length,
        sampleMessages: runMessages.slice(0, 5).map(compactRunMessage),
        sampleLeads: runLeads.slice(0, 5).map(compactRunLead),
      },
    }),
    blockerStep({
      layer: "dispatch",
      status: brandStatus?.capacitySummary.dispatchableNow ? "ok" : activeDispatchJobs.length ? "waiting" : "blocked",
      summary: brandStatus?.capacitySummary.dispatchableNow
        ? "The brand has dispatchable mail now."
        : activeDispatchJobs.length
          ? "A dispatch job is queued or running."
          : "There is no dispatchable mail right now.",
      details: {
        capacitySummary: brandStatus?.capacitySummary ?? null,
        executionSummary: brandStatus?.executionSummary ?? null,
        activeDispatchJobs: activeDispatchJobs.map(compactRunJob),
      },
    }),
  ];
  const firstBlocker = chain.find((step) => step.status === "blocked") ?? chain.find((step) => step.status === "waiting") ?? null;
  const nextActions: string[] = [];
  if (!selectedCampaign) {
    nextActions.push("Create or activate an outbound campaign for the selected mission/experiment.");
  } else if (!outboundEnabledReadySenders.length) {
    nextActions.push("Enable one inbox-proven ready sender for outbound or switch the campaign to an outbound-enabled sender.");
  } else if (brandStatus?.inventorySummary.inventoryBlockerCode && brandStatus.inventorySummary.inventoryBlockerCode !== "none") {
    nextActions.push("Repair campaign prep and keep sourcing/importing smaller batches until sendable leads exist.");
  } else if (!latestRunOpen) {
    nextActions.push("Restart or launch the campaign now that sender and inventory gates are clear.");
  } else if (messageQueue.scheduled === 0) {
    nextActions.push("Schedule real campaign-copy messages for sendable leads.");
  } else if (!activeDispatchJobs.length && messageQueue.due > 0) {
    nextActions.push("Queue a dispatch job for due messages.");
  }

  const summary = firstBlocker
    ? `${brand.name} is not sending because ${firstBlocker.summary[0]?.toLowerCase()}${firstBlocker.summary.slice(1)}`
    : `${brand.name} has no active outbound blocker in the inspected chain.`;

  return {
    summary,
    result: {
      objectType: "outbound_blocker_chain",
      brand: { id: brand.id, name: brand.name },
      selectedCampaign: selectedCampaign
        ? {
            id: selectedCampaign.id,
            name: selectedCampaign.name,
            status: selectedCampaign.status,
            lane: resolveScaleCampaignLane(selectedCampaign),
            sourceExperimentId: selectedCampaign.sourceExperimentId,
            scalePolicy: selectedCampaign.scalePolicy,
          }
        : null,
      blocker: firstBlocker,
      chain,
      senderRoutes: senderRows,
      nextActions,
      liveStatus: brandStatus
        ? {
            primaryBlockerDomain: brandStatus.primaryBlockerDomain,
            primaryBlockerCode: brandStatus.primaryBlockerCode,
            primaryBlockerSummary: brandStatus.primaryBlockerSummary,
            senderSummary: brandStatus.senderSummary,
            campaignSummary: brandStatus.campaignSummary,
            inventorySummary: brandStatus.inventorySummary,
            executionSummary: brandStatus.executionSummary,
            capacitySummary: brandStatus.capacitySummary,
          }
        : null,
      evidencePolicy:
        "Use this tool before answering why real outbound is not sending. It checks the blocker chain in order: sender route, outbound-enabled flag, campaign, inventory, run, message queue, dispatch.",
    },
  } satisfies OperatorToolResult;
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
    name: "inspect_outbound_blocker_chain",
    riskLevel: "read",
    approvalMode: "none",
    description:
      "Inspect why real outbound is or is not sending for a brand. Walks the live blocker chain in order: sender route, outbound-enabled flag, active campaign, inventory/prep, run, scheduled messages, and dispatch jobs. Use this before answering questions like why aren't we sending real mail, why no outbound, what is blocked, or what needs to happen next.",
    autonomyHint:
      "Use this as a broad diagnostic when growth is stalled. It should reveal whether the next move is sender repair, campaign launch, lead sourcing, dispatch, or a missing capability.",
    previewTitle: "Inspect outbound blocker chain",
    run: inspectOutboundBlockerChain,
  },
  {
    name: "inspect_sender_delivery_evidence",
    riskLevel: "read",
    approvalMode: "none",
    description:
      "Inspect sender delivery evidence for warmup/control checks, Gmail inbox/spam placement, Mailpool spam checks, seed inbox results, sender readiness, and which sender emails are actually landing in inbox vs spam. Use this for deliverability/inboxing questions, not experiment questions.",
    autonomyHint:
      "Use when the agent needs live deliverability proof before deciding whether to scale, switch transport, retry a sender, or keep volume low.",
    previewTitle: "Inspect sender delivery evidence",
    run: inspectSenderDeliveryEvidence,
  },
  {
    name: "get_warmup_intelligence_snapshot",
    riskLevel: "read",
    approvalMode: "none",
    description:
      "Read the brand's warmup operating guide plus sender-level evidence for reply acquisition, inbox trust, exact-copy probe status, reply quality, and whether a sender is fresh, probing, recovering, or ready for tiny reply-focused outreach.",
    autonomyHint:
      "Use this before deciding warmup moves. It is evidence for agent reasoning, not a fixed playbook; choose the smallest legitimate action that should increase real replies or placement certainty.",
    previewTitle: "Inspect warmup intelligence",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const snapshot = await readWarmupIntelligenceSnapshot(brandId);
      const rollup = snapshot.evidence.rollup;
      return {
        summary: `${snapshot.evidence.brandName}: ${rollup.senderCount} warmup sender${rollup.senderCount === 1 ? "" : "s"}, best posture ${rollup.bestPosture}, ${rollup.totalWarmupReplies} warmup repl${rollup.totalWarmupReplies === 1 ? "y" : "ies"}, ${rollup.sendersNeedingProbe} needing probe, ${rollup.sendersInRecovery} in recovery.`,
        result: snapshot as unknown as Record<string, unknown>,
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "plan_warmup_agent_work",
    riskLevel: "read",
    approvalMode: "none",
    description:
      "Prepare an agent workbench for reply-acquisition warmup. It reads brand context, sender posture, warmup campaigns, recent replies, and the exact enqueue contract. It does not choose recipients or write copy; the agent must do that.",
    autonomyHint:
      "Use this when the next move should be agent-conducted warmup. Then choose real recipients and exact subject/body yourself, and call enqueue_warmup_agent_messages.",
    previewTitle: "Plan warmup agent work",
    run: planWarmupAgentWork,
  },
  {
    name: "enqueue_warmup_agent_messages",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description:
      "Schedule exact warmup/reply-acquisition emails that the agent already chose and wrote. This is only send plumbing: create run leads, scheduled messages, dispatch/reply jobs, and audit events. It will not generate copy, invent recipients, or choose strategy.",
    autonomyHint:
      "Use only after the agent has chosen legitimate recipients and exact subject/body. Keep batches tiny and reply-prone; use start_deliverability_probe after real scheduled copy exists.",
    previewTitle: "Enqueue agent warmup messages",
    buildPreview: (input) => {
      const rawCount = Array.isArray(input.targetMessages)
        ? input.targetMessages.length
        : Array.isArray(input.messages)
          ? input.messages.length
          : Array.isArray(input.targets)
            ? input.targets.length
            : 0;
      return buildSimplePreview(
        "Enqueue warmup messages",
        `Schedule ${rawCount || "agent-authored"} warmup message${rawCount === 1 ? "" : "s"}.`
      );
    },
    run: enqueueWarmupAgentMessages,
  },
  {
    name: "start_deliverability_probe",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description:
      "Start an exact-copy deliverability probe for an existing warmup/campaign run. The run must already contain real scheduled or sent message copy.",
    autonomyHint:
      "Use after agent-authored warmup messages or real campaign messages exist, especially before ramping or when placement evidence is stale.",
    previewTitle: "Start deliverability probe",
    buildPreview: (input) =>
      buildSimplePreview(
        "Start deliverability probe",
        `${asString(input.action) || (input.probeAllSenders === true ? "probe_all_senders_deliverability" : "probe_deliverability")} for ${asString(input.runId) || asString(input.campaignId) || "the latest warmup run"}.`
      ),
    run: startDeliverabilityProbe,
  },
  {
    name: "source_airscale_people",
    riskLevel: "safe_write",
    approvalMode: "none",
    description:
      "Search Airscale Find People with agent-chosen filters and optionally import the results into a campaign's lead inventory. Use when lead/warmup inventory is blocked and Airscale is the better sourcing route than repeating the same provider.",
    autonomyHint:
      "This is a flexible sourcing option, not a scripted warmup step. Choose keywords, titles, domains, or locations from the brand/campaign context, then import only when a campaignId is known.",
    previewTitle: "Source people with Airscale",
    buildPreview: buildAirscaleSourcingPreview,
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const campaignId = asString(input.campaignId);
      const [brand, campaign] = await Promise.all([
        getBrandById(brandId),
        campaignId ? getScaleCampaignRecordById(brandId, campaignId) : Promise.resolve(null),
      ]);
      if (!brand) {
        throw new Error("Brand not found");
      }
      if (campaignId && !campaign) {
        throw new Error("Campaign not found");
      }
      if (!hasAirscalePeopleSourcingConfig()) {
        throw new Error("AIRSCALE_API_KEY is not configured.");
      }

      const explicitKeywords = inputStringList(input.keywords, input.keyword, input.query);
      const keywords = (explicitKeywords.length ? explicitKeywords : defaultAirscaleKeywords({ brand, campaign }))
        .map((value) => compactSourcingText(value))
        .filter(Boolean)
        .slice(0, 8);
      const maxResults = Math.max(1, Math.min(100, asNumber(input.maxResults ?? input.limit ?? input.size, 25)));
      const search = await sourceLeadsFromAirscalePeopleSearch({
        keywords,
        jobTitles: inputStringList(input.jobTitles, input.titles, input.roles).slice(0, 24),
        companyDomains: inputStringList(input.companyDomains, input.domains).slice(0, 100),
        companyLinkedinUrls: inputStringList(input.companyLinkedinUrls, input.linkedinCompanyUrls).slice(0, 100),
        locations: inputStringList(input.locations, input.location).slice(0, 50),
        excludeKeywords: inputStringList(input.excludeKeywords).slice(0, 50),
        excludeJobTitles: inputStringList(input.excludeJobTitles).slice(0, 50),
        excludeCompanyDomains: inputStringList(input.excludeCompanyDomains).slice(0, 100),
        size: maxResults,
        cursor: asString(input.cursor),
      });

      if (!search.ok) {
        throw new Error(search.error || "Airscale people search failed.");
      }

      const shouldImport = Boolean(campaignId) && input.importToCampaign !== false;
      const importResult =
        shouldImport && campaign
          ? await importScaleCampaignProspectRows({
              brandId,
              campaignId: campaign.id,
              rows: search.leads,
              requestOrigin: "operator_airscale_people_source",
              tableTitle: "Airscale people search",
              prompt: JSON.stringify(search.query),
              entityType: "person",
              backgroundMode: false,
            })
          : null;
      const imported = importResult?.importedCount ?? 0;
      const stored = importResult?.storedLeadCount ?? 0;
      const lane = campaign ? resolveScaleCampaignLane(campaign) : "";
      return {
        summary: shouldImport
          ? `Airscale returned ${search.leads.length} people and imported ${imported} sendable lead${imported === 1 ? "" : "s"}${stored && stored !== imported ? ` (${stored} stored)` : ""}.`
          : `Airscale returned ${search.leads.length} people.`,
        result: {
          provider: "airscale",
          brandId,
          campaignId,
          lane,
          query: search.query,
          total: search.total,
          returned: search.leads.length,
          nextCursor: search.nextCursor,
          imported,
          stored,
          importResult,
          sample: search.leads.slice(0, 8),
        },
        receipt: shouldImport
          ? {
              title: "Airscale people sourced",
              summary: `Imported ${imported} sendable lead${imported === 1 ? "" : "s"} into campaign inventory.`,
              details: [
                `Returned: ${search.leads.length}`,
                `Stored: ${stored}`,
                `Campaign: ${campaign?.name ?? campaignId}`,
              ],
            }
          : undefined,
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "record_capability_gap",
    riskLevel: "safe_write",
    approvalMode: "none",
    description:
      "Record that the agent cannot complete an objective because the current toolset lacks a required capability, credential, permission, provider route, or execution primitive. Use this only after inspecting available tools and evidence. Input: brandId, optional missionId, capability, whyNeeded, blocker, attemptedTools, suggestedToolContract.",
    autonomyHint:
      "Use as the open-world escape hatch when no existing tool can move the objective. This is how the agent asks the platform to add a new tool instead of pretending a hardcoded workflow can solve it.",
    previewTitle: "Record capability gap",
    run: async (input) => {
      const brandId = asString(input.brandId);
      const missionId = asString(input.missionId);
      const capability = requireString(input, "capability");
      if (["none", "no", "n/a", "na", "not applicable", "unknown", "no missing capability"].includes(capability.toLowerCase())) {
        throw new Error("capability must name a concrete missing platform ability, permission, provider route, or credential.");
      }
      const whyNeeded = asString(input.whyNeeded);
      const blocker = asString(input.blocker);
      const attemptedTools = asStringArray(input.attemptedTools).slice(0, 12);
      const suggestedToolContract = asString(input.suggestedToolContract);
      const summary = `Capability gap recorded: ${capability}${blocker ? ` (${blocker})` : ""}.`;
      const payload = {
        brandId,
        missionId,
        capability,
        whyNeeded,
        blocker,
        attemptedTools,
        suggestedToolContract,
      };

      if (brandId && missionId) {
        await createMissionEvent({
          missionId,
          brandId,
          eventType: "brand_gpt_capability_gap",
          summary,
          payload,
        });
        await createMissionLearning({
          missionId,
          brandId,
          learningType: "brand_gpt_capability_gap",
          summary: whyNeeded ? `${summary} ${whyNeeded}` : summary,
          confidence: 0.8,
          evidence: payload,
          recommendedAction: suggestedToolContract || capability,
        });
      }

      return {
        summary,
        result: {
          ...payload,
          plainEnglish:
            "The agent has hit the edge of the available platform tools. Add or repair this capability before expecting the agent to complete the objective autonomously.",
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "request_user_attention",
    riskLevel: "safe_write",
    approvalMode: "none",
    description:
      "Create a proactive user-facing Brand GPT attention message when involving the user is the right next move. This is generic: input brandId, optional missionId, title, message, reason, urgency, attentionKind, suggestedActions [{label,message}], and evidence. Use it for any model-chosen reason, not just blockers.",
    autonomyHint:
      "Use whenever user attention genuinely helps: ask a strategic question, request setup or credentials, flag a risk, celebrate an achievement, ask for approval context, or explain a blocker. Do not use it for work you can complete with existing tools.",
    previewTitle: "Request user attention",
    buildPreview: (input) => ({
      title: asString(input.title) || "Brand GPT needs attention",
      summary: asString(input.message) || asString(input.reason) || "Brand GPT wants to notify or ask the user.",
      urgency: normalizeAttentionUrgency(input.urgency),
      attentionKind: asString(input.attentionKind) || asString(input.kind),
    }),
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const title = requireString(input, "title");
      const message = requireString(input, "message");
      const missionId = asString(input.missionId);
      const reason = asString(input.reason);
      const attentionKind = asString(input.attentionKind) || asString(input.kind);
      const urgency = normalizeAttentionUrgency(input.urgency);
      const suggestedActions = attentionSuggestedActions(input.suggestedActions);
      const evidence = asStringArray(input.evidence).slice(0, 8);
      const attentionRequest = {
        id: createId("opatt"),
        status: "open",
        brandId,
        missionId,
        title,
        message,
        reason,
        attentionKind,
        urgency,
        suggestedActions,
        evidence,
        createdAt: nowIso(),
      };
      const summaryParts = [`**${title}**`, message];
      if (reason) summaryParts.push(`**Why:** ${reason}`);
      if (suggestedActions.length) {
        summaryParts.push(
          `**Options:** ${suggestedActions.map((action) => action.label).join(", ")}`
        );
      }
      const summary = summaryParts.join("\n\n");

      if (missionId) {
        await createMissionEvent({
          missionId,
          brandId,
          eventType: "brand_gpt_user_attention_requested",
          summary: `${title}: ${message}`,
          payload: attentionRequest,
        });
      }

      return {
        summary,
        result: {
          brandId,
          missionId,
          attentionRequest,
          plainEnglish:
            "Brand GPT created an in-app attention request. The sidebar badge points the user back to this chat; external notifications are not sent by this tool.",
        },
        receipt: {
          title: "Attention request created",
          summary: title,
          details: [
            message,
            reason ? `Reason: ${reason}` : "",
            attentionKind ? `Kind: ${attentionKind}` : "",
            `Urgency: ${urgency}`,
          ].filter(Boolean),
        },
      } satisfies OperatorToolResult;
    },
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
    autonomyHint:
      "Use for open-ended questions, self-checks, and recovery after a confusing result. This is the closest read tool to browsing the brand workspace like Codex.",
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
    name: "enable_sender_outbound",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description: "Enable outbound sending for a ready sender that is currently limited to warmup.",
    autonomyHint:
      "Use when a ready sender is blocked only because outbound is disabled and the next autonomous move is real campaign outreach.",
    previewTitle: "Enable sender outbound",
    buildPreview: (input) =>
      buildSimplePreview(
        "Enable sender outbound",
        `Enable outbound for ${asString(input.fromEmail) || asString(input.accountId) || "the selected sender"}.`
      ),
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const accountId = requireString(input, "accountId");
      const account = await getOutreachAccount(accountId);
      if (!account) throw new Error("Sender account not found.");
      const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase() || account.name || account.id;

      if (account.status !== "active") {
        throw new Error(`${fromEmail} is not active yet, so outbound cannot be enabled safely.`);
      }

      const status = await buildOutreachStatusResponse({ brandId, includeWarmup: true, limitBrands: 1 });
      const route = status.brands[0]?.senderRouteEvidence.find((row) => row.accountId === accountId) ?? null;
      if (route && route.state !== "ready") {
        throw new Error(`${fromEmail} is not ready yet; current sender state is ${route.state || "unknown"}.`);
      }

      if (isOutreachOutboundEnabled(account)) {
        return {
          summary: `${fromEmail} is already enabled for outbound.`,
          result: {
            accountId,
            fromEmail,
            outboundEnabled: true,
            alreadyEnabled: true,
            route,
          },
          receipt: {
            title: "Sender already outbound-enabled",
            summary: `${fromEmail} was already enabled for outbound.`,
            details: [],
          },
        } satisfies OperatorToolResult;
      }

      const updated = await updateOutreachAccount(accountId, {
        config: {
          outbound: {
            enabled: true,
            disabledAt: "",
            disabledReason: "",
          },
        },
        lastTestAt: nowIso(),
        lastTestStatus: "pass",
      });
      if (!updated || !isOutreachOutboundEnabled(updated)) {
        throw new Error("Sender outbound enablement did not persist.");
      }

      return {
        summary: `${fromEmail} is now enabled for outbound.`,
        result: {
          accountId,
          fromEmail,
          outboundEnabled: true,
          previousOutboundEnabled: false,
          route,
        },
        receipt: {
          title: "Sender outbound enabled",
          summary: `${fromEmail} can now be used for real outbound.`,
          details: [
            route?.routeKind ? `Route: ${route.routeKind}` : "Route: current sender route",
            route?.placement ? `Placement: ${route.placement}` : "Placement evidence not available yet",
          ],
        },
      } satisfies OperatorToolResult;
    },
  },
  {
    name: "provision_mailpool_sender",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description: "Buy or attach a Mailpool domain, create a sender mailbox, and assign it to the brand.",
    autonomyHint:
      "Use when the blocker is no usable Mailpool sender and the required domain, local part, sender identity, and any registrant details are available or can be inferred from memory/context.",
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
        domainCandidates: asStringArray(input.domainCandidates),
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
    name: "provision_customerio_sender",
    riskLevel: "guarded_write",
    approvalMode: "confirm",
    description:
      "Buy or attach a domain, create a Customer.io sender identity, apply DNS through the configured registrar, and assign it to the brand with a real reply mailbox.",
    autonomyHint:
      "Use when Gmail UI/Mailpool delivery is weak or blocked and the agent should create a Customer.io-backed sender route using available provider credentials.",
    previewTitle: "Provision Customer.io sender",
    buildPreview: buildCustomerIoProvisionPreview,
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const result = await provisionSender({
        brandId,
        provider: "customerio",
        accountName: asString(input.accountName),
        assignToBrand: input.assignToBrand !== false,
        selectedMailboxAccountId: asString(input.selectedMailboxAccountId),
        domainMode: asString(input.domainMode) === "register" ? "register" : "existing",
        domain: requireString(input, "domain"),
        domainCandidates: asStringArray(input.domainCandidates),
        fromLocalPart: requireString(input, "fromLocalPart"),
        senderFirstName: asString(input.senderFirstName),
        senderLastName: asString(input.senderLastName),
        autoPickCustomerIoAccount: input.autoPickCustomerIoAccount !== false,
        customerIoSourceAccountId: asString(input.customerIoSourceAccountId),
        forwardingTargetUrl: asString(input.forwardingTargetUrl),
        customerIoSiteId: asString(input.customerIoSiteId),
        customerIoTrackingApiKey: asString(input.customerIoTrackingApiKey),
        customerIoAppApiKey: asString(input.customerIoAppApiKey),
        mailpoolApiKey: "",
        namecheapApiUser: asString(input.namecheapApiUser),
        namecheapUserName: asString(input.namecheapUserName),
        namecheapApiKey: asString(input.namecheapApiKey),
        namecheapClientIp: asString(input.namecheapClientIp),
        registrant: buildRegistrant(input.registrant),
      });
      return {
        summary: `Provisioned Customer.io sender ${result.fromEmail} for ${result.brand.name}.`,
        result: result as unknown as Record<string, unknown>,
        receipt: {
          title: "Customer.io sender provisioning started",
          summary: `${result.fromEmail} is now attached to ${result.brand.name}.`,
          details: [
            `Domain: ${result.domain}`,
            result.readyToSend ? "Sender can be tested now." : "Sender still needs verification or propagation before production sending.",
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
    autonomyHint:
      "Use when a campaign is ready and the next safe autonomous move is to create real scheduled outbound messages from the actual campaign copy.",
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
      "Pause, resume, cancel, or deliverability-control a campaign run. Valid deliverability actions are exact strings: probe_deliverability, probe_all_senders_deliverability, resume_sender_deliverability, and seed_inbox_placement. Use probe_all_senders_deliverability to compare Gmail UI, Mailpool SMTP, and Customer.io transports with the same live campaign copy before choosing a route. If no real scheduled or sent campaign message exists yet, run launch_campaign_run for the campaign first, then retry the probe.",
    autonomyHint:
      "Use after inspecting campaign/run state to pause risk, resume safe work, refresh a sender, or run exact-copy deliverability probes across available sender routes.",
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
