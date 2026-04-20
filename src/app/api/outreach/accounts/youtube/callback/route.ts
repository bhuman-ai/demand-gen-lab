import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getOutreachAccount, getOutreachAccountSecrets, updateOutreachAccount } from "@/lib/outreach-data";
import { getAppUrl } from "@/lib/app-url";
import {
  exchangeYouTubeOAuthCode,
  getAuthenticatedYouTubeChannelProfile,
  resolveYouTubeOAuthClientCredentials,
  YouTubeApiError,
} from "@/lib/youtube";

type YouTubeConnectState = {
  accountId: string;
  brandId: string;
  issuedAt: number;
};

const STATE_MAX_AGE_MS = 15 * 60 * 1000;

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

function safeStringEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function decodeState(value: string): YouTubeConnectState | null {
  const token = String(value ?? "").trim();
  const split = token.lastIndexOf(".");
  if (split <= 0) return null;
  const payload = token.slice(0, split);
  const signature = token.slice(split + 1);
  const expected = signStatePayload(payload);
  if (!safeStringEqual(signature, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
    const row = decoded as Record<string, unknown>;
    const accountId = String(row.accountId ?? "").trim();
    const brandId = String(row.brandId ?? "").trim();
    const issuedAt = Number(row.issuedAt ?? 0);
    if (!accountId || !Number.isFinite(issuedAt)) return null;
    if (Date.now() - issuedAt > STATE_MAX_AGE_MS) return null;
    return {
      accountId,
      brandId,
      issuedAt,
    };
  } catch {
    return null;
  }
}

function redirectUrl(input: {
  brandId: string;
  accountId: string;
  result: "success" | "failure";
  message?: string;
}) {
  const base = input.brandId
    ? `${getAppUrl()}/brands/${encodeURIComponent(input.brandId)}/social-discovery`
    : `${getAppUrl()}/settings/outreach`;
  const url = new URL(base);
  url.searchParams.set("linkedAccount", input.accountId);
  url.searchParams.set("youtube", input.result);
  if (String(input.message ?? "").trim()) {
    url.searchParams.set("youtubeMessage", String(input.message ?? "").trim());
  }
  return url.toString();
}

function callbackUrl() {
  return `${getAppUrl()}/api/outreach/accounts/youtube/callback`;
}

function normalizeYouTubeHandle(value: string) {
  const customUrl = String(value ?? "").trim();
  if (!customUrl) return "";
  return customUrl.startsWith("@") ? customUrl : "";
}

function hasSavedYouTubeIdentity(
  account: { config?: { social?: { externalAccountId?: string | null } } } | null | undefined,
  expectedChannelId?: string
) {
  const externalAccountId = String(account?.config?.social?.externalAccountId ?? "").trim();
  if (!externalAccountId) return false;
  if (!expectedChannelId) return true;
  return externalAccountId === expectedChannelId;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = decodeState(url.searchParams.get("state") ?? "");
  if (!state) {
    return NextResponse.redirect(`${getAppUrl()}/settings/outreach?youtube=failure`);
  }

  const failure = (message: string) =>
    NextResponse.redirect(
      redirectUrl({
        brandId: state.brandId,
        accountId: state.accountId,
        result: "failure",
        message,
      })
    );

  try {
    const oauthError = String(url.searchParams.get("error") ?? "").trim();
    if (oauthError) {
      const description = String(url.searchParams.get("error_description") ?? "").trim();
      console.warn(
        "[youtube-callback] google returned oauth error",
        JSON.stringify({
          accountId: state.accountId,
          brandId: state.brandId,
          oauthError,
          description,
        })
      );
      return failure(description || oauthError);
    }

    const code = String(url.searchParams.get("code") ?? "").trim();
    if (!code) {
      return failure("Google did not return an authorization code.");
    }

    console.info(
      "[youtube-callback] received callback",
      JSON.stringify({
        accountId: state.accountId,
        brandId: state.brandId,
      })
    );

    const account = await getOutreachAccount(state.accountId);
    if (!account) {
      return failure("The selected social account no longer exists.");
    }

    const existingSecrets = await getOutreachAccountSecrets(state.accountId);
    const credentials = resolveYouTubeOAuthClientCredentials(existingSecrets ?? undefined);
    if (!credentials.clientId || !credentials.clientSecret) {
      return failure("YouTube connect is missing app OAuth credentials.");
    }

    const tokens = await exchangeYouTubeOAuthCode({
      code,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      redirectUri: callbackUrl(),
    });
    console.info(
      "[youtube-callback] code exchange complete",
      JSON.stringify({
        accountId: state.accountId,
        hasRefreshToken: Boolean(tokens.refreshToken),
      })
    );
    if (!tokens.refreshToken) {
      return failure("Google did not return a refresh token. Try connecting again and choose the Google consent prompt.");
    }

    const channel = await getAuthenticatedYouTubeChannelProfile({
      accessToken: tokens.accessToken,
    });
    console.info(
      "[youtube-callback] youtube profile resolved",
      JSON.stringify({
        accountId: state.accountId,
        channelId: channel.channelId,
        hasTitle: Boolean(String(channel.title ?? "").trim()),
      })
    );
    const now = new Date().toISOString();
    const updated = await updateOutreachAccount(state.accountId, {
      config: {
        social: {
          enabled: true,
          connectionProvider: "youtube",
          linkedProvider: "youtube",
          externalAccountId: channel.channelId,
          handle: normalizeYouTubeHandle(channel.customUrl),
          profileUrl: `https://www.youtube.com/channel/${encodeURIComponent(channel.channelId)}`,
          publicIdentifier: channel.customUrl || channel.channelId,
          displayName: channel.title || account.config.social.displayName,
          bio: channel.description || account.config.social.bio,
          avatarUrl: channel.avatarUrl || account.config.social.avatarUrl,
          linkedAt: now,
          lastProfileSyncAt: now,
          platforms: Array.from(new Set([...(account.config.social.platforms ?? []), "youtube"])),
        },
      },
      credentials: {
        youtubeClientId: credentials.clientId,
        youtubeClientSecret: credentials.clientSecret,
        youtubeRefreshToken: tokens.refreshToken,
      },
    });
    if (!hasSavedYouTubeIdentity(updated, channel.channelId)) {
      const reloaded = await getOutreachAccount(state.accountId);
      if (!hasSavedYouTubeIdentity(reloaded, channel.channelId)) {
        console.error(
          "[youtube-callback] persistence verification failed",
          JSON.stringify({
            accountId: state.accountId,
            channelId: channel.channelId,
            updateReturnedAccount: Boolean(updated),
            reloadReturnedAccount: Boolean(reloaded),
            reloadExternalAccountId: String(reloaded?.config?.social?.externalAccountId ?? "").trim(),
          })
        );
        return failure("Google sign-in finished, but we could not save the YouTube account. Please try again.");
      }
      console.warn(
        "[youtube-callback] update returned incomplete account but reload succeeded",
        JSON.stringify({
          accountId: state.accountId,
          channelId: channel.channelId,
        })
      );
    }
    console.info(
      "[youtube-callback] completed successfully",
      JSON.stringify({
        accountId: state.accountId,
        channelId: channel.channelId,
      })
    );

    return NextResponse.redirect(
      redirectUrl({
        brandId: state.brandId,
        accountId: state.accountId,
        result: "success",
      })
    );
  } catch (error) {
    const message =
      error instanceof YouTubeApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : "YouTube connect failed.";
    console.error(
      "[youtube-callback] failed",
      JSON.stringify({
        accountId: state.accountId,
        brandId: state.brandId,
        message,
        errorName: error instanceof Error ? error.name : "UnknownError",
      })
    );
    return failure(message);
  }
}
