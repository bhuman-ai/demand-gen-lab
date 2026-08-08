import type { BrandRecord } from "@/lib/factory-types";

type WarmupTopicLane = {
  id: string;
  label: string;
  keywords: string[];
  copyTerm: string;
  discoveryPromptTemplate: string;
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
    id: "vendor_sales",
    label: "Vendor sales teams",
    keywords: [
      "pricing",
      "demo",
      "sales",
      "solutions",
      "product",
      "platform",
      "software",
      "tool",
      "vendor",
      "buy",
      "quote",
      "case study",
      "rate card",
    ],
    copyTerm: "vendor research",
    discoveryPromptTemplate:
      "sales teams at SaaS, software, service, or vendor companies that can answer legitimate pricing, fit, case-study, or product questions about {{topic}}",
  },
  {
    id: "vendor_support",
    label: "Vendor support teams",
    keywords: [
      "support",
      "help",
      "docs",
      "documentation",
      "integration",
      "api",
      "workflow",
      "export",
      "setup",
      "account",
      "technical",
    ],
    copyTerm: "support inquiry",
    discoveryPromptTemplate:
      "support or customer success teams for tools and services related to {{topic}} where a normal user might ask about setup, integrations, limits, or workflow",
  },
  {
    id: "agency_services",
    label: "Agencies and service providers",
    keywords: [
      "agency",
      "consultant",
      "consulting",
      "service",
      "services",
      "studio",
      "implementation",
      "retainer",
      "portfolio",
      "examples",
    ],
    copyTerm: "service provider research",
    discoveryPromptTemplate:
      "agencies, consultants, studios, or service providers that might answer availability, fit, examples, or retainer questions around {{topic}}",
  },
  {
    id: "newsletter_sponsorship",
    label: "Newsletters and communities",
    keywords: [
      "newsletter",
      "sponsor",
      "sponsorship",
      "community",
      "event",
      "webinar",
      "audience",
      "media kit",
      "rate card",
      "advertise",
    ],
    copyTerm: "community or sponsorship research",
    discoveryPromptTemplate:
      "newsletters, communities, events, podcasts, or media operators that can answer sponsorship, audience, or partnership questions about {{topic}}",
  },
  {
    id: "partner_programs",
    label: "Partner programs",
    keywords: [
      "partner",
      "partners",
      "partnership",
      "integration",
      "marketplace",
      "ecosystem",
      "affiliate",
      "co-marketing",
      "referral",
    ],
    copyTerm: "partner research",
    discoveryPromptTemplate:
      "partner, integration, marketplace, affiliate, or co-marketing teams that can answer legitimate partnership questions related to {{topic}}",
  },
  {
    id: "freelancer_projects",
    label: "Freelancers and contractors",
    keywords: [
      "freelance",
      "freelancer",
      "contractor",
      "available",
      "availability",
      "portfolio",
      "project",
      "hourly",
      "quote",
      "examples",
    ],
    copyTerm: "contractor research",
    discoveryPromptTemplate:
      "freelancers or contractors who might answer real availability, portfolio, or small-project questions related to {{topic}}",
  },
];

const DEFAULT_WARMUP_LANES: WarmupTopicLane["id"][] = [
  "vendor_sales",
  "vendor_support",
  "agency_services",
  "partner_programs",
];

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

function phraseCandidates(value: unknown) {
  const text = normalizeText(value)
    .replace(/\bCTA\s*:\s*[^\n]+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .trim();
  if (!text) return [];
  return text
    .split(/[.;:\n,]|(?:\s+-\s+)/)
    .map((entry) => normalizeText(entry))
    .filter((entry) => {
      const wordCount = entry.split(/\s+/).filter(Boolean).length;
      return wordCount >= 2 && wordCount <= 12;
    });
}

function deriveContextTerms(values: unknown[]) {
  const terms = dedupeNormalized(values.flatMap((value) => phraseCandidates(value)));
  return terms
    .filter((term) => !/^(quick question|question|cold email|outbound email)$/i.test(term))
    .slice(0, 4);
}

function interpolateDiscoveryPrompt(template: string, topic: string) {
  const safeTopic = topic || "the brand's market, tools, customers, and day-to-day operations";
  return template.replace(/{{\s*topic\s*}}/g, safeTopic);
}

function buildWarmupProfileFromValues(values: unknown[]): WarmupTopicProfile {
  const haystack = toLowerText(values);
  const lanes = deriveWarmupLanes(haystack);
  const contextTerms = deriveContextTerms(values);
  const topicTerms = contextTerms.length ? contextTerms : lanes.map((lane) => lane.copyTerm);
  const topic = formatTopicList(topicTerms);
  const discoveryPrompts = lanes
    .slice(0, 1)
    .map((lane) => interpolateDiscoveryPrompt(lane.discoveryPromptTemplate, topic));
  return {
    laneIds: lanes.map((lane) => lane.id),
    topicTerms,
    audienceText: `People and companies who can legitimately answer business questions about ${topic}.`,
    offerText: topic,
    discoveryPrompt: buildWarmupDiscoveryPromptForTerms(discoveryPrompts),
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
      label: lane.label || titleCaseWords(lane.copyTerm),
      copyTerm: lane.copyTerm,
      discoveryPrompt: interpolateDiscoveryPrompt(
        lane.discoveryPromptTemplate,
        formatTopicList(profile.topicTerms)
      ),
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
  for (const term of profile.topicTerms) {
    const normalizedTerm = normalizeText(term).toLowerCase();
    if (normalizedTerm && text.includes(normalizedTerm)) {
      score += normalizedTerm.includes(" ") ? 4 : 1;
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
