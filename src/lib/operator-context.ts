import { getBrandById, listBrands } from "@/lib/factory-data";
import { listExperimentRecords, listScaleCampaignRecords } from "@/lib/experiment-data";
import { mapExperimentToListItem } from "@/lib/experiment-list-view";
import type { BrandOutreachAssignment, BrandRecord, DomainRow, ExperimentListItem, OutreachAccount } from "@/lib/factory-types";
import { listDeliverabilityProbeRuns, getBrandOutreachAssignment, listExperimentRuns, listOutreachAccounts, listOwnerRuns, listReplyThreadsByBrand } from "@/lib/outreach-data";
import { getDomainDeliveryAccountId, getOutreachAccountFromEmail, getOutreachAccountReplyToEmail } from "@/lib/outreach-account-helpers";
import { listSavedMailpoolDomains } from "@/lib/outreach-provisioning";
import { getOutreachProvisioningSettings } from "@/lib/outreach-provider-settings";
import { buildSenderRoutingSignalFromDomainRow, rankSenderRoutingSignals, summarizeSenderRoutingScore, type SenderRoutingScoreLevel } from "@/lib/sender-routing";
import { enrichBrandWithSenderHealth } from "@/lib/sender-health";

export type OperatorSenderSnapshot = {
  accountId: string;
  accountName: string;
  provider: OutreachAccount["provider"];
  status: OutreachAccount["status"];
  fromEmail: string;
  replyToEmail: string;
  domain: string;
  automationStatus: string;
  automationSummary: string;
  routeScore: number;
  routeLevel: SenderRoutingScoreLevel;
  routeLabel: string;
  usableForRouting: boolean;
  mailpoolStatus: string;
  spamCheckSummary: string;
  inboxPlacementId: string;
  dnsStatus: string;
};

export type OperatorBrandContext = {
  brand: {
    id: string;
    name: string;
    website: string;
  };
  assignment: {
    accountId: string;
    accountIds: string[];
    mailboxAccountId: string;
  } | null;
  provisioning: {
    mailpoolConfigured: boolean;
    mailpoolWebhookConfigured: boolean;
    deliverabilityProvider: string;
    mailpoolDomainInventoryCount: number;
    mailpoolDomains: Array<{
      id: string;
      domain: string;
      status: string;
    }>;
  };
  senders: {
    total: number;
    ready: number;
    pending: number;
    blocked: number;
    snapshots: OperatorSenderSnapshot[];
  };
  routing: {
    preferredSenderAccountId: string;
    preferredSenderEmail: string;
    preferredSenderSummary: string;
    standbyCount: number;
    blockedCount: number;
  };
  campaigns: {
    total: number;
    draft: number;
    active: number;
    paused: number;
    completed: number;
    archived: number;
    names: string[];
    items: Array<{
      id: string;
      name: string;
      status: string;
      sourceExperimentId: string;
      lastRunId: string;
      updatedAt: string;
    }>;
  };
  experiments: {
    total: number;
    draft: number;
    running: number;
    sourcing: number;
    preparing: number;
    ready: number;
    paused: number;
    completed: number;
    promoted: number;
    blocked: number;
    names: string[];
    items: Array<{
      id: string;
      name: string;
      status: string;
      isActiveNow: boolean;
      lastActivityAt: string;
      lastActivityLabel: string;
      promotedCampaignId: string;
      runtimeCampaignId: string;
      runtimeExperimentId: string;
    }>;
  };
  leads: {
    total: number;
    new: number;
    contacted: number;
    qualified: number;
    closed: number;
    items: Array<{
      id: string;
      name: string;
      channel: string;
      status: string;
      lastTouch: string;
    }>;
  };
  inbox: {
    threads: number;
    newThreads: number;
    openThreads: number;
    closedThreads: number;
    threadItems: Array<{
      id: string;
      subject: string;
      status: string;
      sentiment: string;
      intent: string;
      leadId: string;
      runId: string;
      lastMessageAt: string;
    }>;
    draftItems: Array<{
      id: string;
      threadId: string;
      runId: string;
      subject: string;
      status: string;
      reason: string;
      createdAt: string;
    }>;
  };
  issues: string[];
  nextActions: string[];
};

export type OperatorSenderContext = {
  account: {
    id: string;
    name: string;
    provider: OutreachAccount["provider"];
    accountType: OutreachAccount["accountType"];
    status: OutreachAccount["status"];
    fromEmail: string;
    replyToEmail: string;
    readyToSend: boolean;
  };
  mailpool: {
    domainId: string;
    mailboxId: string;
    status: string;
    mailboxType: string;
    smtpReady: boolean;
    imapReady: boolean;
    spamCheckId: string;
    spamCheckSummary: string;
    inboxPlacementId: string;
  };
  brands: Array<{
    brandId: string;
    brandName: string;
    domain: string;
    dnsStatus: string;
    automationStatus: string;
    automationSummary: string;
    routeScore: number;
    routeLabel: string;
  }>;
  deliverability: {
    recentProbeCount: number;
    lastProbeStatus: string;
    lastProbeSummary: string;
  };
  issues: string[];
};

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function isPendingAutomation(status: string) {
  return status === "queued" || status === "testing" || status === "warming";
}

function matchesSenderDomain(row: DomainRow, account: OutreachAccount) {
  const accountId = getDomainDeliveryAccountId(row);
  const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
  return (
    accountId === account.id ||
    (fromEmail && String(row.fromEmail ?? "").trim().toLowerCase() === fromEmail)
  );
}

function summarizeBrandIssues(input: {
  brand: BrandRecord;
  senderSnapshots: OperatorSenderSnapshot[];
  activeCampaignCount: number;
  activeExperimentCount: number;
  mailpoolConfigured: boolean;
}) {
  const issues: string[] = [];
  if (!input.mailpoolConfigured) {
    issues.push("Mailpool is not configured yet, so Operator cannot provision or refresh senders.");
  }
  if (!input.senderSnapshots.length) {
    issues.push("This brand does not have a sender attached yet.");
  }
  const usableSenderCount = input.senderSnapshots.filter((row) => row.usableForRouting).length;
  const fullyReadySenderCount = input.senderSnapshots.filter((row) => row.automationStatus === "ready").length;
  if (input.senderSnapshots.length && fullyReadySenderCount === 0) {
    issues.push(
      usableSenderCount > 0
        ? "You have a usable sender route, but no sender has fully cleared warmup and probe checks yet."
        : "No sender is routeable yet."
    );
  }
  const blockedCount = input.senderSnapshots.filter((row) => row.automationStatus === "attention").length;
  if (blockedCount > 0) {
    issues.push(`${blockedCount} sender${blockedCount === 1 ? "" : "s"} are blocked and out of rotation.`);
  }
  if ((input.activeCampaignCount > 0 || input.activeExperimentCount > 0) && usableSenderCount === 0) {
    issues.push("There is live outbound work queued, but no sender route is available yet.");
  } else if (input.activeExperimentCount > 0 && fullyReadySenderCount === 0 && usableSenderCount > 0) {
    issues.push("A live experiment is running, but the preferred sender is still finishing control checks.");
  } else if (input.activeCampaignCount > 0 && fullyReadySenderCount === 0 && usableSenderCount > 0) {
    issues.push("A live campaign is active, but the preferred sender is still finishing control checks.");
  }
  if (!input.brand.domains.some((row) => row.role !== "brand")) {
    issues.push("No sender domains are attached to this brand yet.");
  }
  return issues;
}

function summarizeNextActions(input: {
  senderSnapshots: OperatorSenderSnapshot[];
  hasMailpoolInventory: boolean;
  mailpoolConfigured: boolean;
}) {
  const nextActions: string[] = [];
  if (!input.mailpoolConfigured) {
    nextActions.push("Save the Mailpool API key and webhook secret in Outreach settings.");
    return nextActions;
  }
  if (!input.senderSnapshots.length) {
    nextActions.push(
      input.hasMailpoolInventory
        ? "Add a sender using an existing Mailpool domain."
        : "Add a sender and buy a new Mailpool domain."
    );
    return nextActions;
  }
  const usableSenderCount = input.senderSnapshots.filter((row) => row.usableForRouting).length;
  const fullyReadySenderCount = input.senderSnapshots.filter((row) => row.automationStatus === "ready").length;
  if (input.senderSnapshots.some((row) => isPendingAutomation(row.automationStatus) || row.mailpoolStatus === "pending")) {
    nextActions.push("Refresh the pending Mailpool sender to pull mailbox and deliverability state.");
  }
  if (input.senderSnapshots.some((row) => row.automationStatus === "attention")) {
    nextActions.push("Inspect the blocked sender and fix the failing domain, mailbox, transport, or message signal.");
  }
  if (usableSenderCount === 0) {
    nextActions.push("Wait for at least one sender route to become usable before routing live traffic.");
  } else if (fullyReadySenderCount === 0) {
    nextActions.push("Keep the preferred sender in place, but let the control and content probes settle before scaling volume.");
  }
  return uniqueStrings(nextActions);
}

function buildSenderSnapshots(input: {
  brand: BrandRecord;
  assignment: BrandOutreachAssignment | null;
  accounts: OutreachAccount[];
}): OperatorSenderSnapshot[] {
  const accountIds = new Set(
    [
      input.assignment?.accountId ?? "",
      ...(input.assignment?.accountIds ?? []),
      input.assignment?.mailboxAccountId ?? "",
      ...input.brand.domains.map((row) => getDomainDeliveryAccountId(row)),
    ].filter(Boolean)
  );
  const accountsById = new Map(input.accounts.map((account) => [account.id, account] as const));
  const routingSignals = rankSenderRoutingSignals(
    input.brand.domains
      .map((row) => buildSenderRoutingSignalFromDomainRow(row))
      .filter((row): row is NonNullable<ReturnType<typeof buildSenderRoutingSignalFromDomainRow>> => Boolean(row))
  );
  const routingByAccountId = new Map(routingSignals.map((signal) => [signal.senderAccountId, signal] as const));
  const senderRowsByAccountId = new Map<string, DomainRow>();
  for (const row of input.brand.domains) {
    const accountId = getDomainDeliveryAccountId(row);
    if (row.role === "brand" || !accountId || senderRowsByAccountId.has(accountId)) continue;
    senderRowsByAccountId.set(accountId, row);
  }

  const snapshots = [...accountIds]
    .map((accountId): OperatorSenderSnapshot | null => {
      const account = accountsById.get(accountId);
      if (!account) return null;
      const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
      const row = senderRowsByAccountId.get(accountId) ?? null;
      const signal = routingByAccountId.get(accountId) ?? null;
      const routeScore = signal ? summarizeSenderRoutingScore(signal) : null;
      const routeLevel = routeScore?.level ?? "weak";
      return {
        accountId,
        accountName: account.name,
        provider: account.provider,
        status: account.status,
        fromEmail,
        replyToEmail: getOutreachAccountReplyToEmail(account).trim().toLowerCase(),
        domain: row?.domain ?? normalizeDomain(fromEmail.split("@")[1] ?? ""),
        automationStatus: signal?.automationStatus ?? row?.automationStatus ?? "queued",
        automationSummary: signal?.automationSummary ?? row?.automationSummary ?? "",
        routeScore: routeScore?.normalizedScore ?? 0,
        routeLevel,
        routeLabel: routeScore?.label ?? "Queued",
        usableForRouting: routeLevel === "strong" || routeLevel === "usable",
        mailpoolStatus: account.config.mailpool.status,
        spamCheckSummary: account.config.mailpool.lastSpamCheckSummary,
        inboxPlacementId: account.config.mailpool.inboxPlacementId,
        dnsStatus: row?.dnsStatus ?? "pending",
      } satisfies OperatorSenderSnapshot;
    })
    .filter((row): row is OperatorSenderSnapshot => row !== null);
  return snapshots.sort((left, right) => right.routeScore - left.routeScore);
}

async function listOperatorExperimentItems(brandId: string): Promise<ExperimentListItem[]> {
  const experiments = await listExperimentRecords(brandId);
  const now = Date.now();
  return Promise.all(
    experiments.map(async (experiment) => {
      let runs = await listOwnerRuns(brandId, "experiment", experiment.id);
      if (!runs.length && experiment.runtime.campaignId && experiment.runtime.experimentId) {
        runs = await listExperimentRuns(brandId, experiment.runtime.campaignId, experiment.runtime.experimentId);
      }
      const preferredRunId = experiment.lastRunId.trim();
      const latestRun =
        (preferredRunId ? runs.find((run) => run.id === preferredRunId) ?? null : null) ??
        runs[0] ??
        null;
      return mapExperimentToListItem({
        brandId,
        experiment,
        latestRun,
        now,
      });
    })
  );
}

export async function getOperatorBrandContext(brandId: string): Promise<OperatorBrandContext | null> {
  const brand = await getBrandById(brandId, { includeEmbedded: true });
  if (!brand) return null;

  const [enrichedBrand, assignment, accounts, settings, scaleCampaigns, experimentItems, inboxData, mailpoolDomains] = await Promise.all([
    enrichBrandWithSenderHealth(brand),
    getBrandOutreachAssignment(brand.id),
    listOutreachAccounts(),
    getOutreachProvisioningSettings(),
    listScaleCampaignRecords(brand.id),
    listOperatorExperimentItems(brand.id),
    listReplyThreadsByBrand(brand.id),
    listSavedMailpoolDomains(),
  ]);

  const senderSnapshots = buildSenderSnapshots({
    brand: enrichedBrand,
    assignment,
    accounts,
  });
  const readyCount = senderSnapshots.filter((row) => row.automationStatus === "ready").length;
  const blockedCount = senderSnapshots.filter((row) => row.automationStatus === "attention").length;
  const pendingCount = senderSnapshots.filter((row) => isPendingAutomation(row.automationStatus)).length;
  const preferred = senderSnapshots.find((row) => row.automationStatus !== "attention") ?? null;
  const issues = summarizeBrandIssues({
    brand: enrichedBrand,
    senderSnapshots,
    activeCampaignCount: scaleCampaigns.filter((campaign) => campaign.status === "active").length,
    activeExperimentCount: experimentItems.filter((item) => item.isActiveNow).length,
    mailpoolConfigured: settings.mailpool.hasApiKey,
  });
  const nextActions = summarizeNextActions({
    senderSnapshots,
    hasMailpoolInventory: mailpoolDomains.length > 0,
    mailpoolConfigured: settings.mailpool.hasApiKey,
  });

  return {
    brand: {
      id: enrichedBrand.id,
      name: enrichedBrand.name,
      website: enrichedBrand.website,
    },
    assignment: assignment
      ? {
          accountId: assignment.accountId,
          accountIds: assignment.accountIds,
          mailboxAccountId: assignment.mailboxAccountId,
        }
      : null,
    provisioning: {
      mailpoolConfigured: settings.mailpool.hasApiKey,
      mailpoolWebhookConfigured: settings.mailpool.hasWebhookSecret,
      deliverabilityProvider: settings.deliverability.provider,
      mailpoolDomainInventoryCount: mailpoolDomains.length,
      mailpoolDomains: mailpoolDomains.map((domain) => ({
        id: domain.id,
        domain: domain.domain,
        status: domain.status,
      })),
    },
    senders: {
      total: senderSnapshots.length,
      ready: readyCount,
      pending: pendingCount,
      blocked: blockedCount,
      snapshots: senderSnapshots,
    },
    routing: {
      preferredSenderAccountId: preferred?.accountId ?? "",
      preferredSenderEmail: preferred?.fromEmail ?? "",
      preferredSenderSummary:
        preferred?.automationSummary ||
        "No sender has cleared setup, warmup, and probes yet.",
      standbyCount: senderSnapshots.filter(
        (row) => row.automationStatus !== "attention" && row.accountId !== preferred?.accountId
      ).length,
      blockedCount,
    },
    campaigns: {
      total: scaleCampaigns.length,
      draft: scaleCampaigns.filter((campaign) => campaign.status === "draft").length,
      active: scaleCampaigns.filter((campaign) => campaign.status === "active").length,
      paused: scaleCampaigns.filter((campaign) => campaign.status === "paused").length,
      completed: scaleCampaigns.filter((campaign) => campaign.status === "completed").length,
      archived: scaleCampaigns.filter((campaign) => campaign.status === "archived").length,
      names: scaleCampaigns.slice(0, 5).map((campaign) => campaign.name),
      items: scaleCampaigns.slice(0, 10).map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        sourceExperimentId: campaign.sourceExperimentId,
        lastRunId: campaign.lastRunId,
        updatedAt: campaign.updatedAt,
      })),
    },
    experiments: {
      total: experimentItems.length,
      draft: experimentItems.filter((item) => item.status === "Draft").length,
      running: experimentItems.filter((item) => item.status === "Running").length,
      sourcing: experimentItems.filter((item) => item.status === "Sourcing").length,
      preparing: experimentItems.filter((item) => item.status === "Preparing").length,
      ready: experimentItems.filter((item) => item.status === "Ready").length,
      paused: experimentItems.filter((item) => item.status === "Paused").length,
      completed: experimentItems.filter((item) => item.status === "Completed").length,
      promoted: experimentItems.filter((item) => item.status === "Promoted").length,
      blocked: experimentItems.filter((item) => item.status === "Blocked").length,
      names: experimentItems.slice(0, 5).map((item) => item.name),
      items: experimentItems.slice(0, 10).map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        isActiveNow: item.isActiveNow,
        lastActivityAt: item.lastActivityAt,
        lastActivityLabel: item.lastActivityLabel,
        promotedCampaignId: item.promotedCampaignId,
        runtimeCampaignId: "",
        runtimeExperimentId: "",
      })),
    },
    leads: {
      total: enrichedBrand.leads.length,
      new: enrichedBrand.leads.filter((lead) => lead.status === "new").length,
      contacted: enrichedBrand.leads.filter((lead) => lead.status === "contacted").length,
      qualified: enrichedBrand.leads.filter((lead) => lead.status === "qualified").length,
      closed: enrichedBrand.leads.filter((lead) => lead.status === "closed").length,
      items: enrichedBrand.leads.slice(0, 20).map((lead) => ({
        id: lead.id,
        name: lead.name,
        channel: lead.channel,
        status: lead.status,
        lastTouch: lead.lastTouch,
      })),
    },
    inbox: {
      threads: inboxData.threads.length,
      newThreads: inboxData.threads.filter((thread) => thread.status === "new").length,
      openThreads: inboxData.threads.filter((thread) => thread.status === "open").length,
      closedThreads: inboxData.threads.filter((thread) => thread.status === "closed").length,
      threadItems: inboxData.threads.slice(0, 10).map((thread) => ({
        id: thread.id,
        subject: thread.subject,
        status: thread.status,
        sentiment: thread.sentiment,
        intent: thread.intent,
        leadId: thread.leadId,
        runId: thread.runId,
        lastMessageAt: thread.lastMessageAt,
      })),
      draftItems: inboxData.drafts.slice(0, 10).map((draft) => ({
        id: draft.id,
        threadId: draft.threadId,
        runId: draft.runId,
        subject: draft.subject,
        status: draft.status,
        reason: draft.reason,
        createdAt: draft.createdAt,
      })),
    },
    issues,
    nextActions,
  };
}

export async function getOperatorSenderContext(accountId: string): Promise<OperatorSenderContext | null> {
  const [accounts, brands, recentProbeRuns] = await Promise.all([
    listOutreachAccounts(),
    listBrands(),
    listDeliverabilityProbeRuns({ senderAccountId: accountId, limit: 10 }),
  ]);
  const account = accounts.find((row) => row.id === accountId) ?? null;
  if (!account) return null;

  const matchingBrands = brands.filter((brand) => brand.domains.some((row) => matchesSenderDomain(row, account)));
  const enrichedBrands = await Promise.all(matchingBrands.map((brand) => enrichBrandWithSenderHealth(brand)));
  const brandEntries = enrichedBrands
    .flatMap((brand) =>
      brand.domains
        .filter((row) => matchesSenderDomain(row, account))
        .map((row) => {
          const signal = buildSenderRoutingSignalFromDomainRow(row);
          const routeScore = signal ? summarizeSenderRoutingScore(signal) : null;
          return {
            brandId: brand.id,
            brandName: brand.name,
            domain: row.domain,
            dnsStatus: row.dnsStatus ?? "pending",
            automationStatus: row.automationStatus ?? "queued",
            automationSummary: row.automationSummary ?? "",
            routeScore: routeScore?.normalizedScore ?? 0,
            routeLabel: routeScore?.label ?? "Queued",
          };
        })
    )
    .sort((left, right) => right.routeScore - left.routeScore);

  const latestProbe = recentProbeRuns[0] ?? null;
  const issues: string[] = [];
  if (account.provider === "mailpool" && account.config.mailpool.status !== "active") {
    issues.push(`Mailpool mailbox is ${account.config.mailpool.status || "pending"} and not fully ready yet.`);
  }
  if (!account.config.mailbox.smtpHost.trim()) {
    issues.push("SMTP credentials are not available yet.");
  }
  if (!account.config.mailbox.host.trim()) {
    issues.push("IMAP credentials are not available yet.");
  }
  if (!brandEntries.length) {
    issues.push("This sender is not attached to any brand domain row yet.");
  }
  if (latestProbe?.status === "failed") {
    issues.push(latestProbe.lastError.trim() || "The latest deliverability probe failed.");
  }

  return {
    account: {
      id: account.id,
      name: account.name,
      provider: account.provider,
      accountType: account.accountType,
      status: account.status,
      fromEmail: getOutreachAccountFromEmail(account).trim().toLowerCase(),
      replyToEmail: getOutreachAccountReplyToEmail(account).trim().toLowerCase(),
      readyToSend:
        account.status === "active" &&
        account.config.mailpool.status === "active" &&
        Boolean(account.config.mailbox.smtpHost.trim()) &&
        Boolean(account.config.mailbox.smtpUsername.trim()),
    },
    mailpool: {
      domainId: account.config.mailpool.domainId,
      mailboxId: account.config.mailpool.mailboxId,
      status: account.config.mailpool.status,
      mailboxType: account.config.mailpool.mailboxType,
      smtpReady: Boolean(account.config.mailbox.smtpHost.trim() && account.config.mailbox.smtpUsername.trim()),
      imapReady: Boolean(account.config.mailbox.host.trim()),
      spamCheckId: account.config.mailpool.spamCheckId,
      spamCheckSummary: account.config.mailpool.lastSpamCheckSummary,
      inboxPlacementId: account.config.mailpool.inboxPlacementId,
    },
    brands: brandEntries,
    deliverability: {
      recentProbeCount: recentProbeRuns.length,
      lastProbeStatus: latestProbe?.status ?? "",
      lastProbeSummary: latestProbe?.summaryText ?? latestProbe?.lastError ?? "",
    },
    issues: uniqueStrings(issues),
  };
}
