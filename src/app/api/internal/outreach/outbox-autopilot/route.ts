import { NextResponse } from "next/server";
import { isInternalCronAuthorized, recordInternalCronRun } from "@/lib/internal-cron";
import { runOutboxAutopilotTick } from "@/lib/outbox-v1";

export const maxDuration = 180;

async function handleOutboxAutopilotTick(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "1");
  const result = await runOutboxAutopilotTick(Number.isFinite(limit) ? limit : 1);
  const response = {
    ok: result.failed === 0,
    criticalPath: "outbox_autopilot",
    outboxAutopilot: result,
  };
  await recordInternalCronRun({
    taskName: "outbox_autopilot",
    route: "/api/internal/outreach/outbox-autopilot",
    ok: response.ok,
    durationMs: Date.now() - startedAt,
    details: response,
    error: result.results
      .filter((item) => item.action === "error")
      .map((item) => `${item.brandId}:${item.reason}`)
      .join("; "),
  });
  return NextResponse.json(response);
}

export async function GET(request: Request) {
  return handleOutboxAutopilotTick(request);
}

export async function POST(request: Request) {
  return handleOutboxAutopilotTick(request);
}
