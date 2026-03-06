import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";
import { listConversationPreviewLeads } from "@/lib/conversation-preview-leads";

export async function GET(
  request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string; experimentId: string }> }
) {
  const { brandId, campaignId, experimentId } = await context.params;
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? 20) || 20));
  const maxRuns = Math.max(1, Math.min(30, Number(url.searchParams.get("maxRuns") ?? 1) || 1));

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
    limit,
    maxRuns,
  });

  return NextResponse.json({
    leads: result.leads,
    runsChecked: result.runsChecked,
    sourceExperimentId: result.sourceExperimentId,
    runtimeRefFound: result.runtimeRefFound,
    qualifiedLeadCount: result.qualifiedLeadCount,
    qualifiedLeadWithEmailCount: result.qualifiedLeadWithEmailCount,
    qualifiedLeadWithoutEmailCount: result.qualifiedLeadWithoutEmailCount,
    previewEmailEnrichment: result.previewEmailEnrichment,
  });
}
