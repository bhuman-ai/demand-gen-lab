import { NextResponse } from "next/server";
import { appendFile, mkdir } from "fs/promises";

const OPENAI_API_BASE = "https://api.openai.com/v1/responses";

type Idea = {
  title: string;
  channel: string;
  rationale: string;
  actorQuery: string;
  seedInputs: string[];
};

type RequestContext = {
  constraints?: unknown;
  context?: unknown;
  preferences?: unknown;
  exclusions?: unknown;
  needs?: unknown;
};

type ParsedIdea = {
  title?: unknown;
  name?: unknown;
  headline?: unknown;
  channel?: unknown;
  platform?: unknown;
  source?: unknown;
  rationale?: unknown;
  reason?: unknown;
  why?: unknown;
  actorQuery?: unknown;
  actor_query?: unknown;
  apifyQuery?: unknown;
  apify_query?: unknown;
  actorSearchQuery?: unknown;
  seedInputs?: unknown;
  seed_keywords?: unknown;
  keywords?: unknown;
};

function normalizeSeedInputs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 12);
  }
  if (typeof value === "string") {
    return value
      .split(/\n|,/g)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12);
  }
  return [];
}

function normalizeWords(value: string, maxWords: number) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxWords);
}

function inferChannelFromText(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("instagram")) return "Instagram";
  if (lower.includes("youtube")) return "YouTube";
  if (lower.includes("reddit")) return "Reddit";
  if (lower.includes("linkedin")) return "LinkedIn";
  if (lower.includes("tiktok")) return "TikTok";
  if (lower.includes("twitter") || lower.includes("x.com") || lower.includes("x ")) return "X";
  return "";
}

function buildActorQuery(channel: string, title: string, explicit: string) {
  if (explicit.trim()) {
    return normalizeWords(explicit, 6).join(" ");
  }
  const inferredChannel = channel || inferChannelFromText(title) || "web";
  const titleWords = normalizeWords(title, 3).filter((word) => !["and", "for", "with", "the"].includes(word));
  const queryWords = [...normalizeWords(inferredChannel, 2), ...titleWords].slice(0, 5);
  const candidate = queryWords.join(" ").trim();
  return candidate || "lead scraper";
}

function extractIdeasCandidate(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const objectPayload = payload as Record<string, unknown>;
  const keys = ["ideas", "hypotheses", "suggestions", "items", "variants", "results", "data"];
  for (const key of keys) {
    if (Array.isArray(objectPayload[key])) {
      return objectPayload[key] as unknown[];
    }
  }
  if (
    objectPayload.title ||
    objectPayload.name ||
    objectPayload.headline ||
    objectPayload.actorQuery ||
    objectPayload.apifyQuery
  ) {
    return [objectPayload];
  }
  return [];
}

function normalizeIdeas(value: unknown): Idea[] {
  const candidates = extractIdeasCandidate(value);
  const dedupe = new Set<string>();
  const ideas: Idea[] = [];
  for (const item of candidates as ParsedIdea[]) {
    const title = String(item?.title ?? item?.name ?? item?.headline ?? "").trim();
    const channel = String(item?.channel ?? item?.platform ?? item?.source ?? "").trim() || inferChannelFromText(title);
    const rationale = String(item?.rationale ?? item?.reason ?? item?.why ?? "").trim();
    const actorQueryRaw = String(
      item?.actorQuery ??
        item?.actor_query ??
        item?.apifyQuery ??
        item?.apify_query ??
        item?.actorSearchQuery ??
        ""
    ).trim();
    const actorQuery = buildActorQuery(channel, title, actorQueryRaw);
    const seedInputs = normalizeSeedInputs(item?.seedInputs ?? item?.seed_keywords ?? item?.keywords);
    if (!title || !channel || !rationale) {
      continue;
    }
    const key = `${title.toLowerCase()}::${channel.toLowerCase()}`;
    if (dedupe.has(key)) {
      continue;
    }
    dedupe.add(key);
    ideas.push({
      title,
      channel,
      rationale,
      actorQuery,
      seedInputs,
    });
  }
  return ideas.slice(0, 8);
}

function extractResponsePayload(data: any): unknown {
  if (data?.output_parsed && typeof data.output_parsed === "object") {
    return data.output_parsed;
  }
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    try {
      return JSON.parse(data.output_text);
    } catch {
      return data.output_text;
    }
  }
  if (Array.isArray(data?.output)) {
    for (const chunk of data.output) {
      const content = Array.isArray(chunk?.content) ? chunk.content : [];
      for (const entry of content) {
        if (entry?.json && typeof entry.json === "object") {
          return entry.json;
        }
        if (typeof entry?.text === "string" && entry.text.trim()) {
          try {
            return JSON.parse(entry.text);
          } catch {
            return entry.text;
          }
        }
      }
    }
  }
  return {};
}

function extractResponseText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }
  const chunks = Array.isArray(data?.output) ? data.output : [];
  for (const chunk of chunks) {
    const content = Array.isArray(chunk?.content) ? chunk.content : [];
    for (const entry of content) {
      if (typeof entry?.text === "string" && entry.text.trim()) {
        return entry.text;
      }
    }
  }
  return "{}";
}

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

export async function POST(request: Request) {
  const body = await request.json();
  const goal = String(body?.goal ?? "");
  const existingIdeas = Array.isArray(body?.existingIdeas) ? body.existingIdeas : [];
  const requestContext: RequestContext = {
    constraints: body?.constraints ?? {},
    context: body?.context ?? {},
    preferences: body?.preferences ?? {},
    exclusions: body?.exclusions ?? {},
    needs: body?.needs ?? {},
  };

  const hasKeys = (value: unknown) =>
    Boolean(value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0);

  if (!goal.trim()) {
    return NextResponse.json({ error: "Goal is required." }, { status: 400 });
  }
  if (!hasKeys(requestContext.context) || !hasKeys(requestContext.needs)) {
    return NextResponse.json(
      { error: "Context and needs are required for idea generation." },
      { status: 400 }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured for hypothesis generation." },
      { status: 503 }
    );
  }

  const prompt = [
    "You are an adversarial brainstormer.",
    "Generate 5-8 outreach acquisition hypotheses that are tightly aligned to objective + brand context.",
    "At least 3 ideas must be scrapeable with Apify (Instagram, TikTok, YouTube, Reddit, X/Twitter, LinkedIn).",
    "Avoid marketplaces unless explicitly requested by the user.",
    "Do not suggest generic channels without a concrete reason tied to objective constraints and brand ICP.",
    "Do not repeat or paraphrase existing ideas.",
    "For scrapeable ideas, actorQuery must be a short Apify Store query (2-6 words).",
    "Return JSON only: { \"ideas\": Idea[] }",
    "Idea schema: { title: string, channel: string, rationale: string, actorQuery: string, seedInputs: string[] }",
    "Goal:",
    goal,
    "User context:",
    JSON.stringify(requestContext, null, 2),
    "Existing ideas (avoid similarity):",
    JSON.stringify(existingIdeas, null, 2),
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
      max_output_tokens: 1400,
    }),
  });

  const raw = await response.text();
  await logLLM("ideas", { prompt, response: raw });
  if (!response.ok) {
    return NextResponse.json(
      { error: "Idea generation failed.", details: raw },
      { status: response.status }
    );
  }

  let data: any = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  const payload = extractResponsePayload(data);
  const content = extractResponseText(data);
  let parsed: unknown = payload;
  try {
    if (!parsed || typeof parsed === "string") {
      parsed = JSON.parse(content);
    }
  } catch {
    parsed = payload;
  }

  const ideas = normalizeIdeas(parsed);
  if (!ideas.length) {
    return NextResponse.json(
      { error: "Model returned no valid hypotheses for this objective. Refine objective details and retry." },
      { status: 422 }
    );
  }

  return NextResponse.json({
    ideas,
    mode: "openai",
  });
}
