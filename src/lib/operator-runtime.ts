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
  updateOperatorAction,
  updateOperatorRun,
  updateOperatorThread,
} from "@/lib/operator-data";
import { getOperatorBrandContext } from "@/lib/operator-context";
import { getOperatorToolSpec } from "@/lib/operator-tools";
import type {
  OperatorAction,
  OperatorActionSummary,
  OperatorChatAssistantReply,
  OperatorChatRequest,
  OperatorChatResponse,
  OperatorRequestedAction,
  OperatorThreadDetail,
  OperatorToolSpec,
} from "@/lib/operator-types";

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
  return {
    summary: `${brandLabel} has ${input.sendersTotal ?? 0} sender${input.sendersTotal === 1 ? "" : "s"}, ${input.campaignsTotal ?? 0} campaign${input.campaignsTotal === 1 ? "" : "s"}, and ${input.inboxThreads ?? 0} inbox thread${input.inboxThreads === 1 ? "" : "s"}.`,
    findings:
      input.issues.length > 0
        ? input.issues
        : [
            input.readySenders
              ? `${input.readySenders} sender${input.readySenders === 1 ? "" : "s"} are ready for routing.`
              : "No immediate blockers were detected from the stored brand snapshot.",
          ],
    recommendations:
      input.nextActions.length > 0
        ? input.nextActions
        : ["Ask Operator to inspect a sender, summarize campaigns, or summarize inbox activity."],
  };
}

function buildToolPreview(tool: OperatorToolSpec, input: Record<string, unknown>) {
  return tool.buildPreview?.(input) ?? {
    title: tool.previewTitle,
    summary: tool.description,
  };
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

function summarizeActionPreview(action: OperatorAction): OperatorChatAssistantReply {
  const previewTitle = asString(action.preview.title) || "Action ready";
  const previewSummary = asString(action.preview.summary) || "Operator prepared an action preview.";
  return {
    summary: `${previewTitle}. Confirmation is required before it runs.`,
    findings: [previewSummary],
    recommendations: ["Review the action preview and confirm if it looks correct."],
  };
}

function inferActionFromMessage(
  input: OperatorChatRequest,
  context: Awaited<ReturnType<typeof getOperatorBrandContext>>
): OperatorRequestedAction | null {
  if (input.structuredAction) return input.structuredAction;
  const message = input.message.trim().toLowerCase();
  if (!message) return null;

  if (context?.brand.id && message.includes("inbox")) {
    return {
      toolName: "summarize_inbox",
      input: { brandId: context.brand.id },
    };
  }

  if (context?.brand.id && message.includes("campaign")) {
    return {
      toolName: "summarize_campaign_status",
      input: { brandId: context.brand.id },
    };
  }

  if (context?.brand.id && (message.includes("add sender") || message.includes("buy domain") || message.includes("provision sender"))) {
    const emailParts = extractEmailParts(message);
    const parsedDomain = emailParts?.domain || extractDomain(message);
    return {
      toolName: "provision_mailpool_sender",
      input: {
        brandId: context.brand.id,
        provider: "mailpool",
        domain: parsedDomain,
        fromLocalPart: emailParts?.fromLocalPart ?? "",
        domainMode:
          message.includes("buy") || message.includes("register") || message.includes("new domain")
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

async function createAssistantMessage(
  threadId: string,
  assistant: OperatorChatAssistantReply
) {
  return createOperatorMessage({
    threadId,
    role: "assistant",
    kind: "message",
    content: {
      text: assistant.summary,
      assistant,
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

export async function runOperatorChatTurn(input: OperatorChatRequest): Promise<OperatorChatResponse> {
  let runId = "";
  let thread =
    input.threadId?.trim() ? await getOperatorThread(input.threadId.trim()) : null;
  if (!thread) {
    thread = await createOperatorThread({
      userId: input.userId,
      brandId: input.brandId,
      title: titleFromMessage(input.message),
    });
  } else if (!thread.title.trim()) {
    thread = (await updateOperatorThread(thread.id, { title: titleFromMessage(input.message) })) ?? thread;
  }

  const resolvedBrandId = asString(input.brandId) || thread.brandId;
  await createOperatorMessage({
    threadId: thread.id,
    role: "user",
    kind: "message",
    content: { text: input.message },
  });

  const brandContext = resolvedBrandId ? await getOperatorBrandContext(resolvedBrandId) : null;
  const requestedAction = inferActionFromMessage(input, brandContext);
  const run = await createOperatorRun({
    threadId: thread.id,
    brandId: resolvedBrandId,
    model: "operator-v1",
    contextSnapshot: snapshotContext(brandContext),
    plan: requestedAction
      ? [{ step: requestedAction.toolName, status: "in_progress" }]
      : [],
  });
  runId = run.id;

  try {
    let assistant: OperatorChatAssistantReply;
    const actions: OperatorAction[] = [];

    if (requestedAction) {
      const tool = getOperatorToolSpec(requestedAction.toolName);
      if (!tool) {
        assistant = {
          summary: "Operator recognized the request, but the corresponding tool is not registered.",
          findings: [`Missing tool: ${requestedAction.toolName}`],
          recommendations: ["Try a different request or register the missing tool."],
        };
      } else if (
        tool.name === "provision_mailpool_sender" &&
        (!asString(requestedAction.input.domain) || !asString(requestedAction.input.fromLocalPart))
      ) {
        const hasInventory = (brandContext?.provisioning.mailpoolDomainInventoryCount ?? 0) > 0;
        assistant = {
          summary: "I can add a sender, but I still need the sender mailbox details.",
          findings: [
            hasInventory
              ? `This workspace already has ${brandContext?.provisioning.mailpoolDomainInventoryCount ?? 0} Mailpool domain${brandContext?.provisioning.mailpoolDomainInventoryCount === 1 ? "" : "s"} available.`
              : "This workspace does not have any saved Mailpool domains yet.",
          ],
          recommendations: [
            "Tell me the sender email you want, for example `marco@getselffunded.com`.",
            hasInventory
              ? "Say whether I should use an existing Mailpool domain or buy a new one."
              : "If this should be a new domain purchase, say `buy` or `register` and I will prepare that flow.",
          ],
        };
      } else if (
        tool.name === "provision_mailpool_sender" &&
        asString(requestedAction.input.domainMode) === "register"
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
            summary: "I can buy and provision that sender, but I still need the registrant details for the domain purchase.",
            findings: ["Mailpool requires registrant contact data before a new domain can be bought."],
            recommendations: [
              "Send first name, last name, company, email, street address, city, postal code, and country.",
              "If you want to avoid that step, tell me to use an existing Mailpool domain instead.",
            ],
          };
        } else if (tool.approvalMode === "confirm") {
          const action = await createOperatorAction({
            runId: run.id,
            toolName: tool.name,
            riskLevel: tool.riskLevel,
            approvalMode: tool.approvalMode,
            input: requestedAction.input,
            preview: buildToolPreview(tool, requestedAction.input),
          });
          actions.push(action);
          await createOperatorMessage({
            threadId: thread.id,
            role: "assistant",
            kind: "approval_request",
            content: {
              actionId: action.id,
              preview: action.preview,
              toolName: action.toolName,
            },
          });
          assistant = summarizeActionPreview(action);
        } else {
          const action = await createOperatorAction({
            runId: run.id,
            toolName: tool.name,
            riskLevel: tool.riskLevel,
            approvalMode: tool.approvalMode,
            status: "running",
            input: requestedAction.input,
            preview: buildToolPreview(tool, requestedAction.input),
          });
          actions.push(action);
          const executed = await executeToolAction({
            threadId: thread.id,
            actionId: action.id,
            tool,
            toolInput: requestedAction.input,
          });
          assistant = {
            summary: executed.result.summary,
            findings: brandContext?.issues.length ? brandContext.issues.slice(0, 3) : [executed.result.summary],
            recommendations:
              brandContext?.nextActions.length ? brandContext.nextActions.slice(0, 3) : ["Ask Operator for the next step."],
          };
        }
      } else if (tool.approvalMode === "confirm") {
        const action = await createOperatorAction({
          runId: run.id,
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          approvalMode: tool.approvalMode,
          input: requestedAction.input,
          preview: buildToolPreview(tool, requestedAction.input),
        });
        actions.push(action);
        await createOperatorMessage({
          threadId: thread.id,
          role: "assistant",
          kind: "approval_request",
          content: {
            actionId: action.id,
            preview: action.preview,
            toolName: action.toolName,
          },
        });
        assistant = summarizeActionPreview(action);
      } else {
        const action = await createOperatorAction({
          runId: run.id,
          toolName: tool.name,
          riskLevel: tool.riskLevel,
          approvalMode: tool.approvalMode,
          status: "running",
          input: requestedAction.input,
          preview: buildToolPreview(tool, requestedAction.input),
        });
        actions.push(action);
        const executed = await executeToolAction({
          threadId: thread.id,
          actionId: action.id,
          tool,
          toolInput: requestedAction.input,
        });
        assistant = {
          summary: executed.result.summary,
          findings: brandContext?.issues.length ? brandContext.issues.slice(0, 3) : [executed.result.summary],
          recommendations:
            brandContext?.nextActions.length ? brandContext.nextActions.slice(0, 3) : ["Ask Operator for the next step."],
        };
      }
    } else if (brandContext) {
      assistant = buildDefaultAssistantReply({
        brandName: brandContext.brand.name,
        issues: brandContext.issues,
        nextActions: brandContext.nextActions,
        sendersTotal: brandContext.senders.total,
        readySenders: brandContext.senders.ready,
        campaignsTotal: brandContext.campaigns.total,
        inboxThreads: brandContext.inbox.threads,
      });
    } else {
      assistant = {
        summary: "Operator is ready, but no brand context was provided for this thread yet.",
        findings: ["There is no active brand attached to this Operator request."],
        recommendations: ["Open a brand and try again, or pass a brandId into the Operator chat request."],
      };
    }

    const assistantMessage = await createAssistantMessage(thread.id, assistant);
    const updatedThread =
      (await updateOperatorThread(thread.id, {
        lastSummary: assistant.summary,
      })) ?? thread;
    await updateOperatorRun(run.id, {
      status: "completed",
      contextSnapshot: snapshotContext(brandContext),
      completedAt: nowIso(),
    });

    return {
      thread: updatedThread,
      run: {
        id: run.id,
        status: "completed",
        model: run.model,
      },
      assistant,
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
    await createOperatorMessage({
      threadId: thread.id,
      role: "assistant",
      kind: "system_note",
      content: {
        title: "Action failed",
        summary: message,
      },
    });
    throw Object.assign(new Error(message), {
      status: 500,
      action: failedAction ?? action,
    });
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
  await createOperatorMessage({
    threadId: thread.id,
    role: "assistant",
    kind: "system_note",
    content: {
      title: "Action canceled",
      summary: input.note?.trim() || "The requested action was canceled.",
    },
  });
  await updateOperatorThread(thread.id, {
    lastSummary: input.note?.trim() || "Action canceled",
  });

  return {
    action: canceledAction ?? action,
  };
}

export async function getOperatorThreadDetail(threadId: string): Promise<OperatorThreadDetail | null> {
  const thread = await getOperatorThread(threadId);
  if (!thread) return null;
  const [messages, actions] = await Promise.all([
    listOperatorMessages(threadId),
    listOperatorActionsByThread(threadId),
  ]);
  return {
    thread,
    messages,
    actions,
  };
}
