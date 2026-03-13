import { NextResponse } from "next/server";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import { getExperimentRecordByRuntimeRef } from "@/lib/experiment-data";
import { getConversationMapByExperiment } from "@/lib/conversation-flow-data";
import { listConversationPreviewLeads } from "@/lib/conversation-preview-leads";
import { runConversationMapProbe } from "@/lib/conversation-probe";
import type { ConversationFlowNode } from "@/lib/factory-types";

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

function nodeById(nodes: ConversationFlowNode[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId) ?? null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string; campaignId: string; experimentId: string }> }
) {
  const { brandId, campaignId, experimentId } = await context.params;

  const [brand, campaign, map] = await Promise.all([
    getBrandById(brandId),
    getCampaignById(brandId, campaignId),
    getConversationMapByExperiment(brandId, campaignId, experimentId),
  ]);

  if (!campaign) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const variant = campaign.experiments.find((item) => item.id === experimentId) ?? null;
  if (!variant) {
    return NextResponse.json({ error: "variant not found" }, { status: 404 });
  }

  if (!map) {
    return NextResponse.json({ error: "conversation map not found" }, { status: 404 });
  }

  const graph = map.draftGraph;
  const body = asRecord(await request.json().catch(() => ({})));
  const requestedNodeId = String(body.nodeId ?? "").trim();
  const startNodeId = requestedNodeId || graph.startNodeId;
  const startNode = nodeById(graph.nodes, startNodeId);
  if (!startNode) {
    return NextResponse.json({ error: "start node not found in draft graph" }, { status: 404 });
  }
  if (startNode.kind !== "message") {
    return NextResponse.json({ error: "probe start node must be a message node" }, { status: 400 });
  }

  const sourceExperiment = await getExperimentRecordByRuntimeRef(brandId, campaignId, experimentId);
  const parsed = parseOfferAndCta(sourceExperiment?.offer ?? "");
  const hypothesis = campaign.hypotheses.find((item) => item.id === variant.hypothesisId) ?? null;
  const sourcedPreviewLeads = await listConversationPreviewLeads({
    brandId,
    campaignId,
    experimentId,
    limit: 1,
  });

  const sampleLead = asRecord(body.sampleLead);
  const sourcedLead = sourcedPreviewLeads.leads[0] ?? null;
  const leadEmail = String(sampleLead.email ?? sourcedLead?.email ?? "").trim();
  if (!leadEmail) {
    return NextResponse.json(
      {
        error: "No sourced leads with real work email available for probe",
        hint: "Run sourcing until at least one lead has a real work email, then retry probe.",
      },
      { status: 422 }
    );
  }

  const lead = {
    id: String(sampleLead.id ?? sourcedLead?.id ?? "probe_lead"),
    name: String(sampleLead.name ?? sourcedLead?.name ?? "").trim(),
    email: leadEmail,
    company: String(sampleLead.company ?? sourcedLead?.company ?? "").trim(),
    title: String(sampleLead.title ?? sourcedLead?.title ?? "").trim(),
    domain: String(sampleLead.domain ?? sourcedLead?.domain ?? "").trim(),
    source:
      sampleLead.email || sampleLead.name || sampleLead.company || sampleLead.title || sampleLead.domain
        ? ("manual" as const)
        : ((sourcedLead?.source ?? "sourced") as "seeded" | "manual" | "sourced"),
  };

  const result = await runConversationMapProbe({
    brand: {
      id: brandId,
      name: brand?.name ?? "",
      website: brand?.website ?? "",
      tone: brand?.tone ?? "",
      notes: brand?.notes ?? "",
    },
    campaign: {
      id: campaignId,
      name: campaign.name,
      objectiveGoal: campaign.objective.goal ?? "",
      objectiveConstraints: campaign.objective.constraints ?? "",
    },
    experiment: {
      id: experimentId,
      name: variant.name,
      offer: parsed.offer || sourceExperiment?.offer || "",
      cta: parsed.cta,
      audience: sourceExperiment?.audience || hypothesis?.actorQuery || "",
      notes: variant.notes ?? "",
    },
    runPolicy: {
      dailyCap: variant.runPolicy.dailyCap,
      hourlyCap: variant.runPolicy.hourlyCap,
      minSpacingMinutes: variant.runPolicy.minSpacingMinutes,
      timezone: variant.runPolicy.timezone,
    },
    workingHours: {
      timezone: String(sourceExperiment?.testEnvelope.timezone ?? variant.runPolicy.timezone ?? "America/Los_Angeles"),
      businessHoursEnabled: sourceExperiment?.testEnvelope.businessHoursEnabled !== false,
      businessHoursStartHour: Math.max(
        0,
        Math.min(23, Number(sourceExperiment?.testEnvelope.businessHoursStartHour ?? 9) || 9)
      ),
      businessHoursEndHour: Math.max(
        1,
        Math.min(24, Number(sourceExperiment?.testEnvelope.businessHoursEndHour ?? 17) || 17)
      ),
      businessDays: Array.isArray(sourceExperiment?.testEnvelope.businessDays)
        ? sourceExperiment!.testEnvelope.businessDays
        : [1, 2, 3, 4, 5],
    },
    graph,
    lead,
    startNodeId,
  });

  return NextResponse.json({ probe: result });
}
