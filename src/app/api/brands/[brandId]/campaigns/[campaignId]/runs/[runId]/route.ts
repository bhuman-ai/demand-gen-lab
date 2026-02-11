import { NextResponse } from "next/server";
import { updateRunControl } from "@/lib/outreach-runtime";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string; runId: string }> }
) {
  const { brandId, campaignId, runId } = await context.params;
  const body = asRecord(await request.json());
  const actionRaw = String(body.action ?? "").toLowerCase();
  const action = ["pause", "resume", "cancel"].includes(actionRaw)
    ? (actionRaw as "pause" | "resume" | "cancel")
    : null;

  if (!action) {
    return NextResponse.json({ error: "action must be pause, resume, or cancel" }, { status: 400 });
  }

  const result = await updateRunControl({
    brandId,
    campaignId,
    runId,
    action,
    reason: typeof body.reason === "string" ? body.reason : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ ok: true, message: result.reason });
}
