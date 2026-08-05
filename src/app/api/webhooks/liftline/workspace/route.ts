import { NextResponse } from "next/server";
import {
  getTapInWorkspaceForUser,
  selectTapInYouTubeAccount,
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

export async function POST(request: Request) {
  const expected = expectedSecret();
  if (!expected || suppliedSecret(request) !== expected) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const userId = String(body.userId ?? "").trim();
  const action = String(body.action ?? "get").trim().toLowerCase();
  try {
    const workspace =
      action === "select"
        ? await selectTapInYouTubeAccount(userId, String(body.accountId ?? "").trim())
        : await getTapInWorkspaceForUser(userId);
    if (!workspace) {
      return NextResponse.json(
        { error: "TapIn workspace ownership could not be verified." },
        { status: 403 }
      );
    }
    return NextResponse.json({ ok: true, workspace });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TapIn workspace update failed." },
      { status: 403 }
    );
  }
}
