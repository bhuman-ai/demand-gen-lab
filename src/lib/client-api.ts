import type {
  BuildViewModel,
  BrandOutreachAssignment,
  BrandRecord,
  CampaignRecord,
  CampaignScalePolicy,
  ConversationMap,
  ConversationMapEditorState,
  ConversationFlowGraph,
  ConversationPreviewLead,
  ConversationProbeResult,
  EvolutionSnapshot,
  Experiment,
  ExperimentListItem,
  ExperimentRecord,
  ExperimentSuggestionGenerationResult,
  ExperimentSuggestionRecord,
  ExperimentSuggestionStreamEvent,
  Hypothesis,
  ObjectiveData,
  OutreachAccount,
  OutreachProvisioningSettings,
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
import {
  EXPERIMENT_MAX_SAMPLE_SIZE,
  EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS,
} from "@/lib/experiment-policy";

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function clampSourcingRequestSampleSize(
  value: unknown,
  fallback = EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS
) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(EXPERIMENT_MAX_SAMPLE_SIZE, parsed));
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

export async function fetchBrandIntakePrefill(url: string) {
  const response = await fetch("/api/intake/prefill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await readJson(response);
  return {
    prefill: asObject(data.prefill),
    signals: asObject(data.signals),
  } as {
    prefill: {
      brandName?: string;
      tone?: string;
      product?: string;
      targetMarkets?: string[];
      idealCustomerProfiles?: string[];
      keyFeatures?: string[];
      keyBenefits?: string[];
      proof?: string;
    };
    signals: {
      title?: string;
      description?: string;
      hostname?: string;
      mode?: string;
    };
  };
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

export async function fetchExperimentListView(brandId: string) {
  const response = await fetch(`/api/brands/${brandId}/experiments/list-view`, { cache: "no-store" });
  const data = await readJson(response);
  return (Array.isArray(data?.items) ? data.items : []) as ExperimentListItem[];
}

export async function fetchExperimentSuggestions(brandId: string) {
  const response = await fetch(`/api/brands/${brandId}/experiments/suggestions`, {
    cache: "no-store",
  });
  const data = await readJson(response);
  return (Array.isArray(data?.suggestions) ? data.suggestions : []) as ExperimentSuggestionRecord[];
}

export async function generateExperimentSuggestions(brandId: string, refresh = false) {
  const result = await generateExperimentSuggestionsDetailed(brandId, refresh);
  return result.suggestions;
}

export async function generateExperimentSuggestionsDetailed(brandId: string, refresh = false) {
  const response = await fetch(`/api/brands/${brandId}/experiments/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  const data = await readJson(response);
  return {
    suggestions: (Array.isArray(data?.suggestions) ? data.suggestions : []) as ExperimentSuggestionRecord[],
    mode: typeof data?.mode === "string" ? data.mode : undefined,
    screened: typeof data?.screened === "number" ? data.screened : undefined,
    kept: typeof data?.kept === "number" ? data.kept : undefined,
    created: typeof data?.created === "number" ? data.created : undefined,
    reviewCandidates: Array.isArray(data?.reviewCandidates) ? data.reviewCandidates : [],
    brainstormTurns: Array.isArray(data?.brainstormTurns) ? data.brainstormTurns : [],
  } as ExperimentSuggestionGenerationResult;
}

function parseEventStreamChunk(chunk: string) {
  const lines = chunk
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) continue;
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (!dataLines.length) return null;

  let payload: unknown = {};
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    payload = {};
  }

  return payload;
}

export async function streamExperimentSuggestions(
  brandId: string,
  input: {
    refresh?: boolean;
    signal?: AbortSignal;
    onEvent: (event: ExperimentSuggestionStreamEvent) => void;
  }
) {
  const response = await fetch(`/api/brands/${brandId}/experiments/suggestions/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ refresh: Boolean(input.refresh) }),
    signal: input.signal,
  });

  if (!response.ok) {
    let message = "Failed to stream suggestions";
    try {
      const payload = (await response.json()) as Record<string, unknown>;
      if (typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error;
      }
    } catch {
      const text = await response.text().catch(() => "");
      if (text.trim()) {
        message = text.slice(0, 240);
      }
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("Suggestion stream is unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const parsed = parseEventStreamChunk(part);
      if (!parsed) continue;
      input.onEvent(parsed as ExperimentSuggestionStreamEvent);
    }
  }

  if (buffer.trim()) {
    const parsed = parseEventStreamChunk(buffer);
    if (parsed) {
      input.onEvent(parsed as ExperimentSuggestionStreamEvent);
    }
  }
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

export async function draftExperimentFromPromptApi(
  brandId: string,
  input: {
    prompt: string;
    current?: {
      name?: string;
      audience?: string;
      offer?: string;
    };
  }
) {
  const response = await fetch(`/api/brands/${brandId}/experiments/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await readJson(response);
  const draft = asObject(data.draft);
  return {
    name: String(draft.name ?? "").trim(),
    audience: String(draft.audience ?? "").trim(),
    offer: String(draft.offer ?? "").trim(),
  };
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
  sampleSize = EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS,
  options?: { timeoutMs?: number; signal?: AbortSignal; autoSend?: boolean }
) {
  const requestedSampleSize = clampSourcingRequestSampleSize(sampleSize);
  const autoSend = options?.autoSend === true;
  const timeoutMs = Math.max(5_000, Number(options?.timeoutMs ?? 25_000) || 25_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort("request_timeout");
  }, timeoutMs);

  const forwardAbort = () => controller.abort("upstream_abort");
  options?.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (options?.signal?.aborted) {
    controller.abort("upstream_abort");
  }

  try {
    const response = await fetch(
      `/api/brands/${brandId}/experiments/${experimentId}/source-sample-leads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleSize: requestedSampleSize, autoSend }),
        signal: controller.signal,
      }
    );
    const data = await readJson(response);
    return {
      runId: String(data.runId ?? ""),
      status: String(data.status ?? ""),
      sampleSize: clampSourcingRequestSampleSize(data.sampleSize ?? requestedSampleSize, requestedSampleSize),
      autoSend: data.autoSend !== false,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Sourcing request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", forwardAbort);
  }
}

export async function importExperimentProspectsCsvApi(
  brandId: string,
  experimentId: string,
  csvText: string
) {
  const response = await fetch(
    `/api/brands/${brandId}/experiments/${experimentId}/import-prospects`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvText }),
    }
  );
  const data = await readJson(response);
  return {
    runId: String(data.runId ?? ""),
    status: String(data.status ?? ""),
    importedCount: Number(data.importedCount ?? 0),
    parseErrorCount: Number(data.parseErrorCount ?? 0),
    parseErrors: Array.isArray(data.parseErrors)
      ? data.parseErrors.map((value) => String(value ?? ""))
      : ([] as string[]),
  };
}

export async function importExperimentProspectSelectionApi(
  brandId: string,
  experimentId: string,
  payload: {
    tableTitle?: string;
    prompt?: string;
    entityType?: string;
    entityColumn?: string;
    rows: Array<Record<string, string>>;
  }
) {
  const response = await fetch(
    `/api/brands/${brandId}/experiments/${experimentId}/import-prospects/selection`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  const data = await readJson(response);
  return {
    runId: String(data.runId ?? ""),
    status: String(data.status ?? ""),
    attemptedCount: Number(data.attemptedCount ?? 0),
    importedCount: Number(data.importedCount ?? 0),
    skippedCount: Number(data.skippedCount ?? 0),
    matchedCount: Number(data.matchedCount ?? 0),
    parseErrorCount: Number(data.parseErrorCount ?? 0),
    parseErrors: Array.isArray(data.parseErrors)
      ? data.parseErrors.map((value) => String(value ?? ""))
      : ([] as string[]),
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
  action: "pause" | "resume" | "cancel" | "probe_deliverability" | "resume_sender_deliverability",
  reason?: string,
  options?: {
    senderAccountId?: string;
  }
) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}/runs/${runId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, reason, senderAccountId: options?.senderAccountId }),
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
  const workingHours = asObject(data.workingHours);
  return {
    map: (data.map ?? null) as ConversationMap | null,
    workingHours: {
      timezone: String(workingHours.timezone ?? "America/Los_Angeles"),
      businessHoursEnabled: workingHours.businessHoursEnabled !== false,
      businessHoursStartHour: Math.max(
        0,
        Math.min(23, Number(workingHours.businessHoursStartHour ?? 9) || 9)
      ),
      businessHoursEndHour: Math.max(
        1,
        Math.min(24, Number(workingHours.businessHoursEndHour ?? 17) || 17)
      ),
      businessDays: Array.isArray(workingHours.businessDays)
        ? (workingHours.businessDays as number[])
        : [1, 2, 3, 4, 5],
    },
  } satisfies ConversationMapEditorState;
}

export async function fetchConversationPreviewLeadsApi(
  brandId: string,
  campaignId: string,
  experimentId: string,
  options?: { limit?: number; maxRuns?: number }
) {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.maxRuns !== undefined) params.set("maxRuns", String(options.maxRuns));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(
    `/api/brands/${brandId}/campaigns/${campaignId}/experiments/${experimentId}/conversation-map/preview-leads${suffix}`,
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
    qualifiedLeadCount: Math.max(0, Number(data.qualifiedLeadCount ?? 0) || 0),
    qualifiedLeadWithEmailCount: Math.max(0, Number(data.qualifiedLeadWithEmailCount ?? 0) || 0),
    qualifiedLeadWithoutEmailCount: Math.max(0, Number(data.qualifiedLeadWithoutEmailCount ?? 0) || 0),
    previewEmailEnrichment:
      data.previewEmailEnrichment && typeof data.previewEmailEnrichment === "object"
        ? {
            attempted: Math.max(
              0,
              Number((data.previewEmailEnrichment as Record<string, unknown>).attempted ?? 0) || 0
            ),
            matched: Math.max(
              0,
              Number((data.previewEmailEnrichment as Record<string, unknown>).matched ?? 0) || 0
            ),
            failed: Math.max(
              0,
              Number((data.previewEmailEnrichment as Record<string, unknown>).failed ?? 0) || 0
            ),
            provider: String(
              (data.previewEmailEnrichment as Record<string, unknown>).provider ?? "emailfinder.batch"
            ),
            error: String((data.previewEmailEnrichment as Record<string, unknown>).error ?? ""),
          }
        : {
            attempted: 0,
            matched: 0,
            failed: 0,
            provider: "emailfinder.batch",
            error: "",
          },
  };
}

export async function saveConversationMapDraftApi(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
  name?: string;
  draftGraph: ConversationFlowGraph;
  workingHours?: ConversationMapEditorState["workingHours"];
}) {
  const response = await fetch(
    `/api/brands/${input.brandId}/campaigns/${input.campaignId}/experiments/${input.experimentId}/conversation-map`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name ?? "",
        draftGraph: input.draftGraph,
        workingHours: input.workingHours ?? undefined,
      }),
    }
  );
  const data = await readJson(response);
  const workingHours = asObject(data.workingHours);
  return {
    map: data.map as ConversationMap,
    workingHours: {
      timezone: String(workingHours.timezone ?? input.workingHours?.timezone ?? "America/Los_Angeles"),
      businessHoursEnabled:
        workingHours.businessHoursEnabled === undefined
          ? (input.workingHours?.businessHoursEnabled ?? true)
          : workingHours.businessHoursEnabled !== false,
      businessHoursStartHour: Math.max(
        0,
        Math.min(
          23,
          Number(workingHours.businessHoursStartHour ?? input.workingHours?.businessHoursStartHour ?? 9) || 9
        )
      ),
      businessHoursEndHour: Math.max(
        1,
        Math.min(
          24,
          Number(workingHours.businessHoursEndHour ?? input.workingHours?.businessHoursEndHour ?? 17) || 17
        )
      ),
      businessDays: Array.isArray(workingHours.businessDays)
        ? (workingHours.businessDays as number[])
        : (input.workingHours?.businessDays ?? [1, 2, 3, 4, 5]),
    },
  } satisfies ConversationMapEditorState;
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
  const workingHours = asObject(data.workingHours);
  return {
    map: data.map as ConversationMap,
    workingHours: {
      timezone: String(workingHours.timezone ?? "America/Los_Angeles"),
      businessHoursEnabled: workingHours.businessHoursEnabled !== false,
      businessHoursStartHour: Math.max(
        0,
        Math.min(23, Number(workingHours.businessHoursStartHour ?? 9) || 9)
      ),
      businessHoursEndHour: Math.max(
        1,
        Math.min(24, Number(workingHours.businessHoursEndHour ?? 17) || 17)
      ),
      businessDays: Array.isArray(workingHours.businessDays)
        ? (workingHours.businessDays as number[])
        : [1, 2, 3, 4, 5],
    },
  } satisfies ConversationMapEditorState;
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

export async function probeConversationMapApi(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
  nodeId?: string;
  sampleLead?: {
    id?: string;
    name?: string;
    email?: string;
    company?: string;
    title?: string;
    domain?: string;
  };
}) {
  const response = await fetch(
    `/api/brands/${input.brandId}/campaigns/${input.campaignId}/experiments/${input.experimentId}/conversation-map/probe`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId: input.nodeId ?? "",
        sampleLead: input.sampleLead ?? {},
      }),
    }
  );
  const data = await readJson(response);
  return data.probe as ConversationProbeResult;
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

export async function fetchOutreachProvisioningSettings() {
  const response = await fetch("/api/outreach/provisioning-settings", { cache: "no-store" });
  const data = await readJson(response);
  return data.settings as OutreachProvisioningSettings;
}

export async function updateOutreachProvisioningSettingsApi(input: {
  customerIo?: {
    siteId?: string;
    trackingApiKey?: string;
    appApiKey?: string;
  };
  namecheap?: {
    apiUser?: string;
    userName?: string;
    clientIp?: string;
    apiKey?: string;
  };
  deliverability?: {
    provider?: "none" | "google_postmaster";
    monitoredDomains?: string[];
    googleClientId?: string;
    googleClientSecret?: string;
    googleRefreshToken?: string;
  };
}) {
  const response = await fetch("/api/outreach/provisioning-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await readJson(response);
  return data.settings as OutreachProvisioningSettings;
}

export async function testOutreachProvisioningSettings(
  provider: "customerio" | "namecheap" | "deliverability" | "all" = "all"
) {
  const response = await fetch("/api/outreach/provisioning-settings/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  const data = await readJson(response);
  return {
    settings: data.settings as OutreachProvisioningSettings,
    tests: (data.tests ?? {}) as Partial<
      Record<
        "customerIo" | "namecheap" | "deliverability",
        {
          provider: "customerio" | "namecheap" | "deliverability";
          ok: boolean;
          message: string;
          details: Record<string, unknown>;
        }
      >
    >,
  };
}

export async function fetchSavedNamecheapDomains() {
  const response = await fetch("/api/outreach/provisioning/namecheap-domains", {
    cache: "no-store",
  });
  const data = await readJson(response);
  return {
    configured: Boolean(data.configured),
    domains: (Array.isArray(data.domains) ? data.domains : []) as Array<{
      domain: string;
      createdAt: string;
      expiresAt: string;
      isExpired: boolean;
      autoRenew: boolean;
      isOurDns: boolean;
      whoisGuardEnabled: boolean;
    }>,
  };
}

export async function provisionSenderDomain(
  brandId: string,
  input: {
    accountName: string;
    assignToBrand?: boolean;
    selectedMailboxAccountId?: string;
    domainMode: "existing" | "register";
    domain: string;
    fromLocalPart: string;
    autoPickCustomerIoAccount?: boolean;
    customerIoSourceAccountId?: string;
    forwardingTargetUrl?: string;
    customerIoSiteId: string;
    customerIoTrackingApiKey: string;
    customerIoAppApiKey?: string;
    namecheapApiUser: string;
    namecheapUserName?: string;
    namecheapApiKey: string;
    namecheapClientIp: string;
    registrant?: {
      firstName: string;
      lastName: string;
      organizationName?: string;
      emailAddress: string;
      phone: string;
      address1: string;
      city: string;
      stateProvince: string;
      postalCode: string;
      country: string;
    };
  }
) {
  const response = await fetch(`/api/brands/${brandId}/outreach/provision-sender`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await readJson(response);
  return data.result as {
    ok: boolean;
    readyToSend: boolean;
    domain: string;
    fromEmail: string;
    brand: BrandRecord;
    account: OutreachAccount;
    assignment: BrandOutreachAssignment | null;
    namecheap: {
      mode: "existing" | "register";
      domainStatus: "existing" | "registered";
      existingRecordCount: number;
      appliedRecordCount: number;
      forwardingEnabled: boolean;
      forwardingTargetUrl: string;
    };
    customerIo: {
      senderIdentityStatus: "existing" | "created" | "manual_required" | "error";
      dnsRecordCount: number;
      sourceAccountId: string;
      sourceAccountName: string;
    };
    warnings: string[];
    nextSteps: string[];
  };
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
  input: string | { accountId?: string; accountIds?: string[]; mailboxAccountId?: string }
) {
  const payload =
    typeof input === "string"
      ? { accountId: input }
      : {
          accountId: input.accountId ?? "",
          ...(Array.isArray(input.accountIds) ? { accountIds: input.accountIds } : {}),
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

export async function probeRunDeliverability(
  brandId: string,
  campaignId: string,
  runId: string,
  reason = "Manual deliverability check"
) {
  const response = await fetch(`/api/brands/${brandId}/campaigns/${campaignId}/runs/${runId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "probe_deliverability", reason }),
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
