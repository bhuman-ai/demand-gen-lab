import { NextResponse } from "next/server";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import { sanitizeAiText } from "@/lib/ai-sanitize";

type HypothesisSuggestion = {
  title: string;
  channel: "Email";
  rationale: string;
  leadTarget: string;
  maxLeads: number;
  seedInputs: string[];
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeSuggestions(value: unknown): HypothesisSuggestion[] {
  if (!Array.isArray(value)) return [];
  const rows: HypothesisSuggestion[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const row = asRecord(entry);
    const title = sanitizeAiText(String(row.title ?? row.name ?? "").trim());
    const rationale = sanitizeAiText(String(row.rationale ?? row.reason ?? "").trim());
    const leadTarget = sanitizeAiText(String(row.leadTarget ?? row.target ?? row.icp ?? "").trim());
    const maxLeads = Number(row.maxLeads ?? row.max_leads ?? 100);
    const seedInputs = Array.isArray(row.seedInputs)
      ? row.seedInputs.map((item: unknown) => sanitizeAiText(String(item ?? "").trim())).filter(Boolean)
      : [];

    if (!title || !rationale) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      title,
      channel: "Email",
      rationale,
      leadTarget,
      maxLeads: Number.isFinite(maxLeads) ? Math.max(1, Math.min(500, maxLeads)) : 100,
      seedInputs: seedInputs.slice(0, 8),
    });
  }
  return rows.slice(0, 8);
}

function fallbackSuggestions(brandName: string, goal: string): HypothesisSuggestion[] {
  const safeBrand = brandName.trim() || "your brand";
  const safeGoal = goal.trim() || `grow ${safeBrand}`;
  return [
    {
      title: "ICP pain: stop doing X manually",
      channel: "Email",
      rationale: `If we target one role at a narrow company type and lead with a specific pain tied to "${safeGoal}", we should see higher-quality replies.`,
      leadTarget: "Head of Growth at B2B SaaS (11-200 employees)",
      maxLeads: 100,
      seedInputs: ["role", "current workflow", "pain signal"],
    },
    {
      title: "Offer test: the 10-minute teardown",
      channel: "Email",
      rationale: "If we offer a concrete artifact (teardown/audit) with a low-friction CTA, we should increase positive replies without lowering lead quality.",
      leadTarget: "Founder at B2B SaaS (1-50 employees)",
      maxLeads: 80,
      seedInputs: ["company", "product category", "one specific problem"],
    },
    {
      title: "Trigger-based: new hire or funding",
      channel: "Email",
      rationale: "If we filter to prospects with an obvious trigger, outreach will feel timely and reduce negative replies.",
      leadTarget: "RevOps / Sales leaders at companies with recent funding or hiring",
      maxLeads: 120,
      seedInputs: ["trigger", "role", "team goal"],
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
  const goal = sanitizeAiText(String(campaign.objective?.goal ?? ""));
  const constraints = sanitizeAiText(String(campaign.objective?.constraints ?? ""));

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      suggestions: fallbackSuggestions(brandName, goal),
      mode: "fallback",
    });
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
    existingHypotheses: campaign.hypotheses.map((h) => ({ title: h.title, status: h.status })).slice(0, 12),
  };

  const prompt = [
    "You are an expert outbound strategist.",
    "Generate 6-8 email outreach hypotheses for the campaign objective.",
    "Each hypothesis should be a distinct test: ICP slice, pain framing, offer, proof, trigger, or CTA.",
    "Channel scope is email-only. Set channel to exactly \"Email\" for every item.",
    "Include a short leadTarget string (role + company type) and maxLeads (50-200 typical).",
    "Do not mention internal tools, vendors, scraping, or implementation details.",
    "Do not use the words 'apify' or 'actor'.",
    "",
    "Output JSON only in this exact shape:",
    '{ "suggestions": [{ "title": string, "channel": "Email", "rationale": string, "leadTarget": string, "maxLeads": number, "seedInputs": string[] }] }',
    "",
    `BrandContext: ${JSON.stringify(brandContext)}`,
    `CampaignContext: ${JSON.stringify(campaignContext)}`,
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
      max_output_tokens: 1700,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    return NextResponse.json({
      suggestions: fallbackSuggestions(brandName, goal),
      mode: "fallback",
    });
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
    suggestions: suggestions.length ? suggestions : fallbackSuggestions(brandName, goal),
    mode: suggestions.length ? "openai" : "fallback",
  });
}

