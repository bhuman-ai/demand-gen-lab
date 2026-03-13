"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, GitBranch, Loader2, Rocket } from "lucide-react";
import {
  fetchBrand,
  fetchExperiment,
  fetchOutreachProvisioningSettings,
  fetchScaleCampaigns,
} from "@/lib/client-api";
import type { BrandRecord, ScaleCampaignRecord } from "@/lib/factory-types";
import FlowEditorClient from "@/app/brands/[id]/campaigns/[campaignId]/build/flows/[variantId]/flow-editor-client";
import { SettingsModal } from "@/app/settings/outreach/settings-primitives";
import CampaignOperationsChain, {
  buildCampaignOperationsChain,
} from "@/components/campaign-operations-chain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionPanel, EmptyState, PageIntro, StatLedger } from "@/components/ui/page-layout";

function statusVariant(status: ScaleCampaignRecord["status"]) {
  if (status === "active") return "accent" as const;
  if (status === "completed") return "success" as const;
  if (status === "paused") return "danger" as const;
  return "muted" as const;
}

function formatCount(value: number) {
  return value.toString().padStart(2, "0");
}

export default function CampaignsClient({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaigns, setCampaigns] = useState<ScaleCampaignRecord[]>([]);
  const [deliverability, setDeliverability] = useState<{
    provider: "none" | "google_postmaster";
    lastHealthStatus: "unknown" | "healthy" | "warning" | "critical";
  } | null>(null);
  const [flowModalOpen, setFlowModalOpen] = useState(false);
  const [flowLoading, setFlowLoading] = useState(false);
  const [flowCampaignId, setFlowCampaignId] = useState("");
  const [flowVariantId, setFlowVariantId] = useState("");
  const [flowCampaignName, setFlowCampaignName] = useState("");
  const [flowError, setFlowError] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    const [brandRow, campaignRows, provisioningRow] = await Promise.all([
      fetchBrand(brandId),
      fetchScaleCampaigns(brandId),
      fetchOutreachProvisioningSettings(),
    ]);
    setBrand(brandRow);
    setCampaigns(campaignRows);
    setDeliverability({
      provider: provisioningRow.deliverability.provider,
      lastHealthStatus: provisioningRow.deliverability.lastHealthStatus,
    });
    localStorage.setItem("factory.activeBrandId", brandId);
  };

  useEffect(() => {
    let mounted = true;
    void refresh().catch((err: unknown) => {
      if (!mounted) return;
      setError(err instanceof Error ? err.message : "Failed to load campaigns");
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  const activeCount = useMemo(
    () => campaigns.filter((campaign) => campaign.status === "active").length,
    [campaigns]
  );

  const openFlow = async (campaign: ScaleCampaignRecord) => {
    setFlowModalOpen(true);
    setFlowLoading(true);
    setFlowCampaignName(campaign.name);
    setFlowCampaignId("");
    setFlowVariantId("");
    setFlowError("");
    try {
      const sourceExperiment = await fetchExperiment(brandId, campaign.sourceExperimentId);
      setFlowCampaignId(sourceExperiment.runtime.campaignId ?? "");
      setFlowVariantId(sourceExperiment.runtime.experimentId ?? "");
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : "Failed to load conversational flow");
    } finally {
      setFlowLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageIntro
        eyebrow={`${brand?.name || "Brand"} / campaigns`}
        title="Scale only what proved itself."
        description="Promoted campaigns carry the winning experiment, sender health, and conversation logic forward so scale never gets detached from proof."
        actions={
          <>
            <Button asChild>
              <Link href={`/brands/${brandId}/experiments`}>
                Promote winner
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/brands/${brandId}/experiments`}>Open experiments</Link>
            </Button>
          </>
        }
        aside={
          <StatLedger
            items={[
              {
                label: "Campaigns",
                value: formatCount(campaigns.length),
                detail: campaigns.length ? "Promoted programs remain tied to the originating proof." : "Nothing has been promoted yet.",
              },
              {
                label: "Active",
                value: formatCount(activeCount),
                detail: activeCount ? "Runs currently in market." : "No campaign is active right now.",
              },
              {
                label: "Completed",
                value: formatCount(campaigns.filter((row) => row.status === "completed").length),
                detail: "Completed scale runs preserved for reference.",
              },
            ]}
          />
        }
      />

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      {campaigns.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {campaigns.map((campaign) => (
            <SectionPanel
              key={campaign.id}
              title={campaign.name}
              description={campaign.snapshot.offer || "No offer snapshot yet."}
              actions={<Badge variant={statusVariant(campaign.status)}>{campaign.status}</Badge>}
              contentClassName="space-y-5"
            >
              <div className="flex flex-wrap gap-2">
                <Badge variant="muted">Source {campaign.sourceExperimentId.slice(-6)}</Badge>
                <Badge variant="muted">{campaign.metricsSummary.sent} sent</Badge>
                <Badge variant="muted">{campaign.metricsSummary.replies} replies</Badge>
                <Badge variant="muted">{campaign.metricsSummary.positiveReplies} positive</Badge>
              </div>
              <CampaignOperationsChain
                compact
                steps={buildCampaignOperationsChain({
                  campaign,
                  deliverability,
                })}
                onStepClick={(stepId) => {
                  if (stepId === "offer_quality") {
                    void openFlow(campaign);
                    return;
                  }
                  if (stepId === "deliverability") {
                    router.push(`/brands/${brandId}/campaigns/${campaign.id}#campaign-deliverability`);
                    return;
                  }
                  if (stepId === "replies") {
                    router.push(`/brands/${brandId}/campaigns/${campaign.id}#campaign-replies`);
                    return;
                  }
                  router.push(`/brands/${brandId}/campaigns/${campaign.id}#campaign-data`);
                }}
              />
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" asChild>
                  <Link href={`/brands/${brandId}/campaigns/${campaign.id}`}>
                    <Rocket className="h-4 w-4" /> Open campaign
                  </Link>
                </Button>
                <Button size="sm" type="button" variant="outline" onClick={() => void openFlow(campaign)}>
                  <GitBranch className="h-4 w-4" />
                  Open flow
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/brands/${brandId}/experiments/${campaign.sourceExperimentId}`}>Source experiment</Link>
                </Button>
              </div>
            </SectionPanel>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No campaigns yet."
          description="Promote a winning experiment and it will appear here with its sender, flow, and reply performance intact."
          actions={
            <Link href={`/brands/${brandId}/experiments`}>
              <Button>
                Promote winner
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          }
        />
      )}

      <SettingsModal
        open={flowModalOpen}
        title={flowCampaignName ? `${flowCampaignName} flow` : "Conversational flow"}
        description="Review and edit the full conversation map for this campaign without leaving Campaigns."
        panelClassName="max-h-[94vh] max-w-[min(96vw,1680px)]"
        bodyClassName="p-0"
        onOpenChange={setFlowModalOpen}
      >
        {flowLoading ? (
          <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-[color:var(--muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading conversational flow...
          </div>
        ) : flowCampaignId && flowVariantId ? (
          <div className="min-h-[78vh]">
            <FlowEditorClient
              brandId={brandId}
              campaignId={flowCampaignId}
              variantId={flowVariantId}
              hideOverviewCard
              hideBackButton
            />
          </div>
        ) : (
          <div className="p-6 text-sm text-[color:var(--muted-foreground)]">
            {flowError || "This campaign does not have a conversation flow attached yet. Open the source experiment first, then try again."}
          </div>
        )}
      </SettingsModal>
    </div>
  );
}
