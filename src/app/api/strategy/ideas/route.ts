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
  channel?: unknown;
  rationale?: unknown;
  actorQuery?: unknown;
  seedInputs?: unknown;
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

function normalizeIdeas(value: unknown): Idea[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const dedupe = new Set<string>();
  const ideas: Idea[] = [];
  for (const item of value as ParsedIdea[]) {
    const title = String(item?.title ?? "").trim();
    const channel = String(item?.channel ?? "").trim();
    const rationale = String(item?.rationale ?? "").trim();
    const actorQuery = String(item?.actorQuery ?? "").trim();
    const seedInputs = normalizeSeedInputs(item?.seedInputs);
    if (!title || !channel || !rationale || !actorQuery) {
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
  const content = extractResponseText(data);
  let parsed: { ideas?: Idea[] } = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }

  const ideas = normalizeIdeas(parsed?.ideas);
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
