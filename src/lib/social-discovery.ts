import { createId, type BrandRecord } from "@/lib/factory-data";
import type {
  SocialDiscoveryIntent,
  SocialDiscoveryPlatform,
  SocialDiscoveryPost,
  SocialDiscoveryProvider,
} from "@/lib/social-discovery-types";

type DiscoveryError = {
  platform: SocialDiscoveryPlatform;
  query: string;
  message: string;
};

export type SocialDiscoveryRunInput = {
  brand: BrandRecord;
  provider?: SocialDiscoveryProvider | "auto";
  platforms?: SocialDiscoveryPlatform[];
  extraTerms?: string[];
  subreddits?: string[];
  limitPerQuery?: number;
  maxQueries?: number;
};

export type SocialDiscoveryRunOutput = {
  provider: SocialDiscoveryProvider;
  platforms: SocialDiscoveryPlatform[];
  queries: string[];
  posts: SocialDiscoveryPost[];
  errors: DiscoveryError[];
};

type SearchProviderHit = {
  platform: SocialDiscoveryPlatform;
  provider: SocialDiscoveryProvider;
  externalId: string;
  url: string;
  title: string;
  body: string;
  author: string;
  community: string;
  query: string;
  providerRank: number;
  raw: Record<string, unknown>;
  postedAt: string;
  engagementScore?: number;
};

const BUYING_INTENT_TERMS = [
  "alternative",
  "alternatives",
  "best",
  "recommend",
  "recommendation",
  "switch",
  "switching",
  "migrate",
  "migration",
  "vs",
  "compare",
  "pricing",
  "expensive",
  "worth it",
  "tool for",
  "software for",
  "anyone used",
  "does anyone use",
  "looking for",
];

const COMPLAINT_TERMS = [
  "broken",
  "bug",
  "issue",
  "problem",
  "hate",
  "frustrating",
  "doesn't work",
  "not working",
  "down",
  "slow",
  "support",
  "overcharged",
  "billing",
  "cancel",
];

const SOCIAL_DISCOVERY_QUERY_NOISE = [
  "app",
  "apps",
  "tool",
  "tools",
  "software",
  "platform",
  "platforms",
  "solution",
  "solutions",
  "saas",
];

const SOCIAL_DISCOVERY_AUDIENCE_ONLY_WORDS = [
  "teams",
  "team",
  "founders",
  "founder",
  "marketers",
  "marketer",
  "students",
  "student",
  "travelers",
  "traveler",
  "agencies",
  "agency",
  "operators",
  "operator",
  "consultants",
  "consultant",
  "buyers",
  "buyer",
  "women",
  "woman",
  "men",
  "man",
  "parents",
  "parent",
  "creators",
  "creator",
];

const SOCIAL_DISCOVERY_HIGH_SIGNAL_TERMS = [
  "unsafe",
  "safe",
  "safety",
  "harassment",
  "catcalling",
  "followed",
  "follow",
  "walking",
  "alone",
  "night",
  "travel",
  "rideshare",
  "transit",
  "campus",
  "pricing",
  "billing",
  "migration",
  "reporting",
  "sync",
  "outreach",
  "reply",
  "meeting",
  "personalized",
  "video",
];

const SOCIAL_DISCOVERY_INTERNAL_FEATURE_TERMS = [
  "custom",
  "verified",
  "recording",
  "guidance",
  "tracking",
  "signal",
  "signals",
  "presenter",
];

const SOCIAL_DISCOVERY_THEME_EXPANSIONS: Array<{
  triggers: string[];
  phrases: string[];
}> = [
  {
    triggers: ["safe", "unsafe", "safety", "harassment", "followed", "catcalling", "rideshare", "nightlife"],
    phrases: [
      "walking alone at night",
      "walk home at night",
      "being followed",
      "feel unsafe",
      "street harassment",
      "catcalling",
      "rideshare safety",
      "solo travel safety",
      "text me when you get home",
    ],
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function compactText(value: unknown, max = 600) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function phraseWordCount(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function normalizeDiscoveryPhrase(value: string) {
  return String(value ?? "")
    .replace(/[“”"'`]/g, "")
    .replace(/[(){}\[\]]/g, " ")
    .replace(/\s+\/\s+/g, ", ")
    .replace(/\s+-\s+/g, " ")
    .replace(/[|]/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDiscoveryFragment(value: string) {
  let next = normalizeDiscoveryPhrase(value);
  next = next
    .replace(/^\b(?:for|to|with|using|about|around|the|a|an)\b\s+/i, "")
    .replace(/\b(?:who|that|which)\b.*$/i, "")
    .replace(/\b(?:tool|tools|software|platform|platforms|solution|solutions|app|apps)\b/gi, " ")
    .replace(/^(?:women|womens|woman|girls?|female)\s+safety\b/i, "safety")
    .replace(/^[^a-z0-9]+/i, "")
    .replace(/[^a-z0-9]+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return next;
}

function isUsefulDiscoveryPhrase(value: string) {
  const next = cleanDiscoveryFragment(value);
  if (!next) return false;
  if (!/[a-z]/i.test(next)) return false;
  if (next.length < 4 || next.length > 80) return false;
  const words = phraseWordCount(next);
  if (words === 0 || words > 9) return false;
  if (SOCIAL_DISCOVERY_QUERY_NOISE.includes(next.toLowerCase())) return false;
  return true;
}

function isAudienceOnlyPhrase(value: string) {
  const normalized = cleanDiscoveryFragment(value).toLowerCase();
  if (!normalized) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 4) return false;
  return words.every((word) => SOCIAL_DISCOVERY_AUDIENCE_ONLY_WORDS.includes(word)) ||
    SOCIAL_DISCOVERY_AUDIENCE_ONLY_WORDS.includes(words[words.length - 1] ?? "");
}

function splitDiscoverySourceText(value: string) {
  const normalized = normalizeDiscoveryPhrase(value);
  const matchedSlices = [
    ...Array.from(normalized.matchAll(/\bto help\s+([^,.;]+)/gi), (match) => match[1] ?? ""),
    ...Array.from(normalized.matchAll(/\bfor\s+([^,.;]+)/gi), (match) => match[1] ?? ""),
    ...Array.from(normalized.matchAll(/\bwith\s+([^,.;]+)/gi), (match) => match[1] ?? ""),
    ...Array.from(normalized.matchAll(/\bwhen\s+([^,.;]+)/gi), (match) => match[1] ?? ""),
  ];
  return [normalized, ...matchedSlices]
    .flatMap((entry) => entry.split(/[,;\n]|(?:\s+and\s+)|(?:\s+or\s+)|(?:\s+\/\s+)/i))
    .map((entry) => cleanDiscoveryFragment(entry))
    .filter(Boolean);
}

function discoveryPhraseScore(value: string) {
  const normalized = cleanDiscoveryFragment(value).toLowerCase();
  const words = phraseWordCount(normalized);
  let score = 0;
  if (SOCIAL_DISCOVERY_HIGH_SIGNAL_TERMS.some((term) => normalized.includes(term))) score += 20;
  if (words >= 2 && words <= 5) score += 10;
  if (words === 1) score -= 8;
  if (words > 6) score -= 8;
  if (normalized.includes(" for ")) score -= 6;
  if (normalized.includes("to help")) score -= 10;
  if (normalized.includes("guidance") || normalized.includes("recording")) score -= 6;
  if (SOCIAL_DISCOVERY_INTERNAL_FEATURE_TERMS.some((term) => normalized.includes(term))) score -= 10;
  if (/^(?:women|womens|woman|girls?|female|students?|teams?)\b/.test(normalized)) score -= 8;
  if (isAudienceOnlyPhrase(normalized)) score -= 20;
  return score;
}

function collectDiscoveryPhrases(values: string[], max = 12) {
  const phrases = uniqueStrings(
    values.flatMap((value) => {
      const root = cleanDiscoveryFragment(value);
      const fragments = splitDiscoverySourceText(value);
      return [root, ...fragments];
    })
  )
    .filter(isUsefulDiscoveryPhrase)
    .sort((left, right) => discoveryPhraseScore(right) - discoveryPhraseScore(left));
  return phrases.slice(0, max);
}

function inferDiscoveryThemePhrases(brand: BrandRecord) {
  const text = [
    brand.name,
    brand.product,
    brand.notes,
    ...brand.targetMarkets,
    ...brand.idealCustomerProfiles,
    ...brand.keyFeatures,
    ...brand.keyBenefits,
  ]
    .join(" ")
    .toLowerCase();

  return uniqueStrings(
    SOCIAL_DISCOVERY_THEME_EXPANSIONS.flatMap((entry) =>
      entry.triggers.some((trigger) => text.includes(trigger)) ? entry.phrases : []
    )
  );
}

function buildVariantQueries(input: {
  phrases: string[];
  maxQueries: number;
  builders: Array<(phrase: string) => string>;
}) {
  const queries: string[] = [];
  for (const build of input.builders) {
    for (const phrase of input.phrases) {
      const next = build(phrase).trim();
      if (!next) continue;
      queries.push(next);
      if (uniqueStrings(queries).length >= input.maxQueries) {
        return uniqueStrings(queries).slice(0, input.maxQueries);
      }
    }
  }
  return uniqueStrings(queries).slice(0, input.maxQueries);
}

function buildInstagramDiscoveryQueries(phrases: string[], maxQueries: number) {
  const clean = uniqueStrings(
    phrases
      .map((phrase) => cleanDiscoveryFragment(phrase))
      .filter(isUsefulDiscoveryPhrase)
      .filter((phrase) => !isAudienceOnlyPhrase(phrase))
  );
  return buildVariantQueries({
    phrases: clean,
    maxQueries,
    builders: [
      (phrase) => phrase,
      (phrase) => `${phrase} tips`,
      (phrase) => `${phrase} advice`,
      (phrase) => `${phrase} experience`,
      (phrase) => `${phrase} story`,
    ],
  })
    .map((query) => query.replace(/["]/g, "").slice(0, 80))
    .slice(0, maxQueries);
}

function buildDiscussionDiscoveryQueries(phrases: string[], maxQueries: number) {
  const clean = uniqueStrings(
    phrases
      .map((phrase) => cleanDiscoveryFragment(phrase))
      .filter(isUsefulDiscoveryPhrase)
      .filter((phrase) => !isAudienceOnlyPhrase(phrase))
  );
  return buildVariantQueries({
    phrases: clean,
    maxQueries,
    builders: [
      (phrase) => quoteQueryTerm(phrase),
      (phrase) => `${quoteQueryTerm(phrase)} advice`,
      (phrase) => `${quoteQueryTerm(phrase)} help`,
      (phrase) => `${quoteQueryTerm(phrase)} experience`,
      (phrase) => `${quoteQueryTerm(phrase)} anyone else`,
    ],
  }).slice(0, maxQueries);
}

function sparseDiscoveryMinResults(platform: SocialDiscoveryPlatform) {
  const fallback = platform === "instagram" ? 6 : 4;
  return Math.max(1, Math.min(25, Number(process.env.SOCIAL_DISCOVERY_FALLBACK_MIN_RESULTS ?? fallback) || fallback));
}

function sparseDiscoveryFallbackLimit(platform: SocialDiscoveryPlatform) {
  const fallback = platform === "instagram" ? 8 : 4;
  return Math.max(1, Math.min(20, Number(process.env.SOCIAL_DISCOVERY_FALLBACK_QUERY_LIMIT ?? fallback) || fallback));
}

function extractSparsePhraseVariants(value: string) {
  const phrase = cleanDiscoveryFragment(value);
  if (!phrase) return [];
  const variants = new Set<string>([phrase]);

  const normalized = phrase.toLowerCase();
  if (normalized.includes("street harassment")) variants.add("street harassment");
  if (normalized.includes("catcalling")) variants.add("catcalling");
  if (normalized.includes("being followed") || normalized.includes("worried about being followed")) {
    variants.add("being followed");
    variants.add("followed me");
  }
  if (normalized.includes("feel unsafe") || normalized.includes("feeling unsafe") || normalized.includes("unsafe")) {
    variants.add("feel unsafe");
    variants.add("feeling unsafe");
  }
  if (normalized.includes("walking alone") || normalized.includes("walk home")) {
    variants.add("walking alone at night");
    variants.add("walk home at night");
  }
  if (normalized.includes("rideshare") || normalized.includes("uber") || normalized.includes("lyft")) {
    variants.add("rideshare safety");
    variants.add("uber safety");
  }
  if (normalized.includes("solo travel") || normalized.includes("solo traveler")) {
    variants.add("solo travel safety");
  }
  if (normalized.includes("text me when you get home")) {
    variants.add("text me when you get home");
  }

  variants.add(
    phrase
      .replace(/^(womens?|women|girls)\s+/i, "")
      .replace(/^(prevent|avoiding|avoid|practical|more confidence|fast|better)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim()
  );

  return Array.from(variants).filter(isUsefulDiscoveryPhrase).filter((entry) => !isAudienceOnlyPhrase(entry));
}

function buildSparseDiscoveryFallbackQueries(input: {
  brand: BrandRecord;
  extraTerms?: string[];
  platform: SocialDiscoveryPlatform;
  maxQueries: number;
  existingQueries?: string[];
}) {
  const existingNormalized = new Set(
    (input.existingQueries ?? [])
      .map((query) => cleanDiscoveryFragment(query).toLowerCase())
      .filter(Boolean)
  );
  const sourcePhrases = uniqueStrings([
    ...collectDiscoveryPhrases(
      [
        input.brand.product,
        input.brand.notes,
        ...input.brand.keyFeatures,
        ...input.brand.keyBenefits,
        ...input.brand.targetMarkets,
        ...input.brand.idealCustomerProfiles,
        ...(input.extraTerms ?? []),
        ...inferDiscoveryThemePhrases(input.brand),
      ],
      16
    ),
    ...inferDiscoveryThemePhrases(input.brand),
  ]);
  const fallbackPhrases = uniqueStrings(sourcePhrases.flatMap(extractSparsePhraseVariants)).filter((phrase) => {
    const normalized = cleanDiscoveryFragment(phrase).toLowerCase();
    return Boolean(normalized) && !existingNormalized.has(normalized);
  });
  const directQueries = uniqueStrings(
    fallbackPhrases
      .map((phrase) => cleanDiscoveryFragment(phrase))
      .filter(isUsefulDiscoveryPhrase)
      .filter((phrase) => !isAudienceOnlyPhrase(phrase))
  );
  const extraVariantQueries =
    input.platform === "instagram"
      ? buildVariantQueries({
          phrases: directQueries,
          maxQueries: Math.max(input.maxQueries * 2, 8),
          builders: [
            (phrase) => `${phrase} tips`,
            (phrase) => `${phrase} advice`,
            (phrase) => `${phrase} experience`,
            (phrase) => `${phrase} story`,
          ],
        }).map((query) => query.replace(/["]/g, "").slice(0, 80))
      : buildVariantQueries({
          phrases: directQueries,
          maxQueries: Math.max(input.maxQueries * 2, 8),
          builders: [
            (phrase) => `${quoteQueryTerm(phrase)} advice`,
            (phrase) => `${quoteQueryTerm(phrase)} help`,
            (phrase) => `${quoteQueryTerm(phrase)} experience`,
            (phrase) => `${quoteQueryTerm(phrase)} anyone else`,
          ],
        });
  const existing = new Set((input.existingQueries ?? []).map((query) => query.trim().toLowerCase()));
  return uniqueStrings([...directQueries, ...extraVariantQueries])
    .filter((query) => !existing.has(query.trim().toLowerCase()))
    .slice(0, input.maxQueries);
}

function hostnameFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function stripMarketingSuffix(value: string) {
  return value
    .replace(/\s+\|\s+.*$/, "")
    .replace(/\s+-\s+.*$/, "")
    .trim();
}

function quoteQueryTerm(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /\s/.test(trimmed) ? `"${trimmed.replace(/"/g, "")}"` : trimmed;
}

function socialDiscoveryLookbackHours() {
  return Math.max(6, Math.min(168, Number(process.env.SOCIAL_DISCOVERY_LOOKBACK_HOURS ?? 36) || 36));
}

function isoHoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

function platformFromUrl(url: string): SocialDiscoveryPlatform | null {
  const host = hostnameFromUrl(url);
  if (host === "reddit.com" || host.endsWith(".reddit.com")) return "reddit";
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
  return null;
}

function isInstagramContentUrl(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const head = (parts[0] ?? "").toLowerCase();
    return head === "p" || head === "reel" || head === "tv";
  } catch {
    return false;
  }
}

function communityFromUrl(url: string, platform: SocialDiscoveryPlatform) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (platform === "reddit") {
      const subredditIndex = parts.findIndex((part) => part.toLowerCase() === "r");
      const subreddit = subredditIndex >= 0 ? parts[subredditIndex + 1] : "";
      return subreddit ? `r/${subreddit}` : "reddit";
    }
    if (platform === "instagram") {
      const first = parts[0] ?? "";
      if (["p", "reel", "tv"].includes(first.toLowerCase())) return "instagram";
      return first ? `@${first}` : "instagram";
    }
  } catch {
    // fall through
  }
  return platform;
}

function textIncludesAny(text: string, terms: string[]) {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term.toLowerCase()));
}

function matchedTermsFor(input: { text: string; brand: BrandRecord; query: string; extraTerms?: string[] }) {
  const brandTerms = buildBrandTerms(input.brand, input.extraTerms);
  const terms = uniqueStrings([...brandTerms, ...input.query.split(/\s+/).map((part) => part.replace(/["()+]/g, ""))])
    .filter((term) => term.length >= 3)
    .slice(0, 40);
  const normalizedText = input.text.toLowerCase();
  return terms.filter((term) => normalizedText.includes(term.toLowerCase()));
}

function classifyIntent(input: {
  text: string;
  brand: BrandRecord;
  matchedTerms: string[];
  query: string;
}): SocialDiscoveryIntent {
  const text = input.text.toLowerCase();
  const brandName = input.brand.name.trim().toLowerCase();
  const brandHit = Boolean(brandName && text.includes(brandName));
  const queryLooksCompetitor = /alternative|vs|switch|migrate|pricing|billing|broken|issue/i.test(input.query);
  const hasBuyingIntent = textIncludesAny(text, BUYING_INTENT_TERMS);
  const hasComplaint = textIncludesAny(text, COMPLAINT_TERMS);

  if (brandHit) return "brand_mention";
  if (queryLooksCompetitor && hasComplaint) return "competitor_complaint";
  if (hasBuyingIntent && /\?|\b(anyone|best|recommend|looking|which|what)\b/.test(text)) return "buyer_question";
  if (hasBuyingIntent || input.matchedTerms.length >= 2) return "category_intent";
  return "noise";
}

function relevanceScore(input: {
  text: string;
  brand: BrandRecord;
  matchedTerms: string[];
  intent: SocialDiscoveryIntent;
  engagement: number;
}) {
  const text = input.text.toLowerCase();
  let score = 0;
  score += Math.min(30, input.matchedTerms.length * 8);
  if (input.intent === "brand_mention") score += 32;
  if (input.intent === "buyer_question") score += 38;
  if (input.intent === "competitor_complaint") score += 42;
  if (input.intent === "category_intent") score += 24;
  if (textIncludesAny(text, BUYING_INTENT_TERMS)) score += 18;
  if (textIncludesAny(text, COMPLAINT_TERMS)) score += 14;
  if (/\?/.test(text)) score += 8;
  score += Math.min(10, Math.round(Math.log10(input.engagement + 1) * 4));
  return Math.max(0, Math.min(100, score));
}

function recencyScore(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 12;
  const ageHours = Math.max(0, (Date.now() - parsed) / (60 * 60 * 1000));
  if (ageHours <= 12) return 35;
  if (ageHours <= 24) return 30;
  if (ageHours <= 48) return 22;
  if (ageHours <= 72) return 14;
  return 6;
}

function rankScore(providerRank: number) {
  if (!providerRank) return 10;
  if (providerRank <= 3) return 28;
  if (providerRank <= 8) return 22;
  if (providerRank <= 15) return 16;
  if (providerRank <= 30) return 10;
  return 4;
}

function ageHoursFor(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, (Date.now() - parsed) / (60 * 60 * 1000));
}

function instagramMomentumAdjustment(input: {
  platform: SocialDiscoveryPlatform;
  engagementScore: number;
  postedAt: string;
}) {
  if (input.platform !== "instagram") return 0;
  const ageHours = ageHoursFor(input.postedAt);
  if (ageHours == null) {
    return input.engagementScore > 0
      ? Math.min(10, Math.round(Math.log10(input.engagementScore + 1) * 4))
      : 0;
  }

  const perHour = input.engagementScore / Math.max(ageHours, 0.5);
  let score = 0;

  if (perHour >= 80) score += 24;
  else if (perHour >= 30) score += 16;
  else if (perHour >= 10) score += 8;
  else if (perHour < 2 && ageHours >= 6) score -= 12;

  if (ageHours >= 18 && input.engagementScore < 15) score -= 30;
  else if (ageHours >= 12 && input.engagementScore < 10) score -= 24;
  else if (ageHours >= 6 && input.engagementScore < 5) score -= 16;

  return score;
}

function shouldRejectInstagramSemanticNoise(input: {
  platform: SocialDiscoveryPlatform;
  query: string;
  title: string;
  body: string;
}) {
  if (input.platform !== "instagram") return false;

  const query = input.query.toLowerCase();
  const text = `${input.title}\n${input.body}`.toLowerCase();
  const hasLiteralSafetyContext =
    /\b(unsafe|safety|harass|catcall|stalk|followed home|walking alone|walk home|night walk|rideshare|uber|lyft|transit|parking|campus|bystander|creep|creepy|scared|threat|assault|victim|street)\b/i.test(
      text
    );
  const hasPracticalContext =
    /\b(anyone|how do you|what do you do|tips|advice|need to vent|vent|complain|report|keep those around you safe|bystander)\b/i.test(
      text
    );

  if (query.includes("being followed")) {
    const metaphoricalFollow =
      /\b(leadership|on the track|track\.|follow your|followers\b|followed for years|followed by other artists|being social|haunted by|meant to be followed|created not followed)\b/i.test(
        text
      );
    if (metaphoricalFollow && !hasLiteralSafetyContext) return true;
  }

  if (query.includes("walking alone at night")) {
    const nightWalkVibes =
      /\b(heals me|romantic vibe|peaceful|clearing my mind|surrender|night walk vibes|lovers|spouse|cute|lonely romantic|feel better someday|wandering at night)\b/i.test(
        text
      );
    if (nightWalkVibes && !hasLiteralSafetyContext) return true;
  }

  if (query.includes("someone feels unsafe") || query.includes("helping when someone feels unsafe")) {
    const therapyOrDomesticSurface =
      /\b(emotionally unsafe|emotionally cold|anxiety|trauma|therapist|therapy|nervous system|relationship|partner|wounds|support is available|advocates are here|domestic|family violence|shelter|hotline)\b/i.test(
        text
      );
    if (therapyOrDomesticSurface) return true;
  }

  if (query.includes("street harassment")) {
    const politicalOrLegalSurface =
      /\b(israel|palestin|baby k\*llers|blood libel|court|sentenced|charged|law has changed|criminali[sz]ed|bill|parliament|government)\b/i.test(
        text
      );
    if (politicalOrLegalSurface && !hasPracticalContext) return true;
  }

  if (query.includes("rideshare safety")) {
    const hardNewsSurface =
      /\b(police say|found dead|sentenced|court|charged|murder|killed|fatal|news)\b/i.test(text);
    if (hardNewsSurface && !hasPracticalContext) return true;
  }

  return false;
}

function shouldRejectWeakInstagramCandidate(input: {
  platform: SocialDiscoveryPlatform;
  engagementScore: number;
  postedAt: string;
}) {
  if (input.platform !== "instagram") return false;
  const ageHours = ageHoursFor(input.postedAt);
  if (ageHours == null) return input.engagementScore < 20;
  if (ageHours >= 18 && input.engagementScore < 15) return true;
  if (ageHours >= 12 && input.engagementScore < 10) return true;
  if (ageHours >= 6 && input.engagementScore < 5) return true;
  return false;
}

function capInstagramRisingScore(input: {
  platform: SocialDiscoveryPlatform;
  engagementScore: number;
  postedAt: string;
  risingScore: number;
}) {
  if (input.platform !== "instagram") return input.risingScore;
  const ageHours = ageHoursFor(input.postedAt);
  if (ageHours == null) return Math.min(input.risingScore, 65);
  if (ageHours >= 24) return Math.min(input.risingScore, 60);
  if (ageHours >= 12 && input.engagementScore < 30) return Math.min(input.risingScore, 68);
  return input.risingScore;
}

function risingPotentialScore(input: {
  platform: SocialDiscoveryPlatform;
  intent: SocialDiscoveryIntent;
  relevanceScore: number;
  providerRank: number;
  postedAt: string;
  engagementScore: number;
  text: string;
}) {
  let score = 0;
  score += recencyScore(input.postedAt);
  score += rankScore(input.providerRank);
  score += Math.round(input.relevanceScore * 0.25);
  score += instagramMomentumAdjustment({
    platform: input.platform,
    engagementScore: input.engagementScore,
    postedAt: input.postedAt,
  });
  if (input.intent === "buyer_question") score += 18;
  if (input.intent === "competitor_complaint") score += 18;
  if (input.intent === "brand_mention") score += 12;
  if (input.intent === "category_intent") score += 10;
  if (/\?/.test(input.text)) score += 5;
  if (/\b(launch|launched|funding|raised|down|outage|broken|alternative|recommend|best)\b/i.test(input.text)) score += 8;
  score += input.platform === "reddit" ? 6 : 4;
  return Math.max(0, Math.min(100, score));
}

function assetForIntent(intent: SocialDiscoveryIntent) {
  if (intent === "competitor_complaint") return "failure-mode teardown or migration checklist";
  if (intent === "buyer_question") return "comparison matrix or use-case fit finder";
  if (intent === "brand_mention") return "public proof note or category explainer";
  if (intent === "category_intent") return "benchmark card or hidden-cost checker";
  return "short neutral diagnostic";
}

type InteractionTargetStrength = "target" | "watch" | "skip";
type InteractionMentionPolicy = "no_mention" | "mention_only_if_asked" | "possible_soft_mention" | "never_mention";
type InteractionCommentPosture = "method_first" | "empathy_first" | "question_first" | "watch_only" | "no_comment";
type EnrichedInteractionPlan = SocialDiscoveryPost["interactionPlan"] & {
  targetStrength: InteractionTargetStrength;
  commentPosture: InteractionCommentPosture;
  mentionPolicy: InteractionMentionPolicy;
  analyticsTag: string;
  exitRules: string[];
};

function slugForAnalytics(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "social_post";
}

function postCodeFromUrl(value: string) {
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    const markerIndex = parts.findIndex((part) => ["p", "reel", "tv"].includes(part.toLowerCase()));
    return markerIndex >= 0 ? parts[markerIndex + 1] ?? "" : "";
  } catch {
    return "";
  }
}

function interactionTargetStrength(input: {
  risingScore: number;
  relevanceScore: number;
  engagementScore: number;
  postedAt: string;
  intent: SocialDiscoveryIntent;
}): InteractionTargetStrength {
  if (input.intent === "noise") return "skip";
  if (input.risingScore >= 74 && input.relevanceScore >= 35) return "target";
  if (input.risingScore >= 58 && input.relevanceScore >= 25) return "watch";
  if (!input.postedAt && input.engagementScore >= 80 && input.relevanceScore >= 35) return "watch";
  return "skip";
}

function interactionPosture(input: {
  targetStrength: InteractionTargetStrength;
  text: string;
  query: string;
}): InteractionCommentPosture {
  if (input.targetStrength === "skip") return "no_comment";
  const text = input.text.toLowerCase();
  if (/\b(what do you|how do you|anyone|tips|advice|\?)\b/i.test(text)) return "question_first";
  if (/\b(harass|catcall|stalk|unsafe|scared|followed|bystander|vent)\b/i.test(text)) return "empathy_first";
  if (input.query.includes("street harassment") || input.query.includes("rideshare")) return "method_first";
  return input.targetStrength === "target" ? "method_first" : "watch_only";
}

function mentionPolicyForPlan(input: {
  targetStrength: InteractionTargetStrength;
  intent: SocialDiscoveryIntent;
  text: string;
}): InteractionMentionPolicy {
  if (input.targetStrength === "skip") return "never_mention";
  const text = input.text.toLowerCase();
  if (/\b(app|tool|what do you use|recommend|solution|resource|checklist)\b/i.test(text)) {
    return input.intent === "buyer_question" ? "possible_soft_mention" : "mention_only_if_asked";
  }
  return "mention_only_if_asked";
}

function firstCommentDraft(input: {
  brand: BrandRecord;
  query: string;
  text: string;
  posture: InteractionCommentPosture;
}) {
  const text = input.text.toLowerCase();
  if (input.posture === "no_comment" || input.posture === "watch_only") {
    return "Do not comment yet. Watch for a concrete question or a practical safety-method thread before entering.";
  }
  if (/\bbystander\b/i.test(text)) {
    return "The part people underrate is how much everyone freezes in the moment. The best bystander help is usually short and specific: 'want to stand with us?', 'do you want me to call someone?', or 'I can wait with you here.'";
  }
  if (input.query.includes("rideshare")) {
    return "The useful rideshare safety prep is deciding the fallback before the ride: share trip status, keep a call-ready contact, and know exactly when you switch from 'uncomfortable' to 'I need help now.'";
  }
  if (input.query.includes("walking alone") || /\bwalk(?:ing)? alone\b/i.test(text)) {
    return "A lot of walking-alone advice is too vague. The practical layer is deciding the signal in advance: who gets your location, what phrase means 'call me now,' and where you move if someone keeps following.";
  }
  if (input.query.includes("street harassment") || /\bharass|catcall\b/i.test(text)) {
    return "One thing that helps is making the next step pre-decided before the moment: ignore and move, ask a nearby person to stand with you, start a call, or share location. The freeze response is real, so scripts matter.";
  }
  return "The practical thing is to decide the action before the stressful moment, not during it. A short signal, one trusted contact, and a fallback location usually matter more than another generic tip.";
}

function followUpDraft(input: {
  brand: BrandRecord;
  mentionPolicy: InteractionMentionPolicy;
}) {
  if (input.mentionPolicy === "possible_soft_mention") {
    return `If someone asks for tools, answer transparently: "One pattern is a quick safety-signal flow: location + call trigger + trusted contact. ${input.brand.name} is built around that, but the habit matters more than the app."`;
  }
  if (input.mentionPolicy === "mention_only_if_asked") {
    return `Only if someone directly asks for tools/apps: "One pattern is a safety-signal flow: location + call trigger + trusted contact. ${input.brand.name} takes that approach, but the checklist works even without an app."`;
  }
  return "Do not mention the product. If the thread needs a follow-up, add one practical safety-method detail and leave.";
}

function buildInteractionPlan(input: {
  post: Pick<
    SocialDiscoveryPost,
    "title" | "body" | "intent" | "platform" | "query" | "url" | "risingScore" | "relevanceScore" | "engagementScore" | "postedAt"
  >;
  brand: BrandRecord;
}): EnrichedInteractionPlan {
  const asset = assetForIntent(input.post.intent);
  const text = `${input.post.title}\n${input.post.body}`;
  const targetStrength = interactionTargetStrength({
    risingScore: input.post.risingScore,
    relevanceScore: input.post.relevanceScore,
    engagementScore: input.post.engagementScore,
    postedAt: input.post.postedAt,
    intent: input.post.intent,
  });
  const commentPosture = interactionPosture({
    targetStrength,
    text,
    query: input.post.query,
  });
  const mentionPolicy = mentionPolicyForPlan({
    targetStrength,
    intent: input.post.intent,
    text,
  });
  const code = postCodeFromUrl(input.post.url);
  const analyticsTag = [
    "utm_source=instagram",
    "utm_medium=comment",
    `utm_campaign=${slugForAnalytics(input.brand.name)}`,
    `utm_content=${slugForAnalytics(code || input.post.query)}`,
  ].join("&");
  const actors: SocialDiscoveryPost["interactionPlan"]["actors"] = [
    {
      role: "operator",
      job: targetStrength === "target"
        ? "Use one real operator account to add a useful first comment without mentioning the product."
        : "Watch only unless a concrete practical question appears.",
    },
    {
      role: "specialist",
      job: "Only add a second real-role reply if someone asks a practical follow-up. Do not manufacture a prompt.",
    },
  ];
  return {
    headline: `${targetStrength} ${input.post.platform} ${input.post.intent.replace(/_/g, " ")} plan`,
    targetStrength,
    commentPosture,
    mentionPolicy,
    analyticsTag,
    exitRules: [
      "Do not comment if the post is trauma-heavy, an active emergency, minors-focused, or turning political.",
      "Do not mention the product in the first comment.",
      "Do not use a second actor unless it is a real person adding real context.",
      "Do not bump the thread if nobody replies.",
    ],
    actors,
    sequence: [
      {
        actorRole: "operator",
        timing: targetStrength === "target" ? "0-30 min after approval" : "watch; no immediate comment",
        move: commentPosture,
        draft: firstCommentDraft({
          brand: input.brand,
          query: input.post.query,
          text,
          posture: commentPosture,
        }),
      },
      {
        actorRole: "specialist",
        timing: "only after someone asks for a concrete method, resource, or tool",
        move: mentionPolicy,
        draft: followUpDraft({
          brand: input.brand,
          mentionPolicy,
        }),
      },
    ],
    assetNeeded: mentionPolicy === "no_mention" || mentionPolicy === "never_mention" ? "none" : asset,
    riskNotes: [
      "Use real operators only; do not fake customer experience.",
      "Do not ask anyone to endorse a product they have not used.",
      "Do not stage a question-and-answer sequence across planted accounts.",
      "If the brand or asset is mentioned, disclose the relationship if asked.",
    ],
  };
}

function buildBrandTerms(brand: BrandRecord, extraTerms: string[] = []) {
  const hostname = hostnameFromUrl(brand.website);
  const hostnameParts = hostname ? [hostname, hostname.replace(/\.[a-z]+$/, "")] : [];
  return uniqueStrings([
    brand.name,
    stripMarketingSuffix(brand.name),
    ...hostnameParts,
    brand.product.split(/[,.]/)[0] ?? "",
    ...brand.keyFeatures.slice(0, 6),
    ...brand.keyBenefits.slice(0, 4),
    ...brand.targetMarkets.slice(0, 4),
    ...brand.idealCustomerProfiles.slice(0, 4),
    ...extraTerms,
  ]).filter((term) => term.length >= 3);
}

export function buildSocialDiscoveryQueries(input: {
  brand: BrandRecord;
  extraTerms?: string[];
  maxQueries?: number;
  platform?: SocialDiscoveryPlatform;
}) {
  const maxQueries = Math.max(1, Math.min(40, Number(input.maxQueries ?? 12) || 12));
  const terms = buildBrandTerms(input.brand, input.extraTerms);
  const brandTerms = terms.slice(0, input.platform === "instagram" ? 1 : 3);
  const marketTerms = collectDiscoveryPhrases(
    [...input.brand.targetMarkets, ...input.brand.idealCustomerProfiles],
    8
  );
  const problemTerms = collectDiscoveryPhrases(
    [
      input.brand.product,
      input.brand.notes,
      ...input.brand.keyFeatures,
      ...input.brand.keyBenefits,
      ...(input.extraTerms ?? []),
      ...inferDiscoveryThemePhrases(input.brand),
    ],
    12
  );
  const queries: string[] = [];

  const discoveryPhrases = uniqueStrings([...problemTerms, ...marketTerms]);
  queries.push(
    ...(input.platform === "instagram"
      ? buildInstagramDiscoveryQueries(discoveryPhrases, maxQueries)
      : buildDiscussionDiscoveryQueries(discoveryPhrases, maxQueries))
  );

  for (const term of brandTerms) {
    queries.push(quoteQueryTerm(term));
    if (input.platform !== "instagram") {
      queries.push(`${quoteQueryTerm(term)} alternative`);
      queries.push(`${quoteQueryTerm(term)} pricing`);
    }
  }

  if (input.platform === "instagram") {
    return uniqueStrings(queries.map((query) => query.replace(/["]/g, "").slice(0, 80))).slice(0, maxQueries);
  }

  return uniqueStrings(queries).slice(0, maxQueries);
}

export function parseSocialDiscoveryPlatforms(value: unknown): SocialDiscoveryPlatform[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const platforms = raw
    .map((entry) => String(entry ?? "").trim().toLowerCase())
    .filter((entry) => entry === "reddit" || entry === "instagram") as SocialDiscoveryPlatform[];
  return platforms.length ? uniqueStrings(platforms) as SocialDiscoveryPlatform[] : ["reddit", "instagram"];
}

function postWithScoring(input: Omit<
  SocialDiscoveryPost,
  "matchedTerms" | "intent" | "relevanceScore" | "risingScore" | "status" | "interactionPlan"
> & {
  brand: BrandRecord;
}) : SocialDiscoveryPost | null {
  const combinedText = `${input.title}\n${input.body}\n${input.community}`;
  const effectivePostedAt =
    input.postedAt || (input.platform === "instagram" ? "" : input.discoveredAt);
  const matchedTerms = matchedTermsFor({ text: combinedText, brand: input.brand, query: input.query });
  const intent = classifyIntent({ text: combinedText, brand: input.brand, matchedTerms, query: input.query });
  const score = relevanceScore({
    text: combinedText,
    brand: input.brand,
    matchedTerms,
    intent,
    engagement: input.engagementScore,
  });
  const risingScore = risingPotentialScore({
    platform: input.platform,
    intent,
    relevanceScore: score,
    providerRank: input.providerRank,
    postedAt: effectivePostedAt,
    engagementScore: input.engagementScore,
    text: combinedText,
  });
  if (shouldRejectWeakInstagramCandidate({
    platform: input.platform,
    engagementScore: input.engagementScore,
    postedAt: effectivePostedAt,
  })) {
    return null;
  }
  if (shouldRejectInstagramSemanticNoise({
    platform: input.platform,
    query: input.query,
    title: input.title,
    body: input.body,
  })) {
    return null;
  }
  const cappedRisingScore = capInstagramRisingScore({
    platform: input.platform,
    engagementScore: input.engagementScore,
    postedAt: effectivePostedAt,
    risingScore,
  });
  const { brand: _brand, ...post } = input;
  void _brand;
  const scoredPost = {
    ...post,
    matchedTerms,
    intent,
    relevanceScore: score,
    risingScore: cappedRisingScore,
    status: "new" as const,
  };
  return {
    ...scoredPost,
    interactionPlan: buildInteractionPlan({ post: scoredPost, brand: input.brand }),
  };
}

function exaApiKey() {
  return String(process.env.EXA_API_KEY ?? process.env.EXA_API_TOKEN ?? "").trim();
}

function dataForSeoCredentials() {
  const login =
    String(process.env.DATAFORSEO_LOGIN ?? "").trim() ||
    String(process.env.DATAFORSEO_USERNAME ?? "").trim() ||
    String(process.env.DATAFORSEO_EMAIL ?? "").trim();
  const password =
    String(process.env.DATAFORSEO_PASSWORD ?? "").trim() ||
    String(process.env.DATAFORSEO_API_PASSWORD ?? "").trim();
  return login && password ? { login, password } : null;
}

function resolveSearchProvider(preference: SocialDiscoveryProvider | "auto" | undefined): SocialDiscoveryProvider {
  if (preference === "exa" || preference === "dataforseo") return preference;
  if (exaApiKey()) return "exa";
  if (dataForSeoCredentials()) return "dataforseo";
  return "exa";
}

function providerDomains(platform: SocialDiscoveryPlatform) {
  return platform === "reddit" ? ["reddit.com"] : ["instagram.com"];
}

function buildDataForSeoKeyword(input: { platform: SocialDiscoveryPlatform; query: string }) {
  const siteFilter =
    input.platform === "reddit"
      ? "site:reddit.com/r"
      : "(site:instagram.com/p/ OR site:instagram.com/reel/)";
  return `${siteFilter} ${input.query}`.trim();
}

function buildDataForSeoSearchParam(lookbackHours: number) {
  if (lookbackHours <= 1) return "tbs=qdr:h";
  if (lookbackHours <= 24) return "tbs=qdr:d";
  if (lookbackHours <= 24 * 7) return "tbs=qdr:w";
  if (lookbackHours <= 24 * 31) return "tbs=qdr:m";
  return "tbs=qdr:y";
}

function normalizeProviderHit(input: {
  hit: SearchProviderHit;
  brand: BrandRecord;
  discoveredAt: string;
}): SocialDiscoveryPost | null {
  const platform = platformFromUrl(input.hit.url) ?? input.hit.platform;
  if (platform !== input.hit.platform) return null;
  if (platform === "instagram" && !isInstagramContentUrl(input.hit.url)) return null;
  const externalId = input.hit.externalId || normalizeUrl(input.hit.url);
  const title = compactText(input.hit.title || input.hit.body.split(/[.!?\n]/)[0] || `${platform} result`, 500);
  if (!externalId || !input.hit.url || !title) return null;
  return postWithScoring({
    id: createId("socialpost"),
    brandId: input.brand.id,
    platform,
    provider: input.hit.provider,
    externalId,
    url: normalizeUrl(input.hit.url),
    title,
    body: compactText(input.hit.body, 1200),
    author: input.hit.author,
    community: input.hit.community || communityFromUrl(input.hit.url, platform),
    query: input.hit.query,
    engagementScore: Math.max(0, Number(input.hit.engagementScore ?? 0) || 0),
    providerRank: input.hit.providerRank,
    raw: input.hit.raw,
    postedAt: input.hit.postedAt,
    discoveredAt: input.discoveredAt,
    updatedAt: input.discoveredAt,
    brand: input.brand,
  });
}

async function discoverPostsWithExa(input: {
  brand: BrandRecord;
  platform: SocialDiscoveryPlatform;
  query: string;
  limit: number;
}): Promise<SocialDiscoveryPost[]> {
  const apiKey = exaApiKey();
  if (!apiKey) throw new Error("Set EXA_API_KEY to run Exa social discovery.");
  const discoveredAt = new Date().toISOString();
  const lookback = socialDiscoveryLookbackHours();
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query: input.query,
      type: "auto",
      numResults: Math.max(1, Math.min(100, input.limit)),
      includeDomains: providerDomains(input.platform),
      startCrawlDate: isoHoursAgo(lookback),
      contents: {
        highlights: {
          maxCharacters: 600,
        },
      },
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Exa search failed with HTTP ${response.status}: ${compactText(raw, 220)}`);
  }
  const payload = asRecord(raw ? JSON.parse(raw) : {});
  const results = asArray(payload.results);
  return results
    .map((row, index) => {
      const hit = asRecord(row);
      const highlights = asArray(hit.highlights).map((entry) => String(entry ?? ""));
      return normalizeProviderHit({
        brand: input.brand,
        discoveredAt,
        hit: {
          platform: input.platform,
          provider: "exa",
          externalId: String(hit.id ?? hit.url ?? "").trim(),
          url: String(hit.url ?? "").trim(),
          title: compactText(hit.title, 500),
          body: compactText([hit.text, hit.summary, ...highlights].filter(Boolean).join("\n"), 1200),
          author: String(hit.author ?? "").trim(),
          community: communityFromUrl(String(hit.url ?? ""), input.platform),
          query: input.query,
          providerRank: index + 1,
          raw: hit,
          postedAt: String(hit.publishedDate ?? hit.published_date ?? "").trim(),
        },
      });
    })
    .filter((post): post is SocialDiscoveryPost => Boolean(post));
}

function dataForSeoAuthorizationHeader(credentials: { login: string; password: string }) {
  return `Basic ${Buffer.from(`${credentials.login}:${credentials.password}`).toString("base64")}`;
}

function parseHumanCount(value: string) {
  const normalized = String(value ?? "")
    .replace(/,/g, "")
    .replace(/\+/g, "")
    .trim();
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);
  if (!match) return 0;
  const base = Number(match[1] ?? 0);
  if (!Number.isFinite(base)) return 0;
  const suffix = String(match[2] ?? "").toLowerCase();
  if (suffix === "k") return Math.round(base * 1_000);
  if (suffix === "m") return Math.round(base * 1_000_000);
  if (suffix === "b") return Math.round(base * 1_000_000_000);
  return Math.round(base);
}

function relativeTimeToIso(value: string, discoveredAt: string) {
  const match = String(value ?? "")
    .toLowerCase()
    .match(/(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks)\s+ago/);
  if (!match) return "";
  const amount = Number(match[1] ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  const unit = String(match[2] ?? "");
  const discoveredMs = Date.parse(discoveredAt);
  if (!Number.isFinite(discoveredMs)) return "";
  const hourMs = 60 * 60 * 1000;
  const offsetMs =
    unit.startsWith("minute") ? amount * 60 * 1000 :
    unit.startsWith("hour") ? amount * hourMs :
    unit.startsWith("day") ? amount * 24 * hourMs :
    amount * 7 * 24 * hourMs;
  return new Date(discoveredMs - offsetMs).toISOString();
}

function extractDataForSeoInstagramSignals(raw: Record<string, unknown>, discoveredAt: string) {
  const breadcrumb = compactText(raw.breadcrumb, 200);
  const timestampValue = String(raw.timestamp ?? "").trim();
  const postedAt =
    (timestampValue && Number.isFinite(Date.parse(timestampValue)) ? new Date(timestampValue).toISOString() : "") ||
    relativeTimeToIso(timestampValue, discoveredAt) ||
    relativeTimeToIso(breadcrumb, discoveredAt);

  const likeMatch = breadcrumb.match(/([\d.,]+(?:\s*[kmb])?\+?)\s+likes?\b/i);
  const commentMatch = breadcrumb.match(/([\d.,]+(?:\s*[kmb])?\+?)\s+comments?\b/i);
  const viewMatch = breadcrumb.match(/([\d.,]+(?:\s*[kmb])?\+?)\s+views?\b/i);

  const likes = parseHumanCount(likeMatch?.[1] ?? "");
  const comments = parseHumanCount(commentMatch?.[1] ?? "");
  const views = parseHumanCount(viewMatch?.[1] ?? "");

  return {
    postedAt,
    engagementScore: likes + comments * 4 + Math.round(views * 0.02),
  };
}

async function discoverPostsWithDataForSeo(input: {
  brand: BrandRecord;
  platform: SocialDiscoveryPlatform;
  query: string;
  limit: number;
}): Promise<SocialDiscoveryPost[]> {
  const credentials = dataForSeoCredentials();
  if (!credentials) {
    throw new Error("Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to run DataForSEO social discovery.");
  }
  const discoveredAt = new Date().toISOString();
  const lookbackHours = Math.max(1, Number(process.env.SOCIAL_DISCOVERY_LOOKBACK_HOURS ?? 1) || 1);
  const locationName = String(process.env.DATAFORSEO_LOCATION_NAME ?? "United States").trim();
  const languageName = String(process.env.DATAFORSEO_LANGUAGE_NAME ?? "English").trim();
  const response = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
    method: "POST",
    headers: {
      Authorization: dataForSeoAuthorizationHeader(credentials),
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      {
        keyword: buildDataForSeoKeyword({
          platform: input.platform,
          query: input.query,
        }),
        search_param: buildDataForSeoSearchParam(lookbackHours),
        location_name: locationName,
        language_name: languageName,
        device: "desktop",
        os: "windows",
        depth: Math.max(10, Math.min(100, input.limit)),
      },
    ]),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`DataForSEO search failed with HTTP ${response.status}: ${compactText(raw, 220)}`);
  }
  const payload = asRecord(raw ? JSON.parse(raw) : {});
  const task = asRecord(asArray(payload.tasks)[0]);
  const result = asRecord(asArray(task.result)[0]);
  const items = asArray(result.items);
  return items
    .map((row) => {
      const hit = asRecord(row);
      const type = String(hit.type ?? "").trim().toLowerCase();
      if (type && type !== "organic") return null;
      const url = String(hit.url ?? "").trim();
      const resolvedPlatform = platformFromUrl(url);
      if (resolvedPlatform !== input.platform) return null;
      const instagramSignals =
        input.platform === "instagram"
          ? extractDataForSeoInstagramSignals(hit, discoveredAt)
          : { postedAt: "", engagementScore: 0 };
      return normalizeProviderHit({
        brand: input.brand,
        discoveredAt,
        hit: {
          platform: input.platform,
          provider: "dataforseo",
          externalId: url,
          url,
          title: compactText(hit.title, 500),
          body: compactText(hit.description ?? hit.snippet, 1200),
          author: "",
          community: communityFromUrl(url, input.platform),
          query: input.query,
          providerRank: Math.max(1, Number(hit.rank_absolute ?? hit.rank_group ?? 0) || 0),
          raw: hit,
          postedAt: instagramSignals.postedAt,
          engagementScore: instagramSignals.engagementScore,
        },
      });
    })
    .filter((post): post is SocialDiscoveryPost => Boolean(post));
}

async function discoverPostsWithSearchProvider(input: {
  brand: BrandRecord;
  provider: SocialDiscoveryProvider;
  platform: SocialDiscoveryPlatform;
  query: string;
  limit: number;
}) {
  return input.provider === "exa"
    ? discoverPostsWithExa(input)
    : discoverPostsWithDataForSeo(input);
}

function dedupePosts(posts: SocialDiscoveryPost[]) {
  const byKey = new Map<string, SocialDiscoveryPost>();
  for (const post of posts) {
    const key = `${post.brandId}:${post.platform}:${post.externalId}`;
    const existing = byKey.get(key);
    if (!existing || post.relevanceScore > existing.relevanceScore) {
      byKey.set(key, post);
    }
  }
  return Array.from(byKey.values()).sort((left, right) => {
    if (left.risingScore !== right.risingScore) return right.risingScore - left.risingScore;
    if (left.relevanceScore !== right.relevanceScore) return right.relevanceScore - left.relevanceScore;
    return right.engagementScore - left.engagementScore;
  });
}

function expandQueriesForPlatform(input: {
  platform: SocialDiscoveryPlatform;
  baseQueries: string[];
  subreddits: string[];
  maxQueries: number;
}) {
  const platformQueries =
    input.platform === "reddit" && input.subreddits.length
      ? input.baseQueries.flatMap((query) =>
          input.subreddits.map((subreddit) => `${query} r/${subreddit.replace(/^r\//i, "")}`)
        )
      : input.baseQueries;
  return uniqueStrings(platformQueries).slice(0, input.maxQueries);
}

export async function discoverSocialPostsForBrand(input: SocialDiscoveryRunInput): Promise<SocialDiscoveryRunOutput> {
  const platforms = input.platforms?.length ? input.platforms : (["reddit", "instagram"] as SocialDiscoveryPlatform[]);
  const provider = resolveSearchProvider(input.provider);
  const limit = Math.max(1, Math.min(100, Number(input.limitPerQuery ?? 25) || 25));
  const maxQueries = Math.max(1, Math.min(40, Number(input.maxQueries ?? 12) || 12));
  const subreddits = uniqueStrings(input.subreddits ?? []).slice(0, 10);
  const baseQueriesByPlatform = new Map(
    platforms.map((platform) => {
      const baseQueries = uniqueStrings(
        buildSocialDiscoveryQueries({
          brand: input.brand,
          extraTerms: input.extraTerms,
          maxQueries,
          platform,
        })
      ).slice(0, maxQueries);
      return [platform, baseQueries] as const;
    })
  );
  const queriesByPlatform = new Map(
    platforms.map((platform) => {
      const baseQueries = baseQueriesByPlatform.get(platform) ?? [];
      return [
        platform,
        expandQueriesForPlatform({
          platform,
          baseQueries,
          subreddits,
          maxQueries,
        }),
      ] as const;
    })
  );
  const posts: SocialDiscoveryPost[] = [];
  const errors: DiscoveryError[] = [];

  for (const platform of platforms) {
    const baseQueries = [...(baseQueriesByPlatform.get(platform) ?? [])];
    const platformPosts: SocialDiscoveryPost[] = [];
    const runQueries = async (queries: string[]) => {
      for (const query of queries) {
        try {
          const nextPosts =
            await discoverPostsWithSearchProvider({
              brand: input.brand,
              provider,
              platform,
              query,
              limit,
            });
          platformPosts.push(...nextPosts);
          posts.push(...nextPosts);
        } catch (error) {
          errors.push({
            platform,
            query,
            message: error instanceof Error ? error.message : "Discovery request failed",
          });
        }
      }
    };

    await runQueries(queriesByPlatform.get(platform) ?? []);

    const uniquePlatformPostCount = dedupePosts(platformPosts).length;
    if (uniquePlatformPostCount < sparseDiscoveryMinResults(platform)) {
      const fallbackBaseQueries = buildSparseDiscoveryFallbackQueries({
        brand: input.brand,
        extraTerms: input.extraTerms,
        platform,
        maxQueries: sparseDiscoveryFallbackLimit(platform),
        existingQueries: baseQueries,
      });
      if (fallbackBaseQueries.length) {
        const nextBaseQueries = uniqueStrings([...baseQueries, ...fallbackBaseQueries]).slice(
          0,
          maxQueries + sparseDiscoveryFallbackLimit(platform)
        );
        baseQueriesByPlatform.set(platform, nextBaseQueries);
        const fallbackQueries = expandQueriesForPlatform({
          platform,
          baseQueries: fallbackBaseQueries,
          subreddits,
          maxQueries: maxQueries + sparseDiscoveryFallbackLimit(platform),
        });
        const mergedQueries = uniqueStrings([...(queriesByPlatform.get(platform) ?? []), ...fallbackQueries]).slice(
          0,
          maxQueries + sparseDiscoveryFallbackLimit(platform)
        );
        queriesByPlatform.set(platform, mergedQueries);
        await runQueries(fallbackQueries);
      }
    }
  }
  const queries = uniqueStrings(Array.from(queriesByPlatform.values()).flat()).slice(
    0,
    (maxQueries + sparseDiscoveryFallbackLimit("instagram")) * platforms.length
  );

  return {
    provider,
    platforms,
    queries,
    posts: dedupePosts(posts),
    errors,
  };
}
