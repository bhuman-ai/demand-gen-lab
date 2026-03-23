export type OperatorThreadStatus = "active" | "archived";

export type OperatorMessageRole = "user" | "assistant" | "tool" | "system";

export type OperatorMessageKind =
  | "message"
  | "tool_call"
  | "tool_result"
  | "approval_request"
  | "receipt"
  | "system_note";

export type OperatorRunStatus = "running" | "completed" | "failed" | "canceled";

export type OperatorRiskLevel = "read" | "safe_write" | "guarded_write" | "blocked";

export type OperatorApprovalMode = "none" | "confirm" | "blocked";

export type OperatorActionStatus =
  | "proposed"
  | "awaiting_approval"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "blocked";

export type OperatorApprovalDecision = "approved" | "rejected";

export type OperatorMemoryScopeType = "account" | "brand" | "thread";

export type OperatorMemorySensitivity = "normal" | "sensitive";

export type OperatorToolName =
  | "get_brand_snapshot"
  | "get_sender_snapshot"
  | "summarize_campaign_status"
  | "summarize_inbox"
  | "refresh_mailpool_sender"
  | "provision_mailpool_sender";

export type OperatorReceipt = {
  title: string;
  summary: string;
  details: string[];
};

export type OperatorThread = {
  id: string;
  userId: string;
  brandId: string;
  title: string;
  status: OperatorThreadStatus;
  lastSummary: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string;
};

export type OperatorMessage = {
  id: string;
  threadId: string;
  role: OperatorMessageRole;
  kind: OperatorMessageKind;
  content: Record<string, unknown>;
  createdAt: string;
};

export type OperatorRun = {
  id: string;
  threadId: string;
  brandId: string;
  status: OperatorRunStatus;
  model: string;
  contextSnapshot: Record<string, unknown>;
  plan: Array<Record<string, unknown>>;
  errorText: string;
  startedAt: string;
  completedAt: string;
};

export type OperatorAction = {
  id: string;
  runId: string;
  toolName: OperatorToolName;
  riskLevel: OperatorRiskLevel;
  approvalMode: OperatorApprovalMode;
  status: OperatorActionStatus;
  input: Record<string, unknown>;
  preview: Record<string, unknown>;
  result: Record<string, unknown>;
  undoPayload: Record<string, unknown>;
  errorText: string;
  createdAt: string;
  updatedAt: string;
};

export type OperatorApproval = {
  id: string;
  actionId: string;
  requestedByUserId: string;
  decidedByUserId: string;
  decision: OperatorApprovalDecision;
  note: string;
  createdAt: string;
};

export type OperatorMemory = {
  id: string;
  scopeType: OperatorMemoryScopeType;
  scopeId: string;
  memoryKey: string;
  value: Record<string, unknown>;
  source: string;
  confidence: number;
  sensitivity: OperatorMemorySensitivity;
  lastVerifiedAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type OperatorToolResult = {
  summary: string;
  result: Record<string, unknown>;
  receipt?: OperatorReceipt;
};

export type OperatorToolSpec = {
  name: OperatorToolName;
  riskLevel: OperatorRiskLevel;
  approvalMode: OperatorApprovalMode;
  description: string;
  previewTitle: string;
  buildPreview?: (input: Record<string, unknown>) => Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<OperatorToolResult>;
};

export type OperatorRequestedAction = {
  toolName: OperatorToolName;
  input: Record<string, unknown>;
};

export type OperatorChatRequest = {
  threadId?: string;
  userId?: string;
  brandId?: string;
  message: string;
  mode?: "default" | "recommendation_only";
  structuredAction?: OperatorRequestedAction | null;
};

export type OperatorChatAssistantReply = {
  summary: string;
  findings: string[];
  recommendations: string[];
};

export type OperatorActionSummary = Pick<
  OperatorAction,
  "id" | "toolName" | "riskLevel" | "approvalMode" | "status" | "preview"
>;

export type OperatorChatResponse = {
  thread: OperatorThread;
  run: Pick<OperatorRun, "id" | "status" | "model">;
  assistant: OperatorChatAssistantReply;
  actions: OperatorActionSummary[];
  messages: OperatorMessage[];
};

export type OperatorThreadDetail = {
  thread: OperatorThread;
  messages: OperatorMessage[];
  actions: OperatorAction[];
};
