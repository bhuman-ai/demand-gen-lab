import type { BrandRecord } from "@/lib/factory-types";

type WarmupTopicLane = {
  id:
    | "art_commissions"
    | "custom_framers"
    | "interior_design"
    | "studio_furniture"
    | "bootstrapped_founders"
    | "b2b_saas_companies"
    | "indie_software_companies"
    | "startup_cloud_credits"
    | "qa_testing"
    | "personalized_video"
    | "local_hospitality"
    | "agency_growth"
    | "paid_social"
    | "retention"
    | "outbound"
    | "revops"
    | "automation"
    | "prospect_data"
    | "finance_ops";
  keywords: string[];
  copyTerm: string;
  discoveryQuery: string;
};

export type WarmupTopicProfile = {
  laneIds: WarmupTopicLane["id"][];
  topicTerms: string[];
  audienceText: string;
  offerText: string;
  discoveryPrompt: string;
};

export type WarmupTopicLaneDescriptor = {
  id: WarmupTopicLane["id"];
  label: string;
  copyTerm: string;
  discoveryPrompt: string;
};

export type WarmupIntentPack = WarmupTopicProfile & {
  keywordHints: string[];
  signature: string;
  source: "outbound_campaigns" | "brand";
  sourceCount: number;
};

const WARMUP_TOPIC_LANES: WarmupTopicLane[] = [
  {
    id: "art_commissions",
    keywords: [
      "art",
      "artist",
      "painting",
      "paintings",
      "commission",
      "commissions",
      "studio",
      "gallery",
      "framing",
      "mural",
      "interior design",
      "office furniture",
      "furniture",
    ],
    copyTerm: "studio and art commissions",
    discoveryQuery: "corporate art consultants",
  },
  {
    id: "custom_framers",
    keywords: [
      "art",
      "artist",
      "painting",
      "paintings",
      "commission",
      "commissions",
      "studio",
      "gallery",
      "framing",
      "frame",
      "custom framing",
    ],
    copyTerm: "custom framing",
    discoveryQuery: "custom framing companies",
  },
  {
    id: "interior_design",
    keywords: [
      "art",
      "artist",
      "painting",
      "paintings",
      "commission",
      "commissions",
      "studio",
      "gallery",
      "interior design",
      "interior designer",
      "decor",
    ],
    copyTerm: "interior design projects",
    discoveryQuery: "commercial interior design firms",
  },
  {
    id: "studio_furniture",
    keywords: [
      "art",
      "artist",
      "painting",
      "paintings",
      "commission",
      "commissions",
      "studio",
      "office furniture",
      "furniture",
      "studio furniture",
      "workspace",
    ],
    copyTerm: "studio furniture",
    discoveryQuery: "commercial office furniture dealers",
  },
  {
    id: "bootstrapped_founders",
    keywords: [
      "bootstrapped",
      "self-funded",
      "self funded",
      "selffunded",
      "founder",
      "founders",
      "operator",
      "operators",
      "aws credits",
      "cloud credits",
      "saas founders",
      "micro-saas",
      "indie hacker",
    ],
    copyTerm: "self-funded founder operations",
    discoveryQuery: "B2B SaaS products",
  },
  {
    id: "b2b_saas_companies",
    keywords: [
      "bootstrapped",
      "self-funded",
      "self funded",
      "selffunded",
      "founder",
      "founders",
      "operator",
      "operators",
      "saas",
      "b2b saas",
      "software company",
      "micro-saas",
    ],
    copyTerm: "B2B SaaS company operations",
    discoveryQuery: "SaaS software companies",
  },
  {
    id: "indie_software_companies",
    keywords: [
      "bootstrapped",
      "self-funded",
      "self funded",
      "selffunded",
      "founder",
      "founders",
      "operator",
      "operators",
      "indie hacker",
      "indie software",
      "micro-saas",
      "software",
    ],
    copyTerm: "indie software companies",
    discoveryQuery: "developer tool startups",
  },
  {
    id: "startup_cloud_credits",
    keywords: [
      "bootstrapped",
      "self-funded",
      "self funded",
      "selffunded",
      "founder",
      "founders",
      "operator",
      "operators",
      "aws credits",
      "cloud credits",
      "startup credits",
      "saas founders",
    ],
    copyTerm: "startup cloud credits",
    discoveryQuery: "startup accelerator programs",
  },
  {
    id: "qa_testing",
    keywords: [
      "qa",
      "testing",
      "test automation",
      "software testing",
      "quality assurance",
      "bug",
      "bugs",
      "product qa",
      "engineering quality",
      "swarmtester",
    ],
    copyTerm: "software testing",
    discoveryQuery: "software QA companies",
  },
  {
    id: "personalized_video",
    keywords: [
      "personalized video",
      "video",
      "ai video",
      "sales video",
      "customer success",
      "onboarding",
      "re-engagement",
      "creator workflows",
      "bulk personalization",
      "video outreach",
      "bhuman",
    ],
    copyTerm: "personalized video",
    discoveryQuery: "video production agencies",
  },
  {
    id: "local_hospitality",
    keywords: [
      "vibe",
      "vibes",
      "istanbul",
      "hospitality",
      "venue",
      "event",
      "tourism",
      "restaurant",
      "bar",
      "cafe",
      "community",
      "local",
    ],
    copyTerm: "local venue and hospitality operations",
    discoveryQuery: "Istanbul boutique hotels",
  },
  {
    id: "prospect_data",
    keywords: [
      "prospect",
      "prospecting",
      "lead list",
      "lead lists",
      "enrich",
      "enrichment",
      "market note",
      "market notes",
      "market research",
      "source-backed",
      "signal",
      "signals",
      "data provider",
    ],
    copyTerm: "prospect data",
    discoveryQuery: "sales intelligence software companies",
  },
  {
    id: "outbound",
    keywords: [
      "outbound",
      "pipeline",
      "sales development",
      "sdr",
      "bdr",
      "demand gen",
      "demand generation",
      "cold email",
      "lead generation",
      "gtm",
    ],
    copyTerm: "outbound",
    discoveryQuery: "lead generation agencies",
  },
  {
    id: "automation",
    keywords: [
      "automation",
      "automations",
      "workflow",
      "workflows",
      "systems",
      "ops",
      "operations",
      "ai automation",
      "agentic",
      "process automation",
    ],
    copyTerm: "automation",
    discoveryQuery: "workflow automation software companies",
  },
  {
    id: "revops",
    keywords: [
      "revops",
      "revenue operations",
      "sales ops",
      "sales operations",
      "crm ops",
      "go to market systems",
      "gtm systems",
      "crm implementation",
    ],
    copyTerm: "revops",
    discoveryQuery: "revenue operations agencies",
  },
  {
    id: "agency_growth",
    keywords: [
      "agency",
      "agencies",
      "consultant",
      "consultants",
      "consulting",
      "client delivery",
      "client services",
      "service provider",
      "services firm",
    ],
    copyTerm: "agency growth",
    discoveryQuery: "founder-led B2B agencies",
  },
  {
    id: "paid_social",
    keywords: [
      "paid social",
      "performance marketing",
      "paid media",
      "media buying",
      "tiktok",
      "creative strategy",
      "acquisition",
    ],
    copyTerm: "paid social",
    discoveryQuery: "paid social agencies",
  },
  {
    id: "retention",
    keywords: [
      "retention",
      "lifecycle",
      "email and sms",
      "sms",
      "crm marketing",
      "retention agency",
      "customer retention",
    ],
    copyTerm: "retention",
    discoveryQuery: "email retention agencies",
  },
  {
    id: "finance_ops",
    keywords: [
      "bookkeeping",
      "tax",
      "accounting",
      "fractional cfo",
      "payroll",
      "peo",
      "compliance",
      "finance ops",
      "banking",
      "spend management",
      "accounts payable",
      "accounts receivable",
    ],
    copyTerm: "finance ops",
    discoveryQuery: "fractional CFO firms",
  },
];

const DEFAULT_WARMUP_LANES: WarmupTopicLane["id"][] = ["outbound", "automation", "prospect_data"];

function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toLowerText(values: unknown[]) {
  return values
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
}

function formatTopicList(values: string[]) {
  const topics = Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean))).slice(0, 4);
  if (!topics.length) {
    return "growth, sales, and operations";
  }
  if (topics.length === 1) {
    return topics[0] ?? "";
  }
  if (topics.length === 2) {
    return `${topics[0]} and ${topics[1]}`;
  }
  return `${topics.slice(0, -1).join(", ")}, and ${topics[topics.length - 1]}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsKeyword(haystack: string, keyword: string) {
  const normalizedKeyword = normalizeText(keyword).toLowerCase();
  if (!normalizedKeyword) {
    return false;
  }
  const pattern = normalizedKeyword
    .split(/\s+/)
    .map((part) => escapeRegExp(part))
    .join("\\s+");
  const regex = new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i");
  return regex.test(haystack);
}

function scoreLane(haystack: string, lane: WarmupTopicLane) {
  let score = 0;
  for (const keyword of lane.keywords) {
    if (!containsKeyword(haystack, keyword)) {
      continue;
    }
    score += keyword.includes(" ") ? 3 : 1;
  }
  return score;
}

function deriveWarmupLanes(haystack: string) {
  const ranked = WARMUP_TOPIC_LANES.map((lane, index) => ({
    lane,
    index,
    score: scoreLane(haystack, lane),
  }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })
    .slice(0, 4)
    .map((entry) => entry.lane);

  if (ranked.length) {
    return ranked;
  }

  return DEFAULT_WARMUP_LANES.map(
    (laneId) => WARMUP_TOPIC_LANES.find((lane) => lane.id === laneId)!
  );
}

function buildWarmupProfileFromValues(values: unknown[]): WarmupTopicProfile {
  const haystack = toLowerText(values);
  const lanes = deriveWarmupLanes(haystack);
  const topicTerms = lanes.map((lane) => lane.copyTerm);
  const discoveryQueries = lanes.slice(0, 1).map((lane) => lane.discoveryQuery);
  return {
    laneIds: lanes.map((lane) => lane.id),
    topicTerms,
    audienceText: `B2B teams working on ${formatTopicList(topicTerms)}.`,
    offerText: formatTopicList(topicTerms),
    discoveryPrompt: buildWarmupDiscoveryPromptForTerms(discoveryQueries),
  };
}

function buildWarmupDiscoveryPromptForTerms(discoveryQueries: string[]) {
  const target = formatTopicList(dedupeNormalized(discoveryQueries).slice(0, 1));
  return target || "B2B founders and operators";
}

function titleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function lookupLane(laneId: WarmupTopicLane["id"]) {
  return WARMUP_TOPIC_LANES.find((lane) => lane.id === laneId) ?? null;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function dedupeNormalized(values: string[]) {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function laneKeywordsForProfile(profile: WarmupTopicProfile) {
  return profile.laneIds.flatMap((laneId) => {
    const lane = lookupLane(laneId);
    if (!lane) return [];
    return [lane.copyTerm, ...lane.keywords];
  });
}

function rotateArray<T>(items: T[], offset: number) {
  if (items.length <= 1) return [...items];
  const normalizedOffset = ((offset % items.length) + items.length) % items.length;
  if (normalizedOffset === 0) return [...items];
  return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)];
}

function interleaveRowBuckets<T>(buckets: Array<{ items: T[] }>) {
  const queues = buckets.map((bucket) => [...bucket.items]);
  const combined: T[] = [];
  let appended = true;
  while (appended) {
    appended = false;
    for (const queue of queues) {
      if (!queue.length) continue;
      const next = queue.shift();
      if (next === undefined) continue;
      combined.push(next);
      appended = true;
    }
  }
  return combined;
}

export function deriveWarmupTopicProfile(input: {
  audience?: string;
  offer?: string;
  fallbackName?: string;
}) {
  return buildWarmupProfileFromValues([input.offer, input.audience, input.fallbackName]);
}

export function buildWarmupIntentPack(input: {
  brand: Pick<
    BrandRecord,
    "name" | "product" | "notes" | "targetMarkets" | "idealCustomerProfiles" | "keyFeatures" | "keyBenefits"
  >;
  outboundSignals?: Array<{
    name?: string;
    offer?: string;
    audience?: string;
  }>;
}) {
  const outboundSignals = Array.isArray(input.outboundSignals)
    ? input.outboundSignals
        .map((signal) => ({
          name: normalizeText(signal?.name),
          offer: normalizeText(signal?.offer),
          audience: normalizeText(signal?.audience),
        }))
        .filter((signal) => signal.name || signal.offer || signal.audience)
    : [];
  const signalValues = outboundSignals.flatMap((signal) => [signal.name, signal.offer, signal.audience]);
  const hasOutboundSignals = signalValues.some(Boolean);
  const brandValues = [
    input.brand.name,
    input.brand.product,
    input.brand.notes,
    ...(input.brand.targetMarkets ?? []),
    ...(input.brand.idealCustomerProfiles ?? []),
    ...(input.brand.keyFeatures ?? []),
    ...(input.brand.keyBenefits ?? []),
  ];
  const profile = hasOutboundSignals
    ? buildWarmupProfileFromValues([...brandValues, ...signalValues])
    : deriveWarmupTopicProfileFromBrand(input.brand);
  const keywordHints = dedupeNormalized(laneKeywordsForProfile(profile)).slice(0, 12);
  const signaturePayload = JSON.stringify({
    source: hasOutboundSignals ? "outbound_campaigns" : "brand",
    signalValues,
    topicTerms: profile.topicTerms,
    keywordHints,
  });

  return {
    ...profile,
    keywordHints,
    signature: `warmup_${stableHash(signaturePayload).toString(16)}`,
    source: hasOutboundSignals ? ("outbound_campaigns" as const) : ("brand" as const),
    sourceCount: hasOutboundSignals ? outboundSignals.length : 1,
  } satisfies WarmupIntentPack;
}

export function deriveWarmupTopicLaneDescriptors(input: {
  audience?: string;
  offer?: string;
  fallbackName?: string;
}): WarmupTopicLaneDescriptor[] {
  const profile = deriveWarmupTopicProfile(input);
  return profile.laneIds
    .map((laneId) => lookupLane(laneId))
    .filter((lane): lane is WarmupTopicLane => Boolean(lane))
    .map((lane) => ({
      id: lane.id,
      label: titleCaseWords(lane.copyTerm),
      copyTerm: lane.copyTerm,
      discoveryPrompt: buildWarmupDiscoveryPromptForTerms([lane.discoveryQuery]),
    }));
}

export function deriveWarmupTopicProfileFromBrand(
  brand: Pick<
    BrandRecord,
    "name" | "product" | "notes" | "targetMarkets" | "idealCustomerProfiles" | "keyFeatures" | "keyBenefits"
  >
): WarmupTopicProfile {
  return buildWarmupProfileFromValues([
    brand.name,
    brand.product,
    brand.notes,
    ...(brand.targetMarkets ?? []),
    ...(brand.idealCustomerProfiles ?? []),
    ...(brand.keyFeatures ?? []),
    ...(brand.keyBenefits ?? []),
  ]);
}

export function buildWarmupAudienceTemplate(seedText: string) {
  return buildWarmupProfileFromValues([seedText]).audienceText;
}

export function buildWarmupOfferTemplate(_brandName: string, seedText: string) {
  return buildWarmupProfileFromValues([seedText]).offerText;
}

export function buildWarmupDiscoveryPromptTemplate(input: {
  audience?: string;
  offer?: string;
  fallbackName?: string;
}) {
  return deriveWarmupTopicProfile(input).discoveryPrompt;
}

function flattenRowText(value: unknown): string {
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => flattenRowText(entry)).join(" ");
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((entry) => flattenRowText(entry))
      .join(" ");
  }
  return "";
}

function scoreWarmupRow(text: string, profile: WarmupTopicProfile) {
  let score = 0;
  for (const laneId of profile.laneIds) {
    const lane = WARMUP_TOPIC_LANES.find((entry) => entry.id === laneId);
    if (!lane) continue;
    for (const keyword of lane.keywords) {
      if (keyword && text.includes(keyword)) {
        score += keyword.includes(" ") ? 3 : 1;
      }
    }
    if (text.includes(lane.copyTerm)) {
      score += 3;
    }
  }

  if (
    text.includes("marketing") ||
    text.includes("growth") ||
    text.includes("sales") ||
    text.includes("partnership") ||
    text.includes("revops") ||
    text.includes("operations")
  ) {
    score += 2;
  }

  return score;
}

export function prioritizeWarmupProspectRows(
  rows: unknown[],
  input: {
    audience?: string;
    offer?: string;
    fallbackName?: string;
  }
) {
  const profile = buildWarmupProfileFromValues([input.offer, input.audience, input.fallbackName]);
  return rows
    .map((row, index) => ({
      row,
      index,
      score: scoreWarmupRow(flattenRowText(row), profile),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

export function allocateWarmupProspectRowsByReservoir(input: {
  audience?: string;
  offer?: string;
  fallbackName?: string;
  senderKey?: string;
  reservoirs: Array<{ laneId: WarmupTopicLane["id"]; rows: unknown[] }>;
}) {
  const profile = deriveWarmupTopicProfile(input);
  const senderKey = normalizeText(input.senderKey) || "default";
  const orderedLaneIds = rotateArray(profile.laneIds, stableHash(senderKey) % Math.max(1, profile.laneIds.length));
  const prioritizedBuckets = orderedLaneIds.map((laneId) => {
    const matchingReservoir = input.reservoirs.find((entry) => entry.laneId === laneId);
    const rankedRows = prioritizeWarmupProspectRows(matchingReservoir?.rows ?? [], input);
    const rotatedRows =
      rankedRows.length > 1
        ? rotateArray(rankedRows, stableHash(`${senderKey}:${laneId}`) % rankedRows.length)
        : rankedRows;
    return {
      laneId,
      rows: rotatedRows,
    };
  });

  return {
    laneOrder: orderedLaneIds,
    rows: interleaveRowBuckets(prioritizedBuckets.map((bucket) => ({ items: bucket.rows }))),
  };
}
