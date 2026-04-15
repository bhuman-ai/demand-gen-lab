import { createId, getBrandById, listBrands, updateBrand } from "@/lib/factory-data";
import type { BrandRecord, SocialDiscoveryYouTubeSubscription } from "@/lib/factory-types";
import { getOutreachAccount, getOutreachAccountSecrets } from "@/lib/outreach-data";
import { getAppUrl } from "@/lib/app-url";
import {
  hasYouTubeOAuthCredentials,
  requestYouTubeUploadSubscription,
  youtubeTopicUrl,
} from "@/lib/youtube";

export const DEFAULT_YOUTUBE_SUBSCRIPTION_LEASE_SECONDS = 5 * 24 * 60 * 60;
export const YOUTUBE_SUBSCRIPTION_RENEW_WINDOW_MS = 12 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function clampLeaseSeconds(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_YOUTUBE_SUBSCRIPTION_LEASE_SECONDS;
  return Math.max(60, Math.round(parsed));
}

function webhookToken() {
  return String(process.env.YOUTUBE_WEBSUB_TOKEN ?? process.env.AUTH_SESSION_SECRET ?? "").trim();
}

function futureIsoFromSeconds(seconds: number) {
  if (!seconds || seconds <= 0) return "";
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function normalizeChannelId(value: unknown) {
  return String(value ?? "").trim();
}

function buildSubscriptionRecord(input: {
  existing?: SocialDiscoveryYouTubeSubscription | null;
  channelId: string;
  channelTitle?: string;
  accountId?: string;
  accountName?: string;
  autoComment: boolean;
  leaseSeconds: number;
  callbackUrl: string;
  topicUrl: string;
  status: SocialDiscoveryYouTubeSubscription["status"];
  lastSubscribeRequestedAt?: string;
  lastVerifiedAt?: string;
  leaseExpiresAt?: string;
  lastNotificationAt?: string;
  lastVideoId?: string;
  lastVideoUrl?: string;
  lastCommentId?: string;
  lastCommentUrl?: string;
  lastError?: string;
}) {
  const existing = input.existing ?? null;
  return {
    id: existing?.id || createId("ytsub"),
    channelId: input.channelId,
    channelTitle: String(input.channelTitle ?? existing?.channelTitle ?? "").trim(),
    accountId: String(input.accountId ?? existing?.accountId ?? "").trim(),
    accountName: String(input.accountName ?? existing?.accountName ?? "").trim(),
    autoComment: Boolean(input.autoComment),
    leaseSeconds: clampLeaseSeconds(input.leaseSeconds || existing?.leaseSeconds),
    leaseExpiresAt: String(input.leaseExpiresAt ?? existing?.leaseExpiresAt ?? "").trim(),
    status: input.status,
    callbackUrl: String(input.callbackUrl ?? existing?.callbackUrl ?? "").trim(),
    topicUrl: String(input.topicUrl ?? existing?.topicUrl ?? "").trim(),
    lastSubscribeRequestedAt: String(
      input.lastSubscribeRequestedAt ?? existing?.lastSubscribeRequestedAt ?? ""
    ).trim(),
    lastVerifiedAt: String(input.lastVerifiedAt ?? existing?.lastVerifiedAt ?? "").trim(),
    lastNotificationAt: String(input.lastNotificationAt ?? existing?.lastNotificationAt ?? "").trim(),
    lastVideoId: String(input.lastVideoId ?? existing?.lastVideoId ?? "").trim(),
    lastVideoUrl: String(input.lastVideoUrl ?? existing?.lastVideoUrl ?? "").trim(),
    lastCommentId: String(input.lastCommentId ?? existing?.lastCommentId ?? "").trim(),
    lastCommentUrl: String(input.lastCommentUrl ?? existing?.lastCommentUrl ?? "").trim(),
    lastError: String(input.lastError ?? existing?.lastError ?? "").trim(),
  } satisfies SocialDiscoveryYouTubeSubscription;
}

function upsertSubscriptionList(
  subscriptions: SocialDiscoveryYouTubeSubscription[],
  nextSubscription: SocialDiscoveryYouTubeSubscription
) {
  const next = subscriptions.slice();
  const index = next.findIndex(
    (entry) => entry.id === nextSubscription.id || entry.channelId === nextSubscription.channelId
  );
  if (index >= 0) next[index] = nextSubscription;
  else next.unshift(nextSubscription);
  return next;
}

async function saveSubscriptions(
  brandId: string,
  subscriptions: SocialDiscoveryYouTubeSubscription[]
) {
  const updated = await updateBrand(brandId, {
    socialDiscoveryYouTubeSubscriptions: subscriptions,
  });
  if (!updated) {
    throw new Error("brand not found");
  }
  return updated.socialDiscoveryYouTubeSubscriptions;
}

async function resolveYouTubeAccount(input: {
  accountId?: string;
  autoComment: boolean;
}) {
  const accountId = String(input.accountId ?? "").trim();
  if (!accountId) {
    if (input.autoComment) {
      throw new Error("Pick a YouTube OAuth account before enabling auto comment.");
    }
    return { accountId: "", accountName: "" };
  }

  const account = await getOutreachAccount(accountId);
  if (!account) throw new Error("selected outreach account not found");
  if (account.status !== "active") throw new Error("selected outreach account is inactive");
  if (!account.config.social.enabled) {
    throw new Error("selected outreach account is not enabled for social routing");
  }
  if (account.config.social.connectionProvider !== "youtube") {
    throw new Error("selected outreach account is not connected through YouTube OAuth");
  }
  if (!account.config.social.platforms.includes("youtube")) {
    throw new Error("selected outreach account is not enabled for YouTube");
  }

  if (input.autoComment) {
    const secrets = await getOutreachAccountSecrets(account.id);
    if (!secrets || !hasYouTubeOAuthCredentials(secrets)) {
      throw new Error("selected outreach account is missing YouTube OAuth credentials");
    }
  }

  return {
    accountId: account.id,
    accountName: account.name,
  };
}

export function buildYouTubeSubscriptionCallbackUrl(input: {
  brandId: string;
  channelId: string;
  accountId?: string;
  autoComment: boolean;
}) {
  const callbackUrl = new URL(
    `${getAppUrl()}/api/webhooks/youtube/uploads/${encodeURIComponent(input.brandId)}`
  );
  const token = webhookToken();
  if (token) callbackUrl.searchParams.set("token", token);
  callbackUrl.searchParams.set("channelId", normalizeChannelId(input.channelId));
  if (String(input.accountId ?? "").trim()) {
    callbackUrl.searchParams.set("accountId", String(input.accountId).trim());
  }
  if (input.autoComment) {
    callbackUrl.searchParams.set("autoComment", "1");
  }
  return callbackUrl.toString();
}

export async function listBrandYouTubeSubscriptions(brandId: string) {
  const brand = await getBrandById(brandId);
  if (!brand) throw new Error("brand not found");
  return brand.socialDiscoveryYouTubeSubscriptions;
}

export async function subscribeBrandToYouTubeChannel(input: {
  brandId: string;
  channelId: string;
  accountId?: string;
  autoComment?: boolean;
  leaseSeconds?: number;
}) {
  const brand = await getBrandById(input.brandId);
  if (!brand) throw new Error("brand not found");

  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) throw new Error("channelId is required");

  const autoComment = input.autoComment !== false;
  const leaseSeconds = clampLeaseSeconds(input.leaseSeconds);
  const account = await resolveYouTubeAccount({
    accountId: input.accountId,
    autoComment,
  });
  const callbackUrl = buildYouTubeSubscriptionCallbackUrl({
    brandId: brand.id,
    channelId,
    accountId: account.accountId,
    autoComment,
  });
  const topicUrl = youtubeTopicUrl(channelId);
  const existing =
    brand.socialDiscoveryYouTubeSubscriptions.find((entry) => entry.channelId === channelId) ?? null;
  const subscribeRequestedAt = nowIso();

  const pendingRecord = buildSubscriptionRecord({
    existing,
    channelId,
    accountId: account.accountId,
    accountName: account.accountName,
    autoComment,
    leaseSeconds,
    callbackUrl,
    topicUrl,
    status: "pending",
    lastSubscribeRequestedAt: subscribeRequestedAt,
    leaseExpiresAt: futureIsoFromSeconds(leaseSeconds),
    lastError: "",
  });

  const pendingList = await saveSubscriptions(
    brand.id,
    upsertSubscriptionList(brand.socialDiscoveryYouTubeSubscriptions, pendingRecord)
  );

  try {
    const subscription = await requestYouTubeUploadSubscription({
      channelId,
      callbackUrl,
      mode: "subscribe",
      leaseSeconds,
    });
    const current =
      pendingList.find((entry) => entry.channelId === channelId || entry.id === pendingRecord.id) ??
      pendingRecord;
    const refreshedStatus =
      existing?.status === "active" && current.status === "pending"
        ? "active"
        : current.status;
    const refreshed = buildSubscriptionRecord({
      existing: current,
      channelId,
      accountId: account.accountId,
      accountName: account.accountName,
      autoComment,
      leaseSeconds,
      callbackUrl,
      topicUrl,
      status: refreshedStatus,
      lastSubscribeRequestedAt: subscribeRequestedAt,
      leaseExpiresAt: current.leaseExpiresAt || futureIsoFromSeconds(leaseSeconds),
      lastError: "",
    });
    const subscriptions = await saveSubscriptions(
      brand.id,
      upsertSubscriptionList(pendingList, refreshed)
    );
    return {
      brandId: brand.id,
      brandName: brand.name,
      subscription,
      record: subscriptions.find((entry) => entry.id === refreshed.id) ?? refreshed,
      subscriptions,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed to request YouTube subscription";
    const failedRecord = buildSubscriptionRecord({
      existing: pendingRecord,
      channelId,
      accountId: account.accountId,
      accountName: account.accountName,
      autoComment,
      leaseSeconds,
      callbackUrl,
      topicUrl,
      status: "error",
      lastSubscribeRequestedAt: subscribeRequestedAt,
      leaseExpiresAt: pendingRecord.leaseExpiresAt,
      lastError: errorMessage,
    });
    await saveSubscriptions(brand.id, upsertSubscriptionList(pendingList, failedRecord));
    throw error;
  }
}

export async function unsubscribeBrandFromYouTubeChannel(input: {
  brandId: string;
  channelId: string;
}) {
  const brand = await getBrandById(input.brandId);
  if (!brand) throw new Error("brand not found");

  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) throw new Error("channelId is required");

  const existing =
    brand.socialDiscoveryYouTubeSubscriptions.find((entry) => entry.channelId === channelId) ?? null;
  if (!existing) throw new Error("subscription not found");

  await requestYouTubeUploadSubscription({
    channelId,
    callbackUrl:
      existing.callbackUrl ||
      buildYouTubeSubscriptionCallbackUrl({
        brandId: brand.id,
        channelId,
        accountId: existing.accountId,
        autoComment: existing.autoComment,
      }),
    mode: "unsubscribe",
    leaseSeconds: existing.leaseSeconds || DEFAULT_YOUTUBE_SUBSCRIPTION_LEASE_SECONDS,
  });

  const subscriptions = await saveSubscriptions(
    brand.id,
    brand.socialDiscoveryYouTubeSubscriptions.filter((entry) => entry.channelId !== channelId)
  );
  return {
    brandId: brand.id,
    brandName: brand.name,
    channelId,
    subscriptions,
  };
}

export async function markBrandYouTubeSubscriptionVerified(input: {
  brandId: string;
  channelId: string;
  leaseSeconds?: number;
  topicUrl?: string;
}) {
  const brand = await getBrandById(input.brandId);
  if (!brand) return null;

  const existing =
    brand.socialDiscoveryYouTubeSubscriptions.find(
      (entry) => entry.channelId === normalizeChannelId(input.channelId)
    ) ?? null;
  if (!existing) return null;

  const leaseSeconds = clampLeaseSeconds(input.leaseSeconds || existing.leaseSeconds);
  const verifiedRecord = buildSubscriptionRecord({
    existing,
    channelId: existing.channelId,
    autoComment: existing.autoComment,
    leaseSeconds,
    callbackUrl: existing.callbackUrl,
    topicUrl: String(input.topicUrl ?? existing.topicUrl ?? youtubeTopicUrl(existing.channelId)).trim(),
    status: "active",
    lastVerifiedAt: nowIso(),
    leaseExpiresAt: futureIsoFromSeconds(leaseSeconds),
    lastError: "",
  });

  const subscriptions = await saveSubscriptions(
    brand.id,
    upsertSubscriptionList(brand.socialDiscoveryYouTubeSubscriptions, verifiedRecord)
  );
  return subscriptions.find((entry) => entry.id === verifiedRecord.id) ?? verifiedRecord;
}

export async function recordBrandYouTubeSubscriptionWebhookActivity(input: {
  brandId: string;
  channelId: string;
  channelTitle?: string;
  videoId?: string;
  videoUrl?: string;
  commentId?: string;
  commentUrl?: string;
  error?: string;
}) {
  const brand = await getBrandById(input.brandId);
  if (!brand) return null;

  const existing =
    brand.socialDiscoveryYouTubeSubscriptions.find(
      (entry) => entry.channelId === normalizeChannelId(input.channelId)
    ) ?? null;
  if (!existing) return null;

  const nextRecord = buildSubscriptionRecord({
    existing,
    channelId: existing.channelId,
    channelTitle: input.channelTitle ?? existing.channelTitle,
    autoComment: existing.autoComment,
    leaseSeconds: existing.leaseSeconds,
    callbackUrl: existing.callbackUrl,
    topicUrl: existing.topicUrl,
    status: input.error ? "error" : existing.status === "pending" ? "active" : existing.status,
    lastNotificationAt: nowIso(),
    lastVideoId: input.videoId ?? existing.lastVideoId,
    lastVideoUrl: input.videoUrl ?? existing.lastVideoUrl,
    lastCommentId: input.commentId ?? existing.lastCommentId,
    lastCommentUrl: input.commentUrl ?? existing.lastCommentUrl,
    lastError: String(input.error ?? "").trim(),
  });

  const subscriptions = await saveSubscriptions(
    brand.id,
    upsertSubscriptionList(brand.socialDiscoveryYouTubeSubscriptions, nextRecord)
  );
  return subscriptions.find((entry) => entry.id === nextRecord.id) ?? nextRecord;
}

export function youtubeSubscriptionNeedsRenewal(
  subscription: SocialDiscoveryYouTubeSubscription,
  now = Date.now()
) {
  if (!subscription.channelId.trim()) return false;
  if (subscription.status === "error" && !subscription.lastSubscribeRequestedAt) return true;
  if (!subscription.leaseExpiresAt.trim()) return true;
  const leaseExpiresAtMs = Date.parse(subscription.leaseExpiresAt);
  if (!Number.isFinite(leaseExpiresAtMs)) return true;
  return leaseExpiresAtMs - now <= YOUTUBE_SUBSCRIPTION_RENEW_WINDOW_MS;
}

export function brandHasYouTubeSubscriptions(brand: Pick<BrandRecord, "socialDiscoveryYouTubeSubscriptions">) {
  return brand.socialDiscoveryYouTubeSubscriptions.some((entry) => entry.channelId.trim());
}

export async function listBrandsWithYouTubeSubscriptions() {
  const brands = await listBrands();
  return brands.filter((brand) => brandHasYouTubeSubscriptions(brand));
}
