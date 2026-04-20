import { getBrandById, type BrandRecord } from "@/lib/factory-data";
import { enrichSocialPostsWithAccountRouting } from "@/lib/social-account-routing";
import {
  getSocialDiscoveryPost,
  listSocialDiscoveryPostsWithPendingReplies,
  updateSocialDiscoveryPostCommentDelivery,
  updateSocialDiscoveryPostPendingReply,
  updateSocialDiscoveryPostPromotionDraft,
  updateSocialDiscoveryPostPromotionPurchase,
  updateSocialDiscoveryPostStatus,
} from "@/lib/social-discovery-data";
import { hasBuyShazamUiWorkerConfig, runBuyShazamWorkerPurchase } from "@/lib/buyshazam-ui-worker-client";
import { runBuyShazamCommentLikesPurchase } from "@/lib/buyshazam-ui-purchase";
import {
  buildSocialDiscoveryCommentPromotionDraft,
  buildSocialDiscoveryPromotionDraft,
  isBuyShazamCommentLikesDestinationUrl,
} from "@/lib/social-discovery-promotion";
import { getOutreachAccount, getOutreachAccountSecrets, updateOutreachAccount } from "@/lib/outreach-data";
import { sendUnipilePostComment, supportsUnipilePostComments, UnipileApiError } from "@/lib/unipile";
import { sendYouTubeVideoComment, supportsYouTubePostComments, hasYouTubeOAuthCredentials, YouTubeApiError, buildYouTubeCommentUrl } from "@/lib/youtube";
import type {
  SocialDiscoveryCommentDelivery,
  SocialDiscoveryPendingReply,
  SocialDiscoveryPost,
  SocialDiscoveryPromotionDraft,
  SocialDiscoveryPromotionPurchase,
} from "@/lib/social-discovery-types";

type ResolvedAccount = {
  id: string;
  name: string;
  provider: string;
  externalAccountId: string;
  handle: string;
};

type DeliveryResultPayload = {
  lookupId: string;
  resolvedPostId: string;
  commentId: string;
  commentUrl: string;
  verified: boolean;
  deliveryStatus: "verified" | "accepted_unverified";
  deliverySource: "comments_list" | "response" | "none";
  deliveryMessage: string;
  verificationError: Record<string, unknown> | null;
  response: Record<string, unknown>;
};

export type SocialDiscoveryCommentDeliveryOutcome = {
  post: SocialDiscoveryPost;
  promotionDraft: SocialDiscoveryPromotionDraft;
  promotionPurchase: SocialDiscoveryPromotionPurchase | null;
  account: ResolvedAccount;
  result: DeliveryResultPayload;
  reply?: {
    account: ResolvedAccount;
    result: DeliveryResultPayload;
  };
  replyError?: {
    message: string;
    status: number;
    details: Record<string, unknown>;
  };
};

export class SocialCommentDeliveryError extends Error {
  status: number;
  details: Record<string, unknown>;

  constructor(message: string, input: { status?: number; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "SocialCommentDeliveryError";
    this.status = input.status ?? 500;
    this.details = input.details ?? {};
  }
}

const MIN_DELAYED_REPLY_MINUTES = 60;
const MAX_DELAYED_REPLY_MINUTES = 360;
const RETRY_DELAY_MINUTES = 60;
const MAX_DELAYED_REPLY_ATTEMPTS = 3;

function accountConnectionProviderForPost(post: Pick<SocialDiscoveryPost, "platform">) {
  if (supportsYouTubePostComments(post.platform)) return "youtube";
  if (supportsUnipilePostComments(post.platform)) return "unipile";
  return "none";
}

function buildInstagramCommentUrl(post: Pick<SocialDiscoveryPost, "platform" | "url">, commentId: string) {
  const trimmedCommentId = commentId.trim();
  if (post.platform !== "instagram" || !trimmedCommentId || !post.url.trim()) return "";
  try {
    const url = new URL(post.url.trim());
    url.searchParams.set("comment_id", trimmedCommentId);
    return url.toString();
  } catch {
    const separator = post.url.includes("?") ? "&" : "?";
    return `${post.url}${separator}comment_id=${encodeURIComponent(trimmedCommentId)}`;
  }
}

function promotionDraftForComment(input: {
  brand: Pick<BrandRecord, "name" | "website" | "product">;
  post: SocialDiscoveryPost;
}) {
  return input.post.platform === "instagram"
    ? buildSocialDiscoveryCommentPromotionDraft(input)
    : buildSocialDiscoveryPromotionDraft(input);
}

async function resolveSelectedAccount(input: {
  brand: BrandRecord;
  post: SocialDiscoveryPost;
  requestedAccountId?: string;
}) {
  const requiredProvider = accountConnectionProviderForPost(input.post);
  if (requiredProvider === "none") {
    throw new SocialCommentDeliveryError(`Comment delivery is not supported for ${input.post.platform}.`, { status: 400 });
  }

  const [routedPost] = await enrichSocialPostsWithAccountRouting({ brand: input.brand, posts: [input.post] });
  const recommendedAccounts =
    routedPost?.interactionPlan.recommendedAccounts?.filter(
      (entry) =>
        entry.useCase === "primary_comment" &&
        entry.connectionProvider === requiredProvider &&
        (requiredProvider === "youtube" || entry.externalAccountId)
    ) ?? [];
  const selectedRecommendation = input.requestedAccountId
    ? recommendedAccounts.find((entry) => entry.accountId === input.requestedAccountId) ?? null
    : recommendedAccounts[0] ?? null;
  const selectedAccountId = input.requestedAccountId || selectedRecommendation?.accountId || "";

  if (!selectedAccountId) {
    const providerName = requiredProvider === "youtube" ? "YouTube OAuth" : "Unipile";
    throw new SocialCommentDeliveryError(
      `No routed ${providerName} account is available for this post. Configure a social-enabled ${providerName} account first.`,
      { status: 400 }
    );
  }

  const account = await getOutreachAccount(selectedAccountId);
  if (!account) {
    throw new SocialCommentDeliveryError("outreach account not found", { status: 404 });
  }
  if (account.status !== "active") {
    throw new SocialCommentDeliveryError("selected outreach account is inactive", { status: 400 });
  }
  if (!account.config.social.enabled) {
    throw new SocialCommentDeliveryError("selected outreach account is not enabled for social routing", { status: 400 });
  }
  if (account.config.social.connectionProvider !== requiredProvider) {
    throw new SocialCommentDeliveryError(
      requiredProvider === "youtube"
        ? "selected outreach account is not connected through YouTube OAuth"
        : "selected outreach account is not connected through Unipile",
      { status: 400 }
    );
  }
  if (requiredProvider === "unipile" && !account.config.social.externalAccountId.trim()) {
    throw new SocialCommentDeliveryError("selected outreach account is missing its Unipile account id", { status: 400 });
  }

  return {
    account,
    resolvedAccount: {
      id: account.id,
      name: account.name,
      provider: account.provider,
      externalAccountId: account.config.social.externalAccountId.trim(),
      handle: account.config.social.handle.trim(),
    } satisfies ResolvedAccount,
  };
}

function addMinutes(value: string, minutes: number) {
  const parsed = Date.parse(value);
  const base = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(base + minutes * 60 * 1000).toISOString();
}

function randomIntInclusive(min: number, max: number) {
  const safeMin = Math.ceil(min);
  const safeMax = Math.floor(max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

async function recordSocialCommentActivity(account: Awaited<ReturnType<typeof getOutreachAccount>>) {
  if (!account) return;
  const now = new Date().toISOString();
  await updateOutreachAccount(account.id, {
    config: {
      social: {
        recentActivity24h: (account.config.social.recentActivity24h ?? 0) + 1,
        recentActivity7d: (account.config.social.recentActivity7d ?? 0) + 1,
        lastSocialCommentAt: now,
      },
    },
  });
}

async function deliverPlatformComment(input: {
  post: SocialDiscoveryPost;
  text: string;
  account: NonNullable<Awaited<ReturnType<typeof getOutreachAccount>>>;
  resolvedAccount: ResolvedAccount;
  requestedCommentId?: string;
}) {
  let platformResult:
    | Awaited<ReturnType<typeof sendUnipilePostComment>>
    | Awaited<ReturnType<typeof sendYouTubeVideoComment>>;
  let deliveredCommentId = "";
  let deliveredCommentUrl = "";
  let deliverySource: DeliveryResultPayload["deliverySource"] = "none";
  let deliveryStatus: DeliveryResultPayload["deliveryStatus"] = "accepted_unverified";
  let deliveryMessage = "";
  let verificationError: Record<string, unknown> | null = null;

  if (supportsYouTubePostComments(input.post.platform)) {
    const secrets = await getOutreachAccountSecrets(input.account.id);
    if (!secrets || !hasYouTubeOAuthCredentials(secrets)) {
      throw new SocialCommentDeliveryError(
        "selected outreach account is missing YouTube OAuth credentials",
        { status: 400 }
      );
    }
    const youtubeResult = await sendYouTubeVideoComment({
      post: input.post,
      text: input.text,
      secrets,
      commentId: input.requestedCommentId,
    });
    platformResult = youtubeResult;
    deliveredCommentId = youtubeResult.delivery.commentId.trim();
    deliveredCommentUrl = buildYouTubeCommentUrl(youtubeResult.videoId, deliveredCommentId);
    deliverySource = youtubeResult.delivery.source;
    deliveryStatus = youtubeResult.delivery.status;
    deliveryMessage = youtubeResult.delivery.message;
  } else {
    const unipileResult = await sendUnipilePostComment({
      post: input.post,
      accountId: input.account.config.social.externalAccountId.trim(),
      text: input.text,
      commentId: input.requestedCommentId,
    });
    platformResult = unipileResult;
    deliveredCommentId =
      unipileResult.delivery.commentId ||
      String(unipileResult.payload.id ?? "").trim() ||
      String((unipileResult.payload.comment as Record<string, unknown> | undefined)?.id ?? "").trim();
    deliveredCommentUrl = buildInstagramCommentUrl(input.post, deliveredCommentId);
    deliverySource = unipileResult.delivery.source;
    deliveryStatus = unipileResult.delivery.status;
    deliveryMessage = unipileResult.delivery.message;
    verificationError = unipileResult.delivery.verificationError ?? null;
  }

  await recordSocialCommentActivity(input.account);

  const now = new Date().toISOString();
  const delivery: SocialDiscoveryCommentDelivery = {
    commentId: deliveredCommentId,
    commentUrl: deliveredCommentUrl,
    status: deliveryStatus,
    source: deliverySource,
    message: deliveryMessage,
    postedAt: now,
    accountId: input.account.id,
    accountName: input.account.name,
    accountHandle: input.resolvedAccount.handle,
  };

  return {
    delivery,
    result: {
      lookupId: String(platformResult.lookupId ?? "").trim(),
      resolvedPostId: String(platformResult.resolvedPostId ?? "").trim(),
      commentId: deliveredCommentId,
      commentUrl: deliveredCommentUrl,
      verified: deliveryStatus === "verified",
      deliveryStatus,
      deliverySource,
      deliveryMessage,
      verificationError,
      response: platformResult.payload,
    } satisfies DeliveryResultPayload,
  };
}

async function persistCommentDelivery(input: {
  brand: BrandRecord;
  brandId: string;
  post: SocialDiscoveryPost;
  commentDelivery: SocialDiscoveryCommentDelivery;
}) {
  const nextStatus = input.commentDelivery.status === "verified" ? "triaged" : "saved";
  const updatedPost =
    (await updateSocialDiscoveryPostCommentDelivery({
      id: input.post.id,
      brandId: input.brandId,
      status: nextStatus,
      commentDelivery: input.commentDelivery,
    })) ??
    (await updateSocialDiscoveryPostStatus({
      id: input.post.id,
      brandId: input.brandId,
      status: nextStatus,
    })) ??
    input.post;
  const postWithCommentDelivery = {
    ...updatedPost,
    commentDelivery: input.commentDelivery,
  };
  const promotionDraft = promotionDraftForComment({
    brand: input.brand,
    post: postWithCommentDelivery,
  });
  const postWithPromotionDraft =
    (await updateSocialDiscoveryPostPromotionDraft({
      id: postWithCommentDelivery.id,
      brandId: input.brandId,
      promotionDraft,
    })) ??
    {
      ...postWithCommentDelivery,
      promotionDraft,
    };
  const promotionPurchase =
    input.post.platform === "instagram" && isBuyShazamCommentLikesDestinationUrl(promotionDraft.destinationUrl)
      ? await (hasBuyShazamUiWorkerConfig()
          ? runBuyShazamWorkerPurchase({
              productUrl: promotionDraft.destinationUrl,
              commentUrl: input.commentDelivery.commentUrl,
            })
          : runBuyShazamCommentLikesPurchase({
              productUrl: promotionDraft.destinationUrl,
              commentUrl: input.commentDelivery.commentUrl,
            }))
      : null;
  const postWithPromotionPurchase =
    promotionPurchase
      ? ((await updateSocialDiscoveryPostPromotionPurchase({
          id: postWithPromotionDraft.id,
          brandId: input.brandId,
          promotionPurchase,
        })) ??
        {
          ...postWithPromotionDraft,
          promotionPurchase,
        })
      : postWithPromotionDraft;
  const [routedUpdatedPost] = await enrichSocialPostsWithAccountRouting({
    brand: input.brand,
    posts: [postWithPromotionPurchase],
  });

  return {
    post: routedUpdatedPost ?? postWithPromotionPurchase,
    promotionDraft,
    promotionPurchase,
  };
}

async function persistPendingReply(input: {
  post: SocialDiscoveryPost;
  brandId: string;
  pendingReply: SocialDiscoveryPendingReply | null;
}) {
  return (
    (await updateSocialDiscoveryPostPendingReply({
      id: input.post.id,
      brandId: input.brandId,
      pendingReply: input.pendingReply,
    })) ??
    {
      ...input.post,
      pendingReply: input.pendingReply ?? undefined,
    }
  );
}

export async function deliverSocialDiscoveryComment(input: {
  brand: BrandRecord;
  brandId: string;
  postId: string;
  text: string;
  requestedAccountId?: string;
  requestedCommentId?: string;
  replyText?: string;
  replyAccountId?: string;
}) : Promise<SocialDiscoveryCommentDeliveryOutcome> {
  const storedPost = await getSocialDiscoveryPost({ id: input.postId, brandId: input.brandId });
  if (!storedPost) {
    throw new SocialCommentDeliveryError("social discovery post not found", { status: 404 });
  }

  const { account, resolvedAccount } = await resolveSelectedAccount({
    brand: input.brand,
    post: storedPost,
    requestedAccountId: input.requestedAccountId,
  });
  const topLevel = await deliverPlatformComment({
    post: storedPost,
    text: input.text,
    account,
    resolvedAccount,
    requestedCommentId: input.requestedCommentId,
  });
  let commentDelivery = topLevel.delivery;
  let reply:
    | {
        account: ResolvedAccount;
        result: DeliveryResultPayload;
      }
    | undefined;
  let pendingReply: SocialDiscoveryPendingReply | null = null;
  let replyError:
    | {
        message: string;
        status: number;
        details: Record<string, unknown>;
      }
    | undefined;

  const replyText = String(input.replyText ?? "").trim();
  const replyAccountId = String(input.replyAccountId ?? "").trim();
  if (replyText) {
    if (!replyAccountId) {
      throw new SocialCommentDeliveryError("Pick a second account before sending a reply.", { status: 400 });
    }
    if (replyAccountId === account.id) {
      throw new SocialCommentDeliveryError("Pick a different account for the teammate reply.", { status: 400 });
    }
    if (!topLevel.delivery.commentId.trim()) {
      replyError = {
        message: "Top-level comment posted, but YouTube did not return a comment id, so the teammate reply was skipped.",
        status: 409,
        details: {},
      };
    } else {
      try {
        const { account: replyAccount, resolvedAccount: resolvedReplyAccount } = await resolveSelectedAccount({
          brand: input.brand,
          post: storedPost,
          requestedAccountId: replyAccountId,
        });
        if (supportsYouTubePostComments(storedPost.platform)) {
          const scheduledAt = addMinutes(
            topLevel.delivery.postedAt || new Date().toISOString(),
            randomIntInclusive(MIN_DELAYED_REPLY_MINUTES, MAX_DELAYED_REPLY_MINUTES)
          );
          pendingReply = {
            parentCommentId: topLevel.delivery.commentId,
            text: replyText,
            accountId: replyAccount.id,
            accountName: replyAccount.name,
            accountHandle: resolvedReplyAccount.handle,
            scheduledAt,
            createdAt: new Date().toISOString(),
            attempts: 0,
            status: "scheduled",
          };
        } else {
          const replyDelivery = await deliverPlatformComment({
            post: storedPost,
            text: replyText,
            account: replyAccount,
            resolvedAccount: resolvedReplyAccount,
            requestedCommentId: topLevel.delivery.commentId,
          });
          commentDelivery = {
            ...topLevel.delivery,
            replyDelivery: replyDelivery.delivery,
          };
          reply = {
            account: resolvedReplyAccount,
            result: replyDelivery.result,
          };
        }
      } catch (error) {
        if (isPlatformDeliveryError(error)) {
          replyError = {
            message: error.message,
            status: error.status,
            details: error.details,
          };
        } else {
          throw error;
        }
      }
    }
  }

  const persisted = await persistCommentDelivery({
    brand: input.brand,
    brandId: input.brandId,
    post: storedPost,
    commentDelivery,
  });
  const postWithPendingReply = await persistPendingReply({
    post: persisted.post,
    brandId: input.brandId,
    pendingReply,
  });

  return {
    post: postWithPendingReply,
    promotionDraft: persisted.promotionDraft,
    promotionPurchase: persisted.promotionPurchase,
    account: resolvedAccount,
    result: topLevel.result,
    reply,
    replyError,
  };
}

export function isPlatformDeliveryError(
  error: unknown
): error is SocialCommentDeliveryError | UnipileApiError | YouTubeApiError {
  return (
    error instanceof SocialCommentDeliveryError ||
    error instanceof UnipileApiError ||
    error instanceof YouTubeApiError
  );
}

export async function sendScheduledSocialDiscoveryReply(input: {
  brand: BrandRecord;
  brandId: string;
  postId: string;
}) {
  const post = await getSocialDiscoveryPost({ id: input.postId, brandId: input.brandId });
  if (!post?.pendingReply) {
    throw new SocialCommentDeliveryError("No scheduled teammate reply found for this post.", { status: 404 });
  }
  if (!post.commentDelivery?.commentId.trim()) {
    throw new SocialCommentDeliveryError("Top-level comment id missing for scheduled teammate reply.", { status: 409 });
  }

  const pending = post.pendingReply;
  const { account, resolvedAccount } = await resolveSelectedAccount({
    brand: input.brand,
    post,
    requestedAccountId: pending.accountId,
  });
  const replyDelivery = await deliverPlatformComment({
    post,
    text: pending.text,
    account,
    resolvedAccount,
    requestedCommentId: pending.parentCommentId || post.commentDelivery.commentId,
  });
  const commentDelivery: SocialDiscoveryCommentDelivery = {
    ...(post.commentDelivery ?? {
      commentId: "",
      commentUrl: "",
      status: "",
      source: "",
      message: "",
      postedAt: "",
      accountId: "",
      accountName: "",
      accountHandle: "",
    }),
    replyDelivery: replyDelivery.delivery,
  };
  const nextStatus = replyDelivery.delivery.status === "verified" ? "triaged" : post.status;
  const updatedPost =
    (await updateSocialDiscoveryPostCommentDelivery({
      id: post.id,
      brandId: input.brandId,
      status: nextStatus,
      commentDelivery,
    })) ?? { ...post, commentDelivery, status: nextStatus };
  const clearedPost = await persistPendingReply({
    post: updatedPost,
    brandId: input.brandId,
    pendingReply: null,
  });

  return {
    post: clearedPost,
    account: resolvedAccount,
    result: replyDelivery.result,
  };
}

export async function runSocialDiscoveryDelayedReplyTick(input: {
  brandIds?: string[];
  limit?: number;
  dryRun?: boolean;
}) {
  const dryRun = Boolean(input.dryRun);
  const duePosts = await listSocialDiscoveryPostsWithPendingReplies({
    brandIds: input.brandIds,
    limit: input.limit,
    dueBefore: new Date().toISOString(),
  });
  const processed = [];

  for (const post of duePosts) {
    const pending = post.pendingReply;
    if (!pending) continue;
    const brand = await getBrandById(post.brandId);
    if (!brand) {
      processed.push({
        brandId: post.brandId,
        postId: post.id,
        scheduledAt: pending.scheduledAt,
        accountId: pending.accountId,
        status: "error",
        error: "brand not found",
      });
      continue;
    }

    if (dryRun) {
      processed.push({
        brandId: post.brandId,
        postId: post.id,
        scheduledAt: pending.scheduledAt,
        accountId: pending.accountId,
        status: "eligible",
        error: "",
      });
      continue;
    }

    try {
      const sent = await sendScheduledSocialDiscoveryReply({
        brand,
        brandId: post.brandId,
        postId: post.id,
      });
      processed.push({
        brandId: post.brandId,
        postId: post.id,
        scheduledAt: pending.scheduledAt,
        accountId: pending.accountId,
        status: "sent",
        error: "",
        commentId: sent.result.commentId,
      });
    } catch (error) {
      const attempts = (pending.attempts ?? 0) + 1;
      const failedPending: SocialDiscoveryPendingReply = {
        ...pending,
        attempts,
        lastAttemptAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : "Failed to send scheduled teammate reply",
        scheduledAt:
          attempts >= MAX_DELAYED_REPLY_ATTEMPTS
            ? pending.scheduledAt
            : addMinutes(new Date().toISOString(), RETRY_DELAY_MINUTES),
        status: attempts >= MAX_DELAYED_REPLY_ATTEMPTS ? "failed" : "scheduled",
      };
      await persistPendingReply({
        post,
        brandId: post.brandId,
        pendingReply: failedPending,
      });
      processed.push({
        brandId: post.brandId,
        postId: post.id,
        scheduledAt: pending.scheduledAt,
        accountId: pending.accountId,
        status: attempts >= MAX_DELAYED_REPLY_ATTEMPTS ? "failed" : "retry_scheduled",
        error: error instanceof Error ? error.message : "Failed to send scheduled teammate reply",
      });
    }
  }

  return {
    ok: true,
    dryRun,
    dueCount: duePosts.length,
    processedCount: processed.length,
    sentCount: processed.filter((row) => row.status === "sent").length,
    retryCount: processed.filter((row) => row.status === "retry_scheduled").length,
    failedCount: processed.filter((row) => row.status === "failed" || row.status === "error").length,
    processed,
  };
}
