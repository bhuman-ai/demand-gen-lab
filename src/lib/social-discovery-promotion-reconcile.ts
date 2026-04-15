import { getBrandById, listBrands, type BrandRecord } from "@/lib/factory-data";
import { hasBuyShazamUiWorkerConfig, runBuyShazamWorkerPurchase } from "@/lib/buyshazam-ui-worker-client";
import { runBuyShazamCommentLikesPurchase } from "@/lib/buyshazam-ui-purchase";
import {
  listSocialDiscoveryPosts,
  updateSocialDiscoveryPostPromotionDraft,
  updateSocialDiscoveryPostPromotionPurchase,
} from "@/lib/social-discovery-data";
import {
  buildSocialDiscoveryCommentPromotionDraft,
  isBuyShazamCommentLikesDestinationUrl,
} from "@/lib/social-discovery-promotion";
import type { SocialDiscoveryPost } from "@/lib/social-discovery-types";

type ReconcileTickOptions = {
  brandIds?: string[];
  limit?: number;
  perBrandLimit?: number;
  scanAllBrands?: boolean;
  dryRun?: boolean;
};

type ReconcileResultRow = {
  brandId: string;
  brandName: string;
  postId: string;
  postUrl: string;
  commentUrl: string;
  destinationUrl: string;
  dryRun: boolean;
  purchaseStatus: string;
  orderId: string;
  orderUrl: string;
  message: string;
};

function splitCsv(value: unknown) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return raw
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function numberOption(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}

function promotionRetryMinutes() {
  return numberOption(process.env.SOCIAL_DISCOVERY_PROMOTION_RETRY_MINUTES, 30, 1, 24 * 60);
}

function shouldRetryPromotionPurchase(post: SocialDiscoveryPost) {
  const purchase = post.promotionPurchase;
  if (!purchase?.attemptedAt.trim()) return true;
  const attemptedAt = Date.parse(purchase.attemptedAt);
  if (!Number.isFinite(attemptedAt)) return true;
  const retryAfterMs = promotionRetryMinutes() * 60 * 1000;
  return Date.now() - attemptedAt >= retryAfterMs;
}

function postCommentUrl(post: SocialDiscoveryPost) {
  return String(post.commentDelivery?.commentUrl ?? "").trim();
}

function hasPurchasableComment(post: SocialDiscoveryPost) {
  const commentDelivery = post.commentDelivery;
  if (!commentDelivery) return false;
  if (!(commentDelivery.status === "verified" || commentDelivery.status === "accepted_unverified")) return false;
  return Boolean(postCommentUrl(post));
}

function shouldAttemptPromotionPurchase(post: SocialDiscoveryPost) {
  if (!hasPurchasableComment(post)) return false;
  if (post.promotionPurchase?.status === "submitted") return false;
  return shouldRetryPromotionPurchase(post);
}

async function resolveBrands(input: ReconcileTickOptions): Promise<BrandRecord[]> {
  const configuredBrandIds =
    input.brandIds?.length
      ? input.brandIds
      : splitCsv(process.env.SOCIAL_DISCOVERY_BRAND_IDS);
  const limit = numberOption(input.limit, 1, 1, 10);

  if (configuredBrandIds.length) {
    const brands = await Promise.all(configuredBrandIds.map((brandId) => getBrandById(brandId)));
    return brands.filter((brand): brand is BrandRecord => Boolean(brand)).slice(0, Math.max(limit, configuredBrandIds.length));
  }

  if (input.scanAllBrands || String(process.env.SOCIAL_DISCOVERY_SCAN_ALL_BRANDS ?? "").trim().toLowerCase() === "true") {
    return (await listBrands()).slice(0, 50);
  }

  return [];
}

async function ensurePromotionDraft(input: { brand: BrandRecord; post: SocialDiscoveryPost }) {
  const expectedCommentUrl = postCommentUrl(input.post);
  const existingDraft = input.post.promotionDraft;
  if (
    existingDraft &&
    existingDraft.sourceCommentUrl.trim() === expectedCommentUrl &&
    existingDraft.destinationUrl.trim()
  ) {
    return existingDraft;
  }
  const promotionDraft = buildSocialDiscoveryCommentPromotionDraft({
    brand: input.brand,
    post: input.post,
  });
  await updateSocialDiscoveryPostPromotionDraft({
    id: input.post.id,
    brandId: input.brand.id,
    promotionDraft,
  });
  return promotionDraft;
}

export async function runSocialDiscoveryPromotionReconcileTick(input: ReconcileTickOptions = {}) {
  const limit = numberOption(input.limit, 1, 1, 10);
  const perBrandLimit = numberOption(input.perBrandLimit, 15, 1, 100);
  const dryRun = Boolean(input.dryRun);
  const brands = await resolveBrands(input);

  const processed: ReconcileResultRow[] = [];
  let eligibleCount = 0;
  let scannedPosts = 0;

  for (const brand of brands) {
    if (processed.length >= limit) break;

    const posts = await listSocialDiscoveryPosts({ brandId: brand.id, limit: perBrandLimit });
    for (const post of posts) {
      scannedPosts += 1;
      if (!shouldAttemptPromotionPurchase(post)) continue;

      const promotionDraft = await ensurePromotionDraft({ brand, post });
      if (!isBuyShazamCommentLikesDestinationUrl(promotionDraft.destinationUrl)) continue;

      eligibleCount += 1;
      if (processed.length >= limit) continue;

      if (dryRun) {
        processed.push({
          brandId: brand.id,
          brandName: brand.name,
          postId: post.id,
          postUrl: post.url,
          commentUrl: postCommentUrl(post),
          destinationUrl: promotionDraft.destinationUrl,
          dryRun: true,
          purchaseStatus: "dry_run",
          orderId: "",
          orderUrl: "",
          message: "Eligible for BuyShazam wallet checkout.",
        });
        continue;
      }

      const promotionPurchase = hasBuyShazamUiWorkerConfig()
        ? await runBuyShazamWorkerPurchase({
            productUrl: promotionDraft.destinationUrl,
            commentUrl: postCommentUrl(post),
          })
        : await runBuyShazamCommentLikesPurchase({
            productUrl: promotionDraft.destinationUrl,
            commentUrl: postCommentUrl(post),
          });
      await updateSocialDiscoveryPostPromotionPurchase({
        id: post.id,
        brandId: brand.id,
        promotionPurchase,
      });
      processed.push({
        brandId: brand.id,
        brandName: brand.name,
        postId: post.id,
        postUrl: post.url,
        commentUrl: postCommentUrl(post),
        destinationUrl: promotionDraft.destinationUrl,
        dryRun: false,
        purchaseStatus: promotionPurchase.status,
        orderId: promotionPurchase.orderId,
        orderUrl: promotionPurchase.orderUrl,
        message: promotionPurchase.message,
      });
    }
  }

  return {
    ok: true,
    dryRun,
    retryMinutes: promotionRetryMinutes(),
    brandsScanned: brands.length,
    postsScanned: scannedPosts,
    eligibleCount,
    processedCount: processed.length,
    submittedCount: processed.filter((entry) => entry.purchaseStatus === "submitted").length,
    processed,
  };
}
