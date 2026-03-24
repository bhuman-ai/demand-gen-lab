import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { getReplyThreadDetail } from "@/lib/reply-thread-state";

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; threadId: string }> }
) {
  const { brandId, threadId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const detail = await getReplyThreadDetail(threadId);
  if (!detail || detail.thread.brandId !== brandId) {
    return NextResponse.json({ error: "thread not found" }, { status: 404 });
  }

  return NextResponse.json({ detail });
}
