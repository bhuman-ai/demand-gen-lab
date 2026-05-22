import { NextResponse } from "next/server";
import { isInternalCronAuthorized } from "@/lib/internal-cron";
import { buildOutreachStatusResponse, normalizeOutreachStatusFilters } from "@/lib/outreach-status";

export const maxDuration = 60;

async function readFilters(request: Request) {
  const url = new URL(request.url);
  let body: Record<string, unknown> = {};

  if (request.method === "POST") {
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  const bodyIncludeWarmup =
    typeof body.includeWarmup === "boolean" ||
    typeof body.includeWarmup === "number" ||
    typeof body.includeWarmup === "string"
      ? body.includeWarmup
      : undefined;
  const bodyLimitBrands =
    typeof body.limitBrands === "number" || typeof body.limitBrands === "string"
      ? body.limitBrands
      : undefined;

  return normalizeOutreachStatusFilters({
    brandId: String(body.brandId ?? url.searchParams.get("brandId") ?? "").trim(),
    includeWarmup: bodyIncludeWarmup ?? url.searchParams.get("includeWarmup") ?? "",
    limitBrands: bodyLimitBrands ?? url.searchParams.get("limitBrands") ?? "",
  });
}

async function handleStatus(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const filters = await readFilters(request);
  const response = await buildOutreachStatusResponse(filters);
  return NextResponse.json(response);
}

export async function GET(request: Request) {
  return handleStatus(request);
}

export async function POST(request: Request) {
  return handleStatus(request);
}
