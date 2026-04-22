import { createId, type BrandRecord } from "@/lib/factory-data";
import { resolveLlmModel } from "@/lib/llm-router";
import { listSocialRoutingAccounts } from "@/lib/outreach-data";
import {
  brandMentionCount,
  brandMentionLooksCannedOrAdLike,
  commentBrandName,
  ensureCasualBrandMention,
  textMentionsBrand,
} from "@/lib/social-discovery-brand-mention";
import { resolveSocialDiscoveryCommentPrompt } from "@/lib/social-discovery-comment-prompt";
import { CURRENT_SOCIAL_DISCOVERY_PLATFORMS } from "@/lib/social-platform-catalog";
import type {
  SocialDiscoveryIntent,
  SocialDiscoveryPlatform,
  SocialDiscoveryPost,
  SocialDiscoveryProvider,
} from "@/lib/social-discovery-types";
import { resolveUnipilePostContext, type UnipileResolvedPostContext } from "@/lib/unipile";

type DiscoveryError = {
  platform: SocialDiscoveryPlatform;
  query: string;
  message: string;
};

export type SocialDiscoveryRunInput = {
  brand: BrandRecord;
  provider?: SocialDiscoveryProvider | "auto";
  platforms?: SocialDiscoveryPlatform[];
  queries?: string[];
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

type BrandDiscoveryProfileId = "generic" | "personal_safety";

type BrandContextFit = {
  profile: BrandDiscoveryProfileId;
  positiveMatches: string[];
  plannerMatches: string[];
  negativeMatches: string[];
  isContextMismatch: boolean;
  reason: string;
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
  "comment",
  "comments",
  "correction",
  "corrections",
  "reaction",
  "reactions",
  "signal",
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
  "gap",
  "gaps",
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
  "automation",
  "hiring",
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

const SOCIAL_DISCOVERY_MARKETING_LEAD_WORDS = [
  "turn",
  "give",
  "use",
  "publish",
  "build",
  "create",
  "generate",
  "making",
  "make",
  "operators",
  "teams",
];

const SOCIAL_DISCOVERY_MARKETING_COPY_TERMS = [
  "source-backed",
  "outreach-ready",
  "market note",
  "market notes",
  "market-note",
  "representative sample",
  "representative samples",
  "signal fields",
  "timing fields",
  "underlying prospect list",
  "underlying prospect lists",
  "start conversations",
  "public notes",
  "list commercially",
  "commercially",
  "narrow market discovery",
  "for comment",
];

const SOCIAL_DISCOVERY_COMMERCIAL_SIGNAL_WORDS = [
  "outreach",
  "targeting",
  "prospect",
  "prospects",
  "market",
  "notes",
  "note",
  "list",
  "lists",
  "discovery",
  "generation",
  "commercially",
  "signal",
  "timing",
];

const SOCIAL_DISCOVERY_THEME_EXPANSIONS: Array<{
  triggers: string[];
  phrases: string[];
}> = [
  {
    triggers: ["safe", "unsafe", "safety", "harassment", "followed", "catcalling", "rideshare", "nightlife"],
    phrases: [
      "walk home at night",
      "being followed",
      "feel unsafe walking home",
      "rideshare safety",
      "uber safety",
      "text me when you get home",
    ],
  },
];

const PERSONAL_SAFETY_QUERY_SEEDS = [
  "women safety tips",
  "girls safety tips",
  "womens safety at night",
  "how women stay safe",
  "staying safe at night",
  "campus safety tips",
  "rideshare safety for women",
  "solo female travel safety",
  "uber safety tips",
  "rideshare safety tips",
  "walking alone at night tips",
  "walk home alone at night",
  "street harassment advice",
  "women walking alone",
  "how do i complain to uber",
  "creepy uber driver",
  "uber driver made me uncomfortable",
  "being followed home",
  "someone followed me home",
  "catcalled on the street",
  "street harassment story",
  "solo female travel safety tips",
];

const PERSONAL_SAFETY_QUERY_BLOCKLIST = new Set([
  "safe",
  "unsafe",
  "safety",
  "text me when you get home",
  "walk home at night",
  "being followed",
  "followed me",
]);

const PERSONAL_SAFETY_ABSTRACT_QUERY_TERMS = new Set([
  "safe",
  "unsafe",
  "safety",
  "follow",
  "following",
  "followed",
]);

const PERSONAL_SAFETY_GROUNDED_PHRASE_PATTERN =
  /\b(walk(?:ing)?|walk home|alone|night|followed|stalk(?:ed|ing)?|rideshare|uber|lyft|taxi|driver|street harassment|catcall(?:ed|ing)?|solo travel|female travel|parking|transit|bystander|escort|location|contact|harass(?:ment)?|women(?:'s|s)? safety|girls safety|campus safety)\b/i;

const PERSONAL_SAFETY_RISK_SIGNAL_PATTERN =
  /\b(unsafe|feel unsafe|scared|creepy|creep|followed|followed home|stalk(?:ed|ing)?|harass(?:ment)?|catcall(?:ed|ing)?|rideshare|uber|lyft|driver|parking lot|parking garage|bus stop|train station|location sharing|share (?:my|your) location|text me when you get home|get home safe|trusted contact|call me|bystander|walk with you|stand with you|pepper spray|whistle|self-defense)\b/i;

const PERSONAL_SAFETY_SITUATION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "walking alone", pattern: /\b(walking alone|walk(?:ing)? home|alone at night|night walk|walking to (?:my|your) car)\b/i },
  { label: "being followed", pattern: /\b(being followed|followed me|followed home|stalk(?:ed|ing)?)\b/i },
  { label: "rideshare", pattern: /\b(rideshare|uber|lyft|taxi|driver)\b/i },
  { label: "street harassment", pattern: /\b(street harassment|catcall(?:ed|ing)?|harass(?:ment)?|creep(?:y)?)\b/i },
  { label: "public transit", pattern: /\b(public transit|train station|bus stop|parking (?:lot|garage)|campus escort)\b/i },
  { label: "safety signal", pattern: /\b(share (?:my|your) location|location sharing|text me when you get home|get home safe|call me|trusted contact)\b/i },
];

const PERSONAL_SAFETY_PLANNER_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "safety plan", pattern: /\b(safety plan|safe route|fallback location|trusted contact|check in|check-in|call trigger)\b/i },
  { label: "bystander help", pattern: /\b(bystander|bystander intervention|escort service|walk with you|stand with you)\b/i },
  { label: "practical advice", pattern: /\b(tips|advice|what do you do|how do you|routine|habit|prep|prepare)\b/i },
  { label: "personal safety tools", pattern: /\b(self-defense|pepper spray|whistle|location sharing)\b/i },
];

const PERSONAL_SAFETY_NEGATIVE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "political/legal", pattern: /\b(governor|desantis|president|law|bill|legislation|court|parliament|government|student supporters?|terrorists?|immigration authorities|free speech|policy|policies|election|protest(?:ers?)?|political|rights?|administration)\b/i },
  { label: "hard news", pattern: /\b(police say|breaking|headline|charged|arrested|sentenced|lawsuit|investigation|found dead|fatal|killed|murder|news)\b/i },
  { label: "therapy/domestic", pattern: /\b(emotionally unsafe|emotionally cold|anxiety|trauma|therapist|therapy|nervous system|relationship|partner|wounds|support is available|advocates are here|domestic|family violence|shelter|hotline)\b/i },
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

function addSoftBrandMention(input: { draft: string; brandName: string; maxLength: number; seed?: string }) {
  return ensureCasualBrandMention(input);
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
    .replace(/\b(?:primary job|priority themes right now)\s*:\s*/gi, "")
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
  if (words === 1 && !SOCIAL_DISCOVERY_HIGH_SIGNAL_TERMS.some((term) => next.toLowerCase().includes(term))) return false;
  if (SOCIAL_DISCOVERY_QUERY_NOISE.includes(next.toLowerCase())) return false;
  if (isMarketingCopyPhrase(next)) return false;
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

function isMarketingCopyPhrase(value: string) {
  const normalized = cleanDiscoveryFragment(value).toLowerCase();
  if (!normalized) return false;
  const words = normalized.split(/\s+/).filter(Boolean);
  const leading = words[0] ?? "";
  if (words.length >= 4 && SOCIAL_DISCOVERY_MARKETING_LEAD_WORDS.includes(leading)) return true;
  if (SOCIAL_DISCOVERY_MARKETING_COPY_TERMS.some((term) => normalized.includes(term))) return true;
  const commercialSignalCount = SOCIAL_DISCOVERY_COMMERCIAL_SIGNAL_WORDS.filter((term) =>
    normalized.includes(term)
  ).length;
  const hasProblemSignal =
    SOCIAL_DISCOVERY_HIGH_SIGNAL_TERMS.some((term) => normalized.includes(term)) ||
    /\b(gap|gaps|problem|problems|issue|issues|pain|pains|complaint|complaints|hiring)\b/i.test(normalized);
  return commercialSignalCount >= 2 && !hasProblemSignal;
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
    .flatMap((entry) => entry.split(/[.,;\n]|(?:\s+and\s+)|(?:\s+or\s+)|(?:\s+\/\s+)/i))
    .map((entry) => cleanDiscoveryFragment(entry))
    .filter(Boolean);
}

function discoveryPhraseScore(value: string) {
  const normalized = cleanDiscoveryFragment(value).toLowerCase();
  const words = phraseWordCount(normalized);
  let score = 0;
  if (isMarketingCopyPhrase(normalized)) score -= 35;
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

  const inferred = uniqueStrings(
    SOCIAL_DISCOVERY_THEME_EXPANSIONS.flatMap((entry) =>
      entry.triggers.some((trigger) => text.includes(trigger)) ? entry.phrases : []
    )
  );
  const profileSeeds = inferBrandDiscoveryProfile(brand) === "personal_safety" ? PERSONAL_SAFETY_QUERY_SEEDS : [];
  return filterDiscoveryPhrasesForBrand(brand, [...inferred, ...profileSeeds]);
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

function personalSafetyQueryAllowed(value: string) {
  const normalized = cleanDiscoveryFragment(value).toLowerCase();
  if (!normalized) return false;
  if (PERSONAL_SAFETY_QUERY_BLOCKLIST.has(normalized)) return false;
  return [
    /\b(women(?:'s|s)? safety tips|girls safety tips|womens safety at night|how women stay safe|staying safe at night|women walking alone)\b/i,
    /\b(campus safety tips|rideshare safety for women|solo female travel safety)\b/i,
    /\b(how do i complain to uber|complain to uber|uber driver made me uncomfortable|creepy uber driver)\b/i,
    /\b(being followed home|someone followed me home|what to do if someone follows you)\b/i,
    /\b(walking alone at night tips|walk home alone at night)\b/i,
    /\b(catcalled on the street|street harassment story|street harassment advice)\b/i,
    /\b(rideshare safety tips|uber safety tips)\b/i,
    /\b(solo female travel safety tips)\b/i,
  ].some((pattern) => pattern.test(normalized));
}

function buildPersonalSafetyInstagramQueries(input: {
  extraTerms?: string[];
  maxQueries: number;
}) {
  const extraVariants = uniqueStrings(
    (input.extraTerms ?? [])
      .flatMap(extractSparsePhraseVariants)
      .map((phrase) => cleanDiscoveryFragment(phrase))
      .filter(Boolean)
  ).filter(personalSafetyQueryAllowed);
  return uniqueStrings([...PERSONAL_SAFETY_QUERY_SEEDS, ...extraVariants])
    .filter(personalSafetyQueryAllowed)
    .slice(0, input.maxQueries);
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
      (phrase) => phrase,
      (phrase) => `${phrase} advice`,
      (phrase) => `${phrase} help`,
      (phrase) => `${phrase} experience`,
      (phrase) => `${phrase} anyone else`,
    ],
  }).slice(0, maxQueries);
}

function usesVisualDiscoveryQueries(platform: SocialDiscoveryPlatform | undefined) {
  return platform === "instagram" || platform === "youtube";
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
  if (normalized.includes("women") || normalized.includes("woman") || normalized.includes("girls")) {
    variants.add("women safety tips");
    variants.add("girls safety tips");
    variants.add("how women stay safe");
  }
  if (normalized.includes("street harassment")) {
    variants.add("street harassment story");
    variants.add("catcalled on the street");
    variants.add("street harassment advice");
  }
  if (normalized.includes("catcalling")) variants.add("catcalling");
  if (normalized.includes("being followed") || normalized.includes("worried about being followed")) {
    variants.add("being followed home");
    variants.add("someone followed me home");
    variants.add("what to do if someone follows you");
  }
  if (normalized.includes("feel unsafe") || normalized.includes("feeling unsafe")) {
    if (/\b(walk|home|night|follow|rideshare|uber|lyft|travel|transit|parking)\b/.test(normalized)) {
      variants.add("walking alone at night tips");
      variants.add("rideshare safety tips");
    }
  }
  if (normalized.includes("walking alone") || normalized.includes("walk home")) {
    variants.add("walking alone at night tips");
    variants.add("walk home alone at night");
    variants.add("women walking alone");
    variants.add("staying safe at night");
  }
  if (normalized.includes("rideshare") || normalized.includes("uber") || normalized.includes("lyft")) {
    variants.add("rideshare safety tips");
    variants.add("uber safety tips");
    variants.add("rideshare safety for women");
    variants.add("how do i complain to uber");
    variants.add("uber driver made me uncomfortable");
    variants.add("creepy uber driver");
  }
  if (normalized.includes("solo travel") || normalized.includes("solo traveler")) {
    variants.add("solo female travel safety");
    variants.add("solo female travel safety tips");
  }
  if (normalized.includes("campus")) {
    variants.add("campus safety tips");
  }

  variants.add(
    phrase
      .replace(/^(womens?|women|girls)\s+/i, "")
      .replace(/^(prevent|avoiding|avoid|practical|more confidence|fast|better)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim()
  );

  return Array.from(variants)
    .filter(isUsefulDiscoveryPhrase)
    .filter((entry) => !isAudienceOnlyPhrase(entry))
    .filter((entry) => !PERSONAL_SAFETY_QUERY_BLOCKLIST.has(entry.toLowerCase()));
}

function buildSparseDiscoveryFallbackQueries(input: {
  brand: BrandRecord;
  extraTerms?: string[];
  platform: SocialDiscoveryPlatform;
  maxQueries: number;
  existingQueries?: string[];
}) {
  if (inferBrandDiscoveryProfile(input.brand) === "personal_safety") {
    const existing = new Set((input.existingQueries ?? []).map((query) => query.trim().toLowerCase()));
    return buildPersonalSafetyInstagramQueries({
      extraTerms: input.extraTerms,
      maxQueries: Math.max(input.maxQueries * 2, PERSONAL_SAFETY_QUERY_SEEDS.length),
    })
      .filter((query) => !existing.has(query.trim().toLowerCase()))
      .slice(0, input.maxQueries);
  }
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
  const fallbackPhrases = filterDiscoveryPhrasesForBrand(
    input.brand,
    uniqueStrings(sourcePhrases.flatMap(extractSparsePhraseVariants))
  ).filter((phrase) => {
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
  return Math.max(1, Math.min(168, Number(process.env.SOCIAL_DISCOVERY_LOOKBACK_HOURS ?? 1) || 1));
}

function socialDiscoveryMaxPostAgeHours() {
  const fallback = socialDiscoveryLookbackHours();
  return Math.max(1, Math.min(168, Number(process.env.SOCIAL_DISCOVERY_MAX_POST_AGE_HOURS ?? fallback) || fallback));
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
  if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) return "x";
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
  if (host === "producthunt.com" || host.endsWith(".producthunt.com")) return "product-hunt";
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
  return null;
}

function isContentUrlForPlatform(url: string, platform: SocialDiscoveryPlatform) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const head = (parts[0] ?? "").toLowerCase();
    if (platform === "instagram") return head === "p" || head === "reel" || head === "tv";
    if (platform === "reddit") {
      if (head === "comments") return true;
      if (head !== "r") return false;
      return parts.some((part) => part.toLowerCase() === "comments");
    }
    if (platform === "x") return parts.some((part) => part.toLowerCase() === "status");
    if (platform === "linkedin") {
      return parsed.pathname.includes("/posts/") || parsed.pathname.includes("/feed/update/");
    }
    if (platform === "product-hunt") return head === "posts";
    if (platform === "youtube") return head === "watch" || head === "shorts" || parsed.hostname === "youtu.be";
    return false;
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
    if (platform === "x") {
      const username = parts[0] ?? "";
      return username && username.toLowerCase() !== "status" ? `@${username}` : "x";
    }
    if (platform === "linkedin") {
      if (parsed.pathname.includes("/posts/")) return "linkedin";
      const companyIndex = parts.findIndex((part) => part.toLowerCase() === "company");
      const profileIndex = parts.findIndex((part) => part.toLowerCase() === "in");
      if (companyIndex >= 0) return parts[companyIndex + 1] ? `company/${parts[companyIndex + 1]}` : "linkedin";
      if (profileIndex >= 0) return parts[profileIndex + 1] ? `in/${parts[profileIndex + 1]}` : "linkedin";
      return "linkedin";
    }
    if (platform === "product-hunt") {
      return "product-hunt";
    }
    if (platform === "youtube") {
      const channelIndex = parts.findIndex((part) => part.toLowerCase() === "channel");
      const handle = parts[0] ?? "";
      if (channelIndex >= 0) return parts[channelIndex + 1] ? `channel/${parts[channelIndex + 1]}` : "youtube";
      if (handle.startsWith("@")) return handle;
      return "youtube";
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

function inferBrandDiscoveryProfile(brand: BrandRecord): BrandDiscoveryProfileId {
  const text = [
    brand.name,
    brand.website,
    brand.product,
    brand.notes,
    ...brand.targetMarkets,
    ...brand.idealCustomerProfiles,
    ...brand.keyFeatures,
    ...brand.keyBenefits,
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  if (/\b(safe|safety|unsafe)\b/.test(text)) score += 1;
  if (/\b(woman|women|girl|girls|female|ally|allies)\b/.test(text)) score += 1;
  if (
    /\b(street harassment|catcall|being followed|followed home|walk home|walking alone|rideshare|uber|lyft|solo travel|bystander|location sharing|trusted contact|police|harass)\b/.test(
      text
    )
  ) {
    score += 2;
  }

  return score >= 3 ? "personal_safety" : "generic";
}

function matchLabels(text: string, patterns: Array<{ label: string; pattern: RegExp }>) {
  return patterns.filter((entry) => entry.pattern.test(text)).map((entry) => entry.label);
}

function isAllowedDiscoveryPhraseForProfile(brand: BrandRecord, phrase: string) {
  const profile = inferBrandDiscoveryProfile(brand);
  if (profile === "generic") return true;
  const normalized = cleanDiscoveryFragment(phrase).toLowerCase();
  if (!normalized) return false;
  if (/\b(safe|unsafe|safety)\b/.test(normalized) && !PERSONAL_SAFETY_GROUNDED_PHRASE_PATTERN.test(normalized)) {
    return false;
  }
  return true;
}

function filterDiscoveryPhrasesForBrand(brand: BrandRecord, phrases: string[]) {
  return uniqueStrings(phrases).filter((phrase) => isAllowedDiscoveryPhraseForProfile(brand, phrase));
}

function brandContextFitFor(input: {
  brand: BrandRecord;
  query: string;
  text: string;
}): BrandContextFit {
  const profile = inferBrandDiscoveryProfile(input.brand);
  if (profile === "generic") {
    return {
      profile,
      positiveMatches: [],
      plannerMatches: [],
      negativeMatches: [],
      isContextMismatch: false,
      reason: "generic profile",
    };
  }

  const normalizedText = input.text.toLowerCase();
  const positiveMatches = matchLabels(normalizedText, PERSONAL_SAFETY_SITUATION_PATTERNS);
  const plannerMatches = matchLabels(normalizedText, PERSONAL_SAFETY_PLANNER_PATTERNS);
  const negativeMatches = matchLabels(normalizedText, PERSONAL_SAFETY_NEGATIVE_PATTERNS);
  const hasRiskSignal = PERSONAL_SAFETY_RISK_SIGNAL_PATTERN.test(normalizedText);
  const hasGroundedContext = positiveMatches.length > 0 || plannerMatches.length > 0;

  if (negativeMatches.length > 0 && positiveMatches.length === 0) {
    return {
      profile,
      positiveMatches,
      plannerMatches,
      negativeMatches,
      isContextMismatch: true,
      reason: "negative surface without grounded personal-safety situation",
    };
  }

  if (!hasGroundedContext) {
    return {
      profile,
      positiveMatches,
      plannerMatches,
      negativeMatches,
      isContextMismatch: true,
      reason: "missing grounded personal-safety context",
    };
  }

  if (positiveMatches.length === 0 && plannerMatches.length > 0 && !hasRiskSignal) {
    return {
      profile,
      positiveMatches,
      plannerMatches,
      negativeMatches,
      isContextMismatch: true,
      reason: "planner language without an actual personal-safety situation",
    };
  }

  const onlyAmbientNightWalk =
    positiveMatches.length > 0 &&
    positiveMatches.every((entry) => entry === "walking alone") &&
    plannerMatches.length === 0 &&
    !hasRiskSignal;
  if (onlyAmbientNightWalk) {
    return {
      profile,
      positiveMatches,
      plannerMatches,
      negativeMatches,
      isContextMismatch: true,
      reason: "ambient walking-alone content without practical safety signal",
    };
  }

  return {
    profile,
    positiveMatches,
    plannerMatches,
    negativeMatches,
    isContextMismatch: false,
    reason: "grounded personal-safety context present",
  };
}

function shouldRejectPersonalSafetyContextMismatch(input: {
  brand: BrandRecord;
  query: string;
  text: string;
}) {
  return brandContextFitFor(input).isContextMismatch;
}

function matchedTermsFor(input: {
  text: string;
  brand: BrandRecord;
  query: string;
  extraTerms?: string[];
  contextFit?: BrandContextFit;
}) {
  const brandTerms = buildBrandTerms(input.brand, input.extraTerms);
  const profile = input.contextFit?.profile ?? inferBrandDiscoveryProfile(input.brand);
  const queryTerms = input.query
    .split(/\s+/)
    .map((part) => part.replace(/["()+]/g, ""))
    .filter((part) => part.length >= 3)
    .filter((part) => !(profile === "personal_safety" && PERSONAL_SAFETY_ABSTRACT_QUERY_TERMS.has(part.toLowerCase())));
  const contextTerms = [
    ...(input.contextFit?.positiveMatches ?? []),
    ...(input.contextFit?.plannerMatches ?? []),
  ];
  const terms = uniqueStrings([...brandTerms, ...queryTerms, ...contextTerms])
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
  contextFit?: BrandContextFit;
}): SocialDiscoveryIntent {
  const text = input.text.toLowerCase();
  if (input.contextFit?.isContextMismatch) return "noise";
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
  contextFit?: BrandContextFit;
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
  if (input.contextFit?.profile === "personal_safety") {
    score += input.contextFit.positiveMatches.length * 12;
    score += input.contextFit.plannerMatches.length * 8;
    score -= input.contextFit.negativeMatches.length * 20;
    if (input.contextFit.isContextMismatch) score -= 60;
  }
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

function isFreshEnoughForDiscovery(postedAt: string) {
  const ageHours = ageHoursFor(postedAt);
  if (ageHours == null) return false;
  return ageHours <= socialDiscoveryMaxPostAgeHours();
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
  brand: BrandRecord;
  query: string;
  title: string;
  body: string;
}) {
  if (input.platform !== "instagram") return false;

  const query = input.query.toLowerCase();
  const text = `${input.title}\n${input.body}`.toLowerCase();
  if (shouldRejectPersonalSafetyContextMismatch({
    brand: input.brand,
    query: input.query,
    text,
  })) {
    return true;
  }
  const hasLiteralSafetyContext =
    /\b(unsafe|safety|harass|catcall|stalk|followed home|walking alone|walk home|night walk|rideshare|uber|lyft|transit|parking|campus|bystander|creep|creepy|scared|threat|assault|victim|street)\b/i.test(
      text
    );
  if (/\b(being followed|followed me|followed home|someone followed me home|what to do if someone follows you)\b/i.test(query)) {
    const metaphoricalFollow =
      /\b(leadership|on the track|track\.|follow your|followers\b|followed for years|followed by other artists|being social|haunted by|meant to be followed|created not followed|bird demon|demon|ghost|maniac|meme|ladybugs?|butterflies?|dragonflies?|snails?|rainbows?)\b/i.test(
        text
      );
    if (metaphoricalFollow && !hasLiteralSafetyContext) return true;
  }

  if (/\b(walking alone at night|walk home alone at night|walk home at night)\b/i.test(query)) {
    const nightWalkVibes =
      /\b(heals me|romantic vibe|peaceful|clearing my mind|surrender|night walk vibes|lovers|spouse|cute|lonely romantic|feel better someday|wandering at night|fav places|how beautiful it is to walk|nowhere to be)\b/i.test(
        text
      );
    if (nightWalkVibes && !hasLiteralSafetyContext) return true;
  }

  if (/\btext me when you get home\b/i.test(query)) {
    const merchSurface =
      /\b(tote bag|hoodie|shirt|sweatshirt|tee\b|sticker|mug|print|poster|keychain|merch|shop now|etsy|link in bio|pink camo)\b/i.test(
        text
      );
    if (merchSurface) return true;
  }

  if (/\b(walk home at night|walking alone at night|walk home alone at night)\b/i.test(query)) {
    const movieOrArtSurface =
      /\b(a girl walks home alone at night|tickets for|official trailer|screening|film|movie|cinema|farsi language)\b/i.test(
        text
      );
    if (movieOrArtSurface) return true;
  }

  if (query.includes("someone feels unsafe") || query.includes("helping when someone feels unsafe")) {
    const therapyOrDomesticSurface =
      /\b(emotionally unsafe|emotionally cold|anxiety|trauma|therapist|therapy|nervous system|relationship|partner|wounds|support is available|advocates are here|domestic|family violence|shelter|hotline|governor|law|bill|legislation|court|government|student supporters?|terrorists?|immigration authorities|free speech|policy|political)\b/i.test(
        text
      );
    if (therapyOrDomesticSurface) return true;
  }

  if (/\b(street harassment|catcall)\b/i.test(query)) {
    const politicalOrLegalSurface =
      /\b(israel|palestin|baby k\*llers|blood libel|court|sentenced|charged|law has changed|criminali[sz]ed|bill|parliament|government|incident reported|viral video|police station|police say|sheriff|reported by|set to establish)\b/i.test(
        text
      );
    if (politicalOrLegalSurface) return true;
  }

  if (query.includes("solo travel safety")) {
    const genericTravelSurface =
      /\b(adventure looks better|solo travel hits different|wanderlust|travel confidence|budget-friendly travel ideas|bucket list|vacation mode|passport|explore the world)\b/i.test(
        text
      );
    if (genericTravelSurface && !hasLiteralSafetyContext) return true;
  }

  if (/\b(rideshare|uber|lyft|driver)\b/i.test(query)) {
    const hardNewsSurface =
      /\b(police say|found dead|sentenced|court|charged|assault charges|facing assault charges|murder|killed|fatal|news|kidnapping attempt)\b/i.test(
        text
      );
    if (hardNewsSurface) return true;
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
type InteractionSurfaceType =
  | "help_request"
  | "personal_story"
  | "complaint_thread"
  | "advice_post"
  | "brand_feature_post"
  | "awareness_post"
  | "news_or_political"
  | "generic";
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

function interactionSurfaceType(input: {
  text: string;
  query: string;
  contextFit: BrandContextFit;
}): InteractionSurfaceType {
  const text = input.text.toLowerCase();
  const explicitQuestion =
    /\?/.test(text) ||
    /\b(anyone|what do you do|how do you|tips|advice|help|need help|looking for|recommend)\b/i.test(text);
  const personalStory =
    /\b(i|my|me)\b/i.test(text) &&
    /\b(followed|unsafe|scared|vent|happened|walking home|ride home|uber|lyft|catcall|harass|creepy|alone at night)\b/i.test(
      text
    );
  const complaint =
    /\b(complain|complaint|problem|issue|not working|technical issue|support|frustrating|cancel|report)\b/i.test(text);
  const brandFeature =
    /\b(introduced|launch(?:ed)?|rolling out|rollout|new feature|feature update|now available|we just added|just added)\b/i.test(
      text
    );
  const advice =
    /\b(how to|tips|advice|ways to|things to know|what helps|what works|routine|habit|prep|prepare)\b/i.test(text);
  const awareness =
    /\b(awareness|this month|should know|important reminder|public service|psa|sexual harassment is|street harassment is)\b/i.test(
      text
    );
  const newsOrPolitical =
    input.contextFit.negativeMatches.includes("political/legal") ||
    input.contextFit.negativeMatches.includes("hard news") ||
    /\b(governor|president|law|bill|legislation|court|government|charged|arrested|headline|news)\b/i.test(text);

  if (newsOrPolitical) return "news_or_political";
  if (brandFeature) return explicitQuestion ? "help_request" : "brand_feature_post";
  if (explicitQuestion) return complaint ? "complaint_thread" : "help_request";
  if (personalStory) return "personal_story";
  if (complaint) return "complaint_thread";
  if (advice) return "advice_post";
  if (awareness) return "awareness_post";
  return "generic";
}

function interactionCommentabilityScore(input: {
  surfaceType: InteractionSurfaceType;
  intent: SocialDiscoveryIntent;
  text: string;
  contextFit: BrandContextFit;
}) {
  let score = 0;
  switch (input.surfaceType) {
    case "help_request":
      score += 38;
      break;
    case "personal_story":
      score += 32;
      break;
    case "complaint_thread":
      score += 26;
      break;
    case "advice_post":
      score += 18;
      break;
    case "awareness_post":
      score += 8;
      break;
    case "brand_feature_post":
      score += 6;
      break;
    case "news_or_political":
      score -= 30;
      break;
    default:
      break;
  }
  if (input.intent === "buyer_question") score += 12;
  if (input.intent === "competitor_complaint") score += 8;
  if (/\?/.test(input.text)) score += 8;
  if (/\b(app|tool|resource|what do you use|recommend)\b/i.test(input.text)) score += 6;
  score += Math.min(24, input.contextFit.positiveMatches.length * 8);
  score += Math.min(16, input.contextFit.plannerMatches.length * 8);
  score -= Math.min(36, input.contextFit.negativeMatches.length * 14);
  if (input.contextFit.isContextMismatch) score -= 60;
  return Math.max(0, Math.min(100, score));
}

function interactionTargetStrength(input: {
  risingScore: number;
  relevanceScore: number;
  engagementScore: number;
  postedAt: string;
  intent: SocialDiscoveryIntent;
  surfaceType: InteractionSurfaceType;
  commentabilityScore: number;
}): InteractionTargetStrength {
  if (input.surfaceType === "news_or_political") return "skip";
  if (input.surfaceType === "brand_feature_post") {
    if (input.risingScore >= 44 && input.relevanceScore >= 18 && input.commentabilityScore >= 8) return "watch";
    return "skip";
  }
  const weighted = input.risingScore * 0.45 + input.relevanceScore * 0.35 + input.commentabilityScore * 0.2;
  if (input.surfaceType === "help_request") {
    if (weighted >= 50 && input.relevanceScore >= 22) return "target";
    if (weighted >= 40 && input.relevanceScore >= 16) return "watch";
    return "skip";
  }
  if (input.surfaceType === "personal_story") {
    if (weighted >= 54 && input.relevanceScore >= 22) return "target";
    if (weighted >= 42 && input.relevanceScore >= 16) return "watch";
    return "skip";
  }
  if (input.surfaceType === "complaint_thread") {
    if (weighted >= 52 && input.relevanceScore >= 22) return "target";
    if (weighted >= 42 && input.relevanceScore >= 16) return "watch";
    return "skip";
  }
  if (input.surfaceType === "awareness_post") {
    if (weighted >= 48 && input.relevanceScore >= 18) return "watch";
    return "skip";
  }
  if (weighted >= 60) return "target";
  if (weighted >= 46) return "watch";
  return "skip";
}

function interactionPosture(input: {
  targetStrength: InteractionTargetStrength;
  text: string;
  query: string;
  surfaceType: InteractionSurfaceType;
  contextFit: BrandContextFit;
}): InteractionCommentPosture {
  if (input.targetStrength === "skip") return "no_comment";
  const text = input.text.toLowerCase();
  if (input.surfaceType === "news_or_political") return "no_comment";
  if (input.surfaceType === "brand_feature_post") return "method_first";
  if (input.surfaceType === "awareness_post") return "empathy_first";
  if (input.surfaceType === "personal_story" || input.surfaceType === "complaint_thread") return "empathy_first";
  if (input.surfaceType === "help_request") {
    const genericQuestion =
      /\b(any tips|any advice|what do you do|how do you)\b/i.test(text) &&
      input.contextFit.plannerMatches.length === 0;
    return genericQuestion ? "question_first" : "method_first";
  }
  if (/\bbystander\b/i.test(text)) return "method_first";
  if (input.query.includes("street harassment") || input.query.includes("rideshare")) return "method_first";
  return input.targetStrength === "target" ? "method_first" : "watch_only";
}

function mentionPolicyForPlan(input: {
  targetStrength: InteractionTargetStrength;
  intent: SocialDiscoveryIntent;
  text: string;
  surfaceType: InteractionSurfaceType;
}): InteractionMentionPolicy {
  if (input.targetStrength === "skip") return "never_mention";
  const text = input.text.toLowerCase();
  if (input.surfaceType === "news_or_political") return "never_mention";
  if (/\b(app|tool|what do you use|recommend|solution|resource|checklist)\b/i.test(text)) {
    return input.intent === "buyer_question" ? "possible_soft_mention" : "mention_only_if_asked";
  }
  if (
    input.targetStrength === "target" &&
    ["help_request", "personal_story", "complaint_thread"].includes(input.surfaceType)
  ) {
    return "possible_soft_mention";
  }
  if (
    input.surfaceType === "brand_feature_post" ||
    input.surfaceType === "advice_post" ||
    input.surfaceType === "awareness_post"
  ) {
    return "no_mention";
  }
  return "mention_only_if_asked";
}

function softBrandBridge(input: {
  brand: BrandRecord;
  query: string;
  text: string;
  mentionPolicy: InteractionMentionPolicy;
}) {
  if (input.mentionPolicy !== "possible_soft_mention") return "";
  const query = input.query.toLowerCase();
  const text = input.text.toLowerCase();
  if (/\buber|lyft|rideshare|driver\b/i.test(query) || /\buber|lyft|rideshare|driver\b/i.test(text)) {
    return `That exact gap is why we built ${input.brand.name}.`;
  }
  if (/\bfollowed|stalk|walk(?:ing)? alone|walk home|night\b/i.test(query) || /\bfollowed|stalk|walk(?:ing)? alone|walk home|night\b/i.test(text)) {
    return `We built ${input.brand.name} for exactly that moment.`;
  }
  if (/\bharass|catcall|creepy\b/i.test(query) || /\bharass|catcall|creepy\b/i.test(text)) {
    return `We built ${input.brand.name} around that exact freeze moment.`;
  }
  return `That exact pattern is why we built ${input.brand.name}.`;
}

function firstCommentDraft(input: {
  brand: BrandRecord;
  query: string;
  text: string;
  posture: InteractionCommentPosture;
  surfaceType: InteractionSurfaceType;
  mentionPolicy: InteractionMentionPolicy;
}) {
  const text = input.text.toLowerCase();
  const bridge = softBrandBridge({
    brand: input.brand,
    query: input.query,
    text: input.text,
    mentionPolicy: input.mentionPolicy,
  });
  if (input.surfaceType === "brand_feature_post") {
    if (input.query.includes("rideshare") || /\b(uber|lyft|rideshare|driver)\b/i.test(text)) {
      return "Helpful feature, but the bigger safety win is having your fallback decided before the ride starts.";
    }
    return "Helpful update, but it still comes down to knowing your next move before things feel weird.";
  }
  if (input.surfaceType === "news_or_political") {
    return "";
  }
  if (input.posture === "no_comment") {
    return "";
  }
  if (input.posture === "watch_only") {
    return "";
  }
  if (input.query.includes("text me when you get home") || /\btext me when you get home\b/i.test(text)) {
    return bridge || "Best version of this is deciding what counts as home safe before you even leave.";
  }
  if (/\bbystander\b/i.test(text)) {
    return bridge || "Bystander help works best when it is simple and specific. Even just staying with someone helps a lot.";
  }
  if (input.query.includes("rideshare")) {
    return `Rideshare safety gets easier when your fallback is set before the car arrives. ${bridge}`.trim();
  }
  if (input.query.includes("walking alone") || /\bwalk(?:ing)? alone\b/i.test(text)) {
    return `Walking home tips only work when the backup plan is decided before anything feels off. ${bridge}`.trim();
  }
  if (input.query.includes("street harassment") || /\bharass|catcall\b/i.test(text)) {
    return `One pre-decided next step helps more than trying to improvise while stressed. ${bridge}`.trim();
  }
  if (input.surfaceType === "awareness_post") {
    return bridge || "The hard part is never the theory. It is knowing your next move fast enough in the moment.";
  }
  if (input.surfaceType === "personal_story") {
    return `Having one person to call and one place to head makes moments like this way less chaotic. ${bridge}`.trim();
  }
  if (input.surfaceType === "complaint_thread") {
    if (/\bcomplain|complaint|report\b/i.test(text) && /\buber|lyft|rideshare\b/i.test(text)) {
      return `If this was safety-related, screenshot the trip details before anything refreshes. That makes the report way easier. ${bridge}`.trim();
    }
    return `Saving the details first usually makes these situations much easier to report properly. ${bridge}`.trim();
  }
  if (input.surfaceType === "help_request" && input.posture === "question_first") {
    return `This mostly depends on whether the hard part is the ride, the walk home, or after it already feels off. ${bridge}`.trim();
  }
  return `What helps most is deciding your next move before you need it, not while you are stressed. ${bridge}`.trim();
}

function buildInteractionPlan(input: {
  post: Pick<
    SocialDiscoveryPost,
    | "title"
    | "body"
    | "intent"
    | "platform"
    | "query"
    | "url"
    | "risingScore"
    | "relevanceScore"
    | "engagementScore"
    | "postedAt"
    | "raw"
  >;
  brand: BrandRecord;
  contextFit: BrandContextFit;
}): EnrichedInteractionPlan {
  const asset = assetForIntent(input.post.intent);
  const text = `${input.post.title}\n${input.post.body}`;
  const surfaceType = interactionSurfaceType({
    text,
    query: input.post.query,
    contextFit: input.contextFit,
  });
  const commentabilityScore = interactionCommentabilityScore({
    surfaceType,
    intent: input.post.intent,
    text,
    contextFit: input.contextFit,
  });
  const targetStrength = interactionTargetStrength({
    risingScore: input.post.risingScore,
    relevanceScore: input.post.relevanceScore,
    engagementScore: input.post.engagementScore,
    postedAt: input.post.postedAt,
    intent: input.post.intent,
    surfaceType,
    commentabilityScore,
  });
  const commentPosture = interactionPosture({
    targetStrength,
    text,
    query: input.post.query,
    surfaceType,
    contextFit: input.contextFit,
  });
  const mentionPolicy = mentionPolicyForPlan({
    targetStrength,
    intent: input.post.intent,
    text,
    surfaceType,
  });
  const code = postCodeFromUrl(input.post.url);
  const analyticsTag = [
    `utm_source=${slugForAnalytics(input.post.platform || "social")}`,
    "utm_medium=comment",
    `utm_campaign=${slugForAnalytics(input.brand.name)}`,
    `utm_content=${slugForAnalytics(code || input.post.query)}`,
  ].join("&");
  const actors: SocialDiscoveryPost["interactionPlan"]["actors"] = [
    {
      role: "operator",
      job: targetStrength === "target"
        ? "Leave one short native comment from the real account."
        : targetStrength === "watch"
          ? "Do not comment yet. Save only if the thread becomes a direct practical opening."
          : "Leave the thread alone.",
    },
  ];
  const commentDraft =
    targetStrength === "target"
      ? firstCommentDraft({
          brand: input.brand,
          query: input.post.query,
          text,
          posture: commentPosture,
          surfaceType,
          mentionPolicy,
        })
      : "";
  const liveContent = asRecord(asRecord(input.post.raw).liveContent);
  return {
    headline: `${targetStrength} ${surfaceType.replace(/_/g, " ")} plan`,
    domainProfile: input.contextFit.profile.replace(/_/g, " "),
    fitSummary:
      input.contextFit.profile === "generic"
        ? "Generic discovery profile."
        : [
            liveContent.captionText || liveContent.accessibilityCaption ? "live post content fetched" : "",
            input.contextFit.reason,
            `surface: ${surfaceType.replace(/_/g, " ")}`,
            `commentability: ${commentabilityScore}`,
            input.contextFit.positiveMatches.length
              ? `context: ${input.contextFit.positiveMatches.join(", ")}`
              : "",
            input.contextFit.plannerMatches.length
              ? `planner: ${input.contextFit.plannerMatches.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
    targetStrength,
    commentPosture,
    mentionPolicy,
    analyticsTag,
    exitRules: [
      "Do not comment if the post is trauma-heavy, an active emergency, minors-focused, or turning political.",
      "Write one comment only.",
      "Do not mention the product unless it reads naturally and adds real value.",
      "Do not bump the thread if nobody replies.",
    ],
    actors,
    sequence: commentDraft
      ? [
          {
            actorRole: "operator",
            timing: "0-30 min after approval",
            move: commentPosture,
            draft: commentDraft,
          },
        ]
      : [],
    assetNeeded: mentionPolicy === "no_mention" || mentionPolicy === "never_mention" ? "none" : asset,
    riskNotes: [
      surfaceType === "brand_feature_post"
        ? "Brand-owned launch or feature posts are usually bad surfaces for subtle commenting."
        : "Match the tone of the thread before adding anything practical.",
      "Use real operators only; do not fake customer experience.",
      "Do not ask anyone to endorse a product they have not used.",
      "If the brand or asset is mentioned, disclose the relationship if asked.",
    ],
  };
}

function socialCommentPlannerLimit() {
  return Math.max(1, Math.min(12, Number(process.env.SOCIAL_DISCOVERY_COMMENT_PLAN_LIMIT ?? 12) || 12));
}

function socialLiveContentEnrichmentLimit() {
  return Math.max(1, Math.min(20, Number(process.env.SOCIAL_DISCOVERY_LIVE_CONTENT_LIMIT ?? 10) || 10));
}

type SocialRoutingPoolAccount = Awaited<ReturnType<typeof listSocialRoutingAccounts>>[number];

function socialAccountIdentityBlob(account: SocialRoutingPoolAccount) {
  return compactText(
    [
      account.name,
      account.config.social.displayName,
      account.config.social.publicIdentifier,
      account.config.social.handle,
      account.config.social.headline,
      account.config.social.bio,
      account.config.social.personaSummary,
      account.config.social.voiceSummary,
    ].join(" "),
    1200
  ).toLowerCase();
}

function chooseUnipileAccountForLiveContent(input: {
  brand: BrandRecord;
  platform: SocialDiscoveryPlatform;
  accounts: SocialRoutingPoolAccount[];
}) {
  const brandTerms = buildBrandTerms(input.brand)
    .map((term) => cleanDiscoveryFragment(term).toLowerCase())
    .filter((term) => term.length >= 3);
  const eligible = input.accounts
    .filter((account) => account.status === "active")
    .filter((account) => account.config.social.enabled)
    .filter((account) => account.config.social.connectionProvider === "unipile")
    .filter((account) => account.config.social.externalAccountId.trim())
    .filter(
      (account) =>
        account.config.social.linkedProvider === input.platform ||
        account.config.social.platforms.includes(input.platform)
    )
    .map((account) => {
      const blob = socialAccountIdentityBlob(account);
      const brandHits = brandTerms.filter((term) => blob.includes(term)).length;
      const directProviderMatch = account.config.social.linkedProvider === input.platform ? 14 : 0;
      const platformCoverage = account.config.social.platforms.includes(input.platform) ? 8 : 0;
      const profileReady = account.config.social.displayName.trim() || account.config.social.handle.trim() ? 4 : 0;
      const score = brandHits * 18 + directProviderMatch + platformCoverage + profileReady;
      return { account, score };
    })
    .sort((left, right) => right.score - left.score);
  return eligible[0]?.account ?? null;
}

function liveContentEngagementScore(context: UnipileResolvedPostContext) {
  return Math.max(0, context.likeCount + context.commentCount * 4);
}

function liveContentTitle(context: UnipileResolvedPostContext, fallbackTitle: string) {
  const firstCaptionLine = String(context.captionText ?? "")
    .split(/\n+/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return compactText(firstCaptionLine || fallbackTitle, 500);
}

function mergeLiveContentRaw(post: SocialDiscoveryPost, context: UnipileResolvedPostContext) {
  return {
    ...asRecord(post.raw),
    liveContent: {
      source: "unipile",
      lookupId: context.lookupId,
      resolvedPostId: context.resolvedPostId,
      provider: context.provider,
      url: context.url,
      createdAt: context.createdAt,
      ownerUsername: context.ownerUsername,
      ownerDisplayName: context.ownerDisplayName,
      captionText: context.captionText,
      accessibilityCaption: context.accessibilityCaption,
      likeCount: context.likeCount,
      commentCount: context.commentCount,
      summaryText: context.summaryText,
    },
  };
}

function rebuildPostFromLiveContent(input: {
  brand: BrandRecord;
  post: SocialDiscoveryPost;
  context: UnipileResolvedPostContext;
}): SocialDiscoveryPost | null {
  const liveBody = compactText(input.context.contentText, 1200) || input.post.body;
  const rescored = postWithScoring({
    id: input.post.id,
    brandId: input.post.brandId,
    platform: input.post.platform,
    provider: input.post.provider,
    externalId: input.post.externalId,
    url: input.post.url,
    title: liveContentTitle(input.context, input.post.title),
    body: liveBody,
    author: input.context.ownerUsername || input.post.author,
    community: input.post.community,
    query: input.post.query,
    engagementScore: Math.max(input.post.engagementScore, liveContentEngagementScore(input.context)),
    providerRank: input.post.providerRank,
    raw: mergeLiveContentRaw(input.post, input.context),
    postedAt: input.context.createdAt || input.post.postedAt,
    discoveredAt: input.post.discoveredAt,
    updatedAt: new Date().toISOString(),
    brand: input.brand,
  });
  if (!rescored) return null;
  return {
    ...rescored,
    id: input.post.id,
    status: input.post.status,
    discoveredAt: input.post.discoveredAt,
  };
}

async function enrichPostsWithLiveContent(input: {
  brand: BrandRecord;
  posts: SocialDiscoveryPost[];
}) {
  const instagramPosts = input.posts
    .filter((post) => post.platform === "instagram")
    .slice(0, socialLiveContentEnrichmentLimit());
  if (!instagramPosts.length) return input.posts;

  const pool = await listSocialRoutingAccounts().catch(() => []);
  const account = chooseUnipileAccountForLiveContent({
    brand: input.brand,
    platform: "instagram",
    accounts: pool,
  });
  if (!account) return input.posts;

  const updates = await Promise.all(
    instagramPosts.map(async (post) => {
      try {
        const context = await resolveUnipilePostContext({
          post,
          accountId: account.config.social.externalAccountId.trim(),
        });
        return rebuildPostFromLiveContent({
          brand: input.brand,
          post,
          context,
        });
      } catch {
        return post;
      }
    })
  );

  const byId = new Map(
    updates
      .filter((post): post is SocialDiscoveryPost => Boolean(post))
      .map((post) => [post.id, post] as const)
  );
  return input.posts
    .map((post) => byId.get(post.id) ?? post)
    .filter((post): post is SocialDiscoveryPost => Boolean(post));
}

function shouldEnhanceInteractionPlanWithLlm(post: SocialDiscoveryPost) {
  const plan = post.interactionPlan as EnrichedInteractionPlan;
  if (plan.targetStrength !== "target") return false;
  if (plan.commentPosture === "no_comment" || plan.commentPosture === "watch_only") return false;
  if (post.platform === "instagram") {
    const liveContent = liveContentFromPost(post);
    if (!String(liveContent.captionText ?? "").trim() && !String(liveContent.accessibilityCaption ?? "").trim()) {
      return false;
    }
  }
  return true;
}

function hasLiveInstagramContent(post: SocialDiscoveryPost) {
  if (post.platform !== "instagram") return true;
  const liveContent = liveContentFromPost(post);
  return Boolean(String(liveContent.captionText ?? "").trim() || String(liveContent.accessibilityCaption ?? "").trim());
}

function isSendableCommentOpportunity(
  post: SocialDiscoveryPost,
  options: { requireInstagramLiveContent?: boolean } = {}
) {
  const plan = post.interactionPlan as EnrichedInteractionPlan;
  if (plan.targetStrength !== "target") return false;
  if (plan.commentPosture === "no_comment" || plan.commentPosture === "watch_only") return false;
  if (options.requireInstagramLiveContent !== false && !hasLiveInstagramContent(post)) {
    return false;
  }
  const firstDraft = compactText(plan.sequence?.[0]?.draft, 500);
  if (!firstDraft) return false;
  if (/^no comment\b/i.test(firstDraft)) return false;
  if (/^watch only\b/i.test(firstDraft)) return false;
  if (/^do not comment\b/i.test(firstDraft)) return false;
  return true;
}

function markSnippetFallback(post: SocialDiscoveryPost): SocialDiscoveryPost {
  if (hasLiveInstagramContent(post)) return post;
  const plan = post.interactionPlan as EnrichedInteractionPlan;
  return {
    ...post,
    interactionPlan: {
      ...plan,
      fitSummary: [plan.fitSummary, "fallback draft based on search snippet, not live post content"]
        .filter(Boolean)
        .join(" · "),
      riskNotes: uniqueStrings([
        "Draft is based on search snippet because live Instagram content was unavailable for this post.",
        ...(plan.riskNotes ?? []),
      ]),
    },
  };
}

function extractOpenAiOutputText(payloadRaw: unknown) {
  const payload = asRecord(payloadRaw);
  const output = Array.isArray(payload.output) ? payload.output : [];
  const contentTexts = output
    .map((item) => asRecord(item))
    .flatMap((item) => {
      const content = Array.isArray(item.content) ? item.content : [];
      return content
        .map((entry) => asRecord(entry))
        .map((entry) => String(entry.text ?? ""))
        .filter(Boolean);
    });
  return String(payload.output_text ?? "") || String(contentTexts[0] ?? "") || "{}";
}

function parseLooseJsonObject(rawText: string): unknown {
  const direct = rawText.trim();
  if (!direct) return {};
  try {
    return JSON.parse(direct);
  } catch {
    // continue
  }

  const noFence = direct.replace(/```json/gi, "```").replace(/```/g, "").trim();
  if (noFence !== direct) {
    try {
      return JSON.parse(noFence);
    } catch {
      // continue
    }
  }

  const firstBrace = noFence.indexOf("{");
  const lastBrace = noFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(noFence.slice(firstBrace, lastBrace + 1));
    } catch {
      // continue
    }
  }
  return {};
}

function normalizeCommentPlanStrings(value: unknown, maxItems: number, maxLength: number) {
  return asArray(value)
    .map((entry) => compactText(entry, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function liveContentFromPost(post: SocialDiscoveryPost) {
  return asRecord(asRecord(post.raw).liveContent);
}

function youtubeContextFromPost(post: SocialDiscoveryPost) {
  return asRecord(asRecord(post.raw).youtube);
}

function youtubeTranscriptFromPost(post: SocialDiscoveryPost) {
  return asRecord(youtubeContextFromPost(post).videoTranscript);
}

function socialCommentPlatformLabel(platform: SocialDiscoveryPlatform) {
  if (platform === "youtube") return "YouTube";
  if (platform === "instagram") return "Instagram";
  return "social";
}

export function buildSocialCommentPlanningPrompt(input: {
  brand: BrandRecord;
  post: SocialDiscoveryPost;
  mode?: "solo" | "thread";
  force?: boolean;
}) {
  const plan = input.post.interactionPlan as EnrichedInteractionPlan;
  const liveContent = liveContentFromPost(input.post);
  const youtube = youtubeContextFromPost(input.post);
  const youtubeTranscript = youtubeTranscriptFromPost(input.post);
  const youtubeTranscriptText = compactText(youtubeTranscript.text, 3600);
  const platformLabel = socialCommentPlatformLabel(input.post.platform);
  const draftMode = input.mode === "thread" ? "thread" : "solo";
  const forceDraft = Boolean(input.force);
  const brandName = commentBrandName(input.brand.name);
  const brandCommentPrompt = resolveSocialDiscoveryCommentPrompt(input.brand.socialDiscoveryCommentPrompt).slice(0, 4000);
  return [
    `You are writing one ${platformLabel} comment for a real brand account to post.`,
    draftMode === "thread"
      ? "You are designing a two-comment thread from two different real accounts."
      : "You are designing one standalone top-level comment only.",
    "Use the following prompt for the top-level commentDraft:",
    brandCommentPrompt,
    forceDraft
      ? `Selected-video mode: mention ${brandName} exactly once as a casual side note from the brand account. It should feel like an offhand observation, not a reusable line, polished positioning, mini product explanation, or ad copy. Override heuristic_mention_policy if needed.`
      : "",
    forceDraft && draftMode === "thread"
      ? `Thread mode: mention ${brandName} in either commentDraft or replyDraft, whichever feels more natural, not both, and keep it to one short casual clause.`
      : "",
    forceDraft && draftMode === "solo"
      ? `Solo mode: commentDraft must include ${brandName} once while still sounding like a normal YouTube comment. Mention it after the real reaction, not as the main point.`
      : "",
    input.post.platform === "youtube"
      ? [
          "YouTube draft quality bar:",
          "- First infer what a real viewer would react to from the video title, description, transcript excerpt if available, channel, and brand context.",
          "- Write the comment from scratch in one pass. Do not write a normal comment and append a brand sentence.",
          "- The brand mention should be a small natural part of the thought, like something the account has seen from its own work, not an ad or CTA.",
          "- No generic reusable lines. No 'we see the same at BRAND too'. No 'we see that at BRAND'. No 'we see that a lot at BRAND'. No 'we noticed that at BRAND'. No 'we've noticed that at BRAND'. No 'seen that around BRAND too'. No 'on the BRAND side'. No 'BRAND fits this'. No product pitch.",
          "- If transcript is unavailable, use title + description + channel metadata and do not pretend to know details that are not present.",
        ].join("\n")
      : "",
    draftMode === "thread"
      ? "Also provide replyDraft for second real account replying to first comment. Design both together."
      : "Leave replyDraft empty.",
    "Always return a non-empty commentDraft for this exact video. Do not leave commentDraft empty.",
    "Set shouldComment to true.",
    "If the video is weakly related, write the most natural light-touch comment that fits the video and brand context.",
    "Brand mention rules: no polished bridge sentence, no full product framing, no feature list, no value-prop stack, no 'fits this shift', no 'exists for this', and no 'without going fully manual'.",
    draftMode === "thread"
      ? "Thread rules: commentDraft should set up natural opening, question, gap, or prompt. replyDraft should answer, recommend, or bridge naturally from different person."
      : "Solo rules: commentDraft must work alone. No setup for another account.",
    "replyDraft rules: keep it under 24 words, make it sound like second person, do not overpraise, do not sound coordinated, and leave it empty if fake or unnecessary.",
    "Return JSON only with keys: headline, fitSummary, shouldComment, commentDraft, replyDraft, assetNeeded, riskNotes, exitRules.",
    "",
    `draft_mode: ${draftMode}`,
    `social_platform: ${input.post.platform}`,
    `brand_name: ${brandName}`,
    `brand_full_name: ${input.brand.name}`,
    `brand_website: ${input.brand.website || "unknown"}`,
    `brand_product: ${compactText(input.brand.product, 320)}`,
    `brand_tone: ${compactText(input.brand.tone, 200)}`,
    `brand_notes: ${compactText(input.brand.notes, 320)}`,
    `brand_target_markets: ${compactText((input.brand.targetMarkets ?? []).join(" | "), 360)}`,
    `brand_ideal_customer_profiles: ${compactText((input.brand.idealCustomerProfiles ?? []).join(" | "), 420)}`,
    `brand_key_features: ${compactText((input.brand.keyFeatures ?? []).join(" | "), 420)}`,
    `brand_key_benefits: ${compactText((input.brand.keyBenefits ?? []).join(" | "), 420)}`,
    `post_title: ${compactText(input.post.title, 320)}`,
    `post_body: ${compactText(input.post.body, 600)}`,
    input.post.platform === "youtube" ? `youtube_video_title: ${compactText(youtube.videoTitle || input.post.title, 400)}` : "",
    input.post.platform === "youtube" ? `youtube_video_description: ${compactText(youtube.videoDescription || input.post.body, 1800)}` : "",
    input.post.platform === "youtube" ? `youtube_transcript_available: ${youtubeTranscriptText ? "yes" : "no"}` : "",
    input.post.platform === "youtube" ? `youtube_transcript_language: ${compactText(youtubeTranscript.languageCode, 80)}` : "",
    input.post.platform === "youtube" ? `youtube_transcript_excerpt: ${youtubeTranscriptText}` : "",
    input.post.platform === "youtube" ? `youtube_channel_title: ${compactText(youtube.channelTitle || input.post.author, 180)}` : "",
    input.post.platform === "youtube" ? `youtube_channel_subscribers: ${youtube.subscriberCount ?? "unknown"}` : "",
    input.post.platform === "youtube" ? `youtube_video_views: ${youtube.videoViewCount ?? "unknown"}` : "",
    input.post.platform === "youtube" ? `youtube_video_comments: ${youtube.videoCommentCount ?? "unknown"}` : "",
    `post_live_caption: ${compactText(liveContent.captionText, 900)}`,
    `post_live_accessibility: ${compactText(liveContent.accessibilityCaption, 700)}`,
    `post_live_owner: ${compactText(liveContent.ownerUsername, 120)}`,
    `post_query: ${compactText(input.post.query, 120)}`,
    `post_url: ${input.post.url}`,
    `intent: ${input.post.intent}`,
    `heuristic_headline: ${plan.headline}`,
    `heuristic_fit: ${plan.fitSummary || "none"}`,
    `heuristic_target_strength: ${plan.targetStrength}`,
    `heuristic_posture: ${plan.commentPosture}`,
    `heuristic_mention_policy: ${plan.mentionPolicy}`,
    `heuristic_comment: ${plan.sequence[0]?.draft || ""}`,
    `heuristic_reply_comment: ${plan.sequence[1]?.draft || ""}`,
  ].join("\n");
}

async function requestSocialCommentPlan(input: {
  apiKey: string;
  model: string;
  prompt: string;
}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      input: input.prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: 700,
    }),
  });
  const raw = await response.text();
  if (!response.ok) return null;
  const payload = raw ? JSON.parse(raw) : {};
  return asRecord(parseLooseJsonObject(extractOpenAiOutputText(payload)));
}

function youtubeForceDraftProblem(input: {
  platform: SocialDiscoveryPlatform;
  forceDraft: boolean;
  brandName: string;
  commentDraft: string;
  replyDraft: string;
}) {
  if (!input.forceDraft || input.platform !== "youtube") return "";
  const combinedDraft = [input.commentDraft, input.replyDraft].filter(Boolean).join("\n");
  const mentionCount = brandMentionCount(combinedDraft, input.brandName);
  if (mentionCount === 0) return `missing ${input.brandName}`;
  if (mentionCount > 1) return `mentions ${input.brandName} more than once`;
  if (brandMentionLooksCannedOrAdLike(combinedDraft, input.brandName)) {
    return `uses canned or ad-like ${input.brandName} phrasing`;
  }
  return "";
}

async function enhanceInteractionPlanWithLlm(
  input: {
    brand: BrandRecord;
    post: SocialDiscoveryPost;
  },
  options?: {
    force?: boolean;
    mode?: "solo" | "thread";
  }
): Promise<SocialDiscoveryPost> {
  const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return input.post;

  const plan = input.post.interactionPlan as EnrichedInteractionPlan;
  if (!options?.force && !shouldEnhanceInteractionPlanWithLlm(input.post)) return input.post;
  const draftMode = options?.mode === "thread" ? "thread" : "solo";
  const prompt = buildSocialCommentPlanningPrompt({
    brand: input.brand,
    post: input.post,
    mode: draftMode,
    force: options?.force,
  });

  try {
    const brandName = commentBrandName(input.brand.name);
    const model = resolveLlmModel("social_comment_planning", {
      prompt,
      legacyModelEnv: String(process.env.OPENAI_MODEL_SOCIAL_COMMENT_PLANNING ?? "").trim() || "gpt-5.4",
    });
    let promptUsed = prompt;
    let row = await requestSocialCommentPlan({ apiKey, model, prompt: promptUsed });
    if (!row) return input.post;

    let initialCommentDraft = compactText(row.commentDraft, 280);
    let initialReplyDraft = compactText(row.replyDraft, 220);
    const initialProblem = youtubeForceDraftProblem({
      platform: input.post.platform,
      forceDraft: Boolean(options?.force),
      brandName,
      commentDraft: initialCommentDraft,
      replyDraft: initialReplyDraft,
    });
    if (initialProblem) {
      promptUsed = [
        prompt,
        "",
        `Regenerate from scratch because the previous draft failed: ${initialProblem}.`,
        `The new comment must mention ${brandName} exactly once, naturally, inside the real video reaction.`,
        `Do not append a standalone ${brandName} sentence.`,
        `Do not use generic side notes like 'we see that at ${brandName}' or 'we see that a lot at ${brandName}'.`,
        "Do not use a reusable template. Return JSON only.",
      ].join("\n");
      const retryRow = await requestSocialCommentPlan({ apiKey, model, prompt: promptUsed });
      if (retryRow) {
        row = retryRow;
        initialCommentDraft = compactText(row.commentDraft, 280);
        initialReplyDraft = compactText(row.replyDraft, 220);
      }
    }

    const headline = compactText(row.headline, 140) || plan.headline;
    const fitSummary = compactText(row.fitSummary, 280) || plan.fitSummary;
    const forceDraft = Boolean(options?.force);
    const shouldComment = forceDraft ? true : row.shouldComment === false ? false : true;
    const commentDraft = initialCommentDraft;
    const replyDraft = initialReplyDraft;
    const assetNeeded = compactText(row.assetNeeded, 120) || plan.assetNeeded;
    const riskNotes = normalizeCommentPlanStrings(row.riskNotes, 5, 160);
    const exitRules = normalizeCommentPlanStrings(row.exitRules, 5, 180);
    const baseCommentDraft = shouldComment ? commentDraft || plan.sequence[0]?.draft || "" : "";
    const baseReplyDraft =
      draftMode === "thread" && shouldComment && baseCommentDraft
        ? replyDraft || plan.sequence[1]?.draft || ""
        : "";
    const finalProblem = youtubeForceDraftProblem({
      platform: input.post.platform,
      forceDraft,
      brandName,
      commentDraft: baseCommentDraft,
      replyDraft: baseReplyDraft,
    });
    if (finalProblem) {
      return {
        ...input.post,
        interactionPlan: {
          ...plan,
          generationPrompt: promptUsed,
          generationPromptMode: "auto",
          headline,
          fitSummary,
          targetStrength: "watch",
          commentPosture: "watch_only",
          sequence: [],
          riskNotes: [
            `GPT-5.4 draft rejected: ${finalProblem}. Try regenerating.`,
            ...(plan.riskNotes ?? []),
          ],
        },
      };
    }
    const forceNeedsBrand =
      forceDraft &&
      Boolean(baseCommentDraft) &&
      !textMentionsBrand(baseCommentDraft, brandName) &&
      !textMentionsBrand(baseReplyDraft, brandName);
    const nextCommentDraft =
      forceNeedsBrand && input.post.platform !== "youtube" && draftMode === "solo"
        ? addSoftBrandMention({
            draft: baseCommentDraft,
            brandName,
            maxLength: 280,
            seed: `${input.post.id}:${input.post.url}`,
          })
        : baseCommentDraft;
    const nextReplyDraft =
      forceNeedsBrand && input.post.platform !== "youtube" && draftMode === "thread" && baseReplyDraft
        ? addSoftBrandMention({
            draft: baseReplyDraft,
            brandName,
            maxLength: 220,
            seed: `${input.post.id}:${input.post.url}:reply`,
          })
        : baseReplyDraft;

    return {
      ...input.post,
      interactionPlan: {
        ...plan,
        generationPrompt: promptUsed,
        generationPromptMode: "auto",
        headline,
        fitSummary,
        assetNeeded,
        riskNotes: riskNotes.length ? riskNotes : plan.riskNotes,
        exitRules: exitRules.length ? exitRules : plan.exitRules,
        targetStrength: shouldComment && nextCommentDraft ? "target" : "watch",
        commentPosture: shouldComment && nextCommentDraft
          ? plan.commentPosture === "watch_only" || plan.commentPosture === "no_comment"
            ? "method_first"
            : plan.commentPosture
          : "watch_only",
        sequence: shouldComment && nextCommentDraft
          ? [
              {
                ...(plan.sequence[0] ?? {
                  actorRole: "operator" as const,
                  timing: "0-30 min after approval",
                  move: plan.commentPosture,
                }),
                draft: nextCommentDraft,
              },
              ...(nextReplyDraft
                ? [
                    {
                      ...(plan.sequence[1] ?? {
                        actorRole: "community" as const,
                        timing: "2-10 min after the first comment",
                        move: "second_account_reply",
                      }),
                      draft: nextReplyDraft,
                    },
                  ]
                : []),
            ]
          : [],
      },
    };
  } catch {
    return input.post;
  }
}

export async function refreshSocialDiscoveryCommentDraft(input: {
  brand: BrandRecord;
  post: SocialDiscoveryPost;
  force?: boolean;
  mode?: "solo" | "thread";
}) {
  return enhanceInteractionPlanWithLlm(
    {
      brand: input.brand,
      post: input.post,
    },
    { force: input.force, mode: input.mode }
  );
}

async function enrichInteractionPlans(input: {
  brand: BrandRecord;
  posts: SocialDiscoveryPost[];
}) {
  const limit = socialCommentPlannerLimit();
  const boosted = [...input.posts];
  const candidateIndexes = boosted
    .map((post, index) => ({ post, index }))
    .filter(({ post }) => shouldEnhanceInteractionPlanWithLlm(post))
    .slice(0, limit);

  if (!candidateIndexes.length) return boosted;

  const updates = await Promise.all(
    candidateIndexes.map(async ({ post, index }) => ({
      index,
      post: await enhanceInteractionPlanWithLlm({
        brand: input.brand,
        post,
      }),
    }))
  );

  for (const update of updates) {
    boosted[update.index] = update.post;
  }
  return boosted;
}

function buildBrandTerms(brand: BrandRecord, extraTerms?: string[]) {
  const hostname = hostnameFromUrl(brand.website);
  const hostnameParts = hostname ? [hostname, hostname.replace(/\.[a-z]+$/, "")] : [];
  return uniqueStrings([
    brand.name,
    stripMarketingSuffix(brand.name),
    ...hostnameParts,
    ...(extraTerms ?? []),
  ])
    .map((term) => cleanDiscoveryFragment(term))
    .filter((term) => term.length >= 3)
    .filter((term) => !isMarketingCopyPhrase(term));
}

export function buildSocialDiscoveryQueries(input: {
  brand: BrandRecord;
  extraTerms?: string[];
  maxQueries?: number;
  platform?: SocialDiscoveryPlatform;
}) {
  const maxQueries = Math.max(1, Math.min(40, Number(input.maxQueries ?? 12) || 12));
  const profile = inferBrandDiscoveryProfile(input.brand);
  if (profile === "personal_safety" && usesVisualDiscoveryQueries(input.platform)) {
    return buildPersonalSafetyInstagramQueries({
      extraTerms: input.extraTerms,
      maxQueries,
    });
  }
  const terms = buildBrandTerms(input.brand);
  const brandTerms = terms.slice(0, input.platform === "instagram" ? 1 : 3);
  const marketTerms = collectDiscoveryPhrases(
    input.brand.targetMarkets.length ? input.brand.targetMarkets : input.brand.idealCustomerProfiles,
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

  const discoveryPhrases = filterDiscoveryPhrasesForBrand(input.brand, uniqueStrings([...problemTerms, ...marketTerms]));
  queries.push(
    ...(usesVisualDiscoveryQueries(input.platform)
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

  if (usesVisualDiscoveryQueries(input.platform)) {
    return uniqueStrings(queries.map((query) => query.replace(/["]/g, "").slice(0, 80))).slice(0, maxQueries);
  }

  return uniqueStrings(queries).slice(0, maxQueries);
}

function normalizeYouTubeSearchQuery(value: unknown) {
  return String(value ?? "")
    .replace(/["]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function normalizeYouTubeSearchQueryList(value: unknown, maxQueries: number) {
  return uniqueStrings(asArray(value).map(normalizeYouTubeSearchQuery).filter(Boolean)).slice(0, maxQueries);
}

function buildSocialDiscoverySearchPlanningPrompt(input: {
  brand: BrandRecord;
  maxQueries: number;
  fallbackQueries: string[];
}) {
  return [
    "You are planning saved YouTube searches for an automated comment discovery system.",
    "The system runs these searches daily, finds recent YouTube videos from channels with over 1,000 subscribers, then drafts a short natural comment that can casually mention the brand.",
    "The goal is to find videos where a real operator could leave an off-the-cuff useful comment, not an ad.",
    "",
    "Brainstorm search terms that are likely to surface relevant YouTube videos, creator discussions, demos, tutorials, agency advice, pain-point videos, comparisons, and workflow breakdowns.",
    "Use the full brand context, but do not copy marketing claims or produce brand-positioning phrases.",
    "Prefer short YouTube search phrases a human would actually type.",
    "Include adjacent pains and buyer workflows, not only the brand name.",
    "Avoid exact testimonials, proof claims, slogans, URLs, and long sentences.",
    "Avoid generic terms like software, automation, ai, b2b, or tool unless paired with a concrete workflow.",
    "",
    "Return strict JSON only:",
    `{ "searchQueries": string[] }`,
    "",
    `Return exactly ${input.maxQueries} search queries.`,
    "Each query should be 2 to 7 words and under 80 characters.",
    "",
    "Brand context:",
    `name: ${compactText(input.brand.name, 160)}`,
    `website: ${compactText(input.brand.website, 220)}`,
    `tone: ${compactText(input.brand.tone, 160)}`,
    `product: ${compactText(input.brand.product, 600)}`,
    `notes: ${compactText(input.brand.notes, 1400)}`,
    `target_markets: ${input.brand.targetMarkets.map((entry) => compactText(entry, 160)).join(" | ")}`,
    `ideal_customer_profiles: ${input.brand.idealCustomerProfiles.map((entry) => compactText(entry, 160)).join(" | ")}`,
    `key_features: ${input.brand.keyFeatures.map((entry) => compactText(entry, 180)).join(" | ")}`,
    `key_benefits: ${input.brand.keyBenefits.map((entry) => compactText(entry, 180)).join(" | ")}`,
    "",
    "Weak deterministic fallback examples to improve on:",
    input.fallbackQueries.map((query) => `- ${query}`).join("\n"),
  ].join("\n");
}

async function requestSocialSearchQueriesWithLlm(input: {
  apiKey: string;
  model: string;
  prompt: string;
}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      input: input.prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: 900,
    }),
  });
  const raw = await response.text();
  if (!response.ok) return null;
  const payload = raw ? JSON.parse(raw) : {};
  return asRecord(parseLooseJsonObject(extractOpenAiOutputText(payload)));
}

export async function brainstormSocialDiscoveryYouTubeQueries(input: {
  brand: BrandRecord;
  maxQueries?: number;
}) {
  const maxQueries = Math.max(1, Math.min(40, Number(input.maxQueries ?? 12) || 12));
  const fallbackQueries = buildSocialDiscoveryQueries({
    brand: input.brand,
    platform: "youtube",
    maxQueries,
  });
  const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return fallbackQueries;

  const prompt = buildSocialDiscoverySearchPlanningPrompt({
    brand: input.brand,
    maxQueries,
    fallbackQueries,
  });

  try {
    const model = resolveLlmModel("social_search_planning", {
      prompt,
      legacyModelEnv: String(process.env.OPENAI_MODEL_SOCIAL_SEARCH_PLANNING ?? "").trim() || "gpt-5.4",
    });
    const row = await requestSocialSearchQueriesWithLlm({ apiKey, model, prompt });
    const llmQueries = normalizeYouTubeSearchQueryList(row?.searchQueries ?? row?.queries, maxQueries);
    return uniqueStrings([...llmQueries, ...fallbackQueries]).slice(0, maxQueries);
  } catch {
    return fallbackQueries;
  }
}

function normalizeManualQueries(queries: string[] | undefined, maxQueries: number) {
  return uniqueStrings(
    (queries ?? [])
      .map((query) => String(query ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
  ).slice(0, maxQueries);
}

export function parseSocialDiscoveryPlatforms(value: unknown): SocialDiscoveryPlatform[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const platforms = raw
    .map((entry) => String(entry ?? "").trim().toLowerCase())
    .filter((entry) =>
      CURRENT_SOCIAL_DISCOVERY_PLATFORMS.includes(entry as (typeof CURRENT_SOCIAL_DISCOVERY_PLATFORMS)[number])
    ) as SocialDiscoveryPlatform[];
  return platforms.length
    ? uniqueStrings(platforms) as SocialDiscoveryPlatform[]
    : [...CURRENT_SOCIAL_DISCOVERY_PLATFORMS];
}

function postWithScoring(input: Omit<
  SocialDiscoveryPost,
  "matchedTerms" | "intent" | "relevanceScore" | "risingScore" | "status" | "interactionPlan"
> & {
  brand: BrandRecord;
}) : SocialDiscoveryPost | null {
  const combinedText = `${input.title}\n${input.body}\n${input.community}`;
  const contextFit = brandContextFitFor({
    brand: input.brand,
    query: input.query,
    text: combinedText,
  });
  if (contextFit.isContextMismatch) {
    return null;
  }
  const effectivePostedAt = String(input.postedAt ?? "").trim();
  if (!isFreshEnoughForDiscovery(effectivePostedAt)) {
    return null;
  }
  const matchedTerms = matchedTermsFor({
    text: combinedText,
    brand: input.brand,
    query: input.query,
    contextFit,
  });
  const intent = classifyIntent({
    text: combinedText,
    brand: input.brand,
    matchedTerms,
    query: input.query,
    contextFit,
  });
  const score = relevanceScore({
    text: combinedText,
    brand: input.brand,
    matchedTerms,
    intent,
    engagement: input.engagementScore,
    contextFit,
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
    brand: input.brand,
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
    interactionPlan: buildInteractionPlan({ post: scoredPost, brand: input.brand, contextFit }),
  };
}

export function buildScoredSocialDiscoveryPost(input: Omit<
  SocialDiscoveryPost,
  "matchedTerms" | "intent" | "relevanceScore" | "risingScore" | "status" | "interactionPlan"
> & {
  brand: BrandRecord;
}): SocialDiscoveryPost | null;

export function buildScoredSocialDiscoveryPost(input: Omit<
  SocialDiscoveryPost,
  "matchedTerms" | "intent" | "relevanceScore" | "risingScore" | "status" | "interactionPlan"
> & {
  brand: BrandRecord;
}): SocialDiscoveryPost | null {
  return postWithScoring(input);
}

export function buildSubscribedSocialDiscoveryPost(input: Omit<
  SocialDiscoveryPost,
  "matchedTerms" | "intent" | "relevanceScore" | "risingScore" | "status" | "interactionPlan"
> & {
  brand: BrandRecord;
}) : SocialDiscoveryPost {
  const scored = postWithScoring(input);
  if (scored) return scored;

  const combinedText = `${input.title}\n${input.body}\n${input.community}`;
  const contextFit = brandContextFitFor({
    brand: input.brand,
    query: input.query,
    text: combinedText,
  });
  const matchedTerms = matchedTermsFor({
    text: combinedText,
    brand: input.brand,
    query: input.query,
    contextFit,
  });
  const intent = classifyIntent({
    text: combinedText,
    brand: input.brand,
    matchedTerms,
    query: input.query,
    contextFit,
  });
  const score = Math.max(55, relevanceScore({
    text: combinedText,
    brand: input.brand,
    matchedTerms,
    intent,
    engagement: input.engagementScore,
    contextFit,
  }));
  const risingScore = Math.max(60, risingPotentialScore({
    platform: input.platform,
    intent,
    relevanceScore: score,
    providerRank: input.providerRank,
    postedAt: input.postedAt,
    engagementScore: input.engagementScore,
    text: combinedText,
  }));
  const { brand: _brand, ...post } = input;
  void _brand;
  const scoredPost = {
    ...post,
    matchedTerms,
    intent,
    relevanceScore: score,
    risingScore,
    status: "new" as const,
  };
  return {
    ...scoredPost,
    interactionPlan: buildInteractionPlan({ post: scoredPost, brand: input.brand, contextFit }),
  };
}

export function buildForcedSubscribedCommentDraft(input: {
  brand: BrandRecord;
  post: Pick<SocialDiscoveryPost, "title" | "body" | "query" | "url" | "intent">;
}) {
  const text = `${input.post.title}\n${input.post.body}`;
  const contextFit = brandContextFitFor({
    brand: input.brand,
    query: input.post.query,
    text,
  });
  const surfaceType = interactionSurfaceType({
    text,
    query: input.post.query,
    contextFit,
  });
  const mentionPolicy = mentionPolicyForPlan({
    targetStrength: "target",
    intent: input.post.intent,
    text,
    surfaceType,
  });
  const posture = interactionPosture({
    targetStrength: "target",
    text,
    query: input.post.query,
    surfaceType,
    contextFit,
  });
  return firstCommentDraft({
    brand: input.brand,
    query: input.post.query,
    text,
    posture,
    surfaceType,
    mentionPolicy,
  })
    .replace(/\s+/g, " ")
    .trim();
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

function isDataForSeoCredentialError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /DataForSEO request failed \(401\)|status_code[": ]+40100|not authorized to access this resource/i.test(
    message
  );
}

function isDataForSeoTemporaryLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /status_code[": ]+40203|money limit per day has been exceeded|modify your cost limit/i.test(message);
}

async function canUseDataForSeo(credentials: { login: string; password: string }) {
  try {
    await dataForSeoRequest({
      credentials,
      path: "/v3/appendix/user_data",
    });
    return true;
  } catch (error) {
    if (isDataForSeoCredentialError(error)) return false;
    throw error;
  }
}

function platformPrefersSnippetFreshness(platform: SocialDiscoveryPlatform) {
  return platform === "instagram" || platform === "linkedin" || platform === "x" || platform === "youtube";
}

function resolveSearchProviderForPlatform(
  preference: SocialDiscoveryProvider | "auto" | undefined,
  platform: SocialDiscoveryPlatform
): SocialDiscoveryProvider {
  if (preference === "exa" || preference === "dataforseo") return preference;
  const hasExa = Boolean(exaApiKey());
  const hasDataForSeo = Boolean(dataForSeoCredentials());
  if (platformPrefersSnippetFreshness(platform) && hasDataForSeo) return "dataforseo";
  if (hasExa) return "exa";
  if (hasDataForSeo) return "dataforseo";
  return "exa";
}

function alternateSearchProvider(provider: SocialDiscoveryProvider): SocialDiscoveryProvider | null {
  if (provider === "exa") return dataForSeoCredentials() ? "dataforseo" : null;
  return exaApiKey() ? "exa" : null;
}

function providerDomains(platform: SocialDiscoveryPlatform) {
  if (platform === "reddit") return ["reddit.com"];
  if (platform === "instagram") return ["instagram.com"];
  if (platform === "x") return ["x.com", "twitter.com"];
  if (platform === "linkedin") return ["linkedin.com"];
  if (platform === "product-hunt") return ["producthunt.com"];
  return ["youtube.com", "youtu.be"];
}

function buildDataForSeoKeyword(input: { platform: SocialDiscoveryPlatform; query: string }) {
  const siteFilter =
    input.platform === "reddit"
      ? "(site:reddit.com/r/ OR site:reddit.com/comments/)"
      : input.platform === "instagram"
        ? "(site:instagram.com/p/ OR site:instagram.com/reel/)"
        : input.platform === "x"
          ? '((site:x.com OR site:twitter.com) "/status/")'
          : input.platform === "linkedin"
            ? "site:linkedin.com/posts/"
            : input.platform === "product-hunt"
              ? "site:producthunt.com/posts/"
              : "(site:youtube.com/watch OR site:youtube.com/shorts/ OR site:youtu.be/)";
  return `${siteFilter} ${input.query}`.trim();
}

function buildDataForSeoSearchParam(lookbackHours: number) {
  if (lookbackHours <= 1) return "tbs=qdr:h";
  if (lookbackHours <= 24) return "tbs=qdr:d";
  if (lookbackHours <= 24 * 7) return "tbs=qdr:w";
  if (lookbackHours <= 24 * 31) return "tbs=qdr:m";
  return "tbs=qdr:y";
}

function socialDiscoveryDataForSeoPollMs() {
  return Math.max(250, Math.min(10_000, Number(process.env.SOCIAL_DISCOVERY_DATAFORSEO_POLL_MS ?? 1_000) || 1_000));
}

function socialDiscoveryDataForSeoMaxPolls() {
  return Math.max(1, Math.min(20, Number(process.env.SOCIAL_DISCOVERY_DATAFORSEO_MAX_POLLS ?? 12) || 12));
}

function normalizeProviderHit(input: {
  hit: SearchProviderHit;
  brand: BrandRecord;
  discoveredAt: string;
}): SocialDiscoveryPost | null {
  const platform = platformFromUrl(input.hit.url) ?? input.hit.platform;
  if (platform !== input.hit.platform) return null;
  if (!isContentUrlForPlatform(input.hit.url, platform)) return null;
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

async function dataForSeoRequest(input: {
  credentials: { login: string; password: string };
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
}) {
  const response = await fetch(`https://api.dataforseo.com${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      Authorization: dataForSeoAuthorizationHeader(input.credentials),
      "Content-Type": "application/json",
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`DataForSEO request failed (${response.status}): ${compactText(raw, 220)}`);
  }
  return asRecord(raw ? JSON.parse(raw) : {});
}

function isPendingDataForSeoQueueStatus(statusCode: number) {
  return statusCode === 40601 || statusCode === 40602;
}

function dataForSeoTaskStatus(input: { payload: Record<string, unknown>; task: Record<string, unknown> }) {
  return Number(input.task.status_code ?? input.payload.status_code ?? 0) || 0;
}

function dataForSeoTaskStatusMessage(input: { payload: Record<string, unknown>; task: Record<string, unknown> }) {
  return compactText(input.task.status_message ?? input.payload.status_message, 160);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitDataForSeoOrganicTask(input: {
  credentials: { login: string; password: string };
  platform: SocialDiscoveryPlatform;
  query: string;
  lookbackHours: number;
  locationName: string;
  languageName: string;
  limit: number;
}) {
  const payload = await dataForSeoRequest({
    credentials: input.credentials,
    path: "/v3/serp/google/organic/task_post",
    method: "POST",
    body: [
      {
        keyword: buildDataForSeoKeyword({
          platform: input.platform,
          query: input.query,
        }),
        search_param: buildDataForSeoSearchParam(input.lookbackHours),
        location_name: input.locationName,
        language_name: input.languageName,
        device: "desktop",
        os: "windows",
        depth: Math.max(10, Math.min(100, input.limit)),
      },
    ],
  });
  const task = asRecord(asArray(payload.tasks)[0]);
  const taskId = String(task.id ?? "").trim();
  if (!taskId) {
    throw new Error(`DataForSEO task_post returned no task id for ${compactText(input.query, 80)}`);
  }
  return taskId;
}

async function fetchDataForSeoOrganicLive(input: {
  credentials: { login: string; password: string };
  platform: SocialDiscoveryPlatform;
  query: string;
  lookbackHours: number;
  locationName: string;
  languageName: string;
  limit: number;
}) {
  return dataForSeoRequest({
    credentials: input.credentials,
    path: "/v3/serp/google/organic/live/advanced",
    method: "POST",
    body: [
      {
        keyword: buildDataForSeoKeyword({
          platform: input.platform,
          query: input.query,
        }),
        search_param: buildDataForSeoSearchParam(input.lookbackHours),
        location_name: input.locationName,
        language_name: input.languageName,
        device: "desktop",
        os: "windows",
        depth: Math.max(10, Math.min(100, input.limit)),
      },
    ],
  });
}

async function pollDataForSeoOrganicTask(input: {
  credentials: { login: string; password: string };
  taskId: string;
  pollMs: number;
  maxPolls: number;
}) {
  for (let attempt = 0; attempt < input.maxPolls; attempt += 1) {
    const payload = await dataForSeoRequest({
      credentials: input.credentials,
      path: `/v3/serp/google/organic/task_get/regular/${encodeURIComponent(input.taskId)}`,
    });
    const task = asRecord(asArray(payload.tasks)[0]);
    const statusCode = dataForSeoTaskStatus({ payload, task });
    const statusMessage = dataForSeoTaskStatusMessage({ payload, task });
    if (isPendingDataForSeoQueueStatus(statusCode)) {
      if (attempt < input.maxPolls - 1) {
        await delay(input.pollMs);
        continue;
      }
      throw new Error(
        `DataForSEO task_get timed out after ${input.maxPolls} polls: ${statusMessage || "queue still pending"}`
      );
    }
    if (statusCode >= 40000) {
      throw new Error(`DataForSEO task_get failed (${statusCode}): ${statusMessage || "unknown error"}`);
    }
    return payload;
  }
  throw new Error("DataForSEO task_get ended without a result.");
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

function extractDataForSeoSerpSignals(raw: Record<string, unknown>, discoveredAt: string) {
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

function inferDataForSeoFreshPostedAt(input: {
  platform: SocialDiscoveryPlatform;
  postedAt: string;
  discoveredAt: string;
  raw: Record<string, unknown>;
}) {
  if (input.postedAt) return input.postedAt;
  if (input.platform !== "instagram") return "";
  const title = compactText(input.raw.title, 180).toLowerCase();
  const description = compactText(input.raw.description ?? input.raw.snippet, 240).toLowerCase();
  const breadcrumb = compactText(input.raw.breadcrumb, 160).toLowerCase();
  const text = `${title}\n${description}\n${breadcrumb}`;
  if (!text.trim()) return "";
  const staleSignals =
    /\b(202[0-5]|guide|lawsuit|sentenced|charged|arrested|found dead|murder|case involved|court|bill|legislation)\b/i.test(
      text
    );
  if (staleSignals) return "";
  return input.discoveredAt;
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
  const lookbackHours = socialDiscoveryLookbackHours();
  const locationName = String(process.env.DATAFORSEO_LOCATION_NAME ?? "United States").trim();
  const languageName = String(process.env.DATAFORSEO_LANGUAGE_NAME ?? "English").trim();
  const payload =
    input.platform === "instagram"
      ? await fetchDataForSeoOrganicLive({
          credentials,
          platform: input.platform,
          query: input.query,
          lookbackHours,
          locationName,
          languageName,
          limit: input.limit,
        })
      : await pollDataForSeoOrganicTask({
          credentials,
          taskId: await submitDataForSeoOrganicTask({
            credentials,
            platform: input.platform,
            query: input.query,
            lookbackHours,
            locationName,
            languageName,
            limit: input.limit,
          }),
          pollMs: socialDiscoveryDataForSeoPollMs(),
          maxPolls: socialDiscoveryDataForSeoMaxPolls(),
        });
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
      const serpSignals = extractDataForSeoSerpSignals(hit, discoveredAt);
      const inferredPostedAt = inferDataForSeoFreshPostedAt({
        platform: input.platform,
        postedAt: serpSignals.postedAt,
        discoveredAt,
        raw: hit,
      });
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
          postedAt: inferredPostedAt,
          engagementScore: serpSignals.engagementScore,
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
  if (input.provider === "exa") {
    return discoverPostsWithExa(input);
  }
  try {
    return await discoverPostsWithDataForSeo(input);
  } catch (error) {
    if ((isDataForSeoCredentialError(error) || isDataForSeoTemporaryLimitError(error)) && exaApiKey()) {
      return discoverPostsWithExa({
        brand: input.brand,
        platform: input.platform,
        query: input.query,
        limit: input.limit,
      });
    }
    throw error;
  }
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

export async function prepareSocialDiscoveryPosts(input: {
  brand: BrandRecord;
  posts: SocialDiscoveryPost[];
}) {
  const dedupedPosts = dedupePosts(input.posts);
  const liveContentPosts = await enrichPostsWithLiveContent({
    brand: input.brand,
    posts: dedupedPosts,
  });
  const plannedPosts = await enrichInteractionPlans({
    brand: input.brand,
    posts: liveContentPosts,
  });
  return plannedPosts.map((post) =>
    isSendableCommentOpportunity(post, { requireInstagramLiveContent: false }) && !hasLiveInstagramContent(post)
      ? markSnippetFallback(post)
      : post
  );
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
  const platforms = input.platforms?.length ? input.platforms : ([...CURRENT_SOCIAL_DISCOVERY_PLATFORMS] as SocialDiscoveryPlatform[]);
  let verifiedDataForSeoAvailable: boolean | null = null;
  const resolveProviderForPlatform = async (platform: SocialDiscoveryPlatform) => {
    let provider = resolveSearchProviderForPlatform(input.provider, platform);
    if (provider === "dataforseo" && exaApiKey()) {
      const credentials = dataForSeoCredentials();
      if (!credentials) {
        provider = "exa";
      } else {
        if (verifiedDataForSeoAvailable == null) {
          verifiedDataForSeoAvailable = await canUseDataForSeo(credentials);
        }
        if (!verifiedDataForSeoAvailable) {
          provider = "exa";
        }
      }
    }
    return provider;
  };
  const provider = await resolveProviderForPlatform(platforms[0] ?? "instagram");
  const limit = Math.max(1, Math.min(100, Number(input.limitPerQuery ?? 25) || 25));
  const maxQueries = Math.max(1, Math.min(40, Number(input.maxQueries ?? 12) || 12));
  const subreddits = uniqueStrings(input.subreddits ?? []).slice(0, 10);
  const manualQueries = normalizeManualQueries(input.queries, maxQueries);
  const baseQueriesByPlatform = new Map(
    platforms.map((platform) => {
      const baseQueries = manualQueries.length
        ? manualQueries
        : uniqueStrings(
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
    const primaryProvider = await resolveProviderForPlatform(platform);
    const runQueries = async (queries: string[], searchProvider: SocialDiscoveryProvider) => {
      for (const query of queries) {
        try {
          const nextPosts =
            await discoverPostsWithSearchProvider({
              brand: input.brand,
              provider: searchProvider,
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

    const initialQueries = queriesByPlatform.get(platform) ?? [];
    await runQueries(initialQueries, primaryProvider);

    let uniquePlatformPostCount = dedupePosts(platformPosts).length;
    if (uniquePlatformPostCount === 0 && input.provider !== "exa" && input.provider !== "dataforseo") {
      const alternateProvider = alternateSearchProvider(primaryProvider);
      if (alternateProvider && alternateProvider !== primaryProvider) {
        await runQueries(initialQueries, alternateProvider);
        uniquePlatformPostCount = dedupePosts(platformPosts).length;
      }
    }
    if (!manualQueries.length && uniquePlatformPostCount < sparseDiscoveryMinResults(platform)) {
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
        await runQueries(fallbackQueries, primaryProvider);
      }
    }
  }
  const queries = uniqueStrings(Array.from(queriesByPlatform.values()).flat()).slice(
    0,
    (maxQueries + sparseDiscoveryFallbackLimit("instagram")) * platforms.length
  );

  const dedupedPosts = dedupePosts(posts);
  const liveContentPosts = await enrichPostsWithLiveContent({
    brand: input.brand,
    posts: dedupedPosts,
  });
  const plannedPosts = await enrichInteractionPlans({
    brand: input.brand,
    posts: liveContentPosts,
  });
  const surfacedPosts = plannedPosts.map((post) =>
    isSendableCommentOpportunity(post, { requireInstagramLiveContent: false }) && !hasLiveInstagramContent(post)
      ? markSnippetFallback(post)
      : post
  );

  return {
    provider,
    platforms,
    queries,
    posts: surfacedPosts,
    errors,
  };
}
