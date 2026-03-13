import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import {
  generateExperimentSuggestionResult,
  serializeSuggestionGenerationError,
} from "@/lib/experiment-suggestion-tournament";
import { listExperimentSuggestions } from "@/lib/experiment-suggestion-data";

export async function GET(_: Request, context: { params: Promise<{ brandId: string }> }) {
  try {
    const { brandId } = await context.params;
    const brand = await getBrandById(brandId);
    if (!brand) {
      return NextResponse.json({ error: "brand not found" }, { status: 404 });
    }
    const suggestions = await listExperimentSuggestions(brandId, "suggested");
    return NextResponse.json({ suggestions, mode: "stored" });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load experiment suggestions",
        hint: "No fallback is enabled. Fix the underlying data/runtime issue and retry.",
        debug: {
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: { params: Promise<{ brandId: string }> }) {
  try {
    const { brandId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { refresh?: boolean };
    const result = await generateExperimentSuggestionResult({
      brandId,
      refresh: Boolean(body.refresh),
      signal: request.signal,
    });
    return NextResponse.json(result);
  } catch (error) {
    const payload = serializeSuggestionGenerationError(error);
    return NextResponse.json(
      {
        error: payload.error,
        hint: payload.hint,
        debug: payload.debug,
      },
      { status: payload.status }
    );
  }
}
