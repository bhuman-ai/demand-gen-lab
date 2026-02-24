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

type RoleplayEvaluation = {
  index: number;
  score: number;
  openLikelihood: number;
  replyLikelihood: number;
  positiveReplyLikelihood: number;
  unsubscribeRisk: number;
  decision: "promote" | "revise" | "reject";
  summary: string;
  strengths: string[];
  risks: string[];
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function clampPercent(value: unknown, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
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

function normalizeRoleplayEvaluations(
  value: unknown,
  suggestionCount: number
): RoleplayEvaluation[] {
  if (!Array.isArray(value)) return [];
  const rows: RoleplayEvaluation[] = [];
  const seen = new Set<number>();

  for (const entry of value) {
    const row = asRecord(entry);
    const index = Number(row.index);
    if (!Number.isInteger(index) || index < 0 || index >= suggestionCount || seen.has(index)) {
      continue;
    }
    seen.add(index);

    const decisionRaw = String(row.decision ?? "").trim().toLowerCase();
    const decision: RoleplayEvaluation["decision"] =
      decisionRaw === "promote" || decisionRaw === "reject" ? decisionRaw : "revise";

    const strengths = Array.isArray(row.strengths)
      ? row.strengths
          .map((item) => sanitizeAiText(String(item ?? "").trim()))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    const risks = Array.isArray(row.risks)
      ? row.risks
          .map((item) => sanitizeAiText(String(item ?? "").trim()))
          .filter(Boolean)
          .slice(0, 3)
      : [];

    rows.push({
      index,
      score: clampPercent(row.score, 0),
      openLikelihood: clampPercent(row.openLikelihood, 0),
      replyLikelihood: clampPercent(row.replyLikelihood, 0),
      positiveReplyLikelihood: clampPercent(row.positiveReplyLikelihood, 0),
      unsubscribeRisk: clampPercent(row.unsubscribeRisk, 100),
      decision,
      summary: sanitizeAiText(String(row.summary ?? "").trim()),
      strengths,
      risks,
    });
  }

  return rows;
}

function rankRoleplayEvaluation(evaluation: RoleplayEvaluation) {
  const decisionBoost = evaluation.decision === "promote" ? 8 : evaluation.decision === "revise" ? 2 : -12;
  return (
    evaluation.score +
    evaluation.openLikelihood * 0.15 +
    evaluation.replyLikelihood * 0.45 +
    evaluation.positiveReplyLikelihood * 0.35 -
    evaluation.unsubscribeRisk * 0.5 +
    decisionBoost
  );
}

function passesRoleplayGate(evaluation: RoleplayEvaluation) {
  if (evaluation.decision === "reject") return false;
  if (evaluation.score < 62) return false;
  if (evaluation.replyLikelihood < 12) return false;
  if (evaluation.positiveReplyLikelihood < 6) return false;
  if (evaluation.unsubscribeRisk > 35) return false;
  return true;
}

async function openAiRoleplayEvaluate(input: {
  brandName: string;
  website: string;
  product: string;
  tone: string;
  markets: string[];
  icps: string[];
  suggestions: StructuredSuggestion[];
}): Promise<RoleplayEvaluation[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const prompt = [
    "You are a realistic buyer-simulation panel for B2B cold outreach.",
    "Evaluate each suggestion as if real recipients are busy, skeptical, annoyed, cautious, and curious.",
    "Each evaluation must reflect likely inbox behavior, not idealized behavior.",
    "",
    "Simulation setup per suggestion:",
    "- Run 12 micro roleplays across personas: busy operator, annoyed exec, skeptical manager, curious evaluator, price-sensitive buyer, delegated inbox gatekeeper.",
    "- Judge outcomes: open likelihood, reply likelihood, positive reply likelihood, unsubscribe risk.",
    "- Be strict on generic, hypey, vague, or spammy language.",
    "",
    "Return strict JSON only:",
    '{ "evaluations": [{ "index": number, "score": number, "openLikelihood": number, "replyLikelihood": number, "positiveReplyLikelihood": number, "unsubscribeRisk": number, "decision": "promote"|"revise"|"reject", "summary": string, "strengths": string[], "risks": string[] }] }',
    "",
    "Rules:",
    "- index must match the input suggestion index.",
    "- 0-100 integers for score/openLikelihood/replyLikelihood/positiveReplyLikelihood/unsubscribeRisk.",
    "- strengths and risks each max 3 bullets, concrete and short.",
    "- Do not use provider/tool implementation terms.",
    "",
    `BrandContext: ${JSON.stringify({
      brandName: input.brandName,
      website: input.website,
      product: input.product,
      tone: input.tone,
      markets: input.markets,
      icps: input.icps,
    })}`,
    `Suggestions: ${JSON.stringify(input.suggestions.map((suggestion, index) => ({ index, ...suggestion })))}`,
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
      max_output_tokens: 2200,
    }),
  });

  if (!response.ok) {
    const reason = await response.text().catch(() => "");
    throw new Error(`OpenAI roleplay API error (${response.status}): ${reason.slice(0, 600) || "unknown error"}`);
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
  const evaluations = normalizeRoleplayEvaluations(parsedRecord.evaluations, input.suggestions.length);
  if (evaluations.length !== input.suggestions.length) {
    throw new Error(
      `Roleplay evaluation mismatch: expected ${input.suggestions.length}, got ${evaluations.length}`
    );
  }
  return evaluations;
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

    let roleplayEvaluations: RoleplayEvaluation[] = [];
    try {
      roleplayEvaluations = await openAiRoleplayEvaluate({
        brandName: brand.name,
        website: brand.website,
        product: brand.product,
        tone: brand.tone,
        markets: brand.targetMarkets,
        icps: brand.idealCustomerProfiles,
        suggestions: ai,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown roleplay evaluation error";
      return NextResponse.json(
        {
          error: "Failed to roleplay-evaluate suggestions",
          hint: "Backend screening is required before ideas are shown. Retry generation.",
          debug: { reason },
        },
        { status: 502 }
      );
    }

    const evaluationsByIndex = new Map(roleplayEvaluations.map((row) => [row.index, row]));
    const screened = ai
      .map((suggestion, index) => {
        const evaluation = evaluationsByIndex.get(index);
        if (!evaluation) return null;
        return {
          suggestion,
          evaluation,
          rankScore: rankRoleplayEvaluation(evaluation),
        };
      })
      .filter((row): row is { suggestion: StructuredSuggestion; evaluation: RoleplayEvaluation; rankScore: number } => Boolean(row))
      .filter((row) => passesRoleplayGate(row.evaluation))
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, 6)
      .map((row) => ({
        ...row.suggestion,
        rationale: sanitizeAiText(
          [row.suggestion.rationale, row.evaluation.summary].filter(Boolean).join(" ")
        ),
      }));

    if (!screened.length) {
      const topRejected = roleplayEvaluations
        .sort((a, b) => rankRoleplayEvaluation(b) - rankRoleplayEvaluation(a))
        .slice(0, 3)
        .map((row) => ({
          index: row.index,
          decision: row.decision,
          score: row.score,
          replyLikelihood: row.replyLikelihood,
          unsubscribeRisk: row.unsubscribeRisk,
          summary: row.summary,
        }));

      return NextResponse.json(
        {
          error: "No suggestions passed backend roleplay screening",
          hint: "Update brand context and retry generation.",
          debug: { topRejected },
        },
        { status: 422 }
      );
    }

    const created = await createExperimentSuggestions({
      brandId,
      source: "ai",
      suggestions: screened.map((row) => ({
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
      mode: "openai_roleplay_screened",
      screened: ai.length,
      kept: screened.length,
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
