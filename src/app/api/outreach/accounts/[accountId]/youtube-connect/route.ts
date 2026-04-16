import { NextResponse } from "next/server";
import { prepareYouTubeConnectUrl, YouTubeConnectError } from "@/lib/youtube-connect";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> }
) {
  try {
    const { accountId } = await context.params;
    const body = asRecord(await request.json().catch(() => ({})));
    const url = await prepareYouTubeConnectUrl({
      accountId,
      brandId: String(body.brandId ?? body.brand_id ?? "").trim(),
      loginHint: String(body.loginHint ?? body.login_hint ?? "").trim(),
    });

    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof YouTubeConnectError) {
      return NextResponse.json(
        {
          error: error.message,
          ...(error.errorCode ? { errorCode: error.errorCode } : {}),
          ...(error.missingFields?.length ? { missingFields: error.missingFields } : {}),
        },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start YouTube connect flow" },
      { status: 500 }
    );
  }
}
