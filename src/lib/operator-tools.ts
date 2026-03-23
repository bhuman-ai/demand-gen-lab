import { getCampaignById, listCampaigns } from "@/lib/factory-data";
import { refreshMailpoolOutreachAccount } from "@/lib/mailpool-account-refresh";
import { getOperatorBrandContext, getOperatorSenderContext } from "@/lib/operator-context";
import type { OperatorToolName, OperatorToolResult, OperatorToolSpec } from "@/lib/operator-types";
import { listCampaignRuns, listReplyThreadsByBrand } from "@/lib/outreach-data";
import { provisionSender } from "@/lib/outreach-provisioning";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function requireString(input: Record<string, unknown>, key: string) {
  const value = asString(input[key]);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
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

const TOOL_SPECS: OperatorToolSpec[] = [
  {
    name: "get_brand_snapshot",
    riskLevel: "read",
    approvalMode: "none",
    description: "Summarize a brand's senders, routing, campaigns, and inbox state.",
    previewTitle: "Get brand snapshot",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const context = await getOperatorBrandContext(brandId);
      if (!context) {
        throw new Error("Brand not found");
      }
      return {
        summary: `${context.brand.name} has ${context.senders.total} sender${context.senders.total === 1 ? "" : "s"}, ${context.campaigns.total} campaign${context.campaigns.total === 1 ? "" : "s"}, and ${context.inbox.threads} inbox thread${context.inbox.threads === 1 ? "" : "s"}.`,
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
    description: "Summarize campaign state for a brand or for one campaign.",
    previewTitle: "Summarize campaign status",
    run: async (input) => {
      const brandId = requireString(input, "brandId");
      const campaignId = asString(input.campaignId);
      if (campaignId) {
        const campaign = await getCampaignById(brandId, campaignId);
        if (!campaign) {
          throw new Error("Campaign not found");
        }
        const runs = await listCampaignRuns(brandId, campaign.id);
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

      const campaigns = await listCampaigns(brandId);
      return {
        summary: `This brand has ${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}: ${campaigns.filter((row) => row.status === "active").length} active, ${campaigns.filter((row) => row.status === "paused").length} paused, and ${campaigns.filter((row) => row.status === "draft").length} draft.`,
        result: {
          campaigns,
          counts: {
            total: campaigns.length,
            active: campaigns.filter((row) => row.status === "active").length,
            paused: campaigns.filter((row) => row.status === "paused").length,
            draft: campaigns.filter((row) => row.status === "draft").length,
          },
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
          topIntents: Array.from(new Set(threads.slice(0, 10).map((thread) => thread.intent))),
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
    buildPreview: (input) => ({
      title: "Refresh Mailpool sender",
      summary: `Refresh Mailpool state for ${asString(input.accountId) || "the selected sender"}.`,
    }),
    run: async (input) => {
      const accountId = requireString(input, "accountId");
      const result = await refreshMailpoolOutreachAccount(accountId);
      return {
        summary: `${result.account.config.customerIo.fromEmail || result.account.name} refreshed. Mailpool status is ${result.account.config.mailpool.status}.`,
        result: result as unknown as Record<string, unknown>,
        receipt: {
          title: "Mailpool sender refreshed",
          summary: `${result.account.name} was refreshed from Mailpool.`,
          details: [
            result.domain?.domain ? `Domain: ${result.domain.domain}` : "No Mailpool domain match was found.",
            result.deliverabilityKickoffTriggered
              ? "Deliverability kickoff was triggered."
              : "No new deliverability kickoff was needed.",
            result.mailboxDeleted ? "Mailbox is deleted in Mailpool." : "Mailbox still exists in Mailpool.",
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
];

export function listOperatorToolSpecs() {
  return [...TOOL_SPECS];
}

export function getOperatorToolSpec(name: OperatorToolName) {
  return TOOL_SPECS.find((tool) => tool.name === name) ?? null;
}
