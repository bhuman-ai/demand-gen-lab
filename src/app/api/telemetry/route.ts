import { appendFile, mkdir } from "fs/promises";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const event = String(row.event ?? "unknown");
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload
      : {};

  try {
    const dir = `${process.cwd()}/logs`;
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      payload,
      userAgent: request.headers.get("user-agent") ?? "",
    });
    await appendFile(`${dir}/telemetry.log`, `${line}\n`);
  } catch {
    // best effort
  }

  return NextResponse.json({ ok: true });
}
