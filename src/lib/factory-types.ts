export type CampaignStep = "objective" | "hypotheses" | "experiments" | "evolution";

export type ObjectiveData = {
  goal: string;
  constraints: string;
  scoring: {
    conversionWeight: number;
    qualityWeight: number;
    replyWeight: number;
  };
};

export type HypothesisSourceConfig = {
  actorId: string;
  actorInput: Record<string, unknown>;
  maxLeads: number;
};

export type Hypothesis = {
  id: string;
  title: string;
  channel: string;
  rationale: string;
  actorQuery: string;
  sourceConfig: HypothesisSourceConfig;
  seedInputs: string[];
  status: "draft" | "approved";
};

export type RunCadence = "3_step_7_day";

export type ExperimentRunPolicy = {
  cadence: RunCadence;
  dailyCap: number;
  hourlyCap: number;
  timezone: string;
  minSpacingMinutes: number;
};

export type ExperimentExecutionStatus =
  | "idle"
  | "queued"
  | "sourcing"
  | "scheduled"
  | "sending"
  | "monitoring"
  | "paused"
  | "completed"
  | "failed";

export type Experiment = {
  id: string;
  hypothesisId: string;
  name: string;
  status: "draft" | "testing" | "scaling" | "paused";
  notes: string;
  runPolicy: ExperimentRunPolicy;
  executionStatus: ExperimentExecutionStatus;
};

export type EvolutionSnapshot = {
  id: string;
  title: string;
  summary: string;
  status: "observing" | "winner" | "killed";
};

export type CampaignRecord = {
  id: string;
  brandId: string;
  name: string;
  status: "draft" | "active" | "paused";
  objective: ObjectiveData;
  hypotheses: Hypothesis[];
  experiments: Experiment[];
  evolution: EvolutionSnapshot[];
  stepState: {
    objectiveCompleted: boolean;
    hypothesesCompleted: boolean;
    experimentsCompleted: boolean;
    evolutionCompleted: boolean;
    currentStep: CampaignStep;
  };
  createdAt: string;
  updatedAt: string;
};

export type DomainRow = {
  id: string;
  domain: string;
  status: "active" | "warming" | "risky";
  warmupStage: string;
  reputation: string;
};

export type LeadRow = {
  id: string;
  name: string;
  channel: string;
  status: "new" | "contacted" | "qualified" | "closed";
  lastTouch: string;
};

export type InboxRow = {
  id: string;
  from: string;
  subject: string;
  sentiment: "positive" | "neutral" | "negative";
  status: "new" | "open" | "closed";
  receivedAt: string;
};

export type BrandRecord = {
  id: string;
  name: string;
  website: string;
  tone: string;
  notes: string;
  domains: DomainRow[];
  leads: LeadRow[];
  inbox: InboxRow[];
  createdAt: string;
  updatedAt: string;
};

export type OutreachProvider = "customerio";

export type MailboxProvider = "gmail" | "outlook" | "imap";

export type MailboxStatus = "connected" | "disconnected" | "error";

export type OutreachAccountType = "delivery" | "mailbox" | "hybrid";

export type OutreachAccountConfig = {
  customerIo: {
    siteId: string;
    workspaceId: string;
    fromEmail: string;
    replyToEmail: string;
  };
  apify: {
    defaultActorId: string;
  };
  mailbox: {
    provider: MailboxProvider;
    email: string;
    status: MailboxStatus;
    host: string;
    port: number;
    secure: boolean;
  };
};

export type OutreachAccount = {
  id: string;
  name: string;
  provider: OutreachProvider;
  accountType: OutreachAccountType;
  status: "active" | "inactive";
  config: OutreachAccountConfig;
  hasCredentials: boolean;
  lastTestAt: string;
  lastTestStatus: "unknown" | "pass" | "fail";
  createdAt: string;
  updatedAt: string;
};

export type BrandOutreachAssignment = {
  brandId: string;
  accountId: string;
  mailboxAccountId: string;
  createdAt: string;
  updatedAt: string;
};

export type OutreachRunStatus =
  | "queued"
  | "preflight_failed"
  | "sourcing"
  | "scheduled"
  | "sending"
  | "monitoring"
  | "paused"
  | "completed"
  | "canceled"
  | "failed";

export type OutreachRunMetrics = {
  sourcedLeads: number;
  scheduledMessages: number;
  sentMessages: number;
  bouncedMessages: number;
  failedMessages: number;
  replies: number;
  positiveReplies: number;
  negativeReplies: number;
};

export type OutreachRun = {
  id: string;
  brandId: string;
  campaignId: string;
  experimentId: string;
  hypothesisId: string;
  accountId: string;
  status: OutreachRunStatus;
  cadence: RunCadence;
  dailyCap: number;
  hourlyCap: number;
  timezone: string;
  minSpacingMinutes: number;
  pauseReason: string;
  lastError: string;
  externalRef: string;
  metrics: OutreachRunMetrics;
  startedAt: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type OutreachRunLead = {
  id: string;
  runId: string;
  brandId: string;
  campaignId: string;
  email: string;
  name: string;
  company: string;
  title: string;
  domain: string;
  sourceUrl: string;
  status: "new" | "suppressed" | "scheduled" | "sent" | "replied" | "bounced" | "unsubscribed";
  createdAt: string;
  updatedAt: string;
};

export type OutreachMessageStatus =
  | "scheduled"
  | "sent"
  | "failed"
  | "bounced"
  | "replied"
  | "canceled";

export type OutreachMessage = {
  id: string;
  runId: string;
  brandId: string;
  campaignId: string;
  leadId: string;
  step: number;
  subject: string;
  body: string;
  status: OutreachMessageStatus;
  providerMessageId: string;
  scheduledAt: string;
  sentAt: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

export type ReplyThread = {
  id: string;
  brandId: string;
  campaignId: string;
  runId: string;
  leadId: string;
  subject: string;
  sentiment: "positive" | "neutral" | "negative";
  status: "new" | "open" | "closed";
  intent: "question" | "interest" | "objection" | "unsubscribe" | "other";
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ReplyMessage = {
  id: string;
  threadId: string;
  runId: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  subject: string;
  body: string;
  providerMessageId: string;
  receivedAt: string;
  createdAt: string;
};

export type ReplyDraft = {
  id: string;
  threadId: string;
  brandId: string;
  runId: string;
  subject: string;
  body: string;
  status: "draft" | "sent" | "dismissed";
  reason: string;
  sentAt: string;
  createdAt: string;
  updatedAt: string;
};

export type RunAnomalyType =
  | "hard_bounce_rate"
  | "spam_complaint_rate"
  | "provider_error_rate"
  | "negative_reply_rate_spike";

export type RunAnomaly = {
  id: string;
  runId: string;
  type: RunAnomalyType;
  severity: "warning" | "critical";
  status: "active" | "acknowledged" | "resolved";
  threshold: number;
  observed: number;
  details: string;
  createdAt: string;
  updatedAt: string;
};

export type OutreachRunEvent = {
  id: string;
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type OutreachRunJobType =
  | "source_leads"
  | "schedule_messages"
  | "dispatch_messages"
  | "sync_replies"
  | "analyze_run";

export type OutreachRunJobStatus = "queued" | "running" | "completed" | "failed";

export type OutreachRunJob = {
  id: string;
  runId: string;
  jobType: OutreachRunJobType;
  status: OutreachRunJobStatus;
  executeAfter: string;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};
