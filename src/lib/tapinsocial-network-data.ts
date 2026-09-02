import "server-only";

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const TABLE = "demanddev_tapinsocial_network_deliveries";

export type TapInNetworkDeliveryStatus =
  | "posting"
  | "posted"
  | "posted_unverified"
  | "settled"
  | "failed";

export type TapInNetworkDelivery = {
  id: string;
  missionId: string;
  eventId: string;
  tapInUserId: string;
  brandId: string;
  accountId: string;
  channelId: string;
  videoUrl: string;
  commentText: string;
  textHash: string;
  deliveryToken: string;
  status: TapInNetworkDeliveryStatus;
  commentId: string;
  commentUrl: string;
  postedAt: string;
  settledAt: string;
  settlement: Record<string, unknown>;
  errorMessage: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapDelivery(value: unknown): TapInNetworkDelivery {
  const row = asRecord(value);
  return {
    id: String(row.id || ""),
    missionId: String(row.mission_id || ""),
    eventId: String(row.event_id || ""),
    tapInUserId: String(row.tapin_user_id || ""),
    brandId: String(row.brand_id || ""),
    accountId: String(row.account_id || ""),
    channelId: String(row.channel_id || ""),
    videoUrl: String(row.video_url || ""),
    commentText: String(row.comment_text || ""),
    textHash: String(row.text_hash || ""),
    deliveryToken: String(row.delivery_token || ""),
    status: String(row.status || "failed") as TapInNetworkDeliveryStatus,
    commentId: String(row.comment_id || ""),
    commentUrl: String(row.comment_url || ""),
    postedAt: String(row.posted_at || ""),
    settledAt: String(row.settled_at || ""),
    settlement: asRecord(row.settlement),
    errorMessage: String(row.error_message || ""),
  };
}

function database() {
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Durable TapIn contributor delivery storage is not configured.");
  return supabase;
}

export async function getTapInNetworkDeliveryByMissionId(missionId: string) {
  const { data, error } = await database().from(TABLE).select("*").eq("mission_id", missionId).maybeSingle();
  if (error) throw new Error(`TapIn delivery lookup failed: ${error.message}`);
  return data ? mapDelivery(data) : null;
}

export async function claimTapInNetworkDelivery(input: {
  missionId: string;
  tapInUserId: string;
  brandId: string;
  accountId: string;
  channelId: string;
  videoUrl: string;
  commentText: string;
  textHash: string;
  deliveryToken: string;
}) {
  const eventId = randomUUID();
  const row = {
    mission_id: input.missionId,
    event_id: eventId,
    tapin_user_id: input.tapInUserId,
    brand_id: input.brandId,
    account_id: input.accountId,
    channel_id: input.channelId,
    video_url: input.videoUrl,
    comment_text: input.commentText,
    text_hash: input.textHash,
    delivery_token: input.deliveryToken,
    status: "posting",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await database().from(TABLE).insert(row).select("*").single();
  if (!error && data) return { delivery: mapDelivery(data), shouldPost: true };
  if (String(error?.code || "") !== "23505") {
    throw new Error(`TapIn delivery claim failed: ${error?.message || "Unknown storage error"}`);
  }

  let existing = await getTapInNetworkDeliveryByMissionId(input.missionId);
  if (!existing) throw new Error("TapIn delivery claim was lost after a duplicate request.");
  const exactMatch =
    existing.tapInUserId === input.tapInUserId &&
    existing.accountId === input.accountId &&
    existing.videoUrl === input.videoUrl &&
    existing.textHash === input.textHash;
  if (!exactMatch) throw new Error("This opportunity was already approved with different delivery details.");

  if (existing.deliveryToken !== input.deliveryToken) {
    const { data: refreshed, error: refreshError } = await database()
      .from(TABLE)
      .update({ delivery_token: input.deliveryToken, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (refreshError || !refreshed) throw new Error(`TapIn delivery grant refresh failed: ${refreshError?.message || "Missing row"}`);
    existing = mapDelivery(refreshed);
  }

  if (existing.status === "failed" && !existing.commentId) {
    const { data: retried, error: retryError } = await database()
      .from(TABLE)
      .update({
        status: "posting",
        delivery_token: input.deliveryToken,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("status", "failed")
      .select("*")
      .maybeSingle();
    if (retryError) throw new Error(`TapIn delivery retry failed: ${retryError.message}`);
    if (retried) return { delivery: mapDelivery(retried), shouldPost: true };
  }
  return { delivery: existing, shouldPost: false };
}

export async function updateTapInNetworkDelivery(
  id: string,
  patch: {
    status?: TapInNetworkDeliveryStatus;
    commentId?: string;
    commentUrl?: string;
    postedAt?: string;
    settledAt?: string;
    settlement?: Record<string, unknown>;
    errorMessage?: string;
  }
) {
  const { data, error } = await database()
    .from(TABLE)
    .update({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.commentId !== undefined ? { comment_id: patch.commentId || null } : {}),
      ...(patch.commentUrl !== undefined ? { comment_url: patch.commentUrl || null } : {}),
      ...(patch.postedAt !== undefined ? { posted_at: patch.postedAt || null } : {}),
      ...(patch.settledAt !== undefined ? { settled_at: patch.settledAt || null } : {}),
      ...(patch.settlement ? { settlement: patch.settlement } : {}),
      ...(patch.errorMessage !== undefined ? { error_message: patch.errorMessage || null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`TapIn delivery update failed: ${error?.message || "Missing row"}`);
  return mapDelivery(data);
}
