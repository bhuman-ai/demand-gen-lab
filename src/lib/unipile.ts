import type { SocialAccountConfig, SocialLinkedProvider } from "@/lib/factory-types";
import type { SocialDiscoveryPlatform, SocialDiscoveryPost } from "@/lib/social-discovery-types";
import { normalizeSocialLinkedProvider } from "@/lib/social-account-config";

type UnipileRequestOptions = {
  path: string;
  method?: "GET" | "POST";
  query?: Record<string, string | undefined>;
  body?: unknown;
};

export type UnipileResolvedPostContext = {
  lookupId: string;
  resolvedPostId: string;
  provider: string;
  url: string;
  createdAt: string;
  captionText: string;
  accessibilityCaption: string;
  ownerUsername: string;
  ownerDisplayName: string;
  likeCount: number;
  commentCount: number;
  contentText: string;
  summaryText: string;
  raw: Record<string, unknown>;
};

export type UnipileCommentDeliveryResult = {
  status: "verified" | "accepted_unverified";
  commentId: string;
  source: "comments_list" | "response" | "none";
  message: string;
  verificationError?: {
    status: number;
    type: string;
    message: string;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function unipileBaseUrl() {
  return String(process.env.UNIPILE_API_BASE_URL ?? "https://api1.unipile.com:13111")
    .trim()
    .replace(/\/+$/, "");
}

function unipileApiKey() {
  return String(process.env.UNIPILE_API_KEY ?? "").trim();
}

export function supportsUnipilePostComments(platform: SocialDiscoveryPlatform) {
  return platform === "linkedin" || platform === "instagram" || platform === "x";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nestedRecord(record: Record<string, unknown>, key: string) {
  return asRecord(record[key]);
}

function compactText(value: unknown, max = 1000) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoFromUnixSeconds(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return new Date(parsed * 1000).toISOString();
}

function normalizeProviderName(value: unknown): SocialLinkedProvider {
  return normalizeSocialLinkedProvider(value);
}

function socialPlatformToUnipileProvider(platform: string) {
  const normalized = String(platform ?? "").trim().toLowerCase();
  if (normalized === "linkedin") return "LINKEDIN";
  if (normalized === "instagram") return "INSTAGRAM";
  if (normalized === "x" || normalized === "twitter") return "TWITTER";
  return "";
}

export class UnipileApiError extends Error {
  status: number;
  type: string;
  details: Record<string, unknown>;

  constructor(message: string, input: { status: number; type?: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = "UnipileApiError";
    this.status = input.status;
    this.type = input.type ?? "";
    this.details = input.details ?? {};
  }
}

export function unipileConfigured() {
  return Boolean(unipileApiKey());
}

async function unipileRequest<T = Record<string, unknown>>(input: UnipileRequestOptions): Promise<T> {
  const apiKey = unipileApiKey();
  if (!apiKey) {
    throw new UnipileApiError("Set UNIPILE_API_KEY before sending social comments.", { status: 500 });
  }

  const url = new URL(`${unipileBaseUrl()}${input.path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (typeof value === "string" && value.trim()) {
      url.searchParams.set(key, value.trim());
    }
  }

  const response = await fetch(url.toString(), {
    method: input.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  if (raw) {
    try {
      payload = asRecord(JSON.parse(raw));
    } catch {
      payload = { raw };
    }
  }

  if (!response.ok) {
    const errorType =
      String(payload.type ?? "").trim() ||
      String(asRecord(payload.error).type ?? "").trim() ||
      String(payload.status_message ?? "").trim();
    const message =
      String(payload.message ?? "").trim() ||
      String(asRecord(payload.error).message ?? "").trim() ||
      `Unipile request failed with HTTP ${response.status}`;
    throw new UnipileApiError(message, {
      status: response.status,
      type: errorType,
      details: payload,
    });
  }

  return payload as T;
}

export async function createUnipileHostedAuthLink(input: {
  name: string;
  providers: string[];
  notifyUrl: string;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
  expiresOn?: string;
  bypassSuccessScreen?: boolean;
}) {
  const providers = Array.from(new Set(input.providers.map((entry) => String(entry ?? "").trim()).filter(Boolean)));
  if (!providers.length) {
    throw new UnipileApiError("Pick at least one provider before creating a Unipile hosted-auth link.", {
      status: 400,
    });
  }

  return unipileRequest<Record<string, unknown>>({
    path: "/api/v1/hosted/accounts/link",
    method: "POST",
    body: {
      type: "create",
      api_url: unipileBaseUrl(),
      expiresOn:
        input.expiresOn ||
        new Date(Date.now() + 45 * 60_000).toISOString(),
      name: input.name,
      providers,
      notify_url: input.notifyUrl,
      success_redirect_url: input.successRedirectUrl,
      failure_redirect_url: input.failureRedirectUrl,
      bypass_success_screen: input.bypassSuccessScreen ?? true,
    },
  });
}

export function unipileProvidersForPlatforms(platforms: string[]) {
  return Array.from(
    new Set(
      platforms
        .map((entry) => socialPlatformToUnipileProvider(entry))
        .filter(Boolean)
    )
  );
}

export async function listUnipileAccounts() {
  const payload = await unipileRequest<Record<string, unknown>>({
    path: "/api/v1/accounts",
  });
  return asArray(payload.items);
}

export async function getUnipileOwnProfile(accountId: string) {
  return unipileRequest<Record<string, unknown>>({
    path: "/api/v1/users/me",
    query: {
      account_id: accountId,
    },
  });
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function bestExternalLink(value: unknown) {
  const links = asArray(value)
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
  return links[0] ?? "";
}

function fallbackProfileUrl(linkedProvider: SocialLinkedProvider, publicIdentifier: string) {
  const id = publicIdentifier.trim().replace(/^@/, "");
  if (!id) return "";
  if (linkedProvider === "instagram") return `https://instagram.com/${id}`;
  if (linkedProvider === "linkedin") return `https://www.linkedin.com/in/${id}`;
  if (linkedProvider === "x") return `https://x.com/${id}`;
  return "";
}

function joinedName(record: Record<string, unknown>) {
  const direct = firstString(record, ["name", "full_name", "fullName", "display_name", "displayName"]);
  if (direct) return direct;
  const first = firstString(record, ["first_name", "firstName"]);
  const last = firstString(record, ["last_name", "lastName"]);
  return [first, last].filter(Boolean).join(" ").trim();
}

function accountLikeRecordById(rows: unknown[], accountId: string) {
  return rows
    .map((entry) => asRecord(entry))
    .find((row) => String(row.id ?? row.account_id ?? "").trim() === accountId) ?? null;
}

function maybePrefixedHandle(value: string) {
  const normalized = value.trim();
  if (!normalized) return "";
  return normalized.startsWith("@") ? normalized : `@${normalized}`;
}

export async function resolveUnipileSocialIdentity(accountId: string): Promise<Partial<SocialAccountConfig>> {
  const [accounts, profile] = await Promise.allSettled([listUnipileAccounts(), getUnipileOwnProfile(accountId)]);
  const accountRecord =
    accounts.status === "fulfilled" ? accountLikeRecordById(accounts.value, accountId) : null;
  const profileRecord = profile.status === "fulfilled" ? asRecord(profile.value) : {};
  const accountInfo = accountRecord ?? {};
  const accountIm = nestedRecord(nestedRecord(accountInfo, "connection_params"), "im");
  const profileBusiness = nestedRecord(profileRecord, "business");

  const linkedProvider = normalizeProviderName(
    firstString(accountInfo, ["provider", "type", "source"]) ||
      firstString(profileRecord, ["provider", "type", "source"])
  );
  const publicIdentifier = firstString(profileRecord, [
    "public_identifier",
    "publicIdentifier",
    "username",
    "handle",
    "screen_name",
    "screenName",
  ]) ||
    firstString(accountInfo, ["public_identifier", "publicIdentifier", "username", "handle"]) ||
    firstString(accountIm, ["publicIdentifier", "username", "handle"]);
  const displayName = joinedName(profileRecord) || joinedName(accountInfo);
  const headline =
    firstString(profileRecord, ["headline", "occupation", "title", "job_title", "jobTitle", "category"]) ||
    firstString(profileBusiness, ["category"]) ||
    firstString(accountInfo, ["headline", "title", "description"]);
  const bio =
    firstString(profileRecord, ["bio", "biography", "summary", "description", "about"]) ||
    firstString(accountInfo, ["bio", "summary", "description"]);
  const profileUrl =
    firstString(profileRecord, ["profile_url", "profileUrl", "public_url", "publicUrl", "url"]) ||
    firstString(accountInfo, ["profile_url", "profileUrl", "public_url", "publicUrl", "url"]) ||
    fallbackProfileUrl(linkedProvider, publicIdentifier) ||
    bestExternalLink(profileRecord.external_links);
  const avatarUrl =
    firstString(profileRecord, [
      "picture_url",
      "pictureUrl",
      "avatar_url",
      "avatarUrl",
      "photo_url",
      "photoUrl",
      "profile_picture_url",
      "profile_picture_url_large",
    ]) ||
    firstString(accountInfo, ["picture_url", "pictureUrl", "avatar_url", "avatarUrl", "photo_url", "photoUrl"]);
  const platforms =
    linkedProvider === "unknown" || !linkedProvider ? [] : [linkedProvider];

  return {
    connectionProvider: "unipile",
    linkedProvider,
    externalAccountId: accountId,
    handle: publicIdentifier ? maybePrefixedHandle(publicIdentifier) : "",
    publicIdentifier,
    displayName,
    headline,
    bio,
    profileUrl,
    avatarUrl,
    platforms,
    personaSummary: compactText([displayName, headline, bio].filter(Boolean).join(". "), 280),
    lastProfileSyncAt: new Date().toISOString(),
    linkedAt: new Date().toISOString(),
  };
}

function linkedinLookupIdFromUrl(url: URL) {
  const href = url.toString();
  const directUrn = href.match(/urn:li:(activity|ugcPost|share):\d+/i)?.[0];
  if (directUrn) return directUrn;

  const activity = href.match(/-activity-(\d+)/i)?.[1];
  if (activity) return activity;

  const ugcPost = href.match(/-ugcPost-(\d+)/i)?.[1];
  if (ugcPost) return `urn:li:ugcPost:${ugcPost}`;

  const share = href.match(/-share-(\d+)/i)?.[1];
  if (share) return `urn:li:share:${share}`;

  const feedUrn = href.match(/feed\/update\/(urn:li:[^/?#]+)/i)?.[1];
  if (feedUrn) return decodeURIComponent(feedUrn);

  return "";
}

function instagramLookupIdFromUrl(url: URL) {
  return url.pathname.match(/^\/(?:p|reel|tv)\/([^/?#]+)/i)?.[1] ?? "";
}

function xLookupIdFromUrl(url: URL) {
  return url.pathname.match(/^\/[^/]+\/status\/(\d+)/i)?.[1] ?? "";
}

function lookupIdForPost(post: Pick<SocialDiscoveryPost, "platform" | "url">) {
  try {
    const url = new URL(post.url);
    if (post.platform === "linkedin") return linkedinLookupIdFromUrl(url);
    if (post.platform === "instagram") return instagramLookupIdFromUrl(url);
    if (post.platform === "x") return xLookupIdFromUrl(url);
    return "";
  } catch {
    return "";
  }
}

function commentTargetIdFromResolvedPost(input: {
  platform: SocialDiscoveryPlatform;
  resolvedPost: Record<string, unknown>;
}) {
  if (input.platform === "linkedin") {
    return String(input.resolvedPost.social_id ?? "").trim();
  }
  if (input.platform === "instagram") {
    return String(input.resolvedPost.provider_id ?? input.resolvedPost.providerId ?? "").trim();
  }
  if (input.platform === "x") {
    return String(
      input.resolvedPost.provider_id ??
        input.resolvedPost.providerId ??
        input.resolvedPost.social_id ??
        input.resolvedPost.id ??
        ""
    ).trim();
  }
  return "";
}

function commentIdFromPayload(payload: Record<string, unknown>) {
  return String(
    payload.id ??
      payload.comment_id ??
      asRecord(payload.comment).id ??
      asRecord(payload.comment).comment_id ??
      ""
  ).trim();
}

function commentTextFromRecord(record: Record<string, unknown>) {
  return compactText(
    record.text ??
      record.body ??
      record.content ??
      record.message ??
      record.caption ??
      asRecord(record.comment).text ??
      "",
    1300
  );
}

function normalizeCommentText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

async function listUnipilePostComments(input: {
  postId: string;
  accountId: string;
}) {
  const payload = await unipileRequest<Record<string, unknown>>({
    path: `/api/v1/posts/${encodeURIComponent(input.postId)}/comments`,
    query: {
      account_id: input.accountId,
      limit: "25",
      sort_by: "MOST_RECENT",
    },
  });
  return asArray(payload.items ?? payload.comments ?? payload.data ?? payload.results).map((entry) => asRecord(entry));
}

function findDeliveredComment(input: {
  comments: Record<string, unknown>[];
  text: string;
  acceptedCommentId: string;
}) {
  const expectedText = normalizeCommentText(input.text);
  return (
    input.comments.find((comment) => {
      const commentId = String(
        comment.id ?? comment.comment_id ?? comment.provider_id ?? comment.providerId ?? ""
      ).trim();
      if (input.acceptedCommentId && commentId && commentId === input.acceptedCommentId) return true;
      const commentText = normalizeCommentText(commentTextFromRecord(comment));
      return Boolean(expectedText) && Boolean(commentText) && commentText === expectedText;
    }) ?? null
  );
}

async function confirmUnipileCommentDelivery(input: {
  postId: string;
  accountId: string;
  text: string;
  acceptedCommentId: string;
}): Promise<UnipileCommentDeliveryResult> {
  let lastError: UnipileApiError | null = null;

  for (const waitMs of [0, 1200, 3200]) {
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    try {
      const comments = await listUnipilePostComments({
        postId: input.postId,
        accountId: input.accountId,
      });
      const delivered = findDeliveredComment({
        comments,
        text: input.text,
        acceptedCommentId: input.acceptedCommentId,
      });
      if (delivered) {
        return {
          status: "verified",
          commentId:
            String(
              delivered.id ??
                delivered.comment_id ??
                delivered.provider_id ??
                delivered.providerId ??
                input.acceptedCommentId
            ).trim() || input.acceptedCommentId,
          source: "comments_list",
          message: "Comment verified on the Instagram post.",
        };
      }
    } catch (error) {
      if (error instanceof UnipileApiError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  const baseMessage = input.acceptedCommentId
    ? "Unipile accepted the comment, but Instagram visibility could not be verified yet."
    : "Unipile accepted the request, but did not return a comment id and Instagram visibility could not be verified.";
  return {
    status: "accepted_unverified",
    commentId: input.acceptedCommentId,
    source: input.acceptedCommentId ? "response" : "none",
    message: lastError ? `${baseMessage} ${lastError.message}` : baseMessage,
    verificationError: lastError
      ? {
          status: lastError.status,
          type: lastError.type,
          message: lastError.message,
        }
      : undefined,
  };
}

async function resolveUnipilePostRecord(input: {
  post: Pick<SocialDiscoveryPost, "platform" | "url">;
  accountId: string;
}) {
  if (!supportsUnipilePostComments(input.post.platform)) {
    throw new UnipileApiError(`Unipile post lookup is not supported for ${input.post.platform}.`, { status: 400 });
  }

  const lookupId = lookupIdForPost(input.post);
  if (!lookupId) {
    throw new UnipileApiError(`Could not derive a Unipile lookup id from this ${input.post.platform} URL.`, {
      status: 400,
    });
  }

  const resolvedPost = await unipileRequest<Record<string, unknown>>({
    path: `/api/v1/posts/${encodeURIComponent(lookupId)}`,
    query: {
      account_id: input.accountId,
    },
  });
  const postId = commentTargetIdFromResolvedPost({
    platform: input.post.platform,
    resolvedPost,
  });
  if (!postId) {
    throw new UnipileApiError("Unipile resolved the post but did not return a usable post id.", {
      status: 422,
      details: resolvedPost,
    });
  }

  return {
    lookupId,
    resolvedPostId: postId,
    resolvedPost,
  };
}

function normalizeResolvedPostContext(input: {
  lookupId: string;
  resolvedPostId: string;
  resolvedPost: Record<string, unknown>;
}) {
  const caption = nestedRecord(input.resolvedPost, "caption");
  const owner = nestedRecord(input.resolvedPost, "owner");
  const captionText = compactText(firstString(caption, ["text", "caption", "body"]), 2200);
  const accessibilityCaption = compactText(
    firstString(input.resolvedPost, ["accessibility_caption", "accessibilityCaption"]),
    1200
  );
  const ownerUsername = firstString(owner, ["username", "handle", "public_identifier", "publicIdentifier"]);
  const ownerDisplayName = joinedName(owner);
  const contentText = compactText(
    [captionText, accessibilityCaption].filter(Boolean).join("\n\n"),
    2600
  );
  const summaryText = compactText(
    [captionText || accessibilityCaption, ownerUsername ? `owner ${ownerUsername}` : ""].filter(Boolean).join(" · "),
    320
  );

  return {
    lookupId: input.lookupId,
    resolvedPostId: input.resolvedPostId,
    provider: firstString(input.resolvedPost, ["provider", "type", "source"]),
    url: firstString(input.resolvedPost, ["url", "permalink"]),
    createdAt:
      isoFromUnixSeconds(input.resolvedPost.created_at) ||
      firstString(input.resolvedPost, ["created_at_iso", "createdAt"]),
    captionText,
    accessibilityCaption,
    ownerUsername,
    ownerDisplayName,
    likeCount: Math.max(0, Number(input.resolvedPost.like_count ?? input.resolvedPost.likes ?? 0) || 0),
    commentCount: Math.max(0, Number(input.resolvedPost.comment_count ?? input.resolvedPost.comments ?? 0) || 0),
    contentText,
    summaryText,
    raw: input.resolvedPost,
  } satisfies UnipileResolvedPostContext;
}

export async function resolveUnipilePostContext(input: {
  post: Pick<SocialDiscoveryPost, "platform" | "url">;
  accountId: string;
}): Promise<UnipileResolvedPostContext> {
  const resolved = await resolveUnipilePostRecord(input);
  return normalizeResolvedPostContext(resolved);
}

export async function sendUnipilePostComment(input: {
  post: Pick<SocialDiscoveryPost, "platform" | "url">;
  accountId: string;
  text: string;
  commentId?: string;
}) {
  if (!supportsUnipilePostComments(input.post.platform)) {
    throw new UnipileApiError(`Unipile commenting is not supported for ${input.post.platform}.`, { status: 400 });
  }
  const { lookupId, resolvedPostId: postId, resolvedPost } = await resolveUnipilePostRecord(input);

  const payload = await unipileRequest<Record<string, unknown>>({
    path: `/api/v1/posts/${encodeURIComponent(postId)}/comments`,
    method: "POST",
    body: {
      account_id: input.accountId,
      text: input.text,
      ...(input.commentId?.trim() ? { comment_id: input.commentId.trim() } : {}),
    },
  });
  const acceptedCommentId = commentIdFromPayload(payload);
  const delivery = await confirmUnipileCommentDelivery({
    postId,
    accountId: input.accountId,
    text: input.text,
    acceptedCommentId,
  });

  return {
    lookupId,
    resolvedPostId: postId,
    resolvedPost,
    payload,
    delivery,
  };
}
