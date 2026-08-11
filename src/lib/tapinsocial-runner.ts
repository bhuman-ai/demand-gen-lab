import { recordInternalCronRun, runCronTask } from "@/lib/internal-cron";
import { listBrands } from "@/lib/factory-data";
import { listSocialRoutingAccounts } from "@/lib/outreach-data";
import { runSocialDiscoveryAutoCommentDispatchTick } from "@/lib/social-discovery-comment-dispatch";
import { runSocialDiscoveryDelayedReplyTick } from "@/lib/social-discovery-comment-delivery";
import { splitSocialDiscoveryCsv } from "@/lib/social-discovery-search-strategy";
import { runSocialDiscoveryYouTubeRefillTick } from "@/lib/social-discovery-youtube-refill";
import { resolveActiveTapInRunnerBrandIds } from "@/lib/tapinsocial-campaign-runtime";

function envFlag(name: string, fallback = false) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function envNumber(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]);
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : fallback));
}

export function tapInRunnerConfig() {
  const brandIds = Array.from(
    new Set(splitSocialDiscoveryCsv(process.env.TAPIN_SOCIAL_AUTOMATION_BRAND_IDS))
  );
  return {
    enabled: envFlag("TAPIN_SOCIAL_AUTOMATION_ENABLED", false),
    dryRun: envFlag("TAPIN_SOCIAL_AUTOMATION_DRY_RUN", true),
    brandIds,
    configured: brandIds.length > 0,
  };
}

async function activeTapInRunnerBrandIds() {
  const config = tapInRunnerConfig();
  return resolveActiveTapInRunnerBrandIds({
    configuredBrandIds: config.brandIds,
    brands: await listBrands(),
  });
}

export function isTapInCronAuthorized(request: Request) {
  const tokens = [process.env.OUTREACH_CRON_TOKEN, process.env.CRON_SECRET]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (!tokens.length) return false;
  const header = request.headers.get("authorization") ?? "";
  return tokens.some((token) => header === `Bearer ${token}`);
}

export async function resolveTapInAccountRoles(brandId: string) {
  const accounts = await listSocialRoutingAccounts();
  const assigned = accounts.flatMap((account) =>
    account.config.social.tapInAssignments
      .filter((assignment) => assignment.brandId === brandId)
      .map((assignment) => ({ accountId: account.id, role: assignment.role }))
  );
  const assignedOpeningIds = assigned
    .filter((assignment) => assignment.role === "opening" || assignment.role === "both")
    .map((assignment) => assignment.accountId);
  const assignedReplyIds = assigned
    .filter((assignment) => assignment.role === "reply" || assignment.role === "both")
    .map((assignment) => assignment.accountId);
  const hasAssignments = assigned.length > 0;
  const campaignType: "comment" | "thread" = hasAssignments && assignedReplyIds.length === 0 ? "comment" : "thread";
  const openingAccountIds = assignedOpeningIds.length
    ? assignedOpeningIds
    : [String(process.env.TAPIN_SOCIAL_OPENING_ACCOUNT_ID ?? "").trim()].filter(Boolean);
  const replyAccountIds = campaignType === "comment"
    ? []
    : assignedReplyIds.length
      ? assignedReplyIds
      : [String(process.env.TAPIN_SOCIAL_REPLY_ACCOUNT_ID ?? "").trim()].filter(Boolean);
  const accountIds = new Set(accounts.map((account) => account.id));
  const usableOpeningIds = Array.from(new Set(openingAccountIds.filter((accountId) => accountIds.has(accountId))));
  const usableReplyIds = Array.from(new Set(replyAccountIds.filter((accountId) => accountIds.has(accountId))));
  const ready = campaignType === "comment"
    ? usableOpeningIds.length > 0
    : usableOpeningIds.some((openingId) => usableReplyIds.some((replyId) => replyId !== openingId));
  return { ready, campaignType, openingAccountIds: usableOpeningIds, replyAccountIds: usableReplyIds };
}

export async function getTapInRunnerBrandState(brandId: string) {
  const config = tapInRunnerConfig();
  const brandIds = await activeTapInRunnerBrandIds();
  const allowed = brandIds.includes(brandId);
  const roles = allowed ? await resolveTapInAccountRoles(brandId) : {
    ready: false,
    campaignType: "thread" as const,
    openingAccountIds: [],
    replyAccountIds: [],
  };
  return {
    enabled: config.enabled,
    dryRun: config.dryRun,
    configured: brandIds.length > 0,
    allowed,
    rolesReady: roles.ready,
    live: config.enabled && !config.dryRun && brandIds.length > 0 && allowed && roles.ready,
  };
}

export async function runTapInYouTubeRefill() {
  const config = tapInRunnerConfig();
  const brandIds = await activeTapInRunnerBrandIds();
  if (!config.enabled || !brandIds.length) {
    return { ok: true, skipped: true, reason: !config.enabled ? "runner_disabled" : "brand_allowlist_missing" };
  }
  return runSocialDiscoveryYouTubeRefillTick({
    brandIds,
    scanAllBrands: false,
    brandLimit: brandIds.length,
    maxQueries: envNumber("TAPIN_SOCIAL_REFILL_MAX_QUERIES", 4, 1, 8),
    limitPerQuery: envNumber("TAPIN_SOCIAL_REFILL_LIMIT_PER_QUERY", 5, 1, 25),
  });
}

export async function runTapInDispatch(input: { forceDryRun?: boolean } = {}) {
  const config = tapInRunnerConfig();
  const brandIds = await activeTapInRunnerBrandIds();
  const dryRun = config.dryRun || input.forceDryRun === true;
  if (!config.enabled || !brandIds.length) {
    return {
      ok: true,
      skipped: true,
      reason: !config.enabled ? "runner_disabled" : "brand_allowlist_missing",
      dryRun,
      brands: [],
      delayedReplies: null,
    };
  }

  const brands = [];
  for (const brandId of brandIds) {
    const roles = await resolveTapInAccountRoles(brandId);
    if (!roles.ready) {
      brands.push({ brandId, skipped: true, reason: "account_roles_missing" });
      continue;
    }
    const dispatch = await runSocialDiscoveryAutoCommentDispatchTick({
      enabled: true,
      brandIds: [brandId],
      scanAllBrands: false,
      dryRun,
      hourlyCap: envNumber("TAPIN_SOCIAL_HOURLY_CAP", 1, 1, 10),
      perRunCap: envNumber("TAPIN_SOCIAL_PER_RUN_CAP", 1, 1, 5),
      perAccountHourlyCap: envNumber("TAPIN_SOCIAL_PER_ACCOUNT_HOURLY_CAP", 1, 1, 10),
      accountRoles: {
        campaignType: roles.campaignType,
        openingAccountIds: roles.openingAccountIds,
        replyAccountIds: roles.replyAccountIds,
      },
    });
    brands.push({ brandId, skipped: false, dispatch });
  }
  const delayedReplies = await runSocialDiscoveryDelayedReplyTick({
    brandIds,
    limit: 25,
    dryRun,
  });
  return { ok: true, skipped: false, dryRun, brands, delayedReplies };
}

export async function runAndRecordTapInTask<T>(input: {
  name: string;
  route: string;
  task: () => Promise<T>;
}) {
  const result = await runCronTask(input.name, input.task, { timeoutMs: 55_000 });
  await recordInternalCronRun({
    taskName: result.name,
    route: input.route,
    ok: result.ok,
    durationMs: result.durationMs,
    details: result.ok ? result.value : null,
    error: result.ok ? "" : result.error,
  });
  return result;
}
