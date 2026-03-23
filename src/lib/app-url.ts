const DEFAULT_APP_URL = "https://lastb2b.com";

export function getAppUrl() {
  const raw =
    String(process.env.APP_URL ?? "").trim() ||
    String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim() ||
    String(process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim() ||
    String(process.env.VERCEL_URL ?? "").trim() ||
    DEFAULT_APP_URL;
  const normalized = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  return normalized.replace(/\/+$/, "");
}

export function getMailpoolWebhookUrl() {
  return `${getAppUrl()}/api/webhooks/mailpool/events`;
}
