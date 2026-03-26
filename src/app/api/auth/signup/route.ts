import { NextResponse } from "next/server";
import { authAccessErrorMessage, isAllowedOperatorEmail } from "@/lib/auth-allowlist";
import { bootstrapSignupError, hasBootstrapCredentials, isBootstrapEmail } from "@/lib/auth-bootstrap";
import { applySessionCookie, createSupabaseAuthClient } from "@/lib/auth-server";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isDuplicateSignupMessage(message: string) {
  return /already|exists|registered/i.test(message);
}

export async function POST(request: Request) {
  const body = asRecord(await request.json().catch(() => ({})));
  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!name || !email || !password) {
    return NextResponse.json({ error: "Name, email, and password are required." }, { status: 400 });
  }

  if (password.length < 10) {
    return NextResponse.json(
      { error: "Use at least 10 characters for the password." },
      { status: 400 }
    );
  }

  if (!isAllowedOperatorEmail(email)) {
    return NextResponse.json({ error: authAccessErrorMessage() }, { status: 403 });
  }

  if (hasBootstrapCredentials() && isBootstrapEmail(email)) {
    return NextResponse.json({ error: bootstrapSignupError() }, { status: 409 });
  }

  try {
    const supabase = createSupabaseAuthClient({ timeoutMs: 35_000 });
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: name
        ? {
            name,
            full_name: name,
          }
        : undefined,
    });

    if (error || !data.user) {
      const message = error?.message || "Unable to create account.";
      if (isDuplicateSignupMessage(message)) {
        const login = await supabase.auth.signInWithPassword({ email, password });
        if (!login.error && login.data.user) {
          const response = NextResponse.json(
            {
              ok: true,
              alreadyExisted: true,
              user: {
                id: login.data.user.id,
                email: login.data.user.email,
              },
            },
            { status: 200 }
          );
          await applySessionCookie(response, login.data.user);
          return response;
        }

        return NextResponse.json(
          { error: "Account already exists. Use sign in with the same email and password." },
          { status: 409 }
        );
      }

      return NextResponse.json({ error: message }, { status: 400 });
    }

    const response = NextResponse.json(
      {
        ok: true,
        user: {
          id: data.user.id,
          email: data.user.email,
        },
      },
      { status: 201 }
    );
    await applySessionCookie(response, data.user);
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Signup took too long. If this was your first attempt, try signing in now." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create account." },
      { status: 500 }
    );
  }
}
