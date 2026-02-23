"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FolderKanban, FlaskConical, Inbox, Mail, Network, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  assignBrandOutreachAccount,
  createExperimentApi,
  fetchBrand,
  fetchBrands,
  fetchBrandOutreachAssignment,
  fetchExperiments,
  fetchOutreachAccounts,
  fetchScaleCampaigns,
  updateBrandApi,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, ExperimentRecord, OutreachAccount, ScaleCampaignRecord } from "@/lib/factory-types";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function nextWorkspace(experiment: ExperimentRecord | null) {
  if (!experiment) return "experiments";
  return `experiments/${experiment.id}`;
}

export default function BrandHomeClient({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [campaigns, setCampaigns] = useState<ScaleCampaignRecord[]>([]);
  const [accounts, setAccounts] = useState<OutreachAccount[]>([]);
  const [assignedAccountId, setAssignedAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
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
      fetchOutreachAccounts(),
      fetchBrandOutreachAssignment(brandId),
    ])
      .then(([brandRow, experimentRows, campaignRows, accountRows, assignment]) => {
        if (!mounted) return;
        setBrand(brandRow);
        setExperiments(experimentRows);
        setCampaigns(campaignRows);
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
              // keep original error state
            });
        }

        setError(message);
        setBrand(null);
        setExperiments([]);
        setCampaigns([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [brandId, router]);

  const activeExperiment = useMemo(
    () =>
      experiments.find((row) => ["running", "ready", "draft"].includes(row.status)) ??
      experiments[0] ??
      null,
    [experiments]
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{brand?.name || "Brand"}</CardTitle>
            <CardDescription>{brand?.website || "No website"}</CardDescription>
          </div>
          <Button
            type="button"
            onClick={async () => {
              if (!brand) return;
              setCreating(true);
              try {
                const created = await createExperimentApi(brand.id, {
                  name: `Experiment ${experiments.length + 1}`,
                });
                trackEvent("experiment_created", { brandId: brand.id, experimentId: created.id });
                router.push(`/brands/${brand.id}/experiments/${created.id}`);
              } finally {
                setCreating(false);
              }
            }}
            disabled={!brand || creating}
          >
            <Plus className="h-4 w-4" />
            {creating ? "Creating..." : "New Experiment"}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Tone</div>
            <div className="mt-1 text-sm">{brand?.tone || "Not set"}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Target markets</div>
            <div className="mt-1 text-sm">{brand?.targetMarkets?.length ?? 0}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Experiments</div>
            <div className="mt-1 text-sm">{experiments.length}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Campaigns</div>
            <div className="mt-1 text-sm">{campaigns.length}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Notes</div>
            <div className="mt-1 text-sm">{brand?.notes || "No notes"}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brand profile</CardTitle>
          <CardDescription>
            Manage target markets, ICPs, and product context after onboarding.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="product">Product summary</Label>
            <Textarea
              id="product"
              value={product}
              onChange={(event) => setProduct(event.target.value)}
              placeholder="What the product does and why it matters."
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="targetMarkets">Target markets (one per line)</Label>
              <Textarea
                id="targetMarkets"
                value={targetMarketsText}
                onChange={(event) => setTargetMarketsText(event.target.value)}
                placeholder="Mid-market B2B SaaS&#10;Agencies"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="icps">Ideal customer profiles (one per line)</Label>
              <Textarea
                id="icps"
                value={icpText}
                onChange={(event) => setIcpText(event.target.value)}
                placeholder="VP Sales at 50-500 employee SaaS&#10;Founder-led teams"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="features">Key features (one per line)</Label>
              <Textarea
                id="features"
                value={featuresText}
                onChange={(event) => setFeaturesText(event.target.value)}
                placeholder="AI-personalized video&#10;Automated outreach orchestration"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="benefits">Key benefits (one per line)</Label>
              <Textarea
                id="benefits"
                value={benefitsText}
                onChange={(event) => setBenefitsText(event.target.value)}
                placeholder="Higher reply rates&#10;Lower manual workload"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={!brand || profileSaving}
              onClick={async () => {
                if (!brand) return;
                const normalize = (value: string) =>
                  value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0);
                setProfileSaving(true);
                setError("");
                try {
                  const updated = await updateBrandApi(brand.id, {
                    product: product.trim(),
                    targetMarkets: normalize(targetMarketsText),
                    idealCustomerProfiles: normalize(icpText),
                    keyFeatures: normalize(featuresText),
                    keyBenefits: normalize(benefitsText),
                  });
                  setBrand(updated);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to save brand profile");
                } finally {
                  setProfileSaving(false);
                }
              }}
            >
              {profileSaving ? "Saving profile..." : "Save Brand Profile"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
      {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading brand...</div> : null}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next action</CardTitle>
            <CardDescription>Keep momentum by continuing one concrete experiment.</CardDescription>
          </CardHeader>
          <CardContent>
            {activeExperiment ? (
              <div className="space-y-3">
                <Badge variant="accent">{activeExperiment.name}</Badge>
                <div className="text-sm text-[color:var(--muted-foreground)]">
                  Status: <strong>{activeExperiment.status}</strong>
                </div>
                <Button asChild>
                  <Link href={`/brands/${brandId}/${nextWorkspace(activeExperiment)}`}>
                    Continue Experiment
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-[color:var(--muted-foreground)]">
                <p>No experiment yet. Create one to start testing.</p>
                <Button asChild>
                  <Link href={`/brands/${brandId}/experiments`}>Open Experiments</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Operations</CardTitle>
            <CardDescription>Brand-scoped modules with consistent context.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button asChild variant="outline" className="justify-start">
              <Link href={`/brands/${brandId}/experiments`}>
                <FlaskConical className="h-4 w-4" /> Experiments
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href={`/brands/${brandId}/campaigns`}>
                <FolderKanban className="h-4 w-4" /> Campaigns
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href={`/brands/${brandId}/network`}>
                <Network className="h-4 w-4" /> Network
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href={`/brands/${brandId}/leads`}>
                <Mail className="h-4 w-4" /> Leads
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href={`/brands/${brandId}/inbox`}>
                <Inbox className="h-4 w-4" /> Inbox
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outreach delivery account</CardTitle>
          <CardDescription>
            Choose the delivery account for this brand. Reply mailbox assignment is managed in Outreach Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <Select
            value={assignedAccountId}
            onChange={async (event) => {
              const accountId = event.target.value;
              setAssignedAccountId(accountId);
              try {
                await assignBrandOutreachAccount(brandId, accountId);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to assign outreach account");
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
          <Button asChild variant="outline">
            <Link href="/settings/outreach">Manage Accounts</Link>
          </Button>
        </CardContent>
      </Card>

      {campaigns.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Promoted campaigns</CardTitle>
            <CardDescription>Scale-only campaigns promoted from successful experiments.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {campaigns.slice(0, 5).map((campaign) => (
              <Link
                key={campaign.id}
                href={`/brands/${brandId}/campaigns/${campaign.id}`}
                className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-sm hover:bg-[color:var(--surface-hover)]"
              >
                {campaign.name} · {campaign.status}
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
