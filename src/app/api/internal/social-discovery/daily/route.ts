import { NextResponse } from "next/server";
import { getBrandById, listBrands, type BrandRecord } from "@/lib/factory-data";
import { getOutreachAccountSecrets, listSocialRoutingAccounts } from "@/lib/outreach-data";
import { discoverSocialPostsForBrand, parseSocialDiscoveryPlatforms } from "@/lib/social-discovery";
import { resolveSupportedDiscoveryPlatformsForBrand } from "@/lib/social-platform-catalog";
import { createSocialDiscoveryRun, saveSocialDiscoveryPosts } from "@/lib/social-discovery-data";
import { discoverYouTubeSearchPostsForBrand } from "@/lib/social-discovery-youtube-search";
import { hasYouTubeOAuthCredentials } from "@/lib/youtube";
import type {
  SocialDiscoveryPlatform,
  SocialDiscoveryPost,
  SocialDiscoveryProvider,
} from "@/lib/social-discovery-types";

function isAuthorized(request: Request) {
  const token =
    String(process.env.OUTREACH_CRON_TOKEN ?? "").trim() ||
    String(process.env.CRON_SECRET ?? "").trim();
  if (!token) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${token}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function splitCsv(value: unknown) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return raw
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function savedQueriesForBrand(brand: BrandRecord, maxQueries: number) {
  return uniqueStrings(splitCsv(brand.socialDiscoveryQueries).map((query) => query.replace(/\s+/g, " "))).slice(
    0,
    maxQueries
  );
}

function normalizeProvider(value: unknown): SocialDiscoveryProvider | "auto" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "exa" || normalized === "dataforseo" || normalized === "youtube-data-api" || normalized === "youtube-websub") {
    return normalized as SocialDiscoveryProvider;
  }
  return "auto";
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

function numberOption(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}

async function requestJson(request: Request) {
  if (request.method === "GET") return {};
  try {
    return asRecord(await request.json());
  } catch {
    return {};
  }
}

async function resolveBrands(input: { body: Record<string, unknown>; url: URL }) {
  const configuredBrandIds = splitCsv(
    input.body.brandIds ??
      input.body.brandId ??
      input.url.searchParams.get("brandIds") ??
      input.url.searchParams.get("brandId") ??
      process.env.SOCIAL_DISCOVERY_BRAND_IDS
  );
  const limit = numberOption(
    input.body.brandLimit ?? input.url.searchParams.get("brandLimit") ?? process.env.SOCIAL_DISCOVERY_DAILY_BRAND_LIMIT,
    5,
    1,
    50
  );

  if (configuredBrandIds.length) {
    const brands = await Promise.all(configuredBrandIds.map((brandId) => getBrandById(brandId)));
    return brands.filter((brand): brand is BrandRecord => Boolean(brand)).slice(0, limit);
  }

  if (String(process.env.SOCIAL_DISCOVERY_SCAN_ALL_BRANDS ?? "").trim().toLowerCase() !== "true") {
    return [];
  }

  return (await listBrands()).slice(0, limit);
}

function topPostSummaries(posts: SocialDiscoveryPost[]) {
  return posts
    .slice()
    .sort((left, right) => right.risingScore - left.risingScore)
    .slice(0, 5)
    .map((post) => ({
      id: post.id,
      platform: post.platform,
      provider: post.provider,
      risingScore: post.risingScore,
      relevanceScore: post.relevanceScore,
      intent: post.intent,
      title: post.title,
      url: post.url,
      interactionPlan: post.interactionPlan.headline,
      assetNeeded: post.interactionPlan.assetNeeded,
    }));
}

async function handleDailySocialDiscovery(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await requestJson(request);
  const url = new URL(request.url);
  const brands = await resolveBrands({ body, url });

  if (!brands.length) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Set SOCIAL_DISCOVERY_BRAND_IDS or SOCIAL_DISCOVERY_SCAN_ALL_BRANDS=true before enabling daily scans.",
    });
  }

  const provider = normalizeProvider(
    body.provider ?? url.searchParams.get("provider") ?? process.env.SOCIAL_DISCOVERY_PROVIDER
  );
  const platformInput =
    body.platforms ?? url.searchParams.get("platforms") ?? process.env.SOCIAL_DISCOVERY_PLATFORMS;
  const extraTerms = splitCsv(
    body.extraTerms ?? body.terms ?? url.searchParams.get("terms") ?? process.env.SOCIAL_DISCOVERY_EXTRA_TERMS
  );
  const subreddits = splitCsv(
    body.subreddits ?? url.searchParams.get("subreddits") ?? process.env.SOCIAL_DISCOVERY_SUBREDDITS
  );
  const limitPerQuery = numberOption(
    body.limitPerQuery ?? body.limit ?? url.searchParams.get("limit") ?? process.env.SOCIAL_DISCOVERY_LIMIT_PER_QUERY,
    15,
    1,
    100
  );
  const maxQueries = numberOption(
    body.maxQueries ?? url.searchParams.get("maxQueries") ?? process.env.SOCIAL_DISCOVERY_MAX_QUERIES,
    10,
    1,
    40
  );

  const results = [];
  for (const brand of brands) {
    const parsedPlatforms = platformInput ? parseSocialDiscoveryPlatforms(platformInput) : [];
    const configuredPlatforms = parsedPlatforms.length ? parsedPlatforms : resolveSupportedDiscoveryPlatformsForBrand(brand);
    const savedQueries = savedQueriesForBrand(brand, maxQueries);
    const platforms =
      savedQueries.length && !platformInput && !configuredPlatforms.includes("youtube")
        ? (["youtube", ...configuredPlatforms] as SocialDiscoveryPlatform[])
        : configuredPlatforms;
    const runSavedYouTubeSearches = savedQueries.length > 0 && platforms.includes("youtube");
    const genericPlatforms = platforms.filter(
      (platform) => !(runSavedYouTubeSearches && platform === "youtube")
    );
    const savedPosts: SocialDiscoveryPost[] = [];
    const errors: Array<{ platform: SocialDiscoveryPlatform; query: string; message: string }> = [];
    const runIds: string[] = [];
    const runProviders: SocialDiscoveryProvider[] = [];
    const runPlatforms = new Set<SocialDiscoveryPlatform>();
    const runQueries: string[] = [];
    let found = 0;
    let eligible = 0;
    let youtubeSearchAccountId = "";

    if (runSavedYouTubeSearches) {
      const startedAt = new Date().toISOString();
      const youtubeSearchCredentials = await resolveYouTubeSearchSecrets();
      youtubeSearchAccountId = youtubeSearchCredentials?.accountId ?? "";
      const youtubeDiscovery = await discoverYouTubeSearchPostsForBrand({
        brand,
        queries: savedQueries,
        maxResults: limitPerQuery,
        secrets: youtubeSearchCredentials?.secrets,
      });
      const nextSavedPosts = youtubeDiscovery.posts.length
        ? await saveSocialDiscoveryPosts(youtubeDiscovery.posts)
        : [];
      const run = await createSocialDiscoveryRun({
        brandId: brand.id,
        provider: youtubeDiscovery.provider,
        platforms: ["youtube"],
        queries: youtubeDiscovery.queries,
        postIds: nextSavedPosts.map((post) => post.id),
        errorCount: youtubeDiscovery.errors.length,
        errors: youtubeDiscovery.errors,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      savedPosts.push(...nextSavedPosts);
      errors.push(...youtubeDiscovery.errors);
      runIds.push(run.id);
      runProviders.push(youtubeDiscovery.provider);
      runPlatforms.add("youtube");
      runQueries.push(...youtubeDiscovery.queries);
      found += youtubeDiscovery.summary.found;
      eligible += youtubeDiscovery.summary.eligible;
    }

    if (genericPlatforms.length) {
      const startedAt = new Date().toISOString();
      const discovery = await discoverSocialPostsForBrand({
        brand,
        provider,
        platforms: genericPlatforms,
        queries: savedQueries.length ? savedQueries : undefined,
        extraTerms,
        subreddits,
        limitPerQuery,
        maxQueries,
      });
      const nextSavedPosts = discovery.posts.length ? await saveSocialDiscoveryPosts(discovery.posts) : [];
      const run = await createSocialDiscoveryRun({
        brandId: brand.id,
        provider: discovery.provider,
        platforms: discovery.platforms,
        queries: discovery.queries,
        postIds: nextSavedPosts.map((post) => post.id),
        errorCount: discovery.errors.length,
        errors: discovery.errors,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      savedPosts.push(...nextSavedPosts);
      errors.push(...discovery.errors);
      runIds.push(run.id);
      runProviders.push(discovery.provider);
      discovery.platforms.forEach((platform) => runPlatforms.add(platform));
      runQueries.push(...discovery.queries);
      found += discovery.posts.length;
    }
    const topPosts = topPostSummaries(savedPosts);

    results.push({
      brandId: brand.id,
      brandName: brand.name,
      runId: runIds[0] ?? "",
      runIds,
      provider: runProviders.length === 1 ? runProviders[0] : runProviders.length ? "mixed" : provider,
      platforms: Array.from(runPlatforms),
      queries: uniqueStrings(runQueries).length,
      savedSearches: savedQueries.length,
      found,
      eligible,
      saved: savedPosts.length,
      errors: errors.length,
      youtubeSearchAccountId,
      topPosts,
    });
  }

  return NextResponse.json({
    ok: true,
    brandsScanned: results.length,
    provider,
    platforms: platformInput ? parseSocialDiscoveryPlatforms(platformInput) : [],
    results,
  });
}

export async function GET(request: Request) {
  return handleDailySocialDiscovery(request);
}

export async function POST(request: Request) {
  return handleDailySocialDiscovery(request);
}
