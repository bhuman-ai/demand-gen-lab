import { createGrowthToolCall, updateGrowthToolCall } from "@/lib/growth-tool-data";
import type {
  GrowthToolCapability,
  GrowthToolCategory,
  GrowthToolContext,
  GrowthToolRisk,
  GrowthToolRunResult,
  GrowthToolSchema,
  GrowthToolSpec,
} from "@/lib/growth-tool-types";
import { createMissionAgentDecision } from "@/lib/mission-data";
import type { MissionRiskLevel } from "@/lib/mission-types";
import { getOperatorToolSpec } from "@/lib/operator-tools";
import type { OperatorToolName } from "@/lib/operator-types";

type OperatorGrowthToolDefinition = {
  name: string;
  operatorToolName: OperatorToolName;
  title: string;
  description: string;
  provider: string;
  category: GrowthToolCategory;
  capability: GrowthToolCapability;
  risk?: Partial<GrowthToolRisk>;
  inputSchema: GrowthToolSchema;
};

const OPERATOR_TOOL_DEFINITIONS: OperatorGrowthToolDefinition[] = [
  {
    name: "lastb2b.brand.snapshot",
    operatorToolName: "get_brand_snapshot",
    title: "Inspect brand state",
    description: "Read senders, campaigns, experiments, leads, inbox, and blockers for a brand.",
    provider: "lastb2b",
    category: "analytics",
    capability: "inspect_state",
    inputSchema: objectSchema({ brandId: stringProp("Brand id") }, ["brandId"]),
  },
  {
    name: "lastb2b.sender.snapshot",
    operatorToolName: "get_sender_snapshot",
    title: "Inspect sender state",
    description: "Read one sender's setup, deliverability, routing, and brand attachments.",
    provider: "lastb2b",
    category: "sender_infra",
    capability: "inspect_state",
    inputSchema: objectSchema({ accountId: stringProp("Sender account id") }, ["accountId"]),
  },
  {
    name: "gmail_ui.account.observe",
    operatorToolName: "gmail_ui_observe_account",
    title: "Observe Gmail UI session",
    description: "Inspect the live Gmail UI worker browser state for a sender account.",
    provider: "gmail_ui_worker",
    category: "sender_infra",
    capability: "inspect_state",
    inputSchema: objectSchema({ accountId: stringProp("Sender account id") }, ["accountId"]),
  },
  {
    name: "gmail_ui.mailbox.search",
    operatorToolName: "gmail_ui_search_mailbox",
    title: "Search Gmail UI mailbox",
    description: "Search a live Gmail mailbox through the worker using Gmail search syntax.",
    provider: "gmail_ui_worker",
    category: "analytics",
    capability: "inspect_state",
    inputSchema: objectSchema(
      {
        accountId: stringProp("Sender account id"),
        query: stringProp("Gmail search query"),
      },
      ["accountId", "query"]
    ),
  },
  {
    name: "gmail_ui.sent.verify",
    operatorToolName: "gmail_ui_verify_sent",
    title: "Verify Gmail UI sent mail",
    description: "Verify that a specific expected message appears in Gmail Sent Mail.",
    provider: "gmail_ui_worker",
    category: "deliverability",
    capability: "inspect_state",
    inputSchema: objectSchema(
      {
        accountId: stringProp("Sender account id"),
        recipient: stringProp("Recipient email"),
        subject: stringProp("Expected subject"),
        body: stringProp("Expected message body or distinctive body phrase"),
      },
      ["accountId", "recipient"]
    ),
  },
  {
    name: "gmail_ui.message.send",
    operatorToolName: "gmail_ui_send_message",
    title: "Send Gmail UI message",
    description: "Send through the live Gmail UI worker and only report success after Sent Mail verification.",
    provider: "gmail_ui_worker",
    category: "channel",
    capability: "control_campaign",
    risk: { reputationRisk: true },
    inputSchema: objectSchema(
      {
        accountId: stringProp("Sender account id"),
        recipient: stringProp("Recipient email"),
        subject: stringProp("Email subject"),
        body: stringProp("Email body"),
        expectedFrom: stringProp("Expected sender email"),
      },
      ["accountId", "recipient", "subject", "body"]
    ),
  },
  {
    name: "gmail_ui.session.close",
    operatorToolName: "gmail_ui_close_session",
    title: "Close Gmail UI session",
    description: "Close a live Gmail UI worker browser session for a sender account.",
    provider: "gmail_ui_worker",
    category: "sender_infra",
    capability: "refresh_sender",
    inputSchema: objectSchema({ accountId: stringProp("Sender account id") }, ["accountId"]),
  },
  {
    name: "lastb2b.campaign.status",
    operatorToolName: "summarize_campaign_status",
    title: "Summarize campaign status",
    description: "Read campaign counts and latest run state for a brand or a specific promoted campaign.",
    provider: "lastb2b",
    category: "analytics",
    capability: "inspect_state",
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        campaignId: stringProp("Optional campaign id"),
      },
      ["brandId"]
    ),
  },
  {
    name: "lastb2b.campaign.snapshot",
    operatorToolName: "get_campaign_snapshot",
    title: "Inspect campaign state",
    description: "Read one promoted campaign, including run state, source experiment, and scale settings.",
    provider: "lastb2b",
    category: "analytics",
    capability: "inspect_state",
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        campaignId: stringProp("Campaign id"),
      },
      ["brandId", "campaignId"]
    ),
  },
  {
    name: "lastb2b.experiments.summary",
    operatorToolName: "summarize_experiments",
    title: "Summarize experiments",
    description: "Read experiment counts and readiness for a brand.",
    provider: "lastb2b",
    category: "analytics",
    capability: "inspect_state",
    inputSchema: objectSchema({ brandId: stringProp("Brand id") }, ["brandId"]),
  },
  {
    name: "lastb2b.experiment.snapshot",
    operatorToolName: "get_experiment_snapshot",
    title: "Inspect experiment state",
    description: "Read one experiment, including runtime mapping and recent runs.",
    provider: "lastb2b",
    category: "analytics",
    capability: "inspect_state",
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        experimentId: stringProp("Experiment id"),
      },
      ["brandId", "experimentId"]
    ),
  },
  {
    name: "lastb2b.leads.summary",
    operatorToolName: "summarize_leads",
    title: "Summarize lead state",
    description: "Read brand leads and their current statuses.",
    provider: "lastb2b",
    category: "analytics",
    capability: "inspect_state",
    inputSchema: objectSchema({ brandId: stringProp("Brand id") }, ["brandId"]),
  },
  {
    name: "lastb2b.inbox.summary",
    operatorToolName: "summarize_inbox",
    title: "Summarize reply inbox",
    description: "Read reply threads, draft replies, sentiment, and recent inbox activity for a brand.",
    provider: "lastb2b",
    category: "analytics",
    capability: "inspect_state",
    inputSchema: objectSchema({ brandId: stringProp("Brand id") }, ["brandId"]),
  },
  {
    name: "mailpool.sender.refresh",
    operatorToolName: "refresh_mailpool_sender",
    title: "Refresh Mailpool sender",
    description: "Sync Mailpool sender state and kick deliverability checks.",
    provider: "mailpool",
    category: "sender_infra",
    capability: "refresh_sender",
    inputSchema: objectSchema({ accountId: stringProp("Sender account id") }, ["accountId"]),
  },
  {
    name: "mailpool.sender.provision",
    operatorToolName: "provision_mailpool_sender",
    title: "Provision Mailpool sender",
    description: "Buy or attach a domain, create a sender mailbox, and attach it to a brand.",
    provider: "mailpool",
    category: "sender_infra",
    capability: "provision_sender",
    risk: { spendRisk: true },
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        domainMode: enumProp(["existing", "register"], "Use existing domain or register a new one"),
        domain: stringProp("Sender domain"),
        fromLocalPart: stringProp("Mailbox local-part"),
        senderFirstName: stringProp("Real sender first name"),
        senderLastName: stringProp("Real sender last name"),
        accountName: stringProp("Account name"),
      },
      ["brandId", "domainMode", "domain", "fromLocalPart", "senderFirstName", "senderLastName"]
    ),
  },
  {
    name: "experiment.create",
    operatorToolName: "create_experiment",
    title: "Create outreach experiment",
    description: "Create an experiment from an offer, audience, and test envelope.",
    provider: "lastb2b",
    category: "strategy",
    capability: "record_learning",
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        name: stringProp("Experiment name"),
        audience: stringProp("Audience to test"),
        offer: stringProp("Offer or angle to test"),
      },
      ["brandId", "name", "audience", "offer"]
    ),
  },
  {
    name: "experiment.update",
    operatorToolName: "update_experiment",
    title: "Update outreach experiment",
    description: "Update experiment copy, audience, status, or test envelope.",
    provider: "lastb2b",
    category: "strategy",
    capability: "record_learning",
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        experimentId: stringProp("Experiment id"),
        name: stringProp("Optional experiment name"),
        audience: stringProp("Optional audience"),
        offer: stringProp("Optional offer"),
        status: enumProp(["draft", "ready", "running", "paused", "completed", "promoted", "archived"], "Optional status"),
        testEnvelope: objectProp("Optional test settings"),
      },
      ["brandId", "experimentId"]
    ),
  },
  {
    name: "experiment.launch_email_run",
    operatorToolName: "launch_experiment_run",
    title: "Launch experiment email run",
    description: "Launch a prepared email experiment run through LastB2B.",
    provider: "lastb2b",
    category: "channel",
    capability: "launch_campaign",
    risk: { reputationRisk: true },
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        experimentId: stringProp("Experiment id"),
      },
      ["brandId", "experimentId"]
    ),
  },
  {
    name: "experiment.control_email_run",
    operatorToolName: "control_experiment_run",
    title: "Control experiment email run",
    description: "Pause, resume, or cancel an experiment run.",
    provider: "lastb2b",
    category: "channel",
    capability: "control_campaign",
    risk: { reputationRisk: true },
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        experimentId: stringProp("Experiment id"),
        runId: stringProp("Optional run id"),
        action: enumProp(["pause", "resume", "cancel"], "Control action"),
        reason: stringProp("Reason for the action"),
      },
      ["brandId", "experimentId", "action"]
    ),
  },
  {
    name: "campaign.promote_experiment",
    operatorToolName: "promote_experiment_to_campaign",
    title: "Promote experiment to campaign",
    description: "Promote a tested experiment into a reusable promoted campaign.",
    provider: "lastb2b",
    category: "strategy",
    capability: "record_learning",
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        experimentId: stringProp("Experiment id"),
        campaignName: stringProp("Optional campaign name"),
      },
      ["brandId", "experimentId"]
    ),
  },
  {
    name: "campaign.update",
    operatorToolName: "update_campaign",
    title: "Update promoted campaign",
    description: "Update campaign name, status, scale policy, or sender assignment.",
    provider: "lastb2b",
    category: "strategy",
    capability: "record_learning",
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        campaignId: stringProp("Campaign id"),
        name: stringProp("Optional campaign name"),
        status: enumProp(["draft", "active", "paused", "completed", "archived"], "Optional status"),
        accountId: stringProp("Optional sender account id"),
        mailboxAccountId: stringProp("Optional mailbox account id"),
        scalePolicy: objectProp("Optional scale policy"),
      },
      ["brandId", "campaignId"]
    ),
  },
  {
    name: "campaign.launch_email_run",
    operatorToolName: "launch_campaign_run",
    title: "Launch campaign email run",
    description: "Launch a promoted campaign run through LastB2B.",
    provider: "lastb2b",
    category: "channel",
    capability: "launch_campaign",
    risk: { reputationRisk: true },
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        campaignId: stringProp("Campaign id"),
      },
      ["brandId", "campaignId"]
    ),
  },
  {
    name: "campaign.control_email_run",
    operatorToolName: "control_campaign_run",
    title: "Control email campaign run",
    description: "Pause, resume, cancel, or request deliverability action for an email campaign run.",
    provider: "lastb2b",
    category: "channel",
    capability: "control_campaign",
    risk: { reputationRisk: true },
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        campaignId: stringProp("Campaign id"),
        runId: stringProp("Run id"),
        action: enumProp(
          ["pause", "resume", "cancel", "probe_deliverability", "resume_sender_deliverability", "seed_inbox_placement"],
          "Control action"
        ),
        reason: stringProp("Reason for the action"),
      },
      ["brandId", "campaignId", "action"]
    ),
  },
  {
    name: "reply.send_draft",
    operatorToolName: "send_reply_draft",
    title: "Send reply draft",
    description: "Send an approved inbox reply draft.",
    provider: "lastb2b",
    category: "channel",
    capability: "control_campaign",
    risk: { reputationRisk: true },
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        draftId: stringProp("Reply draft id"),
      },
      ["brandId", "draftId"]
    ),
  },
  {
    name: "leadr.linkedin.snapshot",
    operatorToolName: "get_leadr_snapshot",
    title: "Inspect Leadr LinkedIn channel",
    description: "Read Leadr configuration, connected LinkedIn accounts, channel runs, and recent touches.",
    provider: "leadr",
    category: "channel",
    capability: "inspect_state",
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        userId: stringProp("Leadr user id"),
      },
      []
    ),
  },
  {
    name: "leadr.linkedin.list_accounts",
    operatorToolName: "list_leadr_accounts",
    title: "List Leadr LinkedIn accounts",
    description: "List connected LinkedIn accounts and runnable status.",
    provider: "leadr",
    category: "channel",
    capability: "inspect_state",
    inputSchema: objectSchema({ userId: stringProp("Leadr user id") }, []),
  },
  {
    name: "leadr.linkedin.create_auth_link",
    operatorToolName: "create_leadr_auth_link",
    title: "Create LinkedIn auth link",
    description: "Create a hosted connection link for a user-supplied LinkedIn account.",
    provider: "leadr",
    category: "channel",
    capability: "control_campaign",
    inputSchema: objectSchema(
      {
        userId: stringProp("Leadr user id"),
        redirectUrl: stringProp("Redirect URL after LinkedIn connection"),
      },
      []
    ),
  },
  {
    name: "leadr.linkedin.create_campaign",
    operatorToolName: "create_leadr_campaign",
    title: "Launch Leadr LinkedIn campaign",
    description: "Launch a LinkedIn campaign through Leadr using actual campaign copy.",
    provider: "leadr",
    category: "channel",
    capability: "launch_campaign",
    risk: { reputationRisk: true },
    inputSchema: objectSchema(
      {
        brandId: stringProp("Brand id"),
        missionId: stringProp("Mission id"),
        userId: stringProp("Leadr user id"),
        accountId: stringProp("Leadr LinkedIn account id"),
        campaignUrl: stringProp("LinkedIn search/campaign URL"),
        managedTableId: stringProp("Optional EnrichAnything managed table id"),
        name: stringProp("Campaign name"),
        message: stringProp("Actual outreach message copy"),
        limit: numberProp("Maximum target count"),
        workflowActionOrder: arrayProp("Workflow actions such as invite,message"),
      },
      ["brandId", "accountId", "message"]
    ),
  },
  {
    name: "leadr.linkedin.sync_campaign",
    operatorToolName: "sync_leadr_campaign",
    title: "Sync Leadr campaign",
    description: "Sync status, touches, and replies for a Leadr LinkedIn campaign.",
    provider: "leadr",
    category: "analytics",
    capability: "sync_results",
    inputSchema: objectSchema(
      {
        channelRunId: stringProp("LastB2B Leadr channel run id"),
        userId: stringProp("Leadr user id"),
      },
      ["channelRunId"]
    ),
  },
  {
    name: "leadr.linkedin.resume_campaign",
    operatorToolName: "resume_leadr_campaign",
    title: "Resume Leadr campaign",
    description: "Resume a halted Leadr LinkedIn campaign.",
    provider: "leadr",
    category: "channel",
    capability: "control_campaign",
    risk: { reputationRisk: true },
    inputSchema: objectSchema(
      {
        channelRunId: stringProp("LastB2B Leadr channel run id"),
        userId: stringProp("Leadr user id"),
      },
      ["channelRunId"]
    ),
  },
];

function stringProp(description: string) {
  return { type: "string", description };
}

function numberProp(description: string) {
  return { type: "number", description };
}

function arrayProp(description: string) {
  return { type: "array", description, items: { type: "string" } };
}

function objectProp(description: string) {
  return { type: "object", description, additionalProperties: true };
}

function enumProp(values: string[], description: string) {
  return { type: "string", enum: values, description };
}

function objectSchema(properties: Record<string, unknown>, required: string[]): GrowthToolSchema {
  return {
    type: "object",
    additionalProperties: true,
    properties,
    required,
  };
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function operatorRiskToMissionRisk(value: unknown): MissionRiskLevel {
  const normalized = asString(value);
  return ["read", "safe_write", "guarded_write", "blocked"].includes(normalized)
    ? (normalized as MissionRiskLevel)
    : "read";
}

function estimateCostUsd(tool: GrowthToolSpec, input: Record<string, unknown>) {
  if (!tool.costPolicy) return 0;
  const units = Math.max(0, Math.min(Number(input.limit ?? input.count ?? 1) || 1, tool.costPolicy.maxUnitsPerCall));
  return Math.round(units * tool.costPolicy.estimatedUnitCostUsd * 10000) / 10000;
}

function validateRequiredInput(tool: GrowthToolSpec, input: Record<string, unknown>) {
  const missing = (tool.inputSchema.required ?? []).filter((key) => !asString(input[key]));
  if (missing.length) {
    throw new Error(`${tool.name} missing required input: ${missing.join(", ")}`);
  }
}

function buildOperatorGrowthTool(definition: OperatorGrowthToolDefinition): GrowthToolSpec {
  const operatorTool = getOperatorToolSpec(definition.operatorToolName);
  const baseRisk = operatorRiskToMissionRisk(operatorTool?.riskLevel);
  const risk: GrowthToolRisk = {
    riskLevel: definition.risk?.riskLevel ?? baseRisk,
    spendRisk: definition.risk?.spendRisk ?? false,
    reputationRisk: definition.risk?.reputationRisk ?? false,
    requiresApproval: definition.risk?.requiresApproval ?? operatorTool?.approvalMode === "confirm",
  };
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    provider: definition.provider,
    category: definition.category,
    capability: definition.capability,
    risk,
    inputSchema: definition.inputSchema,
    enabled: () => Boolean(getOperatorToolSpec(definition.operatorToolName)),
    run: async (input, context) => {
      const tool = getOperatorToolSpec(definition.operatorToolName);
      if (!tool) throw new Error(`Operator tool ${definition.operatorToolName} is not available.`);
      const mergedInput = {
        ...(context.brandId ? { brandId: context.brandId } : {}),
        ...(context.missionId ? { missionId: context.missionId } : {}),
        ...input,
      };
      const result = await tool.run(mergedInput);
      return {
        summary: result.summary,
        output: {
          ...result.result,
          receipt: result.receipt ?? null,
          operatorToolName: definition.operatorToolName,
        },
      };
    },
  };
}

export function listGrowthToolSpecs() {
  return OPERATOR_TOOL_DEFINITIONS.map(buildOperatorGrowthTool);
}

export function getGrowthToolSpec(name: string) {
  const normalized = asString(name);
  if (!normalized) return null;
  return listGrowthToolSpecs().find((tool) => tool.name === normalized) ?? null;
}

export function listGrowthToolCatalog() {
  return listGrowthToolSpecs().map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    provider: tool.provider,
    category: tool.category,
    capability: tool.capability,
    enabled: tool.enabled(),
    risk: tool.risk,
    costPolicy: tool.costPolicy ?? null,
    inputSchema: tool.inputSchema,
  }));
}

function blockedReasonForRisk(tool: GrowthToolSpec, context: GrowthToolContext) {
  if (!tool.enabled()) return "Tool is not enabled in this runtime.";
  if (tool.risk.riskLevel === "blocked") return "Tool risk level is blocked.";
  if (tool.risk.riskLevel === "safe_write" && !context.guardrails.allowSafeWrite) {
    return "Safe-write growth tools are disabled by guardrails.";
  }
  if (tool.risk.riskLevel === "guarded_write" && !context.guardrails.allowGuardedWrite) {
    return "Guarded-write growth tools require explicit guardrail enablement.";
  }
  if (tool.risk.spendRisk && !context.guardrails.allowSpendRisk) {
    return "Spend-risk growth tools require explicit budget guardrail enablement.";
  }
  if (tool.risk.reputationRisk && !context.guardrails.allowReputationRisk) {
    return "Reputation-risk growth tools require explicit reputation guardrail enablement.";
  }
  return "";
}

export async function invokeGrowthTool(input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  context: GrowthToolContext;
}): Promise<GrowthToolRunResult & { callId: string; status: "completed" | "blocked" | "dry_run" }> {
  const tool = getGrowthToolSpec(input.toolName);
  if (!tool) {
    const call = await createGrowthToolCall({
      brandId: input.context.brandId,
      missionId: input.context.missionId,
      toolName: input.toolName,
      provider: "",
      category: "",
      capability: "",
      riskLevel: "blocked",
      status: "blocked",
      agent: input.context.agent,
      rationale: input.context.rationale,
      input: input.toolInput,
      output: {},
      error: "Growth tool is not registered.",
      dryRun: input.context.dryRun,
      spendRisk: false,
      reputationRisk: false,
      estimatedCostUsd: 0,
    });
    return {
      callId: call.id,
      status: "blocked",
      summary: "Growth tool is not registered.",
      output: { error: call.error },
    };
  }

  const estimatedCostUsd = estimateCostUsd(tool, input.toolInput);
  const call = await createGrowthToolCall({
    brandId: input.context.brandId,
    missionId: input.context.missionId,
    toolName: tool.name,
    provider: tool.provider,
    category: tool.category,
    capability: tool.capability,
    riskLevel: tool.risk.riskLevel,
    status: "running",
    agent: input.context.agent,
    rationale: input.context.rationale,
    input: input.toolInput,
    output: {},
    error: "",
    dryRun: input.context.dryRun,
    spendRisk: tool.risk.spendRisk,
    reputationRisk: tool.risk.reputationRisk,
    estimatedCostUsd,
  });

  try {
    validateRequiredInput(tool, input.toolInput);
    const blockedReason = blockedReasonForRisk(tool, input.context);
    if (blockedReason) {
      await updateGrowthToolCall(call.id, {
        status: "blocked",
        output: { blockedReason },
        error: blockedReason,
      });
      return {
        callId: call.id,
        status: "blocked",
        summary: blockedReason,
        output: { blockedReason },
      };
    }
    if (input.context.dryRun && tool.risk.riskLevel !== "read") {
      const output = {
        dryRun: true,
        tool: tool.name,
        wouldRun: true,
        estimatedCostUsd,
      };
      await updateGrowthToolCall(call.id, { status: "dry_run", output });
      return {
        callId: call.id,
        status: "dry_run",
        summary: `Dry run: ${tool.title} would run.`,
        output,
      };
    }

    const result = await tool.run(input.toolInput, input.context);
    await updateGrowthToolCall(call.id, {
      status: "completed",
      output: result.output,
      estimatedCostUsd,
    });
    if (input.context.missionId && input.context.brandId) {
      await createMissionAgentDecision({
        missionId: input.context.missionId,
        brandId: input.context.brandId,
        agent: input.context.agent,
        action: `growth_tool:${tool.name}`,
        rationale: input.context.rationale,
        riskLevel: tool.risk.riskLevel,
        input: input.toolInput,
        output: {
          callId: call.id,
          summary: result.summary,
          toolName: tool.name,
        },
      }).catch(() => null);
    }
    return {
      callId: call.id,
      status: "completed",
      ...result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Growth tool execution failed.";
    await updateGrowthToolCall(call.id, {
      status: "failed",
      output: {},
      error: message,
    });
    throw error;
  }
}
