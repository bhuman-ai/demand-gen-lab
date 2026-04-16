export function canonicalApiUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") return normalized;
  if (window.location.hostname === "lastb2b.com") {
    return `https://www.lastb2b.com${normalized}`;
  }
  return normalized;
}
