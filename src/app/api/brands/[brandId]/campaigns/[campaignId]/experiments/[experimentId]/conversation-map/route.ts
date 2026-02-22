import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";
import {
  ConversationFlowDataError,
  defaultConversationGraph,
  getConversationMapByExperiment,
  normalizeConversationGraph,
  upsertConversationMapDraft,
} from "@/lib/conversation-flow-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string; experimentId: string }> }
) {
  const { brandId, campaignId, experimentId } = await context.params;

  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const experiment = campaign.experiments.find((item) => item.id === experimentId) ?? null;
  if (!experiment) {
    return NextResponse.json({ error: "variant not found" }, { status: 404 });
  }

  try {
    const map = await getConversationMapByExperiment(brandId, campaignId, experimentId);
    if (map) {
      return NextResponse.json({ map });
    }

    return NextResponse.json({
      map: {
        id: "",
        brandId,
        campaignId,
        experimentId,
        name: `${experiment.name || "Variant"} Conversation Flow`,
        status: "draft",
        draftGraph: defaultConversationGraph(),
        publishedGraph: defaultConversationGraph(),
        publishedRevision: 0,
        publishedAt: "",
        createdAt: "",
        updatedAt: "",
      },
      empty: true,
    });
  } catch (error) {
    if (error instanceof ConversationFlowDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to load conversation map" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string; experimentId: string }> }
) {
  const { brandId, campaignId, experimentId } = await context.params;

  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const experiment = campaign.experiments.find((item) => item.id === experimentId) ?? null;
  if (!experiment) {
    return NextResponse.json({ error: "variant not found" }, { status: 404 });
  }

  const body = asRecord(await request.json());
  const draftGraph = normalizeConversationGraph(body.draftGraph);
  const name = String(body.name ?? `${experiment.name || "Variant"} Conversation Flow`).trim();

  try {
    const map = await upsertConversationMapDraft({
      brandId,
      campaignId,
      experimentId,
      name,
      draftGraph,
    });
    return NextResponse.json({ map });
  } catch (error) {
    if (error instanceof ConversationFlowDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to save conversation map" }, { status: 500 });
  }
}
