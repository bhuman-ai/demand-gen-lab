import { NextResponse } from "next/server";
import { isInternalCronAuthorized, runCronTask } from "@/lib/internal-cron";
import { runSocialDiscoveryAutoCommentDispatchTick } from "@/lib/social-discovery-comment-dispatch";

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

async function handleDispatch(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await requestJson(request);
  const url = new URL(request.url);
  const brandIds = splitCsv(
    body.brandIds ?? body.brandId ?? url.searchParams.get("brandIds") ?? url.searchParams.get("brandId")
  );
  const dryRun = booleanOption(body.dryRun ?? url.searchParams.get("dryRun"));
  const scanAllBrands = booleanOption(body.scanAllBrands ?? url.searchParams.get("scanAllBrands"));

  const dispatch = await runCronTask(
    "socialDiscoveryAutoCommentDispatch",
    () =>
      runSocialDiscoveryAutoCommentDispatchTick({
        brandIds,
        scanAllBrands,
        dryRun,
        limit: numberOption(body.brandLimit ?? url.searchParams.get("brandLimit")),
        hourlyCap: numberOption(body.hourlyCap ?? url.searchParams.get("hourlyCap")),
        perRunCap: numberOption(body.perRunCap ?? url.searchParams.get("perRunCap")),
        perAccountHourlyCap: numberOption(body.perAccountHourlyCap ?? url.searchParams.get("perAccountHourlyCap")),
        minSpacingMinutes: numberOption(body.minSpacingMinutes ?? url.searchParams.get("minSpacingMinutes")),
        channelCooldownMinutes: numberOption(body.channelCooldownMinutes ?? url.searchParams.get("channelCooldownMinutes")),
        maxVideoAgeHours: numberOption(body.maxVideoAgeHours ?? url.searchParams.get("maxVideoAgeHours")),
        candidateLimit: numberOption(body.candidateLimit ?? url.searchParams.get("candidateLimit")),
      }),
    { timeoutMs: 55_000 }
  );

  return NextResponse.json({
    ok: dispatch.ok,
    criticalPath: "social-discovery-comment-dispatch",
    dispatch,
  });
}

export async function GET(request: Request) {
  return handleDispatch(request);
}

export async function POST(request: Request) {
  return handleDispatch(request);
}
