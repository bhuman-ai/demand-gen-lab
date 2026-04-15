import { NextResponse } from "next/server";
import { createSocialDiscoveryRun, saveSocialDiscoveryPosts } from "@/lib/social-discovery-data";
import { deliverSocialDiscoveryComment, isPlatformDeliveryError, SocialCommentDeliveryError } from "@/lib/social-discovery-comment-delivery";
import { getBrandById } from "@/lib/factory-data";
import { buildSubscribedSocialDiscoveryPost } from "@/lib/social-discovery";
import {
  markBrandYouTubeSubscriptionVerified,
  recordBrandYouTubeSubscriptionWebhookActivity,
} from "@/lib/social-discovery-youtube-subscriptions";
import { parseYouTubeWebhookFeed, YouTubeApiError } from "@/lib/youtube";

function matchesWebhookToken(request: Request) {
  const expected = String(process.env.YOUTUBE_WEBSUB_TOKEN ?? process.env.AUTH_SESSION_SECRET ?? "").trim();
  if (!expected) return true;
  const url = new URL(request.url);
  return url.searchParams.get("token") === expected;
}

function booleanFlag(value: unknown, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function watchUrl(videoId: string) {
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", videoId);
  return url.toString();
}

function extractCommentDraft(post: ReturnType<typeof buildSubscribedSocialDiscoveryPost>) {
  const draft = post?.interactionPlan.sequence.find((step) => step.draft.trim())?.draft ?? "";
  const normalized = draft.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 1250);
}

export async function GET(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const url = new URL(request.url);

  if (!matchesWebhookToken(request)) {
    return NextResponse.json({ error: "invalid webhook token" }, { status: 401 });
  }

  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const mode = url.searchParams.get("hub.mode") ?? "";
  const topic = url.searchParams.get("hub.topic") ?? "";
  const expectedChannelId = url.searchParams.get("channelId")?.trim() ?? "";
  const leaseSeconds = Number(url.searchParams.get("hub.lease_seconds") ?? 0) || 0;
  if (!challenge) {
    return NextResponse.json({ ok: true, ignored: true, reason: "missing hub challenge" });
  }
  if (expectedChannelId && topic && !topic.includes(expectedChannelId)) {
    return NextResponse.json({ error: "topic channel mismatch" }, { status: 400 });
  }

  if (expectedChannelId) {
    await markBrandYouTubeSubscriptionVerified({
      brandId,
      channelId: expectedChannelId,
      leaseSeconds: leaseSeconds > 0 ? leaseSeconds : undefined,
      topicUrl: topic || undefined,
    }).catch(() => null);
  }

  return new Response(challenge, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Webhook-Mode": mode,
    },
  });
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  if (!matchesWebhookToken(request)) {
    return NextResponse.json({ error: "invalid webhook token" }, { status: 401 });
  }

  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  try {
    const url = new URL(request.url);
    const watchedChannelId = url.searchParams.get("channelId")?.trim() ?? "";
    const preferredAccountId = url.searchParams.get("accountId")?.trim() ?? "";
    const autoComment = booleanFlag(url.searchParams.get("autoComment"), false);
    const rawXml = await request.text();
    const entries = parseYouTubeWebhookFeed(rawXml);

    if (!entries.length) {
      return NextResponse.json({ ok: true, ignored: true, reason: "no upload entries in webhook payload" });
    }

    const processed = [];
    for (const entry of entries) {
      if (watchedChannelId && entry.channelId !== watchedChannelId) {
        processed.push({
          videoId: entry.videoId,
          channelId: entry.channelId,
          ignored: true,
          reason: "channel mismatch",
        });
        continue;
      }

      const post = buildSubscribedSocialDiscoveryPost({
        id: `socialpost_${brand.id}_${entry.videoId}`,
        brandId: brand.id,
        platform: "youtube",
        provider: "youtube-websub",
        externalId: entry.videoId,
        url: entry.url || watchUrl(entry.videoId),
        title: entry.title || `${entry.channelTitle || "YouTube"} uploaded a new video`,
        body: `${entry.channelTitle || entry.channelId} uploaded a new YouTube video.`,
        author: entry.channelTitle || entry.channelId,
        community: entry.channelTitle ? `channel/${entry.channelTitle}` : `channel/${entry.channelId}`,
        query: `channel:${entry.channelTitle || entry.channelId}`,
        engagementScore: 0,
        providerRank: 1,
        raw: {
          youtube: {
            videoId: entry.videoId,
            channelId: entry.channelId,
            channelTitle: entry.channelTitle,
            channelUrl: entry.channelUrl,
            title: entry.title,
            publishedAt: entry.publishedAt,
            updatedAt: entry.updatedAt,
          },
          youtubeWebhook: {
            videoId: entry.videoId,
            channelId: entry.channelId,
            channelTitle: entry.channelTitle,
            channelUrl: entry.channelUrl,
            rawXml: entry.rawXml,
          },
        },
        postedAt: entry.publishedAt || entry.updatedAt || new Date().toISOString(),
        discoveredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        brand,
      });

      const [savedPost] = await saveSocialDiscoveryPosts([post]);
      await createSocialDiscoveryRun({
        brandId: brand.id,
        provider: "youtube-websub",
        platforms: ["youtube"],
        queries: [`channel:${entry.channelId}`],
        postIds: savedPost ? [savedPost.id] : [],
        errorCount: 0,
        errors: [],
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });

      const commentDraft = autoComment ? extractCommentDraft(savedPost ?? post) : "";
      if (autoComment && commentDraft) {
        try {
          const delivery = await deliverSocialDiscoveryComment({
            brand,
            brandId: brand.id,
            postId: (savedPost ?? post).id,
            text: commentDraft,
            requestedAccountId: preferredAccountId || undefined,
          });
          await recordBrandYouTubeSubscriptionWebhookActivity({
            brandId: brand.id,
            channelId: entry.channelId,
            channelTitle: entry.channelTitle,
            videoId: entry.videoId,
            videoUrl: entry.url || watchUrl(entry.videoId),
            commentId: delivery.result.commentId,
            commentUrl: delivery.result.commentUrl,
          }).catch(() => null);
          processed.push({
            videoId: entry.videoId,
            channelId: entry.channelId,
            postId: delivery.post.id,
            saved: true,
            autoCommented: true,
            commentId: delivery.result.commentId,
            commentUrl: delivery.result.commentUrl,
            accountId: delivery.account.id,
          });
          continue;
        } catch (error) {
          if (isPlatformDeliveryError(error)) {
            await recordBrandYouTubeSubscriptionWebhookActivity({
              brandId: brand.id,
              channelId: entry.channelId,
              channelTitle: entry.channelTitle,
              videoId: entry.videoId,
              videoUrl: entry.url || watchUrl(entry.videoId),
              error: error.message,
            }).catch(() => null);
            processed.push({
              videoId: entry.videoId,
              channelId: entry.channelId,
              postId: (savedPost ?? post).id,
              saved: true,
              autoCommented: false,
              autoCommentError: error.message,
            });
            continue;
          }
          throw error;
        }
      }

      await recordBrandYouTubeSubscriptionWebhookActivity({
        brandId: brand.id,
        channelId: entry.channelId,
        channelTitle: entry.channelTitle,
        videoId: entry.videoId,
        videoUrl: entry.url || watchUrl(entry.videoId),
      }).catch(() => null);
      processed.push({
        videoId: entry.videoId,
        channelId: entry.channelId,
        postId: (savedPost ?? post).id,
        saved: true,
        autoCommented: false,
        reason: autoComment ? "no comment draft was generated for this upload" : "auto comment disabled",
      });
    }

    return NextResponse.json({
      ok: true,
      brandId: brand.id,
      brandName: brand.name,
      watchedChannelId,
      processed,
    });
  } catch (error) {
    if (error instanceof YouTubeApiError || error instanceof SocialCommentDeliveryError) {
      return NextResponse.json(
        {
          error: error.message,
          type: error instanceof YouTubeApiError ? error.type : "",
          details: error.details,
        },
        { status: error.status || 500 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process YouTube upload webhook" },
      { status: 500 }
    );
  }
}
