import { getBrandById, listBrands, type BrandRecord } from "@/lib/factory-data";
import { listSocialRoutingAccounts } from "@/lib/outreach-data";
import {
  listSocialDiscoveryAutoCommentCandidates,
  listSocialDiscoveryCommentedPostsSince,
  saveSocialDiscoveryPosts,
} from "@/lib/social-discovery-data";
import { refreshSocialDiscoveryCommentDraft } from "@/lib/social-discovery";
import {
  deliverSocialDiscoveryComment,
  isPlatformDeliveryError,
  SocialCommentDeliveryError,
} from "@/lib/social-discovery-comment-delivery";
import {
  brandMentionCount,
  brandMentionLooksCannedOrAdLike,
  commentBrandName,
} from "@/lib/social-discovery-brand-mention";
import type { OutreachAccount } from "@/lib/factory-types";
import type { SocialDiscoveryPost } from "@/lib/social-discovery-types";
import { getYouTubeVideoTranscript } from "@/lib/youtube";

type AutoCommentDispatchOptions = {
  brandIds?: string[];
  scanAllBrands?: boolean;
  dryRun?: boolean;
  limit?: number;
  hourlyCap?: number;
  perRunCap?: number;
  perAccountHourlyCap?: number;
  minSpacingMinutes?: number;
  channelCooldownMinutes?: number;
  maxVideoAgeHours?: number;
  candidateLimit?: number;
};

type AutoCommentDispatchResult = {
  ok: true;
  enabled: boolean;
  dryRun: boolean;
  scannedBrands: number;
  hourlyCap: number;
  perRunCap: number;
  posted: number;
  skipped: number;
  failed: number;
  results: Array<{
    brandId: string;
    brandName: string;
    posted: number;
    skipped: number;
    failed: number;
    details: Array<Record<string, unknown>>;
  }>;
};

const MIN_YOUTUBE_AUTO_COMMENT_SUBSCRIBERS = 1000;

function boolEnv(name: string, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function numberOption(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}

function splitCsv(value: unknown) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return raw
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function youtubeRecord(post: SocialDiscoveryPost) {
  return asRecord(asRecord(post.raw).youtube);
}

function youtubeSubscriberCount(post: SocialDiscoveryPost) {
  const count = Number(youtubeRecord(post).subscriberCount ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function youtubeChannelId(post: SocialDiscoveryPost) {
  return String(youtubeRecord(post).channelId ?? "").trim();
}

function videoTranscriptText(post: SocialDiscoveryPost) {
  return String(asRecord(youtubeRecord(post).videoTranscript).text ?? "").trim();
}

function dispatchMeta(post: SocialDiscoveryPost) {
  return asRecord(post.raw.autoCommentDispatch);
}

function retryBlocked(post: SocialDiscoveryPost) {
  const meta = dispatchMeta(post);
  const attempts = Math.max(0, Number(meta.attempts ?? 0) || 0);
  const nextAttemptAt = String(meta.nextAttemptAt ?? "").trim();
  const nextAttemptMs = Date.parse(nextAttemptAt);
  if (attempts >= 3) return "max_attempts";
  if (nextAttemptAt && Number.isFinite(nextAttemptMs) && nextAttemptMs > Date.now()) return "retry_wait";
  return "";
}

function addMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function markDispatchAttempt(input: {
  post: SocialDiscoveryPost;
  status: "skipped" | "failed" | "posted" | "dry_run";
  reason?: string;
  details?: Record<string, unknown>;
}) {
  const current = dispatchMeta(input.post);
  const attempts = Math.max(0, Number(current.attempts ?? 0) || 0);
  const nextAttempts = input.status === "failed" ? attempts + 1 : attempts;
  const nextAttemptAt =
    input.status === "failed" && nextAttempts < 3
      ? addMinutes(Math.min(240, 30 * Math.max(1, nextAttempts)))
      : "";
  const nextPost = {
    ...input.post,
    raw: {
      ...input.post.raw,
      autoCommentDispatch: {
        ...current,
        attempts: nextAttempts,
        status: input.status,
        reason: input.reason ?? "",
        details: input.details ?? {},
        lastAttemptAt: new Date().toISOString(),
        nextAttemptAt,
      },
    },
  };
  await saveSocialDiscoveryPosts([nextPost]);
}

async function withTranscript(post: SocialDiscoveryPost) {
  if (videoTranscriptText(post)) return post;
  const videoId = String(youtubeRecord(post).videoId ?? post.externalId ?? "").trim();
  if (!videoId) return post;
  try {
    const transcript = await getYouTubeVideoTranscript({ videoId });
    const nextPost = {
      ...post,
      raw: {
        ...post.raw,
        youtube: {
          ...youtubeRecord(post),
          videoTranscript: transcript
            ? {
                ...transcript,
                status: "available",
              }
            : {
                status: "unavailable",
                fetchedAt: new Date().toISOString(),
              },
        },
      },
      updatedAt: new Date().toISOString(),
    };
    const [savedPost] = await saveSocialDiscoveryPosts([nextPost]);
    return savedPost ?? nextPost;
  } catch {
    return post;
  }
}

function draftPair(post: SocialDiscoveryPost) {
  return {
    comment: post.interactionPlan.sequence[0]?.draft?.trim() ?? "",
    reply: post.interactionPlan.sequence[1]?.draft?.trim() ?? "",
  };
}

function draftProblem(post: SocialDiscoveryPost, brandName: string, needsReply: boolean) {
  const pair = draftPair(post);
  if (!pair.comment) return "missing_comment";
  if (needsReply && !pair.reply) return "missing_reply";
  const combined = [pair.comment, pair.reply].filter(Boolean).join("\n");
  const mentions = brandMentionCount(combined, brandName);
  if (mentions === 0) return "missing_brand";
  if (mentions > 1) return "brand_mentioned_more_than_once";
  if (brandMentionLooksCannedOrAdLike(combined, brandName)) return "canned_brand_mention";
  return "";
}

function isYouTubeAccount(account: OutreachAccount) {
  return (
    account.status === "active" &&
    account.config.social.enabled &&
    account.config.social.connectionProvider === "youtube" &&
    account.config.social.platforms.includes("youtube")
  );
}

function recommendedAccountIds(post: SocialDiscoveryPost) {
  return (
    post.interactionPlan.recommendedAccounts
      ?.filter((entry) => entry.connectionProvider === "youtube" && entry.useCase === "primary_comment")
      .map((entry) => entry.accountId)
      .filter(Boolean) ?? []
  );
}

function accountCommentCounts(posts: SocialDiscoveryPost[]) {
  const counts = new Map<string, number>();
  for (const post of posts) {
    const accountId = post.commentDelivery?.accountId?.trim();
    if (accountId) counts.set(accountId, (counts.get(accountId) ?? 0) + 1);
    const replyAccountId = post.commentDelivery?.replyDelivery?.accountId?.trim();
    if (replyAccountId) counts.set(replyAccountId, (counts.get(replyAccountId) ?? 0) + 1);
    const pendingReplyAccountId = post.pendingReply?.accountId?.trim();
    if (pendingReplyAccountId && post.pendingReply?.status === "scheduled") {
      counts.set(pendingReplyAccountId, (counts.get(pendingReplyAccountId) ?? 0) + 1);
    }
  }
  return counts;
}

function chooseAccounts(input: {
  post: SocialDiscoveryPost;
  accounts: OutreachAccount[];
  recentAccountCounts: Map<string, number>;
  perAccountHourlyCap: number;
}) {
  const recommended = recommendedAccountIds(input.post);
  const byId = new Map(input.accounts.map((account) => [account.id, account]));
  const ordered = [
    ...recommended.map((id) => byId.get(id)).filter((account): account is OutreachAccount => Boolean(account)),
    ...input.accounts.filter((account) => !recommended.includes(account.id)),
  ];
  const available = ordered.filter(
    (account) => (input.recentAccountCounts.get(account.id) ?? 0) < input.perAccountHourlyCap
  );
  const primary = available[0] ?? null;
  const reply = primary ? available.find((account) => account.id !== primary.id) ?? null : null;
  return { primary, reply };
}

function recentChannelIds(posts: SocialDiscoveryPost[], sinceMs: number) {
  const ids = new Set<string>();
  for (const post of posts) {
    const postedMs = Date.parse(post.commentDelivery?.postedAt ?? "");
    if (!Number.isFinite(postedMs) || postedMs < sinceMs) continue;
    const channelId = youtubeChannelId(post);
    if (channelId) ids.add(channelId);
  }
  return ids;
}

async function resolveBrands(input: AutoCommentDispatchOptions) {
  const configuredBrandIds = input.brandIds?.length
    ? input.brandIds
    : splitCsv(process.env.SOCIAL_DISCOVERY_AUTO_COMMENT_BRAND_IDS || process.env.SOCIAL_DISCOVERY_BRAND_IDS);
  const limit = numberOption(input.limit ?? process.env.SOCIAL_DISCOVERY_AUTO_COMMENT_BRAND_LIMIT, 5, 1, 50);

  if (configuredBrandIds.length) {
    const brands = await Promise.all(configuredBrandIds.map((brandId) => getBrandById(brandId)));
    return brands.filter((brand): brand is BrandRecord => Boolean(brand)).slice(0, limit);
  }

  const scanAllBrands =
    input.scanAllBrands ??
    boolEnv("SOCIAL_DISCOVERY_AUTO_COMMENT_SCAN_ALL_BRANDS", boolEnv("SOCIAL_DISCOVERY_SCAN_ALL_BRANDS", false));
  if (!scanAllBrands) return [];
  return (await listBrands()).slice(0, limit);
}

export async function runSocialDiscoveryAutoCommentDispatchTick(
  options: AutoCommentDispatchOptions = {}
): Promise<AutoCommentDispatchResult> {
  const enabled = boolEnv("SOCIAL_DISCOVERY_AUTO_COMMENT_ENABLED", false);
  const dryRun = Boolean(options.dryRun ?? boolEnv("SOCIAL_DISCOVERY_AUTO_COMMENT_DRY_RUN", false));
  const hourlyCap = numberOption(options.hourlyCap ?? process.env.SOCIAL_DISCOVERY_AUTO_COMMENT_HOURLY_CAP, 10, 1, 100);
  const perRunCap = numberOption(
    options.perRunCap ?? process.env.SOCIAL_DISCOVERY_AUTO_COMMENT_PER_RUN_CAP,
    Math.max(1, Math.ceil(hourlyCap / 12)),
    1,
    hourlyCap
  );
  const perAccountHourlyCap = numberOption(
    options.perAccountHourlyCap ?? process.env.SOCIAL_DISCOVERY_AUTO_COMMENT_PER_ACCOUNT_HOURLY_CAP,
    1,
    1,
    10
  );
  const minSpacingMinutes = numberOption(
    options.minSpacingMinutes ?? process.env.SOCIAL_DISCOVERY_AUTO_COMMENT_MIN_SPACING_MINUTES,
    6,
    1,
    60
  );
  const channelCooldownMinutes = numberOption(
    options.channelCooldownMinutes ?? process.env.SOCIAL_DISCOVERY_AUTO_COMMENT_CHANNEL_COOLDOWN_MINUTES,
    60,
    1,
    1440
  );
  const maxVideoAgeHours = numberOption(
    options.maxVideoAgeHours ?? process.env.SOCIAL_DISCOVERY_AUTO_COMMENT_MAX_VIDEO_AGE_HOURS,
    24,
    1,
    168
  );
  const candidateLimit = numberOption(
    options.candidateLimit ?? process.env.SOCIAL_DISCOVERY_AUTO_COMMENT_CANDIDATE_LIMIT,
    100,
    1,
    500
  );

  const brands = await resolveBrands(options);
  const result: AutoCommentDispatchResult = {
    ok: true,
    enabled,
    dryRun,
    scannedBrands: brands.length,
    hourlyCap,
    perRunCap,
    posted: 0,
    skipped: 0,
    failed: 0,
    results: [],
  };

  if (!enabled && !dryRun) return result;

  const accounts = (await listSocialRoutingAccounts()).filter(isYouTubeAccount);
  for (const brand of brands) {
    if (result.posted >= perRunCap) break;
    const brandResult: AutoCommentDispatchResult["results"][number] = {
      brandId: brand.id,
      brandName: brand.name,
      posted: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };
    result.results.push(brandResult);

    const sinceOneHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = await listSocialDiscoveryCommentedPostsSince({
      brandId: brand.id,
      platform: "youtube",
      since: sinceOneHour,
      limit: 1000,
    });
    const spacingSinceMs = Date.now() - minSpacingMinutes * 60 * 1000;
    const channelSinceMs = Date.now() - channelCooldownMinutes * 60 * 1000;
    const recentPosted = recent.length;
    const latestPostMs = Math.max(
      0,
      ...recent.map((post) => Date.parse(post.commentDelivery?.postedAt ?? "")).filter(Number.isFinite)
    );
    const recentAccountCounts = accountCommentCounts(recent);
    const blockedChannels = recentChannelIds(recent, channelSinceMs);
    let remainingForBrand = Math.max(0, hourlyCap - recentPosted);

    if (!accounts.length) {
      brandResult.skipped += 1;
      result.skipped += 1;
      brandResult.details.push({ skipped: true, reason: "no_youtube_accounts" });
      continue;
    }
    if (remainingForBrand <= 0) {
      brandResult.skipped += 1;
      result.skipped += 1;
      brandResult.details.push({ skipped: true, reason: "hourly_cap_reached" });
      continue;
    }
    if (latestPostMs && latestPostMs > spacingSinceMs) {
      brandResult.skipped += 1;
      result.skipped += 1;
      brandResult.details.push({ skipped: true, reason: "min_spacing_active" });
      continue;
    }

    const candidates = await listSocialDiscoveryAutoCommentCandidates({
      brandId: brand.id,
      limit: candidateLimit,
      maxVideoAgeHours,
    });
    for (const candidate of candidates) {
      if (result.posted >= perRunCap || remainingForBrand <= 0) break;
      const retryReason = retryBlocked(candidate);
      if (retryReason) {
        brandResult.skipped += 1;
        result.skipped += 1;
        brandResult.details.push({ postId: candidate.id, skipped: true, reason: retryReason });
        continue;
      }
      if (youtubeSubscriberCount(candidate) <= MIN_YOUTUBE_AUTO_COMMENT_SUBSCRIBERS) {
        await markDispatchAttempt({ post: candidate, status: "skipped", reason: "subscriber_gate" });
        brandResult.skipped += 1;
        result.skipped += 1;
        brandResult.details.push({ postId: candidate.id, skipped: true, reason: "subscriber_gate" });
        continue;
      }
      const channelId = youtubeChannelId(candidate);
      if (channelId && blockedChannels.has(channelId)) {
        brandResult.skipped += 1;
        result.skipped += 1;
        brandResult.details.push({ postId: candidate.id, skipped: true, reason: "channel_cooldown" });
        continue;
      }

      const { primary, reply } = chooseAccounts({
        post: candidate,
        accounts,
        recentAccountCounts,
        perAccountHourlyCap,
      });
      if (!primary) {
        brandResult.skipped += 1;
        result.skipped += 1;
        brandResult.details.push({ postId: candidate.id, skipped: true, reason: "account_cap_reached" });
        continue;
      }

      try {
        const transcriptPost = await withTranscript(candidate);
        const mode = reply ? "thread" : "solo";
        const drafted = await refreshSocialDiscoveryCommentDraft({
          brand,
          post: transcriptPost,
          force: true,
          mode,
        });
        const [savedDraft] = await saveSocialDiscoveryPosts([drafted]);
        const postToSend = savedDraft ?? drafted;
        const brandName = commentBrandName(brand.name);
        const problem = draftProblem(postToSend, brandName, Boolean(reply));
        if (problem) {
          await markDispatchAttempt({ post: postToSend, status: "failed", reason: problem });
          brandResult.failed += 1;
          result.failed += 1;
          brandResult.details.push({ postId: postToSend.id, failed: true, reason: problem });
          continue;
        }

        const pair = draftPair(postToSend);
        if (dryRun) {
          await markDispatchAttempt({
            post: postToSend,
            status: "dry_run",
            reason: "dry_run",
            details: {
              accountId: primary.id,
              replyAccountId: reply?.id ?? "",
              comment: pair.comment,
              reply: pair.reply,
            },
          });
          brandResult.skipped += 1;
          result.skipped += 1;
          brandResult.details.push({ postId: postToSend.id, dryRun: true, accountId: primary.id, replyAccountId: reply?.id ?? "" });
          continue;
        }

        const delivery = await deliverSocialDiscoveryComment({
          brand,
          brandId: brand.id,
          postId: postToSend.id,
          text: pair.comment,
          requestedAccountId: primary.id,
          replyText: reply ? pair.reply : undefined,
          replyAccountId: reply ? reply.id : undefined,
        });
        await markDispatchAttempt({
          post: delivery.post,
          status: "posted",
          reason: "posted",
          details: {
            accountId: delivery.account.id,
            commentId: delivery.result.commentId,
            replyAccountId: reply?.id ?? "",
          },
        });
        recentAccountCounts.set(primary.id, (recentAccountCounts.get(primary.id) ?? 0) + 1);
        if (reply) recentAccountCounts.set(reply.id, (recentAccountCounts.get(reply.id) ?? 0) + 1);
        if (channelId) blockedChannels.add(channelId);
        remainingForBrand -= 1;
        result.posted += 1;
        brandResult.posted += 1;
        brandResult.details.push({
          postId: delivery.post.id,
          posted: true,
          accountId: delivery.account.id,
          commentId: delivery.result.commentId,
          replyAccountId: reply?.id ?? "",
        });
      } catch (error) {
        const message =
          error instanceof SocialCommentDeliveryError || isPlatformDeliveryError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : "auto comment dispatch failed";
        await markDispatchAttempt({
          post: candidate,
          status: "failed",
          reason: message,
          details: error instanceof SocialCommentDeliveryError ? error.details : {},
        });
        brandResult.failed += 1;
        result.failed += 1;
        brandResult.details.push({ postId: candidate.id, failed: true, reason: message });
      }
    }
  }

  return result;
}
