import {
  claimCustomerIoProfileAdmission,
  countCustomerIoProfileAdmissions,
  findCustomerIoProfileAdmission,
  updateOutreachAccount,
  type OutreachAccountSecrets,
} from "@/lib/outreach-data";
import {
  currentCustomerIoBillingPeriodStart,
  fetchCustomerIoWorkspaceSnapshot,
  nextCustomerIoBillingPeriodStart,
} from "@/lib/outreach-customerio-billing";
import type { OutreachAccount } from "@/lib/factory-types";

type CustomerIoBudgetAllowed = {
  ok: true;
  account: OutreachAccount;
  admissionStatus: "existing" | "admitted";
  billingPeriodStart: string;
  currentCount: number;
  projectedProfiles: number;
  remainingProfiles: number;
};

type CustomerIoBudgetBlocked = {
  ok: false;
  account: OutreachAccount;
  reason: string;
  billingPeriodStart: string;
  nextBillingPeriodStart: string;
  currentCount: number;
  projectedProfiles: number;
  remainingProfiles: number;
};

export type CustomerIoBudgetAdmissionResult = CustomerIoBudgetAllowed | CustomerIoBudgetBlocked;

function effectiveCustomerIoTrackApiKey(secrets: OutreachAccountSecrets) {
  return secrets.customerIoTrackApiKey.trim() || secrets.customerIoApiKey.trim();
}

async function patchCustomerIoBillingState(
  account: OutreachAccount,
  patch: {
    workspaceId?: string;
    currentPeriodStart?: string;
    currentPeriodBaselineProfiles?: number;
    currentPeriodBaselineSyncedAt?: string;
    lastWorkspacePeopleCount?: number;
    lastWorkspacePeopleCountAt?: string;
  }
) {
  const updated = await updateOutreachAccount(account.id, {
    config: {
      customerIo: {
        workspaceId: patch.workspaceId ?? account.config.customerIo.workspaceId,
        billing: {
          currentPeriodStart: patch.currentPeriodStart ?? account.config.customerIo.billing.currentPeriodStart,
          currentPeriodBaselineProfiles:
            patch.currentPeriodBaselineProfiles ?? account.config.customerIo.billing.currentPeriodBaselineProfiles,
          currentPeriodBaselineSyncedAt:
            patch.currentPeriodBaselineSyncedAt ?? account.config.customerIo.billing.currentPeriodBaselineSyncedAt,
          lastWorkspacePeopleCount:
            patch.lastWorkspacePeopleCount ?? account.config.customerIo.billing.lastWorkspacePeopleCount,
          lastWorkspacePeopleCountAt:
            patch.lastWorkspacePeopleCountAt ?? account.config.customerIo.billing.lastWorkspacePeopleCountAt,
        },
      },
    },
  });
  return updated ?? account;
}

async function ensureCurrentBillingPeriodBaseline(
  account: OutreachAccount,
  secrets: OutreachAccountSecrets,
  billingPeriodStart: string
): Promise<
  | {
      ok: true;
      account: OutreachAccount;
    }
  | {
      ok: false;
      account: OutreachAccount;
      reason: string;
    }
> {
  const billing = account.config.customerIo.billing;
  if (billing.currentPeriodStart === billingPeriodStart && billing.currentPeriodBaselineSyncedAt) {
    return { ok: true, account };
  }

  const trackingApiKey = effectiveCustomerIoTrackApiKey(secrets);
  const appApiKey = secrets.customerIoAppApiKey.trim();
  if (!trackingApiKey) {
    return {
      ok: false,
      account,
      reason: "Customer.io tracking API key is missing, so monthly profile usage cannot be verified.",
    };
  }
  if (!appApiKey) {
    return {
      ok: false,
      account,
      reason: "Customer.io App API key is missing, so the monthly profile guard cannot initialize this billing period.",
    };
  }

  const snapshot = await fetchCustomerIoWorkspaceSnapshot({
    siteId: account.config.customerIo.siteId,
    trackingApiKey,
    appApiKey,
    workspaceId: account.config.customerIo.workspaceId,
  });
  const updated = await patchCustomerIoBillingState(account, {
    workspaceId: snapshot.workspaceId,
    currentPeriodStart: billingPeriodStart,
    currentPeriodBaselineProfiles: snapshot.people,
    currentPeriodBaselineSyncedAt: snapshot.fetchedAt,
    lastWorkspacePeopleCount: snapshot.people,
    lastWorkspacePeopleCountAt: snapshot.fetchedAt,
  });
  return { ok: true, account: updated };
}

export async function admitCustomerIoProfileForSend(input: {
  account: OutreachAccount;
  secrets: OutreachAccountSecrets;
  profileIdentifier: string;
  sourceRunId: string;
  sourceMessageId: string;
}): Promise<CustomerIoBudgetAdmissionResult> {
  let account = input.account;
  const billing = account.config.customerIo.billing;
  const billingPeriodStart = currentCustomerIoBillingPeriodStart(billing.billingCycleAnchorDay);
  const nextBillingPeriodStart = nextCustomerIoBillingPeriodStart(billingPeriodStart, billing.billingCycleAnchorDay);

  try {
    const baseline = await ensureCurrentBillingPeriodBaseline(account, input.secrets, billingPeriodStart);
    if (!baseline.ok) {
      return {
        ok: false,
        account: baseline.account,
        reason: baseline.reason,
        billingPeriodStart,
        nextBillingPeriodStart,
        currentCount: 0,
        projectedProfiles: Math.max(0, baseline.account.config.customerIo.billing.lastWorkspacePeopleCount),
        remainingProfiles: 0,
      };
    }
    account = baseline.account;

    const existing = await findCustomerIoProfileAdmission(account.id, billingPeriodStart, input.profileIdentifier);
    if (existing) {
      const existingCount = await countCustomerIoProfileAdmissions(account.id, billingPeriodStart);
      const projectedProfiles = Math.max(
        account.config.customerIo.billing.currentPeriodBaselineProfiles + existingCount,
        account.config.customerIo.billing.lastWorkspacePeopleCount
      );
      return {
        ok: true,
        account,
        admissionStatus: "existing",
        billingPeriodStart,
        currentCount: existingCount,
        projectedProfiles,
        remainingProfiles: Math.max(0, account.config.customerIo.billing.monthlyProfileLimit - projectedProfiles),
      };
    }

    const trackingApiKey = effectiveCustomerIoTrackApiKey(input.secrets);
    const appApiKey = input.secrets.customerIoAppApiKey.trim();
    if (!trackingApiKey) {
      return {
        ok: false,
        account,
        reason: "Customer.io tracking API key is missing, so monthly profile usage cannot be verified.",
        billingPeriodStart,
        nextBillingPeriodStart,
        currentCount: 0,
        projectedProfiles: Math.max(0, account.config.customerIo.billing.lastWorkspacePeopleCount),
        remainingProfiles: 0,
      };
    }
    if (!appApiKey) {
      return {
        ok: false,
        account,
        reason: "Customer.io App API key is required before new cold leads can be admitted this month.",
        billingPeriodStart,
        nextBillingPeriodStart,
        currentCount: 0,
        projectedProfiles: Math.max(0, account.config.customerIo.billing.lastWorkspacePeopleCount),
        remainingProfiles: 0,
      };
    }

    const snapshot = await fetchCustomerIoWorkspaceSnapshot({
      siteId: account.config.customerIo.siteId,
      trackingApiKey,
      appApiKey,
      workspaceId: account.config.customerIo.workspaceId,
    });
    account = await patchCustomerIoBillingState(account, {
      workspaceId: snapshot.workspaceId,
      lastWorkspacePeopleCount: snapshot.people,
      lastWorkspacePeopleCountAt: snapshot.fetchedAt,
    });

    const baselineProfiles = account.config.customerIo.billing.currentPeriodBaselineProfiles;
    const admittedBefore = await countCustomerIoProfileAdmissions(account.id, billingPeriodStart);
    const externalExtra = Math.max(0, snapshot.people - (baselineProfiles + admittedBefore));
    const effectiveAdmissionLimit = Math.max(
      0,
      account.config.customerIo.billing.monthlyProfileLimit - baselineProfiles - externalExtra
    );
    const claim = await claimCustomerIoProfileAdmission({
      accountId: account.id,
      billingPeriodStart,
      profileIdentifier: input.profileIdentifier,
      sourceRunId: input.sourceRunId,
      sourceMessageId: input.sourceMessageId,
      effectiveLimit: effectiveAdmissionLimit,
    });

    const projectedProfiles = Math.max(
      baselineProfiles + claim.currentCount,
      snapshot.people + (claim.status === "admitted" ? 1 : 0)
    );
    const remainingProfiles = Math.max(0, account.config.customerIo.billing.monthlyProfileLimit - projectedProfiles);

    if (claim.status === "blocked") {
      return {
        ok: false,
        account,
        reason: `Customer.io monthly profile cap reached for this billing period (${projectedProfiles}/${account.config.customerIo.billing.monthlyProfileLimit}).`,
        billingPeriodStart,
        nextBillingPeriodStart,
        currentCount: claim.currentCount,
        projectedProfiles,
        remainingProfiles,
      };
    }

    return {
      ok: true,
      account,
      admissionStatus: claim.status,
      billingPeriodStart,
      currentCount: claim.currentCount,
      projectedProfiles,
      remainingProfiles,
    };
  } catch (error) {
    return {
      ok: false,
      account,
      reason: error instanceof Error ? error.message : "Customer.io monthly profile guard failed",
      billingPeriodStart,
      nextBillingPeriodStart,
      currentCount: 0,
      projectedProfiles: Math.max(
        account.config.customerIo.billing.currentPeriodBaselineProfiles,
        account.config.customerIo.billing.lastWorkspacePeopleCount
      ),
      remainingProfiles: 0,
    };
  }
}
