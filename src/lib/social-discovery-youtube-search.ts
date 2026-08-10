import { createId, type BrandRecord } from "@/lib/factory-data";
import type { OutreachAccountSecrets } from "@/lib/outreach-data";
import {
  buildPreviewScoredSocialDiscoveryPost,
  buildScoredSocialDiscoveryPost,
} from "@/lib/social-discovery";
import type { SocialDiscoveryPost } from "@/lib/social-discovery-types";
import { meetsYouTubeSubscriberMinimum } from "@/lib/social-discovery-youtube-eligibility";
import { searchYouTubeVideos } from "@/lib/youtube";
import {
  DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY,
  normalizeSocialDiscoveryYouTubePolicy,
  type SocialDiscoveryYouTubePolicy,
} from "@/lib/social-discovery-youtube-policy";

export { MIN_YOUTUBE_DISCOVERY_SUBSCRIBERS } from "@/lib/social-discovery-youtube-eligibility";

export type YouTubeDiscoveryError = {
  platform: "youtube";
  query: string;
  message: string;
};

export type YouTubeDiscoveryQueryStats = {
  query: string;
  found: number;
  eligible: number;
  accepted: number;
  rejectedSubscriberGate: number;
  rejectedTargetGrade: number;
  error?: string;
};

function compactText(value: unknown, maxLength: number) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function socialDiscoveryLookbackHours() {
  return Math.max(1, Math.min(168, Number(process.env.SOCIAL_DISCOVERY_MAX_POST_AGE_HOURS ?? 24) || 24));
}

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return Math.max(min, Math.min(max, fallback));
  const parsed = Number(raw);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}

function isoHoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export function isEligibleYouTubeDiscoveryPost(
  post: SocialDiscoveryPost,
  policy?: SocialDiscoveryYouTubePolicy | null
) {
  const minRelevanceScore = policy?.minRelevanceScore ?? numberEnv("SOCIAL_DISCOVERY_YOUTUBE_REFILL_MIN_RELEVANCE_SCORE", 18, 0, 100);
  const minRisingScore = policy?.minRisingScore ?? numberEnv("SOCIAL_DISCOVERY_YOUTUBE_REFILL_MIN_RISING_SCORE", 30, 0, 100);
  const plan = post.interactionPlan;
  if (post.relevanceScore < minRelevanceScore) return false;
  if (post.risingScore < minRisingScore) return false;
  if (plan.targetStrength !== "target" && plan.targetStrength !== "watch") return false;
  if (plan.commentPosture === "no_comment" || plan.commentPosture === "watch_only") return false;
  return true;
}

export function isEligibleYouTubePreviewFallbackPost(post: SocialDiscoveryPost) {
  return post.interactionPlan.surfaceType !== "news_or_political";
}

export function isWithinYouTubeDiscoveryWindow(
  post: Pick<SocialDiscoveryPost, "postedAt">,
  maxVideoAgeHours: number,
  now = Date.now()
) {
  const publishedAt = Date.parse(String(post.postedAt ?? ""));
  if (!Number.isFinite(publishedAt)) return false;
  const ageLimitMs = Math.max(1, Number(maxVideoAgeHours) || 1) * 60 * 60 * 1000;
  return publishedAt >= now - ageLimitMs;
}

function buildYouTubeDiscoveryPost(input: {
  brand: BrandRecord;
  query: string;
  index: number;
  result: Awaited<ReturnType<typeof searchYouTubeVideos>>[number];
  policy: SocialDiscoveryYouTubePolicy;
  ignoreFreshness?: boolean;
}): SocialDiscoveryPost | null {
  const { result } = input;
  const now = new Date().toISOString();
  const buildPost = input.ignoreFreshness
    ? buildPreviewScoredSocialDiscoveryPost
    : buildScoredSocialDiscoveryPost;
  return buildPost({
    id: createId("socialpost"),
    brandId: input.brand.id,
    platform: "youtube",
    provider: "youtube-data-api",
    externalId: result.videoId,
    url: result.url,
    title: compactText(result.title, 500),
    body: compactText(result.description, 1200),
    author: result.channelTitle,
    community: result.channelTitle,
    query: input.query,
    engagementScore: Math.max(
      0,
      result.videoViewCount + result.videoCommentCount * 4 + result.videoLikeCount * 2
    ),
    providerRank: input.index + 1,
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
          meetsYouTubeSubscriberMinimum(result.subscriberCount, input.policy.minSubscriberCount)
            ? "meets_subscriber_gate"
            : "below_subscriber_gate",
        source: "youtube-data-api",
        raw: result.raw,
      },
    },
    postedAt: result.publishedAt || now,
    discoveredAt: now,
    updatedAt: now,
    brand: input.brand,
  });
}

export async function discoverYouTubeSearchPostsForBrand(input: {
  brand: BrandRecord;
  queries: string[];
  maxResults?: number;
  order?: "date" | "relevance" | "viewCount";
  secrets?: Pick<OutreachAccountSecrets, "youtubeClientId" | "youtubeClientSecret" | "youtubeRefreshToken">;
  preferApiKey?: boolean;
  policy?: SocialDiscoveryYouTubePolicy | null;
  includePolicyFallbackCandidates?: boolean;
}) {
  const queries = input.queries
    .map((query) => String(query ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const maxResults = Math.max(1, Math.min(25, Number(input.maxResults ?? 12) || 12));
  const policy = normalizeSocialDiscoveryYouTubePolicy(input.policy, {
    ...DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY,
    maxVideoAgeHours: socialDiscoveryLookbackHours(),
    minRelevanceScore: numberEnv("SOCIAL_DISCOVERY_YOUTUBE_REFILL_MIN_RELEVANCE_SCORE", 18, 0, 100),
    minRisingScore: numberEnv("SOCIAL_DISCOVERY_YOUTUBE_REFILL_MIN_RISING_SCORE", 30, 0, 100),
  }) ?? DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY;
  const includePolicyFallbackCandidates = input.includePolicyFallbackCandidates === true;
  const publishedAfter = includePolicyFallbackCandidates
    ? undefined
    : isoHoursAgo(policy.maxVideoAgeHours);
  const posts: SocialDiscoveryPost[] = [];
  const candidates: SocialDiscoveryPost[] = [];
  const errors: YouTubeDiscoveryError[] = [];
  const queryStats: YouTubeDiscoveryQueryStats[] = [];
  let found = 0;
  let eligible = 0;

  for (const query of queries) {
    try {
      const results = await searchYouTubeVideos({
        query,
        maxResults,
        order: input.order ?? "date",
        publishedAfter,
        secrets: input.secrets,
        preferApiKey: input.preferApiKey ?? true,
      });
      found += results.length;
      const builtEntries = results
        .map((result, index) => ({
          result,
          post: buildYouTubeDiscoveryPost({
            brand: input.brand,
            query,
            index,
            result,
            policy,
            ignoreFreshness: includePolicyFallbackCandidates,
          }),
        }))
        .filter((entry): entry is { result: (typeof results)[number]; post: SocialDiscoveryPost } =>
          Boolean(entry.post)
        );
      const eligiblePosts = builtEntries
        .filter(({ result }) =>
          meetsYouTubeSubscriberMinimum(result.subscriberCount, policy.minSubscriberCount)
        )
        .map(({ post }) => post);
      eligible += eligiblePosts.length;
      const acceptedPosts = eligiblePosts.filter((post) =>
        isWithinYouTubeDiscoveryWindow(post, policy.maxVideoAgeHours) &&
        isEligibleYouTubeDiscoveryPost(post, policy)
      );
      const fallbackPool = includePolicyFallbackCandidates
        ? builtEntries.map(({ post }) => post)
        : eligiblePosts;
      candidates.push(...fallbackPool.filter(isEligibleYouTubePreviewFallbackPost));
      posts.push(...acceptedPosts);
      queryStats.push({
        query,
        found: results.length,
        eligible: eligiblePosts.length,
        accepted: acceptedPosts.length,
        rejectedSubscriberGate: results.length - eligiblePosts.length,
        rejectedTargetGrade: eligiblePosts.length - acceptedPosts.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "YouTube search failed";
      errors.push({
        platform: "youtube",
        query,
        message,
      });
      queryStats.push({
        query,
        found: 0,
        eligible: 0,
        accepted: 0,
        rejectedSubscriberGate: 0,
        rejectedTargetGrade: 0,
        error: message,
      });
    }
  }

  return {
    provider: "youtube-data-api" as const,
    platforms: ["youtube"] as const,
    queries,
    posts,
    candidates,
    errors,
    queryStats,
    summary: {
      found,
      eligible,
      accepted: posts.length,
      minSubscriberCount: policy.minSubscriberCount,
      maxVideoAgeHours: policy.maxVideoAgeHours,
      minRelevanceScore: policy.minRelevanceScore,
      minRisingScore: policy.minRisingScore,
    },
  };
}
