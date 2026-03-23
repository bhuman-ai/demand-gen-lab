import { NextResponse } from "next/server";
import { OperatorDataError } from "@/lib/operator-data";
import { cancelOperatorAction } from "@/lib/operator-runtime";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(
  request: Request,
  context: { params: Promise<{ actionId: string }> }
) {
  try {
    const body = asRecord(await request.json());
    const { actionId } = await context.params;
    const result = await cancelOperatorAction({
      actionId,
      userId: String(body.userId ?? ""),
      note: String(body.note ?? ""),
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OperatorDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const status =
      typeof error === "object" && error && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
    const message = error instanceof Error ? error.message : "Failed to cancel Operator action";
    return NextResponse.json({ error: message }, { status });
  }
}
