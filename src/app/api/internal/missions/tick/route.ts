import { NextResponse } from "next/server";
import { isInternalCronAuthorized } from "@/lib/internal-cron";
import { runMissionTick } from "@/lib/mission-learning";
import { runBrandActivationAutopilot } from "@/lib/brand-activation-autopilot";

async function runTick(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [missions, activation] = await Promise.all([
    runMissionTick(25),
    runBrandActivationAutopilot(),
  ]);
  return NextResponse.json({ ok: missions.failed === 0, ...missions, activation });
}

export async function GET(request: Request) {
  return runTick(request);
}

export async function POST(request: Request) {
  return runTick(request);
}
