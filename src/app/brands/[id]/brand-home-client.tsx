"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertCircle,
  ChevronDown,
  Clock3,
  ExternalLink,
  FolderKanban,
  Inbox,
  Mail,
  Network,
  Radar,
  Settings,
  Sparkles,
  Target,
} from "lucide-react";
import OperatorPanel from "@/components/operator/operator-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { OperatorDrilldownLink, OperatorStatusStrip } from "@/components/ui/operator-workspace";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  assignBrandOutreachAccount,
  fetchBrand,
  fetchOperatorActivity,
  fetchBrandOutreachAssignment,
  fetchBrands,
  fetchExperiments,
  fetchMissions,
  fetchOutreachAccounts,
  fetchScaleCampaigns,
  updateBrandApi,
} from "@/lib/client-api";
import type { BrandRecord, ExperimentRecord, OutreachAccount, ScaleCampaignRecord } from "@/lib/factory-types";
import type { Mission } from "@/lib/mission-types";
import type { OperatorActivitySummary } from "@/lib/operator-types";

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

function formatStatus(value: string) {
  return value.replace(/_/g, " ");
}

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function activityBadgeVariant(
  state: OperatorActivitySummary["state"]
): "success" | "danger" | "muted" | "accent" {
  if (state === "failed") return "danger";
  if (state === "running" || state === "needs_attention") return "accent";
  if (state === "active") return "success";
  return "muted";
}

function activityStateLabel(state: OperatorActivitySummary["state"]) {
  if (state === "needs_attention") return "Needs attention";
  return formatStatus(state);
}

function normalizeLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function missionHref(brandId: string, mission: Mission | null) {
  return mission ? `/brands/${brandId}/missions/${mission.id}` : `/brands/${brandId}/missions`;
}

function openBrandOperator(message: string, autoSend = false) {
  window.dispatchEvent(
    new CustomEvent("lastb2b:open-operator", {
      detail: { message, autoSend },
    })
  );
}

function AgentActivityFeed({ brandId }: { brandId: string }) {
  const [activity, setActivity] = useState<OperatorActivitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!brandId) {
        setActivity(null);
        setLoading(false);
        return;
      }
      try {
        const next = await fetchOperatorActivity({ brandId, limit: 8 });
        if (!cancelled) {
          setActivity(next);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Activity unavailable");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const handleOperatorUpdated = () => {
      void load();
    };

    void load();
    window.addEventListener("lastb2b:operator-updated", handleOperatorUpdated);
    const interval = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("lastb2b:operator-updated", handleOperatorUpdated);
      window.clearInterval(interval);
    };
  }, [brandId]);

  const state = activity?.state ?? "quiet";
  const updatedLabel = activity?.updatedAt ? formatRelativeTime(activity.updatedAt) : "";
  const headline = loading
    ? "Checking Brand GPT activity..."
    : error
      ? "Activity is unavailable."
      : activity?.headline ?? "No agent activity yet.";
  const detail = error || activity?.detail || "Ask Brand GPT something to create the first activity.";

  return (
    <OperatorStatusStrip
      icon={state === "failed" ? <AlertCircle className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
      badge={activityStateLabel(state)}
      badgeVariant={activityBadgeVariant(state)}
      title={headline}
      detail={detail}
      meta={
        updatedLabel ? (
          <span className="hidden items-center gap-1 sm:inline-flex">
            <Clock3 className="h-3.5 w-3.5" />
            {updatedLabel}
          </span>
        ) : null
      }
    >
        {activity?.items.length ? (
          <ol className="grid gap-3">
            {activity.items.map((item) => (
              <li key={`${item.type}-${item.id}`} className="grid gap-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[color:var(--foreground)]">{item.title}</span>
                  {item.status ? <Badge variant="muted">{formatStatus(item.status)}</Badge> : null}
                  {item.toolName ? (
                    <span className="font-mono text-xs text-[color:var(--muted-foreground)]">{item.toolName}</span>
                  ) : null}
                  <span className="text-xs text-[color:var(--muted-foreground)]">{formatRelativeTime(item.createdAt)}</span>
                </div>
                {item.summary ? (
                  <div className="text-sm leading-6 text-[color:var(--muted-foreground)]">{item.summary}</div>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <div className="text-sm text-[color:var(--muted-foreground)]">
            No activity has been recorded for this brand yet.
          </div>
        )}
    </OperatorStatusStrip>
  );
}

export default function BrandHomeClient({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [campaigns, setCampaigns] = useState<ScaleCampaignRecord[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [accounts, setAccounts] = useState<OutreachAccount[]>([]);
  const [assignedAccountId, setAssignedAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [error, setError] = useState("");
  const [product, setProduct] = useState("");
  const [targetMarketsText, setTargetMarketsText] = useState("");
  const [icpText, setIcpText] = useState("");
  const [featuresText, setFeaturesText] = useState("");
  const [benefitsText, setBenefitsText] = useState("");
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const openDetails = () => {
      if (detailsRef.current) detailsRef.current.open = true;
    };
    window.addEventListener("lastb2b:open-brand-details", openDetails);
    return () => window.removeEventListener("lastb2b:open-brand-details", openDetails);
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    void Promise.all([
      fetchBrand(brandId),
      fetchExperiments(brandId),
      fetchScaleCampaigns(brandId),
      fetchMissions(brandId),
      fetchOutreachAccounts(),
      fetchBrandOutreachAssignment(brandId),
    ])
      .then(([brandRow, experimentRows, campaignRows, missionRows, accountRows, assignment]) => {
        if (!mounted) return;
        setBrand(brandRow);
        setExperiments(experimentRows);
        setCampaigns(campaignRows);
        setMissions(missionRows);
        setAccounts(accountRows);
        setAssignedAccountId(assignment.assignment?.accountId ?? "");
        setProduct(brandRow.product || "");
        setTargetMarketsText((brandRow.targetMarkets ?? []).join("\n"));
        setIcpText((brandRow.idealCustomerProfiles ?? []).join("\n"));
        setFeaturesText((brandRow.keyFeatures ?? []).join("\n"));
        setBenefitsText((brandRow.keyBenefits ?? []).join("\n"));
        localStorage.setItem("factory.activeBrandId", brandId);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : "Failed to load brand";

        if (message.toLowerCase().includes("brand not found")) {
          void fetchBrands()
            .then((rows) => {
              if (!mounted) return;
              const fallbackBrandId = rows[0]?.id ?? "";
              if (!fallbackBrandId || fallbackBrandId === brandId) return;
              localStorage.setItem("factory.activeBrandId", fallbackBrandId);
              router.replace(`/brands/${fallbackBrandId}`);
            })
            .catch(() => {
              // Keep the original error visible.
            });
        }

        setError(message);
        setBrand(null);
        setExperiments([]);
        setCampaigns([]);
        setMissions([]);
        setAccounts([]);
        setAssignedAccountId("");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [brandId, router]);

  const activeExperiments = useMemo(
    () => experiments.filter((row) => ["running", "ready", "paused", "draft"].includes(row.status)).slice(0, 4),
    [experiments]
  );
  const latestMission = useMemo(() => missions[0] ?? null, [missions]);
  const assignedAccount = useMemo(
    () => accounts.find((account) => account.id === assignedAccountId) ?? null,
    [accounts, assignedAccountId]
  );
  const currentRisk = useMemo(() => {
    if (latestMission?.lastError) return latestMission.lastError;
    if (latestMission?.deliverabilityState.primaryBlocker) return latestMission.deliverabilityState.primaryBlocker;
    if (!brand?.product?.trim()) return "Brand context is thin. Tell the agent what this product does.";
    if (!(brand?.idealCustomerProfiles?.length ?? 0)) return "Ideal customers are not set yet.";
    if (!assignedAccountId) return "No delivery account is assigned yet.";
    return "No blocker showing right now.";
  }, [assignedAccountId, brand, latestMission]);

  const workLinks = [
    {
      label: "Goals",
      detail: latestMission ? formatStatus(latestMission.status) : "Tell Brand GPT what outcome to chase",
      href: missionHref(brandId, latestMission),
      icon: Sparkles,
    },
    {
      label: "Inbox",
      detail: `${formatCount(brand?.inbox?.length ?? 0)} reply signals`,
      href: `/brands/${brandId}/inbox`,
      icon: Inbox,
    },
    {
      label: "Audience",
      detail: `${formatCount(brand?.leads?.length ?? 0)} known leads`,
      href: `/brands/${brandId}/leads`,
      icon: Mail,
    },
  ];

  const secondaryLinks = [
    {
      label: "Outbound",
      detail: `${formatCount(campaigns.length)} promoted`,
      href: `/brands/${brandId}/campaigns`,
      icon: FolderKanban,
    },
    {
      label: "Tests",
      detail: `${formatCount(activeExperiments.length)} active`,
      href: `/brands/${brandId}/experiments`,
      icon: Target,
    },
    {
      label: "Social",
      detail: "Discovery and comments",
      href: `/brands/${brandId}/social-discovery`,
      icon: Radar,
    },
    {
      label: "Delivery",
      detail: assignedAccount?.name || "No account assigned",
      href: `/brands/${brandId}/network`,
      icon: Network,
    },
  ];

  const allLinks = [...workLinks, ...secondaryLinks];

  return (
    <div className="flex min-h-screen flex-col bg-[color:var(--background)]">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <div className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-2.5 text-sm font-medium text-[color:var(--foreground)] hover:bg-[color:var(--surface-muted)]">
            Brand GPT
            <ChevronDown className="h-4 w-4 text-[color:var(--muted-foreground)]" />
          </div>
          <div className="min-w-0 truncate text-sm text-[color:var(--muted-foreground)]">
            {brand?.name || "Brand"}
          </div>
        </div>

        <details ref={detailsRef} className="relative shrink-0">
          <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-[10px] px-3 text-sm text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)] [&::-webkit-details-marker]:hidden">
            Details
            <ChevronDown className="h-4 w-4" />
          </summary>
          <div className="absolute right-0 z-30 mt-2 max-h-[calc(100vh-7rem)] w-[min(44rem,calc(100vw-2rem))] overflow-auto rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[0_24px_70px_-36px_color-mix(in_oklab,var(--shadow)_90%,transparent)]">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
              <Badge variant={latestMission?.status === "failed" ? "danger" : latestMission ? "accent" : "muted"}>
                {latestMission ? formatStatus(latestMission.status) : "Ready"}
              </Badge>
              <span className="min-w-0 flex-1">{currentRisk}</span>
            </div>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="product">Product summary</Label>
                  <Textarea
                    id="product"
                    value={product}
                    onChange={(event) => setProduct(event.target.value)}
                    placeholder="What the product does and why it matters."
                  />
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="targetMarkets">Target markets</Label>
                    <Textarea
                      id="targetMarkets"
                      value={targetMarketsText}
                      onChange={(event) => setTargetMarketsText(event.target.value)}
                      placeholder="Mid-market B2B SaaS&#10;Agencies"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="icps">Ideal customers</Label>
                    <Textarea
                      id="icps"
                      value={icpText}
                      onChange={(event) => setIcpText(event.target.value)}
                      placeholder="VP Sales at 50-500 employee SaaS&#10;Founder-led teams"
                    />
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="features">Key features</Label>
                    <Textarea
                      id="features"
                      value={featuresText}
                      onChange={(event) => setFeaturesText(event.target.value)}
                      placeholder="AI-personalized video&#10;Automated outreach orchestration"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="benefits">Key benefits</Label>
                    <Textarea
                      id="benefits"
                      value={benefitsText}
                      onChange={(event) => setBenefitsText(event.target.value)}
                      placeholder="Higher reply rates&#10;Lower manual workload"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  disabled={!brand || profileSaving}
                  onClick={async () => {
                    if (!brand) return;
                    setProfileSaving(true);
                    setError("");
                    try {
                      const updated = await updateBrandApi(brand.id, {
                        product: product.trim(),
                        targetMarkets: normalizeLines(targetMarketsText),
                        idealCustomerProfiles: normalizeLines(icpText),
                        keyFeatures: normalizeLines(featuresText),
                        keyBenefits: normalizeLines(benefitsText),
                      });
                      setBrand(updated);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to save brand context");
                    } finally {
                      setProfileSaving(false);
                    }
                  }}
                >
                  {profileSaving ? "Saving..." : "Save context"}
                </Button>
              </div>

              <div className="grid content-start gap-3">
                <div className="grid gap-2">
                  {allLinks.map((item) => {
                    return (
                      <OperatorDrilldownLink
                        key={item.label}
                        href={item.href}
                        icon={item.icon}
                        label={item.label}
                        detail={item.detail}
                      />
                    );
                  })}
                </div>

                <div className="grid gap-3 border-t border-[color:var(--border)] pt-3">
                  <Label htmlFor="assignedAccount">Delivery account</Label>
                  <Select
                    id="assignedAccount"
                    value={assignedAccountId}
                    onChange={async (event) => {
                      const accountId = event.target.value;
                      setAssignedAccountId(accountId);
                      try {
                        await assignBrandOutreachAccount(brandId, accountId);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to assign delivery account");
                      }
                    }}
                  >
                    <option value="">Unassigned</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-start"
                    onClick={() =>
                      openBrandOperator(
                        "Connect LinkedIn for this brand. If a human login is needed, create the sign-in link.",
                        true
                      )
                    }
                  >
                    <Network className="h-4 w-4" />
                    Connect LinkedIn
                  </Button>
                  <Button asChild variant="outline" className="justify-start">
                    <Link href="/settings/outreach">
                      <Settings className="h-4 w-4" />
                      Outreach settings
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </details>
      </header>

      {error ? (
        <div className="mx-auto mt-4 w-full max-w-[52rem] rounded-[12px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3 text-sm text-[color:var(--danger)]">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="mx-auto mt-4 w-full max-w-[52rem] text-sm text-[color:var(--muted-foreground)]">
          Loading brand...
        </div>
      ) : null}

      <AgentActivityFeed brandId={brandId} />

      <OperatorPanel
        open={Boolean(brandId)}
        onOpenChange={() => undefined}
        activeBrandId={brandId}
        activeBrandName={brand?.name || ""}
        variant="inline"
        className="min-h-0 flex-1"
      />
    </div>
  );
}
