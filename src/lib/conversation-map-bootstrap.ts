import { getBrandById, getCampaignById, type CampaignRecord, type Experiment, type Hypothesis } from "@/lib/factory-data";
import {
  getConversationMapByExperiment,
  publishConversationMap,
  upsertConversationMapDraft,
} from "@/lib/conversation-flow-data";
import { defaultConversationGraph } from "@/lib/conversation-flow-data";
import {
  ConversationFlowGenerationError,
  generateScreenedConversationFlowGraph,
} from "@/lib/conversation-flow-generation";
import { getExperimentRecordByRuntimeRef } from "@/lib/experiment-data";
import type { ConversationFlowGraph, ConversationMap, ExperimentRecord } from "@/lib/factory-types";

type OfferAndCta = {
  offer: string;
  cta: string;
};

type BootstrapContext = {
  brandId: string;
  campaignId: string;
  experimentId: string;
  brandName: string;
  brandWebsite: string;
  brandTone: string;
  brandNotes: string;
  campaign: CampaignRecord;
  experiment: Experiment;
  hypothesis: Hypothesis | null;
  sourceExperiment: ExperimentRecord | null;
  parsedOffer: OfferAndCta;
};

type GeneratedGraphResult = {
  graph: ConversationFlowGraph;
  mode: string;
  fallbackReason: string;
};

export type EnsureConversationMapForVariantResult = {
  map: ConversationMap;
  mode: "existing" | "generated" | "reseeded";
  generationMode: string;
  published: boolean;
};

function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function parseConversationOfferAndCta(rawOffer: string): OfferAndCta {
  const text = String(rawOffer ?? "").trim();
  if (!text) return { offer: "", cta: "" };
  const ctaMatch = text.match(/\bCTA\s*:\s*([^\n]+)/i);
  const cta = ctaMatch ? ctaMatch[1].trim() : "";
  const offer = text.replace(/\bCTA\s*:\s*[^\n]+/gi, "").replace(/\s{2,}/g, " ").trim();
  return { offer, cta };
}

export function conversationGraphHasLaunchableStartNode(graph: ConversationFlowGraph): boolean {
  const startNode = graph.nodes.find((node) => node.id === graph.startNodeId) ?? null;
  return Boolean(
    startNode &&
      startNode.kind === "message" &&
      startNode.autoSend &&
      String(startNode.promptTemplate ?? "").trim()
  );
}

export function graphContainsLegacyGenericCopy(graph: ConversationFlowGraph): boolean {
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

export function shouldAutoReseedLegacyDraft(
  map: Pick<ConversationMap, "createdAt" | "updatedAt" | "draftGraph" | "publishedGraph">,
  parsedOffer: OfferAndCta
): boolean {
  if (!parsedOffer.offer.trim()) return false;
  const draftMatchesPublished =
    JSON.stringify(map.draftGraph) === JSON.stringify(map.publishedGraph);
  const untouchedDraft = Boolean(map.createdAt && map.updatedAt && map.createdAt === map.updatedAt);
  if (!untouchedDraft && !draftMatchesPublished) return false;
  return graphContainsLegacyGenericCopy(map.draftGraph);
}

async function loadBootstrapContext(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
}): Promise<BootstrapContext | null> {
  const [brand, campaign] = await Promise.all([
    getBrandById(input.brandId),
    getCampaignById(input.brandId, input.campaignId),
  ]);
  if (!campaign) return null;
  const experiment = campaign.experiments.find((item) => item.id === input.experimentId) ?? null;
  if (!experiment) return null;
  const sourceExperiment = await getExperimentRecordByRuntimeRef(
    input.brandId,
    input.campaignId,
    input.experimentId
  );
  const parsedOffer = parseConversationOfferAndCta(sourceExperiment?.offer ?? "");
  const hypothesis = campaign.hypotheses.find((item) => item.id === experiment.hypothesisId) ?? null;
  return {
    brandId: input.brandId,
    campaignId: input.campaignId,
    experimentId: input.experimentId,
    brandName: brand?.name ?? "",
    brandWebsite: brand?.website ?? "",
    brandTone: brand?.tone ?? "",
    brandNotes: brand?.notes ?? "",
    campaign,
    experiment,
    hypothesis,
    sourceExperiment,
    parsedOffer,
  };
}

function defaultGraphForContext(context: BootstrapContext) {
  return defaultConversationGraph({
    offer:
      context.parsedOffer.offer ||
      context.sourceExperiment?.offer ||
      context.campaign.objective?.goal ||
      "",
    cta: context.parsedOffer.cta || "",
    audience:
      context.sourceExperiment?.audience ||
      context.hypothesis?.actorQuery ||
      "",
    campaignGoal: context.campaign.objective?.goal || "",
  });
}

async function generateGraphForContext(context: BootstrapContext): Promise<GeneratedGraphResult> {
  try {
    const generated = await generateScreenedConversationFlowGraph({
      context: {
        brand: {
          name: context.brandName,
          website: context.brandWebsite,
          tone: context.brandTone,
          notes: context.brandNotes,
        },
        campaign: {
          campaignName: context.campaign.name,
          objectiveGoal: context.campaign.objective?.goal ?? "",
          objectiveConstraints: context.campaign.objective?.constraints ?? "",
          angleTitle: context.hypothesis?.title ?? "",
          angleRationale: context.hypothesis?.rationale ?? "",
          targetAudience: context.hypothesis?.actorQuery ?? "",
          variantName: context.experiment.name,
          variantNotes: context.experiment.notes ?? "",
        },
        experiment: {
          experimentRecordName: context.sourceExperiment?.name ?? "",
          offer:
            context.parsedOffer.offer ||
            context.sourceExperiment?.offer ||
            context.campaign.objective?.goal ||
            "",
          cta: context.parsedOffer.cta || "",
          audience: context.sourceExperiment?.audience || "",
          ultimateGoal: "",
          testEnvelope: context.sourceExperiment?.testEnvelope ?? null,
        },
      },
    });
    return {
      graph: generated.graph,
      mode: generated.mode,
      fallbackReason: "",
    };
  } catch (error) {
    const fallbackGraph = defaultGraphForContext(context);
    const fallbackReason =
      error instanceof ConversationFlowGenerationError
        ? [error.message, error.details].filter(Boolean).join(" ")
        : error instanceof Error
          ? error.message
          : "unknown_generation_error";
    return {
      graph: fallbackGraph,
      mode: "default_fallback",
      fallbackReason: oneLine(fallbackReason),
    };
  }
}

export async function ensureConversationMapForVariant(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
  publish?: boolean;
  reseedLegacyDraft?: boolean;
}): Promise<EnsureConversationMapForVariantResult | null> {
  const context = await loadBootstrapContext(input);
  if (!context) return null;

  let map = await getConversationMapByExperiment(input.brandId, input.campaignId, input.experimentId);
  let mode: EnsureConversationMapForVariantResult["mode"] = "existing";
  let generationMode = "existing";

  if (map && input.reseedLegacyDraft && shouldAutoReseedLegacyDraft(map, context.parsedOffer)) {
    const generated = await generateGraphForContext(context);
    map = await upsertConversationMapDraft({
      brandId: input.brandId,
      campaignId: input.campaignId,
      experimentId: input.experimentId,
      name: map.name || `${context.experiment.name || "Variant"} Conversation Flow`,
      draftGraph: generated.graph,
    });
    mode = "reseeded";
    generationMode = generated.mode;
  }

  if (!map) {
    const generated = await generateGraphForContext(context);
    map = await upsertConversationMapDraft({
      brandId: input.brandId,
      campaignId: input.campaignId,
      experimentId: input.experimentId,
      name: `${context.experiment.name || "Variant"} Conversation Flow`,
      draftGraph: generated.graph,
    });
    mode = "generated";
    generationMode = generated.mode;
  }

  let published = false;
  if (input.publish && map.publishedRevision <= 0 && conversationGraphHasLaunchableStartNode(map.draftGraph)) {
    const next = await publishConversationMap({
      brandId: input.brandId,
      campaignId: input.campaignId,
      experimentId: input.experimentId,
    });
    if (next) {
      map = next;
      published = true;
    }
  }

  return {
    map,
    mode,
    generationMode,
    published,
  };
}
