import {
  createBrand,
  createId,
  deleteBrand,
  getBrandById,
  updateBrand,
} from "@/lib/factory-data";
import type {
  BrandRecord,
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
import { EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS } from "@/lib/experiment-policy";
import {
  createExperimentRecord,
  deleteScaleCampaignRecord,
  deleteExperimentRecord,
  ensureRuntimeForExperiment,
  getExperimentRecordById,
  getScaleCampaignRecordById,
  listScaleCampaignRecords,
  promoteExperimentRecordToCampaign,
  updateExperimentRecord,
  updateScaleCampaignRecord,
} from "@/lib/experiment-data";
import { refreshMailpoolOutreachAccount } from "@/lib/mailpool-account-refresh";
import { getOperatorBrandContext, getOperatorSenderContext } from "@/lib/operator-context";
import type { OperatorToolName, OperatorToolResult, OperatorToolSpec } from "@/lib/operator-types";
import {
  getOutreachRun,
  getReplyDraft,
  getReplyThread,
  listExperimentRuns,
  listOwnerRuns,
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
  const domainMode = asString(input.domainMode) === "register" ? "register" : "existing";
  return {
    title: "Add Mailpool sender",
    summary:
      domainMode === "register"
        ? `Buy ${domain}, create ${fromLocalPart}@${domain}, and attach it to the brand.`
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

async function getBrandOrThrow(brandId: string) {
  const brand = await getBrandById(brandId);
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
      const inboxPlacementId = result.account.config.mailpool.inboxPlacementId.trim();
      const deliverabilityDetails = [
        result.domain?.domain ? `Domain: ${result.domain.domain}` : "No Mailpool domain match was found.",
        spamSummary ? `Spam check: ${spamSummary}` : "Spam check: not available yet.",
        inboxPlacementId ? `Inbox placement id: ${inboxPlacementId}` : "Inbox placement: not created yet.",
        result.mailboxDeleted ? "Mailbox is deleted in Mailpool." : "Mailbox still exists in Mailpool.",
        ...result.deliverabilityKickoffErrors.slice(0, 2),
      ];
      return {
        summary:
          result.deliverabilityKickoffErrors.length > 0
            ? `${fromEmail} refreshed. Spam checks were synced, but inbox placement still failed in Mailpool.`
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
      if (prospectTable.rowCount < EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS) {
        throw new Error(
          `Prospect validation failed: need at least ${EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS} saved leads before launch.`
        );
      }

      const sendableSummary = await countExperimentSendableLeadContacts(brandId, experiment.id);
      if (sendableSummary.sendableLeadCount < EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS) {
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
    description: "Pause, resume, cancel, or deliverability-control a campaign run.",
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
          "resume_sender_deliverability",
        ].includes(action)
      ) {
        throw new Error(
          "action must be pause, resume, cancel, probe_deliverability, or resume_sender_deliverability"
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
          | "resume_sender_deliverability",
        reason: asString(input.reason) || undefined,
        senderAccountId: asString(input.senderAccountId) || undefined,
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
