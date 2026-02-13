import { NextResponse } from "next/server";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import { listCampaignRuns } from "@/lib/outreach-data";
import { sanitizeAiText } from "@/lib/ai-sanitize";

type EvolutionSuggestion = {
  title: string;
  summary: string;
  status: "observing" | "winner" | "killed";
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeSuggestions(value: unknown): EvolutionSuggestion[] {
  if (!Array.isArray(value)) return [];
  const rows: EvolutionSuggestion[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const row = asRecord(entry);
    const title = sanitizeAiText(String(row.title ?? row.name ?? "").trim());
    const summary = sanitizeAiText(String(row.summary ?? row.notes ?? "").trim());
    const statusRaw = String(row.status ?? "observing").trim();
    const status: EvolutionSuggestion["status"] = ["observing", "winner", "killed"].includes(statusRaw)
      ? (statusRaw as EvolutionSuggestion["status"])
      : "observing";
    if (!title || !summary) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ title, summary, status });
  }
  return rows.slice(0, 6);
}

function fallbackSuggestions(brandName: string, campaignName: string): EvolutionSuggestion[] {
  const safeBrand = brandName.trim() || "Brand";
  const safeCampaign = campaignName.trim() || "Campaign";
  return [
    {
      title: "Week 1 learnings",
      summary: `Summarize what happened so far for ${safeBrand} / ${safeCampaign}: which ICPs replied, which angle landed, and what to change next.`,
      status: "observing",
    },
    {
      title: "Promote a winner (if signal is strong)",
      summary:
        "If one experiment shows consistently higher positive replies with low bounces/complaints, promote it to Winner and scale slowly (keep caps conservative).",
      status: "observing",
    },
    {
      title: "Kill low-signal variants",
      summary:
        "If an experiment has low replies and high negatives, mark it Killed and replace with a tighter ICP slice or a clearer offer artifact.",
      status: "observing",
    },
  ];
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;

  const [brand, campaign, runs] = await Promise.all([
    getBrandById(brandId),
    getCampaignById(brandId, campaignId),
    listCampaignRuns(brandId, campaignId),
  ]);

  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const brandName = sanitizeAiText(String(brand?.name ?? "Brand"));

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      suggestions: fallbackSuggestions(brandName, campaign.name),
      mode: "fallback",
    });
  }

  const idToHypothesis = new Map(campaign.hypotheses.map((h) => [h.id, sanitizeAiText(h.title)]));
  const idToExperiment = new Map(campaign.experiments.map((e) => [e.id, sanitizeAiText(e.name)]));

  const runSummaries = runs.slice(0, 20).map((run) => ({
    runId: run.id,
    status: run.status,
    experimentName: idToExperiment.get(run.experimentId) ?? run.experimentId,
    hypothesisTitle: idToHypothesis.get(run.hypothesisId) ?? run.hypothesisId,
    metrics: run.metrics,
    pauseReason: sanitizeAiText(run.pauseReason || ""),
    lastError: sanitizeAiText(run.lastError || ""),
  }));

  const prompt = [
    "You are a growth operator writing evolution snapshots for an outreach campaign.",
    "Use the objective, hypotheses, experiments, and run metrics to propose 3-5 evolution snapshots.",
    "Each snapshot should be actionable: what worked, what failed, and the next step.",
    "Use status values:",
    "- winner: clearly outperforming with strong positive replies and low negatives",
    "- killed: clearly underperforming or causing issues",
    "- observing: still learning or needs another iteration",
    "Do not mention internal tools, vendors, or implementation details.",
    "Do not use the words 'apify' or 'actor'.",
    "",
    "Output JSON only in this exact shape:",
    '{ "suggestions": [{ "title": string, "summary": string, "status": "observing" | "winner" | "killed" }] }',
    "",
    `Brand: ${brandName}`,
    `Campaign: ${sanitizeAiText(campaign.name)}`,
    `Objective: ${JSON.stringify(campaign.objective)}`,
    `Hypotheses: ${JSON.stringify(campaign.hypotheses.map((h) => ({ title: sanitizeAiText(h.title), status: h.status })))}`,
    `Experiments: ${JSON.stringify(campaign.experiments.map((e) => ({ name: sanitizeAiText(e.name), status: e.status, executionStatus: e.executionStatus })))}`,
    `RunMetrics: ${JSON.stringify(runSummaries)}`,
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
    return NextResponse.json({
      suggestions: fallbackSuggestions(brandName, campaign.name),
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
    suggestions: suggestions.length ? suggestions : fallbackSuggestions(brandName, campaign.name),
    mode: suggestions.length ? "openai" : "fallback",
  });
}

