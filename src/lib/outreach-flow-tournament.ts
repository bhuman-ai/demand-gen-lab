import { getBrandById } from "@/lib/factory-data";
import { OUTREACH_FLOW_AGENTS } from "@/lib/outreach-flow-agent-data";
import type {
  OutreachFlowTournamentBranch,
  OutreachFlowTournamentCandidate,
  OutreachFlowTournamentIdea,
  OutreachFlowTournamentInput,
  OutreachFlowTournamentResult,
  OutreachFlowTournamentShortlistItem,
  OutreachFlowTournamentStreamEvent,
  OutreachFlowTournamentTurn,
} from "@/lib/factory-types";

const GENERATOR_MODEL = process.env.OUTREACH_FLOW_MODEL || "gpt-5.4";
const JUDGE_MODEL =
  process.env.OUTREACH_FLOW_JUDGE_MODEL || process.env.OUTREACH_FLOW_MODEL || "gpt-5.4";
const OPENAI_URL = process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 240_000;
const MAX_TURNS_BEFORE_CTA = 15;
const MAX_AGENT_COUNT = 6;
const MAX_IDEAS_PER_AGENT = 4;

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
  operablePersonas: string[];
  availableAssets: string[];
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

type ResolvedTournamentRun = {
  brief: OutreachFlowTournamentInput;
  result: OutreachFlowTournamentResult;
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

function extractStableBrandNotes(value: unknown) {
  const note = asString(value);
  if (!note) return "";

  const markers = [
    /(?:^|[.?!]\s+)priority themes?(?: right now)?\s*:/i,
    /(?:^|[.?!]\s+)current themes?\s*:/i,
    /(?:^|[.?!]\s+)active themes?\s*:/i,
    /(?:^|[.?!]\s+)example themes?\s*:/i,
    /(?:^|[.?!]\s+)campaign themes?\s*:/i,
  ];

  let cutoff = note.length;
  for (const marker of markers) {
    const match = note.search(marker);
    if (match >= 0) {
      cutoff = Math.min(cutoff, match);
    }
  }

  return note
    .slice(0, cutoff)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[,:;\-]+$/, "");
}

function buildBrandContext(brand: Awaited<ReturnType<typeof getBrandById>>): BrandContext {
  return {
    name: asString(brand?.name),
    website: asString(brand?.website),
    tone: asString(brand?.tone),
    notes: extractStableBrandNotes(brand?.notes),
    product: asString(brand?.product),
    operablePersonas: clipLines(asStringArray(brand?.operablePersonas), 8),
    availableAssets: clipLines(asStringArray(brand?.availableAssets), 8),
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
    availablePersonas: clipLines(
      asStringArray(input.availablePersonas).length
        ? asStringArray(input.availablePersonas)
        : brandContext.operablePersonas,
      8
    ),
    availableAssets: clipLines(
      asStringArray(input.availableAssets).length
        ? asStringArray(input.availableAssets)
        : brandContext.availableAssets,
      8
    ),
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

function toStoredBrief(brief: NormalizedTournamentBrief): OutreachFlowTournamentInput {
  return {
    target: brief.target,
    desiredOutcome: brief.desiredOutcome,
    offer: brief.offer,
    channel: brief.channel,
    availablePersonas: clipLines(brief.availablePersonas, 8),
    availableAssets: clipLines(brief.availableAssets, 8),
    constraints: clipLines(brief.constraints, 8),
    qualityBar: clipLines(brief.bar, 8),
    maxTurnsBeforeCTA: brief.maxTurnsBeforeCTA,
    agentCount: brief.agentCount,
    ideasPerAgent: brief.ideasPerAgent,
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
    "- availableAssets must be the proof, container, or operating asset that makes those personas believable.",
    "- constraints should be plain-English guardrails, not abstract strategy slogans.",
    "- bar should be the judge rubric: what stronger lanes must do better than weaker lanes.",
    "- maxTurnsBeforeCTA must reflect how much trust-building this sale needs. Use 3 to 15.",
    "- agentCount must be 3 to 6 and should reflect how many distinct approaches are worth competing.",
    "- ideasPerAgent must be 1 to 3 and should stay tight unless the territory is unusually broad.",
    "- Optimize for full bridge systems: real persona, real asset, clear first win, proof loop, and natural bridge trigger.",
    "- Assume the assets you name are real and available for this run. Do not weaken the plan just to avoid asset-backed lanes.",
    "- Prefer editorial, research, peer, collaboration, inclusion, benchmark, and trial-backed lanes before audit-shaped outreach.",
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
    oneLine(candidate.backingAsset).toLowerCase(),
    oneLine(candidate.entryVehicle).toLowerCase(),
    oneLine(candidate.bridgeTrigger).toLowerCase(),
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
    backingAsset: oneLine(row.backingAsset ?? row.backing_asset),
    entryVehicle,
    firstValue: oneLine(row.firstValue ?? row.first_value),
    whyReply,
    whyNow: oneLine(row.whyNow),
    proofLoop: oneLine(row.proofLoop ?? row.proof_loop),
    bridgeTrigger: oneLine(row.bridgeTrigger ?? row.bridge_trigger),
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
  const order = Math.max(1, asInteger(row.order, 0));
  const agentId = oneLine(row.agentId);
  const agentName = oneLine(row.agentName);
  if (!agentId || !agentName) return null;
  const status = oneLine(row.status).toLowerCase();
  return {
    order,
    agentId,
    agentName,
    agentStyle: oneLine(row.agentStyle),
    brief: oneLine(row.brief),
    status:
      status === "failed" || status === "drafted" ? (status as "failed" | "drafted") : "drafting",
    ideas: Array.isArray(row.ideas)
      ? row.ideas
          .map((idea) => normalizeIdea(idea))
          .filter((idea): idea is OutreachFlowTournamentIdea => Boolean(idea))
      : [],
    acceptedTitles: clipLines(asStringArray(row.acceptedTitles), 12),
    error: oneLine(row.error),
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
    backingAsset: oneLine(row.backingAsset ?? row.backing_asset),
    entryVehicle,
    firstValue: oneLine(row.firstValue ?? row.first_value),
    whyReply,
    whyNow: oneLine(row.whyNow),
    proofLoop: oneLine(row.proofLoop ?? row.proof_loop),
    bridgeTrigger: oneLine(row.bridgeTrigger ?? row.bridge_trigger),
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

async function emitEvent(
  handler:
    | ((event: OutreachFlowTournamentStreamEvent) => Promise<void> | void)
    | undefined,
  event: OutreachFlowTournamentStreamEvent,
  signal?: AbortSignal
) {
  if (signal?.aborted) return;
  await handler?.(event);
}

function buildTurn(input: {
  order: number;
  agent: (typeof OUTREACH_FLOW_AGENTS)[number];
  status: OutreachFlowTournamentTurn["status"];
  ideas?: Array<Record<string, unknown>>;
  acceptedTitles?: string[];
  error?: string;
}): OutreachFlowTournamentTurn {
  return {
    order: input.order,
    agentId: input.agent.id,
    agentName: input.agent.name,
    agentStyle: input.agent.style,
    brief: input.agent.brief,
    status: input.status,
    ideas: Array.isArray(input.ideas)
      ? input.ideas
          .map((idea) => normalizeIdea(idea))
          .filter((idea): idea is OutreachFlowTournamentIdea => Boolean(idea))
      : [],
    acceptedTitles: clipLines(input.acceptedTitles ?? [], 12),
    error: oneLine(input.error),
  };
}

async function generateAgentCandidates(input: {
  brief: NormalizedTournamentBrief;
  agent: (typeof OUTREACH_FLOW_AGENTS)[number];
  occupiedTerritory: Array<Record<string, string>>;
  signal?: AbortSignal;
}): Promise<Array<Record<string, unknown>>> {
  const prompt = [
    "You are one specialist inside an adversarial tournament for outreach-driven conversational flows.",
    "You only win if the downstream judge believes your flow will get a real reply and can naturally bridge toward the true desired outcome.",
    "Do not write generic cold email. Design a full bridge system: credible persona, real asset, first win for the target, proof loop, bridge trigger, and natural endpoint.",
    "Assume all listed personas and assets are real and available for this run.",
    "",
    `AgentName: ${input.agent.name}`,
    `AgentStyle: ${input.agent.style}`,
    `AgentBrief: ${input.agent.brief}`,
    "",
    "Return strict JSON only:",
    '{ "candidates": [{ "title": string, "persona": string, "backingAsset": string, "entryVehicle": string, "firstValue": string, "whyReply": string, "whyNow": string, "proofLoop": string, "bridgeTrigger": string, "personaProof": string[], "assetBurden": "low"|"medium"|"high", "suspicionRisk": "low"|"medium"|"high", "openerSubject": string, "openerBody": string, "branches": [{ "branch": string, "targetReply": string, "response": string, "goal": string }], "bridgeMoment": string, "handoffPlan": string, "cta": string, "rationale": string }] }',
    "",
    "Rules:",
    `- Generate exactly ${input.brief.ideasPerAgent} candidates.`,
    "- Use only personas the team could actually operate.",
    "- Treat all listed assets as real. assetBurden means coordination complexity, not whether the asset exists.",
    "- Prefer editorial, research, peer, collaboration, inclusion, benchmark, and trial-backed systems before audit-shaped outreach.",
    "- backingAsset must name the real publication, benchmark, interview, event, founder access, trial, or other asset that makes the lane real.",
    "- firstValue must state what the target gets before the commercial bridge appears.",
    "- proofLoop must explain what becomes publicly, socially, or procedurally real after they engage, so later follow-up feels earned.",
    "- bridgeTrigger must name the concrete event that makes the true offer relevant later.",
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
      backingAsset: candidate.backingAsset,
      entryVehicle: candidate.entryVehicle,
      firstValue: candidate.firstValue,
      whyReply: candidate.whyReply,
      whyNow: candidate.whyNow,
      proofLoop: candidate.proofLoop,
      bridgeTrigger: candidate.bridgeTrigger,
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
    "- Promote flows that create a genuine first win, a believable proof loop, and a concrete bridge trigger to the real offer.",
    "- Penalize first messages that look like cold email, audits, disguised pitches, or over-constructed pretext.",
    "- Treat listed personas and assets as real and available. assetFeasibility measures operating cleanliness, not whether the asset exists.",
    "- Penalize systems with weak first value, no proof loop, or a bridge trigger that feels abrupt, manipulative, or too obviously engineered.",
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
    asNumber(evaluation.replyLikelihood) * 0.4 +
    asNumber(evaluation.personaCredibility) * 0.35 +
    asNumber(evaluation.bridgeQuality) * 0.45 +
    asNumber(evaluation.assetFeasibility) * 0.1 -
    asNumber(evaluation.suspicionRisk) * 0.7 +
    decisionBoost
  );
}

function passesGate(evaluation: Record<string, unknown>) {
  if (oneLine(evaluation.decision) === "reject") return false;
  if (asNumber(evaluation.score) < 72) return false;
  if (asNumber(evaluation.replyLikelihood) < 25) return false;
  if (asNumber(evaluation.personaCredibility) < 68) return false;
  if (asNumber(evaluation.bridgeQuality) < 70) return false;
  if (asNumber(evaluation.assetFeasibility) < 40) return false;
  if (asNumber(evaluation.suspicionRisk) > 40) return false;
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
      backingAsset: oneLine(candidate.backingAsset),
      entryVehicle: oneLine(candidate.entryVehicle),
      firstValue: oneLine(candidate.firstValue),
      proofLoop: oneLine(candidate.proofLoop),
      bridgeTrigger: oneLine(candidate.bridgeTrigger),
      openerBody: oneLine(candidate.openerBody),
      bridgeMoment: oneLine(candidate.bridgeMoment),
      handoffPlan: oneLine(candidate.handoffPlan),
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
    "- pitch should be one short sentence saying how the full bridge system wins.",
    "- note should say why its first win, proof loop, and bridge trigger survived manager pressure.",
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
  options: {
    signal?: AbortSignal;
    onEvent?: (event: OutreachFlowTournamentStreamEvent) => Promise<void> | void;
  }
): Promise<OutreachFlowTournamentResult> {
  const activeAgents = OUTREACH_FLOW_AGENTS.slice(0, brief.agentCount);

  await emitEvent(
    options.onEvent,
    {
      type: "phase",
      phase: "generating",
      phaseLabel: "Generating reply-first lanes",
    },
    options.signal
  );

  const generatedByAgent = await Promise.all(
    activeAgents.map(async (agent, index) => {
      const order = index + 1;
      await emitEvent(
        options.onEvent,
        {
          type: "turn_started",
          turn: buildTurn({
            order,
            agent,
            status: "drafting",
          }),
        },
        options.signal
      );

      try {
        const ideas = await generateAgentCandidates({
          brief,
          agent,
          occupiedTerritory: [],
          signal: options.signal,
        });

        await emitEvent(
          options.onEvent,
          {
            type: "turn_completed",
            turn: buildTurn({
              order,
              agent,
              status: "drafted",
              ideas,
            }),
          },
          options.signal
        );

        return { order, agent, ideas, error: "" };
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message.trim()
            : `Generation failed for ${agent.name}.`;

        await emitEvent(
          options.onEvent,
          {
            type: "turn_failed",
            turn: buildTurn({
              order,
              agent,
              status: "failed",
              error: message,
            }),
          },
          options.signal
        );

        return { order, agent, ideas: null, error: message };
      }
    })
  );

  const occupiedTerritory: Array<Record<string, string>> = [];
  const turns: OutreachFlowTournamentTurn[] = [];
  const allCandidates: Array<Record<string, unknown>> = [];

  for (const generated of generatedByAgent) {
    const { agent, error, order } = generated;
    if (!generated.ideas) {
      turns.push(
        buildTurn({
          order,
          agent,
          status: "failed",
          error,
        })
      );
      continue;
    }

    const ideas = generated.ideas;
    const acceptedTitles: string[] = [];
    for (const idea of ideas) {
      const key = noveltyKey(idea);
      if (allCandidates.some((existing) => noveltyKey(existing) === key)) continue;
      allCandidates.push(idea);
      occupiedTerritory.push({
        persona: oneLine(idea.persona),
        backingAsset: oneLine(idea.backingAsset),
        entryVehicle: oneLine(idea.entryVehicle),
        bridgeTrigger: oneLine(idea.bridgeTrigger),
      });
      acceptedTitles.push(oneLine(idea.title));
    }

    turns.push(
      buildTurn({
        order,
        agent,
        status: "drafted",
        ideas,
        acceptedTitles,
      })
    );
  }

  if (!allCandidates.length) {
    throw new OutreachFlowTournamentError({
      message: "No valid outreach-flow candidates were generated.",
      status: 500,
      hint: "Tighten the target or desired endpoint and try again.",
    });
  }

  await emitEvent(
    options.onEvent,
    {
      type: "phase",
      phase: "judging",
      phaseLabel: "Applying judge pressure",
    },
    options.signal
  );

  const evaluations = await judgeCandidates(brief, allCandidates, options.signal);
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

  await emitEvent(
    options.onEvent,
    {
      type: "phase",
      phase: "shortlisting",
      phaseLabel: "Assembling the shortlist",
    },
    options.signal
  );

  const manager = await managerShortlist({
    brief,
    candidates: allCandidates,
    evaluations,
    signal: options.signal,
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
  onEvent?: (event: OutreachFlowTournamentStreamEvent) => Promise<void> | void;
}): Promise<ResolvedTournamentRun> {
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
  if (needsDynamicStrategy(normalizedBrief)) {
    await emitEvent(
      input.onEvent,
      {
        type: "phase",
        phase: "planning",
        phaseLabel: "Planning arena controls",
      },
      signal
    );
  }
  const brief = await withDynamicStrategy(normalizedBrief, signal);
  await emitEvent(
    input.onEvent,
    {
      type: "start",
      requestedAgents: brief.agentCount,
      ideasPerAgent: brief.ideasPerAgent,
    },
    signal
  );
  const result = await executeRunner(brief, {
    signal,
    onEvent: input.onEvent,
  });
  return {
    brief: toStoredBrief(brief),
    result,
  };
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
