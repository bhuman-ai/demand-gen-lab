import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";
import { launchExperimentRun } from "@/lib/outreach-runtime";

export async function POST(
  _: Request,
  context: {
    params: Promise<{ brandId: string; campaignId: string; experimentId: string }>;
  }
) {
  const { brandId, campaignId, experimentId } = await context.params;

  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const result = await launchExperimentRun({
    brandId,
    campaignId,
    experimentId,
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
