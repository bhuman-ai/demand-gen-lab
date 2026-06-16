import { NextResponse } from "next/server";
import { runCampaignHopperTick, runInboxSyncTick } from "@/lib/outreach-runtime";
import { runScaleCampaignSendablePrepTick } from "@/lib/scale-campaign-sendable-prep";
import { runSenderLaunchTick } from "@/lib/sender-launch";
import { getGmailUiWorkerHealth, hasGmailUiWorkerConfig } from "@/lib/gmail-ui-worker-client";
import { runMailpoolOutreachAccountSyncTick } from "@/lib/mailpool-account-refresh";
import { reconcileAssignedSenderWarmupCampaigns } from "@/lib/sender-warmup-campaigns";
import { isInternalCronAuthorized, recordInternalCronRun, runCronTask } from "@/lib/internal-cron";
import { runLeadrChannelSyncTick } from "@/lib/leadr-channel";
import { runMissionTick } from "@/lib/mission-learning";
import { runBrandActivationAutopilot } from "@/lib/brand-activation-autopilot";
import { runOutboxAutopilotTick } from "@/lib/outbox-v1";

export const maxDuration = 180;

async function handleOpsTick(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const gmailUiWorkerTask = hasGmailUiWorkerConfig()
    ? runCronTask("gmailUiWorker", () => getGmailUiWorkerHealth(), { timeoutMs: 10_000 })
    : Promise.resolve({
        name: "gmailUiWorker",
        ok: true as const,
        durationMs: 0,
        value: {
          ok: false,
          status: "not_configured",
          sessions: 0,
          baseUrl: "",
        },
      });

  const requestOrigin = new URL(request.url).origin;
  const [
    mailpoolSync,
    warmupCampaigns,
    campaignPrep,
    gmailUiWorker,
    inboxSync,
    senderLaunch,
    missions,
    leadrSync,
    brandActivation,
    outboxAutopilot,
    campaignHopper,
  ] = await Promise.all([
    runCronTask("mailpoolSync", () => runMailpoolOutreachAccountSyncTick(6), {
      timeoutMs: 30_000,
    }),
    runCronTask("warmupCampaigns", () => reconcileAssignedSenderWarmupCampaigns(), {
      timeoutMs: 45_000,
    }),
    runCronTask(
      "campaignPrep",
      () =>
        runScaleCampaignSendablePrepTick(3, {
          requestOrigin,
          maxRuntimeMs: 55_000,
          maxCampaignPrepMs: 45_000,
        }),
      { timeoutMs: 70_000 }
    ),
    gmailUiWorkerTask,
    runCronTask("inboxSync", () => runInboxSyncTick(4), { timeoutMs: 60_000 }),
    runCronTask("senderLaunch", () => runSenderLaunchTick(8, { mailboxSync: false }), {
      timeoutMs: 45_000,
    }),
    runCronTask("missions", () => runMissionTick(25), { timeoutMs: 45_000 }),
    runCronTask("leadrSync", () => runLeadrChannelSyncTick(8), { timeoutMs: 45_000 }),
    runCronTask("brandActivation", () => runBrandActivationAutopilot(), {
      timeoutMs: 105_000,
    }),
    runCronTask("outboxAutopilot", () => runOutboxAutopilotTick(1), {
      timeoutMs: 120_000,
    }),
    runCronTask("campaignHopper", () => runCampaignHopperTick(3), {
      timeoutMs: 120_000,
    }),
  ]);

  const tasks = [
    mailpoolSync,
    warmupCampaigns,
    campaignPrep,
    campaignHopper,
    gmailUiWorker,
    inboxSync,
    senderLaunch,
    missions,
    leadrSync,
    brandActivation,
    outboxAutopilot,
  ];
  const ok = tasks.every((task) => task.ok);
  const failedTasks = tasks.filter((task) => !task.ok);
  const response = {
    ok,
    criticalPath: "ops",
    mailpoolSync,
    warmupCampaigns,
    campaignPrep,
    campaignHopper,
    gmailUiWorker,
    inboxSync,
    senderLaunch,
    missions,
    leadrSync,
    brandActivation,
    outboxAutopilot,
  };

  await recordInternalCronRun({
    taskName: "outreach_ops_tick",
    route: "/api/internal/outreach/ops-tick",
    ok,
    durationMs: Date.now() - startedAt,
    details: response,
    error: failedTasks.map((task) => `${task.name}:${"error" in task ? task.error : "failed"}`).join("; "),
  });

  return NextResponse.json(response);
}

export async function GET(request: Request) {
  return handleOpsTick(request);
}

export async function POST(request: Request) {
  return handleOpsTick(request);
}
