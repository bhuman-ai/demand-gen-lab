import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { enrichSocialPostsWithAccountRouting } from "@/lib/social-account-routing";
import { getSocialDiscoveryPost, saveSocialDiscoveryPosts } from "@/lib/social-discovery-data";
import { refreshSocialDiscoveryCommentDraft } from "@/lib/social-discovery";

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
    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 });
    }

    const post = await getSocialDiscoveryPost({ id: postId, brandId });
    if (!post) {
      return NextResponse.json({ error: "post not found" }, { status: 404 });
    }

    const refreshedPost = await refreshSocialDiscoveryCommentDraft({
      brand,
      post,
      force: true,
    });
    const [savedPost] = await saveSocialDiscoveryPosts([refreshedPost]);
    const [routedPost] = await enrichSocialPostsWithAccountRouting({
      brand,
      posts: [savedPost ?? refreshedPost],
    });

    return NextResponse.json({
      ok: true,
      post: routedPost ?? savedPost ?? refreshedPost,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate social comment draft",
      },
      { status: 500 }
    );
  }
}
