export const CLUSTERSEO_WELCOME_GIFT_SOURCE_SUFFIX = ":welcome_youtube_gift";

const GENERIC_COMMENT_PHRASES = [
  "approach to",
  "covers a solid range",
  "does a good job",
  "easier to evaluate",
  "easier to follow",
  "easier to understand",
  "feels",
  "feels pretty balanced",
  "helps clarify",
  "helps keep",
  "helps understand",
  "helps you understand",
  "helpful overview",
  "interesting how",
  "it is cool how",
  "it's cool how",
  "i love how",
  "makes it easier to see",
  "nice overview",
  "isolated parts",
  "in one place",
  "in one interface",
  "juggling multiple",
  "rather than just",
  "on youtube",
  "seems",
  "solid range of features",
  "supports that",
  "thoughtfully",
  "youtube lets you",
  "share original content",
  "friends and family",
  "enjoy the videos and music",
  "great video",
  "nice video",
  "without getting overwhelming",
  "without overcomplicating",
  "workflow smooth",
  "kind of consistency",
  "is interesting",
  "the way",
  "that would help",
  "keep messages consistent",
  "as quickly as",
  "as fast as",
  "faster than",
  "knowing that matters",
  "customer experience",
  "can really affect",
  "the walkthrough of how",
  "the walkthrough shows how",
  "which matters for",
  "keeps customer communication steady",
  "handling many conversations smoothly",
];

const TITLE_CUE_STOPWORDS = new Set([
  "about",
  "bhuman",
  "create",
  "creating",
  "demo",
  "from",
  "full",
  "overview",
  "platform",
  "the",
  "this",
  "tutorial",
  "using",
  "video",
  "videos",
  "walkthrough",
  "with",
  "youtube",
]);

export type ClusterSeoWelcomeGiftCandidate = {
  id: string;
  platform: string;
  actionKind: string;
  targetPostUrl?: string;
  targetPostTitle?: string;
  targetBrandName?: string;
  targetBrandUserId: string;
  targetDomainToken: string;
  sourceProvider: string;
};

function csv(value: unknown) {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

export function normalizeClusterSeoTargetDomain(value: unknown) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  try {
    const url = new URL(raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^www\./, "").replace(/\/+$/, "");
  }
}

export function clusterSeoWelcomeGiftAutomationConfig(
  env: Record<string, string | undefined> = process.env
) {
  const enabled = ["1", "true", "yes", "on"].includes(
    String(env.CLUSTERSEO_WELCOME_GIFT_AUTOMATION_ENABLED ?? "").trim().toLowerCase()
  );
  const dryRunValue = String(env.CLUSTERSEO_WELCOME_GIFT_AUTOMATION_DRY_RUN ?? "true")
    .trim()
    .toLowerCase();
  const dryRun = !["0", "false", "no", "off"].includes(dryRunValue);
  const userIds = csv(env.CLUSTERSEO_WELCOME_GIFT_AUTOMATION_USER_IDS).filter((value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
  const accountIds = csv(env.CLUSTERSEO_WELCOME_GIFT_AUTOMATION_ACCOUNT_IDS).filter((value) =>
    /^acct_[a-z0-9]+$/i.test(value)
  );
  const targetDomains = Array.from(
    new Set(
      csv(env.CLUSTERSEO_WELCOME_GIFT_AUTOMATION_TARGET_DOMAINS)
        .map(normalizeClusterSeoTargetDomain)
        .filter(Boolean)
    )
  );
  const requestedCap = Number(env.CLUSTERSEO_WELCOME_GIFT_AUTOMATION_PER_RUN_CAP);
  const perRunCap = Math.max(1, Math.min(3, Number.isFinite(requestedCap) ? requestedCap : 1));
  return {
    enabled,
    dryRun,
    userIds,
    accountIds,
    targetDomains,
    perRunCap,
    configured: userIds.length > 0 && accountIds.length > 0 && targetDomains.length > 0,
  };
}

export function isAutomatableClusterSeoWelcomeGift(input: {
  opportunity: ClusterSeoWelcomeGiftCandidate;
  clusterUserId: string;
  targetDomains: string[];
}) {
  const opportunity = input.opportunity;
  return Boolean(
    opportunity.platform === "YOUTUBE" &&
      opportunity.actionKind === "COMMENT" &&
      opportunity.targetBrandUserId === input.clusterUserId &&
      String(opportunity.sourceProvider || "").trim().endsWith(CLUSTERSEO_WELCOME_GIFT_SOURCE_SUFFIX) &&
      input.targetDomains.includes(normalizeClusterSeoTargetDomain(opportunity.targetDomainToken))
  );
}

export function explainClusterSeoWelcomeGiftEligibility(input: {
  opportunity: ClusterSeoWelcomeGiftCandidate;
  clusterUserId: string;
  targetDomains: string[];
}) {
  const opportunity = input.opportunity;
  const targetDomain = normalizeClusterSeoTargetDomain(opportunity.targetDomainToken);
  const checks = {
    youtubeComment: opportunity.platform === "YOUTUBE" && opportunity.actionKind === "COMMENT",
    selfOwned: opportunity.targetBrandUserId === input.clusterUserId,
    welcomeGiftTagged: String(opportunity.sourceProvider || "")
      .trim()
      .endsWith(CLUSTERSEO_WELCOME_GIFT_SOURCE_SUFFIX),
    targetDomainAllowlisted: input.targetDomains.includes(targetDomain),
  };
  return {
    missionId: opportunity.id,
    targetBrandName: String(opportunity.targetBrandName || "").trim(),
    targetDomain,
    targetPostTitle: String(opportunity.targetPostTitle || "").trim(),
    targetPostUrl: String(opportunity.targetPostUrl || "").trim(),
    checks,
    eligible: Object.values(checks).every(Boolean),
  };
}

export function normalizeAutomatedWelcomeGiftComment(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCues(value: unknown, brandName: unknown) {
  const brandTokens = new Set(
    String(brandName ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
  return Array.from(
    new Set(
      String(value ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(
          (word) =>
            word.length >= 5 &&
            !TITLE_CUE_STOPWORDS.has(word) &&
            !brandTokens.has(word) &&
            !/^\d+$/.test(word)
        )
    )
  );
}

export function validateAutomatedWelcomeGiftComment(input: {
  value: unknown;
  opportunity: Pick<
    ClusterSeoWelcomeGiftCandidate,
    "targetBrandName" | "targetDomainToken" | "targetPostTitle"
  >;
}) {
  const text = normalizeAutomatedWelcomeGiftComment(input.value);
  const lower = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const commentTokens = new Set(
    lower
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
  const cues = titleCues(input.opportunity.targetPostTitle, input.opportunity.targetBrandName);
  const brandName = String(input.opportunity.targetBrandName ?? "").trim().toLowerCase();
  const domainCore = normalizeClusterSeoTargetDomain(input.opportunity.targetDomainToken)
    .split(".")[0]
    ?.replace(/[^a-z0-9]/g, "") ?? "";
  const compactText = lower.replace(/[^a-z0-9]/g, "");
  const hasOpeningViewerQuestion =
    /^(?:can|could|does|do|how|is|will|would)\b[^?]{5,}\?/i.test(text);
  const hasConcreteFriction =
    /\b(?:avoid|correct|lose|miss|rebuild|redo|re-enter|repeat|switch|wait)\w*/i.test(text);
  const reasons: string[] = [];

  if (words.length < 12) reasons.push("too_short");
  if (words.length > 40) reasons.push("too_long");
  if (GENERIC_COMMENT_PHRASES.some((phrase) => lower.includes(phrase))) {
    reasons.push("generic_comment");
  }
  if (
    !hasOpeningViewerQuestion &&
    !/\b(?:because|so|which|rather than|instead of|that means)\b/i.test(text)
  ) {
    reasons.push("missing_reason_or_implication");
  }
  if (/[!\u{1F300}-\u{1FAFF}]/u.test(text)) reasons.push("hype_or_emoji");
  if (
    !(
      (brandName && lower.includes(brandName)) ||
      (domainCore && compactText.includes(domainCore))
    )
  ) {
    reasons.push("missing_brand_mention");
  }
  if (cues.length && !cues.some((cue) => commentTokens.has(cue))) {
    reasons.push("missing_title_context");
  }
  if (!cues.length && !hasOpeningViewerQuestion) reasons.push("missing_opening_viewer_question");
  if (!cues.length && hasOpeningViewerQuestion && !hasConcreteFriction) {
    reasons.push("missing_concrete_friction");
  }

  return { text, valid: reasons.length === 0, reasons, titleCues: cues };
}
