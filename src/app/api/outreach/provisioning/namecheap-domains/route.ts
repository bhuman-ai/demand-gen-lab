import { NextResponse } from "next/server";
import { OutreachDataError } from "@/lib/outreach-data";
import { getOutreachProvisioningSettings } from "@/lib/outreach-provider-settings";
import { listSavedNamecheapDomains } from "@/lib/outreach-provisioning";

export async function GET() {
  try {
    const settings = await getOutreachProvisioningSettings();
    const configured = Boolean(
      settings.namecheap.apiUser.trim() && settings.namecheap.hasApiKey && settings.namecheap.clientIp.trim()
    );

    if (!configured) {
      return NextResponse.json({
        configured: false,
        domains: [],
      });
    }

    const domains = await listSavedNamecheapDomains();
    return NextResponse.json({
      configured: true,
      domains,
    });
  } catch (error) {
    if (error instanceof OutreachDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load Namecheap domains";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
