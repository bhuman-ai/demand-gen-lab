import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import {
  deliverSocialDiscoveryComment,
  isPlatformDeliveryError,
  SocialCommentDeliveryError,
} from "@/lib/social-discovery-comment-delivery";
import { getTapInWorkspaceForUser } from "@/lib/tapinsocial-auth";

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

export async function POST(request: Request) {
  const expected = expectedSecret();
  if (!expected || suppliedSecret(request) !== expected) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const userId = String(body.userId ?? "").trim();
  const brandId = String(body.brandId ?? "").trim();
  const accountId = String(body.accountId ?? "").trim();
  const postId = String(body.postId ?? "").trim();
  const commentId = String(body.commentId ?? "").trim();
  const text = String(body.text ?? "").trim();
  const workspace = await getTapInWorkspaceForUser(userId);

  if (!workspace || workspace.brandId !== brandId || workspace.youtubeAccountId !== accountId) {
    return NextResponse.json(
      { error: "TapIn workspace ownership could not be verified." },
      { status: 403 }
    );
  }
  if (!postId || !text) {
    return NextResponse.json({ error: "Post and comment text are required." }, { status: 400 });
  }
  if (text.length > 1250) {
    return NextResponse.json({ error: "Comment must be 1250 characters or less." }, { status: 400 });
  }

  const brand = await getBrandById(brandId);
  if (!brand) return NextResponse.json({ error: "TapIn brand was not found." }, { status: 404 });

  try {
    const delivery = await deliverSocialDiscoveryComment({
      brand,
      brandId,
      postId,
      text,
      requestedAccountId: accountId,
      requestedCommentId: commentId || undefined,
    });
    return NextResponse.json({
      ok: true,
      post: delivery.post,
      result: delivery.result,
      account: delivery.account,
    });
  } catch (error) {
    if (error instanceof SocialCommentDeliveryError || isPlatformDeliveryError(error)) {
      return NextResponse.json(
        {
          error: error.message,
          details: "details" in error ? error.details : undefined,
        },
        { status: "status" in error ? Number(error.status) || 500 : 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TapIn comment failed." },
      { status: 500 }
    );
  }
}
