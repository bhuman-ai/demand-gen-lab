import { NextResponse } from "next/server";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import {
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is missing. Conversation map generation requires model output." },
      { status: 503 }
    );
  }

  const prompt = [
    "You write high-performing B2B outbound email conversation maps.",
    "Generate one practical branching map with up to 5 turns.",
    "Goal: book qualified calls while handling questions, objections, and unsubscribe safely.",
    "Hard requirements:",
    "- Plain, concrete language. No buzzwords, no vague claims, no filler.",
    "- Never use phrases like: 'quick question', 'just circling back', 'great to hear', 'worth a quick check'.",
    "- Every message must include exactly one clear CTA.",
    "- Subject lines <= 7 words. Body <= 90 words.",
    "- Use only these variables when needed: {{firstName}}, {{company}}, {{brandName}}, {{campaignGoal}}, {{shortAnswer}}.",
    "- If you cannot infer specifics, write specific but safe copy without placeholders.",
    "Return JSON only with no markdown.",
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
    return NextResponse.json(
      {
        error: "OpenAI conversation-map generation failed",
        details: raw.slice(0, 500),
        status: response.status,
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
    return NextResponse.json(
      {
        error: "Conversation-map model output was not valid JSON",
        details: text.slice(0, 500),
      },
      { status: 502 }
    );
  }

  const rawGraph = asRecord(asRecord(parsed).graph);
  if (!Object.keys(rawGraph).length) {
    return NextResponse.json(
      {
        error: "Conversation-map model output did not include graph",
      },
      { status: 502 }
    );
  }

  let graph: ReturnType<typeof normalizeConversationGraph>;
  try {
    graph = normalizeConversationGraph(rawGraph, { strict: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Conversation-map model output was structurally invalid",
        details: error instanceof Error ? error.message : "Unknown normalization error",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ graph, mode: "openai" });
}
