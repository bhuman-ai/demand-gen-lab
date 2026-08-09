import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import {
  listSocialDiscoveryCommentedPostsSince,
  listSocialDiscoveryPostsWithPendingReplies,
} from "@/lib/social-discovery-data";
import { buildTapInActivitySnapshot } from "@/lib/tapinsocial-activity";
import { getTapInWorkspaceForUser } from "@/lib/tapinsocial-auth";
import { getTapInRunnerBrandState } from "@/lib/tapinsocial-runner";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function expectedSecret() {
  return String(
    process.env.LIFTLINE_AUTOPILOT_WEBHOOK_SECRET ?? process.env.LIFTLINE_WEBHOOK_SECRET ?? ""
  ).trim();
}

function suppliedSecret(request: Request) {
  return (
    String(request.headers.get("x-liftline-secret") ?? "").trim() ||
    String(request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  );
}

function requiredText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function optionalPastIsoDate(value: unknown, now: Date) {
  const candidate = requiredText(value, 80);
  const timestamp = Date.parse(candidate);
  if (!candidate || !Number.isFinite(timestamp) || timestamp > now.getTime()) return "";
  return new Date(timestamp).toISOString();
}

export async function POST(request: Request) {
  const expected = expectedSecret();
  if (!expected || suppliedSecret(request) !== expected) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const userId = requiredText(body.userId, 120);
  const brandId = requiredText(body.brandId, 120);
  if (!userId || !brandId) {
    return NextResponse.json({ error: "TapIn workspace is required." }, { status: 400 });
  }

  const workspace = await getTapInWorkspaceForUser(userId);
  if (!workspace || workspace.brandId !== brandId) {
    return NextResponse.json(
      { error: "TapIn workspace ownership could not be verified." },
      { status: 403 }
    );
  }

  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "TapIn brand was not found." }, { status: 404 });
  }

  const now = new Date();
  const campaignStartedAt = optionalPastIsoDate(body.campaignStartedAt, now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const since = new Date(
    Math.max(thirtyDaysAgo.getTime(), Date.parse(campaignStartedAt) || 0)
  ).toISOString();
  try {
    const [commentedPosts, pendingReplyPosts, runner] = await Promise.all([
      listSocialDiscoveryCommentedPostsSince({
        brandId,
        platform: "youtube",
        since,
        limit: 1000,
      }),
      listSocialDiscoveryPostsWithPendingReplies({ brandIds: [brandId], limit: 500 }),
      getTapInRunnerBrandState(brandId),
    ]);
    const activity = buildTapInActivitySnapshot({
      enabled: brand.socialDiscoveryYouTubeAutoCommentEnabled && runner.live,
      commentedPosts,
      pendingReplyPosts,
      campaignStartedAt,
      now,
    });
    return NextResponse.json({ ok: true, activity, runner });
  } catch {
    return NextResponse.json(
      { error: "TapIn activity is unavailable right now. Try again." },
      { status: 502 }
    );
  }
}
