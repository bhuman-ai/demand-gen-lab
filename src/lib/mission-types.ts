export type MissionStatus =
  | "draft"
  | "site_analyzing"
  | "plan_ready"
  | "starting"
  | "running"
  | "monitoring"
  | "learning"
  | "deliverability_blocked"
  | "paused"
  | "completed"
  | "failed";

export type MissionDeliverabilityStage =
  | "not_checked"
  | "preparing_inboxes"
  | "warming_domains"
  | "testing_inbox_placement"
  | "ready"
  | "needs_attention";

export type MissionRiskLevel = "read" | "safe_write" | "guarded_write" | "blocked";

export type MissionDeliverabilityPlan = {
  summary: string;
  inboxStrategy: string;
  domainStrategy: string;
  warmupStrategy: string;
  inboxPlacementTest: string;
  dailyRamp: string;
  autoProvisioning: boolean;
};

export type MissionLearningPlan = {
  summary: string;
  signalsToWatch: string[];
  automaticChanges: string[];
  approvalRequiredFor: string[];
};

export type MissionPlan = {
  offerSummary: string;
  targetCustomers: string[];
  avoidList: string[];
  outreachAngle: string;
  firstBatchSize: number;
  primaryRisk: string;
  successCriteria: string;
  sampleMessage: string;
  deliverabilityPlan: MissionDeliverabilityPlan;
  learningPlan: MissionLearningPlan;
};

export type MissionApprovalPolicy = {
  planApprovedAt: string;
  firstBatchLimit: number;
  allowAutoScale: boolean;
  requireApprovalForNewAudience: boolean;
  requireApprovalForNewClaim: boolean;
  requireApprovalForNewDomainPurchase: boolean;
};

export type MissionDeliverabilityState = {
  stage: MissionDeliverabilityStage;
  summary: string;
  primaryBlocker: string;
  senderCount: number;
  readySenderCount: number;
  warmingSenderCount: number;
  lastCheckedAt: string;
};

export type MissionMetricsSummary = {
  sent: number;
  scheduled: number;
  replies: number;
  positiveReplies: number;
  bounced: number;
  failed: number;
};

export type Mission = {
  id: string;
  brandId: string;
  status: MissionStatus;
  websiteUrl: string;
  targetCustomerText: string;
  generatedPlan: MissionPlan;
  approvedPlan: MissionPlan;
  approvalPolicy: MissionApprovalPolicy;
  deliverabilityState: MissionDeliverabilityState;
  metricsSummary: MissionMetricsSummary;
  currentExperimentId: string;
  currentRuntimeCampaignId: string;
  currentRuntimeExperimentId: string;
  currentRunId: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

export type MissionEvent = {
  id: string;
  missionId: string;
  brandId: string;
  eventType: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type MissionAgentDecision = {
  id: string;
  missionId: string;
  brandId: string;
  agent: string;
  action: string;
  rationale: string;
  riskLevel: MissionRiskLevel;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  createdAt: string;
};

export type MissionLearning = {
  id: string;
  missionId: string;
  brandId: string;
  learningType: string;
  summary: string;
  confidence: number;
  evidence: Record<string, unknown>;
  recommendedAction: string;
  appliedAt: string;
  createdAt: string;
};

export type MissionChannel = "email" | "linkedin";

export type MissionChannelProvider = "lastb2b" | "leadr";

export type MissionChannelRunStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "blocked";

export type MissionChannelTouchType =
  | "status"
  | "linkedin_invite"
  | "linkedin_message"
  | "linkedin_reply"
  | "linkedin_accept"
  | "linkedin_comment"
  | "linkedin_like";

export type MissionChannelTouchStatus =
  | "queued"
  | "sent"
  | "accepted"
  | "replied"
  | "failed"
  | "skipped"
  | "unknown";

export type MissionChannelRun = {
  id: string;
  missionId: string;
  brandId: string;
  channel: MissionChannel;
  provider: MissionChannelProvider;
  providerCampaignId: string;
  providerAccountId: string;
  providerUserId: string;
  status: MissionChannelRunStatus;
  name: string;
  sourceRunId: string;
  sourceCampaignId: string;
  sourceExperimentId: string;
  targetSummary: string;
  message: string;
  limits: Record<string, unknown>;
  providerPayload: Record<string, unknown>;
  lastSyncAt: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

export type MissionChannelTouch = {
  id: string;
  channelRunId: string;
  missionId: string;
  brandId: string;
  leadId: string;
  channel: MissionChannel;
  provider: MissionChannelProvider;
  providerEventId: string;
  providerProfileUrl: string;
  providerPersonName: string;
  touchType: MissionChannelTouchType;
  status: MissionChannelTouchStatus;
  message: string;
  raw: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
};

export type MissionDetail = {
  mission: Mission;
  events: MissionEvent[];
  decisions: MissionAgentDecision[];
  learnings: MissionLearning[];
};
