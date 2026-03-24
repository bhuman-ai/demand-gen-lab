"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Lock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Sparkles,
} from "lucide-react";
import {
  controlExperimentRunApi,
  draftExperimentFromPromptApi,
  fetchBrand,
  fetchBrandOutreachAssignment,
  fetchConversationPreviewLeadsApi,
  fetchExperiment,
  fetchExperimentSendableLeadSummaryApi,
  fetchExperimentRunView,
  launchExperimentTestApi,
  promoteExperimentApi,
  resolveApprovedExperimentProspectsApi,
  sourceExperimentSampleLeadsApi,
  updateExperimentApi,
} from "@/lib/client-api";
import type {
  BrandOutreachAssignment,
  BrandRecord,
  ExperimentRecord,
  OutreachAccount,
  OutreachRun,
  RunViewModel,
} from "@/lib/factory-types";
import {
  clampExperimentSampleSize,
  EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS,
} from "@/lib/experiment-policy";
import {
  getOutreachAccountFromEmail,
  getOutreachAccountReplyToEmail,
  getOutreachSenderBackingIssue,
} from "@/lib/outreach-account-helpers";
import { trackEvent } from "@/lib/telemetry-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import LiveProspectTableEmbed from "@/components/experiments/live-prospect-table-embed";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const FlowEditorClient = dynamic(
  () => import("@/app/brands/[id]/campaigns/[campaignId]/build/flows/[variantId]/flow-editor-client"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-6 text-sm text-[color:var(--muted-foreground)]">
        Loading flow editor...
      </div>
    ),
  }
);

const PROSPECT_VALIDATION_TARGET = EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS;
const PROSPECT_VALIDATION_MIN_READY = PROSPECT_VALIDATION_TARGET;
const STAGE_COUNT = 4;
const AUTO_SOURCE_POLL_INTERVAL_MS = 2000;
const AUTO_SOURCE_RETRY_DELAY_MS = 1500;
const ADDITIONAL_LEADS_MIN = 1;
const ADDITIONAL_LEADS_MAX = 400;
const BUSINESS_DAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

type StageIndex = 0 | 1 | 2 | 3;
type WorkflowStageStatus = "done" | "current" | "waiting" | "locked" | "active";
type ProspectInputMode = "need_data" | "have_data";
type ExperimentView = "setup" | "prospects" | "messaging" | "launch" | "run";
type AutoSourceMode = "gate" | "expand";
type RunNextAction = {
  tone: "warning" | "success";
  title: string;
  detail: string;
  primaryLabel: string;
  primaryHref: string;
  primaryStage?: StageIndex;
  secondaryLabel?: string;
  secondaryHref?: string;
  secondaryStage?: StageIndex;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseAdditionalLeadsInput(value: string) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return null;
  if (parsed < ADDITIONAL_LEADS_MIN) return null;
  return Math.max(ADDITIONAL_LEADS_MIN, Math.min(ADDITIONAL_LEADS_MAX, parsed));
}

function formatBusinessDays(days: number[] | undefined) {
  const normalized = Array.from(new Set((days ?? [1, 2, 3, 4, 5]).filter((day) => day >= 0 && day <= 6))).sort(
    (a, b) => a - b
  );
  if (!normalized.length) return "Mon-Fri";
  if (normalized.length === 7) return "Every day";
  const labels = normalized.map((day) => BUSINESS_DAY_OPTIONS.find((item) => item.value === day)?.label ?? String(day));
  return labels.join(", ");
}

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

function canCancel(status: OutreachRun["status"]) {
  return ["queued", "sourcing", "scheduled", "sending", "monitoring", "paused"].includes(status);
}

function isRunTerminal(status: OutreachRun["status"]) {
  return ["completed", "failed", "preflight_failed", "canceled", "paused"].includes(status);
}

function formatDate(value: string) {
  if (!value) return "n/a";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatHourLabel(hour: number) {
  const safeHour = Math.max(0, Math.min(23, Math.floor(hour)));
  const suffix = safeHour >= 12 ? "PM" : "AM";
  const normalized = safeHour % 12 || 12;
  return `${normalized}:00 ${suffix}`;
}

function formatUsd(value: number, opts?: { minFractionDigits?: number; maxFractionDigits?: number }) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts?.minFractionDigits ?? 2,
    maximumFractionDigits: opts?.maxFractionDigits ?? 2,
  }).format(value);
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stageTitle(index: StageIndex) {
  if (index === 0) return "Set it up";
  if (index === 1) return "Get leads";
  if (index === 2) return "Write emails";
  return "Start sending";
}

function stageName(index: StageIndex) {
  if (index === 0) return "Set it up";
  if (index === 1) return "Get leads";
  if (index === 2) return "Write emails";
  return "Start sending";
}

function stageSummary(index: StageIndex) {
  if (index === 0) return "Name the test and say who it is for.";
  if (index === 1) return "Find the first 20 leads for this experiment.";
  if (index === 2) return "Write the emails people will get.";
  return "Turn it on and watch what happens.";
}

function stagePath(brandId: string, experimentId: string, stage: StageIndex) {
  if (stage === 0) return `/brands/${brandId}/experiments/${experimentId}/setup`;
  if (stage === 1) return `/brands/${brandId}/experiments/${experimentId}/prospects`;
  if (stage === 2) return `/brands/${brandId}/experiments/${experimentId}/messaging`;
  return `/brands/${brandId}/experiments/${experimentId}/launch`;
}

function asStageIndex(value: number): StageIndex {
  return Math.max(0, Math.min(3, value)) as StageIndex;
}

function stageBadgeVariant(status: WorkflowStageStatus) {
  if (status === "done") return "success" as const;
  if (status === "current" || status === "active") return "accent" as const;
  return "muted" as const;
}

function stageBadgeLabel(status: WorkflowStageStatus) {
  if (status === "done") return "done";
  if (status === "current") return "now";
  if (status === "active") return "running";
  if (status === "locked") return "locked";
  return "next";
}

type SendableLeadResolutionState = {
  status: "idle" | "resolving" | "ready" | "attention" | "blocked" | "error";
  message: string;
  lastUpdatedAt: string;
  readyCount: number;
  retryable: boolean;
  queryExhausted: boolean;
  dedupedCount: number;
};

function emptySendableLeadResolutionState(): SendableLeadResolutionState {
  return {
    status: "idle",
    message: "",
    lastUpdatedAt: "",
    readyCount: 0,
    retryable: false,
    queryExhausted: false,
    dedupedCount: 0,
  };
}

type ResolveApprovedProspectsResult = Awaited<
  ReturnType<typeof resolveApprovedExperimentProspectsApi>
>;

function hasQuotaLikeTopUpMessage(message: string) {
  const normalized = String(message).toLowerCase();
  return (
    normalized.includes("credit") ||
    normalized.includes("quota") ||
    normalized.includes("free trial") ||
    normalized.includes("upgrade to resume automatic runs") ||
    normalized.includes("this managed workspace") ||
    normalized.includes("not enough credits remain")
  );
}

function summarizeSendableLeadResolution(
  result: ResolveApprovedProspectsResult
): SendableLeadResolutionState {
  const topFailure = String(result.failureSummary[0]?.reason ?? "").trim().toLowerCase();
  const now = new Date().toISOString();
  const ignoreQuotaLikeTopUpError = hasQuotaLikeTopUpMessage(result.liveTopUpError);
  const allowRetryAfterExhausted = Boolean(result.hostManagedWorkspace);

  if (result.ready) {
    return {
      status: "ready",
      message: `${result.sendableLeadCount} sendable contacts are ready.`,
      lastUpdatedAt: now,
      readyCount: result.sendableLeadCount,
      retryable: false,
      queryExhausted: false,
      dedupedCount: result.dedupedCount,
    };
  }

  if (
    result.enrichmentError.toLowerCase().includes("validatedmails api key is required") ||
    topFailure === "missing_validatedmails_api_key"
  ) {
    return {
      status: "blocked",
      message: "Work email verification is not configured yet. Add the ValidatedMails API key to keep preparing sendable contacts.",
      lastUpdatedAt: now,
      readyCount: result.sendableLeadCount,
      retryable: false,
      queryExhausted: false,
      dedupedCount: result.dedupedCount,
    };
  }

  if (
    result.enrichmentError.toLowerCase().includes("rejected the api key") ||
    topFailure === "validatedmails_unauthorized"
  ) {
    return {
      status: "blocked",
      message: "The work email verification key was rejected. Fix the verifier credential before launching.",
      lastUpdatedAt: now,
      readyCount: result.sendableLeadCount,
      retryable: false,
      queryExhausted: false,
      dedupedCount: result.dedupedCount,
    };
  }

  if (result.importedCount > 0) {
    return {
      status: "resolving",
      message: `Found ${result.importedCount} more work email${result.importedCount === 1 ? "" : "s"}: ${result.sendableLeadCount}/${result.targetCount} ready.`,
      lastUpdatedAt: now,
      readyCount: result.sendableLeadCount,
      retryable: true,
      queryExhausted: false,
      dedupedCount: result.dedupedCount,
    };
  }

  if (result.liveTopUpError && !ignoreQuotaLikeTopUpError) {
    return {
      status: "attention",
      message: `We checked the current prospects, but fetching more matches hit a problem: ${result.liveTopUpError}`,
      lastUpdatedAt: now,
      readyCount: result.sendableLeadCount,
      retryable: false,
      queryExhausted: false,
      dedupedCount: result.dedupedCount,
    };
  }

  if (result.liveTopUpAttempted && result.liveTopUpRowsAppended > 0) {
    return {
      status: "resolving",
      message: `Found ${result.liveTopUpRowsAppended} more prospect${result.liveTopUpRowsAppended === 1 ? "" : "s"} and kept checking emails: ${result.sendableLeadCount}/${result.targetCount} ready.`,
      lastUpdatedAt: now,
      readyCount: result.sendableLeadCount,
      retryable: true,
      queryExhausted: false,
      dedupedCount: result.dedupedCount,
    };
  }

  if (result.queryExhausted) {
    return {
      status: allowRetryAfterExhausted ? "resolving" : "attention",
      message: allowRetryAfterExhausted
        ? `Still searching for more sendable contacts: ${result.sendableLeadCount}/${result.targetCount} ready.`
        : `We checked the current approved prospects and searched for more, but this targeting only produced ${result.sendableLeadCount}/${result.targetCount} sendable contacts. Edit targeting to continue.`,
      lastUpdatedAt: now,
      readyCount: result.sendableLeadCount,
      retryable: allowRetryAfterExhausted,
      queryExhausted: !allowRetryAfterExhausted,
      dedupedCount: result.dedupedCount,
    };
  }

  if (result.sendableLeadCount > 0) {
    return {
      status: "resolving",
      message: `Still checking work emails in the background: ${result.sendableLeadCount}/${result.targetCount} ready.`,
      lastUpdatedAt: now,
      readyCount: result.sendableLeadCount,
      retryable: true,
      queryExhausted: false,
      dedupedCount: result.dedupedCount,
    };
  }

  if (topFailure === "no_mail_route") {
    return {
      status: "attention",
      message: "These prospects do not expose a usable company mail route yet. Refine the targeting or keep finding more companies.",
      lastUpdatedAt: now,
      readyCount: result.sendableLeadCount,
      retryable: false,
      queryExhausted: false,
      dedupedCount: result.dedupedCount,
    };
  }

  if (
    topFailure === "no_high_confidence_candidate" ||
    topFailure === "only_risky_candidates" ||
    topFailure === "all_candidates_invalid"
  ) {
    return {
      status: "attention",
      message: "Most saved prospects still do not resolve to a usable work email. Refine the targeting or keep sourcing more companies.",
      lastUpdatedAt: now,
      readyCount: result.sendableLeadCount,
      retryable: false,
      queryExhausted: false,
      dedupedCount: result.dedupedCount,
    };
  }

  return {
    status: "resolving",
    message: "Still checking company domains and work emails in the background.",
    lastUpdatedAt: now,
    readyCount: result.sendableLeadCount,
    retryable: true,
    queryExhausted: false,
    dedupedCount: result.dedupedCount,
  };
}

export default function ExperimentClient({
  brandId,
  experimentId,
  view,
}: {
  brandId: string;
  experimentId: string;
  view?: ExperimentView;
}) {
  type RefreshSnapshot = {
    brand: BrandRecord | null;
    experiment: ExperimentRecord;
    runView: RunViewModel;
    sourcedLeadCount: number;
    sourcedLeadWithEmailCount: number;
    sendableLeadCount: number;
    previewLeadCount: number;
    runsChecked: number;
    sourceExperimentId: string;
  };

  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [experiment, setExperiment] = useState<ExperimentRecord | null>(null);
  const [runView, setRunView] = useState<RunViewModel | null>(null);
  const [outreachAssignment, setOutreachAssignment] = useState<BrandOutreachAssignment | null>(null);
  const [deliveryAccount, setDeliveryAccount] = useState<OutreachAccount | null>(null);
  const [replyMailboxAccount, setReplyMailboxAccount] = useState<OutreachAccount | null>(null);
  const [sampleLeads, setSampleLeads] = useState<
    Awaited<ReturnType<typeof fetchConversationPreviewLeadsApi>>["leads"]
  >([]);
  const [, setSampleLeadRunsChecked] = useState(0);
  const [, setSampleLeadSourceExperimentId] = useState("");
  const [sourcedLeadWithEmailCount, setSourcedLeadWithEmailCount] = useState(0);
  const [sendableLeadCountSnapshot, setSendableLeadCountSnapshot] = useState(0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState("");
  const [prospectTableRowCount, setProspectTableRowCount] = useState(0);
  const [prospectTablePrompt, setProspectTablePrompt] = useState("");
  const [currentStage, setCurrentStage] = useState<StageIndex>(
    view === "prospects" ? 1 : view === "messaging" ? 2 : view === "launch" ? 3 : 0
  );
  const [, setSamplingStatus] = useState("");
  const [, setSamplingSummary] = useState("");
  const [, setSamplingAttempt] = useState(0);
  const [, setSamplingRunsLaunched] = useState(0);
  const [, setSamplingActiveRunId] = useState("");
  const [, setSamplingHeartbeatAt] = useState("");
  const [prospectInputMode, setProspectInputMode] = useState<ProspectInputMode>("have_data");
  const [aiSetupPrompt, setAiSetupPrompt] = useState("");
  const [draftingSetupFromAi, setDraftingSetupFromAi] = useState(false);
  const [aiSetupNotice, setAiSetupNotice] = useState("");
  const [prospectReviewApproved, setProspectReviewApproved] = useState(false);
  const [sendableLeadResolution, setSendableLeadResolution] = useState<SendableLeadResolutionState>(
    emptySendableLeadResolutionState
  );
  const [sendableLeadResolutionTick, setSendableLeadResolutionTick] = useState(0);
  const [launchQueued, setLaunchQueued] = useState(false);
  const router = useRouter();
  const samplingAbortRef = useRef<AbortController | null>(null);
  const samplingStopRequestedRef = useRef(false);
  const samplingActiveRunIdRef = useRef("");
  const stageAutoInitializedRef = useRef(false);
  const sendableLeadResolutionInFlightRef = useRef(false);
  const routeStage: StageIndex | null =
    view === "setup" ? 0 : view === "prospects" ? 1 : view === "messaging" ? 2 : view === "launch" ? 3 : null;

  const refresh = async (showSpinner = true): Promise<RefreshSnapshot> => {
    if (showSpinner) setLoading(true);
    try {
      const [
        brandRow,
        experimentRow,
        runRow,
        outreachAssignmentRow,
        prospectTableResponse,
        sendableLeadSummary,
      ] = await Promise.all([
        fetchBrand(brandId),
        fetchExperiment(brandId, experimentId),
        fetchExperimentRunView(brandId, experimentId),
        fetchBrandOutreachAssignment(brandId).catch(() => ({
          assignment: null,
          account: null,
          mailboxAccount: null,
        })),
        fetch(`/api/brands/${brandId}/experiments/${experimentId}/prospect-table`, {
          cache: "no-store",
        }).catch(() => null),
        fetchExperimentSendableLeadSummaryApi(brandId, experimentId).catch(() => ({
          sendableLeadCount: 0,
          runsChecked: 0,
        })),
      ]);

      let previewLeadsData: Awaited<ReturnType<typeof fetchConversationPreviewLeadsApi>> = {
        leads: [],
        runsChecked: 0,
        runtimeRefFound: true,
        sourceExperimentId: "",
        qualifiedLeadCount: 0,
        qualifiedLeadWithEmailCount: 0,
        qualifiedLeadWithoutEmailCount: 0,
        previewEmailEnrichment: {
          attempted: 0,
          matched: 0,
          failed: 0,
          provider: "emailfinder.batch",
          error: "",
        },
      };

      if (experimentRow.runtime.campaignId && experimentRow.runtime.experimentId) {
        try {
          previewLeadsData = await fetchConversationPreviewLeadsApi(
            brandId,
            experimentRow.runtime.campaignId,
            experimentRow.runtime.experimentId,
            { limit: 20, maxRuns: 30 }
          );
        } catch {
          // Keep preview leads empty if the preview endpoint fails.
        }
      }

      setBrand(brandRow);
      setExperiment(experimentRow);
      setRunView(runRow);
      setOutreachAssignment(outreachAssignmentRow.assignment);
      setDeliveryAccount(outreachAssignmentRow.account);
      setReplyMailboxAccount(outreachAssignmentRow.mailboxAccount);
      setSampleLeads(previewLeadsData.leads);
      setSampleLeadRunsChecked(previewLeadsData.runsChecked);
      setSampleLeadSourceExperimentId(previewLeadsData.sourceExperimentId);
      setSourcedLeadWithEmailCount(previewLeadsData.qualifiedLeadWithEmailCount);
      setSendableLeadCountSnapshot(sendableLeadSummary.sendableLeadCount);
      if (prospectTableResponse?.ok) {
        try {
          const prospectTablePayload = (await prospectTableResponse.json()) as {
            rowCount?: number;
            discoveryPrompt?: string;
          };
          setProspectTableRowCount(Math.max(0, Number(prospectTablePayload.rowCount ?? 0) || 0));
          if (String(prospectTablePayload.discoveryPrompt || "").trim()) {
            setProspectTablePrompt(String(prospectTablePayload.discoveryPrompt || "").trim());
          }
        } catch {
          // Keep the existing local prospect snapshot if the persisted table payload is malformed.
        }
      }
      localStorage.setItem("factory.activeBrandId", brandId);

      const sourcedLeadCount = previewLeadsData.qualifiedLeadCount;

      return {
        brand: brandRow,
        experiment: experimentRow,
        runView: runRow,
        sourcedLeadCount,
        sourcedLeadWithEmailCount: previewLeadsData.qualifiedLeadWithEmailCount,
        sendableLeadCount: sendableLeadSummary.sendableLeadCount,
        previewLeadCount: previewLeadsData.leads.length,
        runsChecked: previewLeadsData.runsChecked,
        sourceExperimentId: previewLeadsData.sourceExperimentId,
      };
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
        setError(err instanceof Error ? err.message : "Failed to load experiment");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    trackEvent("experiment_viewed", { brandId, experimentId });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, experimentId]);

  useEffect(() => {
    if (routeStage === null) return;
    setCurrentStage(routeStage);
  }, [routeStage]);

  const latestRun = useMemo(() => runView?.runs?.[0] ?? null, [runView]);
  const latestEvents = useMemo(
    () => (latestRun ? runView?.eventsByRun?.[latestRun.id] ?? [] : []),
    [latestRun, runView]
  );
  const runTotals = useMemo(
    () =>
      (runView?.runs ?? []).reduce(
        (acc, run) => ({
          sourcedLeads: acc.sourcedLeads + Number(run.metrics.sourcedLeads ?? 0),
          scheduledMessages: acc.scheduledMessages + Number(run.metrics.scheduledMessages ?? 0),
          sentMessages: acc.sentMessages + Number(run.metrics.sentMessages ?? 0),
          replies: acc.replies + Number(run.metrics.replies ?? 0),
          positiveReplies: acc.positiveReplies + Number(run.metrics.positiveReplies ?? 0),
        }),
        {
          sourcedLeads: 0,
          scheduledMessages: 0,
          sentMessages: 0,
          replies: 0,
          positiveReplies: 0,
        }
      ),
    [runView]
  );
  const latestRunIsSourcingOnly = useMemo(
    () =>
      latestEvents.some((event) => {
        const payload = asRecord(event.payload);
        return payload.sampleOnly === true;
      }),
    [latestEvents]
  );
  const latestSendingRun = useMemo(
    () =>
      (runView?.runs ?? []).find(
        (run) =>
          Number(run.metrics.sentMessages ?? 0) > 0 ||
          Number(run.metrics.scheduledMessages ?? 0) > 0 ||
          ["scheduled", "sending", "monitoring", "paused"].includes(run.status)
      ) ?? null,
    [runView]
  );
  const primaryRun = latestSendingRun ?? latestRun;
  const nextScheduledAtAnyRun = useMemo(
    () =>
      (runView?.messages ?? [])
        .filter((message) => message.status === "scheduled" && message.scheduledAt)
        .map((message) => message.scheduledAt)
        .sort((a, b) => (a < b ? -1 : 1))[0] ?? "",
    [runView]
  );

  const setupReady = useMemo(
    () =>
      Boolean(
        experiment?.name.trim() &&
          experiment?.offer.trim() &&
          experiment?.audience.trim() &&
          experiment?.testEnvelope.timezone.trim()
      ),
    [experiment]
  );
  const setupChecklist = useMemo(
    () => [
      {
        key: "name",
        label: "Name",
        done: Boolean(experiment?.name.trim()),
      },
      {
        key: "audience",
        label: "Audience",
        done: Boolean(experiment?.audience.trim()),
      },
      {
        key: "offer",
        label: "Offer",
        done: Boolean(experiment?.offer.trim()),
      },
      {
        key: "timezone",
        label: "Timezone",
        done: Boolean(experiment?.testEnvelope.timezone.trim()),
      },
    ],
    [experiment]
  );
  const setupCompletionCount = useMemo(
    () => setupChecklist.filter((item) => item.done).length,
    [setupChecklist]
  );
  const setupCompletionPct = Math.max(
    8,
    Math.round((setupCompletionCount / Math.max(1, setupChecklist.length)) * 100)
  );

  const previewEmailLeadCount = useMemo(
    () => Math.max(sourcedLeadWithEmailCount, sampleLeads.filter((lead) => Boolean(lead.email?.trim())).length),
    [sampleLeads, sourcedLeadWithEmailCount]
  );
  const sourcingEconomics = useMemo(() => {
    const runs = runView?.runs ?? [];
    const eventsByRun = runView?.eventsByRun ?? {};
    let estimatedSourcingSpendUsd = 0;
    let exaQueryCount = 0;

    for (const run of runs) {
      const spend = Number(run.sourcingTraceSummary?.budgetUsedUsd ?? 0);
      if (Number.isFinite(spend) && spend > 0) {
        estimatedSourcingSpendUsd += spend;
      }

      const events = eventsByRun[run.id] ?? [];
      for (const event of events) {
        const payload = asRecord(event.payload);
        const costBreakdown = asRecord(payload.costBreakdown);
        const queryCount = Number(costBreakdown.exaQueryCount ?? 0);
        if (Number.isFinite(queryCount) && queryCount > 0) {
          exaQueryCount += queryCount;
          break;
        }
      }
    }

    return {
      estimatedSourcingSpendUsd,
      exaQueryCount,
      costPerSourcedLeadUsd:
        runTotals.sourcedLeads > 0 ? estimatedSourcingSpendUsd / Math.max(1, runTotals.sourcedLeads) : null,
      costPerVerifiedLeadUsd:
        previewEmailLeadCount > 0 ? estimatedSourcingSpendUsd / Math.max(1, previewEmailLeadCount) : null,
    };
  }, [previewEmailLeadCount, runTotals.sourcedLeads, runView]);

  const sendableLeadCount = Math.max(sendableLeadCountSnapshot, sendableLeadResolution.readyCount);
  const savedProspectCount = Math.max(prospectTableRowCount, sendableLeadCount);
  const savedProspectsReady = savedProspectCount >= PROSPECT_VALIDATION_MIN_READY;
  const sendableLeadsReady = sendableLeadCount >= PROSPECT_VALIDATION_MIN_READY;
  const prospectsReady = savedProspectsReady;
  const messagingReady = Number(experiment?.messageFlow.publishedRevision ?? 0) > 0;
  const setupComplete = setupReady;
  const prospectsUnlocked = setupComplete;
  const prospectsComplete = prospectsUnlocked && savedProspectsReady && prospectReviewApproved;
  const messagingUnlocked = prospectsComplete;
  const messagingComplete = messagingUnlocked && messagingReady;
  const launchStageUnlocked = messagingReady;
  const launchComplete = launchStageUnlocked && primaryRun?.status === "completed";
  const launchActive = launchStageUnlocked && Boolean(primaryRun && !isRunTerminal(primaryRun.status));
  const highestUnlockedStage = launchStageUnlocked ? 3 : messagingUnlocked ? 2 : prospectsUnlocked ? 1 : 0;
  const remainingProspectLeads = Math.max(0, PROSPECT_VALIDATION_TARGET - savedProspectCount);
  const prospectPrimaryMessage = !savedProspectsReady
    ? savedProspectCount > 0
      ? `${savedProspectCount} lead${savedProspectCount === 1 ? "" : "s"} found. AI is still building the first review batch before you can write emails.`
      : `AI is still collecting leads. You need ${remainingProspectLeads} more before you can write emails.`
    : !prospectReviewApproved
      ? `${savedProspectCount} leads are ready. Review them and click Looks good to move into messaging.`
      : sendableLeadsReady
        ? `${sendableLeadCount} sendable contacts are ready.`
        : sendableLeadResolution.message ||
          `Checking work emails in the background: ${sendableLeadCount}/${PROSPECT_VALIDATION_TARGET} sendable contacts ready.`;

  const workflowStages = useMemo(
    () =>
      [
        {
          index: 0 as StageIndex,
          label: stageName(0),
          disabled: false,
          status: setupComplete
            ? ("done" as WorkflowStageStatus)
            : currentStage === 0
              ? ("current" as WorkflowStageStatus)
              : ("waiting" as WorkflowStageStatus),
        },
        {
          index: 1 as StageIndex,
          label: stageName(1),
          disabled: !prospectsUnlocked,
          status: !prospectsUnlocked
            ? ("locked" as WorkflowStageStatus)
            : prospectsComplete
              ? ("done" as WorkflowStageStatus)
              : currentStage === 1
                ? ("current" as WorkflowStageStatus)
                : ("waiting" as WorkflowStageStatus),
        },
        {
          index: 2 as StageIndex,
          label: stageName(2),
          disabled: !messagingUnlocked,
          status: !messagingUnlocked
            ? ("locked" as WorkflowStageStatus)
            : messagingComplete
              ? ("done" as WorkflowStageStatus)
              : currentStage === 2
                ? ("current" as WorkflowStageStatus)
                : ("waiting" as WorkflowStageStatus),
        },
        {
          index: 3 as StageIndex,
          label: stageName(3),
          disabled: !launchStageUnlocked,
          status: !launchStageUnlocked
            ? ("locked" as WorkflowStageStatus)
            : launchComplete
              ? ("done" as WorkflowStageStatus)
              : launchActive
                ? ("active" as WorkflowStageStatus)
                : currentStage === 3
                  ? ("current" as WorkflowStageStatus)
                  : ("waiting" as WorkflowStageStatus),
        },
      ] satisfies Array<{
        index: StageIndex;
        label: string;
        disabled: boolean;
        status: WorkflowStageStatus;
      }>,
    [
      currentStage,
      launchActive,
      launchComplete,
      launchStageUnlocked,
      messagingComplete,
      messagingUnlocked,
      prospectsComplete,
      prospectsUnlocked,
      setupComplete,
    ]
  );

  const nextGateHint = useMemo(() => {
    if (!setupComplete) return "Finish step 1 first.";
    if (!savedProspectsReady) return `Find ${remainingProspectLeads} more leads to unlock Write emails.`;
    if (!prospectReviewApproved) return "Review the first 20 leads, then click Looks good to unlock Write emails.";
    if (!messagingReady) return "Publish your email flow to keep going.";
    if (!sendableLeadsReady) {
      if (
        sendableLeadResolution.queryExhausted &&
        experiment?.testEnvelope.oneContactPerCompany !== false &&
        sendableLeadResolution.dedupedCount > 0
      ) {
        return `This targeting topped out at ${sendableLeadCount}/${PROSPECT_VALIDATION_TARGET} sendable contacts with one contact per company turned on. Allow more than one contact per company or edit targeting to continue.`;
      }
      if (sendableLeadResolution.queryExhausted) {
        return `This targeting topped out at ${sendableLeadCount}/${PROSPECT_VALIDATION_TARGET} sendable contacts. Edit targeting to continue.`;
      }
      return launchQueued
        ? `Preparing launch in the background: ${sendableLeadCount}/${PROSPECT_VALIDATION_TARGET} sendable contacts ready.`
        : "Open Start sending. We’ll keep checking work emails in the background and launch once 20 contacts are ready.";
    }
    if (!launchComplete) return "Everything is ready. Start sending when you want.";
    return "Everything is done.";
  }, [
    launchComplete,
    experiment?.testEnvelope.oneContactPerCompany,
    launchQueued,
    messagingReady,
    prospectReviewApproved,
    remainingProspectLeads,
    savedProspectsReady,
    sendableLeadCount,
    sendableLeadResolution.dedupedCount,
    sendableLeadResolution.queryExhausted,
    sendableLeadsReady,
    setupComplete,
  ]);
  const prospectReviewStorageKey = useMemo(() => {
    const prompt = String(prospectTablePrompt || experiment?.audience || "").trim();
    if (!prompt) return "";
    const experimentKey = String(experiment?.id || "").trim();
    if (!experimentKey) return "";
    return `lastb2b:prospects-review:/api/brands/${brandId}/experiments/${experimentKey}/prospect-table:${prompt}`;
  }, [brandId, experiment?.audience, experiment?.id, prospectTablePrompt]);
  const launchQueueStorageKey = useMemo(() => {
    const experimentKey = String(experiment?.id || "").trim();
    if (!experimentKey) return "";
    return `lastb2b:launch-queued:${brandId}:${experimentKey}`;
  }, [brandId, experiment?.id]);

  const updateLaunchQueued = (next: boolean) => {
    setLaunchQueued(next);
    if (typeof window === "undefined" || !launchQueueStorageKey) return;
    if (next) {
      window.localStorage.setItem(launchQueueStorageKey, "queued");
    } else {
      window.localStorage.removeItem(launchQueueStorageKey);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!prospectReviewStorageKey) {
      setProspectReviewApproved(false);
      return;
    }
    setProspectReviewApproved(window.localStorage.getItem(prospectReviewStorageKey) === "approved");
  }, [prospectReviewStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!launchQueueStorageKey) {
      setLaunchQueued(false);
      return;
    }
    setLaunchQueued(window.localStorage.getItem(launchQueueStorageKey) === "queued");
  }, [launchQueueStorageKey]);

  useEffect(() => {
    if (!experiment || prospectTableRowCount > 0) {
      return;
    }

    let cancelled = false;

    const syncSavedProspectCount = async () => {
      try {
        const response = await fetch(
          `/api/brands/${brandId}/experiments/${experiment.id}/prospect-table`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          rowCount?: number;
          discoveryPrompt?: string;
        };
        if (cancelled) return;

        const nextRowCount = Math.max(0, Number(payload.rowCount ?? 0) || 0);
        const nextPrompt = String(payload.discoveryPrompt ?? "").trim();

        if (nextRowCount > 0) {
          setProspectTableRowCount((current) => Math.max(current, nextRowCount));
        }
        if (nextPrompt) {
          setProspectTablePrompt((current) => current || nextPrompt);
        }
      } catch {
        // Ignore polling failures; the main screen can keep the current snapshot.
      }
    };

    void syncSavedProspectCount();
    const intervalId = window.setInterval(() => {
      void syncSavedProspectCount();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [brandId, experiment, prospectTableRowCount]);

  // refresh is intentionally omitted here because the effect is keyed off the persisted-stage inputs above.
  // Re-running on every refresh function identity change would restart the background resolver loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (
      !experiment ||
      !prospectReviewApproved ||
      savedProspectCount <= 0 ||
      sendableLeadsReady ||
      sendableLeadResolutionInFlightRef.current
    ) {
      return;
    }

    let cancelled = false;
    let retryTimeout: number | null = null;
    let shouldRetry = true;
    sendableLeadResolutionInFlightRef.current = true;
    setSendableLeadResolution((current) => ({
      ...current,
      status: "resolving",
      message:
        current.message ||
        `Checking work emails in the background: ${sendableLeadCount}/${PROSPECT_VALIDATION_TARGET} ready.`,
      lastUpdatedAt: current.lastUpdatedAt,
      readyCount: current.readyCount,
      retryable: true,
    }));

    void resolveApprovedExperimentProspectsApi(brandId, experiment.id)
      .then(async (result) => {
        if (cancelled) return;

        const nextState = summarizeSendableLeadResolution(result);
        shouldRetry = nextState.retryable;
        setSendableLeadResolution(nextState);

        await refresh(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        shouldRetry = false;
        setSendableLeadResolution({
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : "Background email resolution hit a problem.",
          lastUpdatedAt: new Date().toISOString(),
          readyCount: sendableLeadCount,
          retryable: false,
          queryExhausted: false,
          dedupedCount: 0,
        });
      })
      .finally(() => {
        sendableLeadResolutionInFlightRef.current = false;
        if (!cancelled && !sendableLeadsReady && shouldRetry) {
          retryTimeout = window.setTimeout(() => {
            setSendableLeadResolutionTick((tick) => tick + 1);
          }, 4000);
        }
      });

    return () => {
      cancelled = true;
      if (retryTimeout !== null) {
        window.clearTimeout(retryTimeout);
      }
    };
  }, [
    brandId,
    experiment,
    prospectReviewApproved,
    savedProspectCount,
    sendableLeadCount,
    sendableLeadsReady,
    sendableLeadResolutionTick,
  ]);

  useEffect(() => {
    if (!sendableLeadsReady) return;
    setSendableLeadResolution({
      status: "ready",
      message: `${sendableLeadCount} sendable contacts are ready.`,
      lastUpdatedAt: new Date().toISOString(),
      readyCount: sendableLeadCount,
      retryable: false,
      queryExhausted: false,
      dedupedCount: 0,
    });
  }, [sendableLeadCount, sendableLeadsReady]);

  useEffect(() => {
    if (!launchQueued || sendableLeadsReady) return;
    if (
      sendableLeadResolution.status === "attention" ||
      sendableLeadResolution.status === "blocked" ||
      sendableLeadResolution.status === "error"
    ) {
      updateLaunchQueued(false);
    }
  }, [launchQueued, sendableLeadResolution.status, sendableLeadsReady]);

  useEffect(() => {
    if (routeStage !== null) return;
    const nextStage = asStageIndex(Math.min(currentStage, highestUnlockedStage));
    if (nextStage !== currentStage) setCurrentStage(nextStage);
  }, [currentStage, highestUnlockedStage, routeStage]);

  const canGoNext = useMemo(() => {
    if (currentStage === 0) return setupComplete;
    if (currentStage === 1) return prospectsComplete;
    if (currentStage === 2) return messagingComplete;
    return false;
  }, [currentStage, messagingComplete, prospectsComplete, setupComplete]);

  const goNext = () =>
    setCurrentStage((prev) => asStageIndex(Math.min(highestUnlockedStage, prev + 1)));
  const goPrev = () => setCurrentStage((prev) => asStageIndex(prev - 1));
  const navigateToStage = (stage: StageIndex) => {
    router.push(stagePath(brandId, experimentId, stage));
  };
  const approveProspectsAndContinue = () => {
    if (typeof window !== "undefined" && prospectReviewStorageKey) {
      window.localStorage.setItem(prospectReviewStorageKey, "approved");
    }
    setProspectReviewApproved(true);
    setSendableLeadResolution((current) => ({
      ...current,
      status: current.status === "idle" ? "resolving" : current.status,
      message:
        current.message ||
        `Checking work emails in the background: ${sendableLeadCount}/${PROSPECT_VALIDATION_TARGET} ready.`,
      lastUpdatedAt: current.lastUpdatedAt,
      readyCount: Math.max(current.readyCount, sendableLeadCount),
      retryable: current.status === "ready" ? false : true,
    }));
    navigateToStage(2);
  };
  const openStage = (stage: StageIndex) => {
    if (routeStage !== null) {
      navigateToStage(stage);
      return;
    }
    setCurrentStage(stage);
  };
  const oneContactPerCompanyEnabled = experiment?.testEnvelope.oneContactPerCompany !== false;
  const canRelaxCompanyDedupe =
    sendableLeadResolution.queryExhausted &&
    oneContactPerCompanyEnabled &&
    sendableLeadResolution.dedupedCount > 0;
  const relaxCompanyDedupe = async () => {
    if (!experiment) return;
    const updated = await updateExperimentApi(brandId, experiment.id, {
      testEnvelope: {
        ...experiment.testEnvelope,
        oneContactPerCompany: false,
      },
    });
    setExperiment(updated);
    setSendableLeadResolution((current) => ({
      ...current,
      status: "resolving",
      message: "Allowing more than one contact per company and checking emails again.",
      retryable: true,
      queryExhausted: false,
      lastUpdatedAt: new Date().toISOString(),
    }));
    setSendableLeadResolutionTick((tick) => tick + 1);
  };

  const launchFromEmail = getOutreachAccountFromEmail(deliveryAccount).trim();
  const launchReplyToEmail = String(
    replyMailboxAccount?.config.mailbox.email || getOutreachAccountReplyToEmail(deliveryAccount) || ""
  ).trim();
  const launchIdentityIssues = [
    !outreachAssignment?.accountId ? "delivery account not assigned" : "",
    !launchFromEmail ? "from email missing" : "",
    !launchReplyToEmail ? "reply-to mailbox missing" : "",
    getOutreachSenderBackingIssue(deliveryAccount, replyMailboxAccount),
  ].filter(Boolean);
  const launchIdentityReady = launchIdentityIssues.length === 0;
  const launchPreparing = !sendableLeadsReady;
  const launchBlocked = launching || !launchIdentityReady;
  const launchActionLabel = launching
    ? "Launching..."
    : launchPreparing
      ? launchQueued
        ? `Preparing ${sendableLeadCount}/${PROSPECT_VALIDATION_TARGET}`
        : sendableLeadResolution.status === "blocked"
          ? "Need email verifier"
        : sendableLeadResolution.status === "attention"
            ? canRelaxCompanyDedupe
              ? "Allow more per company"
              : sendableLeadResolution.queryExhausted
                ? "Need more matching contacts"
                : "Need better emails"
            : "Launch when ready"
      : !launchIdentityReady
        ? "Finish sending setup"
        : "Start sending";
  // launchExperimentNow is intentionally omitted here so the queued-launch effect only keys off readiness state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!launchQueued || launching || !launchIdentityReady || !sendableLeadsReady) {
      return;
    }

    void launchExperimentNow();
  }, [launchIdentityReady, launchQueued, launching, sendableLeadsReady]);
  const businessHoursEnabled = experiment?.testEnvelope.businessHoursEnabled !== false;
  const businessHoursStartHour = Math.max(
    0,
    Math.min(23, Number(experiment?.testEnvelope.businessHoursStartHour ?? 9) || 9)
  );
  const businessHoursEndHour = Math.max(
    1,
    Math.min(24, Number(experiment?.testEnvelope.businessHoursEndHour ?? 17) || 17)
  );
  const businessDaysLabel = formatBusinessDays(experiment?.testEnvelope.businessDays);
  const businessHoursLabel = businessHoursEnabled
    ? `${businessDaysLabel} ${formatHourLabel(businessHoursStartHour)}-${formatHourLabel(
        businessHoursEndHour === 24 ? 23 : businessHoursEndHour
      )} ${experiment?.testEnvelope.timezone || "local time"}`
    : "all day";
  const primaryRunScheduledMessages = Number(primaryRun?.metrics.scheduledMessages ?? 0);
  const primaryRunSentMessages = Number(primaryRun?.metrics.sentMessages ?? 0);
  const primaryRunReplies = Number(primaryRun?.metrics.replies ?? 0);
  const runWaitingForSendWindow =
    Boolean(primaryRun) &&
    primaryRunScheduledMessages > 0 &&
    primaryRunSentMessages === 0 &&
    ["scheduled", "sending", "monitoring", "paused"].includes(primaryRun?.status ?? "");
  const latestRunNarrative = (() => {
    if (!primaryRun) {
      return {
        headline: "No launch yet.",
        detail: "Complete Prospects + Messaging, then click Launch Test.",
      };
    }
    const sourced = Number(primaryRun.metrics.sourcedLeads ?? 0);
    const sent = primaryRunSentMessages;
    const replies = primaryRunReplies;

    if (["failed", "preflight_failed", "canceled"].includes(primaryRun.status)) {
      return {
        headline: "Run did not complete successfully.",
        detail: primaryRun.lastError || "Check timeline events for root cause.",
      };
    }
    if (runWaitingForSendWindow) {
      return {
        headline: "Messages are queued.",
        detail: nextScheduledAtAnyRun
          ? `${primaryRunScheduledMessages} messages are queued. First send window opens ${formatDate(nextScheduledAtAnyRun)}.`
          : `${primaryRunScheduledMessages} messages are queued. Waiting for the next send window (${businessHoursLabel}).`,
      };
    }
    if (primaryRun.status === "completed" && sourced > 0 && sent === 0) {
      return {
        headline: "Sourcing completed, but no emails were sent in this run.",
        detail: !messagingReady
          ? `Accepted leads: ${sourced}. Publish the messaging flow before this experiment can send.`
          : !launchIdentityReady
            ? `Accepted leads: ${sourced}. Finish launch setup: ${launchIdentityIssues.join(", ")}.`
            : `Accepted leads: ${sourced}. Launch Experiment to start sending.`,
      };
    }
    if (primaryRun.status === "completed" && sent > 0 && replies === 0) {
      return {
        headline: "Emails were sent; no replies yet.",
        detail: `Sent ${sent} messages to ${sourced} sourced leads.`,
      };
    }
    if (primaryRun.status === "completed" && sent > 0 && replies > 0) {
      return {
        headline: "Run completed with outbound and replies.",
        detail: `Sent ${sent}, replies ${replies}.`,
      };
    }
    if (["queued", "sourcing", "scheduled", "sending", "monitoring"].includes(primaryRun.status)) {
      return {
        headline: "Run is in progress.",
        detail:
          sent > 0
            ? `${sent} emails already sent.`
            : `Current step: ${primaryRun.sourcingTraceSummary?.phase || "processing"}.`,
      };
    }
    return {
      headline: "Run status updated.",
      detail: `Status: ${primaryRun.status}.`,
    };
  })();
  const showSendableLeadProgress = prospectReviewApproved && !sendableLeadsReady;
  const sendableLeadProgressPercent = Math.max(
    8,
    Math.min(100, Math.round((sendableLeadCount / Math.max(1, PROSPECT_VALIDATION_TARGET)) * 100))
  );
  const sendableLeadProgressLabel = launchQueued
    ? `We’ll launch automatically when ${PROSPECT_VALIDATION_TARGET} contacts are ready.`
    : sendableLeadResolution.message ||
      `Checking work emails in the background: ${sendableLeadCount}/${PROSPECT_VALIDATION_TARGET} ready.`;
  const sendableLeadProgressPanel = showSendableLeadProgress ? (
    <div
      className={`rounded-[14px] border px-4 py-3 ${
        sendableLeadResolution.status === "blocked" || sendableLeadResolution.status === "error"
          ? "border-[color:var(--danger)]/40 bg-[color:var(--danger-soft)]"
          : sendableLeadResolution.status === "attention"
            ? "border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)]"
            : "border-[color:var(--border)] bg-[color:var(--surface-muted)]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-[color:var(--foreground)]">
          {sendableLeadResolution.status === "blocked"
            ? "Email verification is blocked"
            : sendableLeadResolution.status === "attention"
              ? "Email verification needs attention"
              : "Preparing sendable contacts"}
        </div>
        <Badge
          variant={
            sendableLeadResolution.status === "blocked" || sendableLeadResolution.status === "error"
              ? "danger"
              : sendableLeadResolution.status === "attention"
                ? "accent"
                : "accent"
          }
        >
          {sendableLeadCount}/{PROSPECT_VALIDATION_TARGET} ready
        </Badge>
      </div>
      {sendableLeadResolution.status === "resolving" || sendableLeadResolution.status === "ready" ? (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[color:var(--surface)]">
          <div
            className="h-full rounded-full bg-[color:var(--accent)] transition-[width] duration-300"
            style={{ width: `${sendableLeadProgressPercent}%` }}
          />
        </div>
      ) : null}
      <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">{sendableLeadProgressLabel}</div>
      {canRelaxCompanyDedupe ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void relaxCompanyDedupe()}>
            Allow more than one contact per company
          </Button>
          <div className="text-xs text-[color:var(--muted-foreground)]">
            Some additional matches were skipped because only one contact per company is allowed right now.
          </div>
        </div>
      ) : null}
      {sendableLeadResolution.queryExhausted && !canRelaxCompanyDedupe ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => openStage(1)}>
            Edit targeting
          </Button>
          <div className="text-xs text-[color:var(--muted-foreground)]">
            This search has topped out for the current audience and offer.
          </div>
        </div>
      ) : null}
    </div>
  ) : null;

  const saveSetup = async () => {
    if (!experiment) return null;
    setSaving(true);
    setError("");
    try {
      const saved = await updateExperimentApi(brandId, experiment.id, {
        name: experiment.name,
        offer: experiment.offer,
        audience: experiment.audience,
        testEnvelope: experiment.testEnvelope,
        successMetric: experiment.successMetric,
      });
      setExperiment(saved);
      trackEvent("experiment_saved", { brandId, experimentId: experiment.id });
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save setup");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const fillSetupFromPrompt = async () => {
    if (!experiment || !aiSetupPrompt.trim()) return;
    setDraftingSetupFromAi(true);
    setError("");
    setAiSetupNotice("");
    try {
      const draft = await draftExperimentFromPromptApi(brandId, {
        prompt: aiSetupPrompt.trim(),
        current: {
          name: experiment.name,
          audience: experiment.audience,
          offer: experiment.offer,
        },
      });
      setExperiment((prev) =>
        prev
          ? {
              ...prev,
              name: draft.name || prev.name,
              audience: draft.audience || prev.audience,
              offer: draft.offer || prev.offer,
            }
          : prev
      );
      setAiSetupNotice("AI filled the setup below. Edit anything you want, then save.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to write setup from prompt");
    } finally {
      setDraftingSetupFromAi(false);
    }
  };
  const launchExperimentNow = async () => {
    if (!experiment) {
      return;
    }
    setLaunching(true);
    setError("");
    try {
      await updateExperimentApi(brandId, experiment.id, {
        name: experiment.name,
        offer: experiment.offer,
        audience: experiment.audience,
        testEnvelope: experiment.testEnvelope,
        successMetric: experiment.successMetric,
      });
      const result = await launchExperimentTestApi(brandId, experiment.id);
      trackEvent("experiment_launched", {
        brandId,
        experimentId: experiment.id,
        runId: result.runId,
      });
      updateLaunchQueued(false);
      if (typeof window !== "undefined") {
        window.location.assign(`/brands/${brandId}/experiments?launched=${experiment.id}`);
        return;
      }
      router.push(`/brands/${brandId}/experiments?launched=${experiment.id}`);
      return;
    } catch (err) {
      updateLaunchQueued(false);
      setError(err instanceof Error ? err.message : "Failed to launch test");
    } finally {
      setLaunching(false);
    }
  };
  const requestAdditionalLeadsCount = () => {
    if (typeof window === "undefined") return null;
    const defaultValue = String(experiment?.testEnvelope.sampleSize ?? PROSPECT_VALIDATION_TARGET);
    const response = window.prompt(
      `How many additional leads should we source? (${ADDITIONAL_LEADS_MIN}-${ADDITIONAL_LEADS_MAX})`,
      defaultValue
    );
    if (response === null) return null;
    const count = parseAdditionalLeadsInput(response.trim());
    if (!count) {
      setError(`Enter a valid lead count between ${ADDITIONAL_LEADS_MIN} and ${ADDITIONAL_LEADS_MAX}.`);
      return null;
    }
    return count;
  };

  const autoSourceProspects = async (
    mode: AutoSourceMode = "gate",
    expandLeadCount?: number,
    options?: { autoSend?: boolean }
  ) => {
    if (!experiment || sampling) return;
    if (mode === "gate" && prospectInputMode !== "need_data") return;
    if (mode === "gate" && prospectsReady) return;
    const abortController = new AbortController();
    samplingAbortRef.current = abortController;
    samplingStopRequestedRef.current = false;
    samplingActiveRunIdRef.current = "";
    setSampling(true);
    setError("");
    setSamplingStatus(mode === "expand" ? "Starting incremental sourcing for additional leads..." : "Starting continuous auto-sourcing...");
    setSamplingSummary("");
    setSamplingAttempt(0);
    setSamplingRunsLaunched(0);
    setSamplingActiveRunId("");
    setSamplingHeartbeatAt(new Date().toISOString());

    const baselineLeadCount = savedProspectCount;
    const requestedExpandCount =
      mode === "expand"
        ? Math.max(
            ADDITIONAL_LEADS_MIN,
            Math.min(
              ADDITIONAL_LEADS_MAX,
              Math.round(
                Number(expandLeadCount ?? experiment.testEnvelope.sampleSize ?? PROSPECT_VALIDATION_TARGET) ||
                  PROSPECT_VALIDATION_TARGET
              )
            )
          )
        : PROSPECT_VALIDATION_TARGET;
    const sampleSize =
      mode === "expand"
        ? requestedExpandCount
        : clampExperimentSampleSize(experiment.testEnvelope.sampleSize, PROSPECT_VALIDATION_TARGET);
    const targetLeads =
      mode === "expand"
        ? Math.max(baselineLeadCount + 1, baselineLeadCount + requestedExpandCount)
        : PROSPECT_VALIDATION_TARGET;
    const autoSend = mode === "expand" ? options?.autoSend !== false : false;
    if (mode === "expand") {
      setSamplingStatus(
        autoSend
          ? "Starting add-leads run (new leads will auto-send during business hours)..."
          : "Starting add-leads run (sourcing only)..."
      );
    }

    let attempts = 0;
    let bestLeadCount = savedProspectCount;

    try {
      while (bestLeadCount < targetLeads) {
        if (samplingStopRequestedRef.current || abortController.signal.aborted) {
          setSamplingSummary(
            `Auto-sourcing stopped by user after ${attempts} attempt${attempts === 1 ? "" : "s"}.`
          );
          return;
        }

        attempts += 1;
        setSamplingAttempt(attempts);
        setSamplingStatus(`Attempt ${attempts}: launching sourcing run...`);
        setSamplingHeartbeatAt(new Date().toISOString());

        let launch: Awaited<ReturnType<typeof sourceExperimentSampleLeadsApi>>;
        try {
          launch = await sourceExperimentSampleLeadsApi(
            brandId,
            experiment.id,
            sampleSize,
            { timeoutMs: 25_000, signal: abortController.signal, autoSend }
          );
        } catch (err) {
          const launchError = err instanceof Error ? err.message : "Failed to launch sourcing run";
          if (samplingStopRequestedRef.current || abortController.signal.aborted || /aborted/i.test(launchError)) {
            setSamplingSummary(
              `Auto-sourcing stopped by user after ${attempts} attempt${attempts === 1 ? "" : "s"}.`
            );
            return;
          }
          setSamplingStatus(`Attempt ${attempts}: launch failed, retrying...`);
          setSamplingSummary(`Attempt ${attempts} failed (${launchError}). Retrying automatically...`);
          await wait(AUTO_SOURCE_RETRY_DELAY_MS);
          continue;
        }
        setSamplingRunsLaunched((prev) => prev + 1);
        setSamplingActiveRunId(launch.runId);
        samplingActiveRunIdRef.current = launch.runId;

        let attemptBestCount = bestLeadCount;
        let latestRunStatus: OutreachRun["status"] | null = null;
        let latestRunPhase = "";
        setSamplingStatus(`Attempt ${attempts}: run ${launch.runId.slice(-6) || "started"} in progress...`);
        setSamplingHeartbeatAt(new Date().toISOString());

        while (attemptBestCount < targetLeads) {
          if (samplingStopRequestedRef.current || abortController.signal.aborted) {
            setSamplingSummary(
              `Auto-sourcing stopped by user after ${attempts} attempt${attempts === 1 ? "" : "s"}.`
            );
            return;
          }
          await wait(AUTO_SOURCE_POLL_INTERVAL_MS);
          let snapshot: RefreshSnapshot;
          try {
            snapshot = await refresh(false);
          } catch (err) {
            const pollError = err instanceof Error ? err.message : "Refresh failed";
            setSamplingStatus(`Attempt ${attempts}: polling error, retrying...`);
            setSamplingSummary(`Attempt ${attempts}: ${pollError}. Continuing to monitor...`);
            setSamplingHeartbeatAt(new Date().toISOString());
            continue;
          }
          attemptBestCount = Math.max(attemptBestCount, snapshot.sourcedLeadWithEmailCount);
          latestRunStatus = snapshot.runView.runs[0]?.status ?? null;
          latestRunPhase = snapshot.runView.runs[0]?.sourcingTraceSummary?.phase ?? "";
          setSamplingStatus(
            `Attempt ${attempts}: ${attemptBestCount}/${targetLeads} quality leads with real emails (${latestRunPhase || latestRunStatus || "processing"})`
          );
          setSamplingHeartbeatAt(new Date().toISOString());

          if (attemptBestCount >= targetLeads) {
            break;
          }
          if (latestRunStatus && isRunTerminal(latestRunStatus)) {
            break;
          }
        }

        bestLeadCount = Math.max(bestLeadCount, attemptBestCount);

        if (bestLeadCount >= targetLeads) {
          setSamplingSummary(
            mode === "expand"
              ? autoSend
                ? `Added and queued sending: ${bestLeadCount} verified leads total (+${requestedExpandCount} requested).`
                : `Added more data: ${bestLeadCount} verified leads total (+${requestedExpandCount} requested).`
              : `Prospect validation passed automatically: ${bestLeadCount}/${targetLeads} quality leads with real emails.`
          );
          return;
        }

        setSamplingSummary(
          mode === "expand"
            ? autoSend
              ? `Attempt ${attempts} completed: ${bestLeadCount} verified leads total. Continuing to add +${requestedExpandCount} and queue sends...`
              : `Attempt ${attempts} completed: ${bestLeadCount} verified leads total. Continuing until +${requestedExpandCount}...`
            : `Attempt ${attempts} completed: ${bestLeadCount}/${targetLeads} verified leads. Continuing...`
        );
        await wait(AUTO_SOURCE_RETRY_DELAY_MS);
      }

      setSamplingSummary(
        mode === "expand"
          ? autoSend
            ? `Added and queued sending: ${bestLeadCount} verified leads total (+${requestedExpandCount} requested).`
            : `Added more data: ${bestLeadCount} verified leads total (+${requestedExpandCount} requested).`
          : `Prospect validation passed automatically: ${bestLeadCount}/${targetLeads} quality leads with real emails.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to auto-source prospects";
      if (samplingStopRequestedRef.current || /aborted/i.test(message)) {
        setSamplingSummary(
          `Auto-sourcing stopped by user after ${attempts} attempt${attempts === 1 ? "" : "s"}.`
        );
      } else if (/timed out/i.test(message)) {
        setSamplingSummary(
          "Launch request timed out before the server acknowledged a run. Retry now or refresh snapshot."
        );
      } else {
        setSamplingSummary("");
        setError(message);
      }
    } finally {
      setSampling(false);
      setSamplingStatus("");
      setSamplingActiveRunId("");
      samplingActiveRunIdRef.current = "";
      samplingAbortRef.current = null;
      samplingStopRequestedRef.current = false;
      try {
        await refresh(false);
      } catch {
        // Keep current UI state if refresh fails; top-level error already captures failures.
      }
    }
  };

  useEffect(() => {
    if (loading || !experiment || routeStage !== null || stageAutoInitializedRef.current) return;
    const initialStage = launchStageUnlocked ? 3 : messagingUnlocked ? 2 : prospectsUnlocked ? 1 : 0;
    setCurrentStage(initialStage);
    stageAutoInitializedRef.current = true;
  }, [experiment, launchStageUnlocked, loading, messagingUnlocked, prospectsUnlocked, routeStage]);

  if (loading || !experiment || !runView) {
    return <div className="text-sm text-[color:var(--muted-foreground)]">Loading experiment...</div>;
  }

  const showLiveRunOverview = Boolean(view === "run" && primaryRun);
  const runNextAction: RunNextAction | null = (() => {
    if (!experiment) return null;
    const messagingHref = `/brands/${brandId}/experiments/${experiment.id}/messaging`;
    const launchHref = `/brands/${brandId}/experiments/${experiment.id}/launch`;
    const inboxHref = `/brands/${brandId}/inbox`;

    if (!messagingReady) {
      return {
        tone: "warning",
        title: "Publish messaging before sending",
        detail: `This experiment has ${sendableLeadCount} sendable contact${sendableLeadCount === 1 ? "" : "s"} ready. Publish the messaging canvas first. After that, Launch can schedule sends during business hours.`,
        primaryLabel: "Open Messaging",
        primaryHref: messagingHref,
        primaryStage: 2,
        secondaryLabel: "Open Launch",
        secondaryHref: launchHref,
        secondaryStage: 3,
      };
    }

    if (!launchIdentityReady) {
      return {
        tone: "warning",
        title: "Finish launch setup",
        detail: `Messaging is published, but sending is blocked until launch setup is complete: ${launchIdentityIssues.join(", ")}.`,
        primaryLabel: "Open Launch",
        primaryHref: launchHref,
        primaryStage: 3,
        secondaryLabel: "Open Messaging",
        secondaryHref: messagingHref,
        secondaryStage: 2,
      };
    }

    if (latestRunIsSourcingOnly && !latestSendingRun) {
      return {
        tone: "warning",
        title: "Start the first sending run",
        detail: `You already have ${sendableLeadCount} sendable contact${sendableLeadCount === 1 ? "" : "s"} ready. Launch the experiment to schedule and send them during the configured business hours.`,
        primaryLabel: "Open Launch",
        primaryHref: launchHref,
        primaryStage: 3,
        secondaryLabel: "Open Messaging",
        secondaryHref: messagingHref,
        secondaryStage: 2,
      };
    }

    if (nextScheduledAtAnyRun) {
      return {
        tone: "success",
        title: "Sends are scheduled",
        detail: `The next outbound send is scheduled for ${formatDate(nextScheduledAtAnyRun)}.`,
        primaryLabel: "Open Inbox",
        primaryHref: inboxHref,
        secondaryLabel: "Open Launch",
        secondaryHref: launchHref,
        secondaryStage: 3,
      };
    }

    if (runTotals.sentMessages > 0) {
      return {
        tone: "success",
        title: "Run has already started sending",
        detail: `This experiment has sent ${runTotals.sentMessages} emails across all runs. Open Inbox to monitor replies, or Launch to review pacing and controls.`,
        primaryLabel: "Open Inbox",
        primaryHref: inboxHref,
        secondaryLabel: "Open Launch",
        secondaryHref: launchHref,
        secondaryStage: 3,
      };
    }

    return null;
  })();
  const liveFunnelSteps = latestRun
    ? [
        { label: "Leads sourced", count: Number(latestRun.metrics.sourcedLeads ?? 0) },
        { label: "Messages scheduled", count: Number(latestRun.metrics.scheduledMessages ?? 0) },
        { label: "Messages sent", count: Number(latestRun.metrics.sentMessages ?? 0) },
        { label: "Replies", count: Number(latestRun.metrics.replies ?? 0) },
        { label: "Positive replies", count: Number(latestRun.metrics.positiveReplies ?? 0) },
      ]
    : [];
  const liveFunnelBase = Math.max(1, Number(liveFunnelSteps[0]?.count ?? 0));

  if (view === "run" && !latestRun) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Run Dashboard</CardTitle>
          <CardDescription>No run exists yet for this experiment.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/brands/${brandId}/experiments/${experimentId}/launch`}>Open Launch Readiness</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/brands/${brandId}/experiments/${experimentId}/messaging`}>Open Messaging</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (showLiveRunOverview && primaryRun) {
    return (
      <div className="space-y-5">
        {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{brand?.name || "Brand"} · {experiment.name}</CardTitle>
                <CardDescription>{latestRunNarrative.detail}</CardDescription>
              </div>
              <Badge variant={runStatusVariant(primaryRun.status)}>
                {runWaitingForSendWindow ? "queued" : primaryRun.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
              <div className="text-xs text-[color:var(--muted-foreground)]">Run</div>
              <div className="text-sm font-semibold">{primaryRun.id.slice(-8)}</div>
            </div>
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
              <div className="text-xs text-[color:var(--muted-foreground)]">Sent (all runs)</div>
              <div className="text-sm font-semibold">{runTotals.sentMessages}</div>
              <div className="text-[11px] text-[color:var(--muted-foreground)]">
                Latest run: {primaryRun.metrics.sentMessages}
              </div>
            </div>
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
              <div className="text-xs text-[color:var(--muted-foreground)]">Replies (all runs)</div>
              <div className="text-sm font-semibold">{runTotals.replies}</div>
              <div className="text-[11px] text-[color:var(--muted-foreground)]">
                Latest run: {primaryRun.metrics.replies}
              </div>
            </div>
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
              <div className="text-xs text-[color:var(--muted-foreground)]">Positive (all runs)</div>
              <div className="text-sm font-semibold">{runTotals.positiveReplies}</div>
              <div className="text-[11px] text-[color:var(--muted-foreground)]">
                Latest run: {primaryRun.metrics.positiveReplies}
              </div>
            </div>
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
              <div className="text-xs text-[color:var(--muted-foreground)]">Next send</div>
              <div className="text-sm font-semibold">
                {nextScheduledAtAnyRun ? formatDate(nextScheduledAtAnyRun) : "No send scheduled"}
              </div>
            </div>
          </CardContent>
        </Card>

        {runNextAction ? (
          <div
            className={`rounded-xl border px-4 py-3 ${
              runNextAction.tone === "success"
                ? "border-[color:var(--success)]/40 bg-[color:var(--success-soft)] text-[color:var(--success)]"
                : "border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-semibold">{runNextAction.title}</div>
                <div className="text-sm">{runNextAction.detail}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild type="button" size="sm">
                  <Link href={runNextAction.primaryHref}>{runNextAction.primaryLabel}</Link>
                </Button>
                {runNextAction.secondaryHref && runNextAction.secondaryLabel ? (
                  <Button asChild type="button" variant="outline" size="sm">
                    <Link href={runNextAction.secondaryHref}>{runNextAction.secondaryLabel}</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Funnel</CardTitle>
              <CardDescription>How leads are flowing through this run right now.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {liveFunnelSteps.map((step, index) => {
                const previous = index === 0 ? liveFunnelBase : Math.max(1, Number(liveFunnelSteps[index - 1]?.count ?? 0));
                const stagePct = Math.round((Math.max(0, step.count) / previous) * 100);
                const normalizedCount = Math.max(0, step.count);
                const widthPct =
                  normalizedCount <= 0
                    ? 0
                    : Math.max(2, Math.min(100, Math.round((normalizedCount / liveFunnelBase) * 100)));
                return (
                  <div key={step.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-[color:var(--foreground)]">{step.label}</span>
                      <span className="text-[color:var(--muted-foreground)]">
                        {step.count} {index === 0 ? "" : `(${stagePct}% of previous)`}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-[999px] bg-[color:var(--border)]">
                      <div
                        className="h-1.5 rounded-[999px] bg-[color:var(--accent)]"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="grid gap-2 pt-1 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                  <div className="text-xs text-[color:var(--muted-foreground)]">Est. sourcing spend</div>
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">
                    {formatUsd(sourcingEconomics.estimatedSourcingSpendUsd)}
                  </div>
                </div>
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                  <div className="text-xs text-[color:var(--muted-foreground)]">Exa queries used</div>
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">
                    {sourcingEconomics.exaQueryCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                  <div className="text-xs text-[color:var(--muted-foreground)]">Cost / sourced lead</div>
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">
                    {sourcingEconomics.costPerSourcedLeadUsd === null
                      ? "n/a"
                      : formatUsd(sourcingEconomics.costPerSourcedLeadUsd, {
                          minFractionDigits: 4,
                          maxFractionDigits: 4,
                        })}
                  </div>
                </div>
                <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                  <div className="text-xs text-[color:var(--muted-foreground)]">Cost / current verified</div>
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">
                    {sourcingEconomics.costPerVerifiedLeadUsd === null
                      ? "n/a"
                      : formatUsd(sourcingEconomics.costPerVerifiedLeadUsd, {
                          minFractionDigits: 4,
                          maxFractionDigits: 4,
                        })}
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-[color:var(--muted-foreground)]">
                Based on recorded run-history sourcing spend, not Exa&apos;s billing ledger.
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Approach</CardTitle>
              <CardDescription>What this experiment is testing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                <div className="text-xs text-[color:var(--muted-foreground)]">Offer</div>
                <div className="line-clamp-4">{experiment.offer || "Not set"}</div>
              </div>
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                <div className="text-xs text-[color:var(--muted-foreground)]">Audience</div>
                <div className="line-clamp-4">{experiment.audience || "Not set"}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2 py-1">
                  <span className="text-[color:var(--muted-foreground)]">Flow rev</span> #{experiment.messageFlow.publishedRevision}
                </div>
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-2 py-1">
                  <span className="text-[color:var(--muted-foreground)]">Cadence</span> {primaryRun.cadence}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">What&apos;s Happening Now</CardTitle>
            <CardDescription>Current run activity and direct operator actions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3 text-xs">
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                <div className="text-[color:var(--muted-foreground)]">From email</div>
                <div className="font-medium text-[color:var(--foreground)]">{launchFromEmail || "Not configured"}</div>
              </div>
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                <div className="text-[color:var(--muted-foreground)]">Reply-to</div>
                <div className="font-medium text-[color:var(--foreground)]">{launchReplyToEmail || "Not configured"}</div>
              </div>
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                <div className="text-[color:var(--muted-foreground)]">Business hours</div>
                <div className="font-medium text-[color:var(--foreground)]">
                  {businessHoursEnabled ? `${businessHoursStartHour}:00-${businessHoursEndHour}:00` : "Disabled"}
                </div>
                {businessHoursEnabled ? (
                  <div className="text-[11px] text-[color:var(--muted-foreground)]">{businessDaysLabel}</div>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild type="button">
                <Link href={`/brands/${brandId}/inbox`}>Open Inbox</Link>
              </Button>
              <Button asChild type="button" variant="outline">
                <Link href={`/brands/${brandId}/experiments/${experiment.id}/launch`}>Open Launch</Link>
              </Button>
              <Button type="button" variant="outline" onClick={() => void refresh(false)}>
                <RefreshCw className="h-4 w-4" /> Refresh
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={sampling}
                onClick={() => {
                  setProspectInputMode("need_data");
                  const count = requestAdditionalLeadsCount();
                  if (!count) return;
                  void autoSourceProspects("expand", count, { autoSend: true });
                }}
              >
                {sampling ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {sampling ? "Adding leads..." : "Add Leads"}
              </Button>
              {canPause(primaryRun.status) ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    await controlExperimentRunApi(brandId, experiment.id, primaryRun.id, "pause");
                    await refresh(false);
                  }}
                >
                  <Pause className="h-4 w-4" /> Pause
                </Button>
              ) : null}
              {canResume(primaryRun.status) ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    await controlExperimentRunApi(brandId, experiment.id, primaryRun.id, "resume");
                    await refresh(false);
                  }}
                >
                  <Play className="h-4 w-4" /> Resume
                </Button>
              ) : null}
              {canCancel(primaryRun.status) ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    await controlExperimentRunApi(brandId, experiment.id, primaryRun.id, "cancel");
                    await refresh(false);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
              {experiment.runtime.campaignId && experiment.runtime.experimentId ? (
                <Button asChild type="button" variant="outline">
                  <Link href={`/brands/${brandId}/experiments/${experiment.id}/messaging`}>Open Messaging Canvas</Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Signals</CardTitle>
            <CardDescription>Latest run events and failure reasons.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {latestEvents.length ? (
              latestEvents.slice(0, 12).map((event) => (
                <div key={event.id} className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-[color:var(--foreground)]">{event.eventType}</div>
                    <div className="text-[color:var(--muted-foreground)]">{formatDate(event.createdAt)}</div>
                  </div>
                  {event.payload.reason ? (
                    <div className="mt-1 text-[color:var(--danger)]">{String(event.payload.reason)}</div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="text-xs text-[color:var(--muted-foreground)]">No activity yet.</div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const messagingFocus = currentStage === 2;
  const stageRouteMode = routeStage !== null;
  const unifiedRunMode = !view && Boolean(latestRun);
  const pipelineOverviewMode = !view;
  const showSetupProgressBar = !setupComplete && currentStage === 0;
  const compactProspectsCanvas = currentStage === 1 && !showSetupProgressBar;
  const experimentStatusLabel = primaryRun
    ? runWaitingForSendWindow
      ? "queued"
      : primaryRun.status
    : experiment.status;
  const activityStatusLabel = primaryRun
    ? runWaitingForSendWindow
      ? "waiting for send window"
      : primaryRun.status
    : sampling
      ? "finding leads"
      : sendableLeadResolution.status === "blocked"
        ? "email verifier blocked"
        : sendableLeadResolution.status === "attention"
          ? "needs better emails"
      : showSendableLeadProgress
        ? "checking emails"
        : prospectsComplete
          ? "ready"
          : "waiting";
  const pipelineSteps = [
    {
      id: "experiment-leads",
      label: "Leads",
      summary: `${savedProspectCount} / ${PROSPECT_VALIDATION_TARGET}`,
      detail: prospectsComplete ? "Approved" : savedProspectsReady ? "Review ready" : `${remainingProspectLeads} left`,
      tone: prospectsComplete ? "success" : "accent",
    },
    {
      id: "experiment-messaging",
      label: "Messaging",
      summary: messagingReady ? "Published" : "Not created",
      detail: !prospectReviewApproved
        ? "Approve leads first"
        : !sendableLeadsReady
          ? launchQueued
            ? `Auto-launch at ${PROSPECT_VALIDATION_TARGET}/${PROSPECT_VALIDATION_TARGET}`
            : `${sendableLeadCount}/${PROSPECT_VALIDATION_TARGET} contacts ready`
          : messagingReady
            ? `Revision #${experiment.messageFlow.publishedRevision}`
            : "Needs a flow",
      tone: messagingReady ? "success" : messagingUnlocked ? "accent" : "muted",
    },
    {
      id: "experiment-launch",
      label: "Launch",
      summary: launchActive ? (runWaitingForSendWindow ? "Queued" : "Running") : sendableLeadsReady ? "Ready" : "Preparing",
      detail: !launchIdentityReady
        ? "Setup needed"
        : sendableLeadsReady
          ? runWaitingForSendWindow
            ? nextScheduledAtAnyRun
              ? `First send: ${formatDate(nextScheduledAtAnyRun)}`
              : `Waiting for ${businessHoursLabel}`
            : nextScheduledAtAnyRun
              ? formatDate(nextScheduledAtAnyRun)
              : primaryRunSentMessages > 0
                ? `${primaryRunSentMessages} sent`
                : "No send booked"
          : launchQueued
            ? `Auto-launch at ${PROSPECT_VALIDATION_TARGET}/${PROSPECT_VALIDATION_TARGET}`
            : `${sendableLeadCount}/${PROSPECT_VALIDATION_TARGET} contacts ready`,
      tone: launchActive ? "success" : sendableLeadsReady ? "accent" : "muted",
    },
    {
      id: "experiment-results",
      label: "Results",
      summary: runTotals.sentMessages > 0 ? `${runTotals.sentMessages} sent` : "No signal",
      detail:
        runTotals.replies > 0
          ? `${runTotals.replies} replies`
          : runTotals.sentMessages > 0
            ? "Waiting for replies"
            : "Nothing sent yet",
      tone: runTotals.replies > 0 ? "success" : runTotals.sentMessages > 0 ? "accent" : "muted",
    },
  ] as const;
  const scrollToPipelineSection = (sectionId: string) => {
    if (typeof document === "undefined") return;
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const setupProgressPanel = showSetupProgressBar ? (
    <section className="overflow-hidden rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="border-b border-[color:var(--border)] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-[color:var(--muted-foreground)]">
              Setup progress
            </div>
            <div className="text-sm font-medium text-[color:var(--foreground)]">
              {setupCompletionCount} of {setupChecklist.length} basics filled in
            </div>
          </div>
          <Badge variant="muted">Step 1 of {STAGE_COUNT}</Badge>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
          <div
            className="h-full rounded-full bg-[color:var(--accent)] transition-[width] duration-300"
            style={{ width: `${setupCompletionPct}%` }}
          />
        </div>
      </div>
      <div className="grid gap-2 px-4 py-4 sm:grid-cols-4 sm:px-5">
        {workflowStages.map((stage) => (
          <div
            key={`setup-progress-${stage.index}`}
            className={`rounded-[14px] border px-3 py-3 ${
              stage.index === 0
                ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
                : stage.status === "locked"
                  ? "border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--muted-foreground)]"
                  : "border-[color:var(--border)] bg-[color:var(--surface)]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[color:var(--border)] text-[11px] font-semibold">
                {stage.index + 1}
              </div>
              {stage.status === "done" ? (
                <CheckCircle2 className="h-4 w-4 text-[color:var(--success)]" />
              ) : stage.status === "locked" ? (
                <Lock className="h-3.5 w-3.5 text-[color:var(--muted-foreground)]" />
              ) : (
                <Badge variant={stageBadgeVariant(stage.status)}>{stageBadgeLabel(stage.status)}</Badge>
              )}
            </div>
            <div className="mt-2 text-sm font-semibold text-[color:var(--foreground)]">{stage.label}</div>
          </div>
        ))}
      </div>
    </section>
  ) : null;
  const stageFlowStrip = (
    <section className="space-y-2">
      <div className="flex flex-col gap-3 rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {workflowStages.map((stage, index) => (
            <div key={`flow-strip-${stage.index}`} className="flex items-center gap-2">
              <button
                type="button"
                disabled={stage.disabled}
                onClick={() => {
                  if (stage.disabled) return;
                  openStage(stage.index);
                }}
                className={`flex items-center gap-2 rounded-full px-2.5 py-1.5 text-sm transition ${
                  currentStage === stage.index
                    ? "bg-[color:var(--accent-soft)] text-[color:var(--foreground)]"
                    : stage.status === "done"
                      ? "text-[color:var(--success)]"
                      : "text-[color:var(--muted-foreground)]"
                } ${stage.disabled ? "cursor-not-allowed opacity-50" : "hover:bg-[color:var(--surface-muted)]"}`}
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[color:var(--border)] text-[11px] font-semibold">
                  {stage.index + 1}
                </span>
                <span className="font-medium">{stage.label}</span>
                {stage.status === "done" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : stage.status === "locked" ? (
                  <Lock className="h-3 w-3 text-[color:var(--muted-foreground)]" />
                ) : null}
              </button>
              {index < workflowStages.length - 1 ? <div className="h-px w-6 bg-[color:var(--border)]" /> : null}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end">
          {currentStage === 0 ? (
            <Button
              type="button"
              onClick={() => navigateToStage(1)}
              disabled={!setupComplete || saving}
              className="min-w-[170px] justify-between rounded-full"
            >
              <span>Next: Get leads</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : currentStage === 1 ? (
            <Button
              type="button"
              onClick={approveProspectsAndContinue}
              disabled={!prospectsComplete}
              className="min-w-[190px] justify-between rounded-full"
            >
              <span>Next: Write emails</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : currentStage === 2 ? (
            <Button
              type="button"
              onClick={() => navigateToStage(3)}
              disabled={!messagingComplete}
              className="min-w-[190px] justify-between rounded-full"
            >
              <span>
                {!messagingComplete
                  ? "Publish flow first"
                  : sendableLeadsReady
                    ? "Next: Start sending"
                    : "Next: Prepare launch"}
              </span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => {
                if (launchPreparing) {
                  if (canRelaxCompanyDedupe) {
                    void relaxCompanyDedupe();
                    return;
                  }
                  updateLaunchQueued(true);
                  return;
                }
                void launchExperimentNow();
              }}
              disabled={launchBlocked}
              className="min-w-[190px] justify-between rounded-full"
            >
              <span>{launchActionLabel}</span>
              <Rocket className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="text-xs text-[color:var(--muted-foreground)]">{nextGateHint}</div>
    </section>
  );
  const prospectTableSettings = {
    oneContactPerCompany: oneContactPerCompanyEnabled,
  };
  const prospectInitialPrompt = String(
    prospectTablePrompt || experiment?.audience || experiment?.offer || experiment?.name || ""
  ).trim();
  const saveProspectTableSettings = async (next: { oneContactPerCompany: boolean }) => {
    const updated = await updateExperimentApi(brandId, experiment.id, {
      testEnvelope: {
        ...experiment.testEnvelope,
        oneContactPerCompany: next.oneContactPerCompany,
      },
    });
    setExperiment(updated);
  };
  const leadsWorkspace = (
    <section className="space-y-3">
      <LiveProspectTableEmbed
        initPath={`/api/brands/${brandId}/experiments/${experiment.id}/prospect-table`}
        importPath={`/api/brands/${brandId}/experiments/${experiment.id}/import-prospects/selection`}
        lookalikeSeedPath={`/api/brands/${brandId}/lookalike-seed`}
        goalCount={PROSPECT_VALIDATION_TARGET}
        initialPrompt={prospectInitialPrompt}
        targetingLocked
        settings={prospectTableSettings}
        onReviewApproved={approveProspectsAndContinue}
        onSettingsChange={saveProspectTableSettings}
        onTableStateChange={({ rowCount, prompt }) => {
          const normalizedPrompt = String(prompt || "").trim();
          const currentPrompt = String(prospectTablePrompt || "").trim();
          const promptChanged = Boolean(normalizedPrompt) && normalizedPrompt !== currentPrompt;
          const normalizedRowCount = Math.max(0, Number(rowCount || 0));

          setProspectTableRowCount((currentCount) => {
            if (promptChanged) {
              return normalizedRowCount;
            }
            if (normalizedRowCount === 0 && currentCount > 0) {
              return currentCount;
            }
            return Math.max(currentCount, normalizedRowCount);
          });
          if (normalizedPrompt) {
            setProspectTablePrompt(normalizedPrompt);
          }
        }}
        onImported={async () => {
          await refresh(false);
        }}
      />
    </section>
  );

  if (pipelineOverviewMode && compactProspectsCanvas) {
    return (
      <div className="space-y-4">
        {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}
        {stageFlowStrip}
        {leadsWorkspace}
      </div>
    );
  }

  if (pipelineOverviewMode) {
    return (
      <div className="space-y-5">
        {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader>
              <CardTitle>{experiment.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="muted">Status: {experimentStatusLabel}</Badge>
              <Badge variant="muted">Sent: {runTotals.sentMessages}</Badge>
              <Badge variant="muted">Replies: {runTotals.replies}</Badge>
              <Badge variant="muted">Positive: {runTotals.positiveReplies}</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Experiment activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                <div className="text-xs text-[color:var(--muted-foreground)]">Latest run</div>
                <div className="font-medium text-[color:var(--foreground)]">
                  {primaryRun ? primaryRun.id.slice(-8) : "No run yet"}
                </div>
              </div>
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                <div className="text-xs text-[color:var(--muted-foreground)]">Sourcing</div>
                <div className="font-medium text-[color:var(--foreground)]">{activityStatusLabel}</div>
              </div>
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                <div className="text-xs text-[color:var(--muted-foreground)]">Next send</div>
                <div className="font-medium text-[color:var(--foreground)]">
                  {nextScheduledAtAnyRun ? formatDate(nextScheduledAtAnyRun) : "Not scheduled"}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {setupProgressPanel}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-4">
              {pipelineSteps.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => scrollToPipelineSection(step.id)}
                  className="rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4 text-left transition hover:border-[color:var(--accent)] hover:bg-[color:var(--surface)]"
                >
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
                    {step.label}
                  </div>
                  <div className="mt-2 text-lg font-semibold text-[color:var(--foreground)]">{step.summary}</div>
                  <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">{step.detail}</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card id="experiment-leads">
          <CardHeader>
            <CardTitle className="text-base">Leads</CardTitle>
            <CardDescription>{prospectPrimaryMessage}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <LiveProspectTableEmbed
              initPath={`/api/brands/${brandId}/experiments/${experiment.id}/prospect-table`}
              importPath={`/api/brands/${brandId}/experiments/${experiment.id}/import-prospects/selection`}
              lookalikeSeedPath={`/api/brands/${brandId}/lookalike-seed`}
              goalCount={PROSPECT_VALIDATION_TARGET}
              initialPrompt={prospectInitialPrompt}
              initialRowCount={savedProspectCount}
              sendableLeadCount={sendableLeadCount}
              sendableLeadGoal={PROSPECT_VALIDATION_TARGET}
              maxRowCap={Math.max(PROSPECT_VALIDATION_TARGET * 3, 80)}
              targetingLocked
              settings={prospectTableSettings}
              onReviewApproved={() => {
                navigateToStage(2);
              }}
              onSettingsChange={saveProspectTableSettings}
              onTableStateChange={({ rowCount }) => {
                const normalizedRowCount = Math.max(0, Number(rowCount || 0));
                setProspectTableRowCount((currentCount) => {
                  if (normalizedRowCount === 0 && currentCount > 0) {
                    return currentCount;
                  }
                  return Math.max(currentCount, normalizedRowCount);
                });
              }}
              onImported={async () => {
                await refresh(false);
              }}
            />
          </CardContent>
        </Card>

        <Card id="experiment-messaging">
          <CardHeader>
            <CardTitle className="text-base">Messaging</CardTitle>
            <CardDescription>
              {messagingReady
                ? `Ready. Flow revision #${experiment.messageFlow.publishedRevision} is published.`
                : !prospectReviewApproved
                  ? "Approve the first 20 leads first."
                  : "No messaging flow created yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sendableLeadProgressPanel}
            <div className="text-sm text-[color:var(--muted-foreground)]">
              {!prospectReviewApproved
                ? "Review and approve the first 20 leads to unlock messaging."
                : showSendableLeadProgress
                  ? `AI is still resolving work emails in the background: ${sendableLeadCount}/${PROSPECT_VALIDATION_TARGET} ready.`
                  : "Create the step blocks people will get."}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild type="button" disabled={!messagingUnlocked}>
                <Link href={`/brands/${brandId}/experiments/${experiment.id}/messaging`}>
                  {messagingReady ? "Edit messaging flow" : "Open messaging canvas"}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card id="experiment-launch">
          <CardHeader>
            <CardTitle className="text-base">Launch</CardTitle>
            <CardDescription>
              {!prospectReviewApproved
                ? "Approve the first 20 leads first."
                : !messagingReady
                  ? "Messaging required before launch."
                  : showSendableLeadProgress
                    ? `Still preparing sendable contacts: ${sendableLeadCount}/${PROSPECT_VALIDATION_TARGET} ready.`
                    : launchIdentityReady
                      ? latestRun
                        ? latestRunNarrative.detail
                        : "Ready when you are."
                      : "Sending setup required before launch."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sendableLeadProgressPanel}
            {!launchIdentityReady ? (
              <div className="text-sm text-[color:var(--warning)]">
                Fix before launch: {launchIdentityIssues.join(" · ")}.
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button asChild type="button" disabled={!messagingReady}>
                <Link href={`/brands/${brandId}/experiments/${experiment.id}/launch`}>
                  {latestRun ? "Open launch controls" : "Launch experiment"}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card id="experiment-results">
          <CardHeader>
            <CardTitle className="text-base">Results</CardTitle>
            <CardDescription>
              {runTotals.sentMessages > 0 ? `${runTotals.sentMessages} emails sent so far.` : "No emails sent yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="muted">Sent: {runTotals.sentMessages}</Badge>
              <Badge variant="muted">Replies: {runTotals.replies}</Badge>
              <Badge variant="muted">Positive: {runTotals.positiveReplies}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild type="button" variant="outline">
                <Link href={`/brands/${brandId}/inbox`}>Open inbox</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {!messagingFocus && !compactProspectsCanvas ? (
        stageRouteMode ? (
          <section className="space-y-2 border-b border-[color:var(--border)] pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h1 className="text-[1.55rem] font-semibold tracking-[-0.05em] text-[color:var(--foreground)]">
                  {experiment.name}
                </h1>
                <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                  Setup → Prospects → Messaging → Launch
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="muted">Status: {experiment.status}</Badge>
                <Badge variant="muted">Sent: {experiment.metricsSummary.sent}</Badge>
                <Badge variant="muted">Replies: {experiment.metricsSummary.replies}</Badge>
                <Badge variant="muted">Positive: {experiment.metricsSummary.positiveReplies}</Badge>
                {primaryRun ? (
                  <Badge variant={runStatusVariant(primaryRun.status)}>
                    Run: {runWaitingForSendWindow ? "queued" : primaryRun.status}
                  </Badge>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{brand?.name || "Brand"} · {experiment.name}</CardTitle>
              <CardDescription>
                {unifiedRunMode
                  ? "Manage sourcing, messaging, launch, and live run status from this page."
                  : "Stage-based flow: Setup -> Prospects -> Messaging -> Launch."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="muted">Status: {experiment.status}</Badge>
              <Badge variant="muted">Sent: {experiment.metricsSummary.sent}</Badge>
              <Badge variant="muted">Replies: {experiment.metricsSummary.replies}</Badge>
              <Badge variant="muted">Positive: {experiment.metricsSummary.positiveReplies}</Badge>
              {primaryRun ? (
                <Badge variant={runStatusVariant(primaryRun.status)}>
                  Run: {runWaitingForSendWindow ? "queued" : primaryRun.status}
                </Badge>
              ) : null}
            </CardContent>
          </Card>
        )
      ) : null}

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      {!view && primaryRun && !compactProspectsCanvas ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Run Status</CardTitle>
              <CardDescription>{latestRunNarrative.detail}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                <div className="text-xs text-[color:var(--muted-foreground)]">Latest run</div>
                <div className="text-sm font-semibold">{primaryRun.id.slice(-8)}</div>
              </div>
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                <div className="text-xs text-[color:var(--muted-foreground)]">Sendable contacts</div>
                <div className="text-sm font-semibold">{sendableLeadCount}</div>
              </div>
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                <div className="text-xs text-[color:var(--muted-foreground)]">Sent</div>
                <div className="text-sm font-semibold">{runTotals.sentMessages}</div>
              </div>
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                <div className="text-xs text-[color:var(--muted-foreground)]">Replies</div>
                <div className="text-sm font-semibold">{runTotals.replies}</div>
              </div>
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2">
                <div className="text-xs text-[color:var(--muted-foreground)]">Next send</div>
                <div className="text-sm font-semibold">
                  {nextScheduledAtAnyRun ? formatDate(nextScheduledAtAnyRun) : "No send scheduled"}
                </div>
              </div>
            </CardContent>
          </Card>

          {runNextAction ? (
            <div
              className={`rounded-xl border px-4 py-3 ${
                runNextAction.tone === "success"
                  ? "border-[color:var(--success)]/40 bg-[color:var(--success-soft)] text-[color:var(--success)]"
                  : "border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">{runNextAction.title}</div>
                  <div className="text-sm">{runNextAction.detail}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {runNextAction.primaryStage !== undefined ? (
                    <Button type="button" size="sm" onClick={() => setCurrentStage(runNextAction.primaryStage!)}>
                      {runNextAction.primaryLabel}
                    </Button>
                  ) : (
                    <Button asChild type="button" size="sm">
                      <Link href={runNextAction.primaryHref}>{runNextAction.primaryLabel}</Link>
                    </Button>
                  )}
                  {runNextAction.secondaryLabel ? (
                    runNextAction.secondaryStage !== undefined ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentStage(runNextAction.secondaryStage!)}
                      >
                        {runNextAction.secondaryLabel}
                      </Button>
                    ) : runNextAction.secondaryHref ? (
                      <Button asChild type="button" variant="outline" size="sm">
                        <Link href={runNextAction.secondaryHref}>{runNextAction.secondaryLabel}</Link>
                      </Button>
                    ) : null
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {!unifiedRunMode && !compactProspectsCanvas ? (
        stageRouteMode ? (
          <div className="space-y-4">
            {stageFlowStrip}
            {showSetupProgressBar ? setupProgressPanel : null}
          </div>
        ) : (
          <Card>
            <CardHeader className="border-b border-[color:var(--border)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">What happens next</CardTitle>
                  <CardDescription>
                    {messagingFocus ? "You are in the write emails step." : "Do these four steps in order."}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="muted">
                    Step {Math.min(currentStage + 1, STAGE_COUNT)} of {STAGE_COUNT}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="grid gap-2 md:grid-cols-4">
                {workflowStages.map((stage) => (
                  <button
                    key={stage.index}
                    type="button"
                    disabled={stage.disabled}
                    onClick={() => {
                      if (stage.disabled) return;
                      openStage(stage.index);
                    }}
                    className={`relative rounded-[10px] border p-3 text-left transition ${
                      currentStage === stage.index
                        ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
                        : stage.status === "done"
                          ? "border-[color:var(--success-border)] bg-[color:var(--success-soft)]/60"
                          : "border-[color:var(--border)] bg-[color:var(--surface-muted)]"
                    } ${stage.disabled ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="inline-flex h-6 min-w-6 items-center justify-center rounded-[8px] border border-[color:var(--border)] bg-[color:var(--surface)] px-2 text-[11px] font-semibold">
                        {stage.index + 1}
                      </div>
                      {stage.status === "done" ? (
                        <CheckCircle2 className="h-4 w-4 text-[color:var(--success)]" />
                      ) : stage.status === "locked" ? (
                        <Lock className="h-3.5 w-3.5 text-[color:var(--muted-foreground)]" />
                      ) : (
                        <Badge variant={stageBadgeVariant(stage.status)}>{stageBadgeLabel(stage.status)}</Badge>
                      )}
                    </div>
                    <div className="mt-2 text-sm font-semibold">{stage.label}</div>
                    <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">{stageSummary(stage.index)}</div>
                  </button>
                ))}
                </div>
              </div>
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs text-[color:var(--muted-foreground)]">
                {nextGateHint}
              </div>
            </CardContent>
          </Card>
        )
      ) : null}

      {currentStage === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{stageTitle(0)}</CardTitle>
            <CardDescription>
              Choose who this is for and what you want to offer first. You will write the email copy in the next
              step.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Tell AI what you want</div>
                  <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                    Describe the people you want to reach and what you want to offer. AI will fill the setup for you.
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={draftingSetupFromAi || !aiSetupPrompt.trim()}
                  onClick={() => {
                    void fillSetupFromPrompt();
                  }}
                >
                  <Sparkles className="h-4 w-4" />
                  {draftingSetupFromAi ? "Writing..." : "Write this for me"}
                </Button>
              </div>
              <Textarea
                className="mt-3"
                rows={4}
                value={aiSetupPrompt}
                onChange={(event) => setAiSetupPrompt(event.target.value)}
                placeholder="Example: Reach bootstrapped SaaS founders who might qualify for AWS credits and offer a short eligibility review plus a checklist they can use."
              />
              <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                AI fills the experiment name, target audience, and offer. You can still edit everything below.
              </div>
              {aiSetupNotice ? (
                <div className="mt-3 rounded-lg border border-[color:var(--success)]/40 bg-[color:var(--success-soft)] px-3 py-2 text-sm text-[color:var(--success)]">
                  {aiSetupNotice}
                </div>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="experiment-name">Experiment Name</Label>
              <Input
                id="experiment-name"
                value={experiment.name}
                onChange={(event) => setExperiment((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="experiment-offer">Offer / Angle</Label>
              <Textarea
                id="experiment-offer"
                rows={3}
                value={experiment.offer}
                onChange={(event) => setExperiment((prev) => (prev ? { ...prev, offer: event.target.value } : prev))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="experiment-audience">Target Audience</Label>
              <Textarea
                id="experiment-audience"
                rows={3}
                value={experiment.audience}
                onChange={(event) => setExperiment((prev) => (prev ? { ...prev, audience: event.target.value } : prev))}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="grid gap-2">
                <Label>Lead sample size</Label>
                <Input
                  type="number"
                  min={EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS}
                  value={experiment.testEnvelope.sampleSize}
                  onChange={(event) =>
                    setExperiment((prev) =>
                      prev
                        ? {
                            ...prev,
                            testEnvelope: {
                              ...prev.testEnvelope,
                              sampleSize: clampExperimentSampleSize(event.target.value, prev.testEnvelope.sampleSize),
                            },
                          }
                        : prev
                    )
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Duration days</Label>
                <Input
                  type="number"
                  min={1}
                  value={experiment.testEnvelope.durationDays}
                  onChange={(event) =>
                    setExperiment((prev) =>
                      prev
                        ? {
                            ...prev,
                            testEnvelope: {
                              ...prev.testEnvelope,
                              durationDays: Math.max(1, Number(event.target.value || 1)),
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
                  value={experiment.testEnvelope.timezone}
                  onChange={(event) =>
                    setExperiment((prev) =>
                      prev
                        ? {
                            ...prev,
                            testEnvelope: {
                              ...prev.testEnvelope,
                              timezone: event.target.value,
                            },
                          }
                        : prev
                    )
                  }
                />
              </div>
            </div>
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="text-sm font-medium">Sending Window</div>
              <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                Add Leads will auto-send only inside this window.
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={experiment.testEnvelope.businessHoursEnabled !== false}
                    onChange={(event) =>
                      setExperiment((prev) =>
                        prev
                          ? {
                              ...prev,
                              testEnvelope: {
                                ...prev.testEnvelope,
                                businessHoursEnabled: event.target.checked,
                              },
                            }
                          : prev
                      )
                    }
                  />
                  Restrict sending to business hours
                </label>
                <div className="grid gap-2">
                  <Label>Start hour (0-23)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={Math.max(0, Math.min(23, Number(experiment.testEnvelope.businessHoursStartHour ?? 9) || 9))}
                    onChange={(event) =>
                      setExperiment((prev) =>
                        prev
                          ? {
                              ...prev,
                              testEnvelope: {
                                ...prev.testEnvelope,
                                businessHoursStartHour: Math.max(
                                  0,
                                  Math.min(23, Math.round(Number(event.target.value || 9) || 9))
                                ),
                              },
                            }
                          : prev
                      )
                    }
                    disabled={experiment.testEnvelope.businessHoursEnabled === false}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>End hour (1-24)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    value={Math.max(1, Math.min(24, Number(experiment.testEnvelope.businessHoursEndHour ?? 17) || 17))}
                    onChange={(event) =>
                      setExperiment((prev) =>
                        prev
                          ? {
                              ...prev,
                              testEnvelope: {
                                ...prev.testEnvelope,
                                businessHoursEndHour: Math.max(
                                  1,
                                  Math.min(24, Math.round(Number(event.target.value || 17) || 17))
                                ),
                              },
                            }
                          : prev
                      )
                    }
                    disabled={experiment.testEnvelope.businessHoursEnabled === false}
                  />
                </div>
              </div>
              <div className="mt-3">
                <Label>Business days</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {BUSINESS_DAY_OPTIONS.map((option) => {
                    const selected = (experiment.testEnvelope.businessDays ?? [1, 2, 3, 4, 5]).includes(option.value);
                    return (
                      <button
                        key={`day-${option.value}`}
                        type="button"
                        disabled={experiment.testEnvelope.businessHoursEnabled === false}
                        onClick={() =>
                          setExperiment((prev) => {
                            if (!prev) return prev;
                            const current = new Set(prev.testEnvelope.businessDays ?? [1, 2, 3, 4, 5]);
                            if (current.has(option.value)) {
                              current.delete(option.value);
                            } else {
                              current.add(option.value);
                            }
                            const nextDays = Array.from(current).sort((a, b) => a - b);
                            return {
                              ...prev,
                              testEnvelope: {
                                ...prev.testEnvelope,
                                businessDays: nextDays.length ? nextDays : [1, 2, 3, 4, 5],
                              },
                            };
                          })
                        }
                        className={`rounded-md border px-2 py-1 text-xs ${
                          selected
                            ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
                            : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted-foreground)]"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  void saveSetup();
                }}
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Setup"}
              </Button>
              <Button
                type="button"
                disabled={saving || !setupComplete}
                onClick={async () => {
                  const saved = await saveSetup();
                  if (!saved) return;
                  if (routeStage !== null) {
                    router.push(stagePath(brandId, saved.id, 1));
                    return;
                  }
                  setCurrentStage(1);
                }}
              >
                Continue to Prospects
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {currentStage === 1 ? (
        leadsWorkspace
      ) : null}

      {currentStage === 2 ? (
        <div className="space-y-4">
          {sendableLeadProgressPanel}
          {experiment.runtime.campaignId && experiment.runtime.experimentId ? (
            <FlowEditorClient
              brandId={brandId}
              campaignId={experiment.runtime.campaignId}
              variantId={experiment.runtime.experimentId}
              backHref={`/brands/${brandId}/experiments/${experiment.id}`}
              hideBackButton
            />
          ) : (
            <div className="rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] px-3 py-2 text-sm text-[color:var(--warning)]">
              Flow editor is unavailable until runtime mapping exists. Run Stage 1 sourcing once, then reopen Messaging.
            </div>
          )}
        </div>
      ) : null}

      {currentStage === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Launch Readiness</CardTitle>
            <CardDescription>Review setup and start this experiment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sendableLeadProgressPanel}
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">Sending Account</div>
                <Badge variant={launchIdentityReady ? "success" : "danger"}>
                  {launchIdentityReady ? "ready" : "setup needed"}
                </Badge>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 text-xs">
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <div className="text-[color:var(--muted-foreground)]">From email</div>
                  <div className="font-medium text-[color:var(--foreground)]">{launchFromEmail || "Not configured"}</div>
                </div>
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <div className="text-[color:var(--muted-foreground)]">Reply-to email</div>
                  <div className="font-medium text-[color:var(--foreground)]">{launchReplyToEmail || "Not configured"}</div>
                </div>
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <div className="text-[color:var(--muted-foreground)]">Delivery account</div>
                  <div className="font-medium text-[color:var(--foreground)]">
                    {deliveryAccount ? `${deliveryAccount.name} (${deliveryAccount.status})` : "Not assigned"}
                  </div>
                </div>
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <div className="text-[color:var(--muted-foreground)]">Reply mailbox</div>
                  <div className="font-medium text-[color:var(--foreground)]">
                    {replyMailboxAccount
                      ? `${replyMailboxAccount.name} (${replyMailboxAccount.status})`
                      : "Not assigned"}
                  </div>
                </div>
              </div>
              {launchIdentityReady ? (
                <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                  Launch will send from <span className="font-medium text-[color:var(--foreground)]">{launchFromEmail}</span>{" "}
                  and route replies to{" "}
                  <span className="font-medium text-[color:var(--foreground)]">{launchReplyToEmail}</span>.
                </div>
              ) : (
                <div className="mt-2 text-xs text-[color:var(--warning)]">
                  Fix before launch: {launchIdentityIssues.join(" · ")}.{" "}
                  <Link className="underline underline-offset-4" href="/settings/outreach">
                    Open Outreach Settings
                  </Link>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="text-sm font-medium">Send Plan</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3 text-xs">
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <div className="text-[color:var(--muted-foreground)]">Daily send limit</div>
                  <div className="font-medium text-[color:var(--foreground)]">{experiment.testEnvelope.dailyCap}</div>
                </div>
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <div className="text-[color:var(--muted-foreground)]">Hourly send limit</div>
                  <div className="font-medium text-[color:var(--foreground)]">{experiment.testEnvelope.hourlyCap}</div>
                </div>
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <div className="text-[color:var(--muted-foreground)]">Time zone</div>
                  <div className="font-medium text-[color:var(--foreground)]">{experiment.testEnvelope.timezone}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button type="button" variant="outline" onClick={() => openStage(2)}>
                Back to Messaging
              </Button>
              <Button
                type="button"
                disabled={launching || launchBlocked}
                onClick={async () => {
                  if (launchPreparing) {
                    if (canRelaxCompanyDedupe) {
                      await relaxCompanyDedupe();
                      return;
                    }
                    updateLaunchQueued(true);
                    setSendableLeadResolution((current) => ({
                      ...current,
                      status: current.status === "ready" ? current.status : "resolving",
                      message:
                        current.message ||
                        `Checking work emails in the background: ${sendableLeadCount}/${PROSPECT_VALIDATION_TARGET} ready.`,
                      lastUpdatedAt: current.lastUpdatedAt,
                      readyCount: Math.max(current.readyCount, sendableLeadCount),
                      retryable: current.status === "ready" ? false : true,
                    }));
                    setSendableLeadResolutionTick((tick) => tick + 1);
                    return;
                  }
                  await launchExperimentNow();
                }}
              >
                <Rocket className="h-4 w-4" />
                {launchActionLabel}
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={promoting || runView.runs.length === 0 || Boolean(experiment.promotedCampaignId)}
                onClick={async () => {
                  setPromoting(true);
                  setError("");
                  try {
                    const campaign = await promoteExperimentApi(brandId, experiment.id);
                    trackEvent("experiment_promoted_manual", {
                      brandId,
                      experimentId: experiment.id,
                      campaignId: campaign.id,
                    });
                    await refresh(false);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to promote experiment");
                  } finally {
                    setPromoting(false);
                  }
                }}
              >
                {promoting ? "Promoting..." : experiment.promotedCampaignId ? "Promoted" : "Promote to Campaign"}
              </Button>
              {experiment.promotedCampaignId ? (
                <Button asChild type="button" variant="outline">
                  <Link href={`/brands/${brandId}/campaigns/${experiment.promotedCampaignId}`}>Open Campaign</Link>
                </Button>
              ) : null}
            </div>

            {showSendableLeadProgress ? (
              <div className="rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] px-3 py-2 text-sm text-[color:var(--warning)]">
                Launch will unlock automatically once {PROSPECT_VALIDATION_TARGET} sendable contacts are ready.
              </div>
            ) : null}

            {!unifiedRunMode ? (
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">{primaryRun ? `Run ${primaryRun.id.slice(-6)}` : "No run yet"}</div>
                  {primaryRun ? (
                    <Badge variant={runStatusVariant(primaryRun.status)}>
                      {runWaitingForSendWindow ? "queued" : primaryRun.status}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs">
                  <div className="font-medium text-[color:var(--foreground)]">{latestRunNarrative.headline}</div>
                  <div className="mt-1 text-[color:var(--muted-foreground)]">{latestRunNarrative.detail}</div>
                </div>
                {primaryRun ? (
                  <>
                    <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                      Leads {primaryRun.metrics.sourcedLeads} · Sent {primaryRun.metrics.sentMessages} · Replies {primaryRun.metrics.replies} · Positive {primaryRun.metrics.positiveReplies}
                    </div>
                    {primaryRun.lastError ? (
                      <div className="mt-2 text-sm text-[color:var(--danger)]">Reason: {primaryRun.lastError}</div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canPause(primaryRun.status) ? (
                        <Button type="button" variant="outline" onClick={async () => { await controlExperimentRunApi(brandId, experiment.id, primaryRun.id, "pause"); await refresh(false); }}>
                          <Pause className="h-4 w-4" /> Pause
                        </Button>
                      ) : null}
                      {canResume(primaryRun.status) ? (
                        <Button type="button" variant="outline" onClick={async () => { await controlExperimentRunApi(brandId, experiment.id, primaryRun.id, "resume"); await refresh(false); }}>
                          <Play className="h-4 w-4" /> Resume
                        </Button>
                      ) : null}
                      {canCancel(primaryRun.status) ? (
                        <Button type="button" variant="outline" onClick={async () => { await controlExperimentRunApi(brandId, experiment.id, primaryRun.id, "cancel"); await refresh(false); }}>
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            ) : primaryRun ? (
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">Run controls</div>
                  <Badge variant={runStatusVariant(primaryRun.status)}>
                    {runWaitingForSendWindow ? "queued" : primaryRun.status}
                  </Badge>
                </div>
                {primaryRun.lastError ? (
                  <div className="mt-2 text-sm text-[color:var(--danger)]">Reason: {primaryRun.lastError}</div>
                ) : (
                  <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                    Manage the live run here without repeating the full status summary above.
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {canPause(primaryRun.status) ? (
                    <Button type="button" variant="outline" onClick={async () => { await controlExperimentRunApi(brandId, experiment.id, primaryRun.id, "pause"); await refresh(false); }}>
                      <Pause className="h-4 w-4" /> Pause
                    </Button>
                  ) : null}
                  {canResume(primaryRun.status) ? (
                    <Button type="button" variant="outline" onClick={async () => { await controlExperimentRunApi(brandId, experiment.id, primaryRun.id, "resume"); await refresh(false); }}>
                      <Play className="h-4 w-4" /> Resume
                    </Button>
                  ) : null}
                  {canCancel(primaryRun.status) ? (
                    <Button type="button" variant="outline" onClick={async () => { await controlExperimentRunApi(brandId, experiment.id, primaryRun.id, "cancel"); await refresh(false); }}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div>
              <div className="text-sm font-medium">Outbound messages</div>
              {runView.messages.length ? (
                <div className="mt-2 space-y-2">
                  {runView.messages.slice(0, 20).map((message) => (
                    <div key={message.id} className="rounded-lg border border-[color:var(--border)] p-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{message.subject || "(no subject)"}</span>
                        <Badge variant={message.status === "sent" ? "success" : message.status === "failed" ? "danger" : "muted"}>
                          {message.status}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[color:var(--muted-foreground)]">
                        {message.body.slice(0, 180)}{message.body.length > 180 ? "..." : ""}
                      </div>
                      <div className="mt-1 text-[color:var(--muted-foreground)]">{formatDate(message.sentAt || message.scheduledAt)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">No outbound messages yet.</div>
              )}
            </div>

            <div>
              <div className="text-sm font-medium">Inbound replies</div>
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
                      <div className="mt-1 text-[color:var(--muted-foreground)]">{thread.intent} · {formatDate(thread.lastMessageAt)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">No replies yet.</div>
              )}
            </div>

            <div>
              <div className="text-sm font-medium">Run timeline</div>
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
      ) : null}

      {!view && !unifiedRunMode ? (
        <Card className="sticky bottom-4 z-10 border-[color:var(--border)] bg-[color:var(--surface)] shadow-[0_12px_30px_-28px_var(--shadow)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <div className="text-xs font-medium text-[color:var(--foreground)]">{stageTitle(currentStage)}</div>
              <div className="text-xs text-[color:var(--muted-foreground)]">{nextGateHint}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={goPrev} disabled={currentStage === 0}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button type="button" onClick={goNext} disabled={currentStage === 3 || !canGoNext}>
                Next
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
