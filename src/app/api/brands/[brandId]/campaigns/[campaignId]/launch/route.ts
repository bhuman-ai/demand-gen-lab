import { NextResponse } from "next/server";
import { launchScaleCampaignRun } from "@/lib/outreach-runtime";

export async function POST(
  _: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;
  const result = await launchScaleCampaignRun({
    brandId,
    scaleCampaignId: campaignId,
    trigger: "manual",
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.reason,
        runId: result.runId,
        hint: result.hint,
        debug: result.debug,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ runId: result.runId, status: "queued" }, { status: 201 });
}
