import { NextResponse } from "next/server";
import { createBrand, listBrands } from "@/lib/factory-data";

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0);
}

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
  const product = String(body?.product ?? "").trim();
  const targetMarkets = normalizeStringArray(body?.targetMarkets);
  const idealCustomerProfiles = normalizeStringArray(body?.idealCustomerProfiles);
  const keyFeatures = normalizeStringArray(body?.keyFeatures);
  const keyBenefits = normalizeStringArray(body?.keyBenefits);

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!website) {
    return NextResponse.json({ error: "website is required" }, { status: 400 });
  }

  const brand = await createBrand({
    name,
    website,
    tone,
    notes,
    product,
    targetMarkets,
    idealCustomerProfiles,
    keyFeatures,
    keyBenefits,
  });
  return NextResponse.json({ brand }, { status: 201 });
}
