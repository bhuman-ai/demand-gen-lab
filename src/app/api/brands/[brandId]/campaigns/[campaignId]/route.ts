import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";
import {
  deleteScaleCampaignRecord,
  getScaleCampaignRecordById,
  updateScaleCampaignRecord,
} from "@/lib/experiment-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;
  const campaign = await getScaleCampaignRecordById(brandId, campaignId);
  if (campaign) {
    return NextResponse.json({ campaign });
  }

  const legacyCampaign = await getCampaignById(brandId, campaignId);
  if (legacyCampaign) {
    return NextResponse.json({ campaign: legacyCampaign, legacy: true });
  }

  return NextResponse.json({ error: "campaign not found" }, { status: 404 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;
  const existing = await getScaleCampaignRecordById(brandId, campaignId);
  if (!existing) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const body = asRecord(await request.json());
  if (body.snapshot || body.sourceExperimentId || body.source_experiment_id) {
    return NextResponse.json(
      { error: "campaign snapshot fields are immutable after promotion" },
      { status: 400 }
    );
  }

  const patch: Parameters<typeof updateScaleCampaignRecord>[2] = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (["draft", "active", "paused", "completed", "archived"].includes(String(body.status ?? ""))) {
    patch.status = body.status as (typeof existing)["status"];
  }

  if (body.scalePolicy && typeof body.scalePolicy === "object") {
    const row = asRecord(body.scalePolicy);
    patch.scalePolicy = {
      dailyCap: Math.max(1, Number(row.dailyCap ?? existing.scalePolicy.dailyCap)),
      hourlyCap: Math.max(1, Number(row.hourlyCap ?? existing.scalePolicy.hourlyCap)),
      timezone: String(row.timezone ?? existing.scalePolicy.timezone),
      minSpacingMinutes: Math.max(
        1,
        Number(row.minSpacingMinutes ?? existing.scalePolicy.minSpacingMinutes)
      ),
      accountId: String(row.accountId ?? existing.scalePolicy.accountId),
      mailboxAccountId: String(row.mailboxAccountId ?? existing.scalePolicy.mailboxAccountId),
      safetyMode: String(row.safetyMode) === "balanced" ? "balanced" : "strict",
    };
  }

  const campaign = await updateScaleCampaignRecord(brandId, campaignId, patch);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  return NextResponse.json({ campaign });
}

export async function DELETE(
  _: Request,
  context: { params: Promise<{ brandId: string; campaignId: string }> }
) {
  const { brandId, campaignId } = await context.params;
  const deleted = await deleteScaleCampaignRecord(brandId, campaignId);
  if (!deleted) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }
  return NextResponse.json({ deletedId: campaignId });
}
