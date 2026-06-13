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
  OutreachRunJob,
  OutreachRunLead,
  ScaleCampaignRecord,
} from "@/lib/factory-types";
import {
  createOutreachEvent,
  createOutreachRun,
  createRunMessages,
  enqueueOutreachJob,
  getBrandOutreachAssignment,
  getOutreachAccount,
  getOutreachAccountSecrets,
  getOutreachRun,
  listBrandRuns,
  listReplyThreadsByBrand,
  listRunJobs,
  listRunLeads,
  listRunMessages,
  listOutreachAccounts,
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
import { getCanonicalSenderPoolForBrand } from "@/lib/senders";
import {
  extractFirstEmailAddress,
  getLeadEmailSuppressionReason,
  sendOutreachMessage,
} from "@/lib/outreach-providers";

export const MANUAL_BATCH_EXTERNAL_REF_PREFIX = "manual_batch:";
export const MANUAL_BATCH_SOURCE_PREFIX = "manual-batch:";

const DEFAULT_TIMEZONE = "America/Los_Angeles";
const MAX_BATCH_CONTACTS = 1000;
const DEFAULT_MANUAL_BATCH_CHUNK_SIZE = 100;
const MAX_MANUAL_BATCH_CHUNK_SIZE = 250;

type ManualBatchContactInput = {
  email?: string;
  name?: string;
  company?: string;
  title?: string;
  domain?: string;
  sourceUrl?: string;
};

export type ManualBatchRejectedContact = {
  rowNumber: number;
  email: string;
  reason: string;
};

export type ManualBatchAcceptedContact = {
  rowNumber: number;
  email: string;
  name: string;
  company: string;
  title: string;
  domain: string;
  originalSourceUrl: string;
  warnings: string[];
};

export type ManualBatchSenderOption = {
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

export type ManualBatchSummary = {
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
  activeJobTypes: string[];
};

export type ManualBatchLaunchInput = {
  brandId: string;
  senderAccountId?: string;
  batchName?: string;
  contactsText?: string;
  contacts?: ManualBatchContactInput[];
  subject: string;
  body: string;
  dailyCap?: number;
  hourlyCap?: number;
  minSpacingMinutes?: number;
  timezone?: string;
  chunkSize?: number;
};

export type ManualBatchLaunchResult = {
  batchId: string;
  run: OutreachRun;
  campaign: ScaleCampaignRecord;
  accepted: ManualBatchAcceptedContact[];
  rejected: ManualBatchRejectedContact[];
  messages: OutreachMessage[];
};

function nowIso() {
  return new Date().toISOString();
}

function outboundSendingEnabled() {
  const raw = String(process.env.OUTBOUND_SENDING_ENABLED ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

export function isManualBatchRunExternalRef(value: string | null | undefined) {
  return String(value ?? "").trim().startsWith(MANUAL_BATCH_EXTERNAL_REF_PREFIX);
}

export function isManualBatchLeadSource(value: string | null | undefined) {
  return String(value ?? "").trim().startsWith(MANUAL_BATCH_SOURCE_PREFIX);
}

function compactText(value: unknown, max = 180) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}...` : normalized;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeDomain(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\.+$/, "");
}

function domainFromEmail(email: string) {
  return normalizeDomain(email.split("@")[1] ?? "");
}

function companyFromDomain(domain: string) {
  const root = normalizeDomain(domain).split(".")[0] ?? "";
  if (!root) return "";
  return root
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function nameFromEmail(email: string) {
  const local = email.split("@")[0] ?? "";
  const parts = local
    .replace(/\+.*$/, "")
    .split(/[._-]+/)
    .map((part) => part.replace(/\d+/g, "").trim())
    .filter((part) => part.length > 1)
    .slice(0, 3);
  if (!parts.length) return "";
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function fieldKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function headerFieldName(value: string) {
  const key = fieldKey(value);
  if (["email", "workemail", "businessemail", "emailaddress"].includes(key)) return "email";
  if (["name", "fullname", "contact", "person"].includes(key)) return "name";
  if (["company", "companyname", "account", "organization", "org"].includes(key)) return "company";
  if (["title", "jobtitle", "role"].includes(key)) return "title";
  if (["domain", "companydomain", "website", "url"].includes(key)) return "domain";
  if (["source", "sourceurl", "profile", "profileurl", "linkedin"].includes(key)) return "sourceUrl";
  return "";
}

function parseContactsFromText(text: string): ManualBatchContactInput[] {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const firstCells = parseCsvLine(lines[0] ?? "");
  const headerNames = firstCells.map(headerFieldName);
  const hasHeader = headerNames.some(Boolean) && firstCells.some((cell) => !extractFirstEmailAddress(cell));
  const rows = hasHeader ? lines.slice(1) : lines;

  return rows.map((line) => {
    const cells = parseCsvLine(line);
    if (hasHeader) {
      const record: ManualBatchContactInput = {};
      headerNames.forEach((name, index) => {
        if (!name) return;
        record[name as keyof ManualBatchContactInput] = cells[index] ?? "";
      });
      return record;
    }
    return {
      email: cells[0] ?? line,
      name: cells[1] ?? "",
      company: cells[2] ?? "",
      title: cells[3] ?? "",
      domain: cells[4] ?? "",
      sourceUrl: cells[5] ?? "",
    };
  });
}

export function parseManualBatchContacts(input: {
  contactsText?: string;
  contacts?: ManualBatchContactInput[];
}): {
  accepted: ManualBatchAcceptedContact[];
  rejected: ManualBatchRejectedContact[];
} {
  const rows = [
    ...parseContactsFromText(input.contactsText ?? ""),
    ...(Array.isArray(input.contacts) ? input.contacts : []),
  ].slice(0, MAX_BATCH_CONTACTS);
  const accepted: ManualBatchAcceptedContact[] = [];
  const rejected: ManualBatchRejectedContact[] = [];
  const seenEmails = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const email = extractFirstEmailAddress(row.email ?? "").toLowerCase();
    if (!email) {
      rejected.push({ rowNumber, email: String(row.email ?? "").trim(), reason: "invalid_email" });
      return;
    }
    if (seenEmails.has(email)) {
      rejected.push({ rowNumber, email, reason: "duplicate_email" });
      return;
    }
    const suppressionReason = getLeadEmailSuppressionReason(email);
    if (suppressionReason) {
      rejected.push({ rowNumber, email, reason: suppressionReason });
      return;
    }

    const domain = normalizeDomain(row.domain ?? "") || domainFromEmail(email);
    const company = compactText(row.company || companyFromDomain(domain), 120);
    const name = compactText(row.name || nameFromEmail(email), 120);
    const warnings = [
      name ? "" : "missing_name",
      company ? "" : "missing_company",
      domain ? "" : "missing_domain",
    ].filter(Boolean);
    seenEmails.add(email);
    accepted.push({
      rowNumber,
      email,
      name,
      company,
      title: compactText(row.title, 160),
      domain,
      originalSourceUrl: String(row.sourceUrl ?? "").trim(),
      warnings,
    });
  });

  return { accepted, rejected };
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

function manualEmailVerification(): EmailVerificationState {
  return {
    mode: "heuristic",
    provider: "manual_batch",
    verdict: "manual_supplied",
    confidence: "manual",
    reason: "operator_uploaded_batch",
    mxStatus: "unknown",
    acceptAll: null,
    catchAll: null,
  };
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

function manualBatchIdFromRun(run: Pick<OutreachRun, "externalRef" | "id">) {
  const ref = String(run.externalRef ?? "").trim();
  return isManualBatchRunExternalRef(ref) ? ref.slice(MANUAL_BATCH_EXTERNAL_REF_PREFIX.length) : run.id;
}

function buildRunMetrics(input: {
  run: OutreachRun;
  leads: OutreachRunLead[];
  messages: OutreachMessage[];
  replyThreads: Awaited<ReturnType<typeof listReplyThreadsByBrand>>["threads"];
}) {
  const runThreads = input.replyThreads.filter((thread) => thread.runId === input.run.id);
  return {
    sourcedLeads: input.leads.length,
    scheduledMessages: input.messages.filter((message) => message.status === "scheduled").length,
    sentMessages: input.messages.filter((message) => ["sent", "replied"].includes(message.status)).length,
    bouncedMessages: input.messages.filter((message) => message.status === "bounced").length,
    failedMessages: input.messages.filter((message) => message.status === "failed").length,
    replies: runThreads.length,
    positiveReplies: runThreads.filter((thread) => thread.sentiment === "positive").length,
    negativeReplies: runThreads.filter((thread) => thread.sentiment === "negative").length,
  };
}

async function refreshManualBatchRunMetrics(run: OutreachRun) {
  const [leads, messages, { threads }] = await Promise.all([
    listRunLeads(run.id),
    listRunMessages(run.id),
    listReplyThreadsByBrand(run.brandId),
  ]);
  const metrics = buildRunMetrics({ run, leads, messages, replyThreads: threads });
  const remainingScheduled = metrics.scheduledMessages;
  const sentOrReplied = metrics.sentMessages;
  const nextStatus: OutreachRun["status"] =
    remainingScheduled > 0 ? "sending" : sentOrReplied > 0 ? "monitoring" : metrics.failedMessages > 0 ? "failed" : "monitoring";
  await updateOutreachRun(run.id, {
    status: nextStatus,
    metrics,
    ...(nextStatus === "failed" ? { completedAt: nowIso() } : {}),
  });
  return { leads, messages, threads, metrics };
}

async function senderOptionsForBrand(brandId: string): Promise<ManualBatchSenderOption[]> {
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
  const options = await Promise.all(
    accounts
      .filter(
        (account) =>
          account.provider === "customerio" &&
          account.accountType !== "mailbox" &&
          allowedAccountIds.has(account.id)
      )
      .map(async (account) => {
        const secrets = await getOutreachAccountSecrets(account.id).catch(() => null);
        const reply = await resolveReplyToEmail({ brandId, account }).catch(() => ({
          replyToEmail: "",
          mailboxAccountId: "",
        }));
        const fromEmail = getOutreachAccountFromEmail(account).trim();
        const missing = [
          account.status === "active" ? "" : "Account inactive",
          supportsCustomerIoDelivery(account) ? "" : "Customer.io sender missing Site ID or From email",
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
        } satisfies ManualBatchSenderOption;
      })
  );
  return options.sort((left, right) => {
    if (left.ready !== right.ready) return left.ready ? -1 : 1;
    if (left.primary !== right.primary) return left.primary ? -1 : 1;
    return left.fromEmail.localeCompare(right.fromEmail);
  });
}

async function ensureManualBatchSenderAllowed(input: { brandId: string; accountId: string }) {
  const sender = (await senderOptionsForBrand(input.brandId)).find(
    (option) => option.accountId === input.accountId
  ) ?? null;
  if (!sender) {
    throw new Error("Choose a Customer.io sender assigned to this brand.");
  }
  if (!sender.ready) {
    throw new Error(sender.reason || "Selected sender is not ready.");
  }
}

export async function getManualBatchConsoleState(brandId: string) {
  const [batches, senders] = await Promise.all([
    listManualBatches(brandId),
    senderOptionsForBrand(brandId),
  ]);
  return {
    batches,
    senders,
    outboundSendingEnabled: outboundSendingEnabled(),
    maxBatchContacts: MAX_BATCH_CONTACTS,
  };
}

export async function launchManualBatch(input: ManualBatchLaunchInput): Promise<ManualBatchLaunchResult> {
  const brand = await getBrandById(input.brandId, { includeEmbedded: true });
  if (!brand) {
    throw new Error("Brand not found.");
  }
  if (!outboundSendingEnabled()) {
    throw new Error("OUTBOUND_SENDING_ENABLED is off, so manual batches cannot send.");
  }

  const subject = compactText(input.subject, 200);
  const body = String(input.body ?? "").trim();
  if (!subject) throw new Error("Subject is required.");
  if (!body) throw new Error("Body is required.");

  const parsed = parseManualBatchContacts({ contactsText: input.contactsText, contacts: input.contacts });
  if (!parsed.accepted.length) {
    throw new Error(parsed.rejected.length ? `No sendable contacts. First rejection: ${parsed.rejected[0]?.reason}` : "Contacts are required.");
  }

  const senderAccountId = String(input.senderAccountId ?? "").trim() ||
    String((await getBrandOutreachAssignment(input.brandId).catch(() => null))?.accountId ?? "").trim();
  if (!senderAccountId) {
    throw new Error("Choose a Customer.io sender.");
  }
  await ensureManualBatchSenderAllowed({ brandId: input.brandId, accountId: senderAccountId });
  const account = await getOutreachAccount(senderAccountId);
  if (!account) throw new Error("Sender account not found.");
  if (account.provider !== "customerio") throw new Error("Manual batch sending currently requires a Customer.io sender.");
  if (account.status !== "active") throw new Error("Sender account is inactive.");
  if (!supportsCustomerIoDelivery(account)) {
    throw new Error("Customer.io sender is missing a Site ID or From email.");
  }
  const secrets = await getOutreachAccountSecrets(account.id);
  if (!secrets?.customerIoAppApiKey.trim()) {
    throw new Error("Customer.io App API key missing for this sender.");
  }
  const reply = await resolveReplyToEmail({ brandId: input.brandId, account });
  if (!reply.replyToEmail) throw new Error("Reply-To email missing for this sender.");

  const accepted = parsed.accepted.slice(0, MAX_BATCH_CONTACTS);
  const batchId = `mb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const batchName = compactText(input.batchName, 120) || `Manual batch ${new Date().toLocaleDateString("en-US")}`;
  const dailyCap = clampInt(input.dailyCap, Math.min(accepted.length, 500), 1, MAX_BATCH_CONTACTS);
  const hourlyCap = clampInt(input.hourlyCap, Math.min(dailyCap, 250), 1, MAX_BATCH_CONTACTS);
  const minSpacingMinutes = clampInt(input.minSpacingMinutes, 0, 0, 240);
  const timezone = String(input.timezone ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const chunkSize = clampInt(input.chunkSize, DEFAULT_MANUAL_BATCH_CHUNK_SIZE, 1, MAX_MANUAL_BATCH_CHUNK_SIZE);

  const experiment = await createExperimentRecord({
    brandId: input.brandId,
    name: batchName,
    offer: subject,
    audience: `${accepted.length} operator-supplied contacts`,
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
      minSpacingMinutes,
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
      minSpacingMinutes,
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
    status: "scheduled",
    dailyCap,
    hourlyCap,
    timezone,
    minSpacingMinutes,
    externalRef: `${MANUAL_BATCH_EXTERNAL_REF_PREFIX}${batchId}`,
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
      sourceUrl: `${MANUAL_BATCH_SOURCE_PREFIX}${batchId}:${index + 1}`,
      realVerifiedEmail: false,
      emailVerification: manualEmailVerification(),
    }))
  );
  const leadByEmail = new Map(leads.map((lead) => [lead.email.toLowerCase(), lead] as const));
  await Promise.all(leads.map((lead) => updateRunLead(lead.id, { status: "scheduled" })));
  const scheduledAt = nowIso();
  const messages = await createRunMessages(
    accepted.flatMap((contact) => {
      const lead = leadByEmail.get(contact.email.toLowerCase());
      if (!lead) return [];
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
        nodeId: "manual_batch",
        generationMeta: {
          manualBatch: true,
          batchId,
          chunkSize,
          originalSourceUrl: contact.originalSourceUrl,
          warnings: contact.warnings,
          senderAccountId: account.id,
          senderAccountName: account.name,
          senderFromEmail: getOutreachAccountFromEmail(account).trim(),
          replyToEmail: reply.replyToEmail,
        },
      }];
    })
  );

  await updateOutreachRun(run.id, {
    metrics: {
      sourcedLeads: leads.length,
      scheduledMessages: messages.length,
      sentMessages: 0,
      bouncedMessages: 0,
      failedMessages: 0,
      replies: 0,
      positiveReplies: 0,
      negativeReplies: 0,
    },
  });
  await createOutreachEvent({
    runId: run.id,
    eventType: "manual_batch_created",
    payload: {
      batchId,
      batchName,
      acceptedContacts: accepted.length,
      rejectedContacts: parsed.rejected.length,
      senderAccountId: account.id,
      fromEmail: getOutreachAccountFromEmail(account).trim(),
      replyToEmail: reply.replyToEmail,
      chunkSize,
    },
  });
  await enqueueOutreachJob({
    runId: run.id,
    jobType: "manual_batch_dispatch",
    executeAfter: nowIso(),
    maxAttempts: 10,
    payload: {
      batchId,
      chunkSize,
      senderAccountId: account.id,
    },
  });

  return {
    batchId,
    run,
    campaign,
    accepted,
    rejected: parsed.rejected,
    messages,
  };
}

export async function processManualBatchDispatchJob(job: OutreachRunJob) {
  const run = await getOutreachRun(job.runId);
  if (!run) return;
  if (!isManualBatchRunExternalRef(run.externalRef)) {
    throw new Error("Manual batch dispatch job does not reference a manual batch run.");
  }
  if (["canceled", "completed", "failed", "preflight_failed"].includes(run.status)) return;
  if (!outboundSendingEnabled()) {
    const reason = "Manual batch paused: OUTBOUND_SENDING_ENABLED is off.";
    await updateOutreachRun(run.id, { status: "paused", pauseReason: reason, lastError: reason });
    await createOutreachEvent({
      runId: run.id,
      eventType: "manual_batch_paused",
      payload: { reason: "outbound_sending_disabled", summary: reason },
    });
    return;
  }

  const account = await getOutreachAccount(run.accountId);
  if (!account || account.provider !== "customerio") {
    throw new Error("Manual batch dispatch requires a Customer.io sender account.");
  }
  const secrets = await getOutreachAccountSecrets(account.id);
  if (!secrets?.customerIoAppApiKey.trim()) {
    throw new Error("Customer.io App API key missing for manual batch sender.");
  }
  const reply = await resolveReplyToEmail({ brandId: run.brandId, account });
  if (!reply.replyToEmail) {
    throw new Error("Reply-To email missing for manual batch sender.");
  }

  await updateOutreachRun(run.id, { status: "sending", pauseReason: "", lastError: "" });
  const [messages, leads] = await Promise.all([listRunMessages(run.id), listRunLeads(run.id)]);
  const leadById = new Map(leads.map((lead) => [lead.id, lead] as const));
  const pending = messages
    .filter((message) => message.status === "scheduled")
    .sort((left, right) => (left.scheduledAt < right.scheduledAt ? -1 : 1));
  const chunkSize = clampInt(
    asRecord(job.payload).chunkSize,
    DEFAULT_MANUAL_BATCH_CHUNK_SIZE,
    1,
    MAX_MANUAL_BATCH_CHUNK_SIZE
  );
  const batchId = String(asRecord(job.payload).batchId ?? manualBatchIdFromRun(run));

  for (const message of pending.slice(0, chunkSize)) {
    const lead = leadById.get(message.leadId) ?? null;
    if (!lead?.email) {
      await updateRunMessage(message.id, { status: "failed", lastError: "Lead email missing" });
      continue;
    }
    const suppressionReason = getLeadEmailSuppressionReason(lead.email);
    if (suppressionReason) {
      await updateRunMessage(message.id, {
        status: "canceled",
        lastError: `Lead blocked by manual-batch suppression: ${suppressionReason}`,
      });
      await updateRunLead(lead.id, { status: "suppressed" });
      await createOutreachEvent({
        runId: run.id,
        eventType: "manual_batch_lead_suppressed",
        payload: { batchId, messageId: message.id, email: lead.email, suppressionReason },
      });
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
      manualBatch: true,
      batchId,
      senderAccountId: account.id,
      senderAccountName: account.name,
      senderFromEmail: getOutreachAccountFromEmail(account).trim(),
      replyToEmail: reply.replyToEmail,
    };

    if (send.ok) {
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
        eventType: "manual_batch_message_sent",
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
      await updateRunMessage(message.id, {
        status: "failed",
        lastError: send.error,
        generationMeta,
      });
      await createOutreachEvent({
        runId: run.id,
        eventType: "manual_batch_dispatch_failed",
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

  const refreshed = await refreshManualBatchRunMetrics(run);
  const remaining = refreshed.messages.filter((message) => message.status === "scheduled").length;
  if (remaining > 0) {
    await enqueueOutreachJob({
      runId: run.id,
      jobType: "manual_batch_dispatch",
      executeAfter: nowIso(),
      maxAttempts: 10,
      payload: {
        batchId,
        chunkSize,
        remaining,
      },
    });
    return;
  }
  await enqueueOutreachJob({ runId: run.id, jobType: "sync_replies", executeAfter: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  await enqueueOutreachJob({ runId: run.id, jobType: "analyze_run", executeAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
}

async function summarizeManualBatchRun(input: {
  run: OutreachRun;
  campaigns: ScaleCampaignRecord[];
}): Promise<ManualBatchSummary> {
  const [messages, leads, { threads }, jobs, account] = await Promise.all([
    listRunMessages(input.run.id),
    listRunLeads(input.run.id),
    listReplyThreadsByBrand(input.run.brandId),
    listRunJobs(input.run.id, 50),
    getOutreachAccount(input.run.accountId).catch(() => null),
  ]);
  const runThreads = threads.filter((thread) => thread.runId === input.run.id);
  const latestReplyAt =
    runThreads
      .map((thread) => thread.lastMessageAt)
      .filter(Boolean)
      .sort((left, right) => (left < right ? 1 : -1))[0] ?? "";
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
    activeJobTypes: jobs.filter((job) => ["queued", "running"].includes(job.status)).map((job) => job.jobType),
  };
}

export async function listManualBatches(brandId: string, limit = 25): Promise<ManualBatchSummary[]> {
  const [runs, campaigns] = await Promise.all([
    listBrandRuns(brandId),
    listStoredScaleCampaignRecords(brandId),
  ]);
  const manualRuns = runs
    .filter((run) => isManualBatchRunExternalRef(run.externalRef))
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))
    .slice(0, Math.max(1, Math.min(100, Math.round(Number(limit) || 25))));
  return Promise.all(manualRuns.map((run) => summarizeManualBatchRun({ run, campaigns })));
}
