import { NextResponse } from "next/server";
import { appendFile, mkdir } from "fs/promises";

const OPENAI_API_BASE = "https://api.openai.com/v1/responses";

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
    const fallback: Idea[] = [
      {
        title: "Commission-ready Instagram hashtag harvest",
        channel: "Instagram",
        rationale: "Targets buyers browsing commission-focused tags.",
        actorQuery: "Instagram scraper",
        seedInputs: ["#commissionopen", "#illustration", "#artdirector"],
      },
      {
        title: "YouTube creator business email pull",
        channel: "YouTube",
        rationale: "Finds creators hiring thumbnail or channel art support.",
        actorQuery: "YouTube channel scraper",
        seedInputs: ["thumbnail artist", "business inquiries"],
      },
      {
        title: "Reddit hiring posts for concept art",
        channel: "Reddit",
        rationale: "Targets immediate hiring intent in niche subreddits.",
        actorQuery: "Reddit scraper",
        seedInputs: ["forhire", "gameDevClassifieds"],
      },
    ];
    return NextResponse.json({ ideas: fallback, mode: "fallback" });
  }

  const prompt = [
    "You are an adversarial brainstormer.",
    "Generate 5-8 outreach acquisition ideas that are not similar to existing ideas.",
    "At least 3 ideas must be scrapeable with Apify (Instagram, TikTok, YouTube, Reddit, X/Twitter, LinkedIn).",
    "Avoid marketplaces unless explicitly requested by the user.",
    "For scrapeable ideas, actorQuery must be a short Apify Store query (2-6 words).",
    "Return JSON only as: { ideas: Idea[] } where Idea = { title, channel, rationale, actorQuery, seedInputs }",
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
  const content = data?.output?.[0]?.content?.[0]?.text ?? "{}";
  let parsed: { ideas?: Idea[] } = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }

  return NextResponse.json({
    ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [],
    mode: "openai",
  });
}
