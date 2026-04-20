import { NextResponse } from "next/server";
import { isInternalCronAuthorized, runCronTask } from "@/lib/internal-cron";
import { runSocialDiscoveryDelayedReplyTick } from "@/lib/social-discovery-comment-delivery";
import { runSocialDiscoveryYouTubeSubscriptionRenewTick } from "@/lib/social-discovery-youtube-subscriptions-renew";

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

async function handleRenew(request: Request) {
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
  const limit = numberOption(body.limit ?? url.searchParams.get("limit"), 50, 1, 200);
  const replyLimit = numberOption(body.replyLimit ?? url.searchParams.get("replyLimit"), 50, 1, 200);
  const scanAllBrands =
    String(body.scanAllBrands ?? url.searchParams.get("scanAllBrands") ?? process.env.SOCIAL_DISCOVERY_SCAN_ALL_BRANDS)
      .trim()
      .toLowerCase() === "true";
  const dryRun = String(body.dryRun ?? url.searchParams.get("dryRun") ?? "")
    .trim()
    .toLowerCase() === "true";

  const renew = await runCronTask(
    "socialDiscoveryYouTubeSubscriptionRenew",
    () =>
      runSocialDiscoveryYouTubeSubscriptionRenewTick({
        brandIds,
        limit,
        scanAllBrands,
        dryRun,
      }),
    { timeoutMs: 55_000 }
  );
  const delayedReplies = await runCronTask(
    "socialDiscoveryDelayedReplies",
    () =>
      runSocialDiscoveryDelayedReplyTick({
        brandIds,
        limit: replyLimit,
        dryRun,
      }),
    { timeoutMs: 55_000 }
  );

  return NextResponse.json({
    ok: renew.ok && delayedReplies.ok,
    criticalPath: "social-discovery-youtube-maintenance",
    renew,
    delayedReplies,
  });
}

export async function GET(request: Request) {
  return handleRenew(request);
}

export async function POST(request: Request) {
  return handleRenew(request);
}
