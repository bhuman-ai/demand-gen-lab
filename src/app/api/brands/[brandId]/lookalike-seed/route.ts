import { NextResponse } from "next/server";
import { sanitizeAiText } from "@/lib/ai-sanitize";
import { getBrandById } from "@/lib/factory-data";
import { resolveLlmModel } from "@/lib/llm-router";

type SiteContext = {
  domain: string;
  title: string;
  description: string;
  pageExcerpt: string;
  fetchedUrl: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function clipText(value: unknown, maxLength: number) {
  return sanitizeAiText(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, maxLength).trim();
}

function normalizeStringArray(value: unknown, maxItems = 5, maxLength = 40) {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const line = clipText(entry, maxLength);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= maxItems) break;
  }
  return out;
}

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

function normalizeWebsiteToken(value: string) {
  const trimmed = value.trim().replace(/^[<([{"'`]+|[>\])}"'`,;]+$/g, "");
  if (!trimmed) return "";

  try {
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(hostname)) {
      return "";
    }
    return hostname;
  } catch {
    const normalized = trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[/?#].*$/, "")
      .replace(/\.+$/, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) {
      return "";
    }
    return normalized;
  }
}

function normalizeWebsiteList(value: unknown) {
  const raw = String(value ?? "");
  const parts = raw
    .split(/[\n,\t ;]+/)
    .map((entry) => normalizeWebsiteToken(entry))
    .filter(Boolean);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const domain of parts) {
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
    if (out.length >= 40) break;
  }
  return out;
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "FactoryLookalikeSeedBot/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) {
      return "";
    }
    return (await response.text()).slice(0, 180000);
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSiteContext(domain: string): Promise<SiteContext | null> {
  const urls = [`https://${domain}`, `http://${domain}`];

  for (const url of urls) {
    const html = await fetchHtml(url);
    if (!html) continue;

    const title = clipText(extractMeta(html, "og:title") || extractTitle(html), 180);
    const description = clipText(
      extractMeta(html, "og:description") || extractMeta(html, "description"),
      260
    );
    const pageExcerpt = clipText(stripHtml(html), 3200);
    if (!title && !description && !pageExcerpt) {
      continue;
    }

    return {
      domain,
      title,
      description,
      pageExcerpt,
      fetchedUrl: url,
    };
  }

  return null;
}

function buildHeuristicResult(input: {
  domains: string[];
  brand: Awaited<ReturnType<typeof getBrandById>>;
  currentPrompt: string;
  analyzedCount: number;
}) {
  const domains = input.domains.slice(0, 4);
  const product = clipText(input.brand?.product, 80);
  const buyer = clipText(input.brand?.idealCustomerProfiles?.[0], 44);
  const market = clipText(input.brand?.targetMarkets?.[0], 36);
  const generatedPrompt = clipText(
    input.currentPrompt ||
      [
        "Find",
        buyer || "decision-makers",
        "at companies similar to",
        domains.join(", "),
        product ? `that could use ${product}` : "",
      ]
        .join(" ")
        .replace(/\s+,/g, ","),
    220
  );

  const summaryTags = [
    market,
    buyer,
    product,
    "Customer seed",
  ].filter(Boolean);

  return {
    generatedPrompt,
    summaryTags: normalizeStringArray(summaryTags, 4),
    analyzedCount: input.analyzedCount,
    mode: "heuristic" as const,
  };
}

async function generateAiSeed(input: {
  brand: NonNullable<Awaited<ReturnType<typeof getBrandById>>>;
  currentPrompt: string;
  domains: string[];
  siteContexts: SiteContext[];
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !input.siteContexts.length) {
    return null;
  }

  const prompt = [
    "Turn a customer website seed list into a clean lead-search prompt for a B2B prospecting UI.",
    "Return strict JSON only as:",
    '{ "generatedPrompt": string, "summaryTags": string[] }',
    "",
    "Rules:",
    "- generatedPrompt must be one sentence, plain English, and under 220 characters.",
    "- Describe the shared company pattern first, then the people to find inside those companies.",
    "- Keep it specific, concrete, and usable in a people-search box.",
    "- If brand context is present, bias toward people likely to buy that brand's product.",
    "- summaryTags must be 3 to 5 short tags, each 1 to 4 words.",
    "- Do not mention AI, embeddings, clustering, uploads, CSVs, or internal tooling.",
    "- Avoid generic phrases like ideal customer profile, persona, leverage, enablement, optimize, or stakeholders.",
    "",
    `BrandContext: ${JSON.stringify({
      name: input.brand.name,
      website: input.brand.website,
      product: input.brand.product,
      tone: input.brand.tone,
      targetMarkets: input.brand.targetMarkets,
      buyers: input.brand.idealCustomerProfiles,
      keyBenefits: input.brand.keyBenefits,
    })}`,
    `CurrentPrompt: ${JSON.stringify(input.currentPrompt)}`,
    `SeedDomains: ${JSON.stringify(input.domains)}`,
    `SiteContexts: ${JSON.stringify(
      input.siteContexts.map((site) => ({
        domain: site.domain,
        title: site.title,
        description: site.description,
        pageExcerpt: site.pageExcerpt,
      }))
    )}`,
  ].join("\n");

  const model = resolveLlmModel("intake_prefill", { prompt });
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
    return null;
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

  const record = asRecord(parsed);
  const generatedPrompt = clipText(record.generatedPrompt, 220);
  const summaryTags = normalizeStringArray(record.summaryTags, 5);
  if (!generatedPrompt || summaryTags.length < 2) {
    return null;
  }

  return {
    generatedPrompt,
    summaryTags,
    analyzedCount: input.siteContexts.length,
    mode: "openai" as const,
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
    const websitesText = clipText(body.websitesText ?? body.websites ?? body.customerWebsites, 12000);
    const currentPrompt = clipText(body.currentPrompt, 320);
    const domains = normalizeWebsiteList(websitesText);

    if (domains.length < 3) {
      return NextResponse.json(
        {
          error: "Paste at least 3 customer websites.",
          hint: "Use one domain per line, like stripe.com or ramp.com.",
        },
        { status: 400 }
      );
    }

    const sampledDomains = domains.slice(0, 6);
    const siteContexts = (
      await Promise.all(sampledDomains.map((domain) => fetchSiteContext(domain)))
    ).filter((entry): entry is SiteContext => Boolean(entry));

    const aiResult = await generateAiSeed({
      brand,
      currentPrompt,
      domains,
      siteContexts,
    });
    const fallback = buildHeuristicResult({
      domains,
      brand,
      currentPrompt,
      analyzedCount: siteContexts.length,
    });
    const result = aiResult ?? fallback;

    return NextResponse.json({
      sourceCount: domains.length,
      analyzedCount: result.analyzedCount,
      generatedPrompt: result.generatedPrompt,
      summaryTags: result.summaryTags,
      mode: result.mode,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to analyze customer websites.",
        hint: "Try again in a moment.",
        debug: { reason: error instanceof Error ? error.message : "Unknown error" },
      },
      { status: 500 }
    );
  }
}
