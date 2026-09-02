import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { TapInAuthWorkspace } from "@/lib/tapinsocial-auth";

type DeliveryClaims = {
  purpose: "tapinsocial_delivery";
  missionId: string;
  providerUserId: string;
  accountId: string;
  videoUrl: string;
  textHash: string;
  issuedAt: number;
  expiresAt: number;
};

export type ClusterSeoTapInIdentity = {
  providerUserId: string;
  email: string;
  name: string;
  selectedAccountId?: string;
  youtubeAccounts: Array<{
    accountId: string;
    channelId: string;
    name: string;
    handle: string;
  }>;
};

export type ClusterSeoOpportunity = {
  id: string;
  platform: string;
  actionKind: string;
  targetPostUrl: string;
  targetPostTitle: string;
  targetBrandName: string;
  targetBrandUserId: string;
  targetDomainToken: string;
  rewardCredits: number;
  sourceProvider: string;
};

export type ClusterSeoOpportunityList = {
  success: true;
  connection: {
    clusterUserId: string;
    credits: number;
  };
  opportunities: ClusterSeoOpportunity[];
};

export type ClusterSeoDraft = {
  success: true;
  draft: string;
  mentionHint: string;
};

export type ClusterSeoGrant = {
  success: true;
  deliveryToken: string;
  expiresAt: string;
  mission: {
    id: string;
    videoUrl: string;
    title: string;
    rewardCredits: number;
  };
};

function cleanUrl(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  return (raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`).replace(/\/+$/, "");
}

function clusterSeoUrl() {
  return cleanUrl(process.env.CLUSTERSEO_API_URL ?? "https://www.clusterseo.com");
}

function sharedSecret() {
  const secret = String(
    process.env.CLUSTERSEO_TAPIN_SHARED_SECRET ??
      process.env.TAPINSOCIAL_INTEGRATION_SECRET ??
      ""
  ).trim();
  if (!secret) throw new Error("The ClusterSEO contributor integration is not configured.");
  return secret;
}

function hmac(value: string) {
  return createHmac("sha256", sharedSecret()).update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function clusterSeoTapInIdentity(input: {
  userId: string;
  email: string;
  name: string;
  workspace: TapInAuthWorkspace;
  selectedAccountId?: string;
}): ClusterSeoTapInIdentity {
  return {
    providerUserId: input.userId,
    email: input.email,
    name: input.name,
    selectedAccountId: input.selectedAccountId || input.workspace.youtubeAccountId || undefined,
    youtubeAccounts: input.workspace.youtubeAccounts.map((account) => ({
      accountId: account.accountId,
      channelId: account.channelId,
      name: account.name,
      handle: account.handle,
    })),
  };
}

export async function callClusterSeoNetwork<T>(body: Record<string, unknown>) {
  const rawBody = JSON.stringify(body);
  const timestamp = Date.now();
  const response = await fetch(`${clusterSeoUrl()}/api/integrations/tapinsocial/network`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tapin-timestamp": String(timestamp),
      "x-tapin-signature": `v1=${hmac(`${timestamp}.${rawBody}`)}`,
    },
    body: rawBody,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    const error = new Error(payload.error || "ClusterSEO could not complete this request.") as Error & {
      status?: number;
      code?: string;
    };
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

export function hashTapInNetworkComment(text: string) {
  return createHash("sha256").update(text.trim()).digest("hex");
}

export function verifyClusterSeoDeliveryToken(token: string, options?: { allowExpired?: boolean }) {
  const normalized = token.trim();
  const split = normalized.lastIndexOf(".");
  if (split <= 0) throw new Error("The ClusterSEO delivery grant is invalid.");
  const encoded = normalized.slice(0, split);
  const supplied = normalized.slice(split + 1);
  if (!safeEqual(supplied, hmac(encoded))) throw new Error("The ClusterSEO delivery grant signature is invalid.");
  let claims: DeliveryClaims;
  try {
    claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as DeliveryClaims;
  } catch {
    throw new Error("The ClusterSEO delivery grant payload is invalid.");
  }
  if (
    claims.purpose !== "tapinsocial_delivery" ||
    !Number.isFinite(claims.expiresAt) ||
    (!options?.allowExpired && claims.expiresAt <= Date.now())
  ) {
    throw new Error("The ClusterSEO delivery grant has expired. Review the comment again.");
  }
  return claims;
}

export async function settleClusterSeoDelivery(input: {
  userId: string;
  email: string;
  name: string;
  workspace: TapInAuthWorkspace;
  eventId: string;
  missionId: string;
  accountId: string;
  channelId: string;
  text: string;
  commentId: string;
  commentUrl: string;
  postedAt: string;
  deliveryToken: string;
}) {
  return callClusterSeoNetwork<{
    alreadyProcessed?: boolean;
    submissionId?: string;
    creditsAwarded?: number;
    creditBalance?: number;
  }>({
    action: "settle",
    identity: clusterSeoTapInIdentity({
      userId: input.userId,
      email: input.email,
      name: input.name,
      workspace: input.workspace,
      selectedAccountId: input.accountId,
    }),
    delivery: {
      eventId: input.eventId,
      missionId: input.missionId,
      accountId: input.accountId,
      channelId: input.channelId,
      text: input.text,
      commentId: input.commentId,
      commentUrl: input.commentUrl,
      postedAt: input.postedAt,
      deliveryToken: input.deliveryToken,
    },
  });
}
