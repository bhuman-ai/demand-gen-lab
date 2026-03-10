"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  fetchSavedNamecheapDomains,
  provisionSenderDomain,
} from "@/lib/client-api";
import {
  buildCustomerIoCapacityPools,
  findBestCustomerIoCapacityPool,
  type CustomerIoCapacityPool,
} from "@/lib/outreach-customerio-capacity";
import type { BrandRecord, OutreachAccount, OutreachProvisioningSettings } from "@/lib/factory-types";

type AssignmentMap = Record<
  string,
  {
    accountId: string;
    mailboxAccountId: string;
  }
>;

type ProvisionResult = Awaited<ReturnType<typeof provisionSenderDomain>>;

type CustomerIoStrategy = "auto" | "specific" | "defaults";

type SetupState = {
  brandId: string;
  fromLocalPart: string;
  assignToBrand: boolean;
  selectedMailboxAccountId: string;
  forwardingTargetUrl: string;
  accountName: string;
  customerIoStrategy: CustomerIoStrategy;
  customerIoSourceAccountId: string;
  customerIoSiteId: string;
  customerIoTrackingApiKey: string;
  customerIoAppApiKey: string;
};

type RegisterState = {
  domain: string;
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

type NamecheapInventoryItem = Awaited<ReturnType<typeof fetchSavedNamecheapDomains>>["domains"][number];

const INITIAL_SETUP: SetupState = {
  brandId: "",
  fromLocalPart: "hello",
  assignToBrand: true,
  selectedMailboxAccountId: "",
  forwardingTargetUrl: "",
  accountName: "",
  customerIoStrategy: "auto",
  customerIoSourceAccountId: "",
  customerIoSiteId: "",
  customerIoTrackingApiKey: "",
  customerIoAppApiKey: "",
};

const INITIAL_REGISTER: RegisterState = {
  domain: "",
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

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function formatDateLabel(value: string) {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function CapacityBar({ ratio }: { ratio: number }) {
  const width = `${Math.max(0, Math.min(100, Math.round(ratio * 100)))}%`;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface)]">
      <div
        className="h-full rounded-full bg-[color:var(--accent)] transition-[width]"
        style={{ width }}
      />
    </div>
  );
}

function PoolCard({
  pool,
  selected,
  disabled,
  onSelect,
}: {
  pool: CustomerIoCapacityPool;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const toneClass = pool.canProvision
    ? "border-[color:var(--border)] bg-[color:var(--surface-muted)]"
    : "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`grid gap-2 rounded-xl border p-3 text-left transition hover:border-[color:var(--accent)] ${
        selected ? "border-[color:var(--accent)] bg-[color:var(--surface)]" : toneClass
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{pool.sourceAccountName}</div>
          <div className="text-[11px] text-[color:var(--muted-foreground)]">
            Site {pool.siteId}
            {pool.senderCount > 1 ? ` · ${pool.senderCount} sender accounts` : ""}
          </div>
        </div>
        <div className="text-xs font-semibold">
          {pool.projectedProfiles.toLocaleString()}/{pool.monthlyProfileLimit.toLocaleString()}
        </div>
      </div>
      <CapacityBar ratio={pool.usageRatio} />
      <div className="flex flex-wrap gap-2 text-[11px] text-[color:var(--muted-foreground)]">
        <span>{pool.remainingProfiles.toLocaleString()} left this month</span>
        <span>Baseline: {pool.baselineReady ? "ready" : "waiting"}</span>
        {pool.lastTestAt ? <span>Last test: {pool.lastTestStatus}</span> : null}
      </div>
      {pool.fromEmailSamples.length ? (
        <div className="text-[11px] text-[color:var(--muted-foreground)]">
          Existing senders: {pool.fromEmailSamples.join(" · ")}
        </div>
      ) : null}
      {pool.warning ? <div className="text-[11px] text-[color:var(--muted-foreground)]">{pool.warning}</div> : null}
    </button>
  );
}

export default function SenderProvisionCard({
  brands,
  mailboxAccounts,
  customerIoAccounts,
  assignments,
  provisioningSettings,
  onProvisioned,
}: {
  brands: BrandRecord[];
  mailboxAccounts: OutreachAccount[];
  customerIoAccounts: OutreachAccount[];
  assignments: AssignmentMap;
  provisioningSettings: OutreachProvisioningSettings | null;
  onProvisioned: (result: ProvisionResult) => void;
}) {
  const [setup, setSetup] = useState<SetupState>(() => ({
    ...INITIAL_SETUP,
    brandId: brands[0]?.id ?? "",
    selectedMailboxAccountId: brands[0] ? assignments[brands[0].id]?.mailboxAccountId ?? "" : "",
    forwardingTargetUrl: brands[0]?.website ?? "",
  }));
  const [register, setRegister] = useState<RegisterState>(INITIAL_REGISTER);
  const [inventory, setInventory] = useState<{
    configured: boolean;
    loading: boolean;
    domains: NamecheapInventoryItem[];
    error: string;
  }>({
    configured: false,
    loading: true,
    domains: [],
    error: "",
  });
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ProvisionResult | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await fetchSavedNamecheapDomains();
        if (!active) return;
        setInventory({
          configured: next.configured,
          loading: false,
          domains: next.domains,
          error: "",
        });
      } catch (err) {
        if (!active) return;
        setInventory({
          configured: false,
          loading: false,
          domains: [],
          error: err instanceof Error ? err.message : "Failed to load Namecheap domains",
        });
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!brands.length) return;
    setSetup((prev) => {
      if (prev.brandId) return prev;
      return {
        ...prev,
        brandId: brands[0].id,
        selectedMailboxAccountId: assignments[brands[0].id]?.mailboxAccountId ?? "",
        forwardingTargetUrl: brands[0].website ?? "",
      };
    });
  }, [assignments, brands]);

  const selectedBrand = useMemo(
    () => brands.find((brand) => brand.id === setup.brandId) ?? null,
    [brands, setup.brandId]
  );
  const selectedMailbox = useMemo(
    () => mailboxAccounts.find((account) => account.id === setup.selectedMailboxAccountId) ?? null,
    [mailboxAccounts, setup.selectedMailboxAccountId]
  );
  const customerIoPools = useMemo(
    () => buildCustomerIoCapacityPools(customerIoAccounts),
    [customerIoAccounts]
  );
  const recommendedPool = useMemo(
    () => findBestCustomerIoCapacityPool(customerIoPools),
    [customerIoPools]
  );
  const selectedPool = useMemo(
    () => customerIoPools.find((pool) => pool.sourceAccountId === setup.customerIoSourceAccountId) ?? null,
    [customerIoPools, setup.customerIoSourceAccountId]
  );

  useEffect(() => {
    if (!recommendedPool) return;
    setSetup((prev) => {
      if (prev.customerIoSourceAccountId) return prev;
      return {
        ...prev,
        customerIoSourceAccountId: recommendedPool.sourceAccountId,
      };
    });
  }, [recommendedPool]);

  const domainOwnerByName = useMemo(() => {
    const map = new Map<string, { brandId: string; brandName: string }>();
    for (const brand of brands) {
      for (const domain of brand.domains) {
        const key = normalizeDomain(domain.domain);
        if (!key || map.has(key)) continue;
        map.set(key, {
          brandId: brand.id,
          brandName: brand.name,
        });
      }
    }
    return map;
  }, [brands]);

  const filteredDomains = useMemo(() => {
    const needle = inventoryQuery.trim().toLowerCase();
    if (!needle) return inventory.domains;
    return inventory.domains.filter((item) => item.domain.includes(needle));
  }, [inventory.domains, inventoryQuery]);

  const manualDefaultsReady =
    Boolean(setup.customerIoSiteId.trim() || provisioningSettings?.customerIo.siteId.trim()) &&
    Boolean(setup.customerIoTrackingApiKey.trim() || provisioningSettings?.customerIo.hasTrackingApiKey);

  const mailboxHint = selectedMailbox
    ? `Replies will route to ${selectedMailbox.config.mailbox.email || "the selected mailbox"}.`
    : assignments[setup.brandId]?.mailboxAccountId
      ? "The brand already has a reply mailbox assignment. Leave this alone to keep it."
      : "No reply mailbox selected yet. Setup will work, but launch preflight will still fail until you assign one.";

  function validateCommon() {
    if (!setup.brandId) {
      setError("Pick a brand first.");
      return false;
    }
    if (!setup.fromLocalPart.trim()) {
      setError("Sender local-part is required.");
      return false;
    }
    if (!inventory.configured) {
      setError("Save Namecheap credentials in provisioning settings before using one-click domain setup.");
      return false;
    }
    if (setup.customerIoStrategy === "specific") {
      if (!setup.customerIoSourceAccountId) {
        setError("Pick a specific Customer.io account.");
        return false;
      }
      if (selectedPool && !selectedPool.canProvision) {
        setError(selectedPool.warning || "The selected Customer.io account cannot take more profiles this month.");
        return false;
      }
    }
    if (setup.customerIoStrategy === "auto" && !recommendedPool) {
      if (customerIoPools.length) {
        setError("No Customer.io account has monthly profile capacity left right now. Pick a different account strategy.");
        return false;
      }
      if (!manualDefaultsReady) {
        setError("No Customer.io account with available capacity was found. Switch to a specific account or saved defaults.");
        return false;
      }
    }
    if (setup.customerIoStrategy === "defaults" && !manualDefaultsReady) {
      setError("Saved Customer.io defaults are incomplete. Either add an account above or enter the defaults here.");
      return false;
    }
    return true;
  }

  function validateRegistrant() {
    if (!register.domain.trim()) {
      setError("Enter a domain to buy.");
      return false;
    }
    const requiredFields = [
      register.registrantFirstName,
      register.registrantLastName,
      register.registrantEmailAddress,
      register.registrantPhone,
      register.registrantAddress1,
      register.registrantCity,
      register.registrantStateProvince,
      register.registrantPostalCode,
      register.registrantCountry,
    ];
    if (requiredFields.some((value) => !value.trim())) {
      setError("Registrant contact information is required to buy a new domain.");
      return false;
    }
    return true;
  }

  async function runProvision(domain: string, domainMode: "existing" | "register") {
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedDomain || !normalizedDomain.includes(".")) {
      setError("Pick a valid domain.");
      return;
    }
    if (!validateCommon()) return;
    if (domainMode === "register" && !validateRegistrant()) return;

    setBusyKey(`${domainMode}:${normalizedDomain}`);
    setError("");
    setResult(null);

    try {
      const provisioned = await provisionSenderDomain(setup.brandId, {
        accountName: setup.accountName.trim() || `${selectedBrand?.name ?? "Brand"} ${normalizedDomain}`,
        assignToBrand: setup.assignToBrand,
        selectedMailboxAccountId: setup.selectedMailboxAccountId,
        domainMode,
        domain: normalizedDomain,
        fromLocalPart: setup.fromLocalPart.trim(),
        autoPickCustomerIoAccount: setup.customerIoStrategy === "auto",
        customerIoSourceAccountId:
          setup.customerIoStrategy === "specific" ? setup.customerIoSourceAccountId : "",
        forwardingTargetUrl: setup.forwardingTargetUrl.trim(),
        customerIoSiteId: setup.customerIoStrategy === "defaults" ? setup.customerIoSiteId.trim() : "",
        customerIoTrackingApiKey:
          setup.customerIoStrategy === "defaults" ? setup.customerIoTrackingApiKey.trim() : "",
        customerIoAppApiKey: setup.customerIoStrategy === "defaults" ? setup.customerIoAppApiKey.trim() : "",
        namecheapApiUser: "",
        namecheapUserName: "",
        namecheapApiKey: "",
        namecheapClientIp: "",
        registrant:
          domainMode === "register"
            ? {
                firstName: register.registrantFirstName.trim(),
                lastName: register.registrantLastName.trim(),
                organizationName: register.registrantOrganizationName.trim(),
                emailAddress: register.registrantEmailAddress.trim(),
                phone: register.registrantPhone.trim(),
                address1: register.registrantAddress1.trim(),
                city: register.registrantCity.trim(),
                stateProvince: register.registrantStateProvince.trim(),
                postalCode: register.registrantPostalCode.trim(),
                country: register.registrantCountry.trim(),
              }
            : undefined,
      });

      setResult(provisioned);
      onProvisioned(provisioned);
      if (domainMode === "register") {
        setRegister(INITIAL_REGISTER);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Domain setup failed");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Brand Domain Setup</CardTitle>
        <CardDescription>
          Pick a brand, choose a Namecheap domain, forward it to the protected brand site, and attach it to the
          Customer.io account with room this month.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="grid gap-2">
            <Label htmlFor="setup-brand">Brand</Label>
            <Select
              id="setup-brand"
              value={setup.brandId}
              onChange={(event) => {
                const brandId = event.target.value;
                const brand = brands.find((item) => item.id === brandId) ?? null;
                setSetup((prev) => ({
                  ...prev,
                  brandId,
                  selectedMailboxAccountId: assignments[brandId]?.mailboxAccountId ?? "",
                  forwardingTargetUrl: brand?.website ?? "",
                }));
              }}
            >
              <option value="">Select brand</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="setup-local-part">Sender Local-Part</Label>
            <Input
              id="setup-local-part"
              value={setup.fromLocalPart}
              onChange={(event) => setSetup((prev) => ({ ...prev, fromLocalPart: event.target.value }))}
              placeholder="hello"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="setup-mailbox">Reply Mailbox</Label>
            <Select
              id="setup-mailbox"
              value={setup.selectedMailboxAccountId}
              onChange={(event) => setSetup((prev) => ({ ...prev, selectedMailboxAccountId: event.target.value }))}
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
            <Label htmlFor="setup-account-name">Sender Account Name</Label>
            <Input
              id="setup-account-name"
              value={setup.accountName}
              onChange={(event) => setSetup((prev) => ({ ...prev, accountName: event.target.value }))}
              placeholder={selectedBrand ? `${selectedBrand.name} sender` : "Optional"}
            />
          </div>
        </div>

        <div className="grid gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="grid gap-2">
            <Label htmlFor="setup-forwarding-target">Protected Brand Destination</Label>
            <Input
              id="setup-forwarding-target"
              value={setup.forwardingTargetUrl}
              onChange={(event) => setSetup((prev) => ({ ...prev, forwardingTargetUrl: event.target.value }))}
              placeholder="https://brand.com"
            />
            <div className="text-[11px] text-[color:var(--muted-foreground)]">
              Every sender domain can 301 here so the protected brand domain stays the main destination and never has to
              send email itself.
            </div>
          </div>
          <Label className="flex items-center gap-2 text-sm font-normal">
            <input
              type="checkbox"
              checked={setup.assignToBrand}
              onChange={(event) => setSetup((prev) => ({ ...prev, assignToBrand: event.target.checked }))}
            />
            Auto-assign sender to brand
          </Label>
        </div>

        <div className="grid gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Customer.io Capacity</div>
              <div className="text-[11px] text-[color:var(--muted-foreground)]">
                Auto-pick will choose the account with baseline sync complete and the most remaining profiles.
              </div>
            </div>
            <Select
              value={setup.customerIoStrategy}
              onChange={(event) =>
                setSetup((prev) => ({
                  ...prev,
                  customerIoStrategy:
                    event.target.value === "specific"
                      ? "specific"
                      : event.target.value === "defaults"
                        ? "defaults"
                        : "auto",
                }))
              }
              className="w-full max-w-xs"
            >
              <option value="auto">Auto-pick best account</option>
              <option value="specific">Choose a specific account</option>
              <option value="defaults">Use saved defaults</option>
            </Select>
          </div>

          {customerIoPools.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {customerIoPools.map((pool) => (
                <PoolCard
                  key={pool.id}
                  pool={pool}
                  selected={setup.customerIoSourceAccountId === pool.sourceAccountId}
                  disabled={setup.customerIoStrategy !== "specific"}
                  onSelect={() =>
                    setSetup((prev) => ({
                      ...prev,
                      customerIoSourceAccountId: pool.sourceAccountId,
                    }))
                  }
                />
              ))}
            </div>
          ) : (
            <div className="text-sm text-[color:var(--muted-foreground)]">
              No Customer.io sender accounts exist yet. Add one above or use saved defaults below.
            </div>
          )}

          {setup.customerIoStrategy === "auto" && recommendedPool ? (
            <div className="rounded-xl border border-[color:var(--success-border)] bg-[color:var(--success-soft)] px-3 py-2 text-sm text-[color:var(--success)]">
              Auto-pick target: {recommendedPool.sourceAccountName} with{" "}
              {recommendedPool.remainingProfiles.toLocaleString()} profiles left this month.
            </div>
          ) : null}

          {setup.customerIoStrategy === "defaults" ? (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="setup-default-site-id">Customer.io Site ID</Label>
                <Input
                  id="setup-default-site-id"
                  value={setup.customerIoSiteId}
                  onChange={(event) => setSetup((prev) => ({ ...prev, customerIoSiteId: event.target.value }))}
                  placeholder={provisioningSettings?.customerIo.siteId || "Saved default"}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="setup-default-track-key">Tracking API Key</Label>
                <Input
                  id="setup-default-track-key"
                  type="password"
                  value={setup.customerIoTrackingApiKey}
                  onChange={(event) =>
                    setSetup((prev) => ({ ...prev, customerIoTrackingApiKey: event.target.value }))
                  }
                  placeholder={provisioningSettings?.customerIo.hasTrackingApiKey ? "Leave blank to use saved key" : ""}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="setup-default-app-key">App API Key</Label>
                <Input
                  id="setup-default-app-key"
                  type="password"
                  value={setup.customerIoAppApiKey}
                  onChange={(event) => setSetup((prev) => ({ ...prev, customerIoAppApiKey: event.target.value }))}
                  placeholder={provisioningSettings?.customerIo.hasAppApiKey ? "Leave blank to use saved key" : "Optional"}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Namecheap Inventory</div>
              <div className="text-[11px] text-[color:var(--muted-foreground)]">
                One click will connect the domain, apply forwarding, and create the sender inside Customer.io.
              </div>
            </div>
            <Input
              value={inventoryQuery}
              onChange={(event) => setInventoryQuery(event.target.value)}
              placeholder="Filter domains"
              className="w-full max-w-xs"
            />
          </div>

          {inventory.loading ? (
            <div className="text-sm text-[color:var(--muted-foreground)]">Loading Namecheap domains...</div>
          ) : null}
          {inventory.error ? <div className="text-sm text-[color:var(--danger)]">{inventory.error}</div> : null}
          {!inventory.loading && !inventory.configured ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-sm">
              Save platform Namecheap credentials above first. Once that is done, this section will list every owned
              domain with a setup button.
            </div>
          ) : null}

          {inventory.configured ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredDomains.map((item) => {
                const owner = domainOwnerByName.get(item.domain) ?? null;
                const alreadyOnThisBrand = owner?.brandId === setup.brandId;
                const assignedElsewhere = owner && owner.brandId !== setup.brandId;
                const key = `existing:${item.domain}`;

                return (
                  <div
                    key={item.domain}
                    className={`grid gap-3 rounded-xl border p-3 ${
                      assignedElsewhere
                        ? "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]"
                        : "border-[color:var(--border)] bg-[color:var(--surface-muted)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{item.domain}</div>
                        <div className="text-[11px] text-[color:var(--muted-foreground)]">
                          Expires {formatDateLabel(item.expiresAt)}
                        </div>
                      </div>
                      <div className="text-[11px] text-[color:var(--muted-foreground)]">
                        {item.autoRenew ? "Auto-renew" : "Manual renew"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-[color:var(--muted-foreground)]">
                      <span>{item.isOurDns ? "Namecheap DNS" : "External DNS"}</span>
                      <span>{item.whoisGuardEnabled ? "WhoisGuard on" : "WhoisGuard off"}</span>
                    </div>
                    {assignedElsewhere ? (
                      <div className="text-[11px] text-[color:var(--muted-foreground)]">
                        Already attached to {owner.brandName}.
                      </div>
                    ) : alreadyOnThisBrand ? (
                      <div className="text-[11px] text-[color:var(--muted-foreground)]">
                        Already on this brand. Re-run setup to refresh DNS and forwarding.
                      </div>
                    ) : null}
                    <Button
                      type="button"
                      disabled={Boolean(busyKey) || Boolean(assignedElsewhere)}
                      onClick={() => void runProvision(item.domain, "existing")}
                    >
                      {busyKey === key ? "Setting Up..." : alreadyOnThisBrand ? "Re-run Setup" : "Set Up"}
                    </Button>
                  </div>
                );
              })}
              {!filteredDomains.length ? (
                <div className="text-sm text-[color:var(--muted-foreground)]">No domains found.</div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
          <div>
            <div className="text-sm font-semibold">Buy New Domain + Set Up</div>
            <div className="text-[11px] text-[color:var(--muted-foreground)]">
              If the domain is available in Namecheap, this will buy it and run the same setup flow automatically.
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="register-domain">Domain</Label>
              <Input
                id="register-domain"
                value={register.domain}
                onChange={(event) => setRegister((prev) => ({ ...prev, domain: event.target.value }))}
                placeholder="example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="register-first-name">First Name</Label>
              <Input
                id="register-first-name"
                value={register.registrantFirstName}
                onChange={(event) => setRegister((prev) => ({ ...prev, registrantFirstName: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="register-last-name">Last Name</Label>
              <Input
                id="register-last-name"
                value={register.registrantLastName}
                onChange={(event) => setRegister((prev) => ({ ...prev, registrantLastName: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="register-org">Organization</Label>
              <Input
                id="register-org"
                value={register.registrantOrganizationName}
                onChange={(event) =>
                  setRegister((prev) => ({ ...prev, registrantOrganizationName: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="register-email">Email</Label>
              <Input
                id="register-email"
                value={register.registrantEmailAddress}
                onChange={(event) =>
                  setRegister((prev) => ({ ...prev, registrantEmailAddress: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="register-phone">Phone</Label>
              <Input
                id="register-phone"
                value={register.registrantPhone}
                onChange={(event) => setRegister((prev) => ({ ...prev, registrantPhone: event.target.value }))}
                placeholder="+1.5555555555"
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="register-address">Address</Label>
              <Input
                id="register-address"
                value={register.registrantAddress1}
                onChange={(event) => setRegister((prev) => ({ ...prev, registrantAddress1: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="register-city">City</Label>
              <Input
                id="register-city"
                value={register.registrantCity}
                onChange={(event) => setRegister((prev) => ({ ...prev, registrantCity: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="register-state">State / Province</Label>
              <Input
                id="register-state"
                value={register.registrantStateProvince}
                onChange={(event) =>
                  setRegister((prev) => ({ ...prev, registrantStateProvince: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="register-postal">Postal Code</Label>
              <Input
                id="register-postal"
                value={register.registrantPostalCode}
                onChange={(event) =>
                  setRegister((prev) => ({ ...prev, registrantPostalCode: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="register-country">Country</Label>
              <Input
                id="register-country"
                value={register.registrantCountry}
                onChange={(event) => setRegister((prev) => ({ ...prev, registrantCountry: event.target.value }))}
                placeholder="US"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={Boolean(busyKey)}
              onClick={() => void runProvision(register.domain, "register")}
            >
              {busyKey === `register:${normalizeDomain(register.domain)}` ? "Buying + Setting Up..." : "Buy + Set Up"}
            </Button>
          </div>
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
              {result.fromEmail} · Customer.io: {result.customerIo.sourceAccountName} · Forwarding:{" "}
              {result.namecheap.forwardingEnabled ? result.namecheap.forwardingTargetUrl : "not set"}
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
