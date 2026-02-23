import { NextResponse } from "next/server";
import { promoteExperimentRecordToCampaign } from "@/lib/experiment-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;
  const body = asRecord(await request.json().catch(() => ({})));
  try {
    const campaign = await promoteExperimentRecordToCampaign({
      brandId,
      experimentId,
      campaignName: typeof body.campaignName === "string" ? body.campaignName : undefined,
    });

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Promotion failed" },
      { status: 400 }
    );
  }
}
