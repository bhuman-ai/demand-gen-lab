import { NextResponse } from "next/server";
import { sanitizeAiText } from "@/lib/ai-sanitize";
import { getBrandById } from "@/lib/factory-data";
import { validateConcreteSuggestion } from "@/lib/experiment-suggestion-quality";
import {
  createExperimentSuggestions,
  listExperimentSuggestions,
  updateExperimentSuggestion,
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
    const qualityErrors = validateConcreteSuggestion({
      name,
      audience,
      offer,
      cta,
      emailPreview,
      successTarget,
      rationale,
    });
    if (qualityErrors.length) continue;
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
      successTarget,
      rationale,
    });
  }
  return rows.slice(0, 8);
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
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

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

  if (!response.ok) {
    const reason = await response.text().catch(() => "");
    throw new Error(`OpenAI API error (${response.status}): ${reason.slice(0, 600) || "unknown error"}`);
  }
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
  const suggestions = normalizeSuggestions(parsedRecord.suggestions);
  if (!suggestions.length) {
    throw new Error("OpenAI returned no concrete suggestions");
  }
  return suggestions;
}

export async function GET(_: Request, context: { params: Promise<{ brandId: string }> }) {
  try {
    const { brandId } = await context.params;
    const brand = await getBrandById(brandId);
    if (!brand) {
      return NextResponse.json({ error: "brand not found" }, { status: 404 });
    }
    const suggestions = await listExperimentSuggestions(brandId, "suggested");
    return NextResponse.json({ suggestions, mode: "stored" });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load experiment suggestions",
        hint: "No fallback is enabled. Fix the underlying data/runtime issue and retry.",
        debug: {
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  try {
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
    if (refresh && existing.length) {
      await Promise.all(
        existing.map((row) =>
          updateExperimentSuggestion(brandId, row.id, { status: "dismissed" })
        )
      );
    }

    let ai: StructuredSuggestion[] = [];
    try {
      ai = await openAiSuggestions({
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
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown suggestion generation error";
      const status = reason.includes("OPENAI_API_KEY") ? 503 : 502;
      return NextResponse.json(
        {
          error: "Failed to generate concrete suggestions",
          hint: "No fallback is enabled. Update brand context and retry generation.",
          debug: { reason },
        },
        { status }
      );
    }

    const created = await createExperimentSuggestions({
      brandId,
      source: "ai",
      suggestions: ai.map((row) => ({
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
    if (!created.length) {
      return NextResponse.json(
        {
          error: "No concrete suggestions were saved",
          hint: "No fallback is enabled. Regenerate with richer brand context.",
        },
        { status: 422 }
      );
    }

    const suggestions = await listExperimentSuggestions(brandId, "suggested");
    if (!suggestions.length) {
      return NextResponse.json(
        {
          error: "No concrete suggestions available",
          hint: "No fallback is enabled. Try Generate Suggestions again.",
        },
        { status: 422 }
      );
    }
    return NextResponse.json({
      suggestions,
      mode: "openai",
      created: created.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to process suggestion request",
        hint: "No fallback is enabled. Fix the underlying issue and retry.",
        debug: {
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      },
      { status: 500 }
    );
  }
}
