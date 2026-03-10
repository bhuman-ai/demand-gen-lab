"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Eye, EyeOff, Link2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  testOutreachProvisioningSettings,
  updateOutreachProvisioningSettingsApi,
} from "@/lib/client-api";
import type { OutreachProvisioningSettings } from "@/lib/factory-types";

type ProviderSettingsFormState = {
  customerIoSiteId: string;
  customerIoTrackingApiKey: string;
  customerIoAppApiKey: string;
  namecheapApiUser: string;
  namecheapUserName: string;
  namecheapApiKey: string;
  namecheapClientIp: string;
};

const INITIAL_FORM: ProviderSettingsFormState = {
  customerIoSiteId: "",
  customerIoTrackingApiKey: "",
  customerIoAppApiKey: "",
  namecheapApiUser: "",
  namecheapUserName: "",
  namecheapApiKey: "",
  namecheapClientIp: "",
};

function InlineHint({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group">
      <span
        tabIndex={0}
        aria-label="Field help"
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[color:var(--border)] text-[10px] font-semibold text-[color:var(--muted-foreground)] outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
      >
        ?
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-[130%] z-20 w-72 -translate-x-1/2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-1 text-[11px] leading-relaxed text-[color:var(--foreground)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

function HelpLabel({ htmlFor, label, help }: { htmlFor: string; label: string; help: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      <InlineHint text={help} />
    </div>
  );
}

function validationBadge(status: OutreachProvisioningSettings["customerIo"]["lastValidatedStatus"]) {
  if (status === "pass") return <Badge variant="success">Connected</Badge>;
  if (status === "fail") return <Badge variant="danger">Needs attention</Badge>;
  return <Badge variant="muted">Not tested</Badge>;
}

function ProviderSummaryCard({
  title,
  description,
  configured,
  validationStatus,
  details,
  open,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  configured: boolean;
  validationStatus: OutreachProvisioningSettings["customerIo"]["lastValidatedStatus"];
  details: string[];
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold">{title}</div>
            {configured ? <Badge variant="success">Saved</Badge> : <Badge variant="muted">Missing</Badge>}
            {validationBadge(validationStatus)}
          </div>
          <div className="text-sm text-[color:var(--muted-foreground)]">{description}</div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onToggle}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          {open ? "Hide details" : "Edit details"}
        </Button>
      </div>
      {!open ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {details.map((detail) => (
            <Badge key={detail} variant="default">
              {detail}
            </Badge>
          ))}
        </div>
      ) : (
        <div className="mt-4">{children}</div>
      )}
    </div>
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
  const [saving, setSaving] = useState(false);
  const [testingProvider, setTestingProvider] = useState<"" | "customerio" | "namecheap">("");
  const [showCustomerIoSecrets, setShowCustomerIoSecrets] = useState(false);
  const [showNamecheapSecrets, setShowNamecheapSecrets] = useState(false);
  const [openSections, setOpenSections] = useState({
    customerIo: false,
    namecheap: false,
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const customerIoConfigured = Boolean(settings.customerIo.siteId.trim() && settings.customerIo.hasTrackingApiKey);
  const namecheapConfigured = Boolean(
    settings.namecheap.apiUser.trim() && settings.namecheap.clientIp.trim() && settings.namecheap.hasApiKey
  );

  useEffect(() => {
    setForm({
      customerIoSiteId: settings.customerIo.siteId,
      customerIoTrackingApiKey: "",
      customerIoAppApiKey: "",
      namecheapApiUser: settings.namecheap.apiUser,
      namecheapUserName: settings.namecheap.userName,
      namecheapApiKey: "",
      namecheapClientIp: settings.namecheap.clientIp,
    });
    setOpenSections({
      customerIo: !customerIoConfigured || settings.customerIo.lastValidatedStatus === "fail",
      namecheap: !namecheapConfigured || settings.namecheap.lastValidatedStatus === "fail",
    });
  }, [
    customerIoConfigured,
    namecheapConfigured,
    settings.customerIo.hasTrackingApiKey,
    settings.customerIo.lastValidatedStatus,
    settings.customerIo.siteId,
    settings.namecheap.apiUser,
    settings.namecheap.clientIp,
    settings.namecheap.hasApiKey,
    settings.namecheap.lastValidatedStatus,
    settings.namecheap.userName,
  ]);

  const persistSettings = async () => {
    const next = await updateOutreachProvisioningSettingsApi({
      customerIo: {
        siteId: form.customerIoSiteId.trim(),
        trackingApiKey: form.customerIoTrackingApiKey.trim(),
        appApiKey: form.customerIoAppApiKey.trim(),
      },
      namecheap: {
        apiUser: form.namecheapApiUser.trim(),
        userName: form.namecheapUserName.trim(),
        clientIp: form.namecheapClientIp.trim(),
        apiKey: form.namecheapApiKey.trim(),
      },
    });
    onSaved(next);
    setForm((prev) => ({
      ...prev,
      customerIoTrackingApiKey: "",
      customerIoAppApiKey: "",
      namecheapApiKey: "",
    }));
    return next;
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-[color:var(--border)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--surface-muted)_92%,white),var(--surface))]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1 text-xs text-[color:var(--muted-foreground)]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Hidden until you edit
            </div>
            <CardTitle className="text-base">Connect Your Delivery Stack</CardTitle>
            <CardDescription>
              Save platform defaults once, keep secrets hidden by default, and only open the technical fields when you
              need to update them.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {customerIoConfigured ? <Badge variant="success">Customer.io saved</Badge> : <Badge variant="muted">Customer.io missing</Badge>}
            {namecheapConfigured ? <Badge variant="success">Namecheap saved</Badge> : <Badge variant="muted">Namecheap missing</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-5">
        <ProviderSummaryCard
          title="Customer.io"
          description="Used for sender identity creation and monthly profile capacity checks."
          configured={customerIoConfigured}
          validationStatus={settings.customerIo.lastValidatedStatus}
          details={[
            settings.customerIo.siteId ? `Site ${settings.customerIo.siteId}` : "Site ID missing",
            settings.customerIo.hasTrackingApiKey ? "Tracking key saved" : "Tracking key missing",
            settings.customerIo.hasAppApiKey ? "App key saved" : "App key optional",
            `Region ${settings.customerIo.workspaceRegion.toUpperCase()}`,
          ]}
          open={openSections.customerIo}
          onToggle={() => setOpenSections((prev) => ({ ...prev, customerIo: !prev.customerIo }))}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <div className="grid gap-2">
              <HelpLabel
                htmlFor="provider-cio-site-id"
                label="Site ID"
                help="Customer.io -> Settings -> API Credentials. Copy the Site ID from the same row as your Tracking API key."
              />
              <Input
                id="provider-cio-site-id"
                value={form.customerIoSiteId}
                onChange={(event) => setForm((prev) => ({ ...prev, customerIoSiteId: event.target.value }))}
                placeholder="7c3b15c5ffdd9762cb6f"
              />
            </div>
            <div className="grid gap-2">
              <HelpLabel
                htmlFor="provider-cio-track-key"
                label="Tracking API Key"
                help="Customer.io -> Settings -> API Credentials. Use the Tracking API key, not the App API key, for region lookup and sender setup."
              />
              <div className="flex gap-2">
                <Input
                  id="provider-cio-track-key"
                  type={showCustomerIoSecrets ? "text" : "password"}
                  value={form.customerIoTrackingApiKey}
                  onChange={(event) => setForm((prev) => ({ ...prev, customerIoTrackingApiKey: event.target.value }))}
                  placeholder={settings.customerIo.hasTrackingApiKey ? "Saved. Leave blank to keep current key." : ""}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowCustomerIoSecrets((prev) => !prev)}
                  aria-label={showCustomerIoSecrets ? "Hide tracking key" : "Show tracking key"}
                >
                  {showCustomerIoSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="grid gap-2">
              <HelpLabel
                htmlFor="provider-cio-app-key"
                label="App API Key"
                help="Optional but recommended. Used to fetch workspace people counts so the profile guard can stop before you cross the monthly cap."
              />
              <Input
                id="provider-cio-app-key"
                type={showCustomerIoSecrets ? "text" : "password"}
                value={form.customerIoAppApiKey}
                onChange={(event) => setForm((prev) => ({ ...prev, customerIoAppApiKey: event.target.value }))}
                placeholder={settings.customerIo.hasAppApiKey ? "Saved. Leave blank to keep current key." : "Optional"}
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--muted-foreground)]">
            <span>
              Last check: {settings.customerIo.lastValidatedAt || "never"}
              {settings.customerIo.lastValidationMessage ? ` · ${settings.customerIo.lastValidationMessage}` : ""}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || Boolean(testingProvider)}
              onClick={async () => {
                setError("");
                setNotice("");
                try {
                  setTestingProvider("customerio");
                  await persistSettings();
                  const result = await testOutreachProvisioningSettings("customerio");
                  onSaved(result.settings);
                  setNotice(result.tests.customerIo?.message || "Customer.io defaults tested.");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Customer.io test failed");
                } finally {
                  setTestingProvider("");
                }
              }}
            >
              <Link2 className="h-4 w-4" />
              {testingProvider === "customerio" ? "Testing..." : "Validate Customer.io"}
            </Button>
          </div>
        </ProviderSummaryCard>

        <ProviderSummaryCard
          title="Namecheap"
          description="Used for domain inventory, DNS updates, and forwarding setup."
          configured={namecheapConfigured}
          validationStatus={settings.namecheap.lastValidatedStatus}
          details={[
            settings.namecheap.apiUser ? `API user ${settings.namecheap.apiUser}` : "API user missing",
            settings.namecheap.userName ? `Username ${settings.namecheap.userName}` : "Username defaults to API user",
            settings.namecheap.hasApiKey ? "API key saved" : "API key missing",
            settings.namecheap.clientIp ? `IP ${settings.namecheap.clientIp}` : "Whitelisted IP missing",
          ]}
          open={openSections.namecheap}
          onToggle={() => setOpenSections((prev) => ({ ...prev, namecheap: !prev.namecheap }))}
        >
          <div className="grid gap-3 md:grid-cols-4">
            <div className="grid gap-2">
              <HelpLabel
                htmlFor="provider-nc-api-user"
                label="API User"
                help="Namecheap -> Profile -> Tools -> Namecheap API Access. Copy the API user exactly as shown there."
              />
              <Input
                id="provider-nc-api-user"
                value={form.namecheapApiUser}
                onChange={(event) => setForm((prev) => ({ ...prev, namecheapApiUser: event.target.value }))}
                placeholder="adamfarkas"
              />
            </div>
            <div className="grid gap-2">
              <HelpLabel
                htmlFor="provider-nc-user-name"
                label="User Name"
                help="Usually the same as API User. Only change this if Namecheap tells you to use a different username."
              />
              <Input
                id="provider-nc-user-name"
                value={form.namecheapUserName}
                onChange={(event) => setForm((prev) => ({ ...prev, namecheapUserName: event.target.value }))}
                placeholder="Optional if same as API user"
              />
            </div>
            <div className="grid gap-2">
              <HelpLabel
                htmlFor="provider-nc-api-key"
                label="API Key"
                help="Generated in the same Namecheap API Access screen. Leave the field blank here to keep the saved key unchanged."
              />
              <div className="flex gap-2">
                <Input
                  id="provider-nc-api-key"
                  type={showNamecheapSecrets ? "text" : "password"}
                  value={form.namecheapApiKey}
                  onChange={(event) => setForm((prev) => ({ ...prev, namecheapApiKey: event.target.value }))}
                  placeholder={settings.namecheap.hasApiKey ? "Saved. Leave blank to keep current key." : ""}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowNamecheapSecrets((prev) => !prev)}
                  aria-label={showNamecheapSecrets ? "Hide API key" : "Show API key"}
                >
                  {showNamecheapSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="grid gap-2">
              <HelpLabel
                htmlFor="provider-nc-client-ip"
                label="Whitelisted Client IP"
                help="Namecheap only accepts API requests from IPs you whitelist. Add the deployment IP in Namecheap first, then save it here."
              />
              <Input
                id="provider-nc-client-ip"
                value={form.namecheapClientIp}
                onChange={(event) => setForm((prev) => ({ ...prev, namecheapClientIp: event.target.value }))}
                placeholder="104.28.154.252"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--muted-foreground)]">
            <span>
              Last check: {settings.namecheap.lastValidatedAt || "never"}
              {settings.namecheap.lastValidationMessage ? ` · ${settings.namecheap.lastValidationMessage}` : ""}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving || Boolean(testingProvider)}
              onClick={async () => {
                setError("");
                setNotice("");
                try {
                  setTestingProvider("namecheap");
                  await persistSettings();
                  const result = await testOutreachProvisioningSettings("namecheap");
                  onSaved(result.settings);
                  setNotice(result.tests.namecheap?.message || "Namecheap defaults tested.");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Namecheap test failed");
                } finally {
                  setTestingProvider("");
                }
              }}
            >
              <Link2 className="h-4 w-4" />
              {testingProvider === "namecheap" ? "Testing..." : "Validate Namecheap"}
            </Button>
          </div>
        </ProviderSummaryCard>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3">
          <div className="flex items-start gap-3 text-sm text-[color:var(--muted-foreground)]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-[color:var(--success)]" />
            Blank secret fields keep the currently saved keys. Open a provider only when you need to replace or test it.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving || Boolean(testingProvider)}
              onClick={async () => {
                setError("");
                setNotice("");
                try {
                  setSaving(true);
                  await persistSettings();
                  setNotice("Connection defaults saved.");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to save provisioning defaults");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>

        {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
        {!error && notice ? <div className="text-sm text-[color:var(--muted-foreground)]">{notice}</div> : null}
      </CardContent>
    </Card>
  );
}
