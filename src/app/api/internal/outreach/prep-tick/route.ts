import { NextResponse } from "next/server";
import { runExperimentSendablePrepTick } from "@/lib/experiment-sendable-prep";
import { isInternalCronAuthorized, recordInternalCronRun, runCronTask } from "@/lib/internal-cron";

async function handlePrepTick(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const requestOrigin = new URL(request.url).origin;
  const sendablePrep = await runCronTask(
    "outreach_prep_sendable",
    () => runExperimentSendablePrepTick(24, { requestOrigin }),
    { timeoutMs: 55_000 }
  );
  const ok = sendablePrep.ok && sendablePrep.value.errors.length === 0;
  await recordInternalCronRun({
    taskName: "outreach_prep_tick",
    route: "/api/internal/outreach/prep-tick",
    ok,
    durationMs: Date.now() - startedAt,
    details: { sendablePrep },
    error: sendablePrep.ok ? "" : sendablePrep.error,
  });

  return NextResponse.json({
    ok,
    sendablePrep,
  });
}

export async function GET(request: Request) {
  return handlePrepTick(request);
}

export async function POST(request: Request) {
  return handlePrepTick(request);
}
