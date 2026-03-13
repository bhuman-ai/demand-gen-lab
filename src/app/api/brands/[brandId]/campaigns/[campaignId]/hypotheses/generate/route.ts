import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";
import { sanitizeAiText } from "@/lib/ai-sanitize";
import { resolveLlmModel } from "@/lib/llm-router";

type GeneratedHypothesis = {
  title: string;
  channel: string;
  rationale: string;
  actorQuery: string;
  sourceConfig: {
    actorId: string;
    actorInput: Record<string, unknown>;
    maxLeads: number;
  };
  seedInputs: string[];
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeHypotheses(value: unknown): GeneratedHypothesis[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: GeneratedHypothesis[] = [];
  for (const entry of value) {
    const item = asRecord(entry);
    const title = sanitizeAiText(String(item.title ?? item.name ?? "")).trim();
    const channel = sanitizeAiText(String(item.channel ?? item.platform ?? "Email")).trim() || "Email";
    const rationale = sanitizeAiText(String(item.rationale ?? item.reason ?? "")).trim();
    const leadTarget = sanitizeAiText(String(item.leadTarget ?? item.target ?? item.icp ?? "")).trim();
    const actorQuery = sanitizeAiText(String(item.actorQuery ?? item.actor_query ?? leadTarget)).trim();
    const sourceConfig = asRecord(item.sourceConfig ?? item.source_config);
    const actorId = sanitizeAiText(String(sourceConfig.actorId ?? sourceConfig.actor_id ?? "")).trim();
    const actorInput =
      sourceConfig.actorInput && typeof sourceConfig.actorInput === "object"
        ? (sourceConfig.actorInput as Record<string, unknown>)
        : {};
    const maxLeads = Number(sourceConfig.maxLeads ?? sourceConfig.max_leads ?? 100);
    const seedInputs = Array.isArray(item.seedInputs)
      ? item.seedInputs.map((row: unknown) => String(row ?? "").trim()).filter(Boolean)
      : [];

    if (!title || !channel || !rationale) continue;
    const key = `${title.toLowerCase()}::${channel.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      title,
      channel,
      rationale,
      // Back-compat field: store lead targeting hint here (not shown in the UI).
      actorQuery: actorQuery || leadTarget || "",
      sourceConfig: {
        // Lead sourcing is platform-managed; keep provider identifiers out of payloads.
        actorId: actorId || "",
        actorInput,
        maxLeads: Number.isFinite(maxLeads) ? Math.max(1, Math.min(500, maxLeads)) : 100,
      },
      seedInputs,
    });
  }
  return rows.slice(0, 8);
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
  const brandName = String(body.brandName ?? "Brand");
  const goal = String(body.goal ?? campaign.objective.goal ?? "");
  const constraints = String(body.constraints ?? campaign.objective.constraints ?? "");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "OPENAI_API_KEY is not configured",
        hint: "Real-only mode is enabled: fallback hypothesis generation is disabled.",
      },
      { status: 503 }
    );
  }

  const prompt = [
    "Generate 5-8 email outreach hypotheses for a campaign objective.",
    "Channel is email-only. Set channel to \"Email\" for every hypothesis.",
    "Output JSON only: { hypotheses: [{ title, channel, rationale, leadTarget, maxLeads, seedInputs[] }] }",
    "Avoid generic repeated ideas.",
    "Do not mention internal tools, vendors, scraping, or implementation details.",
    "Do not use the words 'apify' or 'actor'.",
    `Brand: ${sanitizeAiText(brandName)}`,
    `Goal: ${sanitizeAiText(goal)}`,
    `Constraints: ${sanitizeAiText(constraints)}`,
  ].join("\n");

  const model = resolveLlmModel("hypotheses_generate", { prompt });
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
      max_output_tokens: 1600,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    return NextResponse.json(
      {
        error: "generation failed",
        hint: "Real-only mode is enabled: fallback hypothesis generation is disabled.",
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
  const hypotheses = normalizeHypotheses(parsedRecord.hypotheses);
  if (!hypotheses.length) {
    return NextResponse.json(
      {
        error: "generation returned no usable hypotheses",
        hint: "Real-only mode is enabled: fallback hypothesis generation is disabled.",
      },
      { status: 422 }
    );
  }
  return NextResponse.json({ hypotheses, mode: "openai" });
}
