"use client";

import { useEffect, useState } from "react";
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

function statusClass(status: OutreachProvisioningSettings["customerIo"]["lastValidatedStatus"]) {
  if (status === "pass") {
    return "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]";
  }
  if (status === "fail") {
    return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]";
  }
  return "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)]";
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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
  }, [settings]);

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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Provisioning Provider Defaults</CardTitle>
        <CardDescription>
          Save platform-level Customer.io and Namecheap credentials once, then reuse them from one-button sender
          provisioning without pasting keys every time.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 md:grid-cols-3">
          <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">Customer.io</div>
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(settings.customerIo.lastValidatedStatus)}`}>
                {settings.customerIo.lastValidatedStatus === "pass"
                  ? "validated"
                  : settings.customerIo.lastValidatedStatus === "fail"
                    ? "needs attention"
                    : "not tested"}
              </span>
              <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-xs text-[color:var(--muted-foreground)]">
                {settings.customerIo.hasTrackingApiKey ? "tracking key saved" : "tracking key missing"}
              </span>
              <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-xs text-[color:var(--muted-foreground)]">
                {settings.customerIo.hasAppApiKey ? "app key saved" : "app key optional"}
              </span>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider-cio-site-id">Site ID</Label>
            <Input
              id="provider-cio-site-id"
              value={form.customerIoSiteId}
              onChange={(event) => setForm((prev) => ({ ...prev, customerIoSiteId: event.target.value }))}
              placeholder="7c3b15c5ffdd9762cb6f"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider-cio-track-key">Tracking API Key</Label>
            <Input
              id="provider-cio-track-key"
              type="password"
              value={form.customerIoTrackingApiKey}
              onChange={(event) => setForm((prev) => ({ ...prev, customerIoTrackingApiKey: event.target.value }))}
              placeholder={settings.customerIo.hasTrackingApiKey ? "Saved. Leave blank to keep current key." : ""}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider-cio-app-key">App API Key</Label>
            <Input
              id="provider-cio-app-key"
              type="password"
              value={form.customerIoAppApiKey}
              onChange={(event) => setForm((prev) => ({ ...prev, customerIoAppApiKey: event.target.value }))}
              placeholder={settings.customerIo.hasAppApiKey ? "Saved. Leave blank to keep current key." : "Optional"}
            />
          </div>
          <div className="md:col-span-3 text-xs text-[color:var(--muted-foreground)]">
            Region: {settings.customerIo.workspaceRegion.toUpperCase()} · Last check:{" "}
            {settings.customerIo.lastValidatedAt || "never"}
            {settings.customerIo.lastValidationMessage ? ` · ${settings.customerIo.lastValidationMessage}` : ""}
          </div>
        </div>

        <div className="grid gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 md:grid-cols-4">
          <div className="md:col-span-4 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">Namecheap</div>
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(settings.namecheap.lastValidatedStatus)}`}>
                {settings.namecheap.lastValidatedStatus === "pass"
                  ? "validated"
                  : settings.namecheap.lastValidatedStatus === "fail"
                    ? "needs attention"
                    : "not tested"}
              </span>
              <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-xs text-[color:var(--muted-foreground)]">
                {settings.namecheap.hasApiKey ? "api key saved" : "api key missing"}
              </span>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider-nc-api-user">API User</Label>
            <Input
              id="provider-nc-api-user"
              value={form.namecheapApiUser}
              onChange={(event) => setForm((prev) => ({ ...prev, namecheapApiUser: event.target.value }))}
              placeholder="adamfarkas"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider-nc-user-name">User Name</Label>
            <Input
              id="provider-nc-user-name"
              value={form.namecheapUserName}
              onChange={(event) => setForm((prev) => ({ ...prev, namecheapUserName: event.target.value }))}
              placeholder="Optional if same as API user"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider-nc-api-key">API Key</Label>
            <Input
              id="provider-nc-api-key"
              type="password"
              value={form.namecheapApiKey}
              onChange={(event) => setForm((prev) => ({ ...prev, namecheapApiKey: event.target.value }))}
              placeholder={settings.namecheap.hasApiKey ? "Saved. Leave blank to keep current key." : ""}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider-nc-client-ip">Whitelisted Client IP</Label>
            <Input
              id="provider-nc-client-ip"
              value={form.namecheapClientIp}
              onChange={(event) => setForm((prev) => ({ ...prev, namecheapClientIp: event.target.value }))}
              placeholder="104.28.154.252"
            />
          </div>
          <div className="md:col-span-4 text-xs text-[color:var(--muted-foreground)]">
            Last check: {settings.namecheap.lastValidatedAt || "never"}
            {settings.namecheap.lastValidationMessage ? ` · ${settings.namecheap.lastValidationMessage}` : ""}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[color:var(--muted-foreground)]">
            Saving with blank secret fields keeps the existing stored keys.
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
                  setNotice("Provisioning defaults saved.");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to save provisioning defaults");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving..." : "Save Defaults"}
            </Button>
            <Button
              type="button"
              variant="outline"
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
              {testingProvider === "customerio" ? "Testing Customer.io..." : "Test Customer.io"}
            </Button>
            <Button
              type="button"
              variant="outline"
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
              {testingProvider === "namecheap" ? "Testing Namecheap..." : "Test Namecheap"}
            </Button>
          </div>
        </div>

        {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
        {!error && notice ? <div className="text-sm text-[color:var(--muted-foreground)]">{notice}</div> : null}
      </CardContent>
    </Card>
  );
}
