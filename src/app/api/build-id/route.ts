import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || "";
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "";
  const buildId = deploymentId || commitSha || "dev";

  return NextResponse.json({ buildId, deploymentId, commitSha });
}
