export const AUTHENTICATED_HOME = "/workspace";

const AUTH_PAGE_ROUTES = new Set(["/login", "/signup"]);
const PUBLIC_PAGE_ROUTES = new Set(["/", "/login", "/signup", "/autoads", "/google-ads-review"]);
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/build-id", "/api/internal", "/api/webhooks"];

export function isPublicPagePath(pathname: string) {
  return PUBLIC_PAGE_ROUTES.has(pathname);
}

export function isAuthPagePath(pathname: string) {
  return AUTH_PAGE_ROUTES.has(pathname);
}

export function isPublicApiPath(pathname: string) {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function normalizeNextPath(value: string | null | undefined, fallback = AUTHENTICATED_HOME) {
  const next = String(value ?? "").trim();
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  if (next === "/" || isAuthPagePath(next) || next.startsWith("/api/")) return fallback;
  return next;
}
