import { NextResponse } from "next/server";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import type { ObjectiveData } from "@/lib/factory-types";
import { sanitizeAiText } from "@/lib/ai-sanitize";
import { resolveLlmModel } from "@/lib/llm-router";

type BuildSuggestion = {
  title: string;
  rationale: string;
  objective: {
    goal: string;
    constraints: string;
    scoring: ObjectiveData["scoring"];
  };
  angle: {
    title: string;
    rationale: string;
    channel: "Email";
    actorQuery: string;
    maxLeads: number;
    seedInputs: string[];
  };
  variants: Array<{
    name: string;
    notes: string;
    status: "draft" | "testing" | "scaling" | "paused";
    runPolicy: {
      cadence: "3_step_7_day";
      dailyCap: number;
      hourlyCap: number;
      timezone: string;
      minSpacingMinutes: number;
    };
  }>;
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
  return Math.max(0, Math.min(1, num));
}

function normalizeScoring(value: unknown): ObjectiveData["scoring"] {
  const row = asRecord(value);
  const conversionWeight = clamp01(row.conversionWeight, 0.6);
  const qualityWeight = clamp01(row.qualityWeight, 0.2);
  const replyWeight = clamp01(row.replyWeight, 0.2);
  const sum = conversionWeight + qualityWeight + replyWeight || 1;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    conversionWeight: round(conversionWeight / sum),
    qualityWeight: round(qualityWeight / sum),
    replyWeight: round(replyWeight / sum),
  };
}

function normalizeSuggestion(value: unknown): BuildSuggestion | null {
  const row = asRecord(value);
  const title = sanitizeAiText(String(row.title ?? "").trim());
  const rationale = sanitizeAiText(String(row.rationale ?? row.why ?? "").trim());

  const objectiveRow = asRecord(row.objective);
  const goal = sanitizeAiText(String(objectiveRow.goal ?? "").trim());
  const constraints = sanitizeAiText(String(objectiveRow.constraints ?? "").trim());

  const angleRow = asRecord(row.angle);
  const angleTitle = sanitizeAiText(String(angleRow.title ?? "").trim());
  const angleRationale = sanitizeAiText(String(angleRow.rationale ?? "").trim());
  const actorQuery = sanitizeAiText(String(angleRow.actorQuery ?? angleRow.target ?? "").trim());
  const maxLeads = Math.max(1, Math.min(500, Number(angleRow.maxLeads ?? 100) || 100));
  const seedInputs = Array.isArray(angleRow.seedInputs)
    ? angleRow.seedInputs.map((item: unknown) => sanitizeAiText(String(item ?? "").trim())).filter(Boolean).slice(0, 8)
    : [];

  const variants = Array.isArray(row.variants)
    ? row.variants
        .map((entry) => {
          const variant = asRecord(entry);
          const name = sanitizeAiText(String(variant.name ?? "").trim());
          if (!name) return null;
          const notes = sanitizeAiText(String(variant.notes ?? "").trim());
          const runPolicy = asRecord(variant.runPolicy);
          const statusRaw = String(variant.status ?? "draft");
          const status = ["draft", "testing", "scaling", "paused"].includes(statusRaw)
            ? (statusRaw as BuildSuggestion["variants"][number]["status"])
            : "draft";
          return {
            name,
            notes,
            status,
            runPolicy: {
              cadence: "3_step_7_day" as const,
              dailyCap: Math.max(1, Math.min(500, Number(runPolicy.dailyCap ?? 30) || 30)),
              hourlyCap: Math.max(1, Math.min(100, Number(runPolicy.hourlyCap ?? 6) || 6)),
              timezone: sanitizeAiText(String(runPolicy.timezone ?? "America/Los_Angeles").trim()) || "America/Los_Angeles",
              minSpacingMinutes: Math.max(1, Math.min(120, Number(runPolicy.minSpacingMinutes ?? 8) || 8)),
            },
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 4)
    : [];

  if (!title || !goal || !angleTitle || !actorQuery || variants.length === 0) return null;

  return {
    title,
    rationale,
    objective: {
      goal,
      constraints,
      scoring: normalizeScoring(objectiveRow.scoring),
    },
    angle: {
      title: angleTitle,
      rationale: angleRationale,
      channel: "Email",
      actorQuery,
      maxLeads,
      seedInputs,
    },
    variants,
  };
}

function normalizeSuggestions(value: unknown): BuildSuggestion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: BuildSuggestion[] = [];
  for (const entry of value) {
    const normalized = normalizeSuggestion(entry);
    if (!normalized) continue;
    const key = normalized.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(normalized);
  }
  return rows.slice(0, 6);
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;
  const [brand, campaign] = await Promise.all([getBrandById(brandId), getCampaignById(brandId, campaignId)]);

  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const brandName = sanitizeAiText(String(brand?.name ?? "Brand"));

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "OPENAI_API_KEY is not configured",
        hint: "Real-only mode is enabled: fallback build suggestions are disabled.",
      },
      { status: 503 }
    );
  }

  const prompt = [
    "You are an expert outbound campaign strategist.",
    "Generate 3-5 bundled Build suggestions.",
    "Each suggestion must include: objective + one angle + 2-3 variants.",
    "Use plain language and practical defaults.",
    "Do not mention internal tools, vendors, or implementation details.",
    "Do not use the words 'apify' or 'actor'.",
    "Output JSON only.",
    "Shape:",
    '{ "suggestions": [{ "title": string, "rationale": string, "objective": { "goal": string, "constraints": string, "scoring": { "conversionWeight": number, "qualityWeight": number, "replyWeight": number } }, "angle": { "title": string, "rationale": string, "actorQuery": string, "maxLeads": number, "seedInputs": string[] }, "variants": [{ "name": string, "notes": string, "status": "draft", "runPolicy": { "cadence": "3_step_7_day", "dailyCap": number, "hourlyCap": number, "timezone": string, "minSpacingMinutes": number } }] }] }',
    `BrandContext: ${JSON.stringify({
      name: brand?.name ?? "",
      website: brand?.website ?? "",
      tone: brand?.tone ?? "",
      notes: brand?.notes ?? "",
    })}`,
    `CampaignContext: ${JSON.stringify({
      name: campaign.name,
      objective: campaign.objective,
      hypothesesCount: campaign.hypotheses.length,
      experimentsCount: campaign.experiments.length,
    })}`,
  ].join("\n");

  const model = resolveLlmModel("build_suggest", { prompt });
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
      max_output_tokens: 2200,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    return NextResponse.json(
      {
        error: "build suggestion generation failed",
        hint: "Real-only mode is enabled: fallback build suggestions are disabled.",
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

  const normalized = normalizeSuggestions(asRecord(parsed).suggestions);

  if (!normalized.length) {
    return NextResponse.json(
      {
        error: "build suggestion generation returned no usable suggestions",
        hint: "Real-only mode is enabled: fallback build suggestions are disabled.",
      },
      { status: 422 }
    );
  }
  return NextResponse.json({ suggestions: normalized, mode: "openai" });
}
