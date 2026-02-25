import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";
import { listConversationPreviewLeads } from "@/lib/conversation-preview-leads";

export async function GET(
  _request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string; experimentId: string }> }
) {
  const { brandId, campaignId, experimentId } = await context.params;

  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const variant = campaign.experiments.find((item) => item.id === experimentId) ?? null;
  if (!variant) {
    return NextResponse.json({ error: "variant not found" }, { status: 404 });
  }

  const result = await listConversationPreviewLeads({
    brandId,
    campaignId,
    experimentId,
  });

  return NextResponse.json({
    leads: result.leads,
    runsChecked: result.runsChecked,
    sourceExperimentId: result.sourceExperimentId,
    runtimeRefFound: result.runtimeRefFound,
  });
}
