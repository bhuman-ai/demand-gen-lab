import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import {
  listScaleCampaignRecords,
  promoteExperimentRecordToCampaign,
} from "@/lib/experiment-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET(_: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const campaigns = await listScaleCampaignRecords(brandId);
  return NextResponse.json({ campaigns });
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const sourceExperimentId = String(body.sourceExperimentId ?? "").trim();
  if (!sourceExperimentId) {
    return NextResponse.json(
      { error: "sourceExperimentId is required. Campaigns are promoted from experiments." },
      { status: 400 }
    );
  }

  try {
    const campaign = await promoteExperimentRecordToCampaign({
      brandId,
      experimentId: sourceExperimentId,
      campaignName: typeof body.name === "string" ? body.name : undefined,
    });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create campaign" },
      { status: 400 }
    );
  }
}
