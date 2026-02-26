import { createHash } from "crypto";
import {
  defaultExperimentRunPolicy,
  getBrandById,
  getCampaignById,
  updateCampaign,
  type CampaignRecord,
  type Experiment,
  type Hypothesis,
} from "@/lib/factory-data";
import type {
  ActorCapabilityProfile,
  ConversationFlowGraph,
  ConversationFlowNode,
  LeadAcceptanceDecision,
  LeadQualityPolicy,
  ReplyThread,
  SourcingChainDecision,
  SourcingChainStep,
  SourcingTraceSummary,
} from "@/lib/factory-types";
import {
  createConversationEvent,
  createConversationSession,
  getConversationSessionByLead,
  getPublishedConversationMapForExperiment,
  listConversationSessionsByRun,
  updateConversationSession,
} from "@/lib/conversation-flow-data";
import { getExperimentRecordByRuntimeRef } from "@/lib/experiment-data";
import {
  conversationPromptModeEnabled,
  generateConversationPromptMessage,
  type ConversationPromptRenderContext,
} from "@/lib/conversation-prompt-render";
import {
  createOutreachEvent,
  createOutreachRun,
  createReplyDraft,
  createReplyMessage,
  createReplyThread,
  createSourcingChainDecision,
  createSourcingProbeResults,
  createRunAnomaly,
  createRunMessages,
  enqueueOutreachJob,
  getBrandOutreachAssignment,
  getOutreachAccount,
  getOutreachAccountSecrets,
  getOutreachRun,
  getReplyDraft,
  getReplyThread,
  getSourcingActorMemory,
  listCampaignRuns,
  listDueOutreachJobs,
  listExperimentRuns,
  listReplyThreadsByBrand,
  listRunLeads,
  listRunMessages,
  updateOutreachJob,
  updateOutreachRun,
  updateReplyDraft,
  updateReplyThread,
  updateSourcingChainDecision,
  updateRunLead,
  updateRunMessage,
  upsertSourcingActorMemory,
  upsertSourcingActorProfiles,
  upsertRunLeads,
  type OutreachJob,
} from "@/lib/outreach-data";
import {
  evaluateActorCompatibility,
  evaluateLeadAgainstQualityPolicy,
  fetchApifyActorDatasetItems,
  fetchApifyActorSchemaProfile,
  getLeadEmailSuppressionReason,
  pollApifyActorRun,
  runApifyActorSyncGetDatasetItems,
  leadsFromApifyRows,
  sendOutreachMessage,
  sendReplyDraftAsEvent,
  searchApifyStoreActors,
  startApifyActorRun,
  type ApifyStoreActor,
  type ApifyLead,
} from "@/lib/outreach-providers";
import { resolveLlmModel } from "@/lib/llm-router";

const DEFAULT_TIMEZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const CONVERSATION_TICK_MINUTES = 15;

function nowIso() {
  return new Date().toISOString();
}

function toDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0);
  }
  return parsed;
}

function findHypothesis(campaign: CampaignRecord, hypothesisId: string) {
  return campaign.hypotheses.find((item) => item.id === hypothesisId) ?? null;
}

function findExperiment(campaign: CampaignRecord, experimentId: string) {
  return campaign.experiments.find((item) => item.id === experimentId) ?? null;
}

function effectiveSourceConfig(hypothesis: Hypothesis) {
  return {
    actorId: hypothesis.sourceConfig?.actorId?.trim() || "",
    actorInput: hypothesis.sourceConfig?.actorInput ?? {},
    maxLeads: Number(hypothesis.sourceConfig?.maxLeads ?? 100),
  };
}

function platformSourcingToken() {
  return (
    String(process.env.APIFY_TOKEN ?? "").trim() ||
    String(process.env.APIFY_API_TOKEN ?? "").trim() ||
    String(process.env.APIFY_API_KEY ?? "").trim()
  );
}

type ResolvedAccount = NonNullable<Awaited<ReturnType<typeof getOutreachAccount>>>;
type ResolvedSecrets = NonNullable<Awaited<ReturnType<typeof getOutreachAccountSecrets>>>;

function effectiveCustomerIoApiKey(secrets: ResolvedSecrets) {
  return (
    secrets.customerIoApiKey.trim() ||
    secrets.customerIoTrackApiKey.trim() ||
    secrets.customerIoAppApiKey.trim()
  );
}

function effectiveSourcingToken(secrets: ResolvedSecrets) {
  return secrets.apifyToken.trim() || platformSourcingToken();
}

type LeadChainStepStage = "prospect_discovery" | "website_enrichment" | "email_discovery";

type LeadSourcingChainStep = {
  id: string;
  stage: LeadChainStepStage;
  purpose: string;
  actorId: string;
  queryHint: string;
};

type LeadSourcingChainPlan = {
  id: string;
  strategy: string;
  rationale: string;
  steps: LeadSourcingChainStep[];
};

type ProbedSourcingPlan = {
  plan: LeadSourcingChainPlan;
  probeResults: Array<{
    stepIndex: number;
    actorId: string;
    stage: LeadChainStepStage;
    outcome: "pass" | "fail";
    probeInputHash: string;
    qualityMetrics: Record<string, unknown>;
    costEstimateUsd: number;
    details: Record<string, unknown>;
  }>;
  acceptedLeads: ApifyLead[];
  rejectedLeads: LeadAcceptanceDecision[];
  acceptedCount: number;
  rejectedCount: number;
  score: number;
  budgetUsedUsd: number;
  reason: string;
};

type LeadSourcingChainData = {
  queries: string[];
  companies: string[];
  websites: string[];
  domains: string[];
  emails: string[];
};

const APIFY_CHAIN_MAX_STEPS = 3;
const APIFY_CHAIN_MAX_CANDIDATES = 6;
const APIFY_CHAIN_MAX_ITEMS_PER_STEP = 200;
const APIFY_CHAIN_EXEC_MAX_CHARGE_USD = Math.max(
  0.25,
  Math.min(5, Number(process.env.PLATFORM_APIFY_CHAIN_EXEC_MAX_CHARGE_USD ?? 1.2) || 1.2)
);
const APIFY_PROBE_BUDGET_USD = Math.max(
  0.5,
  Math.min(5, Number(process.env.PLATFORM_APIFY_PROBE_BUDGET_USD ?? 2) || 2)
);
const APIFY_PROBE_STEP_COST_ESTIMATE_USD = Math.max(
  0.05,
  Math.min(1, Number(process.env.PLATFORM_APIFY_PROBE_STEP_COST_ESTIMATE_USD ?? 0.25) || 0.25)
);
const APIFY_PROBE_MAX_LEADS = Math.max(
  5,
  Math.min(40, Number(process.env.PLATFORM_APIFY_PROBE_MAX_LEADS ?? 15) || 15)
);

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function uniqueTrimmed(values: string[], max = 200) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

function trimText(value: unknown, max = 180) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
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

function parseLooseJsonObject(rawText: string): unknown {
  const direct = rawText.trim();
  if (!direct) return {};
  try {
    return JSON.parse(direct);
  } catch {
    // continue
  }

  const noFence = direct.replace(/```json/gi, "```").replace(/```/g, "").trim();
  if (noFence !== direct) {
    try {
      return JSON.parse(noFence);
    } catch {
      // continue
    }
  }

  const firstBrace = noFence.indexOf("{");
  const lastBrace = noFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = noFence.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
  }

  throw new Error("Model returned non-JSON output");
}

function stageFromValue(value: string): LeadChainStepStage | null {
  if (value === "prospect_discovery") return "prospect_discovery";
  if (value === "website_enrichment") return "website_enrichment";
  if (value === "email_discovery") return "email_discovery";
  return null;
}

function validateLeadChainStageOrder(stageOrder: LeadChainStepStage[]) {
  if (!stageOrder.length) {
    return "Apify chain returned zero stages";
  }
  if (stageOrder.length > APIFY_CHAIN_MAX_STEPS) {
    return `Apify chain returned ${stageOrder.length} steps; max is ${APIFY_CHAIN_MAX_STEPS}`;
  }
  if (stageOrder[stageOrder.length - 1] !== "email_discovery") {
    return "Apify chain must end with email_discovery";
  }
  if (stageOrder.length === 1) {
    return stageOrder[0] === "email_discovery"
      ? ""
      : "Single-step chain must use email_discovery";
  }
  if (stageOrder[0] !== "prospect_discovery") {
    return "Multi-step chain must start with prospect_discovery";
  }
  for (let i = 1; i < stageOrder.length; i += 1) {
    const prev = stageOrder[i - 1];
    const current = stageOrder[i];
    if (prev === "email_discovery") {
      return "Invalid chain order after email_discovery";
    }
    if (prev === "website_enrichment" && current === "prospect_discovery") {
      return "Invalid chain order: website_enrichment -> prospect_discovery";
    }
    if (prev === current) {
      return `Duplicate stage not allowed: ${current}`;
    }
  }
  return "";
}

function isLikelyUrl(value: string) {
  const lower = value.trim().toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("www.");
}

function parseDomainFromUrl(input: string) {
  try {
    const withProto = input.startsWith("http://") || input.startsWith("https://") ? input : `https://${input}`;
    const hostname = new URL(withProto).hostname.replace(/^www\./, "").toLowerCase();
    return hostname;
  } catch {
    return "";
  }
}

function isLikelyDomain(value: string) {
  const v = value.trim().toLowerCase();
  if (!v || v.includes("@") || v.includes(" ")) return false;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v);
}

function collectSignalsFromUnknown(
  value: unknown,
  sink: {
    emails: Set<string>;
    domains: Set<string>;
    websites: Set<string>;
    companies: Set<string>;
    queries: Set<string>;
  },
  contextKey = "",
  depth = 0
) {
  if (depth > 4) return;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return;

    const emailMatches = text.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
    for (const email of emailMatches) {
      if (!getLeadEmailSuppressionReason(email)) sink.emails.add(email);
      const domain = parseDomainFromUrl(email.split("@")[1] ?? "");
      if (domain) sink.domains.add(domain);
    }

    if (isLikelyUrl(text)) {
      const normalized = text.startsWith("http://") || text.startsWith("https://") ? text : `https://${text}`;
      sink.websites.add(normalized);
      const domain = parseDomainFromUrl(normalized);
      if (domain) sink.domains.add(domain);
    } else if (isLikelyDomain(text)) {
      sink.domains.add(text.toLowerCase());
      sink.websites.add(`https://${text.toLowerCase()}`);
    }

    if (contextKey && /(company|organization|org|brand|seller|store|business|name)/i.test(contextKey)) {
      sink.companies.add(text.slice(0, 140));
      sink.queries.add(text.slice(0, 140));
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectSignalsFromUnknown(item, sink, contextKey, depth + 1);
    return;
  }

  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    for (const [key, entry] of Object.entries(row)) {
      collectSignalsFromUnknown(entry, sink, key, depth + 1);
    }
  }
}

function mergeChainData(base: LeadSourcingChainData, rows: unknown[]): LeadSourcingChainData {
  const sink = {
    emails: new Set(base.emails.map((item) => item.toLowerCase())),
    domains: new Set(base.domains.map((item) => item.toLowerCase())),
    websites: new Set(base.websites),
    companies: new Set(base.companies),
    queries: new Set(base.queries),
  };

  for (const row of rows) {
    collectSignalsFromUnknown(row, sink);
  }

  return {
    queries: uniqueTrimmed(Array.from(sink.queries), 120),
    companies: uniqueTrimmed(Array.from(sink.companies), 120),
    websites: uniqueTrimmed(Array.from(sink.websites), 200),
    domains: uniqueTrimmed(Array.from(sink.domains), 200).map((item) => item.toLowerCase()),
    emails: uniqueTrimmed(Array.from(sink.emails), 400).map((item) => item.toLowerCase()),
  };
}

function stageFromActor(actor: ApifyStoreActor): LeadChainStepStage {
  const blob = `${actor.title} ${actor.description} ${actor.categories.join(" ")}`.toLowerCase();
  if (/(email|mailbox|contact\s+email|email\s+finder|hunter)/.test(blob)) return "email_discovery";
  if (/(website|domain|company\s+site|url|crawler|crawl|web\s+scrap)/.test(blob)) return "website_enrichment";
  return "prospect_discovery";
}

function actorScore(actor: ApifyStoreActor) {
  return actor.users30Days * 1.2 + actor.rating * 40;
}

type ActorDiscoveryQueryPlan = {
  prospectQueries: string[];
  websiteQueries: string[];
  emailQueries: string[];
};

type ActorQueryPlanMode = "openai";

const APIFY_STORE_SEARCH_LIMIT = 40;
const APIFY_STORE_MAX_QUERIES_PER_STAGE = 8;
const APIFY_STORE_MAX_RESULTS = 160;

async function planActorDiscoveryQueries(input: {
  targetAudience: string;
  offer: string;
  brandName: string;
  brandWebsite: string;
  experimentName: string;
}): Promise<{ mode: ActorQueryPlanMode; plan: ActorDiscoveryQueryPlan }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing for actor discovery planning");
  }

  const prompt = [
    "You plan discovery queries to search the Apify Actor Store for lead-sourcing pipelines.",
    "Goal: high recall + high relevance across all potential actors (single-step or multi-step chains).",
    "Return distinct searches for three stages: prospect_discovery, website_enrichment, email_discovery.",
    "Use concrete query terms a human would search in a marketplace.",
    "Include keyword variants that can surface actors tied to data sources (for example LinkedIn, Crunchbase, Apollo, websites, domains, email finding), when relevant.",
    "No placeholders. No generic buzzwords.",
    "",
    "Return strict JSON only:",
    '{ "prospectQueries": string[], "websiteQueries": string[], "emailQueries": string[] }',
    `Context: ${JSON.stringify({
      targetAudience: input.targetAudience,
      offer: input.offer,
      brandName: input.brandName,
      brandWebsite: input.brandWebsite,
      experimentName: input.experimentName,
    })}`,
  ].join("\n");

  const model = resolveLlmModel("lead_actor_query_planning", { prompt });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: 1800,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Actor discovery query planning failed: HTTP ${response.status} ${raw.slice(0, 240)}`);
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }

  const parsed = parseLooseJsonObject(extractOutputText(payload));

  const row = asRecord(parsed);
  const queriesRoot = asRecord(row.queries);
  const strictQueryList = (value: unknown, label: string) => {
    const fromValue = Array.isArray(value)
      ? value.map((entry) => trimText(entry, 120))
      : typeof value === "string"
        ? value
            .split("\n")
            .map((entry) => trimText(entry, 120))
        : [];
    const cleaned = uniqueTrimmed(fromValue, APIFY_STORE_MAX_QUERIES_PER_STAGE);
    if (!cleaned.length) {
      throw new Error(`Actor discovery planning returned no ${label} queries`);
    }
    return cleaned;
  };
  const plan: ActorDiscoveryQueryPlan = {
    prospectQueries: strictQueryList(
      row.prospectQueries ?? queriesRoot.prospectQueries ?? queriesRoot.prospect,
      "prospect"
    ),
    websiteQueries: strictQueryList(
      row.websiteQueries ?? queriesRoot.websiteQueries ?? queriesRoot.website,
      "website"
    ),
    emailQueries: strictQueryList(
      row.emailQueries ?? queriesRoot.emailQueries ?? queriesRoot.email,
      "email"
    ),
  };

  return { mode: "openai", plan };
}

function actorCandidateScore(input: {
  actor: ApifyStoreActor;
  matchedQueries: number;
  requestedStages: number;
}) {
  const stageHint = stageFromActor(input.actor);
  const stageBoost = stageHint === "email_discovery" ? 22 : stageHint === "prospect_discovery" ? 14 : 10;
  const pricingModel = String(input.actor.pricingModel ?? "").toUpperCase();
  const monthlyPenalty =
    pricingModel.includes("FLAT_PRICE_PER_MONTH") || pricingModel.includes("SUBSCRIPTION") ? 60 : 0;
  const expensiveRunPenalty = input.actor.pricePerUnitUsd > 2 ? Math.min(40, input.actor.pricePerUnitUsd * 6) : 0;
  const freeTrialBoost = input.actor.trialMinutes > 0 ? 8 : 0;
  return (
    actorScore(input.actor) +
    input.matchedQueries * 6 +
    input.requestedStages * 15 +
    stageBoost +
    freeTrialBoost -
    monthlyPenalty -
    expensiveRunPenalty
  );
}

async function buildApifyActorPool(input: {
  targetAudience: string;
  offer: string;
  brandName: string;
  brandWebsite: string;
  experimentName: string;
}) {
  const queryPlanResult = await planActorDiscoveryQueries({
    targetAudience: input.targetAudience,
    offer: input.offer,
    brandName: input.brandName,
    brandWebsite: input.brandWebsite,
    experimentName: input.experimentName,
  });
  const stageQueries: Array<{ stage: LeadChainStepStage; queries: string[] }> = [
    { stage: "prospect_discovery", queries: queryPlanResult.plan.prospectQueries },
    { stage: "website_enrichment", queries: queryPlanResult.plan.websiteQueries },
    { stage: "email_discovery", queries: queryPlanResult.plan.emailQueries },
  ];

  const pooled = new Map<
    string,
    {
      actor: ApifyStoreActor;
      matchedQueryKeys: Set<string>;
      requestedStages: Set<LeadChainStepStage>;
    }
  >();
  const searchDiagnostics: Array<Record<string, unknown>> = [];

  for (const stageQuerySet of stageQueries) {
    const queries = stageQuerySet.queries.slice(0, APIFY_STORE_MAX_QUERIES_PER_STAGE);
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
      const query = queries[queryIndex];
      const offsets = [0];
      if (queryIndex < 3) {
        offsets.push(APIFY_STORE_SEARCH_LIMIT);
      }

      for (const offset of offsets) {
        const search = await searchApifyStoreActors({
          query,
          limit: APIFY_STORE_SEARCH_LIMIT,
          offset,
        });
        searchDiagnostics.push({
          stage: stageQuerySet.stage,
          query,
          offset,
          ok: search.ok,
          total: search.total,
          count: search.actors.length,
          error: search.error,
        });
        if (!search.ok) break;

        for (const actor of search.actors) {
          if (!actor.actorId) continue;
          const existing = pooled.get(actor.actorId);
          if (!existing) {
            pooled.set(actor.actorId, {
              actor,
              matchedQueryKeys: new Set([`${stageQuerySet.stage}:${query.toLowerCase()}`]),
              requestedStages: new Set([stageQuerySet.stage]),
            });
            continue;
          }
          if (actorScore(actor) > actorScore(existing.actor)) {
            existing.actor = actor;
          }
          existing.matchedQueryKeys.add(`${stageQuerySet.stage}:${query.toLowerCase()}`);
          existing.requestedStages.add(stageQuerySet.stage);
        }

        if (search.actors.length < APIFY_STORE_SEARCH_LIMIT) {
          break;
        }
      }
    }
  }

  const ranked = Array.from(pooled.values())
    .map((entry) => ({
      actor: entry.actor,
      stageHint: stageFromActor(entry.actor),
      score: actorCandidateScore({
        actor: entry.actor,
        matchedQueries: entry.matchedQueryKeys.size,
        requestedStages: entry.requestedStages.size,
      }),
    }))
    .sort((a, b) => b.score - a.score);

  const pricingSafeRanked = ranked.filter((row) => {
    const pricingModel = String(row.actor.pricingModel ?? "").toUpperCase();
    return !pricingModel.includes("FLAT_PRICE_PER_MONTH") && !pricingModel.includes("SUBSCRIPTION");
  });
  const rankingPool = pricingSafeRanked.length ? pricingSafeRanked : ranked;

  const selected = new Set<string>();
  for (const stage of ["prospect_discovery", "website_enrichment", "email_discovery"] as const) {
    const stageTop = rankingPool.filter((row) => row.stageHint === stage).slice(0, 22);
    for (const row of stageTop) {
      selected.add(row.actor.actorId);
      if (selected.size >= APIFY_STORE_MAX_RESULTS) break;
    }
    if (selected.size >= APIFY_STORE_MAX_RESULTS) break;
  }
  for (const row of rankingPool) {
    if (selected.size >= APIFY_STORE_MAX_RESULTS) break;
    selected.add(row.actor.actorId);
  }

  const actors = rankingPool
    .filter((row) => selected.has(row.actor.actorId))
    .map((row) => row.actor)
    .slice(0, APIFY_STORE_MAX_RESULTS);

  return {
    actors,
    searchDiagnostics,
    queryPlanMode: queryPlanResult.mode,
    queryPlan: queryPlanResult.plan,
  };
}

function parseLeadChainPlanCandidate(input: {
  raw: unknown;
  allowedActorIds: Set<string>;
  fallbackId: string;
}) {
  const row = asRecord(input.raw);
  const strategy = trimText(row.strategy, 200) || "actor_chain";
  const rationale = trimText(row.rationale, 360);
  const stepsRaw = Array.isArray(row.steps) ? row.steps : [];
  const steps: LeadSourcingChainStep[] = [];
  const seenIds = new Set<string>();

  for (let index = 0; index < stepsRaw.length; index += 1) {
    const stepRow = asRecord(stepsRaw[index]);
    const stage = stageFromValue(String(stepRow.stage ?? "").trim().toLowerCase());
    if (!stage) continue;
    const actorId = String(stepRow.actorId ?? "").trim();
    if (!actorId || !input.allowedActorIds.has(actorId.toLowerCase())) continue;
    const id = trimText(stepRow.id || `${stage}_${index + 1}`, 60).replace(/\s+/g, "_");
    if (!id || seenIds.has(id.toLowerCase())) continue;
    seenIds.add(id.toLowerCase());
    steps.push({
      id,
      stage,
      purpose: trimText(stepRow.purpose, 180),
      actorId,
      queryHint: trimText(stepRow.queryHint, 200),
    });
  }

  const stageOrder = steps.map((step) => step.stage);
  const stageOrderError = validateLeadChainStageOrder(stageOrder);
  if (stageOrderError) return null;
  if (!steps.length) return null;

  return {
    id: trimText(row.id || input.fallbackId, 80).replace(/\s+/g, "_"),
    strategy,
    rationale,
    steps: steps.slice(0, APIFY_CHAIN_MAX_STEPS),
  } satisfies LeadSourcingChainPlan;
}

async function planApifyLeadChainCandidates(input: {
  targetAudience: string;
  brandName: string;
  brandWebsite: string;
  experimentName: string;
  offer: string;
  actorPool: ApifyStoreActor[];
  maxCandidates?: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }
  if (!input.actorPool.length) {
    throw new Error("No actor candidates available from Apify Store");
  }

  const actorRows = input.actorPool.map((actor) => ({
    actorId: actor.actorId,
    title: actor.title,
    description: actor.description,
    categories: actor.categories,
    users30Days: actor.users30Days,
    stageHint: stageFromActor(actor),
  }));

  const maxCandidates = Math.max(2, Math.min(APIFY_CHAIN_MAX_CANDIDATES, Number(input.maxCandidates ?? 4) || 4));
  const prompt = [
    "You plan an Apify actor chain for B2B outreach lead sourcing.",
    "Goal: produce multiple high-quality 1-3 step chains that can source real people + business emails for the provided target audience.",
    "Rules:",
    "- Use only actorIds from actorPool.",
    "- Valid stage orders are:",
    "  1) email_discovery (single-step actor that already returns people + emails),",
    "  2) prospect_discovery -> email_discovery,",
    "  3) prospect_discovery -> website_enrichment -> email_discovery.",
    "- Final step must be email_discovery.",
    "- Do NOT include backup actors.",
    `- Return ${maxCandidates} distinct chain candidates with varied strategy.`,
    "- queryHint must be concrete and directly relevant to the experiment.",
    "- No placeholders or generic buzzword text.",
    "",
    "Return JSON only:",
    '{ "candidates": [{ "id": string, "strategy": string, "rationale": string, "steps": [{ "id": string, "stage": "prospect_discovery"|"website_enrichment"|"email_discovery", "purpose": string, "actorId": string, "queryHint": string }] }] }',
    `Context: ${JSON.stringify({
      targetAudience: input.targetAudience,
      brandName: input.brandName,
      brandWebsite: input.brandWebsite,
      experimentName: input.experimentName,
      offer: input.offer,
    })}`,
    `actorPool: ${JSON.stringify(actorRows)}`,
  ].join("\n");

  const model = resolveLlmModel("lead_chain_planning", { prompt });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: 2600,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Apify chain planning failed: HTTP ${response.status} ${raw.slice(0, 240)}`);
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  const outputText = extractOutputText(payload);
  let parsed: unknown;
  try {
    parsed = parseLooseJsonObject(outputText);
  } catch (error) {
    throw new Error(
      `Apify chain planning returned non-JSON output: ${
        error instanceof Error ? error.message : "invalid_json"
      }`
    );
  }

  const root = asRecord(parsed);
  const candidatesRaw =
    Array.isArray(root.candidates) && root.candidates.length
      ? root.candidates
      : Array.isArray(root.chains)
        ? root.chains
        : [];
  const allowedActorIds = new Set(input.actorPool.map((actor) => actor.actorId.toLowerCase()));
  const parsedCandidates = candidatesRaw
    .map((row, index) =>
      parseLeadChainPlanCandidate({
        raw: row,
        allowedActorIds,
        fallbackId: `candidate_${index + 1}`,
      })
    )
    .filter((row): row is LeadSourcingChainPlan => Boolean(row));

  if (!parsedCandidates.length) {
    throw new Error("Chain planning produced no valid candidates");
  }

  const deduped = [] as LeadSourcingChainPlan[];
  const seenKeys = new Set<string>();
  for (const candidate of parsedCandidates) {
    const key = candidate.steps
      .map((step) => `${step.stage}:${step.actorId.toLowerCase()}`)
      .join("->");
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(candidate);
    if (deduped.length >= APIFY_CHAIN_MAX_CANDIDATES) break;
  }

  if (!deduped.length) {
    throw new Error("Chain planning candidates were duplicates/invalid");
  }
  return deduped;
}

function buildChainStepInput(input: {
  step: LeadSourcingChainStep;
  chainData: LeadSourcingChainData;
  targetAudience: string;
  maxLeads: number;
  probeMode?: boolean;
}) {
  const querySeed = uniqueTrimmed(
    [input.step.queryHint, ...input.chainData.queries, ...input.chainData.companies, input.targetAudience],
    30
  );
  const domains = uniqueTrimmed(input.chainData.domains, 100).map((item) => item.toLowerCase());
  const websites = uniqueTrimmed(
    [
      ...input.chainData.websites,
      ...domains.map((domain) => `https://${domain}`),
    ],
    120
  );

  const itemCap = input.probeMode
    ? Math.max(5, Math.min(APIFY_PROBE_MAX_LEADS, input.maxLeads))
    : Math.max(20, Math.min(APIFY_CHAIN_MAX_ITEMS_PER_STEP, input.maxLeads));
  const base = {
    maxItems: itemCap,
    limit: itemCap,
    maxResults: itemCap,
    maxRequestsPerCrawl: input.probeMode ? 20 : 60,
    maxConcurrency: input.probeMode ? 4 : 8,
    maxDepth: input.probeMode ? 1 : 2,
    includeSubdomains: false,
  };

  if (input.step.stage === "prospect_discovery") {
    return {
      ...base,
      query: querySeed[0] ?? input.targetAudience,
      queries: querySeed,
      search: querySeed[0] ?? input.targetAudience,
      searchTerms: querySeed,
      searchStringsArray: querySeed,
      keyword: querySeed[0] ?? input.targetAudience,
      keywords: querySeed,
      phrases: querySeed,
    } satisfies Record<string, unknown>;
  }

  if (input.step.stage === "website_enrichment") {
    return {
      ...base,
      query: querySeed[0] ?? input.targetAudience,
      queries: querySeed,
      companies: input.chainData.companies.slice(0, 80),
      companyNames: input.chainData.companies.slice(0, 80),
      websites,
      urls: websites,
      domains,
      domainNames: domains,
      startUrls: websites.slice(0, 60).map((url) => ({ url })),
    } satisfies Record<string, unknown>;
  }

  return {
    ...base,
    query: querySeed[0] ?? input.targetAudience,
    queries: querySeed,
    websites,
    urls: websites,
    domains,
    domainNames: domains,
    startUrls: websites.slice(0, 80).map((url) => ({ url })),
    emails: input.chainData.emails.slice(0, 150),
  } satisfies Record<string, unknown>;
}

function getSchemaProperties(schema: Record<string, unknown>) {
  if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
    return schema.properties as Record<string, unknown>;
  }
  return {};
}

function getSchemaTypes(propertySchema: Record<string, unknown>) {
  const raw = propertySchema.type;
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return [raw.trim().toLowerCase()];
  }
  return [];
}

function firstString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = firstString(item);
      if (resolved) return resolved;
    }
    return "";
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (typeof row.url === "string" && row.url.trim()) return row.url.trim();
    if (typeof row.value === "string" && row.value.trim()) return row.value.trim();
    return "";
  }
  return "";
}

function toStringArray(value: unknown) {
  const out: string[] = [];
  const push = (entry: unknown) => {
    const resolved = firstString(entry);
    if (resolved) out.push(resolved);
  };
  if (Array.isArray(value)) {
    for (const item of value) push(item);
  } else {
    push(value);
  }
  return uniqueTrimmed(out, 200);
}

function fallbackValueForSchemaKey(input: {
  key: string;
  actorInput: Record<string, unknown>;
  stage: LeadChainStepStage;
}) {
  const keyLower = input.key.toLowerCase();
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      if (input.actorInput[key] !== undefined) return input.actorInput[key];
    }
    return undefined;
  };

  if (keyLower.includes("query") || keyLower.includes("search") || keyLower.includes("keyword")) {
    return pick("query", "queries", "search", "searchTerms", "searchStringsArray", "keyword", "keywords", "phrases");
  }
  if (keyLower.includes("domain")) {
    return pick("domains", "domainNames", "websites", "urls");
  }
  if (keyLower.includes("url") || keyLower.includes("site") || keyLower.includes("web")) {
    return pick("startUrls", "urls", "websites", "domains");
  }
  if (keyLower.includes("email") || keyLower.includes("mail")) {
    return pick("emails");
  }
  if (keyLower.includes("compan")) {
    return pick("companies", "companyNames", "query", "queries");
  }
  if (input.stage === "prospect_discovery") {
    return pick("query", "queries", "searchTerms");
  }
  if (input.stage === "website_enrichment") {
    return pick("websites", "urls", "domains", "startUrls", "query");
  }
  return pick("emails", "domains", "websites", "query");
}

function normalizeActorInputForSchema(input: {
  actorProfile: { inputSchema: Record<string, unknown>; requiredKeys: string[]; knownKeys: string[] };
  actorInput: Record<string, unknown>;
  stage: LeadChainStepStage;
}) {
  const schema = input.actorProfile.inputSchema;
  const properties = getSchemaProperties(schema);
  const knownKeys = input.actorProfile.knownKeys;
  const requiredKeys = input.actorProfile.requiredKeys;
  // Prefer strict known-key input when schema keys are available; this avoids
  // "Property input.X is not allowed" failures on actors that enforce closed schemas.
  const restrictUnknown = knownKeys.length > 0;
  const keysToProcess = new Set<string>([
    ...Object.keys(input.actorInput),
    ...knownKeys,
    ...requiredKeys,
  ]);
  const normalized: Record<string, unknown> = {};
  const adjustments: Array<Record<string, unknown>> = [];

  for (const key of keysToProcess) {
    if (!key) continue;
    if (restrictUnknown && !knownKeys.some((known) => known.toLowerCase() === key.toLowerCase())) {
      continue;
    }

    const propertySchema =
      properties[key] && typeof properties[key] === "object" && !Array.isArray(properties[key])
        ? (properties[key] as Record<string, unknown>)
        : {};
    const types = getSchemaTypes(propertySchema);
    const hadRaw = Object.prototype.hasOwnProperty.call(input.actorInput, key);
    const rawValue =
      hadRaw ? input.actorInput[key] : fallbackValueForSchemaKey({ key, actorInput: input.actorInput, stage: input.stage });
    if (rawValue === undefined || rawValue === null) continue;

    let nextValue: unknown = rawValue;
    if (types.includes("string")) {
      nextValue = firstString(rawValue);
    } else if (types.includes("array")) {
      const values = toStringArray(rawValue);
      const itemsSchema =
        propertySchema.items && typeof propertySchema.items === "object" && !Array.isArray(propertySchema.items)
          ? (propertySchema.items as Record<string, unknown>)
          : {};
      const itemTypes = getSchemaTypes(itemsSchema);
      if (itemTypes.includes("object") || key.toLowerCase().includes("starturl")) {
        nextValue = values.map((value) => ({ url: value }));
      } else {
        nextValue = values;
      }
    } else if (types.includes("number") || types.includes("integer")) {
      const numeric = Number(firstString(rawValue));
      if (Number.isFinite(numeric)) {
        nextValue = types.includes("integer") ? Math.round(numeric) : numeric;
      } else {
        continue;
      }
    } else if (types.includes("boolean")) {
      const value = firstString(rawValue).toLowerCase();
      nextValue = ["1", "true", "yes", "on"].includes(value);
    } else if (types.includes("object")) {
      if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
        nextValue = rawValue;
      } else {
        const asString = firstString(rawValue);
        if (!asString) continue;
        nextValue = { value: asString };
      }
    }

    if (typeof nextValue === "string" && !nextValue.trim()) continue;
    if (Array.isArray(nextValue) && !nextValue.length) continue;
    normalized[key] = nextValue;

    if (nextValue !== rawValue || !hadRaw) {
      adjustments.push({
        key,
        fromFallback: !hadRaw,
        fromType: Array.isArray(rawValue) ? "array" : typeof rawValue,
        toType: Array.isArray(nextValue) ? "array" : typeof nextValue,
      });
    }
  }

  return {
    input: normalized,
    adjustments,
  };
}

function parseApifyInputFieldError(errorText: string) {
  const normalized = String(errorText ?? "");
  const fieldMatch = normalized.match(
    /Field input\.([a-zA-Z0-9_.]+)\s+(must be|is required|required)(?:\s+([a-zA-Z_]+))?/i
  );
  if (fieldMatch) {
    const fieldPath = String(fieldMatch[1] ?? "").trim();
    const predicate = String(fieldMatch[2] ?? "").trim().toLowerCase();
    const expectedType = String(fieldMatch[3] ?? "").trim().toLowerCase();
    const key = fieldPath.split(".")[0]?.trim() ?? "";
    if (!key) return null;
    return { key, fieldPath, predicate, expectedType };
  }

  const notAllowedMatch = normalized.match(/Property input\.([a-zA-Z0-9_.]+)\s+is not allowed/i);
  if (notAllowedMatch) {
    const fieldPath = String(notAllowedMatch[1] ?? "").trim();
    const key = fieldPath.split(".")[0]?.trim() ?? "";
    if (!key) return null;
    return {
      key,
      fieldPath,
      predicate: "not_allowed",
      expectedType: "",
    };
  }

  return null;
}

function coerceValueToExpectedType(input: { value: unknown; expectedType: string; key: string }) {
  const type = input.expectedType.toLowerCase();
  if (type === "string") return firstString(input.value);
  if (type === "array") return toStringArray(input.value);
  if (type === "number") {
    const value = Number(firstString(input.value));
    return Number.isFinite(value) ? value : undefined;
  }
  if (type === "integer") {
    const value = Number(firstString(input.value));
    return Number.isFinite(value) ? Math.round(value) : undefined;
  }
  if (type === "boolean") {
    return ["1", "true", "yes", "on"].includes(firstString(input.value).toLowerCase());
  }
  if (type === "object") {
    if (input.value && typeof input.value === "object" && !Array.isArray(input.value)) return input.value;
    const str = firstString(input.value);
    if (!str) return undefined;
    if (input.key.toLowerCase().includes("url")) return { url: str };
    return { value: str };
  }
  return input.value;
}

function repairActorInputFromProviderError(input: {
  actorInput: Record<string, unknown>;
  errorText: string;
  stage: LeadChainStepStage;
}) {
  const parsed = parseApifyInputFieldError(input.errorText);
  if (!parsed) return { repaired: false, actorInput: input.actorInput, reason: "unparsed_error" };

  const next = { ...input.actorInput };
  if (parsed.predicate === "not_allowed") {
    if (!Object.prototype.hasOwnProperty.call(next, parsed.key)) {
      return { repaired: false, actorInput: input.actorInput, reason: `not_allowed_missing_key:${parsed.key}` };
    }
    delete next[parsed.key];
    return { repaired: true, actorInput: next, reason: `removed_not_allowed:${parsed.key}` };
  }

  const currentValue = next[parsed.key];
  const fallbackValue = fallbackValueForSchemaKey({
    key: parsed.key,
    actorInput: input.actorInput,
    stage: input.stage,
  });
  const sourceValue = currentValue ?? fallbackValue;

  if (parsed.predicate.includes("required")) {
    if (sourceValue === undefined || sourceValue === null || (typeof sourceValue === "string" && !sourceValue.trim())) {
      return { repaired: false, actorInput: input.actorInput, reason: `missing_required:${parsed.key}` };
    }
    if (Array.isArray(sourceValue) && !sourceValue.length) {
      return { repaired: false, actorInput: input.actorInput, reason: `missing_required:${parsed.key}` };
    }
    let requiredValue: unknown = sourceValue;
    if (parsed.expectedType) {
      const coerced = coerceValueToExpectedType({
        value: sourceValue,
        expectedType: parsed.expectedType,
        key: parsed.key,
      });
      if (coerced !== undefined && coerced !== null && (!(typeof coerced === "string") || coerced.trim())) {
        requiredValue = coerced;
      }
    } else if (Array.isArray(sourceValue) && !/s$/i.test(parsed.key)) {
      const first = firstString(sourceValue);
      if (!first) {
        return { repaired: false, actorInput: input.actorInput, reason: `required_no_scalar:${parsed.key}` };
      }
      requiredValue = first;
    }

    next[parsed.key] = requiredValue;
    return { repaired: true, actorInput: next, reason: `filled_required:${parsed.key}` };
  }

  if (parsed.predicate.includes("must be")) {
    const coerced = coerceValueToExpectedType({
      value: sourceValue,
      expectedType: parsed.expectedType,
      key: parsed.key,
    });
    if (coerced === undefined || coerced === null) {
      return {
        repaired: false,
        actorInput: input.actorInput,
        reason: `coercion_failed:${parsed.key}:${parsed.expectedType || "unknown"}`,
      };
    }
    if (typeof coerced === "string" && !coerced.trim()) {
      return {
        repaired: false,
        actorInput: input.actorInput,
        reason: `coercion_empty_string:${parsed.key}`,
      };
    }
    if (Array.isArray(coerced) && !coerced.length) {
      return {
        repaired: false,
        actorInput: input.actorInput,
        reason: `coercion_empty_array:${parsed.key}`,
      };
    }
    next[parsed.key] = coerced;
    return {
      repaired: true,
      actorInput: next,
      reason: `coerced:${parsed.key}:${parsed.expectedType || "unknown"}`,
    };
  }

  return { repaired: false, actorInput: input.actorInput, reason: "unsupported_predicate" };
}

function isApifyQuotaExceededErrorText(text: unknown) {
  const normalized = String(text ?? "").toLowerCase();
  return (
    normalized.includes("platform-feature-disabled") ||
    normalized.includes("monthly usage hard limit exceeded") ||
    normalized.includes("usage hard limit exceeded")
  );
}

function hashProbeInput(input: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function summarizeTopReasons(rejected: LeadAcceptanceDecision[], max = 5) {
  const counts = new Map<string, number>();
  for (const row of rejected) {
    const key = row.reason || "rejected";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([reason, count]) => ({ reason, count }));
}

function buildProbeMemoryUpdates(candidates: ProbedSourcingPlan[]) {
  const bucket = new Map<
    string,
    { actorId: string; successDelta: number; failDelta: number; compatibilityFailDelta: number; qualitySamples: number[] }
  >();

  for (const candidate of candidates) {
    const denominator = candidate.acceptedCount + candidate.rejectedCount;
    const candidateQuality = denominator > 0 ? candidate.acceptedCount / denominator : 0;
    for (const probe of candidate.probeResults) {
      const actorId = probe.actorId;
      if (!actorId) continue;
      const current =
        bucket.get(actorId.toLowerCase()) ??
        {
          actorId,
          successDelta: 0,
          failDelta: 0,
          compatibilityFailDelta: 0,
          qualitySamples: [],
        };
      if (probe.outcome === "pass") current.successDelta += 1;
      else current.failDelta += 1;

      const reasonBlob = JSON.stringify(probe.details ?? {}).toLowerCase();
      if (reasonBlob.includes("incompatible_actor_input") || reasonBlob.includes("missing required input keys")) {
        current.compatibilityFailDelta += 1;
      }
      if (probe.stage === "email_discovery" && probe.outcome === "pass" && denominator > 0) {
        current.qualitySamples.push(candidateQuality);
      }
      bucket.set(actorId.toLowerCase(), current);
    }
  }

  return Array.from(bucket.values()).map((row) => ({
    actorId: row.actorId,
    successDelta: row.successDelta,
    failDelta: row.failDelta,
    compatibilityFailDelta: row.compatibilityFailDelta,
    qualitySample:
      row.qualitySamples.length > 0
        ? row.qualitySamples.reduce((sum, value) => sum + value, 0) / row.qualitySamples.length
        : 0,
  }));
}

async function generateAdaptiveLeadQualityPolicy(input: {
  brandName: string;
  brandWebsite: string;
  targetAudience: string;
  offer: string;
  experimentName: string;
}): Promise<LeadQualityPolicy> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing for adaptive lead quality policy");
  }

  const prompt = [
    "Generate a strict B2B lead quality policy for outbound outreach.",
    "Optimize for quality over quantity. Return JSON only.",
    "Policy fields:",
    "- allowFreeDomains (boolean)",
    "- allowRoleInboxes (boolean)",
    "- requirePersonName (boolean)",
    "- requireCompany (boolean)",
    "- requireTitle (boolean)",
    "- minConfidenceScore (number 0..1)",
    "Rules:",
    "- default to rejecting low-signal generic emails when unsure.",
    "- minConfidenceScore should usually be between 0.55 and 0.9.",
    `Context: ${JSON.stringify(input)}`,
  ].join("\n");

  const model = resolveLlmModel("lead_quality_policy", { prompt });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: 900,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Lead quality policy generation failed: HTTP ${response.status} ${raw.slice(0, 240)}`);
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  const parsed = parseLooseJsonObject(extractOutputText(payload));

  const row = asRecord(parsed);
  const policy: LeadQualityPolicy = {
    allowFreeDomains: Boolean(row.allowFreeDomains ?? false),
    allowRoleInboxes: Boolean(row.allowRoleInboxes ?? false),
    requirePersonName: Boolean(row.requirePersonName ?? true),
    requireCompany: Boolean(row.requireCompany ?? true),
    requireTitle: Boolean(row.requireTitle ?? false),
    minConfidenceScore: Math.max(0, Math.min(1, Number(row.minConfidenceScore ?? 0.65) || 0.65)),
  };
  return policy;
}

function normalizeSourcingChainSteps(steps: LeadSourcingChainStep[]): SourcingChainStep[] {
  return steps.map((step) => ({
    id: step.id,
    stage: step.stage,
    actorId: step.actorId,
    purpose: step.purpose,
    queryHint: step.queryHint,
  }));
}

async function selectBestProbedChain(input: {
  targetAudience: string;
  offer: string;
  candidates: ProbedSourcingPlan[];
}): Promise<{ selectedPlanId: string; rationale: string }> {
  const viable = input.candidates.filter((row) => row.acceptedCount > 0 && row.reason === "");
  if (!viable.length) {
    throw new Error("No viable probed chain candidates with accepted leads");
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing for chain selection");
  }

  const prompt = [
    "Choose the best lead-sourcing chain candidate for launch.",
    "Optimize for lead quality first, then deliverability safety, then volume.",
    "Return strict JSON only: { selectedPlanId: string, rationale: string }",
    `Context: ${JSON.stringify({
      targetAudience: input.targetAudience,
      offer: input.offer,
      candidates: viable.map((row) => ({
        planId: row.plan.id,
        strategy: row.plan.strategy,
        rationale: row.plan.rationale,
        steps: row.plan.steps,
        acceptedCount: row.acceptedCount,
        rejectedCount: row.rejectedCount,
        score: row.score,
        reason: row.reason,
      })),
    })}`,
  ].join("\n");

  const model = resolveLlmModel("lead_chain_selection", { prompt });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      text: { format: { type: "json_object" } },
      max_output_tokens: 800,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Chain selection failed: HTTP ${response.status} ${raw.slice(0, 220)}`);
  }
  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  const parsed = parseLooseJsonObject(extractOutputText(payload));
  const row = asRecord(parsed);
  const selectedPlanId = String(row.selectedPlanId ?? "").trim();
  const rationale = trimText(row.rationale, 400);
  if (!selectedPlanId) {
    throw new Error("Chain selection returned empty selectedPlanId");
  }
  if (!viable.some((candidate) => candidate.plan.id === selectedPlanId)) {
    throw new Error("Chain selection returned unknown candidate id");
  }
  return { selectedPlanId, rationale };
}

async function fetchActorProfiles(
  actorIds: string[],
  token: string
): Promise<Map<string, ActorCapabilityProfile>> {
  const uniqueActorIds = uniqueTrimmed(actorIds, 300);
  if (!uniqueActorIds.length) return new Map();

  const rows: ActorCapabilityProfile[] = [];
  for (const actorId of uniqueActorIds) {
    const detail = await fetchApifyActorSchemaProfile({ actorId, token });
    if (!detail.ok || !detail.profile) continue;
    const profile: ActorCapabilityProfile = {
      actorId: detail.profile.actorId,
      stageHints: [],
      schemaSummary: {
        requiredKeys: detail.profile.requiredKeys,
        knownKeys: detail.profile.knownKeys,
      },
      compatibilityScore: 0,
      lastSeenMetadata: {
        title: detail.profile.title,
        description: detail.profile.description,
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    rows.push(profile);
  }

  if (rows.length) {
    await upsertSourcingActorProfiles(rows);
  }
  return new Map(rows.map((row) => [row.actorId, row]));
}

type ActorSchemaProfileCache = Map<string, Awaited<ReturnType<typeof fetchApifyActorSchemaProfile>>>;

async function getActorSchemaProfileCached(input: {
  cache: ActorSchemaProfileCache;
  actorId: string;
  token: string;
}) {
  const key = input.actorId.toLowerCase();
  const existing = input.cache.get(key);
  if (existing) return existing;
  const fetched = await fetchApifyActorSchemaProfile({ actorId: input.actorId, token: input.token });
  input.cache.set(key, fetched);
  return fetched;
}

function rankActorPoolWithMemory(input: {
  actors: ApifyStoreActor[];
  memoryRows: Awaited<ReturnType<typeof getSourcingActorMemory>>;
}) {
  const memoryById = new Map(input.memoryRows.map((row) => [row.actorId.toLowerCase(), row]));
  const filtered = [...input.actors].filter((actor) => {
    const memory = memoryById.get(actor.actorId.toLowerCase());
    if (!memory) return true;
    const hardFailing = memory.failCount >= 3 && memory.successCount === 0;
    const veryLowQuality = memory.avgQuality <= 0.05 && memory.leadsAccepted === 0 && memory.failCount >= 2;
    return !(hardFailing || veryLowQuality);
  });
  const rankingPool = filtered.length ? filtered : [...input.actors];

  return rankingPool.sort((a, b) => {
    const scoreA = actorScore(a);
    const scoreB = actorScore(b);
    const memoryA = memoryById.get(a.actorId.toLowerCase());
    const memoryB = memoryById.get(b.actorId.toLowerCase());
    const adjustedA =
      scoreA +
      (memoryA
        ? memoryA.successCount * 5 +
          memoryA.avgQuality * 30 -
          memoryA.failCount * 8 -
          memoryA.compatibilityFailCount * 12
        : 0);
    const adjustedB =
      scoreB +
      (memoryB
        ? memoryB.successCount * 5 +
          memoryB.avgQuality * 30 -
          memoryB.failCount * 8 -
          memoryB.compatibilityFailCount * 12
        : 0);
    return adjustedB - adjustedA;
  });
}

async function probeSourcingPlanCandidate(input: {
  plan: LeadSourcingChainPlan;
  targetAudience: string;
  token: string;
  qualityPolicy: LeadQualityPolicy;
  remainingBudgetUsd: number;
  actorSchemaCache: ActorSchemaProfileCache;
}): Promise<ProbedSourcingPlan> {
  let budgetUsedUsd = 0;
  let chainData: LeadSourcingChainData = {
    queries: uniqueTrimmed([input.targetAudience], 120),
    companies: [],
    websites: [],
    domains: [],
    emails: [],
  };
  const acceptedLeads: ApifyLead[] = [];
  const rejectedLeads: LeadAcceptanceDecision[] = [];
  const probeResults: ProbedSourcingPlan["probeResults"] = [];
  let reason = "";

  for (let stepIndex = 0; stepIndex < input.plan.steps.length; stepIndex += 1) {
    const step = input.plan.steps[stepIndex];
    if (budgetUsedUsd + APIFY_PROBE_STEP_COST_ESTIMATE_USD > input.remainingBudgetUsd) {
      reason = "probe_budget_exhausted";
      probeResults.push({
        stepIndex,
        actorId: step.actorId,
        stage: step.stage,
        outcome: "fail",
        probeInputHash: "",
        qualityMetrics: {},
        costEstimateUsd: 0,
        details: { reason },
      });
      break;
    }

    const actorInput = buildChainStepInput({
      step,
      chainData,
      targetAudience: input.targetAudience,
      maxLeads: APIFY_PROBE_MAX_LEADS,
      probeMode: true,
    });
    const initialProbeInputHash = hashProbeInput(actorInput);

    const profile = await getActorSchemaProfileCached({
      cache: input.actorSchemaCache,
      actorId: step.actorId,
      token: input.token,
    });
    if (!profile.ok || !profile.profile) {
      reason = `actor_profile_unavailable:${step.actorId}`;
      probeResults.push({
        stepIndex,
        actorId: step.actorId,
        stage: step.stage,
        outcome: "fail",
        probeInputHash: initialProbeInputHash,
        qualityMetrics: {},
        costEstimateUsd: 0,
        details: { reason, error: profile.error },
      });
      break;
    }

    const normalizedInput = normalizeActorInputForSchema({
      actorProfile: profile.profile,
      actorInput,
      stage: step.stage,
    });
    let probeInputHash = hashProbeInput(normalizedInput.input);

    const compatibility = evaluateActorCompatibility({
      actorProfile: profile.profile,
      actorInput: normalizedInput.input,
      stage: step.stage,
    });
    if (!compatibility.ok) {
      reason = `incompatible_actor_input:${step.actorId}`;
      probeResults.push({
        stepIndex,
        actorId: step.actorId,
        stage: step.stage,
        outcome: "fail",
        probeInputHash,
        qualityMetrics: { compatibilityScore: compatibility.score },
        costEstimateUsd: 0,
        details: {
          reason: compatibility.reason,
          missingRequired: compatibility.missingRequired,
          normalizedInputAdjustments: normalizedInput.adjustments,
        },
      });
      break;
    }

    let actorInputForRun = { ...normalizedInput.input };
    let repairReason = "";
    let run = await runApifyActorSyncGetDatasetItems({
      actorId: step.actorId,
      actorInput: actorInputForRun,
      token: input.token,
      timeoutSeconds: 60,
    });
    for (let repairAttempt = 0; repairAttempt < 2 && !run.ok; repairAttempt += 1) {
      const repaired = repairActorInputFromProviderError({
        actorInput: actorInputForRun,
        errorText: run.error,
        stage: step.stage,
      });
      if (!repaired.repaired) break;

      const beforeHash = hashProbeInput(actorInputForRun);
      const afterHash = hashProbeInput(repaired.actorInput);
      if (beforeHash === afterHash) break;

      actorInputForRun = repaired.actorInput;
      probeInputHash = hashProbeInput(actorInputForRun);
      repairReason = repairReason ? `${repairReason};${repaired.reason}` : repaired.reason;
      run = await runApifyActorSyncGetDatasetItems({
        actorId: step.actorId,
        actorInput: actorInputForRun,
        token: input.token,
        timeoutSeconds: 60,
      });
    }
    budgetUsedUsd += APIFY_PROBE_STEP_COST_ESTIMATE_USD;
    if (!run.ok) {
      reason = `probe_run_failed:${step.actorId}`;
      probeResults.push({
        stepIndex,
        actorId: step.actorId,
        stage: step.stage,
        outcome: "fail",
        probeInputHash,
        qualityMetrics: { compatibilityScore: compatibility.score },
        costEstimateUsd: APIFY_PROBE_STEP_COST_ESTIMATE_USD,
        details: {
          reason,
          error: run.error,
          normalizedInputAdjustments: normalizedInput.adjustments,
          repairReason,
        },
      });
      break;
    }

    chainData = mergeChainData(chainData, run.rows);
    const qualityMetrics: Record<string, unknown> = {
      rowCount: run.rows.length,
      compatibilityScore: compatibility.score,
      signals: {
        queries: chainData.queries.length,
        companies: chainData.companies.length,
        websites: chainData.websites.length,
        domains: chainData.domains.length,
        emails: chainData.emails.length,
      },
    };

    if (stepIndex === input.plan.steps.length - 1) {
      const leads = leadsFromApifyRows(run.rows, APIFY_PROBE_MAX_LEADS);
      for (const lead of leads) {
        const decision = evaluateLeadAgainstQualityPolicy({
          lead,
          policy: input.qualityPolicy,
        });
        if (decision.accepted) {
          acceptedLeads.push(lead);
        } else {
          rejectedLeads.push(decision);
        }
      }
      qualityMetrics.acceptedLeads = acceptedLeads.length;
      qualityMetrics.rejectedLeads = rejectedLeads.length;
      qualityMetrics.topRejections = summarizeTopReasons(rejectedLeads, 4);
      if (!acceptedLeads.length) {
        reason = "probe_no_accepted_leads";
      }
    }

    probeResults.push({
      stepIndex,
      actorId: step.actorId,
      stage: step.stage,
      outcome: reason ? "fail" : "pass",
      probeInputHash,
      qualityMetrics,
      costEstimateUsd: APIFY_PROBE_STEP_COST_ESTIMATE_USD,
      details: {
        stage: step.stage,
        rowCount: run.rows.length,
        normalizedInputAdjustments: normalizedInput.adjustments,
        repairReason,
      },
    });

    if (reason) break;
  }

  const acceptedRatio =
    acceptedLeads.length + rejectedLeads.length > 0
      ? acceptedLeads.length / (acceptedLeads.length + rejectedLeads.length)
      : 0;
  const score = Number(
    (
      acceptedLeads.length * 4 +
      acceptedRatio * 35 +
      Math.max(0, 12 - budgetUsedUsd * 10) -
      (reason ? 14 : 0)
    ).toFixed(4)
  );

  return {
    plan: input.plan,
    probeResults,
    acceptedLeads,
    rejectedLeads,
    acceptedCount: acceptedLeads.length,
    rejectedCount: rejectedLeads.length,
    score,
    budgetUsedUsd,
    reason,
  };
}

async function executeSourcingPlan(input: {
  plan: LeadSourcingChainPlan;
  targetAudience: string;
  token: string;
  maxLeads: number;
  qualityPolicy: LeadQualityPolicy;
  actorSchemaCache: ActorSchemaProfileCache;
}): Promise<{
  ok: boolean;
  reason: string;
  leads: ApifyLead[];
  rejectedLeads: LeadAcceptanceDecision[];
  stepDiagnostics: Array<Record<string, unknown>>;
  lastActorInputError: string;
}> {
  let chainData: LeadSourcingChainData = {
    queries: uniqueTrimmed([input.targetAudience], 120),
    companies: [],
    websites: [],
    domains: [],
    emails: [],
  };
  const stepDiagnostics: Array<Record<string, unknown>> = [];
  let lastActorInputError = "";

  for (let stepIndex = 0; stepIndex < input.plan.steps.length; stepIndex += 1) {
    const step = input.plan.steps[stepIndex];
    const actorInput = buildChainStepInput({
      step,
      chainData,
      targetAudience: input.targetAudience,
      maxLeads: input.maxLeads,
    });

    const profile = await getActorSchemaProfileCached({
      cache: input.actorSchemaCache,
      actorId: step.actorId,
      token: input.token,
    });
    if (!profile.ok || !profile.profile) {
      lastActorInputError = profile.error || "actor_profile_unavailable";
      stepDiagnostics.push({
        stepIndex,
        stage: step.stage,
        actorId: step.actorId,
        ok: false,
        reason: "actor_profile_unavailable",
        error: profile.error,
      });
      return {
        ok: false,
        reason: `Actor profile unavailable for ${step.actorId}`,
        leads: [],
        rejectedLeads: [],
        stepDiagnostics,
        lastActorInputError,
      };
    }

    const normalizedInput = normalizeActorInputForSchema({
      actorProfile: profile.profile,
      actorInput,
      stage: step.stage,
    });

    const compatibility = evaluateActorCompatibility({
      actorProfile: profile.profile,
      actorInput: normalizedInput.input,
      stage: step.stage,
    });
    if (!compatibility.ok) {
      lastActorInputError = compatibility.reason;
      stepDiagnostics.push({
        stepIndex,
        stage: step.stage,
        actorId: step.actorId,
        ok: false,
        reason: "actor_input_incompatible",
        missingRequired: compatibility.missingRequired,
        normalizedInputAdjustments: normalizedInput.adjustments,
      });
      return {
        ok: false,
        reason: `Actor input incompatible for ${step.actorId}: ${compatibility.reason}`,
        leads: [],
        rejectedLeads: [],
        stepDiagnostics,
        lastActorInputError,
      };
    }

    const run = await startApifyActorRun({
      token: input.token,
      actorId: step.actorId,
      actorInput: normalizedInput.input,
      maxTotalChargeUsd: APIFY_CHAIN_EXEC_MAX_CHARGE_USD,
    });
    let runResult = run;
    let repairReason = "";
    let actorInputForRun = normalizedInput.input;
    for (let repairAttempt = 0; repairAttempt < 2 && (!runResult.ok || !runResult.runId); repairAttempt += 1) {
      const repaired = repairActorInputFromProviderError({
        actorInput: actorInputForRun,
        errorText: runResult.error,
        stage: step.stage,
      });
      if (!repaired.repaired) break;

      if (JSON.stringify(repaired.actorInput) === JSON.stringify(actorInputForRun)) break;
      actorInputForRun = repaired.actorInput;
      repairReason = repairReason ? `${repairReason};${repaired.reason}` : repaired.reason;
      runResult = await startApifyActorRun({
        token: input.token,
        actorId: step.actorId,
        actorInput: actorInputForRun,
        maxTotalChargeUsd: APIFY_CHAIN_EXEC_MAX_CHARGE_USD,
      });
    }
    if (!runResult.ok || !runResult.runId) {
      lastActorInputError = runResult.error;
      stepDiagnostics.push({
        stepIndex,
        stage: step.stage,
        actorId: step.actorId,
        ok: false,
        reason: "actor_run_start_failed",
        error: runResult.error,
        normalizedInputAdjustments: normalizedInput.adjustments,
        repairReason,
      });
      return {
        ok: false,
        reason: `Failed to start actor ${step.actorId}: ${runResult.error}`,
        leads: [],
        rejectedLeads: [],
        stepDiagnostics,
        lastActorInputError,
      };
    }

    let pollStatus = "ready";
    let datasetId = runResult.datasetId;
    for (let pollAttempt = 0; pollAttempt < 30; pollAttempt += 1) {
      const poll = await pollApifyActorRun({
        token: input.token,
        runId: runResult.runId,
      });
      if (!poll.ok) {
        lastActorInputError = poll.error;
        stepDiagnostics.push({
          stepIndex,
          stage: step.stage,
        actorId: step.actorId,
        ok: false,
        reason: "actor_poll_failed",
        error: poll.error,
        normalizedInputAdjustments: normalizedInput.adjustments,
      });
        return {
          ok: false,
          reason: `Actor ${step.actorId} failed while polling: ${poll.error}`,
          leads: [],
          rejectedLeads: [],
          stepDiagnostics,
          lastActorInputError,
        };
      }
      pollStatus = poll.status;
      datasetId = poll.datasetId || datasetId;
      if (poll.status === "succeeded") break;
      if (poll.status === "ready" || poll.status === "running") {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
    }

    if (pollStatus !== "succeeded") {
      return {
        ok: false,
        reason: `Actor ${step.actorId} did not finish successfully`,
        leads: [],
        rejectedLeads: [],
        stepDiagnostics,
        lastActorInputError,
      };
    }
    if (!datasetId) {
      return {
        ok: false,
        reason: `Actor ${step.actorId} completed without dataset`,
        leads: [],
        rejectedLeads: [],
        stepDiagnostics,
        lastActorInputError,
      };
    }

    const fetched = await fetchApifyActorDatasetItems({
      token: input.token,
      datasetId,
      limit: Math.max(20, Math.min(APIFY_CHAIN_MAX_ITEMS_PER_STEP, input.maxLeads)),
    });
    if (!fetched.ok) {
      lastActorInputError = fetched.error;
      stepDiagnostics.push({
        stepIndex,
        stage: step.stage,
        actorId: step.actorId,
        ok: false,
        reason: "dataset_fetch_failed",
        error: fetched.error,
        normalizedInputAdjustments: normalizedInput.adjustments,
      });
      return {
        ok: false,
        reason: `Dataset fetch failed for ${step.actorId}: ${fetched.error}`,
        leads: [],
        rejectedLeads: [],
        stepDiagnostics,
        lastActorInputError,
      };
    }

    chainData = mergeChainData(chainData, fetched.rows);
    stepDiagnostics.push({
      stepIndex,
      stage: step.stage,
      actorId: step.actorId,
      ok: true,
      rowCount: fetched.rows.length,
      normalizedInputAdjustments: normalizedInput.adjustments,
      signals: {
        queries: chainData.queries.length,
        companies: chainData.companies.length,
        websites: chainData.websites.length,
        domains: chainData.domains.length,
        emails: chainData.emails.length,
      },
    });

    if (stepIndex === input.plan.steps.length - 1) {
      const rawLeads = leadsFromApifyRows(fetched.rows, input.maxLeads);
      const accepted: ApifyLead[] = [];
      const rejected: LeadAcceptanceDecision[] = [];
      for (const lead of rawLeads) {
        const decision = evaluateLeadAgainstQualityPolicy({
          lead,
          policy: input.qualityPolicy,
        });
        if (decision.accepted) accepted.push(lead);
        else rejected.push(decision);
      }

      if (!accepted.length) {
        return {
          ok: false,
          reason: "No leads passed adaptive quality policy",
          leads: [],
          rejectedLeads: rejected,
          stepDiagnostics,
          lastActorInputError,
        };
      }

      return {
        ok: true,
        reason: "",
        leads: accepted,
        rejectedLeads: rejected,
        stepDiagnostics,
        lastActorInputError,
      };
    }
  }

  return {
    ok: false,
    reason: "Sourcing chain returned no final lead-producing step",
    leads: [],
    rejectedLeads: [],
    stepDiagnostics,
    lastActorInputError,
  };
}

function supportsDelivery(account: ResolvedAccount) {
  return account.accountType !== "mailbox";
}

function supportsMailbox(account: ResolvedAccount) {
  return account.accountType !== "delivery";
}

function preflightReason(input: {
  deliveryAccount: ResolvedAccount;
  deliverySecrets: ResolvedSecrets;
  mailboxAccount: ResolvedAccount;
  mailboxSecrets: ResolvedSecrets;
  hypothesis: Hypothesis;
}) {
  if (!supportsDelivery(input.deliveryAccount)) {
    return "Assigned delivery account does not support outreach sending";
  }
  if (!input.hypothesis.actorQuery.trim()) {
    return "Target Audience is required for lead sourcing";
  }
  if (!effectiveSourcingToken(input.deliverySecrets)) {
    return "Lead sourcing credentials are missing";
  }
  if (
    !input.deliveryAccount.config.customerIo.siteId.trim()
  ) {
    return "Customer.io site config is required";
  }
  if (!effectiveCustomerIoApiKey(input.deliverySecrets)) {
    return "Customer.io API key missing";
  }
  if (!input.deliveryAccount.config.customerIo.fromEmail.trim()) {
    return "Customer.io From Email is required";
  }
  if (!supportsMailbox(input.mailboxAccount)) {
    return "Assigned mailbox account does not support mailbox reply handling";
  }
  if (
    input.mailboxAccount.config.mailbox.status !== "connected" ||
    !input.mailboxAccount.config.mailbox.email.trim()
  ) {
    return "Mailbox must be connected for automated reply triage";
  }
  if (
    !input.mailboxSecrets.mailboxAccessToken.trim() &&
    !input.mailboxSecrets.mailboxPassword.trim()
  ) {
    return "Mailbox credentials missing";
  }
  return "";
}

function preflightDiagnostic(input: {
  reason: string;
  hypothesis: Hypothesis;
  deliverySecrets: ResolvedSecrets;
}) {
  const sourceConfig = effectiveSourceConfig(input.hypothesis);

  const debug = {
    reason: input.reason,
    hypothesisId: input.hypothesis.id,
    hypothesisHasLeadSourceOverride: Boolean(input.hypothesis.sourceConfig?.actorId?.trim()),
    hasResolvedLeadSource: Boolean(sourceConfig.actorId),
    hasLeadSourcingToken: Boolean(effectiveSourcingToken(input.deliverySecrets)),
  } as const;

  if (input.reason === "Lead sourcing credentials are missing") {
    return {
      hint: "Platform lead sourcing credentials are missing in this deployment. This is platform-managed (not per-user).",
      debug,
    };
  }
  return { hint: "", debug };
}

function classifySentiment(body: string): ReplyThread["sentiment"] {
  const normalized = body.toLowerCase();
  if (/(not interested|stop|unsubscribe|remove me|no thanks)/.test(normalized)) {
    return "negative";
  }
  if (/(interested|sounds good|let's talk|book|yes)/.test(normalized)) {
    return "positive";
  }
  return "neutral";
}

function classifyIntent(body: string): ReplyThread["intent"] {
  const normalized = body.toLowerCase();
  if (/(unsubscribe|remove me|stop emailing)/.test(normalized)) {
    return "unsubscribe";
  }
  if (/(price|how much|details|question|what does)/.test(normalized)) {
    return "question";
  }
  if (/(interested|book|call|chat|learn more)/.test(normalized)) {
    return "interest";
  }
  if (/(already|not now|budget|timing|no need)/.test(normalized)) {
    return "objection";
  }
  return "other";
}

function classifyIntentConfidence(body: string): { intent: ReplyThread["intent"]; confidence: number } {
  const intent = classifyIntent(body);
  if (intent === "unsubscribe") return { intent, confidence: 0.95 };
  if (intent === "interest") return { intent, confidence: 0.85 };
  if (intent === "question") return { intent, confidence: 0.82 };
  if (intent === "objection") return { intent, confidence: 0.8 };
  return { intent, confidence: 0.55 };
}

function addMinutes(dateIso: string, minutes: number) {
  const date = new Date(dateIso);
  return new Date(date.getTime() + Math.max(0, minutes) * 60 * 1000).toISOString();
}

function conversationNodeById(graph: ConversationFlowGraph, nodeId: string): ConversationFlowNode | null {
  return graph.nodes.find((node) => node.id === nodeId) ?? null;
}

function pickIntentEdge(input: {
  graph: ConversationFlowGraph;
  currentNodeId: string;
  intent: ReplyThread["intent"];
  confidence: number;
}) {
  const candidates = input.graph.edges
    .filter(
      (edge) =>
        edge.fromNodeId === input.currentNodeId &&
        edge.trigger === "intent" &&
        edge.intent === input.intent &&
        input.confidence >= edge.confidenceThreshold
    )
    .sort((a, b) => a.priority - b.priority);
  return candidates[0] ?? null;
}

function pickFallbackEdge(graph: ConversationFlowGraph, currentNodeId: string) {
  return (
    graph.edges
      .filter((edge) => edge.fromNodeId === currentNodeId && edge.trigger === "fallback")
      .sort((a, b) => a.priority - b.priority)[0] ?? null
  );
}

function pickDueTimerEdge(input: {
  graph: ConversationFlowGraph;
  currentNodeId: string;
  lastNodeEnteredAt: string;
}) {
  const elapsedMs = Math.max(0, Date.now() - toDate(input.lastNodeEnteredAt).getTime());
  return (
    input.graph.edges
      .filter((edge) => edge.fromNodeId === input.currentNodeId && edge.trigger === "timer")
      .sort((a, b) => a.priority - b.priority)
      .find((edge) => elapsedMs >= edge.waitMinutes * 60 * 1000) ?? null
  );
}

function renderConversationTemplate(
  template: string,
  vars: {
    firstName: string;
    company: string;
    leadTitle: string;
    brandName: string;
    campaignGoal: string;
    variantName: string;
    replyPreview: string;
    shortAnswer: string;
  }
) {
  return template
    .replaceAll("{{firstName}}", vars.firstName)
    .replaceAll("{{company}}", vars.company)
    .replaceAll("{{leadTitle}}", vars.leadTitle)
    .replaceAll("{{brandName}}", vars.brandName)
    .replaceAll("{{campaignGoal}}", vars.campaignGoal)
    .replaceAll("{{variantName}}", vars.variantName)
    .replaceAll("{{replyPreview}}", vars.replyPreview)
    .replaceAll("{{shortAnswer}}", vars.shortAnswer);
}

function hasUnresolvedTemplateToken(text: string) {
  return /{{\s*[^}]+\s*}}/.test(text);
}

function normalizeWhitespace(text: string) {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\?/g, "?")
    .replace(/\s+\./g, ".")
    .trim();
}

function firstNameFromLead(leadName: string) {
  const token = leadName.trim().split(/\s+/)[0] ?? "";
  return token || "there";
}

function effectiveCampaignGoal(goal: string, variantName: string) {
  const trimmedGoal = goal.trim();
  if (trimmedGoal) return trimmedGoal;
  const trimmedVariant = variantName.trim();
  if (trimmedVariant) return trimmedVariant;
  return "outbound pipeline performance";
}

function clampConfidenceValue(value: unknown, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function renderConversationNode(input: {
  node: ConversationFlowNode;
  leadName: string;
  leadCompany?: string;
  leadTitle?: string;
  brandName: string;
  campaignGoal: string;
  variantName: string;
  replyPreview?: string;
}) {
  const subjectTemplate = input.node.subject.trim();
  const bodyTemplate = input.node.body.trim();
  if (!subjectTemplate) {
    return {
      ok: false as const,
      reason: "Conversation node subject is empty",
      subject: "",
      body: "",
    };
  }
  if (!bodyTemplate) {
    return {
      ok: false as const,
      reason: "Conversation node body is empty",
      subject: "",
      body: "",
    };
  }

  const firstName = firstNameFromLead(input.leadName);
  const company = input.leadCompany?.trim() || "your team";
  const leadTitle = input.leadTitle?.trim() || "your role";
  const replyPreview = input.replyPreview?.trim() ?? "";
  const shortAnswer = replyPreview.split(/\n+/)[0]?.slice(0, 180) || "happy to share the exact details";
  const vars = {
    firstName,
    company,
    leadTitle,
    brandName: input.brandName.trim(),
    campaignGoal: effectiveCampaignGoal(input.campaignGoal, input.variantName),
    variantName: input.variantName.trim(),
    replyPreview,
    shortAnswer,
  };

  const subject = normalizeWhitespace(renderConversationTemplate(subjectTemplate, vars));
  const body = normalizeWhitespace(renderConversationTemplate(bodyTemplate, vars));
  if (!subject) {
    return {
      ok: false as const,
      reason: "Conversation node subject rendered empty",
      subject: "",
      body: "",
    };
  }
  if (!body) {
    return {
      ok: false as const,
      reason: "Conversation node body rendered empty",
      subject: "",
      body: "",
    };
  }
  if (hasUnresolvedTemplateToken(subject) || hasUnresolvedTemplateToken(body)) {
    return {
      ok: false as const,
      reason: "Conversation node contains unresolved template tokens",
      subject: "",
      body: "",
    };
  }

  return {
    ok: true as const,
    reason: "",
    subject,
    body,
  };
}

function parseOfferAndCta(rawOffer: string) {
  const text = String(rawOffer ?? "").trim();
  if (!text) return { offer: "", cta: "" };
  const ctaMatch = text.match(/\bCTA\s*:\s*([^\n]+)/i);
  const cta = ctaMatch ? ctaMatch[1].trim() : "";
  const offer = text.replace(/\bCTA\s*:\s*[^\n]+/gi, "").replace(/\s{2,}/g, " ").trim();
  return { offer, cta };
}

function buildConversationPromptContext(input: {
  run: {
    id: string;
    brandId: string;
    campaignId: string;
    dailyCap: number;
    hourlyCap: number;
    minSpacingMinutes: number;
    timezone: string;
  };
  lead: { id: string; email: string; name: string; status: string; company?: string; title?: string; domain?: string };
  sessionId: string;
  nodeId: string;
  parentMessageId?: string;
  brandName: string;
  brandWebsite?: string;
  brandTone?: string;
  brandNotes?: string;
  campaignName?: string;
  campaignGoal: string;
  campaignConstraints?: string;
  variantId?: string;
  variantName: string;
  experimentOffer?: string;
  experimentCta?: string;
  experimentAudience?: string;
  experimentNotes?: string;
  latestInboundSubject?: string;
  latestInboundBody?: string;
  intent?: ReplyThread["intent"] | "";
  intentConfidence?: number;
  priorNodePath?: string[];
  maxDepth?: number;
}): ConversationPromptRenderContext {
  return {
    brand: {
      id: input.run.brandId,
      name: input.brandName.trim(),
      website: String(input.brandWebsite ?? "").trim(),
      tone: String(input.brandTone ?? "").trim(),
      notes: String(input.brandNotes ?? "").trim(),
    },
    campaign: {
      id: input.run.campaignId,
      name: String(input.campaignName ?? "").trim(),
      objectiveGoal: effectiveCampaignGoal(input.campaignGoal, input.variantName),
      objectiveConstraints: String(input.campaignConstraints ?? "").trim(),
    },
    experiment: {
      id: String(input.variantId ?? "").trim(),
      name: input.variantName.trim(),
      offer: String(input.experimentOffer ?? "").trim(),
      cta: String(input.experimentCta ?? "").trim(),
      audience: String(input.experimentAudience ?? "").trim(),
      notes: String(input.experimentNotes ?? "").trim(),
    },
    lead: {
      id: input.lead.id,
      email: input.lead.email.trim(),
      name: input.lead.name.trim(),
      company: String(input.lead.company ?? "").trim(),
      title: String(input.lead.title ?? "").trim(),
      domain: String(input.lead.domain ?? input.lead.email.split("@")[1] ?? "").trim().toLowerCase(),
      status: input.lead.status,
    },
    thread: {
      sessionId: input.sessionId,
      nodeId: input.nodeId,
      parentMessageId: String(input.parentMessageId ?? "").trim(),
      latestInboundSubject: String(input.latestInboundSubject ?? "").trim(),
      latestInboundBody: String(input.latestInboundBody ?? "").trim(),
      intent: input.intent ?? "",
      confidence: clampConfidenceValue(input.intentConfidence ?? 0, 0),
      priorNodePath: Array.isArray(input.priorNodePath)
        ? input.priorNodePath.map((value) => String(value ?? "").trim()).filter(Boolean)
        : [],
    },
    safety: {
      maxDepth: Math.max(1, Math.min(12, Number(input.maxDepth ?? 5) || 5)),
      dailyCap: Math.max(1, Number(input.run.dailyCap || 30)),
      hourlyCap: Math.max(1, Number(input.run.hourlyCap || 6)),
      minSpacingMinutes: Math.max(1, Number(input.run.minSpacingMinutes || 8)),
      timezone: input.run.timezone || DEFAULT_TIMEZONE,
    },
  };
}

async function generateConversationNodeContent(input: {
  node: ConversationFlowNode;
  run: {
    id: string;
    brandId: string;
    campaignId: string;
    dailyCap: number;
    hourlyCap: number;
    minSpacingMinutes: number;
    timezone: string;
  };
  lead: { id: string; email: string; name: string; status: string; company?: string; title?: string; domain?: string };
  sessionId: string;
  parentMessageId?: string;
  brandName: string;
  brandWebsite?: string;
  brandTone?: string;
  brandNotes?: string;
  campaignName?: string;
  campaignGoal: string;
  campaignConstraints?: string;
  variantId?: string;
  variantName: string;
  experimentOffer?: string;
  experimentCta?: string;
  experimentAudience?: string;
  experimentNotes?: string;
  latestInboundSubject?: string;
  latestInboundBody?: string;
  intent?: ReplyThread["intent"] | "";
  intentConfidence?: number;
  priorNodePath?: string[];
  maxDepth?: number;
}): Promise<
  | { ok: true; subject: string; body: string; trace: Record<string, unknown> }
  | { ok: false; reason: string; trace: Record<string, unknown> }
> {
  if (conversationPromptModeEnabled()) {
    if (input.node.copyMode !== "prompt_v1") {
      return {
        ok: false,
        reason: "Conversation node must use prompt mode",
        trace: {
          mode: "prompt_v1",
          validation: { passed: false, reason: "node_copy_mode_invalid" },
        },
      };
    }

    const promptContext = buildConversationPromptContext({
      run: input.run,
      lead: input.lead,
      sessionId: input.sessionId,
      nodeId: input.node.id,
      parentMessageId: input.parentMessageId,
      brandName: input.brandName,
      brandWebsite: input.brandWebsite,
      brandTone: input.brandTone,
      brandNotes: input.brandNotes,
      campaignName: input.campaignName,
      campaignGoal: input.campaignGoal,
      campaignConstraints: input.campaignConstraints,
      variantId: input.variantId,
      variantName: input.variantName,
      experimentOffer: input.experimentOffer,
      experimentCta: input.experimentCta,
      experimentAudience: input.experimentAudience,
      experimentNotes: input.experimentNotes,
      latestInboundSubject: input.latestInboundSubject,
      latestInboundBody: input.latestInboundBody,
      intent: input.intent,
      intentConfidence: input.intentConfidence,
      priorNodePath: input.priorNodePath,
      maxDepth: input.maxDepth,
    });

    const generated = await generateConversationPromptMessage({
      node: input.node,
      context: promptContext,
    });
    if (!generated.ok) {
      return {
        ok: false,
        reason: generated.reason,
        trace: generated.trace,
      };
    }
    return {
      ok: true,
      subject: generated.subject,
      body: generated.body,
      trace: generated.trace,
    };
  }

  const rendered = renderConversationNode({
    node: input.node,
    leadName: input.lead.name,
    leadCompany: input.lead.company ?? "",
    leadTitle: input.lead.title ?? "",
    brandName: input.brandName,
    campaignGoal: input.campaignGoal,
    variantName: input.variantName,
    replyPreview: input.latestInboundBody,
  });
  if (!rendered.ok) {
    return {
      ok: false,
      reason: rendered.reason,
      trace: {
        mode: "legacy_template",
        validation: { passed: false, reason: rendered.reason },
      },
    };
  }
  return {
    ok: true,
    subject: rendered.subject,
    body: rendered.body,
    trace: {
      mode: "legacy_template",
      validation: { passed: true, reason: "" },
    },
  };
}

function addHours(dateIso: string, hours: number) {
  const date = new Date(dateIso);
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

async function failRunWithDiagnostics(input: {
  run: { id: string; brandId: string; campaignId: string; experimentId: string };
  reason: string;
  eventType?: string;
  payload?: Record<string, unknown>;
}) {
  await updateOutreachRun(input.run.id, { status: "failed", lastError: input.reason });
  await markExperimentExecutionStatus(input.run.brandId, input.run.campaignId, input.run.experimentId, "failed");
  await createOutreachEvent({
    runId: input.run.id,
    eventType: input.eventType ?? "run_failed",
    payload: {
      reason: input.reason,
      ...(input.payload ?? {}),
    },
  });
}

function calculateRunMetricsFromMessages(
  runId: string,
  messages: Awaited<ReturnType<typeof listRunMessages>>,
  threads: ReplyThread[]
) {
  const runMessages = messages.filter((item) => item.runId === runId);
  const sentMessages = runMessages.filter((item) => item.status === "sent").length;
  const bouncedMessages = runMessages.filter((item) => item.status === "bounced").length;
  const failedMessages = runMessages.filter((item) => item.status === "failed").length;
  const replies = threads.filter((item) => item.runId === runId).length;
  const positiveReplies = threads.filter(
    (item) => item.runId === runId && item.sentiment === "positive"
  ).length;
  const negativeReplies = threads.filter(
    (item) => item.runId === runId && item.sentiment === "negative"
  ).length;

  return {
    sentMessages,
    bouncedMessages,
    failedMessages,
    replies,
    positiveReplies,
    negativeReplies,
  };
}

async function scheduleConversationNodeMessage(input: {
  run: {
    id: string;
    brandId: string;
    campaignId: string;
    dailyCap: number;
    hourlyCap: number;
    minSpacingMinutes: number;
    timezone: string;
  };
  lead: { id: string; email: string; name: string; status: string; company?: string; title?: string; domain?: string };
  sessionId: string;
  node: ConversationFlowNode;
  step: number;
  parentMessageId?: string;
  brandName: string;
  brandWebsite?: string;
  brandTone?: string;
  brandNotes?: string;
  campaignName?: string;
  campaignGoal: string;
  campaignConstraints?: string;
  variantId?: string;
  variantName: string;
  experimentOffer?: string;
  experimentCta?: string;
  experimentAudience?: string;
  experimentNotes?: string;
  intent?: ReplyThread["intent"] | "";
  intentConfidence?: number;
  priorNodePath?: string[];
  maxDepth?: number;
  waitMinutes?: number;
  latestInboundSubject?: string;
  latestInboundBody?: string;
  existingMessages: Awaited<ReturnType<typeof listRunMessages>>;
}): Promise<{ ok: boolean; reason: string; messageId: string }> {
  if (input.node.kind !== "message") {
    return { ok: false, reason: "Node is not a valid message node", messageId: "" };
  }
  if (!input.lead.email.trim()) {
    return { ok: false, reason: "Lead email is empty", messageId: "" };
  }
  if (["unsubscribed", "bounced", "suppressed"].includes(input.lead.status)) {
    return { ok: false, reason: "Lead is suppressed for outreach", messageId: "" };
  }

  const alreadyExists = input.existingMessages.some(
    (message) =>
      message.sessionId === input.sessionId &&
      message.nodeId === input.node.id &&
      ["scheduled", "sent"].includes(message.status)
  );
  if (alreadyExists) {
    return { ok: false, reason: "Message already scheduled for this node", messageId: "" };
  }

  const composed = await generateConversationNodeContent({
    node: input.node,
    run: input.run,
    lead: input.lead,
    sessionId: input.sessionId,
    parentMessageId: input.parentMessageId,
    brandName: input.brandName,
    brandWebsite: input.brandWebsite,
    brandTone: input.brandTone,
    brandNotes: input.brandNotes,
    campaignName: input.campaignName,
    campaignGoal: input.campaignGoal,
    campaignConstraints: input.campaignConstraints,
    variantId: input.variantId,
    variantName: input.variantName,
    experimentOffer: input.experimentOffer,
    experimentCta: input.experimentCta,
    experimentAudience: input.experimentAudience,
    experimentNotes: input.experimentNotes,
    latestInboundSubject: input.latestInboundSubject,
    latestInboundBody: input.latestInboundBody,
    intent: input.intent,
    intentConfidence: input.intentConfidence,
    priorNodePath: input.priorNodePath,
    maxDepth: input.maxDepth,
  });
  if (!composed.ok) {
    const failedRows = await createRunMessages([
      {
        runId: input.run.id,
        brandId: input.run.brandId,
        campaignId: input.run.campaignId,
        leadId: input.lead.id,
        step: Math.max(1, input.step),
        subject: "",
        body: "",
        status: "failed",
        scheduledAt: nowIso(),
        sourceType: "conversation",
        sessionId: input.sessionId,
        nodeId: input.node.id,
        parentMessageId: input.parentMessageId ?? "",
        lastError: composed.reason,
        generationMeta: composed.trace,
      },
    ]);
    const failedMessageId = failedRows[0]?.id ?? "";
    if (failedRows[0]) {
      input.existingMessages.push(failedRows[0]);
    }
    await createConversationEvent({
      sessionId: input.sessionId,
      runId: input.run.id,
      eventType: "conversation_prompt_rejected",
      payload: {
        nodeId: input.node.id,
        reason: composed.reason,
        messageId: failedMessageId,
        trace: composed.trace,
      },
    });
    await createOutreachEvent({
      runId: input.run.id,
      eventType: "conversation_prompt_rejected",
      payload: {
        nodeId: input.node.id,
        reason: composed.reason,
        messageId: failedMessageId,
      },
    });
    await createOutreachEvent({
      runId: input.run.id,
      eventType: "conversation_prompt_failed",
      payload: {
        nodeId: input.node.id,
        reason: composed.reason,
        messageId: failedMessageId,
      },
    });
    return { ok: false, reason: composed.reason, messageId: failedMessageId };
  }

  const totalDelay = Math.max(0, input.node.delayMinutes + (input.waitMinutes ?? 0));
  const created = await createRunMessages([
    {
      runId: input.run.id,
      brandId: input.run.brandId,
      campaignId: input.run.campaignId,
      leadId: input.lead.id,
      step: Math.max(1, input.step),
      subject: composed.subject,
      body: composed.body,
      status: "scheduled",
      scheduledAt: addMinutes(nowIso(), totalDelay),
      sourceType: "conversation",
      sessionId: input.sessionId,
      nodeId: input.node.id,
      parentMessageId: input.parentMessageId ?? "",
      generationMeta: composed.trace,
    },
  ]);
  if (!created.length) {
    return { ok: false, reason: "Failed to persist scheduled message", messageId: "" };
  }

  input.existingMessages.push(created[0]);
  await updateRunLead(input.lead.id, { status: "scheduled" });
  await createConversationEvent({
    sessionId: input.sessionId,
    runId: input.run.id,
    eventType: "conversation_prompt_generated",
    payload: {
      nodeId: input.node.id,
      messageId: created[0].id,
      trace: composed.trace,
    },
  });
  await createOutreachEvent({
    runId: input.run.id,
    eventType: "conversation_prompt_generated",
    payload: {
      nodeId: input.node.id,
      messageId: created[0].id,
    },
  });
  return { ok: true, reason: "", messageId: created[0].id };
}

async function ensureBrandAccount(brandId: string): Promise<{
  ok: boolean;
  reason: string;
  accountId: string;
  mailboxAccountId?: string;
  deliveryAccount?: ResolvedAccount;
  deliverySecrets?: ResolvedSecrets;
  mailboxAccount?: ResolvedAccount;
  mailboxSecrets?: ResolvedSecrets;
}> {
  const assignment = await getBrandOutreachAssignment(brandId);
  if (!assignment || !assignment.accountId.trim()) {
    return { ok: false, reason: "No outreach delivery account assigned to brand", accountId: "" };
  }

  const deliveryAccount = await getOutreachAccount(assignment.accountId);
  if (!deliveryAccount || deliveryAccount.status !== "active") {
    return {
      ok: false,
      reason: "Assigned outreach delivery account is missing or inactive",
      accountId: assignment.accountId,
    };
  }

  const deliverySecrets = await getOutreachAccountSecrets(deliveryAccount.id);
  if (!deliverySecrets) {
    return {
      ok: false,
      reason: "Assigned delivery account credentials are missing",
      accountId: assignment.accountId,
    };
  }

  const mailboxAccountId = assignment.mailboxAccountId || assignment.accountId;
  const mailboxAccount =
    mailboxAccountId === deliveryAccount.id
      ? deliveryAccount
      : await getOutreachAccount(mailboxAccountId);
  if (!mailboxAccount || mailboxAccount.status !== "active") {
    return {
      ok: false,
      reason: "Assigned mailbox account is missing or inactive",
      accountId: assignment.accountId,
    };
  }

  const mailboxSecrets =
    mailboxAccount.id === deliveryAccount.id
      ? deliverySecrets
      : await getOutreachAccountSecrets(mailboxAccount.id);
  if (!mailboxSecrets) {
    return {
      ok: false,
      reason: "Assigned mailbox account credentials are missing",
      accountId: assignment.accountId,
    };
  }

  return {
    ok: true,
    reason: "",
    accountId: assignment.accountId,
    mailboxAccountId,
    deliveryAccount,
    deliverySecrets,
    mailboxAccount,
    mailboxSecrets,
  };
}

async function resolveMailboxAccountForRun(run: { brandId: string; accountId: string }) {
  const assignment = await getBrandOutreachAssignment(run.brandId);
  const mailboxAccountId = assignment?.mailboxAccountId || assignment?.accountId || run.accountId;
  const account = await getOutreachAccount(mailboxAccountId);
  if (!account || account.status !== "active" || !supportsMailbox(account)) {
    return null;
  }
  const secrets = await getOutreachAccountSecrets(mailboxAccountId);
  if (!secrets) {
    return null;
  }
  return { account, secrets };
}

async function markExperimentExecutionStatus(
  brandId: string,
  campaignId: string,
  experimentId: string,
  executionStatus: Experiment["executionStatus"]
) {
  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) return;
  const nextExperiments = campaign.experiments.map((experiment) =>
    experiment.id === experimentId ? { ...experiment, executionStatus } : experiment
  );
  await updateCampaign(brandId, campaignId, { experiments: nextExperiments });
}

async function createDefaultExperimentForHypothesis(
  brandId: string,
  campaignId: string,
  hypothesis: Hypothesis
): Promise<Experiment | null> {
  const campaign = await getCampaignById(brandId, campaignId);
  if (!campaign) return null;

  const experiment: Experiment = {
    id: `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    hypothesisId: hypothesis.id,
    name: `${hypothesis.title} / Autopilot`,
    status: "testing",
    notes: "Auto-created from approved hypothesis for outreach autopilot.",
    runPolicy: defaultExperimentRunPolicy(),
    executionStatus: "idle",
  };

  await updateCampaign(brandId, campaignId, {
    experiments: [experiment, ...campaign.experiments],
  });

  return experiment;
}

export async function launchExperimentRun(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
  trigger: "manual" | "hypothesis_approved";
  ownerType?: "experiment" | "campaign";
  ownerId?: string;
  sampleOnly?: boolean;
  maxLeadsOverride?: number;
}): Promise<{
  ok: boolean;
  runId: string;
  reason: string;
  hint?: string;
  debug?: Record<string, unknown>;
}> {
  const campaign = await getCampaignById(input.brandId, input.campaignId);
  if (!campaign) {
    return { ok: false, runId: "", reason: "Campaign not found" };
  }

  const experiment = findExperiment(campaign, input.experimentId);
  if (!experiment) {
    return { ok: false, runId: "", reason: "Experiment not found" };
  }

  const hypothesis = findHypothesis(campaign, experiment.hypothesisId);
  if (!hypothesis) {
    return { ok: false, runId: "", reason: "Linked hypothesis not found" };
  }

  if (hypothesis.status !== "approved" && input.trigger !== "manual") {
    return { ok: false, runId: "", reason: "Hypothesis must be approved before auto-run" };
  }

  const activeRuns = await listExperimentRuns(input.brandId, input.campaignId, experiment.id);
  const openRun =
    activeRuns.find((run) => ["queued", "sourcing", "scheduled", "sending", "monitoring", "paused"].includes(run.status)) ??
    null;
  if (openRun) {
    return {
      ok: false,
      runId: openRun.id,
      reason: "Experiment already has an active run",
      hint: `Active run ${openRun.id.slice(-6)} is ${openRun.status}. Pause/cancel it to restart.`,
    };
  }

  const brandAccount = await ensureBrandAccount(input.brandId);
  if (
    !brandAccount.ok ||
    !brandAccount.deliveryAccount ||
    !brandAccount.deliverySecrets ||
    !brandAccount.mailboxAccount ||
    !brandAccount.mailboxSecrets
  ) {
    const failed = await createOutreachRun({
      brandId: input.brandId,
      campaignId: input.campaignId,
      experimentId: experiment.id,
      hypothesisId: hypothesis.id,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      accountId: brandAccount.accountId || "",
      status: "preflight_failed",
      dailyCap: experiment.runPolicy?.dailyCap ?? 30,
      hourlyCap: experiment.runPolicy?.hourlyCap ?? 6,
      timezone: experiment.runPolicy?.timezone || DEFAULT_TIMEZONE,
      minSpacingMinutes: experiment.runPolicy?.minSpacingMinutes ?? 8,
      lastError: brandAccount.reason,
    });
    await markExperimentExecutionStatus(input.brandId, input.campaignId, experiment.id, "failed");
    await createOutreachEvent({
      runId: failed.id,
      eventType: "hypothesis_approved_auto_run_queued",
      payload: { trigger: input.trigger, outcome: "preflight_failed", reason: brandAccount.reason },
    });
    return { ok: false, runId: failed.id, reason: brandAccount.reason };
  }

  const reason = preflightReason({
    deliveryAccount: brandAccount.deliveryAccount,
    deliverySecrets: brandAccount.deliverySecrets,
    mailboxAccount: brandAccount.mailboxAccount,
    mailboxSecrets: brandAccount.mailboxSecrets,
    hypothesis,
  });
  if (reason) {
    const diagnostic = preflightDiagnostic({
      reason,
      hypothesis,
      deliverySecrets: brandAccount.deliverySecrets,
    });
    const failed = await createOutreachRun({
      brandId: input.brandId,
      campaignId: input.campaignId,
      experimentId: experiment.id,
      hypothesisId: hypothesis.id,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      accountId: brandAccount.deliveryAccount.id,
      status: "preflight_failed",
      dailyCap: experiment.runPolicy?.dailyCap ?? 30,
      hourlyCap: experiment.runPolicy?.hourlyCap ?? 6,
      timezone: experiment.runPolicy?.timezone || DEFAULT_TIMEZONE,
      minSpacingMinutes: experiment.runPolicy?.minSpacingMinutes ?? 8,
      lastError: reason,
    });
    await markExperimentExecutionStatus(input.brandId, input.campaignId, experiment.id, "failed");
    await createOutreachEvent({
      runId: failed.id,
      eventType: "hypothesis_approved_auto_run_queued",
      payload: { trigger: input.trigger, outcome: "preflight_failed", reason },
    });
    return {
      ok: false,
      runId: failed.id,
      reason,
      hint: diagnostic.hint,
      debug: diagnostic.debug,
    };
  }

  const publishedFlowMap = await getPublishedConversationMapForExperiment(
    input.brandId,
    input.campaignId,
    experiment.id
  );
  const flowStartNode = publishedFlowMap
    ? conversationNodeById(publishedFlowMap.publishedGraph, publishedFlowMap.publishedGraph.startNodeId)
    : null;
  const conversationPreflightReason = input.sampleOnly
    ? ""
    : !publishedFlowMap || !publishedFlowMap.publishedRevision
      ? "No published conversation map for this variant"
      : !flowStartNode
        ? "Conversation map start node is invalid"
        : flowStartNode.kind !== "message"
          ? "Conversation map start node must be a message"
          : !flowStartNode.autoSend
            ? "Conversation map start node must auto-send to start outreach"
            : !flowStartNode.promptTemplate.trim()
              ? "Conversation map start prompt is empty"
              : "";

  if (conversationPreflightReason) {
    const failed = await createOutreachRun({
      brandId: input.brandId,
      campaignId: input.campaignId,
      experimentId: experiment.id,
      hypothesisId: hypothesis.id,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      accountId: brandAccount.deliveryAccount.id,
      status: "preflight_failed",
      dailyCap: experiment.runPolicy?.dailyCap ?? 30,
      hourlyCap: experiment.runPolicy?.hourlyCap ?? 6,
      timezone: experiment.runPolicy?.timezone || DEFAULT_TIMEZONE,
      minSpacingMinutes: experiment.runPolicy?.minSpacingMinutes ?? 8,
      lastError: conversationPreflightReason,
    });
    await markExperimentExecutionStatus(input.brandId, input.campaignId, experiment.id, "failed");
    await createOutreachEvent({
      runId: failed.id,
      eventType: "hypothesis_approved_auto_run_queued",
      payload: {
        trigger: input.trigger,
        outcome: "preflight_failed",
        reason: conversationPreflightReason,
        hasPublishedConversationMap: Boolean(publishedFlowMap?.publishedRevision),
      },
    });
    return {
      ok: false,
      runId: failed.id,
      reason: conversationPreflightReason,
      hint: "Open Build > Conversation Map, publish a valid start message, then relaunch.",
      debug: {
        hasPublishedConversationMap: Boolean(publishedFlowMap?.publishedRevision),
        hasStartNode: Boolean(flowStartNode),
        startNodeKind: flowStartNode?.kind ?? "",
        startNodeAutoSend: Boolean(flowStartNode?.autoSend),
        startNodeHasPrompt: Boolean(flowStartNode?.promptTemplate?.trim()),
      },
    };
  }

  const run = await createOutreachRun({
    brandId: input.brandId,
    campaignId: input.campaignId,
    experimentId: experiment.id,
    hypothesisId: hypothesis.id,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    accountId: brandAccount.deliveryAccount.id,
    status: "queued",
    dailyCap: experiment.runPolicy?.dailyCap ?? 30,
    hourlyCap: experiment.runPolicy?.hourlyCap ?? 6,
    timezone: experiment.runPolicy?.timezone || DEFAULT_TIMEZONE,
    minSpacingMinutes: experiment.runPolicy?.minSpacingMinutes ?? 8,
  });

  await enqueueOutreachJob({
    runId: run.id,
    jobType: "source_leads",
    executeAfter: nowIso(),
    payload: {
      sampleOnly: input.sampleOnly === true,
      maxLeadsOverride:
        input.maxLeadsOverride !== undefined
          ? Math.max(1, Math.min(500, Number(input.maxLeadsOverride) || 0))
          : undefined,
    },
  });
  await markExperimentExecutionStatus(input.brandId, input.campaignId, experiment.id, "queued");
  await createOutreachEvent({
    runId: run.id,
    eventType: "hypothesis_approved_auto_run_queued",
    payload: { trigger: input.trigger, sampleOnly: input.sampleOnly === true },
  });

  return { ok: true, runId: run.id, reason: "Run queued" };
}

export async function autoQueueApprovedHypothesisRuns(input: {
  brandId: string;
  campaignId: string;
  previous: CampaignRecord;
  next: CampaignRecord;
}): Promise<void> {
  const transitions = input.next.hypotheses.filter((nextHypothesis) => {
    if (nextHypothesis.status !== "approved") return false;
    const previousHypothesis = input.previous.hypotheses.find((item) => item.id === nextHypothesis.id);
    return previousHypothesis?.status !== "approved";
  });

  if (!transitions.length) return;

  for (const hypothesis of transitions) {
    let campaign = await getCampaignById(input.brandId, input.campaignId);
    if (!campaign) continue;

    let relatedExperiments = campaign.experiments.filter((experiment) => experiment.hypothesisId === hypothesis.id);
    if (!relatedExperiments.length) {
      const created = await createDefaultExperimentForHypothesis(input.brandId, input.campaignId, hypothesis);
      if (created) {
        relatedExperiments = [created];
      }
    }

    campaign = await getCampaignById(input.brandId, input.campaignId);
    if (!campaign) continue;
    relatedExperiments = campaign.experiments.filter((experiment) => experiment.hypothesisId === hypothesis.id);

    for (const experiment of relatedExperiments) {
      await launchExperimentRun({
        brandId: input.brandId,
        campaignId: input.campaignId,
        experimentId: experiment.id,
        trigger: "hypothesis_approved",
      });
    }
  }
}

async function processSourceLeadsJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (!["queued", "sourcing"].includes(run.status)) {
    return;
  }

  const existingLeads = await listRunLeads(run.id);
  const payload =
    job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? (job.payload as Record<string, unknown>)
      : {};
  const sampleOnly = payload.sampleOnly === true;

  if (existingLeads.length) {
    await updateOutreachRun(run.id, {
      status:
        run.status === "queued" || run.status === "sourcing"
          ? sampleOnly
            ? "completed"
            : "scheduled"
          : run.status,
      lastError: "",
      completedAt: sampleOnly ? nowIso() : "",
      metrics: {
        ...run.metrics,
        sourcedLeads: existingLeads.length,
      },
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_skipped",
      payload: { reason: "leads_already_present", count: existingLeads.length, sampleOnly },
    });
    if (!sampleOnly) {
      await enqueueOutreachJob({
        runId: run.id,
        jobType: "schedule_messages",
        executeAfter: nowIso(),
      });
    }
    return;
  }

  const campaign = await getCampaignById(run.brandId, run.campaignId);
  if (!campaign) {
    await failRunWithDiagnostics({
      run,
      reason: "Campaign not found",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  const hypothesis = findHypothesis(campaign, run.hypothesisId);
  const experiment = findExperiment(campaign, run.experimentId);
  if (!hypothesis || !experiment) {
    await failRunWithDiagnostics({
      run,
      reason: "Hypothesis or experiment missing",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  const account = await getOutreachAccount(run.accountId);
  const secrets = await getOutreachAccountSecrets(run.accountId);
  if (!account || !secrets) {
    await failRunWithDiagnostics({
      run,
      reason: "Outreach account missing",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  const sourceConfig = effectiveSourceConfig(hypothesis);
  const sourcingToken = effectiveSourcingToken(secrets);
  const maxLeads = Math.max(
    1,
    Math.min(
      500,
      Number(payload.maxLeadsOverride ?? sourceConfig.maxLeads ?? (sampleOnly ? APIFY_PROBE_MAX_LEADS : 100)) || 100
    )
  );
  const targetAudience = hypothesis.actorQuery.trim() || experiment.notes.trim();
  const brand = await getBrandById(run.brandId);
  const offerContext = experiment.notes || hypothesis.rationale || "";
  const traceBase = run.sourcingTraceSummary;
  let traceSummary: SourcingTraceSummary = {
    phase: "plan_sourcing",
    selectedActorIds: [],
    lastActorInputError: "",
    failureStep: "",
    budgetUsedUsd: 0,
  };

  const setTrace = async (patch: Partial<typeof traceSummary>) => {
    traceSummary = { ...traceSummary, ...patch };
    await updateOutreachRun(run.id, {
      sourcingTraceSummary: traceSummary,
    });
  };

  if (run.status === "queued") {
    await updateOutreachRun(run.id, { status: "sourcing", lastError: "" });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "sourcing");
    await createOutreachEvent({ runId: run.id, eventType: "run_started", payload: {} });
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_requested",
      payload: {
        strategy: "dynamic_store_chain",
        maxLeads,
        sampleOnly,
      },
    });
    await setTrace({
      phase: "plan_sourcing",
      selectedActorIds: [],
      lastActorInputError: "",
      failureStep: "",
      budgetUsedUsd: 0,
    });
  } else if (traceBase) {
    traceSummary = {
      phase: traceBase.phase,
      selectedActorIds: [...traceBase.selectedActorIds],
      lastActorInputError: traceBase.lastActorInputError,
      failureStep: traceBase.failureStep,
      budgetUsedUsd: traceBase.budgetUsedUsd,
    };
  }

  if (!targetAudience) {
    await setTrace({ phase: "failed", failureStep: "plan_sourcing" });
    await failRunWithDiagnostics({
      run,
      reason: "Target Audience is empty for this hypothesis",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  if (!sourcingToken) {
    await setTrace({
      phase: "failed",
      failureStep: "plan_sourcing",
      lastActorInputError: "Lead sourcing credentials are missing",
    });
    await failRunWithDiagnostics({
      run,
      reason: "Lead sourcing credentials are missing",
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  const actorSchemaCache: ActorSchemaProfileCache = new Map();

  let qualityPolicy: LeadQualityPolicy;
  try {
    qualityPolicy = await generateAdaptiveLeadQualityPolicy({
      brandName: brand?.name ?? "",
      brandWebsite: brand?.website ?? "",
      targetAudience,
      offer: offerContext,
      experimentName: experiment.name ?? "",
    });
  } catch (error) {
    await setTrace({
      phase: "failed",
      failureStep: "plan_sourcing",
      lastActorInputError: error instanceof Error ? error.message : "quality_policy_failed",
    });
    await failRunWithDiagnostics({
      run,
      reason: `Adaptive lead quality policy generation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  let actorPoolResult: Awaited<ReturnType<typeof buildApifyActorPool>>;
  try {
    actorPoolResult = await buildApifyActorPool({
      targetAudience,
      offer: offerContext,
      brandName: brand?.name ?? "",
      brandWebsite: brand?.website ?? "",
      experimentName: experiment.name ?? "",
    });
  } catch (error) {
    await setTrace({
      phase: "failed",
      failureStep: "plan_sourcing",
      lastActorInputError: error instanceof Error ? error.message : "actor_pool_failed",
    });
    await failRunWithDiagnostics({
      run,
      reason: `Actor discovery failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      eventType: "lead_sourcing_failed",
    });
    return;
  }

  if (!actorPoolResult.actors.length) {
    await setTrace({ phase: "failed", failureStep: "plan_sourcing" });
    await failRunWithDiagnostics({
      run,
      reason: "No Apify actors found for this experiment audience",
      eventType: "lead_sourcing_failed",
      payload: {
        queriesTried: actorPoolResult.searchDiagnostics,
      },
    });
    return;
  }

  const actorMemory = await getSourcingActorMemory(actorPoolResult.actors.map((actor) => actor.actorId));
  const rankedActorPool = rankActorPoolWithMemory({
    actors: actorPoolResult.actors,
    memoryRows: actorMemory,
  });
  const topActorPool = rankedActorPool.slice(0, APIFY_STORE_MAX_RESULTS);
  const actorProfiles = await fetchActorProfiles(
    topActorPool.map((actor) => actor.actorId),
    sourcingToken
  );

  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourcing_actor_pool_built",
    payload: {
      queryPlanMode: actorPoolResult.queryPlanMode,
      queryPlan: actorPoolResult.queryPlan,
      queriesTried: actorPoolResult.searchDiagnostics,
      actorCount: topActorPool.length,
      actorProfiles: actorProfiles.size,
      qualityPolicy,
    },
  });

  let chainCandidates: LeadSourcingChainPlan[];
  try {
    chainCandidates = await planApifyLeadChainCandidates({
      targetAudience,
      brandName: brand?.name ?? "",
      brandWebsite: brand?.website ?? "",
      experimentName: experiment.name ?? "",
      offer: offerContext,
      actorPool: topActorPool,
      maxCandidates: APIFY_CHAIN_MAX_CANDIDATES,
    });
  } catch (error) {
    await setTrace({
      phase: "failed",
      failureStep: "plan_sourcing",
      lastActorInputError: error instanceof Error ? error.message : "chain_plan_failed",
    });
    await failRunWithDiagnostics({
      run,
      reason: `Lead-sourcing chain planning failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      eventType: "lead_sourcing_failed",
      payload: { actorPoolCount: topActorPool.length },
    });
    return;
  }

  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourcing_chain_planned",
    payload: {
      candidateCount: chainCandidates.length,
      candidates: chainCandidates.map((candidate) => ({
        id: candidate.id,
        strategy: candidate.strategy,
        rationale: candidate.rationale,
        steps: candidate.steps,
      })),
    },
  });

  await setTrace({ phase: "probe_chain" });

  const probedCandidates: ProbedSourcingPlan[] = [];
  let budgetUsedUsd = 0;
  let apifyQuotaHardStop = false;
  for (const planCandidate of chainCandidates) {
    const remainingBudget = APIFY_PROBE_BUDGET_USD - budgetUsedUsd;
    if (remainingBudget < APIFY_PROBE_STEP_COST_ESTIMATE_USD) {
      break;
    }
    const probed = await probeSourcingPlanCandidate({
      plan: planCandidate,
      targetAudience,
      token: sourcingToken,
      qualityPolicy,
      remainingBudgetUsd: remainingBudget,
      actorSchemaCache,
    });
    probedCandidates.push(probed);
    budgetUsedUsd += probed.budgetUsedUsd;
    await createOutreachEvent({
      runId: run.id,
      eventType: "lead_sourcing_probe_completed",
      payload: {
        candidateId: planCandidate.id,
        strategy: planCandidate.strategy,
        acceptedCount: probed.acceptedCount,
        rejectedCount: probed.rejectedCount,
        score: probed.score,
        budgetUsedUsd: probed.budgetUsedUsd,
        reason: probed.reason,
        topRejections: summarizeTopReasons(probed.rejectedLeads),
      },
    });

    if (
      probed.probeResults.some(
        (result) =>
          result.outcome === "fail" &&
          isApifyQuotaExceededErrorText((result.details as Record<string, unknown>)?.error)
      )
    ) {
      apifyQuotaHardStop = true;
      break;
    }
  }

  await setTrace({ phase: "probe_chain", budgetUsedUsd });

  if (!probedCandidates.length) {
    await setTrace({ phase: "failed", failureStep: "probe_chain", budgetUsedUsd });
    await failRunWithDiagnostics({
      run,
      reason: "No chain candidate could be probed within the budget cap",
      eventType: "lead_sourcing_failed",
      payload: { budgetUsedUsd, budgetCapUsd: APIFY_PROBE_BUDGET_USD },
    });
    return;
  }

  const decision = await createSourcingChainDecision({
    brandId: run.brandId,
    experimentOwnerId: run.ownerId,
    runtimeCampaignId: run.campaignId,
    runtimeExperimentId: run.experimentId,
    runId: run.id,
    strategy: "pending_selection",
    rationale: "Probe completed. Awaiting chain selection.",
    budgetUsedUsd,
    qualityPolicy,
    selectedChain: [],
    probeSummary: {
      candidateCount: chainCandidates.length,
      probedCount: probedCandidates.length,
      budgetCapUsd: APIFY_PROBE_BUDGET_USD,
      selectedPlanId: "",
      selectionStatus: "pending",
    },
  });

  const flattenedProbeRows = probedCandidates.flatMap((candidate) =>
    candidate.probeResults.map((result) => ({
      decisionId: decision.id,
      brandId: run.brandId,
      experimentOwnerId: run.ownerId,
      runId: run.id,
      stepIndex: result.stepIndex,
      actorId: result.actorId,
      stage: result.stage,
      probeInputHash: result.probeInputHash,
      outcome: result.outcome,
      qualityMetrics: {
        ...result.qualityMetrics,
        candidateId: candidate.plan.id,
        candidateScore: candidate.score,
        candidateReason: candidate.reason,
      },
      costEstimateUsd: result.costEstimateUsd,
      details: {
        ...result.details,
        strategy: candidate.plan.strategy,
      },
    }))
  );
  if (flattenedProbeRows.length) {
    await createSourcingProbeResults(flattenedProbeRows);
  }
  const probeMemoryUpdates = buildProbeMemoryUpdates(probedCandidates);
  if (probeMemoryUpdates.length) {
    await upsertSourcingActorMemory(probeMemoryUpdates);
  }

  let selectedPlanMeta: { selectedPlanId: string; rationale: string };
  try {
    const hasViableCandidate = probedCandidates.some(
      (candidate) => candidate.acceptedCount > 0 && candidate.reason === ""
    );
    if (!hasViableCandidate && apifyQuotaHardStop) {
      throw new Error(
        "Apify account monthly usage hard limit exceeded. Increase Apify usage limits or switch to a funded Apify account."
      );
    }
    selectedPlanMeta = await selectBestProbedChain({
      targetAudience,
      offer: offerContext,
      candidates: probedCandidates,
    });
  } catch (error) {
    await updateSourcingChainDecision(decision.id, {
      rationale: error instanceof Error ? error.message : "chain_selection_failed",
      probeSummary: {
        candidateCount: chainCandidates.length,
        probedCount: probedCandidates.length,
        budgetCapUsd: APIFY_PROBE_BUDGET_USD,
        selectedPlanId: "",
        selectionStatus: "failed",
        selectionReason: error instanceof Error ? error.message : "chain_selection_failed",
      },
    });
    await setTrace({
      phase: "failed",
      failureStep: "probe_chain",
      lastActorInputError: error instanceof Error ? error.message : "chain_selection_failed",
      budgetUsedUsd,
    });
    await failRunWithDiagnostics({
      run,
      reason: `Chain selection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      eventType: "lead_sourcing_failed",
      payload: {
        decisionId: decision.id,
        candidateCount: probedCandidates.length,
        budgetUsedUsd,
      },
    });
    return;
  }

  const selectedProbed = probedCandidates.find((candidate) => candidate.plan.id === selectedPlanMeta.selectedPlanId);
  if (!selectedProbed) {
    await updateSourcingChainDecision(decision.id, {
      rationale: "Selected plan id missing from probed candidates",
      probeSummary: {
        candidateCount: chainCandidates.length,
        probedCount: probedCandidates.length,
        budgetCapUsd: APIFY_PROBE_BUDGET_USD,
        selectedPlanId: selectedPlanMeta.selectedPlanId,
        selectionStatus: "failed",
        selectionReason: "selected_plan_missing",
      },
    });
    await setTrace({
      phase: "failed",
      failureStep: "probe_chain",
      lastActorInputError: "selected_plan_missing",
      budgetUsedUsd,
    });
    await failRunWithDiagnostics({
      run,
      reason: "Selected sourcing chain is not available after probing",
      eventType: "lead_sourcing_failed",
      payload: { decisionId: decision.id },
    });
    return;
  }

  await updateSourcingChainDecision(decision.id, {
    strategy: selectedProbed.plan.strategy,
    rationale: selectedPlanMeta.rationale || selectedProbed.plan.rationale,
    budgetUsedUsd,
    qualityPolicy,
    selectedChain: normalizeSourcingChainSteps(selectedProbed.plan.steps),
    probeSummary: {
      candidateCount: chainCandidates.length,
      probedCount: probedCandidates.length,
      budgetCapUsd: APIFY_PROBE_BUDGET_USD,
      selectedPlanId: selectedProbed.plan.id,
      selectionStatus: "selected",
    },
  });

  await setTrace({
    phase: "execute_chain",
    selectedActorIds: selectedProbed.plan.steps.map((step) => step.actorId),
    budgetUsedUsd,
    failureStep: "",
    lastActorInputError: "",
  });

  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourcing_chain_selected",
    payload: {
      decisionId: decision.id,
      selectedPlanId: selectedProbed.plan.id,
      selectedRationale: selectedPlanMeta.rationale,
      selectedChain: selectedProbed.plan.steps,
      budgetUsedUsd,
    },
  });

  const execution = await executeSourcingPlan({
    plan: selectedProbed.plan,
    targetAudience,
    token: sourcingToken,
    maxLeads,
    qualityPolicy,
    actorSchemaCache,
  });

  if (!execution.ok) {
    await upsertSourcingActorMemory(
      selectedProbed.plan.steps.map((step) => ({
        actorId: step.actorId,
        failDelta: 1,
        compatibilityFailDelta: execution.reason.includes("incompatible") ? 1 : 0,
        qualitySample: 0,
      }))
    );
    await setTrace({
      phase: "failed",
      failureStep: "execute_chain",
      lastActorInputError: execution.lastActorInputError || execution.reason,
      budgetUsedUsd,
    });
    await failRunWithDiagnostics({
      run,
      reason: execution.reason,
      eventType: "lead_sourcing_failed",
      payload: {
        decisionId: decision.id,
        selectedPlanId: selectedProbed.plan.id,
        stepDiagnostics: execution.stepDiagnostics,
        topRejections: summarizeTopReasons(execution.rejectedLeads),
      },
    });
    return;
  }

  const acceptanceRatio =
    execution.leads.length + execution.rejectedLeads.length > 0
      ? execution.leads.length / (execution.leads.length + execution.rejectedLeads.length)
      : 0;
  await upsertSourcingActorMemory(
    selectedProbed.plan.steps.map((step) => ({
      actorId: step.actorId,
      successDelta: 1,
      leadsAcceptedDelta: execution.leads.length,
      leadsRejectedDelta: execution.rejectedLeads.length,
      qualitySample: acceptanceRatio,
    }))
  );

  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourcing_completed",
    payload: {
      decisionId: decision.id,
      strategy: selectedProbed.plan.strategy,
      selectedChain: selectedProbed.plan.steps,
      sourcedCount: execution.leads.length,
      rejectedCount: execution.rejectedLeads.length,
      topRejections: summarizeTopReasons(execution.rejectedLeads),
      stepDiagnostics: execution.stepDiagnostics,
    },
  });

  await setTrace({
    phase: "completed",
    selectedActorIds: selectedProbed.plan.steps.map((step) => step.actorId),
    budgetUsedUsd,
    failureStep: "",
    lastActorInputError: "",
  });

  await finishSourcingWithLeads(run, execution.leads, {
    sampleOnly,
    qualityPolicy,
    rejectedDecisions: execution.rejectedLeads,
    decision,
  });
  return;
}

async function finishSourcingWithLeads(
  run: NonNullable<Awaited<ReturnType<typeof getOutreachRun>>>,
  leads: ApifyLead[],
  options: {
    sampleOnly?: boolean;
    qualityPolicy?: LeadQualityPolicy;
    rejectedDecisions?: LeadAcceptanceDecision[];
    decision?: SourcingChainDecision | null;
  } = {}
) {
  const recentRuns = (await listCampaignRuns(run.brandId, run.campaignId)).filter((item) => {
    if (item.id === run.id) return false;
    const ageMs = Date.now() - new Date(item.createdAt).getTime();
    return ageMs <= 14 * DAY_MS;
  });
  const blockedEmails = new Set<string>();
  for (const recent of recentRuns) {
    const recentLeads = await listRunLeads(recent.id);
    for (const lead of recentLeads) {
      if (["scheduled", "sent", "replied", "bounced", "unsubscribed"].includes(lead.status)) {
        blockedEmails.add(lead.email.toLowerCase());
      }
    }
  }

  const suppressionCounts: Record<string, number> = {
    duplicate_14_day: 0,
    invalid_email: 0,
    placeholder_domain: 0,
    role_account: 0,
    policy_rejected: 0,
  };

  const filteredLeads: ApifyLead[] = [];
  const policyRejections = options.rejectedDecisions ?? [];
  for (const lead of leads) {
    const normalizedEmail = lead.email.toLowerCase();
    const suppressionReason = getLeadEmailSuppressionReason(normalizedEmail);
    if (suppressionReason) {
      suppressionCounts[suppressionReason] = (suppressionCounts[suppressionReason] ?? 0) + 1;
      continue;
    }
    if (blockedEmails.has(normalizedEmail)) {
      suppressionCounts.duplicate_14_day += 1;
      continue;
    }
    if (options.qualityPolicy) {
      const decision = evaluateLeadAgainstQualityPolicy({
        lead,
        policy: options.qualityPolicy,
      });
      if (!decision.accepted) {
        suppressionCounts.policy_rejected += 1;
        policyRejections.push(decision);
        continue;
      }
    }
    filteredLeads.push(lead);
  }

  if (!filteredLeads.length) {
    await failRunWithDiagnostics({
      run,
      reason: "All sourced leads were suppressed by quality/duplicate rules",
      eventType: "lead_sourcing_failed",
      payload: {
        sourcedCount: leads.length,
        blockedCount: leads.length,
        suppressionCounts,
        topPolicyRejections: summarizeTopReasons(policyRejections),
        decisionId: options.decision?.id ?? "",
      },
    });
    return;
  }

  const upserted = await upsertRunLeads(
    run.id,
    run.brandId,
    run.campaignId,
    filteredLeads.map((lead) => ({
      email: lead.email,
      name: lead.name,
      company: lead.company,
      title: lead.title,
      domain: lead.domain,
      sourceUrl: lead.sourceUrl,
    }))
  );

  if (!upserted.length) {
    await failRunWithDiagnostics({
      run,
      reason: "Lead persistence failed (0 leads stored)",
      eventType: "lead_sourcing_failed",
      payload: {
        attempted: filteredLeads.length,
      },
    });
    return;
  }

  await updateOutreachRun(run.id, {
    status: options.sampleOnly ? "completed" : "scheduled",
    lastError: "",
    completedAt: options.sampleOnly ? nowIso() : "",
    metrics: {
      ...run.metrics,
      sourcedLeads: upserted.length,
    },
  });
  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourced_apify",
    payload: {
      count: upserted.length,
      blockedCount: Math.max(0, leads.length - filteredLeads.length),
      suppressionCounts,
      topPolicyRejections: summarizeTopReasons(policyRejections),
      sampleOnly: options.sampleOnly === true,
      decisionId: options.decision?.id ?? "",
    },
  });

  if (!options.sampleOnly) {
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "schedule_messages",
      executeAfter: nowIso(),
    });
  } else {
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "completed");
  }
}

async function processScheduleMessagesJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["paused", "completed", "canceled", "failed", "preflight_failed"].includes(run.status)) return;

  const existingMessages = await listRunMessages(run.id);
  if (existingMessages.length) {
    await updateOutreachRun(run.id, {
      lastError: "",
      metrics: {
        ...run.metrics,
        scheduledMessages: Math.max(run.metrics.scheduledMessages, existingMessages.length),
      },
    });
    await createOutreachEvent({
      runId: run.id,
      eventType: "message_scheduling_skipped",
      payload: { reason: "messages_already_exist", count: existingMessages.length },
    });
    return;
  }

  const campaign = await getCampaignById(run.brandId, run.campaignId);
  if (!campaign) {
    await failRunWithDiagnostics({
      run,
      reason: "Campaign not found",
      eventType: "schedule_failed",
    });
    return;
  }

  const brand = await getBrandById(run.brandId);
  const hypothesis = findHypothesis(campaign, run.hypothesisId);
  const experiment = findExperiment(campaign, run.experimentId);
  if (!hypothesis || !experiment) {
    await failRunWithDiagnostics({
      run,
      reason: "Hypothesis or experiment missing",
      eventType: "schedule_failed",
    });
    return;
  }
  const runtimeExperiment = await getExperimentRecordByRuntimeRef(run.brandId, run.campaignId, run.experimentId);
  const parsedOffer = parseOfferAndCta(runtimeExperiment?.offer ?? "");
  const experimentOffer = parsedOffer.offer || runtimeExperiment?.offer || "";
  const experimentCta = parsedOffer.cta;
  const experimentAudience = runtimeExperiment?.audience || hypothesis.actorQuery;

  const leads = await listRunLeads(run.id);
  if (!leads.length) {
    await failRunWithDiagnostics({
      run,
      reason: "No leads sourced",
      eventType: "schedule_failed",
      payload: { sourcedLeads: run.metrics.sourcedLeads },
    });
    return;
  }

  const flowMap = await getPublishedConversationMapForExperiment(run.brandId, run.campaignId, run.experimentId);
  const hasConversationMap = Boolean(flowMap?.publishedRevision);
  let scheduledMessagesCount = 0;

  if (hasConversationMap && flowMap) {
    const graph = flowMap.publishedGraph;
    const startNode = conversationNodeById(graph, graph.startNodeId);
    if (!startNode) {
      await failRunWithDiagnostics({
        run,
        reason: "Conversation flow start node is invalid",
        eventType: "schedule_failed",
      });
      return;
    }

    const existingConversationMessages = await listRunMessages(run.id);
    const campaignGoal = campaign.objective.goal.trim();
    const brandName = brand?.name ?? "";

    let firstScheduleFailureReason = "";
    for (const [index, lead] of leads.entries()) {
      let session = await getConversationSessionByLead({ runId: run.id, leadId: lead.id });
      if (!session) {
        session = await createConversationSession({
          runId: run.id,
          brandId: run.brandId,
          campaignId: run.campaignId,
          leadId: lead.id,
          mapId: flowMap.id,
          mapRevision: flowMap.publishedRevision,
          startNodeId: graph.startNodeId,
        });
        await createConversationEvent({
          sessionId: session.id,
          runId: run.id,
          eventType: "session_started",
          payload: {
            nodeId: graph.startNodeId,
            mapRevision: flowMap.publishedRevision,
          },
        });
      }

      if (session.state === "completed" || session.state === "failed") continue;
      if (startNode.kind === "terminal") {
        await updateConversationSession(session.id, {
          state: "completed",
          endedReason: "start_node_terminal",
          currentNodeId: startNode.id,
          turnCount: Math.max(session.turnCount, 1),
          lastNodeEnteredAt: nowIso(),
        });
        await createConversationEvent({
          sessionId: session.id,
          runId: run.id,
          eventType: "session_completed",
          payload: {
            reason: "start_node_terminal",
          },
        });
        continue;
      }

      if (!startNode.autoSend) {
        await updateConversationSession(session.id, {
          state: "waiting_manual",
          currentNodeId: startNode.id,
          turnCount: Math.max(session.turnCount, 1),
          lastNodeEnteredAt: nowIso(),
        });
        await createConversationEvent({
          sessionId: session.id,
          runId: run.id,
          eventType: "manual_node_required",
          payload: {
            nodeId: startNode.id,
            reason: "start_node_auto_send_disabled",
          },
        });
        continue;
      }

      const scheduled = await scheduleConversationNodeMessage({
        run,
        lead,
        sessionId: session.id,
        node: startNode,
        step: 1,
        brandName,
        brandWebsite: brand?.website ?? "",
        brandTone: brand?.tone ?? "",
        brandNotes: brand?.notes ?? "",
        campaignName: campaign.name,
        campaignGoal,
        campaignConstraints: campaign.objective.constraints ?? "",
        variantId: experiment.id,
        variantName: experiment.name,
        experimentOffer,
        experimentCta,
        experimentAudience,
        experimentNotes: experiment.notes ?? "",
        maxDepth: graph.maxDepth,
        waitMinutes: index * run.minSpacingMinutes,
        existingMessages: existingConversationMessages,
      });
      if (scheduled.ok) {
        scheduledMessagesCount += 1;
        await updateConversationSession(session.id, {
          state: "active",
          currentNodeId: startNode.id,
          turnCount: Math.max(session.turnCount, 1),
          lastNodeEnteredAt: nowIso(),
        });
        await createConversationEvent({
          sessionId: session.id,
          runId: run.id,
          eventType: "node_message_scheduled",
          payload: {
            nodeId: startNode.id,
            autoSend: true,
          },
        });
      } else if (!firstScheduleFailureReason) {
        firstScheduleFailureReason = scheduled.reason;
      }
    }

    if (scheduledMessagesCount === 0) {
      await failRunWithDiagnostics({
        run,
        reason:
          firstScheduleFailureReason ||
          "No valid messages were scheduled from the published Conversation Map",
        eventType: "schedule_failed",
      });
      return;
    }

    await createOutreachEvent({
      runId: run.id,
      eventType: "message_scheduled",
      payload: {
        count: scheduledMessagesCount,
        mode: "conversation_map",
      },
    });
  } else {
    await failRunWithDiagnostics({
      run,
      reason:
        "No published conversation map for this variant. Build and publish a Conversation Map before launching.",
      eventType: "schedule_failed",
      payload: {
        hasConversationMap: false,
        experimentId: run.experimentId,
      },
    });
    return;
  }

  await updateOutreachRun(run.id, {
    status: "scheduled",
    metrics: {
      ...run.metrics,
      scheduledMessages: Math.max(run.metrics.scheduledMessages, scheduledMessagesCount),
    },
  });
  await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "scheduled");
  await enqueueOutreachJob({ runId: run.id, jobType: "dispatch_messages", executeAfter: nowIso() });
  if (hasConversationMap) {
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "conversation_tick",
      executeAfter: addMinutes(nowIso(), CONVERSATION_TICK_MINUTES),
    });
  }
  await enqueueOutreachJob({ runId: run.id, jobType: "analyze_run", executeAfter: addHours(nowIso(), 1) });
  await enqueueOutreachJob({ runId: run.id, jobType: "sync_replies", executeAfter: addHours(nowIso(), 1) });
}

function nextDispatchTime(messages: Awaited<ReturnType<typeof listRunMessages>>) {
  const pending = messages
    .filter((item) => item.status === "scheduled")
    .sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1));
  return pending[0]?.scheduledAt ?? "";
}

async function processDispatchMessagesJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["paused", "completed", "canceled", "failed", "preflight_failed"].includes(run.status)) {
    return;
  }

  const account = await getOutreachAccount(run.accountId);
  const secrets = await getOutreachAccountSecrets(run.accountId);
  if (!account || !secrets) {
    await failRunWithDiagnostics({
      run,
      reason: "Account credentials missing",
      eventType: "dispatch_failed",
    });
    return;
  }

  const assignment = await getBrandOutreachAssignment(run.brandId);
  const mailboxAccountId = String(assignment?.mailboxAccountId ?? "").trim();
  if (!mailboxAccountId) {
    await failRunWithDiagnostics({
      run,
      reason: "Reply mailbox assignment is required for sending",
      eventType: "dispatch_failed",
    });
    return;
  }
  const mailboxAccount =
    mailboxAccountId === account.id ? account : await getOutreachAccount(mailboxAccountId);
  if (!mailboxAccount || mailboxAccount.status !== "active") {
    await failRunWithDiagnostics({
      run,
      reason: "Assigned reply mailbox account is missing or inactive",
      eventType: "dispatch_failed",
    });
    return;
  }
  const replyToEmail = mailboxAccount.config.mailbox.email.trim();
  if (!replyToEmail) {
    await failRunWithDiagnostics({
      run,
      reason: "Assigned reply mailbox email is empty",
      eventType: "dispatch_failed",
    });
    return;
  }
  if (!account.config.customerIo.fromEmail.trim()) {
    await failRunWithDiagnostics({
      run,
      reason: "Customer.io From Email is empty",
      eventType: "dispatch_failed",
    });
    return;
  }

  await updateOutreachRun(run.id, { status: "sending" });
  await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "sending");

  const messages = await listRunMessages(run.id);
  const leads = await listRunLeads(run.id);
  const due = messages.filter(
    (message) => message.status === "scheduled" && toDate(message.scheduledAt).getTime() <= Date.now()
  );
  if (!due.length) {
    const nextAt = nextDispatchTime(messages);
    if (nextAt) {
      await enqueueOutreachJob({ runId: run.id, jobType: "dispatch_messages", executeAfter: nextAt });
      return;
    }

    await updateOutreachRun(run.id, {
      status: "monitoring",
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "monitoring");
    await enqueueOutreachJob({ runId: run.id, jobType: "analyze_run", executeAfter: addHours(nowIso(), 1) });
    return;
  }

  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const hourlySent = messages.filter(
    (message) => message.status === "sent" && message.sentAt && toDate(message.sentAt).getTime() >= oneHourAgo
  ).length;
  const dailySent = messages.filter(
    (message) => message.status === "sent" && message.sentAt && toDate(message.sentAt).getTime() >= startOfDay.getTime()
  ).length;

  const hourlySlots = Math.max(0, run.hourlyCap - hourlySent);
  const dailySlots = Math.max(0, run.dailyCap - dailySent);
  const available = Math.max(0, Math.min(hourlySlots, dailySlots));

  if (available <= 0) {
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "dispatch_messages",
      executeAfter: addHours(nowIso(), 1),
    });
    return;
  }

  for (const message of due.slice(0, available)) {
    const lead = leads.find((item) => item.id === message.leadId);
    if (!lead || !lead.email) {
      await updateRunMessage(message.id, {
        status: "failed",
        lastError: "Lead email missing",
      });
      continue;
    }
    const suppressionReason = getLeadEmailSuppressionReason(lead.email);
    if (suppressionReason) {
      const reasonText =
        suppressionReason === "role_account"
          ? "Lead blocked: role-based inbox"
          : suppressionReason === "placeholder_domain"
            ? "Lead blocked: placeholder/test domain"
            : "Lead blocked: invalid email";
      await updateRunMessage(message.id, {
        status: "canceled",
        lastError: reasonText,
      });
      await updateRunLead(lead.id, { status: "suppressed" });
      await createOutreachEvent({
        runId: run.id,
        eventType: "lead_suppressed_before_send",
        payload: {
          reason: reasonText,
          suppressionReason,
          email: lead.email,
          messageId: message.id,
        },
      });
      continue;
    }
    if (["unsubscribed", "bounced", "suppressed"].includes(lead.status)) {
      await updateRunMessage(message.id, {
        status: "canceled",
        lastError: `Lead blocked by suppression status: ${lead.status}`,
      });
      continue;
    }

    const send = await sendOutreachMessage({
      message,
      account,
      secrets,
      replyToEmail,
      recipient: lead.email,
      runId: run.id,
      experimentId: run.experimentId,
    });

    if (send.ok) {
      await updateRunMessage(message.id, {
        status: "sent",
        providerMessageId: send.providerMessageId,
        sentAt: nowIso(),
        lastError: "",
      });
      await updateRunLead(lead.id, { status: "sent" });
      await createOutreachEvent({
        runId: run.id,
        eventType: "message_sent",
        payload: {
          messageId: message.id,
          sourceType: message.sourceType,
          nodeId: message.nodeId,
          sessionId: message.sessionId,
        },
      });
    } else {
      await updateRunMessage(message.id, {
        status: "failed",
        lastError: send.error,
      });
      await createOutreachEvent({
        runId: run.id,
        eventType: "dispatch_failed",
        payload: {
          messageId: message.id,
          sourceType: message.sourceType,
          nodeId: message.nodeId,
          sessionId: message.sessionId,
          error: send.error,
        },
      });
    }
  }

  const refreshedMessages = await listRunMessages(run.id);
  const { threads } = await listReplyThreadsByBrand(run.brandId);
  const metrics = calculateRunMetricsFromMessages(run.id, refreshedMessages, threads);

  await updateOutreachRun(run.id, {
    status: "sending",
    metrics: {
      ...run.metrics,
      sentMessages: metrics.sentMessages,
      bouncedMessages: metrics.bouncedMessages,
      failedMessages: metrics.failedMessages,
      replies: metrics.replies,
      positiveReplies: metrics.positiveReplies,
      negativeReplies: metrics.negativeReplies,
    },
  });

  const nextAt = nextDispatchTime(refreshedMessages);
  if (nextAt) {
    await enqueueOutreachJob({ runId: run.id, jobType: "dispatch_messages", executeAfter: nextAt });
  } else {
    await updateOutreachRun(run.id, {
      status: "monitoring",
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "monitoring");
    await enqueueOutreachJob({ runId: run.id, jobType: "analyze_run", executeAfter: addHours(nowIso(), 1) });
  }
}

async function processSyncRepliesJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["completed", "canceled", "failed", "preflight_failed"].includes(run.status)) return;

  await createOutreachEvent({
    runId: run.id,
    eventType: "reply_sync_tick",
    payload: {
      note: "Mailbox sync should post replies via webhook endpoint",
    },
  });

  await enqueueOutreachJob({
    runId: run.id,
    jobType: "sync_replies",
    executeAfter: addHours(nowIso(), 1),
  });
}

async function processConversationTickJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["paused", "completed", "canceled", "failed", "preflight_failed"].includes(run.status)) return;

  const map = await getPublishedConversationMapForExperiment(run.brandId, run.campaignId, run.experimentId);
  if (!map?.publishedRevision) return;

  const graph = map.publishedGraph;
  const sessions = await listConversationSessionsByRun(run.id);
  if (!sessions.length) return;

  const leads = await listRunLeads(run.id);
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const messages = await listRunMessages(run.id);
  const [brand, campaign] = await Promise.all([
    getBrandById(run.brandId),
    getCampaignById(run.brandId, run.campaignId),
  ]);
  const brandName = brand?.name ?? "";
  const campaignGoal = campaign?.objective.goal ?? "";
  const variant = campaign?.experiments.find((item) => item.id === run.experimentId) ?? null;
  const variantName = variant?.name ?? "";
  const hypothesis = variant
    ? campaign?.hypotheses.find((item) => item.id === variant.hypothesisId) ?? null
    : null;
  const runtimeExperiment = await getExperimentRecordByRuntimeRef(run.brandId, run.campaignId, run.experimentId);
  const parsedOffer = parseOfferAndCta(runtimeExperiment?.offer ?? "");
  const experimentOffer = parsedOffer.offer || runtimeExperiment?.offer || "";
  const experimentCta = parsedOffer.cta;
  const experimentAudience = runtimeExperiment?.audience || hypothesis?.actorQuery || "";

  let scheduledCount = 0;
  let completedCount = 0;
  let failedCount = 0;

  for (const session of sessions) {
    if (session.state !== "active") continue;

    const currentNode = conversationNodeById(graph, session.currentNodeId);
    if (!currentNode) {
      await updateConversationSession(session.id, {
        state: "failed",
        endedReason: "current_node_missing",
      });
      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "session_failed",
        payload: {
          reason: "current_node_missing",
          nodeId: session.currentNodeId,
        },
      });
      failedCount += 1;
      continue;
    }

    const timerEdge = pickDueTimerEdge({
      graph,
      currentNodeId: currentNode.id,
      lastNodeEnteredAt: session.lastNodeEnteredAt,
    });
    if (!timerEdge) continue;

    const nextNode = conversationNodeById(graph, timerEdge.toNodeId);
    if (!nextNode) {
      await updateConversationSession(session.id, {
        state: "failed",
        endedReason: "timer_target_missing",
      });
      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "session_failed",
        payload: {
          reason: "timer_target_missing",
          edgeId: timerEdge.id,
        },
      });
      failedCount += 1;
      continue;
    }

    const nextTurn = session.turnCount + 1;
    const maxDepthReached = nextTurn >= graph.maxDepth;

    if (nextNode.kind === "terminal" || maxDepthReached) {
      await updateConversationSession(session.id, {
        state: "completed",
        currentNodeId: nextNode.id,
        turnCount: nextTurn,
        lastNodeEnteredAt: nowIso(),
        endedReason: maxDepthReached ? "max_depth_reached" : "terminal_node",
      });
      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "session_completed",
        payload: {
          reason: maxDepthReached ? "max_depth_reached" : "terminal_node",
          nodeId: nextNode.id,
        },
      });
      completedCount += 1;
      continue;
    }

    const nextState = nextNode.autoSend ? "active" : "waiting_manual";
    await updateConversationSession(session.id, {
      state: nextState,
      currentNodeId: nextNode.id,
      turnCount: nextTurn,
      lastNodeEnteredAt: nowIso(),
      endedReason: "",
    });
    await createConversationEvent({
      sessionId: session.id,
      runId: run.id,
      eventType: "session_transition",
      payload: {
        trigger: "timer",
        fromNodeId: currentNode.id,
        toNodeId: nextNode.id,
        edgeId: timerEdge.id,
      },
    });

    if (!nextNode.autoSend) {
      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "manual_node_required",
        payload: {
          nodeId: nextNode.id,
          reason: "auto_send_disabled",
        },
      });
      continue;
    }

    const lead = leadsById.get(session.leadId);
    if (!lead) continue;

    const scheduled = await scheduleConversationNodeMessage({
      run,
      lead,
      sessionId: session.id,
      node: nextNode,
      step: nextTurn,
      brandName,
      brandWebsite: brand?.website ?? "",
      brandTone: brand?.tone ?? "",
      brandNotes: brand?.notes ?? "",
      campaignName: campaign?.name ?? "",
      campaignGoal,
      campaignConstraints: campaign?.objective.constraints ?? "",
      variantId: variant?.id ?? "",
      variantName,
      experimentOffer,
      experimentCta,
      experimentAudience,
      experimentNotes: variant?.notes ?? "",
      maxDepth: graph.maxDepth,
      waitMinutes: 0,
      existingMessages: messages,
    });
    if (scheduled.ok) {
      scheduledCount += 1;
      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "node_message_scheduled",
        payload: {
          nodeId: nextNode.id,
          trigger: "timer",
        },
      });
    } else {
      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "node_schedule_failed",
        payload: {
          nodeId: nextNode.id,
          trigger: "timer",
          reason: scheduled.reason,
        },
      });
    }
  }

  if (scheduledCount > 0) {
    await updateOutreachRun(run.id, {
      metrics: {
        ...run.metrics,
        scheduledMessages: Math.max(run.metrics.scheduledMessages, messages.length),
      },
    });
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "dispatch_messages",
      executeAfter: nowIso(),
    });
  }

  const refreshedSessions = await listConversationSessionsByRun(run.id);
  const shouldContinue = refreshedSessions.some((session) => session.state === "active");
  if (shouldContinue) {
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "conversation_tick",
      executeAfter: addMinutes(nowIso(), CONVERSATION_TICK_MINUTES),
    });
  }

  await createOutreachEvent({
    runId: run.id,
    eventType: "conversation_tick_processed",
    payload: {
      sessions: refreshedSessions.length,
      scheduledCount,
      completedCount,
      failedCount,
      continuing: shouldContinue,
    },
  });
}

async function processAnalyzeRunJob(job: OutreachJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (["canceled", "completed", "failed", "preflight_failed"].includes(run.status)) return;

  const messages = await listRunMessages(run.id);
  const { threads } = await listReplyThreadsByBrand(run.brandId);
  const metrics = calculateRunMetricsFromMessages(run.id, messages, threads);

  const delivered = Math.max(1, metrics.sentMessages + metrics.bouncedMessages);
  const attempted = Math.max(1, metrics.sentMessages + metrics.failedMessages + metrics.bouncedMessages);
  const replyCount = Math.max(1, metrics.replies);

  const bounceRate = metrics.bouncedMessages / delivered;
  const providerErrorRate = metrics.failedMessages / attempted;
  const negativeReplyRate = metrics.negativeReplies / replyCount;

  let paused = false;

  if (metrics.bouncedMessages >= 5 && bounceRate > 0.05) {
    paused = true;
    await createRunAnomaly({
      runId: run.id,
      type: "hard_bounce_rate",
      severity: "critical",
      threshold: 0.05,
      observed: bounceRate,
      details: "Hard bounce rate exceeded 5%.",
    });
  }

  if (!paused && providerErrorRate > 0.2) {
    paused = true;
    await createRunAnomaly({
      runId: run.id,
      type: "provider_error_rate",
      severity: "critical",
      threshold: 0.2,
      observed: providerErrorRate,
      details: "Provider error rate exceeded 20%.",
    });
  }

  if (!paused && metrics.replies >= 4 && negativeReplyRate > 0.25) {
    paused = true;
    await createRunAnomaly({
      runId: run.id,
      type: "negative_reply_rate_spike",
      severity: "warning",
      threshold: 0.25,
      observed: negativeReplyRate,
      details: "Negative reply rate spike above 25%.",
    });
  }

  if (paused) {
    await updateOutreachRun(run.id, {
      status: "paused",
      pauseReason: "Auto-paused due to anomaly",
      metrics: {
        ...run.metrics,
        sentMessages: metrics.sentMessages,
        bouncedMessages: metrics.bouncedMessages,
        failedMessages: metrics.failedMessages,
        replies: metrics.replies,
        positiveReplies: metrics.positiveReplies,
        negativeReplies: metrics.negativeReplies,
      },
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "paused");
    await createOutreachEvent({
      runId: run.id,
      eventType: "run_paused_auto",
      payload: { bounceRate, providerErrorRate, negativeReplyRate },
    });
    return;
  }

  const pendingScheduled = messages.some((message) => message.status === "scheduled");
  if (!pendingScheduled) {
    await updateOutreachRun(run.id, {
      status: "completed",
      completedAt: nowIso(),
      metrics: {
        ...run.metrics,
        sentMessages: metrics.sentMessages,
        bouncedMessages: metrics.bouncedMessages,
        failedMessages: metrics.failedMessages,
        replies: metrics.replies,
        positiveReplies: metrics.positiveReplies,
        negativeReplies: metrics.negativeReplies,
      },
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "completed");
    return;
  }

  await updateOutreachRun(run.id, {
    status: "monitoring",
    metrics: {
      ...run.metrics,
      sentMessages: metrics.sentMessages,
      bouncedMessages: metrics.bouncedMessages,
      failedMessages: metrics.failedMessages,
      replies: metrics.replies,
      positiveReplies: metrics.positiveReplies,
      negativeReplies: metrics.negativeReplies,
    },
  });
  await enqueueOutreachJob({
    runId: run.id,
    jobType: "analyze_run",
    executeAfter: addHours(nowIso(), 1),
  });
}

async function processOutreachJob(job: OutreachJob) {
  if (job.jobType === "source_leads") {
    await processSourceLeadsJob(job);
    return;
  }
  if (job.jobType === "schedule_messages") {
    await processScheduleMessagesJob(job);
    return;
  }
  if (job.jobType === "dispatch_messages") {
    await processDispatchMessagesJob(job);
    return;
  }
  if (job.jobType === "sync_replies") {
    await processSyncRepliesJob(job);
    return;
  }
  if (job.jobType === "conversation_tick") {
    await processConversationTickJob(job);
    return;
  }
  await processAnalyzeRunJob(job);
}

export async function runOutreachTick(limit = 20): Promise<{
  processed: number;
  completed: number;
  failed: number;
}> {
  const jobs = await listDueOutreachJobs(limit);

  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    const attempts = job.attempts + 1;
    await updateOutreachJob(job.id, { status: "running", attempts });
    await createOutreachEvent({
      runId: job.runId,
      eventType: "job_started",
      payload: {
        jobId: job.id,
        jobType: job.jobType,
        attempt: attempts,
        maxAttempts: job.maxAttempts,
      },
    });

    try {
      await processOutreachJob(job);
      await updateOutreachJob(job.id, {
        status: "completed",
        lastError: "",
      });
      await createOutreachEvent({
        runId: job.runId,
        eventType: "job_completed",
        payload: {
          jobId: job.id,
          jobType: job.jobType,
          attempt: attempts,
        },
      });
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Job failed";
      if (attempts >= job.maxAttempts) {
        await updateOutreachJob(job.id, {
          status: "failed",
          lastError: message,
        });
      } else {
        const delayMinutes = Math.min(60, attempts * 5);
        const next = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
        await updateOutreachJob(job.id, {
          status: "queued",
          executeAfter: next,
          lastError: message,
        });
      }
      await createOutreachEvent({
        runId: job.runId,
        eventType: "job_failed",
        payload: {
          jobId: job.id,
          jobType: job.jobType,
          attempt: attempts,
          maxAttempts: job.maxAttempts,
          error: message,
          willRetry: attempts < job.maxAttempts,
        },
      });
      failed += 1;
    }
  }

  return {
    processed: jobs.length,
    completed,
    failed,
  };
}

export async function updateRunControl(input: {
  brandId: string;
  campaignId: string;
  runId: string;
  action: "pause" | "resume" | "cancel";
  reason?: string;
}): Promise<{ ok: boolean; reason: string }> {
  const run = await getOutreachRun(input.runId);
  if (!run || run.brandId !== input.brandId || run.campaignId !== input.campaignId) {
    return { ok: false, reason: "Run not found" };
  }

  if (input.action === "pause") {
    await updateOutreachRun(run.id, {
      status: "paused",
      pauseReason: input.reason?.trim() || "Paused by user",
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "paused");
    return { ok: true, reason: "Run paused" };
  }

  if (input.action === "resume") {
    if (run.status !== "paused") {
      return { ok: false, reason: "Run is not paused" };
    }
    await updateOutreachRun(run.id, {
      status: "sending",
      pauseReason: "",
    });
    await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "sending");
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "dispatch_messages",
      executeAfter: nowIso(),
    });
    const map = await getPublishedConversationMapForExperiment(run.brandId, run.campaignId, run.experimentId);
    if (map?.publishedRevision) {
      await enqueueOutreachJob({
        runId: run.id,
        jobType: "conversation_tick",
        executeAfter: addMinutes(nowIso(), CONVERSATION_TICK_MINUTES),
      });
    }
    await createOutreachEvent({ runId: run.id, eventType: "run_resumed_manual", payload: {} });
    return { ok: true, reason: "Run resumed" };
  }

  await updateOutreachRun(run.id, {
    status: "canceled",
    completedAt: nowIso(),
    pauseReason: input.reason?.trim() || "Canceled by user",
  });
  await markExperimentExecutionStatus(run.brandId, run.campaignId, run.experimentId, "failed");
  return { ok: true, reason: "Run canceled" };
}

export async function ingestInboundReply(input: {
  brandId?: string;
  campaignId?: string;
  runId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  providerMessageId?: string;
}): Promise<{ ok: boolean; threadId: string; draftId: string; reason: string }> {
  const run = await getOutreachRun(input.runId);
  if (!run) {
    return { ok: false, threadId: "", draftId: "", reason: "Run not found" };
  }
  const brandId = input.brandId?.trim() ?? run.brandId;
  const campaignId = input.campaignId?.trim() ?? run.campaignId;
  if (run.brandId !== brandId || run.campaignId !== campaignId) {
    return { ok: false, threadId: "", draftId: "", reason: "Run/brand/campaign mismatch" };
  }

  const leads = await listRunLeads(run.id);
  const lead = leads.find((item) => item.email.toLowerCase() === input.from.toLowerCase()) ?? null;
  if (!lead) {
    return { ok: false, threadId: "", draftId: "", reason: "No lead matched for reply" };
  }

  const sentiment = classifySentiment(input.body);
  const { intent, confidence } = classifyIntentConfidence(input.body);

  const { threads } = await listReplyThreadsByBrand(brandId);
  let thread = threads.find(
    (item) =>
      item.runId === run.id &&
      item.leadId === lead.id &&
      item.subject.trim().toLowerCase() === input.subject.trim().toLowerCase()
  );

  if (!thread) {
    thread = await createReplyThread({
      brandId: run.brandId,
      campaignId: run.campaignId,
      runId: run.id,
      leadId: lead.id,
      subject: input.subject,
      sentiment,
      intent,
      status: "new",
    });
  } else {
    const updated = await updateReplyThread(thread.id, {
      sentiment,
      intent,
      status: "open",
      lastMessageAt: nowIso(),
    });
    if (updated) {
      thread = updated;
    }
  }

  const inboundMessage = await createReplyMessage({
    threadId: thread.id,
    runId: run.id,
    direction: "inbound",
    from: input.from,
    to: input.to,
    subject: input.subject,
    body: input.body,
    providerMessageId: input.providerMessageId ?? "",
  });

  let draftId = "";
  let autoBranchScheduled: { ok: boolean; reason: string; messageId: string } = {
    ok: false,
    reason: "",
    messageId: "",
  };
  const [brand, campaign] = await Promise.all([
    getBrandById(run.brandId),
    getCampaignById(run.brandId, run.campaignId),
  ]);
  const variant = campaign?.experiments.find((item) => item.id === run.experimentId) ?? null;
  const hypothesis = variant
    ? campaign?.hypotheses.find((item) => item.id === variant.hypothesisId) ?? null
    : null;
  const runtimeExperiment = await getExperimentRecordByRuntimeRef(run.brandId, run.campaignId, run.experimentId);
  const parsedOffer = parseOfferAndCta(runtimeExperiment?.offer ?? "");
  const experimentOffer = parsedOffer.offer || runtimeExperiment?.offer || "";
  const experimentCta = parsedOffer.cta;
  const experimentAudience = runtimeExperiment?.audience || hypothesis?.actorQuery || "";

  const flowMap = await getPublishedConversationMapForExperiment(run.brandId, run.campaignId, run.experimentId);
  const session = flowMap ? await getConversationSessionByLead({ runId: run.id, leadId: lead.id }) : null;

  if (flowMap?.publishedRevision && session && session.state !== "completed" && session.state !== "failed") {
    const graph = flowMap.publishedGraph;
    const currentNode = conversationNodeById(graph, session.currentNodeId);
    if (currentNode) {
      const intentEdge = pickIntentEdge({
        graph,
        currentNodeId: currentNode.id,
        intent,
        confidence,
      });
      const fallbackEdge = pickFallbackEdge(graph, currentNode.id);
      const selectedEdge = intentEdge ?? fallbackEdge;

      await createConversationEvent({
        sessionId: session.id,
        runId: run.id,
        eventType: "reply_classified",
        payload: {
          intent,
          confidence,
          fromNodeId: currentNode.id,
          selectedEdgeId: selectedEdge?.id ?? "",
        },
      });

      if (selectedEdge) {
        const nextNode = conversationNodeById(graph, selectedEdge.toNodeId);
        if (nextNode) {
          const nextTurn = session.turnCount + 1;
          const maxDepthReached = nextTurn >= graph.maxDepth;
          const shouldComplete =
            intent === "unsubscribe" || nextNode.kind === "terminal" || maxDepthReached;

          if (shouldComplete) {
            await updateConversationSession(session.id, {
              state: "completed",
              currentNodeId: nextNode.id,
              turnCount: nextTurn,
              lastIntent: intent,
              lastConfidence: confidence,
              lastNodeEnteredAt: nowIso(),
              endedReason:
                intent === "unsubscribe"
                  ? "unsubscribe"
                  : maxDepthReached
                    ? "max_depth_reached"
                    : "terminal_node",
            });
            await createConversationEvent({
              sessionId: session.id,
              runId: run.id,
              eventType: "session_completed",
              payload: {
                reason:
                  intent === "unsubscribe"
                    ? "unsubscribe"
                    : maxDepthReached
                      ? "max_depth_reached"
                      : "terminal_node",
                nodeId: nextNode.id,
              },
            });
          } else {
            const nextState = nextNode.autoSend ? "active" : "waiting_manual";
            await updateConversationSession(session.id, {
              state: nextState,
              currentNodeId: nextNode.id,
              turnCount: nextTurn,
              lastIntent: intent,
              lastConfidence: confidence,
              lastNodeEnteredAt: nowIso(),
              endedReason: "",
            });
            await createConversationEvent({
              sessionId: session.id,
              runId: run.id,
              eventType: "session_transition",
              payload: {
                trigger: selectedEdge.trigger,
                fromNodeId: currentNode.id,
                toNodeId: nextNode.id,
                edgeId: selectedEdge.id,
              },
            });

            if (nextNode.autoSend) {
              const messages = await listRunMessages(run.id);
              autoBranchScheduled = await scheduleConversationNodeMessage({
                run,
                lead,
                sessionId: session.id,
                node: nextNode,
                step: nextTurn,
                parentMessageId: inboundMessage.id,
                brandName: brand?.name ?? "",
                brandWebsite: brand?.website ?? "",
                brandTone: brand?.tone ?? "",
                brandNotes: brand?.notes ?? "",
                campaignName: campaign?.name ?? "",
                campaignGoal: campaign?.objective.goal ?? "",
                campaignConstraints: campaign?.objective.constraints ?? "",
                variantId: variant?.id ?? "",
                variantName: variant?.name ?? "",
                experimentOffer,
                experimentCta,
                experimentAudience,
                experimentNotes: variant?.notes ?? "",
                intent,
                intentConfidence: confidence,
                priorNodePath: [session.currentNodeId, nextNode.id],
                maxDepth: graph.maxDepth,
                waitMinutes: selectedEdge.waitMinutes,
                latestInboundSubject: input.subject,
                latestInboundBody: input.body,
                existingMessages: messages,
              });
              if (autoBranchScheduled.ok) {
                await enqueueOutreachJob({
                  runId: run.id,
                  jobType: "dispatch_messages",
                  executeAfter: nowIso(),
                });
                await createConversationEvent({
                  sessionId: session.id,
                  runId: run.id,
                  eventType: "node_message_scheduled",
                  payload: {
                    nodeId: nextNode.id,
                    trigger: selectedEdge.trigger,
                  },
                });
                await createOutreachEvent({
                  runId: run.id,
                  eventType: "message_scheduled",
                  payload: {
                    count: 1,
                    mode: "conversation_branch",
                  },
                });
              } else {
                await createConversationEvent({
                  sessionId: session.id,
                  runId: run.id,
                  eventType: "node_schedule_failed",
                  payload: {
                    nodeId: nextNode.id,
                    trigger: selectedEdge.trigger,
                    reason: autoBranchScheduled.reason,
                  },
                });
              }
            } else {
              const composed = await generateConversationNodeContent({
                node: nextNode,
                run,
                lead,
                sessionId: session.id,
                parentMessageId: inboundMessage.id,
                brandName: brand?.name ?? "",
                brandWebsite: brand?.website ?? "",
                brandTone: brand?.tone ?? "",
                brandNotes: brand?.notes ?? "",
                campaignName: campaign?.name ?? "",
                campaignGoal: campaign?.objective.goal ?? "",
                campaignConstraints: campaign?.objective.constraints ?? "",
                variantId: variant?.id ?? "",
                variantName: variant?.name ?? "",
                experimentOffer,
                experimentCta,
                experimentAudience,
                experimentNotes: variant?.notes ?? "",
                latestInboundSubject: input.subject,
                latestInboundBody: input.body,
                intent,
                intentConfidence: confidence,
                priorNodePath: [session.currentNodeId, nextNode.id],
                maxDepth: graph.maxDepth,
              });
              if (!composed.ok) {
                await createConversationEvent({
                  sessionId: session.id,
                  runId: run.id,
                  eventType: "manual_node_invalid",
                  payload: {
                    nodeId: nextNode.id,
                    reason: composed.reason,
                    trace: composed.trace,
                  },
                });
                await createConversationEvent({
                  sessionId: session.id,
                  runId: run.id,
                  eventType: "conversation_prompt_rejected",
                  payload: {
                    nodeId: nextNode.id,
                    reason: composed.reason,
                    trace: composed.trace,
                  },
                });
                await createOutreachEvent({
                  runId: run.id,
                  eventType: "conversation_prompt_rejected",
                  payload: {
                    nodeId: nextNode.id,
                    reason: composed.reason,
                  },
                });
                await createOutreachEvent({
                  runId: run.id,
                  eventType: "conversation_prompt_failed",
                  payload: {
                    nodeId: nextNode.id,
                    reason: composed.reason,
                  },
                });
              } else {
                const draft = await createReplyDraft({
                  threadId: thread.id,
                  brandId: run.brandId,
                  runId: run.id,
                  subject: composed.subject,
                  body: composed.body,
                  reason: `Manual branch: ${nextNode.title}`,
                });
                draftId = draft.id;
                await createConversationEvent({
                  sessionId: session.id,
                  runId: run.id,
                  eventType: "conversation_prompt_generated",
                  payload: {
                    nodeId: nextNode.id,
                    draftId,
                    trace: composed.trace,
                  },
                });
                await createOutreachEvent({
                  runId: run.id,
                  eventType: "conversation_prompt_generated",
                  payload: {
                    nodeId: nextNode.id,
                    draftId,
                  },
                });
                await createConversationEvent({
                  sessionId: session.id,
                  runId: run.id,
                  eventType: "manual_node_required",
                  payload: {
                    nodeId: nextNode.id,
                    reason: "auto_send_disabled",
                  },
                });
              }
            }
          }
        }
      }
    }
  }

  if (!draftId && !autoBranchScheduled.ok) {
    await createOutreachEvent({
      runId: run.id,
      eventType: "reply_draft_skipped",
      payload: {
        reason: "No valid conversation branch produced a reply draft",
        intent,
      },
    });
  }

  await updateRunLead(lead.id, { status: intent === "unsubscribe" ? "unsubscribed" : "replied" });

  const messages = await listRunMessages(run.id);
  const { threads: refreshedThreads } = await listReplyThreadsByBrand(run.brandId);
  const metrics = calculateRunMetricsFromMessages(run.id, messages, refreshedThreads);

  await updateOutreachRun(run.id, {
    metrics: {
      ...run.metrics,
      replies: metrics.replies,
      positiveReplies: metrics.positiveReplies,
      negativeReplies: metrics.negativeReplies,
      sentMessages: metrics.sentMessages,
      bouncedMessages: metrics.bouncedMessages,
      failedMessages: metrics.failedMessages,
    },
  });

  await createOutreachEvent({
    runId: run.id,
    eventType: "reply_ingested",
    payload: {
      threadId: thread.id,
      intent,
      confidence,
    },
  });
  if (draftId) {
    await createOutreachEvent({ runId: run.id, eventType: "reply_draft_created", payload: { draftId } });
  }

  return {
    ok: true,
    threadId: thread.id,
    draftId,
    reason: "Reply ingested",
  };
}

export async function approveReplyDraftAndSend(input: {
  brandId: string;
  draftId: string;
}): Promise<{ ok: boolean; reason: string }> {
  const draft = await getReplyDraft(input.draftId);
  if (!draft || draft.brandId !== input.brandId) {
    return { ok: false, reason: "Draft not found" };
  }
  if (draft.status !== "draft") {
    return { ok: false, reason: "Draft already sent or dismissed" };
  }

  const thread = await getReplyThread(draft.threadId);
  if (!thread) {
    return { ok: false, reason: "Reply thread not found" };
  }

  const run = await getOutreachRun(draft.runId);
  if (!run) {
    return { ok: false, reason: "Run not found" };
  }

  const mailbox = await resolveMailboxAccountForRun(run);
  if (!mailbox) {
    return { ok: false, reason: "Reply mailbox account missing or invalid" };
  }

  const leads = await listRunLeads(run.id);
  const lead = leads.find((item) => item.id === thread.leadId);
  if (!lead) {
    return { ok: false, reason: "Lead not found for thread" };
  }

  const send = await sendReplyDraftAsEvent({
    draft,
    account: mailbox.account,
    secrets: mailbox.secrets,
    recipient: lead.email,
  });

  if (!send.ok) {
    return { ok: false, reason: send.error };
  }

  await updateReplyDraft(draft.id, {
    status: "sent",
    sentAt: nowIso(),
  });

  await updateReplyThread(thread.id, {
    status: "open",
    lastMessageAt: nowIso(),
  });

  await createReplyMessage({
    threadId: thread.id,
    runId: run.id,
    direction: "outbound",
    from: mailbox.account.config.mailbox.email,
    to: lead.email,
    subject: draft.subject,
    body: draft.body,
    providerMessageId: `reply_${Date.now().toString(36)}`,
  });

  await createOutreachEvent({
    runId: run.id,
    eventType: "reply_draft_sent",
    payload: { draftId: draft.id },
  });

  return { ok: true, reason: "Reply sent" };
}

export async function ingestApifyRunComplete(input: {
  runId: string;
  leads: ApifyLead[];
}): Promise<{ ok: boolean; reason: string }> {
  const run = await getOutreachRun(input.runId);
  if (!run) {
    return { ok: false, reason: "Run not found" };
  }

  await upsertRunLeads(
    run.id,
    run.brandId,
    run.campaignId,
    input.leads.map((lead) => ({
      email: lead.email,
      name: lead.name,
      company: lead.company,
      title: lead.title,
      domain: lead.domain,
      sourceUrl: lead.sourceUrl,
    }))
  );

  await createOutreachEvent({
    runId: run.id,
    eventType: "lead_sourced_apify",
    payload: { count: input.leads.length, source: "webhook" },
  });

  await enqueueOutreachJob({
    runId: run.id,
    jobType: "schedule_messages",
    executeAfter: nowIso(),
  });

  return { ok: true, reason: "Apify leads ingested" };
}
