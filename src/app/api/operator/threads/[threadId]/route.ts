import { NextResponse } from "next/server";
import { OperatorDataError } from "@/lib/operator-data";
import { getOperatorThreadDetail } from "@/lib/operator-runtime";

export async function GET(
  _request: Request,
  context: { params: Promise<{ threadId: string }> }
) {
  try {
    const { threadId } = await context.params;
    const detail = await getOperatorThreadDetail(threadId);
    if (!detail) {
      return NextResponse.json({ error: "Operator thread not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof OperatorDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load Operator thread";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
