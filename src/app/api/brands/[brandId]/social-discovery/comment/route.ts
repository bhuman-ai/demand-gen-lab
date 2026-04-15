import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import {
  deliverSocialDiscoveryComment,
  isPlatformDeliveryError,
  SocialCommentDeliveryError,
} from "@/lib/social-discovery-comment-delivery";
import { UnipileApiError } from "@/lib/unipile";
import { YouTubeApiError } from "@/lib/youtube";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const postId = String(body.postId ?? body.post_id ?? "").trim();
    const accountId = String(body.accountId ?? body.account_id ?? "").trim();
    const text = String(body.text ?? "").trim();
    const commentId = String(body.commentId ?? body.comment_id ?? "").trim();

    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    if (text.length > 1250) {
      return NextResponse.json({ error: "text must be 1250 characters or less" }, { status: 400 });
    }

    const delivery = await deliverSocialDiscoveryComment({
      brand,
      brandId,
      postId,
      text,
      requestedAccountId: accountId || undefined,
      requestedCommentId: commentId || undefined,
    });

    return NextResponse.json({
      ok: true,
      post: delivery.post,
      promotionDraft: delivery.promotionDraft,
      promotionPurchase: delivery.promotionPurchase,
      account: delivery.account,
      result: delivery.result,
    });
  } catch (error) {
    if (
      error instanceof UnipileApiError ||
      error instanceof YouTubeApiError ||
      error instanceof SocialCommentDeliveryError ||
      isPlatformDeliveryError(error)
    ) {
      return NextResponse.json(
        {
          error: error.message,
          type:
            error instanceof UnipileApiError || error instanceof YouTubeApiError
              ? error.type
              : "",
          details:
            error instanceof UnipileApiError ||
            error instanceof YouTubeApiError ||
            error instanceof SocialCommentDeliveryError
              ? error.details
              : {},
        },
        { status: error.status || 500 }
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to send social comment",
      },
      { status: 500 }
    );
  }
}
