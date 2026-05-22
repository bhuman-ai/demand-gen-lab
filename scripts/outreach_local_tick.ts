import { runMailpoolOutreachAccountSyncTick } from "@/lib/mailpool-account-refresh";
import { reconcileAssignedSenderWarmupCampaigns } from "@/lib/sender-warmup-campaigns";
import { runScaleCampaignSendablePrepTick } from "@/lib/scale-campaign-sendable-prep";
import { runCampaignHopperTick, runInboxSyncTick, runOutreachTick } from "@/lib/outreach-runtime";
import { runCronTask, type SettledCronTaskResult } from "@/lib/internal-cron";

function intArg(name: string, fallback: number) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? "";
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function requestOrigin() {
  return (
    String(process.env.APP_URL ?? "").trim().replace(/\/+$/, "") ||
    String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "") ||
    "http://127.0.0.1:3000"
  );
}

function taskOk(task: SettledCronTaskResult<unknown>) {
  return task.ok;
}

async function main() {
  const dispatchLimit = intArg("limit", 8);
  const mailpoolLimit = intArg("mailpool-limit", 6);
  const prepLimit = intArg("prep-limit", 3);
  const hopperLimit = intArg("hopper-limit", 3);
  const origin = requestOrigin();

  const mailpoolSync = await runCronTask("mailpoolSync", () => runMailpoolOutreachAccountSyncTick(mailpoolLimit), {
    timeoutMs: 30_000,
  });
  const warmupCampaigns = await runCronTask("warmupCampaigns", () => reconcileAssignedSenderWarmupCampaigns(), {
    timeoutMs: 45_000,
  });

  const [outreach, campaignPrep, inboxSync] = await Promise.all([
    runCronTask("outreach", () => runOutreachTick(dispatchLimit, { includeCampaignHopper: false }), {
      timeoutMs: 180_000,
    }),
    runCronTask(
      "campaignPrep",
      () =>
        runScaleCampaignSendablePrepTick(prepLimit, {
          requestOrigin: origin,
          maxRuntimeMs: 55_000,
          maxCampaignPrepMs: 45_000,
        }),
      { timeoutMs: 70_000 }
    ),
    runCronTask("inboxSync", () => runInboxSyncTick(4), { timeoutMs: 40_000 }),
  ]);

  const campaignHopper = await runCronTask("campaignHopper", () => runCampaignHopperTick(hopperLimit), {
    timeoutMs: 120_000,
  });

  const tasks = [mailpoolSync, warmupCampaigns, outreach, campaignPrep, inboxSync, campaignHopper];
  const degradedTasks = tasks
    .filter((task) => !task.ok)
    .map((task) => ({ name: task.name, error: task.error }));
  const result = {
    ok: tasks.every(taskOk),
    criticalOk: true,
    degradedTasks,
    warmedAt: new Date().toISOString(),
    mailpoolSync,
    warmupCampaigns,
    outreach,
    campaignPrep,
    inboxSync,
    campaignHopper,
  };

  console.log(JSON.stringify(result));
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
