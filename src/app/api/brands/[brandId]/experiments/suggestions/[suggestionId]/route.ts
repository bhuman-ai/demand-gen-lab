import { NextResponse } from "next/server";
import { getBrandById } from "@/lib/factory-data";
import { getExperimentRecordById } from "@/lib/experiment-data";
import {
  getExperimentSuggestionById,
  updateExperimentSuggestion,
} from "@/lib/experiment-suggestion-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ brandId: string; suggestionId: string }> }
) {
  try {
    const { brandId, suggestionId } = await context.params;

    const brand = await getBrandById(brandId);
    if (!brand) {
      return NextResponse.json({ error: "brand not found" }, { status: 404 });
    }

    const suggestion = await getExperimentSuggestionById(brandId, suggestionId);
    if (!suggestion) {
      return NextResponse.json(
        {
          error: "suggestion not found",
          hint: "Suggestion is stale or invalid. Generate suggestions again.",
        },
        { status: 404 }
      );
    }

    const body = asRecord(await request.json().catch(() => ({})));
    const action = String(body.action ?? "").trim().toLowerCase();

    if (action === "dismiss") {
      const updated = await updateExperimentSuggestion(brandId, suggestionId, {
        status: "dismissed",
      });
      if (!updated) {
        return NextResponse.json(
          { error: "Failed to dismiss suggestion", hint: "Suggestion no longer exists." },
          { status: 404 }
        );
      }
      return NextResponse.json({ suggestion: updated });
    }

    if (action === "accept") {
      const updated = await updateExperimentSuggestion(brandId, suggestionId, {
        status: "accepted",
      });
      if (!updated || !updated.acceptedExperimentId) {
        return NextResponse.json(
          {
            error: "Failed to accept suggestion",
            hint: "Suggestion is stale/incomplete. Generate a fresh concrete suggestion and retry.",
          },
          { status: 409 }
        );
      }

      const experiment = await getExperimentRecordById(brandId, updated.acceptedExperimentId, {
        includeSuggestions: true,
      });
      if (!experiment) {
        return NextResponse.json(
          {
            error: "accepted experiment not found",
            debug: { acceptedExperimentId: updated.acceptedExperimentId },
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ suggestion: updated, experiment });
    }

    return NextResponse.json({ error: "action must be accept or dismiss" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unhandled suggestion action failure",
        hint: "No fallback is enabled. Review debug and regenerate suggestions.",
        debug: {
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      },
      { status: 500 }
    );
  }
}
