import { NextResponse } from "next/server";
import { isInternalCronAuthorized } from "@/lib/internal-cron";
import { runOutboxAutopilotTick } from "@/lib/outbox-v1";

export const maxDuration = 180;

async function handleOutboxAutopilotTick(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "1");
  const result = await runOutboxAutopilotTick(Number.isFinite(limit) ? limit : 1);
  return NextResponse.json({
    ok: result.failed === 0,
    criticalPath: "outbox_autopilot",
    outboxAutopilot: result,
  });
}

export async function GET(request: Request) {
  return handleOutboxAutopilotTick(request);
}

export async function POST(request: Request) {
  return handleOutboxAutopilotTick(request);
}
