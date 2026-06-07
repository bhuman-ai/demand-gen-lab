import InstagramGrowthClient, {
  type InstagramGrowthAccount,
  type InstagramGrowthOpportunity,
} from "./instagram-growth-client";
import type { Metadata } from "next";
import { getBrandById } from "@/lib/factory-data";
import { listSocialRoutingAccounts } from "@/lib/outreach-data";
import { listSocialDiscoveryPosts } from "@/lib/social-discovery-data";
import type { SocialDiscoveryPost } from "@/lib/social-discovery-types";

export const metadata: Metadata = {
  title: {
    absolute: "Liftline | Instagram Growth Desk",
  },
  description: "A standalone review queue for approving Instagram comments with account-health guardrails.",
};

function firstDraft(post: SocialDiscoveryPost) {
  return post.interactionPlan.sequence.find((step) => step.draft.trim())?.draft.trim() ?? "";
}

function accountForPost(post: SocialDiscoveryPost) {
  return (
    post.interactionPlan.recommendedAccounts?.find(
      (account) =>
        account.useCase === "primary_comment" &&
        account.connectionProvider === "unipile" &&
        (account.linkedProvider === "instagram" || account.publicIdentifier || account.externalAccountId)
    ) ?? null
  );
}

function postToOpportunity(post: SocialDiscoveryPost): InstagramGrowthOpportunity {
  const account = accountForPost(post);
  return {
    id: post.id,
    title: post.title || post.interactionPlan.headline || post.body.slice(0, 96) || "Instagram opportunity",
    body: post.body,
    author: post.author,
    community: post.community,
    query: post.query,
    url: post.url,
    status: post.status,
    draft: firstDraft(post),
    headline: post.interactionPlan.headline,
    fitSummary: post.interactionPlan.fitSummary ?? "",
    targetStrength: post.interactionPlan.targetStrength ?? "",
    commentPosture: post.interactionPlan.commentPosture ?? "",
    riskNotes: post.interactionPlan.riskNotes ?? [],
    relevanceScore: post.relevanceScore,
    risingScore: post.risingScore,
    engagementScore: post.engagementScore,
    postedAt: post.postedAt,
    discoveredAt: post.discoveredAt,
    recommendedAccountId: account?.accountId ?? "",
    recommendedAccountName: account?.accountName ?? "",
    recommendedAccountHandle: account?.handle ?? "",
    commentDelivery: post.commentDelivery
      ? {
          commentUrl: post.commentDelivery.commentUrl,
          postedAt: post.commentDelivery.postedAt,
          accountName: post.commentDelivery.accountName,
          accountHandle: post.commentDelivery.accountHandle,
          status: post.commentDelivery.status,
          message: post.commentDelivery.message,
        }
      : null,
    promotionPurchase: post.promotionPurchase
      ? {
          status: post.promotionPurchase.status,
          message: post.promotionPurchase.message,
          orderUrl: post.promotionPurchase.orderUrl,
          attemptedAt: post.promotionPurchase.attemptedAt,
        }
      : null,
  };
}

export default async function InstagramGrowthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [brand, posts, accounts] = await Promise.all([
    getBrandById(id),
    listSocialDiscoveryPosts({ brandId: id, platform: "instagram", limit: 24 }).catch(() => []),
    listSocialRoutingAccounts().catch(() => []),
  ]);

  const instagramAccounts: InstagramGrowthAccount[] = accounts
    .filter((account) => {
      const social = account.config.social;
      return (
        account.status === "active" &&
        social.enabled &&
        social.connectionProvider === "unipile" &&
        (social.linkedProvider === "instagram" || social.platforms.includes("instagram"))
      );
    })
    .map((account) => ({
      id: account.id,
      name: account.name,
      handle: account.config.social.handle,
      displayName: account.config.social.displayName,
      profileUrl: account.config.social.profileUrl,
      trustLevel: account.config.social.trustLevel,
      cooldownMinutes: account.config.social.cooldownMinutes,
      lastSocialCommentAt: account.config.social.lastSocialCommentAt,
      recentActivity24h: account.config.social.recentActivity24h,
      recentActivity7d: account.config.social.recentActivity7d,
    }));

  return (
    <InstagramGrowthClient
      brandId={id}
      brandName={brand?.name ?? "Brand"}
      opportunities={posts.map(postToOpportunity)}
      accounts={instagramAccounts}
    />
  );
}
