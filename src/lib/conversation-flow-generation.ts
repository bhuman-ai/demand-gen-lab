import { sanitizeAiText } from "@/lib/ai-sanitize";
import { normalizeConversationGraph } from "@/lib/conversation-flow-data";
import type { ConversationFlowGraph } from "@/lib/factory-types";

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

async function openAiJsonCall(input: { prompt: string; maxOutputTokens: number }): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ConversationFlowGenerationError("OPENAI_API_KEY is missing.", { status: 503 });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.2",
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

  const parsed = await openAiJsonCall({ prompt, maxOutputTokens: 7000 });
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
  const prompt = [
    "You are a strict recipient-simulation panel for B2B cold outreach email flows.",
    "Evaluate each candidate as real recipients: busy, skeptical, annoyed, cautious, curious.",
    "Assume inbox pressure and limited attention.",
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
    "- strengths/risks max 3 each, concrete and short.",
    `Context: ${JSON.stringify(input.context)}`,
    `Candidates: ${JSON.stringify(
      input.candidates.map((candidate) => ({
        index: candidate.index,
        rationale: candidate.rationale,
        graph: candidate.graph,
      }))
    )}`,
  ].join("\n");

  const parsed = await openAiJsonCall({ prompt, maxOutputTokens: 2600 });
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
