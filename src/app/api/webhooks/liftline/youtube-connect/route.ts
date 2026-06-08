import { NextResponse } from "next/server";
import { prepareYouTubeConnectUrl, YouTubeConnectError } from "@/lib/youtube-connect";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function expectedSecret() {
  return (
    String(process.env.LIFTLINE_AUTOPILOT_WEBHOOK_SECRET ?? "").trim() ||
    String(process.env.LIFTLINE_WEBHOOK_SECRET ?? "").trim()
  );
}

function suppliedSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return (
    String(request.headers.get("x-liftline-secret") ?? "").trim() ||
    authorization.replace(/^Bearer\s+/i, "").trim()
  );
}

export async function POST(request: Request) {
  const expected = expectedSecret();
  if (!expected || suppliedSecret(request) !== expected) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const url = await prepareYouTubeConnectUrl({
      accountId: String(body.accountId ?? body.account_id ?? "").trim(),
      brandId: String(body.brandId ?? body.brand_id ?? "").trim(),
      loginHint: String(body.loginHint ?? body.login_hint ?? "").trim(),
      returnTo: String(body.returnTo ?? body.return_to ?? "").trim(),
    });

    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof YouTubeConnectError) {
      return NextResponse.json(
        {
          error: error.message,
          ...(error.errorCode ? { errorCode: error.errorCode } : {}),
          ...(error.missingFields?.length ? { missingFields: error.missingFields } : {}),
        },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start YouTube connect flow" },
      { status: 500 }
    );
  }
}
