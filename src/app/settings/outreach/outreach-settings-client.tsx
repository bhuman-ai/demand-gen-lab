"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AlertCircle, ExternalLink, LoaderCircle, Plus, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  assignBrandOutreachAccount,
  createOutreachAccountApi,
  deleteOutreachAccountApi,
  fetchBrandOutreachAssignment,
  fetchBrands,
  fetchOutreachAccounts,
  fetchOutreachProvisioningSettings,
  refreshMailpoolOutreachAccount,
  testOutreachAccount,
  updateOutreachAccountApi,
  updateBrandApi,
} from "@/lib/client-api";
import {
  getDomainDeliveryAccountId,
  getOutreachAccountFromEmail,
  outreachProviderLabel,
} from "@/lib/outreach-account-helpers";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, OutreachAccount, OutreachProvisioningSettings } from "@/lib/factory-types";
import ProvisioningProviderSettingsCard from "./provisioning-provider-settings-card";
import SenderProvisionCard from "./sender-provision-card";
import { FieldLabel, SettingsModal, formatRelativeTimeLabel } from "./settings-primitives";

type FieldErrors<T> = Partial<Record<keyof T, string>>;

type AssignmentChoice = {
  accountId: string;
  accountIds: string[];
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

type SetupTabId = "profile" | "identity" | "integrations" | "email";
type SetupStepStatus = "complete" | "attention" | "todo";

const ACTIVE_BRAND_KEY = "factory.activeBrandId";
const CUSTOMER_IO_HELP_URL = "https://docs.customer.io/journeys/api-credentials/";

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

function normalizeAssignmentAccountIds(value: string[] | undefined, primaryAccountId = "") {
  const ids = new Set(
    (Array.isArray(value) ? value : []).map((entry) => String(entry ?? "").trim()).filter((entry) => entry.length > 0)
  );
  const primary = primaryAccountId.trim();
  if (primary) ids.add(primary);
  return Array.from(ids);
}

function normalizeAssignmentChoice(value?: Partial<AssignmentChoice> | null): AssignmentChoice {
  const requestedAccountId = String(value?.accountId ?? "").trim();
  const accountIds = normalizeAssignmentAccountIds(value?.accountIds, requestedAccountId);
  return {
    accountId: requestedAccountId || accountIds[0] || "",
    accountIds,
    mailboxAccountId: String(value?.mailboxAccountId ?? "").trim(),
  };
}

function normalizeDomainHost(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  const emailDomain = trimmed.includes("@") ? trimmed.split("@")[1] ?? "" : trimmed;
  return emailDomain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();
}

function normalizeLineList(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizeWebsiteForPrefill(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname || !parsed.hostname.includes(".")) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function mergePrefillValue(current: string, next: string, overwrite = false) {
  const normalizedNext = next.trim();
  if (!normalizedNext) return current;
  if (overwrite || !current.trim()) return normalizedNext;
  return current;
}

function mergePrefillLines(current: string, next: string[], overwrite = false) {
  const normalizedNext = next.map((line) => line.trim()).filter(Boolean).join("\n");
  if (!normalizedNext) return current;
  if (overwrite || !normalizeLineList(current).length) return normalizedNext;
  return current;
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

function SetupTabButton({
  title,
  summary,
  status,
  active,
  onClick,
}: {
  title: string;
  summary: string;
  status: SetupStepStatus;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-[220px] border-b-2 px-1 py-3 text-left transition ${
        active
          ? "border-[color:var(--foreground)] text-[color:var(--foreground)]"
          : "border-transparent text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{title}</span>
        {setupStatusBadge(status)}
      </div>
      <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{summary}</div>
    </button>
  );
}

function mailboxProviderLabel(provider: MailboxFormState["mailboxProvider"]) {
  if (provider === "gmail") return "Gmail";
  if (provider === "outlook") return "Outlook";
  return "Custom IMAP";
}

function isDeliverabilityMonitorAccount(account: OutreachAccount) {
  return account.name.trim().toLowerCase().startsWith("deliverability ");
}

function CustomerIoBudgetMeter({ account }: { account: OutreachAccount }) {
  const budget = account.customerIoBilling;
  if (!budget) return null;

  const ratio =
    budget.monthlyProfileLimit > 0
      ? Math.max(0, Math.min(1, budget.projectedProfiles / budget.monthlyProfileLimit))
      : 0;

  return (
    <div className="mt-2 grid gap-1">
      <div className="text-xs text-[color:var(--muted-foreground)]">
        {budget.baselineReady
          ? `${budget.projectedProfiles.toLocaleString()}/${budget.monthlyProfileLimit.toLocaleString()} profiles this month`
          : `Waiting for baseline sync since ${budget.billingPeriodStart}`}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[color:var(--surface)]">
        <div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  );
}

type AccountInventoryCardProps = {
  title: string;
  description: string;
  emptyMessage: string;
  addLabel: string;
  testScope: "customerio" | "mailbox";
  accounts: OutreachAccount[];
  setAccounts: Dispatch<SetStateAction<OutreachAccount[]>>;
  setError: Dispatch<SetStateAction<string>>;
  onDeleteAccount: (accountId: string) => Promise<void>;
  onAdd: () => void;
};

function AccountInventoryCard({
  title,
  description,
  emptyMessage,
  addLabel,
  testScope,
  accounts,
  setAccounts,
  setError,
  onDeleteAccount,
  onAdd,
}: AccountInventoryCardProps) {
  const [testStateByAccountId, setTestStateByAccountId] = useState<
    Record<string, { ok: boolean; message: string; testedAt: string }>
  >({});
  const [testingByAccountId, setTestingByAccountId] = useState<Record<string, boolean>>({});
  const [refreshingByAccountId, setRefreshingByAccountId] = useState<Record<string, boolean>>({});
  const [deletingByAccountId, setDeletingByAccountId] = useState<Record<string, boolean>>({});

  const testLabel = testScope === "customerio" ? "Check sender" : "Check inbox";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button type="button" variant="outline" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          {addLabel}
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {accounts.length ? (
          <div className="overflow-hidden rounded-xl border border-[color:var(--border)]">
            {accounts.map((account) => {
              const isSender = account.accountType !== "mailbox";
              const primaryAddress = isSender ? getOutreachAccountFromEmail(account) : account.config.mailbox.email;
              const connectionLabel = isSender
                ? account.provider === "mailpool"
                  ? `${outreachProviderLabel(account)} SMTP ${account.config.mailbox.smtpHost || "missing"}`
                  : `Customer.io Site ${account.config.customerIo.siteId || "missing"}`
                : `${mailboxProviderLabel(account.config.mailbox.provider)} inbox`;
              const healthBadge =
                account.lastTestStatus === "pass" ? "success" : account.lastTestStatus === "fail" ? "danger" : "muted";

              return (
                <div
                  key={account.id}
                  className="grid gap-4 border-t border-[color:var(--border)] px-4 py-4 first:border-t-0 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-semibold">{account.name}</div>
                      <Badge variant={account.status === "active" ? "success" : "muted"}>{account.status}</Badge>
                    </div>
                    <div className="mt-1 text-sm">{primaryAddress || "Address not set"}</div>
                    <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                      {isSender
                        ? `${outreachProviderLabel(account)} sender`
                        : `${mailboxProviderLabel(account.config.mailbox.provider)} reply inbox`}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="text-sm">{connectionLabel}</div>
                    {!isSender ? (
                      <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                        {account.config.mailbox.host}:{account.config.mailbox.port}
                      </div>
                    ) : null}
                    {isSender ? <CustomerIoBudgetMeter account={account} /> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={healthBadge}>
                        {account.lastTestStatus === "unknown" ? "Not checked" : account.lastTestStatus}
                      </Badge>
                      <div className="text-xs text-[color:var(--muted-foreground)]">
                        Last checked {formatRelativeTimeLabel(account.lastTestAt, "Never")}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(
                        testingByAccountId[account.id] ||
                          deletingByAccountId[account.id] ||
                          refreshingByAccountId[account.id]
                      )}
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
                      {testingByAccountId[account.id] ? "Checking..." : testLabel}
                    </Button>
                    {isSender && account.provider === "mailpool" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(
                          testingByAccountId[account.id] ||
                            deletingByAccountId[account.id] ||
                            refreshingByAccountId[account.id]
                        )}
                        onClick={async () => {
                          setError("");
                          try {
                            setRefreshingByAccountId((prev) => ({ ...prev, [account.id]: true }));
                            await refreshMailpoolOutreachAccount(account.id);
                            const refreshed = await fetchOutreachAccounts();
                            setAccounts(refreshed);
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Mailpool refresh failed");
                          } finally {
                            setRefreshingByAccountId((prev) => ({ ...prev, [account.id]: false }));
                          }
                        }}
                      >
                        {refreshingByAccountId[account.id] ? "Refreshing..." : "Refresh Mailpool"}
                      </Button>
                    ) : null}
                    <Select
                      value={account.status}
                      className="w-[120px]"
                      disabled={Boolean(deletingByAccountId[account.id] || refreshingByAccountId[account.id])}
                      onChange={async (event) => {
                        const status = event.target.value === "inactive" ? "inactive" : "active";
                        const updated = await updateOutreachAccountApi(account.id, { status });
                        setAccounts((prev) => prev.map((row) => (row.id === account.id ? updated : row)));
                      }}
                    >
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                    </Select>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={Boolean(
                        deletingByAccountId[account.id] ||
                          testingByAccountId[account.id] ||
                          refreshingByAccountId[account.id]
                      )}
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
                  </div>

                  {testStateByAccountId[account.id] ? (
                    <div
                      className={`rounded-lg border px-3 py-2 text-xs md:col-span-3 ${
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
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[color:var(--border)] px-4 py-5 text-sm text-[color:var(--muted-foreground)]">
            {emptyMessage}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function OutreachSettingsClient() {
  const [accounts, setAccounts] = useState<OutreachAccount[]>([]);
  const [brands, setBrands] = useState<BrandRecord[]>([]);
  const [provisioningSettings, setProvisioningSettings] = useState<OutreachProvisioningSettings | null>(null);
  const [assignments, setAssignments] = useState<AssignmentMap>({});
  const [activeBrandId, setActiveBrandId] = useState("");

  const [deliveryForm, setDeliveryForm] = useState<DeliveryFormState>(INITIAL_DELIVERY_FORM);
  const [mailboxForm, setMailboxForm] = useState<MailboxFormState>(INITIAL_MAILBOX_FORM);
  const [mailboxAuthMethod, setMailboxAuthMethod] = useState<MailboxAuthMethod>("app_password");
  const [showMailboxAdvanced, setShowMailboxAdvanced] = useState(false);
  const [showDeliveryAdvanced, setShowDeliveryAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState<SetupTabId>("profile");
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [mailboxModalOpen, setMailboxModalOpen] = useState(false);
  const [autoSelectedTab, setAutoSelectedTab] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profilePrefillLoading, setProfilePrefillLoading] = useState(false);
  const [profilePrefillFeedback, setProfilePrefillFeedback] = useState<{
    tone: "idle" | "success" | "error";
    message: string;
  }>({
    tone: "idle",
    message: "",
  });

  const [brandWebsite, setBrandWebsite] = useState("");
  const [brandTone, setBrandTone] = useState("");
  const [brandProduct, setBrandProduct] = useState("");
  const [brandNotes, setBrandNotes] = useState("");
  const [brandMarketsText, setBrandMarketsText] = useState("");
  const [brandIcpText, setBrandIcpText] = useState("");
  const [brandFeaturesText, setBrandFeaturesText] = useState("");
  const [brandBenefitsText, setBrandBenefitsText] = useState("");

  const [deliveryErrors, setDeliveryErrors] = useState<FieldErrors<DeliveryFormState>>({});
  const [mailboxErrors, setMailboxErrors] = useState<FieldErrors<MailboxFormState>>({});

  const [savingDelivery, setSavingDelivery] = useState(false);
  const [savingMailbox, setSavingMailbox] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const profileAutoPrefillKeyRef = useRef("");

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const syncActiveBrand = () => {
      setActiveBrandId(localStorage.getItem(ACTIVE_BRAND_KEY) ?? "");
    };

    syncActiveBrand();
    window.addEventListener("storage", syncActiveBrand);
    window.addEventListener("focus", syncActiveBrand);
    return () => {
      window.removeEventListener("storage", syncActiveBrand);
      window.removeEventListener("focus", syncActiveBrand);
    };
  }, []);

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
              assignment: normalizeAssignmentChoice(row.assignment),
            };
          })
        );

        if (!mounted) return;

        const map: AssignmentMap = {};
        for (const row of assignmentPairs) {
          map[row.brandId] = row.assignment;
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

  useEffect(() => {
    if (!brands.length || typeof window === "undefined") return;
    const storedBrandId = localStorage.getItem(ACTIVE_BRAND_KEY) ?? "";
    const nextBrandId = brands.some((brand) => brand.id === storedBrandId)
      ? storedBrandId
      : brands[0]?.id ?? "";
    if (nextBrandId && nextBrandId !== storedBrandId) {
      localStorage.setItem(ACTIVE_BRAND_KEY, nextBrandId);
    }
    if (nextBrandId !== activeBrandId) {
      setActiveBrandId(nextBrandId);
    }
  }, [activeBrandId, brands]);

  useEffect(() => {
    setAutoSelectedTab(false);
  }, [activeBrandId]);

  const deliveryAccounts = useMemo(
    () => accounts.filter((account) => account.accountType !== "mailbox"),
    [accounts]
  );

  const mailboxAccounts = useMemo(
    () =>
      accounts.filter(
        (account) => account.accountType !== "delivery" && !isDeliverabilityMonitorAccount(account)
      ),
    [accounts]
  );

  const selectedBrand = useMemo(
    () => brands.find((brand) => brand.id === activeBrandId) ?? brands[0] ?? null,
    [activeBrandId, brands]
  );

  useEffect(() => {
    if (!selectedBrand) {
      setBrandWebsite("");
      setBrandTone("");
      setBrandProduct("");
      setBrandNotes("");
      setBrandMarketsText("");
      setBrandIcpText("");
      setBrandFeaturesText("");
      setBrandBenefitsText("");
      return;
    }

    setBrandWebsite(selectedBrand.website || "");
    setBrandTone(selectedBrand.tone || "");
    setBrandProduct(selectedBrand.product || "");
    setBrandNotes(selectedBrand.notes || "");
    setBrandMarketsText((selectedBrand.targetMarkets ?? []).join("\n"));
      setBrandIcpText((selectedBrand.idealCustomerProfiles ?? []).join("\n"));
      setBrandFeaturesText((selectedBrand.keyFeatures ?? []).join("\n"));
      setBrandBenefitsText((selectedBrand.keyBenefits ?? []).join("\n"));
    }, [selectedBrand]);

  useEffect(() => {
    profileAutoPrefillKeyRef.current = "";
    setProfilePrefillFeedback({ tone: "idle", message: "" });
  }, [selectedBrand?.id]);

  const scopedBrands = useMemo(() => (selectedBrand ? [selectedBrand] : []), [selectedBrand]);
  const selectedBrandSenderAccounts = useMemo(() => {
    if (!selectedBrand) return [] as OutreachAccount[];
    const assignment = normalizeAssignmentChoice(assignments[selectedBrand.id]);
    const senderDomainSet = new Set<string>();
    for (const domainRow of selectedBrand.domains) {
      const normalizedDomain = normalizeDomainHost(domainRow.domain);
      if (normalizedDomain) senderDomainSet.add(normalizedDomain);
      const fromDomain = normalizeDomainHost(domainRow.fromEmail ?? "");
      if (fromDomain) senderDomainSet.add(fromDomain);
    }
    const websiteDomain = normalizeDomainHost(selectedBrand.website);
    if (websiteDomain) senderDomainSet.add(websiteDomain);

    const knownAccountIds = new Set<string>(
      [
        assignment.accountId,
        ...assignment.accountIds,
        ...selectedBrand.domains.map((domainRow) => getDomainDeliveryAccountId(domainRow)),
      ].filter(Boolean)
    );

    return deliveryAccounts
      .filter((account) => {
        if (knownAccountIds.has(account.id)) return true;
        const fromDomain = normalizeDomainHost(getOutreachAccountFromEmail(account));
        return Boolean(fromDomain && senderDomainSet.has(fromDomain));
      })
      .filter(
        (account, index, rows) => rows.findIndex((candidate) => candidate.id === account.id) === index
      );
  }, [assignments, deliveryAccounts, selectedBrand]);

  const providerDefaultsReady = Boolean(
    (provisioningSettings?.customerIo.siteId.trim() &&
      provisioningSettings.customerIo.hasTrackingApiKey &&
      provisioningSettings?.namecheap.apiUser.trim() &&
      provisioningSettings.namecheap.hasApiKey &&
      provisioningSettings?.namecheap.clientIp.trim()) ||
      provisioningSettings?.mailpool.hasApiKey
  );
  const draftTargetMarkets = useMemo(() => normalizeLineList(brandMarketsText), [brandMarketsText]);
  const draftIcpList = useMemo(() => normalizeLineList(brandIcpText), [brandIcpText]);
  const draftFeatureList = useMemo(() => normalizeLineList(brandFeaturesText), [brandFeaturesText]);
  const draftBenefitList = useMemo(() => normalizeLineList(brandBenefitsText), [brandBenefitsText]);
  const normalizedBrandWebsite = useMemo(() => normalizeWebsiteForPrefill(brandWebsite), [brandWebsite]);
  const normalizedSavedWebsite = useMemo(
    () => normalizeWebsiteForPrefill(selectedBrand?.website ?? ""),
    [selectedBrand?.website]
  );
  const draftBrandContextStarted = Boolean(
    brandProduct.trim() ||
      brandTone.trim() ||
      brandNotes.trim() ||
      draftTargetMarkets.length ||
      draftIcpList.length ||
      draftFeatureList.length ||
      draftBenefitList.length
  );
  const brandProfileReady = Boolean(selectedBrand && brandProduct.trim() && draftIcpList.length && draftBenefitList.length);

  useEffect(() => {
    if (loading || autoSelectedTab) return;

    if (selectedBrand && !brandProfileReady) {
      setActiveTab("profile");
    } else if (!providerDefaultsReady || !deliveryAccounts.length) {
      setActiveTab("integrations");
    } else if (!mailboxAccounts.length) {
      setActiveTab("email");
    } else {
      setActiveTab("identity");
    }

    setAutoSelectedTab(true);
  }, [autoSelectedTab, brandProfileReady, deliveryAccounts.length, loading, mailboxAccounts.length, providerDefaultsReady, selectedBrand]);

  function closeDeliveryModal() {
    setDeliveryModalOpen(false);
    setDeliveryForm(INITIAL_DELIVERY_FORM);
    setDeliveryErrors({});
    setShowDeliveryAdvanced(false);
  }

  function closeMailboxModal() {
    setMailboxModalOpen(false);
    setMailboxForm(INITIAL_MAILBOX_FORM);
    setMailboxErrors({});
    setMailboxAuthMethod("app_password");
    setShowMailboxAdvanced(false);
  }

  const runWebsitePrefill = async (options?: { overwrite?: boolean; source?: "auto" | "manual" }) => {
    if (!selectedBrand || !normalizedBrandWebsite) return;

    const overwrite = Boolean(options?.overwrite);
    const source = options?.source ?? "manual";
    const prefillKey = `${selectedBrand.id}:${normalizedBrandWebsite}`;

    setProfilePrefillLoading(true);
    if (source === "manual") {
      setProfilePrefillFeedback({ tone: "idle", message: "" });
    }

    try {
      const response = await fetch("/api/intake/prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalizedBrandWebsite }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        prefill?: {
          tone?: string;
          product?: string;
          targetMarkets?: string[];
          idealCustomerProfiles?: string[];
          keyFeatures?: string[];
          keyBenefits?: string[];
          proof?: string;
        };
      };

      if (!response.ok) {
        throw new Error(data?.error || "Website analysis failed.");
      }

      const prefill = data.prefill ?? {};

      setBrandWebsite(normalizedBrandWebsite);
      setBrandTone((current) => mergePrefillValue(current, String(prefill.tone ?? ""), overwrite));
      setBrandProduct((current) => mergePrefillValue(current, String(prefill.product ?? ""), overwrite));
      setBrandNotes((current) => mergePrefillValue(current, String(prefill.proof ?? ""), overwrite));
      setBrandMarketsText((current) =>
        mergePrefillLines(current, Array.isArray(prefill.targetMarkets) ? prefill.targetMarkets : [], overwrite)
      );
      setBrandIcpText((current) =>
        mergePrefillLines(
          current,
          Array.isArray(prefill.idealCustomerProfiles) ? prefill.idealCustomerProfiles : [],
          overwrite
        )
      );
      setBrandFeaturesText((current) =>
        mergePrefillLines(current, Array.isArray(prefill.keyFeatures) ? prefill.keyFeatures : [], overwrite)
      );
      setBrandBenefitsText((current) =>
        mergePrefillLines(current, Array.isArray(prefill.keyBenefits) ? prefill.keyBenefits : [], overwrite)
      );

      profileAutoPrefillKeyRef.current = prefillKey;
      setProfilePrefillFeedback({
        tone: "success",
        message:
          source === "auto"
            ? "Website analyzed. The rest of the brief was drafted for you."
            : "Website analyzed again. The brief was refreshed from the site.",
      });
    } catch (err) {
      profileAutoPrefillKeyRef.current = prefillKey;
      setProfilePrefillFeedback({
        tone: "error",
        message: err instanceof Error ? err.message : "Website analysis failed.",
      });
    } finally {
      setProfilePrefillLoading(false);
    }
  };

  const runAutoWebsitePrefill = useEffectEvent((overwrite: boolean) => {
    void runWebsitePrefill({
      overwrite,
      source: "auto",
    });
  });

  useEffect(() => {
    if (!selectedBrand || !normalizedBrandWebsite || profilePrefillLoading) return;

    const prefillKey = `${selectedBrand.id}:${normalizedBrandWebsite}`;
    if (profileAutoPrefillKeyRef.current === prefillKey) return;

    const websiteChanged = normalizedBrandWebsite !== normalizedSavedWebsite;
    if (!websiteChanged && draftBrandContextStarted) return;

    const timeout = window.setTimeout(() => {
      runAutoWebsitePrefill(websiteChanged);
    }, 900);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    draftBrandContextStarted,
    normalizedBrandWebsite,
    normalizedSavedWebsite,
    profilePrefillLoading,
    selectedBrand,
  ]);

  const saveBrandProfile = async () => {
    if (!selectedBrand) return;

    setProfileSaving(true);
    setError("");

    try {
      const updated = await updateBrandApi(selectedBrand.id, {
        website: normalizedBrandWebsite || brandWebsite.trim(),
        tone: brandTone.trim(),
        product: brandProduct.trim(),
        notes: brandNotes.trim(),
        targetMarkets: draftTargetMarkets,
        idealCustomerProfiles: draftIcpList,
        keyFeatures: draftFeatureList,
        keyBenefits: draftBenefitList,
      });

      setBrands((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save brand brief");
    } finally {
      setProfileSaving(false);
    }
  };

  const createDeliveryAccount = async () => {
    const nextErrors: FieldErrors<DeliveryFormState> = {};
    if (!deliveryForm.name.trim()) nextErrors.name = "Required.";
    if (!deliveryForm.siteId.trim()) nextErrors.siteId = "Required.";
    if (!deliveryForm.customerIoApiKey.trim()) nextErrors.customerIoApiKey = "Required.";
    if (!deliveryForm.fromEmail.trim()) nextErrors.fromEmail = "Required.";

    const siteId = deliveryForm.siteId.trim();
    if (siteId && (siteId.includes("@") || siteId.includes(".") || siteId.includes(" "))) {
      nextErrors.siteId = "Paste the Site ID value, not a workspace name or email address.";
    }

    setDeliveryErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setError("Fix the highlighted fields in the sender connection modal.");
      setDeliveryModalOpen(true);
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
      trackEvent("outreach_account_connected", { accountId: created.id });
      closeDeliveryModal();

      if (activeBrandId) {
        const current = normalizeAssignmentChoice(assignments[activeBrandId]);
        if (!current.accountId) {
          await onAssign(activeBrandId, { accountId: created.id, accountIds: [created.id] });
          setActiveTab("identity");
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
    } else if (!mailboxForm.mailboxAccessToken.trim()) {
      nextErrors.mailboxAccessToken = "Access token required.";
    }

    setMailboxErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setError("Fix the highlighted fields in the reply inbox modal.");
      if (nextErrors.mailboxHost || nextErrors.mailboxPort) setShowMailboxAdvanced(true);
      setMailboxModalOpen(true);
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
      trackEvent("outreach_account_connected", { accountId: created.id });
      closeMailboxModal();

      if (activeBrandId) {
        const current = normalizeAssignmentChoice(assignments[activeBrandId]);
        if (!current.mailboxAccountId) {
          await onAssign(activeBrandId, { mailboxAccountId: created.id });
          setActiveTab("identity");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create email account");
    } finally {
      setSavingMailbox(false);
    }
  };

  const onAssign = async (brandId: string, patch: Partial<AssignmentChoice>) => {
    const current = normalizeAssignmentChoice(assignments[brandId]);
    const next = normalizeAssignmentChoice({ ...current, ...patch });
    setAssignments((prev) => ({ ...prev, [brandId]: next }));

    try {
      const saved = await assignBrandOutreachAccount(brandId, next);
      setAssignments((prev) => ({
        ...prev,
        [brandId]: normalizeAssignmentChoice(saved.assignment),
      }));
    } catch (err) {
      setAssignments((prev) => ({ ...prev, [brandId]: current }));
      setError(err instanceof Error ? err.message : "Failed to assign account");
    }
  };

  const onDeleteAccount = async (accountId: string) => {
    const deletedId = await deleteOutreachAccountApi(accountId);
    setAccounts((prev) => prev.filter((account) => account.id !== deletedId));

    setAssignments((prev) => {
      const next: AssignmentMap = {};
      for (const [brandId, row] of Object.entries(prev)) {
        const filteredAccountIds = row.accountIds.filter((accountId) => accountId !== deletedId);
        next[brandId] = normalizeAssignmentChoice({
          accountId: row.accountId === deletedId ? filteredAccountIds[0] ?? "" : row.accountId,
          accountIds: filteredAccountIds,
          mailboxAccountId: row.mailboxAccountId === deletedId ? "" : row.mailboxAccountId,
        });
      }
      return next;
    });

    const assignmentPairs = await Promise.all(
      brands.map(async (brand) => {
        const row = await fetchBrandOutreachAssignment(brand.id);
        return {
          brandId: brand.id,
          assignment: normalizeAssignmentChoice(row.assignment),
        };
      })
    );

    const map: AssignmentMap = {};
    for (const row of assignmentPairs) {
      map[row.brandId] = row.assignment;
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
      const assignment = normalizeAssignmentChoice(assignments[brand.id]);
      const selectedSenders = assignment.accountIds
        .map((accountId) => deliveryAccounts.find((account) => account.id === accountId) ?? null)
        .filter((account): account is OutreachAccount => Boolean(account));
      const delivery =
        selectedSenders.find((account) => account.id === assignment.accountId) ?? selectedSenders[0] ?? null;
      const mailbox = assignment.mailboxAccountId
        ? mailboxAccounts.find((account) => account.id === assignment.mailboxAccountId) ?? null
        : null;

      const deliveryAssigned = Boolean(selectedSenders.length);
      const mailboxAssigned = Boolean(mailbox && mailbox.status === "active");
      const deliveryTested = Boolean(delivery && delivery.lastTestAt);
      const mailboxTested = Boolean(mailbox && mailbox.lastTestAt);
      const deliveryPass = Boolean(delivery && delivery.status === "active" && delivery.lastTestStatus === "pass");
      const mailboxPass = Boolean(mailbox && mailbox.lastTestStatus === "pass");

      return {
        brand,
        assignment,
        selectedSenders,
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
  }, [assignments, brands, deliveryAccounts, mailboxAccounts]);

  const scopedBrandReadiness = useMemo(
    () => (selectedBrand ? brandReadiness.filter((row) => row.brand.id === selectedBrand.id) : []),
    [brandReadiness, selectedBrand]
  );
  const selectedBrandReadiness = scopedBrandReadiness[0] ?? null;
  const brandsNeedingAttention = useMemo(
    () => scopedBrandReadiness.filter((row) => !row.ready),
    [scopedBrandReadiness]
  );
  const selectedSenderCount = selectedBrandReadiness?.assignment.accountIds.length ?? 0;

  const profileStatus: SetupStepStatus =
    !selectedBrand
      ? "todo"
      : brandProfileReady
        ? "complete"
        : brandProduct.trim() ||
            draftIcpList.length ||
            draftBenefitList.length ||
            brandTone.trim() ||
            brandNotes.trim() ||
            draftTargetMarkets.length ||
            draftFeatureList.length
          ? "attention"
          : "todo";

  const identityStatus: SetupStepStatus =
    !selectedBrand ? "todo" : selectedBrandReadiness?.ready ? "complete" : "attention";

  const integrationsStatus: SetupStepStatus =
    providerDefaultsReady && (!selectedBrand || selectedBrandSenderAccounts.length > 0)
      ? "complete"
      : providerDefaultsReady ||
          provisioningSettings?.customerIo.lastValidatedStatus === "fail" ||
          provisioningSettings?.namecheap.lastValidatedStatus === "fail" ||
          deliveryAccounts.length > 0 ||
          selectedBrandSenderAccounts.length > 0
        ? "attention"
        : "todo";

  const emailStatus: SetupStepStatus =
    !selectedBrand
      ? "todo"
      : mailboxAccounts.length > 0
      ? brandsNeedingAttention.some((row) => !row.mailboxAssigned)
        ? "attention"
        : "complete"
      : "todo";

  const identityPrerequisites = [
    !selectedBrand ? "Pick the brand you want from the sidebar selector first." : "",
    selectedBrand && !brandProfileReady ? "Write the brand brief first so experiment ideas have context." : "",
    !providerDefaultsReady ? "Connect the delivery stack in Integrations first." : "",
    selectedBrand && !selectedBrandSenderAccounts.length
      ? `Add or provision at least one sender for ${selectedBrand.name}.`
      : "",
    !mailboxAccounts.length ? "Add at least one reply inbox in Email Accounts." : "",
  ].filter(Boolean);

  const profileSummary = !selectedBrand
    ? "Pick a brand first"
    : brandProfileReady
      ? `${draftIcpList.length} ICP${draftIcpList.length === 1 ? "" : "s"} and product context ready`
      : "Describe what you sell, who it is for, and why it matters";
  const integrationsSummary = providerDefaultsReady
    ? selectedBrand
      ? `${selectedBrandSenderAccounts.length} sender${selectedBrandSenderAccounts.length === 1 ? "" : "s"} ready for ${selectedBrand.name}`
      : `${deliveryAccounts.length} sender${deliveryAccounts.length === 1 ? "" : "s"} available`
    : "Connect Customer.io and Namecheap first";
  const emailSummary = mailboxAccounts.length
    ? `${mailboxAccounts.length} reply inbox${mailboxAccounts.length === 1 ? "" : "es"} ready`
    : "Add the inbox that should receive replies";
  const identitySummary =
    !selectedBrand
      ? "Pick a brand from the selector first"
      : selectedBrandReadiness?.ready
        ? `${selectedBrand.name} is ready to send`
        : `Choose senders and a reply inbox for ${selectedBrand.name}`;

  return (
    <>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="text-sm text-[color:var(--muted-foreground)]">
            {selectedBrand
              ? `Set up ${selectedBrand.name}. Start with the brand brief, then connect the tools, add a reply inbox, and choose senders.`
              : "Pick a brand from the sidebar to start."}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <div className="font-medium">{selectedBrand?.name || "No brand selected"}</div>
            {setupStatusBadge(
              selectedBrandReadiness?.ready ? "complete" : selectedBrand ? "attention" : "todo",
              selectedBrandReadiness?.ready ? "Ready to send" : selectedBrand ? "Setup incomplete" : "Choose brand"
            )}
            <div className="text-[color:var(--muted-foreground)]">
              {selectedSenderCount} sender{selectedSenderCount === 1 ? "" : "s"} selected
            </div>
            <div className="text-[color:var(--muted-foreground)]">
              Reply inbox: {selectedBrandReadiness?.mailbox?.name || "None"}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm">
          <div className="font-medium text-[color:var(--foreground)]">Setup order</div>
          <div className="mt-1 text-[color:var(--muted-foreground)]">
            1. Write the brand brief. 2. Connect the core tools. 3. Add the inbox that receives replies. 4. Choose
            which senders belong to this brand.
          </div>
        </div>

        {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
        {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading outreach settings...</div> : null}

        <div className="overflow-x-auto border-b border-[color:var(--border)]">
          <div className="flex min-w-max gap-6">
            <SetupTabButton
              title="Brand brief"
              summary={profileSummary}
              status={profileStatus}
              active={activeTab === "profile"}
              onClick={() => setActiveTab("profile")}
            />
            <SetupTabButton
              title="Sender setup"
              summary={identitySummary}
              status={identityStatus}
              active={activeTab === "identity"}
              onClick={() => setActiveTab("identity")}
            />
            <SetupTabButton
              title="Core tools"
              summary={integrationsSummary}
              status={integrationsStatus}
              active={activeTab === "integrations"}
              onClick={() => setActiveTab("integrations")}
            />
            <SetupTabButton
              title="Reply inboxes"
              summary={emailSummary}
              status={emailStatus}
              active={activeTab === "email"}
              onClick={() => setActiveTab("email")}
            />
          </div>
        </div>

        <div className="space-y-5">
          {activeTab === "profile" ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Brand brief</CardTitle>
                    <CardDescription>
                      Write down what this company does, who it sells to, and why buyers care. Experiment ideas and
                      prompts use this context.
                    </CardDescription>
                  </div>
                  {setupStatusBadge(profileStatus, profileStatus === "complete" ? "Ready" : undefined)}
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {selectedBrand ? (
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                    <div className="grid gap-4">
                      <div className="grid gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Label htmlFor="brand-website">Website</Label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={profilePrefillLoading || !normalizedBrandWebsite}
                            onClick={() => void runWebsitePrefill({ overwrite: true, source: "manual" })}
                          >
                            {profilePrefillLoading ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                            {profilePrefillLoading ? "Analyzing website..." : "Refresh from website"}
                          </Button>
                        </div>
                        <Input
                          id="brand-website"
                          value={brandWebsite}
                          onChange={(event) => {
                            setBrandWebsite(event.target.value);
                            setProfilePrefillFeedback({ tone: "idle", message: "" });
                          }}
                          placeholder="https://lastb2b.com"
                        />
                        <div className="text-xs text-[color:var(--muted-foreground)]">
                          Put the website here first. The rest of the brief can be drafted from it automatically.
                        </div>
                        {profilePrefillFeedback.tone !== "idle" ? (
                          <div
                            className={`rounded-lg border px-3 py-2 text-xs ${
                              profilePrefillFeedback.tone === "success"
                                ? "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]"
                                : "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
                            }`}
                          >
                            {profilePrefillFeedback.message}
                          </div>
                        ) : null}
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="brand-product">What do you sell?</Label>
                        <Textarea
                          id="brand-product"
                          value={brandProduct}
                          onChange={(event) => setBrandProduct(event.target.value)}
                          placeholder="Describe the product in plain English. What does it do, and why would someone buy it?"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="brand-benefits">Why do buyers care? (one per line)</Label>
                        <Textarea
                          id="brand-benefits"
                          value={brandBenefitsText}
                          onChange={(event) => setBrandBenefitsText(event.target.value)}
                          placeholder={"More qualified replies\nLess manual outbound work\nFaster pipeline feedback"}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="brand-tone">How should the product sound?</Label>
                        <Input
                          id="brand-tone"
                          value={brandTone}
                          onChange={(event) => setBrandTone(event.target.value)}
                          placeholder="Plainspoken, sharp, operator-first"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="brand-notes">Proof, context, or notes</Label>
                        <Textarea
                          id="brand-notes"
                          value={brandNotes}
                          onChange={(event) => setBrandNotes(event.target.value)}
                          placeholder="Customer proof, strongest claims, objections to avoid, and anything the system should remember."
                        />
                      </div>
                    </div>

                    <div className="grid gap-4">
                      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm">
                        <div className="font-medium text-[color:var(--foreground)]">This feeds the rest of the system</div>
                        <div className="mt-1 text-[color:var(--muted-foreground)]">
                          The brand brief shapes experiment ideas, targeting, and message prompts. If this is vague,
                          everything downstream gets weaker.
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="brand-markets">Who should see this? (markets, one per line)</Label>
                        <Textarea
                          id="brand-markets"
                          value={brandMarketsText}
                          onChange={(event) => setBrandMarketsText(event.target.value)}
                          placeholder={"B2B SaaS\nAgencies\nFounder-led companies"}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="brand-icps">ICPs (one per line)</Label>
                        <Textarea
                          id="brand-icps"
                          value={brandIcpText}
                          onChange={(event) => setBrandIcpText(event.target.value)}
                          placeholder={"Growth lead at a 20-200 person SaaS company\nFounder doing outbound by hand"}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="brand-features">What makes the product real? (features, one per line)</Label>
                        <Textarea
                          id="brand-features"
                          value={brandFeaturesText}
                          onChange={(event) => setBrandFeaturesText(event.target.value)}
                          placeholder={"Automated sender routing\nSpam-test probes with live content\nBuilt-in experiment generation"}
                        />
                      </div>
                    </div>

                    <div className="lg:col-span-2 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border)] pt-4">
                      <div className="text-sm text-[color:var(--muted-foreground)]">
                        Save this before asking the app to suggest experiments or write messaging.
                      </div>
                      <Button type="button" disabled={profileSaving} onClick={() => void saveBrandProfile()}>
                        {profileSaving ? "Saving..." : "Save brand brief"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[color:var(--border)] px-4 py-4 text-sm text-[color:var(--muted-foreground)]">
                    Pick a brand from the sidebar selector first.
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {activeTab === "identity" ? (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Sender setup</CardTitle>
                      <CardDescription>
                        {selectedBrand
                          ? `Choose which senders and reply inbox belong to ${selectedBrand.name}.`
                          : "Pick a brand from the sidebar, then assign senders and a reply inbox."}
                      </CardDescription>
                    </div>
                    {setupStatusBadge(identityStatus, identityStatus === "complete" ? "Ready to run" : undefined)}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {identityPrerequisites.length ? (
                    <div className="rounded-xl border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 h-4 w-4 text-[color:var(--danger)]" />
                        <div className="grid gap-1 text-sm text-[color:var(--danger)]">
                          <div className="font-medium">Finish these first</div>
                          {identityPrerequisites.map((item) => (
                            <div key={item}>{item}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2 text-sm text-[color:var(--muted-foreground)] md:grid-cols-3">
                      <div>Selected senders: {selectedSenderCount}</div>
                      <div>Default sender: {selectedBrandReadiness?.delivery?.name || "None"}</div>
                      <div>Reply inbox: {selectedBrandReadiness?.mailbox?.name || "None"}</div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {selectedBrand ? (
                <SenderProvisionCard
                  brands={scopedBrands}
                  allBrands={brands}
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
                        [result.brand.id]: normalizeAssignmentChoice(result.assignment),
                      }));
                    }
                  }}
                />
              ) : null}

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Sending setup</CardTitle>
                      <CardDescription>
                        Choose which senders belong to this brand. One sender is the default, but all selected senders
                        stay available for rotation.
                      </CardDescription>
                    </div>
                    {setupStatusBadge(
                      selectedBrandReadiness?.ready ? "complete" : selectedBrand ? "attention" : "todo",
                      selectedBrandReadiness?.ready ? "Ready to run" : selectedBrand ? "Needs attention" : "No brand selected"
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {selectedBrandReadiness ? (
                    (() => {
                      const row = selectedBrandReadiness;
                      const assignedMailboxEmail = row.mailbox?.config.mailbox.email?.trim() ?? "";

                      return (
                        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_320px]">
                          <div className="grid gap-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium">Senders for this brand</div>
                              <div className="text-xs text-[color:var(--muted-foreground)]">
                                {row.assignment.accountIds.length} selected
                              </div>
                            </div>
                            {selectedBrandSenderAccounts.length ? (
                              <div className="overflow-hidden rounded-xl border border-[color:var(--border)]">
                                {selectedBrandSenderAccounts.map((account) => {
                                  const checked = row.assignment.accountIds.includes(account.id);
                                  const healthLabel =
                                    account.lastTestStatus === "pass"
                                      ? "Ready"
                                      : account.lastTestStatus === "fail"
                                        ? "Needs attention"
                                        : "Not checked";
                                  return (
                                    <label
                                      key={account.id}
                                      className="flex items-start justify-between gap-3 border-t border-[color:var(--border)] px-4 py-3 first:border-t-0"
                                    >
                                      <div className="flex items-start gap-3">
                                        <input
                                          type="checkbox"
                                          className="mt-1 h-4 w-4"
                                          checked={checked}
                                          onChange={(event) => {
                                            const nextAccountIds = event.target.checked
                                              ? [...row.assignment.accountIds, account.id]
                                              : row.assignment.accountIds.filter((accountId) => accountId !== account.id);
                                            const nextPrimary = nextAccountIds.includes(row.assignment.accountId)
                                              ? row.assignment.accountId
                                              : nextAccountIds[0] ?? "";
                                            void onAssign(row.brand.id, {
                                              accountId: nextPrimary,
                                              accountIds: nextAccountIds,
                                            });
                                          }}
                                        />
                                        <div className="min-w-0">
                                          <div className="font-medium">{account.name}</div>
                                          <div className="text-xs text-[color:var(--muted-foreground)]">
                                            {getOutreachAccountFromEmail(account) || "From address not set"}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="text-xs text-[color:var(--muted-foreground)]">{healthLabel}</div>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="rounded-xl border border-[color:var(--border)] px-4 py-4 text-sm text-[color:var(--muted-foreground)]">
                                No senders belong to {row.brand.name} yet. Add or provision a sender for this brand in
                                Connections.
                              </div>
                            )}
                          </div>

                          <div className="grid gap-4">
                            <div className="grid gap-2">
                              <div className="text-sm font-medium">Default sender</div>
                              <Select
                                value={row.assignment.accountId}
                                onChange={(event) =>
                                  void onAssign(row.brand.id, {
                                    accountId: event.target.value,
                                    accountIds: row.assignment.accountIds,
                                  })
                                }
                                disabled={!row.selectedSenders.length}
                              >
                                <option value="">Choose default sender</option>
                                {row.selectedSenders.map((account) => (
                                  <option key={account.id} value={account.id}>
                                    {account.name}
                                  </option>
                                ))}
                              </Select>
                              <div className="text-xs text-[color:var(--muted-foreground)]">
                                From: {(row.delivery ? getOutreachAccountFromEmail(row.delivery) : "") || "Not set"}
                              </div>
                            </div>

                            <div className="grid gap-2">
                              <div className="text-sm font-medium">Reply inbox</div>
                              <Select
                                value={row.assignment.mailboxAccountId}
                                disabled={!row.assignment.accountIds.length}
                                onChange={(event) => void onAssign(row.brand.id, { mailboxAccountId: event.target.value })}
                              >
                                <option value="">Choose reply inbox</option>
                                {mailboxAccounts.map((account) => (
                                  <option key={account.id} value={account.id}>
                                    {account.name}
                                  </option>
                                ))}
                              </Select>
                              <div className="text-xs text-[color:var(--muted-foreground)]">
                                Reply-To: {assignedMailboxEmail || "Not set"}
                              </div>
                            </div>

                            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
                              <div>Website: {row.brand.website || "Not set"}</div>
                              <div className="mt-1">
                                Sender check:{" "}
                                {row.deliveryAssigned
                                  ? row.deliveryPass
                                    ? "Ready"
                                    : row.deliveryTested
                                      ? "Needs attention"
                                      : "Not checked"
                                  : "No sender selected"}
                              </div>
                              <div className="mt-1">
                                Reply check:{" "}
                                {row.mailboxAssigned
                                  ? row.mailboxPass
                                    ? "Ready"
                                    : row.mailboxTested
                                      ? "Needs attention"
                                      : "Not checked"
                                  : "No reply inbox selected"}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="rounded-xl border border-[color:var(--border)] px-4 py-4 text-sm text-[color:var(--muted-foreground)]">
                      Pick a brand from the sidebar selector to configure senders and replies.
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : null}

          {activeTab === "integrations" ? (
            <>
              {provisioningSettings ? (
                <ProvisioningProviderSettingsCard
                  settings={provisioningSettings}
                  onSaved={(next) => setProvisioningSettings(next)}
                />
              ) : null}

              <AccountInventoryCard
                title={selectedBrand ? `Senders for ${selectedBrand.name}` : "Senders"}
                description={
                  selectedBrand
                    ? "Only sender identities that belong to the selected brand appear here."
                    : "Saved sender identities you can attach to brands."
                }
                emptyMessage={
                  selectedBrand
                    ? `No senders belong to ${selectedBrand.name} yet. Add one to start sending for this brand.`
                    : "No senders connected yet. Add one to start sending."
                }
                addLabel="Add sender"
                testScope="customerio"
                accounts={selectedBrand ? selectedBrandSenderAccounts : deliveryAccounts}
                setAccounts={setAccounts}
                setError={setError}
                onDeleteAccount={onDeleteAccount}
                onAdd={() => {
                  setError("");
                  setDeliveryModalOpen(true);
                }}
              />
            </>
          ) : null}

          {activeTab === "email" ? (
            <AccountInventoryCard
              title="Reply inboxes"
              description="Mailboxes that receive human replies."
              emptyMessage="No reply inboxes connected yet. Add the inbox where replies should land."
              addLabel="Add inbox"
              testScope="mailbox"
              accounts={mailboxAccounts}
              setAccounts={setAccounts}
              setError={setError}
              onDeleteAccount={onDeleteAccount}
              onAdd={() => {
                setError("");
                setMailboxModalOpen(true);
              }}
            />
          ) : null}
        </div>
      </div>

      <SettingsModal
        open={deliveryModalOpen}
        onOpenChange={(open) => {
          if (!open) closeDeliveryModal();
        }}
        title="Add sender"
        description="Connect one Customer.io sender identity. The technical keys stay inside this modal instead of living on the page."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a
              href={CUSTOMER_IO_HELP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-[color:var(--muted-foreground)] underline underline-offset-4"
            >
              Where do I find my Customer.io credentials?
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={closeDeliveryModal}>
                Cancel
              </Button>
              <Button type="button" disabled={savingDelivery} onClick={createDeliveryAccount}>
                {savingDelivery ? "Saving..." : "Save sender"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="delivery-account-name"
              label="Account name"
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
              label="From email"
              help="The sender address recipients see. It must live on a verified Customer.io sending domain."
            />
            <Input
              id="delivery-from-email"
              value={deliveryForm.fromEmail}
              onChange={(event) => setDeliveryForm((prev) => ({ ...prev, fromEmail: event.target.value }))}
              placeholder="hello@branddomain.com"
              aria-invalid={Boolean(deliveryErrors.fromEmail)}
              className={invalidFieldClass(Boolean(deliveryErrors.fromEmail))}
            />
            <FieldError message={deliveryErrors.fromEmail} />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="delivery-site-id"
              label="Customer.io Site ID"
              help="Customer.io -> Settings -> API Credentials. Copy the Site ID from the same row as your tracking key."
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
              help="Use the Tracking API key, not the App API key. Leave the App API key for the advanced field."
            />
            <Input
              id="delivery-api-key"
              type="password"
              value={deliveryForm.customerIoApiKey}
              onChange={(event) => setDeliveryForm((prev) => ({ ...prev, customerIoApiKey: event.target.value }))}
              placeholder="Tracking API key"
              aria-invalid={Boolean(deliveryErrors.customerIoApiKey)}
              className={invalidFieldClass(Boolean(deliveryErrors.customerIoApiKey))}
            />
            <FieldError message={deliveryErrors.customerIoApiKey} />
          </div>

          <div className="md:col-span-2 flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowDeliveryAdvanced((prev) => !prev)}>
              {showDeliveryAdvanced ? "Hide advanced" : "Show advanced"}
            </Button>
          </div>

          {showDeliveryAdvanced ? (
            <div className="grid gap-2 md:col-span-2">
              <FieldLabel
                htmlFor="delivery-app-api-key"
                label="Customer.io App API Key"
                help="Optional but recommended. Lets the platform check workspace people counts before you hit your monthly cap."
              />
              <Input
                id="delivery-app-api-key"
                type="password"
                value={deliveryForm.customerIoAppApiKey}
                onChange={(event) => setDeliveryForm((prev) => ({ ...prev, customerIoAppApiKey: event.target.value }))}
                placeholder="Optional App API key"
              />
            </div>
          ) : null}
        </div>
      </SettingsModal>

      <SettingsModal
        open={mailboxModalOpen}
        onOpenChange={(open) => {
          if (!open) closeMailboxModal();
        }}
        title="Add reply inbox"
        description="Connect the inbox where human replies should land. Advanced server details stay hidden unless you need them."
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-[color:var(--muted-foreground)]">
              Gmail and Outlook usually work with an app password. Open advanced settings only for custom IMAP.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={closeMailboxModal}>
                Cancel
              </Button>
              <Button type="button" disabled={savingMailbox} onClick={createMailboxAccount}>
                {savingMailbox ? "Saving..." : "Save inbox"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-name"
              label="Account name"
              help="Internal label for the inbox, for example Founder Replies."
            />
            <Input
              id="mailbox-name"
              value={mailboxForm.name}
              onChange={(event) => setMailboxForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Founder Replies"
              aria-invalid={Boolean(mailboxErrors.name)}
              className={invalidFieldClass(Boolean(mailboxErrors.name))}
            />
            <FieldError message={mailboxErrors.name} />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-provider"
              label="Provider"
              help="Choose Gmail or Outlook to preload the standard IMAP settings. Use Custom IMAP for anything else."
            />
            <Select
              id="mailbox-provider"
              value={mailboxForm.mailboxProvider}
              onChange={(event) => setMailboxProviderWithDefaults(event.target.value as MailboxFormState["mailboxProvider"])}
            >
              <option value="gmail">Gmail</option>
              <option value="outlook">Outlook</option>
              <option value="imap">Custom IMAP</option>
            </Select>
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-email"
              label="Reply email"
              help="This is the inbox address that will receive responses from prospects."
            />
            <Input
              id="mailbox-email"
              value={mailboxForm.mailboxEmail}
              onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxEmail: event.target.value }))}
              placeholder="replies@brand.com"
              aria-invalid={Boolean(mailboxErrors.mailboxEmail)}
              className={invalidFieldClass(Boolean(mailboxErrors.mailboxEmail))}
            />
            <FieldError message={mailboxErrors.mailboxEmail} />
          </div>
          <div className="grid gap-2">
            <FieldLabel
              htmlFor="mailbox-auth-method"
              label="Authentication"
              help="App passwords are the simplest option. Use OAuth tokens only if your inbox team already has them."
            />
            <Select
              id="mailbox-auth-method"
              value={mailboxAuthMethod}
              onChange={(event) =>
                setMailboxAuthMethod(event.target.value === "oauth_tokens" ? "oauth_tokens" : "app_password")
              }
            >
              <option value="app_password">App password</option>
              <option value="oauth_tokens">OAuth tokens</option>
            </Select>
          </div>

          {mailboxAuthMethod === "app_password" ? (
            <div className="grid gap-2 md:col-span-2">
              <FieldLabel
                htmlFor="mailbox-password"
                label="App password"
                help="Use an app-specific password instead of the mailbox login password whenever the provider supports it."
              />
              <Input
                id="mailbox-password"
                type="password"
                value={mailboxForm.mailboxPassword}
                onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxPassword: event.target.value }))}
                placeholder="App password"
                aria-invalid={Boolean(mailboxErrors.mailboxPassword)}
                className={invalidFieldClass(Boolean(mailboxErrors.mailboxPassword))}
              />
              <FieldError message={mailboxErrors.mailboxPassword} />
            </div>
          ) : (
            <>
              <div className="grid gap-2 md:col-span-2">
                <FieldLabel
                  htmlFor="mailbox-access-token"
                  label="Access token"
                  help="Paste the current OAuth access token if your provider issued one for IMAP access."
                />
                <Input
                  id="mailbox-access-token"
                  type="password"
                  value={mailboxForm.mailboxAccessToken}
                  onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxAccessToken: event.target.value }))}
                  placeholder="Access token"
                  aria-invalid={Boolean(mailboxErrors.mailboxAccessToken)}
                  className={invalidFieldClass(Boolean(mailboxErrors.mailboxAccessToken))}
                />
                <FieldError message={mailboxErrors.mailboxAccessToken} />
              </div>
              <div className="grid gap-2 md:col-span-2">
                <FieldLabel
                  htmlFor="mailbox-refresh-token"
                  label="Refresh token"
                  help="Optional but useful if the access token rotates regularly."
                />
                <Input
                  id="mailbox-refresh-token"
                  type="password"
                  value={mailboxForm.mailboxRefreshToken}
                  onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxRefreshToken: event.target.value }))}
                  placeholder="Optional refresh token"
                />
              </div>
            </>
          )}

          <div className="md:col-span-2 flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowMailboxAdvanced((prev) => !prev)}>
              {showMailboxAdvanced ? "Hide advanced" : "Show advanced"}
            </Button>
          </div>

          {showMailboxAdvanced ? (
            <>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="mailbox-host"
                  label="IMAP host"
                  help="Only change this if the provider uses a non-standard IMAP server."
                />
                <Input
                  id="mailbox-host"
                  value={mailboxForm.mailboxHost}
                  onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxHost: event.target.value }))}
                  placeholder="imap.gmail.com"
                  aria-invalid={Boolean(mailboxErrors.mailboxHost)}
                  className={invalidFieldClass(Boolean(mailboxErrors.mailboxHost))}
                />
                <FieldError message={mailboxErrors.mailboxHost} />
              </div>
              <div className="grid gap-2">
                <FieldLabel
                  htmlFor="mailbox-port"
                  label="Port"
                  help="993 is standard for secure IMAP."
                />
                <Input
                  id="mailbox-port"
                  value={mailboxForm.mailboxPort}
                  onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxPort: event.target.value }))}
                  placeholder="993"
                  aria-invalid={Boolean(mailboxErrors.mailboxPort)}
                  className={invalidFieldClass(Boolean(mailboxErrors.mailboxPort))}
                />
                <FieldError message={mailboxErrors.mailboxPort} />
              </div>
              <label className="md:col-span-2 inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mailboxForm.mailboxSecure}
                  onChange={(event) => setMailboxForm((prev) => ({ ...prev, mailboxSecure: event.target.checked }))}
                />
                Use TLS/SSL
              </label>
            </>
          ) : null}
        </div>
      </SettingsModal>
    </>
  );
}
