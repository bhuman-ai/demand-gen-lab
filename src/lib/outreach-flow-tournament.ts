import { getBrandById } from "@/lib/factory-data";
import type {
  OutreachFlowTournamentBranch,
  OutreachFlowTournamentCandidate,
  OutreachFlowTournamentIdea,
  OutreachFlowTournamentInput,
  OutreachFlowTournamentResult,
  OutreachFlowTournamentShortlistItem,
  OutreachFlowTournamentTurn,
} from "@/lib/factory-types";

const GENERATOR_MODEL = process.env.OUTREACH_FLOW_MODEL || "gpt-5.4";
const JUDGE_MODEL =
  process.env.OUTREACH_FLOW_JUDGE_MODEL || process.env.OUTREACH_FLOW_MODEL || "gpt-5.4";
const OPENAI_URL = process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TURNS_BEFORE_CTA = 15;
const MAX_AGENT_COUNT = 6;
const MAX_IDEAS_PER_AGENT = 4;

const AGENTS = [
  {
    id: "editorial-operator",
    name: "Agent 1 · Editorial Operator",
    style: "editorial-led",
    brief:
      "Create a feature, case study, quote request, or journal-style invitation that gives the target a status reason to reply.",
  },
  {
    id: "research-lead",
    name: "Agent 2 · Research Lead",
    style: "research-led",
    brief:
      "Use a benchmark, report, survey, or field-observation frame that can uncover context without sounding commercial.",
  },
  {
    id: "peer-convener",
    name: "Agent 3 · Peer Convener",
    style: "peer-context-led",
    brief:
      "Use a roundtable, operator discussion, panel, or peer exchange that the target may want to join.",
  },
  {
    id: "collaboration-architect",
    name: "Agent 4 · Collaboration Architect",
    style: "collaboration-led",
    brief:
      "Use a partnership, contribution, or co-created content angle that opens a natural thread before the offer appears.",
  },
  {
    id: "credibility-minimalist",
    name: "Agent 5 · Credibility Minimalist",
    style: "minimalist",
    brief:
      "Choose the simplest truthful persona with the lowest asset burden and the cleanest route to a reply.",
  },
  {
    id: "contrarian",
    name: "Agent 6 · Contrarian",
    style: "contrarian",
    brief:
      "Bring a sharper, less expected entry vehicle that still feels credible and supportable.",
  },
] as const;

type TournamentErrorInput = {
  message: string;
  status: number;
  hint?: string;
  debug?: Record<string, unknown>;
};

type BrandContext = {
  name: string;
  website: string;
  tone: string;
  notes: string;
  product: string;
  markets: string[];
  icps: string[];
  features: string[];
  benefits: string[];
};

type NormalizedTournamentBrief = {
  target: string;
  desiredOutcome: string;
  offer: string;
  channel: string;
  availablePersonas: string[];
  availableAssets: string[];
  constraints: string[];
  bar: string[];
  maxTurnsBeforeCTA: number;
  agentCount: number;
  ideasPerAgent: number;
  brandContext: BrandContext;
};

type StrategyPlan = Pick<
  NormalizedTournamentBrief,
  | "availablePersonas"
  | "availableAssets"
  | "constraints"
  | "bar"
  | "maxTurnsBeforeCTA"
  | "agentCount"
  | "ideasPerAgent"
>;

type OpenAiJsonResult = {
  record: Record<string, unknown>;
  outputText: string;
};

type RawRunnerResult = Record<string, unknown>;

export class OutreachFlowTournamentError extends Error {
  status: number;
  hint?: string;
  debug?: Record<string, unknown>;

  constructor(input: TournamentErrorInput) {
    super(input.message);
    this.name = "OutreachFlowTournamentError";
    this.status = input.status;
    this.hint = input.hint;
    this.debug = input.debug;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asInteger(value: unknown, fallback = 0) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function oneLine(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function asStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => oneLine(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function dedupe(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clipLines(values: string[], limit: number) {
  return dedupe(values).slice(0, limit);
}

function clampInteger(value: number, minimum: number, maximum: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function inferOfferName(input: { product: string; name: string }) {
  return asString(input.product) || asString(input.name) || "the offer";
}

function buildBrandContext(brand: Awaited<ReturnType<typeof getBrandById>>): BrandContext {
  return {
    name: asString(brand?.name),
    website: asString(brand?.website),
    tone: asString(brand?.tone),
    notes: asString(brand?.notes),
    product: asString(brand?.product),
    markets: clipLines(asStringArray(brand?.targetMarkets), 8),
    icps: clipLines(asStringArray(brand?.idealCustomerProfiles), 8),
    features: clipLines(asStringArray(brand?.keyFeatures), 8),
    benefits: clipLines(asStringArray(brand?.keyBenefits), 8),
  };
}

function normalizeBrief(
  brandContext: BrandContext,
  input: OutreachFlowTournamentInput
): NormalizedTournamentBrief {
  const target = asString(input.target);
  const desiredOutcome = asString(input.desiredOutcome);

  if (!target) {
    throw new OutreachFlowTournamentError({
      message: "Target is required to run the outreach tournament.",
      status: 400,
      hint: "Describe the person or company you want the tournament to aim at.",
    });
  }

  if (!desiredOutcome) {
    throw new OutreachFlowTournamentError({
      message: "Desired endpoint is required to run the outreach tournament.",
      status: 400,
      hint: "Say what the conversation should naturally lead to.",
    });
  }

  const offer = asString(input.offer) || inferOfferName(brandContext);
  const channel = asString(input.channel) || "email";

  return {
    target,
    desiredOutcome,
    offer,
    channel,
    availablePersonas: clipLines(asStringArray(input.availablePersonas), 8),
    availableAssets: clipLines(asStringArray(input.availableAssets), 8),
    constraints: clipLines(asStringArray(input.constraints), 8),
    bar: clipLines(asStringArray(input.qualityBar), 8),
    maxTurnsBeforeCTA: clampInteger(
      asInteger(input.maxTurnsBeforeCTA, 0),
      0,
      MAX_TURNS_BEFORE_CTA,
      0
    ),
    agentCount: clampInteger(asInteger(input.agentCount, 0), 0, MAX_AGENT_COUNT, 0),
    ideasPerAgent: clampInteger(asInteger(input.ideasPerAgent, 0), 0, MAX_IDEAS_PER_AGENT, 0),
    brandContext,
  };
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

async function requestOpenAiJson(input: {
  model: string;
  prompt: string;
  maxOutputTokens: number;
  label: string;
  signal?: AbortSignal;
}): Promise<OpenAiJsonResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OutreachFlowTournamentError({
      message: "OPENAI_API_KEY is not configured.",
      status: 503,
      hint: "Set the API key before running outreach tournaments.",
    });
  }

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      input: input.prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: input.maxOutputTokens,
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    const reason = await response.text().catch(() => "");
    throw new OutreachFlowTournamentError({
      message: input.label,
      status: 502,
      hint: `${response.status}: ${reason.slice(0, 600) || "unknown error"}`,
    });
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

function needsDynamicStrategy(brief: NormalizedTournamentBrief) {
  return (
    !brief.availablePersonas.length ||
    !brief.availableAssets.length ||
    !brief.constraints.length ||
    !brief.bar.length ||
    brief.maxTurnsBeforeCTA < 1 ||
    brief.agentCount < 1 ||
    brief.ideasPerAgent < 1
  );
}

async function deriveStrategyPlan(
  brief: NormalizedTournamentBrief,
  signal?: AbortSignal
): Promise<StrategyPlan> {
  const prompt = [
    "You are configuring an outreach-flow tournament before ideation starts.",
    "Decide the right runway, personas, assets, guardrails, and tournament pressure for this brief.",
    "You are not writing the outreach itself yet. You are setting the board so the later agents can compete well.",
    "",
    "Return strict JSON only:",
    '{ "availablePersonas": string[], "availableAssets": string[], "constraints": string[], "bar": string[], "maxTurnsBeforeCTA": number, "agentCount": number, "ideasPerAgent": number }',
    "",
    "Rules:",
    "- availablePersonas must be real, supportable roles the team could plausibly operate.",
    "- availableAssets must be the proof, container, or lightweight infrastructure that makes those personas believable.",
    "- constraints should be plain-English guardrails, not abstract strategy slogans.",
    "- bar should be the judge rubric: what stronger lanes must do better than weaker lanes.",
    "- maxTurnsBeforeCTA must reflect how much trust-building this sale needs. Use 3 to 15.",
    "- agentCount must be 3 to 6 and should reflect how many distinct approaches are worth competing.",
    "- ideasPerAgent must be 1 to 3 and should stay tight unless the territory is unusually broad.",
    "- If brand context is sparse, favor low-asset personas and cleaner, more defensible entry vehicles.",
    "- Prefer editorial, research, peer, collaboration, or inclusion-style lanes before audit-shaped outreach.",
    "",
    `Target: ${brief.target}`,
    `DesiredOutcome: ${brief.desiredOutcome}`,
    `Offer: ${brief.offer}`,
    `Channel: ${brief.channel}`,
    `BrandContext: ${JSON.stringify(brief.brandContext)}`,
  ].join("\n");

  const { record } = await requestOpenAiJson({
    model: JUDGE_MODEL,
    prompt,
    maxOutputTokens: 1800,
    label: "Outreach-flow strategy planning failed.",
    signal,
  });

  return {
    availablePersonas: clipLines(asStringArray(record.availablePersonas), 8),
    availableAssets: clipLines(asStringArray(record.availableAssets), 8),
    constraints: clipLines(asStringArray(record.constraints), 8),
    bar: clipLines(asStringArray(record.bar), 8),
    maxTurnsBeforeCTA: clampInteger(
      asInteger(record.maxTurnsBeforeCTA, 6),
      3,
      MAX_TURNS_BEFORE_CTA,
      6
    ),
    agentCount: clampInteger(asInteger(record.agentCount, 4), 3, MAX_AGENT_COUNT, 4),
    ideasPerAgent: clampInteger(asInteger(record.ideasPerAgent, 2), 1, 3, 2),
  };
}

async function withDynamicStrategy(
  brief: NormalizedTournamentBrief,
  signal?: AbortSignal
): Promise<NormalizedTournamentBrief> {
  if (!needsDynamicStrategy(brief)) {
    return {
      ...brief,
      maxTurnsBeforeCTA: clampInteger(brief.maxTurnsBeforeCTA, 1, MAX_TURNS_BEFORE_CTA, 6),
      agentCount: clampInteger(brief.agentCount, 1, MAX_AGENT_COUNT, 4),
      ideasPerAgent: clampInteger(brief.ideasPerAgent, 1, MAX_IDEAS_PER_AGENT, 2),
    };
  }

  const derived = await deriveStrategyPlan(brief, signal);
  return {
    ...brief,
    availablePersonas: brief.availablePersonas.length ? brief.availablePersonas : derived.availablePersonas,
    availableAssets: brief.availableAssets.length ? brief.availableAssets : derived.availableAssets,
    constraints: brief.constraints.length ? brief.constraints : derived.constraints,
    bar: brief.bar.length ? brief.bar : derived.bar,
    maxTurnsBeforeCTA:
      brief.maxTurnsBeforeCTA > 0
        ? clampInteger(brief.maxTurnsBeforeCTA, 1, MAX_TURNS_BEFORE_CTA, derived.maxTurnsBeforeCTA)
        : derived.maxTurnsBeforeCTA,
    agentCount:
      brief.agentCount > 0
        ? clampInteger(brief.agentCount, 1, MAX_AGENT_COUNT, derived.agentCount)
        : derived.agentCount,
    ideasPerAgent:
      brief.ideasPerAgent > 0
        ? clampInteger(brief.ideasPerAgent, 1, MAX_IDEAS_PER_AGENT, derived.ideasPerAgent)
        : derived.ideasPerAgent,
  };
}

function noveltyKey(candidate: Record<string, unknown>) {
  return [
    oneLine(candidate.persona).toLowerCase(),
    oneLine(candidate.entryVehicle).toLowerCase(),
    oneLine(candidate.bridgeMoment).toLowerCase(),
  ].join("::");
}

function normalizeBranch(value: unknown): OutreachFlowTournamentBranch | null {
  const row = asRecord(value);
  const branch = oneLine(row.branch);
  const response = oneLine(row.response);
  if (!branch || !response) return null;
  return {
    branch,
    targetReply: oneLine(row.targetReply),
    response,
    goal: oneLine(row.goal),
  };
}

function normalizeIdea(value: unknown): OutreachFlowTournamentIdea | null {
  const row = asRecord(value);
  const title = oneLine(row.title);
  const persona = oneLine(row.persona);
  const entryVehicle = oneLine(row.entryVehicle);
  const whyReply = oneLine(row.whyReply);
  const openerBody = oneLine(row.openerBody);
  if (!title || !persona || !entryVehicle || !whyReply || !openerBody) return null;

  const assetBurden = oneLine(row.assetBurden).toLowerCase();
  const suspicionRisk = oneLine(row.suspicionRisk).toLowerCase();

  return {
    title,
    persona,
    entryVehicle,
    whyReply,
    whyNow: oneLine(row.whyNow),
    personaProof: clipLines(asStringArray(row.personaProof), 4),
    assetBurdenLevel:
      assetBurden === "low" || assetBurden === "high" ? assetBurden : "medium",
    suspicionRiskLevel:
      suspicionRisk === "low" || suspicionRisk === "high" ? suspicionRisk : "medium",
    openerSubject: oneLine(row.openerSubject),
    openerBody,
    branches: Array.isArray(row.branches)
      ? row.branches
          .map((branch) => normalizeBranch(branch))
          .filter((branch): branch is OutreachFlowTournamentBranch => Boolean(branch))
      : [],
    bridgeMoment: oneLine(row.bridgeMoment),
    handoffPlan: oneLine(row.handoffPlan),
    cta: oneLine(row.cta),
    rationale: oneLine(row.rationale),
  };
}

function normalizeTurn(value: unknown): OutreachFlowTournamentTurn | null {
  const row = asRecord(value);
  const agentId = oneLine(row.agentId);
  const agentName = oneLine(row.agentName);
  if (!agentId || !agentName) return null;
  return {
    agentId,
    agentName,
    agentStyle: oneLine(row.agentStyle),
    brief: oneLine(row.brief),
    ideas: Array.isArray(row.ideas)
      ? row.ideas.map((idea) => normalizeIdea(idea)).filter((idea): idea is OutreachFlowTournamentIdea => Boolean(idea))
      : [],
    acceptedTitles: clipLines(asStringArray(row.acceptedTitles), 12),
  };
}

function normalizeCandidate(value: unknown): OutreachFlowTournamentCandidate | null {
  const row = asRecord(value);
  const index = asInteger(row.index, -1);
  const title = oneLine(row.title);
  const persona = oneLine(row.persona);
  const entryVehicle = oneLine(row.entryVehicle);
  const whyReply = oneLine(row.whyReply);
  const openerBody = oneLine(row.openerBody);

  if (index < 0 || !title || !persona || !entryVehicle || !whyReply || !openerBody) return null;

  const decision = oneLine(row.decision);
  return {
    index,
    title,
    persona,
    entryVehicle,
    whyReply,
    whyNow: oneLine(row.whyNow),
    personaProof: clipLines(asStringArray(row.personaProof), 4),
    openerSubject: oneLine(row.openerSubject),
    openerBody,
    branches: Array.isArray(row.branches)
      ? row.branches
          .map((branch) => normalizeBranch(branch))
          .filter((branch): branch is OutreachFlowTournamentBranch => Boolean(branch))
      : [],
    bridgeMoment: oneLine(row.bridgeMoment),
    handoffPlan: oneLine(row.handoffPlan),
    cta: oneLine(row.cta),
    rationale: oneLine(row.rationale),
    score: asInteger(row.score),
    replyLikelihood: asInteger(row.replyLikelihood),
    personaCredibility: asInteger(row.personaCredibility),
    bridgeQuality: asInteger(row.bridgeQuality),
    assetFeasibility: asInteger(row.assetFeasibility),
    suspicionRisk: asInteger(row.suspicionRisk),
    decision:
      decision === "promote" || decision === "reject"
        ? (decision as "promote" | "reject")
        : "revise",
    summary: oneLine(row.summary),
    strengths: clipLines(asStringArray(row.strengths), 4),
    risks: clipLines(asStringArray(row.risks), 4),
    accepted: row.accepted === true,
    rank: asNumber(row.rank),
  };
}

function normalizeShortlistItem(value: unknown): OutreachFlowTournamentShortlistItem | null {
  const row = asRecord(value);
  const index = asInteger(row.index, -1);
  const title = oneLine(row.title);
  if (index < 0 || !title) return null;
  return {
    index,
    title,
    category: oneLine(row.category),
    pitch: oneLine(row.pitch),
    note: oneLine(row.note),
  };
}

function normalizeResult(value: RawRunnerResult): OutreachFlowTournamentResult {
  return {
    shortlist: Array.isArray(value.shortlist)
      ? value.shortlist
          .map((item) => normalizeShortlistItem(item))
          .filter((item): item is OutreachFlowTournamentShortlistItem => Boolean(item))
      : [],
    pressureSummary: oneLine(value.pressureSummary),
    strongestUsefulDenial: oneLine(value.strongestUsefulDenial),
    snapshot: {
      agents: Math.max(0, asInteger(asRecord(value.snapshot).agents)),
      ideas: Math.max(0, asInteger(asRecord(value.snapshot).ideas)),
      accepted: Math.max(0, asInteger(asRecord(value.snapshot).accepted)),
      denied: Math.max(0, asInteger(asRecord(value.snapshot).denied)),
    },
    turns: Array.isArray(value.turns)
      ? value.turns.map((turn) => normalizeTurn(turn)).filter((turn): turn is OutreachFlowTournamentTurn => Boolean(turn))
      : [],
    allCandidates: Array.isArray(value.allCandidates)
      ? value.allCandidates
          .map((candidate) => normalizeCandidate(candidate))
          .filter((candidate): candidate is OutreachFlowTournamentCandidate => Boolean(candidate))
      : [],
  };
}

async function generateAgentCandidates(input: {
  brief: NormalizedTournamentBrief;
  agent: (typeof AGENTS)[number];
  occupiedTerritory: Array<Record<string, string>>;
  signal?: AbortSignal;
}): Promise<Array<Record<string, unknown>>> {
  const prompt = [
    "You are one specialist inside an adversarial tournament for outreach-driven conversational flows.",
    "You only win if the downstream judge believes your flow will get a real reply and can naturally bridge toward the true desired outcome.",
    "Do not write generic cold email. Start from a credible persona and an identity-led entry vehicle.",
    "",
    `AgentName: ${input.agent.name}`,
    `AgentStyle: ${input.agent.style}`,
    `AgentBrief: ${input.agent.brief}`,
    "",
    "Return strict JSON only:",
    '{ "candidates": [{ "title": string, "persona": string, "entryVehicle": string, "whyReply": string, "whyNow": string, "personaProof": string[], "assetBurden": "low"|"medium"|"high", "suspicionRisk": "low"|"medium"|"high", "openerSubject": string, "openerBody": string, "branches": [{ "branch": string, "targetReply": string, "response": string, "goal": string }], "bridgeMoment": string, "handoffPlan": string, "cta": string, "rationale": string }] }',
    "",
    "Rules:",
    `- Generate exactly ${input.brief.ideasPerAgent} candidates.`,
    "- Use only personas the team could actually operate.",
    "- Prefer editorial, research, peer, collaboration, or inclusion-style entry vehicles before audit-shaped outreach.",
    "- Message one should be an easy reason to reply, not a disguised pitch.",
    "- openerBody should be a short real first message in plain English.",
    "- branches must include at least: positive, curious, skeptical, delegate, no reply.",
    "- bridgeMoment must explain how the thread naturally makes the real offer relevant later.",
    "- handoffPlan must name the role-correct way a second real person might enter, if needed.",
    "- rationale must be one plain-English sentence starting with 'This could win because...'.",
    "- Avoid jargon like funnel, leverage, artifact, enablement, product-led, or operator motion.",
    "- Avoid invented authority, fake affiliations, or backstories that would collapse under one skeptical follow-up.",
    "- Do not repeat occupied territory.",
    "",
    `Target: ${input.brief.target}`,
    `DesiredOutcome: ${input.brief.desiredOutcome}`,
    `Offer: ${input.brief.offer}`,
    `Channel: ${input.brief.channel}`,
    `MaxTurnsBeforeCTA: ${input.brief.maxTurnsBeforeCTA}`,
    `AvailablePersonas: ${JSON.stringify(input.brief.availablePersonas)}`,
    `AvailableAssets: ${JSON.stringify(input.brief.availableAssets)}`,
    `Constraints: ${JSON.stringify(input.brief.constraints)}`,
    `QualityBar: ${JSON.stringify(input.brief.bar)}`,
    `BrandContext: ${JSON.stringify(input.brief.brandContext)}`,
    `OccupiedTerritory: ${JSON.stringify(input.occupiedTerritory)}`,
  ].join("\n");

  const { record } = await requestOpenAiJson({
    model: GENERATOR_MODEL,
    prompt,
    maxOutputTokens: 2800,
    label: `Outreach candidate generation failed for ${input.agent.name}.`,
    signal: input.signal,
  });

  const rows = Array.isArray(record.candidates) ? record.candidates : [];
  return rows
    .map((candidate) => normalizeIdea(candidate))
    .filter((candidate): candidate is OutreachFlowTournamentIdea => Boolean(candidate))
    .map((candidate) => ({
      title: candidate.title,
      persona: candidate.persona,
      entryVehicle: candidate.entryVehicle,
      whyReply: candidate.whyReply,
      whyNow: candidate.whyNow,
      personaProof: candidate.personaProof,
      assetBurden: candidate.assetBurdenLevel,
      suspicionRisk: candidate.suspicionRiskLevel,
      openerSubject: candidate.openerSubject,
      openerBody: candidate.openerBody,
      branches: candidate.branches,
      bridgeMoment: candidate.bridgeMoment,
      handoffPlan: candidate.handoffPlan,
      cta: candidate.cta,
      rationale: candidate.rationale,
    }));
}

function normalizeEvaluations(value: unknown, candidateCount: number) {
  if (!Array.isArray(value)) return [];
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<number>();

  for (const entry of value) {
    const row = asRecord(entry);
    const index = asInteger(row.index, -1);
    if (index < 0 || index >= candidateCount || seen.has(index)) continue;
    seen.add(index);
    const decision = oneLine(row.decision).toLowerCase();
    rows.push({
      index,
      score: clampInteger(asInteger(row.score, 0), 0, 100, 0),
      replyLikelihood: clampInteger(asInteger(row.replyLikelihood, 0), 0, 100, 0),
      personaCredibility: clampInteger(asInteger(row.personaCredibility, 0), 0, 100, 0),
      bridgeQuality: clampInteger(asInteger(row.bridgeQuality, 0), 0, 100, 0),
      assetFeasibility: clampInteger(asInteger(row.assetFeasibility, 0), 0, 100, 0),
      suspicionRisk: clampInteger(asInteger(row.suspicionRisk, 0), 0, 100, 0),
      decision: decision === "promote" || decision === "reject" ? decision : "revise",
      summary: oneLine(row.summary),
      strengths: clipLines(asStringArray(row.strengths), 4),
      risks: clipLines(asStringArray(row.risks), 4),
    });
  }

  return rows;
}

async function judgeCandidates(
  brief: NormalizedTournamentBrief,
  candidates: Array<Record<string, unknown>>,
  signal?: AbortSignal
) {
  const prompt = [
    "You are a strict review panel judging outreach-driven conversational flows.",
    "Evaluate these candidates as if the target is busy, skeptical, status-aware, cautious, and allergic to obvious cold outreach.",
    "The first objective is to earn a real reply. The second is to keep the thread believable long enough to make the true offer relevant.",
    "",
    "Return strict JSON only:",
    '{ "evaluations": [{ "index": number, "score": number, "replyLikelihood": number, "personaCredibility": number, "bridgeQuality": number, "assetFeasibility": number, "suspicionRisk": number, "decision": "promote"|"revise"|"reject", "summary": string, "strengths": string[], "risks": string[] }] }',
    "",
    "Scoring rules:",
    "- Use 0-100 integers, not 1-10 scales.",
    "- Promote flows that create a genuine reason to reply and can sustain the conversation naturally.",
    "- Penalize first messages that look like cold email, audits, disguised pitches, or over-constructed pretext.",
    "- Penalize personas that require assets the team probably does not have.",
    "- Penalize bridges that feel abrupt, manipulative, or too obviously engineered.",
    "- Be strict. Most candidates should not be promoted.",
    "",
    `Target: ${brief.target}`,
    `DesiredOutcome: ${brief.desiredOutcome}`,
    `Offer: ${brief.offer}`,
    `Channel: ${brief.channel}`,
    `AvailablePersonas: ${JSON.stringify(brief.availablePersonas)}`,
    `AvailableAssets: ${JSON.stringify(brief.availableAssets)}`,
    `Constraints: ${JSON.stringify(brief.constraints)}`,
    `QualityBar: ${JSON.stringify(brief.bar)}`,
    `BrandContext: ${JSON.stringify(brief.brandContext)}`,
    `Candidates: ${JSON.stringify(candidates.map((candidate, index) => ({ ...candidate, index })))}`,
  ].join("\n");

  const { record } = await requestOpenAiJson({
    model: JUDGE_MODEL,
    prompt,
    maxOutputTokens: 2600,
    label: "Outreach-flow review failed.",
    signal,
  });

  const evaluations = normalizeEvaluations(record.evaluations, candidates.length);
  if (evaluations.length !== candidates.length) {
    throw new OutreachFlowTournamentError({
      message: "Outreach-flow review returned mismatched candidate coverage.",
      status: 500,
      hint: `Expected ${candidates.length} evaluations, received ${evaluations.length}.`,
    });
  }
  return evaluations;
}

function rankEvaluation(evaluation: Record<string, unknown>) {
  const decision = oneLine(evaluation.decision);
  const decisionBoost = decision === "promote" ? 10 : decision === "revise" ? 2 : -15;
  return (
    asNumber(evaluation.score) +
    asNumber(evaluation.replyLikelihood) * 0.45 +
    asNumber(evaluation.personaCredibility) * 0.35 +
    asNumber(evaluation.bridgeQuality) * 0.3 +
    asNumber(evaluation.assetFeasibility) * 0.2 -
    asNumber(evaluation.suspicionRisk) * 0.7 +
    decisionBoost
  );
}

function passesGate(evaluation: Record<string, unknown>) {
  if (oneLine(evaluation.decision) === "reject") return false;
  if (asNumber(evaluation.score) < 72) return false;
  if (asNumber(evaluation.replyLikelihood) < 25) return false;
  if (asNumber(evaluation.personaCredibility) < 68) return false;
  if (asNumber(evaluation.bridgeQuality) < 65) return false;
  if (asNumber(evaluation.assetFeasibility) < 55) return false;
  if (asNumber(evaluation.suspicionRisk) > 35) return false;
  return true;
}

async function managerShortlist(input: {
  brief: NormalizedTournamentBrief;
  candidates: Array<Record<string, unknown>>;
  evaluations: Array<Record<string, unknown>>;
  signal?: AbortSignal;
}) {
  const merged = input.evaluations.map((evaluation) => {
    const index = asInteger(evaluation.index, -1);
    const candidate = input.candidates[index] ?? {};
    return {
      index,
      title: oneLine(candidate.title),
      persona: oneLine(candidate.persona),
      entryVehicle: oneLine(candidate.entryVehicle),
      openerBody: oneLine(candidate.openerBody),
      bridgeMoment: oneLine(candidate.bridgeMoment),
      cta: oneLine(candidate.cta),
      evaluation,
      rank: Math.round(rankEvaluation(evaluation) * 100) / 100,
    };
  });

  merged.sort((left, right) => right.rank - left.rank);
  const finalists = merged.slice(0, 5);

  const prompt = [
    "You are the final manager in an adversarial outreach-flow tournament.",
    "Select the strongest surviving ideas and explain why they survived pressure.",
    "Do not restate every detail. Focus on what made the winners better.",
    "",
    "Return strict JSON only:",
    '{ "shortlist": [{ "index": number, "title": string, "category": string, "pitch": string, "note": string }], "pressureSummary": string, "strongestUsefulDenial": string }',
    "",
    "Rules:",
    "- shortlist should include 1 to 3 items.",
    "- category should be short, usually persona + entry vehicle.",
    "- pitch should be one short sentence saying how the flow wins.",
    "- note should say why it survived manager pressure.",
    "- strongestUsefulDenial should be the strongest reason not to use the top discarded lane, if that sharpens the recommendation.",
    "",
    `Target: ${input.brief.target}`,
    `DesiredOutcome: ${input.brief.desiredOutcome}`,
    `Offer: ${input.brief.offer}`,
    `Finalists: ${JSON.stringify(finalists)}`,
  ].join("\n");

  const { record } = await requestOpenAiJson({
    model: JUDGE_MODEL,
    prompt,
    maxOutputTokens: 1400,
    label: "Outreach-flow manager shortlist failed.",
    signal: input.signal,
  });

  const shortlist = Array.isArray(record.shortlist)
    ? record.shortlist
        .map((item) => normalizeShortlistItem(item))
        .filter((item): item is OutreachFlowTournamentShortlistItem => Boolean(item))
    : [];

  if (!shortlist.length) {
    throw new OutreachFlowTournamentError({
      message: "Outreach-flow manager returned no shortlist.",
      status: 500,
    });
  }

  return {
    shortlist: shortlist.slice(0, 3),
    pressureSummary: oneLine(record.pressureSummary),
    strongestUsefulDenial: oneLine(record.strongestUsefulDenial),
  };
}

async function executeRunner(
  brief: NormalizedTournamentBrief,
  signal?: AbortSignal
): Promise<OutreachFlowTournamentResult> {
  const activeAgents = AGENTS.slice(0, brief.agentCount);
  const generatedByAgent = await Promise.all(
    activeAgents.map(async (agent) => ({
      agent,
      ideas: await generateAgentCandidates({
        brief,
        agent,
        occupiedTerritory: [],
        signal,
      }),
    }))
  );

  const occupiedTerritory: Array<Record<string, string>> = [];
  const turns: Array<Record<string, unknown>> = [];
  const allCandidates: Array<Record<string, unknown>> = [];

  for (const { agent, ideas } of generatedByAgent) {
    const acceptedTitles: string[] = [];
    for (const idea of ideas) {
      const key = noveltyKey(idea);
      if (allCandidates.some((existing) => noveltyKey(existing) === key)) continue;
      allCandidates.push(idea);
      occupiedTerritory.push({
        persona: oneLine(idea.persona),
        entryVehicle: oneLine(idea.entryVehicle),
        bridgeMoment: oneLine(idea.bridgeMoment),
      });
      acceptedTitles.push(oneLine(idea.title));
    }

    turns.push({
      agentId: agent.id,
      agentName: agent.name,
      agentStyle: agent.style,
      brief: agent.brief,
      ideas,
      acceptedTitles,
    });
  }

  if (!allCandidates.length) {
    throw new OutreachFlowTournamentError({
      message: "No valid outreach-flow candidates were generated.",
      status: 500,
      hint: "Tighten the target or desired endpoint and try again.",
    });
  }

  const evaluations = await judgeCandidates(brief, allCandidates, signal);
  let accepted = 0;
  const reviewed = evaluations.map((evaluation) => {
    const index = asInteger(evaluation.index, -1);
    const candidate = allCandidates[index] ?? {};
    const passed = passesGate(evaluation);
    if (passed) accepted += 1;
    return {
      index,
      ...candidate,
      ...evaluation,
      accepted: passed,
      rank: Math.round(rankEvaluation(evaluation) * 100) / 100,
    };
  });

  const manager = await managerShortlist({
    brief,
    candidates: allCandidates,
    evaluations,
    signal,
  });

  return normalizeResult({
    shortlist: manager.shortlist,
    pressureSummary: manager.pressureSummary,
    strongestUsefulDenial: manager.strongestUsefulDenial,
    snapshot: {
      agents: activeAgents.length,
      ideas: reviewed.length,
      accepted,
      denied: reviewed.length - accepted,
    },
    turns,
    allCandidates: reviewed.sort((left, right) => asNumber(right.rank) - asNumber(left.rank)),
  });
}

export async function runOutreachFlowTournament(input: {
  brandId: string;
  brief: OutreachFlowTournamentInput;
  signal?: AbortSignal;
}) {
  const brand = await getBrandById(input.brandId);
  if (!brand) {
    throw new OutreachFlowTournamentError({
      message: "Brand not found.",
      status: 404,
    });
  }

  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal;

  const brandContext = buildBrandContext(brand);
  const normalizedBrief = normalizeBrief(brandContext, input.brief);
  const brief = await withDynamicStrategy(normalizedBrief, signal);
  return await executeRunner(brief, signal);
}

export function serializeOutreachFlowTournamentError(error: unknown) {
  if (error instanceof OutreachFlowTournamentError) {
    return {
      error: error.message,
      hint: error.hint,
      debug: error.debug,
      status: error.status,
    };
  }

  return {
    error: "Outreach-flow tournament failed.",
    hint: "Fix the underlying runtime issue and retry.",
    debug: {
      reason: error instanceof Error ? error.message : "Unknown error",
    },
    status: 500,
  };
}
