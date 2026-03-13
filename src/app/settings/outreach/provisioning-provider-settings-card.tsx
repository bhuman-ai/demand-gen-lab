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
import {
  testOutreachProvisioningSettings,
  updateOutreachProvisioningSettingsApi,
} from "@/lib/client-api";
import type { OutreachProvisioningSettings } from "@/lib/factory-types";
import { FieldLabel, SettingsModal, formatRelativeTimeLabel } from "./settings-primitives";

type ProviderKey = "customerio" | "namecheap" | "deliverability";

type ProviderSettingsFormState = {
  customerIoSiteId: string;
  customerIoTrackingApiKey: string;
  customerIoAppApiKey: string;
  namecheapApiUser: string;
  namecheapUserName: string;
  namecheapApiKey: string;
  namecheapClientIp: string;
  deliverabilityProvider: "none" | "google_postmaster";
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
  deliverabilityProvider: "none",
  deliverabilityDomains: "",
  deliverabilityGoogleClientId: "",
  deliverabilityGoogleClientSecret: "",
  deliverabilityGoogleRefreshToken: "",
};

const CUSTOMER_IO_HELP_URL = "https://docs.customer.io/journeys/api-credentials/";
const NAMECHEAP_HELP_URL = "https://www.namecheap.com/support/knowledgebase/article.aspx/9739/63/api-faq/";
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
  details,
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
  details: string[];
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
        <div className="text-sm">{summary}</div>
        {details.length ? (
          <div className="grid gap-1 text-xs text-[color:var(--muted-foreground)]">
            {details.map((detail) => (
              <div key={detail}>{detail}</div>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="text-[color:var(--muted-foreground)]">Last checked {lastChecked}</div>
          <div className="flex flex-wrap gap-2">
            {configured ? (
              <Button type="button" variant="outline" size="sm" onClick={onValidate} disabled={validating}>
                {validating ? "Checking..." : "Check"}
              </Button>
            ) : null}
            <Button type="button" variant={configured ? "outline" : "default"} size="sm" onClick={onOpen}>
              {configured ? (
                <>
                  <Settings2 className="h-4 w-4" />
                  Edit
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4" />
                  Connect
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
  const [showDeliverabilitySecrets, setShowDeliverabilitySecrets] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const customerIoConfigured = Boolean(settings.customerIo.siteId.trim() && settings.customerIo.hasTrackingApiKey);
  const namecheapConfigured = Boolean(
    settings.namecheap.apiUser.trim() && settings.namecheap.clientIp.trim() && settings.namecheap.hasApiKey
  );
  const deliverabilityConfigured =
    settings.deliverability.provider === "google_postmaster" &&
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
            : await updateOutreachProvisioningSettingsApi({
                deliverability: {
                  provider: form.deliverabilityProvider,
                  monitoredDomains: form.deliverabilityDomains
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
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
          <CardTitle className="text-base">Connections</CardTitle>
          <CardDescription>Save the platform connections here. Secret values stay hidden until you edit them.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-0 md:grid-cols-3">
          <ConnectionCard
            title="Customer.io"
            description="Used for sender identity creation and monthly profile capacity checks."
            icon={Send}
            configured={customerIoConfigured}
            validationStatus={settings.customerIo.lastValidatedStatus}
            summary={
              customerIoConfigured
                ? `Connected to Site ${settings.customerIo.siteId}`
                : "No Customer.io site is linked yet."
            }
            details={[
              settings.customerIo.siteId ? `Site ${settings.customerIo.siteId}` : "Site ID missing",
              settings.customerIo.hasTrackingApiKey ? "Tracking key saved" : "Tracking key missing",
              settings.customerIo.hasAppApiKey ? "App key saved" : "App key optional",
              `Region ${settings.customerIo.workspaceRegion.toUpperCase()}`,
            ]}
            lastChecked={formatRelativeTimeLabel(settings.customerIo.lastValidatedAt, "Never validated")}
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
            description="Used for domain inventory, DNS updates, and forwarding setup."
            icon={Globe}
            configured={namecheapConfigured}
            validationStatus={settings.namecheap.lastValidatedStatus}
            summary={
              namecheapConfigured
                ? `Connected to ${settings.namecheap.apiUser || settings.namecheap.userName}`
                : "No Namecheap API credentials are linked yet."
            }
            details={[
              settings.namecheap.apiUser ? `API user ${settings.namecheap.apiUser}` : "API user missing",
              settings.namecheap.userName ? `Username ${settings.namecheap.userName}` : "Username defaults to API user",
              settings.namecheap.hasApiKey ? "API key saved" : "API key missing",
              settings.namecheap.clientIp ? `IP ${settings.namecheap.clientIp}` : "Whitelisted IP missing",
            ]}
            lastChecked={formatRelativeTimeLabel(settings.namecheap.lastValidatedAt, "Never validated")}
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
            title="Deliverability"
            description="Used for ongoing Gmail reputation checks so sender health is monitored without guessing."
            icon={ShieldCheck}
            configured={deliverabilityConfigured}
            validationStatus={settings.deliverability.lastValidatedStatus}
            summary={
              deliverabilityConfigured
                ? `Watching ${settings.deliverability.monitoredDomains.join(", ")}`
                : "No deliverability intelligence provider is linked yet."
            }
            details={[
              settings.deliverability.provider === "google_postmaster"
                ? "Google Postmaster selected"
                : "No provider selected",
              settings.deliverability.monitoredDomains.length
                ? `${settings.deliverability.monitoredDomains.length} monitored domain${settings.deliverability.monitoredDomains.length === 1 ? "" : "s"}`
                : "No monitored domains",
              settings.deliverability.hasGoogleClientId ? "Client ID saved" : "Client ID missing",
              settings.deliverability.hasGoogleClientSecret ? "Client secret saved" : "Client secret missing",
              settings.deliverability.hasGoogleRefreshToken ? "Refresh token saved" : "Refresh token missing",
              settings.deliverability.lastHealthSummary || "No health snapshot yet",
            ]}
            lastChecked={formatRelativeTimeLabel(settings.deliverability.lastCheckedAt, "Never checked")}
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
            <div className="md:col-span-2">
              <div className="flex items-start gap-3 rounded-xl border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3 text-sm text-[color:var(--danger)]">
                <AlertCircle className="mt-0.5 h-4 w-4" />
                <div>{error}</div>
              </div>
            </div>
          ) : null}

          {!error && notice ? (
            <div className="md:col-span-2">
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
        title={customerIoConfigured ? "Customer.io connection settings" : "Connect Customer.io"}
        description="Only the saved connection fields live here. Blank secret fields keep the current keys in place."
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
                {savingProvider === "customerio" || testingProvider === "customerio" ? "Saving..." : "Save + check"}
              </Button>
              <Button
                type="button"
                disabled={savingProvider === "customerio" || testingProvider === "customerio"}
                onClick={() => void saveProvider("customerio")}
              >
                {savingProvider === "customerio" ? "Saving..." : "Save connection"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
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
              label="Tracking API Key"
              help="Use the Tracking API key for region lookup and sender setup. Leave blank to keep the saved key."
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
              label="App API Key"
              help="Optional but recommended. Used to fetch workspace people counts before you cross the monthly cap."
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
        title={namecheapConfigured ? "Namecheap connection settings" : "Connect Namecheap"}
        description="Keep the API details tucked away until you need to update domain automation."
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
                {savingProvider === "namecheap" || testingProvider === "namecheap" ? "Saving..." : "Save + check"}
              </Button>
              <Button
                type="button"
                disabled={savingProvider === "namecheap" || testingProvider === "namecheap"}
                onClick={() => void saveProvider("namecheap")}
              >
                {savingProvider === "namecheap" ? "Saving..." : "Save connection"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
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
              label="User Name"
              help="Usually the same as API User. Only change it if Namecheap tells you to use a different username."
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
              label="Whitelisted Client IP"
              help="Namecheap only accepts API requests from IPs you whitelist first in the API Access screen."
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
        open={activeModal === "deliverability"}
        onOpenChange={(open) => {
          if (!open) {
            resetFormFromSettings();
            setActiveModal(null);
          }
        }}
        title={deliverabilityConfigured ? "Deliverability intelligence settings" : "Connect deliverability intelligence"}
        description="This powers the ongoing spam and reputation checks. We currently use Google Postmaster data for monitored domains."
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
                  : "Save + check"}
              </Button>
              <Button
                type="button"
                disabled={savingProvider === "deliverability" || testingProvider === "deliverability"}
                onClick={() => void saveProvider("deliverability")}
              >
                {savingProvider === "deliverability" ? "Saving..." : "Save connection"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-deliverability-provider"
              label="Provider"
              help="Google Postmaster is the current first-class integration for Gmail reputation and spam-rate monitoring."
            />
            <select
              id="provider-deliverability-provider"
              value={form.deliverabilityProvider}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  deliverabilityProvider: event.target.value === "google_postmaster" ? "google_postmaster" : "none",
                }))
              }
              className="h-11 w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--foreground)] shadow-sm outline-none transition focus:border-[color:var(--ring)] focus:ring-2 focus:ring-[color:var(--ring)]/20"
            >
              <option value="none">No external provider</option>
              <option value="google_postmaster">Google Postmaster</option>
            </select>
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-deliverability-domains"
              label="Monitored domains"
              help="Comma-separated domains that already appear in Google Postmaster Tools, for example fluentscroll.com, lequarterly.com."
            />
            <Input
              id="provider-deliverability-domains"
              value={form.deliverabilityDomains}
              onChange={(event) => setForm((prev) => ({ ...prev, deliverabilityDomains: event.target.value }))}
              placeholder="fluentscroll.com, lequarterly.com"
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-deliverability-client-id"
              label="Google OAuth Client ID"
              help="Use the OAuth client tied to the Google account that can see the domain in Postmaster Tools. Leave blank to keep the saved value."
            />
            <Input
              id="provider-deliverability-client-id"
              type={showDeliverabilitySecrets ? "text" : "password"}
              value={form.deliverabilityGoogleClientId}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, deliverabilityGoogleClientId: event.target.value }))
              }
              placeholder={settings.deliverability.hasGoogleClientId ? "Saved. Leave blank to keep current value." : ""}
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="provider-deliverability-client-secret"
              label="Google OAuth Client Secret"
              help="Pair this with the client ID above. Leave blank here to keep the saved secret."
            />
            <Input
              id="provider-deliverability-client-secret"
              type={showDeliverabilitySecrets ? "text" : "password"}
              value={form.deliverabilityGoogleClientSecret}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, deliverabilityGoogleClientSecret: event.target.value }))
              }
              placeholder={settings.deliverability.hasGoogleClientSecret ? "Saved. Leave blank to keep current value." : ""}
            />
          </div>
          <div className="grid gap-2 md:col-span-2">
            <FieldLabel
              htmlFor="provider-deliverability-refresh-token"
              label="Google Refresh Token"
              help="This is used server-side to refresh Postmaster access automatically. Leave blank to keep the saved token."
            />
            <Input
              id="provider-deliverability-refresh-token"
              type={showDeliverabilitySecrets ? "text" : "password"}
              value={form.deliverabilityGoogleRefreshToken}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, deliverabilityGoogleRefreshToken: event.target.value }))
              }
              placeholder={settings.deliverability.hasGoogleRefreshToken ? "Saved. Leave blank to keep current token." : ""}
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
            {settings.deliverability.lastHealthSummary ? ` · ${settings.deliverability.lastHealthSummary}` : ""}
          </div>
        </div>
      </SettingsModal>
    </>
  );
}
