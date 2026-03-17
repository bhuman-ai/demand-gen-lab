import { NextResponse } from "next/server";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import {
  ConversationFlowGenerationError,
  generateScreenedConversationFlowGraph,
} from "@/lib/conversation-flow-generation";
import type { ConversationMapSuggestionStreamEvent } from "@/lib/factory-types";
import { getExperimentRecordByRuntimeRef } from "@/lib/experiment-data";

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

function encodeEvent(encoder: TextEncoder, event: ConversationMapSuggestionStreamEvent) {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string; experimentId: string }> }
) {
  let requestBody: Record<string, unknown> = {};
  try {
    requestBody = asRecord(await request.json());
  } catch {
    requestBody = {};
  }
  const ultimateGoal = String(requestBody.ultimateGoal ?? "").trim();
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
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      const enqueue = (event: ConversationMapSuggestionStreamEvent) => {
        if (closed || request.signal.aborted) return;
        controller.enqueue(encodeEvent(encoder, event));
      };

      void (async () => {
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
                ultimateGoal,
                testEnvelope: sourceExperiment?.testEnvelope ?? null,
              },
            },
            forceRoleplay: Boolean(ultimateGoal),
            onEvent: async (event) => {
              enqueue(event);
            },
          });
          enqueue({ type: "done", result: generated });
        } catch (error) {
          if (!request.signal.aborted) {
            if (error instanceof ConversationFlowGenerationError) {
              enqueue({
                type: "error",
                message: error.message,
                details: error.details,
              });
            } else {
              enqueue({
                type: "error",
                message: "Conversation-map generation failed",
                details: error instanceof Error ? error.message : "",
              });
            }
          }
        } finally {
          close();
        }
      })();

      request.signal.addEventListener(
        "abort",
        () => {
          close();
        },
        { once: true }
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
