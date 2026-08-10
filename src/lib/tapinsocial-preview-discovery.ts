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
  selectionMode: "policy_match" | "best_available" | null;
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

function compareCandidates(left: SocialDiscoveryPost, right: SocialDiscoveryPost) {
  if (left.relevanceScore !== right.relevanceScore) {
    return right.relevanceScore - left.relevanceScore;
  }
  if (left.risingScore !== right.risingScore) {
    return right.risingScore - left.risingScore;
  }
  if (left.engagementScore !== right.engagementScore) {
    return right.engagementScore - left.engagementScore;
  }
  return left.providerRank - right.providerRank;
}

function bestCandidate(posts: SocialDiscoveryPost[]) {
  const byVideo = new Map<string, SocialDiscoveryPost>();
  for (const post of posts) {
    const key = post.externalId || post.url || post.id;
    const current = byVideo.get(key);
    if (!current || compareCandidates(post, current) < 0) {
      byVideo.set(key, post);
    }
  }
  return [...byVideo.values()].sort(compareCandidates)[0] ?? null;
}

export function buildTapInPreviewTargetExample(input: {
  campaignName: string;
  targets: string[];
}) {
  const target = normalizedQueries(input.targets)[0] || "the campaign target";
  const campaignName = String(input.campaignName ?? "").replace(/\s+/g, " ").trim();
  return {
    title: `Upcoming YouTube video about ${target}`.slice(0, 400),
    description: [
      `Representative future match about ${target}.`,
      campaignName ? `TapIn will use the live campaign goal “${campaignName}” to rank new videos from best match down.` : "",
      "This preview is hypothetical; TapIn will use a real eligible video when the campaign runs.",
    ].filter(Boolean).join(" ").slice(0, 4000),
    url: "",
    matchedTarget: target.slice(0, 160),
    matchQuality: "target_example" as const,
  };
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
  const policyMatches: SocialDiscoveryPost[] = [];
  const fallbackCandidates: SocialDiscoveryPost[] = [];

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
    policyMatches.push(...discovery.posts);
    fallbackCandidates.push(...discovery.candidates);
  }

  const policyMatch = bestCandidate(policyMatches);
  const fallbackMatch = policyMatch ? null : bestCandidate(fallbackCandidates);

  return {
    post: policyMatch ?? fallbackMatch,
    selectionMode: policyMatch ? "policy_match" : fallbackMatch ? "best_available" : null,
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
