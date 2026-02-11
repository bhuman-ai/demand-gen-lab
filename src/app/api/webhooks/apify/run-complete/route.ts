import { NextResponse } from "next/server";
import { ingestApifyRunComplete } from "@/lib/outreach-runtime";
import type { ApifyLead } from "@/lib/outreach-providers";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeLeads(value: unknown): ApifyLead[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = asRecord(entry);
      const email = String(row.email ?? row.workEmail ?? row.businessEmail ?? "")
        .trim()
        .toLowerCase();
      if (!email) return null;
      return {
        email,
        name: String(row.name ?? row.fullName ?? "").trim(),
        company: String(row.company ?? row.companyName ?? "").trim(),
        title: String(row.title ?? row.jobTitle ?? "").trim(),
        domain: String(row.domain ?? "").trim(),
        sourceUrl: String(row.url ?? row.profileUrl ?? "").trim(),
      };
    })
    .filter((row): row is ApifyLead => Boolean(row));
}

function validWebhookSecret(request: Request) {
  const expected = process.env.APIFY_WEBHOOK_SECRET;
  if (!expected) return true;
  const provided = request.headers.get("x-webhook-secret") ?? "";
  return provided === expected;
}

export async function POST(request: Request) {
  if (!validWebhookSecret(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = asRecord(await request.json());
  const resource = asRecord(body.resource);
  const runId = String(body.runId ?? body.run_id ?? resource.runId ?? "").trim();
  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  const leads = normalizeLeads(body.leads ?? body.items ?? body.datasetItems ?? []);
  const result = await ingestApifyRunComplete({ runId, leads });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ ok: true, count: leads.length });
}
