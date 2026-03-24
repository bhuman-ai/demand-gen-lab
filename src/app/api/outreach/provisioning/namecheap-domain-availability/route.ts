import { NextRequest, NextResponse } from "next/server";
import { OutreachDataError } from "@/lib/outreach-data";
import { getOutreachProvisioningSettings } from "@/lib/outreach-provider-settings";
import { checkSavedNamecheapDomainAvailability } from "@/lib/outreach-provisioning";

function normalizeDomains(input: unknown) {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter((value) => value && value.includes("."))
    )
  ).slice(0, 50);
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const domains = normalizeDomains(
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { domains?: unknown }).domains
        : []
    );

    const settings = await getOutreachProvisioningSettings();
    const configured = Boolean(
      settings.namecheap.apiUser.trim() && settings.namecheap.hasApiKey && settings.namecheap.clientIp.trim()
    );

    if (!configured) {
      return NextResponse.json({
        configured: false,
        results: [],
      });
    }

    if (!domains.length) {
      return NextResponse.json({
        configured: true,
        results: [],
      });
    }

    const results = await checkSavedNamecheapDomainAvailability(domains);
    return NextResponse.json({
      configured: true,
      results,
    });
  } catch (error) {
    if (error instanceof OutreachDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to check domain availability";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
