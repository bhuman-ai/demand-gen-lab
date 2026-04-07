import { NextResponse } from "next/server";
import { createBrand, listBrandsWithOptions } from "@/lib/factory-data";
import { syncBrandGmailUiAssignments } from "@/lib/gmail-ui-brand-sync";

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const includeEmbedded = searchParams.get("includeEmbedded") === "1";
  const brands = await listBrandsWithOptions({ includeEmbedded });
  return NextResponse.json({ brands });
}

export async function POST(request: Request) {
  const body = await request.json();
  const name = String(body?.name ?? body?.brandName ?? "").trim();
  const website = String(body?.website ?? "").trim();
  const tone = String(body?.tone ?? "").trim();
  const notes = String(body?.notes ?? body?.proof ?? "").trim();
  const product = String(body?.product ?? "").trim();
  const socialDiscoveryPlatforms = normalizeStringArray(body?.socialDiscoveryPlatforms);
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
    socialDiscoveryPlatforms,
    targetMarkets,
    idealCustomerProfiles,
    keyFeatures,
    keyBenefits,
  });
  await syncBrandGmailUiAssignments({ brandIds: [brand.id] }).catch(() => null);
  return NextResponse.json({ brand }, { status: 201 });
}
