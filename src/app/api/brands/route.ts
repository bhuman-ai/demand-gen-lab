import { NextResponse } from "next/server";
import { createBrand, listBrands } from "@/lib/factory-data";

export async function GET() {
  const brands = await listBrands();
  return NextResponse.json({ brands });
}

export async function POST(request: Request) {
  const body = await request.json();
  const name = String(body?.name ?? body?.brandName ?? "").trim();
  const website = String(body?.website ?? "").trim();
  const tone = String(body?.tone ?? "").trim();
  const notes = String(body?.notes ?? body?.proof ?? "").trim();

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!website) {
    return NextResponse.json({ error: "website is required" }, { status: 400 });
  }

  const brand = await createBrand({ name, website, tone, notes });
  return NextResponse.json({ brand }, { status: 201 });
}
