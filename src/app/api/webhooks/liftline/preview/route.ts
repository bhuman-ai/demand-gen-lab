import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { discoverYouTubeSearchPostsForBrand } from "@/lib/social-discovery-youtube-search";
import {
  DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY,
  normalizeSocialDiscoveryYouTubePolicy,
} from "@/lib/social-discovery-youtube-policy";
import { generateTapInThreadPreview } from "@/lib/tapinsocial-preview";
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

function requiredText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function strings(value: unknown, limit = 12) {
  const values = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[,\n]/);
  return Array.from(
    new Set(values.map((entry) => requiredText(entry, 160)).filter(Boolean))
  ).slice(0, limit);
}

export async function POST(request: Request) {
  const expected = expectedSecret();
  if (!expected || suppliedSecret(request) !== expected) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const userId = requiredText(body.userId, 120);
  const brandId = requiredText(body.brandId, 120);
  const campaignType = body.campaignType === "comment" ? "comment" : "thread";
  const openingPrompt = requiredText(body.openingPrompt, 2000);
  const replyPrompt = requiredText(body.replyPrompt, 2000);
  const targets = strings(body.targets);
  const videoTitle = requiredText(body.videoTitle, 400);
  const videoDescription = requiredText(body.videoDescription, 4000);
  if (!userId || !brandId || !openingPrompt || (campaignType === "thread" && !replyPrompt) || ((!videoTitle || !videoDescription) && !targets.length)) {
    return NextResponse.json(
      { error: campaignType === "thread" ? "Opening prompt, reply prompt, and campaign targeting are required." : "Opening prompt and campaign targeting are required." },
      { status: 400 }
    );
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

  try {
    let video = {
      title: videoTitle,
      description: videoDescription,
      url: requiredText(body.videoUrl, 1000),
      matchedTarget: "",
    };

    if (!video.title || !video.description) {
      const youtubeDiscoveryPolicy = normalizeSocialDiscoveryYouTubePolicy(
        body.youtubeDiscoveryPolicy,
        DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY
      ) ?? DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY;
      const discovery = await discoverYouTubeSearchPostsForBrand({
        brand,
        queries: targets.slice(0, 4),
        maxResults: 8,
        preferApiKey: true,
        policy: youtubeDiscoveryPolicy,
      });
      const matchedVideo = discovery.posts[0];
      if (!matchedVideo) {
        return NextResponse.json(
          {
            error: "No YouTube videos matched this campaign’s targeting and video rules. Try broader targets or loosen the filters.",
          },
          { status: 422 }
        );
      }
      video = {
        title: requiredText(matchedVideo.title, 400),
        description:
          requiredText(matchedVideo.body, 4000) ||
          `YouTube video matched the campaign target “${requiredText(matchedVideo.query, 160)}”.`,
        url: requiredText(matchedVideo.url, 1000),
        matchedTarget: requiredText(matchedVideo.query, 160),
      };
    }

    const preview = await generateTapInThreadPreview({
      campaignType,
      brandName: brand.name,
      openingPrompt,
      replyPrompt,
      videoTitle: video.title,
      videoDescription: video.description,
    });
    return NextResponse.json({ ok: true, preview, video });
  } catch {
    return NextResponse.json(
      { error: "Preview generation is unavailable right now. Try again." },
      { status: 502 }
    );
  }
}
