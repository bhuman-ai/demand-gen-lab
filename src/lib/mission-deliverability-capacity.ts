import { getBrandById } from "@/lib/factory-data";
import { getOutreachAccountFromEmail, getOutreachMailboxEmail } from "@/lib/outreach-account-helpers";
import {
  getOutreachRun,
  getBrandOutreachAssignment,
  listDeliverabilityProbeRuns,
  listDeliverabilitySeedReservations,
  listOutreachAccounts,
  listRunEvents,
  listRunJobs,
  listSenderLaunches,
  setBrandOutreachAssignment,
  type OutreachEvent,
  type OutreachJob,
} from "@/lib/outreach-data";
import {
  getOutreachProvisioningSettings,
  getOutreachProvisioningSettingsSecrets,
} from "@/lib/outreach-provider-settings";
import { getForwardEmailProbeConfig } from "@/lib/forward-email-client";
import {
  provisionSender,
  selectAvailableMailpoolDomain,
  type MailpoolDomainSelection,
} from "@/lib/outreach-provisioning";
import { requestRunDeliverabilityProbe } from "@/lib/outreach-runtime";
import { resolveLlmModel } from "@/lib/llm-router";
import { createMissionAgentDecision, createMissionEvent } from "@/lib/mission-data";
import { inspectMissionDeliverability } from "@/lib/mission-learning";
import { loadBrandSenderLaunchView } from "@/lib/sender-launch";
import type {
  BrandRecord,
  DeliverabilityProbeMonitorResult,
  DeliverabilityProbeRun,
  DeliverabilitySeedReservation,
  OutreachAccount,
  OutreachRun,
  SenderLaunch,
} from "@/lib/factory-types";
import type { Mission, MissionDeliverabilityState, MissionPlan, MissionRiskLevel } from "@/lib/mission-types";

type CapacityResult = {
  mission: Mission;
  deliverabilityState: MissionDeliverabilityState;
};

type MissionDeliverabilityToolName =
  | "inspect_state"
  | "assign_sender"
  | "run_delivery_probe"
  | "provision_mailpool_sender"
  | "wait_for_warmup"
  | "block_for_policy";

type MissionDeliverabilityAgentPlan = {
  toolName: MissionDeliverabilityToolName;
  toolInput: Record<string, unknown>;
  rationale: string;
  expectedOutcome: string;
  riskLevel: MissionRiskLevel;
  model: string;
  raw: Record<string, unknown>;
};

type ProbeTargetKind = "forward_email" | "gmail_mailbox" | "mailbox" | "unknown";

type ProbeSummary = {
  id: string;
  runId: string;
  status: DeliverabilityProbeRun["status"];
  stage: DeliverabilityProbeRun["stage"];
  probeVariant: DeliverabilityProbeRun["probeVariant"];
  placement: string;
  totalMonitors: number;
  counts: Record<string, unknown>;
  summaryText: string;
  lastError: string;
  senderAccountId: string;
  fromEmail: string;
  sourceMessageId: string;
  contentHash: string;
  targetKinds: ProbeTargetKind[];
  monitorEmails: string[];
  results: Array<{
    email: string;
    provider: ProbeTargetKind;
    placement: string;
    archivedAt: string;
    archiveError: string;
    ok: boolean;
    error: string;
  }>;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
  observedAt: string;
  ageHours: number | null;
  fresh: boolean;
};

type SenderProbeMemory = {
  latestForwardEmailPlacement: string;
  latestForwardEmailSummary: string;
  latestForwardEmailAt: string;
  latestGmailPlacement: string;
  latestGmailSummary: string;
  latestGmailAt: string;
  latestProbeStatus: string;
};

type SenderSnapshot = {
  accountId: string;
  name: string;
  provider: OutreachAccount["provider"];
  accountType: OutreachAccount["accountType"];
  status: OutreachAccount["status"];
  fromEmail: string;
  replyToEmail: string;
  domain: string;
  outboundEnabled: boolean;
  deliveryCapable: boolean;
  hasCredentials: boolean;
  lastTestStatus: OutreachAccount["lastTestStatus"];
  assigned: boolean;
  probeMemory: SenderProbeMemory;
  launch: {
    id: string;
    state: SenderLaunch["state"];
    readinessScore: number;
    dailyCap: number;
    summary: string;
    nextStep: string;
    pausedUntil: string;
    pauseReason: string;
  } | null;
};

type MissionDeliverabilitySnapshot = {
  mission: {
    id: string;
    brandId: string;
    status: Mission["status"];
    websiteUrl: string;
    targetCustomerText: string;
    currentRunId: string;
    currentRunStatus: string;
    approvedPlan: MissionPlan;
  };
  currentRun: {
    id: string;
    status: OutreachRun["status"] | "";
    accountId: string;
    lockedSenderAccountId: string;
    pauseReason: string;
    lastError: string;
    metrics: OutreachRun["metrics"] | null;
  };
  brand: {
    id: string;
    name: string;
    website: string;
    product: string;
    targetMarkets: string[];
    idealCustomerProfiles: string[];
  };
  approvalPolicy: Mission["approvalPolicy"];
  deliverabilityState: MissionDeliverabilityState;
  assignment: {
    accountId: string;
    accountIds: string[];
    mailboxAccountId: string;
  };
  senders: SenderSnapshot[];
  senderLaunches: Array<{
    id: string;
    senderAccountId: string;
    fromEmail: string;
    domain: string;
    state: SenderLaunch["state"];
    readinessScore: number;
    dailyCap: number;
    summary: string;
    nextStep: string;
  }>;
  probeMemory: {
    latestForwardEmailProbe: ProbeSummary | null;
    latestGmailProbe: ProbeSummary | null;
    recentProbes: ProbeSummary[];
    activeProbeJobs: Array<{
      id: string;
      status: OutreachJob["status"];
      executeAfter: string;
      attempts: number;
      monitorProvider: string;
      probeVariant: string;
      senderAccountId: string;
      fromEmail: string;
      sourceMessageId: string;
      contentHash: string;
      lastError: string;
    }>;
    recentDeliverabilityEvents: Array<{
      id: string;
      eventType: string;
      createdAt: string;
      reason: string;
      placement: string;
      summaryText: string;
      senderAccountId: string;
      fromEmail: string;
    }>;
  };
  gmailSeeds: {
    approvedEmails: string[];
    approvedCount: number;
    assignedSenderDomain: string;
    usedForAssignedSenderDomain: number;
    remainingForAssignedSenderDomain: number;
    lastUsedForAssignedSenderDomain: string;
  };
  provisioning: {
    provider: "mailpool";
    hasMailpoolApiKey: boolean;
    hasCustomerIoSiteId: boolean;
    hasCustomerIoTrackingKey: boolean;
    hasCustomerIoAppKey: boolean;
    mailpoolWebhookConfigured: boolean;
    deliverabilityProvider: string;
  };
  probes: {
    forwardEmailConfigured: boolean;
    forwardEmailMode: string;
    forwardEmailDomain: string;
    cadenceHours: number;
    preSendGateEnabled: boolean;
  };
  guardrails: {
    canAutoProvisionSender: boolean;
    canAutoBuyDomain: boolean;
    requireApprovalForNewDomainPurchase: boolean;
    maxAutoProvisionedSenders: number;
    maxAutoDomainSpendUsd: number;
    activeProvisioningSenderCount: number;
    allowedToolNames: MissionDeliverabilityToolName[];
  };
};

type ToolExecutionResult = {
  ok: boolean;
  summary: string;
  riskLevel: MissionRiskLevel;
  result: Record<string, unknown>;
};

const TOOL_NAMES: MissionDeliverabilityToolName[] = [
  "inspect_state",
  "assign_sender",
  "run_delivery_probe",
  "provision_mailpool_sender",
  "wait_for_warmup",
  "block_for_policy",
];

function nowIso() {
  return new Date().toISOString();
}

function deliverabilityProbeCadenceHours() {
  const parsed = Number(process.env.DELIVERABILITY_PROBE_REPEAT_HOURS ?? 24);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 24;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asString(entry)).filter(Boolean);
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function emailDomain(email: string) {
  return normalizeDomain(email.split("@")[1] ?? "");
}

function normalizeEmailLocalPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._+-]/g, "")
    .replace(/^\.+|\.+$/g, "");
}

function isValidDomain(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value);
}

function outboundEnabled(account: OutreachAccount) {
  const config = asRecord(account.config);
  const outbound = asRecord(config.outbound);
  return outbound.enabled === false ? false : true;
}

function launchIsActiveCapacity(launch: SenderLaunch) {
  return ["setup", "observing", "warming", "restricted_send", "ready"].includes(launch.state);
}

function roundTenth(value: number) {
  return Math.round(value * 10) / 10;
}

function dateMs(value: string) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function probeObservedAt(probeRun: DeliverabilityProbeRun) {
  return probeRun.completedAt || probeRun.updatedAt || probeRun.createdAt;
}

function probeIsFresh(probeRun: DeliverabilityProbeRun, cadenceHours: number) {
  const observedAt = dateMs(probeObservedAt(probeRun));
  if (!observedAt) return false;
  return Date.now() - observedAt < cadenceHours * 60 * 60 * 1000;
}

function parseDelimitedEmailSet(value: string | undefined) {
  return new Set(
    String(value ?? "")
      .split(/[,\n;]/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry))
  );
}

function probeTargetProviderKind(
  provider: unknown,
  email: string,
  approvedGmailSeedEmails: Set<string>
): ProbeTargetKind {
  const normalizedProvider = asString(provider).toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  const domain = emailDomain(normalizedEmail);
  if (normalizedProvider === "forward_email") return "forward_email";
  if (
    normalizedProvider === "mailbox" &&
    (approvedGmailSeedEmails.has(normalizedEmail) || domain === "gmail.com" || domain === "googlemail.com")
  ) {
    return "gmail_mailbox";
  }
  if (normalizedProvider === "mailbox") return "mailbox";
  return "unknown";
}

function probeTargetKinds(probeRun: DeliverabilityProbeRun, approvedGmailSeedEmails: Set<string>): ProbeTargetKind[] {
  const kinds = new Set<ProbeTargetKind>();
  for (const target of probeRun.monitorTargets) {
    kinds.add(probeTargetProviderKind(target.provider, target.email, approvedGmailSeedEmails));
  }
  for (const result of probeRun.results) {
    kinds.add(probeTargetProviderKind(result.provider, result.email, approvedGmailSeedEmails));
  }
  return kinds.size ? Array.from(kinds) : ["unknown"];
}

function probeResultProviderKind(
  result: DeliverabilityProbeMonitorResult,
  approvedGmailSeedEmails: Set<string>
) {
  return probeTargetProviderKind(result.provider, result.email, approvedGmailSeedEmails);
}

function compactProbeRun(probeRun: DeliverabilityProbeRun, approvedGmailSeedEmails: Set<string>): ProbeSummary {
  const cadenceHours = deliverabilityProbeCadenceHours();
  const observedAt = probeObservedAt(probeRun);
  const observedMs = dateMs(observedAt);
  return {
    id: probeRun.id,
    runId: probeRun.runId,
    status: probeRun.status,
    stage: probeRun.stage,
    probeVariant: probeRun.probeVariant,
    placement: probeRun.placement,
    totalMonitors: probeRun.totalMonitors,
    counts: probeRun.counts,
    summaryText: probeRun.summaryText,
    lastError: probeRun.lastError,
    senderAccountId: probeRun.senderAccountId,
    fromEmail: probeRun.fromEmail,
    sourceMessageId: probeRun.sourceMessageId,
    contentHash: probeRun.contentHash,
    targetKinds: probeTargetKinds(probeRun, approvedGmailSeedEmails),
    monitorEmails: Array.from(
      new Set(
        [...probeRun.monitorTargets.map((target) => target.email), ...probeRun.results.map((result) => result.email)]
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean)
      )
    ),
    results: probeRun.results.map((result) => ({
      email: result.email,
      provider: probeResultProviderKind(result, approvedGmailSeedEmails),
      placement: result.placement,
      archivedAt: result.archivedAt ?? "",
      archiveError: result.archiveError ?? "",
      ok: result.ok,
      error: result.error,
    })),
    createdAt: probeRun.createdAt,
    updatedAt: probeRun.updatedAt,
    completedAt: probeRun.completedAt,
    observedAt,
    ageHours: observedMs ? roundTenth((Date.now() - observedMs) / (60 * 60 * 1000)) : null,
    fresh: probeIsFresh(probeRun, cadenceHours),
  };
}

function compactProbeRuns(probeRuns: DeliverabilityProbeRun[], approvedGmailSeedEmails: Set<string>) {
  return probeRuns
    .map((probeRun) => compactProbeRun(probeRun, approvedGmailSeedEmails))
    .sort((left, right) => dateMs(right.observedAt) - dateMs(left.observedAt));
}

function probeIsBad(probe: ProbeSummary) {
  if (probe.status === "failed") return true;
  return ["spam", "all_mail_only", "not_found", "error"].includes(probe.placement);
}

function probeIsActive(probe: ProbeSummary) {
  return ["queued", "sent", "waiting"].includes(probe.status);
}

function probeIsPassingInbox(probe: ProbeSummary) {
  return probe.status === "completed" && probe.placement === "inbox" && probe.totalMonitors > 0;
}

function probeMatchesSender(probe: ProbeSummary, senderAccountId: string, fromEmail: string) {
  const accountId = senderAccountId.trim();
  const email = fromEmail.trim().toLowerCase();
  if (accountId && probe.senderAccountId === accountId) return true;
  return Boolean(email && probe.fromEmail === email);
}

function latestProbe(probes: ProbeSummary[], predicate: (probe: ProbeSummary) => boolean) {
  return probes.find(predicate) ?? null;
}

function summarizeSenderProbeMemory(
  probes: ProbeSummary[],
  senderAccountId: string,
  fromEmail: string
): SenderProbeMemory {
  const senderProbes = probes.filter((probe) => probeMatchesSender(probe, senderAccountId, fromEmail));
  const latestForwardEmailProbe = latestProbe(senderProbes, (probe) => probe.targetKinds.includes("forward_email"));
  const latestGmailProbe = latestProbe(senderProbes, (probe) =>
    probe.targetKinds.some((kind) => kind === "gmail_mailbox" || kind === "mailbox")
  );
  const latestAnyProbe = senderProbes[0] ?? null;
  return {
    latestForwardEmailPlacement: latestForwardEmailProbe?.placement ?? "",
    latestForwardEmailSummary: latestForwardEmailProbe?.summaryText ?? latestForwardEmailProbe?.lastError ?? "",
    latestForwardEmailAt: latestForwardEmailProbe?.observedAt ?? "",
    latestGmailPlacement: latestGmailProbe?.placement ?? "",
    latestGmailSummary: latestGmailProbe?.summaryText ?? latestGmailProbe?.lastError ?? "",
    latestGmailAt: latestGmailProbe?.observedAt ?? "",
    latestProbeStatus: latestAnyProbe?.status ?? "",
  };
}

function compactProbeJobs(jobs: OutreachJob[]) {
  return jobs
    .filter((job) => job.jobType === "monitor_deliverability" && ["queued", "running"].includes(job.status))
    .map((job) => {
      const payload = asRecord(job.payload);
      return {
        id: job.id,
        status: job.status,
        executeAfter: job.executeAfter,
        attempts: job.attempts,
        monitorProvider: asString(payload.monitorProvider),
        probeVariant: asString(payload.probeVariant),
        senderAccountId: asString(payload.senderAccountId),
        fromEmail: asString(payload.fromEmail).toLowerCase(),
        sourceMessageId: asString(payload.sourceMessageId),
        contentHash: asString(payload.contentHash),
        lastError: job.lastError,
      };
    });
}

function compactDeliverabilityEvents(events: OutreachEvent[]) {
  return events
    .filter((event) => /deliverability|inbox|seed|sender_deliverability|run_paused_auto/i.test(event.eventType))
    .slice(0, 12)
    .map((event) => {
      const payload = asRecord(event.payload);
      return {
        id: event.id,
        eventType: event.eventType,
        createdAt: event.createdAt,
        reason: asString(payload.reason),
        placement: asString(payload.placement),
        summaryText: asString(payload.summaryText),
        senderAccountId: asString(payload.senderAccountId),
        fromEmail: asString(payload.fromEmail).toLowerCase(),
      };
    });
}

function seedWasUsed(reservation: DeliverabilitySeedReservation) {
  return (
    reservation.status === "reserved" ||
    reservation.status === "consumed" ||
    Boolean(reservation.consumedAt || reservation.providerMessageId)
  );
}

function summarizeGmailSeeds(input: {
  approvedGmailSeedEmails: Set<string>;
  assignedSenderDomain: string;
  reservations: DeliverabilitySeedReservation[];
}): MissionDeliverabilitySnapshot["gmailSeeds"] {
  const approvedEmails = Array.from(input.approvedGmailSeedEmails).sort();
  const reservationsForDomain = input.assignedSenderDomain
    ? input.reservations.filter((reservation) => emailDomain(reservation.fromEmail) === input.assignedSenderDomain)
    : [];
  const usedEmails = new Set(
    reservationsForDomain
      .filter(seedWasUsed)
      .map((reservation) => reservation.monitorEmail.trim().toLowerCase())
      .filter(Boolean)
  );
  const lastUsedReservation = reservationsForDomain
    .filter(seedWasUsed)
    .sort(
      (left, right) =>
        dateMs(right.consumedAt || right.reservedAt || right.createdAt) -
        dateMs(left.consumedAt || left.reservedAt || left.createdAt)
    )[0];

  return {
    approvedEmails,
    approvedCount: approvedEmails.length,
    assignedSenderDomain: input.assignedSenderDomain,
    usedForAssignedSenderDomain: usedEmails.size,
    remainingForAssignedSenderDomain: Math.max(0, approvedEmails.filter((email) => !usedEmails.has(email)).length),
    lastUsedForAssignedSenderDomain:
      lastUsedReservation?.consumedAt || lastUsedReservation?.reservedAt || lastUsedReservation?.createdAt || "",
  };
}

function runLooksDeliverabilityPaused(run: OutreachRun | null) {
  if (!run) return false;
  if (run.status === "preflight_failed") return true;
  if (run.status !== "paused") return false;
  return /deliverability|inbox|placement|spam|seed|pre[-_ ]?send|sender|warmup/i.test(
    `${run.pauseReason} ${run.lastError}`
  );
}

function runPauseClearedByFreshProof(run: OutreachRun | null, probes: ProbeSummary[]) {
  if (!run || !runLooksDeliverabilityPaused(run)) return false;
  const pausedAt = dateMs(run.updatedAt);
  if (!pausedAt) return false;
  return probes.some((probe) => probe.fresh && probeIsPassingInbox(probe) && dateMs(probe.observedAt) > pausedAt);
}

function buildEvidenceBackedDeliverabilityState(input: {
  base: MissionDeliverabilityState;
  currentRun: OutreachRun | null;
  assignedSenderAccountIds: string[];
  assignedFromEmails: string[];
  probes: ProbeSummary[];
  activeProbeJobs: ReturnType<typeof compactProbeJobs>;
}): MissionDeliverabilityState {
  const relevantProbes = input.probes.filter((probe) => {
    if (input.assignedSenderAccountIds.includes(probe.senderAccountId)) return true;
    return input.assignedFromEmails.includes(probe.fromEmail);
  });
  const probes = relevantProbes.length ? relevantProbes : input.probes;
  const latestGmailProbe = latestProbe(probes, (probe) =>
    probe.targetKinds.some((kind) => kind === "gmail_mailbox" || kind === "mailbox")
  );
  const latestForwardEmailProbe = latestProbe(probes, (probe) => probe.targetKinds.includes("forward_email"));
  const activeProbe = probes.find(probeIsActive) ?? null;
  const activeJob = input.activeProbeJobs[0] ?? null;

  if (latestGmailProbe?.fresh && probeIsBad(latestGmailProbe)) {
    const summary = `Gmail seed placement failed for ${latestGmailProbe.fromEmail || "the active sender"} (${latestGmailProbe.summaryText || latestGmailProbe.placement || latestGmailProbe.lastError || "no inbox placement"}).`;
    return {
      ...input.base,
      stage: "needs_attention",
      summary,
      primaryBlocker: summary,
      lastCheckedAt: nowIso(),
    };
  }

  if (latestForwardEmailProbe?.fresh && probeIsBad(latestForwardEmailProbe)) {
    const summary = `Forward Email placement failed for ${latestForwardEmailProbe.fromEmail || "the active sender"} (${latestForwardEmailProbe.summaryText || latestForwardEmailProbe.placement || latestForwardEmailProbe.lastError || "no inbox placement"}).`;
    return {
      ...input.base,
      stage: "needs_attention",
      summary,
      primaryBlocker: summary,
      lastCheckedAt: nowIso(),
    };
  }

  if (runLooksDeliverabilityPaused(input.currentRun) && !runPauseClearedByFreshProof(input.currentRun, probes)) {
    const reason = input.currentRun?.pauseReason || input.currentRun?.lastError || "The current run is paused by deliverability evidence.";
    return {
      ...input.base,
      stage: "needs_attention",
      summary: reason,
      primaryBlocker: reason,
      lastCheckedAt: nowIso(),
    };
  }

  if (activeProbe || activeJob) {
    const summary = activeProbe
      ? `Waiting for inbox placement probe ${activeProbe.id} to complete.`
      : `Waiting for inbox placement job ${activeJob?.id ?? ""} to complete.`;
    return {
      ...input.base,
      stage: "testing_inbox_placement",
      summary,
      primaryBlocker: summary,
      lastCheckedAt: nowIso(),
    };
  }

  return input.base;
}

function compactBrand(brand: BrandRecord | null, mission: Mission): MissionDeliverabilitySnapshot["brand"] {
  return {
    id: brand?.id ?? mission.brandId,
    name: brand?.name ?? "Brand",
    website: brand?.website || mission.websiteUrl,
    product: brand?.product ?? "",
    targetMarkets: brand?.targetMarkets ?? [],
    idealCustomerProfiles: brand?.idealCustomerProfiles ?? [],
  };
}

function extractResponseText(payload: unknown) {
  const row = asRecord(payload);
  if (typeof row.output_text === "string") return row.output_text;
  const output = Array.isArray(row.output) ? row.output : [];
  for (const item of output) {
    const content = asRecord(item).content;
    if (!Array.isArray(content)) continue;
    for (const contentItem of content) {
      const text = asRecord(contentItem).text;
      if (typeof text === "string") return text;
    }
  }
  return "";
}

function riskForTool(toolName: MissionDeliverabilityToolName): MissionRiskLevel {
  if (toolName === "assign_sender" || toolName === "provision_mailpool_sender" || toolName === "run_delivery_probe") return "guarded_write";
  if (toolName === "block_for_policy") return "blocked";
  return "read";
}

function allowedToolNames(snapshot: MissionDeliverabilitySnapshot): MissionDeliverabilityToolName[] {
  const names: MissionDeliverabilityToolName[] = ["inspect_state", "wait_for_warmup", "block_for_policy"];
  if (snapshot.senders.some((sender) => sender.status === "active" && sender.fromEmail && sender.deliveryCapable)) {
    names.push("assign_sender");
  }
  if (
    snapshot.probes.forwardEmailConfigured &&
    snapshot.mission.currentRunId &&
    snapshot.senders.some((sender) => sender.status === "active" && sender.fromEmail && sender.assigned)
  ) {
    names.push("run_delivery_probe");
  }
  if (
    snapshot.guardrails.canAutoProvisionSender &&
    snapshot.guardrails.canAutoBuyDomain &&
    snapshot.guardrails.activeProvisioningSenderCount < snapshot.guardrails.maxAutoProvisionedSenders &&
    snapshot.provisioning.hasMailpoolApiKey
  ) {
    names.push("provision_mailpool_sender");
  }
  return names;
}

function summarizeSender(
  account: OutreachAccount,
  launch: SenderLaunch | null,
  assignedAccountIds: string[],
  probes: ProbeSummary[]
): SenderSnapshot {
  const fromEmail = getOutreachAccountFromEmail(account).toLowerCase();
  const replyToEmail = getOutreachMailboxEmail(account).toLowerCase() || account.config.customerIo.replyToEmail.toLowerCase();
  return {
    accountId: account.id,
    name: account.name,
    provider: account.provider,
    accountType: account.accountType,
    status: account.status,
    fromEmail,
    replyToEmail,
    domain: emailDomain(fromEmail),
    outboundEnabled: outboundEnabled(account),
    deliveryCapable: account.accountType !== "mailbox" && outboundEnabled(account) && account.hasCredentials,
    hasCredentials: account.hasCredentials,
    lastTestStatus: account.lastTestStatus,
    assigned: assignedAccountIds.includes(account.id),
    probeMemory: summarizeSenderProbeMemory(probes, account.id, fromEmail),
    launch: launch
      ? {
          id: launch.id,
          state: launch.state,
          readinessScore: launch.readinessScore,
          dailyCap: launch.dailyCap,
          summary: launch.summary,
          nextStep: launch.nextStep,
          pausedUntil: launch.pausedUntil,
          pauseReason: launch.pauseReason,
        }
      : null,
  };
}

async function buildMissionDeliverabilitySnapshot(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
}): Promise<MissionDeliverabilitySnapshot> {
  await loadBrandSenderLaunchView(input.mission.brandId).catch(() => null);

  const [brand, assignment, accounts, launches, settings, secrets, deliverabilityState, currentRun] = await Promise.all([
    getBrandById(input.mission.brandId, { includeEmbedded: true }).catch(() => null),
    getBrandOutreachAssignment(input.mission.brandId).catch(() => null),
    listOutreachAccounts().catch(() => []),
    listSenderLaunches({ brandId: input.mission.brandId }, { allowMissingTable: true }).catch(() => []),
    getOutreachProvisioningSettings(),
    getOutreachProvisioningSettingsSecrets(),
    inspectMissionDeliverability(input.mission.brandId),
    input.mission.currentRunId ? getOutreachRun(input.mission.currentRunId).catch(() => null) : Promise.resolve(null),
  ]);

  const assignedAccountIds = assignment?.accountIds?.length
    ? assignment.accountIds
    : assignment?.accountId
      ? [assignment.accountId]
      : [];
  const currentRunId = input.mission.currentRunId.trim();
  const approvedGmailSeedEmails = parseDelimitedEmailSet(process.env.GMAIL_DELIVERABILITY_MONITOR_EMAILS);
  const [probeRuns, runEvents, runJobs, seedReservations] = await Promise.all([
    listDeliverabilityProbeRuns({
      brandId: input.mission.brandId,
      runId: currentRunId || undefined,
      statuses: ["queued", "sent", "waiting", "completed", "failed"],
      limit: 75,
    }).catch(() => []),
    currentRunId ? listRunEvents(currentRunId).catch(() => []) : Promise.resolve([]),
    currentRunId ? listRunJobs(currentRunId, 75).catch(() => []) : Promise.resolve([]),
    listDeliverabilitySeedReservations({ brandId: input.mission.brandId }).catch(() => []),
  ]);
  const probes = compactProbeRuns(probeRuns, approvedGmailSeedEmails);
  const activeProbeJobs = compactProbeJobs(runJobs);
  const launchByAccountId = new Map(launches.map((launch) => [launch.senderAccountId, launch] as const));
  const launchByEmail = new Map(launches.map((launch) => [launch.fromEmail.toLowerCase(), launch] as const));
  const senders = accounts
    .filter((account) => account.status === "active" || assignedAccountIds.includes(account.id))
    .map((account) => {
      const fromEmail = getOutreachAccountFromEmail(account).toLowerCase();
      return summarizeSender(
        account,
        launchByAccountId.get(account.id) ?? launchByEmail.get(fromEmail) ?? null,
        assignedAccountIds,
        probes
      );
    })
    .filter((sender) => sender.fromEmail || sender.assigned || sender.launch);
  const assignedFromEmails = senders
    .filter((sender) => sender.assigned)
    .map((sender) => sender.fromEmail)
    .filter(Boolean);
  const firstRelevantProbeFromEmail =
    probes.find((probe) => assignedAccountIds.includes(probe.senderAccountId) || assignedFromEmails.includes(probe.fromEmail))
      ?.fromEmail ?? probes[0]?.fromEmail ?? "";
  const assignedSenderDomain = emailDomain(assignedFromEmails[0] || firstRelevantProbeFromEmail);
  const evidenceBackedDeliverabilityState = buildEvidenceBackedDeliverabilityState({
    base: deliverabilityState,
    currentRun,
    assignedSenderAccountIds: assignedAccountIds,
    assignedFromEmails,
    probes,
    activeProbeJobs,
  });
  const activeProvisioningSenderCount = launches.filter(launchIsActiveCapacity).length;
  const forwardEmailProbeConfig = getForwardEmailProbeConfig();
  const guardrailsWithoutAllowed = {
    canAutoProvisionSender:
      input.mission.approvalPolicy.allowAutoProvisioning &&
      input.approvedPlan.deliverabilityPlan.autoProvisioning !== false,
    canAutoBuyDomain:
      input.mission.approvalPolicy.allowAutoDomainPurchase &&
      !input.mission.approvalPolicy.requireApprovalForNewDomainPurchase,
    requireApprovalForNewDomainPurchase: input.mission.approvalPolicy.requireApprovalForNewDomainPurchase,
    maxAutoProvisionedSenders: Math.max(0, input.mission.approvalPolicy.maxAutoProvisionedSenders),
    maxAutoDomainSpendUsd: Math.max(0, input.mission.approvalPolicy.maxAutoDomainSpendUsd),
    activeProvisioningSenderCount,
    allowedToolNames: [] as MissionDeliverabilityToolName[],
  };
  const snapshot: MissionDeliverabilitySnapshot = {
    mission: {
      id: input.mission.id,
      brandId: input.mission.brandId,
      status: input.mission.status,
      websiteUrl: input.mission.websiteUrl,
      targetCustomerText: input.mission.targetCustomerText,
      currentRunId: input.mission.currentRunId,
      currentRunStatus: currentRun?.status ?? "",
      approvedPlan: input.approvedPlan,
    },
    currentRun: {
      id: currentRun?.id ?? "",
      status: currentRun?.status ?? "",
      accountId: currentRun?.accountId ?? "",
      lockedSenderAccountId: currentRun?.lockedSenderAccountId ?? "",
      pauseReason: currentRun?.pauseReason ?? "",
      lastError: currentRun?.lastError ?? "",
      metrics: currentRun?.metrics ?? null,
    },
    brand: compactBrand(brand, input.mission),
    approvalPolicy: input.mission.approvalPolicy,
    deliverabilityState: evidenceBackedDeliverabilityState,
    assignment: {
      accountId: assignment?.accountId ?? "",
      accountIds: assignedAccountIds,
      mailboxAccountId: assignment?.mailboxAccountId ?? "",
    },
    senders,
    senderLaunches: launches.map((launch) => ({
      id: launch.id,
      senderAccountId: launch.senderAccountId,
      fromEmail: launch.fromEmail,
      domain: launch.domain,
      state: launch.state,
      readinessScore: launch.readinessScore,
      dailyCap: launch.dailyCap,
      summary: launch.summary,
      nextStep: launch.nextStep,
    })),
    probeMemory: {
      latestForwardEmailProbe: latestProbe(probes, (probe) => probe.targetKinds.includes("forward_email")),
      latestGmailProbe: latestProbe(probes, (probe) =>
        probe.targetKinds.some((kind) => kind === "gmail_mailbox" || kind === "mailbox")
      ),
      recentProbes: probes.slice(0, 20),
      activeProbeJobs,
      recentDeliverabilityEvents: compactDeliverabilityEvents(runEvents),
    },
    gmailSeeds: summarizeGmailSeeds({
      approvedGmailSeedEmails,
      assignedSenderDomain,
      reservations: seedReservations,
    }),
    provisioning: {
      provider: "mailpool",
      hasMailpoolApiKey: Boolean(secrets.mailpoolApiKey),
      hasCustomerIoSiteId: Boolean(settings.customerIo.siteId),
      hasCustomerIoTrackingKey: Boolean(secrets.customerIoTrackingApiKey),
      hasCustomerIoAppKey: Boolean(secrets.customerIoAppApiKey),
      mailpoolWebhookConfigured: Boolean(settings.mailpool.webhookUrl && secrets.mailpoolWebhookSecret),
      deliverabilityProvider: settings.deliverability.provider,
    },
    probes: {
      forwardEmailConfigured: Boolean(forwardEmailProbeConfig),
      forwardEmailMode: forwardEmailProbeConfig?.mode ?? "",
      forwardEmailDomain: forwardEmailProbeConfig?.domain ?? "",
      cadenceHours: deliverabilityProbeCadenceHours(),
      preSendGateEnabled:
        String(process.env.DELIVERABILITY_PRE_SEND_GATE ?? "true").trim().toLowerCase() !== "false",
    },
    guardrails: guardrailsWithoutAllowed,
  };
  snapshot.guardrails.allowedToolNames = allowedToolNames(snapshot);
  return snapshot;
}

function buildToolCatalog() {
  return [
    {
      name: "inspect_state",
      riskLevel: "read",
      description: "Refresh and record the current mission deliverability state without changing sender assignments.",
      input: {},
    },
    {
      name: "assign_sender",
      riskLevel: "guarded_write",
      description: "Assign an exact existing active delivery-capable sender account to the mission. The AI must choose accountId from snapshot.senders where deliveryCapable is true; never choose mailbox-only accounts.",
      input: { accountId: "existing active delivery-capable sender account id", reason: "why this sender is the right next move" },
    },
    {
      name: "run_delivery_probe",
      riskLevel: "guarded_write",
      description:
        "Queue a fresh Forward Email inbox placement probe for the current run. If campaign messages exist, probe production and baseline content; otherwise probe a neutral baseline message for sender warmup. Use this when sender readiness is uncertain, a daily proof is due, new messaging exists, or delivery proof should be gathered before continuing.",
      input: {
        senderAccountId: "optional assigned active sender account id; omit to use the current run sender",
        reason: "why this probe is needed now",
      },
    },
    {
      name: "provision_mailpool_sender",
      riskLevel: "guarded_write",
      description:
        "Buy/register an exact AI-selected Mailpool domain, create an inbox, assign it to the brand, and wait for readiness. Requires auto provisioning and auto domain purchase policy.",
      input: {
        domain: "exact domain selected by AI, no placeholders",
        fromLocalPart: "exact mailbox local part selected by AI, for example founder or growth",
        domainCandidates: "optional AI-ordered array of alternate exact domains to try if the first is unavailable",
        accountName: "optional display name",
        reason: "why this new sender/domain is the right next move",
      },
    },
    {
      name: "wait_for_warmup",
      riskLevel: "read",
      description: "Keep the mission blocked while existing sender warmup, inbox placement, DNS, or provider setup continues.",
      input: { reason: "what the operator is waiting for", nextCheck: "what should be checked on the next tick" },
    },
    {
      name: "block_for_policy",
      riskLevel: "blocked",
      description: "Record that the AI wants to act, but policy, credentials, budget, or safety prevents the action.",
      input: { reason: "specific blocker", desiredAction: "what the AI would do if permitted" },
    },
  ];
}

function buildMissionOperatorPrompt(snapshot: MissionDeliverabilitySnapshot) {
  return [
    "You are the LastB2B mission deliverability operator.",
    "You are the decision-maker. The code will not pick a sender, domain, mailbox name, provider path, or next move for you.",
    "Choose exactly one tool from the tool catalog. If you choose a write tool, provide exact IDs/domains/local parts.",
    "You may create new sender capacity when guardrails allow it. You may request fresh Forward Email inbox placement probes; when no campaign message exists, the probe tool will send a neutral baseline warmup test. You may also wait, inspect, or block if that is the correct move.",
    "Operating policy: Forward Email is the cheap first gate. Gmail/mailbox seed placement is the expensive confirmation only after Forward Email inboxes and an approved unused Gmail seed is available for this sender domain.",
    "Do not burn Gmail seed capacity when Forward Email has not inboxed. Do not request another Gmail-style confirmation when probeMemory already shows a fresh active or completed Gmail/mailbox probe for the same sender/content.",
    "If Gmail/mailbox placement is spam, all_mail_only, not_found, or failed, do not treat the sender as ready even if Forward Email passed. Prefer a healthier sender, wait for warmup/cooldown, or provision capacity if policy allows.",
    "Approved Gmail seed usage is shown in gmailSeeds. Inbox cleanup/archiving for approved Gmail seed inbox hits happens automatically after placement inspection; do not ask the user to clean mailboxes.",
    "Hard guardrails are not optional: no sending before deliverability is ready, no domain purchase unless policy allows it, no provisioning above capacity, no spending above maxAutoDomainSpendUsd, and no invented account IDs.",
    "Do not output a generic plan. Select the next concrete tool call for this mission tick.",
    "Keep rationale, expectedOutcome, and toolInputJson concise.",
    "Return only JSON matching the schema. Put tool arguments in toolInputJson as a JSON object encoded in a string.",
    "",
    `Tool catalog JSON:\n${JSON.stringify(buildToolCatalog())}`,
    "",
    `Mission state JSON:\n${JSON.stringify(snapshot)}`,
  ].join("\n");
}

function normalizeToolName(value: unknown): MissionDeliverabilityToolName {
  const toolName = asString(value) as MissionDeliverabilityToolName;
  return TOOL_NAMES.includes(toolName) ? toolName : "block_for_policy";
}

function normalizeAgentPlan(
  value: unknown,
  model: string,
  fallback: { toolName: MissionDeliverabilityToolName; rationale: string; toolInput?: Record<string, unknown> }
): MissionDeliverabilityAgentPlan {
  const row = asRecord(value);
  let toolInput = asRecord(row.toolInput);
  const toolInputJson = asString(row.toolInputJson);
  if (toolInputJson) {
    try {
      toolInput = asRecord(JSON.parse(toolInputJson));
    } catch {
      toolInput = {};
    }
  }
  const toolName = normalizeToolName(row.toolName || fallback.toolName);
  const usedFallback = !TOOL_NAMES.includes(asString(row.toolName) as MissionDeliverabilityToolName);
  return {
    toolName,
    toolInput: usedFallback ? (fallback.toolInput ?? {}) : toolInput,
    rationale: asString(row.rationale) || fallback.rationale,
    expectedOutcome: asString(row.expectedOutcome),
    riskLevel: riskForTool(toolName),
    model,
    raw: row,
  };
}

async function planMissionDeliverabilityAction(snapshot: MissionDeliverabilitySnapshot): Promise<MissionDeliverabilityAgentPlan> {
  const apiKey = asString(process.env.OPENAI_API_KEY);
  const model = resolveLlmModel("mission_operator", {
    input: snapshot,
    overrideModel: asString(process.env.OPENAI_MODEL_MISSION_OPERATOR),
  });

  if (!apiKey) {
    return normalizeAgentPlan(
      {},
      "mission-operator-unavailable",
      {
        toolName: "block_for_policy",
        rationale: "OPENAI_API_KEY is missing, so the AI deliverability operator cannot choose a tool.",
        toolInput: { reason: "OPENAI_API_KEY is missing.", desiredAction: "Run the AI mission deliverability operator." },
      }
    );
  }

  const prompt = buildMissionOperatorPrompt(snapshot);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      reasoning: { effort: asString(process.env.OPENAI_MISSION_REASONING_EFFORT) || "high" },
      text: {
        format: {
          type: "json_schema",
          name: "mission_deliverability_tool_choice",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              toolName: { type: "string", enum: TOOL_NAMES },
              rationale: { type: "string", maxLength: 500 },
              expectedOutcome: { type: "string", maxLength: 300 },
              toolInputJson: { type: "string", maxLength: 900 },
            },
            required: ["toolName", "rationale", "expectedOutcome", "toolInputJson"],
          },
        },
      },
      max_output_tokens: 2200,
      store: false,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    return normalizeAgentPlan(
      {},
      model,
      {
        toolName: "block_for_policy",
        rationale: `Mission deliverability AI request failed with HTTP ${response.status}.`,
        toolInput: { reason: raw.slice(0, 500), desiredAction: "Retry AI mission deliverability operator." },
      }
    );
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }

  let parsed: unknown = {};
  try {
    parsed = JSON.parse(extractResponseText(payload));
  } catch {
    return normalizeAgentPlan(
      {},
      model,
      {
        toolName: "block_for_policy",
        rationale: "Mission deliverability AI returned invalid JSON.",
        toolInput: { reason: extractResponseText(payload).slice(0, 500), desiredAction: "Retry AI mission deliverability operator." },
      }
    );
  }

  return normalizeAgentPlan(parsed, model, {
    toolName: "block_for_policy",
    rationale: "Mission deliverability AI did not choose a valid tool.",
    toolInput: { reason: "Invalid tool choice.", desiredAction: "Retry AI mission deliverability operator." },
  });
}

async function selectAiChosenAvailableDomain(input: {
  mailpoolApiKey: string;
  domain: string;
  domainCandidates: string[];
}) {
  const checkedDomains: string[] = [];
  const orderedDomains = Array.from(new Set([input.domain, ...input.domainCandidates].map(normalizeDomain).filter(isValidDomain)));
  for (const domain of orderedDomains) {
    const selection = await selectAvailableMailpoolDomain({
      preferredDomain: domain,
      domainCandidates: [],
      allowAlternativeDomains: false,
      mailpoolApiKey: input.mailpoolApiKey,
    });
    checkedDomains.push(...selection.checkedDomains.filter((entry) => !checkedDomains.includes(entry)));
    if (selection.available) return { selection, checkedDomains };
  }
  return { selection: null as MailpoolDomainSelection | null, checkedDomains };
}

async function executeAssignSender(input: {
  mission: Mission;
  plan: MissionDeliverabilityAgentPlan;
}): Promise<ToolExecutionResult> {
  const accountId = asString(input.plan.toolInput.accountId);
  const accounts = await listOutreachAccounts();
  const account = accounts.find((row) => row.id === accountId) ?? null;
  if (!account) {
    return {
      ok: false,
      summary: "AI selected a sender account that does not exist.",
      riskLevel: "blocked",
      result: { accountId },
    };
  }
  const fromEmail = getOutreachAccountFromEmail(account).toLowerCase();
  if (account.status !== "active" || !fromEmail) {
    return {
      ok: false,
      summary: "AI selected a sender account that is not active or has no from email.",
      riskLevel: "blocked",
      result: { accountId, status: account.status, fromEmail },
    };
  }
  if (account.accountType === "mailbox" || !outboundEnabled(account) || !account.hasCredentials) {
    return {
      ok: false,
      summary: "AI selected an account that is not delivery-capable.",
      riskLevel: "blocked",
      result: {
        accountId,
        accountType: account.accountType,
        outboundEnabled: outboundEnabled(account),
        hasCredentials: account.hasCredentials,
      },
    };
  }

  const assignment = await setBrandOutreachAssignment(input.mission.brandId, {
    accountId: account.id,
    accountIds: [account.id],
    mailboxAccountId: account.id,
  });
  await createMissionEvent({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    eventType: "ai_sender_assigned",
    summary: `AI operator assigned ${fromEmail} as the mission sender.`,
    payload: {
      accountId: account.id,
      fromEmail,
      reason: asString(input.plan.toolInput.reason) || input.plan.rationale,
    },
  });

  return {
    ok: true,
    summary: `Assigned ${fromEmail} as the mission sender.`,
    riskLevel: "guarded_write",
    result: { assignment, accountId: account.id, fromEmail },
  };
}

async function executeProvisionMailpoolSender(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
  snapshot: MissionDeliverabilitySnapshot;
  plan: MissionDeliverabilityAgentPlan;
}): Promise<ToolExecutionResult> {
  const policy = input.mission.approvalPolicy;
  if (!policy.allowAutoProvisioning || input.approvedPlan.deliverabilityPlan.autoProvisioning === false) {
    return {
      ok: false,
      summary: "Auto provisioning is not allowed for this mission.",
      riskLevel: "blocked",
      result: { approvalPolicy: policy },
    };
  }
  if (!policy.allowAutoDomainPurchase || policy.requireApprovalForNewDomainPurchase) {
    return {
      ok: false,
      summary: "Auto domain purchase is not allowed for this mission.",
      riskLevel: "blocked",
      result: { approvalPolicy: policy },
    };
  }
  if (input.snapshot.guardrails.activeProvisioningSenderCount >= policy.maxAutoProvisionedSenders) {
    return {
      ok: false,
      summary: "Mission already has the maximum auto-provisioned sender capacity in flight.",
      riskLevel: "blocked",
      result: {
        activeProvisioningSenderCount: input.snapshot.guardrails.activeProvisioningSenderCount,
        maxAutoProvisionedSenders: policy.maxAutoProvisionedSenders,
      },
    };
  }

  const domain = normalizeDomain(asString(input.plan.toolInput.domain));
  const fromLocalPart = normalizeEmailLocalPart(asString(input.plan.toolInput.fromLocalPart));
  const domainCandidates = asStringArray(input.plan.toolInput.domainCandidates).map(normalizeDomain).filter(isValidDomain);
  if (!isValidDomain(domain) || !fromLocalPart) {
    return {
      ok: false,
      summary: "AI must provide an exact valid domain and sender local part before provisioning.",
      riskLevel: "blocked",
      result: { domain, fromLocalPart },
    };
  }

  const [settings, secrets, brand] = await Promise.all([
    getOutreachProvisioningSettings(),
    getOutreachProvisioningSettingsSecrets(),
    getBrandById(input.mission.brandId, { includeEmbedded: true }),
  ]);
  if (!secrets.mailpoolApiKey) {
    return {
      ok: false,
      summary: "Mailpool credentials are missing.",
      riskLevel: "blocked",
      result: { hasMailpoolApiKey: false },
    };
  }

  const domainSelection = await selectAiChosenAvailableDomain({
    mailpoolApiKey: secrets.mailpoolApiKey,
    domain,
    domainCandidates,
  });
  if (!domainSelection.selection) {
    return {
      ok: false,
      summary: "None of the AI-selected domains are available in Mailpool.",
      riskLevel: "blocked",
      result: { requestedDomain: domain, domainCandidates, checkedDomains: domainSelection.checkedDomains },
    };
  }
  if (domainSelection.selection.price > policy.maxAutoDomainSpendUsd) {
    return {
      ok: false,
      summary: "AI-selected domain exceeds the mission spend guardrail.",
      riskLevel: "blocked",
      result: {
        domain: domainSelection.selection.domain,
        price: domainSelection.selection.price,
        maxAutoDomainSpendUsd: policy.maxAutoDomainSpendUsd,
      },
    };
  }

  try {
    const result = await provisionSender({
      brandId: input.mission.brandId,
      provider: "mailpool",
      accountName:
        asString(input.plan.toolInput.accountName) ||
        `${brand?.name || input.snapshot.brand.name || domainSelection.selection.domain} AI Sender`,
      assignToBrand: true,
      domainMode: "register",
      domain: domainSelection.selection.domain,
      domainCandidates: [],
      allowAlternativeDomains: false,
      fromLocalPart,
      forwardingTargetUrl: brand?.website || input.mission.websiteUrl,
      customerIoSiteId: settings.customerIo.siteId,
      customerIoTrackingApiKey: secrets.customerIoTrackingApiKey,
      customerIoAppApiKey: secrets.customerIoAppApiKey,
      mailpoolApiKey: secrets.mailpoolApiKey,
      namecheapApiUser: settings.namecheap.apiUser,
      namecheapUserName: settings.namecheap.userName,
      namecheapApiKey: secrets.namecheapApiKey,
      namecheapClientIp: settings.namecheap.clientIp,
    });
    await loadBrandSenderLaunchView(input.mission.brandId).catch(() => null);
    await createMissionEvent({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      eventType: "ai_sender_provisioned",
      summary: `AI operator provisioned ${result.fromEmail}; waiting for readiness before sending.`,
      payload: {
        domain: result.domain,
        fromEmail: result.fromEmail,
        price: domainSelection.selection.price,
        readyToSend: result.readyToSend,
        warnings: result.warnings,
        nextSteps: result.nextSteps,
      },
    });
    return {
      ok: true,
      summary: `Provisioned ${result.fromEmail}; waiting for readiness before sending.`,
      riskLevel: "guarded_write",
      result: {
        ok: result.ok,
        provider: result.provider,
        domain: result.domain,
        fromEmail: result.fromEmail,
        readyToSend: result.readyToSend,
        price: domainSelection.selection.price,
        warnings: result.warnings,
        nextSteps: result.nextSteps,
        mailpool: result.mailpool,
      },
    };
  } catch (error) {
    return {
      ok: false,
      summary: error instanceof Error ? error.message : "Sender provisioning failed.",
      riskLevel: "blocked",
      result: {
        domain: domainSelection.selection.domain,
        fromLocalPart,
        error: error instanceof Error ? error.message : "Sender provisioning failed.",
      },
    };
  }
}

async function executeRunDeliveryProbe(input: {
  mission: Mission;
  plan: MissionDeliverabilityAgentPlan;
}): Promise<ToolExecutionResult> {
  const runId = input.mission.currentRunId.trim();
  if (!runId) {
    return {
      ok: false,
      summary: "No current run exists for this mission yet, so there is no scheduled message to probe.",
      riskLevel: "blocked",
      result: { runId },
    };
  }

  const result = await requestRunDeliverabilityProbe({
    runId,
    reason: asString(input.plan.toolInput.reason) || input.plan.rationale,
    senderAccountId: asString(input.plan.toolInput.senderAccountId) || undefined,
    variants: ["production", "baseline"],
    triggerStage: "autonomous",
  });
  await createMissionEvent({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    eventType: result.ok ? "ai_delivery_probe_queued" : "ai_delivery_probe_blocked",
    summary: result.reason,
    payload: {
      runId,
      senderAccountId: result.senderAccountId,
      fromEmail: result.fromEmail,
      sourceMessageId: result.sourceMessageId,
      probeVariants: result.probeVariants,
      jobsQueued: result.jobsQueued,
    },
  });

  return {
    ok: result.ok,
    summary: result.reason,
    riskLevel: result.ok ? "guarded_write" : "blocked",
    result: {
      runId,
      sourceMessageId: result.sourceMessageId,
      senderAccountId: result.senderAccountId,
      fromEmail: result.fromEmail,
      probeVariants: result.probeVariants,
      jobsQueued: result.jobsQueued,
    },
  };
}

async function executeMissionTool(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
  snapshot: MissionDeliverabilitySnapshot;
  plan: MissionDeliverabilityAgentPlan;
}): Promise<ToolExecutionResult> {
  if (!input.snapshot.guardrails.allowedToolNames.includes(input.plan.toolName)) {
    return {
      ok: false,
      summary: `AI selected ${input.plan.toolName}, but the current guardrails do not allow that tool.`,
      riskLevel: "blocked",
      result: {
        selectedToolName: input.plan.toolName,
        allowedToolNames: input.snapshot.guardrails.allowedToolNames,
      },
    };
  }

  if (input.plan.toolName === "assign_sender") {
    return executeAssignSender({ mission: input.mission, plan: input.plan });
  }
  if (input.plan.toolName === "provision_mailpool_sender") {
    return executeProvisionMailpoolSender(input);
  }
  if (input.plan.toolName === "run_delivery_probe") {
    return executeRunDeliveryProbe({ mission: input.mission, plan: input.plan });
  }
  if (input.plan.toolName === "wait_for_warmup") {
    const reason = asString(input.plan.toolInput.reason) || input.plan.rationale;
    await createMissionEvent({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      eventType: "ai_deliverability_waiting",
      summary: reason,
      payload: {
        nextCheck: asString(input.plan.toolInput.nextCheck),
      },
    });
    return {
      ok: true,
      summary: reason,
      riskLevel: "read",
      result: { nextCheck: asString(input.plan.toolInput.nextCheck) },
    };
  }
  if (input.plan.toolName === "block_for_policy") {
    const reason = asString(input.plan.toolInput.reason) || input.plan.rationale;
    await createMissionEvent({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      eventType: "ai_deliverability_blocked",
      summary: reason,
      payload: {
        desiredAction: asString(input.plan.toolInput.desiredAction),
      },
    });
    return {
      ok: false,
      summary: reason,
      riskLevel: "blocked",
      result: { desiredAction: asString(input.plan.toolInput.desiredAction) },
    };
  }

  return {
    ok: true,
    summary: "AI operator inspected deliverability state.",
    riskLevel: "read",
    result: {},
  };
}

export async function ensureMissionDeliverabilityCapacity(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
}): Promise<CapacityResult> {
  const snapshot = await buildMissionDeliverabilitySnapshot(input);
  if (snapshot.deliverabilityState.stage === "ready") {
    return { mission: input.mission, deliverabilityState: snapshot.deliverabilityState };
  }

  const plan = await planMissionDeliverabilityAction(snapshot);
  const execution = await executeMissionTool({
    mission: input.mission,
    approvedPlan: input.approvedPlan,
    snapshot,
    plan,
  });
  const afterSnapshot = await buildMissionDeliverabilitySnapshot(input);
  const deliverabilityState = afterSnapshot.deliverabilityState;

  await createMissionAgentDecision({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    agent: "mission_deliverability_ai_operator",
    action: plan.toolName,
    rationale: plan.rationale,
    riskLevel: execution.riskLevel,
    input: {
      model: plan.model,
      toolName: plan.toolName,
      toolInput: plan.toolInput,
      expectedOutcome: plan.expectedOutcome,
      guardrails: snapshot.guardrails,
      stateBefore: snapshot.deliverabilityState,
    },
    output: {
      ok: execution.ok,
      summary: execution.summary,
      result: execution.result,
      stateAfter: deliverabilityState,
      probeMemoryAfter: afterSnapshot.probeMemory,
      recordedAt: nowIso(),
    },
  });

  return { mission: input.mission, deliverabilityState };
}

export async function previewMissionDeliverabilityAction(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
}) {
  const snapshot = await buildMissionDeliverabilitySnapshot(input);
  const plan = await planMissionDeliverabilityAction(snapshot);
  return { snapshot, plan };
}
