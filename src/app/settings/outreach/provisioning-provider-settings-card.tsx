"use client";

import { useEffect, useState, type ComponentType } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Link2,
  Send,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DEFAULT_MAILPOOL_INBOX_PROVIDERS } from "@/lib/outreach-account-helpers";
import {
  testOutreachProvisioningSettings,
  updateOutreachProvisioningSettingsApi,
} from "@/lib/client-api";
import type { OutreachProvisioningSettings } from "@/lib/factory-types";
import { FieldLabel, SettingsModal, formatRelativeTimeLabel } from "./settings-primitives";

type ProviderKey = "customerio" | "namecheap" | "mailpool" | "deliverability";

type ProviderSettingsFormState = {
  customerIoSiteId: string;
  customerIoTrackingApiKey: string;
  customerIoAppApiKey: string;
  namecheapApiUser: string;
  namecheapUserName: string;
  namecheapApiKey: string;
  namecheapClientIp: string;
  mailpoolApiKey: string;
  mailpoolWebhookSecret: string;
  mailpoolWebhookUrl: string;
  deliverabilityProvider: "none" | "google_postmaster" | "mailpool";
  deliverabilityDomains: string;
  deliverabilityGoogleClientId: string;
  deliverabilityGoogleClientSecret: string;
  deliverabilityGoogleRefreshToken: string;
};

const INITIAL_FORM: ProviderSettingsFormState = {
  customerIoSiteId: "",
  customerIoTrackingApiKey: "",
  customerIoAppApiKey: "",
  namecheapApiUser: "",
  namecheapUserName: "",
  namecheapApiKey: "",
  namecheapClientIp: "",
  mailpoolApiKey: "",
  mailpoolWebhookSecret: "",
  mailpoolWebhookUrl: "",
  deliverabilityProvider: "none",
  deliverabilityDomains: "",
  deliverabilityGoogleClientId: "",
  deliverabilityGoogleClientSecret: "",
  deliverabilityGoogleRefreshToken: "",
};

const CUSTOMER_IO_HELP_URL = "https://docs.customer.io/journeys/api-credentials/";
const NAMECHEAP_HELP_URL = "https://www.namecheap.com/support/knowledgebase/article.aspx/9739/63/api-faq/";
const MAILPOOL_HELP_URL = "https://mailpool.stoplight.io/docs/mailpool/yt6li83uogjyz-mailpool-api";
const DELIVERABILITY_HELP_URL = "https://developers.google.com/workspace/gmail/postmaster/quickstart";

function connectionMeta(
  configured: boolean,
  validationStatus: OutreachProvisioningSettings["customerIo"]["lastValidatedStatus"]
) {
  if (!configured) {
    return {
      badge: <Badge variant="muted">Not connected</Badge>,
    };
  }
  if (validationStatus === "pass") {
    return {
      badge: <Badge variant="success">Connected</Badge>,
    };
  }
  if (validationStatus === "fail") {
    return {
      badge: <Badge variant="danger">Needs attention</Badge>,
    };
  }
  return {
    badge: <Badge variant="accent">Saved</Badge>,
  };
}

function ConnectionCard({
  title,
  description,
  icon: Icon,
  configured,
  validationStatus,
  summary,
  highlights,
  lastChecked,
  onOpen,
  onValidate,
  validating,
}: {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  configured: boolean;
  validationStatus: OutreachProvisioningSettings["customerIo"]["lastValidatedStatus"];
  summary: string;
  highlights: string[];
  lastChecked: string;
  onOpen: () => void;
  onValidate: () => void;
  validating: boolean;
}) {
  const meta = connectionMeta(configured, validationStatus);

  return (
    <Card className="h-full">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-[color:var(--muted-foreground)]" />
              <CardTitle className="text-base">{title}</CardTitle>
              {meta.badge}
            </div>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-0">
        <div className="text-sm leading-6">{summary}</div>
        {highlights.length ? (
          <div className="flex flex-wrap gap-2">
            {highlights.map((detail) => (
              <Badge key={detail} variant="muted">
                {detail}
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="text-[color:var(--muted-foreground)]">Last checked {lastChecked}</div>
          <div className="flex flex-wrap gap-2">
            {configured ? (
              <Button type="button" variant="outline" size="sm" onClick={onValidate} disabled={validating}>
                {validating ? "Testing..." : "Test connection"}
              </Button>
            ) : null}
            <Button type="button" variant={configured ? "outline" : "default"} size="sm" onClick={onOpen}>
              {configured ? (
                <>
                  <Settings2 className="h-4 w-4" />
                  Edit setup
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4" />
                  Set up
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProvisioningProviderSettingsCard({
  settings,
  onSaved,
}: {
  settings: OutreachProvisioningSettings;
  onSaved: (settings: OutreachProvisioningSettings) => void;
}) {
  const [form, setForm] = useState<ProviderSettingsFormState>(INITIAL_FORM);
  const [activeModal, setActiveModal] = useState<ProviderKey | null>(null);
  const [savingProvider, setSavingProvider] = useState<"" | ProviderKey>("");
  const [testingProvider, setTestingProvider] = useState<"" | ProviderKey>("");
  const [showCustomerIoSecrets, setShowCustomerIoSecrets] = useState(false);
  const [showNamecheapSecrets, setShowNamecheapSecrets] = useState(false);
  const [showMailpoolSecrets, setShowMailpoolSecrets] = useState(false);
  const [showDeliverabilitySecrets, setShowDeliverabilitySecrets] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const customerIoConfigured = Boolean(settings.customerIo.siteId.trim() && settings.customerIo.hasTrackingApiKey);
  const namecheapConfigured = Boolean(
    settings.namecheap.apiUser.trim() && settings.namecheap.clientIp.trim() && settings.namecheap.hasApiKey
  );
  const mailpoolConfigured = Boolean(settings.mailpool.hasApiKey);
  const deliverabilityConfigured =
    settings.deliverability.provider === "mailpool"
      ? mailpoolConfigured
      : settings.deliverability.provider === "google_postmaster" &&
        settings.deliverability.monitoredDomains.length > 0 &&
        settings.deliverability.hasGoogleClientId &&
        settings.deliverability.hasGoogleClientSecret &&
        settings.deliverability.hasGoogleRefreshToken;

  function resetFormFromSettings() {
    setForm({
      customerIoSiteId: settings.customerIo.siteId,
      customerIoTrackingApiKey: "",
      customerIoAppApiKey: "",
      namecheapApiUser: settings.namecheap.apiUser,
      namecheapUserName: settings.namecheap.userName,
      namecheapApiKey: "",
      namecheapClientIp: settings.namecheap.clientIp,
      mailpoolApiKey: "",
      mailpoolWebhookSecret: "",
      mailpoolWebhookUrl: settings.mailpool.webhookUrl,
      deliverabilityProvider: settings.deliverability.provider,
      deliverabilityDomains: settings.deliverability.monitoredDomains.join(", "),
      deliverabilityGoogleClientId: "",
      deliverabilityGoogleClientSecret: "",
      deliverabilityGoogleRefreshToken: "",
    });
  }

  useEffect(() => {
    setForm({
      customerIoSiteId: settings.customerIo.siteId,
      customerIoTrackingApiKey: "",
      customerIoAppApiKey: "",
      namecheapApiUser: settings.namecheap.apiUser,
      namecheapUserName: settings.namecheap.userName,
      namecheapApiKey: "",
      namecheapClientIp: settings.namecheap.clientIp,
      mailpoolApiKey: "",
      mailpoolWebhookSecret: "",
      mailpoolWebhookUrl: settings.mailpool.webhookUrl,
      deliverabilityProvider: settings.deliverability.provider,
      deliverabilityDomains: settings.deliverability.monitoredDomains.join(", "),
      deliverabilityGoogleClientId: "",
      deliverabilityGoogleClientSecret: "",
      deliverabilityGoogleRefreshToken: "",
    });
  }, [
    settings.customerIo.siteId,
    settings.deliverability.monitoredDomains,
    settings.deliverability.provider,
    settings.mailpool.webhookUrl,
    settings.namecheap.apiUser,
    settings.namecheap.clientIp,
    settings.namecheap.userName,
  ]);

  async function saveProvider(provider: ProviderKey, validateAfterSave = false) {
    setError("");
    setNotice("");

    try {
      setSavingProvider(provider);
      const next =
        provider === "customerio"
          ? await updateOutreachProvisioningSettingsApi({
              customerIo: {
                siteId: form.customerIoSiteId.trim(),
                trackingApiKey: form.customerIoTrackingApiKey.trim(),
                appApiKey: form.customerIoAppApiKey.trim(),
              },
            })
          : provider === "namecheap"
            ? await updateOutreachProvisioningSettingsApi({
                namecheap: {
                  apiUser: form.namecheapApiUser.trim(),
                  userName: form.namecheapUserName.trim(),
                  clientIp: form.namecheapClientIp.trim(),
                  apiKey: form.namecheapApiKey.trim(),
                },
              })
            : provider === "mailpool"
              ? await updateOutreachProvisioningSettingsApi({
                  mailpool: {
                    apiKey: form.mailpoolApiKey.trim(),
                    webhookSecret: form.mailpoolWebhookSecret.trim(),
                    webhookUrl: form.mailpoolWebhookUrl.trim(),
                  },
                })
            : await updateOutreachProvisioningSettingsApi({
                deliverability: {
                  provider: form.deliverabilityProvider,
                  monitoredDomains: form.deliverabilityDomains
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                  mailpoolInboxProviders: settings.deliverability.mailpoolInboxProviders.length
                    ? settings.deliverability.mailpoolInboxProviders
                    : [...DEFAULT_MAILPOOL_INBOX_PROVIDERS],
                  googleClientId: form.deliverabilityGoogleClientId.trim(),
                  googleClientSecret: form.deliverabilityGoogleClientSecret.trim(),
                  googleRefreshToken: form.deliverabilityGoogleRefreshToken.trim(),
                },
              });

      onSaved(next);
      setForm((prev) => ({
        ...prev,
        customerIoTrackingApiKey: "",
        customerIoAppApiKey: "",
        namecheapApiKey: "",
        mailpoolApiKey: "",
        mailpoolWebhookSecret: "",
        deliverabilityGoogleClientId: "",
        deliverabilityGoogleClientSecret: "",
        deliverabilityGoogleRefreshToken: "",
      }));

      if (!validateAfterSave) {
        setNotice(
          provider === "customerio"
            ? "Customer.io connection saved."
            : provider === "namecheap"
              ? "Namecheap connection saved."
              : provider === "mailpool"
                ? "Mailpool connection saved."
              : "Deliverability connection saved."
        );
        setActiveModal(null);
        return;
      }

      setTestingProvider(provider);
      const result = await testOutreachProvisioningSettings(provider);
      onSaved(result.settings);
      const message =
        provider === "customerio"
          ? result.tests.customerIo?.message || "Customer.io connection checked."
          : provider === "namecheap"
            ? result.tests.namecheap?.message || "Namecheap connection checked."
            : provider === "mailpool"
              ? result.tests.mailpool?.message || "Mailpool connection checked."
            : result.tests.deliverability?.message || "Deliverability connection checked.";
      setNotice(message);
      setActiveModal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save connection");
    } finally {
      setSavingProvider("");
      setTestingProvider("");
    }
  }

  async function validateSavedProvider(provider: ProviderKey) {
    setError("");
    setNotice("");
    try {
      setTestingProvider(provider);
      const result = await testOutreachProvisioningSettings(provider);
      onSaved(result.settings);
      const message =
        provider === "customerio"
          ? result.tests.customerIo?.message || "Customer.io connection checked."
          : provider === "namecheap"
            ? result.tests.namecheap?.message || "Namecheap connection checked."
            : provider === "mailpool"
              ? result.tests.mailpool?.message || "Mailpool connection checked."
            : result.tests.deliverability?.message || "Deliverability connection checked.";
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setTestingProvider("");
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Core connections</CardTitle>
          <CardDescription>Connect the tools that power sending, domains, and sender health.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-0 md:grid-cols-4">
          <ConnectionCard
            title="Customer.io"
            description="Needed to create sender accounts and send mail."
            icon={Send}
            configured={customerIoConfigured}
            validationStatus={settings.customerIo.lastValidatedStatus}
            summary={
              customerIoConfigured
                ? `Ready. This workspace can create senders with Site ${settings.customerIo.siteId}.`
                : "Add your Site ID and tracking key to connect sending."
            }
            highlights={[
              settings.customerIo.hasTrackingApiKey ? "Tracking key saved" : "Tracking key needed",
              settings.customerIo.hasAppApiKey ? "App key saved" : "App key optional",
              `Region ${settings.customerIo.workspaceRegion.toUpperCase()}`,
            ]}
            lastChecked={formatRelativeTimeLabel(settings.customerIo.lastValidatedAt, "Not tested yet")}
            onOpen={() => {
              setError("");
              setNotice("");
              resetFormFromSettings();
              setActiveModal("customerio");
            }}
            onValidate={() => void validateSavedProvider("customerio")}
            validating={testingProvider === "customerio"}
          />

          <ConnectionCard
            title="Namecheap"
            description="Needed only if you want one-click domain setup."
            icon={Globe}
            configured={namecheapConfigured}
            validationStatus={settings.namecheap.lastValidatedStatus}
            summary={
              namecheapConfigured
                ? "Ready. The app can buy domains and update DNS for you."
                : "Add your Namecheap API details if you want the app to handle domains for you."
            }
            highlights={[
              settings.namecheap.apiUser ? `API user ${settings.namecheap.apiUser}` : "API user needed",
              settings.namecheap.hasApiKey ? "API key saved" : "API key needed",
              settings.namecheap.clientIp ? "Allowed IP saved" : "Allowed IP needed",
            ]}
            lastChecked={formatRelativeTimeLabel(settings.namecheap.lastValidatedAt, "Not tested yet")}
            onOpen={() => {
              setError("");
              setNotice("");
              resetFormFromSettings();
              setActiveModal("namecheap");
            }}
            onValidate={() => void validateSavedProvider("namecheap")}
            validating={testingProvider === "namecheap"}
          />

          <ConnectionCard
            title="Mailpool"
            description="Used for Google Workspace provisioning, SMTP sending, and Mailpool-backed deliverability."
            icon={Link2}
            configured={mailpoolConfigured}
            validationStatus={settings.mailpool.lastValidatedStatus}
            summary={
              mailpoolConfigured
                ? `Ready. Webhook target: ${settings.mailpool.webhookUrl || "not set"}.`
                : "Add the Mailpool API key and webhook secret to provision Google senders automatically."
            }
            highlights={[
              settings.mailpool.hasApiKey ? "API key saved" : "API key needed",
              settings.mailpool.hasWebhookSecret ? "Webhook secret saved" : "Webhook secret needed",
              settings.mailpool.webhookUrl ? "Webhook URL ready" : "Webhook URL missing",
            ]}
            lastChecked={formatRelativeTimeLabel(settings.mailpool.lastValidatedAt, "Not tested yet")}
            onOpen={() => {
              setError("");
              setNotice("");
              resetFormFromSettings();
              setActiveModal("mailpool");
            }}
            onValidate={() => void validateSavedProvider("mailpool")}
            validating={testingProvider === "mailpool"}
          />

          <ConnectionCard
            title="Deliverability"
            description="Choose Google Postmaster or Mailpool for sender health checks."
            icon={ShieldCheck}
            configured={deliverabilityConfigured}
            validationStatus={settings.deliverability.lastValidatedStatus}
            summary={
              settings.deliverability.provider === "mailpool"
                ? deliverabilityConfigured
                  ? `Ready. Mailpool deliverability will run placement checks using ${settings.deliverability.mailpoolInboxProviders.join(", ")}.`
                  : "Mailpool deliverability is selected, but the Mailpool connection still needs attention."
                : deliverabilityConfigured
                  ? `Ready. Watching ${settings.deliverability.monitoredDomains.join(", ")} for Gmail reputation changes.`
                  : "Connect this only if you want Gmail reputation data or Mailpool-backed inbox placement in the app."
            }
            highlights={[
              settings.deliverability.provider === "google_postmaster"
                ? "Google Postmaster"
                : settings.deliverability.provider === "mailpool"
                  ? "Mailpool"
                  : "No monitor selected",
              settings.deliverability.monitoredDomains.length
                ? `${settings.deliverability.monitoredDomains.length} monitored domain${settings.deliverability.monitoredDomains.length === 1 ? "" : "s"}`
                : "No watched domains yet",
              settings.deliverability.provider === "mailpool"
                ? `${settings.deliverability.mailpoolInboxProviders.length} inbox providers`
                : settings.deliverability.hasGoogleClientId
                  ? "Client ID saved"
                  : "Client ID needed",
              settings.deliverability.provider === "mailpool"
                ? "Uses Mailpool workspace connection"
                : settings.deliverability.hasGoogleRefreshToken
                  ? "Refresh token saved"
                  : "Refresh token needed",
            ]}
            lastChecked={formatRelativeTimeLabel(settings.deliverability.lastCheckedAt, "Not tested yet")}
            onOpen={() => {
              setError("");
              setNotice("");
              resetFormFromSettings();
              setActiveModal("deliverability");
            }}
            onValidate={() => void validateSavedProvider("deliverability")}
            validating={testingProvider === "deliverability"}
          />

          {error ? (
            <div className="md:col-span-4">
              <div className="flex items-start gap-3 rounded-xl border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3 text-sm text-[color:var(--danger)]">
                <AlertCircle className="mt-0.5 h-4 w-4" />
                <div>{error}</div>
              </div>
            </div>
          ) : null}

          {!error && notice ? (
            <div className="md:col-span-4">
              <div className="flex items-start gap-3 rounded-xl border border-[color:var(--success-border)] bg-[color:var(--success-soft)] px-4 py-3 text-sm text-[color:var(--success)]">
                <CheckCircle2 className="mt-0.5 h-4 w-4" />
                <div>{notice}</div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <SettingsModal
        open={activeModal === "customerio"}
        onOpenChange={(open) => {
          if (!open) {
            resetFormFromSettings();
            setActiveModal(null);
          }
        }}
        title={customerIoConfigured ? "Customer.io setup" : "Connect Customer.io"}
        description="Paste the Customer.io details we need for sending. Leave secret fields blank if you want to keep the saved value."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a
              href={CUSTOMER_IO_HELP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-[color:var(--muted-foreground)] underline underline-offset-4"
            >
              Where do I find my Site ID and API keys?
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={() => setActiveModal(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={savingProvider === "customerio" || testingProvider === "customerio"}
                onClick={() => void saveProvider("customerio", true)}
              >
                {savingProvider === "customerio" || testingProvider === "customerio" ? "Saving..." : "Save and test"}
              </Button>
              <Button
                type="button"
                disabled={savingProvider === "customerio" || testingProvider === "customerio"}
                onClick={() => void saveProvider("customerio")}
              >
                {savingProvider === "customerio" ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--foreground)]">
            <div className="font-medium">You only need two things</div>
            <div className="mt-1 text-[color:var(--muted-foreground)]">
              Paste your Site ID and Tracking key. The App key is optional.
            </div>
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-cio-site-id"
              label="Site ID"
              help="Customer.io -> Settings -> API Credentials. Copy the Site ID from the same row as your tracking key."
            />
            <Input
              id="provider-cio-site-id"
              value={form.customerIoSiteId}
              onChange={(event) => setForm((prev) => ({ ...prev, customerIoSiteId: event.target.value }))}
              placeholder="7c3b15c5ffdd9762cb6f"
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-cio-track-key"
              label="Tracking key"
              help="Paste the Tracking API key from Customer.io. Leave this blank if you want to keep the saved key."
            />
            <Input
              id="provider-cio-track-key"
              type={showCustomerIoSecrets ? "text" : "password"}
              value={form.customerIoTrackingApiKey}
              onChange={(event) => setForm((prev) => ({ ...prev, customerIoTrackingApiKey: event.target.value }))}
              placeholder={settings.customerIo.hasTrackingApiKey ? "Saved. Leave blank to keep current key." : ""}
            />
          </div>
          <div className="grid gap-2 md:col-span-2">
            <FieldLabel
              htmlFor="provider-cio-app-key"
              label="App key (optional)"
              help="Optional. This lets the app read Customer.io people counts before you hit your monthly limit."
            />
            <Input
              id="provider-cio-app-key"
              type={showCustomerIoSecrets ? "text" : "password"}
              value={form.customerIoAppApiKey}
              onChange={(event) => setForm((prev) => ({ ...prev, customerIoAppApiKey: event.target.value }))}
              placeholder={settings.customerIo.hasAppApiKey ? "Saved. Leave blank to keep current key." : "Optional"}
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowCustomerIoSecrets((prev) => !prev)}
            >
              {showCustomerIoSecrets ? "Hide secret values" : "Show secret values"}
            </Button>
          </div>
          <div className="md:col-span-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
            Last check: {settings.customerIo.lastValidatedAt || "never"}
            {settings.customerIo.lastValidationMessage ? ` · ${settings.customerIo.lastValidationMessage}` : ""}
          </div>
        </div>
      </SettingsModal>

      <SettingsModal
        open={activeModal === "namecheap"}
        onOpenChange={(open) => {
          if (!open) {
            resetFormFromSettings();
            setActiveModal(null);
          }
        }}
        title={namecheapConfigured ? "Namecheap setup" : "Connect Namecheap"}
        description="Paste the Namecheap details we need for one-click domain setup. Leave the API key blank if you want to keep the saved value."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a
              href={NAMECHEAP_HELP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-[color:var(--muted-foreground)] underline underline-offset-4"
            >
              Where do I find API access and my whitelisted IP?
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={() => setActiveModal(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={savingProvider === "namecheap" || testingProvider === "namecheap"}
                onClick={() => void saveProvider("namecheap", true)}
              >
                {savingProvider === "namecheap" || testingProvider === "namecheap" ? "Saving..." : "Save and test"}
              </Button>
              <Button
                type="button"
                disabled={savingProvider === "namecheap" || testingProvider === "namecheap"}
                onClick={() => void saveProvider("namecheap")}
              >
                {savingProvider === "namecheap" ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--foreground)]">
            <div className="font-medium">You need three things</div>
            <div className="mt-1 text-[color:var(--muted-foreground)]">
              Paste your API user, API key, and the IP address you already allowed in Namecheap.
            </div>
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-nc-api-user"
              label="API User"
              help="Namecheap -> Profile -> Tools -> API Access. Copy the API user exactly as shown there."
            />
            <Input
              id="provider-nc-api-user"
              value={form.namecheapApiUser}
              onChange={(event) => setForm((prev) => ({ ...prev, namecheapApiUser: event.target.value }))}
              placeholder="adamfarkas"
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-nc-user-name"
              label="Username"
              help="Usually the same as API user. Only change this if Namecheap told you to use a different username."
            />
            <Input
              id="provider-nc-user-name"
              value={form.namecheapUserName}
              onChange={(event) => setForm((prev) => ({ ...prev, namecheapUserName: event.target.value }))}
              placeholder="Optional if same as API user"
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-nc-api-key"
              label="API Key"
              help="Generated in the same API Access screen. Leave blank here to keep the current key."
            />
            <Input
              id="provider-nc-api-key"
              type={showNamecheapSecrets ? "text" : "password"}
              value={form.namecheapApiKey}
              onChange={(event) => setForm((prev) => ({ ...prev, namecheapApiKey: event.target.value }))}
              placeholder={settings.namecheap.hasApiKey ? "Saved. Leave blank to keep current key." : ""}
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-nc-client-ip"
              label="Allowed IP address"
              help="Namecheap only accepts API requests from IPs you allowed first in the API Access screen."
            />
            <Input
              id="provider-nc-client-ip"
              value={form.namecheapClientIp}
              onChange={(event) => setForm((prev) => ({ ...prev, namecheapClientIp: event.target.value }))}
              placeholder="104.28.154.252"
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowNamecheapSecrets((prev) => !prev)}
            >
              {showNamecheapSecrets ? "Hide secret values" : "Show secret values"}
            </Button>
          </div>
          <div className="md:col-span-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
            Last check: {settings.namecheap.lastValidatedAt || "never"}
            {settings.namecheap.lastValidationMessage ? ` · ${settings.namecheap.lastValidationMessage}` : ""}
          </div>
        </div>
      </SettingsModal>

      <SettingsModal
        open={activeModal === "mailpool"}
        onOpenChange={(open) => {
          if (!open) {
            resetFormFromSettings();
            setActiveModal(null);
          }
        }}
        title={mailpoolConfigured ? "Mailpool setup" : "Connect Mailpool"}
        description="Save the shared Mailpool workspace credentials. Leave secret fields blank if you want to keep the saved values."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a
              href={MAILPOOL_HELP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-[color:var(--muted-foreground)] underline underline-offset-4"
            >
              Mailpool API docs
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={() => setActiveModal(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={savingProvider === "mailpool" || testingProvider === "mailpool"}
                onClick={() => void saveProvider("mailpool", true)}
              >
                {savingProvider === "mailpool" || testingProvider === "mailpool" ? "Saving..." : "Save and test"}
              </Button>
              <Button
                type="button"
                disabled={savingProvider === "mailpool" || testingProvider === "mailpool"}
                onClick={() => void saveProvider("mailpool")}
              >
                {savingProvider === "mailpool" ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--foreground)]">
            <div className="font-medium">Mailpool powers the new sender stack</div>
            <div className="mt-1 text-[color:var(--muted-foreground)]">
              The app uses one shared Mailpool workspace for domain purchase, Google mailbox provisioning, SMTP sends,
              inbox placement, and spam checks.
            </div>
          </div>
          <div className="grid gap-2 md:col-span-2">
            <FieldLabel
              htmlFor="provider-mailpool-api-key"
              label="API key"
              help="Paste the shared Mailpool API key. Leave blank here to keep the current value."
            />
            <Input
              id="provider-mailpool-api-key"
              type={showMailpoolSecrets ? "text" : "password"}
              value={form.mailpoolApiKey}
              onChange={(event) => setForm((prev) => ({ ...prev, mailpoolApiKey: event.target.value }))}
              placeholder={settings.mailpool.hasApiKey ? "Saved. Leave blank to keep current key." : ""}
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-mailpool-webhook-secret"
              label="Webhook secret"
              help="Paste the Mailpool webhook signing secret. Leave blank here to keep the current value."
            />
            <Input
              id="provider-mailpool-webhook-secret"
              type={showMailpoolSecrets ? "text" : "password"}
              value={form.mailpoolWebhookSecret}
              onChange={(event) => setForm((prev) => ({ ...prev, mailpoolWebhookSecret: event.target.value }))}
              placeholder={settings.mailpool.hasWebhookSecret ? "Saved. Leave blank to keep current secret." : ""}
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-mailpool-webhook-url"
              label="Webhook URL"
              help="Use this exact URL inside Mailpool workspace settings so mailbox and domain events reconcile back into the app."
            />
            <Input
              id="provider-mailpool-webhook-url"
              value={form.mailpoolWebhookUrl}
              onChange={(event) => setForm((prev) => ({ ...prev, mailpoolWebhookUrl: event.target.value }))}
              placeholder="https://lastb2b.com/api/webhooks/mailpool/events"
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowMailpoolSecrets((prev) => !prev)}
            >
              {showMailpoolSecrets ? "Hide secret values" : "Show secret values"}
            </Button>
          </div>
          <div className="md:col-span-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
            Last check: {settings.mailpool.lastValidatedAt || "never"}
            {settings.mailpool.lastValidationMessage ? ` · ${settings.mailpool.lastValidationMessage}` : ""}
          </div>
        </div>
      </SettingsModal>

      <SettingsModal
        open={activeModal === "deliverability"}
        onOpenChange={(open) => {
          if (!open) {
            resetFormFromSettings();
            setActiveModal(null);
          }
        }}
        title={deliverabilityConfigured ? "Deliverability setup" : "Connect deliverability checks"}
        description="Optional. Use Google Postmaster for Gmail reputation, or Mailpool for spam checks and inbox placement on Mailpool senders."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a
              href={DELIVERABILITY_HELP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-[color:var(--muted-foreground)] underline underline-offset-4"
            >
              How do I create Google Postmaster credentials?
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={() => setActiveModal(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={savingProvider === "deliverability" || testingProvider === "deliverability"}
                onClick={() => void saveProvider("deliverability", true)}
              >
                {savingProvider === "deliverability" || testingProvider === "deliverability"
                  ? "Saving..."
                  : "Save and test"}
              </Button>
              <Button
                type="button"
                disabled={savingProvider === "deliverability" || testingProvider === "deliverability"}
                onClick={() => void saveProvider("deliverability")}
              >
                {savingProvider === "deliverability" ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--foreground)]">
            <div className="font-medium">You need two parts</div>
            <div className="mt-1 text-[color:var(--muted-foreground)]">
              Add the domains you want to watch, then paste the Google client ID, client secret, and refresh token for
              the Postmaster account.
            </div>
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-deliverability-provider"
              label="Monitor source"
              help="Google Postmaster is used for Gmail reputation. Mailpool uses the saved Mailpool workspace for spam checks and inbox placement."
            />
            <select
              id="provider-deliverability-provider"
              value={form.deliverabilityProvider}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  deliverabilityProvider:
                    event.target.value === "google_postmaster"
                      ? "google_postmaster"
                      : event.target.value === "mailpool"
                        ? "mailpool"
                        : "none",
                }))
              }
              className="h-11 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--foreground)] shadow-sm outline-none transition focus:border-[color:var(--ring)] focus:ring-2 focus:ring-[color:var(--ring)]/20"
            >
              <option value="none">No external provider</option>
              <option value="google_postmaster">Google Postmaster</option>
              <option value="mailpool">Mailpool</option>
            </select>
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-deliverability-domains"
              label="Domains to watch"
              help="Enter the sender domains that already appear in Google Postmaster Tools, separated by commas."
            />
            <Input
              id="provider-deliverability-domains"
              value={form.deliverabilityDomains}
              onChange={(event) => setForm((prev) => ({ ...prev, deliverabilityDomains: event.target.value }))}
              placeholder={
                form.deliverabilityProvider === "mailpool"
                  ? "satellite1.com, satellite2.com"
                  : "fluentscroll.com, lequarterly.com"
              }
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-deliverability-client-id"
              label="Google client ID"
              help="Use the Google client ID tied to the account that can see these domains in Postmaster Tools. Leave blank to keep the saved value."
            />
            <Input
              id="provider-deliverability-client-id"
              type={showDeliverabilitySecrets ? "text" : "password"}
              value={form.deliverabilityGoogleClientId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, deliverabilityGoogleClientId: event.target.value }))
              }
              placeholder={settings.deliverability.hasGoogleClientId ? "Saved. Leave blank to keep current value." : ""}
              disabled={form.deliverabilityProvider !== "google_postmaster"}
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-deliverability-client-secret"
              label="Google client secret"
              help="Pair this with the client ID above. Leave blank if you want to keep the saved secret."
            />
            <Input
              id="provider-deliverability-client-secret"
              type={showDeliverabilitySecrets ? "text" : "password"}
              value={form.deliverabilityGoogleClientSecret}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, deliverabilityGoogleClientSecret: event.target.value }))
              }
              placeholder={settings.deliverability.hasGoogleClientSecret ? "Saved. Leave blank to keep current value." : ""}
              disabled={form.deliverabilityProvider !== "google_postmaster"}
            />
          </div>
          <div className="grid gap-2 md:col-span-2">
            <FieldLabel
              htmlFor="provider-deliverability-refresh-token"
              label="Google refresh token"
              help="This lets the app refresh Postmaster access automatically. Leave blank if you want to keep the saved token."
            />
            <Input
              id="provider-deliverability-refresh-token"
              type={showDeliverabilitySecrets ? "text" : "password"}
              value={form.deliverabilityGoogleRefreshToken}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, deliverabilityGoogleRefreshToken: event.target.value }))
              }
              placeholder={settings.deliverability.hasGoogleRefreshToken ? "Saved. Leave blank to keep current token." : ""}
              disabled={form.deliverabilityProvider !== "google_postmaster"}
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowDeliverabilitySecrets((prev) => !prev)}
            >
              {showDeliverabilitySecrets ? "Hide secret values" : "Show secret values"}
            </Button>
          </div>
          <div className="md:col-span-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
            Last check: {settings.deliverability.lastCheckedAt || "never"}
            {settings.deliverability.provider === "mailpool"
              ? ` · Mailpool inbox providers: ${settings.deliverability.mailpoolInboxProviders.join(", ")}`
              : settings.deliverability.lastHealthSummary
                ? ` · ${settings.deliverability.lastHealthSummary}`
                : ""}
          </div>
        </div>
      </SettingsModal>
    </>
  );
}
