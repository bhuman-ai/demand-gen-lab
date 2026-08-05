import "server-only";

import { createSupabaseAuthClient } from "@/lib/auth-server";
import { getBrandById } from "@/lib/factory-data";
import { getOutreachAccount } from "@/lib/outreach-data";

const TAPIN_WORKSPACE_KEY = "tapinsocialWorkspace";

export type TapInAuthWorkspace = {
  accountId: string;
  accountName: string;
  brandId: string;
  brandName: string;
  youtubeAccountId: string;
  createdAt: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function tapInWorkspaceFromUser(user: unknown): TapInAuthWorkspace | null {
  const row = asRecord(user);
  const workspace = asRecord(asRecord(row.app_metadata)[TAPIN_WORKSPACE_KEY]);
  const accountId = String(workspace.accountId ?? "").trim();
  const accountName = String(workspace.accountName ?? "").trim();
  const brandId = String(workspace.brandId ?? "").trim();
  const brandName = String(workspace.brandName ?? "").trim();
  const youtubeAccountId = String(workspace.youtubeAccountId ?? "").trim();
  const createdAt = String(workspace.createdAt ?? "").trim();

  if (!accountId || !accountName || !brandId || !brandName || !youtubeAccountId) return null;

  return {
    accountId,
    accountName,
    brandId,
    brandName,
    youtubeAccountId,
    createdAt: Number.isNaN(Date.parse(createdAt)) ? new Date(0).toISOString() : createdAt,
  };
}

export async function getTapInWorkspaceForUser(userId: string) {
  const normalizedUserId = userId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedUserId)) {
    return null;
  }
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.admin.getUserById(normalizedUserId);
  if (error || !data.user) return null;
  return tapInWorkspaceFromUser(data.user);
}

export async function provisionTapInWorkspace(input: {
  user: {
    id: string;
    app_metadata?: Record<string, unknown> | null;
  };
  accountName: string;
  brandId: string;
  youtubeAccountId: string;
}) {
  const existing = tapInWorkspaceFromUser(input.user);
  if (existing) return existing;

  const brand = await getBrandById(input.brandId.trim());
  if (!brand) throw new Error("The configured TapIn brand was not found.");
  const youtubeAccount = await getOutreachAccount(input.youtubeAccountId.trim());
  if (!youtubeAccount) throw new Error("The configured TapIn YouTube account was not found.");

  const workspace: TapInAuthWorkspace = {
    accountId: `tapin-${brand.id}`,
    accountName: input.accountName.trim() || `${brand.name} account`,
    brandId: brand.id,
    brandName: brand.name,
    youtubeAccountId: youtubeAccount.id,
    createdAt: new Date().toISOString(),
  };
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.admin.updateUserById(input.user.id, {
    app_metadata: {
      ...(input.user.app_metadata ?? {}),
      tapinsocialAccess: true,
      [TAPIN_WORKSPACE_KEY]: workspace,
    },
  });
  if (error || !data.user) {
    throw new Error(error?.message || "TapIn workspace could not be saved.");
  }

  return tapInWorkspaceFromUser(data.user) ?? workspace;
}
