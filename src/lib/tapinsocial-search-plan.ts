import type { SocialDiscoverySearchStrategyQuery } from "@/lib/factory-types";

function uniqueQueries(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )
  );
}

export function selectTapInCampaignQueriesForRun(input: {
  queries: string[];
  maxQueries: number;
  rotationBucketMinutes?: number;
  now?: number;
}): SocialDiscoverySearchStrategyQuery[] {
  const queries = uniqueQueries(input.queries);
  if (!queries.length) return [];

  const limit = Math.max(1, Math.min(40, Math.floor(Number(input.maxQueries) || 1)));
  const bucketMinutes = Math.max(1, Math.floor(Number(input.rotationBucketMinutes) || 60));
  const bucket = Math.floor((input.now ?? Date.now()) / (bucketMinutes * 60 * 1000));
  const offset = bucket % queries.length;
  const rotated = [...queries.slice(offset), ...queries.slice(0, offset)];

  return rotated.slice(0, limit).map((query) => ({
    query,
    family: "direct_category",
    source: "manual",
    weight: 1,
    rationale: "TapIn campaign target chosen by the user",
  }));
}
