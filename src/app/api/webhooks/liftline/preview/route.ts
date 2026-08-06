import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { generateTapInThreadPreview } from "@/lib/tapinsocial-preview";
import { getTapInWorkspaceForUser } from "@/lib/tapinsocial-auth";

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

function requiredText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export async function POST(request: Request) {
  const expected = expectedSecret();
  if (!expected || suppliedSecret(request) !== expected) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const userId = requiredText(body.userId, 120);
  const brandId = requiredText(body.brandId, 120);
  const openingPrompt = requiredText(body.openingPrompt, 2000);
  const replyPrompt = requiredText(body.replyPrompt, 2000);
  const videoTitle = requiredText(body.videoTitle, 400);
  const videoDescription = requiredText(body.videoDescription, 4000);
  if (!userId || !brandId || !openingPrompt || !replyPrompt || !videoTitle || !videoDescription) {
    return NextResponse.json(
      { error: "Opening prompt, reply prompt, and video context are required." },
      { status: 400 }
    );
  }

  const workspace = await getTapInWorkspaceForUser(userId);
  if (!workspace || workspace.brandId !== brandId) {
    return NextResponse.json(
      { error: "TapIn workspace ownership could not be verified." },
      { status: 403 }
    );
  }

  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "TapIn brand was not found." }, { status: 404 });
  }

  try {
    const preview = await generateTapInThreadPreview({
      brandName: brand.name,
      openingPrompt,
      replyPrompt,
      videoTitle,
      videoDescription,
    });
    return NextResponse.json({ ok: true, preview });
  } catch {
    return NextResponse.json(
      { error: "Preview generation is unavailable right now. Try again." },
      { status: 502 }
    );
  }
}
