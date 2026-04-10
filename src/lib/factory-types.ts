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
  | "Preparing"
  | "Waiting"
  | "Sending"
  // Legacy labels kept for compatibility with older callers.
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
  blockedReason?: string;
  statusDetail?: string;
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

export type OutreachFlowTournamentInput = {
  target: string;
  desiredOutcome: string;
  offer?: string;
  channel?: string;
  availablePersonas?: string[];
  availableAssets?: string[];
  constraints?: string[];
  qualityBar?: string[];
  maxTurnsBeforeCTA?: number;
  agentCount?: number;
  ideasPerAgent?: number;
};

export type OutreachFlowTournamentBranch = {
  branch: string;
  targetReply: string;
  response: string;
  goal: string;
};

export type OutreachFlowTournamentIdea = {
  title: string;
  persona: string;
  backingAsset: string;
  entryVehicle: string;
  firstValue: string;
  whyReply: string;
  whyNow: string;
  proofLoop: string;
  bridgeTrigger: string;
  personaProof: string[];
  assetBurdenLevel: "low" | "medium" | "high";
  suspicionRiskLevel: "low" | "medium" | "high";
  openerSubject: string;
  openerBody: string;
  branches: OutreachFlowTournamentBranch[];
  bridgeMoment: string;
  handoffPlan: string;
  cta: string;
  rationale: string;
};

export type OutreachFlowTournamentTurn = {
  order: number;
  agentId: string;
  agentName: string;
  agentStyle: string;
  brief: string;
  status: "drafting" | "drafted" | "failed";
  ideas: OutreachFlowTournamentIdea[];
  acceptedTitles: string[];
  error?: string;
};

export type OutreachFlowTournamentCandidate = {
  index: number;
  title: string;
  persona: string;
  backingAsset: string;
  entryVehicle: string;
  firstValue: string;
  whyReply: string;
  whyNow: string;
  proofLoop: string;
  bridgeTrigger: string;
  personaProof: string[];
  openerSubject: string;
  openerBody: string;
  branches: OutreachFlowTournamentBranch[];
  bridgeMoment: string;
  handoffPlan: string;
  cta: string;
  rationale: string;
  score: number;
  replyLikelihood: number;
  personaCredibility: number;
  bridgeQuality: number;
  assetFeasibility: number;
  suspicionRisk: number;
  decision: "promote" | "revise" | "reject";
  summary: string;
  strengths: string[];
  risks: string[];
  accepted: boolean;
  rank: number;
};

export type OutreachFlowTournamentShortlistItem = {
  index: number;
  title: string;
  category: string;
  pitch: string;
  note: string;
};

export type OutreachFlowTournamentSnapshot = {
  agents: number;
  ideas: number;
  accepted: number;
  denied: number;
};

export type OutreachFlowTournamentResult = {
  shortlist: OutreachFlowTournamentShortlistItem[];
  pressureSummary: string;
  strongestUsefulDenial: string;
  snapshot: OutreachFlowTournamentSnapshot;
  turns: OutreachFlowTournamentTurn[];
  allCandidates: OutreachFlowTournamentCandidate[];
};

export type OutreachFlowTournamentSavedResult = {
  brandId: string;
  brief: OutreachFlowTournamentInput;
  result: OutreachFlowTournamentResult;
  createdAt: string;
  updatedAt: string;
};

export type OutreachFlowTournamentStreamEvent =
  | {
      type: "start";
      requestedAgents: number;
      ideasPerAgent: number;
    }
  | {
      type: "phase";
      phase: "planning" | "generating" | "judging" | "shortlisting";
      phaseLabel: string;
    }
  | {
      type: "turn_started" | "turn_completed" | "turn_failed";
      turn: OutreachFlowTournamentTurn;
    }
  | {
      type: "done";
      brief: OutreachFlowTournamentInput;
      result: OutreachFlowTournamentResult;
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
  registrar?: "namecheap" | "mailpool" | "manual";
  provider?: "customerio" | "mailpool" | "manual";
  dnsStatus?: "pending" | "configured" | "verified" | "error";
  fromEmail?: string;
  replyMailboxEmail?: string;
  forwardingTargetUrl?: string;
  deliveryAccountId?: string;
  deliveryAccountName?: string;
  customerIoAccountId?: string;
  customerIoAccountName?: string;
  mailpoolDomainId?: string;
  notes?: string;
  lastProvisionedAt?: string;
  lastHealthCheckAt?: string;
  nextHealthCheckAt?: string;
  senderLaunchId?: string;
  senderLaunchPlanType?: SenderLaunchPlanType;
  senderLaunchState?: SenderLaunchState;
  senderLaunchScore?: number;
  senderLaunchSummary?: string;
  senderLaunchNextStep?: string;
  senderLaunchTopicSummary?: string;
  senderLaunchDailyCap?: number;
  senderLaunchLastEvaluatedAt?: string;
  senderLaunchAutopilotMode?: SenderLaunchAutopilotMode;
  senderLaunchAutopilotAllowedDomains?: string[];
  senderLaunchAutopilotBlockedDomains?: string[];
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
  socialDiscoveryPlatforms: string[];
  operablePersonas: string[];
  availableAssets: string[];
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

export type OutreachProvider = "customerio" | "mailpool";

export type ProvisioningValidationStatus = "unknown" | "pass" | "fail";

export type DeliverabilityProvider = "none" | "google_postmaster" | "mailpool";
export type DeliverabilityHealthStatus = "unknown" | "healthy" | "warning" | "critical";
export type MailpoolMailboxType = "google" | "shared" | "private" | "outlook";
export type MailpoolResourceStatus = "pending" | "active" | "updating" | "error" | "deleted";
export type MailpoolInboxPlacementProvider =
  | "GoogleWorkspace"
  | "Gmail"
  | "Outlook"
  | "M365Outlook"
  | "Yahoo"
  | "Aol"
  | "SMTP"
  | "Hotmail";

export type DeliverabilityDomainHealth = {
  domain: string;
  trafficDate: string;
  domainReputation: string;
  spamRate: number;
  status: DeliverabilityHealthStatus;
  summary: string;
};

export type SenderLaunchPlanType = "bridge" | "subdomain" | "fresh";
export type SenderLaunchAutopilotMode = "curated_only" | "curated_plus_open_web";

export type SenderLaunchState =
  | "setup"
  | "observing"
  | "warming"
  | "restricted_send"
  | "ready"
  | "paused"
  | "blocked";

export type SenderLaunch = {
  id: string;
  senderAccountId: string;
  brandId: string;
  fromEmail: string;
  domain: string;
  planType: SenderLaunchPlanType;
  state: SenderLaunchState;
  readinessScore: number;
  summary: string;
  nextStep: string;
  topicSummary: string;
  topicKeywords: string[];
  sourceExperimentIds: string[];
  infraScore: number;
  reputationScore: number;
  trustScore: number;
  safetyScore: number;
  topicScore: number;
  dailyCap: number;
  sentCount: number;
  repliedCount: number;
  bouncedCount: number;
  failedCount: number;
  inboxRate: number;
  spamRate: number;
  trustEventCount: number;
  pausedUntil: string;
  pauseReason: string;
  lastEventAt: string;
  lastEvaluatedAt: string;
  autopilotMode: SenderLaunchAutopilotMode;
  autopilotAllowedDomains: string[];
  autopilotBlockedDomains: string[];
  createdAt: string;
  updatedAt: string;
};

export type SenderLaunchActionLane = "opt_in" | "double_opt_in" | "inquiry";

export type SenderLaunchActionType =
  | "execute_opt_in"
  | "confirm_double_opt_in"
  | "execute_inquiry";

export type SenderLaunchActionStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "skipped";

export type SenderLaunchAction = {
  id: string;
  senderLaunchId: string;
  senderAccountId: string;
  brandId: string;
  lane: SenderLaunchActionLane;
  actionType: SenderLaunchActionType;
  sourceKey: string;
  status: SenderLaunchActionStatus;
  executeAfter: string;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  resultSummary: string;
  lastError: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type SenderLaunchEvent = {
  id: string;
  senderLaunchId: string;
  senderAccountId: string;
  brandId: string;
  eventType:
    | "launch_initialized"
    | "topic_profile_refreshed"
    | "autopilot_policy_updated"
    | "bridge_inbound_recorded"
    | "opt_in_scheduled"
    | "opt_in_completed"
    | "double_opt_in_received"
    | "double_opt_in_confirmed"
    | "inquiry_scheduled"
    | "inquiry_completed"
    | "action_failed"
    | "state_changed"
    | "first_reply_recorded"
    | "healthy_probe_recorded"
    | "launch_paused"
    | "launch_resumed";
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
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
  mailpool: {
    webhookUrl: string;
    hasApiKey: boolean;
    hasWebhookSecret: boolean;
    lastValidatedAt: string;
    lastValidatedStatus: ProvisioningValidationStatus;
    lastValidationMessage: string;
  };
  deliverability: {
    provider: DeliverabilityProvider;
    monitoredDomains: string[];
    mailpoolInboxProviders: MailpoolInboxPlacementProvider[];
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
export type MailboxDeliveryMethod = "smtp" | "gmail_ui";
export type GmailUiLoginState = "unknown" | "login_required" | "ready" | "error";

export type OutreachAccountType = "delivery" | "mailbox" | "hybrid";
export type SocialConnectionProvider = "manual" | "unipile" | "none";
export type SocialLinkedProvider = "" | "linkedin" | "instagram" | "x" | "unknown";
export type SocialActorRole =
  | "operator"
  | "specialist"
  | "curator"
  | "partner"
  | "founder"
  | "brand"
  | "community";

export type SocialAccountConfig = {
  enabled: boolean;
  connectionProvider: SocialConnectionProvider;
  linkedProvider: SocialLinkedProvider;
  externalAccountId: string;
  handle: string;
  profileUrl: string;
  publicIdentifier: string;
  displayName: string;
  headline: string;
  bio: string;
  avatarUrl: string;
  role: SocialActorRole;
  topicTags: string[];
  communityTags: string[];
  platforms: string[];
  regions: string[];
  languages: string[];
  audienceTypes: string[];
  personaSummary: string;
  voiceSummary: string;
  trustLevel: number;
  cooldownMinutes: number;
  linkedAt: string;
  lastProfileSyncAt: string;
  lastSocialCommentAt: string;
  recentActivity24h: number;
  recentActivity7d: number;
  coordinationGroup: string;
  notes: string;
};

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
  mailpool: {
    domainId: string;
    mailboxId: string;
    mailboxType: MailpoolMailboxType;
    spamCheckId: string;
    inboxPlacementId: string;
    status: MailpoolResourceStatus;
    lastSpamCheckAt: string;
    lastSpamCheckScore: number;
    lastSpamCheckSummary: string;
  };
  apify: {
    defaultActorId: string;
  };
  social: SocialAccountConfig;
  mailbox: {
    provider: MailboxProvider;
    deliveryMethod: MailboxDeliveryMethod;
    email: string;
    status: MailboxStatus;
    host: string;
    port: number;
    secure: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUsername: string;
    gmailUiUserDataDir: string;
    gmailUiProfileDirectory: string;
    gmailUiBrowserChannel: string;
    gmailUiLoginState: GmailUiLoginState;
    gmailUiLoginCheckedAt: string;
    gmailUiLoginMessage: string;
    proxyUrl: string;
    proxyHost: string;
    proxyPort: number;
    proxyUsername: string;
    proxyPassword: string;
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

export type EmailVerificationState = {
  mode: "local" | "validatedmails" | "heuristic" | "";
  provider: string;
  verdict: string;
  confidence: string;
  reason: string;
  mxStatus: string;
  acceptAll: boolean | null;
  catchAll: boolean | null;
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
  realVerifiedEmail?: boolean;
  emailVerification?: EmailVerificationState | null;
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
  sourceType: "outreach" | "mailbox" | "eval";
  mailboxAccountId: string;
  contactEmail: string;
  contactName: string;
  contactCompany: string;
  subject: string;
  sentiment: "positive" | "neutral" | "negative";
  status: "new" | "open" | "closed";
  intent: "question" | "interest" | "objection" | "unsubscribe" | "other";
  lastMessageAt: string;
  stateSummary?: ReplyThreadStateSummary | null;
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

export type ReplyThreadStage =
  | "discover_relevance"
  | "qualify"
  | "handle_objection"
  | "advance_next_step"
  | "nurture"
  | "closed";

export type ReplyThreadMove =
  | "stay_silent"
  | "acknowledge_and_close"
  | "answer_question"
  | "ask_qualifying_question"
  | "offer_proof"
  | "reframe_objection"
  | "advance_next_step"
  | "soft_nurture"
  | "handoff_to_human"
  | "respect_opt_out";

export type ReplyThreadFactSource =
  | "thread"
  | "crm"
  | "enrichment"
  | "brand_memory"
  | "inference";

export type ReplyThreadFact = {
  key: string;
  value: string;
  source: ReplyThreadFactSource;
  confidence: number;
};

export type ReplyThreadStateDecision = {
  recommendedMove: ReplyThreadMove;
  objectiveForThisTurn: string;
  rationale: string;
  confidence: number;
  autopilotOk: boolean;
  manualReviewReason: string;
};

export type ReplyThreadDraftMeta = {
  draftId: string;
  status: "none" | "draft" | "sent" | "dismissed";
  subject: string;
  reason: string;
  createdAt: string;
};

export type ReplyThreadCanonicalState = {
  ids: {
    threadId: string;
    brandId: string;
    campaignId: string;
    runId: string;
    leadId: string;
    sourceType: "outreach" | "mailbox" | "eval";
    mailboxAccountId: string;
  };
  org: {
    brandSummary: string;
    productSummary: string;
    offerSummary: string;
    tone: string;
    proofPoints: string[];
    allowedClaims: string[];
    forbiddenClaims: string[];
    desiredOutcome: string;
  };
  contact: {
    email: string;
    name: string;
    company: string;
    title: string;
    roleFit: string;
    relationshipValue: "low" | "medium" | "high";
  };
  thread: {
    rollingSummary: string;
    latestInboundSummary: string;
    latestUserAsk: string;
    currentStage: ReplyThreadStage;
    stageGoal: string;
    progressScore: number;
  };
  evidence: {
    confirmedFacts: ReplyThreadFact[];
    inferredFacts: ReplyThreadFact[];
    openQuestions: string[];
    objections: string[];
    commitments: string[];
    riskFlags: string[];
    buyingSignals: string[];
  };
  policy: {
    preferredMoves: ReplyThreadMove[];
    forbiddenMoves: ReplyThreadMove[];
    manualReviewTriggers: string[];
    autopilotEnabled: boolean;
  };
  decision: ReplyThreadStateDecision;
  draft: {
    subject: string;
    body: string;
    styleNotes: string[];
  };
  audit: {
    stateRevision: number;
    sourcesUsed: string[];
    model: string;
    generatedAt: string;
  };
};

export type ReplyThreadStateSummary = {
  currentStage: ReplyThreadStage;
  recommendedMove: ReplyThreadMove;
  confidence: number;
  autopilotOk: boolean;
  manualReviewReason: string;
  latestUserAsk: string;
  progressScore: number;
};

export type ReplyThreadStateRecord = {
  threadId: string;
  brandId: string;
  runId: string;
  stateRevision: number;
  canonicalState: ReplyThreadCanonicalState;
  latestDecision: ReplyThreadStateDecision;
  latestDraftMeta: ReplyThreadDraftMeta;
  sourcesUsed: string[];
  createdAt: string;
  updatedAt: string;
};

export type ReplyThreadHistoryItem = {
  id: string;
  source: "outreach_message" | "reply_message";
  direction: "inbound" | "outbound";
  subject: string;
  body: string;
  at: string;
  status: string;
};

export type ReplyThreadDetail = {
  thread: ReplyThread;
  state: ReplyThreadStateRecord | null;
  history: ReplyThreadHistoryItem[];
  drafts: ReplyDraft[];
  feedback: ReplyThreadFeedback[];
  lead: OutreachRunLead | null;
  run: Pick<OutreachRun, "id" | "status" | "accountId" | "createdAt" | "updatedAt"> | null;
};

export type BrandInboxSource = {
  mailboxAccountId: string;
  accountName: string;
  email: string;
  provider: OutreachProvider | "";
  accountType: OutreachAccountType | "";
  accountStatus: OutreachAccount["status"] | "unknown";
  mailboxStatus: MailboxStatus | "unknown";
  threadCount: number;
  sourceTypes: Array<ReplyThread["sourceType"]>;
  lastSyncedAt: string;
  lastError: string;
  primary: boolean;
};

export type ReplyThreadFeedbackType =
  | "good"
  | "wrong_move"
  | "wrong_facts"
  | "too_aggressive"
  | "should_be_human";

export type ReplyThreadFeedback = {
  id: string;
  threadId: string;
  brandId: string;
  type: ReplyThreadFeedbackType;
  note: string;
  createdAt: string;
};

export type InboxSyncState = {
  brandId: string;
  mailboxAccountId: string;
  mailboxName: string;
  lastInboxUid: number;
  lastSyncedAt: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

export type InboxEvalScenarioCategory =
  | "normal"
  | "curveball"
  | "adversarial"
  | "long_running";

export type InboxEvalScenarioDifficulty = "easy" | "medium" | "hard";

export type InboxEvalScenario = {
  id: string;
  name: string;
  description: string;
  category: InboxEvalScenarioCategory;
  difficulty: InboxEvalScenarioDifficulty;
  seed: string;
  brandContext: {
    orgSummary: string;
    productSummary: string;
    offerSummary: string;
    desiredPath: string[];
    forbiddenClaims: string[];
    humanReviewTriggers: string[];
  };
  persona: {
    name: string;
    email: string;
    role: string;
    company: string;
    seniority: string;
    disposition: "friendly" | "skeptical" | "rushed" | "hostile" | "ambiguous";
    communicationStyle: string;
    hiddenTruths: string[];
    goals: string[];
    redLines: string[];
  };
  threadSetup: {
    initialSubject: string;
    initialBody: string;
    priorThreadHistory?: Array<{
      from: "brand" | "persona";
      subject?: string;
      body: string;
    }>;
    knownFacts: string[];
    unknownFacts: string[];
  };
  roleplayRules: {
    mustDo: string[];
    mustNotDo: string[];
    allowedCurveballs: string[];
    escalationTraps: string[];
    maxTurns: number;
    stopConditions: string[];
  };
  expectedBehavior: {
    idealMoves: string[];
    acceptableMoves: string[];
    badMoves: string[];
    mustCaptureFacts: string[];
    mustAvoid: string[];
    successCondition: string;
    failureConditions: string[];
  };
  scoring: {
    safetyWeight: number;
    strategyWeight: number;
    stateWeight: number;
    outcomeWeight: number;
  };
};

export type InboxEvalScoreDimension = {
  score: number;
  notes: string[];
};

export type InboxEvalScorecard = {
  overall: number;
  safety: InboxEvalScoreDimension & {
    respectedOptOut: boolean;
    avoidedHallucinatedClaims: boolean;
    escalatedWhenRequired: boolean;
    avoidedPolicyViolation: boolean;
  };
  strategy: InboxEvalScoreDimension & {
    understoodUserAsk: number;
    choseRightMove: number;
    maintainedDesiredPath: number;
    handledObjectionQuality: number;
    pressureCalibration: number;
  };
  state: InboxEvalScoreDimension & {
    factExtractionAccuracy: number;
    objectionTrackingAccuracy: number;
    commitmentTrackingAccuracy: number;
    memoryConsistency: number;
  };
  outcome: InboxEvalScoreDimension & {
    resolvedCorrectly: number;
    unnecessaryEscalationPenalty: number;
    unnecessarySilencePenalty: number;
    recoveredFromCurveball: number;
  };
  verdict: "pass" | "borderline" | "fail";
  failureType:
    | "none"
    | "safety_miss"
    | "bad_move"
    | "state_miss"
    | "memory_drift"
    | "draft_quality"
    | "escalation_error"
    | "retrieval_or_context_miss";
  summary: string;
};

export type InboxEvalTranscriptItem = {
  id: string;
  turn: number;
  actor: "persona" | "manager" | "system";
  direction: "inbound" | "outbound" | "meta";
  subject: string;
  body: string;
  at: string;
  decision?: ReplyThreadStateDecision | null;
  stateSummary?: ReplyThreadStateSummary | null;
};

export type InboxEvalRun = {
  id: string;
  brandId: string;
  scenarioId: string;
  scenarioName: string;
  status: "running" | "completed" | "failed";
  seed: string;
  threadId: string;
  scenario: InboxEvalScenario;
  transcript: InboxEvalTranscriptItem[];
  scorecard: InboxEvalScorecard | null;
  lastError: string;
  startedAt: string;
  completedAt: string;
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
