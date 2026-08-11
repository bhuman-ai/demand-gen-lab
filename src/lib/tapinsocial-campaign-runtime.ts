import type { BrandRecord } from "@/lib/factory-types";

const OWNER_LABEL = "TapIn workspace brand";
const CAMPAIGN_LABEL = "TapIn campaign id";

function noteValue(notes: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return notes.match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
}

export function tapInCampaignRuntimeNotes(input: {
  workspaceBrandId: string;
  campaignId: string;
}) {
  return [
    `${OWNER_LABEL}: ${input.workspaceBrandId.trim()}`,
    `${CAMPAIGN_LABEL}: ${input.campaignId.trim()}`,
  ].join("\n");
}

export function tapInCampaignRuntimeIdentity(brand: Pick<BrandRecord, "notes">) {
  const workspaceBrandId = noteValue(brand.notes, OWNER_LABEL);
  const campaignId = noteValue(brand.notes, CAMPAIGN_LABEL);
  if (!workspaceBrandId || !campaignId) return null;
  return { workspaceBrandId, campaignId };
}

export function findTapInCampaignRuntimeBrand(
  brands: BrandRecord[],
  input: { workspaceBrandId: string; campaignId: string }
) {
  const workspaceBrandId = input.workspaceBrandId.trim();
  const campaignId = input.campaignId.trim();
  return brands.find((brand) => {
    const identity = tapInCampaignRuntimeIdentity(brand);
    return identity?.workspaceBrandId === workspaceBrandId && identity.campaignId === campaignId;
  }) ?? null;
}

export function resolveActiveTapInRunnerBrandIds(input: {
  configuredBrandIds: string[];
  brands: BrandRecord[];
}) {
  const campaignBrands = input.brands.filter(
    (brand) => brand.socialDiscoveryYouTubeAutoCommentEnabled && tapInCampaignRuntimeIdentity(brand)
  );
  const supersededWorkspaceBrandIds = new Set(
    campaignBrands
      .map((brand) => tapInCampaignRuntimeIdentity(brand)?.workspaceBrandId ?? "")
      .filter(Boolean)
  );
  return Array.from(new Set([
    ...input.configuredBrandIds.filter((brandId) => !supersededWorkspaceBrandIds.has(brandId)),
    ...campaignBrands.map((brand) => brand.id),
  ]));
}
