"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronRight,
  Loader2,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  cancelOperatorActionApi,
  confirmOperatorActionApi,
  fetchOperatorThreadDetail,
  fetchOperatorThreads,
  sendOperatorChat,
} from "@/lib/client-api";
import type {
  OperatorAction,
  OperatorExecutionEnvelope,
  OperatorMessage,
  OperatorThreadDetail,
} from "@/lib/operator-types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "").trim()).filter(Boolean) : [];
}

function executionStateLabel(state: OperatorExecutionEnvelope["state"]) {
  switch (state) {
    case "need_info":
      return "Need info";
    case "awaiting_confirmation":
      return "Ready to run";
    case "running":
      return "Running";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return "Answer only";
  }
}

function executionCardTone(state: OperatorExecutionEnvelope["state"]) {
  switch (state) {
    case "need_info":
    case "awaiting_confirmation":
      return "border-[color:var(--accent-border)] bg-[color:var(--accent-soft)]";
    case "completed":
      return "border-[color:var(--success-border)] bg-[color:var(--success-soft)]";
    case "failed":
      return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]";
    case "canceled":
      return "border-[color:var(--border)] bg-[color:var(--surface-muted)]";
    default:
      return "border-[color:var(--border)] bg-[color:var(--surface)]";
  }
}

function messageCardTone(message: OperatorMessage) {
  if (message.kind === "system_note") {
    return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]";
  }
  if (message.role === "user") {
    return "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-foreground)]";
  }
  return "border-[color:var(--border)] bg-[color:var(--surface-muted)]";
}

function ExecutionCard({
  execution,
  action,
  onConfirm,
  onCancel,
  onChooseReply,
  actionBusyId,
  sending,
}: {
  execution: OperatorExecutionEnvelope;
  action?: OperatorAction;
  onConfirm: (actionId: string) => void;
  onCancel: (actionId: string) => void;
  onChooseReply: (message: string) => void;
  actionBusyId: string;
  sending: boolean;
}) {
  const intent = execution.intent;
  const receipt = execution.receipt;
  const missingFields = asStringArray(execution.missingFields);
  const questions = Array.isArray(execution.questions) ? execution.questions : [];
  const statusLabel = executionStateLabel(execution.state);
  const actionId = asString(execution.actionId);
  const canConfirm = execution.state === "awaiting_confirmation" && Boolean(actionId) && action?.status === "awaiting_approval";

  return (
    <div className={cn("mt-3 rounded-[14px] border px-3 py-3", executionCardTone(execution.state))}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">Action</div>
        <Badge variant={execution.state === "completed" ? "success" : execution.state === "failed" ? "danger" : execution.state === "awaiting_confirmation" || execution.state === "need_info" ? "accent" : "muted"}>
          {statusLabel}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 text-sm leading-6 text-[color:var(--foreground)]">
        {intent ? (
          <>
            <div>
              <span className="text-[color:var(--muted-foreground)]">Intent:</span>{" "}
              <span className="font-medium capitalize">{intent.verb}</span> {intent.objectType}
            </div>
            <div>
              <span className="text-[color:var(--muted-foreground)]">Target:</span>{" "}
              <span>{intent.objectLabel || "Not resolved yet"}</span>
            </div>
          </>
        ) : null}
        {execution.toolName ? (
          <div>
            <span className="text-[color:var(--muted-foreground)]">Tool:</span>{" "}
            <span className="font-mono text-xs">{execution.toolName}</span>
          </div>
        ) : null}
        {receipt ? (
          <div>
            <span className="text-[color:var(--muted-foreground)]">Result:</span>{" "}
            <span>{receipt.summary}</span>
          </div>
        ) : asString(execution.preview.summary) ? (
          <div>
            <span className="text-[color:var(--muted-foreground)]">Result:</span>{" "}
            <span>{asString(execution.preview.summary)}</span>
          </div>
        ) : null}
        {missingFields.length ? (
          <div>
            <div className="text-[color:var(--muted-foreground)]">Missing:</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {missingFields.map((field) => (
                <Badge key={field} variant="muted">
                  {field}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        {asString(execution.error) ? (
          <div>
            <span className="text-[color:var(--muted-foreground)]">Error:</span>{" "}
            <span>{asString(execution.error)}</span>
          </div>
        ) : null}
        {questions.length ? (
          <div className="space-y-3">
            {questions.map((question, index) => {
              const prompt = asString(question?.prompt);
              const options = Array.isArray(question?.options) ? question.options : [];
              if (!prompt || !options.length) return null;
              return (
                <div key={`${prompt}-${index}`}>
                  <div className="text-[color:var(--muted-foreground)]">{prompt}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {options.map((option, optionIndex) => {
                      const label = asString(option?.label);
                      const message = asString(option?.message);
                      if (!label || !message) return null;
                      return (
                        <Button
                          key={`${label}-${optionIndex}`}
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => onChooseReply(message)}
                          disabled={sending || Boolean(actionBusyId)}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      {canConfirm ? (
        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => onConfirm(actionId)}
            disabled={Boolean(actionBusyId)}
          >
            {actionBusyId === actionId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Confirm
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onCancel(actionId)}
            disabled={Boolean(actionBusyId)}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function MessageBody({
  message,
  actionsById,
  onConfirm,
  onCancel,
  onChooseReply,
  actionBusyId,
  sending,
}: {
  message: OperatorMessage;
  actionsById: Map<string, OperatorAction>;
  onConfirm: (actionId: string) => void;
  onCancel: (actionId: string) => void;
  onChooseReply: (message: string) => void;
  actionBusyId: string;
  sending: boolean;
}) {
  const content = asRecord(message.content);
  if (message.kind === "message" && message.role === "assistant") {
    const assistant = asRecord(content.assistant);
    const execution = asRecord(content.execution);
    const actionId = asString(execution.actionId);
    const action = actionId ? actionsById.get(actionId) : undefined;
    return (
      <div>
        <div className="whitespace-pre-wrap text-sm leading-6">{asString(content.text) || asString(assistant.summary)}</div>
        {asString(execution.state) && asString(execution.state) !== "answer_only" ? (
          <ExecutionCard
            execution={execution as OperatorExecutionEnvelope}
            action={action}
            onConfirm={onConfirm}
            onCancel={onCancel}
            onChooseReply={onChooseReply}
            actionBusyId={actionBusyId}
            sending={sending}
          />
        ) : null}
      </div>
    );
  }

  if (message.kind === "message") {
    return <div className="text-sm leading-6">{asString(content.text)}</div>;
  }

  if (message.kind === "system_note") {
    return (
      <div className="space-y-1">
        <div className="text-sm font-medium text-[color:var(--foreground)]">{asString(content.title) || "System note"}</div>
        <div className="text-sm leading-6 text-[color:var(--foreground)]">{asString(content.summary)}</div>
      </div>
    );
  }

  return <div className="text-sm leading-6 text-[color:var(--foreground)]">{JSON.stringify(content)}</div>;
}

const DEFAULT_PROMPTS = [
  "What needs attention right now?",
  "Add a sender for this brand",
  "Why isn't the current sender ready?",
  "Summarize inbox activity",
  "What should I do next?",
] as const;

export default function OperatorPanel({
  open,
  onOpenChange,
  activeBrandId,
  activeBrandName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeBrandId: string;
  activeBrandName: string;
}) {
  const [threadDetail, setThreadDetail] = useState<OperatorThreadDetail | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionBusyId, setActionBusyId] = useState("");
  const [error, setError] = useState("");
  const [input, setInput] = useState("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const visibleMessages = useMemo(
    () =>
      (threadDetail?.messages ?? []).filter(
        (message) =>
          (message.role === "user" && message.kind === "message") ||
          (message.role === "assistant" && message.kind === "message") ||
          message.kind === "system_note"
      ),
    [threadDetail]
  );
  const actionsById = useMemo(
    () => new Map((threadDetail?.actions ?? []).map((action) => [action.id, action] as const)),
    [threadDetail]
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    const load = async () => {
      if (!activeBrandId) {
        setThreadDetail(null);
        setError("");
        return;
      }
      setLoadingThread(true);
      setError("");
      try {
        const threads = await fetchOperatorThreads({ brandId: activeBrandId, status: "active" });
        if (!mounted) return;
        const latest = threads[0] ?? null;
        if (!latest) {
          setThreadDetail(null);
          return;
        }
        const detail = await fetchOperatorThreadDetail(latest.id);
        if (!mounted) return;
        setThreadDetail(detail);
      } catch (nextError) {
        if (!mounted) return;
        setError(nextError instanceof Error ? nextError.message : "Failed to load Operator thread");
      } finally {
        if (mounted) setLoadingThread(false);
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [activeBrandId, open]);

  useEffect(() => {
    if (!open) return;
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [open, threadDetail]);

  async function refreshThread(threadId: string) {
    const detail = await fetchOperatorThreadDetail(threadId);
    setThreadDetail(detail);
  }

  async function handleSend(message: string) {
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    if (!activeBrandId) {
      setError("Open a brand first so Operator has account context.");
      return;
    }

    setSending(true);
    setError("");
    try {
      const response = await sendOperatorChat({
        threadId: threadDetail?.thread.id,
        brandId: activeBrandId,
        message: trimmed,
      });
      setInput("");
      await refreshThread(response.thread.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Operator request failed");
    } finally {
      setSending(false);
    }
  }

  async function handleConfirm(actionId: string) {
    if (!threadDetail || actionBusyId) return;
    setActionBusyId(actionId);
    setError("");
    try {
      await confirmOperatorActionApi(actionId);
      await refreshThread(threadDetail.thread.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to confirm Operator action");
    } finally {
      setActionBusyId("");
    }
  }

  async function handleCancel(actionId: string) {
    if (!threadDetail || actionBusyId) return;
    setActionBusyId(actionId);
    setError("");
    try {
      await cancelOperatorActionApi(actionId);
      await refreshThread(threadDetail.thread.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to cancel Operator action");
    } finally {
      setActionBusyId("");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[color:color-mix(in_oklab,var(--foreground)_22%,transparent)]/70 backdrop-blur-[1px]">
      <button type="button" className="flex-1" aria-label="Close Operator" onClick={() => onOpenChange(false)} />
      <aside className="relative flex h-full w-full max-w-[30rem] flex-col border-l border-[color:var(--border)] bg-[color:var(--surface)] shadow-[0_24px_70px_-40px_color-mix(in_oklab,var(--shadow)_92%,transparent)]">
        <div className="border-b border-[color:var(--border)] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="accent" className="gap-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  Operator
                </Badge>
                {activeBrandName ? <Badge variant="muted">{activeBrandName}</Badge> : null}
              </div>
              <div className="mt-2 text-sm leading-6 text-[color:var(--foreground)]">
                Ask anything. If Operator makes a change, it will show exactly what it did.
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)} aria-label="Close Operator">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div ref={scrollerRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {!activeBrandId ? (
            <div className="rounded-[14px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-4 text-sm text-[color:var(--muted-foreground)]">
              Select a brand first. Operator is scoped to the active brand context.
            </div>
          ) : null}

          {loadingThread ? (
            <div className="inline-flex items-center gap-2 rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading Operator thread...
            </div>
          ) : null}

          {error ? (
            <div className="rounded-[14px] border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] px-4 py-3 text-sm text-[color:var(--danger)]">
              {error}
            </div>
          ) : null}

          {!loadingThread && activeBrandId && !visibleMessages.length ? (
            <div className="space-y-4">
              <div className="rounded-[16px] border border-[color:var(--border)] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--accent)_14%,var(--surface))_0%,var(--surface-muted)_100%)] px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-medium text-[color:var(--foreground)]">
                  <Bot className="h-4 w-4" />
                  Start with one of these
                </div>
                <div className="mt-3 grid gap-2">
                  {DEFAULT_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void handleSend(prompt)}
                      className="flex items-center justify-between rounded-[12px] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-3 text-left text-sm text-[color:var(--foreground)] transition-colors hover:bg-[color:var(--surface-hover)]"
                    >
                      <span>{prompt}</span>
                      <ChevronRight className="h-4 w-4 text-[color:var(--muted-foreground)]" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {visibleMessages.map((message) => {
            const isUser = message.role === "user" && message.kind === "message";
            return (
              <div key={message.id} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[92%] rounded-[16px] border px-4 py-3",
                    messageCardTone(message),
                    isUser ? "max-w-[80%]" : ""
                  )}
                >
                  <MessageBody
                    message={message}
                    actionsById={actionsById}
                    onConfirm={(actionId) => void handleConfirm(actionId)}
                    onCancel={(actionId) => void handleCancel(actionId)}
                    onChooseReply={(message) => void handleSend(message)}
                    actionBusyId={actionBusyId}
                    sending={sending}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-[color:var(--border)] px-5 py-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {DEFAULT_PROMPTS.slice(0, 3).map((prompt) => (
              <Button
                key={prompt}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void handleSend(prompt)}
                disabled={sending || !activeBrandId}
              >
                {prompt}
              </Button>
            ))}
          </div>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSend(input);
            }}
          >
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend(input);
                }
              }}
              placeholder={
                activeBrandId
                  ? "Ask anything, or tell Operator what you want it to do."
                  : "Select a brand to use Operator."
              }
              className="min-h-[112px]"
              disabled={sending || !activeBrandId}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-[color:var(--muted-foreground)]">
                `Enter` sends. `Shift+Enter` adds a new line.
              </div>
              <Button type="submit" disabled={sending || !activeBrandId || !input.trim()}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
                Send
              </Button>
            </div>
          </form>
        </div>
      </aside>
    </div>
  );
}
