import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { enrichSocialPostsWithAccountRouting } from "@/lib/social-account-routing";
import { saveSocialDiscoveryPosts } from "@/lib/social-discovery-data";
import { getOutreachAccountSecrets } from "@/lib/outreach-data";
import {
  discoverYouTubeSearchPostsForBrand,
  MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS,
} from "@/lib/social-discovery-youtube-search";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const query = String(body.query ?? "").trim();
    const accountId = String(body.accountId ?? body.account_id ?? "").trim();
    const maxResults = Math.max(1, Math.min(20, Number(body.maxResults ?? body.max_results ?? 12) || 12));

    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const secrets = accountId ? await getOutreachAccountSecrets(accountId) : null;
    const discovery = await discoverYouTubeSearchPostsForBrand({
      brand,
      queries: [query],
      maxResults,
      secrets: secrets ?? undefined,
    });
    if (discovery.errors.length && !discovery.posts.length) {
      throw new Error(discovery.errors[0]?.message || "Failed to search YouTube");
    }
    const savedPosts = discovery.posts.length ? await saveSocialDiscoveryPosts(discovery.posts) : [];
    const posts = await enrichSocialPostsWithAccountRouting({
      brand,
      posts: savedPosts,
    });

    return NextResponse.json({
      ok: true,
      query,
      brand: {
        id: brand.id,
        name: brand.name,
      },
      posts,
      summary: {
        found: discovery.summary.found,
        eligible: discovery.summary.eligible,
        saved: posts.length,
        minSubscriberCount: MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS,
        provider: discovery.provider,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to search YouTube",
      },
      { status: 500 }
    );
  }
}
