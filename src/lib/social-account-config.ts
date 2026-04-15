import type { SocialAccountConfig, SocialLinkedProvider } from "@/lib/factory-types";

export function normalizeSocialLinkedProvider(value: unknown): SocialLinkedProvider {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "linkedin") return "linkedin";
  if (normalized === "instagram") return "instagram";
  if (normalized === "x" || normalized === "twitter") return "x";
  if (normalized === "youtube") return "youtube";
  if (normalized === "unknown") return "unknown";
  return "";
}

export function defaultSocialAccountConfig(
  overrides: Partial<SocialAccountConfig> = {}
): SocialAccountConfig {
  return {
    enabled: false,
    connectionProvider: "none",
    linkedProvider: "",
    externalAccountId: "",
    handle: "",
    profileUrl: "",
    publicIdentifier: "",
    displayName: "",
    headline: "",
    bio: "",
    avatarUrl: "",
    role: "operator",
    topicTags: [],
    communityTags: [],
    platforms: [],
    regions: [],
    languages: [],
    audienceTypes: [],
    personaSummary: "",
    voiceSummary: "",
    trustLevel: 0,
    cooldownMinutes: 120,
    linkedAt: "",
    lastProfileSyncAt: "",
    lastSocialCommentAt: "",
    recentActivity24h: 0,
    recentActivity7d: 0,
    coordinationGroup: "",
    notes: "",
    ...overrides,
  };
}

export function socialIdentitySummaryText(config: SocialAccountConfig) {
  return [
    config.displayName,
    config.handle,
    config.publicIdentifier,
    config.headline,
    config.bio,
    config.personaSummary,
    config.voiceSummary,
    config.notes,
    ...config.topicTags,
    ...config.communityTags,
    ...config.audienceTypes,
    ...config.languages,
    ...config.regions,
  ]
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function hasExplicitSocialIdentity(config: SocialAccountConfig) {
  return Boolean(
    config.enabled ||
      config.connectionProvider !== "none" ||
      config.linkedProvider ||
      config.externalAccountId.trim() ||
      config.handle.trim() ||
      config.profileUrl.trim() ||
      config.publicIdentifier.trim() ||
      config.displayName.trim() ||
      config.headline.trim() ||
      config.bio.trim() ||
      config.avatarUrl.trim() ||
      config.personaSummary.trim() ||
      config.voiceSummary.trim() ||
      config.coordinationGroup.trim() ||
      config.notes.trim() ||
      config.platforms.length ||
      config.topicTags.length ||
      config.communityTags.length ||
      config.regions.length ||
      config.languages.length ||
      config.audienceTypes.length
  );
}
