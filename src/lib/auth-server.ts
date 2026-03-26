import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  AUTH_SESSION_COOKIE,
  type AppAuthSession,
  createSignedSessionToken,
  readSignedSessionToken,
  sessionCookieOptions,
} from "@/lib/auth-session";

type SupabaseAuthUser = {
  id?: string | null;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

type SupabaseAuthClientOptions = {
  timeoutMs?: number;
};

function requireSupabaseAuthEnv() {
  const url = String(process.env.SUPABASE_URL ?? "").trim();
  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      ""
  ).trim();

  if (!url || !key) {
    throw new Error("Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  return { url, key };
}

export function createSupabaseAuthClient(options?: SupabaseAuthClientOptions) {
  const { url, key } = requireSupabaseAuthEnv();
  const timeoutMs = Math.max(1_000, Number(options?.timeoutMs ?? 8_000));
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
    },
  });
}

function fallbackNameForEmail(email: string) {
  const local = email.split("@")[0] || "Operator";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function sessionFromSupabaseUser(user: SupabaseAuthUser): Omit<AppAuthSession, "expiresAt"> {
  const userId = String(user.id ?? "").trim();
  const email = String(user.email ?? "").trim().toLowerCase();
  if (!userId || !email) {
    throw new Error("Supabase auth did not return a valid user.");
  }

  const metadata = user.user_metadata ?? {};
  const name =
    String(metadata.full_name ?? metadata.name ?? "").trim() ||
    fallbackNameForEmail(email) ||
    "Operator";

  return {
    userId,
    email,
    name,
  };
}

export async function applySessionCookie(response: NextResponse, user: SupabaseAuthUser) {
  const session = sessionFromSupabaseUser(user);
  await applySessionCookieFromIdentity(response, session);
}

export async function applySessionCookieFromIdentity(
  response: NextResponse,
  identity: Omit<AppAuthSession, "expiresAt">
) {
  const token = await createSignedSessionToken(identity);
  const resolvedSession = await readSignedSessionToken(token);
  response.cookies.set(
    AUTH_SESSION_COOKIE,
    token,
    sessionCookieOptions(resolvedSession?.expiresAt)
  );
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(AUTH_SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    expires: new Date(0),
    maxAge: 0,
  });
}

export async function getRequestAuthSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_SESSION_COOKIE)?.value;
  return readSignedSessionToken(token);
}
