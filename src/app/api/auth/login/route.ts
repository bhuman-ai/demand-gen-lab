import { NextResponse } from "next/server";
import { authAccessErrorMessage, isAllowedOperatorEmail } from "@/lib/auth-allowlist";
import { verifyBootstrapCredentials } from "@/lib/auth-bootstrap";
import { applySessionCookie, applySessionCookieFromIdentity, createSupabaseAuthClient } from "@/lib/auth-server";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(request: Request) {
  const body = asRecord(await request.json().catch(() => ({})));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  if (!isAllowedOperatorEmail(email)) {
    return NextResponse.json({ error: authAccessErrorMessage() }, { status: 403 });
  }

  const bootstrapIdentity = verifyBootstrapCredentials(email, password);
  if (bootstrapIdentity) {
    const response = NextResponse.json({
      ok: true,
      user: {
        id: bootstrapIdentity.userId,
        email: bootstrapIdentity.email,
      },
    });
    await applySessionCookieFromIdentity(response, bootstrapIdentity);
    return response;
  }

  try {
    const supabase = createSupabaseAuthClient({ timeoutMs: 15_000 });
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const response = NextResponse.json({
      ok: true,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
    await applySessionCookie(response, data.user);
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Sign in took too long. Try again in a moment." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sign in." },
      { status: 500 }
    );
  }
}
