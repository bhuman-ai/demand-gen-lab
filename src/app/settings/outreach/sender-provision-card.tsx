"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { provisionSenderDomain } from "@/lib/client-api";
import type { BrandRecord, OutreachAccount } from "@/lib/factory-types";

type AssignmentMap = Record<
  string,
  {
    accountId: string;
    mailboxAccountId: string;
  }
>;

type ProvisionResult = Awaited<ReturnType<typeof provisionSenderDomain>>;

type ProvisionState = {
  brandId: string;
  accountName: string;
  assignToBrand: boolean;
  selectedMailboxAccountId: string;
  domainMode: "existing" | "register";
  domain: string;
  fromLocalPart: string;
  customerIoSiteId: string;
  customerIoTrackingApiKey: string;
  customerIoAppApiKey: string;
  namecheapApiUser: string;
  namecheapUserName: string;
  namecheapApiKey: string;
  namecheapClientIp: string;
  registrantFirstName: string;
  registrantLastName: string;
  registrantOrganizationName: string;
  registrantEmailAddress: string;
  registrantPhone: string;
  registrantAddress1: string;
  registrantCity: string;
  registrantStateProvince: string;
  registrantPostalCode: string;
  registrantCountry: string;
};

type FieldErrors = Partial<Record<keyof ProvisionState, string>>;

const INITIAL_FORM: ProvisionState = {
  brandId: "",
  accountName: "",
  assignToBrand: true,
  selectedMailboxAccountId: "",
  domainMode: "existing",
  domain: "",
  fromLocalPart: "hello",
  customerIoSiteId: "",
  customerIoTrackingApiKey: "",
  customerIoAppApiKey: "",
  namecheapApiUser: "",
  namecheapUserName: "",
  namecheapApiKey: "",
  namecheapClientIp: "",
  registrantFirstName: "",
  registrantLastName: "",
  registrantOrganizationName: "",
  registrantEmailAddress: "",
  registrantPhone: "",
  registrantAddress1: "",
  registrantCity: "",
  registrantStateProvince: "",
  registrantPostalCode: "",
  registrantCountry: "US",
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="text-xs text-[color:var(--danger)]">{message}</div>;
}

function invalidFieldClass(isInvalid: boolean) {
  return isInvalid ? "border-[color:var(--danger-border)] focus-visible:ring-[color:var(--danger)]" : "";
}

export default function SenderProvisionCard({
  brands,
  mailboxAccounts,
  assignments,
  onProvisioned,
}: {
  brands: BrandRecord[];
  mailboxAccounts: OutreachAccount[];
  assignments: AssignmentMap;
  onProvisioned: (result: ProvisionResult) => void;
}) {
  const [form, setForm] = useState<ProvisionState>(() => ({
    ...INITIAL_FORM,
    brandId: brands[0]?.id ?? "",
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ProvisionResult | null>(null);

  useEffect(() => {
    setForm((prev) => {
      if (prev.brandId) return prev;
      return { ...prev, brandId: brands[0]?.id ?? "" };
    });
  }, [brands]);

  useEffect(() => {
    if (!form.brandId) return;
    const mailboxAccountId = assignments[form.brandId]?.mailboxAccountId ?? "";
    setForm((prev) => {
      if (prev.selectedMailboxAccountId) return prev;
      return {
        ...prev,
        selectedMailboxAccountId: mailboxAccountId,
      };
    });
  }, [assignments, form.brandId]);

  const currentAssignment = assignments[form.brandId] ?? { accountId: "", mailboxAccountId: "" };
  const selectedMailbox = useMemo(
    () => mailboxAccounts.find((account) => account.id === form.selectedMailboxAccountId) ?? null,
    [mailboxAccounts, form.selectedMailboxAccountId]
  );

  const validate = () => {
    const nextErrors: FieldErrors = {};
    if (!form.brandId) nextErrors.brandId = "Required.";
    if (!form.accountName.trim()) nextErrors.accountName = "Required.";
    if (!form.domain.trim()) nextErrors.domain = "Required.";
    if (!form.fromLocalPart.trim()) nextErrors.fromLocalPart = "Required.";
    if (!form.customerIoSiteId.trim()) nextErrors.customerIoSiteId = "Required.";
    if (!form.customerIoTrackingApiKey.trim()) nextErrors.customerIoTrackingApiKey = "Required.";
    if (!form.namecheapApiUser.trim()) nextErrors.namecheapApiUser = "Required.";
    if (!form.namecheapApiKey.trim()) nextErrors.namecheapApiKey = "Required.";
    if (!form.namecheapClientIp.trim()) nextErrors.namecheapClientIp = "Required.";

    if (form.domainMode === "register") {
      if (!form.registrantFirstName.trim()) nextErrors.registrantFirstName = "Required.";
      if (!form.registrantLastName.trim()) nextErrors.registrantLastName = "Required.";
      if (!form.registrantEmailAddress.trim()) nextErrors.registrantEmailAddress = "Required.";
      if (!form.registrantPhone.trim()) nextErrors.registrantPhone = "Required.";
      if (!form.registrantAddress1.trim()) nextErrors.registrantAddress1 = "Required.";
      if (!form.registrantCity.trim()) nextErrors.registrantCity = "Required.";
      if (!form.registrantStateProvince.trim()) nextErrors.registrantStateProvince = "Required.";
      if (!form.registrantPostalCode.trim()) nextErrors.registrantPostalCode = "Required.";
      if (!form.registrantCountry.trim()) nextErrors.registrantCountry = "Required.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const mailboxHint = selectedMailbox
    ? `Replies will route to ${selectedMailbox.config.mailbox.email || "the selected mailbox"}.`
    : currentAssignment.mailboxAccountId
      ? "The assigned reply mailbox will be preserved."
      : "No mailbox selected. Provisioning will work, but send preflight will still fail until you assign one.";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">One-Button Sender Provisioning</CardTitle>
        <CardDescription>
          Provision or reuse a Namecheap domain, bootstrap the Customer.io delivery account, and attach the sender to a
          brand in one action.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="provision-brand">Brand</Label>
            <Select
              id="provision-brand"
              value={form.brandId}
              onChange={(event) => {
                const brandId = event.target.value;
                setForm((prev) => ({
                  ...prev,
                  brandId,
                  selectedMailboxAccountId: assignments[brandId]?.mailboxAccountId ?? "",
                }));
              }}
              className={invalidFieldClass(Boolean(errors.brandId))}
            >
              <option value="">Select brand</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </Select>
            <FieldError message={errors.brandId} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provision-domain-mode">Domain Mode</Label>
            <Select
              id="provision-domain-mode"
              value={form.domainMode}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  domainMode: event.target.value === "register" ? "register" : "existing",
                }))
              }
            >
              <option value="existing">Use existing Namecheap domain</option>
              <option value="register">Register new Namecheap domain</option>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provision-mailbox">Reply Mailbox</Label>
            <Select
              id="provision-mailbox"
              value={form.selectedMailboxAccountId}
              onChange={(event) => setForm((prev) => ({ ...prev, selectedMailboxAccountId: event.target.value }))}
            >
              <option value="">Leave unchanged / none</option>
              {mailboxAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} {account.config.mailbox.email ? `· ${account.config.mailbox.email}` : ""}
                </option>
              ))}
            </Select>
            <div className="text-[11px] text-[color:var(--muted-foreground)]">{mailboxHint}</div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provision-domain">Domain</Label>
            <Input
              id="provision-domain"
              value={form.domain}
              onChange={(event) => setForm((prev) => ({ ...prev, domain: event.target.value }))}
              placeholder="example.com"
              className={invalidFieldClass(Boolean(errors.domain))}
            />
            <FieldError message={errors.domain} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provision-local-part">Sender Local-Part</Label>
            <Input
              id="provision-local-part"
              value={form.fromLocalPart}
              onChange={(event) => setForm((prev) => ({ ...prev, fromLocalPart: event.target.value }))}
              placeholder="hello"
              className={invalidFieldClass(Boolean(errors.fromLocalPart))}
            />
            <FieldError message={errors.fromLocalPart} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provision-account-name">Delivery Account Name</Label>
            <Input
              id="provision-account-name"
              value={form.accountName}
              onChange={(event) => setForm((prev) => ({ ...prev, accountName: event.target.value }))}
              placeholder="Main Customer.io Sender"
              className={invalidFieldClass(Boolean(errors.accountName))}
            />
            <FieldError message={errors.accountName} />
          </div>
        </div>

        {form.domainMode === "register" ? (
          <div className="grid gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 md:grid-cols-3">
            <div className="md:col-span-3 text-sm font-semibold">Registrant Contact</div>
            <div className="grid gap-2">
              <Label htmlFor="registrant-first-name">First Name</Label>
              <Input
                id="registrant-first-name"
                value={form.registrantFirstName}
                onChange={(event) => setForm((prev) => ({ ...prev, registrantFirstName: event.target.value }))}
                className={invalidFieldClass(Boolean(errors.registrantFirstName))}
              />
              <FieldError message={errors.registrantFirstName} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="registrant-last-name">Last Name</Label>
              <Input
                id="registrant-last-name"
                value={form.registrantLastName}
                onChange={(event) => setForm((prev) => ({ ...prev, registrantLastName: event.target.value }))}
                className={invalidFieldClass(Boolean(errors.registrantLastName))}
              />
              <FieldError message={errors.registrantLastName} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="registrant-org">Organization</Label>
              <Input
                id="registrant-org"
                value={form.registrantOrganizationName}
                onChange={(event) => setForm((prev) => ({ ...prev, registrantOrganizationName: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="registrant-email">Email</Label>
              <Input
                id="registrant-email"
                value={form.registrantEmailAddress}
                onChange={(event) => setForm((prev) => ({ ...prev, registrantEmailAddress: event.target.value }))}
                className={invalidFieldClass(Boolean(errors.registrantEmailAddress))}
              />
              <FieldError message={errors.registrantEmailAddress} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="registrant-phone">Phone</Label>
              <Input
                id="registrant-phone"
                value={form.registrantPhone}
                onChange={(event) => setForm((prev) => ({ ...prev, registrantPhone: event.target.value }))}
                placeholder="+1.5555555555"
                className={invalidFieldClass(Boolean(errors.registrantPhone))}
              />
              <FieldError message={errors.registrantPhone} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="registrant-country">Country</Label>
              <Input
                id="registrant-country"
                value={form.registrantCountry}
                onChange={(event) => setForm((prev) => ({ ...prev, registrantCountry: event.target.value }))}
                placeholder="US"
                className={invalidFieldClass(Boolean(errors.registrantCountry))}
              />
              <FieldError message={errors.registrantCountry} />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="registrant-address1">Address</Label>
              <Input
                id="registrant-address1"
                value={form.registrantAddress1}
                onChange={(event) => setForm((prev) => ({ ...prev, registrantAddress1: event.target.value }))}
                className={invalidFieldClass(Boolean(errors.registrantAddress1))}
              />
              <FieldError message={errors.registrantAddress1} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="registrant-city">City</Label>
              <Input
                id="registrant-city"
                value={form.registrantCity}
                onChange={(event) => setForm((prev) => ({ ...prev, registrantCity: event.target.value }))}
                className={invalidFieldClass(Boolean(errors.registrantCity))}
              />
              <FieldError message={errors.registrantCity} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="registrant-state">State / Province</Label>
              <Input
                id="registrant-state"
                value={form.registrantStateProvince}
                onChange={(event) => setForm((prev) => ({ ...prev, registrantStateProvince: event.target.value }))}
                className={invalidFieldClass(Boolean(errors.registrantStateProvince))}
              />
              <FieldError message={errors.registrantStateProvince} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="registrant-postal">Postal Code</Label>
              <Input
                id="registrant-postal"
                value={form.registrantPostalCode}
                onChange={(event) => setForm((prev) => ({ ...prev, registrantPostalCode: event.target.value }))}
                className={invalidFieldClass(Boolean(errors.registrantPostalCode))}
              />
              <FieldError message={errors.registrantPostalCode} />
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 md:grid-cols-3">
          <div className="md:col-span-3 text-sm font-semibold">Customer.io</div>
          <div className="grid gap-2">
            <Label htmlFor="cio-site-id">Site ID</Label>
            <Input
              id="cio-site-id"
              value={form.customerIoSiteId}
              onChange={(event) => setForm((prev) => ({ ...prev, customerIoSiteId: event.target.value }))}
              className={invalidFieldClass(Boolean(errors.customerIoSiteId))}
            />
            <FieldError message={errors.customerIoSiteId} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cio-track-key">Tracking API Key</Label>
            <Input
              id="cio-track-key"
              type="password"
              value={form.customerIoTrackingApiKey}
              onChange={(event) => setForm((prev) => ({ ...prev, customerIoTrackingApiKey: event.target.value }))}
              className={invalidFieldClass(Boolean(errors.customerIoTrackingApiKey))}
            />
            <FieldError message={errors.customerIoTrackingApiKey} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cio-app-key">App API Key</Label>
            <Input
              id="cio-app-key"
              type="password"
              value={form.customerIoAppApiKey}
              onChange={(event) => setForm((prev) => ({ ...prev, customerIoAppApiKey: event.target.value }))}
              placeholder="Optional but recommended"
            />
            <div className="text-[11px] text-[color:var(--muted-foreground)]">
              Used to bootstrap sender identities and try to fetch DNS records automatically.
            </div>
          </div>
        </div>

        <div className="grid gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 md:grid-cols-4">
          <div className="md:col-span-4 text-sm font-semibold">Namecheap</div>
          <div className="grid gap-2">
            <Label htmlFor="nc-api-user">API User</Label>
            <Input
              id="nc-api-user"
              value={form.namecheapApiUser}
              onChange={(event) => setForm((prev) => ({ ...prev, namecheapApiUser: event.target.value }))}
              className={invalidFieldClass(Boolean(errors.namecheapApiUser))}
            />
            <FieldError message={errors.namecheapApiUser} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nc-username">User Name</Label>
            <Input
              id="nc-username"
              value={form.namecheapUserName}
              onChange={(event) => setForm((prev) => ({ ...prev, namecheapUserName: event.target.value }))}
              placeholder="Optional if same as API User"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nc-api-key">API Key</Label>
            <Input
              id="nc-api-key"
              type="password"
              value={form.namecheapApiKey}
              onChange={(event) => setForm((prev) => ({ ...prev, namecheapApiKey: event.target.value }))}
              className={invalidFieldClass(Boolean(errors.namecheapApiKey))}
            />
            <FieldError message={errors.namecheapApiKey} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nc-client-ip">Whitelisted Client IP</Label>
            <Input
              id="nc-client-ip"
              value={form.namecheapClientIp}
              onChange={(event) => setForm((prev) => ({ ...prev, namecheapClientIp: event.target.value }))}
              className={invalidFieldClass(Boolean(errors.namecheapClientIp))}
            />
            <FieldError message={errors.namecheapClientIp} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label className="flex items-center gap-2 text-sm font-normal">
            <input
              type="checkbox"
              checked={form.assignToBrand}
              onChange={(event) => setForm((prev) => ({ ...prev, assignToBrand: event.target.checked }))}
            />
            Auto-assign this delivery account to the selected brand
          </Label>
          <Button
            type="button"
            disabled={saving || !brands.length}
            onClick={async () => {
              if (!validate()) return;
              setSaving(true);
              setError("");
              setResult(null);
              try {
                const provisioned = await provisionSenderDomain(form.brandId, {
                  accountName: form.accountName.trim(),
                  assignToBrand: form.assignToBrand,
                  selectedMailboxAccountId: form.selectedMailboxAccountId,
                  domainMode: form.domainMode,
                  domain: form.domain.trim(),
                  fromLocalPart: form.fromLocalPart.trim(),
                  customerIoSiteId: form.customerIoSiteId.trim(),
                  customerIoTrackingApiKey: form.customerIoTrackingApiKey.trim(),
                  customerIoAppApiKey: form.customerIoAppApiKey.trim(),
                  namecheapApiUser: form.namecheapApiUser.trim(),
                  namecheapUserName: form.namecheapUserName.trim(),
                  namecheapApiKey: form.namecheapApiKey.trim(),
                  namecheapClientIp: form.namecheapClientIp.trim(),
                  registrant:
                    form.domainMode === "register"
                      ? {
                          firstName: form.registrantFirstName.trim(),
                          lastName: form.registrantLastName.trim(),
                          organizationName: form.registrantOrganizationName.trim(),
                          emailAddress: form.registrantEmailAddress.trim(),
                          phone: form.registrantPhone.trim(),
                          address1: form.registrantAddress1.trim(),
                          city: form.registrantCity.trim(),
                          stateProvince: form.registrantStateProvince.trim(),
                          postalCode: form.registrantPostalCode.trim(),
                          country: form.registrantCountry.trim(),
                        }
                      : undefined,
                });
                setResult(provisioned);
                onProvisioned(provisioned);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Provisioning failed");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Provisioning..." : "Provision Sender"}
          </Button>
        </div>

        {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

        {result ? (
          <div
            className={`rounded-xl border p-3 text-sm ${
              result.readyToSend
                ? "border-[color:var(--success-border)] bg-[color:var(--success-soft)]"
                : "border-[color:var(--border)] bg-[color:var(--surface-muted)]"
            }`}
          >
            <div className="font-semibold">
              {result.readyToSend ? "Sender is ready" : "Sender provisioned with follow-up needed"}
            </div>
            <div className="mt-1 text-[color:var(--muted-foreground)]">
              {result.fromEmail} · Namecheap records applied: {result.namecheap.appliedRecordCount} · Customer.io
              identity: {result.customerIo.senderIdentityStatus}
            </div>
            {result.warnings.length ? (
              <div className="mt-2 space-y-1 text-xs text-[color:var(--muted-foreground)]">
                {result.warnings.map((warning) => (
                  <div key={warning}>• {warning}</div>
                ))}
              </div>
            ) : null}
            {result.nextSteps.length ? (
              <div className="mt-2 space-y-1 text-xs text-[color:var(--muted-foreground)]">
                {result.nextSteps.map((step) => (
                  <div key={step}>• {step}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
