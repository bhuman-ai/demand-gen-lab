import { NextResponse } from "next/server";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import type { ObjectiveData } from "@/lib/factory-types";
import { sanitizeAiText } from "@/lib/ai-sanitize";
import { resolveLlmModel } from "@/lib/llm-router";

type ObjectiveSuggestion = {
  title: string;
  goal: string;
  constraints: string;
  scoring: ObjectiveData["scoring"];
  rationale: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function clamp01(value: unknown, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(1, Math.max(0, num));
}

function normalizeScoring(value: unknown): ObjectiveData["scoring"] {
  const row = asRecord(value);
  const conversionWeight = clamp01(row.conversionWeight, 0.6);
  const qualityWeight = clamp01(row.qualityWeight, 0.2);
  const replyWeight = clamp01(row.replyWeight, 0.2);
  const sum = conversionWeight + qualityWeight + replyWeight;
  if (!sum) return { conversionWeight: 0.6, qualityWeight: 0.2, replyWeight: 0.2 };
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    conversionWeight: round(conversionWeight / sum),
    qualityWeight: round(qualityWeight / sum),
    replyWeight: round(replyWeight / sum),
  };
}

function normalizeSuggestions(value: unknown): ObjectiveSuggestion[] {
  if (!Array.isArray(value)) return [];
  const rows: ObjectiveSuggestion[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const row = asRecord(entry);
    const title = sanitizeAiText(String(row.title ?? row.label ?? "").trim());
    const goal = sanitizeAiText(String(row.goal ?? "").trim());
    const constraints = sanitizeAiText(String(row.constraints ?? "").trim());
    const rationale = sanitizeAiText(String(row.rationale ?? row.why ?? "").trim());
    const scoring = normalizeScoring(row.scoring);
    if (!title || !goal || !constraints) continue;
    const key = `${title.toLowerCase()}::${goal.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ title, goal, constraints, scoring, rationale });
  }
  return rows.slice(0, 6);
}

function fallbackSuggestions(brandName: string): ObjectiveSuggestion[] {
  const safeBrand = brandName.trim() || "your brand";
  return [
    {
      title: "Book Qualified Demos",
      goal: `Book 10 qualified demos in 14 days with ${safeBrand}'s ideal buyers.`,
      constraints:
        "Email only. Keep copy under 90 words. Target a single ICP (role + company type). Start conservative: 30 sends/day per mailbox, 6/hour, 8+ minutes between touches. Unsubscribe always on.",
      scoring: { conversionWeight: 0.7, qualityWeight: 0.2, replyWeight: 0.1 },
      rationale: "Optimized for pipeline outcomes with guardrails to protect deliverability.",
    },
    {
      title: "Validate Offer Fast",
      goal: `Validate ${safeBrand}'s offer by earning 20 replies and 3 intro calls in 10 days.`,
      constraints:
        "Email only. One offer per message. Include a simple CTA (one question). Target 1-2 verticals max. Start conservative with caps; pause on complaints or bounces.",
      scoring: { conversionWeight: 0.55, qualityWeight: 0.25, replyWeight: 0.2 },
      rationale: "Front-loads learning speed while still tracking conversion quality.",
    },
    {
      title: "Max Positive Replies",
      goal: `Generate 25 positive replies from a single ICP in 7 days (fast feedback for ${safeBrand}).`,
      constraints:
        "Email only. Short messages (50-80 words). Personalize first line. Avoid links on touch 1. Conservative caps. Stop sequence after any reply.",
      scoring: { conversionWeight: 0.4, qualityWeight: 0.2, replyWeight: 0.4 },
      rationale: "Optimized for signal density and iteration speed.",
    },
  ];
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;

  const [brand, campaign] = await Promise.all([
    getBrandById(brandId),
    getCampaignById(brandId, campaignId),
  ]);

  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const brandName = sanitizeAiText(String(brand?.name ?? "Brand"));

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ suggestions: fallbackSuggestions(brandName), mode: "fallback" });
  }

  const brandContext = {
    name: brand?.name ?? "",
    website: brand?.website ?? "",
    tone: brand?.tone ?? "",
    notes: brand?.notes ?? "",
    domains: (brand?.domains ?? []).map((d) => d.domain).slice(0, 25),
    leadsCount: (brand?.leads ?? []).length,
    inboxCount: (brand?.inbox ?? []).length,
  };

  const campaignContext = {
    name: campaign.name,
    status: campaign.status,
    objective: campaign.objective,
    hypothesesCount: campaign.hypotheses.length,
    experimentsCount: campaign.experiments.length,
  };

  const prompt = [
    "You are an expert growth operator.",
    "Create 4-6 campaign objective suggestions for outbound email outreach.",
    "These suggestions should be tailored to the brand context and campaign context below.",
    "Constraints must include conservative sending caps and deliverability guardrails.",
    "Do not mention internal tools, vendors, or implementation details.",
    "Do not use the words 'apify' or 'actor'.",
    "",
    "Output JSON only, in this exact shape:",
    '{ "suggestions": [{ "title": string, "goal": string, "constraints": string, "scoring": { "conversionWeight": number, "qualityWeight": number, "replyWeight": number }, "rationale": string }] }',
    "",
    `BrandContext: ${JSON.stringify(brandContext)}`,
    `CampaignContext: ${JSON.stringify(campaignContext)}`,
  ].join("\n");

  const model = resolveLlmModel("objective_suggest", { prompt });
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
      max_output_tokens: 1400,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    return NextResponse.json({ suggestions: fallbackSuggestions(brandName), mode: "fallback" });
  }

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
  const text =
    String(payloadRecord.output_text ?? "") ||
    String(content.map((item) => asRecord(item)).find((item) => typeof item.text === "string")?.text ?? "") ||
    "{}";

  let parsed: unknown = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }

  const parsedRecord = asRecord(parsed);
  const suggestions = normalizeSuggestions(parsedRecord.suggestions);

  return NextResponse.json({
    suggestions: suggestions.length ? suggestions : fallbackSuggestions(brandName),
    mode: suggestions.length ? "openai" : "fallback",
  });
}
