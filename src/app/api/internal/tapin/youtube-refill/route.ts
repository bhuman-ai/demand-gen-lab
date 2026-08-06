import { NextResponse } from "next/server";
import {
  isTapInCronAuthorized,
  runAndRecordTapInTask,
  runTapInYouTubeRefill,
} from "@/lib/tapinsocial-runner";

export const maxDuration = 60;

async function handle(request: Request) {
  if (!isTapInCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const refill = await runAndRecordTapInTask({
    name: "tapInSocialYouTubeRefill",
    route: url.pathname,
    task: runTapInYouTubeRefill,
  });
  return NextResponse.json({ ok: refill.ok, criticalPath: "tapin-youtube-refill", refill });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
