import {
  listOperatorActionsByThread,
  listOperatorAttentionRequests,
  listOperatorMessages,
  listOperatorRunsByThread,
  listOperatorThreads,
} from "@/lib/operator-data";
import type {
  OperatorAction,
  OperatorActivityItem,
  OperatorActivitySummary,
  OperatorMessage,
  OperatorRun,
  OperatorThread,
} from "@/lib/operator-types";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactText(value: string, maxLength = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function actionTitle(action: OperatorAction) {
  const preview = asRecord(action.preview);
  const receipt = asRecord(action.result);
  return (
    asString(preview.title) ||
    asString(receipt.title) ||
    action.toolName.replace(/_/g, " ")
  );
}

function actionSummary(action: OperatorAction) {
  const preview = asRecord(action.preview);
  const receipt = asRecord(action.result);
  if (action.errorText) return action.errorText;
  return (
    asString(receipt.summary) ||
    asString(preview.summary) ||
    asString(preview.title) ||
    action.toolName.replace(/_/g, " ")
  );
}

function messageSummary(message: OperatorMessage) {
  const content = asRecord(message.content);
  return asString(content.text) || asString(content.summary) || asString(asRecord(content.assistant).summary);
}

function messageTitle(message: OperatorMessage) {
  const content = asRecord(message.content);
  const attention = asRecord(content.attentionRequest);
  if (Object.keys(attention).length) {
    return asString(attention.title) || "Brand GPT needs attention";
  }
  if (message.role === "assistant") return "Brand GPT answered";
  if (message.role === "user") return "User replied";
  return "Thread updated";
}

function itemFromRun(thread: OperatorThread, run: OperatorRun): OperatorActivityItem {
  return {
    id: run.id,
    type: "run",
    threadId: thread.id,
    threadTitle: thread.title,
    title: run.status === "running" ? "Brand GPT is running" : `Run ${run.status}`,
    summary:
      run.status === "running"
        ? "The agent is processing context, tools, and evidence."
        : run.errorText || "The agent finished a tool-loop run.",
    status: run.status,
    toolName: "",
    riskLevel: "",
    model: run.model,
    createdAt: run.completedAt || run.startedAt,
  };
}

function itemFromAction(thread: OperatorThread, action: OperatorAction): OperatorActivityItem {
  return {
    id: action.id,
    type: "action",
    threadId: thread.id,
    threadTitle: thread.title,
    title: actionTitle(action),
    summary: actionSummary(action),
    status: action.status,
    toolName: action.toolName,
    riskLevel: action.riskLevel,
    model: "",
    createdAt: action.updatedAt || action.createdAt,
  };
}

function itemFromMessage(thread: OperatorThread, message: OperatorMessage): OperatorActivityItem | null {
  if (message.kind !== "message" || message.role !== "assistant") return null;
  const summary = messageSummary(message);
  if (!summary) return null;
  const attention = asRecord(asRecord(message.content).attentionRequest);
  return {
    id: message.id,
    type: Object.keys(attention).length ? "attention" : "message",
    threadId: thread.id,
    threadTitle: thread.title,
    title: messageTitle(message),
    summary: compactText(summary),
    status: asString(attention.status) || "",
    toolName: "",
    riskLevel: "",
    model: asString(asRecord(asRecord(message.content).run).model),
    createdAt: message.createdAt,
  };
}

function summarizeActivity(input: {
  brandId: string;
  items: OperatorActivityItem[];
  openAttentionCount: number;
}): OperatorActivitySummary {
  const latest = input.items[0] ?? null;
  const running = input.items.find((item) => item.type === "run" && item.status === "running");
  const latestFailed = latest?.status === "failed" ? latest : null;
  const latestAttention = input.items.find((item) => item.type === "attention");
  const state: OperatorActivitySummary["state"] = running
    ? "running"
    : input.openAttentionCount > 0
      ? "needs_attention"
      : latestFailed
        ? "failed"
        : latest
          ? "active"
          : "quiet";
  const headline =
    state === "running"
      ? "Brand GPT is working now."
      : state === "needs_attention"
        ? "Brand GPT needs your attention."
        : state === "failed"
          ? "The latest agent step hit an error."
          : state === "active"
            ? "Brand GPT has recent activity."
            : "No agent activity yet.";
  const detail =
    state === "quiet"
      ? "Ask Brand GPT something or start a mission to create the first activity."
      : state === "needs_attention" && latestAttention
        ? `${latestAttention.title}: ${compactText(latestAttention.summary, 120)}`
        : state === "needs_attention"
          ? `${input.openAttentionCount} open attention request${input.openAttentionCount === 1 ? "" : "s"}.`
        : latest
          ? `${latest.title}: ${compactText(latest.summary, 120)}`
          : "";

  return {
    brandId: input.brandId,
    state,
    headline,
    detail,
    updatedAt: latest?.createdAt ?? "",
    openAttentionCount: input.openAttentionCount,
    items: input.items,
  };
}

export async function getOperatorActivitySummary(input: {
  brandId: string;
  limit?: number;
}): Promise<OperatorActivitySummary> {
  const brandId = input.brandId.trim();
  const limit = Math.max(1, Math.min(20, Math.round(Number(input.limit ?? 8)) || 8));
  if (!brandId) {
    return summarizeActivity({ brandId, items: [], openAttentionCount: 0 });
  }

  const [threads, openAttention] = await Promise.all([
    listOperatorThreads({ brandId, status: "active" }),
    listOperatorAttentionRequests({ brandId, status: "open", limit: 20 }),
  ]);
  const threadDetails = await Promise.all(
    threads.slice(0, 20).map(async (thread) => {
      const [runs, actions, messages] = await Promise.all([
        listOperatorRunsByThread(thread.id),
        listOperatorActionsByThread(thread.id),
        listOperatorMessages(thread.id),
      ]);
      return { thread, runs, actions, messages };
    })
  );

  const items = threadDetails.flatMap(({ thread, runs, actions, messages }) => [
    ...runs.slice(0, 3).map((run) => itemFromRun(thread, run)),
    ...actions.slice(-6).map((action) => itemFromAction(thread, action)),
    ...messages.slice(-6).map((message) => itemFromMessage(thread, message)).filter((item): item is OperatorActivityItem => Boolean(item)),
  ]);

  const sorted = items
    .sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt))
    .slice(0, limit);
  return summarizeActivity({
    brandId,
    items: sorted,
    openAttentionCount: openAttention.length,
  });
}
