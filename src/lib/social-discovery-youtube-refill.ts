import { getOutreachAccountSecrets, listSocialRoutingAccounts } from "@/lib/outreach-data";
import { createSocialDiscoveryRun, saveSocialDiscoveryPosts } from "@/lib/social-discovery-data";
import {
  envFlag,
  envNumber,
  resolveYouTubeDiscoveryReadyBrands,
  resolveYouTubeSearchStrategyForBrand,
  selectYouTubeSearchQueriesForRun,
  splitSocialDiscoveryCsv,
} from "@/lib/social-discovery-search-strategy";
import { discoverYouTubeSearchPostsForBrand } from "@/lib/social-discovery-youtube-search";
import { hasYouTubeDataApiKey, hasYouTubeOAuthCredentials } from "@/lib/youtube";
import type { SocialDiscoveryPost } from "@/lib/social-discovery-types";
import type { SocialDiscoverySearchStrategyQuery } from "@/lib/factory-types";

type YouTubeRefillOptions = {
  brandIds?: string[];
  scanAllBrands?: boolean;
  brandLimit?: number;
  maxQueries?: number;
  limitPerQuery?: number;
};

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function resolveYouTubeSearchSecrets() {
  const accounts = (await listSocialRoutingAccounts()).filter(
    (account) =>
      account.status === "active" &&
      account.config.social.enabled &&
      account.config.social.connectionProvider === "youtube" &&
      account.config.social.platforms.includes("youtube")
  );

  for (const account of accounts) {
    const secrets = await getOutreachAccountSecrets(account.id).catch(() => null);
    if (secrets && hasYouTubeOAuthCredentials(secrets)) {
      return { accountId: account.id, secrets };
    }
  }

  return null;
}

function topPostSummaries(posts: SocialDiscoveryPost[]) {
  return posts
    .slice(0, 5)
    .map((post) => ({
      id: post.id,
      title: post.title,
      url: post.url,
      query: post.query,
      postedAt: post.postedAt,
      subscriberCount: Number(
        ((post.raw.youtube as Record<string, unknown> | undefined)?.subscriberCount ?? 0)
      ) || 0,
    }));
}

function queryFamilyCounts(queries: SocialDiscoverySearchStrategyQuery[]) {
  return queries.reduce<Record<string, number>>((counts, query) => {
    counts[query.family] = (counts[query.family] ?? 0) + 1;
    return counts;
  }, {});
}

function countSavedPostsByQuery(posts: SocialDiscoveryPost[]) {
  const counts = new Map<string, number>();
  for (const post of posts) {
    const query = post.query.trim().toLowerCase();
    if (!query) continue;
    counts.set(query, (counts.get(query) ?? 0) + 1);
  }
  return counts;
}

function queryRunDiagnostics(input: {
  queryPlan: SocialDiscoverySearchStrategyQuery[];
  discovery: Awaited<ReturnType<typeof discoverYouTubeSearchPostsForBrand>>;
  savedPosts: SocialDiscoveryPost[];
}) {
  const byQuery = new Map(input.queryPlan.map((query) => [query.query.toLowerCase(), query]));
  const savedByQuery = countSavedPostsByQuery(input.savedPosts);
  return input.discovery.queryStats.map((stats) => {
    const strategy = byQuery.get(stats.query.toLowerCase());
    return {
      query: stats.query,
      family: strategy?.family ?? "",
      source: strategy?.source ?? "",
      found: stats.found,
      eligible: stats.eligible,
      accepted: stats.accepted,
      saved: savedByQuery.get(stats.query.toLowerCase()) ?? 0,
      rejectedSubscriberGate: stats.rejectedSubscriberGate,
      rejectedTargetGrade: stats.rejectedTargetGrade,
      ...(stats.error ? { error: stats.error } : {}),
    };
  });
}

function annotatePostsWithQueryStrategy(input: {
  posts: SocialDiscoveryPost[];
  queries: SocialDiscoverySearchStrategyQuery[];
  strategyGeneratedAt: string;
}) {
  const byQuery = new Map(input.queries.map((query) => [query.query.toLowerCase(), query]));
  return input.posts.map((post) => {
    const strategyQuery = byQuery.get(post.query.toLowerCase());
    if (!strategyQuery) return post;
    return {
      ...post,
      raw: {
        ...post.raw,
        searchStrategy: {
          family: strategyQuery.family,
          source: strategyQuery.source,
          weight: strategyQuery.weight,
          rationale: strategyQuery.rationale,
          generatedAt: input.strategyGeneratedAt,
        },
      },
    };
  });
}

export async function runSocialDiscoveryYouTubeRefillTick(options: YouTubeRefillOptions = {}) {
  const configuredBrandIds = uniqueStrings([
    ...splitSocialDiscoveryCsv(process.env.SOCIAL_DISCOVERY_YOUTUBE_REFILL_BRAND_IDS),
    ...splitSocialDiscoveryCsv(process.env.SOCIAL_DISCOVERY_AUTO_COMMENT_BRAND_IDS),
  ]);
  const brandResolution = await resolveYouTubeDiscoveryReadyBrands({
    explicitBrandIds: options.brandIds,
    configuredBrandIds,
    scanAllBrands: options.scanAllBrands ?? envFlag("SOCIAL_DISCOVERY_YOUTUBE_REFILL_SCAN_ALL_BRANDS", false),
    scanAllReadyBrands: envFlag("SOCIAL_DISCOVERY_YOUTUBE_REFILL_SCAN_ALL_READY_BRANDS", false),
    brandLimit: options.brandLimit ?? process.env.SOCIAL_DISCOVERY_YOUTUBE_REFILL_BRAND_LIMIT,
    rotationBucketMinutes: 60,
  });
  const explicitBrandIds = uniqueStrings(options.brandIds ?? []);
  const requireAutoCommentEnabled = !explicitBrandIds.length && !options.scanAllBrands;
  const skippedAutoCommentDisabled: Array<{ brandId: string; brandName: string; reason: string }> = [];
  const brands = brandResolution.brands.filter((brand) => {
    if (!requireAutoCommentEnabled || brand.socialDiscoveryYouTubeAutoCommentEnabled) return true;
    skippedAutoCommentDisabled.push({
      brandId: brand.id,
      brandName: brand.name,
      reason: "youtube_auto_comment_disabled",
    });
    return false;
  });
  const maxQueries = envNumber(
    options.maxQueries ?? process.env.SOCIAL_DISCOVERY_YOUTUBE_REFILL_MAX_QUERIES,
    4,
    1,
    8
  );
  const strategyMaxQueries = envNumber(
    process.env.SOCIAL_DISCOVERY_YOUTUBE_REFILL_STRATEGY_QUERIES,
    Math.max(20, maxQueries),
    maxQueries,
    40
  );
  const limitPerQuery = envNumber(
    options.limitPerQuery ?? process.env.SOCIAL_DISCOVERY_YOUTUBE_REFILL_LIMIT_PER_QUERY,
    5,
    1,
    25
  );
  const useApiKeySearch = hasYouTubeDataApiKey();
  const youtubeSearchCredentials = useApiKeySearch ? null : await resolveYouTubeSearchSecrets();
  const results = [];

  for (const brand of brands) {
    const startedAt = new Date().toISOString();
    const strategyResult = await resolveYouTubeSearchStrategyForBrand({
      brand,
      maxQueries: strategyMaxQueries,
      persist: true,
    });
    const queryPlan = selectYouTubeSearchQueriesForRun({
      strategy: strategyResult.strategy,
      maxQueries,
      rotationBucketMinutes: 60,
    });
    const queries = uniqueStrings(queryPlan.map((query) => query.query));
    if (!queries.length) {
      results.push({
        brandId: brand.id,
        brandName: brand.name,
        skipped: true,
        reason: "no_strategy_queries",
        savedSearches: 0,
        generatedStrategy: strategyResult.generated,
        persistedStrategy: strategyResult.persisted,
        found: 0,
        eligible: 0,
        accepted: 0,
        saved: 0,
        errors: 0,
        queryDiagnostics: [],
      });
      continue;
    }

    const discovery = await discoverYouTubeSearchPostsForBrand({
      brand,
      queries,
      maxResults: limitPerQuery,
      secrets: youtubeSearchCredentials?.secrets,
      preferApiKey: true,
    });
    const strategyPosts = annotatePostsWithQueryStrategy({
      posts: discovery.posts,
      queries: queryPlan,
      strategyGeneratedAt: strategyResult.strategy.generatedAt,
    });
    const savedPosts = strategyPosts.length ? await saveSocialDiscoveryPosts(strategyPosts) : [];
    const queryDiagnostics = queryRunDiagnostics({
      queryPlan,
      discovery,
      savedPosts,
    });
    const run = await createSocialDiscoveryRun({
      brandId: brand.id,
      provider: discovery.provider,
      platforms: ["youtube"],
      queries: discovery.queries,
      postIds: savedPosts.map((post) => post.id),
      errorCount: discovery.errors.length,
      errors: discovery.errors,
      startedAt,
      finishedAt: new Date().toISOString(),
    });

    results.push({
      brandId: brand.id,
      brandName: brand.name,
      runId: run.id,
      savedSearches: queries.length,
      generatedStrategy: strategyResult.generated,
      persistedStrategy: strategyResult.persisted,
      strategySource: strategyResult.strategy.source,
      queryFamilies: queryFamilyCounts(queryPlan),
      found: discovery.summary.found,
      eligible: discovery.summary.eligible,
      accepted: discovery.summary.accepted,
      saved: savedPosts.length,
      errors: discovery.errors.length,
      queryDiagnostics,
      youtubeSearchAccountId: youtubeSearchCredentials?.accountId ?? "",
      youtubeSearchAuthMode: useApiKeySearch ? "api_key" : youtubeSearchCredentials?.accountId ? "oauth" : "none",
      topPosts: topPostSummaries(savedPosts),
    });
  }

  return {
    ok: true,
    scannedBrands: brands.length,
    configuredBrandIds: brandResolution.configuredBrandIds,
    scannedAllReadyBrands: brandResolution.scannedAllReadyBrands,
    skippedReadyCheck: brandResolution.skippedBrands.slice(0, 10),
    skippedAutoCommentDisabled,
    strategyMaxQueries,
    maxQueries,
    limitPerQuery,
    results,
  };
}
