import { NextResponse } from "next/server";
import { getMissionDetail, updateMission } from "@/lib/mission-data";
import type { MissionPlan } from "@/lib/mission-types";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; missionId: string }> }
) {
  const { brandId, missionId } = await context.params;
  const detail = await getMissionDetail(brandId, missionId);
  if (!detail) {
    return NextResponse.json({ error: "mission not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ brandId: string; missionId: string }> }
) {
  const { brandId, missionId } = await context.params;
  const body = asRecord(await request.json().catch(() => ({})));
  const patch: {
    generatedPlan?: MissionPlan;
    approvedPlan?: MissionPlan;
    targetCustomerText?: string;
    websiteUrl?: string;
  } = {};
  if (body.generatedPlan && typeof body.generatedPlan === "object") {
    patch.generatedPlan = body.generatedPlan as MissionPlan;
  }
  if (body.approvedPlan && typeof body.approvedPlan === "object") {
    patch.approvedPlan = body.approvedPlan as MissionPlan;
  }
  if (typeof body.targetCustomerText === "string") patch.targetCustomerText = body.targetCustomerText;
  if (typeof body.websiteUrl === "string") patch.websiteUrl = body.websiteUrl;

  const mission = await updateMission(brandId, missionId, patch);
  if (!mission) {
    return NextResponse.json({ error: "mission not found" }, { status: 404 });
  }
  return NextResponse.json({ mission });
}
