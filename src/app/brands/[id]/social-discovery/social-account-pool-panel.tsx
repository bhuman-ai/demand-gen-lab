"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionPanel } from "@/components/ui/page-layout";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { OutreachAccount } from "@/lib/factory-types";
import { SOCIAL_PLATFORM_CATALOG } from "@/lib/social-platform-catalog";
import { cn } from "@/lib/utils";

type AccountsResponse = {
  accounts: OutreachAccount[];
};

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
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [linkMessage, setLinkMessage] = useState("");
  const [handledAutoLinkKey, setHandledAutoLinkKey] = useState("");
  const [credentialDraft, setCredentialDraft] = useState<CredentialDraft>(emptyCredentialDraft());

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? accounts[0] ?? null,
    [accounts, selectedAccountId]
  );
  const enabledCount = useMemo(
    () => accounts.filter((account) => account.status === "active" && account.config.social.enabled).length,
    [accounts]
  );
  const connectedCount = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.status === "active" &&
          account.config.social.enabled &&
          account.config.social.connectionProvider === "unipile" &&
          account.config.social.externalAccountId.trim()
      ).length,
    [accounts]
  );

  useEffect(() => {
    if (!selectedAccount) {
      setDraft(null);
      setCredentialDraft(emptyCredentialDraft());
      return;
    }
    setDraft(buildDraft(selectedAccount));
    setCredentialDraft(emptyCredentialDraft());
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
      const data = await readJson<{ account: OutreachAccount }>(response, "Failed to sync Unipile profile");
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
        setLinkMessage("Unipile connection did not complete. You can retry the connect flow.");
        router.replace(pathname);
        return;
      }

      setSyncing(true);
      setError("");
      setLinkMessage("Connecting account and pulling profile details from Unipile...");

      try {
        if (linkedAccount && returnedExternalAccountId) {
          const saved = await syncLinkedAccount(linkedAccount, returnedExternalAccountId);
          if (cancelled) return;
          setLinkMessage(
            saved.config.social.displayName.trim()
              ? `Connected and filled this account from Unipile as ${saved.config.social.displayName.trim()}.`
              : "Connected and filled this account from Unipile."
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
                  ? `Connected and filled this account from Unipile as ${linked.config.social.displayName.trim()}.`
                  : "Connected and filled this account from Unipile."
              );
              router.replace(pathname);
              return;
            }
            const saved = await syncLinkedAccount(linked.id, externalAccountId);
            if (cancelled) return;
            setLinkMessage(
              saved.config.social.displayName.trim()
                ? `Connected and filled this account from Unipile as ${saved.config.social.displayName.trim()}.`
                : "Connected and filled this account from Unipile."
            );
            router.replace(pathname);
            return;
          }

          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }

        if (!cancelled) {
          setLinkMessage("The account connected, but profile data has not landed yet. Refresh or try sync in a few seconds.");
          router.replace(pathname);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to auto-fill linked Unipile profile");
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

  async function createSocialAccount() {
    const name = window.prompt("Name this social comment account");
    if (!name || !name.trim()) return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/outreach/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          provider: "customerio",
          accountType: "hybrid",
          status: "active",
          config: {
            social: {
              enabled: true,
              role: "operator",
            },
          },
        }),
      });
      const data = await readJson<{ account: OutreachAccount }>(response, "Failed to create social account");
      await refresh(data.account.id);
      await Promise.resolve(onChanged?.());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create social account");
    } finally {
      setCreating(false);
    }
  }

  async function saveSelectedAccount() {
    if (!selectedAccount || !draft) return;

    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/outreach/accounts/${selectedAccount.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            social: {
              enabled: draft.enabled,
              connectionProvider: draft.connectionProvider,
              linkedProvider: draft.linkedProvider,
              externalAccountId: draft.externalAccountId.trim(),
              handle: draft.handle.trim(),
              profileUrl: draft.profileUrl.trim(),
              publicIdentifier: draft.publicIdentifier.trim(),
              displayName: draft.displayName.trim(),
              headline: draft.headline.trim(),
              bio: draft.bio.trim(),
              avatarUrl: draft.avatarUrl.trim(),
              role: draft.role,
              topicTags: parseCsv(draft.topicTags),
              communityTags: parseCsv(draft.communityTags),
              personaSummary: draft.personaSummary.trim(),
              voiceSummary: draft.voiceSummary.trim(),
              trustLevel: draft.trustLevel,
              cooldownMinutes: draft.cooldownMinutes,
              linkedAt: draft.linkedAt.trim(),
              lastProfileSyncAt: draft.lastProfileSyncAt.trim(),
              coordinationGroup: draft.coordinationGroup.trim(),
              recentActivity24h: draft.recentActivity24h,
              recentActivity7d: draft.recentActivity7d,
              notes: draft.notes.trim(),
              platforms: draft.platforms,
            },
          },
          credentials: {
            youtubeClientId: credentialDraft.youtubeClientId.trim(),
            youtubeClientSecret: credentialDraft.youtubeClientSecret.trim(),
            youtubeRefreshToken: credentialDraft.youtubeRefreshToken.trim(),
          },
        }),
      });
      const data = await readJson<{ account: OutreachAccount }>(response, "Failed to save social account");
      const saved = data.account;
      const nextAccounts = sortAccounts(
        accounts.map((account) => (account.id === saved.id ? saved : account))
      );
      setAccounts(nextAccounts);
      setSelectedAccountId(saved.id);
      setDraft(buildDraft(saved));
      await Promise.resolve(onChanged?.());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save social account");
    } finally {
      setSaving(false);
    }
  }

  async function connectSelectedAccount() {
    if (!selectedAccount) return;
    setLinking(true);
    setError("");
    setLinkMessage("");
    try {
      const response = await fetch(`/api/outreach/accounts/${selectedAccount.id}/social-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_link",
          brandId,
          platforms: draft?.platforms ?? selectedAccount.config.social.platforms,
        }),
      });
      const data = await readJson<{ url: string }>(response, "Failed to create Unipile link");
      const url = String(data.url ?? "").trim();
      if (!url) throw new Error("Unipile did not return a hosted auth URL.");
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Unipile link");
      setLinking(false);
    }
  }

  async function syncSelectedAccountFromUnipile() {
    if (!selectedAccount) return;
    setSyncing(true);
    setError("");
    setLinkMessage("");
    try {
      await syncLinkedAccount(
        selectedAccount.id,
        draft?.externalAccountId || selectedAccount.config.social.externalAccountId
      );
      setLinkMessage("Pulled the latest linked profile from Unipile.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync Unipile profile");
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

  const showYouTubeCredentials =
    Boolean(draft?.platforms.includes("youtube")) ||
    draft?.linkedProvider === "youtube" ||
    draft?.connectionProvider === "youtube";

  return (
    <SectionPanel
      title="Social comment accounts"
      description="Only real social identities live here. Link them with Unipile and use them for comment routing."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted">{enabledCount} enabled</Badge>
          <Badge variant="muted">{connectedCount} linked</Badge>
          <Button type="button" variant="outline" onClick={createSocialAccount} disabled={creating || loading || saving}>
            {creating ? "Creating..." : "New social account"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading || saving}>
            Refresh
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
        {linkMessage ? <div className="text-sm text-[color:var(--success)]">{linkMessage}</div> : null}

        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-2">
            {loading ? (
              <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-sm text-[color:var(--muted-foreground)]">
                Loading accounts...
              </div>
            ) : null}

            {!loading && !accounts.length ? (
              <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-sm text-[color:var(--muted-foreground)]">
                No social accounts yet. Create one, then link it with Unipile.
              </div>
            ) : null}

            {accounts.map((account) => {
              const active = account.id === selectedAccount?.id;
              return (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => setSelectedAccountId(account.id)}
                  className={cn(
                    "w-full rounded-[10px] border border-[color:var(--border)] px-3 py-3 text-left transition-colors hover:bg-[color:var(--surface-muted)]",
                    active ? "bg-[color:var(--surface-muted)]" : "bg-[color:var(--surface)]"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium text-[color:var(--foreground)]">{account.name}</div>
                    <Badge variant={account.config.social.enabled ? "accent" : "muted"}>
                      {account.config.social.enabled ? "enabled" : "off"}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    {accountSubtitle(account)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-[color:var(--muted-foreground)]">
                    <span>{account.config.social.role}</span>
                    {account.config.social.connectionProvider === "unipile" ? <span>Unipile</span> : null}
                    {account.config.social.connectionProvider === "youtube" ? <span>YouTube OAuth</span> : null}
                    {account.config.social.linkedProvider ? <span>{account.config.social.linkedProvider}</span> : null}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-[10px] border border-[color:var(--border)] p-4">
            {selectedAccount && draft ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-[color:var(--foreground)]">{selectedAccount.name}</div>
                    <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                      {accountSubtitle(selectedAccount)}
                    </div>
                  </div>
                  <Button type="button" onClick={saveSelectedAccount} disabled={saving}>
                    {saving ? "Saving..." : "Save account"}
                  </Button>
                </div>

                <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-[color:var(--foreground)]">
                        {draft.connectionProvider === "youtube" ? "Provider connection" : "Unipile link"}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                        {draft.connectionProvider === "youtube"
                          ? "This account uses Google OAuth credentials for YouTube comments. Unipile is not involved."
                          : "Connect a real social identity to this pool account, then sync its profile metadata for routing."}
                      </p>
                    </div>
                    {draft.connectionProvider === "youtube" ? null : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={connectSelectedAccount}
                          disabled={linking || saving}
                        >
                          {linking ? "Opening..." : draft.connectionProvider === "unipile" ? "Reconnect in Unipile" : "Connect in Unipile"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={syncSelectedAccountFromUnipile}
                          disabled={syncing || !draft.externalAccountId.trim()}
                        >
                          {syncing ? "Syncing..." : "Sync from Unipile"}
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-[color:var(--muted-foreground)]">
                    {draft.externalAccountId ? <Badge variant="muted">linked {draft.externalAccountId}</Badge> : null}
                    {draft.linkedProvider ? <Badge variant="muted">{draft.linkedProvider}</Badge> : null}
                    {draft.lastProfileSyncAt ? <Badge variant="muted">synced {draft.lastProfileSyncAt}</Badge> : null}
                  </div>
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
                      When this is off, the router ignores this account entirely.
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
                    <div className="text-sm font-medium text-[color:var(--foreground)]">YouTube OAuth</div>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">
                      Leave fields blank to keep the currently stored secret values. Saving with new values updates the
                      encrypted account credentials used for YouTube comments.
                    </p>
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
                          placeholder="Google OAuth refresh token with YouTube comment scope"
                        />
                      </div>
                    </div>
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
            ) : (
              <div className="text-sm text-[color:var(--muted-foreground)]">
                Pick an account to configure the social router.
              </div>
            )}
          </div>
        </div>
      </div>
    </SectionPanel>
  );
}
