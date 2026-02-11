import { NextResponse } from "next/server";
import { createOutreachAccount, listOutreachAccounts } from "@/lib/outreach-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET() {
  const accounts = await listOutreachAccounts();
  return NextResponse.json({ accounts });
}

export async function POST(request: Request) {
  const body = asRecord(await request.json());
  const name = String(body.name ?? "").trim();

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const account = await createOutreachAccount({
    name,
    status: String(body.status ?? "active") === "inactive" ? "inactive" : "active",
    config: body.config,
    credentials: body.credentials,
  });

  return NextResponse.json({ account }, { status: 201 });
}
