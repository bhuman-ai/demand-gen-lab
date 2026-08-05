import { NextResponse } from "next/server";
import { createSupabaseAuthClient } from "@/lib/auth-server";
import {
  getTapInWorkspaceForUser,
  provisionTapInWorkspace,
  tapInWorkspaceFromUser,
  type TapInAuthWorkspace,
} from "@/lib/tapinsocial-auth";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function expectedSecret() {
  return String(
    process.env.LIFTLINE_AUTOPILOT_WEBHOOK_SECRET ?? process.env.LIFTLINE_WEBHOOK_SECRET ?? ""
  ).trim();
}

function suppliedSecret(request: Request) {
  return (
    String(request.headers.get("x-liftline-secret") ?? "").trim() ||
    String(request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  );
}

function identity(user: {
  id?: string | null;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}) {
  const email = String(user.email ?? "").trim().toLowerCase();
  const metadata = user.user_metadata ?? {};
  const name =
    String(metadata.full_name ?? metadata.name ?? "").trim() ||
    email.split("@")[0] ||
    "TapIn user";
  return { userId: String(user.id ?? "").trim(), email, name };
}

function duplicateAccount(message: string) {
  return /already|exists|registered/i.test(message);
}

async function workspaceForUser(
  user: {
    id: string;
    app_metadata?: Record<string, unknown> | null;
  },
  body: Record<string, unknown>
): Promise<TapInAuthWorkspace> {
  const existing = tapInWorkspaceFromUser(user);
  if (existing) return (await getTapInWorkspaceForUser(user.id)) ?? existing;
  return provisionTapInWorkspace({
    user,
    accountName: String(body.accountName ?? "").trim(),
    brandId: String(body.brandId ?? "").trim(),
    youtubeAccountId: String(body.youtubeAccountId ?? "").trim(),
  });
}

export async function POST(request: Request) {
  const expected = expectedSecret();
  if (!expected || suppliedSecret(request) !== expected) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const action = String(body.action ?? "").trim().toLowerCase();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim();

  if ((action !== "signup" && action !== "login") || !email || !password) {
    return NextResponse.json(
      { error: "Valid action, email, and password are required." },
      { status: 400 }
    );
  }
  if (action === "signup" && (!name || password.length < 10)) {
    return NextResponse.json(
      { error: "Name and a password of at least 10 characters are required." },
      { status: 400 }
    );
  }

  try {
    const supabase = createSupabaseAuthClient({ timeoutMs: 35_000 });
    let user:
      | {
          id: string;
          email?: string | null;
          user_metadata?: Record<string, unknown> | null;
          app_metadata?: Record<string, unknown> | null;
        }
      | null = null;

    if (action === "signup") {
      const created = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, full_name: name },
        app_metadata: { tapinsocialAccess: true },
      });
      if (created.error || !created.data.user) {
        const message = created.error?.message || "Unable to create account.";
        if (!duplicateAccount(message)) {
          return NextResponse.json({ error: message }, { status: 400 });
        }
        const existing = await supabase.auth.signInWithPassword({ email, password });
        if (existing.error || !existing.data.user) {
          return NextResponse.json(
            { error: "Account already exists. Sign in with its password." },
            { status: 409 }
          );
        }
        user = existing.data.user;
      } else {
        user = created.data.user;
      }
    } else {
      const login = await supabase.auth.signInWithPassword({ email, password });
      if (login.error || !login.data.user) {
        return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
      }
      user = login.data.user;
    }

    const workspace = await workspaceForUser(user, body);
    return NextResponse.json({ ok: true, user: identity(user), workspace });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json({ error: "Authentication took too long. Try again." }, { status: 504 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Authentication failed." },
      { status: 500 }
    );
  }
}
