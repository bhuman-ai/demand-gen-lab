import { NextResponse } from "next/server";
import {
  hashTapInNetworkComment,
  settleClusterSeoDelivery,
  verifyClusterSeoDeliveryToken,
} from "@/lib/clusterseo-integration";
import { getOutreachAccount, getOutreachAccountSecrets } from "@/lib/outreach-data";
import {
  claimTapInNetworkDelivery,
  updateTapInNetworkDelivery,
  type TapInNetworkDelivery,
} from "@/lib/tapinsocial-network-data";
import { getTapInWorkspaceForUser, workspaceOwnsYouTubeAccount } from "@/lib/tapinsocial-auth";
import { buildYouTubeCommentUrl, sendYouTubeVideoComment } from "@/lib/youtube";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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

function settledPayload(delivery: TapInNetworkDelivery) {
  return {
    ok: true,
    alreadyProcessed: true,
    commentId: delivery.commentId,
    commentUrl: delivery.commentUrl,
    creditsAwarded: Number(delivery.settlement.creditsAwarded || 0),
    creditBalance: Number(delivery.settlement.creditBalance || 0),
  };
}

export async function POST(request: Request) {
  const expected = expectedSecret();
  if (!expected || suppliedSecret(request) !== expected) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const userId = String(body.userId || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim() || email.split("@")[0] || "TapIn member";
  const brandId = String(body.brandId || "").trim();
  const missionId = String(body.missionId || "").trim();
  const accountId = String(body.accountId || "").trim();
  const requestedChannelId = String(body.channelId || "").trim();
  const videoUrl = String(body.videoUrl || "").trim();
  const text = String(body.text || "").trim();
  const deliveryToken = String(body.deliveryToken || "").trim();
  if (!userId || !email || !brandId || !missionId || !accountId || !videoUrl || text.length < 10 || text.length > 1250 || !deliveryToken) {
    return NextResponse.json({ error: "A complete approved comment delivery is required." }, { status: 400 });
  }

  let ledger: TapInNetworkDelivery | null = null;
  try {
    const workspace = await getTapInWorkspaceForUser(userId);
    const workspaceAccount = workspace?.youtubeAccounts.find((account) => account.accountId === accountId);
    if (
      !workspace ||
      workspace.brandId !== brandId ||
      !workspaceOwnsYouTubeAccount(workspace, accountId) ||
      !workspaceAccount ||
      (requestedChannelId && requestedChannelId !== workspaceAccount.channelId)
    ) {
      return NextResponse.json({ error: "TapIn workspace ownership could not be verified." }, { status: 403 });
    }

    const grant = verifyClusterSeoDeliveryToken(deliveryToken, { allowExpired: true });
    const textHash = hashTapInNetworkComment(text);
    if (
      grant.missionId !== missionId ||
      grant.providerUserId !== userId ||
      grant.accountId !== accountId ||
      grant.videoUrl !== videoUrl ||
      grant.textHash !== textHash
    ) {
      return NextResponse.json({ error: "The approved ClusterSEO delivery does not match this comment." }, { status: 403 });
    }

    const claimed = await claimTapInNetworkDelivery({
      missionId,
      tapInUserId: userId,
      brandId,
      accountId,
      channelId: workspaceAccount.channelId,
      videoUrl,
      commentText: text,
      textHash,
      deliveryToken,
    });
    ledger = claimed.delivery;
    if (claimed.shouldPost && grant.expiresAt <= Date.now()) {
      throw new Error("The ClusterSEO delivery grant has expired. Review the comment again.");
    }
    if (ledger.status === "settled") return NextResponse.json(settledPayload(ledger));
    if (ledger.status === "posted_unverified") {
      return NextResponse.json(
        { error: "YouTube accepted this comment but did not return its verification ID. It will not be posted twice." },
        { status: 409 }
      );
    }
    if (!claimed.shouldPost && !ledger.commentId) {
      return NextResponse.json({ error: "This approved comment is already being posted." }, { status: 409 });
    }

    if (claimed.shouldPost) {
      const [account, secrets] = await Promise.all([
        getOutreachAccount(accountId),
        getOutreachAccountSecrets(accountId),
      ]);
      if (!account || !secrets || account.config.social.externalAccountId !== workspaceAccount.channelId) {
        throw new Error("The selected YouTube channel credentials could not be verified.");
      }
      const posted = await sendYouTubeVideoComment({
        post: { platform: "youtube", url: videoUrl, raw: {} },
        text,
        secrets,
      });
      const commentId = posted.delivery.commentId.trim();
      const postedAt = new Date().toISOString();
      if (posted.delivery.status !== "verified" || !commentId) {
        ledger = await updateTapInNetworkDelivery(ledger.id, {
          status: "posted_unverified",
          postedAt,
          errorMessage: posted.delivery.message,
        });
        return NextResponse.json(
          { error: "YouTube accepted the comment but did not return a verification ID. It will not be posted twice." },
          { status: 409 }
        );
      }
      ledger = await updateTapInNetworkDelivery(ledger.id, {
        status: "posted",
        commentId,
        commentUrl: buildYouTubeCommentUrl(posted.videoId, commentId),
        postedAt,
        errorMessage: "",
      });
    }

    const settlement = await settleClusterSeoDelivery({
      userId,
      email,
      name,
      workspace,
      eventId: ledger.eventId,
      missionId,
      accountId,
      channelId: workspaceAccount.channelId,
      text,
      commentId: ledger.commentId,
      commentUrl: ledger.commentUrl,
      postedAt: ledger.postedAt,
      deliveryToken: ledger.deliveryToken,
    });
    ledger = await updateTapInNetworkDelivery(ledger.id, {
      status: "settled",
      settledAt: new Date().toISOString(),
      settlement,
      errorMessage: "",
    });
    return NextResponse.json({
      ok: true,
      alreadyProcessed: Boolean(settlement.alreadyProcessed),
      commentId: ledger.commentId,
      commentUrl: ledger.commentUrl,
      creditsAwarded: Number(settlement.creditsAwarded || 0),
      creditBalance: Number(settlement.creditBalance || 0),
    });
  } catch (error) {
    if (ledger?.status === "posting" && !ledger.commentId) {
      await updateTapInNetworkDelivery(ledger.id, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Comment delivery failed.",
      }).catch(() => null);
    }
    const status = Number((error as { status?: unknown })?.status || 0);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TapIn comment delivery failed." },
      { status: status >= 400 && status <= 599 ? status : 500 }
    );
  }
}
