export type SocialDiscoveryPlatform =
  | "reddit"
  | "instagram"
  | "x"
  | "linkedin"
  | "product-hunt"
  | "youtube";
export type SocialDiscoveryProvider = "exa" | "dataforseo" | "youtube-data-api" | "youtube-websub";
export type SocialDiscoveryActorRole =
  | "operator"
  | "specialist"
  | "curator"
  | "partner"
  | "founder"
  | "brand"
  | "community";

export type SocialDiscoveryIntent =
  | "brand_mention"
  | "buyer_question"
  | "competitor_complaint"
  | "category_intent"
  | "noise";

export type SocialDiscoveryStatus = "new" | "triaged" | "saved" | "dismissed";

export type SocialDiscoveryCommentDelivery = {
  commentId: string;
  commentUrl: string;
  status: "verified" | "accepted_unverified" | "";
  source: "comments_list" | "response" | "none" | "";
  message: string;
  postedAt: string;
  accountId: string;
  accountName: string;
  accountHandle: string;
};

export type SocialDiscoveryPromotionDraft = {
  channel: "instagram-ads";
  objective: "awareness" | "traffic";
  campaignName: string;
  destinationUrl: string;
  sourcePostUrl: string;
  sourceCommentUrl: string;
  audience: string;
  headline: string;
  primaryText: string;
  ctaLabel: string;
  rationale: string;
  generatedAt: string;
};

export type SocialDiscoveryPromotionPurchaseStatus =
  | "requires_configuration"
  | "requires_login"
  | "checkout_requires_input"
  | "wallet_unavailable"
  | "submitted"
  | "failed";

export type SocialDiscoveryPromotionPurchase = {
  provider: "buyshazam";
  mode: "wallet";
  status: SocialDiscoveryPromotionPurchaseStatus;
  productUrl: string;
  cartUrl: string;
  checkoutUrl: string;
  sourceCommentUrl: string;
  addedToCart: boolean;
  walletOptionLabel: string;
  walletBalance: string;
  missingFields: string[];
  orderId: string;
  orderUrl: string;
  message: string;
  screenshotPath: string;
  attemptedAt: string;
};

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
  commentDelivery?: SocialDiscoveryCommentDelivery;
  promotionDraft?: SocialDiscoveryPromotionDraft;
  promotionPurchase?: SocialDiscoveryPromotionPurchase;
  raw: Record<string, unknown>;
  postedAt: string;
  discoveredAt: string;
  updatedAt: string;
};

export type SocialDiscoveryInteractionPlan = {
  headline: string;
  domainProfile?: string;
  fitSummary?: string;
  targetStrength?: "target" | "watch" | "skip";
  commentPosture?: "method_first" | "empathy_first" | "question_first" | "watch_only" | "no_comment";
  mentionPolicy?: "no_mention" | "mention_only_if_asked" | "possible_soft_mention" | "never_mention";
  analyticsTag?: string;
  generationPrompt?: string;
  generationPromptMode?: "auto" | "manual";
  exitRules?: string[];
  routingSummary?: string;
  recommendedAccounts?: Array<{
    accountId: string;
    accountName: string;
    provider: string;
    accountType: string;
    actorRole: SocialDiscoveryActorRole;
    useCase: "primary_comment" | "followup_if_asked" | "watch_only";
    score: number;
    handle: string;
    profileUrl: string;
    linkedProvider: string;
    publicIdentifier: string;
    displayName: string;
    headline: string;
    bio: string;
    personaSummary: string;
    lastProfileSyncAt: string;
    fromEmail: string;
    connectionProvider: string;
    externalAccountId: string;
    coordinationGroup: string;
    cooldownUntil: string;
    rationale: string;
  }>;
  actors: Array<{
    role: SocialDiscoveryActorRole;
    job: string;
  }>;
  sequence: Array<{
    actorRole: SocialDiscoveryActorRole;
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
