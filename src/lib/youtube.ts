import type { OutreachAccountSecrets } from "@/lib/outreach-data";
import type { SocialDiscoveryPost } from "@/lib/social-discovery-types";

const YOUTUBE_DATA_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const YOUTUBE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_WEBSUB_HUB_URL = "https://pubsubhubbub.appspot.com/subscribe";
const YOUTUBE_COMMENT_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

type YouTubeRequestOptions = {
  path: string;
  method?: "GET" | "POST";
  accessToken: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
};

export type YouTubeCommentDeliveryResult = {
  status: "verified" | "accepted_unverified";
  commentId: string;
  source: "response" | "none";
  message: string;
};

export type YouTubeWebhookEntry = {
  videoId: string;
  channelId: string;
  title: string;
  url: string;
  channelTitle: string;
  channelUrl: string;
  publishedAt: string;
  updatedAt: string;
  rawXml: string;
};

export type YouTubeChannelProfile = {
  channelId: string;
  title: string;
  description: string;
  customUrl: string;
  avatarUrl: string;
  publishedAt: string;
  raw: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstItem(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value[0] : value;
}

function textValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return textValue(value[0]);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const direct = record["$t"];
    if (typeof direct === "string") return direct.trim();
  }
  return "";
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTagValue(xml: string, tagName: string) {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return decodeXmlEntities(match?.[1]?.trim() ?? "");
}

function extractAttributeValue(xml: string, tagName: string, attribute: string) {
  const match = xml.match(new RegExp(`<${tagName}\\b[^>]*\\s${attribute}="([^"]+)"[^>]*>`, "i"));
  return decodeXmlEntities(match?.[1]?.trim() ?? "");
}

function extractEntryAuthorField(xml: string, tagName: string) {
  const authorBlock = xml.match(/<author>([\s\S]*?)<\/author>/i)?.[1] ?? "";
  return extractTagValue(authorBlock, tagName);
}

function parseXmlEntries(xml: string) {
  return Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)).map((match) => match[1] ?? "");
}

export class YouTubeApiError extends Error {
  status: number;
  type: string;
  details: Record<string, unknown>;

  constructor(message: string, input: { status: number; type?: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = "YouTubeApiError";
    this.status = input.status;
    this.type = input.type ?? "";
    this.details = input.details ?? {};
  }
}

function youtubeClientId(secrets: Pick<OutreachAccountSecrets, "youtubeClientId">) {
  return String(secrets.youtubeClientId ?? "").trim();
}

function youtubeClientSecret(secrets: Pick<OutreachAccountSecrets, "youtubeClientSecret">) {
  return String(secrets.youtubeClientSecret ?? "").trim();
}

function youtubeRefreshToken(secrets: Pick<OutreachAccountSecrets, "youtubeRefreshToken">) {
  return String(secrets.youtubeRefreshToken ?? "").trim();
}

function youtubeEnvClientId() {
  return (
    String(process.env.YOUTUBE_OAUTH_CLIENT_ID ?? "").trim() ||
    String(process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim() ||
    String(process.env.GOOGLE_CLIENT_ID ?? "").trim()
  );
}

function youtubeEnvClientSecret() {
  return (
    String(process.env.YOUTUBE_OAUTH_CLIENT_SECRET ?? "").trim() ||
    String(process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim() ||
    String(process.env.GOOGLE_CLIENT_SECRET ?? "").trim()
  );
}

export function resolveYouTubeOAuthClientCredentials(
  secrets?: Partial<Pick<OutreachAccountSecrets, "youtubeClientId" | "youtubeClientSecret">>
) {
  const clientId = String(secrets?.youtubeClientId ?? "").trim() || youtubeEnvClientId();
  const clientSecret = String(secrets?.youtubeClientSecret ?? "").trim() || youtubeEnvClientSecret();
  return {
    clientId,
    clientSecret,
  };
}

export function buildYouTubeOAuthAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  loginHint?: string;
}) {
  const clientId = String(input.clientId ?? "").trim();
  const redirectUri = String(input.redirectUri ?? "").trim();
  const state = String(input.state ?? "").trim();
  if (!clientId || !redirectUri || !state) {
    throw new YouTubeApiError("clientId, redirectUri, and state are required to start YouTube OAuth.", {
      status: 400,
    });
  }
  const url = new URL(YOUTUBE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_COMMENT_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  if (String(input.loginHint ?? "").trim()) {
    url.searchParams.set("login_hint", String(input.loginHint ?? "").trim());
  }
  return url.toString();
}

export function hasYouTubeOAuthCredentials(
  secrets: Pick<OutreachAccountSecrets, "youtubeClientId" | "youtubeClientSecret" | "youtubeRefreshToken">
) {
  const credentials = resolveYouTubeOAuthClientCredentials(secrets);
  return Boolean(credentials.clientId && credentials.clientSecret && youtubeRefreshToken(secrets));
}

export function supportsYouTubePostComments(platform: string) {
  return String(platform ?? "").trim().toLowerCase() === "youtube";
}

export function youtubeTopicUrl(channelId: string) {
  const normalizedChannelId = String(channelId ?? "").trim();
  if (!normalizedChannelId) return "";
  return `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${encodeURIComponent(normalizedChannelId)}`;
}

export function parseYouTubeVideoId(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] ?? "";
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      if (url.pathname === "/watch") {
        return url.searchParams.get("v")?.trim() ?? "";
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if ((parts[0] ?? "").toLowerCase() === "shorts") return parts[1] ?? "";
      if ((parts[0] ?? "").toLowerCase() === "live") return parts[1] ?? "";
    }
  } catch {
    return "";
  }
  return "";
}

export function buildYouTubeCommentUrl(videoId: string, commentId: string) {
  const trimmedVideoId = String(videoId ?? "").trim();
  const trimmedCommentId = String(commentId ?? "").trim();
  if (!trimmedVideoId || !trimmedCommentId) return "";
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", trimmedVideoId);
  url.searchParams.set("lc", trimmedCommentId);
  return url.toString();
}

async function refreshYouTubeAccessToken(
  secrets: Pick<OutreachAccountSecrets, "youtubeClientId" | "youtubeClientSecret" | "youtubeRefreshToken">
) {
  const credentials = resolveYouTubeOAuthClientCredentials(secrets);
  if (!credentials.clientId || !credentials.clientSecret || !youtubeRefreshToken(secrets)) {
    throw new YouTubeApiError("Set YouTube OAuth client id, client secret, and refresh token first.", {
      status: 400,
    });
  }

  const response = await fetch(YOUTUBE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: youtubeRefreshToken(secrets),
      grant_type: "refresh_token",
    }).toString(),
  });
  const raw = await response.text();
  const payload = asRecord(raw ? JSON.parse(raw) : {});

  if (!response.ok) {
    throw new YouTubeApiError(
      String(payload.error_description ?? payload.error ?? "").trim() ||
        `YouTube OAuth refresh failed with HTTP ${response.status}.`,
      {
        status: response.status,
        type: String(payload.error ?? "").trim(),
        details: payload,
      }
    );
  }

  const accessToken = String(payload.access_token ?? "").trim();
  if (!accessToken) {
    throw new YouTubeApiError("YouTube OAuth refresh completed without an access token.", {
      status: 502,
      details: payload,
    });
  }

  return accessToken;
}

export async function exchangeYouTubeOAuthCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) {
  const code = String(input.code ?? "").trim();
  const clientId = String(input.clientId ?? "").trim();
  const clientSecret = String(input.clientSecret ?? "").trim();
  const redirectUri = String(input.redirectUri ?? "").trim();
  if (!code || !clientId || !clientSecret || !redirectUri) {
    throw new YouTubeApiError("code, clientId, clientSecret, and redirectUri are required.", { status: 400 });
  }

  const response = await fetch(YOUTUBE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  const raw = await response.text();
  const payload = asRecord(raw ? JSON.parse(raw) : {});
  if (!response.ok) {
    throw new YouTubeApiError(
      String(payload.error_description ?? payload.error ?? "").trim() ||
        `YouTube OAuth code exchange failed with HTTP ${response.status}.`,
      {
        status: response.status,
        type: String(payload.error ?? "").trim(),
        details: payload,
      }
    );
  }

  const accessToken = String(payload.access_token ?? "").trim();
  if (!accessToken) {
    throw new YouTubeApiError("YouTube OAuth code exchange completed without an access token.", {
      status: 502,
      details: payload,
    });
  }

  return {
    accessToken,
    refreshToken: String(payload.refresh_token ?? "").trim(),
    scope: String(payload.scope ?? "").trim(),
    tokenType: String(payload.token_type ?? "").trim(),
    expiresIn: Number(payload.expires_in ?? 0) || 0,
    raw: payload,
  };
}

async function youtubeRequest<T = Record<string, unknown>>(input: YouTubeRequestOptions): Promise<T> {
  const url = new URL(`${YOUTUBE_DATA_API_BASE_URL}${input.path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (typeof value === "string" && value.trim()) {
      url.searchParams.set(key, value.trim());
    }
  }

  const response = await fetch(url.toString(), {
    method: input.method ?? "GET",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const raw = await response.text();
  const payload = asRecord(raw ? JSON.parse(raw) : {});

  if (!response.ok) {
    const error = asRecord(payload.error);
    throw new YouTubeApiError(
      textValue(error.message) ||
        textValue(firstItem(error, "errors")) ||
        `YouTube request failed with HTTP ${response.status}.`,
      {
        status: response.status,
        type: textValue(error.status) || textValue(firstItem(error, "errors")),
        details: payload,
      }
    );
  }

  return payload as T;
}

async function getYouTubeVideoSnippet(input: {
  videoId: string;
  accessToken: string;
}) {
  const payload = await youtubeRequest<Record<string, unknown>>({
    path: "/videos",
    accessToken: input.accessToken,
    query: {
      part: "snippet",
      id: input.videoId,
    },
  });
  const item = asRecord(asArray(payload.items)[0]);
  return asRecord(item.snippet);
}

export async function getAuthenticatedYouTubeChannelProfile(input: {
  accessToken: string;
}): Promise<YouTubeChannelProfile> {
  const payload = await youtubeRequest<Record<string, unknown>>({
    path: "/channels",
    accessToken: input.accessToken,
    query: {
      part: "snippet",
      mine: "true",
    },
  });
  const item = asRecord(asArray(payload.items)[0]);
  const snippet = asRecord(item.snippet);
  const thumbnails = asRecord(snippet.thumbnails);
  const thumbnail =
    asRecord(thumbnails.high).url ??
    asRecord(thumbnails.medium).url ??
    asRecord(thumbnails.default).url ??
    "";
  const channelId = textValue(item.id);
  if (!channelId) {
    throw new YouTubeApiError("YouTube OAuth completed, but no channel identity was returned.", {
      status: 422,
      details: payload,
    });
  }
  return {
    channelId,
    title: textValue(snippet.title),
    description: textValue(snippet.description),
    customUrl: textValue(snippet.customUrl),
    avatarUrl: textValue(thumbnail),
    publishedAt: textValue(snippet.publishedAt),
    raw: item,
  };
}

function rawYouTubeField(post: Pick<SocialDiscoveryPost, "raw">, key: string) {
  const raw = asRecord(post.raw);
  const youtube = asRecord(raw.youtube);
  const youtubeWebhook = asRecord(raw.youtubeWebhook);
  return (
    textValue(raw[key]) ||
    textValue(youtube[key]) ||
    textValue(youtubeWebhook[key])
  );
}

export async function sendYouTubeVideoComment(input: {
  post: Pick<SocialDiscoveryPost, "platform" | "url" | "raw">;
  text: string;
  secrets: Pick<OutreachAccountSecrets, "youtubeClientId" | "youtubeClientSecret" | "youtubeRefreshToken">;
}) {
  if (!supportsYouTubePostComments(input.post.platform)) {
    throw new YouTubeApiError(`YouTube commenting is not supported for ${input.post.platform}.`, { status: 400 });
  }

  const accessToken = await refreshYouTubeAccessToken(input.secrets);
  const videoId = rawYouTubeField(input.post, "videoId") || parseYouTubeVideoId(input.post.url);
  if (!videoId) {
    throw new YouTubeApiError("Could not derive a YouTube video id from this post.", { status: 400 });
  }

  const videoSnippet =
    rawYouTubeField(input.post, "channelId") && rawYouTubeField(input.post, "channelTitle")
      ? {
          channelId: rawYouTubeField(input.post, "channelId"),
          channelTitle: rawYouTubeField(input.post, "channelTitle"),
          title: rawYouTubeField(input.post, "title"),
        }
      : await getYouTubeVideoSnippet({ videoId, accessToken });
  const channelId = textValue(videoSnippet.channelId);
  if (!channelId) {
    throw new YouTubeApiError("YouTube did not return a channel id for this video.", { status: 422, details: videoSnippet });
  }

  const payload = await youtubeRequest<Record<string, unknown>>({
    path: "/commentThreads",
    method: "POST",
    accessToken,
    query: {
      part: "snippet",
    },
    body: {
      snippet: {
        channelId,
        videoId,
        topLevelComment: {
          snippet: {
            textOriginal: input.text,
          },
        },
      },
    },
  });

  const threadSnippet = asRecord(payload.snippet);
  const topLevelComment = asRecord(threadSnippet.topLevelComment);
  const topLevelCommentId = textValue(topLevelComment.id);
  const threadId = textValue(payload.id);
  const commentId = topLevelCommentId || threadId;
  const delivery: YouTubeCommentDeliveryResult = {
    status: commentId ? "verified" : "accepted_unverified",
    commentId,
    source: commentId ? "response" : "none",
    message: commentId
      ? "YouTube created the top-level comment and returned its id."
      : "YouTube accepted the request, but did not return a top-level comment id.",
  };

  return {
    lookupId: videoId,
    resolvedPostId: videoId,
    resolvedPost: {
      id: videoId,
      url: input.post.url,
      snippet: videoSnippet,
    },
    payload,
    delivery,
    videoId,
    channelId,
  };
}

export async function requestYouTubeUploadSubscription(input: {
  channelId: string;
  callbackUrl: string;
  mode?: "subscribe" | "unsubscribe";
  leaseSeconds?: number;
}) {
  const channelId = String(input.channelId ?? "").trim();
  const callbackUrl = String(input.callbackUrl ?? "").trim();
  if (!channelId) {
    throw new YouTubeApiError("channelId is required for YouTube push subscriptions.", { status: 400 });
  }
  if (!callbackUrl) {
    throw new YouTubeApiError("callbackUrl is required for YouTube push subscriptions.", { status: 400 });
  }

  const response = await fetch(YOUTUBE_WEBSUB_HUB_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "hub.callback": callbackUrl,
      "hub.mode": input.mode === "unsubscribe" ? "unsubscribe" : "subscribe",
      "hub.topic": youtubeTopicUrl(channelId),
      "hub.verify": "async",
      ...(input.leaseSeconds && input.leaseSeconds > 0
        ? { "hub.lease_seconds": String(Math.max(60, Math.round(input.leaseSeconds))) }
        : {}),
    }).toString(),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new YouTubeApiError(
      raw.trim() || `YouTube push subscription request failed with HTTP ${response.status}.`,
      { status: response.status, details: { raw } }
    );
  }

  return {
    ok: true,
    mode: input.mode === "unsubscribe" ? "unsubscribe" : "subscribe",
    channelId,
    topicUrl: youtubeTopicUrl(channelId),
    callbackUrl,
    accepted: true,
    responseText: raw.trim(),
  };
}

export function parseYouTubeWebhookFeed(xml: string): YouTubeWebhookEntry[] {
  return parseXmlEntries(xml)
    .map((entryXml) => {
      const videoId = extractTagValue(entryXml, "yt:videoId");
      const channelId = extractTagValue(entryXml, "yt:channelId");
      const url = extractAttributeValue(entryXml, "link", "href");
      const title = extractTagValue(entryXml, "title");
      const publishedAt = extractTagValue(entryXml, "published");
      const updatedAt = extractTagValue(entryXml, "updated");
      const channelTitle = extractEntryAuthorField(entryXml, "name");
      const channelUrl = extractEntryAuthorField(entryXml, "uri");
      if (!videoId || !channelId) return null;
      return {
        videoId,
        channelId,
        title,
        url,
        channelTitle,
        channelUrl,
        publishedAt,
        updatedAt,
        rawXml: entryXml,
      };
    })
    .filter((entry): entry is YouTubeWebhookEntry => Boolean(entry));
}
