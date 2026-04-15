import { getBrandById, listBrands, type BrandRecord } from "@/lib/factory-data";
import {
  subscribeBrandToYouTubeChannel,
  youtubeSubscriptionNeedsRenewal,
} from "@/lib/social-discovery-youtube-subscriptions";

type RenewTickOptions = {
  brandIds?: string[];
  limit?: number;
  scanAllBrands?: boolean;
  dryRun?: boolean;
};

type RenewResultRow = {
  brandId: string;
  brandName: string;
  channelId: string;
  accountId: string;
  autoComment: boolean;
  leaseExpiresAt: string;
  dryRun: boolean;
  status: string;
  error: string;
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

async function resolveBrands(input: RenewTickOptions): Promise<BrandRecord[]> {
  const configuredBrandIds =
    input.brandIds?.length
      ? input.brandIds
      : splitCsv(process.env.SOCIAL_DISCOVERY_BRAND_IDS);
  const limit = numberOption(input.limit, 50, 1, 200);

  if (configuredBrandIds.length) {
    const brands = await Promise.all(configuredBrandIds.map((brandId) => getBrandById(brandId)));
    return brands.filter((brand): brand is BrandRecord => Boolean(brand)).slice(0, Math.max(limit, configuredBrandIds.length));
  }

  if (input.scanAllBrands || String(process.env.SOCIAL_DISCOVERY_SCAN_ALL_BRANDS ?? "").trim().toLowerCase() === "true") {
    return (await listBrands()).slice(0, limit);
  }

  return [];
}

export async function runSocialDiscoveryYouTubeSubscriptionRenewTick(input: RenewTickOptions = {}) {
  const dryRun = Boolean(input.dryRun);
  const brands = await resolveBrands(input);
  const processed: RenewResultRow[] = [];
  let eligibleCount = 0;

  for (const brand of brands) {
    for (const subscription of brand.socialDiscoveryYouTubeSubscriptions) {
      if (!youtubeSubscriptionNeedsRenewal(subscription)) continue;
      eligibleCount += 1;

      if (dryRun) {
        processed.push({
          brandId: brand.id,
          brandName: brand.name,
          channelId: subscription.channelId,
          accountId: subscription.accountId,
          autoComment: subscription.autoComment,
          leaseExpiresAt: subscription.leaseExpiresAt,
          dryRun: true,
          status: "eligible",
          error: "",
        });
        continue;
      }

      try {
        const renewed = await subscribeBrandToYouTubeChannel({
          brandId: brand.id,
          channelId: subscription.channelId,
          accountId: subscription.accountId || undefined,
          autoComment: subscription.autoComment,
          leaseSeconds: subscription.leaseSeconds || undefined,
        });
        processed.push({
          brandId: brand.id,
          brandName: brand.name,
          channelId: subscription.channelId,
          accountId: subscription.accountId,
          autoComment: subscription.autoComment,
          leaseExpiresAt: renewed.record.leaseExpiresAt,
          dryRun: false,
          status: renewed.record.status,
          error: "",
        });
      } catch (error) {
        processed.push({
          brandId: brand.id,
          brandName: brand.name,
          channelId: subscription.channelId,
          accountId: subscription.accountId,
          autoComment: subscription.autoComment,
          leaseExpiresAt: subscription.leaseExpiresAt,
          dryRun: false,
          status: "error",
          error: error instanceof Error ? error.message : "Failed to renew YouTube subscription",
        });
      }
    }
  }

  return {
    ok: true,
    dryRun,
    brandsScanned: brands.length,
    eligibleCount,
    processedCount: processed.length,
    renewedCount: processed.filter((entry) => entry.status === "pending" || entry.status === "active").length,
    errorCount: processed.filter((entry) => entry.status === "error").length,
    processed,
  };
}
