import { NextResponse } from "next/server";
import { sanitizeAiText } from "@/lib/ai-sanitize";
import { getBrandById } from "@/lib/factory-data";
import { resolveLlmModel } from "@/lib/llm-router";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function clipText(value: unknown, maxLength: number) {
  return sanitizeAiText(String(value ?? "").trim()).slice(0, maxLength).trim();
}

function parseDraft(value: unknown) {
  const row = asRecord(value);
  return {
    name: clipText(row.name, 140),
    audience: clipText(row.audience, 900),
    offer: clipText(row.offer, 900),
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  try {
    const { brandId } = await context.params;
    const brand = await getBrandById(brandId);
    if (!brand) {
      return NextResponse.json({ error: "brand not found" }, { status: 404 });
    }

    const body = asRecord(await request.json().catch(() => ({})));
    const prompt = clipText(body.prompt, 1600);
    const current = asRecord(body.current);
    const currentDraft = {
      name: clipText(current.name, 140),
      audience: clipText(current.audience, 900),
      offer: clipText(current.offer, 900),
    };

    if (!prompt) {
      return NextResponse.json(
        { error: "prompt is required", hint: "Describe the audience, problem, and offer you want." },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error: "OPENAI_API_KEY is not configured",
          hint: "AI setup drafting is disabled until OpenAI is configured.",
        },
        { status: 503 }
      );
    }

    const promptText = [
      "Turn the user's plain-English request into an outreach experiment setup draft.",
      "Return strict JSON only as: { \"name\": string, \"audience\": string, \"offer\": string }",
      "",
      "Write for a normal human, not a marketer.",
      "A smart 12-year-old should understand it on first read.",
      "",
      "Rules:",
      "- name must be short, plain-English, and user-facing.",
      "- audience must explain who we should contact, what kind of company they are at, and the problem they likely have.",
      "- offer must explain what we are offering, what the recipient gets, and the single ask we will make.",
      "- Keep audience and offer concrete and specific. No bullets.",
      "- Avoid jargon like ICP, funnel, teardown, enablement, leverage, artifact, persona, or optimization.",
      "- Do not mention internal tools, providers, or implementation details.",
      "- If the user is vague, make the best reasonable concrete version instead of asking follow-up questions.",
      "",
      `BrandContext: ${JSON.stringify({
        brandName: brand.name,
        website: brand.website,
        product: brand.product,
        tone: brand.tone,
        notes: brand.notes,
        markets: brand.targetMarkets,
        buyers: brand.idealCustomerProfiles,
        features: brand.keyFeatures,
        benefits: brand.keyBenefits,
      })}`,
      `CurrentDraft: ${JSON.stringify(currentDraft)}`,
      `UserPrompt: ${prompt}`,
    ].join("\n");

    const model = resolveLlmModel("experiment_setup_generate", { prompt: promptText });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: promptText,
        text: { format: { type: "json_object" } },
        max_output_tokens: 1200,
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      return NextResponse.json(
        {
          error: "experiment draft generation failed",
          hint: "Try again in a moment.",
          providerStatus: response.status,
        },
        { status: 502 }
      );
    }

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

    let parsed: unknown = {};
    try {
      parsed = JSON.parse(outputText);
    } catch {
      parsed = {};
    }

    const draft = parseDraft(parsed);
    if (!draft.name || !draft.audience || !draft.offer) {
      return NextResponse.json(
        {
          error: "experiment draft generation returned no usable draft",
          hint: "Try being a little more specific about who you want to reach and what you want to offer.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ draft, mode: "openai" });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to generate experiment draft",
        hint: "Try again in a moment.",
        debug: { reason: error instanceof Error ? error.message : "Unknown error" },
      },
      { status: 500 }
    );
  }
}
