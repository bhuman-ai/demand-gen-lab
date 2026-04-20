import { mkdir, readFile, writeFile } from "fs/promises";
import { createId } from "@/lib/factory-data";
import { CURRENT_SOCIAL_DISCOVERY_PLATFORMS } from "@/lib/social-platform-catalog";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  SocialDiscoveryCommentDelivery,
  SocialDiscoveryListOptions,
  SocialDiscoveryPlatform,
  SocialDiscoveryPost,
  SocialDiscoveryPromotionDraft,
  SocialDiscoveryPromotionPurchase,
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

function socialDiscoveryMaxPostAgeHours() {
  return Math.max(1, Math.min(168, Number(process.env.SOCIAL_DISCOVERY_MAX_POST_AGE_HOURS ?? 1) || 1));
}

function isFreshEnough(postedAt: string) {
  const parsed = Date.parse(postedAt);
  if (!Number.isFinite(parsed)) return false;
  const ageHours = Math.max(0, (Date.now() - parsed) / (60 * 60 * 1000));
  return ageHours <= socialDiscoveryMaxPostAgeHours();
}

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
  const normalized = String(value ?? "").trim().toLowerCase();
  return CURRENT_SOCIAL_DISCOVERY_PLATFORMS.includes(
    normalized as (typeof CURRENT_SOCIAL_DISCOVERY_PLATFORMS)[number]
  )
    ? (normalized as SocialDiscoveryPlatform)
    : "reddit";
}

function normalizeProvider(value: unknown): SocialDiscoveryProvider {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "dataforseo") return "dataforseo";
  if (normalized === "youtube-data-api" || normalized === "youtube_data_api") return "youtube-data-api";
  if (normalized === "youtube-websub" || normalized === "youtube_websub" || normalized === "websub") {
    return "youtube-websub";
  }
  return "exa";
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

function normalizeCommentDelivery(value: unknown): SocialDiscoveryCommentDelivery | undefined {
  const row = asRecord(value);
  const commentId = String(row.commentId ?? row.comment_id ?? "").trim();
  const commentUrl = String(row.commentUrl ?? row.comment_url ?? "").trim();
  const status = String(row.status ?? "").trim();
  const source = String(row.source ?? "").trim();
  const message = String(row.message ?? "").trim();
  const postedAt = String(row.postedAt ?? row.posted_at ?? "").trim();
  const accountId = String(row.accountId ?? row.account_id ?? "").trim();
  const accountName = String(row.accountName ?? row.account_name ?? "").trim();
  const accountHandle = String(row.accountHandle ?? row.account_handle ?? "").trim();
  if (!commentId && !commentUrl && !message && !postedAt) return undefined;
  return {
    commentId,
    commentUrl,
    status: status === "verified" || status === "accepted_unverified" ? status : "",
    source: source === "comments_list" || source === "response" || source === "none" ? source : "",
    message,
    postedAt,
    accountId,
    accountName,
    accountHandle,
    replyDelivery: normalizeCommentDelivery(row.replyDelivery ?? row.reply_delivery),
  };
}

function normalizePromotionDraft(value: unknown): SocialDiscoveryPromotionDraft | undefined {
  const row = asRecord(value);
  const channel = String(row.channel ?? "").trim();
  const objective = String(row.objective ?? "").trim();
  const campaignName = String(row.campaignName ?? row.campaign_name ?? "").trim();
  const destinationUrl = String(row.destinationUrl ?? row.destination_url ?? "").trim();
  const sourcePostUrl = String(row.sourcePostUrl ?? row.source_post_url ?? "").trim();
  const sourceCommentUrl = String(row.sourceCommentUrl ?? row.source_comment_url ?? "").trim();
  const audience = String(row.audience ?? "").trim();
  const headline = String(row.headline ?? "").trim();
  const primaryText = String(row.primaryText ?? row.primary_text ?? "").trim();
  const ctaLabel = String(row.ctaLabel ?? row.cta_label ?? "").trim();
  const rationale = String(row.rationale ?? "").trim();
  const generatedAt = String(row.generatedAt ?? row.generated_at ?? "").trim();
  if (
    !campaignName &&
    !destinationUrl &&
    !sourcePostUrl &&
    !headline &&
    !primaryText &&
    !generatedAt
  ) {
    return undefined;
  }
  return {
    channel: channel === "instagram-ads" ? "instagram-ads" : "instagram-ads",
    objective: objective === "traffic" ? "traffic" : "awareness",
    campaignName,
    destinationUrl,
    sourcePostUrl,
    sourceCommentUrl,
    audience,
    headline,
    primaryText,
    ctaLabel,
    rationale,
    generatedAt,
  };
}

function normalizePromotionPurchase(value: unknown): SocialDiscoveryPromotionPurchase | undefined {
  const row = asRecord(value);
  const provider = String(row.provider ?? "").trim();
  const mode = String(row.mode ?? "").trim();
  const status = String(row.status ?? "").trim();
  const productUrl = String(row.productUrl ?? row.product_url ?? "").trim();
  const cartUrl = String(row.cartUrl ?? row.cart_url ?? "").trim();
  const checkoutUrl = String(row.checkoutUrl ?? row.checkout_url ?? "").trim();
  const sourceCommentUrl = String(row.sourceCommentUrl ?? row.source_comment_url ?? "").trim();
  const addedToCart = Boolean(row.addedToCart ?? row.added_to_cart);
  const walletOptionLabel = String(row.walletOptionLabel ?? row.wallet_option_label ?? "").trim();
  const walletBalance = String(row.walletBalance ?? row.wallet_balance ?? "").trim();
  const missingFields = normalizeStringArray(row.missingFields ?? row.missing_fields);
  const orderId = String(row.orderId ?? row.order_id ?? "").trim();
  const orderUrl = String(row.orderUrl ?? row.order_url ?? "").trim();
  const message = String(row.message ?? "").trim();
  const screenshotPath = String(row.screenshotPath ?? row.screenshot_path ?? "").trim();
  const attemptedAt = String(row.attemptedAt ?? row.attempted_at ?? "").trim();
  if (
    !productUrl &&
    !checkoutUrl &&
    !sourceCommentUrl &&
    !orderId &&
    !message &&
    !attemptedAt
  ) {
    return undefined;
  }
  return {
    provider: provider === "buyshazam" ? "buyshazam" : "buyshazam",
    mode: mode === "wallet" ? "wallet" : "wallet",
    status:
      status === "requires_configuration" ||
      status === "requires_login" ||
      status === "checkout_requires_input" ||
      status === "wallet_unavailable" ||
      status === "submitted"
        ? status
        : "failed",
    productUrl,
    cartUrl,
    checkoutUrl,
    sourceCommentUrl,
    addedToCart,
    walletOptionLabel,
    walletBalance,
    missingFields,
    orderId,
    orderUrl,
    message,
    screenshotPath,
    attemptedAt,
  };
}

function mapPostRow(input: unknown): SocialDiscoveryPost {
  const row = asRecord(input);
  const created = String(row.discoveredAt ?? row.discovered_at ?? nowIso());
  const raw = asRecord(row.raw);
  const commentDelivery = normalizeCommentDelivery(
    row.commentDelivery ?? row.comment_delivery ?? raw.commentDelivery ?? raw.comment_delivery
  );
  const promotionDraft = normalizePromotionDraft(
    row.promotionDraft ?? row.promotion_draft ?? raw.promotionDraft ?? raw.promotion_draft
  );
  const promotionPurchase = normalizePromotionPurchase(
    row.promotionPurchase ?? row.promotion_purchase ?? raw.promotionPurchase ?? raw.promotion_purchase
  );
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
    commentDelivery,
    promotionDraft,
    promotionPurchase,
    raw,
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
      if (!["operator", "specialist", "curator", "partner", "founder", "brand", "community"].includes(role)) return null;
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
      if (!["operator", "specialist", "curator", "partner", "founder", "brand", "community"].includes(actorRole)) return null;
      return {
        actorRole: actorRole as SocialDiscoveryPost["interactionPlan"]["sequence"][number]["actorRole"],
        timing: String(step.timing ?? "").trim(),
        move: String(step.move ?? "").trim(),
        draft: String(step.draft ?? "").trim(),
      };
    })
    .filter((entry): entry is SocialDiscoveryPost["interactionPlan"]["sequence"][number] => Boolean(entry));
  const recommendedAccounts = asArray(row.recommendedAccounts ?? row.recommended_accounts)
    .map((entry) => {
      const account = asRecord(entry);
      const actorRole = String(account.actorRole ?? account.actor_role ?? "").trim();
      const useCase = String(account.useCase ?? account.use_case ?? "").trim();
      if (!["operator", "specialist", "curator", "partner", "founder", "brand", "community"].includes(actorRole)) {
        return null;
      }
      if (!["primary_comment", "followup_if_asked", "watch_only"].includes(useCase)) {
        return null;
      }
      return {
        accountId: String(account.accountId ?? account.account_id ?? "").trim(),
        accountName: String(account.accountName ?? account.account_name ?? "").trim(),
        provider: String(account.provider ?? "").trim(),
        accountType: String(account.accountType ?? account.account_type ?? "").trim(),
        actorRole: actorRole as NonNullable<SocialDiscoveryPost["interactionPlan"]["recommendedAccounts"]>[number]["actorRole"],
        useCase: useCase as NonNullable<SocialDiscoveryPost["interactionPlan"]["recommendedAccounts"]>[number]["useCase"],
        score: Math.max(0, normalizeNumber(account.score, 0)),
        handle: String(account.handle ?? "").trim(),
        profileUrl: String(account.profileUrl ?? account.profile_url ?? "").trim(),
        linkedProvider: String(account.linkedProvider ?? account.linked_provider ?? "").trim(),
        publicIdentifier: String(account.publicIdentifier ?? account.public_identifier ?? "").trim(),
        displayName: String(account.displayName ?? account.display_name ?? "").trim(),
        headline: String(account.headline ?? "").trim(),
        bio: String(account.bio ?? "").trim(),
        personaSummary: String(account.personaSummary ?? account.persona_summary ?? "").trim(),
        lastProfileSyncAt: String(account.lastProfileSyncAt ?? account.last_profile_sync_at ?? "").trim(),
        fromEmail: String(account.fromEmail ?? account.from_email ?? "").trim(),
        connectionProvider: String(account.connectionProvider ?? account.connection_provider ?? "").trim(),
        externalAccountId: String(account.externalAccountId ?? account.external_account_id ?? "").trim(),
        coordinationGroup: String(account.coordinationGroup ?? account.coordination_group ?? "").trim(),
        cooldownUntil: String(account.cooldownUntil ?? account.cooldown_until ?? "").trim(),
        rationale: String(account.rationale ?? "").trim(),
      };
    })
    .filter((entry): entry is NonNullable<SocialDiscoveryPost["interactionPlan"]["recommendedAccounts"]>[number] => Boolean(entry));
  const generationPromptMode = String(row.generationPromptMode ?? row.generation_prompt_mode ?? "").trim();
  return {
    headline: String(row.headline ?? "").trim(),
    domainProfile: String(row.domainProfile ?? row.domain_profile ?? "").trim(),
    fitSummary: String(row.fitSummary ?? row.fit_summary ?? "").trim(),
    targetStrength: String(row.targetStrength ?? row.target_strength ?? "").trim(),
    commentPosture: String(row.commentPosture ?? row.comment_posture ?? "").trim(),
    mentionPolicy: String(row.mentionPolicy ?? row.mention_policy ?? "").trim(),
    analyticsTag: String(row.analyticsTag ?? row.analytics_tag ?? "").trim(),
    generationPrompt: String(row.generationPrompt ?? row.generation_prompt ?? "").trim(),
    generationPromptMode: generationPromptMode === "manual" || generationPromptMode === "auto" ? generationPromptMode : undefined,
    exitRules: normalizeStringArray(row.exitRules ?? row.exit_rules),
    routingSummary: String(row.routingSummary ?? row.routing_summary ?? "").trim(),
    recommendedAccounts,
    actors,
    sequence,
    assetNeeded: String(row.assetNeeded ?? row.asset_needed ?? "").trim(),
    riskNotes: normalizeStringArray(row.riskNotes ?? row.risk_notes),
  } as SocialDiscoveryPost["interactionPlan"];
}

function postDbPayload(
  row: SocialDiscoveryPost,
  options: {
    includeCommentDelivery?: boolean;
  } = {}
) {
  const raw = {
    ...row.raw,
    ...(row.commentDelivery ? { commentDelivery: row.commentDelivery } : {}),
    ...(row.promotionDraft ? { promotionDraft: row.promotionDraft } : {}),
    ...(row.promotionPurchase ? { promotionPurchase: row.promotionPurchase } : {}),
  };
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
    raw,
    posted_at: row.postedAt || null,
    discovered_at: row.discoveredAt,
    updated_at: row.updatedAt,
    ...(options.includeCommentDelivery ? { comment_delivery: row.commentDelivery ?? undefined } : {}),
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
      return (data ?? [])
        .map((row: unknown) => mapPostRow(row))
        .filter((row) => isFreshEnough(row.postedAt))
        .slice(0, limit);
    }
  }

  const store = await readLocalStore();
  return store.posts
    .filter((row) => row.brandId === options.brandId)
    .filter((row) => !options.platform || row.platform === options.platform)
    .filter((row) => !options.status || row.status === options.status)
    .filter((row) => isFreshEnough(row.postedAt))
    .sort((left, right) => {
      if (left.risingScore !== right.risingScore) return right.risingScore - left.risingScore;
      if (left.relevanceScore !== right.relevanceScore) return right.relevanceScore - left.relevanceScore;
      return right.discoveredAt.localeCompare(left.discoveredAt);
    })
    .slice(0, limit);
}

export async function getSocialDiscoveryPost(input: {
  id: string;
  brandId: string;
}): Promise<SocialDiscoveryPost | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_POSTS)
      .select("*")
      .eq("id", input.id)
      .eq("brand_id", input.brandId)
      .maybeSingle();
    if (!error && data) {
      return mapPostRow(data);
    }
  }

  const store = await readLocalStore();
  return store.posts.find((row) => row.id === input.id && row.brandId === input.brandId) ?? null;
}

export async function saveSocialDiscoveryPosts(posts: SocialDiscoveryPost[]): Promise<SocialDiscoveryPost[]> {
  if (!posts.length) return [];
  const timestamp = nowIso();
  const supabase = getSupabaseAdmin();
  const keys = posts.map((post) => ({
    key: `${post.brandId}:${post.platform}:${post.externalId}`,
    brandId: post.brandId,
    platform: post.platform,
    externalId: post.externalId,
  }));
  const existingByKey = new Map<string, SocialDiscoveryPost>();
  if (supabase) {
    const grouped = new Map<string, { platforms: Set<string>; externalIds: Set<string> }>();
    for (const entry of keys) {
      const current = grouped.get(entry.brandId) ?? { platforms: new Set<string>(), externalIds: new Set<string>() };
      current.platforms.add(entry.platform);
      current.externalIds.add(entry.externalId);
      grouped.set(entry.brandId, current);
    }
    for (const [brandId, group] of grouped.entries()) {
      const { data, error } = await supabase
        .from(TABLE_POSTS)
        .select("*")
        .eq("brand_id", brandId)
        .in("platform", Array.from(group.platforms))
        .in("external_id", Array.from(group.externalIds));
      if (!error) {
        for (const row of data ?? []) {
          const mapped = mapPostRow(row);
          existingByKey.set(`${mapped.brandId}:${mapped.platform}:${mapped.externalId}`, mapped);
        }
      }
    }
  }
  const normalizedPosts = posts.map((post) => {
    const existing = existingByKey.get(`${post.brandId}:${post.platform}:${post.externalId}`);
    const commentDelivery = post.commentDelivery ?? existing?.commentDelivery;
    const promotionDraft = post.promotionDraft ?? existing?.promotionDraft;
    const promotionPurchase = post.promotionPurchase ?? existing?.promotionPurchase;
    const raw = {
      ...(existing?.raw ?? {}),
      ...post.raw,
      ...(commentDelivery ? { commentDelivery } : {}),
      ...(promotionDraft ? { promotionDraft } : {}),
      ...(promotionPurchase ? { promotionPurchase } : {}),
    };
    return {
      ...post,
      id: existing?.id ?? post.id,
      status: existing?.status ?? post.status,
      commentDelivery,
      promotionDraft,
      promotionPurchase,
      raw,
      discoveredAt: existing?.discoveredAt ?? post.discoveredAt,
      updatedAt: timestamp,
    };
  });

  if (supabase) {
    const primaryAttempt = await supabase
      .from(TABLE_POSTS)
      .upsert(normalizedPosts.map((post) => postDbPayload(post, { includeCommentDelivery: true })), {
        onConflict: "brand_id,platform,external_id",
      })
      .select("*");
    if (!primaryAttempt.error) {
      return (primaryAttempt.data ?? []).map((row: unknown) => mapPostRow(row));
    }

    const fallbackAttempt = await supabase
      .from(TABLE_POSTS)
      .upsert(normalizedPosts.map((post) => postDbPayload(post)), { onConflict: "brand_id,platform,external_id" })
      .select("*");
    if (!fallbackAttempt.error) {
      return (fallbackAttempt.data ?? []).map((row: unknown) => mapPostRow(row));
    }
  }

  const store = await readLocalStore();
  const localExistingByKey = new Map(store.posts.map((row) => [`${row.brandId}:${row.platform}:${row.externalId}`, row]));
  const mergedPostsByKey = new Map<string, SocialDiscoveryPost>();
  for (const post of normalizedPosts) {
    const key = `${post.brandId}:${post.platform}:${post.externalId}`;
    const existing = localExistingByKey.get(key);
    const commentDelivery = post.commentDelivery ?? existing?.commentDelivery;
    const promotionDraft = post.promotionDraft ?? existing?.promotionDraft;
    const promotionPurchase = post.promotionPurchase ?? existing?.promotionPurchase;
    const mergedPost = {
      ...post,
      id: existing?.id ?? post.id,
      status: existing?.status ?? post.status,
      commentDelivery,
      promotionDraft,
      promotionPurchase,
      raw: {
        ...(existing?.raw ?? {}),
        ...post.raw,
        ...(commentDelivery ? { commentDelivery } : {}),
        ...(promotionDraft ? { promotionDraft } : {}),
        ...(promotionPurchase ? { promotionPurchase } : {}),
      },
      discoveredAt: existing?.discoveredAt ?? post.discoveredAt,
    };
    localExistingByKey.set(key, mergedPost);
    mergedPostsByKey.set(key, mergedPost);
  }
  store.posts = Array.from(localExistingByKey.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  await writeLocalStore(store);
  return normalizedPosts.map((post) => mergedPostsByKey.get(`${post.brandId}:${post.platform}:${post.externalId}`) ?? post);
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

export async function updateSocialDiscoveryPostCommentDelivery(input: {
  id: string;
  brandId: string;
  status: SocialDiscoveryStatus;
  commentDelivery: SocialDiscoveryCommentDelivery;
}): Promise<SocialDiscoveryPost | null> {
  const updatedAt = nowIso();
  const supabase = getSupabaseAdmin();
  const existing = await getSocialDiscoveryPost({ id: input.id, brandId: input.brandId });
  const raw = {
    ...(existing?.raw ?? {}),
    commentDelivery: input.commentDelivery,
  };
  if (supabase) {
    const primaryAttempt = await supabase
      .from(TABLE_POSTS)
      .update({
        status: input.status,
        comment_delivery: input.commentDelivery,
        raw,
        updated_at: updatedAt,
      })
      .eq("id", input.id)
      .eq("brand_id", input.brandId)
      .select("*")
      .maybeSingle();
    if (!primaryAttempt.error && primaryAttempt.data) {
      return mapPostRow(primaryAttempt.data);
    }
    const fallbackAttempt = await supabase
      .from(TABLE_POSTS)
      .update({
        status: input.status,
        raw,
        updated_at: updatedAt,
      })
      .eq("id", input.id)
      .eq("brand_id", input.brandId)
      .select("*")
      .maybeSingle();
    if (!fallbackAttempt.error && fallbackAttempt.data) {
      return mapPostRow(fallbackAttempt.data);
    }
  }

  const store = await readLocalStore();
  const index = store.posts.findIndex((row) => row.id === input.id && row.brandId === input.brandId);
  if (index < 0) return null;
  store.posts[index] = {
    ...store.posts[index],
    status: input.status,
    commentDelivery: input.commentDelivery,
    raw,
    updatedAt,
  };
  await writeLocalStore(store);
  return store.posts[index];
}

export async function updateSocialDiscoveryPostPromotionDraft(input: {
  id: string;
  brandId: string;
  promotionDraft: SocialDiscoveryPromotionDraft;
}): Promise<SocialDiscoveryPost | null> {
  const updatedAt = nowIso();
  const supabase = getSupabaseAdmin();
  const existing = await getSocialDiscoveryPost({ id: input.id, brandId: input.brandId });
  const raw = {
    ...(existing?.raw ?? {}),
    promotionDraft: input.promotionDraft,
  };

  if (supabase) {
    const attempt = await supabase
      .from(TABLE_POSTS)
      .update({
        raw,
        updated_at: updatedAt,
      })
      .eq("id", input.id)
      .eq("brand_id", input.brandId)
      .select("*")
      .maybeSingle();
    if (!attempt.error && attempt.data) {
      return mapPostRow(attempt.data);
    }
  }

  const store = await readLocalStore();
  const index = store.posts.findIndex((row) => row.id === input.id && row.brandId === input.brandId);
  if (index < 0) return null;
  store.posts[index] = {
    ...store.posts[index],
    promotionDraft: input.promotionDraft,
    raw,
    updatedAt,
  };
  await writeLocalStore(store);
  return store.posts[index];
}

export async function updateSocialDiscoveryPostPromotionPurchase(input: {
  id: string;
  brandId: string;
  promotionPurchase: SocialDiscoveryPromotionPurchase;
}): Promise<SocialDiscoveryPost | null> {
  const updatedAt = nowIso();
  const supabase = getSupabaseAdmin();
  const existing = await getSocialDiscoveryPost({ id: input.id, brandId: input.brandId });
  const raw = {
    ...(existing?.raw ?? {}),
    promotionPurchase: input.promotionPurchase,
  };

  if (supabase) {
    const attempt = await supabase
      .from(TABLE_POSTS)
      .update({
        raw,
        updated_at: updatedAt,
      })
      .eq("id", input.id)
      .eq("brand_id", input.brandId)
      .select("*")
      .maybeSingle();
    if (!attempt.error && attempt.data) {
      return mapPostRow(attempt.data);
    }
  }

  const store = await readLocalStore();
  const index = store.posts.findIndex((row) => row.id === input.id && row.brandId === input.brandId);
  if (index < 0) return null;
  store.posts[index] = {
    ...store.posts[index],
    promotionPurchase: input.promotionPurchase,
    raw,
    updatedAt,
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
