import { NextResponse } from "next/server";
import { OperatorDataError, listOperatorThreads } from "@/lib/operator-data";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const threads = await listOperatorThreads({
      userId: searchParams.get("userId") ?? "",
      brandId: searchParams.get("brandId") ?? "",
      status: searchParams.get("status") === "archived" ? "archived" : searchParams.get("status") === "active" ? "active" : undefined,
    });
    return NextResponse.json({ threads });
  } catch (error) {
    if (error instanceof OperatorDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load Operator threads";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
