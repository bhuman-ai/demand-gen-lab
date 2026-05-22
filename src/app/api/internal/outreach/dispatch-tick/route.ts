import { NextResponse } from "next/server";
import { runOutreachTick } from "@/lib/outreach-runtime";
import { isInternalCronAuthorized } from "@/lib/internal-cron";

export const maxDuration = 180;

async function handleDispatchTick(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const outreach = await runOutreachTick(8, {
    includeCampaignHopper: false,
  });
  return NextResponse.json({
    ok: true,
    criticalPath: "dispatch",
    outreach,
  });
}

export async function GET(request: Request) {
  return handleDispatchTick(request);
}

export async function POST(request: Request) {
  return handleDispatchTick(request);
}
