import type {
  BuildViewModel,
  BrandOutreachAssignment,
  BrandRecord,
  CampaignRecord,
  CampaignScalePolicy,
  ConversationMap,
  ConversationFlowGraph,
  ConversationPreviewLead,
  EvolutionSnapshot,
  Experiment,
  ExperimentRecord,
  ExperimentSuggestionRecord,
  Hypothesis,
  ObjectiveData,
  OutreachAccount,
  OutreachRunEvent,
  OutreachRunJob,
  OutreachRun,
  RunViewModel,
  ReplyDraft,
  ReplyThread,
  RunAnomaly,
  ScaleCampaignRecord,
  SourcingChainDecision,
  SourcingProbeResult,
} from "@/lib/factory-types";

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function readJson(response: Response) {
  let data: unknown = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  const record = asObject(data);
  if (!response.ok) {
    const base = String(record.error ?? "Request failed");
    const hint = typeof record.hint === "string" && record.hint.trim() ? ` Hint: ${record.hint}` : "";
    const debugValue = record.debug;
    const debug =
      debugValue && typeof debugValue === "object" && !Array.isArray(debugValue)
        ? ` Debug: ${JSON.stringify(debugValue)}`
        : "";
    throw new Error(`${base}${hint}${debug}`);
  }
  return record;
}

export async function fetchBrands() {
  const response = await fetch("/api/brands", { cache: "no-store" });
  const data = await readJson(response);
  return (Array.isArray(data?.brands) ? data.brands : []) as BrandRecord[];
}

export async function fetchBrand(brandId: string) {
  const response = await fetch(`/api/brands/${brandId}`, { cache: "no-store" });
  const data = await readJson(response);
  return data.brand as BrandRecord;
}

export async function createBrandApi(input: {
  name: string;
  website: string;
  tone?: string;
  notes?: string;
  product?: string;
  targetMarkets?: string[];
  idealCustomerProfiles?: string[];
  keyFeatures?: string[];
  keyBenefits?: string[];
}) {
  const response = await fetch("/api/brands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await readJson(response);
  return data.brand as BrandRecord;
}

export async function updateBrandApi(
  brandId: string,
  patch: Partial<
    Pick<
      BrandRecord,
      | "name"
      | "website"
      | "tone"
      | "notes"
      | "product"
      | "targetMarkets"
      | "idealCustomerProfiles"
      | "keyFeatures"
      | "keyBenefits"
      | "domains"
      | "leads"
      | "inbox"
    >
  >
) {
  const response = await fetch(`/api/brands/${brandId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await readJson(response);
  return data.brand as BrandRecord;
}

export async function deleteBrandApi(brandId: string) {
  const response = await fetch(`/api/brands/${brandId}`, {
    method: "DELETE",
  });
  await readJson(response);
}

export async function fetchCampaigns(brandId: string) {
  const response = await fetch(`/api/brands/${brandId}/campaigns`, { cache: "no-store" });
  const data = await readJson(response);
  return (Array.isArray(data?.campaigns) ? data.campaigns : []) as CampaignRecord[];
}

export async function fetchCampaign(brandId: string, campaignId: string) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}`, { cache: "no-store" });
  const data = await readJson(response);
  return data.campaign as CampaignRecord;
}

export async function fetchExperiments(brandId: string) {
  const response = await fetch(`/api/brands/${brandId}/experiments`, { cache: "no-store" });
  const data = await readJson(response);
  return (Array.isArray(data?.experiments) ? data.experiments : []) as ExperimentRecord[];
}

export async function fetchExperimentSuggestions(brandId: string) {
  const response = await fetch(`/api/brands/${brandId}/experiments/suggestions`, {
    cache: "no-store",
  });
  const data = await readJson(response);
  return (Array.isArray(data?.suggestions) ? data.suggestions : []) as ExperimentSuggestionRecord[];
}

export async function generateExperimentSuggestions(brandId: string, refresh = false) {
  const response = await fetch(`/api/brands/${brandId}/experiments/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  const data = await readJson(response);
  return (Array.isArray(data?.suggestions) ? data.suggestions : []) as ExperimentSuggestionRecord[];
}

export async function applyExperimentSuggestion(brandId: string, suggestionId: string) {
  const response = await fetch(
    `/api/brands/${brandId}/experiments/suggestions/${suggestionId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    }
  );
  const data = await readJson(response);
  return data.experiment as ExperimentRecord;
}

export async function dismissExperimentSuggestion(brandId: string, suggestionId: string) {
  const response = await fetch(
    `/api/brands/${brandId}/experiments/suggestions/${suggestionId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    }
  );
  const data = await readJson(response);
  return data.suggestion as ExperimentSuggestionRecord;
}

export async function fetchExperiment(brandId: string, experimentId: string) {
  const response = await fetch(`/api/brands/${brandId}/experiments/${experimentId}`, {
    cache: "no-store",
  });
  const data = await readJson(response);
  return data.experiment as ExperimentRecord;
}

export async function createExperimentApi(
  brandId: string,
  input: {
    name: string;
    offer?: string;
    audience?: string;
  }
) {
  const response = await fetch(`/api/brands/${brandId}/experiments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await readJson(response);
  return data.experiment as ExperimentRecord;
}

export async function updateExperimentApi(
  brandId: string,
  experimentId: string,
  patch: Partial<
    Pick<
      ExperimentRecord,
      "name" | "status" | "offer" | "audience" | "testEnvelope" | "successMetric" | "promotedCampaignId"
    >
  >
) {
  const response = await fetch(`/api/brands/${brandId}/experiments/${experimentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await readJson(response);
  return data.experiment as ExperimentRecord;
}

export async function deleteExperimentApi(brandId: string, experimentId: string) {
  const response = await fetch(`/api/brands/${brandId}/experiments/${experimentId}`, {
    method: "DELETE",
  });
  await readJson(response);
}

export async function launchExperimentTestApi(brandId: string, experimentId: string) {
  const response = await fetch(`/api/brands/${brandId}/experiments/${experimentId}/launch`, {
    method: "POST",
  });
  const data = await readJson(response);
  return {
    runId: String(data.runId ?? ""),
    status: String(data.status ?? ""),
  };
}

export async function promoteExperimentApi(
  brandId: string,
  experimentId: string,
  input?: { campaignName?: string }
) {
  const response = await fetch(`/api/brands/${brandId}/experiments/${experimentId}/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  const data = await readJson(response);
  return data.campaign as ScaleCampaignRecord;
}

export async function fetchExperimentRunView(brandId: string, experimentId: string) {
  const response = await fetch(`/api/brands/${brandId}/experiments/${experimentId}/runs`, {
    cache: "no-store",
  });
  const data = await readJson(response);
  return data.run as RunViewModel;
}

export async function fetchExperimentSourcingTraceApi(brandId: string, experimentId: string) {
  const response = await fetch(
    `/api/brands/${brandId}/experiments/${experimentId}/sourcing-trace`,
    { cache: "no-store" }
  );
  const data = await readJson(response);
  const trace = asObject(data.trace);
  return {
    latestRun:
      trace.latestRun && typeof trace.latestRun === "object" && !Array.isArray(trace.latestRun)
        ? (trace.latestRun as OutreachRun)
        : null,
    latestDecision:
      trace.latestDecision && typeof trace.latestDecision === "object" && !Array.isArray(trace.latestDecision)
        ? (trace.latestDecision as SourcingChainDecision)
        : null,
    probeResults: (Array.isArray(trace.probeResults) ? trace.probeResults : []) as SourcingProbeResult[],
    runEvents: (Array.isArray(trace.runEvents) ? trace.runEvents : []) as OutreachRunEvent[],
    runJobs: (Array.isArray(trace.runJobs) ? trace.runJobs : []) as OutreachRunJob[],
    decisions: (Array.isArray(trace.decisions) ? trace.decisions : []) as SourcingChainDecision[],
  };
}

export async function sourceExperimentSampleLeadsApi(
  brandId: string,
  experimentId: string,
  sampleSize = 20
) {
  const response = await fetch(
    `/api/brands/${brandId}/experiments/${experimentId}/source-sample-leads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sampleSize }),
    }
  );
  const data = await readJson(response);
  return {
    runId: String(data.runId ?? ""),
    status: String(data.status ?? ""),
    sampleSize: Math.max(1, Number(data.sampleSize ?? sampleSize) || sampleSize),
  };
}

export async function controlExperimentRunApi(
  brandId: string,
  experimentId: string,
  runId: string,
  action: "pause" | "resume" | "cancel",
  reason?: string
) {
  const response = await fetch(
    `/api/brands/${brandId}/experiments/${experimentId}/runs/${runId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    }
  );
  return await readJson(response);
}

export async function fetchScaleCampaigns(brandId: string) {
  const response = await fetch(`/api/brands/${brandId}/campaigns`, { cache: "no-store" });
  const data = await readJson(response);
  return (Array.isArray(data?.campaigns) ? data.campaigns : []) as ScaleCampaignRecord[];
}

export async function fetchScaleCampaign(brandId: string, campaignId: string) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}`, {
    cache: "no-store",
  });
  const data = await readJson(response);
  return data.campaign as ScaleCampaignRecord;
}

export async function updateScaleCampaignApi(
  brandId: string,
  campaignId: string,
  patch: Partial<Pick<ScaleCampaignRecord, "name" | "status">> & {
    scalePolicy?: Partial<CampaignScalePolicy>;
  }
) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await readJson(response);
  return data.campaign as ScaleCampaignRecord;
}

export async function launchScaleCampaignApi(brandId: string, campaignId: string) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}/launch`, {
    method: "POST",
  });
  const data = await readJson(response);
  return {
    runId: String(data.runId ?? ""),
    status: String(data.status ?? ""),
  };
}

export async function fetchScaleCampaignRunView(brandId: string, campaignId: string) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}/runs`, {
    cache: "no-store",
  });
  const data = await readJson(response);
  return data.run as RunViewModel;
}

export async function controlScaleCampaignRunApi(
  brandId: string,
  campaignId: string,
  runId: string,
  action: "pause" | "resume" | "cancel",
  reason?: string
) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}/runs/${runId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, reason }),
  });
  return await readJson(response);
}

export async function fetchBuildView(brandId: string, campaignId: string) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}/build`, {
    cache: "no-store",
  });
  const data = await readJson(response);
  return data.build as BuildViewModel;
}

export async function updateBuildView(
  brandId: string,
  campaignId: string,
  patch: Partial<BuildViewModel>
) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}/build`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await readJson(response);
  return data.build as BuildViewModel;
}

export async function suggestBuildApi(brandId: string, campaignId: string) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}/build/suggest`, {
    method: "POST",
  });
  const data = await readJson(response);
  return (Array.isArray(data.suggestions) ? data.suggestions : []) as Array<{
    title: string;
    rationale: string;
    objective: {
      goal: string;
      constraints: string;
      scoring: ObjectiveData["scoring"];
    };
    angle: {
      title: string;
      rationale: string;
      channel: "Email";
      actorQuery: string;
      maxLeads: number;
      seedInputs: string[];
    };
    variants: Array<{
      name: string;
      notes: string;
      status: "draft" | "testing" | "scaling" | "paused";
      runPolicy: {
        cadence: "3_step_7_day";
        dailyCap: number;
        hourlyCap: number;
        timezone: string;
        minSpacingMinutes: number;
      };
    }>;
  }>;
}

export async function fetchRunView(brandId: string, campaignId: string) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}/run`, {
    cache: "no-store",
  });
  const data = await readJson(response);
  return data.run as RunViewModel;
}

export async function fetchConversationMapApi(
  brandId: string,
  campaignId: string,
  experimentId: string
) {
  const response = await fetch(
    `/api/brands/${brandId}/campaigns/${campaignId}/experiments/${experimentId}/conversation-map`,
    { cache: "no-store" }
  );
  const data = await readJson(response);
  return (data.map ?? null) as ConversationMap | null;
}

export async function fetchConversationPreviewLeadsApi(
  brandId: string,
  campaignId: string,
  experimentId: string
) {
  const response = await fetch(
    `/api/brands/${brandId}/campaigns/${campaignId}/experiments/${experimentId}/conversation-map/preview-leads`,
    { cache: "no-store" }
  );
  const data = await readJson(response);
  return {
    leads: (Array.isArray(data.leads) ? data.leads : []) as Array<
      ConversationPreviewLead & { runId?: string; runCreatedAt?: string; sourceUrl?: string }
    >,
    runsChecked: Math.max(0, Number(data.runsChecked ?? 0) || 0),
    runtimeRefFound: Boolean(data.runtimeRefFound),
    sourceExperimentId: String(data.sourceExperimentId ?? ""),
  };
}

export async function saveConversationMapDraftApi(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
  name?: string;
  draftGraph: ConversationFlowGraph;
}) {
  const response = await fetch(
    `/api/brands/${input.brandId}/campaigns/${input.campaignId}/experiments/${input.experimentId}/conversation-map`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: input.name ?? "", draftGraph: input.draftGraph }),
    }
  );
  const data = await readJson(response);
  return data.map as ConversationMap;
}

export async function publishConversationMapApi(
  brandId: string,
  campaignId: string,
  experimentId: string
) {
  const response = await fetch(
    `/api/brands/${brandId}/campaigns/${campaignId}/experiments/${experimentId}/conversation-map/publish`,
    {
      method: "POST",
    }
  );
  const data = await readJson(response);
  return data.map as ConversationMap;
}

export async function suggestConversationMapApi(
  brandId: string,
  campaignId: string,
  experimentId: string
) {
  const response = await fetch(
    `/api/brands/${brandId}/campaigns/${campaignId}/experiments/${experimentId}/conversation-map/suggest`,
    {
      method: "POST",
    }
  );
  const data = await readJson(response);
  return data.graph as ConversationFlowGraph;
}

export async function previewConversationNodeApi(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
  nodeId: string;
  sampleLead?: {
    id?: string;
    name?: string;
    email?: string;
    company?: string;
    title?: string;
    domain?: string;
  };
  sampleReply?: {
    subject?: string;
    body?: string;
    intent?: "question" | "interest" | "objection" | "unsubscribe" | "other" | "";
    confidence?: number;
  };
}) {
  const response = await fetch(
    `/api/brands/${input.brandId}/campaigns/${input.campaignId}/experiments/${input.experimentId}/conversation-map/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId: input.nodeId,
        sampleLead: input.sampleLead ?? {},
        sampleReply: input.sampleReply ?? {},
      }),
    }
  );
  const data = await readJson(response);
  return {
    subject: String(data.subject ?? ""),
    body: String(data.body ?? ""),
    trace:
      data.trace && typeof data.trace === "object" && !Array.isArray(data.trace)
        ? (data.trace as Record<string, unknown>)
        : {},
  };
}

export async function createCampaignApi(brandId: string, input: { name: string }) {
  const response = await fetch(`/api/brands/${brandId}/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await readJson(response);
  return data.campaign as CampaignRecord;
}

export async function updateCampaignApi(
  brandId: string,
  campaignId: string,
  patch: Partial<
    Pick<
      CampaignRecord,
      "name" | "status" | "objective" | "hypotheses" | "experiments" | "evolution" | "stepState"
    >
  >
) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await readJson(response);
  return data.campaign as CampaignRecord;
}

export async function deleteCampaignApi(brandId: string, campaignId: string) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}`, {
    method: "DELETE",
  });
  await readJson(response);
}

export async function generateHypothesesApi(brandId: string, campaignId: string, payload: {
  brandName: string;
  goal: string;
  constraints: string;
}) {
  const response = await fetch(
    `/api/brands/${brandId}/campaigns/${campaignId}/hypotheses/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  const data = await readJson(response);
  return (Array.isArray(data?.hypotheses) ? data.hypotheses : []) as Hypothesis[];
}

export async function suggestObjectiveApi(brandId: string, campaignId: string) {
  const response = await fetch(
    `/api/brands/${brandId}/campaigns/${campaignId}/objective/suggest`,
    { method: "POST" }
  );
  const data = await readJson(response);
  return (Array.isArray(data?.suggestions) ? data.suggestions : []) as Array<{
    title: string;
    goal: string;
    constraints: string;
    scoring: ObjectiveData["scoring"];
    rationale: string;
  }>;
}

export async function suggestHypothesesApi(brandId: string, campaignId: string) {
  const response = await fetch(
    `/api/brands/${brandId}/campaigns/${campaignId}/hypotheses/suggest`,
    { method: "POST" }
  );
  const data = await readJson(response);
  return (Array.isArray(data?.suggestions) ? data.suggestions : []) as Array<{
    title: string;
    channel: "Email";
    rationale: string;
    leadTarget: string;
    maxLeads: number;
    seedInputs: string[];
  }>;
}

export async function generateExperimentsApi(
  brandId: string,
  campaignId: string,
  payload: { hypotheses: Hypothesis[] }
) {
  const response = await fetch(
    `/api/brands/${brandId}/campaigns/${campaignId}/experiments/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  const data = await readJson(response);
  return (Array.isArray(data?.experiments) ? data.experiments : []) as Array<
    Omit<Experiment, "id"> & { id?: string }
  >;
}

export async function suggestExperimentsApi(brandId: string, campaignId: string) {
  const response = await fetch(
    `/api/brands/${brandId}/campaigns/${campaignId}/experiments/suggest`,
    { method: "POST" }
  );
  const data = await readJson(response);
  return (Array.isArray(data?.suggestions) ? data.suggestions : []) as Array<
    Omit<Experiment, "id">
  >;
}

export async function suggestEvolutionApi(brandId: string, campaignId: string) {
  const response = await fetch(
    `/api/brands/${brandId}/campaigns/${campaignId}/evolution/suggest`,
    { method: "POST" }
  );
  const data = await readJson(response);
  return (Array.isArray(data?.suggestions) ? data.suggestions : []) as Array<{
    title: string;
    summary: string;
    status: "observing" | "winner" | "killed";
  }>;
}

export async function fetchOutreachAccounts() {
  const response = await fetch("/api/outreach/accounts", { cache: "no-store" });
  const data = await readJson(response);
  return (Array.isArray(data?.accounts) ? data.accounts : []) as OutreachAccount[];
}

export async function createOutreachAccountApi(input: {
  name: string;
  accountType?: "delivery" | "mailbox" | "hybrid";
  status?: "active" | "inactive";
  config?: unknown;
  credentials?: unknown;
}) {
  const response = await fetch("/api/outreach/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await readJson(response);
  return data.account as OutreachAccount;
}

export async function updateOutreachAccountApi(
  accountId: string,
  patch: {
    name?: string;
    accountType?: "delivery" | "mailbox" | "hybrid";
    status?: "active" | "inactive";
    config?: unknown;
    credentials?: unknown;
  }
) {
  const response = await fetch(`/api/outreach/accounts/${accountId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await readJson(response);
  return data.account as OutreachAccount;
}

export async function deleteOutreachAccountApi(accountId: string) {
  const response = await fetch(`/api/outreach/accounts/${accountId}`, {
    method: "DELETE",
  });
  const data = await readJson(response);
  return String(data.deletedId ?? accountId);
}

export async function testOutreachAccount(
  accountId: string,
  scope: "full" | "customerio" | "mailbox" = "full"
) {
  const response = await fetch(`/api/outreach/accounts/${accountId}/test?scope=${encodeURIComponent(scope)}`, {
    method: "POST",
  });
  const data = await readJson(response);
  return data.result as {
    ok: boolean;
    scope: "full" | "customerio" | "mailbox";
    checks: {
      customerIo: "pass" | "fail";
      apify: "pass" | "fail";
      mailbox: "pass" | "fail";
    };
    message: string;
    testedAt: string;
  };
}

export async function assignBrandOutreachAccount(
  brandId: string,
  input: string | { accountId?: string; mailboxAccountId?: string }
) {
  const payload =
    typeof input === "string"
      ? { accountId: input }
      : {
          accountId: input.accountId ?? "",
          ...(typeof input.mailboxAccountId === "string"
            ? { mailboxAccountId: input.mailboxAccountId }
            : {}),
        };

  const response = await fetch(`/api/brands/${brandId}/outreach-account`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);
  return {
    assignment: (data.assignment ?? null) as BrandOutreachAssignment | null,
    account: (data.account ?? null) as OutreachAccount | null,
    mailboxAccount: (data.mailboxAccount ?? null) as OutreachAccount | null,
  };
}

export async function fetchBrandOutreachAssignment(brandId: string) {
  const response = await fetch(`/api/brands/${brandId}/outreach-account`, { cache: "no-store" });
  const data = await readJson(response);
  return {
    assignment: (data.assignment ?? null) as BrandOutreachAssignment | null,
    account: (data.account ?? null) as OutreachAccount | null,
    mailboxAccount: (data.mailboxAccount ?? null) as OutreachAccount | null,
  };
}

export async function fetchCampaignRuns(brandId: string, campaignId: string) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}/runs`, {
    cache: "no-store",
  });
  const data = await readJson(response);
  const eventsByRunRecord = asObject(data.eventsByRun);
  const jobsByRunRecord = asObject(data.jobsByRun);
  const eventsByRun = Object.fromEntries(
    Object.entries(eventsByRunRecord).map(([runId, value]) => [
      runId,
      (Array.isArray(value) ? value : []) as OutreachRunEvent[],
    ])
  ) as Record<string, OutreachRunEvent[]>;
  const jobsByRun = Object.fromEntries(
    Object.entries(jobsByRunRecord).map(([runId, value]) => [
      runId,
      (Array.isArray(value) ? value : []) as OutreachRunJob[],
    ])
  ) as Record<string, OutreachRunJob[]>;

  return {
    runs: (Array.isArray(data.runs) ? data.runs : []) as OutreachRun[],
    anomalies: (Array.isArray(data.anomalies) ? data.anomalies : []) as RunAnomaly[],
    eventsByRun,
    jobsByRun,
  };
}

export async function launchExperimentRun(
  brandId: string,
  campaignId: string,
  experimentId: string
) {
  const response = await fetch(
    `/api/brands/${brandId}/campaigns/${campaignId}/experiments/${experimentId}/runs`,
    {
      method: "POST",
    }
  );
  const data = await readJson(response);
  return {
    runId: String(data.runId ?? ""),
    status: String(data.status ?? ""),
  };
}

export async function pauseRun(
  brandId: string,
  campaignId: string,
  runId: string,
  reason = "Paused by user"
) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}/runs/${runId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "pause", reason }),
  });
  return await readJson(response);
}

export async function resumeRun(brandId: string, campaignId: string, runId: string) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}/runs/${runId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "resume" }),
  });
  return await readJson(response);
}

export async function cancelRun(
  brandId: string,
  campaignId: string,
  runId: string,
  reason = "Canceled by user"
) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}/runs/${runId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel", reason }),
  });
  return await readJson(response);
}

export async function fetchInboxThreads(brandId: string) {
  const response = await fetch(`/api/brands/${brandId}/inbox/threads`, { cache: "no-store" });
  const data = await readJson(response);
  return {
    threads: (Array.isArray(data.threads) ? data.threads : []) as ReplyThread[],
    drafts: (Array.isArray(data.drafts) ? data.drafts : []) as ReplyDraft[],
  };
}

export async function approveReplyDraftAndSend(brandId: string, draftId: string) {
  const response = await fetch(`/api/brands/${brandId}/inbox/drafts/${draftId}/send`, {
    method: "POST",
  });
  return await readJson(response);
}

export function completeStepState(step: "objective" | "hypotheses" | "experiments" | "evolution", current: CampaignRecord["stepState"]) {
  const next = { ...current };
  if (step === "objective") next.objectiveCompleted = true;
  if (step === "hypotheses") next.hypothesesCompleted = true;
  if (step === "experiments") next.experimentsCompleted = true;
  if (step === "evolution") next.evolutionCompleted = true;
  next.currentStep = step;
  return next;
}

export function defaultObjective(): ObjectiveData {
  return {
    goal: "",
    constraints: "",
    scoring: {
      conversionWeight: 0.6,
      qualityWeight: 0.2,
      replyWeight: 0.2,
    },
  };
}

export function summarizeWinners(rows: EvolutionSnapshot[]) {
  return rows.filter((item) => item.status === "winner").length;
}
