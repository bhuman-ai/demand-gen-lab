import { NextResponse } from "next/server";
import { emailFinderHealthPayload } from "@/lib/internal-email-finder";

export async function GET() {
  return NextResponse.json(emailFinderHealthPayload());
}
