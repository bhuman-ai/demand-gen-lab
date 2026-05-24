import { NextResponse } from "next/server";
import { getBrandBudgetSummary, setBrandBudget } from "@/lib/brand-budget";
import type { BrandBudgetStatus } from "@/lib/brand-budget-types";

function readBudgetStatus(value: unknown): BrandBudgetStatus | undefined {
  const normalized = String(value ?? "").trim();
  return normalized === "active" || normalized === "paused" ? normalized : undefined;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await context.params;
  const budget = await getBrandBudgetSummary(brandId);
  return NextResponse.json({ budget });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  const { brandId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const totalBudgetUsd = Number(body.totalBudgetUsd ?? body.total_budget_usd);
  if (!Number.isFinite(totalBudgetUsd) || totalBudgetUsd < 0) {
    return NextResponse.json({ error: "totalBudgetUsd must be a non-negative number" }, { status: 400 });
  }

  const budget = await setBrandBudget({
    brandId,
    totalBudgetUsd,
    status: readBudgetStatus(body.status),
    notes: typeof body.notes === "string" ? body.notes : undefined,
  });
  return NextResponse.json({ budget });
}
