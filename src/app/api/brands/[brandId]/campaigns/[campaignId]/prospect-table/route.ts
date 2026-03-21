import { NextResponse } from "next/server";
import { getScaleCampaignRecordById } from "@/lib/experiment-data";
import {
  buildCampaignProspectTableConfig,
  ensureEnrichAnythingProspectTable,
  updateEnrichAnythingProspectTableDiscovery,
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  try {
    const { brandId, campaignId } = await context.params;
    const campaign = await getScaleCampaignRecordById(brandId, campaignId);
    if (!campaign) {
      return NextResponse.json({ error: "campaign not found" }, { status: 404 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const discoveryPrompt = String(body.discoveryPrompt ?? "").trim();
    const discoveryMeta =
      body.discoveryMeta && typeof body.discoveryMeta === "object" && !Array.isArray(body.discoveryMeta)
        ? (body.discoveryMeta as Record<string, unknown>)
        : null;

    const config = buildCampaignProspectTableConfig(campaign);
    const table = await updateEnrichAnythingProspectTableDiscovery(config, {
      discoveryPrompt: discoveryPrompt || config.discoveryPrompt,
      discoveryMeta,
    });

    return NextResponse.json(table);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to update prospect table",
      },
      { status: 500 }
    );
  }
}
