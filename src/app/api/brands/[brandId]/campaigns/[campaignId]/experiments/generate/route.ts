import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";

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

function fallbackExperiments(
  hypotheses: { id: string; title: string; rationale: string; actorQuery?: string }[]
): ExperimentDraft[] {
  return hypotheses.flatMap((hypothesis) => {
    const base = hypothesis.title || "Hypothesis";
    return [
      {
        hypothesisId: hypothesis.id,
        name: `${base} / Hook-first`,
        status: "draft" as const,
        notes: `Lead with a sharp hook tied to: ${hypothesis.rationale || "core problem"}.`,
        runPolicy: {
          cadence: "3_step_7_day",
          dailyCap: 30,
          hourlyCap: 6,
          timezone: "America/Los_Angeles",
          minSpacingMinutes: 8,
        },
        executionStatus: "idle",
      },
      {
        hypothesisId: hypothesis.id,
        name: `${base} / Proof-first`,
        status: "draft" as const,
        notes: "Open with measurable proof and concise CTA for pilot or call.",
        runPolicy: {
          cadence: "3_step_7_day",
          dailyCap: 30,
          hourlyCap: 6,
          timezone: "America/Los_Angeles",
          minSpacingMinutes: 8,
        },
        executionStatus: "idle",
      },
      {
        hypothesisId: hypothesis.id,
        name: `${base} / Pain-first`,
        status: "draft" as const,
        notes: `Start with urgent pain signal and include sourcing angle (${hypothesis.actorQuery || "targeted list"}).`,
        runPolicy: {
          cadence: "3_step_7_day",
          dailyCap: 30,
          hourlyCap: 6,
          timezone: "America/Los_Angeles",
          minSpacingMinutes: 8,
        },
        executionStatus: "idle",
      },
    ];
  });
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
    ? (bodyHypotheses as { id: string; title: string; rationale: string; actorQuery?: string }[])
    : campaign.hypotheses;

  if (!hypotheses.length) {
    return NextResponse.json({ experiments: [], mode: "empty" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ experiments: fallbackExperiments(hypotheses), mode: "fallback" });
  }

  const prompt = [
    "Generate experiment variants for outreach hypotheses.",
    "Output JSON only as: { experiments: [{ hypothesisId, name, status, notes, dailyCap, hourlyCap, timezone, minSpacingMinutes }] }",
    "Create 2-3 variants per hypothesis.",
    "status must be draft.",
    JSON.stringify(hypotheses, null, 2),
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
      max_output_tokens: 1800,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    return NextResponse.json({ experiments: fallbackExperiments(hypotheses), mode: "fallback" });
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
  return NextResponse.json({
    experiments: experiments.length ? experiments : fallbackExperiments(hypotheses),
    mode: experiments.length ? "openai" : "fallback",
  });
}
