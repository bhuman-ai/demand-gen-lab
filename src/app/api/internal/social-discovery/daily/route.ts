import { NextResponse } from "next/server";
import { getBrandById, listBrands, type BrandRecord } from "@/lib/factory-data";
import { discoverSocialPostsForBrand, parseSocialDiscoveryPlatforms } from "@/lib/social-discovery";
import { createSocialDiscoveryRun, saveSocialDiscoveryPosts } from "@/lib/social-discovery-data";
import type { SocialDiscoveryProvider } from "@/lib/social-discovery-types";

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

function normalizeProvider(value: unknown): SocialDiscoveryProvider | "auto" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "exa" || normalized === "dataforseo") return normalized;
  return "auto";
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
  const platforms = parseSocialDiscoveryPlatforms(
    body.platforms ?? url.searchParams.get("platforms") ?? process.env.SOCIAL_DISCOVERY_PLATFORMS
  );
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
    const startedAt = new Date().toISOString();
    const discovery = await discoverSocialPostsForBrand({
      brand,
      provider,
      platforms,
      extraTerms,
      subreddits,
      limitPerQuery,
      maxQueries,
    });
    const savedPosts = await saveSocialDiscoveryPosts(discovery.posts);
    const run = await createSocialDiscoveryRun({
      brandId: brand.id,
      provider: discovery.provider,
      platforms: discovery.platforms,
      queries: discovery.queries,
      postIds: savedPosts.map((post) => post.id),
      errorCount: discovery.errors.length,
      errors: discovery.errors,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    const topPosts = savedPosts
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

    results.push({
      brandId: brand.id,
      brandName: brand.name,
      runId: run.id,
      provider: discovery.provider,
      platforms: discovery.platforms,
      queries: discovery.queries.length,
      found: discovery.posts.length,
      saved: savedPosts.length,
      errors: discovery.errors.length,
      topPosts,
    });
  }

  return NextResponse.json({
    ok: true,
    brandsScanned: results.length,
    provider,
    platforms,
    results,
  });
}

export async function GET(request: Request) {
  return handleDailySocialDiscovery(request);
}

export async function POST(request: Request) {
  return handleDailySocialDiscovery(request);
}
