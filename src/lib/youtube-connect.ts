import { createHmac } from "crypto";
import { getAppUrl } from "@/lib/app-url";
import { getOutreachAccount, getOutreachAccountSecrets } from "@/lib/outreach-data";
import {
  buildYouTubeOAuthAuthorizeUrl,
  looksLikeGoogleOAuthClientId,
  resolveYouTubeOAuthClientCredentials,
} from "@/lib/youtube";

type YouTubeConnectState = {
  accountId: string;
  brandId: string;
  issuedAt: number;
};

type PrepareYouTubeConnectInput = {
  accountId: string;
  brandId?: string;
  loginHint?: string;
};

export class YouTubeConnectError extends Error {
  status: number;
  errorCode?: string;
  missingFields?: string[];

  constructor(
    message: string,
    input: { status: number; errorCode?: string; missingFields?: string[] }
  ) {
    super(message);
    this.name = "YouTubeConnectError";
    this.status = input.status;
    this.errorCode = input.errorCode;
    this.missingFields = input.missingFields;
  }
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

export async function prepareYouTubeConnectUrl(input: PrepareYouTubeConnectInput) {
  const accountId = String(input.accountId ?? "").trim();
  const brandId = String(input.brandId ?? "").trim();
  if (!accountId) {
    throw new YouTubeConnectError("account not found", { status: 404 });
  }

  const account = await getOutreachAccount(accountId);
  if (!account) {
    throw new YouTubeConnectError("account not found", { status: 404 });
  }

  const secrets = await getOutreachAccountSecrets(accountId);
  const credentials = resolveYouTubeOAuthClientCredentials(secrets ?? undefined);
  const invalidClientId = Boolean(credentials.clientId) && !looksLikeGoogleOAuthClientId(credentials.clientId);
  const missingFields = [
    !credentials.clientId || invalidClientId ? "youtubeClientId" : "",
    !credentials.clientSecret || invalidClientId ? "youtubeClientSecret" : "",
  ].filter(Boolean);
  if (missingFields.length) {
    throw new YouTubeConnectError(
      invalidClientId
        ? "The saved Google app credentials are invalid. Enter the OAuth client ID and client secret from Google Cloud Console."
        : "We need a Google client ID and client secret before YouTube can open.",
      {
        status: 409,
        errorCode: "youtube_oauth_credentials_missing",
        missingFields,
      }
    );
  }

  const loginHint =
    String(input.loginHint ?? "").trim() ||
    account.config.mailbox.email.trim() ||
    "";
  const state = encodeState({
    accountId,
    brandId,
    issuedAt: Date.now(),
  });

  return buildYouTubeOAuthAuthorizeUrl({
    clientId: credentials.clientId,
    redirectUri: callbackUrl(),
    state,
    loginHint,
  });
}
