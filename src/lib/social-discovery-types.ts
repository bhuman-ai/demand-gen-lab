export type SocialDiscoveryPlatform = "reddit" | "instagram";
export type SocialDiscoveryProvider = "exa" | "dataforseo";

export type SocialDiscoveryIntent =
  | "brand_mention"
  | "buyer_question"
  | "competitor_complaint"
  | "category_intent"
  | "noise";

export type SocialDiscoveryStatus = "new" | "triaged" | "saved" | "dismissed";

export type SocialDiscoveryPost = {
  id: string;
  brandId: string;
  platform: SocialDiscoveryPlatform;
  provider: SocialDiscoveryProvider;
  externalId: string;
  url: string;
  title: string;
  body: string;
  author: string;
  community: string;
  query: string;
  matchedTerms: string[];
  intent: SocialDiscoveryIntent;
  relevanceScore: number;
  risingScore: number;
  engagementScore: number;
  providerRank: number;
  status: SocialDiscoveryStatus;
  interactionPlan: SocialDiscoveryInteractionPlan;
  raw: Record<string, unknown>;
  postedAt: string;
  discoveredAt: string;
  updatedAt: string;
};

export type SocialDiscoveryInteractionPlan = {
  headline: string;
  actors: Array<{
    role: "operator" | "specialist" | "curator" | "partner" | "founder";
    job: string;
  }>;
  sequence: Array<{
    actorRole: "operator" | "specialist" | "curator" | "partner" | "founder";
    timing: string;
    move: string;
    draft: string;
  }>;
  assetNeeded: string;
  riskNotes: string[];
};

export type SocialDiscoveryRun = {
  id: string;
  brandId: string;
  provider: SocialDiscoveryProvider;
  platforms: SocialDiscoveryPlatform[];
  queries: string[];
  postIds: string[];
  errorCount: number;
  errors: Array<{
    platform: SocialDiscoveryPlatform;
    query: string;
    message: string;
  }>;
  startedAt: string;
  finishedAt: string;
};

export type SocialDiscoveryListOptions = {
  brandId: string;
  platform?: SocialDiscoveryPlatform;
  status?: SocialDiscoveryStatus;
  limit?: number;
};
