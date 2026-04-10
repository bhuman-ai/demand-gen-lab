import { mkdir, readFile, writeFile } from "fs/promises";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { OutreachFlowTournamentError } from "@/lib/outreach-flow-tournament";
import type {
  OutreachFlowTournamentBranch,
  OutreachFlowTournamentCandidate,
  OutreachFlowTournamentIdea,
  OutreachFlowTournamentInput,
  OutreachFlowTournamentResult,
  OutreachFlowTournamentSavedResult,
  OutreachFlowTournamentShortlistItem,
  OutreachFlowTournamentSnapshot,
  OutreachFlowTournamentTurn,
} from "@/lib/factory-types";

type OutreachFlowResultStore = {
  results: OutreachFlowTournamentSavedResult[];
};

const isVercel = Boolean(process.env.VERCEL);
const OUTREACH_FLOW_RESULTS_PATH = isVercel
  ? "/tmp/outreach_flow_results.v1.json"
  : `${process.cwd()}/data/outreach_flow_results.v1.json`;
const OUTREACH_FLOW_RESULTS_TABLE = "demanddev_outreach_flow_results";

const nowIso = () => new Date().toISOString();

function describeSupabasePersistenceFailure(error: unknown) {
  const row = asRecord(error);
  const code = String(row.code ?? "").trim().toUpperCase();
  if (code === "42P01") {
    return new OutreachFlowTournamentError({
      message: "Outreach-flow results table is missing.",
      hint: "Apply supabase/migrations/20260410174500_outreach_flow_results.sql, then redeploy.",
      status: 500,
      debug: row,
    });
  }

  return new OutreachFlowTournamentError({
    message: "Outreach-flow results could not be saved.",
    hint: "Check Supabase service-role permissions and apply the latest migrations, then retry.",
    status: 500,
    debug: row,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeStringArray(value: unknown) {
  return asArray(value)
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
}

function normalizeBranch(value: unknown): OutreachFlowTournamentBranch {
  const row = asRecord(value);
  return {
    branch: String(row.branch ?? "").trim(),
    targetReply: String(row.targetReply ?? row.target_reply ?? row.trigger ?? "").trim(),
    response: String(row.response ?? "").trim(),
    goal: String(row.goal ?? "").trim(),
  };
}

function normalizeIdea(value: unknown): OutreachFlowTournamentIdea {
  const row = asRecord(value);
  const assetBurdenLevel = String(row.assetBurdenLevel ?? row.asset_burden_level ?? "").trim();
  const suspicionRiskLevel = String(
    row.suspicionRiskLevel ?? row.suspicion_risk_level ?? ""
  ).trim();
  return {
    title: String(row.title ?? "").trim(),
    persona: String(row.persona ?? "").trim(),
    backingAsset: String(row.backingAsset ?? row.backing_asset ?? "").trim(),
    entryVehicle: String(row.entryVehicle ?? row.entry_vehicle ?? "").trim(),
    firstValue: String(row.firstValue ?? row.first_value ?? "").trim(),
    whyReply: String(row.whyReply ?? row.why_reply ?? "").trim(),
    whyNow: String(row.whyNow ?? row.why_now ?? "").trim(),
    proofLoop: String(row.proofLoop ?? row.proof_loop ?? "").trim(),
    bridgeTrigger: String(row.bridgeTrigger ?? row.bridge_trigger ?? "").trim(),
    personaProof: normalizeStringArray(row.personaProof ?? row.persona_proof),
    assetBurdenLevel:
      assetBurdenLevel === "high" || assetBurdenLevel === "medium" ? assetBurdenLevel : "low",
    suspicionRiskLevel:
      suspicionRiskLevel === "high" || suspicionRiskLevel === "medium"
        ? suspicionRiskLevel
        : "low",
    openerSubject: String(row.openerSubject ?? row.opener_subject ?? "").trim(),
    openerBody: String(row.openerBody ?? row.opener_body ?? "").trim(),
    branches: asArray(row.branches).map(normalizeBranch),
    bridgeMoment: String(row.bridgeMoment ?? row.bridge_moment ?? "").trim(),
    handoffPlan: String(row.handoffPlan ?? row.handoff_plan ?? "").trim(),
    cta: String(row.cta ?? "").trim(),
    rationale: String(row.rationale ?? "").trim(),
  };
}

function normalizeTurn(value: unknown): OutreachFlowTournamentTurn {
  const row = asRecord(value);
  const status = String(row.status ?? "").trim();
  return {
    order: Math.max(1, Math.round(Number(row.order ?? 1) || 1)),
    agentId: String(row.agentId ?? row.agent_id ?? "").trim(),
    agentName: String(row.agentName ?? row.agent_name ?? "").trim(),
    agentStyle: String(row.agentStyle ?? row.agent_style ?? "").trim(),
    brief: String(row.brief ?? "").trim(),
    status:
      status === "failed" || status === "drafted"
        ? status
        : "drafting",
    ideas: asArray(row.ideas).map(normalizeIdea),
    acceptedTitles: normalizeStringArray(row.acceptedTitles ?? row.accepted_titles),
    error: String(row.error ?? "").trim() || undefined,
  };
}

function normalizeCandidate(value: unknown): OutreachFlowTournamentCandidate {
  const row = asRecord(value);
  const decision = String(row.decision ?? "").trim();
  return {
    index: Math.max(0, Math.round(Number(row.index ?? 0) || 0)),
    title: String(row.title ?? "").trim(),
    persona: String(row.persona ?? "").trim(),
    backingAsset: String(row.backingAsset ?? row.backing_asset ?? "").trim(),
    entryVehicle: String(row.entryVehicle ?? row.entry_vehicle ?? "").trim(),
    firstValue: String(row.firstValue ?? row.first_value ?? "").trim(),
    whyReply: String(row.whyReply ?? row.why_reply ?? "").trim(),
    whyNow: String(row.whyNow ?? row.why_now ?? "").trim(),
    proofLoop: String(row.proofLoop ?? row.proof_loop ?? "").trim(),
    bridgeTrigger: String(row.bridgeTrigger ?? row.bridge_trigger ?? "").trim(),
    personaProof: normalizeStringArray(row.personaProof ?? row.persona_proof),
    openerSubject: String(row.openerSubject ?? row.opener_subject ?? "").trim(),
    openerBody: String(row.openerBody ?? row.opener_body ?? "").trim(),
    branches: asArray(row.branches).map(normalizeBranch),
    bridgeMoment: String(row.bridgeMoment ?? row.bridge_moment ?? "").trim(),
    handoffPlan: String(row.handoffPlan ?? row.handoff_plan ?? "").trim(),
    cta: String(row.cta ?? "").trim(),
    rationale: String(row.rationale ?? "").trim(),
    score: Math.max(0, Number(row.score ?? 0) || 0),
    replyLikelihood: Math.max(0, Number(row.replyLikelihood ?? row.reply_likelihood ?? 0) || 0),
    personaCredibility: Math.max(
      0,
      Number(row.personaCredibility ?? row.persona_credibility ?? 0) || 0
    ),
    bridgeQuality: Math.max(0, Number(row.bridgeQuality ?? row.bridge_quality ?? 0) || 0),
    assetFeasibility: Math.max(
      0,
      Number(row.assetFeasibility ?? row.asset_feasibility ?? 0) || 0
    ),
    suspicionRisk: Math.max(0, Number(row.suspicionRisk ?? row.suspicion_risk ?? 0) || 0),
    decision:
      decision === "reject" || decision === "revise"
        ? decision
        : "promote",
    summary: String(row.summary ?? "").trim(),
    strengths: normalizeStringArray(row.strengths),
    risks: normalizeStringArray(row.risks),
    accepted: Boolean(row.accepted),
    rank: Math.max(0, Math.round(Number(row.rank ?? 0) || 0)),
  };
}

function normalizeShortlistItem(value: unknown): OutreachFlowTournamentShortlistItem {
  const row = asRecord(value);
  return {
    index: Math.max(0, Math.round(Number(row.index ?? 0) || 0)),
    title: String(row.title ?? "").trim(),
    category: String(row.category ?? "").trim(),
    pitch: String(row.pitch ?? "").trim(),
    note: String(row.note ?? "").trim(),
  };
}

function normalizeSnapshot(value: unknown): OutreachFlowTournamentSnapshot {
  const row = asRecord(value);
  return {
    agents: Math.max(0, Math.round(Number(row.agents ?? 0) || 0)),
    ideas: Math.max(0, Math.round(Number(row.ideas ?? 0) || 0)),
    accepted: Math.max(0, Math.round(Number(row.accepted ?? 0) || 0)),
    denied: Math.max(0, Math.round(Number(row.denied ?? 0) || 0)),
  };
}

function normalizeBrief(value: unknown): OutreachFlowTournamentInput {
  const row = asRecord(value);
  return {
    target: String(row.target ?? "").trim(),
    desiredOutcome: String(row.desiredOutcome ?? row.desired_outcome ?? "").trim(),
    offer: String(row.offer ?? "").trim(),
    channel: String(row.channel ?? "email").trim() || "email",
    availablePersonas: normalizeStringArray(row.availablePersonas ?? row.available_personas),
    availableAssets: normalizeStringArray(row.availableAssets ?? row.available_assets),
    constraints: normalizeStringArray(row.constraints),
    qualityBar: normalizeStringArray(row.qualityBar ?? row.quality_bar),
    maxTurnsBeforeCTA: Math.max(
      0,
      Math.round(Number(row.maxTurnsBeforeCTA ?? row.max_turns_before_cta ?? 0) || 0)
    ),
    agentCount: Math.max(0, Math.round(Number(row.agentCount ?? row.agent_count ?? 0) || 0)),
    ideasPerAgent: Math.max(
      0,
      Math.round(Number(row.ideasPerAgent ?? row.ideas_per_agent ?? 0) || 0)
    ),
  };
}

function normalizeResult(value: unknown): OutreachFlowTournamentResult {
  const row = asRecord(value);
  return {
    shortlist: asArray(row.shortlist).map(normalizeShortlistItem),
    pressureSummary: String(row.pressureSummary ?? row.pressure_summary ?? "").trim(),
    strongestUsefulDenial: String(
      row.strongestUsefulDenial ?? row.strongest_useful_denial ?? ""
    ).trim(),
    snapshot: normalizeSnapshot(row.snapshot),
    turns: asArray(row.turns).map(normalizeTurn),
    allCandidates: asArray(row.allCandidates ?? row.all_candidates).map(normalizeCandidate),
  };
}

function mapSavedResultRow(value: unknown): OutreachFlowTournamentSavedResult {
  const row = asRecord(value);
  return {
    brandId: String(row.brandId ?? row.brand_id ?? "").trim(),
    brief: normalizeBrief(row.brief),
    result: normalizeResult(row.result),
    createdAt: String(row.createdAt ?? row.created_at ?? nowIso()),
    updatedAt: String(row.updatedAt ?? row.updated_at ?? nowIso()),
  };
}

function defaultStore(): OutreachFlowResultStore {
  return { results: [] };
}

async function readLocalStore(): Promise<OutreachFlowResultStore> {
  try {
    const raw = await readFile(OUTREACH_FLOW_RESULTS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<OutreachFlowResultStore>;
    return {
      results: Array.isArray(parsed.results) ? parsed.results.map(mapSavedResultRow) : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      await mkdir(OUTREACH_FLOW_RESULTS_PATH.split("/").slice(0, -1).join("/"), {
        recursive: true,
      });
      await writeFile(
        OUTREACH_FLOW_RESULTS_PATH,
        JSON.stringify(defaultStore(), null, 2),
        "utf8"
      );
      return defaultStore();
    }
    throw error;
  }
}

async function writeLocalStore(store: OutreachFlowResultStore) {
  await mkdir(OUTREACH_FLOW_RESULTS_PATH.split("/").slice(0, -1).join("/"), {
    recursive: true,
  });
  await writeFile(OUTREACH_FLOW_RESULTS_PATH, JSON.stringify(store, null, 2), "utf8");
}

export async function getSavedOutreachFlowResult(
  brandId: string
): Promise<OutreachFlowTournamentSavedResult | null> {
  const normalizedBrandId = brandId.trim();
  if (!normalizedBrandId) return null;

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(OUTREACH_FLOW_RESULTS_TABLE)
      .select("*")
      .eq("brand_id", normalizedBrandId)
      .maybeSingle();
    if (!error) {
      return data ? mapSavedResultRow(data) : null;
    }
    if (isVercel) {
      throw describeSupabasePersistenceFailure(error);
    }
  }

  const store = await readLocalStore();
  const match = store.results.find((row) => row.brandId === normalizedBrandId);
  return match ? mapSavedResultRow(match) : null;
}

export async function saveOutreachFlowResult(input: {
  brandId: string;
  brief: OutreachFlowTournamentInput;
  result: OutreachFlowTournamentResult;
}): Promise<OutreachFlowTournamentSavedResult> {
  const normalizedBrandId = input.brandId.trim();
  if (!normalizedBrandId) {
    throw new Error("Cannot save outreach-flow result without a brand ID.");
  }

  const now = nowIso();
  const savedResult: OutreachFlowTournamentSavedResult = {
    brandId: normalizedBrandId,
    brief: normalizeBrief(input.brief),
    result: normalizeResult(input.result),
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(OUTREACH_FLOW_RESULTS_TABLE)
      .upsert(
        {
          brand_id: savedResult.brandId,
          brief: savedResult.brief,
          result: savedResult.result,
          updated_at: savedResult.updatedAt,
        },
        { onConflict: "brand_id" }
      )
      .select("*")
      .single();
    if (!error && data) {
      return mapSavedResultRow(data);
    }
    if (isVercel) {
      throw describeSupabasePersistenceFailure(error);
    }
  }

  const store = await readLocalStore();
  const existingIndex = store.results.findIndex((row) => row.brandId === normalizedBrandId);
  const nextRecord =
    existingIndex >= 0
      ? {
          ...savedResult,
          createdAt: store.results[existingIndex]?.createdAt || savedResult.createdAt,
        }
      : savedResult;

  if (existingIndex >= 0) {
    store.results[existingIndex] = nextRecord;
  } else {
    store.results.unshift(nextRecord);
  }

  store.results.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
  await writeLocalStore(store);
  return nextRecord;
}
