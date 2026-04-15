import type { BrandRecord } from "@/lib/factory-data";
import type { SocialDiscoveryPost, SocialDiscoveryPromotionDraft } from "@/lib/social-discovery-types";

const DEFAULT_BUY_SHAZAM_INSTAGRAM_COMMENT_LIKES_URL = "https://buyshazam.com/product/instagram-comment-likes/";
const DEFAULT_BUY_SHAZAM_HOSTNAME = "buyshazam.com";

function compactText(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function todayLabel() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function cleanUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function hostnameFromUrl(value: string) {
  const cleaned = cleanUrl(value);
  if (!cleaned) return "";
  try {
    return new URL(cleaned).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function audienceLine(post: SocialDiscoveryPost) {
  const query = compactText(post.query, 80);
  if (!query) return "Women who care about everyday safety, solo travel, and getting home safely.";
  return `Women engaging with ${query} topics, personal safety, and everyday getting-home content.`;
}

function sourceTopic(post: SocialDiscoveryPost) {
  return compactText(post.title || post.body || post.query || "personal safety", 120);
}

function buildPrimaryText(input: {
  brandName: string;
  brandProduct: string;
  topic: string;
  website: string;
}) {
  const product = compactText(input.brandProduct, 120);
  const topic = compactText(input.topic, 120);
  const first = topic
    ? "Posts like this are a reminder that personal safety decisions usually happen before the stressful moment, not during it."
    : "Personal safety decisions usually happen before the stressful moment, not during it.";
  const second = product
    ? `${input.brandName} helps with that by ${product.replace(/\.$/, "")}.`
    : `${input.brandName} helps women set a simple safety plan before heading out and reach trusted help faster if needed.`;
  const third = input.website
    ? "Learn more if you want the full flow."
    : "Use brand-owned creative and send traffic to your own page, not the third-party post.";
  return compactText(`${first} ${second} ${third}`, 500);
}

export function resolveSocialDiscoveryPromotionDestinationUrl(brand: Pick<BrandRecord, "website">) {
  const explicitOverride = cleanUrl(
    process.env.SOCIAL_DISCOVERY_COMMENT_PROMOTION_URL ??
      process.env.BUY_SHAZAM_INSTAGRAM_COMMENT_LIKES_URL ??
      ""
  );
  if (explicitOverride) return explicitOverride;

  const website = cleanUrl(brand.website);
  if (hostnameFromUrl(website) === DEFAULT_BUY_SHAZAM_HOSTNAME) {
    return DEFAULT_BUY_SHAZAM_INSTAGRAM_COMMENT_LIKES_URL;
  }
  return website;
}

export function resolveSocialDiscoveryCommentPromotionDestinationUrl() {
  const explicitOverride = cleanUrl(
    process.env.SOCIAL_DISCOVERY_COMMENT_PROMOTION_URL ??
      process.env.BUY_SHAZAM_INSTAGRAM_COMMENT_LIKES_URL ??
      ""
  );
  return explicitOverride || DEFAULT_BUY_SHAZAM_INSTAGRAM_COMMENT_LIKES_URL;
}

export function isBuyShazamCommentLikesDestinationUrl(value: string) {
  const cleaned = cleanUrl(value);
  if (!cleaned) return false;
  try {
    const url = new URL(cleaned);
    return (
      url.hostname.replace(/^www\./i, "").toLowerCase() === DEFAULT_BUY_SHAZAM_HOSTNAME &&
      url.pathname.replace(/\/+$/, "").toLowerCase() === "/product/instagram-comment-likes"
    );
  } catch {
    return false;
  }
}

export function buildSocialDiscoveryPromotionDraft(input: {
  brand: Pick<BrandRecord, "name" | "website" | "product">;
  post: SocialDiscoveryPost;
}): SocialDiscoveryPromotionDraft {
  const destinationUrl = resolveSocialDiscoveryPromotionDestinationUrl(input.brand);
  const topic = sourceTopic(input.post);
  const generatedAt = new Date().toISOString();
  const objective = destinationUrl ? "traffic" : "awareness";
  return {
    channel: "instagram-ads",
    objective,
    campaignName: compactText(`${input.brand.name} Instagram awareness ${todayLabel()}`, 120),
    destinationUrl: destinationUrl || input.post.url,
    sourcePostUrl: input.post.url,
    sourceCommentUrl: input.post.commentDelivery?.commentUrl ?? "",
    audience: audienceLine(input.post),
    headline: compactText(`${input.brand.name}: personal safety, before the freeze moment`, 120),
    primaryText: buildPrimaryText({
      brandName: input.brand.name,
      brandProduct: input.brand.product,
      topic,
      website: destinationUrl,
    }),
    ctaLabel: "Learn more",
    rationale: compactText(
      `Built from the source post topic "${topic}". This is a brand-owned ad brief for official promotion. Do not boost or impersonate the third-party post.`,
      240
    ),
    generatedAt,
  };
}

export function buildSocialDiscoveryCommentPromotionDraft(input: {
  brand: Pick<BrandRecord, "name" | "website" | "product">;
  post: SocialDiscoveryPost;
}): SocialDiscoveryPromotionDraft {
  const destinationUrl = resolveSocialDiscoveryCommentPromotionDestinationUrl();
  const topic = sourceTopic(input.post);
  const generatedAt = new Date().toISOString();
  return {
    channel: "instagram-ads",
    objective: "traffic",
    campaignName: compactText(`${input.brand.name} Instagram awareness ${todayLabel()}`, 120),
    destinationUrl,
    sourcePostUrl: input.post.url,
    sourceCommentUrl: input.post.commentDelivery?.commentUrl ?? "",
    audience: audienceLine(input.post),
    headline: compactText(`${input.brand.name}: personal safety, before the freeze moment`, 120),
    primaryText: buildPrimaryText({
      brandName: input.brand.name,
      brandProduct: input.brand.product,
      topic,
      website: destinationUrl,
    }),
    ctaLabel: "Learn more",
    rationale: compactText(
      `Built from the source post topic "${topic}". This comment-triggered flow routes to the BuyShazam Instagram comment likes checkout automatically.`,
      240
    ),
    generatedAt,
  };
}
