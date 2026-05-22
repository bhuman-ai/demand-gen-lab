import { EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS } from "@/lib/experiment-policy";

const DEFAULT_ENRICHANYTHING_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_ENRICHANYTHING_PREP_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_ENRICHANYTHING_PREP_MAX_ROWS_PER_RUN = 25;
const MAX_ENRICHANYTHING_PREP_MAX_ROWS_PER_RUN = 100;
const MIN_USEFUL_CAMPAIGN_PREP_RUNTIME_MS = 10_000;
const WARMUP_OPERATIONAL_SENDABLE_LEAD_TARGET = 20;
const WARMUP_HEALTHY_SENDABLE_LEAD_TARGET = 25;
const WARMUP_SURPLUS_SENDABLE_LEAD_TARGET = 50;

export type ScaleCampaignPrepLane = "warmup" | "outbound";

export type ScaleCampaignInventoryHealth =
  | "empty"
  | "usable"
  | "healthy"
  | "surplus"
  | "stale"
  | "insufficient"
  | "ready";

export function resolveEnrichAnythingRequestTimeoutMs(value: unknown = process.env.ENRICHANYTHING_REQUEST_TIMEOUT_MS) {
  const raw = String(value ?? "").trim();
  const parsed = raw ? Math.round(Number(raw)) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ENRICHANYTHING_REQUEST_TIMEOUT_MS;
  }
  return Math.max(2_000, Math.min(30_000, parsed));
}

export function resolveEnrichAnythingPrepRequestTimeoutMs(overrideMs?: unknown) {
  const rawOverride = String(overrideMs ?? "").trim();
  const parsedOverride = rawOverride ? Math.round(Number(rawOverride)) : Number.NaN;
  if (Number.isFinite(parsedOverride)) {
    return Math.max(2_000, Math.min(55_000, parsedOverride));
  }
  return Math.max(
    DEFAULT_ENRICHANYTHING_PREP_REQUEST_TIMEOUT_MS,
    resolveEnrichAnythingRequestTimeoutMs()
  );
}

export function resolveEnrichAnythingPrepMaxRowsPerRun(
  value: unknown = process.env.ENRICHANYTHING_PREP_MAX_ROWS_PER_RUN
) {
  const raw = String(value ?? "").trim();
  const parsed = raw ? Math.trunc(Number(raw)) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ENRICHANYTHING_PREP_MAX_ROWS_PER_RUN;
  }
  return Math.max(1, Math.min(MAX_ENRICHANYTHING_PREP_MAX_ROWS_PER_RUN, parsed));
}

export function resolveEnrichAnythingOperationTimeoutMs(overrideMs?: unknown) {
  const rawOverride = String(overrideMs ?? "").trim();
  const parsedOverride = rawOverride ? Math.round(Number(rawOverride)) : Number.NaN;
  if (Number.isFinite(parsedOverride)) {
    return Math.max(2_000, parsedOverride);
  }
  return resolveEnrichAnythingRequestTimeoutMs();
}

export function buildEnrichAnythingRequestTimeoutMessage(targetUrl: string, overrideMs?: unknown) {
  return `EnrichAnything request to ${targetUrl} timed out after ${resolveEnrichAnythingOperationTimeoutMs(
    overrideMs
  )}ms.`;
}

export function minimumUsefulCampaignPrepRuntimeMs(maxCampaignPrepMs: number) {
  return Math.max(8_000, Math.min(Math.max(1_000, Math.trunc(maxCampaignPrepMs)), MIN_USEFUL_CAMPAIGN_PREP_RUNTIME_MS));
}

export function minimumUnclippedCampaignPrepRuntimeMs(maxCampaignPrepMs: number) {
  return Math.max(5_000, Math.trunc(maxCampaignPrepMs));
}

export function shouldDeferHostManagedEnrichAnythingLiveTopUp(input: {
  allowLiveTopUp?: boolean;
  backgroundMode?: boolean;
  hostManagedWorkspace?: boolean;
  lane?: ScaleCampaignPrepLane;
}) {
  if (input.lane === "warmup") {
    return false;
  }
  return Boolean(input.allowLiveTopUp && input.backgroundMode && input.hostManagedWorkspace);
}

function firstNonEmpty(values: Array<unknown>) {
  for (const value of values) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (normalized) return normalized;
  }
  return "";
}

function summarizeTopReasons(
  items: Array<{ reason: string; count: number }>,
  maxEntries = 3
) {
  return items
    .filter((entry) => String(entry.reason ?? "").trim())
    .slice(0, maxEntries)
    .map((entry) => `${entry.reason} (${entry.count})`)
    .join(", ");
}

export function resolveScaleCampaignPrepLeadTargets(input: {
  lane: ScaleCampaignPrepLane;
  scalePolicy?: { dailyCap?: number } | null;
}) {
  if (input.lane === "warmup") {
    return {
      readyThresholdCount: WARMUP_OPERATIONAL_SENDABLE_LEAD_TARGET,
      targetCount: WARMUP_HEALTHY_SENDABLE_LEAD_TARGET,
    };
  }

  const dailyCap = Math.max(1, Number(input.scalePolicy?.dailyCap ?? 0) || 0);
  const targetCount = Math.max(EXPERIMENT_MIN_VERIFIED_EMAIL_LEADS, Math.min(500, dailyCap * 3));
  return {
    readyThresholdCount: targetCount,
    targetCount,
  };
}

export function isOperationalInventoryReady(input: {
  lane: ScaleCampaignPrepLane;
  sendableLeadCount: number;
  readyThresholdCount: number;
}) {
  if (input.lane === "warmup") {
    return input.sendableLeadCount >= WARMUP_OPERATIONAL_SENDABLE_LEAD_TARGET;
  }
  return input.sendableLeadCount >= input.readyThresholdCount;
}

export function classifyScaleCampaignInventoryHealth(input: {
  lane: ScaleCampaignPrepLane;
  targetCount: number;
  sendableLeadCount: number;
  savedProspectCount?: number;
  queryExhausted?: boolean;
  tableLastStatus?: string;
  tableLastError?: string;
  parseErrorCount?: number;
  qualityRejectionSummary?: Array<{ reason: string; count: number }>;
  failureSummary?: Array<{ reason: string; count: number }>;
}) {
  const sendableLeadCount = Math.max(0, Number(input.sendableLeadCount ?? 0) || 0);
  if (input.lane === "warmup") {
    if (sendableLeadCount > WARMUP_SURPLUS_SENDABLE_LEAD_TARGET) {
      return "surplus" as const;
    }
    if (sendableLeadCount >= WARMUP_HEALTHY_SENDABLE_LEAD_TARGET) {
      return "healthy" as const;
    }
    if (sendableLeadCount > 0) {
      return "usable" as const;
    }
    if (isStaleWarmupInventory(input)) {
      return "stale" as const;
    }
    return "empty" as const;
  }

  if (sendableLeadCount >= Math.max(1, Number(input.targetCount ?? 0) || 0)) {
    return "ready" as const;
  }
  if (sendableLeadCount > 0) {
    return "insufficient" as const;
  }
  return "empty" as const;
}

function isStaleWarmupInventory(input: {
  sendableLeadCount: number;
  savedProspectCount?: number;
  queryExhausted?: boolean;
  tableLastStatus?: string;
  tableLastError?: string;
  parseErrorCount?: number;
  qualityRejectionSummary?: Array<{ reason: string; count: number }>;
  failureSummary?: Array<{ reason: string; count: number }>;
}) {
  if (Math.max(0, Number(input.sendableLeadCount ?? 0) || 0) > 0) {
    return false;
  }

  const tableLastStatus = String(input.tableLastStatus ?? "").trim().toLowerCase();
  const tableLastError = String(input.tableLastError ?? "").trim();
  const hasInventoryArtifacts = Math.max(0, Number(input.savedProspectCount ?? 0) || 0) > 0;
  const hasFailureSignals =
    Boolean(input.queryExhausted) ||
    Math.max(0, Number(input.parseErrorCount ?? 0) || 0) > 0 ||
    (input.qualityRejectionSummary?.length ?? 0) > 0 ||
    (input.failureSummary?.length ?? 0) > 0 ||
    tableLastStatus === "failed" ||
    tableLastStatus === "paused";

  return hasFailureSignals && (hasInventoryArtifacts || Boolean(tableLastError));
}

function prepInventoryProgressSummary(input: {
  lane: ScaleCampaignPrepLane;
  sendableLeadCount: number;
  targetCount: number;
  inventoryLabel: string;
  inventoryHealth: ScaleCampaignInventoryHealth;
}) {
  if (input.lane === "warmup") {
    if (input.inventoryHealth === "surplus") {
      return `${input.inventoryLabel} has ${input.sendableLeadCount} sendable contacts and is above the healthy pool target of ${input.targetCount}.`;
    }
    if (input.inventoryHealth === "healthy") {
      return `${input.inventoryLabel} has ${input.sendableLeadCount} sendable contacts and meets the healthy pool target of ${input.targetCount}.`;
    }
    if (input.inventoryHealth === "usable") {
      return `${input.inventoryLabel} has ${input.sendableLeadCount} sendable contacts. Dispatch can run now while the pool tops back up toward ${input.targetCount}.`;
    }
    if (input.inventoryHealth === "stale") {
      return `${input.inventoryLabel} has cached rows but no sendable contacts.`;
    }
  }
  return `${input.inventoryLabel} has ${input.sendableLeadCount}/${input.targetCount} sendable contacts.`;
}

function isOperationalPrepFailureMessage(message: string) {
  const normalized = String(message ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("timed out") ||
    normalized.includes("too many requests") ||
    normalized.includes("rate limit") ||
    normalized.includes("429") ||
    normalized.includes("temporarily unavailable")
  );
}

function isNeedsSourcingPrepFailureMessage(message: string) {
  const normalized = String(message ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes("no strong matches were returned for that prompt");
}

function appendOperationalPrepFailureContext(baseReason: string, message: string) {
  const normalizedBase = String(baseReason ?? "").replace(/\s+/g, " ").trim();
  const normalizedMessage = String(message ?? "").replace(/\s+/g, " ").trim();
  if (!normalizedBase || !normalizedMessage) return normalizedBase;
  if (!isOperationalPrepFailureMessage(normalizedMessage)) return normalizedBase;
  if (normalizedBase.toLowerCase().includes(normalizedMessage.toLowerCase())) {
    return normalizedBase;
  }
  return `${normalizedBase} Last live top-up failed: ${normalizedMessage}`;
}

export function isDependencyMisconfiguredMessage(message: string) {
  const normalized = String(message ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("enrichanything prospect tables are disabled platform-wide") ||
    normalized.includes("enrichanything_app_url is not configured") ||
    normalized.includes("failed to reach enrichanything") ||
    normalized.includes("failed to load enrichanything prospect table") ||
    normalized.includes("failed to create enrichanything live table") ||
    normalized.includes("failed to update enrichanything prospect table") ||
    normalized.includes("failed to run enrichanything prospect table") ||
    normalized.includes("missing exa api key") ||
    normalized.includes("auth required") ||
    normalized.includes("unauthorized") ||
    normalized.includes("live table not found") ||
    normalized.includes("email finder") ||
    normalized.includes("validatedmails")
  );
}

export function diagnoseScaleCampaignSendablePrep(input: {
  lane: ScaleCampaignPrepLane;
  readyThresholdCount: number;
  targetCount: number;
  tablesEnabled: boolean;
  savedProspectCount: number;
  sendableLeadCount: number;
  queryExhausted: boolean;
  tableLastStatus: string;
  tableLastError: string;
  liveTopUpError: string;
  enrichmentError: string;
  parseErrorCount: number;
  qualityRejectionSummary: Array<{ reason: string; count: number }>;
  failureSummary: Array<{ reason: string; count: number }>;
  inventoryLabel?: string;
  sourcingLabel?: string;
}) {
  const inventoryLabel = String(input.inventoryLabel ?? "").trim() || "Lead inventory";
  const sourcingLabel = String(input.sourcingLabel ?? "").trim() || "prospect tables";
  const ready = isOperationalInventoryReady({
    lane: input.lane,
    sendableLeadCount: input.sendableLeadCount,
    readyThresholdCount: input.readyThresholdCount,
  });
  const inventoryHealth = classifyScaleCampaignInventoryHealth({
    lane: input.lane,
    targetCount: input.targetCount,
    sendableLeadCount: input.sendableLeadCount,
    savedProspectCount: input.savedProspectCount,
    queryExhausted: input.queryExhausted,
    tableLastStatus: input.tableLastStatus,
    tableLastError: input.tableLastError,
    parseErrorCount: input.parseErrorCount,
    qualityRejectionSummary: input.qualityRejectionSummary,
    failureSummary: input.failureSummary,
  });
  if (ready) {
    return {
      blockingState: "ready" as const,
      blockingReason: "",
      blockingHint: "",
      inventoryHealth,
    };
  }
  const hasPartialInventory = input.sendableLeadCount > 0;
  const progressSummary = hasPartialInventory
    ? prepInventoryProgressSummary({
        lane: input.lane,
        sendableLeadCount: input.sendableLeadCount,
        targetCount: input.targetCount,
        inventoryLabel,
        inventoryHealth,
      })
    : "";

  const dependencyMessage = firstNonEmpty([
    !input.tablesEnabled ? "EnrichAnything prospect tables are disabled platform-wide." : "",
    isDependencyMisconfiguredMessage(input.tableLastError) ? input.tableLastError : "",
    isDependencyMisconfiguredMessage(input.liveTopUpError) ? input.liveTopUpError : "",
    isDependencyMisconfiguredMessage(input.enrichmentError) ? input.enrichmentError : "",
  ]);
  if (dependencyMessage) {
    return {
      blockingState: "dependency_misconfigured" as const,
      blockingReason: dependencyMessage,
      blockingHint:
        "Fix the EnrichAnything or email-finder dependency first. This is an environment/config problem, not a sender problem.",
      inventoryHealth,
    };
  }

  const tableFailureMessage =
    String(input.tableLastStatus ?? "").trim().toLowerCase() === "failed"
      ? input.tableLastError
      : "";
  const operationalFailureContext = firstNonEmpty([input.liveTopUpError, input.enrichmentError]);
  const hasStaleNeedsSourcingFailure =
    input.savedProspectCount > 0 && isNeedsSourcingPrepFailureMessage(tableFailureMessage);
  if (tableFailureMessage && !hasStaleNeedsSourcingFailure) {
    return {
      blockingState: "blocked" as const,
      blockingReason: appendOperationalPrepFailureContext(
        hasPartialInventory
          ? `${progressSummary} Prep stopped before the campaign-owned target was reached: ${tableFailureMessage}`
          : tableFailureMessage,
        operationalFailureContext
      ),
      blockingHint:
        "Repair the prospect table run before retrying launch. The table is failing before sendable contacts can be prepared.",
      inventoryHealth,
    };
  }

  if (input.savedProspectCount <= 0) {
    return {
      blockingState: "needs_sourcing" as const,
      blockingReason: `${sourcingLabel} contain no rows yet.`,
      blockingHint:
        `Run or refresh the ${sourcingLabel} first. This campaign should not launch until that inventory has real candidates.`,
      inventoryHealth,
    };
  }

  if (input.lane === "warmup" && inventoryHealth === "stale") {
    return {
      blockingState: "needs_sourcing" as const,
      blockingReason: appendOperationalPrepFailureContext(
        "Warmup inventory is stale: cached rows exist, but they are no longer yielding sendable contacts.",
        operationalFailureContext
      ),
      blockingHint:
        "Refresh the warmup reservoir prompt/state and rerun sourcing so new real-world contacts replace the stale pool.",
      inventoryHealth,
    };
  }

  const rejectionSummary = summarizeTopReasons(input.qualityRejectionSummary);
  if (rejectionSummary) {
    return {
      blockingState: "invalid_inventory" as const,
      blockingReason: appendOperationalPrepFailureContext(
        hasPartialInventory
          ? `${progressSummary} Current prospect table rows are still not sendable enough to reach target. Top rejection reasons: ${rejectionSummary}.`
          : `Current prospect table rows are not sendable. Top rejection reasons: ${rejectionSummary}.`,
        operationalFailureContext
      ),
      blockingHint:
        "Tighten the prompt to company-owned pages and real contacts. Sender campaigns should reject editorial, profile, and unverifiable rows upstream.",
      inventoryHealth,
    };
  }

  const failureSummary = summarizeTopReasons(input.failureSummary);
  if (failureSummary) {
    return {
      blockingState: "invalid_inventory" as const,
      blockingReason: appendOperationalPrepFailureContext(
        hasPartialInventory
          ? `${progressSummary} Current prospect discovery results are still not yielding enough sendable contacts to reach target. Top failure reasons: ${failureSummary}.`
          : `Current prospect discovery results are not yielding sendable contacts. Top failure reasons: ${failureSummary}.`,
        operationalFailureContext
      ),
      blockingHint:
        "Adjust the source table prompt or the email-finder path before retrying launch. The inventory is being discovered, but it is not becoming sendable mail.",
      inventoryHealth,
    };
  }

  if (input.parseErrorCount > 0) {
    return {
      blockingState: "invalid_inventory" as const,
      blockingReason: appendOperationalPrepFailureContext(
        hasPartialInventory
          ? `${progressSummary} ${input.parseErrorCount} rows failed validation before the campaign-owned target was reached.`
          : `Prospect rows were found, but ${input.parseErrorCount} rows failed validation before they became sendable contacts.`,
        operationalFailureContext
      ),
      blockingHint:
        "Clean up the table rows or tighten the discovery prompt so the imported rows already match the sendability rules.",
      inventoryHealth,
    };
  }

  if (input.queryExhausted) {
    return {
      blockingState: "needs_sourcing" as const,
      blockingReason: appendOperationalPrepFailureContext(
        hasPartialInventory
          ? `${progressSummary} Current prospect query is exhausted before the campaign-owned target was reached.`
          : "Current prospect query is exhausted without enough sendable contacts.",
        operationalFailureContext
      ),
      blockingHint:
        "Broaden or revise the table prompt, then rerun sourcing. The current niche slice is not producing enough sendable inventory.",
      inventoryHealth,
    };
  }

  const enrichmentMessage = firstNonEmpty([input.liveTopUpError, input.enrichmentError]);
  if (enrichmentMessage) {
    return {
      blockingState: "blocked" as const,
      blockingReason: hasPartialInventory
        ? `${progressSummary} Prep stopped before the campaign-owned target was reached: ${enrichmentMessage}`
        : enrichmentMessage,
      blockingHint:
        "Resolve the enrichment/import error before retrying launch. The system could not turn the current rows into sendable contacts.",
      inventoryHealth,
    };
  }

  if (hasPartialInventory) {
    return {
      blockingState: "needs_sourcing" as const,
      blockingReason: `${progressSummary} More campaign-owned sourcing is still required before the prep target is met.`,
      blockingHint:
        "Continue sourcing from the campaign-owned prospect table until the dedicated inventory target is met.",
      inventoryHealth,
    };
  }

  if (input.savedProspectCount > 0) {
    return {
      blockingState: "blocked" as const,
      blockingReason:
        "Prospect rows exist, but none are sendable yet because email verification has not produced a safe send candidate.",
      blockingHint:
        "Fix verifier credits/SMTP or reverify the stored leads before enabling outbound. Do not launch from best-guess-only emails.",
      inventoryHealth,
    };
  }

  return {
    blockingState: "blocked" as const,
    blockingReason: "No campaign-owned EnrichAnything-backed sendable leads are available for this sender campaign.",
    blockingHint:
      "Populate the sender-owned campaign prospect table and retry. Sender campaigns no longer borrow shared experiment leads.",
    inventoryHealth,
  };
}
