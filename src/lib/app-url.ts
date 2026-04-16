const DEFAULT_APP_URL = "https://www.lastb2b.com";

export function getAppUrl() {
  const raw =
    String(process.env.APP_URL ?? "").trim() ||
    String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim() ||
    String(process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim() ||
    String(process.env.VERCEL_URL ?? "").trim() ||
    DEFAULT_APP_URL;
  const normalized = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  try {
    const url = new URL(normalized);
    if (url.hostname === "lastb2b.com") {
      url.hostname = "www.lastb2b.com";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return normalized.replace(/\/+$/, "");
  }
}

export function getMailpoolWebhookUrl() {
  return `${getAppUrl()}/api/webhooks/mailpool/events`;
}
