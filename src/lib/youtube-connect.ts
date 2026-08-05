import { createHmac } from "crypto";
import { getAppUrl } from "@/lib/app-url";
import { getOutreachAccount, getOutreachAccountSecrets } from "@/lib/outreach-data";
import {
  buildYouTubeOAuthAuthorizeUrl,
  looksLikeGoogleOAuthClientId,
  resolveYouTubeOAuthClientCredentials,
  YouTubeOAuthClientProfile,
} from "@/lib/youtube";

type YouTubeConnectState = {
  accountId: string;
  brandId: string;
  oauthClientProfile?: YouTubeOAuthClientProfile;
  returnTo: string;
  issuedAt: number;
};

type PrepareYouTubeConnectInput = {
  accountId: string;
  brandId?: string;
  loginHint?: string;
  oauthClientProfile?: YouTubeOAuthClientProfile;
  returnTo?: string;
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

function cleanBaseUrl(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  return (raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`).replace(/\/+$/, "");
}

function tapInOAuthRedirectBaseUrl() {
  return cleanBaseUrl(
    String(process.env.TAPINSOCIAL_YOUTUBE_OAUTH_REDIRECT_BASE_URL ?? "").trim() ||
      String(process.env.TAPINSOCIAL_APP_URL ?? "").trim() ||
      "https://www.tapinsocial.com"
  );
}

export function youTubeOAuthCallbackUrl(profile: YouTubeOAuthClientProfile = "default") {
  const baseUrl = profile === "tapinsocial" ? tapInOAuthRedirectBaseUrl() : getAppUrl();
  return `${baseUrl}/api/outreach/accounts/youtube/callback`;
}

function configuredReturnOrigins() {
  return String(process.env.YOUTUBE_OAUTH_ALLOWED_RETURN_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function defaultReturnOrigins() {
  return [
    "https://www.tapinsocial.com",
    "https://tapinsocial.com",
    getAppUrl(),
  ];
}

export function normalizeYouTubeConnectReturnTo(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    const isLocal =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
    if (url.protocol !== "https:" && !isLocal) return "";

    const allowedOrigins = new Set(
      [...defaultReturnOrigins(), ...configuredReturnOrigins()]
        .map((entry) => {
          try {
            return new URL(entry).origin;
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    );

    if (!allowedOrigins.has(url.origin) && !isLocal) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export async function prepareYouTubeConnectUrl(input: PrepareYouTubeConnectInput) {
  const accountId = String(input.accountId ?? "").trim();
  const brandId = String(input.brandId ?? "").trim();
  const oauthClientProfile = input.oauthClientProfile === "tapinsocial" ? "tapinsocial" : "default";
  if (!accountId) {
    throw new YouTubeConnectError("account not found", { status: 404 });
  }

  const account = await getOutreachAccount(accountId);
  if (!account) {
    throw new YouTubeConnectError("account not found", { status: 404 });
  }

  const secrets = await getOutreachAccountSecrets(accountId);
  const credentials = resolveYouTubeOAuthClientCredentials(secrets ?? undefined, {
    profile: oauthClientProfile,
  });
  const invalidClientId = Boolean(credentials.clientId) && !looksLikeGoogleOAuthClientId(credentials.clientId);
  const missingFields = [
    !credentials.clientId || invalidClientId ? "youtubeClientId" : "",
    !credentials.clientSecret || invalidClientId ? "youtubeClientSecret" : "",
  ].filter(Boolean);
  if (missingFields.length) {
    throw new YouTubeConnectError(
      invalidClientId
        ? "The saved Google app credentials are invalid. Enter the OAuth client ID and client secret from Google Cloud Console."
        : oauthClientProfile === "tapinsocial"
          ? "Set TAPINSOCIAL_YOUTUBE_OAUTH_CLIENT_ID and TAPINSOCIAL_YOUTUBE_OAUTH_CLIENT_SECRET before TapIn can open YouTube sign-in."
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
    (oauthClientProfile === "tapinsocial" ? "" : account.config.mailbox.email.trim());
  const state = encodeState({
    accountId,
    brandId,
    oauthClientProfile,
    returnTo: normalizeYouTubeConnectReturnTo(input.returnTo),
    issuedAt: Date.now(),
  });

  return buildYouTubeOAuthAuthorizeUrl({
    clientId: credentials.clientId,
    redirectUri: youTubeOAuthCallbackUrl(oauthClientProfile),
    state,
    loginHint,
    includeGrantedScopes: oauthClientProfile !== "tapinsocial",
  });
}
