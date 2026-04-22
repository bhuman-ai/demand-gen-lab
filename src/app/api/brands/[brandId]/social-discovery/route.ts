import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import {
  brainstormSocialDiscoveryYouTubeQueries,
  discoverSocialPostsForBrand,
  parseSocialDiscoveryPlatforms,
} from "@/lib/social-discovery";
import {
  inferBrandSocialPlatforms,
  isSupportedDiscoveryPlatform,
  resolveSupportedDiscoveryPlatformsForBrand,
} from "@/lib/social-platform-catalog";
import {
  createSocialDiscoveryRun,
  listSocialDiscoveryPosts,
  listSocialDiscoveryRuns,
  saveSocialDiscoveryPosts,
  updateSocialDiscoveryPostStatus,
} from "@/lib/social-discovery-data";
import { enrichSocialPostsWithAccountRouting } from "@/lib/social-account-routing";
import type {
  SocialDiscoveryPlatform,
  SocialDiscoveryProvider,
  SocialDiscoveryStatus,
} from "@/lib/social-discovery-types";

function brandSummary(brand: Awaited<ReturnType<typeof getBrandById>>) {
  return brand
    ? {
        id: brand.id,
        name: brand.name,
        socialDiscoveryCommentPrompt: brand.socialDiscoveryCommentPrompt,
        socialDiscoveryPlatforms: brand.socialDiscoveryPlatforms,
        socialDiscoveryQueries: brand.socialDiscoveryQueries,
        recommendedSocialDiscoveryPlatforms: inferBrandSocialPlatforms(brand),
        recommendedSupportedDiscoveryPlatforms: resolveSupportedDiscoveryPlatformsForBrand(brand),
      }
    : null;
}

async function suggestedYouTubeQueries(brand: Awaited<ReturnType<typeof getBrandById>>) {
  if (!brand) return [];
  return brainstormSocialDiscoveryYouTubeQueries({
    brand,
    maxQueries: 12,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeStringArray(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return raw
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function normalizePlatform(value: unknown): SocialDiscoveryPlatform | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  return isSupportedDiscoveryPlatform(normalized) ? (normalized as SocialDiscoveryPlatform) : undefined;
}

function normalizeProvider(value: unknown): SocialDiscoveryProvider | "auto" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "exa" || normalized === "dataforseo" || normalized === "youtube-data-api" || normalized === "youtube-websub") {
    return normalized as SocialDiscoveryProvider;
  }
  return "auto";
}

function normalizeStatus(value: unknown): SocialDiscoveryStatus | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["new", "triaged", "saved", "dismissed"].includes(normalized)
    ? (normalized as SocialDiscoveryStatus)
    : undefined;
}

export async function GET(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(250, Number(searchParams.get("limit") ?? 50) || 50));
  const platform = normalizePlatform(searchParams.get("platform"));
  const status = normalizeStatus(searchParams.get("status"));
  const [posts, runs] = await Promise.all([
    listSocialDiscoveryPosts({ brandId, platform, status, limit }),
    listSocialDiscoveryRuns({ brandId, limit: 10 }),
  ]);
  const latestRun = runs[0] ?? null;
  const latestRunPostIds = new Set((latestRun?.postIds ?? []).filter(Boolean));
  const latestPosts = latestRun
    ? latestRunPostIds.size
      ? posts.filter((post) => latestRunPostIds.has(post.id))
      : []
    : posts;
  const routedPosts = await enrichSocialPostsWithAccountRouting({ brand, posts: latestPosts });
  const suggestedQueries = brand.socialDiscoveryQueries.length ? [] : await suggestedYouTubeQueries(brand);

  return NextResponse.json({
    brand: brandSummary(brand),
    posts: routedPosts,
    runs,
    savedQueries: brand.socialDiscoveryQueries,
    suggestedQueries,
  });
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const action = String(body.action ?? "scan").trim().toLowerCase();

  if (action === "status") {
    const id = String(body.id ?? "").trim();
    const status = normalizeStatus(body.status);
    if (!id || !status) {
      return NextResponse.json({ error: "id and status are required" }, { status: 400 });
    }
    const post = await updateSocialDiscoveryPostStatus({ id, brandId, status });
    if (!post) {
      return NextResponse.json({ error: "post not found" }, { status: 404 });
    }
    const [routedPost] = await enrichSocialPostsWithAccountRouting({ brand, posts: [post] });
    return NextResponse.json({ post: routedPost ?? null });
  }

  if (action !== "scan") {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }

  const startedAt = new Date().toISOString();
  const parsedPlatforms = body.platforms ? parseSocialDiscoveryPlatforms(body.platforms) : [];
  const platforms = parsedPlatforms.length ? parsedPlatforms : resolveSupportedDiscoveryPlatformsForBrand(brand);
  const discovery = await discoverSocialPostsForBrand({
    brand,
    provider: normalizeProvider(body.provider),
    platforms,
    queries: normalizeStringArray(body.queries),
    extraTerms: normalizeStringArray(body.extraTerms ?? body.terms),
    subreddits: normalizeStringArray(body.subreddits),
    limitPerQuery: Number(body.limitPerQuery ?? body.limit ?? 25) || 25,
    maxQueries: Number(body.maxQueries ?? 12) || 12,
  });
  const savedPosts = await saveSocialDiscoveryPosts(discovery.posts);
  const routedPosts = await enrichSocialPostsWithAccountRouting({ brand, posts: savedPosts });
  const suggestedQueries = brand.socialDiscoveryQueries.length ? [] : await suggestedYouTubeQueries(brand);
  const run = await createSocialDiscoveryRun({
    brandId,
    provider: discovery.provider,
    platforms: discovery.platforms,
    queries: discovery.queries,
    postIds: savedPosts.map((post) => post.id),
    errorCount: discovery.errors.length,
    errors: discovery.errors,
    startedAt,
    finishedAt: new Date().toISOString(),
  });

  return NextResponse.json({
    brand: brandSummary(brand),
    run,
    posts: routedPosts,
    errors: discovery.errors,
    savedQueries: brand.socialDiscoveryQueries,
    suggestedQueries,
    summary: {
      provider: discovery.provider,
      platforms: discovery.platforms,
      queries: discovery.queries.length,
      found: discovery.posts.length,
      saved: savedPosts.length,
      errors: discovery.errors.length,
    },
  });
}
