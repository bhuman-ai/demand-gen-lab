import { AUTHENTICATED_HOME, isAuthPagePath, isPublicApiPath, isPublicPagePath, normalizeNextPath } from "@/lib/auth-paths";

export type AppAuthSession = {
  userId: string;
  email: string;
  name: string;
  expiresAt: string;
};

export const AUTH_SESSION_COOKIE = "lastb2b_session";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function authSecret() {
  return (
    process.env.AUTH_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    ""
  ).trim();
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function safeStringEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function hmac(input: string) {
  const secret = authSecret();
  if (!secret) {
    throw new Error("Missing AUTH_SESSION_SECRET or Supabase service-role secret.");
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(input));
  return toHex(digest);
}

function isSessionShape(value: unknown): value is AppAuthSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.userId === "string" &&
    typeof row.email === "string" &&
    typeof row.name === "string" &&
    typeof row.expiresAt === "string"
  );
}

export function sessionCookieOptions(expiresAt?: string) {
  const expires = expiresAt ? new Date(expiresAt) : new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export async function createSignedSessionToken(input: {
  userId: string;
  email: string;
  name: string;
  expiresAt?: string;
}) {
  const session: AppAuthSession = {
    userId: input.userId,
    email: input.email,
    name: input.name,
    expiresAt: input.expiresAt || new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
  };
  const payload = encodeURIComponent(JSON.stringify(session));
  const signature = await hmac(payload);
  return `${payload}.${signature}`;
}

export async function readSignedSessionToken(token?: string | null): Promise<AppAuthSession | null> {
  if (!token) return null;
  const split = token.lastIndexOf(".");
  if (split <= 0) return null;

  const payload = token.slice(0, split);
  const signature = token.slice(split + 1);
  const expected = await hmac(payload);
  if (!safeStringEqual(signature, expected)) {
    return null;
  }

  try {
    const decoded = JSON.parse(decodeURIComponent(payload)) as unknown;
    if (!isSessionShape(decoded)) return null;
    const expiresAt = Date.parse(decoded.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}

export { AUTHENTICATED_HOME, isAuthPagePath, isPublicApiPath, isPublicPagePath, normalizeNextPath };
