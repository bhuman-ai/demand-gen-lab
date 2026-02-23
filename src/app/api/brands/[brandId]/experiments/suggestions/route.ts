import { NextResponse } from "next/server";
import { sanitizeAiText } from "@/lib/ai-sanitize";
import { getBrandById } from "@/lib/factory-data";
import {
  createExperimentSuggestions,
  listExperimentSuggestions,
} from "@/lib/experiment-suggestion-data";

type SuggestionSeed = {
  name: string;
  offer: string;
  audience: string;
  rationale: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeSuggestions(value: unknown): SuggestionSeed[] {
  if (!Array.isArray(value)) return [];
  const rows: SuggestionSeed[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const row = asRecord(entry);
    const name = sanitizeAiText(String(row.name ?? row.title ?? "").trim());
    const offer = sanitizeAiText(String(row.offer ?? row.angle ?? "").trim());
    const audience = sanitizeAiText(String(row.audience ?? row.icp ?? "").trim());
    const rationale = sanitizeAiText(String(row.rationale ?? row.why ?? "").trim());
    if (!name || !offer || !audience) continue;
    const key = `${name.toLowerCase()}::${offer.toLowerCase()}::${audience.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ name, offer, audience, rationale });
  }
  return rows.slice(0, 8);
}

function systemSuggestions(input: {
  brandName: string;
  product: string;
  markets: string[];
  icps: string[];
  benefits: string[];
}): SuggestionSeed[] {
  const brandName = input.brandName.trim() || "your brand";
  const markets = input.markets.length ? input.markets : ["mid-market B2B teams"];
  const icps = input.icps.length ? input.icps : ["Revenue leaders at B2B software companies"];
  const primaryBenefit = input.benefits[0] || "improved outbound reply rates";
  const product = input.product.trim() || `${brandName}'s product`;

  return [
    {
      name: `${brandName} · Problem-first intro`,
      offer: `Offer a short diagnostic to uncover the biggest blocker preventing ${primaryBenefit}.`,
      audience: `${icps[0]} in ${markets[0]}.`,
      rationale: "Fast signal on pain intensity and willingness to engage.",
    },
    {
      name: `${brandName} · Proof-first teardown`,
      offer: `Offer a 2-minute teardown showing how peers use ${product} to get faster pipeline results.`,
      audience: `${icps[Math.min(1, icps.length - 1)]} in ${markets[0]}.`,
      rationale: "Tests whether social proof and concrete examples increase replies.",
    },
    {
      name: `${brandName} · Trigger-based outreach`,
      offer: `Lead with a timing trigger and offer a simple next step tied to ${primaryBenefit}.`,
      audience: `${icps[0]} at companies in ${markets[Math.min(1, markets.length - 1)]}.`,
      rationale: "Measures response lift from relevance + urgency framing.",
    },
    {
      name: `${brandName} · Objection-handling angle`,
      offer: `Address the most likely objection up front and propose a low-friction test.`,
      audience: `${icps[Math.min(1, icps.length - 1)]} in ${markets[Math.min(2, markets.length - 1)]}.`,
      rationale: "Checks if objection-first messaging reduces friction to reply.",
    },
  ];
}

async function openAiSuggestions(input: {
  brandName: string;
  website: string;
  tone: string;
  product: string;
  notes: string;
  markets: string[];
  icps: string[];
  features: string[];
  benefits: string[];
}): Promise<SuggestionSeed[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const prompt = [
    "You generate B2B outbound experiment suggestions.",
    "Return JSON only.",
    "Do not mention internal tooling or vendor names.",
    "Each suggestion must be concrete and immediately testable.",
    "",
    "Schema:",
    '{ "suggestions": [{ "name": string, "offer": string, "audience": string, "rationale": string }] }',
    "",
    "Generate 6 suggestions.",
    `Brand: ${JSON.stringify(input)}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.2",
      input: prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: 1400,
    }),
  });

  if (!response.ok) return [];
  const raw = await response.text();

  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  const payloadRecord = asRecord(payload);
  const output = Array.isArray(payloadRecord.output) ? payloadRecord.output : [];
  const firstOutput = asRecord(output[0]);
  const content = Array.isArray(firstOutput.content) ? firstOutput.content : [];
  const outputText =
    String(payloadRecord.output_text ?? "") ||
    String(content.map((item) => asRecord(item)).find((item) => typeof item.text === "string")?.text ?? "") ||
    "{}";

  let parsed: unknown = {};
  try {
    parsed = JSON.parse(outputText);
  } catch {
    parsed = {};
  }
  const parsedRecord = asRecord(parsed);
  return normalizeSuggestions(parsedRecord.suggestions);
}

export async function GET(_: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }
  const suggestions = await listExperimentSuggestions(brandId, "suggested");
  return NextResponse.json({ suggestions, mode: "stored" });
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const refresh = Boolean(body.refresh);

  const existing = await listExperimentSuggestions(brandId, "suggested");
  if (!refresh && existing.length >= 4) {
    return NextResponse.json({ suggestions: existing, mode: "cached" });
  }

  const seed = {
    brandName: brand.name,
    product: brand.product,
    markets: brand.targetMarkets,
    icps: brand.idealCustomerProfiles,
    benefits: brand.keyBenefits,
  };
  const system = systemSuggestions(seed);
  const ai = await openAiSuggestions({
    brandName: brand.name,
    website: brand.website,
    tone: brand.tone,
    product: brand.product,
    notes: brand.notes,
    markets: brand.targetMarkets,
    icps: brand.idealCustomerProfiles,
    features: brand.keyFeatures,
    benefits: brand.keyBenefits,
  });

  const created = await createExperimentSuggestions({
    brandId,
    source: ai.length ? "ai" : "system",
    suggestions: ai.length ? [...ai, ...system] : system,
  });

  const suggestions = await listExperimentSuggestions(brandId, "suggested");
  return NextResponse.json({
    suggestions,
    mode: ai.length ? "openai" : "system",
    created: created.length,
  });
}
