import { NextResponse } from "next/server";
import { isInternalCronAuthorized, recordInternalCronRun, runCronTask } from "@/lib/internal-cron";
import { runOutreachTick } from "@/lib/outreach-runtime";

async function handleDispatchTick(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const outreach = await runCronTask(
    "outreach_dispatch_tick",
    () => runOutreachTick(50, { includeCampaignHopper: false }),
    { timeoutMs: 55_000 }
  );
  const ok = outreach.ok && outreach.value.failed === 0;
  await recordInternalCronRun({
    taskName: "outreach_dispatch_tick",
    route: "/api/internal/outreach/dispatch-tick",
    ok,
    durationMs: Date.now() - startedAt,
    details: { outreach },
    error: outreach.ok ? "" : outreach.error,
  });

  return NextResponse.json({
    ok,
    outreach,
  });
}

export async function GET(request: Request) {
  return handleDispatchTick(request);
}

export async function POST(request: Request) {
  return handleDispatchTick(request);
}
