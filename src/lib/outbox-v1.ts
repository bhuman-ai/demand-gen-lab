import { getBrandById } from "@/lib/factory-data";
import {
  createExperimentRecord,
  createScaleCampaignRecordFromExperiment,
  listStoredScaleCampaignRecords,
  updateExperimentRecord,
} from "@/lib/experiment-data";
import type {
  EmailVerificationState,
  OutreachAccount,
  OutreachMessage,
  OutreachRun,
  OutreachRunLead,
  ScaleCampaignRecord,
} from "@/lib/factory-types";
import {
  createOutreachEvent,
  createOutreachRun,
  createRunMessages,
  getBrandOutreachAssignment,
  getOutreachAccount,
  getOutreachAccountSecrets,
  listBrandRuns,
  listOutreachAccounts,
  listReplyThreadsByBrand,
  listRunLeads,
  listRunMessages,
  updateOutreachRun,
  updateRunLead,
  updateRunMessage,
  upsertRunLeads,
} from "@/lib/outreach-data";
import {
  getOutreachAccountFromEmail,
  getOutreachAccountReplyToEmail,
  supportsCustomerIoDelivery,
} from "@/lib/outreach-account-helpers";
import { sendOutreachMessage } from "@/lib/outreach-providers";
import { getCanonicalSenderPoolForBrand } from "@/lib/senders";
import {
  parseManualBatchContacts,
  type ManualBatchAcceptedContact,
  type ManualBatchRejectedContact,
} from "@/lib/manual-batch-outreach";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const OUTBOX_V1_EXTERNAL_REF_PREFIX = "outbox_v1:";
export const OUTBOX_V1_SOURCE_PREFIX = "outbox-v1:";

const DEFAULT_TIMEZONE = "America/Los_Angeles";
const DEFAULT_WARMING_DAILY_CAP = 25;
const DEFAULT_HEALTHY_DAILY_CAP = 100;
const DEFAULT_HOURLY_CAP = 25;
const MAX_OUTBOX_BATCH_CONTACTS = 1000;

export type OutboxSenderOption = {
  accountId: string;
  name: string;
  fromEmail: string;
  replyToEmail: string;
  provider: OutreachAccount["provider"];
  status: OutreachAccount["status"];
  ready: boolean;
  reason: string;
  primary: boolean;
};

export type OutboxPolicyDecision = {
  senderState: "warming" | "healthy" | "constrained" | "paused";
  dailyCap: number;
  hourlyCap: number;
  sentToday: number;
  failedOrBouncedLast7d: number;
  availableNow: number;
  sendNow: number;
  hold: number;
  reject: number;
  reasons: string[];
};

export type OutboxBatchSummary = {
  run: OutreachRun;
  campaign: ScaleCampaignRecord | null;
  sender: {
    accountId: string;
    name: string;
    fromEmail: string;
    replyToEmail: string;
  };
  counts: {
    leads: number;
    scheduled: number;
    sent: number;
    failed: number;
    canceled: number;
    bounced: number;
    replies: number;
    positiveReplies: number;
  };
  latestReplyAt: string;
  policy: OutboxPolicyDecision | null;
};

export type OutboxConsoleState = {
  batches: OutboxBatchSummary[];
  senders: OutboxSenderOption[];
  selectedPolicy: OutboxPolicyDecision | null;
  outboundSendingEnabled: boolean;
  maxBatchContacts: number;
};

export type OutboxLaunchInput = {
  brandId: string;
  senderAccountId?: string;
  batchName?: string;
  contactsText?: string;
  subject: string;
  body: string;
  requestedSendNow?: number;
  timezone?: string;
};

export type OutboxLaunchResult = {
  batchId: string;
  run: OutreachRun;
  campaign: ScaleCampaignRecord;
  accepted: ManualBatchAcceptedContact[];
  rejected: ManualBatchRejectedContact[];
  policy: OutboxPolicyDecision;
  messages: OutreachMessage[];
  counts: {
    created: number;
    sent: number;
    failed: number;
    held: number;
    rejected: number;
  };
};

function nowIso() {
  return new Date().toISOString();
}

function outboundSendingEnabled() {
  const raw = String(process.env.OUTBOUND_SENDING_ENABLED ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function compactText(value: unknown, max = 180) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}...` : normalized;
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function startOfUtcDayIso() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function renderTemplate(template: string, contact: ManualBatchAcceptedContact) {
  const values: Record<string, string> = {
    email: contact.email,
    name: contact.name || contact.email,
    firstName: (contact.name || "").split(/\s+/).filter(Boolean)[0] ?? "",
    company: contact.company,
    title: contact.title,
    domain: contact.domain,
  };
  return String(template ?? "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
}

function outboxEmailVerification(): EmailVerificationState {
  return {
    mode: "heuristic",
    provider: "outbox_v1",
    verdict: "operator_supplied",
    confidence: "manual",
    reason: "operator_outbox_batch",
    mxStatus: "unknown",
    acceptAll: null,
    catchAll: null,
  };
}

function isOutboxRunExternalRef(value: string | null | undefined) {
  return String(value ?? "").trim().startsWith(OUTBOX_V1_EXTERNAL_REF_PREFIX);
}

async function resolveReplyToEmail(input: {
  brandId: string;
  account: OutreachAccount;
}) {
  const assignment = await getBrandOutreachAssignment(input.brandId).catch(() => null);
  const mailboxAccountId = String(assignment?.mailboxAccountId ?? "").trim();
  const mailboxAccount = mailboxAccountId ? await getOutreachAccount(mailboxAccountId).catch(() => null) : null;
  const replyToEmail =
    getOutreachAccountReplyToEmail(mailboxAccount ?? input.account).trim() ||
    input.account.config.customerIo.replyToEmail.trim() ||
    getOutreachAccountFromEmail(input.account).trim();
  return {
    replyToEmail,
    mailboxAccountId: mailboxAccount?.id ?? input.account.id,
  };
}

async function senderOptionsForBrand(brandId: string): Promise<OutboxSenderOption[]> {
  const [accounts, assignment, canonicalPool] = await Promise.all([
    listOutreachAccounts(),
    getBrandOutreachAssignment(brandId).catch(() => null),
    getCanonicalSenderPoolForBrand(brandId).catch(() => null),
  ]);
  const primaryAccountId = String(assignment?.accountId ?? "").trim();
  const allowedAccountIds = new Set(
    [
      primaryAccountId,
      ...(assignment?.accountIds ?? []),
      ...(canonicalPool?.senders.map((sender) => sender.deliveryAccountId) ?? []),
    ]
      .map((accountId) => accountId.trim())
      .filter(Boolean)
  );
  const scopedAccounts = accounts.filter(
    (account) =>
      account.provider === "customerio" &&
      account.accountType !== "mailbox" &&
      (allowedAccountIds.size === 0 || allowedAccountIds.has(account.id))
  );
  const options = await Promise.all(
    scopedAccounts.map(async (account) => {
      const secrets = await getOutreachAccountSecrets(account.id).catch(() => null);
      const reply = await resolveReplyToEmail({ brandId, account }).catch(() => ({
        replyToEmail: "",
        mailboxAccountId: "",
      }));
      const fromEmail = getOutreachAccountFromEmail(account).trim();
      const missing = [
        account.status === "active" ? "" : "Account inactive",
        supportsCustomerIoDelivery(account) ? "" : "Customer.io sender missing Site ID, From email, or Reply-To",
        secrets?.customerIoAppApiKey.trim() ? "" : "Customer.io App API key missing",
        reply.replyToEmail ? "" : "Reply-To email missing",
      ].filter(Boolean);
      return {
        accountId: account.id,
        name: account.name,
        fromEmail,
        replyToEmail: reply.replyToEmail,
        provider: account.provider,
        status: account.status,
        ready: missing.length === 0,
        reason: missing.join("; "),
        primary: account.id === primaryAccountId,
      } satisfies OutboxSenderOption;
    })
  );
  return options.sort((left, right) => {
    if (left.ready !== right.ready) return left.ready ? -1 : 1;
    if (left.primary !== right.primary) return left.primary ? -1 : 1;
    return left.fromEmail.localeCompare(right.fromEmail);
  });
}

async function ensureOutboxSenderAllowed(input: { brandId: string; accountId: string }) {
  const sender = (await senderOptionsForBrand(input.brandId)).find((option) => option.accountId === input.accountId) ?? null;
  if (!sender) {
    throw new Error("Choose a Customer.io sender assigned to this brand.");
  }
  if (!sender.ready) {
    throw new Error(sender.reason || "Selected sender is not ready.");
  }
  return sender;
}

function metadataMatchesSender(meta: unknown, account: OutreachAccount) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  const record = meta as Record<string, unknown>;
  const accountId = String(record.senderAccountId ?? record.accountId ?? "").trim();
  const fromEmail = String(record.senderFromEmail ?? record.fromEmail ?? "").trim().toLowerCase();
  return accountId === account.id || fromEmail === getOutreachAccountFromEmail(account).trim().toLowerCase();
}

async function senderMessageWindowStats(account: OutreachAccount) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return { sentToday: 0, failedOrBouncedLast7d: 0 };
  }

  const [todayResult, weekResult] = await Promise.all([
    supabase
      .from("demanddev_outreach_messages")
      .select("status,generation_meta,sent_at,created_at")
      .gte("sent_at", startOfUtcDayIso())
      .in("status", ["sent", "replied"])
      .limit(5000),
    supabase
      .from("demanddev_outreach_messages")
      .select("status,generation_meta,sent_at,created_at")
      .gte("created_at", daysAgoIso(7))
      .in("status", ["failed", "bounced"])
      .limit(5000),
  ]);

  const todayRows = todayResult.error ? [] : todayResult.data ?? [];
  const weekRows = weekResult.error ? [] : weekResult.data ?? [];
  return {
    sentToday: todayRows.filter((row) => metadataMatchesSender((row as Record<string, unknown>).generation_meta, account)).length,
    failedOrBouncedLast7d: weekRows.filter((row) => metadataMatchesSender((row as Record<string, unknown>).generation_meta, account)).length,
  };
}

async function policyForSender(input: {
  brandId: string;
  account: OutreachAccount;
  requestedContacts?: number;
  requestedSendNow?: number;
}): Promise<OutboxPolicyDecision> {
  const [canonicalPool, stats] = await Promise.all([
    getCanonicalSenderPoolForBrand(input.brandId).catch(() => null),
    senderMessageWindowStats(input.account),
  ]);
  const canonicalSender = canonicalPool?.senderByAccountId.get(input.account.id) ?? null;
  const canonicalState = String(canonicalSender?.state ?? "").trim();
  const reasons: string[] = [];
  let senderState: OutboxPolicyDecision["senderState"] = "warming";
  if (canonicalState === "ready") senderState = "healthy";
  if (canonicalState === "restricted") senderState = "constrained";
  if (canonicalState === "blocked" || canonicalState === "retired") senderState = "paused";
  if (input.account.status !== "active") {
    senderState = "paused";
    reasons.push("sender_inactive");
  }
  if (!outboundSendingEnabled()) {
    senderState = "paused";
    reasons.push("outbound_sending_disabled");
  }
  if (stats.failedOrBouncedLast7d >= 5 && senderState !== "paused") {
    senderState = "constrained";
    reasons.push("recent_provider_failures_or_bounces");
  }

  const baseDailyCap =
    canonicalSender?.dailyCap && canonicalSender.dailyCap > 0
      ? canonicalSender.dailyCap
      : senderState === "healthy"
        ? DEFAULT_HEALTHY_DAILY_CAP
        : DEFAULT_WARMING_DAILY_CAP;
  const dailyCap =
    senderState === "paused"
      ? 0
      : senderState === "constrained"
        ? Math.min(baseDailyCap, 10)
        : baseDailyCap;
  const hourlyCap =
    canonicalSender?.hourlyCap && canonicalSender.hourlyCap > 0
      ? canonicalSender.hourlyCap
      : Math.min(DEFAULT_HOURLY_CAP, dailyCap || DEFAULT_HOURLY_CAP);
  const availableNow = Math.max(0, Math.min(dailyCap - stats.sentToday, hourlyCap));
  const requestedContacts = Math.max(0, Math.round(Number(input.requestedContacts ?? 0) || 0));
  const requestedSendNow =
    input.requestedSendNow === undefined
      ? requestedContacts
      : Math.max(0, Math.round(Number(input.requestedSendNow) || 0));
  const sendNow = Math.max(0, Math.min(requestedContacts, requestedSendNow, availableNow));
  const hold = Math.max(0, requestedContacts - sendNow);
  if (hold > 0 && availableNow <= 0 && senderState !== "paused") reasons.push("daily_or_hourly_cap_exhausted");
  if (hold > 0 && sendNow > 0) reasons.push("batch_exceeds_current_sender_cap");

  return {
    senderState,
    dailyCap,
    hourlyCap,
    sentToday: stats.sentToday,
    failedOrBouncedLast7d: stats.failedOrBouncedLast7d,
    availableNow,
    sendNow,
    hold,
    reject: 0,
    reasons,
  };
}

function buildRunMetrics(input: {
  leads: OutreachRunLead[];
  messages: OutreachMessage[];
  replies: number;
  positiveReplies: number;
}) {
  return {
    sourcedLeads: input.leads.length,
    scheduledMessages: input.messages.filter((message) => message.status === "scheduled").length,
    sentMessages: input.messages.filter((message) => ["sent", "replied"].includes(message.status)).length,
    bouncedMessages: input.messages.filter((message) => message.status === "bounced").length,
    failedMessages: input.messages.filter((message) => message.status === "failed").length,
    replies: input.replies,
    positiveReplies: input.positiveReplies,
    negativeReplies: 0,
  };
}

async function refreshOutboxRunMetrics(run: OutreachRun) {
  const [leads, messages, { threads }] = await Promise.all([
    listRunLeads(run.id),
    listRunMessages(run.id),
    listReplyThreadsByBrand(run.brandId),
  ]);
  const runThreads = threads.filter((thread) => thread.runId === run.id);
  const metrics = buildRunMetrics({
    leads,
    messages,
    replies: runThreads.length,
    positiveReplies: runThreads.filter((thread) => thread.sentiment === "positive").length,
  });
  const remainingScheduled = metrics.scheduledMessages;
  const sentOrReplied = metrics.sentMessages;
  const nextStatus: OutreachRun["status"] =
    remainingScheduled > 0 ? "paused" : sentOrReplied > 0 ? "monitoring" : metrics.failedMessages > 0 ? "failed" : "monitoring";
  await updateOutreachRun(run.id, {
    status: nextStatus,
    metrics,
    pauseReason: remainingScheduled > 0 ? "Outbox policy is holding remaining contacts until sender cap opens." : "",
    lastError: "",
  });
  return { leads, messages, threads, metrics };
}

async function summarizeOutboxRun(input: {
  run: OutreachRun;
  campaigns: ScaleCampaignRecord[];
}): Promise<OutboxBatchSummary> {
  const [messages, leads, { threads }, account] = await Promise.all([
    listRunMessages(input.run.id),
    listRunLeads(input.run.id),
    listReplyThreadsByBrand(input.run.brandId),
    getOutreachAccount(input.run.accountId).catch(() => null),
  ]);
  const runThreads = threads.filter((thread) => thread.runId === input.run.id);
  const latestReplyAt =
    runThreads
      .map((thread) => thread.lastMessageAt)
      .filter(Boolean)
      .sort((left, right) => (left < right ? 1 : -1))[0] ?? "";
  const policyMeta = messages
    .map((message) => message.generationMeta?.outboxPolicy)
    .find((value) => value && typeof value === "object") as OutboxPolicyDecision | undefined;
  return {
    run: input.run,
    campaign: input.campaigns.find((campaign) => campaign.id === input.run.ownerId) ?? null,
    sender: {
      accountId: input.run.accountId,
      name: account?.name ?? "",
      fromEmail: getOutreachAccountFromEmail(account).trim(),
      replyToEmail: getOutreachAccountReplyToEmail(account).trim(),
    },
    counts: {
      leads: leads.length,
      scheduled: messages.filter((message) => message.status === "scheduled").length,
      sent: messages.filter((message) => ["sent", "replied"].includes(message.status)).length,
      failed: messages.filter((message) => message.status === "failed").length,
      canceled: messages.filter((message) => message.status === "canceled").length,
      bounced: messages.filter((message) => message.status === "bounced").length,
      replies: runThreads.length,
      positiveReplies: runThreads.filter((thread) => thread.sentiment === "positive").length,
    },
    latestReplyAt,
    policy: policyMeta ?? null,
  };
}

export async function listOutboxBatches(brandId: string, limit = 25): Promise<OutboxBatchSummary[]> {
  const [runs, campaigns] = await Promise.all([
    listBrandRuns(brandId),
    listStoredScaleCampaignRecords(brandId),
  ]);
  const outboxRuns = runs
    .filter((run) => isOutboxRunExternalRef(run.externalRef))
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
    .slice(0, Math.max(1, Math.min(100, Math.round(Number(limit) || 25))));
  return Promise.all(outboxRuns.map((run) => summarizeOutboxRun({ run, campaigns })));
}

export async function getOutboxConsoleState(brandId: string, preferredSenderAccountId = ""): Promise<OutboxConsoleState> {
  const [batches, senders] = await Promise.all([
    listOutboxBatches(brandId),
    senderOptionsForBrand(brandId),
  ]);
  const selectedSender = (
    preferredSenderAccountId
      ? senders.find((sender) => sender.accountId === preferredSenderAccountId)
      : senders.find((sender) => sender.ready)
  ) ?? senders.find((sender) => sender.ready) ?? null;
  const account = selectedSender ? await getOutreachAccount(selectedSender.accountId).catch(() => null) : null;
  const selectedPolicy = account
    ? await policyForSender({ brandId, account, requestedContacts: 0, requestedSendNow: 0 })
    : null;
  return {
    batches,
    senders,
    selectedPolicy,
    outboundSendingEnabled: outboundSendingEnabled(),
    maxBatchContacts: MAX_OUTBOX_BATCH_CONTACTS,
  };
}

export async function launchOutboxBatch(input: OutboxLaunchInput): Promise<OutboxLaunchResult> {
  const brand = await getBrandById(input.brandId, { includeEmbedded: true });
  if (!brand) throw new Error("Brand not found.");

  const subject = compactText(input.subject, 200);
  const body = String(input.body ?? "").trim();
  if (!subject) throw new Error("Subject is required.");
  if (!body) throw new Error("Body is required.");

  const parsed = parseManualBatchContacts({ contactsText: input.contactsText });
  if (!parsed.accepted.length) {
    throw new Error(parsed.rejected.length ? `No sendable contacts. First rejection: ${parsed.rejected[0]?.reason}` : "Contacts are required.");
  }

  const senderAccountId = String(input.senderAccountId ?? "").trim() ||
    String((await getBrandOutreachAssignment(input.brandId).catch(() => null))?.accountId ?? "").trim();
  if (!senderAccountId) throw new Error("Choose a Customer.io sender.");
  await ensureOutboxSenderAllowed({ brandId: input.brandId, accountId: senderAccountId });
  const account = await getOutreachAccount(senderAccountId);
  if (!account) throw new Error("Sender account not found.");
  if (account.provider !== "customerio") throw new Error("Outbox V1 currently sends through Customer.io senders.");
  const secrets = await getOutreachAccountSecrets(account.id);
  if (!secrets?.customerIoAppApiKey.trim()) throw new Error("Customer.io App API key missing for this sender.");
  const reply = await resolveReplyToEmail({ brandId: input.brandId, account });
  if (!reply.replyToEmail) throw new Error("Reply-To email missing for this sender.");

  const accepted = parsed.accepted.slice(0, MAX_OUTBOX_BATCH_CONTACTS);
  const requestedSendNow = clampInt(input.requestedSendNow, accepted.length, 0, MAX_OUTBOX_BATCH_CONTACTS);
  const policy = await policyForSender({
    brandId: input.brandId,
    account,
    requestedContacts: accepted.length,
    requestedSendNow,
  });
  const batchId = `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const batchName = compactText(input.batchName, 120) || `Outbox ${new Date().toLocaleDateString("en-US")}`;
  const timezone = String(input.timezone ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const dailyCap = Math.max(1, policy.dailyCap || DEFAULT_WARMING_DAILY_CAP);
  const hourlyCap = Math.max(1, policy.hourlyCap || Math.min(DEFAULT_HOURLY_CAP, dailyCap));

  const experiment = await createExperimentRecord({
    brandId: input.brandId,
    name: batchName,
    offer: subject,
    audience: `${accepted.length} operator-supplied outbox contacts`,
    createRuntime: true,
  });
  const updatedExperiment = await updateExperimentRecord(input.brandId, experiment.id, {
    status: "ready",
    testEnvelope: {
      ...experiment.testEnvelope,
      sampleSize: accepted.length,
      dailyCap,
      hourlyCap,
      timezone,
      minSpacingMinutes: 0,
      oneContactPerCompany: false,
      businessHoursEnabled: false,
      businessHoursStartHour: 0,
      businessHoursEndHour: 0,
      businessDays: [0, 1, 2, 3, 4, 5, 6],
    },
  });
  const runtimeExperiment = updatedExperiment ?? experiment;
  const campaign = await createScaleCampaignRecordFromExperiment({
    brandId: input.brandId,
    experimentId: runtimeExperiment.id,
    campaignName: batchName,
    status: "active",
    lane: "outbound",
    scalePolicy: {
      dailyCap,
      hourlyCap,
      timezone,
      minSpacingMinutes: 0,
      accountId: account.id,
      mailboxAccountId: reply.mailboxAccountId || account.id,
      safetyMode: "balanced",
    },
  });
  const run = await createOutreachRun({
    brandId: input.brandId,
    campaignId: runtimeExperiment.runtime.campaignId,
    experimentId: runtimeExperiment.runtime.experimentId,
    hypothesisId: runtimeExperiment.runtime.hypothesisId,
    ownerType: "campaign",
    ownerId: campaign.id,
    accountId: account.id,
    lockedSenderAccountId: account.id,
    status: policy.sendNow > 0 ? "sending" : "paused",
    dailyCap,
    hourlyCap,
    timezone,
    minSpacingMinutes: 0,
    externalRef: `${OUTBOX_V1_EXTERNAL_REF_PREFIX}${batchId}`,
    pauseReason: policy.sendNow > 0 ? "" : "Outbox policy is holding all contacts.",
  });

  const leads = await upsertRunLeads(
    run.id,
    input.brandId,
    runtimeExperiment.runtime.campaignId,
    accepted.map((contact, index) => ({
      email: contact.email,
      name: contact.name,
      company: contact.company,
      title: contact.title,
      domain: contact.domain,
      sourceUrl: `${OUTBOX_V1_SOURCE_PREFIX}${batchId}:${index + 1}`,
      realVerifiedEmail: false,
      emailVerification: outboxEmailVerification(),
    }))
  );
  const leadByEmail = new Map(leads.map((lead) => [lead.email.toLowerCase(), lead] as const));
  const scheduledAt = nowIso();
  const messages = await createRunMessages(
    accepted.flatMap((contact, index) => {
      const lead = leadByEmail.get(contact.email.toLowerCase());
      if (!lead) return [];
      const selectedForImmediateSend = index < policy.sendNow;
      return [{
        runId: run.id,
        brandId: input.brandId,
        campaignId: runtimeExperiment.runtime.campaignId,
        leadId: lead.id,
        step: 1,
        subject: renderTemplate(subject, contact),
        body: renderTemplate(body, contact),
        status: "scheduled" as const,
        scheduledAt,
        sourceType: "cadence" as const,
        nodeId: "outbox_v1",
        generationMeta: {
          outboxV1: true,
          batchId,
          selectedForImmediateSend,
          holdReason: selectedForImmediateSend ? "" : "sender_policy_cap",
          originalSourceUrl: contact.originalSourceUrl,
          warnings: contact.warnings,
          senderAccountId: account.id,
          senderAccountName: account.name,
          senderFromEmail: getOutreachAccountFromEmail(account).trim(),
          replyToEmail: reply.replyToEmail,
          outboxPolicy: policy,
        },
      }];
    })
  );
  await Promise.all(leads.map((lead, index) => updateRunLead(lead.id, { status: index < policy.sendNow ? "scheduled" : "scheduled" })));
  await createOutreachEvent({
    runId: run.id,
    eventType: "outbox_batch_created",
    payload: {
      batchId,
      batchName,
      acceptedContacts: accepted.length,
      rejectedContacts: parsed.rejected.length,
      senderAccountId: account.id,
      fromEmail: getOutreachAccountFromEmail(account).trim(),
      replyToEmail: reply.replyToEmail,
      policy,
    },
  });

  let sent = 0;
  let failed = 0;
  const sendableMessages = messages.slice(0, policy.sendNow);
  for (const message of sendableMessages) {
    const lead = leads.find((candidate) => candidate.id === message.leadId) ?? null;
    if (!lead?.email) {
      failed += 1;
      await updateRunMessage(message.id, { status: "failed", lastError: "Lead email missing" });
      continue;
    }
    const send = await sendOutreachMessage({
      message,
      account,
      secrets,
      replyToEmail: reply.replyToEmail,
      recipient: lead.email,
      runId: run.id,
      experimentId: run.experimentId,
    });
    const generationMeta = {
      ...message.generationMeta,
      outboxV1: true,
      batchId,
      senderAccountId: account.id,
      senderAccountName: account.name,
      senderFromEmail: getOutreachAccountFromEmail(account).trim(),
      replyToEmail: reply.replyToEmail,
      outboxPolicy: policy,
    };
    if (send.ok) {
      sent += 1;
      const sentAt = nowIso();
      await updateRunMessage(message.id, {
        status: "sent",
        providerMessageId: send.providerMessageId,
        sentAt,
        lastError: "",
        generationMeta,
      });
      await updateRunLead(lead.id, { status: "sent" });
      await createOutreachEvent({
        runId: run.id,
        eventType: "outbox_message_sent",
        payload: {
          batchId,
          messageId: message.id,
          accountId: account.id,
          fromEmail: getOutreachAccountFromEmail(account).trim(),
          recipient: lead.email,
          providerMessageId: send.providerMessageId,
        },
      });
    } else {
      failed += 1;
      await updateRunMessage(message.id, {
        status: "failed",
        lastError: send.error,
        generationMeta,
      });
      await createOutreachEvent({
        runId: run.id,
        eventType: "outbox_dispatch_failed",
        payload: {
          batchId,
          messageId: message.id,
          accountId: account.id,
          fromEmail: getOutreachAccountFromEmail(account).trim(),
          recipient: lead.email,
          error: send.error,
        },
      });
    }
  }

  const refreshed = await refreshOutboxRunMetrics(run);
  return {
    batchId,
    run,
    campaign,
    accepted,
    rejected: parsed.rejected,
    policy,
    messages: refreshed.messages,
    counts: {
      created: messages.length,
      sent,
      failed,
      held: Math.max(0, messages.length - sent - failed),
      rejected: parsed.rejected.length,
    },
  };
}
