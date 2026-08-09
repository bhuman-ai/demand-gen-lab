import type { BrandRecord } from "@/lib/factory-data";

function promptValue(prompt: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return prompt.match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
}

/**
 * TapIn stores the campaign identity in its generated social-discovery prompt.
 * Use that identity at runtime so a provisioned seed brand cannot leak its name,
 * website, audience, or category into search scoring and comment generation.
 */
export function socialDiscoveryCampaignBrand(brand: BrandRecord): BrandRecord {
  if (!brand.socialDiscoveryCommentPrompt.includes("TapIn supplies the matched YouTube video")) {
    return brand;
  }
  const campaignName = promptValue(brand.socialDiscoveryCommentPrompt, "Brand name");
  if (!campaignName) return brand;

  const positioning = promptValue(brand.socialDiscoveryCommentPrompt, "Brand positioning");
  const campaignTopics = brand.socialDiscoveryQueries;

  return {
    ...brand,
    name: campaignName,
    website: "",
    product: positioning || campaignTopics.join(", ") || campaignName,
    notes: "",
    targetMarkets: campaignTopics,
    idealCustomerProfiles: [],
    keyFeatures: positioning ? [positioning] : [],
    keyBenefits: [],
  };
}

function campaignBrandName(value: string) {
  return String(value ?? "")
    .split(/\s+[·—|]\s+/)[0]
    ?.trim() ?? "";
}

/**
 * Preview requests arrive before TapIn has saved the draft campaign to the
 * backend brand. Build the same isolated campaign context from the draft so a
 * seed brand (for example BHuman) cannot score or name an Olyvv preview.
 */
export function tapInPreviewCampaignBrand(
  brand: BrandRecord,
  input: { campaignName?: string; targets?: string[] }
): BrandRecord {
  const targets = Array.from(
    new Set((input.targets ?? []).map((target) => String(target ?? "").trim()).filter(Boolean))
  );
  const name = campaignBrandName(input.campaignName ?? "") || brand.name;

  return {
    ...brand,
    name,
    website: "",
    product: targets.join(", ") || name,
    notes: "",
    socialDiscoveryQueries: targets,
    targetMarkets: targets,
    idealCustomerProfiles: [],
    keyFeatures: [],
    keyBenefits: [],
  };
}
