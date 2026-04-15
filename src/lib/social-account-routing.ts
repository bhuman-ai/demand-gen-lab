import type { BrandRecord, OutreachAccount } from "@/lib/factory-types";
import { getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import { listSocialRoutingAccounts } from "@/lib/outreach-data";
import { socialIdentitySummaryText } from "@/lib/social-account-config";
import type {
  SocialDiscoveryActorRole,
  SocialDiscoveryInteractionPlan,
  SocialDiscoveryPost,
  SocialDiscoveryPlatform,
} from "@/lib/social-discovery-types";

type RecommendedAccount = NonNullable<SocialDiscoveryInteractionPlan["recommendedAccounts"]>[number];

function normalizeText(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function compactReason(parts: string[]) {
  return parts.filter(Boolean).join(" ");
}

function slugList(value: string[]) {
  return value
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function postHaystack(post: SocialDiscoveryPost) {
  return normalizeText(
    [
      post.platform,
      post.community,
      post.query,
      post.title,
      post.body,
      ...post.matchedTerms,
    ].join(" ")
  );
}

function accountIdentityBlob(account: OutreachAccount) {
  return normalizeText(
    [
      account.name,
      getOutreachAccountFromEmail(account),
      account.config.social.displayName,
      account.config.social.publicIdentifier,
      account.config.social.handle,
      account.config.social.headline,
      account.config.social.bio,
      account.config.social.personaSummary,
      account.config.social.voiceSummary,
      socialIdentitySummaryText(account.config.social),
    ].join(" ")
  );
}

function accountHandle(account: OutreachAccount) {
  const explicit = account.config.social.handle.trim();
  if (explicit) return explicit;
  if (account.config.social.publicIdentifier.trim()) {
    return `@${account.config.social.publicIdentifier.trim().replace(/^@/, "")}`;
  }
  const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
  if (!fromEmail.includes("@")) return "";
  return `@${fromEmail.split("@")[0] ?? ""}`.replace(/^@+$/, "");
}

function inferredRole(account: OutreachAccount): SocialDiscoveryActorRole {
  const explicit = account.config.social.role;
  if (explicit) return explicit;
  const text = accountIdentityBlob(account);
  if (/\b(founder|ceo|cofounder|co-founder)\b/.test(text)) return "founder";
  if (/\b(brand|official)\b/.test(text)) return "brand";
  if (/\b(support|community|success)\b/.test(text)) return "community";
  return "operator";
}

function roleFitScore(desired: SocialDiscoveryActorRole, actual: SocialDiscoveryActorRole) {
  if (desired === actual) return 22;
  if (desired === "operator" && ["founder", "community", "brand"].includes(actual)) return 16;
  if (desired === "specialist" && ["operator", "founder", "partner", "community"].includes(actual)) return 15;
  if (desired === "community" && ["operator", "founder", "brand"].includes(actual)) return 12;
  if (desired === "founder" && ["operator", "brand"].includes(actual)) return 10;
  return 4;
}

function desiredPrimaryRoles(post: SocialDiscoveryPost): SocialDiscoveryActorRole[] {
  const posture = post.interactionPlan.commentPosture ?? "method_first";
  if (posture === "empathy_first") return ["community", "operator", "founder", "brand", "partner", "specialist"];
  if (posture === "question_first") return ["operator", "founder", "community", "specialist", "brand"];
  return ["operator", "specialist", "founder", "community", "brand", "partner"];
}

function desiredWatchRoles(): SocialDiscoveryActorRole[] {
  return ["operator", "community", "founder", "brand", "specialist"];
}

function platformFitScore(account: OutreachAccount, platform: SocialDiscoveryPlatform) {
  const platforms = slugList(account.config.social.platforms);
  if (platforms.includes(platform)) return 20;
  if (!platforms.length) return 6;
  return -40;
}

function topicFitScore(account: OutreachAccount, haystack: string) {
  const tags = slugList(account.config.social.topicTags);
  if (!tags.length) return { score: 4, matched: false };
  const hits = tags.filter((tag) => haystack.includes(tag));
  if (!hits.length) return { score: -6, matched: false };
  return { score: Math.min(20, 8 + hits.length * 6), matched: true };
}

function identityFitScore(account: OutreachAccount, haystack: string) {
  const blob = accountIdentityBlob(account);
  if (!blob) return { score: 0, matched: false };
  const phrases = [
    account.config.social.displayName,
    account.config.social.headline,
    account.config.social.personaSummary,
    account.config.social.voiceSummary,
    ...account.config.social.audienceTypes,
  ]
    .map((entry) => normalizeText(entry))
    .filter((entry) => entry.length >= 4);
  const matched = phrases.some((phrase) => haystack.includes(phrase) || blob.includes(phrase));
  return { score: matched ? 10 : 0, matched };
}

function communityFitScore(account: OutreachAccount, community: string, haystack: string) {
  const tags = slugList(account.config.social.communityTags);
  if (!tags.length) return { score: 0, matched: false };
  const normalizedCommunity = normalizeText(community);
  const matched = tags.some((tag) => normalizedCommunity.includes(tag) || haystack.includes(tag));
  return { score: matched ? 16 : -4, matched };
}

function activityScore(account: OutreachAccount) {
  const activity24h = Math.max(0, Number(account.config.social.recentActivity24h ?? 0) || 0);
  const activity7d = Math.max(0, Number(account.config.social.recentActivity7d ?? 0) || 0);
  if (activity24h >= 1 && activity24h <= 12) return 6;
  if (activity7d >= 1 && activity7d <= 30) return 4;
  if (activity24h > 40) return -4;
  return 0;
}

function connectionScore(account: OutreachAccount) {
  if (account.config.social.connectionProvider === "unipile" && account.config.social.externalAccountId.trim()) {
    return account.config.social.displayName.trim() || account.config.social.lastProfileSyncAt.trim() ? 14 : 10;
  }
  if (account.config.social.handle.trim() || account.config.social.profileUrl.trim()) return 5;
  if (getOutreachAccountFromEmail(account).trim()) return 2;
  return 0;
}

function sourcePoolSummary(input: { assignmentSource: string; poolSize: number; accountCount: number }) {
  if (!input.accountCount) return "No social-enabled accounts are available in the current pool.";
  if (input.assignmentSource === "social_pool") {
    return `Routing is using ${input.accountCount} accounts from the dedicated social comment pool.`;
  }
  if (!input.poolSize) return "No brand-specific assignment found, so routing is using the social-enabled global account pool.";
  return `Routing is using ${input.accountCount} social-enabled accounts from the brand assignment pool.`;
}

function buildRecommendation(input: {
  account: OutreachAccount;
  actorRole: SocialDiscoveryActorRole;
  useCase: RecommendedAccount["useCase"];
  score: number;
  rationale: string;
}): RecommendedAccount {
  return {
    accountId: input.account.id,
    accountName: input.account.name,
    provider: input.account.provider,
    accountType: input.account.accountType,
    actorRole: input.actorRole,
    useCase: input.useCase,
    score: Math.round(input.score),
    handle: accountHandle(input.account),
    profileUrl: input.account.config.social.profileUrl.trim(),
    linkedProvider: input.account.config.social.linkedProvider.trim(),
    publicIdentifier: input.account.config.social.publicIdentifier.trim(),
    displayName: input.account.config.social.displayName.trim(),
    headline: input.account.config.social.headline.trim(),
    bio: input.account.config.social.bio.trim(),
    personaSummary: input.account.config.social.personaSummary.trim(),
    lastProfileSyncAt: input.account.config.social.lastProfileSyncAt.trim(),
    fromEmail: getOutreachAccountFromEmail(input.account).trim(),
    connectionProvider: input.account.config.social.connectionProvider,
    externalAccountId: input.account.config.social.externalAccountId.trim(),
    coordinationGroup: input.account.config.social.coordinationGroup.trim(),
    cooldownUntil: "",
    rationale: input.rationale,
  };
}

function scoreAccount(input: {
  account: OutreachAccount;
  post: SocialDiscoveryPost;
  desiredRole: SocialDiscoveryActorRole;
  assignedPoolIds: Set<string>;
  blockedCoordinationGroup?: string;
}) {
  if (input.account.status !== "active") return null;

  const haystack = postHaystack(input.post);
  const actualRole = inferredRole(input.account);
  const topic = topicFitScore(input.account, haystack);
  const identity = identityFitScore(input.account, haystack);
  const community = communityFitScore(input.account, input.post.community, haystack);
  const assignedBoost = input.assignedPoolIds.has(input.account.id) ? 12 : 0;
  const coordinationGroup = input.account.config.social.coordinationGroup.trim();
  const sameCoordinationPenalty =
    coordinationGroup && input.blockedCoordinationGroup && coordinationGroup === input.blockedCoordinationGroup
      ? 18
      : 0;
  const hasExplicitSocialProfile =
    input.account.config.social.enabled ||
    Boolean(
        input.account.config.social.externalAccountId.trim() ||
        input.account.config.social.handle.trim() ||
        input.account.config.social.displayName.trim() ||
        input.account.config.social.headline.trim() ||
        input.account.config.social.bio.trim() ||
        input.account.config.social.personaSummary.trim() ||
        input.account.config.social.profileUrl.trim() ||
        input.account.config.social.platforms.length ||
        input.account.config.social.topicTags.length ||
        input.account.config.social.communityTags.length
    );

  const score =
    roleFitScore(input.desiredRole, actualRole) +
    platformFitScore(input.account, input.post.platform) +
    topic.score +
    identity.score +
    community.score +
    Math.max(0, Math.min(10, Number(input.account.config.social.trustLevel ?? 0) || 0)) +
    activityScore(input.account) +
    connectionScore(input.account) +
    assignedBoost -
    sameCoordinationPenalty -
    (hasExplicitSocialProfile ? 0 : 8);

  const rationale = compactReason([
    `${actualRole} fit for ${input.desiredRole}.`,
    platformFitScore(input.account, input.post.platform) >= 0
      ? `Eligible on ${input.post.platform}.`
      : `No explicit ${input.post.platform} platform fit.`,
    topic.matched ? "Topic tags match this post." : input.account.config.social.topicTags.length ? "Topic tags are weak for this post." : "No topic tags configured yet.",
    identity.matched ? "Profile summary fits the thread." : input.account.config.social.personaSummary.trim() || input.account.config.social.headline.trim() ? "Profile summary is not a strong fit here." : "",
    community.matched
      ? "Community tags match."
      : input.account.config.social.communityTags.length
        ? "Community tags do not match this thread."
        : "",
    input.assignedPoolIds.has(input.account.id)
      ? "In the dedicated social pool."
      : "Available through the dedicated social pool.",
    !hasExplicitSocialProfile ? "Social profile metadata is incomplete, so keep manual review on." : "",
    sameCoordinationPenalty ? "Same coordination group as the primary pick, so this is downgraded." : "",
  ]);

  return {
    score,
    actualRole,
    rationale,
  };
}

async function loadAccountPool(brandId: string) {
  void brandId;
  const accounts = await listSocialRoutingAccounts();
  const activeAccounts = accounts.filter((account) => account.status === "active" && account.config.social.enabled);
  return {
    assignedPoolIds: new Set<string>(),
    accounts: activeAccounts,
    assignmentSource: "social_pool",
    requestedPoolSize: activeAccounts.length,
  };
}

function applyRoutingToPost(input: {
  post: SocialDiscoveryPost;
  accounts: OutreachAccount[];
  assignedPoolIds: Set<string>;
  assignmentSource: string;
  requestedPoolSize: number;
}) {
  const post = input.post;
  const plan = post.interactionPlan;
  const targetStrength = plan.targetStrength ?? "skip";
  const commentPosture = plan.commentPosture ?? "no_comment";

  if (!input.accounts.length) {
    return {
      ...post,
      interactionPlan: {
        ...plan,
        routingSummary: sourcePoolSummary({
          assignmentSource: input.assignmentSource,
          poolSize: input.requestedPoolSize,
          accountCount: 0,
        }),
        recommendedAccounts: [],
      },
    };
  }

  const recommended: RecommendedAccount[] = [];
  const pickBest = (
    desiredRoles: SocialDiscoveryActorRole[],
    useCase: RecommendedAccount["useCase"],
    blockedIds = new Set<string>(),
    blockedCoordinationGroup = ""
  ) => {
    const candidates = desiredRoles.flatMap((desiredRole) =>
      input.accounts
        .filter((account) => !blockedIds.has(account.id))
        .map((account) => {
          const scored = scoreAccount({
            account,
            post,
            desiredRole,
            assignedPoolIds: input.assignedPoolIds,
            blockedCoordinationGroup,
          });
          if (!scored) return null;
          return buildRecommendation({
            account,
            actorRole: desiredRole,
            useCase,
            score: scored.score,
            rationale: scored.rationale,
          });
        })
        .filter((entry): entry is RecommendedAccount => Boolean(entry))
    );
    candidates.sort((left, right) => right.score - left.score);
    return candidates[0] ?? null;
  };

  if (targetStrength === "target" && !["no_comment", "watch_only"].includes(commentPosture)) {
    const primary = pickBest(desiredPrimaryRoles(post), "primary_comment");
    if (primary) {
      recommended.push(primary);
    }
  } else if (targetStrength === "watch") {
    const watchOwner = pickBest(desiredWatchRoles(), "watch_only");
    if (watchOwner) recommended.push(watchOwner);
  }

  const routingSummary = recommended.length
    ? `${sourcePoolSummary({
        assignmentSource: input.assignmentSource,
        poolSize: input.requestedPoolSize,
        accountCount: input.accounts.length,
      })} Best current pick: ${recommended[0]?.accountName || "none"}.`
    : `${sourcePoolSummary({
        assignmentSource: input.assignmentSource,
        poolSize: input.requestedPoolSize,
        accountCount: input.accounts.length,
      })} No eligible account cleared the router for this post yet.`;

  return {
    ...post,
    interactionPlan: {
      ...plan,
      routingSummary,
      recommendedAccounts: recommended,
    },
  };
}

export async function enrichSocialPostsWithAccountRouting(input: {
  brand: BrandRecord;
  posts: SocialDiscoveryPost[];
}) {
  try {
    const pool = await loadAccountPool(input.brand.id);
    return input.posts.map((post) =>
      applyRoutingToPost({
        post,
        accounts: pool.accounts,
        assignedPoolIds: pool.assignedPoolIds,
        assignmentSource: pool.assignmentSource,
        requestedPoolSize: pool.requestedPoolSize,
      })
    );
  } catch {
    return input.posts.map((post) => ({
      ...post,
      interactionPlan: {
        ...post.interactionPlan,
        routingSummary: "Account routing is temporarily unavailable. Use manual account selection for this thread.",
        recommendedAccounts: [],
      },
    }));
  }
}
