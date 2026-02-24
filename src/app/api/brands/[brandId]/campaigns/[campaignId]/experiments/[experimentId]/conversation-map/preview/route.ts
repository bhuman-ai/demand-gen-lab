import { NextResponse } from "next/server";
import { getBrandById, getCampaignById } from "@/lib/factory-data";
import { getExperimentRecordByRuntimeRef } from "@/lib/experiment-data";
import { getConversationMapByExperiment } from "@/lib/conversation-flow-data";
import {
  conversationPromptModeEnabled,
  generateConversationPromptMessage,
} from "@/lib/conversation-prompt-render";
import type { ConversationFlowNode, ReplyThread } from "@/lib/factory-types";

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

  if (!conversationPromptModeEnabled()) {
    return NextResponse.json(
      { error: "Prompt mode is disabled", hint: "Set CONVERSATION_PROMPT_MODE_ENABLED=true" },
      { status: 409 }
    );
  }

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

  const body = asRecord(await request.json().catch(() => ({})));
  const nodeId = String(body.nodeId ?? "").trim();
  if (!nodeId) {
    return NextResponse.json({ error: "nodeId is required" }, { status: 400 });
  }

  const graph = map.draftGraph;
  const node = nodeById(graph.nodes, nodeId);
  if (!node) {
    return NextResponse.json({ error: "node not found in draft graph" }, { status: 404 });
  }
  if (node.kind !== "message") {
    return NextResponse.json({ error: "only message nodes can be previewed" }, { status: 400 });
  }

  const sourceExperiment = await getExperimentRecordByRuntimeRef(brandId, campaignId, experimentId);
  const parsed = parseOfferAndCta(sourceExperiment?.offer ?? "");
  const hypothesis = campaign.hypotheses.find((item) => item.id === variant.hypothesisId) ?? null;

  const sampleLead = asRecord(body.sampleLead);
  const sampleReply = asRecord(body.sampleReply);
  const graphLead =
    graph.previewLeads.find((lead) => lead.id === graph.previewLeadId) ??
    graph.previewLeads[0] ??
    null;
  const sampleLeadEmail = String(sampleLead.email ?? graphLead?.email ?? "").trim();
  const sampleLeadName = String(sampleLead.name ?? graphLead?.name ?? "").trim();
  const sampleLeadCompany = String(sampleLead.company ?? graphLead?.company ?? "").trim();
  const sampleLeadTitle = String(sampleLead.title ?? graphLead?.title ?? "").trim();
  const sampleLeadDomain = String(sampleLead.domain ?? graphLead?.domain ?? "").trim();
  if (!sampleLeadEmail || !sampleLeadName || !sampleLeadCompany) {
    return NextResponse.json(
      {
        error: "Preview lead is incomplete",
        hint: "Add at least one demo lead with name, email, and company before generating preview.",
      },
      { status: 422 }
    );
  }
  const intentRaw = String(sampleReply.intent ?? "").trim();
  const intent: ReplyThread["intent"] | "" =
    intentRaw === "question" ||
    intentRaw === "interest" ||
    intentRaw === "objection" ||
    intentRaw === "unsubscribe" ||
    intentRaw === "other"
      ? (intentRaw as ReplyThread["intent"])
      : "";

  const generated = await generateConversationPromptMessage({
    node,
    context: {
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
      lead: {
        id: String(sampleLead.id ?? graphLead?.id ?? "sample_lead"),
        email: sampleLeadEmail,
        name: sampleLeadName,
        company: sampleLeadCompany,
        title: sampleLeadTitle,
        domain: sampleLeadDomain,
        status: "new",
      },
      thread: {
        sessionId: String(body.sessionId ?? "preview_session"),
        nodeId,
        parentMessageId: "",
        latestInboundSubject: String(sampleReply.subject ?? ""),
        latestInboundBody: String(sampleReply.body ?? ""),
        intent,
        confidence: Math.max(0, Math.min(1, Number(sampleReply.confidence ?? 0.75) || 0.75)),
        priorNodePath: [graph.startNodeId, nodeId].filter(Boolean),
      },
      safety: {
        maxDepth: graph.maxDepth,
        dailyCap: variant.runPolicy.dailyCap,
        hourlyCap: variant.runPolicy.hourlyCap,
        minSpacingMinutes: variant.runPolicy.minSpacingMinutes,
        timezone: variant.runPolicy.timezone,
      },
    },
  });

  if (!generated.ok) {
    return NextResponse.json(
      {
        error: generated.reason,
        trace: generated.trace,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    subject: generated.subject,
    body: generated.body,
    trace: generated.trace,
  });
}
