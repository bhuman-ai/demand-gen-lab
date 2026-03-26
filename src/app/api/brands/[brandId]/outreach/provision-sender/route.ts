import { NextResponse } from "next/server";
import { OutreachDataError } from "@/lib/outreach-data";
import { provisionSender } from "@/lib/outreach-provisioning";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(
  request: Request,
  context: { params: Promise<{ brandId: string }> }
) {
  try {
    const { brandId } = await context.params;
    const body = asRecord(await request.json());
    const registrant = asRecord(body.registrant);
    const normalizedDomainMode = String(body.domainMode ?? "").toLowerCase().trim();
    const domainMode =
      normalizedDomainMode === "register"
        ? "register"
        : normalizedDomainMode === "transfer"
          ? "transfer"
          : "existing";

    const result = await provisionSender({
      brandId,
      provider: String(body.provider ?? "").trim().toLowerCase() === "mailpool" ? "mailpool" : "customerio",
      accountName: String(body.accountName ?? ""),
      assignToBrand: body.assignToBrand !== false,
      selectedMailboxAccountId: String(body.selectedMailboxAccountId ?? ""),
      domainMode,
      domain: String(body.domain ?? ""),
      fromLocalPart: String(body.fromLocalPart ?? ""),
      autoPickCustomerIoAccount: body.autoPickCustomerIoAccount !== false,
      customerIoSourceAccountId: String(body.customerIoSourceAccountId ?? ""),
      forwardingTargetUrl: String(body.forwardingTargetUrl ?? ""),
      customerIoSiteId: String(body.customerIoSiteId ?? ""),
      customerIoTrackingApiKey: String(body.customerIoTrackingApiKey ?? ""),
      customerIoAppApiKey: String(body.customerIoAppApiKey ?? ""),
      mailpoolApiKey: String(body.mailpoolApiKey ?? ""),
      namecheapApiUser: String(body.namecheapApiUser ?? ""),
      namecheapUserName: String(body.namecheapUserName ?? ""),
      namecheapApiKey: String(body.namecheapApiKey ?? ""),
      namecheapClientIp: String(body.namecheapClientIp ?? ""),
      registrant:
        Object.keys(registrant).length > 0
          ? {
              firstName: String(registrant.firstName ?? ""),
              lastName: String(registrant.lastName ?? ""),
              organizationName: String(registrant.organizationName ?? ""),
              emailAddress: String(registrant.emailAddress ?? ""),
              phone: String(registrant.phone ?? ""),
              address1: String(registrant.address1 ?? ""),
              city: String(registrant.city ?? ""),
              stateProvince: String(registrant.stateProvince ?? ""),
              postalCode: String(registrant.postalCode ?? ""),
              country: String(registrant.country ?? ""),
            }
          : undefined,
    });

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof OutreachDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Sender provisioning failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
