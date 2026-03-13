"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { GitBranch, Pause, Play, Rocket, Save } from "lucide-react";
import {
  controlScaleCampaignRunApi,
  fetchBrand,
  fetchBrandOutreachAssignment,
  fetchExperiment,
  fetchOutreachAccounts,
  fetchOutreachProvisioningSettings,
  fetchScaleCampaign,
  fetchScaleCampaignRunView,
  launchScaleCampaignApi,
  updateScaleCampaignApi,
} from "@/lib/client-api";
import type {
  BrandRecord,
  OutreachAccount,
  OutreachProvisioningSettings,
  OutreachRun,
  RunViewModel,
  ScaleCampaignRecord,
} from "@/lib/factory-types";
import { buildSenderDeliverabilityScorecards } from "@/lib/outreach-deliverability";
import { trackEvent } from "@/lib/telemetry-client";
import FlowEditorClient from "@/app/brands/[id]/campaigns/[campaignId]/build/flows/[variantId]/flow-editor-client";
import { SettingsModal } from "@/app/settings/outreach/settings-primitives";
import CampaignOperationsChain, {
  buildCampaignOperationsChain,
  type CampaignChainPlacement,
} from "@/components/campaign-operations-chain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageIntro, SectionPanel, StatLedger } from "@/components/ui/page-layout";

function runStatusVariant(status: OutreachRun["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "failed" || status === "preflight_failed" || status === "canceled") return "danger" as const;
  if (status === "paused") return "danger" as const;
  if (status === "sending" || status === "monitoring") return "accent" as const;
  return "muted" as const;
}

function canPause(status: OutreachRun["status"]) {
  return ["queued", "sourcing", "scheduled", "sending", "monitoring"].includes(status);
}

function canResume(status: OutreachRun["status"]) {
  return status === "paused";
}

function isOpenRun(status: OutreachRun["status"]) {
  return ["queued", "sourcing", "scheduled", "sending", "monitoring", "paused"].includes(status);
}

function formatDate(value: string) {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scrollToCampaignSection(id: string) {
  if (typeof document === "undefined") return;
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function senderHealthBadge(scorecard: ReturnType<typeof buildSenderDeliverabilityScorecards>[number]) {
  if (scorecard.manualOverrideActive) return <Badge variant="accent">Manual override</Badge>;
  if (scorecard.autoPaused) return <Badge variant="danger">Auto-paused</Badge>;
  if (!scorecard.checkedAt) return <Badge variant="muted">Untested</Badge>;
  if (scorecard.spamRate >= 0.5) return <Badge variant="danger">Spam risk</Badge>;
  if (scorecard.inboxRate >= 0.5) return <Badge variant="success">Healthy</Badge>;
  return <Badge variant="accent">Mixed</Badge>;
}

function monitorProviderLabel(account: OutreachAccount | null) {
  if (!account) return "Unknown";
  if (account.config.mailbox.provider === "gmail") return "Gmail";
  if (account.config.mailbox.provider === "outlook") return "Outlook";
  return "IMAP";
}

function summarizePlacement(events: RunViewModel["eventsByRun"][string]) {
  const latestResult = events.find((event) => event.eventType === "deliverability_probe_result") ?? null;
  const pendingProbe =
    events.find((event) => event.eventType === "deliverability_probe_waiting") ??
    events.find((event) => event.eventType === "deliverability_probe_sent") ??
    null;

  if (
    pendingProbe &&
    (!latestResult || new Date(pendingProbe.createdAt).getTime() >= new Date(latestResult.createdAt).getTime())
  ) {
    return {
      placement: "checking" as CampaignChainPlacement,
      headline: "Checking",
      detail: "Placement probe is running",
      tone: "text-[color:var(--muted-foreground)]",
    };
  }

  if (latestResult) {
    const placement = asText(latestResult.payload.placement);
    const monitorEmail = asText(latestResult.payload.monitorEmail);
    const matchedMailbox = asText(latestResult.payload.matchedMailbox);
    const totalMonitors = asNumber(latestResult.payload.totalMonitors);
    const summaryText = asText(latestResult.payload.summaryText);
    const groupSuffix =
      totalMonitors > 1
        ? summaryText
          ? `Seed group: ${summaryText}`
          : `${totalMonitors} seed inboxes checked`
        : "";
    if (placement === "inbox") {
      return {
        placement: "inbox" as CampaignChainPlacement,
        headline: "Inbox",
        detail:
          groupSuffix ||
          (monitorEmail ? `Delivered to ${monitorEmail}` : "Probe reached Inbox"),
        tone: "text-[color:var(--foreground)]",
      };
    }
    if (placement === "spam") {
      return {
        placement: "spam" as CampaignChainPlacement,
        headline: "Spam",
        detail:
          groupSuffix ||
          (monitorEmail ? `Landed in spam for ${monitorEmail}` : "Probe landed in spam"),
        tone: "text-[color:var(--danger)]",
      };
    }
    if (placement === "all_mail_only") {
      return {
        placement: "all_mail_only" as CampaignChainPlacement,
        headline: "All Mail only",
        detail:
          groupSuffix ||
          `Missed Inbox${matchedMailbox ? `; found in ${matchedMailbox}` : ""}`,
        tone: "text-[color:var(--danger)]",
      };
    }
    if (placement === "not_found") {
      return {
        placement: "not_found" as CampaignChainPlacement,
        headline: "Not found",
        detail:
          groupSuffix || "Probe was not found in Inbox, Spam, or All Mail",
        tone: "text-[color:var(--danger)]",
      };
    }
  }

  if (pendingProbe) {
    return {
      placement: "checking" as CampaignChainPlacement,
      headline: "Checking",
      detail: "Placement probe is running",
      tone: "text-[color:var(--muted-foreground)]",
    };
  }

  return {
    placement: "unknown" as CampaignChainPlacement,
    headline: "Unknown",
    detail: "No placement check yet",
    tone: "text-[color:var(--muted-foreground)]",
  };
}

export default function CampaignClient({
  brandId,
  campaignId,
}: {
  brandId: string;
  campaignId: string;
}) {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaign, setCampaign] = useState<ScaleCampaignRecord | null>(null);
  const [runView, setRunView] = useState<RunViewModel | null>(null);
  const [provisioningSettings, setProvisioningSettings] = useState<OutreachProvisioningSettings | null>(null);
  const [outreachAccounts, setOutreachAccounts] = useState<OutreachAccount[]>([]);
  const [assignedSenderIds, setAssignedSenderIds] = useState<string[]>([]);
  const [flowCampaignId, setFlowCampaignId] = useState("");
  const [flowVariantId, setFlowVariantId] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [resumingSenderId, setResumingSenderId] = useState("");
  const [flowModalOpen, setFlowModalOpen] = useState(false);
  const [error, setError] = useState("");

  const refresh = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const [brandRow, campaignRow, runRow, provisioningRow, accountsRow, assignmentRow] = await Promise.all([
        fetchBrand(brandId),
        fetchScaleCampaign(brandId, campaignId),
        fetchScaleCampaignRunView(brandId, campaignId),
        fetchOutreachProvisioningSettings(),
        fetchOutreachAccounts(),
        fetchBrandOutreachAssignment(brandId),
      ]);
      let sourceExperiment = null as Awaited<ReturnType<typeof fetchExperiment>> | null;
      if (campaignRow.sourceExperimentId) {
        try {
          sourceExperiment = await fetchExperiment(brandId, campaignRow.sourceExperimentId);
        } catch {
          sourceExperiment = null;
        }
      }
      setBrand(brandRow);
      setCampaign(campaignRow);
      setRunView(runRow);
      setProvisioningSettings(provisioningRow);
      setOutreachAccounts(accountsRow);
      setAssignedSenderIds(
        Array.from(
          new Set(
            [
              assignmentRow.assignment?.accountId ?? "",
              ...(assignmentRow.assignment?.accountIds ?? []),
              campaignRow.scalePolicy.accountId,
            ]
              .map((value) => String(value ?? "").trim())
              .filter(Boolean)
          )
        )
      );
      setFlowCampaignId(sourceExperiment?.runtime.campaignId ?? "");
      setFlowVariantId(sourceExperiment?.runtime.experimentId ?? "");
      localStorage.setItem("factory.activeBrandId", brandId);
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    setError("");
    void refresh()
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load campaign");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    trackEvent("campaign_viewed", { brandId, campaignId });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, campaignId]);

  const latestRun = useMemo(() => {
    const runs = runView?.runs ?? [];
    if (!runs.length) return null;
    const candidates = runs.filter((run) => isOpenRun(run.status));
    const source = candidates.length ? candidates : runs;
    return [...source].sort((left, right) => {
      const sentDelta = (right.metrics.sentMessages ?? 0) - (left.metrics.sentMessages ?? 0);
      if (sentDelta !== 0) return sentDelta;
      const replyDelta = (right.metrics.replies ?? 0) - (left.metrics.replies ?? 0);
      if (replyDelta !== 0) return replyDelta;
      return left.createdAt < right.createdAt ? 1 : -1;
    })[0] ?? null;
  }, [runView]);
  const latestEvents = useMemo(
    () => (latestRun ? runView?.eventsByRun?.[latestRun.id] ?? [] : []),
    [latestRun, runView]
  );
  const latestPlacement = useMemo(() => summarizePlacement(latestEvents), [latestEvents]);
  const latestDeliverabilityResult = useMemo(
    () => latestEvents.find((event) => event.eventType === "deliverability_probe_result") ?? null,
    [latestEvents]
  );
  const senderAccounts = useMemo(
    () =>
      assignedSenderIds
        .map((accountId) => outreachAccounts.find((account) => account.id === accountId) ?? null)
        .filter((account): account is OutreachAccount => Boolean(account)),
    [assignedSenderIds, outreachAccounts]
  );
  const senderScorecards = useMemo(
    () =>
      buildSenderDeliverabilityScorecards({
        events: Object.values(runView?.eventsByRun ?? {}).flat(),
        senderAccounts,
      }),
    [runView?.eventsByRun, senderAccounts]
  );
  const activeSenderScorecards = useMemo(
    () => senderScorecards.filter((scorecard) => !scorecard.autoPaused),
    [senderScorecards]
  );
  const latestMonitorProviderBreakdown = useMemo(() => {
    if (!latestDeliverabilityResult) return [] as Array<{
      provider: string;
      inbox: number;
      spam: number;
      allMailOnly: number;
      notFound: number;
      error: number;
      total: number;
    }>;
    const monitorResults = Array.isArray(latestDeliverabilityResult.payload.monitorResults)
      ? latestDeliverabilityResult.payload.monitorResults
      : [];
    const accountById = new Map(outreachAccounts.map((account) => [account.id, account] as const));
    const buckets = new Map<
      string,
      { provider: string; inbox: number; spam: number; allMailOnly: number; notFound: number; error: number; total: number }
    >();
    for (const rawEntry of monitorResults) {
      const entry = rawEntry && typeof rawEntry === "object" ? (rawEntry as Record<string, unknown>) : {};
      const accountId = asText(entry.accountId);
      const placement = asText(entry.placement);
      const provider = monitorProviderLabel(accountById.get(accountId) ?? null);
      const bucket = buckets.get(provider) ?? {
        provider,
        inbox: 0,
        spam: 0,
        allMailOnly: 0,
        notFound: 0,
        error: 0,
        total: 0,
      };
      bucket.total += 1;
      if (placement === "inbox") bucket.inbox += 1;
      else if (placement === "spam") bucket.spam += 1;
      else if (placement === "all_mail_only") bucket.allMailOnly += 1;
      else if (placement === "not_found") bucket.notFound += 1;
      else bucket.error += 1;
      buckets.set(provider, bucket);
    }
    return Array.from(buckets.values()).sort((left, right) => left.provider.localeCompare(right.provider));
  }, [latestDeliverabilityResult, outreachAccounts]);
  const hopperActive = campaign?.status === "active";

  if (loading || !campaign || !runView) {
    return <div className="text-sm text-[color:var(--muted-foreground)]">Loading campaign...</div>;
  }

  return (
    <div className="space-y-5">
      <PageIntro
        eyebrow={`${brand?.name || "Brand"} / campaign`}
        title={campaign.name}
        description={`Scaled from experiment ${campaign.sourceExperimentId.slice(-6)}. Throughput is editable here, but the source offer, audience, and flow proof stay locked.`}
        actions={
          <>
            <Button type="button" disabled={!flowCampaignId || !flowVariantId} onClick={() => setFlowModalOpen(true)}>
              <GitBranch className="h-4 w-4" />
              Open flow
            </Button>
            <Button asChild variant="outline">
              <Link href={`/brands/${brandId}/experiments/${campaign.sourceExperimentId}`}>Source experiment</Link>
            </Button>
          </>
        }
        aside={
          <StatLedger
            items={[
              {
                label: "Sent",
                value: campaign.metricsSummary.sent.toLocaleString(),
                detail: latestRun ? `Latest live run ${latestRun.id.slice(-6)} is ${latestRun.status}.` : "No live run yet.",
              },
              {
                label: "Replies",
                value: campaign.metricsSummary.replies.toLocaleString(),
                detail: `${campaign.metricsSummary.positiveReplies.toLocaleString()} positive replies recorded.`,
              },
              {
                label: "Senders",
                value: senderAccounts.length.toString().padStart(2, "0"),
                detail: activeSenderScorecards.length
                  ? `${activeSenderScorecards.length} sender${activeSenderScorecards.length === 1 ? "" : "s"} available now.`
                  : "No sender is currently available.",
              },
            ]}
          />
        }
      />

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <SectionPanel
        title="Campaign chain"
        description="Read this campaign as one operating system: data, deliverability, offer quality, then replies and conversions."
      >
        <div>
          <CampaignOperationsChain
            steps={buildCampaignOperationsChain({
              campaign,
              sourcedLeads: latestRun?.metrics.sourcedLeads ?? runView.leads.length,
              placement: latestPlacement.placement,
              deliverability: provisioningSettings?.deliverability ?? null,
            })}
            onStepClick={(stepId) => {
              if (stepId === "offer_quality") {
                setFlowModalOpen(true);
                return;
              }
              if (stepId === "deliverability") {
                scrollToCampaignSection("campaign-deliverability");
                return;
              }
              if (stepId === "replies") {
                scrollToCampaignSection("campaign-replies");
                return;
              }
              scrollToCampaignSection("campaign-data");
            }}
          />
        </div>
      </SectionPanel>

      <SectionPanel
        title="Locked source snapshot"
        description="Strategy, offer, audience, and published flow are preserved from the experiment that proved out."
        className="scroll-mt-24"
      >
        <div id="campaign-data" className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="grid gap-3 rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 text-sm leading-7">
            <div>
              <span className="text-[color:var(--muted-foreground)]">Offer</span>
              <div className="mt-1 text-[color:var(--foreground)]">{campaign.snapshot.offer || "Not set"}</div>
            </div>
            <div className="border-t border-[color:var(--border)] pt-3">
              <span className="text-[color:var(--muted-foreground)]">Audience</span>
              <div className="mt-1 text-[color:var(--foreground)]">{campaign.snapshot.audience || "Not set"}</div>
            </div>
            <div className="border-t border-[color:var(--border)] pt-3">
              <span className="text-[color:var(--muted-foreground)]">Flow revision</span>
              <div className="mt-1 text-[color:var(--foreground)]">
                {campaign.snapshot.publishedRevision > 0 ? `#${campaign.snapshot.publishedRevision}` : "Not published"}
              </div>
            </div>
          </div>
          <StatLedger
            items={[
              {
                label: "Status",
                value: campaign.status,
                detail: hopperActive ? "Campaign hopper is active." : "Campaign hopper is paused or finished.",
              },
              {
                label: "Latest run",
                value: latestRun ? latestRun.id.slice(-6) : "none",
                detail: latestRun ? `${latestRun.metrics.sentMessages} sent in the latest run.` : "Nothing has launched yet.",
              },
            ]}
          />
        </div>
      </SectionPanel>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scale controls (editable)</CardTitle>
          <CardDescription>
            Set your campaign hopper throughput. The system auto-starts new runs while below daily target.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-2">
            <Label>Daily target (emails/day)</Label>
            <Input
              type="number"
              min={1}
              value={campaign.scalePolicy.dailyCap}
              onChange={(event) =>
                setCampaign((prev) =>
                  prev
                    ? {
                        ...prev,
                        scalePolicy: {
                          ...prev.scalePolicy,
                          dailyCap: Math.max(1, Number(event.target.value || 1)),
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Hourly cap</Label>
            <Input
              type="number"
              min={1}
              value={campaign.scalePolicy.hourlyCap}
              onChange={(event) =>
                setCampaign((prev) =>
                  prev
                    ? {
                        ...prev,
                        scalePolicy: {
                          ...prev.scalePolicy,
                          hourlyCap: Math.max(1, Number(event.target.value || 1)),
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Timezone</Label>
            <Input
              value={campaign.scalePolicy.timezone}
              onChange={(event) =>
                setCampaign((prev) =>
                  prev
                    ? {
                        ...prev,
                        scalePolicy: {
                          ...prev.scalePolicy,
                          timezone: event.target.value,
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Min spacing (minutes)</Label>
            <Input
              type="number"
              min={1}
              value={campaign.scalePolicy.minSpacingMinutes}
              onChange={(event) =>
                setCampaign((prev) =>
                  prev
                    ? {
                        ...prev,
                        scalePolicy: {
                          ...prev.scalePolicy,
                          minSpacingMinutes: Math.max(1, Number(event.target.value || 1)),
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Delivery account id</Label>
            <Input
              value={campaign.scalePolicy.accountId}
              onChange={(event) =>
                setCampaign((prev) =>
                  prev
                    ? {
                        ...prev,
                        scalePolicy: {
                          ...prev.scalePolicy,
                          accountId: event.target.value,
                        },
                      }
                    : prev
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Reply mailbox account id</Label>
            <Input
              value={campaign.scalePolicy.mailboxAccountId}
              onChange={(event) =>
                setCampaign((prev) =>
                  prev
                    ? {
                        ...prev,
                        scalePolicy: {
                          ...prev.scalePolicy,
                          mailboxAccountId: event.target.value,
                        },
                      }
                    : prev
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card id="campaign-deliverability" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="text-base">Execution</CardTitle>
          <CardDescription>
            Start hopper mode to keep this campaign running every day at the target volume. Deliverability checks use the connected seed group and re-run weekly while active.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                const saved = await updateScaleCampaignApi(brandId, campaign.id, {
                  scalePolicy: campaign.scalePolicy,
                });
                setCampaign(saved);
                trackEvent("campaign_scale_updated", { brandId, campaignId: campaign.id });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to save campaign");
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Scale Controls"}
          </Button>
          <Button
            type="button"
            disabled={launching}
            onClick={async () => {
              setLaunching(true);
              setError("");
              try {
                if (hopperActive) {
                  await updateScaleCampaignApi(brandId, campaign.id, {
                    status: "paused",
                    scalePolicy: campaign.scalePolicy,
                  });
                } else {
                  await updateScaleCampaignApi(brandId, campaign.id, {
                    scalePolicy: campaign.scalePolicy,
                  });
                  const result = await launchScaleCampaignApi(brandId, campaign.id);
                  trackEvent("campaign_launched", { brandId, campaignId: campaign.id, runId: result.runId });
                }
                await refresh(false);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to update hopper");
              } finally {
                setLaunching(false);
              }
            }}
          >
            {hopperActive ? <Pause className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
            {launching ? "Saving..." : hopperActive ? "Pause Hopper" : "Start Hopper"}
          </Button>
          {latestRun && canPause(latestRun.status) ? (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await controlScaleCampaignRunApi(brandId, campaign.id, latestRun.id, "pause");
                await refresh(false);
              }}
            >
              <Pause className="h-4 w-4" /> Pause
            </Button>
          ) : null}
          {latestRun && canResume(latestRun.status) ? (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await controlScaleCampaignRunApi(brandId, campaign.id, latestRun.id, "resume");
                await refresh(false);
              }}
            >
              <Play className="h-4 w-4" /> Resume
            </Button>
          ) : null}
          {latestRun ? (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await controlScaleCampaignRunApi(brandId, campaign.id, latestRun.id, "probe_deliverability");
                await refresh(false);
              }}
            >
              Run spam check group
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deliverability view</CardTitle>
          <CardDescription>
            Latest seed-group result, split by inbox provider, so you can see whether the problem is broad or provider-specific.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {latestDeliverabilityResult ? (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                  <div className="text-xs text-[color:var(--muted-foreground)]">Latest result</div>
                  <div className="mt-1 text-lg font-semibold">{latestPlacement.headline}</div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">{latestPlacement.detail}</div>
                </div>
                <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                  <div className="text-xs text-[color:var(--muted-foreground)]">Checked</div>
                  <div className="mt-1 text-sm font-semibold">{formatDate(latestDeliverabilityResult.createdAt)}</div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">{asText(latestDeliverabilityResult.payload.fromEmail)}</div>
                </div>
                <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                  <div className="text-xs text-[color:var(--muted-foreground)]">Seed group</div>
                  <div className="mt-1 text-lg font-semibold">{asNumber(latestDeliverabilityResult.payload.totalMonitors)}</div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">{asText(latestDeliverabilityResult.payload.summaryText)}</div>
                </div>
                <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                  <div className="text-xs text-[color:var(--muted-foreground)]">Probe subject</div>
                  <div className="mt-1 text-sm font-semibold">{asText(latestDeliverabilityResult.payload.subject) || "—"}</div>
                </div>
              </div>

              {latestMonitorProviderBreakdown.length ? (
                <div className="grid gap-3 md:grid-cols-3">
                  {latestMonitorProviderBreakdown.map((bucket) => (
                    <div
                      key={bucket.provider}
                      className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">{bucket.provider}</div>
                        <Badge variant={bucket.spam > bucket.inbox ? "danger" : bucket.inbox > 0 ? "success" : "muted"}>
                          {bucket.total} seeds
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
                          <div className="text-[color:var(--muted-foreground)]">Inbox</div>
                          <div className="mt-1 text-sm font-semibold">{bucket.inbox}</div>
                        </div>
                        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
                          <div className="text-[color:var(--muted-foreground)]">Spam</div>
                          <div className="mt-1 text-sm font-semibold">{bucket.spam}</div>
                        </div>
                        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
                          <div className="text-[color:var(--muted-foreground)]">All mail</div>
                          <div className="mt-1 text-sm font-semibold">{bucket.allMailOnly}</div>
                        </div>
                        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
                          <div className="text-[color:var(--muted-foreground)]">Missing/Error</div>
                          <div className="mt-1 text-sm font-semibold">{bucket.notFound + bucket.error}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-sm text-[color:var(--muted-foreground)]">
              No deliverability result yet. Run a spam check group to populate this view.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sender health</CardTitle>
          <CardDescription>
            Seed-group results per sender. Senders with at least 50% spam across a meaningful sample are cooled off for 24 hours and removed from rotation automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="muted">{senderScorecards.length} configured</Badge>
            <Badge variant={activeSenderScorecards.length ? "success" : "danger"}>
              {activeSenderScorecards.length} available now
            </Badge>
          </div>
          {senderScorecards.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {senderScorecards.map((scorecard) => (
                <div
                  key={scorecard.senderAccountId || scorecard.fromEmail}
                  className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{scorecard.senderAccountName || scorecard.fromEmail}</div>
                      <div className="text-xs text-[color:var(--muted-foreground)]">{scorecard.fromEmail || "No from email"}</div>
                    </div>
                    {senderHealthBadge(scorecard)}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
                      <div className="text-[color:var(--muted-foreground)]">Inbox</div>
                      <div className="mt-1 text-sm font-semibold">{Math.round(scorecard.inboxRate * 100)}%</div>
                    </div>
                    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
                      <div className="text-[color:var(--muted-foreground)]">Spam</div>
                      <div className="mt-1 text-sm font-semibold">{Math.round(scorecard.spamRate * 100)}%</div>
                    </div>
                    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
                      <div className="text-[color:var(--muted-foreground)]">Seeds</div>
                      <div className="mt-1 text-sm font-semibold">{scorecard.totalMonitors || "—"}</div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-[color:var(--muted-foreground)]">
                    {scorecard.checkedAt ? `Last check ${formatDate(scorecard.checkedAt)}` : "No spam check yet"}
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{scorecard.summaryText}</div>
                  {scorecard.autoPaused ? (
                    <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50/80 p-2 text-xs text-[color:var(--danger)]">
                      {scorecard.autoPauseReason}. Back in rotation after {formatDate(scorecard.autoPauseUntil)} unless a newer good check replaces it.
                    </div>
                  ) : null}
                  {scorecard.manualOverrideActive ? (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/80 p-2 text-xs text-[color:var(--foreground)]">
                      Manual override is active since {formatDate(scorecard.manualOverrideAt)}.
                    </div>
                  ) : null}
                  {scorecard.autoPaused && latestRun ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 w-full"
                      disabled={resumingSenderId === scorecard.senderAccountId}
                      onClick={async () => {
                        if (!scorecard.senderAccountId) return;
                        setResumingSenderId(scorecard.senderAccountId);
                        setError("");
                        try {
                          await controlScaleCampaignRunApi(
                            brandId,
                            campaign.id,
                            latestRun.id,
                            "resume_sender_deliverability",
                            "Manual sender override from deliverability view",
                            { senderAccountId: scorecard.senderAccountId }
                          );
                          await refresh(false);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Failed to resume sender");
                        } finally {
                          setResumingSenderId("");
                        }
                      }}
                    >
                      {resumingSenderId === scorecard.senderAccountId ? "Resuming..." : "Force back into rotation"}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[color:var(--muted-foreground)]">
              No sender accounts are assigned to this campaign yet.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run visibility</CardTitle>
          <CardDescription>Latest attempt, worker events, sent emails, and replies.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {latestRun ? (
            <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Run {latestRun.id.slice(-6)}</div>
                <Badge variant={runStatusVariant(latestRun.status)}>{latestRun.status}</Badge>
              </div>
              <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                Leads {latestRun.metrics.sourcedLeads} · Sent {latestRun.metrics.sentMessages} · Replies {latestRun.metrics.replies}
              </div>
              <div className="mt-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2 text-sm">
                <div className="text-[12px] text-[color:var(--muted-foreground)]">
                  Inbox placement
                </div>
                <div className={`mt-1 font-semibold ${latestPlacement.tone}`}>{latestPlacement.headline}</div>
                <div className="text-xs text-[color:var(--muted-foreground)]">{latestPlacement.detail}</div>
              </div>
              {latestRun.lastError ? (
                <div className="mt-2 text-sm text-[color:var(--danger)]">Reason: {latestRun.lastError}</div>
              ) : null}
            </div>
          ) : (
            <div className="text-sm text-[color:var(--muted-foreground)]">No runs yet.</div>
          )}

          <div>
            <div className="text-sm font-medium">Sent messages</div>
            {runView.messages.length ? (
              <div className="mt-2 space-y-2">
                {runView.messages.slice(0, 20).map((message) => (
                  <div key={message.id} className="rounded-lg border border-[color:var(--border)] p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{message.subject || "(no subject)"}</span>
                      <Badge variant={message.status === "sent" ? "success" : message.status === "failed" ? "danger" : "muted"}>
                        {message.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[color:var(--muted-foreground)]">
                      {message.body.slice(0, 180)}{message.body.length > 180 ? "..." : ""}
                    </div>
                    <div className="mt-1 text-[color:var(--muted-foreground)]">
                      {formatDate(message.sentAt || message.scheduledAt)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">No messages yet.</div>
            )}
          </div>

          <div>
            <div id="campaign-replies" className="scroll-mt-24 text-sm font-medium">Reply threads</div>
            {runView.threads.length ? (
              <div className="mt-2 space-y-2">
                {runView.threads.slice(0, 20).map((thread) => (
                  <div key={thread.id} className="rounded-lg border border-[color:var(--border)] p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{thread.subject || "(no subject)"}</span>
                      <Badge variant={thread.sentiment === "positive" ? "success" : thread.sentiment === "negative" ? "danger" : "muted"}>
                        {thread.sentiment}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[color:var(--muted-foreground)]">
                      {thread.intent} · {formatDate(thread.lastMessageAt)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">No replies yet.</div>
            )}
          </div>

          <div>
            <div className="text-sm font-medium">Timeline events</div>
            {latestEvents.length ? (
              <div className="mt-2 space-y-2">
                {latestEvents.slice(0, 25).map((event) => (
                  <div key={event.id} className="rounded-lg border border-[color:var(--border)] p-2 text-xs">
                    <div className="font-medium">{event.eventType}</div>
                    <div className="text-[color:var(--muted-foreground)]">{formatDate(event.createdAt)}</div>
                    {event.payload.reason ? (
                      <div className="mt-1 text-[color:var(--danger)]">{String(event.payload.reason)}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">No timeline events yet.</div>
            )}
          </div>
        </CardContent>
      </Card>

      {provisioningSettings?.deliverability.provider === "google_postmaster" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deliverability intelligence</CardTitle>
            <CardDescription>
              Google Postmaster health for the monitored sending domains.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">
                  {provisioningSettings.deliverability.monitoredDomains.join(", ") || "No monitored domains"}
                </div>
                <Badge
                  variant={
                    provisioningSettings.deliverability.lastHealthStatus === "critical"
                      ? "danger"
                      : provisioningSettings.deliverability.lastHealthStatus === "warning"
                        ? "accent"
                        : provisioningSettings.deliverability.lastHealthStatus === "healthy"
                          ? "success"
                          : "muted"
                  }
                >
                  {provisioningSettings.deliverability.lastHealthStatus}
                </Badge>
              </div>
              <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                Score {provisioningSettings.deliverability.lastHealthScore || 0} · Last checked{" "}
                {formatDate(provisioningSettings.deliverability.lastCheckedAt || "")}
              </div>
              <div className="mt-2 text-sm">
                {provisioningSettings.deliverability.lastHealthSummary || "No Gmail reputation snapshot yet."}
              </div>
            </div>
            {provisioningSettings.deliverability.lastDomainSnapshots.length ? (
              <div className="space-y-2">
                {provisioningSettings.deliverability.lastDomainSnapshots.map((domain) => (
                  <div key={domain.domain} className="rounded-lg border border-[color:var(--border)] p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{domain.domain}</span>
                      <Badge
                        variant={
                          domain.status === "critical"
                            ? "danger"
                            : domain.status === "warning"
                              ? "accent"
                              : domain.status === "healthy"
                                ? "success"
                                : "muted"
                        }
                      >
                        {domain.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[color:var(--muted-foreground)]">
                      Reputation {domain.domainReputation || "unknown"} · Spam {(domain.spamRate * 100).toFixed(2)}%
                      {domain.trafficDate ? ` · Latest ${domain.trafficDate}` : ""}
                    </div>
                    <div className="mt-1 text-[color:var(--muted-foreground)]">{domain.summary}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <SettingsModal
        open={flowModalOpen}
        title="Conversational flow"
        description="Review and edit the real conversation map for this campaign without leaving the campaign view."
        panelClassName="max-h-[94vh] max-w-[min(96vw,1680px)]"
        bodyClassName="p-0"
        onOpenChange={setFlowModalOpen}
      >
        {flowCampaignId && flowVariantId ? (
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
            This campaign does not have a conversation flow attached yet. Open the source experiment first, then try again.
          </div>
        )}
      </SettingsModal>
    </div>
  );
}
