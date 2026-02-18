import { NextResponse } from "next/server";
import { runOutreachTick } from "@/lib/outreach-runtime";

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

  const result = await runOutreachTick(30);
  return NextResponse.json({ ok: true, result });
}

export async function GET(request: Request) {
  return handleTick(request);
}

export async function POST(request: Request) {
  return handleTick(request);
}
