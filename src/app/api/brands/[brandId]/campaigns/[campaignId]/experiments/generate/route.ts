import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";
import { sanitizeAiText } from "@/lib/ai-sanitize";
import { resolveLlmModel } from "@/lib/llm-router";

type ExperimentDraft = {
  hypothesisId: string;
  name: string;
  status: "draft" | "testing" | "scaling" | "paused";
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

function normalizeExperiments(value: unknown): ExperimentDraft[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      return {
        hypothesisId: String(row.hypothesisId ?? row.hypothesis_id ?? "").trim(),
        name: String(row.name ?? row.title ?? "").trim(),
        status: ["draft", "testing", "scaling", "paused"].includes(String(row.status ?? ""))
          ? (String(row.status) as ExperimentDraft["status"])
          : "draft",
        notes: String(row.notes ?? row.summary ?? "").trim(),
        runPolicy: {
          cadence: "3_step_7_day" as const,
          dailyCap: Number(row.dailyCap ?? 30),
          hourlyCap: Number(row.hourlyCap ?? 6),
          timezone: String(row.timezone ?? "America/Los_Angeles"),
          minSpacingMinutes: Number(row.minSpacingMinutes ?? 8),
        },
        executionStatus: "idle" as const,
      };
    })
    .filter((row) => row.name.length > 0);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;
  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const body = asRecord(await request.json());
  const bodyHypotheses = Array.isArray(body.hypotheses) ? body.hypotheses : [];
  const hypotheses = bodyHypotheses.length
    ? (bodyHypotheses as { id: string; title: string; rationale: string }[])
    : campaign.hypotheses.map((h) => ({ id: h.id, title: h.title, rationale: h.rationale }));

  if (!hypotheses.length) {
    return NextResponse.json({ experiments: [], mode: "empty" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "OPENAI_API_KEY is not configured",
        hint: "Real-only mode is enabled: fallback experiment generation is disabled.",
      },
      { status: 503 }
    );
  }

  const prompt = [
    "Generate experiment variants for outreach hypotheses.",
    "Output JSON only as: { experiments: [{ hypothesisId, name, status, notes, dailyCap, hourlyCap, timezone, minSpacingMinutes }] }",
    "Create 2-3 variants per hypothesis.",
    "status must be draft.",
    "Do not mention internal tools, vendors, or implementation details.",
    "Do not use the words 'apify' or 'actor'.",
    JSON.stringify(
      hypotheses.map((h) => ({
        id: h.id,
        title: sanitizeAiText(h.title),
        rationale: sanitizeAiText(h.rationale),
      })),
      null,
      2
    ),
  ].join("\n");

  const model = resolveLlmModel("experiments_generate", { prompt });
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
    return NextResponse.json(
      {
        error: "experiment generation failed",
        hint: "Real-only mode is enabled: fallback experiment generation is disabled.",
        providerStatus: response.status,
      },
      { status: 502 }
    );
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
  const experiments = normalizeExperiments(parsedRecord.experiments);
  if (!experiments.length) {
    return NextResponse.json(
      {
        error: "experiment generation returned no usable experiments",
        hint: "Real-only mode is enabled: fallback experiment generation is disabled.",
      },
      { status: 422 }
    );
  }
  return NextResponse.json({ experiments, mode: "openai" });
}
