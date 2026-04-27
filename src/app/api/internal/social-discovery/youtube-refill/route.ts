import { NextResponse } from "next/server";
import { isInternalCronAuthorized, recordInternalCronRun, runCronTask } from "@/lib/internal-cron";
import { runSocialDiscoveryYouTubeRefillTick } from "@/lib/social-discovery-youtube-refill";

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

function numberOption(value: unknown) {
  if (String(value ?? "").trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanOption(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  return ["1", "true", "yes", "on"].includes(normalized);
}

async function requestJson(request: Request) {
  if (request.method === "GET") return {};
  try {
    return asRecord(await request.json());
  } catch {
    return {};
  }
}

async function handleYouTubeRefill(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await requestJson(request);
  const url = new URL(request.url);
  const brandIds = splitCsv(
    body.brandIds ?? body.brandId ?? url.searchParams.get("brandIds") ?? url.searchParams.get("brandId")
  );
  const refill = await runCronTask(
    "socialDiscoveryYouTubeRefill",
    () =>
      runSocialDiscoveryYouTubeRefillTick({
        brandIds,
        scanAllBrands: booleanOption(body.scanAllBrands ?? url.searchParams.get("scanAllBrands")),
        brandLimit: numberOption(body.brandLimit ?? url.searchParams.get("brandLimit")),
        maxQueries: numberOption(body.maxQueries ?? url.searchParams.get("maxQueries")),
        limitPerQuery: numberOption(body.limitPerQuery ?? body.limit ?? url.searchParams.get("limitPerQuery") ?? url.searchParams.get("limit")),
      }),
    { timeoutMs: 55_000 }
  );

  await recordInternalCronRun({
    taskName: refill.name,
    route: url.pathname,
    ok: refill.ok,
    durationMs: refill.durationMs,
    details: refill.ok ? refill.value : null,
    error: refill.ok ? "" : refill.error,
  });

  return NextResponse.json({
    ok: refill.ok,
    criticalPath: "social-discovery-youtube-refill",
    refill,
  });
}

export async function GET(request: Request) {
  return handleYouTubeRefill(request);
}

export async function POST(request: Request) {
  return handleYouTubeRefill(request);
}
