import { NextResponse } from "next/server";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import {
  ConversationFlowGenerationError,
  generateScreenedConversationFlowGraph,
} from "@/lib/conversation-flow-generation";
import { getExperimentRecordByRuntimeRef, updateExperimentRecord } from "@/lib/experiment-data";
import type { ConversationFlowGraph, ConversationMap } from "@/lib/factory-types";
import {
  ConversationFlowDataError,
  getConversationMapByExperiment,
  normalizeConversationGraph,
  upsertConversationMapDraft,
} from "@/lib/conversation-flow-data";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseOfferAndCta(rawOffer: string) {
  const text = String(rawOffer ?? "").trim();
  if (!text) return { offer: "", cta: "" };
  const ctaMatch = text.match(/\bCTA\s*:\s*([^\n]+)/i);
  const cta = ctaMatch ? ctaMatch[1].trim() : "";
  const offer = text.replace(/\bCTA\s*:\s*[^\n]+/gi, "").replace(/\s{2,}/g, " ").trim();
  return { offer, cta };
}

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

function workingHoursPayload(input: {
  experimentTimezone?: string;
  experimentBusinessHoursEnabled?: boolean;
  experimentBusinessHoursStartHour?: number;
  experimentBusinessHoursEndHour?: number;
  experimentBusinessDays?: number[];
  variantTimezone?: string;
}) {
  return {
    timezone: String(input.experimentTimezone ?? input.variantTimezone ?? "America/Los_Angeles").trim() || "America/Los_Angeles",
    businessHoursEnabled: input.experimentBusinessHoursEnabled !== false,
    businessHoursStartHour: normalizeBusinessHour(input.experimentBusinessHoursStartHour, 9, 0, 23),
    businessHoursEndHour: normalizeBusinessHour(input.experimentBusinessHoursEndHour, 17, 1, 24),
    businessDays: normalizeBusinessDays(input.experimentBusinessDays, [1, 2, 3, 4, 5]),
  };
}

function graphContainsLegacyGenericCopy(graph: ConversationFlowGraph): boolean {
  return graph.nodes.some((node) => {
    if (node.kind !== "message") return false;
    const subject = node.subject.trim().toLowerCase();
    const body = node.body.trim().toLowerCase();
    return (
      subject.includes("{{campaigngoal}}") ||
      body.includes("{{campaigngoal}}") ||
      subject.includes("quick question") ||
      subject.includes("worth a 10-minute walkthrough") ||
      subject.includes("close the loop?")
    );
  });
}

function shouldAutoReseedLegacyDraft(
  map: ConversationMap,
  parsedOffer: { offer: string; cta: string }
): boolean {
  if (!parsedOffer.offer.trim()) return false;
  const draftMatchesPublished =
    JSON.stringify(map.draftGraph) === JSON.stringify(map.publishedGraph);
  const untouchedDraft = Boolean(map.createdAt && map.updatedAt && map.createdAt === map.updatedAt);
  if (!untouchedDraft && !draftMatchesPublished) return false;
  return graphContainsLegacyGenericCopy(map.draftGraph);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string; experimentId: string }> }
) {
  const { brandId, campaignId, experimentId } = await context.params;

  const [brand, campaign] = await Promise.all([getBrandById(brandId), getCampaignById(brandId, campaignId)]);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const experiment = campaign.experiments.find((item) => item.id === experimentId) ?? null;
  if (!experiment) {
    return NextResponse.json({ error: "variant not found" }, { status: 404 });
  }

  const sourceExperiment = await getExperimentRecordByRuntimeRef(brandId, campaignId, experimentId);
  const parsed = parseOfferAndCta(sourceExperiment?.offer ?? "");
  const hypothesis = campaign.hypotheses.find((item) => item.id === experiment.hypothesisId) ?? null;
  const workingHours = workingHoursPayload({
    experimentTimezone: sourceExperiment?.testEnvelope.timezone,
    experimentBusinessHoursEnabled: sourceExperiment?.testEnvelope.businessHoursEnabled,
    experimentBusinessHoursStartHour: sourceExperiment?.testEnvelope.businessHoursStartHour,
    experimentBusinessHoursEndHour: sourceExperiment?.testEnvelope.businessHoursEndHour,
    experimentBusinessDays: sourceExperiment?.testEnvelope.businessDays,
    variantTimezone: experiment.runPolicy?.timezone,
  });

  try {
    const map = await getConversationMapByExperiment(brandId, campaignId, experimentId);
    if (map) {
      if (shouldAutoReseedLegacyDraft(map, parsed)) {
        const generated = await generateScreenedConversationFlowGraph({
          context: {
            brand: {
              name: brand?.name ?? "",
              website: brand?.website ?? "",
              tone: brand?.tone ?? "",
              notes: brand?.notes ?? "",
            },
            campaign: {
              campaignName: campaign.name,
              objectiveGoal: campaign.objective?.goal ?? "",
              objectiveConstraints: campaign.objective?.constraints ?? "",
              angleTitle: hypothesis?.title ?? "",
              angleRationale: hypothesis?.rationale ?? "",
              targetAudience: hypothesis?.actorQuery ?? "",
              variantName: experiment.name,
              variantNotes: experiment.notes ?? "",
            },
            experiment: {
              experimentRecordName: sourceExperiment?.name ?? "",
              offer: parsed.offer || sourceExperiment?.offer || campaign.objective.goal || "",
              cta: parsed.cta || "",
              audience: sourceExperiment?.audience || "",
              ultimateGoal: "",
              testEnvelope: sourceExperiment?.testEnvelope ?? null,
            },
          },
        });
        const reseeded = await upsertConversationMapDraft({
          brandId,
          campaignId,
          experimentId,
          name: map.name,
          draftGraph: generated.graph,
        });
        return NextResponse.json({ map: reseeded, workingHours, reseeded: true });
      }
      return NextResponse.json({ map, workingHours });
    }

    const generated = await generateScreenedConversationFlowGraph({
      context: {
        brand: {
          name: brand?.name ?? "",
          website: brand?.website ?? "",
          tone: brand?.tone ?? "",
          notes: brand?.notes ?? "",
        },
        campaign: {
          campaignName: campaign.name,
          objectiveGoal: campaign.objective?.goal ?? "",
          objectiveConstraints: campaign.objective?.constraints ?? "",
          angleTitle: hypothesis?.title ?? "",
          angleRationale: hypothesis?.rationale ?? "",
          targetAudience: hypothesis?.actorQuery ?? "",
          variantName: experiment.name,
          variantNotes: experiment.notes ?? "",
        },
        experiment: {
          experimentRecordName: sourceExperiment?.name ?? "",
          offer: parsed.offer || sourceExperiment?.offer || campaign.objective.goal || "",
          cta: parsed.cta || "",
          audience: sourceExperiment?.audience || "",
          ultimateGoal: "",
          testEnvelope: sourceExperiment?.testEnvelope ?? null,
        },
      },
    });
    const created = await upsertConversationMapDraft({
      brandId,
      campaignId,
      experimentId,
      name: `${experiment.name || "Variant"} Conversation Flow`,
      draftGraph: generated.graph,
    });
    return NextResponse.json({ map: created, workingHours, generated: true, mode: generated.mode });
  } catch (error) {
    if (error instanceof ConversationFlowGenerationError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    }
    if (error instanceof ConversationFlowDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to load conversation map" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
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

  const body = asRecord(await request.json());
  const draftGraph = normalizeConversationGraph(body.draftGraph);
  const name = String(body.name ?? `${experiment.name || "Variant"} Conversation Flow`).trim();
  const sourceExperiment = await getExperimentRecordByRuntimeRef(brandId, campaignId, experimentId);
  const inputWorkingHours = asRecord(body.workingHours);

  let workingHours = workingHoursPayload({
    experimentTimezone: sourceExperiment?.testEnvelope.timezone,
    experimentBusinessHoursEnabled: sourceExperiment?.testEnvelope.businessHoursEnabled,
    experimentBusinessHoursStartHour: sourceExperiment?.testEnvelope.businessHoursStartHour,
    experimentBusinessHoursEndHour: sourceExperiment?.testEnvelope.businessHoursEndHour,
    experimentBusinessDays: sourceExperiment?.testEnvelope.businessDays,
    variantTimezone: experiment.runPolicy?.timezone,
  });

  if (sourceExperiment && Object.keys(inputWorkingHours).length) {
    const updated = await updateExperimentRecord(brandId, sourceExperiment.id, {
      testEnvelope: {
        ...sourceExperiment.testEnvelope,
        timezone: String(inputWorkingHours.timezone ?? workingHours.timezone).trim() || workingHours.timezone,
        businessHoursEnabled:
          inputWorkingHours.businessHoursEnabled === undefined
            ? workingHours.businessHoursEnabled
            : inputWorkingHours.businessHoursEnabled !== false,
        businessHoursStartHour: normalizeBusinessHour(
          inputWorkingHours.businessHoursStartHour,
          workingHours.businessHoursStartHour,
          0,
          23
        ),
        businessHoursEndHour: normalizeBusinessHour(
          inputWorkingHours.businessHoursEndHour,
          workingHours.businessHoursEndHour,
          1,
          24
        ),
        businessDays: normalizeBusinessDays(inputWorkingHours.businessDays, workingHours.businessDays),
      },
    });
    if (updated) {
      workingHours = workingHoursPayload({
        experimentTimezone: updated.testEnvelope.timezone,
        experimentBusinessHoursEnabled: updated.testEnvelope.businessHoursEnabled,
        experimentBusinessHoursStartHour: updated.testEnvelope.businessHoursStartHour,
        experimentBusinessHoursEndHour: updated.testEnvelope.businessHoursEndHour,
        experimentBusinessDays: updated.testEnvelope.businessDays,
        variantTimezone: experiment.runPolicy?.timezone,
      });
    }
  }

  try {
    const map = await upsertConversationMapDraft({
      brandId,
      campaignId,
      experimentId,
      name,
      draftGraph,
    });
    return NextResponse.json({ map, workingHours });
  } catch (error) {
    if (error instanceof ConversationFlowDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to save conversation map" }, { status: 500 });
  }
}
