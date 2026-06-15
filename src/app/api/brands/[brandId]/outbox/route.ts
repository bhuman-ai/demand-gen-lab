import { NextResponse } from "next/server";
import {
  getOutboxConsoleState,
  launchOutboxBatch,
} from "@/lib/outbox-v1";

export const maxDuration = 180;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sourceMode(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "auto") return "auto";
  if (normalized === "airscale") return "airscale";
  return "contacts";
}

export async function GET(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const url = new URL(request.url);
  try {
    return NextResponse.json(
      await getOutboxConsoleState(brandId, String(url.searchParams.get("sender") ?? "").trim())
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load outbox" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const body = asRecord(await request.json().catch(() => ({})));
  try {
    const result = await launchOutboxBatch({
      brandId,
      senderAccountId: String(body.senderAccountId ?? "").trim(),
      batchName: String(body.batchName ?? "").trim(),
      contactsText: String(body.contactsText ?? "").trim(),
      finderText: String(body.finderText ?? "").trim(),
      sourceMode: sourceMode(body.sourceMode),
      prospectQuery: String(body.prospectQuery ?? "").trim(),
      prospectOffer: String(body.prospectOffer ?? "").trim(),
      maxProspects: optionalNumber(body.maxProspects),
      subject: String(body.subject ?? "").trim(),
      body: String(body.body ?? "").trim(),
      requestedSendNow: optionalNumber(body.requestedSendNow),
      timezone: String(body.timezone ?? "").trim(),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to launch outbox batch" },
      { status: 400 }
    );
  }
}
