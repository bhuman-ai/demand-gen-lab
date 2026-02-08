import { NextResponse } from "next/server";

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

    return NextResponse.json({
      prefill: {
        brandName,
        tone: "Confident, technical, minimal",
        targetBuyers: "",
        offers: "",
        proof: description || "",
      },
      signals: {
        title,
        description,
        hostname,
      },
    });
  } catch {
    return NextResponse.json({ error: "prefill failed" }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
