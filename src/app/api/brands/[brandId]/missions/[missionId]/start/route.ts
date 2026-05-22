import { NextResponse } from "next/server";
import { startMission } from "@/lib/mission-orchestrator";
import type { MissionPlan } from "@/lib/mission-types";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string; missionId: string }> }
) {
  const { brandId, missionId } = await context.params;
  const body = asRecord(await request.json().catch(() => ({})));
  const approvedPlan = asRecord(body.approvedPlan);
  if (!Object.keys(approvedPlan).length) {
    return NextResponse.json({ error: "approvedPlan is required." }, { status: 400 });
  }

  try {
    const mission = await startMission({
      brandId,
      missionId,
      approvedPlan: approvedPlan as MissionPlan,
    });
    return NextResponse.json({ mission });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start mission." },
      { status: 500 }
    );
  }
}
