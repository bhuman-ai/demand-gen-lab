import {
  emptyMissionPlan,
} from "@/lib/mission-data";
import type { BrandRecord } from "@/lib/factory-types";
import type { MissionPlan } from "@/lib/mission-types";
import { generateJsonWithLlm } from "@/lib/llm-json";

const SITE_FETCH_TIMEOUT_MS = 8000;

type WebsiteSnapshot = {
  url: string;
  hostname: string;
  title: string;
  description: string;
  excerpt: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const entry of value) {
    const line = asString(entry);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(line);
  }
  return rows.slice(0, 10);
}

function normalizeFirstBatchSize(value: unknown) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(10, Math.min(50, parsed));
}

function extractMeta(html: string, name: string) {
  const regex = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = html.match(regex);
  return match ? match[1].trim() : "";
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : "";
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(value: string) {
  const raw = value.trim();
  if (!raw) throw new Error("websiteUrl is required");
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("websiteUrl must be an http or https URL");
  }
  return parsed;
}

async function fetchWebsiteSnapshot(websiteUrl: string): Promise<WebsiteSnapshot> {
  const parsed = normalizeUrl(websiteUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SITE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "LastB2BMissionBot/1.0" },
    });
    if (!response.ok) {
      throw new Error(`Website fetch failed with ${response.status}`);
    }
    const html = (await response.text()).slice(0, 200000);
    const title = extractMeta(html, "og:title") || extractTitle(html);
    const description = extractMeta(html, "og:description") || extractMeta(html, "description");
    return {
      url: parsed.toString(),
      hostname: parsed.hostname.replace(/^www\./, ""),
      title,
      description,
      excerpt: stripHtml(html).slice(0, 10000),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackWebsiteSnapshot(input: {
  brand: BrandRecord;
  websiteUrl: string;
  error: unknown;
}): WebsiteSnapshot {
  const parsed = normalizeUrl(input.websiteUrl);
  const errorMessage = input.error instanceof Error ? input.error.message : "Website fetch failed";
  const excerpt = [
    `Website fetch fallback used because live fetch failed: ${errorMessage}`,
    `Brand product: ${input.brand.product}`,
    `Target markets: ${(input.brand.targetMarkets ?? []).join("; ")}`,
    `Ideal customer profiles: ${(input.brand.idealCustomerProfiles ?? []).join("; ")}`,
    `Key benefits: ${(input.brand.keyBenefits ?? []).join("; ")}`,
    `Notes: ${input.brand.notes}`,
  ]
    .filter((line) => line.replace(/^[^:]+:\s*/, "").trim())
    .join("\n")
    .slice(0, 10000);
  return {
    url: parsed.toString(),
    hostname: parsed.hostname.replace(/^www\./, ""),
    title: input.brand.name,
    description: input.brand.product,
    excerpt,
  };
}

function normalizeMissionPlan(value: unknown): MissionPlan {
  const plan = emptyMissionPlan();
  const row = asRecord(value);
  const deliverabilityPlan = asRecord(row.deliverabilityPlan);
  const learningPlan = asRecord(row.learningPlan);
  return {
    ...plan,
    offerSummary: asString(row.offerSummary),
    targetCustomers: normalizeStringArray(row.targetCustomers),
    avoidList: normalizeStringArray(row.avoidList),
    outreachAngle: asString(row.outreachAngle),
    firstBatchSize: normalizeFirstBatchSize(row.firstBatchSize),
    primaryRisk: asString(row.primaryRisk),
    successCriteria: asString(row.successCriteria),
    sampleMessage: asString(row.sampleMessage),
    deliverabilityPlan: {
      ...plan.deliverabilityPlan,
      summary: asString(deliverabilityPlan.summary),
      inboxStrategy: asString(deliverabilityPlan.inboxStrategy),
      domainStrategy: asString(deliverabilityPlan.domainStrategy),
      warmupStrategy: asString(deliverabilityPlan.warmupStrategy),
      inboxPlacementTest: asString(deliverabilityPlan.inboxPlacementTest),
      dailyRamp: asString(deliverabilityPlan.dailyRamp),
      autoProvisioning: deliverabilityPlan.autoProvisioning !== false,
    },
    learningPlan: {
      ...plan.learningPlan,
      summary: asString(learningPlan.summary),
      signalsToWatch: normalizeStringArray(learningPlan.signalsToWatch),
      automaticChanges: normalizeStringArray(learningPlan.automaticChanges),
      approvalRequiredFor: normalizeStringArray(learningPlan.approvalRequiredFor),
    },
  };
}

export async function generateMissionPlan(input: {
  brand: BrandRecord;
  websiteUrl: string;
  targetCustomerText: string;
}): Promise<{
  plan: MissionPlan;
  model: string;
  website: WebsiteSnapshot;
}> {
  let website: WebsiteSnapshot;
  try {
    website = await fetchWebsiteSnapshot(input.websiteUrl);
  } catch (error) {
    website = fallbackWebsiteSnapshot({
      brand: input.brand,
      websiteUrl: input.websiteUrl,
      error,
    });
  }
  const prompt = [
    "You are the GPT-5.5 mission operator for LastB2B, an autonomous B2B outbound system.",
    "The user wants to paste a site, describe target customers, edit the AI plan, then do nothing else.",
    "Generate a grounded, editable campaign mission plan. Return strict JSON only.",
    "",
    "Hard rules:",
    "- Do not invent customer proof, integrations, metrics, or claims not supported by the site excerpt or user text.",
    "- Treat deliverability as first-class: inbox/domain provisioning, warmup, inbox placement tests, sender capacity, and daily ramp must be explicit.",
    "- The first batch should be small and safe: 10-50 contacts.",
    "- Learning should happen over time from replies, bounces, positive intent, lead sources, sender health, and message variants.",
    "- New audiences, unsupported claims, and new channels need approval.",
    "- Routine sender domain provisioning may be automatic only when platform autopilot configuration explicitly allows it.",
    "",
    "Schema:",
    JSON.stringify({
      offerSummary: "string",
      targetCustomers: ["string"],
      avoidList: ["string"],
      outreachAngle: "string",
      firstBatchSize: 25,
      primaryRisk: "string",
      successCriteria: "string",
      sampleMessage: "string",
      deliverabilityPlan: {
        summary: "string",
        inboxStrategy: "string",
        domainStrategy: "string",
        warmupStrategy: "string",
        inboxPlacementTest: "string",
        dailyRamp: "string",
        autoProvisioning: true,
      },
      learningPlan: {
        summary: "string",
        signalsToWatch: ["string"],
        automaticChanges: ["string"],
        approvalRequiredFor: ["string"],
      },
    }),
    "",
    `Brand name: ${input.brand.name}`,
    `Existing product summary: ${input.brand.product}`,
    `Existing target markets: ${(input.brand.targetMarkets ?? []).join("; ")}`,
    `Existing ICPs: ${(input.brand.idealCustomerProfiles ?? []).join("; ")}`,
    `User target customers: ${input.targetCustomerText}`,
    `Website URL: ${website.url}`,
    `Website title: ${website.title}`,
    `Website description: ${website.description}`,
    `Website excerpt: ${website.excerpt}`,
  ].join("\n");

  const generated = await generateJsonWithLlm({
    task: "mission_plan_generation",
    prompt,
    format: { type: "json_object" },
    maxOutputTokens: 2200,
    reasoningEffort: String(process.env.OPENAI_MISSION_REASONING_EFFORT ?? "high"),
    openAiOverrideModel:
      String(process.env.OPENAI_MODEL_MISSION_OPERATOR ?? "").trim() ||
      String(process.env.OPENAI_MODEL_MISSION_PLAN ?? "").trim(),
    openRouterOverrideModel:
      String(process.env.OPENROUTER_MODEL_MISSION_OPERATOR ?? "").trim() ||
      String(process.env.OPENROUTER_MODEL_MISSION_PLAN ?? "").trim(),
  });
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(generated.text || "{}");
  } catch {
    parsed = {};
  }

  const plan = normalizeMissionPlan(parsed);
  if (!plan.offerSummary || !plan.targetCustomers.length || !plan.outreachAngle) {
    throw new Error("Mission plan generation returned an incomplete plan.");
  }

  return { plan, model: `${generated.provider}:${generated.model}`, website };
}
