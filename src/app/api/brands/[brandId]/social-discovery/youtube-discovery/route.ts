import { NextResponse } from "next/server";
import { createId, getBrandById } from "@/lib/factory-data";
import { enrichSocialPostsWithAccountRouting } from "@/lib/social-account-routing";
import { saveSocialDiscoveryPosts } from "@/lib/social-discovery-data";
import type { SocialDiscoveryPost } from "@/lib/social-discovery-types";
import { getOutreachAccountSecrets } from "@/lib/outreach-data";
import { searchYouTubeVideos, YouTubeApiError } from "@/lib/youtube";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function compactText(value: unknown, maxLength: number) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function socialDiscoveryLookbackHours() {
  return Math.max(1, Math.min(168, Number(process.env.SOCIAL_DISCOVERY_MAX_POST_AGE_HOURS ?? 24) || 24));
}

function isoHoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

const MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS = 1000;

function buildYouTubeDiscoveryPost(input: {
  brandId: string;
  query: string;
  index: number;
  result: Awaited<ReturnType<typeof searchYouTubeVideos>>[number];
}) : SocialDiscoveryPost {
  const { result } = input;
  const now = new Date().toISOString();
  return {
    id: createId("socialpost"),
    brandId: input.brandId,
    platform: "youtube",
    provider: "youtube-data-api",
    externalId: result.videoId,
    url: result.url,
    title: compactText(result.title, 500),
    body: compactText(result.description, 1200),
    author: result.channelTitle,
    community: result.channelTitle,
    query: input.query,
    matchedTerms: [],
    intent: "noise",
    relevanceScore: 0,
    risingScore: 0,
    engagementScore: Math.max(
      0,
      result.videoViewCount + result.videoCommentCount * 4 + result.videoLikeCount * 2
    ),
    providerRank: input.index + 1,
    status: "new",
    interactionPlan: {
      headline: "Draft a comment for this video",
      targetStrength: "target",
      commentPosture: "method_first",
      mentionPolicy: "mention_only_if_asked",
      actors: [
        {
          role: "operator",
          job: "Write one short native YouTube comment after review.",
        },
      ],
      sequence: [],
      assetNeeded: "none",
      riskNotes: [],
    },
    raw: {
      youtube: {
        searchQuery: input.query,
        videoId: result.videoId,
        videoUrl: result.url,
        videoTitle: result.title,
        videoDescription: result.description,
        publishedAt: result.publishedAt,
        videoViewCount: result.videoViewCount,
        videoCommentCount: result.videoCommentCount,
        videoLikeCount: result.videoLikeCount,
        channelId: result.channelId,
        channelTitle: result.channelTitle,
        channelCustomUrl: result.channelCustomUrl,
        channelThumbnailUrl: result.channelThumbnailUrl,
        thumbnailUrl: result.thumbnailUrl,
        subscriberCount: result.subscriberCount,
        subscriberGate: result.subscriberCount >= 50_000 ? "meets_50k_gate" : "below_50k_gate",
        source: "youtube-data-api",
        raw: result.raw,
      },
    },
    postedAt: result.publishedAt || now,
    discoveredAt: now,
    updatedAt: now,
  };
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
    const results = await searchYouTubeVideos({
      query,
      maxResults,
      order: "date",
      publishedAfter: isoHoursAgo(socialDiscoveryLookbackHours()),
      secrets: secrets ?? undefined,
    });

    const eligibleResults = results.filter((result) => result.subscriberCount > MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS);
    const rawPosts = eligibleResults.map((result, index) =>
      buildYouTubeDiscoveryPost({
        brandId,
        query,
        index,
        result,
      })
    );
    const savedPosts = rawPosts.length ? await saveSocialDiscoveryPosts(rawPosts) : [];
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
        found: results.length,
        eligible: eligibleResults.length,
        saved: posts.length,
        minSubscriberCount: MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS,
        provider: "youtube-data-api",
      },
    });
  } catch (error) {
    if (error instanceof YouTubeApiError) {
      return NextResponse.json(
        {
          error: error.message,
          type: error.type,
          details: error.details,
        },
        { status: error.status || 500 }
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to search YouTube",
      },
      { status: 500 }
    );
  }
}
