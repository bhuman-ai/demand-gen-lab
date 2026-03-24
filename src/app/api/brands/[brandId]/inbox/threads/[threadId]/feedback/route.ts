import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { createReplyThreadFeedback, getReplyThread } from "@/lib/outreach-data";
import type { ReplyThreadFeedbackType } from "@/lib/factory-types";

const FEEDBACK_TYPES = new Set<ReplyThreadFeedbackType>([
  "good",
  "wrong_move",
  "wrong_facts",
  "too_aggressive",
  "should_be_human",
]);

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string; threadId: string }> }
) {
  const { brandId, threadId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const thread = await getReplyThread(threadId);
  if (!thread || thread.brandId !== brandId) {
    return NextResponse.json({ error: "thread not found" }, { status: 404 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const type = String(body.type ?? "").trim() as ReplyThreadFeedbackType;
  if (!FEEDBACK_TYPES.has(type)) {
    return NextResponse.json({ error: "invalid feedback type" }, { status: 400 });
  }

  const feedback = await createReplyThreadFeedback({
    threadId,
    brandId,
    type,
    note: String(body.note ?? "").trim(),
  });

  return NextResponse.json({ ok: true, feedback });
}
