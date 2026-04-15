import type { BrandRecord } from "./factory-types";
import type { SocialDiscoveryPlatform } from "./social-discovery-types";

export type SocialPlatformCatalogItem = {
  id: string;
  label: string;
  group: string;
  description: string;
  scanStatus: "supported_now" | "saved_for_later";
};

type BrandPlatformRecommendation = {
  platformId: string;
  score: number;
};

export const CURRENT_SOCIAL_DISCOVERY_PLATFORMS = [
  "instagram",
  "reddit",
  "x",
  "linkedin",
  "product-hunt",
  "youtube",
] as const;

export const DEFAULT_BRAND_SOCIAL_PLATFORMS = [...CURRENT_SOCIAL_DISCOVERY_PLATFORMS];

export const SOCIAL_PLATFORM_CATALOG: SocialPlatformCatalogItem[] = [
  { id: "linkedin", label: "LinkedIn", group: "Professional Feeds", description: "Work posts, hiring signals, operator threads.", scanStatus: "supported_now" },
  { id: "x", label: "X", group: "Professional Feeds", description: "Fast reactions, launches, quotes, outages.", scanStatus: "supported_now" },
  { id: "threads", label: "Threads", group: "Professional Feeds", description: "Consumer and creator-adjacent conversation.", scanStatus: "saved_for_later" },
  { id: "bluesky", label: "Bluesky", group: "Professional Feeds", description: "Early-adopter, tech, media, creator circles.", scanStatus: "saved_for_later" },

  { id: "reddit", label: "Reddit", group: "Open Forums", description: "Questions, complaints, alternatives, lived experience.", scanStatus: "supported_now" },
  { id: "quora", label: "Quora", group: "Open Forums", description: "Evergreen buyer and how-to questions.", scanStatus: "saved_for_later" },
  { id: "hacker-news", label: "Hacker News", group: "Open Forums", description: "Developer and startup debates.", scanStatus: "saved_for_later" },
  { id: "indie-hackers", label: "Indie Hackers", group: "Open Forums", description: "Founder workflows, GTM, product decisions.", scanStatus: "saved_for_later" },
  { id: "lobsters", label: "Lobsters", group: "Open Forums", description: "Developer-heavy technical discussion.", scanStatus: "saved_for_later" },

  { id: "instagram", label: "Instagram", group: "Visual Consumer", description: "Reels, posts, comments, creator-led discovery.", scanStatus: "supported_now" },
  { id: "tiktok", label: "TikTok", group: "Visual Consumer", description: "Fast consumer trends and personal experience posts.", scanStatus: "saved_for_later" },
  { id: "youtube", label: "YouTube", group: "Visual Consumer", description: "Video comments, tutorials, webinar spillover.", scanStatus: "supported_now" },
  { id: "pinterest", label: "Pinterest", group: "Visual Consumer", description: "Discovery for visual, planning, and lifestyle products.", scanStatus: "saved_for_later" },
  { id: "snapchat", label: "Snapchat", group: "Visual Consumer", description: "Younger consumer audiences and local sharing.", scanStatus: "saved_for_later" },

  { id: "discord", label: "Discord", group: "Communities", description: "Niche communities, creator groups, product support.", scanStatus: "saved_for_later" },
  { id: "slack", label: "Slack Communities", group: "Communities", description: "Operator, SaaS, RevOps, and agency groups.", scanStatus: "saved_for_later" },
  { id: "facebook-groups", label: "Facebook Groups", group: "Communities", description: "Local, hobby, service, and operator groups.", scanStatus: "saved_for_later" },
  { id: "telegram", label: "Telegram", group: "Communities", description: "Founder, trading, regional, and niche communities.", scanStatus: "saved_for_later" },
  { id: "whatsapp-communities", label: "WhatsApp Communities", group: "Communities", description: "Regional and local networked groups.", scanStatus: "saved_for_later" },
  { id: "circle", label: "Circle", group: "Communities", description: "Membership and course communities.", scanStatus: "saved_for_later" },
  { id: "skool", label: "Skool", group: "Communities", description: "Community-led education and coaching groups.", scanStatus: "saved_for_later" },

  { id: "product-hunt", label: "Product Hunt", group: "Reviews And Launches", description: "Launch-day comments and category evaluation.", scanStatus: "supported_now" },
  { id: "g2", label: "G2", group: "Reviews And Launches", description: "B2B software comparison and review traffic.", scanStatus: "saved_for_later" },
  { id: "capterra", label: "Capterra", group: "Reviews And Launches", description: "Software buyer research and category pages.", scanStatus: "saved_for_later" },
  { id: "trustradius", label: "TrustRadius", group: "Reviews And Launches", description: "Detailed B2B reviews and alternatives.", scanStatus: "saved_for_later" },
  { id: "alternative-to", label: "AlternativeTo", group: "Reviews And Launches", description: "Alternative-seeking traffic and comparisons.", scanStatus: "saved_for_later" },
  { id: "appsumo", label: "AppSumo", group: "Reviews And Launches", description: "SMB software buyers and launch comments.", scanStatus: "saved_for_later" },

  { id: "github-discussions", label: "GitHub Discussions", group: "Developer Surfaces", description: "Open-source and technical workflow discussion.", scanStatus: "saved_for_later" },
  { id: "stack-overflow", label: "Stack Overflow", group: "Developer Surfaces", description: "Technical Q&A and implementation friction.", scanStatus: "saved_for_later" },
  { id: "devto", label: "DEV", group: "Developer Surfaces", description: "Developer articles and comment threads.", scanStatus: "saved_for_later" },
  { id: "hashnode", label: "Hashnode", group: "Developer Surfaces", description: "Engineering blogs and comments.", scanStatus: "saved_for_later" },
  { id: "habr", label: "Habr", group: "Developer Surfaces", description: "Technical community with strong regional pockets.", scanStatus: "saved_for_later" },

  { id: "shopify-community", label: "Shopify Community", group: "Ecosystem Communities", description: "Merchants, apps, ecommerce workflow issues.", scanStatus: "saved_for_later" },
  { id: "hubspot-community", label: "HubSpot Community", group: "Ecosystem Communities", description: "CRM, RevOps, automation, and GTM threads.", scanStatus: "saved_for_later" },
  { id: "salesforce-trailblazer", label: "Salesforce Trailblazer", group: "Ecosystem Communities", description: "Enterprise CRM and admin/operator questions.", scanStatus: "saved_for_later" },
  { id: "atlassian-community", label: "Atlassian Community", group: "Ecosystem Communities", description: "Project, service desk, and ops workflows.", scanStatus: "saved_for_later" },
  { id: "wordpress", label: "WordPress", group: "Ecosystem Communities", description: "Plugin, site, and creator-tool discussion.", scanStatus: "saved_for_later" },
  { id: "chrome-web-store", label: "Chrome Web Store", group: "Ecosystem Communities", description: "Extension reviews, complaints, and use cases.", scanStatus: "saved_for_later" },

  { id: "wechat", label: "WeChat", group: "Regional Platforms", description: "China-focused brand, group, and community traffic.", scanStatus: "saved_for_later" },
  { id: "xiaohongshu", label: "Xiaohongshu", group: "Regional Platforms", description: "China lifestyle, beauty, travel, and purchase intent.", scanStatus: "saved_for_later" },
  { id: "douyin", label: "Douyin", group: "Regional Platforms", description: "China short video and trend discovery.", scanStatus: "saved_for_later" },
  { id: "zhihu", label: "Zhihu", group: "Regional Platforms", description: "China long-form Q&A and expert discussion.", scanStatus: "saved_for_later" },
  { id: "bilibili", label: "Bilibili", group: "Regional Platforms", description: "China creator, fandom, and educational video comments.", scanStatus: "saved_for_later" },
  { id: "line-openchat", label: "LINE OpenChat", group: "Regional Platforms", description: "Japan, Taiwan, Thailand community threads.", scanStatus: "saved_for_later" },
  { id: "naver-cafe", label: "Naver Cafe", group: "Regional Platforms", description: "Korea interest communities and niche groups.", scanStatus: "saved_for_later" },
  { id: "kakao-openchat", label: "Kakao OpenChat", group: "Regional Platforms", description: "Korea open community conversations.", scanStatus: "saved_for_later" },
  { id: "vk", label: "VK", group: "Regional Platforms", description: "Russia and CIS consumer and community discussion.", scanStatus: "saved_for_later" },
  { id: "qiita", label: "Qiita", group: "Regional Platforms", description: "Japan developer publishing and technical comments.", scanStatus: "saved_for_later" },
  { id: "note", label: "note.com", group: "Regional Platforms", description: "Japan creator and writer communities.", scanStatus: "saved_for_later" },
];

const CATALOG_IDS = new Set(SOCIAL_PLATFORM_CATALOG.map((item) => item.id));

function buildInferenceText(brand: Pick<
  BrandRecord,
  "name" | "website" | "notes" | "product" | "targetMarkets" | "idealCustomerProfiles" | "keyFeatures" | "keyBenefits"
>) {
  return [
    brand.name,
    brand.website,
    brand.notes,
    brand.product,
    ...brand.targetMarkets,
    ...brand.idealCustomerProfiles,
    ...brand.keyFeatures,
    ...brand.keyBenefits,
  ]
    .join(" \n ")
    .toLowerCase();
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function pushScore(rows: Map<string, number>, platformId: string, score: number) {
  rows.set(platformId, (rows.get(platformId) ?? 0) + score);
}

function scoreMany(rows: Map<string, number>, platformIds: string[], score: number) {
  for (const platformId of platformIds) pushScore(rows, platformId, score);
}

export function inferBrandPlatformRecommendations(
  brand: Pick<
    BrandRecord,
    "name" | "website" | "notes" | "product" | "targetMarkets" | "idealCustomerProfiles" | "keyFeatures" | "keyBenefits"
  >
): BrandPlatformRecommendation[] {
  const text = buildInferenceText(brand);
  const scores = new Map<string, number>();

  const isB2B = hasAny(text, [
    "b2b",
    "sales",
    "outbound",
    "marketing",
    "revops",
    "crm",
    "customer success",
    "support teams",
    "founders",
    "enterprise",
    "saas",
  ]);
  const isDeveloper = hasAny(text, [
    "developer",
    "developers",
    "api",
    "sdk",
    "integration",
    "github",
    "code",
    "engineering",
    "technical",
    "extension",
    "plugin",
  ]);
  const isConsumerVisual = hasAny(text, [
    "creator",
    "video",
    "visual",
    "art",
    "painting",
    "beauty",
    "fashion",
    "travel",
    "fitness",
    "lifestyle",
    "women",
    "safety",
    "harassment",
    "rideshare",
    "nightlife",
    "student",
  ]);
  const isCommunityLed = hasAny(text, [
    "community",
    "membership",
    "course",
    "coaching",
    "students",
    "operators",
    "founders",
    "support",
  ]);
  const isEcommerce = hasAny(text, ["shopify", "merchant", "ecommerce", "e-commerce", "store"]);
  const isLaunchDriven = hasAny(text, ["launch", "product hunt", "trial", "pricing", "alternative", "compare"]);
  const isEcosystem = hasAny(text, ["hubspot", "salesforce", "atlassian", "wordpress", "chrome extension"]);
  const isLocalTrust = hasAny(text, [
    "local",
    "city",
    "campus",
    "nearby",
    "allies",
    "verified",
    "traveler",
    "women",
    "rideshare",
    "street harassment",
  ]);

  if (isB2B) {
    scoreMany(scores, ["linkedin"], 28);
    scoreMany(scores, ["x", "reddit"], 16);
    scoreMany(scores, ["slack", "indie-hackers"], 14);
    scoreMany(scores, ["product-hunt", "g2", "capterra", "trustradius", "alternative-to"], 12);
  }

  if (isDeveloper) {
    scoreMany(scores, ["github-discussions"], 28);
    scoreMany(scores, ["stack-overflow"], 24);
    scoreMany(scores, ["hacker-news", "lobsters"], 16);
    scoreMany(scores, ["devto", "hashnode", "reddit"], 12);
    scoreMany(scores, ["chrome-web-store"], 10);
  }

  if (isConsumerVisual) {
    scoreMany(scores, ["instagram"], 26);
    scoreMany(scores, ["tiktok"], 22);
    scoreMany(scores, ["youtube"], 16);
    scoreMany(scores, ["pinterest"], 12);
    scoreMany(scores, ["reddit"], 10);
  }

  if (isCommunityLed) {
    scoreMany(scores, ["discord", "slack", "circle", "skool"], 12);
    scoreMany(scores, ["reddit"], 8);
  }

  if (isEcommerce) {
    scoreMany(scores, ["shopify-community"], 24);
    scoreMany(scores, ["facebook-groups"], 12);
    scoreMany(scores, ["reddit"], 10);
  }

  if (isLaunchDriven) {
    scoreMany(scores, ["product-hunt", "g2", "capterra", "trustradius", "alternative-to"], 10);
    scoreMany(scores, ["reddit"], 8);
  }

  if (isEcosystem) {
    if (text.includes("hubspot")) pushScore(scores, "hubspot-community", 20);
    if (text.includes("salesforce")) pushScore(scores, "salesforce-trailblazer", 20);
    if (text.includes("atlassian")) pushScore(scores, "atlassian-community", 20);
    if (text.includes("wordpress")) pushScore(scores, "wordpress", 20);
    if (text.includes("chrome extension")) pushScore(scores, "chrome-web-store", 18);
  }

  if (isLocalTrust) {
    scoreMany(scores, ["facebook-groups", "whatsapp-communities", "telegram"], 12);
    scoreMany(scores, ["instagram", "reddit"], 10);
  }

  if (!scores.size) {
    return DEFAULT_BRAND_SOCIAL_PLATFORMS.map((platformId, index) => ({
      platformId,
      score: 100 - index,
    }));
  }

  return [...scores.entries()]
    .filter(([platformId, score]) => CATALOG_IDS.has(platformId) && score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([platformId, score]) => ({ platformId, score }));
}

export function inferBrandSocialPlatforms(
  brand: Pick<
    BrandRecord,
    "name" | "website" | "notes" | "product" | "targetMarkets" | "idealCustomerProfiles" | "keyFeatures" | "keyBenefits"
  >
): SocialDiscoveryPlatform[] {
  return inferBrandPlatformRecommendations(brand).map((entry) => entry.platformId as SocialDiscoveryPlatform);
}

export function inferSupportedDiscoveryPlatformsForBrand(
  brand: Pick<
    BrandRecord,
    "name" | "website" | "notes" | "product" | "targetMarkets" | "idealCustomerProfiles" | "keyFeatures" | "keyBenefits"
  >
) : SocialDiscoveryPlatform[] {
  const inferred = inferBrandSocialPlatforms(brand).filter((platformId) => isSupportedDiscoveryPlatform(platformId));
  return inferred.length ? inferred : [...DEFAULT_BRAND_SOCIAL_PLATFORMS];
}

export function resolveSupportedDiscoveryPlatformsForBrand(
  brand: Pick<
    BrandRecord,
    "name" | "website" | "notes" | "product" | "targetMarkets" | "idealCustomerProfiles" | "keyFeatures" | "keyBenefits" | "socialDiscoveryPlatforms"
  >
) : SocialDiscoveryPlatform[] {
  const saved = brand.socialDiscoveryPlatforms.filter((platformId) => isSupportedDiscoveryPlatform(platformId));
  return saved.length ? (saved as SocialDiscoveryPlatform[]) : inferSupportedDiscoveryPlatformsForBrand(brand);
}

export function isSupportedDiscoveryPlatform(platformId: string) {
  return CURRENT_SOCIAL_DISCOVERY_PLATFORMS.includes(
    platformId as (typeof CURRENT_SOCIAL_DISCOVERY_PLATFORMS)[number]
  );
}
