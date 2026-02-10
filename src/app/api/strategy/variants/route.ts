import { NextResponse } from "next/server";
import { appendFile, mkdir } from "fs/promises";

const OPENAI_API_BASE = "https://api.openai.com/v1/responses";

type StrategyVariant = {
  title: string;
  goal: string;
  constraints: string;
  scoring: {
    replyWeight: number;
    conversionWeight: number;
    qualityWeight: number;
  };
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

const fallbackVariants: StrategyVariant[] = [
  {
    title: "Founder-led outbound sprint",
    goal: "Book 10 founder-level discovery calls with operators who already buy AI video.",
    constraints: "Personalized first-line, max 60 outbound/day, prioritize warm communities and creators.",
    scoring: { replyWeight: 0.3, conversionWeight: 0.6, qualityWeight: 0.1 },
  },
  {
    title: "Creative ops wedge",
    goal: "Land 5 pilot projects with creative ops leads at high-velocity teams.",
    constraints: "Focus on teams with weekly launches, use proof + time-saved angle, 40 leads/day.",
    scoring: { replyWeight: 0.2, conversionWeight: 0.7, qualityWeight: 0.1 },
  },
  {
    title: "Agency partner channel",
    goal: "Recruit 3 agencies to resell AI personalized video as a service line.",
    constraints: "Target agencies with video production focus, 25 leads/day, partner pitch.",
    scoring: { replyWeight: 0.2, conversionWeight: 0.6, qualityWeight: 0.2 },
  },
];

export async function POST(request: Request) {
  const body = await request.json();
  const context = body?.context ?? {};
  const needs = body?.needs ?? {};
  const constraints = body?.constraints ?? {};

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ variants: fallbackVariants, mode: "fallback" });
  }

  const prompt = [
    "You are a strategy designer for outbound growth.",
    "Generate 3-5 distinct outreach strategy variants.",
    "Each variant must include: title, goal, constraints, scoring weights (replyWeight, conversionWeight, qualityWeight).",
    "Scoring weights must sum to 1.0. Favor conversionWeight over replyWeight.",
    "Return JSON only as: { variants: StrategyVariant[] }.",
    "Context:",
    JSON.stringify(context, null, 2),
    "Needs:",
    JSON.stringify(needs, null, 2),
    "Constraints:",
    JSON.stringify(constraints, null, 2),
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
  await logLLM("strategy_variants", { prompt, response: raw });
  if (!response.ok) {
    return NextResponse.json(
      { error: "Strategy generation failed.", details: raw },
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
  let parsed: { variants?: StrategyVariant[] } = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }

  const variants = Array.isArray(parsed.variants) ? parsed.variants : [];
  return NextResponse.json({ variants: variants.length ? variants : fallbackVariants, mode: "openai" });
}
