import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { enrichSocialPostsWithAccountRouting } from "@/lib/social-account-routing";
import { getSocialDiscoveryPost, saveSocialDiscoveryPosts } from "@/lib/social-discovery-data";
import { refreshSocialDiscoveryCommentDraft } from "@/lib/social-discovery";
import type { SocialDiscoveryPost } from "@/lib/social-discovery-types";
import { getYouTubeVideoTranscript } from "@/lib/youtube";

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

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fallbackPostFromBody(value: unknown, brandId: string): SocialDiscoveryPost | null {
  const row = asRecord(value);
  const id = String(row.id ?? "").trim();
  const platform = String(row.platform ?? "").trim();
  const externalId = String(row.externalId ?? row.external_id ?? "").trim();
  const url = String(row.url ?? "").trim();
  const title = String(row.title ?? "").trim();
  if (!id || !platform || !externalId || !url || !title) return null;
  if (String(row.brandId ?? row.brand_id ?? "").trim() !== brandId) return null;
  if (platform !== "youtube") return null;

  const now = new Date().toISOString();
  return {
    id,
    brandId,
    platform: "youtube",
    provider: "youtube-data-api",
    externalId,
    url,
    title,
    body: String(row.body ?? "").trim(),
    author: String(row.author ?? "").trim(),
    community: String(row.community ?? "").trim(),
    query: String(row.query ?? "").trim(),
    matchedTerms: stringArray(row.matchedTerms ?? row.matched_terms),
    intent: "noise",
    relevanceScore: Math.max(0, Math.min(100, numberValue(row.relevanceScore ?? row.relevance_score))),
    risingScore: Math.max(0, Math.min(100, numberValue(row.risingScore ?? row.rising_score))),
    engagementScore: Math.max(0, numberValue(row.engagementScore ?? row.engagement_score)),
    providerRank: Math.max(0, numberValue(row.providerRank ?? row.provider_rank)),
    status: "new",
    interactionPlan: {
      headline: "Draft a comment for this video",
      targetStrength: "target",
      commentPosture: "method_first",
      mentionPolicy: "mention_only_if_asked",
      actors: [
        {
          role: "operator",
          job: "Write one short native YouTube comment after review.",
        },
      ],
      sequence: [],
      assetNeeded: "none",
      riskNotes: [],
    },
    raw: asRecord(row.raw),
    postedAt: String(row.postedAt ?? row.posted_at ?? now).trim() || now,
    discoveredAt: String(row.discoveredAt ?? row.discovered_at ?? now).trim() || now,
    updatedAt: now,
  };
}

async function withYouTubeTranscript(post: SocialDiscoveryPost): Promise<SocialDiscoveryPost> {
  if (post.platform !== "youtube") return post;
  const raw = asRecord(post.raw);
  const youtube = asRecord(raw.youtube);
  const transcript = asRecord(youtube.videoTranscript);
  if (String(transcript.text ?? "").trim()) return post;

  const videoId = String(youtube.videoId ?? post.externalId ?? "").trim();
  if (!videoId) return post;

  try {
    const nextTranscript = await getYouTubeVideoTranscript({ videoId });
    return {
      ...post,
      raw: {
        ...raw,
        youtube: {
          ...youtube,
          videoTranscript: nextTranscript
            ? {
                ...nextTranscript,
                status: "available",
              }
            : {
                status: "unavailable",
                fetchedAt: new Date().toISOString(),
              },
        },
      },
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return post;
  }
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

    let post = await getSocialDiscoveryPost({ id: postId, brandId });
    if (!post) {
      const fallbackPost = fallbackPostFromBody(body.post, brandId);
      const [savedFallbackPost] = fallbackPost ? await saveSocialDiscoveryPosts([fallbackPost]) : [];
      post = savedFallbackPost ?? fallbackPost ?? null;
    }
    if (!post) {
      return NextResponse.json({ error: "post not found" }, { status: 404 });
    }
    if (post.platform === "youtube" && youtubeSubscriberCount(post) <= MIN_YOUTUBE_DRAFT_SUBSCRIBERS) {
      return NextResponse.json(
        { error: "Channel needs over 1,000 subscribers before drafting." },
        { status: 400 }
      );
    }

    const postWithTranscript = await withYouTubeTranscript(post);
    const refreshedPost = await refreshSocialDiscoveryCommentDraft({
      brand,
      post: postWithTranscript,
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
