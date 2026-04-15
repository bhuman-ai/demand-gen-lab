import type { SocialDiscoveryPromotionPurchase } from "@/lib/social-discovery-types";

function inferredWorkerBaseUrl() {
  const explicitBaseUrl = String(
    process.env.BUY_SHAZAM_UI_WORKER_BASE_URL ?? process.env.GMAIL_UI_WORKER_BASE_URL ?? ""
  ).trim();
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/+$/, "");
  }
  return "";
}

export function hasBuyShazamUiWorkerConfig() {
  return Boolean(inferredWorkerBaseUrl() && workerToken());
}

function workerBaseUrl() {
  const baseUrl = inferredWorkerBaseUrl();
  if (!baseUrl) {
    throw new Error("BUY_SHAZAM_UI_WORKER_BASE_URL is not configured.");
  }
  return baseUrl;
}

function workerToken() {
  return String(process.env.BUY_SHAZAM_UI_WORKER_TOKEN ?? process.env.GMAIL_UI_WORKER_TOKEN ?? "").trim();
}

async function readJson(response: Response) {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = String(data.error ?? data.message ?? response.statusText).trim() || "Worker request failed";
    throw new Error(message);
  }
  return data;
}

async function workerRequest(pathname: string, init?: RequestInit) {
  const response = await fetch(`${workerBaseUrl()}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${workerToken()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  return readJson(response);
}

function parsePurchase(data: Record<string, unknown>): SocialDiscoveryPromotionPurchase {
  const status = String(data.status ?? "").trim();
  return {
    provider: "buyshazam",
    mode: "wallet",
    status:
      status === "requires_configuration" ||
      status === "requires_login" ||
      status === "checkout_requires_input" ||
      status === "wallet_unavailable" ||
      status === "submitted"
        ? status
        : "failed",
    productUrl: String(data.productUrl ?? "").trim(),
    cartUrl: String(data.cartUrl ?? "").trim(),
    checkoutUrl: String(data.checkoutUrl ?? "").trim(),
    sourceCommentUrl: String(data.sourceCommentUrl ?? "").trim(),
    addedToCart: Boolean(data.addedToCart),
    walletOptionLabel: String(data.walletOptionLabel ?? "").trim(),
    walletBalance: String(data.walletBalance ?? "").trim(),
    missingFields: Array.isArray(data.missingFields)
      ? data.missingFields.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [],
    orderId: String(data.orderId ?? "").trim(),
    orderUrl: String(data.orderUrl ?? "").trim(),
    message: String(data.message ?? "").trim(),
    screenshotPath: String(data.screenshotPath ?? "").trim(),
    attemptedAt: String(data.attemptedAt ?? "").trim(),
  };
}

export async function runBuyShazamWorkerPurchase(input: {
  productUrl: string;
  commentUrl: string;
}): Promise<SocialDiscoveryPromotionPurchase> {
  const data = await workerRequest("/buyshazam/purchase", {
    method: "POST",
    body: JSON.stringify({
      productUrl: String(input.productUrl ?? "").trim(),
      commentUrl: String(input.commentUrl ?? "").trim(),
    }),
  });
  return parsePurchase(data);
}
