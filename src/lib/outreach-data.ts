import { mkdir, readFile, writeFile } from "fs/promises";
import { createId } from "@/lib/factory-data";
import { decryptJson, encryptJson } from "@/lib/outreach-encryption";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  BrandOutreachAssignment,
  OutreachAccount,
  OutreachAccountConfig,
  OutreachMessage,
  OutreachRun,
  OutreachRunLead,
  ReplyDraft,
  ReplyMessage,
  ReplyThread,
  RunAnomaly,
} from "@/lib/factory-types";

export type OutreachAccountSecrets = {
  customerIoTrackApiKey: string;
  customerIoAppApiKey: string;
  apifyToken: string;
  mailboxAccessToken: string;
  mailboxRefreshToken: string;
  mailboxPassword: string;
};

export type OutreachJobType =
  | "source_leads"
  | "schedule_messages"
  | "dispatch_messages"
  | "sync_replies"
  | "analyze_run";

export type OutreachJobStatus = "queued" | "running" | "completed" | "failed";

export type OutreachJob = {
  id: string;
  runId: string;
  jobType: OutreachJobType;
  status: OutreachJobStatus;
  executeAfter: string;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

export type OutreachEvent = {
  id: string;
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

type StoredAccount = Omit<OutreachAccount, "hasCredentials"> & {
  credentialsEncrypted: string;
};

type OutreachStore = {
  accounts: StoredAccount[];
  assignments: BrandOutreachAssignment[];
  runs: OutreachRun[];
  runLeads: OutreachRunLead[];
  messages: OutreachMessage[];
  replyThreads: ReplyThread[];
  replyMessages: ReplyMessage[];
  replyDrafts: ReplyDraft[];
  anomalies: RunAnomaly[];
  events: OutreachEvent[];
  jobs: OutreachJob[];
};

const isVercel = Boolean(process.env.VERCEL);
const OUTREACH_PATH = isVercel
  ? "/tmp/factory_outreach.v1.json"
  : `${process.cwd()}/data/outreach.v1.json`;

const TABLE_ACCOUNT = "demanddev_outreach_accounts";
const TABLE_ASSIGNMENT = "demanddev_brand_outreach_assignments";
const TABLE_RUN = "demanddev_outreach_runs";
const TABLE_RUN_LEAD = "demanddev_outreach_run_leads";
const TABLE_MESSAGE = "demanddev_outreach_messages";
const TABLE_THREAD = "demanddev_reply_threads";
const TABLE_REPLY_MESSAGE = "demanddev_reply_messages";
const TABLE_REPLY_DRAFT = "demanddev_reply_drafts";
const TABLE_EVENT = "demanddev_outreach_events";
const TABLE_JOB = "demanddev_outreach_job_queue";
const TABLE_ANOMALY = "demanddev_run_anomalies";

const nowIso = () => new Date().toISOString();

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function defaultOutreachStore(): OutreachStore {
  return {
    accounts: [],
    assignments: [],
    runs: [],
    runLeads: [],
    messages: [],
    replyThreads: [],
    replyMessages: [],
    replyDrafts: [],
    anomalies: [],
    events: [],
    jobs: [],
  };
}

function sanitizeAccountConfig(value: unknown): OutreachAccountConfig {
  const row = asRecord(value);
  const customerIo = asRecord(row.customerIo);
  const apify = asRecord(row.apify);
  const mailbox = asRecord(row.mailbox);

  return {
    customerIo: {
      siteId: String(customerIo.siteId ?? "").trim(),
      workspaceId: String(customerIo.workspaceId ?? "").trim(),
    },
    apify: {
      defaultActorId: String(apify.defaultActorId ?? "").trim(),
    },
    mailbox: {
      provider: ["gmail", "outlook", "imap"].includes(String(mailbox.provider))
        ? (String(mailbox.provider) as OutreachAccountConfig["mailbox"]["provider"])
        : "gmail",
      email: String(mailbox.email ?? "").trim(),
      status: ["connected", "disconnected", "error"].includes(String(mailbox.status))
        ? (String(mailbox.status) as OutreachAccountConfig["mailbox"]["status"])
        : "disconnected",
      host: String(mailbox.host ?? "").trim(),
      port: Number(mailbox.port ?? 993),
      secure: Boolean(mailbox.secure ?? true),
    },
  };
}

function defaultSecrets(): OutreachAccountSecrets {
  return {
    customerIoTrackApiKey: "",
    customerIoAppApiKey: "",
    apifyToken: "",
    mailboxAccessToken: "",
    mailboxRefreshToken: "",
    mailboxPassword: "",
  };
}

function sanitizeSecrets(value: unknown): OutreachAccountSecrets {
  const row = asRecord(value);
  return {
    customerIoTrackApiKey: String(row.customerIoTrackApiKey ?? "").trim(),
    customerIoAppApiKey: String(row.customerIoAppApiKey ?? "").trim(),
    apifyToken: String(row.apifyToken ?? "").trim(),
    mailboxAccessToken: String(row.mailboxAccessToken ?? "").trim(),
    mailboxRefreshToken: String(row.mailboxRefreshToken ?? "").trim(),
    mailboxPassword: String(row.mailboxPassword ?? "").trim(),
  };
}

function hasSecretValues(secrets: OutreachAccountSecrets) {
  return Object.values(secrets).some((value) => value.trim().length > 0);
}

function mapStoredAccount(row: StoredAccount): OutreachAccount {
  const secrets = decryptJson<OutreachAccountSecrets>(row.credentialsEncrypted, defaultSecrets());
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    status: row.status,
    config: sanitizeAccountConfig(row.config),
    hasCredentials: hasSecretValues(secrets),
    lastTestAt: row.lastTestAt,
    lastTestStatus: row.lastTestStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAccountRowFromDb(input: unknown): StoredAccount {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    provider: "customerio",
    status: String(row.status ?? "active") === "inactive" ? "inactive" : "active",
    config: sanitizeAccountConfig(row.config),
    credentialsEncrypted: String(row.credentials_encrypted ?? row.credentialsEncrypted ?? ""),
    lastTestAt: String(row.last_test_at ?? row.lastTestAt ?? ""),
    lastTestStatus: ["unknown", "pass", "fail"].includes(String(row.last_test_status ?? row.lastTestStatus))
      ? (String(row.last_test_status ?? row.lastTestStatus) as OutreachAccount["lastTestStatus"])
      : "unknown",
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapRunMetrics(value: unknown): OutreachRun["metrics"] {
  const row = asRecord(value);
  return {
    sourcedLeads: Number(row.sourcedLeads ?? 0),
    scheduledMessages: Number(row.scheduledMessages ?? 0),
    sentMessages: Number(row.sentMessages ?? 0),
    bouncedMessages: Number(row.bouncedMessages ?? 0),
    failedMessages: Number(row.failedMessages ?? 0),
    replies: Number(row.replies ?? 0),
    positiveReplies: Number(row.positiveReplies ?? 0),
    negativeReplies: Number(row.negativeReplies ?? 0),
  };
}

function defaultRunMetrics(): OutreachRun["metrics"] {
  return {
    sourcedLeads: 0,
    scheduledMessages: 0,
    sentMessages: 0,
    bouncedMessages: 0,
    failedMessages: 0,
    replies: 0,
    positiveReplies: 0,
    negativeReplies: 0,
  };
}

function mapRunRow(input: unknown): OutreachRun {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    campaignId: String(row.campaign_id ?? row.campaignId ?? ""),
    experimentId: String(row.experiment_id ?? row.experimentId ?? ""),
    hypothesisId: String(row.hypothesis_id ?? row.hypothesisId ?? ""),
    accountId: String(row.account_id ?? row.accountId ?? ""),
    status: [
      "queued",
      "preflight_failed",
      "sourcing",
      "scheduled",
      "sending",
      "monitoring",
      "paused",
      "completed",
      "canceled",
      "failed",
    ].includes(String(row.status))
      ? (String(row.status) as OutreachRun["status"])
      : "queued",
    cadence: "3_step_7_day",
    dailyCap: Number(row.daily_cap ?? row.dailyCap ?? 30),
    hourlyCap: Number(row.hourly_cap ?? row.hourlyCap ?? 6),
    timezone: String(row.timezone ?? "America/Los_Angeles"),
    minSpacingMinutes: Number(row.min_spacing_minutes ?? row.minSpacingMinutes ?? 8),
    pauseReason: String(row.pause_reason ?? row.pauseReason ?? ""),
    lastError: String(row.last_error ?? row.lastError ?? ""),
    externalRef: String(row.external_ref ?? row.externalRef ?? ""),
    metrics: row.metrics ? mapRunMetrics(row.metrics) : defaultRunMetrics(),
    startedAt: String(row.started_at ?? row.startedAt ?? ""),
    completedAt: String(row.completed_at ?? row.completedAt ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapRunLeadRow(input: unknown): OutreachRunLead {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    campaignId: String(row.campaign_id ?? row.campaignId ?? ""),
    email: String(row.email ?? ""),
    name: String(row.name ?? ""),
    company: String(row.company ?? ""),
    title: String(row.title ?? ""),
    domain: String(row.domain ?? ""),
    sourceUrl: String(row.source_url ?? row.sourceUrl ?? ""),
    status: ["new", "suppressed", "scheduled", "sent", "replied", "bounced", "unsubscribed"].includes(
      String(row.status)
    )
      ? (String(row.status) as OutreachRunLead["status"])
      : "new",
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapMessageRow(input: unknown): OutreachMessage {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    campaignId: String(row.campaign_id ?? row.campaignId ?? ""),
    leadId: String(row.lead_id ?? row.leadId ?? ""),
    step: Number(row.step ?? 1),
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    status: ["scheduled", "sent", "failed", "bounced", "replied", "canceled"].includes(String(row.status))
      ? (String(row.status) as OutreachMessage["status"])
      : "scheduled",
    providerMessageId: String(row.provider_message_id ?? row.providerMessageId ?? ""),
    scheduledAt: String(row.scheduled_at ?? row.scheduledAt ?? nowIso()),
    sentAt: String(row.sent_at ?? row.sentAt ?? ""),
    lastError: String(row.last_error ?? row.lastError ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapThreadRow(input: unknown): ReplyThread {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    campaignId: String(row.campaign_id ?? row.campaignId ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    leadId: String(row.lead_id ?? row.leadId ?? ""),
    subject: String(row.subject ?? ""),
    sentiment: ["positive", "neutral", "negative"].includes(String(row.sentiment))
      ? (String(row.sentiment) as ReplyThread["sentiment"])
      : "neutral",
    status: ["new", "open", "closed"].includes(String(row.status))
      ? (String(row.status) as ReplyThread["status"])
      : "new",
    intent: ["question", "interest", "objection", "unsubscribe", "other"].includes(String(row.intent))
      ? (String(row.intent) as ReplyThread["intent"])
      : "other",
    lastMessageAt: String(row.last_message_at ?? row.lastMessageAt ?? nowIso()),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapReplyMessageRow(input: unknown): ReplyMessage {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    threadId: String(row.thread_id ?? row.threadId ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    direction: String(row.direction) === "outbound" ? "outbound" : "inbound",
    from: String(row.sender ?? row.from ?? ""),
    to: String(row.recipient ?? row.to ?? ""),
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    providerMessageId: String(row.provider_message_id ?? row.providerMessageId ?? ""),
    receivedAt: String(row.received_at ?? row.receivedAt ?? nowIso()),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
  };
}

function mapDraftRow(input: unknown): ReplyDraft {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    threadId: String(row.thread_id ?? row.threadId ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    status: ["draft", "sent", "dismissed"].includes(String(row.status))
      ? (String(row.status) as ReplyDraft["status"])
      : "draft",
    reason: String(row.reason ?? ""),
    sentAt: String(row.sent_at ?? row.sentAt ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapAnomalyRow(input: unknown): RunAnomaly {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    type: ["hard_bounce_rate", "spam_complaint_rate", "provider_error_rate", "negative_reply_rate_spike"].includes(
      String(row.type)
    )
      ? (String(row.type) as RunAnomaly["type"])
      : "provider_error_rate",
    severity: String(row.severity) === "critical" ? "critical" : "warning",
    status: ["active", "acknowledged", "resolved"].includes(String(row.status))
      ? (String(row.status) as RunAnomaly["status"])
      : "active",
    threshold: Number(row.threshold ?? 0),
    observed: Number(row.observed ?? 0),
    details: String(row.details ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapJobRow(input: unknown): OutreachJob {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    jobType: ["source_leads", "schedule_messages", "dispatch_messages", "sync_replies", "analyze_run"].includes(
      String(row.job_type ?? row.jobType)
    )
      ? (String(row.job_type ?? row.jobType) as OutreachJobType)
      : "analyze_run",
    status: ["queued", "running", "completed", "failed"].includes(String(row.status))
      ? (String(row.status) as OutreachJobStatus)
      : "queued",
    executeAfter: String(row.execute_after ?? row.executeAfter ?? nowIso()),
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? row.maxAttempts ?? 5),
    payload: asRecord(row.payload),
    lastError: String(row.last_error ?? row.lastError ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapEventRow(input: unknown): OutreachEvent {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    eventType: String(row.event_type ?? row.eventType ?? ""),
    payload: asRecord(row.payload),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
  };
}

async function readLocalStore(): Promise<OutreachStore> {
  try {
    const raw = await readFile(OUTREACH_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const row = asRecord(parsed);
    return {
      accounts: asArray(row.accounts).map((item) => mapAccountRowFromDb(item)),
      assignments: asArray(row.assignments).map((entry) => {
        const item = asRecord(entry);
        return {
          brandId: String(item.brandId ?? item.brand_id ?? ""),
          accountId: String(item.accountId ?? item.account_id ?? ""),
          createdAt: String(item.createdAt ?? item.created_at ?? nowIso()),
          updatedAt: String(item.updatedAt ?? item.updated_at ?? nowIso()),
        };
      }),
      runs: asArray(row.runs).map((item) => mapRunRow(item)),
      runLeads: asArray(row.runLeads).map((item) => mapRunLeadRow(item)),
      messages: asArray(row.messages).map((item) => mapMessageRow(item)),
      replyThreads: asArray(row.replyThreads).map((item) => mapThreadRow(item)),
      replyMessages: asArray(row.replyMessages).map((item) => mapReplyMessageRow(item)),
      replyDrafts: asArray(row.replyDrafts).map((item) => mapDraftRow(item)),
      anomalies: asArray(row.anomalies).map((item) => mapAnomalyRow(item)),
      events: asArray(row.events).map((item) => mapEventRow(item)),
      jobs: asArray(row.jobs).map((item) => mapJobRow(item)),
    };
  } catch {
    return defaultOutreachStore();
  }
}

async function writeLocalStore(store: OutreachStore) {
  if (!isVercel) {
    await mkdir(`${process.cwd()}/data`, { recursive: true });
  }
  await writeFile(OUTREACH_PATH, JSON.stringify(store, null, 2));
}

function buildStoredAccount(input: {
  id?: string;
  name: string;
  status?: OutreachAccount["status"];
  config?: unknown;
  credentialsEncrypted: string;
  lastTestAt?: string;
  lastTestStatus?: OutreachAccount["lastTestStatus"];
  createdAt?: string;
  updatedAt?: string;
}): StoredAccount {
  const now = nowIso();
  return {
    id: input.id ?? createId("acct"),
    name: input.name.trim(),
    provider: "customerio",
    status: input.status ?? "active",
    config: sanitizeAccountConfig(input.config),
    credentialsEncrypted: input.credentialsEncrypted,
    lastTestAt: input.lastTestAt ?? "",
    lastTestStatus: input.lastTestStatus ?? "unknown",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

export async function listOutreachAccounts(): Promise<OutreachAccount[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ACCOUNT)
      .select("*")
      .order("updated_at", { ascending: false });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapStoredAccount(mapAccountRowFromDb(row)));
    }
  }

  const store = await readLocalStore();
  return store.accounts.map((row) => mapStoredAccount(row));
}

export async function getOutreachAccount(accountId: string): Promise<OutreachAccount | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ACCOUNT)
      .select("*")
      .eq("id", accountId)
      .maybeSingle();
    if (!error && data) {
      return mapStoredAccount(mapAccountRowFromDb(data));
    }
  }

  const store = await readLocalStore();
  const hit = store.accounts.find((row) => row.id === accountId);
  return hit ? mapStoredAccount(hit) : null;
}

export async function getOutreachAccountSecrets(accountId: string): Promise<OutreachAccountSecrets | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ACCOUNT)
      .select("id, credentials_encrypted")
      .eq("id", accountId)
      .maybeSingle();
    if (!error && data) {
      return decryptJson<OutreachAccountSecrets>(
        String((data as Record<string, unknown>).credentials_encrypted ?? ""),
        defaultSecrets()
      );
    }
  }

  const store = await readLocalStore();
  const hit = store.accounts.find((row) => row.id === accountId);
  if (!hit) return null;
  return decryptJson<OutreachAccountSecrets>(hit.credentialsEncrypted, defaultSecrets());
}

export async function createOutreachAccount(input: {
  name: string;
  status?: OutreachAccount["status"];
  config?: unknown;
  credentials?: unknown;
}): Promise<OutreachAccount> {
  const now = nowIso();
  const secrets = sanitizeSecrets(input.credentials);
  const stored = buildStoredAccount({
    name: input.name,
    status: input.status,
    config: input.config,
    credentialsEncrypted: encryptJson(secrets),
    createdAt: now,
    updatedAt: now,
  });

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ACCOUNT)
      .insert({
        id: stored.id,
        name: stored.name,
        provider: stored.provider,
        status: stored.status,
        config: stored.config,
        credentials_encrypted: stored.credentialsEncrypted,
        last_test_at: null,
        last_test_status: stored.lastTestStatus,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapStoredAccount(mapAccountRowFromDb(data));
    }
  }

  const store = await readLocalStore();
  store.accounts.unshift(stored);
  await writeLocalStore(store);
  return mapStoredAccount(stored);
}

export async function updateOutreachAccount(
  accountId: string,
  patch: {
    name?: string;
    status?: OutreachAccount["status"];
    config?: unknown;
    credentials?: unknown;
    lastTestAt?: string;
    lastTestStatus?: OutreachAccount["lastTestStatus"];
  }
): Promise<OutreachAccount | null> {
  const existingAccount = await getOutreachAccount(accountId);
  if (!existingAccount) return null;
  const existingSecrets = (await getOutreachAccountSecrets(accountId)) ?? defaultSecrets();
  const patchSecrets = sanitizeSecrets(patch.credentials);
  const mergedSecrets: OutreachAccountSecrets = {
    customerIoTrackApiKey: patchSecrets.customerIoTrackApiKey || existingSecrets.customerIoTrackApiKey,
    customerIoAppApiKey: patchSecrets.customerIoAppApiKey || existingSecrets.customerIoAppApiKey,
    apifyToken: patchSecrets.apifyToken || existingSecrets.apifyToken,
    mailboxAccessToken: patchSecrets.mailboxAccessToken || existingSecrets.mailboxAccessToken,
    mailboxRefreshToken: patchSecrets.mailboxRefreshToken || existingSecrets.mailboxRefreshToken,
    mailboxPassword: patchSecrets.mailboxPassword || existingSecrets.mailboxPassword,
  };

  const nextConfig = patch.config
    ? sanitizeAccountConfig({ ...existingAccount.config, ...asRecord(patch.config) })
    : existingAccount.config;
  const now = nowIso();

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = {
      config: nextConfig,
      credentials_encrypted: encryptJson(mergedSecrets),
      updated_at: now,
    };
    if (typeof patch.name === "string") update.name = patch.name.trim();
    if (patch.status) update.status = patch.status;
    if (patch.lastTestAt !== undefined) update.last_test_at = patch.lastTestAt || null;
    if (patch.lastTestStatus) update.last_test_status = patch.lastTestStatus;

    const { data, error } = await supabase
      .from(TABLE_ACCOUNT)
      .update(update)
      .eq("id", accountId)
      .select("*")
      .maybeSingle();

    if (!error && data) {
      return mapStoredAccount(mapAccountRowFromDb(data));
    }
  }

  const store = await readLocalStore();
  const idx = store.accounts.findIndex((row) => row.id === accountId);
  if (idx < 0) return null;
  const current = store.accounts[idx];
  const nextStored: StoredAccount = {
    ...current,
    name: typeof patch.name === "string" ? patch.name.trim() : current.name,
    status: patch.status ?? current.status,
    config: nextConfig,
    credentialsEncrypted: encryptJson(mergedSecrets),
    lastTestAt: patch.lastTestAt ?? current.lastTestAt,
    lastTestStatus: patch.lastTestStatus ?? current.lastTestStatus,
    updatedAt: now,
  };
  store.accounts[idx] = nextStored;
  await writeLocalStore(store);
  return mapStoredAccount(nextStored);
}

export async function deleteOutreachAccount(accountId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase.from(TABLE_ASSIGNMENT).delete().eq("account_id", accountId);
    const { error } = await supabase.from(TABLE_ACCOUNT).delete().eq("id", accountId);
    if (!error) {
      return true;
    }
  }

  const store = await readLocalStore();
  const before = store.accounts.length;
  store.accounts = store.accounts.filter((row) => row.id !== accountId);
  store.assignments = store.assignments.filter((row) => row.accountId !== accountId);
  await writeLocalStore(store);
  return store.accounts.length !== before;
}

export async function getBrandOutreachAssignment(
  brandId: string
): Promise<BrandOutreachAssignment | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ASSIGNMENT)
      .select("*")
      .eq("brand_id", brandId)
      .maybeSingle();
    if (!error && data) {
      const row = asRecord(data);
      return {
        brandId: String(row.brand_id ?? ""),
        accountId: String(row.account_id ?? ""),
        createdAt: String(row.created_at ?? nowIso()),
        updatedAt: String(row.updated_at ?? nowIso()),
      };
    }
  }

  const store = await readLocalStore();
  return store.assignments.find((row) => row.brandId === brandId) ?? null;
}

export async function setBrandOutreachAssignment(
  brandId: string,
  accountId: string
): Promise<BrandOutreachAssignment | null> {
  if (!accountId.trim()) {
    const supabaseDelete = getSupabaseAdmin();
    if (supabaseDelete) {
      await supabaseDelete.from(TABLE_ASSIGNMENT).delete().eq("brand_id", brandId);
      return null;
    }

    const storeDelete = await readLocalStore();
    storeDelete.assignments = storeDelete.assignments.filter((row) => row.brandId !== brandId);
    await writeLocalStore(storeDelete);
    return null;
  }

  const now = nowIso();
  const assignment: BrandOutreachAssignment = {
    brandId,
    accountId,
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ASSIGNMENT)
      .upsert({ brand_id: brandId, account_id: accountId }, { onConflict: "brand_id" })
      .select("*")
      .single();
    if (!error && data) {
      const row = asRecord(data);
      return {
        brandId: String(row.brand_id ?? brandId),
        accountId: String(row.account_id ?? accountId),
        createdAt: String(row.created_at ?? now),
        updatedAt: String(row.updated_at ?? now),
      };
    }
  }

  const store = await readLocalStore();
  const existingIndex = store.assignments.findIndex((row) => row.brandId === brandId);
  if (existingIndex >= 0) {
    store.assignments[existingIndex] = {
      ...store.assignments[existingIndex],
      accountId,
      updatedAt: now,
    };
  } else {
    store.assignments.push(assignment);
  }
  await writeLocalStore(store);
  return store.assignments.find((row) => row.brandId === brandId) ?? assignment;
}

export async function createOutreachRun(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
  hypothesisId: string;
  accountId: string;
  status?: OutreachRun["status"];
  cadence?: OutreachRun["cadence"];
  dailyCap?: number;
  hourlyCap?: number;
  timezone?: string;
  minSpacingMinutes?: number;
  externalRef?: string;
  pauseReason?: string;
  lastError?: string;
}): Promise<OutreachRun> {
  const now = nowIso();
  const run: OutreachRun = {
    id: createId("run"),
    brandId: input.brandId,
    campaignId: input.campaignId,
    experimentId: input.experimentId,
    hypothesisId: input.hypothesisId,
    accountId: input.accountId,
    status: input.status ?? "queued",
    cadence: input.cadence ?? "3_step_7_day",
    dailyCap: Number(input.dailyCap ?? 30),
    hourlyCap: Number(input.hourlyCap ?? 6),
    timezone: input.timezone ?? "America/Los_Angeles",
    minSpacingMinutes: Number(input.minSpacingMinutes ?? 8),
    pauseReason: input.pauseReason ?? "",
    lastError: input.lastError ?? "",
    externalRef: input.externalRef ?? "",
    metrics: defaultRunMetrics(),
    startedAt: now,
    completedAt: "",
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_RUN)
      .insert({
        id: run.id,
        brand_id: run.brandId,
        campaign_id: run.campaignId,
        experiment_id: run.experimentId,
        hypothesis_id: run.hypothesisId,
        account_id: run.accountId,
        status: run.status,
        cadence: run.cadence,
        daily_cap: run.dailyCap,
        hourly_cap: run.hourlyCap,
        timezone: run.timezone,
        min_spacing_minutes: run.minSpacingMinutes,
        pause_reason: run.pauseReason,
        last_error: run.lastError,
        external_ref: run.externalRef,
        metrics: run.metrics,
        started_at: run.startedAt,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapRunRow(data);
    }
  }

  const store = await readLocalStore();
  store.runs.unshift(run);
  await writeLocalStore(store);
  return run;
}

export async function updateOutreachRun(
  runId: string,
  patch: Partial<
    Pick<
      OutreachRun,
      | "status"
      | "dailyCap"
      | "hourlyCap"
      | "timezone"
      | "minSpacingMinutes"
      | "pauseReason"
      | "lastError"
      | "externalRef"
      | "metrics"
      | "completedAt"
    >
  >
): Promise<OutreachRun | null> {
  const now = nowIso();

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status) update.status = patch.status;
    if (patch.dailyCap !== undefined) update.daily_cap = patch.dailyCap;
    if (patch.hourlyCap !== undefined) update.hourly_cap = patch.hourlyCap;
    if (patch.timezone !== undefined) update.timezone = patch.timezone;
    if (patch.minSpacingMinutes !== undefined) update.min_spacing_minutes = patch.minSpacingMinutes;
    if (patch.pauseReason !== undefined) update.pause_reason = patch.pauseReason;
    if (patch.lastError !== undefined) update.last_error = patch.lastError;
    if (patch.externalRef !== undefined) update.external_ref = patch.externalRef;
    if (patch.metrics) update.metrics = patch.metrics;
    if (patch.completedAt !== undefined) update.completed_at = patch.completedAt || null;

    const { data, error } = await supabase
      .from(TABLE_RUN)
      .update(update)
      .eq("id", runId)
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapRunRow(data);
    }
  }

  const store = await readLocalStore();
  const idx = store.runs.findIndex((row) => row.id === runId);
  if (idx < 0) return null;
  store.runs[idx] = {
    ...store.runs[idx],
    ...patch,
    updatedAt: now,
  };
  await writeLocalStore(store);
  return store.runs[idx];
}

export async function getOutreachRun(runId: string): Promise<OutreachRun | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_RUN)
      .select("*")
      .eq("id", runId)
      .maybeSingle();
    if (!error && data) {
      return mapRunRow(data);
    }
  }

  const store = await readLocalStore();
  return store.runs.find((row) => row.id === runId) ?? null;
}

export async function listCampaignRuns(
  brandId: string,
  campaignId: string
): Promise<OutreachRun[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_RUN)
      .select("*")
      .eq("brand_id", brandId)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapRunRow(row));
    }
  }

  const store = await readLocalStore();
  return store.runs
    .filter((row) => row.brandId === brandId && row.campaignId === campaignId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listExperimentRuns(
  brandId: string,
  campaignId: string,
  experimentId: string
): Promise<OutreachRun[]> {
  const all = await listCampaignRuns(brandId, campaignId);
  return all.filter((row) => row.experimentId === experimentId);
}

export async function upsertRunLeads(
  runId: string,
  brandId: string,
  campaignId: string,
  leads: Array<Pick<OutreachRunLead, "email" | "name" | "company" | "title" | "domain" | "sourceUrl">>
): Promise<OutreachRunLead[]> {
  const dedup = new Map<string, Pick<OutreachRunLead, "email" | "name" | "company" | "title" | "domain" | "sourceUrl">>();
  for (const lead of leads) {
    const email = lead.email.trim().toLowerCase();
    if (!email) continue;
    dedup.set(email, {
      email,
      name: lead.name.trim(),
      company: lead.company.trim(),
      title: lead.title.trim(),
      domain: lead.domain.trim(),
      sourceUrl: lead.sourceUrl.trim(),
    });
  }

  const now = nowIso();
  const rows = [...dedup.values()].map((lead) => ({
    id: createId("lead"),
    run_id: runId,
    brand_id: brandId,
    campaign_id: campaignId,
    email: lead.email,
    name: lead.name,
    company: lead.company,
    title: lead.title,
    domain: lead.domain,
    source_url: lead.sourceUrl,
    status: "new",
    updated_at: now,
  }));

  const supabase = getSupabaseAdmin();
  if (supabase) {
    if (rows.length > 0) {
      const { error } = await supabase
        .from(TABLE_RUN_LEAD)
        .upsert(rows, { onConflict: "run_id,email" });
      if (error) {
        // fallback below
      }
    }

    const { data, error } = await supabase
      .from(TABLE_RUN_LEAD)
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    if (!error) {
      return (data ?? []).map((entry: unknown) => mapRunLeadRow(entry));
    }
  }

  const store = await readLocalStore();
  for (const lead of dedup.values()) {
    const existing = store.runLeads.find(
      (row) => row.runId === runId && row.email.toLowerCase() === lead.email.toLowerCase()
    );
    if (existing) {
      existing.name = lead.name || existing.name;
      existing.company = lead.company || existing.company;
      existing.title = lead.title || existing.title;
      existing.domain = lead.domain || existing.domain;
      existing.sourceUrl = lead.sourceUrl || existing.sourceUrl;
      existing.updatedAt = now;
    } else {
      store.runLeads.push({
        id: createId("lead"),
        runId,
        brandId,
        campaignId,
        email: lead.email,
        name: lead.name,
        company: lead.company,
        title: lead.title,
        domain: lead.domain,
        sourceUrl: lead.sourceUrl,
        status: "new",
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  await writeLocalStore(store);
  return store.runLeads.filter((row) => row.runId === runId);
}

export async function listRunLeads(runId: string): Promise<OutreachRunLead[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_RUN_LEAD)
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    if (!error) {
      return (data ?? []).map((entry: unknown) => mapRunLeadRow(entry));
    }
  }

  const store = await readLocalStore();
  return store.runLeads.filter((row) => row.runId === runId);
}

export async function updateRunLead(
  leadId: string,
  patch: Partial<Pick<OutreachRunLead, "status">>
): Promise<OutreachRunLead | null> {
  const now = nowIso();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status) update.status = patch.status;
    const { data, error } = await supabase
      .from(TABLE_RUN_LEAD)
      .update(update)
      .eq("id", leadId)
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapRunLeadRow(data);
    }
  }

  const store = await readLocalStore();
  const idx = store.runLeads.findIndex((row) => row.id === leadId);
  if (idx < 0) return null;
  store.runLeads[idx] = {
    ...store.runLeads[idx],
    ...patch,
    updatedAt: now,
  };
  await writeLocalStore(store);
  return store.runLeads[idx];
}

export async function createRunMessages(
  messages: Array<
    Pick<
      OutreachMessage,
      | "runId"
      | "brandId"
      | "campaignId"
      | "leadId"
      | "step"
      | "subject"
      | "body"
      | "status"
      | "scheduledAt"
    >
  >
): Promise<OutreachMessage[]> {
  const now = nowIso();
  const rows = messages.map((item) => ({
    id: createId("msg"),
    run_id: item.runId,
    brand_id: item.brandId,
    campaign_id: item.campaignId,
    lead_id: item.leadId,
    step: item.step,
    subject: item.subject,
    body: item.body,
    status: item.status,
    provider_message_id: "",
    scheduled_at: item.scheduledAt,
    sent_at: null,
    last_error: "",
    created_at: now,
    updated_at: now,
  }));

  const supabase = getSupabaseAdmin();
  if (supabase) {
    if (rows.length > 0) {
      const { data, error } = await supabase
        .from(TABLE_MESSAGE)
        .insert(rows)
        .select("*");
      if (!error && data) {
        return (data ?? []).map((row: unknown) => mapMessageRow(row));
      }
    }
  }

  const store = await readLocalStore();
  const mapped = rows.map((row) =>
    mapMessageRow({
      ...row,
      runId: row.run_id,
      brandId: row.brand_id,
      campaignId: row.campaign_id,
      leadId: row.lead_id,
      providerMessageId: row.provider_message_id,
      scheduledAt: row.scheduled_at,
      sentAt: row.sent_at,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
  );
  store.messages.push(...mapped);
  await writeLocalStore(store);
  return mapped;
}

export async function listRunMessages(runId: string): Promise<OutreachMessage[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MESSAGE)
      .select("*")
      .eq("run_id", runId)
      .order("scheduled_at", { ascending: true });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapMessageRow(row));
    }
  }

  const store = await readLocalStore();
  return store.messages
    .filter((row) => row.runId === runId)
    .sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1));
}

export async function getRunMessage(messageId: string): Promise<OutreachMessage | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MESSAGE)
      .select("*")
      .eq("id", messageId)
      .maybeSingle();
    if (!error && data) {
      return mapMessageRow(data);
    }
  }

  const store = await readLocalStore();
  return store.messages.find((row) => row.id === messageId) ?? null;
}

export async function updateRunMessage(
  messageId: string,
  patch: Partial<Pick<OutreachMessage, "status" | "providerMessageId" | "sentAt" | "lastError">>
): Promise<OutreachMessage | null> {
  const now = nowIso();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status) update.status = patch.status;
    if (patch.providerMessageId !== undefined) update.provider_message_id = patch.providerMessageId;
    if (patch.sentAt !== undefined) update.sent_at = patch.sentAt || null;
    if (patch.lastError !== undefined) update.last_error = patch.lastError;

    const { data, error } = await supabase
      .from(TABLE_MESSAGE)
      .update(update)
      .eq("id", messageId)
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapMessageRow(data);
    }
  }

  const store = await readLocalStore();
  const idx = store.messages.findIndex((row) => row.id === messageId);
  if (idx < 0) return null;
  store.messages[idx] = {
    ...store.messages[idx],
    ...patch,
    updatedAt: now,
  };
  await writeLocalStore(store);
  return store.messages[idx];
}

export async function createReplyThread(input: {
  brandId: string;
  campaignId: string;
  runId: string;
  leadId: string;
  subject: string;
  sentiment: ReplyThread["sentiment"];
  intent: ReplyThread["intent"];
  status?: ReplyThread["status"];
}): Promise<ReplyThread> {
  const now = nowIso();
  const thread: ReplyThread = {
    id: createId("thread"),
    brandId: input.brandId,
    campaignId: input.campaignId,
    runId: input.runId,
    leadId: input.leadId,
    subject: input.subject,
    sentiment: input.sentiment,
    status: input.status ?? "new",
    intent: input.intent,
    lastMessageAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_THREAD)
      .insert({
        id: thread.id,
        brand_id: thread.brandId,
        campaign_id: thread.campaignId,
        run_id: thread.runId,
        lead_id: thread.leadId,
        subject: thread.subject,
        sentiment: thread.sentiment,
        status: thread.status,
        intent: thread.intent,
        last_message_at: thread.lastMessageAt,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapThreadRow(data);
    }
  }

  const store = await readLocalStore();
  store.replyThreads.unshift(thread);
  await writeLocalStore(store);
  return thread;
}

export async function updateReplyThread(
  threadId: string,
  patch: Partial<Pick<ReplyThread, "status" | "sentiment" | "intent" | "lastMessageAt">>
): Promise<ReplyThread | null> {
  const now = nowIso();

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status) update.status = patch.status;
    if (patch.sentiment) update.sentiment = patch.sentiment;
    if (patch.intent) update.intent = patch.intent;
    if (patch.lastMessageAt) update.last_message_at = patch.lastMessageAt;

    const { data, error } = await supabase
      .from(TABLE_THREAD)
      .update(update)
      .eq("id", threadId)
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapThreadRow(data);
    }
  }

  const store = await readLocalStore();
  const idx = store.replyThreads.findIndex((row) => row.id === threadId);
  if (idx < 0) return null;
  store.replyThreads[idx] = {
    ...store.replyThreads[idx],
    ...patch,
    updatedAt: now,
  };
  await writeLocalStore(store);
  return store.replyThreads[idx];
}

export async function createReplyMessage(input: {
  threadId: string;
  runId: string;
  direction: ReplyMessage["direction"];
  from: string;
  to: string;
  subject: string;
  body: string;
  providerMessageId?: string;
  receivedAt?: string;
}): Promise<ReplyMessage> {
  const now = nowIso();
  const message: ReplyMessage = {
    id: createId("rmsg"),
    threadId: input.threadId,
    runId: input.runId,
    direction: input.direction,
    from: input.from,
    to: input.to,
    subject: input.subject,
    body: input.body,
    providerMessageId: input.providerMessageId ?? "",
    receivedAt: input.receivedAt ?? now,
    createdAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_REPLY_MESSAGE)
      .insert({
        id: message.id,
        thread_id: message.threadId,
        run_id: message.runId,
        direction: message.direction,
        sender: message.from,
        recipient: message.to,
        subject: message.subject,
        body: message.body,
        provider_message_id: message.providerMessageId,
        received_at: message.receivedAt,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapReplyMessageRow(data);
    }
  }

  const store = await readLocalStore();
  store.replyMessages.unshift(message);
  await writeLocalStore(store);
  return message;
}

export async function listReplyThreadsByBrand(
  brandId: string
): Promise<{ threads: ReplyThread[]; drafts: ReplyDraft[] }> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const [threadsResult, draftsResult] = await Promise.all([
      supabase
        .from(TABLE_THREAD)
        .select("*")
        .eq("brand_id", brandId)
        .order("last_message_at", { ascending: false }),
      supabase
        .from(TABLE_REPLY_DRAFT)
        .select("*")
        .eq("brand_id", brandId)
        .order("created_at", { ascending: false }),
    ]);
    if (!threadsResult.error && !draftsResult.error) {
      return {
        threads: (threadsResult.data ?? []).map((row: unknown) => mapThreadRow(row)),
        drafts: (draftsResult.data ?? []).map((row: unknown) => mapDraftRow(row)),
      };
    }
  }

  const store = await readLocalStore();
  return {
    threads: store.replyThreads
      .filter((row) => row.brandId === brandId)
      .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1)),
    drafts: store.replyDrafts
      .filter((row) => row.brandId === brandId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  };
}

export async function getReplyThread(threadId: string): Promise<ReplyThread | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_THREAD)
      .select("*")
      .eq("id", threadId)
      .maybeSingle();
    if (!error && data) {
      return mapThreadRow(data);
    }
  }

  const store = await readLocalStore();
  return store.replyThreads.find((row) => row.id === threadId) ?? null;
}

export async function createReplyDraft(input: {
  threadId: string;
  brandId: string;
  runId: string;
  subject: string;
  body: string;
  reason: string;
}): Promise<ReplyDraft> {
  const now = nowIso();
  const draft: ReplyDraft = {
    id: createId("draft"),
    threadId: input.threadId,
    brandId: input.brandId,
    runId: input.runId,
    subject: input.subject,
    body: input.body,
    status: "draft",
    reason: input.reason,
    sentAt: "",
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_REPLY_DRAFT)
      .insert({
        id: draft.id,
        thread_id: draft.threadId,
        brand_id: draft.brandId,
        run_id: draft.runId,
        subject: draft.subject,
        body: draft.body,
        status: draft.status,
        reason: draft.reason,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapDraftRow(data);
    }
  }

  const store = await readLocalStore();
  store.replyDrafts.unshift(draft);
  await writeLocalStore(store);
  return draft;
}

export async function getReplyDraft(draftId: string): Promise<ReplyDraft | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_REPLY_DRAFT)
      .select("*")
      .eq("id", draftId)
      .maybeSingle();
    if (!error && data) {
      return mapDraftRow(data);
    }
  }

  const store = await readLocalStore();
  return store.replyDrafts.find((row) => row.id === draftId) ?? null;
}

export async function updateReplyDraft(
  draftId: string,
  patch: Partial<Pick<ReplyDraft, "status" | "sentAt">>
): Promise<ReplyDraft | null> {
  const now = nowIso();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status) update.status = patch.status;
    if (patch.sentAt !== undefined) update.sent_at = patch.sentAt || null;

    const { data, error } = await supabase
      .from(TABLE_REPLY_DRAFT)
      .update(update)
      .eq("id", draftId)
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapDraftRow(data);
    }
  }

  const store = await readLocalStore();
  const idx = store.replyDrafts.findIndex((row) => row.id === draftId);
  if (idx < 0) return null;
  store.replyDrafts[idx] = {
    ...store.replyDrafts[idx],
    ...patch,
    updatedAt: now,
  };
  await writeLocalStore(store);
  return store.replyDrafts[idx];
}

export async function createOutreachEvent(input: {
  runId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}): Promise<OutreachEvent> {
  const event: OutreachEvent = {
    id: createId("event"),
    runId: input.runId,
    eventType: input.eventType,
    payload: input.payload ?? {},
    createdAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase.from(TABLE_EVENT).insert({
      id: event.id,
      run_id: event.runId,
      event_type: event.eventType,
      payload: event.payload,
    });
  } else {
    const store = await readLocalStore();
    store.events.unshift(event);
    await writeLocalStore(store);
  }

  return event;
}

export async function listRunEvents(runId: string): Promise<OutreachEvent[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_EVENT)
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: false });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapEventRow(row));
    }
  }

  const store = await readLocalStore();
  return store.events.filter((row) => row.runId === runId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function enqueueOutreachJob(input: {
  runId: string;
  jobType: OutreachJobType;
  executeAfter?: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}): Promise<OutreachJob> {
  const now = nowIso();
  const job: OutreachJob = {
    id: createId("job"),
    runId: input.runId,
    jobType: input.jobType,
    status: "queued",
    executeAfter: input.executeAfter ?? now,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 5,
    payload: input.payload ?? {},
    lastError: "",
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_JOB)
      .insert({
        id: job.id,
        run_id: job.runId,
        job_type: job.jobType,
        status: job.status,
        execute_after: job.executeAfter,
        attempts: job.attempts,
        max_attempts: job.maxAttempts,
        payload: job.payload,
        last_error: "",
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapJobRow(data);
    }
  }

  const store = await readLocalStore();
  store.jobs.unshift(job);
  await writeLocalStore(store);
  return job;
}

export async function listDueOutreachJobs(limit = 25): Promise<OutreachJob[]> {
  const now = nowIso();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_JOB)
      .select("*")
      .eq("status", "queued")
      .lte("execute_after", now)
      .order("execute_after", { ascending: true })
      .limit(limit);
    if (!error) {
      return (data ?? []).map((row: unknown) => mapJobRow(row));
    }
  }

  const store = await readLocalStore();
  return store.jobs
    .filter((row) => row.status === "queued" && row.executeAfter <= now)
    .sort((a, b) => (a.executeAfter < b.executeAfter ? -1 : 1))
    .slice(0, limit);
}

export async function updateOutreachJob(
  jobId: string,
  patch: Partial<Pick<OutreachJob, "status" | "executeAfter" | "attempts" | "lastError" | "payload">>
): Promise<OutreachJob | null> {
  const now = nowIso();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status) update.status = patch.status;
    if (patch.executeAfter !== undefined) update.execute_after = patch.executeAfter;
    if (patch.attempts !== undefined) update.attempts = patch.attempts;
    if (patch.lastError !== undefined) update.last_error = patch.lastError;
    if (patch.payload !== undefined) update.payload = patch.payload;

    const { data, error } = await supabase
      .from(TABLE_JOB)
      .update(update)
      .eq("id", jobId)
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapJobRow(data);
    }
  }

  const store = await readLocalStore();
  const idx = store.jobs.findIndex((row) => row.id === jobId);
  if (idx < 0) return null;
  store.jobs[idx] = {
    ...store.jobs[idx],
    ...patch,
    updatedAt: now,
  };
  await writeLocalStore(store);
  return store.jobs[idx];
}

export async function createRunAnomaly(input: {
  runId: string;
  type: RunAnomaly["type"];
  severity: RunAnomaly["severity"];
  threshold: number;
  observed: number;
  details: string;
}): Promise<RunAnomaly> {
  const now = nowIso();
  const anomaly: RunAnomaly = {
    id: createId("anom"),
    runId: input.runId,
    type: input.type,
    severity: input.severity,
    status: "active",
    threshold: input.threshold,
    observed: input.observed,
    details: input.details,
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ANOMALY)
      .insert({
        id: anomaly.id,
        run_id: anomaly.runId,
        type: anomaly.type,
        severity: anomaly.severity,
        status: anomaly.status,
        threshold: anomaly.threshold,
        observed: anomaly.observed,
        details: anomaly.details,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapAnomalyRow(data);
    }
  }

  const store = await readLocalStore();
  store.anomalies.unshift(anomaly);
  await writeLocalStore(store);
  return anomaly;
}

export async function listRunAnomalies(runId: string): Promise<RunAnomaly[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ANOMALY)
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: false });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapAnomalyRow(row));
    }
  }

  const store = await readLocalStore();
  return store.anomalies.filter((row) => row.runId === runId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
