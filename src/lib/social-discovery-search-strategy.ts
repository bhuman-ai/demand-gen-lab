import { getBrandById, listBrands, updateBrand, type BrandRecord } from "@/lib/factory-data";
import { resolveLlmModel } from "@/lib/llm-router";
import { buildSocialDiscoveryQueries } from "@/lib/social-discovery";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  SocialDiscoverySearchQueryFamily,
  SocialDiscoverySearchQuerySource,
  SocialDiscoverySearchStrategy,
  SocialDiscoverySearchStrategyQuery,
} from "@/lib/factory-types";

const STRATEGY_VERSION = 1;
const FAMILY_ORDER: SocialDiscoverySearchQueryFamily[] = [
  "buyer_pain",
  "workflow",
  "audience",
  "trigger_event",
  "competitor_alt",
  "direct_category",
];

type BrandResolutionResult = {
  brands: BrandRecord[];
  configuredBrandIds: string[];
  scannedAllReadyBrands: boolean;
  skippedBrands: Array<{
    brandId: string;
    brandName: string;
    reason: string;
  }>;
};

type StrategyResolutionResult = {
  strategy: SocialDiscoverySearchStrategy;
  generated: boolean;
  persisted: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function boolEnv(name: string, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function numberOption(value: unknown, fallback: number, min: number, max: number) {
  if (String(value ?? "").trim() === "") return Math.max(min, Math.min(max, fallback));
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}

function splitCsv(value: unknown) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return raw
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function compactText(value: unknown, maxLength: number) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeQuery(value: unknown) {
  return String(value ?? "")
    .replace(/["]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function cleanPhrase(value: unknown) {
  return normalizeQuery(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/^https?:\/\/\S+/i, "")
    .replace(/\b(software|platform|solution|tool|tools|app|apps)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shortQueryPhrase(value: unknown, maxWords = 4) {
  const noise = new Set([
    "and",
    "to",
    "at",
    "across",
    "with",
    "from",
    "into",
    "over",
    "that",
    "this",
    "your",
    "their",
    "create",
    "creates",
    "generate",
    "using",
    "realistic",
    "scale",
    "stronger",
    "better",
    "higher",
    "more",
    "fast",
    "faster",
  ]);
  const tokens = cleanPhrase(value)
    .split(/[^A-Za-z0-9+]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .filter((word) => !noise.has(word.toLowerCase()));
  return tokens.slice(0, maxWords).join(" ");
}

function words(value: string) {
  return cleanPhrase(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
}

function phraseCandidates(values: unknown[], max = 12) {
  const candidates = values.flatMap((value) => {
    const phrase = shortQueryPhrase(value, 5);
    if (!phrase) return [];
    const parts = phrase
      .split(/[.;:|,()/-]+/)
      .map((entry) => shortQueryPhrase(entry, 5))
      .filter((entry) => words(entry).length >= 2);
    return [phrase, ...parts];
  });
  return uniqueStrings(candidates)
    .filter((entry) => words(entry).length >= 2)
    .filter((entry) => words(entry).length <= 7)
    .slice(0, max);
}

function addHours(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function strategyTtlHours() {
  return numberOption(process.env.SOCIAL_DISCOVERY_SEARCH_STRATEGY_TTL_HOURS, 168, 1, 24 * 30);
}

function directQueryLimit(maxQueries: number) {
  return Math.max(1, Math.floor(Math.max(1, maxQueries) * 0.1));
}

function familyWeight(family: SocialDiscoverySearchQueryFamily) {
  if (family === "buyer_pain" || family === "workflow") return 0.9;
  if (family === "audience" || family === "trigger_event") return 0.75;
  if (family === "competitor_alt") return 0.6;
  return 0.35;
}

function classifyQuery(brand: BrandRecord, query: string): SocialDiscoverySearchQueryFamily {
  const normalized = query.toLowerCase();
  if (/\b(alternative|alternatives|vs|versus|compare|comparison|switching|competitor)\b/i.test(normalized)) {
    return "competitor_alt";
  }
  if (/\b(workflow|tutorial|demo|how to|walkthrough|playbook|process|setup)\b/i.test(normalized)) {
    return "workflow";
  }
  if (/\b(problem|mistake|mistakes|fail|fails|struggle|pain|low|why|fix|spam)\b/i.test(normalized)) {
    return "buyer_pain";
  }
  if (/\b(founder|operator|agency|marketer|sales|customer|creator|team|leader|consultant)\b/i.test(normalized)) {
    return "audience";
  }
  if (/\b(launch|hiring|scale|scaling|growth|onboarding|outreach|prospecting|retention|pipeline)\b/i.test(normalized)) {
    return "trigger_event";
  }

  const brandTerms = uniqueStrings([
    ...words(brand.name),
    ...words(brand.website.replace(/^https?:\/\//i, "").replace(/\..*$/, "")),
  ]).filter((term) => term.length >= 4);
  if (brandTerms.some((term) => normalized.includes(term))) return "direct_category";

  const productWords = words(brand.product).slice(0, 5);
  const matchedProductWords = productWords.filter((term) => normalized.includes(term)).length;
  if (productWords.length >= 2 && matchedProductWords >= Math.min(3, productWords.length)) {
    return "direct_category";
  }

  return "workflow";
}

function queryEntry(input: {
  brand: BrandRecord;
  query: unknown;
  family?: unknown;
  source: SocialDiscoverySearchQuerySource;
  rationale?: unknown;
  weight?: unknown;
}): SocialDiscoverySearchStrategyQuery | null {
  const query = normalizeQuery(input.query);
  if (!query) return null;
  const queryWordCount = words(query).length;
  if (input.source !== "manual" && (queryWordCount < 2 || queryWordCount > 7)) return null;
  const familyRaw = String(input.family ?? "").trim().toLowerCase();
  const family = FAMILY_ORDER.includes(familyRaw as SocialDiscoverySearchQueryFamily)
    ? (familyRaw as SocialDiscoverySearchQueryFamily)
    : classifyQuery(input.brand, query);
  const parsedWeight = Number(input.weight);
  const defaultWeight =
    input.source === "llm" ? 0.9 : input.source === "manual" ? 0.7 : Math.min(0.55, familyWeight(family));
  return {
    query,
    family,
    source: input.source,
    weight: Number.isFinite(parsedWeight) ? Math.max(0, Math.min(1, parsedWeight)) : defaultWeight,
    rationale: compactText(input.rationale, 240),
  };
}

function finalizePortfolio(
  entries: SocialDiscoverySearchStrategyQuery[],
  maxQueries: number,
  options: { familyOrder?: SocialDiscoverySearchQueryFamily[] } = {}
) {
  const familyOrder = options.familyOrder?.length ? options.familyOrder : FAMILY_ORDER;
  const byQuery = new Map<string, SocialDiscoverySearchStrategyQuery>();
  for (const entry of entries) {
    const key = entry.query.toLowerCase();
    const existing = byQuery.get(key);
    if (!existing || entry.weight > existing.weight) byQuery.set(key, entry);
  }

  const grouped = new Map<SocialDiscoverySearchQueryFamily, SocialDiscoverySearchStrategyQuery[]>();
  for (const family of FAMILY_ORDER) grouped.set(family, []);
  for (const entry of byQuery.values()) {
    const group = grouped.get(entry.family) ?? [];
    group.push(entry);
    grouped.set(entry.family, group);
  }
  for (const group of grouped.values()) {
    group.sort((left, right) => right.weight - left.weight);
  }
  grouped.set("direct_category", (grouped.get("direct_category") ?? []).slice(0, directQueryLimit(maxQueries)));

  const result: SocialDiscoverySearchStrategyQuery[] = [];
  while (result.length < maxQueries) {
    const before = result.length;
    for (const family of familyOrder) {
      if (result.length >= maxQueries) break;
      const group = grouped.get(family) ?? [];
      const next = group.shift();
      if (next) result.push(next);
    }
    if (result.length === before) break;
  }

  return result.slice(0, maxQueries);
}

function rotationBucket(bucketMinutes: number) {
  return Math.floor(Date.now() / (Math.max(1, bucketMinutes) * 60 * 1000));
}

function rotateEntries(entries: SocialDiscoverySearchStrategyQuery[], bucketMinutes: number) {
  const bucket = rotationBucket(bucketMinutes);
  const grouped = new Map<SocialDiscoverySearchQueryFamily, SocialDiscoverySearchStrategyQuery[]>();
  for (const family of FAMILY_ORDER) grouped.set(family, []);
  for (const entry of entries) {
    const group = grouped.get(entry.family) ?? [];
    group.push(entry);
    grouped.set(entry.family, group);
  }
  return FAMILY_ORDER.flatMap((family, familyIndex) => {
    const group = grouped.get(family) ?? [];
    if (group.length < 2) return group;
    const offset = (bucket + familyIndex) % group.length;
    return [...group.slice(offset), ...group.slice(0, offset)];
  });
}

function rotatedRunFamilyOrder(bucketMinutes: number) {
  const adjacentFamilies: SocialDiscoverySearchQueryFamily[] = [
    "buyer_pain",
    "workflow",
    "audience",
    "trigger_event",
    "competitor_alt",
  ];
  const offset = rotationBucket(bucketMinutes) % adjacentFamilies.length;
  return [
    ...adjacentFamilies.slice(offset),
    ...adjacentFamilies.slice(0, offset),
    "direct_category" as const,
  ];
}

function buildFallbackEntries(brand: BrandRecord, maxQueries: number) {
  const productPhrases = phraseCandidates([brand.product, ...brand.keyFeatures], 8);
  const painPhrases = phraseCandidates([...brand.keyBenefits, brand.notes, brand.product], 10);
  const audiencePhrases = phraseCandidates([...brand.targetMarkets, ...brand.idealCustomerProfiles], 10);
  const baseQueries = buildSocialDiscoveryQueries({
    brand,
    platform: "youtube",
    maxQueries,
  });

  const candidates: Array<{ query: string; family: SocialDiscoverySearchQueryFamily; rationale: string }> = [];
  for (const query of baseQueries) {
    candidates.push({ query, family: classifyQuery(brand, query), rationale: "deterministic discovery fallback" });
  }
  for (const phrase of painPhrases) {
    candidates.push({ query: `${phrase} mistakes`, family: "buyer_pain", rationale: "buyer pain adjacent to the offer" });
    candidates.push({ query: `${phrase} tips`, family: "buyer_pain", rationale: "how-to pain content watched by likely buyers" });
  }
  for (const phrase of productPhrases) {
    candidates.push({ query: `${phrase} workflow`, family: "workflow", rationale: "workflow content adjacent to the product job" });
    candidates.push({ query: `${phrase} tutorial`, family: "workflow", rationale: "tutorial content watched by operators solving the job" });
  }
  for (const phrase of audiencePhrases) {
    candidates.push({ query: `${phrase} advice`, family: "audience", rationale: "audience-centered content" });
    candidates.push({ query: `${phrase} growth`, family: "trigger_event", rationale: "timing/event content for the buyer segment" });
  }
  for (const phrase of productPhrases.slice(0, 3)) {
    candidates.push({ query: `${phrase} alternatives`, family: "competitor_alt", rationale: "comparison and switching intent" });
  }
  return finalizePortfolio(
    candidates
      .map((candidate) =>
        queryEntry({
          brand,
          query: candidate.query,
          family: candidate.family,
          source: "fallback",
          rationale: candidate.rationale,
        })
      )
      .filter((entry): entry is SocialDiscoverySearchStrategyQuery => Boolean(entry)),
    maxQueries
  );
}

function buildManualEntries(brand: BrandRecord) {
  return uniqueStrings(brand.socialDiscoveryQueries.map(normalizeQuery))
    .map((query) =>
      queryEntry({
        brand,
        query,
        source: "manual",
        rationale: "saved brand search query",
      })
    )
    .filter((entry): entry is SocialDiscoverySearchStrategyQuery => Boolean(entry));
}

function buildSearchStrategyPrompt(input: {
  brand: BrandRecord;
  maxQueries: number;
  fallbackEntries: SocialDiscoverySearchStrategyQuery[];
}) {
  return [
    "Plan YouTube searches for a B2B social discovery/commenting system.",
    "Goal: find latest videos the brand's likely buyers are already watching, including adjacent pain, workflow, audience, event, and comparison videos.",
    "Do not simply repeat the product category. Direct product/category searches are allowed but must be rare.",
    "",
    "Query families:",
    "- direct_category: product/category search. At most 10% of the list.",
    "- buyer_pain: pain, mistake, failed attempt, or problem videos buyers watch.",
    "- workflow: tutorials, walkthroughs, demos, setup, process, or playbook videos around adjacent jobs.",
    "- audience: content made for the buyer persona or market, even if not about this product.",
    "- trigger_event: timing/event videos around growth, launch, onboarding, outbound, hiring, retention, migration, etc.",
    "- competitor_alt: alternatives, comparisons, switching, or manual-process replacement.",
    "",
    "Rules:",
    `- Return exactly ${input.maxQueries} queries.`,
    "- Each query should be 2 to 7 words and under 80 characters.",
    "- At least 70% must be adjacent to buyer pain/workflow/audience/event, not direct category.",
    "- Avoid brand names, URLs, slogans, proof claims, and generic one-word terms.",
    "- Use terms a human would type into YouTube.",
    "",
    "Return strict JSON only:",
    `{ "queries": [{ "query": string, "family": "buyer_pain" | "workflow" | "audience" | "trigger_event" | "competitor_alt" | "direct_category", "rationale": string }] }`,
    "",
    "Brand context:",
    `name: ${compactText(input.brand.name, 160)}`,
    `website: ${compactText(input.brand.website, 220)}`,
    `product: ${compactText(input.brand.product, 700)}`,
    `notes: ${compactText(input.brand.notes, 1200)}`,
    `target_markets: ${input.brand.targetMarkets.map((entry) => compactText(entry, 160)).join(" | ")}`,
    `ideal_customer_profiles: ${input.brand.idealCustomerProfiles.map((entry) => compactText(entry, 160)).join(" | ")}`,
    `key_features: ${input.brand.keyFeatures.map((entry) => compactText(entry, 180)).join(" | ")}`,
    `key_benefits: ${input.brand.keyBenefits.map((entry) => compactText(entry, 180)).join(" | ")}`,
    "",
    "Fallback examples to improve on:",
    input.fallbackEntries.map((entry) => `- [${entry.family}] ${entry.query}`).join("\n"),
  ].join("\n");
}

function extractOpenAiOutputText(payloadRaw: unknown) {
  const payload = asRecord(payloadRaw);
  const direct = String(payload.output_text ?? "").trim();
  if (direct) return direct;
  for (const item of asArray(payload.output)) {
    for (const content of asArray(asRecord(item).content)) {
      const text = String(asRecord(content).text ?? "").trim();
      if (text) return text;
    }
  }
  return "";
}

function parseLooseJsonObject(rawText: string) {
  const trimmed = rawText.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

async function requestLlmPortfolio(input: {
  brand: BrandRecord;
  maxQueries: number;
  fallbackEntries: SocialDiscoverySearchStrategyQuery[];
}) {
  const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return [];
  const prompt = buildSearchStrategyPrompt(input);
  const model = resolveLlmModel("social_search_planning", {
    prompt,
    legacyModelEnv: String(process.env.OPENAI_MODEL_SOCIAL_SEARCH_PLANNING ?? "").trim() || "gpt-5.4",
  });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: 1600,
    }),
  });
  if (!response.ok) return [];
  const payload = JSON.parse(await response.text());
  const parsed = asRecord(parseLooseJsonObject(extractOpenAiOutputText(payload)));
  return asArray(parsed.queries ?? parsed.searchQueries)
    .map((entry) => {
      const row = typeof entry === "string" ? { query: entry } : asRecord(entry);
      return queryEntry({
        brand: input.brand,
        query: row.query,
        family: row.family,
        source: "llm",
        rationale: row.rationale,
        weight: 0.9,
      });
    })
    .filter((entry): entry is SocialDiscoverySearchStrategyQuery => Boolean(entry));
}

async function persistSearchStrategy(input: {
  brandId: string;
  strategy: SocialDiscoverySearchStrategy;
}) {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { error } = await supabase
      .from("demanddev_brands")
      .update({ social_discovery_search_strategy: input.strategy })
      .eq("id", input.brandId);
    return !error;
  }

  const updated = await updateBrand(input.brandId, {
    socialDiscoverySearchStrategy: input.strategy,
  });
  return Boolean(updated?.socialDiscoverySearchStrategy);
}

function isStrategyFresh(strategy: SocialDiscoverySearchStrategy | null, minQueries: number) {
  if (!strategy || strategy.version !== STRATEGY_VERSION || strategy.platform !== "youtube") return false;
  if (strategy.queries.length < minQueries) return false;
  const expiresMs = Date.parse(strategy.expiresAt);
  return Number.isFinite(expiresMs) && expiresMs > Date.now();
}

export function brandYouTubeDiscoveryReadiness(brand: BrandRecord) {
  const platforms = brand.socialDiscoveryPlatforms.map((platform) => platform.trim().toLowerCase()).filter(Boolean);
  if (platforms.length && !platforms.includes("youtube")) {
    return { ready: false, reason: "youtube_not_enabled" };
  }
  if (brand.socialDiscoveryQueries.length) {
    return { ready: true, reason: "saved_queries" };
  }
  const hasProduct = cleanPhrase(brand.product).length >= 3;
  const hasBuyerContext =
    brand.targetMarkets.length > 0 ||
    brand.idealCustomerProfiles.length > 0 ||
    brand.keyFeatures.length > 0 ||
    brand.keyBenefits.length > 0;
  if (hasProduct && hasBuyerContext) {
    return { ready: true, reason: "brand_context" };
  }
  return { ready: false, reason: hasProduct ? "missing_buyer_context" : "missing_product" };
}

export function rotateBrandsForCron(brands: BrandRecord[], bucketMinutes = 5) {
  if (brands.length < 2) return brands;
  const bucket = Math.floor(Date.now() / (Math.max(1, bucketMinutes) * 60 * 1000));
  const offset = bucket % brands.length;
  return [...brands.slice(offset), ...brands.slice(0, offset)];
}

export async function resolveYouTubeDiscoveryReadyBrands(input: {
  explicitBrandIds?: string[];
  configuredBrandIds?: string[];
  scanAllBrands?: boolean;
  scanAllReadyBrands?: boolean;
  brandLimit?: unknown;
  rotationBucketMinutes?: number;
}): Promise<BrandResolutionResult> {
  const explicitBrandIds = uniqueStrings(input.explicitBrandIds ?? []);
  const configuredBrandIds = uniqueStrings(input.configuredBrandIds ?? []);
  const limit = numberOption(input.brandLimit, 10, 1, 50);

  if (explicitBrandIds.length) {
    const brands = await Promise.all(explicitBrandIds.map((brandId) => getBrandById(brandId)));
    return {
      brands: brands.filter((brand): brand is BrandRecord => Boolean(brand)).slice(0, limit),
      configuredBrandIds,
      scannedAllReadyBrands: false,
      skippedBrands: [],
    };
  }

  const byId = new Map<string, BrandRecord>();
  for (const brand of (await Promise.all(configuredBrandIds.map((brandId) => getBrandById(brandId)))).filter(
    (brand): brand is BrandRecord => Boolean(brand)
  )) {
    byId.set(brand.id, brand);
  }

  const scanReady = input.scanAllReadyBrands ?? true;
  const scanAll = Boolean(input.scanAllBrands);
  const skippedBrands: BrandResolutionResult["skippedBrands"] = [];
  if (scanReady || scanAll) {
    const allBrands = await listBrands();
    for (const brand of allBrands) {
      if (scanAll) {
        byId.set(brand.id, brand);
        continue;
      }
      const readiness = brandYouTubeDiscoveryReadiness(brand);
      if (readiness.ready) {
        byId.set(brand.id, brand);
      } else {
        skippedBrands.push({
          brandId: brand.id,
          brandName: brand.name,
          reason: readiness.reason,
        });
      }
    }
  }

  return {
    brands: rotateBrandsForCron(Array.from(byId.values()), input.rotationBucketMinutes).slice(0, limit),
    configuredBrandIds,
    scannedAllReadyBrands: scanReady || scanAll,
    skippedBrands,
  };
}

export async function resolveYouTubeSearchStrategyForBrand(input: {
  brand: BrandRecord;
  maxQueries: number;
  forceRefresh?: boolean;
  persist?: boolean;
}): Promise<StrategyResolutionResult> {
  const maxQueries = numberOption(input.maxQueries, 20, 1, 40);
  const existing = input.brand.socialDiscoverySearchStrategy;
  if (!input.forceRefresh && existing && isStrategyFresh(existing, Math.min(4, maxQueries))) {
    return {
      strategy: {
        ...existing,
        queries: finalizePortfolio(existing.queries, Math.max(existing.queries.length, maxQueries)),
      },
      generated: false,
      persisted: false,
    };
  }

  const fallbackEntries = buildFallbackEntries(input.brand, maxQueries);
  const manualEntries = buildManualEntries(input.brand);
  let llmEntries: SocialDiscoverySearchStrategyQuery[] = [];
  try {
    llmEntries = await requestLlmPortfolio({
      brand: input.brand,
      maxQueries,
      fallbackEntries,
    });
  } catch {
    llmEntries = [];
  }

  const queries = finalizePortfolio([...manualEntries, ...llmEntries, ...fallbackEntries], maxQueries);
  const strategy: SocialDiscoverySearchStrategy = {
    version: STRATEGY_VERSION,
    platform: "youtube",
    generatedAt: new Date().toISOString(),
    expiresAt: addHours(strategyTtlHours()),
    source: llmEntries.length ? (manualEntries.length ? "mixed" : "llm") : "fallback",
    queries,
    notes: "Generated portfolio caps direct category searches and prioritizes adjacent buyer pain, workflow, audience, trigger, and comparison videos.",
  };

  let persisted = false;
  if (input.persist !== false) {
    try {
      persisted = await persistSearchStrategy({
        brandId: input.brand.id,
        strategy,
      });
    } catch {
      persisted = false;
    }
  }

  return { strategy, generated: true, persisted };
}

export function selectYouTubeSearchQueriesForRun(input: {
  strategy: SocialDiscoverySearchStrategy;
  maxQueries: number;
  rotationBucketMinutes?: number;
}) {
  const bucketMinutes = input.rotationBucketMinutes ?? 60;
  const rotated = rotateEntries(input.strategy.queries, bucketMinutes);
  return finalizePortfolio(rotated, numberOption(input.maxQueries, 8, 1, 40), {
    familyOrder: rotatedRunFamilyOrder(bucketMinutes),
  });
}

export function splitSocialDiscoveryCsv(value: unknown) {
  return splitCsv(value);
}

export function envFlag(name: string, fallback = false) {
  return boolEnv(name, fallback);
}

export function envNumber(value: unknown, fallback: number, min: number, max: number) {
  return numberOption(value, fallback, min, max);
}
