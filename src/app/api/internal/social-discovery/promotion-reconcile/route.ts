import { NextResponse } from "next/server";
import { isInternalCronAuthorized, runCronTask } from "@/lib/internal-cron";
import { runSocialDiscoveryPromotionReconcileTick } from "@/lib/social-discovery-promotion-reconcile";

export const maxDuration = 60;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function splitCsv(value: unknown) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return raw
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function numberOption(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}

async function requestJson(request: Request) {
  if (request.method === "GET") return {};
  try {
    return asRecord(await request.json());
  } catch {
    return {};
  }
}

async function handlePromotionReconcile(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await requestJson(request);
  const url = new URL(request.url);
  const brandIds = splitCsv(
    body.brandIds ??
      body.brandId ??
      url.searchParams.get("brandIds") ??
      url.searchParams.get("brandId") ??
      process.env.SOCIAL_DISCOVERY_BRAND_IDS
  );
  const limit = numberOption(body.limit ?? url.searchParams.get("limit"), 1, 1, 10);
  const perBrandLimit = numberOption(body.perBrandLimit ?? url.searchParams.get("perBrandLimit"), 15, 1, 100);
  const scanAllBrands =
    String(body.scanAllBrands ?? url.searchParams.get("scanAllBrands") ?? process.env.SOCIAL_DISCOVERY_SCAN_ALL_BRANDS)
      .trim()
      .toLowerCase() === "true";
  const dryRun = String(body.dryRun ?? url.searchParams.get("dryRun") ?? "")
    .trim()
    .toLowerCase() === "true";

  const reconcile = await runCronTask(
    "socialDiscoveryPromotionReconcile",
    () =>
      runSocialDiscoveryPromotionReconcileTick({
        brandIds,
        limit,
        perBrandLimit,
        scanAllBrands,
        dryRun,
      }),
    { timeoutMs: 55_000 }
  );

  return NextResponse.json({
    ok: reconcile.ok,
    criticalPath: "social-discovery-promotion-reconcile",
    reconcile,
  });
}

export async function GET(request: Request) {
  return handlePromotionReconcile(request);
}

export async function POST(request: Request) {
  return handlePromotionReconcile(request);
}
