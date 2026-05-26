import { NextResponse } from "next/server";
import { runCampaignHopperTick, runInboxSyncTick, runOutreachTick } from "@/lib/outreach-runtime";
import { runExperimentSendablePrepTick } from "@/lib/experiment-sendable-prep";
import { runScaleCampaignSendablePrepTick } from "@/lib/scale-campaign-sendable-prep";
import { runSenderLaunchTick } from "@/lib/sender-launch";
import { runMailpoolOutreachAccountSyncTick } from "@/lib/mailpool-account-refresh";
import { reconcileAssignedSenderWarmupCampaigns } from "@/lib/sender-warmup-campaigns";
import { isInternalCronAuthorized, runCronTask } from "@/lib/internal-cron";
import { runLeadrChannelSyncTick } from "@/lib/leadr-channel";
import { runMissionTick } from "@/lib/mission-learning";
import { runBrandActivationAutopilot } from "@/lib/brand-activation-autopilot";

export const maxDuration = 180;

async function handleTick(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const combinedTickEnabled = String(process.env.OUTREACH_COMBINED_TICK_ENABLED ?? "false").trim().toLowerCase();
  if (!["1", "true", "yes", "on"].includes(combinedTickEnabled)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason:
        "Combined outreach tick is disabled. Vercel split crons handle dispatch, prep, and ops without duplicating the Cloudflare combined cron.",
    });
  }

  const requestOrigin = new URL(request.url).origin;
  const [
    mailpoolSync,
    warmupCampaigns,
    outreach,
    sendablePrep,
    campaignPrep,
    inboxSync,
    senderLaunch,
    missions,
    leadrSync,
    brandActivation,
    campaignHopper,
  ] = await Promise.all([
    runCronTask("mailpoolSync", () => runMailpoolOutreachAccountSyncTick(6), {
      timeoutMs: 30_000,
    }),
    runCronTask("warmupCampaigns", () => reconcileAssignedSenderWarmupCampaigns(), {
      timeoutMs: 45_000,
    }),
    runCronTask("outreach", () => runOutreachTick(8, { includeCampaignHopper: false }), { timeoutMs: 150_000 }),
    runCronTask("sendablePrep", () => runExperimentSendablePrepTick(24, { requestOrigin }), {
      timeoutMs: 55_000,
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
    runCronTask("inboxSync", () => runInboxSyncTick(6), { timeoutMs: 40_000 }),
    runCronTask("senderLaunch", () => runSenderLaunchTick(12, { mailboxSync: false }), {
      timeoutMs: 55_000,
    }),
    runCronTask("missions", () => runMissionTick(25), { timeoutMs: 45_000 }),
    runCronTask("leadrSync", () => runLeadrChannelSyncTick(8), { timeoutMs: 45_000 }),
    runCronTask("brandActivation", () => runBrandActivationAutopilot(), {
      timeoutMs: 105_000,
    }),
    runCronTask("campaignHopper", () => runCampaignHopperTick(3), {
      timeoutMs: 120_000,
    }),
  ]);

  return NextResponse.json({
    ok:
      mailpoolSync.ok &&
      warmupCampaigns.ok &&
      outreach.ok &&
      sendablePrep.ok &&
      campaignPrep.ok &&
      inboxSync.ok &&
      senderLaunch.ok &&
      leadrSync.ok &&
      campaignHopper.ok &&
      missions.ok &&
      brandActivation.ok,
    outreach,
    missions,
    brandActivation,
    inboxSync,
    sendablePrep,
    senderLaunch,
    leadrSync,
    warmupSystem: {
      mailpoolSync,
      warmupCampaigns,
      campaignPrep,
      campaignHopper,
    },
  });
}

export async function GET(request: Request) {
  return handleTick(request);
}

export async function POST(request: Request) {
  return handleTick(request);
}
