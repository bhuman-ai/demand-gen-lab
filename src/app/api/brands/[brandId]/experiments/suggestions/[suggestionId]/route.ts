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
  const { brandId, suggestionId } = await context.params;

  const brand = await getBrandById(brandId);
  if (!brand) {
    return NextResponse.json({ error: "brand not found" }, { status: 404 });
  }

  const suggestion = await getExperimentSuggestionById(brandId, suggestionId);
  if (!suggestion) {
    return NextResponse.json({ error: "suggestion not found" }, { status: 404 });
  }

  const body = asRecord(await request.json().catch(() => ({})));
  const action = String(body.action ?? "").trim().toLowerCase();

  if (action === "dismiss") {
    const updated = await updateExperimentSuggestion(brandId, suggestionId, {
      status: "dismissed",
    });
    return NextResponse.json({ suggestion: updated });
  }

  if (action === "accept") {
    const updated = await updateExperimentSuggestion(brandId, suggestionId, {
      status: "accepted",
    });
    const acceptedExperimentId = updated?.acceptedExperimentId || suggestionId;
    const experiment = await getExperimentRecordById(brandId, acceptedExperimentId, {
      includeSuggestions: true,
    });
    if (!experiment) {
      return NextResponse.json({ error: "experiment not found" }, { status: 404 });
    }
    return NextResponse.json({ suggestion: updated, experiment });
  }

  return NextResponse.json({ error: "action must be accept or dismiss" }, { status: 400 });
}
