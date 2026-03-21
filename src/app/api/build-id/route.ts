import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const buildId =
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    "dev";

  return NextResponse.json({ buildId });
}
