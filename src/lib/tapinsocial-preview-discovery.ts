import type { BrandRecord } from "@/lib/factory-data";
import type { OutreachAccountSecrets } from "@/lib/outreach-data";
import {
  discoverYouTubeSearchPostsForBrand,
  type YouTubeDiscoveryError,
  type YouTubeDiscoveryQueryStats,
} from "@/lib/social-discovery-youtube-search";
import type { SocialDiscoveryPost } from "@/lib/social-discovery-types";
import type { SocialDiscoveryYouTubePolicy } from "@/lib/social-discovery-youtube-policy";

const PREVIEW_QUERY_LIMIT = 3;
const PREVIEW_RESULTS_PER_QUERY = 25;

type DiscoveryResult = Awaited<ReturnType<typeof discoverYouTubeSearchPostsForBrand>>;
type DiscoveryFunction = typeof discoverYouTubeSearchPostsForBrand;

export type TapInPreviewDiscoveryResult = {
  post: SocialDiscoveryPost | null;
  queries: string[];
  errors: YouTubeDiscoveryError[];
  queryStats: YouTubeDiscoveryQueryStats[];
  summary: DiscoveryResult["summary"];
};

function normalizedQueries(queries: string[]) {
  return Array.from(
    new Set(
      queries
        .map((query) => String(query ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )
  ).slice(0, PREVIEW_QUERY_LIMIT);
}

function everyQueryFailed(discovery: DiscoveryResult) {
  return discovery.queryStats.length > 0 &&
    discovery.queryStats.every((query) => Boolean(query.error));
}

export async function discoverTapInPreviewVideo(input: {
  brand: BrandRecord;
  queries: string[];
  secrets?: Pick<
    OutreachAccountSecrets,
    "youtubeClientId" | "youtubeClientSecret" | "youtubeRefreshToken"
  >;
  policy: SocialDiscoveryYouTubePolicy;
  discover?: DiscoveryFunction;
}): Promise<TapInPreviewDiscoveryResult> {
  const discover = input.discover ?? discoverYouTubeSearchPostsForBrand;
  const queries = normalizedQueries(input.queries);
  const errors: YouTubeDiscoveryError[] = [];
  const queryStats: YouTubeDiscoveryQueryStats[] = [];
  let found = 0;
  let eligible = 0;
  let accepted = 0;

  for (const query of queries) {
    const discoveryInput = {
      brand: input.brand,
      queries: [query],
      maxResults: PREVIEW_RESULTS_PER_QUERY,
      order: "relevance" as const,
      secrets: input.secrets,
      policy: input.policy,
    };
    let discovery = await discover({ ...discoveryInput, preferApiKey: true });
    if (input.secrets && everyQueryFailed(discovery)) {
      discovery = await discover({ ...discoveryInput, preferApiKey: false });
    }

    errors.push(...discovery.errors);
    queryStats.push(...discovery.queryStats);
    found += discovery.summary.found;
    eligible += discovery.summary.eligible;
    accepted += discovery.summary.accepted;

    if (discovery.posts[0]) {
      return {
        post: discovery.posts[0],
        queries: queryStats.map((stats) => stats.query),
        errors,
        queryStats,
        summary: {
          ...discovery.summary,
          found,
          eligible,
          accepted,
        },
      };
    }
  }

  return {
    post: null,
    queries: queryStats.map((stats) => stats.query),
    errors,
    queryStats,
    summary: {
      found,
      eligible,
      accepted,
      minSubscriberCount: input.policy.minSubscriberCount,
      maxVideoAgeHours: input.policy.maxVideoAgeHours,
      minRelevanceScore: input.policy.minRelevanceScore,
      minRisingScore: input.policy.minRisingScore,
    },
  };
}

export function tapInPreviewNoMatchError(
  discovery: TapInPreviewDiscoveryResult,
  policy: SocialDiscoveryYouTubePolicy
) {
  const { found, eligible } = discovery.summary;
  const topicCount = discovery.queryStats.length;
  const everySearchFailed = topicCount > 0 &&
    discovery.queryStats.every((query) => Boolean(query.error));

  if (everySearchFailed) {
    return {
      error: "YouTube search could not run. Reconnect a YouTube account, then try again.",
      errorCode: "youtube_search_failed",
      status: 502,
    };
  }

  const topicLabel = `${topicCount} topic${topicCount === 1 ? "" : "s"}`;
  if (found === 0) {
    return {
      error: `TapIn checked ${topicLabel}, but YouTube returned no videos from the last ${policy.maxVideoAgeHours} hours. Increase video age or use a more specific topic.`,
      status: 422,
    };
  }
  if (eligible === 0) {
    return {
      error: `TapIn checked ${found} recent video${found === 1 ? "" : "s"} across ${topicLabel}, but none met the ${policy.minSubscriberCount.toLocaleString()} subscriber minimum. Lower that minimum and try again.`,
      status: 422,
    };
  }

  const looserSettings = [
    policy.relevanceMode === "broad" ? "" : "Broad relevance",
    policy.momentumMode === "any" ? "" : "Any momentum",
  ].filter(Boolean);
  if (looserSettings.length) {
    return {
      error: `TapIn checked ${found} recent videos across ${topicLabel}; ${eligible} passed the subscriber rule, but none passed the current relevance and momentum rules. Try ${looserSettings.join(" and ")}.`,
      status: 422,
    };
  }

  return {
    error: `TapIn checked ${found} recent videos across ${topicLabel}; ${eligible} passed the subscriber rule, but this recent sample had no safe, close match. This is not all of YouTube. Try a more specific topic or increase video age.`,
    status: 422,
  };
}
