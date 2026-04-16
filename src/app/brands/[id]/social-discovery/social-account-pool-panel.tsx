"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Instagram,
  Link2,
  RefreshCw,
  Settings2,
  Youtube,
} from "lucide-react";
import { SettingsModal } from "@/app/settings/outreach/settings-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { OutreachAccount } from "@/lib/factory-types";
import { SOCIAL_PLATFORM_CATALOG } from "@/lib/social-platform-catalog";
import { cn } from "@/lib/utils";

type AccountsResponse = {
  accounts: OutreachAccount[];
};

type SupportedSocialPlatform = "instagram" | "youtube";

type SocialDraft = {
  enabled: boolean;
  connectionProvider: OutreachAccount["config"]["social"]["connectionProvider"];
  linkedProvider: OutreachAccount["config"]["social"]["linkedProvider"];
  externalAccountId: string;
  handle: string;
  profileUrl: string;
  publicIdentifier: string;
  displayName: string;
  headline: string;
  bio: string;
  avatarUrl: string;
  role: OutreachAccount["config"]["social"]["role"];
  topicTags: string;
  communityTags: string;
  personaSummary: string;
  voiceSummary: string;
  trustLevel: number;
  cooldownMinutes: number;
  coordinationGroup: string;
  recentActivity24h: number;
  recentActivity7d: number;
  linkedAt: string;
  lastProfileSyncAt: string;
  notes: string;
  platforms: string[];
};

type CredentialDraft = {
  youtubeClientId: string;
  youtubeClientSecret: string;
  youtubeRefreshToken: string;
};

type YouTubeCredentialField = "youtubeClientId" | "youtubeClientSecret";

type YouTubeConnectResponse = {
  url?: string;
  error?: string;
  errorCode?: string;
  missingFields?: string[];
  message?: string;
};

type StartYouTubeConnectResult = "redirected" | "needs_credentials";

const ROLE_OPTIONS: Array<OutreachAccount["config"]["social"]["role"]> = [
  "operator",
  "specialist",
  "curator",
  "partner",
  "founder",
  "brand",
  "community",
];

const CONNECTION_OPTIONS: Array<OutreachAccount["config"]["social"]["connectionProvider"]> = [
  "none",
  "manual",
  "unipile",
  "youtube",
];

const LINKED_PROVIDER_OPTIONS: Array<OutreachAccount["config"]["social"]["linkedProvider"]> = [
  "",
  "linkedin",
  "instagram",
  "x",
  "youtube",
  "unknown",
];

const DEFAULT_YOUTUBE_MISSING_FIELDS: YouTubeCredentialField[] = ["youtubeClientId", "youtubeClientSecret"];

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function sortAccounts(accounts: OutreachAccount[]) {
  return [...accounts].sort((left, right) => {
    const leftEnabled = left.config.social.enabled ? 1 : 0;
    const rightEnabled = right.config.social.enabled ? 1 : 0;
    if (leftEnabled !== rightEnabled) return rightEnabled - leftEnabled;
    const leftActive = left.status === "active" ? 1 : 0;
    const rightActive = right.status === "active" ? 1 : 0;
    if (leftActive !== rightActive) return rightActive - leftActive;
    return left.name.localeCompare(right.name);
  });
}

function parseCsv(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function joinCsv(values: string[]) {
  return values.join(", ");
}

function buildDraft(account: OutreachAccount): SocialDraft {
  return {
    enabled: account.config.social.enabled,
    connectionProvider: account.config.social.connectionProvider,
    linkedProvider: account.config.social.linkedProvider,
    externalAccountId: account.config.social.externalAccountId,
    handle: account.config.social.handle,
    profileUrl: account.config.social.profileUrl,
    publicIdentifier: account.config.social.publicIdentifier,
    displayName: account.config.social.displayName,
    headline: account.config.social.headline,
    bio: account.config.social.bio,
    avatarUrl: account.config.social.avatarUrl,
    role: account.config.social.role,
    topicTags: joinCsv(account.config.social.topicTags),
    communityTags: joinCsv(account.config.social.communityTags),
    personaSummary: account.config.social.personaSummary,
    voiceSummary: account.config.social.voiceSummary,
    trustLevel: account.config.social.trustLevel,
    cooldownMinutes: account.config.social.cooldownMinutes,
    coordinationGroup: account.config.social.coordinationGroup,
    recentActivity24h: account.config.social.recentActivity24h,
    recentActivity7d: account.config.social.recentActivity7d,
    linkedAt: account.config.social.linkedAt,
    lastProfileSyncAt: account.config.social.lastProfileSyncAt,
    notes: account.config.social.notes,
    platforms: account.config.social.platforms,
  };
}

function emptyCredentialDraft(): CredentialDraft {
  return {
    youtubeClientId: "",
    youtubeClientSecret: "",
    youtubeRefreshToken: "",
  };
}

function readJson<T>(response: Response, fallbackMessage: string) {
  return response.json().catch(() => ({} as T)).then((data) => {
    if (!response.ok) {
      const record = asRecord(data);
      throw new Error(typeof record.error === "string" ? record.error : fallbackMessage);
    }
    return data;
  });
}

function accountSubtitle(account: OutreachAccount) {
  return (
    account.config.social.displayName ||
    account.config.social.handle ||
    account.config.social.publicIdentifier ||
    account.config.social.profileUrl ||
    "No linked social identity yet"
  );
}

function hasHydratedUnipileIdentity(account: OutreachAccount) {
  const social = account.config.social;
  return Boolean(
    social.linkedProvider ||
      social.displayName.trim() ||
      social.publicIdentifier.trim() ||
      social.handle.trim() ||
      social.profileUrl.trim() ||
      social.bio.trim() ||
      social.avatarUrl.trim()
  );
}

function inferSupportedPlatform(
  social:
    | Pick<SocialDraft, "connectionProvider" | "linkedProvider" | "platforms">
    | OutreachAccount["config"]["social"]
    | null
) {
  if (!social) return null;
  if (
    social.connectionProvider === "youtube" ||
    social.linkedProvider === "youtube" ||
    social.platforms.includes("youtube")
  ) {
    return "youtube" as const;
  }
  if (social.linkedProvider === "instagram" || social.platforms.includes("instagram")) {
    return "instagram" as const;
  }
  return null;
}

function platformLabel(platform: SupportedSocialPlatform) {
  return platform === "youtube" ? "YouTube" : "Instagram";
}

function platformLaunchDescription(platform: SupportedSocialPlatform) {
  return platform === "youtube"
    ? "Makes the account, opens Google, then brings you back here connected."
    : "Makes the account, opens Instagram sign-in, then fills the profile back here.";
}

function nextPlatformAccountName(platform: SupportedSocialPlatform, accounts: OutreachAccount[]) {
  const nextIndex =
    accounts.filter((account) => inferSupportedPlatform(account.config.social) === platform).length + 1;
  return `${platformLabel(platform)} account${nextIndex > 1 ? ` ${nextIndex}` : ""}`;
}

function platformConfigPatch(
  platform: SupportedSocialPlatform,
  current: Pick<SocialDraft, "platforms"> | OutreachAccount["config"]["social"]
) {
  return {
    enabled: true,
    connectionProvider: platform === "youtube" ? "youtube" : "unipile",
    linkedProvider: platform === "youtube" ? "youtube" : "instagram",
    platforms: Array.from(new Set([...(current.platforms ?? []), platform])),
  } satisfies Partial<OutreachAccount["config"]["social"]>;
}

function hasConnectedIdentity(social: Pick<SocialDraft, "externalAccountId"> | OutreachAccount["config"]["social"]) {
  return Boolean(social.externalAccountId.trim());
}

function accountStatus(account: OutreachAccount) {
  const platform = inferSupportedPlatform(account.config.social);
  if (!platform) return "Choose a platform";
  if (!account.config.social.enabled) return "Turned off";
  if (!hasConnectedIdentity(account.config.social)) return "Needs sign-in";
  return "Connected";
}

function simplifyYouTubeError(message: string) {
  const normalized = message.trim().toLowerCase();
  if (
    normalized.includes("youtube connect is not configured yet") ||
    normalized.includes("youtube connect is missing app oauth credentials")
  ) {
    return "We need a Google client ID and client secret before YouTube can open. Click Connect YouTube again and the form will ask for them.";
  }
  return message;
}

function shouldShowYouTubeCredentialHelp(message: string) {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("youtube connect is not configured yet") ||
    normalized.includes("youtube connect is missing app oauth credentials") ||
    normalized.includes("google client id and client secret")
  );
}

function normalizeYouTubeMissingFields(value: unknown): YouTubeCredentialField[] {
  if (!Array.isArray(value)) return [...DEFAULT_YOUTUBE_MISSING_FIELDS];
  const normalized = value.filter(
    (entry): entry is YouTubeCredentialField =>
      entry === "youtubeClientId" || entry === "youtubeClientSecret"
  );
  return normalized.length ? normalized : [...DEFAULT_YOUTUBE_MISSING_FIELDS];
}

function PlatformIcon({
  platform,
  className,
}: {
  platform: SupportedSocialPlatform;
  className?: string;
}) {
  return platform === "youtube" ? (
    <Youtube className={className} />
  ) : (
    <Instagram className={className} />
  );
}

export function SocialAccountPoolPanel({
  brandId,
  onChanged,
}: {
  brandId: string;
  onChanged?: () => Promise<void> | void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<OutreachAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [draft, setDraft] = useState<SocialDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingPlatform, setCreatingPlatform] = useState<SupportedSocialPlatform | "">("");
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [youtubeConnecting, setYouTubeConnecting] = useState(false);
  const [error, setError] = useState("");
  const [linkMessage, setLinkMessage] = useState("");
  const [handledAutoLinkKey, setHandledAutoLinkKey] = useState("");
  const [handledYouTubeConnectKey, setHandledYouTubeConnectKey] = useState("");
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showAdvancedYouTubeCredentials, setShowAdvancedYouTubeCredentials] = useState(false);
  const [credentialDraft, setCredentialDraft] = useState<CredentialDraft>(emptyCredentialDraft());
  const [youtubeCredentialModalOpen, setYouTubeCredentialModalOpen] = useState(false);
  const [youtubeCredentialModalAccountId, setYouTubeCredentialModalAccountId] = useState("");
  const [youtubeCredentialModalMissingFields, setYouTubeCredentialModalMissingFields] = useState<YouTubeCredentialField[]>(
    [...DEFAULT_YOUTUBE_MISSING_FIELDS]
  );
  const [youtubeCredentialModalError, setYouTubeCredentialModalError] = useState("");
  const [youtubeCredentialModalSaving, setYouTubeCredentialModalSaving] = useState(false);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? accounts[0] ?? null,
    [accounts, selectedAccountId]
  );
  const selectedPlatform = useMemo(
    () => inferSupportedPlatform(draft ?? selectedAccount?.config.social ?? null),
    [draft, selectedAccount]
  );
  const selectedHasConnectedIdentity = useMemo(
    () => (draft ? hasConnectedIdentity(draft) : selectedAccount ? hasConnectedIdentity(selectedAccount.config.social) : false),
    [draft, selectedAccount]
  );
  const showYouTubeCredentials =
    selectedPlatform === "youtube" ||
    Boolean(draft?.platforms.includes("youtube")) ||
    draft?.linkedProvider === "youtube" ||
    draft?.connectionProvider === "youtube";

  useEffect(() => {
    if (!selectedAccount) {
      setDraft(null);
      setCredentialDraft(emptyCredentialDraft());
      setShowAdvancedSettings(false);
      setShowAdvancedYouTubeCredentials(false);
      return;
    }
    setDraft(buildDraft(selectedAccount));
    setCredentialDraft(emptyCredentialDraft());
    setShowAdvancedSettings(false);
    setShowAdvancedYouTubeCredentials(false);
  }, [selectedAccount]);

  const loadAccountsSnapshot = useCallback(async () => {
    const accountsResponse = await fetch("/api/outreach/accounts?scope=social", { cache: "no-store" });
    const accountsData = await readJson<AccountsResponse>(accountsResponse, "Failed to load account pool");
    return sortAccounts(Array.isArray(accountsData.accounts) ? accountsData.accounts : []);
  }, []);

  const applySavedAccount = useCallback(
    async (saved: OutreachAccount) => {
      setAccounts((current) =>
        sortAccounts(
          (current.some((account) => account.id === saved.id) ? current : [saved, ...current]).map((account) =>
            account.id === saved.id ? saved : account
          )
        )
      );
      setSelectedAccountId(saved.id);
      setDraft(buildDraft(saved));
      await Promise.resolve(onChanged?.());
      return saved;
    },
    [onChanged]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const nextAccounts = await loadAccountsSnapshot();
        if (cancelled) return;
        setAccounts(nextAccounts);
        setSelectedAccountId((current) =>
          current && nextAccounts.some((account) => account.id === current) ? current : nextAccounts[0]?.id || ""
        );
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load social account pool");
        setAccounts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [brandId, loadAccountsSnapshot]);

  async function refresh(preferredAccountId = selectedAccountId) {
    setLoading(true);
    setError("");
    try {
      const nextAccounts = await loadAccountsSnapshot();
      setAccounts(nextAccounts);
      setSelectedAccountId(
        preferredAccountId && nextAccounts.some((account) => account.id === preferredAccountId)
          ? preferredAccountId
          : nextAccounts[0]?.id || ""
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh social account pool");
    } finally {
      setLoading(false);
    }
  }

  const syncLinkedAccount = useCallback(
    async (accountId: string, externalAccountId: string) => {
      const response = await fetch(`/api/outreach/accounts/${accountId}/social-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync",
          externalAccountId,
        }),
      });
      const data = await readJson<{ account: OutreachAccount }>(response, "Failed to sync Instagram profile");
      return applySavedAccount(data.account);
    },
    [applySavedAccount]
  );

  useEffect(() => {
    const linkedAccount = searchParams.get("linkedAccount");
    const unipileState = searchParams.get("unipile");
    const returnedExternalAccountId = searchParams.get("account_id")?.trim() || "";
    const autoLinkKey =
      linkedAccount && unipileState
        ? `${linkedAccount}:${unipileState}:${returnedExternalAccountId || "none"}`
        : "";
    if (!autoLinkKey || handledAutoLinkKey === autoLinkKey) return;

    let cancelled = false;

    async function handleReturn() {
      setHandledAutoLinkKey(autoLinkKey);
      setSelectedAccountId(linkedAccount || "");
      if (unipileState !== "success") {
        setLinkMessage("Instagram sign-in did not finish. You can try again.");
        router.replace(pathname);
        return;
      }

      setSyncing(true);
      setError("");
      setLinkMessage("Finishing Instagram connection...");

      try {
        if (linkedAccount && returnedExternalAccountId) {
          const saved = await syncLinkedAccount(linkedAccount, returnedExternalAccountId);
          if (cancelled) return;
          setLinkMessage(
            saved.config.social.displayName.trim()
              ? `Instagram connected as ${saved.config.social.displayName.trim()}.`
              : "Instagram connected."
          );
          router.replace(pathname);
          return;
        }

        for (let attempt = 0; attempt < 6; attempt += 1) {
          if (cancelled) return;
          const nextAccounts = await loadAccountsSnapshot();
          if (cancelled) return;
          setAccounts(nextAccounts);
          setSelectedAccountId(linkedAccount || "");

          const linked = nextAccounts.find((account) => account.id === linkedAccount);
          const externalAccountId = linked?.config.social.externalAccountId.trim() || "";
          if (linked && externalAccountId) {
            if (hasHydratedUnipileIdentity(linked)) {
              setDraft(buildDraft(linked));
              setLinkMessage(
                linked.config.social.displayName.trim()
                  ? `Instagram connected as ${linked.config.social.displayName.trim()}.`
                  : "Instagram connected."
              );
              router.replace(pathname);
              return;
            }
            const saved = await syncLinkedAccount(linked.id, externalAccountId);
            if (cancelled) return;
            setLinkMessage(
              saved.config.social.displayName.trim()
                ? `Instagram connected as ${saved.config.social.displayName.trim()}.`
                : "Instagram connected."
            );
            router.replace(pathname);
            return;
          }

          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }

        if (!cancelled) {
          setLinkMessage("Instagram connected, but the profile is still loading. Refresh or sync in a few seconds.");
          router.replace(pathname);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to finish Instagram connection");
          router.replace(pathname);
        }
      } finally {
        if (!cancelled) {
          setSyncing(false);
          setLinking(false);
        }
      }
    }

    void handleReturn();

    return () => {
      cancelled = true;
    };
  }, [handledAutoLinkKey, loadAccountsSnapshot, pathname, router, searchParams, syncLinkedAccount]);

  useEffect(() => {
    const linkedAccount = searchParams.get("linkedAccount");
    const youtubeState = searchParams.get("youtube");
    const youtubeMessage = searchParams.get("youtubeMessage")?.trim() || "";
    const youtubeConnectKey =
      linkedAccount && youtubeState
        ? `${linkedAccount}:${youtubeState}:${youtubeMessage || "none"}`
        : "";
    if (!youtubeConnectKey || handledYouTubeConnectKey === youtubeConnectKey) return;

    let cancelled = false;

    async function handleYouTubeReturn() {
      setHandledYouTubeConnectKey(youtubeConnectKey);
      setSelectedAccountId(linkedAccount || "");

      if (youtubeState !== "success") {
        setError(simplifyYouTubeError(youtubeMessage || "YouTube connection did not complete. You can retry."));
        if (shouldShowYouTubeCredentialHelp(youtubeMessage)) {
          setShowAdvancedSettings(true);
          setShowAdvancedYouTubeCredentials(true);
        }
        router.replace(pathname);
        return;
      }

      setYouTubeConnecting(true);
      setError("");
      setLinkMessage("Refreshing connected YouTube account...");

      try {
        const nextAccounts = await loadAccountsSnapshot();
        if (cancelled) return;
        setAccounts(nextAccounts);
        setSelectedAccountId(linkedAccount || "");
        const linked = nextAccounts.find((account) => account.id === linkedAccount) ?? null;
        setLinkMessage(
          linked?.config.social.displayName.trim()
            ? `YouTube connected as ${linked.config.social.displayName.trim()}.`
            : "YouTube connected."
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to refresh connected YouTube account");
        }
      } finally {
        if (!cancelled) {
          setYouTubeConnecting(false);
          router.replace(pathname);
        }
      }
    }

    void handleYouTubeReturn();

    return () => {
      cancelled = true;
    };
  }, [handledYouTubeConnectKey, loadAccountsSnapshot, pathname, router, searchParams]);

  async function persistSocialDraft(
    account: OutreachAccount,
    nextDraft: SocialDraft,
    nextCredentials: CredentialDraft
  ) {
    const response = await fetch(`/api/outreach/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          social: {
            enabled: nextDraft.enabled,
            connectionProvider: nextDraft.connectionProvider,
            linkedProvider: nextDraft.linkedProvider,
            externalAccountId: nextDraft.externalAccountId.trim(),
            handle: nextDraft.handle.trim(),
            profileUrl: nextDraft.profileUrl.trim(),
            publicIdentifier: nextDraft.publicIdentifier.trim(),
            displayName: nextDraft.displayName.trim(),
            headline: nextDraft.headline.trim(),
            bio: nextDraft.bio.trim(),
            avatarUrl: nextDraft.avatarUrl.trim(),
            role: nextDraft.role,
            topicTags: parseCsv(nextDraft.topicTags),
            communityTags: parseCsv(nextDraft.communityTags),
            personaSummary: nextDraft.personaSummary.trim(),
            voiceSummary: nextDraft.voiceSummary.trim(),
            trustLevel: nextDraft.trustLevel,
            cooldownMinutes: nextDraft.cooldownMinutes,
            linkedAt: nextDraft.linkedAt.trim(),
            lastProfileSyncAt: nextDraft.lastProfileSyncAt.trim(),
            coordinationGroup: nextDraft.coordinationGroup.trim(),
            recentActivity24h: nextDraft.recentActivity24h,
            recentActivity7d: nextDraft.recentActivity7d,
            notes: nextDraft.notes.trim(),
            platforms: nextDraft.platforms,
          },
        },
        credentials: {
          youtubeClientId: nextCredentials.youtubeClientId.trim(),
          youtubeClientSecret: nextCredentials.youtubeClientSecret.trim(),
          youtubeRefreshToken: nextCredentials.youtubeRefreshToken.trim(),
        },
      }),
    });
    const data = await readJson<{ account: OutreachAccount }>(response, "Failed to save social account");
    return applySavedAccount(data.account);
  }

  async function prepareAccountForPlatform(account: OutreachAccount, platform: SupportedSocialPlatform) {
    const baseDraft = account.id === selectedAccount?.id && draft ? draft : buildDraft(account);
    const nextDraft = {
      ...baseDraft,
      ...platformConfigPatch(platform, baseDraft),
    };
    const nextCredentials = account.id === selectedAccount?.id ? credentialDraft : emptyCredentialDraft();
    return persistSocialDraft(account, nextDraft, nextCredentials);
  }

  async function createPlatformAccount(platform: SupportedSocialPlatform) {
    const response = await fetch("/api/outreach/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nextPlatformAccountName(platform, accounts),
        provider: "customerio",
        accountType: "hybrid",
        status: "active",
        config: {
          social: {
            enabled: true,
            role: "operator",
            connectionProvider: platform === "youtube" ? "youtube" : "unipile",
            linkedProvider: platform === "youtube" ? "youtube" : "instagram",
            platforms: [platform],
          },
        },
      }),
    });
    const data = await readJson<{ account: OutreachAccount }>(response, "Failed to create social account");
    return applySavedAccount(data.account);
  }

  async function startInstagramConnect(account: OutreachAccount) {
    const response = await fetch(`/api/outreach/accounts/${account.id}/social-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_link",
        brandId,
        platforms: account.config.social.platforms,
      }),
    });
    const data = await readJson<{ url: string }>(response, "Failed to create Instagram link");
    const url = String(data.url ?? "").trim();
    if (!url) throw new Error("Instagram did not return a hosted sign-in URL.");
    window.location.assign(url);
  }

  function openYouTubeCredentialModal(accountId: string, missingFields?: unknown) {
    setSelectedAccountId(accountId);
    setYouTubeCredentialModalAccountId(accountId);
    setYouTubeCredentialModalMissingFields(normalizeYouTubeMissingFields(missingFields));
    setYouTubeCredentialModalError("");
    setYouTubeCredentialModalOpen(true);
  }

  async function startYouTubeConnect(account: OutreachAccount): Promise<StartYouTubeConnectResult> {
    const response = await fetch(`/api/outreach/accounts/${account.id}/youtube-connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brandId,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as YouTubeConnectResponse;
    if (!response.ok) {
      if (data.errorCode === "youtube_oauth_credentials_missing") {
        openYouTubeCredentialModal(account.id, data.missingFields);
        return "needs_credentials";
      }
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : typeof data.message === "string"
            ? data.message
            : "Failed to start YouTube connect flow"
      );
    }
    const url = String(data.url ?? "").trim();
    if (!url) throw new Error("Google did not return a YouTube connect URL.");
    window.location.assign(url);
    return "redirected";
  }

  async function saveYouTubeCredentialsAndContinue() {
    const accountId = youtubeCredentialModalAccountId || selectedAccount?.id || "";
    if (!accountId) {
      setYouTubeCredentialModalError("Pick a YouTube account first.");
      return;
    }

    const requiredFields = youtubeCredentialModalMissingFields.length
      ? youtubeCredentialModalMissingFields
      : DEFAULT_YOUTUBE_MISSING_FIELDS;
    const missingInput = requiredFields.some((field) => !credentialDraft[field].trim());
    if (missingInput) {
      setYouTubeCredentialModalError("Enter the Google client ID and client secret.");
      return;
    }

    const account = accounts.find((entry) => entry.id === accountId) ?? selectedAccount;
    if (!account) {
      setYouTubeCredentialModalError("The YouTube account is missing.");
      return;
    }

    setYouTubeCredentialModalSaving(true);
    setYouTubeCredentialModalError("");
    setError("");
    setLinkMessage("");
    try {
      const baseDraft = account.id === selectedAccount?.id && draft ? draft : buildDraft(account);
      const nextDraft = {
        ...baseDraft,
        ...platformConfigPatch("youtube", baseDraft),
      };
      const saved = await persistSocialDraft(account, nextDraft, credentialDraft);
      setYouTubeCredentialModalOpen(false);
      setYouTubeCredentialModalAccountId("");
      setLinkMessage("Opening YouTube sign-in...");
      const result = await startYouTubeConnect(saved);
      if (result === "needs_credentials") {
        setLinkMessage("");
      }
    } catch (err) {
      setYouTubeCredentialModalError(
        err instanceof Error ? simplifyYouTubeError(err.message) : "Failed to save YouTube app credentials"
      );
    } finally {
      setYouTubeCredentialModalSaving(false);
    }
  }

  async function createAndConnectPlatform(platform: SupportedSocialPlatform) {
    setCreatingPlatform(platform);
    setError("");
    setLinkMessage("");
    try {
      const account = await createPlatformAccount(platform);
      setLinkMessage(`Opening ${platformLabel(platform)} sign-in...`);
      if (platform === "youtube") {
        const result = await startYouTubeConnect(account);
        if (result === "needs_credentials") {
          setLinkMessage("Enter the Google client ID and client secret to continue.");
        }
      } else {
        await startInstagramConnect(account);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to add ${platformLabel(platform)} account`;
      if (platform === "youtube") {
        setError(simplifyYouTubeError(message));
        if (shouldShowYouTubeCredentialHelp(message)) {
          setShowAdvancedSettings(true);
          setShowAdvancedYouTubeCredentials(true);
        }
      } else {
        setError(message);
      }
    } finally {
      setCreatingPlatform("");
    }
  }

  async function connectSelectedAccount(platform: SupportedSocialPlatform) {
    if (!selectedAccount) return;
    if (platform === "youtube") {
      setYouTubeConnecting(true);
    } else {
      setLinking(true);
    }
    setError("");
    setLinkMessage("");
    try {
      const account = await prepareAccountForPlatform(selectedAccount, platform);
      setLinkMessage(`Opening ${platformLabel(platform)} sign-in...`);
      if (platform === "youtube") {
        const result = await startYouTubeConnect(account);
        if (result === "needs_credentials") {
          setLinkMessage("Enter the Google client ID and client secret to continue.");
        }
      } else {
        await startInstagramConnect(account);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to connect ${platformLabel(platform)}`;
      if (platform === "youtube") {
        setError(simplifyYouTubeError(message));
        if (shouldShowYouTubeCredentialHelp(message)) {
          setShowAdvancedSettings(true);
          setShowAdvancedYouTubeCredentials(true);
        }
      } else {
        setError(message);
      }
    } finally {
      if (platform === "youtube") {
        setYouTubeConnecting(false);
      } else {
        setLinking(false);
      }
    }
  }

  async function saveSelectedAccount() {
    if (!selectedAccount || !draft) return;

    setSaving(true);
    setError("");
    try {
      await persistSocialDraft(selectedAccount, draft, credentialDraft);
      setLinkMessage("Advanced settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save social account");
    } finally {
      setSaving(false);
    }
  }

  async function syncSelectedAccountFromInstagram() {
    if (!selectedAccount) return;
    const externalAccountId = draft?.externalAccountId || selectedAccount.config.social.externalAccountId;
    if (!externalAccountId.trim()) return;
    setSyncing(true);
    setError("");
    setLinkMessage("");
    try {
      await syncLinkedAccount(selectedAccount.id, externalAccountId);
      setLinkMessage("Pulled the latest Instagram profile.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync Instagram profile");
    } finally {
      setSyncing(false);
      setLinking(false);
    }
  }

  function togglePlatform(platformId: string) {
    setDraft((current) =>
      current
        ? {
            ...current,
            platforms: current.platforms.includes(platformId)
              ? current.platforms.filter((entry) => entry !== platformId)
              : [...current.platforms, platformId],
          }
        : current
    );
  }

  const selectedStatusLabel = selectedAccount ? accountStatus(selectedAccount) : "";
  const showYouTubeClientIdField = youtubeCredentialModalMissingFields.includes("youtubeClientId");
  const showYouTubeClientSecretField = youtubeCredentialModalMissingFields.includes("youtubeClientSecret");

  return (
    <>
      <div className="space-y-5">
      <div className="space-y-3">
        <div className="text-sm text-[color:var(--muted-foreground)]">
          Pick a platform. We will create the account and open the right sign-in page for you.
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {(["instagram", "youtube"] as SupportedSocialPlatform[]).map((platform) => {
            const busy = creatingPlatform === platform;
            return (
              <button
                key={platform}
                type="button"
                onClick={() => void createAndConnectPlatform(platform)}
                disabled={busy || linking || youtubeConnecting || saving || syncing}
                className={cn(
                  "rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-4 text-left transition-colors hover:bg-[color:var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]">
                    <PlatformIcon platform={platform} className="h-5 w-5 text-[color:var(--foreground)]" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-[color:var(--foreground)]">
                      {busy ? `Opening ${platformLabel(platform)}...` : `Add ${platformLabel(platform)} account`}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                      {platformLaunchDescription(platform)}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <div className="rounded-[10px] border border-[color:var(--danger)]/30 bg-[color:var(--danger)]/10 px-3 py-3 text-sm text-[color:var(--danger)]">
          {error}
        </div>
      ) : null}

      {linkMessage ? (
        <div className="rounded-[10px] border border-[color:var(--success)]/30 bg-[color:var(--success)]/10 px-3 py-3 text-sm text-[color:var(--success)]">
          {linkMessage}
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium text-[color:var(--foreground)]">Existing accounts</div>
            <div className="text-sm text-[color:var(--muted-foreground)]">
              Click an account to reconnect it or open advanced settings.
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void refresh()}
            disabled={loading || saving || linking || youtubeConnecting}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
            Loading accounts...
          </div>
        ) : null}

        {!loading && !accounts.length ? (
          <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3 text-sm text-[color:var(--muted-foreground)]">
            No accounts yet. Use one of the buttons above.
          </div>
        ) : null}

        {accounts.length ? (
          <div className="grid gap-3">
            {accounts.map((account) => {
              const platform = inferSupportedPlatform(account.config.social);
              const active = account.id === selectedAccount?.id;
              return (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => {
                    setSelectedAccountId(account.id);
                    setError("");
                    setLinkMessage("");
                  }}
                  className={cn(
                    "rounded-[12px] border px-4 py-4 text-left transition-colors hover:bg-[color:var(--surface-muted)]",
                    active
                      ? "border-[color:var(--border-strong)] bg-[color:var(--surface-muted)]"
                      : "border-[color:var(--border)] bg-[color:var(--surface)]"
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)]">
                        {platform ? (
                          <PlatformIcon platform={platform} className="h-4 w-4 text-[color:var(--foreground)]" />
                        ) : (
                          <Link2 className="h-4 w-4 text-[color:var(--muted-foreground)]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[color:var(--foreground)]">{account.name}</div>
                        <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                          {platform ? `${platformLabel(platform)} account` : "Platform not picked yet"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-medium text-[color:var(--muted-foreground)]">
                      {accountStatus(account) === "Connected" ? (
                        <CheckCircle2 className="h-4 w-4 text-[color:var(--success)]" />
                      ) : (
                        <CircleAlert className="h-4 w-4" />
                      )}
                      <span>{accountStatus(account)}</span>
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">{accountSubtitle(account)}</div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {selectedAccount && draft ? (
        <div className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)]">
                {selectedPlatform ? (
                  <PlatformIcon platform={selectedPlatform} className="h-5 w-5 text-[color:var(--foreground)]" />
                ) : (
                  <Link2 className="h-5 w-5 text-[color:var(--muted-foreground)]" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold text-[color:var(--foreground)]">{selectedAccount.name}</div>
                <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                  {selectedPlatform
                    ? selectedHasConnectedIdentity
                      ? `${platformLabel(selectedPlatform)} is connected.`
                      : `Finish sign-in to connect ${platformLabel(selectedPlatform)}.`
                    : "Pick whether this account is for Instagram or YouTube."}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
              {selectedStatusLabel === "Connected" ? (
                <CheckCircle2 className="h-4 w-4 text-[color:var(--success)]" />
              ) : (
                <CircleAlert className="h-4 w-4" />
              )}
              <span>{selectedStatusLabel}</span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {selectedPlatform ? (
              <Button
                type="button"
                onClick={() => void connectSelectedAccount(selectedPlatform)}
                disabled={saving || syncing || linking || youtubeConnecting || Boolean(creatingPlatform)}
              >
                {selectedPlatform === "youtube"
                  ? youtubeConnecting
                    ? "Opening..."
                    : selectedHasConnectedIdentity
                      ? "Reconnect YouTube"
                      : "Connect YouTube"
                  : linking
                    ? "Opening..."
                    : selectedHasConnectedIdentity
                      ? "Reconnect Instagram"
                      : "Connect Instagram"}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  onClick={() => void connectSelectedAccount("instagram")}
                  disabled={saving || syncing || linking || youtubeConnecting || Boolean(creatingPlatform)}
                >
                  Use for Instagram
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void connectSelectedAccount("youtube")}
                  disabled={saving || syncing || linking || youtubeConnecting || Boolean(creatingPlatform)}
                >
                  Use for YouTube
                </Button>
              </>
            )}

            {selectedPlatform === "instagram" && draft.externalAccountId.trim() ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void syncSelectedAccountFromInstagram()}
                disabled={syncing || saving || linking || youtubeConnecting}
              >
                {syncing ? "Syncing..." : "Pull latest Instagram profile"}
              </Button>
            ) : null}

            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAdvancedSettings((current) => !current)}
              disabled={loading}
            >
              <Settings2 className="h-4 w-4" />
              Advanced settings
              {showAdvancedSettings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>

          <div className="mt-4 grid gap-2 text-sm text-[color:var(--muted-foreground)] sm:grid-cols-2">
            <div>{accountSubtitle(selectedAccount)}</div>
            {draft.lastProfileSyncAt ? <div>Last profile sync: {draft.lastProfileSyncAt}</div> : null}
            {draft.externalAccountId ? <div>Connected id: {draft.externalAccountId}</div> : null}
            {draft.enabled ? <div>Used for routing: yes</div> : <div>Used for routing: no</div>}
          </div>

          {showAdvancedSettings ? (
            <div className="mt-5 space-y-5 border-t border-[color:var(--border)] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-[color:var(--foreground)]">Advanced settings</div>
                  <div className="text-sm text-[color:var(--muted-foreground)]">
                    Most people can ignore this. Use it only if you need manual overrides.
                  </div>
                </div>
                <Button type="button" onClick={saveSelectedAccount} disabled={saving || linking || youtubeConnecting}>
                  {saving ? "Saving..." : "Save advanced settings"}
                </Button>
              </div>

              <label className="flex items-start gap-3 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                  className="mt-1 h-4 w-4 rounded border border-[color:var(--border)] bg-[color:var(--background)] accent-[color:var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="text-sm font-medium text-[color:var(--foreground)]">Use this account for routing</span>
                  <span className="mt-1 block text-sm leading-6 text-[color:var(--muted-foreground)]">
                    Turn this off if you want to keep the account saved without using it.
                  </span>
                </span>
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="social-role">Role</Label>
                  <Select
                    id="social-role"
                    value={draft.role}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        role: event.target.value as SocialDraft["role"],
                      })
                    }
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-connection">Connection</Label>
                  <Select
                    id="social-connection"
                    value={draft.connectionProvider}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        connectionProvider: event.target.value as SocialDraft["connectionProvider"],
                      })
                    }
                  >
                    {CONNECTION_OPTIONS.map((provider) => (
                      <option key={provider} value={provider}>
                        {provider}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-handle">Handle</Label>
                  <Input
                    id="social-handle"
                    value={draft.handle}
                    onChange={(event) => setDraft({ ...draft, handle: event.target.value })}
                    placeholder="@safelywithsam"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-linked-provider">Linked provider</Label>
                  <Select
                    id="social-linked-provider"
                    value={draft.linkedProvider}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        linkedProvider: event.target.value as SocialDraft["linkedProvider"],
                      })
                    }
                  >
                    {LINKED_PROVIDER_OPTIONS.map((provider) => (
                      <option key={provider || "none"} value={provider}>
                        {provider || "none"}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-external-id">External account id</Label>
                  <Input
                    id="social-external-id"
                    value={draft.externalAccountId}
                    onChange={(event) => setDraft({ ...draft, externalAccountId: event.target.value })}
                    placeholder={draft.connectionProvider === "youtube" ? "UC..." : "acc_123"}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="social-profile-url">Profile URL</Label>
                  <Input
                    id="social-profile-url"
                    value={draft.profileUrl}
                    onChange={(event) => setDraft({ ...draft, profileUrl: event.target.value })}
                    placeholder="https://instagram.com/..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-public-id">Public identifier</Label>
                  <Input
                    id="social-public-id"
                    value={draft.publicIdentifier}
                    onChange={(event) => setDraft({ ...draft, publicIdentifier: event.target.value })}
                    placeholder="sam-safeagain"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-display-name">Display name</Label>
                  <Input
                    id="social-display-name"
                    value={draft.displayName}
                    onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                    placeholder="Sam Rivera"
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="social-avatar-url">Avatar URL</Label>
                  <Input
                    id="social-avatar-url"
                    value={draft.avatarUrl}
                    onChange={(event) => setDraft({ ...draft, avatarUrl: event.target.value })}
                    placeholder="https://..."
                  />
                </div>
              </div>

              {showYouTubeCredentials ? (
                <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-[color:var(--foreground)]">YouTube app credentials</div>
                      <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                        Only needed if the shared Google app credentials are missing. Usually leave this alone.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowAdvancedYouTubeCredentials((current) => !current)}
                    >
                      {showAdvancedYouTubeCredentials ? "Hide fields" : "Show fields"}
                    </Button>
                  </div>

                  {showAdvancedYouTubeCredentials ? (
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="youtube-client-id">Client ID</Label>
                        <Input
                          id="youtube-client-id"
                          value={credentialDraft.youtubeClientId}
                          onChange={(event) =>
                            setCredentialDraft((current) => ({ ...current, youtubeClientId: event.target.value }))
                          }
                          placeholder="Google OAuth client id"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="youtube-client-secret">Client secret</Label>
                        <Input
                          id="youtube-client-secret"
                          type="password"
                          value={credentialDraft.youtubeClientSecret}
                          onChange={(event) =>
                            setCredentialDraft((current) => ({ ...current, youtubeClientSecret: event.target.value }))
                          }
                          placeholder="Google OAuth client secret"
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="youtube-refresh-token">Refresh token</Label>
                        <Textarea
                          id="youtube-refresh-token"
                          value={credentialDraft.youtubeRefreshToken}
                          onChange={(event) =>
                            setCredentialDraft((current) => ({ ...current, youtubeRefreshToken: event.target.value }))
                          }
                          placeholder="Optional. Leave blank if you are using the normal Google connect flow."
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="social-linked-at">Linked at</Label>
                  <Input
                    id="social-linked-at"
                    value={draft.linkedAt}
                    onChange={(event) => setDraft({ ...draft, linkedAt: event.target.value })}
                    placeholder="2026-04-09T12:00:00.000Z"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-last-sync">Last profile sync</Label>
                  <Input
                    id="social-last-sync"
                    value={draft.lastProfileSyncAt}
                    onChange={(event) => setDraft({ ...draft, lastProfileSyncAt: event.target.value })}
                    placeholder="2026-04-09T12:05:00.000Z"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="social-headline">Headline</Label>
                  <Textarea
                    id="social-headline"
                    value={draft.headline}
                    onChange={(event) => setDraft({ ...draft, headline: event.target.value })}
                    placeholder="Women’s safety educator and campus organizer"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-bio">Bio</Label>
                  <Textarea
                    id="social-bio"
                    value={draft.bio}
                    onChange={(event) => setDraft({ ...draft, bio: event.target.value })}
                    placeholder="Writes about night-walk routines, rideshare safety, and practical bystander habits."
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Platforms</Label>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {SOCIAL_PLATFORM_CATALOG.map((platform) => {
                    const checked = draft.platforms.includes(platform.id);
                    return (
                      <label
                        key={platform.id}
                        className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-[color:var(--border)] px-3 py-2.5 transition-colors hover:bg-[color:var(--surface-muted)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePlatform(platform.id)}
                          className="mt-1 h-4 w-4 rounded border border-[color:var(--border)] bg-[color:var(--background)] accent-[color:var(--accent)]"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-[color:var(--foreground)]">
                            {platform.label}
                          </span>
                          <span className="block text-xs leading-5 text-[color:var(--muted-foreground)]">
                            {platform.scanStatus === "supported_now" ? "Scan now" : "Save only"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="social-trust">Trust level</Label>
                  <Input
                    id="social-trust"
                    type="number"
                    min={0}
                    max={10}
                    value={draft.trustLevel}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        trustLevel: Math.max(0, Math.min(10, Number(event.target.value) || 0)),
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-cooldown">Cooldown minutes</Label>
                  <Input
                    id="social-cooldown"
                    type="number"
                    min={0}
                    max={24 * 60}
                    value={draft.cooldownMinutes}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        cooldownMinutes: Math.max(0, Math.min(24 * 60, Number(event.target.value) || 0)),
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-activity-24h">Recent actions (24h)</Label>
                  <Input
                    id="social-activity-24h"
                    type="number"
                    min={0}
                    value={draft.recentActivity24h}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        recentActivity24h: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-activity-7d">Recent actions (7d)</Label>
                  <Input
                    id="social-activity-7d"
                    type="number"
                    min={0}
                    value={draft.recentActivity7d}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        recentActivity7d: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="social-persona-summary">Persona summary</Label>
                  <Textarea
                    id="social-persona-summary"
                    value={draft.personaSummary}
                    onChange={(event) => setDraft({ ...draft, personaSummary: event.target.value })}
                    placeholder="Credible operator voice for empathy-first replies about women’s safety and routines."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-voice-summary">Voice notes</Label>
                  <Textarea
                    id="social-voice-summary"
                    value={draft.voiceSummary}
                    onChange={(event) => setDraft({ ...draft, voiceSummary: event.target.value })}
                    placeholder="Calm, practical, never alarmist. Good at method-first comments."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-topics">Topic tags</Label>
                  <Textarea
                    id="social-topics"
                    value={draft.topicTags}
                    onChange={(event) => setDraft({ ...draft, topicTags: event.target.value })}
                    placeholder="street harassment, solo travel, night walk"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-communities">Community tags</Label>
                  <Textarea
                    id="social-communities"
                    value={draft.communityTags}
                    onChange={(event) => setDraft({ ...draft, communityTags: event.target.value })}
                    placeholder="reddit women, campus safety, solo travelers"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="social-coordination">Coordination group</Label>
                  <Input
                    id="social-coordination"
                    value={draft.coordinationGroup}
                    onChange={(event) => setDraft({ ...draft, coordinationGroup: event.target.value })}
                    placeholder="safeagain-ops"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="social-notes">Notes</Label>
                  <Textarea
                    id="social-notes"
                    value={draft.notes}
                    onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                    placeholder="Campus safety voice. Good for empathy-first replies."
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      </div>

      <SettingsModal
        open={youtubeCredentialModalOpen}
        title="Add YouTube app details"
        description="We need your Google client ID and client secret before we can open YouTube sign-in."
        onOpenChange={(open) => {
          setYouTubeCredentialModalOpen(open);
          if (!open) {
            setYouTubeCredentialModalError("");
            setYouTubeCredentialModalAccountId("");
          }
        }}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setYouTubeCredentialModalOpen(false);
                setYouTubeCredentialModalError("");
                setYouTubeCredentialModalAccountId("");
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveYouTubeCredentialsAndContinue()} disabled={youtubeCredentialModalSaving}>
              {youtubeCredentialModalSaving ? "Saving..." : "Save and continue"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="text-sm text-[color:var(--muted-foreground)]">
            This is the Google app that is allowed to request YouTube access for this account.
          </div>

          {showYouTubeClientIdField ? (
            <div className="space-y-2">
              <Label htmlFor="youtube-modal-client-id">Client ID</Label>
              <Input
                id="youtube-modal-client-id"
                value={credentialDraft.youtubeClientId}
                onChange={(event) =>
                  setCredentialDraft((current) => ({ ...current, youtubeClientId: event.target.value }))
                }
                placeholder="Google OAuth client id"
              />
            </div>
          ) : null}

          {showYouTubeClientSecretField ? (
            <div className="space-y-2">
              <Label htmlFor="youtube-modal-client-secret">Client secret</Label>
              <Input
                id="youtube-modal-client-secret"
                type="password"
                value={credentialDraft.youtubeClientSecret}
                onChange={(event) =>
                  setCredentialDraft((current) => ({ ...current, youtubeClientSecret: event.target.value }))
                }
                placeholder="Google OAuth client secret"
              />
            </div>
          ) : null}

          {youtubeCredentialModalError ? (
            <div className="rounded-[10px] border border-[color:var(--danger)]/30 bg-[color:var(--danger)]/10 px-3 py-3 text-sm text-[color:var(--danger)]">
              {youtubeCredentialModalError}
            </div>
          ) : null}
        </div>
      </SettingsModal>
    </>
  );
}
