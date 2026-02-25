import { NextResponse } from "next/server";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import { sanitizeAiText } from "@/lib/ai-sanitize";
import { resolveLlmModel } from "@/lib/llm-router";

type ExperimentSuggestion = {
  hypothesisId: string;
  name: string;
  status: "draft";
  notes: string;
  runPolicy: {
    cadence: "3_step_7_day";
    dailyCap: number;
    hourlyCap: number;
    timezone: string;
    minSpacingMinutes: number;
  };
  executionStatus: "idle";
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeRunPolicy(value: unknown) {
  const row = asRecord(value);
  return {
    cadence: "3_step_7_day" as const,
    dailyCap: Math.max(1, Math.min(500, Number(row.dailyCap ?? 30) || 30)),
    hourlyCap: Math.max(1, Math.min(100, Number(row.hourlyCap ?? 6) || 6)),
    timezone: sanitizeAiText(String(row.timezone ?? "America/Los_Angeles")).trim() || "America/Los_Angeles",
    minSpacingMinutes: Math.max(1, Math.min(120, Number(row.minSpacingMinutes ?? 8) || 8)),
  };
}

function normalizeSuggestions(value: unknown): ExperimentSuggestion[] {
  if (!Array.isArray(value)) return [];
  const rows: ExperimentSuggestion[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    const hypothesisId = String(row.hypothesisId ?? row.hypothesis_id ?? "").trim();
    const name = sanitizeAiText(String(row.name ?? row.title ?? "").trim());
    const notes = sanitizeAiText(String(row.notes ?? row.summary ?? "").trim());
    const runPolicy = normalizeRunPolicy(row.runPolicy ?? row.run_policy);
    if (!hypothesisId || !name) continue;
    rows.push({
      hypothesisId,
      name,
      status: "draft",
      notes,
      runPolicy,
      executionStatus: "idle",
    });
  }
  return rows.slice(0, 24);
}

function fallbackSuggestions(
  hypotheses: Array<{ id: string; title: string; rationale: string }>
): ExperimentSuggestion[] {
  return hypotheses.flatMap((hypothesis) => {
    const base = sanitizeAiText(hypothesis.title || "Hypothesis").slice(0, 70);
    const rationale = sanitizeAiText(hypothesis.rationale || "core problem");
    const runPolicy = {
      cadence: "3_step_7_day" as const,
      dailyCap: 30,
      hourlyCap: 6,
      timezone: "America/Los_Angeles",
      minSpacingMinutes: 8,
    };
    return [
      {
        hypothesisId: hypothesis.id,
        name: `${base} / Hook-first`,
        status: "draft",
        notes: `Lead with a sharp hook tied to: ${rationale}.`,
        runPolicy,
        executionStatus: "idle",
      },
      {
        hypothesisId: hypothesis.id,
        name: `${base} / Proof-first`,
        status: "draft",
        notes: "Open with measurable proof, then ask a simple one-question CTA.",
        runPolicy,
        executionStatus: "idle",
      },
    ];
  });
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

  const hypotheses = campaign.hypotheses.map((h) => ({
    id: h.id,
    title: sanitizeAiText(h.title),
    rationale: sanitizeAiText(h.rationale),
  }));

  if (!hypotheses.length) {
    return NextResponse.json({ suggestions: [], mode: "empty" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ suggestions: fallbackSuggestions(hypotheses), mode: "fallback" });
  }

  const brandContext = {
    name: brand?.name ?? "",
    website: brand?.website ?? "",
    tone: brand?.tone ?? "",
    notes: brand?.notes ?? "",
  };

  const prompt = [
    "You are an expert outbound operator.",
    "Generate 2-3 experiment variants per hypothesis for email outreach.",
    "An experiment is a messaging angle variant (hook-first, proof-first, pain-first, teardown offer, etc).",
    "Keep everything email-only. Do not mention internal tools, vendors, or implementation details.",
    "Do not use the words 'apify' or 'actor'.",
    "",
    "Output JSON only in this exact shape:",
    '{ "suggestions": [{ "hypothesisId": string, "name": string, "status": "draft", "notes": string, "dailyCap": number, "hourlyCap": number, "timezone": string, "minSpacingMinutes": number }] }',
    "",
    `BrandContext: ${JSON.stringify(brandContext)}`,
    `Objective: ${JSON.stringify(campaign.objective)}`,
    "Hypotheses:",
    JSON.stringify(hypotheses, null, 2),
  ].join("\n");

  const model = resolveLlmModel("experiments_suggest", { prompt });
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
      max_output_tokens: 1800,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    return NextResponse.json({ suggestions: fallbackSuggestions(hypotheses), mode: "fallback" });
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
  const suggested = Array.isArray(parsedRecord.suggestions) ? parsedRecord.suggestions : parsedRecord.experiments;
  const normalized = normalizeSuggestions(
    Array.isArray(suggested)
      ? suggested.map((row) => {
          const r = asRecord(row);
          return {
            ...r,
            runPolicy: {
              cadence: "3_step_7_day",
              dailyCap: r.dailyCap ?? 30,
              hourlyCap: r.hourlyCap ?? 6,
              timezone: r.timezone ?? "America/Los_Angeles",
              minSpacingMinutes: r.minSpacingMinutes ?? 8,
            },
          };
        })
      : []
  );

  return NextResponse.json({
    suggestions: normalized.length ? normalized : fallbackSuggestions(hypotheses),
    mode: normalized.length ? "openai" : "fallback",
  });
}
