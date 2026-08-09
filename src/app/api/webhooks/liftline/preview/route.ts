import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { getOutreachAccountSecrets, type OutreachAccountSecrets } from "@/lib/outreach-data";
import { tapInPreviewCampaignBrand } from "@/lib/social-discovery-campaign-context";
import { discoverYouTubeSearchPostsForBrand } from "@/lib/social-discovery-youtube-search";
import {
  DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY,
  normalizeSocialDiscoveryYouTubePolicy,
} from "@/lib/social-discovery-youtube-policy";
import { generateTapInThreadPreview } from "@/lib/tapinsocial-preview";
import { getTapInWorkspaceForUser } from "@/lib/tapinsocial-auth";
import { hasYouTubeOAuthCredentials } from "@/lib/youtube";

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

async function workspaceYouTubeSearchSecrets(workspace: Awaited<ReturnType<typeof getTapInWorkspaceForUser>>) {
  if (!workspace) return null;
  const candidateIds = Array.from(new Set([
    workspace.youtubeAccountId,
    ...workspace.youtubeAccounts.map((account) => account.accountId),
    workspace.youtubeSeedAccountId,
  ].filter(Boolean)));

  for (const accountId of candidateIds) {
    const secrets = await getOutreachAccountSecrets(accountId).catch(() => null);
    if (secrets && hasYouTubeOAuthCredentials(secrets)) {
      return secrets satisfies OutreachAccountSecrets;
    }
  }
  return null;
}

function noMatchResponse(discovery: Awaited<ReturnType<typeof discoverYouTubeSearchPostsForBrand>>) {
  const { found, eligible } = discovery.summary;
  const everyQueryFailed = discovery.queryStats.length > 0 &&
    discovery.queryStats.every((query) => Boolean(query.error));

  if (everyQueryFailed) {
    console.error("[tapin-preview] YouTube discovery failed", JSON.stringify({
      queries: discovery.queries,
      errors: discovery.errors.map((error) => ({ query: error.query, message: error.message })),
    }));
    return NextResponse.json(
      {
        error: "YouTube search could not run. Reconnect a YouTube account, then try again.",
        errorCode: "youtube_search_failed",
      },
      { status: 502 }
    );
  }

  if (found === 0) {
    return NextResponse.json(
      { error: "YouTube found no recent videos for these topics. Increase video age or broaden the topics." },
      { status: 422 }
    );
  }
  if (eligible === 0) {
    return NextResponse.json(
      { error: `YouTube found ${found} recent video${found === 1 ? "" : "s"}, but none met the minimum subscriber count. Lower that minimum and try again.` },
      { status: 422 }
    );
  }
  return NextResponse.json(
    { error: `YouTube found ${found} recent video${found === 1 ? "" : "s"}; ${eligible} passed the account rules, but none met relevance and momentum. Choose Broad relevance or Any momentum.` },
    { status: 422 }
  );
}

function everyYouTubeQueryFailed(
  discovery: Awaited<ReturnType<typeof discoverYouTubeSearchPostsForBrand>>
) {
  return discovery.queryStats.length > 0 &&
    discovery.queryStats.every((query) => Boolean(query.error));
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
  const campaignName = requiredText(body.campaignName, 240);
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
    const campaignBrand = tapInPreviewCampaignBrand(brand, { campaignName, targets });
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
      const youtubeSearchSecrets = await workspaceYouTubeSearchSecrets(workspace);
      const discoveryInput = {
        brand: campaignBrand,
        // A YouTube search costs 100 quota units. One representative target is
        // enough for a preview; live discovery still rotates the full target set.
        queries: targets.slice(0, 1),
        maxResults: 8,
        secrets: youtubeSearchSecrets ?? undefined,
        policy: youtubeDiscoveryPolicy,
      };
      let discovery = await discoverYouTubeSearchPostsForBrand({
        ...discoveryInput,
        preferApiKey: true,
      });
      if (youtubeSearchSecrets && everyYouTubeQueryFailed(discovery)) {
        discovery = await discoverYouTubeSearchPostsForBrand({
          ...discoveryInput,
          preferApiKey: false,
        });
      }
      const matchedVideo = discovery.posts[0];
      if (!matchedVideo) {
        return noMatchResponse(discovery);
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
      brandName: campaignBrand.name,
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
