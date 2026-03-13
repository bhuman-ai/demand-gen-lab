import { NextResponse } from "next/server";
import { buildEmailFinderBatchResponse } from "@/lib/internal-email-finder";

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  return NextResponse.json(await buildEmailFinderBatchResponse(body));
}
