import { NextResponse } from "next/server";
import { OutreachDataError } from "@/lib/outreach-data";
import {
  getOutreachProvisioningSettings,
  getOutreachProvisioningSettingsSecrets,
  updateOutreachProvisioningSettings,
} from "@/lib/outreach-provider-settings";
import {
  testCustomerIoProvisioningConnection,
  testNamecheapProvisioningConnection,
  type ProvisioningProviderTestResult,
} from "@/lib/outreach-provisioning";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function providerSelection(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "customerio" || normalized === "namecheap") return normalized;
  return "all";
}

function failureResult(
  provider: "customerio" | "namecheap",
  message: string,
  details: Record<string, unknown> = {}
): ProvisioningProviderTestResult {
  return {
    provider,
    ok: false,
    message,
    details,
  };
}

export async function POST(request: Request) {
  try {
    const body = asRecord(await request.json().catch(() => ({})));
    const provider = providerSelection(body.provider);
    const [settings, secrets] = await Promise.all([
      getOutreachProvisioningSettings(),
      getOutreachProvisioningSettingsSecrets(),
    ]);

    const tests: Partial<Record<"customerIo" | "namecheap", ProvisioningProviderTestResult>> = {};
    const now = new Date().toISOString();

    if (provider === "customerio" || provider === "all") {
      try {
        tests.customerIo =
          settings.customerIo.siteId.trim() && secrets.customerIoTrackingApiKey.trim()
            ? await testCustomerIoProvisioningConnection({
                siteId: settings.customerIo.siteId,
                trackingApiKey: secrets.customerIoTrackingApiKey,
                appApiKey: secrets.customerIoAppApiKey,
              })
            : failureResult(
                "customerio",
                "Saved Customer.io defaults are incomplete. Add a Site ID and Tracking API key first."
              );
      } catch (error) {
        tests.customerIo = failureResult(
          "customerio",
          error instanceof Error ? error.message : "Customer.io connection test failed"
        );
      }
    }

    if (provider === "namecheap" || provider === "all") {
      try {
        tests.namecheap =
          settings.namecheap.apiUser.trim() &&
          settings.namecheap.clientIp.trim() &&
          secrets.namecheapApiKey.trim()
            ? await testNamecheapProvisioningConnection({
                apiUser: settings.namecheap.apiUser,
                userName: settings.namecheap.userName,
                apiKey: secrets.namecheapApiKey,
                clientIp: settings.namecheap.clientIp,
              })
            : failureResult(
                "namecheap",
                "Saved Namecheap defaults are incomplete. Add an API user, API key, and whitelisted client IP first."
              );
      } catch (error) {
        tests.namecheap = failureResult(
          "namecheap",
          error instanceof Error ? error.message : "Namecheap connection test failed"
        );
      }
    }

    const updatedSettings = await updateOutreachProvisioningSettings({
      customerIo: tests.customerIo
        ? {
            workspaceRegion:
              tests.customerIo.ok && typeof tests.customerIo.details.region === "string"
                ? ((tests.customerIo.details.region as string) === "eu" ? "eu" : "us")
                : settings.customerIo.workspaceRegion,
            lastValidatedAt: now,
            lastValidatedStatus: tests.customerIo.ok ? "pass" : "fail",
            lastValidationMessage: tests.customerIo.message,
          }
        : undefined,
      namecheap: tests.namecheap
        ? {
            lastValidatedAt: now,
            lastValidatedStatus: tests.namecheap.ok ? "pass" : "fail",
            lastValidationMessage: tests.namecheap.message,
          }
        : undefined,
    });

    return NextResponse.json({ settings: updatedSettings, tests });
  } catch (error) {
    if (error instanceof OutreachDataError) {
      return NextResponse.json({ error: error.message, hint: error.hint, debug: error.debug }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to test provisioning settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
