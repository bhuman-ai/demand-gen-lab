import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import {
  discoverSocialPostsForBrand,
  parseSocialDiscoveryPlatforms,
} from "@/lib/social-discovery";
import {
  createSocialDiscoveryRun,
  listSocialDiscoveryPosts,
  listSocialDiscoveryRuns,
  saveSocialDiscoveryPosts,
  updateSocialDiscoveryPostStatus,
} from "@/lib/social-discovery-data";
import type {
  SocialDiscoveryPlatform,
  SocialDiscoveryProvider,
  SocialDiscoveryStatus,
} from "@/lib/social-discovery-types";

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
  return normalized === "reddit" || normalized === "instagram" ? normalized : undefined;
}

function normalizeProvider(value: unknown): SocialDiscoveryProvider | "auto" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "exa" || normalized === "dataforseo") return normalized;
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

  return NextResponse.json({ posts, runs });
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
    return NextResponse.json({ post });
  }

  if (action !== "scan") {
    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  }

  const startedAt = new Date().toISOString();
  const platforms = parseSocialDiscoveryPlatforms(body.platforms);
  const discovery = await discoverSocialPostsForBrand({
    brand,
    provider: normalizeProvider(body.provider),
    platforms,
    extraTerms: normalizeStringArray(body.extraTerms ?? body.terms),
    subreddits: normalizeStringArray(body.subreddits),
    limitPerQuery: Number(body.limitPerQuery ?? body.limit ?? 25) || 25,
    maxQueries: Number(body.maxQueries ?? 12) || 12,
  });
  const savedPosts = await saveSocialDiscoveryPosts(discovery.posts);
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
    run,
    posts: savedPosts,
    errors: discovery.errors,
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
