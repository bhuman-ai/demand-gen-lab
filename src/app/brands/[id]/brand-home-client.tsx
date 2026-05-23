"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  assignBrandOutreachAccount,
  fetchBrand,
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

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

function formatStatus(value: string) {
  return value.replace(/_/g, " ");
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
      label: "Mission control",
      detail: latestMission ? formatStatus(latestMission.status) : "Start or review campaign work",
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
      label: "Leads",
      detail: `${formatCount(brand?.leads?.length ?? 0)} known leads`,
      href: `/brands/${brandId}/leads`,
      icon: Mail,
    },
  ];

  const secondaryLinks = [
    {
      label: "Campaigns",
      detail: `${formatCount(campaigns.length)} promoted`,
      href: `/brands/${brandId}/campaigns`,
      icon: FolderKanban,
    },
    {
      label: "Experiments",
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
    <div className="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-3xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border)] pb-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">
            Brand GPT
          </div>
          <h1 className="mt-1 truncate text-xl font-semibold text-[color:var(--foreground)]">
            {brand?.name || "Brand"}
          </h1>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
          <Badge variant={latestMission?.status === "failed" ? "danger" : latestMission ? "accent" : "muted"}>
            {latestMission ? formatStatus(latestMission.status) : "Ready"}
          </Badge>
          <span className="max-w-[32rem] truncate">{currentRisk}</span>
        </div>
      </header>

      {error ? (
        <div className="rounded-[12px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3 text-sm text-[color:var(--danger)]">
          {error}
        </div>
      ) : null}
      {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading brand...</div> : null}

      <OperatorPanel
        open={Boolean(brandId)}
        onOpenChange={() => undefined}
        activeBrandId={brandId}
        activeBrandName={brand?.name || ""}
        variant="inline"
        className="flex-1 lg:min-h-[calc(100vh-14rem)]"
      />

      <details className="rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[color:var(--foreground)]">
          Details
        </summary>
        <div className="grid gap-5 border-t border-[color:var(--border)] px-4 py-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
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
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="flex items-center justify-between gap-3 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-3 text-sm transition-colors hover:bg-[color:var(--surface-hover)]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Icon className="h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]" />
                      <span className="min-w-0">
                        <span className="block font-medium text-[color:var(--foreground)]">{item.label}</span>
                        <span className="block truncate text-xs text-[color:var(--muted-foreground)]">{item.detail}</span>
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]" />
                  </Link>
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
      </details>
    </div>
  );
}
