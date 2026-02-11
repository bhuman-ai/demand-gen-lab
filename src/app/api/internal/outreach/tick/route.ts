import { NextResponse } from "next/server";
import { runOutreachTick } from "@/lib/outreach-runtime";

function isAuthorized(request: Request) {
  const token = process.env.OUTREACH_CRON_TOKEN;
  if (!token) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${token}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runOutreachTick(30);
  return NextResponse.json({ ok: true, result });
}
