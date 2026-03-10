"use client";

import { useEffect, useMemo, useState, type ComponentType, type Dispatch, type SetStateAction } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Fingerprint,
  Inbox,
  Link2,
  Send,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  fetchOutreachProvisioningSettings,
  testOutreachAccount,
  updateOutreachAccountApi,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, OutreachAccount, OutreachProvisioningSettings } from "@/lib/factory-types";
import ProvisioningProviderSettingsCard from "./provisioning-provider-settings-card";
import SenderProvisionCard from "./sender-provision-card";

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
  customerIoAppApiKey: string;
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

type SetupStepId = "identity" | "connections" | "delivery";
type SetupStepStatus = "complete" | "attention" | "todo";

const INITIAL_DELIVERY_FORM: DeliveryFormState = {
  name: "",
  siteId: "",
  customerIoApiKey: "",
  customerIoAppApiKey: "",
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

function setupStatusBadge(status: SetupStepStatus, label?: string) {
  if (status === "complete") return <Badge variant="success">{label ?? "Configured"}</Badge>;
  if (status === "attention") return <Badge variant="danger">{label ?? "Needs attention"}</Badge>;
  return <Badge variant="muted">{label ?? "Not started"}</Badge>;
}

function stepTone(status: SetupStepStatus, active: boolean) {
  if (active) return "border-[color:var(--accent)] bg-[color:var(--surface)]";
  if (status === "complete") return "border-[color:var(--success-border)] bg-[color:var(--success-soft)]";
  if (status === "attention") return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]";
  return "border-[color:var(--border)] bg-[color:var(--surface-muted)]";
}

function StepCard({
  stepNumber,
  title,
  description,
  summary,
  status,
  active,
  icon: Icon,
  onClick,
}: {
  stepNumber: string;
  title: string;
  description: string;
  summary: string;
  status: SetupStepStatus;
  active: boolean;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid w-full gap-3 rounded-3xl border p-4 text-left transition hover:border-[color:var(--accent)] ${stepTone(
        status,
        active
      )}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--muted-foreground)]">
            Step {stepNumber}
          </div>
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4" />
            <span className="text-sm font-semibold">{title}</span>
          </div>
        </div>
        {setupStatusBadge(status)}
      </div>
      <div className="text-sm text-[color:var(--muted-foreground)]">{description}</div>
      <div className="text-xs text-[color:var(--muted-foreground)]">{summary}</div>
    </button>
  );
}

function SummaryMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "accent";
}) {
  const toneClass =
    tone === "success"
      ? "border-[color:var(--success-border)] bg-[color:var(--success-soft)]"
      : tone === "accent"
        ? "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)]"
        : "border-[color:var(--border)] bg-[color:var(--surface)]";

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClass}`}>
      <div className="text-xs uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
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
  onDeleteAccount: (accountId: string) => Promise<void>;
};

function AccountListCard({
  title,
  description,
  emptyMessage,
  testScope,
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
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{title}</CardTitle>
            <Badge variant={accounts.length ? "success" : "muted"}>
              {accounts.length ? `${accounts.length} connected` : "None connected"}
            </Badge>
          </div>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {accounts.map((account) => {
          const budget = account.customerIoBilling;
          const budgetLine =
            account.accountType === "mailbox" || !budget
              ? ""
              : budget.baselineReady
                ? `Profile budget: ${budget.projectedProfiles}/${budget.monthlyProfileLimit} this period · ${budget.remainingProfiles} left`
                : `Profile budget: waiting for baseline sync for period starting ${budget.billingPeriodStart}`;
          const budgetRatio =
            budget && budget.monthlyProfileLimit > 0
              ? Math.max(0, Math.min(1, budget.projectedProfiles / budget.monthlyProfileLimit))
              : 0;
          return (
            <div
              key={account.id}
              className="rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold">{account.name}</div>
                    <Badge variant={account.status === "active" ? "success" : "muted"}>{account.status}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    Type: {account.accountType} · Provider: {account.provider}
                    {account.accountType !== "mailbox" ? (
                      <>
                        {" "}
                        · From: {account.config.customerIo.fromEmail || "not set"} · Reply-To: set per brand via reply
                        inbox
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
              {budgetLine ? (
                <div className="mt-2 grid gap-1">
                  <div className="text-xs text-[color:var(--muted-foreground)]">{budgetLine}</div>
                  <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface)]">
                    <div
                      className="h-full rounded-full bg-[color:var(--accent)]"
                      style={{ width: `${Math.round(budgetRatio * 100)}%` }}
                    />
                  </div>
                </div>
              ) : null}
              {testStateByAccountId[account.id] ? (
                <div
                  className={`mt-3 rounded-2xl border px-3 py-2 text-xs ${
                    testStateByAccountId[account.id].ok
                      ? "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]"
                      : "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
                  }`}
                >
                  {testStateByAccountId[account.id].message}
                </div>
              ) : null}
            </div>
          );
        })}
        {!accounts.length ? (
          <div className="rounded-3xl border border-dashed border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 text-sm text-[color:var(--muted-foreground)]">
            {emptyMessage}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function OutreachSettingsClient() {
  const [accounts, setAccounts] = useState<OutreachAccount[]>([]);
  const [brands, setBrands] = useState<BrandRecord[]>([]);
  const [provisioningSettings, setProvisioningSettings] = useState<OutreachProvisioningSettings | null>(null);
  const [assignments, setAssignments] = useState<AssignmentMap>({});

  const [deliveryForm, setDeliveryForm] = useState<DeliveryFormState>(INITIAL_DELIVERY_FORM);
  const [mailboxForm, setMailboxForm] = useState<MailboxFormState>(INITIAL_MAILBOX_FORM);
  const [mailboxAuthMethod, setMailboxAuthMethod] = useState<MailboxAuthMethod>("app_password");
  const [showMailboxAdvanced, setShowMailboxAdvanced] = useState(false);
  const [showDeliveryAdvanced, setShowDeliveryAdvanced] = useState(false);
  const [showDeliveryForm, setShowDeliveryForm] = useState(false);
  const [showMailboxForm, setShowMailboxForm] = useState(false);
  const [showConfiguredBrands, setShowConfiguredBrands] = useState(false);
  const [activeStep, setActiveStep] = useState<SetupStepId>("identity");

  const [deliveryErrors, setDeliveryErrors] = useState<FieldErrors<DeliveryFormState>>({});
  const [mailboxErrors, setMailboxErrors] = useState<FieldErrors<MailboxFormState>>({});

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
        const [accountsRows, brandRows, providerSettings] = await Promise.all([
          fetchOutreachAccounts(),
          fetchBrands(),
          fetchOutreachProvisioningSettings(),
        ]);
        if (!mounted) return;
        setAccounts(accountsRows);
        setBrands(brandRows);
        setProvisioningSettings(providerSettings);

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

  useEffect(() => {
    if (!deliveryAccounts.length) {
      setShowDeliveryForm(true);
    }
  }, [deliveryAccounts.length]);

  useEffect(() => {
    if (!mailboxAccounts.length) {
      setShowMailboxForm(true);
    }
  }, [mailboxAccounts.length]);

  const createDeliveryAccount = async () => {
    const nextErrors: FieldErrors<DeliveryFormState> = {};
    if (!deliveryForm.name.trim()) nextErrors.name = "Required.";
    if (!deliveryForm.siteId.trim()) nextErrors.siteId = "Required.";
    if (!deliveryForm.customerIoApiKey.trim()) nextErrors.customerIoApiKey = "Required.";
    if (!deliveryForm.fromEmail.trim()) nextErrors.fromEmail = "Required.";

    const siteId = deliveryForm.siteId.trim();
    if (siteId && (siteId.includes("@") || siteId.includes(".") || siteId.includes(" "))) {
      nextErrors.siteId = "This looks like a workspace/name. Paste the Site ID value (looks like 9336ae1a489137ebb1e5).";
    }
    setDeliveryErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setError("Fix the highlighted fields in the sending account section.");
      setShowDeliveryForm(true);
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
          customerIoTrackApiKey: deliveryForm.customerIoApiKey,
          customerIoAppApiKey: deliveryForm.customerIoAppApiKey,
        },
      });

      setAccounts((prev) => [created, ...prev]);
      setDeliveryForm(INITIAL_DELIVERY_FORM);
      setDeliveryErrors({});
      setShowDeliveryForm(false);
      setShowDeliveryAdvanced(false);
      trackEvent("outreach_account_connected", { accountId: created.id });

      if (brands.length === 1) {
        const onlyBrand = brands[0];
        const current = assignments[onlyBrand.id]?.accountId ?? "";
        if (!current) {
          await onAssign(onlyBrand.id, { accountId: created.id });
          setActiveStep("identity");
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
      setError("Fix the highlighted fields in the reply inbox section.");
      if (nextErrors.mailboxHost || nextErrors.mailboxPort) setShowMailboxAdvanced(true);
      setShowMailboxForm(true);
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
      setShowMailboxForm(false);
      trackEvent("outreach_account_connected", { accountId: created.id });

      if (brands.length === 1) {
        const onlyBrand = brands[0];
        const current = assignments[onlyBrand.id]?.mailboxAccountId ?? "";
        if (!current) {
          await onAssign(onlyBrand.id, { mailboxAccountId: created.id });
          setActiveStep("identity");
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

  const brandsNeedingAttention = useMemo(
    () => brandReadiness.filter((row) => !row.ready),
    [brandReadiness]
  );
  const configuredBrands = useMemo(
    () => brandReadiness.filter((row) => row.ready),
    [brandReadiness]
  );

  const providerDefaultsReady = Boolean(
    provisioningSettings?.customerIo.siteId.trim() &&
      provisioningSettings.customerIo.hasTrackingApiKey &&
      provisioningSettings?.namecheap.apiUser.trim() &&
      provisioningSettings.namecheap.hasApiKey &&
      provisioningSettings?.namecheap.clientIp.trim()
  );

  const identityStatus: SetupStepStatus =
    brands.length > 0 && configuredBrands.length === brands.length
      ? "complete"
      : configuredBrands.length > 0 || brandsNeedingAttention.length > 0
        ? "attention"
        : "todo";

  const connectionsStatus: SetupStepStatus =
    providerDefaultsReady && deliveryAccounts.length > 0
      ? "complete"
      : providerDefaultsReady ||
          provisioningSettings?.customerIo.lastValidatedStatus === "fail" ||
          provisioningSettings?.namecheap.lastValidatedStatus === "fail" ||
          deliveryAccounts.length > 0
        ? "attention"
        : "todo";

  const deliveryStatus: SetupStepStatus =
    mailboxAccounts.length > 0
      ? brandsNeedingAttention.some((row) => !row.mailboxAssigned)
        ? "attention"
        : "complete"
      : "todo";

  const completedSteps = [identityStatus, connectionsStatus, deliveryStatus].filter(
    (status) => status === "complete"
  ).length;

  const identityPrerequisites = [
    !providerDefaultsReady ? "Connect Customer.io and Namecheap defaults in Connections first." : "",
    !deliveryAccounts.length ? "Add at least one sending account in Connections." : "",
    !mailboxAccounts.length ? "Connect a reply inbox in Delivery." : "",
  ].filter(Boolean);

  const connectionSummary = providerDefaultsReady
    ? `${deliveryAccounts.length} sending account${deliveryAccounts.length === 1 ? "" : "s"} connected`
    : "Customer.io and Namecheap defaults still need setup";
  const deliverySummary = mailboxAccounts.length
    ? `${mailboxAccounts.length} reply inbox${mailboxAccounts.length === 1 ? "" : "es"} connected`
    : "No reply inbox connected yet";
  const identitySummary =
    configuredBrands.length > 0
      ? `${configuredBrands.length}/${brands.length || 0} brands ready to run`
      : "No brands fully configured yet";

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-[color:var(--border)] bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--accent)_15%,transparent),transparent_50%),linear-gradient(135deg,color-mix(in_srgb,var(--surface-muted)_92%,white),var(--surface))]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1 text-xs text-[color:var(--muted-foreground)]">
                <Sparkles className="h-3.5 w-3.5" />
                Progressive setup
              </div>
              <CardTitle>Outreach Setup Flow</CardTitle>
              <CardDescription>
                Move through Identity, Connections, and Delivery one step at a time. Technical fields stay tucked away
                until you explicitly open them.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-[color:var(--success)]" />
              {completedSteps}/3 steps configured
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 pt-5 md:grid-cols-4">
          <SummaryMetric label="Ready brands" value={`${configuredBrands.length}/${brands.length}`} tone="success" />
          <SummaryMetric label="Sending accounts" value={String(deliveryAccounts.length)} tone="accent" />
          <SummaryMetric label="Reply inboxes" value={String(mailboxAccounts.length)} tone="accent" />
          <SummaryMetric label="Active accounts" value={String(activeCount)} />
        </CardContent>
      </Card>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
      {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading outreach settings...</div> : null}

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <StepCard
            stepNumber="1"
            title="Identity"
            description="Choose the brand flow, sender domains, and who each brand should route through."
            summary={identitySummary}
            status={identityStatus}
            active={activeStep === "identity"}
            icon={Fingerprint}
            onClick={() => setActiveStep("identity")}
          />
          <StepCard
            stepNumber="2"
            title="Connections"
            description="Connect the delivery stack and keep provider credentials hidden until you need them."
            summary={connectionSummary}
            status={connectionsStatus}
            active={activeStep === "connections"}
            icon={Link2}
            onClick={() => setActiveStep("connections")}
          />
          <StepCard
            stepNumber="3"
            title="Delivery"
            description="Connect the inboxes where replies should land and keep advanced mail settings collapsed."
            summary={deliverySummary}
            status={deliveryStatus}
            active={activeStep === "delivery"}
            icon={Inbox}
            onClick={() => setActiveStep("delivery")}
          />
        </div>

        <div className="space-y-5">
          {activeStep === "identity" ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">Choose the Brand Flow</CardTitle>
                    {setupStatusBadge(identityStatus, identityStatus === "complete" ? "Flow connected" : undefined)}
                  </div>
                  <CardDescription>
                    This step is about the user-facing flow: what domain a brand uses, where it forwards, and which
                    sending and reply accounts it should rely on.
                  </CardDescription>
                </CardHeader>
                {identityPrerequisites.length ? (
                  <CardContent className="pt-0">
                    <div className="rounded-3xl border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] p-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 h-4 w-4 text-[color:var(--danger)]" />
                        <div className="grid gap-1 text-sm text-[color:var(--danger)]">
                          <div className="font-semibold">A few prerequisites are still missing</div>
                          {identityPrerequisites.map((item) => (
                            <div key={item}>{item}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                ) : null}
              </Card>

              <SenderProvisionCard
                brands={brands}
                mailboxAccounts={mailboxAccounts}
                customerIoAccounts={deliveryAccounts}
                assignments={assignments}
                provisioningSettings={provisioningSettings}
                onProvisioned={(result) => {
                  setAccounts((prev) => {
                    const next = prev.filter((row) => row.id !== result.account.id);
                    return [result.account, ...next];
                  });
                  setBrands((prev) => prev.map((row) => (row.id === result.brand.id ? result.brand : row)));
                  if (result.assignment) {
                    setAssignments((prev) => ({
                      ...prev,
                      [result.brand.id]: {
                        accountId: result.assignment?.accountId ?? "",
                        mailboxAccountId: result.assignment?.mailboxAccountId ?? "",
                      },
                    }));
                  }
                }}
              />

              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">What Still Needs Attention?</CardTitle>
                    {setupStatusBadge(
                      brandsNeedingAttention.length ? "attention" : "complete",
                      brandsNeedingAttention.length ? `${brandsNeedingAttention.length} brand${brandsNeedingAttention.length === 1 ? "" : "s"} blocked` : "All clear"
                    )}
                  </div>
                  <CardDescription>
                    Incomplete brands stay expanded here. Fully configured brands move into a collapsed success state so
                    the page keeps focus on what is left.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {brandsNeedingAttention.length ? (
                    brandsNeedingAttention.map((row) => {
                      const assignedMailboxEmail = row.mailbox?.config.mailbox.email?.trim() ?? "";
                      return (
                        <div
                          key={row.brand.id}
                          className="grid gap-3 rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 md:grid-cols-[1fr_240px_240px] md:items-center"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">{row.brand.name}</div>
                            <div className="text-xs text-[color:var(--muted-foreground)]">{row.brand.website}</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Badge variant={row.deliveryPass ? "success" : row.deliveryAssigned ? "danger" : "muted"}>
                                {row.deliveryAssigned
                                  ? row.deliveryPass
                                    ? "Sending ready"
                                    : row.deliveryTested
                                      ? "Sending needs attention"
                                      : "Sending not tested"
                                  : "Sending unassigned"}
                              </Badge>
                              <Badge variant={row.mailboxPass ? "success" : row.mailboxAssigned ? "danger" : "muted"}>
                                {row.mailboxAssigned
                                  ? row.mailboxPass
                                    ? "Replies ready"
                                    : row.mailboxTested
                                      ? "Replies need attention"
                                      : "Replies not tested"
                                  : "Replies unassigned"}
                              </Badge>
                            </div>
                          </div>

                          <div className="grid gap-1">
                            <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                              Sending account
                            </div>
                            <Select
                              value={row.assignment.accountId}
                              onChange={(event) => void onAssign(row.brand.id, { accountId: event.target.value })}
                            >
                              <option value="">Choose sending account</option>
                              {deliveryAccounts.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.name}
                                </option>
                              ))}
                            </Select>
                            {row.delivery ? (
                              <div className="text-xs text-[color:var(--muted-foreground)]">
                                From:{" "}
                                <span className="font-medium text-[color:var(--foreground)]">
                                  {row.delivery.config.customerIo.fromEmail || "not set"}
                                </span>
                              </div>
                            ) : (
                              <Button type="button" variant="ghost" size="sm" className="justify-start px-0" onClick={() => setActiveStep("connections")}>
                                Open Connections
                              </Button>
                            )}
                          </div>

                          <div className="grid gap-1">
                            <div className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                              Reply inbox
                            </div>
                            <Select
                              value={row.assignment.mailboxAccountId}
                              onChange={(event) => void onAssign(row.brand.id, { mailboxAccountId: event.target.value })}
                            >
                              <option value="">Choose reply inbox</option>
                              {mailboxAccounts.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.name}
                                </option>
                              ))}
                            </Select>
                            {row.assignment.mailboxAccountId ? (
                              <div className="text-xs text-[color:var(--muted-foreground)]">
                                Reply-To:{" "}
                                <span className="font-medium text-[color:var(--foreground)]">
                                  {assignedMailboxEmail || "not set"}
                                </span>
                              </div>
                            ) : (
                              <Button type="button" variant="ghost" size="sm" className="justify-start px-0" onClick={() => setActiveStep("delivery")}>
                                Open Delivery
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-3xl border border-[color:var(--success-border)] bg-[color:var(--success-soft)] p-4 text-sm text-[color:var(--success)]">
                      Every brand currently has a tested sender and a reply inbox assigned.
                    </div>
                  )}
                </CardContent>
              </Card>

              {configuredBrands.length ? (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">Configured Brands</CardTitle>
                        <Badge variant="success">
                          {configuredBrands.length} ready to run
                        </Badge>
                      </div>
                      <CardDescription>
                        Collapse the brands that are already healthy so the page keeps attention on the remaining setup work.
                      </CardDescription>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowConfiguredBrands((prev) => !prev)}
                    >
                      {showConfiguredBrands ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      {showConfiguredBrands ? "Hide" : "Review"}
                    </Button>
                  </CardHeader>
                  {showConfiguredBrands ? (
                    <CardContent className="grid gap-3">
                      {configuredBrands.map((row) => (
                        <div
                          key={row.brand.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4"
                        >
                          <div>
                            <div className="text-sm font-semibold">{row.brand.name}</div>
                            <div className="text-xs text-[color:var(--muted-foreground)]">
                              {row.delivery?.config.customerIo.fromEmail || "no sender"} · {row.mailbox?.config.mailbox.email || "no inbox"}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="success">Sending ready</Badge>
                            <Badge variant="success">Replies ready</Badge>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  ) : null}
                </Card>
              ) : null}
            </>
          ) : null}

          {activeStep === "connections" ? (
            <>
              {provisioningSettings ? (
                <ProvisioningProviderSettingsCard
                  settings={provisioningSettings}
                  onSaved={(next) => {
                    setProvisioningSettings(next);
                  }}
                />
              ) : null}

              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">Where Should We Send From?</CardTitle>
                      {setupStatusBadge(deliveryAccounts.length ? "complete" : "todo", deliveryAccounts.length ? "Connected" : "Not connected")}
                    </div>
                    <CardDescription>
                      Connect a sending account only when you need one. Existing accounts stay visible as compact status cards instead of a giant exposed form.
                    </CardDescription>
                  </div>
                  <Button type="button" variant={showDeliveryForm ? "ghost" : "outline"} onClick={() => setShowDeliveryForm((prev) => !prev)}>
                    <Send className="h-4 w-4" />
                    {showDeliveryForm ? "Hide form" : "Connect sending account"}
                  </Button>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {!showDeliveryForm ? (
                    <div className="rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 text-sm text-[color:var(--muted-foreground)]">
                      {deliveryAccounts.length
                        ? "Your sending accounts are connected. Open the form only if you need to add another sender."
                        : "No sending account connected yet. Open the form to add the first Customer.io sender."}
                    </div>
                  ) : (
                    <div className="grid gap-4 rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">Connect a Customer.io sender</div>
                          <div className="text-xs text-[color:var(--muted-foreground)]">
                            Required fields first. App API access stays tucked under advanced settings.
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowDeliveryAdvanced((prev) => !prev)}
                        >
                          <ChevronDown className={`h-4 w-4 transition ${showDeliveryAdvanced ? "rotate-180" : ""}`} />
                          {showDeliveryAdvanced ? "Hide advanced" : "Show advanced"}
                        </Button>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="grid gap-2">
                          <FieldLabel
                            htmlFor="delivery-account-name"
                            label="Account Name"
                            help="Internal label for the sender, for example Main Delivery."
                          />
                          <Input
                            id="delivery-account-name"
                            value={deliveryForm.name}
                            onChange={(event) => setDeliveryForm((prev) => ({ ...prev, name: event.target.value }))}
                            placeholder="Main Delivery"
                            aria-invalid={Boolean(deliveryErrors.name)}
                            className={invalidFieldClass(Boolean(deliveryErrors.name))}
                          />
                          <FieldError message={deliveryErrors.name} />
                        </div>
                        <div className="grid gap-2">
                          <FieldLabel
                            htmlFor="delivery-from-email"
                            label="From Email"
                            help="The sender address recipients see. It must live on a verified Customer.io sending domain."
                          />
                          <Input
                            id="delivery-from-email"
                            value={deliveryForm.fromEmail}
                            onChange={(event) => setDeliveryForm((prev) => ({ ...prev, fromEmail: event.target.value }))}
                            placeholder="zeynep@brand.com"
                            aria-invalid={Boolean(deliveryErrors.fromEmail)}
                            className={invalidFieldClass(Boolean(deliveryErrors.fromEmail))}
                          />
                          <FieldError message={deliveryErrors.fromEmail} />
                        </div>
                        <div className="grid gap-2">
                          <FieldLabel
                            htmlFor="delivery-site-id"
                            label="Customer.io Site ID"
                            help="Customer.io -> Settings -> API Credentials. Copy the Site ID from the same row as your Tracking API key."
                          />
                          <Input
                            id="delivery-site-id"
                            value={deliveryForm.siteId}
                            onChange={(event) => setDeliveryForm((prev) => ({ ...prev, siteId: event.target.value }))}
                            placeholder="9336ae1a489137ebb1e5"
                            aria-invalid={Boolean(deliveryErrors.siteId)}
                            className={invalidFieldClass(Boolean(deliveryErrors.siteId))}
                          />
                          <FieldError message={deliveryErrors.siteId} />
                        </div>
                        <div className="grid gap-2">
                          <FieldLabel
                            htmlFor="delivery-api-key"
                            label="Tracking API Key"
                            help="Customer.io -> Settings -> API Credentials. Use the Tracking API key, not the App API key."
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
                        {showDeliveryAdvanced ? (
                          <div className="grid gap-2 md:col-span-2">
                            <FieldLabel
                              htmlFor="delivery-app-api-key"
                              label="Customer.io App API Key"
                              help="Optional but recommended. Lets the platform check workspace people counts before you hit the monthly profile cap."
                            />
                            <Input
                              id="delivery-app-api-key"
                              type="password"
                              value={deliveryForm.customerIoAppApiKey}
                              onChange={(event) =>
                                setDeliveryForm((prev) => ({ ...prev, customerIoAppApiKey: event.target.value }))
                              }
                              placeholder="Optional App API key"
                            />
                          </div>
                        ) : null}
                      </div>

                      <div className="flex justify-end">
                        <Button type="button" disabled={savingDelivery} onClick={createDeliveryAccount}>
                          {savingDelivery ? "Saving..." : "Connect sender"}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <AccountListCard
                title="Connected Sending Accounts"
                description="Compact status cards so users can scan health without reopening setup fields."
                emptyMessage="No sending accounts connected yet."
                testScope="customerio"
                accounts={deliveryAccounts}
                setAccounts={setAccounts}
                setError={setError}
                onDeleteAccount={onDeleteAccount}
              />
            </>
          ) : null}

          {activeStep === "delivery" ? (
            <>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">Where Should We Send Replies?</CardTitle>
                      {setupStatusBadge(mailboxAccounts.length ? "complete" : "todo", mailboxAccounts.length ? "Connected" : "Not connected")}
                    </div>
                    <CardDescription>
                      Reply inboxes stay hidden behind a single action. Advanced IMAP fields only open if the user asks for them.
                    </CardDescription>
                  </div>
                  <Button type="button" variant={showMailboxForm ? "ghost" : "outline"} onClick={() => setShowMailboxForm((prev) => !prev)}>
                    <Inbox className="h-4 w-4" />
                    {showMailboxForm ? "Hide form" : "Connect reply inbox"}
                  </Button>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {!showMailboxForm ? (
                    <div className="rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 text-sm text-[color:var(--muted-foreground)]">
                      {mailboxAccounts.length
                        ? "Your reply inboxes are connected. Open the form only when you need another mailbox."
                        : "No reply inbox connected yet. Open the form to connect the inbox where human replies should land."}
                    </div>
                  ) : (
                    <div className="grid gap-4 rounded-3xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
                      <div>
                        <div className="text-sm font-semibold">Connect a reply inbox</div>
                        <div className="text-xs text-[color:var(--muted-foreground)]">
                          Start with the inbox and password. Only open advanced IMAP settings if the provider needs custom server details.
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="grid gap-2">
                          <FieldLabel
                            htmlFor="mailbox-account-name"
                            label="Account Name"
                            help="Internal label for this reply inbox, for example Sales Inbox."
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
                            htmlFor="mailbox-email"
                            label="Reply Inbox Email"
                            help="This is where replies land. The platform uses it as Reply-To when the mailbox is assigned to a brand."
                          />
                          <Input
                            id="mailbox-email"
                            value={mailboxForm.mailboxEmail}
                            onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxEmail: event.target.value }))}
                            aria-invalid={Boolean(mailboxErrors.mailboxEmail)}
                            className={invalidFieldClass(Boolean(mailboxErrors.mailboxEmail))}
                          />
                          <FieldError message={mailboxErrors.mailboxEmail} />
                        </div>
                        <div className="grid gap-2">
                          <FieldLabel
                            htmlFor="mailbox-provider"
                            label="Mailbox Provider"
                            help="Choose Gmail or Outlook for defaults. Choose IMAP only if you need custom server settings."
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
                              Using {mailboxForm.mailboxHost}:{mailboxForm.mailboxPort} by default.
                            </div>
                          ) : null}
                        </div>
                        <div className="grid gap-2">
                          <FieldLabel
                            htmlFor="mailbox-auth-method"
                            label="Connection Method"
                            help="App password is the simplest path for Gmail and Outlook. OAuth is for advanced setups that already have tokens."
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
                            htmlFor="mailbox-password"
                            label="App Password"
                            help="Use a mailbox app password here, not the normal login password. For Gmail, enable 2-Step Verification before generating it."
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
                                label="OAuth Access Token"
                                help="Only needed if you already manage mailbox OAuth tokens outside this app."
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
                                label="OAuth Refresh Token"
                                help="Optional refresh token used to renew access automatically."
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
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <button
                          type="button"
                          className="text-xs font-medium text-[color:var(--muted-foreground)] underline decoration-dotted underline-offset-4"
                          onClick={() => setShowMailboxAdvanced((prev) => !prev)}
                        >
                          {showMailboxAdvanced ? "Hide advanced IMAP settings" : "Show advanced IMAP settings"}
                        </button>
                        <div className="text-xs text-[color:var(--muted-foreground)]">
                          Sending address still comes from the assigned sending account.
                        </div>
                      </div>

                      {showMailboxAdvanced || mailboxForm.mailboxProvider === "imap" ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="grid gap-2">
                            <FieldLabel
                              htmlFor="mailbox-host"
                              label="IMAP Host"
                              help="Gmail uses imap.gmail.com. Outlook uses outlook.office365.com."
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
                              label="IMAP Port"
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
                        </div>
                      ) : null}

                      <div className="flex justify-end">
                        <Button type="button" disabled={savingMailbox} onClick={createMailboxAccount}>
                          {savingMailbox ? "Saving..." : "Connect reply inbox"}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <AccountListCard
                title="Connected Reply Inboxes"
                description="Reply accounts stay compact until the user wants to test, pause, or replace them."
                emptyMessage="No reply inboxes connected yet."
                testScope="mailbox"
                accounts={mailboxAccounts}
                setAccounts={setAccounts}
                setError={setError}
                onDeleteAccount={onDeleteAccount}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
