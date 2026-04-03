import { NextResponse } from "next/server";
import {
  advanceGmailUiWorkerSession,
  closeGmailUiWorkerSession,
  getGmailUiWorkerSession,
} from "@/lib/gmail-ui-worker-client";

export async function GET(
  _request: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await context.params;
    const snapshot = await getGmailUiWorkerSession(accountId);
    return NextResponse.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read Gmail worker session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const snapshot = await advanceGmailUiWorkerSession(accountId, {
      otp: String(body.otp ?? "").trim(),
      password: String(body.password ?? "").trim(),
      ignoreConfiguredProxy: Boolean(body.ignoreConfiguredProxy),
      refreshMailpoolCredentials: body.refreshMailpoolCredentials !== false,
    });
    return NextResponse.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to advance Gmail worker session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await context.params;
    const result = await closeGmailUiWorkerSession(accountId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to close Gmail worker session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
