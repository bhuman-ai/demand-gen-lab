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
  deleteOutreachAccountApi,
  fetchBrandOutreachAssignment,
  fetchBrands,
  fetchOutreachAccounts,
  testOutreachAccount,
  updateOutreachAccountApi,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, OutreachAccount } from "@/lib/factory-types";

type FieldErrors<T> = Partial<Record<keyof T, string>>;

type AssignmentChoice = {
  accountId: string;
  mailboxAccountId: string;
};

type AssignmentMap = Record<string, AssignmentChoice>;

type DeliveryFormState = {
  name: string;
  siteId: string;
  customerIoApiKey: string;
  fromEmail: string;
};

type MailboxAuthMethod = "app_password" | "oauth_tokens";

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
  customerIoApiKey: "",
  fromEmail: "",
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

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="text-xs text-[color:var(--danger)]">{message}</div>;
}

function invalidFieldClass(isInvalid: boolean) {
  return isInvalid ? "border-[color:var(--danger-border)] focus-visible:ring-[color:var(--danger)]" : "";
}

type AccountListCardProps = {
  title: string;
  description: string;
  emptyMessage: string;
  testScope: "full" | "customerio" | "mailbox";
  createHref?: string;
  createLabel?: string;
  accounts: OutreachAccount[];
  setAccounts: Dispatch<SetStateAction<OutreachAccount[]>>;
  setError: Dispatch<SetStateAction<string>>;
  onDeleteAccount: (accountId: string) => Promise<void>;
};

function AccountListCard({
  title,
  description,
  emptyMessage,
  testScope,
  createHref,
  createLabel,
  accounts,
  setAccounts,
  setError,
  onDeleteAccount,
}: AccountListCardProps) {
  const testLabel =
    testScope === "customerio" ? "Test Customer.io" : testScope === "mailbox" ? "Test Email" : "Test";

  const [testStateByAccountId, setTestStateByAccountId] = useState<
    Record<string, { ok: boolean; message: string; testedAt: string }>
  >({});
  const [testingByAccountId, setTestingByAccountId] = useState<Record<string, boolean>>({});
  const [deletingByAccountId, setDeletingByAccountId] = useState<Record<string, boolean>>({});

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {createHref ? (
          <Button asChild type="button" size="sm" variant="outline">
            <a href={createHref}>{createLabel ?? "Add account"}</a>
          </Button>
        ) : null}
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
                  Type: {account.accountType} · Provider: {account.provider}
                  {account.accountType !== "mailbox" ? (
                    <>
                      {" "}
                      · From: {account.config.customerIo.fromEmail || "not set"} · Reply-To: set per brand via Reply
                      Mailbox
                    </>
                  ) : null}
                  {account.accountType !== "delivery" ? (
                    <> · Inbox: {account.config.mailbox.email || "not set"}</>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={Boolean(testingByAccountId[account.id] || deletingByAccountId[account.id])}
                  onClick={async () => {
                    setError("");
                    try {
                      setTestingByAccountId((prev) => ({ ...prev, [account.id]: true }));
                      const result = await testOutreachAccount(account.id, testScope);
                      trackEvent("outreach_account_tested", {
                        accountId: account.id,
                        ok: result.ok,
                        scope: result.scope,
                      });
                      setTestStateByAccountId((prev) => ({
                        ...prev,
                        [account.id]: { ok: result.ok, message: result.message, testedAt: result.testedAt },
                      }));
                      const refreshed = await fetchOutreachAccounts();
                      setAccounts(refreshed);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Account test failed");
                    } finally {
                      setTestingByAccountId((prev) => ({ ...prev, [account.id]: false }));
                    }
                  }}
                >
                  {testingByAccountId[account.id] ? "Testing..." : testLabel}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={Boolean(deletingByAccountId[account.id] || testingByAccountId[account.id])}
                  onClick={async () => {
                    const confirmed = window.confirm(`Delete account "${account.name}"?`);
                    if (!confirmed) return;
                    setError("");
                    try {
                      setDeletingByAccountId((prev) => ({ ...prev, [account.id]: true }));
                      await onDeleteAccount(account.id);
                      setTestStateByAccountId((prev) => {
                        const next = { ...prev };
                        delete next[account.id];
                        return next;
                      });
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to delete account");
                    } finally {
                      setDeletingByAccountId((prev) => ({ ...prev, [account.id]: false }));
                    }
                  }}
                >
                  {deletingByAccountId[account.id] ? "Deleting..." : "Delete"}
                </Button>
                <Select
                  value={account.status}
                  disabled={Boolean(deletingByAccountId[account.id])}
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
            {testStateByAccountId[account.id] ? (
              <div
                className={`mt-2 rounded-lg border px-2 py-1 text-xs ${
                  testStateByAccountId[account.id].ok
                    ? "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]"
                    : "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
                }`}
              >
                {testStateByAccountId[account.id].message}
              </div>
            ) : null}
          </div>
        ))}
        {!accounts.length ? (
          <div className="grid gap-2">
            <div className="text-sm text-[color:var(--muted-foreground)]">{emptyMessage}</div>
            {createHref ? (
              <div>
                <Button asChild type="button" size="sm" variant="secondary">
                  <a href={createHref}>{createLabel ?? "Add account"}</a>
                </Button>
              </div>
            ) : null}
          </div>
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
  const [mailboxAuthMethod, setMailboxAuthMethod] = useState<MailboxAuthMethod>("app_password");
  const [showMailboxAdvanced, setShowMailboxAdvanced] = useState(false);

  const [deliveryErrors, setDeliveryErrors] = useState<FieldErrors<DeliveryFormState>>({});
  const [mailboxErrors, setMailboxErrors] = useState<FieldErrors<MailboxFormState>>({});

  const [savingDelivery, setSavingDelivery] = useState(false);
  const [savingMailbox, setSavingMailbox] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const scrollToId = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

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
    const nextErrors: FieldErrors<DeliveryFormState> = {};
    if (!deliveryForm.name.trim()) nextErrors.name = "Required.";
    if (!deliveryForm.siteId.trim()) nextErrors.siteId = "Required.";
    if (!deliveryForm.customerIoApiKey.trim()) nextErrors.customerIoApiKey = "Required.";
    if (!deliveryForm.fromEmail.trim()) nextErrors.fromEmail = "Required.";

    const siteId = deliveryForm.siteId.trim();
    // Catch the most common mis-paste: users paste Workspace/Name (often a domain) instead of Site ID.
    if (siteId && (siteId.includes("@") || siteId.includes(".") || siteId.includes(" "))) {
      nextErrors.siteId = "This looks like a workspace/name. Paste the Site ID value (looks like 9336ae1a489137ebb1e5).";
    }
    setDeliveryErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setError("Fix the highlighted fields in the delivery account section.");
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
            workspaceId: "",
            fromEmail: deliveryForm.fromEmail,
            replyToEmail: "",
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
      setDeliveryErrors({});
      trackEvent("outreach_account_connected", { accountId: created.id });

      // Common case: new user has exactly 1 brand and just wants to get running fast.
      if (brands.length === 1) {
        const onlyBrand = brands[0];
        const current = assignments[onlyBrand.id]?.accountId ?? "";
        if (!current) {
          await onAssign(onlyBrand.id, { accountId: created.id });
          scrollToId("brand-assignments");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create delivery account");
    } finally {
      setSavingDelivery(false);
    }
  };

  const createMailboxAccount = async () => {
    const nextErrors: FieldErrors<MailboxFormState> = {};
    if (!mailboxForm.name.trim()) nextErrors.name = "Required.";
    if (!mailboxForm.mailboxEmail.trim()) nextErrors.mailboxEmail = "Required.";
    if (!mailboxForm.mailboxPort.trim()) nextErrors.mailboxPort = "Required.";

    const port = Number(mailboxForm.mailboxPort || 0);
    if (mailboxForm.mailboxPort.trim() && (!Number.isFinite(port) || port <= 0)) {
      nextErrors.mailboxPort = "Port must be a number.";
    }

    const needsHost = mailboxForm.mailboxProvider === "imap" || showMailboxAdvanced;
    if (needsHost && !mailboxForm.mailboxHost.trim()) nextErrors.mailboxHost = "Required.";

    if (mailboxAuthMethod === "app_password") {
      if (!mailboxForm.mailboxPassword.trim()) nextErrors.mailboxPassword = "App password required.";
    } else {
      if (!mailboxForm.mailboxAccessToken.trim()) nextErrors.mailboxAccessToken = "Access token required.";
    }

    setMailboxErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setError("Fix the highlighted fields in the email reply account section.");
      if (nextErrors.mailboxHost || nextErrors.mailboxPort) setShowMailboxAdvanced(true);
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
            fromEmail: "",
            replyToEmail: "",
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
      setMailboxErrors({});
      trackEvent("outreach_account_connected", { accountId: created.id });

      if (brands.length === 1) {
        const onlyBrand = brands[0];
        const current = assignments[onlyBrand.id]?.mailboxAccountId ?? "";
        if (!current) {
          await onAssign(onlyBrand.id, { mailboxAccountId: created.id });
          scrollToId("brand-assignments");
        }
      }
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

  const onDeleteAccount = async (accountId: string) => {
    const deletedId = await deleteOutreachAccountApi(accountId);
    setAccounts((prev) => prev.filter((account) => account.id !== deletedId));

    setAssignments((prev) => {
      const next: AssignmentMap = {};
      for (const [brandId, row] of Object.entries(prev)) {
        if (row.accountId === deletedId) {
          next[brandId] = { accountId: "", mailboxAccountId: "" };
        } else if (row.mailboxAccountId === deletedId) {
          next[brandId] = { ...row, mailboxAccountId: "" };
        } else {
          next[brandId] = row;
        }
      }
      return next;
    });

    const assignmentPairs = await Promise.all(
      brands.map(async (brand) => {
        const row = await fetchBrandOutreachAssignment(brand.id);
        return {
          brandId: brand.id,
          accountId: row.assignment?.accountId ?? "",
          mailboxAccountId: row.assignment?.mailboxAccountId ?? "",
        };
      })
    );
    const map: AssignmentMap = {};
    for (const row of assignmentPairs) {
      map[row.brandId] = {
        accountId: row.accountId,
        mailboxAccountId: row.mailboxAccountId,
      };
    }
    setAssignments(map);
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
    setMailboxErrors((prev) => ({ ...prev, mailboxProvider: undefined }));
    if (provider === "imap") setShowMailboxAdvanced(true);
  };

  const brandReadiness = useMemo(() => {
    return brands.map((brand) => {
      const assignment = assignments[brand.id] ?? { accountId: "", mailboxAccountId: "" };
      const delivery = assignment.accountId
        ? deliveryAccounts.find((account) => account.id === assignment.accountId) ?? null
        : null;
      const mailbox = assignment.mailboxAccountId
        ? mailboxAccounts.find((account) => account.id === assignment.mailboxAccountId) ?? null
        : null;

      const deliveryAssigned = Boolean(delivery && delivery.status === "active");
      const mailboxAssigned = Boolean(mailbox && mailbox.status === "active");
      const deliveryTested = Boolean(delivery && delivery.lastTestAt);
      const mailboxTested = Boolean(mailbox && mailbox.lastTestAt);
      const deliveryPass = Boolean(delivery && delivery.lastTestStatus === "pass");
      const mailboxPass = Boolean(mailbox && mailbox.lastTestStatus === "pass");

      return {
        brand,
        assignment,
        delivery,
        mailbox,
        deliveryAssigned,
        mailboxAssigned,
        deliveryTested,
        mailboxTested,
        deliveryPass,
        mailboxPass,
        ready: deliveryAssigned && mailboxAssigned && deliveryPass && mailboxPass,
      };
    });
  }, [brands, assignments, deliveryAccounts, mailboxAccounts]);

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
          <CardTitle className="text-base">Brand Readiness</CardTitle>
          <CardDescription>
            Each brand needs a delivery account + reply inbox. Run tests to confirm everything is connected.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!deliveryAccounts.length || !mailboxAccounts.length ? (
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm">
              <div className="font-semibold">Start Here</div>
              <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                1) Add a delivery account (Customer.io + sender address). 2) Add a reply mailbox (where replies land).
                3) Assign both to your brand.
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {!deliveryAccounts.length ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => scrollToId("add-delivery-account")}>
                    Add delivery account
                  </Button>
                ) : null}
                {!mailboxAccounts.length ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => scrollToId("add-email-reply-account")}>
                    Add reply mailbox
                  </Button>
                ) : null}
                <Button type="button" size="sm" variant="outline" onClick={() => scrollToId("brand-assignments")}>
                  Assign to brand
                </Button>
              </div>
            </div>
          ) : null}
          {brandReadiness.map((row) => {
            const deliveryLabel = row.deliveryAssigned
              ? row.deliveryPass
                ? "Delivery: ready"
                : row.deliveryTested
                  ? "Delivery: needs attention"
                  : "Delivery: not tested"
              : "Delivery: unassigned";
            const mailboxLabel = row.mailboxAssigned
              ? row.mailboxPass
                ? "Reply inbox: ready"
                : row.mailboxTested
                  ? "Reply inbox: needs attention"
                  : "Reply inbox: not tested"
              : "Reply inbox: unassigned";

            const statusPill = (ok: boolean, warn: boolean) =>
              ok
                ? "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]"
                : warn
                  ? "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)]";

            return (
              <div
                key={row.brand.id}
                className="grid gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 md:grid-cols-[1fr_auto] md:items-center"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{row.brand.name}</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${statusPill(
                        row.deliveryPass,
                        row.deliveryAssigned && row.deliveryTested && !row.deliveryPass
                      )}`}
                    >
                      {deliveryLabel}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${statusPill(
                        row.mailboxPass,
                        row.mailboxAssigned && row.mailboxTested && !row.mailboxPass
                      )}`}
                    >
                      {mailboxLabel}
                    </span>
                    {row.ready ? (
                      <span className="rounded-full border border-[color:var(--success-border)] bg-[color:var(--success-soft)] px-2 py-0.5 text-xs text-[color:var(--success)]">
                        Ready to run
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (!deliveryAccounts.length) {
                        scrollToId("add-delivery-account");
                        return;
                      }
                      if (!mailboxAccounts.length) {
                        scrollToId("add-email-reply-account");
                        return;
                      }
                      scrollToId("brand-assignments");
                    }}
                  >
                    {!deliveryAccounts.length || !mailboxAccounts.length ? "Setup" : "Assign"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!row.delivery}
                    onClick={async () => {
                      if (!row.delivery) return;
                      setError("");
                      try {
                        await testOutreachAccount(row.delivery.id, "customerio");
                        const refreshed = await fetchOutreachAccounts();
                        setAccounts(refreshed);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Customer.io test failed");
                      }
                    }}
                  >
                    Test Customer.io
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!row.mailbox}
                    onClick={async () => {
                      if (!row.mailbox) return;
                      setError("");
                      try {
                        await testOutreachAccount(row.mailbox.id, "mailbox");
                        const refreshed = await fetchOutreachAccounts();
                        setAccounts(refreshed);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Email test failed");
                      }
                    }}
                  >
                    Test Email
                  </Button>
                </div>
              </div>
            );
          })}
          {!brandReadiness.length ? (
            <div className="text-sm text-[color:var(--muted-foreground)]">No brands yet.</div>
          ) : null}
        </CardContent>
      </Card>

      <Card id="add-delivery-account">
        <CardHeader>
          <CardTitle className="text-base">Add Customer.io Delivery Account</CardTitle>
          <CardDescription>
            Connect Customer.io credentials used for automated outreach delivery. Reply-To is set automatically by the
            Reply Mailbox you assign to each brand.
          </CardDescription>
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
              aria-invalid={Boolean(deliveryErrors.name)}
              className={invalidFieldClass(Boolean(deliveryErrors.name))}
            />
            <FieldError message={deliveryErrors.name} />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="delivery-site-id"
              label="Customer.io Site ID"
              help="Customer.io: Settings > API Credentials. Copy the Site ID column value (looks like 9336ae1a489137ebb1e5)."
            />
            <Input
              id="delivery-site-id"
              value={deliveryForm.siteId}
              onChange={(event) =>
                setDeliveryForm((prev) => ({ ...prev, siteId: event.target.value }))
              }
              placeholder="9336ae1a489137ebb1e5"
              aria-invalid={Boolean(deliveryErrors.siteId)}
              className={invalidFieldClass(Boolean(deliveryErrors.siteId))}
            />
            <FieldError message={deliveryErrors.siteId} />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="delivery-api-key"
              label="Customer.io Tracking API Key"
              help="Customer.io: Settings > API Credentials. Use the Tracking API key from the same row as your Site ID (do not use an App API key)."
            />
            <Input
              id="delivery-api-key"
              type="password"
              value={deliveryForm.customerIoApiKey}
              onChange={(event) =>
                setDeliveryForm((prev) => ({ ...prev, customerIoApiKey: event.target.value }))
              }
              placeholder="3a50ad6998b2fd842b5f"
              aria-invalid={Boolean(deliveryErrors.customerIoApiKey)}
              className={invalidFieldClass(Boolean(deliveryErrors.customerIoApiKey))}
            />
            <FieldError message={deliveryErrors.customerIoApiKey} />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="delivery-from-email"
              label="From Email"
              help="Sender address recipients will see (From header). Must be on a verified sending domain in Customer.io (Email > Sending domains). Example: zeynep@bhumanai.com."
            />
            <Input
              id="delivery-from-email"
              value={deliveryForm.fromEmail}
              onChange={(event) => setDeliveryForm((prev) => ({ ...prev, fromEmail: event.target.value }))}
              placeholder="zeynep@bhumanai.com"
              aria-invalid={Boolean(deliveryErrors.fromEmail)}
              className={invalidFieldClass(Boolean(deliveryErrors.fromEmail))}
            />
            <FieldError message={deliveryErrors.fromEmail} />
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

      <Card id="add-email-reply-account">
        <CardHeader>
          <CardTitle className="text-base">Add Email Reply Account</CardTitle>
          <CardDescription>
            Connect the inbox that will receive replies. The platform automatically sets outbound Reply-To to this inbox
            when assigned to a brand. (Your sender address is set separately in the Customer.io Delivery Account.)
          </CardDescription>
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
              aria-invalid={Boolean(mailboxErrors.name)}
              className={invalidFieldClass(Boolean(mailboxErrors.name))}
            />
            <FieldError message={mailboxErrors.name} />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-provider"
              label="Mailbox Provider"
              help="Choose Gmail or Outlook for defaults. Choose IMAP if you need custom server settings."
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
            {mailboxForm.mailboxProvider !== "imap" ? (
              <div className="text-[11px] text-[color:var(--muted-foreground)]">
                Using {mailboxForm.mailboxHost}:{mailboxForm.mailboxPort} (edit in Advanced).
              </div>
            ) : null}
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-auth-method"
              label="Connection Method"
              help="App password is the easiest setup for Gmail/Workspace and Outlook. OAuth tokens are advanced."
            />
            <Select
              id="mailbox-auth-method"
              value={mailboxAuthMethod}
              onChange={(event) => setMailboxAuthMethod(event.target.value as MailboxAuthMethod)}
            >
              <option value="app_password">App password (recommended)</option>
              <option value="oauth_tokens">OAuth tokens (advanced)</option>
            </Select>
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-email"
              label="Reply Inbox Email"
              help="This is the inbox where replies arrive. When you assign this mailbox to a brand, the platform automatically sets outbound Reply-To to this email."
            />
            <Input
              id="mailbox-email"
              value={mailboxForm.mailboxEmail}
              onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxEmail: event.target.value }))}
              aria-invalid={Boolean(mailboxErrors.mailboxEmail)}
              className={invalidFieldClass(Boolean(mailboxErrors.mailboxEmail))}
            />
            <FieldError message={mailboxErrors.mailboxEmail} />
            <div className="text-xs text-[color:var(--muted-foreground)]">
              Sending address comes from your assigned delivery account’s{" "}
              <span className="font-medium text-[color:var(--foreground)]">From Email</span>.
            </div>
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-password"
              label="App Password"
              help="Gmail/Workspace: Google Account > Security > 2-Step Verification > App passwords. Use an app password, not your normal password."
            />
            <Input
              id="mailbox-password"
              type="password"
              value={mailboxForm.mailboxPassword}
              onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxPassword: event.target.value }))}
              disabled={mailboxAuthMethod !== "app_password"}
              aria-invalid={Boolean(mailboxErrors.mailboxPassword)}
              className={invalidFieldClass(Boolean(mailboxErrors.mailboxPassword))}
            />
            <FieldError message={mailboxErrors.mailboxPassword} />
          </div>
          {mailboxAuthMethod === "oauth_tokens" ? (
            <>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="mailbox-access-token"
                  label="OAuth Access Token (advanced)"
                  help="If you already have OAuth tokens for this mailbox, paste the access token here."
                />
                <Input
                  id="mailbox-access-token"
                  type="password"
                  value={mailboxForm.mailboxAccessToken}
                  onChange={(event) =>
                    setMailboxForm((prev) => ({ ...prev, mailboxAccessToken: event.target.value }))
                  }
                  aria-invalid={Boolean(mailboxErrors.mailboxAccessToken)}
                  className={invalidFieldClass(Boolean(mailboxErrors.mailboxAccessToken))}
                />
                <FieldError message={mailboxErrors.mailboxAccessToken} />
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="mailbox-refresh-token"
                  label="OAuth Refresh Token (advanced)"
                  help="Optional. Used to refresh access tokens automatically."
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
            </>
          ) : null}
          <div className="md:col-span-2">
            <button
              type="button"
              className="text-xs font-medium text-[color:var(--muted-foreground)] underline decoration-dotted underline-offset-4"
              onClick={() => setShowMailboxAdvanced((prev) => !prev)}
            >
              {showMailboxAdvanced ? "Hide advanced IMAP settings" : "Show advanced IMAP settings"}
            </button>
          </div>
          {showMailboxAdvanced || mailboxForm.mailboxProvider === "imap" ? (
            <>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="mailbox-host"
                  label="IMAP Host (advanced)"
                  help="IMAP server host. Gmail: imap.gmail.com. Outlook: outlook.office365.com."
                />
                <Input
                  id="mailbox-host"
                  value={mailboxForm.mailboxHost}
                  onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxHost: event.target.value }))}
                  aria-invalid={Boolean(mailboxErrors.mailboxHost)}
                  className={invalidFieldClass(Boolean(mailboxErrors.mailboxHost))}
                />
                <FieldError message={mailboxErrors.mailboxHost} />
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="mailbox-port"
                  label="IMAP Port (advanced)"
                  help="Usually 993 for secure IMAP."
                />
                <Input
                  id="mailbox-port"
                  value={mailboxForm.mailboxPort}
                  onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxPort: event.target.value }))}
                  aria-invalid={Boolean(mailboxErrors.mailboxPort)}
                  className={invalidFieldClass(Boolean(mailboxErrors.mailboxPort))}
                />
                <FieldError message={mailboxErrors.mailboxPort} />
              </div>
            </>
          ) : null}
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
        createHref="#add-delivery-account"
        createLabel="Add delivery account"
        accounts={deliveryAccounts}
        setAccounts={setAccounts}
        setError={setError}
        onDeleteAccount={onDeleteAccount}
      />

      <AccountListCard
        title="Email Reply Accounts"
        description="Mailbox accounts used for reply sync and human-approved replies."
        emptyMessage="No email accounts yet."
        testScope="mailbox"
        createHref="#add-email-reply-account"
        createLabel="Add reply mailbox"
        accounts={mailboxAccounts}
        setAccounts={setAccounts}
        setError={setError}
        onDeleteAccount={onDeleteAccount}
      />

      <Card>
        <CardHeader id="brand-assignments">
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
            const assignedMailbox = assignment.mailboxAccountId
              ? mailboxAccounts.find((account) => account.id === assignment.mailboxAccountId) ?? null
              : null;
            const assignedMailboxEmail = assignedMailbox?.config.mailbox.email?.trim() ?? "";
            const assignedDelivery = assignment.accountId
              ? deliveryAccounts.find((account) => account.id === assignment.accountId) ?? null
              : null;
            const needsReplyMailbox =
              !assignment.mailboxAccountId && (!assignedDelivery || assignedDelivery.accountType === "delivery");
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
                  {!deliveryAccounts.length ? (
                    <Button
                      asChild
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-auto justify-start px-0 py-0 underline"
                    >
                      <a href="#add-delivery-account">Create a delivery account</a>
                    </Button>
                  ) : null}
                  {assignedDelivery ? (
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      From will be:{" "}
                      <span className="font-medium text-[color:var(--foreground)]">
                        {assignedDelivery.config.customerIo.fromEmail || "not set"}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-1">
                  <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                    Reply Mailbox
                  </div>
                  <Select
                    value={assignment.mailboxAccountId}
                    onChange={(event) => void onAssign(brand.id, { mailboxAccountId: event.target.value })}
                  >
                    <option value="">Unassigned</option>
                    {mailboxAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </Select>
                  {!mailboxAccounts.length ? (
                    <Button
                      asChild
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-auto justify-start px-0 py-0 underline"
                    >
                      <a href="#add-email-reply-account">Create a reply mailbox</a>
                    </Button>
                  ) : null}
                  {assignment.mailboxAccountId ? (
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      Reply-To will be:{" "}
                      <span className="font-medium text-[color:var(--foreground)]">
                        {assignedMailboxEmail || "not set"}
                      </span>
                    </div>
                  ) : needsReplyMailbox ? (
                    <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-1 text-xs text-[color:var(--muted-foreground)]">
                      Autopilot requires a reply mailbox to run. Assign one to enable sending.
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
