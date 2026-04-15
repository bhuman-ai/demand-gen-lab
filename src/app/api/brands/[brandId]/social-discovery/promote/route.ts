import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { getSocialDiscoveryPost, updateSocialDiscoveryPostPromotionDraft } from "@/lib/social-discovery-data";
import { buildSocialDiscoveryPromotionDraft } from "@/lib/social-discovery-promotion";

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

  const body = asRecord(await request.json().catch(() => ({})));
  const postId = String(body.postId ?? body.post_id ?? "").trim();
  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const post = await getSocialDiscoveryPost({ id: postId, brandId });
  if (!post) {
    return NextResponse.json({ error: "social discovery post not found" }, { status: 404 });
  }

  const promotionDraft = buildSocialDiscoveryPromotionDraft({ brand, post });
  const updatedPost = await updateSocialDiscoveryPostPromotionDraft({
    id: post.id,
    brandId,
    promotionDraft,
  });

  return NextResponse.json({
    ok: true,
    post: updatedPost ?? { ...post, promotionDraft },
    promotionDraft,
  });
}
