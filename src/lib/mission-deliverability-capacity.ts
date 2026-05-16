import { getBrandById } from "@/lib/factory-data";
import { getOutreachAccountFromEmail, getOutreachMailboxEmail } from "@/lib/outreach-account-helpers";
import {
  getBrandOutreachAssignment,
  listOutreachAccounts,
  listSenderLaunches,
  setBrandOutreachAssignment,
} from "@/lib/outreach-data";
import {
  getOutreachProvisioningSettings,
  getOutreachProvisioningSettingsSecrets,
} from "@/lib/outreach-provider-settings";
import {
  provisionSender,
  selectAvailableMailpoolDomain,
  type MailpoolDomainSelection,
} from "@/lib/outreach-provisioning";
import { resolveLlmModel } from "@/lib/llm-router";
import { createMissionAgentDecision, createMissionEvent } from "@/lib/mission-data";
import { inspectMissionDeliverability } from "@/lib/mission-learning";
import { loadBrandSenderLaunchView } from "@/lib/sender-launch";
import type { BrandRecord, OutreachAccount, SenderLaunch } from "@/lib/factory-types";
import type { Mission, MissionDeliverabilityState, MissionPlan, MissionRiskLevel } from "@/lib/mission-types";

type CapacityResult = {
  mission: Mission;
  deliverabilityState: MissionDeliverabilityState;
};

type MissionDeliverabilityToolName =
  | "inspect_state"
  | "assign_sender"
  | "provision_mailpool_sender"
  | "wait_for_warmup"
  | "block_for_policy";

type MissionDeliverabilityAgentPlan = {
  toolName: MissionDeliverabilityToolName;
  toolInput: Record<string, unknown>;
  rationale: string;
  expectedOutcome: string;
  riskLevel: MissionRiskLevel;
  model: string;
  raw: Record<string, unknown>;
};

type SenderSnapshot = {
  accountId: string;
  name: string;
  provider: OutreachAccount["provider"];
  accountType: OutreachAccount["accountType"];
  status: OutreachAccount["status"];
  fromEmail: string;
  replyToEmail: string;
  domain: string;
  outboundEnabled: boolean;
  hasCredentials: boolean;
  lastTestStatus: OutreachAccount["lastTestStatus"];
  assigned: boolean;
  launch: {
    id: string;
    state: SenderLaunch["state"];
    readinessScore: number;
    dailyCap: number;
    summary: string;
    nextStep: string;
    pausedUntil: string;
    pauseReason: string;
  } | null;
};

type MissionDeliverabilitySnapshot = {
  mission: {
    id: string;
    brandId: string;
    status: Mission["status"];
    websiteUrl: string;
    targetCustomerText: string;
    approvedPlan: MissionPlan;
  };
  brand: {
    id: string;
    name: string;
    website: string;
    product: string;
    targetMarkets: string[];
    idealCustomerProfiles: string[];
  };
  approvalPolicy: Mission["approvalPolicy"];
  deliverabilityState: MissionDeliverabilityState;
  assignment: {
    accountId: string;
    accountIds: string[];
    mailboxAccountId: string;
  };
  senders: SenderSnapshot[];
  senderLaunches: Array<{
    id: string;
    senderAccountId: string;
    fromEmail: string;
    domain: string;
    state: SenderLaunch["state"];
    readinessScore: number;
    dailyCap: number;
    summary: string;
    nextStep: string;
  }>;
  provisioning: {
    provider: "mailpool";
    hasMailpoolApiKey: boolean;
    hasCustomerIoSiteId: boolean;
    hasCustomerIoTrackingKey: boolean;
    hasCustomerIoAppKey: boolean;
    mailpoolWebhookConfigured: boolean;
    deliverabilityProvider: string;
  };
  guardrails: {
    canAutoProvisionSender: boolean;
    canAutoBuyDomain: boolean;
    requireApprovalForNewDomainPurchase: boolean;
    maxAutoProvisionedSenders: number;
    maxAutoDomainSpendUsd: number;
    activeProvisioningSenderCount: number;
    allowedToolNames: MissionDeliverabilityToolName[];
  };
};

type ToolExecutionResult = {
  ok: boolean;
  summary: string;
  riskLevel: MissionRiskLevel;
  result: Record<string, unknown>;
};

const TOOL_NAMES: MissionDeliverabilityToolName[] = [
  "inspect_state",
  "assign_sender",
  "provision_mailpool_sender",
  "wait_for_warmup",
  "block_for_policy",
];

function nowIso() {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asString(entry)).filter(Boolean);
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function emailDomain(email: string) {
  return normalizeDomain(email.split("@")[1] ?? "");
}

function normalizeEmailLocalPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._+-]/g, "")
    .replace(/^\.+|\.+$/g, "");
}

function isValidDomain(value: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value);
}

function outboundEnabled(account: OutreachAccount) {
  const config = asRecord(account.config);
  const outbound = asRecord(config.outbound);
  return outbound.enabled === false ? false : true;
}

function launchIsActiveCapacity(launch: SenderLaunch) {
  return ["setup", "observing", "warming", "restricted_send", "ready"].includes(launch.state);
}

function compactBrand(brand: BrandRecord | null, mission: Mission): MissionDeliverabilitySnapshot["brand"] {
  return {
    id: brand?.id ?? mission.brandId,
    name: brand?.name ?? "Brand",
    website: brand?.website || mission.websiteUrl,
    product: brand?.product ?? "",
    targetMarkets: brand?.targetMarkets ?? [],
    idealCustomerProfiles: brand?.idealCustomerProfiles ?? [],
  };
}

function extractResponseText(payload: unknown) {
  const row = asRecord(payload);
  if (typeof row.output_text === "string") return row.output_text;
  const output = Array.isArray(row.output) ? row.output : [];
  for (const item of output) {
    const content = asRecord(item).content;
    if (!Array.isArray(content)) continue;
    for (const contentItem of content) {
      const text = asRecord(contentItem).text;
      if (typeof text === "string") return text;
    }
  }
  return "";
}

function riskForTool(toolName: MissionDeliverabilityToolName): MissionRiskLevel {
  if (toolName === "assign_sender" || toolName === "provision_mailpool_sender") return "guarded_write";
  if (toolName === "block_for_policy") return "blocked";
  return "read";
}

function allowedToolNames(snapshot: MissionDeliverabilitySnapshot): MissionDeliverabilityToolName[] {
  const names: MissionDeliverabilityToolName[] = ["inspect_state", "wait_for_warmup", "block_for_policy"];
  if (snapshot.senders.some((sender) => sender.status === "active" && sender.fromEmail)) {
    names.push("assign_sender");
  }
  if (
    snapshot.guardrails.canAutoProvisionSender &&
    snapshot.guardrails.canAutoBuyDomain &&
    snapshot.guardrails.activeProvisioningSenderCount < snapshot.guardrails.maxAutoProvisionedSenders &&
    snapshot.provisioning.hasMailpoolApiKey
  ) {
    names.push("provision_mailpool_sender");
  }
  return names;
}

function summarizeSender(
  account: OutreachAccount,
  launch: SenderLaunch | null,
  assignedAccountIds: string[]
): SenderSnapshot {
  const fromEmail = getOutreachAccountFromEmail(account).toLowerCase();
  const replyToEmail = getOutreachMailboxEmail(account).toLowerCase() || account.config.customerIo.replyToEmail.toLowerCase();
  return {
    accountId: account.id,
    name: account.name,
    provider: account.provider,
    accountType: account.accountType,
    status: account.status,
    fromEmail,
    replyToEmail,
    domain: emailDomain(fromEmail),
    outboundEnabled: outboundEnabled(account),
    hasCredentials: account.hasCredentials,
    lastTestStatus: account.lastTestStatus,
    assigned: assignedAccountIds.includes(account.id),
    launch: launch
      ? {
          id: launch.id,
          state: launch.state,
          readinessScore: launch.readinessScore,
          dailyCap: launch.dailyCap,
          summary: launch.summary,
          nextStep: launch.nextStep,
          pausedUntil: launch.pausedUntil,
          pauseReason: launch.pauseReason,
        }
      : null,
  };
}

async function buildMissionDeliverabilitySnapshot(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
}): Promise<MissionDeliverabilitySnapshot> {
  await loadBrandSenderLaunchView(input.mission.brandId).catch(() => null);

  const [brand, assignment, accounts, launches, settings, secrets, deliverabilityState] = await Promise.all([
    getBrandById(input.mission.brandId, { includeEmbedded: true }).catch(() => null),
    getBrandOutreachAssignment(input.mission.brandId).catch(() => null),
    listOutreachAccounts().catch(() => []),
    listSenderLaunches({ brandId: input.mission.brandId }, { allowMissingTable: true }).catch(() => []),
    getOutreachProvisioningSettings(),
    getOutreachProvisioningSettingsSecrets(),
    inspectMissionDeliverability(input.mission.brandId),
  ]);

  const assignedAccountIds = assignment?.accountIds?.length
    ? assignment.accountIds
    : assignment?.accountId
      ? [assignment.accountId]
      : [];
  const launchByAccountId = new Map(launches.map((launch) => [launch.senderAccountId, launch] as const));
  const launchByEmail = new Map(launches.map((launch) => [launch.fromEmail.toLowerCase(), launch] as const));
  const senders = accounts
    .filter((account) => account.status === "active" || assignedAccountIds.includes(account.id))
    .map((account) => {
      const fromEmail = getOutreachAccountFromEmail(account).toLowerCase();
      return summarizeSender(account, launchByAccountId.get(account.id) ?? launchByEmail.get(fromEmail) ?? null, assignedAccountIds);
    })
    .filter((sender) => sender.fromEmail || sender.assigned || sender.launch);
  const activeProvisioningSenderCount = launches.filter(launchIsActiveCapacity).length;
  const guardrailsWithoutAllowed = {
    canAutoProvisionSender:
      input.mission.approvalPolicy.allowAutoProvisioning &&
      input.approvedPlan.deliverabilityPlan.autoProvisioning !== false,
    canAutoBuyDomain:
      input.mission.approvalPolicy.allowAutoDomainPurchase &&
      !input.mission.approvalPolicy.requireApprovalForNewDomainPurchase,
    requireApprovalForNewDomainPurchase: input.mission.approvalPolicy.requireApprovalForNewDomainPurchase,
    maxAutoProvisionedSenders: Math.max(0, input.mission.approvalPolicy.maxAutoProvisionedSenders),
    maxAutoDomainSpendUsd: Math.max(0, input.mission.approvalPolicy.maxAutoDomainSpendUsd),
    activeProvisioningSenderCount,
    allowedToolNames: [] as MissionDeliverabilityToolName[],
  };
  const snapshot: MissionDeliverabilitySnapshot = {
    mission: {
      id: input.mission.id,
      brandId: input.mission.brandId,
      status: input.mission.status,
      websiteUrl: input.mission.websiteUrl,
      targetCustomerText: input.mission.targetCustomerText,
      approvedPlan: input.approvedPlan,
    },
    brand: compactBrand(brand, input.mission),
    approvalPolicy: input.mission.approvalPolicy,
    deliverabilityState,
    assignment: {
      accountId: assignment?.accountId ?? "",
      accountIds: assignedAccountIds,
      mailboxAccountId: assignment?.mailboxAccountId ?? "",
    },
    senders,
    senderLaunches: launches.map((launch) => ({
      id: launch.id,
      senderAccountId: launch.senderAccountId,
      fromEmail: launch.fromEmail,
      domain: launch.domain,
      state: launch.state,
      readinessScore: launch.readinessScore,
      dailyCap: launch.dailyCap,
      summary: launch.summary,
      nextStep: launch.nextStep,
    })),
    provisioning: {
      provider: "mailpool",
      hasMailpoolApiKey: Boolean(secrets.mailpoolApiKey),
      hasCustomerIoSiteId: Boolean(settings.customerIo.siteId),
      hasCustomerIoTrackingKey: Boolean(secrets.customerIoTrackingApiKey),
      hasCustomerIoAppKey: Boolean(secrets.customerIoAppApiKey),
      mailpoolWebhookConfigured: Boolean(settings.mailpool.webhookUrl && secrets.mailpoolWebhookSecret),
      deliverabilityProvider: settings.deliverability.provider,
    },
    guardrails: guardrailsWithoutAllowed,
  };
  snapshot.guardrails.allowedToolNames = allowedToolNames(snapshot);
  return snapshot;
}

function buildToolCatalog() {
  return [
    {
      name: "inspect_state",
      riskLevel: "read",
      description: "Refresh and record the current mission deliverability state without changing sender assignments.",
      input: {},
    },
    {
      name: "assign_sender",
      riskLevel: "guarded_write",
      description: "Assign an exact existing active sender account to the mission. The AI must choose accountId from snapshot.senders.",
      input: { accountId: "existing active sender account id", reason: "why this sender is the right next move" },
    },
    {
      name: "provision_mailpool_sender",
      riskLevel: "guarded_write",
      description:
        "Buy/register an exact AI-selected Mailpool domain, create an inbox, assign it to the brand, and wait for readiness. Requires auto provisioning and auto domain purchase policy.",
      input: {
        domain: "exact domain selected by AI, no placeholders",
        fromLocalPart: "exact mailbox local part selected by AI, for example founder or growth",
        domainCandidates: "optional AI-ordered array of alternate exact domains to try if the first is unavailable",
        accountName: "optional display name",
        reason: "why this new sender/domain is the right next move",
      },
    },
    {
      name: "wait_for_warmup",
      riskLevel: "read",
      description: "Keep the mission blocked while existing sender warmup, inbox placement, DNS, or provider setup continues.",
      input: { reason: "what the operator is waiting for", nextCheck: "what should be checked on the next tick" },
    },
    {
      name: "block_for_policy",
      riskLevel: "blocked",
      description: "Record that the AI wants to act, but policy, credentials, budget, or safety prevents the action.",
      input: { reason: "specific blocker", desiredAction: "what the AI would do if permitted" },
    },
  ];
}

function buildMissionOperatorPrompt(snapshot: MissionDeliverabilitySnapshot) {
  return [
    "You are the LastB2B mission deliverability operator.",
    "You are the decision-maker. The code will not pick a sender, domain, mailbox name, provider path, or next move for you.",
    "Choose exactly one tool from the tool catalog. If you choose a write tool, provide exact IDs/domains/local parts.",
    "You may create new sender capacity when guardrails allow it. You may also wait, inspect, or block if that is the correct move.",
    "Hard guardrails are not optional: no sending before deliverability is ready, no domain purchase unless policy allows it, no provisioning above capacity, no spending above maxAutoDomainSpendUsd, and no invented account IDs.",
    "Do not output a generic plan. Select the next concrete tool call for this mission tick.",
    "Keep rationale, expectedOutcome, and toolInputJson concise.",
    "Return only JSON matching the schema. Put tool arguments in toolInputJson as a JSON object encoded in a string.",
    "",
    `Tool catalog JSON:\n${JSON.stringify(buildToolCatalog())}`,
    "",
    `Mission state JSON:\n${JSON.stringify(snapshot)}`,
  ].join("\n");
}

function normalizeToolName(value: unknown): MissionDeliverabilityToolName {
  const toolName = asString(value) as MissionDeliverabilityToolName;
  return TOOL_NAMES.includes(toolName) ? toolName : "block_for_policy";
}

function normalizeAgentPlan(
  value: unknown,
  model: string,
  fallback: { toolName: MissionDeliverabilityToolName; rationale: string; toolInput?: Record<string, unknown> }
): MissionDeliverabilityAgentPlan {
  const row = asRecord(value);
  let toolInput = asRecord(row.toolInput);
  const toolInputJson = asString(row.toolInputJson);
  if (toolInputJson) {
    try {
      toolInput = asRecord(JSON.parse(toolInputJson));
    } catch {
      toolInput = {};
    }
  }
  const toolName = normalizeToolName(row.toolName || fallback.toolName);
  const usedFallback = !TOOL_NAMES.includes(asString(row.toolName) as MissionDeliverabilityToolName);
  return {
    toolName,
    toolInput: usedFallback ? (fallback.toolInput ?? {}) : toolInput,
    rationale: asString(row.rationale) || fallback.rationale,
    expectedOutcome: asString(row.expectedOutcome),
    riskLevel: riskForTool(toolName),
    model,
    raw: row,
  };
}

async function planMissionDeliverabilityAction(snapshot: MissionDeliverabilitySnapshot): Promise<MissionDeliverabilityAgentPlan> {
  const apiKey = asString(process.env.OPENAI_API_KEY);
  const model = resolveLlmModel("mission_operator", {
    input: snapshot,
    overrideModel: asString(process.env.OPENAI_MODEL_MISSION_OPERATOR),
  });

  if (!apiKey) {
    return normalizeAgentPlan(
      {},
      "mission-operator-unavailable",
      {
        toolName: "block_for_policy",
        rationale: "OPENAI_API_KEY is missing, so the AI deliverability operator cannot choose a tool.",
        toolInput: { reason: "OPENAI_API_KEY is missing.", desiredAction: "Run the AI mission deliverability operator." },
      }
    );
  }

  const prompt = buildMissionOperatorPrompt(snapshot);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      reasoning: { effort: asString(process.env.OPENAI_MISSION_REASONING_EFFORT) || "high" },
      text: {
        format: {
          type: "json_schema",
          name: "mission_deliverability_tool_choice",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              toolName: { type: "string", enum: TOOL_NAMES },
              rationale: { type: "string", maxLength: 500 },
              expectedOutcome: { type: "string", maxLength: 300 },
              toolInputJson: { type: "string", maxLength: 900 },
            },
            required: ["toolName", "rationale", "expectedOutcome", "toolInputJson"],
          },
        },
      },
      max_output_tokens: 2200,
      store: false,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    return normalizeAgentPlan(
      {},
      model,
      {
        toolName: "block_for_policy",
        rationale: `Mission deliverability AI request failed with HTTP ${response.status}.`,
        toolInput: { reason: raw.slice(0, 500), desiredAction: "Retry AI mission deliverability operator." },
      }
    );
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }

  let parsed: unknown = {};
  try {
    parsed = JSON.parse(extractResponseText(payload));
  } catch {
    return normalizeAgentPlan(
      {},
      model,
      {
        toolName: "block_for_policy",
        rationale: "Mission deliverability AI returned invalid JSON.",
        toolInput: { reason: extractResponseText(payload).slice(0, 500), desiredAction: "Retry AI mission deliverability operator." },
      }
    );
  }

  return normalizeAgentPlan(parsed, model, {
    toolName: "block_for_policy",
    rationale: "Mission deliverability AI did not choose a valid tool.",
    toolInput: { reason: "Invalid tool choice.", desiredAction: "Retry AI mission deliverability operator." },
  });
}

async function selectAiChosenAvailableDomain(input: {
  mailpoolApiKey: string;
  domain: string;
  domainCandidates: string[];
}) {
  const checkedDomains: string[] = [];
  const orderedDomains = Array.from(new Set([input.domain, ...input.domainCandidates].map(normalizeDomain).filter(isValidDomain)));
  for (const domain of orderedDomains) {
    const selection = await selectAvailableMailpoolDomain({
      preferredDomain: domain,
      domainCandidates: [],
      allowAlternativeDomains: false,
      mailpoolApiKey: input.mailpoolApiKey,
    });
    checkedDomains.push(...selection.checkedDomains.filter((entry) => !checkedDomains.includes(entry)));
    if (selection.available) return { selection, checkedDomains };
  }
  return { selection: null as MailpoolDomainSelection | null, checkedDomains };
}

async function executeAssignSender(input: {
  mission: Mission;
  plan: MissionDeliverabilityAgentPlan;
}): Promise<ToolExecutionResult> {
  const accountId = asString(input.plan.toolInput.accountId);
  const accounts = await listOutreachAccounts();
  const account = accounts.find((row) => row.id === accountId) ?? null;
  if (!account) {
    return {
      ok: false,
      summary: "AI selected a sender account that does not exist.",
      riskLevel: "blocked",
      result: { accountId },
    };
  }
  const fromEmail = getOutreachAccountFromEmail(account).toLowerCase();
  if (account.status !== "active" || !fromEmail) {
    return {
      ok: false,
      summary: "AI selected a sender account that is not active or has no from email.",
      riskLevel: "blocked",
      result: { accountId, status: account.status, fromEmail },
    };
  }

  const assignment = await setBrandOutreachAssignment(input.mission.brandId, {
    accountId: account.id,
    accountIds: [account.id],
    mailboxAccountId: account.id,
  });
  await createMissionEvent({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    eventType: "ai_sender_assigned",
    summary: `AI operator assigned ${fromEmail} as the mission sender.`,
    payload: {
      accountId: account.id,
      fromEmail,
      reason: asString(input.plan.toolInput.reason) || input.plan.rationale,
    },
  });

  return {
    ok: true,
    summary: `Assigned ${fromEmail} as the mission sender.`,
    riskLevel: "guarded_write",
    result: { assignment, accountId: account.id, fromEmail },
  };
}

async function executeProvisionMailpoolSender(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
  snapshot: MissionDeliverabilitySnapshot;
  plan: MissionDeliverabilityAgentPlan;
}): Promise<ToolExecutionResult> {
  const policy = input.mission.approvalPolicy;
  if (!policy.allowAutoProvisioning || input.approvedPlan.deliverabilityPlan.autoProvisioning === false) {
    return {
      ok: false,
      summary: "Auto provisioning is not allowed for this mission.",
      riskLevel: "blocked",
      result: { approvalPolicy: policy },
    };
  }
  if (!policy.allowAutoDomainPurchase || policy.requireApprovalForNewDomainPurchase) {
    return {
      ok: false,
      summary: "Auto domain purchase is not allowed for this mission.",
      riskLevel: "blocked",
      result: { approvalPolicy: policy },
    };
  }
  if (input.snapshot.guardrails.activeProvisioningSenderCount >= policy.maxAutoProvisionedSenders) {
    return {
      ok: false,
      summary: "Mission already has the maximum auto-provisioned sender capacity in flight.",
      riskLevel: "blocked",
      result: {
        activeProvisioningSenderCount: input.snapshot.guardrails.activeProvisioningSenderCount,
        maxAutoProvisionedSenders: policy.maxAutoProvisionedSenders,
      },
    };
  }

  const domain = normalizeDomain(asString(input.plan.toolInput.domain));
  const fromLocalPart = normalizeEmailLocalPart(asString(input.plan.toolInput.fromLocalPart));
  const domainCandidates = asStringArray(input.plan.toolInput.domainCandidates).map(normalizeDomain).filter(isValidDomain);
  if (!isValidDomain(domain) || !fromLocalPart) {
    return {
      ok: false,
      summary: "AI must provide an exact valid domain and sender local part before provisioning.",
      riskLevel: "blocked",
      result: { domain, fromLocalPart },
    };
  }

  const [settings, secrets, brand] = await Promise.all([
    getOutreachProvisioningSettings(),
    getOutreachProvisioningSettingsSecrets(),
    getBrandById(input.mission.brandId, { includeEmbedded: true }),
  ]);
  if (!secrets.mailpoolApiKey) {
    return {
      ok: false,
      summary: "Mailpool credentials are missing.",
      riskLevel: "blocked",
      result: { hasMailpoolApiKey: false },
    };
  }

  const domainSelection = await selectAiChosenAvailableDomain({
    mailpoolApiKey: secrets.mailpoolApiKey,
    domain,
    domainCandidates,
  });
  if (!domainSelection.selection) {
    return {
      ok: false,
      summary: "None of the AI-selected domains are available in Mailpool.",
      riskLevel: "blocked",
      result: { requestedDomain: domain, domainCandidates, checkedDomains: domainSelection.checkedDomains },
    };
  }
  if (domainSelection.selection.price > policy.maxAutoDomainSpendUsd) {
    return {
      ok: false,
      summary: "AI-selected domain exceeds the mission spend guardrail.",
      riskLevel: "blocked",
      result: {
        domain: domainSelection.selection.domain,
        price: domainSelection.selection.price,
        maxAutoDomainSpendUsd: policy.maxAutoDomainSpendUsd,
      },
    };
  }

  try {
    const result = await provisionSender({
      brandId: input.mission.brandId,
      provider: "mailpool",
      accountName:
        asString(input.plan.toolInput.accountName) ||
        `${brand?.name || input.snapshot.brand.name || domainSelection.selection.domain} AI Sender`,
      assignToBrand: true,
      domainMode: "register",
      domain: domainSelection.selection.domain,
      domainCandidates: [],
      allowAlternativeDomains: false,
      fromLocalPart,
      forwardingTargetUrl: brand?.website || input.mission.websiteUrl,
      customerIoSiteId: settings.customerIo.siteId,
      customerIoTrackingApiKey: secrets.customerIoTrackingApiKey,
      customerIoAppApiKey: secrets.customerIoAppApiKey,
      mailpoolApiKey: secrets.mailpoolApiKey,
      namecheapApiUser: settings.namecheap.apiUser,
      namecheapUserName: settings.namecheap.userName,
      namecheapApiKey: secrets.namecheapApiKey,
      namecheapClientIp: settings.namecheap.clientIp,
    });
    await loadBrandSenderLaunchView(input.mission.brandId).catch(() => null);
    await createMissionEvent({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      eventType: "ai_sender_provisioned",
      summary: `AI operator provisioned ${result.fromEmail}; waiting for readiness before sending.`,
      payload: {
        domain: result.domain,
        fromEmail: result.fromEmail,
        price: domainSelection.selection.price,
        readyToSend: result.readyToSend,
        warnings: result.warnings,
        nextSteps: result.nextSteps,
      },
    });
    return {
      ok: true,
      summary: `Provisioned ${result.fromEmail}; waiting for readiness before sending.`,
      riskLevel: "guarded_write",
      result: {
        ok: result.ok,
        provider: result.provider,
        domain: result.domain,
        fromEmail: result.fromEmail,
        readyToSend: result.readyToSend,
        price: domainSelection.selection.price,
        warnings: result.warnings,
        nextSteps: result.nextSteps,
        mailpool: result.mailpool,
      },
    };
  } catch (error) {
    return {
      ok: false,
      summary: error instanceof Error ? error.message : "Sender provisioning failed.",
      riskLevel: "blocked",
      result: {
        domain: domainSelection.selection.domain,
        fromLocalPart,
        error: error instanceof Error ? error.message : "Sender provisioning failed.",
      },
    };
  }
}

async function executeMissionTool(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
  snapshot: MissionDeliverabilitySnapshot;
  plan: MissionDeliverabilityAgentPlan;
}): Promise<ToolExecutionResult> {
  if (!input.snapshot.guardrails.allowedToolNames.includes(input.plan.toolName)) {
    return {
      ok: false,
      summary: `AI selected ${input.plan.toolName}, but the current guardrails do not allow that tool.`,
      riskLevel: "blocked",
      result: {
        selectedToolName: input.plan.toolName,
        allowedToolNames: input.snapshot.guardrails.allowedToolNames,
      },
    };
  }

  if (input.plan.toolName === "assign_sender") {
    return executeAssignSender({ mission: input.mission, plan: input.plan });
  }
  if (input.plan.toolName === "provision_mailpool_sender") {
    return executeProvisionMailpoolSender(input);
  }
  if (input.plan.toolName === "wait_for_warmup") {
    const reason = asString(input.plan.toolInput.reason) || input.plan.rationale;
    await createMissionEvent({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      eventType: "ai_deliverability_waiting",
      summary: reason,
      payload: {
        nextCheck: asString(input.plan.toolInput.nextCheck),
      },
    });
    return {
      ok: true,
      summary: reason,
      riskLevel: "read",
      result: { nextCheck: asString(input.plan.toolInput.nextCheck) },
    };
  }
  if (input.plan.toolName === "block_for_policy") {
    const reason = asString(input.plan.toolInput.reason) || input.plan.rationale;
    await createMissionEvent({
      missionId: input.mission.id,
      brandId: input.mission.brandId,
      eventType: "ai_deliverability_blocked",
      summary: reason,
      payload: {
        desiredAction: asString(input.plan.toolInput.desiredAction),
      },
    });
    return {
      ok: false,
      summary: reason,
      riskLevel: "blocked",
      result: { desiredAction: asString(input.plan.toolInput.desiredAction) },
    };
  }

  return {
    ok: true,
    summary: "AI operator inspected deliverability state.",
    riskLevel: "read",
    result: {},
  };
}

export async function ensureMissionDeliverabilityCapacity(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
}): Promise<CapacityResult> {
  const snapshot = await buildMissionDeliverabilitySnapshot(input);
  if (snapshot.deliverabilityState.stage === "ready") {
    return { mission: input.mission, deliverabilityState: snapshot.deliverabilityState };
  }

  const plan = await planMissionDeliverabilityAction(snapshot);
  const execution = await executeMissionTool({
    mission: input.mission,
    approvedPlan: input.approvedPlan,
    snapshot,
    plan,
  });
  const deliverabilityState = await inspectMissionDeliverability(input.mission.brandId);

  await createMissionAgentDecision({
    missionId: input.mission.id,
    brandId: input.mission.brandId,
    agent: "mission_deliverability_ai_operator",
    action: plan.toolName,
    rationale: plan.rationale,
    riskLevel: execution.riskLevel,
    input: {
      model: plan.model,
      toolName: plan.toolName,
      toolInput: plan.toolInput,
      expectedOutcome: plan.expectedOutcome,
      guardrails: snapshot.guardrails,
      stateBefore: snapshot.deliverabilityState,
    },
    output: {
      ok: execution.ok,
      summary: execution.summary,
      result: execution.result,
      stateAfter: deliverabilityState,
      recordedAt: nowIso(),
    },
  });

  return { mission: input.mission, deliverabilityState };
}

export async function previewMissionDeliverabilityAction(input: {
  mission: Mission;
  approvedPlan: MissionPlan;
}) {
  const snapshot = await buildMissionDeliverabilitySnapshot(input);
  const plan = await planMissionDeliverabilityAction(snapshot);
  return { snapshot, plan };
}
