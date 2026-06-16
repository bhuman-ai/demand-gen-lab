import { NextResponse } from "next/server";
import { isInternalCronAuthorized } from "@/lib/internal-cron";
import { setSavedNamecheapCustomNameservers } from "@/lib/outreach-provisioning";

function normalizeNameservers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "").trim().toLowerCase()).filter(Boolean);
}

function normalizeDomains(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "").trim().toLowerCase()).filter(Boolean);
}

export async function POST(request: Request) {
  if (!isInternalCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const domains = normalizeDomains(body.domains);
  const nameservers = normalizeNameservers(body.nameservers);

  if (!domains.length) {
    return NextResponse.json({ error: "domains are required" }, { status: 400 });
  }
  if (!nameservers.length) {
    return NextResponse.json({ error: "nameservers are required" }, { status: 400 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const domain of domains) {
    try {
      const result = await setSavedNamecheapCustomNameservers({ domain, nameservers });
      results.push({ ok: true, ...result });
    } catch (error) {
      results.push({
        ok: false,
        domain,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    ok: results.every((item) => item.ok !== false),
    nameservers,
    results,
  });
}
