import { getBrandById, listBrands, listCampaigns } from "@/lib/factory-data";
import type { BrandOutreachAssignment, BrandRecord, DomainRow, OutreachAccount } from "@/lib/factory-types";
import { listDeliverabilityProbeRuns, getBrandOutreachAssignment, listOutreachAccounts, listReplyThreadsByBrand } from "@/lib/outreach-data";
import { getDomainDeliveryAccountId, getOutreachAccountFromEmail, getOutreachAccountReplyToEmail } from "@/lib/outreach-account-helpers";
import { listSavedMailpoolDomains } from "@/lib/outreach-provisioning";
import { getOutreachProvisioningSettings } from "@/lib/outreach-provider-settings";
import { buildSenderRoutingSignalFromDomainRow, rankSenderRoutingSignals, summarizeSenderRoutingScore } from "@/lib/sender-routing";
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
  routeLabel: string;
  mailpoolStatus: string;
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
    names: string[];
  };
  inbox: {
    threads: number;
    newThreads: number;
    openThreads: number;
    closedThreads: number;
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
  campaignActiveCount: number;
  mailpoolConfigured: boolean;
}) {
  const issues: string[] = [];
  if (!input.mailpoolConfigured) {
    issues.push("Mailpool is not configured yet, so Operator cannot provision or refresh senders.");
  }
  if (!input.senderSnapshots.length) {
    issues.push("This brand does not have a sender attached yet.");
  }
  if (input.senderSnapshots.length && !input.senderSnapshots.some((row) => row.automationStatus === "ready")) {
    issues.push("No sender is fully ready for routing yet.");
  }
  const blockedCount = input.senderSnapshots.filter((row) => row.automationStatus === "attention").length;
  if (blockedCount > 0) {
    issues.push(`${blockedCount} sender${blockedCount === 1 ? "" : "s"} are blocked and out of rotation.`);
  }
  if (input.campaignActiveCount > 0 && !input.senderSnapshots.some((row) => row.automationStatus === "ready")) {
    issues.push("There is active campaign work, but no sender is in a ready state.");
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
  if (input.senderSnapshots.some((row) => isPendingAutomation(row.automationStatus) || row.mailpoolStatus === "pending")) {
    nextActions.push("Refresh the pending Mailpool sender to pull mailbox and deliverability state.");
  }
  if (input.senderSnapshots.some((row) => row.automationStatus === "attention")) {
    nextActions.push("Inspect the blocked sender and fix the failing domain, mailbox, transport, or message signal.");
  }
  if (!input.senderSnapshots.some((row) => row.automationStatus === "ready")) {
    nextActions.push("Wait for the control and content probes to settle before routing live traffic.");
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
        routeLabel: routeScore?.label ?? "Queued",
        mailpoolStatus: account.config.mailpool.status,
        dnsStatus: row?.dnsStatus ?? "pending",
      } satisfies OperatorSenderSnapshot;
    })
    .filter((row): row is OperatorSenderSnapshot => row !== null);
  return snapshots.sort((left, right) => right.routeScore - left.routeScore);
}

export async function getOperatorBrandContext(brandId: string): Promise<OperatorBrandContext | null> {
  const brand = await getBrandById(brandId);
  if (!brand) return null;

  const [enrichedBrand, assignment, accounts, settings, campaigns, inboxData, mailpoolDomains] = await Promise.all([
    enrichBrandWithSenderHealth(brand),
    getBrandOutreachAssignment(brand.id),
    listOutreachAccounts(),
    getOutreachProvisioningSettings(),
    listCampaigns(brand.id),
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
    campaignActiveCount: campaigns.filter((campaign) => campaign.status === "active").length,
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
      total: campaigns.length,
      draft: campaigns.filter((campaign) => campaign.status === "draft").length,
      active: campaigns.filter((campaign) => campaign.status === "active").length,
      paused: campaigns.filter((campaign) => campaign.status === "paused").length,
      names: campaigns.slice(0, 5).map((campaign) => campaign.name),
    },
    inbox: {
      threads: inboxData.threads.length,
      newThreads: inboxData.threads.filter((thread) => thread.status === "new").length,
      openThreads: inboxData.threads.filter((thread) => thread.status === "open").length,
      closedThreads: inboxData.threads.filter((thread) => thread.status === "closed").length,
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
