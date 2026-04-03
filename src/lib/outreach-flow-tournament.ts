import { spawn } from "node:child_process";
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

const OUTREACH_FLOW_RUNNER =
  "/Users/don/.codex/skills/outreach-flow-architect/scripts/run_outreach_flow_tournament.py";

const DEFAULT_PERSONAS = [
  "Editor of an industry journal or market note we operate",
  "Research lead behind a benchmark, report, or field note",
  "Organizer of a small operator roundtable in this space",
  "Partnerships lead for a co-created spotlight or feature",
];

const DEFAULT_ASSETS = [
  "Editorial or case-study format we can publish from",
  "Benchmark or report framework",
  "Roundtable invite and summary format",
  "Private notes memo we can send after the reply",
];

const DEFAULT_CONSTRAINTS = [
  "The opener must not read like cold outreach.",
  "The first ask should be easy to answer in one line.",
  "Bridge to the offer should happen only after real engagement.",
  "Avoid invented authority or fake affiliations.",
];

const DEFAULT_BAR = [
  "Prefer identity-led entry vehicles over problem-first cold email.",
  "Reward low-friction reply asks.",
  "Prefer natural handoffs to a specialist over abrupt reveals.",
  "Penalize angles that collapse under one skeptical follow-up.",
];

type TournamentErrorInput = {
  message: string;
  status: number;
  hint?: string;
  debug?: Record<string, unknown>;
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

function asStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => asString(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function asInteger(value: unknown, fallback = 0) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dedupe(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function inferOfferName(input: { product: string; name: string }) {
  return asString(input.product) || asString(input.name) || "the offer";
}

function normalizeBrief(
  brand: { name: string; product: string },
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

  const offer = asString(input.offer) || inferOfferName(brand);
  const channel = asString(input.channel) || "email";

  return {
    target,
    desiredOutcome,
    offer,
    channel,
    availablePersonas: dedupe(asStringArray(input.availablePersonas)).slice(0, 8),
    availableAssets: dedupe(asStringArray(input.availableAssets)).slice(0, 8),
    constraints: dedupe(asStringArray(input.constraints)).slice(0, 8),
    bar: dedupe(asStringArray(input.qualityBar)).slice(0, 8),
    maxTurnsBeforeCTA: Math.max(1, Math.min(8, asInteger(input.maxTurnsBeforeCTA, 4))),
    agentCount: Math.max(1, Math.min(6, asInteger(input.agentCount, 4))),
    ideasPerAgent: Math.max(1, Math.min(4, asInteger(input.ideasPerAgent, 2))),
  };
}

function withDefaults(brief: NormalizedTournamentBrief): NormalizedTournamentBrief {
  return {
    ...brief,
    availablePersonas: brief.availablePersonas.length ? brief.availablePersonas : DEFAULT_PERSONAS,
    availableAssets: brief.availableAssets.length ? brief.availableAssets : DEFAULT_ASSETS,
    constraints: brief.constraints.length ? brief.constraints : DEFAULT_CONSTRAINTS,
    bar: brief.bar.length ? brief.bar : DEFAULT_BAR,
  };
}

function normalizeBranch(value: unknown): OutreachFlowTournamentBranch | null {
  const row = asRecord(value);
  const branch = asString(row.branch);
  const response = asString(row.response);
  if (!branch || !response) return null;
  return {
    branch,
    targetReply: asString(row.targetReply),
    response,
    goal: asString(row.goal),
  };
}

function normalizeIdea(value: unknown): OutreachFlowTournamentIdea | null {
  const row = asRecord(value);
  const title = asString(row.title);
  const persona = asString(row.persona);
  const entryVehicle = asString(row.entryVehicle);
  const whyReply = asString(row.whyReply);
  const openerBody = asString(row.openerBody);
  if (!title || !persona || !entryVehicle || !whyReply || !openerBody) return null;

  const assetBurden = asString(row.assetBurden).toLowerCase();
  const suspicionRisk = asString(row.suspicionRisk).toLowerCase();

  return {
    title,
    persona,
    entryVehicle,
    whyReply,
    whyNow: asString(row.whyNow),
    personaProof: asStringArray(row.personaProof).slice(0, 4),
    assetBurdenLevel:
      assetBurden === "low" || assetBurden === "high" ? assetBurden : "medium",
    suspicionRiskLevel:
      suspicionRisk === "low" || suspicionRisk === "high" ? suspicionRisk : "medium",
    openerSubject: asString(row.openerSubject),
    openerBody,
    branches: Array.isArray(row.branches)
      ? row.branches.map((branch) => normalizeBranch(branch)).filter((branch): branch is OutreachFlowTournamentBranch => Boolean(branch))
      : [],
    bridgeMoment: asString(row.bridgeMoment),
    handoffPlan: asString(row.handoffPlan),
    cta: asString(row.cta),
    rationale: asString(row.rationale),
  };
}

function normalizeTurn(value: unknown): OutreachFlowTournamentTurn | null {
  const row = asRecord(value);
  const agentId = asString(row.agentId);
  const agentName = asString(row.agentName);
  if (!agentId || !agentName) return null;
  return {
    agentId,
    agentName,
    agentStyle: asString(row.agentStyle),
    brief: asString(row.brief),
    ideas: Array.isArray(row.ideas)
      ? row.ideas.map((idea) => normalizeIdea(idea)).filter((idea): idea is OutreachFlowTournamentIdea => Boolean(idea))
      : [],
    acceptedTitles: asStringArray(row.acceptedTitles),
  };
}

function normalizeCandidate(value: unknown): OutreachFlowTournamentCandidate | null {
  const row = asRecord(value);
  const index = asInteger(row.index, -1);
  const title = asString(row.title);
  const persona = asString(row.persona);
  const entryVehicle = asString(row.entryVehicle);
  const whyReply = asString(row.whyReply);
  const openerBody = asString(row.openerBody);

  if (index < 0 || !title || !persona || !entryVehicle || !whyReply || !openerBody) return null;

  return {
    index,
    title,
    persona,
    entryVehicle,
    whyReply,
    whyNow: asString(row.whyNow),
    personaProof: asStringArray(row.personaProof).slice(0, 4),
    openerSubject: asString(row.openerSubject),
    openerBody,
    branches: Array.isArray(row.branches)
      ? row.branches.map((branch) => normalizeBranch(branch)).filter((branch): branch is OutreachFlowTournamentBranch => Boolean(branch))
      : [],
    bridgeMoment: asString(row.bridgeMoment),
    handoffPlan: asString(row.handoffPlan),
    cta: asString(row.cta),
    rationale: asString(row.rationale),
    score: asInteger(row.score),
    replyLikelihood: asInteger(row.replyLikelihood),
    personaCredibility: asInteger(row.personaCredibility),
    bridgeQuality: asInteger(row.bridgeQuality),
    assetFeasibility: asInteger(row.assetFeasibility),
    suspicionRisk: asInteger(row.suspicionRisk),
    decision: asString(row.decision) === "promote" || asString(row.decision) === "reject" ? (asString(row.decision) as "promote" | "reject") : "revise",
    summary: asString(row.summary),
    strengths: asStringArray(row.strengths).slice(0, 4),
    risks: asStringArray(row.risks).slice(0, 4),
    accepted: row.accepted === true,
    rank: asNumber(row.rank),
  };
}

function normalizeShortlistItem(value: unknown): OutreachFlowTournamentShortlistItem | null {
  const row = asRecord(value);
  const index = asInteger(row.index, -1);
  const title = asString(row.title);
  if (index < 0 || !title) return null;
  return {
    index,
    title,
    category: asString(row.category),
    pitch: asString(row.pitch),
    note: asString(row.note),
  };
}

function normalizeResult(value: RawRunnerResult): OutreachFlowTournamentResult {
  return {
    shortlist: Array.isArray(value.shortlist)
      ? value.shortlist
          .map((item) => normalizeShortlistItem(item))
          .filter((item): item is OutreachFlowTournamentShortlistItem => Boolean(item))
      : [],
    pressureSummary: asString(value.pressureSummary),
    strongestUsefulDenial: asString(value.strongestUsefulDenial),
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

async function executeRunner(
  brief: NormalizedTournamentBrief,
  signal?: AbortSignal
): Promise<OutreachFlowTournamentResult> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(
      "python3",
      [OUTREACH_FLOW_RUNNER, "--stdin-json", "--json"],
      {
        env: {
          ...process.env,
          OUTREACH_FLOW_MODEL: process.env.OUTREACH_FLOW_MODEL || "gpt-5.4",
          OUTREACH_FLOW_JUDGE_MODEL:
            process.env.OUTREACH_FLOW_JUDGE_MODEL ||
            process.env.OUTREACH_FLOW_MODEL ||
            "gpt-5.4",
        },
      }
    );

    let stdout = "";
    let stderr = "";

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    const handleAbort = () => {
      child.kill("SIGTERM");
      finish(() =>
        reject(
          new OutreachFlowTournamentError({
            message: "Outreach-flow tournament was cancelled.",
            status: 499,
          })
        )
      );
    };

    if (signal) {
      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener("abort", handleAbort, { once: true });
    }

    child.on("error", (error) => {
      finish(() =>
        reject(
          new OutreachFlowTournamentError({
            message: "Failed to start the outreach-flow tournament runner.",
            status: 500,
            hint: "Make sure Python 3 is installed and the outreach-flow skill is available locally.",
            debug: { reason: error.message },
          })
        )
      );
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      finish(() => {
        if (signal) {
          signal.removeEventListener("abort", handleAbort);
        }

        if (code !== 0) {
          reject(
            new OutreachFlowTournamentError({
              message: "Outreach-flow tournament failed.",
              status: 500,
              hint:
                stderr.trim() ||
                "Check that OPENAI_API_KEY is available and the local outreach-flow skill is installed.",
              debug: {
                code,
                stderr: stderr.trim().slice(0, 800),
              },
            })
          );
          return;
        }

        try {
          const parsed = JSON.parse(stdout) as RawRunnerResult;
          const result = normalizeResult(parsed);
          if (!result.shortlist.length && !result.allCandidates.length) {
            reject(
              new OutreachFlowTournamentError({
                message: "Outreach-flow tournament returned no usable ideas.",
                status: 500,
                hint: stderr.trim() || "Try tightening the target and desired endpoint, then run it again.",
              })
            );
            return;
          }
          resolve(result);
        } catch (error) {
          reject(
            new OutreachFlowTournamentError({
              message: "Outreach-flow tournament returned invalid JSON.",
              status: 500,
              hint: "The runner finished, but the result could not be parsed.",
              debug: {
                stdout: stdout.trim().slice(0, 800),
                reason: error instanceof Error ? error.message : "Unknown parse error",
              },
            })
          );
        }
      });
    });

    child.stdin.write(JSON.stringify(brief));
    child.stdin.end();
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

  const brief = withDefaults(normalizeBrief(brand, input.brief));
  return await executeRunner(brief, input.signal);
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
