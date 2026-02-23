import { NextResponse } from "next/server";
import {
  ensureRuntimeForExperiment,
  getExperimentRecordById,
  getScaleCampaignRecordById,
  updateExperimentRecord,
  updateScaleCampaignRecord,
} from "@/lib/experiment-data";
import { getCampaignById, updateCampaign } from "@/lib/factory-data";
import { setBrandOutreachAssignment } from "@/lib/outreach-data";
import { launchExperimentRun } from "@/lib/outreach-runtime";

export async function POST(
  _: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;
  const campaign = await getScaleCampaignRecordById(brandId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const sourceExperiment = await getExperimentRecordById(brandId, campaign.sourceExperimentId);
  if (!sourceExperiment) {
    return NextResponse.json({ error: "source experiment not found" }, { status: 400 });
  }

  const experiment = await ensureRuntimeForExperiment(sourceExperiment);
  if (!experiment.runtime.campaignId || !experiment.runtime.experimentId) {
    return NextResponse.json(
      { error: "experiment runtime is not configured" },
      { status: 400 }
    );
  }

  if (campaign.scalePolicy.accountId) {
    await setBrandOutreachAssignment(
      brandId,
      {
        accountId: campaign.scalePolicy.accountId,
        mailboxAccountId:
          campaign.scalePolicy.mailboxAccountId || campaign.scalePolicy.accountId,
      }
    );
  }

  const runtimeCampaign = await getCampaignById(brandId, experiment.runtime.campaignId);
  if (!runtimeCampaign) {
    return NextResponse.json({ error: "runtime campaign not found" }, { status: 400 });
  }

  const runtimeVariant = runtimeCampaign.experiments.find(
    (item) => item.id === experiment.runtime.experimentId
  );
  const runtimeHypothesis = runtimeCampaign.hypotheses.find(
    (item) => item.id === experiment.runtime.hypothesisId
  );

  if (!runtimeVariant || !runtimeHypothesis) {
    return NextResponse.json(
      { error: "runtime variant mapping is invalid" },
      { status: 400 }
    );
  }

  await updateCampaign(brandId, runtimeCampaign.id, {
    experiments: runtimeCampaign.experiments.map((variant) =>
      variant.id === runtimeVariant.id
        ? {
            ...variant,
            runPolicy: {
              ...variant.runPolicy,
              dailyCap: campaign.scalePolicy.dailyCap,
              hourlyCap: campaign.scalePolicy.hourlyCap,
              timezone: campaign.scalePolicy.timezone,
              minSpacingMinutes: campaign.scalePolicy.minSpacingMinutes,
            },
          }
        : variant
    ),
  });

  const result = await launchExperimentRun({
    brandId,
    campaignId: runtimeCampaign.id,
    experimentId: runtimeVariant.id,
    trigger: "manual",
    ownerType: "campaign",
    ownerId: campaign.id,
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

  await Promise.all([
    updateScaleCampaignRecord(brandId, campaign.id, { status: "active" }),
    updateExperimentRecord(brandId, experiment.id, { status: "promoted" }),
  ]);

  return NextResponse.json({ runId: result.runId, status: "queued" }, { status: 201 });
}
