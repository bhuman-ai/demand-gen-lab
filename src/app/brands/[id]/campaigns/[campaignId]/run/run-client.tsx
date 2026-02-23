"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  Square,
  Plus,
  Save,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  approveReplyDraftAndSend,
  cancelRun,
  fetchBrand,
  fetchCampaign,
  fetchRunView,
  launchExperimentRun,
  pauseRun,
  resumeRun,
  updateCampaignApi,
} from "@/lib/client-api";
import { trackEvent } from "@/lib/telemetry-client";
import type {
  BrandRecord,
  CampaignRecord,
  EvolutionSnapshot,
  OutreachMessage,
  OutreachRun,
  OutreachRunEvent,
  OutreachRunJob,
  RunViewModel,
} from "@/lib/factory-types";
import { cn } from "@/lib/utils";

type RunTab = "overview" | "variants" | "leads" | "inbox" | "insights";

const RUN_PAUSABLE_STATUSES: OutreachRun["status"][] = [
  "queued",
  "sourcing",
  "scheduled",
  "sending",
  "monitoring",
];

const RUN_ACTIVE_STATUSES: OutreachRun["status"][] = [
  "queued",
  "sourcing",
  "scheduled",
  "sending",
  "monitoring",
  "paused",
];

const makeInsightId = () => `evo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function runStatusVariant(status: OutreachRun["status"]) {
  if (status === "completed") return "success" as const;
  if (status === "failed" || status === "preflight_failed" || status === "paused" || status === "canceled") {
    return "danger" as const;
  }
  if (status === "sending" || status === "monitoring") return "accent" as const;
  return "muted" as const;
}

function messageStatusVariant(status: OutreachMessage["status"]) {
  if (status === "sent" || status === "replied") return "success" as const;
  if (status === "failed" || status === "bounced") return "danger" as const;
  if (status === "scheduled") return "accent" as const;
  return "muted" as const;
}

function formatDateTime(value: string) {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function previewText(text: string, max = 140) {
  const trimmed = text.trim();
  if (!trimmed) return "—";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}...`;
}

function friendlyJobType(jobType: OutreachRunJob["jobType"]) {
  if (jobType === "source_leads") return "Lead sourcing";
  if (jobType === "schedule_messages") return "Message scheduling";
  if (jobType === "dispatch_messages") return "Message dispatch";
  if (jobType === "sync_replies") return "Reply sync";
  if (jobType === "conversation_tick") return "Conversation branching";
  return "Run analysis";
}

function friendlyEventName(eventType: string) {
  if (eventType === "run_started") return "Run started";
  if (eventType === "lead_sourcing_requested") return "Lead sourcing requested";
  if (eventType === "lead_sourcing_search_completed") return "Lead search results";
  if (eventType === "lead_sourcing_email_discovery_started") return "Email discovery started";
  if (eventType === "lead_sourcing_email_discovery_polled") return "Email discovery status";
  if (eventType === "lead_sourcing_email_discovery_completed") return "Email discovery results";
  if (eventType === "lead_sourcing_completed") return "Lead sourcing completed";
  if (eventType === "lead_sourced_apify") return "Leads stored";
  if (eventType === "message_scheduled") return "Messages scheduled";
  if (eventType === "message_sent") return "Message sent";
  if (eventType === "dispatch_failed") return "Dispatch failed";
  if (eventType === "schedule_failed") return "Scheduling failed";
  if (eventType === "reply_ingested") return "Reply ingested";
  if (eventType === "reply_draft_created") return "Reply draft created";
  if (eventType === "reply_draft_sent") return "Reply sent";
  if (eventType === "conversation_tick_processed") return "Conversation tick";
  if (eventType === "job_started") return "Worker job started";
  if (eventType === "job_completed") return "Worker job completed";
  if (eventType === "job_failed") return "Worker job failed";
  return eventType.replaceAll("_", " ");
}

function summarizeEvent(event: OutreachRunEvent) {
  const reason = asText(event.payload.reason);
  if (reason) return reason;

  if (event.eventType === "lead_sourcing_requested") {
    const maxLeads = asNumber(event.payload.maxLeads);
    return `Requested up to ${maxLeads ?? "?"} leads`;
  }
  if (event.eventType === "lead_sourcing_search_completed") {
    const ok = Boolean(event.payload.ok);
    const domainsFound = asNumber(event.payload.domainsFound);
    const rawResultCount = asNumber(event.payload.rawResultCount);
    if (!ok) {
      const error = asText(event.payload.error);
      return error ? `Search failed: ${error}` : "Search failed";
    }
    return `Found ${domainsFound ?? 0} domains from ${rawResultCount ?? 0} results`;
  }
  if (event.eventType === "lead_sourcing_email_discovery_completed") {
    const ok = Boolean(event.payload.ok);
    const datasetRows = asNumber(event.payload.datasetRows);
    if (!ok) {
      const error = asText(event.payload.error);
      return error ? `Fetch failed: ${error}` : "Fetch failed";
    }
    return `Retrieved ${datasetRows ?? 0} rows`;
  }
  if (event.eventType === "lead_sourced_apify") {
    const count = asNumber(event.payload.count);
    const blockedCount = asNumber(event.payload.blockedCount);
    return `Stored ${count ?? 0} leads${blockedCount ? ` (${blockedCount} suppressed)` : ""}`;
  }
  if (event.eventType === "message_scheduled") {
    const count = asNumber(event.payload.count);
    return `Scheduled ${count ?? 0} messages`;
  }
  if (event.eventType === "conversation_tick_processed") {
    const scheduled = asNumber(event.payload.scheduledCount);
    const completed = asNumber(event.payload.completedCount);
    const failed = asNumber(event.payload.failedCount);
    return `Tick processed · scheduled ${scheduled ?? 0} · completed ${completed ?? 0} · failed ${failed ?? 0}`;
  }
  if (event.eventType === "job_started" || event.eventType === "job_completed") {
    const jobType = asText(event.payload.jobType);
    const attempt = asNumber(event.payload.attempt);
    if (jobType) {
      return `${friendlyJobType(jobType as OutreachRunJob["jobType"])} (attempt ${attempt ?? 1})`;
    }
  }

  const note = asText(event.payload.note);
  if (note) return note;

  return "";
}

type OutcomeTone = "normal" | "muted" | "danger";

function outcomeToneClass(tone: OutcomeTone) {
  if (tone === "danger") return "text-[color:var(--danger)]";
  if (tone === "muted") return "text-[color:var(--muted-foreground)]";
  return "text-[color:var(--foreground)]";
}

function summarizeSendOutcome(run: OutreachRun) {
  if (run.metrics.sentMessages > 0) {
    return {
      headline: "Yes",
      detail: `${run.metrics.sentMessages} emails sent`,
      tone: "normal" as OutcomeTone,
    };
  }

  if (["queued", "sourcing", "scheduled", "sending", "monitoring", "paused"].includes(run.status)) {
    return {
      headline: "Not yet",
      detail: "Run is active but no sends have completed yet",
      tone: "muted" as OutcomeTone,
    };
  }

  if (["preflight_failed", "failed", "canceled"].includes(run.status)) {
    return {
      headline: "No",
      detail: "Run stopped before sending",
      tone: "danger" as OutcomeTone,
    };
  }

  return {
    headline: "No",
    detail: "0 emails sent so far",
    tone: "muted" as OutcomeTone,
  };
}

function summarizeReplyOutcome(run: OutreachRun) {
  if (run.metrics.replies > 0) {
    return {
      headline: "Yes",
      detail: `${run.metrics.replies} replies received`,
      tone: "normal" as OutcomeTone,
    };
  }

  if (run.metrics.sentMessages > 0 && ["monitoring", "sending", "scheduled", "paused"].includes(run.status)) {
    return {
      headline: "Not yet",
      detail: "No replies so far; inbox sync is still running",
      tone: "muted" as OutcomeTone,
    };
  }

  if (run.metrics.sentMessages === 0) {
    return {
      headline: "No",
      detail: "No replies because no emails have sent yet",
      tone: "muted" as OutcomeTone,
    };
  }

  return {
    headline: "No",
    detail: "No replies recorded for this run",
    tone: "muted" as OutcomeTone,
  };
}

function friendlyRunLaunchError(error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to launch run";
  if (message.includes("Lead source is not configured for this hypothesis")) {
    return "Run did not start: this angle has no lead source yet. Save Build, then retry.";
  }
  if (message.includes("Lead sourcing credentials are missing")) {
    return "Run did not start: lead sourcing credentials are missing in this deployment.";
  }
  if (message.includes("Lead sourcing is not enabled for this workspace")) {
    return "Run did not start: lead sourcing is not enabled for this workspace.";
  }
  if (message.includes("Experiment already has an active run")) {
    return "This variant already has an active run. Pause/cancel it, or restart.";
  }
  return message;
}

function byNewest<T extends { createdAt: string }>(rows: T[]) {
  return [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

const TABS: Array<{ id: RunTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "variants", label: "Variants" },
  { id: "leads", label: "Leads" },
  { id: "inbox", label: "Inbox" },
  { id: "insights", label: "Insights" },
];

export default function RunClient({
  brandId,
  campaignId,
  tab,
}: {
  brandId: string;
  campaignId: string;
  tab: RunTab;
}) {
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [runView, setRunView] = useState<RunViewModel | null>(null);
  const [insightsDraft, setInsightsDraft] = useState<EvolutionSnapshot[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [savingInsights, setSavingInsights] = useState(false);
  const [sendingDraftId, setSendingDraftId] = useState("");
  const [error, setError] = useState("");

  const refresh = async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true);
    try {
      const [campaignRow, runRow] = await Promise.all([
        fetchCampaign(brandId, campaignId),
        fetchRunView(brandId, campaignId),
      ]);
      setCampaign(campaignRow);
      setRunView(runRow);
      setInsightsDraft(runRow.insights);
      if (!selectedVariantId || !campaignRow.experiments.some((row) => row.id === selectedVariantId)) {
        setSelectedVariantId(campaignRow.experiments[0]?.id ?? "");
      }
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");

    void Promise.all([fetchBrand(brandId), fetchCampaign(brandId, campaignId), fetchRunView(brandId, campaignId)])
      .then(([brandRow, campaignRow, runRow]) => {
        if (!mounted) return;
        setBrand(brandRow);
        setCampaign(campaignRow);
        setRunView(runRow);
        setInsightsDraft(runRow.insights);
        setSelectedVariantId(campaignRow.experiments[0]?.id ?? "");
        localStorage.setItem("factory.activeBrandId", brandId);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load run workspace");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [brandId, campaignId]);

  useEffect(() => {
    trackEvent("run_viewed", { brandId, campaignId });
  }, [brandId, campaignId]);

  useEffect(() => {
    trackEvent("run_tab_opened", { brandId, campaignId, tab });
  }, [brandId, campaignId, tab]);

  if (!campaign || !runView) {
    if (error) {
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Could not load run workspace</CardTitle>
            <CardDescription className="text-[color:var(--danger)]">{error}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <Button asChild variant="outline" type="button">
              <Link href={`/brands/${brandId}/campaigns/${campaignId}/build`}>Back to Build</Link>
            </Button>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="text-sm text-[color:var(--muted-foreground)]">
        {loading ? "Loading run workspace..." : "Run workspace is unavailable."}
      </div>
    );
  }

  const runs = byNewest(runView.runs);
  const activeRuns = runs.filter((run) => RUN_ACTIVE_STATUSES.includes(run.status));
  const selectedVariant = campaign.experiments.find((row) => row.id === selectedVariantId) ?? null;
  const selectedVariantRuns = selectedVariant
    ? runs.filter((run) => run.experimentId === selectedVariant.id)
    : [];

  const latestRun = runs[0] ?? null;
  const totalLeads = runView.leads.length;
  const totalReplies = runView.threads.length;
  const totalSent = runs.reduce((sum, run) => sum + run.metrics.sentMessages, 0);
  const totalPositiveReplies = runs.reduce((sum, run) => sum + run.metrics.positiveReplies, 0);
  const hasAnySent = totalSent > 0;
  const hasAnyReplies = totalReplies > 0;
  const leadById = new Map(runView.leads.map((lead) => [lead.id, lead]));
  const outboundMessages = [...runView.messages].sort((a, b) => {
    const aTime = a.sentAt || a.scheduledAt || a.createdAt;
    const bTime = b.sentAt || b.scheduledAt || b.createdAt;
    return aTime < bTime ? 1 : -1;
  });
  const inboundReplyMessages = runView.replyMessages
    .filter((message) => message.direction === "inbound")
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));

  const launchForVariant = async (experimentId: string) => {
    setLaunching(true);
    setError("");
    try {
      const openRun = runs.find(
        (run) => run.experimentId === experimentId && RUN_ACTIVE_STATUSES.includes(run.status)
      );
      if (openRun) {
        const confirmed = window.confirm(
          `Variant already has an active run (${openRun.id.slice(-6)} · ${openRun.status}). Cancel and restart?`
        );
        if (!confirmed) return;
        await cancelRun(brandId, campaignId, openRun.id, "Restarted from run workspace");
      }

      await launchExperimentRun(brandId, campaignId, experimentId);
      trackEvent("run_started", { brandId, campaignId, experimentId });
      await refresh(false);
    } catch (err) {
      setError(friendlyRunLaunchError(err));
    } finally {
      setLaunching(false);
    }
  };

  const saveInsights = async () => {
    setSavingInsights(true);
    setError("");
    try {
      const updated = await updateCampaignApi(brandId, campaignId, { evolution: insightsDraft });
      setCampaign(updated);
      setRunView((prev) => (prev ? { ...prev, insights: updated.evolution } : prev));
      trackEvent("campaign_saved", { brandId, campaignId, step: "run_insights" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save insights");
    } finally {
      setSavingInsights(false);
    }
  };

  const runAction = async (
    run: OutreachRun,
    action: "pause" | "resume" | "cancel"
  ) => {
    setError("");
    try {
      if (action === "pause") {
        await pauseRun(brandId, campaignId, run.id, "Paused from run workspace");
      }
      if (action === "resume") {
        await resumeRun(brandId, campaignId, run.id);
      }
      if (action === "cancel") {
        await cancelRun(brandId, campaignId, run.id, "Canceled from run workspace");
      }
      await refresh(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run action failed");
    }
  };

  const header = (
    <Card>
      <CardHeader>
        <CardTitle>
          {brand?.name} · {campaign.name}
        </CardTitle>
        <CardDescription>
          Run workspace: launch, monitor, and iterate from one place.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-4">
        <div>
          <div className="text-xs text-[color:var(--muted-foreground)]">Runs</div>
          <div className="text-lg font-semibold">{runs.length}</div>
        </div>
        <div>
          <div className="text-xs text-[color:var(--muted-foreground)]">Active Runs</div>
          <div className="text-lg font-semibold">{activeRuns.length}</div>
        </div>
        <div>
          <div className="text-xs text-[color:var(--muted-foreground)]">Leads</div>
          <div className="text-lg font-semibold">{totalLeads}</div>
        </div>
        <div>
          <div className="text-xs text-[color:var(--muted-foreground)]">Replies</div>
          <div className="text-lg font-semibold">{totalReplies}</div>
        </div>
      </CardContent>
    </Card>
  );

  const tabs = (
    <Card>
      <CardContent className="flex flex-wrap gap-2 py-4">
        {TABS.map((item) => {
          const href = `/brands/${brandId}/campaigns/${campaignId}/run/${item.id}`;
          const active = item.id === tab;
          return (
            <Link
              key={item.id}
              href={href}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition",
                active
                  ? "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
                  : "border-[color:var(--border)] text-[color:var(--muted-foreground)] hover:bg-[color:var(--surface-muted)]"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );

  const controls = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Run Controls</CardTitle>
        <CardDescription>
          Choose a variant and launch autopilot. Reply routing and account setup come from Outreach Settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="grid gap-2">
          <Label htmlFor="run-variant-select">Variant</Label>
          <Select
            id="run-variant-select"
            value={selectedVariantId}
            onChange={(event) => setSelectedVariantId(event.target.value)}
          >
            <option value="">Select a variant</option>
            {campaign.experiments.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name || `Variant ${variant.id.slice(-4)}`}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!selectedVariantId || launching}
            onClick={() => {
              if (!selectedVariantId) return;
              void launchForVariant(selectedVariantId);
            }}
          >
            <Rocket className="h-4 w-4" />
            {launching ? "Launching..." : selectedVariantRuns.some((run) => RUN_ACTIVE_STATUSES.includes(run.status)) ? "Restart Run" : "Launch Run"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
          <Button asChild type="button" variant="outline">
            <Link href={`/brands/${brandId}/campaigns/${campaignId}/build`}>Open Build</Link>
          </Button>
        </div>
      </CardContent>
      {latestRun ? (
        <CardContent className="border-t border-[color:var(--border)] pt-3 text-sm">
          <div className="font-medium">Latest attempt: Run {latestRun.id.slice(-6)}</div>
          <div className="mt-1 text-[color:var(--muted-foreground)]">
            Status {latestRun.status} · leads {latestRun.metrics.sourcedLeads} · sent {latestRun.metrics.sentMessages} · replies {latestRun.metrics.replies}
          </div>
          <div className="mt-1 text-[color:var(--muted-foreground)]">
            Did emails send? {latestRun.metrics.sentMessages > 0 ? "Yes" : "No"} · Did we get replies?{" "}
            {latestRun.metrics.replies > 0 ? "Yes" : "No"}
          </div>
          {latestRun.lastError ? (
            <div className="mt-1 text-[color:var(--danger)]">Reason: {latestRun.lastError}</div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );

  const visibility = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Run Results & Activity</CardTitle>
        <CardDescription>
          Outcome first, then worker timeline and payload details when you need to debug.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {runs.map((run) => {
          const runAnomalies = runView.anomalies.filter((row) => row.runId === run.id && row.status === "active");
          const runEvents = runView.eventsByRun[run.id] ?? [];
          const runJobs = runView.jobsByRun[run.id] ?? [];
          const latestEvent = runEvents[0] ?? null;
          const nextQueuedJob = runJobs.find((job) => job.status === "queued") ?? null;
          const mostRecentJobError = runJobs.find((job) => job.lastError.trim()) ?? null;
          const lastSentEvent = runEvents.find((event) => event.eventType === "message_sent") ?? null;
          const lastReplyEvent = runEvents.find((event) => event.eventType === "reply_ingested") ?? null;
          const lastDispatchFailure = runEvents.find((event) => event.eventType === "dispatch_failed") ?? null;
          const sendOutcome = summarizeSendOutcome(run);
          const replyOutcome = summarizeReplyOutcome(run);
          const expanded = Boolean(expandedRuns[run.id]);

          return (
            <div key={run.id} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">Run {run.id.slice(-6)}</div>
                <Badge variant={runStatusVariant(run.status)}>{run.status}</Badge>
              </div>
              <div className="mt-1 text-[color:var(--muted-foreground)]">
                Leads {run.metrics.sourcedLeads} · Sent {run.metrics.sentMessages} · Replies {run.metrics.replies}
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                    Did emails send?
                  </div>
                  <div className={cn("mt-1 text-sm font-semibold", outcomeToneClass(sendOutcome.tone))}>
                    {sendOutcome.headline}
                  </div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">{sendOutcome.detail}</div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    Last send event: {lastSentEvent ? formatDateTime(lastSentEvent.createdAt) : "none yet"}
                  </div>
                </div>
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                    Did we get replies?
                  </div>
                  <div className={cn("mt-1 text-sm font-semibold", outcomeToneClass(replyOutcome.tone))}>
                    {replyOutcome.headline}
                  </div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">{replyOutcome.detail}</div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    Last reply event: {lastReplyEvent ? formatDateTime(lastReplyEvent.createdAt) : "none yet"}
                  </div>
                </div>
              </div>
              {run.lastError ? <div className="mt-1 text-[color:var(--danger)]">Reason: {run.lastError}</div> : null}
              {run.pauseReason ? <div className="mt-1 text-[color:var(--danger)]">Pause: {run.pauseReason}</div> : null}
              {runAnomalies.length ? (
                <div className="mt-1 text-[color:var(--danger)]">Active anomalies: {runAnomalies.map((item) => item.type).join(", ")}</div>
              ) : null}
              {lastDispatchFailure ? (
                <div className="mt-1 text-[color:var(--danger)]">
                  Last send failure: {summarizeEvent(lastDispatchFailure) || "Dispatch failed"} ·{" "}
                  {formatDateTime(lastDispatchFailure.createdAt)}
                </div>
              ) : null}
              {latestEvent ? (
                <div className="mt-1 text-[color:var(--muted-foreground)]">
                  Latest activity: {friendlyEventName(latestEvent.eventType)}
                  {summarizeEvent(latestEvent) ? ` · ${summarizeEvent(latestEvent)}` : ""}
                  {` · ${formatDateTime(latestEvent.createdAt)}`}
                </div>
              ) : null}
              {nextQueuedJob ? (
                <div className="mt-1 text-[color:var(--muted-foreground)]">
                  Next attempt: {friendlyJobType(nextQueuedJob.jobType)} at {formatDateTime(nextQueuedJob.executeAfter)}
                </div>
              ) : null}
              {mostRecentJobError && run.status !== "failed" ? (
                <div className="mt-1 text-[color:var(--danger)]">Last worker error: {mostRecentJobError.lastError}</div>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-2">
                {run.status === "paused" ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => void runAction(run, "resume")}>
                    <Play className="h-3.5 w-3.5" />
                    Resume
                  </Button>
                ) : RUN_PAUSABLE_STATUSES.includes(run.status) ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => void runAction(run, "pause")}>
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </Button>
                ) : null}

                {RUN_ACTIVE_STATUSES.includes(run.status) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      const confirmed = window.confirm(
                        `Cancel run ${run.id.slice(-6)}? This stops future sends for this run.`
                      );
                      if (!confirmed) return;
                      void runAction(run, "cancel");
                    }}
                  >
                    <Square className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                ) : null}

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setExpandedRuns((prev) => ({ ...prev, [run.id]: !prev[run.id] }))}
                >
                  {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {expanded ? "Hide details" : "Show details"}
                </Button>
              </div>

              {expanded ? (
                <div className="mt-3 grid gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                    Worker Activity (advanced)
                  </div>
                  {runJobs.length ? (
                    runJobs.slice(0, 8).map((job) => (
                      <div key={job.id} className="rounded border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>{friendlyJobType(job.jobType)}</div>
                          <Badge
                            variant={
                              job.status === "failed"
                                ? "danger"
                                : job.status === "completed"
                                  ? "success"
                                  : "muted"
                            }
                          >
                            {job.status}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                          Attempt {Math.max(1, job.attempts)}/{job.maxAttempts} · scheduled {formatDateTime(job.executeAfter)}
                        </div>
                        {job.lastError ? <div className="mt-1 text-xs text-[color:var(--danger)]">{job.lastError}</div> : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-2 text-xs text-[color:var(--muted-foreground)]">
                      No worker jobs recorded yet.
                    </div>
                  )}

                  <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                    Timeline
                  </div>
                  {runEvents.length ? (
                    runEvents.slice(0, 12).map((event) => (
                      <div key={event.id} className="rounded border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>{friendlyEventName(event.eventType)}</div>
                          <div className="text-xs text-[color:var(--muted-foreground)]">{formatDateTime(event.createdAt)}</div>
                        </div>
                        {summarizeEvent(event) ? (
                          <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{summarizeEvent(event)}</div>
                        ) : null}
                        {Object.keys(event.payload).length ? (
                          <details className="mt-1 text-[11px]">
                            <summary className="cursor-pointer text-[color:var(--muted-foreground)]">Payload</summary>
                            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded border border-[color:var(--border)] bg-[color:var(--surface)] p-2">
                              {JSON.stringify(event.payload, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-2 text-xs text-[color:var(--muted-foreground)]">
                      No run events yet.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}

        {!runs.length ? (
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 text-sm text-[color:var(--muted-foreground)]">
            No runs yet. Launch your first run from the controls above.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );

  const overviewPanel = (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Did Emails Send?</CardDescription>
            <CardTitle>{hasAnySent ? "Yes" : "No"}</CardTitle>
            <CardDescription>{hasAnySent ? `${totalSent} total sent` : "No send events yet"}</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Did We Get Replies?</CardDescription>
            <CardTitle>{hasAnyReplies ? "Yes" : "No"}</CardTitle>
            <CardDescription>{hasAnyReplies ? `${totalReplies} reply thread(s)` : "No replies yet"}</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Total Sent</CardDescription>
            <CardTitle>{totalSent}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Anomalies</CardDescription>
            <CardTitle>{runView.anomalies.filter((item) => item.status === "active").length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outbound Email Log</CardTitle>
          <CardDescription>
            Every outbound message attempt: who it went to, what was sent, and current delivery status.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
                <th className="pb-2">To</th>
                <th className="pb-2">Subject</th>
                <th className="pb-2">Message</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Sent / Scheduled</th>
                <th className="pb-2">Run</th>
              </tr>
            </thead>
            <tbody>
              {outboundMessages.map((message) => {
                const lead = leadById.get(message.leadId);
                return (
                  <tr key={message.id} className="border-t border-[color:var(--border)] align-top">
                    <td className="py-2">
                      <div>{lead?.email || "Unknown lead"}</div>
                      {lead?.name ? (
                        <div className="text-xs text-[color:var(--muted-foreground)]">{lead.name}</div>
                      ) : null}
                    </td>
                    <td className="py-2">{message.subject || "(No subject)"}</td>
                    <td className="py-2">
                      <details className="max-w-xl">
                        <summary className="cursor-pointer text-[color:var(--muted-foreground)]">
                          {previewText(message.body)}
                        </summary>
                        <div className="mt-2 whitespace-pre-wrap rounded border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-2 text-xs">
                          {message.body || "(No body)"}
                        </div>
                      </details>
                    </td>
                    <td className="py-2">
                      <Badge variant={messageStatusVariant(message.status)}>{message.status}</Badge>
                    </td>
                    <td className="py-2">
                      {formatDateTime(message.sentAt || message.scheduledAt || message.createdAt)}
                    </td>
                    <td className="py-2">{message.runId.slice(-6)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!outboundMessages.length ? (
            <div className="py-6 text-sm text-[color:var(--muted-foreground)]">
              No outbound messages yet.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reply Message Log</CardTitle>
          <CardDescription>What prospects actually said in inbound replies.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
                <th className="pb-2">From</th>
                <th className="pb-2">Subject</th>
                <th className="pb-2">Reply</th>
                <th className="pb-2">Received</th>
                <th className="pb-2">Run</th>
              </tr>
            </thead>
            <tbody>
              {inboundReplyMessages.map((message) => (
                <tr key={message.id} className="border-t border-[color:var(--border)] align-top">
                  <td className="py-2">{message.from || "-"}</td>
                  <td className="py-2">{message.subject || "(No subject)"}</td>
                  <td className="py-2">
                    <details className="max-w-xl">
                      <summary className="cursor-pointer text-[color:var(--muted-foreground)]">
                        {previewText(message.body)}
                      </summary>
                      <div className="mt-2 whitespace-pre-wrap rounded border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-2 text-xs">
                        {message.body || "(No body)"}
                      </div>
                    </details>
                  </td>
                  <td className="py-2">{formatDateTime(message.receivedAt)}</td>
                  <td className="py-2">{message.runId.slice(-6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!inboundReplyMessages.length ? (
            <div className="py-6 text-sm text-[color:var(--muted-foreground)]">
              No inbound replies yet.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );

  const variantsPanel = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Variants</CardTitle>
        <CardDescription>
          Launch and monitor by variant. Build changes happen in the Build workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {campaign.experiments.map((variant) => {
          const variantRuns = runs.filter((run) => run.experimentId === variant.id);
          const latestVariantRun = variantRuns[0] ?? null;

          return (
            <div key={variant.id} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">{variant.name || `Variant ${variant.id.slice(-4)}`}</div>
                <div className="flex items-center gap-2">
                  <Badge variant="muted">{variant.status}</Badge>
                  <Badge variant={runStatusVariant(latestVariantRun?.status ?? "queued")}> 
                    {latestVariantRun ? latestVariantRun.status : "idle"}
                  </Badge>
                </div>
              </div>
              <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                Daily {variant.runPolicy.dailyCap} · Hourly {variant.runPolicy.hourlyCap} · Spacing {variant.runPolicy.minSpacingMinutes}m · {variant.runPolicy.timezone}
              </div>
              {variant.notes ? <div className="mt-2 text-sm">{variant.notes}</div> : null}
              {latestVariantRun?.lastError ? (
                <div className="mt-1 text-xs text-[color:var(--danger)]">Reason: {latestVariantRun.lastError}</div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setSelectedVariantId(variant.id);
                    void launchForVariant(variant.id);
                  }}
                  disabled={launching}
                >
                  <Rocket className="h-3.5 w-3.5" />
                  {RUN_ACTIVE_STATUSES.includes(latestVariantRun?.status ?? "failed") ? "Restart" : "Launch"}
                </Button>
                <Button asChild type="button" size="sm" variant="outline">
                  <Link href={`/brands/${brandId}/campaigns/${campaignId}/build`}>Edit in Build</Link>
                </Button>
                <Button asChild type="button" size="sm" variant="outline">
                  <Link href={`/brands/${brandId}/campaigns/${campaignId}/build/flows/${variant.id}`}>
                    Conversation Map
                  </Link>
                </Button>
              </div>
            </div>
          );
        })}

        {!campaign.experiments.length ? (
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4 text-sm text-[color:var(--muted-foreground)]">
            No variants yet. Add one in Build before launching runs.
            <div className="mt-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/brands/${brandId}/campaigns/${campaignId}/build`}>Open Build</Link>
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );

  const leadsPanel = (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Leads</CardTitle>
        <CardDescription>Leads sourced from active and historical runs.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
              <th className="pb-2">Lead</th>
              <th className="pb-2">Company</th>
              <th className="pb-2">Email</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Run</th>
              <th className="pb-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {runView.leads.map((lead) => (
              <tr key={lead.id} className="border-t border-[color:var(--border)]">
                <td className="py-2">{lead.name || "-"}</td>
                <td className="py-2">{lead.company || "-"}</td>
                <td className="py-2">{lead.email}</td>
                <td className="py-2">
                  <Badge variant={lead.status === "replied" ? "success" : lead.status === "bounced" ? "danger" : "muted"}>
                    {lead.status}
                  </Badge>
                </td>
                <td className="py-2">{lead.runId.slice(-6)}</td>
                <td className="py-2">
                  {lead.sourceUrl ? (
                    <a className="underline" href={lead.sourceUrl} target="_blank" rel="noreferrer">
                      Source
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!runView.leads.length ? (
          <div className="py-6 text-sm text-[color:var(--muted-foreground)]">
            No leads yet. Launch a run from Overview or Variants.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );

  const inboxPanel = (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reply Draft Queue</CardTitle>
          <CardDescription>AI drafts require manual send approval.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {runView.drafts
            .filter((item) => item.status === "draft")
            .map((draft) => (
              <div key={draft.id} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{draft.subject}</div>
                  <Badge variant="muted">draft</Badge>
                </div>
                <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{draft.reason}</div>
                <div className="mt-2 whitespace-pre-wrap text-sm">{draft.body}</div>
                <div className="mt-3 flex justify-end">
                  <Button
                    size="sm"
                    type="button"
                    disabled={sendingDraftId === draft.id}
                    onClick={async () => {
                      setSendingDraftId(draft.id);
                      setError("");
                      try {
                        await approveReplyDraftAndSend(brandId, draft.id);
                        trackEvent("reply_draft_sent", { brandId, draftId: draft.id });
                        await refresh(false);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to send draft");
                      } finally {
                        setSendingDraftId("");
                      }
                    }}
                  >
                    {sendingDraftId === draft.id ? "Sending..." : "Approve & Send"}
                  </Button>
                </div>
              </div>
            ))}

          {!runView.drafts.filter((item) => item.status === "draft").length ? (
            <div className="text-sm text-[color:var(--muted-foreground)]">
              No pending drafts yet.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Threads</CardTitle>
          <CardDescription>Campaign threads linked to this campaign’s runs.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[color:var(--muted-foreground)]">
                <th className="pb-2">Subject</th>
                <th className="pb-2">Sentiment</th>
                <th className="pb-2">Intent</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Last Message</th>
              </tr>
            </thead>
            <tbody>
              {runView.threads.map((thread) => (
                <tr key={thread.id} className="border-t border-[color:var(--border)]">
                  <td className="py-2">{thread.subject}</td>
                  <td className="py-2">
                    <Badge
                      variant={
                        thread.sentiment === "positive"
                          ? "success"
                          : thread.sentiment === "negative"
                            ? "danger"
                            : "muted"
                      }
                    >
                      {thread.sentiment}
                    </Badge>
                  </td>
                  <td className="py-2">{thread.intent}</td>
                  <td className="py-2">{thread.status}</td>
                  <td className="py-2">{formatDateTime(thread.lastMessageAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {!runView.threads.length ? (
            <div className="py-6 text-sm text-[color:var(--muted-foreground)]">
              No replies yet.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );

  const insightsPanel = (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outcome Snapshot</CardTitle>
          <CardDescription>Capture what worked and what to change next.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Runs</div>
            <div className="text-lg font-semibold">{runs.length}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Sent</div>
            <div className="text-lg font-semibold">{totalSent}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Replies</div>
            <div className="text-lg font-semibold">{totalReplies}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--muted-foreground)]">Positive Rate</div>
            <div className="text-lg font-semibold">
              {totalReplies ? `${Math.round((totalPositiveReplies / totalReplies) * 100)}%` : "0%"}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Insights Notes</CardTitle>
            <CardDescription>Edit run insights and save snapshots.</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setInsightsDraft((prev) => [
                {
                  id: makeInsightId(),
                  title: "New insight",
                  summary: "",
                  status: "observing",
                },
                ...prev,
              ])
            }
          >
            <Plus className="h-4 w-4" />
            Add Insight
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3">
          {insightsDraft.map((row, index) => (
            <div key={row.id} className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor={`insight-title-${row.id}`}>Title</Label>
                  <Input
                    id={`insight-title-${row.id}`}
                    value={row.title}
                    onChange={(event) => {
                      const next = [...insightsDraft];
                      next[index] = { ...next[index], title: event.target.value };
                      setInsightsDraft(next);
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`insight-status-${row.id}`}>Status</Label>
                  <Select
                    id={`insight-status-${row.id}`}
                    value={row.status}
                    onChange={(event) => {
                      const status = ["observing", "winner", "killed"].includes(event.target.value)
                        ? (event.target.value as EvolutionSnapshot["status"])
                        : "observing";
                      const next = [...insightsDraft];
                      next[index] = { ...next[index], status };
                      setInsightsDraft(next);
                    }}
                  >
                    <option value="observing">observing</option>
                    <option value="winner">winner</option>
                    <option value="killed">killed</option>
                  </Select>
                </div>
                <div className="grid gap-2 md:col-span-2">
                  <Label htmlFor={`insight-summary-${row.id}`}>Summary</Label>
                  <Textarea
                    id={`insight-summary-${row.id}`}
                    value={row.summary}
                    onChange={(event) => {
                      const next = [...insightsDraft];
                      next[index] = { ...next[index], summary: event.target.value };
                      setInsightsDraft(next);
                    }}
                  />
                </div>
              </div>
            </div>
          ))}

          {!insightsDraft.length ? (
            <div className="text-sm text-[color:var(--muted-foreground)]">
              No insight snapshots yet. Add one after you have run data.
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button type="button" onClick={saveInsights} disabled={savingInsights}>
              <Save className="h-4 w-4" />
              {savingInsights ? "Saving..." : "Save Insights"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="space-y-5">
      {header}
      {tabs}
      {controls}

      {tab === "overview" ? overviewPanel : null}
      {tab === "variants" ? variantsPanel : null}
      {tab === "leads" ? leadsPanel : null}
      {tab === "inbox" ? inboxPanel : null}
      {tab === "insights" ? insightsPanel : null}

      {visibility}

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
    </div>
  );
}
