import { NextResponse } from "next/server";
import { OperatorDataError } from "@/lib/operator-data";
import { getOperatorActivitySummary } from "@/lib/operator-activity";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const activity = await getOperatorActivitySummary({
      brandId: searchParams.get("brandId") ?? "",
      limit: Number(searchParams.get("limit") ?? 8),
    });
    return NextResponse.json({ activity });
  } catch (error) {
    if (error instanceof OperatorDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load Operator activity";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
