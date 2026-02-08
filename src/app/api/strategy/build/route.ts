import { NextResponse } from "next/server";
import { appendFile, mkdir } from "fs/promises";
import Ajv from "ajv";

const APIFY_STORE_BASE = "https://api.apify.com/v2/store";
const APIFY_ACTOR_BASE = "https://api.apify.com/v2/acts";
const APIFY_RUN_BASE = "https://api.apify.com/v2/actor-runs";
const OPENAI_API_BASE = "https://api.openai.com/v1/responses";

const ALLOWED_PRICING = new Set(["PAY_PER_EVENT", "PRICE_PER_DATASET_ITEM", "FREE"]);
const MAX_ITEMS = 5;
const BUDGET_LIMIT_USD = 0.1;

type Idea = {
  title: string;
  channel: string;
  rationale: string;
  actorQuery: string;
  seedInputs: unknown;
};

type RequestContext = {
  constraints?: unknown;
  context?: unknown;
  preferences?: unknown;
  exclusions?: unknown;
  needs?: unknown;
};

type SequenceDraft = {
  id: string;
  actor: {
    id: string;
    name: string;
    title: string;
    username?: string;
    url?: string;
    description?: string;
    rating?: number;
    usage?: number;
    pricingModel?: string;
  };
  hook: string;
  offer: string;
  cta: string;
  strategy?: string;
  inputTemplate: string;
  runnable?: boolean;
  verification?: {
    status: "pending" | "succeeded" | "failed" | "timeout";
    runId?: string;
    datasetId?: string | null;
    sampleCount?: number;
    samples?: unknown[];
    errorMessage?: string | null;
    input?: unknown;
  };
};

type DebugEvent = { step: string; detail: string; data?: unknown };

type ActorCandidate = {
  id: string;
  name: string;
  title: string;
  username?: string;
  url?: string;
  description?: string;
  stats?: { rating?: number; totalRuns?: number };
  currentPricingInfo?: { pricingModel?: string };
};

type VerificationResult = NonNullable<SequenceDraft["verification"]>;

async function logLLM(event: string, payload: Record<string, unknown>) {
  try {
    const dir = `${process.cwd()}/logs`;
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...payload,
    });
    await appendFile(`${dir}/llm.log`, `${line}\n`);
  } catch {
    // best-effort logging
  }
}

function normalizeCandidateText(actor: ActorCandidate) {
  return `${actor.title ?? ""} ${actor.name ?? ""} ${actor.description ?? ""}`.trim();
}

function extractReadmeSection(text: string) {
  if (!text) return "";
  const lower = text.toLowerCase();
  const markers = ["## input", "### input", "input schema", "## usage", "### usage", "## api"];
  let idx = -1;
  for (const marker of markers) {
    idx = lower.indexOf(marker);
    if (idx >= 0) break;
  }
  if (idx >= 0) {
    return text.slice(idx, idx + 8000);
  }
  if (text.length <= 12000) return text;
  return `${text.slice(0, 8000)}\n...\n${text.slice(-3000)}`;
}

async function hasReadme(actorId: string, username?: string, name?: string, token?: string) {
  if (username && name) {
    const url = `https://apify.com/${username}/${name}.md`;
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) {
      const text = await response.text();
      if (text.trim().length > 200) return text;
    }
  }
  if (token) {
    const response = await fetch(`${APIFY_ACTOR_BASE}/${encodeURIComponent(actorId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (response.ok) {
      const data = await response.json();
      const text = data?.data?.readme ?? data?.data?.readmeMarkdown ?? "";
      if (typeof text === "string" && text.trim().length > 200) return text;
    }
  }
  return null;
}

async function searchActors(query: string, token?: string) {
  const url = new URL(APIFY_STORE_BASE);
  url.searchParams.set("search", query);
  url.searchParams.set("limit", "50");
  url.searchParams.set("sortBy", "popularity");
  const response = await fetch(url.toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: "no-store",
  });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data?.data?.items) ? data.data.items : [];
}

function applyVerificationLimits(input: Record<string, unknown>) {
  const limited = { ...input };
  const limitKeys = [
    "limit",
    "maxResults",
    "maxItems",
    "maxItemsPerQuery",
    "resultsLimit",
    "maxPosts",
    "maxReviews",
    "maxProfiles",
    "maxVideos",
    "maxComments",
  ];
  for (const key of limitKeys) {
    if (key in limited && typeof limited[key] === "number") {
      limited[key] = Math.min(limited[key] as number, MAX_ITEMS);
    }
  }
  const arrayKeys = [
    "searchQueries",
    "queries",
    "keywords",
    "handles",
    "startUrls",
    "urls",
    "channelUrls",
    "profileUrls",
  ];
  for (const key of arrayKeys) {
    if (Array.isArray(limited[key])) {
      limited[key] = (limited[key] as unknown[]).slice(0, Math.min(3, MAX_ITEMS));
    }
  }
  if (typeof limited.maxResults === "number" && typeof limited.maxItemsPerQuery === "number") {
    const maxPerQuery = limited.maxItemsPerQuery as number;
    limited.maxItemsPerQuery = Math.min(maxPerQuery, Math.max(1, Math.floor(MAX_ITEMS / 2)));
  }
  return limited;
}

function validateInputAgainstSchema(schema: unknown, input: unknown) {
  if (!schema || typeof schema !== "object") return { ok: true, errors: [] as string[] };
  const ajv = new Ajv({ allErrors: true, strict: false });
  const normalizeSchema = { ...(schema as Record<string, unknown>) };
  if (!normalizeSchema.type) normalizeSchema.type = "object";
  const validate = ajv.compile(normalizeSchema);
  const ok = validate(input);
  if (ok) return { ok: true, errors: [] as string[] };
  const errors = (validate.errors || []).map((err) => `${err.instancePath} ${err.message}`.trim());
  return { ok: false, errors };
}

function buildErrorHints(errorMessage: string) {
  const hints: string[] = [];
  const fieldMatch = errorMessage.match(/Field input\.([a-zA-Z0-9_]+)/);
  const allowedMatch = errorMessage.match(/allowed values: (.+)$/);
  if (fieldMatch && allowedMatch) {
    const field = fieldMatch[1];
    const values = Array.from(allowedMatch[1].matchAll(/\"([^\"]+)\"/g)).map((m) => m[1]);
    if (values.length) {
      hints.push(`Field ${field} must be one of: ${values.join(", ")}`);
    }
  }
  if (/must be provided/i.test(errorMessage)) {
    hints.push("Ensure required input fields are present and non-empty.");
  }
  return hints.join(" ");
}

async function runActorVerification(
  actorId: string,
  input: Record<string, unknown>,
  token: string
): Promise<VerificationResult> {
  const limitedInput = applyVerificationLimits(input);
  const runResponse = await fetch(`${APIFY_ACTOR_BASE}/${encodeURIComponent(actorId)}/runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(limitedInput),
  });

  if (!runResponse.ok) {
    const errorText = await runResponse.text();
    return { status: "failed" as const, errorMessage: errorText, input: limitedInput };
  }

  const runData = await runResponse.json();
  const run = runData?.data;
  if (!run?.id) {
    return { status: "failed" as const, errorMessage: "Missing run id", input: limitedInput };
  }

  let status = run.status as string;
  let latest = run;
  const startedAt = Date.now();
  while (!"SUCCEEDED FAILED ABORTED TIMED-OUT".includes(status)) {
    if (Date.now() - startedAt > 60000) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const poll = await fetch(`${APIFY_RUN_BASE}/${encodeURIComponent(run.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!poll.ok) break;
    const pollData = await poll.json();
    latest = pollData?.data ?? latest;
    status = latest?.status ?? status;

    const totalCostUsd =
      latest?.usage?.totalCostUsd ??
      latest?.usage?.totalCost ??
      latest?.costUsd ??
      latest?.cost ??
      null;

    if (typeof totalCostUsd === "number" && totalCostUsd > BUDGET_LIMIT_USD) {
      await fetch(`${APIFY_RUN_BASE}/${encodeURIComponent(run.id)}/abort`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      return {
        status: "failed" as const,
        runId: run.id,
        datasetId: latest?.defaultDatasetId ?? null,
        errorMessage: `Run cost ${totalCostUsd} exceeded budget ${BUDGET_LIMIT_USD}.`,
        input: limitedInput,
      };
    }

    if (latest?.defaultDatasetId) {
      const datasetResponse = await fetch(
        `https://api.apify.com/v2/datasets/${encodeURIComponent(latest.defaultDatasetId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (datasetResponse.ok) {
        const dataset = await datasetResponse.json();
        const itemCount = dataset?.data?.itemCount ?? null;
        if (typeof itemCount === "number" && itemCount > MAX_ITEMS) {
          await fetch(`${APIFY_RUN_BASE}/${encodeURIComponent(run.id)}/abort`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          return {
            status: "failed" as const,
            runId: run.id,
            datasetId: latest?.defaultDatasetId ?? null,
            errorMessage: `Dataset itemCount ${itemCount} exceeded limit.`,
            input: limitedInput,
          };
        }
      }
    }
  }

  if (status !== "SUCCEEDED") {
    const finalStatus: VerificationResult["status"] =
      status === "TIMED-OUT" ? "timeout" : "failed";
    return {
      status: finalStatus,
      runId: run.id,
      datasetId: latest?.defaultDatasetId ?? null,
      errorMessage: latest?.statusMessage ?? latest?.errorMessage ?? null,
      input: limitedInput,
    };
  }

  let samples: unknown[] = [];
  if (latest?.defaultDatasetId) {
    const itemsResponse = await fetch(
      `https://api.apify.com/v2/datasets/${encodeURIComponent(latest.defaultDatasetId)}/items?clean=true&limit=3`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (itemsResponse.ok) {
      const items = await itemsResponse.json();
      if (Array.isArray(items)) {
        samples = items;
      }
    }
  }

  return {
    status: "succeeded" as const,
    runId: run.id,
    datasetId: latest?.defaultDatasetId ?? null,
    sampleCount: samples.length,
    samples,
    input: limitedInput,
  };
}

function buildHookOfferCta(idea: Idea) {
  return {
    hook: idea.title,
    offer: "Provide a concise, value-forward offer.",
    cta: "Open to a quick reply?",
  };
}

function sampleHasContact(samples: unknown[]) {
  const emailRegex = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  for (const item of samples) {
    if (!item || typeof item !== "object") continue;
    const text = JSON.stringify(item).toLowerCase();
    if (emailRegex.test(text)) return true;
    if (text.includes("http://") || text.includes("https://")) return true;
    if (text.includes("username") || text.includes("profile")) return true;
  }
  return false;
}

async function suggestActorQueries(idea: Idea, apiKey: string) {
  const prompt = [
    "Generate 3-5 alternative Apify Store search queries.",
    "Queries must be different from the original actorQuery.",
    "Return JSON only: { queries: string[] }",
    "Idea:",
    JSON.stringify(idea, null, 2),
  ].join("\n");

  const response = await fetch(OPENAI_API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.2",
      input: prompt,
      text: { format: { type: "json_object" } },
    }),
  });

  const raw = await response.text();
  await logLLM("suggestActorQueries", { prompt, response: raw });
  if (!response.ok) return [];
  let data: any = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  const content = data?.output?.[0]?.content?.[0]?.text ?? "{}";
  try {
    const parsed = JSON.parse(content);
    const queries = Array.isArray(parsed.queries) ? parsed.queries : [];
    return queries.map((query: unknown) => String(query)).filter((query: string) => query.trim().length > 0);
  } catch {
    return [];
  }
}

async function suggestAlternativeIdea(idea: Idea, apiKey: string) {
  const prompt = [
    "Propose ONE alternative outreach idea with a different channel and actorQuery.",
    "Return JSON only: { idea: { title, channel, rationale, actorQuery, seedInputs } }",
    "Idea:",
    JSON.stringify(idea, null, 2),
  ].join("\n");

  const response = await fetch(OPENAI_API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.2",
      input: prompt,
      text: { format: { type: "json_object" } },
    }),
  });

  const raw = await response.text();
  await logLLM("suggestAlternativeIdea", { prompt, response: raw });
  if (!response.ok) return null;
  let data: any = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  const content = data?.output?.[0]?.content?.[0]?.text ?? "{}";
  try {
    const parsed = JSON.parse(content);
    const alt = parsed?.idea;
    if (!alt || !alt.title || !alt.channel || !alt.actorQuery) return null;
    return {
      title: String(alt.title),
      channel: String(alt.channel),
      rationale: String(alt.rationale || ""),
      actorQuery: String(alt.actorQuery),
      seedInputs: alt.seedInputs ?? [],
    } as Idea;
  } catch {
    return null;
  }
}

async function selectActorWithLLM(
  idea: Idea,
  candidates: ActorCandidate[],
  readmes: Map<string, string>,
  apiKey: string
) {
  const prompt = [
    "You are selecting Apify actors for an outreach idea.",
    "Pick up to 3 actors that are most likely to produce contactable leads for this idea.",
    "Use README and title/description to decide. Prefer actors that can search, not just download or transcripts.",
    "Return JSON only: { selectedIds: string[] }",
    "Idea:",
    JSON.stringify(idea, null, 2),
    "Candidates:",
    JSON.stringify(
      candidates.map((actor) => ({
        id: actor.id,
        title: actor.title,
        name: actor.name,
        description: actor.description,
        rating: actor.stats?.rating,
        runs: actor.stats?.totalRuns,
        pricing: actor.currentPricingInfo?.pricingModel,
        readmeSnippet: (readmes.get(actor.id) ?? "").slice(0, 600),
      })),
      null,
      2
    ),
  ].join("\n");

  const response = await fetch(OPENAI_API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.2",
      input: prompt,
      text: { format: { type: "json_object" } },
    }),
  });

  const raw = await response.text();
  await logLLM("selectActorWithLLM", { prompt, response: raw });
  if (!response.ok) return [];
  let data: any = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  const content = data?.output?.[0]?.content?.[0]?.text ?? "{}";
  try {
    const parsed = JSON.parse(content);
    const ids = Array.isArray(parsed.selectedIds) ? parsed.selectedIds : [];
    return ids.map((id: unknown) => String(id)).filter((id: string) => id.trim().length > 0);
  } catch {
    return [];
  }
}

async function extractRequiredFieldsFromReadme(
  actor: ActorCandidate,
  readmeText: string,
  apiKey: string
) {
  const readmeSection = extractReadmeSection(readmeText);
  const prompt = [
    "You are extracting required input fields for an Apify actor from its README.",
    "Return JSON only: { requiredFields: string[], notes: string }",
    "If the README is unclear, return an empty list and explain in notes.",
    "Actor:",
    JSON.stringify({ title: actor.title, name: actor.name, description: actor.description }, null, 2),
    "README:",
    readmeSection,
  ].join("\n");

  const response = await fetch(OPENAI_API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.2",
      input: prompt,
      text: { format: { type: "json_object" } },
    }),
  });

  const raw = await response.text();
  await logLLM("extractRequiredFieldsFromReadme", { prompt, response: raw });
  if (!response.ok) return { requiredFields: [] as string[], notes: "readme parse failed" };
  try {
    const data = JSON.parse(raw);
    const content = data?.output?.[0]?.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(content);
    const fields = Array.isArray(parsed.requiredFields) ? parsed.requiredFields : [];
    return {
      requiredFields: fields.map((field: unknown) => String(field)).filter((v: string) => v.trim().length > 0),
      notes: String(parsed.notes || ""),
    };
  } catch {
    return { requiredFields: [] as string[], notes: "readme parse failed" };
  }
}

async function buildInputTemplate(
  idea: Idea,
  actor: ActorCandidate,
  schema: unknown,
  readmeText: string,
  apiKey: string,
  requestContext: RequestContext,
  notes?: string
) {
  const readmeSection = extractReadmeSection(readmeText);
  const prompt = [
    "You are building a JSON input payload for an Apify actor.",
    `Actor title: ${actor.title}`,
    `Actor description: ${actor.description ?? ""}`,
    "Rules:",
    "- Output JSON only (no markdown).",
    "- Include required fields from the schema if present.",
    `- Limit result count to ${MAX_ITEMS} or fewer.`,
    "- Use the idea seedInputs when possible.",
    notes ? `Notes: ${notes}` : "",
    "Schema:",
    JSON.stringify(schema ?? {}, null, 2),
    "README:",
    readmeSection,
    "Idea:",
    JSON.stringify(idea, null, 2),
    "User context:",
    JSON.stringify(requestContext, null, 2),
  ].join("\n");

  const response = await fetch(OPENAI_API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.2",
      input: prompt,
      text: { format: { type: "json_object" } },
    }),
  });

  const raw = await response.text();
  await logLLM("buildInputTemplate", { prompt, response: raw });
  if (!response.ok) {
    return "{}";
  }
  let data: any = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  const content = data?.output?.[0]?.content?.[0]?.text ?? "{}";
  return content;
}

export async function POST(request: Request) {
  const body = await request.json();
  const ideas: Idea[] = Array.isArray(body?.ideas) ? body.ideas : [];
  const token = process.env.APIFY_TOKEN;
  const openaiKey = process.env.OPENAI_API_KEY;
  const verify = body?.verify !== false;
  const debugEnabled = Boolean(body?.debug);
  const debugEvents: DebugEvent[] = [];

  const requestContext: RequestContext = {
    constraints: body?.constraints ?? {},
    context: body?.context ?? {},
    preferences: body?.preferences ?? {},
    exclusions: body?.exclusions ?? {},
    needs: body?.needs ?? {},
  };

  const hasKeys = (value: unknown) =>
    Boolean(value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0);

  if (!ideas.length) {
    return NextResponse.json({ error: "No ideas provided." }, { status: 400 });
  }
  if (!hasKeys(requestContext.context) || !hasKeys(requestContext.needs)) {
    return NextResponse.json(
      { error: "Context and needs are required for sequence building." },
      { status: 400 }
    );
  }
  if (!token) {
    return NextResponse.json({ error: "APIFY_TOKEN is missing." }, { status: 500 });
  }

  const sequences: SequenceDraft[] = [];

  for (const baseIdea of ideas) {
    let idea: Idea = baseIdea;
    let triedAltIdea = false;
    let candidates: ActorCandidate[] = [];
    const readmeById = new Map<string, string>();

    const attemptQueries = [idea.actorQuery];
    if (openaiKey) {
      const altQueries = await suggestActorQueries(idea, openaiKey);
      attemptQueries.push(...altQueries);
    }

    for (const query of attemptQueries) {
      const items = await searchActors(query, token);
      const filtered: ActorCandidate[] = [];
      for (const item of items) {
        const pricing = item?.currentPricingInfo?.pricingModel;
        if (!ALLOWED_PRICING.has(pricing)) continue;
        const readme = await hasReadme(item?.id, item?.username, item?.name, token);
        if (!readme) continue;
        readmeById.set(item.id, readme);
        filtered.push(item as ActorCandidate);
        if (filtered.length >= 8) break;
      }
      if (filtered.length) {
        candidates = filtered;
        debugEvents.push({ step: "candidates", detail: "found", data: filtered.map((c) => c.id) });
        break;
      }
      debugEvents.push({ step: "candidates", detail: "none", data: query });
    }

    if (!candidates.length && openaiKey && !triedAltIdea) {
      const altIdea = await suggestAlternativeIdea(idea, openaiKey);
      if (altIdea) {
        idea = altIdea;
        triedAltIdea = true;
      }
    }

    if (!candidates.length) {
      continue;
    }

    let selected = candidates[0];
    if (openaiKey) {
      const selectedIds = await selectActorWithLLM(idea, candidates, readmeById, openaiKey);
      const preferred = candidates.find((actor) => actor.id === selectedIds[0]);
      if (preferred) {
        selected = preferred;
      }
      if (selectedIds.length) {
        debugEvents.push({ step: "select", detail: "llm", data: selectedIds });
      }
    }
    const actorDetailsResponse = await fetch(`${APIFY_ACTOR_BASE}/${encodeURIComponent(selected.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const actorDetails = actorDetailsResponse.ok ? await actorDetailsResponse.json() : null;
    const schema = actorDetails?.data?.inputSchema ?? null;
    const readmeText = readmeById.get(selected.id) ?? "";
    const readmeRequired = openaiKey
      ? await extractRequiredFieldsFromReadme(selected, readmeText, openaiKey)
      : { requiredFields: [] as string[], notes: "" };

    let inputTemplate = openaiKey
      ? await buildInputTemplate(
          idea,
          selected,
          schema,
          readmeText,
          openaiKey,
          requestContext,
          readmeRequired.requiredFields.length
            ? `Required fields from README: ${readmeRequired.requiredFields.join(", ")}. ${readmeRequired.notes}`
            : readmeRequired.notes
        )
      : "{}";

    const copy = buildHookOfferCta(idea);
    let verification: SequenceDraft["verification"] = { status: "pending" };

    if (verify) {
      const maxRunAttempts = 3;
      let runAttempt = 0;
      while (runAttempt < maxRunAttempts) {
        runAttempt += 1;
        try {
          let parsedInput = JSON.parse(inputTemplate);
          parsedInput = applyVerificationLimits(parsedInput);
          const maxSchemaAttempts = 3;
          let attempt = 0;
          while (schema && attempt < maxSchemaAttempts) {
            const result = validateInputAgainstSchema(schema, parsedInput);
            if (result.ok) break;
            attempt += 1;
            if (!openaiKey) break;
            inputTemplate = await buildInputTemplate(
              idea,
              selected,
              schema,
              readmeText,
              openaiKey,
              requestContext,
              `Schema errors: ${result.errors.join("; ")}`
            );
            parsedInput = applyVerificationLimits(JSON.parse(inputTemplate));
          }
          verification = await runActorVerification(selected.id, parsedInput, token);
          if (verification.status === "succeeded" && verification.samples) {
            if (!sampleHasContact(verification.samples)) {
              verification = {
                status: "failed",
                errorMessage: "Sample results lack contactable fields.",
                input: verification.input,
                samples: verification.samples,
                sampleCount: verification.sampleCount,
                datasetId: verification.datasetId,
                runId: verification.runId,
              };
            } else {
              break;
            }
          }
          if (verification.status === "failed" && verification.errorMessage && openaiKey) {
            const hints = buildErrorHints(verification.errorMessage);
            inputTemplate = await buildInputTemplate(
              idea,
              selected,
              schema,
              readmeText,
              openaiKey,
              requestContext,
              `Run failed. Error: ${verification.errorMessage} ${hints}`
            );
            continue;
          }
          break;
        } catch {
          verification = { status: "failed", errorMessage: "Invalid input JSON" };
          break;
        }
      }
    }

    const sequence: SequenceDraft = {
      id: `${selected.id}-${idea.title}`.replace(/\s+/g, "-").toLowerCase(),
      actor: {
        id: selected.id,
        name: selected.name,
        title: selected.title,
        username: selected.username,
        url: selected.url,
        description: selected.description,
        rating: selected.stats?.rating,
        usage: selected.stats?.totalRuns,
        pricingModel: selected.currentPricingInfo?.pricingModel,
      },
      hook: copy.hook,
      offer: copy.offer,
      cta: copy.cta,
      inputTemplate,
      runnable: false,
      verification,
    };

    sequences.push(sequence);
  }

  return NextResponse.json({
    sequences,
    debug: debugEnabled ? debugEvents : undefined,
  });
}
