import { NextResponse } from "next/server";
import { approveReplyDraftAndSend } from "@/lib/outreach-runtime";

export async function POST(
  _: Request,
  context: { params: Promise<{ brandId: string; draftId: string }> }
) {
  const { brandId, draftId } = await context.params;
  const result = await approveReplyDraftAndSend({ brandId, draftId });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: result.reason });
}
