import { NextResponse } from "next/server";
import { isInternalCronAuthorized } from "@/lib/internal-cron";
import { runMissionTick } from "@/lib/mission-learning";

async function runTick(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const missions = await runMissionTick(25);
  return NextResponse.json({ ok: missions.failed === 0, ...missions });
}

export async function GET(request: Request) {
  return runTick(request);
}

export async function POST(request: Request) {
  return runTick(request);
}
