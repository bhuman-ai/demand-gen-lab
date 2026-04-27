import { getBrandById, listBrands, type BrandRecord } from "@/lib/factory-data";
import { getOutreachAccountSecrets, listSocialRoutingAccounts } from "@/lib/outreach-data";
import { createSocialDiscoveryRun, saveSocialDiscoveryPosts } from "@/lib/social-discovery-data";
import { discoverYouTubeSearchPostsForBrand } from "@/lib/social-discovery-youtube-search";
import { hasYouTubeOAuthCredentials } from "@/lib/youtube";
import type { SocialDiscoveryPost } from "@/lib/social-discovery-types";

type YouTubeRefillOptions = {
  brandIds?: string[];
  scanAllBrands?: boolean;
  brandLimit?: number;
  maxQueries?: number;
  limitPerQuery?: number;
};

function splitCsv(value: unknown) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return raw
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function numberOption(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}

function boolEnv(name: string, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function savedQueriesForBrand(brand: BrandRecord, maxQueries: number) {
  return uniqueStrings(
    splitCsv(brand.socialDiscoveryQueries).map((query) => query.replace(/\s+/g, " "))
  ).slice(0, maxQueries);
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

async function resolveBrands(input: YouTubeRefillOptions) {
  const configuredBrandIds = input.brandIds?.length
    ? input.brandIds
    : uniqueStrings([
        ...splitCsv(process.env.SOCIAL_DISCOVERY_YOUTUBE_REFILL_BRAND_IDS),
        ...splitCsv(process.env.SOCIAL_DISCOVERY_AUTO_COMMENT_BRAND_IDS),
      ]);
  const limit = numberOption(
    input.brandLimit ?? process.env.SOCIAL_DISCOVERY_YOUTUBE_REFILL_BRAND_LIMIT,
    5,
    1,
    50
  );

  if (configuredBrandIds.length) {
    const brands = await Promise.all(configuredBrandIds.map((brandId) => getBrandById(brandId)));
    return brands.filter((brand): brand is BrandRecord => Boolean(brand)).slice(0, limit);
  }

  const scanAllBrands =
    input.scanAllBrands ?? boolEnv("SOCIAL_DISCOVERY_YOUTUBE_REFILL_SCAN_ALL_BRANDS", false);
  if (!scanAllBrands) return [];
  return (await listBrands())
    .filter((brand) => brand.socialDiscoveryPlatforms.includes("youtube"))
    .slice(0, limit);
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

export async function runSocialDiscoveryYouTubeRefillTick(options: YouTubeRefillOptions = {}) {
  const brands = await resolveBrands(options);
  const maxQueries = numberOption(
    options.maxQueries ?? process.env.SOCIAL_DISCOVERY_YOUTUBE_REFILL_MAX_QUERIES ?? process.env.SOCIAL_DISCOVERY_MAX_QUERIES,
    20,
    1,
    40
  );
  const limitPerQuery = numberOption(
    options.limitPerQuery ?? process.env.SOCIAL_DISCOVERY_YOUTUBE_REFILL_LIMIT_PER_QUERY,
    5,
    1,
    25
  );
  const youtubeSearchCredentials = await resolveYouTubeSearchSecrets();
  const results = [];

  for (const brand of brands) {
    const startedAt = new Date().toISOString();
    const queries = savedQueriesForBrand(brand, maxQueries);
    if (!queries.length) {
      results.push({
        brandId: brand.id,
        brandName: brand.name,
        skipped: true,
        reason: "no_saved_queries",
        savedSearches: 0,
        found: 0,
        eligible: 0,
        saved: 0,
        errors: 0,
      });
      continue;
    }

    const discovery = await discoverYouTubeSearchPostsForBrand({
      brand,
      queries,
      maxResults: limitPerQuery,
      secrets: youtubeSearchCredentials?.secrets,
    });
    const savedPosts = discovery.posts.length ? await saveSocialDiscoveryPosts(discovery.posts) : [];
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
      found: discovery.summary.found,
      eligible: discovery.summary.eligible,
      saved: savedPosts.length,
      errors: discovery.errors.length,
      youtubeSearchAccountId: youtubeSearchCredentials?.accountId ?? "",
      topPosts: topPostSummaries(savedPosts),
    });
  }

  return {
    ok: true,
    scannedBrands: brands.length,
    maxQueries,
    limitPerQuery,
    results,
  };
}
