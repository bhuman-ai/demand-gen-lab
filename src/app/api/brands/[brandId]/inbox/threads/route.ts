import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { listReplyThreadsByBrand } from "@/lib/outreach-data";

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const { threads, drafts } = await listReplyThreadsByBrand(brandId);
  return NextResponse.json({ threads, drafts });
}
