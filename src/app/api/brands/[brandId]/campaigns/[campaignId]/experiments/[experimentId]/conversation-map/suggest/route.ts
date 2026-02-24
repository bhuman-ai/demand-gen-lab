import { NextResponse } from "next/server";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import { getExperimentRecordByRuntimeRef } from "@/lib/experiment-data";
import {
  ConversationFlowGenerationError,
  generateScreenedConversationFlowGraph,
} from "@/lib/conversation-flow-generation";

function parseOfferAndCta(rawOffer: string) {
  const text = String(rawOffer ?? "").trim();
  if (!text) return { offer: "", cta: "" };
  const ctaMatch = text.match(/\bCTA\s*:\s*([^\n]+)/i);
  const cta = ctaMatch ? ctaMatch[1].trim() : "";
  const offer = text.replace(/\bCTA\s*:\s*[^\n]+/gi, "").replace(/\s{2,}/g, " ").trim();
  return { offer, cta };
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string; experimentId: string }> }
) {
  const { brandId, campaignId, experimentId } = await context.params;
  const [brand, campaign] = await Promise.all([
    getBrandById(brandId),
    getCampaignById(brandId, campaignId),
  ]);
  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const experiment = campaign.experiments.find((item) => item.id === experimentId) ?? null;
  if (!experiment) {
    return NextResponse.json({ error: "variant not found" }, { status: 404 });
  }
  const sourceExperiment = await getExperimentRecordByRuntimeRef(brandId, campaignId, experimentId);
  const parsedContext = parseOfferAndCta(sourceExperiment?.offer ?? "");

  const hypothesis = campaign.hypotheses.find((item) => item.id === experiment.hypothesisId) ?? null;
  try {
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
          offer: parsedContext.offer || sourceExperiment?.offer || "",
          cta: parsedContext.cta || "",
          audience: sourceExperiment?.audience || "",
          testEnvelope: sourceExperiment?.testEnvelope ?? null,
        },
      },
    });
    return NextResponse.json({
      graph: generated.graph,
      mode: generated.mode,
      selectedIndex: generated.selectedIndex,
      score: generated.score,
      summary: generated.summary,
    });
  } catch (error) {
    if (error instanceof ConversationFlowGenerationError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { error: "Conversation-map generation failed", details: error instanceof Error ? error.message : "" },
      { status: 500 }
    );
  }
}
