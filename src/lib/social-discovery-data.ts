import { mkdir, readFile, writeFile } from "fs/promises";
import { createId } from "@/lib/factory-data";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  SocialDiscoveryListOptions,
  SocialDiscoveryPlatform,
  SocialDiscoveryPost,
  SocialDiscoveryProvider,
  SocialDiscoveryRun,
  SocialDiscoveryStatus,
} from "@/lib/social-discovery-types";

type SocialDiscoveryStore = {
  posts: SocialDiscoveryPost[];
  runs: SocialDiscoveryRun[];
};

const isVercel = Boolean(process.env.VERCEL);
const SOCIAL_DISCOVERY_PATH = isVercel
  ? "/tmp/social_discovery.v1.json"
  : `${process.cwd()}/data/social_discovery.v1.json`;

const TABLE_POSTS = "demanddev_social_discovery_posts";
const TABLE_RUNS = "demanddev_social_discovery_runs";

const nowIso = () => new Date().toISOString();

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizePlatform(value: unknown): SocialDiscoveryPlatform {
  return String(value ?? "").trim().toLowerCase() === "instagram" ? "instagram" : "reddit";
}

function normalizeProvider(value: unknown): SocialDiscoveryProvider {
  return String(value ?? "").trim().toLowerCase() === "dataforseo" ? "dataforseo" : "exa";
}

function normalizeStatus(value: unknown): SocialDiscoveryStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["triaged", "saved", "dismissed"].includes(normalized)) {
    return normalized as SocialDiscoveryStatus;
  }
  return "new";
}

function normalizeIntent(value: unknown): SocialDiscoveryPost["intent"] {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["brand_mention", "buyer_question", "competitor_complaint", "category_intent", "noise"].includes(normalized)) {
    return normalized as SocialDiscoveryPost["intent"];
  }
  return "noise";
}

function normalizeStringArray(value: unknown): string[] {
  return asArray(value)
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function normalizeNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapPostRow(input: unknown): SocialDiscoveryPost {
  const row = asRecord(input);
  const created = String(row.discoveredAt ?? row.discovered_at ?? nowIso());
  return {
    id: String(row.id ?? createId("socialpost")),
    brandId: String(row.brandId ?? row.brand_id ?? ""),
    platform: normalizePlatform(row.platform),
    provider: normalizeProvider(row.provider ?? row.source_provider),
    externalId: String(row.externalId ?? row.external_id ?? ""),
    url: String(row.url ?? ""),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    author: String(row.author ?? ""),
    community: String(row.community ?? ""),
    query: String(row.query ?? ""),
    matchedTerms: normalizeStringArray(row.matchedTerms ?? row.matched_terms),
    intent: normalizeIntent(row.intent),
    relevanceScore: Math.max(0, Math.min(100, normalizeNumber(row.relevanceScore ?? row.relevance_score, 0))),
    risingScore: Math.max(0, Math.min(100, normalizeNumber(row.risingScore ?? row.rising_score, 0))),
    engagementScore: Math.max(0, normalizeNumber(row.engagementScore ?? row.engagement_score, 0)),
    providerRank: Math.max(0, normalizeNumber(row.providerRank ?? row.provider_rank, 0)),
    status: normalizeStatus(row.status),
    interactionPlan: normalizeInteractionPlan(row.interactionPlan ?? row.interaction_plan),
    raw: asRecord(row.raw),
    postedAt: String(row.postedAt ?? row.posted_at ?? ""),
    discoveredAt: created,
    updatedAt: String(row.updatedAt ?? row.updated_at ?? created),
  };
}

function mapRunRow(input: unknown): SocialDiscoveryRun {
  const row = asRecord(input);
  const errors = asArray(row.errors).map((entry) => {
    const error = asRecord(entry);
    return {
      platform: normalizePlatform(error.platform),
      query: String(error.query ?? ""),
      message: String(error.message ?? ""),
    };
  });
  return {
    id: String(row.id ?? createId("socialrun")),
    brandId: String(row.brandId ?? row.brand_id ?? ""),
    provider: normalizeProvider(row.provider ?? row.source_provider),
    platforms: normalizeStringArray(row.platforms).map(normalizePlatform),
    queries: normalizeStringArray(row.queries),
    postIds: normalizeStringArray(row.postIds ?? row.post_ids),
    errorCount: Math.max(0, normalizeNumber(row.errorCount ?? row.error_count, errors.length)),
    errors,
    startedAt: String(row.startedAt ?? row.started_at ?? nowIso()),
    finishedAt: String(row.finishedAt ?? row.finished_at ?? nowIso()),
  };
}

function normalizeInteractionPlan(value: unknown): SocialDiscoveryPost["interactionPlan"] {
  const row = asRecord(value);
  const actors = asArray(row.actors)
    .map((entry) => {
      const actor = asRecord(entry);
      const role = String(actor.role ?? "").trim();
      if (!["operator", "specialist", "curator", "partner", "founder"].includes(role)) return null;
      return {
        role: role as SocialDiscoveryPost["interactionPlan"]["actors"][number]["role"],
        job: String(actor.job ?? "").trim(),
      };
    })
    .filter((entry): entry is SocialDiscoveryPost["interactionPlan"]["actors"][number] => Boolean(entry));
  const sequence = asArray(row.sequence)
    .map((entry) => {
      const step = asRecord(entry);
      const actorRole = String(step.actorRole ?? step.actor_role ?? "").trim();
      if (!["operator", "specialist", "curator", "partner", "founder"].includes(actorRole)) return null;
      return {
        actorRole: actorRole as SocialDiscoveryPost["interactionPlan"]["sequence"][number]["actorRole"],
        timing: String(step.timing ?? "").trim(),
        move: String(step.move ?? "").trim(),
        draft: String(step.draft ?? "").trim(),
      };
    })
    .filter((entry): entry is SocialDiscoveryPost["interactionPlan"]["sequence"][number] => Boolean(entry));
  return {
    headline: String(row.headline ?? "").trim(),
    targetStrength: String(row.targetStrength ?? row.target_strength ?? "").trim(),
    commentPosture: String(row.commentPosture ?? row.comment_posture ?? "").trim(),
    mentionPolicy: String(row.mentionPolicy ?? row.mention_policy ?? "").trim(),
    analyticsTag: String(row.analyticsTag ?? row.analytics_tag ?? "").trim(),
    exitRules: normalizeStringArray(row.exitRules ?? row.exit_rules),
    actors,
    sequence,
    assetNeeded: String(row.assetNeeded ?? row.asset_needed ?? "").trim(),
    riskNotes: normalizeStringArray(row.riskNotes ?? row.risk_notes),
  } as SocialDiscoveryPost["interactionPlan"];
}

function postDbPayload(row: SocialDiscoveryPost) {
  return {
    id: row.id,
    brand_id: row.brandId,
    platform: row.platform,
    provider: row.provider,
    external_id: row.externalId,
    url: row.url,
    title: row.title,
    body: row.body,
    author: row.author,
    community: row.community,
    query: row.query,
    matched_terms: row.matchedTerms,
    intent: row.intent,
    relevance_score: row.relevanceScore,
    rising_score: row.risingScore,
    engagement_score: row.engagementScore,
    provider_rank: row.providerRank,
    status: row.status,
    interaction_plan: row.interactionPlan,
    raw: row.raw,
    posted_at: row.postedAt || null,
    discovered_at: row.discoveredAt,
    updated_at: row.updatedAt,
  };
}

function runDbPayload(row: SocialDiscoveryRun) {
  return {
    id: row.id,
    brand_id: row.brandId,
    provider: row.provider,
    platforms: row.platforms,
    queries: row.queries,
    post_ids: row.postIds,
    error_count: row.errorCount,
    errors: row.errors,
    started_at: row.startedAt,
    finished_at: row.finishedAt,
  };
}

function defaultStore(): SocialDiscoveryStore {
  return {
    posts: [],
    runs: [],
  };
}

async function readLocalStore(): Promise<SocialDiscoveryStore> {
  try {
    const raw = await readFile(SOCIAL_DISCOVERY_PATH, "utf8");
    const parsed = asRecord(JSON.parse(raw));
    return {
      posts: asArray(parsed.posts).map(mapPostRow),
      runs: asArray(parsed.runs).map(mapRunRow),
    };
  } catch {
    return defaultStore();
  }
}

async function writeLocalStore(store: SocialDiscoveryStore) {
  if (!isVercel) {
    await mkdir(`${process.cwd()}/data`, { recursive: true });
  }
  await writeFile(SOCIAL_DISCOVERY_PATH, JSON.stringify(store, null, 2));
}

export async function listSocialDiscoveryPosts(options: SocialDiscoveryListOptions): Promise<SocialDiscoveryPost[]> {
  const limit = Math.max(1, Math.min(250, Number(options.limit ?? 50) || 50));
  const supabase = getSupabaseAdmin();

  if (supabase) {
    let query = supabase
      .from(TABLE_POSTS)
      .select("*")
      .eq("brand_id", options.brandId)
      .order("rising_score", { ascending: false })
      .order("relevance_score", { ascending: false })
      .order("discovered_at", { ascending: false })
      .limit(limit);
    if (options.platform) query = query.eq("platform", options.platform);
    if (options.status) query = query.eq("status", options.status);
    const { data, error } = await query;
    if (!error) {
      return (data ?? []).map((row: unknown) => mapPostRow(row));
    }
  }

  const store = await readLocalStore();
  return store.posts
    .filter((row) => row.brandId === options.brandId)
    .filter((row) => !options.platform || row.platform === options.platform)
    .filter((row) => !options.status || row.status === options.status)
    .sort((left, right) => {
      if (left.risingScore !== right.risingScore) return right.risingScore - left.risingScore;
      if (left.relevanceScore !== right.relevanceScore) return right.relevanceScore - left.relevanceScore;
      return right.discoveredAt.localeCompare(left.discoveredAt);
    })
    .slice(0, limit);
}

export async function saveSocialDiscoveryPosts(posts: SocialDiscoveryPost[]): Promise<SocialDiscoveryPost[]> {
  if (!posts.length) return [];
  const timestamp = nowIso();
  const normalizedPosts = posts.map((post) => ({
    ...post,
    updatedAt: timestamp,
  }));
  const supabase = getSupabaseAdmin();

  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_POSTS)
      .upsert(normalizedPosts.map(postDbPayload), { onConflict: "brand_id,platform,external_id" })
      .select("*");
    if (!error) {
      return (data ?? []).map((row: unknown) => mapPostRow(row));
    }
  }

  const store = await readLocalStore();
  const existingByKey = new Map(store.posts.map((row) => [`${row.brandId}:${row.platform}:${row.externalId}`, row]));
  for (const post of normalizedPosts) {
    const key = `${post.brandId}:${post.platform}:${post.externalId}`;
    const existing = existingByKey.get(key);
    existingByKey.set(key, {
      ...post,
      id: existing?.id ?? post.id,
      status: existing?.status ?? post.status,
      discoveredAt: existing?.discoveredAt ?? post.discoveredAt,
    });
  }
  store.posts = Array.from(existingByKey.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  await writeLocalStore(store);
  return normalizedPosts;
}

export async function updateSocialDiscoveryPostStatus(input: {
  id: string;
  brandId: string;
  status: SocialDiscoveryStatus;
}): Promise<SocialDiscoveryPost | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_POSTS)
      .update({ status: input.status, updated_at: nowIso() })
      .eq("id", input.id)
      .eq("brand_id", input.brandId)
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapPostRow(data);
    }
  }

  const store = await readLocalStore();
  const index = store.posts.findIndex((row) => row.id === input.id && row.brandId === input.brandId);
  if (index < 0) return null;
  store.posts[index] = {
    ...store.posts[index],
    status: input.status,
    updatedAt: nowIso(),
  };
  await writeLocalStore(store);
  return store.posts[index];
}

export async function createSocialDiscoveryRun(input: Omit<SocialDiscoveryRun, "id"> & { id?: string }) {
  const run: SocialDiscoveryRun = {
    ...input,
    id: input.id ?? createId("socialrun"),
  };
  const supabase = getSupabaseAdmin();

  if (supabase) {
    const { data, error } = await supabase.from(TABLE_RUNS).insert(runDbPayload(run)).select("*").single();
    if (!error && data) {
      return mapRunRow(data);
    }
  }

  const store = await readLocalStore();
  store.runs.unshift(run);
  store.runs = store.runs.slice(0, 500);
  await writeLocalStore(store);
  return run;
}

export async function listSocialDiscoveryRuns(input: { brandId: string; limit?: number }): Promise<SocialDiscoveryRun[]> {
  const limit = Math.max(1, Math.min(100, Number(input.limit ?? 20) || 20));
  const supabase = getSupabaseAdmin();

  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_RUNS)
      .select("*")
      .eq("brand_id", input.brandId)
      .order("started_at", { ascending: false })
      .limit(limit);
    if (!error) {
      return (data ?? []).map((row: unknown) => mapRunRow(row));
    }
  }

  const store = await readLocalStore();
  return store.runs
    .filter((row) => row.brandId === input.brandId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, limit);
}
