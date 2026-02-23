import { NextResponse } from "next/server";
import { sanitizeAiText } from "@/lib/ai-sanitize";
import { getBrandById } from "@/lib/factory-data";
import {
  createExperimentSuggestions,
  listExperimentSuggestions,
} from "@/lib/experiment-suggestion-data";

type StructuredSuggestion = {
  name: string;
  audience: string;
  trigger: string;
  offer: string;
  cta: string;
  emailPreview: string;
  successTarget: string;
  rationale: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeSuggestions(value: unknown): StructuredSuggestion[] {
  if (!Array.isArray(value)) return [];
  const rows: StructuredSuggestion[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const row = asRecord(entry);
    const name = sanitizeAiText(String(row.name ?? row.campaignIdea ?? row.title ?? "").trim());
    const audience = sanitizeAiText(String(row.audience ?? row.who ?? row.icp ?? "").trim());
    const trigger = sanitizeAiText(String(row.trigger ?? "").trim());
    const offer = sanitizeAiText(String(row.offer ?? "").trim());
    const cta = sanitizeAiText(String(row.cta ?? row.ask ?? "").trim());
    const emailPreview = sanitizeAiText(String(row.emailPreview ?? row.preview ?? "").trim());
    const successTarget = sanitizeAiText(String(row.successTarget ?? row.metric ?? "").trim());
    const rationale = sanitizeAiText(String(row.rationale ?? row.why ?? "").trim());
    if (!name || !audience || !offer || !cta) continue;
    const key = `${name.toLowerCase()}::${audience.toLowerCase()}::${offer.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      name,
      audience,
      trigger,
      offer,
      cta,
      emailPreview,
      successTarget: successTarget || ">=8 positive replies from first 150 sends",
      rationale,
    });
  }
  return rows.slice(0, 8);
}

function systemSuggestions(input: {
  brandName: string;
  product: string;
  markets: string[];
  icps: string[];
  benefits: string[];
  features: string[];
}): StructuredSuggestion[] {
  const brandName = input.brandName.trim() || "your brand";
  const marketA = input.markets[0] || "mid-market B2B SaaS";
  const marketB = input.markets[1] || marketA;
  const icpA = input.icps[0] || "VP Sales at 50-300 employee B2B software companies";
  const icpB = input.icps[1] || "Head of Growth at founder-led B2B software companies";
  const benefit = input.benefits[0] || "higher outbound reply rates";
  const feature = input.features[0] || input.product || `${brandName} product`;

  return [
    {
      name: `${icpA}: 90-second outbound teardown offer`,
      audience: `${icpA} in ${marketA}`,
      trigger: "Recently hiring SDRs or AEs",
      offer: `Offer a 90-second teardown showing 3 concrete fixes to improve ${benefit}.`,
      cta: "Ask if they want the teardown sent this week.",
      emailPreview:
        "Noticed you’re hiring outbound reps. I recorded a 90-sec teardown with 3 fixes to lift replies quickly.",
      successTarget: ">=10 positive replies from first 200 sends",
      rationale: "Specific offer + hiring trigger makes the message concrete and timely.",
    },
    {
      name: `${icpB}: first-100-target campaign blueprint`,
      audience: `${icpB} in ${marketB}`,
      trigger: "New quarter planning or pipeline target increase",
      offer: `Offer a first-100-target outreach blueprint using ${feature}.`,
      cta: "Ask if they want the one-page blueprint.",
      emailPreview:
        "If pipeline goals just went up this quarter, I can share a first-100-target blueprint tailored to your team.",
      successTarget: ">=8 positive replies from first 150 sends",
      rationale: "Turns a broad promise into a tangible artifact with a clear ask.",
    },
    {
      name: `${icpA}: objection-first diagnostic`,
      audience: `${icpA} in ${marketA}`,
      trigger: "Teams saying outbound is low quality or too manual",
      offer: "Lead with the top outbound objection and offer a short diagnostic call.",
      cta: "Ask for a 15-minute diagnostic this week.",
      emailPreview:
        "Most teams tell us outbound feels manual and low-converting. We run a 15-min diagnostic that surfaces 2 immediate fixes.",
      successTarget: ">=6 meetings booked from first 200 sends",
      rationale: "Acknowledging the objection first reduces friction and builds trust quickly.",
    },
    {
      name: `${icpB}: proof-first peer benchmark`,
      audience: `${icpB} in ${marketB}`,
      trigger: "Teams with visible outbound activity but low engagement",
      offer: "Share a peer benchmark snapshot and one gap they can close this month.",
      cta: "Ask permission to send the benchmark snapshot.",
      emailPreview:
        "We benchmarked similar teams and found one repeatable gap hurting replies. Want me to send the snapshot?",
      successTarget: ">=12 replies from first 180 sends",
      rationale: "Peer proof + low-friction CTA improves curiosity and response intent.",
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
}): Promise<StructuredSuggestion[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];

  const prompt = [
    "You generate concrete B2B outbound experiment ideas.",
    "Avoid buzzwords and generic phrases.",
    "Every suggestion must state exactly WHO, WHAT offer, WHAT CTA, and expected success target.",
    "No provider/tool names.",
    "",
    "Return strict JSON in this shape:",
    '{ "suggestions": [{ "name": string, "audience": string, "trigger": string, "offer": string, "cta": string, "emailPreview": string, "successTarget": string, "rationale": string }] }',
    "",
    "Rules:",
    "- name must read like a concrete campaign idea, not a generic angle label.",
    "- audience must include role + company type/size.",
    "- cta must be a single ask.",
    "- emailPreview should be one short first-line preview (max ~25 words).",
    "- successTarget must be measurable (e.g. >=8 positive replies from 150 sends).",
    "",
    "Generate 6 suggestions.",
    `BrandContext: ${JSON.stringify(input)}`,
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
      max_output_tokens: 1600,
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

  const system = systemSuggestions({
    brandName: brand.name,
    product: brand.product,
    markets: brand.targetMarkets,
    icps: brand.idealCustomerProfiles,
    benefits: brand.keyBenefits,
    features: brand.keyFeatures,
  });
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
  const concrete = ai.length ? [...ai, ...system] : system;

  const created = await createExperimentSuggestions({
    brandId,
    source: ai.length ? "ai" : "system",
    suggestions: concrete.map((row) => ({
      name: row.name,
      offer: row.offer,
      audience: row.audience,
      cta: row.cta,
      trigger: row.trigger,
      emailPreview: row.emailPreview,
      successTarget: row.successTarget,
      rationale: row.rationale,
    })),
  });

  const suggestions = await listExperimentSuggestions(brandId, "suggested");
  return NextResponse.json({
    suggestions,
    mode: ai.length ? "openai" : "system",
    created: created.length,
  });
}
