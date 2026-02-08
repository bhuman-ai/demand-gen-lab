import { NextResponse } from "next/server";

const APIFY_RUN_BASE = "https://api.apify.com/v2/actor-runs";

export async function GET(_: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "APIFY_TOKEN is missing" }, { status: 500 });
  }

  const response = await fetch(`${APIFY_RUN_BASE}/${encodeURIComponent(runId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json({ error: "Fetch failed", details: errorText }, { status: 500 });
  }

  const data = await response.json();
  return NextResponse.json(data?.data ?? {});
}
