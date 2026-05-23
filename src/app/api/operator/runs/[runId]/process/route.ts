import { NextResponse } from "next/server";
import { OutreachDataError } from "@/lib/outreach-data";
import { OperatorDataError } from "@/lib/operator-data";
import { processOperatorChatRun } from "@/lib/operator-runtime";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await context.params;
    const body = asRecord(await request.json().catch(() => ({})));
    const result = await processOperatorChatRun({
      runId,
      userId: String(body.userId ?? ""),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OperatorDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    if (error instanceof OutreachDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const status =
      typeof error === "object" && error && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
    const message = error instanceof Error ? error.message : "Failed to process Operator run";
    return NextResponse.json({ error: message }, { status });
  }
}
