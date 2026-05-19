import { getBrandById } from "@/lib/factory-data";
import {
  getOutreachAccountFromEmail,
  getOutreachMailboxEmail,
  isMailpoolSharedWarmupOnly,
  supportsAnyDelivery,
} from "@/lib/outreach-account-helpers";
import {
  getOutreachRun,
  getBrandOutreachAssignment,
  listDeliverabilityProbeRuns,
  listDeliverabilitySeedReservations,
  listOutreachAccounts,
  listRunMessages,
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
  type ProvisionSenderInput,
} from "@/lib/outreach-provisioning";
import { requestRunDeliverabilityProbe } from "@/lib/outreach-runtime";
import { resolveLlmModel } from "@/lib/llm-router";
import { createMissionAgentDecision, createMissionEvent } from "@/lib/mission-data";
import { inspectMissionDeliverability } from "@/lib/mission-learning";
import { getOperatorBrandMemory } from "@/lib/operator-memory";
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
type ProbeCopyKind = "campaign_copy" | "baseline_control";

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
  sourceType: string;
  sourceNodeId: string;
  contentHash: string;
  copyKind: ProbeCopyKind;
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
    latestForwardEmailCampaignCopyProbe: ProbeSummary | null;
    latestGmailCampaignCopyProbe: ProbeSummary | null;
    latestBaselineProbe: ProbeSummary | null;
    recentProbes: ProbeSummary[];
    activeProbeJobs: Array<{
      id: string;
      status: OutreachJob["status"];
      executeAfter: string;
      attempts: number;
      monitorProvider: string;
      probeVariant: string;
      copyKind: ProbeCopyKind;
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
  campaignCopyProof: {
    requiredForLaunch: boolean;
    hasExactCopyAvailable: boolean;
    scheduledOrSentMessageCount: number;
    latestForwardEmailCampaignCopyPlacement: string;
    latestGmailCampaignCopyPlacement: string;
    baselineControlsAreDiagnosticOnly: boolean;
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
    hasRegistrantDefaults: boolean;
    registrantProfileSource: string;
    missingRegistrantFields: string[];
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
    provisioningCapacity: Array<{
      launchId: string;
      senderAccountId: string;
      fromEmail: string;
      domain: string;
      state: SenderLaunch["state"];
      consumesCapacity: boolean;
      reason: string;
      accountStatus: OutreachAccount["status"] | "";
      provider: OutreachAccount["provider"] | "";
    }>;
    allowedToolNames: MissionDeliverabilityToolName[];
  };
};

type ToolExecutionResult = {
  ok: boolean;
  summary: string;
  riskLevel: MissionRiskLevel;
  result: Record<string, unknown>;
};

type RegistrantProfile = NonNullable<ProvisionSenderInput["registrant"]>;

const TOOL_NAMES: MissionDeliverabilityToolName[] = [
  "inspect_state",
  "assign_sender",
  "run_delivery_probe",
  "provision_mailpool_sender",
  "wait_for_warmup",
  "block_for_policy",
];

const REGISTRANT_REQUIRED_FIELDS = [
  "firstName",
  "lastName",
  "emailAddress",
  "phone",
  "address1",
  "city",
  "stateProvince",
  "postalCode",
  "country",
] as const;

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

function registrantFromRecord(value: unknown): RegistrantProfile {
  const row = asRecord(value);
  return {
    firstName: asString(row.firstName),
    lastName: asString(row.lastName),
    organizationName: asString(row.organizationName),
    emailAddress: asString(row.emailAddress),
    phone: asString(row.phone),
    address1: asString(row.address1),
    city: asString(row.city),
    stateProvince: asString(row.stateProvince),
    postalCode: asString(row.postalCode),
    country: asString(row.country),
  };
}

function registrantFromEnv(): RegistrantProfile {
  return {
    firstName: asString(process.env.OUTREACH_REGISTRANT_FIRST_NAME),
    lastName: asString(process.env.OUTREACH_REGISTRANT_LAST_NAME),
    organizationName: asString(process.env.OUTREACH_REGISTRANT_ORGANIZATION),
    emailAddress: asString(process.env.OUTREACH_REGISTRANT_EMAIL),
    phone: asString(process.env.OUTREACH_REGISTRANT_PHONE),
    address1: asString(process.env.OUTREACH_REGISTRANT_ADDRESS1),
    city: asString(process.env.OUTREACH_REGISTRANT_CITY),
    stateProvince: asString(process.env.OUTREACH_REGISTRANT_STATE_PROVINCE),
    postalCode: asString(process.env.OUTREACH_REGISTRANT_POSTAL_CODE),
    country: asString(process.env.OUTREACH_REGISTRANT_COUNTRY),
  };
}

function missingRegistrantFields(registrant: RegistrantProfile) {
  return REGISTRANT_REQUIRED_FIELDS.filter((field) => !asString(registrant[field]));
}

function completeRegistrantProfile(registrant: RegistrantProfile) {
  return missingRegistrantFields(registrant).length === 0;
}

async function resolveMissionRegistrantProfile(brandId: string): Promise<{
  registrant: RegistrantProfile | null;
  source: "brand_memory" | "environment" | "";
  missingFields: string[];
}> {
  const memory = await getOperatorBrandMemory(brandId).catch(() => null);
  const brandRegistrant = registrantFromRecord(memory?.registrantDefaults ?? {});
  if (completeRegistrantProfile(brandRegistrant)) {
    return { registrant: brandRegistrant, source: "brand_memory", missingFields: [] };
  }

  const environmentRegistrant = registrantFromEnv();
  if (completeRegistrantProfile(environmentRegistrant)) {
    return { registrant: environmentRegistrant, source: "environment", missingFields: [] };
  }

  const brandMissing = missingRegistrantFields(brandRegistrant);
  const environmentMissing = missingRegistrantFields(environmentRegistrant);
  const missing = brandMissing.length <= environmentMissing.length ? brandMissing : environmentMissing;
  return { registrant: null, source: "", missingFields: missing };
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

function launchAgeHours(launch: SenderLaunch) {
  const createdMs = dateMs(launch.createdAt);
  if (!createdMs) return null;
  return (Date.now() - createdMs) / (60 * 60 * 1000);
}

function setupLaunchStaleHours() {
  const parsed = Number(process.env.MISSION_SENDER_SETUP_STALE_HOURS ?? 72);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 72;
}

function mailpoolProviderStatus(account: OutreachAccount | null) {
  const config = asRecord(account?.config);
  const mailpool = asRecord(config.mailpool);
  return asString(mailpool.status).toLowerCase();
}

function launchCapacityDetail(
  launch: SenderLaunch,
  account: OutreachAccount | null
): MissionDeliverabilitySnapshot["guardrails"]["provisioningCapacity"][number] {
  const stateConsumes = launchIsActiveCapacity(launch);
  const ageHours = launchAgeHours(launch);
  const staleSetup =
    launch.state === "setup" && ageHours !== null && ageHours > setupLaunchStaleHours() && account?.status !== "active";
  let consumesCapacity = stateConsumes;
  let reason = stateConsumes ? "active_or_inflight_launch" : "terminal_or_blocked_launch";

  if (consumesCapacity && account && isMailpoolSharedWarmupOnly(account)) {
    consumesCapacity = false;
    reason = "shared_mailpool_warmup_only";
  } else if (consumesCapacity && account && mailpoolProviderStatus(account) === "deleted") {
    consumesCapacity = false;
    reason = "mailpool_sender_deleted";
  } else if (consumesCapacity && account && account.status !== "active" && launch.state !== "setup") {
    consumesCapacity = false;
    reason = "inactive_sender_account";
  } else if (consumesCapacity && staleSetup) {
    consumesCapacity = false;
    reason = "stale_setup_sender";
  }

  return {
    launchId: launch.id,
    senderAccountId: launch.senderAccountId,
    fromEmail: (launch.fromEmail || (account ? getOutreachAccountFromEmail(account) : "")).toLowerCase(),
    domain: launch.domain,
    state: launch.state,
    consumesCapacity,
    reason,
    accountStatus: account?.status ?? "",
    provider: account?.provider ?? "",
  };
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

function probeCopyKind(probeRun: DeliverabilityProbeRun): ProbeCopyKind {
  if (probeRun.probeVariant === "baseline" || probeRun.sourceMessageId.startsWith("synthetic_baseline_")) {
    return "baseline_control";
  }
  return "campaign_copy";
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
    sourceType: probeRun.sourceType,
    sourceNodeId: probeRun.sourceNodeId,
    contentHash: probeRun.contentHash,
    copyKind: probeCopyKind(probeRun),
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

function probeIsCampaignCopy(probe: ProbeSummary) {
  return probe.copyKind === "campaign_copy";
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
      const probeVariant = asString(payload.probeVariant);
      const sourceMessageId = asString(payload.sourceMessageId);
      const copyKind: ProbeCopyKind =
        probeVariant === "baseline" || sourceMessageId.startsWith("synthetic_baseline_")
          ? "baseline_control"
          : "campaign_copy";
      return {
        id: job.id,
        status: job.status,
        executeAfter: job.executeAfter,
        attempts: job.attempts,
        monitorProvider: asString(payload.monitorProvider),
        probeVariant,
        copyKind,
        senderAccountId: asString(payload.senderAccountId),
        fromEmail: asString(payload.fromEmail).toLowerCase(),
        sourceMessageId,
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
  return probes.some(
    (probe) => probeIsCampaignCopy(probe) && probe.fresh && probeIsPassingInbox(probe) && dateMs(probe.observedAt) > pausedAt
  );
}

function buildEvidenceBackedDeliverabilityState(input: {
  base: MissionDeliverabilityState;
  currentRun: OutreachRun | null;
  assignedSenderAccountIds: string[];
  assignedFromEmails: string[];
  probes: ProbeSummary[];
  activeProbeJobs: ReturnType<typeof compactProbeJobs>;
  forwardEmailMode: string;
  gmailCampaignCopyProofAvailable: boolean;
}): MissionDeliverabilityState {
  const relevantProbes = input.probes.filter((probe) => {
    if (input.assignedSenderAccountIds.includes(probe.senderAccountId)) return true;
    return input.assignedFromEmails.includes(probe.fromEmail);
  });
  const probes = relevantProbes.length ? relevantProbes : input.probes;
  const campaignCopyProbes = probes.filter(probeIsCampaignCopy);
  const latestGmailCampaignCopyProbe = latestProbe(campaignCopyProbes, (probe) =>
    probe.targetKinds.some((kind) => kind === "gmail_mailbox" || kind === "mailbox")
  );
  const latestForwardEmailCampaignCopyProbe = latestProbe(campaignCopyProbes, (probe) =>
    probe.targetKinds.includes("forward_email")
  );
  const activeProbe = campaignCopyProbes.find(probeIsActive) ?? null;
  const activeJob = input.activeProbeJobs.find((job) => job.copyKind === "campaign_copy") ?? null;
  const forwardEmailProofPassed = Boolean(
    latestForwardEmailCampaignCopyProbe?.fresh && probeIsPassingInbox(latestForwardEmailCampaignCopyProbe)
  );
  const gmailProofPassed = Boolean(
    latestGmailCampaignCopyProbe?.fresh && probeIsPassingInbox(latestGmailCampaignCopyProbe)
  );
  const gmailConfirmationRequired =
    input.forwardEmailMode !== "only" && input.gmailCampaignCopyProofAvailable;

  if (latestGmailCampaignCopyProbe?.fresh && probeIsBad(latestGmailCampaignCopyProbe)) {
    const summary = `Campaign-copy Gmail seed placement failed for ${latestGmailCampaignCopyProbe.fromEmail || "the active sender"} (${latestGmailCampaignCopyProbe.summaryText || latestGmailCampaignCopyProbe.placement || latestGmailCampaignCopyProbe.lastError || "no inbox placement"}).`;
    return {
      ...input.base,
      stage: "needs_attention",
      summary,
      primaryBlocker: summary,
      lastCheckedAt: nowIso(),
    };
  }

  if (latestForwardEmailCampaignCopyProbe?.fresh && probeIsBad(latestForwardEmailCampaignCopyProbe)) {
    const summary = `Campaign-copy Forward Email placement failed for ${latestForwardEmailCampaignCopyProbe.fromEmail || "the active sender"} (${latestForwardEmailCampaignCopyProbe.summaryText || latestForwardEmailCampaignCopyProbe.placement || latestForwardEmailCampaignCopyProbe.lastError || "no inbox placement"}).`;
    return {
      ...input.base,
      stage: "needs_attention",
      summary,
      primaryBlocker: summary,
      lastCheckedAt: nowIso(),
    };
  }

  if (
    input.currentRun?.id &&
    input.base.stage === "ready" &&
    !gmailProofPassed &&
    !(forwardEmailProofPassed && !gmailConfirmationRequired) &&
    !activeProbe &&
    !activeJob
  ) {
    const summary =
      forwardEmailProofPassed && gmailConfirmationRequired
        ? "Campaign-copy Forward Email placement passed; waiting for Gmail/mailbox confirmation before launch."
        : "Exact campaign-copy inbox placement has not been proven yet. Baseline controls are diagnostic only.";
    return {
      ...input.base,
      stage: "testing_inbox_placement",
      summary,
      primaryBlocker: summary,
      lastCheckedAt: nowIso(),
    };
  }

  if (runLooksDeliverabilityPaused(input.currentRun) && !runPauseClearedByFreshProof(input.currentRun, probes)) {
    const baselineOnlyReason =
      !campaignCopyProbes.length &&
      /baseline|spam|seed|placement|inbox/i.test(`${input.currentRun?.pauseReason ?? ""} ${input.currentRun?.lastError ?? ""}`);
    const reason = baselineOnlyReason
      ? "Current pause came from diagnostic/non-campaign-copy placement evidence. Exact campaign-copy placement is still required before launch."
      : input.currentRun?.pauseReason || input.currentRun?.lastError || "The current run is paused by deliverability evidence.";
    return {
      ...input.base,
      stage: baselineOnlyReason ? "testing_inbox_placement" : "needs_attention",
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
    snapshot.senders.some((sender) => sender.status === "active" && sender.fromEmail && sender.assigned && sender.deliveryCapable)
  ) {
    names.push("run_delivery_probe");
  }
  if (
    snapshot.guardrails.canAutoProvisionSender &&
    snapshot.guardrails.canAutoBuyDomain &&
    snapshot.guardrails.activeProvisioningSenderCount < snapshot.guardrails.maxAutoProvisionedSenders &&
    snapshot.provisioning.hasRegistrantDefaults &&
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
    deliveryCapable:
      account.accountType !== "mailbox" &&
      outboundEnabled(account) &&
      account.hasCredentials &&
      supportsAnyDelivery(account) &&
      !isMailpoolSharedWarmupOnly(account),
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
  const registrantProfile = await resolveMissionRegistrantProfile(input.mission.brandId);

  const assignedAccountIds = assignment?.accountIds?.length
    ? assignment.accountIds
    : assignment?.accountId
      ? [assignment.accountId]
      : [];
  const currentRunId = input.mission.currentRunId.trim();
  const approvedGmailSeedEmails = parseDelimitedEmailSet(process.env.GMAIL_DELIVERABILITY_MONITOR_EMAILS);
  const [probeRuns, runEvents, runJobs, runMessages, seedReservations] = await Promise.all([
    listDeliverabilityProbeRuns({
      brandId: input.mission.brandId,
      runId: currentRunId || undefined,
      statuses: ["queued", "sent", "waiting", "completed", "failed"],
      limit: 75,
    }).catch(() => []),
    currentRunId ? listRunEvents(currentRunId).catch(() => []) : Promise.resolve([]),
    currentRunId ? listRunJobs(currentRunId, 75).catch(() => []) : Promise.resolve([]),
    currentRunId ? listRunMessages(currentRunId).catch(() => []) : Promise.resolve([]),
    listDeliverabilitySeedReservations({ brandId: input.mission.brandId }).catch(() => []),
  ]);
  const probes = compactProbeRuns(probeRuns, approvedGmailSeedEmails);
  const activeProbeJobs = compactProbeJobs(runJobs);
  const scheduledOrSentMessageCount = runMessages.filter((message) => {
    if (!["scheduled", "sent"].includes(message.status)) return false;
    return Boolean(message.subject.trim() && message.body.trim());
  }).length;
  const launchByAccountId = new Map(launches.map((launch) => [launch.senderAccountId, launch] as const));
  const launchByEmail = new Map(launches.map((launch) => [launch.fromEmail.toLowerCase(), launch] as const));
  const accountById = new Map(accounts.map((account) => [account.id, account] as const));
  const launchAccountIds = new Set(launches.map((launch) => launch.senderAccountId).filter(Boolean));
  const launchFromEmails = new Set(launches.map((launch) => launch.fromEmail.toLowerCase()).filter(Boolean));
  const senders = accounts
    .filter((account) => {
      const fromEmail = getOutreachAccountFromEmail(account).toLowerCase();
      return assignedAccountIds.includes(account.id) || launchAccountIds.has(account.id) || launchFromEmails.has(fromEmail);
    })
    .filter((account) => account.status === "active" || assignedAccountIds.includes(account.id) || launchAccountIds.has(account.id))
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
  const forwardEmailProbeConfig = getForwardEmailProbeConfig();
  const gmailSeeds = summarizeGmailSeeds({
    approvedGmailSeedEmails,
    assignedSenderDomain,
    reservations: seedReservations,
  });
  const evidenceBackedDeliverabilityState = buildEvidenceBackedDeliverabilityState({
    base: deliverabilityState,
    currentRun,
    assignedSenderAccountIds: assignedAccountIds,
    assignedFromEmails,
    probes,
    activeProbeJobs,
    forwardEmailMode: forwardEmailProbeConfig?.mode ?? "",
    gmailCampaignCopyProofAvailable: gmailSeeds.remainingForAssignedSenderDomain > 0,
  });
  const provisioningCapacity = launches.map((launch) => launchCapacityDetail(launch, accountById.get(launch.senderAccountId) ?? null));
  const activeProvisioningSenderCount = provisioningCapacity.filter((launch) => launch.consumesCapacity).length;
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
    provisioningCapacity,
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
      latestForwardEmailCampaignCopyProbe: latestProbe(
        probes,
        (probe) => probe.copyKind === "campaign_copy" && probe.targetKinds.includes("forward_email")
      ),
      latestGmailCampaignCopyProbe: latestProbe(
        probes,
        (probe) =>
          probe.copyKind === "campaign_copy" &&
          probe.targetKinds.some((kind) => kind === "gmail_mailbox" || kind === "mailbox")
      ),
      latestBaselineProbe: latestProbe(probes, (probe) => probe.copyKind === "baseline_control"),
      recentProbes: probes.slice(0, 20),
      activeProbeJobs,
      recentDeliverabilityEvents: compactDeliverabilityEvents(runEvents),
    },
    campaignCopyProof: {
      requiredForLaunch: true,
      hasExactCopyAvailable: scheduledOrSentMessageCount > 0,
      scheduledOrSentMessageCount,
      latestForwardEmailCampaignCopyPlacement:
        latestProbe(
          probes,
          (probe) => probe.copyKind === "campaign_copy" && probe.targetKinds.includes("forward_email")
        )?.placement ?? "",
      latestGmailCampaignCopyPlacement:
        latestProbe(
          probes,
          (probe) =>
            probe.copyKind === "campaign_copy" &&
            probe.targetKinds.some((kind) => kind === "gmail_mailbox" || kind === "mailbox")
        )?.placement ?? "",
      baselineControlsAreDiagnosticOnly: true,
    },
    gmailSeeds,
    provisioning: {
      provider: "mailpool",
      hasMailpoolApiKey: Boolean(secrets.mailpoolApiKey),
      hasCustomerIoSiteId: Boolean(settings.customerIo.siteId),
      hasCustomerIoTrackingKey: Boolean(secrets.customerIoTrackingApiKey),
      hasCustomerIoAppKey: Boolean(secrets.customerIoAppApiKey),
      mailpoolWebhookConfigured: Boolean(settings.mailpool.webhookUrl && secrets.mailpoolWebhookSecret),
      deliverabilityProvider: settings.deliverability.provider,
      hasRegistrantDefaults: Boolean(registrantProfile.registrant),
      registrantProfileSource: registrantProfile.source,
      missingRegistrantFields: registrantProfile.missingFields,
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
        "Queue a fresh inbox placement probe for the current run. Default copyMode is campaign_copy, which sends the actual scheduled/sent campaign email copy and is the only probe mode that can prove launch readiness. copyMode baseline_control is diagnostic/warmup only and never launch proof. If senderAccountId is provided, it must be chosen from snapshot.senders where deliveryCapable is true; currentRun.accountId is not valid unless it also appears there.",
      input: {
        senderAccountId: "optional assigned active sender account id; omit to use the current run sender",
        copyMode: "optional: campaign_copy or baseline_control; default campaign_copy",
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
    "You may create new sender capacity when guardrails allow it. You may request fresh inbox placement probes, but launch proof requires copyMode=campaign_copy: the actual scheduled/sent campaign email copy. You may also wait, inspect, or block if that is the correct move.",
    "Operating policy: Forward Email is the cheap first gate. Gmail/mailbox seed placement is the expensive confirmation only after Forward Email inboxes and an approved unused Gmail seed is available for this sender domain.",
    "Do not burn Gmail seed capacity when Forward Email has not inboxed. Do not request another Gmail-style confirmation when probeMemory already shows a fresh active or completed Gmail/mailbox probe for the same sender/content.",
    "When probes.forwardEmailMode is only, a fresh campaign-copy Forward Email inbox result is sufficient launch proof; do not request Gmail/mailbox confirmation in that mode.",
    "Baseline probes are diagnostic only. They can inform warmup/sender health, but they cannot prove a campaign is safe to launch because spam filtering depends heavily on actual copy, links, CTA, personalization, and tracking.",
    "If campaign-copy Gmail/mailbox placement is spam, all_mail_only, not_found, or failed, do not treat the sender as ready even if Forward Email passed. Prefer a healthier sender, wait for warmup/cooldown, or provision capacity if policy allows.",
    "If campaignCopyProof.hasExactCopyAvailable is false, do not substitute a baseline probe as launch proof. Choose wait_for_warmup or block_for_policy unless another exact-copy materialization path is available.",
    "When selecting senderAccountId for assign_sender or run_delivery_probe, use only exact accountId values from snapshot.senders where deliveryCapable is true. Do not select currentRun.accountId unless that exact ID is also present in snapshot.senders and deliveryCapable is true.",
    "If the assigned/current sender is not deliveryCapable, or currentRun.lastError says the sender is warmup-only, do not request another probe on it. Assign a different delivery-capable sender or provision new Mailpool sender capacity when guardrails allow it.",
    "New domain purchase requires a stored registrant profile. If provisioning.hasRegistrantDefaults is false, choose block_for_policy and explain the missing registrant fields instead of inventing legal contact data.",
    "Approved Gmail seed usage is shown in gmailSeeds. Inbox cleanup/archiving for approved Gmail seed inbox hits happens automatically after placement inspection; do not ask the user to clean mailboxes.",
    "Hard guardrails are not optional: no sending before deliverability is ready, no domain purchase unless policy allows it, no provisioning above usable or genuinely in-flight capacity, no spending above maxAutoDomainSpendUsd, and no invented account IDs.",
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
  snapshot: MissionDeliverabilitySnapshot;
  plan: MissionDeliverabilityAgentPlan;
}): Promise<ToolExecutionResult> {
  const accountId = asString(input.plan.toolInput.accountId);
  const snapshotSender = input.snapshot.senders.find((sender) => sender.accountId === accountId) ?? null;
  if (!snapshotSender || !snapshotSender.deliveryCapable) {
    return {
      ok: false,
      summary: "AI selected a sender that is not assignable for this mission.",
      riskLevel: "blocked",
      result: {
        accountId,
        knownForMission: Boolean(snapshotSender),
        deliveryCapable: snapshotSender?.deliveryCapable ?? false,
      },
    };
  }
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
  const registrantProfile = await resolveMissionRegistrantProfile(input.mission.brandId);
  if (!registrantProfile.registrant) {
    return {
      ok: false,
      summary: "Registrant contact information is required before the AI can buy a new sender domain.",
      riskLevel: "blocked",
      result: {
        missingRegistrantFields: registrantProfile.missingFields,
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
      registrant: registrantProfile.registrant,
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
  snapshot: MissionDeliverabilitySnapshot;
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
  const requestedSenderAccountId = asString(input.plan.toolInput.senderAccountId);
  if (requestedSenderAccountId) {
    const requestedSender = input.snapshot.senders.find((sender) => sender.accountId === requestedSenderAccountId) ?? null;
    if (!requestedSender || !requestedSender.deliveryCapable) {
      return {
        ok: false,
        summary: "AI selected a sender account that is not delivery-capable in the current snapshot.",
        riskLevel: "blocked",
        result: {
          requestedSenderAccountId,
          validSenderAccountIds: input.snapshot.senders
            .filter((sender) => sender.deliveryCapable)
            .map((sender) => sender.accountId),
        },
      };
    }
  }

  const copyModeRaw = asString(input.plan.toolInput.copyMode).toLowerCase();
  const baselineControl = copyModeRaw === "baseline_control" || copyModeRaw === "baseline_diagnostic";

  const result = await requestRunDeliverabilityProbe({
    runId,
    reason: asString(input.plan.toolInput.reason) || input.plan.rationale,
    senderAccountId: requestedSenderAccountId || undefined,
    variants: baselineControl ? ["baseline"] : ["production"],
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
      copyMode: baselineControl ? "baseline_control" : "campaign_copy",
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
      copyMode: baselineControl ? "baseline_control" : "campaign_copy",
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
    return executeAssignSender({ mission: input.mission, snapshot: input.snapshot, plan: input.plan });
  }
  if (input.plan.toolName === "provision_mailpool_sender") {
    return executeProvisionMailpoolSender(input);
  }
  if (input.plan.toolName === "run_delivery_probe") {
    return executeRunDeliveryProbe({ mission: input.mission, snapshot: input.snapshot, plan: input.plan });
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
