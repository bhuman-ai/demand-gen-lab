import { NextResponse } from "next/server";
import { createBrand, getBrandById, listBrands, updateBrand } from "@/lib/factory-data";
import { getTapInWorkspaceForUser, saveTapInYouTubeRoles } from "@/lib/tapinsocial-auth";
import { clearSocialDiscoveryPendingRepliesForBrand } from "@/lib/social-discovery-data";
import { runSocialDiscoveryYouTubeRefillTick } from "@/lib/social-discovery-youtube-refill";
import {
  findTapInCampaignRuntimeBrand,
  tapInCampaignRuntimeNotes,
} from "@/lib/tapinsocial-campaign-runtime";
import {
  DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY,
  normalizeSocialDiscoveryYouTubePolicy,
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
  openingCommentPrompt: string;
  delayedReplyPrompt: string;
}) {
  return [
    "TapIn campaign instructions:",
    "Opening comment instructions:",
    input.openingCommentPrompt,
    input.campaignType === "thread"
      ? "Delayed reply instructions:"
      : "Campaign type: Comment only.",
    input.campaignType === "thread" ? input.delayedReplyPrompt : "",
    "Runtime context:",
    "- TapIn supplies the matched YouTube video title and description to the generator automatically.",
    "- Opening comment instructions apply only to commentDraft.",
    "- Delayed reply instructions apply only to replyDraft.",
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
  const prompts = asRecord(autopilot.prompts);
  const commentVoice = asRecord(autopilot.commentVoice);
  const brandMention = asRecord(autopilot.brandMention);
  const youtubeRoles = asRecord(autopilot.youtubeRoles);
  const youtubeDiscovery = asRecord(autopilot.youtubeDiscovery ?? setup.youtubeDiscoveryPolicy);
  const account = asRecord(setup.account);
  const connections = asRecord(account.connections);
  const brandId = String(backend.brandId ?? "").trim();
  const setupId = String(setup.setupId ?? "").trim();
  const authUserId = String(tenant.userId ?? "").trim();

  if (!brandId || !authUserId || !setupId) {
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
  const active = setup.status !== "paused";
  const youtubeConnected = connections.youtube === true;
  const youtubePolicy = normalizeSocialDiscoveryYouTubePolicy(
    youtubeDiscovery,
    DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY
  ) ?? DEFAULT_SOCIAL_DISCOVERY_YOUTUBE_POLICY;
  const campaignType = youtubeRoles.campaignType === "comment" ? "comment" : "thread";
  const requestedBrandName = String(brandMention.exactBrandName ?? setup.campaignName ?? brand.name).trim() || brand.name;
  const positioning = String(brandMention.positioning ?? setup.brandSummary ?? targets.join(", ")).trim();
  const runtimeNotes = tapInCampaignRuntimeNotes({ workspaceBrandId: brandId, campaignId: setupId });
  let campaignBrand = findTapInCampaignRuntimeBrand(await listBrands(), {
    workspaceBrandId: brandId,
    campaignId: setupId,
  });
  if (!campaignBrand) {
    campaignBrand = await createBrand({
      name: requestedBrandName,
      website: "",
      tone: String(commentVoice.preset ?? setup.voice ?? "Warm").trim(),
      notes: runtimeNotes,
      product: positioning,
      socialDiscoveryPlatforms: platforms.length ? platforms : ["youtube"],
      socialDiscoveryQueries: targets,
      socialDiscoveryYouTubeAutoCommentEnabled: false,
      socialDiscoveryYouTubePolicy: youtubePolicy,
      targetMarkets: targets,
    });
  }
  // Pending replies belong to the campaign configuration that created them.
  // Clear them on every activation so a newly selected brand can never inherit
  // a scheduled reply from the previous campaign.
  const cancelledReplyCount = await clearSocialDiscoveryPendingRepliesForBrand(campaignBrand.id);

  if (active && youtubeConnected && platforms.includes("youtube")) {
    try {
      await saveTapInYouTubeRoles({
        workspace,
        assignmentBrandId: campaignBrand.id,
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

  const updated = await updateBrand(campaignBrand.id, {
    name: requestedBrandName,
    website: "",
    tone: String(commentVoice.preset ?? setup.voice ?? "Warm").trim(),
    notes: runtimeNotes,
    product: positioning,
    socialDiscoveryCommentPrompt: contextualCommentPrompt({
      campaignType,
      openingCommentPrompt: String(
        prompts.openingComment ?? setup.commentPrompt ?? ""
      ).trim(),
      delayedReplyPrompt: String(
        prompts.delayedReply ?? setup.replyPrompt ?? ""
      ).trim(),
    }),
    socialDiscoveryPlatforms: platforms.length ? platforms : ["youtube"],
    socialDiscoveryQueries: targets,
    socialDiscoverySearchStrategy: null,
    socialDiscoveryYouTubePolicy: youtubePolicy,
    socialDiscoveryYouTubeAutoCommentEnabled:
      active && youtubeConnected && platforms.includes("youtube"),
    targetMarkets: targets,
  });

  if (!updated) {
    return NextResponse.json({ ok: false, message: "Campaign could not be saved." }, { status: 500 });
  }

  const firstScan = active && youtubeConnected && platforms.includes("youtube")
    ? await runSocialDiscoveryYouTubeRefillTick({
        brandIds: [updated.id],
        scanAllBrands: false,
        brandLimit: 1,
        maxQueries: 4,
        limitPerQuery: 5,
        preferCampaignQueries: true,
      }).catch(() => null)
    : null;
  const firstScanResult = firstScan?.results?.[0];

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
        detail: firstScanResult
          ? `${firstScanResult.found} found / ${firstScanResult.saved} ready from the first scan`
          : targets.slice(0, 3).join(", ") || "Campaign targets saved",
        time: "Now",
      },
      {
        label: "Reply schedule",
        detail: campaignType === "comment"
          ? `${cancelledReplyCount} stale ${cancelledReplyCount === 1 ? "reply" : "replies"} cancelled`
          : `${cancelledReplyCount} stale ${cancelledReplyCount === 1 ? "reply" : "replies"} cancelled; new replies use another account 1–6 hours later`,
        time: "Ready",
      },
      {
        label: "Prompt control",
        detail: "Opening and reply copy follows the prompts you wrote",
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
