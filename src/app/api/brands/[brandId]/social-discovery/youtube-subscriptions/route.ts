import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import {
  listBrandYouTubeSubscriptions,
  subscribeBrandToYouTubeChannel,
  unsubscribeBrandFromYouTubeChannel,
} from "@/lib/social-discovery-youtube-subscriptions";
import { YouTubeApiError } from "@/lib/youtube";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function booleanFlag(value: unknown, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

async function requestJson(request: Request) {
  if (request.method === "GET") return {};
  try {
    return asRecord(await request.json());
  } catch {
    return {};
  }
}

export async function GET(_request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const subscriptions = await listBrandYouTubeSubscriptions(brandId);
  return NextResponse.json({
    ok: true,
    brandId,
    brandName: brand.name,
    subscriptions,
  });
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  try {
    const body = await requestJson(request);
    const channelId = String(body.channelId ?? body.channel_id ?? "").trim();
    const accountId = String(body.accountId ?? body.account_id ?? "").trim();
    const autoComment = booleanFlag(body.autoComment ?? body.auto_comment, true);
    const leaseSeconds = Number(body.leaseSeconds ?? body.lease_seconds ?? 0) || 0;

    const result = await subscribeBrandToYouTubeChannel({
      brandId,
      channelId,
      accountId: accountId || undefined,
      autoComment,
      leaseSeconds: leaseSeconds > 0 ? leaseSeconds : undefined,
    });

    return NextResponse.json({
      ok: true,
      brandId,
      brandName: brand.name,
      channelId,
      accountId,
      autoComment,
      record: result.record,
      subscriptions: result.subscriptions,
      subscription: result.subscription,
    });
  } catch (error) {
    if (error instanceof YouTubeApiError) {
      return NextResponse.json(
        {
          error: error.message,
          type: error.type,
          details: error.details,
        },
        { status: error.status || 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to request YouTube subscription" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  try {
    const body = await requestJson(request);
    const url = new URL(request.url);
    const channelId = String(
      body.channelId ??
        body.channel_id ??
        url.searchParams.get("channelId") ??
        url.searchParams.get("channel_id") ??
        ""
    ).trim();

    const result = await unsubscribeBrandFromYouTubeChannel({
      brandId,
      channelId,
    });

    return NextResponse.json({
      ok: true,
      brandId,
      brandName: brand.name,
      channelId,
      subscriptions: result.subscriptions,
    });
  } catch (error) {
    if (error instanceof YouTubeApiError) {
      return NextResponse.json(
        {
          error: error.message,
          type: error.type,
          details: error.details,
        },
        { status: error.status || 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove YouTube subscription" },
      { status: 500 }
    );
  }
}
