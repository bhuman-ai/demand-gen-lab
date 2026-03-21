import { NextResponse } from "next/server";
import { prepareExperimentSendableContacts } from "@/lib/experiment-sendable-prep";

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string; experimentId: string }> }
) {
  const { brandId, experimentId } = await context.params;

  try {
    const result = await prepareExperimentSendableContacts({
      brandId,
      experimentId,
      requestOrigin: new URL(request.url).origin,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve approved prospects.";

    if (message === "experiment not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    if (message === "experiment runtime is not configured") {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: "Failed to resolve approved prospects.",
        hint: message,
      },
      { status: 500 }
    );
  }
}
