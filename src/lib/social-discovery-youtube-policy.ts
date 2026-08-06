export type SocialDiscoveryYouTubePolicy = {
  minSubscriberCount: number;
  maxVideoAgeHours: number;
  minRelevanceScore: number;
  minRisingScore: number;
  relevanceMode: "broad" | "balanced" | "strict";
  momentumMode: "any" | "balanced" | "fast";
};

export const DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY: SocialDiscoveryYouTubePolicy = {
  minSubscriberCount: 100,
  maxVideoAgeHours: 24,
  minRelevanceScore: 18,
  minRisingScore: 30,
  relevanceMode: "balanced",
  momentumMode: "balanced",
};

export function normalizeSocialDiscoveryYouTubePolicy(
  value: unknown,
  fallback: SocialDiscoveryYouTubePolicy | null = null
): SocialDiscoveryYouTubePolicy | null {
  const row = asRecord(value);
  if (!Object.keys(row).length && !fallback) return null;
  const defaults = fallback ?? DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY;
  return {
    minSubscriberCount: wholeNumber(row.minSubscriberCount ?? row.min_subscriber_count, defaults.minSubscriberCount, 0, 100_000_000),
    maxVideoAgeHours: wholeNumber(row.maxVideoAgeHours ?? row.max_video_age_hours, defaults.maxVideoAgeHours, 1, 168),
    minRelevanceScore: numberValue(row.minRelevanceScore ?? row.min_relevance_score, defaults.minRelevanceScore, 0, 100),
    minRisingScore: numberValue(row.minRisingScore ?? row.min_rising_score, defaults.minRisingScore, 0, 100),
    relevanceMode: row.relevanceMode === "broad" || row.relevanceMode === "strict" ? row.relevanceMode : defaults.relevanceMode,
    momentumMode: row.momentumMode === "any" || row.momentumMode === "fast" ? row.momentumMode : defaults.momentumMode,
  };
}

export function youtubePolicyPromptLines(policy: SocialDiscoveryYouTubePolicy) {
  return [
    "Campaign video discovery rules:",
    `- Minimum channel subscribers: ${policy.minSubscriberCount}`,
    `- Maximum video age in hours: ${policy.maxVideoAgeHours}`,
    `- Minimum relevance score: ${policy.minRelevanceScore}`,
    `- Minimum momentum score: ${policy.minRisingScore}`,
    `- Relevance mode: ${policy.relevanceMode}`,
    `- Momentum mode: ${policy.momentumMode}`,
  ];
}

export function youtubePolicyFromPrompt(prompt: string) {
  const minimumSubscribers = prompt.match(/^- Minimum channel subscribers:\s*(\d+(?:\.\d+)?)\s*$/im)?.[1];
  const maximumAge = prompt.match(/^- Maximum video age in hours:\s*(\d+(?:\.\d+)?)\s*$/im)?.[1];
  const minimumRelevance = prompt.match(/^- Minimum relevance score:\s*(\d+(?:\.\d+)?)\s*$/im)?.[1];
  const minimumMomentum = prompt.match(/^- Minimum momentum score:\s*(\d+(?:\.\d+)?)\s*$/im)?.[1];
  if (!minimumSubscribers || !maximumAge || !minimumRelevance || !minimumMomentum) return null;
  return normalizeSocialDiscoveryYouTubePolicy(
    {
      minSubscriberCount: minimumSubscribers,
      maxVideoAgeHours: maximumAge,
      minRelevanceScore: minimumRelevance,
      minRisingScore: minimumMomentum,
      relevanceMode: prompt.match(/^- Relevance mode:\s*(broad|balanced|strict)\s*$/im)?.[1],
      momentumMode: prompt.match(/^- Momentum mode:\s*(any|balanced|fast)\s*$/im)?.[1],
    },
    DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberValue(value: unknown, fallback: number, min: number, max: number) {
  if (String(value ?? "").trim() === "") return fallback;
  const parsed = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
}

function wholeNumber(value: unknown, fallback: number, min: number, max: number) {
  return Math.round(numberValue(value, fallback, min, max));
}
