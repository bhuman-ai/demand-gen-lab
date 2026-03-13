export function resolveEnrichAnythingAppUrl() {
  return String(
    process.env.ENRICHANYTHING_APP_URL ?? process.env.NEXT_PUBLIC_ENRICHANYTHING_APP_URL ?? ""
  )
    .trim()
    .replace(/\/+$/, "");
}
