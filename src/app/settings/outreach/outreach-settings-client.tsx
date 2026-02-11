"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  assignBrandOutreachAccount,
  createOutreachAccountApi,
  fetchBrandOutreachAssignment,
  fetchBrands,
  fetchOutreachAccounts,
  testOutreachAccount,
  updateOutreachAccountApi,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, OutreachAccount } from "@/lib/factory-types";

type AssignmentChoice = {
  accountId: string;
  mailboxAccountId: string;
};

type AssignmentMap = Record<string, AssignmentChoice>;

type FormState = {
  name: string;
  accountType: "delivery" | "mailbox" | "hybrid";
  siteId: string;
  workspaceId: string;
  defaultActorId: string;
  mailboxProvider: "gmail" | "outlook" | "imap";
  mailboxEmail: string;
  mailboxHost: string;
  mailboxPort: string;
  mailboxSecure: boolean;
  customerIoApiKey: string;
  apifyToken: string;
  mailboxAccessToken: string;
  mailboxRefreshToken: string;
  mailboxPassword: string;
};

const INITIAL_FORM: FormState = {
  name: "",
  accountType: "hybrid",
  siteId: "",
  workspaceId: "",
  defaultActorId: "",
  mailboxProvider: "gmail",
  mailboxEmail: "",
  mailboxHost: "imap.gmail.com",
  mailboxPort: "993",
  mailboxSecure: true,
  customerIoApiKey: "",
  apifyToken: "",
  mailboxAccessToken: "",
  mailboxRefreshToken: "",
  mailboxPassword: "",
};

const MAILBOX_PROVIDER_DEFAULTS: Record<
  FormState["mailboxProvider"],
  { host: string; port: string; secure: boolean }
> = {
  gmail: {
    host: "imap.gmail.com",
    port: "993",
    secure: true,
  },
  outlook: {
    host: "outlook.office365.com",
    port: "993",
    secure: true,
  },
  imap: {
    host: "",
    port: "993",
    secure: true,
  },
};

function InfoHint({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group">
      <span
        tabIndex={0}
        aria-label="Field help"
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[color:var(--border)] text-[10px] font-semibold text-[color:var(--muted-foreground)] outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
      >
        i
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

function FieldLabel({ htmlFor, label, help }: { htmlFor: string; label: string; help: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      <InfoHint text={help} />
    </div>
  );
}

export default function OutreachSettingsClient() {
  const [accounts, setAccounts] = useState<OutreachAccount[]>([]);
  const [brands, setBrands] = useState<BrandRecord[]>([]);
  const [assignments, setAssignments] = useState<AssignmentMap>({});
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const [accountsRows, brandRows] = await Promise.all([fetchOutreachAccounts(), fetchBrands()]);
        if (!mounted) return;
        setAccounts(accountsRows);
        setBrands(brandRows);

        const assignmentPairs = await Promise.all(
          brandRows.map(async (brand) => {
            const row = await fetchBrandOutreachAssignment(brand.id);
            return {
              brandId: brand.id,
              accountId: row.assignment?.accountId ?? "",
              mailboxAccountId: row.assignment?.mailboxAccountId ?? "",
            };
          })
        );
        if (!mounted) return;
        const map: AssignmentMap = {};
        for (const row of assignmentPairs) {
          map[row.brandId] = {
            accountId: row.accountId,
            mailboxAccountId: row.mailboxAccountId,
          };
        }
        setAssignments(map);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load outreach settings");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const activeCount = useMemo(
    () => accounts.filter((account) => account.status === "active").length,
    [accounts]
  );
  const deliveryCapableAccounts = useMemo(
    () => accounts.filter((account) => account.accountType !== "mailbox"),
    [accounts]
  );
  const mailboxCapableAccounts = useMemo(
    () => accounts.filter((account) => account.accountType !== "delivery"),
    [accounts]
  );
  const showDeliveryFields = form.accountType !== "mailbox";
  const showMailboxFields = form.accountType !== "delivery";

  const createAccount = async () => {
    setSaving(true);
    setError("");
    try {
      const mailboxConnected = Boolean(
        form.mailboxEmail.trim() && (form.mailboxAccessToken.trim() || form.mailboxPassword.trim())
      );
      const created = await createOutreachAccountApi({
        name: form.name.trim(),
        accountType: form.accountType,
        status: "active",
        config: {
          customerIo: {
            siteId: form.siteId,
            workspaceId: form.workspaceId,
          },
          apify: {
            defaultActorId: form.defaultActorId,
          },
          mailbox: {
            provider: form.mailboxProvider,
            email: form.mailboxEmail,
            host: form.mailboxHost,
            port: Number(form.mailboxPort || 993),
            secure: form.mailboxSecure,
            status: mailboxConnected ? "connected" : "disconnected",
          },
        },
        credentials: {
          customerIoApiKey: form.customerIoApiKey,
          apifyToken: form.apifyToken,
          mailboxAccessToken: form.mailboxAccessToken,
          mailboxRefreshToken: form.mailboxRefreshToken,
          mailboxPassword: form.mailboxPassword,
        },
      });
      setAccounts((prev) => [created, ...prev]);
      setForm(INITIAL_FORM);
      trackEvent("outreach_account_connected", { accountId: created.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setSaving(false);
    }
  };

  const onAssign = async (brandId: string, patch: Partial<AssignmentChoice>) => {
    const current = assignments[brandId] ?? { accountId: "", mailboxAccountId: "" };
    const next = { ...current, ...patch };
    setAssignments((prev) => ({ ...prev, [brandId]: next }));
    try {
      await assignBrandOutreachAccount(brandId, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign account");
    }
  };

  const setProviderWithDefaults = (provider: FormState["mailboxProvider"]) => {
    const defaults = MAILBOX_PROVIDER_DEFAULTS[provider];
    setForm((prev) => ({
      ...prev,
      mailboxProvider: provider,
      mailboxHost: defaults.host,
      mailboxPort: defaults.port,
      mailboxSecure: defaults.secure,
    }));
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Outreach Automation Settings</CardTitle>
          <CardDescription>
            Manage delivery stacks and reply mailbox accounts, then assign both per brand.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Accounts</div>
            <div className="text-lg font-semibold">{accounts.length}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Active Accounts</div>
            <div className="text-lg font-semibold">{activeCount}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Brands</div>
            <div className="text-lg font-semibold">{brands.length}</div>
          </div>
        </CardContent>
      </Card>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
      {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading outreach settings...</div> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Account</CardTitle>
          <CardDescription>
            Store one reusable outbound stack and map it to brands.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="account-name"
              label="Account Name"
              help="Internal nickname for this credential bundle. Pick any clear name, like US Outbound Stack."
            />
            <Input
              id="account-name"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Main Outbound"
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="account-type"
              label="Account Type"
              help="Choose what this account is used for: Delivery (Customer.io + Apify), Reply Mailbox (inbox sync/replies), or Hybrid (both)."
            />
            <Select
              id="account-type"
              value={form.accountType}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  accountType: event.target.value as FormState["accountType"],
                }))
              }
            >
              <option value="hybrid">hybrid (delivery + mailbox)</option>
              <option value="delivery">delivery only</option>
              <option value="mailbox">reply mailbox only</option>
            </Select>
          </div>
          {showDeliveryFields ? (
            <>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="account-site-id"
                  label="Customer.io Site ID"
                  help="Site ID used with your API key for Customer.io event sends. Find it in Customer.io Settings > API Credentials."
                />
                <Input
                  id="account-site-id"
                  value={form.siteId}
                  onChange={(event) => setForm((prev) => ({ ...prev, siteId: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="account-workspace-id"
                  label="Customer.io Workspace"
                  help="Workspace identifier (often from the Customer.io workspace URL or workspace settings)."
                />
                <Input
                  id="account-workspace-id"
                  value={form.workspaceId}
                  onChange={(event) => setForm((prev) => ({ ...prev, workspaceId: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="account-actor-id"
                  label="Default Apify Actor ID"
                  help="Fallback actor used for lead sourcing when a hypothesis does not provide one."
                />
                <Input
                  id="account-actor-id"
                  value={form.defaultActorId}
                  onChange={(event) => setForm((prev) => ({ ...prev, defaultActorId: event.target.value }))}
                  placeholder="apify/actor-name"
                />
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="account-customerio-api-key"
                  label="Customer.io API Key"
                  help="API key used for Customer.io event dispatch. Create it under Customer.io Settings > API Credentials."
                />
                <Input
                  id="account-customerio-api-key"
                  type="password"
                  value={form.customerIoApiKey}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, customerIoApiKey: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="account-apify-token"
                  label="Apify Token"
                  help="Personal Apify API token used to run actors. Find it in Apify Console > Settings > API."
                />
                <Input
                  id="account-apify-token"
                  type="password"
                  value={form.apifyToken}
                  onChange={(event) => setForm((prev) => ({ ...prev, apifyToken: event.target.value }))}
                />
              </div>
            </>
          ) : null}
          {showMailboxFields ? (
            <>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="mailbox-provider"
                  label="Mailbox Provider"
                  help="Mailbox provider for reply sync. Gmail/Outlook auto-fill IMAP defaults; IMAP lets you enter custom host/port."
                />
                <Select
                  id="mailbox-provider"
                  value={form.mailboxProvider}
                  onChange={(event) =>
                    setProviderWithDefaults(event.target.value as FormState["mailboxProvider"])
                  }
                >
                  <option value="gmail">gmail</option>
                  <option value="outlook">outlook</option>
                  <option value="imap">imap</option>
                </Select>
                <div className="text-[11px] text-[color:var(--muted-foreground)]">
                  Host and port auto-fill based on provider.
                </div>
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="mailbox-email"
                  label="Mailbox Email"
                  help="Mailbox used for reply threading and drafted responses, for example sdr@yourdomain.com."
                />
                <Input
                  id="mailbox-email"
                  value={form.mailboxEmail}
                  onChange={(event) => setForm((prev) => ({ ...prev, mailboxEmail: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="mailbox-host"
                  label="Mailbox Host"
                  help="IMAP server hostname (for example imap.gmail.com or outlook.office365.com)."
                />
                <Input
                  id="mailbox-host"
                  value={form.mailboxHost}
                  onChange={(event) => setForm((prev) => ({ ...prev, mailboxHost: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="mailbox-port"
                  label="Mailbox Port"
                  help="IMAP port number, typically 993 for SSL/TLS."
                />
                <Input
                  id="mailbox-port"
                  value={form.mailboxPort}
                  onChange={(event) => setForm((prev) => ({ ...prev, mailboxPort: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="mailbox-access-token"
                  label="Mailbox Access Token"
                  help="OAuth access token for Gmail/Outlook mailbox auth, issued after your OAuth consent flow."
                />
                <Input
                  id="mailbox-access-token"
                  type="password"
                  value={form.mailboxAccessToken}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, mailboxAccessToken: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="mailbox-refresh-token"
                  label="Mailbox Refresh Token"
                  help="OAuth refresh token used to rotate access tokens without re-login."
                />
                <Input
                  id="mailbox-refresh-token"
                  type="password"
                  value={form.mailboxRefreshToken}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, mailboxRefreshToken: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="mailbox-password"
                  label="Mailbox Password"
                  help="IMAP password or app password (recommended) for non-OAuth mailbox auth."
                />
                <Input
                  id="mailbox-password"
                  type="password"
                  value={form.mailboxPassword}
                  onChange={(event) => setForm((prev) => ({ ...prev, mailboxPassword: event.target.value }))}
                />
              </div>
            </>
          ) : null}
          <div className="md:col-span-2 flex justify-end">
            <Button
              type="button"
              disabled={saving || !form.name.trim()}
              onClick={createAccount}
            >
              {saving ? "Saving..." : "Create Outreach Account"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accounts</CardTitle>
          <CardDescription>Validate and maintain account health before enabling autopilot.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{account.name}</div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    Type: {account.accountType} · Provider: {account.provider} · Mailbox:{" "}
                    {account.config.mailbox.email || "not set"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      setError("");
                      try {
                        const result = await testOutreachAccount(account.id);
                        trackEvent("outreach_account_tested", {
                          accountId: account.id,
                          ok: result.ok,
                        });
                        const refreshed = await fetchOutreachAccounts();
                        setAccounts(refreshed);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Account test failed");
                      }
                    }}
                  >
                    Test
                  </Button>
                  <Select
                    value={account.status}
                    onChange={async (event) => {
                      const status = event.target.value === "inactive" ? "inactive" : "active";
                      const updated = await updateOutreachAccountApi(account.id, { status });
                      setAccounts((prev) => prev.map((row) => (row.id === account.id ? updated : row)));
                    }}
                  >
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </Select>
                </div>
              </div>
              <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                Last test: {account.lastTestAt ? `${account.lastTestStatus} · ${account.lastTestAt}` : "never"}
              </div>
            </div>
          ))}
          {!accounts.length ? (
            <div className="text-sm text-[color:var(--muted-foreground)]">
              No outreach accounts configured yet.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brand Assignments</CardTitle>
          <CardDescription>
            Choose one delivery account and one reply mailbox account per brand.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {brands.map((brand) => {
            const assignment = assignments[brand.id] ?? {
              accountId: "",
              mailboxAccountId: "",
            };
            return (
              <div
                key={brand.id}
                className="grid gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 md:grid-cols-[1fr_260px_260px] md:items-center"
              >
                <div>
                  <div className="text-sm font-semibold">{brand.name}</div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">{brand.website}</div>
                </div>
                <div className="grid gap-1">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                    Delivery Account
                  </div>
                  <Select
                    value={assignment.accountId}
                    onChange={(event) => void onAssign(brand.id, { accountId: event.target.value })}
                  >
                    <option value="">Unassigned</option>
                    {deliveryCapableAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid gap-1">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                    Reply Mailbox
                  </div>
                  <Select
                    value={assignment.mailboxAccountId}
                    onChange={(event) =>
                      void onAssign(brand.id, { mailboxAccountId: event.target.value })
                    }
                  >
                    <option value="">Use delivery account</option>
                    {mailboxCapableAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
