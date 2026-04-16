const LEGACY_LASTB2B_HOST = "lastb2b.com";
const CANONICAL_LASTB2B_ORIGIN = "https://www.lastb2b.com";

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

export function canonicalApiUrl(path: string) {
  return normalizePath(path);
}

export function shouldRedirectToCanonicalLastB2bHost() {
  return typeof window !== "undefined" && window.location.hostname === LEGACY_LASTB2B_HOST;
}

export function canonicalLastB2bUrl(path?: string) {
  const nextPath =
    path ??
    (typeof window === "undefined"
      ? "/"
      : `${window.location.pathname}${window.location.search}${window.location.hash}`);
  return `${CANONICAL_LASTB2B_ORIGIN}${normalizePath(nextPath)}`;
}

export function redirectToCanonicalLastB2bHost(path?: string) {
  if (!shouldRedirectToCanonicalLastB2bHost()) return false;
  window.location.replace(canonicalLastB2bUrl(path));
  return true;
}
