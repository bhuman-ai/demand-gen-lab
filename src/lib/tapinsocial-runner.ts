import { recordInternalCronRun, runCronTask } from "@/lib/internal-cron";
import { listSocialRoutingAccounts } from "@/lib/outreach-data";
import { runSocialDiscoveryAutoCommentDispatchTick } from "@/lib/social-discovery-comment-dispatch";
import { runSocialDiscoveryDelayedReplyTick } from "@/lib/social-discovery-comment-delivery";
import { splitSocialDiscoveryCsv } from "@/lib/social-discovery-search-strategy";
import { runSocialDiscoveryYouTubeRefillTick } from "@/lib/social-discovery-youtube-refill";

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
  const openingAccountId =
    assigned.find((assignment) => assignment.role === "opening")?.accountId ??
    String(process.env.TAPIN_SOCIAL_OPENING_ACCOUNT_ID ?? "").trim();
  const replyAccountId =
    assigned.find((assignment) => assignment.role === "reply")?.accountId ??
    String(process.env.TAPIN_SOCIAL_REPLY_ACCOUNT_ID ?? "").trim();
  const accountIds = new Set(accounts.map((account) => account.id));
  const ready = Boolean(
    openingAccountId &&
      replyAccountId &&
      openingAccountId !== replyAccountId &&
      accountIds.has(openingAccountId) &&
      accountIds.has(replyAccountId)
  );
  return { ready, openingAccountId, replyAccountId };
}

export async function getTapInRunnerBrandState(brandId: string) {
  const config = tapInRunnerConfig();
  const allowed = config.brandIds.includes(brandId);
  const roles = allowed ? await resolveTapInAccountRoles(brandId) : {
    ready: false,
    openingAccountId: "",
    replyAccountId: "",
  };
  return {
    enabled: config.enabled,
    dryRun: config.dryRun,
    configured: config.configured,
    allowed,
    rolesReady: roles.ready,
    live: config.enabled && !config.dryRun && config.configured && allowed && roles.ready,
  };
}

export async function runTapInYouTubeRefill() {
  const config = tapInRunnerConfig();
  if (!config.enabled || !config.configured) {
    return { ok: true, skipped: true, reason: !config.enabled ? "runner_disabled" : "brand_allowlist_missing" };
  }
  return runSocialDiscoveryYouTubeRefillTick({
    brandIds: config.brandIds,
    scanAllBrands: false,
    brandLimit: config.brandIds.length,
    maxQueries: envNumber("TAPIN_SOCIAL_REFILL_MAX_QUERIES", 4, 1, 8),
    limitPerQuery: envNumber("TAPIN_SOCIAL_REFILL_LIMIT_PER_QUERY", 5, 1, 25),
  });
}

export async function runTapInDispatch(input: { forceDryRun?: boolean } = {}) {
  const config = tapInRunnerConfig();
  const dryRun = config.dryRun || input.forceDryRun === true;
  if (!config.enabled || !config.configured) {
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
  for (const brandId of config.brandIds) {
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
        openingAccountId: roles.openingAccountId,
        replyAccountId: roles.replyAccountId,
      },
    });
    brands.push({ brandId, skipped: false, dispatch });
  }
  const delayedReplies = await runSocialDiscoveryDelayedReplyTick({
    brandIds: config.brandIds,
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
