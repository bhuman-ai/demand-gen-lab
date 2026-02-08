import { NextResponse } from "next/server";

const APIFY_STORE_BASE = "https://api.apify.com/v2/store";
const ALLOWED_PRICING = new Set(["PAY_PER_EVENT", "PRICE_PER_DATASET_ITEM", "FREE"]);

async function hasReadme(username?: string, name?: string) {
  if (!username || !name) return false;
  const url = `https://apify.com/${username}/${name}.md`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return false;
  const text = await response.text();
  return text.trim().length > 200;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = String(searchParams.get("search") ?? "").trim();
  const token = process.env.APIFY_TOKEN;

  if (!query) {
    return NextResponse.json({ error: "search is required" }, { status: 400 });
  }

  const url = new URL(APIFY_STORE_BASE);
  url.searchParams.set("search", query);
  url.searchParams.set("limit", "50");
  url.searchParams.set("sortBy", "popularity");

  const response = await fetch(url.toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json({ error: "Apify search failed", details: errorText }, { status: 500 });
  }

  const data = await response.json();
  const items = Array.isArray(data?.data?.items) ? data.data.items : [];
  const filtered = [] as any[];

  for (const item of items) {
    const pricing = item?.currentPricingInfo?.pricingModel;
    const rating = item?.stats?.rating ?? 0;
    if (!ALLOWED_PRICING.has(pricing)) continue;
    if (rating < 4) continue;
    if (!(await hasReadme(item?.username, item?.name))) continue;
    filtered.push(item);
    if (filtered.length >= 20) break;
  }

  return NextResponse.json({ items: filtered });
}
