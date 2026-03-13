import { NextResponse } from "next/server";
import { getScaleCampaignRecordById } from "@/lib/experiment-data";
import {
  buildCampaignProspectTableConfig,
  ensureEnrichAnythingProspectTable,
} from "@/lib/enrichanything-live-table";

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  try {
    const { brandId, campaignId } = await context.params;
    const campaign = await getScaleCampaignRecordById(brandId, campaignId);
    if (!campaign) {
      return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    }

    const config = await ensureEnrichAnythingProspectTable(
      buildCampaignProspectTableConfig(campaign)
    );
    return NextResponse.json(config);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to prepare prospect table",
      },
      { status: 500 }
    );
  }
}
