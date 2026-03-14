const DEFAULT_ENRICHANYTHING_APP_URL = "https://enrichanything.vercel.app";

export function resolveEnrichAnythingAppUrl() {
  return String(
    process.env.ENRICHANYTHING_APP_URL ??
      process.env.NEXT_PUBLIC_ENRICHANYTHING_APP_URL ??
      DEFAULT_ENRICHANYTHING_APP_URL
  )
    .trim()
    .replace(/\/+$/, "");
}
