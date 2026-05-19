import { NextResponse } from "next/server";
import { isInternalCronAuthorized, recordInternalCronRun, runCronTask } from "@/lib/internal-cron";
import { runMissionTick } from "@/lib/mission-learning";
import { runMissionAutopilotTick } from "@/lib/mission-orchestrator";
import { runInboxSyncTick } from "@/lib/outreach-runtime";
import { runSenderLaunchTick } from "@/lib/sender-launch";

async function handleOpsTick(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const [inboxSync, senderLaunch] = await Promise.all([
    runCronTask("outreach_ops_inbox_sync", () => runInboxSyncTick(12), { timeoutMs: 45_000 }),
    runCronTask("outreach_ops_sender_launch", () => runSenderLaunchTick(12, { mailboxSync: false }), {
      timeoutMs: 45_000,
    }),
  ]);
  const missionAutopilot = await runCronTask("outreach_ops_mission_autopilot", () => runMissionAutopilotTick(10), {
    timeoutMs: 90_000,
  });
  const missions = await runCronTask("outreach_ops_mission_refresh", () => runMissionTick(25), { timeoutMs: 45_000 });
  const ok =
    inboxSync.ok &&
    senderLaunch.ok &&
    missionAutopilot.ok &&
    missions.ok &&
    inboxSync.value.failed === 0 &&
    senderLaunch.value.actionsFailed === 0 &&
    missionAutopilot.value.failed === 0 &&
    missions.value.failed === 0;

  await recordInternalCronRun({
    taskName: "outreach_ops_tick",
    route: "/api/internal/outreach/ops-tick",
    ok,
    durationMs: Date.now() - startedAt,
    details: { inboxSync, senderLaunch, missionAutopilot, missions },
    error: [inboxSync, senderLaunch, missionAutopilot, missions]
      .filter((result) => !result.ok)
      .map((result) => result.error)
      .join("; "),
  });

  return NextResponse.json({
    ok,
    inboxSync,
    senderLaunch,
    missionAutopilot,
    missions,
  });
}

export async function GET(request: Request) {
  return handleOpsTick(request);
}

export async function POST(request: Request) {
  return handleOpsTick(request);
}
