import { NextResponse } from "next/server";
import { runInboxSyncTick, runOutreachTick } from "@/lib/outreach-runtime";
import { runExperimentSendablePrepTick } from "@/lib/experiment-sendable-prep";
import { runSenderLaunchTick } from "@/lib/sender-launch";

function isAuthorized(request: Request) {
  const token =
    String(process.env.OUTREACH_CRON_TOKEN ?? "").trim() ||
    String(process.env.CRON_SECRET ?? "").trim();
  if (!token) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${token}`;
}

async function handleTick(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const requestOrigin = new URL(request.url).origin;
  const [outreach, sendablePrep, inboxSync, senderLaunch] = await Promise.all([
    runOutreachTick(30),
    runExperimentSendablePrepTick(24, {
      requestOrigin,
    }),
    runInboxSyncTick(12),
    runSenderLaunchTick(12, {
      mailboxSync: false,
    }),
  ]);

  return NextResponse.json({ ok: true, outreach, inboxSync, sendablePrep, senderLaunch });
}

export async function GET(request: Request) {
  return handleTick(request);
}

export async function POST(request: Request) {
  return handleTick(request);
}
