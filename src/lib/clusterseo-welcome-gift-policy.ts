export const CLUSTERSEO_WELCOME_GIFT_SOURCE_SUFFIX = ":welcome_youtube_gift";

export type ClusterSeoWelcomeGiftCandidate = {
  id: string;
  platform: string;
  actionKind: string;
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
    targetDomains,
    perRunCap,
    configured: userIds.length > 0 && targetDomains.length > 0,
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

export function normalizeAutomatedWelcomeGiftComment(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
