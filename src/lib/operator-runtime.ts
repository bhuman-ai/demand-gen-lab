import {
  createOperatorAction,
  createOperatorApproval,
  createOperatorMessage,
  createOperatorRun,
  createOperatorThread,
  getOperatorAction,
  getOperatorRun,
  getOperatorThread,
  listOperatorActionsByThread,
  listOperatorMessages,
  listOperatorRunsByThread,
  updateOperatorAction,
  updateOperatorRun,
  updateOperatorThread,
} from "@/lib/operator-data";
import {
  getOperatorBrandMemory,
  rememberOperatorRecentSelection,
  rememberProvisionMailpoolSenderInput,
  type OperatorBrandMemory,
} from "@/lib/operator-memory";
import { getOperatorBrandContext } from "@/lib/operator-context";
import { getOperatorToolSpec, listOperatorToolSpecs } from "@/lib/operator-tools";
import { runBrandAgentTurn, type BrandAgentEvidenceCheck, type BrandAgentTraceEntry } from "@/lib/brand-agent-runtime";
import type {
  OperatorAction,
  OperatorActionSummary,
  OperatorChatAssistantReply,
  OperatorChatRequest,
  OperatorChatResponse,
  OperatorChatStartResponse,
  OperatorEvidenceCheck,
  OperatorEvidenceTraceEntry,
  OperatorExecutionEnvelope,
  OperatorExecutionForm,
  OperatorExecutionFormField,
  OperatorExecutionIntent,
  OperatorExecutionQuestion,
  OperatorMessage,
  OperatorRequestedAction,
  OperatorReceipt,
  OperatorRun,
  OperatorRunStatus,
  OperatorThread,
  OperatorThreadDetail,
  OperatorToolName,
  OperatorToolSpec,
} from "@/lib/operator-types";

const DEFAULT_OPERATOR_REASONING = (() => {
  const value = String(process.env.OPENAI_OPERATOR_REASONING_EFFORT ?? "").trim().toLowerCase();
  return ["minimal", "low", "medium", "high", "xhigh"].includes(value) ? value : "low";
})();

type OperatorPlannerResult = {
  assistant: OperatorChatAssistantReply;
  requestedAction: OperatorRequestedAction | null;
  model: string;
  trace: BrandAgentTraceEntry[];
  evidenceCheck: BrandAgentEvidenceCheck | null;
};

type OperatorChatTurnInternalRequest = OperatorChatRequest & {
  existingRunId?: string;
  existingThread?: OperatorThread;
  skipUserMessage?: boolean;
};

// Safety boundary only: this is not a strategy heuristic. Strategy still comes from the agent;
// this list controls which guarded tools may run without a human confirmation click by default.
const DEFAULT_AUTONOMOUS_GUARDED_TOOLS = [
  "gmail_ui_send_message",
  "provision_mailpool_sender",
  "provision_customerio_sender",
  "launch_experiment_run",
  "control_experiment_run",
  "promote_experiment_to_campaign",
  "launch_campaign_run",
  "control_campaign_run",
  "create_leadr_campaign",
  "resume_leadr_campaign",
] satisfies OperatorToolName[];

function nowIso() {
  return new Date().toISOString();
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseCsvSet(value: string) {
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function autonomousGuardedToolAllowlist(input: OperatorChatRequest) {
  if (Array.isArray(input.autonomousToolAllowlist) && input.autonomousToolAllowlist.length > 0) {
    return new Set(input.autonomousToolAllowlist.map((entry) => entry.trim()).filter(Boolean));
  }
  const configured = asString(process.env.OPERATOR_AUTONOMOUS_GUARDED_TOOLS);
  if (configured) return parseCsvSet(configured);
  return new Set(DEFAULT_AUTONOMOUS_GUARDED_TOOLS);
}

function canAutonomouslyApproveTool(input: OperatorChatRequest, tool: OperatorToolSpec) {
  if (input.executionPolicy !== "autonomous") return false;
  if (input.mode === "recommendation_only") return false;
  if (tool.approvalMode !== "confirm") return false;
  if (tool.riskLevel === "blocked") return false;
  const allowlist = autonomousGuardedToolAllowlist(input);
  if (allowlist.has("none")) return false;
  return allowlist.has("*") || allowlist.has(tool.name);
}

function isProvisionSenderToolName(toolName: OperatorToolName | "") {
  return toolName === "provision_mailpool_sender" || toolName === "provision_customerio_sender";
}

function provisionProviderForTool(toolName: OperatorToolName | "") {
  return toolName === "provision_customerio_sender" ? "customerio" : "mailpool";
}

function provisionProviderLabel(toolName: OperatorToolName | "") {
  return toolName === "provision_customerio_sender" ? "Customer.io" : "Mailpool";
}

function truncateForEvidence(value: string, maxLength = 420) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}...` : clean;
}

function evidenceJsonSummary(value: unknown, maxLength = 420) {
  try {
    return truncateForEvidence(JSON.stringify(value), maxLength);
  } catch {
    return "";
  }
}

function summarizeEvidenceInput(input: Record<string, unknown>) {
  const pieces = [
    asString(input.accountId) ? `account ${asString(input.accountId)}` : "",
    asString(input.brandId) ? `brand ${asString(input.brandId)}` : "",
    asString(input.query) ? `query "${asString(input.query)}"` : "",
    asString(input.recipient) ? `recipient ${asString(input.recipient)}` : "",
    asString(input.subject) ? `subject "${asString(input.subject)}"` : "",
    asString(input.campaignId) ? `campaign ${asString(input.campaignId)}` : "",
    asString(input.runId) ? `run ${asString(input.runId)}` : "",
    asString(input.threadId) ? `thread ${asString(input.threadId)}` : "",
    asString(input.action) ? `action ${asString(input.action)}` : "",
  ].filter(Boolean);
  return pieces.join(" | ") || evidenceJsonSummary(input);
}

function summarizeEvidenceResult(entry: BrandAgentTraceEntry) {
  if (entry.error) return entry.error;
  const result = asRecord(entry.result);
  const verification = asRecord(result.verification);
  if (Object.keys(verification).length) {
    const verified = verification.verified === true ? "verified" : "not verified";
    const reason = asString(verification.reason);
    return truncateForEvidence(`${verified}${reason ? `: ${reason}` : ""}`);
  }
  const bodyExcerpt = asString(result.bodyExcerpt);
  const screenshotPath = asString(result.screenshotPath);
  const prompt = asString(result.prompt);
  return truncateForEvidence(
    [
      entry.summary,
      prompt ? `Prompt: ${prompt}` : "",
      bodyExcerpt ? `Excerpt: ${bodyExcerpt}` : "",
      screenshotPath ? `Screenshot: ${screenshotPath}` : "",
    ]
      .filter(Boolean)
      .join(" ")
  ) || evidenceJsonSummary(result);
}

function buildEvidenceTrace(trace: BrandAgentTraceEntry[] | undefined): OperatorEvidenceTraceEntry[] {
  return (trace ?? []).slice(0, 12).map((entry) => ({
    step: entry.step,
    toolName: entry.toolName,
    riskLevel: entry.riskLevel,
    rationale: truncateForEvidence(asString(entry.rationale), 260),
    inputSummary: summarizeEvidenceInput(entry.input),
    resultSummary: summarizeEvidenceResult(entry),
    error: truncateForEvidence(entry.error),
  }));
}

function buildEvidenceCheck(check: BrandAgentEvidenceCheck | null | undefined): OperatorEvidenceCheck | null {
  if (!check) return null;
  return {
    status: check.status,
    summary: truncateForEvidence(check.summary, 700),
    gaps: check.gaps.map((gap) => truncateForEvidence(gap, 260)).filter(Boolean).slice(0, 6),
  };
}

function isCasualGreeting(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return /^(hi|hey|hello|yo|sup|what'?s up|hiya|howdy)[!.?]*$/.test(normalized);
}

function isExplicitActionRequest(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized || isCasualGreeting(normalized)) return false;
  if (
    /\b(can you|could you|please|go ahead and|i want you to|take care of|handle|do this)\b/.test(normalized)
  ) {
    return true;
  }
  return /^(add|create|make|buy|register|provision|refresh|sync|check|run|pause|resume|cancel|summarize|show|inspect|diagnose|draft|send|use|update|edit|change|delete|remove|dismiss|launch|promote|set up|setup|start|open)\b/.test(
    normalized
  );
}

function isExplicitMutationRequest(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized || isCasualGreeting(normalized)) return false;
  if (
    /\b(can you|could you|please|go ahead and|i want you to|take care of|handle|do this)\b/.test(normalized)
  ) {
    return /\b(add|create|make|buy|register|provision|refresh|sync|run|pause|resume|cancel|send|dismiss|delete|remove|launch|promote|update|edit|change|set up|setup|start)\b/.test(
      normalized
    );
  }
  return /^(add|create|make|buy|register|provision|refresh|sync|run|pause|resume|cancel|send|dismiss|delete|remove|launch|promote|update|edit|change|set up|setup|start)\b/.test(
    normalized
  );
}

function isAffirmativeMessage(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return /^(yes|yep|yeah|yup|sure|ok|okay|confirm|do it|yes do it|go ahead|run it|send it|make it so|please do|do that)$/i.test(
    normalized
  );
}

function isNegativeMessage(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return /^(no|nope|nah|cancel|cancel it|stop|never mind|nevermind|don'?t|do not|don'?t do it|don'?t do that|skip it)$/i.test(
    normalized
  );
}

function buildGreetingAssistant(brandName?: string): OperatorChatAssistantReply {
  return {
    summary: brandName
      ? `Hi. I'm Brand GPT for ${brandName}. Tell me what you want to do, or ask me anything about the account.`
      : "Hi. I'm Brand GPT. Tell me what you want to do, or ask me anything about the account.",
    findings: [],
    recommendations: [],
  };
}

function buildDefaultAssistantReply(input: {
  brandName?: string;
  issues: string[];
  nextActions: string[];
  sendersTotal?: number;
  readySenders?: number;
  campaignsTotal?: number;
  inboxThreads?: number;
}): OperatorChatAssistantReply {
  const brandLabel = input.brandName || "this brand";
  const primaryIssue = input.issues[0] ?? "";
  const primaryNextAction = input.nextActions[0] ?? "";
  let summary = `${brandLabel} is loaded and I'm ready to help.`;
  if (primaryIssue && primaryNextAction) {
    summary = `${primaryIssue} The next move is to ${primaryNextAction.charAt(0).toLowerCase()}${primaryNextAction.slice(1)}`;
  } else if (primaryIssue) {
    summary = primaryIssue;
  } else if (primaryNextAction) {
    summary = `Things look stable right now. The next move is to ${primaryNextAction.charAt(0).toLowerCase()}${primaryNextAction.slice(1)}`;
  }
  return {
    summary,
    findings: [],
    recommendations: [],
  };
}

function buildToolPreview(tool: OperatorToolSpec, input: Record<string, unknown>) {
  return tool.buildPreview?.(input) ?? {
    title: tool.previewTitle,
    summary: tool.description,
  };
}

function inferExecutionVerb(toolName: OperatorToolName, input: Record<string, unknown>) {
  switch (toolName) {
    case "create_brand":
    case "create_experiment":
    case "create_leadr_auth_link":
    case "create_leadr_campaign":
      return "create";
    case "update_brand":
    case "update_brand_lead":
    case "update_experiment":
    case "update_campaign":
      return "update";
    case "delete_brand":
    case "delete_experiment":
    case "delete_campaign":
      return "delete";
    case "add_brand_lead":
      return "add";
    case "launch_experiment_run":
    case "launch_campaign_run":
      return "launch";
    case "promote_experiment_to_campaign":
      return "promote";
    case "send_reply_draft":
    case "gmail_ui_send_message":
      return "send";
    case "dismiss_reply_draft":
      return "dismiss";
    case "refresh_mailpool_sender":
    case "gmail_ui_close_session":
      return "refresh";
    case "gmail_ui_search_mailbox":
      return "search";
    case "gmail_ui_verify_sent":
      return "verify";
    case "sync_leadr_campaign":
      return "sync";
    case "resume_leadr_campaign":
      return "resume";
    case "provision_mailpool_sender":
    case "provision_customerio_sender":
      return normalizeProvisionDomainMode(input.domainMode) === "register" ? "buy and provision" : "provision";
    case "control_experiment_run":
    case "control_campaign_run":
      return asString(input.action) || "control";
    case "summarize_campaign_status":
    case "summarize_experiments":
    case "summarize_leads":
    case "summarize_inbox":
      return "summarize";
    default:
      return "inspect";
  }
}

function inferExecutionObjectType(toolName: OperatorToolName) {
  switch (toolName) {
    case "create_brand":
    case "update_brand":
    case "delete_brand":
    case "get_brand_snapshot":
      return "brand";
    case "refresh_mailpool_sender":
    case "provision_mailpool_sender":
    case "provision_customerio_sender":
    case "get_sender_snapshot":
    case "gmail_ui_observe_account":
    case "gmail_ui_search_mailbox":
    case "gmail_ui_verify_sent":
    case "gmail_ui_send_message":
    case "gmail_ui_close_session":
      return "sender";
    case "get_leadr_snapshot":
    case "list_leadr_accounts":
    case "create_leadr_auth_link":
      return "LinkedIn channel";
    case "add_brand_lead":
    case "update_brand_lead":
    case "summarize_leads":
      return "lead";
    case "create_experiment":
    case "update_experiment":
    case "delete_experiment":
    case "launch_experiment_run":
    case "control_experiment_run":
    case "promote_experiment_to_campaign":
    case "get_experiment_snapshot":
    case "summarize_experiments":
      return "experiment";
    case "update_campaign":
    case "delete_campaign":
    case "launch_campaign_run":
    case "control_campaign_run":
    case "get_campaign_snapshot":
    case "summarize_campaign_status":
    case "create_leadr_campaign":
    case "sync_leadr_campaign":
    case "resume_leadr_campaign":
      return "campaign";
    case "send_reply_draft":
    case "dismiss_reply_draft":
    case "summarize_inbox":
      return "reply";
    default:
      return "item";
  }
}

function inferExecutionTargetLabel(toolName: OperatorToolName, input: Record<string, unknown>) {
  const fromLocalPart = asString(input.fromLocalPart);
  const domain = asString(input.domain);
  if (fromLocalPart && domain) return `${fromLocalPart}@${domain}`;
  const candidates = [
    input.fromEmail,
    input.replyToEmail,
    input.accountName,
    input.brandName,
    input.name,
    input.website,
    input.experimentName,
    input.experimentId,
    input.campaignName,
    input.campaignId,
    input.channelRunId,
    input.accountId,
    input.leadName,
    input.leadId,
    input.draftSubject,
    input.draftId,
    input.domain,
    input.accountId,
    input.brandId,
  ];
  const target = candidates.map((value) => asString(value)).find(Boolean);
  if (target) return target;
  return inferExecutionObjectType(toolName);
}

function buildExecutionIntent(
  toolName: OperatorToolName,
  input: Record<string, unknown>
): OperatorExecutionIntent {
  return {
    verb: inferExecutionVerb(toolName, input),
    objectType: inferExecutionObjectType(toolName),
    objectLabel: inferExecutionTargetLabel(toolName, input),
  };
}

function buildExecutionEnvelope(input: {
  state: OperatorExecutionEnvelope["state"];
  toolName?: OperatorToolName;
  toolInput?: Record<string, unknown>;
  actionId?: string;
  preview?: Record<string, unknown>;
  receipt?: OperatorReceipt | null;
  missingFields?: string[];
  questions?: OperatorExecutionQuestion[];
  forms?: OperatorExecutionForm[];
  error?: string;
}): OperatorExecutionEnvelope {
  const toolName = input.toolName ?? "";
  return {
    state: input.state,
    actionId: asString(input.actionId),
    intent: toolName ? buildExecutionIntent(toolName, input.toolInput ?? {}) : null,
    toolName,
    toolInput: input.toolInput ?? {},
    preview: input.preview ?? {},
    receipt: input.receipt ?? null,
    missingFields: input.missingFields ?? [],
    questions: input.questions ?? [],
    forms: input.forms ?? [],
    error: asString(input.error),
  };
}

function buildNeedInfoEnvelope(input: {
  toolName?: OperatorToolName;
  toolInput?: Record<string, unknown>;
  missingFields: string[];
  preview?: Record<string, unknown>;
  questions?: OperatorExecutionQuestion[];
  forms?: OperatorExecutionForm[];
}): OperatorExecutionEnvelope {
  return buildExecutionEnvelope({
    state: "need_info",
    toolName: input.toolName,
    toolInput: input.toolInput,
    preview: input.preview,
    missingFields: input.missingFields,
    questions: input.questions,
    forms: input.forms,
  });
}

function buildQuestion(prompt: string, options: Array<{ label: string; message: string }>): OperatorExecutionQuestion {
  return {
    prompt,
    options: options
      .map((option) => ({
        label: asString(option.label),
        message: asString(option.message),
      }))
      .filter((option) => option.label && option.message),
  };
}

function buildFormField(input: Partial<OperatorExecutionFormField> & Pick<OperatorExecutionFormField, "name" | "label" | "type">): OperatorExecutionFormField {
  return {
    name: asString(input.name),
    label: asString(input.label),
    type: input.type,
    required: Boolean(input.required),
    placeholder: asString(input.placeholder),
    value: asString(input.value),
    autoComplete: asString(input.autoComplete),
    options: Array.isArray(input.options)
      ? input.options
          .map((option) => ({
            label: asString(option?.label),
            value: asString(option?.value),
          }))
          .filter((option) => option.label && option.value)
      : [],
  };
}

function buildProvisionForms(input: {
  brandContext: Awaited<ReturnType<typeof getOperatorBrandContext>>;
  brandMemory: OperatorBrandMemory | null;
  toolInput: Record<string, unknown>;
  missingFields: string[];
  toolName: OperatorToolName;
}): OperatorExecutionForm[] {
  const forms: OperatorExecutionForm[] = [];
  const providerLabel = provisionProviderLabel(input.toolName);
  const inventory = input.brandContext?.provisioning.mailpoolDomains ?? [];
  const inventoryOptions = inventory.map((item) => ({
    label: item.domain,
    value: item.domain,
  }));
  const domainMode =
    normalizeProvisionDomainMode(input.toolInput.domainMode) ||
    normalizeProvisionDomainMode(input.brandMemory?.senderDefaults.domainMode);
  const hasExplicitSenderIdentity =
    Boolean(asString(input.toolInput.fromLocalPart)) || Boolean(asString(input.toolInput.domain));
  const fromLocalPart =
    asString(input.toolInput.fromLocalPart) ||
    (hasExplicitSenderIdentity ? asString(input.brandMemory?.senderDefaults.fromLocalPart) : "");
  const domain =
    asString(input.toolInput.domain) ||
    (domainMode === "existing" && inventoryOptions.length === 1 ? inventoryOptions[0]?.value ?? "" : "") ||
    (hasExplicitSenderIdentity ? asString(input.brandMemory?.senderDefaults.domain) : "");
  const senderEmail = fromLocalPart && domain ? `${fromLocalPart}@${domain}` : "";
  const registrant = asRecord(input.toolInput.registrant);
  const senderFirstName = asString(input.toolInput.senderFirstName);
  const senderLastName = asString(input.toolInput.senderLastName);
  const senderIdentityFields = [
    buildFormField({
      name: "senderFirstName",
      label: "Sender first name",
      type: "text",
      required: true,
      placeholder: "Marco",
      value: senderFirstName,
      autoComplete: "given-name",
    }),
    buildFormField({
      name: "senderLastName",
      label: "Sender last name",
      type: "text",
      required: true,
      placeholder: "Rosetti",
      value: senderLastName,
      autoComplete: "family-name",
    }),
  ];
  const needsSenderIdentity =
    input.missingFields.includes("sender first name") ||
    input.missingFields.includes("sender last name");

  if (input.missingFields.includes("sender email")) {
    if (domainMode === "existing" && inventoryOptions.length > 0) {
      forms.push({
        id: "provision-existing-sender",
        formType: "provision_sender_email",
        toolName: input.toolName,
        title: "Sender details",
        description: `Pick the existing ${providerLabel} domain and local-part for the sender you want to create.`,
        submitLabel: "Continue",
        input: input.toolInput,
        fields: [
          buildFormField({
            name: "fromLocalPart",
            label: "Sender local-part",
            type: "text",
            required: true,
            placeholder: "marco",
            value: fromLocalPart,
            autoComplete: "username",
          }),
          buildFormField({
            name: "domain",
            label: "Mailpool domain",
            type: "select",
            required: true,
            value: domain,
            options: inventoryOptions,
          }),
          ...senderIdentityFields,
        ],
      });
    } else {
      forms.push({
        id: "provision-sender-email",
        formType: "provision_sender_email",
        toolName: input.toolName,
        title: "Sender details",
        description:
          domainMode === "register"
            ? "Enter the exact sender email you want to buy and provision."
            : "Enter the exact sender email you want to create for this brand.",
        submitLabel: "Continue",
        input: input.toolInput,
        fields: [
          buildFormField({
            name: "senderEmail",
            label: "Sender email",
            type: "email",
            required: true,
            placeholder: "marco@getselffunded.com",
            value: senderEmail,
            autoComplete: "email",
          }),
          ...(!domainMode && inventoryOptions.length > 0
            ? [
                buildFormField({
                  name: "domainMode",
                  label: "How should I set it up?",
                  type: "select",
                  required: true,
                  value: "",
                  options: [
                    { label: `Use an existing ${providerLabel} domain`, value: "existing" },
                    { label: "Buy a new sender domain", value: "register" },
                  ],
                }),
              ]
            : []),
          ...senderIdentityFields,
        ],
      });
    }
  }

  if (!input.missingFields.includes("sender email") && needsSenderIdentity) {
    forms.push({
      id: "provision-sender-identity",
      formType: "provision_sender_email",
      toolName: input.toolName,
      title: "Sender person",
      description: senderEmail
        ? `Set the real person name ${providerLabel} should show for ${senderEmail}.`
        : `Set the real person name ${providerLabel} should show for this sender.`,
      submitLabel: "Continue",
      input: input.toolInput,
      fields: senderIdentityFields,
    });
  }

  const needsRegistrant = input.missingFields.some((field) => field.startsWith("registrant "));
  if (domainMode === "register" && needsRegistrant) {
    forms.push({
      id: "provision-registrant",
      formType: "provision_registrant",
      toolName: input.toolName,
      title: "Registrant details",
      description: senderEmail
        ? `${providerLabel} needs domain owner details before it can buy ${domain} and provision ${senderEmail}.`
        : `${providerLabel} needs domain owner details before it can buy the domain and finish setup.`,
      submitLabel: "Continue",
      input: input.toolInput,
      fields: [
        buildFormField({
          name: "firstName",
          label: "First name",
          type: "text",
          required: true,
          placeholder: "Marco",
          value: asString(registrant.firstName) || asString(input.brandMemory?.registrantDefaults.firstName),
          autoComplete: "given-name",
        }),
        buildFormField({
          name: "lastName",
          label: "Last name",
          type: "text",
          required: true,
          placeholder: "Rosetti",
          value: asString(registrant.lastName) || asString(input.brandMemory?.registrantDefaults.lastName),
          autoComplete: "family-name",
        }),
        buildFormField({
          name: "organizationName",
          label: "Company",
          type: "text",
          required: false,
          placeholder: input.brandContext?.brand.name || "SelfFunded",
          value:
            asString(registrant.organizationName) ||
            asString(input.brandMemory?.registrantDefaults.organizationName) ||
            asString(input.brandContext?.brand.name),
          autoComplete: "organization",
        }),
        buildFormField({
          name: "emailAddress",
          label: "Email",
          type: "email",
          required: true,
          placeholder: "mrosetti@selffunded.dev",
          value: asString(registrant.emailAddress) || asString(input.brandMemory?.registrantDefaults.emailAddress),
          autoComplete: "email",
        }),
        buildFormField({
          name: "phone",
          label: "Phone",
          type: "tel",
          required: false,
          placeholder: "+39 080 000 0000",
          value: asString(registrant.phone) || asString(input.brandMemory?.registrantDefaults.phone),
          autoComplete: "tel",
        }),
        buildFormField({
          name: "address1",
          label: "Street address",
          type: "text",
          required: true,
          placeholder: "Piazza Umberto I, 1",
          value: asString(registrant.address1) || asString(input.brandMemory?.registrantDefaults.address1),
          autoComplete: "address-line1",
        }),
        buildFormField({
          name: "city",
          label: "City",
          type: "text",
          required: true,
          placeholder: "Bari",
          value: asString(registrant.city) || asString(input.brandMemory?.registrantDefaults.city),
          autoComplete: "address-level2",
        }),
        buildFormField({
          name: "stateProvince",
          label: "State / Province",
          type: "text",
          required: true,
          placeholder: "BA",
          value:
            asString(registrant.stateProvince) ||
            asString(input.brandMemory?.registrantDefaults.stateProvince),
          autoComplete: "address-level1",
        }),
        buildFormField({
          name: "postalCode",
          label: "Postal code",
          type: "text",
          required: true,
          placeholder: "70121",
          value:
            asString(registrant.postalCode) ||
            asString(input.brandMemory?.registrantDefaults.postalCode),
          autoComplete: "postal-code",
        }),
        buildFormField({
          name: "country",
          label: "Country",
          type: "text",
          required: true,
          placeholder: "IT",
          value:
            asString(registrant.country) ||
            asString(input.brandMemory?.registrantDefaults.country) ||
            "US",
          autoComplete: "country",
        }),
      ],
    });
  }

  return forms;
}

function buildProvisionQuestions(input: {
  hasMailpoolInventory: boolean;
  domainMode?: string;
  missingFields: string[];
}): OperatorExecutionQuestion[] {
  const questions: OperatorExecutionQuestion[] = [];
  const domainMode = normalizeProvisionDomainMode(input.domainMode);

  if (input.missingFields.includes("sender email") && !domainMode) {
    questions.push(
      buildQuestion("Which path should I use for this sender?", [
        ...(input.hasMailpoolInventory
          ? [
              {
                label: "Use existing domain",
                message: "Add a sender for this brand using an existing Mailpool domain.",
              },
            ]
          : []),
        {
          label: "Buy new domain",
          message: "Add a sender for this brand by buying a new sender domain.",
        },
      ])
    );
  }

  if (domainMode === "register") {
    questions.push(
      buildQuestion("Do you want to keep the new-domain flow, or switch to an existing Mailpool domain?", [
        {
          label: "Keep new domain",
          message: "Add a sender for this brand by buying a new sender domain. I'll provide the registrant details next.",
        },
        ...(input.hasMailpoolInventory
          ? [
              {
                label: "Use existing domain",
                message: "Add a sender for this brand using an existing Mailpool domain instead.",
              },
            ]
          : []),
      ])
    );
  }

  return questions.filter((question) => question.options.length > 0);
}

function titleFromMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return "Operator";
  return trimmed.length > 64 ? `${trimmed.slice(0, 61)}...` : trimmed;
}

function extractEmailParts(message: string) {
  const match = message
    .toLowerCase()
    .match(/\b([a-z0-9._%+-]+)@([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/);
  if (!match) return null;
  return {
    fromLocalPart: match[1] ?? "",
    domain: match[2] ?? "",
  };
}

function extractDomain(message: string) {
  const match = message
    .toLowerCase()
    .match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/);
  return match?.[1] ?? "";
}

function looksLikeBrandCreationRequest(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (!/\bbrand\b/.test(normalized)) return false;
  return /\b(make|create|add|set up|setup|start|open)\b/.test(normalized);
}

function ensureWebsiteUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function normalizeProvisionDomainMode(value: unknown) {
  const normalized = asString(value).toLowerCase();
  if (!normalized) return "";
  if (["register", "new", "buy", "purchase", "new_domain", "new-domain"].includes(normalized)) {
    return "register";
  }
  if (["transfer", "bring_your_own", "bring-your-own", "own_domain", "own-domain"].includes(normalized)) {
    return "transfer";
  }
  if (["existing", "current", "existing_domain", "existing-domain"].includes(normalized)) {
    return "existing";
  }
  return normalized;
}

function extractProvisionLocalPart(message: string) {
  const lowered = message.trim().toLowerCase();
  if (!lowered) return "";
  const labeledMatch = lowered.match(
    /\b(?:local[- ]part|local part|username|mailbox name)\s*(?::|=|-|is)?\s*([a-z0-9._%+-]{1,64})\b/
  );
  if (labeledMatch?.[1]) {
    return labeledMatch[1];
  }
  return "";
}

function hasExplicitRegistrantSignal(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return (
    /\b(first name|last name|company|organization|organisation|email|phone|address|street|city|state|province|postal|zip|country)\b/i.test(
      trimmed
    ) ||
    trimmed.includes("\n") ||
    trimmed.split(",").length >= 4
  );
}

function extractQuotedText(message: string) {
  const match = message.match(/["“”'`](.+?)["“”'`]/);
  return match?.[1]?.trim() ?? "";
}

function normalizeMatchText(value: string) {
  return value.toLowerCase().replace(/[`"'“”’]/g, "").replace(/\s+/g, " ").trim();
}

function findNamedItem<T extends { id: string; name?: string; subject?: string; status?: string }>(
  items: T[],
  input: {
    explicitId?: string;
    explicitName?: string;
    message: string;
    statusHints?: string[];
  }
) {
  if (input.explicitId) {
    return items.find((item) => item.id === input.explicitId) ?? null;
  }

  const messageText = normalizeMatchText(input.message);
  const explicitName = normalizeMatchText(input.explicitName ?? "");
  const candidates = items.filter((item) => {
    if (!input.statusHints?.length) return true;
    return input.statusHints.some((status) => normalizeMatchText(item.status ?? "") === normalizeMatchText(status));
  });

  if (explicitName) {
    const exact = candidates.find((item) => {
      const label = normalizeMatchText(String(item.name ?? item.subject ?? ""));
      return label === explicitName;
    });
    if (exact) return exact;
  }

  const matched =
    candidates.find((item) => {
      const label = normalizeMatchText(String(item.name ?? item.subject ?? ""));
      return label.length > 0 && messageText.includes(label);
    }) ?? null;
  if (matched) return matched;

  if (candidates.length === 1) {
    return candidates[0] ?? null;
  }

  return null;
}

function findNamedCandidates<T extends { id: string; name?: string; subject?: string; status?: string }>(
  items: T[],
  input: {
    explicitId?: string;
    explicitName?: string;
    message: string;
    statusHints?: string[];
  }
) {
  if (input.explicitId) {
    return items.filter((item) => item.id === input.explicitId);
  }

  const messageText = normalizeMatchText(input.message);
  const explicitName = normalizeMatchText(input.explicitName ?? "");
  const candidates = items.filter((item) => {
    if (!input.statusHints?.length) return true;
    return input.statusHints.some((status) => normalizeMatchText(item.status ?? "") === normalizeMatchText(status));
  });

  if (explicitName) {
    const exact = candidates.filter((item) => {
      const label = normalizeMatchText(String(item.name ?? item.subject ?? ""));
      return label === explicitName;
    });
    if (exact.length) return exact;
  }

  const matched = candidates.filter((item) => {
    const label = normalizeMatchText(String(item.name ?? item.subject ?? ""));
    return label.length > 0 && messageText.includes(label);
  });
  if (matched.length) return matched;

  return candidates;
}

function summarizeActionPreview(action: OperatorAction): OperatorChatAssistantReply {
  const previewSummary = asString(action.preview.summary) || "Operator prepared an action preview.";
  return {
    summary: `I'm ready to do it. ${previewSummary} Confirm when you want me to run it.`,
    findings: [],
    recommendations: [],
  };
}

function summarizePromptMessages(messages: OperatorMessage[]) {
  return messages.slice(-12).map((message) => ({
    role: message.role,
    kind: message.kind,
    text: asString(message.content.text) || JSON.stringify(message.content).slice(0, 400),
  }));
}

function summarizePromptContext(
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>,
  options: { includeCampaigns?: boolean } = {}
) {
  if (!context) return { brand: null };
  return {
    brand: context.brand,
    assignment: context.assignment,
    provisioning: context.provisioning,
    senders: {
      total: context.senders.total,
      ready: context.senders.ready,
      pending: context.senders.pending,
      blocked: context.senders.blocked,
      snapshots: context.senders.snapshots.map((snapshot) => ({
        accountId: snapshot.accountId,
        accountName: snapshot.accountName,
        provider: snapshot.provider,
        status: snapshot.status,
        fromEmail: snapshot.fromEmail,
        replyToEmail: snapshot.replyToEmail,
        domain: snapshot.domain,
        automationStatus: snapshot.automationStatus,
        automationSummary: snapshot.automationSummary,
        routeScore: snapshot.routeScore,
        routeLabel: snapshot.routeLabel,
        mailpoolStatus: snapshot.mailpoolStatus,
        spamCheckSummary: snapshot.spamCheckSummary,
        inboxPlacementId: snapshot.inboxPlacementId,
        dnsStatus: snapshot.dnsStatus,
      })),
    },
    routing: context.routing,
    campaigns: options.includeCampaigns
      ? {
          ...context.campaigns,
          items: context.campaigns.items.slice(0, 10),
        }
      : undefined,
    experiments: {
      ...context.experiments,
      items: context.experiments.items.slice(0, 10),
    },
    leads: {
      ...context.leads,
      items: context.leads.items.slice(0, 20),
    },
    inbox: {
      threads: context.inbox.threads,
      newThreads: context.inbox.newThreads,
      openThreads: context.inbox.openThreads,
      closedThreads: context.inbox.closedThreads,
      threadItems: context.inbox.threadItems.slice(0, 10),
      draftItems: context.inbox.draftItems.slice(0, 10),
    },
    issues: context.issues,
    nextActions: context.nextActions,
  };
}

function makeUnexecutedActionAssistant(message: string, assistant: OperatorChatAssistantReply): OperatorChatAssistantReply {
  const summary = asString(assistant.summary);
  if (!isExplicitMutationRequest(message)) {
    return assistant;
  }
  if (summary && /\b(created|updated|deleted|launched|paused|resumed|sent|refreshed|dismissed|provisioned)\b/i.test(summary)) {
    return assistant;
  }
  return {
    summary: "I didn't make any changes yet. When I take an action, I'll either do it and show a receipt or tell you exactly what's missing.",
    findings: [],
    recommendations: [],
  };
}

function buildProvisionMissingFields(toolInput: Record<string, unknown>, toolName: OperatorToolName = "provision_mailpool_sender") {
  const missingFields: string[] = [];
  if (!asString(toolInput.fromLocalPart) || !asString(toolInput.domain)) {
    missingFields.push("sender email");
  }
  if (toolName === "provision_mailpool_sender") {
    if (!asString(toolInput.senderFirstName)) {
      missingFields.push("sender first name");
    }
    if (!asString(toolInput.senderLastName)) {
      missingFields.push("sender last name");
    }
  }
  if (normalizeProvisionDomainMode(toolInput.domainMode) === "register") {
    const registrant = asRecord(toolInput.registrant);
    const requiredRegistrantFields: Array<[string, string]> = [
      ["firstName", "registrant first name"],
      ["lastName", "registrant last name"],
      ["emailAddress", "registrant email"],
      ["address1", "registrant street address"],
      ["city", "registrant city"],
      ["stateProvince", "registrant state or province"],
      ["postalCode", "registrant postal code"],
      ["country", "registrant country"],
    ];
    for (const [field, label] of requiredRegistrantFields) {
      if (!asString(registrant[field])) {
        missingFields.push(label);
      }
    }
  }
  return missingFields;
}

type PendingConversationContinuation =
  | {
      kind: "structured_action";
      requestedAction: OperatorRequestedAction;
    }
  | {
      kind: "message_override";
      message: string;
    }
  | {
      kind: "confirm_action";
      actionId: string;
    }
  | {
      kind: "cancel_action";
      actionId: string;
    };

function readExecutionEnvelope(value: unknown): OperatorExecutionEnvelope | null {
  const row = asRecord(value);
  const state = asString(row.state) as OperatorExecutionEnvelope["state"];
  if (!state || state === "answer_only") return null;
  return {
    state,
    actionId: asString(row.actionId),
    intent: row.intent ? (asRecord(row.intent) as OperatorExecutionEnvelope["intent"]) : null,
    toolName: asString(row.toolName) as OperatorExecutionEnvelope["toolName"],
    toolInput: asRecord(row.toolInput),
    preview: asRecord(row.preview),
    receipt: row.receipt ? (asRecord(row.receipt) as OperatorReceipt) : null,
    missingFields: Array.isArray(row.missingFields) ? row.missingFields.map((entry) => asString(entry)).filter(Boolean) : [],
    questions: Array.isArray(row.questions) ? (row.questions as OperatorExecutionQuestion[]) : [],
    forms: Array.isArray(row.forms) ? (row.forms as OperatorExecutionForm[]) : [],
    error: asString(row.error),
  };
}

function getLatestPendingAssistantExecution(messages: OperatorMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || message.kind !== "message") continue;
    const execution = readExecutionEnvelope(asRecord(message.content).execution);
    if (execution && execution.state !== "completed" && execution.state !== "failed" && execution.state !== "canceled") {
      return { message, execution };
    }
  }
  return null;
}

function getExecutionToolInput(execution: OperatorExecutionEnvelope) {
  if (Object.keys(asRecord(execution.toolInput)).length > 0) {
    return asRecord(execution.toolInput);
  }
  const firstForm = Array.isArray(execution.forms) ? execution.forms[0] : null;
  return asRecord(firstForm?.input);
}

const QUESTION_OPTION_ORDINALS = [
  ["1", "one", "first"],
  ["2", "two", "second"],
  ["3", "three", "third"],
  ["4", "four", "fourth"],
  ["5", "five", "fifth"],
  ["6", "six", "sixth"],
] as const;

function findQuestionOptionMatch(execution: OperatorExecutionEnvelope, message: string) {
  const normalized = normalizeMatchText(message);
  if (!normalized) return null;
  const questionOptions = (execution.questions ?? []).flatMap((question) =>
    Array.isArray(question.options) ? question.options : []
  );

  if (questionOptions.length === 1 && /^(that|that one|this|this one|the one)$/i.test(normalized)) {
    return questionOptions[0] ?? null;
  }

  if (/^(last|the last|final|the final)$/i.test(normalized) && questionOptions.length > 0) {
    return questionOptions[questionOptions.length - 1] ?? null;
  }

  for (let index = 0; index < questionOptions.length; index += 1) {
    const option = questionOptions[index];
    const ordinalTokens = QUESTION_OPTION_ORDINALS[index] ?? [];
    const ordinalPattern = new RegExp(
      `^(?:option\\s+)?(?:${ordinalTokens.join("|")})(?:\\s+one)?$`,
      "i"
    );
    if (ordinalTokens.length > 0 && ordinalPattern.test(normalized)) {
      return option;
    }
  }

  for (const question of execution.questions ?? []) {
    for (const option of question.options ?? []) {
      const label = normalizeMatchText(option.label);
      const optionMessage = normalizeMatchText(option.message);
      if (label && (normalized === label || normalized.includes(label) || label.includes(normalized))) {
        return option;
      }
      if (optionMessage && normalized === optionMessage) {
        return option;
      }
    }
  }
  return null;
}

const COUNTRY_CODE_BY_NAME: Record<string, string> = {
  australia: "AU",
  austria: "AT",
  belgium: "BE",
  canada: "CA",
  denmark: "DK",
  finland: "FI",
  france: "FR",
  germany: "DE",
  ireland: "IE",
  italy: "IT",
  lithuania: "LT",
  netherlands: "NL",
  norway: "NO",
  poland: "PL",
  portugal: "PT",
  spain: "ES",
  sweden: "SE",
  switzerland: "CH",
  "united kingdom": "GB",
  uk: "GB",
  "great britain": "GB",
  "united states": "US",
  usa: "US",
  us: "US",
};

function normalizeCountryCode(value: string) {
  const normalized = normalizeMatchText(value);
  if (!normalized) return "";
  if (/^[a-z]{2}$/i.test(normalized)) return normalized.toUpperCase();
  return COUNTRY_CODE_BY_NAME[normalized] ?? value.trim().toUpperCase();
}

function extractLabeledField(message: string, labels: string[]) {
  const pattern = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"))
    .join("|");
  const regex = new RegExp(`(?:^|[\\n;,])\\s*(?:${pattern})\\s*(?::|=|-)?\\s*([^\\n;]+)`, "i");
  const match = message.match(regex);
  return match?.[1]?.trim() ?? "";
}

function parseNameFromLine(line: string) {
  const cleaned = line
    .replace(/^(name|contact|registrant)\s*[:=-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
}

function parseSenderIdentityFromMessage(message: string) {
  const firstName = extractLabeledField(message, [
    "sender first name",
    "sender firstname",
    "from first name",
  ]);
  const lastName = extractLabeledField(message, [
    "sender last name",
    "sender lastname",
    "from last name",
  ]);
  if (firstName || lastName) {
    return { firstName, lastName };
  }

  const displayName =
    extractLabeledField(message, [
      "sender name",
      "sender display name",
      "display name",
      "from name",
      "mailbox name",
      "person name",
    ]) ||
    (() => {
      const match = message.match(/\b(?:as|from)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){1,3})\b/);
      return match?.[1]?.trim() ?? "";
    })();
  const parsedLabeledName = displayName ? parseNameFromLine(displayName) : null;
  if (parsedLabeledName) {
    return parsedLabeledName;
  }

  const directName = parseNameFromLine(message);
  if (
    directName &&
    !/@/.test(message) &&
    !/\b(existing|domain|buy|register|sender|mailpool|gmail|google)\b/i.test(message)
  ) {
    return directName;
  }

  return null;
}

function parseAddressBlock(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return {} as Record<string, string>;

  let working = cleaned;
  let country = "";
  const commaParts = working
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (commaParts.length > 1) {
    const candidateCountry = normalizeCountryCode(commaParts[commaParts.length - 1] ?? "");
    if (candidateCountry && candidateCountry.length <= 3) {
      country = candidateCountry;
      commaParts.pop();
      working = commaParts.join(", ").trim();
    }
  }

  let postalCode = "";
  let city = "";
  let stateProvince = "";
  let address1 = working;

  const patterns = [
    /^(.*?)(?:,\s*)?(\d{4,10})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.' -]+?)(?:\s+([A-Za-z]{1,4}))?$/u,
    /^(.*?)(?:,\s*)?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.' -]+?)(?:\s+([A-Za-z]{1,4}))?\s+(\d{4,10})$/u,
  ];

  for (const pattern of patterns) {
    const match = working.match(pattern);
    if (!match) continue;
    if (pattern === patterns[0]) {
      address1 = (match[1] ?? "").trim().replace(/,\s*$/, "");
      postalCode = (match[2] ?? "").trim();
      city = (match[3] ?? "").trim();
      stateProvince = (match[4] ?? "").trim();
    } else {
      address1 = (match[1] ?? "").trim().replace(/,\s*$/, "");
      city = (match[2] ?? "").trim();
      stateProvince = (match[3] ?? "").trim();
      postalCode = (match[4] ?? "").trim();
    }
    break;
  }

  if (!postalCode && commaParts.length >= 2) {
    const tail = commaParts[commaParts.length - 1] ?? "";
    const postalMatch = tail.match(/(\d{4,10})/);
    if (postalMatch) {
      postalCode = postalMatch[1] ?? "";
      const withoutPostal = tail.replace(postalMatch[1] ?? "", "").trim();
      const tailParts = withoutPostal.split(/\s+/).filter(Boolean);
      stateProvince = tailParts.length > 1 ? tailParts[tailParts.length - 1] ?? "" : "";
      city = tailParts.length > 1 ? tailParts.slice(0, -1).join(" ") : withoutPostal;
      address1 = commaParts.slice(0, -1).join(", ");
    }
  }

  return {
    address1: address1.trim(),
    city,
    stateProvince,
    postalCode,
    country,
  };
}

function parseRegistrantFromMessage(input: {
  message: string;
  existingRegistrant: Record<string, unknown>;
  brandMemory: OperatorBrandMemory | null;
  brandName?: string;
}) {
  const message = input.message.trim();
  if (!message) return asRecord(input.existingRegistrant);

  const registrant: Record<string, unknown> = {
    ...input.existingRegistrant,
  };

  const labeledValues = {
    firstName: extractLabeledField(message, ["first name", "firstname", "first"]),
    lastName: extractLabeledField(message, ["last name", "lastname", "last"]),
    organizationName: extractLabeledField(message, ["company", "organization", "organisation", "org"]),
    emailAddress: extractLabeledField(message, ["email", "email address"]),
    phone: extractLabeledField(message, ["phone", "telephone", "mobile"]),
    address1: extractLabeledField(message, ["street address", "address", "street"]),
    city: extractLabeledField(message, ["city"]),
    stateProvince: extractLabeledField(message, ["state / province", "state/province", "state", "province", "region"]),
    postalCode: extractLabeledField(message, ["postal code", "postcode", "zip code", "zip"]),
    country: extractLabeledField(message, ["country"]),
  };

  for (const [key, value] of Object.entries(labeledValues)) {
    if (!value) continue;
    registrant[key] = key === "country" ? normalizeCountryCode(value) : value;
  }

  if (!asString(registrant.emailAddress)) {
    const emailMatch = message.match(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i);
    if (emailMatch?.[1]) {
      registrant.emailAddress = emailMatch[1].trim();
    }
  }

  if (!asString(registrant.phone)) {
    const phoneMatch = message.match(/(\+?[0-9][0-9\s().-]{6,}[0-9])/);
    if (phoneMatch?.[1]) {
      registrant.phone = phoneMatch[1].trim();
    }
  }

  const normalizedLines = message
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const unlabeledLines = normalizedLines.filter(
    (line) => !/^(first|last|company|organization|organisation|org|email|phone|street|address|city|state|province|postal|zip|country)\b/i.test(line)
  );
  const emailIndex = unlabeledLines.findIndex((line) => /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(line));
  const beforeEmail = emailIndex >= 0 ? unlabeledLines.slice(0, emailIndex) : unlabeledLines.slice(0, 3);
  const afterEmail = emailIndex >= 0 ? unlabeledLines.slice(emailIndex + 1) : unlabeledLines.slice(beforeEmail.length);

  if (!asString(registrant.firstName) || !asString(registrant.lastName)) {
    const nameLine = beforeEmail.find((line) => line.split(/\s+/).length >= 2 && !/@/.test(line));
    const parsedName = nameLine ? parseNameFromLine(nameLine) : null;
    if (parsedName) {
      if (!asString(registrant.firstName)) registrant.firstName = parsedName.firstName;
      if (!asString(registrant.lastName)) registrant.lastName = parsedName.lastName;
    } else if (beforeEmail.length >= 2) {
      if (!asString(registrant.firstName)) registrant.firstName = beforeEmail[0] ?? "";
      if (!asString(registrant.lastName)) registrant.lastName = beforeEmail[1] ?? "";
    }
  }

  if (!asString(registrant.organizationName)) {
    const nameLine = beforeEmail.find((line) => line.split(/\s+/).length >= 2 && !/@/.test(line));
    const remainingBeforeEmail = beforeEmail.filter((line) => line !== nameLine);
    const atMatch = message.match(/\bat\s+([A-Za-z0-9][A-Za-z0-9 .&'-]{1,80})/i);
    if (atMatch?.[1]) {
      registrant.organizationName = atMatch[1].trim().replace(/[.,;]$/, "");
    } else if (remainingBeforeEmail.length > 0) {
      registrant.organizationName = remainingBeforeEmail[0] ?? "";
    } else if (beforeEmail.length >= 3) {
      registrant.organizationName = beforeEmail[2] ?? "";
    } else if (input.brandName) {
      registrant.organizationName = input.brandName;
    }
  }

  if (
    !asString(registrant.address1) ||
    !asString(registrant.city) ||
    !asString(registrant.postalCode) ||
    !asString(registrant.country)
  ) {
    const addressBlock =
      afterEmail.join(", ") ||
      message
        .replace(String(registrant.emailAddress ?? ""), "")
        .replace(String(registrant.firstName ?? ""), "")
        .replace(String(registrant.lastName ?? ""), "")
        .replace(String(registrant.organizationName ?? ""), "")
        .trim();
    const parsedAddress = parseAddressBlock(addressBlock);
    if (!asString(registrant.address1) && parsedAddress.address1) registrant.address1 = parsedAddress.address1;
    if (!asString(registrant.city) && parsedAddress.city) registrant.city = parsedAddress.city;
    if (!asString(registrant.stateProvince) && parsedAddress.stateProvince) registrant.stateProvince = parsedAddress.stateProvince;
    if (!asString(registrant.postalCode) && parsedAddress.postalCode) registrant.postalCode = parsedAddress.postalCode;
    if (!asString(registrant.country) && parsedAddress.country) registrant.country = parsedAddress.country;
  }

  if (!asString(registrant.country) && asString(input.brandMemory?.registrantDefaults.country)) {
    registrant.country = asString(input.brandMemory?.registrantDefaults.country);
  } else {
    registrant.country = normalizeCountryCode(asString(registrant.country));
  }

  return registrant;
}

function mergeProvisionInputFromContinuation(input: {
  message: string;
  baseInput: Record<string, unknown>;
  brandContext: Awaited<ReturnType<typeof getOperatorBrandContext>>;
  brandMemory: OperatorBrandMemory | null;
  toolName: OperatorToolName;
}): Record<string, unknown> {
  const lowered = input.message.trim().toLowerCase();
  const needsSenderEmail = !asString(input.baseInput.fromLocalPart) || !asString(input.baseInput.domain);
  const nextInput: Record<string, unknown> = {
    ...input.baseInput,
    registrant: asRecord(input.baseInput.registrant),
  };
  const inventoryDomains = (input.brandContext?.provisioning.mailpoolDomains ?? []).map((item) => item.domain.toLowerCase());
  const optionMatch = findQuestionOptionMatch(
    buildExecutionEnvelope({
      state: "need_info",
      toolName: input.toolName,
      toolInput: input.baseInput,
      questions: buildProvisionQuestions({
        hasMailpoolInventory: (input.brandContext?.provisioning.mailpoolDomainInventoryCount ?? 0) > 0,
        domainMode: normalizeProvisionDomainMode(input.baseInput.domainMode),
        missingFields: buildProvisionMissingFields(input.baseInput, input.toolName),
      }),
    }),
    input.message
  );
  const optionMessage = optionMatch?.message.toLowerCase() ?? "";

  if (
    lowered.includes("existing domain") ||
    lowered.includes("use existing") ||
    optionMessage.includes("existing mailpool domain") ||
    optionMessage.includes("existing customer.io domain")
  ) {
    nextInput.domainMode = "existing";
  } else if (
    lowered.includes("buy new") ||
    lowered.includes("new domain") ||
    lowered.includes("register") ||
    lowered.includes("buy ") ||
    optionMessage.includes("buying a new sender domain")
  ) {
    nextInput.domainMode = "register";
  }

  const emailParts = extractEmailParts(input.message);
  if (needsSenderEmail && emailParts) {
    nextInput.fromLocalPart = emailParts.fromLocalPart;
    nextInput.domain = emailParts.domain;
  } else if (needsSenderEmail) {
    const directDomain = extractDomain(input.message);
    if (directDomain) {
      nextInput.domain = directDomain;
    }
    const singleWord = lowered.match(/^([a-z0-9._%+-]+)$/);
    if (
      singleWord &&
      !singleWord[1]?.includes(".") &&
      !singleWord[1]?.includes("@") &&
      (asString(nextInput.domain) ||
        (normalizeProvisionDomainMode(nextInput.domainMode) === "existing" &&
          (input.brandContext?.provisioning.mailpoolDomains.length ?? 0) === 1))
    ) {
      nextInput.fromLocalPart = singleWord[1];
      if (!asString(nextInput.domain) && (input.brandContext?.provisioning.mailpoolDomains.length ?? 0) === 1) {
        nextInput.domain = input.brandContext?.provisioning.mailpoolDomains[0]?.domain ?? "";
      }
    }
  }

  const senderIdentity = parseSenderIdentityFromMessage(input.message);
  if (senderIdentity) {
    if (!asString(nextInput.senderFirstName) && senderIdentity.firstName) {
      nextInput.senderFirstName = senderIdentity.firstName;
    }
    if (!asString(nextInput.senderLastName) && senderIdentity.lastName) {
      nextInput.senderLastName = senderIdentity.lastName;
    }
  }

  nextInput.domainMode = normalizeProvisionDomainMode(nextInput.domainMode);

  if (!asString(nextInput.domain) && normalizeProvisionDomainMode(nextInput.domainMode) === "existing") {
    const rememberedDomain = asString(input.brandMemory?.senderDefaults.domain);
    const onlyDomain =
      (input.brandContext?.provisioning.mailpoolDomains.length ?? 0) === 1
        ? input.brandContext?.provisioning.mailpoolDomains[0]?.domain ?? ""
        : "";
    nextInput.domain = rememberedDomain || onlyDomain;
  } else if (
    normalizeProvisionDomainMode(nextInput.domainMode) === "existing" &&
    asString(nextInput.domain) &&
    !inventoryDomains.includes(asString(nextInput.domain).toLowerCase())
  ) {
    const rememberedDomain = asString(input.brandMemory?.senderDefaults.domain);
    const onlyDomain =
      (input.brandContext?.provisioning.mailpoolDomains.length ?? 0) === 1
        ? input.brandContext?.provisioning.mailpoolDomains[0]?.domain ?? ""
        : "";
    nextInput.domain = rememberedDomain || onlyDomain || "";
  }

  return nextInput;
}

function inferContinuationFromPendingExecution(input: {
  message: string;
  messages: OperatorMessage[];
  actions: OperatorAction[];
  brandContext: Awaited<ReturnType<typeof getOperatorBrandContext>>;
  brandMemory: OperatorBrandMemory | null;
  brandId: string;
}): PendingConversationContinuation | null {
  const pending = getLatestPendingAssistantExecution(input.messages);
  if (!pending) return null;
  const message = input.message.trim();
  const optionMatch = findQuestionOptionMatch(pending.execution, message);
  const latestAction =
    (pending.execution.actionId
      ? input.actions.find((action) => action.id === pending.execution.actionId)
      : null) ??
    input.actions.find((action) => action.status === "awaiting_approval");

  if (pending.execution.state === "awaiting_confirmation" && latestAction) {
    if (isAffirmativeMessage(message)) {
      return { kind: "confirm_action", actionId: latestAction.id };
    }
    if (isNegativeMessage(message)) {
      return { kind: "cancel_action", actionId: latestAction.id };
    }
    return null;
  }

  if (pending.execution.state !== "need_info") {
    return null;
  }

  if (!isProvisionSenderToolName(pending.execution.toolName)) {
    if (optionMatch?.message) {
      return {
        kind: "message_override",
        message: optionMatch.message,
      };
    }
    return null;
  }

  const baseInput = getExecutionToolInput(pending.execution);
  if (!Object.keys(baseInput).length) return null;

  const effectiveMessage = optionMatch?.message ?? message;
  const nextInput = mergeProvisionInputFromContinuation({
    message: effectiveMessage,
    baseInput: {
      ...baseInput,
      brandId: input.brandId || asString(baseInput.brandId),
      provider: provisionProviderForTool(pending.execution.toolName),
      domainMode: normalizeProvisionDomainMode(baseInput.domainMode),
    },
    brandContext: input.brandContext,
    brandMemory: input.brandMemory,
    toolName: pending.execution.toolName,
  });

  const needsSenderEmail = !asString(baseInput.fromLocalPart) || !asString(baseInput.domain);
  const shouldParseRegistrant =
    normalizeProvisionDomainMode(nextInput.domainMode) === "register" &&
    (!needsSenderEmail ||
      hasExplicitRegistrantSignal(message));
  const nextRegistrant =
    shouldParseRegistrant
      ? parseRegistrantFromMessage({
          message,
          existingRegistrant: asRecord(nextInput.registrant),
          brandMemory: input.brandMemory,
          brandName: input.brandContext?.brand.name,
        })
      : asRecord(nextInput.registrant);
  nextInput.registrant = nextRegistrant;

  const changed =
    JSON.stringify({
      ...baseInput,
      registrant: asRecord(baseInput.registrant),
    }) !==
    JSON.stringify({
      ...nextInput,
      registrant: asRecord(nextInput.registrant),
    });

  if (!changed && optionMatch?.message) {
    return {
      kind: "message_override",
      message: optionMatch.message,
    };
  }

  if (!changed && !needsSenderEmail) {
    return null;
  }

  return {
    kind: "structured_action",
    requestedAction: {
      toolName: pending.execution.toolName,
      input: nextInput,
    },
  };
}

function resolveSenderAccountId(
  rawInput: Record<string, unknown>,
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>
) {
  const explicit = asString(rawInput.accountId);
  if (explicit) return explicit;

  const fromEmail = asString(rawInput.fromEmail).toLowerCase();
  if (fromEmail) {
    const matched = context?.senders.snapshots.find((snapshot) => snapshot.fromEmail === fromEmail);
    if (matched?.accountId) return matched.accountId;
  }

  const fromLocalPart = asString(rawInput.fromLocalPart).toLowerCase();
  const domain = asString(rawInput.domain).toLowerCase();
  if (fromLocalPart && domain) {
    const matched = context?.senders.snapshots.find((snapshot) => snapshot.fromEmail === `${fromLocalPart}@${domain}`);
    if (matched?.accountId) return matched.accountId;
  }

  const pendingMailpool =
    context?.senders.snapshots.find((snapshot) => snapshot.provider === "mailpool" && snapshot.mailpoolStatus === "pending") ??
    null;
  if (pendingMailpool?.accountId) return pendingMailpool.accountId;

  if (context?.senders.snapshots.length === 1) {
    return context.senders.snapshots[0]?.accountId ?? "";
  }

  return "";
}

const TOOLS_WITH_BRAND_CONTEXT = new Set<OperatorToolName>([
  "get_brand_snapshot",
  "inspect_outbound_blocker_chain",
  "summarize_campaign_status",
  "get_campaign_snapshot",
  "summarize_experiments",
  "get_experiment_snapshot",
  "summarize_leads",
  "summarize_inbox",
  "investigate_brand_data",
  "get_leadr_snapshot",
  "provision_mailpool_sender",
  "provision_customerio_sender",
  "update_brand",
  "delete_brand",
  "add_brand_lead",
  "update_brand_lead",
  "create_experiment",
  "update_experiment",
  "delete_experiment",
  "launch_experiment_run",
  "control_experiment_run",
  "promote_experiment_to_campaign",
  "update_campaign",
  "delete_campaign",
  "launch_campaign_run",
  "control_campaign_run",
  "create_leadr_campaign",
  "send_reply_draft",
  "dismiss_reply_draft",
]);

function resolveExperimentId(
  rawInput: Record<string, unknown>,
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>,
  message: string
) {
  const matched = findNamedItem(context?.experiments.items ?? [], {
    explicitId: asString(rawInput.experimentId),
    explicitName:
      asString(rawInput.experimentName) ||
      (asString(rawInput.name) && !asString(rawInput.brandId) ? asString(rawInput.name) : "") ||
      extractQuotedText(message),
    message,
    statusHints:
      /\brunning\b/.test(message.toLowerCase())
        ? ["Running", "Sourcing"]
        : /\bdraft\b/.test(message.toLowerCase())
          ? ["Draft"]
          : /\bcompleted\b/.test(message.toLowerCase())
            ? ["Completed"]
            : undefined,
  });
  return matched?.id ?? "";
}

function resolveCampaignId(
  rawInput: Record<string, unknown>,
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>,
  message: string
) {
  const matched = findNamedItem(context?.campaigns.items ?? [], {
    explicitId: asString(rawInput.campaignId),
    explicitName: asString(rawInput.campaignName) || extractQuotedText(message),
    message,
    statusHints:
      /\bactive\b/.test(message.toLowerCase())
        ? ["active"]
        : /\bdraft\b/.test(message.toLowerCase())
          ? ["draft"]
          : /\bpaused\b/.test(message.toLowerCase())
            ? ["paused"]
            : undefined,
  });
  return matched?.id ?? "";
}

function resolveLeadId(
  rawInput: Record<string, unknown>,
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>,
  message: string
) {
  const matched = findNamedItem(context?.leads.items ?? [], {
    explicitId: asString(rawInput.leadId),
    explicitName: asString(rawInput.leadName) || asString(rawInput.name) || extractQuotedText(message),
    message,
    statusHints:
      /\bqualified\b/.test(message.toLowerCase())
        ? ["qualified"]
        : /\bcontacted\b/.test(message.toLowerCase())
          ? ["contacted"]
          : /\bclosed\b/.test(message.toLowerCase())
            ? ["closed"]
            : /\bnew\b/.test(message.toLowerCase())
              ? ["new"]
              : undefined,
  });
  return matched?.id ?? "";
}

function resolveDraftId(
  rawInput: Record<string, unknown>,
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>,
  message: string
) {
  const matched = findNamedItem(
    (context?.inbox.draftItems ?? []).map((draft) => ({
      ...draft,
      name: draft.subject,
    })),
    {
      explicitId: asString(rawInput.draftId),
      explicitName: asString(rawInput.draftSubject) || extractQuotedText(message),
      message,
      statusHints: /\bdraft\b/.test(message.toLowerCase()) ? ["draft"] : undefined,
    }
  );
  return matched?.id ?? "";
}

function mentionsReferencePronoun(message: string) {
  return /\b(it|that|this one|that one|current one|current)\b/.test(message.toLowerCase());
}

function experimentStatusHints(message: string) {
  const lowered = message.toLowerCase();
  if (/\brunning\b/.test(lowered)) return ["Running", "Sourcing"];
  if (/\bdraft\b/.test(lowered)) return ["Draft"];
  if (/\bcompleted\b/.test(lowered)) return ["Completed"];
  if (/\bpaused\b/.test(lowered)) return ["Paused"];
  if (/\bready\b/.test(lowered)) return ["Ready", "Preparing"];
  return undefined;
}

function campaignStatusHints(message: string) {
  const lowered = message.toLowerCase();
  if (/\bactive\b/.test(lowered)) return ["active"];
  if (/\bdraft\b/.test(lowered)) return ["draft"];
  if (/\bpaused\b/.test(lowered)) return ["paused"];
  if (/\bcompleted\b/.test(lowered)) return ["completed"];
  return undefined;
}

function inferExperimentIntent(message: string) {
  const lowered = message.toLowerCase();
  if (lowered.includes("launch") || lowered.includes("start")) {
    return {
      toolName: "launch_experiment_run" as const,
      verb: "launch",
      buildMessage: (name: string) => `Launch experiment "${name}".`,
      input: {},
    };
  }
  if (lowered.includes("pause") || lowered.includes("resume") || lowered.includes("cancel")) {
    const action = lowered.includes("pause") ? "pause" : lowered.includes("resume") ? "resume" : "cancel";
    return {
      toolName: "control_experiment_run" as const,
      verb: action,
      buildMessage: (name: string) => `${action.charAt(0).toUpperCase()}${action.slice(1)} experiment "${name}".`,
      input: { action },
    };
  }
  if (lowered.includes("promote") || lowered.includes("make campaign")) {
    return {
      toolName: "promote_experiment_to_campaign" as const,
      verb: "promote",
      buildMessage: (name: string) => `Promote experiment "${name}" to a campaign.`,
      input: {},
    };
  }
  if (lowered.includes("delete") || lowered.includes("remove")) {
    return {
      toolName: "delete_experiment" as const,
      verb: "delete",
      buildMessage: (name: string) => `Delete experiment "${name}".`,
      input: {},
    };
  }
  return {
    toolName: "get_experiment_snapshot" as const,
    verb: "inspect",
    buildMessage: (name: string) => `Show experiment "${name}".`,
    input: {},
  };
}

function inferCampaignIntent(message: string) {
  const lowered = message.toLowerCase();
  if (lowered.includes("launch") || lowered.includes("start")) {
    return {
      toolName: "launch_campaign_run" as const,
      verb: "launch",
      buildMessage: (name: string) => `Launch campaign "${name}".`,
      input: {},
    };
  }
  if (lowered.includes("pause") || lowered.includes("resume") || lowered.includes("cancel")) {
    const action = lowered.includes("pause") ? "pause" : lowered.includes("resume") ? "resume" : "cancel";
    return {
      toolName: "control_campaign_run" as const,
      verb: action,
      buildMessage: (name: string) => `${action.charAt(0).toUpperCase()}${action.slice(1)} campaign "${name}".`,
      input: { action },
    };
  }
  if (lowered.includes("delete") || lowered.includes("remove")) {
    return {
      toolName: "delete_campaign" as const,
      verb: "delete",
      buildMessage: (name: string) => `Delete campaign "${name}".`,
      input: {},
    };
  }
  return {
    toolName: "get_campaign_snapshot" as const,
    verb: "inspect",
    buildMessage: (name: string) => `Show campaign "${name}".`,
    input: {},
  };
}

function inferDraftIntent(message: string) {
  const lowered = message.toLowerCase();
  if (lowered.includes("dismiss") || lowered.includes("skip")) {
    return {
      toolName: "dismiss_reply_draft" as const,
      verb: "dismiss",
      buildMessage: (subject: string) => `Dismiss draft "${subject}".`,
    };
  }
  return {
    toolName: "send_reply_draft" as const,
    verb: "send",
    buildMessage: (subject: string) => `Send draft "${subject}".`,
  };
}

function buildDisambiguationEnvelope(input: {
  toolName: OperatorToolName;
  toolInput: Record<string, unknown>;
  label: string;
  questionPrompt: string;
  options: Array<{ label: string; message: string }>;
}): {
  assistant: OperatorChatAssistantReply;
  execution: OperatorExecutionEnvelope;
} {
  return {
    assistant: {
      summary: input.label,
      findings: [],
      recommendations: [],
    },
    execution: buildNeedInfoEnvelope({
      toolName: input.toolName,
      toolInput: input.toolInput,
      missingFields: [input.questionPrompt.toLowerCase()],
      questions: [buildQuestion(input.questionPrompt, input.options)],
    }),
  };
}

function inferDisambiguationTurn(input: {
  message: string;
  brandContext: Awaited<ReturnType<typeof getOperatorBrandContext>>;
}) {
  const context = input.brandContext;
  if (!context) return null;
  const message = input.message;
  const lowered = message.toLowerCase();
  const quoted = extractQuotedText(message);

  if (/\bexperiments?\b/.test(lowered) || (mentionsReferencePronoun(message) && (lowered.includes("pause") || lowered.includes("resume") || lowered.includes("cancel") || lowered.includes("launch") || lowered.includes("start") || lowered.includes("promote") || lowered.includes("delete") || lowered.includes("show") || lowered.includes("open")))) {
    const candidates = findNamedCandidates(context.experiments.items, {
      explicitName: quoted,
      message,
      statusHints: experimentStatusHints(message),
    });
    if (candidates.length > 1) {
      const intent = inferExperimentIntent(message);
      const prompt =
        candidates.length === 2
          ? `I found two matching experiments. Which one do you want me to ${intent.verb}?`
          : `I found ${candidates.length} matching experiments. Which one do you want me to ${intent.verb}?`;
      return buildDisambiguationEnvelope({
        toolName: intent.toolName,
        toolInput: { brandId: context.brand.id, ...intent.input },
        label: prompt,
        questionPrompt: "Choose an experiment",
        options: candidates.slice(0, 6).map((item) => ({
          label: item.name,
          message: intent.buildMessage(item.name),
        })),
      });
    }
  }

  if (/\bcampaigns?\b/.test(lowered)) {
    const candidates = findNamedCandidates(context.campaigns.items, {
      explicitName: quoted,
      message,
      statusHints: campaignStatusHints(message),
    });
    if (candidates.length > 1) {
      const intent = inferCampaignIntent(message);
      const prompt =
        candidates.length === 2
          ? `I found two matching campaigns. Which one do you want me to ${intent.verb}?`
          : `I found ${candidates.length} matching campaigns. Which one do you want me to ${intent.verb}?`;
      return buildDisambiguationEnvelope({
        toolName: intent.toolName,
        toolInput: { brandId: context.brand.id, ...intent.input },
        label: prompt,
        questionPrompt: "Choose a campaign",
        options: candidates.slice(0, 6).map((item) => ({
          label: item.name,
          message: intent.buildMessage(item.name),
        })),
      });
    }
  }

  if (/\bdrafts?\b/.test(lowered) && (lowered.includes("send") || lowered.includes("dismiss") || lowered.includes("skip"))) {
    const candidates = findNamedCandidates(
      context.inbox.draftItems.map((draft) => ({ ...draft, name: draft.subject })),
      {
        explicitName: quoted,
        message,
        statusHints: ["draft"],
      }
    );
    if (candidates.length > 1) {
      const intent = inferDraftIntent(message);
      const prompt =
        candidates.length === 2
          ? `I found two matching drafts. Which one do you want me to ${intent.verb}?`
          : `I found ${candidates.length} matching drafts. Which one do you want me to ${intent.verb}?`;
      return buildDisambiguationEnvelope({
        toolName: intent.toolName,
        toolInput: { brandId: context.brand.id },
        label: prompt,
        questionPrompt: "Choose a draft",
        options: candidates.slice(0, 6).map((item) => ({
          label: item.subject,
          message: intent.buildMessage(item.subject),
        })),
      });
    }
  }

  return null;
}

function normalizeRequestedAction(input: {
  raw: unknown;
  brandId: string;
  mode: OperatorChatRequest["mode"];
  message: string;
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>;
  brandMemory: OperatorBrandMemory | null;
  source: "llm" | "heuristic" | "structured" | "continuation";
}): OperatorRequestedAction | null {
  const row = asRecord(input.raw);
  const toolName = asString(row.toolName) as OperatorToolName;
  if (!toolName || !listOperatorToolSpecs().some((tool) => tool.name === toolName)) {
    return null;
  }
  const tool = getOperatorToolSpec(toolName);
  if (input.mode === "recommendation_only" && tool?.riskLevel !== "read") return null;

  const toolInput = { ...asRecord(row.input) };
  if (input.brandId && TOOLS_WITH_BRAND_CONTEXT.has(toolName) && !asString(toolInput.brandId)) {
    toolInput.brandId = input.brandId;
  }

  if (isProvisionSenderToolName(toolName)) {
    toolInput.provider = provisionProviderForTool(toolName);
    toolInput.domainMode = normalizeProvisionDomainMode(toolInput.domainMode);
    if (!asString(toolInput.domainMode)) {
      const message = input.message.toLowerCase();
      toolInput.domainMode =
        message.includes("buy") ||
        message.includes("register") ||
        message.includes("new domain")
          ? "register"
          : message.includes("existing")
            ? "existing"
            : "existing";
    }

    if (input.source === "llm" || input.source === "heuristic") {
      const explicitEmailParts = extractEmailParts(input.message);
      const explicitDomain = extractDomain(input.message);
      const explicitLocalPart = extractProvisionLocalPart(input.message);
      toolInput.fromLocalPart = explicitEmailParts?.fromLocalPart ?? explicitLocalPart ?? "";
      toolInput.domain = explicitEmailParts?.domain ?? explicitDomain ?? "";
      const senderIdentity = parseSenderIdentityFromMessage(input.message);
      if (senderIdentity) {
        toolInput.senderFirstName = senderIdentity.firstName;
        toolInput.senderLastName = senderIdentity.lastName;
      }
      if (!hasExplicitRegistrantSignal(input.message)) {
        toolInput.registrant = {};
      }
    }
  }

  if (toolName === "create_brand") {
    const domain = extractDomain(input.message);
    const website = asString(toolInput.website) || domain;
    if (website) {
      toolInput.website = ensureWebsiteUrl(website);
    }
    if (!asString(toolInput.name)) {
      toolInput.name = asString(toolInput.website).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    }
  }

  if (
    [
      "refresh_mailpool_sender",
      "get_sender_snapshot",
      "gmail_ui_observe_account",
      "gmail_ui_search_mailbox",
      "gmail_ui_verify_sent",
      "gmail_ui_send_message",
      "gmail_ui_close_session",
    ].includes(toolName)
  ) {
    const accountId = resolveSenderAccountId(toolInput, input.context);
    if (!accountId) return null;
    toolInput.accountId = accountId;
  }

  if (
    [
      "get_experiment_snapshot",
      "update_experiment",
      "delete_experiment",
      "launch_experiment_run",
      "control_experiment_run",
      "promote_experiment_to_campaign",
    ].includes(toolName)
  ) {
    const experimentId =
      resolveExperimentId(toolInput, input.context, input.message) ||
      (mentionsReferencePronoun(input.message) ? asString(input.brandMemory?.recentSelection.experimentId) : "");
    if (!experimentId) return null;
    toolInput.experimentId = experimentId;
    if (!asString(toolInput.experimentName)) {
      toolInput.experimentName =
        input.context?.experiments.items.find((item) => item.id === experimentId)?.name ?? "";
    }
  }

  if (
    ["get_campaign_snapshot", "update_campaign", "delete_campaign", "launch_campaign_run", "control_campaign_run"].includes(
      toolName
    )
  ) {
    const campaignId =
      resolveCampaignId(toolInput, input.context, input.message) ||
      (mentionsReferencePronoun(input.message) ? asString(input.brandMemory?.recentSelection.campaignId) : "");
    if (!campaignId) return null;
    toolInput.campaignId = campaignId;
    if (!asString(toolInput.campaignName)) {
      toolInput.campaignName =
        input.context?.campaigns.items.find((item) => item.id === campaignId)?.name ?? "";
    }
  }

  if (toolName === "update_brand_lead") {
    const leadId =
      resolveLeadId(toolInput, input.context, input.message) ||
      (mentionsReferencePronoun(input.message) ? asString(input.brandMemory?.recentSelection.leadId) : "");
    if (!leadId) return null;
    toolInput.leadId = leadId;
    if (!asString(toolInput.leadName)) {
      toolInput.leadName =
        input.context?.leads.items.find((item) => item.id === leadId)?.name ?? "";
    }
  }

  if (toolName === "send_reply_draft" || toolName === "dismiss_reply_draft") {
    const draftId =
      resolveDraftId(toolInput, input.context, input.message) ||
      (mentionsReferencePronoun(input.message) ? asString(input.brandMemory?.recentSelection.draftId) : "");
    if (!draftId) return null;
    toolInput.draftId = draftId;
    if (!asString(toolInput.draftSubject)) {
      toolInput.draftSubject =
        input.context?.inbox.draftItems.find((item) => item.id === draftId)?.subject ?? "";
    }
  }

  if (toolName === "control_campaign_run" && asString(toolInput.action).toLowerCase() === "resume_sender_deliverability") {
    toolInput.senderAccountId =
      asString(toolInput.senderAccountId) || input.context?.routing.preferredSenderAccountId || "";
  }

  if (toolName === "delete_brand" && !asString(toolInput.brandName)) {
    toolInput.brandName = input.context?.brand.name ?? "";
  }

  return {
    toolName,
    input: toolInput,
  };
}

function filterRequestedActionForMessage(
  requestedAction: OperatorRequestedAction | null,
  message: string,
  options: { allowAffirmative?: boolean } = {}
) {
  if (!requestedAction) return null;
  const tool = getOperatorToolSpec(requestedAction.toolName);
  if (!tool) return null;
  if (tool.riskLevel === "read") return requestedAction;
  if (isExplicitActionRequest(message)) return requestedAction;
  if (options.allowAffirmative && isAffirmativeMessage(message)) return requestedAction;
  return null;
}

function shouldUseHeuristicFallbackAction(
  requestedAction: OperatorRequestedAction | null,
  message: string
) {
  if (!requestedAction) return false;
  const tool = getOperatorToolSpec(requestedAction.toolName);
  if (!tool) return false;
  if (tool.approvalMode !== "confirm") return false;
  if (!isExplicitMutationRequest(message)) return false;
  return true;
}

async function planOperatorReplyWithLlm(input: {
  brandId: string;
  message: string;
  mode: OperatorChatRequest["mode"];
  messages: OperatorMessage[];
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>;
  brandMemory: OperatorBrandMemory | null;
  fallbackAssistant: OperatorChatAssistantReply;
}): Promise<OperatorPlannerResult | null> {
  const configuredMaxSteps = Number(process.env.OPERATOR_CHAT_MAX_STEPS);
  const maxSteps = Math.min(8, Math.max(4, Number.isFinite(configuredMaxSteps) ? configuredMaxSteps : 8));
  const result = await runBrandAgentTurn({
    brandId: input.brandId,
    message: input.message,
    mode: input.mode,
    recentMessages: summarizePromptMessages(input.messages),
    compactContext: summarizePromptContext(input.context, { includeCampaigns: true }),
    memory: input.brandMemory ? (input.brandMemory as unknown as Record<string, unknown>) : null,
    fallbackAssistant: input.fallbackAssistant,
    tools: listOperatorToolSpecs(),
    maxSteps,
    reasoningEffort: DEFAULT_OPERATOR_REASONING,
    openAiOverrideModel: asString(process.env.OPENAI_MODEL_OPERATOR),
    openRouterOverrideModel: asString(process.env.OPENROUTER_MODEL_OPERATOR),
    normalizeToolCall: (call) =>
      normalizeRequestedAction({
        raw: call,
        brandId: input.brandId,
        mode: input.mode,
        message: input.message,
        context: input.context,
        brandMemory: input.brandMemory,
        source: "llm",
      }),
  });
  return result;
}

function inferActionFromMessage(
  input: OperatorChatRequest,
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>,
  brandMemory: OperatorBrandMemory | null
): OperatorRequestedAction | null {
  const message = input.message.trim().toLowerCase();
  if (!message) return null;
  const quoted = extractQuotedText(input.message);
  const experimentId = resolveExperimentId({}, context, input.message);
  const campaignId = resolveCampaignId({}, context, input.message);
  const draftId = resolveDraftId({}, context, input.message);
  const leadId = resolveLeadId({}, context, input.message);
  const requestedDomain = extractDomain(input.message);

  if (context?.brand.id && mentionsReferencePronoun(message)) {
    if ((message.includes("pause") || message.includes("resume") || message.includes("cancel")) && asString(brandMemory?.recentSelection.experimentId)) {
      return {
        toolName: "control_experiment_run",
        input: {
          brandId: context.brand.id,
          experimentId: asString(brandMemory?.recentSelection.experimentId),
          action: message.includes("pause") ? "pause" : message.includes("resume") ? "resume" : "cancel",
        },
      };
    }
    if ((message.includes("launch") || message.includes("start")) && asString(brandMemory?.recentSelection.experimentId)) {
      return {
        toolName: "launch_experiment_run",
        input: {
          brandId: context.brand.id,
          experimentId: asString(brandMemory?.recentSelection.experimentId),
        },
      };
    }
    if ((message.includes("send") || message.includes("dismiss") || message.includes("skip")) && asString(brandMemory?.recentSelection.draftId)) {
      return {
        toolName: message.includes("dismiss") || message.includes("skip") ? "dismiss_reply_draft" : "send_reply_draft",
        input: {
          brandId: context.brand.id,
          draftId: asString(brandMemory?.recentSelection.draftId),
        },
      };
    }
  }

  if (looksLikeBrandCreationRequest(message) && requestedDomain) {
    return {
      toolName: "create_brand",
      input: {
        name: requestedDomain,
        website: ensureWebsiteUrl(requestedDomain),
      },
    };
  }

  const asksWhyOutboundIsNotSending =
    context?.brand.id &&
    (/\bwhy\b/.test(message) || /\bwhat'?s?\b/.test(message) || /\bwhat is\b/.test(message) || /\bblock/.test(message)) &&
    (
      /\bsend(ing|s)?\b/.test(message) ||
      /\boutbound\b/.test(message) ||
      /\breal mail\b/.test(message) ||
      /\breal email\b/.test(message) ||
      /\bscheduled messages?\b/.test(message) ||
      /\bcampaign\b/.test(message)
    );

  if (asksWhyOutboundIsNotSending) {
    return {
      toolName: "inspect_outbound_blocker_chain",
      input: {
        brandId: context.brand.id,
        campaignId,
        query: input.message,
      },
    };
  }

  if (context?.brand.id && message.includes("inbox")) {
    return {
      toolName: "summarize_inbox",
      input: { brandId: context.brand.id },
    };
  }

  if (context?.brand.id && /\bleads?\b/.test(message)) {
    if ((message.includes("add") || message.includes("create")) && quoted) {
      return {
        toolName: "add_brand_lead",
        input: { brandId: context.brand.id, name: quoted },
      };
    }
    if ((message.includes("update") || message.includes("mark")) && leadId) {
      return {
        toolName: "update_brand_lead",
        input: {
          brandId: context.brand.id,
          leadId,
          status: message.includes("qualified")
            ? "qualified"
            : message.includes("contacted")
              ? "contacted"
              : message.includes("closed")
                ? "closed"
                : message.includes("new")
                  ? "new"
                  : "",
        },
      };
    }
    return {
      toolName: "summarize_leads",
      input: { brandId: context.brand.id },
    };
  }

  if (context?.brand.id && /\bdrafts?\b/.test(message) && message.includes("send") && draftId) {
    return {
      toolName: "send_reply_draft",
      input: { brandId: context.brand.id, draftId },
    };
  }

  if (context?.brand.id && /\bdrafts?\b/.test(message) && (message.includes("dismiss") || message.includes("skip")) && draftId) {
    return {
      toolName: "dismiss_reply_draft",
      input: { brandId: context.brand.id, draftId },
    };
  }

  if (context?.brand.id && /\bcampaigns?\b/.test(message)) {
    if ((message.includes("launch") || message.includes("start")) && campaignId) {
      return {
        toolName: "launch_campaign_run",
        input: { brandId: context.brand.id, campaignId },
      };
    }
    if ((message.includes("pause") || message.includes("resume") || message.includes("cancel")) && campaignId) {
      return {
        toolName: "control_campaign_run",
        input: {
          brandId: context.brand.id,
          campaignId,
          action: message.includes("pause") ? "pause" : message.includes("resume") ? "resume" : "cancel",
        },
      };
    }
    if (message.includes("probe") && campaignId) {
      return {
        toolName: "control_campaign_run",
        input: {
          brandId: context.brand.id,
          campaignId,
          action:
            message.includes("all sender") || message.includes("all the sender")
              ? "probe_all_senders_deliverability"
              : "probe_deliverability",
        },
      };
    }
    if ((message.includes("delete") || message.includes("remove")) && campaignId) {
      return {
        toolName: "delete_campaign",
        input: { brandId: context.brand.id, campaignId },
      };
    }
    if (campaignId) {
      return {
        toolName: "get_campaign_snapshot",
        input: { brandId: context.brand.id, campaignId },
      };
    }
    return {
      toolName: "summarize_campaign_status",
      input: { brandId: context.brand.id },
    };
  }

  if (context?.brand.id && /\bexperiments?\b/.test(message)) {
    if ((message.includes("create") || message.includes("add")) && quoted) {
      return {
        toolName: "create_experiment",
        input: { brandId: context.brand.id, name: quoted },
      };
    }
    if ((message.includes("launch") || message.includes("start")) && experimentId) {
      return {
        toolName: "launch_experiment_run",
        input: { brandId: context.brand.id, experimentId },
      };
    }
    if ((message.includes("pause") || message.includes("resume") || message.includes("cancel")) && experimentId) {
      return {
        toolName: "control_experiment_run",
        input: {
          brandId: context.brand.id,
          experimentId,
          action: message.includes("pause") ? "pause" : message.includes("resume") ? "resume" : "cancel",
        },
      };
    }
    if ((message.includes("promote") || message.includes("make campaign")) && experimentId) {
      return {
        toolName: "promote_experiment_to_campaign",
        input: { brandId: context.brand.id, experimentId },
      };
    }
    if ((message.includes("delete") || message.includes("remove")) && experimentId) {
      return {
        toolName: "delete_experiment",
        input: { brandId: context.brand.id, experimentId },
      };
    }
    if (experimentId) {
      return {
        toolName: "get_experiment_snapshot",
        input: { brandId: context.brand.id, experimentId },
      };
    }
    return {
      toolName: "summarize_experiments",
      input: { brandId: context.brand.id },
    };
  }

  const wantsSenderProvision =
    /\b(add|create|set up|setup|provision)\b.*\bsender\b/.test(message) ||
    /\bbuy\b.*\bdomain\b/.test(message) ||
    /\bnew sender domain\b/.test(message) ||
    /\bexisting mailpool domain\b/.test(message) ||
    /\bcustomer\.?io\b.*\bsender\b/.test(message);

  if (context?.brand.id && wantsSenderProvision) {
    const emailParts = extractEmailParts(message);
    const parsedDomain = emailParts?.domain || extractDomain(message);
    const useCustomerIo = /\bcustomer\.?io\b/.test(message);
    return {
      toolName: useCustomerIo ? "provision_customerio_sender" : "provision_mailpool_sender",
      input: {
        brandId: context.brand.id,
        provider: useCustomerIo ? "customerio" : "mailpool",
        domain: parsedDomain,
        fromLocalPart: emailParts?.fromLocalPart ?? "",
        domainMode:
          message.includes("buy") ||
          message.includes("register") ||
          message.includes("new domain")
            ? "register"
            : "existing",
      },
    };
  }

  if (message.includes("refresh") || message.includes("sync")) {
    const emailParts = extractEmailParts(message);
    const matchingSender =
      context?.senders.snapshots.find((snapshot) => snapshot.fromEmail === `${emailParts?.fromLocalPart ?? ""}@${emailParts?.domain ?? ""}`) ??
      context?.senders.snapshots.find((snapshot) => snapshot.mailpoolStatus === "pending") ??
      (context?.senders.snapshots.length === 1 ? context.senders.snapshots[0] : null);
    if (matchingSender?.provider === "mailpool") {
      return {
        toolName: "refresh_mailpool_sender",
        input: { accountId: matchingSender.accountId },
      };
    }
  }

  if (context?.brand.id && message.includes("brand")) {
    return {
      toolName: "get_brand_snapshot",
      input: { brandId: context.brand.id },
    };
  }

  if (
    context?.senders.snapshots.length === 1 &&
    context.senders.snapshots[0]?.provider === "mailpool" &&
    message.includes("sender")
  ) {
    return {
      toolName: "get_sender_snapshot",
      input: { accountId: context.senders.snapshots[0].accountId },
    };
  }

  if (context?.brand.id && (message.includes("sender") || message.includes("routing"))) {
    return {
      toolName: "get_brand_snapshot",
      input: { brandId: context.brand.id },
    };
  }

  return null;
}

function snapshotContext(context: Awaited<ReturnType<typeof getOperatorBrandContext>>): Record<string, unknown> {
  if (!context) return {};
  return {
    brand: context.brand,
    provisioning: context.provisioning,
    senders: {
      total: context.senders.total,
      ready: context.senders.ready,
      pending: context.senders.pending,
      blocked: context.senders.blocked,
    },
    campaigns: context.campaigns,
    experiments: context.experiments,
    leads: context.leads,
    inbox: context.inbox,
    issues: context.issues,
    nextActions: context.nextActions,
  };
}

function toActionSummary(action: OperatorAction): OperatorActionSummary {
  return {
    id: action.id,
    toolName: action.toolName,
    riskLevel: action.riskLevel,
    approvalMode: action.approvalMode,
    status: action.status,
    preview: action.preview,
  };
}

function extractAssistantPayload(message: OperatorMessage | null) {
  const content = asRecord(message?.content);
  return {
    assistant: {
      summary: asString(asRecord(content.assistant).summary) || asString(content.text),
      findings: Array.isArray(asRecord(content.assistant).findings)
        ? (asRecord(content.assistant).findings as string[])
        : [],
      recommendations: Array.isArray(asRecord(content.assistant).recommendations)
        ? (asRecord(content.assistant).recommendations as string[])
        : [],
    } satisfies OperatorChatAssistantReply,
    execution: readExecutionEnvelope(content.execution),
  };
}

async function buildChatResponseFromThread(input: {
  threadId: string;
  runId: string;
  runStatus: OperatorRunStatus;
  model: string;
}) {
  const detail = await getOperatorThreadDetail(input.threadId);
  if (!detail) {
    throw new Error("Operator thread not found after action completed");
  }
  const latestAssistantMessage =
    [...detail.messages].reverse().find((message) => message.role === "assistant" && message.kind === "message") ?? null;
  const payload = extractAssistantPayload(latestAssistantMessage);
  return {
    thread: detail.thread,
    run: {
      id: input.runId,
      status: input.runStatus,
      model: input.model,
    },
    assistant: payload.assistant,
    execution: payload.execution,
    actions: detail.actions.map(toActionSummary),
    messages: latestAssistantMessage ? [latestAssistantMessage] : [],
  } satisfies OperatorChatResponse;
}

async function createAssistantMessage(
  threadId: string,
  assistant: OperatorChatAssistantReply,
  execution: OperatorExecutionEnvelope | null = null,
  evidence?: {
    trace?: OperatorEvidenceTraceEntry[];
    check?: OperatorEvidenceCheck | null;
    run?: Pick<OperatorRun, "id" | "status" | "model" | "startedAt" | "completedAt">;
  }
) {
  return createOperatorMessage({
    threadId,
    role: "assistant",
    kind: "message",
    content: {
      text: assistant.summary,
      assistant,
      execution,
      evidenceTrace: evidence?.trace ?? [],
      evidenceCheck: evidence?.check ?? null,
      run: evidence?.run ?? null,
    },
  });
}

async function executeToolAction(input: {
  threadId: string;
  actionId: string;
  tool: OperatorToolSpec;
  toolInput: Record<string, unknown>;
}) {
  await createOperatorMessage({
    threadId: input.threadId,
    role: "tool",
    kind: "tool_call",
    content: {
      toolName: input.tool.name,
      input: input.toolInput,
    },
  });
  const result = await input.tool.run(input.toolInput);
  const updatedAction =
    (await updateOperatorAction(input.actionId, {
      status: "completed",
      result: result.result,
    })) ?? (await getOperatorAction(input.actionId));
  await createOperatorMessage({
    threadId: input.threadId,
    role: "tool",
    kind: "tool_result",
    content: {
      toolName: input.tool.name,
      summary: result.summary,
      result: result.result,
    },
  });
  if (result.receipt) {
    await createOperatorMessage({
      threadId: input.threadId,
      role: "assistant",
      kind: "receipt",
      content: result.receipt,
    });
  }
  return { result, updatedAction };
}

async function executeAutonomousConfirmedTool(input: {
  threadId: string;
  runId: string;
  userId?: string;
  tool: OperatorToolSpec;
  toolInput: Record<string, unknown>;
  preview: Record<string, unknown>;
}) {
  const action = await createOperatorAction({
    runId: input.runId,
    toolName: input.tool.name,
    riskLevel: input.tool.riskLevel,
    approvalMode: input.tool.approvalMode,
    status: "running",
    input: input.toolInput,
    preview: input.preview,
  });
  await createOperatorApproval({
    actionId: action.id,
    requestedByUserId: input.userId,
    decidedByUserId: input.userId,
    decision: "approved",
    note: "Autonomously approved by Brand GPT under the active execution policy.",
  });

  try {
    const executed = await executeToolAction({
      threadId: input.threadId,
      actionId: action.id,
      tool: input.tool,
      toolInput: input.toolInput,
    });
    const receipt =
      executed.result.receipt ??
      ({
        title: "Action completed",
        summary: executed.result.summary,
        details: [],
      } satisfies OperatorReceipt);
    return {
      action: executed.updatedAction ?? action,
      assistant: {
        summary: executed.result.summary,
        findings: [],
        recommendations: [],
      } satisfies OperatorChatAssistantReply,
      execution: buildExecutionEnvelope({
        state: "completed",
        actionId: executed.updatedAction?.id ?? action.id,
        toolName: input.tool.name,
        toolInput: input.toolInput,
        preview: input.preview,
        receipt,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operator action failed";
    const failedAction = await updateOperatorAction(action.id, {
      status: "failed",
      errorText: message,
    });
    return {
      action: failedAction ?? action,
      assistant: {
        summary: `It failed. ${message}`,
        findings: [],
        recommendations: [],
      } satisfies OperatorChatAssistantReply,
      execution: buildExecutionEnvelope({
        state: "failed",
        actionId: failedAction?.id ?? action.id,
        toolName: input.tool.name,
        toolInput: input.toolInput,
        preview: input.preview,
        error: message,
      }),
    };
  }
}

async function resolveOperatorThread(input: {
  threadId?: string;
  userId?: string;
  brandId?: string;
  message: string;
  existingThread?: OperatorThread;
}) {
  if (input.existingThread) return input.existingThread;
  const requestedThreadId = input.threadId?.trim() ?? "";
  const requestedBrandId = asString(input.brandId);
  const loadedThread = requestedThreadId ? await getOperatorThread(requestedThreadId) : null;
  const loadedThreadBrandId = asString(loadedThread?.brandId);
  const threadCanContinue =
    Boolean(loadedThread) &&
    loadedThread?.status === "active" &&
    (!requestedBrandId || !loadedThreadBrandId || loadedThreadBrandId === requestedBrandId);
  let thread = threadCanContinue ? loadedThread : null;
  if (!thread) {
    thread = await createOperatorThread({
      userId: input.userId,
      brandId: input.brandId,
      title: titleFromMessage(input.message),
    });
  } else if (!thread.title.trim()) {
    thread = (await updateOperatorThread(thread.id, { title: titleFromMessage(input.message) })) ?? thread;
  }
  return thread;
}

export async function startOperatorChatRun(input: OperatorChatRequest): Promise<OperatorChatStartResponse> {
  const thread = await resolveOperatorThread(input);
  const resolvedBrandId = asString(input.brandId) || thread.brandId;
  const message = await createOperatorMessage({
    threadId: thread.id,
    role: "user",
    kind: "message",
    content: { text: input.message },
  });
  const brandContext = resolvedBrandId ? await getOperatorBrandContext(resolvedBrandId) : null;
  const run = await createOperatorRun({
    threadId: thread.id,
    brandId: resolvedBrandId,
    model: "operator-agent-queued",
    contextSnapshot: {
      ...snapshotContext(brandContext),
      pendingMessageId: message.id,
      requestedMode: input.mode === "recommendation_only" ? "recommendation_only" : "default",
      executionPolicy: input.executionPolicy === "autonomous" ? "autonomous" : "confirm_required",
      autonomousToolAllowlist: Array.isArray(input.autonomousToolAllowlist)
        ? input.autonomousToolAllowlist.map((entry) => asString(entry)).filter(Boolean).slice(0, 80)
        : [],
      queuedAt: nowIso(),
    },
    plan: [
      {
        step: "queued",
        status: "running",
        summary: "Brand GPT run is queued and ready for the tool loop.",
      },
    ],
  });
  const updatedThread =
    (await updateOperatorThread(thread.id, {
      lastSummary: "Brand GPT is working on the latest request.",
    })) ?? thread;
  return {
    thread: updatedThread,
    run,
    message,
  };
}

export async function processOperatorChatRun(input: {
  runId: string;
  userId?: string;
}): Promise<OperatorChatResponse> {
  const run = await getOperatorRun(input.runId);
  if (!run) {
    const error = new Error("Operator run not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  const thread = await getOperatorThread(run.threadId);
  if (!thread) {
    const error = new Error("Operator thread not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  if (run.status !== "running") {
    return buildChatResponseFromThread({
      threadId: thread.id,
      runId: run.id,
      runStatus: run.status,
      model: run.model,
    });
  }

  const messages = await listOperatorMessages(thread.id);
  const pendingMessageId = asString(run.contextSnapshot.pendingMessageId);
  const pendingMessage =
    (pendingMessageId ? messages.find((message) => message.id === pendingMessageId) : null) ??
    [...messages].reverse().find((message) => message.role === "user" && message.kind === "message") ??
    null;
  const message = asString(pendingMessage?.content.text);
  if (!message) {
    const errorText = "Brand GPT run has no user message to process.";
    await updateOperatorRun(run.id, {
      status: "failed",
      errorText,
      completedAt: nowIso(),
    });
    await createAssistantMessage(
      thread.id,
      {
        summary: errorText,
        findings: [],
        recommendations: [],
      },
      buildExecutionEnvelope({ state: "failed", error: errorText }),
      {
        run: {
          id: run.id,
          status: "failed",
          model: run.model,
          startedAt: run.startedAt,
          completedAt: nowIso(),
        },
      }
    );
    return buildChatResponseFromThread({
      threadId: thread.id,
      runId: run.id,
      runStatus: "failed",
      model: run.model,
    });
  }

  return runOperatorChatTurn({
    threadId: thread.id,
    userId: input.userId,
    brandId: run.brandId || thread.brandId,
    message,
    mode: asString(run.contextSnapshot.requestedMode) === "recommendation_only" ? "recommendation_only" : "default",
    executionPolicy:
      asString(run.contextSnapshot.executionPolicy) === "autonomous" ? "autonomous" : "confirm_required",
    autonomousToolAllowlist: Array.isArray(run.contextSnapshot.autonomousToolAllowlist)
      ? (run.contextSnapshot.autonomousToolAllowlist as unknown[]).map((entry) => asString(entry)).filter(Boolean)
      : [],
    existingRunId: run.id,
    existingThread: thread,
    skipUserMessage: true,
  });
}

export async function runOperatorChatTurn(input: OperatorChatTurnInternalRequest): Promise<OperatorChatResponse> {
  let runId = "";
  const thread = await resolveOperatorThread(input);

  const resolvedBrandId = asString(input.brandId) || thread.brandId;
  if (!input.skipUserMessage) {
    await createOperatorMessage({
      threadId: thread.id,
      role: "user",
      kind: "message",
      content: { text: input.message },
    });
  }

  const [brandContext, brandMemory] = resolvedBrandId
    ? await Promise.all([
        getOperatorBrandContext(resolvedBrandId),
        getOperatorBrandMemory(resolvedBrandId),
      ])
    : [null, null];
  const greetingOnly = isCasualGreeting(input.message);
  const fallbackAssistant = greetingOnly
    ? buildGreetingAssistant(brandContext?.brand.name)
    : brandContext
      ? buildDefaultAssistantReply({
          brandName: brandContext.brand.name,
          issues: brandContext.issues,
          nextActions: brandContext.nextActions,
          sendersTotal: brandContext.senders.total,
          readySenders: brandContext.senders.ready,
          campaignsTotal: brandContext.campaigns.total,
          inboxThreads: brandContext.inbox.threads,
        })
      : {
          summary: "I can help, but there isn't an active brand attached to this chat yet. Open a brand and try again.",
          findings: [],
          recommendations: [],
        };
  const [messageHistory, threadActions] = await Promise.all([
    listOperatorMessages(thread.id),
    listOperatorActionsByThread(thread.id),
  ]);
  const continuation = input.structuredAction
    ? null
    : input.disableLocalHeuristics
      ? null
      : inferContinuationFromPendingExecution({
        message: input.message,
        messages: messageHistory,
        actions: threadActions,
        brandContext,
        brandMemory,
        brandId: resolvedBrandId,
      });
  const effectiveMessage =
    continuation?.kind === "message_override" ? continuation.message : input.message;
  const structuredAction = input.structuredAction
    ? normalizeRequestedAction({
        raw: input.structuredAction,
        brandId: resolvedBrandId,
        mode: input.mode,
        message: effectiveMessage,
        context: brandContext,
        brandMemory,
        source: "structured",
      })
    : continuation?.kind === "structured_action"
      ? normalizeRequestedAction({
          raw: continuation.requestedAction,
          brandId: resolvedBrandId,
          mode: input.mode,
          message: effectiveMessage,
          context: brandContext,
          brandMemory,
          source: "continuation",
      })
    : null;
  const shouldUsePlanner =
    !structuredAction &&
    continuation?.kind !== "confirm_action" &&
    continuation?.kind !== "cancel_action" &&
    continuation?.kind !== "message_override";
  const llmPlan = shouldUsePlanner
    ? await planOperatorReplyWithLlm({
        brandId: resolvedBrandId,
        message: effectiveMessage,
        mode: input.mode,
        messages: messageHistory,
        context: brandContext,
        brandMemory,
        fallbackAssistant,
      })
    : null;
  const plannerUnavailable = shouldUsePlanner && !llmPlan && !greetingOnly;
  const inferredFallbackAction = input.disableLocalHeuristics
    ? null
    : inferActionFromMessage(
        {
          ...input,
          message: effectiveMessage,
        },
        brandContext,
        brandMemory
      );
  const requestedAction = structuredAction
    ? structuredAction
    : continuation?.kind === "message_override"
      ? filterRequestedActionForMessage(inferredFallbackAction, effectiveMessage)
    : plannerUnavailable
      ? null
    : llmPlan
      ? (
          llmPlan.requestedAction ??
          (shouldUseHeuristicFallbackAction(inferredFallbackAction, effectiveMessage)
            ? filterRequestedActionForMessage(inferredFallbackAction, effectiveMessage)
            : null)
        )
      : filterRequestedActionForMessage(inferredFallbackAction, effectiveMessage);
  const runModel =
    llmPlan?.model ??
    (structuredAction
      ? "operator-structured-action"
      : continuation?.kind === "confirm_action"
        ? "operator-inline-confirm"
        : continuation?.kind === "cancel_action"
          ? "operator-inline-cancel"
          : "operator-v1");
  const runPlan = [
    ...((llmPlan?.trace ?? []).map((entry) => ({
      step: entry.toolName,
      status: entry.error ? "completed_with_error" : "completed",
      summary: entry.error || entry.summary,
    })) as Array<Record<string, unknown>>),
    ...(continuation?.kind === "confirm_action"
      ? [{ step: "confirm_action", status: "in_progress", actionId: continuation.actionId }]
      : []),
    ...(continuation?.kind === "cancel_action"
      ? [{ step: "cancel_action", status: "in_progress", actionId: continuation.actionId }]
      : []),
    ...(requestedAction
      ? [{ step: requestedAction.toolName, status: "in_progress" }]
      : []),
  ];
  let run = input.existingRunId ? await getOperatorRun(input.existingRunId) : null;
  if (input.existingRunId && !run) {
    const error = new Error("Operator run not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  if (run && run.threadId !== thread.id) {
    throw new Error("Operator run does not belong to this thread.");
  }
  if (run) {
    run =
      (await updateOperatorRun(run.id, {
        status: "running",
        model: runModel,
        contextSnapshot: {
          ...run.contextSnapshot,
          ...snapshotContext(brandContext),
          executionPolicy: input.executionPolicy === "autonomous" ? "autonomous" : "confirm_required",
          autonomousToolAllowlist: Array.isArray(input.autonomousToolAllowlist)
            ? input.autonomousToolAllowlist.map((entry) => asString(entry)).filter(Boolean).slice(0, 80)
            : [],
          processingStartedAt: nowIso(),
        },
        plan: runPlan,
      })) ?? run;
  } else {
    run = await createOperatorRun({
      threadId: thread.id,
      brandId: resolvedBrandId,
      model: runModel,
      contextSnapshot: {
        ...snapshotContext(brandContext),
        executionPolicy: input.executionPolicy === "autonomous" ? "autonomous" : "confirm_required",
        autonomousToolAllowlist: Array.isArray(input.autonomousToolAllowlist)
          ? input.autonomousToolAllowlist.map((entry) => asString(entry)).filter(Boolean).slice(0, 80)
          : [],
      },
      plan: runPlan,
    });
  }
  runId = run.id;

  try {
    let assistant: OperatorChatAssistantReply;
    let execution: OperatorExecutionEnvelope | null = buildExecutionEnvelope({ state: "answer_only" });
    const actions: OperatorAction[] = [];

    if (continuation?.kind === "confirm_action") {
      await confirmOperatorAction({
        actionId: continuation.actionId,
        userId: input.userId,
        note: "Confirmed in chat.",
      });
      await updateOperatorRun(run.id, {
        status: "completed",
        contextSnapshot: {
          ...snapshotContext(brandContext),
          executionPolicy: input.executionPolicy === "autonomous" ? "autonomous" : "confirm_required",
          autonomousToolAllowlist: Array.isArray(input.autonomousToolAllowlist)
            ? input.autonomousToolAllowlist.map((entry) => asString(entry)).filter(Boolean).slice(0, 80)
            : [],
        },
        completedAt: nowIso(),
      });
      return buildChatResponseFromThread({
        threadId: thread.id,
        runId: run.id,
        runStatus: "completed",
        model: run.model,
      });
    } else if (continuation?.kind === "cancel_action") {
      await cancelOperatorAction({
        actionId: continuation.actionId,
        userId: input.userId,
        note: "Canceled in chat.",
      });
      await updateOperatorRun(run.id, {
        status: "completed",
        contextSnapshot: {
          ...snapshotContext(brandContext),
          executionPolicy: input.executionPolicy === "autonomous" ? "autonomous" : "confirm_required",
          autonomousToolAllowlist: Array.isArray(input.autonomousToolAllowlist)
            ? input.autonomousToolAllowlist.map((entry) => asString(entry)).filter(Boolean).slice(0, 80)
            : [],
        },
        completedAt: nowIso(),
      });
      return buildChatResponseFromThread({
        threadId: thread.id,
        runId: run.id,
        runStatus: "completed",
        model: run.model,
      });
    } else if (requestedAction) {
      if (resolvedBrandId) {
        await rememberOperatorRecentSelection(resolvedBrandId, {
          experimentId: asString(requestedAction.input.experimentId),
          campaignId: asString(requestedAction.input.campaignId),
          leadId: asString(requestedAction.input.leadId),
          draftId: asString(requestedAction.input.draftId),
          senderAccountId:
            asString(requestedAction.input.accountId) || asString(requestedAction.input.senderAccountId),
        });
      }
      const tool = getOperatorToolSpec(requestedAction.toolName);
      if (!tool) {
        assistant = {
          summary: `I understand what you're asking for, but I can't run that yet because the tool \`${requestedAction.toolName}\` is not registered.`,
          findings: [],
          recommendations: [],
        };
        execution = buildExecutionEnvelope({
          state: "failed",
          toolName: requestedAction.toolName,
          toolInput: requestedAction.input,
          error: assistant.summary,
        });
      } else if (
        isProvisionSenderToolName(tool.name) &&
        (!asString(requestedAction.input.domain) || !asString(requestedAction.input.fromLocalPart))
      ) {
        const hasInventory = (brandContext?.provisioning.mailpoolDomainInventoryCount ?? 0) > 0;
        const missingFields = buildProvisionMissingFields(requestedAction.input, tool.name);
        const providerLabel = provisionProviderLabel(tool.name);
        const senderExample =
          tool.name === "provision_mailpool_sender"
            ? "`marco@getselffunded.com, Marco Rosetti`"
            : "`marco@getselffunded.com`";
        assistant = {
          summary: hasInventory
            ? `I can add the sender. Tell me the exact sender email${tool.name === "provision_mailpool_sender" ? " and the real person's first and last name" : ""}, for example ${senderExample}, and whether I should use an existing ${providerLabel} domain or buy a new one.`
            : `I can add the sender. Tell me the exact sender email${tool.name === "provision_mailpool_sender" ? " and the real person's first and last name" : ""}, for example ${senderExample}. If this needs a new domain, say \`buy\` or \`register\` and I'll prepare that flow.`,
          findings: [],
          recommendations: [],
        };
        execution = buildNeedInfoEnvelope({
          toolName: tool.name,
          toolInput: requestedAction.input,
          preview: buildToolPreview(tool, requestedAction.input),
          missingFields,
          questions: buildProvisionQuestions({
            hasMailpoolInventory: hasInventory,
            domainMode: normalizeProvisionDomainMode(requestedAction.input.domainMode),
            missingFields,
          }),
          forms: buildProvisionForms({
            brandContext,
            brandMemory,
            toolInput: requestedAction.input,
            missingFields,
            toolName: tool.name,
          }),
        });
      } else if (
        tool.name === "provision_mailpool_sender" &&
        (!asString(requestedAction.input.senderFirstName) || !asString(requestedAction.input.senderLastName))
      ) {
        const missingFields = buildProvisionMissingFields(requestedAction.input, tool.name);
        assistant = {
          summary:
            "I can provision that Mailpool sender, but I need the real person's first and last name first. Mailpool sender names cannot default to the brand or mailbox label.",
          findings: [],
          recommendations: [],
        };
        execution = buildNeedInfoEnvelope({
          toolName: tool.name,
          toolInput: requestedAction.input,
          preview: buildToolPreview(tool, requestedAction.input),
          missingFields,
          questions: buildProvisionQuestions({
            hasMailpoolInventory: (brandContext?.provisioning.mailpoolDomainInventoryCount ?? 0) > 0,
            domainMode: normalizeProvisionDomainMode(requestedAction.input.domainMode),
            missingFields,
          }),
          forms: buildProvisionForms({
            brandContext,
            brandMemory,
            toolInput: requestedAction.input,
            missingFields,
            toolName: tool.name,
          }),
        });
      } else if (
        isProvisionSenderToolName(tool.name) &&
        normalizeProvisionDomainMode(requestedAction.input.domainMode) === "register"
      ) {
        const registrant = asRecord(requestedAction.input.registrant);
        const hasRegistrant =
          Boolean(asString(registrant.firstName)) &&
          Boolean(asString(registrant.lastName)) &&
          Boolean(asString(registrant.emailAddress)) &&
          Boolean(asString(registrant.address1)) &&
          Boolean(asString(registrant.city)) &&
          Boolean(asString(registrant.postalCode)) &&
          Boolean(asString(registrant.country));
        if (!hasRegistrant) {
          assistant = {
            summary: "I can buy and provision that sender, but I still need the registrant details first: first name, last name, company, email, street address, city, postal code, and country. If you want to skip that, tell me to use an existing Mailpool domain instead.",
            findings: [],
            recommendations: [],
          };
          execution = buildNeedInfoEnvelope({
            toolName: tool.name,
            toolInput: requestedAction.input,
            preview: buildToolPreview(tool, requestedAction.input),
            missingFields: buildProvisionMissingFields(requestedAction.input, tool.name),
            questions: buildProvisionQuestions({
              hasMailpoolInventory: (brandContext?.provisioning.mailpoolDomainInventoryCount ?? 0) > 0,
              domainMode: normalizeProvisionDomainMode(requestedAction.input.domainMode),
              missingFields: buildProvisionMissingFields(requestedAction.input, tool.name),
            }),
            forms: buildProvisionForms({
              brandContext,
              brandMemory,
              toolInput: requestedAction.input,
              missingFields: buildProvisionMissingFields(requestedAction.input, tool.name),
              toolName: tool.name,
            }),
          });
        } else if (tool.approvalMode === "confirm") {
          if (resolvedBrandId) {
            await rememberProvisionMailpoolSenderInput(resolvedBrandId, requestedAction.input);
          }
          const preview = buildToolPreview(tool, requestedAction.input);
          if (canAutonomouslyApproveTool(input, tool)) {
            const outcome = await executeAutonomousConfirmedTool({
              threadId: thread.id,
              runId: run.id,
              userId: input.userId,
              tool,
              toolInput: requestedAction.input,
              preview,
            });
            actions.push(outcome.action);
            assistant = outcome.assistant;
            execution = outcome.execution;
          } else {
            const action = await createOperatorAction({
              runId: run.id,
              toolName: tool.name,
              riskLevel: tool.riskLevel,
              approvalMode: tool.approvalMode,
              input: requestedAction.input,
              preview,
            });
            actions.push(action);
            assistant = summarizeActionPreview(action);
            execution = buildExecutionEnvelope({
              state: "awaiting_confirmation",
              actionId: action.id,
              toolName: tool.name,
              toolInput: requestedAction.input,
              preview: action.preview,
            });
          }
        } else {
          if (resolvedBrandId) {
            await rememberProvisionMailpoolSenderInput(resolvedBrandId, requestedAction.input);
          }
          const action = await createOperatorAction({
            runId: run.id,
            toolName: tool.name,
            riskLevel: tool.riskLevel,
            approvalMode: tool.approvalMode,
            status: "running",
            input: requestedAction.input,
            preview: buildToolPreview(tool, requestedAction.input),
          });
          try {
            const executed = await executeToolAction({
              threadId: thread.id,
              actionId: action.id,
              tool,
              toolInput: requestedAction.input,
            });
            actions.push(executed.updatedAction ?? action);
            assistant = {
              summary: executed.result.summary,
              findings: [],
              recommendations: [],
            };
            execution =
              tool.riskLevel === "read"
                ? buildExecutionEnvelope({ state: "answer_only" })
                : buildExecutionEnvelope({
                    state: "completed",
                    actionId: executed.updatedAction?.id ?? action.id,
                    toolName: tool.name,
                    toolInput: requestedAction.input,
                    preview: action.preview,
                    receipt:
                      executed.result.receipt ??
                      ({
                        title: "Action completed",
                        summary: executed.result.summary,
                        details: [],
                      } satisfies OperatorReceipt),
                  });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Operator action failed";
            const failedAction = await updateOperatorAction(action.id, {
              status: "failed",
              errorText: message,
            });
            actions.push(failedAction ?? action);
            assistant = {
              summary: `It failed. ${message}`,
              findings: [],
              recommendations: [],
            };
            execution = buildExecutionEnvelope({
              state: "failed",
              actionId: failedAction?.id ?? action.id,
              toolName: tool.name,
              toolInput: requestedAction.input,
              preview: action.preview,
              error: message,
            });
          }
        }
      } else if (tool.approvalMode === "confirm") {
        if (resolvedBrandId && isProvisionSenderToolName(tool.name)) {
          await rememberProvisionMailpoolSenderInput(resolvedBrandId, requestedAction.input);
        }
        const preview = buildToolPreview(tool, requestedAction.input);
        if (canAutonomouslyApproveTool(input, tool)) {
          const outcome = await executeAutonomousConfirmedTool({
            threadId: thread.id,
            runId: run.id,
            userId: input.userId,
            tool,
            toolInput: requestedAction.input,
            preview,
          });
          actions.push(outcome.action);
          assistant = outcome.assistant;
          execution = outcome.execution;
        } else {
          const action = await createOperatorAction({
            runId: run.id,
            toolName: tool.name,
            riskLevel: tool.riskLevel,
            approvalMode: tool.approvalMode,
            input: requestedAction.input,
            preview,
          });
          actions.push(action);
          assistant = summarizeActionPreview(action);
          execution = buildExecutionEnvelope({
            state: "awaiting_confirmation",
            actionId: action.id,
            toolName: tool.name,
            toolInput: requestedAction.input,
            preview: action.preview,
          });
        }
      } else {
        if (resolvedBrandId && isProvisionSenderToolName(tool.name)) {
          await rememberProvisionMailpoolSenderInput(resolvedBrandId, requestedAction.input);
        }
        const action = await createOperatorAction({
          runId: run.id,
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          approvalMode: tool.approvalMode,
          status: "running",
          input: requestedAction.input,
          preview: buildToolPreview(tool, requestedAction.input),
        });
        try {
          const executed = await executeToolAction({
            threadId: thread.id,
            actionId: action.id,
            tool,
            toolInput: requestedAction.input,
          });
          actions.push(executed.updatedAction ?? action);
          assistant = {
            summary: executed.result.summary,
            findings: [],
            recommendations: [],
          };
          execution =
            tool.riskLevel === "read"
              ? buildExecutionEnvelope({ state: "answer_only" })
              : buildExecutionEnvelope({
                  state: "completed",
                  actionId: executed.updatedAction?.id ?? action.id,
                  toolName: tool.name,
                  toolInput: requestedAction.input,
                  preview: action.preview,
                  receipt:
                    executed.result.receipt ??
                    ({
                      title: "Action completed",
                      summary: executed.result.summary,
                      details: [],
                    } satisfies OperatorReceipt),
                });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Operator action failed";
          const failedAction = await updateOperatorAction(action.id, {
            status: "failed",
            errorText: message,
          });
          actions.push(failedAction ?? action);
          assistant = {
            summary: `It failed. ${message}`,
            findings: [],
            recommendations: [],
          };
          execution = buildExecutionEnvelope({
            state: "failed",
            actionId: failedAction?.id ?? action.id,
            toolName: tool.name,
            toolInput: requestedAction.input,
            preview: action.preview,
            error: message,
          });
        }
      }
    } else {
      const disambiguation = input.disableLocalHeuristics
        ? null
        : inferDisambiguationTurn({
            message: input.message,
            brandContext,
          });
      if (disambiguation) {
        assistant = disambiguation.assistant;
        execution = disambiguation.execution;
      } else if (plannerUnavailable) {
        assistant = {
          summary:
            "I couldn't reach the AI planner for this turn, so I don't trust a real account answer yet. I did not make any changes.",
          findings: [],
          recommendations: [],
        };
        execution = buildExecutionEnvelope({
          state: "failed",
          error: "Brand GPT planner was unavailable for this run.",
        });
      } else {
        assistant = makeUnexecutedActionAssistant(effectiveMessage, llmPlan?.assistant ?? fallbackAssistant);
        execution = isExplicitMutationRequest(effectiveMessage)
          ? buildNeedInfoEnvelope({
              missingFields: [],
              questions: [
                buildQuestion("What should I do next?", [
                  { label: "Summarize this brand", message: "Summarize this brand." },
                  { label: "Check senders", message: "What needs attention with the senders?" },
                  { label: "Summarize inbox", message: "Summarize inbox activity." },
                ]),
              ],
            })
          : buildExecutionEnvelope({ state: "answer_only" });
      }
    }

    const runStatus = execution?.state === "failed" ? "failed" : "completed";
    const completedAt = nowIso();
    const assistantMessage = await createAssistantMessage(thread.id, assistant, execution, {
      trace: buildEvidenceTrace(llmPlan?.trace),
      check: buildEvidenceCheck(llmPlan?.evidenceCheck),
      run: {
        id: run.id,
        status: runStatus,
        model: run.model,
        startedAt: run.startedAt,
        completedAt,
      },
    });
    const updatedThread =
      (await updateOperatorThread(thread.id, {
        lastSummary: assistant.summary,
      })) ?? thread;
    await updateOperatorRun(run.id, {
      status: runStatus,
      contextSnapshot: {
        ...snapshotContext(brandContext),
        executionPolicy: input.executionPolicy === "autonomous" ? "autonomous" : "confirm_required",
        autonomousToolAllowlist: Array.isArray(input.autonomousToolAllowlist)
          ? input.autonomousToolAllowlist.map((entry) => asString(entry)).filter(Boolean).slice(0, 80)
          : [],
      },
      completedAt,
    });

    return {
      thread: updatedThread,
      run: {
        id: run.id,
        status: runStatus,
        model: run.model,
      },
      assistant,
      execution,
      actions: actions.map(toActionSummary),
      messages: [assistantMessage],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operator chat failed";
    await updateOperatorRun(runId, {
      status: "failed",
      errorText: message,
      completedAt: nowIso(),
    });
    throw error;
  }
}

export async function confirmOperatorAction(input: {
  actionId: string;
  userId?: string;
  note?: string;
}) {
  const action = await getOperatorAction(input.actionId);
  if (!action) {
    const error = new Error("Operator action not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  const run = await getOperatorRun(action.runId);
  if (!run) {
    const error = new Error("Operator run not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  const thread = await getOperatorThread(run.threadId);
  if (!thread) {
    const error = new Error("Operator thread not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  if (action.approvalMode !== "confirm") {
    return {
      action,
      receipt: {
        title: "No confirmation needed",
        summary: "This action does not require explicit confirmation.",
        details: [],
      },
    };
  }

  await createOperatorApproval({
    actionId: action.id,
    requestedByUserId: input.userId,
    decidedByUserId: input.userId,
    decision: "approved",
    note: input.note,
  });

  const tool = getOperatorToolSpec(action.toolName);
  if (!tool) {
    const error = new Error("Operator tool not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  await updateOperatorAction(action.id, { status: "running" });

  try {
    const executed = await executeToolAction({
      threadId: thread.id,
      actionId: action.id,
      tool,
      toolInput: action.input,
    });
    const receipt =
      executed.result.receipt ??
      ({
        title: "Action completed",
        summary: executed.result.summary,
        details: [],
      } as const);
    await createAssistantMessage(
      thread.id,
      {
        summary: executed.result.summary,
        findings: [],
        recommendations: [],
      },
      buildExecutionEnvelope({
        state: "completed",
        actionId: action.id,
        toolName: action.toolName,
        toolInput: action.input,
        preview: action.preview,
        receipt,
      })
    );
    await updateOperatorThread(thread.id, {
      lastSummary: receipt.summary,
    });
    return {
      action: executed.updatedAction ?? action,
      receipt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operator action failed";
    const failedAction = await updateOperatorAction(action.id, {
      status: "failed",
      errorText: message,
    });
    await createAssistantMessage(
      thread.id,
      {
        summary: `It failed. ${message}`,
        findings: [],
        recommendations: [],
      },
      buildExecutionEnvelope({
        state: "failed",
        actionId: action.id,
        toolName: action.toolName,
        toolInput: action.input,
        preview: action.preview,
        error: message,
      })
    );
    await updateOperatorThread(thread.id, {
      lastSummary: message,
    });
    return {
      action: failedAction ?? action,
      receipt: {
        title: "Action failed",
        summary: message,
        details: [],
      },
    };
  }
}

export async function cancelOperatorAction(input: {
  actionId: string;
  userId?: string;
  note?: string;
}) {
  const action = await getOperatorAction(input.actionId);
  if (!action) {
    const error = new Error("Operator action not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  const run = await getOperatorRun(action.runId);
  if (!run) {
    const error = new Error("Operator run not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  const thread = await getOperatorThread(run.threadId);
  if (!thread) {
    const error = new Error("Operator thread not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  if (action.approvalMode === "confirm") {
    await createOperatorApproval({
      actionId: action.id,
      requestedByUserId: input.userId,
      decidedByUserId: input.userId,
      decision: "rejected",
      note: input.note,
    });
  }
  const canceledAction = await updateOperatorAction(action.id, {
    status: "canceled",
    errorText: "",
  });
  const summary = input.note?.trim() || "Canceled. I did not make that change.";
  await createAssistantMessage(
    thread.id,
    {
      summary,
      findings: [],
      recommendations: [],
    },
    buildExecutionEnvelope({
      state: "canceled",
      actionId: action.id,
      toolName: action.toolName,
      toolInput: action.input,
      preview: action.preview,
    })
  );
  await updateOperatorThread(thread.id, {
    lastSummary: summary,
  });

  return {
    action: canceledAction ?? action,
  };
}

export async function getOperatorThreadDetail(threadId: string): Promise<OperatorThreadDetail | null> {
  const thread = await getOperatorThread(threadId);
  if (!thread) return null;
  const [messages, actions, runs] = await Promise.all([
    listOperatorMessages(threadId),
    listOperatorActionsByThread(threadId),
    listOperatorRunsByThread(threadId),
  ]);
  return {
    thread,
    runs,
    messages,
    actions,
  };
}
