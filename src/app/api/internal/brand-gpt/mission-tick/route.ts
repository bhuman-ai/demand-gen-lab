import { NextResponse } from "next/server";
import { runBrandGptMissionTick } from "@/lib/brand-gpt-mission-runner";
import { isInternalCronAuthorized } from "@/lib/internal-cron";

async function runTick(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runBrandGptMissionTick();
  return NextResponse.json({ ok: result.failed === 0, ...result });
}

export async function GET(request: Request) {
  return runTick(request);
}

export async function POST(request: Request) {
  return runTick(request);
}
