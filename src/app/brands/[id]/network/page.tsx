import NetworkClient from "./network-client";
import { getBrandById, listBrands } from "@/lib/factory-data";
import {
  getBrandOutreachAssignment,
  listBrandRuns,
  listDeliverabilityProbeRuns,
  listOutreachAccounts,
  listRunMessages,
  listSenderLaunches,
} from "@/lib/outreach-data";
import { getOutreachProvisioningSettings } from "@/lib/outreach-provider-settings";
import { enrichBrandWithSenderHealth } from "@/lib/sender-health";
import { buildSenderDeliverabilityScorecards } from "@/lib/outreach-deliverability";
import {
  buildSenderUsageMap,
  buildSenderCapacitySnapshots,
  type SenderCapacitySnapshot,
} from "@/lib/sender-capacity";
import {
  getDomainDeliveryAccountId,
  getOutreachAccountFromEmail,
  getOutreachAccountReplyToEmail,
} from "@/lib/outreach-account-helpers";
import type { DomainRow } from "@/lib/factory-types";
import { notFound } from "next/navigation";

const DEFAULT_SENDER_BUSINESS_HOURS = 8;

function buildSyntheticAssignedSenderRow(input: {
  accountId: string;
  accountName: string;
  fromEmail: string;
  replyMailboxEmail: string;
  createdAt: string;
}): DomainRow {
  const domain = input.fromEmail.split("@")[1]?.trim().toLowerCase() || input.fromEmail.trim().toLowerCase();
  return {
    id: `assigned-sender:${input.accountId}`,
    domain,
    status: "active",
    warmupStage: "assigned",
    reputation: "good",
    automationStatus: "ready",
    automationSummary: "Assigned sender account available for this brand.",
    domainHealth: "healthy",
    domainHealthSummary: "Assigned sender is active and already configured for outbound delivery.",
    emailHealth: "healthy",
    emailHealthSummary: "Sender mailbox is active.",
    ipHealth: "healthy",
    ipHealthSummary: "Delivery account is active.",
    messagingHealth: "healthy",
    messagingHealthSummary: "This sender is available for production sends.",
    seedPolicy: "fresh_pool",
    role: "sender",
    registrar: "manual",
    provider: "customerio",
    dnsStatus: "verified",
    fromEmail: input.fromEmail,
    replyMailboxEmail: input.replyMailboxEmail,
    deliveryAccountId: input.accountId,
    deliveryAccountName: input.accountName,
    customerIoAccountId: input.accountId,
    customerIoAccountName: input.accountName,
    notes: "Synthesized from the brand's assigned delivery account.",
    lastProvisionedAt: input.createdAt,
  };
}

function applySenderLaunchToRow(row: DomainRow, launch: Awaited<ReturnType<typeof listSenderLaunches>>[number] | null): DomainRow {
  if (!launch) return row;
  return {
    ...row,
    senderLaunchId: launch.id,
    senderLaunchPlanType: launch.planType,
    senderLaunchState: launch.state,
    senderLaunchScore: launch.readinessScore,
    senderLaunchSummary: launch.summary,
    senderLaunchNextStep: launch.nextStep,
    senderLaunchTopicSummary: launch.topicSummary,
    senderLaunchDailyCap: launch.dailyCap,
    senderLaunchLastEvaluatedAt: launch.lastEvaluatedAt,
    senderLaunchAutopilotMode: launch.autopilotMode,
    senderLaunchAutopilotAllowedDomains: launch.autopilotAllowedDomains,
    senderLaunchAutopilotBlockedDomains: launch.autopilotBlockedDomains,
  };
}

export default async function NetworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand) notFound();
  const [enrichedBrand, allBrands, accounts, provisioningSettings, assignment, probeRuns, brandRuns, senderLaunches] = await Promise.all([
    enrichBrandWithSenderHealth(brand),
    listBrands(),
    listOutreachAccounts(),
    getOutreachProvisioningSettings(),
    getBrandOutreachAssignment(brand.id),
    listDeliverabilityProbeRuns({ brandId: brand.id, limit: 300 }),
    listBrandRuns(brand.id),
    listSenderLaunches({ brandId: brand.id }, { allowMissingTable: true }),
  ]);
  const senderLaunchByAccountId = new Map(senderLaunches.map((launch) => [launch.senderAccountId, launch] as const));
  const senderLaunchByEmail = new Map(
    senderLaunches
      .map((launch) => [launch.fromEmail.trim().toLowerCase(), launch] as const)
      .filter(([fromEmail]) => Boolean(fromEmail))
  );
  const launchAwareBrand = {
    ...enrichedBrand,
    domains: enrichedBrand.domains.map((row) => {
      const launch =
        (getDomainDeliveryAccountId(row)
          ? senderLaunchByAccountId.get(getDomainDeliveryAccountId(row)) ?? null
          : null) ||
        (row.fromEmail ? senderLaunchByEmail.get(String(row.fromEmail).trim().toLowerCase()) ?? null : null);
      return applySenderLaunchToRow(row, launch);
    }),
  };
  const mailboxAccounts = accounts.filter(
    (account) => account.accountType !== "delivery" && !account.name.trim().toLowerCase().startsWith("deliverability ")
  );
  const customerIoAccounts = accounts.filter((account) => account.accountType !== "mailbox");
  const assignedDeliveryAccountIds = new Set(
    [
      assignment?.accountId ?? "",
      ...(assignment?.accountIds ?? []),
    ].filter(Boolean)
  );
  const senderAccountIds = new Set(
    launchAwareBrand.domains.map((row) => getDomainDeliveryAccountId(row)).filter((value): value is string => Boolean(value))
  );
  const senderEmails = new Set(
    launchAwareBrand.domains
      .map((row) => String(row.fromEmail ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
  const brandSenderAccounts = customerIoAccounts.filter((account) => {
    const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
    const matchesBrand =
      assignedDeliveryAccountIds.has(account.id) ||
      senderAccountIds.has(account.id) ||
      (fromEmail ? senderEmails.has(fromEmail) : false);
    return matchesBrand;
  });
  const replyMailboxAccount = accounts.find((account) => account.id === assignment?.mailboxAccountId) ?? null;
  const syntheticAssignedSenderRows = brandSenderAccounts.flatMap((account) => {
    const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
    if (!fromEmail) return [];
    const existingRow =
      launchAwareBrand.domains.find((row) => getDomainDeliveryAccountId(row) === account.id) ??
      launchAwareBrand.domains.find((row) => String(row.fromEmail ?? "").trim().toLowerCase() === fromEmail) ??
      null;
    if (existingRow) return [];
    return [
      buildSyntheticAssignedSenderRow({
        accountId: account.id,
        accountName: account.name,
        fromEmail,
        replyMailboxEmail:
          getOutreachAccountReplyToEmail(account)?.trim().toLowerCase() ||
          getOutreachAccountReplyToEmail(replyMailboxAccount)?.trim().toLowerCase() ||
          getOutreachAccountReplyToEmail(account)?.trim().toLowerCase(),
        createdAt: account.createdAt,
      }),
    ];
  });
  const mergedBrand = {
    ...launchAwareBrand,
    domains: [...launchAwareBrand.domains, ...syntheticAssignedSenderRows],
  };
  const senderScorecards = buildSenderDeliverabilityScorecards({
    probeRuns,
    senderAccounts: brandSenderAccounts,
  });
  const scorecardByAccountId = new Map(
    senderScorecards
      .filter((scorecard) => scorecard.senderAccountId)
      .map((scorecard) => [scorecard.senderAccountId, scorecard] as const)
  );
  const usageTimeZone = brandRuns.find((run) => run.timezone.trim())?.timezone || "America/Los_Angeles";
  const senderUsage = buildSenderUsageMap({
    entries: await Promise.all(
      brandRuns.map(async (run) => ({
        run,
        messages: await listRunMessages(run.id),
      }))
    ),
    timeZone: usageTimeZone,
  });
  const senderCapacitySnapshots: SenderCapacitySnapshot[] = buildSenderCapacitySnapshots({
    senders: brandSenderAccounts.map((account) => {
      const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
      const row =
        mergedBrand.domains.find((item) => getDomainDeliveryAccountId(item) === account.id) ??
        mergedBrand.domains.find((item) => String(item.fromEmail ?? "").trim().toLowerCase() === fromEmail) ??
        null;
      return {
        account,
        row,
        scorecard: scorecardByAccountId.get(account.id),
      };
    }),
    timeZone: usageTimeZone,
    businessHoursPerDay: DEFAULT_SENDER_BUSINESS_HOURS,
    usage: senderUsage,
  })
    .sort((left, right) => left.fromEmail.localeCompare(right.fromEmail));

  return (
    <NetworkClient
      brand={mergedBrand}
      allBrands={allBrands}
      mailboxAccounts={mailboxAccounts}
      customerIoAccounts={customerIoAccounts}
      assignments={
        assignment
          ? {
              [brand.id]: {
                accountId: assignment.accountId,
                accountIds: assignment.accountIds,
                mailboxAccountId: assignment.mailboxAccountId,
              },
            }
          : {}
      }
      provisioningSettings={provisioningSettings}
      senderCapacitySnapshots={senderCapacitySnapshots}
    />
  );
}
