import { mkdir, readFile, writeFile } from "fs/promises";
import { createId } from "@/lib/factory-data";
import {
  normalizeLegacyOutreachErrorText,
  normalizeLegacyOutreachValue,
} from "@/lib/outreach-error-normalization";
import {
  buildCustomerIoBillingSummary,
  currentCustomerIoBillingPeriodStart,
  mergeOutreachAccountConfig,
  normalizeCustomerIoProfileIdentifier,
  sanitizeCustomerIoBillingConfig,
} from "@/lib/outreach-customerio-billing";
import { decryptJson, encryptJson } from "@/lib/outreach-encryption";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getOutreachAccountFromEmail } from "@/lib/outreach-account-helpers";
import {
  defaultSocialAccountConfig,
  hasExplicitSocialIdentity,
  normalizeSocialLinkedProvider,
} from "@/lib/social-account-config";
import {
  buildSenderCapacitySnapshots,
  MAX_ACTIVE_SENDERS_PER_DOMAIN,
  selectSenderAccountIdsWithinDomainLimit,
} from "@/lib/sender-capacity";
import type {
  ActorCapabilityProfile,
  BrandOutreachAssignment,
  CampaignPrepTask,
  CampaignPrepTaskBlockerCode,
  DeliverabilityProbeRun,
  DeliverabilityProbeStage,
  DeliverabilityProbeTarget,
  DeliverabilityProbeMonitorResult,
  DeliverabilityProbeVariant,
  DeliverabilitySeedReservation,
  DeliverabilitySeedReservationStatus,
  InboxSyncState,
  InboxEvalRun,
  LeadQualityPolicy,
  EmailVerificationState,
  OutreachAccount,
  OutreachAccountConfig,
  OutreachMessage,
  OutreachRun,
  OutreachRunLead,
  WarmupSeedReservation,
  WarmupSeedReservationStatus,
  SourcingActorMemory,
  SourcingChainDecision,
  SourcingChainStep,
  SourcingProbeResult,
  ReplyDraft,
  ReplyThreadFeedback,
  ReplyThreadCanonicalState,
  ReplyThreadDraftMeta,
  ReplyThreadStateDecision,
  ReplyThreadStateRecord,
  ReplyThreadStateSummary,
  ReplyMessage,
  ReplyThread,
  RunAnomaly,
  SenderLaunchAction,
  SenderLaunch,
  SenderLaunchEvent,
  OutreachLease,
  OutreachLeaseStatus,
} from "@/lib/factory-types";

export type OutreachAccountSecrets = {
  customerIoApiKey: string;
  customerIoTrackApiKey: string;
  customerIoAppApiKey: string;
  apifyToken: string;
  youtubeClientId: string;
  youtubeClientSecret: string;
  youtubeRefreshToken: string;
  mailboxAccessToken: string;
  mailboxRefreshToken: string;
  mailboxPassword: string;
  mailboxAuthCode: string;
  mailboxSmtpPassword: string;
  mailboxAdminEmail: string;
  mailboxAdminPassword: string;
  mailboxAdminAuthCode: string;
  mailboxRecoveryEmail: string;
  mailboxRecoveryCodes: string;
};

export type OutreachJobType =
  | "source_leads"
  | "schedule_messages"
  | "dispatch_messages"
  | "sync_replies"
  | "analyze_run"
  | "conversation_tick"
  | "monitor_deliverability";

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

export type CustomerIoProfileAdmission = {
  id: string;
  accountId: string;
  billingPeriodStart: string;
  profileIdentifier: string;
  sourceRunId: string;
  sourceMessageId: string;
  createdAt: string;
};

export type OutreachAccountLookupDebug = {
  accountId: string;
  runtime: "vercel" | "local";
  supabaseConfigured: boolean;
  supabaseHasAccount: boolean;
  supabaseAccountCount: number;
  supabaseError: string;
  localHasAccount: boolean;
  localAccountCount: number;
};

type StoredAccount = Omit<OutreachAccount, "hasCredentials"> & {
  credentialsEncrypted: string;
};

type OutreachStore = {
  accounts: StoredAccount[];
  customerIoProfileAdmissions: CustomerIoProfileAdmission[];
  assignments: BrandOutreachAssignment[];
  runs: OutreachRun[];
  runLeads: OutreachRunLead[];
  messages: OutreachMessage[];
  replyThreads: ReplyThread[];
  replyThreadStates: ReplyThreadStateRecord[];
  replyMessages: ReplyMessage[];
  replyDrafts: ReplyDraft[];
  replyThreadFeedback: ReplyThreadFeedback[];
  inboxSyncStates: InboxSyncState[];
  inboxEvalRuns: InboxEvalRun[];
  anomalies: RunAnomaly[];
  events: OutreachEvent[];
  jobs: OutreachJob[];
  campaignPrepTasks: CampaignPrepTask[];
  outreachLeases: OutreachLease[];
  deliverabilityProbeRuns: DeliverabilityProbeRun[];
  deliverabilitySeedReservations: DeliverabilitySeedReservation[];
  warmupSeedReservations: WarmupSeedReservation[];
  sourcingActorProfiles: ActorCapabilityProfile[];
  sourcingChainDecisions: SourcingChainDecision[];
  sourcingProbeResults: SourcingProbeResult[];
  sourcingActorMemory: SourcingActorMemory[];
  senderLaunches: SenderLaunch[];
  senderLaunchActions: SenderLaunchAction[];
  senderLaunchEvents: SenderLaunchEvent[];
};

const isVercel = Boolean(process.env.VERCEL);
const OUTREACH_PATH = isVercel
  ? "/tmp/factory_outreach.v1.json"
  : `${process.cwd()}/data/outreach.v1.json`;

export class OutreachDataError extends Error {
  status: number;
  hint: string;
  debug: Record<string, unknown>;

  constructor(
    message: string,
    options: { status?: number; hint?: string; debug?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = "OutreachDataError";
    this.status = options.status ?? 500;
    this.hint = options.hint ?? "";
    this.debug = options.debug ?? {};
  }
}

const TABLE_ACCOUNT = "demanddev_outreach_accounts";
const TABLE_CUSTOMER_IO_PROFILE_ADMISSION = "demanddev_customerio_profile_admissions";
const TABLE_ASSIGNMENT = "demanddev_brand_outreach_assignments";
const TABLE_RUN = "demanddev_outreach_runs";
const TABLE_RUN_LEAD = "demanddev_outreach_run_leads";
const TABLE_MESSAGE = "demanddev_outreach_messages";
const TABLE_THREAD = "demanddev_reply_threads";
const TABLE_THREAD_STATE = "demanddev_reply_thread_state";
const TABLE_REPLY_MESSAGE = "demanddev_reply_messages";
const TABLE_REPLY_DRAFT = "demanddev_reply_drafts";
const TABLE_REPLY_THREAD_FEEDBACK = "demanddev_reply_thread_feedback";
const TABLE_INBOX_SYNC_STATE = "demanddev_inbox_sync_state";
const TABLE_INBOX_EVAL_RUN = "demanddev_inbox_eval_runs";
const TABLE_EVENT = "demanddev_outreach_events";
const TABLE_JOB = "demanddev_outreach_job_queue";
const TABLE_CAMPAIGN_PREP_TASK = "demanddev_campaign_prep_tasks";
const TABLE_OUTREACH_LEASE = "demanddev_outreach_leases";
const TABLE_ANOMALY = "demanddev_run_anomalies";
const TABLE_DELIVERABILITY_PROBE_RUN = "demanddev_deliverability_probe_runs";
const TABLE_DELIVERABILITY_SEED_RESERVATION = "demanddev_deliverability_seed_reservations";
const TABLE_WARMUP_SEED_RESERVATION = "demanddev_warmup_seed_reservations";
const TABLE_SOURCING_ACTOR_PROFILE = "demanddev_sourcing_actor_profiles";
const TABLE_SOURCING_CHAIN_DECISION = "demanddev_sourcing_chain_decisions";
const TABLE_SOURCING_PROBE_RESULT = "demanddev_sourcing_probe_results";
const TABLE_SOURCING_ACTOR_MEMORY = "demanddev_sourcing_actor_memory";
const TABLE_SENDER_LAUNCH = "demanddev_sender_launches";
const TABLE_SENDER_LAUNCH_ACTION = "demanddev_sender_launch_actions";
const TABLE_SENDER_LAUNCH_EVENT = "demanddev_sender_launch_events";

const nowIso = () => new Date().toISOString();
const SINGLETON_OUTREACH_JOB_TYPES = new Set<OutreachJobType>([
  "source_leads",
  "schedule_messages",
  "dispatch_messages",
  "sync_replies",
  "analyze_run",
  "conversation_tick",
]);

function runtimeLabel(): "vercel" | "local" {
  return isVercel ? "vercel" : "local";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeAssignmentAccountIds(value: unknown, fallbackAccountId = ""): string[] {
  const ids = new Set(
    asArray(value)
      .map((entry) => String(entry ?? "").trim())
      .filter((entry) => entry.length > 0)
  );
  const primary = fallbackAccountId.trim();
  if (primary) ids.add(primary);
  return Array.from(ids);
}

async function enforceAssignmentDomainLimit(accountIds: string[]) {
  const accounts = await Promise.all(accountIds.map((accountId) => getOutreachAccount(accountId)));
  const accountIdsByDomain = new Map<string, string[]>();

  for (const account of accounts) {
    if (!account) continue;
    const fromEmail = getOutreachAccountFromEmail(account).trim().toLowerCase();
    const domain = fromEmail.split("@")[1]?.trim().toLowerCase() || "";
    if (!domain) continue;
    const bucket = accountIdsByDomain.get(domain) ?? [];
    bucket.push(account.id);
    accountIdsByDomain.set(domain, bucket);
  }

  const violation = [...accountIdsByDomain.entries()].find(([, ids]) => ids.length > MAX_ACTIVE_SENDERS_PER_DOMAIN);
  if (!violation) return;

  const [domain, ids] = violation;
  throw new OutreachDataError(
    `Only ${MAX_ACTIVE_SENDERS_PER_DOMAIN} active sending inboxes are allowed on ${domain}.`,
    {
      status: 400,
      hint: "Remove extra senders on that domain or split traffic across another sender domain before saving the brand assignment.",
      debug: {
        operation: "setBrandOutreachAssignment",
        domain,
        accountIds: ids,
        maxActiveSendersPerDomain: MAX_ACTIVE_SENDERS_PER_DOMAIN,
      },
    }
  );
}

const ASSIGNMENT_DOMAIN_LIMIT_TIMEZONE = "America/Los_Angeles";
const ASSIGNMENT_DOMAIN_LIMIT_BUSINESS_HOURS = 8;

async function trimAssignmentAccountIdsToDomainLimit(accountIds: string[]) {
  const normalizedAccountIds = normalizeAssignmentAccountIds(accountIds);
  if (normalizedAccountIds.length <= 1) {
    return { accountIds: normalizedAccountIds, removedAccountIds: [] as string[] };
  }

  const accounts = await Promise.all(normalizedAccountIds.map((accountId) => getOutreachAccount(accountId)));
  const resolvedAccounts = accounts.filter((account): account is OutreachAccount => Boolean(account));
  if (!resolvedAccounts.length) {
    return { accountIds: [] as string[], removedAccountIds: normalizedAccountIds };
  }

  const keepableAccountIds = selectSenderAccountIdsWithinDomainLimit(
    buildSenderCapacitySnapshots({
      senders: resolvedAccounts.map((account) => ({ account })),
      timeZone: ASSIGNMENT_DOMAIN_LIMIT_TIMEZONE,
      businessHoursPerDay: ASSIGNMENT_DOMAIN_LIMIT_BUSINESS_HOURS,
    })
  );

  const nextAccountIds = normalizedAccountIds.filter((accountId) => keepableAccountIds.has(accountId));
  return {
    accountIds: nextAccountIds,
    removedAccountIds: normalizedAccountIds.filter((accountId) => !keepableAccountIds.has(accountId)),
  };
}

async function repairAssignmentDomainLimit(
  assignment: BrandOutreachAssignment
): Promise<BrandOutreachAssignment> {
  const { accountIds, removedAccountIds } = await trimAssignmentAccountIdsToDomainLimit(assignment.accountIds);
  if (!removedAccountIds.length) {
    return assignment;
  }

  const nextAssignment: BrandOutreachAssignment = {
    ...assignment,
    accountId: accountIds.includes(assignment.accountId) ? assignment.accountId : accountIds[0] ?? "",
    accountIds,
    mailboxAccountId: removedAccountIds.includes(assignment.mailboxAccountId) ? "" : assignment.mailboxAccountId,
    updatedAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase
      .from(TABLE_ASSIGNMENT)
      .upsert(
        {
          brand_id: nextAssignment.brandId,
          account_id: nextAssignment.accountId,
          account_ids: nextAssignment.accountIds,
          mailbox_account_id: nextAssignment.mailboxAccountId || null,
        },
        { onConflict: "brand_id" }
      );
    return nextAssignment;
  }

  if (!isVercel) {
    const store = await readLocalStore();
    const idx = store.assignments.findIndex((row) => row.brandId === nextAssignment.brandId);
    if (idx >= 0) {
      store.assignments[idx] = nextAssignment;
      await writeLocalStore(store);
    }
  }

  return nextAssignment;
}

function mapAssignmentRow(input: unknown): BrandOutreachAssignment {
  const row = asRecord(input);
  const accountId = String(row.accountId ?? row.account_id ?? "").trim();
  const accountIds = normalizeAssignmentAccountIds(row.accountIds ?? row.account_ids, accountId);
  return {
    brandId: String(row.brandId ?? row.brand_id ?? ""),
    accountId: accountId || accountIds[0] || "",
    accountIds: accountIds.length ? accountIds : accountId ? [accountId] : [],
    mailboxAccountId: String(row.mailboxAccountId ?? row.mailbox_account_id ?? "").trim(),
    createdAt: String(row.createdAt ?? row.created_at ?? nowIso()),
    updatedAt: String(row.updatedAt ?? row.updated_at ?? nowIso()),
  };
}

function defaultOutreachStore(): OutreachStore {
  return {
    accounts: [],
    customerIoProfileAdmissions: [],
    assignments: [],
    runs: [],
    runLeads: [],
    messages: [],
    replyThreads: [],
    replyThreadStates: [],
    replyMessages: [],
    replyDrafts: [],
    replyThreadFeedback: [],
    inboxSyncStates: [],
    inboxEvalRuns: [],
    anomalies: [],
    events: [],
    jobs: [],
    campaignPrepTasks: [],
    outreachLeases: [],
    deliverabilityProbeRuns: [],
    deliverabilitySeedReservations: [],
    warmupSeedReservations: [],
    sourcingActorProfiles: [],
    sourcingChainDecisions: [],
    sourcingProbeResults: [],
    sourcingActorMemory: [],
    senderLaunches: [],
    senderLaunchActions: [],
    senderLaunchEvents: [],
  };
}

function deriveAccountType(config: OutreachAccountConfig): OutreachAccount["accountType"] {
  const hasDelivery = Boolean(
    config.customerIo.siteId.trim() ||
      config.mailpool.mailboxId.trim() ||
      (config.mailbox.deliveryMethod === "gmail_ui" &&
        config.mailbox.provider === "gmail" &&
        config.mailbox.gmailUiUserDataDir.trim()) ||
      (config.mailbox.smtpHost.trim() && config.mailbox.smtpUsername.trim())
  );
  const hasMailbox = Boolean(config.mailbox.email.trim() && config.mailbox.host.trim());
  if (hasDelivery && hasMailbox) return "hybrid";
  if (hasDelivery) return "delivery";
  if (hasMailbox) return "mailbox";
  return "hybrid";
}

function sanitizeAccountConfig(value: unknown): OutreachAccountConfig {
  const row = asRecord(value);
  const customerIo = asRecord(row.customerIo);
  const mailpool = asRecord(row.mailpool);
  const apify = asRecord(row.apify);
  const social = asRecord(row.social);
  const mailbox = asRecord(row.mailbox);
  const mailpoolStatus = String(mailpool.status ?? "").trim().toLowerCase();
  const socialRole = String(social.role ?? "").trim().toLowerCase();
  const socialConnectionProvider = String(social.connectionProvider ?? social.connection_provider ?? "").trim().toLowerCase();

  return {
    customerIo: {
      siteId: String(customerIo.siteId ?? "").trim(),
      workspaceId: String(customerIo.workspaceId ?? "").trim(),
      fromEmail: String(customerIo.fromEmail ?? customerIo.from_email ?? "").trim(),
      replyToEmail: String(customerIo.replyToEmail ?? customerIo.reply_to_email ?? customerIo.replyTo ?? "").trim(),
      billing: sanitizeCustomerIoBillingConfig(customerIo.billing),
    },
    mailpool: {
      domainId: String(mailpool.domainId ?? mailpool.domain_id ?? "").trim(),
      mailboxId: String(mailpool.mailboxId ?? mailpool.mailbox_id ?? "").trim(),
      mailboxType: ["google", "shared", "private", "outlook"].includes(String(mailpool.mailboxType ?? mailpool.mailbox_type))
        ? (String(mailpool.mailboxType ?? mailpool.mailbox_type) as OutreachAccountConfig["mailpool"]["mailboxType"])
        : "google",
      spamCheckId: String(mailpool.spamCheckId ?? mailpool.spam_check_id ?? "").trim(),
      inboxPlacementId: String(mailpool.inboxPlacementId ?? mailpool.inbox_placement_id ?? "").trim(),
      status: ["pending", "active", "updating", "error", "deleted"].includes(mailpoolStatus)
        ? (mailpoolStatus as OutreachAccountConfig["mailpool"]["status"])
        : "pending",
      lastSpamCheckAt: String(mailpool.lastSpamCheckAt ?? mailpool.last_spam_check_at ?? "").trim(),
      lastSpamCheckScore: Number(mailpool.lastSpamCheckScore ?? mailpool.last_spam_check_score ?? 0) || 0,
      lastSpamCheckSummary: String(
        mailpool.lastSpamCheckSummary ?? mailpool.last_spam_check_summary ?? ""
      ).trim(),
    },
    apify: {
      defaultActorId: String(apify.defaultActorId ?? "").trim(),
    },
    social: {
      ...defaultSocialAccountConfig(),
      enabled: Boolean(social.enabled ?? false),
      connectionProvider:
        socialConnectionProvider === "unipile"
          ? "unipile"
          : socialConnectionProvider === "youtube"
            ? "youtube"
          : socialConnectionProvider === "manual"
            ? "manual"
            : "none",
      linkedProvider: normalizeSocialLinkedProvider(
        social.linkedProvider ?? social.linked_provider ?? social.provider ?? social.profile_provider
      ),
      externalAccountId: String(social.externalAccountId ?? social.external_account_id ?? "").trim(),
      handle: String(social.handle ?? "").trim(),
      profileUrl: String(social.profileUrl ?? social.profile_url ?? "").trim(),
      publicIdentifier: String(social.publicIdentifier ?? social.public_identifier ?? social.username ?? "").trim(),
      displayName: String(social.displayName ?? social.display_name ?? social.name ?? "").trim(),
      headline: String(social.headline ?? social.title ?? "").trim(),
      bio: String(social.bio ?? social.description ?? social.about ?? "").trim(),
      avatarUrl: String(
        social.avatarUrl ?? social.avatar_url ?? social.pictureUrl ?? social.picture_url ?? social.picture ?? ""
      ).trim(),
      role: ["operator", "specialist", "curator", "partner", "founder", "brand", "community"].includes(socialRole)
        ? (socialRole as OutreachAccountConfig["social"]["role"])
        : "operator",
      topicTags: asArray(social.topicTags ?? social.topic_tags)
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean),
      communityTags: asArray(social.communityTags ?? social.community_tags)
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean),
      platforms: asArray(social.platforms)
        .map((entry) => String(entry ?? "").trim().toLowerCase())
        .filter(Boolean),
      regions: asArray(social.regions)
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean),
      languages: asArray(social.languages)
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean),
      audienceTypes: asArray(social.audienceTypes ?? social.audience_types)
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean),
      personaSummary: String(social.personaSummary ?? social.persona_summary ?? "").trim(),
      voiceSummary: String(social.voiceSummary ?? social.voice_summary ?? "").trim(),
      trustLevel: Math.max(0, Math.min(10, Number(social.trustLevel ?? social.trust_level ?? 0) || 0)),
      cooldownMinutes: Math.max(0, Math.min(24 * 60, Number(social.cooldownMinutes ?? social.cooldown_minutes ?? 120) || 120)),
      linkedAt: String(social.linkedAt ?? social.linked_at ?? "").trim(),
      lastProfileSyncAt: String(social.lastProfileSyncAt ?? social.last_profile_sync_at ?? "").trim(),
      lastSocialCommentAt: String(social.lastSocialCommentAt ?? social.last_social_comment_at ?? "").trim(),
      recentActivity24h: Math.max(0, Number(social.recentActivity24h ?? social.recent_activity_24h ?? 0) || 0),
      recentActivity7d: Math.max(0, Number(social.recentActivity7d ?? social.recent_activity_7d ?? 0) || 0),
      coordinationGroup: String(social.coordinationGroup ?? social.coordination_group ?? "").trim(),
      notes: String(social.notes ?? "").trim(),
    },
    mailbox: {
      provider: ["gmail", "outlook", "imap"].includes(String(mailbox.provider))
        ? (String(mailbox.provider) as OutreachAccountConfig["mailbox"]["provider"])
        : "gmail",
      deliveryMethod: ["smtp", "gmail_ui"].includes(String(mailbox.deliveryMethod ?? mailbox.delivery_method))
        ? (String(mailbox.deliveryMethod ?? mailbox.delivery_method) as OutreachAccountConfig["mailbox"]["deliveryMethod"])
        : "smtp",
      email: String(mailbox.email ?? "").trim(),
      status: ["connected", "disconnected", "error"].includes(String(mailbox.status))
        ? (String(mailbox.status) as OutreachAccountConfig["mailbox"]["status"])
        : "disconnected",
      host: String(mailbox.host ?? "").trim(),
      port: Number(mailbox.port ?? 993),
      secure: Boolean(mailbox.secure ?? true),
      smtpHost: String(mailbox.smtpHost ?? mailbox.smtp_host ?? "").trim(),
      smtpPort: Number(mailbox.smtpPort ?? mailbox.smtp_port ?? 587),
      smtpSecure: Boolean(mailbox.smtpSecure ?? mailbox.smtp_secure ?? false),
      smtpUsername: String(mailbox.smtpUsername ?? mailbox.smtp_username ?? "").trim(),
      gmailUiUserDataDir: String(mailbox.gmailUiUserDataDir ?? mailbox.gmail_ui_user_data_dir ?? "").trim(),
      gmailUiProfileDirectory: String(
        mailbox.gmailUiProfileDirectory ?? mailbox.gmail_ui_profile_directory ?? ""
      ).trim(),
      gmailUiBrowserChannel: String(
        mailbox.gmailUiBrowserChannel ?? mailbox.gmail_ui_browser_channel ?? "chrome"
      ).trim() || "chrome",
      gmailUiLoginState: ["unknown", "login_required", "ready", "error"].includes(
        String(mailbox.gmailUiLoginState ?? mailbox.gmail_ui_login_state ?? "").trim()
      )
        ? (String(
            mailbox.gmailUiLoginState ?? mailbox.gmail_ui_login_state ?? ""
          ).trim() as OutreachAccountConfig["mailbox"]["gmailUiLoginState"])
        : "unknown",
      gmailUiLoginCheckedAt: String(
        mailbox.gmailUiLoginCheckedAt ?? mailbox.gmail_ui_login_checked_at ?? ""
      ).trim(),
      gmailUiLoginMessage: String(
        mailbox.gmailUiLoginMessage ?? mailbox.gmail_ui_login_message ?? ""
      ).trim(),
      proxyUrl: String(mailbox.proxyUrl ?? mailbox.proxy_url ?? "").trim(),
      proxyHost: String(mailbox.proxyHost ?? mailbox.proxy_host ?? "").trim(),
      proxyPort: Number(mailbox.proxyPort ?? mailbox.proxy_port ?? 0) || 0,
      proxyUsername: String(mailbox.proxyUsername ?? mailbox.proxy_username ?? "").trim(),
      proxyPassword: String(mailbox.proxyPassword ?? mailbox.proxy_password ?? "").trim(),
    },
  };
}

function defaultSecrets(): OutreachAccountSecrets {
  return {
    customerIoApiKey: "",
    customerIoTrackApiKey: "",
    customerIoAppApiKey: "",
    apifyToken: "",
    youtubeClientId: "",
    youtubeClientSecret: "",
    youtubeRefreshToken: "",
    mailboxAccessToken: "",
    mailboxRefreshToken: "",
    mailboxPassword: "",
    mailboxAuthCode: "",
    mailboxSmtpPassword: "",
    mailboxAdminEmail: "",
    mailboxAdminPassword: "",
    mailboxAdminAuthCode: "",
    mailboxRecoveryEmail: "",
    mailboxRecoveryCodes: "",
  };
}

function sanitizeSecrets(value: unknown): OutreachAccountSecrets {
  const row = asRecord(value);
  const admin = asRecord(row.mailboxAdmin ?? row.admin);
  const customerIoApiKey = String(
    row.customerIoApiKey ?? row.customerIoTrackApiKey ?? row.customerIoAppApiKey ?? ""
  ).trim();
  return {
    customerIoApiKey,
    customerIoTrackApiKey: String(row.customerIoTrackApiKey ?? "").trim(),
    customerIoAppApiKey: String(row.customerIoAppApiKey ?? "").trim(),
    apifyToken: String(row.apifyToken ?? "").trim(),
    youtubeClientId: String(row.youtubeClientId ?? row.googleClientId ?? "").trim(),
    youtubeClientSecret: String(row.youtubeClientSecret ?? row.googleClientSecret ?? "").trim(),
    youtubeRefreshToken: String(row.youtubeRefreshToken ?? row.googleRefreshToken ?? "").trim(),
    mailboxAccessToken: String(row.mailboxAccessToken ?? "").trim(),
    mailboxRefreshToken: String(row.mailboxRefreshToken ?? "").trim(),
    mailboxPassword: String(row.mailboxPassword ?? "").trim(),
    mailboxAuthCode: String(row.mailboxAuthCode ?? row.authCode ?? row.auth_code ?? "").trim(),
    mailboxSmtpPassword: String(row.mailboxSmtpPassword ?? row.smtpPassword ?? "").trim(),
    mailboxAdminEmail: String(row.mailboxAdminEmail ?? row.adminEmail ?? admin.email ?? "").trim(),
    mailboxAdminPassword: String(row.mailboxAdminPassword ?? row.adminPassword ?? admin.password ?? "").trim(),
    mailboxAdminAuthCode: String(
      row.mailboxAdminAuthCode ?? row.adminAuthCode ?? admin.authCode ?? admin.auth_code ?? ""
    ).trim(),
    mailboxRecoveryEmail: String(row.mailboxRecoveryEmail ?? "").trim(),
    mailboxRecoveryCodes:
      typeof row.mailboxRecoveryCodes === "string"
        ? row.mailboxRecoveryCodes
            .split(/\r?\n|,/)
            .map((entry) => entry.trim())
            .filter(Boolean)
            .join("\n")
        : Array.isArray(row.mailboxRecoveryCodes)
          ? row.mailboxRecoveryCodes
              .map((entry) => String(entry ?? "").trim())
              .filter(Boolean)
              .join("\n")
          : "",
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
    accountType: row.accountType,
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
  const config = sanitizeAccountConfig(row.config);
  const rawType = String(row.account_type ?? row.accountType ?? "").trim();
  const accountType = ["delivery", "mailbox", "hybrid"].includes(rawType)
    ? (rawType as OutreachAccount["accountType"])
    : deriveAccountType(config);
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    provider:
      String(row.provider ?? "").trim().toLowerCase() === "mailpool"
        ? "mailpool"
        : "customerio",
    accountType,
    status: String(row.status ?? "active") === "inactive" ? "inactive" : "active",
    config,
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

function sanitizeRunTraceSummary(
  value: OutreachRun["sourcingTraceSummary"] | null | undefined
): OutreachRun["sourcingTraceSummary"] {
  return {
    phase: value?.phase ?? "plan_sourcing",
    selectedActorIds: Array.isArray(value?.selectedActorIds) ? value.selectedActorIds : [],
    lastActorInputError: normalizeLegacyOutreachErrorText(value?.lastActorInputError ?? ""),
    failureStep: String(value?.failureStep ?? ""),
    budgetUsedUsd: Math.max(0, Number(value?.budgetUsedUsd ?? 0) || 0),
  };
}

function mapRunRow(input: unknown): OutreachRun {
  const row = asRecord(input);
  const campaignId = String(row.campaign_id ?? row.campaignId ?? "");
  const experimentId = String(row.experiment_id ?? row.experimentId ?? "");
  const ownerTypeRaw = String(row.owner_type ?? row.ownerType ?? "").trim();
  const ownerType: OutreachRun["ownerType"] =
    ownerTypeRaw === "campaign" || ownerTypeRaw === "experiment"
      ? (ownerTypeRaw as OutreachRun["ownerType"])
      : "experiment";
  const ownerIdFallback = ownerType === "campaign" ? campaignId : experimentId || campaignId;
  return {
    id: String(row.id ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    campaignId,
    experimentId,
    hypothesisId: String(row.hypothesis_id ?? row.hypothesisId ?? ""),
    ownerType,
    ownerId: String(row.owner_id ?? row.ownerId ?? ownerIdFallback),
    accountId: String(row.account_id ?? row.accountId ?? ""),
    lockedSenderAccountId: String(row.locked_sender_account_id ?? row.lockedSenderAccountId ?? "").trim(),
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
    lastError: normalizeLegacyOutreachErrorText(row.last_error ?? row.lastError ?? ""),
    externalRef: String(row.external_ref ?? row.externalRef ?? ""),
    metrics: row.metrics ? mapRunMetrics(row.metrics) : defaultRunMetrics(),
    sourcingTraceSummary:
      row.sourcing_trace_summary && typeof row.sourcing_trace_summary === "object"
        ? sanitizeRunTraceSummary({
            phase: String((row.sourcing_trace_summary as Record<string, unknown>).phase ?? "plan_sourcing") as
              | "plan_sourcing"
              | "probe_chain"
              | "execute_chain"
              | "completed"
              | "failed",
            selectedActorIds: Array.isArray(
              (row.sourcing_trace_summary as Record<string, unknown>).selectedActorIds
            )
              ? ((row.sourcing_trace_summary as Record<string, unknown>).selectedActorIds as unknown[])
                  .map((value) => String(value ?? "").trim())
                  .filter(Boolean)
              : [],
            lastActorInputError: String(
              (row.sourcing_trace_summary as Record<string, unknown>).lastActorInputError ?? ""
            ),
            failureStep: String((row.sourcing_trace_summary as Record<string, unknown>).failureStep ?? ""),
            budgetUsedUsd: Math.max(
              0,
              Number((row.sourcing_trace_summary as Record<string, unknown>).budgetUsedUsd ?? 0) || 0
            ),
          })
        : sanitizeRunTraceSummary(null),
    startedAt: String(row.started_at ?? row.startedAt ?? ""),
    completedAt: String(row.completed_at ?? row.completedAt ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapRunLeadRow(input: unknown): OutreachRunLead {
  const row = asRecord(input);
  const emailVerificationRaw = row.email_verification ?? row.emailVerification;
  const emailVerification = (() => {
    const value = asRecord(emailVerificationRaw);
    if (!Object.keys(value).length) return null;
    return {
      mode:
        value.mode === "local" || value.mode === "validatedmails" || value.mode === "heuristic"
          ? (value.mode as EmailVerificationState["mode"])
          : "",
      provider: String(value.provider ?? ""),
      verdict: String(value.verdict ?? ""),
      confidence: String(value.confidence ?? ""),
      reason: String(value.reason ?? ""),
      mxStatus: String(value.mxStatus ?? value.mx_status ?? ""),
      acceptAll:
        typeof value.acceptAll === "boolean"
          ? value.acceptAll
          : typeof value.accept_all === "boolean"
            ? value.accept_all
            : null,
      catchAll:
        typeof value.catchAll === "boolean"
          ? value.catchAll
          : typeof value.catch_all === "boolean"
            ? value.catch_all
            : null,
      pValid:
        typeof value.pValid === "number"
          ? value.pValid
          : typeof value.p_valid === "number"
            ? value.p_valid
            : null,
      httpStatus:
        typeof value.httpStatus === "number"
          ? value.httpStatus
          : typeof value.http_status === "number"
            ? value.http_status
            : null,
      providerStatus: String(value.providerStatus ?? value.provider_status ?? ""),
    } satisfies EmailVerificationState;
  })();
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
    realVerifiedEmail: row.real_verified_email === true || row.realVerifiedEmail === true,
    emailVerification,
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
  const generationMetaRaw = row.generation_meta ?? row.generationMeta;
  const generationMeta =
    generationMetaRaw && typeof generationMetaRaw === "object" && !Array.isArray(generationMetaRaw)
      ? (generationMetaRaw as Record<string, unknown>)
      : {};
  return {
    id: String(row.id ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    campaignId: String(row.campaign_id ?? row.campaignId ?? ""),
    leadId: String(row.lead_id ?? row.leadId ?? ""),
    step: Number(row.step ?? 1),
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    sourceType: String(row.source_type ?? row.sourceType ?? "cadence") === "conversation" ? "conversation" : "cadence",
    sessionId: String(row.session_id ?? row.sessionId ?? ""),
    nodeId: String(row.node_id ?? row.nodeId ?? ""),
    parentMessageId: String(row.parent_message_id ?? row.parentMessageId ?? ""),
    status: ["scheduled", "sent", "failed", "bounced", "replied", "canceled"].includes(String(row.status))
      ? (String(row.status) as OutreachMessage["status"])
      : "scheduled",
    providerMessageId: String(row.provider_message_id ?? row.providerMessageId ?? ""),
    scheduledAt: String(row.scheduled_at ?? row.scheduledAt ?? nowIso()),
    sentAt: String(row.sent_at ?? row.sentAt ?? ""),
    lastError: String(row.last_error ?? row.lastError ?? ""),
    generationMeta,
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
    sourceType:
      String(row.source_type ?? row.sourceType ?? "outreach") === "mailbox"
        ? "mailbox"
        : String(row.source_type ?? row.sourceType ?? "outreach") === "eval"
          ? "eval"
          : "outreach",
    mailboxAccountId: String(row.mailbox_account_id ?? row.mailboxAccountId ?? ""),
    contactEmail: String(row.contact_email ?? row.contactEmail ?? ""),
    contactName: String(row.contact_name ?? row.contactName ?? ""),
    contactCompany: String(row.contact_company ?? row.contactCompany ?? ""),
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
    stateSummary: mapThreadStateSummary(row.state_summary ?? row.stateSummary),
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

function mapReplyThreadFeedbackRow(input: unknown): ReplyThreadFeedback {
  const row = asRecord(input);
  const type = String(row.type ?? "").trim();
  return {
    id: String(row.id ?? "").trim(),
    threadId: String(row.thread_id ?? row.threadId ?? "").trim(),
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    type: ["good", "wrong_move", "wrong_facts", "too_aggressive", "should_be_human"].includes(type)
      ? (type as ReplyThreadFeedback["type"])
      : "good",
    note: String(row.note ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
  };
}

function mapInboxSyncStateRow(input: unknown): InboxSyncState {
  const row = asRecord(input);
  return {
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    mailboxAccountId: String(row.mailbox_account_id ?? row.mailboxAccountId ?? "").trim(),
    mailboxName: String(row.mailbox_name ?? row.mailboxName ?? "").trim(),
    lastInboxUid: Math.max(0, Math.round(Number(row.last_inbox_uid ?? row.lastInboxUid ?? 0) || 0)),
    lastSyncedAt: String(row.last_synced_at ?? row.lastSyncedAt ?? "").trim(),
    lastError: String(row.last_error ?? row.lastError ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapInboxEvalRunRow(input: unknown): InboxEvalRun {
  const row = asRecord(input);
  const scorecardRaw = row.scorecard ?? row.scorecard_json ?? null;
  return {
    id: String(row.id ?? "").trim(),
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    scenarioId: String(row.scenario_id ?? row.scenarioId ?? "").trim(),
    scenarioName: String(row.scenario_name ?? row.scenarioName ?? "").trim(),
    status: ["running", "completed", "failed"].includes(String(row.status))
      ? (String(row.status) as InboxEvalRun["status"])
      : "running",
    seed: String(row.seed ?? "").trim(),
    threadId: String(row.thread_id ?? row.threadId ?? "").trim(),
    scenario: asRecord(row.scenario) as InboxEvalRun["scenario"],
    transcript: (asArray(row.transcript) as InboxEvalRun["transcript"]).map((item) => asRecord(item) as InboxEvalRun["transcript"][number]),
    scorecard:
      scorecardRaw && typeof scorecardRaw === "object" && !Array.isArray(scorecardRaw)
        ? (scorecardRaw as InboxEvalRun["scorecard"])
        : null,
    lastError: String(row.last_error ?? row.lastError ?? "").trim(),
    startedAt: String(row.started_at ?? row.startedAt ?? "").trim(),
    completedAt: String(row.completed_at ?? row.completedAt ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()).trim(),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()).trim(),
  };
}

function clampZeroOne(value: unknown, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, Number(num.toFixed(3))));
}

function oneLine(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function mapThreadStateSummary(input: unknown): ReplyThreadStateSummary | null {
  const row = asRecord(input);
  const currentStage = String(row.currentStage ?? row.current_stage ?? "").trim();
  const recommendedMove = String(row.recommendedMove ?? row.recommended_move ?? "").trim();
  if (!currentStage || !recommendedMove) return null;
  return {
    currentStage: [
      "discover_relevance",
      "qualify",
      "handle_objection",
      "advance_next_step",
      "nurture",
      "closed",
    ].includes(currentStage)
      ? (currentStage as ReplyThreadStateSummary["currentStage"])
      : "discover_relevance",
    recommendedMove: [
      "stay_silent",
      "acknowledge_and_close",
      "answer_question",
      "ask_qualifying_question",
      "offer_proof",
      "reframe_objection",
      "advance_next_step",
      "soft_nurture",
      "handoff_to_human",
      "respect_opt_out",
    ].includes(recommendedMove)
      ? (recommendedMove as ReplyThreadStateSummary["recommendedMove"])
      : "soft_nurture",
    confidence: clampZeroOne(row.confidence, 0),
    autopilotOk: row.autopilotOk === true || row.autopilot_ok === true,
    manualReviewReason: String(row.manualReviewReason ?? row.manual_review_reason ?? "").trim(),
    latestUserAsk: String(row.latestUserAsk ?? row.latest_user_ask ?? "").trim(),
    progressScore: clampZeroOne(row.progressScore ?? row.progress_score, 0),
  };
}

function defaultReplyThreadDecision(): ReplyThreadStateDecision {
  return {
    recommendedMove: "soft_nurture",
    objectiveForThisTurn: "",
    rationale: "",
    confidence: 0,
    autopilotOk: false,
    manualReviewReason: "",
  };
}

function mapThreadStateDecision(input: unknown): ReplyThreadStateDecision {
  const row = asRecord(input);
  const recommendedMove = String(row.recommendedMove ?? row.recommended_move ?? "").trim();
  return {
    recommendedMove: [
      "stay_silent",
      "acknowledge_and_close",
      "answer_question",
      "ask_qualifying_question",
      "offer_proof",
      "reframe_objection",
      "advance_next_step",
      "soft_nurture",
      "handoff_to_human",
      "respect_opt_out",
    ].includes(recommendedMove)
      ? (recommendedMove as ReplyThreadStateDecision["recommendedMove"])
      : "soft_nurture",
    objectiveForThisTurn: String(row.objectiveForThisTurn ?? row.objective_for_this_turn ?? "").trim(),
    rationale: String(row.rationale ?? "").trim(),
    confidence: clampZeroOne(row.confidence, 0),
    autopilotOk: row.autopilotOk === true || row.autopilot_ok === true,
    manualReviewReason: String(row.manualReviewReason ?? row.manual_review_reason ?? "").trim(),
  };
}

function defaultReplyThreadDraftMeta(): ReplyThreadDraftMeta {
  return {
    draftId: "",
    status: "none",
    subject: "",
    reason: "",
    createdAt: "",
  };
}

function mapThreadDraftMeta(input: unknown): ReplyThreadDraftMeta {
  const row = asRecord(input);
  const status = String(row.status ?? "").trim();
  return {
    draftId: String(row.draftId ?? row.draft_id ?? "").trim(),
    status: ["none", "draft", "sent", "dismissed"].includes(status)
      ? (status as ReplyThreadDraftMeta["status"])
      : "none",
    subject: String(row.subject ?? "").trim(),
    reason: String(row.reason ?? "").trim(),
    createdAt: String(row.createdAt ?? row.created_at ?? "").trim(),
  };
}

function defaultReplyThreadCanonicalState(): ReplyThreadCanonicalState {
  return {
    ids: {
      threadId: "",
      brandId: "",
      campaignId: "",
      runId: "",
      leadId: "",
      sourceType: "outreach",
      mailboxAccountId: "",
    },
    org: {
      brandSummary: "",
      productSummary: "",
      offerSummary: "",
      tone: "",
      proofPoints: [],
      allowedClaims: [],
      forbiddenClaims: [],
      desiredOutcome: "",
    },
    contact: {
      email: "",
      name: "",
      company: "",
      title: "",
      roleFit: "",
      relationshipValue: "medium",
    },
    thread: {
      rollingSummary: "",
      latestInboundSummary: "",
      latestUserAsk: "",
      currentStage: "discover_relevance",
      stageGoal: "",
      progressScore: 0,
    },
    evidence: {
      confirmedFacts: [],
      inferredFacts: [],
      openQuestions: [],
      objections: [],
      commitments: [],
      riskFlags: [],
      buyingSignals: [],
    },
    policy: {
      preferredMoves: [],
      forbiddenMoves: [],
      manualReviewTriggers: [],
      autopilotEnabled: false,
    },
    decision: defaultReplyThreadDecision(),
    draft: {
      subject: "",
      body: "",
      styleNotes: [],
    },
    audit: {
      stateRevision: 1,
      sourcesUsed: [],
      model: "",
      generatedAt: nowIso(),
    },
  };
}

function mapThreadStateRow(input: unknown): ReplyThreadStateRecord {
  const row = asRecord(input);
  const canonicalStateRaw = asRecord(row.canonical_state ?? row.canonicalState);
  const latestDecision = mapThreadStateDecision(row.latest_decision ?? row.latestDecision ?? canonicalStateRaw.decision);
  const latestDraftMeta = mapThreadDraftMeta(row.latest_draft_meta ?? row.latestDraftMeta);
  const sourcesUsed = asArray(row.sources_used ?? row.sourcesUsed)
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
  const canonicalState = {
    ...defaultReplyThreadCanonicalState(),
    ...canonicalStateRaw,
    ids: {
      ...defaultReplyThreadCanonicalState().ids,
      ...asRecord(canonicalStateRaw.ids),
    },
    org: {
      ...defaultReplyThreadCanonicalState().org,
      ...asRecord(canonicalStateRaw.org),
      proofPoints: asArray(asRecord(canonicalStateRaw.org).proofPoints).map((entry) => String(entry ?? "").trim()).filter(Boolean),
      allowedClaims: asArray(asRecord(canonicalStateRaw.org).allowedClaims).map((entry) => String(entry ?? "").trim()).filter(Boolean),
      forbiddenClaims: asArray(asRecord(canonicalStateRaw.org).forbiddenClaims).map((entry) => String(entry ?? "").trim()).filter(Boolean),
    },
    contact: {
      ...defaultReplyThreadCanonicalState().contact,
      ...asRecord(canonicalStateRaw.contact),
      relationshipValue: ["low", "medium", "high"].includes(String(asRecord(canonicalStateRaw.contact).relationshipValue))
        ? (String(asRecord(canonicalStateRaw.contact).relationshipValue) as ReplyThreadCanonicalState["contact"]["relationshipValue"])
        : "medium",
    },
    thread: {
      ...defaultReplyThreadCanonicalState().thread,
      ...asRecord(canonicalStateRaw.thread),
      currentStage: mapThreadStateSummary({
        currentStage: asRecord(canonicalStateRaw.thread).currentStage,
        recommendedMove: latestDecision.recommendedMove,
      })?.currentStage ?? "discover_relevance",
      progressScore: clampZeroOne(asRecord(canonicalStateRaw.thread).progressScore, 0),
    },
    evidence: {
      ...defaultReplyThreadCanonicalState().evidence,
      ...asRecord(canonicalStateRaw.evidence),
      confirmedFacts: asArray(asRecord(canonicalStateRaw.evidence).confirmedFacts) as ReplyThreadCanonicalState["evidence"]["confirmedFacts"],
      inferredFacts: asArray(asRecord(canonicalStateRaw.evidence).inferredFacts) as ReplyThreadCanonicalState["evidence"]["inferredFacts"],
      openQuestions: asArray(asRecord(canonicalStateRaw.evidence).openQuestions).map((entry) => String(entry ?? "").trim()).filter(Boolean),
      objections: asArray(asRecord(canonicalStateRaw.evidence).objections).map((entry) => String(entry ?? "").trim()).filter(Boolean),
      commitments: asArray(asRecord(canonicalStateRaw.evidence).commitments).map((entry) => String(entry ?? "").trim()).filter(Boolean),
      riskFlags: asArray(asRecord(canonicalStateRaw.evidence).riskFlags).map((entry) => String(entry ?? "").trim()).filter(Boolean),
      buyingSignals: asArray(asRecord(canonicalStateRaw.evidence).buyingSignals).map((entry) => String(entry ?? "").trim()).filter(Boolean),
    },
    policy: {
      ...defaultReplyThreadCanonicalState().policy,
      ...asRecord(canonicalStateRaw.policy),
      preferredMoves: asArray(asRecord(canonicalStateRaw.policy).preferredMoves) as ReplyThreadCanonicalState["policy"]["preferredMoves"],
      forbiddenMoves: asArray(asRecord(canonicalStateRaw.policy).forbiddenMoves) as ReplyThreadCanonicalState["policy"]["forbiddenMoves"],
      manualReviewTriggers: asArray(asRecord(canonicalStateRaw.policy).manualReviewTriggers).map((entry) => String(entry ?? "").trim()).filter(Boolean),
      autopilotEnabled: asRecord(canonicalStateRaw.policy).autopilotEnabled === true,
    },
    decision: latestDecision,
    draft: {
      ...defaultReplyThreadCanonicalState().draft,
      ...asRecord(canonicalStateRaw.draft),
      styleNotes: asArray(asRecord(canonicalStateRaw.draft).styleNotes).map((entry) => String(entry ?? "").trim()).filter(Boolean),
    },
    audit: {
      ...defaultReplyThreadCanonicalState().audit,
      ...asRecord(canonicalStateRaw.audit),
      stateRevision: Math.max(1, Math.round(Number(asRecord(canonicalStateRaw.audit).stateRevision ?? row.state_revision ?? 1) || 1)),
      sourcesUsed: asArray(asRecord(canonicalStateRaw.audit).sourcesUsed).map((entry) => String(entry ?? "").trim()).filter(Boolean),
      model: oneLine(asRecord(canonicalStateRaw.audit).model),
      generatedAt: String(asRecord(canonicalStateRaw.audit).generatedAt ?? row.updated_at ?? row.updatedAt ?? nowIso()).trim(),
    },
  } satisfies ReplyThreadCanonicalState;

  return {
    threadId: String(row.thread_id ?? row.threadId ?? "").trim(),
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    runId: String(row.run_id ?? row.runId ?? "").trim(),
    stateRevision: Math.max(1, Math.round(Number(row.state_revision ?? row.stateRevision ?? canonicalState.audit.stateRevision ?? 1) || 1)),
    canonicalState,
    latestDecision,
    latestDraftMeta,
    sourcesUsed,
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapAnomalyRow(input: unknown): RunAnomaly {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    type: [
      "hard_bounce_rate",
      "spam_complaint_rate",
      "provider_error_rate",
      "negative_reply_rate_spike",
      "deliverability_inbox_placement",
    ].includes(String(row.type))
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
    jobType: ["source_leads", "schedule_messages", "dispatch_messages", "sync_replies", "analyze_run", "conversation_tick", "monitor_deliverability"].includes(
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
    payload: asRecord(normalizeLegacyOutreachValue(asRecord(row.payload))),
    lastError: normalizeLegacyOutreachErrorText(row.last_error ?? row.lastError ?? ""),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapCampaignPrepTaskRow(input: unknown): CampaignPrepTask {
  const row = asRecord(input);
  const status = String(row.status ?? "").trim().toLowerCase();
  const blockerCode = String(row.blocker_code ?? row.blockerCode ?? "").trim().toLowerCase();
  const lane = String(row.lane ?? "").trim().toLowerCase();
  return {
    id: String(row.id ?? "").trim(),
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    campaignId: String(row.campaign_id ?? row.campaignId ?? "").trim(),
    lane: lane === "warmup" ? "warmup" : "outbound",
    status: ["queued", "running", "blocked", "ready", "failed"].includes(status)
      ? (status as CampaignPrepTask["status"])
      : "queued",
    attempt: Math.max(0, Number(row.attempt ?? 0) || 0),
    executeAfter: String(row.execute_after ?? row.executeAfter ?? nowIso()).trim(),
    startedAt: String(row.started_at ?? row.startedAt ?? "").trim(),
    finishedAt: String(row.finished_at ?? row.finishedAt ?? "").trim(),
    blockerCode: ["none", "needs_sourcing", "dependency_misconfigured", "invalid_inventory", "blocked", "unknown"].includes(
      blockerCode
    )
      ? (blockerCode as CampaignPrepTaskBlockerCode)
      : "unknown",
    summary: String(row.summary ?? "").trim(),
    lastError: normalizeLegacyOutreachErrorText(row.last_error ?? row.lastError ?? ""),
    progress: asRecord(normalizeLegacyOutreachValue(asRecord(row.progress))),
    sourceVersion: String(row.source_version ?? row.sourceVersion ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()).trim(),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()).trim(),
  };
}

function mapOutreachLeaseRow(input: unknown): OutreachLease {
  const row = asRecord(input);
  const status = String(row.status ?? "").trim().toLowerCase();
  const leaseType = String(row.lease_type ?? row.leaseType ?? "").trim().toLowerCase();
  const scopeType = String(row.scope_type ?? row.scopeType ?? "").trim().toLowerCase();
  return {
    id: String(row.id ?? "").trim(),
    leaseType: leaseType === "campaign_prep" ? "campaign_prep" : "campaign_prep",
    scopeType: scopeType === "campaign" ? "campaign" : "campaign",
    scopeId: String(row.scope_id ?? row.scopeId ?? "").trim(),
    holder: String(row.holder ?? "").trim(),
    status: ["active", "released", "expired"].includes(status)
      ? (status as OutreachLeaseStatus)
      : "active",
    expiresAt: String(row.expires_at ?? row.expiresAt ?? nowIso()).trim(),
    metadata: asRecord(normalizeLegacyOutreachValue(asRecord(row.metadata))),
    releasedAt: String(row.released_at ?? row.releasedAt ?? "").trim(),
    releasedReason: String(row.released_reason ?? row.releasedReason ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()).trim(),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()).trim(),
  };
}

function mapEventRow(input: unknown): OutreachEvent {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    eventType: String(row.event_type ?? row.eventType ?? ""),
    payload: asRecord(normalizeLegacyOutreachValue(asRecord(row.payload))),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
  };
}

function mapCustomerIoProfileAdmissionRow(input: unknown): CustomerIoProfileAdmission {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    accountId: String(row.account_id ?? row.accountId ?? "").trim(),
    billingPeriodStart: String(row.billing_period_start ?? row.billingPeriodStart ?? "").trim(),
    profileIdentifier: normalizeCustomerIoProfileIdentifier(
      String(row.profile_identifier ?? row.profileIdentifier ?? "")
    ),
    sourceRunId: String(row.source_run_id ?? row.sourceRunId ?? "").trim(),
    sourceMessageId: String(row.source_message_id ?? row.sourceMessageId ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
  };
}

function mapDeliverabilityProbeTarget(input: unknown): DeliverabilityProbeTarget {
  const row = asRecord(input);
  return {
    reservationId: String(row.reservation_id ?? row.reservationId ?? "").trim() || undefined,
    accountId: String(row.account_id ?? row.accountId ?? "").trim(),
    email: String(row.email ?? "").trim().toLowerCase(),
    providerMessageId: String(row.provider_message_id ?? row.providerMessageId ?? "").trim() || undefined,
  };
}

function mapDeliverabilityProbeMonitorResult(input: unknown): DeliverabilityProbeMonitorResult {
  const row = asRecord(input);
  return {
    accountId: String(row.account_id ?? row.accountId ?? "").trim(),
    email: String(row.email ?? "").trim().toLowerCase(),
    placement: String(row.placement ?? "unknown").trim(),
    matchedMailbox: String(row.matched_mailbox ?? row.matchedMailbox ?? "").trim(),
    matchedUid: Math.max(0, Number(row.matched_uid ?? row.matchedUid ?? 0) || 0),
    ok: Boolean(row.ok),
    error: String(row.error ?? "").trim(),
  };
}

function mapDeliverabilityProbeRunRow(input: unknown): DeliverabilityProbeRun {
  const row = asRecord(input);
  const monitorTargetsRaw = Array.isArray(row.monitor_targets)
    ? row.monitor_targets
    : Array.isArray(row.monitorTargets)
      ? row.monitorTargets
      : [];
  const resultsRaw = Array.isArray(row.results) ? row.results : [];
  const reservationIdsRaw = Array.isArray(row.reservation_ids)
    ? row.reservation_ids
    : Array.isArray(row.reservationIds)
      ? row.reservationIds
      : [];
  const counts = asRecord(row.counts);
  return {
    id: String(row.id ?? "").trim(),
    runId: String(row.run_id ?? row.runId ?? "").trim(),
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    campaignId: String(row.campaign_id ?? row.campaignId ?? "").trim(),
    experimentId: String(row.experiment_id ?? row.experimentId ?? "").trim(),
    probeToken: String(row.probe_token ?? row.probeToken ?? "").trim(),
    probeVariant: String(row.probe_variant ?? row.probeVariant) === "baseline" ? "baseline" : "production",
    status: ["queued", "sent", "waiting", "completed", "failed"].includes(String(row.status))
      ? (String(row.status) as DeliverabilityProbeRun["status"])
      : "queued",
    stage: String(row.stage) === "poll" ? "poll" : "send",
    sourceMessageId: String(row.source_message_id ?? row.sourceMessageId ?? "").trim(),
    sourceMessageStatus: String(row.source_message_status ?? row.sourceMessageStatus ?? "").trim(),
    sourceType: String(row.source_type ?? row.sourceType ?? "").trim(),
    sourceNodeId: String(row.source_node_id ?? row.sourceNodeId ?? "").trim(),
    sourceLeadId: String(row.source_lead_id ?? row.sourceLeadId ?? "").trim(),
    senderAccountId: String(row.sender_account_id ?? row.senderAccountId ?? "").trim(),
    senderAccountName: String(row.sender_account_name ?? row.senderAccountName ?? "").trim(),
    fromEmail: String(row.from_email ?? row.fromEmail ?? "").trim().toLowerCase(),
    replyToEmail: String(row.reply_to_email ?? row.replyToEmail ?? "").trim().toLowerCase(),
    subject: String(row.subject ?? "").trim(),
    contentHash: String(row.content_hash ?? row.contentHash ?? "").trim(),
    reservationIds: reservationIdsRaw.map((item) => String(item ?? "").trim()).filter(Boolean),
    monitorTargets: monitorTargetsRaw.map((item) => mapDeliverabilityProbeTarget(item)).filter((item) => item.accountId && item.email),
    results: resultsRaw.map((item) => mapDeliverabilityProbeMonitorResult(item)).filter((item) => item.accountId && item.email),
    pollAttempt: Math.max(0, Number(row.poll_attempt ?? row.pollAttempt ?? 0) || 0),
    placement: String(row.placement ?? "unknown").trim(),
    totalMonitors: Math.max(0, Number(row.total_monitors ?? row.totalMonitors ?? 0) || 0),
    counts,
    summaryText: String(row.summary_text ?? row.summaryText ?? "").trim(),
    lastError: String(row.last_error ?? row.lastError ?? "").trim(),
    completedAt: String(row.completed_at ?? row.completedAt ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapDeliverabilitySeedReservationRow(input: unknown): DeliverabilitySeedReservation {
  const row = asRecord(input);
  return {
    id: String(row.id ?? "").trim(),
    probeRunId: String(row.probe_run_id ?? row.probeRunId ?? "").trim(),
    runId: String(row.run_id ?? row.runId ?? "").trim(),
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    senderAccountId: String(row.sender_account_id ?? row.senderAccountId ?? "").trim(),
    fromEmail: String(row.from_email ?? row.fromEmail ?? "").trim().toLowerCase(),
    monitorAccountId: String(row.monitor_account_id ?? row.monitorAccountId ?? "").trim(),
    monitorEmail: String(row.monitor_email ?? row.monitorEmail ?? "").trim().toLowerCase(),
    probeVariant: String(row.probe_variant ?? row.probeVariant) === "baseline" ? "baseline" : "production",
    contentHash: String(row.content_hash ?? row.contentHash ?? "").trim(),
    probeToken: String(row.probe_token ?? row.probeToken ?? "").trim(),
    status: ["reserved", "consumed", "released"].includes(String(row.status))
      ? (String(row.status) as DeliverabilitySeedReservationStatus)
      : "reserved",
    providerMessageId: String(row.provider_message_id ?? row.providerMessageId ?? "").trim(),
    releasedReason: String(row.released_reason ?? row.releasedReason ?? "").trim(),
    reservedAt: String(row.reserved_at ?? row.reservedAt ?? nowIso()).trim(),
    consumedAt: String(row.consumed_at ?? row.consumedAt ?? "").trim(),
    releasedAt: String(row.released_at ?? row.releasedAt ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapWarmupSeedReservationRow(input: unknown): WarmupSeedReservation {
  const row = asRecord(input);
  return {
    id: String(row.id ?? "").trim(),
    runId: String(row.run_id ?? row.runId ?? "").trim(),
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    senderAccountId: String(row.sender_account_id ?? row.senderAccountId ?? "").trim(),
    fromEmail: String(row.from_email ?? row.fromEmail ?? "").trim().toLowerCase(),
    monitorAccountId: String(row.monitor_account_id ?? row.monitorAccountId ?? "").trim(),
    monitorEmail: String(row.monitor_email ?? row.monitorEmail ?? "").trim().toLowerCase(),
    status: ["reserved", "released"].includes(String(row.status))
      ? (String(row.status) as WarmupSeedReservationStatus)
      : "reserved",
    providerMessageId: String(row.provider_message_id ?? row.providerMessageId ?? "").trim(),
    releasedReason: String(row.released_reason ?? row.releasedReason ?? "").trim(),
    reservedAt: String(row.reserved_at ?? row.reservedAt ?? nowIso()).trim(),
    consumedAt: String(row.consumed_at ?? row.consumedAt ?? "").trim(),
    releasedAt: String(row.released_at ?? row.releasedAt ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapSenderLaunchRow(input: unknown): SenderLaunch {
  const row = asRecord(input);
  const planType = String(row.plan_type ?? row.planType ?? "").trim();
  const state = String(row.state ?? "").trim();
  return {
    id: String(row.id ?? "").trim(),
    senderAccountId: String(row.sender_account_id ?? row.senderAccountId ?? "").trim(),
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    fromEmail: String(row.from_email ?? row.fromEmail ?? "").trim().toLowerCase(),
    domain: String(row.domain ?? "").trim().toLowerCase(),
    planType: ["bridge", "subdomain", "fresh"].includes(planType)
      ? (planType as SenderLaunch["planType"])
      : "fresh",
    state: ["setup", "observing", "warming", "restricted_send", "ready", "paused", "blocked"].includes(state)
      ? (state as SenderLaunch["state"])
      : "setup",
    readinessScore: Math.max(0, Math.min(100, Number(row.readiness_score ?? row.readinessScore ?? 0) || 0)),
    summary: String(row.summary ?? "").trim(),
    nextStep: String(row.next_step ?? row.nextStep ?? "").trim(),
    topicSummary: String(row.topic_summary ?? row.topicSummary ?? "").trim(),
    topicKeywords: asArray(row.topic_keywords ?? row.topicKeywords)
      .map((entry) => String(entry ?? "").trim().toLowerCase())
      .filter(Boolean),
    sourceExperimentIds: asArray(row.source_experiment_ids ?? row.sourceExperimentIds)
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean),
    infraScore: Math.max(0, Math.min(30, Number(row.infra_score ?? row.infraScore ?? 0) || 0)),
    reputationScore: Math.max(0, Math.min(25, Number(row.reputation_score ?? row.reputationScore ?? 0) || 0)),
    trustScore: Math.max(0, Math.min(20, Number(row.trust_score ?? row.trustScore ?? 0) || 0)),
    safetyScore: Math.max(0, Math.min(15, Number(row.safety_score ?? row.safetyScore ?? 0) || 0)),
    topicScore: Math.max(0, Math.min(10, Number(row.topic_score ?? row.topicScore ?? 0) || 0)),
    dailyCap: Math.max(0, Number(row.daily_cap ?? row.dailyCap ?? 0) || 0),
    sentCount: Math.max(0, Number(row.sent_count ?? row.sentCount ?? 0) || 0),
    repliedCount: Math.max(0, Number(row.replied_count ?? row.repliedCount ?? 0) || 0),
    bouncedCount: Math.max(0, Number(row.bounced_count ?? row.bouncedCount ?? 0) || 0),
    failedCount: Math.max(0, Number(row.failed_count ?? row.failedCount ?? 0) || 0),
    inboxRate: clampZeroOne(row.inbox_rate ?? row.inboxRate, 0),
    spamRate: clampZeroOne(row.spam_rate ?? row.spamRate, 0),
    trustEventCount: Math.max(0, Number(row.trust_event_count ?? row.trustEventCount ?? 0) || 0),
    pausedUntil: String(row.paused_until ?? row.pausedUntil ?? "").trim(),
    pauseReason: String(row.pause_reason ?? row.pauseReason ?? "").trim(),
    lastEventAt: String(row.last_event_at ?? row.lastEventAt ?? "").trim(),
    lastEvaluatedAt: String(row.last_evaluated_at ?? row.lastEvaluatedAt ?? "").trim(),
    autopilotMode:
      String(row.autopilot_mode ?? row.autopilotMode ?? "").trim() === "curated_only"
        ? "curated_only"
        : "curated_plus_open_web",
    autopilotAllowedDomains: asArray(row.autopilot_allowed_domains ?? row.autopilotAllowedDomains)
      .map((entry) => String(entry ?? "").trim().toLowerCase())
      .filter(Boolean),
    autopilotBlockedDomains: asArray(row.autopilot_blocked_domains ?? row.autopilotBlockedDomains)
      .map((entry) => String(entry ?? "").trim().toLowerCase())
      .filter(Boolean),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapSenderLaunchActionRow(input: unknown): SenderLaunchAction {
  const row = asRecord(input);
  const lane = String(row.lane ?? "").trim();
  const actionType = String(row.action_type ?? row.actionType ?? "").trim();
  const status = String(row.status ?? "").trim();
  return {
    id: String(row.id ?? "").trim(),
    senderLaunchId: String(row.sender_launch_id ?? row.senderLaunchId ?? "").trim(),
    senderAccountId: String(row.sender_account_id ?? row.senderAccountId ?? "").trim(),
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    lane: ["opt_in", "double_opt_in", "inquiry"].includes(lane)
      ? (lane as SenderLaunchAction["lane"])
      : "opt_in",
    actionType: ["execute_opt_in", "confirm_double_opt_in", "execute_inquiry"].includes(actionType)
      ? (actionType as SenderLaunchAction["actionType"])
      : "execute_opt_in",
    sourceKey: String(row.source_key ?? row.sourceKey ?? "").trim(),
    status: ["queued", "running", "waiting", "completed", "failed", "skipped"].includes(status)
      ? (status as SenderLaunchAction["status"])
      : "queued",
    executeAfter: String(row.execute_after ?? row.executeAfter ?? nowIso()).trim(),
    attempts: Math.max(0, Number(row.attempts ?? 0) || 0),
    maxAttempts: Math.max(1, Number(row.max_attempts ?? row.maxAttempts ?? 5) || 5),
    payload: asRecord(row.payload),
    resultSummary: String(row.result_summary ?? row.resultSummary ?? "").trim(),
    lastError: String(row.last_error ?? row.lastError ?? "").trim(),
    completedAt: String(row.completed_at ?? row.completedAt ?? "").trim(),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapSenderLaunchEventRow(input: unknown): SenderLaunchEvent {
  const row = asRecord(input);
  const eventType = String(row.event_type ?? row.eventType ?? "").trim();
  return {
    id: String(row.id ?? "").trim(),
    senderLaunchId: String(row.sender_launch_id ?? row.senderLaunchId ?? "").trim(),
    senderAccountId: String(row.sender_account_id ?? row.senderAccountId ?? "").trim(),
    brandId: String(row.brand_id ?? row.brandId ?? "").trim(),
    eventType: [
      "launch_initialized",
      "topic_profile_refreshed",
      "autopilot_policy_updated",
      "bridge_inbound_recorded",
      "opt_in_scheduled",
      "opt_in_completed",
      "double_opt_in_received",
      "double_opt_in_confirmed",
      "inquiry_scheduled",
      "inquiry_completed",
      "action_failed",
      "state_changed",
      "first_reply_recorded",
      "healthy_probe_recorded",
      "launch_paused",
      "launch_resumed",
    ].includes(eventType)
      ? (eventType as SenderLaunchEvent["eventType"])
      : "launch_initialized",
    title: String(row.title ?? "").trim(),
    detail: String(row.detail ?? "").trim(),
    metadata: asRecord(row.metadata),
    occurredAt: String(row.occurred_at ?? row.occurredAt ?? nowIso()),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
  };
}

function mapSourcingActorProfileRow(input: unknown): ActorCapabilityProfile {
  const row = asRecord(input);
  const stageHintsRaw = row.stage_hints ?? row.stageHints;
  const stageHints = Array.isArray(stageHintsRaw)
    ? stageHintsRaw
        .map((item) => String(item ?? "").trim())
        .filter((item) => ["prospect_discovery", "website_enrichment", "email_discovery"].includes(item))
    : [];
  return {
    actorId: String(row.actor_id ?? row.actorId ?? ""),
    stageHints: stageHints as ActorCapabilityProfile["stageHints"],
    schemaSummary:
      row.schema_summary && typeof row.schema_summary === "object" && !Array.isArray(row.schema_summary)
        ? (row.schema_summary as Record<string, unknown>)
        : row.schemaSummary && typeof row.schemaSummary === "object" && !Array.isArray(row.schemaSummary)
          ? (row.schemaSummary as Record<string, unknown>)
          : {},
    compatibilityScore: Number(row.compatibility_score ?? row.compatibilityScore ?? 0) || 0,
    lastSeenMetadata:
      row.last_seen_metadata && typeof row.last_seen_metadata === "object" && !Array.isArray(row.last_seen_metadata)
        ? (row.last_seen_metadata as Record<string, unknown>)
        : row.lastSeenMetadata && typeof row.lastSeenMetadata === "object" && !Array.isArray(row.lastSeenMetadata)
          ? (row.lastSeenMetadata as Record<string, unknown>)
          : {},
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapSourcingChainDecisionRow(input: unknown): SourcingChainDecision {
  const row = asRecord(input);
  const selectedChainRaw = Array.isArray(row.selected_chain)
    ? row.selected_chain
    : Array.isArray(row.selectedChain)
      ? row.selectedChain
      : [];
  const selectedChain: SourcingChainStep[] = selectedChainRaw
    .map((item) => asRecord(item))
    .map((item, index) => ({
      id: String(item.id ?? `step_${index + 1}`).trim(),
      stage: ["prospect_discovery", "website_enrichment", "email_discovery"].includes(String(item.stage))
        ? (String(item.stage) as SourcingChainStep["stage"])
        : "prospect_discovery",
      actorId: String(item.actorId ?? item.actor_id ?? "").trim(),
      purpose: String(item.purpose ?? "").trim(),
      queryHint: String(item.queryHint ?? item.query_hint ?? "").trim(),
    }))
    .filter((item) => item.id && item.actorId);

  const qualityPolicyRaw = asRecord(row.quality_policy ?? row.qualityPolicy);
  const qualityPolicy: LeadQualityPolicy = {
    allowFreeDomains: Boolean(qualityPolicyRaw.allowFreeDomains ?? false),
    allowRoleInboxes: Boolean(qualityPolicyRaw.allowRoleInboxes ?? false),
    requirePersonName: Boolean(qualityPolicyRaw.requirePersonName ?? true),
    requireCompany: Boolean(qualityPolicyRaw.requireCompany ?? true),
    requireTitle: Boolean(qualityPolicyRaw.requireTitle ?? false),
    requiredTitleKeywords: Array.isArray(qualityPolicyRaw.requiredTitleKeywords)
      ? qualityPolicyRaw.requiredTitleKeywords.map((item) => String(item).trim()).filter(Boolean)
      : [],
    requiredCompanyKeywords: Array.isArray(qualityPolicyRaw.requiredCompanyKeywords)
      ? qualityPolicyRaw.requiredCompanyKeywords.map((item) => String(item).trim()).filter(Boolean)
      : [],
    excludedCompanyKeywords: Array.isArray(qualityPolicyRaw.excludedCompanyKeywords)
      ? qualityPolicyRaw.excludedCompanyKeywords.map((item) => String(item).trim()).filter(Boolean)
      : [],
    minConfidenceScore: Math.max(0, Math.min(1, Number(qualityPolicyRaw.minConfidenceScore ?? 0.55) || 0.55)),
  };

  return {
    id: String(row.id ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    experimentOwnerId: String(row.experiment_owner_id ?? row.experimentOwnerId ?? ""),
    runtimeCampaignId: String(row.runtime_campaign_id ?? row.runtimeCampaignId ?? ""),
    runtimeExperimentId: String(row.runtime_experiment_id ?? row.runtimeExperimentId ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    strategy: String(row.strategy ?? "").trim(),
    rationale: String(row.rationale ?? "").trim(),
    budgetUsedUsd: Math.max(0, Number(row.budget_used_usd ?? row.budgetUsedUsd ?? 0) || 0),
    qualityPolicy,
    selectedChain,
    probeSummary: asRecord(row.probe_summary ?? row.probeSummary),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

function mapSourcingProbeResultRow(input: unknown): SourcingProbeResult {
  const row = asRecord(input);
  return {
    id: String(row.id ?? ""),
    decisionId: String(row.decision_id ?? row.decisionId ?? ""),
    brandId: String(row.brand_id ?? row.brandId ?? ""),
    experimentOwnerId: String(row.experiment_owner_id ?? row.experimentOwnerId ?? ""),
    runId: String(row.run_id ?? row.runId ?? ""),
    stepIndex: Math.max(0, Number(row.step_index ?? row.stepIndex ?? 0) || 0),
    actorId: String(row.actor_id ?? row.actorId ?? ""),
    stage: ["prospect_discovery", "website_enrichment", "email_discovery"].includes(String(row.stage))
      ? (String(row.stage) as SourcingProbeResult["stage"])
      : "prospect_discovery",
    probeInputHash: String(row.probe_input_hash ?? row.probeInputHash ?? ""),
    outcome: String(row.outcome) === "pass" ? "pass" : "fail",
    qualityMetrics: asRecord(row.quality_metrics ?? row.qualityMetrics),
    costEstimateUsd: Math.max(0, Number(row.cost_estimate_usd ?? row.costEstimateUsd ?? 0) || 0),
    details: asRecord(row.details),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
  };
}

function mapSourcingActorMemoryRow(input: unknown): SourcingActorMemory {
  const row = asRecord(input);
  return {
    actorId: String(row.actor_id ?? row.actorId ?? ""),
    successCount: Math.max(0, Number(row.success_count ?? row.successCount ?? 0) || 0),
    failCount: Math.max(0, Number(row.fail_count ?? row.failCount ?? 0) || 0),
    compatibilityFailCount: Math.max(
      0,
      Number(row.compatibility_fail_count ?? row.compatibilityFailCount ?? 0) || 0
    ),
    leadsAccepted: Math.max(0, Number(row.leads_accepted ?? row.leadsAccepted ?? 0) || 0),
    leadsRejected: Math.max(0, Number(row.leads_rejected ?? row.leadsRejected ?? 0) || 0),
    avgQuality: Math.max(0, Math.min(1, Number(row.avg_quality ?? row.avgQuality ?? 0) || 0)),
    createdAt: String(row.created_at ?? row.createdAt ?? nowIso()),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? nowIso()),
  };
}

async function readLocalStore(): Promise<OutreachStore> {
  try {
    const raw = await readFile(OUTREACH_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const row = asRecord(parsed);
    return {
      accounts: asArray(row.accounts).map((item) => mapAccountRowFromDb(item)),
      customerIoProfileAdmissions: asArray(row.customerIoProfileAdmissions).map((item) =>
        mapCustomerIoProfileAdmissionRow(item)
      ),
      assignments: asArray(row.assignments).map((entry) => mapAssignmentRow(entry)),
      runs: asArray(row.runs).map((item) => mapRunRow(item)),
      runLeads: asArray(row.runLeads).map((item) => mapRunLeadRow(item)),
      messages: asArray(row.messages).map((item) => mapMessageRow(item)),
      replyThreads: asArray(row.replyThreads).map((item) => mapThreadRow(item)),
      replyThreadStates: asArray(row.replyThreadStates).map((item) => mapThreadStateRow(item)),
      replyMessages: asArray(row.replyMessages).map((item) => mapReplyMessageRow(item)),
      replyDrafts: asArray(row.replyDrafts).map((item) => mapDraftRow(item)),
      replyThreadFeedback: asArray(row.replyThreadFeedback).map((item) => mapReplyThreadFeedbackRow(item)),
      inboxSyncStates: asArray(row.inboxSyncStates).map((item) => mapInboxSyncStateRow(item)),
      inboxEvalRuns: asArray(row.inboxEvalRuns).map((item) => mapInboxEvalRunRow(item)),
      anomalies: asArray(row.anomalies).map((item) => mapAnomalyRow(item)),
      events: asArray(row.events).map((item) => mapEventRow(item)),
      jobs: asArray(row.jobs).map((item) => mapJobRow(item)),
      campaignPrepTasks: asArray(row.campaignPrepTasks).map((item) => mapCampaignPrepTaskRow(item)),
      outreachLeases: asArray(row.outreachLeases).map((item) => mapOutreachLeaseRow(item)),
      deliverabilityProbeRuns: asArray(row.deliverabilityProbeRuns).map((item) => mapDeliverabilityProbeRunRow(item)),
      deliverabilitySeedReservations: asArray(row.deliverabilitySeedReservations).map((item) =>
        mapDeliverabilitySeedReservationRow(item)
      ),
      warmupSeedReservations: asArray(row.warmupSeedReservations).map((item) => mapWarmupSeedReservationRow(item)),
      sourcingActorProfiles: asArray(row.sourcingActorProfiles).map((item) => mapSourcingActorProfileRow(item)),
      sourcingChainDecisions: asArray(row.sourcingChainDecisions).map((item) => mapSourcingChainDecisionRow(item)),
      sourcingProbeResults: asArray(row.sourcingProbeResults).map((item) => mapSourcingProbeResultRow(item)),
      sourcingActorMemory: asArray(row.sourcingActorMemory).map((item) => mapSourcingActorMemoryRow(item)),
      senderLaunches: asArray(row.senderLaunches).map((item) => mapSenderLaunchRow(item)),
      senderLaunchActions: asArray(row.senderLaunchActions).map((item) => mapSenderLaunchActionRow(item)),
      senderLaunchEvents: asArray(row.senderLaunchEvents).map((item) => mapSenderLaunchEventRow(item)),
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

export async function getOutreachAccountLookupDebug(accountId: string): Promise<OutreachAccountLookupDebug> {
  const info: OutreachAccountLookupDebug = {
    accountId,
    runtime: isVercel ? "vercel" : "local",
    supabaseConfigured: false,
    supabaseHasAccount: false,
    supabaseAccountCount: 0,
    supabaseError: "",
    localHasAccount: false,
    localAccountCount: 0,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    info.supabaseConfigured = true;

    const { data: accountRow, error: accountError } = await supabase
      .from(TABLE_ACCOUNT)
      .select("id")
      .eq("id", accountId)
      .maybeSingle();
    if (!accountError && accountRow) {
      info.supabaseHasAccount = true;
    }
    if (accountError) {
      info.supabaseError = accountError.message;
    }

    const { count, error: countError } = await supabase
      .from(TABLE_ACCOUNT)
      .select("id", { count: "exact", head: true });
    if (!countError) {
      info.supabaseAccountCount = Number(count ?? 0);
    } else if (!info.supabaseError) {
      info.supabaseError = countError.message;
    }
  }

  const localStore = await readLocalStore();
  info.localAccountCount = localStore.accounts.length;
  info.localHasAccount = localStore.accounts.some((row) => row.id === accountId);

  return info;
}

function buildStoredAccount(input: {
  id?: string;
  name: string;
  provider?: OutreachAccount["provider"];
  accountType?: OutreachAccount["accountType"];
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
    provider: input.provider ?? "customerio",
    accountType: input.accountType ?? "hybrid",
    status: input.status ?? "active",
    config: sanitizeAccountConfig(input.config),
    credentialsEncrypted: input.credentialsEncrypted,
    lastTestAt: input.lastTestAt ?? "",
    lastTestStatus: input.lastTestStatus ?? "unknown",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

function supabaseConfigured(): boolean {
  const hasServiceKey = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SECRET_KEY
  );
  return Boolean(
    process.env.SUPABASE_URL && hasServiceKey
  );
}

function supabaseHostFromEnv(): string {
  const raw = String(process.env.SUPABASE_URL ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}

function supabaseErrorDebug(error: unknown) {
  const row = asRecord(error);
  const message = typeof row.message === "string" ? row.message : String(error ?? "");
  return {
    message,
    details: typeof row.details === "string" ? row.details : "",
    hint: typeof row.hint === "string" ? row.hint : "",
    code: typeof row.code === "string" ? row.code : "",
  };
}

function isMissingColumnError(error: unknown, columnName: string) {
  const dbg = supabaseErrorDebug(error);
  const msg = `${dbg.message}\n${dbg.details}`.toLowerCase();
  const needle = columnName.toLowerCase();
  return msg.includes(needle) && (msg.includes("does not exist") || msg.includes("column") && msg.includes("schema cache"));
}

function missingColumnNameFromError(error: unknown) {
  const dbg = supabaseErrorDebug(error);
  const combined = `${dbg.message}\n${dbg.details}`;
  const quotedMatch = combined.match(/['"]([a-z0-9_]+)['"]\s+column/i);
  if (quotedMatch?.[1]) return quotedMatch[1].toLowerCase();
  const relationMatch = combined.match(/column\s+([a-z0-9_]+)\s+of\s+relation/i);
  if (relationMatch?.[1]) return relationMatch[1].toLowerCase();
  return "";
}

function hintForSupabaseWriteError(error: unknown) {
  const dbg = supabaseErrorDebug(error);
  const msg = dbg.message.toLowerCase();
  const details = dbg.details.toLowerCase();
  const combined = `${msg}\n${details}`;

  if (
    combined.includes("enotfound") ||
    combined.includes("getaddrinfo") ||
    combined.includes("fetch failed")
  ) {
    return "Supabase host is unreachable from this deployment. Verify SUPABASE_URL in Vercel uses your live project URL exactly: https://<project-ref>.supabase.co (no typos), then redeploy.";
  }

  if (msg.includes("relation") && msg.includes("does not exist")) {
    if (msg.includes("demanddev_outreach_accounts")) {
      return "Outreach tables are missing. In Supabase SQL Editor, run supabase/migrations/20260211103000_outreach_autopilot.sql and supabase/migrations/20260211152000_outreach_split_accounts.sql.";
    }
    if (msg.includes("demanddev_customerio_profile_admissions")) {
      return "Customer.io profile budget tables are missing. Apply supabase/migrations/20260310143000_customerio_profile_budget.sql, then redeploy.";
    }
    if (msg.includes("demanddev_campaign_prep_tasks") || msg.includes("demanddev_outreach_leases")) {
      return "Campaign prep task tables are missing. Apply supabase/migrations/20260414143000_campaign_prep_tasks.sql, then redeploy.";
    }
    return "Supabase tables are missing. Apply migrations in supabase/migrations to your Supabase project, then redeploy.";
  }

  if (isMissingColumnError(error, "account_type")) {
    return "Your Supabase schema is missing `demanddev_outreach_accounts.account_type`. Apply supabase/migrations/20260211152000_outreach_split_accounts.sql, then redeploy.";
  }

  if (isMissingColumnError(error, "mailbox_account_id")) {
    return "Your Supabase schema is missing `demanddev_brand_outreach_assignments.mailbox_account_id`. Apply supabase/migrations/20260211152000_outreach_split_accounts.sql, then redeploy.";
  }

  if (isMissingColumnError(error, "account_ids")) {
    return "Your Supabase schema is missing `demanddev_brand_outreach_assignments.account_ids`. Apply supabase/migrations/20260311180000_outreach_multi_sender_assignments.sql, then redeploy.";
  }

  if (msg.includes("demanddev_claim_customerio_profile_admission")) {
    return "Your Supabase schema is missing the Customer.io profile budget RPC. Apply supabase/migrations/20260310143000_customerio_profile_budget.sql, then redeploy.";
  }

  return dbg.hint || "Supabase request failed. Check SUPABASE_URL, service-role permissions, and migrations.";
}

function isMissingRelationError(error: unknown, relationName: string) {
  const dbg = supabaseErrorDebug(error);
  const message = `${dbg.message}\n${dbg.details}`.toLowerCase();
  return message.includes(relationName.toLowerCase()) && message.includes("does not exist");
}

function isUniqueViolationError(error: unknown) {
  const dbg = supabaseErrorDebug(error);
  return dbg.code === "23505";
}

async function hydrateOutreachAccountCustomerIoBilling(account: OutreachAccount): Promise<OutreachAccount> {
  if (account.provider !== "customerio" || !account.config.customerIo.siteId.trim()) {
    return account;
  }
  const billingPeriodStart = currentCustomerIoBillingPeriodStart(account.config.customerIo.billing.billingCycleAnchorDay);
  let admittedProfiles = 0;
  try {
    admittedProfiles = await countCustomerIoProfileAdmissions(account.id, billingPeriodStart, {
      allowMissingTable: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown Customer.io billing hydration failure";
    console.error(
      `[outreach] Failed to hydrate Customer.io billing for ${account.id}; continuing without live admission count: ${detail}`
    );
  }
  return {
    ...account,
    customerIoBilling: buildCustomerIoBillingSummary({
      config: account.config.customerIo.billing,
      admittedProfiles,
    }),
  };
}

export async function countCustomerIoProfileAdmissions(
  accountId: string,
  billingPeriodStart: string,
  options: { allowMissingTable?: boolean } = {}
): Promise<number> {
  const periodStart = billingPeriodStart.trim();
  if (!periodStart) return 0;

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { count, error } = await supabase
      .from(TABLE_CUSTOMER_IO_PROFILE_ADMISSION)
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("billing_period_start", periodStart);
    if (!error) {
      return Math.max(0, Number(count ?? 0));
    }
    if (options.allowMissingTable && isMissingRelationError(error, TABLE_CUSTOMER_IO_PROFILE_ADMISSION)) {
      return 0;
    }
    if (isVercel) {
      throw new OutreachDataError("Failed to count Customer.io profile admissions from Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "countCustomerIoProfileAdmissions",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          accountId,
          billingPeriodStart: periodStart,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  return store.customerIoProfileAdmissions.filter(
    (row) => row.accountId === accountId && row.billingPeriodStart === periodStart
  ).length;
}

export async function findCustomerIoProfileAdmission(
  accountId: string,
  billingPeriodStart: string,
  profileIdentifier: string,
  options: { allowMissingTable?: boolean } = {}
): Promise<CustomerIoProfileAdmission | null> {
  const periodStart = billingPeriodStart.trim();
  const normalizedIdentifier = normalizeCustomerIoProfileIdentifier(profileIdentifier);
  if (!periodStart || !normalizedIdentifier) return null;

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_CUSTOMER_IO_PROFILE_ADMISSION)
      .select("*")
      .eq("account_id", accountId)
      .eq("billing_period_start", periodStart)
      .eq("profile_identifier", normalizedIdentifier)
      .maybeSingle();
    if (!error) {
      return data ? mapCustomerIoProfileAdmissionRow(data) : null;
    }
    if (options.allowMissingTable && isMissingRelationError(error, TABLE_CUSTOMER_IO_PROFILE_ADMISSION)) {
      return null;
    }
    if (isVercel) {
      throw new OutreachDataError("Failed to load Customer.io profile admission from Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "findCustomerIoProfileAdmission",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          accountId,
          billingPeriodStart: periodStart,
          profileIdentifier: normalizedIdentifier,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  return (
    store.customerIoProfileAdmissions.find(
      (row) =>
        row.accountId === accountId &&
        row.billingPeriodStart === periodStart &&
        row.profileIdentifier === normalizedIdentifier
    ) ?? null
  );
}

export async function claimCustomerIoProfileAdmission(input: {
  accountId: string;
  billingPeriodStart: string;
  profileIdentifier: string;
  sourceRunId: string;
  sourceMessageId: string;
  effectiveLimit: number;
}): Promise<{
  status: "existing" | "admitted" | "blocked";
  currentCount: number;
  admission: CustomerIoProfileAdmission | null;
}> {
  const periodStart = input.billingPeriodStart.trim();
  const normalizedIdentifier = normalizeCustomerIoProfileIdentifier(input.profileIdentifier);
  const effectiveLimit = Math.max(0, Math.floor(Number(input.effectiveLimit ?? 0) || 0));
  if (!periodStart || !normalizedIdentifier) {
    return {
      status: "blocked",
      currentCount: 0,
      admission: null,
    };
  }

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase.rpc("demanddev_claim_customerio_profile_admission", {
      p_account_id: input.accountId,
      p_billing_period_start: periodStart,
      p_profile_identifier: normalizedIdentifier,
      p_source_run_id: input.sourceRunId,
      p_source_message_id: input.sourceMessageId,
      p_effective_limit: effectiveLimit,
    });
    if (!error) {
      const row = Array.isArray(data) ? asRecord(data[0]) : asRecord(data);
      const status = String(row.status ?? "").trim();
      const currentCount = Math.max(0, Number(row.current_count ?? row.currentCount ?? 0) || 0);
      const admissionId = String(row.admission_id ?? row.admissionId ?? "").trim();
      const createdAt = String(row.created_at ?? row.createdAt ?? nowIso()).trim();
      return {
        status: status === "existing" || status === "blocked" ? status : "admitted",
        currentCount,
        admission:
          admissionId && status !== "blocked"
            ? {
                id: admissionId,
                accountId: input.accountId,
                billingPeriodStart: periodStart,
                profileIdentifier: normalizedIdentifier,
                sourceRunId: input.sourceRunId,
                sourceMessageId: input.sourceMessageId,
                createdAt,
              }
            : null,
      };
    }

    if (isVercel) {
      throw new OutreachDataError("Failed to claim Customer.io profile admission in Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "claimCustomerIoProfileAdmission",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          accountId: input.accountId,
          billingPeriodStart: periodStart,
          profileIdentifier: normalizedIdentifier,
          effectiveLimit,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  const currentCount = store.customerIoProfileAdmissions.filter(
    (row) => row.accountId === input.accountId && row.billingPeriodStart === periodStart
  ).length;
  const existing =
    store.customerIoProfileAdmissions.find(
      (row) =>
        row.accountId === input.accountId &&
        row.billingPeriodStart === periodStart &&
        row.profileIdentifier === normalizedIdentifier
    ) ?? null;
  if (existing) {
    return {
      status: "existing",
      currentCount,
      admission: existing,
    };
  }
  if (currentCount >= effectiveLimit) {
    return {
      status: "blocked",
      currentCount,
      admission: null,
    };
  }

  const admission: CustomerIoProfileAdmission = {
    id: createId("cioadm"),
    accountId: input.accountId,
    billingPeriodStart: periodStart,
    profileIdentifier: normalizedIdentifier,
    sourceRunId: input.sourceRunId,
    sourceMessageId: input.sourceMessageId,
    createdAt: nowIso(),
  };
  store.customerIoProfileAdmissions.unshift(admission);
  await writeLocalStore(store);
  return {
    status: "admitted",
    currentCount: currentCount + 1,
    admission,
  };
}

export async function listOutreachAccounts(): Promise<OutreachAccount[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    if (isVercel) {
      throw new OutreachDataError("Supabase is not configured for outreach storage.", {
        status: 500,
        hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables, then redeploy.",
        debug: {
          operation: "listOutreachAccounts",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          supabaseHost: supabaseHostFromEnv(),
        },
      });
    }

    const store = await readLocalStore();
    return Promise.all(store.accounts.map((row) => hydrateOutreachAccountCustomerIoBilling(mapStoredAccount(row))));
  }

  const { data, error } = await supabase
    .from(TABLE_ACCOUNT)
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    if (isVercel) {
      throw new OutreachDataError("Failed to load outreach accounts from Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "listOutreachAccounts",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          supabaseHost: supabaseHostFromEnv(),
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }

    const store = await readLocalStore();
    return Promise.all(store.accounts.map((row) => hydrateOutreachAccountCustomerIoBilling(mapStoredAccount(row))));
  }

  return Promise.all(
    (data ?? []).map((row: unknown) => hydrateOutreachAccountCustomerIoBilling(mapStoredAccount(mapAccountRowFromDb(row))))
  );
}

export async function listSocialRoutingAccounts(): Promise<OutreachAccount[]> {
  const accounts = await listOutreachAccounts();
  return accounts.filter((account) => hasExplicitSocialIdentity(account.config.social));
}

export async function getOutreachAccount(accountId: string): Promise<OutreachAccount | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    if (isVercel) {
      throw new OutreachDataError("Supabase is not configured for outreach storage.", {
        status: 500,
        hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables, then redeploy.",
        debug: {
          operation: "getOutreachAccount",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
        },
      });
    }

    const store = await readLocalStore();
    const hit = store.accounts.find((row) => row.id === accountId);
    return hit ? hydrateOutreachAccountCustomerIoBilling(mapStoredAccount(hit)) : null;
  }

  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ACCOUNT)
      .select("*")
      .eq("id", accountId)
      .maybeSingle();
    if (error) {
      if (isVercel) {
        throw new OutreachDataError("Failed to load outreach account from Supabase.", {
          status: 500,
          hint: hintForSupabaseWriteError(error),
          debug: {
            operation: "getOutreachAccount",
            runtime: runtimeLabel(),
            supabaseConfigured: supabaseConfigured(),
            accountId,
            supabaseError: supabaseErrorDebug(error),
          },
        });
      }

      const store = await readLocalStore();
      const hit = store.accounts.find((row) => row.id === accountId);
      return hit ? hydrateOutreachAccountCustomerIoBilling(mapStoredAccount(hit)) : null;
    }

    if (data) return hydrateOutreachAccountCustomerIoBilling(mapStoredAccount(mapAccountRowFromDb(data)));
  }

  if (isVercel) return null;

  const store = await readLocalStore();
  const hit = store.accounts.find((row) => row.id === accountId);
  return hit ? hydrateOutreachAccountCustomerIoBilling(mapStoredAccount(hit)) : null;
}

export async function getOutreachAccountSecrets(accountId: string): Promise<OutreachAccountSecrets | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    if (isVercel) {
      throw new OutreachDataError("Supabase is not configured for outreach storage.", {
        status: 500,
        hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables, then redeploy.",
        debug: {
          operation: "getOutreachAccountSecrets",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          accountId,
        },
      });
    }

    const store = await readLocalStore();
    const hit = store.accounts.find((row) => row.id === accountId);
    if (!hit) return null;
    return decryptJson<OutreachAccountSecrets>(hit.credentialsEncrypted, defaultSecrets());
  }

  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ACCOUNT)
      .select("id, credentials_encrypted")
      .eq("id", accountId)
      .maybeSingle();
    if (error) {
      if (isVercel) {
        throw new OutreachDataError("Failed to load outreach account credentials from Supabase.", {
          status: 500,
          hint: hintForSupabaseWriteError(error),
          debug: {
            operation: "getOutreachAccountSecrets",
            runtime: runtimeLabel(),
            supabaseConfigured: supabaseConfigured(),
            accountId,
            supabaseError: supabaseErrorDebug(error),
          },
        });
      }

      const store = await readLocalStore();
      const hit = store.accounts.find((row) => row.id === accountId);
      if (!hit) return null;
      return decryptJson<OutreachAccountSecrets>(hit.credentialsEncrypted, defaultSecrets());
    }
    if (data) {
      return decryptJson<OutreachAccountSecrets>(
        String((data as Record<string, unknown>).credentials_encrypted ?? ""),
        defaultSecrets()
      );
    }
  }

  if (isVercel) return null;

  const store = await readLocalStore();
  const hit = store.accounts.find((row) => row.id === accountId);
  if (!hit) return null;
  return decryptJson<OutreachAccountSecrets>(hit.credentialsEncrypted, defaultSecrets());
}

export async function createOutreachAccount(input: {
  name: string;
  provider?: OutreachAccount["provider"];
  accountType?: OutreachAccount["accountType"];
  status?: OutreachAccount["status"];
  config?: unknown;
  credentials?: unknown;
}): Promise<OutreachAccount> {
  const now = nowIso();
  const secrets = sanitizeSecrets(input.credentials);
  const stored = buildStoredAccount({
    name: input.name,
    provider: input.provider,
    accountType: input.accountType,
    status: input.status,
    config: input.config,
    credentialsEncrypted: encryptJson(secrets),
    createdAt: now,
    updatedAt: now,
  });

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    if (isVercel) {
      throw new OutreachDataError("Supabase is not configured for outreach storage.", {
        status: 500,
        hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables, then redeploy.",
        debug: {
          operation: "createOutreachAccount",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
        },
      });
    }

    const store = await readLocalStore();
    store.accounts.unshift(stored);
    await writeLocalStore(store);
    return hydrateOutreachAccountCustomerIoBilling(mapStoredAccount(stored));
  }

  if (supabase) {
    const baseInsert = {
      id: stored.id,
      name: stored.name,
      provider: stored.provider,
      status: stored.status,
      config: stored.config,
      credentials_encrypted: stored.credentialsEncrypted,
      last_test_at: null,
      last_test_status: stored.lastTestStatus,
    } satisfies Record<string, unknown>;

    const insertWithType = {
      ...baseInsert,
      account_type: stored.accountType,
    };

    let { data, error } = await supabase
      .from(TABLE_ACCOUNT)
      .insert(insertWithType)
      .select("*")
      .single();

    if (error && isMissingColumnError(error, "account_type")) {
      // Backward compatible insert when the account_type migration hasn't been applied yet.
      ({ data, error } = await supabase.from(TABLE_ACCOUNT).insert(baseInsert).select("*").single());
    }

    if (!error && data) {
      return hydrateOutreachAccountCustomerIoBilling(mapStoredAccount(mapAccountRowFromDb(data)));
    }

    if (error && isVercel) {
      throw new OutreachDataError("Failed to save outreach account to Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "createOutreachAccount",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          accountId: stored.id,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  store.accounts.unshift(stored);
  await writeLocalStore(store);
  return hydrateOutreachAccountCustomerIoBilling(mapStoredAccount(stored));
}

export async function updateOutreachAccount(
  accountId: string,
  patch: {
    name?: string;
    provider?: OutreachAccount["provider"];
    accountType?: OutreachAccount["accountType"];
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
    customerIoApiKey:
      patchSecrets.customerIoApiKey ||
      patchSecrets.customerIoTrackApiKey ||
      patchSecrets.customerIoAppApiKey ||
      existingSecrets.customerIoApiKey ||
      existingSecrets.customerIoTrackApiKey ||
      existingSecrets.customerIoAppApiKey,
    customerIoTrackApiKey: patchSecrets.customerIoTrackApiKey || existingSecrets.customerIoTrackApiKey,
    customerIoAppApiKey: patchSecrets.customerIoAppApiKey || existingSecrets.customerIoAppApiKey,
    apifyToken: patchSecrets.apifyToken || existingSecrets.apifyToken,
    youtubeClientId: patchSecrets.youtubeClientId || existingSecrets.youtubeClientId,
    youtubeClientSecret: patchSecrets.youtubeClientSecret || existingSecrets.youtubeClientSecret,
    youtubeRefreshToken: patchSecrets.youtubeRefreshToken || existingSecrets.youtubeRefreshToken,
    mailboxAccessToken: patchSecrets.mailboxAccessToken || existingSecrets.mailboxAccessToken,
    mailboxRefreshToken: patchSecrets.mailboxRefreshToken || existingSecrets.mailboxRefreshToken,
    mailboxPassword: patchSecrets.mailboxPassword || existingSecrets.mailboxPassword,
    mailboxAuthCode: patchSecrets.mailboxAuthCode || existingSecrets.mailboxAuthCode,
    mailboxSmtpPassword: patchSecrets.mailboxSmtpPassword || existingSecrets.mailboxSmtpPassword,
    mailboxAdminEmail: patchSecrets.mailboxAdminEmail || existingSecrets.mailboxAdminEmail,
    mailboxAdminPassword: patchSecrets.mailboxAdminPassword || existingSecrets.mailboxAdminPassword,
    mailboxAdminAuthCode: patchSecrets.mailboxAdminAuthCode || existingSecrets.mailboxAdminAuthCode,
    mailboxRecoveryEmail: patchSecrets.mailboxRecoveryEmail || existingSecrets.mailboxRecoveryEmail,
    mailboxRecoveryCodes: patchSecrets.mailboxRecoveryCodes || existingSecrets.mailboxRecoveryCodes,
  };

  const nextConfig = patch.config
    ? sanitizeAccountConfig(mergeOutreachAccountConfig(existingAccount.config, patch.config))
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
    if (patch.provider) update.provider = patch.provider;
    if (patch.accountType) update.account_type = patch.accountType;
    if (patch.status) update.status = patch.status;
    if (patch.lastTestAt !== undefined) update.last_test_at = patch.lastTestAt || null;
    if (patch.lastTestStatus) update.last_test_status = patch.lastTestStatus;

    let { data, error } = await supabase
      .from(TABLE_ACCOUNT)
      .update(update)
      .eq("id", accountId)
      .select("*")
      .maybeSingle();

    if (error && isMissingColumnError(error, "account_type")) {
      // Backward compatible update when the account_type migration hasn't been applied yet.
      const withoutType = { ...update };
      delete withoutType.account_type;
      ({ data, error } = await supabase
        .from(TABLE_ACCOUNT)
        .update(withoutType)
        .eq("id", accountId)
        .select("*")
        .maybeSingle());
    }

    if (!error && data) {
      return hydrateOutreachAccountCustomerIoBilling(mapStoredAccount(mapAccountRowFromDb(data)));
    }

    if (error && isVercel) {
      throw new OutreachDataError("Failed to update outreach account in Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "updateOutreachAccount",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          accountId,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }

    if (isVercel) {
      throw new OutreachDataError("Supabase updated the outreach account, but no saved row was returned.", {
        status: 500,
        hint: "Inspect runtime logs for updateOutreachAccount to confirm whether the write matched a row.",
        debug: {
          operation: "updateOutreachAccount",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          accountId,
          matchedRow: false,
        },
      });
    }
  }

  if (isVercel) return null;

  const store = await readLocalStore();
  const idx = store.accounts.findIndex((row) => row.id === accountId);
  if (idx < 0) return null;
  const current = store.accounts[idx];
  const nextStored: StoredAccount = {
    ...current,
    name: typeof patch.name === "string" ? patch.name.trim() : current.name,
    provider: patch.provider ?? current.provider,
    accountType: patch.accountType ?? current.accountType,
    status: patch.status ?? current.status,
    config: nextConfig,
    credentialsEncrypted: encryptJson(mergedSecrets),
    lastTestAt: patch.lastTestAt ?? current.lastTestAt,
    lastTestStatus: patch.lastTestStatus ?? current.lastTestStatus,
    updatedAt: now,
  };
  store.accounts[idx] = nextStored;
  await writeLocalStore(store);
  return hydrateOutreachAccountCustomerIoBilling(mapStoredAccount(nextStored));
}

export async function deleteOutreachAccount(accountId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data: assignmentRows, error: assignmentError } = await supabase.from(TABLE_ASSIGNMENT).select("*");
    if (assignmentError && isVercel) {
      throw new OutreachDataError("Failed to load outreach assignments from Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(assignmentError),
        debug: {
          operation: "deleteOutreachAccount:loadAssignments",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          accountId,
          supabaseError: supabaseErrorDebug(assignmentError),
        },
      });
    }

    for (const row of (assignmentRows ?? []).map((entry) => mapAssignmentRow(entry))) {
      const nextAccountIds = row.accountIds.filter((id) => id !== accountId);
      const nextMailboxAccountId = row.mailboxAccountId === accountId ? "" : row.mailboxAccountId;
      if (nextAccountIds.length === row.accountIds.length && nextMailboxAccountId === row.mailboxAccountId) {
        continue;
      }

      if (!nextAccountIds.length) {
        const deleteAssignment = await supabase.from(TABLE_ASSIGNMENT).delete().eq("brand_id", row.brandId);
        if (deleteAssignment.error && isVercel) {
          throw new OutreachDataError("Failed to clear brand assignment in Supabase.", {
            status: 500,
            hint: hintForSupabaseWriteError(deleteAssignment.error),
            debug: {
              operation: "deleteOutreachAccount:deleteAssignment",
              runtime: runtimeLabel(),
              supabaseConfigured: supabaseConfigured(),
              accountId,
              brandId: row.brandId,
              supabaseError: supabaseErrorDebug(deleteAssignment.error),
            },
          });
        }
        continue;
      }

      const updateAssignment = await setBrandOutreachAssignment(row.brandId, {
        accountId: row.accountId === accountId ? nextAccountIds[0] ?? "" : row.accountId,
        accountIds: nextAccountIds,
        mailboxAccountId: nextMailboxAccountId,
      });
      if (!updateAssignment && isVercel) {
        throw new OutreachDataError("Failed to update brand assignment in Supabase.", {
          status: 500,
          hint: "The sender pool could not be updated after removing the account.",
          debug: {
            operation: "deleteOutreachAccount:updateAssignment",
            runtime: runtimeLabel(),
            supabaseConfigured: supabaseConfigured(),
            accountId,
            brandId: row.brandId,
          },
        });
      }
    }

    const { error } = await supabase.from(TABLE_ACCOUNT).delete().eq("id", accountId);
    if (!error) {
      return true;
    }

    if (error && isVercel) {
      throw new OutreachDataError("Failed to delete outreach account in Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "deleteOutreachAccount",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          accountId,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  if (isVercel) return false;

  const store = await readLocalStore();
  const before = store.accounts.length;
  store.accounts = store.accounts.filter((row) => row.id !== accountId);
  store.customerIoProfileAdmissions = store.customerIoProfileAdmissions.filter((row) => row.accountId !== accountId);
  store.assignments = store.assignments
    .map((row) => {
      const nextAccountIds = row.accountIds.filter((id) => id !== accountId);
      if (!nextAccountIds.length) return null;
      return {
        ...row,
        accountId: row.accountId === accountId ? nextAccountIds[0] ?? "" : row.accountId,
        accountIds: nextAccountIds,
        mailboxAccountId: row.mailboxAccountId === accountId ? "" : row.mailboxAccountId,
        updatedAt: nowIso(),
      };
    })
    .filter((row): row is BrandOutreachAssignment => Boolean(row));
  await writeLocalStore(store);
  return store.accounts.length !== before;
}

export async function getBrandOutreachAssignment(
  brandId: string
): Promise<BrandOutreachAssignment | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    if (isVercel) {
      throw new OutreachDataError("Supabase is not configured for outreach storage.", {
        status: 500,
        hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables, then redeploy.",
        debug: {
          operation: "getBrandOutreachAssignment",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          brandId,
        },
      });
    }

    const store = await readLocalStore();
    const assignment = store.assignments.find((row) => row.brandId === brandId) ?? null;
    return assignment ? repairAssignmentDomainLimit(assignment) : null;
  }

  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ASSIGNMENT)
      .select("*")
      .eq("brand_id", brandId)
      .maybeSingle();
    if (!error && data) {
      return repairAssignmentDomainLimit(mapAssignmentRow(data));
    }
  }

  if (isVercel) return null;

  const store = await readLocalStore();
  const assignment = store.assignments.find((row) => row.brandId === brandId) ?? null;
  return assignment ? repairAssignmentDomainLimit(assignment) : null;
}

export async function setBrandOutreachAssignment(
  brandId: string,
  input: { accountId?: string; accountIds?: string[]; mailboxAccountId?: string } | string
): Promise<BrandOutreachAssignment | null> {
  const patch = typeof input === "string" ? { accountId: input } : input;
  const requestedAccountId = String(patch.accountId ?? "").trim();
  const requestedAccountIds = normalizeAssignmentAccountIds(patch.accountIds, requestedAccountId);
  const accountId = requestedAccountId || requestedAccountIds[0] || "";

  if (!accountId.trim()) {
    const supabaseDelete = getSupabaseAdmin();
    if (!supabaseDelete && isVercel) {
      throw new OutreachDataError("Supabase is not configured for outreach storage.", {
        status: 500,
        hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables, then redeploy.",
        debug: {
          operation: "setBrandOutreachAssignment:delete",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          brandId,
        },
      });
    }
    if (supabaseDelete) {
      await supabaseDelete.from(TABLE_ASSIGNMENT).delete().eq("brand_id", brandId);
      return null;
    }

    const storeDelete = await readLocalStore();
    storeDelete.assignments = storeDelete.assignments.filter((row) => row.brandId !== brandId);
    await writeLocalStore(storeDelete);
    return null;
  }

  const existing = await getBrandOutreachAssignment(brandId);
  const mailboxAccountId =
    typeof patch.mailboxAccountId === "string"
      ? patch.mailboxAccountId.trim()
      : existing?.mailboxAccountId ?? "";
  const accountIds = normalizeAssignmentAccountIds(
    patch.accountIds ?? existing?.accountIds ?? [],
    accountId
  );
  await enforceAssignmentDomainLimit(accountIds);

  const now = nowIso();
  const assignment: BrandOutreachAssignment = {
    brandId,
    accountId,
    accountIds,
    mailboxAccountId,
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (!supabase && isVercel) {
    throw new OutreachDataError("Supabase is not configured for outreach storage.", {
      status: 500,
      hint: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables, then redeploy.",
      debug: {
        operation: "setBrandOutreachAssignment",
        runtime: runtimeLabel(),
        supabaseConfigured: supabaseConfigured(),
        brandId,
      },
    });
  }
  if (supabase) {
    const baseUpsert = {
      brand_id: brandId,
      account_id: accountId,
    } satisfies Record<string, unknown>;

    const upsertWithMailbox = {
      ...baseUpsert,
      mailbox_account_id: mailboxAccountId || null,
    };

    const upsertWithAccounts = {
      ...upsertWithMailbox,
      account_ids: accountIds,
    };

    let { data, error } = await supabase
      .from(TABLE_ASSIGNMENT)
      .upsert(upsertWithAccounts, { onConflict: "brand_id" })
      .select("*")
      .single();

    if (error && isMissingColumnError(error, "account_ids")) {
      if (accountIds.length > 1) {
        throw new OutreachDataError("Multi-sender brand assignment requires a database migration.", {
          status: 500,
          hint: hintForSupabaseWriteError(error),
          debug: {
            operation: "setBrandOutreachAssignment",
            runtime: runtimeLabel(),
            supabaseConfigured: supabaseConfigured(),
            brandId,
            accountId,
            accountIds,
            mailboxAccountId,
            supabaseError: supabaseErrorDebug(error),
          },
        });
      }

      ({ data, error } = await supabase
        .from(TABLE_ASSIGNMENT)
        .upsert(upsertWithMailbox, { onConflict: "brand_id" })
        .select("*")
        .single());
    }

    if (error && isMissingColumnError(error, "mailbox_account_id")) {
      if (mailboxAccountId) {
        throw new OutreachDataError("Reply mailbox assignment requires a database migration.", {
          status: 500,
          hint: hintForSupabaseWriteError(error),
          debug: {
            operation: "setBrandOutreachAssignment",
            runtime: runtimeLabel(),
            supabaseConfigured: supabaseConfigured(),
            brandId,
            accountId,
            accountIds,
            mailboxAccountId,
            supabaseError: supabaseErrorDebug(error),
          },
        });
      }

      ({ data, error } = await supabase
        .from(TABLE_ASSIGNMENT)
        .upsert(baseUpsert, { onConflict: "brand_id" })
        .select("*")
        .single());
    }

    if (!error && data) {
      return mapAssignmentRow({
        ...asRecord(data),
        account_ids: accountIds,
      });
    }

    if (error && isVercel) {
      throw new OutreachDataError("Failed to save brand outreach assignment in Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "setBrandOutreachAssignment",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          brandId,
          accountId,
          accountIds,
          mailboxAccountId,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  if (isVercel) return null;

  const store = await readLocalStore();
  const existingIndex = store.assignments.findIndex((row) => row.brandId === brandId);
  if (existingIndex >= 0) {
    store.assignments[existingIndex] = {
      ...store.assignments[existingIndex],
      accountId,
      accountIds,
      mailboxAccountId,
      updatedAt: now,
    };
  } else {
    store.assignments.push(assignment);
  }
  await writeLocalStore(store);
  return store.assignments.find((row) => row.brandId === brandId) ?? assignment;
}

async function resolveOutreachRunLockedSenderAccountId(input: {
  brandId: string;
  ownerType: OutreachRun["ownerType"];
  ownerId: string;
  explicitLockedSenderAccountId?: string;
}) {
  const explicitLockedSenderAccountId = String(input.explicitLockedSenderAccountId ?? "").trim();
  if (explicitLockedSenderAccountId) {
    return explicitLockedSenderAccountId;
  }
  if (input.ownerType !== "campaign") {
    return "";
  }
  const ownerId = String(input.ownerId ?? "").trim();
  if (!ownerId) {
    return "";
  }
  const { getScaleCampaignRecordById } = await import("@/lib/experiment-data");
  const ownerCampaign = await getScaleCampaignRecordById(input.brandId, ownerId);
  if (!ownerCampaign) {
    return "";
  }
  return String(ownerCampaign.scalePolicy.accountId ?? ownerCampaign.scalePolicy.mailboxAccountId ?? "").trim();
}

export async function createOutreachRun(input: {
  brandId: string;
  campaignId: string;
  experimentId: string;
  hypothesisId: string;
  ownerType: OutreachRun["ownerType"];
  ownerId: string;
  accountId: string;
  lockedSenderAccountId?: string;
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
  const ownerType = input.ownerType;
  const ownerId = String(input.ownerId ?? "").trim();
  const campaignId = String(input.campaignId ?? "").trim();
  const experimentId = String(input.experimentId ?? "").trim();

  if (!ownerType) {
    throw new Error("Outreach run requires explicit ownerType.");
  }

  if (ownerType === "campaign") {
    if (!ownerId) {
      throw new Error("Campaign-owned run requires explicit ownerId.");
    }
    const { getScaleCampaignRecordById } = await import("@/lib/experiment-data");
    const ownerCampaign = await getScaleCampaignRecordById(input.brandId, ownerId);
    if (!ownerCampaign) {
      throw new Error("Campaign ownerId does not resolve to a scale campaign.");
    }
  } else if (ownerType === "experiment") {
    if (!ownerId) {
      throw new Error("Experiment-owned run requires explicit ownerId.");
    }
    const { getExperimentRecordById } = await import("@/lib/experiment-data");
    const ownerExperiment = await getExperimentRecordById(input.brandId, ownerId);
    if (!ownerExperiment) {
      throw new Error("Experiment ownerId does not resolve to an experiment.");
    }
    const runtimeCampaignId = String(ownerExperiment.runtime.campaignId ?? "").trim();
    const runtimeExperimentId = String(ownerExperiment.runtime.experimentId ?? "").trim();
    if (!runtimeCampaignId || !runtimeExperimentId) {
      throw new Error("Experiment ownerId does not resolve to an experiment runtime.");
    }
    if (campaignId !== runtimeCampaignId) {
      throw new Error("Experiment-owned run campaignId does not match experiment runtime campaignId.");
    }
    if (experimentId !== runtimeExperimentId) {
      throw new Error("Experiment-owned run experimentId does not match experiment runtime experimentId.");
    }
  }

  const now = nowIso();
  const sanitizedLastError = normalizeLegacyOutreachErrorText(input.lastError ?? "");
  const lockedSenderAccountId = await resolveOutreachRunLockedSenderAccountId({
    brandId: input.brandId,
    ownerType,
    ownerId,
    explicitLockedSenderAccountId: input.lockedSenderAccountId,
  });
  const accountId = lockedSenderAccountId || String(input.accountId ?? "").trim();
  const run: OutreachRun = {
    id: createId("run"),
    brandId: input.brandId,
    campaignId,
    experimentId,
    hypothesisId: input.hypothesisId,
    ownerType,
    ownerId,
    accountId,
    lockedSenderAccountId,
    status: input.status ?? "queued",
    cadence: input.cadence ?? "3_step_7_day",
    dailyCap: Number(input.dailyCap ?? 30),
    hourlyCap: Number(input.hourlyCap ?? 6),
    timezone: input.timezone ?? "America/Los_Angeles",
    minSpacingMinutes: Number(input.minSpacingMinutes ?? 8),
    pauseReason: input.pauseReason ?? "",
    lastError: sanitizedLastError,
    externalRef: input.externalRef ?? "",
    metrics: defaultRunMetrics(),
    sourcingTraceSummary: sanitizeRunTraceSummary({
      phase: "plan_sourcing",
      selectedActorIds: [],
      lastActorInputError: "",
      failureStep: "",
      budgetUsedUsd: 0,
    }),
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
        owner_type: run.ownerType,
        owner_id: run.ownerId,
        account_id: run.accountId,
        locked_sender_account_id: run.lockedSenderAccountId || null,
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
        sourcing_trace_summary: run.sourcingTraceSummary,
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
      | "accountId"
      | "lockedSenderAccountId"
      | "status"
      | "dailyCap"
      | "hourlyCap"
      | "timezone"
      | "minSpacingMinutes"
      | "pauseReason"
      | "lastError"
      | "externalRef"
      | "metrics"
      | "sourcingTraceSummary"
      | "completedAt"
    >
  >
): Promise<OutreachRun | null> {
  const now = nowIso();
  const sanitizedLastError =
    patch.lastError === undefined ? undefined : normalizeLegacyOutreachErrorText(patch.lastError);
  const sanitizedTraceSummary =
    patch.sourcingTraceSummary === undefined
      ? undefined
      : sanitizeRunTraceSummary(patch.sourcingTraceSummary);
  const requestedLockedSenderAccountId =
    patch.lockedSenderAccountId === undefined ? undefined : String(patch.lockedSenderAccountId ?? "").trim();
  let normalizedLockedSenderAccountId = requestedLockedSenderAccountId;
  if (requestedLockedSenderAccountId !== undefined) {
    const existingRun = await getOutreachRun(runId);
    const currentLockedSenderAccountId = String(existingRun?.lockedSenderAccountId ?? "").trim();
    if (
      currentLockedSenderAccountId &&
      requestedLockedSenderAccountId &&
      currentLockedSenderAccountId !== requestedLockedSenderAccountId
    ) {
      throw new Error(`Outreach run ${runId} sender lock is immutable.`);
    }
    normalizedLockedSenderAccountId =
      currentLockedSenderAccountId || requestedLockedSenderAccountId || currentLockedSenderAccountId;
  }

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.accountId !== undefined) update.account_id = patch.accountId;
    if (normalizedLockedSenderAccountId !== undefined) {
      update.locked_sender_account_id = normalizedLockedSenderAccountId || null;
    }
    if (patch.status) update.status = patch.status;
    if (patch.dailyCap !== undefined) update.daily_cap = patch.dailyCap;
    if (patch.hourlyCap !== undefined) update.hourly_cap = patch.hourlyCap;
    if (patch.timezone !== undefined) update.timezone = patch.timezone;
    if (patch.minSpacingMinutes !== undefined) update.min_spacing_minutes = patch.minSpacingMinutes;
    if (patch.pauseReason !== undefined) update.pause_reason = patch.pauseReason;
    if (sanitizedLastError !== undefined) update.last_error = sanitizedLastError;
    if (patch.externalRef !== undefined) update.external_ref = patch.externalRef;
    if (patch.metrics) update.metrics = patch.metrics;
    if (sanitizedTraceSummary !== undefined) update.sourcing_trace_summary = sanitizedTraceSummary;
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
    ...(normalizedLockedSenderAccountId === undefined
      ? {}
      : { lockedSenderAccountId: normalizedLockedSenderAccountId }),
    ...(sanitizedLastError === undefined ? {} : { lastError: sanitizedLastError }),
    ...(sanitizedTraceSummary === undefined ? {} : { sourcingTraceSummary: sanitizedTraceSummary }),
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

export async function listBrandRuns(brandId: string): Promise<OutreachRun[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_RUN)
      .select("*")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapRunRow(row));
    }
  }

  const store = await readLocalStore();
  return store.runs.filter((row) => row.brandId === brandId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listExperimentRuns(
  brandId: string,
  campaignId: string,
  experimentId: string
): Promise<OutreachRun[]> {
  const all = await listCampaignRuns(brandId, campaignId);
  return all.filter((row) => row.experimentId === experimentId);
}

export async function listOwnerRuns(
  brandId: string,
  ownerType: OutreachRun["ownerType"],
  ownerId: string
): Promise<OutreachRun[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_RUN)
      .select("*")
      .eq("brand_id", brandId)
      .eq("owner_type", ownerType)
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapRunRow(row));
    }
  }

  const store = await readLocalStore();
  return store.runs
    .filter(
      (row) =>
        row.brandId === brandId &&
        row.ownerType === ownerType &&
        row.ownerId === ownerId
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function chunkStrings(values: string[], size = 100) {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function deleteOutreachRunsByIds(runIds: string[]): Promise<number> {
  const uniqueRunIds = Array.from(new Set(runIds.map((value) => String(value ?? "").trim()).filter(Boolean)));
  if (!uniqueRunIds.length) return 0;

  const supabase = getSupabaseAdmin();
  if (supabase) {
    for (const runIdChunk of chunkStrings(uniqueRunIds)) {
      const { data: threadRows } = await supabase
        .from(TABLE_THREAD)
        .select("id")
        .in("run_id", runIdChunk);
      const threadIds = Array.from(
        new Set(
          (threadRows ?? [])
            .map((row: unknown) => String(asRecord(row).id ?? "").trim())
            .filter(Boolean)
        )
      );

      if (threadIds.length) {
        for (const threadIdChunk of chunkStrings(threadIds)) {
          await supabase.from(TABLE_REPLY_THREAD_FEEDBACK).delete().in("thread_id", threadIdChunk);
        }
      }

      await Promise.all([
        supabase.from(TABLE_THREAD_STATE).delete().in("run_id", runIdChunk),
        supabase.from(TABLE_REPLY_MESSAGE).delete().in("run_id", runIdChunk),
        supabase.from(TABLE_REPLY_DRAFT).delete().in("run_id", runIdChunk),
        supabase.from(TABLE_THREAD).delete().in("run_id", runIdChunk),
        supabase.from(TABLE_MESSAGE).delete().in("run_id", runIdChunk),
        supabase.from(TABLE_RUN_LEAD).delete().in("run_id", runIdChunk),
        supabase.from(TABLE_EVENT).delete().in("run_id", runIdChunk),
        supabase.from(TABLE_JOB).delete().in("run_id", runIdChunk),
        supabase.from(TABLE_ANOMALY).delete().in("run_id", runIdChunk),
        supabase.from(TABLE_CUSTOMER_IO_PROFILE_ADMISSION).delete().in("source_run_id", runIdChunk),
        supabase.from(TABLE_SOURCING_CHAIN_DECISION).delete().in("run_id", runIdChunk),
        supabase.from(TABLE_SOURCING_PROBE_RESULT).delete().in("run_id", runIdChunk),
        supabase.from(TABLE_DELIVERABILITY_SEED_RESERVATION).delete().in("run_id", runIdChunk),
        supabase.from(TABLE_WARMUP_SEED_RESERVATION).delete().in("run_id", runIdChunk),
        supabase.from(TABLE_DELIVERABILITY_PROBE_RUN).delete().in("run_id", runIdChunk),
      ]);

      await supabase.from(TABLE_RUN).delete().in("id", runIdChunk);
    }
  }

  if (!isVercel) {
    const store = await readLocalStore();
    const runIdSet = new Set(uniqueRunIds);
    const threadIdSet = new Set(
      store.replyThreads
        .filter((row) => runIdSet.has(row.runId))
        .map((row) => row.id)
    );

    store.customerIoProfileAdmissions = store.customerIoProfileAdmissions.filter(
      (row) => !runIdSet.has(row.sourceRunId)
    );
    store.runs = store.runs.filter((row) => !runIdSet.has(row.id));
    store.runLeads = store.runLeads.filter((row) => !runIdSet.has(row.runId));
    store.messages = store.messages.filter((row) => !runIdSet.has(row.runId));
    store.replyThreads = store.replyThreads.filter((row) => !runIdSet.has(row.runId));
    store.replyThreadStates = store.replyThreadStates.filter(
      (row) => !runIdSet.has(row.runId) && !threadIdSet.has(row.threadId)
    );
    store.replyMessages = store.replyMessages.filter(
      (row) => !runIdSet.has(row.runId) && !threadIdSet.has(row.threadId)
    );
    store.replyDrafts = store.replyDrafts.filter(
      (row) => !runIdSet.has(row.runId) && !threadIdSet.has(row.threadId)
    );
    store.replyThreadFeedback = store.replyThreadFeedback.filter(
      (row) => !threadIdSet.has(row.threadId)
    );
    store.anomalies = store.anomalies.filter((row) => !runIdSet.has(row.runId));
    store.events = store.events.filter((row) => !runIdSet.has(row.runId));
    store.jobs = store.jobs.filter((row) => !runIdSet.has(row.runId));
    store.deliverabilityProbeRuns = store.deliverabilityProbeRuns.filter(
      (row) => !runIdSet.has(row.runId)
    );
    store.deliverabilitySeedReservations = store.deliverabilitySeedReservations.filter(
      (row) => !runIdSet.has(row.runId)
    );
    store.warmupSeedReservations = store.warmupSeedReservations.filter(
      (row) => !runIdSet.has(row.runId)
    );
    store.sourcingChainDecisions = store.sourcingChainDecisions.filter(
      (row) => !runIdSet.has(row.runId)
    );
    store.sourcingProbeResults = store.sourcingProbeResults.filter(
      (row) => !runIdSet.has(row.runId)
    );
    await writeLocalStore(store);
  }

  return uniqueRunIds.length;
}

export async function upsertRunLeads(
  runId: string,
  brandId: string,
  campaignId: string,
  leads: Array<
    Pick<
      OutreachRunLead,
      "email" | "name" | "company" | "title" | "domain" | "sourceUrl" | "realVerifiedEmail" | "emailVerification"
    >
  >
): Promise<OutreachRunLead[]> {
  const dedup = new Map<
    string,
    Pick<
      OutreachRunLead,
      "email" | "name" | "company" | "title" | "domain" | "sourceUrl" | "realVerifiedEmail" | "emailVerification"
    >
  >();
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
      realVerifiedEmail: lead.realVerifiedEmail === true,
      emailVerification: lead.emailVerification ?? null,
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
    real_verified_email: lead.realVerifiedEmail === true,
    email_verification: lead.emailVerification ?? {},
    status: "new",
    updated_at: now,
  }));

  const supabase = getSupabaseAdmin();
  if (supabase) {
    if (rows.length > 0) {
      const { error } = await supabase.from(TABLE_RUN_LEAD).upsert(rows, { onConflict: "run_id,email" });
      if (error) {
        // Existing schema may only have a unique index on (run_id, lower(email)), which PostgREST can't target.
        // Fall back to a safe two-step insert to avoid dropping leads on the floor.
        const existing = await supabase
          .from(TABLE_RUN_LEAD)
          .select("email")
          .eq("run_id", runId);
        const existingEmails = new Set(
          (existing.data ?? [])
            .map((row: unknown) => {
              const r = asRecord(row);
              return String(r.email ?? "").trim().toLowerCase();
            })
            .filter(Boolean)
        );
        const missing = rows.filter((row) => !existingEmails.has(String(row.email ?? "").trim().toLowerCase()));
        if (missing.length > 0) {
          await supabase.from(TABLE_RUN_LEAD).insert(missing);
        }
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
      existing.realVerifiedEmail = lead.realVerifiedEmail === true || existing.realVerifiedEmail === true;
      existing.emailVerification = lead.emailVerification ?? existing.emailVerification ?? null;
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
        realVerifiedEmail: lead.realVerifiedEmail === true,
        emailVerification: lead.emailVerification ?? null,
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

export async function loadHistoricalCompanyDomains(
  companies: string[]
): Promise<Array<{ company: string; domain: string; sampleCount: number; updatedAt: string }>> {
  const requested = Array.from(
    new Set(
      companies
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
  if (!requested.length) return [];

  const pairMap = new Map<string, { company: string; domain: string; sampleCount: number; updatedAt: string }>();
  const absorbRow = (company: unknown, domain: unknown, updatedAt: unknown) => {
    const nextCompany = String(company ?? "").trim();
    const nextDomain = String(domain ?? "").trim().toLowerCase();
    const nextUpdatedAt = String(updatedAt ?? "");
    if (!nextCompany || !nextDomain) return;
    const key = `${nextCompany.toLowerCase()}|${nextDomain}`;
    const current = pairMap.get(key);
    if (current) {
      current.sampleCount += 1;
      if (nextUpdatedAt > current.updatedAt) current.updatedAt = nextUpdatedAt;
      return;
    }
    pairMap.set(key, {
      company: nextCompany,
      domain: nextDomain,
      sampleCount: 1,
      updatedAt: nextUpdatedAt,
    });
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    for (let index = 0; index < requested.length; index += 100) {
      const batch = requested.slice(index, index + 100);
      const { data, error } = await supabase
        .from(TABLE_RUN_LEAD)
        .select("company,domain,updated_at")
        .in("company", batch)
        .neq("domain", "");
      if (error) {
        return [];
      }
      for (const row of data ?? []) {
        const record = asRecord(row);
        absorbRow(record.company, record.domain, record.updated_at);
      }
    }
  } else {
    const store = await readLocalStore();
    const requestedSet = new Set(requested.map((value) => value.toLowerCase()));
    for (const row of store.runLeads) {
      if (!row.company || !row.domain) continue;
      if (!requestedSet.has(row.company.toLowerCase())) continue;
      absorbRow(row.company, row.domain, row.updatedAt);
    }
  }

  const bestByCompany = new Map<string, { company: string; domain: string; sampleCount: number; updatedAt: string }>();
  for (const row of pairMap.values()) {
    const key = row.company.toLowerCase();
    const current = bestByCompany.get(key);
    if (
      !current ||
      row.sampleCount > current.sampleCount ||
      (row.sampleCount === current.sampleCount && row.updatedAt > current.updatedAt)
    ) {
      bestByCompany.set(key, row);
    }
  }

  return requested
    .map((company) => bestByCompany.get(company.toLowerCase()) ?? null)
    .filter(Boolean) as Array<{ company: string; domain: string; sampleCount: number; updatedAt: string }>;
}

export async function updateRunLead(
  leadId: string,
  patch: Partial<
    Pick<
      OutreachRunLead,
      | "email"
      | "status"
      | "name"
      | "company"
      | "title"
      | "domain"
      | "sourceUrl"
      | "realVerifiedEmail"
      | "emailVerification"
    >
  >
): Promise<OutreachRunLead | null> {
  const now = nowIso();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (typeof patch.email === "string") update.email = patch.email;
    if (patch.status) update.status = patch.status;
    if (typeof patch.name === "string") update.name = patch.name;
    if (typeof patch.company === "string") update.company = patch.company;
    if (typeof patch.title === "string") update.title = patch.title;
    if (typeof patch.domain === "string") update.domain = patch.domain;
    if (typeof patch.sourceUrl === "string") update.source_url = patch.sourceUrl;
    if (typeof patch.realVerifiedEmail === "boolean") update.real_verified_email = patch.realVerifiedEmail;
    if (patch.emailVerification && typeof patch.emailVerification === "object") {
      update.email_verification = patch.emailVerification;
    }
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
    > &
      Partial<
        Pick<
          OutreachMessage,
          "sourceType" | "sessionId" | "nodeId" | "parentMessageId" | "lastError" | "generationMeta"
        >
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
    source_type: item.sourceType || "cadence",
    session_id: item.sessionId || null,
    node_id: item.nodeId || "",
    parent_message_id: item.parentMessageId || "",
    status: item.status,
    provider_message_id: "",
    scheduled_at: item.scheduledAt,
    sent_at: null,
    last_error: item.lastError ?? "",
    generation_meta: item.generationMeta ?? {},
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
      sourceType: row.source_type,
      sessionId: row.session_id ?? "",
      nodeId: row.node_id,
      parentMessageId: row.parent_message_id,
      providerMessageId: row.provider_message_id,
      scheduledAt: row.scheduled_at,
      sentAt: row.sent_at,
      lastError: row.last_error,
      generationMeta: row.generation_meta,
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

export async function listRunIdsForMessageStatuses(
  statuses: OutreachMessage["status"][]
): Promise<string[]> {
  const normalizedStatuses = Array.from(
    new Set(statuses.map((status) => String(status ?? "").trim()).filter(Boolean))
  ) as OutreachMessage["status"][];
  if (!normalizedStatuses.length) return [];

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_MESSAGE)
      .select("run_id")
      .in("status", normalizedStatuses);
    if (!error) {
      return Array.from(
        new Set((data ?? []).map((row: { run_id?: string | null }) => String(row.run_id ?? "").trim()).filter(Boolean))
      );
    }
  }

  const store = await readLocalStore();
  return Array.from(
    new Set(
      store.messages
        .filter((row) => normalizedStatuses.includes(row.status))
        .map((row) => row.runId)
        .filter(Boolean)
    )
  );
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
  patch: Partial<
    Pick<OutreachMessage, "status" | "providerMessageId" | "sentAt" | "lastError" | "generationMeta">
  >
): Promise<OutreachMessage | null> {
  const now = nowIso();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status) update.status = patch.status;
    if (patch.providerMessageId !== undefined) update.provider_message_id = patch.providerMessageId;
    if (patch.sentAt !== undefined) update.sent_at = patch.sentAt || null;
    if (patch.lastError !== undefined) update.last_error = patch.lastError;
    if (patch.generationMeta !== undefined) update.generation_meta = patch.generationMeta;

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

export async function updateRunMessages(
  messageIds: string[],
  patch: Partial<
    Pick<OutreachMessage, "status" | "providerMessageId" | "sentAt" | "lastError" | "generationMeta">
  >
): Promise<OutreachMessage[]> {
  const ids = Array.from(new Set(messageIds.map((item) => String(item ?? "").trim()).filter(Boolean)));
  if (!ids.length) return [];

  const now = nowIso();
  const sanitizedLastError =
    patch.lastError === undefined ? undefined : normalizeLegacyOutreachErrorText(patch.lastError);
  const generationMetaRaw = patch.generationMeta;
  const sanitizedGenerationMeta =
    generationMetaRaw && typeof generationMetaRaw === "object" && !Array.isArray(generationMetaRaw)
      ? (generationMetaRaw as Record<string, unknown>)
      : generationMetaRaw === undefined
        ? undefined
        : {};

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.providerMessageId !== undefined) update.provider_message_id = patch.providerMessageId;
    if (patch.sentAt !== undefined) update.sent_at = patch.sentAt || null;
    if (sanitizedLastError !== undefined) update.last_error = sanitizedLastError;
    if (sanitizedGenerationMeta !== undefined) update.generation_meta = sanitizedGenerationMeta;

    const { data, error } = await supabase
      .from(TABLE_MESSAGE)
      .update(update)
      .in("id", ids)
      .select("*");
    if (!error) {
      return (data ?? []).map((row: unknown) => mapMessageRow(row));
    }
  }

  const store = await readLocalStore();
  const updated: OutreachMessage[] = [];
  for (let index = 0; index < store.messages.length; index += 1) {
    const row = store.messages[index];
    if (!ids.includes(row.id)) continue;
    const next: OutreachMessage = {
      ...row,
      ...patch,
      ...(sanitizedLastError === undefined ? {} : { lastError: sanitizedLastError }),
      ...(sanitizedGenerationMeta === undefined ? {} : { generationMeta: sanitizedGenerationMeta }),
      updatedAt: now,
    };
    store.messages[index] = next;
    updated.push(next);
  }
  if (updated.length) {
    await writeLocalStore(store);
  }
  return updated;
}

export async function createReplyThread(input: {
  brandId: string;
  campaignId?: string;
  runId?: string;
  leadId?: string;
  sourceType?: ReplyThread["sourceType"];
  mailboxAccountId?: string;
  contactEmail?: string;
  contactName?: string;
  contactCompany?: string;
  subject: string;
  sentiment: ReplyThread["sentiment"];
  intent: ReplyThread["intent"];
  status?: ReplyThread["status"];
}): Promise<ReplyThread> {
  const now = nowIso();
  const thread: ReplyThread = {
    id: createId("thread"),
    brandId: input.brandId,
    campaignId: input.campaignId?.trim() ?? "",
    runId: input.runId?.trim() ?? "",
    leadId: input.leadId?.trim() ?? "",
    sourceType:
      input.sourceType === "mailbox"
        ? "mailbox"
        : input.sourceType === "eval"
          ? "eval"
          : "outreach",
    mailboxAccountId: input.mailboxAccountId?.trim() ?? "",
    contactEmail: input.contactEmail?.trim() ?? "",
    contactName: input.contactName?.trim() ?? "",
    contactCompany: input.contactCompany?.trim() ?? "",
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
        campaign_id: thread.campaignId || null,
        run_id: thread.runId || null,
        lead_id: thread.leadId || null,
        source_type: thread.sourceType,
        mailbox_account_id: thread.mailboxAccountId || null,
        contact_email: thread.contactEmail,
        contact_name: thread.contactName,
        contact_company: thread.contactCompany,
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
  patch: Partial<
    Pick<
      ReplyThread,
      | "status"
      | "sentiment"
      | "intent"
      | "lastMessageAt"
      | "mailboxAccountId"
      | "contactEmail"
      | "contactName"
      | "contactCompany"
      | "sourceType"
    >
  >
): Promise<ReplyThread | null> {
  const now = nowIso();

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status) update.status = patch.status;
    if (patch.sentiment) update.sentiment = patch.sentiment;
    if (patch.intent) update.intent = patch.intent;
    if (patch.lastMessageAt) update.last_message_at = patch.lastMessageAt;
    if (patch.mailboxAccountId !== undefined) update.mailbox_account_id = patch.mailboxAccountId || null;
    if (patch.contactEmail !== undefined) update.contact_email = patch.contactEmail;
    if (patch.contactName !== undefined) update.contact_name = patch.contactName;
    if (patch.contactCompany !== undefined) update.contact_company = patch.contactCompany;
    if (patch.sourceType) update.source_type = patch.sourceType;

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
  runId?: string;
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
    runId: input.runId?.trim() ?? "",
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
        run_id: message.runId || null,
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

function summarizeReplyThreadState(record: ReplyThreadStateRecord): ReplyThreadStateSummary {
  return {
    currentStage: record.canonicalState.thread.currentStage,
    recommendedMove: record.latestDecision.recommendedMove,
    confidence: record.latestDecision.confidence,
    autopilotOk: record.latestDecision.autopilotOk,
    manualReviewReason: record.latestDecision.manualReviewReason,
    latestUserAsk: record.canonicalState.thread.latestUserAsk,
    progressScore: record.canonicalState.thread.progressScore,
  };
}

function attachReplyThreadStateSummaries(
  threads: ReplyThread[],
  states: ReplyThreadStateRecord[]
): ReplyThread[] {
  const stateByThreadId = new Map(states.map((item) => [item.threadId, item] as const));
  return threads.map((thread) => {
    const state = stateByThreadId.get(thread.id);
    return state
      ? {
          ...thread,
          stateSummary: summarizeReplyThreadState(state),
        }
      : thread;
  });
}

export async function listReplyThreadStatesByBrand(brandId: string): Promise<ReplyThreadStateRecord[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_THREAD_STATE)
      .select("*")
      .eq("brand_id", brandId)
      .order("updated_at", { ascending: false });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapThreadStateRow(row));
    }
  }

  const store = await readLocalStore();
  return store.replyThreadStates
    .filter((row) => row.brandId === brandId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getReplyThreadState(threadId: string): Promise<ReplyThreadStateRecord | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_THREAD_STATE)
      .select("*")
      .eq("thread_id", threadId)
      .maybeSingle();
    if (!error && data) {
      return mapThreadStateRow(data);
    }
  }

  const store = await readLocalStore();
  return store.replyThreadStates.find((row) => row.threadId === threadId) ?? null;
}

export async function upsertReplyThreadState(input: {
  threadId: string;
  brandId: string;
  runId?: string;
  canonicalState: ReplyThreadCanonicalState;
  latestDecision?: ReplyThreadStateDecision;
  latestDraftMeta?: ReplyThreadDraftMeta;
  sourcesUsed?: string[];
}): Promise<ReplyThreadStateRecord> {
  const existing = await getReplyThreadState(input.threadId);
  const now = nowIso();
  const stateRevision = Math.max(1, (existing?.stateRevision ?? 0) + 1);
  const latestDecision = input.latestDecision ?? input.canonicalState.decision ?? defaultReplyThreadDecision();
  const latestDraftMeta = input.latestDraftMeta ?? existing?.latestDraftMeta ?? defaultReplyThreadDraftMeta();
  const sourcesUsed = (input.sourcesUsed ?? input.canonicalState.audit.sourcesUsed ?? [])
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
  const canonicalState: ReplyThreadCanonicalState = {
    ...input.canonicalState,
    decision: latestDecision,
    audit: {
      ...input.canonicalState.audit,
      stateRevision,
      sourcesUsed,
      generatedAt: input.canonicalState.audit.generatedAt || now,
    },
  };

  const record: ReplyThreadStateRecord = {
    threadId: input.threadId,
    brandId: input.brandId,
    runId: input.runId?.trim() ?? "",
    stateRevision,
    canonicalState,
    latestDecision,
    latestDraftMeta,
    sourcesUsed,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_THREAD_STATE)
      .upsert(
        {
          thread_id: record.threadId,
          brand_id: record.brandId,
          run_id: record.runId || null,
          state_revision: record.stateRevision,
          canonical_state: record.canonicalState,
          latest_decision: record.latestDecision,
          latest_draft_meta: record.latestDraftMeta,
          sources_used: record.sourcesUsed,
          created_at: record.createdAt,
          updated_at: record.updatedAt,
        },
        { onConflict: "thread_id" }
      )
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapThreadStateRow(data);
    }
  }

  const store = await readLocalStore();
  const idx = store.replyThreadStates.findIndex((row) => row.threadId === record.threadId);
  if (idx >= 0) {
    store.replyThreadStates[idx] = record;
  } else {
    store.replyThreadStates.unshift(record);
  }
  await writeLocalStore(store);
  return record;
}

export async function listReplyThreadsByBrand(
  brandId: string,
  options: { includeEval?: boolean } = {}
): Promise<{ threads: ReplyThread[]; drafts: ReplyDraft[] }> {
  const includeEval = options.includeEval === true;
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const [threadsResult, draftsResult, statesResult] = await Promise.all([
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
      supabase
        .from(TABLE_THREAD_STATE)
        .select("*")
        .eq("brand_id", brandId)
        .order("updated_at", { ascending: false }),
    ]);
    if (!threadsResult.error && !draftsResult.error && !statesResult.error) {
      const threads = attachReplyThreadStateSummaries(
        (threadsResult.data ?? []).map((row: unknown) => mapThreadRow(row)),
        (statesResult.data ?? []).map((row: unknown) => mapThreadStateRow(row))
      );
      const visibleThreads = includeEval ? threads : threads.filter((thread) => thread.sourceType !== "eval");
      const visibleThreadIds = new Set(visibleThreads.map((thread) => thread.id));
      return {
        threads: visibleThreads,
        drafts: (draftsResult.data ?? [])
          .map((row: unknown) => mapDraftRow(row))
          .filter((draft) => visibleThreadIds.has(draft.threadId)),
      };
    }
  }

  const store = await readLocalStore();
  const threads = attachReplyThreadStateSummaries(
    store.replyThreads
      .filter((row) => row.brandId === brandId && (includeEval || row.sourceType !== "eval"))
      .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1)),
    store.replyThreadStates.filter((row) => row.brandId === brandId)
  );
  const threadIds = new Set(threads.map((thread) => thread.id));
  return {
    threads,
    drafts: store.replyDrafts
      .filter((row) => row.brandId === brandId && threadIds.has(row.threadId))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  };
}

export async function listReplyMessagesByRun(runId: string): Promise<ReplyMessage[]> {
  if (!runId.trim()) {
    return [];
  }
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_REPLY_MESSAGE)
      .select("*")
      .eq("run_id", runId)
      .order("received_at", { ascending: false });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapReplyMessageRow(row));
    }
  }

  const store = await readLocalStore();
  return store.replyMessages
    .filter((row) => row.runId === runId)
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
}

export async function listReplyMessagesByThread(threadId: string): Promise<ReplyMessage[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_REPLY_MESSAGE)
      .select("*")
      .eq("thread_id", threadId)
      .order("received_at", { ascending: false });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapReplyMessageRow(row));
    }
  }

  const store = await readLocalStore();
  return store.replyMessages
    .filter((row) => row.threadId === threadId)
    .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
}

export async function findReplyMessageByProviderMessageId(
  providerMessageId: string
): Promise<ReplyMessage | null> {
  const normalized = providerMessageId.trim();
  if (!normalized) return null;

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_REPLY_MESSAGE)
      .select("*")
      .eq("provider_message_id", normalized)
      .maybeSingle();
    if (!error && data) {
      return mapReplyMessageRow(data);
    }
  }

  const store = await readLocalStore();
  return store.replyMessages.find((row) => row.providerMessageId === normalized) ?? null;
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
  runId?: string;
  subject: string;
  body: string;
  reason: string;
}): Promise<ReplyDraft> {
  const now = nowIso();
  const draft: ReplyDraft = {
    id: createId("draft"),
    threadId: input.threadId,
    brandId: input.brandId,
    runId: input.runId?.trim() ?? "",
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
        run_id: draft.runId || null,
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
  patch: Partial<Pick<ReplyDraft, "status" | "sentAt" | "subject" | "body" | "reason">>
): Promise<ReplyDraft | null> {
  const now = nowIso();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status) update.status = patch.status;
    if (patch.sentAt !== undefined) update.sent_at = patch.sentAt || null;
    if (patch.subject !== undefined) update.subject = patch.subject;
    if (patch.body !== undefined) update.body = patch.body;
    if (patch.reason !== undefined) update.reason = patch.reason;

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

export async function createReplyThreadFeedback(input: {
  threadId: string;
  brandId: string;
  type: ReplyThreadFeedback["type"];
  note?: string;
}): Promise<ReplyThreadFeedback> {
  const feedback: ReplyThreadFeedback = {
    id: createId("rtf"),
    threadId: input.threadId,
    brandId: input.brandId,
    type: input.type,
    note: input.note?.trim() ?? "",
    createdAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_REPLY_THREAD_FEEDBACK)
      .insert({
        id: feedback.id,
        thread_id: feedback.threadId,
        brand_id: feedback.brandId,
        type: feedback.type,
        note: feedback.note,
        created_at: feedback.createdAt,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapReplyThreadFeedbackRow(data);
    }
  }

  const store = await readLocalStore();
  store.replyThreadFeedback.unshift(feedback);
  await writeLocalStore(store);
  return feedback;
}

export async function listReplyThreadFeedback(threadId: string): Promise<ReplyThreadFeedback[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_REPLY_THREAD_FEEDBACK)
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapReplyThreadFeedbackRow(row));
    }
  }

  const store = await readLocalStore();
  return store.replyThreadFeedback
    .filter((row) => row.threadId === threadId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getInboxSyncState(
  brandId: string,
  mailboxAccountId: string
): Promise<InboxSyncState | null> {
  const normalizedBrandId = brandId.trim();
  const normalizedMailboxAccountId = mailboxAccountId.trim();
  if (!normalizedBrandId || !normalizedMailboxAccountId) return null;

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_INBOX_SYNC_STATE)
      .select("*")
      .eq("brand_id", normalizedBrandId)
      .eq("mailbox_account_id", normalizedMailboxAccountId)
      .maybeSingle();
    if (!error && data) {
      return mapInboxSyncStateRow(data);
    }
  }

  const store = await readLocalStore();
  return (
    store.inboxSyncStates.find(
      (row) => row.brandId === normalizedBrandId && row.mailboxAccountId === normalizedMailboxAccountId
    ) ?? null
  );
}

export async function listInboxSyncStatesByBrand(brandId: string): Promise<InboxSyncState[]> {
  const normalizedBrandId = brandId.trim();
  if (!normalizedBrandId) return [];

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_INBOX_SYNC_STATE)
      .select("*")
      .eq("brand_id", normalizedBrandId)
      .order("updated_at", { ascending: false });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapInboxSyncStateRow(row));
    }
  }

  const store = await readLocalStore();
  return store.inboxSyncStates
    .filter((row) => row.brandId === normalizedBrandId)
    .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
}

export async function upsertInboxSyncState(input: {
  brandId: string;
  mailboxAccountId: string;
  mailboxName?: string;
  lastInboxUid?: number;
  lastSyncedAt?: string;
  lastError?: string;
}): Promise<InboxSyncState> {
  const existing = await getInboxSyncState(input.brandId, input.mailboxAccountId);
  const state: InboxSyncState = {
    brandId: input.brandId.trim(),
    mailboxAccountId: input.mailboxAccountId.trim(),
    mailboxName: input.mailboxName?.trim() || existing?.mailboxName || "",
    lastInboxUid: Math.max(existing?.lastInboxUid ?? 0, Math.round(Number(input.lastInboxUid ?? existing?.lastInboxUid ?? 0) || 0)),
    lastSyncedAt: input.lastSyncedAt?.trim() || nowIso(),
    lastError: input.lastError?.trim() ?? "",
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_INBOX_SYNC_STATE)
      .upsert(
        {
          brand_id: state.brandId,
          mailbox_account_id: state.mailboxAccountId,
          mailbox_name: state.mailboxName,
          last_inbox_uid: state.lastInboxUid,
          last_synced_at: state.lastSyncedAt || null,
          last_error: state.lastError,
          created_at: state.createdAt,
          updated_at: state.updatedAt,
        },
        { onConflict: "brand_id,mailbox_account_id" }
      )
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapInboxSyncStateRow(data);
    }
  }

  const store = await readLocalStore();
  const index = store.inboxSyncStates.findIndex(
    (row) => row.brandId === state.brandId && row.mailboxAccountId === state.mailboxAccountId
  );
  if (index >= 0) {
    store.inboxSyncStates[index] = state;
  } else {
    store.inboxSyncStates.unshift(state);
  }
  await writeLocalStore(store);
  return state;
}

export async function createInboxEvalRun(input: {
  brandId: string;
  scenarioId: string;
  scenarioName: string;
  seed: string;
  threadId?: string;
  scenario: InboxEvalRun["scenario"];
  transcript?: InboxEvalRun["transcript"];
}): Promise<InboxEvalRun> {
  const now = nowIso();
  const run: InboxEvalRun = {
    id: createId("ieval"),
    brandId: input.brandId.trim(),
    scenarioId: input.scenarioId.trim(),
    scenarioName: input.scenarioName.trim(),
    status: "running",
    seed: input.seed.trim(),
    threadId: input.threadId?.trim() ?? "",
    scenario: input.scenario,
    transcript: input.transcript ?? [],
    scorecard: null,
    lastError: "",
    startedAt: now,
    completedAt: "",
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_INBOX_EVAL_RUN)
      .insert({
        id: run.id,
        brand_id: run.brandId,
        scenario_id: run.scenarioId,
        scenario_name: run.scenarioName,
        status: run.status,
        seed: run.seed,
        thread_id: run.threadId || null,
        scenario: run.scenario,
        transcript: run.transcript,
        scorecard: run.scorecard,
        last_error: run.lastError,
        started_at: run.startedAt || null,
        completed_at: run.completedAt || null,
        created_at: run.createdAt,
        updated_at: run.updatedAt,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapInboxEvalRunRow(data);
    }
  }

  const store = await readLocalStore();
  store.inboxEvalRuns.unshift(run);
  await writeLocalStore(store);
  return run;
}

export async function updateInboxEvalRun(
  runId: string,
  patch: Partial<
    Pick<InboxEvalRun, "status" | "threadId" | "transcript" | "scorecard" | "lastError" | "startedAt" | "completedAt">
  >
): Promise<InboxEvalRun | null> {
  const supabase = getSupabaseAdmin();
  const now = nowIso();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status) update.status = patch.status;
    if (patch.threadId !== undefined) update.thread_id = patch.threadId || null;
    if (patch.transcript !== undefined) update.transcript = patch.transcript;
    if (patch.scorecard !== undefined) update.scorecard = patch.scorecard;
    if (patch.lastError !== undefined) update.last_error = patch.lastError;
    if (patch.startedAt !== undefined) update.started_at = patch.startedAt || null;
    if (patch.completedAt !== undefined) update.completed_at = patch.completedAt || null;

    const { data, error } = await supabase
      .from(TABLE_INBOX_EVAL_RUN)
      .update(update)
      .eq("id", runId)
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapInboxEvalRunRow(data);
    }
  }

  const store = await readLocalStore();
  const index = store.inboxEvalRuns.findIndex((row) => row.id === runId);
  if (index < 0) return null;
  store.inboxEvalRuns[index] = {
    ...store.inboxEvalRuns[index],
    ...patch,
    updatedAt: now,
  };
  await writeLocalStore(store);
  return store.inboxEvalRuns[index];
}

export async function getInboxEvalRun(runId: string): Promise<InboxEvalRun | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_INBOX_EVAL_RUN)
      .select("*")
      .eq("id", runId)
      .maybeSingle();
    if (!error && data) {
      return mapInboxEvalRunRow(data);
    }
  }

  const store = await readLocalStore();
  return store.inboxEvalRuns.find((row) => row.id === runId) ?? null;
}

export async function listInboxEvalRunsByBrand(brandId: string): Promise<InboxEvalRun[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_INBOX_EVAL_RUN)
      .select("*")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapInboxEvalRunRow(row));
    }
  }

  const store = await readLocalStore();
  return store.inboxEvalRuns
    .filter((row) => row.brandId === brandId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function createOutreachEvent(input: {
  runId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}): Promise<OutreachEvent> {
  const sanitizedPayload = asRecord(normalizeLegacyOutreachValue(input.payload ?? {}));
  const event: OutreachEvent = {
    id: createId("event"),
    runId: input.runId,
    eventType: input.eventType,
    payload: sanitizedPayload,
    createdAt: nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { error } = await supabase.from(TABLE_EVENT).insert({
      id: event.id,
      run_id: event.runId,
      event_type: event.eventType,
      payload: sanitizedPayload,
    });
    if (!error) {
      return event;
    }
  }

  const store = await readLocalStore();
  store.events.unshift(event);
  await writeLocalStore(store);

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

export async function listRunJobs(runId: string, limit = 50): Promise<OutreachJob[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_JOB)
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!error) {
      return (data ?? []).map((row: unknown) => mapJobRow(row));
    }
  }

  const store = await readLocalStore();
  return store.jobs
    .filter((row) => row.runId === runId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

export async function getCampaignPrepTask(
  brandId: string,
  campaignId: string,
  options: { allowMissingTable?: boolean } = {}
): Promise<CampaignPrepTask | null> {
  const normalizedBrandId = brandId.trim();
  const normalizedCampaignId = campaignId.trim();
  if (!normalizedBrandId || !normalizedCampaignId) return null;

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_CAMPAIGN_PREP_TASK)
      .select("*")
      .eq("brand_id", normalizedBrandId)
      .eq("campaign_id", normalizedCampaignId)
      .maybeSingle();
    if (!error) {
      return data ? mapCampaignPrepTaskRow(data) : null;
    }
    if (options.allowMissingTable && isMissingRelationError(error, TABLE_CAMPAIGN_PREP_TASK)) {
      return null;
    }
    if (isVercel) {
      throw new OutreachDataError("Failed to load campaign prep task from Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "getCampaignPrepTask",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          brandId: normalizedBrandId,
          campaignId: normalizedCampaignId,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  return (
    store.campaignPrepTasks.find(
      (row) => row.brandId === normalizedBrandId && row.campaignId === normalizedCampaignId
    ) ?? null
  );
}

export async function listCampaignPrepTasks(
  input: {
    brandId?: string;
    campaignId?: string;
    lane?: CampaignPrepTask["lane"];
    statuses?: CampaignPrepTask["status"][];
    dueBefore?: string;
    limit?: number;
  } = {},
  options: { allowMissingTable?: boolean } = {}
): Promise<CampaignPrepTask[]> {
  const normalizedBrandId = String(input.brandId ?? "").trim();
  const normalizedCampaignId = String(input.campaignId ?? "").trim();
  const normalizedLane = input.lane === "warmup" ? "warmup" : input.lane === "outbound" ? "outbound" : "";
  const statuses = Array.from(
    new Set((input.statuses ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))
  ) as CampaignPrepTask["status"][];
  const dueBefore = String(input.dueBefore ?? "").trim();
  const limit = Math.max(1, Math.min(500, Number(input.limit ?? 100) || 100));

  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase.from(TABLE_CAMPAIGN_PREP_TASK).select("*");
    if (normalizedBrandId) query = query.eq("brand_id", normalizedBrandId);
    if (normalizedCampaignId) query = query.eq("campaign_id", normalizedCampaignId);
    if (normalizedLane) query = query.eq("lane", normalizedLane);
    if (statuses.length) query = query.in("status", statuses);
    if (dueBefore) query = query.lte("execute_after", dueBefore);
    const { data, error } = await query.order("updated_at", { ascending: false }).limit(limit);
    if (!error) {
      return (data ?? []).map((row: unknown) => mapCampaignPrepTaskRow(row));
    }
    if (options.allowMissingTable && isMissingRelationError(error, TABLE_CAMPAIGN_PREP_TASK)) {
      return [];
    }
    if (isVercel) {
      throw new OutreachDataError("Failed to list campaign prep tasks from Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "listCampaignPrepTasks",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          brandId: normalizedBrandId,
          campaignId: normalizedCampaignId,
          lane: normalizedLane,
          statuses,
          dueBefore,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  return store.campaignPrepTasks
    .filter((row) => {
      if (normalizedBrandId && row.brandId !== normalizedBrandId) return false;
      if (normalizedCampaignId && row.campaignId !== normalizedCampaignId) return false;
      if (normalizedLane && row.lane !== normalizedLane) return false;
      if (statuses.length && !statuses.includes(row.status)) return false;
      if (dueBefore && row.executeAfter > dueBefore) return false;
      return true;
    })
    .sort((left, right) => {
      if (left.updatedAt === right.updatedAt) {
        return left.campaignId.localeCompare(right.campaignId);
      }
      return left.updatedAt < right.updatedAt ? 1 : -1;
    })
    .slice(0, limit);
}

export async function upsertCampaignPrepTask(
  input: Omit<CampaignPrepTask, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
  },
  options: { allowMissingTable?: boolean } = {}
): Promise<CampaignPrepTask> {
  const existing = await getCampaignPrepTask(input.brandId, input.campaignId, options);
  const now = nowIso();
  const task: CampaignPrepTask = {
    id: existing?.id ?? input.id ?? createId("preptask"),
    brandId: input.brandId.trim(),
    campaignId: input.campaignId.trim(),
    lane: input.lane,
    status: input.status,
    attempt: Math.max(0, Math.round(Number(input.attempt ?? 0) || 0)),
    executeAfter: String(input.executeAfter ?? "").trim() || now,
    startedAt: String(input.startedAt ?? "").trim(),
    finishedAt: String(input.finishedAt ?? "").trim(),
    blockerCode: input.blockerCode,
    summary: String(input.summary ?? "").trim(),
    lastError: normalizeLegacyOutreachErrorText(input.lastError ?? ""),
    progress: asRecord(normalizeLegacyOutreachValue(input.progress ?? {})),
    sourceVersion: String(input.sourceVersion ?? "").trim(),
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_CAMPAIGN_PREP_TASK)
      .upsert(
        {
          id: task.id,
          brand_id: task.brandId,
          campaign_id: task.campaignId,
          lane: task.lane,
          status: task.status,
          attempt: task.attempt,
          execute_after: task.executeAfter,
          started_at: task.startedAt || null,
          finished_at: task.finishedAt || null,
          blocker_code: task.blockerCode,
          summary: task.summary,
          last_error: task.lastError,
          progress: task.progress,
          source_version: task.sourceVersion,
          created_at: task.createdAt,
          updated_at: task.updatedAt,
        },
        { onConflict: "brand_id,campaign_id" }
      )
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapCampaignPrepTaskRow(data);
    }
    if (!(options.allowMissingTable && isMissingRelationError(error, TABLE_CAMPAIGN_PREP_TASK)) && isVercel) {
      throw new OutreachDataError("Failed to save campaign prep task in Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "upsertCampaignPrepTask",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          brandId: task.brandId,
          campaignId: task.campaignId,
          status: task.status,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  const index = store.campaignPrepTasks.findIndex(
    (row) => row.brandId === task.brandId && row.campaignId === task.campaignId
  );
  if (index >= 0) {
    store.campaignPrepTasks[index] = task;
  } else {
    store.campaignPrepTasks.unshift(task);
  }
  await writeLocalStore(store);
  return task;
}

export async function claimOutreachLease(
  input: Omit<OutreachLease, "id" | "status" | "releasedAt" | "releasedReason" | "createdAt" | "updatedAt"> & {
    id?: string;
  },
  options: { allowMissingTable?: boolean } = {}
): Promise<OutreachLease | null> {
  const scopeId = input.scopeId.trim();
  const holder = input.holder.trim();
  if (!scopeId || !holder) return null;

  const now = nowIso();
  const lease: OutreachLease = {
    id: input.id ?? createId("lease"),
    leaseType: input.leaseType,
    scopeType: input.scopeType,
    scopeId,
    holder,
    status: "active",
    expiresAt: String(input.expiresAt ?? "").trim() || now,
    metadata: asRecord(normalizeLegacyOutreachValue(input.metadata ?? {})),
    releasedAt: "",
    releasedReason: "",
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    await supabase
      .from(TABLE_OUTREACH_LEASE)
      .update({
        status: "expired",
        released_at: now,
        released_reason: "lease expired",
        updated_at: now,
      })
      .eq("lease_type", lease.leaseType)
      .eq("scope_type", lease.scopeType)
      .eq("scope_id", lease.scopeId)
      .eq("status", "active")
      .lte("expires_at", now);

    const { data, error } = await supabase
      .from(TABLE_OUTREACH_LEASE)
      .insert({
        id: lease.id,
        lease_type: lease.leaseType,
        scope_type: lease.scopeType,
        scope_id: lease.scopeId,
        holder: lease.holder,
        status: lease.status,
        expires_at: lease.expiresAt,
        metadata: lease.metadata,
        released_at: null,
        released_reason: "",
        created_at: lease.createdAt,
        updated_at: lease.updatedAt,
      })
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapOutreachLeaseRow(data);
    }
    if (isUniqueViolationError(error)) {
      return null;
    }
    if (!(options.allowMissingTable && isMissingRelationError(error, TABLE_OUTREACH_LEASE)) && isVercel) {
      throw new OutreachDataError("Failed to claim outreach lease in Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "claimOutreachLease",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          leaseType: lease.leaseType,
          scopeType: lease.scopeType,
          scopeId: lease.scopeId,
          holder: lease.holder,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  let changed = false;
  store.outreachLeases = store.outreachLeases.map((row) => {
    if (
      row.leaseType === lease.leaseType &&
      row.scopeType === lease.scopeType &&
      row.scopeId === lease.scopeId &&
      row.status === "active" &&
      row.expiresAt <= now
    ) {
      changed = true;
      return {
        ...row,
        status: "expired",
        releasedAt: now,
        releasedReason: "lease expired",
        updatedAt: now,
      };
    }
    return row;
  });
  const conflictingActive = store.outreachLeases.find(
    (row) =>
      row.leaseType === lease.leaseType &&
      row.scopeType === lease.scopeType &&
      row.scopeId === lease.scopeId &&
      row.status === "active"
  );
  if (conflictingActive) {
    if (changed) {
      await writeLocalStore(store);
    }
    return null;
  }
  store.outreachLeases.unshift(lease);
  await writeLocalStore(store);
  return lease;
}

export async function releaseOutreachLease(
  leaseId: string,
  reason = "",
  options: { allowMissingTable?: boolean } = {}
): Promise<OutreachLease | null> {
  const normalizedLeaseId = leaseId.trim();
  if (!normalizedLeaseId) return null;

  const now = nowIso();
  const releasedReason = String(reason ?? "").trim();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_OUTREACH_LEASE)
      .update({
        status: "released",
        released_at: now,
        released_reason: releasedReason,
        updated_at: now,
      })
      .eq("id", normalizedLeaseId)
      .eq("status", "active")
      .select("*")
      .maybeSingle();
    if (!error) {
      return data ? mapOutreachLeaseRow(data) : null;
    }
    if (!(options.allowMissingTable && isMissingRelationError(error, TABLE_OUTREACH_LEASE)) && isVercel) {
      throw new OutreachDataError("Failed to release outreach lease in Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "releaseOutreachLease",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          leaseId: normalizedLeaseId,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  const index = store.outreachLeases.findIndex(
    (row) => row.id === normalizedLeaseId && row.status === "active"
  );
  if (index < 0) return null;
  const next: OutreachLease = {
    ...store.outreachLeases[index],
    status: "released",
    releasedAt: now,
    releasedReason,
    updatedAt: now,
  };
  store.outreachLeases[index] = next;
  await writeLocalStore(store);
  return next;
}

export async function deleteCampaignPrepArtifactsByCampaignIds(
  campaignIds: string[],
  options: { allowMissingTable?: boolean } = {}
): Promise<{ tasksDeleted: number; leasesDeleted: number }> {
  const uniqueCampaignIds = Array.from(
    new Set(campaignIds.map((value) => String(value ?? "").trim()).filter(Boolean))
  );
  if (!uniqueCampaignIds.length) {
    return { tasksDeleted: 0, leasesDeleted: 0 };
  }

  let tasksDeleted = 0;
  let leasesDeleted = 0;
  const supabase = getSupabaseAdmin();
  if (supabase) {
    for (const campaignIdChunk of chunkStrings(uniqueCampaignIds)) {
      const [{ data: taskRows, error: taskSelectError }, { data: leaseRows, error: leaseSelectError }] =
        await Promise.all([
          supabase.from(TABLE_CAMPAIGN_PREP_TASK).select("id").in("campaign_id", campaignIdChunk),
          supabase
            .from(TABLE_OUTREACH_LEASE)
            .select("id")
            .eq("lease_type", "campaign_prep")
            .eq("scope_type", "campaign")
            .in("scope_id", campaignIdChunk),
        ]);

      if (!(options.allowMissingTable && isMissingRelationError(taskSelectError, TABLE_CAMPAIGN_PREP_TASK)) && taskSelectError && isVercel) {
        throw new OutreachDataError("Failed to inspect campaign prep tasks in Supabase.", {
          status: 500,
          hint: hintForSupabaseWriteError(taskSelectError),
          debug: {
            operation: "deleteCampaignPrepArtifactsByCampaignIds.selectTasks",
            runtime: runtimeLabel(),
            supabaseConfigured: supabaseConfigured(),
            campaignIds: campaignIdChunk,
            supabaseError: supabaseErrorDebug(taskSelectError),
          },
        });
      }

      if (!(options.allowMissingTable && isMissingRelationError(leaseSelectError, TABLE_OUTREACH_LEASE)) && leaseSelectError && isVercel) {
        throw new OutreachDataError("Failed to inspect outreach leases in Supabase.", {
          status: 500,
          hint: hintForSupabaseWriteError(leaseSelectError),
          debug: {
            operation: "deleteCampaignPrepArtifactsByCampaignIds.selectLeases",
            runtime: runtimeLabel(),
            supabaseConfigured: supabaseConfigured(),
            campaignIds: campaignIdChunk,
            supabaseError: supabaseErrorDebug(leaseSelectError),
          },
        });
      }

      const [{ error: taskDeleteError }, { error: leaseDeleteError }] = await Promise.all([
        supabase.from(TABLE_CAMPAIGN_PREP_TASK).delete().in("campaign_id", campaignIdChunk),
        supabase
          .from(TABLE_OUTREACH_LEASE)
          .delete()
          .eq("lease_type", "campaign_prep")
          .eq("scope_type", "campaign")
          .in("scope_id", campaignIdChunk),
      ]);

      if (!(options.allowMissingTable && isMissingRelationError(taskDeleteError, TABLE_CAMPAIGN_PREP_TASK)) && taskDeleteError && isVercel) {
        throw new OutreachDataError("Failed to delete campaign prep tasks in Supabase.", {
          status: 500,
          hint: hintForSupabaseWriteError(taskDeleteError),
          debug: {
            operation: "deleteCampaignPrepArtifactsByCampaignIds.deleteTasks",
            runtime: runtimeLabel(),
            supabaseConfigured: supabaseConfigured(),
            campaignIds: campaignIdChunk,
            supabaseError: supabaseErrorDebug(taskDeleteError),
          },
        });
      }

      if (!(options.allowMissingTable && isMissingRelationError(leaseDeleteError, TABLE_OUTREACH_LEASE)) && leaseDeleteError && isVercel) {
        throw new OutreachDataError("Failed to delete outreach leases in Supabase.", {
          status: 500,
          hint: hintForSupabaseWriteError(leaseDeleteError),
          debug: {
            operation: "deleteCampaignPrepArtifactsByCampaignIds.deleteLeases",
            runtime: runtimeLabel(),
            supabaseConfigured: supabaseConfigured(),
            campaignIds: campaignIdChunk,
            supabaseError: supabaseErrorDebug(leaseDeleteError),
          },
        });
      }

      tasksDeleted += (taskRows ?? []).length;
      leasesDeleted += (leaseRows ?? []).length;
    }
  }

  const store = await readLocalStore();
  const campaignIdSet = new Set(uniqueCampaignIds);
  const nextCampaignPrepTasks = store.campaignPrepTasks.filter((row) => !campaignIdSet.has(row.campaignId));
  const nextOutreachLeases = store.outreachLeases.filter(
    (row) =>
      !(
        row.leaseType === "campaign_prep" &&
        row.scopeType === "campaign" &&
        campaignIdSet.has(row.scopeId)
      )
  );
  const localTasksDeleted = store.campaignPrepTasks.length - nextCampaignPrepTasks.length;
  const localLeasesDeleted = store.outreachLeases.length - nextOutreachLeases.length;
  if (localTasksDeleted > 0 || localLeasesDeleted > 0) {
    store.campaignPrepTasks = nextCampaignPrepTasks;
    store.outreachLeases = nextOutreachLeases;
    await writeLocalStore(store);
  }

  if (!supabase) {
    tasksDeleted = localTasksDeleted;
    leasesDeleted = localLeasesDeleted;
  }

  return { tasksDeleted, leasesDeleted };
}

export async function listRunIdsForJobs(input: {
  jobTypes?: OutreachJobType[];
  statuses?: OutreachJobStatus[];
}): Promise<string[]> {
  const normalizedJobTypes = Array.from(
    new Set((input.jobTypes ?? []).map((jobType) => String(jobType ?? "").trim()).filter(Boolean))
  ) as OutreachJobType[];
  const normalizedStatuses = Array.from(
    new Set((input.statuses ?? []).map((status) => String(status ?? "").trim()).filter(Boolean))
  ) as OutreachJobStatus[];

  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase.from(TABLE_JOB).select("run_id");
    if (normalizedJobTypes.length) {
      query = query.in("job_type", normalizedJobTypes);
    }
    if (normalizedStatuses.length) {
      query = query.in("status", normalizedStatuses);
    }
    const { data, error } = await query;
    if (!error) {
      return Array.from(
        new Set((data ?? []).map((row: { run_id?: string | null }) => String(row.run_id ?? "").trim()).filter(Boolean))
      );
    }
  }

  const store = await readLocalStore();
  return Array.from(
    new Set(
      store.jobs
        .filter((row) => {
          if (normalizedJobTypes.length && !normalizedJobTypes.includes(row.jobType)) return false;
          if (normalizedStatuses.length && !normalizedStatuses.includes(row.status)) return false;
          return true;
        })
        .map((row) => row.runId)
        .filter(Boolean)
    )
  );
}

export async function hasActiveRunJob(input: {
  runId: string;
  jobType: OutreachJobType;
  statuses?: OutreachJobStatus[];
}): Promise<boolean> {
  const statuses = Array.from(new Set(input.statuses ?? ["queued", "running"]));
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_JOB)
      .select("id")
      .eq("run_id", input.runId)
      .eq("job_type", input.jobType)
      .in("status", statuses)
      .limit(1);
    if (!error) {
      return Boolean(data?.length);
    }
  }

  const store = await readLocalStore();
  return store.jobs.some(
    (row) =>
      row.runId === input.runId &&
      row.jobType === input.jobType &&
      statuses.includes(row.status)
  );
}

export async function enqueueOutreachJob(input: {
  runId: string;
  jobType: OutreachJobType;
  executeAfter?: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}): Promise<OutreachJob> {
  const now = nowIso();
  const singletonJobType = SINGLETON_OUTREACH_JOB_TYPES.has(input.jobType);
  const requestedExecuteAfter = input.executeAfter ?? now;
  const requestedPayload = asRecord(normalizeLegacyOutreachValue(input.payload ?? {}));
  const requestedMaxAttempts = input.maxAttempts ?? 5;
  const job: OutreachJob = {
    id: createId("job"),
    runId: input.runId,
    jobType: input.jobType,
    status: "queued",
    executeAfter: requestedExecuteAfter,
    attempts: 0,
    maxAttempts: requestedMaxAttempts,
    payload: requestedPayload,
    lastError: "",
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    if (singletonJobType) {
      const { data: existingQueued, error: existingError } = await supabase
        .from(TABLE_JOB)
        .select("*")
        .eq("run_id", input.runId)
        .eq("job_type", input.jobType)
        .eq("status", "queued")
        .order("execute_after", { ascending: true })
        .order("created_at", { ascending: true });

      if (!existingError && existingQueued && existingQueued.length) {
        const mappedQueued = existingQueued.map((row: unknown) => mapJobRow(row));
        const [keep, ...duplicates] = mappedQueued;
        const nextExecuteAfter =
          keep.executeAfter <= requestedExecuteAfter ? keep.executeAfter : requestedExecuteAfter;
        const nextPayload = { ...keep.payload, ...requestedPayload };
        const nextMaxAttempts = Math.max(keep.maxAttempts, requestedMaxAttempts);
        const shouldUpdate =
          keep.executeAfter !== nextExecuteAfter ||
          keep.maxAttempts !== nextMaxAttempts ||
          JSON.stringify(keep.payload) !== JSON.stringify(nextPayload);

        let keptJob = keep;
        if (shouldUpdate) {
          const { data: updated, error: updateError } = await supabase
            .from(TABLE_JOB)
            .update({
              execute_after: nextExecuteAfter,
              payload: nextPayload,
              max_attempts: nextMaxAttempts,
              updated_at: now,
            })
            .eq("id", keep.id)
            .select("*")
            .maybeSingle();
          if (!updateError && updated) {
            keptJob = mapJobRow(updated);
          }
        }

        if (duplicates.length) {
          await supabase
            .from(TABLE_JOB)
            .delete()
            .in(
              "id",
              duplicates.map((queuedJob) => queuedJob.id)
            );
        }

        return keptJob;
      }
    }

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
  if (singletonJobType) {
    const queuedMatches = store.jobs
      .filter((row) => row.runId === input.runId && row.jobType === input.jobType && row.status === "queued")
      .sort((left, right) => {
        if (left.executeAfter === right.executeAfter) {
          return left.createdAt < right.createdAt ? -1 : 1;
        }
        return left.executeAfter < right.executeAfter ? -1 : 1;
      });
    if (queuedMatches.length) {
      const [keep, ...duplicates] = queuedMatches;
      const nextExecuteAfter =
        keep.executeAfter <= requestedExecuteAfter ? keep.executeAfter : requestedExecuteAfter;
      const nextPayload = { ...keep.payload, ...requestedPayload };
      const nextMaxAttempts = Math.max(keep.maxAttempts, requestedMaxAttempts);
      const updatedKeep: OutreachJob = {
        ...keep,
        executeAfter: nextExecuteAfter,
        payload: nextPayload,
        maxAttempts: nextMaxAttempts,
        updatedAt: now,
      };
      store.jobs = store.jobs.filter((row) => !duplicates.some((duplicate) => duplicate.id === row.id));
      const keepIndex = store.jobs.findIndex((row) => row.id === keep.id);
      if (keepIndex >= 0) {
        store.jobs[keepIndex] = updatedKeep;
      }
      await writeLocalStore(store);
      return updatedKeep;
    }
  }
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

export async function listActiveOutreachJobsByType(input: {
  jobType: OutreachJobType;
  statuses?: OutreachJobStatus[];
  limit?: number;
}): Promise<OutreachJob[]> {
  const statuses = Array.from(new Set(input.statuses ?? ["queued", "running"]));
  const limit = Math.max(1, Math.min(200, Number(input.limit ?? 50) || 50));
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_JOB)
      .select("*")
      .eq("job_type", input.jobType)
      .in("status", statuses)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (!error) {
      return (data ?? []).map((row: unknown) => mapJobRow(row));
    }
  }

  const store = await readLocalStore();
  return store.jobs
    .filter((row) => row.jobType === input.jobType && statuses.includes(row.status))
    .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))
    .slice(0, limit);
}

export async function reclaimStaleRunningOutreachJobs(input?: {
  staleAfterMinutes?: number;
  limit?: number;
}): Promise<OutreachJob[]> {
  const staleAfterMinutes = Math.max(1, Math.min(120, Number(input?.staleAfterMinutes ?? 6) || 6));
  const limit = Math.max(1, Math.min(200, Number(input?.limit ?? 25) || 25));
  const now = new Date();
  const nowValue = now.toISOString();
  const staleBefore = new Date(now.getTime() - staleAfterMinutes * 60_000).toISOString();
  const recovered: OutreachJob[] = [];

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_JOB)
      .select("*")
      .eq("status", "running")
      .lte("updated_at", staleBefore)
      .order("updated_at", { ascending: true })
      .limit(limit);
    if (!error) {
      for (const row of data ?? []) {
        const mapped = mapJobRow(row);
        const patchError = mapped.lastError
          ? `${mapped.lastError}; requeued stale running job`
          : "requeued stale running job";
        const { data: updated, error: updateError } = await supabase
          .from(TABLE_JOB)
          .update({
            status: "queued",
            execute_after: nowValue,
            last_error: patchError,
            updated_at: nowValue,
          })
          .eq("id", mapped.id)
          .select("*")
          .maybeSingle();
        if (!updateError && updated) {
          recovered.push(mapJobRow(updated));
        }
      }
      return recovered;
    }
  }

  const store = await readLocalStore();
  for (let index = 0; index < store.jobs.length; index += 1) {
    if (recovered.length >= limit) break;
    const job = store.jobs[index];
    if (job.status !== "running") continue;
    if (job.updatedAt > staleBefore) continue;
    const patchError = job.lastError
      ? `${job.lastError}; requeued stale running job`
      : "requeued stale running job";
    const updated: OutreachJob = {
      ...job,
      status: "queued",
      executeAfter: nowValue,
      lastError: patchError,
      updatedAt: nowValue,
    };
    store.jobs[index] = updated;
    recovered.push(updated);
  }
  if (recovered.length) {
    await writeLocalStore(store);
  }
  return recovered;
}

export async function updateOutreachJob(
  jobId: string,
  patch: Partial<Pick<OutreachJob, "status" | "executeAfter" | "attempts" | "lastError" | "payload">>
): Promise<OutreachJob | null> {
  const now = nowIso();
  const sanitizedLastError =
    patch.lastError === undefined ? undefined : normalizeLegacyOutreachErrorText(patch.lastError);
  const sanitizedPayload =
    patch.payload === undefined ? undefined : asRecord(normalizeLegacyOutreachValue(patch.payload));
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status) update.status = patch.status;
    if (patch.executeAfter !== undefined) update.execute_after = patch.executeAfter;
    if (patch.attempts !== undefined) update.attempts = patch.attempts;
    if (sanitizedLastError !== undefined) update.last_error = sanitizedLastError;
    if (sanitizedPayload !== undefined) update.payload = sanitizedPayload;

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
    ...(sanitizedLastError === undefined ? {} : { lastError: sanitizedLastError }),
    ...(sanitizedPayload === undefined ? {} : { payload: sanitizedPayload }),
    updatedAt: now,
  };
  await writeLocalStore(store);
  return store.jobs[idx];
}

export async function updateOutreachJobs(
  jobIds: string[],
  patch: Partial<Pick<OutreachJob, "status" | "executeAfter" | "attempts" | "lastError" | "payload">>
): Promise<OutreachJob[]> {
  const ids = Array.from(new Set(jobIds.map((item) => String(item ?? "").trim()).filter(Boolean)));
  if (!ids.length) return [];

  const now = nowIso();
  const sanitizedLastError =
    patch.lastError === undefined ? undefined : normalizeLegacyOutreachErrorText(patch.lastError);
  const sanitizedPayload =
    patch.payload === undefined ? undefined : asRecord(normalizeLegacyOutreachValue(patch.payload));

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.executeAfter !== undefined) update.execute_after = patch.executeAfter;
    if (patch.attempts !== undefined) update.attempts = patch.attempts;
    if (sanitizedLastError !== undefined) update.last_error = sanitizedLastError;
    if (sanitizedPayload !== undefined) update.payload = sanitizedPayload;

    const { data, error } = await supabase
      .from(TABLE_JOB)
      .update(update)
      .in("id", ids)
      .select("*");
    if (!error) {
      return (data ?? []).map((row: unknown) => mapJobRow(row));
    }
  }

  const store = await readLocalStore();
  const updated: OutreachJob[] = [];
  for (let index = 0; index < store.jobs.length; index += 1) {
    const row = store.jobs[index];
    if (!ids.includes(row.id)) continue;
    const next: OutreachJob = {
      ...row,
      ...patch,
      ...(sanitizedLastError === undefined ? {} : { lastError: sanitizedLastError }),
      ...(sanitizedPayload === undefined ? {} : { payload: sanitizedPayload }),
      updatedAt: now,
    };
    store.jobs[index] = next;
    updated.push(next);
  }
  if (updated.length) {
    await writeLocalStore(store);
  }
  return updated;
}

export async function claimQueuedOutreachJob(jobId: string, attempts: number): Promise<OutreachJob | null> {
  const now = nowIso();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_JOB)
      .update({
        status: "running",
        attempts,
        updated_at: now,
      })
      .eq("id", jobId)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapJobRow(data);
    }
    return null;
  }

  const store = await readLocalStore();
  const index = store.jobs.findIndex((row) => row.id === jobId && row.status === "queued");
  if (index < 0) return null;
  const next: OutreachJob = {
    ...store.jobs[index],
    status: "running",
    attempts,
    updatedAt: now,
  };
  store.jobs[index] = next;
  await writeLocalStore(store);
  return next;
}

export async function createDeliverabilityProbeRun(input: {
  runId: string;
  brandId: string;
  campaignId: string;
  experimentId: string;
  probeToken: string;
  probeVariant: DeliverabilityProbeVariant;
  status?: DeliverabilityProbeRun["status"];
  stage?: DeliverabilityProbeStage;
  sourceMessageId?: string;
  sourceMessageStatus?: string;
  sourceType?: string;
  sourceNodeId?: string;
  sourceLeadId?: string;
  senderAccountId?: string;
  senderAccountName?: string;
  fromEmail?: string;
  replyToEmail?: string;
  subject?: string;
  contentHash?: string;
  reservationIds?: string[];
  monitorTargets?: DeliverabilityProbeTarget[];
  results?: DeliverabilityProbeMonitorResult[];
  pollAttempt?: number;
  placement?: string;
  totalMonitors?: number;
  counts?: Record<string, unknown>;
  summaryText?: string;
  lastError?: string;
  completedAt?: string;
}): Promise<DeliverabilityProbeRun> {
  const now = nowIso();
  const probeRun: DeliverabilityProbeRun = {
    id: createId("probe"),
    runId: input.runId,
    brandId: input.brandId,
    campaignId: input.campaignId,
    experimentId: input.experimentId,
    probeToken: input.probeToken.trim(),
    probeVariant: input.probeVariant,
    status: input.status ?? "queued",
    stage: input.stage ?? "send",
    sourceMessageId: String(input.sourceMessageId ?? "").trim(),
    sourceMessageStatus: String(input.sourceMessageStatus ?? "").trim(),
    sourceType: String(input.sourceType ?? "").trim(),
    sourceNodeId: String(input.sourceNodeId ?? "").trim(),
    sourceLeadId: String(input.sourceLeadId ?? "").trim(),
    senderAccountId: String(input.senderAccountId ?? "").trim(),
    senderAccountName: String(input.senderAccountName ?? "").trim(),
    fromEmail: String(input.fromEmail ?? "").trim().toLowerCase(),
    replyToEmail: String(input.replyToEmail ?? "").trim().toLowerCase(),
    subject: String(input.subject ?? "").trim(),
    contentHash: String(input.contentHash ?? "").trim(),
    reservationIds: (input.reservationIds ?? []).map((item) => String(item ?? "").trim()).filter(Boolean),
    monitorTargets: (input.monitorTargets ?? []).map((item) => mapDeliverabilityProbeTarget(item)),
    results: (input.results ?? []).map((item) => mapDeliverabilityProbeMonitorResult(item)),
    pollAttempt: Math.max(0, Number(input.pollAttempt ?? 0) || 0),
    placement: String(input.placement ?? "unknown").trim(),
    totalMonitors: Math.max(0, Number(input.totalMonitors ?? 0) || 0),
    counts: input.counts ?? {},
    summaryText: String(input.summaryText ?? "").trim(),
    lastError: String(input.lastError ?? "").trim(),
    completedAt: String(input.completedAt ?? "").trim(),
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_DELIVERABILITY_PROBE_RUN)
      .insert({
        id: probeRun.id,
        run_id: probeRun.runId,
        brand_id: probeRun.brandId,
        campaign_id: probeRun.campaignId,
        experiment_id: probeRun.experimentId,
        probe_token: probeRun.probeToken,
        probe_variant: probeRun.probeVariant,
        status: probeRun.status,
        stage: probeRun.stage,
        source_message_id: probeRun.sourceMessageId,
        source_message_status: probeRun.sourceMessageStatus,
        source_type: probeRun.sourceType,
        source_node_id: probeRun.sourceNodeId,
        source_lead_id: probeRun.sourceLeadId,
        sender_account_id: probeRun.senderAccountId,
        sender_account_name: probeRun.senderAccountName,
        from_email: probeRun.fromEmail,
        reply_to_email: probeRun.replyToEmail,
        subject: probeRun.subject,
        content_hash: probeRun.contentHash,
        reservation_ids: probeRun.reservationIds,
        monitor_targets: probeRun.monitorTargets,
        results: probeRun.results,
        poll_attempt: probeRun.pollAttempt,
        placement: probeRun.placement,
        total_monitors: probeRun.totalMonitors,
        counts: probeRun.counts,
        summary_text: probeRun.summaryText,
        last_error: probeRun.lastError,
        completed_at: probeRun.completedAt || null,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapDeliverabilityProbeRunRow(data);
    }
  }

  const store = await readLocalStore();
  store.deliverabilityProbeRuns.unshift(probeRun);
  await writeLocalStore(store);
  return probeRun;
}

export async function getDeliverabilityProbeRun(probeRunId: string): Promise<DeliverabilityProbeRun | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_DELIVERABILITY_PROBE_RUN)
      .select("*")
      .eq("id", probeRunId)
      .maybeSingle();
    if (!error && data) {
      return mapDeliverabilityProbeRunRow(data);
    }
  }

  const store = await readLocalStore();
  return store.deliverabilityProbeRuns.find((row) => row.id === probeRunId) ?? null;
}

export async function findDeliverabilityProbeRun(input: {
  runId: string;
  probeToken: string;
  probeVariant?: DeliverabilityProbeVariant;
}): Promise<DeliverabilityProbeRun | null> {
  const runId = input.runId.trim();
  const probeToken = input.probeToken.trim();
  const probeVariant = input.probeVariant;
  if (!runId || !probeToken) return null;

  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase
      .from(TABLE_DELIVERABILITY_PROBE_RUN)
      .select("*")
      .eq("run_id", runId)
      .eq("probe_token", probeToken)
      .order("created_at", { ascending: false })
      .limit(1);
    if (probeVariant) query = query.eq("probe_variant", probeVariant);
    const { data, error } = await query;
    if (!error) {
      const row = (data ?? [])[0];
      return row ? mapDeliverabilityProbeRunRow(row) : null;
    }
  }

  const store = await readLocalStore();
  return (
    store.deliverabilityProbeRuns
      .filter(
        (row) =>
          row.runId === runId &&
          row.probeToken === probeToken &&
          (!probeVariant || row.probeVariant === probeVariant)
      )
      .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1))[0] ?? null
  );
}

export async function listDeliverabilityProbeRuns(input?: {
  brandId?: string;
  runId?: string;
  campaignId?: string;
  experimentId?: string;
  senderAccountId?: string;
  fromEmail?: string;
  probeVariant?: DeliverabilityProbeVariant;
  statuses?: DeliverabilityProbeRun["status"][];
  limit?: number;
}): Promise<DeliverabilityProbeRun[]> {
  const brandId = String(input?.brandId ?? "").trim();
  const runId = String(input?.runId ?? "").trim();
  const campaignId = String(input?.campaignId ?? "").trim();
  const experimentId = String(input?.experimentId ?? "").trim();
  const senderAccountId = String(input?.senderAccountId ?? "").trim();
  const fromEmail = String(input?.fromEmail ?? "").trim().toLowerCase();
  const probeVariant = input?.probeVariant;
  const statuses = (input?.statuses ?? []).filter(Boolean);
  const limit = Math.max(0, Number(input?.limit ?? 0) || 0);

  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase
      .from(TABLE_DELIVERABILITY_PROBE_RUN)
      .select("*")
      .order("created_at", { ascending: false });
    if (brandId) query = query.eq("brand_id", brandId);
    if (runId) query = query.eq("run_id", runId);
    if (campaignId) query = query.eq("campaign_id", campaignId);
    if (experimentId) query = query.eq("experiment_id", experimentId);
    if (senderAccountId) query = query.eq("sender_account_id", senderAccountId);
    if (fromEmail) query = query.eq("from_email", fromEmail);
    if (probeVariant) query = query.eq("probe_variant", probeVariant);
    if (statuses.length) query = query.in("status", statuses);
    if (limit > 0) query = query.limit(limit);
    const { data, error } = await query;
    if (!error) {
      return (data ?? []).map((row: unknown) => mapDeliverabilityProbeRunRow(row));
    }
  }

  let rows = (await readLocalStore()).deliverabilityProbeRuns.filter((row) => {
    if (brandId && row.brandId !== brandId) return false;
    if (runId && row.runId !== runId) return false;
    if (campaignId && row.campaignId !== campaignId) return false;
    if (experimentId && row.experimentId !== experimentId) return false;
    if (senderAccountId && row.senderAccountId !== senderAccountId) return false;
    if (fromEmail && row.fromEmail !== fromEmail) return false;
    if (probeVariant && row.probeVariant !== probeVariant) return false;
    if (statuses.length && !statuses.includes(row.status)) return false;
    return true;
  });
  rows = rows.sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

export async function updateDeliverabilityProbeRun(
  probeRunId: string,
  patch: Partial<
    Pick<
      DeliverabilityProbeRun,
      | "status"
      | "stage"
      | "senderAccountId"
      | "senderAccountName"
      | "fromEmail"
      | "replyToEmail"
      | "subject"
      | "contentHash"
      | "reservationIds"
      | "monitorTargets"
      | "results"
      | "pollAttempt"
      | "placement"
      | "totalMonitors"
      | "counts"
      | "summaryText"
      | "lastError"
      | "completedAt"
    >
  >
): Promise<DeliverabilityProbeRun | null> {
  const now = nowIso();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.stage !== undefined) update.stage = patch.stage;
    if (patch.senderAccountId !== undefined) update.sender_account_id = patch.senderAccountId;
    if (patch.senderAccountName !== undefined) update.sender_account_name = patch.senderAccountName;
    if (patch.fromEmail !== undefined) update.from_email = patch.fromEmail;
    if (patch.replyToEmail !== undefined) update.reply_to_email = patch.replyToEmail;
    if (patch.subject !== undefined) update.subject = patch.subject;
    if (patch.contentHash !== undefined) update.content_hash = patch.contentHash;
    if (patch.reservationIds !== undefined) update.reservation_ids = patch.reservationIds;
    if (patch.monitorTargets !== undefined) update.monitor_targets = patch.monitorTargets;
    if (patch.results !== undefined) update.results = patch.results;
    if (patch.pollAttempt !== undefined) update.poll_attempt = patch.pollAttempt;
    if (patch.placement !== undefined) update.placement = patch.placement;
    if (patch.totalMonitors !== undefined) update.total_monitors = patch.totalMonitors;
    if (patch.counts !== undefined) update.counts = patch.counts;
    if (patch.summaryText !== undefined) update.summary_text = patch.summaryText;
    if (patch.lastError !== undefined) update.last_error = patch.lastError;
    if (patch.completedAt !== undefined) update.completed_at = patch.completedAt || null;

    const { data, error } = await supabase
      .from(TABLE_DELIVERABILITY_PROBE_RUN)
      .update(update)
      .eq("id", probeRunId)
      .select("*")
      .maybeSingle();
    if (!error && data) {
      return mapDeliverabilityProbeRunRow(data);
    }
  }

  const store = await readLocalStore();
  const index = store.deliverabilityProbeRuns.findIndex((row) => row.id === probeRunId);
  if (index < 0) return null;
  store.deliverabilityProbeRuns[index] = {
    ...store.deliverabilityProbeRuns[index],
    ...patch,
    updatedAt: now,
  };
  await writeLocalStore(store);
  return store.deliverabilityProbeRuns[index];
}

export async function listDeliverabilitySeedReservations(input?: {
  brandId?: string;
  runId?: string;
  probeRunId?: string;
  senderAccountId?: string;
  fromEmail?: string;
  statuses?: DeliverabilitySeedReservationStatus[];
}): Promise<DeliverabilitySeedReservation[]> {
  const brandId = String(input?.brandId ?? "").trim();
  const runId = String(input?.runId ?? "").trim();
  const probeRunId = String(input?.probeRunId ?? "").trim();
  const senderAccountId = String(input?.senderAccountId ?? "").trim();
  const fromEmail = String(input?.fromEmail ?? "").trim().toLowerCase();
  const statuses = (input?.statuses ?? []).filter(Boolean);

  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase
      .from(TABLE_DELIVERABILITY_SEED_RESERVATION)
      .select("*")
      .order("created_at", { ascending: false });
    if (brandId) query = query.eq("brand_id", brandId);
    if (runId) query = query.eq("run_id", runId);
    if (probeRunId) query = query.eq("probe_run_id", probeRunId);
    if (senderAccountId) query = query.eq("sender_account_id", senderAccountId);
    if (fromEmail) query = query.eq("from_email", fromEmail);
    if (statuses.length) query = query.in("status", statuses);
    const { data, error } = await query;
    if (!error) {
      return (data ?? []).map((row: unknown) => mapDeliverabilitySeedReservationRow(row));
    }
  }

  const store = await readLocalStore();
  return store.deliverabilitySeedReservations
    .filter((row) => {
      if (brandId && row.brandId !== brandId) return false;
      if (runId && row.runId !== runId) return false;
      if (probeRunId && row.probeRunId !== probeRunId) return false;
      if (senderAccountId && row.senderAccountId !== senderAccountId) return false;
      if (fromEmail && row.fromEmail !== fromEmail) return false;
      if (statuses.length && !statuses.includes(row.status)) return false;
      return true;
    })
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
}

export async function createDeliverabilitySeedReservations(input: {
  probeRunId: string;
  runId: string;
  brandId: string;
  senderAccountId: string;
  fromEmail: string;
  probeVariant: DeliverabilityProbeVariant;
  contentHash: string;
  probeToken: string;
  targets: DeliverabilityProbeTarget[];
}): Promise<DeliverabilitySeedReservation[]> {
  const now = nowIso();
  const rows: DeliverabilitySeedReservation[] = input.targets.map((target) => ({
    id: createId("seedres"),
    probeRunId: input.probeRunId,
    runId: input.runId,
    brandId: input.brandId,
    senderAccountId: input.senderAccountId,
    fromEmail: input.fromEmail.trim().toLowerCase(),
    monitorAccountId: target.accountId.trim(),
    monitorEmail: target.email.trim().toLowerCase(),
    probeVariant: input.probeVariant,
    contentHash: input.contentHash.trim(),
    probeToken: input.probeToken.trim(),
    status: "reserved",
    providerMessageId: "",
    releasedReason: "",
    reservedAt: now,
    consumedAt: "",
    releasedAt: "",
    createdAt: now,
    updatedAt: now,
  }));
  if (!rows.length) return [];

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const payload = rows.map((row) => ({
      id: row.id,
      probe_run_id: row.probeRunId,
      run_id: row.runId,
      brand_id: row.brandId,
      sender_account_id: row.senderAccountId,
      from_email: row.fromEmail,
      monitor_account_id: row.monitorAccountId,
      monitor_email: row.monitorEmail,
      probe_variant: row.probeVariant,
      content_hash: row.contentHash,
      probe_token: row.probeToken,
      status: row.status,
      provider_message_id: row.providerMessageId,
      released_reason: row.releasedReason,
      reserved_at: row.reservedAt,
      consumed_at: null,
      released_at: null,
    }));
    const { data, error } = await supabase
      .from(TABLE_DELIVERABILITY_SEED_RESERVATION)
      .insert(payload)
      .select("*");
    if (!error) {
      return (data ?? []).map((row: unknown) => mapDeliverabilitySeedReservationRow(row));
    }
  }

  const store = await readLocalStore();
  store.deliverabilitySeedReservations.unshift(...rows);
  await writeLocalStore(store);
  return rows;
}

export async function updateDeliverabilitySeedReservations(
  reservationIds: string[],
  patch: Partial<Pick<DeliverabilitySeedReservation, "status" | "providerMessageId" | "releasedReason" | "consumedAt" | "releasedAt">>
): Promise<DeliverabilitySeedReservation[]> {
  const ids = reservationIds.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (!ids.length) return [];
  const now = nowIso();

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.providerMessageId !== undefined) update.provider_message_id = patch.providerMessageId;
    if (patch.releasedReason !== undefined) update.released_reason = patch.releasedReason;
    if (patch.consumedAt !== undefined) update.consumed_at = patch.consumedAt || null;
    if (patch.releasedAt !== undefined) update.released_at = patch.releasedAt || null;

    const { data, error } = await supabase
      .from(TABLE_DELIVERABILITY_SEED_RESERVATION)
      .update(update)
      .in("id", ids)
      .select("*");
    if (!error) {
      return (data ?? []).map((row: unknown) => mapDeliverabilitySeedReservationRow(row));
    }
  }

  const store = await readLocalStore();
  const updated: DeliverabilitySeedReservation[] = [];
  for (let index = 0; index < store.deliverabilitySeedReservations.length; index += 1) {
    const row = store.deliverabilitySeedReservations[index];
    if (!ids.includes(row.id)) continue;
    const next: DeliverabilitySeedReservation = {
      ...row,
      ...patch,
      updatedAt: now,
    };
    store.deliverabilitySeedReservations[index] = next;
    updated.push(next);
  }
  if (updated.length) {
    await writeLocalStore(store);
  }
  return updated;
}

export async function listWarmupSeedReservations(input?: {
  brandId?: string;
  runId?: string;
  senderAccountId?: string;
  fromEmail?: string;
  monitorAccountId?: string;
  monitorEmail?: string;
  statuses?: WarmupSeedReservationStatus[];
}): Promise<WarmupSeedReservation[]> {
  const brandId = String(input?.brandId ?? "").trim();
  const runId = String(input?.runId ?? "").trim();
  const senderAccountId = String(input?.senderAccountId ?? "").trim();
  const fromEmail = String(input?.fromEmail ?? "").trim().toLowerCase();
  const monitorAccountId = String(input?.monitorAccountId ?? "").trim();
  const monitorEmail = String(input?.monitorEmail ?? "").trim().toLowerCase();
  const statuses = (input?.statuses ?? []).filter(Boolean);

  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase
      .from(TABLE_WARMUP_SEED_RESERVATION)
      .select("*")
      .order("created_at", { ascending: false });
    if (brandId) query = query.eq("brand_id", brandId);
    if (runId) query = query.eq("run_id", runId);
    if (senderAccountId) query = query.eq("sender_account_id", senderAccountId);
    if (fromEmail) query = query.eq("from_email", fromEmail);
    if (monitorAccountId) query = query.eq("monitor_account_id", monitorAccountId);
    if (monitorEmail) query = query.eq("monitor_email", monitorEmail);
    if (statuses.length) query = query.in("status", statuses);
    const { data, error } = await query;
    if (!error) {
      return (data ?? []).map((row: unknown) => mapWarmupSeedReservationRow(row));
    }
  }

  const store = await readLocalStore();
  return store.warmupSeedReservations
    .filter((row) => {
      if (brandId && row.brandId !== brandId) return false;
      if (runId && row.runId !== runId) return false;
      if (senderAccountId && row.senderAccountId !== senderAccountId) return false;
      if (fromEmail && row.fromEmail !== fromEmail) return false;
      if (monitorAccountId && row.monitorAccountId !== monitorAccountId) return false;
      if (monitorEmail && row.monitorEmail !== monitorEmail) return false;
      if (statuses.length && !statuses.includes(row.status)) return false;
      return true;
    })
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
}

export async function createWarmupSeedReservations(input: {
  runId: string;
  brandId: string;
  senderAccountId: string;
  fromEmail: string;
  targets: DeliverabilityProbeTarget[];
}): Promise<WarmupSeedReservation[]> {
  const now = nowIso();
  const rows: WarmupSeedReservation[] = input.targets.map((target) => ({
    id: createId("warmseed"),
    runId: input.runId,
    brandId: input.brandId,
    senderAccountId: input.senderAccountId.trim(),
    fromEmail: input.fromEmail.trim().toLowerCase(),
    monitorAccountId: target.accountId.trim(),
    monitorEmail: target.email.trim().toLowerCase(),
    status: "reserved",
    providerMessageId: "",
    releasedReason: "",
    reservedAt: now,
    consumedAt: "",
    releasedAt: "",
    createdAt: now,
    updatedAt: now,
  }));
  if (!rows.length) return [];

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const inserted: WarmupSeedReservation[] = [];
    for (const row of rows) {
      const payload = {
        id: row.id,
        run_id: row.runId,
        brand_id: row.brandId,
        sender_account_id: row.senderAccountId,
        from_email: row.fromEmail,
        monitor_account_id: row.monitorAccountId,
        monitor_email: row.monitorEmail,
        status: row.status,
        provider_message_id: row.providerMessageId,
        released_reason: row.releasedReason,
        reserved_at: row.reservedAt,
        consumed_at: null,
        released_at: null,
      };
      const { data, error } = await supabase
        .from(TABLE_WARMUP_SEED_RESERVATION)
        .insert(payload)
        .select("*");
      if (!error) {
        const hit = Array.isArray(data) ? data[0] : data;
        if (hit) {
          inserted.push(mapWarmupSeedReservationRow(hit));
        }
        continue;
      }
      if (isUniqueViolationError(error)) {
        continue;
      }
      throw error;
    }
    return inserted;
  }

  const store = await readLocalStore();
  const existingReservedByMonitorId = new Set(
    store.warmupSeedReservations
      .filter((row) => row.status === "reserved")
      .map((row) => row.monitorAccountId)
  );
  const inserted: WarmupSeedReservation[] = [];
  for (const row of rows) {
    if (existingReservedByMonitorId.has(row.monitorAccountId)) {
      continue;
    }
    store.warmupSeedReservations.unshift(row);
    existingReservedByMonitorId.add(row.monitorAccountId);
    inserted.push(row);
  }
  if (inserted.length) {
    await writeLocalStore(store);
  }
  return inserted;
}

export async function updateWarmupSeedReservations(
  reservationIds: string[],
  patch: Partial<Pick<WarmupSeedReservation, "status" | "providerMessageId" | "releasedReason" | "consumedAt" | "releasedAt">>
): Promise<WarmupSeedReservation[]> {
  const ids = reservationIds.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (!ids.length) return [];
  const now = nowIso();

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.providerMessageId !== undefined) update.provider_message_id = patch.providerMessageId;
    if (patch.releasedReason !== undefined) update.released_reason = patch.releasedReason;
    if (patch.consumedAt !== undefined) update.consumed_at = patch.consumedAt || null;
    if (patch.releasedAt !== undefined) update.released_at = patch.releasedAt || null;

    const { data, error } = await supabase
      .from(TABLE_WARMUP_SEED_RESERVATION)
      .update(update)
      .in("id", ids)
      .select("*");
    if (!error) {
      return (data ?? []).map((row: unknown) => mapWarmupSeedReservationRow(row));
    }
  }

  const store = await readLocalStore();
  const updated: WarmupSeedReservation[] = [];
  for (let index = 0; index < store.warmupSeedReservations.length; index += 1) {
    const row = store.warmupSeedReservations[index];
    if (!ids.includes(row.id)) continue;
    const next: WarmupSeedReservation = {
      ...row,
      ...patch,
      updatedAt: now,
    };
    store.warmupSeedReservations[index] = next;
    updated.push(next);
  }
  if (updated.length) {
    await writeLocalStore(store);
  }
  return updated;
}
export async function updateRunAnomalies(
  anomalyIds: string[],
  patch: Partial<Pick<RunAnomaly, "severity" | "status" | "threshold" | "observed" | "details">>
): Promise<RunAnomaly[]> {
  const ids = Array.from(new Set(anomalyIds.map((item) => String(item ?? "").trim()).filter(Boolean)));
  if (!ids.length) return [];

  const now = nowIso();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const update: Record<string, unknown> = { updated_at: now };
    if (patch.severity !== undefined) update.severity = patch.severity;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.threshold !== undefined) update.threshold = patch.threshold;
    if (patch.observed !== undefined) update.observed = patch.observed;
    if (patch.details !== undefined) update.details = patch.details;

    const { data, error } = await supabase
      .from(TABLE_ANOMALY)
      .update(update)
      .in("id", ids)
      .select("*");
    if (!error) {
      return (data ?? []).map((row: unknown) => mapAnomalyRow(row));
    }
  }

  const store = await readLocalStore();
  const updated: RunAnomaly[] = [];
  for (let index = 0; index < store.anomalies.length; index += 1) {
    const row = store.anomalies[index];
    if (!ids.includes(row.id)) continue;
    const next: RunAnomaly = {
      ...row,
      ...patch,
      updatedAt: now,
    };
    store.anomalies[index] = next;
    updated.push(next);
  }
  if (updated.length) {
    await writeLocalStore(store);
  }
  return updated;
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
    const { data: existing, error: existingError } = await supabase
      .from(TABLE_ANOMALY)
      .select("*")
      .eq("run_id", anomaly.runId)
      .eq("type", anomaly.type)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    if (!existingError && existing?.length) {
      const mapped = existing.map((row: unknown) => mapAnomalyRow(row));
      const [primary, ...duplicates] = mapped;
      const updated = await updateRunAnomalies([primary.id], {
        severity: anomaly.severity,
        status: "active",
        threshold: anomaly.threshold,
        observed: anomaly.observed,
        details: anomaly.details,
      });
      if (duplicates.length) {
        await updateRunAnomalies(
          duplicates.map((row) => row.id),
          {
            status: "resolved",
          }
        );
      }
      return updated[0] ?? primary;
    }

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
  const activeMatches = store.anomalies
    .filter((row) => row.runId === anomaly.runId && row.type === anomaly.type && row.status === "active")
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));
  if (activeMatches.length) {
    const [primary, ...duplicates] = activeMatches;
    const next: RunAnomaly = {
      ...primary,
      severity: anomaly.severity,
      status: "active",
      threshold: anomaly.threshold,
      observed: anomaly.observed,
      details: anomaly.details,
      updatedAt: now,
    };
    const primaryIndex = store.anomalies.findIndex((row) => row.id === primary.id);
    if (primaryIndex >= 0) {
      store.anomalies[primaryIndex] = next;
    }
    for (const duplicate of duplicates) {
      const duplicateIndex = store.anomalies.findIndex((row) => row.id === duplicate.id);
      if (duplicateIndex >= 0) {
        store.anomalies[duplicateIndex] = {
          ...store.anomalies[duplicateIndex],
          status: "resolved",
          updatedAt: now,
        };
      }
    }
    await writeLocalStore(store);
    return next;
  }

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

export async function listRunIdsForAnomalyStatuses(
  statuses: RunAnomaly["status"][]
): Promise<string[]> {
  const normalizedStatuses = Array.from(
    new Set(statuses.map((status) => String(status ?? "").trim()).filter(Boolean))
  ) as RunAnomaly["status"][];
  if (!normalizedStatuses.length) return [];

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_ANOMALY)
      .select("run_id")
      .in("status", normalizedStatuses);
    if (!error) {
      return Array.from(
        new Set((data ?? []).map((row: { run_id?: string | null }) => String(row.run_id ?? "").trim()).filter(Boolean))
      );
    }
  }

  const store = await readLocalStore();
  return Array.from(
    new Set(
      store.anomalies
        .filter((row) => normalizedStatuses.includes(row.status))
        .map((row) => row.runId)
        .filter(Boolean)
    )
  );
}

export async function upsertSourcingActorProfiles(
  profiles: Array<{
    actorId: string;
    stageHints: Array<"prospect_discovery" | "website_enrichment" | "email_discovery">;
    schemaSummary?: Record<string, unknown>;
    compatibilityScore?: number;
    lastSeenMetadata?: Record<string, unknown>;
  }>
): Promise<ActorCapabilityProfile[]> {
  const now = nowIso();
  const sanitized = profiles
    .map((row) => ({
      actorId: String(row.actorId ?? "").trim(),
      stageHints: Array.from(new Set((row.stageHints ?? []).filter(Boolean))),
      schemaSummary: row.schemaSummary ?? {},
      compatibilityScore: Number(row.compatibilityScore ?? 0) || 0,
      lastSeenMetadata: row.lastSeenMetadata ?? {},
    }))
    .filter((row) => row.actorId);
  if (!sanitized.length) return [];

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const rows = sanitized.map((row) => ({
      actor_id: row.actorId,
      stage_hints: row.stageHints,
      schema_summary: row.schemaSummary,
      compatibility_score: row.compatibilityScore,
      last_seen_metadata: row.lastSeenMetadata,
      updated_at: now,
    }));
    const { data, error } = await supabase
      .from(TABLE_SOURCING_ACTOR_PROFILE)
      .upsert(rows, { onConflict: "actor_id" })
      .select("*");
    if (!error) {
      return (data ?? []).map((row: unknown) => mapSourcingActorProfileRow(row));
    }
  }

  const store = await readLocalStore();
  for (const row of sanitized) {
    const index = store.sourcingActorProfiles.findIndex((item) => item.actorId === row.actorId);
    const next: ActorCapabilityProfile = {
      actorId: row.actorId,
      stageHints: row.stageHints as ActorCapabilityProfile["stageHints"],
      schemaSummary: row.schemaSummary,
      compatibilityScore: row.compatibilityScore,
      lastSeenMetadata: row.lastSeenMetadata,
      createdAt: index >= 0 ? store.sourcingActorProfiles[index].createdAt : now,
      updatedAt: now,
    };
    if (index >= 0) store.sourcingActorProfiles[index] = next;
    else store.sourcingActorProfiles.unshift(next);
  }
  await writeLocalStore(store);
  return store.sourcingActorProfiles;
}

export async function listSourcingActorProfiles(actorIds?: string[]): Promise<ActorCapabilityProfile[]> {
  const ids = (actorIds ?? []).map((row) => String(row ?? "").trim()).filter(Boolean);
  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase
      .from(TABLE_SOURCING_ACTOR_PROFILE)
      .select("*")
      .order("updated_at", { ascending: false });
    if (ids.length) query = query.in("actor_id", ids);
    const { data, error } = await query;
    if (!error) {
      return (data ?? []).map((row: unknown) => mapSourcingActorProfileRow(row));
    }
  }

  const store = await readLocalStore();
  const filtered = ids.length
    ? store.sourcingActorProfiles.filter((row) => ids.includes(row.actorId))
    : store.sourcingActorProfiles;
  return [...filtered].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function upsertSourcingActorMemory(
  updates: Array<{
    actorId: string;
    successDelta?: number;
    failDelta?: number;
    compatibilityFailDelta?: number;
    leadsAcceptedDelta?: number;
    leadsRejectedDelta?: number;
    qualitySample?: number;
  }>
): Promise<SourcingActorMemory[]> {
  if (!updates.length) return [];
  const now = nowIso();
  const byActor = new Map<string, (typeof updates)[number]>();
  for (const row of updates) {
    const actorId = String(row.actorId ?? "").trim();
    if (!actorId) continue;
    const existing = byActor.get(actorId);
    if (existing) {
      existing.successDelta = (existing.successDelta ?? 0) + (row.successDelta ?? 0);
      existing.failDelta = (existing.failDelta ?? 0) + (row.failDelta ?? 0);
      existing.compatibilityFailDelta =
        (existing.compatibilityFailDelta ?? 0) + (row.compatibilityFailDelta ?? 0);
      existing.leadsAcceptedDelta = (existing.leadsAcceptedDelta ?? 0) + (row.leadsAcceptedDelta ?? 0);
      existing.leadsRejectedDelta = (existing.leadsRejectedDelta ?? 0) + (row.leadsRejectedDelta ?? 0);
      if (row.qualitySample !== undefined) existing.qualitySample = row.qualitySample;
      continue;
    }
    byActor.set(actorId, { ...row, actorId });
  }
  const merged = Array.from(byActor.values());

  const existing = await getSourcingActorMemory(merged.map((row) => row.actorId));
  const existingById = new Map(existing.map((row) => [row.actorId, row]));

  const nextRows = merged.map((row) => {
    const prev = existingById.get(row.actorId);
    const successCount = Math.max(0, (prev?.successCount ?? 0) + (row.successDelta ?? 0));
    const failCount = Math.max(0, (prev?.failCount ?? 0) + (row.failDelta ?? 0));
    const compatibilityFailCount = Math.max(
      0,
      (prev?.compatibilityFailCount ?? 0) + (row.compatibilityFailDelta ?? 0)
    );
    const leadsAccepted = Math.max(0, (prev?.leadsAccepted ?? 0) + (row.leadsAcceptedDelta ?? 0));
    const leadsRejected = Math.max(0, (prev?.leadsRejected ?? 0) + (row.leadsRejectedDelta ?? 0));
    const qualityValue = Math.max(0, Math.min(1, Number(row.qualitySample ?? prev?.avgQuality ?? 0) || 0));
    const samples = Math.max(1, successCount + failCount);
    const avgQuality = prev ? ((prev.avgQuality * (samples - 1) + qualityValue) / samples) : qualityValue;
    return {
      actorId: row.actorId,
      successCount,
      failCount,
      compatibilityFailCount,
      leadsAccepted,
      leadsRejected,
      avgQuality,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    } satisfies SourcingActorMemory;
  });

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const payload = nextRows.map((row) => ({
      actor_id: row.actorId,
      success_count: row.successCount,
      fail_count: row.failCount,
      compatibility_fail_count: row.compatibilityFailCount,
      leads_accepted: row.leadsAccepted,
      leads_rejected: row.leadsRejected,
      avg_quality: row.avgQuality,
      updated_at: now,
    }));
    const { data, error } = await supabase
      .from(TABLE_SOURCING_ACTOR_MEMORY)
      .upsert(payload, { onConflict: "actor_id" })
      .select("*");
    if (!error) {
      return (data ?? []).map((row: unknown) => mapSourcingActorMemoryRow(row));
    }
  }

  const store = await readLocalStore();
  for (const row of nextRows) {
    const index = store.sourcingActorMemory.findIndex((item) => item.actorId === row.actorId);
    if (index >= 0) store.sourcingActorMemory[index] = row;
    else store.sourcingActorMemory.unshift(row);
  }
  await writeLocalStore(store);
  return nextRows;
}

export async function getSourcingActorMemory(actorIds: string[]): Promise<SourcingActorMemory[]> {
  const ids = actorIds.map((row) => String(row ?? "").trim()).filter(Boolean);
  if (!ids.length) return [];

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SOURCING_ACTOR_MEMORY)
      .select("*")
      .in("actor_id", ids);
    if (!error) {
      return (data ?? []).map((row: unknown) => mapSourcingActorMemoryRow(row));
    }
  }

  const store = await readLocalStore();
  return store.sourcingActorMemory.filter((row) => ids.includes(row.actorId));
}

export async function createSourcingChainDecision(input: {
  brandId: string;
  experimentOwnerId: string;
  runtimeCampaignId: string;
  runtimeExperimentId: string;
  runId: string;
  strategy: string;
  rationale: string;
  budgetUsedUsd: number;
  qualityPolicy: LeadQualityPolicy;
  selectedChain: SourcingChainStep[];
  probeSummary?: Record<string, unknown>;
}): Promise<SourcingChainDecision> {
  const now = nowIso();
  const decision: SourcingChainDecision = {
    id: createId("srcdec"),
    brandId: input.brandId,
    experimentOwnerId: input.experimentOwnerId,
    runtimeCampaignId: input.runtimeCampaignId,
    runtimeExperimentId: input.runtimeExperimentId,
    runId: input.runId,
    strategy: input.strategy,
    rationale: input.rationale,
    budgetUsedUsd: Math.max(0, Number(input.budgetUsedUsd ?? 0) || 0),
    qualityPolicy: input.qualityPolicy,
    selectedChain: input.selectedChain,
    probeSummary: input.probeSummary ?? {},
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SOURCING_CHAIN_DECISION)
      .insert({
        id: decision.id,
        brand_id: decision.brandId,
        experiment_owner_id: decision.experimentOwnerId,
        runtime_campaign_id: decision.runtimeCampaignId,
        runtime_experiment_id: decision.runtimeExperimentId,
        run_id: decision.runId || null,
        strategy: decision.strategy,
        rationale: decision.rationale,
        budget_used_usd: decision.budgetUsedUsd,
        quality_policy: decision.qualityPolicy,
        selected_chain: decision.selectedChain,
        probe_summary: decision.probeSummary,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapSourcingChainDecisionRow(data);
    }
  }

  const store = await readLocalStore();
  store.sourcingChainDecisions.unshift(decision);
  await writeLocalStore(store);
  return decision;
}

export async function listSourcingChainDecisions(input: {
  brandId: string;
  experimentOwnerId: string;
  limit?: number;
}): Promise<SourcingChainDecision[]> {
  const limit = Math.max(1, Math.min(50, Number(input.limit ?? 10) || 10));
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SOURCING_CHAIN_DECISION)
      .select("*")
      .eq("brand_id", input.brandId)
      .eq("experiment_owner_id", input.experimentOwnerId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!error) {
      return (data ?? []).map((row: unknown) => mapSourcingChainDecisionRow(row));
    }
  }

  const store = await readLocalStore();
  return store.sourcingChainDecisions
    .filter((row) => row.brandId === input.brandId && row.experimentOwnerId === input.experimentOwnerId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

export async function updateSourcingChainDecision(
  decisionId: string,
  patch: Partial<
    Pick<
      SourcingChainDecision,
      "strategy" | "rationale" | "budgetUsedUsd" | "qualityPolicy" | "selectedChain" | "probeSummary"
    >
  >
): Promise<SourcingChainDecision | null> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const payload: Record<string, unknown> = {};
    if (patch.strategy !== undefined) payload.strategy = patch.strategy;
    if (patch.rationale !== undefined) payload.rationale = patch.rationale;
    if (patch.budgetUsedUsd !== undefined) payload.budget_used_usd = patch.budgetUsedUsd;
    if (patch.qualityPolicy !== undefined) payload.quality_policy = patch.qualityPolicy;
    if (patch.selectedChain !== undefined) payload.selected_chain = patch.selectedChain;
    if (patch.probeSummary !== undefined) payload.probe_summary = patch.probeSummary;
    if (Object.keys(payload).length) {
      const { data, error } = await supabase
        .from(TABLE_SOURCING_CHAIN_DECISION)
        .update(payload)
        .eq("id", decisionId)
        .select("*")
        .maybeSingle();
      if (!error && data) {
        return mapSourcingChainDecisionRow(data);
      }
    }
    const { data, error } = await supabase
      .from(TABLE_SOURCING_CHAIN_DECISION)
      .select("*")
      .eq("id", decisionId)
      .maybeSingle();
    if (!error && data) {
      return mapSourcingChainDecisionRow(data);
    }
    return null;
  }

  const store = await readLocalStore();
  const index = store.sourcingChainDecisions.findIndex((row) => row.id === decisionId);
  if (index < 0) return null;
  const existing = store.sourcingChainDecisions[index];
  const updated: SourcingChainDecision = {
    ...existing,
    strategy: patch.strategy ?? existing.strategy,
    rationale: patch.rationale ?? existing.rationale,
    budgetUsedUsd: patch.budgetUsedUsd ?? existing.budgetUsedUsd,
    qualityPolicy: patch.qualityPolicy ?? existing.qualityPolicy,
    selectedChain: patch.selectedChain ?? existing.selectedChain,
    probeSummary: patch.probeSummary ?? existing.probeSummary,
    updatedAt: nowIso(),
  };
  store.sourcingChainDecisions[index] = updated;
  await writeLocalStore(store);
  return updated;
}

export async function createSourcingProbeResults(
  rows: Array<{
    decisionId: string;
    brandId: string;
    experimentOwnerId: string;
    runId: string;
    stepIndex: number;
    actorId: string;
    stage: SourcingProbeResult["stage"];
    probeInputHash: string;
    outcome: SourcingProbeResult["outcome"];
    qualityMetrics?: Record<string, unknown>;
    costEstimateUsd?: number;
    details?: Record<string, unknown>;
  }>
): Promise<SourcingProbeResult[]> {
  if (!rows.length) return [];
  const now = nowIso();
  const probeRows: SourcingProbeResult[] = rows.map((row) => ({
    id: createId("srcprobe"),
    decisionId: row.decisionId,
    brandId: row.brandId,
    experimentOwnerId: row.experimentOwnerId,
    runId: row.runId,
    stepIndex: Math.max(0, Number(row.stepIndex ?? 0) || 0),
    actorId: String(row.actorId ?? "").trim(),
    stage: row.stage,
    probeInputHash: String(row.probeInputHash ?? "").trim(),
    outcome: row.outcome,
    qualityMetrics: row.qualityMetrics ?? {},
    costEstimateUsd: Math.max(0, Number(row.costEstimateUsd ?? 0) || 0),
    details: row.details ?? {},
    createdAt: now,
  }));

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const payload = probeRows.map((row) => ({
      id: row.id,
      decision_id: row.decisionId,
      brand_id: row.brandId,
      experiment_owner_id: row.experimentOwnerId,
      run_id: row.runId || null,
      step_index: row.stepIndex,
      actor_id: row.actorId,
      stage: row.stage,
      probe_input_hash: row.probeInputHash,
      outcome: row.outcome,
      quality_metrics: row.qualityMetrics,
      cost_estimate_usd: row.costEstimateUsd,
      details: row.details,
    }));
    const { data, error } = await supabase
      .from(TABLE_SOURCING_PROBE_RESULT)
      .insert(payload)
      .select("*");
    if (!error) {
      return (data ?? []).map((row: unknown) => mapSourcingProbeResultRow(row));
    }
  }

  const store = await readLocalStore();
  store.sourcingProbeResults = [...probeRows, ...store.sourcingProbeResults];
  await writeLocalStore(store);
  return probeRows;
}

export async function listSourcingProbeResults(decisionId: string): Promise<SourcingProbeResult[]> {
  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SOURCING_PROBE_RESULT)
      .select("*")
      .eq("decision_id", decisionId)
      .order("created_at", { ascending: true });
    if (!error) {
      return (data ?? []).map((row: unknown) => mapSourcingProbeResultRow(row));
    }
  }

  const store = await readLocalStore();
  return store.sourcingProbeResults
    .filter((row) => row.decisionId === decisionId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function listSenderLaunches(
  input: { brandId?: string; senderAccountId?: string } = {},
  options: { allowMissingTable?: boolean } = {}
): Promise<SenderLaunch[]> {
  const brandId = String(input.brandId ?? "").trim();
  const senderAccountId = String(input.senderAccountId ?? "").trim();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase.from(TABLE_SENDER_LAUNCH).select("*").order("updated_at", { ascending: false });
    if (brandId) query = query.eq("brand_id", brandId);
    if (senderAccountId) query = query.eq("sender_account_id", senderAccountId);
    const { data, error } = await query;
    if (!error) {
      return (data ?? []).map((row: unknown) => mapSenderLaunchRow(row));
    }
    if (options.allowMissingTable && isMissingRelationError(error, TABLE_SENDER_LAUNCH)) {
      return [];
    }
    if (isVercel) {
      throw new OutreachDataError("Failed to load sender launches from Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "listSenderLaunches",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          brandId,
          senderAccountId,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  return store.senderLaunches
    .filter((row) => (!brandId || row.brandId === brandId) && (!senderAccountId || row.senderAccountId === senderAccountId))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getSenderLaunch(
  brandId: string,
  senderAccountId: string,
  options: { allowMissingTable?: boolean } = {}
): Promise<SenderLaunch | null> {
  const normalizedBrandId = brandId.trim();
  const normalizedSenderAccountId = senderAccountId.trim();
  if (!normalizedBrandId || !normalizedSenderAccountId) return null;

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SENDER_LAUNCH)
      .select("*")
      .eq("brand_id", normalizedBrandId)
      .eq("sender_account_id", normalizedSenderAccountId)
      .maybeSingle();
    if (!error) {
      return data ? mapSenderLaunchRow(data) : null;
    }
    if (options.allowMissingTable && isMissingRelationError(error, TABLE_SENDER_LAUNCH)) {
      return null;
    }
    if (isVercel) {
      throw new OutreachDataError("Failed to load sender launch from Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "getSenderLaunch",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          brandId: normalizedBrandId,
          senderAccountId: normalizedSenderAccountId,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  return (
    store.senderLaunches.find(
      (row) => row.brandId === normalizedBrandId && row.senderAccountId === normalizedSenderAccountId
    ) ?? null
  );
}

export async function upsertSenderLaunch(
  input: Omit<SenderLaunch, "id" | "createdAt" | "updatedAt"> & { id?: string; createdAt?: string; updatedAt?: string },
  options: { allowMissingTable?: boolean } = {}
): Promise<SenderLaunch> {
  const existing = await getSenderLaunch(input.brandId, input.senderAccountId, options);
  const now = nowIso();
  const launch: SenderLaunch = {
    id: existing?.id ?? input.id ?? createId("launch"),
    senderAccountId: input.senderAccountId.trim(),
    brandId: input.brandId.trim(),
    fromEmail: input.fromEmail.trim().toLowerCase(),
    domain: input.domain.trim().toLowerCase(),
    planType: input.planType,
    state: input.state,
    readinessScore: Math.max(0, Math.min(100, Math.round(Number(input.readinessScore ?? 0) || 0))),
    summary: input.summary.trim(),
    nextStep: input.nextStep.trim(),
    topicSummary: input.topicSummary.trim(),
    topicKeywords: input.topicKeywords.map((entry) => String(entry ?? "").trim().toLowerCase()).filter(Boolean),
    sourceExperimentIds: input.sourceExperimentIds.map((entry) => String(entry ?? "").trim()).filter(Boolean),
    infraScore: Math.max(0, Math.min(30, Math.round(Number(input.infraScore ?? 0) || 0))),
    reputationScore: Math.max(0, Math.min(25, Math.round(Number(input.reputationScore ?? 0) || 0))),
    trustScore: Math.max(0, Math.min(20, Math.round(Number(input.trustScore ?? 0) || 0))),
    safetyScore: Math.max(0, Math.min(15, Math.round(Number(input.safetyScore ?? 0) || 0))),
    topicScore: Math.max(0, Math.min(10, Math.round(Number(input.topicScore ?? 0) || 0))),
    dailyCap: Math.max(0, Math.round(Number(input.dailyCap ?? 0) || 0)),
    sentCount: Math.max(0, Math.round(Number(input.sentCount ?? 0) || 0)),
    repliedCount: Math.max(0, Math.round(Number(input.repliedCount ?? 0) || 0)),
    bouncedCount: Math.max(0, Math.round(Number(input.bouncedCount ?? 0) || 0)),
    failedCount: Math.max(0, Math.round(Number(input.failedCount ?? 0) || 0)),
    inboxRate: clampZeroOne(input.inboxRate, 0),
    spamRate: clampZeroOne(input.spamRate, 0),
    trustEventCount: Math.max(0, Math.round(Number(input.trustEventCount ?? 0) || 0)),
    pausedUntil: String(input.pausedUntil ?? "").trim(),
    pauseReason: String(input.pauseReason ?? "").trim(),
    lastEventAt: String(input.lastEventAt ?? "").trim(),
    lastEvaluatedAt: String(input.lastEvaluatedAt ?? "").trim() || now,
    autopilotMode: input.autopilotMode === "curated_only" ? "curated_only" : "curated_plus_open_web",
    autopilotAllowedDomains: input.autopilotAllowedDomains
      .map((entry) => String(entry ?? "").trim().toLowerCase())
      .filter(Boolean),
    autopilotBlockedDomains: input.autopilotBlockedDomains
      .map((entry) => String(entry ?? "").trim().toLowerCase())
      .filter(Boolean),
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    let payload: Record<string, unknown> = {
      id: launch.id,
      sender_account_id: launch.senderAccountId,
      brand_id: launch.brandId,
      from_email: launch.fromEmail,
      domain: launch.domain,
      plan_type: launch.planType,
      state: launch.state,
      readiness_score: launch.readinessScore,
      summary: launch.summary,
      next_step: launch.nextStep,
      topic_summary: launch.topicSummary,
      topic_keywords: launch.topicKeywords,
      source_experiment_ids: launch.sourceExperimentIds,
      infra_score: launch.infraScore,
      reputation_score: launch.reputationScore,
      trust_score: launch.trustScore,
      safety_score: launch.safetyScore,
      topic_score: launch.topicScore,
      daily_cap: launch.dailyCap,
      sent_count: launch.sentCount,
      replied_count: launch.repliedCount,
      bounced_count: launch.bouncedCount,
      failed_count: launch.failedCount,
      inbox_rate: launch.inboxRate,
      spam_rate: launch.spamRate,
      trust_event_count: launch.trustEventCount,
      paused_until: launch.pausedUntil || null,
      pause_reason: launch.pauseReason,
      last_event_at: launch.lastEventAt || null,
      last_evaluated_at: launch.lastEvaluatedAt || null,
      autopilot_mode: launch.autopilotMode,
      autopilot_allowed_domains: launch.autopilotAllowedDomains,
      autopilot_blocked_domains: launch.autopilotBlockedDomains,
      created_at: launch.createdAt,
      updated_at: launch.updatedAt,
    };
    const optionalColumns = new Set([
      "autopilot_mode",
      "autopilot_allowed_domains",
      "autopilot_blocked_domains",
    ]);
    let lastError: unknown = null;
    while (true) {
      const query = existing
        ? supabase.from(TABLE_SENDER_LAUNCH).update(payload).eq("id", existing.id).select("*").single()
        : supabase.from(TABLE_SENDER_LAUNCH).insert(payload).select("*").single();
      const { data, error } = await query;
      if (!error && data) {
        return mapSenderLaunchRow(data);
      }
      lastError = error;
      const missingColumn = missingColumnNameFromError(error);
      if (missingColumn && optionalColumns.has(missingColumn) && missingColumn in payload) {
        const nextPayload = { ...payload };
        delete nextPayload[missingColumn];
        payload = nextPayload;
        continue;
      }
      break;
    }
    if (!(options.allowMissingTable && isMissingRelationError(lastError, TABLE_SENDER_LAUNCH)) && isVercel) {
      throw new OutreachDataError("Failed to save sender launch in Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(lastError),
        debug: {
          operation: "upsertSenderLaunch",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          brandId: launch.brandId,
          senderAccountId: launch.senderAccountId,
          supabaseError: supabaseErrorDebug(lastError),
        },
      });
    }
  }

  const store = await readLocalStore();
  const index = store.senderLaunches.findIndex(
    (row) => row.brandId === launch.brandId && row.senderAccountId === launch.senderAccountId
  );
  if (index >= 0) {
    store.senderLaunches[index] = launch;
  } else {
    store.senderLaunches.unshift(launch);
  }
  await writeLocalStore(store);
  return launch;
}

export async function listSenderLaunchEvents(
  input: { brandId?: string; senderAccountId?: string; senderLaunchId?: string; limit?: number } = {},
  options: { allowMissingTable?: boolean } = {}
): Promise<SenderLaunchEvent[]> {
  const brandId = String(input.brandId ?? "").trim();
  const senderAccountId = String(input.senderAccountId ?? "").trim();
  const senderLaunchId = String(input.senderLaunchId ?? "").trim();
  const limit = Math.max(1, Math.round(Number(input.limit ?? 50) || 50));
  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase
      .from(TABLE_SENDER_LAUNCH_EVENT)
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (brandId) query = query.eq("brand_id", brandId);
    if (senderAccountId) query = query.eq("sender_account_id", senderAccountId);
    if (senderLaunchId) query = query.eq("sender_launch_id", senderLaunchId);
    const { data, error } = await query;
    if (!error) {
      return (data ?? []).map((row: unknown) => mapSenderLaunchEventRow(row));
    }
    if (options.allowMissingTable && isMissingRelationError(error, TABLE_SENDER_LAUNCH_EVENT)) {
      return [];
    }
    if (isVercel) {
      throw new OutreachDataError("Failed to load sender launch events from Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "listSenderLaunchEvents",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          brandId,
          senderAccountId,
          senderLaunchId,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  return store.senderLaunchEvents
    .filter(
      (row) =>
        (!brandId || row.brandId === brandId) &&
        (!senderAccountId || row.senderAccountId === senderAccountId) &&
        (!senderLaunchId || row.senderLaunchId === senderLaunchId)
    )
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .slice(0, limit);
}

export async function createSenderLaunchEvent(
  input: Omit<SenderLaunchEvent, "id" | "createdAt"> & { id?: string; createdAt?: string },
  options: { allowMissingTable?: boolean } = {}
): Promise<SenderLaunchEvent> {
  const event: SenderLaunchEvent = {
    id: input.id ?? createId("launchevt"),
    senderLaunchId: input.senderLaunchId.trim(),
    senderAccountId: input.senderAccountId.trim(),
    brandId: input.brandId.trim(),
    eventType: input.eventType,
    title: input.title.trim(),
    detail: input.detail.trim(),
    metadata: input.metadata ?? {},
    occurredAt: String(input.occurredAt ?? "").trim() || nowIso(),
    createdAt: input.createdAt ?? nowIso(),
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SENDER_LAUNCH_EVENT)
      .insert({
        id: event.id,
        sender_launch_id: event.senderLaunchId,
        sender_account_id: event.senderAccountId,
        brand_id: event.brandId,
        event_type: event.eventType,
        title: event.title,
        detail: event.detail,
        metadata: event.metadata,
        occurred_at: event.occurredAt,
        created_at: event.createdAt,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapSenderLaunchEventRow(data);
    }
    if (!(options.allowMissingTable && isMissingRelationError(error, TABLE_SENDER_LAUNCH_EVENT)) && isVercel) {
      throw new OutreachDataError("Failed to save sender launch event in Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "createSenderLaunchEvent",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          senderLaunchId: event.senderLaunchId,
          senderAccountId: event.senderAccountId,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  store.senderLaunchEvents.unshift(event);
  await writeLocalStore(store);
  return event;
}

export async function listSenderLaunchActions(
  input: { brandId?: string; senderAccountId?: string; senderLaunchId?: string; status?: SenderLaunchAction["status"] } = {},
  options: { allowMissingTable?: boolean } = {}
): Promise<SenderLaunchAction[]> {
  const brandId = String(input.brandId ?? "").trim();
  const senderAccountId = String(input.senderAccountId ?? "").trim();
  const senderLaunchId = String(input.senderLaunchId ?? "").trim();
  const status = String(input.status ?? "").trim();
  const supabase = getSupabaseAdmin();
  if (supabase) {
    let query = supabase.from(TABLE_SENDER_LAUNCH_ACTION).select("*").order("updated_at", { ascending: false });
    if (brandId) query = query.eq("brand_id", brandId);
    if (senderAccountId) query = query.eq("sender_account_id", senderAccountId);
    if (senderLaunchId) query = query.eq("sender_launch_id", senderLaunchId);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (!error) {
      return (data ?? []).map((row: unknown) => mapSenderLaunchActionRow(row));
    }
    if (options.allowMissingTable && isMissingRelationError(error, TABLE_SENDER_LAUNCH_ACTION)) {
      return [];
    }
    if (isVercel) {
      throw new OutreachDataError("Failed to load sender launch actions from Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "listSenderLaunchActions",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          brandId,
          senderAccountId,
          senderLaunchId,
          status,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  return store.senderLaunchActions
    .filter(
      (row) =>
        (!brandId || row.brandId === brandId) &&
        (!senderAccountId || row.senderAccountId === senderAccountId) &&
        (!senderLaunchId || row.senderLaunchId === senderLaunchId) &&
        (!status || row.status === status)
    )
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function createSenderLaunchAction(
  input: Omit<SenderLaunchAction, "id" | "createdAt" | "updatedAt" | "completedAt"> & {
    id?: string;
    createdAt?: string;
    updatedAt?: string;
    completedAt?: string;
  },
  options: { allowMissingTable?: boolean } = {}
): Promise<SenderLaunchAction> {
  const now = nowIso();
  const action: SenderLaunchAction = {
    id: input.id ?? createId("launchact"),
    senderLaunchId: input.senderLaunchId.trim(),
    senderAccountId: input.senderAccountId.trim(),
    brandId: input.brandId.trim(),
    lane: input.lane,
    actionType: input.actionType,
    sourceKey: String(input.sourceKey ?? "").trim(),
    status: input.status,
    executeAfter: String(input.executeAfter ?? "").trim() || now,
    attempts: Math.max(0, Math.round(Number(input.attempts ?? 0) || 0)),
    maxAttempts: Math.max(1, Math.round(Number(input.maxAttempts ?? 5) || 5)),
    payload: input.payload ?? {},
    resultSummary: String(input.resultSummary ?? "").trim(),
    lastError: String(input.lastError ?? "").trim(),
    completedAt: String(input.completedAt ?? "").trim(),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SENDER_LAUNCH_ACTION)
      .insert({
        id: action.id,
        sender_launch_id: action.senderLaunchId,
        sender_account_id: action.senderAccountId,
        brand_id: action.brandId,
        lane: action.lane,
        action_type: action.actionType,
        source_key: action.sourceKey,
        status: action.status,
        execute_after: action.executeAfter,
        attempts: action.attempts,
        max_attempts: action.maxAttempts,
        payload: action.payload,
        result_summary: action.resultSummary,
        last_error: action.lastError,
        completed_at: action.completedAt || null,
        created_at: action.createdAt,
        updated_at: action.updatedAt,
      })
      .select("*")
      .single();
    if (!error && data) {
      return mapSenderLaunchActionRow(data);
    }
    if (!(options.allowMissingTable && isMissingRelationError(error, TABLE_SENDER_LAUNCH_ACTION)) && isVercel) {
      throw new OutreachDataError("Failed to save sender launch action in Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "createSenderLaunchAction",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          senderLaunchId: action.senderLaunchId,
          senderAccountId: action.senderAccountId,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  store.senderLaunchActions.unshift(action);
  await writeLocalStore(store);
  return action;
}

export async function updateSenderLaunchAction(
  actionId: string,
  patch: Partial<Pick<SenderLaunchAction, "status" | "executeAfter" | "attempts" | "maxAttempts" | "payload" | "resultSummary" | "lastError" | "completedAt">>,
  options: { allowMissingTable?: boolean } = {}
): Promise<SenderLaunchAction | null> {
  const normalizedActionId = actionId.trim();
  if (!normalizedActionId) return null;
  const existingActions = await listSenderLaunchActions({}, options);
  const existing = existingActions.find((row) => row.id === normalizedActionId) ?? null;
  if (!existing) return null;
  const now = nowIso();
  const next: SenderLaunchAction = {
    ...existing,
    status: patch.status ?? existing.status,
    executeAfter: String(patch.executeAfter ?? existing.executeAfter).trim(),
    attempts: patch.attempts === undefined ? existing.attempts : Math.max(0, Math.round(Number(patch.attempts) || 0)),
    maxAttempts:
      patch.maxAttempts === undefined ? existing.maxAttempts : Math.max(1, Math.round(Number(patch.maxAttempts) || 1)),
    payload: patch.payload ?? existing.payload,
    resultSummary: patch.resultSummary === undefined ? existing.resultSummary : String(patch.resultSummary).trim(),
    lastError: patch.lastError === undefined ? existing.lastError : String(patch.lastError).trim(),
    completedAt: patch.completedAt === undefined ? existing.completedAt : String(patch.completedAt).trim(),
    updatedAt: now,
  };

  const supabase = getSupabaseAdmin();
  if (supabase) {
    const { data, error } = await supabase
      .from(TABLE_SENDER_LAUNCH_ACTION)
      .update({
        status: next.status,
        execute_after: next.executeAfter,
        attempts: next.attempts,
        max_attempts: next.maxAttempts,
        payload: next.payload,
        result_summary: next.resultSummary,
        last_error: next.lastError,
        completed_at: next.completedAt || null,
        updated_at: next.updatedAt,
      })
      .eq("id", next.id)
      .select("*")
      .single();
    if (!error && data) {
      return mapSenderLaunchActionRow(data);
    }
    if (!(options.allowMissingTable && isMissingRelationError(error, TABLE_SENDER_LAUNCH_ACTION)) && isVercel) {
      throw new OutreachDataError("Failed to update sender launch action in Supabase.", {
        status: 500,
        hint: hintForSupabaseWriteError(error),
        debug: {
          operation: "updateSenderLaunchAction",
          runtime: runtimeLabel(),
          supabaseConfigured: supabaseConfigured(),
          actionId: next.id,
          supabaseError: supabaseErrorDebug(error),
        },
      });
    }
  }

  const store = await readLocalStore();
  const index = store.senderLaunchActions.findIndex((row) => row.id === next.id);
  if (index >= 0) {
    store.senderLaunchActions[index] = next;
    await writeLocalStore(store);
  }
  return next;
}
