import { NextResponse } from "next/server";
import { runExperimentSendablePrepTick } from "@/lib/experiment-sendable-prep";
import { runScaleCampaignSendablePrepTick } from "@/lib/scale-campaign-sendable-prep";
import { isInternalCronAuthorized, runCronTask } from "@/lib/internal-cron";

export const maxDuration = 60;

const EXPERIMENT_PREP_LIMIT = 2;
const CAMPAIGN_PREP_LIMIT = 12;
const CAMPAIGN_PREP_MAX_RUNTIME_MS = 55_000;
const CAMPAIGN_PREP_MAX_PER_CAMPAIGN_MS = 45_000;

async function handlePrepTick(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const requestOrigin = new URL(request.url).origin;
  const [experimentPrep, campaignPrep] = await Promise.all([
    runCronTask(
      "experimentPrep",
      () =>
        runExperimentSendablePrepTick(EXPERIMENT_PREP_LIMIT, {
          requestOrigin,
        }),
      { timeoutMs: 45_000 }
    ),
    runCronTask(
      "campaignPrep",
      () =>
        runScaleCampaignSendablePrepTick(CAMPAIGN_PREP_LIMIT, {
          requestOrigin,
          maxRuntimeMs: CAMPAIGN_PREP_MAX_RUNTIME_MS,
          maxCampaignPrepMs: CAMPAIGN_PREP_MAX_PER_CAMPAIGN_MS,
        }),
      { timeoutMs: 58_000 }
    ),
  ]);

  return NextResponse.json({
    ok: experimentPrep.ok && campaignPrep.ok,
    criticalPath: "prep",
    experimentPrep,
    campaignPrep,
  });
}

export async function GET(request: Request) {
  return handlePrepTick(request);
}

export async function POST(request: Request) {
  return handlePrepTick(request);
}
