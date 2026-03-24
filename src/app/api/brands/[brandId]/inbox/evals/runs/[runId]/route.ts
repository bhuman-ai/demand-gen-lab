import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { getInboxEvalRunDetail } from "@/lib/inbox-evals";

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string; runId: string }> }
) {
  const { brandId, runId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const run = await getInboxEvalRunDetail(runId);
  if (!run || run.brandId !== brandId) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  return NextResponse.json({ run });
}
