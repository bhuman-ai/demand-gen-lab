"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FolderKanban, Inbox, Mail, Network, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  assignBrandOutreachAccount,
  createCampaignApi,
  fetchBrand,
  fetchBrands,
  fetchBrandOutreachAssignment,
  fetchCampaigns,
  fetchOutreachAccounts,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type { BrandRecord, CampaignRecord, OutreachAccount } from "@/lib/factory-types";
import { Select } from "@/components/ui/select";

function nextWorkspace(campaign: CampaignRecord) {
  const state = campaign.stepState;
  if (!state.objectiveCompleted || !state.hypothesesCompleted || !state.experimentsCompleted) {
    return "build";
  }
  return "run/overview";
}

export default function BrandHomeClient({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [accounts, setAccounts] = useState<OutreachAccount[]>([]);
  const [assignedAccountId, setAssignedAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    void Promise.all([
      fetchBrand(brandId),
      fetchCampaigns(brandId),
      fetchOutreachAccounts(),
      fetchBrandOutreachAssignment(brandId),
    ])
      .then(([brandRow, campaignRows, accountRows, assignment]) => {
        if (!mounted) return;
        setBrand(brandRow);
        setCampaigns(campaignRows);
        setAccounts(accountRows);
        setAssignedAccountId(assignment.assignment?.accountId ?? "");
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
              // Keep the original error state if fallback lookup fails.
            });
        }

        setError(message);
        setBrand(null);
        setCampaigns([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [brandId, router]);

  const activeCampaign = useMemo(() => campaigns[0] ?? null, [campaigns]);

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
                const created = await createCampaignApi(brand.id, { name: `Campaign ${campaigns.length + 1}` });
                trackEvent("campaign_created", { brandId: brand.id, campaignId: created.id });
                router.push(`/brands/${brand.id}/campaigns/${created.id}/build`);
              } finally {
                setCreating(false);
              }
            }}
            disabled={!brand || creating}
          >
            <Plus className="h-4 w-4" />
            {creating ? "Creating..." : "New Campaign"}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Tone</div>
            <div className="mt-1 text-sm">{brand?.tone || "Not set"}</div>
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

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
      {loading ? <div className="text-sm text-[color:var(--muted-foreground)]">Loading brand...</div> : null}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next Action</CardTitle>
            <CardDescription>Resume the highest priority campaign workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            {activeCampaign ? (
              <div className="space-y-3">
                <Badge variant="accent">{activeCampaign.name}</Badge>
                <div className="text-sm text-[color:var(--muted-foreground)]">
                  Continue in <strong>{nextWorkspace(activeCampaign).startsWith("run") ? "Run" : "Build"}</strong>.
                </div>
                <Button asChild>
                  <Link href={`/brands/${brandId}/campaigns/${activeCampaign.id}/${nextWorkspace(activeCampaign)}`}>
                    Continue Campaign
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-[color:var(--muted-foreground)]">
                <p>No campaign yet. Create one to start with Build.</p>
                <Button asChild>
                  <Link href={`/brands/${brandId}/campaigns`}>Open Campaigns</Link>
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
          <CardTitle className="text-base">Outreach Delivery Account</CardTitle>
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
            <CardTitle className="text-base">Recent Campaigns</CardTitle>
            <CardDescription>Each campaign runs through Build and Run.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {campaigns.slice(0, 5).map((campaign) => {
              const workspace = nextWorkspace(campaign);
              return (
                <Link
                  key={campaign.id}
                  href={`/brands/${brandId}/campaigns/${campaign.id}/${workspace}`}
                  className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-sm hover:bg-[color:var(--surface-hover)]"
                >
                  {campaign.name} · continue {workspace.startsWith("run") ? "run" : "build"}
                </Link>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
