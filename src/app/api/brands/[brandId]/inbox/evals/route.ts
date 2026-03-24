import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { loadInboxEvalLab, runInboxEvalScenario } from "@/lib/inbox-evals";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET(
  _: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const data = await loadInboxEvalLab(brandId);
  return NextResponse.json(data);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const scenarioId = String(body.scenarioId ?? body.scenario_id ?? "").trim();
  if (!scenarioId) {
    return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
  }

  try {
    const run = await runInboxEvalScenario({
      brandId,
      scenarioId,
    });
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to run inbox eval",
      },
      { status: 400 }
    );
  }
}
