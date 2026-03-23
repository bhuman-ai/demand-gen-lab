import { NextResponse } from "next/server";
import { OutreachDataError } from "@/lib/outreach-data";
import {
  getOutreachProvisioningSettings,
  updateOutreachProvisioningSettings,
} from "@/lib/outreach-provider-settings";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function GET() {
  try {
    const settings = await getOutreachProvisioningSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof OutreachDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to load provisioning settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = asRecord(await request.json());
    const customerIo = asRecord(body.customerIo);
    const namecheap = asRecord(body.namecheap);
    const mailpool = asRecord(body.mailpool);
    const deliverability = asRecord(body.deliverability);
    const settings = await updateOutreachProvisioningSettings({
      customerIo: {
        siteId: customerIo.siteId !== undefined ? String(customerIo.siteId ?? "") : undefined,
        trackingApiKey:
          customerIo.trackingApiKey !== undefined ? String(customerIo.trackingApiKey ?? "") : undefined,
        appApiKey: customerIo.appApiKey !== undefined ? String(customerIo.appApiKey ?? "") : undefined,
      },
      namecheap: {
        apiUser: namecheap.apiUser !== undefined ? String(namecheap.apiUser ?? "") : undefined,
        userName: namecheap.userName !== undefined ? String(namecheap.userName ?? "") : undefined,
        clientIp: namecheap.clientIp !== undefined ? String(namecheap.clientIp ?? "") : undefined,
        apiKey: namecheap.apiKey !== undefined ? String(namecheap.apiKey ?? "") : undefined,
      },
      mailpool: {
        apiKey: mailpool.apiKey !== undefined ? String(mailpool.apiKey ?? "") : undefined,
        webhookSecret:
          mailpool.webhookSecret !== undefined ? String(mailpool.webhookSecret ?? "") : undefined,
        webhookUrl: mailpool.webhookUrl !== undefined ? String(mailpool.webhookUrl ?? "") : undefined,
      },
      deliverability: {
        provider:
          deliverability.provider !== undefined
            ? (String(deliverability.provider ?? "") as "none" | "google_postmaster" | "mailpool")
            : undefined,
        monitoredDomains: Array.isArray(deliverability.monitoredDomains)
          ? deliverability.monitoredDomains.map((entry) => String(entry ?? ""))
          : undefined,
        mailpoolInboxProviders: Array.isArray(deliverability.mailpoolInboxProviders)
          ? deliverability.mailpoolInboxProviders.map((entry) => String(entry ?? "")) as Array<
              | "GoogleWorkspace"
              | "Gmail"
              | "Outlook"
              | "M365Outlook"
              | "Yahoo"
              | "Aol"
              | "SMTP"
              | "Hotmail"
            >
          : undefined,
        googleClientId:
          deliverability.googleClientId !== undefined ? String(deliverability.googleClientId ?? "") : undefined,
        googleClientSecret:
          deliverability.googleClientSecret !== undefined
            ? String(deliverability.googleClientSecret ?? "")
            : undefined,
        googleRefreshToken:
          deliverability.googleRefreshToken !== undefined
            ? String(deliverability.googleRefreshToken ?? "")
            : undefined,
      },
    });
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof OutreachDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to save provisioning settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
