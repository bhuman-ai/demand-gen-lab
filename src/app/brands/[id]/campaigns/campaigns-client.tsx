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
import { buildCampaignOperationsChain } from "@/components/campaign-operations-chain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExplainableHint } from "@/components/ui/explainable-hint";
import { EmptyState, PageIntro } from "@/components/ui/page-layout";
import {
  buildSenderRoutingSignalFromDomainRow,
  rankSenderRoutingSignals,
  senderRouteSelectionVariant,
  summarizeSelectedSenderRoute,
  type SenderRoutingSignals,
} from "@/lib/sender-routing";
import { cn } from "@/lib/utils";

function statusVariant(status: ScaleCampaignRecord["status"]) {
  if (status === "active") return "accent" as const;
  if (status === "completed") return "success" as const;
  if (status === "paused") return "danger" as const;
  return "muted" as const;
}

function formatRelativeTime(value: string) {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Never";
  const diffMs = Date.now() - parsed.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "Just now";
  if (diffMs < hour) return `${Math.round(diffMs / minute)} min ago`;
  if (diffMs < day) return `${Math.round(diffMs / hour)} hr ago`;
  if (diffMs < 7 * day) {
    const days = Math.round(diffMs / day);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return parsed.toLocaleDateString();
}

function statusLabel(status: ScaleCampaignRecord["status"]) {
  if (status === "active") return "Active";
  if (status === "paused") return "Paused";
  if (status === "completed") return "Completed";
  return "Draft";
}

function diagnosticValue(
  step: ReturnType<typeof buildCampaignOperationsChain>[number]
) {
  if (step.id === "data") {
    if (step.tone === "success") return "Good";
    if (step.tone === "pending") return "Ready";
    if (step.tone === "attention") return "Missing";
    return "Idle";
  }
  if (step.id === "deliverability") {
    if (step.tone === "success") return "Good";
    if (step.tone === "pending") return "Idle";
    if (step.tone === "attention") return "Risk";
    return "Idle";
  }
  if (step.id === "offer_quality") {
    if (step.headline === "Ready to test") return "Ready";
    if (step.headline === "Getting signal") return "Signal";
    if (step.headline === "Resonating") return "Strong";
    if (step.tone === "attention") return "Blocked";
    return "Idle";
  }
  if (step.id === "replies") {
    if (step.headline.includes("positive")) return "Positive";
    if (step.headline.includes("Waiting")) return "Waiting";
    if (step.tone === "pending") return "Live";
    if (step.tone === "muted") return "Idle";
    return "Positive";
  }
  return step.headline;
}

function diagnosticLabel(step: ReturnType<typeof buildCampaignOperationsChain>[number]) {
  if (step.id === "offer_quality") return "Offer";
  if (step.id === "replies") return "Replies";
  return step.label;
}

function diagnosticVariant(
  step: ReturnType<typeof buildCampaignOperationsChain>[number]
) {
  if (step.tone === "success") return "success" as const;
  if (step.tone === "attention") return "danger" as const;
  if (step.tone === "pending") return "accent" as const;
  return "muted" as const;
}

function formatRoutingCount(value: number) {
  return value.toString().padStart(2, "0");
}

export default function CampaignsClient({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaigns, setCampaigns] = useState<ScaleCampaignRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | ScaleCampaignRecord["status"]>("all");
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

  const filteredCampaigns = useMemo(
    () => campaigns.filter((campaign) => statusFilter === "all" || campaign.status === statusFilter),
    [campaigns, statusFilter]
  );
  const filterItems = useMemo(
    () => [
      { label: "All", value: "all" as const, count: campaigns.length },
      {
        label: "Active",
        value: "active" as const,
        count: campaigns.filter((campaign) => campaign.status === "active").length,
      },
      {
        label: "Paused",
        value: "paused" as const,
        count: campaigns.filter((campaign) => campaign.status === "paused").length,
      },
      {
        label: "Completed",
        value: "completed" as const,
        count: campaigns.filter((campaign) => campaign.status === "completed").length,
      },
    ],
    [campaigns]
  );
  const rankedRoutingSignals = useMemo(
    () =>
      rankSenderRoutingSignals(
        (brand?.domains ?? [])
          .map((row) => buildSenderRoutingSignalFromDomainRow(row))
          .filter((row): row is SenderRoutingSignals => Boolean(row))
      ),
    [brand?.domains]
  );
  const preferredRoutingSignal = useMemo(
    () => rankedRoutingSignals.find((signal) => signal.automationStatus !== "attention") ?? null,
    [rankedRoutingSignals]
  );
  const standbyRoutingSignals = useMemo(
    () =>
      rankedRoutingSignals.filter(
        (signal) =>
          signal.automationStatus !== "attention" &&
          (!preferredRoutingSignal || signal.senderAccountId !== preferredRoutingSignal.senderAccountId)
      ),
    [rankedRoutingSignals, preferredRoutingSignal]
  );
  const blockedRoutingSignals = useMemo(
    () => rankedRoutingSignals.filter((signal) => signal.automationStatus === "attention"),
    [rankedRoutingSignals]
  );
  const autoRoutedCampaignCount = useMemo(
    () => campaigns.filter((campaign) => !String(campaign.scalePolicy.accountId ?? "").trim()).length,
    [campaigns]
  );
  const lockedCampaignCount = useMemo(
    () => campaigns.filter((campaign) => String(campaign.scalePolicy.accountId ?? "").trim()).length,
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
        title={
          <span className="inline-flex items-center gap-2">
            <span>Campaigns</span>
            <ExplainableHint
              label="Explain Campaigns"
              title="What this page shows"
            >
              <p>Campaigns are experiments that graduated into live production sending.</p>
              <p>
                The system keeps choosing the healthiest sender route, watches deliverability automatically, and pauses
                or reroutes when a sender or message starts to degrade.
              </p>
            </ExplainableHint>
          </span>
        }
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
      />

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <div className="flex flex-wrap gap-2">
        {filterItems.map((item) => {
          const active = statusFilter === item.value;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={active}
              onClick={() => setStatusFilter(item.value)}
              className={cn(
                "rounded-[8px] border px-3 py-1.5 text-sm transition-colors",
                active
                  ? "border-[color:var(--border-strong)] bg-[color:var(--surface-muted)] text-[color:var(--foreground)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--foreground)]"
              )}
            >
              {item.label} {item.count}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,0.7fr))]">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--muted-foreground)]">
            <span>Preferred sender</span>
            <ExplainableHint
              label="Explain preferred sender"
              title="Preferred sender"
            >
              <p>
                This is the sender mailbox currently at the top of the health-first route order for production sends.
              </p>
              <p>
                The system prefers senders that are ready, have stronger inbox placement, and show healthier domain,
                mailbox, transport, and message signals.
              </p>
            </ExplainableHint>
          </div>
          <div className="mt-1 font-medium text-[color:var(--foreground)]">
            {preferredRoutingSignal?.fromEmail || "No sender ready"}
          </div>
          <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
            {preferredRoutingSignal
              ? preferredRoutingSignal.automationSummary
              : blockedRoutingSignals.length
                ? `${blockedRoutingSignals.length} sender${blockedRoutingSignals.length === 1 ? "" : "s"} currently sit outside rotation.`
                : "Attach and verify a sender before campaigns can auto-route."}
          </div>
        </div>
        <div>
          <div className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--muted-foreground)]">
            <span>Auto-routed</span>
            <ExplainableHint
              label="Explain auto-routed campaigns"
              title="Auto-routed"
            >
              <p>
                These campaigns are not pinned to a sender. The system can choose the best available route on each
                dispatch and fail over if the current route degrades.
              </p>
            </ExplainableHint>
          </div>
          <div className="mt-1 font-medium text-[color:var(--foreground)]">{formatRoutingCount(autoRoutedCampaignCount)}</div>
          <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
            Campaigns using health-first sender selection.
          </div>
        </div>
        <div>
          <div className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--muted-foreground)]">
            <span>Locked</span>
            <ExplainableHint
              label="Explain locked campaigns"
              title="Locked route"
            >
              <p>
                Locked campaigns are pinned to a specific sender account instead of following the default health-first
                route order.
              </p>
              <p>
                If the locked sender becomes risky, the campaign can still be paused or rerouted automatically to avoid
                bad placement.
              </p>
            </ExplainableHint>
          </div>
          <div className="mt-1 font-medium text-[color:var(--foreground)]">{formatRoutingCount(lockedCampaignCount)}</div>
          <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
            Campaigns pinned to a specific sender account.
          </div>
        </div>
        <div>
          <div className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--muted-foreground)]">
            <span>Blocked routes</span>
            <ExplainableHint
              label="Explain blocked routes"
              title="Blocked routes"
              align="right"
            >
              <p>
                A blocked route is outside production rotation because one or more signals look unsafe, such as domain,
                mailbox, transport, or message health.
              </p>
              <p>
                The system keeps testing those senders and can bring them back once they recover.
              </p>
            </ExplainableHint>
          </div>
          <div className="mt-1 font-medium text-[color:var(--foreground)]">{formatRoutingCount(blockedRoutingSignals.length)}</div>
          <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
            {standbyRoutingSignals.length
              ? `${standbyRoutingSignals.length} standby sender${standbyRoutingSignals.length === 1 ? "" : "s"} available.`
              : "No standby sender available yet."}
          </div>
        </div>
      </div>

      {filteredCampaigns.length ? (
        <div className="flex flex-col gap-4">
          {filteredCampaigns.map((campaign) => {
            const diagnostics = buildCampaignOperationsChain({
              campaign,
              deliverability,
            });
            const routeSummary = summarizeSelectedSenderRoute({
              signals: rankedRoutingSignals,
              preferredSignal: preferredRoutingSignal,
              selectedAccountId: campaign.scalePolicy.accountId,
            });

            return (
              <section
                key={campaign.id}
                className="w-full rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface)]"
              >
                <div className="space-y-4 px-4 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-[color:var(--foreground)]">{campaign.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--muted-foreground)]">
                        <span className="inline-flex items-center gap-1.5">
                          <GitBranch className="h-3.5 w-3.5" />
                          Promoted from experiment {campaign.sourceExperimentId.slice(-6)}
                        </span>
                        <span>{campaign.snapshot.offer || "No offer snapshot"}</span>
                      </div>
                    </div>
                    <Badge variant={statusVariant(campaign.status)}>{statusLabel(campaign.status)}</Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[color:var(--foreground)]">
                    <span>{campaign.metricsSummary.sent} sent</span>
                    <span>{campaign.metricsSummary.replies} replies</span>
                    <span>{campaign.metricsSummary.positiveReplies} positive</span>
                  </div>

                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    Last activity {formatRelativeTime(campaign.updatedAt || campaign.createdAt)}
                  </div>

                  <div className="grid gap-2 border-t border-[color:var(--border)] pt-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--muted-foreground)]">
                        <span>Dispatch route</span>
                        <ExplainableHint
                          label={`Explain dispatch route for ${campaign.name}`}
                          title="Dispatch route"
                        >
                          <p>
                            This shows which sender the campaign will use right now, and whether that choice is
                            automatic, locked, or blocked.
                          </p>
                          <p>
                            Auto route follows the current health-first ranking. Locked routes are pinned. Blocked means
                            the selected sender is unsafe and the campaign needs another route.
                          </p>
                        </ExplainableHint>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge variant={senderRouteSelectionVariant(routeSummary.state)}>{routeSummary.label}</Badge>
                        <span className="font-medium text-[color:var(--foreground)]">{routeSummary.title}</span>
                      </div>
                      <div className="mt-1 text-xs leading-5 text-[color:var(--muted-foreground)]">
                        {routeSummary.detail}
                      </div>
                    </div>
                    {routeSummary.signal ? (
                      <div className="text-xs text-[color:var(--muted-foreground)]">{routeSummary.signal.domain}</div>
                    ) : null}
                  </div>

                  <div className="grid gap-2 lg:grid-cols-4">
                    {diagnostics.map((step) => (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => {
                          if (step.id === "offer_quality") {
                            void openFlow(campaign);
                            return;
                          }
                          if (step.id === "deliverability") {
                            router.push(`/brands/${brandId}/campaigns/${campaign.id}#campaign-deliverability`);
                            return;
                          }
                          if (step.id === "replies") {
                            router.push(`/brands/${brandId}/campaigns/${campaign.id}#campaign-replies`);
                            return;
                          }
                          router.push(`/brands/${brandId}/campaigns/${campaign.id}#campaign-data`);
                        }}
                        className="flex items-center justify-between gap-3 rounded-[8px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-left transition-colors hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface)]"
                      >
                        <span className="text-[12px] text-[color:var(--muted-foreground)]">
                          {diagnosticLabel(step)}
                        </span>
                        <Badge variant={diagnosticVariant(step)}>{diagnosticValue(step)}</Badge>
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" asChild>
                      <Link href={`/brands/${brandId}/campaigns/${campaign.id}`}>
                        <Rocket className="h-4 w-4" /> Open campaign
                      </Link>
                    </Button>
                    <Button size="sm" type="button" variant="outline" onClick={() => void openFlow(campaign)}>
                      <GitBranch className="h-4 w-4" />
                      Messaging flow
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/brands/${brandId}/experiments/${campaign.sourceExperimentId}`}>Source experiment</Link>
                    </Button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={campaigns.length ? "No campaigns match this filter." : "No campaigns yet."}
          description={
            campaigns.length
              ? "Pick a different campaign state or clear the filter."
              : "Promote a winning experiment and it will appear here with its sender, flow, and reply performance intact."
          }
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
