export type CampaignStep = "objective" | "hypotheses" | "experiments" | "evolution";
export type CampaignFlowStep = "build" | "run";

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

export type Angle = Hypothesis;

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

export type Variant = Experiment;

export type ExperimentRecordStatus =
  | "draft"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "promoted"
  | "archived";

export type ExperimentMessageFlow = {
  mapId: string;
  publishedRevision: number;
};

export type ExperimentTestEnvelope = {
  sampleSize: number;
  durationDays: number;
  dailyCap: number;
  hourlyCap: number;
  timezone: string;
  minSpacingMinutes: number;
};

export type ExperimentSuccessMetric = {
  metric: "reply_rate";
  thresholdPct: number;
};

export type ExperimentMetricsSummary = {
  sent: number;
  replies: number;
  positiveReplies: number;
  failed: number;
};

export type ExperimentRuntimeRef = {
  campaignId: string;
  hypothesisId: string;
  experimentId: string;
};

export type ExperimentRecord = {
  id: string;
  brandId: string;
  name: string;
  status: ExperimentRecordStatus;
  offer: string;
  audience: string;
  messageFlow: ExperimentMessageFlow;
  testEnvelope: ExperimentTestEnvelope;
  successMetric: ExperimentSuccessMetric;
  lastRunId: string;
  metricsSummary: ExperimentMetricsSummary;
  promotedCampaignId: string;
  runtime: ExperimentRuntimeRef;
  createdAt: string;
  updatedAt: string;
};

export type ExperimentSuggestionStatus = "suggested" | "accepted" | "dismissed";

export type ExperimentSuggestionSource = "ai" | "system";

export type ExperimentSuggestionRecord = {
  id: string;
  brandId: string;
  name: string;
  offer: string;
  audience: string;
  cta?: string;
  trigger?: string;
  emailPreview?: string;
  successTarget?: string;
  rationale: string;
  status: ExperimentSuggestionStatus;
  source: ExperimentSuggestionSource;
  acceptedExperimentId: string;
  createdAt: string;
  updatedAt: string;
};

export type ScaleCampaignStatus =
  | "draft"
  | "active"
  | "paused"
  | "completed"
  | "archived";

export type CampaignSnapshot = {
  offer: string;
  audience: string;
  mapId: string;
  publishedRevision: number;
};

export type CampaignScalePolicy = {
  dailyCap: number;
  hourlyCap: number;
  timezone: string;
  minSpacingMinutes: number;
  accountId: string;
  mailboxAccountId: string;
  safetyMode: "strict" | "balanced";
};

export type ScaleCampaignRecord = {
  id: string;
  brandId: string;
  name: string;
  status: ScaleCampaignStatus;
  sourceExperimentId: string;
  snapshot: CampaignSnapshot;
  scalePolicy: CampaignScalePolicy;
  lastRunId: string;
  metricsSummary: ExperimentMetricsSummary;
  createdAt: string;
  updatedAt: string;
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

export type BuildViewModel = {
  objective: ObjectiveData;
  angles: Angle[];
  variants: Variant[];
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
  product: string;
  targetMarkets: string[];
  idealCustomerProfiles: string[];
  keyFeatures: string[];
  keyBenefits: string[];
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
  ownerType: "experiment" | "campaign";
  ownerId: string;
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
  sourceType: "cadence" | "conversation";
  sessionId: string;
  nodeId: string;
  parentMessageId: string;
  status: OutreachMessageStatus;
  providerMessageId: string;
  scheduledAt: string;
  sentAt: string;
  lastError: string;
  generationMeta: Record<string, unknown>;
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
  | "analyze_run"
  | "conversation_tick";

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

export type RunViewModel = {
  runs: OutreachRun[];
  leads: OutreachRunLead[];
  messages: OutreachMessage[];
  threads: ReplyThread[];
  replyMessages: ReplyMessage[];
  drafts: ReplyDraft[];
  insights: EvolutionSnapshot[];
  anomalies: RunAnomaly[];
  eventsByRun: Record<string, OutreachRunEvent[]>;
  jobsByRun: Record<string, OutreachRunJob[]>;
};

export type ConversationNodeKind = "message" | "terminal";
export type ConversationEdgeTrigger = "intent" | "timer" | "fallback";
export type ConversationCopyMode = "prompt_v1" | "legacy_template";

export type ConversationPromptPolicy = {
  subjectMaxWords: number;
  bodyMaxWords: number;
  exactlyOneCta: boolean;
};

export type ConversationFlowNode = {
  id: string;
  kind: ConversationNodeKind;
  title: string;
  copyMode: ConversationCopyMode;
  promptTemplate: string;
  promptVersion: number;
  promptPolicy: ConversationPromptPolicy;
  body: string;
  subject: string;
  autoSend: boolean;
  delayMinutes: number;
  x: number;
  y: number;
};

export type ConversationFlowEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  trigger: ConversationEdgeTrigger;
  intent: "question" | "interest" | "objection" | "unsubscribe" | "other" | "";
  waitMinutes: number;
  confidenceThreshold: number;
  priority: number;
};

export type ConversationPreviewLead = {
  id: string;
  name: string;
  email: string;
  company: string;
  title: string;
  domain: string;
  source: "seeded" | "manual" | "sourced";
};

// Legacy alias kept for compatibility with older code paths.
export type ConversationDemoLead = ConversationPreviewLead;

export type ConversationFlowGraph = {
  version: 1;
  maxDepth: number;
  startNodeId: string;
  nodes: ConversationFlowNode[];
  edges: ConversationFlowEdge[];
  previewLeads: ConversationPreviewLead[];
  previewLeadId: string;
};

export type ConversationMap = {
  id: string;
  brandId: string;
  campaignId: string;
  experimentId: string;
  name: string;
  status: "draft" | "published" | "archived";
  draftGraph: ConversationFlowGraph;
  publishedGraph: ConversationFlowGraph;
  publishedRevision: number;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationSession = {
  id: string;
  runId: string;
  brandId: string;
  campaignId: string;
  leadId: string;
  mapId: string;
  mapRevision: number;
  state: "active" | "waiting_manual" | "completed" | "failed";
  currentNodeId: string;
  turnCount: number;
  lastIntent: "question" | "interest" | "objection" | "unsubscribe" | "other" | "";
  lastConfidence: number;
  lastNodeEnteredAt: string;
  endedReason: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationEvent = {
  id: string;
  sessionId: string;
  runId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
