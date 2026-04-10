import { NextResponse } from "next/server";
import { createBrand, getBrandById, listBrandsWithOptions } from "@/lib/factory-data";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBrandPersistence(brandId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const brand = await getBrandById(brandId);
    if (brand) return brand;
    await sleep(250);
  }
  return null;
}

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
  const website = String(body?.website ?? "").trim();
  let derivedName = "";
  if (website) {
    try {
      derivedName = new URL(website).hostname.replace(/^www\./, "");
    } catch {
      derivedName = website;
    }
  }
  const name = String(body?.name ?? body?.brandName ?? "").trim() || derivedName.trim();
  const tone = String(body?.tone ?? "").trim();
  const notes = String(body?.notes ?? body?.proof ?? "").trim();
  const product = String(body?.product ?? "").trim();
  const socialDiscoveryPlatforms = normalizeStringArray(body?.socialDiscoveryPlatforms);
  const operablePersonas = normalizeStringArray(body?.operablePersonas);
  const availableAssets = normalizeStringArray(body?.availableAssets);
  const targetMarkets = normalizeStringArray(body?.targetMarkets);
  const idealCustomerProfiles = normalizeStringArray(body?.idealCustomerProfiles);
  const keyFeatures = normalizeStringArray(body?.keyFeatures);
  const keyBenefits = normalizeStringArray(body?.keyBenefits);

  if (!website) {
    return NextResponse.json({ error: "website is required" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "name could not be derived from website" }, { status: 400 });
  }

  const created = await createBrand({
    name,
    website,
    tone,
    notes,
    product,
    socialDiscoveryPlatforms,
    operablePersonas,
    availableAssets,
    targetMarkets,
    idealCustomerProfiles,
    keyFeatures,
    keyBenefits,
  });
  const brand = await waitForBrandPersistence(created.id);
  if (!brand) {
    return NextResponse.json(
      { error: "Brand was created but could not be read back yet. Please try again." },
      { status: 503 }
    );
  }
  return NextResponse.json({ brand }, { status: 201 });
}
