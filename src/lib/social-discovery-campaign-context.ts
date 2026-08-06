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
