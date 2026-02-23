import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { createExperimentRecord, listExperimentRecords } from "@/lib/experiment-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET(_: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const experiments = await listExperimentRecords(brandId);
  return NextResponse.json({ experiments });
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const body = asRecord(await request.json());
  const name = String(body.name ?? "").trim() || "New Experiment";
  const offer = String(body.offer ?? "").trim();
  const audience = String(body.audience ?? "").trim();

  const experiment = await createExperimentRecord({
    brandId,
    name,
    offer,
    audience,
  });

  return NextResponse.json({ experiment }, { status: 201 });
}
