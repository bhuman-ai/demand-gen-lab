import { NextResponse } from "next/server";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import {
  defaultConversationGraph,
  normalizeConversationGraph,
} from "@/lib/conversation-flow-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string; experimentId: string }> }
) {
  const { brandId, campaignId, experimentId } = await context.params;
  const [brand, campaign] = await Promise.all([
    getBrandById(brandId),
    getCampaignById(brandId, campaignId),
  ]);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const experiment = campaign.experiments.find((item) => item.id === experimentId) ?? null;
  if (!experiment) {
    return NextResponse.json({ error: "variant not found" }, { status: 404 });
  }

  const hypothesis = campaign.hypotheses.find((item) => item.id === experiment.hypothesisId) ?? null;
  const fallback = defaultConversationGraph();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ graph: fallback, mode: "fallback" });
  }

  const prompt = [
    "You design outbound reply conversation maps for email outreach.",
    "Generate one practical branching map with up to 5 turns.",
    "Goal: convert replies while handling questions, objections, and unsubscribe safely.",
    "Use plain language. Keep copy concise and human.",
    "Output JSON only.",
    "Shape:",
    '{ "graph": { "version": 1, "maxDepth": number, "startNodeId": string, "nodes": [{ "id": string, "kind": "message"|"terminal", "title": string, "subject": string, "body": string, "autoSend": boolean, "delayMinutes": number }], "edges": [{ "id": string, "fromNodeId": string, "toNodeId": string, "trigger": "intent"|"timer"|"fallback", "intent": "question"|"interest"|"objection"|"unsubscribe"|"other"|"" , "waitMinutes": number, "confidenceThreshold": number, "priority": number }] } }',
    `BrandContext: ${JSON.stringify({
      name: brand?.name ?? "",
      website: brand?.website ?? "",
      tone: brand?.tone ?? "",
      notes: brand?.notes ?? "",
    })}`,
    `CampaignContext: ${JSON.stringify({
      campaignName: campaign.name,
      objective: campaign.objective,
      angleTitle: hypothesis?.title ?? "",
      angleRationale: hypothesis?.rationale ?? "",
      targetAudience: hypothesis?.actorQuery ?? "",
      variantName: experiment.name,
      variantNotes: experiment.notes,
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
      max_output_tokens: 1800,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    return NextResponse.json({ graph: fallback, mode: "fallback" });
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
    String(
      content
        .map((item) => asRecord(item))
        .find((item) => typeof item.text === "string")?.text ?? ""
    ) ||
    "{}";

  let parsed: unknown = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }

  const rawGraph = asRecord(asRecord(parsed).graph);
  const hasModelGraph = Object.keys(rawGraph).length > 0;
  const graph = hasModelGraph ? normalizeConversationGraph(rawGraph) : fallback;
  return NextResponse.json({
    graph,
    mode: hasModelGraph ? "openai" : "fallback",
  });
}
