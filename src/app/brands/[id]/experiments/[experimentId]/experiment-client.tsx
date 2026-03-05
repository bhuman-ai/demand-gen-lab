"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Pause, Play, RefreshCw, Rocket, Save, Upload } from "lucide-react";
import {
  controlExperimentRunApi,
  fetchBrand,
  fetchConversationPreviewLeadsApi,
  fetchExperiment,
  fetchExperimentRunView,
  fetchExperimentSourcingTraceApi,
  importExperimentProspectsCsvApi,
  launchExperimentTestApi,
  promoteExperimentApi,
  sourceExperimentSampleLeadsApi,
  updateExperimentApi,
} from "@/lib/client-api";
import type { BrandRecord, ExperimentRecord, OutreachRun, RunViewModel } from "@/lib/factory-types";
import { trackEvent } from "@/lib/telemetry-client";
import FlowEditorClient from "@/app/brands/[id]/campaigns/[campaignId]/build/flows/[variantId]/flow-editor-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const PROSPECT_VALIDATION_TARGET = 20;
const PROSPECT_VALIDATION_MIN_READY = PROSPECT_VALIDATION_TARGET;
const STAGE_COUNT = 4;
const AUTO_SOURCE_MAX_ATTEMPTS = 6;
const AUTO_SOURCE_POLL_ROUNDS = 30;
const AUTO_SOURCE_POLL_INTERVAL_MS = 2000;
const AUTO_SOURCE_STALE_ATTEMPT_LIMIT = 2;
const CSV_MAX_CHARS = 2_000_000;

type StageIndex = 0 | 1 | 2 | 3;
type WorkflowStageStatus = "done" | "current" | "waiting" | "locked" | "active";
type ProspectInputMode = "need_data" | "have_data";
type RejectionSummaryRow = { reason: string; count: number };
type EmailFailureSample = {
  id: string;
  name: string;
  domain: string;
  reason: string;
  error: string;
  topAttemptEmail: string;
  topAttemptVerdict: string;
  topAttemptConfidence: string;
  topAttemptReason: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeReason(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function reasonLabel(reason: string) {
  const key = normalizeReason(reason);
  const labels: Record<string, string> = {
    missing_email_or_domain: "Missing email or usable company domain",
    invalid_email: "Invalid email format",
    free_domain_blocked: "Personal/free email domain blocked",
    free_domain_low_evidence: "Free email with low person evidence",
    role_inbox_blocked: "Role inbox blocked (support@, info@, etc.)",
    role_inbox_low_evidence: "Role inbox with weak person evidence",
    non_person_name: "Name does not look like a person",
    source_domain_mismatch: "Lead domain does not match source profile",
    missing_name: "Missing person name",
    missing_company: "Missing company",
    missing_title: "Missing job title",
    missing_title_for_icp: "Missing title required for ICP",
    excluded_company_keyword: "Company excluded by ICP keyword rules",
    insufficient_person_evidence: "Not enough evidence this is a real person",
    below_confidence_threshold: "Below confidence threshold",
    no_mail_route: "Company domain has no working mail route (MX missing)",
    all_candidates_invalid: "Every generated pattern was invalid",
    only_risky_candidates: "Only risky (accept-all / low-confidence) candidates",
    no_high_confidence_candidate: "No high-confidence candidate found",
    no_attempts: "No email attempts were generated",
    item_error: "Provider returned an item-level error",
    invalid_item_id: "Internal item mapping error",
    verification_unavailable: "Email verification unavailable",
    duplicate_14_day: "Already contacted in last 14 days",
    role_account: "Role account filtered",
    placeholder_domain: "Placeholder/non-real domain filtered",
    policy_rejected: "Rejected by adaptive quality policy",
  };
  return labels[key] ?? key.replaceAll("_", " ");
}

function reasonFix(reason: string) {
  const key = normalizeReason(reason);
  const fixes: Record<string, string> = {
    missing_email_or_domain: "Adjust sourcing query toward profiles with company domains, then rerun email enrichment.",
    invalid_email: "Tighten source quality and require verified work emails.",
    free_domain_blocked: "Keep ICP strict to work domains only.",
    free_domain_low_evidence: "Require title + company evidence before accepting free-domain contacts.",
    role_inbox_blocked: "Target named people (manager/director/VP), not role inboxes.",
    role_inbox_low_evidence: "Add stricter title constraints for named decision makers.",
    non_person_name: "Prioritize sources returning full person names.",
    source_domain_mismatch: "Prefer leads whose source profile domain matches company domain.",
    missing_name: "Use people-category queries and require person-name signals.",
    missing_company: "Require company signals in source + enrichment output.",
    missing_title: "Add title constraints (e.g. demand generation manager, growth lead).",
    missing_title_for_icp: "Update query to include role keywords from your ICP.",
    excluded_company_keyword: "Refine company filters to remove excluded sectors.",
    insufficient_person_evidence: "Require profile URL or explicit title before accepting.",
    below_confidence_threshold: "Narrow role + company constraints for higher-confidence hits.",
    no_mail_route: "Verify the company domain; if MX is missing, no mailbox can validate there.",
    all_candidates_invalid: "No valid pattern passed verification for this contact/domain pair.",
    only_risky_candidates: "Provider found only risky addresses; strict policy rejects these.",
    no_high_confidence_candidate: "No candidate reached strict verification standards.",
    no_attempts: "Name/domain inputs were insufficient to produce candidate addresses.",
    item_error: "Check provider error details and retry this contact.",
    invalid_item_id: "Internal mapping issue; rerun after deploy/check logs.",
    verification_unavailable: "Email verification service failed during this run; retry sourcing.",
    duplicate_14_day: "Already contacted recently; expand target pool or wait cooldown.",
    role_account: "Use person-level contacts instead of generic inboxes.",
    placeholder_domain: "Drop placeholder/test domains at source.",
    policy_rejected: "Review top rejection reasons and refine audience query.",
  };
  return fixes[key] ?? "Refine query and ICP filters, then rerun sourcing.";
}

function parseReasonRows(raw: unknown): RejectionSummaryRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const item = asRecord(row);
      const reason = String(item.reason ?? "").trim();
      const countRaw = Number(item.count ?? 0);
      const count = Number.isFinite(countRaw) ? countRaw : 0;
      return { reason, count };
    })
    .filter((row) => row.reason);
}

function parseSuppressionRows(raw: unknown): RejectionSummaryRow[] {
  const counts = asRecord(raw);
  return Object.entries(counts)
    .map(([reason, countRaw]) => {
      const count = Number(countRaw ?? 0);
      return { reason, count: Number.isFinite(count) ? count : 0 };
    })
    .filter((row) => row.count > 0);
}

function parseEmailFailureSamples(raw: unknown): EmailFailureSample[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const item = asRecord(row);
      return {
        id: String(item.id ?? "").trim(),
        name: String(item.name ?? "").trim(),
        domain: String(item.domain ?? "").trim(),
        reason: String(item.reason ?? "").trim(),
        error: String(item.error ?? "").trim(),
        topAttemptEmail: String(item.topAttemptEmail ?? "").trim(),
        topAttemptVerdict: String(item.topAttemptVerdict ?? "").trim(),
        topAttemptConfidence: String(item.topAttemptConfidence ?? "").trim(),
        topAttemptReason: String(item.topAttemptReason ?? "").trim(),
      } satisfies EmailFailureSample;
    })
    .filter((row) => row.reason || row.error || row.name || row.domain);
}

function mergeReasonRows(rows: RejectionSummaryRow[]) {
  const byReason = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeReason(row.reason);
    byReason.set(key, (byReason.get(key) ?? 0) + Math.max(0, Number(row.count || 0)));
  }
  return Array.from(byReason.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
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

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stageTitle(index: StageIndex) {
  if (index === 0) return "Stage 0 · Setup";
  if (index === 1) return "Stage 1 · Prospects";
  if (index === 2) return "Stage 2 · Messaging";
  return "Stage 3 · Launch";
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
  if (status === "current") return "current";
  if (status === "active") return "live";
  if (status === "locked") return "locked";
  return "waiting";
}

export default function ExperimentClient({
  brandId,
  experimentId,
}: {
  brandId: string;
  experimentId: string;
}) {
  type RefreshSnapshot = {
    brand: BrandRecord | null;
    experiment: ExperimentRecord;
    runView: RunViewModel;
    sourcedLeadCount: number;
    sourcedLeadWithEmailCount: number;
    sourcedLeadWithoutEmailCount: number;
    previewLeadCount: number;
    runsChecked: number;
    sourceExperimentId: string;
  };

  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [experiment, setExperiment] = useState<ExperimentRecord | null>(null);
  const [runView, setRunView] = useState<RunViewModel | null>(null);
  const [sourcingTrace, setSourcingTrace] = useState<Awaited<ReturnType<typeof fetchExperimentSourcingTraceApi>> | null>(null);
  const [sampleLeads, setSampleLeads] = useState<
    Awaited<ReturnType<typeof fetchConversationPreviewLeadsApi>>["leads"]
  >([]);
  const [sampleLeadRunsChecked, setSampleLeadRunsChecked] = useState(0);
  const [sampleLeadSourceExperimentId, setSampleLeadSourceExperimentId] = useState("");
  const [sourcedLeadWithEmailCount, setSourcedLeadWithEmailCount] = useState(0);
  const [sourcedLeadWithoutEmailCount, setSourcedLeadWithoutEmailCount] = useState(0);
  const [sampleLeadError, setSampleLeadError] = useState("");
  const [previewEmailEnrichment, setPreviewEmailEnrichment] = useState<
    Awaited<ReturnType<typeof fetchConversationPreviewLeadsApi>>["previewEmailEnrichment"]
  >({
    attempted: 0,
    matched: 0,
    failed: 0,
    provider: "emailfinder.batch",
    error: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [sampling, setSampling] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState("");
  const [currentStage, setCurrentStage] = useState<StageIndex>(0);
  const [samplingStatus, setSamplingStatus] = useState("");
  const [samplingSummary, setSamplingSummary] = useState("");
  const [samplingAttempt, setSamplingAttempt] = useState(0);
  const [samplingRunsLaunched, setSamplingRunsLaunched] = useState(0);
  const [samplingActiveRunId, setSamplingActiveRunId] = useState("");
  const [samplingHeartbeatAt, setSamplingHeartbeatAt] = useState("");
  const [prospectInputMode, setProspectInputMode] = useState<ProspectInputMode>("need_data");
  const [csvFileName, setCsvFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [importingCsv, setImportingCsv] = useState(false);
  const [csvImportSummary, setCsvImportSummary] = useState("");
  const [csvImportErrors, setCsvImportErrors] = useState<string[]>([]);
  const samplingAbortRef = useRef<AbortController | null>(null);
  const samplingStopRequestedRef = useRef(false);
  const samplingActiveRunIdRef = useRef("");

  const refresh = async (showSpinner = true): Promise<RefreshSnapshot> => {
    if (showSpinner) setLoading(true);
    try {
      const [brandRow, experimentRow, runRow, traceRow] = await Promise.all([
        fetchBrand(brandId),
        fetchExperiment(brandId, experimentId),
        fetchExperimentRunView(brandId, experimentId),
        fetchExperimentSourcingTraceApi(brandId, experimentId),
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
            { limit: 20, maxRuns: 8 }
          );
          setSampleLeadError("");
        } catch (err) {
          setSampleLeadError(err instanceof Error ? err.message : "Failed to load sample leads");
        }
      } else {
        setSampleLeadError("Runtime mapping is missing. Source prospects first to initialize preview leads.");
      }

      setBrand(brandRow);
      setExperiment(experimentRow);
      setRunView(runRow);
      setSourcingTrace(traceRow);
      setSampleLeads(previewLeadsData.leads);
      setSampleLeadRunsChecked(previewLeadsData.runsChecked);
      setSampleLeadSourceExperimentId(previewLeadsData.sourceExperimentId);
      setSourcedLeadWithEmailCount(previewLeadsData.qualifiedLeadWithEmailCount);
      setSourcedLeadWithoutEmailCount(previewLeadsData.qualifiedLeadWithoutEmailCount);
      setPreviewEmailEnrichment(previewLeadsData.previewEmailEnrichment);
      localStorage.setItem("factory.activeBrandId", brandId);

      const sourcedLeadCount = previewLeadsData.qualifiedLeadCount;

      return {
        brand: brandRow,
        experiment: experimentRow,
        runView: runRow,
        sourcedLeadCount,
        sourcedLeadWithEmailCount: previewLeadsData.qualifiedLeadWithEmailCount,
        sourcedLeadWithoutEmailCount: previewLeadsData.qualifiedLeadWithoutEmailCount,
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

  const latestRun = useMemo(() => runView?.runs?.[0] ?? null, [runView]);
  const latestEvents = useMemo(
    () => (latestRun ? runView?.eventsByRun?.[latestRun.id] ?? [] : []),
    [latestRun, runView]
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

  const sourcedLeadCount = useMemo(
    () => sourcedLeadWithEmailCount + sourcedLeadWithoutEmailCount,
    [sourcedLeadWithEmailCount, sourcedLeadWithoutEmailCount]
  );

  const realEmailLeadCount = useMemo(
    () => Math.max(sourcedLeadWithEmailCount, sampleLeads.filter((lead) => Boolean(lead.email?.trim())).length),
    [sampleLeads, sourcedLeadWithEmailCount]
  );

  const prospectsReady = realEmailLeadCount >= PROSPECT_VALIDATION_MIN_READY;
  const invalidLeadCount = sourcedLeadWithoutEmailCount;
  const hasPreviewEmailLookupSignal =
    previewEmailEnrichment.attempted > 0 || Boolean(previewEmailEnrichment.error.trim());
  const messagingReady = Number(experiment?.messageFlow.publishedRevision ?? 0) > 0;
  const setupComplete = setupReady;
  const prospectsUnlocked = setupComplete;
  const prospectsComplete = prospectsUnlocked && prospectsReady;
  const messagingUnlocked = prospectsComplete;
  const messagingComplete = messagingUnlocked && messagingReady;
  const launchUnlocked = messagingComplete;
  const launchComplete = launchUnlocked && latestRun?.status === "completed";
  const launchActive = launchUnlocked && Boolean(latestRun && !isRunTerminal(latestRun.status));
  const highestUnlockedStage = launchUnlocked ? 3 : messagingUnlocked ? 2 : prospectsUnlocked ? 1 : 0;
  const remainingProspectLeads = Math.max(0, PROSPECT_VALIDATION_TARGET - realEmailLeadCount);

  const progressDoneCount =
    (setupComplete ? 1 : 0) +
    (prospectsComplete ? 1 : 0) +
    (messagingComplete ? 1 : 0) +
    (launchComplete ? 1 : 0);
  const progressPercent = Math.round((progressDoneCount / STAGE_COUNT) * 100);

  const latestRunNarrative = useMemo(() => {
    if (!latestRun) {
      return {
        headline: "No launch yet.",
        detail: "Complete Prospects + Messaging, then click Launch Test.",
      };
    }
    const sourced = Number(latestRun.metrics.sourcedLeads ?? 0);
    const sent = Number(latestRun.metrics.sentMessages ?? 0);
    const replies = Number(latestRun.metrics.replies ?? 0);

    if (["failed", "preflight_failed", "canceled"].includes(latestRun.status)) {
      return {
        headline: "Run did not complete successfully.",
        detail: latestRun.lastError || "Check timeline events for root cause.",
      };
    }
    if (latestRun.status === "completed" && sourced > 0 && sent === 0) {
      return {
        headline: "Sourcing completed, but no emails were sent in this run.",
        detail: `Accepted leads: ${sourced}. Click Launch Test to start sending.`,
      };
    }
    if (latestRun.status === "completed" && sent > 0 && replies === 0) {
      return {
        headline: "Emails were sent; no replies yet.",
        detail: `Sent ${sent} messages to ${sourced} sourced leads.`,
      };
    }
    if (latestRun.status === "completed" && sent > 0 && replies > 0) {
      return {
        headline: "Run completed with outbound and replies.",
        detail: `Sent ${sent}, replies ${replies}.`,
      };
    }
    if (["queued", "sourcing", "scheduled", "sending", "monitoring"].includes(latestRun.status)) {
      return {
        headline: "Run is in progress.",
        detail: `Current step: ${latestRun.sourcingTraceSummary?.phase || "processing"}.`,
      };
    }
    return {
      headline: "Run status updated.",
      detail: `Status: ${latestRun.status}.`,
    };
  }, [latestRun]);

  const traceQueryDiagnostics = useMemo(() => {
    const rows = sourcingTrace?.probeResults ?? [];
    return rows
      .map((row) => {
        const details =
          row.details && typeof row.details === "object" && !Array.isArray(row.details)
            ? (row.details as Record<string, unknown>)
            : {};
        const qualityMetrics =
          row.qualityMetrics && typeof row.qualityMetrics === "object" && !Array.isArray(row.qualityMetrics)
            ? (row.qualityMetrics as Record<string, unknown>)
            : {};
        const query = String(details.query ?? qualityMetrics.query ?? "").trim();
        const hitsRaw = Number(details.hits ?? qualityMetrics.hitCount ?? 0);
        const hits = Number.isFinite(hitsRaw) ? hitsRaw : 0;
        return {
          id: row.id,
          stage: row.stage,
          query,
          hits,
          outcome: row.outcome,
        };
      })
      .filter((row) => row.query)
      .slice(0, 10);
  }, [sourcingTrace]);

  const leadRejectionDiagnostics = useMemo(() => {
    const events = sourcingTrace?.runEvents ?? [];
    let rejectionRows: RejectionSummaryRow[] = [];
    let suppressionRows: RejectionSummaryRow[] = [];
    let emailEnrichment: {
      attempted: number;
      matched: number;
      failed: number;
      provider: string;
      error: string;
      failureSummary: RejectionSummaryRow[];
      failedSamples: EmailFailureSample[];
    } | null = null;

    for (const event of events) {
      const payload = asRecord(event.payload);
      if (!rejectionRows.length) {
        const topRejections = parseReasonRows(payload.topRejections);
        const topPolicyRejections = parseReasonRows(payload.topPolicyRejections);
        const merged = mergeReasonRows([...topRejections, ...topPolicyRejections]).slice(0, 8);
        if (merged.length) rejectionRows = merged;
      }
      if (!suppressionRows.length) {
        const parsedSuppression = parseSuppressionRows(payload.suppressionCounts);
        if (parsedSuppression.length) {
          suppressionRows = mergeReasonRows(parsedSuppression).slice(0, 8);
        }
      }
      if (!emailEnrichment) {
        const enrichment = asRecord(payload.emailEnrichment);
        const attemptedRaw = Number(enrichment.attempted ?? 0);
        const matchedRaw = Number(enrichment.matched ?? 0);
        const failedRaw = Number(enrichment.failed ?? 0);
        const attempted = Number.isFinite(attemptedRaw) ? attemptedRaw : 0;
        const matched = Number.isFinite(matchedRaw) ? matchedRaw : 0;
        const failed = Number.isFinite(failedRaw) ? failedRaw : 0;
        const provider = String(enrichment.provider ?? "").trim();
        const error = String(enrichment.error ?? "").trim();
        const failureSummary = mergeReasonRows(parseReasonRows(enrichment.failureSummary)).slice(0, 8);
        const failedSamples = parseEmailFailureSamples(enrichment.failedSamples).slice(0, 8);
        if (attempted > 0 || matched > 0 || failed > 0 || error) {
          emailEnrichment = {
            attempted,
            matched,
            failed,
            provider,
            error,
            failureSummary,
            failedSamples,
          };
        }
      }
      if (rejectionRows.length && suppressionRows.length && emailEnrichment) break;
    }

    return { rejectionRows, suppressionRows, emailEnrichment };
  }, [sourcingTrace]);

  const previewValidLeadCount = useMemo(
    () => sampleLeads.filter((lead) => Boolean(lead.email?.trim())).length,
    [sampleLeads]
  );
  const previewMissingLeadCount = Math.max(0, sampleLeads.length - previewValidLeadCount);
  const hasLeadDiagnostics =
    leadRejectionDiagnostics.rejectionRows.length > 0 ||
    leadRejectionDiagnostics.suppressionRows.length > 0 ||
    Boolean(leadRejectionDiagnostics.emailEnrichment);
  const topRejectionRow = leadRejectionDiagnostics.rejectionRows[0] ?? null;
  const topSuppressionRow = leadRejectionDiagnostics.suppressionRows[0] ?? null;

  const diagnosticsNextStep = useMemo(() => {
    if (topRejectionRow) return reasonFix(topRejectionRow.reason);
    if (topSuppressionRow) return reasonFix(topSuppressionRow.reason);
    if (leadRejectionDiagnostics.emailEnrichment?.error) {
      return "Verification provider returned an error. Retry sourcing to get a fresh verification pass.";
    }
    if (latestRun?.lastError) return latestRun.lastError;
    return "Run Source Prospects, then review top rejection reasons and query quality.";
  }, [leadRejectionDiagnostics.emailEnrichment?.error, latestRun?.lastError, topRejectionRow, topSuppressionRow]);

  const workflowStages = useMemo(
    () =>
      [
        {
          index: 0 as StageIndex,
          label: "0. Setup",
          disabled: false,
          status: setupComplete
            ? ("done" as WorkflowStageStatus)
            : currentStage === 0
              ? ("current" as WorkflowStageStatus)
              : ("waiting" as WorkflowStageStatus),
        },
        {
          index: 1 as StageIndex,
          label: "1. Prospects",
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
          label: "2. Messaging",
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
          label: "3. Launch",
          disabled: !launchUnlocked,
          status: !launchUnlocked
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
      launchUnlocked,
      messagingComplete,
      messagingUnlocked,
      prospectsComplete,
      prospectsUnlocked,
      setupComplete,
    ]
  );

  const nextGateHint = useMemo(() => {
    if (!setupComplete) return "Complete Setup to unlock Prospect sourcing.";
    if (!prospectsComplete) return `Need ${remainingProspectLeads} more verified work emails to unlock Messaging.`;
    if (!messagingComplete) return "Publish a flow revision to unlock Launch.";
    if (!launchComplete) return "Launch is unlocked. Start a run when ready.";
    return "All stages are complete.";
  }, [launchComplete, messagingComplete, prospectsComplete, remainingProspectLeads, setupComplete]);

  useEffect(() => {
    const nextStage = asStageIndex(Math.min(currentStage, highestUnlockedStage));
    if (nextStage !== currentStage) setCurrentStage(nextStage);
  }, [currentStage, highestUnlockedStage]);

  const canGoNext = useMemo(() => {
    if (currentStage === 0) return setupComplete;
    if (currentStage === 1) return prospectsComplete;
    if (currentStage === 2) return messagingComplete;
    return false;
  }, [currentStage, messagingComplete, prospectsComplete, setupComplete]);

  const goNext = () =>
    setCurrentStage((prev) => asStageIndex(Math.min(highestUnlockedStage, prev + 1)));
  const goPrev = () => setCurrentStage((prev) => asStageIndex(prev - 1));

  const stopAutoSource = async () => {
    if (!sampling || !experiment) return;
    samplingStopRequestedRef.current = true;
    samplingAbortRef.current?.abort();
    setSamplingStatus("Stopping auto-source...");
    setSamplingSummary("Stop requested. Finishing current sync and refreshing latest run status.");

    const activeRunId = samplingActiveRunIdRef.current;
    if (!activeRunId) return;
    try {
      await controlExperimentRunApi(
        brandId,
        experiment.id,
        activeRunId,
        "cancel",
        "Stopped from Prospect Gate auto-source control"
      );
    } catch {
      // Ignore cancel errors; final refresh still reflects actual run state.
    }
  };

  const autoSourceProspects = async () => {
    if (!experiment || sampling) return;
    const abortController = new AbortController();
    samplingAbortRef.current = abortController;
    samplingStopRequestedRef.current = false;
    samplingActiveRunIdRef.current = "";
    setSampling(true);
    setError("");
    setSamplingStatus("Starting automatic sourcing...");
    setSamplingSummary("");
    setSamplingAttempt(0);
    setSamplingRunsLaunched(0);
    setSamplingActiveRunId("");
    setSamplingHeartbeatAt(new Date().toISOString());

    const targetLeads = PROSPECT_VALIDATION_TARGET;
    const sampleSize = Math.max(
      targetLeads,
      Math.min(60, Number(experiment.testEnvelope.sampleSize || targetLeads))
    );

    let attempts = 0;
    let bestLeadCount = realEmailLeadCount;
    let staleAttempts = 0;

    try {
      while (attempts < AUTO_SOURCE_MAX_ATTEMPTS && bestLeadCount < targetLeads) {
        if (samplingStopRequestedRef.current || abortController.signal.aborted) {
          setSamplingSummary(
            `Auto-sourcing stopped by user after ${attempts} attempt${attempts === 1 ? "" : "s"}.`
          );
          return;
        }

        attempts += 1;
        setSamplingAttempt(attempts);
        setSamplingStatus(
          `Attempt ${attempts}/${AUTO_SOURCE_MAX_ATTEMPTS}: launching sourcing run...`
        );
        setSamplingHeartbeatAt(new Date().toISOString());

        const launch = await sourceExperimentSampleLeadsApi(
          brandId,
          experiment.id,
          sampleSize,
          { timeoutMs: 25_000, signal: abortController.signal }
        );
        setSamplingRunsLaunched((prev) => prev + 1);
        setSamplingActiveRunId(launch.runId);
        samplingActiveRunIdRef.current = launch.runId;

        let attemptBestCount = bestLeadCount;
        let latestRunStatus: OutreachRun["status"] | null = null;
        let latestRunPhase = "";
        setSamplingStatus(
          `Attempt ${attempts}/${AUTO_SOURCE_MAX_ATTEMPTS}: run ${launch.runId.slice(-6) || "started"} in progress...`
        );
        setSamplingHeartbeatAt(new Date().toISOString());

        for (let poll = 0; poll < AUTO_SOURCE_POLL_ROUNDS; poll += 1) {
          if (samplingStopRequestedRef.current || abortController.signal.aborted) {
            setSamplingSummary(
              `Auto-sourcing stopped by user after ${attempts} attempt${attempts === 1 ? "" : "s"}.`
            );
            return;
          }
          await wait(AUTO_SOURCE_POLL_INTERVAL_MS);
          const snapshot = await refresh(false);
          attemptBestCount = Math.max(attemptBestCount, snapshot.sourcedLeadWithEmailCount);
          latestRunStatus = snapshot.runView.runs[0]?.status ?? null;
          latestRunPhase = snapshot.runView.runs[0]?.sourcingTraceSummary?.phase ?? "";
          setSamplingStatus(
            `Attempt ${attempts}/${AUTO_SOURCE_MAX_ATTEMPTS}: ${attemptBestCount}/${targetLeads} quality leads with real emails (${latestRunPhase || latestRunStatus || "processing"})`
          );
          setSamplingHeartbeatAt(new Date().toISOString());

          if (attemptBestCount >= targetLeads) {
            break;
          }
          if (latestRunStatus && isRunTerminal(latestRunStatus)) {
            break;
          }
        }

        const improvedThisAttempt = attemptBestCount > bestLeadCount;
        bestLeadCount = Math.max(bestLeadCount, attemptBestCount);
        staleAttempts = improvedThisAttempt ? 0 : staleAttempts + 1;

        if (bestLeadCount >= targetLeads) {
          setSamplingSummary(
            `Prospect validation passed automatically: ${bestLeadCount}/${targetLeads} quality leads with real emails.`
          );
          return;
        }

        if (latestRunStatus && !isRunTerminal(latestRunStatus)) {
          setSamplingSummary(
            `Run ${launch.runId.slice(-6) || "active"} is still in progress (${latestRunPhase || latestRunStatus}). Refresh snapshot in 20-30s, or stop and retry.`
          );
          return;
        }

        if (staleAttempts >= AUTO_SOURCE_STALE_ATTEMPT_LIMIT) {
          setSamplingSummary(
            `Stopped after ${attempts} attempts: still ${bestLeadCount}/${targetLeads} leads (no quality increase across the last ${AUTO_SOURCE_STALE_ATTEMPT_LIMIT} attempts).`
          );
          return;
        }

      }

      if (bestLeadCount >= targetLeads) {
        setSamplingSummary(
            `Prospect validation passed automatically: ${bestLeadCount}/${targetLeads} quality leads with real emails.`
        );
      } else {
        setSamplingSummary(
          `Stopped after ${AUTO_SOURCE_MAX_ATTEMPTS} attempts: ${bestLeadCount}/${targetLeads} quality leads with real emails. Check the Sourcing Trace and adjust audience/offer constraints if needed.`
        );
      }
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

  if (loading || !experiment || !runView) {
    return <div className="text-sm text-[color:var(--muted-foreground)]">Loading experiment...</div>;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{brand?.name || "Brand"} · {experiment.name}</CardTitle>
          <CardDescription>
            Stage-based flow: Setup {"->"} Prospects {"->"} Messaging {"->"} Launch.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="muted">Status: {experiment.status}</Badge>
          <Badge variant="muted">Sent: {experiment.metricsSummary.sent}</Badge>
          <Badge variant="muted">Replies: {experiment.metricsSummary.replies}</Badge>
          <Badge variant="muted">Positive: {experiment.metricsSummary.positiveReplies}</Badge>
        </CardContent>
      </Card>

      {error ? <div className="text-sm text-[color:var(--danger)]">{error}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workflow</CardTitle>
          <CardDescription>Only current stage content is shown below.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs">
            <div className="font-medium text-[color:var(--foreground)]">
              {progressDoneCount}/{STAGE_COUNT} stages complete
            </div>
            <div className="text-[color:var(--muted-foreground)]">{progressPercent}% complete</div>
          </div>
          <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs text-[color:var(--muted-foreground)]">
            {nextGateHint}
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            {workflowStages.map((stage) => (
              <button
                key={stage.index}
                type="button"
                disabled={stage.disabled}
                onClick={() => {
                  if (stage.disabled) return;
                  setCurrentStage(stage.index);
                }}
                className={`rounded-lg border p-3 text-left transition ${
                  currentStage === stage.index
                    ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
                    : "border-[color:var(--border)]"
                } ${stage.disabled ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{stage.label}</span>
                  <Badge variant={stageBadgeVariant(stage.status)}>{stageBadgeLabel(stage.status)}</Badge>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {currentStage === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{stageTitle(0)}</CardTitle>
            <CardDescription>Define experiment basics before sourcing prospects.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
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
                  min={1}
                  value={experiment.testEnvelope.sampleSize}
                  onChange={(event) =>
                    setExperiment((prev) =>
                      prev
                        ? {
                            ...prev,
                            testEnvelope: {
                              ...prev.testEnvelope,
                              sampleSize: Math.max(1, Number(event.target.value || 1)),
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
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={saving}
                onClick={async () => {
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
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to save setup");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Setup"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {currentStage === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{stageTitle(1)}</CardTitle>
            <CardDescription>
              Reach {PROSPECT_VALIDATION_TARGET} qualified leads with real work emails to pass this gate.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">Prospect Gate</div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    Only leads with real work emails count.
                  </div>
                </div>
                <Badge variant={prospectsReady ? "success" : "accent"}>
                  {prospectsReady ? "Passed" : "In progress"}
                </Badge>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <div className="text-xs text-[color:var(--muted-foreground)]">Gate requirement</div>
                  <div className="text-sm font-medium">
                    {PROSPECT_VALIDATION_TARGET} verified work emails required
                  </div>
                </div>
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <div className="text-xs text-[color:var(--muted-foreground)]">Current gate outcome</div>
                  <div className="text-sm font-medium">
                    {prospectsReady ? "Messaging unlocked" : `${remainingProspectLeads} more needed`}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <div className="text-xs text-[color:var(--muted-foreground)]">Valid leads</div>
                  <div className={`text-lg font-semibold ${prospectsReady ? "text-[color:var(--success)]" : "text-[color:var(--warning)]"}`}>
                    {realEmailLeadCount}
                  </div>
                </div>
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <div className="text-xs text-[color:var(--muted-foreground)]">Remaining</div>
                  <div className="text-lg font-semibold">{remainingProspectLeads}</div>
                </div>
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <div className="text-xs text-[color:var(--muted-foreground)]">Total candidates</div>
                  <div className="text-lg font-semibold">{sourcedLeadCount}</div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-foreground)]">
                <Badge variant="muted">Preview runs scanned: {sampleLeadRunsChecked}</Badge>
                {sampleLeadSourceExperimentId ? (
                  <Badge variant="muted">Source owner: {sampleLeadSourceExperimentId}</Badge>
                ) : null}
                {samplingAttempt > 0 ? (
                  <Badge variant="muted">
                    Session attempts: {samplingAttempt}/{AUTO_SOURCE_MAX_ATTEMPTS}
                  </Badge>
                ) : null}
                {samplingRunsLaunched > 0 ? (
                  <Badge variant="muted">Runs launched: {samplingRunsLaunched}</Badge>
                ) : null}
              </div>

              {!prospectsReady ? (
                <div className="mt-3 rounded-lg border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-3 py-2 text-sm text-[color:var(--danger)]">
                  Gate blocked. {remainingProspectLeads} more verified work emails needed.
                </div>
              ) : !samplingSummary ? (
                <div className="mt-3 rounded-lg border border-[color:var(--success)]/40 bg-[color:var(--success-soft)] px-3 py-2 text-sm text-[color:var(--success)]">
                  Gate passed. You can move to Messaging.
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Lead Input</div>
              <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-1">
                <div className="grid gap-1 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setProspectInputMode("need_data")}
                    className={`rounded-md px-3 py-2 text-left ${
                      prospectInputMode === "need_data"
                        ? "bg-[color:var(--surface)] shadow-sm"
                        : "bg-transparent"
                    }`}
                  >
                    <div className="text-sm font-medium">Source Automatically</div>
                    <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                      Platform finds and verifies prospects.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setProspectInputMode("have_data")}
                    className={`rounded-md px-3 py-2 text-left ${
                      prospectInputMode === "have_data"
                        ? "bg-[color:var(--surface)] shadow-sm"
                        : "bg-transparent"
                    }`}
                  >
                    <div className="text-sm font-medium">Import CSV</div>
                    <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                      Upload your own leads with identity data.
                    </div>
                  </button>
                </div>
              </div>
              <div className="text-xs text-[color:var(--muted-foreground)]">
                Pick one path first. You can switch at any time.
              </div>
            </div>

            {prospectInputMode === "need_data" ? (
              <div className="space-y-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">Auto-source prospects</div>
                    <div className="text-xs text-[color:var(--muted-foreground)]">
                      Runs repeated attempts until quality target is met or a stop condition is reached.
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={sampling}
                      onClick={() => {
                        void autoSourceProspects();
                      }}
                    >
                      <RefreshCw className={`h-4 w-4 ${sampling ? "animate-spin" : ""}`} />
                      {sampling ? "Auto-sourcing..." : "Source Prospects"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!sampling}
                      onClick={() => {
                        void stopAutoSource();
                      }}
                    >
                      Stop
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void refresh(false);
                      }}
                    >
                      Refresh snapshot
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--muted-foreground)]">
                  If status does not change for 30s, use <strong>Stop</strong>, then rerun.
                  {samplingActiveRunId ? ` Active run: ${samplingActiveRunId.slice(-6)}.` : ""}
                  {samplingHeartbeatAt ? ` Last update: ${formatDate(samplingHeartbeatAt)}.` : ""}
                </div>

                {samplingStatus ? (
                  <div className="rounded-lg border border-[color:var(--accent)]/40 bg-[color:var(--accent-soft)] px-3 py-2 text-sm text-[color:var(--accent)]">
                    {samplingStatus}
                  </div>
                ) : null}

                {samplingSummary ? (
                  <div
                    className={`rounded-lg px-3 py-2 text-sm ${prospectsReady ? "border border-[color:var(--success)]/40 bg-[color:var(--success-soft)] text-[color:var(--success)]" : "border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] text-[color:var(--warning)]"}`}
                  >
                    {samplingSummary}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                <div className="text-sm font-medium">CSV Import</div>
                <div className="text-xs text-[color:var(--muted-foreground)]">
                  Required identity: either <code>email</code>, or <code>name + domain</code>. Optional: <code>company</code>, <code>title</code>, <code>source_url</code>.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      if (!file) {
                        setCsvFileName("");
                        setCsvText("");
                        return;
                      }
                      setCsvFileName(file.name);
                      setCsvImportErrors([]);
                      setCsvImportSummary("");
                      void file
                        .text()
                        .then((text) => {
                          setCsvText(text.slice(0, CSV_MAX_CHARS));
                        })
                        .catch(() => {
                          setCsvText("");
                          setError("Failed to read CSV file");
                        });
                    }}
                    className="max-w-sm"
                  />
                  {csvFileName ? (
                    <Badge variant="muted">{csvFileName}</Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={importingCsv || !csvText.trim()}
                    onClick={async () => {
                      if (!csvText.trim()) return;
                      setImportingCsv(true);
                      setError("");
                      setCsvImportErrors([]);
                      setCsvImportSummary("");
                      try {
                        const result = await importExperimentProspectsCsvApi(
                          brandId,
                          experiment.id,
                          csvText
                        );
                        setCsvImportErrors(result.parseErrors.slice(0, 10));
                        setCsvImportSummary(
                          `Imported ${result.importedCount} leads${result.parseErrorCount ? ` (${result.parseErrorCount} rows skipped)` : ""}.`
                        );
                        await refresh(false);
                        trackEvent("prospects_imported_csv", {
                          brandId,
                          experimentId: experiment.id,
                          runId: result.runId,
                          importedCount: result.importedCount,
                        });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to import CSV leads");
                      } finally {
                        setImportingCsv(false);
                      }
                    }}
                  >
                    <Upload className="h-4 w-4" />
                    {importingCsv ? "Importing..." : "Import CSV Leads"}
                  </Button>
                </div>
                {csvImportSummary ? (
                  <div className="rounded-lg border border-[color:var(--success)]/40 bg-[color:var(--success-soft)] px-3 py-2 text-sm text-[color:var(--success)]">
                    {csvImportSummary}
                  </div>
                ) : null}
                {csvImportErrors.length ? (
                  <div className="rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] px-3 py-2 text-xs text-[color:var(--warning)]">
                    {csvImportErrors.slice(0, 5).join(" · ")}
                  </div>
                ) : null}
              </div>
            )}

            {hasPreviewEmailLookupSignal ? (
              <div
                className={`rounded-lg px-3 py-2 text-sm ${
                  previewEmailEnrichment.error
                    ? "border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] text-[color:var(--warning)]"
                    : "border border-[color:var(--accent)]/40 bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
                }`}
              >
                {previewEmailEnrichment.error ? (
                  previewEmailEnrichment.attempted > 0 ? (
                    <span>
                      Live email lookup ran while loading this page but did not resolve enough real emails:
                      {" "}{previewEmailEnrichment.error}. Leads without emails remain invalid.
                    </span>
                  ) : (
                    <span>
                      Live email lookup could not start while loading this page: {previewEmailEnrichment.error}.
                      Leads without emails remain invalid until lookup succeeds.
                    </span>
                  )
                ) : (
                  <span>
                    Live email lookup ran while loading this page: tried {previewEmailEnrichment.attempted} pending leads,
                    matched {previewEmailEnrichment.matched}, still missing{" "}
                    {Math.max(0, previewEmailEnrichment.attempted - previewEmailEnrichment.matched)}.
                  </span>
                )}
              </div>
            ) : invalidLeadCount > 0 ? (
              <div className="rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] px-3 py-2 text-sm text-[color:var(--warning)]">
                {invalidLeadCount} leads are currently missing a valid work email and do not count yet.
              </div>
            ) : null}

            {sampleLeadError ? <div className="text-sm text-[color:var(--danger)]">{sampleLeadError}</div> : null}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">Current Leads</div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="success">Verified in preview: {previewValidLeadCount}</Badge>
                  <Badge variant="muted">Missing email: {previewMissingLeadCount}</Badge>
                  <span className="text-[color:var(--muted-foreground)]">
                    Preview rows: {sampleLeads.length}/{Math.max(sampleLeads.length, sourcedLeadCount)}
                  </span>
                </div>
              </div>
              {sampleLeads.length ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {sampleLeads.slice(0, 20).map((lead) => (
                    <div key={`${lead.id}:${lead.email}`} className="rounded-lg border border-[color:var(--border)] p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-sm">{lead.name || "(missing name)"}</div>
                        <Badge variant={lead.email ? "success" : "danger"}>
                          {lead.email ? "Valid" : "Invalid"}
                        </Badge>
                      </div>
                      <div className="text-[color:var(--muted-foreground)]">
                        {lead.email || "No real email found yet. This lead does not count."}
                      </div>
                      <div className="text-[color:var(--muted-foreground)]">
                        {lead.title || "Unknown title"} at {lead.company || lead.domain}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-3 py-2 text-sm text-[color:var(--muted-foreground)]">
                  {hasLeadDiagnostics
                    ? "No accepted leads in the latest run. Open Advanced Diagnostics below for rejection and verification details."
                    : "No sample leads yet."}
                </div>
              )}
            </div>

            <details className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-[color:var(--foreground)]">
                <span className="inline-flex items-center gap-2">
                  Advanced Diagnostics
                  {latestRun ? (
                    <Badge variant={runStatusVariant(latestRun.status)}>{latestRun.status}</Badge>
                  ) : null}
                </span>
                <span className="text-xs font-normal text-[color:var(--muted-foreground)]">
                  Quick summary first, technical detail below
                </span>
              </summary>

              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
                  <div className="text-sm font-medium">What to do next</div>
                  <div className="mt-2 grid gap-2 text-xs md:grid-cols-3">
                    <div className="rounded border border-[color:var(--border)] p-2">
                      <div className="text-[color:var(--muted-foreground)]">Top rejection</div>
                      <div className="mt-1 font-medium">
                        {topRejectionRow ? reasonLabel(topRejectionRow.reason) : "No rejection data yet"}
                      </div>
                      {topRejectionRow ? (
                        <div className="text-[color:var(--muted-foreground)]">{topRejectionRow.count} leads</div>
                      ) : null}
                    </div>
                    <div className="rounded border border-[color:var(--border)] p-2">
                      <div className="text-[color:var(--muted-foreground)]">Verifier outcome</div>
                      <div className="mt-1 font-medium">
                        {leadRejectionDiagnostics.emailEnrichment
                          ? `${leadRejectionDiagnostics.emailEnrichment.matched}/${leadRejectionDiagnostics.emailEnrichment.attempted} matched`
                          : "No verifier batch yet"}
                      </div>
                      {leadRejectionDiagnostics.emailEnrichment?.error ? (
                        <div className="text-[color:var(--danger)]">
                          {leadRejectionDiagnostics.emailEnrichment.error}
                        </div>
                      ) : null}
                    </div>
                    <div className="rounded border border-[color:var(--border)] p-2">
                      <div className="text-[color:var(--muted-foreground)]">Run health</div>
                      <div className="mt-1 font-medium">
                        {latestRun ? `Run ${latestRun.id.slice(-6)} · ${latestRun.status}` : "No run yet"}
                      </div>
                      {latestRun?.sourcingTraceSummary?.phase ? (
                        <div className="text-[color:var(--muted-foreground)]">
                          {latestRun.sourcingTraceSummary.phase}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">{diagnosticsNextStep}</div>
                </div>

                <details className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
                  <summary className="cursor-pointer list-none text-sm font-medium text-[color:var(--foreground)]">
                    Rejection Breakdown
                  </summary>
                  {!leadRejectionDiagnostics.rejectionRows.length &&
                  !leadRejectionDiagnostics.suppressionRows.length ? (
                    <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                      No rejection diagnostics yet. Run sourcing to collect policy and suppression signals.
                    </div>
                  ) : (
                    <div className="mt-2 grid gap-3 lg:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-[color:var(--foreground)]">Quality-policy rejections</div>
                        {leadRejectionDiagnostics.rejectionRows.length ? (
                          <div className="space-y-2">
                            {leadRejectionDiagnostics.rejectionRows.map((row) => (
                              <div
                                key={`quality:${row.reason}:${row.count}`}
                                className="rounded-lg border border-[color:var(--border)] p-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-xs font-medium">{reasonLabel(row.reason)}</div>
                                  <Badge variant="muted">{row.count}</Badge>
                                </div>
                                <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                                  {reasonFix(row.reason)}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-[color:var(--muted-foreground)]">
                            No policy-level rejections captured.
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-medium text-[color:var(--foreground)]">Suppression filters</div>
                        {leadRejectionDiagnostics.suppressionRows.length ? (
                          <div className="space-y-2">
                            {leadRejectionDiagnostics.suppressionRows.map((row) => (
                              <div
                                key={`suppression:${row.reason}:${row.count}`}
                                className="rounded-lg border border-[color:var(--border)] p-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-xs font-medium">{reasonLabel(row.reason)}</div>
                                  <Badge variant="muted">{row.count}</Badge>
                                </div>
                                <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                                  {reasonFix(row.reason)}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-[color:var(--muted-foreground)]">
                            No suppression counts recorded yet.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </details>

                <details className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
                  <summary className="cursor-pointer list-none text-sm font-medium text-[color:var(--foreground)]">
                    Email Verifier Details
                  </summary>
                  {leadRejectionDiagnostics.emailEnrichment ? (
                    <div className="mt-2 text-xs">
                      <div className="text-[color:var(--muted-foreground)]">
                        Attempted {leadRejectionDiagnostics.emailEnrichment.attempted} · matched{" "}
                        {leadRejectionDiagnostics.emailEnrichment.matched} · failed{" "}
                        {leadRejectionDiagnostics.emailEnrichment.failed}
                        {leadRejectionDiagnostics.emailEnrichment.provider
                          ? ` · provider ${leadRejectionDiagnostics.emailEnrichment.provider}`
                          : ""}
                      </div>
                      {leadRejectionDiagnostics.emailEnrichment.error ? (
                        <div className="mt-1 text-[color:var(--danger)]">
                          {leadRejectionDiagnostics.emailEnrichment.error}
                        </div>
                      ) : null}
                      {leadRejectionDiagnostics.emailEnrichment.failureSummary.length ? (
                        <div className="mt-2 space-y-1">
                          <div className="font-medium text-[color:var(--foreground)]">Failed reasons</div>
                          {leadRejectionDiagnostics.emailEnrichment.failureSummary.map((row) => (
                            <div
                              key={`email-failure-reason:${row.reason}:${row.count}`}
                              className="flex items-center justify-between gap-2 text-[color:var(--muted-foreground)]"
                            >
                              <span>{reasonLabel(row.reason)}</span>
                              <Badge variant="muted">{row.count}</Badge>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {leadRejectionDiagnostics.emailEnrichment.failedSamples.length ? (
                        <div className="mt-2 space-y-1">
                          <div className="font-medium text-[color:var(--foreground)]">Sample failures</div>
                          {leadRejectionDiagnostics.emailEnrichment.failedSamples.map((row) => (
                            <div
                              key={`email-failure-sample:${row.id}:${row.topAttemptEmail}:${row.domain}`}
                              className="rounded border border-[color:var(--border)] p-2 text-[color:var(--muted-foreground)]"
                            >
                              <div className="text-[color:var(--foreground)]">
                                {row.name || "Unknown"}{row.domain ? ` · ${row.domain}` : ""}
                              </div>
                              <div>
                                {reasonLabel(row.reason)}
                                {row.error ? ` · ${row.error}` : ""}
                              </div>
                              {row.topAttemptEmail ? (
                                <div>
                                  Top attempt: {row.topAttemptEmail}
                                  {row.topAttemptVerdict ? ` (${row.topAttemptVerdict}` : ""}
                                  {row.topAttemptConfidence ? `/${row.topAttemptConfidence}` : ""}
                                  {row.topAttemptVerdict ? ")" : ""}
                                  {row.topAttemptReason ? ` · ${row.topAttemptReason}` : ""}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                      No email enrichment diagnostics yet.
                    </div>
                  )}
                </details>

                <details className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
                  <summary className="cursor-pointer list-none text-sm font-medium text-[color:var(--foreground)]">
                    Run And Sourcing Trace
                  </summary>
                  <div className="mt-2 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                      <div className="text-sm font-medium">Run Status</div>
                      {latestRun ? (
                        <div className="mt-2 space-y-1 text-xs text-[color:var(--muted-foreground)]">
                          <div>
                            Run {latestRun.id.slice(-6)} · {latestRun.status}
                            {latestRun.sourcingTraceSummary?.phase
                              ? ` · ${latestRun.sourcingTraceSummary.phase}`
                              : ""}
                          </div>
                          {latestRun.lastError ? (
                            <div className="text-[color:var(--danger)]">{latestRun.lastError}</div>
                          ) : null}
                          {latestEvents.length ? (
                            <div>Latest event: {latestEvents[0]?.eventType}</div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">
                          No sourcing run yet.
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                      <div className="text-sm font-medium">Sourcing Trace</div>
                      {sourcingTrace?.latestDecision ? (
                        <div className="mt-2 space-y-2 text-xs text-[color:var(--muted-foreground)]">
                          <div>Provider: Exa (no Apify fallback)</div>
                          <div className="rounded-lg border border-[color:var(--border)] p-2">
                            <div className="font-medium text-[color:var(--foreground)]">Selected chain</div>
                            <div className="mt-1 space-y-1">
                              {sourcingTrace.latestDecision.selectedChain.map((step, index) => (
                                <div key={`${step.id}:${step.actorId}:${index}`}>
                                  {index + 1}. {step.stage} {"->"}{" "}
                                  <span className="font-medium text-[color:var(--foreground)]">{step.actorId}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>Budget used: ${Number(sourcingTrace.latestDecision.budgetUsedUsd || 0).toFixed(2)}</div>
                          {traceQueryDiagnostics.length ? (
                            <div className="rounded-lg border border-[color:var(--border)] p-2">
                              <div className="font-medium text-[color:var(--foreground)]">Queries used</div>
                              <div className="mt-1 space-y-1">
                                {traceQueryDiagnostics.map((row) => (
                                  <div key={row.id} className="flex flex-wrap items-center gap-2">
                                    <Badge variant={row.outcome === "pass" ? "success" : "danger"}>
                                      {row.stage}
                                    </Badge>
                                    <span>{row.query}</span>
                                    <span className="text-[color:var(--muted-foreground)]">({row.hits} hits)</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-2 text-xs text-[color:var(--muted-foreground)]">No sourcing decision yet.</div>
                      )}
                    </div>
                  </div>
                </details>
              </div>
            </details>
          </CardContent>
        </Card>
      ) : null}

      {currentStage === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{stageTitle(2)}</CardTitle>
            <CardDescription>Edit and publish the conversation flow before launching.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm">
              {experiment.messageFlow.publishedRevision > 0 ? (
                <span>
                  Published revision <strong>#{experiment.messageFlow.publishedRevision}</strong>
                </span>
              ) : (
                <span className="text-[color:var(--danger)]">No published flow yet.</span>
              )}
            </div>
            {!messagingReady ? (
              <div className="rounded-lg border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-3 py-2 text-sm text-[color:var(--danger)]">
                Publish a flow revision to pass Messaging stage.
              </div>
            ) : (
              <div className="rounded-lg border border-[color:var(--success)]/40 bg-[color:var(--success-soft)] px-3 py-2 text-sm text-[color:var(--success)]">
                Messaging stage passed.
              </div>
            )}
            {experiment.runtime.campaignId && experiment.runtime.experimentId ? (
              <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
                <FlowEditorClient
                  brandId={brandId}
                  campaignId={experiment.runtime.campaignId}
                  variantId={experiment.runtime.experimentId}
                  backHref={`/brands/${brandId}/experiments/${experiment.id}`}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] px-3 py-2 text-sm text-[color:var(--warning)]">
                Flow editor is unavailable until runtime mapping exists. Source prospects once, then reopen Messaging.
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {currentStage === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{stageTitle(3)}</CardTitle>
            <CardDescription>Start outbound sending and monitor run outcomes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={launching || !launchUnlocked}
                onClick={async () => {
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
                    await refresh(false);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to launch test");
                  } finally {
                    setLaunching(false);
                  }
                }}
              >
                <Rocket className="h-4 w-4" />
                {launching ? "Launching..." : "Launch Test"}
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

            {!prospectsReady ? (
              <div className="rounded-lg border border-[color:var(--warning)]/40 bg-[color:var(--warning-soft)] px-3 py-2 text-sm text-[color:var(--warning)]">
                Launch is blocked until Prospect stage has {PROSPECT_VALIDATION_TARGET} quality leads with real work emails.
                Current: {realEmailLeadCount} ({remainingProspectLeads} remaining).
              </div>
            ) : null}

            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-muted)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">{latestRun ? `Run ${latestRun.id.slice(-6)}` : "No run yet"}</div>
                {latestRun ? <Badge variant={runStatusVariant(latestRun.status)}>{latestRun.status}</Badge> : null}
              </div>
              <div className="mt-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs">
                <div className="font-medium text-[color:var(--foreground)]">{latestRunNarrative.headline}</div>
                <div className="mt-1 text-[color:var(--muted-foreground)]">{latestRunNarrative.detail}</div>
              </div>
              {latestRun ? (
                <>
                  <div className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                    Leads {latestRun.metrics.sourcedLeads} · Sent {latestRun.metrics.sentMessages} · Replies {latestRun.metrics.replies} · Positive {latestRun.metrics.positiveReplies}
                  </div>
                  {latestRun.lastError ? (
                    <div className="mt-2 text-sm text-[color:var(--danger)]">Reason: {latestRun.lastError}</div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {canPause(latestRun.status) ? (
                      <Button type="button" variant="outline" onClick={async () => { await controlExperimentRunApi(brandId, experiment.id, latestRun.id, "pause"); await refresh(false); }}>
                        <Pause className="h-4 w-4" /> Pause
                      </Button>
                    ) : null}
                    {canResume(latestRun.status) ? (
                      <Button type="button" variant="outline" onClick={async () => { await controlExperimentRunApi(brandId, experiment.id, latestRun.id, "resume"); await refresh(false); }}>
                        <Play className="h-4 w-4" /> Resume
                      </Button>
                    ) : null}
                    {canCancel(latestRun.status) ? (
                      <Button type="button" variant="outline" onClick={async () => { await controlExperimentRunApi(brandId, experiment.id, latestRun.id, "cancel"); await refresh(false); }}>
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>

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

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4">
          <div className="text-xs text-[color:var(--muted-foreground)]">{stageTitle(currentStage)}</div>
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
    </div>
  );
}
