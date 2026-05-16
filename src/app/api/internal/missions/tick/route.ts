import { NextResponse } from "next/server";
import { isInternalCronAuthorized } from "@/lib/internal-cron";
import { runMissionTick } from "@/lib/mission-learning";
import { runMissionAutopilotTick } from "@/lib/mission-orchestrator";

async function runTick(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const autopilot = await runMissionAutopilotTick(10);
  const missions = await runMissionTick(25);
  return NextResponse.json({ ok: autopilot.failed === 0 && missions.failed === 0, autopilot, missions });
}

export async function GET(request: Request) {
  return runTick(request);
}

export async function POST(request: Request) {
  return runTick(request);
}
