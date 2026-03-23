import NetworkClient from "./network-client";
import { getBrandById, listBrands } from "@/lib/factory-data";
import { getBrandOutreachAssignment, listOutreachAccounts } from "@/lib/outreach-data";
import { getOutreachProvisioningSettings } from "@/lib/outreach-provider-settings";
import { enrichBrandWithSenderHealth } from "@/lib/sender-health";
import { notFound } from "next/navigation";

export default async function NetworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrandById(id);
  if (!brand) notFound();
  const [enrichedBrand, allBrands, accounts, provisioningSettings, assignment] = await Promise.all([
    enrichBrandWithSenderHealth(brand),
    listBrands(),
    listOutreachAccounts(),
    getOutreachProvisioningSettings(),
    getBrandOutreachAssignment(brand.id),
  ]);
  const mailboxAccounts = accounts.filter(
    (account) => account.accountType !== "delivery" && !account.name.trim().toLowerCase().startsWith("deliverability ")
  );
  const customerIoAccounts = accounts.filter((account) => account.accountType !== "mailbox");

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
    />
  );
}
