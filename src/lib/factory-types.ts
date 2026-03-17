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
  oneContactPerCompany?: boolean;
  businessHoursEnabled?: boolean;
  businessHoursStartHour?: number;
  businessHoursEndHour?: number;
  businessDays?: number[];
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

export type ExperimentListItemStatus =
  | "Draft"
  | "Sourcing"
  | "Ready"
  | "Running"
  | "Paused"
  | "Completed"
  | "Promoted"
  | "Blocked";

export type ExperimentListItem = {
  id: string;
  brandId: string;
  name: string;
  status: ExperimentListItemStatus;
  audience: string;
  offer: string;
  owner: string;
  flowRevision: number;
  sourcedLeads: number;
  scheduledMessages: number;
  sentMessages: number;
  replies: number;
  positiveReplies: number;
  isActiveNow: boolean;
  activeActionLabel: "Open Run" | "Open Prospects" | "Open";
  openHref: string;
  editHref: string;
  duplicateHref: string;
  activeHref: string;
  lastActivityAt: string;
  lastActivityLabel: string;
  promotedCampaignId: string;
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

export type ExperimentSuggestionReviewCandidate = {
  index: number;
  name: string;
  audience: string;
  trigger: string;
  offer: string;
  cta: string;
  emailPreview: string;
  successTarget: string;
  rationale: string;
  decision: "promote" | "revise" | "reject";
  summary: string;
  strengths: string[];
  risks: string[];
  score: number;
  openLikelihood: number;
  replyLikelihood: number;
  positiveReplyLikelihood: number;
  unsubscribeRisk: number;
  accepted: boolean;
};

export type ExperimentSuggestionDraftIdea = {
  name: string;
  audience: string;
  trigger: string;
  offer: string;
  cta: string;
  emailPreview: string;
  successTarget: string;
  rationale: string;
};

export type ExperimentSuggestionBrainstormTurnStatus =
  | "drafting"
  | "reviewing"
  | "completed"
  | "failed";

export type ExperimentSuggestionBrainstormTurn = {
  turn: number;
  agentId: string;
  agentName: string;
  agentStyle: string;
  brief: string;
  status: ExperimentSuggestionBrainstormTurnStatus;
  score: number;
  acceptedCount: number;
  draftIdeas: ExperimentSuggestionDraftIdea[];
  ideas: ExperimentSuggestionReviewCandidate[];
  failed?: boolean;
  error?: string;
};

export type ExperimentSuggestionGenerationResult = {
  suggestions: ExperimentSuggestionRecord[];
  mode?: string;
  screened?: number;
  kept?: number;
  created?: number;
  reviewCandidates?: ExperimentSuggestionReviewCandidate[];
  brainstormTurns?: ExperimentSuggestionBrainstormTurn[];
};

export type ExperimentSuggestionStreamEvent =
  | {
      type: "start";
      refresh: boolean;
      requestedAgents: number;
      minimumReady: number;
    }
  | {
      type:
        | "turn_started"
        | "turn_drafted"
        | "turn_completed"
        | "turn_failed";
      turn: ExperimentSuggestionBrainstormTurn;
    }
  | {
      type: "done";
      result: ExperimentSuggestionGenerationResult;
    }
  | {
      type: "error";
      message: string;
      hint?: string;
      debug?: Record<string, unknown>;
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
  automationStatus?: "queued" | "testing" | "warming" | "ready" | "attention";
  automationSummary?: string;
  domainHealth?: "unknown" | "queued" | "healthy" | "watch" | "risky";
  domainHealthSummary?: string;
  emailHealth?: "unknown" | "queued" | "healthy" | "watch" | "risky";
  emailHealthSummary?: string;
  ipHealth?: "unknown" | "queued" | "healthy" | "watch" | "risky";
  ipHealthSummary?: string;
  messagingHealth?: "unknown" | "queued" | "healthy" | "watch" | "risky";
  messagingHealthSummary?: string;
  seedPolicy?: "fresh_pool" | "rotating_pool" | "tainted_mailbox";
  role?: "brand" | "sender";
  registrar?: "namecheap" | "manual";
  provider?: "customerio" | "manual";
  dnsStatus?: "pending" | "configured" | "verified" | "error";
  fromEmail?: string;
  replyMailboxEmail?: string;
  forwardingTargetUrl?: string;
  customerIoAccountId?: string;
  customerIoAccountName?: string;
  notes?: string;
  lastProvisionedAt?: string;
  lastHealthCheckAt?: string;
  nextHealthCheckAt?: string;
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

export type ProvisioningValidationStatus = "unknown" | "pass" | "fail";

export type DeliverabilityProvider = "none" | "google_postmaster";
export type DeliverabilityHealthStatus = "unknown" | "healthy" | "warning" | "critical";

export type DeliverabilityDomainHealth = {
  domain: string;
  trafficDate: string;
  domainReputation: string;
  spamRate: number;
  status: DeliverabilityHealthStatus;
  summary: string;
};

export type OutreachProvisioningSettings = {
  id: string;
  customerIo: {
    siteId: string;
    workspaceRegion: "unknown" | "us" | "eu";
    hasTrackingApiKey: boolean;
    hasAppApiKey: boolean;
    lastValidatedAt: string;
    lastValidatedStatus: ProvisioningValidationStatus;
    lastValidationMessage: string;
  };
  namecheap: {
    apiUser: string;
    userName: string;
    clientIp: string;
    hasApiKey: boolean;
    lastValidatedAt: string;
    lastValidatedStatus: ProvisioningValidationStatus;
    lastValidationMessage: string;
  };
  deliverability: {
    provider: DeliverabilityProvider;
    monitoredDomains: string[];
    hasGoogleClientId: boolean;
    hasGoogleClientSecret: boolean;
    hasGoogleRefreshToken: boolean;
    lastValidatedAt: string;
    lastValidatedStatus: ProvisioningValidationStatus;
    lastValidationMessage: string;
    lastCheckedAt: string;
    lastHealthStatus: DeliverabilityHealthStatus;
    lastHealthScore: number;
    lastHealthSummary: string;
    lastDomainSnapshots: DeliverabilityDomainHealth[];
  };
  createdAt: string;
  updatedAt: string;
};

export type MailboxProvider = "gmail" | "outlook" | "imap";

export type MailboxStatus = "connected" | "disconnected" | "error";

export type OutreachAccountType = "delivery" | "mailbox" | "hybrid";

export type CustomerIoBillingConfig = {
  monthlyProfileLimit: number;
  billingCycleAnchorDay: number;
  currentPeriodStart: string;
  currentPeriodBaselineProfiles: number;
  currentPeriodBaselineSyncedAt: string;
  lastWorkspacePeopleCount: number;
  lastWorkspacePeopleCountAt: string;
};

export type CustomerIoBillingSummary = {
  monthlyProfileLimit: number;
  billingCycleAnchorDay: number;
  billingPeriodStart: string;
  baselineReady: boolean;
  currentPeriodBaselineProfiles: number;
  currentPeriodAdmittedProfiles: number;
  observedWorkspaceProfiles: number;
  observedWorkspaceProfilesAt: string;
  projectedProfiles: number;
  remainingProfiles: number;
};

export type OutreachAccountConfig = {
  customerIo: {
    siteId: string;
    workspaceId: string;
    fromEmail: string;
    replyToEmail: string;
    billing: CustomerIoBillingConfig;
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
  customerIoBilling?: CustomerIoBillingSummary;
  hasCredentials: boolean;
  lastTestAt: string;
  lastTestStatus: "unknown" | "pass" | "fail";
  createdAt: string;
  updatedAt: string;
};

export type BrandOutreachAssignment = {
  brandId: string;
  accountId: string;
  accountIds: string[];
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

export type LeadQualityPolicy = {
  allowFreeDomains: boolean;
  allowRoleInboxes: boolean;
  requirePersonName: boolean;
  requireCompany: boolean;
  requireTitle: boolean;
  requiredTitleKeywords?: string[];
  requiredCompanyKeywords?: string[];
  excludedCompanyKeywords?: string[];
  minConfidenceScore: number;
};

export type ActorCapabilityProfile = {
  actorId: string;
  stageHints: Array<"prospect_discovery" | "website_enrichment" | "email_discovery">;
  schemaSummary: Record<string, unknown>;
  compatibilityScore: number;
  lastSeenMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SourcingChainStep = {
  id: string;
  stage: "prospect_discovery" | "website_enrichment" | "email_discovery";
  actorId: string;
  purpose: string;
  queryHint: string;
};

export type SourcingChainDecision = {
  id: string;
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
  probeSummary: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SourcingProbeResult = {
  id: string;
  decisionId: string;
  brandId: string;
  experimentOwnerId: string;
  runId: string;
  stepIndex: number;
  actorId: string;
  stage: "prospect_discovery" | "website_enrichment" | "email_discovery";
  probeInputHash: string;
  outcome: "pass" | "fail";
  qualityMetrics: Record<string, unknown>;
  costEstimateUsd: number;
  details: Record<string, unknown>;
  createdAt: string;
};

export type SourcingActorMemory = {
  actorId: string;
  successCount: number;
  failCount: number;
  compatibilityFailCount: number;
  leadsAccepted: number;
  leadsRejected: number;
  avgQuality: number;
  createdAt: string;
  updatedAt: string;
};

export type DeliverabilityProbeVariant = "baseline" | "production";
export type DeliverabilityProbeStage = "send" | "poll";
export type DeliverabilityProbeRunStatus = "queued" | "sent" | "waiting" | "completed" | "failed";
export type DeliverabilitySeedReservationStatus = "reserved" | "consumed" | "released";

export type DeliverabilityProbeTarget = {
  reservationId?: string;
  accountId: string;
  email: string;
  providerMessageId?: string;
};

export type DeliverabilityProbeMonitorResult = {
  accountId: string;
  email: string;
  placement: string;
  matchedMailbox: string;
  matchedUid: number;
  ok: boolean;
  error: string;
};

export type DeliverabilityProbeRun = {
  id: string;
  runId: string;
  brandId: string;
  campaignId: string;
  experimentId: string;
  probeToken: string;
  probeVariant: DeliverabilityProbeVariant;
  status: DeliverabilityProbeRunStatus;
  stage: DeliverabilityProbeStage;
  sourceMessageId: string;
  sourceMessageStatus: string;
  sourceType: string;
  sourceNodeId: string;
  sourceLeadId: string;
  senderAccountId: string;
  senderAccountName: string;
  fromEmail: string;
  replyToEmail: string;
  subject: string;
  contentHash: string;
  reservationIds: string[];
  monitorTargets: DeliverabilityProbeTarget[];
  results: DeliverabilityProbeMonitorResult[];
  pollAttempt: number;
  placement: string;
  totalMonitors: number;
  counts: Record<string, unknown>;
  summaryText: string;
  lastError: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type DeliverabilitySeedReservation = {
  id: string;
  probeRunId: string;
  runId: string;
  brandId: string;
  senderAccountId: string;
  fromEmail: string;
  monitorAccountId: string;
  monitorEmail: string;
  probeVariant: DeliverabilityProbeVariant;
  contentHash: string;
  probeToken: string;
  status: DeliverabilitySeedReservationStatus;
  providerMessageId: string;
  releasedReason: string;
  reservedAt: string;
  consumedAt: string;
  releasedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type LeadAcceptanceDecision = {
  email: string;
  accepted: boolean;
  confidence: number;
  reason: string;
  details: Record<string, unknown>;
};

export type SourcingTraceSummary = {
  phase: "plan_sourcing" | "probe_chain" | "execute_chain" | "completed" | "failed";
  selectedActorIds: string[];
  lastActorInputError: string;
  failureStep: string;
  budgetUsedUsd: number;
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
  sourcingTraceSummary: SourcingTraceSummary;
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
  | "negative_reply_rate_spike"
  | "deliverability_inbox_placement";

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
  | "conversation_tick"
  | "monitor_deliverability";

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

export type ConversationReplyTimingPolicy = {
  minimumDelayMinutes: number;
  randomAdditionalDelayMinutes: number;
};

export type ConversationWorkingHoursPolicy = {
  timezone: string;
  businessHoursEnabled: boolean;
  businessHoursStartHour: number;
  businessHoursEndHour: number;
  businessDays: number[];
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
  replyTiming: ConversationReplyTimingPolicy;
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

export type ConversationMapEditorState = {
  map: ConversationMap | null;
  workingHours: ConversationWorkingHoursPolicy;
};

export type ConversationMapSuggestionResult = {
  graph: ConversationFlowGraph;
  mode: string;
  selectedIndex: number;
  score: number;
  summary: string;
};

export type ConversationMapSuggestionCandidateState =
  | "queued"
  | "drafted"
  | "reviewing"
  | "accepted"
  | "rejected"
  | "winner";

export type ConversationMapSuggestionCandidate = {
  index: number;
  title: string;
  rationale: string;
  state: ConversationMapSuggestionCandidateState;
  score?: number;
  decision?: "promote" | "revise" | "reject";
  summary?: string;
  strengths?: string[];
  risks?: string[];
};

export type ConversationMapSuggestionStreamEvent =
  | {
      type: "start";
      ultimateGoal: string;
      candidateCount: number;
      personaCount: number;
      progress: number;
      phase: "drafting_candidates";
      phaseLabel: string;
    }
  | {
      type: "phase";
      phase: "drafting_candidates" | "roleplay_screening" | "selecting_winner";
      phaseLabel: string;
      progress: number;
    }
  | {
      type: "candidates_generated";
      progress: number;
      candidates: ConversationMapSuggestionCandidate[];
    }
  | {
      type: "candidate_scored";
      progress: number;
      candidate: ConversationMapSuggestionCandidate;
    }
  | {
      type: "winner_selected";
      progress: number;
      selectedIndex: number;
      summary: string;
      score: number;
    }
  | {
      type: "done";
      result: ConversationMapSuggestionResult;
    }
  | {
      type: "error";
      message: string;
      details?: string;
    };

export type ConversationProbeStep = {
  id: string;
  kind: "outbound" | "inbound" | "route" | "timer" | "status";
  label: string;
  nodeId: string;
  nodeTitle: string;
  edgeId: string;
  edgeLabel: string;
  subject: string;
  body: string;
  waitMinutes: number;
  intent: "question" | "interest" | "objection" | "unsubscribe" | "other" | "";
  confidence: number;
  action: "reply" | "no_reply" | "manual_review" | "";
  route: string;
  reason: string;
};

export type ConversationProbeScenarioResult = {
  id: string;
  title: string;
  description: string;
  outcome:
    | "auto_reply"
    | "manual_review"
    | "no_reply"
    | "timer_follow_up"
    | "completed"
    | "stalled";
  summary: string;
  path: string[];
  steps: ConversationProbeStep[];
};

export type ConversationProbeResult = {
  startNodeId: string;
  startNodeTitle: string;
  lead: ConversationPreviewLead;
  generatedAt: string;
  scenarios: ConversationProbeScenarioResult[];
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
