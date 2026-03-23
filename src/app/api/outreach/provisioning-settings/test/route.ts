import { NextResponse } from "next/server";
import { OutreachDataError } from "@/lib/outreach-data";
import {
  getOutreachProvisioningSettings,
  getOutreachProvisioningSettingsSecrets,
  updateOutreachProvisioningSettings,
} from "@/lib/outreach-provider-settings";
import {
  testMailpoolProvisioningConnection,
  testCustomerIoProvisioningConnection,
  testNamecheapProvisioningConnection,
  type ProvisioningProviderTestResult,
} from "@/lib/outreach-provisioning";
import { testGooglePostmasterDeliverabilityConnection } from "@/lib/outreach-deliverability";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function providerSelection(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "customerio" ||
    normalized === "namecheap" ||
    normalized === "mailpool" ||
    normalized === "deliverability"
  ) {
    return normalized;
  }
  return "all";
}

function failureResult(
  provider: "customerio" | "namecheap" | "mailpool" | "deliverability",
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

    const tests: Partial<
      Record<"customerIo" | "namecheap" | "mailpool" | "deliverability", ProvisioningProviderTestResult>
    > = {};
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

    if (provider === "mailpool" || provider === "all") {
      try {
        tests.mailpool = secrets.mailpoolApiKey.trim()
          ? await testMailpoolProvisioningConnection({
              apiKey: secrets.mailpoolApiKey,
            })
          : failureResult(
              "mailpool",
              "Saved Mailpool defaults are incomplete. Add an API key first."
            );
      } catch (error) {
        tests.mailpool = failureResult(
          "mailpool",
          error instanceof Error ? error.message : "Mailpool connection test failed"
        );
      }
    }

    if (provider === "deliverability" || provider === "all") {
      try {
        tests.deliverability =
          settings.deliverability.provider === "mailpool"
            ? secrets.mailpoolApiKey.trim()
              ? {
                  provider: "deliverability" as const,
                  ok: true,
                  message: "Deliverability is configured to use Mailpool.",
                  details: {
                    provider: "mailpool",
                    inboxProviders: settings.deliverability.mailpoolInboxProviders,
                  },
                }
              : failureResult(
                  "deliverability",
                  "Mailpool deliverability is selected, but the saved Mailpool API key is missing."
                )
            : settings.deliverability.provider === "google_postmaster" &&
                settings.deliverability.monitoredDomains.length > 0 &&
                secrets.deliverabilityGoogleClientId.trim() &&
                secrets.deliverabilityGoogleClientSecret.trim() &&
                secrets.deliverabilityGoogleRefreshToken.trim()
            ? await testGooglePostmasterDeliverabilityConnection({
                clientId: secrets.deliverabilityGoogleClientId,
                clientSecret: secrets.deliverabilityGoogleClientSecret,
                refreshToken: secrets.deliverabilityGoogleRefreshToken,
                domains: settings.deliverability.monitoredDomains,
              })
            : failureResult(
                "deliverability",
                "Saved deliverability defaults are incomplete. Add monitored domains plus Google Postmaster OAuth credentials first."
              );
      } catch (error) {
        tests.deliverability = failureResult(
          "deliverability",
          error instanceof Error ? error.message : "Deliverability connection test failed"
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
      mailpool: tests.mailpool
        ? {
            lastValidatedAt: now,
            lastValidatedStatus: tests.mailpool.ok ? "pass" : "fail",
            lastValidationMessage: tests.mailpool.message,
          }
        : undefined,
      deliverability: tests.deliverability
        ? {
            lastValidatedAt: now,
            lastValidatedStatus: tests.deliverability.ok ? "pass" : "fail",
            lastValidationMessage: tests.deliverability.message,
            lastCheckedAt:
              typeof tests.deliverability.details.checkedAt === "string"
                ? (tests.deliverability.details.checkedAt as string)
                : settings.deliverability.lastCheckedAt,
            lastHealthStatus:
              typeof tests.deliverability.details.overallStatus === "string"
                ? (tests.deliverability.details.overallStatus as "unknown" | "healthy" | "warning" | "critical")
                : settings.deliverability.lastHealthStatus,
            lastHealthScore:
              typeof tests.deliverability.details.overallScore === "number"
                ? (tests.deliverability.details.overallScore as number)
                : settings.deliverability.lastHealthScore,
            lastHealthSummary:
              typeof tests.deliverability.details.summary === "string"
                ? (tests.deliverability.details.summary as string)
                : settings.deliverability.lastHealthSummary,
            lastDomainSnapshots: Array.isArray(tests.deliverability.details.domainSnapshots)
              ? tests.deliverability.details.domainSnapshots
              : settings.deliverability.lastDomainSnapshots,
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
