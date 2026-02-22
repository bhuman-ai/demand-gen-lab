import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";
import {
  ConversationFlowDataError,
  publishConversationMap,
} from "@/lib/conversation-flow-data";

export async function POST(
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
    const map = await publishConversationMap({ brandId, campaignId, experimentId });
    if (!map) {
      return NextResponse.json({ error: "conversation map not found" }, { status: 404 });
    }
    return NextResponse.json({ map });
  } catch (error) {
    if (error instanceof ConversationFlowDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to publish conversation map" }, { status: 500 });
  }
}
