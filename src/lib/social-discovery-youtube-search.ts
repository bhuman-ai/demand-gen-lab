import { createId, type BrandRecord } from "@/lib/factory-data";
import type { OutreachAccountSecrets } from "@/lib/outreach-data";
import type { SocialDiscoveryPost } from "@/lib/social-discovery-types";
import { searchYouTubeVideos } from "@/lib/youtube";

export const MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS = 1000;

export type YouTubeDiscoveryError = {
  platform: "youtube";
  query: string;
  message: string;
};

function compactText(value: unknown, maxLength: number) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function socialDiscoveryLookbackHours() {
  return Math.max(1, Math.min(168, Number(process.env.SOCIAL_DISCOVERY_MAX_POST_AGE_HOURS ?? 24) || 24));
}

function isoHoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function buildYouTubeDiscoveryPost(input: {
  brandId: string;
  query: string;
  index: number;
  result: Awaited<ReturnType<typeof searchYouTubeVideos>>[number];
}): SocialDiscoveryPost {
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
        subscriberGate:
          result.subscriberCount > MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS ? "meets_1k_gate" : "below_1k_gate",
        source: "youtube-data-api",
        raw: result.raw,
      },
    },
    postedAt: result.publishedAt || now,
    discoveredAt: now,
    updatedAt: now,
  };
}

export async function discoverYouTubeSearchPostsForBrand(input: {
  brand: Pick<BrandRecord, "id">;
  queries: string[];
  maxResults?: number;
  secrets?: Pick<OutreachAccountSecrets, "youtubeClientId" | "youtubeClientSecret" | "youtubeRefreshToken">;
}) {
  const queries = input.queries
    .map((query) => String(query ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const maxResults = Math.max(1, Math.min(25, Number(input.maxResults ?? 12) || 12));
  const publishedAfter = isoHoursAgo(socialDiscoveryLookbackHours());
  const posts: SocialDiscoveryPost[] = [];
  const errors: YouTubeDiscoveryError[] = [];
  let found = 0;
  let eligible = 0;

  for (const query of queries) {
    try {
      const results = await searchYouTubeVideos({
        query,
        maxResults,
        order: "date",
        publishedAfter,
        secrets: input.secrets,
      });
      found += results.length;
      const eligibleResults = results.filter((result) => result.subscriberCount > MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS);
      eligible += eligibleResults.length;
      posts.push(
        ...eligibleResults.map((result, index) =>
          buildYouTubeDiscoveryPost({
            brandId: input.brand.id,
            query,
            index,
            result,
          })
        )
      );
    } catch (error) {
      errors.push({
        platform: "youtube",
        query,
        message: error instanceof Error ? error.message : "YouTube search failed",
      });
    }
  }

  return {
    provider: "youtube-data-api" as const,
    platforms: ["youtube"] as const,
    queries,
    posts,
    errors,
    summary: {
      found,
      eligible,
      minSubscriberCount: MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS,
    },
  };
}
