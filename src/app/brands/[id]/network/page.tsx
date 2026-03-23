import NetworkClient from "./network-client";
import { getBrandById, listBrands } from "@/lib/factory-data";
import {
  getBrandOutreachAssignment,
  listBrandRuns,
  listDeliverabilityProbeRuns,
  listOutreachAccounts,
  listRunMessages,
} from "@/lib/outreach-data";
import { getOutreachProvisioningSettings } from "@/lib/outreach-provider-settings";
import { enrichBrandWithSenderHealth } from "@/lib/sender-health";
import { buildSenderDeliverabilityScorecards } from "@/lib/outreach-deliverability";
import {
  buildSenderUsageMap,
  calculateSenderCapacityPolicy,
  type SenderCapacitySnapshot,
} from "@/lib/sender-capacity";
import { getDomainDeliveryAccountId, getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import { notFound } from "next/navigation";

const DEFAULT_SENDER_BUSINESS_HOURS = 8;

export default async function NetworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand) notFound();
  const [enrichedBrand, allBrands, accounts, provisioningSettings, assignment, probeRuns, brandRuns] = await Promise.all([
    enrichBrandWithSenderHealth(brand),
    listBrands(),
    listOutreachAccounts(),
    getOutreachProvisioningSettings(),
    getBrandOutreachAssignment(brand.id),
    listDeliverabilityProbeRuns({ brandId: brand.id, limit: 300 }),
    listBrandRuns(brand.id),
  ]);
  const mailboxAccounts = accounts.filter(
    (account) => account.accountType !== "delivery" && !account.name.trim().toLowerCase().startsWith("deliverability ")
  );
  const customerIoAccounts = accounts.filter((account) => account.accountType !== "mailbox");
  const senderAccountIds = new Set(
    enrichedBrand.domains.map((row) => getDomainDeliveryAccountId(row)).filter((value): value is string => Boolean(value))
  );
  const senderEmails = new Set(
    enrichedBrand.domains
      .map((row) => String(row.fromEmail ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
  const brandSenderAccounts = customerIoAccounts.filter((account) => {
    const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
    return senderAccountIds.has(account.id) || (fromEmail ? senderEmails.has(fromEmail) : false);
  });
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
  const senderCapacitySnapshots: SenderCapacitySnapshot[] = brandSenderAccounts
    .map((account) => {
      const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
      const row =
        enrichedBrand.domains.find((item) => getDomainDeliveryAccountId(item) === account.id) ??
        enrichedBrand.domains.find((item) => String(item.fromEmail ?? "").trim().toLowerCase() === fromEmail) ??
        null;
      const policy = calculateSenderCapacityPolicy({
        account,
        timeZone: usageTimeZone,
        businessHoursPerDay: DEFAULT_SENDER_BUSINESS_HOURS,
        row,
        scorecard: scorecardByAccountId.get(account.id),
      });
      const usage = senderUsage[account.id] ?? { dailySent: 0, hourlySent: 0 };
      return {
        senderAccountId: account.id,
        fromEmail,
        dailySent: usage.dailySent,
        hourlySent: usage.hourlySent,
        ...policy,
      };
    })
    .sort((left, right) => left.fromEmail.localeCompare(right.fromEmail));

  return (
    <NetworkClient
      brand={enrichedBrand}
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
