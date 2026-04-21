import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { enrichSocialPostsWithAccountRouting } from "@/lib/social-account-routing";
import { getSocialDiscoveryPost, saveSocialDiscoveryPosts } from "@/lib/social-discovery-data";
import { refreshSocialDiscoveryCommentDraft } from "@/lib/social-discovery";

const MIN_YOUTUBE_DRAFT_SUBSCRIBERS = 1000;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function youtubeSubscriberCount(post: { raw: Record<string, unknown>; platform: string }) {
  if (post.platform !== "youtube") return Number.POSITIVE_INFINITY;
  const youtube = asRecord(asRecord(post.raw).youtube);
  const count = Number(youtube.subscriberCount ?? 0);
  return Number.isFinite(count) ? count : 0;
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
    const mode = String(body.mode ?? "").trim().toLowerCase() === "thread" ? "thread" : "solo";
    if (!postId) {
      return NextResponse.json({ error: "postId is required" }, { status: 400 });
    }

    const post = await getSocialDiscoveryPost({ id: postId, brandId });
    if (!post) {
      return NextResponse.json({ error: "post not found" }, { status: 404 });
    }
    if (post.platform === "youtube" && youtubeSubscriberCount(post) <= MIN_YOUTUBE_DRAFT_SUBSCRIBERS) {
      return NextResponse.json(
        { error: "Channel needs over 1,000 subscribers before drafting." },
        { status: 400 }
      );
    }

    const refreshedPost = await refreshSocialDiscoveryCommentDraft({
      brand,
      post,
      force: true,
      mode,
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
