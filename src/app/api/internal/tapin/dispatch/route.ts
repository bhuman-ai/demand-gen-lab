import { NextResponse } from "next/server";
import {
  isTapInCronAuthorized,
  runAndRecordTapInTask,
  runTapInDispatch,
} from "@/lib/tapinsocial-runner";

export const maxDuration = 60;

async function handle(request: Request) {
  if (!isTapInCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const forceDryRun = ["1", "true", "yes", "on"].includes(
    String(url.searchParams.get("dryRun") ?? "").trim().toLowerCase()
  );
  const dispatch = await runAndRecordTapInTask({
    name: "tapInSocialDispatch",
    route: url.pathname,
    task: () => runTapInDispatch({ forceDryRun }),
  });
  return NextResponse.json({ ok: dispatch.ok, criticalPath: "tapin-youtube-dispatch", dispatch });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
