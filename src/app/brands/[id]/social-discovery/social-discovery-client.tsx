"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageIntro, SectionPanel } from "@/components/ui/page-layout";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SocialAccountPoolPanel } from "./social-account-pool-panel";
import {
  canonicalApiUrl,
  redirectToCanonicalLastB2bHost,
  shouldRedirectToCanonicalLastB2bHost,
} from "@/lib/client-api-url";
import type { OutreachAccount, SocialDiscoveryYouTubeSubscription } from "@/lib/factory-types";
import { resolveSocialDiscoveryCommentPrompt } from "@/lib/social-discovery-comment-prompt";
import { cn } from "@/lib/utils";
import type {
  SocialDiscoveryCommentDelivery,
  SocialDiscoveryPost,
  SocialDiscoveryPromotionDraft,
  SocialDiscoveryPromotionPurchase,
  SocialDiscoveryRun,
  SocialDiscoveryStatus,
} from "@/lib/social-discovery-types";

type InteractionPlan = SocialDiscoveryPost["interactionPlan"] & {
  domainProfile?: string;
  fitSummary?: string;
  targetStrength?: "target" | "watch" | "skip";
  commentPosture?: string;
  mentionPolicy?: string;
  analyticsTag?: string;
  exitRules?: string[];
  routingSummary?: string;
  recommendedAccounts?: NonNullable<SocialDiscoveryPost["interactionPlan"]["recommendedAccounts"]>;
};

type DiscoveryPost = SocialDiscoveryPost & {
  interactionPlan: InteractionPlan;
};

type CommentAccountOption = {
  accountId: string;
  accountName: string;
  handle: string;
  fromEmail: string;
  externalAccountId: string;
  linkedProvider: string;
  source: "recommended" | "manual";
};

type YouTubeSubscriptionResponse = {
  subscriptions?: SocialDiscoveryYouTubeSubscription[];
};

type DiscoveryResponse = {
  brand?: {
    id?: string;
    name?: string;
    socialDiscoveryCommentPrompt?: string;
    socialDiscoveryQueries?: string[];
  };
  posts: DiscoveryPost[];
  runs: SocialDiscoveryRun[];
  savedQueries?: string[];
  suggestedQueries?: string[];
  errors?: Array<{
    platform: string;
    query: string;
    message: string;
  }>;
  summary?: {
    provider?: string;
    platforms?: string[];
    queries?: number;
    found?: number;
    saved?: number;
    errors?: number;
  };
};

const SCAN_PLATFORM = "instagram";

function postRawRecord(post: DiscoveryPost | null) {
  if (!post?.raw || typeof post.raw !== "object" || Array.isArray(post.raw)) return {};
  return post.raw as Record<string, unknown>;
}

function youtubeRawRecord(post: DiscoveryPost | null) {
  const raw = postRawRecord(post);
  const youtube = raw.youtube;
  if (!youtube || typeof youtube !== "object" || Array.isArray(youtube)) return {};
  return youtube as Record<string, unknown>;
}

function youtubeRawText(post: DiscoveryPost | null, key: string) {
  const value = youtubeRawRecord(post)[key];
  return typeof value === "string" ? value.trim() : "";
}

function youtubeRawNumber(post: DiscoveryPost | null, key: string) {
  const value = Number(youtubeRawRecord(post)[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function youtubeChannelUrl(post: DiscoveryPost | null) {
  const channelId = youtubeRawText(post, "channelId");
  if (!channelId) return "";
  return `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;
}

function planFor(post: DiscoveryPost | null): InteractionPlan | null {
  return post?.interactionPlan ?? null;
}

function formatDate(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "unknown age";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function formatPromotionPurchaseStatus(status: SocialDiscoveryPromotionPurchase["status"]) {
  switch (status) {
    case "submitted":
      return "Order submitted";
    case "requires_login":
      return "Login required";
    case "wallet_unavailable":
      return "Wallet unavailable";
    case "checkout_requires_input":
      return "Checkout needs input";
    case "requires_configuration":
      return "Local setup required";
    default:
      return "Purchase failed";
  }
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

function buildInstagramPathCommentUrl(postUrl: string, commentId: string) {
  const trimmedPostUrl = postUrl.trim();
  const trimmedCommentId = commentId.trim();
  if (!trimmedPostUrl || !trimmedCommentId) return "";
  try {
    const url = new URL(trimmedPostUrl);
    url.search = "";
    url.hash = "";
    url.pathname = `${trimTrailingSlashes(url.pathname)}/c/${encodeURIComponent(trimmedCommentId)}/`;
    return url.toString();
  } catch {
    const base = trimTrailingSlashes(trimmedPostUrl.split("#")[0]?.split("?")[0] ?? "");
    return base ? `${base}/c/${encodeURIComponent(trimmedCommentId)}/` : "";
  }
}

function buildCommentExportPayload(post: DiscoveryPost | null, delivery: SocialDiscoveryCommentDelivery | null) {
  if (!post || !delivery) return null;
  const altCommentUrl =
    post.platform === "instagram" && delivery.commentId
      ? buildInstagramPathCommentUrl(post.url, delivery.commentId)
      : "";
  return {
    platform: post.platform,
    postUrl: post.url,
    postTitle: post.title,
    commentId: delivery.commentId,
    commentUrl: delivery.commentUrl,
    altCommentUrl,
    deliveryStatus: delivery.status,
    deliverySource: delivery.source,
    postedAt: delivery.postedAt,
    account: {
      id: delivery.accountId,
      name: delivery.accountName,
      handle: delivery.accountHandle,
    },
    reply: delivery.replyDelivery
      ? {
          commentId: delivery.replyDelivery.commentId,
          commentUrl: delivery.replyDelivery.commentUrl,
          deliveryStatus: delivery.replyDelivery.status,
          deliverySource: delivery.replyDelivery.source,
          postedAt: delivery.replyDelivery.postedAt,
          account: {
            id: delivery.replyDelivery.accountId,
            name: delivery.replyDelivery.accountName,
            handle: delivery.replyDelivery.accountHandle,
          },
        }
      : null,
  };
}

function buildPromotionExportPayload(post: DiscoveryPost | null, draft: SocialDiscoveryPromotionDraft | null) {
  if (!post || !draft) return null;
  return {
    channel: draft.channel,
    objective: draft.objective,
    campaignName: draft.campaignName,
    destinationUrl: draft.destinationUrl,
    sourcePostUrl: draft.sourcePostUrl,
    sourceCommentUrl: draft.sourceCommentUrl,
    audience: draft.audience,
    headline: draft.headline,
    primaryText: draft.primaryText,
    ctaLabel: draft.ctaLabel,
    rationale: draft.rationale,
    generatedAt: draft.generatedAt,
    postId: post.id,
    brandId: post.brandId,
  };
}

const discoveryCacheKey = (brandId: string) => `social-discovery-cache:${brandId}`;

function readCachedDiscovery(brandId: string): DiscoveryResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(discoveryCacheKey(brandId));
    if (!raw) return null;
    const data = JSON.parse(raw) as DiscoveryResponse & { cachedAt?: string };
    return {
      brand: data.brand && typeof data.brand === "object" ? data.brand : undefined,
      posts: Array.isArray(data.posts) ? data.posts : [],
      runs: Array.isArray(data.runs) ? data.runs : [],
      savedQueries: Array.isArray(data.savedQueries)
        ? data.savedQueries.filter((entry): entry is string => typeof entry === "string")
        : [],
      suggestedQueries: Array.isArray(data.suggestedQueries)
        ? data.suggestedQueries.filter((entry): entry is string => typeof entry === "string")
        : [],
      errors: Array.isArray(data.errors) ? data.errors : [],
      summary: data.summary && typeof data.summary === "object" ? data.summary : undefined,
    };
  } catch {
    return null;
  }
}

function writeCachedDiscovery(brandId: string, data: DiscoveryResponse) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      discoveryCacheKey(brandId),
      JSON.stringify({
        ...data,
        posts: Array.isArray(data.posts) ? data.posts : [],
        savedQueries: Array.isArray(data.savedQueries) ? data.savedQueries : [],
        suggestedQueries: Array.isArray(data.suggestedQueries) ? data.suggestedQueries : [],
        cachedAt: new Date().toISOString(),
      })
    );
  } catch {
    // Ignore cache write failures.
  }
}

function clearCachedDiscovery(brandId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(discoveryCacheKey(brandId));
  } catch {
    // Ignore cache clear failures.
  }
}

function filterPostsByStatus(posts: DiscoveryPost[], status: SocialDiscoveryStatus | "all") {
  return status === "all" ? posts : posts.filter((post) => post.status === status);
}

function latestRunIdFrom(data: DiscoveryResponse | null | undefined) {
  return typeof data?.runs?.[0]?.id === "string" ? data.runs[0].id : "";
}

function normalizeQueries(value: string[] | undefined) {
  return (value ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sameQueries(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => entry === right[index]);
}

function baselineQueriesFor(data: DiscoveryResponse | null | undefined) {
  const saved = normalizeQueries(data?.savedQueries);
  if (saved.length) return saved;
  return normalizeQueries(data?.suggestedQueries);
}

function preferredPostId(posts: DiscoveryPost[]) {
  return (
    posts.find((post) => {
      const plan = planFor(post);
      return plan?.targetStrength === "target" && Boolean(plan.sequence?.[0]?.draft?.trim());
    })?.id ||
    posts.find((post) => Boolean(planFor(post)?.sequence?.[0]?.draft?.trim()))?.id ||
    posts[0]?.id ||
    ""
  );
}

async function readDiscoveryResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Social discovery request failed");
  }
  return {
    brand: data?.brand && typeof data.brand === "object" ? data.brand : undefined,
    posts: Array.isArray(data?.posts) ? data.posts : [],
    runs: Array.isArray(data?.runs) ? data.runs : data?.run ? [data.run] : [],
    savedQueries: Array.isArray(data?.savedQueries) ? data.savedQueries : [],
    suggestedQueries: Array.isArray(data?.suggestedQueries) ? data.suggestedQueries : [],
    errors: Array.isArray(data?.errors) ? data.errors : [],
    summary: data?.summary && typeof data.summary === "object" ? data.summary : undefined,
  } as DiscoveryResponse;
}

export default function SocialDiscoveryClient({ brandId }: { brandId: string }) {
  const redirectingToCanonicalHost = shouldRedirectToCanonicalLastB2bHost();
  const [posts, setPosts] = useState<DiscoveryPost[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [status] = useState<SocialDiscoveryStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [commentAccountId, setCommentAccountId] = useState("");
  const [commentReplyId, setCommentReplyId] = useState("");
  const [commentError, setCommentError] = useState("");
  const [commentThreadWarning, setCommentThreadWarning] = useState("");
  const [commentResult, setCommentResult] = useState<SocialDiscoveryCommentDelivery | null>(null);
  const [draftingPostId, setDraftingPostId] = useState("");
  const [draftGenerationErrors, setDraftGenerationErrors] = useState<Record<string, string>>({});
  const [sendingComment, setSendingComment] = useState(false);
  const [replyEnabled, setReplyEnabled] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyAccountId, setReplyAccountId] = useState("");
  const [promoError, setPromoError] = useState("");
  const [creatingPromo, setCreatingPromo] = useState(false);
  const [promoResult, setPromoResult] = useState<SocialDiscoveryPromotionDraft | null>(null);
  const [purchaseResult, setPurchaseResult] = useState<SocialDiscoveryPromotionPurchase | null>(null);
  const [youtubeSearchDraft, setYouTubeSearchDraft] = useState("");
  const [youtubeSearchError, setYouTubeSearchError] = useState("");
  const [youtubeSearchSummary, setYouTubeSearchSummary] = useState("");
  const [searchingYouTube, setSearchingYouTube] = useState(false);
  const [queryDraft, setQueryDraft] = useState("");
  const [savedQueries, setSavedQueries] = useState<string[]>([]);
  const [suggestedQueries, setSuggestedQueries] = useState<string[]>([]);
  const [savingQueries, setSavingQueries] = useState(false);
  const [savedBrandCommentPrompt, setSavedBrandCommentPrompt] = useState("");
  const [brandCommentPromptDraft, setBrandCommentPromptDraft] = useState("");
  const [savingBrandCommentPrompt, setSavingBrandCommentPrompt] = useState(false);
  const [brandCommentPromptError, setBrandCommentPromptError] = useState("");
  const [socialAccounts, setSocialAccounts] = useState<OutreachAccount[]>([]);
  const [youtubeSubscriptions, setYouTubeSubscriptions] = useState<SocialDiscoveryYouTubeSubscription[]>([]);
  const [youtubeChannelIdDraft, setYouTubeChannelIdDraft] = useState("");
  const [youtubeSubscriptionAccountId, setYouTubeSubscriptionAccountId] = useState("");
  const [youtubeAutoCommentEnabled, setYouTubeAutoCommentEnabled] = useState(true);
  const [youtubeSubscriptionError, setYouTubeSubscriptionError] = useState("");
  const [savingYouTubeSubscription, setSavingYouTubeSubscription] = useState(false);
  const [removingYouTubeChannelId, setRemovingYouTubeChannelId] = useState("");
  const previousSelectedPostIdRef = useRef("");
  const lastAutoCommentDraftRef = useRef("");
  const lastAutoReplyDraftRef = useRef("");
  const attemptedAutoDraftPostIdsRef = useRef<Set<string>>(new Set());

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedId) ?? posts[0] ?? null,
    [posts, selectedId]
  );
  const queryList = useMemo(() => normalizeQueries(queryDraft.split("\n")), [queryDraft]);
  const baselineQueries = useMemo(
    () => (savedQueries.length ? savedQueries : suggestedQueries),
    [savedQueries, suggestedQueries]
  );
  const queriesDirty = useMemo(() => !sameQueries(queryList, baselineQueries), [queryList, baselineQueries]);
  const queryStatusMessage = savingQueries
    ? "Saving prompts..."
    : queriesDirty
      ? "Unsaved changes."
      : savedQueries.length
        ? "Saved for this brand."
        : "Using generated prompts for this brand.";
  const effectiveSavedBrandCommentPrompt = useMemo(
    () => resolveSocialDiscoveryCommentPrompt(savedBrandCommentPrompt),
    [savedBrandCommentPrompt]
  );
  const brandCommentPromptDirty = brandCommentPromptDraft.trim() !== effectiveSavedBrandCommentPrompt.trim();
  const brandCommentPromptStatusMessage = savingBrandCommentPrompt
    ? "Saving prompt..."
    : brandCommentPromptDirty
      ? "Unsaved changes."
      : savedBrandCommentPrompt.trim()
        ? "Saved for this brand."
        : "Using the default comment prompt.";
  const selectedPlan = planFor(selectedPost);
  const generatedCommentDraft = useMemo(() => selectedPlan?.sequence?.[0]?.draft?.trim() ?? "", [selectedPlan]);
  const generatedReplyDraft = useMemo(() => selectedPlan?.sequence?.[1]?.draft?.trim() ?? "", [selectedPlan]);
  const selectedDraftGenerationError = selectedPost ? draftGenerationErrors[selectedPost.id] ?? "" : "";
  const commentGenerationPending = Boolean(
    (selectedPost && selectedPost.id === draftingPostId) ||
      (selectedPost &&
        selectedPlan?.targetStrength === "target" &&
        !generatedCommentDraft)
  );
  const selectedCommentPlatform = selectedPost?.platform === "youtube" ? "youtube" : "instagram";
  const selectedCommentProvider = selectedCommentPlatform === "youtube" ? "youtube" : "unipile";
  const selectedCommentPlatformLabel = selectedCommentPlatform === "youtube" ? "YouTube" : "Instagram";
  const primaryRecommendedAccounts = useMemo(
    () =>
      (selectedPlan?.recommendedAccounts ?? []).filter(
        (account) =>
          account.useCase === "primary_comment" &&
          account.connectionProvider === selectedCommentProvider &&
          (selectedCommentProvider === "youtube" || Boolean(account.externalAccountId))
      ),
    [selectedCommentProvider, selectedPlan]
  );
  const commentAccountOptions = useMemo(() => {
    const options = new Map<string, CommentAccountOption>();
    for (const account of primaryRecommendedAccounts) {
      options.set(account.accountId, {
        accountId: account.accountId,
        accountName: account.accountName,
        handle: account.handle,
        fromEmail: account.fromEmail,
        externalAccountId: account.externalAccountId,
        linkedProvider: account.linkedProvider,
        source: "recommended",
      });
    }
    for (const account of socialAccounts) {
      if (account.status !== "active") continue;
      if (!account.config.social.enabled) continue;
      if (account.config.social.connectionProvider !== selectedCommentProvider) continue;
      if (!account.config.social.platforms.includes(selectedCommentPlatform)) continue;
      if (selectedCommentProvider !== "youtube") {
        if (account.config.social.linkedProvider !== "instagram") continue;
        if (!account.config.social.externalAccountId.trim()) continue;
      }
      if (options.has(account.id)) continue;
      options.set(account.id, {
        accountId: account.id,
        accountName: account.name,
        handle: account.config.social.handle.trim(),
        fromEmail: account.config.customerIo.fromEmail.trim(),
        externalAccountId: account.config.social.externalAccountId.trim(),
        linkedProvider: account.config.social.linkedProvider.trim(),
        source: "manual",
      });
    }
    return Array.from(options.values());
  }, [primaryRecommendedAccounts, selectedCommentPlatform, selectedCommentProvider, socialAccounts]);
  const selectedCommentAccount = useMemo(
    () => commentAccountOptions.find((account) => account.accountId === commentAccountId) ?? commentAccountOptions[0] ?? null,
    [commentAccountId, commentAccountOptions]
  );
  const replyAccountOptions = useMemo(
    () => commentAccountOptions.filter((account) => account.accountId !== commentAccountId),
    [commentAccountId, commentAccountOptions]
  );
  const canAddTeammateReply = selectedCommentPlatform === "youtube" && replyAccountOptions.length > 0;
  const youtubeAccountOptions = useMemo(() => {
    return socialAccounts
      .filter(
        (account) =>
          account.status === "active" &&
          account.config.social.enabled &&
          account.config.social.connectionProvider === "youtube" &&
          account.config.social.platforms.includes("youtube")
      )
      .map((account) => ({
        accountId: account.id,
        accountName: account.name,
        handle: account.config.social.handle.trim(),
        fromEmail: account.config.customerIo.fromEmail.trim(),
        externalAccountId: account.config.social.externalAccountId.trim(),
        linkedProvider: account.config.social.linkedProvider.trim(),
        source: "manual" as const,
      }));
  }, [socialAccounts]);
  const visibleCommentDelivery = commentResult ?? selectedPost?.commentDelivery ?? null;
  const commentExportPayload = useMemo(
    () => buildCommentExportPayload(selectedPost, visibleCommentDelivery),
    [selectedPost, visibleCommentDelivery]
  );
  const commentExportJson = useMemo(
    () => (commentExportPayload ? JSON.stringify(commentExportPayload, null, 2) : ""),
    [commentExportPayload]
  );
  const visiblePromotionDraft = promoResult ?? selectedPost?.promotionDraft ?? null;
  const promotionExportPayload = useMemo(
    () => buildPromotionExportPayload(selectedPost, visiblePromotionDraft),
    [selectedPost, visiblePromotionDraft]
  );
  const promotionExportJson = useMemo(
    () => (promotionExportPayload ? JSON.stringify(promotionExportPayload, null, 2) : ""),
    [promotionExportPayload]
  );
  const visiblePromotionPurchase = purchaseResult ?? selectedPost?.promotionPurchase ?? null;
  const selectedCommentAccountNeedsOverride = Boolean(selectedCommentAccount && selectedCommentAccount.source === "manual");
  const selectedYouTubeChannelId = youtubeRawText(selectedPost, "channelId");
  const selectedYouTubeChannelTitle = youtubeRawText(selectedPost, "channelTitle");
  const selectedYouTubeSubscriberCount = youtubeRawNumber(selectedPost, "subscriberCount");
  const selectedYouTubeViewCount = youtubeRawNumber(selectedPost, "videoViewCount");
  const selectedYouTubeCommentCount = youtubeRawNumber(selectedPost, "videoCommentCount");
  const canRestoreSuggestedComment = Boolean(
    generatedCommentDraft.trim() && generatedCommentDraft.trim() !== commentDraft.trim()
  );
  const canRestoreSuggestedReply = Boolean(
    generatedReplyDraft.trim() && generatedReplyDraft.trim() !== replyDraft.trim()
  );
  const emptyCommentMessage = useMemo(() => {
    if (!selectedPost || !selectedPlan || generatedCommentDraft || commentGenerationPending) return "";
    if (selectedDraftGenerationError) return selectedDraftGenerationError;
    if (selectedPlan.commentPosture === "watch_only" || selectedPlan.targetStrength === "watch") {
      return "This video is watch-only for this brand, so no comment draft was created.";
    }
    return "No draft was created for this video yet. Pick another result or write your own comment.";
  }, [commentGenerationPending, generatedCommentDraft, selectedDraftGenerationError, selectedPlan, selectedPost]);
  const selectedYouTubeChannelIsWatched = useMemo(
    () => Boolean(selectedYouTubeChannelId && youtubeSubscriptions.some((entry) => entry.channelId === selectedYouTubeChannelId)),
    [selectedYouTubeChannelId, youtubeSubscriptions]
  );

  function replacePost(nextPost: DiscoveryPost) {
    setPosts((current) => current.map((post) => (post.id === nextPost.id ? nextPost : post)));
  }

  async function requestCommentDraftForPost(
    postId: string,
    options?: {
      mode?: "solo" | "thread";
      adoptFreshDrafts?: boolean;
    }
  ) {
    const mode = options?.mode === "thread" ? "thread" : "solo";
    setDraftingPostId(postId);
    setDraftGenerationErrors((current) => ({ ...current, [postId]: "" }));
    try {
      const response = await fetch(canonicalApiUrl(`/api/brands/${brandId}/social-discovery/comment-draft`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, mode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to generate a comment draft");
      }
      const updatedPost = data?.post && typeof data.post === "object" ? (data.post as DiscoveryPost) : null;
      if (!updatedPost) return;
      replacePost(updatedPost);
      if (options?.adoptFreshDrafts) {
        const nextPlan = planFor(updatedPost);
        const nextCommentDraft = nextPlan?.sequence?.[0]?.draft?.trim() ?? "";
        const nextReplyDraft = mode === "thread" ? nextPlan?.sequence?.[1]?.draft?.trim() ?? "" : "";
        setCommentDraft(nextCommentDraft);
        lastAutoCommentDraftRef.current = nextCommentDraft;
        setReplyDraft(nextReplyDraft);
        lastAutoReplyDraftRef.current = nextReplyDraft;
      }
      if (!planFor(updatedPost)?.sequence?.[0]?.draft?.trim()) {
        setDraftGenerationErrors((current) => ({
          ...current,
          [postId]: "No clean draft for this video. Pick another video or write one manually.",
        }));
      }
    } catch (err) {
      setDraftGenerationErrors((current) => ({
        ...current,
        [postId]: err instanceof Error ? err.message : "Failed to generate a comment draft",
      }));
    } finally {
      setDraftingPostId((current) => (current === postId ? "" : current));
    }
  }

  const generateCommentDraftForPost = useEffectEvent((postId: string) => {
    void requestCommentDraftForPost(postId, { mode: "solo" });
  });

  useEffect(() => {
    if (!redirectingToCanonicalHost) return;
    redirectToCanonicalLastB2bHost();
  }, [redirectingToCanonicalHost]);

  useEffect(() => {
    const nextPostId = selectedPost?.id ?? "";
    if (!nextPostId) {
      previousSelectedPostIdRef.current = "";
      lastAutoCommentDraftRef.current = "";
      lastAutoReplyDraftRef.current = "";
      return;
    }

    if (previousSelectedPostIdRef.current === nextPostId) {
      if (!commentAccountId && commentAccountOptions[0]?.accountId) {
        setCommentAccountId(commentAccountOptions[0].accountId);
      }
      return;
    }

    previousSelectedPostIdRef.current = nextPostId;
    setCommentDraft(generatedCommentDraft);
    lastAutoCommentDraftRef.current = generatedCommentDraft;
    setReplyDraft(generatedReplyDraft);
    lastAutoReplyDraftRef.current = generatedReplyDraft;
    setReplyEnabled(false);
    setCommentAccountId(commentAccountOptions[0]?.accountId ?? "");
    setReplyAccountId("");
    setCommentReplyId("");
    setCommentError("");
    setCommentThreadWarning("");
    setCommentResult(null);
    setPromoError("");
    setPromoResult(null);
    setPurchaseResult(null);
  }, [selectedPost?.id, generatedCommentDraft, generatedReplyDraft, commentAccountOptions, commentAccountId]);

  useEffect(() => {
    if (!selectedPost?.id || !generatedCommentDraft) return;
    if (!commentDraft.trim() || commentDraft === lastAutoCommentDraftRef.current) {
      setCommentDraft(generatedCommentDraft);
      lastAutoCommentDraftRef.current = generatedCommentDraft;
    }
  }, [selectedPost?.id, generatedCommentDraft, commentDraft]);

  useEffect(() => {
    if (!selectedPost?.id || !generatedReplyDraft) return;
    if (!replyDraft.trim() || replyDraft === lastAutoReplyDraftRef.current) {
      setReplyDraft(generatedReplyDraft);
      lastAutoReplyDraftRef.current = generatedReplyDraft;
    }
  }, [selectedPost?.id, generatedReplyDraft, replyDraft]);

  useEffect(() => {
    const postId = selectedPost?.id ?? "";
    if (!postId) return;
    if (selectedCommentPlatform !== "youtube") return;
    if (generatedCommentDraft) return;
    if (draftingPostId === postId) return;
    if (attemptedAutoDraftPostIdsRef.current.has(postId)) return;
    attemptedAutoDraftPostIdsRef.current.add(postId);
    void generateCommentDraftForPost(postId);
  }, [draftingPostId, generatedCommentDraft, selectedCommentPlatform, selectedPost?.id]);

  useEffect(() => {
    if (youtubeSubscriptionAccountId && youtubeAccountOptions.some((account) => account.accountId === youtubeSubscriptionAccountId)) {
      return;
    }
    setYouTubeSubscriptionAccountId(youtubeAccountOptions[0]?.accountId ?? "");
  }, [youtubeAccountOptions, youtubeSubscriptionAccountId]);

  useEffect(() => {
    if (replyAccountId && replyAccountOptions.some((account) => account.accountId === replyAccountId)) {
      return;
    }
    setReplyAccountId(replyAccountOptions[0]?.accountId ?? "");
  }, [replyAccountId, replyAccountOptions]);

  async function loadCommentAccounts() {
    try {
      const response = await fetch(canonicalApiUrl("/api/outreach/accounts?scope=social"), { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to load social accounts");
      }
      setSocialAccounts(Array.isArray(data?.accounts) ? (data.accounts as OutreachAccount[]) : []);
    } catch {
      setSocialAccounts([]);
    }
  }

  async function loadYouTubeSubscriptions() {
    try {
      const response = await fetch(canonicalApiUrl(`/api/brands/${brandId}/social-discovery/youtube-subscriptions`), {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as YouTubeSubscriptionResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to load YouTube subscriptions");
      }
      setYouTubeSubscriptionError("");
      setYouTubeSubscriptions(Array.isArray(data.subscriptions) ? data.subscriptions : []);
    } catch (err) {
      setYouTubeSubscriptionError(
        err instanceof Error ? err.message : "Failed to load YouTube subscriptions"
      );
      setYouTubeSubscriptions([]);
    }
  }

  async function loadPosts(nextStatus = status) {
    setLoading(true);
    setError("");
    attemptedAutoDraftPostIdsRef.current.clear();
    setDraftingPostId("");
    setDraftGenerationErrors({});
    try {
      const query = nextStatus === "all" ? "" : `?status=${nextStatus}`;
      const response = await fetch(canonicalApiUrl(`/api/brands/${brandId}/social-discovery${query}`), {
        cache: "no-store",
      });
      const data = await readDiscoveryResponse(response);
      const cached = readCachedDiscovery(brandId);
      const latestRunId = latestRunIdFrom(data);
      const cachedLatestRunId = latestRunIdFrom(cached);
      const shouldUseCachedPosts =
        data.posts.length === 0 &&
        Boolean(cached?.posts.length) &&
        Boolean(latestRunId) &&
        latestRunId === cachedLatestRunId;
      const hasServerData =
        data.posts.length > 0 ||
        data.runs.length > 0 ||
        normalizeQueries(data.savedQueries).length > 0 ||
        normalizeQueries(data.suggestedQueries).length > 0;
      const nextData = shouldUseCachedPosts
        ? {
            posts: filterPostsByStatus(cached?.posts ?? [], nextStatus),
            runs: data.runs.length ? data.runs : cached?.runs ?? [],
            savedQueries:
              normalizeQueries(data.savedQueries).length
                ? normalizeQueries(data.savedQueries)
                : normalizeQueries(cached?.savedQueries),
            suggestedQueries:
              normalizeQueries(data.suggestedQueries).length
                ? normalizeQueries(data.suggestedQueries)
                : normalizeQueries(cached?.suggestedQueries),
            errors: data.errors?.length ? data.errors : cached?.errors ?? [],
            summary: data.summary ?? cached?.summary,
            brand: data.brand ?? cached?.brand,
          }
        : hasServerData
        ? data
        : (() => {
            if (!cached) return data;
            return {
              ...cached,
              posts: filterPostsByStatus(cached.posts, nextStatus),
            };
          })();
      setPosts(nextData.posts);
      const nextSavedQueries = normalizeQueries(nextData.savedQueries);
      const nextSuggestedQueries = normalizeQueries(nextData.suggestedQueries);
      const nextQueries = baselineQueriesFor(nextData);
      const nextBrandCommentPrompt =
        typeof nextData.brand?.socialDiscoveryCommentPrompt === "string" ? nextData.brand.socialDiscoveryCommentPrompt : "";
      const nextEffectiveBrandCommentPrompt = resolveSocialDiscoveryCommentPrompt(nextBrandCommentPrompt);
      setSavedQueries(nextSavedQueries);
      setSuggestedQueries(nextSuggestedQueries);
      setSavedBrandCommentPrompt(nextBrandCommentPrompt);
      setBrandCommentPromptDraft((current) =>
        !current.trim() || current.trim() === effectiveSavedBrandCommentPrompt.trim()
          ? nextEffectiveBrandCommentPrompt
          : current
      );
      setQueryDraft((current) => (current.trim() ? current : nextQueries.join("\n")));
      if (hasServerData) {
        writeCachedDiscovery(brandId, {
          ...data,
          posts: nextStatus === "all" ? data.posts : filterPostsByStatus(data.posts, "all"),
        });
      }
      setSelectedId((current) =>
        current && nextData.posts.some((post) => post.id === current) ? current : preferredPostId(nextData.posts)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load social discovery");
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }

  async function saveQueries(options?: { silent?: boolean; nextQueries?: string[] }) {
    const nextQueries = normalizeQueries(options?.nextQueries ?? queryDraft.split("\n"));
    setSavingQueries(true);
    setError("");
    try {
      const response = await fetch(canonicalApiUrl(`/api/brands/${brandId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          socialDiscoveryQueries: nextQueries,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to save search prompts");
      }
      const nextSavedQueries = normalizeQueries(data?.brand?.socialDiscoveryQueries);
      const nextSuggestedQueries = normalizeQueries(data?.socialDiscoverySuggestedQueries);
      const nextBaselineQueries = nextSavedQueries.length ? nextSavedQueries : nextSuggestedQueries;
      setSavedQueries(nextSavedQueries);
      setSuggestedQueries(nextSuggestedQueries);
      if (!options?.silent || nextQueries.length === 0) {
        setQueryDraft(nextBaselineQueries.join("\n"));
      }
      const cached = readCachedDiscovery(brandId);
      if (cached) {
        writeCachedDiscovery(brandId, {
          ...cached,
          brand: {
            ...cached.brand,
            ...(data?.brand && typeof data.brand === "object" ? data.brand : {}),
          },
          savedQueries: nextSavedQueries,
          suggestedQueries: nextSuggestedQueries,
        });
      }
    } finally {
      setSavingQueries(false);
    }
  }

  async function saveBrandCommentPrompt() {
    setSavingBrandCommentPrompt(true);
    setBrandCommentPromptError("");
    try {
      const response = await fetch(canonicalApiUrl(`/api/brands/${brandId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          socialDiscoveryCommentPrompt: brandCommentPromptDraft.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to save comment prompt");
      }
      const nextPrompt =
        typeof data?.brand?.socialDiscoveryCommentPrompt === "string"
          ? data.brand.socialDiscoveryCommentPrompt
          : brandCommentPromptDraft.trim();
      setSavedBrandCommentPrompt(nextPrompt);
      setBrandCommentPromptDraft(resolveSocialDiscoveryCommentPrompt(nextPrompt));
      const cached = readCachedDiscovery(brandId);
      if (cached) {
        writeCachedDiscovery(brandId, {
          ...cached,
          brand: {
            ...cached.brand,
            ...(data?.brand && typeof data.brand === "object" ? data.brand : {}),
            socialDiscoveryCommentPrompt: nextPrompt,
          },
        });
      }
    } catch (err) {
      setBrandCommentPromptError(err instanceof Error ? err.message : "Failed to save comment prompt");
    } finally {
      setSavingBrandCommentPrompt(false);
    }
  }

  useEffect(() => {
    if (redirectingToCanonicalHost) return;
    void loadPosts(status);
    void loadCommentAccounts();
    void loadYouTubeSubscriptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, redirectingToCanonicalHost, status]);

  async function runYouTubeSearch() {
    const query = youtubeSearchDraft.trim();
    if (!query) {
      setYouTubeSearchError("Enter a niche or search term first.");
      return;
    }

    setSearchingYouTube(true);
    setYouTubeSearchError("");
    setYouTubeSearchSummary("");
    setError("");
    attemptedAutoDraftPostIdsRef.current.clear();
    setDraftingPostId("");
    setDraftGenerationErrors({});
    try {
      const response = await fetch(canonicalApiUrl(`/api/brands/${brandId}/social-discovery/youtube-discovery`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          accountId: youtubeAccountOptions[0]?.accountId || undefined,
          maxResults: 12,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to search YouTube");
      }
      const nextPosts = Array.isArray(data?.posts) ? (data.posts as DiscoveryPost[]) : [];
      setPosts(nextPosts);
      setSelectedId(preferredPostId(nextPosts));
      setYouTubeSearchSummary(
        nextPosts.length
          ? `${nextPosts.length} video leads for "${query}".`
          : `No recent YouTube video leads found for "${query}".`
      );
    } catch (err) {
      setYouTubeSearchError(err instanceof Error ? err.message : "Failed to search YouTube");
    } finally {
      setSearchingYouTube(false);
    }
  }

  async function runScan() {
    setScanning(true);
    setError("");
    attemptedAutoDraftPostIdsRef.current.clear();
    setDraftingPostId("");
    setDraftGenerationErrors({});
    try {
      const nextQueries = normalizeQueries(queryDraft.split("\n"));
      if (!sameQueries(nextQueries, baselineQueries)) {
        await saveQueries({ silent: true, nextQueries });
      }
      const response = await fetch(canonicalApiUrl(`/api/brands/${brandId}/social-discovery`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "scan",
          provider: "auto",
          platforms: [SCAN_PLATFORM],
          queries: nextQueries,
          maxQueries: 6,
          limitPerQuery: 10,
        }),
      });
      const data = await readDiscoveryResponse(response);
      writeCachedDiscovery(brandId, data);
      const filteredPosts = filterPostsByStatus(data.posts, status);
      setPosts(filteredPosts);
      const nextSavedQueries = normalizeQueries(data.savedQueries);
      const nextSuggestedQueries = normalizeQueries(data.suggestedQueries);
      setSavedQueries(nextSavedQueries);
      setSuggestedQueries(nextSuggestedQueries);
      setQueryDraft(baselineQueriesFor(data).join("\n"));
      setSelectedId(preferredPostId(filteredPosts));
      if (!filteredPosts.length) {
        await loadPosts(status);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run social discovery");
    } finally {
      setScanning(false);
    }
  }

  async function saveYouTubeSubscription(options?: {
    channelId?: string;
    accountId?: string;
    autoComment?: boolean;
    leaseSeconds?: number;
  }) {
    const channelId = (options?.channelId ?? youtubeChannelIdDraft).trim();
    const autoComment = options?.autoComment ?? youtubeAutoCommentEnabled;
    const accountId = (options?.accountId ?? youtubeSubscriptionAccountId).trim();
    if (!channelId) {
      setYouTubeSubscriptionError("Enter a YouTube channel id first.");
      return;
    }
    if (autoComment && !accountId) {
      setYouTubeSubscriptionError("Pick a YouTube account before enabling auto comment.");
      return;
    }

    setSavingYouTubeSubscription(true);
    setYouTubeSubscriptionError("");
    try {
      const response = await fetch(canonicalApiUrl(`/api/brands/${brandId}/social-discovery/youtube-subscriptions`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          accountId: accountId || undefined,
          autoComment,
          leaseSeconds: options?.leaseSeconds ?? undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as YouTubeSubscriptionResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to save YouTube subscription");
      }
      setYouTubeSubscriptions(Array.isArray(data.subscriptions) ? data.subscriptions : []);
      setYouTubeChannelIdDraft("");
    } catch (err) {
      setYouTubeSubscriptionError(
        err instanceof Error ? err.message : "Failed to save YouTube subscription"
      );
    } finally {
      setSavingYouTubeSubscription(false);
    }
  }

  async function removeYouTubeSubscription(channelId: string) {
    if (!channelId.trim()) return;
    setRemovingYouTubeChannelId(channelId);
    setYouTubeSubscriptionError("");
    try {
      const response = await fetch(canonicalApiUrl(`/api/brands/${brandId}/social-discovery/youtube-subscriptions`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      });
      const data = (await response.json().catch(() => ({}))) as YouTubeSubscriptionResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to remove YouTube subscription");
      }
      setYouTubeSubscriptions(Array.isArray(data.subscriptions) ? data.subscriptions : []);
    } catch (err) {
      setYouTubeSubscriptionError(
        err instanceof Error ? err.message : "Failed to remove YouTube subscription"
      );
    } finally {
      setRemovingYouTubeChannelId("");
    }
  }

  async function copyText(value: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  async function sendComment() {
    if (!selectedPost) return;
    if (!commentDraft.trim()) {
      setCommentError("Write a comment before sending.");
      return;
    }
    if (!commentAccountId) {
      setCommentError(`Pick a routed ${selectedCommentPlatformLabel} account before sending.`);
      return;
    }
    if (replyEnabled && !replyDraft.trim()) {
      setCommentError("Write the teammate reply before sending the thread.");
      return;
    }
    if (replyEnabled && !replyAccountId) {
      setCommentError("Pick a second account for the teammate reply.");
      return;
    }

    setSendingComment(true);
    setCommentError("");
    setCommentThreadWarning("");
    setCommentResult(null);
    setPurchaseResult(null);
    try {
      const response = await fetch(canonicalApiUrl(`/api/brands/${brandId}/social-discovery/comment`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: selectedPost.id,
          accountId: commentAccountId,
          text: commentDraft.trim(),
          commentId: commentReplyId.trim() || undefined,
          replyText: replyEnabled ? replyDraft.trim() : undefined,
          replyAccountId: replyEnabled ? replyAccountId : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404 && typeof data?.error === "string" && data.error === "social discovery post not found") {
          clearCachedDiscovery(brandId);
          await loadPosts(status);
          throw new Error("That post is no longer available. The list has been refreshed.");
        }
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to send comment");
      }
      setPromoError("");

      const updatedPost = data?.post as DiscoveryPost | undefined;
      if (updatedPost?.id) {
        setPosts((current) => {
          const next = current.map((post) => (post.id === updatedPost.id ? updatedPost : post));
          const cached = readCachedDiscovery(brandId);
          if (cached) {
            writeCachedDiscovery(brandId, {
              ...cached,
              posts: cached.posts.map((post) => (post.id === updatedPost.id ? updatedPost : post)),
            });
          }
          return next;
        });
        setSelectedId(updatedPost.id);
      } else {
        await loadPosts(status);
      }

      if (typeof data?.replyError?.message === "string" && data.replyError.message.trim()) {
        setCommentThreadWarning(`Main comment posted. Teammate reply failed: ${data.replyError.message.trim()}`);
      }

      const deliveryMessage =
        typeof data?.result?.deliveryMessage === "string" && data.result.deliveryMessage.trim()
          ? data.result.deliveryMessage.trim()
          : "";
      const deliveryStatus =
        typeof data?.result?.deliveryStatus === "string" && data.result.deliveryStatus.trim()
          ? data.result.deliveryStatus.trim()
          : "";
      const verified = deliveryStatus === "verified" || Boolean(data?.result?.verified);
      const commentId =
        typeof data?.result?.commentId === "string" && data.result.commentId.trim()
          ? data.result.commentId.trim()
          : "";
      const commentUrl =
        typeof data?.result?.commentUrl === "string" && data.result.commentUrl.trim()
          ? data.result.commentUrl.trim()
          : "";
      const accountLabel = selectedCommentAccount
        ? `${selectedCommentAccount.accountName}${selectedCommentAccount.handle ? ` ${selectedCommentAccount.handle}` : ""}`
        : "";
      setCommentResult(
        updatedPost?.commentDelivery ?? {
          commentId,
          commentUrl,
          status: verified ? "verified" : "accepted_unverified",
          source:
            typeof data?.result?.deliverySource === "string" && data.result.deliverySource.trim()
              ? data.result.deliverySource.trim()
              : "",
          message:
            deliveryMessage ||
            (verified
              ? `Comment verified on ${selectedCommentPlatformLabel}.`
              : `${selectedCommentPlatformLabel} accepted the request, but visibility is still unverified. Do not resend yet.`),
          postedAt: new Date().toISOString(),
          accountId: selectedCommentAccount?.accountId ?? "",
          accountName: selectedCommentAccount?.accountName ?? accountLabel,
          accountHandle: selectedCommentAccount?.handle ?? "",
        }
      );
      const promotionDraft = data?.promotionDraft as SocialDiscoveryPromotionDraft | undefined;
      if (promotionDraft) {
        setPromoResult(promotionDraft);
      }
      const promotionPurchase = data?.promotionPurchase as SocialDiscoveryPromotionPurchase | undefined;
      if (promotionPurchase) {
        setPurchaseResult(promotionPurchase);
      }
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "Failed to send comment");
    } finally {
      setSendingComment(false);
    }
  }

  async function createPromotionDraft() {
    if (!selectedPost) return;
    setCreatingPromo(true);
    setPromoError("");
    setPromoResult(null);
    try {
      const response = await fetch(canonicalApiUrl(`/api/brands/${brandId}/social-discovery/promote`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: selectedPost.id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404 && typeof data?.error === "string" && data.error === "social discovery post not found") {
          clearCachedDiscovery(brandId);
          await loadPosts(status);
          throw new Error("That post is no longer available. The list has been refreshed.");
        }
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to create promo brief");
      }

      const updatedPost = data?.post as DiscoveryPost | undefined;
      if (updatedPost?.id) {
        setPosts((current) => {
          const next = current.map((post) => (post.id === updatedPost.id ? updatedPost : post));
          const cached = readCachedDiscovery(brandId);
          if (cached) {
            writeCachedDiscovery(brandId, {
              ...cached,
              posts: cached.posts.map((post) => (post.id === updatedPost.id ? updatedPost : post)),
            });
          }
          return next;
        });
        setSelectedId(updatedPost.id);
      } else {
        await loadPosts(status);
      }

      const promotionDraft = data?.promotionDraft as SocialDiscoveryPromotionDraft | undefined;
      if (promotionDraft) {
        setPromoResult(promotionDraft);
      }
    } catch (err) {
      setPromoError(err instanceof Error ? err.message : "Failed to create promo brief");
    } finally {
      setCreatingPromo(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageIntro
        title="YouTube comments"
        description="Mode 1: search today's videos and comment manually. Mode 2: watch channels and auto-comment new uploads."
      />

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <SectionPanel title="Choose mode" description="Two ways to use YouTube here.">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4">
            <div className="text-sm font-medium text-[color:var(--foreground)]">Mode 1. Search today&apos;s videos</div>
            <div className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
              Find fresh videos in your niche, pick one result, review it, then post one comment.
            </div>
          </div>
          <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4">
            <div className="text-sm font-medium text-[color:var(--foreground)]">Mode 2. Watch channels</div>
            <div className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
              Subscribe to channel uploads and optionally auto-comment when a new video lands.
            </div>
          </div>
        </div>
      </SectionPanel>

      <SectionPanel
        title="Mode 1. Search today&apos;s videos"
        description="Type a niche and search the last 24 hours."
      >
        <div className="space-y-4">
          {youtubeSearchError ? (
            <div className="rounded-[10px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-3 py-2 text-sm text-[color:var(--danger)]">
              {youtubeSearchError}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              value={youtubeSearchDraft}
              onChange={(event) => setYouTubeSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void runYouTubeSearch();
                }
              }}
              placeholder="b2b sales"
              disabled={searchingYouTube}
            />
            <Button type="button" onClick={() => void runYouTubeSearch()} disabled={searchingYouTube}>
              <RefreshCw className={cn("h-4 w-4", searchingYouTube ? "animate-spin" : "")} />
              {searchingYouTube ? "Searching..." : "Search YouTube"}
            </Button>
          </div>
          <div className="text-sm text-[color:var(--muted-foreground)]">
            {youtubeSearchSummary || "Example: b2b sales demos"}
          </div>
          <div className="text-xs text-[color:var(--muted-foreground)]">
            {youtubeAccountOptions[0]
              ? `Ready to post with ${youtubeAccountOptions[0].accountName}.`
              : "Need to post comments? Open Setup below and add a YouTube account."}
          </div>
        </div>
      </SectionPanel>

      <div className="space-y-4">
        <SectionPanel
          title="Pick one video"
          description={loading ? "Loading..." : posts.length ? "Pick one result. We draft the comment when you select it." : "Search first."}
          contentClassName="p-0"
        >
          {!loading && !posts.length ? (
            <div className="px-4 py-5 text-sm text-[color:var(--muted-foreground)]">
              Search YouTube to load video leads here.
            </div>
          ) : (
            <div className="divide-y divide-[color:var(--border)]">
              {posts.map((post) => {
                const active = post.id === selectedPost?.id;
                const subscriberCount = youtubeRawNumber(post, "subscriberCount");
                const channelTitle = youtubeRawText(post, "channelTitle");
                return (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => setSelectedId(post.id)}
                    aria-pressed={active}
                    className={cn(
                      "grid w-full gap-2 px-4 py-4 text-left transition-colors hover:bg-[color:var(--surface-muted)]",
                      active ? "bg-[color:var(--surface-muted)]" : ""
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-sm font-medium leading-5 text-[color:var(--foreground)]">
                          {post.title}
                        </div>
                      </div>
                      {active ? (
                        <div className="shrink-0 text-xs font-medium text-[color:var(--foreground)]">Selected</div>
                      ) : null}
                    </div>
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      {channelTitle || post.author || "Unknown channel"}
                      {subscriberCount ? ` · ${formatCompactNumber(subscriberCount)} subs` : ""}
                    </div>
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      {formatDate(post.postedAt)}
                      {planFor(post)?.sequence?.[0]?.draft?.trim()
                        ? " · draft ready"
                        : post.interactionPlan.targetStrength === "target"
                          ? " · needs draft"
                          : " · watch only"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </SectionPanel>

        <SectionPanel
          title="Review and post comment"
          description={selectedPost ? "Draft appears here as soon as you pick a video." : "Pick a video first."}
          actions={
            selectedPost ? (
              <Button asChild variant="outline" size="sm">
                <Link href={selectedPost.url} target="_blank" rel="noreferrer">
                  Open video
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : null
          }
        >
          {selectedPost && selectedPlan ? (
            <div className="space-y-4">
              <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                  Selected video
                </div>
                <div className="mt-2 text-sm font-medium text-[color:var(--foreground)]">{selectedPost.title}</div>
                <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                  {selectedYouTubeChannelTitle || selectedPost.author || "Unknown channel"}
                  {selectedYouTubeSubscriberCount ? ` · ${formatCompactNumber(selectedYouTubeSubscriberCount)} subscribers` : ""}
                </div>
                <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{formatDate(selectedPost.postedAt)}</div>
                {selectedPost.body ? (
                  <div className="mt-3 line-clamp-3 text-sm leading-6 text-[color:var(--muted-foreground)]">
                    {selectedPost.body}
                  </div>
                ) : null}
                {selectedPost.platform === "youtube" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedYouTubeChannelId ? (
                      <Button
                        type="button"
                        variant={selectedYouTubeChannelIsWatched ? "outline" : "default"}
                        size="sm"
                        onClick={() => {
                          void saveYouTubeSubscription({
                            channelId: selectedYouTubeChannelId,
                            autoComment: false,
                          });
                        }}
                        disabled={savingYouTubeSubscription || selectedYouTubeChannelIsWatched}
                      >
                        {selectedYouTubeChannelIsWatched ? "Watching channel" : savingYouTubeSubscription ? "Saving..." : "Watch channel"}
                      </Button>
                    ) : null}
                    {youtubeChannelUrl(selectedPost) ? (
                      <Button asChild type="button" variant="outline" size="sm">
                        <Link href={youtubeChannelUrl(selectedPost)} target="_blank" rel="noreferrer">
                          Open channel
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {selectedPost.platform === "youtube" &&
                (selectedPlan.fitSummary || selectedYouTubeViewCount || selectedYouTubeCommentCount) ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-[color:var(--foreground)]">
                      More details
                    </summary>
                    <div className="mt-3 space-y-2 text-sm text-[color:var(--muted-foreground)]">
                      <div>
                        {selectedYouTubeViewCount ? `${formatCompactNumber(selectedYouTubeViewCount)} views` : "Views unavailable"}
                        {selectedYouTubeCommentCount ? ` · ${formatCompactNumber(selectedYouTubeCommentCount)} comments` : ""}
                      </div>
                      {selectedPlan.fitSummary ? <div>{selectedPlan.fitSummary}</div> : null}
                    </div>
                  </details>
                ) : null}
              </div>

              {selectedPost.platform !== "youtube" ? (
                <details className="rounded-[10px] border border-[color:var(--border)] p-3">
                  <summary className="cursor-pointer text-sm font-medium text-[color:var(--foreground)]">
                    Instagram extras
                  </summary>
                  <div className="mt-3">
                    <div className="rounded-[10px] border border-[color:var(--border)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-[color:var(--foreground)]">Official promo</div>
                          <div className="text-sm text-[color:var(--muted-foreground)]">
                            {visiblePromotionDraft && visibleCommentDelivery
                              ? "Prepared automatically after comment send. Refresh if you want a new brief."
                              : "Turn this topic into a brand-owned ad brief."}
                          </div>
                        </div>
                        <Button type="button" variant="outline" onClick={createPromotionDraft} disabled={creatingPromo}>
                          {creatingPromo ? "Creating..." : visiblePromotionDraft ? "Refresh brief" : "Create promo brief"}
                        </Button>
                      </div>
                      {promoError ? (
                        <div className="mt-3 rounded-[10px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-3 py-2 text-sm text-[color:var(--danger)]">
                          {promoError}
                        </div>
                      ) : null}
                      {visiblePromotionDraft ? (
                        <div className="mt-3 grid gap-3">
                          <div className="rounded-[10px] bg-[color:var(--surface-muted)] px-3 py-3">
                            <div className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                              Campaign
                            </div>
                            <div className="mt-1 text-sm font-medium text-[color:var(--foreground)]">
                              {visiblePromotionDraft.campaignName}
                            </div>
                            <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                              {visiblePromotionDraft.objective} · {visiblePromotionDraft.channel}
                            </div>
                          </div>
                          <div className="grid gap-2">
                            <div className="text-sm font-medium text-[color:var(--foreground)]">Primary text</div>
                            <div className="rounded-[10px] bg-[color:var(--surface-muted)] px-3 py-3 text-sm leading-6 text-[color:var(--foreground)]">
                              {visiblePromotionDraft.primaryText}
                            </div>
                          </div>
                          <div className="grid gap-2">
                            <div className="text-sm font-medium text-[color:var(--foreground)]">Destination</div>
                            <div className="break-all rounded-[10px] bg-[color:var(--surface-muted)] px-3 py-3 text-sm text-[color:var(--foreground)]">
                              {visiblePromotionDraft.destinationUrl}
                            </div>
                          </div>
                          <div className="grid gap-2">
                            <div className="text-sm font-medium text-[color:var(--foreground)]">Audience</div>
                            <div className="rounded-[10px] bg-[color:var(--surface-muted)] px-3 py-3 text-sm text-[color:var(--foreground)]">
                              {visiblePromotionDraft.audience}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => copyText(visiblePromotionDraft.primaryText)}
                            >
                              Copy text
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => copyText(promotionExportJson)}
                              disabled={!promotionExportJson}
                            >
                              Copy brief
                            </Button>
                            <Button asChild type="button" variant="ghost" size="sm">
                              <Link href={visiblePromotionDraft.destinationUrl} target="_blank" rel="noreferrer">
                                Open destination
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          </div>
                          <div className="text-xs text-[color:var(--muted-foreground)]">
                            Uses the source post as research only. Promote your own brand asset, not the third-party post.
                          </div>
                          {visiblePromotionPurchase ? (
                            <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-medium text-[color:var(--foreground)]">BuyShazam order</div>
                                  <div className="text-xs text-[color:var(--muted-foreground)]">
                                    {formatPromotionPurchaseStatus(visiblePromotionPurchase.status)}
                                  </div>
                                </div>
                                {visiblePromotionPurchase.orderUrl ? (
                                  <Button asChild type="button" variant="ghost" size="sm">
                                    <Link href={visiblePromotionPurchase.orderUrl} target="_blank" rel="noreferrer">
                                      Open order
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </Link>
                                  </Button>
                                ) : visiblePromotionPurchase.checkoutUrl ? (
                                  <Button asChild type="button" variant="ghost" size="sm">
                                    <Link href={visiblePromotionPurchase.checkoutUrl} target="_blank" rel="noreferrer">
                                      Open checkout
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </Link>
                                  </Button>
                                ) : null}
                              </div>
                              <div className="mt-2 text-sm text-[color:var(--foreground)]">
                                {visiblePromotionPurchase.message}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--muted-foreground)]">
                                <div>Cart: {visiblePromotionPurchase.addedToCart ? "added" : "not confirmed"}</div>
                                {visiblePromotionPurchase.walletOptionLabel ? (
                                  <div>Wallet: {visiblePromotionPurchase.walletOptionLabel}</div>
                                ) : null}
                                {visiblePromotionPurchase.walletBalance ? (
                                  <div>Balance: {visiblePromotionPurchase.walletBalance}</div>
                                ) : null}
                                {visiblePromotionPurchase.orderId ? <div>Order #{visiblePromotionPurchase.orderId}</div> : null}
                              </div>
                              {visiblePromotionPurchase.missingFields.length ? (
                                <div className="mt-2 text-xs text-[color:var(--warning)]">
                                  Missing checkout fields: {visiblePromotionPurchase.missingFields.join(", ")}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </details>
              ) : null}

              {commentAccountOptions.length ? (
                <div className="space-y-3">
                  <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                      Posting as
                    </div>
                    <div className="mt-1 text-sm font-medium text-[color:var(--foreground)]">
                      {selectedCommentAccount?.accountName ?? "Choose an account"}
                    </div>
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      {selectedCommentAccount?.handle ||
                        selectedCommentAccount?.fromEmail ||
                        selectedCommentAccount?.externalAccountId ||
                        ""}
                    </div>
                  </div>

                  {commentAccountOptions.length > 1 ? (
                    <details className="rounded-[10px] border border-[color:var(--border)] p-3">
                      <summary className="cursor-pointer text-sm font-medium text-[color:var(--foreground)]">
                        Change account
                      </summary>
                      <div className="mt-3 grid gap-2">
                        <label className="text-sm font-medium text-[color:var(--foreground)]">Account</label>
                        <Select value={commentAccountId} onChange={(event) => setCommentAccountId(event.target.value)}>
                          {commentAccountOptions.map((account) => (
                            <option key={account.accountId} value={account.accountId}>
                              {account.accountName} · {account.handle || account.fromEmail || account.externalAccountId}
                            </option>
                          ))}
                        </Select>
                        {selectedCommentAccountNeedsOverride ? (
                          <div className="text-xs text-[color:var(--warning)]">You chose a backup account.</div>
                        ) : null}
                      </div>
                    </details>
                  ) : null}

                  <div className="grid gap-2">
                    <label className="text-sm font-medium text-[color:var(--foreground)]">Comment</label>
                    <Textarea
                      value={commentDraft}
                      onChange={(event) => {
                        setCommentDraft(event.target.value);
                        lastAutoCommentDraftRef.current = generatedCommentDraft;
                      }}
                      rows={7}
                      maxLength={1250}
                      placeholder={commentGenerationPending ? "Writing draft..." : "Write the comment"}
                      disabled={commentGenerationPending || sendingComment}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--muted-foreground)]">
                      <div>
                        {commentGenerationPending
                          ? "Writing a draft for you..."
                          : "Edit the draft if you want, then press Post comment."}
                      </div>
                      <div>{commentDraft.trim().length}/1250</div>
                    </div>
                    {canRestoreSuggestedComment ? (
                      <div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setCommentDraft(generatedCommentDraft);
                            lastAutoCommentDraftRef.current = generatedCommentDraft;
                          }}
                        >
                          Use draft again
                        </Button>
                      </div>
                    ) : null}
                    {emptyCommentMessage && selectedPost ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                        <div>{emptyCommentMessage}</div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            attemptedAutoDraftPostIdsRef.current.add(selectedPost.id);
                            void requestCommentDraftForPost(selectedPost.id);
                          }}
                          disabled={sendingComment || commentGenerationPending}
                        >
                          Try draft again
                        </Button>
                      </div>
                    ) : null}
                  </div>

                    {canAddTeammateReply ? (
                      replyEnabled ? (
                        <div className="grid gap-3 rounded-[10px] border border-[color:var(--border)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-[color:var(--foreground)]">Teammate reply</div>
                            <div className="text-xs text-[color:var(--muted-foreground)]">
                              Post one short reply from a second YouTube account after the main comment.
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setReplyEnabled(false);
                              setReplyDraft("");
                              lastAutoReplyDraftRef.current = "";
                              if (selectedPost?.id) {
                                void requestCommentDraftForPost(selectedPost.id, {
                                  mode: "solo",
                                  adoptFreshDrafts: true,
                                });
                              }
                            }}
                          >
                            Use single comment
                          </Button>
                        </div>
                        <div className="grid gap-2">
                          <label className="text-sm font-medium text-[color:var(--foreground)]">Reply account</label>
                          <Select value={replyAccountId} onChange={(event) => setReplyAccountId(event.target.value)}>
                            {replyAccountOptions.map((account) => (
                              <option key={account.accountId} value={account.accountId}>
                                {account.accountName} · {account.handle || account.fromEmail || account.externalAccountId}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <label className="text-sm font-medium text-[color:var(--foreground)]">Reply</label>
                          <Textarea
                            value={replyDraft}
                            onChange={(event) => {
                              setReplyDraft(event.target.value);
                              lastAutoReplyDraftRef.current = generatedReplyDraft;
                            }}
                            rows={4}
                            maxLength={1250}
                            placeholder="Write the teammate reply"
                            disabled={commentGenerationPending || sendingComment}
                          />
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--muted-foreground)]">
                            <div>Keep it short so it reads like a real second person.</div>
                            <div>{replyDraft.trim().length}/1250</div>
                          </div>
                          {canRestoreSuggestedReply ? (
                            <div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setReplyDraft(generatedReplyDraft);
                                  lastAutoReplyDraftRef.current = generatedReplyDraft;
                                }}
                              >
                                Use reply draft again
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setReplyEnabled(true);
                            if (selectedPost?.id) {
                              void requestCommentDraftForPost(selectedPost.id, {
                                mode: "thread",
                                adoptFreshDrafts: true,
                              });
                            }
                          }}
                          disabled={sendingComment || commentGenerationPending}
                        >
                          Add teammate reply
                        </Button>
                      </div>
                    )
                  ) : null}

                  {selectedCommentPlatform === "instagram" ? (
                    <details className="rounded-[10px] border border-[color:var(--border)] p-3">
                      <summary className="cursor-pointer text-sm font-medium text-[color:var(--foreground)]">
                        Reply to a specific comment
                      </summary>
                      <div className="mt-3 grid gap-2">
                        <label className="text-sm text-[color:var(--muted-foreground)]">Comment id</label>
                        <Input
                          value={commentReplyId}
                          onChange={(event) => setCommentReplyId(event.target.value)}
                          placeholder="Leave empty for a normal post comment"
                        />
                      </div>
                    </details>
                  ) : null}

                  {commentError ? (
                    <div className="rounded-[10px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-3 py-2 text-sm text-[color:var(--danger)]">
                      {commentError}
                    </div>
                  ) : null}

                  {commentThreadWarning ? (
                    <div className="rounded-[10px] border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2 text-sm text-[color:var(--warning)]">
                      {commentThreadWarning}
                    </div>
                  ) : null}

                  {visibleCommentDelivery ? (
                    <div
                      className={cn(
                        "rounded-[10px] border px-3 py-3",
                        visibleCommentDelivery.status === "verified"
                          ? "border-[color:var(--success-border)] bg-[color:var(--success-soft)]"
                          : "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]"
                      )}
                    >
                      <div
                        className={cn(
                          "text-sm font-medium",
                          visibleCommentDelivery.status === "verified"
                            ? "text-[color:var(--success)]"
                            : "text-[color:var(--warning)]"
                        )}
                      >
                        {visibleCommentDelivery.status === "verified" ? "Comment posted" : "Comment sent"}
                      </div>
                      <div className="mt-1 text-sm text-[color:var(--foreground)]">{visibleCommentDelivery.message}</div>
                      {visibleCommentDelivery.replyDelivery ? (
                        <div className="mt-3 rounded-[10px] border border-[color:var(--success-border)] bg-[color:var(--background)] px-3 py-3">
                          <div className="text-sm font-medium text-[color:var(--success)]">Teammate reply posted</div>
                          <div className="mt-1 text-sm text-[color:var(--foreground)]">
                            {visibleCommentDelivery.replyDelivery.message}
                          </div>
                          <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                            {visibleCommentDelivery.replyDelivery.accountName}
                            {visibleCommentDelivery.replyDelivery.accountHandle
                              ? ` ${visibleCommentDelivery.replyDelivery.accountHandle}`
                              : ""}
                          </div>
                          {visibleCommentDelivery.replyDelivery.commentUrl ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button asChild type="button" variant="outline" size="sm">
                                <Link href={visibleCommentDelivery.replyDelivery.commentUrl} target="_blank" rel="noreferrer">
                                  Open reply
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Link>
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => copyText(visibleCommentDelivery.replyDelivery?.commentUrl ?? "")}
                              >
                                Copy reply link
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {visibleCommentDelivery.commentUrl ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button asChild type="button" variant="outline" size="sm">
                            <Link href={visibleCommentDelivery.commentUrl} target="_blank" rel="noreferrer">
                              Open comment
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => copyText(visibleCommentDelivery.commentUrl)}
                          >
                            Copy link
                          </Button>
                        </div>
                      ) : null}
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-medium text-[color:var(--foreground)]">
                          Show details
                        </summary>
                        <div className="mt-3 space-y-3">
                          {commentExportPayload ? (
                            <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--background)] px-3 py-3">
                              <div className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
                                Export
                              </div>
                              <div className="mt-2 grid gap-3">
                                {commentExportPayload.altCommentUrl ? (
                                  <div className="grid gap-2">
                                    <div className="text-sm font-medium text-[color:var(--foreground)]">Alt Instagram link</div>
                                    <div className="break-all rounded-[8px] bg-[color:var(--surface-muted)] px-3 py-2 font-mono text-xs text-[color:var(--foreground)]">
                                      {commentExportPayload.altCommentUrl}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => copyText(commentExportPayload.altCommentUrl)}
                                      >
                                        Copy alt link
                                      </Button>
                                    </div>
                                  </div>
                                ) : null}
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => copyText(commentExportJson)}
                                    disabled={!commentExportJson}
                                  >
                                    Copy JSON
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ) : null}
                          <div className="space-y-1 text-xs text-[color:var(--muted-foreground)]">
                            {visibleCommentDelivery.accountName ? (
                              <div>
                                Account: {visibleCommentDelivery.accountName}
                                {visibleCommentDelivery.accountHandle ? ` ${visibleCommentDelivery.accountHandle}` : ""}
                              </div>
                            ) : null}
                            {visibleCommentDelivery.replyDelivery?.accountName ? (
                              <div>
                                Reply account: {visibleCommentDelivery.replyDelivery.accountName}
                                {visibleCommentDelivery.replyDelivery.accountHandle
                                  ? ` ${visibleCommentDelivery.replyDelivery.accountHandle}`
                                  : ""}
                              </div>
                            ) : null}
                            {visibleCommentDelivery.commentId ? <div>Comment id: {visibleCommentDelivery.commentId}</div> : null}
                            {visibleCommentDelivery.replyDelivery?.commentId ? (
                              <div>Reply id: {visibleCommentDelivery.replyDelivery.commentId}</div>
                            ) : null}
                            {visibleCommentDelivery.source ? <div>Checked via: {visibleCommentDelivery.source}</div> : null}
                            <div>Updated: {formatDate(visibleCommentDelivery.postedAt)}</div>
                          </div>
                        </div>
                      </details>
                    </div>
                  ) : null}

                  <Button
                    type="button"
                    size="lg"
                    className="w-full sm:w-auto"
                    onClick={sendComment}
                    disabled={
                      sendingComment ||
                      commentGenerationPending ||
                      !commentDraft.trim() ||
                      (replyEnabled && (!replyDraft.trim() || !replyAccountId))
                    }
                  >
                    {sendingComment ? "Posting..." : replyEnabled ? "Post thread" : "Post comment"}
                  </Button>
                </div>
              ) : (
                <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
                  {selectedCommentPlatform === "youtube"
                    ? 'You need one connected YouTube account before you can post. Open "Setup" below.'
                    : "Add an Instagram account first."}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-[color:var(--muted-foreground)]">Pick a video above.</div>
          )}
        </SectionPanel>
      </div>

      <SectionPanel
        title="Mode 2. Watch channels"
        description="Subscribe to upload notifications and optionally auto-comment future uploads."
      >
        <div className="space-y-4">
          {youtubeSubscriptionError ? (
            <div className="rounded-[10px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-3 py-2 text-sm text-[color:var(--danger)]">
              {youtubeSubscriptionError}
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(240px,0.8fr)_auto]">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[color:var(--foreground)]">Channel id</label>
              <Input
                value={youtubeChannelIdDraft}
                onChange={(event) => setYouTubeChannelIdDraft(event.target.value)}
                placeholder="UC..."
                disabled={savingYouTubeSubscription}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[color:var(--foreground)]">Auto-comment account</label>
              <Select
                value={youtubeSubscriptionAccountId}
                onChange={(event) => setYouTubeSubscriptionAccountId(event.target.value)}
                disabled={savingYouTubeSubscription || !youtubeAccountOptions.length}
              >
                <option value="">{youtubeAutoCommentEnabled ? "Pick account" : "No account"}</option>
                {youtubeAccountOptions.map((account) => (
                  <option key={account.accountId} value={account.accountId}>
                    {account.accountName} · {account.handle || account.fromEmail || account.accountId}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                type="button"
                onClick={() => {
                  void saveYouTubeSubscription();
                }}
                disabled={savingYouTubeSubscription}
              >
                {savingYouTubeSubscription ? "Saving..." : "Watch channel"}
              </Button>
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3">
            <input
              type="checkbox"
              checked={youtubeAutoCommentEnabled}
              onChange={(event) => setYouTubeAutoCommentEnabled(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border border-[color:var(--border)] bg-[color:var(--background)] accent-[color:var(--accent)]"
            />
            <span className="min-w-0">
              <span className="text-sm font-medium text-[color:var(--foreground)]">Auto-comment new uploads</span>
              <span className="mt-1 block text-sm leading-6 text-[color:var(--muted-foreground)]">
                Use this only for watched channels. Search mode above stays manual.
              </span>
            </span>
          </label>

          {!youtubeAccountOptions.length ? (
            <div className="text-xs text-[color:var(--muted-foreground)]">
              Need a YouTube account first? Open Setup below, add one account, then click `Connect YouTube`.
            </div>
          ) : null}

          {youtubeSubscriptions.length ? (
            <div className="grid gap-3">
              {youtubeSubscriptions.map((subscription) => (
                <div
                  key={subscription.id}
                  className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-[color:var(--foreground)]">
                        {subscription.channelTitle || subscription.channelId}
                      </div>
                      <div className="text-xs text-[color:var(--muted-foreground)]">
                        {subscription.channelId}
                        {subscription.accountName ? ` · ${subscription.accountName}` : ""}
                        {subscription.autoComment ? " · auto-comment on" : " · watch only"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void saveYouTubeSubscription({
                            channelId: subscription.channelId,
                            accountId: subscription.accountId,
                            autoComment: subscription.autoComment,
                            leaseSeconds: subscription.leaseSeconds || undefined,
                          });
                        }}
                        disabled={savingYouTubeSubscription}
                      >
                        Renew now
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void removeYouTubeSubscription(subscription.channelId);
                        }}
                        disabled={removingYouTubeChannelId === subscription.channelId}
                      >
                        {removingYouTubeChannelId === subscription.channelId ? "Removing..." : "Remove"}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-1 text-xs text-[color:var(--muted-foreground)]">
                    <div>Status: {subscription.status}</div>
                    {subscription.leaseExpiresAt ? <div>Lease expires: {formatDate(subscription.leaseExpiresAt)}</div> : null}
                    {subscription.lastVerifiedAt ? <div>Verified: {formatDate(subscription.lastVerifiedAt)}</div> : null}
                    {subscription.lastNotificationAt ? <div>Last upload: {formatDate(subscription.lastNotificationAt)}</div> : null}
                    {subscription.lastVideoUrl ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span>Last video:</span>
                        <Link href={subscription.lastVideoUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                          Open
                        </Link>
                      </div>
                    ) : null}
                    {subscription.lastCommentUrl ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span>Last comment:</span>
                        <Link href={subscription.lastCommentUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                          Open
                        </Link>
                      </div>
                    ) : null}
                    {subscription.lastError ? (
                      <div className="text-[color:var(--danger)]">Last error: {subscription.lastError}</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
              No watched YouTube channels yet.
            </div>
          )}
        </div>
      </SectionPanel>

      <details className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[color:var(--foreground)]">
          Setup
        </summary>
        <div className="space-y-4 border-t border-[color:var(--border)] px-4 py-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <SectionPanel title="Comment prompt" description="One saved prompt for this brand.">
              <div className="space-y-2">
                <Textarea
                  value={brandCommentPromptDraft}
                  onChange={(event) => setBrandCommentPromptDraft(event.target.value)}
                  rows={6}
                />
                <div className="text-xs text-[color:var(--muted-foreground)]">{brandCommentPromptStatusMessage}</div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      void saveBrandCommentPrompt();
                    }}
                    disabled={savingBrandCommentPrompt || !brandCommentPromptDirty}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setBrandCommentPromptDraft(effectiveSavedBrandCommentPrompt);
                      setBrandCommentPromptError("");
                    }}
                    disabled={savingBrandCommentPrompt || !brandCommentPromptDirty}
                  >
                    Reset
                  </Button>
                </div>
                {brandCommentPromptError ? (
                  <div className="rounded-[10px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-3 py-2 text-sm text-[color:var(--danger)]">
                    {brandCommentPromptError}
                  </div>
                ) : null}
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  Clear it and save if you want to go back to the default prompt.
                </div>
              </div>
            </SectionPanel>

            <SectionPanel title="Instagram scan" description="Keep the old manual Instagram workflow here.">
              <div className="space-y-2">
                <Textarea
                  value={queryDraft}
                  onChange={(event) => setQueryDraft(event.target.value)}
                  rows={6}
                  placeholder="One search prompt per line"
                />
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  {queryList.length} prompts. {queryStatusMessage}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      void saveQueries().catch((err) =>
                        setError(err instanceof Error ? err.message : "Failed to save search prompts")
                      );
                    }}
                    disabled={savingQueries || !queriesDirty}
                  >
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setQueryDraft(baselineQueries.join("\n"))}
                    disabled={savingQueries}
                  >
                    Reset
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={runScan} disabled={scanning}>
                    <RefreshCw className={cn("h-4 w-4", scanning ? "animate-spin" : "")} />
                    {scanning ? "Scanning..." : "Run scan"}
                  </Button>
                </div>
              </div>
            </SectionPanel>
          </div>

          <SectionPanel
            title="Add accounts"
            description="Use the buttons below to add Instagram or YouTube accounts, connect them, and see which ones are ready."
          >
            <SocialAccountPoolPanel
              brandId={brandId}
              onChanged={() => {
                void loadPosts(status);
                void loadCommentAccounts();
                void loadYouTubeSubscriptions();
              }}
            />
          </SectionPanel>
        </div>
      </details>
    </div>
  );
}
