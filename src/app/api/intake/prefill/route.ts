import { NextResponse } from "next/server";
import { resolveLlmModel } from "@/lib/llm-router";

function extractMeta(html: string, name: string) {
  const regex = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = html.match(regex);
  return match ? match[1].trim() : "";
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : "";
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const rows: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const line = String(entry ?? "").trim();
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(line);
  }
  return rows.slice(0, 8);
}

function fallbackList(description: string, defaults: string[]) {
  const cleanDescription = description.trim();
  if (!cleanDescription) return defaults;
  const firstSentence = cleanDescription.split(/[.!?]/)[0]?.trim();
  if (!firstSentence) return defaults;
  return [firstSentence, ...defaults].slice(0, 4);
}

export async function POST(request: Request) {
  const body = await request.json();
  const url = String(body?.url ?? "").trim();

  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("invalid protocol");
    }
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "FactoryPrefillBot/1.0" },
    });
    if (!response.ok) {
      return NextResponse.json({ error: "fetch failed" }, { status: 502 });
    }
    const text = (await response.text()).slice(0, 200000);
    const title = extractMeta(text, "og:title") || extractTitle(text);
    const description =
      extractMeta(text, "og:description") ||
      extractMeta(text, "description") ||
      "";

    const hostname = parsed.hostname.replace(/^www\./, "");
    const brandName = title || hostname;
    const pageExcerpt = stripHtml(text).slice(0, 8000);

    const fallback = {
      brandName,
      tone: "Clear, practical, and direct",
      product: description || "",
      targetMarkets: fallbackList(description, [
        "Mid-market B2B teams",
        "Sales and growth leaders",
        "Teams with outbound pipeline goals",
      ]),
      idealCustomerProfiles: [
        "Head of Growth at B2B SaaS (20-200 employees)",
        "Sales leader responsible for pipeline creation",
      ],
      keyFeatures: [],
      keyBenefits: [],
      proof: description || "",
    };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        prefill: fallback,
        signals: {
          title,
          description,
          hostname,
          mode: "fallback",
        },
      });
    }

    const prompt = [
      "You extract structured brand onboarding context from website content for B2B outreach setup.",
      "Return strict JSON only.",
      "Do not hallucinate details that are not grounded in provided context.",
      "Keep each list item concise and actionable.",
      "",
      "Schema:",
      '{ "brandName": string, "tone": string, "product": string, "targetMarkets": string[], "idealCustomerProfiles": string[], "keyFeatures": string[], "keyBenefits": string[], "proof": string }',
      "",
      `URL: ${parsed.toString()}`,
      `Hostname: ${hostname}`,
      `Title: ${title}`,
      `Description: ${description}`,
      `PageExcerpt: ${pageExcerpt}`,
    ].join("\n");

    const model = resolveLlmModel("intake_prefill", { prompt });
    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        text: { format: { type: "json_object" } },
        max_output_tokens: 1200,
      }),
    });

    if (!aiResponse.ok) {
      return NextResponse.json({
        prefill: fallback,
        signals: {
          title,
          description,
          hostname,
          mode: "fallback",
        },
      });
    }

    const raw = await aiResponse.text();
    let payload: unknown = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    const payloadRecord = asRecord(payload);
    const output = Array.isArray(payloadRecord.output) ? payloadRecord.output : [];
    const firstOutput = asRecord(output[0]);
    const content = Array.isArray(firstOutput.content) ? firstOutput.content : [];
    const outputText =
      String(payloadRecord.output_text ?? "") ||
      String(content.map((item) => asRecord(item)).find((item) => typeof item.text === "string")?.text ?? "") ||
      "{}";

    let parsedAi: unknown = {};
    try {
      parsedAi = JSON.parse(outputText);
    } catch {
      parsedAi = {};
    }
    const ai = asRecord(parsedAi);

    return NextResponse.json({
      prefill: {
        brandName: String(ai.brandName ?? fallback.brandName).trim() || fallback.brandName,
        tone: String(ai.tone ?? fallback.tone).trim() || fallback.tone,
        product: String(ai.product ?? fallback.product).trim(),
        targetMarkets: normalizeStringArray(ai.targetMarkets).length
          ? normalizeStringArray(ai.targetMarkets)
          : fallback.targetMarkets,
        idealCustomerProfiles: normalizeStringArray(ai.idealCustomerProfiles).length
          ? normalizeStringArray(ai.idealCustomerProfiles)
          : fallback.idealCustomerProfiles,
        keyFeatures: normalizeStringArray(ai.keyFeatures),
        keyBenefits: normalizeStringArray(ai.keyBenefits),
        proof: String(ai.proof ?? fallback.proof).trim(),
      },
      signals: {
        title,
        description,
        hostname,
        mode: "openai",
      },
    });
  } catch {
    return NextResponse.json({ error: "prefill failed" }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
