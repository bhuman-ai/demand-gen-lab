import { NextResponse } from "next/server";
import { getBrandById, updateBrand } from "@/lib/factory-data";
import { getTapInWorkspaceForUser, saveTapInYouTubeRoles } from "@/lib/tapinsocial-auth";
import { campaignBrandName } from "@/lib/social-discovery-campaign-context";
import { clearSocialDiscoveryPendingRepliesForBrand } from "@/lib/social-discovery-data";
import {
  DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY,
  normalizeSocialDiscoveryYouTubePolicy,
  youtubePolicyPromptLines,
  type SocialDiscoveryYouTubePolicy,
} from "@/lib/social-discovery-youtube-policy";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function expectedSecret() {
  return (
    String(process.env.LIFTLINE_AUTOPILOT_WEBHOOK_SECRET ?? "").trim() ||
    String(process.env.LIFTLINE_WEBHOOK_SECRET ?? "").trim()
  );
}

function suppliedSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return (
    String(request.headers.get("x-liftline-secret") ?? "").trim() ||
    authorization.replace(/^Bearer\s+/i, "").trim()
  );
}

function strings(value: unknown, limit = 12) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((entry) => String(entry ?? "").trim()).filter(Boolean))
  ).slice(0, limit);
}

function contextualCommentPrompt(input: {
  campaignType: "comment" | "thread";
  brandName: string;
  positioning: string;
  voice: string;
  voiceSample: string;
  openingCommentPrompt: string;
  delayedReplyPrompt: string;
  maximumSharePercent: number;
  youtubePolicy: SocialDiscoveryYouTubePolicy;
}) {
  return [
    "Write a short, platform-native comment flow that is genuinely useful to the exact conversation.",
    "The opening comment must work on its own even if no reply is posted.",
    "Brand name: " + input.brandName,
    "Brand positioning: " + input.positioning,
    "Voice preset: " + input.voice,
    "Voice example: " + input.voiceSample,
    "Opening comment instructions:",
    input.openingCommentPrompt,
    input.campaignType === "thread"
      ? "Delayed reply instructions:"
      : "Campaign type: Comment only. Do not generate or schedule a reply.",
    input.campaignType === "thread" ? input.delayedReplyPrompt : "",
    "Runtime context:",
    "- TapIn supplies the matched YouTube video title and description to the generator automatically.",
    "- Opening comment instructions apply only to commentDraft.",
    "- Delayed reply instructions apply only to replyDraft.",
    "Contextual mention policy:",
    "- Mention the exact brand only when heuristic_mention_policy is possible_soft_mention and the brand directly helps the answer.",
    "- Keep brand mentions at or below " + input.maximumSharePercent + "% of qualified comments across the campaign.",
    "- If the mention would feel forced, promotional, repetitive, or unsupported, write a useful no-mention comment or return shouldComment=false.",
    "- Never add a link unless the person explicitly asks for one.",
    "- Never call the comment a backlink or promise search-ranking impact.",
    "- Never fake personal experience, customer status, or product results.",
    "- Disclose affiliation whenever the wording could otherwise imply an independent recommendation.",
    "- When the brand appears, mention it exactly once and keep it incidental.",
    ...youtubePolicyPromptLines(input.youtubePolicy),
  ].join("\n");
}

export async function POST(request: Request) {
  const expected = expectedSecret();
  if (!expected || suppliedSecret(request) !== expected) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const setup = asRecord(body.setup);
  const autopilot = asRecord(body.autopilot);
  const backend = asRecord(body.backend);
  const tenant = asRecord(setup.tenant);
  const commentVoice = asRecord(autopilot.commentVoice);
  const prompts = asRecord(autopilot.prompts);
  const youtubeRoles = asRecord(autopilot.youtubeRoles);
  const youtubeDiscovery = asRecord(autopilot.youtubeDiscovery ?? setup.youtubeDiscoveryPolicy);
  const brandMention = asRecord(autopilot.brandMention);
  const account = asRecord(setup.account);
  const connections = asRecord(account.connections);
  const brandId = String(backend.brandId ?? "").trim();
  const setupId = String(setup.setupId ?? "").trim();
  const authUserId = String(tenant.userId ?? "").trim();

  if (!brandId || !authUserId) {
    return NextResponse.json(
      { ok: false, message: "Authenticated TapIn workspace is required." },
      { status: 400 }
    );
  }

  const workspace = await getTapInWorkspaceForUser(authUserId);
  if (!workspace || workspace.brandId !== brandId || String(tenant.brandId ?? "").trim() !== brandId) {
    return NextResponse.json(
      { ok: false, message: "TapIn workspace ownership could not be verified." },
      { status: 403 }
    );
  }

  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ ok: false, message: "Backend brand was not found." }, { status: 404 });
  }

  const targets = strings(autopilot.targets ?? setup.targets);
  const platforms = strings(autopilot.platforms ?? setup.platforms).filter(
    (platform) => platform === "instagram" || platform === "youtube"
  );
  const activeCampaignName = campaignBrandName(String(setup.campaignName ?? ""));
  const requestedBrandName =
    activeCampaignName ||
    String(brandMention.exactBrandName ?? tenant.brandName ?? "").trim() ||
    brand.name;
  const positioning = activeCampaignName
    ? targets.join(", ") || activeCampaignName
    : String(brandMention.positioning ?? setup.brandSummary ?? "").trim();
  const maximumSharePercent = Math.min(
    50,
    Math.max(10, Number(brandMention.maximumSharePercent) || 35)
  );
  const active = setup.status !== "paused";
  const youtubeConnected = connections.youtube === true;
  const youtubePolicy = normalizeSocialDiscoveryYouTubePolicy(
    youtubeDiscovery,
    DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY
  ) ?? DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY;
  const campaignType = youtubeRoles.campaignType === "comment" ? "comment" : "thread";
  const cancelledReplyCount = campaignType === "comment"
    ? await clearSocialDiscoveryPendingRepliesForBrand(brandId)
    : 0;

  if (active && youtubeConnected && platforms.includes("youtube")) {
    try {
      await saveTapInYouTubeRoles({
        workspace,
        campaignType,
        accountIds: strings(youtubeRoles.accountIds, 50),
        openingAccountIds: strings(youtubeRoles.openingAccountIds, 50),
        replyAccountIds: strings(youtubeRoles.replyAccountIds, 50),
        openingAccountId: String(youtubeRoles.openingAccountId ?? "").trim(),
        replyAccountId: String(youtubeRoles.replyAccountId ?? "").trim(),
      });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          message: error instanceof Error ? error.message : "YouTube channel roles could not be saved.",
        },
        { status: 400 }
      );
    }
  }

  const updated = await updateBrand(brandId, {
    socialDiscoveryCommentPrompt: contextualCommentPrompt({
      campaignType,
      brandName: requestedBrandName,
      positioning,
      voice: String(commentVoice.preset ?? setup.voice ?? "Warm").trim(),
      voiceSample: String(commentVoice.sample ?? setup.voiceSample ?? "").trim(),
      openingCommentPrompt: String(
        prompts.openingComment ?? setup.commentPrompt ??
          "Write a short, natural comment that reacts to one specific point in the video."
      ).trim(),
      delayedReplyPrompt: String(
        prompts.delayedReply ?? setup.replyPrompt ??
          "Reply directly to the opening comment with a concise, helpful answer."
      ).trim(),
      maximumSharePercent,
      youtubePolicy,
    }),
    socialDiscoveryPlatforms: platforms.length ? platforms : ["youtube"],
    socialDiscoveryQueries: targets,
    socialDiscoverySearchStrategy: null,
    socialDiscoveryYouTubePolicy: youtubePolicy,
    socialDiscoveryYouTubeAutoCommentEnabled:
      active && youtubeConnected && platforms.includes("youtube"),
  });

  if (!updated) {
    return NextResponse.json({ ok: false, message: "Campaign could not be saved." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    setupId,
    mode: "webhook",
    bridgeStatus: "accepted",
    message: youtubeConnected
      ? "Brand-mention campaign accepted."
      : "Campaign saved. Connect YouTube before automatic posting starts.",
    backendBrandId: updated.id,
    proof: [
      {
        label: "Watching relevant conversations",
        detail: targets.slice(0, 3).join(", ") || "Campaign targets saved",
        time: "Now",
      },
      {
        label: "Reply schedule",
        detail: campaignType === "comment"
          ? `${cancelledReplyCount} stale ${cancelledReplyCount === 1 ? "reply" : "replies"} cancelled`
          : "Replies use a different account 1–6 hours later",
        time: "Ready",
      },
      {
        label: "Contextual mention policy",
        detail: "Useful first / mention at most " + maximumSharePercent + "% / skip when unnatural",
        time: "Ready",
      },
      {
        label: "Video rules",
        detail: `${youtubePolicy.minSubscriberCount.toLocaleString()}+ subscribers / last ${youtubePolicy.maxVideoAgeHours} hours / ${youtubePolicy.relevanceMode} match`,
        time: "Ready",
      },
    ],
  });
}
