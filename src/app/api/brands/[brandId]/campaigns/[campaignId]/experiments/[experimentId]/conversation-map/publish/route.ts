import { NextResponse } from "next/server";
import { getCampaignById } from "@/lib/factory-data";
import { getExperimentRecordByRuntimeRef } from "@/lib/experiment-data";
import {
  ConversationFlowDataError,
  publishConversationMap,
} from "@/lib/conversation-flow-data";

function normalizeBusinessHour(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeBusinessDays(value: unknown, fallback: number[]) {
  if (!Array.isArray(value)) return fallback;
  const days = value
    .map((entry) => Math.round(Number(entry)))
    .filter((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 6);
  const unique = Array.from(new Set(days)).sort((a, b) => a - b);
  return unique.length ? unique : fallback;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string; experimentId: string }> }
) {
  const { brandId, campaignId, experimentId } = await context.params;

  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const experiment = campaign.experiments.find((item) => item.id === experimentId) ?? null;
  if (!experiment) {
    return NextResponse.json({ error: "variant not found" }, { status: 404 });
  }
  const sourceExperiment = await getExperimentRecordByRuntimeRef(brandId, campaignId, experimentId);
  const workingHours = {
    timezone:
      String(sourceExperiment?.testEnvelope.timezone ?? experiment.runPolicy?.timezone ?? "America/Los_Angeles").trim() ||
      "America/Los_Angeles",
    businessHoursEnabled: sourceExperiment?.testEnvelope.businessHoursEnabled !== false,
    businessHoursStartHour: normalizeBusinessHour(sourceExperiment?.testEnvelope.businessHoursStartHour, 9, 0, 23),
    businessHoursEndHour: normalizeBusinessHour(sourceExperiment?.testEnvelope.businessHoursEndHour, 17, 1, 24),
    businessDays: normalizeBusinessDays(sourceExperiment?.testEnvelope.businessDays, [1, 2, 3, 4, 5]),
  };

  try {
    const map = await publishConversationMap({ brandId, campaignId, experimentId });
    if (!map) {
      return NextResponse.json({ error: "conversation map not found" }, { status: 404 });
    }
    return NextResponse.json({ map, workingHours });
  } catch (error) {
    if (error instanceof ConversationFlowDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to publish conversation map" }, { status: 500 });
  }
}
