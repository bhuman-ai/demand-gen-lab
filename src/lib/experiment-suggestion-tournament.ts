import { sanitizeAiText } from "@/lib/ai-sanitize";
import { getBrandById } from "@/lib/factory-data";
import type {
  ExperimentSuggestionBrainstormTurn,
  ExperimentSuggestionDraftIdea,
  ExperimentSuggestionGenerationResult,
  ExperimentSuggestionReviewCandidate,
  ExperimentSuggestionStreamEvent,
} from "@/lib/factory-types";
import { validateConcreteSuggestion } from "@/lib/experiment-suggestion-quality";
import { resolveLlmModel } from "@/lib/llm-router";
import {
  createExperimentSuggestions,
  listExperimentSuggestions,
  updateExperimentSuggestion,
} from "@/lib/experiment-suggestion-data";
import type { LlmTask } from "@/lib/llm-router";

const MIN_READY_SUGGESTIONS = 3;
const MAX_READY_SUGGESTIONS = 6;
const IDEAS_PER_AGENT = 2;
const IDEAS_REQUESTED_PER_AGENT = 3;
const NOVELTY_THRESHOLD = 0.58;
const MIN_TURNS_BEFORE_EARLY_STOP = 4;
const PROMPT_LEDGER_LIMIT = 12;
const TERRITORY_LIMIT = 12;
const MAX_AGENT_ERRORS = 6;
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "their",
  "your",
  "into",
  "over",
  "across",
  "about",
  "after",
  "before",
  "under",
  "without",
  "through",
  "team",
  "teams",
  "company",
  "companies",
  "more",
  "less",
  "very",
  "just",
  "only",
  "they",
  "them",
  "than",
  "have",
  "has",
  "will",
  "would",
  "could",
  "should",
  "while",
  "where",
  "when",
  "what",
  "which",
  "because",
]);

type StructuredSuggestion = ExperimentSuggestionDraftIdea;

type RoleplayEvaluation = {
  index: number;
  score: number;
  openLikelihood: number;
  replyLikelihood: number;
  positiveReplyLikelihood: number;
  unsubscribeRisk: number;
  decision: "promote" | "revise" | "reject";
  summary: string;
  strengths: string[];
  risks: string[];
};

type ReviewCandidateInternal = ExperimentSuggestionReviewCandidate & {
  turn: number;
  agentId: string;
  agentName: string;
  agentStyle: string;
};

type BrainstormAgent = {
  id: string;
  name: string;
  style: string;
  brief: string;
};

type BrandContext = {
  name: string;
  website: string;
  tone: string;
  product: string;
  notes: string;
  markets: string[];
  icps: string[];
  features: string[];
  benefits: string[];
};

type CandidateSummary = {
  turn: number;
  agentName: string;
  name: string;
  audience: string;
  trigger: string;
  offer: string;
  accepted: boolean;
  decision: ReviewCandidateInternal["decision"];
  score: number;
  reason: string;
};

type TournamentOutput = {
  turns: ExperimentSuggestionBrainstormTurn[];
  allCandidates: ReviewCandidateInternal[];
  screenedCount: number;
};

type OpenAiJsonResult = {
  record: Record<string, unknown>;
  outputText: string;
};

type SuggestionGenerationErrorInput = {
  message: string;
  status: number;
  hint?: string;
  debug?: Record<string, unknown>;
};

export class SuggestionGenerationError extends Error {
  status: number;
  hint?: string;
  debug?: Record<string, unknown>;

  constructor(input: SuggestionGenerationErrorInput) {
    super(input.message);
    this.name = "SuggestionGenerationError";
    this.status = input.status;
    this.hint = input.hint;
    this.debug = input.debug;
  }
}

const BRAINSTORM_AGENTS: BrainstormAgent[] = [
  {
    id: "pain-sniper",
    name: "Agent 1 · Pain Sniper",
    style: "pain-led",
    brief: "Hunt one painful operational bottleneck that already costs the prospect time or revenue.",
  },
  {
    id: "trigger-hunter",
    name: "Agent 2 · Trigger Hunter",
    style: "timing-led",
    brief: "Look for a live trigger, deadline, or market event that makes the outreach feel urgent right now.",
  },
  {
    id: "proof-builder",
    name: "Agent 3 · Proof Builder",
    style: "proof-led",
    brief: "Lead with evidence, benchmarks, or a concrete before-versus-after outcome instead of a generic promise.",
  },
  {
    id: "teardown-critic",
    name: "Agent 4 · Teardown Critic",
    style: "teardown-led",
    brief: "Point at a broken workflow or missed opportunity the prospect would recognize immediately.",
  },
  {
    id: "workflow-surgeon",
    name: "Agent 5 · Workflow Surgeon",
    style: "workflow-led",
    brief: "Isolate a specific handoff, approval, or ops step and make the offer about fixing that exact jam.",
  },
  {
    id: "economic-buyer",
    name: "Agent 6 · Economic Buyer",
    style: "economic-led",
    brief: "Tie the offer to budget, efficiency, margin, or waste, but keep it concrete and non-finance-bro-y.",
  },
  {
    id: "contrarian",
    name: "Agent 7 · Contrarian",
    style: "contrarian",
    brief: "Challenge the usual cold email shape with a sharper or unexpected angle that still feels credible.",
  },
  {
    id: "narrow-icp",
    name: "Agent 8 · Narrow ICP",
    style: "specialist-led",
    brief: "Pick a tiny sub-segment that the earlier agents ignored and make the offer feel handcrafted for them.",
  },
  {
    id: "peer-pressure",
    name: "Agent 9 · Peer Pressure",
    style: "social-proof-led",
    brief: "Use peer behavior, competitive pressure, or a pattern in the market without sounding like fake social proof.",
  },
  {
    id: "wildcard",
    name: "Agent 10 · Wildcard",
    style: "wildcard",
    brief: "Bring the weird but defensible angle that the safer agents would never try.",
  },
];

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

function buildIdeaKey(input: Pick<StructuredSuggestion, "name" | "audience" | "offer">) {
  return `${input.name.toLowerCase()}::${input.audience.toLowerCase()}::${input.offer.toLowerCase()}`;
}

function buildTerritoryLabel(input: Pick<StructuredSuggestion, "audience" | "trigger" | "offer">) {
  return sanitizeAiText([input.audience, input.trigger, input.offer].filter(Boolean).join(" | "));
}

function normalizeSuggestions(value: unknown, limit = 8): StructuredSuggestion[] {
  if (!Array.isArray(value)) return [];
  const rows: StructuredSuggestion[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const row = asRecord(entry);
    const name = sanitizeAiText(String(row.name ?? row.campaignIdea ?? row.title ?? "").trim());
    const audience = sanitizeAiText(String(row.audience ?? row.who ?? row.icp ?? "").trim());
    const trigger = sanitizeAiText(String(row.trigger ?? "").trim());
    const offer = sanitizeAiText(String(row.offer ?? "").trim());
    const cta = sanitizeAiText(String(row.cta ?? row.ask ?? "").trim());
    const emailPreview = sanitizeAiText(String(row.emailPreview ?? row.preview ?? "").trim());
    const successTarget = sanitizeAiText(String(row.successTarget ?? row.metric ?? "").trim());
    const rationale = sanitizeAiText(String(row.rationale ?? row.why ?? "").trim());
    const qualityErrors = validateConcreteSuggestion({
      name,
      audience,
      offer,
      cta,
      emailPreview,
      successTarget,
      rationale,
    });
    if (qualityErrors.length) continue;
    const key = buildIdeaKey({ name, audience, offer });
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      name,
      audience,
      trigger,
      offer,
      cta,
      emailPreview,
      successTarget,
      rationale,
    });
  }
  return rows.slice(0, limit);
}

function parseLooseJsonObject(value: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return {};

  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)```/i)?.[1]?.trim();
  if (fenced) candidates.push(fenced);

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return asRecord(JSON.parse(candidate));
    } catch {
      continue;
    }
  }

  return {};
}

function hasSparseBrandContext(brand: BrandContext) {
  const scalarSignals = [brand.name, brand.website, brand.tone, brand.product, brand.notes].filter((value) =>
    String(value ?? "").trim()
  ).length;
  const listSignals =
    brand.markets.filter(Boolean).length +
    brand.icps.filter(Boolean).length +
    brand.features.filter(Boolean).length +
    brand.benefits.filter(Boolean).length;
  return scalarSignals <= 3 && listSignals < 3;
}

function concreteSuggestionExample() {
  return JSON.stringify(
    {
      suggestions: [
        {
          name: "Renewal Rescue Scorecard for PLG SaaS Teams",
          audience:
            "Head of RevOps at a 25-200 employee product-led SaaS company managing multiple annual software renewals",
          trigger:
            "Their team is entering renewal season and finance is asking for tighter justification before approving another year of tool spend.",
          offer:
            "A one-page renewal scorecard that highlights overlap, usage gaps, and the 3 renewals most likely to be renegotiated this quarter.",
          cta: "Want me to send the one-page scorecard template?",
          emailPreview:
            "If renewal approvals are getting tighter, I can send the 1-page scorecard we use to spot overlap fast.",
          successTarget: "18% reply rate and 6 scorecard requests per 100 targeted sends",
          rationale:
            "The timing is specific, the deliverable is tangible, and the ask is low-friction enough for a cold outbound first touch.",
        },
      ],
    },
    null,
    2
  );
}

function normalizeRoleplayEvaluations(
  value: unknown,
  suggestionCount: number
): RoleplayEvaluation[] {
  if (!Array.isArray(value)) return [];
  const rows: RoleplayEvaluation[] = [];
  const seen = new Set<number>();

  for (const entry of value) {
    const row = asRecord(entry);
    const index = Number(row.index);
    if (!Number.isInteger(index) || index < 0 || index >= suggestionCount || seen.has(index)) {
      continue;
    }
    seen.add(index);

    const decisionRaw = String(row.decision ?? "").trim().toLowerCase();
    const decision: RoleplayEvaluation["decision"] =
      decisionRaw === "promote" || decisionRaw === "reject" ? decisionRaw : "revise";

    const strengths = Array.isArray(row.strengths)
      ? row.strengths
          .map((item) => sanitizeAiText(String(item ?? "").trim()))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    const risks = Array.isArray(row.risks)
      ? row.risks
          .map((item) => sanitizeAiText(String(item ?? "").trim()))
          .filter(Boolean)
          .slice(0, 3)
      : [];

    rows.push({
      index,
      score: clampPercent(row.score, 0),
      openLikelihood: clampPercent(row.openLikelihood, 0),
      replyLikelihood: clampPercent(row.replyLikelihood, 0),
      positiveReplyLikelihood: clampPercent(row.positiveReplyLikelihood, 0),
      unsubscribeRisk: clampPercent(row.unsubscribeRisk, 100),
      decision,
      summary: sanitizeAiText(String(row.summary ?? "").trim()),
      strengths,
      risks,
    });
  }

  return rows;
}

function tokenizeNovelty(value: string) {
  return Array.from(
    new Set(
      sanitizeAiText(value)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    )
  );
}

function noveltyFingerprint(input: Pick<StructuredSuggestion, "name" | "audience" | "trigger" | "offer">) {
  return tokenizeNovelty([input.name, input.audience, input.trigger, input.offer].join(" "));
}

function jaccardSimilarity(left: string[], right: string[]) {
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  return union ? intersection / union : 0;
}

function isNovelSuggestion(suggestion: StructuredSuggestion, prior: StructuredSuggestion[]) {
  const key = buildIdeaKey(suggestion);
  const fingerprint = noveltyFingerprint(suggestion);

  return !prior.some((existing) => {
    if (buildIdeaKey(existing) === key) return true;
    const exactTerritory = buildTerritoryLabel(existing) === buildTerritoryLabel(suggestion);
    if (exactTerritory) return true;
    return jaccardSimilarity(fingerprint, noveltyFingerprint(existing)) >= NOVELTY_THRESHOLD;
  });
}

function summarizePromptLedger(candidates: ReviewCandidateInternal[]): CandidateSummary[] {
  return candidates.slice(-PROMPT_LEDGER_LIMIT).map((candidate) => ({
    turn: candidate.turn,
    agentName: candidate.agentName,
    name: candidate.name,
    audience: candidate.audience,
    trigger: candidate.trigger,
    offer: candidate.offer,
    accepted: candidate.accepted,
    decision: candidate.decision,
    score: candidate.score,
    reason:
      candidate.risks[0] ||
      candidate.summary ||
      candidate.strengths[0] ||
      "No review note captured.",
  }));
}

function summarizeOccupiedTerritories(candidates: ReviewCandidateInternal[]) {
  return Array.from(
    new Set(candidates.map((candidate) => buildTerritoryLabel(candidate)).filter(Boolean))
  ).slice(0, TERRITORY_LIMIT);
}

function rankRoleplayEvaluation(
  evaluation: Pick<
    ExperimentSuggestionReviewCandidate,
    | "decision"
    | "score"
    | "openLikelihood"
    | "replyLikelihood"
    | "positiveReplyLikelihood"
    | "unsubscribeRisk"
  >
) {
  const decisionBoost = evaluation.decision === "promote" ? 8 : evaluation.decision === "revise" ? 2 : -12;
  return (
    evaluation.score +
    evaluation.openLikelihood * 0.15 +
    evaluation.replyLikelihood * 0.45 +
    evaluation.positiveReplyLikelihood * 0.35 -
    evaluation.unsubscribeRisk * 0.5 +
    decisionBoost
  );
}

function passesRoleplayGate(evaluation: RoleplayEvaluation) {
  if (evaluation.decision === "reject") return false;
  if (evaluation.score < 62) return false;
  if (evaluation.replyLikelihood < 12) return false;
  if (evaluation.positiveReplyLikelihood < 6) return false;
  if (evaluation.unsubscribeRisk > 35) return false;
  return true;
}

function scoreTurn(ideas: ExperimentSuggestionReviewCandidate[]) {
  const acceptedCount = ideas.filter((idea) => idea.accepted).length;
  const averageRank =
    ideas.reduce((total, idea) => total + rankRoleplayEvaluation(idea), 0) / Math.max(ideas.length, 1);
  return Math.round(acceptedCount * 160 + averageRank);
}

function formatTurnError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return sanitizeAiText(message).slice(0, 180) || "Unknown error";
}

function toReviewCandidate(input: ReviewCandidateInternal): ExperimentSuggestionReviewCandidate {
  return {
    index: input.index,
    name: input.name,
    audience: input.audience,
    trigger: input.trigger,
    offer: input.offer,
    cta: input.cta,
    emailPreview: input.emailPreview,
    successTarget: input.successTarget,
    rationale: input.rationale,
    decision: input.decision,
    summary: input.summary,
    strengths: input.strengths,
    risks: input.risks,
    score: input.score,
    openLikelihood: input.openLikelihood,
    replyLikelihood: input.replyLikelihood,
    positiveReplyLikelihood: input.positiveReplyLikelihood,
    unsubscribeRisk: input.unsubscribeRisk,
    accepted: input.accepted,
  };
}

function toDraftIdeas(ideas: StructuredSuggestion[]) {
  return ideas.map((idea) => ({
    name: idea.name,
    audience: idea.audience,
    trigger: idea.trigger,
    offer: idea.offer,
    cta: idea.cta,
    emailPreview: idea.emailPreview,
    successTarget: idea.successTarget,
    rationale: idea.rationale,
  }));
}

function baseTurn(input: {
  turn: number;
  agent: BrainstormAgent;
  status: ExperimentSuggestionBrainstormTurn["status"];
  score?: number;
  acceptedCount?: number;
  draftIdeas?: ExperimentSuggestionDraftIdea[];
  ideas?: ExperimentSuggestionReviewCandidate[];
  failed?: boolean;
  error?: string;
}): ExperimentSuggestionBrainstormTurn {
  return {
    turn: input.turn,
    agentId: input.agent.id,
    agentName: input.agent.name,
    agentStyle: input.agent.style,
    brief: input.agent.brief,
    status: input.status,
    score: input.score ?? 0,
    acceptedCount: input.acceptedCount ?? 0,
    draftIdeas: input.draftIdeas ?? [],
    ideas: input.ideas ?? [],
    failed: input.failed,
    error: input.error,
  };
}

async function requestOpenAiJson(input: {
  modelKey: LlmTask;
  prompt: string;
  maxOutputTokens: number;
  label: string;
  signal?: AbortSignal;
}): Promise<OpenAiJsonResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const model = resolveLlmModel(input.modelKey, { prompt: input.prompt });
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
    signal: input.signal,
  });

  if (!response.ok) {
    const reason = await response.text().catch(() => "");
    throw new Error(
      `${input.label} (${response.status}): ${reason.slice(0, 600) || "unknown error"}`
    );
  }

  const raw = await response.text();
  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }

  const payloadRecord = asRecord(payload);
  const output = Array.isArray(payloadRecord.output) ? payloadRecord.output : [];
  const firstOutput = asRecord(output[0]);
  const content = Array.isArray(firstOutput.content) ? firstOutput.content : [];
  const outputText =
    String(payloadRecord.output_text ?? "") ||
    String(content.map((item) => asRecord(item)).find((item) => typeof item.text === "string")?.text ?? "") ||
    "{}";

  return {
    record: parseLooseJsonObject(outputText),
    outputText,
  };
}

async function openAiRoleplayEvaluate(input: {
  brandName: string;
  website: string;
  product: string;
  tone: string;
  markets: string[];
  icps: string[];
  suggestions: StructuredSuggestion[];
  signal?: AbortSignal;
}): Promise<RoleplayEvaluation[]> {
  const prompt = [
    "You are a realistic buyer-behavior analysis panel for B2B cold outreach.",
    "Evaluate each suggestion as if real recipients are busy, skeptical, annoyed, cautious, and curious.",
    "Each evaluation must reflect likely inbox behavior, not idealized behavior.",
    "",
    "Evaluation setup per suggestion:",
    "- Run 12 micro roleplays across personas: busy operator, annoyed exec, skeptical manager, curious evaluator, price-sensitive buyer, delegated inbox gatekeeper.",
    "- Judge outcomes: open likelihood, reply likelihood, positive reply likelihood, unsubscribe risk.",
    "- Be strict on generic, hypey, vague, or spammy language.",
    "",
    "Return strict JSON only:",
    '{ "evaluations": [{ "index": number, "score": number, "openLikelihood": number, "replyLikelihood": number, "positiveReplyLikelihood": number, "unsubscribeRisk": number, "decision": "promote"|"revise"|"reject", "summary": string, "strengths": string[], "risks": string[] }] }',
    "",
    "Rules:",
    "- index must match the input suggestion index.",
    "- 0-100 integers for score/openLikelihood/replyLikelihood/positiveReplyLikelihood/unsubscribeRisk.",
    "- strengths and risks each max 3 bullets, concrete and short.",
    "- Do not use provider/tool implementation terms.",
    "",
    `BrandContext: ${JSON.stringify({
      brandName: input.brandName,
      website: input.website,
      product: input.product,
      tone: input.tone,
      markets: input.markets,
      icps: input.icps,
    })}`,
    `Suggestions: ${JSON.stringify(input.suggestions.map((suggestion, index) => ({ index, ...suggestion })))}`,
  ].join("\n");

  const { record: parsedRecord } = await requestOpenAiJson({
    modelKey: "experiment_suggestions_roleplay",
    prompt,
    maxOutputTokens: 2200,
    label: "OpenAI roleplay API error",
    signal: input.signal,
  });

  const evaluations = normalizeRoleplayEvaluations(parsedRecord.evaluations, input.suggestions.length);
  if (evaluations.length !== input.suggestions.length) {
    throw new Error(
      `Roleplay evaluation mismatch: expected ${input.suggestions.length}, got ${evaluations.length}`
    );
  }
  return evaluations;
}

async function openAiSuggestionsForAgent(input: {
  brand: BrandContext;
  agent: BrainstormAgent;
  priorCandidates: ReviewCandidateInternal[];
  signal?: AbortSignal;
}): Promise<StructuredSuggestion[]> {
  const sparseBrandContext = hasSparseBrandContext(input.brand);
  const prompt = [
    "You are one agent inside an adversarial brainstorming tournament for B2B outbound experiments.",
    "You only score points when the downstream roleplay filter accepts your ideas.",
    "Earlier agents have already claimed territory. You must not repeat, paraphrase, or lightly remix any prior audience/trigger/offer lane.",
    "",
    `AgentName: ${input.agent.name}`,
    `AgentStyle: ${input.agent.style}`,
    `AgentBrief: ${input.agent.brief}`,
    "",
    "Return strict JSON in this shape:",
    '{ "suggestions": [{ "name": string, "audience": string, "trigger": string, "offer": string, "cta": string, "emailPreview": string, "successTarget": string, "rationale": string }] }',
    "",
    "Rules:",
    `- Generate ${IDEAS_REQUESTED_PER_AGENT} suggestions.`,
    "- name must read like a concrete campaign idea, not a generic angle label.",
    "- audience must include role plus company type or size.",
    "- trigger must explain why this outreach feels timely or specific.",
    "- offer must be tangible and credibly low-friction.",
    "- cta must be one single ask.",
    "- emailPreview must be a short first-line preview under about 25 words.",
    "- successTarget must be measurable.",
    "- Avoid vague claims, buzzwords, and generic personalization.",
    "- The ideas must be materially different from each other.",
    "- The ideas must be materially different from all occupied territory below.",
    sparseBrandContext
      ? "- Brand context is sparse. Do not refuse, ask for more info, or stay generic. Infer the most plausible concrete outbound angle from the brand name, website, notes, and whatever context exists."
      : "",
    "",
    `ExampleOutput: ${concreteSuggestionExample()}`,
    "",
    `OccupiedTerritory: ${JSON.stringify(summarizeOccupiedTerritories(input.priorCandidates))}`,
    `PriorIdeas: ${JSON.stringify(summarizePromptLedger(input.priorCandidates))}`,
    `BrandContext: ${JSON.stringify(input.brand)}`,
  ].join("\n");

  const { record: parsedRecord, outputText } = await requestOpenAiJson({
    modelKey: "experiment_suggestions_generate",
    prompt,
    maxOutputTokens: 1800,
    label: "OpenAI brainstorm API error",
    signal: input.signal,
  });

  const suggestions = normalizeSuggestions(parsedRecord.suggestions, IDEAS_REQUESTED_PER_AGENT);
  if (suggestions.length >= IDEAS_REQUESTED_PER_AGENT) {
    return suggestions;
  }

  const repairedSuggestions = await repairOpenAiSuggestionsForAgent({
    brand: input.brand,
    agent: input.agent,
    priorCandidates: input.priorCandidates,
    failedOutput: outputText,
    signal: input.signal,
  });

  const merged = [...suggestions];
  for (const suggestion of repairedSuggestions) {
    if (merged.length >= IDEAS_REQUESTED_PER_AGENT) break;
    if (!isNovelSuggestion(suggestion, merged)) continue;
    merged.push(suggestion);
  }

  if (!merged.length) {
    throw new Error("OpenAI returned no concrete suggestions");
  }
  return merged.slice(0, IDEAS_REQUESTED_PER_AGENT);
}

async function repairOpenAiSuggestionsForAgent(input: {
  brand: BrandContext;
  agent: BrainstormAgent;
  priorCandidates: ReviewCandidateInternal[];
  failedOutput: string;
  signal?: AbortSignal;
}): Promise<StructuredSuggestion[]> {
  const sparseBrandContext = hasSparseBrandContext(input.brand);
  const prompt = [
    "You are repairing a failed brainstorm response for a B2B outbound experiment tournament.",
    "The first output either broke JSON, missed required fields, or stayed too generic to pass validation.",
    "Repair it into strict JSON. If the failed draft is unusable, generate fresh suggestions from scratch.",
    "",
    `AgentName: ${input.agent.name}`,
    `AgentStyle: ${input.agent.style}`,
    `AgentBrief: ${input.agent.brief}`,
    "",
    "Return strict JSON in this shape:",
    '{ "suggestions": [{ "name": string, "audience": string, "trigger": string, "offer": string, "cta": string, "emailPreview": string, "successTarget": string, "rationale": string }] }',
    "",
    "Validation reminders:",
    `- Return exactly ${IDEAS_REQUESTED_PER_AGENT} concrete suggestions.`,
    "- audience must include role plus company type or size.",
    "- offer must describe a tangible artifact, diagnostic, teardown, audit, checklist, scorecard, plan, review, benchmark, or blueprint.",
    "- cta must contain one clear action.",
    "- emailPreview must stay between 8 and 30 words.",
    "- successTarget must include a number and a measurable metric such as reply rate, meetings, or conversions.",
    "- No vague placeholders. No angle labels. No generic 'optimize growth' language.",
    "- Do not repeat or paraphrase occupied territory.",
    sparseBrandContext
      ? "- Brand context is sparse. Infer the most plausible concrete angle from the brand name, website, notes, and whatever context exists. Do not ask for more info."
      : "",
    "",
    `ExampleOutput: ${concreteSuggestionExample()}`,
    "",
    `OccupiedTerritory: ${JSON.stringify(summarizeOccupiedTerritories(input.priorCandidates))}`,
    `PriorIdeas: ${JSON.stringify(summarizePromptLedger(input.priorCandidates))}`,
    `BrandContext: ${JSON.stringify(input.brand)}`,
    `FailedDraft: ${sanitizeAiText(input.failedOutput || "").slice(0, 4000) || "[empty]"}`,
  ].join("\n");

  const { record, outputText } = await requestOpenAiJson({
    modelKey: "experiment_suggestions_generate",
    prompt,
    maxOutputTokens: 2000,
    label: "OpenAI brainstorm repair API error",
    signal: input.signal,
  });

  const repairedRecord = Object.keys(record).length ? record : parseLooseJsonObject(outputText);
  return normalizeSuggestions(repairedRecord.suggestions, IDEAS_REQUESTED_PER_AGENT);
}

async function emitEvent(
  handler: ((event: ExperimentSuggestionStreamEvent) => Promise<void> | void) | undefined,
  event: ExperimentSuggestionStreamEvent,
  signal?: AbortSignal
) {
  if (signal?.aborted) return;
  await handler?.(event);
}

async function runBrainstormTournament(
  brand: BrandContext,
  options: {
    signal?: AbortSignal;
    onEvent?: (event: ExperimentSuggestionStreamEvent) => Promise<void> | void;
  }
): Promise<TournamentOutput> {
  const turns: ExperimentSuggestionBrainstormTurn[] = [];
  const allCandidates: ReviewCandidateInternal[] = [];
  const allGeneratedSuggestions: StructuredSuggestion[] = [];
  let screenedCount = 0;
  let errorCount = 0;

  for (const [index, agent] of BRAINSTORM_AGENTS.entries()) {
    if (options.signal?.aborted) {
      throw new Error("Suggestion stream aborted");
    }

    const turnNumber = index + 1;
    const draftingTurn = baseTurn({
      turn: turnNumber,
      agent,
      status: "drafting",
    });
    turns.push(draftingTurn);
    await emitEvent(options.onEvent, { type: "turn_started", turn: draftingTurn }, options.signal);

    let rawSuggestions: StructuredSuggestion[] = [];
    try {
      rawSuggestions = await openAiSuggestionsForAgent({
        brand,
        agent,
        priorCandidates: allCandidates,
        signal: options.signal,
      });
    } catch (error) {
      errorCount += 1;
      const failedTurn = baseTurn({
        turn: turnNumber,
        agent,
        status: "failed",
        failed: true,
        error: formatTurnError(error),
      });
      turns[turns.length - 1] = failedTurn;
      await emitEvent(options.onEvent, { type: "turn_failed", turn: failedTurn }, options.signal);
      if (errorCount >= MAX_AGENT_ERRORS) break;
      continue;
    }

    const novelSuggestions = rawSuggestions
      .filter((suggestion) => isNovelSuggestion(suggestion, allGeneratedSuggestions))
      .slice(0, IDEAS_PER_AGENT);

    if (!novelSuggestions.length) {
      const failedTurn = baseTurn({
        turn: turnNumber,
        agent,
        status: "failed",
        failed: true,
        error: "All ideas overlapped earlier territory and were disqualified.",
      });
      turns[turns.length - 1] = failedTurn;
      await emitEvent(options.onEvent, { type: "turn_failed", turn: failedTurn }, options.signal);
      continue;
    }

    const reviewingTurn = baseTurn({
      turn: turnNumber,
      agent,
      status: "reviewing",
      draftIdeas: toDraftIdeas(novelSuggestions),
    });
    turns[turns.length - 1] = reviewingTurn;
    await emitEvent(options.onEvent, { type: "turn_drafted", turn: reviewingTurn }, options.signal);

    screenedCount += novelSuggestions.length;
    allGeneratedSuggestions.push(...novelSuggestions);

    let evaluations: RoleplayEvaluation[] = [];
    try {
      evaluations = await openAiRoleplayEvaluate({
        brandName: brand.name,
        website: brand.website,
        product: brand.product,
        tone: brand.tone,
        markets: brand.markets,
        icps: brand.icps,
        suggestions: novelSuggestions,
        signal: options.signal,
      });
    } catch (error) {
      errorCount += 1;
      const failedTurn = baseTurn({
        turn: turnNumber,
        agent,
        status: "failed",
        failed: true,
        error: formatTurnError(error),
        draftIdeas: toDraftIdeas(novelSuggestions),
      });
      turns[turns.length - 1] = failedTurn;
      await emitEvent(options.onEvent, { type: "turn_failed", turn: failedTurn }, options.signal);
      if (errorCount >= MAX_AGENT_ERRORS) break;
      continue;
    }

    const evaluatedIdeas = novelSuggestions.map((suggestion, ideaIndex) => {
      const evaluation = evaluations.find((row) => row.index === ideaIndex);
      if (!evaluation) {
        throw new Error(`Missing evaluation for turn ${turnNumber} idea ${ideaIndex + 1}`);
      }
      return {
        index: allCandidates.length + ideaIndex,
        name: suggestion.name,
        audience: suggestion.audience,
        trigger: suggestion.trigger,
        offer: suggestion.offer,
        cta: suggestion.cta,
        emailPreview: suggestion.emailPreview,
        successTarget: suggestion.successTarget,
        rationale: suggestion.rationale,
        decision: evaluation.decision,
        summary: evaluation.summary,
        strengths: evaluation.strengths,
        risks: evaluation.risks,
        score: evaluation.score,
        openLikelihood: evaluation.openLikelihood,
        replyLikelihood: evaluation.replyLikelihood,
        positiveReplyLikelihood: evaluation.positiveReplyLikelihood,
        unsubscribeRisk: evaluation.unsubscribeRisk,
        accepted: passesRoleplayGate(evaluation),
        turn: turnNumber,
        agentId: agent.id,
        agentName: agent.name,
        agentStyle: agent.style,
      } satisfies ReviewCandidateInternal;
    });

    allCandidates.push(...evaluatedIdeas);
    const completedTurn = baseTurn({
      turn: turnNumber,
      agent,
      status: "completed",
      score: scoreTurn(evaluatedIdeas),
      acceptedCount: evaluatedIdeas.filter((idea) => idea.accepted).length,
      draftIdeas: toDraftIdeas(novelSuggestions),
      ideas: evaluatedIdeas.map(toReviewCandidate),
    });
    turns[turns.length - 1] = completedTurn;
    await emitEvent(options.onEvent, { type: "turn_completed", turn: completedTurn }, options.signal);

    if (
      turnNumber >= MIN_TURNS_BEFORE_EARLY_STOP &&
      allCandidates.filter((candidate) => candidate.accepted).length >= MIN_READY_SUGGESTIONS
    ) {
      break;
    }
  }

  return {
    turns,
    allCandidates,
    screenedCount,
  };
}

function serializeCandidateForScreening(candidate: ReviewCandidateInternal) {
  return {
    index: candidate.index,
    name: candidate.name,
    audience: candidate.audience,
    trigger: candidate.trigger,
    offer: candidate.offer,
    cta: candidate.cta,
    emailPreview: candidate.emailPreview,
    successTarget: candidate.successTarget,
    rationale: candidate.rationale,
    decision: candidate.decision,
    summary: candidate.summary,
    strengths: candidate.strengths,
    risks: candidate.risks,
    score: candidate.score,
    openLikelihood: candidate.openLikelihood,
    replyLikelihood: candidate.replyLikelihood,
    positiveReplyLikelihood: candidate.positiveReplyLikelihood,
    unsubscribeRisk: candidate.unsubscribeRisk,
    accepted: candidate.accepted,
  } satisfies ExperimentSuggestionReviewCandidate;
}

export function serializeSuggestionGenerationError(error: unknown) {
  if (error instanceof SuggestionGenerationError) {
    return {
      error: error.message,
      hint: error.hint,
      debug: error.debug,
      status: error.status,
    };
  }

  return {
    error: "Failed to process suggestion request",
    hint: "No fallback is enabled. Fix the underlying issue and retry.",
    debug: {
      reason: error instanceof Error ? error.message : "Unknown error",
    },
    status: 500,
  };
}

export async function generateExperimentSuggestionResult(input: {
  brandId: string;
  refresh?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: ExperimentSuggestionStreamEvent) => Promise<void> | void;
}): Promise<ExperimentSuggestionGenerationResult> {
  const brand = await getBrandById(input.brandId);
  if (!brand) {
    throw new SuggestionGenerationError({ message: "brand not found", status: 404 });
  }

  const existing = await listExperimentSuggestions(input.brandId, "suggested");
  if (!input.refresh && existing.length >= MIN_READY_SUGGESTIONS) {
    return { suggestions: existing, mode: "cached" };
  }

  if (input.refresh && existing.length) {
    await Promise.all(
      existing.map((row) =>
        updateExperimentSuggestion(input.brandId, row.id, { status: "dismissed" })
      )
    );
  }

  await emitEvent(
    input.onEvent,
    {
      type: "start",
      refresh: Boolean(input.refresh),
      requestedAgents: BRAINSTORM_AGENTS.length,
      minimumReady: MIN_READY_SUGGESTIONS,
    },
    input.signal
  );

  const brandContext: BrandContext = {
    name: brand.name,
    website: brand.website,
    tone: brand.tone,
    product: brand.product,
    notes: brand.notes,
    markets: brand.targetMarkets,
    icps: brand.idealCustomerProfiles,
    features: brand.keyFeatures,
    benefits: brand.keyBenefits,
  };

  const tournament = await runBrainstormTournament(brandContext, {
    signal: input.signal,
    onEvent: input.onEvent,
  });

  const rankedCandidates = [...tournament.allCandidates].sort(
    (left, right) => rankRoleplayEvaluation(right) - rankRoleplayEvaluation(left)
  );

  const preferred = rankedCandidates.filter((candidate) =>
    passesRoleplayGate({
      index: candidate.index,
      score: candidate.score,
      openLikelihood: candidate.openLikelihood,
      replyLikelihood: candidate.replyLikelihood,
      positiveReplyLikelihood: candidate.positiveReplyLikelihood,
      unsubscribeRisk: candidate.unsubscribeRisk,
      decision: candidate.decision,
      summary: candidate.summary,
      strengths: candidate.strengths,
      risks: candidate.risks,
    })
  );
  const selected = [...preferred];

  if (selected.length < MIN_READY_SUGGESTIONS) {
    for (const candidate of rankedCandidates) {
      if (selected.some((row) => row.index === candidate.index)) continue;
      selected.push(candidate);
      if (selected.length >= MIN_READY_SUGGESTIONS) break;
    }
  }

  const screened = selected.slice(0, MAX_READY_SUGGESTIONS).map((candidate) => ({
    ...candidate,
    rationale: sanitizeAiText([candidate.rationale, candidate.summary].filter(Boolean).join(" ")),
  }));

  if (!screened.length) {
    const topRejected = rankedCandidates.slice(0, 5).map((candidate) => ({
      turn: candidate.turn,
      agentName: candidate.agentName,
      name: candidate.name,
      decision: candidate.decision,
      score: candidate.score,
      replyLikelihood: candidate.replyLikelihood,
      unsubscribeRisk: candidate.unsubscribeRisk,
      summary: candidate.summary,
    }));

    throw new SuggestionGenerationError({
      message: "No suggestions survived the roleplay tournament",
      status: 422,
      hint: "Update brand context and retry generation.",
      debug: {
        screenedCount: tournament.screenedCount,
        turnsCompleted: tournament.turns.length,
        topRejected,
      },
    });
  }

  const created = await createExperimentSuggestions({
    brandId: input.brandId,
    source: "ai",
    suggestions: screened.map((row) => ({
      name: row.name,
      offer: row.offer,
      audience: row.audience,
      cta: row.cta,
      trigger: row.trigger,
      emailPreview: row.emailPreview,
      successTarget: row.successTarget,
      rationale: row.rationale,
    })),
  });

  if (!created.length) {
    throw new SuggestionGenerationError({
      message: "No concrete suggestions were saved",
      status: 422,
      hint: "No fallback is enabled. Regenerate with richer brand context.",
    });
  }

  const suggestions = await listExperimentSuggestions(input.brandId, "suggested");
  if (!suggestions.length) {
    throw new SuggestionGenerationError({
      message: "No concrete suggestions available",
      status: 422,
      hint: "No fallback is enabled. Try Generate Suggestions again.",
    });
  }

  return {
    suggestions,
    mode: "adversarial_roleplay_tournament",
    screened: tournament.screenedCount,
    kept: screened.length,
    created: created.length,
    reviewCandidates: rankedCandidates.map(serializeCandidateForScreening),
    brainstormTurns: tournament.turns,
  };
}
