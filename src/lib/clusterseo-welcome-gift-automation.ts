import "server-only";

import { getAppUrl } from "@/lib/app-url";
import {
  callClusterSeoNetwork,
  clusterSeoTapInIdentity,
  type ClusterSeoDraft,
  type ClusterSeoGrant,
  type ClusterSeoOpportunity,
  type ClusterSeoOpportunityList,
} from "@/lib/clusterseo-integration";
import {
  clusterSeoWelcomeGiftAutomationConfig,
  explainClusterSeoWelcomeGiftEligibility,
  isAutomatableClusterSeoWelcomeGift,
  validateAutomatedWelcomeGiftComment,
} from "@/lib/clusterseo-welcome-gift-policy";
import { getOutreachAccount, getOutreachAccountSecrets } from "@/lib/outreach-data";
import { getTapInAutomationIdentityForUser } from "@/lib/tapinsocial-auth";
import { getTapInNetworkDeliveryByMissionId } from "@/lib/tapinsocial-network-data";

type AutomationIdentity = NonNullable<Awaited<ReturnType<typeof getTapInAutomationIdentityForUser>>>;

type AutomationAccount = {
  accountId: string;
  channelId: string;
  name: string;
  handle: string;
};

type DeliveryResult = {
  ok?: boolean;
  alreadyProcessed?: boolean;
  commentId?: string;
  commentUrl?: string;
  creditsAwarded?: number;
  creditBalance?: number;
  error?: string;
};

function webhookSecret() {
  return String(
    process.env.LIFTLINE_AUTOPILOT_WEBHOOK_SECRET ?? process.env.LIFTLINE_WEBHOOK_SECRET ?? ""
  ).trim();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "ClusterSEO welcome gift automation failed.";
}

function accountIndex(missionId: string, accountCount: number) {
  let hash = 0;
  for (const character of missionId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return accountCount ? hash % accountCount : 0;
}

async function usableAccounts(identity: AutomationIdentity): Promise<AutomationAccount[]> {
  const candidates = await Promise.all(
    identity.workspace.youtubeAccounts.map(async (workspaceAccount) => {
      const [account, secrets] = await Promise.all([
        getOutreachAccount(workspaceAccount.accountId).catch(() => null),
        getOutreachAccountSecrets(workspaceAccount.accountId).catch(() => null),
      ]);
      if (
        !account ||
        account.status !== "active" ||
        !account.config.social.enabled ||
        account.config.social.connectionProvider !== "youtube" ||
        account.config.social.linkedProvider !== "youtube" ||
        account.config.social.externalAccountId !== workspaceAccount.channelId ||
        !secrets?.youtubeRefreshToken.trim()
      ) {
        return null;
      }
      return {
        accountId: workspaceAccount.accountId,
        channelId: workspaceAccount.channelId,
        name: workspaceAccount.name,
        handle: workspaceAccount.handle,
      } satisfies AutomationAccount;
    })
  );
  return candidates.filter((account): account is AutomationAccount => Boolean(account));
}

async function deliverComment(input: {
  identity: AutomationIdentity;
  missionId: string;
  account: AutomationAccount;
  text: string;
  videoUrl: string;
  deliveryToken: string;
}) {
  const secret = webhookSecret();
  if (!secret) throw new Error("TapIn comment delivery is not configured.");
  const response = await fetch(`${getAppUrl()}/api/webhooks/liftline/network-comment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-liftline-secret": secret,
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      userId: input.identity.userId,
      email: input.identity.email,
      name: input.identity.name,
      brandId: input.identity.workspace.brandId,
      missionId: input.missionId,
      accountId: input.account.accountId,
      channelId: input.account.channelId,
      text: input.text,
      videoUrl: input.videoUrl,
      deliveryToken: input.deliveryToken,
    }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as DeliveryResult;
  if (!response.ok) {
    const error = new Error(payload.error || "YouTube could not post this automated welcome comment.") as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  return payload;
}

function validComment(value: unknown, opportunity: ClusterSeoOpportunity) {
  const quality = validateAutomatedWelcomeGiftComment({ value, opportunity });
  const text = quality.text;
  if (text.length < 10 || text.length > 1250) {
    throw new Error("ClusterSEO returned an invalid welcome gift comment length.");
  }
  if (!quality.valid) {
    throw new Error(
      `ClusterSEO returned a low-quality welcome gift comment: ${quality.reasons.join(", ")}.`
    );
  }
  return text;
}

function eligibleOpportunities(
  opportunities: ClusterSeoOpportunity[],
  clusterUserId: string,
  targetDomains: string[]
) {
  return opportunities.filter((opportunity) =>
    isAutomatableClusterSeoWelcomeGift({ opportunity, clusterUserId, targetDomains })
  );
}

export async function runClusterSeoWelcomeGiftAutomation(input: { forceDryRun?: boolean } = {}) {
  const config = clusterSeoWelcomeGiftAutomationConfig();
  const dryRun = config.dryRun || input.forceDryRun === true;
  if (!config.enabled || !config.configured) {
    return {
      ok: true,
      skipped: true,
      reason: !config.enabled ? "automation_disabled" : "automation_allowlist_missing",
      dryRun,
      results: [],
    };
  }

  const results: Array<Record<string, unknown>> = [];
  let attempted = 0;
  for (const userId of config.userIds) {
    if (attempted >= config.perRunCap) break;
    try {
      const identity = await getTapInAutomationIdentityForUser(userId);
      if (!identity) {
        results.push({ userId, status: "skipped", reason: "tapin_identity_missing" });
        continue;
      }
      const accounts = (await usableAccounts(identity)).filter((account) =>
        config.accountIds.includes(account.accountId)
      );
      if (!accounts.length) {
        results.push({ userId, status: "skipped", reason: "allowlisted_youtube_account_missing" });
        continue;
      }
      const networkIdentity = clusterSeoTapInIdentity({
        userId: identity.userId,
        email: identity.email,
        name: identity.name,
        workspace: identity.workspace,
      });
      const listed = await callClusterSeoNetwork<ClusterSeoOpportunityList>({
        action: "list",
        identity: networkIdentity,
      });
      const opportunities = eligibleOpportunities(
        listed.opportunities || [],
        listed.connection.clusterUserId,
        config.targetDomains
      );
      if (!opportunities.length) {
        results.push({
          userId,
          status: "skipped",
          reason: "eligible_welcome_gift_missing",
          candidates: (listed.opportunities || []).slice(0, 20).map((opportunity) =>
            explainClusterSeoWelcomeGiftEligibility({
              opportunity,
              clusterUserId: listed.connection.clusterUserId,
              targetDomains: config.targetDomains,
            })
          ),
        });
        continue;
      }

      for (const opportunity of opportunities) {
        if (attempted >= config.perRunCap) break;
        const existing = await getTapInNetworkDeliveryByMissionId(opportunity.id);
        if (existing?.status === "settled") {
          results.push({ userId, missionId: opportunity.id, status: "settled", alreadyProcessed: true });
          continue;
        }
        if (existing?.status === "posted_unverified") {
          results.push({ userId, missionId: opportunity.id, status: "blocked", reason: "posted_unverified" });
          continue;
        }
        if (existing?.status === "posting" && !existing.commentId) {
          results.push({ userId, missionId: opportunity.id, status: "pending", reason: "delivery_in_progress" });
          continue;
        }

        const existingAccount = existing
          ? accounts.find((account) => account.accountId === existing.accountId)
          : null;
        const account = existing
          ? existingAccount
          : accounts[accountIndex(opportunity.id, accounts.length)];
        if (!account) {
          results.push({ userId, missionId: opportunity.id, status: "skipped", reason: "delivery_account_missing" });
          continue;
        }
        attempted += 1;
        if (dryRun) {
          results.push({
            userId,
            missionId: opportunity.id,
            accountId: account.accountId,
            status: "dry_run_ready",
          });
          continue;
        }

        const text = existing?.commentText
          ? validComment(existing.commentText, opportunity)
          : validComment(
              (
                await callClusterSeoNetwork<ClusterSeoDraft>({
                  action: "draft",
                  identity: networkIdentity,
                  missionId: opportunity.id,
                })
              ).draft,
              opportunity
            );
        const grant = await callClusterSeoNetwork<ClusterSeoGrant>({
          action: "grant",
          identity: networkIdentity,
          missionId: opportunity.id,
          accountId: account.accountId,
          text,
        });
        const delivery = await deliverComment({
          identity,
          missionId: opportunity.id,
          account,
          text,
          videoUrl: grant.mission.videoUrl,
          deliveryToken: grant.deliveryToken,
        });
        results.push({
          userId,
          missionId: opportunity.id,
          accountId: account.accountId,
          status: "settled",
          alreadyProcessed: Boolean(delivery.alreadyProcessed),
          commentUrl: String(delivery.commentUrl || ""),
          creditsAwarded: Number(delivery.creditsAwarded || 0),
        });
      }
    } catch (error) {
      results.push({ userId, status: "failed", error: errorMessage(error) });
    }
  }

  return {
    ok: !results.some((result) => result.status === "failed" || result.status === "blocked"),
    skipped: false,
    dryRun,
    attempted,
    results,
  };
}
