import type { MissionRiskLevel } from "@/lib/mission-types";

export type GrowthToolCategory =
  | "strategy"
  | "lead_source"
  | "enrichment"
  | "validation"
  | "sender_infra"
  | "deliverability"
  | "channel"
  | "analytics"
  | "memory";

export type GrowthToolCapability =
  | "inspect_state"
  | "find_leads"
  | "prepare_leads"
  | "enrich_contacts"
  | "validate_contacts"
  | "provision_sender"
  | "refresh_sender"
  | "test_inbox_placement"
  | "launch_campaign"
  | "control_campaign"
  | "sync_results"
  | "record_learning";

export type GrowthToolCostPolicy = {
  estimatedUnitCostUsd: number;
  maxUnitsPerCall: number;
  budgetKey: string;
};

export type GrowthToolRisk = {
  riskLevel: MissionRiskLevel;
  spendRisk: boolean;
  reputationRisk: boolean;
  requiresApproval: boolean;
};

export type GrowthToolSchema = {
  type: "object";
  required?: string[];
  properties: Record<string, unknown>;
  additionalProperties?: boolean;
};

export type GrowthToolContext = {
  brandId: string;
  missionId: string;
  agent: string;
  rationale: string;
  dryRun: boolean;
  guardrails: {
    allowSafeWrite: boolean;
    allowGuardedWrite: boolean;
    allowSpendRisk: boolean;
    allowReputationRisk: boolean;
  };
};

export type GrowthToolRunResult = {
  summary: string;
  output: Record<string, unknown>;
};

export type GrowthToolSpec = {
  name: string;
  title: string;
  description: string;
  provider: string;
  category: GrowthToolCategory;
  capability: GrowthToolCapability;
  risk: GrowthToolRisk;
  costPolicy?: GrowthToolCostPolicy;
  inputSchema: GrowthToolSchema;
  enabled: () => boolean;
  run: (input: Record<string, unknown>, context: GrowthToolContext) => Promise<GrowthToolRunResult>;
};

export type GrowthToolCallStatus = "running" | "completed" | "failed" | "blocked" | "dry_run";

export type GrowthToolCall = {
  id: string;
  brandId: string;
  missionId: string;
  toolName: string;
  provider: string;
  category: GrowthToolCategory | "";
  capability: GrowthToolCapability | "";
  riskLevel: MissionRiskLevel;
  status: GrowthToolCallStatus;
  agent: string;
  rationale: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string;
  dryRun: boolean;
  spendRisk: boolean;
  reputationRisk: boolean;
  estimatedCostUsd: number;
  createdAt: string;
  completedAt: string;
};
