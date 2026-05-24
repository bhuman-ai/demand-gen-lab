import { NextResponse } from "next/server";
import { isInternalCronAuthorized } from "@/lib/internal-cron";
import { updateRunControl } from "@/lib/outreach-runtime";

export const maxDuration = 60;

const RUN_CONTROL_ACTIONS = new Set([
  "pause",
  "resume",
  "cancel",
  "probe_deliverability",
  "resume_sender_deliverability",
  "seed_inbox_placement",
]);

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const brandId = String(body.brandId ?? "").trim();
  const campaignId = String(body.campaignId ?? "").trim();
  const runId = String(body.runId ?? "").trim();
  const action = String(body.action ?? "").trim().toLowerCase();

  if (!brandId || !campaignId || !runId) {
    return NextResponse.json(
      { error: "brandId, campaignId, and runId are required" },
      { status: 400 }
    );
  }

  if (!RUN_CONTROL_ACTIONS.has(action)) {
    return NextResponse.json(
      {
        error:
          "action must be pause, resume, cancel, probe_deliverability, resume_sender_deliverability, or seed_inbox_placement",
      },
      { status: 400 }
    );
  }

  const result = await updateRunControl({
    brandId,
    campaignId,
    runId,
    action: action as
      | "pause"
      | "resume"
      | "cancel"
      | "probe_deliverability"
      | "resume_sender_deliverability"
      | "seed_inbox_placement",
    reason: typeof body.reason === "string" ? body.reason : undefined,
    senderAccountId: typeof body.senderAccountId === "string" ? body.senderAccountId : undefined,
    recipientEmail: typeof body.recipientEmail === "string" ? body.recipientEmail : undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ ok: true, message: result.reason });
}
