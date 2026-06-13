import { NextResponse } from "next/server";
import {
  getManualBatchConsoleState,
  launchManualBatch,
} from "@/lib/manual-batch-outreach";

export const maxDuration = 180;

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET(_: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  try {
    return NextResponse.json(await getManualBatchConsoleState(brandId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load manual batches" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await context.params;
  const body = asRecord(await request.json().catch(() => ({})));
  try {
    const result = await launchManualBatch({
      brandId,
      senderAccountId: String(body.senderAccountId ?? "").trim(),
      batchName: String(body.batchName ?? "").trim(),
      contactsText: String(body.contactsText ?? "").trim(),
      contacts: Array.isArray(body.contacts) ? body.contacts.map(asRecord) : [],
      subject: String(body.subject ?? "").trim(),
      body: String(body.body ?? "").trim(),
      dailyCap: Number(body.dailyCap ?? 0) || undefined,
      hourlyCap: Number(body.hourlyCap ?? 0) || undefined,
      minSpacingMinutes: Number(body.minSpacingMinutes ?? 0) || undefined,
      timezone: String(body.timezone ?? "").trim(),
      chunkSize: Number(body.chunkSize ?? 0) || undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to launch manual batch" },
      { status: 400 }
    );
  }
}
