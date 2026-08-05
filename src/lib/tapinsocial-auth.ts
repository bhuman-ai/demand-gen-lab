import "server-only";

import { createSupabaseAuthClient } from "@/lib/auth-server";
import { getBrandById } from "@/lib/factory-data";
import { createOutreachAccount, getOutreachAccount, updateOutreachAccount } from "@/lib/outreach-data";

const TAPIN_WORKSPACE_KEY = "tapinsocialWorkspace";

export type TapInYouTubeAccount = {
  accountId: string;
  channelId: string;
  name: string;
  handle: string;
  avatarUrl: string;
  connectedAt: string;
};

export type TapInAuthWorkspace = {
  accountId: string;
  accountName: string;
  brandId: string;
  brandName: string;
  youtubeSeedAccountId: string;
  youtubeAccountId: string;
  youtubeAccounts: TapInYouTubeAccount[];
  createdAt: string;
};

type TapInAuthUser = {
  id: string;
  app_metadata?: Record<string, unknown> | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function cleanDate(value: unknown, fallback = new Date(0).toISOString()) {
  const date = String(value ?? "").trim();
  return Number.isNaN(Date.parse(date)) ? fallback : date;
}

function normalizeYouTubeAccounts(value: unknown): TapInYouTubeAccount[] {
  if (!Array.isArray(value)) return [];
  const seenAccountIds = new Set<string>();
  const seenChannelIds = new Set<string>();
  const accounts: TapInYouTubeAccount[] = [];

  for (const entry of value) {
    const row = asRecord(entry);
    const accountId = String(row.accountId ?? "").trim();
    const channelId = String(row.channelId ?? "").trim();
    if (!accountId || !channelId || seenAccountIds.has(accountId) || seenChannelIds.has(channelId)) continue;
    seenAccountIds.add(accountId);
    seenChannelIds.add(channelId);
    accounts.push({
      accountId,
      channelId,
      name: String(row.name ?? "").trim() || "YouTube channel",
      handle: String(row.handle ?? "").trim(),
      avatarUrl: String(row.avatarUrl ?? "").trim(),
      connectedAt: cleanDate(row.connectedAt),
    });
  }

  return accounts;
}

export function tapInWorkspaceFromUser(user: unknown): TapInAuthWorkspace | null {
  const row = asRecord(user);
  const workspace = asRecord(asRecord(row.app_metadata)[TAPIN_WORKSPACE_KEY]);
  const accountId = String(workspace.accountId ?? "").trim();
  const accountName = String(workspace.accountName ?? "").trim();
  const brandId = String(workspace.brandId ?? "").trim();
  const brandName = String(workspace.brandName ?? "").trim();
  const legacyAccountId = String(workspace.youtubeAccountId ?? "").trim();
  const youtubeSeedAccountId = String(workspace.youtubeSeedAccountId ?? legacyAccountId).trim();
  const youtubeAccounts = normalizeYouTubeAccounts(workspace.youtubeAccounts);
  const selectedAccountId = youtubeAccounts.some((entry) => entry.accountId === legacyAccountId)
    ? legacyAccountId
    : youtubeAccounts[0]?.accountId || legacyAccountId || youtubeSeedAccountId;
  const createdAt = String(workspace.createdAt ?? "").trim();

  if (!accountId || !accountName || !brandId || !brandName || !youtubeSeedAccountId) return null;

  return {
    accountId,
    accountName,
    brandId,
    brandName,
    youtubeSeedAccountId,
    youtubeAccountId: selectedAccountId,
    youtubeAccounts,
    createdAt: cleanDate(createdAt),
  };
}

function youtubeAccountFromOutreachAccount(
  account: Awaited<ReturnType<typeof getOutreachAccount>>
): TapInYouTubeAccount | null {
  if (!account) return null;
  const social = account.config.social;
  const channelId = String(social.externalAccountId ?? "").trim();
  if (!channelId || social.linkedProvider !== "youtube") return null;
  return {
    accountId: account.id,
    channelId,
    name: social.displayName.trim() || account.name || "YouTube channel",
    handle: social.handle.trim(),
    avatarUrl: social.avatarUrl.trim(),
    connectedAt: cleanDate(social.linkedAt || account.updatedAt, account.updatedAt),
  };
}

async function enrichWorkspace(workspace: TapInAuthWorkspace) {
  const candidateIds = Array.from(
    new Set([
      workspace.youtubeSeedAccountId,
      workspace.youtubeAccountId,
      ...workspace.youtubeAccounts.map((entry) => entry.accountId),
    ].filter(Boolean))
  );
  const resolved = await Promise.all(candidateIds.map((accountId) => getOutreachAccount(accountId).catch(() => null)));
  const connected = resolved
    .map(youtubeAccountFromOutreachAccount)
    .filter((entry): entry is TapInYouTubeAccount => Boolean(entry));
  const byChannel = new Map<string, TapInYouTubeAccount>();
  for (const account of [...workspace.youtubeAccounts, ...connected]) {
    const refreshed = connected.find((entry) => entry.accountId === account.accountId) ?? account;
    if (!byChannel.has(refreshed.channelId)) byChannel.set(refreshed.channelId, refreshed);
  }
  const youtubeAccounts = Array.from(byChannel.values());
  const youtubeAccountId = youtubeAccounts.some((entry) => entry.accountId === workspace.youtubeAccountId)
    ? workspace.youtubeAccountId
    : youtubeAccounts[0]?.accountId ?? workspace.youtubeSeedAccountId;
  return { ...workspace, youtubeAccountId, youtubeAccounts } satisfies TapInAuthWorkspace;
}

async function saveWorkspace(user: TapInAuthUser, workspace: TapInAuthWorkspace) {
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...(user.app_metadata ?? {}),
      tapinsocialAccess: true,
      [TAPIN_WORKSPACE_KEY]: workspace,
    },
  });
  if (error || !data.user) throw new Error(error?.message || "TapIn workspace could not be saved.");
  return tapInWorkspaceFromUser(data.user) ?? workspace;
}

async function getTapInUser(userId: string): Promise<TapInAuthUser | null> {
  const normalizedUserId = userId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedUserId)) {
    return null;
  }
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.admin.getUserById(normalizedUserId);
  if (error || !data.user) return null;
  return data.user;
}

export async function getTapInWorkspaceForUser(userId: string) {
  const user = await getTapInUser(userId);
  if (!user) return null;
  const workspace = tapInWorkspaceFromUser(user);
  if (!workspace) return null;
  const enriched = await enrichWorkspace(workspace);
  if (JSON.stringify(enriched) !== JSON.stringify(workspace)) return saveWorkspace(user, enriched);
  return enriched;
}

export function workspaceOwnsYouTubeAccount(workspace: TapInAuthWorkspace, accountId: string) {
  return workspace.youtubeAccounts.some((entry) => entry.accountId === accountId.trim());
}

export async function createTapInYouTubeConnectAccount(userId: string) {
  const workspace = await getTapInWorkspaceForUser(userId);
  if (!workspace) throw new Error("TapIn workspace ownership could not be verified.");
  const seed = await getOutreachAccount(workspace.youtubeSeedAccountId);
  if (!workspace.youtubeAccounts.length && seed && !seed.config.social.externalAccountId.trim()) {
    return { workspace, accountId: seed.id };
  }

  const account = await createOutreachAccount({
    name: "TapIn YouTube channel",
    provider: "customerio",
    accountType: "hybrid",
    status: "active",
    config: {
      social: {
        enabled: false,
        connectionProvider: "youtube",
        linkedProvider: "youtube",
        platforms: ["youtube"],
        coordinationGroup: `tapin:${workspace.accountId}`,
      },
    },
  });
  return { workspace, accountId: account.id };
}

export async function resolveTapInYouTubeAccountTarget(input: {
  userId: string;
  brandId: string;
  pendingAccountId: string;
  channelId: string;
}) {
  const workspace = await getTapInWorkspaceForUser(input.userId);
  if (!workspace || workspace.brandId !== input.brandId) {
    throw new Error("TapIn workspace ownership could not be verified.");
  }
  const existing = workspace.youtubeAccounts.find((entry) => entry.channelId === input.channelId);
  if (existing && existing.accountId !== input.pendingAccountId) {
    await updateOutreachAccount(input.pendingAccountId, { status: "inactive" }).catch(() => null);
  }
  return existing?.accountId ?? input.pendingAccountId;
}

export async function attachTapInYouTubeAccount(input: {
  userId: string;
  brandId: string;
  accountId: string;
}) {
  const user = await getTapInUser(input.userId);
  const rawWorkspace = user ? tapInWorkspaceFromUser(user) : null;
  if (!user || !rawWorkspace || rawWorkspace.brandId !== input.brandId) {
    throw new Error("TapIn workspace ownership could not be verified.");
  }
  const account = youtubeAccountFromOutreachAccount(await getOutreachAccount(input.accountId));
  if (!account) throw new Error("The connected YouTube channel could not be verified.");
  const current = await enrichWorkspace(rawWorkspace);
  const youtubeAccounts = [
    ...current.youtubeAccounts.filter(
      (entry) => entry.accountId !== account.accountId && entry.channelId !== account.channelId
    ),
    account,
  ];
  return saveWorkspace(user, { ...current, youtubeAccountId: account.accountId, youtubeAccounts });
}

export async function selectTapInYouTubeAccount(userId: string, accountId: string) {
  const user = await getTapInUser(userId);
  const rawWorkspace = user ? tapInWorkspaceFromUser(user) : null;
  if (!user || !rawWorkspace) throw new Error("TapIn workspace ownership could not be verified.");
  const workspace = await enrichWorkspace(rawWorkspace);
  if (!workspaceOwnsYouTubeAccount(workspace, accountId)) {
    throw new Error("That YouTube channel is not connected to this TapIn workspace.");
  }
  return saveWorkspace(user, { ...workspace, youtubeAccountId: accountId.trim() });
}

export async function provisionTapInWorkspace(input: {
  user: TapInAuthUser;
  accountName: string;
  brandId: string;
  youtubeAccountId: string;
}) {
  const existing = tapInWorkspaceFromUser(input.user);
  if (existing) return enrichWorkspace(existing);

  const brand = await getBrandById(input.brandId.trim());
  if (!brand) throw new Error("The configured TapIn brand was not found.");
  const youtubeAccount = await getOutreachAccount(input.youtubeAccountId.trim());
  if (!youtubeAccount) throw new Error("The configured TapIn YouTube account was not found.");

  const workspace: TapInAuthWorkspace = {
    accountId: `tapin-${brand.id}`,
    accountName: input.accountName.trim() || `${brand.name} account`,
    brandId: brand.id,
    brandName: brand.name,
    youtubeSeedAccountId: youtubeAccount.id,
    youtubeAccountId: youtubeAccount.id,
    youtubeAccounts: [],
    createdAt: new Date().toISOString(),
  };
  const saved = await saveWorkspace(input.user, workspace);
  return enrichWorkspace(saved);
}
