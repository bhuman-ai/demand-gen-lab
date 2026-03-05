import { sanitizeAiText } from "@/lib/ai-sanitize";
import { normalizeConversationGraph } from "@/lib/conversation-flow-data";
import { generateConversationPromptMessage } from "@/lib/conversation-prompt-render";
import type { ConversationFlowGraph, ConversationFlowNode } from "@/lib/factory-types";
import { resolveLlmModel, type LlmTask } from "@/lib/llm-router";

type GenerationContext = {
  brand: {
    name: string;
    website: string;
    tone: string;
    notes: string;
  };
  campaign: {
    campaignName: string;
    objectiveGoal: string;
    objectiveConstraints: string;
    angleTitle: string;
    angleRationale: string;
    targetAudience: string;
    variantName: string;
    variantNotes: string;
  };
  experiment: {
    experimentRecordName: string;
    offer: string;
    cta: string;
    audience: string;
    testEnvelope: unknown;
  };
};

type CandidateGraph = {
  index: number;
  graph: ConversationFlowGraph;
  rationale: string;
};

type CandidateRenderedSample = {
  kind: "first_touch" | "reply_followup";
  intent: "question" | "interest" | "objection" | "unsubscribe" | "other" | "";
  nodeId: string;
  nodeTitle: string;
  subject: string;
  body: string;
};

type CandidateEvaluation = {
  index: number;
  score: number;
  openLikelihood: number;
  replyLikelihood: number;
  positiveReplyLikelihood: number;
  negativeRisk: number;
  clarity: number;
  decision: "promote" | "revise" | "reject";
  summary: string;
  strengths: string[];
  risks: string[];
};

export class ConversationFlowGenerationError extends Error {
  status: number;
  details: string;

  constructor(message: string, options: { status?: number; details?: string } = {}) {
    super(message);
    this.name = "ConversationFlowGenerationError";
    this.status = options.status ?? 500;
    this.details = options.details ?? "";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function clampPercent(value: unknown, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function slugifyDomainSeed(value: string) {
  const parts = value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return parts.join("");
}

function roleplaySampleLead(context: GenerationContext) {
  const companySeed =
    oneLine(context.campaign.targetAudience) ||
    oneLine(context.experiment.audience) ||
    "Northbeam";
  const companyName = companySeed.split(",")[0]?.trim() || "Northbeam";
  const domainSeed = slugifyDomainSeed(companyName) || "northbeam";
  const domain = `${domainSeed}.com`;
  return {
    id: "roleplay_lead_1",
    name: "Alex Morgan",
    email: `alex.morgan@${domain}`,
    company: companyName,
    title: "Demand Generation Manager",
    domain,
    status: "new",
  };
}

function findStartMessageNode(graph: ConversationFlowGraph) {
  const start = graph.nodes.find((node) => node.id === graph.startNodeId) ?? null;
  if (start?.kind === "message") return start;
  return graph.nodes.find((node) => node.kind === "message") ?? null;
}

function findReplyFollowupNode(graph: ConversationFlowGraph, startNodeId: string) {
  const intentEdges = graph.edges
    .filter((edge) => edge.fromNodeId === startNodeId && edge.trigger === "intent" && edge.intent)
    .sort((a, b) => a.priority - b.priority);
  for (const edge of intentEdges) {
    const target = graph.nodes.find((node) => node.id === edge.toNodeId) ?? null;
    if (target?.kind === "message") {
      return {
        node: target,
        intent: edge.intent,
      };
    }
  }
  return null;
}

function sampleInboundByIntent(intent: "question" | "interest" | "objection" | "unsubscribe" | "other" | "") {
  if (intent === "question") {
    return {
      subject: "Re: question",
      body: "Can you show one concrete example for our team?",
      confidence: 0.84,
    };
  }
  if (intent === "interest") {
    return {
      subject: "Re: interested",
      body: "This looks relevant. What would the next step be?",
      confidence: 0.86,
    };
  }
  if (intent === "objection") {
    return {
      subject: "Re: not sure",
      body: "Not sure this fits right now. Why this approach?",
      confidence: 0.83,
    };
  }
  if (intent === "unsubscribe") {
    return {
      subject: "Re: stop",
      body: "Please remove me from this sequence.",
      confidence: 0.98,
    };
  }
  return {
    subject: "Re: follow-up",
    body: "Can you clarify this?",
    confidence: 0.72,
  };
}

function renderFailureReason(
  node: ConversationFlowNode,
  reason: string,
  samples: CandidateRenderedSample[]
) {
  const nodeLabel = oneLine(node.title) || node.id;
  return `render_failed node=${nodeLabel} reason=${oneLine(reason || "unknown")} rendered=${samples.length}`;
}

async function renderCandidateSamples(input: {
  context: GenerationContext;
  candidate: CandidateGraph;
}): Promise<CandidateRenderedSample[]> {
  const startNode = findStartMessageNode(input.candidate.graph);
  if (!startNode) {
    throw new ConversationFlowGenerationError("Candidate has no message start node for roleplay rendering.", {
      status: 422,
      details: `candidateIndex=${input.candidate.index}`,
    });
  }

  const lead = roleplaySampleLead(input.context);
  const brandName = oneLine(input.context.brand.name) || "Brand";
  const campaignGoal =
    oneLine(input.context.campaign.objectiveGoal) ||
    oneLine(input.context.experiment.offer) ||
    "pipeline performance";
  const samples: CandidateRenderedSample[] = [];

  const firstTouch = await generateConversationPromptMessage({
    node: startNode,
    context: {
      brand: {
        name: brandName,
        website: oneLine(input.context.brand.website),
        tone: oneLine(input.context.brand.tone),
        notes: oneLine(input.context.brand.notes),
      },
      campaign: {
        name: oneLine(input.context.campaign.campaignName) || "Campaign",
        objectiveGoal: campaignGoal,
        objectiveConstraints: oneLine(input.context.campaign.objectiveConstraints),
      },
      experiment: {
        name: oneLine(input.context.campaign.variantName) || oneLine(input.context.experiment.experimentRecordName),
        offer: oneLine(input.context.experiment.offer),
        cta: oneLine(input.context.experiment.cta),
        audience: oneLine(input.context.experiment.audience) || oneLine(input.context.campaign.targetAudience),
        notes: oneLine(input.context.campaign.variantNotes),
      },
      lead,
      thread: {
        sessionId: `roleplay_${input.candidate.index}_start`,
        nodeId: startNode.id,
        parentMessageId: "",
        latestInboundSubject: "",
        latestInboundBody: "",
        intent: "",
        confidence: 0.5,
        priorNodePath: [startNode.id],
      },
      safety: {
        maxDepth: input.candidate.graph.maxDepth,
        dailyCap: 100,
        hourlyCap: 25,
        minSpacingMinutes: 5,
        timezone: "UTC",
      },
    },
  });
  if (!firstTouch.ok) {
    throw new ConversationFlowGenerationError("Failed to render first-touch sample for roleplay.", {
      status: 422,
      details: renderFailureReason(startNode, firstTouch.reason, samples),
    });
  }
  samples.push({
    kind: "first_touch",
    intent: "",
    nodeId: startNode.id,
    nodeTitle: startNode.title,
    subject: firstTouch.subject,
    body: firstTouch.body,
  });

  const followup = findReplyFollowupNode(input.candidate.graph, startNode.id);
  if (followup) {
    const inbound = sampleInboundByIntent(followup.intent);
    const replySample = await generateConversationPromptMessage({
      node: followup.node,
      context: {
        brand: {
          name: brandName,
          website: oneLine(input.context.brand.website),
          tone: oneLine(input.context.brand.tone),
          notes: oneLine(input.context.brand.notes),
        },
        campaign: {
          name: oneLine(input.context.campaign.campaignName) || "Campaign",
          objectiveGoal: campaignGoal,
          objectiveConstraints: oneLine(input.context.campaign.objectiveConstraints),
        },
        experiment: {
          name: oneLine(input.context.campaign.variantName) || oneLine(input.context.experiment.experimentRecordName),
          offer: oneLine(input.context.experiment.offer),
          cta: oneLine(input.context.experiment.cta),
          audience: oneLine(input.context.experiment.audience) || oneLine(input.context.campaign.targetAudience),
          notes: oneLine(input.context.campaign.variantNotes),
        },
        lead,
        thread: {
          sessionId: `roleplay_${input.candidate.index}_reply`,
          nodeId: followup.node.id,
          parentMessageId: "roleplay_msg_1",
          latestInboundSubject: inbound.subject,
          latestInboundBody: inbound.body,
          intent: followup.intent,
          confidence: inbound.confidence,
          priorNodePath: [startNode.id, followup.node.id],
        },
        safety: {
          maxDepth: input.candidate.graph.maxDepth,
          dailyCap: 100,
          hourlyCap: 25,
          minSpacingMinutes: 5,
          timezone: "UTC",
        },
      },
    });
    if (!replySample.ok) {
      throw new ConversationFlowGenerationError("Failed to render reply-followup sample for roleplay.", {
        status: 422,
        details: renderFailureReason(followup.node, replySample.reason, samples),
      });
    }
    samples.push({
      kind: "reply_followup",
      intent: followup.intent,
      nodeId: followup.node.id,
      nodeTitle: followup.node.title,
      subject: replySample.subject,
      body: replySample.body,
    });
  }

  return samples;
}

function extractOutputText(payloadRaw: unknown) {
  const payload = asRecord(payloadRaw);
  const output = Array.isArray(payload.output) ? payload.output : [];
  const firstOutput = asRecord(output[0]);
  const content = Array.isArray(firstOutput.content) ? firstOutput.content : [];
  return (
    String(payload.output_text ?? "") ||
    String(
      content
        .map((item) => asRecord(item))
        .find((item) => typeof item.text === "string")?.text ?? ""
    ) ||
    "{}"
  );
}

async function openAiJsonCall(input: {
  prompt: string;
  maxOutputTokens: number;
  task: LlmTask;
}): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ConversationFlowGenerationError("OPENAI_API_KEY is missing.", { status: 503 });
  }

  const model = resolveLlmModel(input.task, { prompt: input.prompt });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: input.prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: input.maxOutputTokens,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new ConversationFlowGenerationError("OpenAI conversation-flow generation request failed.", {
      status: 502,
      details: raw.slice(0, 600),
    });
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }

  const outputText = extractOutputText(payload);
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new ConversationFlowGenerationError("Model output was not valid JSON.", {
      status: 502,
      details: outputText.slice(0, 600),
    });
  }
  return asRecord(parsed);
}

function normalizeCandidateGraphs(value: unknown): CandidateGraph[] {
  if (!Array.isArray(value)) return [];
  const rows: CandidateGraph[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < value.length; i += 1) {
    const row = asRecord(value[i]);
    const rawIndex = Number(row.index);
    const index = Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : i;
    if (seen.has(index)) continue;
    seen.add(index);

    const rawGraph = asRecord(row.graph);
    if (!Object.keys(rawGraph).length) continue;

    try {
      const graph = normalizeConversationGraph(rawGraph, { strict: true });
      rows.push({
        index,
        graph,
        rationale: sanitizeAiText(String(row.rationale ?? "").trim()),
      });
    } catch {
      continue;
    }
  }

  return rows;
}

function normalizeEvaluations(value: unknown, validIndexes: Set<number>): CandidateEvaluation[] {
  if (!Array.isArray(value)) return [];
  const rows: CandidateEvaluation[] = [];
  const seen = new Set<number>();

  for (const item of value) {
    const row = asRecord(item);
    const index = Number(row.index);
    if (!Number.isInteger(index) || !validIndexes.has(index) || seen.has(index)) {
      continue;
    }
    seen.add(index);

    const decisionRaw = String(row.decision ?? "").trim().toLowerCase();
    const decision: CandidateEvaluation["decision"] =
      decisionRaw === "promote" || decisionRaw === "reject" ? decisionRaw : "revise";

    const strengths = Array.isArray(row.strengths)
      ? row.strengths
          .map((entry) => sanitizeAiText(String(entry ?? "").trim()))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    const risks = Array.isArray(row.risks)
      ? row.risks
          .map((entry) => sanitizeAiText(String(entry ?? "").trim()))
          .filter(Boolean)
          .slice(0, 3)
      : [];

    rows.push({
      index,
      score: clampPercent(row.score, 0),
      openLikelihood: clampPercent(row.openLikelihood, 0),
      replyLikelihood: clampPercent(row.replyLikelihood, 0),
      positiveReplyLikelihood: clampPercent(row.positiveReplyLikelihood, 0),
      negativeRisk: clampPercent(row.negativeRisk, 100),
      clarity: clampPercent(row.clarity, 0),
      decision,
      summary: sanitizeAiText(String(row.summary ?? "").trim()),
      strengths,
      risks,
    });
  }

  return rows;
}

function roleplayRank(evaluation: CandidateEvaluation) {
  const decisionBoost = evaluation.decision === "promote" ? 10 : evaluation.decision === "revise" ? 2 : -15;
  return (
    evaluation.score +
    evaluation.openLikelihood * 0.15 +
    evaluation.replyLikelihood * 0.5 +
    evaluation.positiveReplyLikelihood * 0.45 +
    evaluation.clarity * 0.25 -
    evaluation.negativeRisk * 0.75 +
    decisionBoost
  );
}

function passesGate(evaluation: CandidateEvaluation) {
  if (evaluation.decision === "reject") return false;
  if (evaluation.score < 72) return false;
  if (evaluation.replyLikelihood < 18) return false;
  if (evaluation.positiveReplyLikelihood < 10) return false;
  if (evaluation.clarity < 70) return false;
  if (evaluation.negativeRisk > 25) return false;
  return true;
}

async function generateCandidateGraphs(input: { context: GenerationContext; candidateCount: number }) {
  const prompt = [
    "You write high-performing B2B outbound email conversation maps.",
    `Generate ${input.candidateCount} distinct candidate maps for the same experiment.`,
    "Each candidate must use a different opening angle and framing while staying true to the exact offer and CTA.",
    "",
    "Hard requirements:",
    "- Plain, concrete language. No buzzwords, no generic hype.",
    "- Subject lines <= 7 words. Message bodies <= 90 words.",
    "- Every non-terminal message includes exactly one clear CTA.",
    "- Use only these variables when needed: {{firstName}}, {{company}}, {{brandName}}, {{campaignGoal}}, {{shortAnswer}}.",
    "- Every non-terminal message MUST directly reflect experiment offer + CTA context.",
    "- No provider/tool implementation terms.",
    "",
    "Return JSON only:",
    '{ "candidates": [{ "index": number, "rationale": string, "graph": { "version": 1, "maxDepth": number, "startNodeId": string, "nodes": [{ "id": string, "kind": "message"|"terminal", "title": string, "copyMode": "prompt_v1", "promptTemplate": string, "promptVersion": 1, "promptPolicy": { "subjectMaxWords": number, "bodyMaxWords": number, "exactlyOneCta": boolean }, "subject": string, "body": string, "autoSend": boolean, "delayMinutes": number, "x": number, "y": number }], "edges": [{ "id": string, "fromNodeId": string, "toNodeId": string, "trigger": "intent"|"timer"|"fallback", "intent": "question"|"interest"|"objection"|"unsubscribe"|"other"|\"\", "waitMinutes": number, "confidenceThreshold": number, "priority": number }] } }] }',
    `Context: ${JSON.stringify(input.context)}`,
  ].join("\n");

  const parsed = await openAiJsonCall({
    prompt,
    maxOutputTokens: 7000,
    task: "conversation_flow_generation",
  });
  const candidates = normalizeCandidateGraphs(parsed.candidates);
  if (candidates.length < 3) {
    throw new ConversationFlowGenerationError("Model returned too few valid conversation-map candidates.", {
      status: 502,
      details: `validCandidates=${candidates.length}`,
    });
  }
  return candidates;
}

async function roleplayEvaluateCandidates(input: {
  context: GenerationContext;
  candidates: CandidateGraph[];
}) {
  const candidatesWithSamples = await Promise.all(
    input.candidates.map(async (candidate) => ({
      candidate,
      renderedSamples: await renderCandidateSamples({
        context: input.context,
        candidate,
      }),
    }))
  );

  const prompt = [
    "You are a strict recipient-behavior analysis panel for B2B cold outreach email flows.",
    "Evaluate each candidate as real recipients: busy, skeptical, annoyed, cautious, curious.",
    "Assume inbox pressure and limited attention.",
    "Prioritize the rendered sample emails when scoring; use graph structure as secondary context.",
    "",
    "Per candidate, run hidden roleplay checks and score:",
    "- openLikelihood",
    "- replyLikelihood",
    "- positiveReplyLikelihood",
    "- negativeRisk (spam/annoyance/unsubscribe risk)",
    "- clarity",
    "",
    "Return JSON only:",
    '{ "evaluations": [{ "index": number, "score": number, "openLikelihood": number, "replyLikelihood": number, "positiveReplyLikelihood": number, "negativeRisk": number, "clarity": number, "decision": "promote"|"revise"|"reject", "summary": string, "strengths": string[], "risks": string[] }] }',
    "",
    "Rules:",
    "- 0-100 integer scores.",
    "- decision=reject for generic, vague, or risky copy.",
    "- Penalize obvious AI-style fluff, long procedural lists, or weak/noisy CTA.",
    "- strengths/risks max 3 each, concrete and short.",
    `Context: ${JSON.stringify(input.context)}`,
    `Candidates: ${JSON.stringify(
      candidatesWithSamples.map((row) => ({
        index: row.candidate.index,
        rationale: row.candidate.rationale,
        renderedSamples: row.renderedSamples,
        graph: row.candidate.graph,
      }))
    )}`,
  ].join("\n");

  const parsed = await openAiJsonCall({
    prompt,
    maxOutputTokens: 2600,
    task: "conversation_flow_roleplay",
  });
  const evaluations = normalizeEvaluations(
    parsed.evaluations,
    new Set(input.candidates.map((candidate) => candidate.index))
  );

  if (evaluations.length !== input.candidates.length) {
    throw new ConversationFlowGenerationError("Roleplay evaluation count mismatch.", {
      status: 502,
      details: `expected=${input.candidates.length}, actual=${evaluations.length}`,
    });
  }
  return evaluations;
}

export async function generateScreenedConversationFlowGraph(input: { context: GenerationContext }) {
  const candidates = await generateCandidateGraphs({
    context: input.context,
    candidateCount: 6,
  });
  const evaluations = await roleplayEvaluateCandidates({
    context: input.context,
    candidates,
  });
  const evaluationByIndex = new Map(evaluations.map((row) => [row.index, row]));

  const ranked = candidates
    .map((candidate) => ({ candidate, evaluation: evaluationByIndex.get(candidate.index) ?? null }))
    .filter((row): row is { candidate: CandidateGraph; evaluation: CandidateEvaluation } => Boolean(row.evaluation))
    .sort((a, b) => roleplayRank(b.evaluation) - roleplayRank(a.evaluation));

  const selected = ranked.find((row) => passesGate(row.evaluation));
  if (!selected) {
    const top = ranked.slice(0, 3).map((row) => ({
      index: row.candidate.index,
      score: row.evaluation.score,
      decision: row.evaluation.decision,
      replyLikelihood: row.evaluation.replyLikelihood,
      positiveReplyLikelihood: row.evaluation.positiveReplyLikelihood,
      negativeRisk: row.evaluation.negativeRisk,
      clarity: row.evaluation.clarity,
      summary: row.evaluation.summary,
    }));
    throw new ConversationFlowGenerationError("No conversation-flow candidate passed roleplay quality gate.", {
      status: 422,
      details: JSON.stringify({ top }),
    });
  }

  return {
    graph: selected.candidate.graph,
    mode: "openai_roleplay_screened" as const,
    selectedIndex: selected.candidate.index,
    score: selected.evaluation.score,
    summary: selected.evaluation.summary,
  };
}
