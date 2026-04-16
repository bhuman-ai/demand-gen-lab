import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getOutreachAccount, getOutreachAccountSecrets } from "@/lib/outreach-data";
import { getAppUrl } from "@/lib/app-url";
import { buildYouTubeOAuthAuthorizeUrl, resolveYouTubeOAuthClientCredentials } from "@/lib/youtube";

type YouTubeConnectState = {
  accountId: string;
  brandId: string;
  issuedAt: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stateSecret() {
  return (
    String(process.env.YOUTUBE_OAUTH_STATE_SECRET ?? "").trim() ||
    String(process.env.AUTH_SESSION_SECRET ?? "").trim() ||
    String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()
  );
}

function signStatePayload(payload: string) {
  const secret = stateSecret();
  if (!secret) {
    throw new Error("Missing AUTH_SESSION_SECRET or YOUTUBE_OAUTH_STATE_SECRET.");
  }
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function encodeState(input: YouTubeConnectState) {
  const payload = Buffer.from(JSON.stringify(input)).toString("base64url");
  const signature = signStatePayload(payload);
  return `${payload}.${signature}`;
}

function callbackUrl() {
  return `${getAppUrl()}/api/outreach/accounts/youtube/callback`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await context.params;
    const account = await getOutreachAccount(accountId);
    if (!account) {
      return NextResponse.json({ error: "account not found" }, { status: 404 });
    }

    const secrets = await getOutreachAccountSecrets(accountId);
    const credentials = resolveYouTubeOAuthClientCredentials(secrets ?? undefined);
    const missingFields = [
      !credentials.clientId ? "youtubeClientId" : "",
      !credentials.clientSecret ? "youtubeClientSecret" : "",
    ].filter(Boolean);
    if (missingFields.length) {
      return NextResponse.json(
        {
          error: "We need a Google client ID and client secret before YouTube can open.",
          errorCode: "youtube_oauth_credentials_missing",
          missingFields,
        },
        { status: 409 }
      );
    }

    const body = asRecord(await request.json().catch(() => ({})));
    const brandId = String(body.brandId ?? body.brand_id ?? "").trim();
    const loginHint =
      String(body.loginHint ?? body.login_hint ?? "").trim() ||
      account.config.mailbox.email.trim() ||
      "";
    const state = encodeState({
      accountId,
      brandId,
      issuedAt: Date.now(),
    });
    const url = buildYouTubeOAuthAuthorizeUrl({
      clientId: credentials.clientId,
      redirectUri: callbackUrl(),
      state,
      loginHint,
    });

    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start YouTube connect flow" },
      { status: 500 }
    );
  }
}
