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

type AssignmentMap = Record<string, string>;

type FormState = {
  name: string;
  siteId: string;
  workspaceId: string;
  defaultActorId: string;
  mailboxProvider: "gmail" | "outlook" | "imap";
  mailboxEmail: string;
  mailboxHost: string;
  mailboxPort: string;
  mailboxSecure: boolean;
  customerIoTrackApiKey: string;
  customerIoAppApiKey: string;
  apifyToken: string;
  mailboxAccessToken: string;
  mailboxRefreshToken: string;
  mailboxPassword: string;
};

const INITIAL_FORM: FormState = {
  name: "",
  siteId: "",
  workspaceId: "",
  defaultActorId: "",
  mailboxProvider: "gmail",
  mailboxEmail: "",
  mailboxHost: "",
  mailboxPort: "993",
  mailboxSecure: true,
  customerIoTrackApiKey: "",
  customerIoAppApiKey: "",
  apifyToken: "",
  mailboxAccessToken: "",
  mailboxRefreshToken: "",
  mailboxPassword: "",
};

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
            return { brandId: brand.id, accountId: row.assignment?.accountId ?? "" };
          })
        );
        if (!mounted) return;
        const map: AssignmentMap = {};
        for (const row of assignmentPairs) {
          map[row.brandId] = row.accountId;
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

  const createAccount = async () => {
    setSaving(true);
    setError("");
    try {
      const created = await createOutreachAccountApi({
        name: form.name.trim(),
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
            status: "connected",
          },
        },
        credentials: {
          customerIoTrackApiKey: form.customerIoTrackApiKey,
          customerIoAppApiKey: form.customerIoAppApiKey,
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

  const onAssign = async (brandId: string, accountId: string) => {
    setAssignments((prev) => ({ ...prev, [brandId]: accountId }));
    try {
      await assignBrandOutreachAccount(brandId, accountId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign account");
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Outreach Automation Settings</CardTitle>
          <CardDescription>
            Manage Customer.io, Apify, and mailbox accounts. Assign one account per brand.
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
          <CardDescription>Store one reusable outbound stack and map it to brands.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="account-name">Account Name</Label>
            <Input
              id="account-name"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Main Outbound"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="account-site-id">Customer.io Site ID</Label>
            <Input
              id="account-site-id"
              value={form.siteId}
              onChange={(event) => setForm((prev) => ({ ...prev, siteId: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="account-workspace-id">Customer.io Workspace</Label>
            <Input
              id="account-workspace-id"
              value={form.workspaceId}
              onChange={(event) => setForm((prev) => ({ ...prev, workspaceId: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="account-actor-id">Default Apify Actor ID</Label>
            <Input
              id="account-actor-id"
              value={form.defaultActorId}
              onChange={(event) => setForm((prev) => ({ ...prev, defaultActorId: event.target.value }))}
              placeholder="apify/actor-name"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mailbox-provider">Mailbox Provider</Label>
            <Select
              id="mailbox-provider"
              value={form.mailboxProvider}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  mailboxProvider: event.target.value as FormState["mailboxProvider"],
                }))
              }
            >
              <option value="gmail">gmail</option>
              <option value="outlook">outlook</option>
              <option value="imap">imap</option>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mailbox-email">Mailbox Email</Label>
            <Input
              id="mailbox-email"
              value={form.mailboxEmail}
              onChange={(event) => setForm((prev) => ({ ...prev, mailboxEmail: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mailbox-host">Mailbox Host</Label>
            <Input
              id="mailbox-host"
              value={form.mailboxHost}
              onChange={(event) => setForm((prev) => ({ ...prev, mailboxHost: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mailbox-port">Mailbox Port</Label>
            <Input
              id="mailbox-port"
              value={form.mailboxPort}
              onChange={(event) => setForm((prev) => ({ ...prev, mailboxPort: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="account-track-key">Customer.io Track Key</Label>
            <Input
              id="account-track-key"
              type="password"
              value={form.customerIoTrackApiKey}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, customerIoTrackApiKey: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="account-app-key">Customer.io App Key</Label>
            <Input
              id="account-app-key"
              type="password"
              value={form.customerIoAppApiKey}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, customerIoAppApiKey: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="account-apify-token">Apify Token</Label>
            <Input
              id="account-apify-token"
              type="password"
              value={form.apifyToken}
              onChange={(event) => setForm((prev) => ({ ...prev, apifyToken: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mailbox-access-token">Mailbox Access Token</Label>
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
            <Label htmlFor="mailbox-refresh-token">Mailbox Refresh Token</Label>
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
            <Label htmlFor="mailbox-password">Mailbox Password</Label>
            <Input
              id="mailbox-password"
              type="password"
              value={form.mailboxPassword}
              onChange={(event) => setForm((prev) => ({ ...prev, mailboxPassword: event.target.value }))}
            />
          </div>
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
                    Provider: {account.provider} · Mailbox: {account.config.mailbox.email || "not set"}
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
          <CardDescription>Choose which account each brand should run outreach with.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {brands.map((brand) => (
            <div
              key={brand.id}
              className="grid gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 md:grid-cols-[1fr_260px] md:items-center"
            >
              <div>
                <div className="text-sm font-semibold">{brand.name}</div>
                <div className="text-xs text-[color:var(--muted-foreground)]">{brand.website}</div>
              </div>
              <Select
                value={assignments[brand.id] ?? ""}
                onChange={(event) => void onAssign(brand.id, event.target.value)}
              >
                <option value="">Unassigned</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
