import { NextResponse } from "next/server";
import { OperatorDataError, listOperatorAttentionRequests } from "@/lib/operator-data";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const requests = await listOperatorAttentionRequests({
      brandId: searchParams.get("brandId") ?? "",
      status: status === "resolved" ? "resolved" : status === "open" ? "open" : undefined,
      limit: Number(searchParams.get("limit") ?? 20),
    });
    return NextResponse.json({ count: requests.length, requests });
  } catch (error) {
    if (error instanceof OperatorDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load Operator attention requests";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
