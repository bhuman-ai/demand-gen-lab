"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
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

type DeliveryFormState = {
  name: string;
  siteId: string;
  workspaceId: string;
  customerIoApiKey: string;
};

type MailboxFormState = {
  name: string;
  mailboxProvider: "gmail" | "outlook" | "imap";
  mailboxEmail: string;
  mailboxHost: string;
  mailboxPort: string;
  mailboxSecure: boolean;
  mailboxAccessToken: string;
  mailboxRefreshToken: string;
  mailboxPassword: string;
};

const INITIAL_DELIVERY_FORM: DeliveryFormState = {
  name: "",
  siteId: "",
  workspaceId: "",
  customerIoApiKey: "",
};

const INITIAL_MAILBOX_FORM: MailboxFormState = {
  name: "",
  mailboxProvider: "gmail",
  mailboxEmail: "",
  mailboxHost: "imap.gmail.com",
  mailboxPort: "993",
  mailboxSecure: true,
  mailboxAccessToken: "",
  mailboxRefreshToken: "",
  mailboxPassword: "",
};

const MAILBOX_PROVIDER_DEFAULTS: Record<
  MailboxFormState["mailboxProvider"],
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

type AccountListCardProps = {
  title: string;
  description: string;
  emptyMessage: string;
  testScope: "full" | "customerio" | "mailbox";
  accounts: OutreachAccount[];
  setAccounts: Dispatch<SetStateAction<OutreachAccount[]>>;
  setError: Dispatch<SetStateAction<string>>;
};

function AccountListCard({
  title,
  description,
  emptyMessage,
  testScope,
  accounts,
  setAccounts,
  setError,
}: AccountListCardProps) {
  const testLabel =
    testScope === "customerio" ? "Test Customer.io" : testScope === "mailbox" ? "Test Email" : "Test";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
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
                  Type: {account.accountType} · Provider: {account.provider} · Mailbox: {account.config.mailbox.email || "not set"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    setError("");
                    try {
                      const result = await testOutreachAccount(account.id, testScope);
                      trackEvent("outreach_account_tested", {
                        accountId: account.id,
                        ok: result.ok,
                        scope: result.scope,
                      });
                      if (!result.ok) {
                        if (result.scope === "customerio") {
                          setError(
                            `Customer.io test failed for ${account.name}: ${result.message}`
                          );
                        } else if (result.scope === "mailbox") {
                          setError(`Mailbox test failed for ${account.name}: ${result.message}`);
                        } else {
                          setError(
                            `Test failed for ${account.name}: customer.io=${result.checks.customerIo}, lead sourcing=${result.checks.apify}, mailbox=${result.checks.mailbox}. ${result.message}`
                          );
                        }
                      }
                      const refreshed = await fetchOutreachAccounts();
                      setAccounts(refreshed);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Account test failed");
                    }
                  }}
                > 
                  {testLabel}
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
          <div className="text-sm text-[color:var(--muted-foreground)]">{emptyMessage}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function OutreachSettingsClient() {
  const [accounts, setAccounts] = useState<OutreachAccount[]>([]);
  const [brands, setBrands] = useState<BrandRecord[]>([]);
  const [assignments, setAssignments] = useState<AssignmentMap>({});

  const [deliveryForm, setDeliveryForm] = useState<DeliveryFormState>(INITIAL_DELIVERY_FORM);
  const [mailboxForm, setMailboxForm] = useState<MailboxFormState>(INITIAL_MAILBOX_FORM);

  const [savingDelivery, setSavingDelivery] = useState(false);
  const [savingMailbox, setSavingMailbox] = useState(false);
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

  const deliveryAccounts = useMemo(
    () => accounts.filter((account) => account.accountType !== "mailbox"),
    [accounts]
  );

  const mailboxAccounts = useMemo(
    () => accounts.filter((account) => account.accountType !== "delivery"),
    [accounts]
  );

  const createDeliveryAccount = async () => {
    const required = [
      deliveryForm.name.trim(),
      deliveryForm.siteId.trim(),
      deliveryForm.workspaceId.trim(),
      deliveryForm.customerIoApiKey.trim(),
    ];
    if (required.some((value) => !value)) {
      setError("Delivery account requires name, Customer.io Site ID, Workspace, and API Key.");
      return;
    }

    setSavingDelivery(true);
    setError("");
    try {
      const created = await createOutreachAccountApi({
        name: deliveryForm.name.trim(),
        accountType: "delivery",
        status: "active",
        config: {
          customerIo: {
            siteId: deliveryForm.siteId,
            workspaceId: deliveryForm.workspaceId,
          },
          apify: {
            defaultActorId: "",
          },
          mailbox: {
            provider: "imap",
            email: "",
            host: "",
            port: 993,
            secure: true,
            status: "disconnected",
          },
        },
        credentials: {
          customerIoApiKey: deliveryForm.customerIoApiKey,
        },
      });

      setAccounts((prev) => [created, ...prev]);
      setDeliveryForm(INITIAL_DELIVERY_FORM);
      trackEvent("outreach_account_connected", { accountId: created.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create delivery account");
    } finally {
      setSavingDelivery(false);
    }
  };

  const createMailboxAccount = async () => {
    const hasBaseFields =
      mailboxForm.name.trim() &&
      mailboxForm.mailboxEmail.trim() &&
      mailboxForm.mailboxHost.trim() &&
      mailboxForm.mailboxPort.trim();

    const hasAuthPath = mailboxForm.mailboxAccessToken.trim() || mailboxForm.mailboxPassword.trim();

    if (!hasBaseFields) {
      setError("Email account requires name, mailbox email, host, and port.");
      return;
    }

    if (!hasAuthPath) {
      setError("Email account requires either an access token or mailbox password.");
      return;
    }

    setSavingMailbox(true);
    setError("");

    try {
      const created = await createOutreachAccountApi({
        name: mailboxForm.name.trim(),
        accountType: "mailbox",
        status: "active",
        config: {
          customerIo: {
            siteId: "",
            workspaceId: "",
          },
          apify: {
            defaultActorId: "",
          },
          mailbox: {
            provider: mailboxForm.mailboxProvider,
            email: mailboxForm.mailboxEmail,
            host: mailboxForm.mailboxHost,
            port: Number(mailboxForm.mailboxPort || 993),
            secure: mailboxForm.mailboxSecure,
            status: "connected",
          },
        },
        credentials: {
          mailboxAccessToken: mailboxForm.mailboxAccessToken,
          mailboxRefreshToken: mailboxForm.mailboxRefreshToken,
          mailboxPassword: mailboxForm.mailboxPassword,
        },
      });

      setAccounts((prev) => [created, ...prev]);
      setMailboxForm(INITIAL_MAILBOX_FORM);
      trackEvent("outreach_account_connected", { accountId: created.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create email account");
    } finally {
      setSavingMailbox(false);
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

  const setMailboxProviderWithDefaults = (provider: MailboxFormState["mailboxProvider"]) => {
    const defaults = MAILBOX_PROVIDER_DEFAULTS[provider];
    setMailboxForm((prev) => ({
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
            Manage Customer.io delivery accounts and email reply accounts, then assign both per brand.
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
          <CardTitle className="text-base">Add Customer.io Delivery Account</CardTitle>
          <CardDescription>Connect Customer.io credentials used for automated outreach delivery.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="delivery-account-name"
              label="Account Name"
              help="Internal name for this delivery account, for example Main Delivery."
            />
            <Input
              id="delivery-account-name"
              value={deliveryForm.name}
              onChange={(event) =>
                setDeliveryForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Main Delivery"
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="delivery-site-id"
              label="Customer.io Site ID"
              help="Found in Customer.io Settings > API Credentials."
            />
            <Input
              id="delivery-site-id"
              value={deliveryForm.siteId}
              onChange={(event) =>
                setDeliveryForm((prev) => ({ ...prev, siteId: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="delivery-workspace"
              label="Customer.io Workspace"
              help="Workspace identifier from Customer.io workspace settings or URL."
            />
            <Input
              id="delivery-workspace"
              value={deliveryForm.workspaceId}
              onChange={(event) =>
                setDeliveryForm((prev) => ({ ...prev, workspaceId: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="delivery-api-key"
              label="Customer.io API Key"
              help="Create an API key in Customer.io Settings > API Credentials."
            />
            <Input
              id="delivery-api-key"
              type="password"
              value={deliveryForm.customerIoApiKey}
              onChange={(event) =>
                setDeliveryForm((prev) => ({ ...prev, customerIoApiKey: event.target.value }))
              }
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button
              type="button"
              disabled={savingDelivery}
              onClick={createDeliveryAccount}
            >
              {savingDelivery ? "Saving..." : "Create Delivery Account"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Email Reply Account</CardTitle>
          <CardDescription>Connect mailbox credentials for reply sync and draft sending.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-account-name"
              label="Account Name"
              help="Internal name for this reply mailbox account, for example Sales Inbox."
            />
            <Input
              id="mailbox-account-name"
              value={mailboxForm.name}
              onChange={(event) => setMailboxForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Sales Inbox"
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-provider"
              label="Mailbox Provider"
              help="Choose Gmail, Outlook, or IMAP. Host and port auto-fill for Gmail and Outlook."
            />
            <Select
              id="mailbox-provider"
              value={mailboxForm.mailboxProvider}
              onChange={(event) =>
                setMailboxProviderWithDefaults(event.target.value as MailboxFormState["mailboxProvider"])
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
              help="Address used for reply threading and human-approved responses."
            />
            <Input
              id="mailbox-email"
              value={mailboxForm.mailboxEmail}
              onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxEmail: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-host"
              label="Mailbox Host"
              help="IMAP server host, for example imap.gmail.com or outlook.office365.com."
            />
            <Input
              id="mailbox-host"
              value={mailboxForm.mailboxHost}
              onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxHost: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-port"
              label="Mailbox Port"
              help="Usually 993 for secure IMAP."
            />
            <Input
              id="mailbox-port"
              value={mailboxForm.mailboxPort}
              onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxPort: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-access-token"
              label="Mailbox Access Token"
              help="OAuth access token (optional if using app password)."
            />
            <Input
              id="mailbox-access-token"
              type="password"
              value={mailboxForm.mailboxAccessToken}
              onChange={(event) =>
                setMailboxForm((prev) => ({ ...prev, mailboxAccessToken: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-refresh-token"
              label="Mailbox Refresh Token"
              help="OAuth refresh token used to renew access tokens."
            />
            <Input
              id="mailbox-refresh-token"
              type="password"
              value={mailboxForm.mailboxRefreshToken}
              onChange={(event) =>
                setMailboxForm((prev) => ({ ...prev, mailboxRefreshToken: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-password"
              label="Mailbox Password"
              help="Mailbox password or app password (recommended)."
            />
            <Input
              id="mailbox-password"
              type="password"
              value={mailboxForm.mailboxPassword}
              onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxPassword: event.target.value }))}
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button
              type="button"
              disabled={savingMailbox}
              onClick={createMailboxAccount}
            >
              {savingMailbox ? "Saving..." : "Create Email Account"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AccountListCard
        title="Customer.io Delivery Accounts"
        description="Delivery accounts used to orchestrate outbound sends."
        emptyMessage="No delivery accounts yet."
        testScope="customerio"
        accounts={deliveryAccounts}
        setAccounts={setAccounts}
        setError={setError}
      />

      <AccountListCard
        title="Email Reply Accounts"
        description="Mailbox accounts used for reply sync and human-approved replies."
        emptyMessage="No email accounts yet."
        testScope="mailbox"
        accounts={mailboxAccounts}
        setAccounts={setAccounts}
        setError={setError}
      />

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
                    {deliveryAccounts.map((account) => (
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
                    onChange={(event) => void onAssign(brand.id, { mailboxAccountId: event.target.value })}
                  >
                    <option value="">Use delivery account</option>
                    {mailboxAccounts.map((account) => (
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
