import type { OutreachAccount } from "@/lib/factory-types";

export type CustomerIoCapacityPool = {
  id: string;
  sourceAccountId: string;
  sourceAccountName: string;
  siteId: string;
  workspaceId: string;
  senderAccountIds: string[];
  senderCount: number;
  billingPeriodStart: string;
  baselineReady: boolean;
  monthlyProfileLimit: number;
  currentPeriodBaselineProfiles: number;
  currentPeriodAdmittedProfiles: number;
  observedWorkspaceProfiles: number;
  projectedProfiles: number;
  remainingProfiles: number;
  usageRatio: number;
  status: OutreachAccount["status"];
  hasCredentials: boolean;
  lastTestAt: string;
  lastTestStatus: OutreachAccount["lastTestStatus"];
  fromEmailSamples: string[];
  canProvision: boolean;
  warning: string;
};

function accountGroupKey(account: OutreachAccount) {
  const siteId = account.config.customerIo.siteId.trim();
  const workspaceId = account.config.customerIo.workspaceId.trim();
  return `${siteId}::${workspaceId || "default"}`;
}

function compareAccountsForPoolSource(left: OutreachAccount, right: OutreachAccount) {
  if (left.status !== right.status) {
    return left.status === "active" ? -1 : 1;
  }
  if (left.hasCredentials !== right.hasCredentials) {
    return left.hasCredentials ? -1 : 1;
  }
  if (left.lastTestStatus !== right.lastTestStatus) {
    return left.lastTestStatus === "pass" ? -1 : 1;
  }
  const leftUpdated = Date.parse(left.updatedAt || left.createdAt || "");
  const rightUpdated = Date.parse(right.updatedAt || right.createdAt || "");
  return rightUpdated - leftUpdated;
}

function sortPools(left: CustomerIoCapacityPool, right: CustomerIoCapacityPool) {
  if (left.canProvision !== right.canProvision) {
    return left.canProvision ? -1 : 1;
  }
  if (left.remainingProfiles !== right.remainingProfiles) {
    return right.remainingProfiles - left.remainingProfiles;
  }
  if (left.projectedProfiles !== right.projectedProfiles) {
    return left.projectedProfiles - right.projectedProfiles;
  }
  return left.sourceAccountName.localeCompare(right.sourceAccountName);
}

export function buildCustomerIoCapacityPools(accounts: OutreachAccount[]): CustomerIoCapacityPool[] {
  const grouped = new Map<string, OutreachAccount[]>();

  for (const account of accounts) {
    if (account.accountType === "mailbox") continue;
    if (!account.config.customerIo.siteId.trim()) continue;
    const key = accountGroupKey(account);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(account);
    } else {
      grouped.set(key, [account]);
    }
  }

  return [...grouped.values()]
    .map((group) => {
      const sortedGroup = [...group].sort(compareAccountsForPoolSource);
      const sourceAccount = sortedGroup[0];
      const summaries = sortedGroup
        .map((account) => account.customerIoBilling)
        .filter((summary): summary is NonNullable<OutreachAccount["customerIoBilling"]> => Boolean(summary));

      const monthlyProfileLimit = summaries.length
        ? Math.min(...summaries.map((summary) => Math.max(0, summary.monthlyProfileLimit)))
        : 0;
      const billingPeriodStart = summaries.find((summary) => summary.billingPeriodStart)?.billingPeriodStart ?? "";
      const baselineReady = summaries.some((summary) => summary.baselineReady);
      const currentPeriodBaselineProfiles = Math.max(
        0,
        ...summaries.map((summary) => (summary.baselineReady ? summary.currentPeriodBaselineProfiles : 0))
      );
      const currentPeriodAdmittedProfiles = summaries.reduce(
        (total, summary) => total + Math.max(0, summary.currentPeriodAdmittedProfiles),
        0
      );
      const observedWorkspaceProfiles = Math.max(
        0,
        ...summaries.map((summary) => Math.max(0, summary.observedWorkspaceProfiles))
      );
      const projectedProfiles = Math.max(
        observedWorkspaceProfiles,
        currentPeriodBaselineProfiles + currentPeriodAdmittedProfiles
      );
      const remainingProfiles = Math.max(0, monthlyProfileLimit - projectedProfiles);
      const fromEmailSamples = [...new Set(
        sortedGroup
          .map((account) => account.config.customerIo.fromEmail.trim())
          .filter(Boolean)
      )].slice(0, 3);

      let warning = "";
      if (!baselineReady) {
        warning = "Waiting for baseline sync";
      } else if (remainingProfiles <= 0) {
        warning = "Monthly profile cap reached";
      } else if (sourceAccount.status !== "active") {
        warning = "Source account is inactive";
      } else if (!sourceAccount.hasCredentials) {
        warning = "Source account credentials are missing";
      }

      return {
        id: sourceAccount.id,
        sourceAccountId: sourceAccount.id,
        sourceAccountName: sourceAccount.name,
        siteId: sourceAccount.config.customerIo.siteId.trim(),
        workspaceId: sourceAccount.config.customerIo.workspaceId.trim(),
        senderAccountIds: sortedGroup.map((account) => account.id),
        senderCount: sortedGroup.length,
        billingPeriodStart,
        baselineReady,
        monthlyProfileLimit,
        currentPeriodBaselineProfiles,
        currentPeriodAdmittedProfiles,
        observedWorkspaceProfiles,
        projectedProfiles,
        remainingProfiles,
        usageRatio: monthlyProfileLimit > 0 ? Math.min(1, projectedProfiles / monthlyProfileLimit) : 0,
        status: sourceAccount.status,
        hasCredentials: sourceAccount.hasCredentials,
        lastTestAt: sourceAccount.lastTestAt,
        lastTestStatus: sourceAccount.lastTestStatus,
        fromEmailSamples,
        canProvision:
          Boolean(sourceAccount.hasCredentials) &&
          sourceAccount.status === "active" &&
          baselineReady &&
          remainingProfiles > 0,
        warning,
      } satisfies CustomerIoCapacityPool;
    })
    .sort(sortPools);
}

export function findBestCustomerIoCapacityPool(pools: CustomerIoCapacityPool[]) {
  return pools.find((pool) => pool.canProvision) ?? null;
}
