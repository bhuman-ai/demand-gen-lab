import { NextResponse } from "next/server";
import { OutreachDataError } from "@/lib/outreach-data";
import { getOutreachProvisioningSettings } from "@/lib/outreach-provider-settings";
import { listSavedMailpoolDomains } from "@/lib/outreach-provisioning";

export async function GET() {
  try {
    const settings = await getOutreachProvisioningSettings();
    const configured = Boolean(settings.mailpool.hasApiKey);

    if (!configured) {
      return NextResponse.json({
        configured: false,
        domains: [],
      });
    }

    const domains = await listSavedMailpoolDomains();
    return NextResponse.json({
      configured: true,
      domains,
    });
  } catch (error) {
    if (error instanceof OutreachDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load Mailpool domains";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
