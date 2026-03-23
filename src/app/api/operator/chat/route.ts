import { NextResponse } from "next/server";
import { OutreachDataError } from "@/lib/outreach-data";
import { OperatorDataError } from "@/lib/operator-data";
import { runOperatorChatTurn } from "@/lib/operator-runtime";
import type { OperatorToolName } from "@/lib/operator-types";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(request: Request) {
  try {
    const body = asRecord(await request.json());
    const structuredActionRaw = asRecord(body.structuredAction);
    const result = await runOperatorChatTurn({
      threadId: String(body.threadId ?? ""),
      userId: String(body.userId ?? ""),
      brandId: String(body.brandId ?? ""),
      message: String(body.message ?? ""),
      mode: String(body.mode ?? "") === "recommendation_only" ? "recommendation_only" : "default",
      structuredAction:
        Object.keys(structuredActionRaw).length > 0
          ? {
              toolName: String(structuredActionRaw.toolName ?? "") as OperatorToolName,
              input: asRecord(structuredActionRaw.input),
            }
          : null,
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
    const message = error instanceof Error ? error.message : "Operator chat failed";
    return NextResponse.json({ error: message }, { status });
  }
}
