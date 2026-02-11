import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";

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
    const title = String(item.title ?? item.name ?? "").trim();
    const channel = String(item.channel ?? item.platform ?? "").trim();
    const rationale = String(item.rationale ?? item.reason ?? "").trim();
    const actorQuery = String(item.actorQuery ?? item.actor_query ?? "").trim();
    const sourceConfig = asRecord(item.sourceConfig ?? item.source_config);
    const actorId = String(sourceConfig.actorId ?? sourceConfig.actor_id ?? "").trim();
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
      actorQuery: actorQuery || `${channel} prospects`,
      sourceConfig: {
        actorId: actorId || actorQuery || "",
        actorInput,
        maxLeads: Number.isFinite(maxLeads) ? Math.max(1, Math.min(500, maxLeads)) : 100,
      },
      seedInputs,
    });
  }
  return rows.slice(0, 8);
}

function fallbackHypotheses(goal: string, brandName: string): GeneratedHypothesis[] {
  const keyword = goal.trim() || `growth for ${brandName}`;
  return [
    {
      title: `Founder signal mining for ${keyword}`,
      channel: "LinkedIn",
      rationale: "Identify operators posting buying signals, then send tightly scoped outreach tied to objective constraints.",
      actorQuery: "linkedin leads scraper",
      sourceConfig: {
        actorId: "apify/linkedin-scraper",
        actorInput: { search: keyword },
        maxLeads: 120,
      },
      seedInputs: [brandName, "operator", "buyer signal"],
    },
    {
      title: `Community-intent pull for ${keyword}`,
      channel: "Reddit",
      rationale: "Find active threads with stated pain and engage with proof-led messaging variants.",
      actorQuery: "reddit post commenters",
      sourceConfig: {
        actorId: "apify/reddit-comment-scraper",
        actorInput: { query: keyword },
        maxLeads: 80,
      },
      seedInputs: [brandName, "pain", "discussion"],
    },
    {
      title: `Creator workflow wedge for ${keyword}`,
      channel: "YouTube",
      rationale: "Source creators discussing scaling friction and position offer as workflow acceleration.",
      actorQuery: "youtube channel scraper",
      sourceConfig: {
        actorId: "apify/youtube-scraper",
        actorInput: { query: keyword },
        maxLeads: 60,
      },
      seedInputs: [brandName, "creator ops", "workflow"],
    },
  ];
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
    return NextResponse.json({ hypotheses: fallbackHypotheses(goal, brandName), mode: "fallback" });
  }

  const prompt = [
    "Generate 5-8 outreach hypotheses for a campaign objective.",
    "Output JSON only: { hypotheses: [{ title, channel, rationale, actorQuery, sourceConfig{actorId,actorInput,maxLeads}, seedInputs[] }] }",
    "At least 3 hypotheses should target scrapeable channels (LinkedIn, Reddit, YouTube, Instagram, TikTok, X).",
    "Avoid generic repeated ideas.",
    `Brand: ${brandName}`,
    `Goal: ${goal}`,
    `Constraints: ${constraints}`,
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

  const raw = await response.text();
  if (!response.ok) {
    return NextResponse.json(
      {
        hypotheses: fallbackHypotheses(goal, brandName),
        mode: "fallback",
        error: "generation failed",
      },
      { status: 200 }
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
  return NextResponse.json({
    hypotheses: hypotheses.length ? hypotheses : fallbackHypotheses(goal, brandName),
    mode: hypotheses.length ? "openai" : "fallback",
  });
}
