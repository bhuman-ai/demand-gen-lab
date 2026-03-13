import { NextResponse } from "next/server";
import { buildEmailFinderGuessResponse } from "@/lib/internal-email-finder";

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const result = await buildEmailFinderGuessResponse(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
