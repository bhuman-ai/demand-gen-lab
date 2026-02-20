import { NextResponse } from "next/server";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import type { ObjectiveData } from "@/lib/factory-types";
import { sanitizeAiText } from "@/lib/ai-sanitize";

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

function defaultRunPolicy() {
  return {
    cadence: "3_step_7_day" as const,
    dailyCap: 30,
    hourlyCap: 6,
    timezone: "America/Los_Angeles",
    minSpacingMinutes: 8,
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

function fallbackSuggestions(brandName: string): BuildSuggestion[] {
  const safeBrand = brandName.trim() || "your brand";
  const policy = defaultRunPolicy();
  return [
    {
      title: "Book demos from one tight ICP",
      rationale: "Start narrow to get clear signal before scaling.",
      objective: {
        goal: `Book 10 qualified demos in 14 days for ${safeBrand}.`,
        constraints: "Email only. One ICP. Keep copy under 90 words. Use conservative sending caps.",
        scoring: { conversionWeight: 0.7, qualityWeight: 0.2, replyWeight: 0.1 },
      },
      angle: {
        title: "Pain-first angle",
        rationale: "Lead with one urgent pain and one concrete outcome.",
        channel: "Email",
        actorQuery: "Head of Growth at B2B SaaS (11-200 employees)",
        maxLeads: 100,
        seedInputs: ["role", "pain", "desired outcome"],
      },
      variants: [
        {
          name: "Hook-first variant",
          notes: "Open with pain + cost of inaction in sentence one.",
          status: "draft",
          runPolicy: policy,
        },
        {
          name: "Proof-first variant",
          notes: "Open with measurable proof, then ask one clear CTA.",
          status: "draft",
          runPolicy: policy,
        },
      ],
    },
    {
      title: "Validate offer quickly",
      rationale: "Optimize for fast reply signal to refine messaging.",
      objective: {
        goal: `Get 20 quality replies in 10 days for ${safeBrand}.`,
        constraints: "Single offer per email, short copy, no aggressive volume spikes.",
        scoring: { conversionWeight: 0.5, qualityWeight: 0.25, replyWeight: 0.25 },
      },
      angle: {
        title: "Offer-led angle",
        rationale: "Position a concrete offer with low-friction CTA.",
        channel: "Email",
        actorQuery: "Founder at B2B SaaS (1-50 employees)",
        maxLeads: 90,
        seedInputs: ["offer", "proof", "CTA"],
      },
      variants: [
        {
          name: "Teardown offer variant",
          notes: "Offer a 10-minute teardown with one-question CTA.",
          status: "draft",
          runPolicy: policy,
        },
        {
          name: "Quick-win variant",
          notes: "Lead with one fast, visible win and ask for fit check.",
          status: "draft",
          runPolicy: policy,
        },
      ],
    },
  ];
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
  const fallback = fallbackSuggestions(brandName);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ suggestions: fallback, mode: "fallback" });
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

  const raw = await response.text();
  if (!response.ok) {
    return NextResponse.json({ suggestions: fallback, mode: "fallback" });
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

  return NextResponse.json({
    suggestions: normalized.length ? normalized : fallback,
    mode: normalized.length ? "openai" : "fallback",
  });
}
