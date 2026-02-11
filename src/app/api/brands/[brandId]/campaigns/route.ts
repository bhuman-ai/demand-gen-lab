import { NextResponse } from "next/server";
import { createCampaign, getBrandById, listCampaigns } from "@/lib/factory-data";

export async function GET(_: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const campaigns = await listCampaigns(brandId);
  return NextResponse.json({ campaigns });
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const body = await request.json();
  const name = String(body?.name ?? "").trim() || "New Campaign";
  const campaign = await createCampaign({ brandId, name });
  return NextResponse.json({ campaign }, { status: 201 });
}
